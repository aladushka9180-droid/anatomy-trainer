(() => {
  'use strict';

  const CATEGORY_VERSION = 1;
  const EXPENSE_CATEGORIES_V1 = Object.freeze([
    ['materials', 'Материалы'], ['rent', 'Аренда'], ['salary', 'Зарплата'],
    ['advertising', 'Реклама'], ['taxes', 'Налоги'], ['equipment', 'Оборудование'], ['other', 'Другое']
  ]);
  const CATEGORY_LABELS = Object.freeze(Object.fromEntries(EXPENSE_CATEGORIES_V1));
  const RPC = Object.freeze({ read:'get_minuta_finance_expenses_v163', add:'record_minuta_expense_v163', reverse:'reverse_minuta_expense_v163' });

  const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const moneyRub = value => {
    const amount = number(value);
    return `${new Intl.NumberFormat('ru-RU', { minimumFractionDigits:Number.isInteger(amount) ? 0 : 2, maximumFractionDigits:2 }).format(amount)} ₽`;
  };
  const moneyMinor = value => moneyRub(number(value) / 100);
  const localDate = value => {
    const date = new Date(`${String(value || '').slice(0, 10)}T12:00:00`);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('ru-RU', { day:'numeric', month:'short' }).replace(/\.$/, '');
  };
  const uuid = () => crypto.randomUUID();

  function createController(options) {
    const { db, $, escapeHtml, notify, requireWrites, applyWriteAvailability } = options;
    let organization = null;
    let snapshot = { range:null, receivedRub:0, serviceValueRub:0, debtRub:0, completedCount:0, knownPaymentCount:0, daily:[], operations:[], source:'own' };
    let ledger = { available:false, expense_minor:0, daily_expenses:[], expense_structure:[], operations:[], accounts:[], timezone:'' };
    let loading = false;
    let writing = false;
    let bound = false;
    let lastKey = '';

    function manager() { return ['owner', 'admin'].includes(organization?.current_role); }
    function setText(selector, value) { const node = $(selector); if (node) node.textContent = String(value); }
    function setError(message = '') { const node = $('#financeExpenseError'); if (!node) return; node.textContent = message; node.hidden = !message; }
    function setBusy(value) {
      writing = value;
      $('#financeExpenseDialog')?.querySelectorAll('button,input,select').forEach(control => { control.disabled = value; });
      if (!value) applyWriteAvailability?.();
    }
    function categoryLabel(key) { return CATEGORY_LABELS[key] || 'Другое'; }
    function sameScope(data) { return String(data?.organization_id || '') === String(organization?.id || ''); }

    function renderCategories() {
      const select = $('#financeExpenseCategory');
      if (select && !select.options.length) select.innerHTML = EXPENSE_CATEGORIES_V1.map(([key, label]) => `<option value="${key}">${label}</option>`).join('');
      const account = $('#financeExpenseAccount');
      if (account) account.innerHTML = ledger.accounts.length
        ? `<option value="">Выберите счёт</option>${ledger.accounts.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name || (item.account_type === 'cash' ? 'Касса' : 'Банк'))}</option>`).join('')}`
        : '<option value="">Сначала добавьте кассу или счёт в Организации</option>';
    }

    function renderExpenseStructure() {
      const holder = $('#financeExpenseStructure');
      if (!holder) return;
      const rows = Array.isArray(ledger.expense_structure) ? ledger.expense_structure.filter(item => number(item.amount_minor) > 0) : [];
      const total = rows.reduce((sum, item) => sum + number(item.amount_minor), 0);
      holder.innerHTML = rows.length ? rows.map(item => {
        const share = total ? Math.max(2, Math.round(number(item.amount_minor) / total * 100)) : 0;
        return `<div class="finance-expense-row"><span>${escapeHtml(categoryLabel(item.category_key))}</span><strong>${escapeHtml(moneyMinor(item.amount_minor))}</strong><i style="--finance-share:${share}%" aria-hidden="true"></i></div>`;
      }).join('') : '<p class="report-empty-inline">Расходов за период нет.</p>';
    }

    function chartRows() {
      const rows = new Map();
      (snapshot.daily || []).forEach(item => {
        const key = String(item.date || '').slice(0, 10);
        if (key) rows.set(key, { date:key, receivedRub:number(item.receivedRub), expenseRub:0 });
      });
      (ledger.daily_expenses || []).forEach(item => {
        const key = String(item.date || '').slice(0, 10);
        if (!key) return;
        const row = rows.get(key) || { date:key, receivedRub:0, expenseRub:0 };
        row.expenseRub += number(item.amount_minor) / 100;
        rows.set(key, row);
      });
      return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date)).map(item => ({ ...item, netRub:item.receivedRub - item.expenseRub }));
    }

    function renderChart() {
      const holder = $('#financeFlowChart');
      if (!holder) return;
      const rows = chartRows();
      const total = rows.reduce((sum, item) => sum + item.netRub, 0);
      setText('#financeFlowTotal', ledger.available ? moneyRub(total) : 'Расходы не сверены');
      if (!rows.length) {
        holder.innerHTML = '<div class="finance-flow-empty">Поток появится после отмеченной оплаты или расхода.</div>';
        holder.setAttribute('aria-label', 'За выбранный период денежных операций нет');
        return;
      }
      const maximum = Math.max(1, ...rows.map(item => Math.abs(item.netRub)));
      holder.innerHTML = rows.map(item => {
        const height = Math.max(item.netRub ? 4 : 2, Math.round(Math.abs(item.netRub) / maximum * 62));
        const amount = item.netRub > 0 ? `+${moneyRub(item.netRub)}` : moneyRub(item.netRub);
        return `<div class="finance-flow-column" title="${escapeHtml(localDate(item.date))}: ${escapeHtml(amount)}"><b>${escapeHtml(amount)}</b><span aria-hidden="true"><i class="${item.netRub < 0 ? 'is-negative' : ''}" style="height:${height}px"></i></span><small>${escapeHtml(localDate(item.date))}</small></div>`;
      }).join('');
      holder.setAttribute('aria-label', `Денежный поток: ${moneyRub(total)}. ${rows.length} дней с операциями.`);
    }

    function renderOperations() {
      const holder = $('#financeOperationList');
      if (!holder) return;
      const expenses = (ledger.operations || []).map(item => ({
        id:item.expense_id || '', date:item.occurred_on || String(item.occurred_at || '').slice(0, 10),
        description:item.description || categoryLabel(item.category_key), category:categoryLabel(item.category_key),
        amountRub:number(item.amount_minor) / (item.reversed ? 100 : -100), type:item.reversed ? 'Отмена расхода' : 'Расход', reversible:!item.reversed && Boolean(item.expense_id)
      }));
      const rows = [...(snapshot.operations || []), ...expenses]
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || number(b.order) - number(a.order)).slice(0, 12);
      holder.innerHTML = rows.length ? rows.map(item => {
        const negative = number(item.amountRub) < 0;
        const amount = `${negative ? '−' : '+'}${moneyRub(Math.abs(number(item.amountRub)))}`;
        const reverse = item.reversible && manager() ? `<button type="button" data-finance-reverse="${escapeHtml(item.id)}" data-finance-manager>Исправить</button>` : '';
        return `<article class="finance-operation-row"><div class="finance-operation-copy"><strong>${escapeHtml(item.description || 'Операция')}</strong><small>${escapeHtml(localDate(item.date))} · ${escapeHtml(item.category || 'Деньги')}</small></div><span class="finance-operation-amount ${negative ? 'is-negative' : ''}">${escapeHtml(amount)}</span><span class="finance-operation-type">${escapeHtml(item.type || (negative ? 'Расход' : 'Получено'))}</span>${reverse}</article>`;
      }).join('') : '<p class="report-empty-inline">Операций за период нет.</p>';
    }

    function render() {
      const expenseRub = number(ledger.expense_minor) / 100;
      const net = number(snapshot.receivedRub) - expenseRub;
      const hero = $('.finance-hero');
      hero?.classList.toggle('is-negative', ledger.available && net < 0);
      hero?.classList.toggle('is-unavailable', !ledger.available);
      setText('#financeNet', ledger.available ? moneyRub(net) : '—');
      setText('#financeExpenses', ledger.available ? moneyRub(expenseRub) : '—');
      setText('#reportRevenue', moneyRub(snapshot.receivedRub));
      setText('#reportCompletedValue', moneyRub(snapshot.serviceValueRub));
      setText('#reportDebt', moneyRub(snapshot.debtRub));
      setText('#reportUnpaid', number(snapshot.debtRub) > 0 ? 'По завершённым визитам' : 'Нет подтверждённого долга');
      setText('#financePeriodLabel', snapshot.range ? `${localDate(snapshot.range.start)} — ${localDate(snapshot.range.end)}` : 'За выбранный период');
      setText('#financeCoverageText', `Оплата отмечена у ${number(snapshot.knownPaymentCount)} из ${number(snapshot.completedCount)} визитов`);
      const unknownCount = Math.max(0, number(snapshot.completedCount) - number(snapshot.knownPaymentCount));
      setText('#reportPaymentUnknown', unknownCount ? `${unknownCount} без отметки` : 'Все оплаты отмечены');
      $('#financeAddExpense')?.toggleAttribute('hidden', !manager() || snapshot.source === 'demo');
      renderCategories(); renderExpenseStructure(); renderChart(); renderOperations();
    }

    async function load(range = snapshot.range, { force = false } = {}) {
      if (!organization?.id || !range?.start || !range?.end || loading || snapshot.source === 'demo') return;
      const key = `${organization.id}:${range.start}:${range.end}`;
      if (!force && key === lastKey) return;
      if (!manager()) { ledger = { ...ledger, available:false }; render(); return; }
      loading = true;
      $('#financeLoading').hidden = false;
      $('#financeUnavailable').hidden = true;
      try {
        const result = await db.rpc(RPC.read, { p_organization:organization.id, p_start:range.start, p_end:range.end });
        if (result.error) throw result.error;
        if (!sameScope(result.data)) return;
        ledger = { ...result.data, available:true, accounts:Array.isArray(result.data.accounts) ? result.data.accounts : [], operations:Array.isArray(result.data.operations) ? result.data.operations : [], daily_expenses:Array.isArray(result.data.daily_expenses) ? result.data.daily_expenses : [], expense_structure:Array.isArray(result.data.expense_structure) ? result.data.expense_structure : [] };
        lastKey = key;
      } catch {
        ledger = { ...ledger, available:false };
        $('#financeUnavailable').hidden = false;
      } finally {
        loading = false;
        $('#financeLoading').hidden = true;
        render();
      }
    }

    function openExpense() {
      if (!manager() || !requireWrites()) return;
      renderCategories();
      setError('');
      const date = $('#financeExpenseDate');
      if (date && !date.value) date.value = snapshot.range?.end || new Date().toISOString().slice(0, 10);
      const dialog = $('#financeExpenseDialog');
      if (typeof dialog?.showModal === 'function') dialog.showModal(); else dialog?.setAttribute('open', '');
      $('#financeExpenseCategory')?.focus();
    }
    function closeExpense() { const dialog = $('#financeExpenseDialog'); if (dialog?.open && typeof dialog.close === 'function') dialog.close(); else dialog?.removeAttribute('open'); }

    function intent(scope, payload) {
      const key = `minuta-finance-v163:${organization?.id || ''}:${scope}`;
      const fingerprint = JSON.stringify(payload);
      try {
        const saved = JSON.parse(localStorage.getItem(key) || 'null');
        if (saved?.fingerprint === fingerprint && saved.requestId) return { key, requestId:saved.requestId };
        const requestId = uuid(); localStorage.setItem(key, JSON.stringify({ fingerprint, requestId, createdAt:new Date().toISOString() })); return { key, requestId };
      } catch { return { key, requestId:uuid() }; }
    }
    function clearIntent(key) { try { localStorage.removeItem(key); } catch {} }

    async function submitExpense(event) {
      event.preventDefault();
      if (writing || !manager() || !requireWrites()) return;
      const category = $('#financeExpenseCategory')?.value || '';
      const description = $('#financeExpenseDescription')?.value.trim() || '';
      const rawAmount = String($('#financeExpenseAmount')?.value || '').replace(',', '.');
      const amountMinor = Math.round(Number(rawAmount) * 100);
      const occurredOn = $('#financeExpenseDate')?.value || '';
      const account = $('#financeExpenseAccount')?.value || '';
      if (!CATEGORY_LABELS[category] || description.length < 2 || !Number.isSafeInteger(amountMinor) || amountMinor <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(occurredOn) || !account) {
        setError(ledger.accounts.length ? 'Заполните категорию, описание, сумму, дату и счёт.' : 'Сначала добавьте кассу или банковский счёт в разделе «Организация».'); return;
      }
      const payload = { p_organization:organization.id, p_category_key:category, p_category_version:CATEGORY_VERSION, p_description:description, p_amount_minor:amountMinor, p_occurred_on:occurredOn, p_payment_account:account };
      const request = intent('add', payload);
      setBusy(true); setError('');
      try {
        const result = await db.rpc(RPC.add, { ...payload, p_request_id:request.requestId });
        if (result.error) throw result.error;
        if (!sameScope(result.data) || !result.data?.expense_id) throw new Error('invalid_finance_ack');
        clearIntent(request.key); closeExpense(); $('#financeExpenseForm')?.reset(); notify('Расход добавлен в журнал'); lastKey = ''; await load(snapshot.range, { force:true });
      } catch { setError('Не удалось подтвердить запись. Повторите отправку: новый дубль не появится.'); }
      finally { setBusy(false); }
    }

    async function reverseExpense(expenseId, button) {
      if (writing || !manager() || !requireWrites() || !expenseId) return;
      if (!window.confirm('Добавить обратную запись для этого расхода? Исходная операция останется в журнале.')) return;
      const payload = { p_organization:organization.id, p_expense:expenseId, p_reason:'operator_correction' };
      const request = intent(`reverse:${expenseId}`, payload);
      setBusy(true);
      try {
        const result = await db.rpc(RPC.reverse, { ...payload, p_request_id:request.requestId });
        if (result.error) throw result.error;
        if (!sameScope(result.data) || String(result.data?.expense_id || '') !== String(expenseId)) throw new Error('invalid_finance_ack');
        clearIntent(request.key); notify('Обратная запись добавлена'); lastKey = ''; await load(snapshot.range, { force:true });
      } catch { notify('Не удалось подтвердить исправление. Повторите — дубль не создастся.'); }
      finally { setBusy(false); if (button) button.disabled = false; }
    }

    function bind() {
      if (bound) return; bound = true;
      $('#financeAddExpense')?.addEventListener('click', openExpense);
      $('#financeRetry')?.addEventListener('click', () => void load(snapshot.range, { force:true }));
      $('#financeExpenseForm')?.addEventListener('submit', event => void submitExpense(event));
      document.addEventListener('click', event => {
        if (event.target.closest('[data-close-finance-expense]')) closeExpense();
        const reverse = event.target.closest('[data-finance-reverse]');
        if (reverse) void reverseExpense(reverse.dataset.financeReverse, reverse);
      });
      render();
    }

    return {
      bind, load,
      updateSnapshot(next) { snapshot = { ...snapshot, ...next }; render(); },
      setOrganization(next) { organization = next || null; lastKey = ''; ledger = { available:false, expense_minor:0, daily_expenses:[], expense_structure:[], operations:[], accounts:[], timezone:'' }; render(); },
      reset() { organization = null; lastKey = ''; ledger = { available:false, expense_minor:0, daily_expenses:[], expense_structure:[], operations:[], accounts:[], timezone:'' }; closeExpense(); render(); }
    };
  }

  window.MinutaFinanceCenter = Object.freeze({ createController, EXPENSE_CATEGORIES_V1, CATEGORY_VERSION });
})();
