import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// Actual standalone controllers; fake public submit/read/identity/DOM ports only.
// No stock movement, benefit issuance, payment or real server rule is modeled.
const sources = Object.fromEntries(['benefit','inventory'].map(kind => [kind,
  readFileSync(new URL('../' + kind + '-management.js', import.meta.url), 'utf8')]));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function fixture(kind, action = 'item') {
  const nodes = new Map(), listeners = new Map(), storage = new Map(), roles = new Map();
  const notices = [], calls = [], entered = deferred(), outcome = deferred(), readEntered = deferred(), readOutcome = deferred();
  const writes = [];
  let holdRead = false, userId = 'synthetic-owner', generation = 1;
  const panel = kind === 'benefit' ? 'benefitsPanel' : 'inventoryPanel';
  const fieldId = kind === 'benefit' ? 'benefitProductName' : 'inventoryItemName';
  const formId = action === 'apply' ? 'benefitApplyForm' : kind === 'benefit' ? 'benefitProductForm' : 'inventoryItemForm';
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, { id, value:'', hidden:false, checked:true, disabled:false, open:true,
      innerHTML:'', textContent:'', dataset:{}, options:[], style:{ setProperty() {} }, classList:{ add() {}, remove() {}, toggle() {}, contains() { return false; } },
      querySelectorAll() { return []; }, querySelector() { return null; }, closest(selector) { return selector === '#' + panel ? node(panel) : null; },
      setAttribute() {}, removeAttribute() {}, setCustomValidity() {}, focus() {}, after() {}, append() {},
      reset() { node(fieldId).value = ''; }
    });
    return nodes.get(id);
  }
  const $ = selector => node(selector.replace(/^#/, ''));
  const workspace = id => kind === 'benefit'
    ? { organization_id:id, current_role:roles.get(id) || 'owner', enabled:true, services:[], clients:[], bookings:[], products:[], instruments:[], redemptions:[], audit:[] }
    : { organization_id:id, current_role:roles.get(id) || 'owner', enabled:true, auto_deduct_completed_visits:false,
      locations:[], services:[], usage:[], audit:[], items:[], warehouses:[], balances:[], movements:[], transfer_documents:[], transfer_version:130 };
  const box = { console, Date, Intl, Map, Set, WeakMap, Array, Object, Number, String, Boolean, JSON, RegExp, Error, TypeError, Uint8Array, TextEncoder, URL,
    navigator:{ onLine:true }, localStorage:{ getItem:key => storage.get(key) || null, setItem:(key, value) => storage.set(key, value), removeItem:key => storage.delete(key) },
    crypto:{ randomUUID:() => '11111111-1111-4111-8111-111111111111' }, location:{ origin:'https://fixture.invalid' },
    document:{ addEventListener:(name, handler) => listeners.set(name, handler) } };
  box.window = box;
  vm.runInNewContext(sources[kind], box, { filename:'actual-' + kind + '-management.js', timeout:1000 });
  const readName = kind === 'benefit' ? 'get_minuta_benefit_workspace' : 'get_minuta_inventory_workspace_v130';
  const mutation = action === 'apply' ? 'apply_minuta_benefit_v149' : kind === 'benefit' ? 'upsert_minuta_benefit_product' : 'upsert_minuta_inventory_item';
  const db = { async rpc(name, parameters) {
    calls.push({ name, organization:parameters.p_organization });
    if (name === readName) {
      if (holdRead) { holdRead = false; readEntered.resolve(); return readOutcome.promise; }
      return { data:workspace(parameters.p_organization), error:null };
    }
    assert.equal(name, mutation, 'unexpected fake RPC');
    const gate = writes.length ? deferred() : outcome; writes.push({ gate, organization:parameters.p_organization });
    entered.resolve(); return gate.promise;
  } };
  const controller = (kind === 'benefit' ? box.MinutaBenefits : box.MinutaInventory).createController({ db, $, escapeHtml:String,
    notify:message => notices.push(message), requireWrites:() => true, getCurrentUser:() => ({ id:userId }), getSessionGeneration:() => generation,
    sessionIsCurrent:(expectedUser, expectedGeneration) => expectedUser === userId && expectedGeneration === generation, applyWriteAvailability() {} });
  controller.bind();
  return { controller, node, notices, calls, writes, entered, outcome, readEntered, readOutcome, workspace, mutation,
    setOrganization(id, role = 'owner') { roles.set(id, role); return controller.setOrganization({ id, current_role:role }); },
    changeSession() { userId = 'synthetic-new-owner'; generation++; }, armRead() { holdRead = true; },
    fill(label) {
      node(fieldId).value = 'Synthetic draft ' + label;
      if (kind === 'benefit') { node('benefitProductKind').value = 'visit_pass'; node('benefitProductVisits').value = '5'; node('benefitProductValidity').value = '30'; node('benefitProductPrice').value = '100'; }
      else node('inventoryItemUnit').value = 'piece';
      if (action === 'apply') { node('benefitApplyInstrument').value = 'synthetic-instrument'; node('benefitApplyBooking').value = 'synthetic-booking'; node('benefitApplyAmount').value = ''; node('benefitApplyCreator').open = true; }
    },
    draft() { return node(fieldId).value; },
    submit() { return listeners.get('submit')({ target:node(formId), submitter:node('submit'), preventDefault() {} }); }
  };
}

async function start(f) { await f.setOrganization('synthetic-A'); f.fill('A'); const pending = f.submit(); await f.entered.promise; return { pending }; }
async function waitForRefresh(f) { f.armRead(); f.outcome.resolve({ data:{ organization_id:'synthetic-A' }, error:null }); await f.readEntered.promise; }

for (const kind of ['benefit', 'inventory']) {
  for (const transition of ['organization', 'ABA', 'session-reset', 'role']) test(kind + ': ACK-refresh cannot reset a new ' + transition + ' draft', async () => {
    const f = fixture(kind), { pending } = await start(f); await waitForRefresh(f);
    if (transition === 'organization') await f.setOrganization('synthetic-B');
    if (transition === 'ABA') { await f.setOrganization('synthetic-B'); await f.setOrganization('synthetic-A'); }
    if (transition === 'session-reset') { f.changeSession(); f.controller.reset(); await f.setOrganization('synthetic-A'); }
    if (transition === 'role') await f.setOrganization('synthetic-A', 'admin');
    f.fill('new-context'); const mark = f.notices.length;
    f.readOutcome.resolve({ data:f.workspace('synthetic-A'), error:null }); await pending;
    assert.equal(f.draft(), 'Synthetic draft new-context'); assert.equal(f.notices.length, mark);
  });
  for (const result of ['success', 'known-error', 'unknown']) test(kind + ': current ' + result + ' preserves submit behavior', async () => {
    const f = fixture(kind), { pending } = await start(f);
    f.outcome.resolve(result === 'success' ? { data:{ organization_id:'synthetic-A' }, error:null } : { data:null, error:{ code:result === 'known-error' ? '42501' : 'FETCH_FAILED' } });
    await pending;
    assert.equal(f.draft(), result === 'success' ? '' : 'Synthetic draft A');
    if (result !== 'success') assert.equal(f.node(kind === 'benefit' ? 'benefitProductError' : 'inventoryItemError').hidden, false);
    assert.equal(f.calls.filter(call => call.name === f.mutation).length, 1);
  });
  test(kind + ': same-scope refresh does not revoke a normal acknowledgement', async () => {
    const f = fixture(kind), { pending } = await start(f); await waitForRefresh(f); await f.setOrganization('synthetic-A');
    f.readOutcome.resolve({ data:f.workspace('synthetic-A'), error:null }); await pending; assert.equal(f.draft(), '');
  });
}

test('benefit application ACK-refresh cannot close a new organization application draft', async () => {
  const f = fixture('benefit', 'apply'), { pending } = await start(f); await waitForRefresh(f);
  await f.setOrganization('synthetic-B'); f.fill('B');
  f.readOutcome.resolve({ data:f.workspace('synthetic-A'), error:null }); await pending;
  assert.equal(f.node('benefitApplyCreator').open, true);
});

test('benefit application current ACK retains ordinary close behavior', async () => {
  const f = fixture('benefit', 'apply'), { pending } = await start(f);
  f.outcome.resolve({ data:{ organization_id:'synthetic-A' }, error:null }); await pending;
  assert.equal(f.node('benefitApplyCreator').open, false);
});


for (const kind of ['benefit', 'inventory']) test(kind + ': error refresh cannot carry an old error into new scope', async () => {
  const f = fixture(kind), { pending } = await start(f);
  f.armRead(); f.outcome.resolve({ data:null, error:{ code:'FETCH_FAILED' } }); await f.readEntered.promise;
  await f.setOrganization('synthetic-B'); f.fill('B');
  f.readOutcome.resolve({ data:f.workspace('synthetic-A'), error:null }); await pending;
  assert.equal(f.draft(), 'Synthetic draft B');
  const error = f.node(kind === 'benefit' ? 'benefitProductError' : 'inventoryItemError');
  assert.equal(error.textContent, ''); assert.equal(error.hidden, true);
});

// Distinct deferred writes exercise the actual public reset -> new RPC ownership path.
// The duplicate is an explicit public-submit reentry, not a claim about a browser click.
for (const [kind, action] of [['benefit','item'], ['benefit','apply'], ['inventory','item']]) {
  for (const oldResult of ['success', 'known-error']) test(kind + ' ' + action + ': late RPC ' + oldResult + ' cannot release a new mutation owner', async () => {
    const f = fixture(kind, action), { pending:oldPending } = await start(f);
    f.controller.reset(); await f.setOrganization('synthetic-B'); f.fill('B');
    f.node('submit').textContent = 'Save synthetic B';
    const currentPending = f.submit();
    assert.equal(f.writes.length, 2, 'the new context owns an independent pending RPC');
    assert.equal(f.node('submit').textContent, 'Сохраняем…');
    f.writes[0].gate.resolve(oldResult === 'success' ? { data:{ organization_id:'synthetic-A' }, error:null } : { data:null, error:{ code:'42501' } });
    await oldPending;
    const caption = f.node('submit').textContent, noticeCount = f.notices.length;
    const duplicatePending = f.submit();
    const submittedCount = f.writes.length;
    for (const write of f.writes.slice(1)) write.gate.resolve({ data:{ organization_id:write.organization }, error:null });
    await Promise.all([currentPending, duplicatePending]);
    assert.deepEqual({ caption, submittedCount }, { caption:'Сохраняем…', submittedCount:2 }, 'old completion must preserve the new owner caption and single-write gate');
    assert.equal(noticeCount, 0, 'old completion must not publish feedback into the new context');
    assert.equal(f.node('submit').textContent, 'Save synthetic B');
    if (action === 'apply') assert.equal(f.node('benefitApplyCreator').open, false);
    else assert.equal(f.draft(), '');
  });
}

for (const [kind, action] of [['benefit','item'], ['benefit','apply'], ['inventory','item']]) {
  test(kind + ' ' + action + ': reset without a replacement RPC releases only its own caption', async () => {
    const f = fixture(kind, action); await f.setOrganization('synthetic-A'); f.fill('A'); f.node('submit').textContent = 'Save synthetic A';
    const pending = f.submit(); await f.entered.promise;
    f.controller.reset(); await f.setOrganization('synthetic-B'); f.fill('B');
    f.outcome.resolve({ data:{ organization_id:'synthetic-A' }, error:null }); await pending;
    assert.equal(f.node('submit').textContent, 'Save synthetic A');
    assert.equal(f.draft(), 'Synthetic draft B'); assert.equal(f.writes.length, 1);
  });
  test(kind + ' ' + action + ': queued organization preserves current RPC release and next submit', async () => {
    const f = fixture(kind, action), { pending } = await start(f);
    const queued = await f.setOrganization('synthetic-B'); assert.equal(queued.pending, true);
    f.outcome.resolve({ data:{ organization_id:'synthetic-A' }, error:null }); await pending;
    f.fill('B'); f.node('submit').textContent = 'Save synthetic B'; const next = f.submit();
    assert.equal(f.writes.length, 2); assert.equal(f.writes[1].organization, 'synthetic-B');
    f.writes[1].gate.resolve({ data:{ organization_id:'synthetic-B' }, error:null }); await next;
    assert.equal(f.node('submit').textContent, 'Save synthetic B');
    if (action === 'apply') assert.equal(f.node('benefitApplyCreator').open, false);
    else assert.equal(f.draft(), '');
  });
}
