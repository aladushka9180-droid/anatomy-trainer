import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const box = { window:{} };
vm.runInNewContext(readFileSync(new URL('../provider-connection-guidance.js', import.meta.url), 'utf8'), box);
const { view, createRecoveryTracker } = box.window.MinutaProviderConnectionGuidance;

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
  assert.match(view({ ...basic, sessionTrust:'verified', serverUnavailable:true, canQueueBooking:true, hasSavedSchedule:true }).description, /Неподтверждённую запись можно сохранить/);
  assert.equal(view({ ...basic, sessionTrust:'cached', serverUnavailable:true }).kind, 'session');
  assert.equal(view({ ...basic, sessionTrust:'none', serverUnavailable:true }).kind, 'session');
  assert.equal(view({ ...basic, sessionTrust:'verified' }), null, 'ordinary online stays clear');
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
  assert.match(result.text, /Сохранено 1 запись, 1 запись требует проверки, 1 запись ожидает проверки сервера/);
  assert.equal(tracker.finish('actor-a', { bookingReady:true }), null, 'one summary only');
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
