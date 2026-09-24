// Read-only client drill-down and explicit export review for the provider report.
(function (root) {
  'use strict';

  const segmentTitles = Object.freeze({ all:'Посетило', new:'Новые', returning:'Постоянные' });
  const formats = Object.freeze({ xlsx:'Excel (.xlsx)', csv:'CSV (.csv)', pdf:'PDF (.pdf)' });
  const phoneModes = Object.freeze({ masked:'Телефоны частично скрыты', none:'Без телефонов', full:'Полные телефоны клиентов' });

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

  function scopeKey(scope) {
    if (!scope) return '';
    return JSON.stringify([scope.session, scope.organization, scope.organizationName, scope.source, scope.start, scope.end, scope.performer, scope.performerName, scope.status]);
  }

  function scopeText(scope) {
    const date = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value.split('-').reverse().join('.') : '—';
    return `${date(scope.start)} — ${date(scope.end)} · ${scope.performerName || 'Личная статистика'} · ${scope.organizationName || (scope.source === 'demo' ? 'Демо' : 'Мои данные')}`;
  }

  function create({ document, getScope, getSegments, download }) {
    if (!document || typeof getScope !== 'function' || typeof getSegments !== 'function' || typeof download !== 'function') throw new TypeError('statistics UI dependencies are required');
    const $ = selector => document.querySelector(selector);
    const report = $('#analyticsView');
    const exportDialog = $('#reportExportDialog');
    let segmentDialog;
    let reviewDialog;
    let capturedScope = null;
    let pendingFormat = '';
    let pendingPrivacy = '';

    function closeIfOpen(dialog) { if (dialog?.open) dialog.close(); }
    function readyScope() {
      const scope = getScope();
      return scope && scope.status === 'ready' && scope.start && scope.end && scope.start <= scope.end ? scope : null;
    }
    function invalidate() {
      capturedScope = null;
      pendingFormat = '';
      pendingPrivacy = '';
      closeIfOpen(segmentDialog);
      closeIfOpen(reviewDialog);
      closeIfOpen(exportDialog);
    }
    function refresh() {
      if (capturedScope && scopeKey(getScope()) !== scopeKey(capturedScope)) invalidate();
    }

    function ensureSegmentDialog() {
      if (segmentDialog) return segmentDialog;
      segmentDialog = document.createElement('dialog');
      segmentDialog.className = 'report-audit-dialog report-segment-dialog';
      segmentDialog.setAttribute('aria-labelledby', 'reportSegmentTitle');
      segmentDialog.innerHTML = '<div class="report-audit-head"><div><small>Клиенты за период</small><h3 id="reportSegmentTitle"></h3></div><button type="button" class="secondary-button" data-audit-close>Закрыть</button></div><p class="report-audit-scope"></p><p class="report-audit-count"></p><div class="report-audit-list"></div>';
      segmentDialog.querySelector('[data-audit-close]').addEventListener('click', () => segmentDialog.close());
      segmentDialog.addEventListener('close', () => { capturedScope = null; });
      report.append(segmentDialog);
      return segmentDialog;
    }
    function openSegment(kind) {
      if (!segmentTitles[kind]) return false;
      const scope = readyScope();
      if (!scope) return false;
      const segments = getSegments();
      const rows = segments?.[kind];
      if (!Array.isArray(rows)) return false;
      const dialog = ensureSegmentDialog();
      capturedScope = { ...scope };
      dialog.querySelector('#reportSegmentTitle').textContent = segmentTitles[kind];
      dialog.querySelector('.report-audit-scope').textContent = scopeText(scope);
      dialog.querySelector('.report-audit-count').textContent = `${rows.length} ${rows.length === 1 ? 'клиент' : 'клиентов'} · только просмотр`;
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
        meta.textContent = `Первый визит ${row.first || '—'} · последний ${row.last || '—'} · визитов ${Number(row.visits) || 0}`;
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
        button.addEventListener('click', () => openSegment(kind));
        article.replaceWith(button);
      });
    }

    function ensureReviewDialog() {
      if (reviewDialog) return reviewDialog;
      reviewDialog = document.createElement('dialog');
      reviewDialog.className = 'report-audit-dialog report-export-review';
      reviewDialog.setAttribute('aria-labelledby', 'reportExportReviewTitle');
      reviewDialog.innerHTML = '<div class="report-audit-head"><div><small>Проверьте файл перед скачиванием</small><h3 id="reportExportReviewTitle">Экспорт отчёта</h3></div></div><p class="report-audit-scope"></p><p class="report-audit-format"></p><p class="report-audit-privacy"></p><label class="report-audit-consent" hidden><input type="checkbox"><span>Подтверждаю скачивание отчёта с полными телефонами клиентов на это устройство</span></label><p class="report-audit-error" role="alert" hidden></p><div class="report-audit-actions"><button type="button" class="secondary-button" data-audit-cancel>Отмена</button><button type="button" class="primary" data-audit-confirm>Скачать</button></div>';
      reviewDialog.querySelector('[data-audit-cancel]').addEventListener('click', () => reviewDialog.close());
      reviewDialog.querySelector('[data-audit-confirm]').addEventListener('click', confirmExport);
      reviewDialog.addEventListener('close', () => { capturedScope = null; pendingFormat = ''; pendingPrivacy = ''; reviewDialog.querySelector('input').checked = false; });
      report.append(reviewDialog);
      return reviewDialog;
    }
    function openExport() {
      const scope = readyScope();
      if (!scope || !exportDialog) return false;
      capturedScope = { ...scope };
      let summary = exportDialog.querySelector('.report-audit-scope');
      if (!summary) {
        summary = document.createElement('p');
        summary.className = 'report-audit-scope';
        exportDialog.querySelector('.report-export-head')?.after(summary);
      }
      summary.textContent = scopeText(scope);
      exportDialog.showModal();
      return true;
    }
    function chooseFormat(format) {
      if (!formats[format]) return false;
      const scope = readyScope();
      if (!capturedScope || scopeKey(scope) !== scopeKey(capturedScope)) { invalidate(); return false; }
      const privacy = $('#reportExportPrivacy')?.value;
      if (!phoneModes[privacy]) return false;
      pendingFormat = format;
      pendingPrivacy = privacy;
      closeIfOpen(exportDialog);
      const dialog = ensureReviewDialog();
      dialog.querySelector('.report-audit-scope').textContent = scopeText(scope);
      dialog.querySelector('.report-audit-format').textContent = `Формат: ${formats[format]}`;
      dialog.querySelector('.report-audit-privacy').textContent = phoneModes[privacy];
      dialog.querySelector('.report-audit-consent').hidden = privacy !== 'full';
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
    function mountExport() {
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
    }
    function mount() { mountSegments(); mountExport(); mountDateValidation(); mountHeatmapHint(); }
    return { mount, refresh, openSegment, openExport, chooseFormat, validateCustomDates, invalidate };
  }

  root.MinutaStatisticsAuditUI = Object.freeze({ create, buildClientSegments, scopeKey, scopeText });
})(window);
