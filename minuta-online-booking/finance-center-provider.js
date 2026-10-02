(function (global) {
  'use strict';

  const PERIODS = Object.freeze([
    { value:'current_month', label:'Текущий месяц' },
    { value:'last30', label:'Последние 30 дней' },
    { value:'quarter', label:'Текущий квартал' },
    { value:'year', label:'Текущий год' }
  ]);
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function isoDate(date) {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
  }

  function addDays(date, days) {
    const value = new Date(date.getTime());
    value.setUTCDate(value.getUTCDate() + days);
    return value;
  }

  function periodBounds(period = 'current_month', today = new Date()) {
    const current = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate(), 12));
    let start;
    if (period === 'last30') start = addDays(current, -29);
    else if (period === 'quarter') start = new Date(Date.UTC(current.getUTCFullYear(), Math.floor(current.getUTCMonth() / 3) * 3, 1, 12));
    else if (period === 'year') start = new Date(Date.UTC(current.getUTCFullYear(), 0, 1, 12));
    else start = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1, 12));
    return { start:isoDate(start), end:isoDate(current) };
  }

  function periodTitle(start, end) {
    const format = new Intl.DateTimeFormat('ru-RU', { day:'numeric', month:'long', year:'numeric', timeZone:'UTC' });
    if (start === end) return format.format(new Date(`${start}T12:00:00Z`));
    return `${format.format(new Date(`${start}T12:00:00Z`))} — ${format.format(new Date(`${end}T12:00:00Z`))}`;
  }

  // Compare like-for-like dates. A missing baseline is never a zero baseline.
  function comparisonBounds(bounds, period) {
    if (!bounds?.start || !bounds?.end || period === 'all') return null;
    const start = new Date(`${bounds.start}T12:00:00Z`), end = new Date(`${bounds.end}T12:00:00Z`);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) return null;
    const days = Math.round((end - start) / 86400000) + 1;
    if (['month', 'current_month'].includes(period) && start.getUTCDate() === 1
        && start.getUTCMonth() === end.getUTCMonth() && start.getUTCFullYear() === end.getUTCFullYear()) {
      const previousStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1, 12));
      const previousEnd = addDays(previousStart, days - 1);
      if (previousEnd.getUTCMonth() !== previousStart.getUTCMonth()) return null;
      return { start:isoDate(previousStart), end:isoDate(previousEnd) };
    }
    return { start:isoDate(addDays(start, -days)), end:isoDate(addDays(start, -1)) };
  }

  function businessDate(value, timezone) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone:timezone, year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(date);
    const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${fields.year}-${fields.month}-${fields.day}`;
  }

  // The ledger's occurred_at is the operation date. Do not substitute booking_date.
  // Only complete, paginated RLS-protected reads are eligible for this projection.
  function projectCashLedger(transactions, { bounds, timezone, originals = [], expenses = [], debtSources = [], masterId = '', otherCategoryId = 'other', salaryCategoryId = 'salary' } = {}) {
    const bases = new Map([...originals, ...transactions].map(row => [row.id, row]));
    const expenseSources = new Map(expenses.map(row => [row.expense_source_id, row]));
    const settlements = new Map(debtSources.map(row => [row.id, row]));
    const movement = new Map(), categories = new Map(), operations = [];
    let receivedMinor = 0, expenseMinor = 0, classified = true;
    for (const row of transactions) {
      const day = businessDate(row.occurred_at, timezone);
      if (!day || day < bounds.start || day > bounds.end) continue;
      const postings = row.financial_postings || [];
      if (!postings.length) { classified = false; continue; }
      let cash = 0;
      for (const posting of postings) {
        const account = posting.financial_accounts;
        if (!account || !Number.isSafeInteger(Number(posting.amount_minor))) { classified = false; continue; }
        if (account.account_class === 'asset' && ['cash', 'bank'].includes(account.account_type))
          cash += (posting.side === 'debit' ? 1 : -1) * Number(posting.amount_minor);
      }
      if (!cash) continue;
      const base = row.operation_type === 'reversal' ? bases.get(row.reversal_of) : row;
      const kind = base?.operation_type;
      const income = ['visit_service', 'customer_debt_settlement', 'commercial_sale', 'commercial_refund'].includes(kind);
      const expense = ['supplier_expense_payment', 'payroll_payment'].includes(kind);
      if (!income && !expense) { classified = false; continue; }
      if (masterId) {
        if (!base.scopeResolved) { classified = false; continue; }
        if (base.performerId !== masterId) continue;
      }
      let receipt = cash, commission = 0;
      if (kind === 'customer_debt_settlement') {
        const source = settlements.get(base.source_id), sign = row.operation_type === 'reversal' ? -1 : 1;
        const gross = Number(source?.gross_minor), fee = Number(source?.commission_minor);
        if (!source || !Number.isSafeInteger(gross) || !Number.isSafeInteger(fee) || gross <= 0 || fee < 0 || fee >= gross || cash !== sign * (gross - fee)) {
          classified = false; continue;
        }
        // Preserve the existing contract: client payment before fees; fees are
        // included in expenses once. The cash result equals the account delta.
        receipt = sign * gross; commission = sign * fee;
      }
      const bucket = movement.get(day) || { key:day, label:bucketLabel(day, 'day'), fullLabel:bucketLabel(day, 'day', true), receivedMinor:0, expenseMinor:0 };
      const source = expenseSources.get(base.source_id);
      const category = kind === 'payroll_payment' ? 'Зарплата' : source?.category_name_snapshot || 'Прочее';
      const categoryId = source?.category_id || (kind === 'payroll_payment' ? salaryCategoryId : otherCategoryId);
      if (income) {
        receivedMinor += receipt; bucket.receivedMinor += receipt;
        if (commission) {
          expenseMinor += commission; bucket.expenseMinor += commission;
          const current = categories.get(otherCategoryId) || { id:otherCategoryId, name:'Прочее', amountMinor:0 };
          current.amountMinor += commission; categories.set(otherCategoryId, current);
          operations.push({ id:`${row.id}:commission`, occurredAt:row.occurred_at, type:row.operation_type === 'reversal' ? 'adjustment' : 'expense', flow:'expense',
            category:'Прочее', categoryId:otherCategoryId, label:'Комиссия за оплату', actorName:'', amountMinor:-commission });
        }
      }
      else {
        expenseMinor -= cash; bucket.expenseMinor -= cash;
        const current = categories.get(categoryId) || { id:categoryId, name:category, amountMinor:0 };
        current.amountMinor -= cash; categories.set(categoryId, current);
      }
      movement.set(day, bucket);
      operations.push({ id:row.id, occurredAt:row.occurred_at, type:row.operation_type === 'reversal' ? 'adjustment' : kind === 'commercial_refund' ? 'refund' : income ? 'income' : 'expense',
        flow:income ? 'received' : 'expense', category:expense ? category : '', categoryId:expense ? categoryId : '',
        label:row.operation_type === 'reversal' ? 'Корректировка операции' : ({ visit_service:'Оплата визита', customer_debt_settlement:'Погашение долга', commercial_sale:'Продажа', commercial_refund:'Возврат', supplier_expense_payment:'Оплата расхода', payroll_payment:'Выплата зарплаты' })[kind],
        actorName:'', amountMinor:income ? receipt : cash });
    }
    operations.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id));
    if (![receivedMinor, expenseMinor, receivedMinor - expenseMinor].every(Number.isSafeInteger)
        || [...movement.values()].some(row => ![row.receivedMinor, row.expenseMinor].every(Number.isSafeInteger))
        || [...categories.values()].some(row => !Number.isSafeInteger(row.amountMinor))) classified = false;
    return { classified, receivedMinor, expenseMinor, movement:[...movement.values()].sort((a,b) => a.key.localeCompare(b.key)), categories:[...categories.values()], operations };
  }

  function projectGoodsSales(sales, { bounds, timezone, masterId = '' } = {}) {
    const rows = [];
    let quantityUnits = 0, amountMinor = 0;
    for (const sale of sales) {
      const day = businessDate(sale.occurred_at, timezone);
      if (!day || day < bounds.start || day > bounds.end || (masterId && sale.seller_id !== masterId)) continue;
      if (!sale.commercial_sale_lines) return { known:false, rows:[] };
      const lines = Array.isArray(sale.commercial_sale_lines) ? sale.commercial_sale_lines : [sale.commercial_sale_lines];
      for (const line of lines) {
        if (line.item_kind !== 'inventory_item') continue;
        const count = Number(line.quantity), amount = Number(line.total_minor);
        if (!Number.isFinite(count) || count <= 0 || !Number.isSafeInteger(amount)) return { known:false, rows:[] };
        const units = Math.round(count * 1000);
        if (!Number.isSafeInteger(units) || Math.abs(count * 1000 - units) > 0.00001) return { known:false, rows:[] };
        quantityUnits += units; amountMinor += amount;
        if (!Number.isSafeInteger(quantityUnits) || !Number.isSafeInteger(amountMinor)) return { known:false, rows:[] };
        rows.push({ id:sale.id, occurredAt:sale.occurred_at, name:String(line.item_name || 'Товар'), quantity:count, amountMinor:amount });
      }
    }
    return { known:true, quantity:quantityUnits / 1000, amountMinor, rows };
  }

  function bucketLabel(value, grain, full = false) {
    const date = new Date(`${value}T12:00:00Z`);
    const options = full
      ? { day:'numeric', month:'long', year:'numeric', timeZone:'UTC' }
      : grain === 'week'
        ? { day:'numeric', month:'short', timeZone:'UTC' }
        : { day:'numeric', month:'short', timeZone:'UTC' };
    return new Intl.DateTimeFormat('ru-RU', options).format(date).replace('.', '');
  }

  function safeInteger(value) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : 0;
  }

  function operationType(row) {
    if (row?.kind === 'refund') return 'refund';
    if (row?.kind === 'correction') return 'adjustment';
    return safeInteger(row?.amount_minor) < 0 ? 'expense' : 'income';
  }

  function completenessMessage(confidence = {}) {
    const total = Math.max(0, safeInteger(confidence.completed_visits));
    const marked = Math.max(0, safeInteger(confidence.payment_marked_visits));
    const unposted = Math.max(0, safeInteger(confidence.unposted_payment_visits));
    const messages = [];
    if (total && marked < total) messages.push(`Оплата указана в ${marked} из ${total} визитов. Получено учитывает только подтверждённые деньги.`);
    if (unposted) messages.push(`${unposted} ${unposted === 1 ? 'визит учтён' : 'визитов учтены'} по подтверждённым результатам, но ещё не проведены в журнале.`);
    return messages.join(' ');
  }

  function normalizeFinanceScreen(raw, context = {}) {
    if (!raw || raw.schema !== 'minuta-finance-screen-v1' || raw.ledger_version !== 163
      || raw.organization_id !== context.organizationId || raw.currency !== 'RUB') {
      return { available:false, financeEnabled:false, resultReliable:false, availabilityMessage:'Сервер вернул неподтверждённый финансовый контекст.' };
    }
    const bounds = context.bounds || { start:raw.period?.start, end:raw.period?.end };
    const confidence = raw.confidence || {};
    const readiness = raw.expense_readiness || {};
    const grain = raw.period?.bucket_grain || 'day';
    const categories = Array.isArray(raw.categories) ? raw.categories : [];
    const accounts = Array.isArray(raw.accounts) ? raw.accounts : [];
    const operations = (Array.isArray(raw.operations) ? raw.operations : []).map(row => ({
      id:String(row.event_key || row.transaction_id || ''),
      occurredAt:String(row.occurred_at || ''),
      type:operationType(row),
      label:String(row.label || 'Финансовая операция'),
      category:String(row.category_name || ''),
      actorName:String(row.entered_by_name || ''),
      amountMinor:safeInteger(row.amount_minor), categoryId:String(row.category_id || ''),
      flow:['manual_expense','supplier_expense','recurring_expense','payroll_payment','payment_commission'].includes(row.source_kind) ? 'expense' : 'received'
    }));
    const totalVisits = Math.max(0, safeInteger(confidence.completed_visits));
    const paymentKnownVisits = Math.min(totalVisits, Math.max(0, safeInteger(confidence.payment_marked_visits)));
    const unpostedVisits = Math.min(totalVisits, Math.max(0, safeInteger(confidence.unposted_payment_visits)));
    const serviceValueUnknownVisits = confidence.service_value_known_visits == null ? 0
      : totalVisits - Math.min(totalVisits, Math.max(0, safeInteger(confidence.service_value_known_visits)));
    return {
      available:true,
      organizationId:context.organizationId,
      contextToken:context.contextToken || null,
      financeEnabled:raw.finance_enabled === true,
      resultReliable:confidence.result_reliable === true,
      timezone:String(raw.timezone || 'Europe/Samara'),
      today:businessDate(new Date(), String(raw.timezone || 'Europe/Samara')),
      periodLabel:periodTitle(bounds.start, bounds.end),
      bounds, dateBasis:'visits_and_operations',
      summary:{
        receivedMinor:safeInteger(raw.summary?.received_minor),
        expenseMinor:Math.max(0, safeInteger(raw.summary?.expense_minor)),
        serviceMinor:Math.max(0, safeInteger(raw.summary?.services_minor)),
        debtMinor:Math.max(0, safeInteger(raw.summary?.debt_minor)),
        totalVisits,
        paymentKnownVisits,
        unpostedVisits,
        serviceValueUnknownVisits
      },
      movement:(Array.isArray(raw.series) ? raw.series : []).map(row => ({
        key:String(row.bucket_start || ''),
        label:bucketLabel(row.bucket_start, grain),
        fullLabel:bucketLabel(row.bucket_start, grain, true),
        receivedMinor:safeInteger(row.received_minor),
        expenseMinor:Math.max(0, safeInteger(row.expense_minor))
      })),
      expenseCategories:(Array.isArray(raw.expense_structure) ? raw.expense_structure : []).map(row => ({
        id:String(row.category_id || row.name || ''), name:String(row.name || 'Без категории'), amountMinor:Math.max(0, safeInteger(row.amount_minor))
      })),
      rentCategoryId:String(categories.find(row => row.system_key === 'rent')?.id || ''),
      otherCategoryId:String(categories.find(row => row.system_key === 'other')?.id || 'other'),
      salaryCategoryId:String(categories.find(row => row.system_key === 'salary')?.id || 'salary'),
      operations,
      expenseDirectory:categories.filter(row => row.active === true && UUID.test(String(row.id || ''))).map(row => ({ id:String(row.id), name:String(row.name || '') })),
      paymentAccounts:accounts.filter(row => UUID.test(String(row.id || ''))).map(row => ({ id:String(row.id), name:String(row.name || '') })),
      permissions:{ canAddExpense:raw.finance_enabled === true && (readiness.has_payment_account === true || accounts.length > 0) },
      filters:{
        periods:PERIODS,
        masters:[{ value:'', label:'Все мастера' }, ...(Array.isArray(raw.performers) ? raw.performers : []).filter(row => UUID.test(String(row.id || ''))).map(row => ({ value:String(row.id), label:String(row.name || 'Сотрудник') }))],
        selectedPeriod:String(context.period || 'current_month'),
        selectedMaster:String(raw.selected_performer_id || '')
      },
      completeness:{ partial:confidence.is_complete !== true, message:completenessMessage(confidence) },
      nextCursor:raw.has_more && raw.next_cursor ? JSON.stringify(raw.next_cursor) : ''
    };
  }

  function userError(error, fallback) {
    const message = String(error?.message || '');
    const known = {
      finance_disabled:'Сначала включите единый финансовый учёт в разделе «Продажи».',
      cash_or_bank_account_required:'Сначала добавьте кассу или банковский счёт в разделе «Продажи».',
      active_finance_category_not_found:'Выбранная категория расхода больше недоступна.',
      financial_manager_role_required:'Финансы доступны только владельцу и администратору.',
      manual_expense_future_date:'Дата расхода не может быть в будущем.'
    };
    const result = new Error(known[message] || fallback);
    result.userMessage = result.message;
    result.code = error?.code;
    result.ambiguous = !error?.code || ['NETWORK_ERROR', 'TIMEOUT'].includes(error.code);
    return result;
  }

  function createController({ db, $, notify, requireWrites } = {}) {
    let organization = null;
    let center = null;
    let lastDirectory = new Map();
    let lastSelectedMaster = '';
    let generation = 0;
    let selectedScope = null;
    let effectiveScope = null;
    let rangeRequest = 0;
    let pendingLoad = null;
    let boundsInvalidated = false;
    const root = () => $('#financeCenterRoot');
    const analytics = () => root()?.closest('#analyticsView');
    const isManager = () => Boolean(organization?.id && ['owner', 'admin'].includes(organization.current_role));

    function setManagerVisibility() {
      const tab = $('#reportTabMoney');
      if (tab) tab.hidden = !isManager();
      if (root()) root().hidden = !isManager();
      if (!isManager() && $('#analyticsView')?.dataset.reportTab === 'money') $('#reportTabOverview')?.click();
    }

    async function rpc(name, params, fallback) {
      const expectedOrganization = organization?.id;
      const result = await db.rpc(name, params);
      if (expectedOrganization !== organization?.id) throw Object.assign(new Error('stale_finance_context'), { name:'AbortError' });
      if (result.error) throw userError(result.error, fallback);
      return result.data;
    }

    async function readScreen({ period = 'current_month', masterId = '', cursor = '' } = {}) {
      if (!isManager()) return { available:false, financeEnabled:false, resultReliable:false, availabilityMessage:'Финансы доступны только владельцу и администратору.' };
      const requestGeneration = generation;
      const requestScope = selectedScope;
      const requestOrganization = organization.id, requestRole = organization.current_role;
      const request = cursor ? rangeRequest : ++rangeRequest;
      if (!cursor) effectiveScope = null;
      const assertContext = () => {
        if (requestGeneration !== generation || requestScope !== selectedScope || request !== rangeRequest || !isManager()
            || requestOrganization !== organization?.id || requestRole !== organization?.current_role)
          throw Object.assign(new Error('stale_finance_context'), { name:'AbortError' });
      };
      let bounds = selectedScope?.bounds || periodBounds(period);
      let parsedCursor = null;
      try { parsedCursor = cursor ? JSON.parse(cursor) : null; } catch (_) { parsedCursor = null; }
      const readRaw = (bounds, includeCursor = true) => {
        assertContext();
        return rpc('get_minuta_finance_screen_v163', {
          p_organization:organization.id,
          p_start:bounds.start,
          p_end:bounds.end,
          p_performer:masterId || null,
          p_limit:30,
          p_before_occurred_at:includeCursor ? parsedCursor?.occurred_at || null : null,
          p_before_key:includeCursor ? parsedCursor?.event_key || null : null
        }, 'Не удалось загрузить финансовые данные.');
      };
      let metadata = null;
      if ((selectedScope?.period || period) === 'all') {
        // Booking-derived reportRange is not the beginning of financial history.
        // A safe one-day RPC confirms timezone/scope before organization-RLS reads.
        try { metadata = await readRaw({ start:bounds.end, end:bounds.end }, false); }
        catch (error) {
          assertContext();
          if (error?.name === 'AbortError') throw error;
          return { available:false, availabilityMessage:'За всё время: финансовый источник не подтвердил область и часовой пояс. Обновите данные.' };
        }
        assertContext();
        if (metadata?.schema !== 'minuta-finance-screen-v1' || metadata.ledger_version !== 163
            || metadata.organization_id !== organization.id || metadata.currency !== 'RUB'
            || metadata.period?.start !== bounds.end || metadata.period?.end !== bounds.end
            || String(metadata.selected_performer_id || '') !== masterId)
          return { available:false, availabilityMessage:'Источник не подтвердил финансовую область «За всё время». Обновите данные.' };
        try {
          if (typeof metadata.timezone !== 'string' || !metadata.timezone) throw new Error('missing_financial_timezone');
          businessDate(`${bounds.end}T12:00:00Z`, metadata.timezone);
        }
        catch (_) { return { available:false, availabilityMessage:'Источник не подтвердил часовой пояс для периода «За всё время».' }; }
        const sources = [
          { table:'financial_transactions', column:'occurred_at', label:'журнала денежных операций' },
          { table:'commercial_sales', column:'occurred_at', label:'продаж товаров и абонементов' },
          { table:'bookings', column:'booking_date', label:'истории визитов' }
        ];
        if (typeof db.from !== 'function')
          return { available:false, availabilityMessage:'Для периода «За всё время» недоступны источники ранних финансовых дат.' };
        const earliest = await Promise.allSettled(sources.map(async source => {
          let query = db.from(source.table).select(source.column).eq('organization_id', organization.id);
          if (source.column === 'booking_date') query = query.lte(source.column, bounds.end);
          const result = await query.order(source.column, { ascending:true }).limit(1);
          assertContext();
          if (result.error || !Array.isArray(result.data)) throw new Error('earliest_financial_date_unavailable');
          if (!result.data.length) return bounds.end;
          const value = result.data[0][source.column];
          const day = source.column === 'booking_date' ? value : businessDate(value, metadata.timezone);
          if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('earliest_financial_date_unavailable');
          return day > bounds.end ? bounds.end : day;
        }));
        assertContext();
        const unavailable = sources.filter((_, index) => earliest[index].status !== 'fulfilled');
        if (unavailable.length)
          return { available:false, availabilityMessage:`За всё время: источник ${unavailable.map(source => source.label).join(', ')} не подтвердил начало истории. Суммы не показаны как полные.` };
        // Earliest finance sources may extend the shared report interval, but
        // must not exclude earlier imported/legacy visits already in that scope.
        bounds = { start:[...(selectedScope ? [bounds.start] : []), ...earliest.map(result => result.value)].sort()[0], end:bounds.end };
        // v163 rejects longer requests. Never silently clip history to that cap.
        if ((new Date(`${bounds.end}T12:00:00Z`) - new Date(`${bounds.start}T12:00:00Z`)) / 86400000 > 3661)
          return { available:false, availabilityMessage:`За всё время: история ${bounds.start} — ${bounds.end} превышает ограничение финансового источника в 3661 день. Выберите более короткий период; история не обрезана.` };
      }
      let raw;
      try { raw = metadata && bounds.start === bounds.end && !cursor ? metadata : await readRaw(bounds); }
      catch (error) {
        assertContext();
        if (!metadata || error?.name === 'AbortError') throw error;
        return { available:false, availabilityMessage:`За всё время: финансовый источник не подтвердил суммы за ${bounds.start} — ${bounds.end}. Обновите данные.` };
      }
      assertContext();
      if (raw?.period?.start !== bounds.start || raw?.period?.end !== bounds.end || String(raw?.selected_performer_id || '') !== masterId)
        return { available:false, availabilityMessage:'Источник не подтвердил выбранные даты и сотрудника. Обновите данные.' };
      let normalized = normalizeFinanceScreen(raw, { organizationId:organization.id, period, bounds, contextToken:selectedScope?.contextToken });
      if (['received_minor','expense_minor','services_minor','debt_minor'].some(key => raw.summary?.[key] == null || !Number.isSafeInteger(Number(raw.summary[key]))))
        return { available:false, availabilityMessage:'Источник не подтвердил точные суммы за выбранный период.' };
      lastDirectory = new Map((normalized.expenseDirectory || []).map(item => [item.id, item.name]));
      lastSelectedMaster = masterId || '';
      if (cursor || !normalized.available) return normalized;
      const previousBounds = comparisonBounds(bounds, period);
      const expectedGeneration = requestGeneration;
      // Manager-only table reads retain the database's existing organization RLS.
      async function readPages(table, columns, configure) {
        const rows = [];
        for (let offset = 0; ; offset += 500) {
          const query = configure(db.from(table).select(columns).eq('organization_id', organization.id));
          const result = await query.range(offset, offset + 499);
          if (generation !== expectedGeneration || requestScope !== selectedScope) throw Object.assign(new Error('stale_finance_context'), { name:'AbortError' });
          if (result.error || !Array.isArray(result.data)) throw new Error('finance_projection_unavailable');
          rows.push(...result.data);
          if (result.data.length < 500) return rows;
          // Do not display a truncated aggregate as a total.
          if (rows.length >= 50000) throw new Error('finance_projection_too_large');
        }
      }
      const results = await Promise.allSettled([
        (async () => {
          if (!normalized.financeEnabled || typeof db.from !== 'function') return null;
          const from = previousBounds?.start || bounds.start;
          // Widen in UTC then filter exact dates in the organization's timezone.
          const rows = await readPages('financial_transactions', 'id,operation_type,source_type,source_id,reversal_of,occurred_at,financial_postings(side,amount_minor,financial_accounts(account_type,account_class))', query =>
            query.gte('occurred_at', `${isoDate(addDays(new Date(`${from}T12:00:00Z`), -1))}T00:00:00Z`)
              .lt('occurred_at', `${isoDate(addDays(new Date(`${bounds.end}T12:00:00Z`), 2))}T00:00:00Z`)
              .order('occurred_at', { ascending:false }).order('id', { ascending:false }));
          const reversalIds = [...new Set(rows.map(row => row.reversal_of).filter(Boolean))];
          const originals = [];
          for (let offset = 0; offset < reversalIds.length; offset += 100) originals.push(...await readPages('financial_transactions', 'id,operation_type,source_id', query => query.in('id', reversalIds.slice(offset, offset + 100)).order('id')));
          const sourceIds = [...new Set([...rows, ...originals].filter(row => row.operation_type === 'supplier_expense_payment').map(row => row.source_id))];
          const expenses = [];
          for (let offset = 0; offset < sourceIds.length; offset += 100) expenses.push(...await readPages('financial_manual_expenses_v163', 'expense_source_id,category_id,category_name_snapshot,performer_id', query => query.in('expense_source_id', sourceIds.slice(offset, offset + 100)).order('id')));
          const settlementIds = [...new Set([...rows, ...originals].filter(row => row.operation_type === 'customer_debt_settlement').map(row => row.source_id))];
          const settlements = [];
          for (let offset = 0; offset < settlementIds.length; offset += 100) settlements.push(...await readPages('financial_debt_settlement_sources', 'id,visit_transaction_id,gross_minor,commission_minor', query => query.in('id', settlementIds.slice(offset, offset + 100)).order('id')));
          if (masterId) {
            async function lookup(table, columns, ids) {
              const found = [];
              ids = [...new Set(ids.filter(Boolean))];
              for (let offset = 0; offset < ids.length; offset += 100) found.push(...await readPages(table, columns, query => query.in('id', ids.slice(offset, offset + 100)).order('id')));
              return new Map(found.map(row => [row.id, row]));
            }
            const bases = [...rows.filter(row => row.operation_type !== 'reversal'), ...originals];
            const debtSources = new Map(settlements.map(row => [row.id, row]));
            const debtVisits = await lookup('financial_transactions', 'id,source_id', [...debtSources.values()].map(row => row.visit_transaction_id));
            const bookings = await lookup('bookings', 'id,performer_id', [...bases.filter(row => row.operation_type === 'visit_service').map(row => row.source_id), ...[...debtVisits.values()].map(row => row.source_id)]);
            const refunds = await lookup('commercial_sale_refunds', 'id,sale_id', bases.filter(row => row.operation_type === 'commercial_refund').map(row => row.source_id));
            const sales = await lookup('commercial_sales', 'id,seller_id', [...bases.filter(row => row.operation_type === 'commercial_sale').map(row => row.source_id), ...[...refunds.values()].map(row => row.sale_id)]);
            const payroll = await lookup('financial_payroll_payment_sources', 'id,performer_id', bases.filter(row => row.operation_type === 'payroll_payment').map(row => row.source_id));
            const manual = new Map(expenses.map(row => [row.expense_source_id, row]));
            for (const base of bases) {
              let participant;
              if (base.operation_type === 'visit_service') participant = bookings.get(base.source_id);
              if (base.operation_type === 'customer_debt_settlement') participant = bookings.get(debtVisits.get(debtSources.get(base.source_id)?.visit_transaction_id)?.source_id);
              if (base.operation_type === 'commercial_sale') participant = sales.get(base.source_id);
              if (base.operation_type === 'commercial_refund') participant = sales.get(refunds.get(base.source_id)?.sale_id);
              if (base.operation_type === 'payroll_payment') participant = payroll.get(base.source_id);
              // Shared supplier costs are outside an employee's scope, matching v163.
              if (base.operation_type === 'supplier_expense_payment') participant = manual.get(base.source_id) || { performer_id:null };
              base.scopeResolved = Boolean(participant);
              base.performerId = participant?.performer_id || participant?.seller_id || '';
            }
          }
          const context = { bounds, timezone:normalized.timezone, originals, expenses, debtSources:settlements, masterId,
            otherCategoryId:normalized.otherCategoryId, salaryCategoryId:normalized.salaryCategoryId };
          return { current:projectCashLedger(rows, context), previous:previousBounds ? projectCashLedger(rows, { ...context, bounds:previousBounds }) : null };
        })(),
        (async () => {
          if (typeof db.from !== 'function') return { known:false, rows:[] };
          const sales = await readPages('commercial_sales', 'id,seller_id,occurred_at,commercial_sale_lines(item_kind,item_name,quantity,total_minor)', query =>
            query.gte('occurred_at', `${isoDate(addDays(new Date(`${bounds.start}T12:00:00Z`), -1))}T00:00:00Z`)
              .lt('occurred_at', `${isoDate(addDays(new Date(`${bounds.end}T12:00:00Z`), 2))}T00:00:00Z`)
              .order('occurred_at', { ascending:false }).order('id', { ascending:false }));
          return projectGoodsSales(sales, { bounds, timezone:normalized.timezone, masterId });
        })()
      ]);
      if (generation !== expectedGeneration || requestScope !== selectedScope) throw Object.assign(new Error('stale_finance_context'), { name:'AbortError' });
      const cash = results[0].status === 'fulfilled' ? results[0].value : null;
      normalized.goods = results[1].status === 'fulfilled' ? results[1].value : { known:false, rows:[] };
      normalized.cashProjectionUnavailable = normalized.financeEnabled && !cash;
      if (cash?.current.classified) {
        normalized.dateBasis = 'operations';
        normalized.summary.receivedMinor = cash.current.receivedMinor;
        normalized.summary.expenseMinor = cash.current.expenseMinor;
        normalized.movement = cash.current.movement;
        normalized.expenseCategories = cash.current.categories;
        normalized.operations = cash.current.operations;
        normalized.nextCursor = '';
        normalized.comparison = null;
        // Both periods use the same complete ledger read. Visit-mark coverage
        // belongs to another date basis and cannot disable a cash comparison.
        if (cash.previous?.classified)
          normalized.comparison = { bounds:previousBounds, receivedMinor:cash.previous.receivedMinor, expenseMinor:cash.previous.expenseMinor };
      } else if (cash) normalized.cashProjectionUnavailable = true;
      if (generation !== expectedGeneration || requestScope !== selectedScope) throw Object.assign(new Error('stale_finance_context'), { name:'AbortError' });
      assertContext();
      if (normalized.available && selectedScope?.period === 'all')
        effectiveScope = { generation, request, scope:selectedScope, organizationId:organization.id, role:organization.current_role, bounds:{ ...bounds } };
      normalized = global.MinutaFinanceCenter.mergeVisitSnapshot?.(normalized,
        global.MinutaStatisticsAuditProvider?.visitSnapshot?.({ bounds, organizationId:organization.id, masterId, contextToken:selectedScope?.contextToken })) || normalized;
      return normalized;
    }

    const adapter = {
      readDashboard:readScreen,
      openVisitJournal:options => global.MinutaStatisticsAuditProvider?.openVisitJournal?.(options) === true,
      async readOperations({ period, masterId, cursor }) {
        const result = await readScreen({ period, masterId, cursor });
        return { operations:result.operations || [], nextCursor:result.nextCursor || '' };
      },
      async prepareExpense({ period, masterId }) {
        if (!requireWrites?.()) throw userError({ message:'writes_disabled', code:'WRITE_DISABLED' }, 'Изменения сейчас недоступны.');
        await rpc('initialize_minuta_finance_screen_v163', { p_organization:organization.id }, 'Не удалось подготовить справочник расходов.');
        return { dashboard:await readScreen({ period, masterId }) };
      },
      async createExpense(payload) {
        if (!requireWrites?.()) throw userError({ message:'writes_disabled', code:'WRITE_DISABLED' }, 'Изменения сейчас недоступны.');
        const categoryName = lastDirectory.get(payload.categoryId) || 'Расход';
        const note = String(payload.note || '').trim();
        const title = (note ? `${categoryName}: ${note}` : categoryName).slice(0, 160);
        return rpc('record_minuta_manual_expense_v163', {
          p_organization:organization.id,
          p_category:payload.categoryId,
          p_source_label:categoryName.slice(0, 160),
          p_title:title,
          p_amount_minor:payload.amountMinor,
          p_payment_account:payload.paymentAccountId,
          p_occurred_on:payload.occurredOn,
          p_performer:lastSelectedMaster || null,
          p_request_id:payload.requestId
        }, 'Не удалось добавить расход.');
      }
    };

    function reset() {
      generation += 1;
      if (center) global.MinutaFinanceCenter?.destroy(center);
      center = null;
      analytics()?.classList.remove('finance-center-mounted');
      lastDirectory = new Map();
      lastSelectedMaster = '';
      selectedScope = null;
      effectiveScope = null;
      rangeRequest += 1;
      pendingLoad = null;
      boundsInvalidated = false;
    }

    function setOrganization(next) {
      if (organization?.id !== next?.id || organization?.current_role !== next?.current_role) reset();
      organization = next || null;
      setManagerVisibility();
    }

    async function load(range, { force = false, masterId, contextToken } = {}) {
      setManagerVisibility();
      if (!isManager() || !root() || !global.MinutaFinanceCenter) return;
      let changed = false;
      if (range?.start && range?.end) {
        // Native Money callers also pass the common report range. An omitted
        // performer preserves the explicit scope supplied by the overview.
        const nextMaster = masterId === undefined ? selectedScope?.masterId || '' : masterId === 'all' ? '' : masterId || '';
        const nextScope = { bounds:{ start:range.start, end:range.end }, period:range.period || 'custom', masterId:nextMaster,
          contextToken:contextToken === undefined ? selectedScope?.contextToken || null : contextToken };
        // The UI does not reload an identical scope; keep its pending read valid.
        const resolvedAlias = effectiveScope?.scope === selectedScope && effectiveScope.request === rangeRequest
          && nextScope.period === 'all' && selectedScope?.period === 'all'
          && nextScope.contextToken === selectedScope.contextToken
          && nextScope.masterId === selectedScope.masterId && nextScope.bounds.end === selectedScope.bounds.end
          && nextScope.bounds.start === effectiveScope.bounds.start;
        if (!resolvedAlias && JSON.stringify(nextScope) !== JSON.stringify(selectedScope)) {
          selectedScope = nextScope; effectiveScope = null; changed = true;
        }
      }
      const track = task => {
        const pending = Promise.resolve(task).then(value => { if (pendingLoad === pending) pendingLoad = null; return value; },
          error => { if (pendingLoad === pending) pendingLoad = null; throw error; });
        pendingLoad = pending; return pending;
      };
      if (center) {
        if (changed) { boundsInvalidated = false; return track(center.setScope?.(selectedScope)); }
        if (pendingLoad && !boundsInvalidated) return pendingLoad;
        if (force || boundsInvalidated) { boundsInvalidated = false; return track(center.reload()); }
        return center.ready;
      }
      const currentGeneration = generation;
      boundsInvalidated = false;
      center = global.MinutaFinanceCenter.init({ root:root(), adapter, periods:PERIODS, initialScope:selectedScope, onNotice:message => notify?.(message) });
      analytics()?.classList.add('finance-center-mounted');
      await track(center.ready);
      if (currentGeneration !== generation) return;
    }

    function financialBounds({ period, end, organizationId, performerId, contextToken } = {}) {
      const master = performerId === 'all' ? '' : performerId || '';
      if (!isManager() || pendingLoad || period !== 'all' || organizationId !== organization.id
          || !effectiveScope || effectiveScope.generation !== generation || effectiveScope.request !== rangeRequest
          || effectiveScope.organizationId !== organization.id
          || effectiveScope.scope !== selectedScope || effectiveScope.role !== organization.current_role
          || (contextToken || null) !== selectedScope?.contextToken
          || selectedScope?.period !== 'all' || selectedScope.masterId !== master || effectiveScope.bounds.end !== end) return null;
      return { ...effectiveScope.bounds };
    }
    function invalidateBounds() {
      effectiveScope = null; rangeRequest += 1; boundsInvalidated = true;
    }
    function refreshVisits() {
      if (!isManager() || !selectedScope || !center) return;
      const bounds = effectiveScope?.bounds || selectedScope.bounds;
      center.refreshVisits?.(global.MinutaStatisticsAuditProvider?.visitSnapshot?.({
        bounds, organizationId:organization.id, masterId:selectedScope.masterId, contextToken:selectedScope.contextToken
      }));
    }
    return { load, setOrganization, reset, financialBounds, invalidateBounds, refreshVisits };
  }

  global.MinutaFinanceProvider = Object.freeze({ PERIODS, periodBounds, comparisonBounds, projectCashLedger, projectGoodsSales, normalizeFinanceScreen, createController });
})(globalThis);
