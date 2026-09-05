import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

// Independent adversarial baseline: 078294bf376b3deb2636ec9685affc20639257ff.
// Actual provider helpers, persistence, historical note step and device cleanup.
// Synthetic transport/session/render boundaries; NOT browser, SQL or full-create E2E.
// This RED baseline is a separate acceptance artifact, not a replacement for the
// owner's 16 VM / 6 browser checks and not a green-CI entry until fixed.
const sourcePath = process.env.MINUTA_PROVIDER_SOURCE || fileURLToPath(new URL('../provider.js', import.meta.url));
const bytes = readFileSync(sourcePath);
const source = bytes.toString('utf8').replaceAll('\r\n', '\n');
console.log(`Actual provider: ${sourcePath}; SHA256=${createHash('sha256').update(bytes).digest('hex')}`);
function section(first, last) {
  const start = source.indexOf(first), end = source.indexOf(last, start);
  assert.ok(start >= 0 && end > start, `Missing actual source boundary: ${first}`);
  return source.slice(start, end);
}
const actual = section('function clientLabelStorageKey(', 'function clientLabel(phone)')
  + section('function bookingColorStorageKey(', 'function bookingColor(item)')
  + section('function captureBookingMetadataContext(', 'async function loadRemoteBookingColors(')
  + section('async function persistClientLabelValue(', 'async function saveClientLabels(');
// Starts only AFTER the acknowledged historical CREATE. Preserve the real note
// step and its guard/error/cache behavior, without inventing a second write path.
const historicalNote = section('      const normalizedPhone = normalizePhone(phone);\n      if (note) {',
  '      const colorSaved = await saveBookingColor(createdId, color, { rerender:false, isCurrent:formIsCurrent });');
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const storage = new Map(), calls = [], notices = [], remoteClientNotes = new Map();
  const state = {
    currentUser:{id:'actor-A'}, sessionGeneration:1, activeClientOrganizationId:'org-A', bookingMetadataRevision:0,
    bookingColors:new Map(), pendingBookingColors:new Set(), bookingNotes:new Map(), pendingBookingNotes:new Set(),
    clientLabels:new Map(), pendingClientLabels:new Set(), clientLabelSaveQueues:new Map(),
    clientNotes:new Map(), pendingClientNotes:new Map(),
    normalizePhone:value => String(value || '').replace(/\D/g, ''),
    allBookings:[{id:'booking-A',organization_id:'org-A'}], navigator:{onLine:true}, writesAllowed:true,
    BOOKING_COLOR_KEYS:['auto','sky','mint'], BOOKING_COLOR_DEFAULT:'auto',
    localStorage:{getItem:key => storage.get(key) ?? null, setItem:(key,value) => storage.set(key,value)},
    renderBookingData() {}, refreshClientLabelPresentation() {}, notify:message => notices.push(message),
    sessionIsCurrent:(id,generation) => id === state.currentUser?.id && generation === state.sessionGeneration,
    db:{rpc:(name,params) => dispatch(name,params), from:name => ({upsert:params => dispatch(name,params)})}
  };
  function dispatch(name, params) {
    return new Promise((resolve,reject) => calls.push({name,params,resolve,reject}));
  }
  function ack(call) {
    assert.ok(call, 'Expected actual transport dispatch');
    if (call.name === 'client_notes') remoteClientNotes.set(call.params.client_phone,call.params.note);
    call.resolve({data:call.params.p_note ?? call.params.p_color ?? null,error:null});
  }
  const context = vm.createContext(state);
  vm.runInContext(actual,context);
  context.loadBookingColors(); context.loadBookingNotes(); context.loadLocalClientLabels(); context.loadPendingClientNotes();
  Object.assign(state,{userId:'actor-A',phone:'79990000000',note:'new historical',formIsCurrent:() => true,
    showFormError:(_selector,message) => notices.push(message)});
  vm.runInContext(`async function actualHistoricalNoteStep(){${historicalNote}}`,context);
  return {state,context,storage,calls,notices,remoteClientNotes,ack};
}

for (const kind of ['Note','Color']) {
  const value = kind === 'Note' ? 'new note' : 'mint';
  const pending = kind === 'Note' ? 'pendingBookingNotes' : 'pendingBookingColors';
  test(`${kind}: actual text ACK acknowledges and clears pending (positive)`,async () => {
    const h=fixture(), saving=h.context[`saveBooking${kind}`]('booking-A',value);
    assert.equal(h.calls.length,1);
    h.ack(h.calls[0]); assert.equal(await saving,true);
    assert.equal(h.state[pending].has('booking-A'),false);
  });
  test(`${kind}: null data is NOT the v49/v75 text ACK and must retain pending`,async () => {
    const h=fixture(), saving=h.context[`saveBooking${kind}`]('booking-A',value);
    assert.equal(h.calls.length,1);
    h.calls[0].resolve({data:null,error:null});
    const saved=await saving;
    assert.equal(saved,false,'Text-returning RPC cannot be acknowledged by null data');
    assert.equal(h.state[pending].has('booking-A'),true,'Unconfirmed value remains retryable');
  });
}

test('historical client note accepts legitimate PostgREST data:null/error:null (positive)',async () => {
  const h=fixture(), saving=h.context.actualHistoricalNoteStep();
  await tick(); assert.equal(h.calls[0].name,'client_notes');
  h.ack(h.calls[0]); await saving;
  assert.equal(h.state.clientNotes.get(h.state.phone),'new historical');
  assert.equal(h.remoteClientNotes.get(h.state.phone),'new historical');
  const before=h.calls.length;
  await h.context.flushPendingMetadata();
  assert.equal(h.calls.length,before,'Confirmed note needs no stale replay');
  assert.deepEqual(h.notices,[]);
});

test('old durable note must not overwrite a newer acknowledged actual historical note',async () => {
  const h=fixture(); h.state.navigator.onLine=false;
  await h.context.saveClientNoteValue(h.state.phone,'old queued');
  assert.equal(h.calls.length,0);
  assert.equal(h.state.pendingClientNotes.get(h.state.phone),'old queued');
  h.state.navigator.onLine=true;
  const newer=h.context.actualHistoricalNoteStep(); await tick();
  h.ack(h.calls[0]); await newer;
  assert.equal(h.state.clientNotes.get(h.state.phone),'new historical');
  assert.equal(h.remoteClientNotes.get(h.state.phone),'new historical');
  const flushing=h.context.flushPendingMetadata(); await tick();
  // A fix may clear the obsolete queue or replay the new value; either is safe.
  for (const call of h.calls.slice(1)) h.ack(call);
  await flushing;
  assert.equal(h.remoteClientNotes.get(h.state.phone),'new historical',
    'Synthetic committed absolute upserts show an old durable value overwriting the newer ACK');
  assert.equal(h.calls.slice(1).some(call => call.params.note === 'old queued'),false);
});

for (const revoke of [false,true]) test(`foreground write behind replay barrier: ${revoke ? 'revoked gate stops dispatch' : 'still-authorized dispatch succeeds (positive)'}`,async () => {
  const h=fixture(); h.state.navigator.onLine=false;
  await h.context.saveBookingNote('booking-A','old');
  h.state.navigator.onLine=true;
  const flushing=h.context.flushPendingMetadata(); await tick();
  assert.equal(h.calls.length,1);
  const newer=h.context.saveBookingNote('booking-A','new');
  assert.equal(h.calls.length,1,'Foreground is actually waiting behind the replay');
  h.state.writesAllowed=!revoke;
  h.ack(h.calls[0]); await tick();
  const dispatchCount=h.calls.length;
  if (h.calls[1]) h.ack(h.calls[1]);
  const saved=await newer; await flushing;
  assert.equal(dispatchCount,revoke ? 1 : 2,'Authorization must be checked after the asynchronous barrier');
  assert.equal(saved,!revoke);
  assert.equal(h.state.pendingBookingNotes.has('booking-A'),revoke);
});

test('actual device cleanup removes actor A private note queue and preserves actor B',async () => {
  const h=fixture();
  const keyA=h.context.pendingClientNoteStorageKey('actor-A'), keyB=h.context.pendingClientNoteStorageKey('actor-B');
  const labelKey=h.context.clientLabelStorageKey('actor-A');
  const storage={[keyA]:JSON.stringify({'79990000000':'private A'}),[keyB]:'private B',[labelKey]:'{}'};
  Object.defineProperty(storage,'removeItem',{value:key => {delete storage[key];},enumerable:false});
  Object.assign(h.state,{localStorage:storage,reliability:{removePrefix:async () => {},remove:async () => {}},
    offlineBookingSavePromise:Promise.resolve(),offlineBookingQueueKey:() => '',clearNewBookingDraft:() => {}});
  for (const name of ['sessionItemsStorageKey','connectionLogKey','serviceDurationDefaultsStorageKey','autoCompleteStorageKey']) h.state[name]=() => name;
  vm.runInContext(section('async function clearProviderDeviceData(', 'async function logout('),h.context);
  await h.context.clearProviderDeviceData('actor-A');
  assert.equal(storage[labelKey],undefined,'Existing metadata cleanup really executed (positive control)');
  assert.equal(storage[keyB],'private B','Cleanup is scoped to the requested actor');
  assert.equal(storage[keyA],undefined,'Explicit device cleanup must remove the new private phone/note queue');
});
