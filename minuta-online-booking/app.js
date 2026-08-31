const db = window.supabase.createClient(window.MINUTA_CONFIG.supabaseUrl, window.MINUTA_CONFIG.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
const state = { step: 1, services: [], serviceId: '', date: '', time: '', hour: '', period: 'all', moreDates: false, availability: new Map(), loadingAvailability: false };
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
function serviceDescription(value) {
  const name = serviceName(value).toLowerCase();
  if (name.includes('спортив')) return 'Интенсивная работа с мышцами для людей с регулярной физической нагрузкой. Темп и сила воздействия подбираются индивидуально.';
  if (name.includes('комплекс')) return 'Продолжительный сеанс с последовательной проработкой основных зон тела. Подходит, когда хочется уделить внимание всему телу за один визит.';
  if (name.includes('обеих сторон')) return 'Работа с передней и задней поверхностями тела в рамках одного сеанса. Интенсивность согласуется перед началом.';
  if (name.includes('задней поверхности')) return 'Последовательная работа со спиной, поясницей и задней поверхностью ног с учётом ваших пожеланий.';
  if (name.includes('голов')) return 'Сеанс с акцентом на спину, руки и область головы. Сила воздействия подбирается по вашим ощущениям.';
  if (name.includes('ног') || name.includes('рук')) return 'Локальный массаж выбранной зоны. Перед началом можно уточнить, чему уделить больше внимания — ногам или рукам.';
  if (name.includes('углуб')) return 'Более продолжительная и детальная работа со спиной и шейно-воротниковой зоной.';
  if (name.includes('швз') || name.includes('спин')) return 'Базовый сеанс для спины и шейно-воротниковой зоны. Подходит для первого знакомства и регулярного ухода.';
  return 'Индивидуальный сеанс массажа. Зоны и интенсивность работы согласуются с исполнителем перед началом.';
}

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
  holder.innerHTML = state.services.map(item => `<button class="option ${item.id === state.serviceId ? 'selected' : ''}" type="button" data-service="${item.id}" aria-pressed="${item.id === state.serviceId}"><span class="option-main"><strong>${escapeHtml(serviceName(item.name))}</strong><small>${item.duration_minutes} мин · ${escapeHtml(item.performer_profiles?.display_name || 'Мастер')}</small></span><span class="option-price">${money(item.price_rub)}</span></button>`).join('');
  $('#serviceDetailsButton').hidden = !selectedService();
}

function openServiceDetails() {
  const service = selectedService();
  if (!service) return;
  $('#serviceDetailsTitle').textContent = serviceName(service.name);
  $('#serviceDetailsText').textContent = serviceDescription(service.name);
  $('#serviceDetailsDuration').textContent = `${service.duration_minutes} мин · ${service.performer_profiles?.display_name || 'Мастер'}`;
  $('#serviceDetailsPrice').textContent = money(service.price_rub);
  $('#serviceDetailsDialog').showModal();
}

function renderDates() {
  if (dates.findIndex(item => item.iso === state.date) > 6) state.moreDates = true;
  const visibleDates = state.moreDates ? dates : dates.slice(0, 7);
  $('#dates').innerHTML = visibleDates.map(item => {
    const hasLoaded = state.availability.has(item.iso);
    const hasSlots = (state.availability.get(item.iso) || []).length > 0;
    const disabled = !state.loadingAvailability && hasLoaded && !hasSlots;
    return `<button class="date ${item.iso === state.date ? 'selected' : ''} ${disabled ? 'unavailable' : ''}" type="button" data-date="${item.iso}" aria-label="${item.label}" aria-pressed="${item.iso === state.date}" ${disabled ? 'disabled' : ''}><small>${item.weekday}</small><strong>${item.day}</strong>${disabled ? '<i>нет мест</i>' : ''}</button>`;
  }).join('');
  $('#moreDates').hidden = state.moreDates;
}

function renderTimes() {
  const times = state.availability.get(state.date) || [];
  if (state.loadingAvailability) {
    $('#timePeriods').innerHTML = '';
    $('#timeHours').innerHTML = '<div class="loading-state compact"><i></i><span>Ищем свободное время…</span></div>';
    $('#minutePicker').hidden = true;
  } else {
    const filtered = times;
    $('#timePeriods').innerHTML = '';
    if (!filtered.includes(state.time)) state.time = '';
    const roundHours = Array.from({ length: 10 }, (_, index) => `${String(index + 10).padStart(2, '0')}:00`);
    $('#timeHours').innerHTML = roundHours.map(slot => {
      const available = filtered.includes(slot);
      const selected = slot === state.time;
      return `<button class="time-hour ${selected ? 'selected' : ''} ${available ? '' : 'unavailable'}" type="button" ${available ? `data-time="${slot}"` : 'disabled'} aria-pressed="${selected}"><strong>${slot}</strong>${available ? '' : '<small>занято</small>'}</button>`;
    }).join('');
    const additionalTimes = filtered.filter(time => !time.endsWith(':00'));
    const additionalHours = [...new Set(additionalTimes.map(time => time.slice(0, 2)))];
    $('#minutePicker').hidden = !additionalTimes.length;
    $('#times').innerHTML = additionalHours.map(hour => {
      const hourTimes = additionalTimes.filter(time => time.startsWith(`${hour}:`));
      return `<section class="minute-hour-group"><strong>${hour}:00–${hour}:59</strong><div class="time-grid">${hourTimes.map(item => `<button class="time ${item === state.time ? 'selected' : ''}" type="button" data-time="${item}" aria-pressed="${item === state.time}">${item}</button>`).join('')}</div></section>`;
    }).join('');
    if (state.time && !state.time.endsWith(':00')) $('#minutePicker').open = true;
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
  if (!$('#dataConsent').checked) { showError('Подтвердите согласие на обработку данных.'); return; }
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

function resetFlow() { $('#success').hidden = true; $('#bookingFlow').hidden = false; $('#manageBooking').hidden = true; $('#bookingForm').reset(); $('#formError').hidden = true; state.time = ''; state.moreDates = false; showStep(1); }
document.addEventListener('click', event => {
  const service = event.target.closest('[data-service]');
  const date = event.target.closest('[data-date]');
  const time = event.target.closest('[data-time]');
  const period = event.target.closest('[data-time-period]');
  const moreDates = event.target.closest('#moreDates');
  const serviceDetails = event.target.closest('#serviceDetailsButton');
  const closeServiceDetails = event.target.closest('[data-close-service-details]');
  const chooseServiceDetails = event.target.closest('[data-choose-service-details]');
  const next = event.target.closest('[data-next]');
  const back = event.target.closest('[data-back]');
  if (service) { state.serviceId = service.dataset.service; state.availability = new Map(); renderServices(); }
  if (date && !date.disabled) { state.date = date.dataset.date; state.time = ''; state.hour = ''; state.period = 'all'; renderDates(); renderTimes(); }
  if (period && !period.disabled) { state.period = period.dataset.timePeriod; state.hour = ''; state.time = ''; renderTimes(); }
  if (moreDates) { state.moreDates = true; renderDates(); }
  if (serviceDetails) openServiceDetails();
  if (closeServiceDetails || chooseServiceDetails) $('#serviceDetailsDialog').close();
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
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js?v=37'));
