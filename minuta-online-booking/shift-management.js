(function () {
  'use strict';

  const absenceLabels = { vacation: 'Отпуск', sick: 'Больничный', unavailable: 'Недоступен' };
  const auditLabels = {
    shift_created: 'Создана смена', shift_updated: 'Изменена смена', shift_cancelled: 'Смена отменена',
    absence_created: 'Добавлено отсутствие', absence_cancelled: 'Отсутствие отменено',
    schedule_enabled: 'Расписание филиалов включено', schedule_disabled: 'Расписание филиалов выключено',
    booking_substituted: 'Специалист в записи заменён'
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
    const { db, escapeHtml, notify, requireWrites, getCurrentUser, getSessionGeneration, sessionIsCurrent, applyWriteAvailability } = options;
    const select = typeof options.$ === 'function' ? options.$ : selector => document.querySelector(selector);
    function $(selector) { return select(selector); }
    let organization = null;
    let payload = null;
    let revision = 0;
    let pending = false;
    let pendingOrganization;
    let editingShiftId = null;

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
      const start = $('#shiftStartDate').value || isoToday();
      const days = Math.max(1, Math.min(62, Number($('#shiftPeriod').value || 14)));
      $('#shiftsPanel').hidden = false;
      $('#shiftsLoading').hidden = false;
      $('#shiftsUnavailable').hidden = true;
      $('#shiftWorkspace').hidden = true;
      const { data, error } = await db.rpc('get_minuta_shift_workspace', { p_organization: organizationId, p_start: start, p_end: addDays(start, days - 1) });
      if (!sessionIsCurrent(userId, generation) || currentRevision !== revision || organization?.id !== organizationId) return { ok: false, optional: true, stale: true };
      $('#shiftsLoading').hidden = true;
      if (error) {
        payload = null;
        if (unsupported(error)) { $('#shiftsPanel').hidden = true; return { ok: false, optional: true, unsupported: true }; }
        $('#shiftsUnavailable').hidden = false;
        $('#shiftsUnavailableText').textContent = 'Филиалы и записи продолжают работать. Не удалось загрузить только расписание команды.';
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
    function options(items, selected, label) { return items.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === selected ? 'selected' : ''}>${escapeHtml(label(item))}</option>`).join(''); }
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
      $('#substitutionBooking').innerHTML = active.length ? options(active, '', item => `${dateLabel(item.booking_date)} ${shortTime(item.booking_time)} · ${item.service_name || item.booking_code}`) : '<option value="">Нет записей в периоде</option>';
      const booking = active.find(item => item.id === $('#substitutionBooking').value) || active[0];
      const alternatives = booking ? payload.services.filter(service => service.performer_id !== booking.performer_id && Number(service.duration_minutes) === Number(booking.primary_duration_minutes || booking.duration_minutes)) : [];
      $('#substitutionService').innerHTML = alternatives.length ? options(alternatives, '', item => `${item.name} · ${nameOf(payload.performers, item.performer_id, 'Специалист')}`) : '<option value="">Нет другого специалиста</option>';
      panel.querySelector('button').disabled = !booking || !alternatives.length;
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
      $('#shiftLocation').innerHTML = options(activeLocations, '', item => item.name);
      $('#shiftPerformer').innerHTML = options(payload.performers, '', item => item.display_name);
      $('#absencePerformer').innerHTML = options(payload.performers, '', item => item.display_name);
      $('#shiftDate').min = isoToday();
      if (!$('#shiftDate').value) $('#shiftDate').value = $('#shiftStartDate').value || isoToday();
      $('#absenceStart').min = isoToday();
      $('#absenceEnd').min = isoToday();
      if (!$('#absenceStart').value) $('#absenceStart').value = isoToday();
      if (!$('#absenceEnd').value) $('#absenceEnd').value = isoToday();
      $('#shiftCreator').hidden = !payload.performers.length || !activeLocations.length;
      $('#absenceCreator').hidden = !payload.performers.length;
      $('#shiftsList').innerHTML = payload.shifts.length ? payload.shifts.map(shiftCard).join('') : empty('Смен пока нет', 'Добавьте рабочие часы специалиста в конкретном филиале.');
      $('#absencesList').innerHTML = payload.absences.length ? payload.absences.map(absenceCard).join('') : empty('Отсутствий нет', 'Отпуск и больничный можно добавить заранее.');
      $('#shiftUtilization').innerHTML = payload.utilization.length ? payload.utilization.map(utilizationCard).join('') : empty('Загрузка появится после смен', 'Система сравнит рабочие минуты и записи.');
      renderSubstitution(canManage);
      $('#shiftAuditPanel').hidden = !canManage;
      $('#shiftAuditCount').textContent = String(payload.audit.length);
      $('#shiftAuditList').innerHTML = payload.audit.length ? payload.audit.map(auditCard).join('') : empty('Изменений пока нет', 'Здесь появится история смен, отсутствий и замен.');
      setBusy(false);
      applyWriteAvailability();
    }

    function showError(selector, message) { const holder = $(selector); holder.textContent = message; holder.hidden = false; }
    function clearError(selector) { const holder = $(selector); holder.textContent = ''; holder.hidden = true; }

    async function mutate(rpc, parameters, button, success, errorSelector) {
      if (!requireWrites() || pending || !organization?.id || !payload) return false;
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
      if (event.target.id === 'shiftPeriod' || event.target.id === 'shiftStartDate') await load();
      if (event.target.id === 'shiftHasBreak') $('#shiftBreakFields').hidden = !event.target.checked;
      if (event.target.id === 'absenceStart' && (!$('#absenceEnd').value || $('#absenceEnd').value < event.target.value)) $('#absenceEnd').value = event.target.value;
      if (event.target.id === 'substitutionBooking') renderSubstitution(Boolean(payload?.can_manage_team));
      if (event.target.id === 'shiftSchedulingEnabled') {
        const desired = event.target.checked;
        const ok = await mutate('set_minuta_branch_shifts_enabled', { p_organization: organization.id, p_enabled: desired }, event.target, desired ? 'Смены включены в онлайн-запись' : 'Строгая проверка смен выключена');
        if (!ok && payload) event.target.checked = Boolean(payload.enabled);
      }
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
