import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const voice = require('./voice-assistant.js');
const now = new Date(2026, 8, 2, 12, 0, 0);

const services = [
  { id:'massage', name:'Массаж', durationMinutes:60, priceRub:2000 },
  { id:'sport', name:'Спортивный массаж', durationMinutes:60, priceRub:2500 },
  { id:'hair', name:'Укладка волос', durationMinutes:45, priceRub:1500 },
  { id:'brows', name:'Укладка бровей', durationMinutes:30, priceRub:1200 },
  { id:'cut', name:'Стрижка', durationMinutes:45, priceRub:1000 }
];

assert.equal(voice.normalizeText('  Ёлка, МАССАЖ!  '), 'елка массаж');
const repairedCommand = voice.repairCommand('Запеши А на зафтра в 10:30 на масаж');
assert.equal(repairedCommand.text, 'запиши а на завтра в 10:30 на масаж');
assert.deepEqual(repairedCommand.corrections, [
  { from:'запеши', to:'запиши' },
  { from:'зафтра', to:'завтра' }
]);

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

const noisyBooking = voice.interpretCommand(
  'Запеши А на зафтра в 10:30 на масаж',
  { today:'2026-09-02', services },
  now
);
assert.equal(noisyBooking.kind, 'booking_draft');
assert.equal(noisyBooking.plan.clientName, 'Анна');
assert.equal(noisyBooking.plan.date, '2026-09-03');
assert.equal(noisyBooking.plan.serviceId, 'massage');
assert.equal(noisyBooking.understandingConfidence, 'medium');
assert.ok(noisyBooking.corrections.length >= 2);

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
const noisySlots = voice.interpretCommand('Наиди свабоднае акно завтро на масаж', { today:'2026-09-02', services }, now);
assert.equal(noisySlots.kind, 'find_slots');
assert.equal(noisySlots.plan.date, '2026-09-03');
assert.equal(noisySlots.plan.serviceId, 'massage');
assert.ok(noisySlots.corrections.some(item => item.to === 'свободное'));

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
assert.equal(voice.interpretCommand('Какие запеси завтро?', snapshot, now).kind, 'schedule_summary');
assert.equal(voice.interpretCommand('Покажи распиасние на завтра', snapshot, now).kind, 'schedule_summary');
const contextualTomorrow = voice.interpretCommand('А завтра?', snapshot, now, voice.interpretCommand('Какие записи сегодня?', snapshot, now));
assert.equal(contextualTomorrow.kind, 'schedule_summary', 'короткое продолжение должно использовать предыдущую тему');
assert.equal(contextualTomorrow.continuedFromContext, true);
assert.equal(contextualTomorrow.total, 2);
const contextualSlots = voice.interpretCommand('А завтра?', snapshot, now, voice.interpretCommand('Найди окно на массаж', snapshot, now));
assert.equal(contextualSlots.kind, 'find_slots');
assert.equal(contextualSlots.plan.serviceId, 'massage', 'продолжение поиска должно помнить выбранную услугу');
assert.equal(contextualSlots.plan.date, '2026-09-03');

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
const noisyClient = voice.interpretCommand('найди клентку ану петрову', snapshot, now);
assert.equal(noisyClient.kind, 'client_search');
assert.equal(noisyClient.total, 1);

const incompleteBooking = voice.interpretCommand('Запиши завтра в 10:30 на массаж', snapshot, now);
assert.equal(voice.needsClarification(incompleteBooking), true);
assert.equal(voice.canContinueCommand('Запиши завтра в 10:30 на массаж', incompleteBooking, 'Анну', snapshot, now), true);
const continuedBookingCommand = voice.continueCommand('Запиши завтра в 10:30 на массаж', incompleteBooking, 'Анну');
assert.equal(continuedBookingCommand, 'запиши Анну завтра в 10:30 на массаж');
assert.equal(voice.interpretCommand(continuedBookingCommand, snapshot, now).plan.clientName, 'Анна');
assert.equal(voice.canContinueCommand('Запиши завтра в 10:30 на массаж', incompleteBooking, 'Как настроить уведомления?', snapshot, now), false, 'новая команда не должна случайно продолжать незавершённую запись');

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
const howAreYou = voice.interpretCommand('Как дела?', snapshot, now);
assert.equal(howAreYou.kind, 'small_talk');
assert.match(howAreYou.message, /Спасибо, что спросили/);
assert.equal(voice.interpretCommand('Привет', snapshot, now).kind, 'small_talk');
assert.equal(voice.interpretCommand('Привет, как дела?', snapshot, now).kind, 'small_talk');
assert.equal(voice.interpretCommand('Большое спасибо', snapshot, now).title, 'Пожалуйста');
assert.equal(voice.interpretCommand('Кто ты?', snapshot, now).kind, 'small_talk');
assert.match(voice.interpretCommand('Что ты умеешь?', snapshot, now).message, /сообщениями и отзывами/);
assert.match(voice.interpretCommand('Нет', snapshot, now).message, /Предыдущий вариант не использую/);
const conversationalContinue = voice.interpretCommand('Да', snapshot, now, { openSection:'notifications', openLabel:'Открыть уведомления' });
assert.equal(conversationalContinue.kind, 'small_talk');
assert.equal(conversationalContinue.openSection, 'notifications');
const operationContinue = voice.interpretCommand('Да', snapshot, now, { ...voice.interpretCommand('Перенеси Анну на 5 сентября в 15:00', snapshot, now) });
assert.equal(operationContinue.kind, 'operation_preview');
assert.equal(operationContinue.plan.bookingId, 'late');
assert.equal(voice.shouldUseRemoteUnderstanding('Как дела?', howAreYou, { ...snapshot, synchronized:true }), false, 'обычный разговор должен работать локально без платного запроса');
assert.equal(voice.interpretCommand('как дила', snapshot, now).kind, 'small_talk', 'разговорная фраза с ошибкой должна пониматься локально');
assert.equal(voice.interpretCommand('превет', snapshot, now).title, 'Привет!', 'искажённое приветствие должно исправляться локально');
assert.equal(voice.interpretCommand('напеши клинту напоминание', snapshot, now).kind, 'message_draft', 'разговорная просьба с ошибками должна готовить сообщение локально');
assert.equal(voice.interpretCommand('придемай пост для сацсетей про масаж', snapshot, now).kind, 'content_draft', 'ошибки в запросе публикации не должны мешать локальному сценарию');
assert.equal(voice.interpretCommand('описание услиги масаж', snapshot, now).kind, 'content_draft', 'короткая просьба описать услугу должна работать без служебных слов');
assert.equal(voice.interpretCommand('как паменять рассписание', snapshot, now).kind, 'workspace_help', 'ошибочная фраза о настройке должна открывать локальную помощь');
assert.equal(voice.interpretCommand('клиенты', snapshot, now).title, 'Что сделать с клиентом?', 'неполная тема должна получать предметное уточнение');
assert.equal(voice.interpretCommand('Сколько выручька сиводня?', snapshot, now).kind, 'revenue_summary');
const priceQuestion = voice.interpretCommand('Какую цену поставить на массаж?', snapshot, now);
assert.equal(priceQuestion.kind, 'price_advice');
assert.match(priceQuestion.message, /автоматически не изменена/i);
assert.ok(priceQuestion.points.some(item => /\+5%/.test(item)));

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
const teamSummary = voice.interpretCommand('Кто работает в команде?', businessSnapshot, now);
assert.equal(teamSummary.kind, 'team_summary');
assert.match(teamSummary.points[0], /Владелец/, 'Системная роль владельца должна быть переведена для пользователя');

const assistantSnapshot = {
  ...businessSnapshot,
  organizationName:'Студия «Минута»',
  bookings:[
    ...businessSnapshot.bookings,
    { id:'future-anna', clientName:'Анна Петрова', clientKey:'79990000004', date:'2026-09-03', time:'10:30', status:'confirmed', outcome:'scheduled', serviceId:'massage', serviceName:'Массаж' }
  ],
  notifications:{ failed:1, pending:2, manualDue:1 }
};
const remoteContext = voice.buildAssistantContext(assistantSnapshot);
assert.equal(remoteContext.bookings.find(item => item.id === 'future-anna').clientName, 'Анна Петрова');
assert.equal(remoteContext.bookings[0].id, 'c2', 'сегодняшняя и ближайшие будущие записи должны попадать в ограниченный контекст первыми');
assert.doesNotMatch(JSON.stringify(remoteContext), /clientKey|paymentMethod|amountRub|79990000004/, 'во внешний ИИ-контекст попали телефонный ключ или платёжные данные');
const maximumRemoteContext = voice.buildAssistantContext({
  ...assistantSnapshot,
  services:Array.from({ length:60 }, (_, index) => ({ id:`service-${index}-${'x'.repeat(50)}`, name:`Услуга ${index} ${'я'.repeat(90)}`, durationMinutes:60, priceRub:1000 })),
  bookings:Array.from({ length:80 }, (_, index) => ({ id:`booking-${index}-${'x'.repeat(50)}`, clientName:`Клиент ${index} ${'я'.repeat(65)}`, date:`2026-${String(9 + Math.floor(index / 28)).padStart(2, '0')}-${String((index % 28) + 1).padStart(2, '0')}`, time:'10:30', durationMinutes:60, serviceId:`service-${index}`, serviceName:`Услуга ${index} ${'я'.repeat(80)}`, status:'confirmed', outcome:'scheduled' })),
  team:Array.from({ length:30 }, (_, index) => ({ name:`Сотрудник ${index} ${'я'.repeat(60)}`, role:'specialist' })),
  inventory:{ enabled:true, items:Array.from({ length:60 }, (_, index) => ({ id:`item-${index}`, name:`Материал ${index} ${'я'.repeat(80)}`, unit:'штук', quantity:100, lowStockThreshold:10 })) }
});
assert.ok(new TextEncoder().encode(JSON.stringify(maximumRemoteContext)).byteLength <= 18 * 1024, 'динамический контекст превышает безопасный бюджет');
assert.equal(voice.shouldUseRemoteUnderstanding('а шо у мя тама завтра', voice.interpretCommand('а шо у мя тама завтра', assistantSnapshot, now), { ...assistantSnapshot, synchronized:true }), true);
assert.equal(voice.shouldUseRemoteUnderstanding('Какие записи завтра?', voice.interpretCommand('Какие записи завтра?', assistantSnapshot, now), { ...assistantSnapshot, synchronized:true }), false, 'понятная локальная команда не должна расходовать внешний ИИ-запрос');
const remoteSchedule = voice.assistantAnalysisModel({ intent:'schedule_summary', confidence:0.94, canonicalCommand:'Покажи записи завтра', clarification:'' }, assistantSnapshot, now);
assert.equal(remoteSchedule.kind, 'schedule_summary');
assert.equal(remoteSchedule.aiEnhanced, true);
const remoteSmallTalk = voice.assistantAnalysisModel({ intent:'small_talk', confidence:0.92, canonicalCommand:'Как дела?', clarification:'' }, assistantSnapshot, now);
assert.equal(remoteSmallTalk.kind, 'small_talk');
assert.equal(remoteSmallTalk.aiEnhanced, true);
const remoteClarification = voice.assistantAnalysisModel({ intent:'operation_preview', confidence:0.51, canonicalCommand:'', clarification:'Какую запись нужно перенести?' }, assistantSnapshot, now);
assert.equal(remoteClarification.kind, 'ai_clarification');
assert.equal(voice.needsClarification(remoteClarification), true);
assert.equal(voice.assistantAnalysisModel({ intent:'unsupported', confidence:1, canonicalCommand:'удали всё', clarification:'' }, assistantSnapshot, now), null, 'неразрешённая цель ИИ не должна попадать в локальный движок');
const reminderDraft = voice.interpretCommand('Напиши напоминание Анне на завтра', assistantSnapshot, now);
assert.equal(reminderDraft.kind, 'message_draft');
assert.match(reminderDraft.draftText, /Анна/);
assert.match(reminderDraft.draftText, /10:30/);
assert.equal(reminderDraft.openSection, 'notifications');

const reviewDraft = voice.interpretCommand('Ответь на плохой отзыв', assistantSnapshot, now);
assert.equal(reviewDraft.kind, 'message_draft');
assert.match(reviewDraft.draftText, /разобраться/i);

const postDraft = voice.interpretCommand('Придумай пост про массаж', assistantSnapshot, now);
assert.equal(postDraft.kind, 'content_draft');
assert.match(postDraft.draftText, /Массаж/);
assert.match(postDraft.draftText, /2 000|2 000/);

const personalizedSnapshot = {
  ...assistantSnapshot,
  services:[...assistantSnapshot.services, { id:'lymph', name:'Лимфодренажный массаж', durationMinutes:60, priceRub:2800 }]
};
const learnedRules = voice.learnedCorrectionRules(
  'Найди окно на лимфач',
  'Найди окно на лимфодренажный массаж',
  personalizedSnapshot
);
assert.deepEqual(learnedRules, [{ from:'лимфач', to:'лимфодренажный массаж' }], 'явное исправление рабочей фразы должно стать персональным правилом');
const learnedCommand = voice.applyLearnedCorrections('найди окно завтра на лимфач', learnedRules);
assert.match(learnedCommand.text, /лимфодренажный массаж/);
assert.equal(voice.interpretCommand(learnedCommand.text, personalizedSnapshot, now).plan.serviceId, 'lymph');
assert.deepEqual(
  voice.learnedCorrectionRules('напиши маше', 'напиши марии', personalizedSnapshot),
  [],
  'имена клиентов и свободный текст нельзя сохранять в персональный словарь'
);

const annaSearch = voice.interpretCommand('Найди клиента Анну Петрову', assistantSnapshot, now);
const annaContext = voice.updateConversationContext({}, annaSearch);
assert.equal(annaContext.clientName, 'Анна Петрова');
const pronounSearch = voice.interpretCommand('Когда она записана?', assistantSnapshot, now, annaSearch, annaContext);
assert.equal(pronounSearch.kind, 'client_search', 'местоимение должно использовать клиента из предыдущего ответа');
assert.equal(pronounSearch.continuedFromContext, true);
const rememberedMove = voice.interpretCommand('А перенеси на пятницу в 15:00', assistantSnapshot, now, pronounSearch, annaContext);
assert.equal(rememberedMove.kind, 'operation_preview');
assert.equal(rememberedMove.plan.bookingId, 'future-anna');
assert.equal(rememberedMove.plan.targetDate, '2026-09-04');
const rememberedMessage = voice.interpretCommand('Напиши ей напоминание', assistantSnapshot, now, pronounSearch, annaContext);
assert.equal(rememberedMessage.kind, 'message_draft');
assert.match(rememberedMessage.draftText, /Анна/);

const compoundPlan = voice.interpretCommand(
  'Найди свободное окно завтра на массаж и подготовь сообщение Анне',
  assistantSnapshot,
  now
);
assert.equal(compoundPlan.kind, 'compound_plan', 'две задачи в одной фразе должны разделяться на безопасные шаги');
assert.deepEqual(compoundPlan.steps.map(step => step.kind), ['find_slots', 'message_draft']);

const shorterDraft = voice.interpretCommand('Сделай короче', assistantSnapshot, now, postDraft);
assert.equal(shorterDraft.revised, true);
assert.ok(shorterDraft.draftText.length <= postDraft.draftText.length);
const warmerDraft = voice.interpretCommand('Сделай теплее', assistantSnapshot, now, reminderDraft);
assert.equal(warmerDraft.revised, true);
assert.match(warmerDraft.draftText, /очень рады/i);
const formalDraft = voice.interpretCommand('Сделай официальнее', assistantSnapshot, now, reminderDraft);
assert.equal(formalDraft.revised, true);
assert.doesNotMatch(formalDraft.draftText, /!/);
const pricedDraft = voice.interpretCommand('Добавь цену', assistantSnapshot, now, reminderDraft);
assert.equal(pricedDraft.revised, true);
assert.match(pricedDraft.draftText, /Стоимость\s+—\s+2 000|Стоимость\s+—\s+2 000/);
const noDiscountDraft = voice.reviseDraftModel('Убери скидку', {
  kind:'content_draft',
  title:'Пост',
  draftText:'Запишитесь со скидкой 10%. Будем рады встрече!',
  copyLabel:'Скопировать'
}, assistantSnapshot);
assert.equal(noDiscountDraft.revised, true);
assert.doesNotMatch(noDiscountDraft.draftText, /скид|10%/i);

const incompletePost = voice.interpretCommand('Придумай пост', assistantSnapshot, now);
assert.equal(voice.needsClarification(incompletePost), true);
assert.equal(voice.canContinueCommand('Придумай пост', incompletePost, 'про массаж', assistantSnapshot, now), true);
assert.equal(voice.interpretCommand(voice.continueCommand('Придумай пост', incompletePost, 'про массаж'), assistantSnapshot, now).needsDetail, '');

const promotion = voice.interpretCommand('Дай идеи для продвижения', assistantSnapshot, now);
assert.equal(promotion.kind, 'promotion_ideas');
assert.ok(promotion.points.length >= 4);
assert.ok(promotion.draftText);

const briefing = voice.interpretCommand('Дай короткую сводку и план на день', assistantSnapshot, now);
assert.equal(briefing.kind, 'operational_briefing');
assert.ok(briefing.metrics.length >= 3);
assert.equal(briefing.openSection, 'bookings');

const notificationsHelp = voice.interpretCommand('Как настроить уведомления?', assistantSnapshot, now);
assert.equal(notificationsHelp.kind, 'workspace_help');
assert.equal(notificationsHelp.openSection, 'notifications');
const exportHelp = voice.interpretCommand('Выгрузи записи', assistantSnapshot, now);
assert.equal(exportHelp.kind, 'workspace_help');
assert.equal(exportHelp.openSection, 'analytics');
const incompletePrice = voice.interpretCommand('Какую цену поставить?', assistantSnapshot, now);
assert.equal(incompletePrice.kind, 'price_advice');
assert.equal(voice.needsClarification(incompletePrice), true);
assert.equal(voice.interpretCommand(voice.continueCommand('Какую цену поставить?', incompletePrice, 'массаж'), assistantSnapshot, now).needsDetail, undefined);

const reschedulePreview = voice.interpretCommand('Перенеси Анну на 5 сентября в 15:00', assistantSnapshot, now);
assert.equal(reschedulePreview.kind, 'operation_preview');
assert.equal(reschedulePreview.operation, 'reschedule');
assert.equal(reschedulePreview.plan.bookingId, 'future-anna');
assert.equal(reschedulePreview.plan.fromTime, '10:30');
assert.equal(reschedulePreview.plan.targetDate, '2026-09-05');
assert.equal(reschedulePreview.plan.targetTime, '15:00');
assert.equal(voice.needsClarification(reschedulePreview), false);

const cancelPreview = voice.interpretCommand('Отмени запись Анны завтра', assistantSnapshot, now);
assert.equal(cancelPreview.kind, 'operation_preview');
assert.equal(cancelPreview.operation, 'cancel');
assert.equal(cancelPreview.plan.bookingId, 'future-anna');
assert.match(cancelPreview.message, /отдельного подтверждения/i);

const ambiguousCancellation = voice.interpretCommand('Отмени запись', {
  ...assistantSnapshot,
  bookings:[...assistantSnapshot.bookings, { id:'future-maria', clientName:'Мария', clientKey:'79990000005', date:'2026-09-04', time:'12:00', status:'confirmed', outcome:'scheduled', serviceId:'cut', serviceName:'Стрижка' }]
}, now);
assert.equal(ambiguousCancellation.kind, 'operation_preview');
assert.equal(voice.needsClarification(ambiguousCancellation), true);
assert.ok(ambiguousCancellation.candidates.length >= 2);

const specialistRevenue = voice.interpretCommand('Какая выручка сегодня?', { ...assistantSnapshot, currentRole:'specialist' }, now);
assert.equal(specialistRevenue.kind, 'permission_notice');
const specialistBriefing = voice.interpretCommand('Дай короткую сводку и план на день', { ...assistantSnapshot, currentRole:'specialist' }, now);
assert.equal(specialistBriefing.kind, 'operational_briefing');
assert.ok(!specialistBriefing.metrics.some(item => item.label === 'получено сегодня'));

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
const controllerBack = controllerElement({ hidden:true });
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
  ['[data-close-voice-assistant]', controllerClose], ['[data-voice-back]', controllerBack], ['#voiceAssistantForm', controllerForm],
  ['#voiceAssistantInput', controllerInput], ['#voiceListenButton', controllerListen],
  ['#voiceAssistantStatus', controllerStatus], ['#voiceAssistantResult', controllerResult]
]);
const controllerDocument = {
  hidden:false,
  querySelector:selector => controllerElements.get(selector) || null,
  querySelectorAll:() => [],
  addEventListener() {}
};
let controllerSnapshot = { ...assistantSnapshot, currentRole:'owner', authenticated:true, synchronized:true, offline:false, offlineReadable:false, lastUpdatedAt:'2026-09-02T15:00:00+04:00', sessionGeneration:1 };
const slotResponses = [];
let slotRequests = 0;
const controllerBridge = {
  remoteUnderstandingEnabled:false,
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

controllerInput.value = 'Перенеси Анну на 5 сентября в 15:00';
controllerForm.emit('submit');
assert.match(controllerResultHtml, /Было/);
assert.match(controllerResultHtml, /Станет/);
assert.match(controllerResultHtml, /data-voice-operation/);
assert.match(controllerResultHtml, /Источник: актуальные данные кабинета/);
assert.match(controllerResultHtml, /Я правильно понял/);
assert.equal(controllerBack.hidden, false, 'после ответа должна быть доступна кнопка возврата к быстрым темам');

controllerInput.value = 'Придумай пост про массаж';
controllerForm.emit('submit');
assert.match(controllerResultHtml, /Готовый черновик/);
assert.match(controllerResultHtml, /data-voice-copy/);
assert.match(controllerResultHtml, /data-voice-open-section="services"/);

controllerInput.value = 'Запиши завтра в 10:30 на массаж';
controllerForm.emit('submit');
assert.equal(controllerInput.value, '', 'после неполной команды поле должно ждать короткое уточнение');
assert.match(controllerResultHtml, /имя клиента/i);
controllerInput.value = 'Анну';
controllerForm.emit('submit');
assert.match(controllerResultHtml, /Анна/);
assert.doesNotMatch(controllerResultHtml, /Нужно уточнить: имя клиента/i);

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

let remotePayload = null;
controllerSnapshot = { ...controllerSnapshot, synchronized:true, offline:false, offlineReadable:false, sessionGeneration:3 };
controllerBridge.understandCommand = async payload => {
  remotePayload = payload;
  return { ok:true, analysis:{ intent:'schedule_summary', confidence:0.96, canonicalCommand:'Покажи записи завтра', clarification:'' } };
};
controllerInput.value = 'а шо у мя тама завтра';
controllerForm.emit('submit');
assert.equal(remotePayload, null, 'при выключенном платном ИИ команда не должна уходить во внешнюю функцию');
assert.match(controllerResultHtml, /Что проверить на это время/);
controllerBridge.remoteUnderstandingEnabled = true;
controllerInput.value = 'а шо у мя тама завтра';
controllerForm.emit('submit');
await Promise.resolve();
await Promise.resolve();
assert.equal(remotePayload.command, 'а шо у мя тама завтра');
assert.doesNotMatch(JSON.stringify(remotePayload.context), /clientKey|paymentMethod|amountRub|79990000004/);
assert.match(controllerResultHtml, /Записи:/);
assert.match(controllerResultHtml, /защищённый ИИ-разбор/);
remotePayload = null;
controllerInput.value = 'Как дела?';
controllerForm.emit('submit');
assert.equal(remotePayload, null, 'обычный разговор не должен обращаться к серверному ИИ');
assert.match(controllerResultHtml, /Всё хорошо/);
assert.match(controllerResultHtml, /без чтения данных кабинета/);

controller.destroy();

console.log('Voice assistant functional tests passed');
