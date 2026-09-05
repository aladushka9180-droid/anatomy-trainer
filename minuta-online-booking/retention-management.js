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
    let settingsSaveTimer = null;
    let scopeRevision = 0;
    let activeWrite = null;
    let pendingSession = null;
    let bound = false;

    async function rpc(name, args) {
      try { return await db.rpc(name, args) || { error: new Error('empty_rpc_response') }; }
      catch (error) { return { error: error || new Error('rpc_failed') }; }
    }
    function scopeSnapshot() {
      return { id: organization?.id, userId: getCurrentUser()?.id, generation: getSessionGeneration(), revision: scopeRevision };
    }
    function scopeIsCurrent(scope) {
      return Boolean(scope.id && organization?.id === scope.id && scopeRevision === scope.revision && sessionIsCurrent(scope.userId, scope.generation));
    }
    function hideWorkspace() {
      payload = null; availability = null;
      $('#retentionPanel').hidden = true;
      $('#retentionLoading').hidden = true;
      $('#retentionUnavailable').hidden = true;
      $('#retentionWorkspace').hidden = true;
      $('#retentionClientsList').innerHTML = '';
      $('#retentionDeliveriesList').innerHTML = '';
      if ($('#retentionSaveStatus')) $('#retentionSaveStatus').textContent = '';
    }

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
      clearTimeout(settingsSaveTimer); settingsSaveTimer = null;
      revision += 1; scopeRevision += 1; organization = null; writing = false; activeWrite = null; pendingOrganization = undefined; pendingSession = null;
      setBusy(false); hideWorkspace();
    }
    async function setOrganization(next) {
      const normalized = next?.id ? { ...next } : null;
      clearTimeout(settingsSaveTimer); settingsSaveTimer = null;
      scopeRevision += 1;
      if (writing) {
        pendingOrganization = normalized; pendingSession = { userId: getCurrentUser()?.id, generation: getSessionGeneration() };
        revision += 1; hideWorkspace();
        return { ok: false, optional: true, pending: true };
      }
      if (!normalized || !['owner', 'admin'].includes(normalized.current_role)) { reset(); return { ok: false, optional: true }; }
      organization = normalized; pendingOrganization = undefined; pendingSession = null; return load();
    }
    async function load() {
      if (writing) return { ok: false, optional: true, pending: true };
      const userId = getCurrentUser()?.id, generation = getSessionGeneration(), organizationId = organization?.id, request = ++revision;
      if (!userId || !organizationId) { reset(); return { ok: false, optional: true }; }
      availability = 'loading'; payload = null;
      $('#retentionPanel').hidden = false; $('#retentionLoading').hidden = false; $('#retentionUnavailable').hidden = true; $('#retentionWorkspace').hidden = true;
      const { data, error } = await rpc('get_minuta_retention_workspace', { p_organization: organizationId });
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
      const action = client.eligible
        ? `<button class="primary compact-button" type="button" data-retention-prepare="${escapeHtml(client.client_account_id)}" data-retention-write>Подготовить сообщение</button>`
        : '';
      return `<article class="organization-row retention-client-row"><div class="organization-row-main"><strong>${escapeHtml(client.client_name || 'Клиент')}</strong><small>${escapeHtml(client.client_phone || '')} · последний визит ${escapeHtml(formatDate(client.last_visit_on))} · завершено ${Number(client.completed_visits || 0)}</small>${client.last_sent_at ? `<small>Последнее сообщение: ${escapeHtml(formatDateTime(client.last_sent_at))}</small>` : ''}</div><span class="retention-row-actions"><label class="retention-consent-field"><span>Согласие на сообщения</span><select data-retention-consent="${escapeHtml(client.client_account_id)}" aria-label="Согласие на сообщения для ${escapeHtml(client.client_name || 'клиента')}"><option value="unknown" ${client.consent_status === 'unknown' ? 'selected' : ''}>Не указано</option><option value="granted" ${client.consent_status === 'granted' ? 'selected' : ''}>Разрешено</option><option value="revoked" ${client.consent_status === 'revoked' ? 'selected' : ''}>Запрещено</option></select></label>${action}</span></article>`;
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
      $('#retentionEligibleCount').hidden = eligible === 0;
      const saveStatus = $('#retentionSaveStatus');
      if (saveStatus) saveStatus.textContent = organization?.current_role === 'owner' ? 'Изменения сохраняются автоматически' : 'Настройки может изменять только владелец';
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
    async function mutate(name, args, control, success, silent = false, reloadAfter = true) {
      if (!requireWrites() || writing || availability !== 'ready' || !scopeMatches(payload, organization?.id)) return false;
      const scope = scopeSnapshot(), organizationId = organization.id, request = ++revision, token = {};
      const originallyDisabled = control?.disabled;
      activeWrite = token;
      writing = true; setBusy(true); if (control) control.disabled = true;
      const { data, error } = await rpc(name, args);
      if (activeWrite !== token) return false;
      const stale = !scopeIsCurrent(scope) || request !== revision || pendingOrganization !== undefined;
      activeWrite = null;
      writing = false; setBusy(false);
      if (control) control.disabled = originallyDisabled;
      if (stale) {
        const next = pendingOrganization, nextSession = pendingSession;
        pendingOrganization = undefined; pendingSession = null;
        if (next !== undefined && nextSession && sessionIsCurrent(nextSession.userId, nextSession.generation)) await setOrganization(next);
        else if (!scopeIsCurrent(scope)) hideWorkspace();
        return false;
      }
      if (error) { notify(messageFor(error)); await load(); return false; }
      if (!scopeMatches(data, organizationId)) { notify('Ответ другой организации заблокирован.'); await load(); return false; }
      if (!silent) notify(success);
      if (reloadAfter) await load();
      return true;
    }
    async function saveSettings() {
      if (!organization?.id || writing || availability !== 'ready' || !scopeMatches(payload, organization.id)) return false;
      const scope = scopeSnapshot();
      const form = $('#retentionSettingsForm');
      const saveStatus = $('#retentionSaveStatus');
      if (!form?.reportValidity()) { if (saveStatus) saveStatus.textContent = 'Проверьте заполнение полей'; return false; }
      if (!$('#retentionMessageTemplate').value.includes('{ссылка}')) { if (saveStatus) saveStatus.textContent = 'Добавьте в сообщение переменную {ссылка}'; return false; }
      if (saveStatus) saveStatus.textContent = 'Сохраняем…';
      const parameters = {
        p_organization: organization.id,
        p_enabled: $('#retentionEnabled').checked,
        p_inactivity_days: Number($('#retentionInactivityDays').value),
        p_cooldown_days: Number($('#retentionCooldownDays').value),
        p_message_template: $('#retentionMessageTemplate').value.trim()
      };
      const saved = await mutate('save_minuta_retention_settings', parameters, null, 'Настройки возврата клиентов сохранены', true, false);
      if (!scopeIsCurrent(scope)) return false;
      if (saved && payload) {
        payload.enabled = parameters.p_enabled;
        payload.inactivity_days = parameters.p_inactivity_days;
        payload.cooldown_days = parameters.p_cooldown_days;
        payload.message_template = parameters.p_message_template;
      }
      if (saveStatus) saveStatus.textContent = saved ? 'Сохранено автоматически' : 'Не удалось сохранить — повторите изменение';
      return saved;
    }
    function scheduleSettingsSave() {
      clearTimeout(settingsSaveTimer);
      if (!organization?.id || writing || availability !== 'ready') return;
      const saveStatus = $('#retentionSaveStatus');
      if (saveStatus) saveStatus.textContent = 'Ожидает сохранения…';
      settingsSaveTimer = setTimeout(() => saveSettings(), 500);
    }
    function handleInput(event) {
      if (!event.target.closest('#retentionSettingsForm')) return;
      if (!organization?.id || writing || availability !== 'ready') return;
      const form = $('#retentionSettingsForm');
      if (!form?.checkValidity()) { clearTimeout(settingsSaveTimer); if ($('#retentionSaveStatus')) $('#retentionSaveStatus').textContent = 'Проверьте заполнение полей'; return; }
      if (!$('#retentionMessageTemplate').value.includes('{ссылка}')) { clearTimeout(settingsSaveTimer); if ($('#retentionSaveStatus')) $('#retentionSaveStatus').textContent = 'Добавьте в сообщение переменную {ссылка}'; return; }
      scheduleSettingsSave();
    }
    async function handleSubmit(event) {
      if (event.target.id !== 'retentionSettingsForm') return;
      event.preventDefault();
      clearTimeout(settingsSaveTimer);
      await saveSettings();
    }
    async function handleChange(event) {
      if (!organization?.id || writing || availability !== 'ready') return;
      if (event.target.closest('#retentionSettingsForm')) { scheduleSettingsSave(); return; }
      const account = event.target.dataset.retentionConsent;
      if (!account || event.target.value === 'unknown') { if (account) await load(); return; }
      const label = event.target.value === 'granted' ? 'Подтвердите, что клиент явно согласился получать предложения.' : 'Запретить сообщения этому клиенту?';
      if (!confirm(label)) { await load(); return; }
      await mutate('set_minuta_marketing_consent', { p_organization: organization.id, p_client_account: account, p_status: event.target.value, p_note: null }, event.target, 'Согласие клиента обновлено');
    }
    async function handleClick(event) {
      if (event.target.closest('#reloadRetention')) { await load(); return; }
      if (!organization?.id || writing || availability !== 'ready') return;
      const prepare = event.target.closest('[data-retention-prepare]');
      if (prepare) { await mutate('prepare_minuta_retention_delivery', { p_organization: organization.id, p_client_account: prepare.dataset.retentionPrepare, p_channel: 'whatsapp' }, prepare, 'Сообщение подготовлено'); return; }
      const finish = event.target.closest('[data-retention-finish]');
      if (finish) await mutate('finish_minuta_retention_delivery', { p_organization: organization.id, p_delivery: finish.dataset.retentionFinish, p_action: finish.dataset.retentionAction }, finish, finish.dataset.retentionAction === 'sent' ? 'Отправка отмечена' : 'Сообщение отменено');
    }
    function bind() {
      if (bound) return;
      bound = true;
      $('#retentionPanel')?.addEventListener('submit', handleSubmit);
      $('#retentionPanel')?.addEventListener('input', handleInput);
      $('#retentionPanel')?.addEventListener('change', handleChange);
      $('#retentionPanel')?.addEventListener('click', handleClick);
    }
    return { bind, load, reset, setOrganization, get availability() { return availability; }, get payload() { return payload; } };
  }

  window.MinutaRetention = { createController };
})();
