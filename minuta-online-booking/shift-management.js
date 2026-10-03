(function () {
  'use strict';

  const absenceLabels = { vacation: 'Отпуск', sick: 'Больничный', unavailable: 'Недоступен' };
  const auditLabels = {
    shift_created: 'Создана смена', shift_updated: 'Изменена смена', shift_cancelled: 'Смена отменена',
    absence_created: 'Добавлено отсутствие', absence_cancelled: 'Отсутствие отменено',
    schedule_enabled: 'Смены учитываются при онлайн-записи', schedule_disabled: 'Учёт смен при онлайн-записи выключен',
    booking_substituted: 'Специалист в записи заменён', shift_week_copied: 'Скопирована неделя смен'
  };

  function isoToday() {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 10);
  }

  function addDays(iso, count) {
    const date = new Date(`${iso}T12:00:00`);
    date.setDate(date.getDate() + count);
    return date.toISOString().slice(0, 10);
  }

  function createController(options) {
    const { db, escapeHtml, notify, requireWrites, applyWriteAvailability } = options;
    const loadTimeoutMs = Number.isFinite(options.loadTimeoutMs) ? Math.max(1, options.loadTimeoutMs) : 15000;
    const getCurrentUser = typeof options.getCurrentUser === 'function' ? options.getCurrentUser : () => null;
    const getSessionGeneration = typeof options.getSessionGeneration === 'function' ? options.getSessionGeneration : () => 0;
    const sessionIsCurrent = typeof options.sessionIsCurrent === 'function' ? options.sessionIsCurrent : () => false;
    const select = typeof options.$ === 'function' ? options.$ : selector => document.querySelector(selector);
    function $(selector) { return select(selector); }
    let organization = null;
    let payload = null;
    let revision = 0;
    let pending = false;
    let pendingOrganization;
    let editingShiftId = null;
    let copyPlan = null;
    let copyRequestId = null;
    let copyScope = null;
    let copyRevision = 0;
    let copyPending = false;
    let copyUncertain = false;
    const presentation = () => window.MinutaTeamSchedule;

    function clearCopy() {
      copyRevision += 1; copyPlan = null; copyRequestId = null; copyScope = null; copyUncertain = false;
      if ($('#shiftCopyPreview')) { $('#shiftCopyPreview').hidden = true; $('#shiftCopyPreview').innerHTML = ''; }
      if ($('#shiftCopyConfirm')) { $('#shiftCopyConfirm').disabled = true; $('#shiftCopyConfirm').textContent = 'Скопировать смены'; }
      if ($('#shiftCopyScope')) $('#shiftCopyScope').textContent = '';
      $('#shiftCopyForm')?.querySelectorAll('input,button[type=submit]').forEach(field => { field.disabled = false; });
    }

    function unsupported(error) {
      return /PGRST202|42883|get_minuta_shift_workspace|function .* does not exist/i.test(`${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`);
    }

    function setBusy(value) {
      $('#shiftsPanel')?.querySelectorAll('[data-shift-write]').forEach(control => {
        if (value && !control.disabled) { control.disabled = true; control.dataset.shiftBusy = 'true'; }
        else if (!value && control.dataset.shiftBusy === 'true') { control.disabled = false; delete control.dataset.shiftBusy; }
      });
    }

    function reset() {
      clearCopy();
      presentation()?.reset();
      revision += 1;
      organization = null;
      payload = null;
      pending = false;
      pendingOrganization = undefined;
      editingShiftId = null;
      $('#shiftsPanel').hidden = true;
      $('#shiftWorkspace').hidden = true;
      $('#shiftsUnavailable').hidden = true;
      $('#shiftsLoading').hidden = true;
    }

    async function setOrganization(next) {
      const normalized = next?.id ? { ...next } : null;
      if (normalized?.id !== organization?.id) { editingShiftId = null; clearCopy(); }
      presentation()?.setContext(getCurrentUser()?.id, normalized?.id);
      if (pending) {
        pendingOrganization = normalized;
        revision += 1;
        payload = null;
        $('#shiftsPanel').hidden = !normalized;
        $('#shiftWorkspace').hidden = true;
        $('#shiftsLoading').hidden = !normalized;
        return { ok: false, optional: true, pending: true };
      }
      if (!normalized) { reset(); return { ok: false, optional: true }; }
      organization = normalized;
      pendingOrganization = undefined;
      if (!$('#shiftStartDate').value) $('#shiftStartDate').value = isoToday();
      return load();
    }

    async function load() {
      if (pending || !organization?.id || !getCurrentUser()?.id) return { ok: false, optional: true };
      const userId = getCurrentUser().id;
      const generation = getSessionGeneration();
      const organizationId = organization.id;
      const currentRevision = ++revision;
      presentation()?.beforeLoad();
      const start = $('#shiftStartDate').value || isoToday();
      const days = Math.max(1, Math.min(62, Number($('#shiftPeriod').value || 14)));
      $('#shiftsPanel').hidden = false;
      $('#shiftsLoading').hidden = false;
      $('#shiftsUnavailable').hidden = true;
      $('#shiftWorkspace').hidden = true;
      let timeoutId;
      let response;
      try {
        response = await Promise.race([
          db.rpc('get_minuta_shift_workspace', { p_organization: organizationId, p_start: start, p_end: addDays(start, days - 1) }),
          new Promise(resolve => { timeoutId = setTimeout(() => resolve({ error: { code: 'SHIFT_LOAD_TIMEOUT' } }), loadTimeoutMs); })
        ]);
      } catch (error) {
        response = { error };
      } finally {
        clearTimeout(timeoutId);
      }
      if (!sessionIsCurrent(userId, generation) || currentRevision !== revision || organization?.id !== organizationId) return { ok: false, optional: true, stale: true };
      const { data, error } = response || {};
      $('#shiftsLoading').hidden = true;
      if (error) {
        payload = null;
        if (unsupported(error)) { $('#shiftsPanel').hidden = true; return { ok: false, optional: true, unsupported: true }; }
        $('#shiftsUnavailable').hidden = false;
        $('#shiftsUnavailableText').textContent = error.code === 'SHIFT_LOAD_TIMEOUT'
          ? 'Смены не ответили вовремя. Филиалы и записи продолжают работать. Повторите загрузку.'
          : 'Филиалы и записи продолжают работать. Не удалось загрузить только расписание команды.';
        return { ok: false, optional: true };
      }
      if (String(data?.organization_id || '') !== String(organizationId)) {
        payload = null;
        $('#shiftsUnavailable').hidden = false;
        $('#shiftsUnavailableText').textContent = 'Сервер вернул расписание другой организации. Изменения заблокированы.';
        return { ok: false, optional: true, scopeMismatch: true };
      }
      payload = data || {};
      for (const key of ['locations', 'performers', 'services', 'shifts', 'absences', 'bookings', 'utilization', 'audit']) if (!Array.isArray(payload[key])) payload[key] = [];
      render();
      return { ok: true, optional: true };
    }

    function nameOf(items, id, fallback) { return items.find(item => item.id === id)?.display_name || items.find(item => item.id === id)?.name || fallback; }
    function dateLabel(value) { const date = new Date(`${value}T12:00:00`); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', weekday: 'short' }); }
    function shortTime(value) { return String(value || '').slice(0, 5); }
    function renderOptions(items, selected, label) { return items.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === selected ? 'selected' : ''}>${escapeHtml(label(item))}</option>`).join(''); }
    function empty(title, text) { return `<div class="provider-empty compact-empty"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(text)}</small></div>`; }

    function shiftCard(item) {
      const performer = nameOf(payload.performers, item.performer_id, 'Специалист');
      const location = nameOf(payload.locations, item.location_id, 'Филиал');
      const breakText = item.break_start ? ` · перерыв ${shortTime(item.break_start)}–${shortTime(item.break_end)}` : '';
      return `<article class="organization-row shift-row ${item.active ? '' : 'is-muted'}"><div class="organization-row-main"><strong>${escapeHtml(dateLabel(item.shift_date))} · ${escapeHtml(shortTime(item.start_time))}–${escapeHtml(shortTime(item.end_time))}</strong><small>${escapeHtml(performer)} · ${escapeHtml(location)}${escapeHtml(breakText)}${item.note ? ` · ${escapeHtml(item.note)}` : ''}</small></div>${item.active ? `<span class="organization-tags"><button class="organization-cancel" type="button" data-edit-shift="${escapeHtml(item.id)}" data-shift-write>Изменить</button><button class="organization-cancel" type="button" data-cancel-shift="${escapeHtml(item.id)}" data-shift-write>Отменить</button></span>` : '<span class="organization-status">Отменена</span>'}</article>`;
    }

    function absenceCard(item) {
      const performer = nameOf(payload.performers, item.performer_id, 'Специалист');
      const dates = item.starts_on === item.ends_on ? dateLabel(item.starts_on) : `${dateLabel(item.starts_on)} — ${dateLabel(item.ends_on)}`;
      return `<article class="organization-row shift-row ${item.active ? '' : 'is-muted'}"><div class="organization-row-main"><strong>${escapeHtml(absenceLabels[item.kind] || 'Отсутствие')} · ${escapeHtml(dates)}</strong><small>${escapeHtml(performer)}${item.note ? ` · ${escapeHtml(item.note)}` : ''}</small></div>${item.active ? `<button class="organization-cancel" type="button" data-cancel-absence="${escapeHtml(item.id)}" data-shift-write>Отменить</button>` : '<span class="organization-status">Отменено</span>'}</article>`;
    }

    function utilizationCard(item) {
      const performer = nameOf(payload.performers, item.performer_id, 'Специалист');
      const location = nameOf(payload.locations, item.location_id, 'Филиал');
      return `<article><span><strong>${escapeHtml(String(item.percent || 0))}%</strong><small>${escapeHtml(location)}</small></span><div><b style="width:${Math.max(0, Math.min(100, Number(item.percent || 0)))}%"></b></div><small>${escapeHtml(performer)} · ${escapeHtml(String(item.booked_minutes || 0))} из ${escapeHtml(String(item.shift_minutes || 0))} мин</small></article>`;
    }

    function auditCard(item) {
      const created = new Date(item.created_at);
      const time = Number.isNaN(created.getTime()) ? '' : created.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      return `<article><span></span><div><strong>${escapeHtml(auditLabels[item.action] || 'Изменение расписания')}</strong><small>${escapeHtml(time)}</small></div></article>`;
    }

    function renderSubstitution(canManage) {
      const panel = $('#shiftSubstitutionPanel');
      panel.hidden = !canManage;
      if (!canManage) return;
      const active = payload.bookings.filter(item => item.status !== 'cancelled' && !item.has_addons);
      $('#substitutionBooking').innerHTML = active.length ? renderOptions(active, '', item => `${dateLabel(item.booking_date)} ${shortTime(item.booking_time)} · ${item.service_name || item.booking_code}`) : '<option value="">Нет записей в периоде</option>';
      const booking = active.find(item => item.id === $('#substitutionBooking').value) || active[0];
      const alternatives = booking ? payload.services.filter(service => service.performer_id !== booking.performer_id && Number(service.duration_minutes) === Number(booking.primary_duration_minutes || booking.duration_minutes)) : [];
      const noAlternative = !booking ? 'Нет записей для замены'
        : payload.performers.length < 2 ? 'Для замены нужен другой специалист'
          : 'У другого специалиста нет услуги той же длительности';
      $('#substitutionService').innerHTML = alternatives.length ? renderOptions(alternatives, '', item => `${nameOf(payload.performers, item.performer_id, 'Специалист')} · ${item.name}`) : `<option value="">${noAlternative}</option>`;
      $('#substitutionHint').textContent = payload.performers.length < 2
        ? 'Для замены нужен другой специалист. Запись и ссылка клиента сохранятся.'
        : 'Запись и ссылка клиента сохранятся. Замена возможна, если специалист и нужные ресурсы свободны.';
      panel.querySelector('button[type="submit"]').disabled = !booking || !alternatives.length;
    }

    function renderWeekOverview() {
      const anchor = $('#shiftUtilization');
      if (!$('#shiftWeekOverview') && typeof anchor.insertAdjacentHTML === 'function') {
        anchor.insertAdjacentHTML('afterend', '<details class="shift-week-overview" id="shiftWeekOverview" open><summary><strong>Обзор недели</strong><span id="shiftWeekRange"></span></summary><div class="shift-week-controls"><button type="button" class="secondary-button" data-shift-week="-1" aria-label="Предыдущие 7 дней">←</button><span>Существующие смены и отсутствия</span><button type="button" class="secondary-button" data-shift-week="1" aria-label="Следующие 7 дней">→</button></div><div class="shift-week-scroll" role="region" aria-label="Обзор смен за семь дней" tabindex="0"><div class="shift-week-grid" id="shiftWeekGrid"></div></div><small class="shift-week-hint" id="shiftWeekHint"></small></details>');
      }
      if (!$('#shiftWeekOverview')) return;
      const start = $('#shiftStartDate').value || isoToday();
      const dates = Array.from({ length: 7 }, (_, index) => addDays(start, index));
      $('#shiftWeekRange').textContent = `${dateLabel(start)} — ${dateLabel(dates[6])}`;
      const shifts = payload.shifts.filter(item => item.active);
      const absences = payload.absences.filter(item => item.active);
      $('#shiftWeekOverview').hidden = !shifts.length && !absences.length;
      const conflicts = new Set();
      for (const shift of shifts) {
        if (absences.some(item => item.performer_id === shift.performer_id && item.starts_on <= shift.shift_date && item.ends_on >= shift.shift_date)) conflicts.add(shift.id);
        if (shifts.some(item => item.id !== shift.id && item.performer_id === shift.performer_id && item.shift_date === shift.shift_date && shortTime(item.start_time) < shortTime(shift.end_time) && shortTime(item.end_time) > shortTime(shift.start_time))) conflicts.add(shift.id);
      }
      const header = `<div class="shift-week-person shift-week-heading">Специалист</div>${dates.map(date => `<div class="shift-week-heading">${escapeHtml(dateLabel(date))}</div>`).join('')}`;
      const rows = payload.performers.map(performer => {
        const cells = dates.map(date => {
          const dayShifts = shifts.filter(item => item.performer_id === performer.id && item.shift_date === date);
          const dayAbsences = absences.filter(item => item.performer_id === performer.id && item.starts_on <= date && item.ends_on >= date);
          const parts = dayShifts.map(item => {
            const location = nameOf(payload.locations, item.location_id, 'Филиал');
            const conflict = conflicts.has(item.id);
            return `<span class="shift-week-chip${conflict ? ' is-conflict' : ''}"><strong>${escapeHtml(shortTime(item.start_time))}–${escapeHtml(shortTime(item.end_time))}</strong><small>${escapeHtml(location)}</small>${conflict ? '<em>Конфликт</em>' : ''}</span>`;
          });
          if (dayAbsences.length) parts.push(`<span class="shift-week-chip is-absence">${escapeHtml(dayAbsences.map(item => absenceLabels[item.kind] || 'Отсутствие').join(', '))}</span>`);
          return `<div class="shift-week-day" aria-label="${escapeHtml(nameOf(payload.performers, performer.id, 'Специалист'))}, ${escapeHtml(dateLabel(date))}">${parts.join('') || '<span class="shift-week-empty">—</span>'}</div>`;
        });
        return `<div class="shift-week-person">${escapeHtml(performer.display_name || performer.name || 'Специалист')}</div>${cells.join('')}`;
      });
      $('#shiftWeekGrid').innerHTML = payload.performers.length ? header + rows.join('') : empty('Специалистов пока нет', 'Добавьте специалиста в разделе «Люди и филиалы».');
      const visibleConflicts = shifts.filter(item => dates.includes(item.shift_date) && conflicts.has(item.id)).length;
      $('#shiftWeekHint').textContent = visibleConflicts ? `Конфликтующих смен: ${visibleConflicts}. Проверьте пересечение смен и отсутствия ниже.` : 'Конфликтов в показанных сменах нет.';
    }

    function render() {
      if (!payload) return;
      const canManage = Boolean(payload.can_manage_team);
      const isOwner = payload.current_role === 'owner';
      $('#shiftsPanel').hidden = false;
      $('#shiftsUnavailable').hidden = true;
      $('#shiftWorkspace').hidden = false;
      $('#shiftsCount').textContent = String(payload.shifts.filter(item => item.active).length);
      $('#shiftSchedulingEnabled').checked = Boolean(payload.enabled);
      $('#shiftSchedulingEnabled').disabled = !isOwner;
      $('#shiftEnableField').title = isOwner ? '' : 'Включить строгий режим может только владелец';
      $('#shiftEnableHint').textContent = payload.enabled ? 'Свободное время уже ограничено сменами и филиалами.' : 'Сначала заполните смены для всех будущих записей.';
      const activeLocations = payload.locations.filter(item => item.active);
      $('#shiftLocation').innerHTML = renderOptions(activeLocations, '', item => item.name);
      $('#shiftPerformer').innerHTML = renderOptions(payload.performers, '', item => item.display_name);
      $('#absencePerformer').innerHTML = renderOptions(payload.performers, '', item => item.display_name);
      $('#shiftDate').min = isoToday();
      if (!$('#shiftDate').value) $('#shiftDate').value = $('#shiftStartDate').value || isoToday();
      $('#absenceStart').min = isoToday();
      $('#absenceEnd').min = isoToday();
      if (!$('#absenceStart').value) $('#absenceStart').value = isoToday();
      if (!$('#absenceEnd').value) $('#absenceEnd').value = isoToday();
      $('#shiftCreator').hidden = !payload.performers.length || !activeLocations.length;
      $('#absenceCreator').hidden = !payload.performers.length;
      const missingPrerequisite = !payload.performers.length
        ? 'Сначала добавьте специалиста в разделе «Люди и филиалы».'
        : !activeLocations.length
          ? 'Сначала добавьте активный филиал в разделе «Люди и филиалы».'
          : null;
      $('#shiftsList').innerHTML = payload.shifts.length ? payload.shifts.map(shiftCard).join('')
        : missingPrerequisite
          ? `<div class="provider-empty compact-empty"><strong>Смен пока нет</strong><small>${escapeHtml(missingPrerequisite)}</small><button type="button" class="secondary-button" data-section-target="organizationPeopleSection">Люди и филиалы</button></div>`
          : empty('Смен пока нет', 'Добавьте первую смену.');
      $('#absencesList').innerHTML = payload.absences.length ? payload.absences.map(absenceCard).join('') : empty('Отсутствий нет', 'Отпуск и больничный можно добавить заранее.');
      $('#shiftUtilization').innerHTML = payload.utilization.length ? payload.utilization.map(utilizationCard).join('') : empty('Занятость появится после добавления смен', 'Покажем, какая часть рабочего времени занята записями.');
      renderWeekOverview();
      renderSubstitution(canManage);
      $('#shiftAuditPanel').hidden = !canManage;
      $('#shiftAuditCount').textContent = String(payload.audit.length);
      $('#shiftAuditList').innerHTML = payload.audit.length ? payload.audit.map(auditCard).join('') : empty('Изменений пока нет', 'Здесь появится история смен, отсутствий и замен.');
      presentation()?.render(payload);
      setBusy(false);
      applyWriteAvailability();
    }

    function showError(selector, message) { const holder = $(selector); holder.textContent = message; holder.hidden = false; }
    function clearError(selector) { const holder = $(selector); holder.textContent = ''; holder.hidden = true; }

    async function mutate(rpc, parameters, button, success, errorSelector) {
      if (!requireWrites() || pending || copyPending || !organization?.id || !payload) return false;
      const userId = getCurrentUser()?.id;
      const generation = getSessionGeneration();
      const organizationId = organization.id;
      const currentRevision = ++revision;
      pending = true;
      setBusy(true);
      if (errorSelector) clearError(errorSelector);
      const oldText = button?.textContent;
      if (button) { button.disabled = true; button.textContent = 'Сохраняем…'; }
      const { error } = await db.rpc(rpc, parameters);
      if (button) button.textContent = oldText;
      const stale = !sessionIsCurrent(userId, generation) || organization?.id !== organizationId || currentRevision !== revision;
      pending = false;
      if (stale) { const next = pendingOrganization; pendingOrganization = undefined; if (next !== undefined) await setOrganization(next); return false; }
      if (error) {
        const source = `${error.message || ''} ${error.details || ''}`;
        const messages = [
          ['staff_location_shifts_no_performer_overlap', 'У специалиста уже есть пересекающаяся смена, возможно в другом филиале.'],
          ['shift_overlaps_absence', 'Смена пересекается с отпуском или больничным.'],
          ['shift_has_bookings', 'Нельзя отменить смену с действующими записями. Сначала переназначьте клиентов.'],
          ['absence_has_bookings', 'На этот период уже есть записи. Сначала замените специалиста.'],
          ['existing_bookings_outside_shifts', 'Не все будущие записи попадают в подготовленные смены. Строгий режим не включён.'],
          ['booking_outside_active_shift', 'Новый специалист не работает в этом филиале и в это время.'],
          ['bookings_performer_active_no_overlap', 'У нового специалиста это время уже занято.'],
          ['resource', 'Для замены нет свободного кабинета или оборудования.'],
          ['foreign_service_denied', 'У другого специалиста нет активной услуги той же длительности.'],
          ['owner_required', 'Включить строгий режим может только владелец.']
        ];
        const message = messages.find(([key]) => source.includes(key))?.[1] || 'Изменение не сохранено. Данные записей не затронуты.';
        if (errorSelector) showError(errorSelector, message); else notify(message);
        await load();
        return false;
      }
      notify(success);
      await load();
      const next = pendingOrganization;
      pendingOrganization = undefined;
      if (next !== undefined) await setOrganization(next);
      return true;
    }

    async function handleSubmit(event) {
      if (event.target.id === 'shiftCopyForm') { event.preventDefault(); await copyWeek(false); return; }
      if (event.target.id === 'shiftForm') {
        event.preventDefault();
        const hasBreak = $('#shiftHasBreak').checked;
        const saved = await mutate('upsert_minuta_staff_shift', { p_organization: organization.id, p_shift: editingShiftId, p_location: $('#shiftLocation').value, p_performer: $('#shiftPerformer').value, p_date: $('#shiftDate').value, p_start: $('#shiftStart').value, p_end: $('#shiftEnd').value, p_break_start: hasBreak ? $('#shiftBreakStart').value : null, p_break_end: hasBreak ? $('#shiftBreakEnd').value : null, p_note: $('#shiftNote').value.trim() }, event.submitter, editingShiftId ? 'Смена изменена' : 'Смена добавлена', '#shiftError');
        if (saved) { editingShiftId = null; $('#shiftNote').value = ''; $('#shiftCreator').open = false; event.submitter.textContent = 'Создать смену'; }
      }
      if (event.target.id === 'absenceForm') {
        event.preventDefault();
        const saved = await mutate('create_minuta_staff_absence', { p_organization: organization.id, p_performer: $('#absencePerformer').value, p_start: $('#absenceStart').value, p_end: $('#absenceEnd').value, p_kind: $('#absenceKind').value, p_note: $('#absenceNote').value.trim() }, event.submitter, 'Отсутствие добавлено', '#absenceError');
        if (saved) { $('#absenceNote').value = ''; $('#absenceCreator').open = false; }
      }
      if (event.target.id === 'substitutionForm') {
        event.preventDefault();
        await mutate('substitute_minuta_booking', { p_organization: organization.id, p_booking: $('#substitutionBooking').value, p_new_service: $('#substitutionService').value }, event.submitter, 'Специалист заменён, запись клиента сохранена', '#substitutionError');
      }
    }

    async function handleClick(event) {
      const copyOpen = event.target.closest('[data-shift-copy-open]');
      if (copyOpen) {
        if (!payload || pending || copyPending || !organization?.id || !requireWrites()) return;
        if (!copyUncertain) {
          clearCopy(); clearError('#shiftCopyError');
          copyScope = { performer: $('#teamSchedulePerson')?.value || null, location: $('#teamScheduleLocation')?.value || null };
          $('#shiftCopySource').value = $('#shiftStartDate').value || isoToday();
          $('#shiftCopyTarget').value = addDays($('#shiftCopySource').value, 7);
          const person = copyScope.performer ? nameOf(payload.performers, copyScope.performer, 'Специалист') : payload.current_role === 'specialist' ? 'Только мои смены' : 'Все специалисты';
          const location = copyScope.location ? nameOf(payload.locations, copyScope.location, 'Филиал') : 'Все филиалы';
          $('#shiftCopyScope').textContent = `${person} · ${location}`;
        }
        $('#shiftCopyCreator').open = true;
        return;
      }
      if (event.target.closest('[data-shift-copy-confirm]')) { await copyWeek(true); return; }
      const create = event.target.closest('[data-shift-new]');
      if (create) {
        if (!payload || pending || copyPending || !organization?.id || !requireWrites() || $('#shiftCreator').hidden) return;
        editingShiftId = null;
        $('#shiftForm').reset();
        clearError('#shiftError');
        $('#shiftDate').value = create.dataset.shiftDate || [isoToday(), $('#shiftStartDate').value || isoToday()].sort().at(-1);
        if (create.dataset.shiftPerformer) $('#shiftPerformer').value = create.dataset.shiftPerformer;
        if (create.dataset.shiftLocation) $('#shiftLocation').value = create.dataset.shiftLocation;
        $('#shiftBreakFields').hidden = true;
        $('#shiftForm button[type="submit"]').textContent = 'Создать смену';
        $('#shiftCreator').open = true;
        return;
      }
      const createAbsence = event.target.closest('[data-absence-new]');
      if (createAbsence) {
        if (!payload || pending || copyPending || !organization?.id || !requireWrites() || $('#absenceCreator').hidden) return;
        $('#absenceForm').reset();
        clearError('#absenceError');
        $('#absenceStart').value = isoToday();
        $('#absenceEnd').value = isoToday();
        $('#absenceCreator').open = true;
        return;
      }
      const weekButton = event.target.closest('[data-shift-week]');
      if (weekButton) {
        $('#shiftStartDate').value = addDays($('#shiftStartDate').value || isoToday(), Number(weekButton.dataset.shiftWeek) * 7);
        await load();
        return;
      }
      const reload = event.target.closest('#reloadShifts');
      if (reload) await load();
      const shift = event.target.closest('[data-cancel-shift]');
      if (shift) await mutate('cancel_minuta_staff_shift', { p_shift: shift.dataset.cancelShift }, shift, 'Смена отменена');
      const edit = event.target.closest('[data-edit-shift]');
      if (edit) {
        const item = payload?.shifts.find(row => row.id === edit.dataset.editShift);
        if (item) {
          editingShiftId = item.id;
          $('#shiftPerformer').value = item.performer_id;
          $('#shiftLocation').value = item.location_id;
          $('#shiftDate').value = item.shift_date;
          $('#shiftStart').value = shortTime(item.start_time);
          $('#shiftEnd').value = shortTime(item.end_time);
          $('#shiftHasBreak').checked = Boolean(item.break_start);
          $('#shiftBreakFields').hidden = !item.break_start;
          if (item.break_start) { $('#shiftBreakStart').value = shortTime(item.break_start); $('#shiftBreakEnd').value = shortTime(item.break_end); }
          $('#shiftNote').value = item.note || '';
          $('#shiftCreator').open = true;
          $('#shiftForm button[type="submit"]').textContent = 'Сохранить смену';
          $('#shiftCreator').scrollIntoView({ behavior:'smooth', block:'nearest' });
        }
      }
      const absence = event.target.closest('[data-cancel-absence]');
      if (absence) await mutate('cancel_minuta_staff_absence', { p_absence: absence.dataset.cancelAbsence }, absence, 'Отсутствие отменено');
    }

    async function handleChange(event) {
      if (['shiftCopySource','shiftCopyTarget'].includes(event.target.id)) {
        if (!copyUncertain) { copyRevision += 1; copyPlan = null; copyRequestId = null; $('#shiftCopyPreview').hidden = true; $('#shiftCopyConfirm').disabled = true; clearError('#shiftCopyError'); }
        return;
      }
      if (event.target.id === 'shiftPeriod' || event.target.id === 'shiftStartDate') await load();
      if (event.target.id === 'shiftHasBreak') $('#shiftBreakFields').hidden = !event.target.checked;
      if (event.target.id === 'absenceStart' && (!$('#absenceEnd').value || $('#absenceEnd').value < event.target.value)) $('#absenceEnd').value = event.target.value;
      if (event.target.id === 'substitutionBooking') renderSubstitution(Boolean(payload?.can_manage_team));
      if (event.target.id === 'shiftSchedulingEnabled') {
        const desired = event.target.checked;
        const ok = await mutate('set_minuta_branch_shifts_enabled', { p_organization: organization.id, p_enabled: desired }, event.target, desired ? 'Смены учитываются при онлайн-записи' : 'Учёт смен при онлайн-записи выключен');
        if (!ok && payload) event.target.checked = Boolean(payload.enabled);
      }
    }

    function copyError(error) {
      const source = `${error?.code || ''} ${error?.message || ''}`;
      const messages = [
        ['invalid_copy_week_dates','Выберите более позднюю неделю с тем же днём начала, в пределах года.'],
        ['copy_preview_stale','Расписание изменилось. Обновите предварительный просмотр. Ничего не скопировано.'],
        ['copy_week_not_ready','В неделе есть конфликты или нет новых смен для копирования. Ничего не сохранено.'],
        ['copy_request_mismatch','Не удалось подтвердить этот запрос. Обновите предварительный просмотр.'],
        ['foreign_','Нет доступа к выбранному специалисту или филиалу.'],
        ['42501','Недостаточно прав для копирования смен.'],
        ['copy_week_limit','В исходной неделе больше 500 смен. Выберите специалиста или филиал.'],
        ['staff_location_shifts_no_performer_overlap','Появилась пересекающаяся смена. Обновите предварительный просмотр.'],
        ['shift_overlaps_absence','Появилось отсутствие. Обновите предварительный просмотр.'],
        ['PGRST202','Копирование недели пока недоступно на сервере.'],
        ['42883','Копирование недели пока недоступно на сервере.']
      ];
      return messages.find(([key]) => source.includes(key))?.[1] || 'Копирование не сохранено. Повторите предварительный просмотр.';
    }

    function renderCopyPlan(plan) {
      const reasons = { ready:'Будет добавлена', existing:'Уже есть — пропустим', overlap:'Пересекается со сменой', absence:'Специалист отсутствует', inactive_scope:'Специалист или филиал неактивен', past_date:'Дата уже прошла' };
      const summary = !plan.source_count ? 'В исходной неделе нет смен. Выберите другую неделю.'
        : plan.blocked_count ? `Конфликтов: ${plan.blocked_count}. Исправьте их перед копированием; весь пакет останется без изменений.`
          : !plan.ready_count ? 'Все смены уже есть. Повторное копирование не требуется.'
            : `Будет добавлено смен: ${plan.ready_count}. Уже есть: ${plan.existing_count}.`;
      $('#shiftCopyPreview').innerHTML = `<p class="ts-copy-summary"><strong>${escapeHtml(summary)}</strong></p><ul class="ts-copy-list">${plan.rows.map(row => `<li class="ts-copy-row" data-status="${escapeHtml(row.status)}"><strong>${escapeHtml(row.performer_name)} · ${escapeHtml(dateLabel(row.target_date))}</strong><span>${escapeHtml(shortTime(row.start_time))}–${escapeHtml(shortTime(row.end_time))} · ${escapeHtml(row.location_name)}</span>${row.break_start ? `<small>Перерыв ${escapeHtml(shortTime(row.break_start))}–${escapeHtml(shortTime(row.break_end))}</small>` : ''}<small>${escapeHtml(reasons[row.status] || 'Проверьте смену')}</small></li>`).join('')}</ul>`;
      $('#shiftCopyPreview').hidden = false;
      $('#shiftCopyConfirm').disabled = !plan.can_copy;
      $('#shiftCopyConfirm').textContent = plan.can_copy ? `Скопировать смены: ${plan.ready_count}` : 'Скопировать смены';
    }

    async function copyWeek(commit) {
      if (pending || copyPending || !payload || !organization?.id || !getCurrentUser()?.id || !requireWrites()) return;
      if (!copyScope || (commit && !copyPlan?.can_copy) || (!commit && copyUncertain)) return;
      if (!$('#shiftCopyForm').reportValidity()) return;
      const userId = getCurrentUser().id, generation = getSessionGeneration(), org = organization.id;
      const params = { p_organization:org,p_source_start:$('#shiftCopySource').value,p_target_start:$('#shiftCopyTarget').value,p_performer:copyScope.performer,p_location:copyScope.location };
      if (commit && (copyPlan.source_start!==params.p_source_start || copyPlan.target_start!==params.p_target_start)) return;
      if (!commit) { copyPlan=null; copyRequestId=null; }
      const token=++copyRevision;
      copyPending=true; setBusy(true); clearError('#shiftCopyError');
      $('#shiftCopyForm').querySelectorAll('input').forEach(field=>{field.disabled=true;});
      $('#shiftCopyForm').dataset.shiftBusy='true';
      const control = commit ? $('#shiftCopyConfirm') : $('#shiftCopyForm button[type=submit]');
      control.textContent=commit ? 'Копируем…' : 'Проверяем смены…';
      let timer;
      let success=false;
      try {
        const result = await Promise.race([
          db.rpc(commit ? 'copy_minuta_staff_shift_week' : 'preview_minuta_staff_shift_week_copy', commit ? { ...params,p_preview_token:copyPlan.preview_token,p_request_id:copyRequestId } : params),
          new Promise(resolve=>{timer=setTimeout(()=>resolve({error:{code:'COPY_TIMEOUT'}}),loadTimeoutMs);})
        ]);
        if (token!==copyRevision || organization?.id!==org || !sessionIsCurrent(userId,generation)) return;
        if (result?.error) {
          const error=result.error;
          if (commit && (!error.code || ['COPY_TIMEOUT','TypeError','AbortError'].includes(error.code))) {
            copyUncertain=true;
            showError('#shiftCopyError','Сервер ещё не подтвердил результат. Повторите подтверждение: тот же запрос не создаст дубликаты.');
          } else {
            copyUncertain=false; copyPlan=null; copyRequestId=null;
            $('#shiftCopyPreview').hidden=true;
            showError('#shiftCopyError',copyError(error));
          }
          return;
        }
        const plan=result?.data;
        if (plan?.organization_id!==org || plan.source_start!==params.p_source_start || plan.target_start!==params.p_target_start
          || (!commit && (!Array.isArray(plan.rows) || plan.rows.length>500 || typeof plan.preview_token!=='string'))) {
          if (commit) copyUncertain=true;
          showError('#shiftCopyError','Сервер не подтвердил выбранные недели. Проверьте результат перед повтором.'); return;
        }
        copyUncertain=false;
        if (!commit) {
          copyPlan=plan; copyRequestId=crypto.randomUUID(); renderCopyPlan(plan);
        } else {
          if (!Number.isInteger(plan.created_count) || !Array.isArray(plan.created_ids) || plan.request_id!==copyRequestId) {
            copyUncertain=true; showError('#shiftCopyError','Сервер не подтвердил сохранение. Повторите подтверждение тем же запросом.'); return;
          }
          success=true; $('#shiftCopyCreator').open=false;
          notify(`Добавлено смен: ${plan.created_count}. Существующие смены сохранены.`);
          $('#shiftStartDate').value=params.p_target_start; $('#shiftPeriod').value='7'; clearCopy();
        }
      } catch (_) {
        if (token===copyRevision && organization?.id===org && sessionIsCurrent(userId,generation)) {
          copyUncertain=commit;
          showError('#shiftCopyError',commit ? 'Результат пока неизвестен. Повторите подтверждение: дубликаты не появятся.' : 'Не удалось загрузить предварительный просмотр. Повторите проверку.');
        }
      } finally {
        clearTimeout(timer); copyPending=false; delete $('#shiftCopyForm').dataset.shiftBusy;
        setBusy(false);
        $('#shiftCopyForm button[type=submit]').textContent='Показать предварительный просмотр';
        $('#shiftCopyConfirm').disabled=!copyPlan?.can_copy;
        $('#shiftCopyConfirm').textContent=copyUncertain ? 'Повторить подтверждение' : copyPlan?.can_copy ? `Скопировать смены: ${copyPlan.ready_count}` : 'Скопировать смены';
        $('#shiftCopyForm').querySelectorAll('input,button[type=submit]').forEach(field=>{field.disabled=copyUncertain;});
        applyWriteAvailability();
      }
      if (success) await load();
    }

    function bind() {
      document.addEventListener('submit', handleSubmit);
      document.addEventListener('click', handleClick);
      document.addEventListener('change', handleChange);
    }

    return { bind, load, reset, setOrganization };
  }

  window.MinutaShifts = { createController };
})();
