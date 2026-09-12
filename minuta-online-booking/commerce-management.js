(() => {
  'use strict';

  const rubles = minor => `${new Intl.NumberFormat('ru-RU').format((Number(minor) || 0) / 100)} ₽`;
  const number = value => Number(String(value ?? '').replace(',', '.')) || 0;
  const minor = value => Math.round(number(value) * 100);
  const uuid = () => crypto.randomUUID();
  const dateText = value => value ? new Date(value).toLocaleDateString('ru-RU', { day:'numeric', month:'short', year:'numeric' }) : '—';
  const operationNames = {
    visit_service:'Визит', commercial_sale:'Продажа', commercial_refund:'Возврат',
    supplier_expense_accrual:'Расход', supplier_expense_payment:'Оплата расхода',
    customer_debt_settlement:'Погашение долга', payroll_accrual:'Начисление зарплаты',
    payroll_payment:'Выплата зарплаты', payroll_advance:'Аванс', payroll_advance_offset:'Зачёт аванса', reversal:'Сторно'
  };

  function requestIntent(scope, payload) {
    const key = `minuta-commerce-intent:${scope}`;
    const fingerprint = JSON.stringify(payload);
    try {
      const saved = JSON.parse(localStorage.getItem(key) || 'null');
      if (saved?.fingerprint === fingerprint && saved?.requestId) return { key, requestId:saved.requestId };
      const requestId = uuid();
      localStorage.setItem(key, JSON.stringify({ fingerprint, requestId, createdAt:new Date().toISOString() }));
      return { key, requestId };
    } catch {
      return { key, requestId:uuid() };
    }
  }

  function clearIntent(key) {
    try { localStorage.removeItem(key); } catch {}
  }

  function errorMessage(error) {
    const source = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
    if (source.includes('finance_disabled')) return 'Сначала включите единый финансовый учёт.';
    if (source.includes('benefits_disabled')) return 'Сначала включите абонементы и сертификаты.';
    if (source.includes('inventory_disabled')) return 'Сначала включите складской учёт.';
    if (source.includes('insufficient') || source.includes('negative')) return 'На выбранном складе недостаточно товара.';
    if (source.includes('used_benefit')) return 'Использованный или зарезервированный продукт вернуть нельзя.';
    if (source.includes('exceeds_remaining')) return 'Количество или сумма превышает доступный остаток возврата.';
    if (source.includes('cash_account_required')) return 'Для наличной оплаты выберите кассу.';
    if (source.includes('permission') || source.includes('42501')) return 'Недостаточно прав для финансовой операции.';
    return 'Операция не выполнена. Данные не изменены; можно безопасно повторить.';
  }

  function setError(element, error) {
    if (!element) return;
    element.textContent = typeof error === 'string' ? error : errorMessage(error);
    element.hidden = !element.textContent;
  }

  function createController(options) {
    const { db, $, escapeHtml, notify, requireWrites, getCurrentUser, getSessionGeneration, sessionIsCurrent, applyWriteAvailability } = options;
    let organization = null;
    let state = null;
    let loading = false;
    let bound = false;

    const accountOptions = (selected = '') => (state?.accounts || [])
      .filter(item => item.system_key === null && ['cash', 'bank'].includes(item.account_type))
      .map(item => `<option value="${escapeHtml(item.id)}"${item.id === selected ? ' selected' : ''}>${escapeHtml(item.name)}</option>`).join('');

    function selectOptions(items, label, selected = '') {
      return items.map(item => `<option value="${escapeHtml(item.id)}"${item.id === selected ? ' selected' : ''}>${escapeHtml(label(item))}</option>`).join('');
    }

    function currentItems() {
      return $('#commerceItemKind')?.value === 'benefit_product' ? state?.benefit_products || [] : state?.inventory_items || [];
    }

    function renderItemControls() {
      const benefits = $('#commerceItemKind')?.value === 'benefit_product';
      const items = currentItems();
      const itemSelect = $('#commerceItem');
      if ($('#commerceInventoryFields')) $('#commerceInventoryFields').hidden = benefits;
      if ($('#commerceClient')) $('#commerceClient').required = benefits;
      if ($('#commerceQuantity')) {
        $('#commerceQuantity').disabled = benefits;
        if (benefits) $('#commerceQuantity').value = '1';
      }
      if (itemSelect) itemSelect.innerHTML = items.length
        ? selectOptions(items, item => item.kind ? `${item.name} · ${item.kind === 'certificate' ? 'сертификат' : item.kind === 'package' ? 'пакет' : 'абонемент'}` : `${item.name}${item.sku ? ` · ${item.sku}` : ''}`)
        : '<option value="">Сначала создайте позицию</option>';
      const selected = items.find(item => item.id === itemSelect?.value) || items[0];
      if (benefits && selected && $('#commerceUnitPrice')) $('#commerceUnitPrice').value = String((Number(selected.sale_price_minor) || 0) / 100);
    }

    function renderBookings() {
      const select = $('#commerceBooking');
      if (!select) return;
      const clientId = $('#commerceClient')?.value || '';
      const rows = (state?.bookings || []).filter(item => !clientId || item.client_account_id === clientId);
      select.innerHTML = '<option value="">Отдельная продажа</option>' + selectOptions(rows, item => `${dateText(item.booking_date)} ${String(item.booking_time || '').slice(0, 5)} · ${item.client_name} · ${item.service_name}`);
    }

    function renderSales() {
      const sales = state?.sales || [];
      const gross = sales.reduce((sum, item) => sum + Number(item.total_minor || 0), 0);
      const refunded = sales.reduce((sum, item) => sum + Number(item.refunded_minor || 0), 0);
      $('#commerceSalesCount').textContent = String(sales.length);
      $('#commerceGross').textContent = rubles(gross);
      $('#commerceRefunded').textContent = rubles(refunded);
      $('#commerceNet').textContent = rubles(gross - refunded);
      $('#commerceSalesList').innerHTML = sales.length ? sales.map(sale => {
        const remainingAmount = Number(sale.total_minor || 0) - Number(sale.refunded_minor || 0);
        const remainingQuantity = number(sale.line?.quantity) - number(sale.line?.refunded_quantity);
        const status = sale.status === 'refunded' ? 'Возвращено' : sale.status === 'partially_refunded' ? 'Частичный возврат' : 'Оплачено';
        return `<article class="commerce-sale-row"><div><small>${escapeHtml(dateText(sale.occurred_at))} · ${escapeHtml(status)}</small><strong>${escapeHtml(sale.line?.item_name || 'Продажа')}</strong><span>${sale.client_name ? `${escapeHtml(sale.client_name)} · ` : ''}${escapeHtml(String(sale.line?.quantity || 1))} × ${escapeHtml(rubles(sale.line?.unit_price_minor))}${sale.booking_id ? ' · внутри визита' : ' · отдельно'}</span></div><div><strong>${escapeHtml(rubles(Number(sale.total_minor || 0) - Number(sale.refunded_minor || 0)))}</strong>${remainingAmount > 0 && remainingQuantity > 0 ? `<button class="secondary-button compact-button" type="button" data-commerce-refund="${escapeHtml(sale.id)}">Возврат</button>` : ''}</div></article>`;
      }).join('') : '<p class="report-empty-inline">Продаж пока нет.</p>';
    }

    function refundableSales() {
      return (state?.sales || []).filter(sale => (
        Number(sale.total_minor || 0) - Number(sale.refunded_minor || 0) > 0
        && number(sale.line?.quantity) - number(sale.line?.refunded_quantity) > 0
      ));
    }

    function selectedRefundSale() {
      const saleId = $('#commerceRefundSale')?.value || '';
      return refundableSales().find(sale => sale.id === saleId) || null;
    }

    function updateRefundValidity() {
      const submit = $('#commerceRefundSubmit');
      if (!submit) return false;
      const sale = selectedRefundSale();
      const quantity = number($('#commerceRefundQuantity')?.value);
      const amount = minor($('#commerceRefundAmount')?.value);
      const reason = $('#commerceRefundReason')?.value.trim() || '';
      const remainingQuantity = sale ? number(sale.line?.quantity) - number(sale.line?.refunded_quantity) : 0;
      const remainingAmount = sale ? Number(sale.total_minor || 0) - Number(sale.refunded_minor || 0) : 0;
      const valid = Boolean(sale && quantity > 0 && quantity <= remainingQuantity && amount > 0 && amount <= remainingAmount && reason.length >= 3);
      submit.disabled = !valid;
      return valid;
    }

    function renderRefundControls() {
      const sales = state?.sales || [];
      const candidates = refundableSales();
      const creator = $('#commerceRefundCreator');
      const empty = $('#commerceRefundEmpty');
      const select = $('#commerceRefundSale');
      if (!creator || !empty || !select) return;
      const selected = candidates.some(sale => sale.id === select.value) ? select.value : '';
      select.innerHTML = '<option value="">Выберите продажу</option>' + selectOptions(candidates, sale => {
        const remainingAmount = Number(sale.total_minor || 0) - Number(sale.refunded_minor || 0);
        return `${dateText(sale.occurred_at)} · ${sale.line?.item_name || 'Продажа'}${sale.client_name ? ` · ${sale.client_name}` : ''} · осталось ${rubles(remainingAmount)}`;
      }, selected);
      creator.hidden = candidates.length === 0;
      if (!candidates.length) creator.open = false;
      empty.hidden = candidates.length > 0;
      empty.textContent = sales.length ? 'Все продажи полностью возвращены.' : 'Возврат станет доступен после первой продажи.';
      updateRefundValidity();
    }

    function renderRecurring() {
      const rows = state?.recurring_expenses || [];
      $('#commerceRecurringList').innerHTML = rows.length ? rows.map(item => {
        const now = new Date();
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const recorded = String(item.last_occurred_on || '').startsWith(currentMonth);
        return `<article class="commerce-recurring-row"><div><small>Ежемесячно, ${escapeHtml(String(item.day_of_month))}-го числа</small><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.supplier_name)} · ${escapeHtml(rubles(item.amount_minor))}</span></div><button class="secondary-button compact-button" type="button" data-commerce-record-expense="${escapeHtml(item.id)}"${recorded ? ' disabled' : ''}>${recorded ? 'Учтено' : 'Учесть сейчас'}</button></article>`;
      }).join('') : '<p class="report-empty-inline">Добавьте аренду или другой регулярный платёж.</p>';
    }

    function render() {
      if (!state) return;
      $('#commerceWorkspace').hidden = false;
      $('#commerceUnavailable').hidden = true;
      $('#commerceFinanceEnabled').checked = state.finance_enabled === true;
      $('#commerceClient').innerHTML = '<option value="">Без клиента</option>' + selectOptions(state.clients || [], item => `${item.name}${item.phone ? ` · ${item.phone}` : ''}`);
      $('#commerceWarehouse').innerHTML = selectOptions(state.warehouses || [], item => item.name);
      $('#commercePaymentAccount').innerHTML = accountOptions();
      $('#commerceRecurringAccount').innerHTML = accountOptions();
      renderItemControls();
      renderBookings();
      renderSales();
      renderRefundControls();
      renderRecurring();
      applyWriteAvailability?.($('#commercePanel'));
    }

    async function load() {
      if (!organization?.id || loading) return;
      const userId = getCurrentUser()?.id;
      const generation = getSessionGeneration();
      loading = true;
      $('#commerceLoading').hidden = false;
      $('#commerceUnavailable').hidden = true;
      try {
        const result = await db.rpc('get_minuta_commerce_workspace_v147', { p_organization:organization.id });
        if (result.error) throw result.error;
        if (!sessionIsCurrent(userId, generation) || organization?.id !== result.data?.organization_id) return;
        state = result.data;
        render();
      } catch (error) {
        $('#commerceWorkspace').hidden = true;
        $('#commerceUnavailable').hidden = false;
        $('#commerceUnavailableText').textContent = errorMessage(error);
        throw error;
      } finally {
        loading = false;
        $('#commerceLoading').hidden = true;
      }
    }

    async function write(form, errorElement, scope, payload, rpc, params) {
      if (!requireWrites()) return;
      const intent = requestIntent(`${organization.id}:${scope}`, payload);
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      setError(errorElement, '');
      try {
        const result = await db.rpc(rpc, { ...params, p_request_id:intent.requestId });
        if (result.error) throw result.error;
        clearIntent(intent.key);
        await load();
        notify(result.data?.replayed ? 'Операция уже была проведена — повтор не создан' : 'Операция проведена');
        return true;
      } catch (error) {
        setError(errorElement, error);
        return false;
      } finally {
        submit.disabled = false;
      }
    }

    async function submitSale(event) {
      event.preventDefault();
      const form = event.currentTarget;
      const kind = $('#commerceItemKind').value;
      const quantity = kind === 'benefit_product' ? 1 : number($('#commerceQuantity').value);
      const payload = { kind, item:$('#commerceItem').value, client:$('#commerceClient').value || null, booking:$('#commerceBooking').value || null, warehouse:kind === 'inventory_item' ? $('#commerceWarehouse').value : null, quantity, price:minor($('#commerceUnitPrice').value), discount:minor($('#commerceDiscount').value), method:$('#commercePaymentMethod').value, account:$('#commercePaymentAccount').value };
      const ok = await write(form, $('#commerceSaleError'), 'sale', payload, 'sell_minuta_commercial_product_v147', {
        p_organization:organization.id, p_booking:payload.booking, p_client_account:payload.client,
        p_item_kind:kind, p_benefit_product:kind === 'benefit_product' ? payload.item : null,
        p_inventory_item:kind === 'inventory_item' ? payload.item : null, p_warehouse:payload.warehouse,
        p_quantity:quantity, p_unit_price_minor:payload.price, p_discount_minor:payload.discount,
        p_payment_method:payload.method, p_payment_account:payload.account
      });
      if (ok) { form.reset(); $('#commerceQuantity').value = '1'; $('#commerceDiscount').value = '0'; $('#commerceSaleCreator').open = false; render(); }
    }

    function selectRefundSale(saleId, { focusReason = false } = {}) {
      const sale = refundableSales().find(item => item.id === saleId);
      if (!sale) return;
      const quantity = number(sale.line?.quantity) - number(sale.line?.refunded_quantity);
      const amount = Number(sale.total_minor || 0) - Number(sale.refunded_minor || 0);
      $('#commerceRefundSale').value = sale.id;
      $('#commerceRefundQuantity').value = String(quantity);
      $('#commerceRefundAmount').value = String(amount / 100);
      $('#commerceRefundReason').value = '';
      updateRefundValidity();
      if (focusReason) $('#commerceRefundReason').focus();
    }

    function openRefund(saleId) {
      const creator = $('#commerceRefundCreator');
      if (!creator || creator.hidden) return;
      creator.open = true;
      selectRefundSale(saleId, { focusReason:true });
    }

    async function submitRefund(event) {
      event.preventDefault();
      const form = event.currentTarget;
      if (!updateRefundValidity()) return;
      const payload = { sale:$('#commerceRefundSale').value, quantity:number($('#commerceRefundQuantity').value), amount:minor($('#commerceRefundAmount').value), reason:$('#commerceRefundReason').value.trim() };
      const ok = await write(form, $('#commerceRefundError'), 'refund', payload, 'refund_minuta_commercial_sale_v147', { p_organization:organization.id, p_sale:payload.sale, p_quantity:payload.quantity, p_amount_minor:payload.amount, p_reason:payload.reason });
      if (ok) { form.reset(); $('#commerceRefundCreator').open = false; }
      updateRefundValidity();
    }

    async function submitRecurring(event) {
      event.preventDefault();
      const form = event.currentTarget;
      const expenseAccount = (state?.accounts || []).find(item => item.system_key === 'operating_expense');
      const payload = { name:$('#commerceRecurringName').value.trim(), supplier:$('#commerceRecurringSupplier').value.trim(), amount:minor($('#commerceRecurringAmount').value), day:Math.trunc(number($('#commerceRecurringDay').value)), paymentAccount:$('#commerceRecurringAccount').value, expenseAccount:expenseAccount?.id || '' };
      const ok = await write(form, $('#commerceRecurringError'), 'recurring-create', payload, 'create_minuta_recurring_expense_v147', { p_organization:organization.id, p_name:payload.name, p_supplier_name:payload.supplier, p_amount_minor:payload.amount, p_expense_account:payload.expenseAccount, p_payment_account:payload.paymentAccount, p_day_of_month:payload.day });
      if (ok) { form.reset(); $('#commerceRecurringName').value = 'Аренда'; $('#commerceRecurringDay').value = '1'; }
    }

    async function recordExpense(ruleId, button) {
      if (!requireWrites()) return;
      const today = new Date();
      const occurredOn = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const payload = { ruleId, occurredOn };
      const intent = requestIntent(`${organization.id}:recurring-record`, payload);
      button.disabled = true;
      try {
        const result = await db.rpc('record_minuta_recurring_expense_v147', { p_organization:organization.id, p_rule:ruleId, p_occurred_on:occurredOn, p_request_id:intent.requestId });
        if (result.error) throw result.error;
        clearIntent(intent.key);
        await load();
        notify(result.data?.replayed ? 'Расход уже учтён в этом месяце' : 'Расход добавлен в денежный журнал');
      } catch (error) {
        notify(errorMessage(error));
        button.disabled = false;
      }
    }

    async function toggleFinance(event) {
      const enabled = event.currentTarget.checked;
      event.currentTarget.disabled = true;
      try {
        if (!requireWrites()) throw new Error('writes_disabled');
        const result = await db.rpc('set_minuta_finance_enabled_v133', { p_organization:organization.id, p_enabled:enabled });
        if (result.error) throw result.error;
        await load();
        notify(enabled ? 'Единый финансовый учёт включён' : 'Финансовый учёт выключен');
      } catch (error) {
        event.currentTarget.checked = !enabled;
        notify(errorMessage(error));
      } finally { event.currentTarget.disabled = false; }
    }

    function bind() {
      if (bound) return;
      bound = true;
      $('#reloadCommerce')?.addEventListener('click', () => void load());
      $('#commerceFinanceEnabled')?.addEventListener('change', event => void toggleFinance(event));
      $('#commerceItemKind')?.addEventListener('change', renderItemControls);
      $('#commerceItem')?.addEventListener('change', renderItemControls);
      $('#commerceClient')?.addEventListener('change', renderBookings);
      $('#commerceBooking')?.addEventListener('change', event => {
        const booking = (state?.bookings || []).find(item => item.id === event.currentTarget.value);
        if (booking?.client_account_id) { $('#commerceClient').value = booking.client_account_id; renderBookings(); $('#commerceBooking').value = booking.id; }
      });
      $('#commercePaymentMethod')?.addEventListener('change', event => {
        if (event.currentTarget.value !== 'cash') return;
        const cash = (state?.accounts || []).find(item => item.account_type === 'cash' && item.system_key === null);
        if (cash) $('#commercePaymentAccount').value = cash.id;
      });
      $('#commerceSaleForm')?.addEventListener('submit', event => void submitSale(event));
      $('#commerceRefundForm')?.addEventListener('submit', event => void submitRefund(event));
      $('#commerceRefundSale')?.addEventListener('change', event => {
        if (event.currentTarget.value) selectRefundSale(event.currentTarget.value);
        else {
          $('#commerceRefundQuantity').value = '';
          $('#commerceRefundAmount').value = '';
          $('#commerceRefundReason').value = '';
          updateRefundValidity();
        }
      });
      $('#commerceRefundForm')?.addEventListener('input', updateRefundValidity);
      $('#commerceRecurringForm')?.addEventListener('submit', event => void submitRecurring(event));
      $('#commercePanel')?.addEventListener('click', event => {
        const refund = event.target.closest('[data-commerce-refund]');
        const record = event.target.closest('[data-commerce-record-expense]');
        if (refund) openRefund(refund.dataset.commerceRefund);
        if (record) void recordExpense(record.dataset.commerceRecordExpense, record);
      });
    }

    return {
      bind,
      load,
      startSale({ bookingId = '', clientId = '' } = {}) {
        $('#commerceSaleCreator').open = true;
        if (clientId && [...$('#commerceClient').options].some(option => option.value === clientId)) $('#commerceClient').value = clientId;
        renderBookings();
        if (bookingId && [...$('#commerceBooking').options].some(option => option.value === bookingId)) $('#commerceBooking').value = bookingId;
        $('#commerceItem').focus({ preventScroll:true });
      },
      async setOrganization(next) {
        if (organization?.id === next?.id && state) return;
        organization = next || null;
        state = null;
        $('#commerceWorkspace').hidden = true;
        if (organization?.id) await load();
      },
      reset() { organization = null; state = null; $('#commerceWorkspace').hidden = true; }
    };
  }

  function createFinanceController(options) {
    const { db, $, escapeHtml, notify } = options;
    let organization = null;
    let lastKey = '';
    let loading = false;

    function render(data) {
      $('#moneyDashboardWorkspace').hidden = false;
      $('#moneyDashboardUnavailable').hidden = true;
      $('#moneyIncome').textContent = rubles(data.income_minor);
      $('#moneyExpenses').textContent = rubles(data.expense_minor);
      $('#moneyProfit').textContent = rubles(Number(data.income_minor || 0) - Number(data.expense_minor || 0));
      const expenses = data.expense_structure || [];
      const max = Math.max(1, ...expenses.map(item => Math.abs(Number(item.amount_minor || 0))));
      $('#moneyExpenseStructure').innerHTML = expenses.length ? expenses.map(item => `<div class="money-expense-row"><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(rubles(item.amount_minor))}</small></span><i style="--money-share:${Math.max(2, Math.round(Math.abs(Number(item.amount_minor || 0)) / max * 100))}%"></i></div>`).join('') : '<p class="report-empty-inline">Расходов за период нет.</p>';
      const operations = data.recent_operations || [];
      $('#moneyRecentOperations').innerHTML = operations.length ? operations.map(item => `<article class="money-operation-row"><div><small>${escapeHtml(dateText(item.occurred_at))}</small><strong>${escapeHtml(operationNames[item.operation_type] || 'Операция')}</strong></div><span>${escapeHtml(rubles(item.amount_minor))}</span></article>`).join('') : '<p class="report-empty-inline">Операций за период нет.</p>';
    }

    async function load(range, { force = false } = {}) {
      if (!organization?.id || !range?.start || !range?.end || loading) return;
      const key = `${organization.id}:${range.start}:${range.end}`;
      if (!force && key === lastKey) return;
      loading = true;
      $('#moneyDashboardLoading').hidden = false;
      $('#moneyDashboardUnavailable').hidden = true;
      try {
        const result = await db.rpc('get_minuta_money_dashboard_v147', { p_organization:organization.id, p_start:range.start, p_end:range.end });
        if (result.error) throw result.error;
        if (organization?.id !== result.data?.organization_id) return;
        lastKey = key;
        render(result.data);
      } catch (error) {
        $('#moneyDashboardWorkspace').hidden = true;
        $('#moneyDashboardUnavailable').hidden = false;
      } finally {
        loading = false;
        $('#moneyDashboardLoading').hidden = true;
      }
    }

    $('#reloadMoneyDashboard')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('minuta:reload-money-dashboard'));
      notify('Финансовый результат обновляется');
    });

    return {
      load,
      setOrganization(next) { organization = next || null; lastKey = ''; $('#moneyDashboardWorkspace').hidden = true; },
      reset() { organization = null; lastKey = ''; $('#moneyDashboardWorkspace').hidden = true; }
    };
  }

  window.MinutaCommerce = Object.freeze({ createController, createFinanceController });
})();
