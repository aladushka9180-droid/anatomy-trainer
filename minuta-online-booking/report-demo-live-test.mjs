import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./report-demo-live.js', import.meta.url), 'utf8');
const storageValues = new Map();
const localStorage = {
  getItem: key => storageValues.get(key) || null,
  setItem: (key, value) => storageValues.set(key, String(value))
};
let nowMs = Date.parse('2026-09-08T12:00:00+04:00');
const context = { window:{}, localStorage, Intl, Date, Object, Map, Set, Math, JSON, String, Number, Array };
vm.runInNewContext(source, context);

const controller = context.window.MinutaDemoLive.create({ storageKey:'test-user', speed:1440, now:() => nowMs });
const baseRows = [{
  id:'base-1', performer_id:'performer-1', service_id:'service-1', booking_date:'2026-09-01', booking_time:'10:00:00',
  duration_minutes:60, original_price_rub:3000, total_price_rub:3000,
  services:{ name:'Массаж', price_rub:3000, duration_minutes:60 }, status:'confirmed'
}, {
  id:'base-today', performer_id:'performer-1', service_id:'service-1', booking_date:'2026-09-08', booking_time:'09:00:00',
  duration_minutes:60, total_price_rub:3000,
  services:{ name:'Массаж', price_rub:3000, duration_minutes:60 }, status:'confirmed',
  booking_outcomes:{ visit_status:'scheduled', payment_method:'unpaid', amount_rub:0 }
}, {
  id:'base-future', performer_id:'performer-1', service_id:'service-1', booking_date:'2026-09-09', booking_time:'09:30:00',
  duration_minutes:60, total_price_rub:3000,
  services:{ name:'Массаж', price_rub:3000, duration_minutes:60 }, status:'confirmed',
  booking_outcomes:{ visit_status:'scheduled', payment_method:'unpaid', amount_rub:0 }
}];

const first = controller.materialize(baseRows, { organizationId:'demo-org' });
assert.equal(first.todayIso, '2026-09-08', 'Демо-календарь не привязан к реальной дате Самары');
assert.ok(first.generatedRows.some(row => row.booking_date === '2026-06-10'), 'Три месяца истории не заполнены');
assert.ok(first.generatedRows.some(row => row.booking_date === '2026-09-02'), 'Пропущенный день не дозаполнен');
assert.ok(first.generatedRows.some(row => row.booking_date === '2026-09-10' && row.booking_outcomes.visit_status === 'scheduled'), 'Будущие демо-записи не созданы');
assert.equal(first.generatedRows.filter(row => row.booking_date === '2026-09-08').length, 4, 'Сегодняшний день не получил живые демо-события поверх исходных записей');
assert.equal(first.rows.some(row => row.id === 'base-1'), true, 'Исходные демо-записи потеряны');
assert.equal(first.rows.find(row => row.id === 'base-future')?.booking_outcomes.visit_status, 'scheduled', 'Будущая исходная запись завершилась слишком рано');
assert.equal(first.rows.find(row => row.id === 'base-today')?.booking_outcomes.visit_status, 'scheduled', 'Сегодняшняя запись завершилась до хода демо-времени');
const firstSlots = new Set(first.rows.map(row => `${row.performer_id}:${row.booking_date}:${row.booking_time}`));
assert.equal(firstSlots.size, first.rows.length, 'Живые события пересекаются с исходными слотами сотрудника');

nowMs += 2 * 60 * 1000;
const second = controller.materialize(baseRows, { organizationId:'demo-org' });
assert.equal(second.todayIso, '2026-09-08', 'Ускорение ошибочно сдвинуло календарную дату');
assert.ok(['completed', 'no_show'].includes(second.rows.find(row => row.id === 'base-today')?.booking_outcomes.visit_status), 'Сегодняшние демо-исходы не меняются с ускоренным временем');
assert.ok(second.generatedRows.filter(row => row.booking_date === '2026-09-08').every(row => row.booking_outcomes.visit_status !== 'scheduled'), 'Сегодняшние живые события не изменили показатели');
assert.equal(second.rows.find(row => row.id === 'base-future')?.booking_outcomes.visit_status, 'scheduled', 'Завтрашняя запись завершилась в текущем календарном дне');

const restored = context.window.MinutaDemoLive.create({ storageKey:'test-user', speed:1440, now:() => nowMs });
assert.equal(restored.todayIso(), '2026-09-08', 'После перезагрузки календарная дата ушла вперёд');

storageValues.set('minuta-demo-live-v1:legacy-user', JSON.stringify({
  version:1,
  virtualNowMs:Date.parse('2027-09-08T12:00:00+04:00'),
  realAtMs:nowMs
}));
const legacy = context.window.MinutaDemoLive.create({ storageKey:'legacy-user', now:() => nowMs });
assert.equal(legacy.todayIso(), '2026-09-08', 'Старые ускоренные часы не сброшены безопасно');

const emptyStorageController = context.window.MinutaDemoLive.create({ storageKey:'empty-user', speed:60, now:() => nowMs });
const emptyFirst = emptyStorageController.materialize([], { organizationId:'demo-org' });
assert.ok(emptyFirst.rows.length > 150, 'Пустой ответ сервера не заменён локальным демо-набором');
const uniqueSlots = new Set(emptyFirst.generatedRows.map(row => `${row.performer_id}:${row.booking_date}:${row.booking_time}`));
assert.equal(uniqueSlots.size, emptyFirst.generatedRows.length, 'Сгенерированы пересекающиеся слоты сотрудника');

nowMs += 8 * 86400000;
const afterIdle = emptyStorageController.materialize([], { organizationId:'demo-org' });
assert.equal(afterIdle.todayIso, '2026-09-16', 'После долгого простоя дата должна совпадать с реальным днём Самары');
assert.ok(afterIdle.rows.length > 150, 'После долгого простоя демо-статистика стала пустой');
for (let offset = -7; offset <= 0; offset += 1) {
  const date = new Date(Date.parse('2026-09-16T12:00:00+04:00') + offset * 86400000).toISOString().slice(0, 10);
  assert.ok(afterIdle.rows.some(row => row.booking_date === date), `Пропущенный день ${date} не заполнен`);
}
console.log('report demo live checks passed');
