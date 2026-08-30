const db = window.supabase.createClient(window.MINUTA_CONFIG.supabaseUrl, window.MINUTA_CONFIG.supabaseKey);
const $ = selector => document.querySelector(selector);
const token = new URLSearchParams(location.search).get('token') || '';
const state = { booking: null, dates: [], availability: new Map(), date: '', time: '' };

function escapeHtml(value) { return String(value || '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
function money(value) { return `${new Intl.NumberFormat('ru-RU').format(value)} ₽`; }
function localIsoDate(date) { return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-'); }
function notify(message) { const toast = $('#toast'); toast.textContent = message; toast.hidden = false; clearTimeout(notify.timer); notify.timer = setTimeout(() => { toast.hidden = true; }, 2800); }

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
  $('#manageService').textContent = item.service_name;
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
  $('#openReschedule').disabled = cancelled;
  $('#cancelBooking').disabled = cancelled;
  if (cancelled) $('#manageActions').classList.add('cancelled');
}

async function loadBooking() {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return showNotFound();
  const { data, error } = await db.rpc('get_booking_by_token', { p_token: token });
  if (error || !data?.length) return showNotFound();
  state.booking = data[0];
  $('#manageLoading').hidden = true;
  $('#manageContent').hidden = false;
  renderBooking();
}

function showNotFound() { $('#manageLoading').hidden = true; $('#manageError').hidden = false; }

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
  if (error) { $('#manageFormError').textContent = 'Не удалось загрузить свободное время.'; $('#manageFormError').hidden = false; }
  $('#reschedulePanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeReschedule() { $('#reschedulePanel').hidden = true; $('#manageActions').hidden = false; }

async function confirmReschedule() {
  if (!state.time) return;
  const button = $('#confirmReschedule');
  button.disabled = true; button.textContent = 'Сохраняем…';
  const { error } = await db.rpc('reschedule_booking', { p_token: token, p_date: state.date, p_time: `${state.time}:00` });
  button.textContent = 'Сохранить новое время';
  if (error) { $('#manageFormError').textContent = 'Это время уже занято. Выберите другое.'; $('#manageFormError').hidden = false; await openReschedule(); return; }
  closeReschedule(); notify('Запись перенесена'); await loadBooking();
}

async function cancelBooking() {
  if (!confirm('Отменить эту запись?')) return;
  const button = $('#cancelBooking'); button.disabled = true; button.textContent = 'Отменяем…';
  const { error } = await db.rpc('cancel_booking', { p_token: token });
  if (error) { button.disabled = false; button.textContent = 'Отменить запись'; notify('Не удалось отменить запись'); return; }
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
loadBooking();
