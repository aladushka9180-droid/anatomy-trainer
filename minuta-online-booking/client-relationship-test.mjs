import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const directory = path.dirname(fileURLToPath(import.meta.url));
const source = await readFile(path.join(directory, 'client-relationship.js'), 'utf8');
const context = { window:{} };
vm.createContext(context);
vm.runInContext(source, context);

const { relationship, reliability, visitWord } = context.window.PrimeTimeClientRelationship;

assert.deepEqual(
  [0, 1, 3, 8, 12].map(visits => {
    const item = relationship({ completedVisits:visits });
    return [item.level, item.title];
  }),
  [
    [0, 'Новый клиент'],
    [1, 'Первый визит'],
    [2, 'Возвращается'],
    [3, 'Постоянный клиент'],
    [4, 'С нами давно']
  ]
);

assert.equal(relationship({ completedVisits:2, importedVisits:6 }).visits, 6);
assert.equal(relationship({ completedVisits:1 }).milestone, 'До уровня «Возвращается» — 2 визита');
assert.equal(relationship({ completedVisits:12 }).progress, 1);
assert.ok(relationship({ completedVisits:0 }).progress >= 0);
assert.ok(relationship({ completedVisits:7 }).progress < relationship({ completedVisits:8 }).progress);
assert.equal(visitWord(1), 'визит');
assert.equal(visitWord(3), 'визита');
assert.equal(visitWord(12), 'визитов');

const activity = [
  { bookingDate:'2026-09-08', bookingTime:'10:00', status:'cancelled', cancellationReason:'client', visitStatus:'scheduled' },
  { bookingDate:'2026-09-07', bookingTime:'10:00', status:'active', cancellationReason:'', visitStatus:'no_show' },
  { bookingDate:'2026-09-06', bookingTime:'10:00', status:'cancelled', cancellationReason:'provider', visitStatus:'scheduled' },
  { bookingDate:'2026-09-05', bookingTime:'10:00', status:'cancelled', cancellationReason:'payment_expired', visitStatus:'scheduled' },
  { bookingDate:'2026-09-04', bookingTime:'10:00', status:'cancelled', cancellationReason:'', visitStatus:'scheduled' },
  { bookingDate:'2026-09-03', bookingTime:'10:00', status:'active', cancellationReason:'', visitStatus:'completed' }
];
const warning = reliability(activity);
assert.equal(warning.clientCancellations, 1);
assert.equal(warning.noShows, 1);
assert.equal(warning.signals, 2);
assert.equal(warning.needsAttention, true);
assert.equal(warning.severity, 'risk');
assert.equal(warning.title, 'Подтвердите запись заранее');
assert.match(warning.label, /1 отмена клиентом и 1 неявка из последних 6 записей/);

const unknownCancellationNotice = reliability([
  { bookingDate:'2026-09-08', bookingTime:'10:00', status:'cancelled', cancellationReason:'', visitStatus:'scheduled' },
  { bookingDate:'2026-09-07', bookingTime:'10:00', status:'cancelled', cancellationReason:'', visitStatus:'scheduled' },
  { bookingDate:'2026-09-06', bookingTime:'10:00', status:'active', cancellationReason:'', visitStatus:'completed' }
]);
assert.equal(unknownCancellationNotice.signals, 0, 'Unknown cancellation reasons do not accuse the client');
assert.equal(unknownCancellationNotice.totalCancellations, 2);
assert.equal(unknownCancellationNotice.unknownCancellations, 2);
assert.equal(unknownCancellationNotice.needsAttention, true);
assert.equal(unknownCancellationNotice.severity, 'notice');
assert.match(unknownCancellationNotice.label, /2 отмены из последних 3 записей — проверьте причины/);

const providerCancellationNotice = reliability([
  { bookingDate:'2026-09-08', bookingTime:'10:00', status:'cancelled', cancellationReason:'provider', visitStatus:'scheduled' },
  { bookingDate:'2026-09-07', bookingTime:'10:00', status:'cancelled', cancellationReason:'provider', visitStatus:'scheduled' }
]);
assert.equal(providerCancellationNotice.clientCancellations, 0);
assert.equal(providerCancellationNotice.severity, 'notice');
assert.doesNotMatch(providerCancellationNotice.label, /клиентом/);

const oldCancellation = { bookingDate:'2025-01-01', bookingTime:'10:00', status:'cancelled', cancellationReason:'client', visitStatus:'scheduled' };
const recentCompleted = Array.from({ length:8 }, (_, index) => ({
  bookingDate:`2026-08-${String(20 + index).padStart(2, '0')}`,
  bookingTime:'10:00', status:'active', cancellationReason:'', visitStatus:'completed'
}));
assert.equal(reliability([oldCancellation, ...recentCompleted]).signals, 0, 'Only the latest eight resolved records affect the signal');

console.log('Client relationship rules: PASS');
