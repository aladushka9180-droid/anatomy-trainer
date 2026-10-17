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
const spans = [];
function between(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'exact Source anchors required');
  const body = source.slice(a, b);
  spans.push({ startLine:source.slice(0, a).split('\n').length, bytes:Buffer.byteLength(body), sha256:createHash('sha256').update(body).digest('hex') });
  return body;
}
const clientSource = [
  between('function normalizePhone(value)', 'function clientAvatar(phone)'),
  between('function normalizedClientProfileDetails(', 'async function loadClientProfileDetails('),
  between('function moveClientMapEntry(', 'async function saveClientIdentity('),
  between('async function saveClientIdentity(', 'function openClientBlockConfirmation('),
  between('async function confirmClientOnlineBlock(', 'function resetClientProfileReturnContext(')
].join('\n');
const ownerBootstrap = between('const clientProfileWriteOwners = new WeakMap();', 'async function saveClientIdentity(');
assert.ok(ownerBootstrap.includes('function beginClientProfileWrite(button) {'), 'real owner begin helper required');
assert.ok(ownerBootstrap.includes('function releaseClientProfileWrite(button, operation) {'), 'real owner release helper required');
assert.ok(clientSource.includes(ownerBootstrap), 'execute the exact WeakMap and helpers from provider Source');
const waitlistSource = between('async function loadWaitlist()', "document.addEventListener('pointerdown'");
const clickSource = between("document.addEventListener('click', async event => {\n  if (event.target.closest('#newBookingServiceOpen'))", "document.addEventListener('change', async event => {");
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const cases = [];
function record(name, expected, actual) { cases.push({ name, expected, actual }); }

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

for (const action of ['identity','birthday','block']) {
  for (const transition of ['organization','selection','session']) test('clients ' + action + ': late response preserves new ' + transition + ' context', async () => {
    const f = clientFixture(), pending = f.invoke(action); assert.equal(f.calls.length, 1);
    f.choose(transition === 'organization' ? { organization:'synthetic-organization-B', phone:f.phoneA } : transition === 'session' ? { user:'synthetic-user-B', phone:f.phoneA } : {});
    const before = f.view(); f.outcome.resolve(f.response(action)); await pending; const after = f.view();
    record('client-' + action + '-' + transition, before, after); assert.deepEqual(after, before);
  });
  test('clients ' + action + ': ordinary current success remains effective', async () => {
    const f = clientFixture(), pending = f.invoke(action); f.outcome.resolve(f.response(action)); await pending;
    assert.equal(f.calls.length, 1); assert.equal(f.notices.length, 1);
    assert.equal(f.node(action === 'identity' ? '#clientIdentityDialog' : action === 'birthday' ? '#clientBirthdayDialog' : '#clientBlockDialog').open, false);
    if (action === 'identity') assert.equal(f.box.selectedClientPhone, f.newPhone);
    if (action === 'birthday') assert.equal(f.box.clientProfileDetailsState.birthday, '1980-01-02');
    if (action === 'block') assert.equal(f.box.clientProfileDetailsState.onlineBookingBlocked, true);
  });
  test('clients ' + action + ': ordinary server refusal preserves the draft', async () => {
    const f = clientFixture(), initial = f.box.clientProfileDetailsState, pending = f.invoke(action); f.outcome.resolve(f.response(action, true)); await pending;
    assert.equal(f.calls.length, 1); assert.equal(f.box.clientProfileDetailsState, initial);
    assert.equal(f.node(action === 'identity' ? '#clientIdentityDialog' : action === 'birthday' ? '#clientBirthdayDialog' : '#clientBlockDialog').open, true);
  });
}

function waitlistFixture() {
  const reads = [], writes = [], renders = [], notices = [], listeners = new Map();
  const box = { Date, currentUser:{ id:'synthetic-user-A' }, sessionGeneration:1, activeOrganization:{ id:'synthetic-organization-A' },
    waitlistRequests:[], waitlistLoaded:false, waitlistRemoteAvailable:false, waitlistLoadRevision:0, gestureClickSuppressedUntil:0,
    organizationController:{ getActiveOrganization:() => box.activeOrganization }, bookingUsesDemoData:() => false,
    requireWrites:() => true, notify:message => notices.push(message),
    renderWaitlist:() => renders.push(box.waitlistRequests.map(row => row.id)),
    document:{ addEventListener:(name, listener) => { assert.equal(name,'click'); listeners.set(name, listener); } },
    db:{ from(table) {
      const gate = deferred(), row = { table, gate, filters:[] }; reads.push(row);
      const chain = { select() { return this; }, eq(k,v) { row.filters.push([k,v]); return this; }, in() { return this; }, order() { return this; }, then(a,b) { return gate.promise.then(a,b); } };
      return chain;
    }, rpc:async (name, parameters) => { const gate = deferred(); writes.push({ name, parameters, gate }); return gate.promise; } }
  };
  box.sessionIsCurrent = (id, generation) => box.currentUser?.id === id && box.sessionGeneration === generation;
  vm.createContext(box); vm.runInContext(waitlistSource + '\n' + clickSource, box, { filename:'frozen-waitlist-and-full-click-listener.js', timeout:1000 });
  const flush = async () => { for (let i=0; i<6; i++) await Promise.resolve(); };
  const data = ids => ids.map(id => ({ id, desired_date:'2026-10-20', created_at:'2026-10-17T00:00:00Z', status:'waiting' }));
  function click() {
    const card = { dataset:{ waitlistScope:'personal' } }, button = { disabled:false, dataset:{ waitlistId:'synthetic-request', waitlistStatus:'booked' }, closest:selector => selector === '[data-waitlist-scope]' ? card : null };
    return listeners.get('click')({ target:{ closest:selector => selector === '[data-waitlist-status]' ? button : null }, preventDefault() {}, stopPropagation() {} });
  }
  return { box, reads, writes, renders, notices, flush, data, click,
    snapshot:() => JSON.parse(JSON.stringify({ ids:box.waitlistRequests.map(row => row.id), loaded:box.waitlistLoaded, available:box.waitlistRemoteAvailable, renders, notices })) };
}

for (const oldResult of ['success','error']) test('waitlist: old same-scope ' + oldResult + ' cannot replace a newer completed load', async () => {
  const f = waitlistFixture(), old = f.box.loadWaitlist(), current = f.box.loadWaitlist();
  assert.equal(f.reads.length, 2); f.reads[1].gate.resolve({ data:f.data(['synthetic-current']), error:null }); await f.flush();
  assert.equal(f.reads.length, 3); f.reads[2].gate.resolve({ data:[],error:null }); await current;
  const before = f.snapshot();
  f.reads[0].gate.resolve(oldResult === 'success' ? { data:f.data(['synthetic-stale']),error:null } : { data:null,error:{ code:'SYNTHETIC_FAILURE' } }); await f.flush();
  assert.equal(f.reads.length, 4); f.reads[3].gate.resolve({ data:[],error:null }); await old;
  const after = f.snapshot(); record('waitlist-load-' + oldResult, before, after); assert.deepEqual(after, before);
});

for (const transition of ['current','organization','session']) test('waitlist load existing ' + transition + ' guard control', async () => {
  const f = waitlistFixture(), pending = f.box.loadWaitlist();
  if (transition === 'organization') f.box.activeOrganization = { id:'synthetic-organization-B' };
  if (transition === 'session') { f.box.currentUser = { id:'synthetic-user-B' }; f.box.sessionGeneration++; }
  f.reads[0].gate.resolve({ data:f.data(['synthetic-row']),error:null }); await f.flush();
  f.reads[1].gate.resolve({ data:[],error:null }); const result = await pending;
  assert.deepEqual(Array.from(f.box.waitlistRequests, row=>row.id), transition === 'current' ? ['synthetic-row'] : []);
  assert.equal(Boolean(result.stale), transition !== 'current');
});

for (const transition of ['organization','session']) test('waitlist status: late old-context acknowledgement publishes no new-context feedback or reload', async () => {
  const f = waitlistFixture(), pending = f.click(); assert.equal(f.writes.length, 1);
  if (transition === 'organization') f.box.activeOrganization = { id:'synthetic-organization-B' };
  else { f.box.currentUser = { id:'synthetic-user-B' }; f.box.sessionGeneration++; }
  f.writes[0].gate.resolve({ error:null }); await f.flush();
  const effects = { notifications:f.notices.length, newContextReads:f.reads.length };
  // Drain only synthetic calls so a failing expectation does not leave promises pending.
  if (f.reads[0]) { f.reads[0].gate.resolve({ data:[],error:null }); await f.flush(); }
  if (f.reads[1]) f.reads[1].gate.resolve({ data:[],error:null }); await pending;
  record('waitlist-status-' + transition, { notifications:0, newContextReads:0 }, effects);
  assert.deepEqual(effects, { notifications:0, newContextReads:0 });
});

test.after(() => {
  const observations = option('observations');
  if (!observations) return;
  writeFileSync(observations, JSON.stringify({ sourcePath, sourceBytes:raw.length, sourceSha256:digest, spans, cases,
    limits:'Actual extracted handlers/owner bootstrap/full shared click listener with synthetic state, DOM, reads and writes. No provider bootstrap, Browser, storage or product transport.' }, null, 2) + '\n', { flag:'wx' });
});
