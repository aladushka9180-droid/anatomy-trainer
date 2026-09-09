import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../provider.js', import.meta.url), 'utf8');
function actual(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, name);
  const rest = source.slice(start + 1);
  const next = rest.search(/^(?:async )?function /m);
  return source.slice(start, next < 0 ? undefined : start + 1 + next);
}

const functions = [
  'providerBookingAttemptKey', 'readProviderBookingAttempt', 'saveProviderBookingAttempt',
  'clearProviderBookingAttempt', 'providerBookingFingerprint', 'providerBookingDefiniteRejection',
  'providerBookingReplyIsValid', 'isMissingProviderBookingRequestRpc', 'submitProviderBookingAttempt'
];
const payload = Object.freeze({
  surface:'new-booking', service:'11111111-1111-4111-8111-111111111111',
  date:'2099-09-09', time:'14:00', name:'Ирина', phone:'+7 999 000-00-00',
  durationMinutes:60, note:'', color:'sage'
});

function storageFixture() {
  const values = new Map();
  return {
    getItem:key => values.has(key) ? values.get(key) : null,
    setItem:(key, value) => values.set(key, String(value)),
    removeItem:key => values.delete(key),
    values
  };
}

function boxWithRpc(rpc) {
  const sessionStorage = storageFixture();
  const box = vm.createContext({
    console, crypto:webcrypto, TextEncoder, Uint8Array, Date, sessionStorage,
    currentUser:{ id:'22222222-2222-4222-8222-222222222222' }, sessionGeneration:7,
    sessionIsCurrent:() => true, normalizePhone:value => String(value || '').replace(/\D/g, ''),
    createOfflineBookingId:() => webcrypto.randomUUID(), db:{ rpc }
  });
  vm.runInContext(`let providerBookingWritePromise = null;\n${functions.map(actual).join('\n')}`, box);
  return { box, sessionStorage };
}

const successFor = params => ({ data:{
  booking_id:'33333333-3333-4333-8333-333333333333',
  booking_code:'MIN-ABCDEF1234', request_id:params.p_request_id
}, error:null });

test('lost response retries the same request id and recovers the exact acknowledgement', async () => {
  const calls = [];
  const { box } = boxWithRpc(async (_name, params) => {
    calls.push(params);
    if (calls.length === 1) throw new Error('network lost after commit');
    return successFor(params);
  });
  const first = await box.submitProviderBookingAttempt(payload);
  const second = await box.submitProviderBookingAttempt(payload);
  assert.equal(first.uncertain, true);
  assert.equal(second.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].p_request_id, calls[1].p_request_id);
  assert.equal(second.data.request_id, calls[0].p_request_id);
});

test('changed payload after an uncertain call never sends a second request', async () => {
  const calls = [];
  const { box } = boxWithRpc(async (_name, params) => { calls.push(params); throw new Error('network'); });
  assert.equal((await box.submitProviderBookingAttempt(payload)).uncertain, true);
  const changed = await box.submitProviderBookingAttempt({ ...payload, time:'14:15' });
  assert.equal(changed.conflict, true);
  assert.equal(calls.length, 1);
});

test('malformed success retains identity and next check uses the same request id', async () => {
  const calls = [];
  const { box } = boxWithRpc(async (_name, params) => {
    calls.push(params);
    return calls.length === 1 ? { data:{ booking_code:'MIN-ONLY' }, error:null } : successFor(params);
  });
  assert.equal((await box.submitProviderBookingAttempt(payload)).invalidReply, true);
  assert.equal((await box.submitProviderBookingAttempt(payload)).ok, true);
  assert.equal(calls[0].p_request_id, calls[1].p_request_id);
});

test('missing overload invokes legacy once, then a lost legacy reply is permanently latched', async () => {
  const calls = [];
  const missing = { code:'PGRST202', message:'Could not find the function public.provider_book_appointment(p_client_name, p_client_phone, p_date, p_request_id, p_service, p_time) in the schema cache' };
  const { box } = boxWithRpc(async (_name, params) => {
    calls.push(params);
    if ('p_request_id' in params) return { data:null, error:missing };
    throw new Error('legacy response lost');
  });
  const first = await box.submitProviderBookingAttempt(payload);
  const second = await box.submitProviderBookingAttempt(payload);
  assert.equal(first.legacyUncertain, true);
  assert.equal(second.legacyUncertain, true);
  assert.equal(calls.length, 2, 'the legacy request must never be repeated');
});

test('acknowledged legacy code is cached for exact row recovery without another RPC', async () => {
  const calls = [];
  const missing = { code:'PGRST202', message:'Could not find public.provider_book_appointment with p_request_id' };
  const { box } = boxWithRpc(async (_name, params) => {
    calls.push(params);
    return 'p_request_id' in params ? { data:null, error:missing } : { data:'MIN-12345678', error:null };
  });
  const first = await box.submitProviderBookingAttempt(payload);
  const recovered = await box.submitProviderBookingAttempt(payload);
  assert.equal(first.ok, true);
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.data.booking_code, 'MIN-12345678');
  assert.equal(calls.length, 2);
});

test('an inner 42883 is uncertain and never mistaken for an absent provider overload', async () => {
  const calls = [];
  const { box } = boxWithRpc(async (_name, params) => {
    calls.push(params);
    return { data:null, error:{
      code:'42883',
      message:'function public.book_appointment(uuid, uuid, date) does not exist',
      details:'PL/pgSQL function provider_book_appointment(uuid,uuid,date,time,text,text) line 12'
    } };
  });
  const result = await box.submitProviderBookingAttempt(payload);
  assert.equal(result.uncertain, true);
  assert.equal(result.legacy, undefined);
  assert.equal(calls.length, 1);
});

test('definite slot rejection clears the stored identity', async () => {
  const { box, sessionStorage } = boxWithRpc(async () => ({ data:null, error:{ code:'P0001', message:'slot_unavailable' } }));
  const result = await box.submitProviderBookingAttempt(payload);
  assert.equal(result.definite, true);
  assert.equal(sessionStorage.values.size, 0);
});

test('only one provider booking write can be in flight', async () => {
  let release;
  const calls = [];
  const pending = new Promise(resolve => { release = resolve; });
  const { box } = boxWithRpc(async (_name, params) => { calls.push(params); await pending; return successFor(params); });
  const first = box.submitProviderBookingAttempt(payload);
  await Promise.resolve();
  const second = await box.submitProviderBookingAttempt(payload);
  assert.equal(second.busy, true);
  release();
  assert.equal((await first).ok, true);
  assert.equal(calls.length, 1);
});
