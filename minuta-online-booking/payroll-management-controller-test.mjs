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
  'payrollPlansCount','payrollPeriodsCount','payrollPlansList','payrollPeriodsList','payrollItemsList',
  'payrollPlanCreator','payrollPeriodCreator','payrollAdjustmentPanel','payrollPlanPerformer','payrollPeriodLocation',
  'payrollAdjustmentPeriod','payrollAdjustmentPerformer','payrollAuditPanel','payrollAuditCount','payrollAuditList'
];
function makeDom() {
  const elements = Object.fromEntries(ids.map(id => [id, new MockElement(id)]));
  return { elements, $: selector => elements[selector.replace(/^#/, '')] || new MockElement(selector) };
}

function workspace(organizationId, overrides = {}) {
  return {
    organization_id: organizationId, current_role: 'owner', can_manage: true, enabled: true,
    members: [{ id: `${organizationId}-user`, display_name: `Анна ${organizationId}`, role: 'specialist' }],
    locations: [{ id: `${organizationId}-location`, name: 'Центр' }],
    plans: [{ id: `${organizationId}-plan`, performer_id: `${organizationId}-user`, name: '<План>', effective_from: '2026-09-01', base_rate_bps: 3000, active: true, tiers: [] }],
    periods: [], items: [], adjustments: [], audit: [], ...overrides
  };
}

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

globalThis.window = {};
globalThis.document = { addEventListener() {} };
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
    assert.equal(name, 'get_minuta_payroll_workspace');
    return { data:null, error:{ code:'PGRST202', message:'function get_minuta_payroll_workspace does not exist' } };
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
  assert.equal(dom.elements.payrollAdjustmentPanel.hidden, true);
  assert.equal(dom.elements.payrollAuditPanel.hidden, true);
  assert.doesNotMatch(dom.elements.payrollPlansList.innerHTML, /data-edit-payroll-plan/, 'specialist UI must be read-only');
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

assert.match(source, /get_minuta_payroll_workspace/);
assert.match(source, /upsert_minuta_payroll_plan/);
assert.match(source, /calculate_minuta_payroll_period/);
assert.match(source, /add_minuta_payroll_adjustment/);
assert.match(source, /set_minuta_payroll_period_status/);
assert.match(source, /set_minuta_payroll_enabled/);

console.log('payroll management controller tests passed');
