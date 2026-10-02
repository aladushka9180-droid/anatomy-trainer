(function (global) {
  'use strict';

  const instances = new WeakMap();
  const MONEY_TYPES = new Set(['income', 'expense', 'refund', 'adjustment']);
  const PERIOD_FALLBACK = Object.freeze([{ value:'current_month', label:'Текущий месяц' }]);
  const MASTER_FALLBACK = Object.freeze([{ value:'', label:'Все мастера' }]);

  function integer(value) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : 0;
  }

  function nonnegative(value) { return Math.max(0, integer(value)); }

  function text(value, fallback = '') {
    const normalized = String(value == null ? '' : value).trim();
    return normalized || fallback;
  }

  function formatRubles(value) {
    const minor = integer(value);
    const sign = minor < 0 ? '\u2212' : '';
    const absolute = Math.abs(minor);
    const rubles = Math.floor(absolute / 100).toLocaleString('ru-RU');
    const kopecks = absolute % 100;
    return `${sign}${rubles}${kopecks ? `,${String(kopecks).padStart(2, '0')}` : ''}\u00a0\u20bd`;
  }

  function parseRubles(value) {
    const normalized = String(value || '').trim().replace(/\s+/g, '').replace(',', '.');
    if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return 0;
    const [whole, fraction = ''] = normalized.split('.');
    const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    return Number.isSafeInteger(minor) && minor > 0 ? minor : 0;
  }

  function requestUuid() {
    if (typeof global.crypto?.randomUUID === 'function') return global.crypto.randomUUID();
    if (typeof global.crypto?.getRandomValues !== 'function') throw new Error('secure_request_id_unavailable');
    const bytes = global.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const value = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
  }

  function todayInTimezone(timezone) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone:timezone, year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function optionRows(rows, fallback) {
    const safe = Array.isArray(rows) ? rows.map(item => ({
      value:text(item?.value ?? item?.id),
      label:text(item?.label ?? item?.name)
    })).filter(item => item.label) : [];
    return safe.length ? safe : fallback.map(item => ({ ...item }));
  }

  function normalizeDashboard(raw = {}) {
    const summary = raw.summary || {};
    const receivedMinor = integer(summary.receivedMinor ?? raw.received_minor);
    const expenseMinor = integer(summary.expenseMinor ?? raw.expense_minor);
    const serviceMinor = nonnegative(summary.serviceMinor ?? raw.service_minor);
    const debtMinor = nonnegative(summary.debtMinor ?? raw.debt_minor);
    const totalVisits = nonnegative(summary.totalVisits ?? raw.total_visits);
    const paymentKnownVisits = Math.min(totalVisits, nonnegative(summary.paymentKnownVisits ?? raw.payment_known_visits));
    const unpostedVisits = Math.min(totalVisits, nonnegative(summary.unpostedVisits));
    const serviceValueUnknownVisits = Math.min(totalVisits, nonnegative(summary.serviceValueUnknownVisits));
    const movement = Array.isArray(raw.movement) ? raw.movement.map((item, index) => ({
      key:text(item?.key, String(index)),
      label:text(item?.label, '\u2014'),
      fullLabel:text(item?.fullLabel, text(item?.label, '\u2014')),
      receivedMinor:integer(item?.receivedMinor),
      expenseMinor:integer(item?.expenseMinor)
    })) : [];
    const categories = Array.isArray(raw.expenseCategories) ? raw.expenseCategories.map((item, index) => ({
      id:text(item?.id, String(index)),
      name:text(item?.name, 'Без категории'),
      amountMinor:integer(item?.amountMinor)
    })).filter(item => item.amountMinor !== 0) : [];
    const operations = Array.isArray(raw.operations) ? raw.operations.map(normalizeOperation).filter(Boolean) : [];
    const directory = Array.isArray(raw.expenseDirectory) ? raw.expenseDirectory.map(item => ({
      id:text(item?.id), name:text(item?.name)
    })).filter(item => item.id && item.name) : [];
    const paymentAccounts = Array.isArray(raw.paymentAccounts) ? raw.paymentAccounts.map(item => ({
      id:text(item?.id), name:text(item?.name)
    })).filter(item => item.id && item.name) : [];
    return {
      available:raw.available === true,
      financeEnabled:raw.financeEnabled === true,
      resultReliable:raw.resultReliable === true,
      availabilityMessage:text(raw.availabilityMessage),
      organizationId:text(raw.organizationId),
      contextToken:raw.contextToken || null,
      today:text(raw.today),
      periodLabel:text(raw.periodLabel, 'Выбранный период'),
      bounds:raw.bounds || null,
      dateBasis:text(raw.dateBasis, 'visits_and_operations'),
      cashProjectionUnavailable:Boolean(raw.cashProjectionUnavailable),
      rentCategoryId:text(raw.rentCategoryId),
      goods:raw.goods?.known ? { ...raw.goods, rows:Array.isArray(raw.goods.rows) ? raw.goods.rows : [] } : { known:false, rows:[] },
      comparison:raw.comparison || null,
      visits:raw.visits || null,
      timezone:text(raw.timezone, 'Europe/Samara'),
      summary:{ receivedMinor, expenseMinor, serviceMinor, debtMinor, totalVisits, paymentKnownVisits, unpostedVisits, serviceValueUnknownVisits, netMinor:receivedMinor - expenseMinor },
      movement,
      expenseCategories:categories,
      operations,
      expenseDirectory:directory,
      paymentAccounts,
      permissions:{ canAddExpense:Boolean(raw.permissions?.canAddExpense) },
      filters:{
        periods:optionRows(raw.filters?.periods, PERIOD_FALLBACK),
        masters:optionRows(raw.filters?.masters, MASTER_FALLBACK),
        selectedPeriod:text(raw.filters?.selectedPeriod),
        selectedMaster:text(raw.filters?.selectedMaster)
      },
      completeness:{
        partial:Boolean(raw.completeness?.partial || (totalVisits > paymentKnownVisits)),
        message:text(raw.completeness?.message)
      },
      nextCursor:text(raw.nextCursor)
    };
  }

  function mergeVisitSnapshot(data, visits) {
    if (!data || !visits || visits.source !== 'own' || !data.organizationId
        || visits.organizationId !== data.organizationId || visits.masterId !== data.filters.selectedMaster
        || visits.bounds?.start !== data.bounds?.start || visits.bounds?.end !== data.bounds?.end
        || (data.contextToken && visits.contextToken !== data.contextToken)) return data;
    if (!visits.known) return { ...data, visits };
    const rows = visits.rows;
    if (!Array.isArray(rows) || rows.some(row => !Number.isSafeInteger(row.serviceMinor) || !Number.isSafeInteger(row.paymentMinor))) return data;
    const serviceMinor = rows.reduce((sum, row) => sum + row.serviceMinor, 0);
    if (!Number.isSafeInteger(serviceMinor)) return data;
    return { ...data, visits, summary:{ ...data.summary, serviceMinor, totalVisits:rows.length,
      paymentKnownVisits:rows.filter(row => row.paymentKnown).length,
      // Old RPC counters qualify a different, manual-only visit source.
      unpostedVisits:0, serviceValueUnknownVisits:rows.filter(row => row.serviceKnown === false).length } };
  }

  function normalizeOperation(item) {
    if (!item || !MONEY_TYPES.has(item.type)) return null;
    const amountMinor = integer(item.amountMinor);
    if (!amountMinor) return null;
    return {
      id:text(item.id),
      occurredAt:text(item.occurredAt),
      type:item.type,
      label:text(item.label, 'Финансовая операция'),
      category:text(item.category),
      actorName:text(item.actorName),
      categoryId:text(item.categoryId), flow:text(item.flow, item.type === 'expense' ? 'expense' : 'received'),
      amountMinor
    };
  }

  function createElement(tag, className, content) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (content != null) element.textContent = content;
    return element;
  }

  function metricIcon(kind) {
    const paths = {
      profit:'<ellipse cx="9" cy="6" rx="6" ry="3"/><path d="M3 6v5c0 1.7 2.7 3 6 3m-6-3v5c0 1.7 2.7 3 6 3m6-13v4"/><circle cx="16" cy="16" r="5"/>',
      received:'<path d="M20 8V5a2 2 0 0 0-2-2H6a3 3 0 0 0 0 6h14v11H6a3 3 0 0 1-3-3V6"/><path d="M20 12h-5a2 2 0 0 0 0 4h5"/><path d="M16 14h.01"/>',
      expense:'<path d="M5 3l2 1 2-1 3 1 3-1 2 1 2-1v18l-2-1-2 1-3-1-3 1-2-1-2 1V3Z"/><path d="M9 8h6m-6 4h6m-6 4h4"/>',
      rent:'<path d="M4 21V5l8-2v18m0-13h8v13M2 21h20M8 7h.01M8 11h.01M8 15h.01M16 12h.01M16 16h.01"/>',
      goods:'<path d="m3 7 9-4 9 4v10l-9 4-9-4V7Zm0 0 9 4 9-4m-9 4v10M7.5 5l9 4"/>'
    };
    return `<svg class="finance-center__metric-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[kind]}</svg>`;
  }

  function metricHeading(kind, label) {
    return `<span class="finance-center__metric-heading">${metricIcon(kind)}<span class="finance-center__metric-name">${label}</span><svg class="finance-center__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></span>`;
  }

  function summaryShell(overview = false) {
    return `<section class="finance-center__summary${overview ? ' finance-center__overview' : ''}" aria-label="Главные финансовые показатели">
      <div class="finance-center__hero">
        <button class="finance-center__metric is-profit" type="button" data-finance-detail="profit">${metricHeading('profit','Чистая прибыль')}<strong data-finance-profit>—</strong><small class="finance-center__profit-note">Не рассчитано · <span>Что не учтено</span></small></button>
        <button class="finance-center__metric" type="button" data-finance-detail="received">${metricHeading('received','Получено')}<strong data-finance-received>—</strong><small data-finance-received-note>Учтённые оплаты</small><small class="finance-center__comparison"><span data-finance-change="received"></span><span data-finance-comparison-period="received"></span></small></button>
        <button class="finance-center__metric" type="button" data-finance-detail="expense">${metricHeading('expense','Общие расходы')}<strong data-finance-expense>—</strong><small>Оплаченные расходы</small><small class="finance-center__comparison"><span data-finance-change="expense"></span><span data-finance-comparison-period="expense"></span></small></button>
      </div>
      <div class="finance-center__compact-metrics">
        <button type="button" data-finance-detail="rent">${metricHeading('rent','Аренда')}<strong data-finance-rent>—</strong><small>В составе расходов</small></button>
        <button type="button" data-finance-detail="goods">${metricHeading('goods','Продано товаров')}<strong data-finance-goods>—</strong><small data-finance-goods-note>Количество и сумма</small></button>
      </div>
      <button class="finance-center__data-state" type="button" data-finance-detail="completeness"><span data-finance-data-state>Не рассчитано</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 10v6m0-9v1"/></svg></button>
      <p class="finance-center__date-basis" data-finance-date-basis></p>
    </section>`;
  }

  function changeLabel(current, previous) {
    if (!Number.isSafeInteger(current) || !Number.isSafeInteger(previous)) return '';
    const delta = current - previous;
    if (!Number.isSafeInteger(delta)) return '';
    const amount = `${delta > 0 ? '+' : ''}${formatRubles(delta)}`;
    if (!previous) return `${amount} к прошлому периоду`;
    const percent = Math.round(delta / Math.abs(previous) * 1000) / 10;
    return `${percent > 0 ? '+' : ''}${percent.toLocaleString('ru-RU')}% · ${amount}`;
  }

  function dataReasons(data) {
    const reasons = [];
    if (!data?.available) return [data?.availabilityMessage || 'Финансовый источник пока недоступен. Попробуйте обновить данные.'];
    if (!data.financeEnabled) reasons.push('Финансовый журнал ещё не подключён. Подтверждённые расходы и операции недоступны. Его настройка находится в разделе «Продажи».');
    if (data.cashProjectionUnavailable) reasons.push('Не удалось подтвердить движение денег по журналу за выбранные даты. Доступные суммы из отчёта по визитам сохранены. Попробуйте обновить данные.');
    if (data.dateBasis !== 'operations') reasons.push('Часть оплат учтена по датам визитов: отдельная дата денежной операции не подтверждена. Эти суммы нельзя сравнивать с движением денег по датам операций.');
    if (data.visits && !data.visits.known) reasons.push('Визиты за этот период ещё не подтверждены. Известные финансовые операции сохранены; обновите данные, чтобы проверить визиты.');
    const total = data.visits && !data.visits.known ? 0 : data.summary.totalVisits, known = data.summary.paymentKnownVisits;
    if (total > known) reasons.push(`Оплата не указана у ${total - known} из ${total} визитов. Проверьте результаты визитов; неизвестная оплата не считается долгом.`);
    if (data.summary.unpostedVisits) reasons.push(`Оплата отмечена, но не проведена в журнале у ${data.summary.unpostedVisits} визитов. Отметка оплаты и финансовая проводка не являются двумя поступлениями. Список таких визитов источник не передал.`);
    if (data.summary.serviceValueUnknownVisits) reasons.push(`Визиты без стоимости: ${data.summary.serviceValueUnknownVisits}.${data.visits?.known ? ' Известные цены сохранены; откройте визиты без стоимости.' : ' Список этих визитов источник не передал.'}`);
    if (data.financeEnabled && data.dateBasis !== 'operations' && !data.resultReliable && total === known && !data.summary.unpostedVisits && !data.summary.serviceValueUnknownVisits)
      reasons.push('Полный денежный результат не подтверждён. Источник не передал отдельную причину или список проблемных данных.');
    if (Number(total > known) + Number(Boolean(data.summary.unpostedVisits)) + Number(Boolean(data.summary.serviceValueUnknownVisits)) > 1) reasons.push('Причины могут относиться к одному визиту; их количества нельзя складывать.');
    if (data.visits?.known && data.visits.rows.some(row => row.paymentKnown && row.paymentMinor))
      reasons.push('Отметки оплаты визитов относятся к дате визита. Они не заменяют финансовые операции и могут отличаться от «Получено» за те же даты.');
    if (!data.goods.known) reasons.push('Источник продаж товаров не подтвердил количество и сумму за эти даты. Товары и абонементы учитываются отдельно.');
    reasons.push('Чистая прибыль не рассчитана: нет подтверждённого полного учёта себестоимости, налогов и остальных затрат. Денежный результат показывает только получено минус оплаченные расходы.');
    return reasons;
  }

  function renderSummary(target, data) {
    const set = (selector, value) => { const node = target.querySelector(selector); if (node) node.textContent = value; };
    const available = data?.available;
    set('[data-finance-received]', available ? formatRubles(data.summary.receivedMinor) : '—');
    set('[data-finance-expense]', available && data.financeEnabled ? formatRubles(data.summary.expenseMinor) : '—');
    const rent = available && data.financeEnabled && data.rentCategoryId
      ? data.expenseCategories.filter(item => item.id === data.rentCategoryId).reduce((sum, item) => sum + item.amountMinor, 0) : null;
    set('[data-finance-rent]', rent === null ? '—' : formatRubles(rent));
    set('[data-finance-goods]', data?.goods.known ? `${Number(data.goods.quantity).toLocaleString('ru-RU')} шт.` : '—');
    set('[data-finance-goods-note]', data?.goods.known ? `Продажи на ${formatRubles(data.goods.amountMinor)}` : 'Источник недоступен');
    set('[data-finance-received-note]', !available ? 'Источник недоступен' : data.dateBasis === 'operations' ? 'После возвратов' : 'Отметки оплаты · по визитам');
    set('[data-finance-date-basis]', !available ? 'Движение денег за эти даты не подтверждено. Обновите данные.' : data.dateBasis === 'operations'
      ? 'Деньги — по дате операции. Визиты ниже — по дате визита.'
      : 'Часть оплат — по датам визитов. Движение денег пока не подтверждено.');
    set('[data-finance-data-state]', available && data.financeEnabled ? 'Учтена часть данных' : 'Не рассчитано');
    for (const kind of ['received','expense']) {
      const previous = data?.comparison?.[`${kind}Minor`];
      set(`[data-finance-change="${kind}"]`, previous == null ? '' : changeLabel(data.summary[`${kind}Minor`], previous));
      const change = target.querySelector(`[data-finance-change="${kind}"]`);
      if (change && data?.comparison?.bounds) {
        change.textContent = change.textContent.replace(' к прошлому периоду', '');
        set(`[data-finance-comparison-period="${kind}"]`, `к ${comparisonPeriod(data.comparison.bounds)}`);
      } else set(`[data-finance-comparison-period="${kind}"]`, '');
      const node = target.querySelector(`[data-finance-change="${kind}"]`);
      if (node && data?.comparison?.bounds) node.title = `Сравнение: ${data.comparison.bounds.start} — ${data.comparison.bounds.end}`;
    }
    target.querySelectorAll('.finance-center__summary [data-finance-detail]').forEach(button => {
      const label = [...button.querySelectorAll('.finance-center__metric-name, strong, small:not(.finance-center__comparison), [data-finance-change], [data-finance-comparison-period], [data-finance-data-state]')]
        .map(node => node.textContent.trim()).filter(Boolean).join(' ');
      button.setAttribute('aria-label', `${label}. Открыть детализацию`);
    });
  }

  function comparisonPeriod(bounds) {
    const format = date => new Intl.DateTimeFormat('ru-RU', {day:'numeric',month:'short',timeZone:'UTC',
      ...(bounds.start.slice(0,4) !== bounds.end.slice(0,4) ? {year:'numeric'} : {})}).format(new Date(date + 'T12:00:00Z'));
    if (bounds.start === bounds.end) return format(bounds.start);
    if (bounds.start.slice(0,7) === bounds.end.slice(0,7)) return `${Number(bounds.start.slice(8))}–${format(bounds.end)}`;
    return `${format(bounds.start)} — ${format(bounds.end)}`;
  }

  function shell() {
    return `
      <section class="finance-center" aria-labelledby="financeCenterTitle">
        <header class="finance-center__head">
          <div><h2 id="financeCenterTitle">Деньги</h2></div>
          <button class="finance-center__primary" type="button" data-finance-add>Добавить расход</button>
        </header>
        <div class="finance-center__filters" aria-label="Фильтры финансов">
          <label><span>Период</span><select data-finance-period></select></label>
          <label><span>Мастер</span><select data-finance-master></select></label>
        </div>
        <p class="finance-center__scope" data-finance-scope hidden></p>
        <div class="finance-center__status" data-finance-status role="status" aria-live="polite"></div>
        <div class="finance-center__unavailable" data-finance-unavailable hidden><div aria-hidden="true">!</div><section><h3>Финансовый итог пока недоступен</h3><p data-finance-unavailable-message></p></section></div>
        <div data-finance-content hidden>
          ${summaryShell()}
          <aside class="finance-center__completeness" data-finance-completeness hidden aria-live="polite"></aside>
          <dl class="finance-center__trust-metrics">
            <div><dt>Денежный результат</dt><dd data-finance-net></dd><small>получено минус оплаченные расходы</small></div>
            <div><dt>Оказано услуг</dt><dd><button class="finance-center__visit-value" type="button" data-finance-detail="visits"><span data-finance-services></span><span aria-hidden="true">›</span></button></dd><small data-finance-services-note>стоимость состоявшихся визитов</small></div>
            <div><dt>Долг</dt><dd data-finance-debt></dd><small>подтверждённая неоплата</small></div>
          </dl>
          <div class="finance-center__visuals">
            <section class="finance-center__panel finance-center__movement" aria-labelledby="financeMovementTitle">
              <div class="finance-center__section-head"><div><h3 id="financeMovementTitle">По дням</h3><p data-finance-period-label></p></div><div class="finance-center__legend" aria-label="Обозначения"><span class="is-income">+ Получено</span><span class="is-expense">\u2212 Расходы</span></div></div>
              <div class="finance-center__chart" data-finance-chart role="group" aria-describedby="financeChartHelp"></div>
              <p id="financeChartHelp" class="finance-center__chart-help">Выберите столбец или используйте стрелки, чтобы увидеть точные суммы.</p>
              <p class="finance-center__chart-detail" data-finance-chart-detail aria-live="polite"></p>
            </section>
            <section class="finance-center__panel finance-center__structure" aria-labelledby="financeStructureTitle">
              <div class="finance-center__section-head"><div><h3 id="financeStructureTitle">Структура расходов</h3><p>Только подтверждённые расходы</p></div></div>
              <div data-finance-ring></div>
            </section>
          </div>
          <section class="finance-center__panel finance-center__operations" aria-labelledby="financeOperationsTitle">
            <div class="finance-center__section-head"><div><h3 id="financeOperationsTitle">Операции</h3><p>Последние подтверждённые записи</p></div></div>
            <div data-finance-operations></div>
            <button class="finance-center__more" type="button" data-finance-more hidden>Показать ещё</button>
          </section>
        </div>
        <div class="finance-center__empty" data-finance-empty hidden>
          <div aria-hidden="true">\u20bd</div><h3>Пока нет подтверждённых операций</h3>
          <p>Полученная оплата появится после отметки результата визита или продажи. Расход можно добавить вручную.</p>
          <button class="finance-center__primary" type="button" data-finance-empty-action>Добавить расход</button>
        </div>
        <dialog class="finance-center__dialog finance-center__detail-dialog" data-finance-detail-dialog aria-labelledby="financeDetailTitle">
          <div class="finance-center__dialog-card"><div class="finance-center__dialog-head"><h3 id="financeDetailTitle"></h3><button type="button" data-finance-detail-close aria-label="Закрыть детализацию">×</button></div>
            <p class="finance-center__detail-scope" data-finance-detail-scope></p><div data-finance-detail-body></div>
          </div>
        </dialog>
        <dialog class="finance-center__dialog" data-finance-dialog aria-labelledby="financeExpenseTitle">
          <form method="dialog" class="finance-center__dialog-card" data-finance-form>
            <div class="finance-center__dialog-head"><div><p>Новая операция</p><h3 id="financeExpenseTitle">Добавить расход</h3></div><button type="button" data-finance-close aria-label="Закрыть">\u00d7</button></div>
            <div class="finance-center__form-row">
              <label><span>Категория</span><select name="categoryId" required data-finance-category></select></label>
              <label><span>Списать с</span><select name="paymentAccountId" required data-finance-account></select></label>
            </div>
            <div class="finance-center__form-row">
              <label><span>Сумма</span><span class="finance-center__money-input"><input name="amount" inputmode="decimal" autocomplete="off" placeholder="0" required><b>\u20bd</b></span></label>
              <label><span>Дата</span><input name="occurredOn" type="date" required></label>
            </div>
            <label><span>Комментарий</span><input name="note" maxlength="160" autocomplete="off" placeholder="Например, расходные материалы"></label>
            <p class="finance-center__form-note">Операция сохранится в журнале. Исправление выполняется корректировкой, без тихого изменения истории.</p>
            <p class="finance-center__form-error" data-finance-form-error role="alert" hidden></p>
            <div class="finance-center__dialog-actions"><button type="button" data-finance-cancel>Отмена</button><button class="finance-center__primary" type="submit" data-finance-submit>Добавить расход</button></div>
          </form>
        </dialog>
      </section>`;
  }

  function init(options = {}) {
    const root = options.root;
    if (!(root instanceof Element)) throw new TypeError('finance_root_required');
    if (!options.adapter || typeof options.adapter.readDashboard !== 'function') throw new TypeError('finance_adapter_required');
    instances.get(root)?.destroy();
    root.innerHTML = shell();

    const adapter = options.adapter;
    const onNotice = typeof options.onNotice === 'function' ? options.onNotice : function () {};
    const state = {
      destroyed:false, data:null, operations:[], nextCursor:'', requestId:'', loadVersion:0,
      period:text(options.initialScope?.period || options.initialPeriod, 'current_month'), master:text(options.initialScope?.masterId || options.initialMaster), abort:null,
      sharedScope:options.initialScope || null,
      scopeKey:options.initialScope ? JSON.stringify(options.initialScope) : '', detail:'', detailTrigger:null, visibleOperations:30
    };
    let detailDialog = null;
    const find = selector => root.querySelector(selector) || (detailDialog?.matches(selector) ? detailDialog : detailDialog?.querySelector(selector));
    const elements = {
      status:find('[data-finance-status]'), content:find('[data-finance-content]'), empty:find('[data-finance-empty]'),
      period:find('[data-finance-period]'), master:find('[data-finance-master]'), add:find('[data-finance-add]'), emptyAction:find('[data-finance-empty-action]'),
      dialog:find('[data-finance-dialog]'), form:find('[data-finance-form]'), category:find('[data-finance-category]'), account:find('[data-finance-account]'), formError:find('[data-finance-form-error]'), submit:find('[data-finance-submit]'),
      chart:find('[data-finance-chart]'), chartDetail:find('[data-finance-chart-detail]'), ring:find('[data-finance-ring]'), operations:find('[data-finance-operations]'), more:find('[data-finance-more]')
    };
    detailDialog = find('[data-finance-detail-dialog]');
    // Keep the modal outside the tab-specific ancestor so Overview can open it.
    (root.closest('#analyticsView') || root).append(detailDialog);
    const listeners = [];
    function listen(target, type, handler) { target?.addEventListener(type, handler); listeners.push(() => target?.removeEventListener(type, handler)); }
    let overview = null;
    function enableSharedScope() {
      if (overview || !root.closest('#analyticsView')) return;
      overview = document.createElement('section');
      overview.id = 'reportFinanceOverview';
      overview.className = 'finance-center finance-center--overview';
      overview.dataset.reportSection = 'overview';
      overview.setAttribute('aria-label', 'Финансы за выбранный период');
      overview.innerHTML = summaryShell(true);
      root.before(overview);
      root.closest('#analyticsView').classList.add('report-financial-first');
      listen(overview, 'click', event => {
        const button = event.target.closest('[data-finance-detail]');
        if (button) openDetail(button.dataset.financeDetail, button);
      });
    }
    if (options.initialScope) enableSharedScope();
    if (options.initialScope) root.querySelector('.finance-center__filters').hidden = true;

    function fillOptions(select, rows, selected) {
      select.replaceChildren();
      rows.forEach(item => {
        const option = document.createElement('option'); option.value = item.value; option.textContent = item.label; select.append(option);
      });
      if ([...select.options].some(option => option.value === selected)) select.value = selected;
    }

    function setLoading(loading, message = '') {
      root.querySelector('.finance-center')?.setAttribute('aria-busy', String(loading));
      elements.status.textContent = message;
      elements.status.hidden = !message;
      find('[data-finance-scope]').hidden = loading || Boolean(message) || !state.data?.available;
    }

    function setMoney(selector, value, known = true) {
      const element = find(selector); element.textContent = known ? formatRubles(value) : '\u2014'; element.classList.toggle('is-negative', known && value < 0);
      element.classList.toggle('is-compact', known && element.textContent.length > 13);
      element.classList.toggle('is-ultra-compact', known && element.textContent.length > 18);
    }

    function renderChart(points, expensesKnown) {
      elements.chart.replaceChildren();
      const empty = !points.some(point => point.receivedMinor || point.expenseMinor);
      elements.chart.classList.toggle('is-empty', empty);
      find('#financeChartHelp').hidden = empty;
      if (empty) {
        elements.chart.append(createElement('p', 'finance-center__inline-empty', 'Нет движения денег за выбранный период.'));
        elements.chartDetail.textContent = '';
        return;
      }
      const max = Math.max(1, ...points.flatMap(point => [Math.abs(point.receivedMinor), Math.abs(point.expenseMinor)]));
      const grid = createElement('div', 'finance-center__chart-grid');
      grid.style.setProperty('--finance-points', String(points.length));
      points.forEach((point, index) => {
        const button = createElement('button', 'finance-center__chart-point');
        button.type = 'button'; button.dataset.chartIndex = String(index);
        button.setAttribute('aria-label', `${point.fullLabel}. Получено ${formatRubles(point.receivedMinor)}. ${expensesKnown ? `Расходы ${formatRubles(point.expenseMinor)}.` : 'Расходы не подключены.'}`);
        const bars = createElement('span', 'finance-center__bars');
        const income = createElement('i', `finance-center__bar is-income${point.receivedMinor ? '' : ' is-zero'}`); income.style.setProperty('--finance-height', `${Math.max(2, Math.round(Math.abs(point.receivedMinor) / max * 100))}%`);
        bars.append(income);
        if (expensesKnown) { const expense = createElement('i', `finance-center__bar is-expense${point.expenseMinor ? '' : ' is-zero'}`); expense.style.setProperty('--finance-height', `${Math.max(2, Math.round(Math.abs(point.expenseMinor) / max * 100))}%`); bars.append(expense); }
        button.append(bars, createElement('span', 'finance-center__chart-label', point.label));
        button.addEventListener('click', () => selectChartPoint(index));
        button.addEventListener('keydown', event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const last = points.length - 1;
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? last : Math.max(0, Math.min(last, index + (event.key === 'ArrowRight' ? 1 : -1)));
          grid.querySelector(`[data-chart-index="${next}"]`)?.focus(); selectChartPoint(next);
        });
        grid.append(button);
      });
      elements.chart.append(grid);
      function selectChartPoint(index) {
        grid.querySelectorAll('.finance-center__chart-point').forEach((button, itemIndex) => button.classList.toggle('is-selected', itemIndex === index));
        const point = points[index];
        elements.chartDetail.textContent = `${point.fullLabel}: получено ${formatRubles(point.receivedMinor)}, ${expensesKnown ? `расходы ${formatRubles(point.expenseMinor)}` : 'расходы не подключены'}.`;
      }
      selectChartPoint(points.length - 1);
    }

    function renderRing(categories, expenseMinor, expensesKnown) {
      elements.ring.replaceChildren();
      if (!expensesKnown) {
        elements.ring.append(createElement('p', 'finance-center__inline-empty', 'Структура расходов появится после подключения финансового журнала.'));
        return;
      }
      if (categories.some(item => item.amountMinor < 0)) {
        elements.ring.append(createElement('p', 'finance-center__inline-empty', 'Учтены корректировки расходов. Доли не показаны; суммы доступны ниже.'));
        for (const item of categories) {
          const button = createElement('button', 'finance-center__detail-category', `${item.name} · ${formatRubles(item.amountMinor)}`); button.type = 'button';
          button.addEventListener('click', () => openDetail(`category:${item.id}`, button)); elements.ring.append(button);
        }
        return;
      }
      if (!categories.length || expenseMinor <= 0) {
        elements.ring.append(createElement('p', 'finance-center__inline-empty', 'Расходов по категориям пока нет.'));
        return;
      }
      const total = categories.reduce((sum, item) => sum + item.amountMinor, 0) || expenseMinor;
      let offset = 0;
      const stops = categories.map((item, index) => {
        const start = offset; offset += item.amountMinor / total * 100;
        return `color-mix(in srgb, var(--theme-accent, #296b4b) ${Math.max(35, 92 - index * 11)}%, var(--theme-surface, #fff)) ${start}% ${offset}%`;
      });
      const layout = createElement('div', 'finance-center__ring-layout');
      const ring = createElement('div', 'finance-center__ring'); ring.style.background = `conic-gradient(${stops.join(',')})`;
      ring.setAttribute('role', 'img'); ring.setAttribute('aria-label', `Расходы по категориям, всего ${formatRubles(total)}`);
      const hole = createElement('div'); hole.append(createElement('span', '', 'Всего'), createElement('strong', '', formatRubles(total))); ring.append(hole);
      const list = createElement('ul', 'finance-center__category-list');
      categories.forEach((item, index) => {
        const row = createElement('li'); row.style.setProperty('--finance-category-tone', String(Math.max(35, 92 - index * 11)));
        const label = createElement('span'); label.append(createElement('i'), createElement('b', '', item.name));
        const button = createElement('button', 'finance-center__category-action'); button.type = 'button';
        button.append(label, createElement('strong', '', formatRubles(item.amountMinor)));
        button.addEventListener('click', () => openDetail(`category:${item.id}`, button));
        row.append(button); list.append(row);
      });
      layout.append(ring, list); elements.ring.append(layout);
    }

    function operationDate(value, timezone) {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return 'Дата не указана';
      return new Intl.DateTimeFormat('ru-RU', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit', timeZone:timezone }).format(date);
    }

    function renderOperations(ledgerKnown = true) {
      elements.operations.replaceChildren();
      if (!ledgerKnown) {
        elements.operations.append(createElement('p', 'finance-center__inline-empty', 'Подтверждённые операции появятся после подключения финансового журнала.'));
        elements.more.hidden = true;
        return;
      }
      if (!state.operations.length) {
        elements.operations.append(createElement('p', 'finance-center__inline-empty', 'Операций за выбранный период нет.'));
      } else {
        const list = createElement('div', 'finance-center__operation-list');
        state.operations.slice(0, state.visibleOperations).forEach(operation => {
          const row = createElement('article', `finance-center__operation is-${operation.type}`);
          const sign = operation.type === 'expense' || operation.type === 'refund' || operation.amountMinor < 0 ? '\u2212' : '+';
          const copy = createElement('div');
          const meta = [operationDate(operation.occurredAt, state.data.timezone), operation.category, operation.actorName ? `Внёс: ${operation.actorName}` : ''].filter(Boolean).join(' \u00b7 ');
          copy.append(createElement('strong', '', operation.label), createElement('small', '', meta));
          const amount = createElement('b', '', `${sign}${formatRubles(Math.abs(operation.amountMinor))}`); amount.setAttribute('aria-label', `${sign === '+' ? 'Поступление' : 'Списание'} ${formatRubles(Math.abs(operation.amountMinor))}`);
          row.append(copy, amount); list.append(row);
        });
        elements.operations.append(list);
      }
      elements.more.hidden = !(state.operations.length > state.visibleOperations || state.nextCursor && typeof adapter.readOperations === 'function');
    }

    function render(data) {
      state.data = data; state.operations = data.operations; state.nextCursor = data.nextCursor; state.visibleOperations = 30;
      state.period = data.filters.selectedPeriod || state.period; state.master = data.filters.selectedMaster || state.master;
      fillOptions(elements.period, data.filters.periods, state.period); fillOptions(elements.master, data.filters.masters, state.master);
      const scope = find('[data-finance-scope]');
      scope.textContent = data.available ? 'Финансовые данные: ' + data.periodLabel + ' · ' + (elements.master.selectedOptions[0]?.textContent || 'Все мастера') : '';
      scope.hidden = !data.available;
      renderSummary(root, data);
      if (overview) renderSummary(overview, data);
      const unavailable = find('[data-finance-unavailable]');
      if (!data.available) {
        unavailable.hidden = false;
        find('[data-finance-unavailable-message]').textContent = data.availabilityMessage || 'Серверный финансовый источник не подтвердил готовность. Данные и операции не подменяются расчётом в браузере.';
        elements.content.hidden = true; elements.empty.hidden = true; elements.add.hidden = true; elements.emptyAction.hidden = true;
        return;
      }
      unavailable.hidden = true;
      const ledgerKnown = data.financeEnabled;
      const netKnown = ledgerKnown && data.dateBasis === 'operations' && !data.cashProjectionUnavailable && Number.isSafeInteger(data.summary.netMinor);
      setMoney('[data-finance-net]', data.summary.netMinor, netKnown); setMoney('[data-finance-received]', data.summary.receivedMinor);
      const serviceKnown = !data.visits || data.visits.known && (data.visits.rows.length === 0 || data.visits.rows.some(row => row.serviceKnown !== false));
      setMoney('[data-finance-expense]', data.summary.expenseMinor, ledgerKnown); setMoney('[data-finance-services]', data.summary.serviceMinor, serviceKnown); setMoney('[data-finance-debt]', data.summary.debtMinor);
      find('[data-finance-services-note]').textContent = data.summary.serviceValueUnknownVisits ? `известная стоимость · без цены: ${data.summary.serviceValueUnknownVisits}` : 'стоимость состоявшихся визитов';
      find('[data-finance-detail="visits"]').setAttribute('aria-label', `Оказано услуг: ${find('[data-finance-services]').textContent}. Открыть детализацию`);
      find('[data-finance-period-label]').textContent = data.periodLabel;
      const completeness = find('[data-finance-completeness]');
      completeness.replaceChildren();
      completeness.hidden = true;
      const canAddExpense = data.permissions.canAddExpense && ledgerKnown && typeof adapter.createExpense === 'function';
      elements.add.hidden = !canAddExpense; elements.emptyAction.hidden = true;
      elements.content.hidden = false; elements.empty.hidden = true;
      const expenseLegend = root.querySelector('.finance-center__legend .is-expense');
      expenseLegend.textContent = ledgerKnown ? '\u2212 Расходы' : '\u2212 Расходы не подключены';
      renderChart(data.movement, ledgerKnown); renderRing(data.expenseCategories, data.summary.expenseMinor, ledgerKnown); renderOperations(ledgerKnown); fillExpenseChoices(data.expenseDirectory, data.paymentAccounts);
    }

    function closeDetail() {
      const dialog = find('[data-finance-detail-dialog]');
      if (dialog.open) dialog.close();
    }

    function openDetail(kind, trigger) {
      const data = state.data;
      state.detail = kind; state.detailTrigger = trigger || null;
      const dialog = find('[data-finance-detail-dialog]'), body = find('[data-finance-detail-body]');
      const categoryId = kind.startsWith('category:') ? kind.slice(9) : kind === 'rent' ? data?.rentCategoryId : '';
      const category = data?.expenseCategories.find(item => item.id === categoryId);
      const titles = { profit:'Чистая прибыль', received:'Получено', expense:'Общие расходы', rent:'Аренда', goods:'Продано товаров', completeness:'Полнота данных', visits:'Оказано услуг', 'payment-unknown':'Визиты без отметки оплаты', 'service-unknown':'Визиты без стоимости' };
      find('#financeDetailTitle').textContent = categoryId && kind.startsWith('category:') ? category?.name || 'Категория расходов' : titles[kind] || 'Детализация';
      find('[data-finance-detail-scope]').textContent = `${data?.periodLabel || 'Выбранный период'} · ${data?.visits?.performerName || elements.master.selectedOptions[0]?.textContent || 'Вся команда'}`;
      body.replaceChildren();
      if (state.master) body.append(createElement('p', 'finance-center__detail-note', 'Показаны операции выбранного сотрудника. Общие расходы организации без назначения сотруднику сюда не входят.'));
      if (!data?.available || ['profit', 'completeness'].includes(kind)) {
        const reasons = dataReasons(data);
        for (const reason of kind === 'profit' && data?.available ? reasons.slice(-1) : reasons) body.append(createElement('p', 'finance-center__detail-note', reason));
        if (data?.visits?.known && data.summary.totalVisits > data.summary.paymentKnownVisits && kind === 'completeness') {
          const visits = createElement('button', 'finance-center__more', 'Визиты без отметки оплаты'); visits.type = 'button';
          visits.addEventListener('click', () => openDetail('payment-unknown', state.detailTrigger)); body.append(visits);
        }
        if (data?.visits?.known && data.summary.serviceValueUnknownVisits && kind === 'completeness') {
          const prices = createElement('button', 'finance-center__more', 'Визиты без стоимости'); prices.type = 'button';
          prices.addEventListener('click', () => openDetail('service-unknown', state.detailTrigger)); body.append(prices);
        }
        if (data?.available && data.financeEnabled && data.dateBasis === 'operations') {
          body.append(createElement('p', 'finance-center__detail-formula', `Денежный результат: ${formatRubles(data.summary.receivedMinor)} − ${formatRubles(data.summary.expenseMinor)} = ${formatRubles(data.summary.netMinor)}. Это результат по учтённым операциям; он не равен подтверждённой чистой прибыли.`));
        }
        if (kind === 'profit' && data?.financeEnabled) {
          const costs = createElement('button', 'finance-center__more', 'Проверить оплаченные расходы'); costs.type = 'button';
          costs.addEventListener('click', () => openDetail('expense', state.detailTrigger)); body.append(costs);
          const completeness = createElement('button', 'finance-center__more', 'Полнота остальных данных'); completeness.type = 'button';
          completeness.addEventListener('click', () => openDetail('completeness', state.detailTrigger)); body.append(completeness);
        }
        const action = createElement('button', 'finance-center__more', data && !data.financeEnabled ? 'Открыть «Продажи»' : 'Обновить данные'); action.type = 'button';
        action.addEventListener('click', () => {
          closeDetail();
          if (data && !data.financeEnabled) document.querySelector('[data-section-target="commercePanel"]')?.click();
          else void load();
        });
        if (!(data && !data.financeEnabled) || document.querySelector('[data-section-target="commercePanel"]')) body.append(action);
      } else if (['visits','payment-unknown','service-unknown'].includes(kind)) {
        if (!data.visits?.known) body.append(createElement('p', 'finance-center__detail-note', 'Выборка визитов ещё не подтверждена. Обновите данные.'));
        else {
          const rows = data.visits.rows.filter(row => (kind !== 'payment-unknown' || !row.paymentKnown) && (kind !== 'service-unknown' || row.serviceKnown === false));
          const amount = rows.reduce((sum, row) => sum + row.serviceMinor, 0);
          const count = rows.length, word = count % 10 === 1 && count % 100 !== 11 ? 'визит'
            : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? 'визита' : 'визитов';
          body.append(createElement('p', 'finance-center__detail-formula', `${count} ${word} · ${formatRubles(amount)}`));
          body.append(createElement('p', 'finance-center__detail-note', 'Стоимость услуг по дате визита, включая импортированную историю. Это не сумма поступивших денег. Неизвестная оплата не считается долгом.'));
          if (rows.some(row => row.serviceKnown === false)) body.append(createElement('p','finance-center__detail-note','У части визитов цена не указана. Показана только известная стоимость; отсутствующая цена не заменяется нулём.'));
          for (const row of rows.slice(0,state.visibleOperations)) {
            const item = createElement('article', 'finance-center__operation'), copy = createElement('div');
            const date = new Intl.DateTimeFormat('ru-RU', {day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(row.date + 'T12:00:00Z'));
            copy.append(createElement('strong','',row.label), createElement('small','',`${date}${row.time ? ' · ' + row.time : ''}`),
              createElement('small','',row.paymentKnown ? `Отмечено полученным: ${formatRubles(row.paymentMinor)}` : 'Оплата не указана'));
            item.append(copy,createElement('b','',row.serviceKnown === false ? '—' : formatRubles(row.serviceMinor))); body.append(item);
          }
          if (!rows.length) body.append(createElement('p','finance-center__inline-empty','Визитов в этой выборке нет.'));
          if (rows.length > state.visibleOperations) {
            const more = createElement('button','finance-center__more','Показать ещё'); more.type='button';
            more.addEventListener('click',()=>{state.visibleOperations+=30;openDetail(kind,state.detailTrigger);}); body.append(more);
          }
          if (rows.length && kind !== 'service-unknown' && typeof adapter.openVisitJournal === 'function') {
            const journal = createElement('button','finance-center__more','Открыть визиты в журнале'); journal.type='button';
            journal.addEventListener('click',()=>{if(adapter.openVisitJournal({snapshot:data.visits,unknownOnly:kind==='payment-unknown'}))closeDetail();}); body.append(journal);
          }
        }
        const back = createElement('button','finance-center__more','Назад к полноте данных'); back.type='button';
        back.addEventListener('click',()=>openDetail('completeness',state.detailTrigger)); body.append(back);
      } else if (kind === 'goods') {
        if (!data.goods.known) body.append(createElement('p', 'finance-center__detail-note', 'Количество и сумма продаж товаров пока недоступны.'));
        else {
          body.append(createElement('p', 'finance-center__detail-formula', `${Number(data.goods.quantity).toLocaleString('ru-RU')} шт. · ${formatRubles(data.goods.amountMinor)}`));
          body.append(createElement('p', 'finance-center__detail-note', 'Проданные товары по дате продажи. Абонементы исключены. Здесь показаны исходные продажи; возвраты уменьшают «Получено» по дате возврата.'));
          for (const row of data.goods.rows.slice(0, state.visibleOperations)) {
            const item = createElement('article', 'finance-center__operation');
            const copy = createElement('div'); copy.append(createElement('strong', '', row.name), createElement('small', '', `${operationDate(row.occurredAt, data.timezone)} · ${Number(row.quantity).toLocaleString('ru-RU')} шт.`));
            item.append(copy, createElement('b', '', formatRubles(row.amountMinor))); body.append(item);
          }
          if (!data.goods.rows.length) body.append(createElement('p', 'finance-center__inline-empty', 'Продаж товаров за эти даты нет.'));
          if (data.goods.rows.length > state.visibleOperations) {
            const more = createElement('button', 'finance-center__more', 'Показать ещё'); more.type = 'button';
            more.addEventListener('click', () => { state.visibleOperations += 30; openDetail(kind, state.detailTrigger); }); body.append(more);
          }
        }
      } else if (kind === 'rent' && !data.rentCategoryId) {
        body.append(createElement('p', 'finance-center__detail-note', 'Источник не подтвердил категорию «Аренда». Сумма аренды не заменяется общими расходами.'));
        const action = createElement('button', 'finance-center__more', 'Обновить данные'); action.type = 'button';
        action.addEventListener('click', () => { closeDetail(); void load(); }); body.append(action);
      } else {
        const isReceived = kind === 'received';
        const amount = isReceived ? data.summary.receivedMinor : kind === 'expense' ? data.summary.expenseMinor : category?.amountMinor || 0;
        const known = isReceived || data.financeEnabled && (kind === 'expense' || categoryId);
        body.append(createElement('p', 'finance-center__detail-formula', known ? formatRubles(amount) : 'Не рассчитано'));
        if (known && data.dateBasis === 'operations' && !data.cashProjectionUnavailable)
          body.append(createElement('p', 'finance-center__detail-note', 'Данные полные для проведённых операций. Полнота отметок в визитах проверяется отдельно.'));
        body.append(createElement('p', 'finance-center__detail-note', data.dateBasis === 'operations'
          ? 'Отбор по дате финансовой операции. Стоимость визитов в отчёте по визитам относится к дате визита; суммы могут различаться.'
          : 'Отчёт содержит отметки оплаты по датам визитов и финансовые операции. Отдельная дата некоторых оплат не подтверждена.'));
        if (!isReceived && kind === 'expense') for (const item of data.expenseCategories) {
          const button = createElement('button', 'finance-center__detail-category', `${item.name} · ${formatRubles(item.amountMinor)}`); button.type = 'button';
          button.addEventListener('click', () => openDetail(`category:${item.id}`, state.detailTrigger)); body.append(button);
        }
        if (kind === 'rent') body.append(createElement('p', 'finance-center__detail-note', 'Категория «Аренда» уже включена в общие расходы. Повторно вычитать её из результата не нужно.'));
        const rows = state.operations.filter(row => (isReceived ? row.flow === 'received' : row.flow === 'expense') && (!categoryId || row.categoryId === categoryId));
        for (const row of rows.slice(0, state.visibleOperations)) {
          const item = createElement('article', 'finance-center__operation'), copy = createElement('div');
          copy.append(createElement('strong', '', row.label), createElement('small', '', operationDate(row.occurredAt, data.timezone)));
          item.append(copy, createElement('b', '', `${row.amountMinor > 0 ? '+' : ''}${formatRubles(row.amountMinor)}`)); body.append(item);
        }
        if (!rows.length) body.append(createElement('p', 'finance-center__inline-empty', !data.financeEnabled ? 'Список проводок недоступен до подключения журнала.' : 'Подтверждённых операций этой категории за период нет.'));
        if (state.nextCursor || rows.length > state.visibleOperations) {
          body.append(createElement('p', 'finance-center__detail-note', 'Показана часть операций. Сумма выше относится ко всему выбранному периоду.'));
          const more = createElement('button', 'finance-center__more', 'Показать ещё'); more.type = 'button';
          more.addEventListener('click', async () => { more.disabled = true; await loadMore(); if (dialog.open) openDetail(kind, state.detailTrigger); }); body.append(more);
        }
      }
      if (data?.comparison?.bounds && ['received','expense'].includes(kind)) body.append(createElement('p', 'finance-center__detail-note', `Сопоставимый прошлый период: ${data.comparison.bounds.start} — ${data.comparison.bounds.end}. ${changeLabel(data.summary[`${kind}Minor`], data.comparison[`${kind}Minor`])}`));
      if (!dialog.open) dialog.showModal();
      find('[data-finance-detail-close]').focus({ preventScroll:true });
    }

    function fillExpenseChoices(rows, accounts) {
      elements.category.replaceChildren();
      const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = rows.length ? 'Выберите категорию' : 'Категории недоступны'; elements.category.append(placeholder);
      rows.forEach(item => { const option = document.createElement('option'); option.value = item.id; option.textContent = item.name; elements.category.append(option); });
      elements.account.replaceChildren();
      const accountPlaceholder = document.createElement('option'); accountPlaceholder.value = ''; accountPlaceholder.textContent = accounts.length ? 'Выберите счёт' : 'Счета недоступны'; elements.account.append(accountPlaceholder);
      accounts.forEach(item => { const option = document.createElement('option'); option.value = item.id; option.textContent = item.name; elements.account.append(option); });
      if (accounts.length === 1) elements.account.value = accounts[0].id;
      elements.submit.disabled = !rows.length || !accounts.length;
    }

    function normalizeRead(raw) {
      if (raw?.available === false && state.sharedScope?.bounds) {
        const bounds = raw.bounds || state.sharedScope.bounds;
        const format = date => new Intl.DateTimeFormat('ru-RU', { day:'numeric',month:'short',year:'numeric',timeZone:'UTC' }).format(new Date(date + 'T12:00:00Z'));
        const commonMaster = document.querySelector('#reportPerformerFilter');
        const masterName = commonMaster?.value === state.master ? commonMaster.selectedOptions[0]?.textContent : 'Сотрудник';
        raw = { ...raw, bounds, periodLabel:raw.periodLabel || (bounds.start === bounds.end ? format(bounds.end) : `${format(bounds.start)} — ${format(bounds.end)}`),
          filters:{ ...raw.filters, selectedPeriod:state.period, selectedMaster:state.master,
            masters:[{ value:'',label:'Вся команда' }, ...(state.master ? [{ value:state.master,label:masterName || 'Сотрудник' }] : [])] } };
      }
      return normalizeDashboard(raw);
    }

    async function load({ quiet = false } = {}) {
      const version = ++state.loadVersion;
      state.abort?.abort(); state.abort = new AbortController();
      if (!quiet) setLoading(true, state.data ? 'Обновляем данные\u2026' : 'Загружаем финансовые данные\u2026');
      try {
        const raw = await adapter.readDashboard({ period:state.period, masterId:state.master, signal:state.abort.signal });
        if (state.destroyed || version !== state.loadVersion) return;
        const normalized = normalizeRead(raw);
        if (!Array.isArray(raw?.filters?.periods)) normalized.filters.periods = optionRows(options.periods, PERIOD_FALLBACK);
        if (!Array.isArray(raw?.filters?.masters)) normalized.filters.masters = optionRows(options.masters, MASTER_FALLBACK);
        normalized.filters.selectedPeriod = normalized.filters.selectedPeriod || state.period;
        normalized.filters.selectedMaster = normalized.filters.selectedMaster || state.master;
        render(normalized); setLoading(false);
      } catch (error) {
        if (error?.name === 'AbortError' || state.destroyed || version !== state.loadVersion) return;
        setLoading(false, 'Не удалось загрузить финансовые данные.');
        if (!state.data) {
          render(normalizeRead({ available:false, availabilityMessage:'Не удалось загрузить данные за выбранные даты. Обновите данные.' }));
        }
      }
    }

    async function openExpense() {
      if (!state.data?.permissions.canAddExpense) return;
      const needsPreparation = !state.data.expenseDirectory.length || !state.data.paymentAccounts.length;
      if (needsPreparation && typeof adapter.prepareExpense === 'function') {
        elements.add.disabled = true; elements.emptyAction.disabled = true;
        setLoading(true, 'Готовим справочники расходов\u2026');
        try {
          const prepared = await adapter.prepareExpense({ period:state.period, masterId:state.master });
          if (prepared?.dashboard) render(normalizeDashboard(prepared.dashboard));
          else if (prepared && (Array.isArray(prepared.expenseDirectory) || Array.isArray(prepared.paymentAccounts))) {
            render(normalizeDashboard({ ...state.data, ...prepared, summary:state.data.summary, filters:state.data.filters }));
          } else await load({ quiet:true });
        } catch (error) {
          setLoading(false, text(error?.userMessage, 'Не удалось подготовить добавление расхода.'));
          elements.add.disabled = false; elements.emptyAction.disabled = false;
          return;
        }
        elements.add.disabled = false; elements.emptyAction.disabled = false; setLoading(false);
      }
      if (!state.data?.expenseDirectory.length || !state.data?.paymentAccounts.length) {
        setLoading(false, 'Для добавления расхода нужны доступная категория и счёт списания.');
        return;
      }
      elements.formError.hidden = true; elements.formError.textContent = '';
      if (!elements.form.elements.occurredOn.value) elements.form.elements.occurredOn.value = state.data.today || (typeof options.today === 'function' ? options.today() : todayInTimezone(state.data.timezone));
      if (typeof elements.dialog.showModal === 'function') elements.dialog.showModal(); else elements.dialog.setAttribute('open', '');
      elements.category.focus();
    }

    function closeExpense() { if (elements.dialog.open && typeof elements.dialog.close === 'function') elements.dialog.close(); else elements.dialog.removeAttribute('open'); }

    function expensePayload() {
      const fields = new FormData(elements.form); return {
        requestId:state.requestId || requestUuid(),
        categoryId:text(fields.get('categoryId')), paymentAccountId:text(fields.get('paymentAccountId')), amountMinor:parseRubles(fields.get('amount')),
        occurredOn:text(fields.get('occurredOn')), note:text(fields.get('note'))
      };
    }

    function ambiguous(error) { return Boolean(error?.ambiguous || ['AMBIGUOUS_RESULT', 'NETWORK_ERROR', 'TIMEOUT'].includes(error?.code)); }

    async function submitExpense(event) {
      event.preventDefault();
      const payload = expensePayload(); state.requestId = payload.requestId;
      if (!payload.categoryId || !payload.paymentAccountId || !payload.amountMinor || !/^\d{4}-\d{2}-\d{2}$/.test(payload.occurredOn)) {
        elements.formError.textContent = 'Проверьте категорию, счёт списания, дату и сумму расхода.'; elements.formError.hidden = false; return;
      }
      elements.submit.disabled = true; elements.submit.textContent = 'Сохраняем\u2026'; elements.formError.hidden = true;
      try {
        await adapter.createExpense(payload);
        state.requestId = ''; elements.form.reset(); closeExpense(); onNotice('Расход добавлен'); await load({ quiet:true });
      } catch (error) {
        if (ambiguous(error)) {
          let found = null;
          if (typeof adapter.findExpenseByRequestId === 'function') {
            try { found = await adapter.findExpenseByRequestId(payload.requestId); } catch (_) { found = null; }
          }
          if (found) {
            state.requestId = ''; elements.form.reset(); closeExpense(); onNotice('Расход уже сохранён'); await load({ quiet:true });
          } else {
            elements.formError.textContent = 'Не удалось подтвердить результат. Повтор использует тот же номер запроса и не создаст дубль.'; elements.formError.hidden = false;
          }
        } else {
          elements.formError.textContent = text(error?.userMessage, 'Не удалось добавить расход. Данные сохранены в форме.'); elements.formError.hidden = false;
        }
      } finally {
        elements.submit.disabled = !state.data?.expenseDirectory.length || !state.data?.paymentAccounts.length; elements.submit.textContent = state.requestId ? 'Повторить безопасно' : 'Добавить расход';
      }
    }

    async function loadMore() {
      if (state.operations.length > state.visibleOperations) { state.visibleOperations += 30; renderOperations(state.data?.financeEnabled); return; }
      if (!state.nextCursor || typeof adapter.readOperations !== 'function') return;
      elements.more.disabled = true; elements.more.textContent = 'Загружаем\u2026';
      try {
        const result = await adapter.readOperations({ period:state.period, masterId:state.master, cursor:state.nextCursor });
        const incoming = Array.isArray(result?.operations) ? result.operations.map(normalizeOperation).filter(Boolean) : [];
        const seen = new Set(state.operations.map(item => item.id).filter(Boolean));
        state.operations.push(...incoming.filter(item => !item.id || !seen.has(item.id)));
        state.visibleOperations = state.operations.length;
        state.nextCursor = text(result?.nextCursor); renderOperations();
      } catch (_) { onNotice('Не удалось загрузить следующие операции'); }
      finally { elements.more.disabled = false; elements.more.textContent = 'Показать ещё'; }
    }

    listen(root, 'click', event => {
      const button = event.target.closest('[data-finance-detail]');
      if (button) openDetail(button.dataset.financeDetail, button);
    });
    listen(find('[data-finance-detail-close]'), 'click', closeDetail);
    listen(detailDialog, 'click', event => { if (event.target === detailDialog) closeDetail(); });
    listen(detailDialog, 'close', () => state.detailTrigger?.focus({ preventScroll:true }));
    listen(elements.period, 'change', () => { state.period = elements.period.value; void load(); });
    listen(elements.master, 'change', () => { state.master = elements.master.value; void load(); });
    listen(elements.add, 'click', () => void openExpense()); listen(elements.emptyAction, 'click', () => void openExpense());
    listen(find('[data-finance-close]'), 'click', closeExpense); listen(find('[data-finance-cancel]'), 'click', closeExpense);
    listen(elements.form, 'submit', event => void submitExpense(event)); listen(elements.more, 'click', () => void loadMore());
    listen(elements.dialog, 'click', event => { if (event.target === elements.dialog) closeExpense(); });

    fillOptions(elements.period, optionRows(options.periods, PERIOD_FALLBACK), state.period);
    fillOptions(elements.master, optionRows(options.masters, MASTER_FALLBACK), state.master);
    const controller = {
      root,
      ready:load(),
      reload:() => load(),
      refreshVisits(visits) {
        if (!state.data) return;
        const updated = mergeVisitSnapshot(state.data, visits);
        if (updated !== state.data) render(updated);
      },
      setScope(scope) {
        const key = JSON.stringify(scope);
        if (key === state.scopeKey) return Promise.resolve();
        state.scopeKey = key; state.sharedScope = scope; state.period = scope.period; state.master = scope.masterId || '';
        state.data = null; state.operations = []; state.nextCursor = ''; elements.content.hidden = true;
        closeDetail(); enableSharedScope(); root.querySelector('.finance-center__filters').hidden = true;
        const unavailable = normalizeDashboard({ available:false });
        renderSummary(root, unavailable); renderSummary(overview, unavailable);
        return load();
      },
      openExpense,
      getState:() => ({ period:state.period, master:state.master, nextCursor:state.nextCursor, pendingRequestId:state.requestId }),
      destroy() {
        if (state.destroyed) return;
        state.destroyed = true; state.abort?.abort(); listeners.splice(0).forEach(remove => remove());
        closeDetail(); detailDialog.remove(); overview?.remove();
        const visits = document.querySelector('#reportVisitOverview');
        if (typeof global.MinutaStatisticsAuditProvider?.restoreVisitOverview === 'function') {
          global.MinutaStatisticsAuditProvider.restoreVisitOverview();
        } else if (visits) {
          const command = visits.querySelector('#reportCommandCenter'), insight = visits.querySelector('.report-period-details');
          if (command) visits.before(command);
          if (insight) visits.before(insight);
          visits.remove();
        }
        root.closest('#analyticsView')?.classList.remove('report-financial-first');
        if (elements.dialog.open) closeExpense(); root.replaceChildren(); instances.delete(root);
      }
    };
    instances.set(root, controller);
    return controller;
  }

  function destroy(target) {
    if (target?.destroy && typeof target.destroy === 'function') target.destroy();
    else if (target instanceof Element) instances.get(target)?.destroy();
  }

  global.MinutaFinanceCenter = Object.freeze({ init, destroy, formatRubles, parseRubles, changeLabel, normalizeDashboard, mergeVisitSnapshot });
})(globalThis);
