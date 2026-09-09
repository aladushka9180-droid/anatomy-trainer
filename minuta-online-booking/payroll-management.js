(function () {
  'use strict';

  const RPC = Object.freeze({
    workspace: 'get_minuta_payroll_ledger_workspace_v136', enabled: 'set_minuta_payroll_ledger_enabled_v136',
    adjustment: 'record_minuta_payroll_adjustment_v136', accrue: 'accrue_minuta_payroll_period_v136',
    payment: 'pay_minuta_payroll_debt_v136', advance: 'create_minuta_payroll_advance_v136',
    offset: 'offset_minuta_payroll_advance_v136', reverse: 'reverse_minuta_payroll_transaction_v136'
  });
  const transactionLabels = Object.freeze({
    payroll_accrual: 'Начисление зарплаты', accrual: 'Начисление зарплаты',
    payroll_bonus: 'Премия', bonus: 'Премия', payroll_deduction: 'Удержание', deduction: 'Удержание',
    payroll_payment: 'Выплата зарплаты', payment: 'Выплата зарплаты', payroll_advance: 'Аванс', advance: 'Аванс',
    payroll_advance_offset: 'Зачёт аванса', advance_offset: 'Зачёт аванса', offset: 'Зачёт аванса',
    payroll_reversal: 'Отмена операции', reversal: 'Отмена операции'
  });

  function localIso(date) { const copy = new Date(date); copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset()); return copy.toISOString().slice(0, 10); }
  function monthBounds() { const now = new Date(); return { start: localIso(new Date(now.getFullYear(), now.getMonth(), 1)), end: localIso(new Date(now.getFullYear(), now.getMonth() + 1, 0)) }; }
  function localDateTime(date = new Date()) { const copy = new Date(date); copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset()); return copy.toISOString().slice(0, 16); }

  function createController(options) {
    const { db, escapeHtml, notify, requireWrites, getCurrentUser, getSessionGeneration, sessionIsCurrent, applyWriteAvailability } = options;
    const select = options.$;
    function $(selector) { return select(selector); }
    let organization = null, payload = null, availability = null, requestRevision = 0, writePending = false, pendingOrganization;

    function validRequestId(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '')); }
    function createRequestId() { if (!window.crypto?.randomUUID) throw new Error('secure_request_id_unavailable'); return window.crypto.randomUUID(); }
    function rememberedIntent() {
      try {
        const value = window.history?.state?.minutaPayrollLedgerIntent;
        if (!value || typeof value !== 'object' || !validRequestId(value.requestId) || !validRequestId(value.organizationId)
          || !validRequestId(value.userId) || typeof value.rpc !== 'string' || !value.parameters || typeof value.parameters !== 'object') return null;
        return value;
      } catch { return null; }
    }
    function rememberIntent(value) {
      try {
        const state = window.history?.state && typeof window.history.state === 'object' ? window.history.state : {};
        const next = { ...state };
        if (value) next.minutaPayrollLedgerIntent = value; else delete next.minutaPayrollLedgerIntent;
        window.history?.replaceState?.(next, '');
      } catch {}
    }
    function unsupported(error) { return /PGRST202|42883|get_minuta_payroll_ledger_workspace_v136|function .* does not exist/i.test(`${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`); }
    function scopeMatches(data, organizationId) { return Boolean(data && typeof data === 'object' && String(data.organization_id || '') === String(organizationId)); }
    function responseScopeMismatch(data, organizationId) { return Boolean(data && typeof data === 'object' && Object.prototype.hasOwnProperty.call(data, 'organization_id') && String(data.organization_id || '') !== String(organizationId)); }
    function setBusy(value) {
      $('#payrollPanel')?.querySelectorAll('[data-payroll-write]').forEach(control => {
        if (value && !control.disabled) { control.disabled = true; control.dataset.payrollBusy = 'true'; }
        else if (!value && control.dataset.payrollBusy === 'true') { control.disabled = false; delete control.dataset.payrollBusy; }
      });
    }
    function clearError(selector) { const holder = selector ? $(selector) : null; if (holder) { holder.textContent = ''; holder.hidden = true; } }
    function showError(selector, message) { const holder = selector ? $(selector) : null; if (holder) { holder.textContent = message; holder.hidden = false; } }
    function reset() {
      requestRevision += 1; organization = null; payload = null; availability = null; writePending = false; pendingOrganization = undefined;
      $('#payrollPanel').hidden = true; $('#payrollLoading').hidden = true; $('#payrollUnavailable').hidden = true; $('#payrollWorkspace').hidden = true;
    }
    async function setOrganization(next) {
      const normalized = next?.id ? { ...next } : null;
      if (writePending) {
        pendingOrganization = normalized; requestRevision += 1; payload = null; availability = normalized ? 'loading' : null;
        $('#payrollPanel').hidden = !normalized; $('#payrollLoading').hidden = !normalized; $('#payrollWorkspace').hidden = true;
        return { ok: false, optional: true, pending: true };
      }
      if (!normalized) { reset(); return { ok: false, optional: true }; }
      organization = normalized; pendingOrganization = undefined;
      const bounds = monthBounds();
      if (!$('#payrollStartDate').value) $('#payrollStartDate').value = bounds.start;
      if (!$('#payrollEndDate').value) $('#payrollEndDate').value = bounds.end;
      if ($('#payrollAdvancePaidAt') && !$('#payrollAdvancePaidAt').value) $('#payrollAdvancePaidAt').value = localDateTime();
      return load();
    }
    function validRange() {
      const start = $('#payrollStartDate').value, end = $('#payrollEndDate').value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) return null;
      const span = (new Date(`${end}T12:00:00`) - new Date(`${start}T12:00:00`)) / 86400000;
      return span >= 0 && span <= 366 ? { start, end } : null;
    }
    function asArray(value) { return Array.isArray(value) ? value : []; }
    function normalize(data) {
      const result = data && typeof data === 'object' ? { ...data } : {};
      for (const key of ['members', 'locations', 'plans', 'periods', 'items', 'adjustments', 'typed_adjustments', 'accruals', 'payments', 'advances', 'advance_offsets', 'debts', 'ledger_accounts', 'payment_accounts', 'cash_accounts', 'transactions', 'history', 'audit']) result[key] = asArray(result[key]);
      const accrualById = new Map(result.accruals.map(item => [String(item.id), item]));
      result.periods = result.periods.map(period => {
        const accrual = result.accruals.find(item => String(item.period_id) === String(period.id) && !item.reversed);
        const debts = accrual ? result.debts.filter(item => String(item.accrual_source_id) === String(accrual.id)) : [];
        return accrual ? {
          ...period, accrual_source_id: accrual.id, accrual_transaction_id: accrual.transaction_id,
          accrual_recorded: true, accrued_minor: Number(accrual.amount_minor || 0),
          paid_minor: debts.reduce((sum, item) => sum + Math.max(0, Number(item.original_minor || 0) - Number(item.debt_minor || 0)), 0),
          debt_minor: debts.reduce((sum, item) => sum + Math.max(0, Number(item.debt_minor || 0)), 0)
        } : period;
      });
      const typedHistory = result.typed_adjustments.map(item => ({ ...item, operation_type: item.kind, reversible: false }));
      const accrualHistory = result.accruals.map(item => ({ ...item, id: item.transaction_id, source_id: item.id, operation_type: 'payroll_accrual' }));
      const paymentHistory = result.payments.map(item => ({ ...item, id: item.transaction_id, source_id: item.id, period_id: accrualById.get(String(item.accrual_source_id))?.period_id, operation_type: 'payroll_payment' }));
      const advanceHistory = result.advances.map(item => ({ ...item, id: item.transaction_id, source_id: item.id, operation_type: 'payroll_advance' }));
      const offsetHistory = result.advance_offsets.map(item => ({ ...item, id: item.transaction_id, source_id: item.id, period_id: accrualById.get(String(item.accrual_source_id))?.period_id, operation_type: 'payroll_advance_offset' }));
      result.transactions = [...typedHistory, ...accrualHistory, ...paymentHistory, ...advanceHistory, ...offsetHistory, ...result.transactions]
        .sort((left, right) => String(right.occurred_at || right.created_at || '').localeCompare(String(left.occurred_at || left.created_at || '')));
      if (!result.transactions.length) result.transactions = result.history.length ? result.history : result.audit;
      const accountCandidates = [...result.payment_accounts, ...result.cash_accounts, ...result.ledger_accounts];
      result.payment_accounts = accountCandidates.filter((item, index) => item?.active !== false
        && ['cash', 'bank'].includes(String(item.account_type || item.system_key || '').toLowerCase())
        && accountCandidates.findIndex(candidate => String(candidate.id) === String(item.id)) === index);
      result.summary = result.summary && typeof result.summary === 'object' ? result.summary : (result.totals && typeof result.totals === 'object' ? result.totals : {});
      result.enabled = Boolean(result.ledger_enabled ?? result.enabled);
      return result;
    }
    function transactionRequestId(item) { return String(item?.request_id || item?.source_request_id || ''); }
    function reconcileIntent() {
      const intent = rememberedIntent();
      if (!intent || intent.organizationId !== organization?.id || intent.userId !== getCurrentUser()?.id) return false;
      if (!payload?.transactions.some(item => transactionRequestId(item) === intent.requestId)) return false;
      rememberIntent(null); notify('Операция подтверждена по зарплатному журналу'); return true;
    }
    async function load({ reconcile = true } = {}) {
      if (writePending) return { ok: false, optional: true, pending: true };
      const userId = getCurrentUser()?.id, generation = getSessionGeneration(), organizationId = organization?.id, range = validRange(), revision = ++requestRevision;
      if (!userId || !organizationId) { reset(); return { ok: false, optional: true }; }
      if (!range) {
        availability = 'error'; $('#payrollPanel').hidden = false; $('#payrollWorkspace').hidden = true; $('#payrollUnavailable').hidden = false;
        $('#payrollUnavailableText').textContent = 'Выберите период не более 366 дней.'; return { ok: false, optional: true, validation: true };
      }
      availability = 'loading'; payload = null; $('#payrollPanel').hidden = false; $('#payrollLoading').hidden = false; $('#payrollUnavailable').hidden = true; $('#payrollWorkspace').hidden = true;
      const { data, error } = await db.rpc(RPC.workspace, { p_organization: organizationId, p_start: range.start, p_end: range.end });
      if (!sessionIsCurrent(userId, generation) || revision !== requestRevision || organization?.id !== organizationId) return { ok: false, optional: true, stale: true };
      $('#payrollLoading').hidden = true;
      if (error) {
        availability = unsupported(error) ? 'unsupported' : 'error';
        if (availability === 'unsupported') { $('#payrollPanel').hidden = true; return { ok: false, optional: true, unsupported: true }; }
        $('#payrollUnavailable').hidden = false; $('#payrollUnavailableText').textContent = 'Команда и записи продолжают работать. Не удалось загрузить только зарплаты.'; return { ok: false, optional: true };
      }
      if (!scopeMatches(data, organizationId)) {
        availability = 'error'; $('#payrollUnavailable').hidden = false; $('#payrollUnavailableText').textContent = 'Сервер вернул расчёты другой организации. Изменения заблокированы.';
        return { ok: false, optional: true, scopeMismatch: true };
      }
      payload = normalize(data); availability = 'ready'; render(); if (reconcile) reconcileIntent(); return { ok: true, optional: true };
    }

    function memberName(id) { return payload.members.find(item => String(item.id) === String(id))?.display_name || 'Специалист'; }
    function locationName(id) { return payload.locations.find(item => String(item.id) === String(id))?.name || 'Все филиалы'; }
    function periodName(id) { return payload.periods.find(item => String(item.id) === String(id))?.name || 'Расчётный период'; }
    function minor(item, ...keys) { for (const key of keys) { const value = Number(item?.[key]); if (Number.isFinite(value)) return Math.round(value); } return 0; }
    function moneyMinor(value) { const amount = Number(value || 0) / 100; return `${new Intl.NumberFormat('ru-RU', { minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2 }).format(amount)} ₽`; }
    function rubles(value) { return `${new Intl.NumberFormat('ru-RU').format(Number(value || 0))} ₽`; }
    function percent(bps) { return `${(Number(bps || 0) / 100).toLocaleString('ru-RU')}%`; }
    function dateLabel(value) { const date = new Date(value?.includes?.('T') ? value : `${value}T12:00:00`); return Number.isNaN(date.getTime()) ? String(value || '') : date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }); }
    function dateTimeLabel(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    function optionList(items, selected, label) { return items.map(item => `<option value="${escapeHtml(item.id)}" ${String(item.id) === String(selected) ? 'selected' : ''}>${escapeHtml(label(item))}</option>`).join(''); }
    function empty(title, text) { return `<div class="provider-empty compact-empty"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(text)}</small></div>`; }
    function periodAmounts(period) {
      const accrued = minor(period, 'accrued_minor', 'total_accrued_minor', 'payroll_accrued_minor') || Math.round(Number(period.total_payroll_rub || 0) * 100);
      const paid = minor(period, 'paid_minor', 'total_paid_minor', 'payroll_paid_minor');
      const debtValue = period.debt_minor ?? period.outstanding_minor ?? period.payroll_debt_minor;
      const debt = Number.isFinite(Number(debtValue)) ? Math.max(0, Math.round(Number(debtValue))) : Math.max(0, accrued - paid);
      const accruedRecorded = Boolean(period.accrual_transaction_id || period.ledger_accrued || period.accrued_at || period.accrual_recorded);
      return { accrued, paid, debt, accruedRecorded };
    }
    function planCard(plan, canManage) {
      const tiers = Array.isArray(plan.tiers) && plan.tiers.length ? plan.tiers.map(tier => `от ${rubles(tier.threshold_rub)} — ${percent(tier.rate_bps)}`).join(' · ') : 'без ступеней';
      const dates = `${dateLabel(plan.effective_from)}${plan.effective_to ? ` — ${dateLabel(plan.effective_to)}` : ''}`;
      return `<article class="organization-row payroll-plan-row ${plan.active === false ? 'is-muted' : ''}"><div class="organization-row-main"><strong>${escapeHtml(plan.name || 'План мотивации')} · ${escapeHtml(percent(plan.base_rate_bps))}</strong><small>${escapeHtml(memberName(plan.performer_id))} · ${escapeHtml(dates)} · ${escapeHtml(tiers)}</small></div>${canManage ? `<button class="secondary-button payroll-edit-plan" type="button" data-edit-payroll-plan="${escapeHtml(plan.id)}" data-payroll-write>Изменить</button>` : ''}</article>`;
    }
    function periodCard(period, canManage, enabled) {
      const amounts = periodAmounts(period); let status = 'Готов к начислению';
      if (amounts.accruedRecorded && amounts.debt > 0 && amounts.paid > 0) status = 'Частично выплачено'; else if (amounts.accruedRecorded && amounts.debt > 0) status = 'К выплате'; else if (amounts.accruedRecorded) status = 'Выплачено';
      if (!amounts.accruedRecorded && period.status === 'approved') status = 'Нужно восстановить начисление';
      const action = canManage && enabled && !amounts.accruedRecorded && period.status === 'draft'
        ? `<button class="secondary-button payroll-accrue-button" type="button" data-payroll-approve-accrue="${escapeHtml(period.id)}" data-payroll-write>Утвердить и начислить</button>`
        : (canManage && enabled && !amounts.accruedRecorded && period.status === 'approved'
          ? `<button class="secondary-button payroll-accrue-button" type="button" data-payroll-accrue="${escapeHtml(period.id)}" data-payroll-write>Восстановить начисление</button>` : '');
      return `<article class="organization-row payroll-period-row" data-period-id="${escapeHtml(period.id)}"><div class="organization-row-main"><strong>${escapeHtml(period.name || 'Расчёт')}</strong><small>${escapeHtml(locationName(period.location_id))} · ${escapeHtml(dateLabel(period.starts_on))} — ${escapeHtml(dateLabel(period.ends_on))}</small><span class="payroll-period-totals"><span>Начислено <b>${escapeHtml(moneyMinor(amounts.accrued))}</b></span><span>Выплачено <b>${escapeHtml(moneyMinor(amounts.paid))}</b></span><span>Долг <b>${escapeHtml(moneyMinor(amounts.debt))}</b></span></span></div><span class="organization-tags"><span class="organization-status ${amounts.accruedRecorded && amounts.debt === 0 ? 'is-active' : ''}">${escapeHtml(status)}</span>${action}</span></article>`;
    }
    function itemCard(item) {
      const value = minor(item, 'payroll_minor', 'amount_minor') || Math.round(Number(item.payroll_rub || 0) * 100);
      return `<article class="organization-row payroll-item-row"><div class="organization-row-main"><strong>${escapeHtml(item.service_name || 'Услуга')} · ${escapeHtml(moneyMinor(value))}</strong><small>${escapeHtml(memberName(item.performer_id))} · ${escapeHtml(dateLabel(item.booking_date))}${item.rate_bps ? ` · ${escapeHtml(percent(item.rate_bps))}` : ''}</small></div></article>`;
    }
    function transactionType(item) { return String(item.transaction_type || item.operation_type || item.kind || item.type || 'payroll_operation').toLowerCase(); }
    function transactionCard(item, canManage) {
      const type = transactionType(item), amount = minor(item, 'amount_minor', 'gross_minor', 'payroll_minor');
      const details = [item.performer_id ? memberName(item.performer_id) : '', item.period_id ? periodName(item.period_id) : '', dateTimeLabel(item.occurred_at || item.paid_at || item.created_at), item.reason || item.note].filter(Boolean).join(' · ');
      const reversed = Boolean(item.reversed || item.reversed_at || item.reversal_transaction_id || item.reversed_by_transaction_id), isReversal = type.includes('reversal');
      const canReverse = canManage && payload.enabled && item.id && item.reversible !== false && !reversed && !isReversal;
      const reverse = canReverse ? `<details class="payroll-reverse"><summary>Отменить запись</summary><form data-payroll-reversal-form data-transaction="${escapeHtml(item.id)}"><label>Причина отмены<input name="reason" maxlength="500" required></label><p class="form-error" hidden></p><button class="secondary-button" type="submit" data-payroll-write>Создать обратную операцию</button></form></details>` : '';
      return `<article class="payroll-history-row ${reversed ? 'is-reversed' : ''}"><span class="payroll-history-kind">${escapeHtml(transactionLabels[type] || 'Операция зарплаты')}</span><div><strong>${escapeHtml(moneyMinor(amount))}</strong><small>${escapeHtml(details || 'Системная запись')}</small></div>${reversed ? '<span class="organization-status">Отменено</span>' : reverse}</article>`;
    }
    function summaryTotals() {
      const summary = payload.summary || {};
      const periodTotals = payload.periods.reduce((totals, period) => { const value = periodAmounts(period); totals.accrued += value.accruedRecorded ? value.accrued : 0; totals.paid += value.paid; totals.debt += value.accruedRecorded ? value.debt : 0; return totals; }, { accrued: 0, paid: 0, debt: 0 });
      const openAdvances = payload.advances.reduce((sum, advance) => sum + Math.max(0, minor(advance, 'remaining_minor', 'open_minor', 'amount_remaining_minor')), 0);
      return { accrued: minor(summary, 'accrued_minor', 'total_accrued_minor') || periodTotals.accrued, paid: minor(summary, 'paid_minor', 'total_paid_minor') || periodTotals.paid, debt: minor(summary, 'debt_minor', 'outstanding_minor', 'total_debt_minor') || periodTotals.debt, advance: minor(summary, 'advance_open_minor', 'open_advance_minor', 'advances_minor') || openAdvances };
    }
    function render() {
      if (availability !== 'ready' || !payload) return;
      const role = payload.current_role || '', canManage = Boolean(payload.can_manage) && (role === 'owner' || role === 'admin'), owner = role === 'owner', enabled = Boolean(payload.enabled), totals = summaryTotals();
      const accruedPeriods = payload.periods.filter(period => periodAmounts(period).accruedRecorded), debtRows = payload.debts.filter(item => Number(item.debt_minor || 0) > 0), openAdvances = payload.advances.filter(item => !item.reversed && minor(item, 'remaining_minor', 'open_minor', 'amount_remaining_minor') > 0);
      $('#payrollPanel').hidden = false; $('#payrollUnavailable').hidden = true; $('#payrollWorkspace').hidden = false;
      $('#payrollEnabled').checked = enabled; $('#payrollEnabled').disabled = !owner; $('#payrollEnabledField').title = owner ? '' : 'Включить зарплатный журнал может только владелец';
      $('#payrollEnabledHint').textContent = enabled ? 'Начисления, выплаты и отмены записываются в неизменяемую историю.' : 'По умолчанию выключено. Начисления и выплаты не создаются.';
      $('#payrollAccruedTotal').textContent = moneyMinor(totals.accrued); $('#payrollPaidTotal').textContent = moneyMinor(totals.paid); $('#payrollDebtTotal').textContent = moneyMinor(totals.debt); $('#payrollAdvanceTotal').textContent = moneyMinor(totals.advance);
      $('#payrollPlansCount').textContent = String(payload.plans.filter(item => item.active !== false).length); $('#payrollPeriodsCount').textContent = String(payload.periods.length);
      $('#payrollPlansList').innerHTML = payload.plans.length ? payload.plans.map(item => planCard(item, canManage)).join('') : empty('Планов пока нет', canManage ? 'Создайте процент для сотрудника.' : 'Владелец ещё не настроил мотивацию.');
      $('#payrollPeriodsList').innerHTML = payload.periods.length ? payload.periods.map(item => periodCard(item, canManage, enabled)).join('') : empty('Расчётов пока нет', 'Выберите период и подготовьте расчёт.');
      $('#payrollItemsList').innerHTML = payload.items.length ? payload.items.map(itemCard).join('') : empty('Начислений по визитам нет', 'Детализация появится после подготовки расчёта.');
      $('#payrollPlanCreator').hidden = !canManage; $('#payrollPeriodCreator').hidden = !canManage || !enabled; $('#payrollLedgerActions').hidden = !canManage || !enabled;
      $('#payrollPlanPerformer').innerHTML = optionList(payload.members.filter(item => item.is_bookable !== false), '', item => item.display_name); $('#payrollPeriodLocation').innerHTML = `<option value="">Все филиалы</option>${optionList(payload.locations, '', item => item.name)}`;
      $('#payrollAdjustmentPeriod').innerHTML = optionList(payload.periods, '', item => item.name || `${item.starts_on} — ${item.ends_on}`); $('#payrollAdjustmentPerformer').innerHTML = optionList(payload.members, '', item => item.display_name);
      $('#payrollAdvancePerformer').innerHTML = optionList(payload.members, '', item => item.display_name); $('#payrollAdvanceAccount').innerHTML = optionList(payload.payment_accounts, '', item => item.name || item.system_key || 'Счёт');
      const debtOptions = debtRows.map(item => ({ id: `${item.accrual_source_id}|${item.performer_id}`, ...item }));
      $('#payrollPaymentDebt').innerHTML = optionList(debtOptions, '', item => `${memberName(item.performer_id)} · ${periodName(item.period_id)} · долг ${moneyMinor(item.debt_minor)}`); $('#payrollPaymentAccount').innerHTML = optionList(payload.payment_accounts, '', item => item.name || item.system_key || 'Счёт');
      $('#payrollOffsetAdvance').innerHTML = optionList(openAdvances, '', item => `${memberName(item.performer_id)} · остаток ${moneyMinor(minor(item, 'remaining_minor', 'open_minor', 'amount_remaining_minor'))}`); $('#payrollOffsetDebt').innerHTML = optionList(debtOptions, '', item => `${memberName(item.performer_id)} · ${periodName(item.period_id)} · долг ${moneyMinor(item.debt_minor)}`);
      $('#payrollAdvancePanel').hidden = !payload.payment_accounts.length; $('#payrollPaymentPanel').hidden = !debtRows.length || !payload.payment_accounts.length; $('#payrollOffsetPanel').hidden = !debtRows.length || !openAdvances.length; $('#payrollAuditPanel').hidden = !canManage;
      $('#payrollAuditCount').textContent = String(payload.transactions.length); $('#payrollAuditList').innerHTML = payload.transactions.length ? payload.transactions.map(item => transactionCard(item, canManage)).join('') : empty('Операций пока нет', 'Начисления, выплаты, авансы и отмены появятся здесь.');
      setBusy(false); applyWriteAvailability();
    }

    function userError(error) {
      const source = `${error?.message || ''} ${error?.details || ''}`;
      const messages = [['payroll_ledger_disabled','Сначала включите зарплатный журнал.'],['payroll_disabled','Сначала включите зарплатный журнал.'],['payroll_period_not_accrued','Сначала зафиксируйте начисление этого периода.'],['payroll_period_already_accrued','Этот период уже начислен. Повторная запись не создана.'],['payroll_debt_exceeded','Сумма выплаты больше текущего долга.'],['payroll_advance_exceeded','Сумма зачёта больше остатка аванса или долга.'],['payroll_adjustment_kind_invalid','Выберите премию или удержание.'],['payroll_amount_invalid','Введите положительную сумму в целых рублях.'],['payroll_transaction_not_reversible','Эту запись нельзя отменить. История не изменена.'],['payroll_period_overlap','Для этого филиала уже есть пересекающийся расчёт.'],['payroll_plan_overlap','У сотрудника уже действует план на этот период.'],['payroll_plan_missing_for_completed_booking','Для завершённого визита не найден план мотивации.'],['payroll_requires_completed_bookings','В периоде нет завершённых записей для расчёта.'],['owner_required','Это действие доступно только владельцу.'],['organization_access_denied','Недостаточно прав для этой организации.']];
      return messages.find(([key]) => source.includes(key))?.[1] || 'Операция не записана. Проверьте данные и повторите.';
    }
    async function mutate(rpc, parameters, button, success, errorSelector, withRequestId = false) {
      if (!requireWrites() || writePending || availability !== 'ready' || !payload || !organization?.id || String(payload.organization_id) !== String(organization.id)) return false;
      const userId = getCurrentUser()?.id, generation = getSessionGeneration(), organizationId = organization.id;
      if (!userId) return false;
      if (withRequestId) {
        const recovered = rememberedIntent();
        if (recovered?.rpc === rpc && recovered.organizationId === organizationId && recovered.userId === userId) parameters = { ...recovered.parameters };
        else {
          let requestId; try { requestId = createRequestId(); } catch { showError(errorSelector, 'Безопасный идентификатор запроса недоступен. Обновите браузер и повторите.'); return false; }
          parameters = { ...parameters, p_request_id: requestId }; rememberIntent({ rpc, requestId, organizationId, userId, parameters });
        }
      }
      const revision = ++requestRevision; writePending = true; setBusy(true); clearError(errorSelector);
      const oldText = button?.textContent; if (button) { button.disabled = true; button.textContent = 'Сохраняем…'; }
      let result; try { result = await db.rpc(rpc, parameters); } catch (error) { result = { data: null, error, transport: true }; }
      if (button) button.textContent = oldText;
      const stale = !sessionIsCurrent(userId, generation) || organization?.id !== organizationId || revision !== requestRevision; writePending = false;
      if (stale) { const next = pendingOrganization; pendingOrganization = undefined; if (next !== undefined) await setOrganization(next); return false; }
      if (result?.error) {
        if (!result.transport && withRequestId) rememberIntent(null);
        const message = result.transport ? 'Ответ сервера не получен. Не повторяйте операцию: сначала обновите журнал для сверки.' : userError(result.error);
        if (errorSelector) showError(errorSelector, message); else notify(message); await load(); return false;
      }
      if (responseScopeMismatch(result?.data, organizationId)) { notify('Ответ сервера относится к другой организации. Новая операция заблокирована.'); await load(); return false; }
      if (withRequestId) rememberIntent(null); notify(success); await load();
      const next = pendingOrganization; pendingOrganization = undefined; if (next !== undefined) await setOrganization(next); return true;
    }
    function rublesToMinor(input, errorSelector) {
      const rubleValue = Number(input?.value);
      if (!Number.isSafeInteger(rubleValue) || rubleValue <= 0 || rubleValue > 1000000) { showError(errorSelector, 'Введите положительную сумму в целых рублях.'); return null; }
      return rubleValue * 100;
    }
    function parseTiers(text) {
      if (!String(text || '').trim()) return [];
      return String(text).split(/\r?\n/).filter(line => line.trim()).map(line => {
        const parts = line.trim().split(/\s*(?:=|—|-)\s*/), threshold = Number(parts[0].replace(/\s/g, '').replace(',', '.')), rate = Number((parts[1] || '').replace(',', '.'));
        if (!Number.isFinite(threshold) || threshold < 0 || !Number.isFinite(rate) || rate < 0 || rate > 100) throw new Error('invalid_tier');
        return { threshold_rub: Math.round(threshold), rate_bps: Math.round(rate * 100) };
      }).sort((a, b) => a.threshold_rub - b.threshold_rub);
    }
    async function handleSubmit(event) {
      if (!event.target.closest('#payrollPanel')) return;
      if (event.target.id === 'payrollPlanForm') {
        event.preventDefault(); let tiers; try { tiers = parseTiers($('#payrollPlanTiers').value); } catch { showError('#payrollPlanError', 'Ступени указываются построчно: сумма — процент.'); return; }
        const saved = await mutate('upsert_minuta_payroll_plan', { p_organization: organization.id, p_plan: $('#payrollPlanId').value || null, p_performer: $('#payrollPlanPerformer').value, p_name: $('#payrollPlanName').value.trim(), p_effective_from: $('#payrollPlanFrom').value, p_effective_to: $('#payrollPlanTo').value || null, p_base_rate_bps: Math.round(Number($('#payrollPlanRate').value) * 100), p_tiers: tiers }, event.submitter, 'План мотивации сохранён', '#payrollPlanError');
        if (saved) { event.target.reset(); $('#payrollPlanId').value = ''; $('#payrollPlanCreator').open = false; } return;
      }
      if (event.target.id === 'payrollPeriodForm') {
        event.preventDefault(); const range = validRange(); if (!range) { showError('#payrollPeriodError', 'Проверьте даты периода.'); return; }
        await mutate('calculate_minuta_payroll_period', { p_organization: organization.id, p_period: null, p_location: $('#payrollPeriodLocation').value || null, p_starts_on: range.start, p_ends_on: range.end, p_name: $('#payrollPeriodName').value.trim() }, event.submitter, 'Расчёт подготовлен. Проверьте сумму и зафиксируйте начисление.', '#payrollPeriodError'); return;
      }
      if (event.target.id === 'payrollAdjustmentForm') {
        event.preventDefault(); const amount = rublesToMinor($('#payrollAdjustmentAmount'), '#payrollAdjustmentError'); if (amount === null) return;
        await mutate(RPC.adjustment, { p_organization: organization.id, p_period: $('#payrollAdjustmentPeriod').value, p_performer: $('#payrollAdjustmentPerformer').value, p_kind: $('#payrollAdjustmentKind').value, p_amount_minor: amount, p_reason: $('#payrollAdjustmentReason').value.trim() }, event.submitter, 'Корректировка записана', '#payrollAdjustmentError', true); return;
      }
      if (event.target.id === 'payrollAdvanceForm') {
        event.preventDefault(); const amount = rublesToMinor($('#payrollAdvanceAmount'), '#payrollAdvanceError'), paidAt = new Date($('#payrollAdvancePaidAt').value); if (amount === null) return; if (Number.isNaN(paidAt.getTime())) { showError('#payrollAdvanceError', 'Укажите дату и время аванса.'); return; }
        await mutate(RPC.advance, { p_organization: organization.id, p_performer: $('#payrollAdvancePerformer').value, p_cash_or_bank_account: $('#payrollAdvanceAccount').value, p_amount_minor: amount, p_occurred_at: paidAt.toISOString() }, event.submitter, 'Аванс записан', '#payrollAdvanceError', true); return;
      }
      if (event.target.id === 'payrollPaymentForm') {
        event.preventDefault(); const amount = rublesToMinor($('#payrollPaymentAmount'), '#payrollPaymentError'); if (amount === null) return;
        const [accrualSource, performer] = String($('#payrollPaymentDebt').value || '').split('|');
        await mutate(RPC.payment, { p_organization: organization.id, p_accrual_source: accrualSource, p_performer: performer, p_cash_or_bank_account: $('#payrollPaymentAccount').value, p_amount_minor: amount }, event.submitter, 'Выплата записана, долг обновлён', '#payrollPaymentError', true); return;
      }
      if (event.target.id === 'payrollOffsetForm') {
        event.preventDefault(); const amount = rublesToMinor($('#payrollOffsetAmount'), '#payrollOffsetError'); if (amount === null) return;
        const [accrualSource] = String($('#payrollOffsetDebt').value || '').split('|');
        await mutate(RPC.offset, { p_organization: organization.id, p_advance_source: $('#payrollOffsetAdvance').value, p_accrual_source: accrualSource, p_amount_minor: amount }, event.submitter, 'Аванс зачтён, долг обновлён', '#payrollOffsetError', true); return;
      }
      const reversal = event.target.closest('[data-payroll-reversal-form]');
      if (reversal) {
        event.preventDefault(); const error = reversal.querySelector('.form-error'), reason = reversal.querySelector('[name="reason"]')?.value.trim() || '';
        if (!reason) { if (error) { error.textContent = 'Укажите причину отмены.'; error.hidden = false; } return; }
        await mutate(RPC.reverse, { p_organization: organization.id, p_transaction: reversal.dataset.transaction, p_reason: reason }, event.submitter, 'Обратная операция добавлена в журнал', null, true);
      }
    }
    async function handleClick(event) {
      if (event.target.closest('#reloadPayroll')) { await load(); return; }
      const edit = event.target.closest('[data-edit-payroll-plan]');
      if (edit) {
        const plan = payload?.plans.find(item => String(item.id) === edit.dataset.editPayrollPlan); if (!plan) return;
        $('#payrollPlanId').value = plan.id; $('#payrollPlanPerformer').value = plan.performer_id; $('#payrollPlanName').value = plan.name || ''; $('#payrollPlanFrom').value = plan.effective_from || ''; $('#payrollPlanTo').value = plan.effective_to || ''; $('#payrollPlanRate').value = Number(plan.base_rate_bps || 0) / 100; $('#payrollPlanTiers').value = (plan.tiers || []).map(tier => `${tier.threshold_rub} — ${Number(tier.rate_bps || 0) / 100}`).join('\n'); $('#payrollPlanCreator').open = true; return;
      }
      const accrue = event.target.closest('[data-payroll-accrue]');
      if (accrue) await mutate(RPC.accrue, { p_organization: organization.id, p_period: accrue.dataset.payrollAccrue, p_occurred_at: new Date().toISOString() }, accrue, 'Начисление записано. Теперь доступны частичные выплаты.', null, true);
      const approve = event.target.closest('[data-payroll-approve-accrue]');
      if (approve) await mutate('set_minuta_payroll_period_status', { p_organization: organization.id, p_period: approve.dataset.payrollApproveAccrue, p_status: 'approved' }, approve, 'Расчёт утверждён, начисление записано.');
    }
    async function handleChange(event) {
      if (event.target.id === 'payrollStartDate' || event.target.id === 'payrollEndDate') await load();
      if (event.target.id === 'payrollEnabled') { const desired = event.target.checked, ok = await mutate(RPC.enabled, { p_organization: organization.id, p_enabled: desired }, event.target, desired ? 'Зарплатный журнал включён' : 'Зарплатный журнал выключен'); if (!ok && payload) event.target.checked = Boolean(payload.enabled); }
    }
    function bind() { document.addEventListener('submit', handleSubmit); document.addEventListener('click', handleClick); document.addEventListener('change', handleChange); }
    return { bind, load, reset, setOrganization, get availability() { return availability; }, get payload() { return payload; } };
  }
  window.MinutaPayroll = { createController };
})();
