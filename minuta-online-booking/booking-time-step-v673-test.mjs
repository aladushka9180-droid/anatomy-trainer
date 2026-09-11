import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const provider = readFileSync(new URL('./provider.js', import.meta.url), 'utf8');
const functionSource = provider.match(/function bookingRemainingTimeSlots\([\s\S]*?\n\}/)?.[0];
assert.ok(functionSource, 'Не найдена функция подготовки остальных вариантов времени');

const bookingRemainingTimeSlots = Function(`${functionSource}; return bookingRemainingTimeSlots;`)();
const slots = ['10:00', '10:01', '10:05', '13:00', '13:25', '13:30', '13:35', '14:00'];
assert.deepEqual(
  bookingRemainingTimeSlots(slots, ['13:00', '13:30', '14:00'], '13:30'),
  ['10:00', '10:05', '13:25', '13:30', '13:35'],
  'Остальные варианты должны идти с шагом 5 минут и сохранять выбранное время как якорь'
);
assert.ok(provider.includes('data-scroll-time="${scrollTime}"'), 'Список не хранит время, к которому нужно прокрутить');
assert.ok(provider.includes("details.addEventListener('toggle'"), 'Раскрытие списка не запускает прокрутку к выбранному времени');
assert.ok(provider.includes("target.style.gridColumnStart = '1'"), 'Выбранное время не выравнивается первым в строке');
console.log('Booking time step v701 checks passed.');
