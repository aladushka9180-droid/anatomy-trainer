const db = window.supabase.createClient(window.MINUTA_CONFIG.supabaseUrl, window.MINUTA_CONFIG.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
const telegramClientEndpoint = `${window.MINUTA_CONFIG.supabaseUrl}/functions/v1/telegram-client-notify`;
const state = { step: 1, services: [], serviceId: '', date: '', time: '', hour: '', period: 'all', moreDates: false, availability: new Map(), availabilityServiceId: '', loadingAvailability: false };
let servicesLoadRevision = 0;
let availabilityLoadRevision = 0;
let selectionValidationPending = false;
let selectionValidationBlocked = false;
let bookingResultUncertain = false;
const BOOKING_ATTEMPT_KEY = 'minuta-booking-attempt-v1';
let bookingAttempt = loadBookingAttempt();
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function createRequestId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function loadBookingAttempt() {
  try {
    const attempt = JSON.parse(sessionStorage.getItem(BOOKING_ATTEMPT_KEY) || 'null');
    if (/^[0-9a-f-]{36}$/i.test(attempt?.requestId) && /^[0-9a-f]{64}$/i.test(attempt?.fingerprint)) return attempt;
  } catch {}
  return null;
}

function saveBookingAttempt(attempt) {
  try { sessionStorage.setItem(BOOKING_ATTEMPT_KEY, JSON.stringify(attempt)); } catch {}
}

async function bookingFingerprint(service, name, phone) {
  const value = JSON.stringify([service.id, state.date, state.time, name.trim(), phone.replace(/\D/g, '')]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function currentBookingAttempt(service, name, phone) {
  const fingerprint = await bookingFingerprint(service, name, phone);
  if (!bookingAttempt || bookingAttempt.fingerprint !== fingerprint) {
    bookingAttempt = { requestId: createRequestId(), fingerprint };
    saveBookingAttempt(bookingAttempt);
    bookingResultUncertain = false;
  }
  return bookingAttempt;
}

function clearBookingAttempt() {
  bookingAttempt = null;
  bookingResultUncertain = false;
  try { sessionStorage.removeItem(BOOKING_ATTEMPT_KEY); } catch {}
}

function bookingInputChanged() {
  $('#formError').hidden = true;
  updateSubmitAvailability();
  if (!bookingResultUncertain) return;
  bookingResultUncertain = false;
  if (state.step === 3 && !selectionValidationBlocked) setSelectionValidationState('ready');
}

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
function timeRange(time, duration) {
  const [hours, minutes] = String(time).split(':').map(Number);
  const end = hours * 60 + minutes + Number(duration || 0);
  return `${time}–${String(Math.floor(end / 60) % 24).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
}
function durationLabel(duration) {
  const minutes = Number(duration || 0);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} мин`;
  const hourWord = hours === 1 ? 'час' : hours >= 2 && hours <= 4 ? 'часа' : 'часов';
  return rest ? `${hours} ч ${rest} мин` : `${hours} ${hourWord}`;
}
function setBookingStatus(kind, text) {
  const element = $('#bookingStatus');
  if (!element) return;
  element.className = `status status-${kind}`;
  element.querySelector('span').textContent = text;
}
function setSelectionValidationState(kind) {
  selectionValidationPending = kind === 'checking';
  selectionValidationBlocked = kind !== 'ready';
  const submit = $('#submitBooking');
  if (!submit) return;
  if (kind === 'ready') {
    setSubmitLabel(bookingResultUncertain ? 'Проверить результат' : 'Подтвердить запись');
  } else {
    setSubmitLabel(kind === 'checking' ? 'Проверяем выбранное время…' : 'Сначала обновите расписание');
  }
  updateSubmitAvailability();
}

function setSubmitLabel(text) {
  const submit = $('#submitBooking');
  if (!submit) return;
  const label = submit.querySelector('span');
  const icon = submit.querySelector('use');
  if (label) label.textContent = text;
  else submit.textContent = text;
  if (icon) icon.setAttribute('href', /провер|сохраня|обновите/i.test(text) ? 'ui-icons.svg#icon-clock' : 'ui-icons.svg#icon-check');
}

function contactFormIsComplete() {
  const name = $('#clientName')?.value.trim() || '';
  const phoneDigits = ($('#clientPhone')?.value || '').replace(/\D/g, '');
  return name.length >= 2 && phoneDigits.length === 11 && Boolean($('#dataConsent')?.checked);
}

function updateSubmitAvailability() {
  const submit = $('#submitBooking');
  if (!submit) return;
  submit.disabled = selectionValidationPending || selectionValidationBlocked || !contactFormIsComplete();
  const phone = $('#clientPhone');
  const hint = $('#phoneHint');
  if (!phone || !hint) return;
  const digits = phone.value.replace(/\D/g, '');
  const valid = digits.length === 11;
  phone.classList.toggle('input-valid', valid);
  phone.classList.toggle('input-incomplete', Boolean(digits.length) && !valid);
  hint.textContent = valid ? 'Номер заполнен' : 'Введите 10 цифр после +7';
  hint.classList.toggle('valid', valid);
}
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
  const revision = ++servicesLoadRevision;
  const previousServiceId = state.serviceId;
  if (state.step === 3) setSelectionValidationState('checking');
  setBookingStatus('checking', 'Проверяем расписание…');
  holder.innerHTML = '<div class="loading-state"><i></i><span>Загружаем услуги…</span></div>';
  const { data, error } = await db.from('services').select('id, performer_id, name, duration_minutes, price_rub, performer_profiles(display_name)').eq('active', true).order('created_at', { ascending: true });
  if (revision !== servicesLoadRevision) return;
  if (error) {
    if (state.step === 3) setSelectionValidationState('failed');
    setBookingStatus(navigator.onLine ? 'error' : 'offline', navigator.onLine ? 'Запись временно недоступна' : 'Нет соединения с интернетом');
    holder.innerHTML = '<div class="empty-service"><strong>Не удалось проверить расписание</strong><span>Запись не создана. Проверьте интернет и повторите попытку.</span><button class="service-details-button" type="button" id="retryServices">Повторить</button></div>';
    return;
  }
  state.services = data || [];
  const selectionWasRemoved = Boolean(previousServiceId) && !state.services.some(item => item.id === previousServiceId);
  if (!previousServiceId) state.serviceId = state.services[0]?.id || '';
  else if (selectionWasRemoved) state.serviceId = '';
  setBookingStatus(state.services.length ? 'open' : 'closed', state.services.length ? 'Запись открыта' : 'Запись пока закрыта');
  renderServices();
  if (selectionWasRemoved) {
    state.time = '';
    state.availability = new Map();
    setBookingStatus('error', 'Выбранная услуга больше недоступна');
    await showStep(1);
    return;
  }
  if (state.step === 2) await loadAvailability();
  if (state.step === 3 && selectedService()) await validateCurrentSelection();
}

function publicPortfolioAfterLabel(sessionCount) {
  const count = Number(sessionCount);
  if (!count) return 'После процедуры';
  const mod10 = count % 10;
  const mod100 = count % 100;
  const word = mod10 === 1 && mod100 !== 11 ? 'сеанса' : 'сеансов';
  return `После ${count} ${word}`;
}

function publicPortfolioPhoto(item, type) {
  return (item.portfolio_photos || []).find(photo => photo.photo_type === type);
}

function publicPortfolioPhotoMarkup(photo, label) {
  if (!photo?.signedUrl) return `<figure class="portfolio-photo portfolio-photo-empty"><span>${escapeHtml(label)}</span></figure>`;
  return `<figure class="portfolio-photo"><img src="${escapeHtml(photo.signedUrl)}" alt="${escapeHtml(photo.alt_text || label)}" loading="lazy" decoding="async"><span>${escapeHtml(label)}</span></figure>`;
}

async function loadPublicPortfolio() {
  const section = $('#portfolioSection');
  const holder = $('#publicPortfolioList');
  if (!section || !holder) return;
  const { data, error } = await db.from('portfolio_items')
    .select('id, procedure_name, body_area, session_count, description, sort_order, performer_profiles(display_name), portfolio_photos(id, photo_type, storage_path, alt_text)')
    .eq('published', true)
    .order('sort_order', { ascending: true })
    .limit(24);
  if (error || !data?.length) {
    section.hidden = true;
    holder.innerHTML = '';
    return;
  }
  const items = await Promise.all(data.map(async item => {
    const photos = await Promise.all((item.portfolio_photos || []).map(async photo => {
      const { data: signed } = await db.storage.from('portfolio-images').createSignedUrl(photo.storage_path, 3600);
      return { ...photo, signedUrl: signed?.signedUrl || '' };
    }));
    return { ...item, portfolio_photos: photos };
  }));
  holder.innerHTML = items.map(item => {
    const afterLabel = publicPortfolioAfterLabel(item.session_count);
    const area = item.body_area ? `<span>${escapeHtml(item.body_area)}</span>` : '';
    const performer = item.performer_profiles?.display_name ? `<span>Мастер: ${escapeHtml(item.performer_profiles.display_name)}</span>` : '';
    const description = item.description ? `<p>${escapeHtml(item.description)}</p>` : '';
    return `<article class="public-portfolio-card"><div class="public-portfolio-photos">${publicPortfolioPhotoMarkup(publicPortfolioPhoto(item, 'before'), 'До')}${publicPortfolioPhotoMarkup(publicPortfolioPhoto(item, 'after'), afterLabel)}</div><div class="public-portfolio-copy"><h3>${escapeHtml(item.procedure_name)}</h3>${area}${performer}${description}</div></article>`;
  }).join('');
  section.hidden = false;
}

function renderServices() {
  const holder = $('#services');
  if (!state.services.length) {
    holder.innerHTML = '<div class="empty-service"><span class="empty-service-mark"><svg class="ui-icon" aria-hidden="true"><use href="ui-icons.svg#icon-plus"></use></svg></span><strong>Услуги скоро появятся</strong><span>Исполнитель ещё не добавил услуги в свой кабинет.</span><a href="provider.html">Войти исполнителю</a></div>';
    $('#toDate').disabled = true;
    return;
  }
  $('#toDate').disabled = !selectedService();
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
  const service = selectedService();
  const duration = Number(service?.duration_minutes || 0);
  const durationNote = $('#durationNote');
  if (durationNote) {
    durationNote.innerHTML = state.time && duration
      ? `Выбрано: <strong>${escapeHtml(timeRange(state.time, duration))}</strong>`
      : duration ? `Сеанс длится <strong>${escapeHtml(durationLabel(duration))}</strong>. Выберите время начала — весь интервал должен быть свободен.` : '';
  }
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
      const range = timeRange(slot, duration);
      const endTime = range.split('–')[1];
      const caption = selected
        ? `до ${endTime} · выбрано`
        : available
          ? `до ${endTime}`
          : duration <= 60
            ? 'занято'
            : 'нет окна';
      const ariaLabel = available ? `${range}${selected ? ', выбрано' : ''}` : `${range}, недоступно для начала: весь интервал должен быть свободен`;
      return `<button class="time-hour ${selected ? 'selected' : ''} ${available ? '' : 'unavailable'}" type="button" ${available ? `data-time="${slot}"` : 'disabled'} aria-label="${ariaLabel}" aria-pressed="${selected}"><strong>${slot}</strong><small>${caption}</small></button>`;
    }).join('');
    const additionalTimes = filtered.filter(time => !time.endsWith(':00'));
    const additionalHours = [...new Set(additionalTimes.map(time => time.slice(0, 2)))];
    $('#minutePicker').hidden = !additionalTimes.length;
    $('#times').innerHTML = additionalHours.map(hour => {
      const hourTimes = additionalTimes.filter(time => time.startsWith(`${hour}:`));
      return `<section class="minute-hour-group"><strong>${hour}:00–${hour}:59</strong><div class="time-grid">${hourTimes.map(item => { const range = timeRange(item, duration); return `<button class="time ${item === state.time ? 'selected' : ''}" type="button" data-time="${item}" aria-label="${range}" aria-pressed="${item === state.time}"><strong>${item}</strong><small>до ${range.split('–')[1]}</small></button>`; }).join('')}</div></section>`;
    }).join('');
    if (state.time && !state.time.endsWith(':00')) $('#minutePicker').open = true;
  }
  $('#continueBooking').disabled = !state.time || state.loadingAvailability;
  const suggestionShown = renderAvailabilitySuggestion(times);
  $('#noTimes').hidden = state.loadingAvailability || Boolean(times.length) || suggestionShown;
}

function renderAvailabilitySuggestion(times) {
  const holder = $('#availabilityHint');
  if (!holder) return false;
  if (state.loadingAvailability || times.length) {
    holder.hidden = true;
    holder.innerHTML = '';
    return false;
  }
  const nearest = dates.find(item => item.iso !== state.date && (state.availability.get(item.iso) || []).length);
  if (!nearest) {
    holder.hidden = true;
    holder.innerHTML = '';
    return false;
  }
  const nearestTime = [...(state.availability.get(nearest.iso) || [])].sort()[0];
  const isToday = state.date === dates[0].iso;
  const isTomorrow = nearest.iso === dates[1]?.iso;
  const dateText = isTomorrow ? 'завтра' : `${nearest.weekday}, ${nearest.label}`;
  holder.innerHTML = `<div class="availability-suggestion-icon"><svg class="ui-icon" aria-hidden="true"><use href="ui-icons.svg#icon-spark"></use></svg></div><div><strong>${isToday ? 'Сегодня мест нет' : 'На выбранный день мест нет'}</strong><span>Ближайшее окно — ${escapeHtml(dateText)}, ${escapeHtml(nearestTime)}</span></div><button type="button" data-suggested-date="${nearest.iso}" data-suggested-time="${nearestTime}"><span>Показать это время</span><svg class="ui-icon" aria-hidden="true"><use href="ui-icons.svg#icon-arrow-right"></use></svg></button>`;
  holder.hidden = false;
  return true;
}

async function loadAvailability() {
  const service = selectedService();
  const revision = ++availabilityLoadRevision;
  state.availability = new Map();
  state.availabilityServiceId = '';
  state.time = '';
  state.hour = '';
  state.period = 'all';
  state.loadingAvailability = true;
  renderDates();
  renderTimes();
  if (!service) { state.loadingAvailability = false; renderTimes(); return; }
  const { data, error } = await db.rpc('get_available_slots', { p_service: service.id, p_start: dates[0].iso, p_end: dates[dates.length - 1].iso });
  if (revision !== availabilityLoadRevision || selectedService()?.id !== service.id) return;
  dates.forEach(item => state.availability.set(item.iso, []));
  if (!error) (data || []).forEach(item => {
    const date = item.booking_date;
    const time = String(item.booking_time).slice(0, 5);
    state.availability.set(date, [...(state.availability.get(date) || []), time]);
  });
  if (!error) state.availabilityServiceId = service.id;
  state.loadingAvailability = false;
  renderDates();
  renderTimes();
  if (error) {
    setBookingStatus(navigator.onLine ? 'error' : 'offline', navigator.onLine ? 'Расписание временно недоступно' : 'Нет соединения с интернетом');
    $('#noTimes').textContent = 'Не удалось загрузить расписание. Обновите страницу.';
    $('#noTimes').hidden = false;
  } else {
    setBookingStatus('open', 'Запись открыта');
    $('#noTimes').textContent = 'На эту дату свободного времени нет. Выберите другой день.';
  }
}

async function showStep(step) {
  state.step = step;
  const titles = { 1: 'Выберите услугу', 2: 'Выберите дату и время', 3: 'Ваши контактные данные' };
  const kickers = { 1: 'Услуга', 2: 'Время', 3: 'Контакты' };
  $$('.step').forEach(item => item.classList.toggle('active', Number(item.dataset.step) === step));
  $$('.progress i').forEach((item, index) => item.classList.toggle('active', index < step));
  $$('[data-progress-label]').forEach(item => item.classList.toggle('active', Number(item.dataset.progressLabel) <= step));
  $('#bookingTitle').textContent = titles[step];
  $('#stepKicker').textContent = kickers[step];
  $('#stepLabel').textContent = `${step} из 3`;
  const bookingCard = $('.booking-card');
  requestAnimationFrame(() => bookingCard?.scrollIntoView({
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    block: 'start'
  }));
  if (step === 2) {
    if (state.availabilityServiceId === state.serviceId && state.availability.size) {
      renderDates();
      renderTimes();
    } else await loadAvailability();
  }
  if (step === 3) {
    renderSummary();
    await validateCurrentSelection();
    updateSubmitAvailability();
  }
}

function renderSummary() {
  const service = selectedService();
  $('#summary').innerHTML = `<small>Ваша запись</small><strong>${escapeHtml(serviceName(service.name))} · ${money(service.price_rub)}</strong><span>${escapeHtml(service.performer_profiles?.display_name || 'Мастер')} · ${selectedDate().label}, ${timeRange(state.time, service.duration_minutes)}</span>`;
}
function renderSuccessPayment(item) {
  const holder = $('#successPayment');
  if (!holder) return;
  const pending = item?.payment_status === 'pending' && Number(item.deposit_amount_rub || 0) > 0 && /^https:\/\//i.test(item.payment_url || '');
  holder.hidden = !pending;
  if (!pending) return;
  $('#successDeposit').textContent = `Предоплата ${money(item.deposit_amount_rub)}`;
  $('#successPaymentLink').href = item.payment_url;
}
function successDetailsMarkup(service, performer, dateLabel, range) {
  return `<strong>${escapeHtml(service)}</strong><span>${escapeHtml(performer)}</span><b>${escapeHtml(dateLabel)} · ${escapeHtml(range)}</b>`;
}
async function validateCurrentSelection() {
  const service = selectedService();
  const selectedTime = state.time;
  const selectedBookingDate = state.date;
  if (!service || !selectedTime) { await showStep(2); return; }
  setSelectionValidationState('checking');
  const { data, error } = await db.rpc('get_available_slots', { p_service: service.id, p_start: selectedBookingDate, p_end: selectedBookingDate });
  if (selectedService()?.id !== service.id || state.date !== selectedBookingDate || state.time !== selectedTime) return;
  if (error) {
    setSelectionValidationState('failed');
    setBookingStatus(navigator.onLine ? 'error' : 'offline', navigator.onLine ? 'Не удалось перепроверить выбранное время' : 'Нет соединения с интернетом');
    return;
  }
  const available = (data || []).some(item => String(item.booking_time).slice(0, 5) === selectedTime);
  if (!available) {
    state.time = '';
    await showStep(2);
    setBookingStatus('error', 'Выбранное время стало недоступно — выберите другое');
    return;
  }
  setSelectionValidationState('ready');
  renderSummary();
}
function formatPhone(value) { let digits = value.replace(/\D/g, '').slice(0, 11); if (!digits) return ''; if (digits[0] === '8') digits = `7${digits.slice(1)}`; if (digits[0] !== '7') digits = `7${digits}`.slice(0, 11); const p = digits.slice(1); return `+7${p.length ? ` (${p.slice(0, 3)}` : ''}${p.length >= 3 ? ')' : ''}${p.length > 3 ? ` ${p.slice(3, 6)}` : ''}${p.length > 6 ? `-${p.slice(6, 8)}` : ''}${p.length > 8 ? `-${p.slice(8, 10)}` : ''}`; }
function showError(message) { $('#formError').textContent = message; $('#formError').hidden = false; }
function telegramConnectUrl(manageToken) { return `${telegramClientEndpoint}/connect?token=${encodeURIComponent(manageToken)}`; }
function notifyTelegramEvent(event, manageToken) {
  if (!manageToken) return;
  fetch(`${telegramClientEndpoint}/event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: window.MINUTA_CONFIG.supabaseKey },
    body: JSON.stringify({ event, manage_token: manageToken })
  }).catch(() => {});
}

async function submitBooking(event) {
  event.preventDefault();
  if (selectionValidationPending) { showError('Подождите, пока выбранное время будет перепроверено.'); return; }
  if (selectionValidationBlocked) { showError('Сначала обновите расписание и перепроверьте выбранное время.'); return; }
  const name = $('#clientName').value.trim();
  const phone = $('#clientPhone').value;
  const service = selectedService();
  if (name.length < 2 || phone.replace(/\D/g, '').length !== 11) { showError('Укажите имя и полный номер телефона.'); return; }
  if (!$('#dataConsent').checked) { showError('Подтвердите согласие на обработку данных.'); return; }
  if (!service || !state.time) { showError('Выберите услугу и свободное время.'); return; }
  if (!navigator.onLine) { showError('Нет соединения с интернетом. Запись не создана — подключитесь к сети и повторите попытку.'); return; }
  const attempt = await currentBookingAttempt(service, name, phone);
  const submit = $('#submitBooking');
  submit.disabled = true;
  setSubmitLabel(bookingResultUncertain ? 'Проверяем…' : 'Сохраняем…');
  $('#formError').hidden = true;
  const { data, error } = await db.rpc('book_appointment', { p_request_id: attempt.requestId, p_service: service.id, p_date: state.date, p_time: `${state.time}:00`, p_client_name: name, p_client_phone: phone });
  setSubmitLabel(bookingResultUncertain ? 'Проверить результат' : 'Подтвердить запись');
  updateSubmitAvailability();
  if (error) {
    if (error.message?.includes('slot_unavailable') || error.code === '23P01' || error.code === '23505') {
      clearBookingAttempt();
      showError('Это время только что заняли. Выберите другое.');
      await showStep(2);
    } else if (error.message?.includes('request_conflict')) {
      clearBookingAttempt();
      showError('Параметры записи изменились. Проверьте услугу, дату и время, затем повторите отправку.');
    } else {
      bookingResultUncertain = true;
      setSubmitLabel('Проверить результат');
      updateSubmitAvailability();
      showError('Сервер не подтвердил результат. Нажмите «Проверить результат»: повторный запрос безопасно вернёт уже созданную запись и не создаст дубль.');
    }
    return;
  }
  const manageToken = data?.[0]?.manage_token;
  clearBookingAttempt();
  $('#bookingFlow').hidden = true;
  $('#success').hidden = false;
  $('#successTitle').textContent = `До встречи, ${name.split(/\s+/)[0]}!`;
  $('#successDetails').innerHTML = successDetailsMarkup(serviceName(service.name), service.performer_profiles?.display_name || 'Мастер', selectedDate().label, timeRange(state.time, service.duration_minutes));
  if (manageToken) {
    const manageUrl = new URL('booking.html', location.href);
    manageUrl.hash = `token=${encodeURIComponent(manageToken)}`;
    $('#manageBooking').href = manageUrl.href;
    $('#manageBooking').hidden = false;
    $('#copyManageBooking').hidden = false;
    $('#telegramConnect').href = telegramConnectUrl(manageToken);
    $('#telegramConnect').hidden = false;
    const { data: management } = await db.rpc('get_booking_management', { p_token: manageToken });
    const current = management?.[0];
    renderSuccessPayment(current);
    if (current) {
      const currentDate = new Date(`${current.booking_date}T00:00:00`);
      const currentDateLabel = currentDate.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' });
      $('#successDetails').innerHTML = successDetailsMarkup(current.service_name, current.performer_name || 'Мастер', currentDateLabel, timeRange(current.booking_time.slice(0, 5), current.duration_minutes));
      if (current.status === 'cancelled') {
        $('#successTitle').textContent = 'Эта запись уже отменена';
      }
    }
    if (!current || current.status !== 'cancelled') notifyTelegramEvent('confirmation', manageToken);
  }
  $('.booking-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resetFlow() { $('#success').hidden = true; $('#successPayment').hidden = true; $('#bookingFlow').hidden = false; $('#manageBooking').hidden = true; $('#copyManageBooking').hidden = true; $('#telegramConnect').hidden = true; $('#bookingForm').reset(); $('#formError').hidden = true; clearBookingAttempt(); state.time = ''; state.moreDates = false; setSelectionValidationState('ready'); updateSubmitAvailability(); showStep(1); }
document.addEventListener('click', event => {
  const service = event.target.closest('[data-service]');
  const date = event.target.closest('[data-date]');
  const time = event.target.closest('[data-time]');
  const period = event.target.closest('[data-time-period]');
  const moreDates = event.target.closest('#moreDates');
  const serviceDetails = event.target.closest('#serviceDetailsButton');
  const closeServiceDetails = event.target.closest('[data-close-service-details]');
  const chooseServiceDetails = event.target.closest('[data-choose-service-details]');
  const suggestedDate = event.target.closest('[data-suggested-date]');
  const next = event.target.closest('[data-next]');
  const back = event.target.closest('[data-back]');
  const retryServices = event.target.closest('#retryServices');
  if (service) {
    bookingInputChanged();
    if (state.serviceId !== service.dataset.service) {
      state.serviceId = service.dataset.service;
      state.availability = new Map();
      state.availabilityServiceId = '';
      state.time = '';
    }
    renderServices();
  }
  if (date && !date.disabled) { bookingInputChanged(); state.date = date.dataset.date; state.time = ''; state.hour = ''; state.period = 'all'; renderDates(); renderTimes(); }
  if (suggestedDate) {
    bookingInputChanged();
    state.date = suggestedDate.dataset.suggestedDate;
    state.time = suggestedDate.dataset.suggestedTime;
    state.hour = state.time.slice(0, 2);
    state.period = 'all';
    renderDates();
    renderTimes();
  }
  if (period && !period.disabled) { state.period = period.dataset.timePeriod; state.hour = ''; state.time = ''; renderTimes(); }
  if (moreDates) { state.moreDates = true; renderDates(); }
  if (serviceDetails) openServiceDetails();
  if (closeServiceDetails || chooseServiceDetails) $('#serviceDetailsDialog').close();
  if (time && !time.disabled) { bookingInputChanged(); state.time = time.dataset.time; renderTimes(); }
  if (next) showStep(Number(next.dataset.next));
  if (back) showStep(Number(back.dataset.back));
  if (retryServices) loadServices();
});
$('#clientName').addEventListener('input', bookingInputChanged);
$('#clientPhone').addEventListener('input', event => { event.target.value = formatPhone(event.target.value); bookingInputChanged(); });
$('#dataConsent').addEventListener('change', bookingInputChanged);
$('#bookingForm').addEventListener('submit', submitBooking);
$('#newBooking').addEventListener('click', resetFlow);
$('#copyManageBooking').addEventListener('click', async () => {
  const url = $('#manageBooking').href;
  try {
    await navigator.clipboard.writeText(url);
    $('#copyManageBooking').textContent = 'Ссылка скопирована';
    setTimeout(() => { $('#copyManageBooking').textContent = 'Скопировать ссылку на запись'; }, 2200);
  } catch { showError('Не удалось скопировать ссылку. Откройте страницу управления и сохраните её в закладках.'); }
});
window.addEventListener('offline', () => setBookingStatus('offline', 'Нет соединения с интернетом'));
window.addEventListener('online', loadServices);
renderDates();
renderTimes();
loadServices();
updateSubmitAvailability();
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js?v=70'));
