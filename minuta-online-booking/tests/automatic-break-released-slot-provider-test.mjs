import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../provider.js', import.meta.url), 'utf8');
const start = source.indexOf('function bookingPlacementIssue(');
const endMarker = source.indexOf('function clearTimelineBookingUndo', start);
const end = source.lastIndexOf('}', endMarker) + 1;
assert.ok(start >= 0 && end > start, 'bookingPlacementIssue must remain extractable');

const date = '2026-09-16';
const sandbox = {
  bookingPolicy:{ booking_buffer_enabled:true, booking_buffer_minutes:60 },
  automaticBookingBreaksRemoteAvailable:true,
  automaticBookingBreakSegments:new Map(),
  allBookings:[{
    id:'booking-15', booking_date:date, booking_time:'15:00:00', duration_minutes:40,
    status:'confirmed', client_phone:'+79990000000', services:{ duration_minutes:40 }
  }],
  scheduleRows:[{ weekday:3, enabled:true, start_time:'10:00:00', end_time:'20:00:00' }],
  daysOff:[],
  isScheduleBlock:() => false,
  businessTodayIso:() => '2026-09-15',
  bookingMoveTimeIsPast:() => false,
  parseLocalIsoDate:value => new Date(`${value}T12:00:00`),
  minutesFromTime:value => {
    const [hours, minutes] = String(value).split(':').map(Number);
    return hours * 60 + minutes;
  },
  timeFromMinutes:value => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
};
vm.createContext(sandbox);
vm.runInContext(`${source.slice(start, end)}\nthis.bookingPlacementIssue = bookingPlacementIssue;`, sandbox);

const issueAt = (time, duration = 15) => sandbox.bookingPlacementIssue(
  { id:'candidate', duration_minutes:duration, client_phone:'+79991111111' },
  date,
  sandbox.minutesFromTime(time),
  { respectAutomaticBreakReleases:true }
);

sandbox.automaticBookingBreakSegments.set(date, []);
assert.equal(issueAt('15:45'), '', 'a fully released after-buffer must become bookable');
assert.match(issueAt('15:30'), /уже есть запись/, 'release must never permit overlap with the real booking');

sandbox.automaticBookingBreakSegments.set(date, [{ start_time:'16:10:00', end_time:'16:40:00' }]);
assert.equal(issueAt('15:45'), '', 'a service that fits before an unreleased remainder must be allowed');
assert.match(issueAt('16:00', 20), /действует перерыв/, 'a service crossing an unreleased remainder must stay blocked');

sandbox.automaticBookingBreakSegments.set(date, [{ start_time:'15:40:00', end_time:'16:40:00' }]);
assert.match(issueAt('15:45'), /действует перерыв/, 'an unreleased automatic break must stay blocked');

sandbox.automaticBookingBreaksRemoteAvailable = false;
sandbox.automaticBookingBreakSegments.set(date, []);
assert.match(issueAt('15:45'), /действует перерыв/, 'missing release state must fail closed');

assert.match(source, /loadAutomaticBookingBreaks\(date, currentUser\?\.id, sessionGeneration\)/,
  'provider slot loading must refresh durable release state for the selected date');
assert.match(source, /new-booking-candidate'[\s\S]{0,240}respectAutomaticBreakReleases:true/,
  'server-returned provider slots must honor released automatic breaks locally');
assert.match(source, /new-booking-validation'[\s\S]{0,260}respectAutomaticBreakReleases:true/,
  'submit preflight must honor released automatic breaks locally');

console.log('automatic break released provider slot regression test passed');
