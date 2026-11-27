// BEGIN S10 OPTIONAL BRANCH BINDINGS
// Core keeps cold-offline All. Load these bindings with the statistics extension before branch admission.
// S10 optional override: reportUsesScopedBookings
function reportUsesScopedBookings() {
  return reportDataSource === 'demo' || reportCanViewTeam || Boolean(window.MinutaStatisticsBranchRuntime?.enabled && window.MinutaStatisticsBranchRuntime.locationId);
}

// S10 optional override: loadSelectedReportData
function loadSelectedReportData() {
  if (reportDataSource !== 'demo') {
    stopReportDemoUpdates();
    if (reportUsesScopedBookings()) {
      const range = reportRange();
      const previous = previousReportRange(range);
      void loadReportScopedBookings({ start:previous?.start || range.start, end:reportForecastEnd(range) }, reportPerformerFilter || 'all');
      void loadReportAvailability(range, reportPerformerFilter || 'all');
    }
    return;
  }
  startReportDemoUpdates();
  reportCanViewTeam = true;
  if (!reportPerformerFilter) reportPerformerFilter = 'all';
  const range = reportRange();
  const previous = previousReportRange(range);
  void loadReportScopedBookings({ start:previous?.start || range.start, end:reportForecastEnd(range) }, reportPerformerFilter);
  void loadReportAvailability(range, reportPerformerFilter);
}

// S10 optional override: reportStatisticsRpc
function reportStatisticsRpc(name, args) {
  const branch = window.MinutaStatisticsBranchRuntime;
  return branch?.enabled ? branch.readLegacy(name, args) : db.rpc(name, args);
}

// S10 optional override: reportHistoryBookings
function reportHistoryBookings() {
  if (reportUsesScopedBookings() && reportScopedBookingsState.status === 'ready') return reportScopedBookingsState.rows;
  return window.MinutaStatisticsBranchRuntime?.enabled && window.MinutaStatisticsBranchRuntime.locationId ? [] : allBookings;
}

// S10 optional override: reportBranchImportedHistory
function reportBranchImportedHistory() {
  return window.MinutaStatisticsBranchRuntime?.enabled && window.MinutaStatisticsBranchRuntime.locationId ? [] : importedBookingHistory;
}

// S10 optional override: reportSessionKey
function reportSessionKey(organizationId, ...parts) {
  const branch = window.MinutaStatisticsBranchRuntime;
  const base = [sessionGeneration, currentUser?.id || '', organizationId || '', ...parts];
  if (branch?.enabled) base.push(branch.token);
  return base.join(':');
}

// S10 optional override: reportRange
function reportRange(period = reportPeriod) {
  const todayIso = reportTodayIso();
  const today = parseLocalIsoDate(todayIso);
  let start = todayIso;
  let end = todayIso;
  if (period === 'week') start = localIsoDate(new Date(today.getTime() - 6 * 86400000));
  if (period === 'last30') start = localIsoDate(new Date(today.getTime() - 29 * 86400000));
  if (period === 'month') start = localIsoDate(new Date(today.getFullYear(), today.getMonth(), 1));
  if (period === 'quarter') start = localIsoDate(new Date(today.getTime() - 89 * 86400000));
  if (period === 'year') start = localIsoDate(new Date(today.getFullYear(), 0, 1));
  if (period === 'all') {
    if (reportDataSource === 'demo') start = localIsoDate(new Date(today.getFullYear(), today.getMonth() - 3, 1));
    else {
      const organizationId = reportOrganizationId();
      const liveSource = reportHistoryBookings();
      const dates = [...liveSource, ...reportBranchImportedHistory()]
        .filter(item => !isScheduleBlock(item)
          && item.booking_date <= todayIso
          && (!organizationId || !item.organization_id || String(item.organization_id) === String(organizationId)))
        .map(item => item.booking_date)
        .sort();
      start = dates[0] || todayIso;
      const financialRange = window.MinutaStatisticsAuditProvider?.financialBounds?.({
        period, end, organizationId, performerId:reportPerformerFilter
      });
      if (financialRange?.end === end && /^\d{4}-\d{2}-\d{2}$/.test(financialRange.start)
          && financialRange.start <= end) start = [start, financialRange.start].sort()[0];
    }
  }
  if (period === 'custom') {
    start = reportCustomStart || todayIso;
    end = reportCustomEnd || todayIso;
  }
  return { start, end, period };
}

// S10 optional override: reportBookings
function reportBookings(range = reportRange()) {
  const liveSource = reportUsesScopedBookings() ? (reportScopedBookingsState.status === 'ready' ? reportScopedBookingsState.rows : []) : allBookings;
  const source = [...liveSource, ...(reportDataSource === 'demo' ? [] : reportBranchImportedHistory())];
  const organizationId = reportOrganizationId();
  return source.filter(item => !isScheduleBlock(item)
    && item.booking_date >= range.start && item.booking_date <= range.end
    && (!organizationId || !item.organization_id || String(item.organization_id) === String(organizationId))
    && (!reportCanViewTeam || !reportPerformerFilter || reportPerformerFilter === 'all' || reportEffectivePerformerId(item) === reportPerformerFilter));
}

// S10 optional override: reportClientMetrics
function reportClientMetrics(completed, range) {
  const currentClients = new Set(completed.map(reportClientIdentity).filter(Boolean));
  const liveSource = reportHistoryBookings();
  const organizationId = reportOrganizationId();
  const importedSource = reportDataSource === 'demo' ? [] : reportBranchImportedHistory().filter(item =>
    !organizationId || !item.organization_id || String(item.organization_id) === String(organizationId));
  const source = [...liveSource, ...importedSource];
  const previousClients = new Set(reportCompletedItems(source.filter(item => !isScheduleBlock(item) && item.booking_date < range.start)).map(reportClientIdentity).filter(Boolean));
  const firstCurrentVisit = new Map();
  completed.forEach(item => {
    const key = reportClientIdentity(item);
    if (!key) return;
    const moment = `${item.booking_date || ''}T${String(item.booking_time || '00:00').slice(0, 5)}`;
    const current = firstCurrentVisit.get(key);
    if (!current || moment < current.moment) firstCurrentVisit.set(key, { moment, item });
  });
  firstCurrentVisit.forEach(({ item }, key) => { if (item.client_had_previous) previousClients.add(key); });
  let newClients = 0;
  let returningClients = 0;
  currentClients.forEach(key => {
    if (previousClients.has(key)) returningClients += 1;
    else newClients += 1;
  });
  return { uniqueClients:currentClients.size, newClients, returningClients };
}

// S10 optional override: reportAvailableScheduleMinutes
function reportAvailableScheduleMinutes(range) {
  if (reportUsesScopedBookings()) {
    const organizationId = reportOrganizationId();
    const key = reportSessionKey(organizationId, range.start, range.end, reportPerformerFilter || 'all');
    if (reportAvailabilityState.key === key && reportAvailabilityState.status === 'ready' && reportAvailabilityState.complete) return reportAvailabilityState.availableMinutes;
    return null;
  }
  const rowsByWeekday = new Map(scheduleRows.map(row => [Number(row.weekday), row]));
  if ([1, 2, 3, 4, 5, 6, 7].some(weekday => !rowsByWeekday.has(weekday))) return null;
  const start = parseLocalIsoDate(range.start);
  const end = parseLocalIsoDate(range.end);
  const days = Math.round((end - start) / 86400000) + 1;
  if (!Number.isFinite(days) || days < 1 || days > 3660) return null;
  let available = 0;
  for (let offset = 0; offset < days; offset += 1) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset);
    const dateIso = localIsoDate(date);
    const weekday = ((date.getDay() + 6) % 7) + 1;
    const row = rowsByWeekday.get(weekday);
    if (row.enabled === false) continue;
    const dayStart = minutesFromTime(row.start_time);
    const dayEnd = minutesFromTime(row.end_time);
    if (!/^\d{2}:\d{2}/.test(String(row.start_time || '')) || !/^\d{2}:\d{2}/.test(String(row.end_time || '')) || dayEnd <= dayStart) return null;
    let dayMinutes = dayEnd - dayStart;
    if (row.break_enabled) {
      const breakStartValue = row.break_start_time || row.break_start;
      const breakEndValue = row.break_end_time || row.break_end;
      const breakStart = minutesFromTime(breakStartValue);
      const breakEnd = minutesFromTime(breakEndValue);
      if (!/^\d{2}:\d{2}/.test(String(breakStartValue || '')) || !/^\d{2}:\d{2}/.test(String(breakEndValue || '')) || breakEnd <= breakStart) return null;
      dayMinutes -= Math.max(0, Math.min(dayEnd, breakEnd) - Math.max(dayStart, breakStart));
    }
    const exceptions = daysOff.filter(item => String(item.date || item.day_off_date || '') === dateIso);
    for (const exception of exceptions) {
      if (exception.all_day === true || exception.is_all_day === true) {
        dayMinutes = 0;
        break;
      }
      const exceptionStartValue = exception.start_time;
      const exceptionEndValue = exception.end_time;
      if (!/^\d{2}:\d{2}/.test(String(exceptionStartValue || '')) || !/^\d{2}:\d{2}/.test(String(exceptionEndValue || ''))) return null;
      dayMinutes -= Math.max(0, Math.min(dayEnd, minutesFromTime(exceptionEndValue)) - Math.max(dayStart, minutesFromTime(exceptionStartValue)));
    }
    available += Math.max(0, dayMinutes);
  }
  return available;
}

// S10 optional override: ensureReportRetention
async function ensureReportRetention() {
  const branch = window.MinutaStatisticsBranchRuntime;
  if (branch?.enabled && branch.locationId && reportSubview === 'clients' && reportDataSource === 'own') {
    const range = reportRange();
    try { await branch.read('retention', { start:range.start, end:range.end }); } catch {}
    renderReportRetention(); return;
  }
  if (reportSubview !== 'clients' || reportDataSource === 'demo' || retentionController?.availability === 'ready' || retentionController?.availability === 'loading') return;
  renderReportRetention();
  try { await ensureOrganizationFeature('retentionPanel'); }
  catch {}
  if (reportSubview === 'clients') renderReportRetention();
}

// S10 optional override: loadReportAvailability
async function loadReportAvailability(range, performerId) {
  if (!reportUsesScopedBookings() || !currentUser || !navigator.onLine) return;
  const userId = currentUser.id;
  const generation = sessionGeneration;
  const organizationId = reportOrganizationId();
  const key = reportSessionKey(organizationId, range.start, range.end, performerId);
  if (!organizationId || reportAvailabilityState.key === key && ['loading','ready'].includes(reportAvailabilityState.status)) return;
  reportAvailabilityState = { key, status:'loading', availableMinutes:null, configured:0, total:0, complete:false };
  const { data, error } = await reportStatisticsRpc('get_minuta_staff_report_availability', { p_organization:organizationId, p_start:range.start, p_end:range.end, p_performer:performerId === 'all' ? null : performerId });
  if (!sessionIsCurrent(userId, generation) || reportAvailabilityState.key !== key) return;
  const configured = Number(data?.configured_performers || 0);
  const total = Number(data?.total_performers || 0);
  const complete = Number(data?.completeness_version || 0) >= 2 && data?.complete === true;
  reportAvailabilityState = error
    ? { key, status:'failed', availableMinutes:null, configured:0, total:0, complete:false }
    : { key, status:'ready', availableMinutes:Number(data?.available_minutes || 0), configured, total, complete };
  renderAnalytics();
}

// S10 optional override: loadReportScopedBookings
async function loadReportScopedBookings(range, performerId) {
  if ((!reportCanViewTeam && !(window.MinutaStatisticsBranchRuntime?.enabled && window.MinutaStatisticsBranchRuntime.locationId)) || !currentUser) return;
  range = reportDataQueryRange(range);
  const userId = currentUser.id;
  const generation = sessionGeneration;
  const organizationId = reportOrganizationId();
  const key = reportSessionKey(organizationId, range.start, range.end, performerId);
  if (!organizationId || reportScopedBookingsState.key === key && ['loading','ready'].includes(reportScopedBookingsState.status)) return;
  if (bookingUsesDemoData() && reportDemoBaseReady) {
    const applied = applyReportDemoLiveRows(reportRange(), range);
    if (applied.result) {
      document.body.classList.remove('report-scope-loading');
      const select = $('#reportPerformerFilter');
      const exportButton = $('#exportBookings');
      if (select) select.disabled = false;
      if (exportButton) exportButton.disabled = false;
      renderAnalytics();
      if ($('#dashboard')?.dataset.activeView === 'bookings') {
        prepareDemoBookingContext();
        updateBookingStats();
        renderBookings();
      }
      return;
    }
  }
  if (!navigator.onLine && bookingUsesDemoData()) {
    const applied = applyReportDemoLiveRows(reportRange(), range);
    if (applied.result) {
      reportScopedBookingsState = { key, status:'ready', rows:applied.rows };
      document.body.classList.remove('report-scope-loading');
      renderAnalytics();
      if ($('#dashboard')?.dataset.activeView === 'bookings') {
        prepareDemoBookingContext();
        updateBookingStats();
        renderBookings();
      }
    }
    return;
  }
  reportScopedBookingsState = { key, status:'loading', rows:[] };
  document.body.classList.add('report-scope-loading');
  const select = $('#reportPerformerFilter');
  const exportButton = $('#exportBookings');
  if (select) select.disabled = true;
  if (exportButton) exportButton.disabled = true;
  const rows = [];
  const pageSize = 1000;
  const maxRows = 100000;
  let error = navigator.onLine ? null : new Error('offline');
  let rpcName = 'get_minuta_staff_report_bookings_v97';
  const windows = error ? [] : reportQueryWindows(range);
  for (const queryWindow of windows) {
    for (let offset = 0; offset <= maxRows; offset += pageSize) {
      let response = await reportStatisticsRpc(rpcName, {
        p_organization:organizationId,
        p_start:queryWindow.start,
        p_end:queryWindow.end,
        p_performer:performerId === 'all' ? null : performerId,
        p_limit:pageSize,
        p_offset:offset
      });
      const missingRpc = candidate => candidate?.error && (candidate.error.code === 'PGRST202' || /could not find.*get_minuta_staff_report_bookings|function .* does not exist/i.test(candidate.error.message || ''));
      if (offset === 0 && missingRpc(response)) {
        rpcName = 'get_minuta_staff_report_bookings';
        response = await reportStatisticsRpc(rpcName, { p_organization:organizationId, p_start:queryWindow.start, p_end:queryWindow.end, p_performer:performerId === 'all' ? null : performerId, p_limit:pageSize, p_offset:offset });
        if (missingRpc(response)) response = await reportStatisticsRpc(rpcName, { p_organization:organizationId, p_start:queryWindow.start, p_end:queryWindow.end, p_performer:performerId === 'all' ? null : performerId });
      }
      if (!sessionIsCurrent(userId, generation) || reportScopedBookingsState.key !== key) return;
      const data = response.data;
      error = response.error;
      if (error) break;
      rows.push(...(Array.isArray(data?.bookings) ? data.bookings : []));
      if (!data?.has_more) break;
      if (rows.length >= maxRows) { error = new Error('Слишком большой объём отчёта'); break; }
    }
    if (error) break;
  }
  if (!sessionIsCurrent(userId, generation) || reportScopedBookingsState.key !== key) return;
  if (bookingUsesDemoData()) {
    if (!error) reportDemoBaseRows = mergeReportDemoRows(rows);
    reportDemoBaseReady = !error;
    const applied = applyReportDemoLiveRows(reportRange(), range);
    reportScopedBookingsState = applied.result ? { key, status:'ready', rows:applied.rows } : { key, status:error ? 'failed' : 'ready', rows };
  } else if (error) reportScopedBookingsState = { key, status:'failed', rows:[] };
  else reportScopedBookingsState = { key, status:'ready', rows, receivedAt:new Date().toISOString() };
  document.body.classList.remove('report-scope-loading');
  if (select) select.disabled = false;
  if (exportButton) exportButton.disabled = false;
  if (error && bookingUsesDemoData() && $('#dashboard')?.dataset.activeView === 'bookings') renderBookings();
  if (error && !bookingUsesDemoData()) { renderAnalytics(); notify('Не удалось загрузить статистику сотрудника'); return; }
  renderAnalytics();
  if (bookingUsesDemoData() && $('#dashboard')?.dataset.activeView === 'bookings') {
    prepareDemoBookingContext();
    updateBookingStats();
    renderBookings();
  }
}

// S10 optional override: loadReportTeamAnalytics
async function loadReportTeamAnalytics(range) {
  const panel = $('#reportPerformers');
  if (!panel || !currentUser || !navigator.onLine) { if (panel) panel.hidden = true; return; }
  const userId = currentUser.id;
  const generation = sessionGeneration;
  const organizationId = reportOrganizationId();
  if (!organizationId) { panel.hidden = true; return; }
  range = reportDataQueryRange(range);
  const key = reportSessionKey(organizationId, range.start, range.end);
  if (reportTeamAnalyticsState.key === key) {
    if (reportTeamAnalyticsState.status === 'ready') { renderReportTeamRows(reportTeamAnalyticsState.rows); renderReportPerformerFilter(range); }
    return;
  }
  const priorCanViewTeam = reportCanViewTeam;
  const wideRange = reportRangeDays(range) > 3661;
  const permissionRange = wideRange ? reportQueryWindows(range).at(-1) : range;
  reportTeamAnalyticsState = { key, status:'loading', rows:[], canViewTeam:false };
  const requestState = reportTeamAnalyticsState;
  panel.hidden = true;
  let response = await reportStatisticsRpc('get_minuta_team_analytics', { p_organization:organizationId, p_start:permissionRange.start, p_end:permissionRange.end });
  let legacy = false;
  if (!sessionIsCurrent(userId, generation) || reportTeamAnalyticsState !== requestState) return;
  if (response.error && (response.error.code === 'PGRST202' || /could not find.*get_minuta_team_analytics|function .* does not exist/i.test(response.error.message || ''))) {
    legacy = true;
    response = await reportStatisticsRpc('get_minuta_team_analytics', { p_start:permissionRange.start, p_end:permissionRange.end });
  }
  const { data, error } = response;
  if (!sessionIsCurrent(userId, generation) || reportTeamAnalyticsState !== requestState) return;
  const foreignScope = legacy ? data?.organization_id !== organizationId : data?.organization_id && data.organization_id !== organizationId;
  if (error || foreignScope) {
    reportCanViewTeam = foreignScope ? false : priorCanViewTeam;
    reportTeamAnalyticsState = { key, status:'failed', rows:[], canViewTeam:reportCanViewTeam };
    if (reportCanViewTeam) {
      renderReportTeamRows([]);
      renderReportPerformerFilter(range);
    } else { panel.hidden = true; renderReportPerformerFilter(range); }
    return;
  }
  let rows = Array.isArray(data) ? data : Array.isArray(data?.performers) ? data.performers : [];
  if (wideRange) rows = rows.map(row => ({ ...row, payroll_rub:null }));
  reportCanViewTeam = Boolean(data?.can_view_team);
  reportTeamAnalyticsState = { key, status:'ready', rows, canViewTeam:reportCanViewTeam };
  renderReportTeamRows(rows);
  renderReportPerformerFilter(range);
}

// S10 optional override: renderReportUtmFunnel
function renderReportUtmFunnel() {
  const card = $('#reportUtmFunnelCard');
  const status = $('#reportUtmFunnelState');
  const stages = $('#reportUtmFunnelStages');
  const outcomes = $('#reportUtmFunnelOutcomes');
  const sources = $('#reportUtmFunnelSources');
  if (!card || !status || !stages || !outcomes || !sources) return;
  card.hidden = reportDataSource === 'demo';
  if (card.hidden) return;
  const state = reportUtmFunnelState;
  const messages = { idle:'Подключаем аналитику переходов…', loading:'Загружаем путь клиентов…', unavailable:'Сбор воронки подготовлен. Примените серверное обновление v107, чтобы начать получать данные.', failed:'Не удалось загрузить воронку. Остальная статистика продолжает работать.', offline:'Для обновления воронки требуется интернет.' };
  if (state.status !== 'ready') {
    status.hidden = false;
    status.textContent = state.status === 'unavailable' && window.MinutaStatisticsBranchRuntime?.locationId ? 'Для выбранного филиала нет подтверждённого источника воронки.' : messages[state.status] || messages.idle;
    stages.hidden = outcomes.hidden = sources.hidden = true;
    return;
  }
  const sourceRows = Array.isArray(state.data?.rows) ? state.data.rows : [];
  const testRows = sourceRows.filter(reportUtmIsTestSource);
  const rows = sourceRows.filter(row => !reportUtmIsTestSource(row));
  const totals = testRows.length ? reportUtmTotals(rows) : state.data?.totals || {};
  const visitors = Math.max(0, Number(totals.visitors) || 0);
  if (!visitors && !Number(totals.bookings) && !rows.length && !testRows.length) {
    status.hidden = false;
    status.textContent = 'За этот период пока нет данных о переходах. Они появятся после посещений страницы записи.';
    stages.hidden = outcomes.hidden = sources.hidden = true;
    return;
  }
  const percent = value => visitors ? `${Math.round((Number(value) || 0) / visitors * 100)}%` : '—';
  const stageRows = [
    ['Открыли страницу', totals.visitors, visitors ? '100%' : '—'],
    ['Выбрали услугу', totals.service_selected, percent(totals.service_selected)],
    ['Посмотрели время', totals.slots_viewed, percent(totals.slots_viewed)],
    ['Начали оформление', totals.details_started, percent(totals.details_started)],
    ['Создали запись', totals.bookings, percent(totals.bookings)]
  ];
  status.hidden = true;
  stages.hidden = false;
  stages.innerHTML = stageRows.map(([label,value,share], index) => `<article><small>${index + 1}</small><span>${escapeHtml(label)}</span><strong>${Number(value) || 0}</strong><em>${share}</em></article>`).join('');
  outcomes.hidden = false;
  outcomes.innerHTML = `<article><small>Пришли</small><strong>${Number(totals.completed) || 0}</strong></article><article><small>Отменили</small><strong>${Number(totals.cancelled) || 0}</strong></article><article><small>Не пришли</small><strong>${Number(totals.no_show) || 0}</strong></article><article><small>Оплатили</small><strong>${Number(totals.paid) || 0}</strong></article><article><small>Получено</small><strong>${money(Number(totals.revenue_rub) || 0)}</strong></article>`;
  sources.hidden = false;
  const testSourceMarkup = testRows.length ? reportUtmTestSourceMarkup(testRows) : '';
  if (!rows.length) {
    sources.innerHTML = testSourceMarkup || '<p class="report-empty-inline">Источники пока не определены. Здесь появятся новые переходы на страницу записи.</p>';
    return;
  }
  sources.innerHTML = `<div class="report-utm-source-head"><span>Источник</span><span>Посетители</span><span>Записи</span><span>Конверсия</span><span>Получено</span></div>${rows.map(row => {
    const rowVisitors = Math.max(0, Number(row.visitors) || 0);
    const bookings = Math.max(0, Number(row.bookings) || 0);
    const conversion = rowVisitors ? Math.round(bookings / rowVisitors * 100) : 0;
    return `<article><div><strong>${escapeHtml(reportUtmSourceTitle(row))}</strong><small>${escapeHtml(reportUtmSourceSubtitle(row))}</small></div><span>${rowVisitors}</span><span>${bookings}</span><span><b>${conversion}%</b><i style="--utm-conversion:${Math.min(100, conversion)}%"></i></span><span>${money(Number(row.revenue_rub) || 0)}</span></article>`;
  }).join('')}${testSourceMarkup}`;
}

// S10 optional override: loadReportUtmFunnel
async function loadReportUtmFunnel(range) {
  const organizationId = reportOrganizationId();
  const key = reportSessionKey(organizationId, range.start, range.end, 'utm');
  if (reportDataSource === 'demo' || !organizationId || !currentUser) return;
  if (!navigator.onLine) { reportUtmFunnelState = { key, status:'offline', data:null }; renderReportUtmFunnel(); return; }
  if (reportUtmFunnelState.key === key && ['loading','ready','unavailable'].includes(reportUtmFunnelState.status)) { renderReportUtmFunnel(); return; }
  const userId = currentUser.id;
  const generation = sessionGeneration;
  reportUtmFunnelState = { key, status:'loading', data:null };
  renderReportUtmFunnel();
  const response = await reportStatisticsRpc('get_minuta_utm_funnel_v107', { p_organization:organizationId, p_start:range.start, p_end:range.end });
  if (!sessionIsCurrent(userId, generation) || reportUtmFunnelState.key !== key) return;
  const unavailable = response.error && (response.error.code === 'S10_METRIC_UNAVAILABLE' || response.error.code === 'PGRST202' || /could not find.*get_minuta_utm_funnel_v107|function .* does not exist/i.test(response.error.message || ''));
  reportUtmFunnelState = response.error ? { key, status:unavailable ? 'unavailable' : 'failed', data:null } : { key, status:'ready', data:response.data || {} };
  renderReportUtmFunnel();
}

// S10 optional override: reportBookingPool
function reportBookingPool() {
  const live = reportHistoryBookings();
  const organizationId = reportOrganizationId();
  const imported = reportDataSource === 'demo' ? [] : reportBranchImportedHistory();
  return [...live, ...imported].filter(item => !isScheduleBlock(item)
    && (!organizationId || !item.organization_id || String(item.organization_id) === String(organizationId))
    && (!reportCanViewTeam || !reportPerformerFilter || reportPerformerFilter === 'all' || String(item.performer_id || '') === reportPerformerFilter));
}

// S10 optional override: reportHeatmapAvailability
function reportHeatmapAvailability(range, bands) {
  if (reportUsesScopedBookings() || !scheduleRows.length || reportRangeDays(range) > 3660) return null;
  const scheduleByWeekday = new Map(scheduleRows.map(row => [Number(row.weekday), row]));
  const result = Array.from({ length:bands.length }, () => Array(7).fill(0));
  const start = parseLocalIsoDate(range.start);
  const days = reportRangeDays(range);
  for (let offset = 0; offset < days; offset += 1) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset);
    const dateIso = localIsoDate(date);
    const weekday = (date.getDay() + 6) % 7;
    const row = scheduleByWeekday.get(weekday + 1);
    if (!row || row.enabled === false) continue;
    const dayStart = minutesFromTime(row.start_time);
    const dayEnd = minutesFromTime(row.end_time);
    if (dayEnd <= dayStart) continue;
    const exceptions = daysOff.filter(item => String(item.date || item.day_off_date || '') === dateIso);
    if (exceptions.some(item => item.all_day === true || item.is_all_day === true)) continue;
    bands.forEach((band, bandIndex) => {
      let minutes = Math.max(0, Math.min(dayEnd, band.to) - Math.max(dayStart, band.from));
      if (row.break_enabled) minutes -= Math.max(0, Math.min(band.to, minutesFromTime(row.break_end_time || row.break_end), dayEnd) - Math.max(band.from, minutesFromTime(row.break_start_time || row.break_start), dayStart));
      exceptions.filter(item => item.start_time && item.end_time).forEach(item => {
        minutes -= Math.max(0, Math.min(band.to, minutesFromTime(item.end_time), dayEnd) - Math.max(band.from, minutesFromTime(item.start_time), dayStart));
      });
      result[bandIndex][weekday] += Math.max(0, minutes);
    });
  }
  return { minutes:result };
}

// S10 optional override: loadReportEvents
async function loadReportEvents(range) {
  const userId=currentUser?.id||'',generation=sessionGeneration,organizationId=reportOrganizationId(),key=reportSessionKey(organizationId,range.start,range.end);
  if(!organizationId||!currentUser||!navigator.onLine){renderReportEvents(reportEventState.key===key?reportEventState.rows:[]);return;}if(reportEventState.key===key&&reportEventState.status==='ready'){renderReportEvents(reportEventState.rows);return;}
  reportEventState={key,rows:[],status:'loading'};
  const rows=[];let error=null;const pageSize=500,maxRows=100000;
  for(let offset=0;offset<=maxRows;offset+=pageSize){
    let response=await reportStatisticsRpc('get_minuta_booking_events_v97',{p_organization:organizationId,p_start:range.start,p_end:range.end,p_limit:pageSize,p_offset:offset});
    if(offset===0&&response.error&&(response.error.code==='PGRST202'||/could not find.*get_minuta_booking_events|function .* does not exist/i.test(response.error.message||''))) response=await reportStatisticsRpc('get_minuta_booking_events',{p_organization:organizationId,p_start:range.start,p_end:range.end,p_limit:100});
    if(!sessionIsCurrent(userId,generation)||reportEventState.key!==key)return;
    const data=response.data;error=response.error;if(error)break;rows.push(...(Array.isArray(data?.events)?data.events:[]));if(!data?.has_more)break;if(rows.length>=maxRows){error=new Error('Слишком большой объём журнала');break;}
  }
  if(!sessionIsCurrent(userId,generation)||reportEventState.key!==key)return;reportEventState=error?{key,rows:[],status:error.code==='S10_METRIC_UNAVAILABLE'?'unavailable':'failed'}:{key,rows,status:'ready'};renderReportEvents(reportEventState.rows.slice(0,100));
}
// END S10 OPTIONAL BRANCH BINDINGS

// Provider bindings for the optional statistics UI. Loaded only after provider.js.
(function () {
  'use strict';
  const range = () => reportRange();
  const visitOverviewPlacements = [];
  let referenceHeaderScope = '';
  let referenceHeaderDisplay = '';
  let referenceHeaderMedia = null;
  let referenceHeaderPerformerWidth = 0;
  let referenceHeaderControlsWidth = 0;
  let referenceHeaderPerformerFlex = '';
  let referenceHeaderPerformerMaxWidth = '';
  let referenceHeaderPerformerBox = null;
  let referenceHeaderPlaceholder = null;
  function refreshReferenceHeader(scope) {
    const head = document.querySelector('#analyticsView .report-head');
    const filters = document.querySelector('#analyticsView .report-filters');
    const performer = document.querySelector('#reportPerformerFilterWrap');
    const summary = document.querySelector('#reportFilterSummary');
    const toggle = document.querySelector('#reportFilterToggle');
    const exportButton = document.querySelector('#exportBookings');
    if (!head || !filters || !performer || !summary || !toggle || !exportButton) return;
    let controls = head.querySelector('.report-reference-controls');
    if (!controls) {
      controls = document.createElement('div');
      controls.className = 'report-reference-controls';
      exportButton.before(controls);
      controls.append(filters);
      toggle.insertAdjacentHTML('afterbegin', '<svg class="report-reference-calendar" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18"/></svg>');
      performer.insertAdjacentHTML('afterbegin', '<svg class="report-reference-team" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v3"/></svg>');
      referenceHeaderMedia = window.matchMedia?.('(min-width:1000px)') || null;
      referenceHeaderMedia?.addEventListener('change', () => refreshReferenceHeader());
      const observer = new MutationObserver(records => {
        if (summary.textContent !== referenceHeaderDisplay) refreshReferenceHeader(summary.textContent);
        else if (records.some(record => record.type === 'attributes')) refreshReferenceHeader();
      });
      observer.observe(summary, { childList:true, characterData:true, subtree:true });
      observer.observe(performer, { attributes:true, attributeFilter:['hidden'] });
    }
    if (scope) referenceHeaderScope = scope;
    if (!referenceHeaderScope) referenceHeaderScope = summary.textContent;
    const desktop = referenceHeaderMedia?.matches === true;
    const target = desktop ? controls : filters.querySelector('.report-toolbar');
    if (target && performer.parentElement !== target) target.append(performer);
    if (desktop && !performer.hidden) {
      referenceHeaderPerformerWidth = performer.getBoundingClientRect().width;
      const style = getComputedStyle(performer);
      referenceHeaderPerformerFlex = style.flex;
      referenceHeaderPerformerMaxWidth = style.maxWidth;
      referenceHeaderPerformerBox = { boxSizing:style.boxSizing, padding:style.padding, border:style.border };
    }
    const waitingForRights = desktop && performer.hidden && referenceHeaderPerformerWidth > 0
      && typeof reportTeamAnalyticsState !== 'undefined'
      && ['idle', 'loading'].includes(reportTeamAnalyticsState.status);
    if (waitingForRights) {
      if (referenceHeaderControlsWidth > 0) controls.style.width = `${referenceHeaderControlsWidth}px`;
      if (!referenceHeaderPlaceholder) {
        referenceHeaderPlaceholder = document.createElement('span');
        referenceHeaderPlaceholder.setAttribute('aria-hidden', 'true');
        referenceHeaderPlaceholder.style.cssText = 'display:block;flex:none;visibility:hidden;height:44px';
      }
      referenceHeaderPlaceholder.style.width = `${referenceHeaderPerformerWidth}px`;
      referenceHeaderPlaceholder.style.flex = referenceHeaderPerformerFlex;
      referenceHeaderPlaceholder.style.maxWidth = referenceHeaderPerformerMaxWidth;
      if (referenceHeaderPerformerBox) Object.assign(referenceHeaderPlaceholder.style, referenceHeaderPerformerBox);
      performer.before(referenceHeaderPlaceholder);
    } else {
      controls.style.removeProperty('width');
      if (referenceHeaderPlaceholder?.isConnected) referenceHeaderPlaceholder.remove();
    }
    referenceHeaderDisplay = desktop && (!performer.hidden || waitingForRights) ? referenceHeaderScope.split(' · ')[0] : referenceHeaderScope;
    if (summary.textContent !== referenceHeaderDisplay) summary.textContent = referenceHeaderDisplay;
    toggle.title = waitingForRights ? `${referenceHeaderDisplay} · Проверяем доступ` : referenceHeaderScope;
    toggle.setAttribute('aria-label', `Период статистики: ${toggle.title}`);
    if (desktop && !performer.hidden) requestAnimationFrame(() => {
      if (!performer.hidden && referenceHeaderMedia?.matches) {
        referenceHeaderPerformerWidth = performer.getBoundingClientRect().width;
        referenceHeaderControlsWidth = controls.getBoundingClientRect().width;
      }
    });
  }
  function restoreVisitOverview() {
    visitOverviewPlacements.splice(0).forEach(({ node, anchor }) => {
      if (anchor.isConnected) anchor.replaceWith(node);
    });
    document.querySelector('#reportVisitOverview')?.remove();
  }
  function mountReportClarity() {
    if (document.querySelector('#reportAverageCalculation')) return;
    document.querySelector(".report-secondary")?.insertAdjacentHTML("beforeend", "<details class=\"report-calculation\"><summary>Как считается средняя оплата</summary><p id=\"reportAverageCalculation\">Расчёт появится после загрузки данных.</p></details>");
    document.querySelector("#reportUtilizationNote")?.insertAdjacentHTML("afterend", "<details class=\"report-calculation\"><summary>Как считаются время и загрузка</summary><p id=\"reportDurationCalculation\">Расчёт появится после загрузки данных.</p><p id=\"reportUtilizationCalculation\">Нужен полный рабочий график выбранной области.</p></details>");
    document.querySelector(".report-retention .report-section-heading")?.insertAdjacentHTML("afterend", "<p class=\"report-scope-note\">По всей организации. Период и сотрудник выше не применяются.</p>\n              <details class=\"report-calculation\"><summary>Условия отбора клиентов</summary><p id=\"reportRetentionConditions\">Сроки отбора появятся после загрузки сегмента. Нужны согласие на обращение и отсутствие предстоящей записи. Сообщения не отправляются автоматически.</p></details>");
    document.querySelector("#reportPerformers .report-section-heading")?.insertAdjacentHTML("afterend", "<button id=\"reportShowAllTeam\" class=\"secondary-button compact-button\" type=\"button\" hidden>Вся команда</button>");
  }

  function mountReportMethodology() {
    const details = document.querySelector('#reportHealthDetails');
    if (details && !document.querySelector('#reportIndexMethod')) {
      details.querySelector('summary').textContent = 'Индекс-ориентир: как рассчитан';
      const explanation = details.querySelector(':scope > p');
      explanation.id = 'reportIndexMethod';
      explanation.textContent = 'Индекс от 0 до 100 показывает выполнение выбранных целей за период, а не независимую оценку бизнеса. При выборе сотрудника используются его записи, цели остаются целями организации.';
      explanation.insertAdjacentHTML('afterend', `<ul class="report-index-method-list">
        <li><strong>Посещения · 30%</strong><span>Состоявшиеся ÷ записи с известным исходом; ориентир — 100% минус допустимые отмены и неявки.</span></li>
        <li><strong>Оплаты · 25%</strong><span>Отмечено полученным ÷ стоимость состоявшихся визитов с известной оплатой. Если оплата указана менее чем у 80% визитов, общий индекс скрыт.</span></li>
        <li><strong>Повторные клиенты · 20%</strong><span>Вернувшиеся ÷ уникальные клиенты относительно цели. Компонент доступен от трёх клиентов.</span></li>
        <li><strong>Загрузка · 25%</strong><span>Занятое время ÷ доступное рабочее время относительно цели; нужен полный график.</span></li>
      </ul><p class="report-index-method-foot">Каждый доступный компонент ограничен 100 баллами. Если компонент недоступен, веса остальных пересчитываются. Нужны минимум два компонента и три записи с известным исходом. План выручки показывается отдельно и в индекс не входит.</p>`);
      document.querySelector('#reportHealthRing')?.setAttribute('aria-describedby', 'reportIndexMethod');
    }
    const goals = document.querySelector('#reportGoalsDialog .report-export-head');
    if (goals && !document.querySelector('#reportGoalsScope')) {
      goals.insertAdjacentHTML('afterend', '<p class="report-goals-scope" id="reportGoalsScope"></p>');
      document.querySelector('#reportGoalsDialog .report-goals-grid')?.insertAdjacentHTML('afterend', '<p class="report-goals-defaults">Значения при сбросе: выручка 0 ₽ (план выключен), загрузка 70%, возвращаемость 35%, допустимые отмены и неявки 10%. Сброс меняет поля; примените их кнопкой «Сохранить цели».</p>');
    }
    const utm = document.querySelector('#reportUtmFunnelCard .report-section-heading');
    if (utm && !document.querySelector('#reportUtmExplanation')) {
      utm.insertAdjacentHTML('afterend', '<p class="report-utm-explanation" id="reportUtmExplanation">Конверсия источника — доля сессий, в которых создана запись: сессии с записью ÷ сессии с открытием страницы × 100%. Проценты этапов считаются от всех открывших страницу; посещения — сессии, а не уникальные люди. Только переходы с точной технической меткой внешнего теста показаны отдельно и исключены из итогов. Похожие названия учитываются обычно.</p>');
    }
  }

  function refreshReportMethodology() {
    const scope = document.querySelector('#reportGoalsScope');
    if (!scope || typeof reportGoalsScopeKey !== 'function' || typeof displayPreferences === 'undefined') return;
    const organization = reportOrganization();
    const name = String(organization?.display_name || organization?.name || '').trim();
    const target = reportDataSource === 'demo' ? 'демо-режима' : name ? `организации «${name}»` : 'вашего профиля';
    const saved = Boolean(displayPreferences.analytics_goals_by_scope?.[reportGoalsScopeKey()]);
    scope.textContent = `Эти цели сохраняются для ${target}. ${saved ? 'Здесь показаны сохранённые цели этой области.' : 'Пока используются общие значения; сохранение задаст цели только для этой области.'}`;
  }

  const performerDirectoryState = { context:null, rows:[] };
  function reportPerformerDirectory(state = reportTeamAnalyticsState) {
    const context = JSON.stringify([sessionGeneration, currentUser?.id || '', reportOrganizationId(),
      reportOrganization()?.current_role || '', reportDataSource]);
    if (performerDirectoryState.context !== context || !reportCanViewTeam) {
      performerDirectoryState.context = context; performerDirectoryState.rows = [];
    }
    if (!reportCanViewTeam) return [];
    // Keep names only, never payroll or period totals. The long-history path
    // intentionally has no team aggregate and is not a staff-removal proof.
    if (state.status === 'ready' && !state.derived && state.canViewTeam === true)
      performerDirectoryState.rows = (state.rows || []).map(row => ({
        performer_id:String(row.performer_id || ''), performer_name:String(row.performer_name || 'Сотрудник')
      })).filter(row => row.performer_id);
    return state.derived || ['loading','failed'].includes(state.status)
      ? performerDirectoryState.rows : state.rows || [];
  }

  // Same completed-visit population and price method as Overview.
  // Cash receipts come exclusively from financial operations.
  function reportVisitSnapshot({ bounds, organizationId, masterId = '', contextToken } = {}) {
    if (reportDataSource === 'demo' || organizationId !== reportOrganizationId()) return null;
    const selected = reportRange(), master = reportPerformerFilter === 'all' ? '' : reportPerformerFilter || '';
    if (!bounds || bounds.start !== selected.start || bounds.end !== selected.end || masterId !== master) return null;
    const snapshot = { known:false, source:'own', organizationId, masterId, bounds:{ ...bounds },
      contextToken:financialContext(selected.end), performerName:reportPerformerName(), rows:[] };
    if (contextToken && snapshot.contextToken !== contextToken) return null;
    if (reportUsesScopedBookings()) {
      const state = reportScopedBookingsState;
      const prefix = reportSessionKey(organizationId, '');
      const [start, end, performer] = state.key?.startsWith(prefix) ? state.key.slice(prefix.length).split(':') : [];
      if (state.status !== 'ready' || !/^\d{4}-\d{2}-\d{2}$/.test(start || '')
          || !/^\d{4}-\d{2}-\d{2}$/.test(end || '') || start > selected.start || end < selected.end
          || performer !== (reportPerformerFilter || 'all')) return snapshot;
    }
    const rows = reportCompletedItems(reportBookings(selected)).map(item => {
      const value = reportServiceValue(item), payment = reportReceivedAmount(item);
      const outcome = bookingOutcome(item);
      const session = item.is_report_export ? item.export_session_items
        : typeof bookingSessionItems !== 'undefined' ? bookingSessionItems.get(item.id) : null;
      const validPrice = price => price != null && Number.isFinite(Number(price)) && Number(price) >= 0;
      const price = item.total_price_rub ?? item.original_price_rub ?? item.services?.price_rub;
      const serviceKnown = session?.length ? session.every(entry => validPrice(entry.price_rub))
        : validPrice(price) || typeof isPerMinuteBooking === 'function' && isPerMinuteBooking(item) && validPrice(outcome.calculated_amount_rub);
      return { id:String(item.id), date:String(item.booking_date), time:String(item.booking_time || '').slice(0,5),
        label:String(item.services?.name || 'Визит'), serviceMinor:Math.round(value * 100),
        serviceKnown,
        paymentMinor:Math.round(payment * 100),
        paymentKnown:!MinutaReportReconciliation.paymentUnknown(item, outcome),
        imported:Boolean(item.is_imported_history) };
    });
    if (rows.some(row => !Number.isSafeInteger(row.serviceMinor) || !Number.isSafeInteger(row.paymentMinor))) return snapshot;
    return { ...snapshot, known:true, rows };
  }

  function openVisitJournal({ snapshot, unknownOnly = false } = {}) {
    if (!snapshot?.known || snapshot.source !== 'own' || reportDataSource === 'demo'
        || snapshot.organizationId !== reportOrganizationId()
        || snapshot.contextToken !== financialContext(snapshot.bounds.end)) return false;
    openReportBookings({ analytics:unknownOnly ? 'payment-unknown' : '', scope:{
      start:snapshot.bounds.start, end:snapshot.bounds.end, organization:snapshot.organizationId,
      performer:snapshot.masterId || 'all', source:'own'
    } });
    return true;
  }

  function refreshFinancialOverview() {
    const panel = document.querySelector('#analyticsView');
    if (!panel || typeof reportRange !== 'function') return;
    const selected = reportRange();
    const revision = ++financialState.revision;
    const context = financialContext(selected.end);
    if (financialState.context !== context) financialState.context = null;
    if (reportDataSource === 'demo' && financialState.source !== 'demo' && typeof financeController !== 'undefined')
      financeController?.invalidateBounds?.();
    financialState.source = reportDataSource;
    if (reportDataSource !== 'demo' && typeof financeController !== 'undefined') {
      const controller = financeController;
      controller?.refreshVisits?.();
      void financeController?.load(selected, { shared:true, masterId:reportPerformerFilter, contextToken:context }).then(() => {
        if (revision !== financialState.revision || controller !== financeController || context !== financialContext(selected.end)) return;
        const bounds = controller.financialBounds?.({ period:selected.period, end:selected.end,
          organizationId:reportOrganizationId(), performerId:reportPerformerFilter, contextToken:context });
        financialState.context = bounds ? context : null;
        const resolved = reportRange();
        if ((resolved.start !== selected.start || resolved.end !== selected.end) && typeof renderAnalytics === 'function') renderAnalytics();
      });
    }
    const completed = reportCompletedItems(reportBookings(selected));
    panel.classList.toggle('report-no-completed-visits', !completed.length);
    const items = reportBookings(selected);
    if (!items.length && panel.dataset.reportLoadState === 'ready') {
      setReportText('#reportDataQuality', 'Нет данных');
      setReportText('#reportDataQualityNote', 'В выбранном периоде нет записей. Полноту данных пока нельзя оценить.');
      setReportText('#reportZeroSummary strong', 'Нет записей');
      setReportText('#reportZeroSummary small', 'Выберите другой период');
    }
    const overview = document.querySelector('#reportFinanceOverview');
    const command = document.querySelector('#reportCommandCenter');
    if (overview && command && !document.querySelector('#reportVisitOverview')) {
      const details = document.createElement('details'); details.id = 'reportVisitOverview';
      details.className = 'report-visit-overview'; details.dataset.reportSection = 'overview';
      const summary = document.createElement('summary'); summary.textContent = 'Визиты, загрузка и цели';
      command.before(details); details.append(summary);
      const selectors = ['#reportCommandCenter', '.report-period-details', '.report-summary',
        '.report-secondary', '#reportReconciliation', '.report-trend', '.report-analytics-details'];
      selectors.forEach(selector => {
        const node = document.querySelector(`#analyticsView ${selector}`);
        if (!node) return;
        const anchor = document.createComment('visit-overview-original-position');
        node.before(anchor); visitOverviewPlacements.push({ node, anchor }); details.append(node);
      });
    }
    if (overview && reportDataSource !== 'demo') {
      setReportText('#analyticsView .report-head .view-description', 'Деньги, визиты и клиенты за выбранный период.');
      const summary = document.querySelector('#reportFilterSummary');
      if (summary) {
        const from = reportDateText(selected.start, { day:'numeric', month:'short', ...(selected.start.slice(0,4) !== selected.end.slice(0,4) ? { year:'numeric' } : {}) });
        const to = reportDateText(selected.end, { day:'numeric', month:'short', year:'numeric' });
        summary.textContent = `${selected.period === 'all' ? 'За всё время' : selected.start === selected.end ? to : `${from} — ${to}`} · ${reportPerformerName()}`;
      }
      setReportText('#reportTrendTitle', 'Оплаты по датам визитов');
    }
    const visits = document.querySelector('#reportVisitOverview');
    if (visits && visits.dataset.source !== reportDataSource) {
      if (reportDataSource === 'demo') { visits.dataset.realOpen = String(visits.open); visits.open = true; }
      else if (visits.dataset.source === 'demo') visits.open = visits.dataset.realOpen === 'true';
      visits.dataset.source = reportDataSource;
    }
    const note = document.querySelector('#reportPeriodLabel');
    if (note) note.dataset.dateBasis = 'visits';
  }

  // The reportRange hook may read only a confirmed current controller scope.
  // Session/actor/source checks belong here, where the provider context exists.
  const financialState = { context:null, revision:0, source:null };
  function financialContext(end) {
    return JSON.stringify([typeof sessionGeneration === 'undefined' ? null : sessionGeneration,
      typeof currentUser === 'undefined' ? null : currentUser?.id || null,
      reportOrganizationId(), reportPeriod, reportPerformerFilter, reportDataSource, end, reportTodayIso(), window.MinutaStatisticsBranchRuntime?.enabled ? window.MinutaStatisticsBranchRuntime.token : null]);
  }
  function financialBounds(scope) {
    if (!scope || reportDataSource === 'demo' || reportPeriod !== 'all' || scope.period !== 'all'
        || scope.organizationId !== reportOrganizationId() || scope.performerId !== reportPerformerFilter
        || financialState.context !== financialContext(scope.end) || typeof financeController === 'undefined') return null;
    return financeController?.financialBounds?.({ ...scope, contextToken:financialContext(scope.end) }) || null;
  }

  function refreshReportUtmPresentation() {
    const sources = document.querySelector('#reportUtmFunnelSources');
    if (!sources || typeof reportUtmFunnelState === 'undefined' || typeof reportUtmIsTestSource !== 'function') return;
    const testTitle = sources.querySelector('.report-utm-test-source strong');
    if (testTitle) testTitle.textContent = 'Тестовые переходы';
    const rows = Array.isArray(reportUtmFunnelState.data?.rows)
      ? reportUtmFunnelState.data.rows.filter(row => !reportUtmIsTestSource(row)) : [];
    sources.querySelectorAll(':scope > article').forEach((article, index) => {
      const row = rows[index];
      if (String(row?.utm_source || '').trim().toLowerCase() !== 'master'
        || String(row?.utm_campaign || '').trim().toLowerCase() !== 'free_slots') return;
      const title = article.querySelector('strong');
      const subtitle = article.querySelector('small');
      if (title) title.textContent = 'Ссылка мастера · Свободные окна';
      if (subtitle && String(row?.utm_medium || '').trim().toLowerCase() === 'link') subtitle.textContent = 'Ссылка на запись';
    });
  }

  function renderReportCalculationDetails({ range, completed, revenue, knownPaymentCount, unknownPaymentCount, workedMinutes }) {
    const average = knownPaymentCount ? money(Math.round(revenue / knownPaymentCount)) : 'Нет данных';
    setReportText('#reportAverageCalculation', knownPaymentCount
      ? `${money(revenue)} получено ÷ ${knownPaymentCount} ${reportVisitWord(knownPaymentCount)} с известной оплатой = ${average}. Исключено без отметки оплаты: ${unknownPaymentCount}. Известная нулевая оплата входит в расчёт.`
      : `Нет состоявшихся визитов с известной оплатой. Исключено без отметки оплаты: ${unknownPaymentCount}. Известная нулевая оплата входит в расчёт.`);
    const plannedCount = completed.filter(item => !(Number(bookingOutcome(item).actual_duration_minutes) > 0)).length;
    setReportText('#reportDurationCalculation', `Состоявшиеся визиты: ${completed.length}. Учтено ${reportHours(workedMinutes)} (${workedMinutes} мин). Используется положительная фактическая длительность; если её нет — плановая. С плановой длительностью: ${plannedCount} ${reportVisitWord(plannedCount)}.`);
    const availableMinutes = reportAvailableScheduleMinutes(range);
    setReportText('#reportUtilizationCalculation', availableMinutes === null
      ? 'Процент недоступен: нужен полный рабочий график выбранных сотрудников и периода. Из рабочего времени исключаются перерывы, выходные и закрытое время.'
      : `Занято ${reportHours(workedMinutes)} (${workedMinutes} мин) из ${reportHours(availableMinutes)} (${availableMinutes} мин) доступного рабочего времени. ${availableMinutes > 0 ? `${workedMinutes} ÷ ${availableMinutes} × 100 = ${Math.round(workedMinutes / availableMinutes * 100)}%.` : 'При нуле доступных минут текущий расчёт показывает 0%.'} Учитываются выбранные период и сотрудники; перерывы, выходные и закрытое время исключены.`);
  }

  function renderReportTeamRows(rows) {
    rows = reportReconciledTeamRows(reportCompletedItems(reportBookings(reportRange())), reportRange());
    const panel = $('#reportPerformers');
    const holder = $('#reportPerformersList');
    if (!panel || !holder) return;
    const allTeamSelected = reportCanViewTeam && (!reportPerformerFilter || reportPerformerFilter === 'all');
    const personalSelected = reportCanViewTeam && !allTeamSelected;
    if (personalSelected) rows = rows.filter(row => String(row.performer_id || '') === String(reportPerformerFilter));
    panel.hidden = !reportCanViewTeam || (!rows.length && !personalSelected);
    panel.classList.toggle('is-personal', personalSelected);
    const title = $('#reportPerformersTitle');
    if (title) title.textContent = personalSelected ? 'Результаты сотрудника' : 'Рейтинг сотрудников';
    const allTeamButton = $('#reportShowAllTeam');
    if (allTeamButton) {
      allTeamButton.hidden = !personalSelected;
      allTeamButton.onclick = () => {
        const control = $('#reportPerformerFilter');
        if (control) { control.value = 'all'; control.dispatchEvent(new Event('change', { bubbles:true })); }
      };
    }
    panel.querySelector('.report-team-controls')?.setAttribute('aria-label', personalSelected ? 'Показатель сотрудника' : 'Показатель рейтинга сотрудников');
    if (!reportCanViewTeam) { holder.innerHTML = ''; return; }
    if (reportTeamAnalyticsState.status === 'failed') {
      panel.hidden = false;
      holder.innerHTML = '<p class="report-empty-inline">Не удалось загрузить показатели сотрудников за выбранный период.</p>';
      setReportText('#reportTeamMetricNote', 'Показатели прошлого периода скрыты. Общие показатели рассчитаны по загруженным записям.');
      return;
    }
    if (!rows.length) { holder.innerHTML = '<p class="report-empty-inline">Данные сотрудника за выбранный период пока недоступны.</p>'; return; }
    const controls = $$('[data-report-team-metric]');
    controls.forEach(button => {
      const active = button.dataset.reportTeamMetric === reportTeamMetric;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
      button.onclick = () => {
        reportTeamMetric = button.dataset.reportTeamMetric || 'revenue';
        renderReportTeamRows(reportTeamAnalyticsState.rows || []);
      };
    });
    const metricNotes = {
      revenue:'Фактически полученная оплата за состоявшиеся визиты.',
      payroll:'Сумма к выплате по настроенной схеме начисления.',
      visits:'Количество состоявшихся визитов.',
      hours:'Время состоявшихся визитов: фактическое, а если оно не указано — плановое.',
      efficiency:'Полученная оплата за час учтённого времени: фактического, а если оно не указано — планового.'
    };
    setReportText('#reportTeamMetricNote', metricNotes[reportTeamMetric] || metricNotes.revenue);
    const metricValue = row => {
      const visits = Math.max(0, Number(row.completed_visits) || 0);
      const minutes = Math.max(0, Number(row.worked_minutes) || 0);
      const revenue = Math.max(0, Number(row.revenue_rub) || 0);
      if (reportTeamMetric === 'payroll') return row.payroll_rub === null || row.payroll_rub === undefined || !Number.isFinite(Number(row.payroll_rub)) ? null : Number(row.payroll_rub);
      if (reportTeamMetric === 'visits') return visits;
      if (reportTeamMetric === 'hours') return minutes / 60;
      if (reportTeamMetric === 'efficiency') return minutes > 0 ? revenue / (minutes / 60) : 0;
      return revenue;
    };
    const metricLabel = (value, row) => {
      if (value === null) return '—';
      if (reportTeamMetric === 'visits') return `${Math.round(value)} ${reportVisitWord(value)}`;
      if (reportTeamMetric === 'hours') return reportHours(Number(row.worked_minutes) || 0);
      if (reportTeamMetric === 'efficiency') return `${money(Math.round(value))}/ч`;
      return money(Math.round(value));
    };
    const rankedRows = rows.map(row => ({ row, value:metricValue(row) })).sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
    const maximum = Math.max(1, ...rankedRows.map(item => item.value || 0));
    const showLeader = allTeamSelected && rankedRows.length > 1;
    holder.innerHTML = rankedRows.map((item, index) => {
      const row = item.row;
      const visits = Math.max(0, Number(row.completed_visits) || 0);
      const clients = Math.max(0, Number(row.unique_clients) || 0);
      const minutes = Math.max(0, Number(row.worked_minutes) || 0);
      const revenue = Math.max(0, Number(row.revenue_rub) || 0);
      const average = row.payment_known_visits ? revenue / row.payment_known_visits : null;
      const width = item.value === null ? 0 : Math.max(item.value > 0 ? 3 : 0, Math.round((item.value || 0) / maximum * 100));
      if (personalSelected) return `<article class="report-personal-result"><span class="report-team-person"><strong>${escapeHtml(row.performer_name || 'Сотрудник')}</strong><small>${visits} ${reportVisitWord(visits)} · ${clients} ${reportClientWord(clients)} · ${reportHours(minutes)} · ${average === null ? 'Нет данных об оплате' : `${money(Math.round(average))}/визит с данными`}</small></span><span class="report-performer-value"><b>${escapeHtml(metricLabel(item.value, row))}</b>${reportTeamMetric === 'payroll' && item.value === null ? '<small>Схема начисления не задана</small>' : ''}</span></article>`;
      return `<button class="report-performer-row${showLeader && index === 0 && item.value !== null ? ' is-leader' : ''}" type="button" data-report-performer="${escapeHtml(String(row.performer_id || ''))}" aria-label="Открыть статистику сотрудника ${escapeHtml(row.performer_name || 'Мастер')}"><span class="report-team-rank">${index + 1}</span><span class="report-team-person"><strong>${escapeHtml(row.performer_name || 'Мастер')}${showLeader && index === 0 && item.value !== null ? '<em>Лидер</em>' : ''}</strong><small>${visits} ${reportVisitWord(visits)} · ${clients} ${reportClientWord(clients)} · ${reportHours(minutes)} · ${average === null ? 'Нет данных об оплате' : `${money(Math.round(average))}/визит с данными`}</small></span><span class="report-team-bar" aria-hidden="true"><i style="width:${width}%"></i></span><span class="report-performer-value"><b>${escapeHtml(metricLabel(item.value, row))}</b>${reportTeamMetric === 'payroll' && item.value === null ? '<small>Схема начисления не задана</small>' : ''}</span><span class="report-team-arrow" aria-hidden="true">→</span></button>`;
    }).join('');
    holder.querySelectorAll('[data-report-performer]').forEach(row => {
      const select = () => { const control = $('#reportPerformerFilter'); if (!control) return; control.value = row.dataset.reportPerformer; control.dispatchEvent(new Event('change', { bubbles:true })); window.scrollTo({ top:$('#analyticsView')?.offsetTop || 0, behavior:'smooth' }); };
      row.addEventListener('click', select);
    });
  }

  function renderReportRetention() {
    const panel = $('.report-retention');
    const setEmptyText = text => {
      if (!panel) return;
      let empty = panel.querySelector('.report-retention-empty');
      if (!empty) {
        panel.insertAdjacentHTML('beforeend', '<p class="report-retention-empty"></p>');
        empty = panel.querySelector('.report-retention-empty');
      }
      empty.textContent = text;
    };
    const branch = window.MinutaStatisticsBranchRuntime;
    const branchRecord = branch?.enabled && branch.locationId ? branch.cached('retention', range()) : null;
    const availability = branchRecord?.status || retentionController?.availability || 'idle';
    const payloadValue = retentionController?.payload;
    const payload = branchRecord ? branchRecord.data : typeof payloadValue === 'function' ? payloadValue.call(retentionController) : payloadValue;
    const selection = getRetentionSegments();
    const scopeReady = Boolean(selection);
    audit.refreshRetentionSegments();
    const periods = scopeReady
      ? 'Учитываются перерыв после последнего завершённого визита и интервал после предыдущего обращения. Сроки задаются в настройках возврата клиентов. '
      : reportDataSource === 'demo' ? 'Для демо-данных сегмент возврата не рассчитывается. ' : 'Условия отбора станут доступны после загрузки сегмента. ';
    setReportText('#reportRetentionConditions', `${branchRecord ? 'Визиты — в выбранном филиале; согласие, интервал после обращения и предстоящая запись — во всей организации. ' : ''}${periods}Нужны согласие на обращение и отсутствие предстоящей записи. Сообщения не отправляются автоматически.`);
    if (!scopeReady) {
      ['#reportRetentionEligible','#reportRetentionRegular','#reportRetentionPrepared','#reportRetentionSent','#reportRetentionUnknownConsent'].forEach(selector => setReportText(selector, '—'));
      panel?.classList.remove('is-empty');
      setEmptyText(reportDataSource === 'demo'
        ? 'Возврат клиентов доступен только для ваших данных'
        : availability === 'loading' ? 'Загружаем сегмент клиентов…'
          : availability === 'error' ? 'Не удалось загрузить сегмент клиентов'
            : availability === 'unsupported' ? 'Сегмент возврата пока недоступен'
              : availability === 'ready' ? 'Обновите сегмент для текущего аккаунта и роли'
                : 'Откройте вкладку «Клиенты», чтобы загрузить сегмент');
      return;
    }
    const deliveries = Array.isArray(payload?.deliveries) ? payload.deliveries : [];
    const eligible = selection.segments.eligible.length;
    const regular = selection.segments.regular.length;
    const prepared = deliveries.filter(item => ['prepared', 'draft'].includes(String(item.status || '').toLowerCase())).length;
    const sent = deliveries.filter(item => ['sent', 'delivered'].includes(String(item.status || '').toLowerCase())).length;
    const unknownConsent = selection.segments.unknownConsent.length;
    setReportText('#reportRetentionEligible', eligible);
    setReportText('#reportRetentionRegular', regular);
    setReportText('#reportRetentionPrepared', prepared);
    setReportText('#reportRetentionSent', sent);
    setReportText('#reportRetentionUnknownConsent', unknownConsent);
    if (panel) {
      const isEmpty = eligible + regular + prepared + sent === 0;
      panel.classList.toggle('is-empty', isEmpty);
      setEmptyText('Клиентов для возвращения пока нет' + (unknownConsent ? ` · у ${unknownConsent} не указано согласие` : ''));
    }
  }
  function reportFreshnessLabel() {
    if (reportDataSource === 'demo') return 'Учебный расчёт';
    const scoped = reportUsesScopedBookings();
    const received = scoped ? reportScopedBookingsState.receivedAt : bookingsSnapshotSavedAt;
    if (scoped && reportScopedBookingsState.status !== 'ready' || !received) return '';
    const date = new Date(received);
    if (!Number.isFinite(date.getTime())) return '';
    const label = !scoped && bookingsSnapshotFromCache ? 'Сохранённые записи от' : 'Записи получены';
    return `${label} ${date.toLocaleString('ru-RU', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}`;
  }
  function customPeriodName() {
    const { start, end } = range();
    const sameYear = start.slice(0, 4) === end.slice(0, 4);
    const sameMonth = sameYear && start.slice(0, 7) === end.slice(0, 7);
    const shortDate = (date, year) => reportDateText(date, { day:'numeric', month:'short', ...(year && { year:'numeric' }) }).replace(/ г\.$/, '');
    if (sameMonth) return `${reportDateText(start, { day:'numeric' })}–${shortDate(end, true)}`;
    return `${shortDate(start, !sameYear)} — ${shortDate(end, true)}`;
  }
  function getRetentionSegments() {
    const branch = window.MinutaStatisticsBranchRuntime;
    if (branch?.enabled && branch.locationId) {
      const selected = range(), record = branch.cached('retention', { start:selected.start, end:selected.end });
      if (record.status !== 'ready') return null;
      const scope = record.scope;
      return { scope:{ organization:scope.organizationId, role:scope.role, userId:scope.userId, session:scope.sessionGeneration,
        revision:scope.revision, locationId:scope.locationId, locationName:reportOrganization()?.locations?.find(item=>String(item.id)===scope.locationId)?.name || 'Выбранный филиал', organizationName:reportOrganization()?.name || '' },
        segments:MinutaStatisticsAuditUI.buildRetentionSegments(record.data.clients) };
    }
    if (reportDataSource !== 'own' || typeof retentionController === 'undefined') return null;
    const snapshot = retentionController?.readOnlySnapshot?.();
    const organization = reportOrganization();
    const scope = snapshot?.scope;
    if (!scope || scope.organization !== reportOrganizationId() || scope.role !== organization?.current_role
      || scope.userId !== currentUser?.id || scope.session !== sessionGeneration) return null;
    return { scope:{ ...scope, organizationName:organization?.display_name || organization?.name || '' },
      segments:MinutaStatisticsAuditUI.buildRetentionSegments(snapshot.clients) };
  }
  function getSegments() {
    const selected = range();
    // Keep the previous-visit population identical to reportClientMetrics.
    const live = reportHistoryBookings();
    const organizationId = reportOrganizationId();
    const imported = reportDataSource === 'demo' ? [] : reportBranchImportedHistory().filter(item =>
      !organizationId || !item.organization_id || String(item.organization_id) === String(organizationId));
    const history = reportCompletedItems([...live, ...imported].filter(item =>
      !isScheduleBlock(item) && item.booking_date < selected.start));
    return MinutaStatisticsAuditUI.buildClientSegments({
      completed:reportCompletedItems(reportBookings(selected)), history, identityFor:reportClientIdentity
    });
  }
  const audit = MinutaStatisticsAuditUI.create({ document,
    getScope:() => ({ session:sessionGeneration, branchToken:window.MinutaStatisticsBranchRuntime?.enabled ? window.MinutaStatisticsBranchRuntime.token : '', organization:reportOrganizationId(),
      organizationName:reportOrganization()?.display_name || reportOrganization()?.name || '',
      role:reportOrganization()?.current_role || '',
      locations:(reportOrganization()?.locations || []).map(item => ({ id:String(item.id || ''), name:String(item.name || '') })),
      source:reportDataSource, start:range().start, end:range().end,
      performer:reportPerformerFilter, performerName:reportPerformerName(),
      view:document.querySelector('#analyticsView')?.dataset.reportTab || 'overview',
      status:reportUsesScopedBookings() ? reportScopedBookingsState.status : 'ready' }),
    getSegments,
    getRetentionSegments,
    download:(format, privacy) => {
      if (format === 'xlsx') void exportBookingsXlsxInBackground(privacy);
      else if (format === 'csv') exportBookingsCsv(privacy);
      else if (format === 'pdf') exportBookingsPdf(privacy);
    }
  });
  audit.mount();
  refreshReferenceHeader();
  mountReportClarity();
  mountReportMethodology();
  refreshReportMethodology();
  document.querySelector('#reportGoalsOpen')?.addEventListener('click', refreshReportMethodology);
  const utmSources = document.querySelector('#reportUtmFunnelSources');
  if (utmSources) {
    new MutationObserver(refreshReportUtmPresentation).observe(utmSources, { childList:true });
    refreshReportUtmPresentation();
  }
  document.querySelector('#reportTeamMetricNote')?.insertAdjacentHTML('afterend',
    '<p class="report-team-payment-warning">Есть визиты без отметки оплаты; они не входят в выручку.</p>');
  window.MinutaStatisticsAuditProvider = Object.freeze({ branchSourceReady:true, team:renderReportTeamRows, retention:renderReportRetention, calculations:renderReportCalculationDetails, freshnessLabel:reportFreshnessLabel, financialBounds, performerDirectory:reportPerformerDirectory, visitSnapshot:reportVisitSnapshot, openVisitJournal, restoreVisitOverview:() => restoreVisitOverview(), refresh:() => { if(window.MINUTA_CONFIG?.statisticsBranchBackendAccepted===true && reportDataSource==='own' && currentUser?.id && reportOrganizationId() && !window.MinutaStatisticsBranchRuntime?.enabled) window.MinutaStatisticsBranchProvider?.activate({backendAccepted:true}); audit.refresh(); refreshReportMethodology(); queueMicrotask(refreshFinancialOverview); }, periodName:() => reportPeriod === 'custom' ? customPeriodName() : reportPeriodName() });
  if (reportPeriod === 'custom') updateReportFilterSummary();
  if (typeof reportTeamAnalyticsState !== 'undefined') reportPerformerDirectory(reportTeamAnalyticsState);
  if (document.querySelector('#dashboard')?.dataset.activeView === 'analytics') renderAnalytics();
})();
