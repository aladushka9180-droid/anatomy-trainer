import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../free-slots-share.js', import.meta.url), 'utf8');
const context = vm.createContext({ window:{} });
vm.runInContext(source.replace('window.MinutaFreeSlots = { createController, calculateFreeWindows }',
  'window.MinutaFreeSlots = { calculateFreeWindows, publicationClock, buildGeneralPublication }'), context);
const { calculateFreeWindows:calculate, publicationClock, buildGeneralPublication:build } = context.window.MinutaFreeSlots;
const base = {
  from:'2026-09-06', to:'2026-09-06', now:'2026-09-05T08:00:00Z', performerId:'own', locationId:'here',
  schedule:Array.from({ length:7 }, (_, i) => ({ weekday:i + 1, enabled:true, start_time:'10:00', end_time:'20:00' })),
  daysOff:[], bookings:[], groups:[], policy:null
};
const windows = changes => Array.from(calculate({ ...base, ...changes }), row => `${row.booking_date} ${row.start_time}–${row.end_time} ${row.duration_minutes}`);
const daily = changes => windows(changes).map(value => value.replace('2026-09-06 ', ''));
assert.deepEqual(daily(), ['10:00–20:00 600']);
assert.deepEqual(daily({ now:'2026-09-06T11:32:00Z' }), ['16:00–20:00 240']);
assert.deepEqual(daily({ now:'2026-09-06T12:00:00Z' }), ['16:00–20:00 240']);
assert.deepEqual(daily({ now:'2026-09-06T12:00:01Z' }), ['17:00–20:00 180']);
assert.deepEqual(daily({ now:'2026-09-06T16:01:00Z' }), []);
assert.deepEqual(daily({ now:'2026-09-07T00:00:00Z' }), []);
assert.equal(publicationClock('2026-09-05T20:01:00Z').today, '2026-09-06');
assert.deepEqual(daily({ schedule:base.schedule.map(row => ({ ...row, break_start:'13:00', break_end:'14:00' })) }), ['10:00–13:00 180', '14:00–20:00 360']);
const booking = (time, duration, extra = {}) => ({ booking_date:base.from, booking_time:time, duration_minutes:duration, status:'confirmed', client_phone:'123', ...extra });
assert.deepEqual(daily({ bookings:[booking('11:00', 60), booking('11:30', 90), booking('13:00', 60), booking('17:00', 60, { status:'cancelled' })] }), ['10:00–11:00 60', '14:00–20:00 360']);
assert.deepEqual(daily({ bookings:[booking('12:00', 60)], policy:{ booking_buffer_enabled:true, booking_buffer_minutes:30 } }), ['10:00–11:30 90', '13:30–20:00 390']);
assert.deepEqual(daily({ bookings:[booking('12:00', 60, { client_phone:'0000000000' })], policy:{ booking_buffer_enabled:true, booking_buffer_minutes:30 } }), ['10:00–12:00 120', '13:00–20:00 420']);
assert.deepEqual(daily({ daysOff:[{ off_date:base.from, all_day:true }] }), []);
assert.deepEqual(daily({ daysOff:[{ off_date:base.from, all_day:false, start_time:'12:00', end_time:'13:30' }] }), ['10:00–12:00 120', '13:30–20:00 390']);
assert.deepEqual(daily({ groups:[{ event_date:base.from, start_time:'16:00', duration_minutes:120, status:'published' }, { event_date:base.from, start_time:'10:00', duration_minutes:60, status:'draft' }] }), ['10:00–16:00 360', '18:00–20:00 120']);
assert.deepEqual(daily({ bookings:[booking('19:00', 960, { booking_date:'2026-09-05' })] }), ['11:00–20:00 540']);
const shift = { performer_id:'own', location_id:'here', shift_date:base.from, start_time:'12:00', end_time:'18:00', break_start:'14:00', break_end:'15:00', active:true };
assert.deepEqual(daily({ shifts:{ enabled:true, shifts:[shift, { ...shift, performer_id:'other', start_time:'10:00', end_time:'20:00' }], absences:[] } }), ['12:00–14:00 120', '15:00–18:00 180']);
assert.deepEqual(daily({ shifts:{ enabled:true, shifts:[], absences:[] } }), []);
assert.deepEqual(daily({ shifts:{ enabled:true, shifts:[shift], absences:[{ performer_id:'own', starts_on:base.from, ends_on:base.from, active:true }] } }), []);
assert.deepEqual(daily({ shifts:{ enabled:false, shifts:[], absences:[] } }), ['10:00–20:00 600']);
assert.deepEqual(daily({ bookings:[booking('09:00', 720)] }), []);
assert.throws(() => calculate({ ...base, schedule:[] }), /schedule_not_configured/);
assert.throws(() => calculate({ ...base, bookings:[booking('invalid', 60)] }), /invalid_schedule_time/);
assert.throws(() => calculate({ ...base, bookings:[booking('10:00', 0)] }), /invalid_busy_interval/);
assert.throws(() => calculate({ ...base, daysOff:[{ off_date:base.from, start_time:'13:00', end_time:'12:00' }] }), /invalid_busy_interval/);
const text = build(base.from, base.to, { bookingUrl:'https://example.test', performerLabel:'Рамиль' }, calculate(base));
assert.ok(text.includes('10:00–20:00 · 10 часов'));
assert.ok(text.includes('Выберите услугу'));
assert.ok(text.includes('Рамиль'));
assert.equal(windows({ to:'2026-10-06' }).length, 31);
console.log('PASS: general intervals, 15:32→16:00, midnight, breaks, overlapping bookings, buffers, blocks, days off, groups, shifts, cross-day events, malformed input, 31-day range');
