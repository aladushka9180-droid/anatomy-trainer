const db = window.supabase.createClient(window.MINUTA_CONFIG.supabaseUrl, window.MINUTA_CONFIG.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
const state = { step: 1, services: [], serviceId: '', date: '', time: '', hour: '', period: 'all', availability: new Map(), loadingAvailability: false };
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function localIsoDate(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}
function createDates() {
  const weekday = new Intl.DateTimeFormat('ru-RU', { weekday: 'short' });
  const full = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
  return Array.from({ length: 14 }, (_, index) => {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() + index);
    return { iso: localIsoDate(date), day: date.getDate(), weekday: weekday.format(date).replace('.', ''), label: full.format(date) };
  });
}

const dates = createDates();
state.date = dates[0].iso;
function money(value) { return `${new Intl.NumberFormat('ru-RU').format(value)} ₽`; }
function selectedService() { return state.services.find(item => item.id === state.serviceId); }
function selectedDate() { return dates.find(item => item.iso === state.date); }
function escapeHtml(value) { return String(value || '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
function serviceName(value) { return value === 'Общий массаж задней поверхности' ? 'Массаж задней поверхности тела' : value; }

async function loadServices() {
  const holder = $('#services');
  holder.innerHTML = '<div class="loading-state"><i></i><span>Загружаем услуги…</span></div>';
  const { data, error } = await db.from('services').select('id, performer_id, name, duration_minutes, price_rub, performer_profiles(display_name)').eq('active', true).order('created_at', { ascending: true });
  if (error) { holder.innerHTML = '<div class="empty-service"><strong>Не удалось загрузить услуги</strong><span>Проверьте интернет и обновите страницу.</span></div>'; return; }
  state.services = data || [];
  if (!state.services.some(item => item.id === state.serviceId)) state.serviceId = state.services[0]?.id || '';
  renderServices();
}

function renderServices() {
  const holder = $('#services');
  if (!state.services.length) {
    holder.innerHTML = '<div class="empty-service"><span class="empty-service-mark">＋</span><strong>Услуги скоро появятся</strong><span>Исполнитель ещё не добавил услуги в свой кабинет.</span><a href="provider.html">Войти исполнителю</a></div>';
    $('#toDate').disabled = true;
    return;
  }
  $('#toDate').disabled = false;
  holder.innerHTML = state.services.map((item, index) => `<button class="option ${item.id === state.serviceId ? 'selected' : ''}" type="button" data-service="${item.id}" aria-pressed="${item.id === state.serviceId}"><span class="service-symbol service-${(index % 3) + 1}">${['✦', '◇', '⌁'][index % 3]}</span><span class="option-main"><strong>${escapeHtml(serviceName(item.name))}</strong><small>${item.duration_minutes} мин · ${escapeHtml(item.performer_profiles?.display_name || 'Мастер')}</small></span><span class="option-price">${money(item.price_rub)}</span><span class="chevron">›</span></button>`).join('');
}

function renderDates() {
  $('#dates').innerHTML = dates.map(item => {
    const hasLoaded = state.availability.has(item.iso);
    const hasSlots = (state.availability.get(item.iso) || []).length > 0;
    const disabled = !state.loadingAvailability && hasLoaded && !hasSlots;
    return `<button class="date ${item.iso === state.date ? 'selected' : ''} ${disabled ? 'unavailable' : ''}" type="button" data-date="${item.iso}" aria-label="${item.label}" aria-pressed="${item.iso === state.date}" ${disabled ? 'disabled' : ''}><small>${item.weekday}</small><strong>${item.day}</strong>${disabled ? '<i>нет мест</i>' : ''}</button>`;
  }).join('');
}

function renderTimes() {
  const times = state.availability.get(state.date) || [];
  if (state.loadingAvailability) {
    $('#timePeriods').innerHTML = '';
    $('#timeHours').innerHTML = '<div class="loading-state compact"><i></i><span>Ищем свободное время…</span></div>';
    $('#minutePicker').hidden = true;
  } else {
    const periods = [
      { id:'all', label:'Все', match:() => true },
      { id:'morning', label:'Утро', match:hour => hour < 12 },
      { id:'day', label:'День', match:hour => hour >= 12 && hour < 17 },
      { id:'evening', label:'Вечер', match:hour => hour >= 17 }
    ];
    const currentPeriod = periods.find(item => item.id === state.period) || periods[0];
    let filtered = times.filter(time => currentPeriod.match(Number(time.slice(0,2))));
    if (!filtered.length && times.length) { state.period = 'all'; filtered = times; }
    $('#timePeriods').innerHTML = periods.map(period => {
      const count = times.filter(time => period.match(Number(time.slice(0,2)))).length;
      return `<button class="${period.id === state.period ? 'active' : ''}" type="button" data-time-period="${period.id}" ${count ? '' : 'disabled'}>${period.label}<small>${count}</small></button>`;
    }).join('');
    const hours = [...new Set(filtered.map(time => time.slice(0,2)))];
    if (!hours.includes(state.hour)) state.hour = hours[0] || '';
    if (!filtered.includes(state.time)) state.time = '';
    $('#timeHours').innerHTML = hours.map(hour => {
      const count = filtered.filter(time => time.startsWith(`${hour}:`)).length;
      return `<button class="time-hour ${hour === state.hour ? 'selected' : ''}" type="button" data-time-hour="${hour}" aria-pressed="${hour === state.hour}"><strong>${hour}:00</strong><small>${count} ${count === 1 ? 'вариант' : count < 5 ? 'варианта' : 'вариантов'}</small></button>`;
    }).join('');
    const minutes = filtered.filter(time => time.startsWith(`${state.hour}:`));
    $('#minutePicker').hidden = !minutes.length;
    $('#selectedHourLabel').textContent = state.hour ? `${state.hour}:00–${state.hour}:59` : '—';
    $('#times').innerHTML = minutes.map(item => `<button class="time ${item === state.time ? 'selected' : ''}" type="button" data-time="${item}" aria-pressed="${item === state.time}">${item}</button>`).join('');
  }
  $('#continueBooking').disabled = !state.time || state.loadingAvailability;
  $('#noTimes').hidden = state.loadingAvailability || Boolean(times.length);
}

async function loadAvailability() {
  const service = selectedService();
  state.availability = new Map();
  state.time = '';
  state.hour = '';
  state.period = 'all';
  state.loadingAvailability = true;
  renderDates();
  renderTimes();
  if (!service) { state.loadingAvailability = false; renderTimes(); return; }
  const { data, error } = await db.rpc('get_available_slots', { p_service: service.id, p_start: dates[0].iso, p_end: dates[dates.length - 1].iso });
  dates.forEach(item => state.availability.set(item.iso, []));
  if (!error) (data || []).forEach(item => {
    const date = item.booking_date;
    const time = String(item.booking_time).slice(0, 5);
    state.availability.set(date, [...(state.availability.get(date) || []), time]);
  });
  const firstAvailable = dates.find(item => (state.availability.get(item.iso) || []).length);
  if (!(state.availability.get(state.date) || []).length && firstAvailable) state.date = firstAvailable.iso;
  state.loadingAvailability = false;
  renderDates();
  renderTimes();
  if (error) {
    $('#noTimes').textContent = 'Не удалось загрузить расписание. Обновите страницу.';
    $('#noTimes').hidden = false;
  } else $('#noTimes').textContent = 'На эту дату свободного времени нет. Выберите другой день.';
}

async function showStep(step) {
  state.step = step;
  const titles = { 1: 'Выберите услугу', 2: 'Выберите дату и время', 3: 'Ваши контактные данные' };
  $$('.step').forEach(item => item.classList.toggle('active', Number(item.dataset.step) === step));
  $$('.progress i').forEach((item, index) => item.classList.toggle('active', index < step));
  $('#bookingTitle').textContent = titles[step];
  $('#stepLabel').textContent = `Шаг ${step} из 3`;
  if (step === 2) await loadAvailability();
  if (step === 3) renderSummary();
  $('.booking-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderSummary() {
  const service = selectedService();
  $('#summary').innerHTML = `<small>Ваша запись</small><strong>${escapeHtml(serviceName(service.name))} · ${money(service.price_rub)}</strong><span>${escapeHtml(service.performer_profiles?.display_name || 'Мастер')} · ${selectedDate().label} в ${state.time}</span>`;
}
function formatPhone(value) { let digits = value.replace(/\D/g, '').slice(0, 11); if (!digits) return ''; if (digits[0] === '8') digits = `7${digits.slice(1)}`; if (digits[0] !== '7') digits = `7${digits}`.slice(0, 11); const p = digits.slice(1); return `+7${p.length ? ` (${p.slice(0, 3)}` : ''}${p.length >= 3 ? ')' : ''}${p.length > 3 ? ` ${p.slice(3, 6)}` : ''}${p.length > 6 ? `-${p.slice(6, 8)}` : ''}${p.length > 8 ? `-${p.slice(8, 10)}` : ''}`; }
function showError(message) { $('#formError').textContent = message; $('#formError').hidden = false; }

async function submitBooking(event) {
  event.preventDefault();
  const name = $('#clientName').value.trim();
  const phone = $('#clientPhone').value;
  const service = selectedService();
  if (name.length < 2 || phone.replace(/\D/g, '').length !== 11) { showError('Укажите имя и полный номер телефона.'); return; }
  if (!service || !state.time) { showError('Выберите услугу и свободное время.'); return; }
  const submit = $('#submitBooking');
  submit.disabled = true;
  submit.textContent = 'Сохраняем…';
  $('#formError').hidden = true;
  const { data, error } = await db.rpc('book_appointment', { p_service: service.id, p_date: state.date, p_time: `${state.time}:00`, p_client_name: name, p_client_phone: phone });
  submit.disabled = false;
  submit.textContent = 'Подтвердить запись';
  if (error) {
    if (error.message?.includes('slot_unavailable') || error.code === '23P01' || error.code === '23505') {
      showError('Это время только что заняли. Выберите другое.');
      await showStep(2);
    } else showError('Не удалось сохранить запись. Попробуйте ещё раз.');
    return;
  }
  const code = data?.[0]?.booking_code || 'создан';
  const manageToken = data?.[0]?.manage_token;
  $('#bookingFlow').hidden = true;
  $('#success').hidden = false;
  $('#successTitle').textContent = `До встречи, ${name.split(/\s+/)[0]}!`;
  $('#successDetails').innerHTML = `${escapeHtml(serviceName(service.name))} · ${escapeHtml(service.performer_profiles?.display_name || 'Мастер')}<br>${selectedDate().label} в ${state.time}`;
  $('#successCode').innerHTML = `Номер записи: <strong>${escapeHtml(code)}</strong>`;
  if (manageToken) {
    const manageUrl = new URL('booking.html', location.href);
    manageUrl.searchParams.set('token', manageToken);
    $('#manageBooking').href = manageUrl.href;
    $('#manageBooking').hidden = false;
  }
  $('.booking-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resetFlow() { $('#success').hidden = true; $('#bookingFlow').hidden = false; $('#manageBooking').hidden = true; $('#bookingForm').reset(); $('#formError').hidden = true; state.time = ''; showStep(1); }
document.addEventListener('click', event => {
  const service = event.target.closest('[data-service]');
  const date = event.target.closest('[data-date]');
  const time = event.target.closest('[data-time]');
  const period = event.target.closest('[data-time-period]');
  const hour = event.target.closest('[data-time-hour]');
  const next = event.target.closest('[data-next]');
  const back = event.target.closest('[data-back]');
  if (service) { state.serviceId = service.dataset.service; state.availability = new Map(); renderServices(); }
  if (date && !date.disabled) { state.date = date.dataset.date; state.time = ''; state.hour = ''; state.period = 'all'; renderDates(); renderTimes(); }
  if (period && !period.disabled) { state.period = period.dataset.timePeriod; state.hour = ''; state.time = ''; renderTimes(); }
  if (hour) { state.hour = hour.dataset.timeHour; state.time = ''; renderTimes(); }
  if (time && !time.disabled) { state.time = time.dataset.time; renderTimes(); }
  if (next) showStep(Number(next.dataset.next));
  if (back) showStep(Number(back.dataset.back));
});
$('#clientPhone').addEventListener('input', event => { event.target.value = formatPhone(event.target.value); });
$('#bookingForm').addEventListener('submit', submitBooking);
$('#newBooking').addEventListener('click', resetFlow);
renderDates();
renderTimes();
loadServices();
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js?v=24'));
