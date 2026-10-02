(function () {
  'use strict';

  const steps = [
    { name: 'Филиал', title: 'Укажите место приёма', description: 'Добавьте активный филиал с адресом для клиентов.', action: 'Добавить филиал', section: 'organizationPeopleSection', target: 'locationCreator' },
    { name: 'Сотрудник', title: 'Выберите, кто принимает клиентов', description: 'Нужен действующий сотрудник с включённым приёмом клиентов. Приглашение ещё не означает, что он присоединился.', action: 'Настроить сотрудников', section: 'organizationPeopleSection', target: 'membersList' },
    { name: 'Услуги', title: 'Настройте услуги сотрудников', description: 'У каждого принимающего сотрудника должна быть активная услуга с продолжительностью. В разделе «Услуги» вы редактируете свой профиль.', action: 'Открыть услуги', view: 'services' },
    { name: 'Рабочее время', title: 'Заполните график команды', description: 'Проверяем активные смены сотрудников в филиалах на ближайшие 14 дней. Учёт смен и онлайн-запись включаются отдельно.', action: 'Открыть график команды', section: 'shiftsPanel' }
  ];
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const clock = value => /^(?:([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?|24:00(?::00)?)$/.test(String(value || ''));
  const timeMinutes = value => Number(String(value).slice(0, 2)) * 60 + Number(String(value).slice(3, 5));
  const day = date => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Samara', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  const addDays = (iso, count) => new Date(Date.parse(`${iso}T12:00:00Z`) + count * 86400000).toISOString().slice(0, 10);

  // A checklist describes confirmed configuration, never a promise of bookable slots.
  function configuration(organization, response, state, start, end) {
    const locations = (organization?.locations || []).filter(item => item.active === true && String(item.address || '').trim());
    const members = (organization?.members || []).filter(item => item.active === true && item.is_bookable === true);
    const scoped = state === 'ready' && String(response?.organization_id || '') === String(organization?.id || '');
    const limited = scoped && !['owner', 'admin'].includes(organization.current_role);
    const services = scoped ? (response.services || []).filter(item => item.active !== false && members.some(member => member.user_id === item.performer_id) && Number(item.duration_minutes) > 0 && String(item.name || '').trim()) : [];
    const shifts = scoped ? (response.shifts || []).filter(item => item.active === true && item.shift_date >= start && item.shift_date <= end && locations.some(location => location.id === item.location_id) && members.some(member => member.user_id === item.performer_id) && clock(item.start_time) && clock(item.end_time) && timeMinutes(item.end_time) > timeMinutes(item.start_time) && !(response.absences || []).some(absence => absence.active === true && absence.performer_id === item.performer_id && item.shift_date >= absence.starts_on && item.shift_date <= absence.ends_on)) : [];
    const servicesMissing = members.filter(member => !services.some(service => service.performer_id === member.user_id)).length;
    const shiftsMissing = members.filter(member => !shifts.some(shift => shift.performer_id === member.user_id)).length;
    return [
      { done: locations.length > 0, detail: locations.length ? `${locations[0].name} · ${locations[0].address}` : 'Активный филиал с адресом', id: locations[0]?.id },
      { done: members.length > 0, detail: members.length ? members.map(item => item.display_name || 'Сотрудник').join(', ') : 'Действующий сотрудник, принимающий клиентов', id: members[0]?.user_id },
      { done: scoped && !limited ? members.length > 0 && servicesMissing === 0 : null, detail: limited ? 'Полную проверку команды выполнит владелец' : !scoped ? state === 'loading' ? 'Проверяем сохранённые услуги…' : 'Услуги не удалось проверить' : !members.length ? 'Сначала выберите принимающего сотрудника' : servicesMissing ? `Без активной услуги: ${servicesMissing}` : `${services.length} · у всех принимающих сотрудников` },
      { done: scoped && !limited ? members.length > 0 && shiftsMissing === 0 : null, detail: limited ? 'Полную проверку команды выполнит владелец' : !scoped ? state === 'loading' ? 'Проверяем сохранённые смены…' : 'Смены не удалось проверить' : !members.length ? 'Сначала выберите принимающего сотрудника' : shiftsMissing ? `Без смен в ближайшие 14 дней: ${shiftsMissing}` : `${shifts.length} смен · ближайшие 14 дней` }
    ];
  }

  function createController(options) {
    const { db, getCurrentUser, getSessionGeneration, sessionIsCurrent, requireWrites, notify = () => {}, now = () => new Date(), loadTimeoutMs = 12000 } = options;
    const root = document.getElementById('organizationOverviewSection');
    let organization = null, payload = null, state = 'idle', revision = 0, selected = null, expanded = false, wasVisible = false, disposed = false, hadComplete = false;
    let request = null, form, observer, draft = null, submitted = null, scopeId = '', sessionKey = '';
    let start = '', end = '';
    const find = selector => root?.querySelector(selector);
    const visible = () => Boolean(root && !root.closest('[hidden]') && root.getAttribute('aria-hidden') !== 'true');

    function mount() {
      if (!root || root.dataset.orgFlow) return;
      const avatar = find('#organizationAvatar'), title = find('#organizationTitle'), status = find('#organizationPublicState'), support = find('.organization-system-details'), help = find('[data-contextual-help]');
      form = find('#organizationForm');
      const error = find('#organizationError');
      root.dataset.orgFlow = 'true';
      root.innerHTML = `<div class="of-org-header"><div class="of-identity"><div class="of-avatar-slot"></div><div class="of-identity-text"><div class="of-title-slot"></div><button class="of-edit" type="button" data-org-action="rename">Изменить название</button></div></div><div class="of-status"><span class="of-dot" aria-hidden="true"></span><span class="of-status-slot"></span></div><div class="of-rename-slot"></div></div><section class="of-setup" aria-label="Основные настройки организации"><div class="of-title-row"><h4>Подготовка к онлайн-записи</h4><span class="of-count" aria-live="polite"></span></div><div class="of-track" role="progressbar" aria-label="Подтверждённые шаги настройки" aria-valuemin="0" aria-valuemax="4"><div class="of-progress"></div></div><div class="of-read-state" role="status" aria-live="polite"></div><div class="of-ready" hidden><div class="of-ready-copy"><span class="of-ready-mark" aria-hidden="true">✓</span><div><h4>Основные настройки заполнены</h4><p>Проверены услуги и смены на ближайшие 14 дней.</p></div></div><button class="of-primary" type="button" data-org-action="manage" aria-controls="organizationFlowSteps" aria-expanded="false">Управлять организацией</button></div><ol class="of-steps" id="organizationFlowSteps"></ol><p class="of-booking-note"></p><p class="of-notice" role="status" aria-live="polite"></p></section><div class="of-footer"><div class="of-support-slot"></div><details class="of-help"><summary>Помощь по настройке</summary><p>Каждый пункт открывает настоящий редактор. Прогресс меняется после успешного сохранения и повторной проверки. Заполненные шаги можно изменить.</p><div class="of-help-slot"></div></details></div>`;
      avatar.className = 'of-avatar'; title.className = 'of-name';
      find('.of-avatar-slot').append(avatar); find('.of-title-slot').append(title); find('.of-status-slot').append(status);
      form.classList.add('of-inline-form', 'of-rename-form'); form.hidden = true;
      // The theme's legacy .primary fill depends on the old overview structure.
      const saveButton = form.querySelector('button[type="submit"]');
      saveButton.classList.remove('primary', 'compact-button'); saveButton.classList.add('of-primary');
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'of-link'; cancel.dataset.orgAction = 'cancel-rename'; cancel.textContent = 'Отмена'; form.append(cancel);
      find('.of-rename-slot').append(form, error);
      support.classList.add('of-support');
      const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'of-link'; copy.dataset.orgAction = 'copy'; copy.textContent = 'Копировать код'; support.append(copy);
      find('.of-support-slot').append(support);
      if (help) find('.of-help-slot').append(help);
      root.addEventListener('click', handleClick);
      form.addEventListener('input', () => { draft = find('#organizationName').value; });
      form.addEventListener('submit', event => {
        if (saveButton.disabled) { event.preventDefault(); event.stopPropagation(); return; }
        submitted = { id: organization?.id, name: find('#organizationName').value.trim() };
      }, true);
      document.addEventListener('click', handleBrandClick, true);
      observer = new MutationObserver(checkVisibility);
      [root, root.closest('[data-provider-panel]'), document.getElementById('organizationWorkspace'), document.getElementById('dashboard')].filter(Boolean).forEach(node => observer.observe(node, { attributes: true, attributeFilter: ['hidden', 'aria-hidden', 'class'] }));
    }

    function checkVisibility() {
      const shown = visible();
      if (shown && !wasVisible && organization?.id) void load();
      wasVisible = shown;
    }
    function handleBrandClick(event) {
      if (event.target.closest('[data-edit-provider-business]') && organization?.can_manage) openRename();
    }
    function openRename() {
      if (!organization?.can_manage || !requireWrites()) return;
      form.hidden = false; find('#organizationName').focus();
    }

    function render() {
      if (!root?.dataset.orgFlow || !organization) return;
      const focusedButton = document.activeElement?.closest('[data-org-index]');
      const focusedIndex = focusedButton && root.contains(focusedButton) ? Number(focusedButton.dataset.orgIndex) : null;
      const snapshots = configuration(organization, payload, state, start, end);
      const completed = snapshots.filter(item => item.done === true).length;
      const allDone = completed === 4;
      if (allDone && !hadComplete) { selected = null; expanded = false; }
      hadComplete = allDone;
      const active = selected ?? snapshots.findIndex(item => item.done !== true);
      find('.of-count').textContent = `${completed} из 4${snapshots.some(item => item.done === null) ? ' · проверка неполная' : ''}`;
      find('.of-track').setAttribute('aria-valuenow', String(completed)); find('.of-progress').style.width = `${completed * 25}%`;
      find('.of-ready').hidden = !allDone;
      find('[data-org-action="manage"]').setAttribute('aria-expanded', String(expanded));
      find('.of-steps').hidden = allDone && !expanded;
      find('.of-steps').classList.toggle('is-summary', allDone && selected === null);
      find('.of-read-state').innerHTML = state === 'loading' ? 'Проверяем сохранённые настройки…' : state === 'error' ? 'Не удалось проверить услуги и смены. Прогресс по ним не подтверждён. <button class="of-secondary" type="button" data-org-action="retry">Повторить проверку</button>' : '';
      find('.of-read-state').hidden = !['loading', 'error'].includes(state);
      find('.of-status').classList.toggle('is-on', organization.public_booking_enabled === true);
      find('.of-booking-note').textContent = organization.public_booking_enabled === true ? 'Онлайн-запись команды включена. Доступное время зависит от услуг, смен и правил записи.' : 'Онлайн-запись команды выключена. Заполнение шагов её не включает; самостоятельное включение пока недоступно.';
      find('[data-org-action="rename"]').hidden = !organization.can_manage;
      find('.of-steps').innerHTML = steps.map((step, index) => {
        const item = snapshots[index], chosen = active === index && (!allDone || selected !== null);
        const done = item.done === true;
        const editLabel = index < 2 && !organization.can_manage ? 'Посмотреть' : done ? 'Изменить' : step.action;
        return `<li class="of-step ${done ? 'is-done' : ''} ${chosen ? 'is-active' : ''}" data-org-step="${index}" style="${!allDone || selected !== null ? chosen ? 'grid-column:1;grid-row:1 / span 3' : `grid-column:2;grid-row:${index < active ? index + 1 : index}` : ''}">${chosen ? `<div class="of-active-heading"><span class="of-step-number" aria-hidden="true">${done ? '✓' : index + 1}</span><h4>${done ? step.name : step.title}</h4></div><p class="of-active-desc">${escape(done ? item.detail : step.description)}</p><button class="of-primary of-step-action" type="button" data-org-action="open" data-org-index="${index}">${escape(editLabel)} <span aria-hidden="true">→</span></button>` : `<button class="of-step-open" type="button" data-org-action="select" data-org-index="${index}" aria-label="${escape(step.name)}: ${done ? 'заполнено' : item.done === null ? 'не проверено' : 'нужно настроить'}"><span class="of-step-number" aria-hidden="true">${done ? '✓' : index + 1}</span><span class="of-step-label"><span class="of-step-title">${step.name}</span><span class="of-step-desc">${escape(item.detail)}</span></span><span class="of-step-arrow" aria-hidden="true">›</span></button>`}</li>`;
      }).join('');
      if (focusedIndex !== null && visible()) {
        const replacement = find(`[data-org-index="${focusedIndex}"]`) || (allDone ? find('[data-org-action="manage"]') : null);
        replacement?.focus({ preventScroll: true });
      }
    }

    async function load() {
      if (disposed || !organization?.id || !getCurrentUser()?.id) return { ok: false };
      if (request) return request;
      const id = organization.id, user = getCurrentUser().id, generation = getSessionGeneration(), token = ++revision;
      start = day(now()); end = addDays(start, 13); payload = null; state = 'loading'; render();
      const operation = (async () => {
        let timer, response;
        try {
          response = await Promise.race([db.rpc('get_minuta_shift_workspace', { p_organization: id, p_start: start, p_end: end }), new Promise(resolve => { timer = setTimeout(() => resolve({ error: { code: 'TIMEOUT' } }), loadTimeoutMs); })]);
        } catch (error) { response = { error }; }
        finally { clearTimeout(timer); }
        if (disposed || token !== revision || organization?.id !== id || !sessionIsCurrent(user, generation)) return { ok: false, stale: true };
        const data = response?.data;
        if (response?.error || String(data?.organization_id || '') !== String(id) || !['services', 'shifts', 'absences'].every(key => Array.isArray(data?.[key]))) { state = 'error'; payload = null; }
        else { state = 'ready'; payload = data; }
        render(); return { ok: state === 'ready' };
      })();
      request = operation;
      try { return await operation; } finally { if (request === operation) request = null; }
    }

    function setOrganization(next) {
      const nextSessionKey = `${getCurrentUser()?.id || ''}:${getSessionGeneration()}`;
      if (sessionKey !== nextSessionKey) { scopeId = ''; draft = null; submitted = null; if (form) form.hidden = true; }
      sessionKey = nextSessionKey;
      const changed = Boolean(next && scopeId !== next.id);
      revision += 1; request = null; payload = null; state = 'idle';
      organization = next ? { ...next, locations: (next.locations || []).map(item => ({ ...item })), members: (next.members || []).map(item => ({ ...item })) } : null;
      if (changed) { selected = null; expanded = false; hadComplete = false; draft = null; submitted = null; if (form) form.hidden = true; }
      if (!next) return;
      scopeId = next.id;
      if (submitted?.id === next.id) {
        if (next.name === submitted.name) {
          const changedWhileSaving = draft !== null && draft.trim() !== submitted.name;
          form.hidden = !changedWhileSaving;
          if (changedWhileSaving) find('#organizationName').value = draft; else draft = null;
          submitted = null;
          find('.of-notice').textContent = changedWhileSaving ? 'Название сохранено. Новое изменение ещё не сохранено.' : 'Название сохранено';
        }
        else if (draft !== null) find('#organizationName').value = draft;
      } else if (!changed && !form.hidden && draft !== null) find('#organizationName').value = draft;
      render();
      if (visible()) return load();
      return Promise.resolve({ ok: false, pending: true });
    }

    function navigate(index) {
      const step = steps[index];
      if (!step) return;
      if (options.navigate) return options.navigate({ ...step, index, snapshot: configuration(organization, payload, state, start, end)[index] });
      if (step.view) { document.querySelector(`[data-provider-view="${step.view}"]`)?.click(); return; }
      document.querySelector(`#organizationSectionNav [data-section-target="${step.section}"]`)?.click();
      let target = document.getElementById(step.target || step.section);
      const id = configuration(organization, payload, state, start, end)[index]?.id;
      if (index === 0 && id) target = Array.from(document.querySelectorAll('[data-location-card]')).find(node => node.dataset.locationCard === id) || target;
      if (index === 1 && id) target = Array.from(document.querySelectorAll('[data-member-card]')).find(node => node.dataset.memberCard === id) || target;
      if (target?.tagName === 'DETAILS') target.open = true;
      target?.scrollIntoView({ block: 'start', behavior: 'auto' });
      target?.querySelector('input:not([type="hidden"]),select,button')?.focus({ preventScroll: true });
    }

    async function handleClick(event) {
      const button = event.target.closest('[data-org-action]');
      if (!button || !root.contains(button)) return;
      const action = button.dataset.orgAction;
      if (action === 'rename') openRename();
      if (action === 'cancel-rename') { if (form.querySelector('button[type="submit"]')?.disabled) return; form.hidden = true; draft = null; submitted = null; find('#organizationName').value = organization.name; find('[data-org-action="rename"]').focus(); }
      if (action === 'manage') { expanded = !expanded; selected = null; render(); }
      if (action === 'select') { selected = Number(button.dataset.orgIndex); expanded = true; render(); find(`[data-org-step="${selected}"] button`)?.focus(); }
      if (action === 'open') navigate(Number(button.dataset.orgIndex));
      if (action === 'retry') { const result = await load(); if (result.ok) find('.of-notice').textContent = 'Настройки проверены'; }
      if (action === 'copy') {
        try { await navigator.clipboard.writeText(String(organization.public_slug || '')); find('.of-notice').textContent = 'Код скопирован'; }
        catch { notify('Не удалось скопировать код. Его можно выделить в данных для поддержки.'); }
      }
    }
    function reset() { revision += 1; request = null; organization = null; payload = null; state = 'idle'; selected = null; expanded = false; hadComplete = false; draft = null; submitted = null; scopeId = ''; if (form) form.hidden = true; }
    function dispose() { reset(); disposed = true; observer?.disconnect(); root?.removeEventListener('click', handleClick); document.removeEventListener('click', handleBrandClick, true); }
    return { bind: mount, setOrganization, load, reset, dispose };
  }
  window.MinutaOrganizationFlow = { createController, configuration };
})();
