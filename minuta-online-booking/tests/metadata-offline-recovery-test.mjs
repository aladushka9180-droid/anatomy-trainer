import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// Actual helpers/local persistence; synthetic transport and UI, no real writes.
const source = readFileSync(process.env.MINUTA_PROVIDER_SOURCE || new URL('../provider.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
function section(first, last) {
  const start = source.indexOf(first), end = source.indexOf(last, start);
  assert.ok(start >= 0 && end > start, first);
  return source.slice(start, end);
}
const actual = section('function clientLabelStorageKey(', 'function clientLabel(phone)')
  + section('function bookingColorStorageKey(', 'function bookingColor(item)')
  + section('function captureBookingMetadataContext(', 'async function loadRemoteBookingColors(')
  + section('async function persistClientLabelValue(', 'async function saveClientLabels(');
const display = source.match(/^function bookingColor\(item\).*$/m)[0]
  + '\n' + section('function bookingDisplayNote(', 'function bookingSeriesMarkup(');
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(storage = new Map()) {
  const calls = [], notices = [];
  const state = {
    currentUser:{ id:'actor-A' }, sessionGeneration:1, activeClientOrganizationId:'org-A', bookingMetadataRevision:0,
    bookingColors:new Map(), pendingBookingColors:new Set(), bookingNotes:new Map(), pendingBookingNotes:new Set(),
    clientLabels:new Map(), pendingClientLabels:new Set(), clientLabelSaveQueues:new Map(),
    clientNotes:new Map(), pendingClientNotes:new Map(), normalizePhone:value => String(value || '').replace(/\D/g,''),
    allBookings:[{ id:'booking-A', organization_id:'org-A' }], navigator:{ onLine:true }, writesAllowed:true,
    BOOKING_COLOR_KEYS:['auto','sky','mint'], BOOKING_COLOR_DEFAULT:'auto',
    localStorage:{ getItem:key => storage.get(key) ?? null, setItem:(key, value) => storage.set(key, value) },
    renderBookingData() {}, refreshClientLabelPresentation() {}, notify:message => notices.push(message),
    isScheduleBlock:() => true,
    sessionIsCurrent:(id, generation) => id === state.currentUser?.id && generation === state.sessionGeneration,
    db:{ rpc:(name, params) => dispatch(name, params), from:name => ({upsert:params => dispatch(name, params)}) }
  };
  function dispatch(name, params) {
    return new Promise((resolve, reject) => calls.push({name,params,resolve,reject}));
  }
  const context = vm.createContext(state);
  vm.runInContext(actual + display, context);
  context.loadBookingColors(); context.loadBookingNotes(); context.loadLocalClientLabels();
  context.loadPendingClientNotes?.();
  return { state, context, storage, calls, notices };
}
const ack = call => call.resolve({data:call.params.p_note ?? call.params.p_color ?? null,error:null});
test('note is marked pending durably BEFORE transport acknowledgement', async () => {
  const h = fixture();
  const saving = h.context.saveBookingNote('booking-A', 'Новая заметка');
  assert.deepEqual(JSON.parse(h.storage.get(h.context.bookingNotePendingStorageKey())), ['booking-A']);
  assert.equal(JSON.parse(h.storage.get(h.context.bookingNoteStorageKey()))['booking-A'], 'Новая заметка');
  ack(h.calls[0]); assert.equal(await saving, true);
  assert.equal(h.state.pendingBookingNotes.size, 0);
});
test('thrown RPC and null envelope keep a durable note for retry', async () => {
  for (const kind of ['throw','null','error']) {
    const h = fixture(), saving = h.context.saveBookingNote('booking-A', 'Заметка');
    if (kind === 'throw') h.calls[0].reject(new Error('network'));
    else h.calls[0].resolve(kind === 'null' ? null : {data:null,error:{message:'network'}});
    assert.equal(await saving, false);
    assert.ok(h.state.pendingBookingNotes.has('booking-A'));
    const reopened = fixture(h.storage);
    assert.ok(reopened.state.pendingBookingNotes.has('booking-A'));
    assert.equal(reopened.state.bookingNotes.get('booking-A'), 'Заметка');
  }
});
test('offline clears no pending data and does not call the server', async () => {
  const h = fixture(); h.state.navigator.onLine = false;
  assert.equal(await h.context.saveBookingNote('booking-A', ''), false);
  assert.equal(await h.context.saveBookingColor('booking-A', 'mint'), false);
  assert.equal(h.calls.length, 0);
  assert.ok(h.state.pendingBookingNotes.has('booking-A'));
  assert.ok(h.state.pendingBookingColors.has('booking-A'));
});
test('reopened session replays persisted color, empty note and labels', async () => {
  const h = fixture(); h.state.navigator.onLine = false;
  await h.context.saveBookingColor('booking-A','mint');
  await h.context.saveBookingNote('booking-A','');
  await h.context.persistClientLabelValue('79990000000',{vip:true},null);
  const reopened = fixture(h.storage);
  const flushing = reopened.context.flushPendingMetadata();
  await tick(); assert.equal(reopened.calls[0].name,'set_booking_color'); ack(reopened.calls[0]);
  await tick(); assert.equal(reopened.calls[1].params.p_note,''); ack(reopened.calls[1]);
  await tick(); assert.equal(reopened.calls[2].params.performer_id,'actor-A'); ack(reopened.calls[2]);
  assert.equal(await flushing,true);
  assert.equal(reopened.state.pendingBookingNotes.size + reopened.state.pendingBookingColors.size + reopened.state.pendingClientLabels.size,0);
});
test('background replay waits for dispatched write; superseded edit remains latest', async () => {
  const h=fixture(), first=h.context.saveBookingNote('booking-A','one');
  const flushing=h.context.flushPendingMetadata();
  await tick(); assert.equal(h.calls.length,1);
  const newer=h.context.saveBookingNote('booking-A','two');
  assert.equal(h.state.bookingNotes.get('booking-A'),'two');
  assert.equal(h.calls.length,1);
  ack(h.calls[0]); await first; await tick();
  assert.equal(h.calls.length,2); assert.equal(h.calls[1].params.p_note,'two');
  ack(h.calls[1]); assert.equal(await newer,true); await flushing;
  assert.equal(h.state.bookingNotes.get('booking-A'),'two');
});
test('new edit waits for in-flight replay and old reply cannot clear it', async () => {
  const h=fixture(); h.state.navigator.onLine=false;
  await h.context.saveBookingColor('booking-A','sky'); h.state.navigator.onLine=true;
  const flush=h.context.flushPendingMetadata(); await tick();
  const newer=h.context.saveBookingColor('booking-A','mint');
  assert.equal(h.calls.length,1); ack(h.calls[0]); await tick();
  assert.ok(h.state.pendingBookingColors.has('booking-A'));
  assert.equal(h.calls[1].params.p_color,'mint'); ack(h.calls[1]);
  assert.equal(await newer,true); await flush;
});
test('account switch while replay queued never sends the old payload under new auth', async () => {
  const h=fixture(), original=h.context.saveBookingNote('booking-A','private A');
  const flush=h.context.flushPendingMetadata();
  h.state.currentUser={id:'actor-B'}; h.state.sessionGeneration++;
  h.state.bookingNotes=new Map(); h.state.pendingBookingNotes=new Set();
  ack(h.calls[0]); assert.equal(await original,false); await flush;
  assert.equal(h.calls.length,1);
  assert.equal(h.state.bookingNotes.size,0);
  assert.ok(JSON.parse(h.storage.get(h.context.bookingNotePendingStorageKey('actor-A'))).includes('booking-A'));
});
test('organization switch stops queued dispatch and replay never includes another organization', async () => {
  const h=fixture(); h.state.navigator.onLine=false;
  await h.context.saveBookingNote('booking-A','A');
  h.state.navigator.onLine=true; h.state.activeClientOrganizationId='org-B';
  assert.equal(await h.context.flushPendingMetadata(),false);
  assert.equal(h.calls.length,0); assert.ok(h.state.pendingBookingNotes.has('booking-A'));
});
test('stale note success cannot clear newer failed note', async () => {
  const h=fixture(), old=h.context.saveBookingNote('booking-A','one'), latest=h.context.saveBookingNote('booking-A','two');
  h.calls[1].resolve({data:null,error:{message:'network'}}); assert.equal(await latest,false);
  ack(h.calls[0]); assert.equal(await old,false);
  assert.ok(h.state.pendingBookingNotes.has('booking-A')); assert.equal(h.state.bookingNotes.get('booking-A'),'two');
});
test('queued label edits are actor-scoped; rejection does not lose pending value', async () => {
  const h=fixture(), first=h.context.persistClientLabelValue('79990000000',{vip:true},null);
  await tick(); const latest=h.context.persistClientLabelValue('79990000000',{vip:false},null);
  h.calls[0].reject(new Error('network')); await first; await tick();
  assert.equal(h.calls[1].params.vip,false); h.calls[1].reject(new Error('network'));
  assert.equal(await latest,false); assert.ok(h.state.pendingClientLabels.has('79990000000'));
  const flush=h.context.flushPendingMetadata(); await tick(); ack(h.calls[2]); assert.equal(await flush,true);
});
test('read-only gate prevents all replay writes', async () => {
  const h=fixture(); h.state.pendingBookingNotes.add('booking-A'); h.state.writesAllowed=false;
  assert.equal(await h.context.flushPendingMetadata(),false); assert.equal(h.calls.length,0);
});
test('pending empty note and color override stale loaded server fields', async () => {
  const h=fixture(); h.state.navigator.onLine=false;
  await h.context.saveBookingNote('booking-A','');
  await h.context.saveBookingColor('booking-A','mint');
  assert.equal(h.context.bookingDisplayNote({id:'booking-A',provider_note:'old'}),'');
  assert.equal(h.context.bookingColor({id:'booking-A',color_key:'sky'}),'mint');
});
test('production synchronization includes replay and pending state cannot claim synced', () => {
  assert.match(source,/await flushPendingMetadata\(\)/);
  assert.match(section('function setSyncState(', 'async function manualSynchronizeProvider('), /pendingMetadata/);
});
test('client note survives rejected write and restart, including clearing text', async () => {
  for (const note of ['Важно клиенту','']) {
    const h=fixture(), saving=h.context.saveClientNoteValue('79990000000',note);
    await tick(); h.calls[0].reject(new Error('network')); assert.equal(await saving,false);
    const reopened=fixture(h.storage);
    assert.equal(reopened.state.clientNotes.get('79990000000'),note);
    const flush=reopened.context.flushPendingMetadata(); await tick();
    assert.equal(reopened.calls[0].name,'client_notes'); assert.equal(reopened.calls[0].params.note,note);
    ack(reopened.calls[0]); assert.equal(await flush,true); assert.equal(reopened.state.pendingClientNotes.size,0);
  }
});
test('queued client note never dispatches after actor change', async () => {
  const h=fixture(), first=h.context.saveClientNoteValue('79990000000','first'); await tick();
  const second=h.context.saveClientNoteValue('79990000000','second');
  h.state.currentUser={id:'actor-B'};h.state.sessionGeneration++;h.context.loadPendingClientNotes();
  ack(h.calls[0]); await first; await second;
  assert.equal(h.calls.length,1);assert.equal(h.state.clientNotes.size,0);
  assert.equal(JSON.parse(h.storage.get(h.context.pendingClientNoteStorageKey('actor-A')))['79990000000'],'second');
});
test('failed local storage plus network cannot claim a saved client note', async () => {
  const h=fixture();h.state.localStorage.setItem=()=>{throw new Error('quota');};h.state.navigator.onLine=false;
  await assert.rejects(h.context.saveClientNoteValue('79990000000','important'),/local_note_storage_unavailable/);
  assert.equal(h.state.pendingClientNotes.get('79990000000'),'important');
});
