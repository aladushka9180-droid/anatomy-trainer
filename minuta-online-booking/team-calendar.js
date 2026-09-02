(function () {
  'use strict';

  const allowedRoles = new Set(['owner', 'admin']);
  const statusLabels = { new: 'Новая', confirmed: 'Подтверждена', completed: 'Состоялась', no_show: 'Не пришли', cancelled: 'Отменена' };

  function minutesFromTime(value) {
    const [hours = 0, minutes = 0] = String(value || '').split(':').map(Number);
    return (hours * 60) + minutes;
  }

  function timeFromMinutes(value) {
    const normalized = ((Number(value) % 1440) + 1440) % 1440;
    return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
  }

  function createController(options) {
    const { db, $, $$, escapeHtml, getCurrentUser, getSessionGeneration, sessionIsCurrent, getSelectedDate, getHolder, onModeChange, renderLegacy } = options;
    let organization = null;
    let rows = [];
    let locations = [];
    let members = [];
    let resources = [];
    let mode = 'personal';
    let availability = null;
    let locationId = '';
    let performerId = '';
    let resourceId = '';
    let resourceCalendar = false;
    let requestRevision = 0;
    let loadedDate = '';
    let bound = false;

    function canUseTeamCalendar(value = organization) {
      return Boolean(value?.id && allowedRoles.has(value.current_role) && value.can_manage !== false);
    }

    function isMissingRpc(error) {
      const text = `${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`;
      return /(?:PGRST202|42883)/i.test(text) || /function\s+[^\n]*get_minuta_team_calendar[^\n]*does not exist/i.test(text);
    }

    function reset() {
      requestRevision += 1;
      organization = null;
      rows = [];
      locations = [];
      members = [];
      resources = [];
      mode = 'personal';
      availability = null;
      locationId = '';
      performerId = '';
      resourceId = '';
      resourceCalendar = false;
      loadedDate = '';
      updateControls();
      onModeChange?.(false);
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
      rows = [];
      locations = [];
      members = [];
      resources = [];
      locationId = '';
      performerId = '';
      resourceId = '';
      resourceCalendar = false;
      loadedDate = '';
      availability = next ? null : 'forbidden';
      mode = 'personal';
      updateControls();
      onModeChange?.(false);
      renderLegacy?.();
      if (next) Promise.resolve().then(() => {
        if (organization?.id === next.id && availability === null) load();
      });
    }

    function normalizePayload(payload) {
      const source = payload?.calendar || payload || {};
      const payloadOrganization = source.organization || organization || {};
      const normalizedLocations = Array.isArray(source.locations) ? source.locations : [];
      const normalizedMembers = Array.isArray(source.performers) ? source.performers : (Array.isArray(source.members) ? source.members : []);
      const normalizedResources = Array.isArray(source.resources) ? source.resources : [];
      const rawRows = Array.isArray(source.bookings) ? source.bookings : (Array.isArray(source.rows) ? source.rows : []);
      return {
        available: source.available !== false && allowedRoles.has(payloadOrganization.current_role || organization?.current_role),
        locations: normalizedLocations.filter(item => item?.id && item.active !== false),
        members: normalizedMembers.map(item => ({ ...item, user_id: item?.user_id || item?.id })).filter(item => item.user_id && item.active !== false && item.is_bookable !== false),
        rows: rawRows.map(item => ({
          id: String(item?.id || ''),
          performer_id: String(item?.performer_id || item?.performer?.id || ''),
          performer_name: String(item?.performer_name || item?.performer?.display_name || item?.performer_profiles?.display_name || 'Специалист'),
          location_id: String(item?.location_id || item?.location?.id || ''),
          location_name: String(item?.location_name || item?.location?.name || 'Без филиала'),
          service_name: String(item?.service_name || item?.services?.name || 'Услуга'),
          client_name: String(item?.client_name || 'Клиент'),
          client_phone: String(item?.client_phone || ''),
          booking_date: String(item?.booking_date || ''),
          booking_time: String(item?.booking_time || '').slice(0, 5),
          duration_minutes: Number(item?.duration_minutes || item?.services?.duration_minutes || 0),
          status: String(item?.status || item?.visit_status || 'new'),
          resources: (Array.isArray(item?.resources) ? item.resources : []).map(resource => ({
            id: String(resource?.id || ''),
            name: String(resource?.name || 'Ресурс'),
            group_name: String(resource?.group_name || '')
          })).filter(resource => resource.id)
        })).filter(item => item.id && item.performer_id && /^\d{4}-\d{2}-\d{2}$/.test(item.booking_date)),
        resources: normalizedResources.map(item => ({
          id: String(item?.id || ''),
          name: String(item?.name || 'Ресурс'),
          location_id: String(item?.location_id || ''),
          group_name: String(item?.group_name || ''),
          active: item?.active !== false
        })).filter(item => item.id)
      };
    }

    async function load() {
      if (!canUseTeamCalendar()) return { ok: false, optional: true, forbidden: true };
      const userId = getCurrentUser()?.id;
      const generation = getSessionGeneration();
      const revision = ++requestRevision;
      const date = getSelectedDate();
      if (!userId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, optional: true };
      availability = 'loading';
      updateControls();
      render(getHolder());
      const commonParameters = { p_organization: organization.id, p_start: date, p_end: date, p_location: null, p_performer: null };
      let { data, error } = await db.rpc('get_minuta_team_calendar_v2', { ...commonParameters, p_resource: null });
      let loadedResourceCalendar = !error;
      if (error && isMissingRpc(error)) {
        ({ data, error } = await db.rpc('get_minuta_team_calendar', commonParameters));
        loadedResourceCalendar = false;
      }
      if (!sessionIsCurrent(userId, generation) || revision !== requestRevision) return { ok: false, optional: true, stale: true };
      if (error) {
        rows = [];
        locations = [];
        members = [];
        resources = [];
        loadedDate = '';
        if (isMissingRpc(error)) {
          availability = 'unsupported';
          mode = 'personal';
          updateControls();
          onModeChange?.(false);
          renderLegacy?.();
          return { ok: false, optional: true, unsupported: true };
        }
        availability = 'error';
        updateControls();
        render(getHolder());
        return { ok: false, optional: true };
      }
      const normalized = normalizePayload(data);
      if (!normalized.available) {
        availability = 'forbidden';
        mode = 'personal';
        updateControls();
        onModeChange?.(false);
        renderLegacy?.();
        return { ok: false, optional: true, forbidden: true };
      }
      rows = normalized.rows;
      locations = normalized.locations;
      members = normalized.members;
      resources = normalized.resources;
      resourceCalendar = loadedResourceCalendar;
      loadedDate = date;
      availability = 'ready';
      if (locationId && !locations.some(item => item.id === locationId)) locationId = '';
      if (performerId && !members.some(item => item.user_id === performerId)) performerId = '';
      if (resourceId && !resources.some(item => item.id === resourceId && (!locationId || item.location_id === locationId))) resourceId = '';
      updateControls();
      render(getHolder());
      return { ok: true, optional: true };
    }

    function updateControls() {
      const toolbar = $('#teamCalendarToolbar');
      const filters = $('#teamCalendarFilters');
      const status = $('#teamCalendarStatus');
      const supported = canUseTeamCalendar() && (availability === 'ready' || availability === 'error');
      if (toolbar) toolbar.hidden = !supported;
      if (filters) filters.hidden = mode !== 'team' || availability !== 'ready';
      $$('[data-calendar-mode]').forEach(button => {
        const active = button.dataset.calendarMode === mode;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      if (status) {
        status.textContent = mode !== 'team' ? '' : availability === 'loading' ? 'Загружаем календарь команды…' : availability === 'error' ? 'Календарь команды временно недоступен. Личные записи не изменены.' : '';
      }
      const resourceField = $('#teamCalendarResourceField');
      if (availability !== 'ready') {
        if (resourceField) resourceField.hidden = true;
        return;
      }
      const locationSelect = $('#teamCalendarLocation');
      const performerSelect = $('#teamCalendarPerformer');
      const resourceSelect = $('#teamCalendarResource');
      if (locationSelect) {
        locationSelect.innerHTML = `<option value="">Все филиалы</option>${locations.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === locationId ? 'selected' : ''}>${escapeHtml(item.name || 'Филиал')}</option>`).join('')}`;
      }
      if (performerSelect) {
        performerSelect.innerHTML = `<option value="">Все специалисты</option>${members.map(item => `<option value="${escapeHtml(item.user_id)}" ${item.user_id === performerId ? 'selected' : ''}>${escapeHtml(item.display_name || 'Специалист')}</option>`).join('')}`;
      }
      const selectableResources = resources.filter(item => item.active && (!locationId || item.location_id === locationId));
      if (resourceField) resourceField.hidden = !resourceCalendar || selectableResources.length === 0;
      if (resourceSelect) {
        resourceSelect.innerHTML = `<option value="">Все ресурсы</option>${selectableResources.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === resourceId ? 'selected' : ''}>${escapeHtml(item.group_name ? `${item.group_name} · ${item.name}` : item.name)}</option>`).join('')}`;
      }
    }

    function filteredRows() {
      const date = getSelectedDate();
      return rows.filter(item => item.booking_date === date)
        .filter(item => !performerId || item.performer_id === performerId)
        .filter(item => !locationId || item.location_id === locationId)
        .filter(item => !resourceId || item.resources.some(resource => resource.id === resourceId))
        .sort((a, b) => `${a.performer_name}|${a.booking_time}|${a.id}`.localeCompare(`${b.performer_name}|${b.booking_time}|${b.id}`, 'ru'));
    }

    function render(holder = getHolder()) {
      if (!holder || mode !== 'team') return false;
      if (availability === 'loading' || (availability === 'ready' && loadedDate !== getSelectedDate())) {
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
      const groups = new Map();
      visible.forEach(item => {
        const key = item.performer_id;
        if (!groups.has(key)) groups.set(key, { name: item.performer_name, items: [] });
        groups.get(key).items.push(item);
      });
      holder.className = 'provider-bookings schedule-list team-calendar-list';
      holder.innerHTML = groups.size ? [...groups.values()].map(group => `<section class="team-calendar-group" aria-label="${escapeHtml(group.name)}"><div class="team-calendar-group-head"><h3>${escapeHtml(group.name)}</h3><span>${group.items.length}</span></div>${group.items.map(bookingMarkup).join('')}</section>`).join('') : '<div class="provider-empty schedule-empty"><strong>Записей команды нет</strong><small>Измените филиал, специалиста или дату.</small></div>';
      const status = $('#teamCalendarStatus');
      if (status) status.textContent = `Показано записей команды: ${visible.length}`;
      return true;
    }

    function bookingMarkup(item) {
      const startTime = String(item.booking_time).slice(0, 5);
      const durationMinutes = Number(item.duration_minutes || 0);
      const endTime = timeFromMinutes(minutesFromTime(startTime) + durationMinutes);
      const duration = durationMinutes > 0 ? `${durationMinutes} мин` : '';
      const phone = item.client_phone ? escapeHtml(item.client_phone) : '';
      const clientMeta = [phone, duration].filter(Boolean).join(' · ');
      const resourceNames = item.resources.map(resource => resource.name).filter(Boolean);
      const resourceLine = resourceNames.length ? `<span class="team-calendar-resource">${escapeHtml(resourceNames.join(' · '))}</span>` : '';
      const statusClass = String(item.status || 'new').replaceAll('_', '-');
      return `<article class="provider-booking team-calendar-booking status-${escapeHtml(statusClass)}"><div class="booking-time-column"><strong>${escapeHtml(startTime)}${durationMinutes > 0 ? `<small>до ${escapeHtml(endTime)}</small>` : ''}</strong><span>${escapeHtml(item.location_name)}</span></div><div class="booking-main"><span class="provider-booking-top"><h3>${escapeHtml(item.service_name)}</h3><span class="booking-status">${escapeHtml(statusLabels[item.status] || item.status)}</span></span><span class="provider-booking-client-line team-calendar-client-line"><strong>${escapeHtml(item.client_name)}</strong>${clientMeta ? `<span>${clientMeta}</span>` : ''}</span>${resourceLine}</div></article>`;
    }

    async function setMode(nextMode) {
      if (nextMode !== 'team' || !canUseTeamCalendar() || availability === 'unsupported') {
        mode = 'personal';
        updateControls();
        onModeChange?.(false);
        renderLegacy?.();
        return;
      }
      mode = 'team';
      onModeChange?.(true);
      updateControls();
      await load();
    }

    function handleChange(event) {
      if (event.target.id === 'teamCalendarLocation') {
        locationId = event.target.value || '';
        if (resourceId && !resources.some(item => item.id === resourceId && (!locationId || item.location_id === locationId))) resourceId = '';
      }
      else if (event.target.id === 'teamCalendarPerformer') performerId = event.target.value || '';
      else if (event.target.id === 'teamCalendarResource') resourceId = event.target.value || '';
      else return;
      updateControls();
      render(getHolder());
    }

    function bind() {
      if (bound) return;
      bound = true;
      $$('[data-calendar-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.calendarMode)));
      $('#teamCalendarLocation')?.addEventListener('change', handleChange);
      $('#teamCalendarPerformer')?.addEventListener('change', handleChange);
      $('#teamCalendarResource')?.addEventListener('change', handleChange);
      updateControls();
    }

    return {
      bind,
      load,
      refresh: () => mode === 'team' ? load() : Promise.resolve({ ok: true, optional: true }),
      render,
      reset,
      setOrganization,
      setMode,
      get isTeamMode() { return mode === 'team'; },
      get availability() { return availability; }
    };
  }

  window.MinutaTeamCalendar = { createController };
})();
