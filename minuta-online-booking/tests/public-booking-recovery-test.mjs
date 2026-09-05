import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';

// The legacy baseline is intentionally RED. No expected-failure inversion.
// Real app handlers, nonce hashing, input invalidation and storage code execute in VM.
// Only DOM primitives, RPCs and unrelated presentation/integration boundaries are mocked.
const source = readFileSync(process.env.MINUTA_PUBLIC_BOOKING_SOURCE || new URL('../app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const listenersStart = source.indexOf("document.addEventListener('click', event => {");
assert.ok(listenersStart > source.indexOf('async function submitBooking('), 'Missing actual app initialization boundary');
// Load all app declarations and initialization before the global UI/bootstrap tail.
// This retains any newly added recovery helpers and their real state variables.
const appDeclarations = source.slice(0, listenersStart);
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
class Storage {
  constructor(entries = []) { this.values = new Map(entries); }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
  clear() { this.values.clear(); }
}
class Element {
  constructor(id) {
    Object.assign(this, { id, value:'', checked:false, hidden:true, disabled:false, readOnly:false,
      textContent:'', innerHTML:'', dataset:{}, listeners:new Map(), children:new Map(),
      classList:{ toggle() {} } });
  }
  querySelector(selector) {
    if (!this.children.has(selector)) this.children.set(selector, new Element(`${this.id}:${selector}`));
    return this.children.get(selector);
  }
  setAttribute(name, value) { this[name] = value; }
  scrollIntoView() {}
  addEventListener(name, handler) { this.listeners.set(name, handler); }
  dispatch(name) {
    return this.listeners.get(name)?.({ target:this, currentTarget:this, preventDefault() {} });
  }
}
const service = { id:'service-a', name:'Тестовая услуга', duration_minutes:60,
  performer_profiles:{ display_name:'Мастер A' } };
const success = { data:[{ booking_code:'TEST-BOOKING', manage_token:'11111111-1111-4111-8111-111111111111' }], error:null };
const unknown = { data:null, error:{ code:'08006', message:'connection lost after request' } };
const flush = () => new Promise(setImmediate);

function fixture({ teamMode = false, sessionStorage = new Storage(), localStorage = new Storage() } = {}) {
  const elements = new Map();
  const $ = selector => {
    if (!elements.has(selector)) elements.set(selector, new Element(selector));
    return elements.get(selector);
  };
  $('#clientName').value = 'Ирина'; $('#clientPhone').value = '+79990000000'; $('#dataConsent').checked = true;
  $('#bookingFlow').hidden = false;
  $('#bookingForm').reset = () => { $('#clientName').value = ''; $('#clientPhone').value = ''; $('#dataConsent').checked = false; };
  const initialState = { step:3, services:[structuredClone(service)], serviceId:service.id, date:'2099-09-05', time:'10:00',
    teamMode, locationId:teamMode ? 'location-a' : '', locations:teamMode ? [{ id:'location-a', name:'Филиал A' }] : [], moreDates:false };
  const calls = [], effects = [];
  let reply = () => unknown;
  let management = () => ({ data:[{ booking_code:'TEST-BOOKING', status:'confirmed', service_name:'Тестовая услуга', performer_name:'Мастер A', booking_date:'2099-09-05', booking_time:'10:00:00', duration_minutes:60 }], error:null });
  const boundaries = {
    registerBookingPageVisit:() => { effects.push('presence'); },
    trackBookingFunnelEvent:() => { effects.push('funnel'); },
    buildSuccessCalendarEvent:data => { effects.push('calendar'); return data; },
    prepareTelegramAuthorization:() => { effects.push('telegram-auth'); },
    bootstrapClientAccess:async () => { effects.push('client-access'); },
    getPaymentCapability:async () => ({ enabled:false }),
    renderSuccessPayment:() => { effects.push('payment-ui'); },
    notifyTelegramEvent:() => { effects.push('confirmation'); },
    showStep:async step => { context.api.state.step = step; }
  };
  const db = { rpc:async (name, args) => {
    calls.push({ name, args:structuredClone(args) });
    if (name === 'book_appointment' || name === 'book_minuta_appointment') return reply(name, args);
    if (name === 'get_booking_management') return management();
    return { data:null, error:null };
  } };
  const context = { initialState, boundaries, sessionStorage, localStorage, crypto:webcrypto, TextEncoder, URL, URLSearchParams,
    navigator:{ onLine:true, userAgent:'isolated-test' }, location:{ href:'https://public-booking.test/?org=studio' },
    document:{ querySelector:$, querySelectorAll:() => [] }, console, setTimeout, clearTimeout,
    window:{ MINUTA_CONFIG:{ supabaseUrl:'https://local-rpc.test', supabaseKey:'fixture', defaultOrganizationSlug:'studio' },
      supabase:{ createClient:() => db } }
  };
  vm.createContext(context);
  vm.runInContext(`
    ${appDeclarations}
    Object.assign(state, initialState);
    dates.splice(0, dates.length, {iso:'2099-09-05',label:'5 сентября'}, {iso:'2099-09-06',label:'6 сентября'});
    ${Object.keys(boundaries).map(name => `${name} = boundaries.${name};`).join('\n')}
    ${source.split('\n').filter(line => line.startsWith("$('#clientName').addEventListener('input'") || line.startsWith("$('#clientPhone').addEventListener('input'") || line.startsWith("$('#dataConsent').addEventListener('change'") || line.startsWith("$('#bookingForm').addEventListener('submit'")).join('\n')}
    globalThis.api = { state, resetFlow, updateSubmitAvailability,
      setValidationFlags(pending, blocked) { selectionValidationPending = pending; selectionValidationBlocked = blocked; updateSubmitAvailability(); },
      get attempt() { return bookingAttempt; },
      get uncertain() { return bookingResultUncertain; } };
  `, context);
  assert.ok($('#bookingForm').listeners.has('submit'), 'actual form event binding must be installed');
  context.api.updateSubmitAvailability();
  return { $, state:context.api.state, calls, effects, context, sessionStorage, localStorage, api:context.api,
    reply:handler => { reply = handler; }, submit:() => $('#bookingForm').dispatch('submit'),
    managementReply:handler => { management = handler; },
    edit:(selector, value) => { $(selector).value = value; $(selector).dispatch('input'); },
    bookingCalls:() => calls.filter(call => ['book_appointment', 'book_minuta_appointment'].includes(call.name)) };
}
async function waitForCall(f, count = 1) {
  for (let turn = 0; turn < 100 && f.bookingCalls().length < count; turn++) await flush();
  assert.ok(f.bookingCalls().length >= count, 'RPC must reach the controlled boundary');
}

test('unchanged ambiguous retry keeps the original server request ID', async () => {
  const f = fixture(); await f.submit(); await f.submit();
  assert.deepEqual(f.bookingCalls()[1].args, f.bookingCalls()[0].args);
  assert.equal(f.$('#success').hidden, true);
  assert.equal(f.$('#clientName').readOnly, true);
  assert.equal(f.$('#clientPhone').readOnly, true);
});

for (const teamMode of [false, true]) {
  test(`${teamMode ? 'team' : 'personal'} unknown reply plus edited details cannot create a new request`, async () => {
    const f = fixture({ teamMode }); await f.submit();
    f.edit('#clientName', 'Другое имя'); f.edit('#clientPhone', '+79991111111');
    f.state.date = '2099-09-06'; f.state.time = '11:00';
    if (teamMode) f.state.locationId = 'location-b';
    f.edit('#clientName', 'Другое имя');
    await f.submit();
    assert.deepEqual(f.bookingCalls()[1]?.args, f.bookingCalls()[0].args, 'explicit retry must use the immutable original snapshot, not a new nonce or changed fields');
  });
}

test('thrown booking RPC is contained and releases the native submit state', async () => {
  const f = fixture(); f.reply(() => { throw new Error('Failed to fetch'); });
  await assert.doesNotReject(() => f.submit(), 'handler must classify a rejected Promise as unknown');
  assert.equal(f.$('#submitBooking').disabled, false);
  assert.equal(f.$('#success').hidden, true);
  assert.equal(f.api.uncertain, true);
});

for (const error of [
  { code:'08006', message:'network failure near slot_unavailable' },
  { code:'23505', message:'unrelated_unique_constraint' }
]) {
  test(`unknown error ${error.code}/${error.message} must not discard the nonce`, async () => {
    const f = fixture(); f.reply(() => ({ data:null, error })); await f.submit();
    assert.equal(f.api.uncertain, true);
    assert.equal(f.api.attempt?.requestId, f.bookingCalls()[0].args.p_request_id);
    assert.equal(f.state.step, 3, 'unproven refusal must not invite a new booking');
  });
}

test('proven slot rejection permits a new selection without false success', async () => {
  const f = fixture(); f.reply(() => ({ data:null, error:{ code:'P0001', message:'slot_unavailable' } }));
  await f.submit(); assert.equal(f.$('#success').hidden, true); assert.equal(f.state.step, 2);
  assert.equal(f.api.attempt, null); assert.equal(f.$('#submitBooking').disabled, false);
});

for (const data of [null, [], [{}], [{ manage_token:'' }]]) {
  test(`malformed success ${JSON.stringify(data)} cannot clear the attempt or show confirmation`, async () => {
    const f = fixture(); f.reply(() => ({ data, error:null })); await f.submit();
    assert.equal(f.$('#success').hidden, true);
    assert.equal(f.$('#bookingFlow').hidden, false);
    assert.equal(f.api.attempt?.requestId, f.bookingCalls()[0].args.p_request_id);
    assert.deepEqual(f.effects, [], 'malformed response must not trigger success telemetry, contact storage or notifications');
    assert.equal(f.localStorage.getItem('minuta-client-contact-v1'), null);
  });
}

test('reset and new form while an old booking is pending suppresses late success effects', async () => {
  const f = fixture(), pending = deferred(); f.reply(() => pending.promise);
  const request = f.submit(); await waitForCall(f);
  f.api.resetFlow();
  f.state.date = '2099-09-06'; f.state.time = '11:00';
  f.edit('#clientName', 'Новый клиент'); f.edit('#clientPhone', '+79992222222');
  pending.resolve(success); await request;
  assert.equal(f.$('#success').hidden, true);
  assert.equal(f.$('#bookingFlow').hidden, false);
  assert.equal(f.$('#clientName').value, 'Новый клиент');
  assert.deepEqual(f.effects, [], 'old completion must not affect the new form or client contact cache');
});

test('two concurrent submits of the same form do not issue two RPCs', async () => {
  const f = fixture(), pending = deferred(); f.reply(() => pending.promise);
  const requests = [f.submit(), f.submit()];
  await waitForCall(f); await new Promise(resolve => setTimeout(resolve, 15));
  pending.resolve(unknown); await Promise.all(requests);
  assert.equal(f.bookingCalls().length, 1, 'busy guard must precede asynchronous fingerprint calculation');
});

test('same-context reload preserves the opaque request identity without storing PII in the attempt', async () => {
  const first = fixture(); await first.submit();
  const stored = JSON.parse(first.sessionStorage.getItem('minuta-booking-attempt-v1'));
  assert.equal(stored.requestId, first.bookingCalls()[0].args.p_request_id);
  assert.doesNotMatch(JSON.stringify(stored), /Ирина|79990000000/);
  const second = fixture({ sessionStorage:first.sessionStorage }); await second.submit();
  assert.deepEqual(second.bookingCalls()[0].args, first.bookingCalls()[0].args);
});

test('offline form sends no RPC and retains entered contact details', async () => {
  const f = fixture(); f.context.navigator.onLine = false; await f.submit();
  assert.equal(f.bookingCalls().length, 0); assert.equal(f.$('#clientName').value, 'Ирина');
  assert.equal(f.$('#success').hidden, true);
});

test('true v44/v68 success envelope still displays confirmed booking', async () => {
  const f = fixture(); f.reply(() => success); await f.submit();
  assert.equal(f.$('#success').hidden, false); assert.equal(f.api.attempt, null);
  assert.equal(f.bookingCalls().length, 1); assert.ok(f.effects.includes('confirmation'));
  assert.equal(f.$('#clientName').readOnly, false);
});

test('restored hash-only attempt with different fields cannot allocate a new request', async () => {
  const first = fixture(); await first.submit();
  const second = fixture({ sessionStorage:first.sessionStorage });
  second.edit('#clientName', 'Другой клиент'); await second.submit();
  assert.equal(second.bookingCalls().length, 0, 'restore must require original parameters, not silently replace the legacy nonce');
  assert.equal(second.api.attempt?.requestId, first.bookingCalls()[0].args.p_request_id);
});

test('unknown original attempt survives a later service precheck refusal', async () => {
  const f = fixture({ teamMode:true }); await f.submit();
  const original = f.api.attempt.requestId;
  f.reply(() => ({ data:null, error:{ code:'P0001', message:'service_unavailable' } }));
  await f.submit();
  assert.equal(f.api.attempt?.requestId, original, 'v68 precheck failure cannot prove that an earlier attempt never committed');
  assert.equal(f.api.uncertain, true);
});

for (const management of [{ data:null, error:null }, { data:[], error:null }, { data:null, error:{ message:'read failed' } }]) {
  test(`unconfirmed management ${JSON.stringify(management)} cannot announce booking success`, async () => {
    const f = fixture(); f.reply(() => success); f.managementReply(() => management); await f.submit();
    assert.equal(f.$('#success').hidden, true);
    assert.equal(f.api.attempt?.requestId, f.bookingCalls()[0].args.p_request_id);
    assert.equal(f.effects.includes('confirmation'), false);
  });
}

test('idempotent replay of a cancelled booking never sends confirmation', async () => {
  const f = fixture(); f.reply(() => success);
  f.managementReply(() => ({ data:[{ booking_code:'TEST-BOOKING', status:'cancelled', service_name:'Тестовая услуга',
    performer_name:'Мастер A', booking_date:'2099-09-05', booking_time:'10:00:00', duration_minutes:60 }], error:null }));
  await f.submit();
  assert.match(f.$('#successTitle').textContent, /отменена/);
  assert.equal(f.effects.includes('confirmation'), false);
});

test('reset during management lookup prevents the old verified booking from replacing the new form', async () => {
  const f = fixture(), pending = deferred(); f.reply(() => success); f.managementReply(() => pending.promise);
  const request = f.submit();
  for (let turn = 0; turn < 100 && !f.calls.some(call => call.name === 'get_booking_management'); turn++) await flush();
  assert.ok(f.calls.some(call => call.name === 'get_booking_management'));
  assert.equal(f.$('#success').hidden, true, 'status lookup must precede success UI');
  f.api.resetFlow(); f.state.date = '2099-09-06'; f.state.time = '11:00';
  f.edit('#clientName', 'Следующий клиент');
  pending.resolve({ data:[{ booking_code:'TEST-BOOKING', status:'confirmed', service_name:'Тестовая услуга',
    booking_date:'2099-09-05', booking_time:'10:00:00', duration_minutes:60 }], error:null });
  await request;
  assert.equal(f.$('#success').hidden, true);
  assert.equal(f.$('#clientName').value, 'Следующий клиент');
  assert.deepEqual(f.effects, []);
});

test('unresolved original request can be checked even when its committed slot looks unavailable', async () => {
  const f = fixture(); await f.submit();
  f.api.setValidationFlags(false, true);
  assert.equal(f.$('#submitBooking').disabled, false, 'availability cannot strand an idempotent result check');
  await f.submit();
  assert.equal(f.bookingCalls().length, 2);
  assert.deepEqual(f.bookingCalls()[1].args, f.bookingCalls()[0].args);
});

test('availability validation still blocks a first request with no unresolved attempt', async () => {
  const f = fixture(); f.api.setValidationFlags(false, true); await f.submit();
  assert.equal(f.$('#submitBooking').disabled, true);
  assert.equal(f.bookingCalls().length, 0);
});
