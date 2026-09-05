import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../group-bookings.js', import.meta.url), 'utf8');
const flush = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

class Element {
  constructor(id) {
    Object.assign(this, { id, hidden:false, disabled:false, readOnly:false, checked:false, open:false,
      value:'', textContent:'', innerHTML:'', dataset:{}, listeners:new Map() });
  }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  dispatch(type, details = {}) {
    const event = { target:this, currentTarget:this, preventDefault() {}, ...details };
    return Promise.all((this.listeners.get(type) || []).map(listener => listener(event)));
  }
  showModal() { this.open = true; }
  close() { this.open = false; void this.dispatch('close'); }
  reset() { /* Native form.reset does not restore the disabled property. */ }
  checkValidity() { return true; }
  reportValidity() {}
  querySelector(selector) { return selector === 'button[type="submit"]' ? this.submitButton : null; }
  querySelectorAll(selector) { return selector.includes('button') && this.submitButton ? [this.submitButton] : []; }
}

function makeDom() {
  const ids = [
    'groupEventsPanel', 'groupBookingSettingsCard', 'groupBookingsEnabled', 'groupBookingsSettingNote',
    'newGroupEvent', 'groupEventsList', 'groupEventForm', 'groupEventId', 'groupEventDialogTitle',
    'groupEventLocation', 'groupEventPerformer', 'groupEventTitle', 'groupEventDescription', 'groupEventDate',
    'groupEventTime', 'groupEventDuration', 'groupEventCapacity', 'groupEventStatus', 'groupEventError',
    'groupEventDialog', 'closeGroupEventDialog', 'providerSubmit', 'publicGroupEvents', 'publicGroupEventsList',
    'publicGroupBookingForm', 'publicGroupBookingTitle', 'publicGroupBookingSummary', 'publicGroupBookingError',
    'publicGroupBookingSuccess', 'publicGroupBookingDialog', 'publicGroupClientName', 'publicGroupClientPhone',
    'publicGroupClientComment', 'closePublicGroupBooking', 'publicSubmit'
  ];
  const elements = Object.fromEntries(ids.map(id => [id, new Element(id)]));
  elements.groupEventForm.submitButton = elements.providerSubmit;
  elements.publicGroupBookingForm.submitButton = elements.publicSubmit;
  elements.groupEventDialog.querySelector = selector => elements.groupEventForm.querySelector(selector);
  elements.publicGroupBookingDialog.querySelector = selector => elements.publicGroupBookingForm.querySelector(selector);
  const $ = selector => selector === '#groupEventForm button[type="submit"]' ? elements.providerSubmit
    : selector === '#publicGroupBookingForm button[type="submit"]' ? elements.publicSubmit
      : elements[selector.replace(/^#/, '')] || null;
  return { elements, $ };
}

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
}[char]));
function eventRecord(id = 'event-a', title = 'Событие А') {
  return { id, title, event_date:'2030-05-10', start_time:'12:00:00', duration_minutes:60,
    status:'published', seats_left:3, capacity:4, participants:[],
    performer_id:'performer', performer_name:'Мастер', location_id:'location', location_name:'Кабинет' };
}
function workspace(organization = 'org-a') {
  return { organization_id:organization, enabled:true, events:[eventRecord()],
    performers:[{ id:'performer', name:'Мастер' }], locations:[{ id:'location', name:'Кабинет' }] };
}
function fixture() {
  const dom = makeDom();
  const calls = [], notices = [];
  const state = { user:'owner', generation:1, slug:'studio-a' };
  let rpcOverride = () => undefined;
  const db = { rpc:async (name, args) => {
    calls.push({ name, args });
    const result = rpcOverride(name, args);
    if (result !== undefined) return result;
    if (name === 'get_minuta_group_booking_admin') return { data:workspace(args.p_organization), error:null };
    if (name === 'get_public_minuta_group_events') return { data:{ enabled:true, events:[eventRecord(), eventRecord('event-b', 'Событие Б')] }, error:null };
    if (name === 'upsert_minuta_group_event') return { data:'event-saved', error:null };
    return { data:{ participant_id:'participant-a', booking_code:'OK-123', status:'confirmed' }, error:null };
  } };
  const window = { confirm:() => true };
  runInNewContext(source, { window, crypto:webcrypto, console, setTimeout, clearTimeout });
  const provider = window.MinutaGroupBookings.createProviderController({
    db, $:dom.$, escapeHtml, notify:message => notices.push(message), requireWrites:() => true,
    getCurrentUser:() => state.user ? { id:state.user } : null,
    getSessionGeneration:() => state.generation,
    sessionIsCurrent:(user, generation) => user === state.user && generation === state.generation,
    applyWriteAvailability() {}
  });
  const publicController = window.MinutaGroupBookings.createPublicController({
    db, $:dom.$, escapeHtml, getSlug:() => state.slug, notify:message => notices.push(message)
  });
  provider.bind();
  publicController.bind();
  return { ...dom, calls, notices, state, provider, publicController,
    override:handler => { rpcOverride = handler; } };
}
async function readyProvider(f) {
  f.provider.setOrganization({ id:'org-a', current_role:'owner' });
  await flush();
  assert.equal(f.provider.availability, 'ready');
  await f.elements.newGroupEvent.dispatch('click');
  f.elements.groupEventTitle.value = 'Новая группа';
}
async function openPublic(f, id = 'event-a') {
  await f.elements.publicGroupEventsList.dispatch('click', {
    target:{ closest:selector => selector === '[data-book-group-event]' ? { dataset:{ bookGroupEvent:id } } : null }
  });
  f.elements.publicGroupClientName.value = 'Ирина';
  f.elements.publicGroupClientPhone.value = '+79990000000';
}
const save = f => f.elements.groupEventForm.dispatch('submit', { submitter:f.elements.providerSubmit });
const book = f => f.elements.publicGroupBookingForm.dispatch('submit', { submitter:f.elements.publicSubmit });
const adminLoads = f => f.calls.filter(call => call.name === 'get_minuta_group_booking_admin').length;

test('provider: thrown update restores the button, keeps input, and permits a successful retry', async () => {
  const f = fixture();
  await readyProvider(f);
  f.elements.groupEventId.value = 'event-a';
  f.override(name => { if (name === 'upsert_minuta_group_event') throw new Error('network disconnected'); });
  await save(f);
  assert.equal(f.elements.providerSubmit.disabled, false);
  assert.equal(f.elements.groupEventDialog.open, true);
  assert.equal(f.elements.groupEventTitle.value, 'Новая группа');
  assert.equal(f.elements.groupEventError.hidden, false);
  assert.equal(f.notices.length, 0);
  f.override(() => undefined);
  await save(f);
  assert.equal(f.elements.groupEventDialog.open, false);
  assert.equal(f.notices.length, 1);
});

for (const outcome of ['success', 'error']) {
  test(`provider: old save ${outcome} cannot alter a newly opened form`, async () => {
    const f = fixture(), pending = deferred();
    await readyProvider(f);
    f.override(name => name === 'upsert_minuta_group_event' ? pending.promise : undefined);
    const first = save(f);
    await f.elements.closeGroupEventDialog.dispatch('click');
    await f.elements.newGroupEvent.dispatch('click');
    f.elements.groupEventTitle.value = 'Другая форма';
    assert.equal(f.elements.providerSubmit.disabled, false, 'new form must be usable while the previous save is pending');
    const loadsBefore = adminLoads(f);
    pending.resolve(outcome === 'success' ? { data:{}, error:null } : { data:null, error:{ message:'conflict' } });
    await first;
    assert.equal(f.elements.groupEventDialog.open, true);
    assert.equal(f.elements.groupEventTitle.value, 'Другая форма');
    assert.equal(f.elements.groupEventError.hidden, true);
    assert.equal(f.notices.length, 0);
    assert.equal(adminLoads(f), loadsBefore);
  });
}

const mutations = [
  ['save', 'upsert_minuta_group_event', save],
  ['toggle', 'set_minuta_group_bookings_enabled', f => f.elements.groupBookingsEnabled.dispatch('change', { target:{ checked:false } })],
  ['event status', 'set_minuta_group_event_status', f => f.elements.groupEventsPanel.dispatch('click', {
    target:{ closest:selector => selector === '[data-group-event-status]' ? { dataset:{ eventId:'event-a', groupEventStatus:'closed' } } : null }
  })],
  ['participant status', 'set_minuta_group_participant_status', f => f.elements.groupEventsPanel.dispatch('click', {
    target:{ closest:selector => selector === '[data-group-participant-status]' ? { dataset:{ participantId:'participant', groupParticipantStatus:'attended' } } : null }
  })]
];
for (const [label, rpcName, action] of mutations) {
  for (const change of ['organization', 'session']) {
    test(`provider: stale ${label} after ${change} change cannot notify or refresh another context`, async () => {
      const f = fixture(), pending = deferred();
      await readyProvider(f);
      f.override(name => name === rpcName ? pending.promise : undefined);
      const request = action(f);
      assert.equal(f.calls.at(-1).name, rpcName);
      if (change === 'organization') {
        f.provider.setOrganization({ id:'org-b', current_role:'owner' });
        await flush();
      } else {
        f.state.generation += 1;
      }
      const loadsBefore = adminLoads(f);
      const markupBefore = f.elements.groupEventsList.innerHTML;
      pending.resolve({ data:{}, error:null });
      await request;
      await flush();
      assert.equal(f.notices.length, 0);
      assert.equal(adminLoads(f), loadsBefore);
      assert.equal(f.elements.groupEventsList.innerHTML, markupBefore);
    });
  }
}

test('provider: a thrown load exits loading and a later refresh recovers', async () => {
  const f = fixture();
  await readyProvider(f);
  f.override(name => { if (name === 'get_minuta_group_booking_admin') throw new Error('offline'); });
  await f.provider.load();
  assert.equal(f.provider.availability, 'error');
  assert.equal(f.elements.newGroupEvent.disabled, true);
  f.override(() => undefined);
  await f.provider.load();
  assert.equal(f.provider.availability, 'ready');
  assert.equal(f.elements.newGroupEvent.disabled, false);
});

test('public: thrown booking keeps the request identity and recovers on retry', async () => {
  const f = fixture();
  await f.publicController.load();
  await openPublic(f);
  const requestId = f.elements.publicGroupBookingForm.dataset.requestId;
  f.override(name => { if (name === 'book_minuta_group_event') throw new Error('reply lost'); });
  await book(f);
  assert.equal(f.elements.publicSubmit.disabled, false);
  assert.equal(f.elements.publicGroupBookingForm.hidden, false);
  assert.equal(f.elements.publicGroupBookingError.hidden, false);
  assert.equal(f.elements.publicGroupClientName.value, 'Ирина');
  assert.equal(f.elements.publicGroupBookingForm.dataset.requestId, requestId);
  f.override(() => undefined);
  await book(f);
  const attempts = f.calls.filter(call => call.name === 'book_minuta_group_event');
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].args.p_request_id, attempts[1].args.p_request_id);
  assert.equal(attempts[0].args.p_event, attempts[1].args.p_event);
  assert.equal(f.elements.publicGroupBookingForm.hidden, true);
  assert.equal(f.elements.publicGroupBookingSuccess.hidden, false);
  assert.match(f.elements.publicGroupBookingSuccess.innerHTML, /OK-123/);
  assert.equal(f.notices.length, 1);
});

for (const outcome of ['success', 'error']) {
  test(`public: old booking ${outcome} cannot replace the next event's form`, async () => {
    const f = fixture(), pending = deferred();
    await f.publicController.load();
    await openPublic(f);
    const firstId = f.elements.publicGroupBookingForm.dataset.requestId;
    f.override(name => name === 'book_minuta_group_event' ? pending.promise : undefined);
    const first = book(f);
    await f.elements.closePublicGroupBooking.dispatch('click');
    await openPublic(f, 'event-b');
    const nextId = f.elements.publicGroupBookingForm.dataset.requestId;
    assert.notEqual(nextId, firstId);
    assert.equal(f.elements.publicSubmit.disabled, false);
    pending.resolve(outcome === 'success' ? { data:{ booking_code:'OLD' }, error:null } : { data:null, error:{ message:'full' } });
    await first;
    assert.equal(f.elements.publicGroupBookingDialog.open, true);
    assert.equal(f.elements.publicGroupBookingTitle.textContent, 'Событие Б');
    assert.equal(f.elements.publicGroupBookingForm.hidden, false);
    assert.equal(f.elements.publicGroupBookingError.hidden, true);
    assert.equal(f.elements.publicGroupBookingSuccess.hidden, true);
    assert.equal(f.elements.publicGroupBookingForm.dataset.requestId, nextId);
    assert.equal(f.notices.length, 0);
  });
}

test('public: booking completed after slug change cannot show another studio confirmation', async () => {
  const f = fixture(), pending = deferred();
  await f.publicController.load();
  await openPublic(f);
  f.override(name => name === 'book_minuta_group_event' ? pending.promise : undefined);
  const request = book(f);
  f.state.slug = 'studio-b';
  await f.publicController.load();
  const callsBefore = f.calls.length;
  const markupBefore = f.elements.publicGroupEventsList.innerHTML;
  pending.resolve({ data:{ booking_code:'FOREIGN' }, error:null });
  await request;
  assert.equal(f.notices.length, 0);
  assert.equal(f.calls.length, callsBefore);
  assert.equal(f.elements.publicGroupEventsList.innerHTML, markupBefore);
  assert.equal(f.elements.publicGroupBookingSuccess.hidden, true);
});

test('public: older load cannot overwrite the current studio events', async () => {
  const f = fixture(), pending = deferred();
  f.override((name, args) => name === 'get_public_minuta_group_events' && args.p_slug === 'studio-a' ? pending.promise : undefined);
  const first = f.publicController.load();
  f.state.slug = 'studio-b';
  await f.publicController.load();
  const currentMarkup = f.elements.publicGroupEventsList.innerHTML;
  pending.resolve({ data:{ enabled:true, events:[eventRecord('old', 'Чужая студия')] }, error:null });
  await first;
  assert.equal(f.elements.publicGroupEventsList.innerHTML, currentMarkup);
  assert.doesNotMatch(f.elements.publicGroupEventsList.innerHTML, /Чужая студия/);
});

test('public: a thrown load is recoverable by refreshing', async () => {
  const f = fixture();
  f.override(() => { throw new Error('offline'); });
  await f.publicController.load();
  assert.equal(f.elements.publicGroupEvents.hidden, true);
  f.override(() => undefined);
  await f.publicController.load();
  assert.equal(f.elements.publicGroupEvents.hidden, false);
});

for (const [label, rpcName, action] of mutations.slice(1)) {
  test(`provider: thrown ${label} produces an error and remains retryable`, async () => {
    const f = fixture();
    await readyProvider(f);
    f.override(name => { if (name === rpcName) throw new Error('transport failure'); });
    await action(f);
    await flush();
    assert.equal(f.notices.length, 1);
    assert.match(f.notices[0], /Не удалось/);
    assert.equal(f.provider.availability, 'ready');
    f.override(() => undefined);
    await action(f);
    await flush();
    assert.equal(f.notices.length, 2);
    assert.doesNotMatch(f.notices[1], /Не удалось/);
    assert.equal(f.calls.filter(call => call.name === rpcName).length, 2);
  });
}

for (const type of ['provider', 'public']) {
  test(`${type}: duplicate submit while pending performs only one write`, async () => {
    const f = fixture(), pending = deferred();
    if (type === 'provider') await readyProvider(f);
    else { await f.publicController.load(); await openPublic(f); }
    const rpcName = type === 'provider' ? 'upsert_minuta_group_event' : 'book_minuta_group_event';
    const action = type === 'provider' ? save : book;
    f.override(name => name === rpcName ? pending.promise : undefined);
    const first = action(f);
    await action(f);
    assert.equal(f.calls.filter(call => call.name === rpcName).length, 1);
    pending.resolve({ data:type === 'provider' ? 'event-saved' : { participant_id:'participant-a', booking_code:'ONE', status:'confirmed' }, error:null });
    await first;
    assert.equal(f.notices.length, 1);
  });
}

test('provider: older load cannot overwrite a newer refresh in the same organization', async () => {
  const f = fixture(), pending = deferred();
  await readyProvider(f);
  let reads = 0;
  f.override(name => {
    if (name !== 'get_minuta_group_booking_admin') return undefined;
    reads += 1;
    return reads === 1 ? pending.promise : { data:{ ...workspace(), events:[eventRecord('new', 'Свежий результат')] }, error:null };
  });
  const first = f.provider.load();
  await f.provider.load();
  pending.resolve({ data:{ ...workspace(), events:[eventRecord('old', 'Устаревший результат')] }, error:null });
  await first;
  assert.match(f.elements.groupEventsList.innerHTML, /Свежий результат/);
  assert.doesNotMatch(f.elements.groupEventsList.innerHTML, /Устаревший результат/);
});

const clientFields = ['publicGroupClientName', 'publicGroupClientPhone', 'publicGroupClientComment'];
function assertClientReadOnly(f, expected) {
  for (const id of clientFields) assert.equal(f.elements[id].readOnly, expected, `${id} readOnly must be ${expected}`);
}

test('public: lost committed response retries the original full payload despite edited DOM values', async () => {
  const f = fixture(), lostResponse = deferred();
  await f.publicController.load();
  await openPublic(f);
  f.elements.publicGroupClientComment.value = 'Первоначальное пожелание';
  let committed;
  const attempts = [];
  f.override((name, args) => {
    if (name !== 'book_minuta_group_event') return undefined;
    const snapshot = JSON.parse(JSON.stringify(args));
    attempts.push(snapshot);
    if (!committed) { committed = snapshot; return lostResponse.promise; }
    assert.deepEqual(snapshot, committed, 'retry must describe the already committed participant, not edited client data');
    return { data:{ participant_id:'participant-a', status:'confirmed', booking_code:'COMMITTED', idempotent:true }, error:null };
  });
  const first = book(f);
  assertClientReadOnly(f, true);
  lostResponse.reject(new Error('response lost after commit'));
  await first;
  assertClientReadOnly(f, true);
  assert.equal(f.elements.publicSubmit.disabled, false, 'ambiguous attempt must be retryable');
  f.elements.publicGroupClientName.value = 'Другое имя';
  f.elements.publicGroupClientPhone.value = '+79991111111';
  f.elements.publicGroupClientComment.value = 'Другое пожелание';
  await book(f);
  assert.equal(attempts.length, 2);
  assert.equal(f.elements.publicGroupBookingSuccess.hidden, false);
  assert.match(f.elements.publicGroupBookingSuccess.innerHTML, /COMMITTED/);
});

for (const failure of [
  { label:'thrown transport Error mentioning full', thrown:true, error:new Error('group_event_full') },
  { label:'transport-shaped fulfilled error mentioning full', error:{ message:'group_event_full' } },
  { label:'server idempotency mismatch', error:{ code:'22023', message:'group_booking_idempotency_mismatch' } },
  { label:'unrelated code with a business-looking message', error:{ code:'08006', message:'group_event_full' } }
]) {
  test(`public: ${failure.label} cannot unlock ambiguous retry input`, async () => {
    const f = fixture();
    await f.publicController.load();
    await openPublic(f);
    const payloads = [];
    f.override((name, args) => {
      if (name !== 'book_minuta_group_event') return undefined;
      payloads.push(JSON.parse(JSON.stringify(args)));
      if (payloads.length > 1) return { data:{ participant_id:'participant-a', status:'confirmed', booking_code:'RETRIED' }, error:null };
      if (failure.thrown) throw failure.error;
      return { data:null, error:failure.error };
    });
    await book(f);
    assertClientReadOnly(f, true);
    f.elements.publicGroupClientName.value = 'Изменённое имя';
    f.elements.publicGroupClientPhone.value = '+79992222222';
    f.elements.publicGroupClientComment.value = 'Изменённая заметка';
    await book(f);
    assert.deepEqual(payloads[1], payloads[0]);
    assert.equal(f.notices.length, 1);
  });
}

for (const rejection of [
  { code:'22023', message:'invalid_group_participant' },
  { code:'23505', message:'group_event_duplicate_participant' },
  { code:'P0001', message:'group_event_full' },
  { code:'P0001', message:'group_event_started' },
  { code:'P0001', message:'group_event_unavailable' }
]) {
  test(`public: definite ${rejection.message} rejection permits correcting client details`, async () => {
    const f = fixture();
    await f.publicController.load();
    await openPublic(f);
    const attempts = [];
    f.override((name, args) => {
      if (name !== 'book_minuta_group_event') return undefined;
      attempts.push(JSON.parse(JSON.stringify(args)));
      return attempts.length === 1 ? { data:null, error:rejection } : { data:{ participant_id:'participant-a', status:'confirmed', booking_code:'CORRECTED' }, error:null };
    });
    await book(f);
    assertClientReadOnly(f, false);
    assert.equal(f.elements.publicGroupBookingError.hidden, false);
    f.elements.publicGroupClientName.value = 'Исправленное имя';
    f.elements.publicGroupClientPhone.value = '+79993333333';
    f.elements.publicGroupClientComment.value = 'Исправленный комментарий';
    await book(f);
    assert.equal(attempts.length, 2);
    assert.equal(attempts[1].p_request_id, attempts[0].p_request_id);
    assert.equal(attempts[1].p_client_name, 'Исправленное имя');
    assert.equal(attempts[1].p_client_phone, '+79993333333');
    assert.equal(attempts[1].p_comment, 'Исправленный комментарий');
    assert.equal(f.elements.publicGroupBookingSuccess.hidden, false);
  });
}

test('public: cancelled idempotent participant is not presented as a confirmed booking', async () => {
  const f = fixture();
  await f.publicController.load();
  await openPublic(f);
  f.override(name => name === 'book_minuta_group_event'
    ? { data:{ participant_id:'participant-a', status:'cancelled', booking_code:'CANCELLED', idempotent:true }, error:null } : undefined);
  await book(f);
  assert.equal(f.elements.publicGroupBookingSuccess.hidden, true);
  assert.equal(f.elements.publicGroupBookingError.hidden, false);
  assert.match(f.elements.publicGroupBookingError.textContent, /отмен/i);
  assert.equal(f.elements.publicSubmit.disabled, true);
  assert.equal(f.notices.length, 0);
  await f.elements.closePublicGroupBooking.dispatch('click');
  await openPublic(f, 'event-b');
  assert.equal(f.elements.publicSubmit.disabled, false);
  assertClientReadOnly(f, false);
});

test('public: opening a new event after ambiguous failure clears the old frozen payload', async () => {
  const f = fixture();
  await f.publicController.load();
  await openPublic(f);
  f.override(name => { if (name === 'book_minuta_group_event') throw new Error('offline'); });
  await book(f);
  assertClientReadOnly(f, true);
  const previousId = f.elements.publicGroupBookingForm.dataset.requestId;
  await f.elements.closePublicGroupBooking.dispatch('click');
  await openPublic(f, 'event-b');
  assertClientReadOnly(f, false);
  assert.notEqual(f.elements.publicGroupBookingForm.dataset.requestId, previousId);
  f.override(() => undefined);
  await book(f);
  const latest = f.calls.filter(call => call.name === 'book_minuta_group_event').at(-1);
  assert.equal(latest.args.p_event, 'event-b');
  assert.notEqual(latest.args.p_request_id, previousId);
});

test('provider: ambiguous creation preserves input and blocks a potentially duplicate insert', async () => {
  const f = fixture();
  await readyProvider(f);
  const readsBefore = adminLoads(f);
  f.override(name => { if (name === 'upsert_minuta_group_event') throw new Error('reply lost after commit'); });
  await save(f);
  assert.equal(f.elements.groupEventId.value, '');
  assert.equal(f.elements.providerSubmit.disabled, true);
  assert.equal(f.elements.groupEventTitle.value, 'Новая группа');
  assert.equal(f.elements.groupEventDialog.open, true);
  assert.match(f.elements.groupEventError.textContent, /неизвестен/);
  assert.ok(adminLoads(f) > readsBefore, 'refresh list so the administrator can reconcile a possibly committed event');
  await save(f);
  assert.equal(f.calls.filter(call => call.name === 'upsert_minuta_group_event').length, 1);
  assert.equal(f.notices.length, 0);
});

test('provider: a definite creation rejection permits correcting and retrying the draft', async () => {
  const f = fixture();
  await readyProvider(f);
  f.override(name => name === 'upsert_minuta_group_event'
    ? { data:null, error:{ code:'22023', message:'invalid_group_event' } } : undefined);
  await save(f);
  assert.equal(f.elements.providerSubmit.disabled, false);
  assert.equal(f.elements.groupEventError.hidden, false);
  f.elements.groupEventTitle.value = 'Исправленная группа';
  f.override(() => undefined);
  await save(f);
  assert.equal(f.elements.groupEventDialog.open, false);
  assert.equal(f.notices.length, 1);
});

test('provider: an empty fulfilled creation response is ambiguous, not success', async () => {
  const f = fixture();
  await readyProvider(f);
  f.override(name => name === 'upsert_minuta_group_event' ? { data:null, error:null } : undefined);
  await save(f);
  assert.equal(f.elements.groupEventDialog.open, true);
  assert.equal(f.elements.providerSubmit.disabled, true);
  assert.equal(f.notices.length, 0);
  assert.equal(f.elements.groupEventError.hidden, false);
});

for (const data of [null, { status:'confirmed', booking_code:'NO-PARTICIPANT' },
  { participant_id:'participant-a', status:'confirmed', booking_code:'' },
  { participant_id:'participant-a', status:'unknown', booking_code:'UNKNOWN' }]) {
  test(`public: malformed fulfilled booking result ${JSON.stringify(data)} cannot confirm participation`, async () => {
    const f = fixture();
    await f.publicController.load();
    await openPublic(f);
    f.override(name => name === 'book_minuta_group_event' ? { data, error:null } : undefined);
    await book(f);
    assert.equal(f.elements.publicGroupBookingSuccess.hidden, true);
    assert.equal(f.elements.publicGroupBookingError.hidden, false);
    assert.equal(f.elements.publicSubmit.disabled, false);
    assertClientReadOnly(f, true);
    assert.equal(f.notices.length, 0);
  });
}
