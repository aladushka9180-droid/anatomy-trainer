(function initMinutaNotificationCenter(global) {
  'use strict';

  const CHANNEL_LABELS = { telegram:'Telegram', email:'Email', sms:'SMS', max:'MAX', push:'Push' };
  const AUDIENCE_LABELS = { provider:'Команде', client:'Клиентам' };
  const STATUS_LABELS = { pending:'в очереди', sending:'отправляется', sent:'отправлено', failed:'ошибка', cancelled:'отменено' };
  const EVENT_LABELS = {
    booking_created:'Запись создана', booking_confirmed:'Запись подтверждена',
    booking_rescheduled:'Запись перенесена', booking_cancelled:'Запись отменена',
    booking_reminder:'Напоминание'
  };

  function createController(options) {
    const { db, $, escapeHtml, notify, requireWrites } = options;
    let organization = null;
    let payload = null;
    let available = null;
    let deliveryHealth = null;
    let currentUserId = '';
    let busy = false;
    let revision = 0;

    function missing(error) {
      return /PGRST202|42883|get_minuta_notification_workspace|function .* does not exist/i.test(`${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`);
    }
    function manager() { return ['owner', 'admin'].includes(String(payload?.current_role || '')); }
    function endpointConfigured(audience, channel) {
      return (payload?.endpoints || []).some((item) => item.audience === audience && item.channel === channel && item.active && item.configured);
    }
    function gatewayConfigured(channel) {
      return deliveryHealth?.configured_channels?.includes(channel) === true;
    }
    function providerFallbackConfigured(audience, channel) {
      return audience === 'provider' && channel === 'telegram' && deliveryHealth?.provider_telegram_fallback === true;
    }
    function channelState(item) {
      const recipient = endpointConfigured(item.audience, item.channel) || providerFallbackConfigured(item.audience, item.channel);
      const gateway = gatewayConfigured(item.channel);
      if (deliveryHealth === null) return { recipient, gateway:false, ready:false, note:'Проверяем шлюз канала…' };
      if (deliveryHealth.unavailable) return { recipient, gateway:false, ready:false, note:'Не удалось проверить шлюз канала' };
      if (!gateway) return { recipient, gateway:false, ready:false, note:'Шлюз канала не настроен' };
      if (!recipient) return {
        recipient:false, gateway:true, ready:false,
        note:item.audience === 'client' ? 'Клиент подключает канал сам после записи' : 'Получатель не подключён'
      };
      return { recipient:true, gateway:true, ready:true, note:item.enabled ? 'Подключён и включён' : 'Подключён · выключён' };
    }
    function setBusy(value) {
      busy = value;
      $('#unifiedNotificationPanel')?.querySelectorAll('button,input').forEach((item) => {
        item.disabled = value || item.dataset.requiresEndpoint === 'true' || (item.dataset.managerOnly === 'true' && !manager());
      });
    }
    function reset() {
      revision += 1;
      organization = null; payload = null; available = null; deliveryHealth = null; currentUserId = ''; busy = false;
      if ($('#unifiedNotificationPanel')) $('#unifiedNotificationPanel').hidden = true;
    }
    function current(requestRevision, organizationId) {
      return requestRevision === revision && organization?.id === organizationId;
    }
    async function loadDeliveryHealth() {
      try {
        const { data } = await db.auth.getUser();
        const userId = data?.user?.id || '';
        const base = String(global.MINUTA_CONFIG?.supabaseUrl || '').replace(/\/$/, '');
        if (!base || !userId) return { health:null, userId };
        const url = new URL(`${base}/functions/v1/notification-dispatcher`);
        url.searchParams.set('performer_id', userId);
        const response = await fetch(url, {
          headers:{ apikey:String(global.MINUTA_CONFIG?.supabaseKey || '') },
          cache:'no-store'
        });
        const result = await response.json().catch(() => null);
        return { health:response.ok && result?.ok ? result : null, userId };
      } catch { return { health:null, userId:'' }; }
    }
    async function load() {
      if (!organization) return;
      const organizationId = organization.id;
      const requestRevision = ++revision;
      const [result, health] = await Promise.all([
        db.rpc('get_minuta_notification_workspace', { p_organization:organizationId }),
        loadDeliveryHealth()
      ]);
      if (!current(requestRevision, organizationId)) return;
      currentUserId = health.userId;
      deliveryHealth = health.health || { unavailable:true, configured_channels:[] };
      if (result.error) {
        available = missing(result.error) ? false : null;
        render(result.error);
        return;
      }
      available = true;
      payload = result.data || {};
      render();
    }
    async function setOrganization(next) {
      revision += 1;
      organization = next?.id ? next : null;
      payload = null; available = null; deliveryHealth = null; currentUserId = ''; busy = false;
      if (!organization) { reset(); return; }
      render();
      await load();
    }
    function render(error = null) {
      const panel = $('#unifiedNotificationPanel');
      if (!panel) return;
      panel.hidden = !organization || available === false;
      if (panel.hidden) { global.refreshSectionNavigation?.(); return; }
      $('#unifiedNotificationUnavailable').hidden = available !== null;
      $('#unifiedNotificationWorkspace').hidden = available !== true;
      if (available !== true) {
        $('#unifiedNotificationUnavailableText').textContent = error ? 'Центр каналов временно недоступен. Старые уведомления продолжают работать.' : '';
        global.refreshSectionNavigation?.();
        return;
      }
      const enabled = Boolean(payload?.settings?.enabled);
      $('#unifiedNotificationsEnabled').checked = enabled;
      $('#unifiedNotificationsEnabled').dataset.managerOnly = 'true';
      $('#unifiedNotificationsEnabled').disabled = !manager() || busy;
      const channels = Array.isArray(payload.channels) ? payload.channels : [];
      const readyChannels = channels.filter(item => channelState(item).ready);
      const activeChannels = readyChannels.filter(item => item.enabled);
      $('#unifiedNotificationState').textContent = enabled
        ? (activeChannels.length ? `Включено: ${activeChannels.length}` : 'Нет включённых каналов')
        : 'Выключен';
      $('#unifiedNotificationChannels').innerHTML = channels.map((item) => {
        const state = channelState(item);
        const canToggle = manager() && state.ready;
        return `<label class="unified-channel-card"><input type="checkbox" data-manager-only="true" data-unified-audience="${escapeHtml(item.audience)}" data-unified-channel="${escapeHtml(item.channel)}" ${item.enabled ? 'checked' : ''} ${canToggle ? '' : 'disabled data-requires-endpoint="true"'}><span><strong>${escapeHtml(CHANNEL_LABELS[item.channel] || item.channel)} · ${escapeHtml(AUDIENCE_LABELS[item.audience] || item.audience)}</strong><small>${escapeHtml(state.note)}</small></span></label>`;
      }).join('');
      const outbox = Array.isArray(payload.outbox) ? payload.outbox : [];
      $('#unifiedNotificationDeliveries').innerHTML = outbox.length ? outbox.map((item) => {
        const status = item.delivered_at ? 'доставлено' : (STATUS_LABELS[item.status] || item.status);
        const context = item.context || {};
        const appointment = [context.client_name, context.service_name, context.booking_date, String(context.booking_time || '').slice(0,5)].filter(Boolean).join(' · ');
        const error = item.status === 'failed' && item.last_error ? ` · ${item.last_error}` : '';
        return `<article class="organization-audit-data-row"><div><strong>${escapeHtml(EVENT_LABELS[item.kind] || item.kind)} · ${escapeHtml(CHANNEL_LABELS[item.channel] || item.channel)} · ${escapeHtml(AUDIENCE_LABELS[item.audience] || item.audience)}</strong><small>${escapeHtml(appointment || new Date(item.created_at).toLocaleString('ru-RU'))}${escapeHtml(error)}</small></div><span><em>${escapeHtml(status)}</em>${item.status === 'failed' ? `<button class="secondary-button" style="min-height:44px" type="button" data-unified-retry="${escapeHtml(item.id)}">Повторить</button>` : ''}</span></article>`;
      }).join('')
        : '<div class="provider-empty compact-empty"><strong>Единая очередь пока пуста</strong><small>Сообщения появятся после подключения хотя бы одного канала.</small></div>';
      setBusy(busy);
      global.refreshSectionNavigation?.();
    }
    async function change(event) {
      if (!organization || !manager() || busy || !requireWrites()) return;
      const organizationId = organization.id;
      const operationRevision = revision;
      if (event.target.id === 'unifiedNotificationsEnabled') {
        setBusy(true);
        const enabled = event.target.checked;
        const result = await db.rpc('set_minuta_notification_master', { p_organization:organizationId, p_enabled:enabled });
        if (!current(operationRevision, organizationId)) return;
        setBusy(false);
        if (result.error) { notify('Не удалось изменить центр уведомлений'); await load(); return; }
        payload = result.data || payload;
        render();
        notify(enabled ? 'Единый центр уведомлений включён' : 'Единый центр уведомлений выключен');
        return;
      }
      if (!event.target.matches('[data-unified-channel]')) return;
      setBusy(true);
      const audience = event.target.dataset.unifiedAudience;
      const channel = event.target.dataset.unifiedChannel;
      const enabled = event.target.checked;
      const result = await db.rpc('set_minuta_notification_channel', {
        p_organization:organizationId,
        p_audience:audience,
        p_channel:channel,
        p_enabled:enabled
      });
      if (!current(operationRevision, organizationId)) return;
      setBusy(false);
      if (result.error) { notify('Не удалось изменить канал'); await load(); return; }
      payload = result.data || payload;
      render();
      notify('Настройка канала сохранена');
    }
    async function click(event) {
      const retry = event.target.closest('[data-unified-retry]');
      if (!retry || !organization || busy || !requireWrites()) return;
      const organizationId = organization.id;
      const operationRevision = revision;
      setBusy(true);
      const result = await db.rpc('retry_notification_outbox', { p_outbox:retry.dataset.unifiedRetry });
      if (!current(operationRevision, organizationId)) return;
      setBusy(false);
      if (result.error) notify('Не удалось повторить уведомление');
      else notify('Уведомление возвращено в очередь');
      await load();
    }
    function bind() {
      document.addEventListener('change', change);
      document.addEventListener('click', click);
      $('#reloadUnifiedNotifications')?.addEventListener('click', load);
    }
    return { bind, load, setOrganization, reset };
  }

  global.MinutaNotificationCenter = { createController };
})(window);
