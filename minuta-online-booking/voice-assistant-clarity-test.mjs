import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const voice = createRequire(import.meta.url)('./voice-assistant.js');
const now = new Date(2026, 8, 5, 14);
const snapshot = {
  authenticated:true, synchronized:true, today:'2026-09-05', currentMinute:14 * 60,
  currentRole:'owner', services:[{ id:'massage', name:'Массаж', durationMinutes:60 }],
  bookings:[
    { id:'past', clientName:'Анна', date:'2026-09-05', time:'09:00', outcome:'completed', status:'confirmed' },
    { id:'missed', clientName:'Ольга', date:'2026-09-05', time:'13:00', status:'confirmed' },
    { id:'next', clientName:'Мария', date:'2026-09-05', time:'17:00', status:'confirmed' },
    { id:'anna', clientName:'Анна', date:'2026-09-06', time:'11:00', status:'confirmed' }
  ]
};
assert.match(voice.operationalBriefingModel(snapshot, now).points[0], /17:00.*Мария/);
assert.equal(voice.interpretCommand('Кто ко мне следующий?', snapshot, now).items[0].id, 'next');
assert.match(voice.operationalBriefingModel({ ...snapshot, currentMinute:18 * 60 }, now).message, /Предстоящих записей сегодня нет/);
assert.equal(voice.interpretCommand('Какие записи сегодня?', snapshot, now).total, 3, 'полный журнал не должен терять прошедшие визиты');
const message = voice.interpretCommand('Напиши Анне, что я задержусь на 15 минут', snapshot, now);
assert.equal(message.kind, 'message_draft');
assert.match(message.draftText, /Анна! Я задержусь на 15 минут/);
assert.equal(message.plan, undefined, 'сообщение не должно создавать запись на 15:00');
const unknown = voice.interpretCommand('Напиши Виктору, что я задержусь на 15 минут', { ...snapshot, bookings:[snapshot.bookings[2]] }, now);
assert.doesNotMatch(unknown.draftText, /Мария/);
assert.ok(unknown.needsDetail);
for (const command of ['Перенеси всех клиентов завтра на час позже', 'Отмени все записи завтра']) {
  const model = voice.interpretCommand(command, { ...snapshot, bookings:[snapshot.bookings[2]] }, now);
  assert.equal(model.kind, 'operation_preview');
  assert.equal(model.plan.bookingId, '');
  assert.ok(model.needsDetail);
}
for (const command of ['Как включить бонусы?', 'Где промокоды?', 'Открой лояльность']) {
  assert.equal(voice.interpretCommand(command, snapshot, now).openSection, 'organization');
}
assert.equal(voice.interpretCommand('Почему стало меньше записей?', snapshot, now).kind, 'booking_change');
const allSlots = Array.from({ length:45 }, (_, i) => `${String(9 + Math.floor(i / 4)).padStart(2, '0')}:${String(i % 4 * 15).padStart(2, '0')}`);
assert.equal(voice.applySlotPreferences(allSlots, voice.parseTimePreference('после 18:00')).slots[0], '18:00');
const provider = readFileSync(new URL('./provider.js', import.meta.url), 'utf8');
assert.doesNotMatch(provider, /slots:\[\.\.\.new Set\(slots\)\]\.slice\(0, 24\)/, 'поздние окна нельзя отбрасывать до фильтра условий');
assert.match(provider, /currentMinute:providerAssistantCurrentMinute\(\)/);
console.log('Assistant clarity regressions passed');
