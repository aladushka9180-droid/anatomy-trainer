import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
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
// Optional pinned Git source prevents racing an owner's unfrozen working file.
const sourceRef = process.env.MINUTA_PROVIDER_REF;
const bytes = sourceRef ? execFileSync('git',['show',`${sourceRef}:minuta-online-booking/provider.js`],
  {cwd:fileURLToPath(new URL('../../',import.meta.url)),maxBuffer:8*1024*1024}) : readFileSync(sourcePath);
const source = bytes.toString('utf8').replaceAll('\r\n', '\n');
console.log(`Actual provider: ${sourceRef ? `git:${sourceRef}:minuta-online-booking/provider.js` : sourcePath}; SHA256=${createHash('sha256').update(bytes).digest('hex')}`);
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
function fixture(storage = new Map()) {
  const calls = [], notices = [], remoteClientNotes = new Map(), remoteBookingValues = new Map();
  const state = {
    currentUser:{id:'actor-A'}, sessionGeneration:1, activeClientOrganizationId:'org-A', bookingMetadataRevision:0,
    bookingColors:new Map(), pendingBookingColors:new Set(), bookingNotes:new Map(), pendingBookingNotes:new Set(),
    clientLabels:new Map(), pendingClientLabels:new Set(), clientLabelSaveQueues:new Map(),
    clientNotes:new Map(), pendingClientNotes:new Map(),
    normalizePhone:value => String(value || '').replace(/\D/g, ''),
    allBookings:[{id:'booking-A',organization_id:'org-A'}], navigator:{onLine:true}, writesAllowed:true,
    BOOKING_COLOR_KEYS:['auto','sky','mint'], BOOKING_COLOR_DEFAULT:'auto',
    localStorage:{getItem:key => storage.get(key) ?? null, setItem:(key,value) => storage.set(key,value),
      removeItem:key => storage.delete(key), key:index => [...storage.keys()][index] ?? null,
      get length() { return storage.size; }},
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
    else remoteBookingValues.set(call.params.p_booking,call.params.p_note ?? call.params.p_color);
    call.settled = true;
    call.resolve({data:call.params.p_note ?? call.params.p_color ?? null,error:null});
  }
  const context = vm.createContext(state);
  vm.runInContext(actual,context);
  context.loadBookingColors(); context.loadBookingNotes(); context.loadLocalClientLabels(); context.loadPendingClientNotes();
  Object.assign(state,{userId:'actor-A',phone:'79990000000',note:'new historical',formIsCurrent:() => true,
    showFormError:(_selector,message) => notices.push(message)});
  vm.runInContext(`async function actualHistoricalNoteStep(){${historicalNote}}`,context);
  return {state,context,storage,calls,notices,remoteClientNotes,remoteBookingValues,ack};
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

// Additional e3ad028d40733b0d817618f80297eaaea6286608 baseline: four RED.
// Finish every synthetic request before checking the result; a refused local
// write is acceptable, but a committed new value must never replay an old one.
async function settleAll(h, operation) {
  let done=false, outcome;
  Promise.resolve(operation).then(value => {outcome={value};done=true;},error => {outcome={error};done=true;});
  for (let attempt=0;attempt<30&&!done;attempt++) {
    await tick();
    for (const call of h.calls) if (!call.settled) h.ack(call);
  }
  await tick();
  assert.equal(done,true,'Bounded fixture must finish all actual deferred work');
  return outcome;
}

test('flush A pending must not replay snapshotted old B after foreground B was acknowledged',async () => {
  const h=fixture(), phoneA='79990000001', phoneB='79990000002';
  h.state.navigator.onLine=false;
  await h.context.saveClientNoteValue(phoneA,'queued A');
  await h.context.saveClientNoteValue(phoneB,'old B');
  h.state.navigator.onLine=true;
  const flushing=h.context.flushPendingMetadata(); await tick();
  assert.equal(h.calls.length,1); assert.equal(h.calls[0].params.client_phone,phoneA);
  const newer=h.context.saveClientNoteValue(phoneB,'LATEST B'); await tick();
  assert.equal(h.calls.length,2,'Unrelated B can complete while A replay waits');
  h.ack(h.calls[1]); assert.equal(await newer,true);
  assert.equal(h.remoteClientNotes.get(phoneB),'LATEST B');
  h.ack(h.calls[0]); await settleAll(h,flushing);
  assert.equal(h.remoteClientNotes.get(phoneA),'queued A','Other pending client is not lost');
  assert.equal(h.remoteClientNotes.get(phoneB),'LATEST B','Old snapshot must not overwrite newer confirmed B');
  assert.equal(h.calls.slice(2).some(call => call.params.client_phone===phoneB&&call.params.note==='old B'),false);
});

for (const kind of ['client-note','booking-note','booking-color']) test(`${kind}: quota failure plus new ACK cannot leave OLD durable replay, nor lose another pending item`,async () => {
  const h=fixture(), client=kind==='client-note', color=kind==='booking-color';
  const target=client?'79990000001':'booking-A', other=client?'79990000002':'booking-other';
  const oldValue=color?'sky':'OLD', newValue=color?'mint':'NEW', otherValue=color?'sky':'OTHER PENDING';
  const method=client?'saveClientNoteValue':color?'saveBookingColor':'saveBookingNote';
  const pendingName=client?'pendingClientNotes':color?'pendingBookingColors':'pendingBookingNotes';
  h.state.allBookings.push({id:other,organization_id:'org-A'});
  h.state.navigator.onLine=false;
  await h.context[method](target,oldValue); await h.context[method](other,otherValue);
  assert.equal(h.calls.length,0);
  const durableBefore=new Map(h.storage);
  const foreignKey=client?h.context.pendingClientNoteStorageKey('actor-B'):
    color?h.context.bookingColorPendingStorageKey('actor-B'):h.context.bookingNotePendingStorageKey('actor-B');
  h.storage.set(foreignKey,'foreign actor pending sentinel');
  h.state.navigator.onLine=true;
  h.state.localStorage.setItem=() => {throw new Error('QuotaExceededError');};
  const outcome=await settleAll(h,h.context[method](target,newValue));
  const newWasCommitted=h.calls.some(call => (call.params.note ?? call.params.p_note ?? call.params.p_color)===newValue);
  if (!newWasCommitted) assert.notEqual(outcome.value,true,'Safe refusal must not claim a server ACK');
  assert.equal(h.storage.get(foreignKey),'foreign actor pending sentinel');
  assert.ok(durableBefore.size>0,'OLD was physically persisted before quota failure');

  // New JS context simulates reopen; only persisted bytes survive, not maps or
  // in-memory tombstones. Storage becomes writable again after the restart.
  const reopened=fixture(h.storage);
  reopened.state.allBookings.push({id:other,organization_id:'org-A'});
  const remote=client?reopened.remoteClientNotes:reopened.remoteBookingValues;
  remote.set(target,newWasCommitted?newValue:oldValue);
  assert.equal(reopened.state[pendingName].has(other),true,'A fix must not delete the whole pending queue to suppress stale replay');
  await settleAll(reopened,reopened.context.flushPendingMetadata());
  assert.equal(remote.get(other),otherValue,'Unrelated durable pending intent must remain deliverable');
  assert.equal(remote.get(target),newWasCommitted?newValue:oldValue,
    'After acknowledged NEW, reopening must not deliver durable OLD');
  if (newWasCommitted) assert.equal(reopened.calls.some(call =>
    (call.params.client_phone ?? call.params.p_booking)===target
      && (call.params.note ?? call.params.p_note ?? call.params.p_color)===oldValue),false);
});
