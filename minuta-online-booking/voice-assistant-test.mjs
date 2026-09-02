import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const voice = require('./voice-assistant.js');
const now = new Date(2026, 8, 2, 12, 0, 0);

const services = [
  { id:'massage', name:'Массаж', durationMinutes:60 },
  { id:'sport', name:'Спортивный массаж', durationMinutes:60 },
  { id:'hair', name:'Укладка волос', durationMinutes:45 },
  { id:'brows', name:'Укладка бровей', durationMinutes:30 },
  { id:'cut', name:'Стрижка', durationMinutes:45 }
];

assert.equal(voice.normalizeText('  Ёлка, МАССАЖ!  '), 'елка массаж');

assert.equal(voice.parseRussianDate('сегодня', now), '2026-09-02');
assert.equal(voice.parseRussianDate('завтра', now), '2026-09-03');
assert.equal(voice.parseRussianDate('послезавтра', now), '2026-09-04');
assert.equal(voice.parseRussianDate('на 5 сентября', now), '2026-09-05');
assert.equal(voice.parseRussianDate('на пятого сентября', now), '2026-09-05');
assert.equal(voice.parseRussianDate('на двадцать первое сентября', now), '2026-09-21');
assert.equal(voice.parseRussianDate('через неделю', now), '2026-09-09');
assert.equal(voice.parseRussianDate('через две недели', now), '2026-09-16');
assert.equal(voice.parseRussianDate('через 3 дня', now), '2026-09-05');
assert.equal(voice.parseRussianDate('в пятницу', now), '2026-09-04');
assert.equal(voice.parseRussianDate('в следующую пятницу', now), '2026-09-11');
assert.equal(voice.parseRussianDate('1.9', now), '2027-09-01');
assert.equal(voice.parseRussianDate('31 сентября', now), '');

assert.equal(voice.parseRussianTime('завтра в 10:30'), '10:30');
assert.equal(voice.parseRussianTime('завтра в 10 30'), '10:30');
assert.equal(voice.parseRussianTime('завтра в десять тридцать'), '10:30');
assert.equal(voice.parseRussianTime('в пятницу в десять тридцать'), '10:30');
assert.equal(voice.parseRussianTime('завтра в двадцать один тридцать'), '21:30');
assert.equal(voice.parseRussianTime('завтра в пять вечера'), '17:00');
assert.equal(voice.parseRussianTime('завтра к 12 ночи'), '00:00');
assert.equal(voice.parseRussianTime('завтра в полтретьего'), '02:30');
assert.equal(voice.parseRussianTime('завтра в половине третьего'), '02:30');
assert.equal(voice.parseRussianTime('на 5 сентября'), '');
assert.equal(voice.parseRussianTime('на 05.09'), '');

assert.equal(voice.parseDuration('массаж 90 минут'), 90);
assert.equal(voice.parseDuration('массаж полтора часа'), 90);
assert.equal(voice.parseDuration('процедура один час'), 60);
assert.equal(voice.parseDuration('процедура 1.5 часа'), 90);

assert.equal(voice.parseClientName('Запиши Марию завтра в десять'), 'Мария');
assert.equal(voice.parseClientName('Запиши Наталью Петрову 5 сентября'), 'Наталья Петрова');
assert.equal(voice.parseClientName('Запиши Дарью на массаж'), 'Дарья');
assert.equal(voice.parseClientName('Создай запись для Анны Петровой завтра'), 'Анна Петрова');
assert.equal(voice.parseClientName('Запиши Анну пятого сентября'), 'Анна');

assert.deepEqual(
  voice.findServices('на спортивного массажа', services).map(item => item.id),
  ['sport'],
  'склонённое составное название должно выигрывать у частичного совпадения'
);
assert.deepEqual(voice.findServices('на укладку волос', services).map(item => item.id), ['hair']);
assert.deepEqual(voice.findServices('на укладку бровей', services).map(item => item.id), ['brows']);
assert.deepEqual(voice.findServices('на массаж', services).map(item => item.id), ['massage']);

const booking = voice.interpretCommand(
  'Запиши Наталью Петрову пятого сентября в пять вечера на спортивный массаж',
  { today:'2026-09-02', services },
  now
);
assert.equal(booking.kind, 'booking_draft');
assert.deepEqual(booking.plan, {
  clientName:'Наталья Петрова',
  date:'2026-09-05',
  time:'17:00',
  serviceId:'sport',
  serviceName:'Спортивный массаж',
  durationMinutes:60
});
assert.equal(booking.canPrepare, true);

const slots = voice.interpretCommand(
  'Найди свободное время через неделю на стрижку 45 минут',
  { today:'2026-09-02', services },
  now
);
assert.equal(slots.kind, 'find_slots');
assert.equal(slots.plan.date, '2026-09-09');
assert.equal(slots.plan.serviceId, 'cut');
assert.equal(slots.plan.durationMinutes, 45);

const snapshot = {
  today:'2026-09-02',
  services,
  bookings:[
    { id:'late', clientName:'Анна Петрова', date:'2026-09-03', time:'15:00', serviceName:'Массаж', status:'confirmed' },
    { id:'cancelled', clientName:'Ирина', date:'2026-09-03', time:'09:00', serviceName:'Стрижка', status:'cancelled' },
    { id:'early', clientName:'Мария', date:'2026-09-03', time:'10:00', serviceName:'Укладка волос', status:'confirmed' }
  ]
};
const summary = voice.interpretCommand('Какие записи завтра?', snapshot, now);
assert.equal(summary.kind, 'schedule_summary');
assert.equal(summary.total, 2);
assert.deepEqual(summary.items.map(item => item.id), ['early', 'late']);

const offlineSummary = voice.applyOfflineContext(summary, { offlineReadable:true, lastUpdatedAt:'2026-09-02T14:40:00+04:00' });
assert.equal(offlineSummary.offline, true);
assert.match(offlineSummary.message, /сохранённая копия/i);
assert.match(offlineSummary.message, /имена и телефоны скрыты/i);

const offlineSlots = voice.applyOfflineContext(slots, { offlineReadable:true, lastUpdatedAt:'2026-09-02T14:40:00+04:00' });
assert.equal(offlineSlots.kind, 'offline_notice');
assert.equal(Boolean(offlineSlots.canPrepare), false);
assert.match(offlineSlots.message, /нельзя гарантировать/i);

const offlineDraft = voice.applyOfflineContext(booking, { offlineReadable:true, lastUpdatedAt:'2026-09-02T14:40:00+04:00' });
assert.equal(offlineDraft.kind, 'booking_draft');
assert.equal(offlineDraft.canPrepare, true);
assert.match(offlineDraft.message, /только черновик/i);

const client = voice.interpretCommand('найди клиента анну петрову', snapshot, now);
assert.equal(client.kind, 'client_search');
assert.equal(client.total, 1);
assert.equal(client.items[0].id, 'late');
assert.equal(voice.applyOfflineContext(client, { offlineReadable:true, lastUpdatedAt:'2026-09-02T14:40:00+04:00' }).kind, 'offline_notice');

assert.equal(voice.interpretCommand('расскажи анекдот', snapshot, now).kind, 'help');

console.log('Voice assistant functional tests passed');
