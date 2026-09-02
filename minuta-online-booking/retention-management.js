(function () {
  'use strict';

  const defaultTemplate = 'Здравствуйте, {имя}! Давно вас не было в {организация}. Будем рады видеть снова: {ссылка}';

  function createController(options) {
    const { db, escapeHtml, notify, requireWrites, getCurrentUser, getSessionGeneration, sessionIsCurrent, applyWriteAvailability } = options;
    const select = options.$;
    function $(selector) { return select(selector); }
    let organization = null;
    let payload = null;
    let availability = null;
    let revision = 0;
    let writing = false;
    let pendingOrganization;

    function unsupported(error) {
      return /PGRST202|42883|get_minuta_retention_workspace|function .* does not exist/i.test(`${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`);
    }
    function scopeMatches(data, id) { return Boolean(data && String(data.organization_id || '') === String(id)); }
    function formatDate(value) {
      if (!value) return 'визитов пока нет';
      const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
      return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
    }
    function formatDateTime(value) {
      if (!value) return '';
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    }
    function phoneDigits(value) {
      let digits = String(value || '').replace(/\D/g, '');
      if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
      return digits;
    }
    function whatsappUrl(phone, message) { return `https://wa.me/${phoneDigits(phone)}?text=${encodeURIComponent(message || '')}`; }
    function empty(title, text) { return `<div class="provider-empty compact-empty"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(text)}</small></div>`; }

    function setBusy(value) {
      $('#retentionPanel')?.querySelectorAll('[data-retention-write]').forEach(control => {
        if (value && !control.disabled) { control.disabled = true; control.dataset.retentionBusy = 'true'; }
        else if (!value && control.dataset.retentionBusy === 'true') { control.disabled = false; delete control.dataset.retentionBusy; }
      });
    }
    function reset() {
      revision += 1; organization = null; payload = null; availability = null; writing = false; pendingOrganization = undefined;
      $('#retentionPanel').hidden = true;
      $('#retentionLoading').hidden = true;
      $('#retentionUnavailable').hidden = true;
      $('#retentionWorkspace').hidden = true;
    }
    async function setOrganization(next) {
      const normalized = next?.id ? { ...next } : null;
      if (writing) { pendingOrganization = normalized; revision += 1; return { ok: false, optional: true, pending: true }; }
      if (!normalized || !['owner', 'admin'].includes(normalized.current_role)) { reset(); return { ok: false, optional: true }; }
      organization = normalized; pendingOrganization = undefined; return load();
    }
    async function load() {
      if (writing) return { ok: false, optional: true, pending: true };
      const userId = getCurrentUser()?.id, generation = getSessionGeneration(), organizationId = organization?.id, request = ++revision;
      if (!userId || !organizationId) { reset(); return { ok: false, optional: true }; }
      availability = 'loading'; payload = null;
      $('#retentionPanel').hidden = false; $('#retentionLoading').hidden = false; $('#retentionUnavailable').hidden = true; $('#retentionWorkspace').hidden = true;
      const { data, error } = await db.rpc('get_minuta_retention_workspace', { p_organization: organizationId });
      if (!sessionIsCurrent(userId, generation) || request !== revision || organization?.id !== organizationId) return { ok: false, optional: true, stale: true };
      $('#retentionLoading').hidden = true;
      if (error) {
        availability = unsupported(error) ? 'unsupported' : 'error';
        if (availability === 'unsupported') { $('#retentionPanel').hidden = true; return { ok: false, optional: true, unsupported: true }; }
        $('#retentionUnavailable').hidden = false; $('#retentionUnavailableText').textContent = 'Записи и контакты клиентов продолжают работать. Не удалось загрузить только возврат клиентов.';
        return { ok: false, optional: true };
      }
      if (!scopeMatches(data, organizationId)) {
        availability = 'error'; $('#retentionUnavailable').hidden = false; $('#retentionUnavailableText').textContent = 'Сервер вернул данные другой организации. Изменения заблокированы.';
        return { ok: false, optional: true, scopeMismatch: true };
      }
      payload = { ...data, clients: Array.isArray(data.clients) ? data.clients : [], deliveries: Array.isArray(data.deliveries) ? data.deliveries : [], audit: Array.isArray(data.audit) ? data.audit : [] };
      availability = 'ready'; render(); return { ok: true, optional: true };
    }
    function clientById(id) { return payload?.clients.find(client => String(client.client_account_id) === String(id)); }
    function clientCard(client) {
      const consent = client.consent_status === 'granted' ? 'Разрешено' : client.consent_status === 'revoked' ? 'Запрещено' : 'Не указано';
      const action = client.eligible
        ? `<button class="primary compact-button" type="button" data-retention-prepare="${escapeHtml(client.client_account_id)}" data-retention-write>Подготовить сообщение</button>`
        : '';
      return `<article class="organization-row retention-client-row"><div class="organization-row-main"><strong>${escapeHtml(client.client_name || 'Клиент')}</strong><small>${escapeHtml(client.client_phone || '')} · последний визит ${escapeHtml(formatDate(client.last_visit_on))} · завершено ${Number(client.completed_visits || 0)}</small><small>Рассылки: ${escapeHtml(consent)}${client.last_sent_at ? ` · отправлено ${escapeHtml(formatDateTime(client.last_sent_at))}` : ''}</small></div><span class="retention-row-actions"><select data-retention-consent="${escapeHtml(client.client_account_id)}" aria-label="Согласие на сообщения"><option value="unknown" ${client.consent_status === 'unknown' ? 'selected' : ''}>Не указано</option><option value="granted" ${client.consent_status === 'granted' ? 'selected' : ''}>Разрешено</option><option value="revoked" ${client.consent_status === 'revoked' ? 'selected' : ''}>Запрещено</option></select>${action}</span></article>`;
    }
    function deliveryCard(delivery) {
      const client = clientById(delivery.client_account_id) || {};
      const status = { prepared: 'Готово к отправке', sent: 'Отправлено', cancelled: 'Отменено', failed: 'Ошибка' }[delivery.status] || delivery.status;
      const actions = delivery.status === 'prepared' ? `<a class="secondary-button" href="${escapeHtml(whatsappUrl(client.client_phone, delivery.message_snapshot))}" target="_blank" rel="noopener noreferrer">Открыть WhatsApp</a><button class="primary compact-button" type="button" data-retention-finish="${escapeHtml(delivery.id)}" data-retention-action="sent" data-retention-write>Отметить отправленным</button><button class="danger-button" type="button" data-retention-finish="${escapeHtml(delivery.id)}" data-retention-action="cancelled" data-retention-write>Отменить</button>` : '';
      return `<article class="organization-row retention-delivery-row"><div class="organization-row-main"><strong>${escapeHtml(client.client_name || 'Клиент')} · ${escapeHtml(status)}</strong><small>${escapeHtml(delivery.message_snapshot)}</small><small>${escapeHtml(formatDateTime(delivery.prepared_at))}</small></div><span class="retention-row-actions">${actions}</span></article>`;
    }
    function render() {
      if (!payload || availability !== 'ready') return;
      $('#retentionWorkspace').hidden = false;
      $('#retentionEnabled').checked = Boolean(payload.enabled);
      $('#retentionInactivityDays').value = Number(payload.inactivity_days || 45);
      $('#retentionCooldownDays').value = Number(payload.cooldown_days || 90);
      $('#retentionMessageTemplate').value = payload.message_template || defaultTemplate;
      const eligible = payload.clients.filter(client => client.eligible).length;
      $('#retentionEligibleCount').textContent = String(eligible);
      $('#retentionClientsList').innerHTML = payload.clients.length ? payload.clients.map(clientCard).join('') : empty('Клиентов пока нет', 'После завершённых визитов здесь появятся клиенты.');
      $('#retentionDeliveriesList').innerHTML = payload.deliveries.length ? payload.deliveries.map(deliveryCard).join('') : empty('Сообщений пока нет', 'Система не отправляет сообщения без зафиксированного согласия клиента.');
      applyWriteAvailability?.();
    }
    function messageFor(error) {
      const text = `${error?.message || ''} ${error?.details || ''}`;
      const rows = [
        ['owner_required', 'Включить автоматизацию может только владелец.'],
        ['marketing_consent_required', 'Сначала зафиксируйте согласие клиента на сообщения.'],
        ['client_not_inactive', 'Клиент ещё не достиг выбранного срока без визитов.'],
        ['retention_cooldown_active', 'Повторное сообщение пока заблокировано периодом защиты.'],
        ['retention_already_prepared', 'Для клиента уже подготовлено сообщение.'],
        ['retention_disabled', 'Сначала включите возврат клиентов.'],
        ['invalid_retention_settings', 'Проверьте сроки и оставьте в шаблоне переменную {ссылка}.']
      ];
      return rows.find(([key]) => text.includes(key))?.[1] || 'Изменение не сохранено. Записи клиентов не затронуты.';
    }
    async function mutate(name, args, control, success) {
      if (!requireWrites() || writing || availability !== 'ready' || !scopeMatches(payload, organization?.id)) return false;
      const userId = getCurrentUser()?.id, generation = getSessionGeneration(), organizationId = organization.id;
      writing = true; setBusy(true); if (control) control.disabled = true;
      const { data, error } = await db.rpc(name, args);
      const stale = !sessionIsCurrent(userId, generation) || organization?.id !== organizationId;
      writing = false; setBusy(false);
      if (stale) { const next = pendingOrganization; pendingOrganization = undefined; if (next !== undefined) await setOrganization(next); return false; }
      if (error) { notify(messageFor(error)); await load(); return false; }
      if (!scopeMatches(data, organizationId)) { notify('Ответ другой организации заблокирован.'); await load(); return false; }
      notify(success); await load(); return true;
    }
    async function handleSubmit(event) {
      if (event.target.id !== 'retentionSettingsForm') return;
      event.preventDefault();
      await mutate('save_minuta_retention_settings', {
        p_organization: organization.id,
        p_enabled: $('#retentionEnabled').checked,
        p_inactivity_days: Number($('#retentionInactivityDays').value),
        p_cooldown_days: Number($('#retentionCooldownDays').value),
        p_message_template: $('#retentionMessageTemplate').value.trim()
      }, event.submitter, 'Настройки возврата клиентов сохранены');
    }
    async function handleChange(event) {
      const account = event.target.dataset.retentionConsent;
      if (!account || event.target.value === 'unknown') { if (account) await load(); return; }
      const label = event.target.value === 'granted' ? 'Подтвердите, что клиент явно согласился получать предложения.' : 'Запретить сообщения этому клиенту?';
      if (!confirm(label)) { await load(); return; }
      await mutate('set_minuta_marketing_consent', { p_organization: organization.id, p_client_account: account, p_status: event.target.value, p_note: null }, event.target, 'Согласие клиента обновлено');
    }
    async function handleClick(event) {
      if (event.target.closest('#reloadRetention')) { await load(); return; }
      const prepare = event.target.closest('[data-retention-prepare]');
      if (prepare) { await mutate('prepare_minuta_retention_delivery', { p_organization: organization.id, p_client_account: prepare.dataset.retentionPrepare, p_channel: 'whatsapp' }, prepare, 'Сообщение подготовлено'); return; }
      const finish = event.target.closest('[data-retention-finish]');
      if (finish) await mutate('finish_minuta_retention_delivery', { p_organization: organization.id, p_delivery: finish.dataset.retentionFinish, p_action: finish.dataset.retentionAction }, finish, finish.dataset.retentionAction === 'sent' ? 'Отправка отмечена' : 'Сообщение отменено');
    }
    function bind() {
      $('#retentionPanel')?.addEventListener('submit', handleSubmit);
      $('#retentionPanel')?.addEventListener('change', handleChange);
      $('#retentionPanel')?.addEventListener('click', handleClick);
    }
    return { bind, load, reset, setOrganization, get availability() { return availability; }, get payload() { return payload; } };
  }

  window.MinutaRetention = { createController };
})();
