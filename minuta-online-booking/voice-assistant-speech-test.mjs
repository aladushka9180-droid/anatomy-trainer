import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const voice = createRequire(import.meta.url)('./voice-assistant.js');
const speak = model => voice.assistantSpeechText({ title:'Ответ', message:'Подробности', ...model });
const booking = { id:'DO_NOT_SPEAK_ID', date:'2026-09-05', time:'13:00', clientName:'Анна', serviceName:'Массаж', phone:'DO_NOT_SPEAK_PHONE' };
const plan = { serviceId:'massage', serviceName:'Массаж', clientName:'Анна', date:'2026-09-05', time:'13:00', durationMinutes:60 };
const attention = voice.attentionModel({ today:'2026-09-05', services:[{ id:'massage' }], bookings:[{date:'2026-09-05',status:'cancelled'},{date:'2026-09-06',status:'cancelled'}], inventory:{enabled:true,items:[{name:'Масло',quantity:0,lowStockThreshold:1},{name:'Массажное масло',quantity:1,lowStockThreshold:2}]} });
assert.equal(attention.points.length, 2);
for (const point of attention.points) assert.ok(speak(attention).includes(point), 'каждый важный пункт должен озвучиваться');

const cases = [
  [{kind:'schedule_summary',items:[booking],total:2}, ['13:00','Анна','Массаж','Показаны первые 1 из 2']],
  [{kind:'client_search',items:[booking]}, ['Анна','13:00']],
  [{kind:'booking_draft',plan}, ['Клиент: Анна','Дата:','Время: 13:00','Услуга: Массаж','60 минут']],
  [{kind:'booking_draft',candidates:[{name:'Первая услуга'},{name:'Вторая услуга'}]}, ['Выберите услугу','Первая услуга','Вторая услуга']],
  [{kind:'find_slots',availableServices:[{name:'Услуга из каталога'}]}, ['Услуга из каталога']],
  [{kind:'booking_draft'}, ['Активных услуг для выбора сейчас нет']],
  [{kind:'booking_draft',plan:{...plan,perMinute:true,durationMinutes:0}}, ['Выберите длительность','15 минут','60 минут','точную длительность']],
  [{kind:'find_slots',plan,loading:true}, ['Проверяем расписание']],
  [{kind:'find_slots',plan,slotError:true,slots:['STALE_SLOT']}, ['Свободное время не загружено']],
  [{kind:'find_slots',plan,slots:[]}, ['нет окна нужной длительности']],
  [{kind:'find_slots',plan,slots:['10:00','11:00','12:00','13:00','14:00']}, ['10:00','11:00','12:00','13:00','14:00','Массаж']],
  [{kind:'find_slots',plan,slots:['14:00'],slotOptions:[{time:'14:00',recommended:true,reason:'Подходит до следующей записи'}]}, ['14:00','Подходит до следующей записи']],
  [{kind:'operation_preview',candidates:[booking]}, ['Выберите запись','Анна','13:00','Массаж']],
  [{kind:'operation_preview',plan:{...plan,operation:'reschedule',fromDate:'2026-09-05',fromTime:'13:00',targetDate:'2026-09-06',targetTime:'15:00'}}, ['Было:','13:00','Станет:','15:00']],
  [{kind:'operation_preview',plan:{...plan,operation:'cancel',fromDate:'2026-09-05',fromTime:'13:00'}}, ['Клиент: Анна','Было:','13:00']],
  [{kind:'compound_plan',steps:[{label:'Первый шаг',command:'HIDDEN_COMMAND'},{label:'Второй шаг'}],points:['Ничего не изменится без подтверждения']}, ['Первый шаг','Второй шаг','без подтверждения']],
  [{kind:'help',examples:['Откройте настройки','Выберите сотрудника']}, ['Откройте настройки','Выберите сотрудника']],
  [{kind:'message_draft',draftText:'Анна, ждём вас завтра в 13:00.'}, ['Готовый черновик','Анна, ждём вас завтра в 13:00.']],
  [{kind:'content_draft',draftText:'Текст публикации.'}, ['Текст публикации.']],
  [{kind:'error',title:'Нет доступа',message:'Войдите в кабинет'}, ['Нет доступа','Войдите в кабинет']],
  [{kind:'offline_notice',offline:true,message:'Данные сохранены ранее',sourceLabel:'Источник: сохранённая копия'}, ['Офлайн','устаревшими','сохранённая копия']],
  [{kind:'operational_briefing',metrics:[{label:'выручка',value:'2 000 ₽'}],points:['Следующий клиент — Анна'],explanation:'Скоро следующая запись'}, ['выручка: 2 000 ₽','Следующий клиент — Анна','Почему: Скоро следующая запись']],
];
for (const [model, expected] of cases) {
  const text = speak(model);
  expected.forEach(fragment => assert.ok(text.includes(fragment), `${model.kind}: пропущено ${fragment}`));
  assert.doesNotMatch(text, /DO_NOT_SPEAK|HIDDEN_COMMAND|STALE_SLOT|undefined|\[object Object\]/);
}
for (const kind of ['revenue','revenue_comparison','booking_comparison','clients_summary','services_summary','team_summary','inventory_summary','inventory_forecast','price_advice','promotion_ideas','workspace_help','screen_context','undo_preview','permission_notice','small_talk','smart_clarification','ai_clarification']) {
  const text = speak({kind,metrics:[{label:'Показатель',value:0}],points:['Первый пункт','Второй пункт']});
  for (const fragment of ['Показатель: 0','Первый пункт','Второй пункт']) assert.ok(text.includes(fragment), kind);
}
const longText = Array.from({length:100}, (_, index) => `Пункт ${index + 1}: важная подробность записи в 13:00 со скоростью 1,25×.`).join(' ');
const chunks = voice.splitSpeechText(longText);
assert.ok(chunks.length > 2);
assert.equal(chunks.join(' '), longText, 'длинный ответ не должен терять ни один пункт');
assert.ok(chunks.every(chunk => Array.from(chunk).length <= 600));
assert.deepEqual(voice.splitSpeechText(''), []);
const unbroken = 'Я🟢'.repeat(900);
assert.equal(voice.splitSpeechText(unbroken).join(''), unbroken, 'длинное слово и Unicode не должны повреждаться');
assert.equal(voice.splitSpeechText('Один.\n\nДва.').join(' '), 'Один. Два.');
console.log(`Assistant speech content checks passed: ${cases.length} detailed scenarios, generic response families and lossless chunking`);
