import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./provider.js', import.meta.url), 'utf8');
const declaration = name => {
  const match = source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`));
  assert.ok(match, `Missing ${name}`);
  return match[0];
};
const helpers = Function(`
  const NEW_BOOKING_GRID_MINUTES = 30;
  ${['isNewBookingGridTime', 'isNewBookingFiveMinuteTime', 'newBookingGridSlots',
    'bookingNearbyTimeSlots', 'bookingRemainingTimeSlots'].map(declaration).join('\n')}
  function minutesFromTime(value) { const [hours, minutes] = value.split(':').map(Number); return hours * 60 + minutes; }
  return { isNewBookingFiveMinuteTime, newBookingGridSlots, bookingNearbyTimeSlots, bookingRemainingTimeSlots };
`)();

const slots = ['10:00', '10:05', '10:10', '10:25', '10:30', '10:35', '10:45', '11:00', '11:07'];
assert.equal(helpers.isNewBookingFiveMinuteTime('10:25'), true);
assert.equal(helpers.isNewBookingFiveMinuteTime('10:27'), false);
assert.deepEqual(helpers.newBookingGridSlots(slots), ['10:00', '10:30', '11:00'], 'Client booking remains half-hour only');
assert.deepEqual(helpers.bookingRemainingTimeSlots(slots, ['10:00', '10:30', '11:00'], '', 5),
  ['10:05', '10:10', '10:25', '10:35', '10:45'], 'Block disclosure offers five-minute times');
assert.ok(helpers.bookingNearbyTimeSlots(slots, '10:25', '10:25').includes('10:25'),
  'Selected exact block time remains visible after picker rerender');
assert.match(source, /newBookingMode === 'block'[\s\S]*?serverTimes\.filter\(isNewBookingFiveMinuteTime\)/,
  'Only block mode accepts five-minute server slots');
assert.match(source, /block \? isNewBookingFiveMinuteTime\(newBookingTime\) : isNewBookingGridTime\(newBookingTime\)/,
  'Submission validates each mode against its own time grid');
console.log('Block five-minute selection checks passed.');
