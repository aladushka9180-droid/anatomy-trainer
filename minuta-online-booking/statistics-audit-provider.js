// Provider bindings for the optional statistics UI. Loaded only after provider.js.
(function () {
  'use strict';
  const range = () => reportRange();
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
  function getSegments() {
    const selected = range();
    // Keep the previous-visit population identical to reportClientMetrics.
    const live = reportUsesScopedBookings() && reportScopedBookingsState.status === 'ready'
      ? reportScopedBookingsState.rows : allBookings;
    const organizationId = reportOrganizationId();
    const imported = reportDataSource === 'demo' ? [] : importedBookingHistory.filter(item =>
      !organizationId || !item.organization_id || String(item.organization_id) === String(organizationId));
    const history = reportCompletedItems([...live, ...imported].filter(item =>
      !isScheduleBlock(item) && item.booking_date < selected.start));
    return MinutaStatisticsAuditUI.buildClientSegments({
      completed:reportCompletedItems(reportBookings(selected)), history, identityFor:reportClientIdentity
    });
  }
  const audit = MinutaStatisticsAuditUI.create({ document,
    getScope:() => ({ session:sessionGeneration, organization:reportOrganizationId(),
      organizationName:reportOrganization()?.display_name || reportOrganization()?.name || '',
      source:reportDataSource, start:range().start, end:range().end,
      performer:reportPerformerFilter, performerName:reportPerformerName(),
      view:document.querySelector('#analyticsView')?.dataset.reportTab || 'overview',
      status:reportUsesScopedBookings() ? reportScopedBookingsState.status : 'ready' }),
    getSegments,
    download:(format, privacy) => {
      if (format === 'xlsx') void exportBookingsXlsxInBackground(privacy);
      else if (format === 'csv') exportBookingsCsv(privacy);
      else if (format === 'pdf') exportBookingsPdf(privacy);
    }
  });
  audit.mount();
  document.querySelector('#reportTeamMetricNote')?.insertAdjacentHTML('afterend',
    '<p class="report-team-payment-warning">Есть визиты без отметки оплаты; они не входят в выручку.</p>');
  window.MinutaStatisticsAuditProvider = Object.freeze({ freshnessLabel:reportFreshnessLabel, refresh:() => audit.refresh(), periodName:() => reportPeriod === 'custom' ? customPeriodName() : reportPeriodName() });
  if (reportPeriod === 'custom') updateReportFilterSummary();
  if (document.querySelector('#dashboard')?.dataset.activeView === 'analytics') renderAnalytics();
})();
