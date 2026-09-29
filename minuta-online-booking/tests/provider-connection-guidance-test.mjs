import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const box = { window:{} };
vm.runInNewContext(readFileSync(new URL('../provider-connection-guidance.js', import.meta.url), 'utf8'), box);
const { view, shouldRecoverCachedSession, createRecoveryTracker } = box.window.MinutaProviderConnectionGuidance;
const providerSource = readFileSync(new URL('../provider.js', import.meta.url), 'utf8');

test('offline promise requires a usable saved schedule and booking gate', () => {
  const basic = { online:false, hasUser:true, sessionTrust:'cached' };
  assert.match(view({ ...basic, canQueueBooking:true, hasSavedSchedule:true }).description, /смотреть сохранённые записи и добавлять новые/);
  assert.doesNotMatch(view({ ...basic, canQueueBooking:false, hasSavedSchedule:true }).description, /добавлять новые/);
  assert.match(view({ ...basic, canQueueBooking:false, hasSavedSchedule:false }).description, /расписание недоступно/);
  assert.doesNotMatch(view({ ...basic, canQueueBooking:true, hasSavedSchedule:false }).description, /добавлять новые/);
  assert.equal(view({ ...basic, hasUser:false }), null);
});

test('online transport failure and unverified session never claim internet loss or saved booking', () => {
  const basic = { online:true, hasUser:true };
  const server = view({ ...basic, sessionTrust:'verified', serverUnavailable:true, canQueueBooking:false });
  assert.equal(server.title, 'Нет связи с сервером');
  assert.match(server.description, /Повторим автоматически/);
  assert.doesNotMatch(server.description, /сохранить на устройстве/);
  assert.equal(server.help, false);
  assert.match(view({ ...basic, sessionTrust:'verified', serverUnavailable:true, canQueueBooking:true, hasSavedSchedule:true }).description, /сохраним на устройстве/);
  assert.equal(view({ ...basic, sessionTrust:'cached', serverUnavailable:true }).kind, 'session');
  assert.equal(view({ ...basic, sessionTrust:'none', serverUnavailable:true }).kind, 'session');
  assert.equal(view({ ...basic, sessionTrust:'verified' }), null, 'ordinary online stays clear');
});

test('pending access verification explains usable offline booking without promising confirmation', () => {
  const basic = { online:true, hasUser:true, sessionTrust:'cached', hasSavedSchedule:true };
  const usable = view({ ...basic, canQueueBooking:true });
  assert.equal(usable.title, 'Проверяем доступ');
  assert.match(usable.description, /смотреть сохранённые записи и добавлять новые/);
  assert.match(usable.description, /на устройстве.*проверим доступ и свободное время/);
  assert.doesNotMatch(usable.description, /недоступны|подтверждены/);
  assert.doesNotMatch(view({ ...basic, canQueueBooking:false }).description, /добавлять новые|сохраним на устройстве/);
  assert.doesNotMatch(view({ ...basic, hasSavedSchedule:false, canQueueBooking:true }).description, /смотреть сохранённые|добавлять новые|сохраним на устройстве/);
});

test('recovery reports only confirmed queue IDs and actual remaining conflicts', () => {
  const tracker = createRecoveryTracker();
  assert.equal(tracker.start('actor-a'), true);
  assert.equal(tracker.start('actor-a'), false, 'repeated click does not reset counts');
  tracker.snapshot('actor-a', [{ id:'one' }, { id:'two' }, { id:'three' }]);
  assert.equal(tracker.confirm('actor-a', 'one'), true);
  assert.equal(tracker.confirm('actor-a', 'one'), true);
  assert.equal(tracker.confirm('actor-a', 'foreign'), false);
  assert.equal(tracker.finish('actor-a', { bookingReady:false }), null, 'online event alone is not server proof');
  const result = tracker.finish('actor-a', { bookingReady:true, complete:true, queue:[
    { id:'two', status:'conflict' }, { id:'three', status:'pending' }, { id:'foreign', status:'conflict' }
  ] });
  assert.equal(result.saved, 1);
  assert.equal(result.conflicts, 1);
  assert.equal(result.pending, 1);
  assert.match(result.text, /Сохранена 1 запись, 1 запись требует проверки, 1 запись ожидает проверки сервера/);
  assert.equal(tracker.finish('actor-a', { bookingReady:true }), null, 'one summary only');
});

test('confirmed booking counts use natural Russian agreement', () => {
  for (const [count, expected] of [
    [1, 'Сохранена 1 запись'], [2, 'Сохранены 2 записи'], [3, 'Сохранены 3 записи'],
    [5, 'Сохранено 5 записей'], [11, 'Сохранено 11 записей'], [21, 'Сохранена 21 запись']
  ]) {
    const tracker = createRecoveryTracker();
    tracker.start('actor');
    const queue = Array.from({ length:count }, (_, index) => ({ id:`booking-${index}` }));
    tracker.snapshot('actor', queue);
    for (const item of queue) tracker.confirm('actor', item.id);
    assert.equal(tracker.finish('actor', { bookingReady:true, complete:true }).text, expected);
  }
});

test('created booking with pending notification is counted in separate outcomes', () => {
  const tracker = createRecoveryTracker();
  tracker.start('actor');
  tracker.snapshot('actor', [{ id:'created' }]);
  tracker.confirm('actor', 'created');
  const result = tracker.finish('actor', { bookingReady:true, complete:true, queue:[{ id:'created', status:'notification_pending' }] });
  assert.equal(result.saved, 1);
  assert.equal(result.pending, 0);
  assert.equal(result.notifications, 1);
  assert.equal(result.text, 'Сохранена 1 запись, 1 уведомление клиенту ожидает отправки');

  const afterReload = createRecoveryTracker();
  afterReload.start('actor');
  afterReload.snapshot('actor', [{ id:'created', status:'notification_pending', bookingCreationConfirmed:true }]);
  const later = afterReload.finish('actor', { bookingReady:true, complete:true, queue:[{ id:'created', status:'notification_pending', bookingCreationConfirmed:true }] });
  assert.equal(later.saved, 0, 'previously confirmed booking is not counted again');
  assert.equal(later.notifications, 1);
  assert.equal(later.text, '1 уведомление клиенту ожидает отправки');
});

test('account change and ordinary online state do not leak stale summary', () => {
  const tracker = createRecoveryTracker();
  assert.equal(tracker.finish('actor-a', { bookingReady:true }), null);
  tracker.start('actor-a');
  tracker.snapshot('actor-a', [{ id:'one' }]);
  tracker.confirm('actor-a', 'one');
  tracker.reset();
  assert.equal(tracker.finish('actor-a', { bookingReady:true }), null);
  tracker.start('actor-b');
  assert.equal(tracker.finish('actor-a', { bookingReady:true }), null);
  const result = tracker.finish('actor-b', { bookingReady:true, complete:true });
  assert.equal(result.text, 'Записи и расписание обновлены');
  assert.equal(view({ online:true, hasUser:true, sessionTrust:'verified', recovery:result }).inspect, true);
});

test('cached offline session enters one recovery after server access is verified', () => {
  const session = providerSource.slice(providerSource.indexOf('async function handleSession('), providerSource.indexOf('async function loadProviderDisplayName('));
  assert.match(session, /recoveringCachedSession = window\.MinutaProviderConnectionGuidance\?\.shouldRecoverCachedSession/);
  assert.match(session, /if \(recoveringCachedSession\) beginConnectionGuidanceRecovery\(\);\s*if \(navigator\.onLine[^\n]+\n\s*await synchronizeProvider\(\)/);
  const online = providerSource.slice(providerSource.indexOf("window.addEventListener('online', async () => {", providerSource.indexOf("window.addEventListener('offline', async () => {")));
  assert.match(online, /await verifyCachedProviderSession\(currentUser\.id\);\s*if \(connectionWasOffline && providerSessionTrust === 'verified'\) finishConnectionGuidanceRecovery/);
  const verified = { sameUser:true, previousTrust:'cached', accessVerified:true, online:true };
  assert.equal(shouldRecoverCachedSession({ ...verified, outageObserved:false }), false, 'normal online cached bootstrap stays quiet');
  assert.equal(shouldRecoverCachedSession({ ...verified, outageObserved:true }), true, 'cold offline recovery starts after access check');
  assert.equal(shouldRecoverCachedSession({ ...verified, accessVerified:false, outageObserved:true }), false, 'failed verification does not start recovery');
  assert.equal(shouldRecoverCachedSession({ ...verified, outageObserved:true }), true, 'successful retry still sees observed outage');
  const tracker = createRecoveryTracker();
  tracker.start('actor');
  tracker.snapshot('actor', [{ id:'accepted' }]);
  tracker.confirm('actor', 'accepted');
  assert.equal(tracker.finish('actor', { bookingReady:true, complete:true }).text, 'Сохранена 1 запись');
  assert.equal(tracker.finish('actor', { bookingReady:true, complete:true }), null, 'one final outcome');
});

test('manual check is single-flight and never claims a missing offline copy', async () => {
  const start = providerSource.indexOf('async function manualSynchronizeProvider()');
  const end = providerSource.indexOf('function cachedStateText(', start);
  assert.ok(start >= 0 && end > start);
  const messages = [];
  let completeSync;
  const waiting = new Promise(resolve => { completeSync = resolve; });
  let calls = 0;
  const button = { disabled:false, classList:{ add() {}, remove() {} } };
  const context = vm.createContext({
    currentUser:{ id:'actor' }, navigator:{ onLine:false }, offlineBookingAccessReady:false,
    providerSessionTrust:'verified', sessionGeneration:1, sessionIsCurrent:() => true,
    offlineBookingInputsReady:false, offlineBookingSnapshotFresh:() => false,
    notify:text => messages.push(text), recordConnectionEvent() {},
    $:() => button, manualSynchronizationPromise:null, synchronizationPromise:null,
    synchronizeProvider:() => { calls++; return waiting; }, bookingCreationReady:false,
    pendingBookingColors:new Set(), pendingBookingNotes:new Set(), pendingClientLabels:new Set(), pendingClientNotes:new Map()
  });
  vm.runInContext(providerSource.slice(start, end), context);
  assert.equal(await context.manualSynchronizeProvider(), false);
  assert.deepEqual(messages, ['Нет интернета · проверьте подключение']);
  context.navigator.onLine = true;
  const first = context.manualSynchronizeProvider();
  const second = context.manualSynchronizeProvider();
  assert.equal(calls, 1);
  completeSync(true);
  assert.equal(await first, true);
  assert.equal(await second, true);
  assert.equal(calls, 1);
  assert.equal(button.disabled, false);
});
