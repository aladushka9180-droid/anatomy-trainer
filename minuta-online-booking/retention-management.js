(function () {
  'use strict';

  const defaultTemplate = 'Здравствуйте, {имя}! Это {организация}. Выбрать время и записаться: {ссылка}';

  function createController(options) {
    const { db, escapeHtml, notify, requireWrites, getCurrentUser, getSessionGeneration, sessionIsCurrent, applyWriteAvailability } = options;
    const requestConfirmation = options.requestConfirmation || (settings => Promise.resolve(window.confirm(settings.message)));
    const select = options.$;
    function $(selector) { return select(selector); }
    let organization = null;
    let payload = null;
    let availability = null;
    let revision = 0;
    let writing = false;
    let pendingOrganization;
    let settingsSaveTimer = null;
    let reviewingEnable = false;
    let scopeRevision = 0;
    let activeWrite = null;
    let pendingSession = null;
    let bound = false;
    const selectedClients = new Set();
    const acknowledged = new Map();
    let retainedScope = null;
    const copying = new Map();

    async function rpc(name, args) {
      try { return await db.rpc(name, args) || { error: new Error('empty_rpc_response') }; }
      catch (error) { return { error: error || new Error('rpc_failed') }; }
    }
    function scopeSnapshot() {
      return { id: organization?.id, role: organization?.current_role, userId: getCurrentUser()?.id, generation: getSessionGeneration(), revision: scopeRevision };
    }
    function scopeIsCurrent(scope) {
      return Boolean(scope.id && organization?.id === scope.id && organization?.current_role === scope.role
        && ['owner', 'admin'].includes(scope.role) && scopeRevision === scope.revision
        && getCurrentUser()?.id === scope.userId && getSessionGeneration() === scope.generation
        && sessionIsCurrent(scope.userId, scope.generation));
    }
    function retainForScope(next = scopeSnapshot()) {
      if (!retainedScope || ['id', 'role', 'userId', 'generation'].some(key => retainedScope[key] !== next[key])) {
        selectedClients.clear(); acknowledged.clear(); copying.clear();
        for (const selector of ['#retentionClientsList', '#retentionDeliveriesList', '#retentionSelectionToolbar']) {
          const node = $(selector); if (node) node.innerHTML = '';
        }
      }
      retainedScope = next;
    }
    function retainedScopeIsCurrent() {
      const current = scopeSnapshot();
      return retainedScope && ['id', 'role', 'userId', 'generation'].every(key => retainedScope[key] === current[key]) && scopeIsCurrent(current);
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
    function record(value) { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
    function text(value) { return typeof value === 'string' && value.length > 0; }
    function nullableText(value) { return value === null || typeof value === 'string'; }
    function normalizeWorkspace(data) {
      // Tenant and role are never inferred. Older deployed RPCs can omit newly
      // added optional collections/columns; normalize those only to values that
      // cannot make a client eligible or confirm a delivery.
      if (!record(data) || !text(data.organization_id) || !['owner', 'admin'].includes(data.current_role)) return null;
      if (data.clients != null && !Array.isArray(data.clients)) return null;
      if (data.deliveries != null && !Array.isArray(data.deliveries)) return null;
      if (data.audit != null && !Array.isArray(data.audit)) return null;
      const boundedDays = (value, fallback) => {
        const number = Number(value);
        return Number.isInteger(number) && number >= 7 && number <= 730 ? number : fallback;
      };
      if ((data.clients || []).some(client => !record(client) || !text(client.client_account_id))) return null;
      const clients = (data.clients || []).map(client => {
        const visits = Number(client.completed_visits);
        return { ...client,
          client_name:typeof client.client_name === 'string' ? client.client_name : '',
          client_phone:typeof client.client_phone === 'string' ? client.client_phone : '',
          last_visit_on:typeof client.last_visit_on === 'string' ? client.last_visit_on : null,
          last_sent_at:typeof client.last_sent_at === 'string' ? client.last_sent_at : null,
          completed_visits:Number.isInteger(visits) && visits >= 0 ? visits : 0,
          consent_status:['granted', 'revoked'].includes(client.consent_status) ? client.consent_status : 'unknown',
          eligible:client.eligible === true && client.consent_status === 'granted'
        };
      });
      if ((data.deliveries || []).some(delivery => !record(delivery) || !text(delivery.id) || !text(delivery.client_account_id)
        || !['prepared', 'sent', 'cancelled', 'failed'].includes(delivery.status))) return null;
      const deliveries = (data.deliveries || []).map(delivery => {
        return { ...delivery,
          message_snapshot:typeof delivery.message_snapshot === 'string' ? delivery.message_snapshot : '',
          prepared_at:typeof delivery.prepared_at === 'string' ? delivery.prepared_at : '',
          sent_at:typeof delivery.sent_at === 'string' ? delivery.sent_at : null
        };
      });
      const validAuditId = value => (Number.isSafeInteger(value) && value > 0)
        || (typeof value === 'string' && /^[1-9][0-9]*$/.test(value));
      if ((data.audit || []).some(entry => !record(entry)
        || !validAuditId(entry.id) || !text(entry.action) || !nullableText(entry.subject_id) || !text(entry.created_at))) return null;
      const audit = (data.audit || []).map(entry => ({ ...entry, id:String(entry.id) }));
      return { ...data,
        enabled:typeof data.enabled === 'boolean' ? data.enabled : false,
        inactivity_days:boundedDays(data.inactivity_days, 45),
        cooldown_days:boundedDays(data.cooldown_days, 90),
        message_template:typeof data.message_template === 'string' && data.message_template.length ? data.message_template : defaultTemplate,
        clients, deliveries, audit
      };
    }
    function workspaceIsValid(data) {
      return Boolean(normalizeWorkspace(data));
    }
    function mutationIsValid(name, data, args) {
      if (!record(data)) return false;
      if (name === 'save_minuta_retention_settings') return typeof data.enabled === 'boolean' && data.enabled === args.p_enabled;
      if (name === 'set_minuta_marketing_consent') return data.client_account_id === args.p_client_account && data.status === args.p_status;
      if (name === 'prepare_minuta_retention_delivery') return text(data.id) && typeof data.client_phone === 'string'
        && text(data.message) && data.status === 'prepared';
      if (name === 'finish_minuta_retention_delivery') return data.id === args.p_delivery && data.status === args.p_action;
      return false;
    }
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
      selectedClients.clear(); acknowledged.clear(); copying.clear(); retainedScope = null;
      clearTimeout(settingsSaveTimer); settingsSaveTimer = null;
      reviewingEnable = false;
      revision += 1; scopeRevision += 1; organization = null; writing = false; activeWrite = null; pendingOrganization = undefined; pendingSession = null;
      setBusy(false); hideWorkspace();
    }
    async function setOrganization(next) {
      const normalized = next?.id ? { ...next } : null;
      retainForScope({ id:normalized?.id, role:normalized?.current_role, userId:getCurrentUser()?.id, generation:getSessionGeneration() });
      clearTimeout(settingsSaveTimer); settingsSaveTimer = null;
      reviewingEnable = false;
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
      retainForScope();
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
        renderAcknowledged();
        return { ok: false, optional: true };
      }
      if (!scopeMatches(data, organizationId)) {
        availability = 'error'; $('#retentionUnavailable').hidden = false; $('#retentionUnavailableText').textContent = 'Сервер вернул данные другой организации. Изменения заблокированы.';
        renderAcknowledged();
        return { ok: false, optional: true, scopeMismatch: true };
      }
      const normalized = normalizeWorkspace(data);
      if (!normalized || !workspaceIsValid(normalized)) {
        if (record(data) && data.current_role && !['owner', 'admin'].includes(data.current_role)) {
          selectedClients.clear(); acknowledged.clear(); copying.clear();
        }
        availability = 'error'; $('#retentionUnavailable').hidden = false;
        $('#retentionUnavailableText').textContent = 'Сервер вернул неполные данные возврата клиентов. Обновите раздел; изменения заблокированы.';
        renderAcknowledged();
        return { ok: false, optional: true, malformed: true };
      }
      payload = normalized;
      if (organization.current_role !== normalized.current_role) {
        organization.current_role = normalized.current_role; retainForScope();
      }
      acknowledged.clear();
      pruneSelection();
      availability = 'ready'; render(); return { ok: true, optional: true };
    }
    // A read-only projection tied to the same actor/role/session as this workspace.
    function readOnlySnapshot() {
      if (availability !== 'ready' || !retainedScopeIsCurrent()) return null;
      const current = scopeSnapshot();
      if (!scopeMatches(payload, current.id) || payload.current_role !== current.role) return null;
      return { scope:{ organization:current.id, role:current.role, userId:current.userId,
        session:current.generation, revision }, clients:payload.clients.map(client => ({
          client_account_id:client.client_account_id, client_name:client.client_name,
          last_visit_on:client.last_visit_on, completed_visits:client.completed_visits,
          eligible:client.eligible, consent_status:client.consent_status
        })) };
    }
    function clientById(id) { return payload?.clients.find(client => String(client.client_account_id) === String(id)); }
    function preparedFor(id) {
      return payload?.deliveries.some(row => row.status === 'prepared' && row.client_account_id === id)
        || [...acknowledged.values()].some(row => row.client_account_id === id);
    }
    function selectableClients() { return payload?.clients.filter(client => client.eligible && !preparedFor(client.client_account_id)) || []; }
    function pruneSelection() {
      const available = new Set(selectableClients().map(client => client.client_account_id));
      for (const id of selectedClients) if (!available.has(id)) selectedClients.delete(id);
    }
    function plural(count, one, few, many) {
      return count % 10 === 1 && count % 100 !== 11 ? one : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? few : many;
    }
    function icon(name) {
      // Same contour glyphs as ui-icons.svg, inline for this optional lazy panel.
      const paths = {
        settings:'<circle cx="12" cy="12" r="3"/><path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/>',
        users:'<circle cx="9" cy="8" r="3"/><path d="M3.5 19c.5-3.6 2.3-5.4 5.5-5.4s5 1.8 5.5 5.4M15 5.5a3 3 0 0 1 0 5.8m1.3 2.5c2.4.5 3.8 2.2 4.2 5.2"/>',
        list:'<path d="M9 6h11M9 12h11M9 18h11M4 6h.1M4 12h.1M4 18h.1"/>',
        check:'<path d="m5 12.5 4.2 4.2L19 7"/>'
      };
      return `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
    }
    function reasonFor(client) {
      if (client.consent_status !== 'granted') return 'Нужно согласие на сообщения';
      if (!client.last_visit_on) return 'Завершённых визитов нет';
      if (!payload?.enabled) return 'Подбор выключен';
      if (client.last_sent_at && Date.parse(client.last_sent_at) > Date.now() - payload.cooldown_days * 86400000) return 'Повторное предложение пока недоступно';
      return 'Срок после визита ещё не наступил';
    }
    function clientCard(client) {
      const id = client.client_account_id, prepared = preparedFor(id), available = client.eligible && !prepared;
      const action = available ? `<input type="checkbox" data-retention-select="${escapeHtml(id)}" data-retention-write aria-label="Выбрать ${escapeHtml(client.client_name || 'клиента')}" ${selectedClients.has(id) ? 'checked' : ''}>` : '<span class="retention-check-placeholder" aria-hidden="true"></span>';
      const status = prepared ? `${icon('check')}Текст готов` : available ? selectedClients.has(id) ? 'Выбран' : 'Можно выбрать' : escapeHtml(reasonFor(client));
      const visits = client.last_visit_on
        ? `Последний визит ${formatDate(client.last_visit_on)} · завершено ${Number(client.completed_visits || 0)}`
        : 'Завершённых визитов нет';
      return `<article class="organization-row retention-client-row">${action}<div class="organization-row-main"><strong>${escapeHtml(client.client_name || 'Клиент')}</strong><small>${client.client_phone ? `${escapeHtml(client.client_phone)} · ` : ''}${escapeHtml(visits)}</small>${client.last_sent_at ? `<small>Последняя ручная отметка отправки: ${escapeHtml(formatDateTime(client.last_sent_at))}</small>` : ''}</div><span class="retention-client-status">${status}</span><details class="retention-client-options"><summary>Согласие</summary><label class="retention-consent-field"><span>Согласие на сообщения</span><select data-retention-consent="${escapeHtml(id)}" data-retention-write aria-label="Согласие на сообщения для ${escapeHtml(client.client_name || 'клиента')}"><option value="unknown" ${client.consent_status === 'unknown' ? 'selected' : ''}>Согласие не указано</option><option value="granted" ${client.consent_status === 'granted' ? 'selected' : ''}>Клиент согласен</option><option value="revoked" ${client.consent_status === 'revoked' ? 'selected' : ''}>Клиент отказался</option></select></label></details></article>`;
    }
    function deliveryCard(delivery, fallback = false) {
      const client = clientById(delivery.client_account_id) || delivery;
      const status = { prepared: 'Подготовлено · не отправлено', sent: 'Отмечено отправленным вручную', cancelled: 'Отменено', failed: 'Ошибка' }[delivery.status] || delivery.status;
      const actions = !fallback && delivery.status === 'prepared' ? `<details class="retention-delivery-options"><summary>Ещё</summary><div class="retention-row-actions"><a class="secondary-button" href="${escapeHtml(whatsappUrl(client.client_phone, delivery.message_snapshot))}" target="_blank" rel="noopener noreferrer">Открыть WhatsApp и отправить</a><button class="secondary-button compact-button" type="button" data-retention-finish="${escapeHtml(delivery.id)}" data-retention-action="sent" data-retention-write>Я отправил · отметить</button><button class="danger-button" type="button" data-retention-finish="${escapeHtml(delivery.id)}" data-retention-action="cancelled" data-retention-write>Отменить</button></div></details>` : '';
      const copy = text(delivery.message_snapshot) ? `<button class="secondary-button retention-copy" type="button" data-retention-copy="${escapeHtml(delivery.id)}">Скопировать текст</button><small class="retention-copy-status" role="status" aria-live="polite"></small>` : '';
      return `<article class="organization-row retention-delivery-row"><div class="organization-row-main"><strong>${escapeHtml(client.client_name || 'Клиент')}</strong><small>${escapeHtml(status)}</small>${delivery.prepared_at ? `<small>${escapeHtml(formatDateTime(delivery.prepared_at))}</small>` : ''}</div><p class="retention-message-snapshot">${escapeHtml(delivery.message_snapshot)}</p><div class="retention-copy-actions">${copy}${actions}</div></article>`;
    }
    function render() {
      if (!payload || availability !== 'ready') return;
      $('#retentionWorkspace').hidden = false;
      $('#retentionSettingsForm').hidden = false;
      const clientsSection = $('#retentionClientsList').closest('.retention-list-section');
      if (clientsSection) clientsSection.hidden = false;
      $('#retentionEnabled').checked = Boolean(payload.enabled);
      $('#retentionInactivityDays').value = Number(payload.inactivity_days || 45);
      $('#retentionCooldownDays').value = Number(payload.cooldown_days || 90);
      $('#retentionMessageTemplate').value = payload.message_template || defaultTemplate;
      const owner = payload.current_role === 'owner';
      const enabled = Boolean(payload.enabled);
      $('#retentionEnabled').disabled = !owner && !enabled;
      ['#retentionInactivityDays', '#retentionCooldownDays', '#retentionMessageTemplate'].forEach(selector => { $(selector).disabled = !owner && enabled; });
      const eligible = payload.clients.filter(client => client.eligible).length;
      $('#retentionEligibleCount').textContent = String(eligible);
      $('#retentionEligibleCount').hidden = eligible === 0;
      const saveStatus = $('#retentionSaveStatus');
      if (saveStatus) saveStatus.textContent = owner
        ? 'Изменения сохраняются автоматически'
        : enabled
          ? 'Включённую программу может настраивать только владелец; администратор может её выключить'
          : 'Администратор может настроить выключенную программу; включить её может только владелец';
      $('#retentionDeliveriesList').innerHTML = payload.deliveries.length ? payload.deliveries.map(row => deliveryCard(row)).join('') : empty('Сообщений пока нет', 'Сообщения не отправляются автоматически. Отправка — вручную; Eldion Pro не подтверждает доставку.');
      window.MinutaCommerceSoftUI?.syncRetention(organization?.name || '');
      enhanceLayout();
      renderClients();
    }
    function renderClients() {
      $('#retentionClientsList').innerHTML = payload.clients.length ? payload.clients.map(clientCard).join('') : empty('Клиентов пока нет', 'После завершённых визитов здесь появятся клиенты.');
      const available = selectableClients(), count = selectedClients.size;
      const toolbar = $('#retentionSelectionToolbar');
      if (toolbar) {
        toolbar.innerHTML = `<label class="retention-select-all"><input type="checkbox" data-retention-select-all data-retention-write ${!available.length ? 'disabled' : ''} ${count && count === available.length ? 'checked' : ''}>Выбрать доступных</label><span class="retention-selected-count" role="status" aria-live="polite">${count ? `${plural(count, 'Выбран', 'Выбрано', 'Выбрано')} ${count} ${plural(count, 'клиент', 'клиента', 'клиентов')}` : available.length ? 'Выберите клиентов для подготовки' : 'Подходящих клиентов для подготовки пока нет'}</span><button type="button" class="primary" data-retention-prepare-selected data-retention-write ${!count ? 'disabled' : ''}>${count ? `Подготовить ${count} ${plural(count, 'сообщение', 'сообщения', 'сообщений')}` : 'Подготовить сообщения'}</button><small class="retention-preparation-note">Подготовка не отправляет сообщения.</small>`;
        const all = toolbar.querySelector('[data-retention-select-all]');
        if (all) all.indeterminate = count > 0 && count < available.length;
      }
      if ($('#retentionClientsCount')) $('#retentionClientsCount').textContent = String(payload.clients.length);
      applyWriteAvailability?.();
    }
    function enhanceLayout() {
      // The controller owns this panel only; shared commerce presentation stays unchanged.
      if (typeof document === 'undefined') return;
      const form = $('#retentionSettingsForm');
      if (!$('#retentionSettingsHeading')) form.insertAdjacentHTML('afterbegin', `<div class="resource-subhead retention-settings-heading" id="retentionSettingsHeading"><strong>${icon('settings')}Настройки подбора</strong></div>`);
      for (const [listId, title, iconName, countId] of [['retentionClientsList', 'Клиенты после перерыва', 'users', 'retentionClientsCount'], ['retentionDeliveriesList', 'Подготовленные сообщения', 'list', 'retentionPreparedCount']]) {
        const section = $(`#${listId}`).closest('.retention-list-section');
        const heading = section?.querySelector('.resource-subhead');
        if (heading && !heading.dataset.retentionHeading) {
          heading.dataset.retentionHeading = 'true';
          heading.innerHTML = `<strong>${icon(iconName)}${title}<span class="panel-count" id="${countId}">0</span></strong>`;
        }
      }
      if (!$('#retentionSelectionToolbar')) $('#retentionClientsList').insertAdjacentHTML('afterend', '<div class="retention-selection-toolbar" id="retentionSelectionToolbar"></div>');
      const labels = form.querySelectorAll('.retention-number-field');
      for (const [index, label, hint] of [[0, 'После последнего завершённого визита', 'Минимальный перерыв после завершённого визита.'], [1, 'Повторное предложение одному клиенту', 'От последней ручной отметки отправки, а не подготовки текста.']]) {
        const field = labels[index];
        if (!field) continue;
        field.querySelector('strong').textContent = label;
        const wrap = field.querySelector('strong').parentElement;
        wrap.querySelectorAll('small').forEach(node => node.remove());
        const small = document.createElement('small'); small.textContent = hint; wrap.append(small);
      }
      const preview = $('#retentionMessagePreview');
      if (preview && !preview.dataset.retentionInitialized) {
        preview.dataset.retentionInitialized = 'true';
        if (window.matchMedia('(min-width:1000px)').matches) {
          preview.hidden = false; form.classList.add('cs-preview-open');
          form.querySelector('.cs-preview-toggle')?.setAttribute('aria-expanded', 'true');
        }
      }
      if ($('#retentionPreparedCount')) $('#retentionPreparedCount').textContent = String(payload?.deliveries.filter(row => row.status === 'prepared').length || acknowledged.size);
    }
    function renderAcknowledged() {
      if (!acknowledged.size || !retainedScopeIsCurrent()) return;
      $('#retentionWorkspace').hidden = false;
      $('#retentionSettingsForm').hidden = true;
      const clientsSection = $('#retentionClientsList').closest('.retention-list-section');
      if (clientsSection) clientsSection.hidden = true;
      $('#retentionDeliveriesList').innerHTML = `<p class="retention-fallback-note">Сервер подтвердил эти тексты. Остальные данные недоступны — обновите раздел перед следующей подготовкой.</p>${[...acknowledged.values()].map(row => deliveryCard(row, true)).join('')}`;
      if ($('#retentionPreparedCount')) $('#retentionPreparedCount').textContent = String(acknowledged.size);
    }
    function messageFor(error) {
      const text = `${error?.message || ''} ${error?.details || ''}`;
      const rows = [
        ['owner_required', 'Включить подбор клиентов может только владелец.'],
        ['marketing_consent_required', 'Сначала зафиксируйте согласие клиента на сообщения.'],
        ['client_not_inactive', 'Клиент ещё не достиг выбранного срока без визитов.'],
        ['retention_cooldown_active', 'Повторное предложение доступно после заданного интервала.'],
        ['retention_already_prepared', 'Для клиента уже подготовлено сообщение.'],
        ['retention_disabled', 'Сначала включите подбор клиентов.'],
        ['invalid_retention_settings', 'Проверьте сроки и оставьте в шаблоне переменную {ссылка}.']
      ];
      return rows.find(([key]) => text.includes(key))?.[1] || 'Не удалось подтвердить результат. Проверьте актуальные данные перед повтором.';
    }
    async function runMutations(commands, control, success, silent = false, reloadAfter = true) {
      if (!requireWrites() || writing || availability !== 'ready' || !scopeMatches(payload, organization?.id)) return false;
      if (!retainedScopeIsCurrent()) { retainForScope(); hideWorkspace(); return false; }
      const scope = scopeSnapshot(), organizationId = organization.id, request = ++revision, token = {};
      if (!scopeIsCurrent(scope) || payload.current_role !== scope.role || !commands.length) return false;
      const originallyDisabled = control?.disabled;
      activeWrite = token;
      writing = true; setBusy(true); if (control) control.disabled = true;
      let failure = null;
      for (const { name, args } of commands) {
        if (activeWrite !== token || !scopeIsCurrent(scope) || request !== revision || pendingOrganization !== undefined) break;
        if (!requireWrites() || !scopeMatches(payload, organizationId) || payload.current_role !== scope.role || args.p_organization !== organizationId) {
          failure = 'Доступ изменился. Обновите раздел перед повтором.'; break;
        }
        if (name === 'prepare_minuta_retention_delivery' && (!clientById(args.p_client_account)?.eligible || preparedFor(args.p_client_account))) {
          failure = 'Клиент уже имеет текст или больше недоступен для подготовки.'; break;
        }
        if (!scopeIsCurrent(scope) || request !== revision || pendingOrganization !== undefined) break;
        const { data, error } = await rpc(name, args);
        if (activeWrite !== token || !scopeIsCurrent(scope) || request !== revision || pendingOrganization !== undefined) break;
        if (error || !scopeMatches(data, organizationId) || !mutationIsValid(name, data, args)) {
          failure = error ? messageFor(error) : !scopeMatches(data, organizationId)
            ? 'Ответ другой организации заблокирован.'
            : 'Не удалось подтвердить результат. Проверьте актуальные данные перед повтором.';
          break;
        }
        if (name === 'prepare_minuta_retention_delivery') {
          const client = clientById(args.p_client_account);
          acknowledged.set(data.id, { id:data.id, client_account_id:args.p_client_account, status:data.status,
            message_snapshot:data.message, client_phone:data.client_phone, client_name:client?.client_name || '' });
          selectedClients.delete(args.p_client_account);
        }
      }
      if (activeWrite !== token) return false;
      const stale = !scopeIsCurrent(scope) || request !== revision || pendingOrganization !== undefined;
      activeWrite = null;
      writing = false; setBusy(false);
      if (control) control.disabled = originallyDisabled;
      if (stale) {
        const next = pendingOrganization, nextSession = pendingSession;
        pendingOrganization = undefined; pendingSession = null;
        if (next !== undefined && nextSession && sessionIsCurrent(nextSession.userId, nextSession.generation)) await setOrganization(next);
        else if (!scopeIsCurrent(scope)) { retainForScope(); hideWorkspace(); }
        return false;
      }
      if (failure) {
        const confirmedCount = acknowledged.size;
        await load();
        if (scopeIsCurrent(scope)) notify(`${confirmedCount ? `Подтверждено ${confirmedCount} ${plural(confirmedCount, 'текст', 'текста', 'текстов')}. Подготовка остановлена. ` : ''}${failure}`);
        return false;
      }
      if (reloadAfter) await load();
      if (!silent && scopeIsCurrent(scope)) notify(success);
      return true;
    }
    function mutate(name, args, control, success, silent = false, reloadAfter = true) {
      return runMutations([{ name, args }], control, success, silent, reloadAfter);
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
      if (saveStatus) saveStatus.textContent = saved ? 'Сохранено автоматически' : 'Не удалось подтвердить результат — проверьте актуальные данные перед повтором';
      return saved;
    }
    function scheduleSettingsSave() {
      clearTimeout(settingsSaveTimer);
      if (!organization?.id || writing || reviewingEnable || availability !== 'ready') return;
      const saveStatus = $('#retentionSaveStatus');
      if (saveStatus) saveStatus.textContent = 'Ожидает сохранения…';
      settingsSaveTimer = setTimeout(() => saveSettings(), 500);
    }
    function handleInput(event) {
      if (!event.target.closest('#retentionSettingsForm')) return;
      if (!organization?.id || writing || availability !== 'ready') return;
      if (event.target.id === 'retentionEnabled' && event.target.checked && !payload?.enabled) {
        clearTimeout(settingsSaveTimer);
        return;
      }
      if (reviewingEnable) return;
      const form = $('#retentionSettingsForm');
      if (!form?.checkValidity()) { clearTimeout(settingsSaveTimer); if ($('#retentionSaveStatus')) $('#retentionSaveStatus').textContent = 'Проверьте заполнение полей'; return; }
      if (!$('#retentionMessageTemplate').value.includes('{ссылка}')) { clearTimeout(settingsSaveTimer); if ($('#retentionSaveStatus')) $('#retentionSaveStatus').textContent = 'Добавьте в сообщение переменную {ссылка}'; return; }
      scheduleSettingsSave();
    }
    async function handleSubmit(event) {
      if (event.target.id !== 'retentionSettingsForm') return;
      event.preventDefault();
      if (reviewingEnable || ($('#retentionEnabled').checked && !payload?.enabled)) return;
      clearTimeout(settingsSaveTimer);
      await saveSettings();
    }
    function otherSettingsChanged() {
      return Number($('#retentionInactivityDays').value) !== payload?.inactivity_days
        || Number($('#retentionCooldownDays').value) !== payload?.cooldown_days
        || $('#retentionMessageTemplate').value.trim() !== payload?.message_template;
    }
    async function handleChange(event) {
      if (!organization?.id || writing || availability !== 'ready') return;
      if (!scopeIsCurrent(scopeSnapshot()) || !retainedScopeIsCurrent()) return;
      if (event.target.dataset.retentionSelect !== undefined || event.target.dataset.retentionSelectAll !== undefined) {
        const available = selectableClients().map(client => client.client_account_id);
        const ids = event.target.dataset.retentionSelectAll !== undefined ? available : [event.target.dataset.retentionSelect];
        for (const id of ids) if (available.includes(id)) {
          if (event.target.checked) selectedClients.add(id); else selectedClients.delete(id);
        }
        renderClients();
        const controls = $('#retentionPanel').querySelectorAll('[data-retention-select], [data-retention-select-all]');
        [...controls].find(control => event.target.dataset.retentionSelectAll !== undefined
          ? control.dataset.retentionSelectAll !== undefined : control.dataset.retentionSelect === event.target.dataset.retentionSelect)?.focus();
        return;
      }
      if (event.target.closest('#retentionSettingsForm')) {
        if (reviewingEnable) return;
        if (event.target.id === 'retentionEnabled' && event.target.checked && !payload?.enabled) {
          clearTimeout(settingsSaveTimer);
          const form = $('#retentionSettingsForm');
          if (!form?.reportValidity() || !$('#retentionMessageTemplate').value.includes('{ссылка}')) {
            event.target.checked = false;
            $('#retentionSaveStatus').textContent = 'Проверьте сроки и переменную {ссылка} в шаблоне';
            return;
          }
          const scope = scopeSnapshot();
          const inactivity = Number($('#retentionInactivityDays').value);
          const cooldown = Number($('#retentionCooldownDays').value);
          const template = $('#retentionMessageTemplate').value;
          reviewingEnable = true;
          const confirmationDialog = $('#providerConfirmDialog');
          confirmationDialog?.classList.add('retention-enable-review');
          let confirmed = false;
          try {
            confirmed = await requestConfirmation({
              title:'Включить подбор клиентов?',
              message:`Клиент попадёт в список после ${inactivity} дней от последнего завершённого визита. Повторное предложение — не раньше чем через ${cooldown} дней от последней ручной отметки отправки. Eldion Pro не подтверждает доставку. Сообщения не отправляются автоматически; подготовка и отправка остаются отдельными действиями.`,
              confirmLabel:'Включить', initialFocus:'cancel'
            });
          } catch (_) { confirmed = false; }
          confirmationDialog?.classList.remove('retention-enable-review');
          if (!scopeIsCurrent(scope)) return;
          reviewingEnable = false;
          if (!confirmed || !event.target.checked || Number($('#retentionInactivityDays').value) !== inactivity
            || Number($('#retentionCooldownDays').value) !== cooldown || $('#retentionMessageTemplate').value !== template) {
            event.target.checked = false;
            $('#retentionSaveStatus').textContent = confirmed ? 'Параметры изменились — проверьте их ещё раз' : 'Включение отменено';
            if (otherSettingsChanged()) scheduleSettingsSave();
            return;
          }
          await saveSettings();
          return;
        }
        scheduleSettingsSave();
        return;
      }
      const account = event.target.dataset.retentionConsent;
      if (!account || event.target.value === 'unknown') { if (account) await load(); return; }
      const label = event.target.value === 'granted' ? 'Подтвердите, что клиент явно согласился получать предложения.' : 'Запретить сообщения этому клиенту?';
      if (!confirm(label)) { await load(); return; }
      await mutate('set_minuta_marketing_consent', { p_organization: organization.id, p_client_account: account, p_status: event.target.value, p_note: null }, event.target, 'Согласие клиента обновлено');
    }
    async function handleClick(event) {
      if (event.target.closest('#reloadRetention')) { await load(); return; }
      const copy = event.target.closest('[data-retention-copy]');
      if (copy) { await copySnapshot(copy); return; }
      if (!organization?.id || writing || availability !== 'ready') return;
      const batch = event.target.closest('[data-retention-prepare-selected]');
      if (batch) {
        pruneSelection();
        const ids = [...selectedClients];
        await runMutations(ids.map(id => ({ name:'prepare_minuta_retention_delivery', args:{ p_organization:organization.id, p_client_account:id, p_channel:'whatsapp' } })), batch,
          `Подготовлено ${ids.length} ${plural(ids.length, 'сообщение', 'сообщения', 'сообщений')}. Отправка остаётся ручной.`);
        return;
      }
      const prepare = event.target.closest('[data-retention-prepare]');
      if (prepare) { await mutate('prepare_minuta_retention_delivery', { p_organization: organization.id, p_client_account: prepare.dataset.retentionPrepare, p_channel: 'whatsapp' }, prepare, 'Сообщение подготовлено'); return; }
      const finish = event.target.closest('[data-retention-finish]');
      if (finish) await mutate('finish_minuta_retention_delivery', { p_organization: organization.id, p_delivery: finish.dataset.retentionFinish, p_action: finish.dataset.retentionAction }, finish, finish.dataset.retentionAction === 'sent' ? 'Отмечено вручную; Eldion Pro не подтверждает доставку' : 'Сообщение отменено');
    }
    async function copySnapshot(control) {
      const id = control.dataset.retentionCopy, scope = scopeSnapshot();
      if (!scopeIsCurrent(scope) || !retainedScopeIsCurrent() || copying.has(id)) return;
      const delivery = availability === 'ready' ? payload?.deliveries.find(row => row.id === id)
        : availability === 'error' ? acknowledged.get(id) : null;
      if (!delivery || !text(delivery.message_snapshot)) return;
      const token = {}, status = control.parentElement?.querySelector('.retention-copy-status');
      clearTimeout(control.retentionCopyReset);
      copying.set(id, token); control.disabled = true; control.textContent = 'Копируем…';
      if (status) status.textContent = '';
      try {
        if (!window.navigator?.clipboard?.writeText) throw new Error('clipboard_unavailable');
        await window.navigator.clipboard.writeText(delivery.message_snapshot);
        if (!scopeIsCurrent(scope) || copying.get(id) !== token) return;
        control.textContent = 'Скопировано';
        if (status) status.textContent = 'Текст скопирован. Отправка остаётся ручной.';
        control.retentionCopyReset = setTimeout(() => {
          if (scopeIsCurrent(scope) && control.isConnected !== false) {
            control.textContent = 'Скопировать текст'; if (status) status.textContent = '';
          }
        }, 2500);
      } catch (_) {
        if (!scopeIsCurrent(scope) || copying.get(id) !== token) return;
        control.textContent = 'Повторить копирование';
        if (status) status.textContent = 'Не удалось скопировать текст. Попробуйте ещё раз.';
      } finally {
        if (copying.get(id) === token) copying.delete(id);
        if (scopeIsCurrent(scope) && control.isConnected !== false) control.disabled = false;
      }
    }
    function bind() {
      if (bound) return;
      bound = true;
      $('#retentionPanel')?.addEventListener('submit', handleSubmit);
      $('#retentionPanel')?.addEventListener('input', handleInput);
      $('#retentionPanel')?.addEventListener('change', handleChange);
      $('#retentionPanel')?.addEventListener('click', handleClick);
      if (typeof document !== 'undefined' && document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { if (availability === 'ready') { enhanceLayout(); renderClients(); } }, { once:true });
      }
    }
    return { bind, load, reset, setOrganization, readOnlySnapshot, get availability() { return availability; }, get payload() { return payload; } };
  }

  window.MinutaRetention = { createController };
})();
