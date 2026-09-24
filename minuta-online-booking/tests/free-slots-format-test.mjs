import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../free-slots-share.js', import.meta.url), 'utf8');
const context = vm.createContext({ window:{} });
vm.runInContext(source.replace('window.MinutaFreeSlots = { createController, calculateFreeWindows }', 'window.MinutaFreeSlots = { buildGeneralPublication, buildPublication, calculateFreeWindows }'), context);
const { buildGeneralPublication:build, buildPublication:buildService, calculateFreeWindows:windows } = context.window.MinutaFreeSlots;
const data = { timeFormat:'hourly', bookingUrl:'https://example.test', performerLabel:'Мастер' };
const row = (start, end, duration) => ({ booking_date:'2026-09-06', start_time:start, end_time:end, duration_minutes:duration });
const full = [row('10:00', '20:00', 600)];
const hourly = build('2026-09-06', '2026-09-06', data, full);
assert.ok(hourly.includes('10:00, 11:00, 12:00, 13:00, 14:00, 15:00, 16:00, 17:00, 18:00, 19:00'));
assert.ok(!hourly.includes('20:00'));
assert.ok(!hourly.includes('Начало свободного часа:'));
assert.ok(!hourly.includes(data.performerLabel));
assert.ok(!build('2026-09-06','2026-09-06',{...data,timeFormat:'intervals'},full).includes(data.performerLabel));
assert.ok(build('2026-09-06', '2026-09-06', {...data,timeFormat:'intervals'}, full).includes('10:00–20:00 · 10 часов'));
assert.ok(!build('2026-09-06', '2026-09-06', {...data,timeFormat:'intervals'}, full).includes('Максимальный непрерывный интервал'));
const busy = build('2026-09-06', '2026-09-06', data, [row('10:00','12:30',150),row('14:20','17:00',160),row('19:30','20:00',30)]);
assert.ok(busy.includes('10:00, 11:00, 15:00, 16:00'));
for (const time of ['12:00','13:00','14:00','17:00','19:00']) assert.ok(!busy.includes(time));
assert.ok(build('2026-09-06','2026-09-06',data,[row('10:15','10:45',30)]).includes('целых свободных часов нет'));
assert.ok(build('2026-09-06','2026-09-06',{...data,timeFormat:'intervals'},[row('10:15','10:45',30)]).includes('10:15–10:45 · 30 мин'));
const emptyGeneral = build('2026-09-06','2026-09-06',data,[]);
assert.ok(emptyGeneral.includes('На выбранный период свободных окон нет.'));
assert.ok(emptyGeneral.includes('день полностью занят'));
const today = windows({from:'2026-09-06',to:'2026-09-06',schedule:[{weekday:7,enabled:true,start_time:'10:00',end_time:'20:00'}],daysOff:[],bookings:[],groups:[],policy:{},now:'2026-09-06T11:32:00Z'});
const todayText = build('2026-09-06','2026-09-06',data,today);
assert.ok(todayText.includes('16:00, 17:00, 18:00, 19:00'));
assert.ok(!todayText.includes('15:00'));
const range = build('2026-09-06','2026-09-08',data,[...full,{...row('11:00','13:00',120),booking_date:'2026-09-08'}]);
assert.ok(range.includes('6 сентября') && range.includes('8 сентября'));
assert.ok(range.includes('11:00, 12:00'));
const compact = build('2026-09-06','2026-09-08',{...data,textLayout:'compact'},[...full,{...row('11:00','13:00',120),booking_date:'2026-09-08'}]);
assert.ok(compact.includes('вс, 6 сентября, 10:00, 11:00'));
assert.ok(compact.includes('\nвт, 8 сентября, 11:00, 12:00'));
assert.ok(!compact.includes('7 сентября') && !compact.includes('макс.'),'Compact publication lists only available days without repeated maximums');
const compactIntervals = build('2026-09-06','2026-09-08',{...data,textLayout:'compact',timeFormat:'intervals'},[...full,{...row('11:00','13:00',120),booking_date:'2026-09-08'}]);
assert.ok(compactIntervals.includes('6 сентября, 10:00–20:00 · 10 часов'));
assert.ok(compactIntervals.includes('8 сентября, 11:00–13:00 · 2 часа'));
assert.ok(!compactIntervals.includes('7 сентября') && !compactIntervals.includes('макс.'));
const spaced = build('2026-09-06','2026-09-08',{...data,textLayout:'compact',blankLine:true},[...full,{...row('11:00','13:00',120),booking_date:'2026-09-08'}]);
assert.ok(spaced.includes('\n\nвт, 8 сентября, 11:00, 12:00'));
const statuses = [
  { booking_date:'2026-09-06', status:'available', max_duration_minutes:600 },
  { booking_date:'2026-09-07', status:'closed', max_duration_minutes:0 },
  { booking_date:'2026-09-08', status:'not_scheduled', max_duration_minutes:0 }
];
const compactEmpty = build('2026-09-06','2026-09-08',{...data,textLayout:'compact'},[],statuses);
assert.equal(compactEmpty,'Свободные окна для записи:\nНа выбранный период свободных окон нет.\n\nПосмотрите другие даты онлайн:\nhttps://example.test');
const statusText = build('2026-09-06','2026-09-08',{...data,timeFormat:'intervals'},full,statuses);
assert.ok(!statusText.includes('Максимальный непрерывный интервал'));
assert.ok(statusText.includes('7 сентября:\nВыходной или день закрыт.'));
assert.ok(statusText.includes('8 сентября:\nРабочий график не задан.'));
const busyText = build('2026-09-06','2026-09-08',{...data,timeFormat:'intervals'},full,[statuses[0],{ booking_date:'2026-09-07', status:'busy' },statuses[2]]);
assert.ok(busyText.includes('7 сентября:\nСвободного времени нет — день полностью занят.'));
assert.ok(!build('2026-09-06','2026-09-06',{...data,showHeading:false},full).startsWith('Свободные окна'));
const serviceCompact = buildService('2026-09-06','2026-09-08',{...data,textLayout:'compact'},[{booking_date:'2026-09-06',booking_time:'10:00'},{booking_date:'2026-09-08',booking_time:'12:00'}]);
assert.ok(serviceCompact.includes('вс, 6 сентября, 10:00\nвт, 8 сентября, 12:00'));
const septemberRange = [
  { booking_date:'2026-09-25', start_time:'10:00', end_time:'20:00', duration_minutes:600 },
  { booking_date:'2026-09-26', start_time:'12:00', end_time:'20:00', duration_minutes:480 }
];
for (const textLayout of ['detailed', 'compact']) for (const timeFormat of ['intervals', 'hourly']) {
  const message = build('2026-09-25', '2026-10-01', { ...data, textLayout, timeFormat }, septemberRange);
  assert.ok(message.includes('25 сентября') && message.includes('26 сентября'));
  assert.equal(message.includes('1 октября'), textLayout === 'detailed');
  assert.ok(message.includes(timeFormat === 'intervals' ? '10:00–20:00 · 10 часов' : '10:00, 11:00'));
  assert.doesNotMatch(message, /Максимальный непрерывный интервал|макс\./i);
}
console.log('PASS: interval/hourly and detailed/compact formats, no repeated maximum in 25 Sep–1 Oct text, empty-day statuses, optional spacing/header, gaps, range and same-day cutoff');
