(function initMinutaNotificationCenter(global) {
  'use strict';

  const CHANNEL_LABELS = { telegram:'Telegram', email:'Email', sms:'SMS', max:'MAX', push:'Push' };
  const AUDIENCE_LABELS = { provider:'Команде', client:'Клиентам' };
  const STATUS_LABELS = { pending:'в очереди', sending:'отправляется', sent:'доставлено', failed:'ошибка', cancelled:'отменено' };

  function createController(options) {
    const { db, $, escapeHtml, notify, requireWrites } = options;
    let organization = null;
    let payload = null;
    let available = null;
    let busy = false;

    function missing(error) {
      return /PGRST202|42883|get_minuta_notification_workspace|function .* does not exist/i.test(`${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`);
    }
    function manager() { return ['owner', 'admin'].includes(String(payload?.current_role || '')); }
    function endpointConfigured(audience, channel) {
      return (payload?.endpoints || []).some((item) => item.audience === audience && item.channel === channel && item.active && item.configured);
    }
    function setBusy(value) {
      busy = value;
      $('#unifiedNotificationPanel')?.querySelectorAll('button,input').forEach((item) => {
        item.disabled = value || item.dataset.requiresEndpoint === 'true' || (item.dataset.managerOnly === 'true' && !manager());
      });
    }
    function reset() {
      organization = null; payload = null; available = null; busy = false;
      if ($('#unifiedNotificationPanel')) $('#unifiedNotificationPanel').hidden = true;
    }
    async function load() {
      if (!organization) return;
      const result = await db.rpc('get_minuta_notification_workspace', { p_organization:organization.id });
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
      organization = next?.id ? next : null;
      payload = null; available = null;
      if (!organization) { reset(); return; }
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
      $('#unifiedNotificationState').textContent = enabled ? 'Единая очередь включена' : 'Каналы подготовлены и выключены';
      const channels = Array.isArray(payload.channels) ? payload.channels : [];
      $('#unifiedNotificationChannels').innerHTML = channels.map((item) => {
        const configured = endpointConfigured(item.audience, item.channel);
        const canToggle = manager() && configured;
        return `<label class="unified-channel-card"><input type="checkbox" data-manager-only="true" data-unified-audience="${escapeHtml(item.audience)}" data-unified-channel="${escapeHtml(item.channel)}" ${item.enabled ? 'checked' : ''} ${canToggle ? '' : 'disabled data-requires-endpoint="true"'}><span><strong>${escapeHtml(CHANNEL_LABELS[item.channel] || item.channel)} · ${escapeHtml(AUDIENCE_LABELS[item.audience] || item.audience)}</strong><small>${configured ? (item.enabled ? 'Канал включён' : 'Адрес подтверждён, канал выключен') : 'Требуется подтверждённый адрес и ключ шлюза'}</small></span></label>`;
      }).join('');
      const outbox = Array.isArray(payload.outbox) ? payload.outbox : [];
      $('#unifiedNotificationDeliveries').innerHTML = outbox.length ? outbox.map((item) => `<article class="organization-audit-data-row"><div><strong>${escapeHtml(CHANNEL_LABELS[item.channel] || item.channel)} · ${escapeHtml(AUDIENCE_LABELS[item.audience] || item.audience)}</strong><small>${escapeHtml(item.kind)} · ${escapeHtml(new Date(item.created_at).toLocaleString('ru-RU'))}</small></div><span><em>${escapeHtml(STATUS_LABELS[item.status] || item.status)}</em>${item.status === 'failed' ? `<button class="secondary-button" type="button" data-unified-retry="${escapeHtml(item.id)}">Повторить</button>` : ''}</span></article>`).join('')
        : '<div class="provider-empty compact-empty"><strong>Единая очередь пока пуста</strong><small>Сообщения появятся после подключения хотя бы одного канала.</small></div>';
      setBusy(busy);
      global.refreshSectionNavigation?.();
    }
    async function change(event) {
      if (!organization || !manager() || busy || !requireWrites()) return;
      if (event.target.id === 'unifiedNotificationsEnabled') {
        setBusy(true);
        const result = await db.rpc('set_minuta_notification_master', { p_organization:organization.id, p_enabled:event.target.checked });
        setBusy(false);
        if (result.error) { notify('Не удалось изменить центр уведомлений'); await load(); return; }
        payload = result.data || payload;
        render();
        notify(event.target.checked ? 'Единый центр уведомлений включён' : 'Единый центр уведомлений выключен');
        return;
      }
      if (!event.target.matches('[data-unified-channel]')) return;
      setBusy(true);
      const result = await db.rpc('set_minuta_notification_channel', {
        p_organization:organization.id,
        p_audience:event.target.dataset.unifiedAudience,
        p_channel:event.target.dataset.unifiedChannel,
        p_enabled:event.target.checked
      });
      setBusy(false);
      if (result.error) { notify('Не удалось изменить канал'); await load(); return; }
      payload = result.data || payload;
      render();
      notify('Настройка канала сохранена');
    }
    async function click(event) {
      const retry = event.target.closest('[data-unified-retry]');
      if (!retry || busy || !requireWrites()) return;
      setBusy(true);
      const result = await db.rpc('retry_notification_outbox', { p_outbox:retry.dataset.unifiedRetry });
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
