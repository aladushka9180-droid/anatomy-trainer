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
assert.equal(voice.parseRussianTime('завтра в десять часов тридцать минут'), '10:30');
assert.equal(voice.parseRussianTime('завтра в десять сорок пять'), '10:45');
assert.equal(voice.parseRussianTime('завтра 18:25'), '18:25');
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
assert.equal(voice.parseDuration('массаж десять минут'), 10);
assert.equal(voice.parseDuration('массаж сорок пять минут'), 45);

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
assert.deepEqual(voice.findServices('на масаж', services).map(item => item.id), ['massage'], 'одна ошибка распознавания в длинном слове должна исправляться');
assert.deepEqual(voice.findServices('на спортивный масаж', services).map(item => item.id), ['sport']);

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

const naturalBooking = voice.interpretCommand(
  'Поставь Анну завтра в десять часов тридцать минут на масаж',
  { today:'2026-09-02', services },
  now
);
assert.equal(naturalBooking.kind, 'booking_draft');
assert.equal(naturalBooking.plan.clientName, 'Анна');
assert.equal(naturalBooking.plan.time, '10:30');
assert.equal(naturalBooking.plan.serviceId, 'massage');

const politeBooking = voice.interpretCommand(
  'Хочу записать Марию послезавтра в 18:25 на укладку волос',
  { today:'2026-09-02', services },
  now
);
assert.equal(politeBooking.kind, 'booking_draft');
assert.equal(politeBooking.plan.clientName, 'Мария');
assert.equal(politeBooking.plan.serviceId, 'hair');

const slots = voice.interpretCommand(
  'Найди свободное время через неделю на стрижку 45 минут',
  { today:'2026-09-02', services },
  now
);
assert.equal(slots.kind, 'find_slots');
assert.equal(slots.plan.date, '2026-09-09');
assert.equal(slots.plan.serviceId, 'cut');
assert.equal(slots.plan.durationMinutes, 45);

const naturalSlots = voice.interpretCommand('Есть ли свободное окошко завтра на массаж', { today:'2026-09-02', services }, now);
assert.equal(naturalSlots.kind, 'find_slots');
assert.equal(naturalSlots.plan.serviceId, 'massage');
assert.equal(voice.interpretCommand('Когда можно записать на массаж', { today:'2026-09-02', services }, now).kind, 'find_slots');

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
assert.equal(voice.interpretCommand('Что у меня завтра?', snapshot, now).kind, 'schedule_summary');
assert.equal(voice.interpretCommand('Покажи расписание на завтра', snapshot, now).kind, 'schedule_summary');

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

const naturalClient = voice.interpretCommand('что было у Анны Петровой', snapshot, now);
assert.equal(naturalClient.kind, 'client_search');
assert.equal(naturalClient.total, 1);

const alternatives = [Object.assign([
  { transcript:'расскажи анекдот', confidence:0.95 },
  { transcript:'запиши Анну завтра в 10:30 на масаж', confidence:0.58 }
], { isFinal:true })];
assert.equal(
  voice.chooseRecognitionTranscript(alternatives, snapshot, now),
  'запиши Анну завтра в 10:30 на масаж',
  'нужно выбирать осмысленную команду, а не только первую гипотезу распознавания'
);

assert.equal(voice.supportsDirectRecognition(function Recognition() {}, { userAgent:'Mozilla/5.0 (Linux; Android 15) Chrome/140 Mobile' }, true), true);
assert.equal(voice.supportsDirectRecognition(function Recognition() {}, { userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Version/18.0 Mobile Safari/604.1', standalone:true }, true), false, 'iOS Home Screen не должен попадать в неработающий Web Speech API');
assert.equal(voice.supportsDirectRecognition(function Recognition() {}, { userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) CriOS/140 Mobile Safari/604.1' }, false), false, 'iOS WKWebView должен использовать системную диктовку');
assert.equal(voice.supportsDirectRecognition(null, {}, false), false);

const russianVoice = { name:'Google русский', lang:'ru-RU', localService:true };
const selectedVoice = voice.selectRussianVoice([
  { name:'Ting-Ting', lang:'zh-CN', default:true, localService:true },
  russianVoice,
  { name:'English', lang:'en-US', localService:true }
]);
assert.equal(selectedVoice, russianVoice, 'озвучивание не должно выбирать китайский или системный голос вместо русского');
assert.equal(voice.selectRussianVoice([{ name:'Ting-Ting', lang:'zh-CN', default:true }]), null);

assert.equal(voice.interpretCommand('расскажи анекдот', snapshot, now).kind, 'help');

const businessSnapshot = {
  today:'2026-09-02',
  services:[...services, { id:'minute', name:'Процедура по минутам', durationMinutes:1, defaultDurationMinutes:52, perMinute:true }],
  bookings:[
    { id:'c1', date:'2026-09-01', status:'confirmed', outcome:'completed', paymentMethod:'cash', amountRub:3000, serviceName:'Массаж', clientKey:'79990000001' },
    { id:'c2', date:'2026-09-02', status:'confirmed', outcome:'completed', paymentMethod:'unpaid', amountRub:0, serviceName:'Стрижка', clientKey:'79990000002' },
    { id:'p1', date:'2026-08-25', status:'confirmed', outcome:'completed', paymentMethod:'cash', amountRub:5000, serviceName:'Массаж', clientKey:'79990000001' },
    { id:'x1', date:'2026-09-03', status:'cancelled', outcome:'scheduled', paymentMethod:'unpaid', amountRub:0, serviceName:'Массаж', clientKey:'79990000003' }
  ],
  inventory:{
    enabled:true,
    items:[{ id:'oil', name:'Массажное масло', unit:'мл', quantity:80, lowStockThreshold:100 }],
    usage:[{ serviceId:'massage', itemId:'oil', quantity:50 }]
  },
  team:[{ id:'u1', name:'Рамиль', role:'owner' }]
};

const perMinuteSlots = voice.interpretCommand('Найди окно завтра на процедуру по минутам', businessSnapshot, now);
assert.equal(perMinuteSlots.kind, 'find_slots');
assert.equal(perMinuteSlots.plan.perMinute, true);
assert.equal(perMinuteSlots.plan.durationMinutes, 0, 'поминутная услуга должна запросить длительность до поиска окна');
assert.equal(perMinuteSlots.plan.defaultDurationMinutes, 52);

const revenue = voice.interpretCommand('Какая выручка сегодня?', businessSnapshot, now);
assert.equal(revenue.kind, 'revenue_summary');
assert.equal(revenue.metrics[0].value, '0 ₽');
assert.match(revenue.points[0], /Без оплаты/);

const paidZeroRevenue = voice.revenueStats({ bookings:[{ date:'2026-09-02', status:'confirmed', outcome:'completed', paymentMethod:'cash', amountRub:0 }] }, '2026-09-02', '2026-09-02');
assert.equal(paidZeroRevenue.unpaid, 0, 'нулевая сумма при явно выбранном способе оплаты не должна считаться неоплаченным визитом');

const revenueChange = voice.interpretCommand('Почему упала выручка на этой неделе?', businessSnapshot, now);
assert.equal(revenueChange.kind, 'revenue_change');
assert.ok(revenueChange.metrics.length >= 3);

const inventory = voice.interpretCommand('Какие материалы заканчиваются?', businessSnapshot, now);
assert.equal(inventory.kind, 'inventory_summary');
assert.match(inventory.points[0], /Массажное масло/);

const oilBalance = voice.interpretCommand('Сколько осталось массажного масла?', businessSnapshot, now);
assert.equal(oilBalance.kind, 'inventory_summary');
assert.match(oilBalance.title, /Остаток материала/);

const inventoryForecast = voice.interpretCommand('На сколько дней хватит массажного масла?', {
  ...businessSnapshot,
  bookings:[
    ...businessSnapshot.bookings,
    { id:'f1', date:'2026-09-03', time:'10:00', status:'confirmed', outcome:'scheduled', serviceName:'Массаж' },
    { id:'f2', date:'2026-09-04', time:'10:00', status:'confirmed', outcome:'scheduled', serviceName:'Массаж' }
  ]
}, now);
assert.equal(inventoryForecast.kind, 'inventory_forecast');
assert.match(inventoryForecast.title, /может не хватить/i);
assert.match(inventoryForecast.message, /4 сентября/);

const inventoryWithoutUsage = voice.interpretCommand('Хватит ли массажного масла?', {
  ...businessSnapshot,
  inventory:{ ...businessSnapshot.inventory, usage:[] }
}, now);
assert.equal(inventoryWithoutUsage.kind, 'inventory_forecast');
assert.match(inventoryWithoutUsage.message, /не указана норма расхода/i);

const attention = voice.interpretCommand('Что требует внимания?', businessSnapshot, now);
assert.equal(attention.kind, 'attention');
assert.ok(attention.points.some(item => /Не оплачено/.test(item)));
assert.ok(attention.points.some(item => /Массажное масло/.test(item)));

const clientsToday = voice.interpretCommand('Сколько новых клиентов сегодня?', businessSnapshot, now);
assert.equal(clientsToday.kind, 'clients_summary');
assert.match(clientsToday.title, /сегодня/);
assert.equal(clientsToday.metrics.find(item => item.label === 'всего').value, '1');
assert.equal(voice.applyOfflineContext(clientsToday, { offlineReadable:true, lastUpdatedAt:'2026-09-02T14:40:00+04:00' }).kind, 'offline_notice', 'обезличенная офлайн-копия не позволяет считать уникальных клиентов');

const servicePerformance = voice.interpretCommand('Какие услуги принесли больше денег сегодня?', {
  ...businessSnapshot,
  bookings:[...businessSnapshot.bookings, { id:'cancelled-completed', date:'2026-09-02', status:'cancelled', outcome:'completed', paymentMethod:'cash', amountRub:100000, serviceName:'Отменённая услуга' }]
}, now);
assert.equal(servicePerformance.kind, 'service_performance');
assert.match(servicePerformance.title, /сегодня/);
assert.ok(!servicePerformance.points.some(item => /Отменённая услуга/.test(item)), 'отменённый визит не должен попадать в выручку услуг');
assert.equal(voice.interpretCommand('Кто работает в команде?', businessSnapshot, now).kind, 'team_summary');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}

function controllerElement(overrides = {}) {
  const listeners = new Map();
  const classes = new Set();
  return Object.assign({
    value:'', textContent:'', hidden:false, open:false, className:'', dataset:{},
    classList:{
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); }
    },
    addEventListener(type, listener) {
      const handlers = listeners.get(type) || [];
      handlers.push(listener);
      listeners.set(type, handlers);
    },
    emit(type, event = {}) {
      for (const listener of listeners.get(type) || []) listener({ preventDefault() {}, ...event });
    },
    setAttribute() {}, focus() {}, replaceChildren() { this.innerHTML = ''; },
    querySelector() { return null; }, querySelectorAll() { return []; }
  }, overrides);
}

const controllerOpen = controllerElement();
const controllerClose = controllerElement();
const controllerForm = controllerElement();
const controllerInput = controllerElement();
const controllerStatus = controllerElement();
const controllerListenLabel = controllerElement();
const controllerListen = controllerElement({ querySelector:selector => selector === 'span' ? controllerListenLabel : null });
const controllerDialog = controllerElement({ showModal() { this.open = true; }, close() { this.open = false; } });
let controllerResultHtml = '';
const controllerResult = controllerElement();
Object.defineProperty(controllerResult, 'innerHTML', {
  get() { return controllerResultHtml; },
  set(value) { controllerResultHtml = String(value); }
});
const controllerElements = new Map([
  ['#voiceAssistantDialog', controllerDialog], ['#openVoiceAssistant', controllerOpen],
  ['[data-close-voice-assistant]', controllerClose], ['#voiceAssistantForm', controllerForm],
  ['#voiceAssistantInput', controllerInput], ['#voiceListenButton', controllerListen],
  ['#voiceAssistantStatus', controllerStatus], ['#voiceAssistantResult', controllerResult]
]);
const controllerDocument = {
  hidden:false,
  querySelector:selector => controllerElements.get(selector) || null,
  querySelectorAll:() => [],
  addEventListener() {}
};
let controllerSnapshot = { ...businessSnapshot, authenticated:true, synchronized:true, offline:false, offlineReadable:false, sessionGeneration:1 };
const slotResponses = [];
let slotRequests = 0;
const controllerBridge = {
  getReadOnlySnapshot() { return controllerSnapshot; },
  findAvailableSlots() {
    slotRequests += 1;
    return slotResponses.shift();
  },
  prepareBookingDraft() { return { ok:true }; }
};
const controller = voice.createController({ document:controllerDocument, bridge:controllerBridge });
controller.bind();
controllerOpen.emit('click');

const staleSlots = deferred();
slotResponses.push(staleSlots.promise);
controllerInput.value = 'Найди свободное время завтра на массаж';
controllerForm.emit('submit');
assert.match(controllerResultHtml, /Проверяю расписание/);
controllerInput.value = 'Какая выручка сегодня?';
controllerForm.emit('submit');
assert.match(controllerResultHtml, /Выручка сегодня/);
staleSlots.resolve({ ok:true, slots:['10:00'] });
await Promise.resolve();
await Promise.resolve();
assert.match(controllerResultHtml, /Выручка сегодня/, 'поздний ответ поиска не должен перезаписывать более новую команду');
assert.doesNotMatch(controllerResultHtml, /10:00/);

slotResponses.push(Promise.reject(new Error('network_failed')));
controllerInput.value = 'Найди свободное время завтра на массаж';
controllerForm.emit('submit');
await Promise.resolve();
await Promise.resolve();
assert.match(controllerResultHtml, /Свободное время не загружено/);
assert.doesNotMatch(controllerResultHtml, /нет окна нужной длительности/i, 'ошибка сети не должна выглядеть как отсутствие свободных окон');

slotResponses.push(Promise.resolve({ ok:true, slots:['11:00'] }));
controllerInput.value = 'Запиши Анну завтра на массаж';
controllerForm.emit('submit');
await Promise.resolve();
await Promise.resolve();
assert.match(controllerResultHtml, /11:00/, 'если в команде создания записи нет времени, помощник должен предложить проверенные слоты');

const changedSessionSlots = deferred();
slotResponses.push(changedSessionSlots.promise);
controllerInput.value = 'Найди свободное время завтра на массаж';
controllerForm.emit('submit');
controllerSnapshot = { ...controllerSnapshot, sessionGeneration:2 };
changedSessionSlots.resolve({ ok:true, slots:['12:00'] });
await Promise.resolve();
await Promise.resolve();
assert.match(controllerResultHtml, /Сессия кабинета изменилась/);
assert.doesNotMatch(controllerResultHtml, /12:00/, 'результат из прошлого поколения сессии не должен отображаться');

const requestsBeforeOfflineSearch = slotRequests;
controllerSnapshot = { ...controllerSnapshot, synchronized:false, offline:true, offlineReadable:true, lastUpdatedAt:'2026-09-02T14:40:00+04:00' };
controllerInput.value = 'Найди свободное время завтра на массаж';
controllerForm.emit('submit');
assert.equal(slotRequests, requestsBeforeOfflineSearch, 'офлайн-поиск не должен обращаться за свободными слотами');
assert.match(controllerResultHtml, /Свободное время нужно перепроверить/);

controller.destroy();

console.log('Voice assistant functional tests passed');
