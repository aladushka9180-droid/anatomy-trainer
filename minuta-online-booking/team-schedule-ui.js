(function () {
  'use strict';
  const source = document.currentScript?.src;
  if (source && !document.querySelector('link[data-team-schedule-style]')) {
    const styleUrl = new URL(source);
    styleUrl.pathname = styleUrl.pathname.replace(/\.js$/, '.css');
    const style = document.createElement('link');
    style.rel = 'stylesheet'; style.href = styleUrl.href;
    style.dataset.teamScheduleStyle = '';
    document.head.append(style);
  }
  const labels = { vacation: 'Отпуск', sick: 'Больничный', unavailable: 'Недоступен' };
  const paths = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h.01m4 0h.01m4 0h.01"/>',
    absence: '<path d="M3 3l18 18M7 5h11a3 3 0 0 1 3 3v9M3 9v9a3 3 0 0 0 3 3h11M8 3v3m8-3v3M4 11h7"/>',
    left: '<path d="m14 6-6 6 6 6"/>', right: '<path d="m10 6 6 6-6 6"/>',
    filter: '<path d="M3 6h18M3 12h18M3 18h18M8 3v6m8 0v6M8 15v6"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    cup: '<path d="M4 8h12v7a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4zm12 1h2a3 3 0 1 1 0 6h-2M7 3v2m4-2v2M3 22h15"/>',
    swap: '<path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4"/>'
  };
  const icon = name => `<svg class="ts-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.calendar}</svg>`;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = id => document.getElementById(id);
  const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const plusDays = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const dateText = (iso, options = { day: 'numeric', month: 'short' }) => new Date(`${iso}T12:00:00`).toLocaleDateString('ru-RU', options);
  const time = value => String(value || '').slice(0, 5);
  const hours = minutes => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(Number(minutes || 0) / 60);
  const shiftWord = n => n % 100 >= 11 && n % 100 <= 14 ? 'смен' : n % 10 === 1 ? 'смена' : n % 10 >= 2 && n % 10 <= 4 ? 'смены' : 'смен';
  let root, data, context = '', preferences = {}, drafts = {};
  const dialogs = [];

  function storePreferences() {
    if (!context) return;
    try { sessionStorage.setItem(context, JSON.stringify(preferences)); } catch (_) { /* Storage is optional. */ }
  }
  function setContext(actor, organization) {
    const next = actor && organization ? `minuta:team-schedule:${actor}:${organization}` : '';
    if (next === context) return;
    reset(); context = next;
    try {
      const saved = JSON.parse(sessionStorage.getItem(context) || '{}');
      preferences = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
    } catch (_) { preferences = {}; }
  }
  function reset() {
    data = null; drafts = {}; preferences = {}; context = '';
    for (const entry of dialogs) {
      entry.details.open = false; if (entry.dialog.open) entry.dialog.close();
      entry.details.querySelector('form').reset();
      const error = entry.details.querySelector('.form-error'); if (error) { error.hidden = true; error.textContent = ''; }
    }
    if ($('teamScheduleActions')) $('teamScheduleActions').hidden = true;
    if ($('teamScheduleCalendar')) $('teamScheduleCalendar').replaceChildren();
  }
  function beforeLoad() {
    if (!root) mount();
    drafts = {};
    for (const entry of dialogs) {
      if (entry.details.open) drafts[entry.details.id] = [...entry.details.querySelectorAll('input,select')].map(field => ({ id: field.id, value: field.value, checked: field.checked }));
      // Keep the native details state while the refreshed payload is loading.
      if (entry.dialog.open) { entry.refreshing = true; entry.dialog.close(); }
    }
  }
  function wrapForm(id, title) {
    const details = $(id);
    const dialog = document.createElement('dialog');
    dialog.className = 'ts-drawer'; dialog.setAttribute('aria-labelledby', `${id}Title`);
    dialog.innerHTML = `<div class="ts-drawer-head"><h3 id="${id}Title">${title}</h3><button type="button" class="ts-close" aria-label="Закрыть форму">${icon('close')}</button></div>`;
    root.append(dialog); dialog.append(details);
    const entry = { details, dialog, refreshing: false, opener: null }; dialogs.push(entry);
    const open = () => {
      if (!details.open || details.hidden || $('shiftWorkspace').hidden || dialog.open) return;
      entry.opener = document.activeElement;
      if (id === 'shiftCreator') $(`${id}Title`).textContent = $('shiftForm').querySelector('[type=submit]').textContent === 'Сохранить смену' ? 'Изменить смену' : title;
      dialog.showModal();
    };
    details.addEventListener('toggle', () => { if (details.open) open(); else if (dialog.open) dialog.close(); });
    dialog.querySelector('.ts-close').addEventListener('click', () => { if (!details.querySelector('[data-shift-busy]')) dialog.close(); });
    dialog.addEventListener('cancel', event => { if (details.querySelector('[data-shift-busy]')) event.preventDefault(); });
    dialog.addEventListener('close', () => {
      if (entry.refreshing) { entry.refreshing = false; return; }
      details.open = false;
      if (entry.opener?.isConnected) entry.opener.focus();
    });
    entry.open = open;
  }
  function mount() {
    root = $('shiftsPanel');
    if (!root || root.dataset.teamScheduleReady) return;
    root.dataset.teamScheduleReady = 'true';
    const period = $('shiftPeriod');
    period.insertAdjacentHTML('afterbegin', '<option value="7">Неделя</option>'); period.value = '7';
    root.querySelector('.organization-invite-help').textContent = 'Рабочее время, перерывы и отсутствия специалистов';
    const actions = document.createElement('div'); actions.id = 'teamScheduleActions'; actions.className = 'ts-actions'; actions.hidden = true;
    actions.innerHTML = `<button type="button" class="ts-primary" data-shift-new data-shift-write>${icon('plus')}Добавить смену</button><button type="button" class="ts-secondary" data-absence-new data-shift-write>${icon('absence')}Отсутствие</button>`;
    root.querySelector('.panel-head').append(actions);
    const toolbar = root.querySelector('.shift-toolbar');
    const setting = $('shiftEnableField'); $('shiftWorkspace').append(setting);
    const navigator = document.createElement('div'); navigator.className = 'ts-navigation';
    navigator.innerHTML = `<button type="button" class="ts-icon-button" data-shift-week="-1" aria-label="Предыдущие 7 дней">${icon('left')}</button><strong id="teamScheduleRange"></strong><button type="button" class="ts-icon-button" data-shift-week="1" aria-label="Следующие 7 дней">${icon('right')}</button><button type="button" class="ts-today" data-ts-today>Сегодня</button>`;
    toolbar.prepend(navigator);
    const filters = document.createElement('details'); filters.className = 'ts-filters'; filters.id = 'teamScheduleFilters';
    filters.innerHTML = `<summary>${icon('filter')}<span>Фильтры</span><span id="teamScheduleFilterCount"></span></summary><div class="ts-filter-fields"><label>Специалист<select id="teamSchedulePerson"></select></label><label>Филиал<select id="teamScheduleLocation"></select></label><button type="button" class="ts-today" data-ts-clear>Сбросить</button></div>`;
    toolbar.after(filters);
    const wideFilters = matchMedia('(min-width: 601px)');
    filters.open = wideFilters.matches;
    wideFilters.addEventListener('change', event => { filters.open = event.matches; });
    const calendar = document.createElement('section'); calendar.id = 'teamScheduleCalendar'; calendar.className = 'ts-calendar'; calendar.setAttribute('aria-label', 'Расписание команды'); filters.after(calendar);
    root.querySelector('.shift-management-grid').classList.add('ts-records');
    for (const section of root.querySelectorAll('.shift-management-grid > section')) {
      const details = document.createElement('details'); details.className = 'ts-record-list';
      const heading = section.querySelector('.resource-subhead'); const list = section.querySelector('.organization-list');
      const summary = document.createElement('summary'); summary.textContent = heading.querySelector('strong').textContent === 'Смены' ? 'Список смен' : 'Отсутствия';
      section.prepend(details); details.append(summary, list); heading.remove();
    }
    wrapForm('shiftCreator', 'Добавить смену'); wrapForm('absenceCreator', 'Добавить отсутствие');
    for (const id of ['shiftError', 'absenceError', 'substitutionError']) $(id).setAttribute('role', 'alert');
    const substitution = $('shiftSubstitutionPanel');
    const disclosure = document.createElement('details'); disclosure.className = 'ts-substitution';
    const summary = document.createElement('summary'); summary.innerHTML = `${icon('swap')}Замена специалиста`;
    substitution.before(disclosure); disclosure.append(summary, substitution); substitution.querySelector('.resource-subhead').hidden = true;
    new MutationObserver(() => {
      const loading = $('shiftWorkspace').hidden;
      if (actions.hidden !== loading) actions.hidden = loading;
      if (disclosure.hidden !== substitution.hidden) disclosure.hidden = substitution.hidden;
    }).observe($('shiftWorkspace'), { attributes: true, subtree: true, attributeFilter: ['hidden'] });
    root.addEventListener('change', event => {
      if (['teamSchedulePerson', 'teamScheduleLocation'].includes(event.target.id)) {
        preferences.person = $('teamSchedulePerson').value; preferences.location = $('teamScheduleLocation').value;
        storePreferences(); renderCalendar();
      }
    });
    root.addEventListener('click', event => {
      const day = event.target.closest('[data-ts-day]');
      if (day) { preferences.day = day.dataset.tsDay; storePreferences(); renderCalendar(); $('teamScheduleCalendar').querySelector(`[data-ts-day="${preferences.day}"]`)?.focus(); }
      if (event.target.closest('[data-ts-today]')) { $('shiftStartDate').value = today(); $('shiftStartDate').dispatchEvent(new Event('change', { bubbles: true })); }
      if (event.target.closest('[data-ts-clear]')) {
        preferences.person = ''; preferences.location = '';
        $('teamSchedulePerson').value = ''; $('teamScheduleLocation').value = '';
        storePreferences(); renderCalendar();
      }
    });
  }
  function options(id, rows, label, key, all) {
    const chosen = rows.some(row => row.id === preferences[key]) ? preferences[key] : '';
    preferences[key] = chosen;
    $(id).innerHTML = `<option value="">${all}</option>${rows.map(row => `<option value="${escape(row.id)}"${row.id === chosen ? ' selected' : ''}>${escape(row[label] || row.name || 'Специалист')}</option>`).join('')}`;
  }
  function render(payload) {
    if (!root) mount();
    if (!root || !payload) return;
    data = payload;
    options('teamSchedulePerson', data.performers, 'display_name', 'person', 'Все специалисты');
    options('teamScheduleLocation', data.locations.filter(row => row.active), 'name', 'location', 'Все филиалы');
    const buttons = $('teamScheduleActions').querySelectorAll('button');
    buttons[0].disabled = $('shiftCreator').hidden; buttons[1].disabled = $('absenceCreator').hidden;
    $('teamScheduleActions').hidden = false;
    for (const entry of dialogs) {
      for (const saved of drafts[entry.details.id] || []) {
        const field = $(saved.id); if (!field) continue;
        if (field.tagName !== 'SELECT' || [...field.options].some(option => option.value === saved.value)) field.value = saved.value;
        if (field.type === 'checkbox') field.checked = saved.checked;
      }
      entry.open();
    }
    $('shiftBreakFields').hidden = !$('shiftHasBreak').checked; drafts = {};
    root.querySelector('.ts-substitution').hidden = $('shiftSubstitutionPanel').hidden;
    renderCalendar();
  }
  function renderCalendar() {
    if (!data) return;
    const start = $('shiftStartDate').value || today();
    const days = Array.from({ length: 7 }, (_, i) => plusDays(start, i));
    if (!days.includes(preferences.day)) preferences.day = days.includes(today()) ? today() : start;
    $('teamScheduleRange').textContent = `${dateText(start)} — ${dateText(days[6])}`;
    const filters = [preferences.person, preferences.location].filter(Boolean).length;
    $('teamScheduleFilterCount').textContent = filters ? String(filters) : '';
    const people = data.performers.filter(person => !preferences.person || person.id === preferences.person);
    const shifts = data.shifts.filter(row => row.active && (!preferences.location || row.location_id === preferences.location));
    const absences = data.absences.filter(row => row.active);
    const conflicts = new Set(data.shifts.filter(row => row.active && (absences.some(a => a.performer_id === row.performer_id && a.starts_on <= row.shift_date && a.ends_on >= row.shift_date) || data.shifts.some(s => s.active && s.id !== row.id && s.performer_id === row.performer_id && s.shift_date === row.shift_date && time(s.start_time) < time(row.end_time) && time(s.end_time) > time(row.start_time)))).map(row => row.id));
    const cell = (person, date) => {
      const items = shifts.filter(row => row.performer_id === person.id && row.shift_date === date);
      const away = absences.filter(row => row.performer_id === person.id && row.starts_on <= date && row.ends_on >= date);
      const parts = items.map(row => `<button type="button" class="ts-shift${conflicts.has(row.id) ? ' ts-conflict' : ''}" data-edit-shift="${escape(row.id)}" data-shift-write aria-label="Изменить смену: ${escape(person.display_name)}, ${escape(dateText(date))}, ${escape(time(row.start_time))}–${escape(time(row.end_time))}"><strong>${escape(time(row.start_time))}–${escape(time(row.end_time))}</strong><span>${escape(data.locations.find(l => l.id === row.location_id)?.name || 'Филиал')}</span>${row.break_start ? `<small>${icon('cup')}<span class="ts-sr">Перерыв </span>${escape(time(row.break_start))}–${escape(time(row.break_end))}</small>` : ''}${conflicts.has(row.id) ? '<em>Конфликт</em>' : ''}</button>`);
      parts.push(...away.map(row => `<span class="ts-away">${icon('absence')}${escape(labels[row.kind] || 'Отсутствие')}</span>`));
      if (!parts.length) parts.push(`<button type="button" class="ts-empty" data-shift-new data-shift-performer="${escape(person.id)}" data-shift-date="${escape(date)}"${preferences.location ? ` data-shift-location="${escape(preferences.location)}"` : ''} data-shift-write${date < today() || !data.locations.some(row => row.active) ? ' disabled' : ''} aria-label="Добавить смену: ${escape(person.display_name)}, ${escape(dateText(date))}">${icon('plus')}<span>Не задана</span></button>`);
      return parts.join('');
    };
    const personCell = person => {
      const totals = data.utilization.filter(row => row.performer_id === person.id && (!preferences.location || row.location_id === preferences.location));
      const booked = totals.reduce((n, row) => n + Number(row.booked_minutes || 0), 0);
      const minutes = totals.reduce((n, row) => n + Number(row.shift_minutes || 0), 0);
      const name = person.display_name || person.name || 'Специалист';
      const initials = name.split(/\s+/).slice(0, 2).map(word => word[0]).join('');
      return `<div class="ts-person"><span class="ts-avatar" aria-hidden="true">${escape(initials)}</span><div><strong>${escape(name)}</strong><small>${minutes ? `Записано ${hours(booked)} ч из ${hours(minutes)} ч` : 'Смены ещё не заданы'}</small></div></div>`;
    };
    const shown = shifts.filter(row => days.includes(row.shift_date) && people.some(p => p.id === row.performer_id));
    const period = Number($('shiftPeriod').value);
    const header = `<div class="ts-calendar-head"><h4>${icon('calendar')}Расписание</h4><small>${shown.length} ${shiftWord(shown.length)} · занятость за ${period === 7 ? 'неделю' : `${period} дн.`}</small></div>`;
    const empty = !people.length ? `<div class="ts-no-people"><strong>Специалистов пока нет</strong><p>Добавьте специалиста, чтобы составить расписание.</p><button type="button" class="ts-secondary" data-section-target="organizationPeopleSection">Люди и филиалы</button></div>` : '';
    const dateHeader = days.map(date => `<th scope="col"${date === today() ? ' class="ts-current"' : ''}><span>${escape(dateText(date, { weekday: 'short' }))}</span><strong>${escape(dateText(date, { day: 'numeric' }))}${date === today() ? ' ·' : ''}</strong></th>`).join('');
    const desktop = `<div class="ts-desktop"><table><thead><tr><th scope="col">Специалист</th>${dateHeader}</tr></thead><tbody>${people.map(person => `<tr><th scope="row">${personCell(person)}</th>${days.map(date => `<td>${cell(person, date)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    const mobile = `<div class="ts-mobile"><div class="ts-days" role="group" aria-label="Выбрать день">${days.map(date => `<button type="button" data-ts-day="${date}" aria-pressed="${date === preferences.day}" aria-label="${escape(dateText(date, { weekday: 'long', day: 'numeric', month: 'long' }))}"><span>${escape(dateText(date, { weekday: 'short' }))}</span><strong>${escape(dateText(date, { day: 'numeric' }))}</strong></button>`).join('')}</div><h4 class="ts-day-title">${escape(dateText(preferences.day, { weekday: 'long', day: 'numeric', month: 'long' }))}${preferences.day === today() ? '<small>Сегодня</small>' : ''}</h4>${people.map(person => `<article class="ts-mobile-person">${personCell(person)}<div class="ts-mobile-shifts">${cell(person, preferences.day)}</div></article>`).join('')}</div>`;
    const prerequisite = people.length && !data.locations.some(row => row.active)
      ? '<div class="ts-prerequisite"><span>Для создания смены нужен активный филиал.</span><button type="button" class="ts-secondary" data-section-target="organizationPeopleSection">Люди и филиалы</button></div>' : '';
    $('teamScheduleCalendar').innerHTML = prerequisite + header + (empty || desktop + mobile);
    // Respect the reliability write gate when rebuilding presentation buttons.
    const source = $('teamScheduleActions').querySelector('[data-shift-new]');
    if (source.disabled) $('teamScheduleCalendar').querySelectorAll('[data-shift-write]').forEach(button => { button.disabled = true; });
  }
  window.MinutaTeamSchedule = { setContext, reset, beforeLoad, render };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true }); else mount();
})();
