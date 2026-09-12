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

const now = Date.parse('2026-09-12T08:00:00.000Z');
const freshSnapshot = ({ userId = 'provider-1', savedAt = now, verifiedAt = now, overrides = {} } = {}) => ({
  savedAt:new Date(savedAt).toISOString(),
  data:{
    version:1,
    userId,
    verifiedAt:new Date(verifiedAt).toISOString(),
    bookings:[{ id:'booking-1', booking_date:'2026-09-13' }],
    services:[{ id:'service-1', active:true }],
    schedule:[{ weekday:7, slot_interval_minutes:5 }],
    daysOff:[],
    ...overrides
  }
});

test('offline snapshot is accepted only for the same user while fresh and complete', () => {
  const box = vm.createContext({
    currentUser:{ id:'provider-1' },
    PROVIDER_OFFLINE_SNAPSHOT_VERSION:1,
    PROVIDER_CACHE_MAX_AGE:7 * 24 * 60 * 60 * 1000,
    Date:class extends Date { static now() { return now; } },
    Number,
    Array
  });
  vm.runInContext(actual('validProviderOfflineSnapshot'), box);
  assert.ok(box.validProviderOfflineSnapshot(freshSnapshot()));
  assert.equal(box.validProviderOfflineSnapshot(freshSnapshot({ userId:'provider-2' })), null);
  assert.equal(box.validProviderOfflineSnapshot(freshSnapshot({ savedAt:now - 8 * 24 * 60 * 60 * 1000 })), null);
  assert.equal(box.validProviderOfflineSnapshot(freshSnapshot({ verifiedAt:now - 8 * 24 * 60 * 60 * 1000 })), null);
  assert.equal(box.validProviderOfflineSnapshot(freshSnapshot({ overrides:{ schedule:[] } })), null);
  assert.equal(box.validProviderOfflineSnapshot(freshSnapshot({ overrides:{ bookings:null } })), null);
});

test('invalid persisted snapshot is removed and never authorizes cold offline writes', async () => {
  const removed = [];
  const box = vm.createContext({
    currentUser:{ id:'provider-1' },
    reliability:{
      get:async () => freshSnapshot({ userId:'provider-2' }),
      remove:async key => { removed.push(key); }
    },
    providerOfflineSnapshotKey:userId => `provider:${userId}:offline-booking-snapshot-v1`,
    validProviderOfflineSnapshot:() => null
  });
  vm.runInContext(actual('readProviderOfflineSnapshot'), box);
  assert.equal(await box.readProviderOfflineSnapshot('provider-1'), null);
  assert.deepEqual(removed, ['provider:provider-1:offline-booking-snapshot-v1']);
});

test('verified online core data is persisted as one read-back snapshot', async () => {
  const stored = new Map();
  const box = vm.createContext({
    currentUser:{ id:'provider-1' },
    sessionGeneration:7,
    providerSessionTrust:'verified',
    navigator:{ onLine:true },
    PROVIDER_OFFLINE_SNAPSHOT_VERSION:1,
    SCHEDULE_BLOCK_SERVICE_NAME:'__schedule_block__',
    allBookings:[{ id:'booking-1' }],
    ownServices:[{ id:'service-1', active:true }, { name:'__schedule_block__' }],
    scheduleRows:[{ weekday:7 }],
    daysOff:[],
    cachePayload:(_name, value) => value,
    sessionIsCurrent:(userId, generation) => userId === 'provider-1' && generation === 7,
    providerOfflineSnapshotKey:userId => `provider:${userId}:offline-booking-snapshot-v1`,
    reliability:{
      put:async (key, data) => { stored.set(key, { savedAt:new Date(now).toISOString(), data }); },
      get:async key => stored.get(key)
    },
    readProviderOfflineSnapshot:async userId => stored.get(`provider:${userId}:offline-booking-snapshot-v1`),
    Date:class extends Date { static now() { return now; } }
  });
  vm.runInContext(actual('saveProviderOfflineSnapshot'), box);
  const snapshot = await box.saveProviderOfflineSnapshot('provider-1', 7);
  assert.equal(snapshot.data.userId, 'provider-1');
  assert.equal(snapshot.data.services.length, 1);
  assert.equal(snapshot.data.bookings.length, 1);
  assert.equal(stored.size, 1);
});

test('provider synchronization commits the atomic snapshot before advertising offline readiness', () => {
  const synchronization = actual('synchronizeProvider');
  assert.match(synchronization, /providerSessionTrust !== 'verified'/);
  assert.match(synchronization, /offlineBookingAccessReady = false;[\s\S]*Promise\.allSettled/);
  assert.match(synchronization, /primarySnapshotVerified[\s\S]*saveProviderOfflineSnapshot\(userId, generation\)/);
  assert.match(synchronization, /offlineBookingAccessReady = Boolean\(offlineSnapshot\)/);
  const hydration = actual('hydrateOfflineBookingInputs');
  assert.match(hydration, /readProviderOfflineSnapshot\(userId\)[\s\S]*applyProviderOfflineSnapshot\(offlineSnapshot, userId, generation\)/);
  assert.match(actual('applyProviderOfflineSnapshot'), /allBookings = offlineSnapshot\.data\.bookings[\s\S]*ownServices = offlineSnapshot\.data\.services[\s\S]*scheduleRows = offlineSnapshot\.data\.schedule[\s\S]*daysOff = offlineSnapshot\.data\.daysOff[\s\S]*offlineBookingAccessReady = true/);
  assert.match(source, /clearProviderDeviceData[\s\S]*removePrefix\(`provider:\$\{userId\}:`\)/);
});

test('atomic snapshot restore replaces every booking input as one guarded unit', () => {
  const box = vm.createContext({
    currentUser:{ id:'provider-1' },
    sessionGeneration:7,
    SCHEDULE_BLOCK_SERVICE_NAME:'__schedule_block__',
    allBookings:[{ id:'mixed-booking' }],
    ownServices:[{ id:'mixed-service' }],
    scheduleRows:[{ weekday:1 }],
    daysOff:[{ date:'2026-09-01' }],
    offlineBookingInputsReady:false,
    offlineBookingAccessReady:false,
    validProviderOfflineSnapshot:snapshot => snapshot,
    sessionIsCurrent:(userId, generation) => userId === 'provider-1' && generation === 7,
    $:() => ({ value:'' }),
    syncSlotIntervalOptions() {}, renderOwnServices() {}, renderSchedule() {}, renderDaysOff() {}, renderBookings() {}, applyWriteAvailability() {}
  });
  vm.runInContext(actual('applyProviderOfflineSnapshot'), box);
  const snapshot = freshSnapshot();
  assert.equal(box.applyProviderOfflineSnapshot(snapshot, 'provider-1', 7), true);
  assert.equal(box.allBookings[0].id, 'booking-1');
  assert.equal(box.ownServices[0].id, 'service-1');
  assert.equal(box.scheduleRows[0].weekday, 7);
  assert.equal(box.daysOff.length, 0);
  assert.equal(box.offlineBookingInputsReady, true);
  assert.equal(box.offlineBookingAccessReady, true);
});

test('cached trust fails closed before synchronization or queue flush can call the server', async () => {
  let rpcCalls = 0;
  const box = vm.createContext({
    sessionGeneration:7,
    currentUser:{ id:'provider-1' },
    providerSessionTrust:'cached',
    navigator:{ onLine:true },
    synchronizationPromise:null,
    offlineBookingFlushPromise:null,
    writesAllowed:true,
    bookingCreationReady:true,
    db:{ rpc:async () => { rpcCalls += 1; return { error:null }; } }
  });
  vm.runInContext([actual('synchronizeProvider'), actual('flushOfflineBookings')].join('\n'), box);
  assert.equal(await box.synchronizeProvider(), false);
  assert.equal(await box.flushOfflineBookings(), false);
  assert.equal(rpcCalls, 0);
  assert.match(actual('flushOfflineBookings'), /providerSessionTrust !== 'verified'[\s\S]*db\.rpc\('book_appointment'/);
  assert.match(source, /window\.addEventListener\('online', async \(\) => \{\s*if \(providerSessionTrust === 'cached'[\s\S]*await verifyCachedProviderSession\(currentUser\.id\);\s*return;/);
});

test('offline status distinguishes a usable snapshot from incomplete cached data', () => {
  const box = vm.createContext({
    canQueueOfflineBooking:() => true,
    currentUser:{ id:'provider-1' },
    offlineBookingAccessReady:true,
    offlineBookingInputsReady:true,
    offlineBookingSnapshotFresh:() => true,
    ownServices:[{ active:true }]
  });
  vm.runInContext(actual('offlineBookingStatusText'), box);
  assert.equal(box.offlineBookingStatusText(), 'Офлайн · можно создавать отложенные записи');
  box.canQueueOfflineBooking = () => false;
  box.offlineBookingAccessReady = false;
  assert.equal(box.offlineBookingStatusText(), 'Офлайн-копия есть, но не подтверждена для записи · только чтение');
  box.offlineBookingInputsReady = false;
  assert.equal(box.offlineBookingStatusText(), 'Нет полной офлайн-копии · только чтение');
});
