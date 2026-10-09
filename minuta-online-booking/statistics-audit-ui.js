// Read-only client drill-down and explicit export review for the provider report.
(function (root) {
  'use strict';

  const segmentTitles = Object.freeze({ all:'Посетило', new:'Новые', returning:'Приходили раньше' });
  const retentionSegmentTitles = Object.freeze({ eligible:'Можно связаться', regular:'Постоянные после перерыва', unknownConsent:'Согласие не указано' });
  const exportSegmentTitles = Object.freeze({ all:'Все клиенты', new:'Новые', returning:'Приходили раньше' });
  const formats = Object.freeze({ xlsx:'Excel (.xlsx)', csv:'CSV (.csv)', pdf:'PDF (.pdf)' });
  const phoneModes = Object.freeze({ masked:'частично скрыты', none:'не включены', full:'полные телефоны клиентов' });
  const contents = Object.freeze({
    xlsx:'Сводка по визитам и отмеченным оплатам, реестр записей, мастера и клиенты. Расходы не входят.',
    csv:'Только реестр записей с данными визитов и отмеченной оплаты. Расходы не входят.',
    pdf:'Сводка по визитам и отмеченным оплатам, до 12 мастеров и сокращённый реестр записей. Расходы и телефоны не входят.'
  });

  function localDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
    if (!match) return '—';
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3])
      ? new Intl.DateTimeFormat('ru-RU', { day:'numeric', month:'short', year:'numeric' }).format(date)
      : '—';
  }

  function clientCount(count) {
    const ending = count % 100 >= 11 && count % 100 <= 14 ? 0 : count % 10;
    return `${count} ${ending === 1 ? 'клиент' : ending >= 2 && ending <= 4 ? 'клиента' : 'клиентов'}`;
  }

  function buildClientSegments({ completed = [], history = [], identityFor }) {
    if (typeof identityFor !== 'function') throw new TypeError('identityFor is required');
    const previous = new Set(history.map(identityFor).filter(Boolean));
    const current = new Map();
    for (const item of completed) {
      const key = identityFor(item);
      if (!key) continue;
      const moment = `${item.booking_date || ''}T${String(item.booking_time || '00:00').slice(0, 5)}`;
      const row = current.get(key);
      if (!row) current.set(key, { key, name:item.client_name || 'Без имени', first:item.booking_date, last:item.booking_date, visits:1, firstMoment:moment, hadPrevious:!!item.client_had_previous });
      else {
        row.visits += 1;
        if (moment < row.firstMoment) { row.firstMoment = moment; row.name = item.client_name || row.name; row.hadPrevious = !!item.client_had_previous; }
        if (item.booking_date < row.first) row.first = item.booking_date;
        if (item.booking_date > row.last) row.last = item.booking_date;
      }
    }
    const all = [...current.values()].map(row => ({ ...row, returning:previous.has(row.key) || row.hadPrevious }))
      .sort((a, b) => b.last.localeCompare(a.last) || a.name.localeCompare(b.name, 'ru'));
    return { all, new:all.filter(row => !row.returning), returning:all.filter(row => row.returning) };
  }

  function buildRetentionSegments(clients = []) {
    const rows = clients.filter(client => client && typeof client.client_account_id === 'string' && client.client_account_id)
      .map(client => ({ key:client.client_account_id, name:String(client.client_name || 'Без имени'),
        last:client.last_visit_on, visits:Math.max(0, Number(client.completed_visits) || 0),
        eligible:client.eligible === true && client.consent_status === 'granted',
        consent:['granted','revoked'].includes(client.consent_status) ? client.consent_status : 'unknown' }));
    return { eligible:rows.filter(row => row.eligible), regular:rows.filter(row => row.eligible && row.visits >= 3),
      unknownConsent:rows.filter(row => row.consent === 'unknown') };
  }

  function scopeKey(scope) {
    if (!scope) return '';
    return JSON.stringify([scope.session, scope.organization, scope.organizationName, scope.source, scope.start, scope.end, scope.performer, scope.performerName, scope.view, scope.status, scope.role, scope.locations, scope.locationId, scope.segment]);
  }

  function scopeText(scope) {
    const date = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value.split('-').reverse().join('.') : '—';
    const view = scope.view === 'money' ? ' · Период и сотрудник — из вкладки «Обзор»' : '';
    return `${date(scope.start)} — ${date(scope.end)} · ${scope.performerName || 'Личная статистика'} · Источник: ${scope.source === 'demo' ? 'демо' : 'реальные данные'} · ${scope.organizationName || 'Организация'}${view}`;
  }

  function exportLocationName(scope) {
    if (scope.locationId === 'all') return 'Все филиалы';
    return scope.locations?.find(item => item.id === scope.locationId)?.name || '';
  }
  function exportScopeText(scope) {
    return `${scopeText(scope)} · Филиал: ${exportLocationName(scope)} · Сегмент: ${exportSegmentTitles[scope.segment]}`;
  }
  function exportScopeNote(scope) {
    const location = scope.source === 'demo' ? 'В демо выбор филиала и сегмента недоступен.'
      : scope.locationId === 'all' ? 'Импортированные визиты без филиала включены.'
      : 'Импортированные визиты без филиала исключены из отчёта выбранного филиала.';
    return `${location} Сегменты считаются по состоявшимся визитам; реестр содержит все записи выбранных клиентов за период.`;
  }
  function exportContents(format, scope) {
    const history = format === 'xlsx' ? scope.source === 'demo'
      ? ' Лист истории изменений в демо пуст.' : scope.locationId === 'all' && scope.segment === 'all'
        ? ' Лист истории изменений включён.' : ' Лист истории изменений пуст для выбранного филиала или сегмента.' : '';
    return `${contents[format]}${history}`;
  }

  function create({ document, getScope, getSegments, getRetentionSegments = () => null, download }) {
    if (!document || typeof getScope !== 'function' || typeof getSegments !== 'function' || typeof download !== 'function') throw new TypeError('statistics UI dependencies are required');
    const $ = selector => document.querySelector(selector);
    const report = $('#analyticsView');
    const exportDialog = $('#reportExportDialog');
    let segmentDialog;
    let reviewDialog;
    let capturedScope = null;
    let capturedRetentionScope = null;
    let pendingFormat = '';
    let pendingPrivacy = '';

    function closeIfOpen(dialog) { if (dialog?.open) dialog.close(); }
    function readyScope() {
      const scope = getScope();
      if (!scope || scope.status !== 'ready' || !scope.start || !scope.end || scope.start > scope.end) return null;
      const locationId = $('#reportExportLocation')?.value || 'all';
      const segment = $('#reportExportSegment')?.value || 'all';
      if (!exportSegmentTitles[segment] || locationId !== 'all' && !scope.locations?.some(item => item.id === locationId)) return null;
      return { ...scope, locationId, segment };
    }
    function invalidate() {
      if (capturedRetentionScope && segmentDialog) segmentDialog.querySelector('.report-audit-list').replaceChildren();
      capturedRetentionScope = null;
      capturedScope = null;
      pendingFormat = '';
      pendingPrivacy = '';
      closeIfOpen(segmentDialog);
      closeIfOpen(reviewDialog);
      closeIfOpen(exportDialog);
    }
    function refresh() {
      renderVisitExportScope();
      if (capturedScope && scopeKey(readyScope()) !== scopeKey(capturedScope)) invalidate();
      refreshRetentionSegments();
    }

    function syncExportControls(scope) {
      const location = $('#reportExportLocation');
      const segment = $('#reportExportSegment');
      const privacy = $('#reportExportPrivacy');
      if (!location || !segment || !privacy) return;
      const selected = location.value;
      location.replaceChildren(new Option('Все филиалы', 'all'));
      if (scope?.source === 'own') for (const item of scope.locations || []) {
        if (item.id) location.add(new Option(item.name || 'Филиал', item.id));
      }
      location.value = [...location.options].some(option => option.value === selected) ? selected : 'all';
      location.disabled = scope?.source !== 'own';
      segment.disabled = scope?.source !== 'own';
      if (segment.disabled) segment.value = 'all';
      const full = privacy.querySelector('option[value="full"]');
      const owner = scope?.source === 'own' && scope.role === 'owner';
      full.hidden = !owner;
      full.disabled = !owner;
      privacy.value = 'masked';
      $('#reportExportPhoneNote').textContent = owner
        ? 'Полные телефоны требуют отдельного подтверждения перед скачиванием.'
        : 'Полные телефоны доступны только владельцу организации.';
    }
    function renderExportSelection(scope) {
      if (!scope) return;
      exportDialog.querySelector('.report-audit-scope').textContent = exportScopeText(scope);
      $('#reportExportScopeNote').textContent = exportScopeNote(scope);
    }

    function ensureSegmentDialog() {
      if (segmentDialog) return segmentDialog;
      segmentDialog = document.createElement('dialog');
      segmentDialog.className = 'report-audit-dialog report-segment-dialog';
      segmentDialog.setAttribute('aria-labelledby', 'reportSegmentTitle');
      segmentDialog.innerHTML = '<div class="report-audit-head"><div><small>Клиенты за период</small><h3 id="reportSegmentTitle"></h3></div><button type="button" class="secondary-button" data-audit-close>Закрыть</button></div><p class="report-audit-scope"></p><p class="report-audit-count"></p><div class="report-audit-list"></div>';
      segmentDialog.querySelector('[data-audit-close]').addEventListener('click', () => segmentDialog.close());
      segmentDialog.addEventListener('close', () => {
        capturedScope = null;
        if (capturedRetentionScope) segmentDialog.querySelector('.report-audit-list').replaceChildren();
        capturedRetentionScope = null;
      });
      report.append(segmentDialog);
      return segmentDialog;
    }
    function retentionSnapshot() {
      const snapshot = getRetentionSegments();
      const current = getScope();
      const scope = snapshot?.scope;
      if (!scope || current?.source !== 'own' || !['owner','admin'].includes(scope.role)
        || scope.organization !== current.organization || scope.session !== current.session || scope.role !== current.role) return null;
      return snapshot;
    }
    function refreshRetentionSegments() {
      const snapshot = retentionSnapshot();
      report?.querySelectorAll('[data-report-retention-segment]').forEach(button => { button.disabled = !snapshot; });
      if (capturedRetentionScope && JSON.stringify(snapshot?.scope || null) !== capturedRetentionScope) invalidate();
    }
    function openRetentionSegment(kind) {
      if (!retentionSegmentTitles[kind]) return false;
      const snapshot = retentionSnapshot();
      const rows = snapshot?.segments?.[kind];
      if (!Array.isArray(rows)) { refreshRetentionSegments(); return false; }
      const dialog = ensureSegmentDialog();
      capturedRetentionScope = JSON.stringify(snapshot.scope);
      capturedScope = null;
      const caption = dialog.querySelector('.report-audit-head small');
      if (caption) caption.textContent = 'Возврат клиентов';
      dialog.querySelector('#reportSegmentTitle').textContent = retentionSegmentTitles[kind];
      dialog.querySelector('.report-audit-scope').textContent = `${snapshot.scope.organizationName || 'Организация'} · Все филиалы. Период и сотрудник статистики не применяются.`;
      dialog.querySelector('.report-audit-count').textContent = `${clientCount(rows.length)} · только просмотр · сообщения не отправляются`;
      const list = dialog.querySelector('.report-audit-list');
      list.replaceChildren();
      if (!rows.length) {
        const empty = document.createElement('p'); empty.textContent = 'В этом сегменте пока нет клиентов.'; list.append(empty);
      }
      for (const row of rows) {
        const item = document.createElement('article'), name = document.createElement('strong'), meta = document.createElement('small');
        name.textContent = row.name;
        const consent = row.consent === 'unknown' ? ' · согласие не указано' : '';
        meta.textContent = `Последний завершённый визит: ${localDate(row.last)} · визитов ${row.visits}${consent}`;
        item.append(name, meta); list.append(item);
      }
      dialog.showModal(); return true;
    }
    function mountRetentionSegments() {
      report?.querySelectorAll('[data-report-retention-segment]').forEach(button => {
        button.addEventListener('click', () => openRetentionSegment(button.dataset.reportRetentionSegment));
      });
      refreshRetentionSegments();
    }
    function openSegment(kind) {
      if (!segmentTitles[kind]) return false;
      const scope = readyScope();
      if (!scope) return false;
      const segments = getSegments();
      const rows = segments?.[kind];
      if (!Array.isArray(rows)) return false;
      const dialog = ensureSegmentDialog();
      const caption = dialog.querySelector('.report-audit-head small');
      if (caption) caption.textContent = 'Клиенты за период';
      capturedScope = { ...scope };
      dialog.querySelector('#reportSegmentTitle').textContent = segmentTitles[kind];
      dialog.querySelector('.report-audit-scope').textContent = scopeText(scope);
      dialog.querySelector('.report-audit-count').textContent = `${clientCount(rows.length)} · только просмотр${kind === 'returning' ? ' · был визит до начала периода' : ''}`;
      const list = dialog.querySelector('.report-audit-list');
      list.replaceChildren();
      if (!rows.length) {
        const empty = document.createElement('p');
        empty.textContent = 'В этом сегменте пока нет клиентов.';
        list.append(empty);
      }
      for (const row of rows) {
        const item = document.createElement('article');
        const name = document.createElement('strong');
        const meta = document.createElement('small');
        name.textContent = String(row.name || 'Без имени');
        meta.textContent = `Первый в периоде: ${localDate(row.first)} · последний в периоде: ${localDate(row.last)} · визитов ${Number(row.visits) || 0}`;
        item.append(name, meta);
        list.append(item);
      }
      dialog.showModal();
      return true;
    }
    function mountSegments() {
      const kinds = ['all', 'new', 'returning'];
      report?.querySelectorAll('.report-clients .report-metric-row article').forEach((article, index) => {
        const kind = kinds[index];
        if (!kind) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `${article.className} report-segment-button`.trim();
        button.dataset.reportSegment = kind;
        button.setAttribute('aria-label', `Показать клиентов: ${segmentTitles[kind]}`);
        while (article.firstChild) button.append(article.firstChild);
        const title = button.querySelector('small');
        if (title) title.textContent = segmentTitles[kind];
        if (kind === 'returning') {
          const note = button.querySelector('span');
          if (note) note.title = 'Был визит до начала выбранного периода';
        }
        button.addEventListener('click', () => openSegment(kind));
        article.replaceWith(button);
      });
    }

    function ensureReviewDialog() {
      if (reviewDialog) return reviewDialog;
      reviewDialog = document.createElement('dialog');
      reviewDialog.className = 'report-audit-dialog report-export-review';
      reviewDialog.setAttribute('aria-labelledby', 'reportExportReviewTitle');
      reviewDialog.innerHTML = '<div class="report-audit-head"><div><small>Параметры отчёта</small><h3 id="reportExportReviewTitle">Отчёт по визитам</h3></div></div><p class="report-audit-scope"></p><p class="report-audit-scope-note"></p><p class="report-audit-format"></p><p class="report-audit-contents"></p><p class="report-audit-privacy"></p><label class="report-audit-consent" hidden><input type="checkbox"><span>Подтверждаю скачивание отчёта с полными телефонами клиентов на это устройство</span></label><p class="report-audit-error" role="alert" hidden></p><div class="report-audit-actions"><button type="button" class="secondary-button" data-audit-cancel>Отмена</button><button type="button" class="primary" data-audit-confirm>Скачать</button></div>';
      reviewDialog.querySelector('[data-audit-cancel]').addEventListener('click', () => reviewDialog.close());
      reviewDialog.querySelector('[data-audit-confirm]').addEventListener('click', confirmExport);
      reviewDialog.addEventListener('close', () => { capturedScope = null; pendingFormat = ''; pendingPrivacy = ''; reviewDialog.querySelector('input').checked = false; });
      report.append(reviewDialog);
      return reviewDialog;
    }
    function openExport() {
      syncExportControls(getScope());
      const scope = readyScope();
      if (!scope || !exportDialog) return false;
      capturedScope = { ...scope };
      let summary = exportDialog.querySelector('.report-audit-scope');
      if (!summary) {
        summary = document.createElement('p');
        summary.className = 'report-audit-scope';
        exportDialog.querySelector('.report-export-head')?.after(summary);
      }
      renderExportSelection(scope);
      const title = exportDialog.querySelector('#reportExportTitle');
      if (title) title.textContent = 'Отчёт по визитам';
      const intro = exportDialog.querySelector('.report-export-head p');
      if (intro) intro.textContent = 'Выберите формат. Отчёт строится по датам визитов; расходы и финансовый журнал не входят.';
      for (const format of Object.keys(contents)) {
        const hint = exportDialog.querySelector(`[data-report-export="${format}"] small`);
        if (hint) hint.textContent = exportContents(format, scope);
      }
      exportDialog.showModal();
      return true;
    }
    function chooseFormat(format) {
      if (!formats[format]) return false;
      const scope = readyScope();
      if (!capturedScope || scopeKey(scope) !== scopeKey(capturedScope)) { invalidate(); return false; }
      const privacy = $('#reportExportPrivacy')?.value;
      if (!phoneModes[privacy] || privacy === 'full' && (scope.source !== 'own' || scope.role !== 'owner')) return false;
      pendingFormat = format;
      pendingPrivacy = format === 'pdf' ? 'none' : privacy;
      closeIfOpen(exportDialog);
      const dialog = ensureReviewDialog();
      dialog.querySelector('.report-audit-scope').textContent = exportScopeText(scope);
      dialog.querySelector('.report-audit-scope-note').textContent = exportScopeNote(scope);
      dialog.querySelector('.report-audit-format').textContent = `Формат: ${formats[format]}`;
      dialog.querySelector('.report-audit-contents').textContent = `Состав: ${exportContents(format, scope)}`;
      dialog.querySelector('.report-audit-privacy').textContent = `Телефоны: ${phoneModes[pendingPrivacy]}`;
      dialog.querySelector('.report-audit-consent').hidden = pendingPrivacy !== 'full';
      dialog.querySelector('input').checked = false;
      dialog.querySelector('.report-audit-error').hidden = true;
      dialog.showModal();
      return true;
    }
    function confirmExport() {
      const scope = readyScope();
      if (!reviewDialog?.open || !capturedScope || scopeKey(scope) !== scopeKey(capturedScope)) { invalidate(); return false; }
      const checkbox = reviewDialog.querySelector('.report-audit-consent input');
      if (pendingPrivacy === 'full' && !checkbox.checked) {
        const error = reviewDialog.querySelector('.report-audit-error');
        error.textContent = 'Подтвердите скачивание полных телефонов.';
        error.hidden = false;
        checkbox.focus();
        return false;
      }
      const format = pendingFormat;
      const privacy = pendingPrivacy;
      closeIfOpen(reviewDialog);
      download(format, privacy);
      return true;
    }
    function renderVisitExportScope() {
      const scope = getScope();
      const money = (scope?.view || report?.dataset.reportTab) === 'money';
      const button = $('#exportBookings');
      const label = button?.querySelector('span');
      if (label) label.textContent = money ? 'Отчёт по визитам' : 'Экспорт';
      button?.setAttribute('aria-label', money ? 'Отчёт по визитам' : 'Экспорт');
      const note = $('#reportVisitExportScope');
      if (!note) return;
      note.hidden = !money;
      note.textContent = money && scope
        ? 'Отчёт по визитам: ' + scopeText(scope) + '. Экспорт финансовых операций и расходов пока недоступен.'
        : '';
    }
    function mountExport() {
      if (report && !$('#reportVisitExportScope')) {
        const note = document.createElement('p');
        note.id = 'reportVisitExportScope';
        note.className = 'report-visit-export-scope';
        note.hidden = true;
        (report.querySelector('.report-head') || $('#exportBookings'))?.after(note);
        new MutationObserver(refresh).observe(report, { attributes:true, attributeFilter:['data-report-tab'] });
      }
      renderVisitExportScope();
      // Capture protects the review even if the legacy direct-download listener
      // was registered earlier on a format button.
      $('#exportBookings')?.addEventListener('click', event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        openExport();
      }, true);
      exportDialog?.addEventListener('click', event => {
        const format = event.target.closest('[data-report-export]');
        const close = event.target.closest('[data-close-report-export]');
        if (format || close) {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (format) chooseFormat(format.dataset.reportExport);
          else { closeIfOpen(exportDialog); capturedScope = null; }
        } else if (event.target === exportDialog) { closeIfOpen(exportDialog); capturedScope = null; }
      }, true);
      for (const selector of ['#reportExportLocation', '#reportExportSegment']) $(selector)?.addEventListener('change', () => {
        const scope = readyScope();
        if (!scope) { invalidate(); return; }
        capturedScope = { ...scope };
        renderExportSelection(scope);
        const hint = exportDialog?.querySelector('[data-report-export="xlsx"] small');
        if (hint) hint.textContent = exportContents('xlsx', scope);
      });
    }

    function validateCustomDates() {
      const start = $('#reportDateFrom');
      const end = $('#reportDateTo');
      const form = $('#reportCustomPeriod');
      if (!start || !end || !form) return false;
      const invalidStart = !start.value || !/^\d{4}-\d{2}-\d{2}$/.test(start.value);
      const invalidEnd = !end.value || !/^\d{4}-\d{2}-\d{2}$/.test(end.value) || !invalidStart && start.value > end.value;
      for (const [field, invalid, message] of [[start, invalidStart, 'Укажите дату начала.'], [end, invalidEnd, 'Дата окончания должна быть не раньше начала.']]) {
        field.setAttribute('aria-invalid', String(invalid));
        const id = `${field.id}Error`;
        let error = document.getElementById(id);
        if (!error) { error = document.createElement('small'); error.id = id; error.className = 'report-date-error'; field.after(error); }
        error.textContent = invalid ? message : '';
        error.hidden = !invalid;
        field.setAttribute('aria-describedby', id);
      }
      if (invalidStart || invalidEnd) { (invalidStart ? start : end).focus(); return false; }
      return true;
    }
    function mountDateValidation() {
      const form = $('#reportCustomPeriod');
      if (form) {
        form.noValidate = true;
        form.addEventListener('submit', event => {
          if (validateCustomDates()) return;
          event.preventDefault();
          event.stopImmediatePropagation();
        }, true);
      }
      for (const input of [$('#reportDateFrom'), $('#reportDateTo')]) input?.addEventListener('input', () => {
        input.removeAttribute('aria-invalid');
        const error = document.getElementById(`${input.id}Error`);
        if (error) { error.hidden = true; error.textContent = ''; }
      });
    }
    function mountHeatmapHint() {
      const heatmap = $('#reportHeatmap');
      if (!heatmap || $('#reportHeatmapScrollHint')) return;
      const hint = document.createElement('p');
      hint.id = 'reportHeatmapScrollHint';
      hint.className = 'report-heatmap-scroll-hint';
      hint.textContent = 'Проведите по таблице вбок, чтобы увидеть остальные дни →';
      heatmap.before(hint);
      heatmap.addEventListener('scroll', () => {
        if (Math.abs(heatmap.scrollLeft) > 1) hint.hidden = true;
      }, { passive:true });
    }
    function mount() { mountSegments(); mountRetentionSegments(); mountExport(); mountDateValidation(); mountHeatmapHint(); }
    return { mount, refresh, refreshRetentionSegments, openSegment, openRetentionSegment, openExport, chooseFormat, validateCustomDates, invalidate };
  }

  root.MinutaStatisticsAuditUI = Object.freeze({ create, buildClientSegments, buildRetentionSegments, scopeKey, scopeText });
})(window);
