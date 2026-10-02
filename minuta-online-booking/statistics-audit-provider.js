// Provider bindings for the optional statistics UI. Loaded only after provider.js.
(function () {
  'use strict';
  const range = () => reportRange();
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
      utm.insertAdjacentHTML('afterend', '<p class="report-utm-explanation" id="reportUtmExplanation">Конверсия источника — доля сессий, в которых создана запись: сессии с записью ÷ сессии с открытием страницы × 100%. Проценты этапов считаются от всех открывших страницу; посещения — сессии, а не уникальные люди. Только переходы с точной меткой utm_source=primetime_external_test показаны отдельно и исключены из итогов. Похожие названия учитываются обычно.</p>');
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
      command.before(details); details.append(summary, command);
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
      reportOrganizationId(), reportPeriod, reportPerformerFilter, reportDataSource, end, reportTodayIso()]);
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
    const availability = retentionController?.availability || 'idle';
    const payloadValue = retentionController?.payload;
    const payload = typeof payloadValue === 'function' ? payloadValue.call(retentionController) : payloadValue;
    const payloadMatchesScope = String(payload?.organization_id || '') === String(reportOrganizationId() || '');
    const scopeReady = reportDataSource !== 'demo' && availability === 'ready' && payloadMatchesScope;
    const periods = scopeReady
      ? 'Учитываются перерыв после последнего завершённого визита и интервал после предыдущего обращения. Сроки задаются в настройках возврата клиентов. '
      : reportDataSource === 'demo' ? 'Для демо-данных сегмент возврата не рассчитывается. ' : 'Условия отбора станут доступны после загрузки сегмента. ';
    setReportText('#reportRetentionConditions', `${periods}Нужны согласие на обращение и отсутствие предстоящей записи. Сообщения не отправляются автоматически.`);
    if (reportDataSource === 'demo' || availability !== 'ready' || !payloadMatchesScope) {
      ['#reportRetentionEligible','#reportRetentionRegular','#reportRetentionPrepared','#reportRetentionSent','#reportRetentionUnknownConsent'].forEach(selector => setReportText(selector, '—'));
      panel?.classList.remove('is-empty');
      setEmptyText(reportDataSource === 'demo'
        ? 'Возврат клиентов доступен только для ваших данных'
        : availability === 'loading' ? 'Загружаем сегмент клиентов…'
          : availability === 'error' ? 'Не удалось загрузить сегмент клиентов'
            : availability === 'unsupported' ? 'Сегмент возврата пока недоступен'
              : 'Откройте вкладку «Клиенты», чтобы загрузить сегмент');
      return;
    }
    const clients = Array.isArray(payload?.clients) ? payload.clients : [];
    const deliveries = Array.isArray(payload?.deliveries) ? payload.deliveries : [];
    const eligible = clients.filter(item => item.eligible === true).length;
    const regular = clients.filter(item => item.eligible === true && Number(item.completed_visits || 0) >= 3).length;
    const prepared = deliveries.filter(item => ['prepared', 'draft'].includes(String(item.status || '').toLowerCase())).length;
    const sent = deliveries.filter(item => ['sent', 'delivered'].includes(String(item.status || '').toLowerCase())).length;
    const unknownConsent = clients.filter(item => !item.consent_status || String(item.consent_status).toLowerCase() === 'unknown').length;
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
      role:reportOrganization()?.current_role || '',
      locations:(reportOrganization()?.locations || []).map(item => ({ id:String(item.id || ''), name:String(item.name || '') })),
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
  window.MinutaStatisticsAuditProvider = Object.freeze({ team:renderReportTeamRows, retention:renderReportRetention, calculations:renderReportCalculationDetails, freshnessLabel:reportFreshnessLabel, financialBounds, refresh:() => { audit.refresh(); refreshReportMethodology(); queueMicrotask(refreshFinancialOverview); }, periodName:() => reportPeriod === 'custom' ? customPeriodName() : reportPeriodName() });
  if (reportPeriod === 'custom') updateReportFilterSummary();
  if (document.querySelector('#dashboard')?.dataset.activeView === 'analytics') renderAnalytics();
})();
