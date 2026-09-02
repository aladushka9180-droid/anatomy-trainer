import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const provider = readFileSync(join(root, 'provider.js'), 'utf8');

const slotLoader = provider.match(/async function loadNewBookingSlots\(\) \{[\s\S]*?\n\}/)?.[0] || '';
const creator = provider.match(/async function createNewBooking\(event\) \{[\s\S]*?\n\}/)?.[0] || '';

assert.ok(slotLoader, 'Не найдена загрузка времени новой записи');
assert.match(slotLoader, /if \(!navigator\.onLine\)[\s\S]*newBookingTime = preferredTime \|\| '';/, 'Офлайн-режим теряет явно выбранное время');
assert.doesNotMatch(slotLoader, /preferredTime && newBookingSlots\.includes\(preferredTime\) \? preferredTime : ''/, 'Вернулась ошибка, очищающая время при пустой локальной выдаче');
assert.match(slotLoader, /сохранится как отложенный запрос[\s\S]*сервер проверит время/i, 'Пользователь не видит, что время ожидает серверной проверки');
assert.match(provider, /submit\.disabled = Boolean\(!navigator\.onLine && newBookingMode === 'client' && !newBookingTime\)/, 'Кнопка офлайн-сохранения активна без выбранного времени');

assert.ok(creator, 'Не найдено создание новой записи');
for (const message of ['Укажите имя клиента.', 'Укажите полный номер телефона.', 'Выберите услугу.', 'Выберите дату.', 'Выберите время записи.']) {
  assert.ok(creator.includes(message), `Нет точной ошибки проверки: ${message}`);
}
assert.match(creator, /if \(!navigator\.onLine\)[\s\S]*queueOfflineBooking\([\s\S]*time:newBookingTime/, 'Выбранное офлайн-время не передаётся в надёжную очередь');
assert.match(provider, /Данные формы сохранены · запись ещё не добавлена/, 'Черновик всё ещё можно принять за созданную запись');

const runOfflineSlotLoader = new Function(`
  return async ({ preferredTime, slots }) => {
    let newBookingPreferredTime = preferredTime;
    let newBookingTime = '';
    let newBookingSlots = [];
    let newBookingHour = '';
    let pickerRendered = false;
    let submitUpdated = false;
    const holder = { innerHTML:'' };
    const navigator = { onLine:false };
    const $ = selector => selector === '#newBookingService' ? { value:'service-1' } : selector === '#newBookingDate' ? { value:'2099-09-07' } : selector === '#newBookingTimes' ? holder : null;
    const offlineCandidateSlots = () => slots;
    const renderNewBookingTimePicker = () => { pickerRendered = true; };
    const escapeHtml = value => String(value);
    const clearFormError = () => {};
    const updateNewBookingSubmitCaption = () => { submitUpdated = true; };
    const db = { rpc:async () => ({ data:[], error:null }) };
    ${slotLoader}
    await loadNewBookingSlots();
    return { newBookingTime, newBookingHour, html:holder.innerHTML, pickerRendered, submitUpdated };
  };
`)();

const emptySnapshot = await runOfflineSlotLoader({ preferredTime:'14:35', slots:[] });
assert.equal(emptySnapshot.newBookingTime, '14:35', 'Выбранное время потеряно при пустой локальной выдаче');
assert.match(emptySnapshot.html, /14:35 сохранится как отложенный запрос/, 'Нет понятного подтверждения отложенного времени');
assert.equal(emptySnapshot.submitUpdated, true, 'Состояние кнопки не обновлено после офлайн-расчёта');

const otherCachedSlots = await runOfflineSlotLoader({ preferredTime:'14:35', slots:['15:00', '15:05'] });
assert.equal(otherCachedSlots.newBookingTime, '14:35', 'Выбранное время заменено локальным предложением');
assert.equal(otherCachedSlots.pickerRendered, true, 'Альтернативные локальные окна не отображаются');

const noExplicitTime = await runOfflineSlotLoader({ preferredTime:'', slots:[] });
assert.equal(noExplicitTime.newBookingTime, '', 'Время нельзя выбирать за пользователя');
assert.match(noExplicitTime.html, /Откройте нужное время из расписания/, 'Нет инструкции при отсутствии выбранного времени');

console.log('offline booking draft v220 test: OK');
