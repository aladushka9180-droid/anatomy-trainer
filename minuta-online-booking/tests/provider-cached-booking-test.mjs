import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../provider.js', import.meta.url), 'utf8');
function actual(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, name);
  const next = source.slice(start + 1).search(/^(?:async )?function /m);
  return source.slice(start, next < 0 ? undefined : start + next + 1);
}
function fixture(overrides = {}) {
  const box = vm.createContext({
    navigator:{ onLine:true }, currentUser:{ id:'actor' }, sessionGeneration:1,
    providerSessionTrust:'cached', providerVerifiedSessionExpiresAt:0,
    bookingReadConnectionUnavailable:false,
    offlineBookingAccessReady:true, offlineBookingInputsReady:true,
    bookingsSnapshotSavedAt:new Date().toISOString(), PROVIDER_CACHE_MAX_AGE:7 * 86400000,
    ownServices:[{ id:'service', active:true }], writesAllowed:false, bookingCreationReady:false,
    offlineBookingQueue:[], offlineBookingFlushPromise:null, ...overrides
  });
  vm.runInContext(['offlineBookingSnapshotFresh', 'bookingDeferredMode', 'canQueueOfflineBooking',
    'offlineBookingStatusText', 'flushOfflineBookings'].map(actual).join('\n'), box);
  return box;
}

test('online indicator does not prevent local booking while a saved session is being verified', () => {
  const box = fixture();
  assert.equal(box.bookingDeferredMode(), true);
  assert.equal(box.canQueueOfflineBooking(), true);
  assert.match(box.offlineBookingStatusText(), /Можно сохранить.*на устройстве/);
  assert.doesNotMatch(box.offlineBookingStatusText(), /Сервер недоступен|только чтение/);
});

test('cached online booking still needs a fresh complete snapshot, a user and an active service', () => {
  for (const overrides of [
    { offlineBookingAccessReady:false }, { offlineBookingInputsReady:false },
    { bookingsSnapshotSavedAt:new Date(Date.now() - 8 * 86400000).toISOString() },
    { bookingsSnapshotSavedAt:'' }, { ownServices:[{ active:false }] },
    { currentUser:null }, { providerSessionTrust:'none' }
  ]) assert.equal(fixture(overrides).canQueueOfflineBooking(), false, JSON.stringify(overrides));
});

test('verified online and outage/expiry gates keep their existing behavior', () => {
  const box = fixture({ providerSessionTrust:'verified' });
  assert.equal(box.bookingDeferredMode(), false);
  assert.equal(box.canQueueOfflineBooking(), false);
  box.bookingReadConnectionUnavailable = true;
  assert.equal(box.bookingDeferredMode(), true);
  assert.equal(box.canQueueOfflineBooking(), false, 'expired verified session cannot queue through outage gate');
  box.providerVerifiedSessionExpiresAt = Date.now() + 3600000;
  assert.equal(box.canQueueOfflineBooking(), true);
  box.navigator.onLine = false;
  box.providerVerifiedSessionExpiresAt = 0;
  assert.equal(box.canQueueOfflineBooking(), true);
});

test('cached mode durably saves one pending draft without calling the server', async () => {
  const stored = new Map();
  const box = fixture({
    editingOfflineBookingId:'', offlineBookingSavePromise:Promise.resolve(),
    reliability:{ put:async (key, data) => stored.set(key, JSON.parse(JSON.stringify(data))),
      get:async key => ({ data:stored.get(key) }) },
    sessionIsCurrent:(id, generation) => id === 'actor' && generation === 1,
    normalizePhone:value => String(value).replace(/\D/g, ''),
    normalizePerMinuteDuration:value => value, createOfflineBookingId:() => 'draft-1',
    BOOKING_COLOR_KEYS:['auto'], BOOKING_COLOR_DEFAULT:'auto', renderOfflineBookingQueue() {},
    db:new Proxy({}, { get() { throw new Error('Unexpected remote booking call'); } })
  });
  vm.runInContext(['offlineBookingQueueKey', 'saveOfflineBookingQueue', 'queueOfflineBooking'].map(actual).join('\n'), box);
  const payload = { serviceId:'service', clientName:'Тест', clientPhone:'70000000001', date:'2026-10-01', time:'12:00' };
  assert.equal((await box.queueOfflineBooking(payload)).ok, true);
  assert.equal((await box.queueOfflineBooking(payload)).duplicate, true);
  assert.equal(stored.get('minuta-offline-bookings-v1:actor').length, 1);
  assert.equal(stored.get('minuta-offline-bookings-v1:actor')[0].status, 'pending');
  assert.equal(await box.flushOfflineBookings(), false);
  assert.equal(box.offlineBookingQueue.length, 1, 'verification must happen before sending');
  box.providerSessionTrust = 'none';
  assert.equal((await box.queueOfflineBooking({ ...payload, time:'13:00' })).ok, false);
});

test('a failed local save is not reported as a saved booking', async () => {
  const box = fixture({
    editingOfflineBookingId:'', normalizePhone:value => value, normalizePerMinuteDuration:value => value,
    createOfflineBookingId:() => 'draft-1', BOOKING_COLOR_KEYS:['auto'], BOOKING_COLOR_DEFAULT:'auto',
    saveOfflineBookingQueue:async () => false, renderOfflineBookingQueue() {}
  });
  vm.runInContext(actual('queueOfflineBooking'), box);
  assert.equal((await box.queueOfflineBooking({ serviceId:'service', date:'2026-10-01', time:'12:00' })).ok, false);
  assert.equal(box.offlineBookingQueue.length, 0);
});

test('the booking form submits cached online creation through the local queue only', async () => {
  const fields = Object.fromEntries(Object.entries({
    newBookingName:'Тест', newBookingPhone:'70000000001', newBookingService:'service',
    newBookingDate:'2099-10-01', newBookingNote:'', newBookingFlexibleEnd:'13:00',
    newBookingOccurrences:'1', newBookingInterval:'1'
  }).map(([key, value]) => [`#${key}`, { value }]));
  fields['#newBookingForm'] = { dataset:{} };
  fields['#newBookingSubmit'] = { disabled:false, textContent:'' };
  const messages = [];
  let saved;
  const box = fixture({
    $:selector => fields[selector], newBookingRepeatVisit:null, newBookingMode:'client',
    newBookingTime:'12:00', newBookingSlots:[], newBookingHistoricalMode:false,
    newBookingDurationMinutes:() => 60, ownServices:[{ id:'service', active:true, duration_minutes:60 }],
    businessTodayIso:() => '2099-09-30', normalizePhone:value => value,
    isNewBookingGridTime:() => true, BOOKING_COLOR_DEFAULT:'auto',
    editingOfflineBookingId:'', readProviderBookingAttempt:() => null,
    queueOfflineBooking:async payload => { saved = payload; return { ok:true }; },
    clearNewBookingDraft() {}, closeBookingSheet() {}, renderOfflineBookingQueue() {}, refreshNewBookingCard() {},
    recordConnectionEvent() {}, notify:message => messages.push(message), bookingUsesDemoData:() => false,
    showFormError:(_selector, message) => assert.fail(message),
    db:new Proxy({}, { get() { throw new Error('Unexpected remote booking call'); } })
  });
  vm.runInContext(['requireBookingWrites', 'updateNewBookingSubmitCaption', 'createNewBooking'].map(actual).join('\n'), box);
  box.updateNewBookingSubmitCaption();
  assert.equal(fields['#newBookingSubmit'].disabled, false);
  assert.equal(fields['#newBookingSubmit'].textContent, 'Сохранить до подключения');
  await box.createNewBooking({ preventDefault() {}, currentTarget:fields['#newBookingForm'] });
  assert.equal(saved.time, '12:00');
  assert.equal(saved.latestTime, '13:00');
  assert.match(messages.at(-1), /сохранена на устройстве/);
});
