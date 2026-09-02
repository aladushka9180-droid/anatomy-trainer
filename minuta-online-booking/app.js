const db = window.supabase.createClient(window.MINUTA_CONFIG.supabaseUrl, window.MINUTA_CONFIG.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
const telegramClientEndpoint = `${window.MINUTA_CONFIG.supabaseUrl}/functions/v1/telegram-client-notify`;
const state = { step: 1, services: [], serviceId: '', performerId: '', locationId: '', locations: [], teamMode: false, resourceScheduling: false, organization: null, date: '', time: '', hour: '', period: 'all', moreDates: false, availability: new Map(), availabilityServiceId: '', availabilityLocationId: '', loadingAvailability: false, availabilityError: false };
let servicesLoadRevision = 0;
let availabilityLoadRevision = 0;
let selectionValidationPending = false;
let selectionValidationBlocked = false;
let bookingResultUncertain = false;
const BOOKING_ATTEMPT_KEY = 'minuta-booking-attempt-v1';
const CLIENT_SESSION_KEY = 'minuta-client-session-v1';
const CLIENT_CONTACT_KEY = 'minuta-client-contact-v1';
const CLIENT_CONTACT_TTL = 90 * 24 * 60 * 60 * 1000;
const bookingQuery = new URLSearchParams(location.search);
const requestedServiceId = /^[0-9a-f-]{36}$/i.test(bookingQuery.get('service') || '') ? bookingQuery.get('service') : '';
const organizationSlugFromQuery = bookingQuery.get('org') || '';
const organizationSlugFromConfig = window.MINUTA_CONFIG.defaultOrganizationSlug || '';
const requestedOrganizationSlug = /^[a-z0-9][a-z0-9-]{2,62}$/.test(organizationSlugFromQuery)
  ? organizationSlugFromQuery
  : (/^[a-z0-9][a-z0-9-]{2,62}$/.test(organizationSlugFromConfig) ? organizationSlugFromConfig : '');
const isRepeatBooking = bookingQuery.get('repeat') === '1' && Boolean(requestedServiceId);
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
  const value = JSON.stringify([service.id, state.teamMode ? state.locationId : '', state.date, state.time, name.trim(), phone.replace(/\D/g, '')]);
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

function saveClientContact(name, phone) {
  const contact = { name: name.trim().slice(0, 80), phone: formatPhone(phone), savedAt: Date.now() };
  if (contact.name.length < 2 || contact.phone.replace(/\D/g, '').length !== 11) return;
  try { localStorage.setItem(CLIENT_CONTACT_KEY, JSON.stringify(contact)); } catch {}
}

function loadClientContact() {
  try {
    const contact = JSON.parse(localStorage.getItem(CLIENT_CONTACT_KEY) || 'null');
    if (!contact || Date.now() - Number(contact.savedAt || 0) > CLIENT_CONTACT_TTL || String(contact.name || '').trim().length < 2 || String(contact.phone || '').replace(/\D/g, '').length !== 11) {
      localStorage.removeItem(CLIENT_CONTACT_KEY);
      return null;
    }
    return { name: String(contact.name).trim().slice(0, 80), phone: formatPhone(String(contact.phone)) };
  } catch { return null; }
}

function restoreClientContact() {
  const contact = loadClientContact();
  if (!contact) return;
  $('#clientName').value = contact.name;
  $('#clientPhone').value = contact.phone;
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
function locationEligibleServices() {
  if (!state.resourceScheduling || !state.teamMode) return state.services;
  return state.services.filter(item => Array.isArray(item.location_ids) && item.location_ids.includes(state.locationId));
}
function performerOptions() {
  const unique = new Map();
  locationEligibleServices().forEach(service => {
    if (!service.performer_id || unique.has(service.performer_id)) return;
    unique.set(service.performer_id, { id: service.performer_id, name: service.performer_profiles?.display_name || 'Специалист' });
  });
  return [...unique.values()];
}
function visibleServices() {
  return locationEligibleServices().filter(item => {
    if (state.performerId && item.performer_id !== state.performerId) return false;
    return true;
  });
}

function loadPublicSlots(service, start, end, locationId = state.locationId) {
  if (state.resourceScheduling) {
    return db.rpc('get_public_minuta_available_slots_v3', {
      p_slug: requestedOrganizationSlug,
      p_location: locationId,
      p_service: service.id,
      p_start: start,
      p_end: end
    });
  }
  return db.rpc('get_available_slots', { p_service: service.id, p_start: start, p_end: end });
}

function renderLocations() {
  const field = $('#locationFilter');
  const select = $('#locationSelect');
  if (!field || !select) return;
  if (!state.teamMode || !state.locations.length) {
    field.hidden = true;
    select.innerHTML = '';
    return;
  }
  if (!state.locations.some(item => item.id === state.locationId)) {
    state.locationId = state.locations.find(item => item.is_primary)?.id || state.locations[0]?.id || '';
  }
  select.innerHTML = state.locations.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === state.locationId ? 'selected' : ''}>${escapeHtml(item.name || 'Филиал')}${item.address ? ` · ${escapeHtml(item.address)}` : ''}</option>`).join('');
  field.hidden = false;
}
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
function isMissingRpc(error, name) {
  const text = `${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`;
  return /(?:PGRST202|42883)/i.test(text) || new RegExp(`function\\s+[^\\n]*${name}[^\\n]*does not exist`, 'i').test(text);
}
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
  const previousLocationId = state.locationId;
  if (state.step === 3) setSelectionValidationState('checking');
  setBookingStatus('checking', 'Проверяем расписание…');
  holder.innerHTML = '<div class="loading-state"><i></i><span>Загружаем услуги…</span></div>';
  let data;
  let error;
  state.teamMode = false;
  state.resourceScheduling = false;
  state.organization = null;
  state.locations = [];
  state.locationId = '';
  if (requestedOrganizationSlug) {
    let catalogResult = await db.rpc('get_public_minuta_catalog_v3', { p_slug: requestedOrganizationSlug });
    let branchAwareCatalog = !catalogResult.error;
    let resourceAwareCatalog = !catalogResult.error && catalogResult.data?.resource_scheduling === true;
    if (isMissingRpc(catalogResult.error, 'get_public_minuta_catalog_v3')) {
      catalogResult = await db.rpc('get_public_minuta_catalog_v2', { p_slug: requestedOrganizationSlug });
      branchAwareCatalog = !catalogResult.error;
      resourceAwareCatalog = false;
    }
    if (isMissingRpc(catalogResult.error, 'get_public_minuta_catalog_v2')) {
      catalogResult = await db.rpc('get_public_minuta_catalog', { p_slug: requestedOrganizationSlug });
      branchAwareCatalog = false;
      resourceAwareCatalog = false;
    }
    if (!catalogResult.error) {
      state.organization = catalogResult.data?.organization || null;
      state.locations = branchAwareCatalog && Array.isArray(catalogResult.data?.locations) ? catalogResult.data.locations.filter(item => item?.id) : [];
      // Once the branch-aware catalog answers for an organization, fail closed:
      // an empty location list means booking is unavailable, never legacy fallback.
      state.teamMode = Boolean(state.organization && branchAwareCatalog);
      state.resourceScheduling = Boolean(state.teamMode && resourceAwareCatalog);
      if (state.locations.some(item => item.id === previousLocationId)) state.locationId = previousLocationId;
      data = state.organization && Array.isArray(catalogResult.data?.services) ? catalogResult.data.services : [];
      error = null;
    } else if (/PGRST202|42883|get_public_minuta_catalog|function .* does not exist/i.test(`${catalogResult.error.code || ''} ${catalogResult.error.message || ''} ${catalogResult.error.details || ''}`)) {
      ({ data, error } = await db.from('services').select('id, performer_id, name, duration_minutes, price_rub, performer_profiles(display_name)').eq('active', true).order('created_at', { ascending: true }));
    } else {
      ({ data, error } = catalogResult);
    }
  } else {
    ({ data, error } = await db.from('services').select('id, performer_id, name, duration_minutes, price_rub, performer_profiles(display_name)').eq('active', true).order('created_at', { ascending: true }));
  }
  if (revision !== servicesLoadRevision) return;
  if (error) {
    if (state.step === 3) setSelectionValidationState('failed');
    setBookingStatus(navigator.onLine ? 'error' : 'offline', navigator.onLine ? 'Запись временно недоступна' : 'Нет соединения с интернетом');
    holder.innerHTML = '<div class="empty-service"><strong>Не удалось проверить расписание</strong><span>Запись не создана. Проверьте интернет и повторите попытку.</span><button class="service-details-button" type="button" id="retryServices">Повторить</button></div>';
    return;
  }
  state.services = data || [];
  renderLocations();
  const requestedService = state.services.find(item => item.id === requestedServiceId);
  const performers = performerOptions();
  if (isRepeatBooking && requestedService) state.performerId = requestedService.performer_id || '';
  if (state.performerId && !performers.some(item => item.id === state.performerId)) state.performerId = '';
  const selectionWasRemoved = Boolean(previousServiceId) && !state.services.some(item => item.id === previousServiceId);
  const locationServices = visibleServices();
  if (!previousServiceId) {
    state.serviceId = isRepeatBooking && requestedServiceId
      ? (locationServices.some(item => item.id === requestedServiceId) ? requestedServiceId : '')
      : locationServices[0]?.id || '';
  }
  else if (selectionWasRemoved) state.serviceId = '';
  else if (!locationServices.some(item => item.id === previousServiceId)) state.serviceId = locationServices[0]?.id || '';
  setBookingStatus(locationServices.length ? 'open' : 'closed', locationServices.length ? 'Запись открыта' : 'В этом филиале пока нет доступных услуг');
  renderSpecialists();
  renderServices();
  if (state.teamMode && !state.locations.length) {
    setBookingStatus('error', 'Запись команды пока не активирована');
    $('#toDate').disabled = true;
  }
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

function reviewStars(rating) {
  const value = Math.max(0, Math.min(5, Number(rating) || 0));
  return `<span class="review-stars" aria-label="Оценка ${value} из 5">${'★'.repeat(value)}${'☆'.repeat(5 - value)}</span>`;
}

async function loadPublicReviews() {
  const section = $('#reviewsSection');
  const holder = $('#publicReviewsList');
  if (!section || !holder) return;
  const { data, error } = await db.rpc('get_public_booking_reviews');
  if (error || !data?.length) {
    section.hidden = true;
    holder.innerHTML = '';
    return;
  }
  const summary = data[0];
  $('#reviewsAverage').textContent = Number(summary.average_rating || 0).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  $('#reviewsCount').textContent = `${summary.total_reviews} ${Number(summary.total_reviews) === 1 ? 'отзыв' : 'отзывов'} после реальных визитов`;
  holder.innerHTML = data.map(item => `<article class="public-review-card"><div class="public-review-head"><div>${reviewStars(item.rating)}<strong>${escapeHtml(item.reviewer_name || 'Клиент')}</strong></div><time datetime="${escapeHtml(item.created_at)}">${new Date(item.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</time></div>${item.review_text ? `<p>${escapeHtml(item.review_text)}</p>` : '<p class="review-without-text">Оценка без текста</p>'}<small>${escapeHtml(serviceName(item.service_name))} · ${escapeHtml(item.performer_name)}</small></article>`).join('');
  section.hidden = false;
}

function renderServices() {
  const holder = $('#services');
  const services = visibleServices();
  if (!services.length) {
    holder.innerHTML = state.services.length
      ? state.resourceScheduling && !locationEligibleServices().length
        ? '<div class="empty-service"><strong>В этом филиале пока нет доступных услуг</strong><span>Для услуг ещё не настроен активный кабинет или необходимое оборудование.</span></div>'
        : '<div class="empty-service"><strong>У специалиста пока нет активных услуг</strong><span>Выберите другого специалиста или покажите всю команду.</span></div>'
      : '<div class="empty-service"><span class="empty-service-mark"><svg class="ui-icon" aria-hidden="true"><use href="ui-icons.svg#icon-plus"></use></svg></span><strong>Услуги скоро появятся</strong><span>Исполнитель ещё не добавил услуги в свой кабинет.</span><a href="provider.html">Войти исполнителю</a></div>';
    $('#toDate').disabled = true;
    $('#serviceDetailsButton').hidden = true;
    renderRepeatBookingNotice();
    return;
  }
  $('#toDate').disabled = !selectedService();
  holder.innerHTML = services.map(item => `<button class="option ${item.id === state.serviceId ? 'selected' : ''}" type="button" data-service="${item.id}" aria-pressed="${item.id === state.serviceId}"><span class="option-main"><strong>${escapeHtml(serviceName(item.name))}</strong><small>${Number(item.duration_minutes) === 1 ? 'Поминутная оплата' : `${item.duration_minutes} мин`} · ${escapeHtml(item.performer_profiles?.display_name || 'Мастер')}</small></span><span class="option-price">${money(item.price_rub)}${Number(item.duration_minutes) === 1 ? '/мин' : ''}</span></button>`).join('');
  $('#serviceDetailsButton').hidden = !selectedService();
  renderRepeatBookingNotice();
}

function renderRepeatBookingNotice() {
  const notice = $('#repeatBookingNotice');
  if (!notice || !isRepeatBooking) return;
  const service = selectedService();
  notice.hidden = false;
  notice.innerHTML = service
    ? `<strong>Услуга выбрана</strong><span>${escapeHtml(serviceName(service.name))} · теперь выберите удобное время.</span>`
    : '<strong>Услуга больше недоступна</strong><span>Выберите другую услугу.</span>';
}

function renderSpecialists() {
  const section = $('#specialistFilter');
  const holder = $('#specialists');
  if (!section || !holder) return;
  const performers = performerOptions();
  if (!state.teamMode) state.performerId = '';
  section.hidden = !state.teamMode || performers.length < 2;
  if (section.hidden) {
    holder.innerHTML = '';
    return;
  }
  holder.innerHTML = [
    `<button type="button" data-performer="" aria-pressed="${!state.performerId}" class="${!state.performerId ? 'selected' : ''}"><span>Все</span><small>${performers.length} специалиста</small></button>`,
    ...performers.map(item => `<button type="button" data-performer="${escapeHtml(item.id)}" aria-pressed="${item.id === state.performerId}" class="${item.id === state.performerId ? 'selected' : ''}"><span>${escapeHtml(item.name)}</span><small>${state.services.filter(service => service.performer_id === item.id).length} услуг</small></button>`)
  ].join('');
}

function openServiceDetails() {
  const service = selectedService();
  if (!service) return;
  $('#serviceDetailsTitle').textContent = serviceName(service.name);
  $('#serviceDetailsText').textContent = serviceDescription(service.name);
  $('#serviceDetailsDuration').textContent = `${Number(service.duration_minutes) === 1 ? 'Поминутная оплата' : `${service.duration_minutes} мин`} · ${service.performer_profiles?.display_name || 'Мастер'}`;
  $('#serviceDetailsPrice').textContent = `${money(service.price_rub)}${Number(service.duration_minutes) === 1 ? '/мин' : ''}`;
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
  const waitlistCta = $('#waitlistCta');
  if (waitlistCta) waitlistCta.hidden = state.teamMode || state.loadingAvailability || state.availabilityError || !state.date || Boolean(times.length);
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
  const requestedLocationId = state.locationId;
  const revision = ++availabilityLoadRevision;
  state.availability = new Map();
  state.availabilityServiceId = '';
  state.availabilityLocationId = '';
  state.time = '';
  state.hour = '';
  state.period = 'all';
  state.availabilityError = false;
  state.loadingAvailability = true;
  renderDates();
  renderTimes();
  if (!service) { state.loadingAvailability = false; renderTimes(); return; }
  const { data, error } = await loadPublicSlots(service, dates[0].iso, dates[dates.length - 1].iso, requestedLocationId);
  if (revision !== availabilityLoadRevision || selectedService()?.id !== service.id || state.locationId !== requestedLocationId) return;
  dates.forEach(item => state.availability.set(item.iso, []));
  if (!error) (data || []).forEach(item => {
    const date = item.booking_date;
    const time = String(item.booking_time).slice(0, 5);
    state.availability.set(date, [...(state.availability.get(date) || []), time]);
  });
  state.availabilityError = Boolean(error);
  if (!error) {
    state.availabilityServiceId = service.id;
    state.availabilityLocationId = requestedLocationId;
  }
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

function openWaitlistDialog() {
  const service = selectedService();
  const date = selectedDate();
  if (!service || !date) return;
  $('#waitlistForm').hidden = false;
  $('#waitlistSuccess').hidden = true;
  $('#waitlistError').hidden = true;
  $('#waitlistService').textContent = serviceName(service.name);
  $('#waitlistDate').textContent = date.label;
  $('#waitlistName').value = $('#clientName')?.value || '';
  $('#waitlistPhone').value = $('#clientPhone')?.value || '';
  $('#waitlistDialog').showModal();
}

async function submitWaitlist(event) {
  event.preventDefault();
  const service = selectedService();
  const name = $('#waitlistName').value.trim();
  const phone = $('#waitlistPhone').value;
  const phoneDigits = phone.replace(/\D/g, '');
  const errorHolder = $('#waitlistError');
  errorHolder.hidden = true;
  if (!service || !state.date || name.length < 2 || phoneDigits.length !== 11 || !$('#waitlistConsent').checked) {
    errorHolder.textContent = 'Укажите имя, полный номер телефона и подтвердите согласие.';
    errorHolder.hidden = false;
    return;
  }
  const button = $('#submitWaitlist');
  button.disabled = true;
  button.textContent = 'Отправляем…';
  const { data, error } = await db.rpc('join_booking_waitlist', {
    p_service: service.id,
    p_date: state.date,
    p_time_period: $('#waitlistPeriod').value,
    p_client_name: name,
    p_client_phone: phoneDigits
  });
  button.disabled = false;
  button.textContent = 'Оставить заявку';
  if (error || !data?.[0]?.manage_token) {
    errorHolder.textContent = 'Не удалось добавить заявку. Проверьте соединение и попробуйте ещё раз.';
    errorHolder.hidden = false;
    return;
  }
  const manageUrl = new URL('waitlist.html', location.href);
  manageUrl.hash = `token=${encodeURIComponent(data[0].manage_token)}`;
  $('#waitlistManageLink').href = manageUrl.href;
  $('#waitlistSuccessText').textContent = `Заявка ${data[0].request_code} на ${selectedDate().label} сохранена. Мастер увидит её в кабинете.`;
  $('#waitlistForm').hidden = true;
  $('#waitlistSuccess').hidden = false;
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
    if (state.availabilityServiceId === state.serviceId && state.availabilityLocationId === state.locationId && state.availability.size) {
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
  const location = state.teamMode ? state.locations.find(item => item.id === state.locationId) : null;
  const locationLabel = location ? ` · ${escapeHtml(location.name || 'Филиал')}` : '';
  $('#summary').innerHTML = `<small>Ваша запись</small><strong>${escapeHtml(serviceName(service.name))} · ${money(service.price_rub)}${Number(service.duration_minutes) === 1 ? '/мин' : ''}</strong><span>${escapeHtml(service.performer_profiles?.display_name || 'Мастер')}${locationLabel} · ${selectedDate().label}, ${timeRange(state.time, service.duration_minutes)}</span>`;
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
let currentSuccessCalendarEvent = null;
function calendarStartMs(date, time, addMinutes = 0) {
  const [year, month, day] = String(date).split('-').map(Number);
  const [hour, minute] = String(time).slice(0, 5).split(':').map(Number);
  return Date.UTC(year, month - 1, day, hour - 4, minute + addMinutes);
}
function calendarTimestamp(date, time, addMinutes = 0) { return new Date(calendarStartMs(date, time, addMinutes)).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'); }
function calendarUtcTimestamp() { return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'); }
function calendarText(value) { return String(value).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1'); }
function buildSuccessCalendarEvent({ service, performer, location: eventLocation, date, time, duration, uid }) {
  return {
    uid,
    date,
    time: String(time).slice(0, 5),
    title: `${service} — Массаж в Ижевске`,
    description: `Исполнитель: ${performer}`,
    location: eventLocation || 'Ижевск, ул. Карла Маркса, 304б',
    startMs: calendarStartMs(date, time),
    endMs: calendarStartMs(date, time, duration),
    start: calendarTimestamp(date, time),
    end: calendarTimestamp(date, time, duration)
  };
}
function successCalendarFile() {
  const event = currentSuccessCalendarEvent;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'PRODID:-//MassageIzhevsk//Booking//RU', 'BEGIN:VEVENT', `UID:${calendarText(event.uid)}@massage-izhevsk`, `DTSTAMP:${calendarUtcTimestamp()}`, `DTSTART:${event.start}`, `DTEND:${event.end}`, `SUMMARY:${calendarText(event.title)}`, `DESCRIPTION:${calendarText(event.description)}`, `LOCATION:${calendarText(event.location)}`, 'END:VEVENT', 'END:VCALENDAR', ''];
  return new File([lines.join('\r\n')], `massage-${event.date}-${event.time.replace(':', '-')}.ics`, { type: 'text/calendar' });
}
function openCalendarFile(file = successCalendarFile()) {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.type = 'text/calendar';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
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
function openSuccessCalendar() {
  if (!currentSuccessCalendarEvent) return;
  const dialog = $('#calendarDialog');
  if (!dialog || typeof dialog.showModal !== 'function') { openCalendarFile(); return; }
  $('#addAndroidCalendar').href = androidCalendarIntent(currentSuccessCalendarEvent);
  dialog.showModal();
}
async function validateCurrentSelection() {
  const service = selectedService();
  const selectedTime = state.time;
  const selectedBookingDate = state.date;
  const selectedLocationId = state.locationId;
  if (!service || !selectedTime) { await showStep(2); return; }
  setSelectionValidationState('checking');
  const { data, error } = await loadPublicSlots(service, selectedBookingDate, selectedBookingDate, selectedLocationId);
  if (selectedService()?.id !== service.id || state.date !== selectedBookingDate || state.time !== selectedTime || state.locationId !== selectedLocationId) return;
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
function saveClientSession(token) {
  if (!/^[0-9a-f]{64}$/i.test(token || '')) return;
  try { localStorage.setItem(CLIENT_SESSION_KEY, token); } catch {}
}
function clientAccessShareMessage(code, phone) { return `Мои записи на массаж: ${new URL('my-bookings.html', location.href).href}\nТелефон: ${phone}\nЛичный код: ${code}\nНе пересылайте код посторонним.`; }
function downloadClientAccessFile(code, phone) {
  const file = new Blob([`${clientAccessShareMessage(code, phone)}\n`], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'lichnyy-kod-moi-zapisi.txt';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
function renderClientAccess(result, phone) {
  if (!result?.session_token) return;
  saveClientSession(result.session_token);
  $('#myBookingsSuccess').hidden = false;
  if (!result.access_code) return;
  $('#clientAccessCode').textContent = result.access_code;
  $('#clientAccessNote').textContent = 'Это устройство запомнило вход на 90 дней. Код сохранится в файл; если загрузка не началась, нажмите кнопку ниже.';
  $('#clientAccessDownload').onclick = () => downloadClientAccessFile(result.access_code, phone);
  const text = clientAccessShareMessage(result.access_code, phone);
  $('#clientAccessWhatsapp').href = `https://wa.me/?text=${encodeURIComponent(text)}`;
  $('#clientAccessTelegram').href = `https://t.me/share/url?url=${encodeURIComponent(new URL('my-bookings.html', location.href).href)}&text=${encodeURIComponent(text)}`;
  $('#clientAccessShare').hidden = false;
  $('#clientAccessResult').hidden = false;
  downloadClientAccessFile(result.access_code, phone);
}
async function bootstrapClientAccess(manageToken, phone) {
  if (!manageToken) return;
  const { data } = await db.rpc('bootstrap_client_access', { p_manage_token: manageToken, p_device_name: navigator.userAgent.slice(0, 120) });
  renderClientAccess(data?.[0], phone);
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
  if (state.teamMode && !state.locations.length) { showError('Запись в филиал пока не активирована. Запись не создана — обновите страницу позже или свяжитесь со специалистом.'); return; }
  if (state.teamMode && !state.locationId) { showError('Выберите филиал для записи.'); return; }
  if (!navigator.onLine) { showError('Нет соединения с интернетом. Запись не создана — подключитесь к сети и повторите попытку.'); return; }
  const attempt = await currentBookingAttempt(service, name, phone);
  const submit = $('#submitBooking');
  submit.disabled = true;
  setSubmitLabel(bookingResultUncertain ? 'Проверяем…' : 'Сохраняем…');
  $('#formError').hidden = true;
  const bookingResult = state.teamMode
    ? await db.rpc('book_minuta_appointment', { p_request_id: attempt.requestId, p_slug: requestedOrganizationSlug, p_location: state.locationId, p_service: service.id, p_date: state.date, p_time: `${state.time}:00`, p_client_name: name, p_client_phone: phone })
    : await db.rpc('book_appointment', { p_request_id: attempt.requestId, p_service: service.id, p_date: state.date, p_time: `${state.time}:00`, p_client_name: name, p_client_phone: phone });
  const { data, error } = bookingResult;
  setSubmitLabel(bookingResultUncertain ? 'Проверить результат' : 'Подтвердить запись');
  updateSubmitAvailability();
  if (error) {
    const missingTeamBookingRpc = state.teamMode && isMissingRpc(error, 'book_minuta_appointment');
    if (missingTeamBookingRpc) {
      clearBookingAttempt();
      showError('Запись в филиал пока не активирована. Запись не создана — обновите страницу позже или свяжитесь со специалистом.');
    } else if (error.message?.includes('slot_unavailable') || error.message?.includes('resource_unavailable') || error.code === '23P01' || error.code === '23505') {
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
  const bookedLocation = state.teamMode ? state.locations.find(item => item.id === state.locationId) : null;
  currentSuccessCalendarEvent = buildSuccessCalendarEvent({ service: serviceName(service.name), performer: service.performer_profiles?.display_name || 'Мастер', location: bookedLocation?.address || bookedLocation?.name || '', date: state.date, time: state.time, duration: service.duration_minutes, uid: manageToken || attempt.requestId });
  saveClientContact(name, phone);
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
    $('#telegramConnect').href = telegramConnectUrl(manageToken);
    $('#telegramConnect').hidden = false;
    await bootstrapClientAccess(manageToken, phone);
    const { data: management } = await db.rpc('get_booking_management', { p_token: manageToken });
    const current = management?.[0];
    renderSuccessPayment(current);
    if (current) {
      currentSuccessCalendarEvent = buildSuccessCalendarEvent({ service: current.service_name, performer: current.performer_name || 'Мастер', location: bookedLocation?.address || bookedLocation?.name || '', date: current.booking_date, time: current.booking_time, duration: current.duration_minutes, uid: current.booking_code || manageToken });
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

function resetFlow() { $('#success').hidden = true; $('#successPayment').hidden = true; $('#clientAccessResult').hidden = true; $('#clientAccessShare').hidden = true; $('#bookingFlow').hidden = false; $('#manageBooking').hidden = true; $('#myBookingsSuccess').hidden = true; $('#telegramConnect').hidden = true; $('#bookingForm').reset(); restoreClientContact(); $('#formError').hidden = true; clearBookingAttempt(); currentSuccessCalendarEvent = null; state.time = ''; state.moreDates = false; setSelectionValidationState('ready'); updateSubmitAvailability(); showStep(1); }
document.addEventListener('click', event => {
  const performer = event.target.closest('[data-performer]');
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
  const openWaitlist = event.target.closest('#openWaitlist');
  const closeWaitlist = event.target.closest('[data-close-waitlist]');
  if (performer) {
    const nextPerformer = performer.dataset.performer || '';
    if (state.performerId !== nextPerformer) {
      state.performerId = nextPerformer;
      const services = visibleServices();
      if (!services.some(item => item.id === state.serviceId)) state.serviceId = services[0]?.id || '';
      state.availability = new Map();
      state.availabilityServiceId = '';
      state.time = '';
      renderSpecialists();
      renderServices();
      setBookingStatus(services.length ? 'open' : 'closed', services.length ? 'Запись открыта' : 'У специалиста пока нет услуг');
    }
  }
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
  if (openWaitlist) openWaitlistDialog();
  if (closeWaitlist) $('#waitlistDialog').close();
});
$('#clientName').addEventListener('input', bookingInputChanged);
$('#clientPhone').addEventListener('input', event => { event.target.value = formatPhone(event.target.value); bookingInputChanged(); });
$('#dataConsent').addEventListener('change', bookingInputChanged);
$('#bookingForm').addEventListener('submit', submitBooking);
$('#locationSelect')?.addEventListener('change', async event => {
  const nextLocation = event.target.value || '';
  if (state.locationId === nextLocation) return;
  state.locationId = nextLocation;
  availabilityLoadRevision += 1;
  state.availability = new Map();
  state.availabilityServiceId = '';
  state.availabilityLocationId = '';
  state.loadingAvailability = false;
  state.availabilityError = false;
  state.time = '';
  if (state.performerId && !locationEligibleServices().some(item => item.performer_id === state.performerId)) state.performerId = '';
  if (!visibleServices().some(item => item.id === state.serviceId)) state.serviceId = visibleServices()[0]?.id || '';
  bookingInputChanged();
  renderLocations();
  renderSpecialists();
  renderServices();
  renderTimes();
  setBookingStatus(visibleServices().length ? 'open' : 'closed', visibleServices().length ? 'Запись открыта' : 'В этом филиале пока нет доступных услуг');
  if (state.step === 2 && state.serviceId) await loadAvailability();
});
$('#waitlistPhone').addEventListener('input', event => { event.target.value = formatPhone(event.target.value); });
$('#waitlistForm').addEventListener('submit', submitWaitlist);
$('#newBooking').addEventListener('click', resetFlow);
$('#saveSuccessCalendar').addEventListener('click', openSuccessCalendar);
$('#addAppleCalendar').addEventListener('click', () => { openCalendarFile(); $('#calendarDialog').close(); });
$('#addAndroidCalendar').addEventListener('click', () => $('#calendarDialog').close());
$('#closeCalendarDialog').addEventListener('click', () => $('#calendarDialog').close());
$('#calendarDialog').addEventListener('click', event => { if (event.target === $('#calendarDialog')) $('#calendarDialog').close(); });
window.addEventListener('offline', () => setBookingStatus('offline', 'Нет соединения с интернетом'));
window.addEventListener('online', loadServices);
restoreClientContact();
renderDates();
renderTimes();
loadServices();
loadPublicReviews();
updateSubmitAvailability();
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js?v=130'));
