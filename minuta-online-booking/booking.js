const db = window.supabase.createClient(window.MINUTA_CONFIG.supabaseUrl, window.MINUTA_CONFIG.supabaseKey);
const telegramClientEndpoint = `${window.MINUTA_CONFIG.supabaseUrl}/functions/v1/telegram-client-notify`;
const yookassaPaymentEndpoint = `${window.MINUTA_CONFIG.supabaseUrl}/functions/v1/yookassa-create-payment`;
const $ = selector => document.querySelector(selector);
const token = new URLSearchParams(location.search).get('token') || new URLSearchParams(location.hash.slice(1)).get('token') || '';
if (new URLSearchParams(location.search).has('token')) history.replaceState({}, '', `booking.html#token=${encodeURIComponent(token)}`);
const state = { booking: null, paymentCapability: null, dates: [], availability: new Map(), date: '', time: '' };
let bookingLoadRevision = 0;

function escapeHtml(value) { return String(value || '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
function createRequestId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function httpsPaymentUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && url.hostname && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
function paymentRequestId(manageToken) {
  const key = `minuta-payment-request-v1:${manageToken}`;
  try {
    const saved = sessionStorage.getItem(key);
    if (/^[0-9a-f-]{36}$/i.test(saved || '')) return saved;
    const created = createRequestId();
    sessionStorage.setItem(key, created);
    return created;
  } catch { return createRequestId(); }
}
async function getPaymentCapability() {
  try {
    const { data, error } = await db.rpc('get_yookassa_payment_capability', { p_manage_token: token });
    return error || !data || typeof data !== 'object' || Array.isArray(data) ? null : data;
  } catch { return null; }
}
function isMissingRpc(error, name) {
  const text = `${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`;
  return /PGRST202|42883/i.test(text) || new RegExp(`function\\s+[^\\n]*${name}[^\\n]*does not exist`, 'i').test(text);
}
function money(value) { return `${new Intl.NumberFormat('ru-RU').format(value)} ₽`; }
function serviceName(value) { return value === 'Общий массаж задней поверхности' ? 'Массаж задней поверхности тела' : value; }
function localIsoDate(date) { return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-'); }
function notify(message) { const toast = $('#toast'); toast.textContent = message; toast.hidden = false; clearTimeout(notify.timer); notify.timer = setTimeout(() => { toast.hidden = true; }, 2800); }
function telegramConnectUrl() { return `${telegramClientEndpoint}/connect?token=${encodeURIComponent(token)}`; }
function notifyTelegramEvent(event) {
  return fetch(`${telegramClientEndpoint}/event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: window.MINUTA_CONFIG.supabaseKey },
    body: JSON.stringify({ event, manage_token: token })
  }).catch(() => null);
}
function deadlineLabel(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function setFreshness(kind, text) {
  const element = $('#manageFreshness');
  element.className = `manage-freshness ${kind === 'stale' ? 'is-stale' : ''}`;
  element.textContent = text;
}
function markBookingStale(text = 'Не удалось обновить данные — показана сохранённая на экране версия.') {
  setFreshness('stale', text);
  $('#openReschedule').disabled = true;
  $('#cancelBooking').disabled = true;
  $('#confirmReschedule').disabled = true;
  $('#confirmAttendance').disabled = true;
  $('#reschedulePanel').hidden = true;
  $('#manageActions').hidden = false;
  $('#managePaymentLink').hidden = true;
  delete $('#managePaymentLink').dataset.paymentToken;
}

async function startOnlinePayment(link) {
  if (link.getAttribute('aria-busy') === 'true') return;
  const fallbackUrl = httpsPaymentUrl(link.getAttribute('href'));
  if (!navigator.onLine) {
    if (fallbackUrl) location.href = fallbackUrl;
    else notify('Для оплаты требуется интернет');
    return;
  }
  link.setAttribute('aria-busy', 'true');
  const previous = link.textContent;
  link.textContent = 'Открываем оплату…';
  try {
    const response = await fetch(yookassaPaymentEndpoint, {
      method:'POST',
      headers:{ 'content-type':'application/json', apikey:window.MINUTA_CONFIG.supabaseKey },
      body:JSON.stringify({ manage_token:token, request_id:paymentRequestId(token) })
    });
    const result = await response.json().catch(() => ({}));
    if (response.ok && result?.ok && result.status === 'succeeded') {
      link.removeAttribute('aria-busy');
      link.textContent = previous;
      await loadBooking({ silent:true });
      notify('Оплата уже подтверждена');
      return;
    }
    const paymentUrl = httpsPaymentUrl(result?.payment_url);
    if (!response.ok || !result?.ok || !paymentUrl) throw new Error(result?.error || 'payment_unavailable');
    location.href = paymentUrl;
  } catch {
    link.removeAttribute('aria-busy');
    link.textContent = previous;
    if (fallbackUrl) location.href = fallbackUrl;
    else notify('Не удалось открыть оплату. Попробуйте снова позже.');
  }
}

function createDates() {
  const weekday = new Intl.DateTimeFormat('ru-RU', { weekday: 'short' });
  return Array.from({ length: 14 }, (_, index) => {
    const date = new Date(); date.setHours(12, 0, 0, 0); date.setDate(date.getDate() + index);
    return { iso: localIsoDate(date), day: date.getDate(), weekday: weekday.format(date).replace('.', '') };
  });
}

function renderBooking() {
  const item = state.booking;
  const date = new Date(`${item.booking_date}T12:00:00`);
  const statusMap = { new: 'Ожидает подтверждения', confirmed: 'Подтверждена', cancelled: 'Отменена' };
  $('#manageService').textContent = serviceName(item.service_name);
  $('#manageStatus').textContent = statusMap[item.status] || item.status;
  $('#manageStatus').className = `manage-status status-${item.status}`;
  $('#manageDay').textContent = String(date.getDate());
  $('#manageMonth').textContent = date.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '');
  $('#manageDate').textContent = date.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  $('#manageTime').textContent = `Начало в ${String(item.booking_time).slice(0, 5)}`;
  $('#managePerformer').textContent = item.performer_name;
  $('#manageDuration').textContent = `${item.duration_minutes} мин`;
  $('#managePrice').textContent = money(item.price_rub);
  const cancelled = item.status === 'cancelled';
  $('#attendanceConfirmation').hidden = item.status !== 'new';
  $('#confirmAttendance').disabled = item.status !== 'new';
  $('#openReschedule').disabled = cancelled || !item.reschedule_allowed;
  $('#cancelBooking').disabled = cancelled || !item.cancel_allowed;
  if (!$('#reschedulePanel').hidden) $('#confirmReschedule').disabled = !state.time;
  $('#cancelBooking').textContent = 'Отменить запись';
  const policy = $('#managePolicy');
  if (cancelled) policy.textContent = 'Запись отменена.';
  else {
    const parts = [];
    if (item.reschedule_allowed) parts.push(`перенос доступен до ${deadlineLabel(item.reschedule_deadline)} · осталось ${item.reschedules_remaining}`);
    else parts.push('самостоятельный перенос уже недоступен');
    if (item.cancel_allowed) parts.push(`отмена доступна до ${deadlineLabel(item.cancel_deadline)}`);
    else parts.push('самостоятельная отмена уже недоступна');
    policy.textContent = parts.join('; ');
  }
  const payment = $('#managePayment');
  const deposit = Number(item.deposit_amount_rub || 0);
  payment.hidden = deposit <= 0;
  if (deposit > 0) {
    const labels = { pending: 'Ожидается', paid: 'Оплачено', refunded: 'Возвращено', not_required: 'Не требуется' };
    const refundLabels = { pending: 'Возврат оформляется', refunded: 'Возвращено', denied: 'Без возврата' };
    $('#manageDeposit').textContent = money(deposit);
    const cancelledWithoutCharge = cancelled && item.payment_status === 'pending' && (!item.refund_status || item.refund_status === 'not_required');
    const paymentLabel = cancelledWithoutCharge ? 'Оплата отменена' : refundLabels[item.refund_status]
      || (item.payment_status === 'pending' && item.payment_due_at ? `Оплатить до ${deadlineLabel(item.payment_due_at)}` : labels[item.payment_status] || item.payment_status);
    $('#managePaymentStatus').textContent = paymentLabel;
    $('#managePaymentStatus').className = `payment-status status-${cancelledWithoutCharge || item.refund_status === 'refunded' ? 'refunded' : item.payment_status}`;
    const link = $('#managePaymentLink');
    const dueAt = item.payment_due_at ? new Date(item.payment_due_at).getTime() : Number.POSITIVE_INFINITY;
    const legacyUrl = httpsPaymentUrl(item.payment_url);
    const capabilityUrl = httpsPaymentUrl(state.paymentCapability?.payment_url);
    const fallbackUrl = httpsPaymentUrl(state.paymentCapability?.fallback_url) || legacyUrl;
    const canPay = !cancelled && item.payment_status === 'pending' && dueAt > Date.now();
    const hasPaymentRoute = state.paymentCapability ? state.paymentCapability.available === true : Boolean(legacyUrl);
    const canStartPayment = canPay && hasPaymentRoute;
    const canCreate = canStartPayment && state.paymentCapability?.can_create === true;
    link.hidden = !canStartPayment;
    link.href = capabilityUrl || fallbackUrl || '#';
    delete link.dataset.paymentToken;
    if (canCreate) link.dataset.paymentToken = token;
  }
  setFreshness('fresh', `Проверено в ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`);
  if (cancelled) $('#manageActions').classList.add('cancelled');
}

async function confirmAttendance() {
  const button = $('#confirmAttendance');
  button.disabled = true;
  button.textContent = 'Подтверждаем…';
  const { error } = await db.rpc('confirm_booking_by_token', { p_token: token });
  if (error) {
    button.disabled = false;
    button.textContent = 'Да, я приду';
    notify('Не удалось подтвердить визит. Попробуйте ещё раз.');
    return;
  }
  await loadBooking({ silent: true });
  button.disabled = false;
  button.textContent = 'Да, я приду';
  notify('Визит подтверждён');
}

async function loadBooking(options = {}) {
  const revision = ++bookingLoadRevision;
  if (!options.silent) {
    $('#manageLoading').hidden = false;
    $('#manageError').hidden = true;
  }
  if (!/^[0-9a-f-]{36}$/i.test(token)) { if (!options.silent) showNotFound(); return false; }
  const paymentCapabilityPromise = getPaymentCapability();
  let { data, error } = await db.rpc('get_booking_management_v2', { p_token: token });
  if (error && isMissingRpc(error, 'get_booking_management_v2')) ({ data, error } = await db.rpc('get_booking_management', { p_token: token }));
  const paymentCapability = await paymentCapabilityPromise;
  if (revision !== bookingLoadRevision) return false;
  if (error) { if (!options.silent) showLoadError(); else markBookingStale(); return false; }
  if (!data?.length) { if (!options.silent) showNotFound(); else markBookingStale('Запись больше не найдена — обновите страницу или свяжитесь с исполнителем.'); return false; }
  state.booking = data[0];
  state.paymentCapability = paymentCapability;
  $('#manageLoading').hidden = true;
  $('#manageContent').hidden = false;
  $('#manageTelegramConnect').href = telegramConnectUrl();
  renderBooking();
  return true;
}

function showNotFound() {
  $('#manageLoading').hidden = true;
  $('#manageError').hidden = false;
  $('#manageErrorTitle').textContent = 'Запись не найдена';
  $('#manageErrorText').textContent = 'Ссылка могла быть повреждена или отозвана. Проверьте её или создайте новую запись.';
  $('#retryManage').hidden = true;
}
function showLoadError() {
  $('#manageLoading').hidden = true;
  $('#manageError').hidden = false;
  $('#manageErrorTitle').textContent = navigator.onLine ? 'Не удалось проверить запись' : 'Нет соединения с интернетом';
  $('#manageErrorText').textContent = 'Мы не получили актуальные данные от сервера. Информация на экране могла устареть — повторите проверку позже.';
  $('#retryManage').hidden = false;
}

function renderDates() {
  $('#manageDates').innerHTML = state.dates.map(item => {
    const slots = state.availability.get(item.iso) || [];
    const disabled = !slots.length;
    return `<button class="date ${item.iso === state.date ? 'selected' : ''} ${disabled ? 'unavailable' : ''}" type="button" data-manage-date="${item.iso}" ${disabled ? 'disabled' : ''}><small>${item.weekday}</small><strong>${item.day}</strong>${disabled ? '<i>нет мест</i>' : ''}</button>`;
  }).join('');
}

function renderTimes() {
  const times = state.availability.get(state.date) || [];
  if (!times.includes(state.time)) state.time = times[0] || '';
  $('#manageTimes').innerHTML = times.map(time => `<button class="time ${time === state.time ? 'selected' : ''}" type="button" data-manage-time="${time}">${time}</button>`).join('');
  $('#manageNoTimes').hidden = Boolean(times.length);
  $('#confirmReschedule').disabled = !state.time;
}

async function openReschedule() {
  $('#manageFormError').hidden = true;
  $('#reschedulePanel').hidden = false;
  $('#manageActions').hidden = true;
  state.dates = createDates();
  state.date = state.dates[0].iso;
  state.time = '';
  $('#manageDates').innerHTML = '<div class="loading-state compact"><i></i><span>Ищем свободные даты…</span></div>';
  $('#manageTimes').innerHTML = '';
  const parameters = { p_token: token, p_start: state.dates[0].iso, p_end: state.dates[state.dates.length - 1].iso };
  let { data, error } = await db.rpc('get_minuta_group_safe_reschedule_slots', parameters);
  if (error && isMissingRpc(error, 'get_minuta_group_safe_reschedule_slots')) {
    ({ data, error } = await db.rpc('get_reschedule_slots_v5', parameters));
  }
  if (error && isMissingRpc(error, 'get_reschedule_slots_v5')) {
    ({ data, error } = await db.rpc('get_reschedule_slots_v4', parameters));
  }
  if (error && isMissingRpc(error, 'get_reschedule_slots_v4')) {
    ({ data, error } = await db.rpc('get_reschedule_slots_v3', parameters));
  }
  if (error && isMissingRpc(error, 'get_reschedule_slots_v3')) {
    ({ data, error } = await db.rpc('get_reschedule_slots', parameters));
  }
  state.dates.forEach(item => state.availability.set(item.iso, []));
  if (!error) (data || []).forEach(item => state.availability.set(item.booking_date, [...(state.availability.get(item.booking_date) || []), String(item.booking_time).slice(0, 5)]));
  const first = state.dates.find(item => (state.availability.get(item.iso) || []).length);
  if (first) state.date = first.iso;
  renderDates(); renderTimes();
  if (error) {
    const message = error.message || '';
    $('#manageFormError').textContent = message.includes('reschedule_too_late') ? 'Срок самостоятельного переноса уже закончился.' : message.includes('reschedule_limit_reached') ? 'Лимит самостоятельных переносов исчерпан.' : 'Не удалось загрузить свободное время.';
    $('#manageFormError').hidden = false;
  }
  $('#reschedulePanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeReschedule() { $('#reschedulePanel').hidden = true; $('#manageActions').hidden = false; }

async function confirmReschedule() {
  if (!state.time) return;
  const button = $('#confirmReschedule');
  button.disabled = true; button.textContent = 'Сохраняем…';
  const requestedDate = state.date;
  const requestedTime = state.time;
  let { error } = await db.rpc('reschedule_booking_v2', { p_token: token, p_date: requestedDate, p_time: `${requestedTime}:00` });
  if (error && isMissingRpc(error, 'reschedule_booking_v2')) ({ error } = await db.rpc('reschedule_booking', { p_token: token, p_date: requestedDate, p_time: `${requestedTime}:00` }));
  button.textContent = 'Сохранить новое время';
  button.disabled = false;
  if (error) {
    if (error.message?.includes('reschedule_too_late') || error.message?.includes('reschedule_limit_reached')) {
      $('#manageFormError').textContent = error.message.includes('reschedule_too_late') ? 'Срок самостоятельного переноса уже закончился.' : 'Лимит самостоятельных переносов исчерпан.';
      $('#manageFormError').hidden = false;
      await loadBooking({ silent: true });
      return;
    }
    const conflict = error.message?.includes('slot_unavailable') || error.code === '23P01' || error.code === '23505';
    if (conflict) await openReschedule();
    if (!conflict) {
      const verified = await loadBooking({ silent: true });
      if (verified && state.booking.booking_date === requestedDate && String(state.booking.booking_time).slice(0, 5) === requestedTime) {
        notifyTelegramEvent('rescheduled');
        closeReschedule(); notify('Запись перенесена'); return;
      }
      if (!verified) { button.disabled = true; button.textContent = 'Сначала обновите запись'; }
    }
    $('#manageFormError').textContent = conflict ? 'Это время уже занято. Выберите другое.' : 'Результат переноса не подтверждён. Не повторяйте действие сразу — сначала обновите состояние записи.';
    $('#manageFormError').hidden = false;
    return;
  }
  notifyTelegramEvent('rescheduled');
  closeReschedule(); notify('Запись перенесена'); await loadBooking();
}

async function cancelBooking() {
  if (!confirm('Отменить эту запись?')) return;
  const button = $('#cancelBooking'); button.disabled = true; button.textContent = 'Отменяем…';
  let { error } = await db.rpc('cancel_booking_v2', { p_token: token });
  if (error && isMissingRpc(error, 'cancel_booking_v2')) ({ error } = await db.rpc('cancel_booking', { p_token: token }));
  if (error) {
    if (error.message?.includes('cancel_too_late')) {
      notify('Срок самостоятельной отмены закончился — свяжитесь с исполнителем');
      await loadBooking({ silent: true });
      return;
    }
    const verified = await loadBooking({ silent: true });
    button.disabled = !verified || state.booking?.status === 'cancelled'; button.textContent = 'Отменить запись';
    if (verified && state.booking.status === 'cancelled') { notifyTelegramEvent('cancelled'); notify('Запись отменена'); return; }
    if (!verified) { button.disabled = true; button.textContent = 'Сначала обновите запись'; }
    notify('Результат отмены не подтверждён — обновите запись перед повтором');
    return;
  }
  notifyTelegramEvent('cancelled');
  notify('Запись отменена'); await loadBooking();
}

function calendarStartMs(date, time, addMinutes = 0) {
  const [year, month, day] = String(date).split('-').map(Number);
  const [hour, minute] = String(time).slice(0, 5).split(':').map(Number);
  return Date.UTC(year, month - 1, day, hour - 4, minute + addMinutes);
}
function calendarTimestamp(date, time, addMinutes = 0) { return new Date(calendarStartMs(date, time, addMinutes)).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'); }

function calendarUtcTimestamp() { return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'); }
function calendarText(value) { return String(value).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1'); }

function calendarEvent() {
  const item = state.booking;
  return {
    title: `${item.service_name} — Массаж в Ижевске`,
    description: `Исполнитель: ${item.performer_name}`,
    location: 'Ижевск, ул. Карла Маркса, 304б',
    startMs: calendarStartMs(item.booking_date, item.booking_time),
    endMs: calendarStartMs(item.booking_date, item.booking_time, item.duration_minutes),
    start: calendarTimestamp(item.booking_date, item.booking_time),
    end: calendarTimestamp(item.booking_date, item.booking_time, item.duration_minutes)
  };
}

function calendarFile() {
  const item = state.booking;
  const event = calendarEvent();
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'PRODID:-//MassageIzhevsk//Booking//RU', 'BEGIN:VEVENT', `UID:${item.booking_code}@massage-izhevsk`, `DTSTAMP:${calendarUtcTimestamp()}`, `DTSTART:${event.start}`, `DTEND:${event.end}`, `SUMMARY:${calendarText(event.title)}`, `DESCRIPTION:${calendarText(event.description)}`, `LOCATION:${calendarText(event.location)}`, 'END:VEVENT', 'END:VCALENDAR', ''];
  const name = `massage-${item.booking_date}-${String(item.booking_time).slice(0, 5).replace(':', '-')}.ics`;
  return new File([lines.join('\r\n')], name, { type: 'text/calendar' });
}

function openCalendarFile(file = calendarFile()) {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.type = 'text/calendar';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function appleCalendarFile() { openCalendarFile(); }

function googleCalendarUrl(event) {
  const url = new URL('https://calendar.google.com/calendar/render');
  url.searchParams.set('action', 'TEMPLATE');
  url.searchParams.set('text', event.title);
  url.searchParams.set('dates', `${event.start}/${event.end}`);
  url.searchParams.set('details', event.description);
  url.searchParams.set('location', event.location);
  return url.href;
}

function androidCalendarIntent(event) {
  return `intent://com.android.calendar/events#Intent;scheme=content;action=android.intent.action.INSERT;type=vnd.android.cursor.dir/event;S.title=${encodeURIComponent(event.title)};S.description=${encodeURIComponent(event.description)};S.eventLocation=${encodeURIComponent(event.location)};l.beginTime=${event.startMs};l.endTime=${event.endMs};S.browser_fallback_url=${encodeURIComponent(googleCalendarUrl(event))};end`;
}

function addToCalendar() {
  const dialog = $('#calendarDialog');
  if (!dialog || typeof dialog.showModal !== 'function') { appleCalendarFile(); return; }
  $('#addAndroidCalendar').href = androidCalendarIntent(calendarEvent());
  dialog.showModal();
}

document.addEventListener('click', event => {
  const date = event.target.closest('[data-manage-date]'); const time = event.target.closest('[data-manage-time]');
  if (date && !date.disabled) { state.date = date.dataset.manageDate; state.time = ''; renderDates(); renderTimes(); }
  if (time) { state.time = time.dataset.manageTime; renderTimes(); }
});
$('#openReschedule').addEventListener('click', openReschedule);
$('#closeReschedule').addEventListener('click', closeReschedule);
$('#confirmReschedule').addEventListener('click', confirmReschedule);
$('#cancelBooking').addEventListener('click', cancelBooking);
$('#confirmAttendance').addEventListener('click', confirmAttendance);
$('#managePaymentLink').addEventListener('click', event => {
  if (!event.currentTarget.dataset.paymentToken) return;
  event.preventDefault();
  void startOnlinePayment(event.currentTarget);
});
$('#addCalendar').addEventListener('click', addToCalendar);
$('#addAppleCalendar').addEventListener('click', () => { appleCalendarFile(); $('#calendarDialog').close(); });
$('#addAndroidCalendar').addEventListener('click', () => $('#calendarDialog').close());
$('#closeCalendarDialog').addEventListener('click', () => $('#calendarDialog').close());
$('#calendarDialog').addEventListener('click', event => { if (event.target === $('#calendarDialog')) $('#calendarDialog').close(); });
$('#retryManage').addEventListener('click', loadBooking);
window.addEventListener('online', () => loadBooking({ silent: Boolean(state.booking) }));
document.addEventListener('visibilitychange', () => { if (!document.hidden && navigator.onLine) loadBooking({ silent: Boolean(state.booking) }); });
setInterval(() => { if (!document.hidden && navigator.onLine && state.booking) loadBooking({ silent: true }); }, 60000);
loadBooking();
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js?v=227'));
