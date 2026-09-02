import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const provider = readFileSync(join(root, 'provider.js'), 'utf8');
const start = provider.indexOf('function offlineBookingConflictText');
const end = provider.indexOf('function renderOfflineBookingQueue', start);
assert.ok(start >= 0 && end > start, 'Не удалось извлечь обработчики уведомлений офлайн-записи');

const journal = [];
const toasts = [];
const systemNotifications = [];
const context = {
  window:{ Notification:{ permission:'granted' } },
  Notification:{ permission:'granted' },
  document:{ hidden:false },
  recordConnectionEvent:(kind, text) => journal.push({ kind, text }),
  notify:text => toasts.push(text),
  showProviderSystemNotification:notice => systemNotifications.push(notice),
};
vm.createContext(context);
vm.runInContext(`${provider.slice(start, end)}\nthis.api = { stageOfflineBookingProviderNotice, deliverOfflineBookingProviderNotice };`, context);

const successItem = { id:'offline-1', clientName:'Анна', date:'2026-09-03', time:'10:30', reason:'' };
const success = context.api.stageOfflineBookingProviderNotice(successItem, 'created', { clientNotified:true });
assert.equal(success.title, 'Отложенная запись создана');
assert.match(success.body, /Анна.*Клиент получил подтверждение/);
assert.equal(context.api.deliverOfflineBookingProviderNotice(success), true);
assert.equal(journal.at(-1).kind, 'online');
assert.equal(systemNotifications.at(-1).view, 'bookings');

const conflictItem = { id:'offline-2', clientName:'Борис', date:'2026-09-03', time:'11:00', reason:'slot_unavailable' };
const conflict = context.api.stageOfflineBookingProviderNotice(conflictItem, 'conflict');
assert.equal(conflict.title, 'Отложенная запись не создана');
assert.match(conflict.body, /Выбранное время уже занято/);
assert.equal(context.api.stageOfflineBookingProviderNotice(conflictItem, 'conflict'), null, 'Повторная синхронизация не должна дублировать уведомление');
context.api.deliverOfflineBookingProviderNotice(conflict);
assert.equal(journal.at(-1).kind, 'warning');
assert.match(toasts.at(-1), /не создана.*время уже занято/);

context.Notification.permission = 'denied';
context.window.Notification.permission = 'denied';
const beforeDenied = systemNotifications.length;
const denied = context.api.stageOfflineBookingProviderNotice({ id:'offline-3', clientName:'Вера', date:'2026-09-03', time:'12:00', reason:'service_unavailable' }, 'conflict');
context.api.deliverOfflineBookingProviderNotice(denied);
assert.equal(systemNotifications.length, beforeDenied, 'Системное уведомление нельзя показывать без разрешения браузера');
assert.match(journal.at(-1).text, /Услуга больше недоступна/, 'Результат всё равно должен оставаться в журнале связи');

console.log('Offline booking provider notification tests passed.');
