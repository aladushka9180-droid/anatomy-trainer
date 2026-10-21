import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// Whole active v166 controller; all DOM, RPC, storage, identity and crypto are fake.
// Presentation mounting is skipped. This proves continuation ownership, not UI layout.
const source = readFileSync(new URL('../loyalty-program-v166.js', import.meta.url), 'utf8');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function fixture() {
  const nodes = new Map(), listeners = new Map(), storage = new Map();
  const notices = [], calls = [], entered = deferred(), outcome = deferred(), readEntered = deferred(), readOutcome = deferred();
  let holdRead = false, userId = 'synthetic-owner', generation = 1;
  const classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, {
      id, value:'', hidden:true, checked:false, disabled:false, textContent:'', innerHTML:'', dataset:{}, classList,
      style:{ setProperty() {} }, querySelectorAll() { return []; }, setAttribute() {}, removeAttribute() {}, setCustomValidity() {}, focus() {},
      resets:0, reset() { this.resets++; for (const field of ['loyaltyAdjustmentClient', 'loyaltyAdjustmentPoints', 'loyaltyAdjustmentReason']) node(field).value = ''; }
    });
    return nodes.get(id);
  }
  const $ = selector => selector === '#loyaltyPanel' ? null : node(selector.replace(/^#/, ''));
  const workspace = id => ({ organization_id:id, enabled:true,
    rule:{ id:'synthetic-rule', goal_visits:10, reward_kind:'percent', reward_value:1000, reward_title:'Скидка 10%', reward_terms:'', validity_days:90 },
    clients:[], accounts:[], rewards:[], history:[], stats:{ issued:0, redeemed:0 } });
  const box = { console, Intl, URL, Date, Math, Map, Set, Object, Array, Number, String, Boolean, JSON, RegExp, Error,
    navigator:{ onLine:true }, crypto:{ randomUUID:() => '11111111-1111-4111-8111-111111111111' },
    localStorage:{ getItem:key => storage.get(key) || null, setItem:(key, value) => storage.set(key, value), removeItem:key => storage.delete(key) },
    document:{ currentScript:{ src:'https://fixture.invalid/loyalty-program-v166.js' }, addEventListener:(name, handler) => listeners.set(name, handler) }
  };
  box.window = box;
  vm.runInNewContext(source, box, { filename:'actual-loyalty-program-v166.js', timeout:1000 });
  const db = { async rpc(name, parameters) {
    calls.push({ name, organization:parameters.p_organization });
    if (name === 'get_minuta_loyalty_program_workspace_v166') {
      if (holdRead) { holdRead = false; readEntered.resolve(); return readOutcome.promise; }
      return { data:workspace(parameters.p_organization), error:null };
    }
    if (!['adjust_minuta_loyalty_progress_v166', 'set_minuta_loyalty_program_v166'].includes(name)) throw new Error('UNEXPECTED_FAKE_RPC');
    entered.resolve(); return outcome.promise;
  } };
  const controller = box.MinutaLoyalty.createController({ db, $, escapeHtml:String, notify:message => notices.push(message), requireWrites:() => true,
    getCurrentUser:() => ({ id:userId }), getSessionGeneration:() => generation,
    sessionIsCurrent:(expectedUser, expectedGeneration) => expectedUser === userId && expectedGeneration === generation, applyWriteAvailability() {} });
  controller.bind();
  return { controller, node, calls, notices, entered, outcome, readEntered, readOutcome, workspace, storage,
    armRead:() => { holdRead = true; }, changeSession:() => { userId = 'synthetic-other'; generation++; },
    fill(label) { node('loyaltyAdjustmentClient').value = 'synthetic-client-' + label; node('loyaltyAdjustmentPoints').value = '1'; node('loyaltyAdjustmentReason').value = 'Synthetic reason ' + label; },
    submit(form = 'loyaltyAdjustmentForm') { return listeners.get('submit')({ target:node(form), submitter:node('submit'), preventDefault() {} }); }
  };
}

async function start(f, form) {
  await f.controller.setOrganization({ id:'synthetic-A', current_role:'owner' });
  f.fill('A'); const pending = f.submit(form); await f.entered.promise; return { pending };
}

for (const form of ['loyaltyAdjustmentForm', 'loyaltyProgramForm']) test(form + ': ACK then pending refresh cannot change newer organization draft', async () => {
  const f = fixture(), { pending } = await start(f, form);
  f.armRead(); f.outcome.resolve({ data:{ ok:true }, error:null }); await f.readEntered.promise;
  await f.controller.setOrganization({ id:'synthetic-B', current_role:'owner' }); f.fill('B');
  f.node('loyaltyRewardTitle').value = 'Synthetic B title';
  f.readOutcome.resolve({ data:f.workspace('synthetic-A'), error:null }); await pending;
  assert.equal(f.controller.payload.organization_id, 'synthetic-B');
  assert.equal(f.node('loyaltyAdjustmentReason').value, 'Synthetic reason B');
  assert.equal(f.node('loyaltyAdjustmentForm').resets, 0);
  assert.equal(f.node('loyaltyRewardTitle').value, 'Synthetic B title');
  assert.equal(f.notices.length, 0);
  assert.equal(f.node('loyaltyAdjustmentError').textContent, '');
  assert.equal(f.node('loyaltyRuleError').textContent, '');
});

for (const reply of ['error', 'throw']) test('late ' + reply + ' after organization change stays in its old scope', async () => {
  const f = fixture(), { pending } = await start(f);
  await f.controller.setOrganization({ id:'synthetic-B', current_role:'owner' }); f.fill('B');
  if (reply === 'error') f.outcome.resolve({ data:null, error:{ code:'FETCH_FAILED' } });
  else f.outcome.resolve(Promise.reject(new Error('SYNTHETIC_TRANSPORT_REJECTION')));
  await pending;
  assert.equal(f.node('loyaltyAdjustmentReason').value, 'Synthetic reason B');
  assert.equal(f.node('loyaltyAdjustmentError').textContent, '');
  assert.equal(f.notices.length, 0);
});

test('A to B to A does not revive old mutation ownership', async () => {
  const f = fixture(), { pending } = await start(f);
  await f.controller.setOrganization({ id:'synthetic-B', current_role:'owner' });
  await f.controller.setOrganization({ id:'synthetic-A', current_role:'owner' }); f.fill('new-A');
  f.outcome.resolve({ data:{ ok:true }, error:null }); await pending;
  assert.equal(f.node('loyaltyAdjustmentReason').value, 'Synthetic reason new-A');
  assert.equal(f.node('loyaltyAdjustmentForm').resets, 0); assert.equal(f.notices.length, 0);
});

test('new session rejects old failure continuation', async () => {
  const f = fixture(), { pending } = await start(f); f.changeSession();
  f.controller.reset(); await f.controller.setOrganization({ id:'synthetic-A', current_role:'owner' }); f.fill('new-session');
  f.outcome.resolve({ data:null, error:{ code:'FETCH_FAILED' } }); await pending;
  assert.equal(f.node('loyaltyAdjustmentReason').value, 'Synthetic reason new-session');
  assert.equal(f.node('loyaltyAdjustmentError').textContent, ''); assert.equal(f.notices.length, 0);
});

test('same-organization refresh preserves a current mutation acknowledgement', async () => {
  const f = fixture(), { pending } = await start(f);
  await f.controller.setOrganization({ id:'synthetic-A', current_role:'owner', display_name:'Updated presentation' });
  f.outcome.resolve({ data:{ ok:true }, error:null }); await pending;
  assert.equal(f.node('loyaltyAdjustmentForm').resets, 1);
  assert.deepEqual(f.notices, ['Прогресс скорректирован']); assert.equal(f.node('submit').disabled, false);
});

for (const result of ['success', 'error', 'unknown']) test('ordinary current ' + result + ' retains original behavior', async () => {
  const f = fixture(), { pending } = await start(f);
  f.outcome.resolve(result === 'success' ? { data:{ ok:true }, error:null } : { data:null, error:{ code:result === 'error' ? '42501' : 'FETCH_FAILED' } }); await pending;
  assert.equal(f.node('submit').disabled, false);
  if (result === 'success') { assert.equal(f.node('loyaltyAdjustmentForm').resets, 1); assert.deepEqual(f.notices, ['Прогресс скорректирован']); assert.equal(f.storage.size, 0); }
  else { assert.equal(f.node('loyaltyAdjustmentForm').resets, 0); assert.equal(f.node('loyaltyAdjustmentReason').value, 'Synthetic reason A');
    assert.match(f.node('loyaltyAdjustmentError').textContent, result === 'error' ? /отклонено/ : /подтвердить результат/);
    if (result === 'unknown') { assert.equal(f.storage.size, 1); assert.equal(f.notices.length, 1); }
  }
});


test('same organization role transition invalidates old pending ownership', async () => {
  const f = fixture(), { pending } = await start(f);
  await f.controller.setOrganization({ id:'synthetic-A', current_role:'admin' }); f.fill('new-role');
  f.outcome.resolve({ data:{ ok:true }, error:null }); await pending;
  assert.equal(f.node('loyaltyAdjustmentReason').value, 'Synthetic reason new-role');
  assert.equal(f.node('loyaltyAdjustmentForm').resets, 0); assert.equal(f.notices.length, 0);
});
