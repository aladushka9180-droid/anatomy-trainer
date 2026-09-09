import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(root, 'payroll-management.js'), 'utf8');
assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i, 'tenant payroll data must never be cached in the browser');

class MockElement {
  constructor(id = '') { this.id = id; this.hidden = false; this.innerHTML = ''; this.textContent = ''; this.value = ''; this.checked = false; this.disabled = false; this.open = false; this.dataset = {}; this.title = ''; }
  querySelector() { return new MockElement(); }
  querySelectorAll() { return []; }
  closest(selector) { return selector === '#payrollPanel' ? this : null; }
  reset() {}
}

const ids = [
  'payrollPanel','payrollLoading','payrollUnavailable','payrollUnavailableText','payrollWorkspace',
  'payrollStartDate','payrollEndDate','payrollEnabled','payrollEnabledField','payrollEnabledHint',
  'payrollAccruedTotal','payrollPaidTotal','payrollDebtTotal','payrollAdvanceTotal','payrollLedgerActions',
  'payrollPlansCount','payrollPeriodsCount','payrollPlansList','payrollPeriodsList','payrollItemsList',
  'payrollPlanCreator','payrollPeriodCreator','payrollAdjustmentPanel','payrollPlanPerformer','payrollPeriodLocation',
  'payrollAdjustmentPeriod','payrollAdjustmentPerformer','payrollAdvancePerformer','payrollAdvanceAccount','payrollAdvancePaidAt',
  'payrollAdvancePanel','payrollPaymentPanel','payrollPaymentDebt','payrollPaymentAccount','payrollOffsetPanel','payrollOffsetAdvance','payrollOffsetDebt',
  'payrollAuditPanel','payrollAuditCount','payrollAuditList'
];
function makeDom() {
  const elements = Object.fromEntries(ids.map(id => [id, new MockElement(id)]));
  return { elements, $: selector => elements[selector.replace(/^#/, '')] || new MockElement(selector) };
}

function workspace(organizationId, overrides = {}) {
  return {
    organization_id: organizationId, current_role: 'owner', can_manage: true, ledger_enabled: true,
    members: [{ id: `${organizationId}-user`, display_name: `Анна ${organizationId}`, role: 'specialist' }],
    locations: [{ id: `${organizationId}-location`, name: 'Центр' }],
    plans: [{ id: `${organizationId}-plan`, performer_id: `${organizationId}-user`, name: '<План>', effective_from: '2026-09-01', base_rate_bps: 3000, active: true, tiers: [] }],
    periods: [], items: [], adjustments: [], typed_adjustments: [], accruals: [], payments: [],
    advances: [], advance_offsets: [], debts: [], ledger_accounts: [], transactions: [], audit: [], ...overrides
  };
}

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

globalThis.window = {};
const documentHandlers = {};
globalThis.document = { addEventListener(type, handler) { documentHandlers[type] = handler; } };
await import(`${pathToFileURL(join(root, 'payroll-management.js')).href}?test=${Date.now()}`);
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[char]));
function controller(dom, rpc, overrides = {}) {
  assert.equal(typeof dom.$, 'function');
  const controllerOptions = {
    db: { rpc }, $: dom.$, escapeHtml, notify() {}, requireWrites: () => true,
    getCurrentUser: () => ({ id:'owner' }), getSessionGeneration: () => 1,
    sessionIsCurrent: () => true, applyWriteAvailability() {}, ...overrides
  };
  assert.equal(typeof controllerOptions.$, 'function');
  return window.MinutaPayroll.createController(controllerOptions);
}

{
  const dom = makeDom();
  const instance = controller(dom, async name => {
    assert.equal(name, 'get_minuta_payroll_ledger_workspace_v136');
    return { data:null, error:{ code:'PGRST202', message:'function get_minuta_payroll_ledger_workspace_v136 does not exist' } };
  });
  const result = await instance.setOrganization({ id:'org-1' });
  assert.equal(result.unsupported, true);
  assert.equal(instance.availability, 'unsupported');
  assert.equal(dom.elements.payrollPanel.hidden, true, 'an unapplied optional migration must not leave a broken panel');
}

{
  const dom = makeDom();
  const instance = controller(dom, async () => ({ data:workspace('foreign-org'), error:null }));
  const result = await instance.setOrganization({ id:'org-1' });
  assert.equal(result.scopeMismatch, true);
  assert.equal(instance.payload, null, 'foreign tenant payload must be discarded');
  assert.equal(dom.elements.payrollWorkspace.hidden, true);
  assert.match(dom.elements.payrollUnavailableText.textContent, /другой организации/);
}

{
  const dom = makeDom();
  const first = deferred();
  const second = deferred();
  const instance = controller(dom, async (_name, parameters) => parameters.p_organization === 'org-old' ? first.promise : second.promise);
  const oldRequest = instance.setOrganization({ id:'org-old' });
  const newRequest = instance.setOrganization({ id:'org-new' });
  second.resolve({ data:workspace('org-new'), error:null });
  await newRequest;
  first.resolve({ data:workspace('org-old'), error:null });
  const oldResult = await oldRequest;
  assert.equal(oldResult.stale, true);
  assert.match(dom.elements.payrollPlansList.innerHTML, /Анна org-new/);
  assert.doesNotMatch(dom.elements.payrollPlansList.innerHTML, /Анна org-old/);
}

{
  const dom = makeDom();
  const instance = controller(dom, async () => ({ data:workspace('org-specialist', { current_role:'specialist', can_manage:false }), error:null }));
  await instance.setOrganization({ id:'org-specialist' });
  assert.equal(dom.elements.payrollPlanCreator.hidden, true);
  assert.equal(dom.elements.payrollPeriodCreator.hidden, true);
  assert.equal(dom.elements.payrollLedgerActions.hidden, true);
  assert.equal(dom.elements.payrollAuditPanel.hidden, true);
  assert.doesNotMatch(dom.elements.payrollPlansList.innerHTML, /data-edit-payroll-plan/, 'specialist UI must be read-only');
}

{
  const dom = makeDom();
  const period = 'period-1', accrual = 'accrual-1', performer = 'org-ledger-user';
  const value = workspace('org-ledger', {
    payment_accounts:[{ id:'cash-1', name:'Касса', account_type:'cash', active:true }],
    periods:[{ id:period, name:'Сентябрь', starts_on:'2026-09-01', ends_on:'2026-09-30', total_payroll_rub:32500 }],
    typed_adjustments:[{ id:'adjustment-1', period_id:period, performer_id:performer, kind:'bonus', amount_minor:500000, reason:'Премия', created_at:'2026-09-08T10:00:00Z' }],
    accruals:[{ id:accrual, period_id:period, amount_minor:3250000, transaction_id:'transaction-1', occurred_at:'2026-09-08T11:00:00Z', reversed:false }],
    payments:[{ id:'payment-1', accrual_source_id:accrual, performer_id:performer, amount_minor:1200000, transaction_id:'transaction-2', occurred_at:'2026-09-09T09:00:00Z', reversed:false }],
    debts:[{ accrual_source_id:accrual, period_id:period, performer_id:performer, original_minor:3250000, settled_minor:1200000, debt_minor:2050000 }]
  });
  const instance = controller(dom, async () => ({ data:value, error:null }));
  await instance.setOrganization({ id:'org-ledger' });
  assert.equal(dom.elements.payrollAccruedTotal.textContent, '32 500 ₽');
  assert.equal(dom.elements.payrollPaidTotal.textContent, '12 000 ₽');
  assert.equal(dom.elements.payrollDebtTotal.textContent, '20 500 ₽');
  assert.match(dom.elements.payrollPeriodsList.innerHTML, /Частично выплачено/);
  assert.doesNotMatch(dom.elements.payrollPeriodsList.innerHTML, /data-payroll-status|Отметить выплату/);
  assert.match(dom.elements.payrollAuditList.innerHTML, /Выплата зарплаты/);
  assert.match(dom.elements.payrollAuditList.innerHTML, /Премия/);
  assert.equal(dom.elements.payrollLedgerActions.hidden, false);
}

{
  const dom = makeDom();
  const calls = [];
  const draft = { id:'period-draft', name:'Черновик', status:'draft', starts_on:'2026-09-01', ends_on:'2026-09-15', total_payroll_rub:1000 };
  const approved = { id:'period-approved', name:'Восстановление', status:'approved', starts_on:'2026-09-16', ends_on:'2026-09-30', total_payroll_rub:1000 };
  const value = workspace('org-approval', { periods:[draft, approved] });
  const instance = controller(dom, async (name, parameters) => {
    calls.push({ name, parameters });
    return name === 'get_minuta_payroll_ledger_workspace_v136' ? { data:value, error:null } : { data:{ organization_id:'org-approval' }, error:null };
  });
  await instance.setOrganization({ id:'org-approval' });
  assert.match(dom.elements.payrollPeriodsList.innerHTML, /data-payroll-approve-accrue="period-draft"[^>]*>Утвердить и начислить/);
  assert.match(dom.elements.payrollPeriodsList.innerHTML, /data-payroll-accrue="period-approved"[^>]*>Восстановить начисление/);
  instance.bind();
  const approveButton = new MockElement();
  approveButton.dataset.payrollApproveAccrue = 'period-draft';
  approveButton.closest = selector => selector === '[data-payroll-approve-accrue]' ? approveButton : null;
  await documentHandlers.click({ target:approveButton });
  const approval = calls.find(call => call.name === 'set_minuta_payroll_period_status');
  assert.deepEqual(approval?.parameters, { p_organization:'org-approval', p_period:'period-draft', p_status:'approved' });
  assert.equal(calls.some(call => call.name === 'accrue_minuta_payroll_period_v136'), false, 'draft approval must rely on the atomic approval trigger');
}

{
  const dom = makeDom();
  const pending = deferred();
  let active = true;
  const instance = controller(dom, async () => pending.promise, {
    getCurrentUser: () => active ? ({ id:'owner' }) : null,
    sessionIsCurrent: () => active
  });
  const request = instance.setOrganization({ id:'org-session' });
  active = false;
  instance.reset();
  pending.resolve({ data:workspace('org-session'), error:null });
  const result = await request;
  assert.equal(result.stale, true);
  assert.equal(dom.elements.payrollPanel.hidden, true);
}

assert.match(source, /get_minuta_payroll_ledger_workspace_v136/);
assert.match(source, /upsert_minuta_payroll_plan/);
assert.match(source, /calculate_minuta_payroll_period/);
for (const rpc of ['set_minuta_payroll_ledger_enabled_v136','record_minuta_payroll_adjustment_v136','accrue_minuta_payroll_period_v136','pay_minuta_payroll_debt_v136','create_minuta_payroll_advance_v136','offset_minuta_payroll_advance_v136','reverse_minuta_payroll_transaction_v136']) assert.match(source, new RegExp(rpc));
assert.match(source, /set_minuta_payroll_period_status[\s\S]*p_status:\s*'approved'/);
assert.doesNotMatch(source, /add_minuta_payroll_adjustment|p_status:\s*'paid'|data-payroll-status|Отметить выплату/);

console.log('payroll management controller tests passed');
