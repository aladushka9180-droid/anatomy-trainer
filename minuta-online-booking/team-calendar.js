(function () {
  'use strict';

  const allowedRoles = new Set(['owner', 'admin']);
  const statusLabels = { new:'Новая', confirmed:'Подтверждена', completed:'Состоялась', no_show:'Не пришли', cancelled:'Отменена' };
  const absenceLabels = { vacation:'Отпуск', sick:'Больничный', personal:'Отсутствует', other:'Недоступен' };
  const DAY_MINUTES = 1440;
  const DEFAULT_START = 8 * 60;
  const DEFAULT_END = 20 * 60;
  const STEP_MINUTES = 5;

  function minutesFromTime(value) {
    const [hours = 0, minutes = 0] = String(value || '').split(':').map(Number);
    return (hours * 60) + minutes;
  }

  function timeFromMinutes(value) {
    const normalized = Math.max(0, Math.min(DAY_MINUTES - 1, Number(value) || 0));
    return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
  }

  function createController(options) {
    const {
      db, $, $$, escapeHtml, getCurrentUser, getSessionGeneration, sessionIsCurrent,
      getSelectedDate, getCalendarRange = () => ({ start:getSelectedDate(),end:getSelectedDate() }),
      getCalendarView = () => 'day', getHolder, onModeChange = () => {},
      renderLegacy = () => {}, notify = () => {}, requireWrites = () => true, onDataChange = () => {}
    } = options;
    let organization = null;
    let rows = [];
    let locations = [];
    let members = [];
    let resources = [];
    let services = [];
    let shifts = [];
    let absences = [];
    let mode = 'personal';
    let availability = null;
    let locationId = '';
    let performerId = '';
    let resourceId = '';
    let resourceCalendar = false;
    let dispatcherActions = false;
    let requestRevision = 0;
    let loadedDate = '';
    let bound = false;
    let actionPending = false;
    let moveState = null;
    let suppressClickUntil = 0;

    function canUseTeamCalendar(value = organization) {
      return Boolean(value?.id && allowedRoles.has(value.current_role) && value.can_manage !== false);
    }

    function isMissingRpc(error) {
      const text = `${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`;
      return /(?:PGRST202|42883)/i.test(text) || /function\s+[^\n]*(?:get_minuta_team_calendar|team_booking_v102)[^\n]*does not exist/i.test(text);
    }

    function resetData() {
      rows = [];
      locations = [];
      members = [];
      resources = [];
      services = [];
      shifts = [];
      absences = [];
      locationId = '';
      performerId = '';
      resourceId = '';
      resourceCalendar = false;
      dispatcherActions = false;
      loadedDate = '';
    }

    function reset() {
      requestRevision += 1;
      organization = null;
      resetData();
      mode = 'personal';
      availability = null;
      updateControls();
      onModeChange(false);
    }

    function setOrganization(nextOrganization) {
      const next = nextOrganization && canUseTeamCalendar(nextOrganization) ? nextOrganization : null;
      const changed = next?.id !== organization?.id || next?.current_role !== organization?.current_role;
      organization = next;
      if (!changed) {
        updateControls();
        return;
      }
      requestRevision += 1;
      resetData();
      availability = next ? null : 'forbidden';
      mode = 'personal';
      updateControls();
      onModeChange(false);
      renderLegacy();
      if (next) Promise.resolve().then(() => {
        if (organization?.id === next.id && availability === null) load();
      });
    }

    function normalizePayload(payload, supportsDispatcher) {
      const source = payload?.calendar || payload || {};
      const payloadOrganization = source.organization || organization || {};
      const normalizedLocations = Array.isArray(source.locations) ? source.locations : [];
      const normalizedMembers = Array.isArray(source.performers) ? source.performers : (Array.isArray(source.members) ? source.members : []);
      const normalizedResources = Array.isArray(source.resources) ? source.resources : [];
      const rawRows = Array.isArray(source.bookings) ? source.bookings : (Array.isArray(source.rows) ? source.rows : []);
      return {
        available: source.available !== false && allowedRoles.has(payloadOrganization.current_role || organization?.current_role),
        dispatcherActions: supportsDispatcher && source.dispatcher_actions === true,
        locations: normalizedLocations.filter(item => item?.id && item.active !== false),
        members: normalizedMembers.map(item => ({ ...item, user_id:item?.user_id || item?.id })).filter(item => item.user_id && item.active !== false && item.is_bookable !== false),
        rows: rawRows.map(item => ({
          id:String(item?.id || ''), service_id:String(item?.service_id || item?.services?.id || ''),
          performer_id:String(item?.performer_id || item?.performer?.id || ''),
          performer_name:String(item?.performer_name || item?.performer?.display_name || item?.performer_profiles?.display_name || 'Специалист'),
          location_id:String(item?.location_id || item?.location?.id || ''), location_name:String(item?.location_name || item?.location?.name || 'Без филиала'),
          service_name:String(item?.service_name || item?.services?.name || 'Услуга'), client_name:String(item?.client_name || 'Клиент'),
          client_phone:String(item?.client_phone || ''), booking_date:String(item?.booking_date || ''),
          booking_time:String(item?.booking_time || '').slice(0, 5), duration_minutes:Math.max(1, Number(item?.duration_minutes || item?.services?.duration_minutes || 60)),
          status:String(item?.status || item?.visit_status || 'new'), series_id:String(item?.series_id || ''),
          series_occurrence:Number(item?.series_occurrence || 0), has_addons:item?.has_addons === true,
          resources:(Array.isArray(item?.resources) ? item.resources : []).map(resource => ({
            id:String(resource?.id || ''), name:String(resource?.name || 'Ресурс'), group_name:String(resource?.group_name || '')
          })).filter(resource => resource.id)
        })).filter(item => item.id && item.performer_id && /^\d{4}-\d{2}-\d{2}$/.test(item.booking_date)),
        resources:normalizedResources.map(item => ({
          id:String(item?.id || ''), name:String(item?.name || 'Ресурс'), location_id:String(item?.location_id || ''),
          group_name:String(item?.group_name || ''), active:item?.active !== false
        })).filter(item => item.id),
        services:(Array.isArray(source.services) ? source.services : []).map(item => ({
          id:String(item?.id || ''), performer_id:String(item?.performer_id || ''), name:String(item?.name || 'Услуга'),
          duration_minutes:Math.max(1,Number(item?.duration_minutes || 60)), price_rub:Number(item?.price_rub || 0)
        })).filter(item => item.id && item.performer_id),
        shifts:(Array.isArray(source.shifts) ? source.shifts : []).map(item => ({
          id:String(item?.id || ''), location_id:String(item?.location_id || ''), performer_id:String(item?.performer_id || ''),
          shift_date:String(item?.shift_date || ''), start_time:String(item?.start_time || '').slice(0,5), end_time:String(item?.end_time || '').slice(0,5),
          break_start:String(item?.break_start || '').slice(0,5), break_end:String(item?.break_end || '').slice(0,5), active:item?.active !== false
        })).filter(item => item.performer_id && /^\d{4}-\d{2}-\d{2}$/.test(item.shift_date)),
        absences:(Array.isArray(source.absences) ? source.absences : []).map(item => ({
          id:String(item?.id || ''), performer_id:String(item?.performer_id || ''), starts_on:String(item?.starts_on || ''),
          ends_on:String(item?.ends_on || ''), kind:String(item?.kind || 'other'), note:String(item?.note || ''), active:item?.active !== false
        })).filter(item => item.performer_id)
      };
    }

    async function load() {
      if (!canUseTeamCalendar()) return { ok:false, optional:true, forbidden:true };
      const userId = getCurrentUser()?.id;
      const generation = getSessionGeneration();
      const revision = ++requestRevision;
      const range = getCalendarRange() || { start:getSelectedDate(), end:getSelectedDate() };
      if (!userId || !/^\d{4}-\d{2}-\d{2}$/.test(range.start) || !/^\d{4}-\d{2}-\d{2}$/.test(range.end)) return { ok:false, optional:true };
      availability = 'loading';
      updateControls();
      render(getHolder());
      const parameters = { p_organization:organization.id, p_start:range.start, p_end:range.end, p_location:null, p_performer:null, p_resource:null };
      let result = await db.rpc('get_minuta_team_calendar_v3', parameters);
      let version = 3;
      if (result.error && isMissingRpc(result.error)) {
        result = await db.rpc('get_minuta_team_calendar_v2', parameters);
        version = 2;
      }
      if (result.error && isMissingRpc(result.error)) {
        const { p_resource, ...legacyParameters } = parameters;
        result = await db.rpc('get_minuta_team_calendar', legacyParameters);
        version = 1;
      }
      if (!sessionIsCurrent(userId, generation) || revision !== requestRevision) return { ok:false, optional:true, stale:true };
      if (result.error) {
        resetData();
        if (isMissingRpc(result.error)) {
          availability = 'unsupported';
          mode = 'personal';
          updateControls();
          onModeChange(false);
          renderLegacy();
          return { ok:false, optional:true, unsupported:true };
        }
        availability = 'error';
        updateControls();
        render(getHolder());
        return { ok:false, optional:true };
      }
      const normalized = normalizePayload(result.data,version === 3);
      if (!normalized.available) {
        availability = 'forbidden';
        mode = 'personal';
        updateControls();
        onModeChange(false);
        renderLegacy();
        return { ok:false, optional:true, forbidden:true };
      }
      ({ rows, locations, members, resources, services, shifts, absences } = normalized);
      resourceCalendar = version >= 2;
      dispatcherActions = normalized.dispatcherActions;
      loadedDate = `${range.start}:${range.end}`;
      availability = 'ready';
      if (locationId && !locations.some(item => item.id === locationId)) locationId = '';
      if (performerId && !members.some(item => item.user_id === performerId)) performerId = '';
      if (resourceId && !resources.some(item => item.id === resourceId && (!locationId || item.location_id === locationId))) resourceId = '';
      updateControls();
      render(getHolder());
      return { ok:true, optional:true, dispatcher:dispatcherActions };
    }

    function updateControls() {
      const toolbar = $('#teamCalendarToolbar');
      const filters = $('#teamCalendarFilters');
      const status = $('#teamCalendarStatus');
      const hasTeam = members.length > 1;
      if (!hasTeam && mode === 'team') {
        mode = 'personal';
        onModeChange(false);
      }
      const supported = hasTeam && canUseTeamCalendar() && (availability === 'ready' || availability === 'error');
      if (toolbar) toolbar.hidden = !supported;
      if (filters) filters.hidden = mode !== 'team' || availability !== 'ready';
      $$('[data-calendar-mode]').forEach(button => {
        const active = button.dataset.calendarMode === mode;
        button.classList.toggle('active',active);
        button.setAttribute('aria-pressed',String(active));
      });
      if (status) status.textContent = mode !== 'team' ? '' : availability === 'loading' ? 'Загружаем календарь команды…' : availability === 'error' ? 'Календарь команды временно недоступен. Личные записи не изменены.' : '';
      const resourceField = $('#teamCalendarResourceField');
      if (availability !== 'ready') {
        if (resourceField) resourceField.hidden = true;
        return;
      }
      const locationSelect = $('#teamCalendarLocation');
      const performerSelect = $('#teamCalendarPerformer');
      const resourceSelect = $('#teamCalendarResource');
      if (locationSelect) locationSelect.innerHTML = `<option value="">Все филиалы</option>${locations.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === locationId ? 'selected' : ''}>${escapeHtml(item.name || 'Филиал')}</option>`).join('')}`;
      if (performerSelect) performerSelect.innerHTML = `<option value="">Все специалисты</option>${members.map(item => `<option value="${escapeHtml(item.user_id)}" ${item.user_id === performerId ? 'selected' : ''}>${escapeHtml(item.display_name || 'Специалист')}</option>`).join('')}`;
      const selectableResources = resources.filter(item => item.active && (!locationId || item.location_id === locationId));
      if (resourceField) resourceField.hidden = !resourceCalendar || selectableResources.length === 0;
      if (resourceSelect) resourceSelect.innerHTML = `<option value="">Все ресурсы</option>${selectableResources.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === resourceId ? 'selected' : ''}>${escapeHtml(item.group_name ? `${item.group_name} · ${item.name}` : item.name)}</option>`).join('')}`;
    }

    function filteredRows() {
      const range = getCalendarRange() || { start:getSelectedDate(), end:getSelectedDate() };
      return rows.filter(item => item.booking_date >= range.start && item.booking_date <= range.end)
        .filter(item => !performerId || item.performer_id === performerId)
        .filter(item => !locationId || item.location_id === locationId)
        .filter(item => !resourceId || item.resources.some(resource => resource.id === resourceId))
        .sort((a,b) => `${a.booking_date}|${a.booking_time}|${a.performer_name}|${a.id}`.localeCompare(`${b.booking_date}|${b.booking_time}|${b.performer_name}|${b.id}`,'ru'));
    }

    function localDate(value) {
      const date = new Date(`${value}T12:00:00`);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    function localIso(date) {
      const offset = date.getTimezoneOffset() * 60000;
      return new Date(date.getTime() - offset).toISOString().slice(0,10);
    }

    function datesBetween(startValue,endValue) {
      const start = localDate(startValue);
      const end = localDate(endValue);
      const values = [];
      if (!start || !end) return values;
      for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) values.push(localIso(cursor));
      return values;
    }

    function memberById(id) { return members.find(item => item.user_id === id) || null; }
    function locationById(id) { return locations.find(item => item.id === id) || null; }
    function shiftsFor(performer,date) { return shifts.filter(item => item.active && item.performer_id === performer && item.shift_date === date && (!locationId || item.location_id === locationId)); }
    function absenceFor(performer,date) { return absences.find(item => item.active && item.performer_id === performer && item.starts_on <= date && item.ends_on >= date) || null; }

    function targetLocation(performer,date,fallback = '') {
      if (locationId) return locationId;
      const activeLocations = [...new Set(shiftsFor(performer,date).map(item => item.location_id).filter(Boolean))];
      if (activeLocations.length === 1) return activeLocations[0];
      if (fallback && locations.some(item => item.id === fallback)) return fallback;
      return locations.length === 1 ? locations[0].id : '';
    }

    function minuteFitsShift(performer,date,minute,duration,targetLocationId) {
      if (absenceFor(performer,date)) return false;
      const dayShifts = shiftsFor(performer,date).filter(item => !targetLocationId || item.location_id === targetLocationId);
      if (!shifts.length) return true;
      return dayShifts.some(item => {
        const start = minutesFromTime(item.start_time);
        const end = minutesFromTime(item.end_time);
        const breakStart = item.break_start ? minutesFromTime(item.break_start) : null;
        const breakEnd = item.break_end ? minutesFromTime(item.break_end) : null;
        return minute >= start && minute + duration <= end && (breakStart === null || minute + duration <= breakStart || minute >= breakEnd);
      });
    }

    function bookingConflict(item,performer,date,minute) {
      const end = minute + item.duration_minutes;
      return rows.some(other => other.id !== item.id && other.performer_id === performer && other.booking_date === date && other.status !== 'cancelled' && minute < minutesFromTime(other.booking_time) + other.duration_minutes && end > minutesFromTime(other.booking_time));
    }

    function timelineBounds(columns) {
      const values = [];
      columns.forEach(column => {
        column.items.forEach(item => values.push(minutesFromTime(item.booking_time),minutesFromTime(item.booking_time) + item.duration_minutes));
        shiftsFor(column.performer_id,column.date).forEach(item => values.push(minutesFromTime(item.start_time),minutesFromTime(item.end_time)));
      });
      if (!values.length) return { start:DEFAULT_START,end:DEFAULT_END };
      const start = Math.max(0,Math.floor((Math.min(...values) - 30) / 60) * 60);
      const end = Math.min(DAY_MINUTES,Math.ceil((Math.max(...values) + 30) / 60) * 60);
      return { start,end:Math.max(end,start + 4 * 60) };
    }

    function layoutItems(items) {
      const sorted = [...items].sort((a,b) => minutesFromTime(a.booking_time) - minutesFromTime(b.booking_time) || a.id.localeCompare(b.id));
      const clusters = [];
      let cluster = [];
      let clusterEnd = -1;
      sorted.forEach(item => {
        const start = minutesFromTime(item.booking_time);
        if (cluster.length && start >= clusterEnd) { clusters.push(cluster); cluster = []; clusterEnd = -1; }
        cluster.push(item);
        clusterEnd = Math.max(clusterEnd,start + item.duration_minutes);
      });
      if (cluster.length) clusters.push(cluster);
      const positioned = [];
      clusters.forEach(group => {
        const laneEnds = [];
        const entries = group.map(item => {
          const start = minutesFromTime(item.booking_time);
          let lane = laneEnds.findIndex(end => end <= start);
          if (lane < 0) lane = laneEnds.length;
          laneEnds[lane] = start + item.duration_minutes;
          return { item,lane };
        });
        entries.forEach(entry => positioned.push({ ...entry,lanes:Math.max(1,laneEnds.length) }));
      });
      return positioned;
    }

    function shiftMarkup(column,bounds,hourHeight) {
      const dayShifts = shiftsFor(column.performer_id,column.date);
      const markup = dayShifts.map(item => {
        const start = Math.max(bounds.start,minutesFromTime(item.start_time));
        const end = Math.min(bounds.end,minutesFromTime(item.end_time));
        if (end <= start) return '';
        const top = ((start - bounds.start) / 60) * hourHeight;
        const height = ((end - start) / 60) * hourHeight;
        const branch = locationById(item.location_id)?.name || '';
        const breakStart = item.break_start ? minutesFromTime(item.break_start) : null;
        const breakEnd = item.break_end ? minutesFromTime(item.break_end) : null;
        const breakMarkup = breakStart !== null && breakEnd > breakStart ? `<span class="team-dispatcher-break" style="top:${((breakStart - start) / 60) * hourHeight}px;height:${((breakEnd - breakStart) / 60) * hourHeight}px"><small>Перерыв</small></span>` : '';
        return `<span class="team-dispatcher-shift" style="top:${top}px;height:${height}px" aria-label="Смена ${escapeHtml(item.start_time)}–${escapeHtml(item.end_time)}${branch ? `, ${escapeHtml(branch)}` : ''}">${breakMarkup}</span>`;
      }).join('');
      const absence = absenceFor(column.performer_id,column.date);
      return `${markup}${absence ? `<span class="team-dispatcher-absence"><strong>${escapeHtml(absenceLabels[absence.kind] || 'Недоступен')}</strong>${absence.note ? `<small>${escapeHtml(absence.note)}</small>` : ''}</span>` : ''}`;
    }

    function timelineBookingMarkup(entry,bounds,hourHeight) {
      const { item,lane,lanes } = entry;
      const start = minutesFromTime(item.booking_time);
      const end = start + item.duration_minutes;
      const top = ((start - bounds.start) / 60) * hourHeight;
      const height = Math.max(34,((end - start) / 60) * hourHeight - 3);
      const statusClass = String(item.status || 'new').replaceAll('_','-');
      const resourcesLabel = item.resources.map(resource => resource.name).filter(Boolean).join(' · ');
      const movable = dispatcherActions && item.status !== 'cancelled' && !item.series_id;
      const label = `${item.client_name}, ${item.service_name}, ${item.booking_time}–${timeFromMinutes(end)}, ${item.performer_name}`;
      return `<button class="team-dispatcher-booking status-${escapeHtml(statusClass)}${movable ? ' is-movable' : ''}" type="button" data-team-booking-id="${escapeHtml(item.id)}" style="top:${top}px;height:${height}px;--lane:${lane};--lanes:${lanes}" aria-label="${escapeHtml(label)}. Открыть запись"><time>${escapeHtml(item.booking_time)}–${escapeHtml(timeFromMinutes(end))}</time><strong>${escapeHtml(item.service_name)}</strong><span>${escapeHtml(item.client_name)}</span>${resourcesLabel ? `<small>${escapeHtml(resourcesLabel)}</small>` : ''}${item.series_id ? '<i>Серия</i>' : ''}</button>`;
    }

    function renderTimeline(holder,columns,extraClass = '') {
      if (!columns.length) {
        holder.className = 'provider-bookings schedule-list team-calendar-list';
        holder.innerHTML = '<div class="provider-empty schedule-empty"><strong>Нет специалистов</strong><small>Измените филиал или настройки команды.</small></div>';
        return;
      }
      const mobile = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 760px)').matches;
      const hourHeight = mobile ? 64 : 72;
      const bounds = timelineBounds(columns);
      const height = ((bounds.end - bounds.start) / 60) * hourHeight;
      const labels = [];
      for (let minute = bounds.start; minute <= bounds.end; minute += 60) labels.push(`<span style="top:${((minute - bounds.start) / 60) * hourHeight}px">${escapeHtml(timeFromMinutes(minute))}</span>`);
      const today = localIso(new Date());
      const now = new Date();
      const nowMinute = now.getHours() * 60 + now.getMinutes();
      const stages = columns.map(column => {
        const currentLine = column.date === today && nowMinute >= bounds.start && nowMinute <= bounds.end ? `<span class="team-dispatcher-now" style="top:${((nowMinute - bounds.start) / 60) * hourHeight}px" aria-label="Текущее время"></span>` : '';
        const columnLocation = targetLocation(column.performer_id,column.date,column.items[0]?.location_id || '');
        return `<section class="team-dispatcher-column"><div class="team-dispatcher-column-head"><strong>${escapeHtml(column.label)}</strong><small>${escapeHtml(column.subtitle || '')}</small><span>${column.items.filter(item => item.status !== 'cancelled').length}</span></div><div class="team-dispatcher-stage" data-team-stage data-team-performer="${escapeHtml(column.performer_id)}" data-team-date="${escapeHtml(column.date)}" data-team-location="${escapeHtml(columnLocation)}" data-team-start="${bounds.start}" data-team-end="${bounds.end}" data-team-hour-height="${hourHeight}" style="height:${height}px"><button class="team-dispatcher-slot-surface" type="button" data-team-slot-surface aria-label="Выбрать свободное время для ${escapeHtml(column.label)}"></button>${shiftMarkup(column,bounds,hourHeight)}${layoutItems(column.items).map(entry => timelineBookingMarkup(entry,bounds,hourHeight)).join('')}${currentLine}<span class="team-dispatcher-drop-time" aria-hidden="true"></span></div></section>`;
      }).join('');
      holder.className = `provider-bookings team-calendar-list team-dispatcher-scroll${extraClass ? ` ${extraClass}` : ''}`;
      holder.innerHTML = `<div class="team-dispatcher" style="--team-columns:${columns.length};--team-hour-height:${hourHeight}px"><div class="team-dispatcher-axis-head"><strong>Время</strong><small>${dispatcherActions ? 'Нажмите или перетащите' : 'Просмотр'}</small></div><div class="team-dispatcher-axis" style="height:${height}px">${labels.join('')}</div><div class="team-dispatcher-columns">${stages}</div></div>`;
    }

    function renderDay(holder,visible) {
      const date = getSelectedDate();
      const visibleMembers = performerId ? members.filter(item => item.user_id === performerId) : members;
      const columns = visibleMembers.map(member => ({
        performer_id:member.user_id,date,label:member.display_name || 'Специалист',
        subtitle:absenceFor(member.user_id,date) ? (absenceLabels[absenceFor(member.user_id,date).kind] || 'Недоступен') : shiftsFor(member.user_id,date).map(item => `${item.start_time}–${item.end_time}`).join(' · ') || 'График не задан',
        items:visible.filter(item => item.performer_id === member.user_id)
      }));
      visible.forEach(item => {
        if (!columns.some(column => column.performer_id === item.performer_id)) columns.push({ performer_id:item.performer_id,date,label:item.performer_name,subtitle:item.location_name,items:visible.filter(row => row.performer_id === item.performer_id) });
      });
      renderTimeline(holder,columns,'team-dispatcher-day');
      const status = $('#teamCalendarStatus');
      if (status) status.textContent = dispatcherActions ? `Записей: ${visible.length} · нажмите свободное время или перетащите запись` : `Записей: ${visible.length} · управление включится после миграции v102`;
    }

    function periodBookingMarkup(item,compact) {
      const time = String(item.booking_time).slice(0,5);
      const label = `${item.performer_name}, ${item.service_name}, ${item.client_name}, ${time}`;
      return `<button class="calendar-overview-booking team-calendar-period-booking status-${escapeHtml(String(item.status || 'new').replaceAll('_','-'))}" type="button" data-team-booking-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(label)}. Открыть запись"><time>${escapeHtml(time)}</time><span><strong>${escapeHtml(compact ? item.performer_name : item.service_name)}</strong><small>${escapeHtml(compact ? item.service_name : `${item.performer_name} · ${item.client_name}`)}</small></span></button>`;
    }

    function dayCapacity(date,items) {
      const relevantShifts = shifts.filter(item => item.active && item.shift_date === date && (!performerId || item.performer_id === performerId) && (!locationId || item.location_id === locationId));
      const capacity = relevantShifts.reduce((sum,item) => {
        const work = Math.max(0,minutesFromTime(item.end_time) - minutesFromTime(item.start_time));
        const pause = item.break_start && item.break_end ? Math.max(0,minutesFromTime(item.break_end) - minutesFromTime(item.break_start)) : 0;
        return sum + Math.max(0,work - pause);
      },0);
      const booked = items.filter(item => item.status !== 'cancelled').reduce((sum,item) => sum + item.duration_minutes,0);
      return capacity ? Math.min(100,Math.round(booked / capacity * 100)) : null;
    }

    function renderWeekTimeline(holder,visible,range) {
      const member = memberById(performerId);
      const columns = datesBetween(range.start,range.end).map(date => {
        const parsed = localDate(date);
        return { performer_id:performerId,date,label:parsed.toLocaleDateString('ru-RU',{ weekday:'short',day:'numeric' }).replace('.',''),subtitle:shiftsFor(performerId,date).map(item => `${item.start_time}–${item.end_time}`).join(' · ') || 'Выходной',items:visible.filter(item => item.booking_date === date) };
      });
      renderTimeline(holder,columns,'team-dispatcher-week');
      const status = $('#teamCalendarStatus');
      if (status) status.textContent = `${member?.display_name || 'Специалист'} · неделя · ${visible.length} записей`;
    }

    function renderPeriod(holder,visible,view,range) {
      if (view === 'week' && performerId) { renderWeekTimeline(holder,visible,range); return; }
      const selected = getSelectedDate();
      const today = localIso(new Date());
      const byDate = new Map();
      visible.forEach(item => {
        if (!byDate.has(item.booking_date)) byDate.set(item.booking_date,[]);
        byDate.get(item.booking_date).push(item);
      });
      const days = datesBetween(range.start,range.end);
      const leading = view === 'month' ? (localDate(range.start).getDay() + 6) % 7 : 0;
      const placeholders = Array.from({ length:leading },() => '<div class="calendar-overview-day is-placeholder" aria-hidden="true"></div>');
      const cells = days.map(iso => {
        const date = localDate(iso);
        const items = byDate.get(iso) || [];
        const limit = view === 'month' ? 3 : items.length;
        const hiddenCount = Math.max(0,items.length - limit);
        const fullDate = date.toLocaleDateString('ru-RU',{ weekday:'long',day:'numeric',month:'long',year:'numeric' });
        const load = dayCapacity(iso,items);
        const loadClass = load === null ? '' : load >= 85 ? ' load-high' : load >= 50 ? ' load-medium' : ' load-low';
        const loadMarkup = view === 'month' && load !== null ? `<span class="team-calendar-load" aria-label="Загрузка ${load}%"><i style="width:${load}%"></i><small>${load}%</small></span>` : '';
        return `<article class="calendar-overview-day${iso === today ? ' is-today' : ''}${iso === selected ? ' is-selected' : ''}${loadClass}"><button class="calendar-overview-date" type="button" data-calendar-open-date="${iso}" ${iso === today ? 'aria-current="date"' : ''} aria-label="${escapeHtml(fullDate)}. Открыть день"><span>${view === 'week' ? escapeHtml(date.toLocaleDateString('ru-RU',{ weekday:'short' }).replace('.','')) : ''}</span><strong>${date.getDate()}</strong>${view === 'week' ? `<small>${escapeHtml(date.toLocaleDateString('ru-RU',{ month:'short' }).replace('.',''))}</small>` : ''}</button>${loadMarkup}<div class="calendar-overview-items">${items.slice(0,limit).map(item => periodBookingMarkup(item,view === 'month')).join('')}${hiddenCount ? `<button class="calendar-overview-more" type="button" data-calendar-open-date="${iso}">Ещё ${hiddenCount}</button>` : ''}</div></article>`;
      });
      const weekdayHeader = view === 'month' ? `<div class="calendar-overview-weekdays" aria-hidden="true">${['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(day => `<span>${day}</span>`).join('')}</div>` : '';
      holder.className = `provider-bookings calendar-overview calendar-overview-${view} team-calendar-period`;
      holder.innerHTML = `${weekdayHeader}<div class="calendar-overview-grid" role="grid" aria-label="Календарь команды">${placeholders.join('')}${cells.join('')}</div>`;
      const status = $('#teamCalendarStatus');
      if (status) status.textContent = view === 'week' ? `Выберите одного специалиста для почасовой недели · записей ${visible.length}` : `Загрузка команды за месяц · записей ${visible.length}`;
    }

    function render(holder = getHolder()) {
      if (!holder || mode !== 'team') return false;
      const range = getCalendarRange() || { start:getSelectedDate(),end:getSelectedDate() };
      const rangeKey = `${range.start}:${range.end}`;
      if (availability === 'loading' || (availability === 'ready' && loadedDate !== rangeKey)) {
        holder.className = 'provider-bookings schedule-list team-calendar-list';
        holder.innerHTML = '<div class="loading-state"><i></i><span>Загружаем записи команды…</span></div>';
        if (availability !== 'loading') load();
        return true;
      }
      if (availability === 'error') {
        holder.className = 'provider-bookings schedule-list team-calendar-list';
        holder.innerHTML = '<div class="provider-empty"><strong>Командный календарь временно недоступен</strong><small>Переключитесь на «Мои записи» или повторите обновление.</small></div>';
        return true;
      }
      if (availability !== 'ready') return false;
      const visible = filteredRows();
      const calendarView = getCalendarView() || 'day';
      if (calendarView === 'day') renderDay(holder,visible); else renderPeriod(holder,visible,calendarView,range);
      return true;
    }

    function setSheet(markup,wide = false) {
      const sheet = $('#bookingSheet');
      const content = $('#bookingSheetContent');
      if (!sheet || !content) return false;
      sheet.classList.toggle('booking-sheet-wide',wide);
      sheet.classList.remove('new-booking-sheet');
      content.innerHTML = markup;
      sheet.hidden = false;
      if (typeof document !== 'undefined') document.body?.classList.add('booking-sheet-open');
      return true;
    }

    function closeSheet() {
      const sheet = $('#bookingSheet');
      if (sheet) sheet.hidden = true;
      if (typeof document !== 'undefined') document.body?.classList.remove('booking-sheet-open');
    }

    function matchingService(item,targetPerformer) {
      if (targetPerformer === item.performer_id) return services.find(service => service.id === item.service_id) || null;
      const source = services.find(service => service.id === item.service_id);
      return services.find(service => service.performer_id === targetPerformer && service.name.trim().toLowerCase() === item.service_name.trim().toLowerCase() && (!source || service.duration_minutes === source.duration_minutes)) || null;
    }

    function actionError(error) {
      const text = `${error?.message || ''} ${error?.details || ''}`;
      if (/team_series_move_requires_scope/i.test(text)) return 'Эта запись входит в серию. Откройте управление серией и выберите область изменений.';
      if (/addons_require_manual_move/i.test(text)) return 'Сеанс с дополнительными услугами нужно перенести через подробное редактирование.';
      if (/incompatible_team_booking_service/i.test(text)) return 'У выбранного специалиста нет совместимой услуги той же длительности.';
      if (/outside_shift|shift_required|shift_break|staff_absence/i.test(text)) return 'Это время находится вне смены, в перерыве или во время отсутствия сотрудника.';
      if (/slot_unavailable|resource|overlap|buffer/i.test(text)) return 'Время или необходимый ресурс уже заняты. Выберите соседний свободный интервал.';
      if (/denied|42501/i.test(text)) return 'Недостаточно прав для изменения командного расписания.';
      return 'Не удалось сохранить изменение. Расписание обновлено, попробуйте другое время.';
    }

    async function moveBooking(item,targetPerformer,date,minute,targetLocationId) {
      if (!dispatcherActions || actionPending || !requireWrites()) return false;
      if (item.series_id) { notify('Запись входит в серию · перенесите её через управление серией'); return false; }
      const service = matchingService(item,targetPerformer);
      if (!service) { notify('У выбранного специалиста нет услуги с таким названием и длительностью'); return false; }
      const location = targetLocationId || targetLocation(targetPerformer,date,item.location_id);
      if (!location) { notify('Сначала выберите филиал командного календаря'); return false; }
      if (!minuteFitsShift(targetPerformer,date,minute,item.duration_minutes,location)) { notify('Это время находится вне смены или пересекает перерыв'); return false; }
      if (bookingConflict(item,targetPerformer,date,minute)) { notify('Это время уже занято у выбранного специалиста'); return false; }
      actionPending = true;
      const result = await db.rpc('move_minuta_team_booking_v102', { p_organization:organization.id,p_booking:item.id,p_location:location,p_service:service.id,p_date:date,p_time:`${timeFromMinutes(minute)}:00` });
      actionPending = false;
      if (result.error) { notify(actionError(result.error)); await load(); return false; }
      closeSheet();
      await load();
      Promise.resolve(onDataChange()).catch(() => {});
      notify(`Запись перенесена на ${timeFromMinutes(minute)}`);
      return true;
    }

    function openBookingDetails(item) {
      const start = minutesFromTime(item.booking_time);
      const end = timeFromMinutes(start + item.duration_minutes);
      const resourceNames = item.resources.map(resource => resource.name).filter(Boolean).join(' · ');
      const canMove = dispatcherActions && item.status !== 'cancelled' && !item.series_id;
      const performerOptions = members.map(member => `<option value="${escapeHtml(member.user_id)}" ${member.user_id === item.performer_id ? 'selected' : ''}>${escapeHtml(member.display_name || 'Специалист')}</option>`).join('');
      const moveForm = canMove ? `<form class="team-booking-move-form" id="teamBookingMoveForm"><div class="form-row"><label>Специалист<select id="teamBookingMovePerformer">${performerOptions}</select></label><label>Дата<input id="teamBookingMoveDate" type="date" value="${escapeHtml(item.booking_date)}" required></label></div><label>Время<input id="teamBookingMoveTime" type="time" step="300" value="${escapeHtml(item.booking_time)}" required></label><p class="team-booking-move-hint">Можно также перетащить карточку прямо в календаре.</p><button class="primary" type="submit">Перенести запись</button></form>` : item.series_id ? '<div class="booking-sheet-block"><span>↻</span><div><small>Серия записей</small><strong>Для безопасного переноса выберите одну запись, последующие или всю серию в управлении серией.</strong></div></div>' : '';
      if (!setSheet(`<small class="booking-sheet-kicker">Командное расписание · ${escapeHtml(item.location_name)}</small><h2 id="bookingSheetTitle">${escapeHtml(item.service_name)}</h2><div class="booking-sheet-meta"><strong>${escapeHtml(item.booking_time)}–${escapeHtml(end)}</strong><span>${item.duration_minutes} минут</span><span class="booking-status status-${escapeHtml(String(item.status).replaceAll('_','-'))}">${escapeHtml(statusLabels[item.status] || item.status)}</span></div><div class="booking-sheet-summary"><div class="booking-sheet-client"><small class="booking-sheet-client-label">Клиент</small><div class="booking-sheet-client-name"><strong>${escapeHtml(item.client_name)}</strong></div>${item.client_phone ? `<a href="tel:${escapeHtml(item.client_phone.replace(/[^+\d]/g,''))}">${escapeHtml(item.client_phone)}</a>` : ''}</div><div class="booking-sheet-price"><small>Специалист</small><strong>${escapeHtml(item.performer_name)}</strong></div></div>${resourceNames ? `<div class="booking-sheet-block"><span>⌂</span><div><small>Ресурсы</small><strong>${escapeHtml(resourceNames)}</strong></div></div>` : ''}${moveForm}`)) return;
      $('#teamBookingMoveForm')?.addEventListener('submit',event => {
        event.preventDefault();
        const targetPerformer = $('#teamBookingMovePerformer').value;
        const date = $('#teamBookingMoveDate').value;
        const minute = minutesFromTime($('#teamBookingMoveTime').value);
        moveBooking(item,targetPerformer,date,minute,targetLocation(targetPerformer,date,item.location_id));
      });
    }

    function openCreateBooking(performer,date,minute,presetLocation) {
      if (!dispatcherActions) { notify('Создание в календаре команды включится после безопасной миграции v102'); return; }
      if (!requireWrites()) return;
      const performerServices = services.filter(item => item.performer_id === performer);
      if (!performerServices.length) { notify('У выбранного специалиста нет активных услуг'); return; }
      const location = presetLocation || targetLocation(performer,date);
      if (!location) { notify('Сначала выберите филиал командного календаря'); return; }
      const member = memberById(performer);
      const serviceOptions = performerServices.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} · ${item.duration_minutes} мин</option>`).join('');
      if (!setSheet(`<small class="booking-sheet-kicker">Командное расписание · ${escapeHtml(member?.display_name || 'Специалист')}</small><h2 id="bookingSheetTitle">Новая запись</h2><form class="booking-editor-form new-booking-form team-booking-create-form" id="teamBookingCreateForm"><div class="booking-client-fields"><label>Имя клиента<input id="teamBookingClientName" maxlength="80" autocomplete="name" required></label><label>Телефон<input id="teamBookingClientPhone" type="tel" maxlength="32" autocomplete="tel" required></label></div><label>Услуга<select id="teamBookingService">${serviceOptions}</select></label><div class="form-row"><label>Дата<input id="teamBookingDate" type="date" value="${escapeHtml(date)}" required></label><label>Время<input id="teamBookingTime" type="time" step="300" value="${escapeHtml(timeFromMinutes(minute))}" required></label></div><p class="form-error" id="teamBookingCreateError" role="alert" hidden></p><button class="primary" id="teamBookingCreateSubmit" type="submit">Создать запись</button></form>`,true)) return;
      $('#teamBookingCreateForm')?.addEventListener('submit',async event => {
        event.preventDefault();
        if (actionPending || !requireWrites()) return;
        const service = services.find(item => item.id === $('#teamBookingService').value && item.performer_id === performer);
        const targetDate = $('#teamBookingDate').value;
        const targetMinute = minutesFromTime($('#teamBookingTime').value);
        const errorHolder = $('#teamBookingCreateError');
        if (!service || !minuteFitsShift(performer,targetDate,targetMinute,service.duration_minutes,location)) {
          if (errorHolder) { errorHolder.textContent = 'Время находится вне смены или пересекает перерыв.'; errorHolder.hidden = false; }
          return;
        }
        actionPending = true;
        const button = $('#teamBookingCreateSubmit');
        if (button) { button.disabled = true; button.textContent = 'Создаём…'; }
        const requestId = globalThis.crypto?.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,character => {
          const random = Math.floor(Math.random() * 16);
          return (character === 'x' ? random : (random & 0x3) | 0x8).toString(16);
        });
        const result = await db.rpc('create_minuta_team_booking_v102', { p_organization:organization.id,p_request_id:requestId,p_location:location,p_service:service.id,p_date:targetDate,p_time:`${timeFromMinutes(targetMinute)}:00`,p_client_name:$('#teamBookingClientName').value.trim(),p_client_phone:$('#teamBookingClientPhone').value.trim() });
        actionPending = false;
        if (result.error) {
          if (errorHolder) { errorHolder.textContent = actionError(result.error); errorHolder.hidden = false; }
          if (button) { button.disabled = false; button.textContent = 'Создать запись'; }
          await load();
          return;
        }
        closeSheet();
        await load();
        Promise.resolve(onDataChange()).catch(() => {});
        notify('Новая запись добавлена в расписание команды');
      });
    }

    function stageMinute(stage,clientY) {
      const rect = stage.getBoundingClientRect();
      const start = Number(stage.dataset.teamStart || DEFAULT_START);
      const end = Number(stage.dataset.teamEnd || DEFAULT_END);
      const raw = start + ((clientY - rect.top) / Math.max(1,rect.height)) * (end - start);
      return Math.max(start,Math.min(end - STEP_MINUTES,Math.round(raw / STEP_MINUTES) * STEP_MINUTES));
    }

    function stageFromPoint(clientX,clientY) {
      if (typeof document === 'undefined' || !document.elementFromPoint) return null;
      return document.elementFromPoint(clientX,clientY)?.closest?.('[data-team-stage]') || null;
    }

    function clearMoveVisual(state = moveState) {
      state?.card?.classList.remove('is-dragging');
      $$('[data-team-stage].is-drop-target').forEach(stage => stage.classList.remove('is-drop-target'));
      $$('[data-team-stage] .team-dispatcher-drop-time').forEach(marker => { marker.style.display = ''; marker.dataset.label = ''; });
      moveState = null;
    }

    function beginMove(event,card) {
      if (!dispatcherActions || actionPending || event.button !== 0) return;
      const item = rows.find(row => row.id === card.dataset.teamBookingId);
      if (!item || item.status === 'cancelled' || item.series_id) return;
      moveState = { pointerId:event.pointerId,card,item,startX:event.clientX,startY:event.clientY,active:false,targetStage:null,targetMinute:minutesFromTime(item.booking_time) };
      card.setPointerCapture?.(event.pointerId);
    }

    function updateMove(event) {
      const state = moveState;
      if (!state || state.pointerId !== event.pointerId) return;
      if (!state.active && Math.hypot(event.clientX - state.startX,event.clientY - state.startY) < 7) return;
      if (!state.active) { state.active = true; state.card.classList.add('is-dragging'); }
      event.preventDefault?.();
      const stage = stageFromPoint(event.clientX,event.clientY);
      $$('[data-team-stage].is-drop-target').forEach(item => item.classList.remove('is-drop-target'));
      $$('[data-team-stage] .team-dispatcher-drop-time').forEach(marker => { marker.style.display = ''; marker.dataset.label = ''; });
      state.targetStage = stage;
      if (!stage) return;
      stage.classList.add('is-drop-target');
      state.targetMinute = stageMinute(stage,event.clientY);
      const marker = stage.querySelector?.('.team-dispatcher-drop-time');
      if (marker) {
        const start = Number(stage.dataset.teamStart || DEFAULT_START);
        const hourHeight = Number(stage.dataset.teamHourHeight || 72);
        marker.style.display = 'block';
        marker.style.top = `${((state.targetMinute - start) / 60) * hourHeight}px`;
        marker.dataset.label = timeFromMinutes(state.targetMinute);
      }
    }

    function finishMove(event) {
      const state = moveState;
      if (!state || state.pointerId !== event.pointerId) return;
      const target = state.targetStage;
      const active = state.active;
      const minute = state.targetMinute;
      clearMoveVisual(state);
      if (!active || !target) return;
      suppressClickUntil = Date.now() + 450;
      moveBooking(state.item,target.dataset.teamPerformer,target.dataset.teamDate,minute,target.dataset.teamLocation);
    }

    async function setMode(nextMode) {
      if (nextMode !== 'team' || !canUseTeamCalendar() || availability === 'unsupported') {
        mode = 'personal';
        updateControls();
        onModeChange(false);
        renderLegacy();
        return;
      }
      mode = 'team';
      onModeChange(true);
      updateControls();
      await load();
    }

    function handleChange(event) {
      if (event.target.id === 'teamCalendarLocation') {
        locationId = event.target.value || '';
        if (resourceId && !resources.some(item => item.id === resourceId && (!locationId || item.location_id === locationId))) resourceId = '';
      } else if (event.target.id === 'teamCalendarPerformer') performerId = event.target.value || '';
      else if (event.target.id === 'teamCalendarResource') resourceId = event.target.value || '';
      else return;
      updateControls();
      render(getHolder());
    }

    function handleHolderClick(event) {
      const bookingButton = event.target.closest?.('[data-team-booking-id]');
      if (bookingButton) {
        if (Date.now() < suppressClickUntil) return;
        const item = rows.find(row => row.id === bookingButton.dataset.teamBookingId);
        if (item) openBookingDetails(item);
        return;
      }
      const surface = event.target.closest?.('[data-team-slot-surface]');
      if (!surface || Date.now() < suppressClickUntil) return;
      const stage = surface.closest('[data-team-stage]');
      if (!stage) return;
      openCreateBooking(stage.dataset.teamPerformer,stage.dataset.teamDate,stageMinute(stage,event.clientY),stage.dataset.teamLocation);
    }

    function bind() {
      if (bound) return;
      bound = true;
      $$('[data-calendar-mode]').forEach(button => button.addEventListener('click',() => setMode(button.dataset.calendarMode)));
      $('#teamCalendarLocation')?.addEventListener('change',handleChange);
      $('#teamCalendarPerformer')?.addEventListener('change',handleChange);
      $('#teamCalendarResource')?.addEventListener('change',handleChange);
      const holder = getHolder();
      holder?.addEventListener('click',handleHolderClick);
      holder?.addEventListener('pointerdown',event => {
        const card = event.target.closest?.('[data-team-booking-id]');
        if (card) beginMove(event,card);
      });
      if (typeof document !== 'undefined') {
        document.addEventListener('pointermove',updateMove,{ passive:false });
        document.addEventListener('pointerup',finishMove);
        document.addEventListener('pointercancel',finishMove);
      }
      updateControls();
    }

    return { bind,load,render,reset,setOrganization,setMode,get isTeamMode() { return mode === 'team'; },get dispatcherEnabled() { return dispatcherActions; } };
  }

  window.MinutaTeamCalendar = { createController };
})();
