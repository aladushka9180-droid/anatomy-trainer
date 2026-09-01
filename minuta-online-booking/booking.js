const db = window.supabase.createClient(window.MINUTA_CONFIG.supabaseUrl, window.MINUTA_CONFIG.supabaseKey);
const telegramClientEndpoint = `${window.MINUTA_CONFIG.supabaseUrl}/functions/v1/telegram-client-notify`;
const $ = selector => document.querySelector(selector);
const token = new URLSearchParams(location.search).get('token') || new URLSearchParams(location.hash.slice(1)).get('token') || '';
if (new URLSearchParams(location.search).has('token')) history.replaceState({}, '', `booking.html#token=${encodeURIComponent(token)}`);
const state = { booking: null, dates: [], availability: new Map(), date: '', time: '' };
let bookingLoadRevision = 0;

function escapeHtml(value) { return String(value || '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
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
  $('#reschedulePanel').hidden = true;
  $('#manageActions').hidden = false;
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
  const statusMap = { new: 'Новая', confirmed: 'Подтверждена', cancelled: 'Отменена' };
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
  $('#manageCode').textContent = item.booking_code;
  const cancelled = item.status === 'cancelled';
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
    $('#manageDeposit').textContent = money(deposit);
    $('#managePaymentStatus').textContent = labels[item.payment_status] || item.payment_status;
    $('#managePaymentStatus').className = `payment-status status-${item.payment_status}`;
    const link = $('#managePaymentLink');
    const canPay = item.payment_status === 'pending' && /^https:\/\//i.test(item.payment_url || '');
    link.hidden = !canPay;
    if (canPay) link.href = item.payment_url;
  }
  setFreshness('fresh', `Проверено в ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`);
  if (cancelled) $('#manageActions').classList.add('cancelled');
}

async function loadBooking(options = {}) {
  const revision = ++bookingLoadRevision;
  if (!options.silent) {
    $('#manageLoading').hidden = false;
    $('#manageError').hidden = true;
  }
  if (!/^[0-9a-f-]{36}$/i.test(token)) { if (!options.silent) showNotFound(); return false; }
  const { data, error } = await db.rpc('get_booking_management', { p_token: token });
  if (revision !== bookingLoadRevision) return false;
  if (error) { if (!options.silent) showLoadError(); else markBookingStale(); return false; }
  if (!data?.length) { if (!options.silent) showNotFound(); else markBookingStale('Запись больше не найдена — обновите страницу или свяжитесь с исполнителем.'); return false; }
  state.booking = data[0];
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
  const { data, error } = await db.rpc('get_reschedule_slots', { p_token: token, p_start: state.dates[0].iso, p_end: state.dates[state.dates.length - 1].iso });
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
  const { error } = await db.rpc('reschedule_booking', { p_token: token, p_date: requestedDate, p_time: `${requestedTime}:00` });
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
  const { error } = await db.rpc('cancel_booking', { p_token: token });
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

function calendarTimestamp(date, time, addMinutes = 0) {
  const value = new Date(`${date}T${String(time).slice(0, 5)}:00`); value.setMinutes(value.getMinutes() + addMinutes);
  return `${value.getFullYear()}${String(value.getMonth() + 1).padStart(2, '0')}${String(value.getDate()).padStart(2, '0')}T${String(value.getHours()).padStart(2, '0')}${String(value.getMinutes()).padStart(2, '0')}00`;
}

function addToCalendar() {
  const item = state.booking;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MassageIzhevsk//Booking//RU', 'BEGIN:VEVENT', `UID:${item.booking_code}@massage-izhevsk`, `DTSTART:${calendarTimestamp(item.booking_date, item.booking_time)}`, `DTEND:${calendarTimestamp(item.booking_date, item.booking_time, item.duration_minutes)}`, `SUMMARY:${item.service_name} — Массаж в Ижевске`, `DESCRIPTION:Исполнитель: ${item.performer_name}. Номер записи: ${item.booking_code}`, 'LOCATION:Ижевск, ул. Карла Маркса, 304б', 'END:VEVENT', 'END:VCALENDAR'];
  const url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `massage-${item.booking_code}.ics`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
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
$('#addCalendar').addEventListener('click', addToCalendar);
$('#retryManage').addEventListener('click', loadBooking);
window.addEventListener('online', () => loadBooking({ silent: Boolean(state.booking) }));
document.addEventListener('visibilitychange', () => { if (!document.hidden && navigator.onLine) loadBooking({ silent: Boolean(state.booking) }); });
setInterval(() => { if (!document.hidden && navigator.onLine && state.booking) loadBooking({ silent: true }); }, 60000);
loadBooking();
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js?v=51'));
