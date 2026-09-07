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
  id:'base-future', performer_id:'performer-1', service_id:'service-1', booking_date:'2026-09-09', booking_time:'09:30:00',
  duration_minutes:60, total_price_rub:3000,
  services:{ name:'Массаж', price_rub:3000, duration_minutes:60 }, status:'confirmed',
  booking_outcomes:{ visit_status:'scheduled', payment_method:'unpaid', amount_rub:0 }
}];

const first = controller.materialize(baseRows, { organizationId:'demo-org' });
assert.ok(first.generatedRows.some(row => row.booking_date === '2026-09-02'), 'Пропущенный день не дозаполнен');
assert.ok(first.generatedRows.some(row => row.booking_date === '2026-09-10' && row.booking_outcomes.visit_status === 'scheduled'), 'Будущие демо-записи не созданы');
assert.equal(first.rows.some(row => row.id === 'base-1'), true, 'Исходные демо-записи потеряны');
assert.equal(first.rows.find(row => row.id === 'base-future')?.booking_outcomes.visit_status, 'scheduled', 'Будущая исходная запись завершилась слишком рано');

nowMs += 2 * 60 * 1000;
const second = controller.materialize(baseRows, { organizationId:'demo-org' });
assert.equal(second.todayIso, '2026-09-10', 'Виртуальная дата не продолжает жить');
assert.ok(['completed', 'no_show'].includes(second.rows.find(row => row.id === 'base-future')?.booking_outcomes.visit_status), 'Исходные демо-исходы не пересчитываются по виртуальному времени');

const restored = context.window.MinutaDemoLive.create({ storageKey:'test-user', speed:1440, now:() => nowMs });
assert.equal(restored.todayIso(), '2026-09-10', 'Состояние виртуальных суток не сохраняется');
console.log('report demo live checks passed');
