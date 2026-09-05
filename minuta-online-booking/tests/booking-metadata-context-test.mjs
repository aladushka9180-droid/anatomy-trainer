import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// Actual complete quick-color change listener, block-note handler, metadata
// helpers AND localStorage serialization. DOM/storage/auth transitions are local
// fixtures. No SQL/SDK/browser/production execution is claimed; rejected Promises
// are defensive unexpected exceptions, not the SDK's usual fulfilled error shape.
const source = readFileSync(process.env.MINUTA_PROVIDER_SOURCE || new URL('../provider.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function between(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Actual source boundary: ${start}`);
  return source.slice(from, to);
}
const metadata = between('function bookingColorStorageKey(', 'function bookingColor(item)')
  + between(source.includes('function captureBookingMetadataContext(')
    ? 'function captureBookingMetadataContext(' : 'async function saveBookingColor(', 'async function loadRemoteBookingColors(');
const handlers = between("document.addEventListener('change', async event => {", "document.addEventListener('keydown', event => {")
  + between('async function saveBookingBlockNote(', 'async function saveBookingSheetNote(')
  + between('async function finalizeQueuedBooking(', 'async function flushOfflineBookings(');
const constants = ['BOOKING_COLOR_KEYS', 'BOOKING_COLOR_DEFAULT']
  .map(name => source.match(new RegExp(`^const ${name} = .*;$`, 'm'))?.[0]).join('\n');
const lifecycleDeclarations = ['bookingMetadataRevision', 'bookingEditorRevision', 'bookingSeriesCancellationRevision']
  .map(name => source.match(new RegExp(`^let ${name} = .*;$`, 'm'))?.[0] || '').join('\n');
const resetHooks = [...source.matchAll(/^window\.addEventListener\('minuta:provider-session-reset', \(\) => (?:\{[\s\S]*?^\}\);|[^\n]*\);)/gm)]
  .map(match => match[0]).join('\n');
const orgHook = between('  onActiveOrganizationChange: organization => {', '    if (clientOrganizationChanged) {')
  .replace('  onActiveOrganizationChange: organization => {', 'function changeOrganization(organization) {') + '\n}';
const ids = { A:'11111111-1111-4111-8111-111111111111', B:'22222222-2222-4222-8222-222222222222' };
const booking = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', otherBooking = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const success = { data:true, error:null }, failure = { data:null, error:{ code:'42501', message:'booking_access_denied' } };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const observe = promise => promise.then(value => ({ value, error:null }), error => ({ error }));

function harness() {
  const gate = deferred(), effects = [], storage = new Map(), listeners = new Map();
  const resetListeners = [];
  const nodes = {};
  const createNodes = () => {
    nodes.sheet = { hidden:false, dataset:{ bookingId:booking } };
    const form = { dataset:{ bookingId:booking }, button:{ disabled:false, textContent:'Сохранить заметку' } };
    Object.defineProperty(form, 'isConnected', { get:() => nodes.form === form });
    nodes.form = form; nodes.note = { value:'Заметка аккаунта A' }; nodes.state = { textContent:'Добавить' };
    const color = { dataset:{ bookingColorId:booking }, value:'sky',
      closest:selector => selector === '[data-booking-color-id]' ? color : null };
    Object.defineProperty(color, 'isConnected', { get:() => nodes.color === color });
    nodes.color = color;
  };
  createNodes();
  const state = {
    currentUser:{ id:ids.A }, sessionGeneration:1, activeClientOrganizationId:'org-A', writesAllowed:true,
    window:{ addEventListener:(name, listener) => { if (name === 'minuta:provider-session-reset') resetListeners.push(listener); } },
    freeSlotsController:{ invalidateScope(){} }, providerReadFetch:{ cancelPendingReads(){} },
    bookingColors:new Map(), pendingBookingColors:new Set(), bookingNotes:new Map(), pendingBookingNotes:new Set(),
    allBookings:[{ id:booking }], clientNotes:new Map(), offlineBookingQueue:[],
    localStorage:{ getItem:key => storage.get(key) ?? null,
      setItem:(key, value) => { effects.push(['storage', key, value]); storage.set(key, value); } },
    $:selector => ({ '#bookingSheet':nodes.sheet, '#bookingBlockNoteForm':nodes.form,
      '#bookingBlockNote':nodes.note, '.booking-note-state':nodes.state })[selector],
    document:{ addEventListener:(name, callback) => listeners.set(name, callback), contains:node => node?.isConnected === true },
    requireWrites:() => true, renderBookingData:() => effects.push(['render']), notify:message => effects.push(['notify', message]),
    db:{ rpc:(name, params) => { effects.push(['rpc', name, JSON.parse(JSON.stringify(params))]); return gate.promise.then(result => result === success ? {data:params.p_note ?? params.p_color,error:null} : result); } },
    normalizePhone:String,
    deliverTelegramClientNotification:async () => ({ delivered:true, retryable:false }),
    stageOfflineBookingProviderNotice:() => null,
    saveOfflineBookingQueue:async () => effects.push(['saveQueue']),
    renderOfflineBookingQueue:() => effects.push(['renderQueue']), deliverOfflineBookingProviderNotice(){}
  };
  const context = vm.createContext(state);
  vm.runInContext(constants + '\n' + lifecycleDeclarations + '\n' + resetHooks + '\n' + orgHook
    + '\n' + source.match(/^function sessionIsCurrent[^\n]+/m)[0]
    + '\n' + metadata + '\n' + handlers, context);
  const replaceContext = (account = ids.B) => {
    state.currentUser = { id:account }; state.sessionGeneration += 1;
    state.activeClientOrganizationId = 'org-B';
    state.allBookings = [{ id:booking, color_key:'mint', provider_note:'B note' }];
    // Use the actual production load helpers after switching identity. The same
    // booking UUID marker deliberately probes isolation even for overlapping data.
    storage.set(context.bookingColorStorageKey(), JSON.stringify({ [booking]:'mint' }));
    storage.set(context.bookingColorPendingStorageKey(), JSON.stringify([booking]));
    storage.set(context.bookingNoteStorageKey(), JSON.stringify({ [otherBooking]:'B note' }));
    storage.set(context.bookingNotePendingStorageKey(), JSON.stringify([otherBooking]));
    context.loadBookingColors(); context.loadBookingNotes(); createNodes();
    nodes.note.value = 'B note';
  };
  const snapshot = () => JSON.stringify({ storage:[...storage].sort(), colors:[...state.bookingColors],
    colorPending:[...state.pendingBookingColors], notes:[...state.bookingNotes], notePending:[...state.pendingBookingNotes],
    bookings:state.allBookings, marker:nodes.state.textContent, button:nodes.form.button });
  const start = kind => kind === 'color'
    ? observe(listeners.get('change')({ target:nodes.color }))
    : observe(context.saveBookingBlockNote({ preventDefault(){}, currentTarget:nodes.form, submitter:nodes.form.button }));
  return { state, context, gate, effects, storage, nodes, replaceContext, snapshot, start,
    reset:() => resetListeners.forEach(listener => listener()) };
}

test('same-account quick color persists actual keys and confirms remote success', async () => {
  const h = harness(); const pending = h.start('color'); h.gate.resolve(success);
  assert.equal((await pending).error, null);
  assert.equal(h.storage.get(h.context.bookingColorStorageKey(ids.A)), JSON.stringify({ [booking]:'sky' }));
  assert.equal(h.storage.get(h.context.bookingColorPendingStorageKey(ids.A)), '[]');
  assert.deepEqual(h.effects.at(-1), ['notify', 'Цвет записи сохранён']);
});

for (const reply of [success, failure]) {
  test(`same-account block note keeps ${reply.error ? 'local fallback' : 'remote success'} semantics`, async () => {
    const h = harness(); const pending = h.start('note'); h.gate.resolve(reply);
    assert.equal((await pending).error, null); assert.equal(h.nodes.form.button.disabled, false);
    assert.equal(h.storage.get(h.context.bookingNoteStorageKey(ids.A)), JSON.stringify({ [booking]:'Заметка аккаунта A' }));
    assert.equal(h.state.pendingBookingNotes.has(booking), Boolean(reply.error));
    assert.deepEqual(h.effects.at(-1), ['notify', reply.error ? 'Заметка сохранена на этом устройстве' : 'Заметка сохранена']);
  });
}

for (const kind of ['color', 'note']) {
  for (const outcome of ['success', 'error', 'throw']) {
    test(`${kind} late ${outcome} must not mutate or notify account B`, async () => {
      const h = harness(); const pending = h.start(kind);
      assert.equal(h.effects.filter(e => e[0] === 'rpc').length, 1);
      h.replaceContext(); const before = h.snapshot(), count = h.effects.length;
      if (outcome === 'throw') h.gate.reject(Error('unexpected transport rejection'));
      else h.gate.resolve(outcome === 'success' ? success : failure);
      const result = await pending;
      assert.equal(result.error, null, 'event handler must handle unexpected rejection');
      assert.equal(h.snapshot(), before, 'new account maps, pending markers, storage and note UI remain unchanged');
      assert.deepEqual(h.effects.slice(count), [], 'no old persistence or notification after switch');
    });
  }
}

for (const kind of ['color', 'note']) {
  test(`${kind} same-account new session also owns replacement maps`, async () => {
    const h = harness(); const pending = h.start(kind); h.replaceContext(ids.A);
    const before = h.snapshot(), count = h.effects.length;
    h.gate.resolve(kind === 'color' ? success : failure); assert.equal((await pending).error, null);
    assert.equal(h.snapshot(), before); assert.deepEqual(h.effects.slice(count), []);
  });
}

test('fulfilled quick-color error cannot announce remote success', async () => {
  const h = harness(); const pending = h.start('color'); h.gate.resolve(failure);
  assert.equal((await pending).error, null);
  assert.equal(h.state.pendingBookingColors.has(booking), true);
  assert.equal(h.effects.some(e => e[0] === 'notify' && e[1] === 'Цвет записи сохранён'), false);
});

test('current block-note unexpected rejection restores its submit button', async () => {
  const h = harness(); const pending = h.start('note'); h.gate.reject(Error('unexpected rejection'));
  assert.equal((await pending).error, null);
  assert.equal(h.nodes.form.button.disabled, false);
  assert.equal(h.nodes.form.button.textContent, 'Сохранить заметку');
});

test('queue outer session guard cannot permit helper persistence into account B', async () => {
  const h = harness(); const item = { id:'queue-A', userId:ids.A, note:'', color:'sky' };
  h.state.offlineBookingQueue = [item];
  const pending = observe(h.context.finalizeQueuedBooking(item, { id:booking }, ids.A, 1));
  h.replaceContext(); const before = h.snapshot(), count = h.effects.length;
  h.gate.resolve(success); const result = await pending;
  assert.equal(result.error, null); assert.equal(result.value, false);
  assert.equal(h.snapshot(), before); assert.deepEqual(h.effects.slice(count), []);
});

for (const kind of ['color', 'note']) {
  for (const change of ['org-roundtrip', 'session-reset']) {
    test(`${kind} actual ${change} invalidates old completion without changing account id`, async () => {
      const h = harness(); const pending = h.start(kind);
      if (change === 'org-roundtrip') {
        h.context.changeOrganization({ id:'org-B' }); h.context.changeOrganization({ id:'org-A' });
      } else h.reset();
      const before = h.snapshot(), count = h.effects.length;
      h.gate.resolve(success); assert.equal((await pending).error, null);
      assert.equal(h.snapshot(), before); assert.deepEqual(h.effects.slice(count), []);
    });
  }
  test(`${kind} same-organization refresh does not invalidate current save`, async () => {
    const h = harness(); const pending = h.start(kind); h.context.changeOrganization({ id:'org-A' });
    h.gate.resolve(success); assert.equal((await pending).error, null);
    assert.equal(h.effects.at(-1)[0], 'notify');
    assert.match(h.effects.at(-1)[1], /сохран[её]н/);
  });
}

test('quick color survives its own journal control replacement', async () => {
  const h = harness(); const original = h.nodes.color;
  h.state.renderBookingData = () => { h.nodes.color = { isConnected:true }; };
  const pending = h.start('color'); assert.equal(original.isConnected, false);
  h.gate.resolve(success); assert.equal((await pending).error, null);
  assert.equal(h.state.pendingBookingColors.has(booking), false);
  assert.deepEqual(h.effects.at(-1), ['notify', 'Цвет записи сохранён']);
});

test('block-note duplicate submit sends a single RPC', async () => {
  const h = harness(); const pending = h.start('note'); const duplicate = h.start('note');
  const rpcCount = h.effects.filter(e => e[0] === 'rpc').length;
  h.gate.resolve(success); assert.equal((await pending).error, null); assert.equal((await duplicate).error, null);
  assert.equal(rpcCount, 1);
});

for (const helper of ['saveBookingColor', 'saveBookingNote']) {
  test(`${helper} combines intrinsic ownership with an explicit permissive caller guard`, async () => {
    const h = harness(); const pending = observe(h.context[helper](booking, 'sky', { rerender:false, isCurrent:() => true }));
    h.replaceContext(); const before = h.snapshot(), count = h.effects.length;
    h.gate.resolve(success); assert.equal((await pending).value, false);
    assert.equal(h.snapshot(), before); assert.deepEqual(h.effects.slice(count), []);
  });
  test(`${helper} respects editor-style restrictive guard before local or remote writes`, async () => {
    const h = harness(); const before = h.snapshot();
    assert.equal(await h.context[helper](booking, 'sky', { rerender:false, isCurrent:() => false }), false);
    assert.equal(h.snapshot(), before); assert.deepEqual(h.effects, []);
  });
  test(`${helper} rejects replacement maps even with unchanged account/session/org`, async () => {
    const h = harness(); const pending = observe(h.context[helper](booking, 'sky', { rerender:false }));
    h.replaceContext(ids.A); h.state.sessionGeneration = 1; h.state.activeClientOrganizationId = 'org-A';
    const before = h.snapshot(), count = h.effects.length;
    h.gate.resolve(failure); assert.equal((await pending).value, false);
    assert.equal(h.snapshot(), before); assert.deepEqual(h.effects.slice(count), []);
  });
}
