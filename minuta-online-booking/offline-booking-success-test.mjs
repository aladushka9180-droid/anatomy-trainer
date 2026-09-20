import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./provider.js', import.meta.url), 'utf8');
function actual(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, name);
  const next = source.slice(start + 1).search(/^(?:async )?function /m);
  return source.slice(start, next < 0 ? undefined : start + next + 1);
}

const nodes = {
  panel:{ hidden:true, classList:{ toggle(name, active) { this[name] = active; } } },
  list:{ innerHTML:'', replaceChildren() { this.innerHTML = ''; } },
  status:{ textContent:'' }, head:{ hidden:false }, title:{ textContent:'Сохранено на устройстве' }, details:{ hidden:false }, retry:{ hidden:false, disabled:false }
};
const box = vm.createContext({
  console, navigator:{ onLine:true }, currentUser:{ id:'provider-1' }, ownServices:[{ id:'service-1', name:'Общий массаж', duration_minutes:90 }],
  window:{ addEventListener() {} },
  offlineBookingQueue:[], offlineBookingCompletion:null, offlineBookingCompletionTimer:null,
  $:selector => ({ '#offlineBookingQueuePanel':nodes.panel, '#offlineBookingQueueList':nodes.list, '#offlineBookingQueueStatus':nodes.status,
    '#offlineBookingQueueHead':nodes.head, '#offlineBookingQueueTitle':nodes.title, '#offlineBookingQueueDetails':nodes.details, '#retryOfflineBookings':nodes.retry })[selector] || null,
  escapeHtml:value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
  parseLocalIsoDate:value => new Date(`${value}T12:00:00`), serviceName:value => value,
  renderBookingData() {}, setTimeout:() => 1, clearTimeout() {}
});
vm.runInContext([
  actual('minutesFromTime'), actual('timeFromMinutes'), actual('offlineBookingServiceName'), actual('offlineBookingConflictText'),
  actual('showOfflineBookingCompletion'), actual('dismissOfflineBookingCompletion'), actual('renderOfflineBookingQueue')
].join('\n'), box);

const item = { id:'offline-1', clientName:'Рамиль', serviceId:'service-1', serviceName:'Общий массаж', date:'2026-09-23', time:'12:00', durationMinutes:90 };
assert.equal(box.showOfflineBookingCompletion(item, { client_name:'Рамиль', booking_time:'12:00:00', duration_minutes:90, services:{ name:'Общий массаж' } }, { delivered:false, retryable:false, reason:'not_connected' }), true);
assert.equal(item.bookingCreationConfirmed, true);
assert.equal(box.showOfflineBookingCompletion(item, {}, { delivered:true, retryable:false }), false, 'confirmed booking must not stage the card twice');
assert.equal(nodes.panel.hidden, false);
assert.equal(nodes.head.hidden, false);
assert.equal(nodes.title.textContent, 'Офлайн-запись');
assert.equal(nodes.details.hidden, true);
assert.match(nodes.list.innerHTML, /offline-booking-item is-created/);
assert.match(nodes.list.innerHTML, /Запись создана/);
assert.match(nodes.list.innerHTML, /Рамиль · Общий массаж · 12:00–13:30/);
assert.match(nodes.list.innerHTML, /Уведомление клиенту не отправлено — Telegram не подключён/);
assert.doesNotMatch(nodes.list.innerHTML, /Будет проверено при подключении/);

box.dismissOfflineBookingCompletion();
assert.equal(nodes.panel.hidden, true);
assert.equal(nodes.list.innerHTML, '');
assert.equal(nodes.head.hidden, false);
assert.equal(nodes.title.textContent, 'Сохранено на устройстве');

const finalize = actual('finalizeQueuedBooking');
assert.match(finalize, /await deliverTelegramClientNotification[\s\S]*showOfflineBookingCompletion/, 'success must not be shown before Telegram result follows confirmed booking creation');
assert.match(source, /function showOfflineBookingCompletion[\s\S]*renderBookingData\(\);\s*renderOfflineBookingQueue\(\);/, 'schedule must render before the success row is revealed');
assert.match(source, /item\.bookingCreationConfirmed = true[\s\S]*saveOfflineBookingQueue/, 'notification retries must persist the one-time confirmation guard');

console.log('Offline booking success transition checks passed');
