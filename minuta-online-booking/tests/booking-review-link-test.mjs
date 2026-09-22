import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../provider.js', import.meta.url), 'utf8');
const start = source.indexOf('function bookingReviewLink(item) {');
const end = source.indexOf('\nasync function shareBookingReviewLink', start);
assert.ok(start > 0 && end > start);
const context = vm.createContext({
  URL,
  bookingOutcome: (item) => item.outcome,
  bookingSessionEnd: (item) => new Date(item.end),
});
vm.runInContext(source.slice(start, end), context);
const link = vm.runInContext('bookingReviewLink', context);
const visit = {
  booking_source: 'client_online', request_id: 'fixture-request',
  booking_code: 'MIN-ABCDEF1234', status: 'confirmed',
  outcome: { visit_status: 'completed' }, end: '2026-01-01T10:00:00Z',
};
const href = link(visit);
assert.equal(new URL(href).searchParams.get('review'), visit.booking_code);
assert.equal(new URL(href).pathname, '/bookings');
assert.equal(href.includes('fixture-request'), false);
for (const invalid of [
  { outcome: { visit_status: 'scheduled' } },
  { outcome: { visit_status: 'no_show' } },
  { outcome: { visit_status: 'completed', _sync_pending: true } },
  { end: '2099-01-01T10:00:00Z' },
  { status: 'cancelled' },
  { booking_source: 'provider_manual' },
  { request_id: null },
  { booking_code: 'MIN-ABCDEF1234?phone=79990000000' },
]) assert.equal(link({ ...visit, ...invalid }), '');
console.log('booking review link: PASS');
