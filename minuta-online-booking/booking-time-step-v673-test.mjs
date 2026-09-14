import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const provider = readFileSync(new URL('./provider.js', import.meta.url), 'utf8');
const gridSource = provider.match(/const NEW_BOOKING_GRID_MINUTES = 30;[\s\S]*?function newBookingGridSlots\(slots\) \{[\s\S]*?\n\}/)?.[0];
const functionSource = provider.match(/function bookingRemainingTimeSlots\([\s\S]*?\n\}/)?.[0];
const nearbySource = provider.match(/function bookingNearbyTimeSlots\([\s\S]*?\n\}/)?.[0];
assert.ok(gridSource, 'Не найдены правила получасовой сетки новой записи');
assert.ok(functionSource, 'Не найдена функция подготовки остальных вариантов времени');
assert.ok(nearbySource, 'Не найдена функция ближайших вариантов времени');

const helpers = Function(`${gridSource}; function minutesFromTime(value){const [hours,minutes]=String(value).split(':').map(Number);return hours*60+minutes;} ${nearbySource}; ${functionSource}; return { bookingNearbyTimeSlots, bookingRemainingTimeSlots, newBookingGridSlots };`)();
const slots = ['10:00', '10:01', '10:05', '13:00', '13:25', '13:30', '13:35', '14:00'];
assert.deepEqual(
  helpers.bookingRemainingTimeSlots(slots, ['13:00', '13:30', '14:00'], '13:30'),
  ['10:00', '13:30'],
  'Остальные варианты должны оставаться на сетке :00/:30 и сохранять выбранное время как якорь'
);
assert.deepEqual(helpers.newBookingGridSlots(['10:45', '10:30', '11:00', '11:15', '11:30']), ['10:30', '11:00', '11:30']);
assert.deepEqual(
  helpers.bookingNearbyTimeSlots(['10:30', '11:30', '12:00', '12:30'], '', '11:00'),
  ['10:30', '11:30', '12:00'],
  'Если выбранный получасовой блок занят, рядом остаются ближайшие подтверждённые окна, а не начало дня'
);
assert.ok(provider.includes('data-scroll-time="${scrollTime}"'), 'Список не хранит время, к которому нужно прокрутить');
assert.ok(provider.includes("details.addEventListener('toggle'"), 'Раскрытие списка не запускает прокрутку к выбранному времени');
assert.ok(provider.includes("target.style.gridColumnStart = '1'"), 'Выбранное время не выравнивается первым в строке');
assert.ok(provider.includes('Шаг 30 мин'), 'Подпись раскрытого списка должна честно показывать получасовую сетку');
console.log('Booking half-hour grid checks passed.');
