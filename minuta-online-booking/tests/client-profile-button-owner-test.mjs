import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Extract only actual Source handlers; all state, DOM and transport ports are synthetic.
// No provider imports/bootstrap, Browser, product transport or storage.
const option = name => {
  const key = '--' + name, index = process.argv.indexOf(key);
  if (index >= 0) { assert.ok(process.argv[index + 1] && !process.argv[index + 1].startsWith('--'), key + ' requires a value'); return process.argv[index + 1]; }
  return process.argv.find(value => value.startsWith(key + '='))?.slice(key.length + 1);
};
const sourcePath = option('source') || fileURLToPath(new URL('../provider.js', import.meta.url));
const raw = readFileSync(sourcePath), digest = createHash('sha256').update(raw).digest('hex');
const expectedDigest = option('sha');
if (expectedDigest !== undefined) {
  assert.match(expectedDigest, /^[a-fA-F0-9]{64}$/, 'optional Source pin must be SHA256');
  assert.equal(digest, expectedDigest.toLowerCase(), 'Source pin must match the selected public input');
}
const source = raw.toString('utf8').replace(/\r\n/g, '\n');
const sha = value => createHash('sha256').update(value).digest('hex');
// Preserve the four existing RPC/payload expressions without a historical file dependency.
const rpcBlocks = value => (value.match(/await db\.rpc\([\s\S]*?\}\)/g) || []).filter(value => /(?:save_minuta_client_identity_v134|save_minuta_client_birthday_v119|set_minuta_client_online_booking_block_v1(?:19|35))/.test(value));
const expectedRpcBlocks = [
  "await db.rpc('save_minuta_client_identity_v134', {\n    p_organization:organizationId,\n    p_client_phone:oldPhone,\n    p_client_name:newName,\n    p_new_client_phone:newPhone\n  })",
  "await db.rpc('save_minuta_client_birthday_v119', {\n    p_organization:organizationId,p_client_phone:phone,p_birthday:birthday\n  })",
  "await db.rpc('set_minuta_client_online_booking_block_v135', {\n      p_organization:organizationId,p_client_phone:phone,p_blocked:blocked,p_reason:reason || null\n    })",
  "await db.rpc('set_minuta_client_online_booking_block_v119', {\n      p_organization:organizationId,p_client_phone:phone,p_blocked:blocked\n    })"
];
assert.deepEqual(rpcBlocks(source), expectedRpcBlocks, 'client RPC/payload contract preserved');
new vm.Script(source, { filename:'provider-source-syntax-only.js' });

function between(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a && source.indexOf(start, a + start.length) === -1);
  return source.slice(a, b);
}
const clientSource = [
  between('function normalizePhone(value)', 'function clientAvatar(phone)'),
  between('function normalizedClientProfileDetails(', 'async function loadClientProfileDetails('),
  between('function moveClientMapEntry(', 'async function saveClientIdentity('),
  between('async function saveClientIdentity(', 'function openClientBlockConfirmation('),
  between('async function confirmClientOnlineBlock(', 'function resetClientProfileReturnContext(')
].join('\n');
const openBirthday = between('function openClientBirthdayDialog()', 'function openClientIdentityDialog()');
const wholeClickListener = between("document.addEventListener('click', async event => {\n  if (event.target.closest('#newBookingServiceOpen'))", "document.addEventListener('change', async event => {");
const ownerBootstrap = between('const clientProfileWriteOwners = new WeakMap();', 'async function saveClientIdentity(');
assert.ok(ownerBootstrap.includes('function beginClientProfileWrite(button) {'), 'real owner begin helper required');
assert.ok(ownerBootstrap.includes('function releaseClientProfileWrite(button, operation) {'), 'real owner release helper required');
assert.ok(clientSource.includes(ownerBootstrap), 'execute the exact WeakMap and helpers from provider Source');

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function clientFixture() {
  const nodes = new Map(), calls = [], notices = [], outcome = deferred();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { value:'', textContent:'', hidden:false, disabled:false, open:true, dataset:{},
      classList:{ toggle() {} }, focus() {}, close() { this.open = false; },
      querySelector(selector) { return node(id + ' ' + selector); } });
    return nodes.get(id);
  };
  const phoneA = '79990000001', phoneB = '79990000002', newPhone = '79990000009';
  const state = phone => ({ phone, birthday:'1990-02-03', onlineBookingBlocked:false, onlineBookingBlockReason:'', supportsBlockReason:true, canEdit:true, canManageBlock:true, available:true });
  const box = { Map, Set, Date, String, Boolean, JSON, currentUser:{ id:'synthetic-user-A' }, sessionGeneration:1,
    activeClientOrganizationId:'synthetic-organization-A', selectedClientPhone:phoneA, clientProfileDetailsState:state(phoneA), clientProfileDetailsLoadRevision:1,
    allBookings:[], importedBookingHistory:[], importedClients:[], clientNotes:new Map(), clientLabels:new Map(), clientAvatars:new Map(), pendingClientNotes:new Map(), pendingClientLabels:new Set(), providerBookingViewRevisions:new Map(),
    $:node, requireWrites:() => true, businessTodayIso:() => '2026-10-17', newBookingClientPhoneLabel:phone => phone,
    clearFormError:id => { node(id).textContent = ''; }, showFormError:(id, message) => { node(id).textContent = message; },
    notify:message => notices.push(message), isMissingRpc:() => false, isScheduleBlock:() => false,
    updateBookingStats() {}, renderBookings() {}, renderClients() {}, renderClientDetail() {},
    db:{ rpc:async (name, parameters) => { calls.push({ name, parameters }); return outcome.promise; } }
  };
  box.sessionIsCurrent = (id, generation) => box.currentUser?.id === id && box.sessionGeneration === generation;
  box.buildClients = () => [{ phone:phoneA, name:'Synthetic A' }, { phone:phoneB, name:'Synthetic B' }];
  vm.createContext(box); vm.runInContext(clientSource, box, { filename:'frozen-client-functions.js', timeout:1000 });
  node('#clientIdentityPhone').value = newPhone; node('#clientIdentityName').value = 'Synthetic changed A';
  node('#clientBirthdayInput').value = '1980-01-02'; node('#clientBlockReason').value = 'Synthetic reason';
  function choose({ organization = box.activeClientOrganizationId, phone = phoneB, user = box.currentUser.id } = {}) {
    if (user !== box.currentUser.id) { box.currentUser = { id:user }; box.sessionGeneration++; }
    box.activeClientOrganizationId = organization; box.selectedClientPhone = phone; box.clientProfileDetailsLoadRevision++;
    box.clientProfileDetailsState = state(phone); box.clientProfileDetailsState.birthday = '1991-04-05';
    box.allBookings = [{ organization_id:organization, client_phone:phoneA, client_name:'Synthetic untouched B' }];
    box.importedClients = [{ phone:phoneA, name:'Synthetic untouched B' }];
    for (const id of ['#clientIdentityDialog','#clientBirthdayDialog','#clientBlockDialog']) node(id).open = true;
  }
  const view = () => JSON.parse(JSON.stringify({ selected:box.selectedClientPhone, state:box.clientProfileDetailsState,
    bookings:box.allBookings, imported:box.importedClients, notices, dialogs:['#clientIdentityDialog','#clientBirthdayDialog','#clientBlockDialog'].map(id => node(id).open) }));
  return { box, node, calls, notices, outcome, phoneA, phoneB, newPhone, choose, view,
    invoke(action) { return action === 'identity' ? box.saveClientIdentity({ preventDefault() {} }) : action === 'birthday' ? box.saveClientBirthday({ preventDefault() {} }) : box.confirmClientOnlineBlock(); },
    response(action, error = false) { return error ? { data:null, error:{ code:'42501', message:'Synthetic refusal' } } : { data:{ client_phone:action === 'identity' ? newPhone : phoneA, client_name:'Synthetic changed A', birthday:'1980-01-02', online_booking_blocked:action === 'block', can_edit:true, can_manage_block:true }, error:null }; }
  };
}
const make = clientFixture;
const controls = {
  identity:{ button:'#clientIdentityForm button[type="submit"]', dialog:'#clientIdentityDialog', rpc:'save_minuta_client_identity_v134', keys:['p_organization','p_client_phone','p_client_name','p_new_client_phone'] },
  birthday:{ button:'#clientBirthdayForm button[type="submit"]', dialog:'#clientBirthdayDialog', rpc:'save_minuta_client_birthday_v119', keys:['p_organization','p_client_phone','p_birthday'] },
  block:{ button:'#clientBlockConfirm', dialog:'#clientBlockDialog', rpc:'set_minuta_client_online_booking_block_v135', keys:['p_organization','p_client_phone','p_blocked','p_reason'] }
};
function setup(action) {
  const f = make(), gates = [], listeners = new Map();
  f.box.db.rpc = (name, parameters) => {
    assert.equal(name, controls[action].rpc);
    assert.deepEqual(Object.keys(parameters), controls[action].keys);
    const gate = deferred();
    f.calls.push({ name, parameters }); gates.push(gate); return gate.promise;
  };
  if (action === 'birthday') {
    f.box.document = { addEventListener:(type, handler) => { assert.equal(type, 'click'); listeners.set(type, handler); } };
    f.box.gestureClickSuppressedUntil = 0;
    vm.runInContext(openBirthday + '\n' + wholeClickListener, f.box, { filename:'exact-whole-shared-click-listener.js', timeout:1000 });
    f.node('#clientBirthdayDialog').showModal = function () { this.open = true; };
  }
  const reply = (index, error = false) => {
    if (error) return { data:null, error:{ code:'42501', message:'Synthetic refusal' } };
    const p = f.calls[index].parameters;
    return { data:{ client_phone:action === 'identity' ? p.p_new_client_phone : p.p_client_phone,
      client_name:p.p_client_name || 'Synthetic current', birthday:p.p_birthday,
      online_booking_blocked:p.p_blocked, supports_block_reason:true, can_edit:true, can_manage_block:true }, error:null };
  };
  return { f, gates, listeners, reply, button:f.node(controls[action].button) };
}
function assertCurrentApplied(action, f, clear = false) {
  assert.equal(f.notices.length, 1);
  assert.equal(f.node(controls[action].dialog).open, false);
  if (action === 'identity') assert.equal(f.box.selectedClientPhone, f.newPhone);
  if (action === 'birthday') assert.equal(f.box.clientProfileDetailsState.birthday, clear ? '' : '1980-01-02');
  if (action === 'block') assert.equal(f.box.clientProfileDetailsState.onlineBookingBlocked, true);
}
const cases = [];
function run(action, scenario, evaluate) {
  test('client button owner ' + action + ': ' + scenario, async () => {
    const record = { action, scenario, status:'PASS', observed:null };
    try { await evaluate(value => { record.observed = value; }); }
    catch (error) { record.status = 'FAIL'; record.failure = 'OWN_EXPECTATION_NOT_MET'; throw error; }
    finally { cases.push(record); }
  });
}

  for (const action of ['identity', 'birthday', 'block']) {
    run(action, 'ordinary-current-success', async observe => {
      const c = setup(action), pending = c.f.invoke(action);
      assert.equal(c.f.calls.length, 1); assert.equal(c.button.disabled, true);
      c.gates[0].resolve(c.reply(0)); await pending;
      observe({ requestCount:c.f.calls.length, buttonDisabled:c.button.disabled, successNotices:c.f.notices.length });
      assert.equal(c.button.disabled, false); assertCurrentApplied(action, c.f);
    });
    run(action, 'ordinary-current-server-refusal', async observe => {
      const c = setup(action), state = c.f.box.clientProfileDetailsState, pending = c.f.invoke(action);
      assert.equal(c.button.disabled, true); c.gates[0].resolve(c.reply(0, true)); await pending;
      const feedback = action === 'identity' ? c.f.node('#clientIdentityError').textContent : c.f.notices[0];
      observe({ requestCount:c.f.calls.length, buttonDisabled:c.button.disabled, draftReferencePreserved:c.f.box.clientProfileDetailsState === state, dialogOpen:c.f.node(controls[action].dialog).open, currentErrorFeedback:Boolean(feedback) });
      assert.equal(c.f.calls.length, 1); assert.equal(c.button.disabled, false);
      assert.equal(c.f.box.clientProfileDetailsState, state); assert.equal(c.f.node(controls[action].dialog).open, true);
      assert(feedback); assert.equal(c.f.notices.length, action === 'identity' ? 0 : 1);
    });
    run(action, 'stale-no-new-owner-releases-and-explicit-reuse', async observe => {
      const c = setup(action), old = c.f.invoke(action);
      c.f.choose(); const currentBefore = c.f.view();
      assert.equal(c.button.disabled, true); c.gates[0].resolve(c.reply(0)); await old;
      const afterStale = c.f.view(), released = !c.button.disabled, callsBeforeExplicitReuse = c.f.calls.length;
      assert.deepEqual(afterStale, currentBefore); assert(released); assert.equal(callsBeforeExplicitReuse, 1);
      const current = c.f.invoke(action); assert.equal(c.button.disabled, true);
      c.gates[1].resolve(c.reply(1)); await current;
      observe({ staleCurrentStatePreserved:true, staleOwnerReleased:released, callsBeforeExplicitReuse, callsAfterExplicitReuse:c.f.calls.length, buttonDisabledAfterCurrent:c.button.disabled });
      assert.equal(c.f.calls.length, 2); assert.equal(c.button.disabled, false); assertCurrentApplied(action, c.f);
    });
    run(action, 'late-old-ack-cannot-release-new-owner', async observe => {
      const c = setup(action), f = c.f, old = f.invoke(action);
      f.node(controls[action].dialog).close(); f.choose();
      let current;
      if (action === 'birthday') {
        f.box.openClientBirthdayDialog();
        const clear = f.node('#clientBirthdayClear');
        clear.closest = selector => selector === '#clientBirthdayClear' ? clear : null;
        assert.equal(clear.disabled, false); assert.equal(c.button.disabled, true);
        current = c.listeners.get('click')({ target:clear, preventDefault() {}, stopPropagation() {} });
        assert.equal(f.calls[1].parameters.p_birthday, null);
      } else current = f.invoke(action); // Explicit synthetic public-handler overlap; native reachability is not claimed.
      assert.equal(f.calls.length, 2); assert.equal(f.calls[1].parameters.p_client_phone, f.phoneB);
      const pendingSnapshot = f.view(); c.gates[0].resolve(c.reply(0)); await old;
      const disabledAfterOldAck = c.button.disabled, preserved = JSON.stringify(f.view()) === JSON.stringify(pendingSnapshot);
      let explicitEnabledReentry = null;
      if (!c.button.disabled) explicitEnabledReentry = f.invoke(action);
      const callsAfterEnabledReentry = f.calls.length;
      // Drain every synthetic operation before checking the key expectation.
      c.gates[1].resolve(c.reply(1)); await current;
      if (explicitEnabledReentry) { c.gates[2].resolve(c.reply(2)); await explicitEnabledReentry; }
      observe({ wholeSharedClickListener:action === 'birthday', publicHandlerSyntheticOverlap:action !== 'birthday', callsBeforeOldAck:2, disabledAfterOldAck, pendingCurrentStatePreserved:preserved, callsAfterEnabledReentry, buttonDisabledAfterCurrent:c.button.disabled });
      assert.equal(disabledAfterOldAck, true); assert.equal(callsAfterEnabledReentry, 2); assert(preserved);
      assert.equal(c.button.disabled, false); assertCurrentApplied(action, f, action === 'birthday');
    });
  }

test.after(() => {
  const observations = option('observations');
  if (!observations) return;
  const passed = cases.filter(value => value.status === 'PASS').length;
  const result = {
    format:'eldion-client-profile-button-owner-noio-proof-v1',
    status:passed === cases.length ? 'PASS_FOCUSED_SOURCE_NOIO' : 'EXPECTED_GUARDS_NOT_MET',
    source:{ path:sourcePath, bytes:raw.length, sha256:digest },
    sourceSeams:{ clientFunctionsSha256:sha(clientSource), ownerBootstrapSha256:sha(ownerBootstrap), wholeSharedClickListenerSha256:sha(wholeClickListener), openBirthdaySha256:sha(openBirthday) },
    cases, counts:{ total:cases.length, passed, failed:cases.length-passed },
    invariants:{ fourRpcNamesAndPayloadExpressionsByteEqual:true, candidateFullSourceParsedWithoutExecution:true, actualOwnerBootstrapExecuted:true },
    limits:{ actualExtractedHandlers:true, birthdayWholeSharedClickListener:true, identityAndBlockOverlap:'SYNTHETIC_PUBLIC_HANDLER_CONTRACT_ONLY_NATIVE_CLICK_REACHABILITY_UNPROVEN', stateDomRpcDoubles:true, providerBootstrap:false, productWrites:0, actualRpc:0, actualStorage:0, network:0, privateReads:0, sql:0, browser:0, native:0, autoResend:0, thrownTransportOutcome:'NOT_QUALIFIED_UNCHANGED' }
  };
  writeFileSync(observations, JSON.stringify(result, null, 2) + '\n', { flag:'wx' });
});
