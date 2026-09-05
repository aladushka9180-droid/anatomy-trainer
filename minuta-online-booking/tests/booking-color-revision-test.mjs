import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// Actual full quick-color change listener, saveBookingColor and persistence.
// DOM, Map-backed localStorage and deferred RPC are explicit VM boundaries.
// These assertions cover LOCAL latest-intent/pending/toast ownership only:
// no SQL ordering, remote last-write-wins, retry or production proof.
const source = readFileSync(process.env.MINUTA_PROVIDER_SOURCE || new URL('../provider.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
function between(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Missing actual source boundary: ${start}`);
  return source.slice(from, to);
}
const actual = between('function bookingColorStorageKey(', 'function bookingNoteStorageKey(')
  + between('function captureBookingMetadataContext(', 'async function saveBookingNote(')
  + between("document.addEventListener('change', async event => {", "document.addEventListener('keydown', event => {");
const declarations = ['BOOKING_COLOR_KEYS', 'BOOKING_COLOR_DEFAULT'].map(name => {
  const declaration = source.match(new RegExp(`^const ${name} = .*;$`, 'm'))?.[0];
  assert.ok(declaration, name); return declaration;
}).join('\n') + '\n' + source.match(/^let bookingMetadataRevision = .*;$/m)[0];
const actor = '11111111-1111-4111-8111-111111111111';
const first = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const second = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const observe = promise => promise.then(value => ({ value, error:null }), error => ({ error }));

function harness() {
  const storage = new Map(), effects = [], calls = [], listeners = new Map();
  const state = {
    currentUser:{ id:actor }, sessionGeneration:1, activeClientOrganizationId:'org-A', writesAllowed:true,
    bookingColors:new Map(), pendingBookingColors:new Set(), allBookings:[{ id:first }, { id:second }],
    localStorage:{ getItem:key => storage.get(key) ?? null,
      setItem:(key, value) => { storage.set(key, value); effects.push(['storage', key, value]); } },
    document:{ addEventListener:(name, handler) => listeners.set(name, handler) },
    requireWrites:() => true,
    renderBookingData:() => effects.push(['render']),
    notify:message => effects.push(['notify', message]),
    db:{ rpc:(name, params) => {
      assert.equal(name, 'set_booking_color');
      const call = { name, params:{ ...params } }; calls.push(call);
      return new Promise((resolve, reject) => { call.resolve = resolve; call.reject = reject; });
    } },
  };
  const context = vm.createContext(state);
  const session = source.match(/^function sessionIsCurrent[^\n]+/m)?.[0];
  assert.ok(session, 'actual session guard');
  vm.runInContext(declarations + '\n' + session + '\n' + actual, context);
  function start(id, color, mode = 'change') {
    if (mode === 'helper') return observe(context.saveBookingColor(id, color));
    // Journal control, outside the sheet. Unrelated branches of the full actual
    // change dispatcher receive null, not replacement handler implementations.
    const input = { value:color, dataset:{ bookingColorId:id }, isConnected:true,
      closest:selector => selector === '[data-booking-color-id]' ? input : null };
    return observe(listeners.get('change')({ target:input }));
  }
  async function settle(index, outcome, pending) {
    if (outcome === 'throw') calls[index].reject(Error('defensive unexpected rejection'));
    else calls[index].resolve(outcome === 'success' ? { data:calls[index].params.p_color, error:null }
      : { data:null, error:{ code:'08006', message:'connection_failure' } });
    return pending;
  }
  const snapshot = () => JSON.stringify({ colors:[...state.bookingColors], pending:[...state.pendingBookingColors],
    bookings:state.allBookings, storage:[...storage].sort(), effects });
  function assertLocal(id, color, pending) {
    assert.equal(state.bookingColors.get(id), color);
    assert.equal(state.allBookings.find(item => item.id === id).color_key, color);
    assert.equal(state.pendingBookingColors.has(id), pending);
    assert.equal(JSON.parse(storage.get(context.bookingColorStorageKey(actor)))[id], color);
    assert.equal(JSON.parse(storage.get(context.bookingColorPendingStorageKey(actor))).includes(id), pending);
  }
  return { state, context, effects, calls, start, settle, snapshot, assertLocal,
    notices:() => effects.filter(effect => effect[0] === 'notify').map(effect => effect[1]) };
}

for (const latestOutcome of ['success', 'error', 'throw']) {
  for (const order of ['old-first', 'latest-first']) {
    test(`same id: old success / latest ${latestOutcome}, ${order} keeps newest local intent`, async () => {
      const h = harness(), old = h.start(first, 'sky'), latest = h.start(first, 'mint');
      assert.deepEqual(h.calls.map(call => call.params), [
        { p_booking:first, p_color:'sky' }, { p_booking:first, p_color:'mint' },
      ]);
      h.assertLocal(first, 'mint', true);
      let before, after, oldResult, latestResult;
      if (order === 'old-first') {
        before = h.snapshot(); oldResult = await h.settle(0, 'success', old); after = h.snapshot();
        latestResult = await h.settle(1, latestOutcome, latest);
      } else {
        latestResult = await h.settle(1, latestOutcome, latest);
        before = h.snapshot(); oldResult = await h.settle(0, 'success', old); after = h.snapshot();
      }
      // Settle both RPCs before asserting: failing baseline leaves no fixture
      // promise unresolved and cannot hide a second completion behind teardown.
      assert.equal(oldResult.error, null); assert.equal(latestResult.error, null);
      assert.equal(after, before, 'superseded success must not clear newest pending marker, persist or toast');
      h.assertLocal(first, 'mint', latestOutcome !== 'success');
      assert.equal(h.notices().length, 1, 'only the current choice can announce its result');
      if (latestOutcome === 'success') assert.equal(h.notices()[0], 'Цвет записи сохранён');
      else assert.match(h.notices()[0], /не удалось подтвердить/i);
    });
  }
}

for (const oldOutcome of ['error', 'throw']) {
  test(`same id: old ${oldOutcome} after latest success cannot warn about the saved choice`, async () => {
    const h = harness(), old = h.start(first, 'sky'), latest = h.start(first, 'mint');
    assert.equal((await h.settle(1, 'success', latest)).error, null);
    const before = h.snapshot();
    assert.equal((await h.settle(0, oldOutcome, old)).error, null);
    assert.equal(h.snapshot(), before, 'obsolete failure must not emit a false warning');
    h.assertLocal(first, 'mint', false);
    assert.deepEqual(h.notices(), ['Цвет записи сохранён']);
  });
}

for (const [oldMode, latestMode] of [['helper', 'helper'], ['change', 'helper'], ['helper', 'change']]) {
  test(`shared ownership across ${oldMode} -> ${latestMode}, not only one caller`, async () => {
    const h = harness(), old = h.start(first, 'sky', oldMode), latest = h.start(first, 'mint', latestMode);
    const latestResult = await h.settle(1, 'error', latest), before = h.snapshot();
    const oldResult = await h.settle(0, 'success', old);
    assert.equal(latestResult.error, null); assert.equal(oldResult.error, null);
    assert.equal(h.snapshot(), before, 'helper and caller must share the booking revision');
    h.assertLocal(first, 'mint', true);
    if (oldMode === 'helper') assert.equal(oldResult.value, false);
    assert.equal(h.notices().length, latestMode === 'change' ? 1 : 0);
  });
}

for (const secondOutcome of ['success', 'error', 'throw']) {
  test(`different booking ids remain independent when second ${secondOutcome}`, async () => {
    const h = harness(), a = h.start(first, 'sky'), b = h.start(second, 'mint');
    assert.equal((await h.settle(1, secondOutcome, b)).error, null);
    h.assertLocal(first, 'sky', true); h.assertLocal(second, 'mint', secondOutcome !== 'success');
    assert.equal((await h.settle(0, 'success', a)).error, null);
    h.assertLocal(first, 'sky', false); h.assertLocal(second, 'mint', secondOutcome !== 'success');
    assert.equal(h.notices().length, 2, 'a token for one booking must not invalidate another booking');
    assert.equal(h.notices().at(-1), 'Цвет записи сохранён');
  });
}

test('single current quick-color save persists and announces success', async () => {
  const h = harness(), pending = h.start(first, 'sky');
  assert.equal((await h.settle(0, 'success', pending)).error, null);
  h.assertLocal(first, 'sky', false);
  assert.deepEqual(h.notices(), ['Цвет записи сохранён']);
});
