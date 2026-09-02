if (window.top === window.self) document.documentElement.classList.add('top-level');
else throw new Error('embedded_provider_blocked');

const db = window.supabase.createClient(window.MINUTA_CONFIG.supabaseUrl, window.MINUTA_CONFIG.supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const SCHEDULE_DATE_KEY = 'massage-schedule-selected-date';
const SCHEDULE_FOLLOW_TODAY_KEY = 'massage-schedule-follow-today';
const SCHEDULE_FILTER_KEY = 'massage-schedule-filter';
const SCHEDULE_BLOCK_PHONE = '0000000000';
const JOURNAL_MODE_KEY = 'massage-journal-mode-v4';
const PROVIDER_LAYOUT_KEYS = ['linear', 'soft', 'capsule', 'editorial', 'bento'];
const PROVIDER_THEME_KEYS = ['sage', 'nordic', 'warm', 'graphite', 'lavender', 'luxury', 'loft', 'eco', 'hitech'];
const LEGACY_PROVIDER_THEME_MAP = Object.freeze({ linear:'sage', soft:'nordic', capsule:'lavender', editorial:'warm', bento:'graphite' });
const VISIT_WINDOW_DAYS = 30;
const VISIT_WINDOW_MS = VISIT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
const REGULAR_CLIENT_COMPLETED_VISITS = 10;
const DEFAULT_DISPLAY_PREFERENCES = Object.freeze({
  layout: 'soft',
  theme: 'sage',
  show_phone: true,
  show_visit_number: true,
  show_client_type: true,
  show_client_labels: true,
  show_notes: true
});
const BOOKING_COLOR_KEYS = ['auto', 'mint', 'sky', 'lavender', 'peach', 'rose', 'vanilla'];
const BOOKING_COLOR_DEFAULT = 'auto';
let currentUser = null;
let currentFilter = restoreScheduleFilter();
let notificationFilter = 'pending';
let reportPeriod = 'month';
let notificationTimer = null;
let deferredInstallPrompt = null;
let journalMode = localStorage.getItem(JOURNAL_MODE_KEY) || 'timeline';
let selectedDate = restoreSelectedDate();
let renderedBusinessToday = businessTodayIso();
let allBookings = [];
let waitlistRequests = [];
let waitlistRemoteAvailable = false;
let bookingOutcomes = new Map();
let bookingSessionItems = new Map();
let sessionItemsRemoteAvailable = false;
let sessionComposerDraft = [];
let bookingColors = new Map();
let bookingNotes = new Map();
let pendingBookingNotes = new Set();
let outcomesRemoteAvailable = false;
let bookingPolicy = { cancel_cutoff_hours: 12, reschedule_cutoff_hours: 12, max_reschedules: 2, deposit_enabled: false, deposit_amount_rub: 0, payment_url_template: '', auto_complete_visits: false };
let displayPreferences = { ...DEFAULT_DISPLAY_PREFERENCES };
let displayPreferencesSaveTimer = null;
let displayPreferencesSaveRevision = 0;
let serverNotificationTemplates = {};
let serverNotificationMarks = {};
let notificationSettingsRemoteAvailable = false;
let notificationOutbox = [];
let notificationOutboxRemoteAvailable = false;
let ownServices = [];
let portfolioItems = [];
let providerReviews = [];
let portfolioRemoteAvailable = false;
let portfolioDraggedId = '';
let portfolioPhotoDrafts = { before: null, after: null };
let portfolioPreviewUrls = [];
let clientNotes = new Map();
let clientLabels = new Map();
let pendingClientLabels = new Set();
let clientLabelReasonTimer = null;
const clientLabelSaveQueues = new Map();
let selectedClientPhone = '';
let repeatTime = '';
let bookingEditTime = '';
let newBookingTime = '';
let newBookingSlots = [];
let newBookingHour = '';
let newBookingPreferredTime = '';
let newBookingMode = 'client';
let scheduleRows = [];
let daysOff = [];
let scheduleDirty = false;
let recoveryMode = new URLSearchParams(location.hash.slice(1)).get('type') === 'recovery';
let bookingsChannel = null;
let syncTimer = null;
let bookingReloadTimer = null;
let sessionGeneration = 0;
let bookingsRequestRevision = 0;
let synchronizationPromise = null;
let synchronizationGeneration = -1;
let synchronizationQueued = false;
let writesAllowed = false;
let teamCalendarController = null;
const reliability = window.MinutaReliability;
const PROVIDER_CACHE_MAX_AGE = 24 * 60 * 60 * 1000;
const providerCacheMaintenance = (async () => {
  await reliability?.removeExpired?.('provider:', PROVIDER_CACHE_MAX_AGE);
  try { await reliability?.removeMatching?.('provider:', ':bookings'); } catch {}
})().catch(() => {});
setInterval(() => { reliability?.removeMatching?.('provider:', ':bookings')?.catch(() => {}); }, 60000);
const weekdayNames = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
const notificationAddress = 'Ижевск, ул. Карла Маркса, 304Б';
const PORTFOLIO_BUCKET = 'portfolio-images';
const PORTFOLIO_INPUT_LIMIT = 12 * 1024 * 1024;
const PORTFOLIO_OUTPUT_LIMIT = 8 * 1024 * 1024;
const PORTFOLIO_MAX_EDGE = 2000;
const defaultNotificationTemplates = {
  confirmation: 'Здравствуйте, {имя}! Ваша запись подтверждена.\n\n{услуга}\n{дата} в {время}\n{адрес}\n\nДо встречи!',
  reminder: 'Здравствуйте, {имя}! Напоминаю о вашей записи.\n\n{услуга}\n{дата} в {время}\n{адрес}\n\nЕсли планы изменились, пожалуйста, сообщите заранее.',
  cancellation: 'Здравствуйте, {имя}! Ваша запись на {услуга}, {дата} в {время}, отменена. Если захотите подобрать другое время, напишите мне.'
};
const telegramClientEndpoint = `${window.MINUTA_CONFIG.supabaseUrl}/functions/v1/telegram-client-notify`;

function providerCacheKey(name, userId = currentUser?.id) { return `provider:${userId || 'anonymous'}:${name === 'bookings' ? 'bookings-v2' : name}`; }
function sessionIsCurrent(userId, generation) { return currentUser?.id === userId && sessionGeneration === generation; }
function cachePayload(name, data) {
  if (name !== 'bookings' || !Array.isArray(data)) return data;
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffIso = localIsoDate(cutoff);
  return data.filter(item => item.booking_date >= cutoffIso).slice(-500).map(item => isScheduleBlock(item)
    ? { ...item, booking_code: '', client_name: item.client_name || 'Перерыв', client_phone: SCHEDULE_BLOCK_PHONE }
    : { ...item, booking_code: '', client_name: 'Клиент', client_phone: '' });
}
async function saveProviderCache(name, data, userId = currentUser?.id) {
  if (!userId) return;
  try { await reliability?.put(providerCacheKey(name, userId), cachePayload(name, data)); } catch {}
}
async function readProviderCache(name, userId = currentUser?.id) {
  if (!userId) return null;
  try {
    const cached = await reliability?.get(providerCacheKey(name, userId));
    if (!cached) return null;
    const savedAt = new Date(cached.savedAt).getTime();
    if (!Number.isFinite(savedAt) || Date.now() - savedAt > PROVIDER_CACHE_MAX_AGE) {
      await reliability?.remove?.(providerCacheKey(name, userId));
      return null;
    }
    return cached;
  } catch { return null; }
}
const writeSelectors = [
  '#newBookingButton', '#saveSchedule', '#saveClientNote', '#clientLabelFavorite', '#clientLabelVip', '#clientLabelAttention', '#clientFavoriteNote', '#clientVipNote', '#clientAttentionReason',
  '[data-booking-label-favorite]', '[data-booking-label-vip]', '[data-booking-label-attention]', '[data-booking-favorite-note]', '[data-booking-vip-note]', '[data-booking-attention-reason]',
  '#serviceForm button[type="submit"]', '#dayOffForm button[type="submit"]',
  '#repeatBookingForm button[type="submit"]', '#bookingOutcomeForm button[type="submit"]',
  '#bookingPolicyForm button[type="submit"]', '#bookingPrepaymentForm button[type="submit"]',
  '#bookingEditForm button[type="submit"]', '#newBookingForm button[type="submit"]', '#serviceEditForm button[type="submit"]',
  '#portfolioForm button[type="submit"]', '[data-open-portfolio-editor]', '[data-edit-portfolio]', '[data-delete-portfolio]', '[data-portfolio-move]',
  '[data-organization-write]', '#organizationForm button[type="submit"]', '#locationForm button[type="submit"]', '#memberInviteForm button[type="submit"]',
  '[data-retry-notification-outbox]',
  '[data-booking-status]', '[data-delete-booking]', '[data-waitlist-status]', '[data-booking-color-id]', '[data-delete-service]', '[data-toggle-service]', '[data-delete-day-off]'
];
function applyWriteAvailability() {
  $$(writeSelectors.join(',')).forEach(control => {
    if (!writesAllowed && !control.disabled) {
      control.disabled = true;
      control.dataset.reliabilityDisabled = 'true';
    } else if (writesAllowed && control.dataset.reliabilityDisabled === 'true') {
      control.disabled = false;
      delete control.dataset.reliabilityDisabled;
    }
  });
}
function setWritesAllowed(value) {
  writesAllowed = Boolean(value);
  applyWriteAvailability();
}
function requireWrites() {
  if (writesAllowed && navigator.onLine && currentUser) return true;
  notify('Изменения временно заблокированы до полной синхронизации');
  return false;
}
async function notifyTelegramClient(bookingId, event) {
  try {
    const { data } = await db.auth.getSession();
    const accessToken = data.session?.access_token;
    if (!accessToken) return;
    await fetch(`${telegramClientEndpoint}/event`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: window.MINUTA_CONFIG.supabaseKey, authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ event, booking_id: bookingId })
    });
  } catch {}
}
function setSyncState(kind, text) {
  const element = $('#syncState');
  if (!element) return;
  element.className = `sync-state is-${kind}`;
  element.querySelector('span').textContent = text;
  applyWriteAvailability();
}
function cachedStateText(savedAt) {
  return `Офлайн · данные на ${reliability?.savedAtLabel(savedAt) || 'последнюю синхронизацию'}`;
}
function renderBookingData() {
  updateBookingStats();
  renderBookings();
  renderClients();
  renderNotifications();
  renderAnalytics();
  if (selectedClientPhone) renderClientDetail(selectedClientPhone);
}

function localIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
function businessTodayIso(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Samara', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function normalizePhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('00')) return '';
  if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  if (digits.length === 10) digits = `7${digits}`;
  return digits.length >= 11 && digits.length <= 15 && !digits.startsWith('0') ? digits : '';
}

function clientLabelStorageKey(userId = currentUser?.id) { return `massage-client-labels-v1:${userId || 'anonymous'}`; }
function clientLabelPendingStorageKey(userId = currentUser?.id) { return `massage-client-labels-pending-v1:${userId || 'anonymous'}`; }
function normalizeClientLabel(value = {}) {
  return {
    favorite: Boolean(value.favorite),
    favorite_note: String(value.favorite_note || '').trim().slice(0, 500),
    vip: Boolean(value.vip),
    vip_note: String(value.vip_note || '').trim().slice(0, 500),
    attention: Boolean(value.attention),
    attention_reason: String(value.attention_reason || '').trim().slice(0, 500)
  };
}
function loadLocalClientLabels(userId = currentUser?.id) {
  try {
    const saved = JSON.parse(localStorage.getItem(clientLabelStorageKey(userId)) || '{}');
    clientLabels = new Map(Object.entries(saved).map(([phone, value]) => [phone, normalizeClientLabel(value)]));
  } catch { clientLabels = new Map(); }
  try { pendingClientLabels = new Set(JSON.parse(localStorage.getItem(clientLabelPendingStorageKey(userId)) || '[]')); }
  catch { pendingClientLabels = new Set(); }
}
function persistClientLabels(userId = currentUser?.id) {
  if (!userId) return;
  try {
    localStorage.setItem(clientLabelStorageKey(userId), JSON.stringify(Object.fromEntries(clientLabels)));
    localStorage.setItem(clientLabelPendingStorageKey(userId), JSON.stringify([...pendingClientLabels]));
  } catch {}
}
function clientLabel(phone) { return normalizeClientLabel(clientLabels.get(normalizePhone(phone))); }
function clientHighlightClasses(phone) {
  const value = clientLabel(phone);
  return `${value.favorite ? ' client-favorite' : ''}${value.vip ? ' client-vip' : ''}${value.attention ? ' client-attention' : ''}`;
}
function applyClientHighlightClasses(element, phone, prefix = 'client-') {
  const value = clientLabel(phone);
  element?.classList.toggle(`${prefix}favorite`, value.favorite);
  element?.classList.toggle(`${prefix}vip`, value.vip);
  element?.classList.toggle(`${prefix}attention`, value.attention);
}
function providerDisplayStorageKey(userId = currentUser?.id) { return `massage-provider-display-v1:${userId || 'guest'}`; }
function normalizeDisplayPreferences(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const storedTheme = String(source.theme || '');
  const storedLayout = String(source.layout || '');
  const legacyLayout = PROVIDER_LAYOUT_KEYS.includes(storedTheme) ? storedTheme : '';
  return {
    layout: PROVIDER_LAYOUT_KEYS.includes(storedLayout) ? storedLayout : legacyLayout || DEFAULT_DISPLAY_PREFERENCES.layout,
    theme: PROVIDER_THEME_KEYS.includes(storedTheme) ? storedTheme : LEGACY_PROVIDER_THEME_MAP[storedTheme] || DEFAULT_DISPLAY_PREFERENCES.theme,
    show_phone: source.show_phone ?? DEFAULT_DISPLAY_PREFERENCES.show_phone,
    show_visit_number: source.show_visit_number ?? DEFAULT_DISPLAY_PREFERENCES.show_visit_number,
    show_client_type: source.show_client_type ?? DEFAULT_DISPLAY_PREFERENCES.show_client_type,
    show_client_labels: source.show_client_labels ?? DEFAULT_DISPLAY_PREFERENCES.show_client_labels,
    show_notes: source.show_notes ?? DEFAULT_DISPLAY_PREFERENCES.show_notes
  };
}
function loadLocalDisplayPreferences(userId = currentUser?.id) {
  try { displayPreferences = normalizeDisplayPreferences(JSON.parse(localStorage.getItem(providerDisplayStorageKey(userId)) || '{}')); }
  catch { displayPreferences = { ...DEFAULT_DISPLAY_PREFERENCES }; }
}
function persistLocalDisplayPreferences(userId = currentUser?.id) {
  if (!userId) return;
  try { localStorage.setItem(providerDisplayStorageKey(userId), JSON.stringify(displayPreferences)); } catch {}
}
function applyDisplayPreferences() {
  document.body.dataset.providerTheme = displayPreferences.theme;
  document.body.dataset.providerLayout = displayPreferences.layout;
  const themeColors = { sage:'#153c2c', nordic:'#3568e8', warm:'#a9664c', graphite:'#11171b', lavender:'#7660cc', luxury:'#0b0c0e', loft:'#292a28', eco:'#f1ece2', hitech:'#eef4fa' };
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColors[displayPreferences.theme] || themeColors.sage);
}
function renderDisplayPreferencesForm() {
  const form = $('#providerDisplayForm');
  if (!form) return;
  const layout = form.querySelector(`input[name="providerLayout"][value="${displayPreferences.layout}"]`);
  if (layout) layout.checked = true;
  const theme = form.querySelector(`input[name="providerTheme"][value="${displayPreferences.theme}"]`);
  if (theme) theme.checked = true;
  $('#showBookingPhone').checked = displayPreferences.show_phone;
  $('#showBookingVisitNumber').checked = displayPreferences.show_visit_number;
  $('#showBookingClientType').checked = displayPreferences.show_client_type;
  $('#showBookingClientLabels').checked = displayPreferences.show_client_labels;
  $('#showBookingNotes').checked = displayPreferences.show_notes;
}
function providerAppIsInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}
function providerAppIsIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
function providerAppIsAndroid() {
  return /android/i.test(navigator.userAgent);
}
function providerAppIsInAppBrowser() {
  return /; wv\)|\bwv\b|instagram|fban|fbav|telegram|line\/|micromessenger/i.test(navigator.userAgent);
}
function providerAppHasSecureOrigin() {
  return window.isSecureContext || ['localhost', '127.0.0.1'].includes(location.hostname);
}
function hideProviderInstallGuides() {
  ['androidInstallGuide', 'iosInstallGuide', 'browserInstallGuide'].forEach(id => {
    const guide = $(`#${id}`);
    if (guide) guide.hidden = true;
  });
  $('#installAppButton')?.setAttribute('aria-expanded', 'false');
}
function showProviderInstallGuide(id) {
  hideProviderInstallGuides();
  const guide = $(`#${id}`);
  if (!guide) return;
  guide.hidden = false;
  $('#installAppButton')?.setAttribute('aria-expanded', 'true');
  guide.scrollIntoView({ behavior:'smooth', block:'nearest' });
}
function refreshInstallAppCard() {
  const button = $('#installAppButton');
  const status = $('#installAppStatus');
  if (!button || !status) return;
  button.disabled = false;
  hideProviderInstallGuides();
  if (providerAppIsInstalled()) {
    button.disabled = true;
    button.querySelector('span').textContent = 'Приложение установлено';
    status.textContent = 'Кабинет уже открывается как отдельное приложение.';
    return;
  }
  if (!providerAppHasSecureOrigin()) {
    button.querySelector('span').textContent = 'Почему не устанавливается';
    status.textContent = 'Для установки откройте опубликованную HTTPS-версию сайта.';
    return;
  }
  if (deferredInstallPrompt) {
    button.querySelector('span').textContent = providerAppIsAndroid() ? 'Установить на Android' : 'Установить приложение';
    status.textContent = 'Нажмите кнопку — откроется системное окно установки.';
    return;
  }
  if (providerAppIsIos()) {
    button.querySelector('span').textContent = 'Инструкция для iPhone';
    status.textContent = 'На iPhone и iPad приложение добавляется через меню «Поделиться» в Safari.';
    return;
  }
  if (providerAppIsAndroid()) {
    button.querySelector('span').textContent = 'Как установить на Android';
    status.textContent = providerAppIsInAppBrowser()
      ? 'Сначала откройте эту страницу в Chrome — встроенный браузер не показывает установку.'
      : 'Если системное окно не появилось, установка доступна через меню Chrome.';
    return;
  }
  button.querySelector('span').textContent = 'Как установить приложение';
  status.textContent = 'Откройте меню браузера и выберите установку приложения.';
}
async function installProviderApp() {
  if (providerAppIsInstalled()) {
    notify('Приложение уже установлено');
    return;
  }
  if (!providerAppHasSecureOrigin()) {
    showProviderInstallGuide('browserInstallGuide');
    return;
  }
  if (deferredInstallPrompt) {
    const prompt = deferredInstallPrompt;
    deferredInstallPrompt = null;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      refreshInstallAppCard();
      notify(choice.outcome === 'accepted' ? 'Установка приложения началась' : 'Установка отменена');
    } catch {
      refreshInstallAppCard();
      showProviderInstallGuide(providerAppIsAndroid() ? 'androidInstallGuide' : 'browserInstallGuide');
    }
    return;
  }
  if (providerAppIsIos()) {
    showProviderInstallGuide('iosInstallGuide');
    return;
  }
  if (providerAppIsAndroid()) {
    showProviderInstallGuide('androidInstallGuide');
    return;
  }
  showProviderInstallGuide('browserInstallGuide');
}
function displayPreferencesFromForm() {
  return normalizeDisplayPreferences({
    layout: $('#providerDisplayForm input[name="providerLayout"]:checked')?.value,
    theme: $('#providerDisplayForm input[name="providerTheme"]:checked')?.value,
    show_phone: $('#showBookingPhone').checked,
    show_visit_number: $('#showBookingVisitNumber').checked,
    show_client_type: $('#showBookingClientType').checked,
    show_client_labels: $('#showBookingClientLabels').checked,
    show_notes: $('#showBookingNotes').checked
  });
}
function saveDisplayPreferences() {
  displayPreferences = displayPreferencesFromForm();
  persistLocalDisplayPreferences();
  applyDisplayPreferences();
  renderBookings();
  const status = $('#providerDisplayStatus');
  if (status) status.textContent = 'Сохраняем…';
  clearTimeout(displayPreferencesSaveTimer);
  const revision = ++displayPreferencesSaveRevision;
  if (!currentUser || !navigator.onLine) {
    if (status) status.textContent = 'Сохранено на этом устройстве';
    return;
  }
  const preferencesSnapshot = { ...displayPreferences };
  displayPreferencesSaveTimer = setTimeout(async () => {
    const { data, error } = await db.auth.updateUser({ data: { provider_display_preferences: preferencesSnapshot } });
    if (revision !== displayPreferencesSaveRevision) return;
    if (!error && data?.user) currentUser = data.user;
    if (status) status.textContent = error ? 'Сохранено на этом устройстве' : 'Сохранено в аккаунте';
  }, 350);
}
function classifyVisitHistory(referenceTimestamp, completedTimestamps, currentCompleted = false) {
  const reference = Number(referenceTimestamp);
  const cutoff = reference - VISIT_WINDOW_MS;
  const prior = completedTimestamps.filter(timestamp => Number.isFinite(timestamp) && timestamp < reference);
  const recentPrior = prior.filter(timestamp => timestamp >= cutoff).length;
  const completedInWindow = recentPrior + (currentCompleted ? 1 : 0);
  const visitNumber = recentPrior + 1;
  const isRegular = completedInWindow >= REGULAR_CLIENT_COMPLETED_VISITS;
  return {
    visitNumber,
    completedInWindow,
    isRegular,
    clientType: isRegular ? 'Постоянный клиент' : recentPrior === 0 ? (prior.length ? 'После перерыва' : 'Новый клиент') : 'Повторный клиент'
  };
}
function bookingCountsAsCompletedVisit(item) {
  return !isScheduleBlock(item) && item.status !== 'cancelled' && bookingOutcome(item).visit_status === 'completed';
}
function bookingVisitContext(item) {
  const phone = normalizePhone(item?.client_phone);
  if (!phone || isScheduleBlock(item)) return null;
  const reference = bookingStart(item).getTime();
  const completedTimestamps = allBookings
    .filter(other => other.id !== item.id && normalizePhone(other.client_phone) === phone && bookingCountsAsCompletedVisit(other))
    .map(other => bookingStart(other).getTime());
  const context = classifyVisitHistory(reference, completedTimestamps, bookingCountsAsCompletedVisit(item));
  return { ...context, visitLabel:`${context.visitNumber}-й визит за ${VISIT_WINDOW_DAYS} дней` };
}
function bookingVisitSummaryMarkup(item, className = 'booking-client-visit') {
  const context = bookingVisitContext(item);
  if (!context) return '';
  const parts = [];
  if (displayPreferences.show_client_type) parts.push(context.clientType);
  if (displayPreferences.show_visit_number) parts.push(context.visitLabel);
  return parts.length ? `<span class="${className} ${context.isRegular ? 'is-regular' : context.clientType === 'Новый клиент' ? 'is-new' : ''}">${escapeHtml(parts.join(' · '))}</span>` : '';
}
function bookingVisitSummaryText(item) {
  const context = bookingVisitContext(item);
  if (!context) return '';
  return [displayPreferences.show_client_type ? context.clientType : '', displayPreferences.show_visit_number ? context.visitLabel : ''].filter(Boolean).join(' · ');
}
function clientIsNew(phone) {
  const normalized = normalizePhone(phone);
  const now = new Date();
  return !allBookings.some(item => {
    if (isScheduleBlock(item) || normalizePhone(item.client_phone) !== normalized || item.status === 'cancelled') return false;
    const outcome = bookingOutcome(item);
    if (outcome.visit_status === 'no_show') return false;
    if (outcome.visit_status === 'completed') return true;
    const duration = Number(item.duration_minutes || item.services?.duration_minutes || 60);
    const end = new Date(`${item.booking_date}T${String(item.booking_time).slice(0, 8)}`);
    return new Date(end.getTime() + duration * 60000) < now;
  });
}
function clientBadgeDefinitions(phone) {
  const value = clientLabel(phone);
  return [
    value.attention ? { key:'attention', icon:'shield-alert', label:'Требует внимания', detail:value.attention_reason } : null,
    value.vip ? { key:'vip', icon:'crown', label:'VIP', detail:value.vip_note } : null,
    value.favorite ? { key:'favorite', icon:'heart', label:'Любимый клиент', detail:value.favorite_note } : null,
    clientIsNew(phone) ? { key:'new', icon:'spark', label:'Новый клиент' } : null
  ].filter(Boolean);
}
function clientBadgeText(phone) {
  return clientBadgeDefinitions(phone).map(item => item.detail ? `${item.label}: ${item.detail}` : item.label).join(', ');
}
function clientBadgeMarkup(phone, { limit = 2, showLabels = false } = {}) {
  const definitions = clientBadgeDefinitions(phone);
  if (!definitions.length) return '';
  const shown = definitions.slice(0, limit);
  const rest = definitions.length - shown.length;
  if (!showLabels) {
    const fullText = clientBadgeText(phone);
    return `<span class="client-badges" aria-hidden="true">${shown.map(item => {
      const title = item.detail ? `${item.label}: ${item.detail}` : item.label;
      return `<span class="client-badge badge-${item.key}" title="${escapeHtml(title)}">${uiIcon(item.icon)}</span>`;
    }).join('')}${rest > 0 ? `<span class="client-badge-more">+${rest}</span>` : ''}</span><span class="sr-only">Метки клиента: ${escapeHtml(fullText)}</span>`;
  }
  return `<span class="client-badges with-labels" role="list" aria-label="Метки клиента">${shown.map(item => {
    const title = item.detail ? `${item.label}: ${item.detail}` : item.label;
    return `<span class="client-badge badge-${item.key}" role="listitem" title="${escapeHtml(title)}">${uiIcon(item.icon)}<span>${item.label}</span>${item.detail ? `<span class="sr-only">: ${escapeHtml(item.detail)}</span>` : ''}</span>`;
  }).join('')}${rest > 0 ? `<span class="client-badge-more" aria-hidden="true">+${rest}</span><span class="sr-only">Остальные метки: ${escapeHtml(definitions.slice(limit).map(item => item.detail ? `${item.label}: ${item.detail}` : item.label).join(', '))}</span>` : ''}</span>`;
}
function bookingClientLabelsMarkup(phone, bookingId) {
  const normalizedPhone = normalizePhone(phone);
  const value = clientLabel(normalizedPhone);
  const summary = clientBadgeMarkup(normalizedPhone, { limit:3 }) || `${uiIcon('plus')}<span>Добавить</span>`;
  return `<details class="booking-sheet-disclosure booking-labels-disclosure">
    <summary><div><small>О клиенте</small><strong>Метки клиента</strong></div><span class="booking-labels-summary">${summary}</span></summary>
    <div class="booking-labels-editor" data-booking-client-labels="${escapeHtml(normalizedPhone)}" data-booking-id="${escapeHtml(bookingId)}">
      <div class="client-label-options">
        <label class="client-label-option label-favorite"><input data-booking-label-favorite type="checkbox" ${value.favorite ? 'checked' : ''}><span>${uiIcon('heart')}</span><strong>Любимый</strong></label>
        <label class="client-label-option label-vip"><input data-booking-label-vip type="checkbox" ${value.vip ? 'checked' : ''}><span>${uiIcon('crown')}</span><strong>VIP</strong></label>
        <label class="client-label-option label-attention"><input data-booking-label-attention type="checkbox" ${value.attention ? 'checked' : ''}><span>${uiIcon('shield-alert')}</span><strong>Внимание</strong></label>
      </div>
      <label class="client-attention-reason" data-booking-favorite-note-field ${value.favorite ? '' : 'hidden'}>Что нравится клиенту<textarea data-booking-favorite-note maxlength="500" rows="2" placeholder="Например, любимая музыка или привычный формат визита">${escapeHtml(value.favorite_note)}</textarea></label>
      <label class="client-attention-reason" data-booking-vip-note-field ${value.vip ? '' : 'hidden'}>Пожелания и условия<textarea data-booking-vip-note maxlength="500" rows="2" placeholder="Например, индивидуальные пожелания или условия">${escapeHtml(value.vip_note)}</textarea></label>
      <label class="client-attention-reason" data-booking-attention-reason-field ${value.attention ? '' : 'hidden'}>Причина<textarea data-booking-attention-reason maxlength="500" rows="2" placeholder="Например, нужна предоплата или часто опаздывает">${escapeHtml(value.attention_reason)}</textarea></label>
      <p class="form-error" data-booking-labels-error hidden></p>
      <span class="client-labels-autosave" data-booking-labels-status role="status" aria-live="polite">Сохраняются автоматически</span>
    </div>
  </details>`;
}
function bookingColorStorageKey(userId = currentUser?.id) { return `massage-booking-colors-v1:${userId || 'anonymous'}`; }
function validBookingColor(value) { return BOOKING_COLOR_KEYS.includes(String(value)) ? String(value) : BOOKING_COLOR_DEFAULT; }
function loadBookingColors(userId = currentUser?.id) {
  try {
    const saved = JSON.parse(localStorage.getItem(bookingColorStorageKey(userId)) || '{}');
    bookingColors = new Map(Object.entries(saved).map(([id, color]) => [id, validBookingColor(color)]));
  } catch { bookingColors = new Map(); }
}
function persistBookingColors(userId = currentUser?.id) {
  if (!userId) return;
  try { localStorage.setItem(bookingColorStorageKey(userId), JSON.stringify(Object.fromEntries(bookingColors))); } catch {}
}
function bookingNoteStorageKey(userId = currentUser?.id) { return `massage-booking-notes-v1:${userId || 'anonymous'}`; }
function bookingNotePendingStorageKey(userId = currentUser?.id) { return `massage-booking-notes-pending-v1:${userId || 'anonymous'}`; }
function loadBookingNotes(userId = currentUser?.id) {
  try {
    const saved = JSON.parse(localStorage.getItem(bookingNoteStorageKey(userId)) || '{}');
    bookingNotes = new Map(Object.entries(saved).map(([id, note]) => [id, String(note || '').slice(0, 1000)]));
  } catch { bookingNotes = new Map(); }
  try { pendingBookingNotes = new Set(JSON.parse(localStorage.getItem(bookingNotePendingStorageKey(userId)) || '[]')); }
  catch { pendingBookingNotes = new Set(); }
}
function persistBookingNotes(userId = currentUser?.id) {
  if (!userId) return;
  try {
    localStorage.setItem(bookingNoteStorageKey(userId), JSON.stringify(Object.fromEntries(bookingNotes)));
    localStorage.setItem(bookingNotePendingStorageKey(userId), JSON.stringify([...pendingBookingNotes]));
  } catch {}
}
function bookingColor(item) { return validBookingColor(item?.color_key || bookingColors.get(item?.id)); }
function bookingColorPicker(name, selected, bookingId = '') {
  const labels = { auto:'Авто', mint:'Мята', sky:'Небо', lavender:'Лаванда', peach:'Персик', rose:'Роза', vanilla:'Ваниль' };
  const current = validBookingColor(selected);
  return `<fieldset class="booking-color-picker"><legend>Цвет записи</legend><div class="booking-color-options">${BOOKING_COLOR_KEYS.map(color => `<label class="booking-color-option color-${color}" title="${labels[color]}"><input type="radio" name="${name}" value="${color}" aria-label="${labels[color]}" ${color === current ? 'checked' : ''} ${bookingId ? `data-booking-color-id="${bookingId}"` : ''}><span aria-hidden="true"></span><small>${labels[color]}</small></label>`).join('')}</div></fieldset>`;
}
function compactBookingColorPicker(name, selected, bookingId) {
  const labels = { auto:'Авто', mint:'Мята', sky:'Небо', lavender:'Лаванда', peach:'Персик', rose:'Роза', vanilla:'Ваниль' };
  const current = validBookingColor(selected);
  return `<details class="booking-color-compact"><summary><span>Цвет записи</span><strong><i class="booking-color-dot color-${current}" aria-hidden="true"></i>${labels[current]}</strong></summary>${bookingColorPicker(name, current, bookingId)}</details>`;
}
function bookingSession(item) {
  const saved = bookingSessionItems.get(item.id);
  if (saved?.length) return saved.map(entry => ({
    kind:entry.item_kind || entry.kind,
    service_id:entry.service_id || '',
    title:String(entry.title || ''),
    duration_minutes:Number(entry.duration_minutes || 0),
    price_rub:Number(entry.price_rub || 0),
    extends_duration:entry.item_kind === 'primary' || entry.kind === 'primary' ? true : Boolean(entry.extends_duration)
  }));
  return [{
    kind:'primary',
    service_id:item.service_id,
    title:serviceName(item.services?.name || 'Основная услуга'),
    duration_minutes:Number(item.duration_minutes || item.services?.duration_minutes || 60),
    price_rub:Number(item.total_price_rub ?? item.original_price_rub ?? item.services?.price_rub ?? 0),
    extends_duration:true
  }];
}
function bookingSessionTotal(item) {
  return bookingSession(item).reduce((sum, entry) => sum + Number(entry.price_rub || 0), 0);
}
function bookingSessionDuration(items) {
  return items.reduce((sum, entry) => sum + (entry.kind === 'primary' || entry.extends_duration ? Number(entry.duration_minutes || 0) : 0), 0);
}
function bookingSessionMarkup(item) {
  const items = bookingSession(item);
  const addons = items.slice(1);
  const countLabel = `${items.length} ${items.length === 1 ? 'услуга' : items.length < 5 ? 'услуги' : 'услуг'}`;
  return `<section class="booking-session-summary"><div class="booking-session-heading"><div><small>Состав сеанса</small><strong>${countLabel} · ${bookingSessionDuration(items)} мин</strong></div><button type="button" data-edit-booking-session="${item.id}"><span>Изменить</span>${uiIcon('arrow-right')}</button></div>${addons.length ? `<div class="booking-session-addons"><small>Дополнительно</small>${addons.map(entry => `<div><span><b>${escapeHtml(entry.title)}</b><small>${entry.extends_duration ? `+${entry.duration_minutes} мин` : 'без увеличения времени'}</small></span><strong>+ ${money(entry.price_rub)}</strong></div>`).join('')}</div>` : ''}</section>`;
}
async function saveBookingColor(id, color, { rerender = true } = {}) {
  const selected = validBookingColor(color);
  bookingColors.set(id, selected);
  persistBookingColors();
  const item = allBookings.find(booking => booking.id === id);
  if (item) item.color_key = selected;
  if (rerender) renderBookingData();
  const { error } = await db.rpc('set_booking_color', { p_booking: id, p_color: selected });
  return !error;
}
async function saveBookingNote(id, note, { rerender = true } = {}) {
  const value = String(note || '').trim().slice(0, 1000);
  bookingNotes.set(id, value);
  persistBookingNotes();
  const item = allBookings.find(booking => booking.id === id);
  if (item) item.provider_note = value;
  if (rerender) renderBookingData();
  const { error } = await db.rpc('set_booking_note', { p_booking: id, p_note: value });
  if (error) pendingBookingNotes.add(id);
  else pendingBookingNotes.delete(id);
  persistBookingNotes();
  return !error;
}
async function loadRemoteBookingColors(userId, generation) {
  const { data, error } = await db.from('bookings').select('id,color_key,provider_note').eq('performer_id', userId);
  if (error || !sessionIsCurrent(userId, generation)) return false;
  (data || []).forEach(item => {
    bookingColors.set(item.id, validBookingColor(item.color_key));
    if (!pendingBookingNotes.has(item.id)) bookingNotes.set(item.id, String(item.provider_note || '').slice(0, 1000));
  });
  persistBookingColors(userId);
  persistBookingNotes(userId);
  return true;
}
function isScheduleBlock(item) {
  return String(item?.client_phone || '').replace(/\D/g, '') === SCHEDULE_BLOCK_PHONE;
}
function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}
function money(value) { return `${new Intl.NumberFormat('ru-RU').format(value)} ₽`; }
function serviceName(value) { return value === 'Общий массаж задней поверхности' ? 'Массаж задней поверхности тела' : value; }
function timelineServiceNameMarkup(value) {
  const name = serviceName(value || 'Услуга');
  const parts = name.split(/\s+—\s+/, 2);
  return `<span class="timeline-service-core">${escapeHtml(parts[0])}</span>${parts[1] ? `<span class="timeline-service-variant"> — ${escapeHtml(parts[1])}</span>` : ''}`;
}
function uiIcon(name, className = '') { return `<svg class="ui-icon${className ? ` ${className}` : ''}" aria-hidden="true"><use href="ui-icons.svg?v=128#icon-${name}"></use></svg>`; }
function notificationStorageKey(name) { return `massage-notifications-${currentUser?.id || 'guest'}-${name}`; }
function readNotificationStorage(name, fallback) {
  try { return JSON.parse(localStorage.getItem(notificationStorageKey(name))) || fallback; }
  catch { return fallback; }
}
function writeNotificationStorage(name, value) {
  try { localStorage.setItem(notificationStorageKey(name), JSON.stringify(value)); }
  catch { notify('Не удалось сохранить изменения в браузере'); }
}
function notificationTemplates() { return { ...defaultNotificationTemplates, ...readNotificationStorage('templates', {}), ...serverNotificationTemplates }; }
function composeNotificationMessage(type, item) {
  const date = new Date(`${item.booking_date}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  const tokens = {
    '{имя}': item.client_name || 'клиент',
    '{услуга}': serviceName(item.services?.name || 'Услуга'),
    '{дата}': date,
    '{время}': String(item.booking_time).slice(0, 5),
    '{адрес}': notificationAddress
  };
  return Object.entries(tokens).reduce((text, [token, value]) => text.split(token).join(value), notificationTemplates()[type] || defaultNotificationTemplates.reminder);
}
function whatsappLink(item, type = 'reminder') {
  if (isScheduleBlock(item)) return '';
  const phone = normalizePhone(item.client_phone);
  if (!phone) return '';
  return `https://wa.me/${phone}?text=${encodeURIComponent(composeNotificationMessage(type, item))}`;
}
function outcomeStorageKey() { return `massage-booking-outcomes-${currentUser?.id || 'guest'}`; }
function sessionItemsStorageKey(userId = currentUser?.id) { return `massage-booking-session-items-${userId || 'guest'}`; }
function autoCompleteStorageKey(userId = currentUser?.id) { return `massage-auto-complete-visits-${userId || 'guest'}`; }
function readLocalSessionItems(userId = currentUser?.id) {
  try { return JSON.parse(localStorage.getItem(sessionItemsStorageKey(userId)) || '{}'); }
  catch { return {}; }
}
function writeLocalSessionItems(userId = currentUser?.id) {
  try { localStorage.setItem(sessionItemsStorageKey(userId), JSON.stringify(Object.fromEntries(bookingSessionItems))); }
  catch {}
}
function readLocalOutcomes() {
  try { return JSON.parse(localStorage.getItem(outcomeStorageKey())) || {}; }
  catch { return {}; }
}
function writeLocalOutcomes() {
  try { localStorage.setItem(outcomeStorageKey(), JSON.stringify(Object.fromEntries(bookingOutcomes))); }
  catch { notify('Не удалось сохранить результат визита'); }
}
function bookingOutcome(item) { return bookingOutcomes.get(item.id) || { visit_status: 'scheduled', payment_method: 'unpaid', amount_rub: 0, actual_duration_minutes: 0, calculated_amount_rub: 0, completion_source: 'manual' }; }
function isPerMinuteBooking(item) { return Number(item?.services?.duration_minutes || 0) === 1; }
function bookingMinuteRate(item) { return Math.max(0, Number(item?.original_price_rub ?? item?.services?.price_rub ?? bookingSessionTotal(item)) || 0); }
function bookingCalculatedValue(item) {
  const outcome = bookingOutcome(item);
  return isPerMinuteBooking(item) && Number(outcome.calculated_amount_rub) > 0 ? Number(outcome.calculated_amount_rub) : bookingSessionTotal(item);
}
function bookingSessionEnd(item) {
  const time = String(item.booking_time || '00:00').slice(0, 5);
  const start = new Date(`${item.booking_date}T${time}:00+04:00`);
  const duration = Number(item.duration_minutes || item.services?.duration_minutes || 60);
  return new Date(start.getTime() + duration * 60000);
}
function bookingWillCompleteAutomatically(item) {
  return Boolean(bookingPolicy.auto_complete_visits)
    && !isScheduleBlock(item)
    && item.status !== 'cancelled'
    && bookingOutcome(item).visit_status === 'scheduled';
}
function automaticOutcomeHint(item) {
  if (!bookingWillCompleteAutomatically(item)) return '';
  return bookingSessionEnd(item) <= new Date() ? 'Учитывается автоматически' : 'Будет учтён автоматически';
}
function bookingIsCompleted(item) {
  if (isScheduleBlock(item)) return false;
  const outcome = bookingOutcome(item);
  if (outcome.visit_status === 'completed' || outcome.visit_status === 'no_show') return true;
  if (item.status !== 'confirmed') return false;
  const start = new Date(`${item.booking_date}T${String(item.booking_time).slice(0, 8)}`);
  return new Date(start.getTime() + Number(item.duration_minutes || item.services?.duration_minutes || 60) * 60000) < new Date();
}
function bookingStatus(item, long = false) {
  if (item.status === 'cancelled') return long ? 'Запись отменена' : 'Отменена';
  if (isScheduleBlock(item)) return long ? 'Время занято' : 'Занято';
  const outcome = bookingOutcome(item);
  if (outcome.visit_status === 'completed') return outcome.completion_source === 'auto' ? 'Состоялся автоматически' : 'Состоялся';
  if (outcome.visit_status === 'no_show') return 'Не пришёл';
  if (bookingIsCompleted(item)) return 'Ожидает отметки';
  if (item.status === 'confirmed') return 'Подтверждена';
  return long ? 'Новая запись' : 'Новая';
}
function bookingStatusClass(item) {
  if (item.status === 'cancelled') return 'cancelled';
  if (isScheduleBlock(item)) return 'block';
  const outcome = bookingOutcome(item);
  if (outcome.visit_status === 'completed') return 'visited';
  if (outcome.visit_status === 'no_show') return 'no-show';
  return bookingIsCompleted(item) ? 'needs-result' : item.status;
}
function paymentMethodLabel(method, completionSource = 'manual') {
  if (completionSource === 'auto' && method !== 'unpaid') return 'Оплачено';
  return ({ cash: 'Наличные', card: 'Карта', transfer: 'Перевод', unpaid: 'Не оплачено' })[method] || 'Не оплачено';
}
function outcomeVisitLabel(outcome) {
  if (outcome.visit_status === 'completed') return outcome.completion_source === 'auto' ? 'Состоялся автоматически' : 'Состоялся';
  if (outcome.visit_status === 'no_show') return 'Не пришёл';
  return 'Запланирован';
}
function outcomeSummary(item) {
  const outcome = bookingOutcome(item);
  if (outcome.visit_status === 'no_show') return 'Клиент не пришёл';
  if (outcome.visit_status !== 'completed') return '';
  const actualTime = isPerMinuteBooking(item) && outcome.actual_duration_minutes ? `${outcome.actual_duration_minutes} мин · ${money(bookingCalculatedValue(item))} · ` : '';
  return `${actualTime}${paymentMethodLabel(outcome.payment_method, outcome.completion_source)}${outcome.amount_rub ? ` · получено ${money(outcome.amount_rub)}` : ''}`;
}

function reportBookings() {
  const clientBookings = allBookings.filter(item => !isScheduleBlock(item));
  if (reportPeriod === 'all') return clientBookings;
  const today = parseLocalIsoDate(businessTodayIso());
  today.setHours(0, 0, 0, 0);
  const start = reportPeriod === 'month'
    ? new Date(today.getFullYear(), today.getMonth(), 1)
    : new Date(today.getTime() - 89 * 86400000);
  return clientBookings.filter(item => new Date(`${item.booking_date}T12:00:00`) >= start);
}

function renderAnalytics() {
  const holder = $('#reportServicesList');
  if (!holder) return;
  const items = reportBookings();
  const completed = items.filter(item => item.status !== 'cancelled' && bookingOutcome(item).visit_status === 'completed');
  const unpaid = completed.filter(item => bookingOutcome(item).payment_method === 'unpaid');
  const noShows = items.filter(item => item.status !== 'cancelled' && bookingOutcome(item).visit_status === 'no_show');
  const cancelled = items.filter(item => item.status === 'cancelled');
  const revenue = completed.reduce((sum, item) => sum + Number(bookingOutcome(item).amount_rub || 0), 0);
  const completedValue = completed.reduce((sum, item) => sum + bookingCalculatedValue(item), 0);
  $('#reportRevenue').textContent = money(revenue);
  $('#reportCompletedValue').textContent = money(completedValue);
  $('#reportCompleted').textContent = String(completed.length);
  $('#reportUnpaid').textContent = String(unpaid.length);
  $('#reportCancelled').textContent = String(cancelled.length);
  $('#reportNoShow').textContent = String(noShows.length);
  const grouped = new Map();
  completed.forEach(item => {
    const name = serviceName(item.services?.name || 'Услуга');
    const row = grouped.get(name) || { visits: 0, revenue: 0 };
    row.visits += 1;
    row.revenue += Number(bookingOutcome(item).amount_rub || 0);
    grouped.set(name, row);
  });
  const rows = [...grouped.entries()].sort((a, b) => b[1].revenue - a[1].revenue || b[1].visits - a[1].visits);
  holder.innerHTML = rows.length ? rows.map(([name, row]) => `<article class="report-service-row"><div><strong>${escapeHtml(name)}</strong><small>${row.visits} ${row.visits === 1 ? 'визит' : row.visits < 5 ? 'визита' : 'визитов'}</small></div><b>${money(row.revenue)}</b></article>`).join('') : '<div class="provider-empty compact-empty"><strong>Пока нет отмеченных визитов</strong><small>После приёма откройте запись и укажите результат и оплату.</small></div>';
}

function csvCell(value) {
  let text = String(value ?? '').replace(/\r?\n/g, ' ').trim();
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function exportBookingsCsv() {
  const header = ['Дата', 'Время', 'Клиент', 'Телефон', 'Услуга', 'Статус записи', 'Результат визита', 'Оплата', 'Получено, ₽', 'Стоимость услуги, ₽'];
  const rows = allBookings.map(item => {
    const outcome = bookingOutcome(item);
    const visit = outcome.visit_status === 'completed' ? 'Состоялся' : outcome.visit_status === 'no_show' ? 'Не пришёл' : 'Запланирован';
    const block = isScheduleBlock(item);
    return [item.booking_date, String(item.booking_time).slice(0, 5), item.client_name, block ? '' : item.client_phone, block ? 'Занятое время' : bookingSession(item).map(entry => entry.title).join(' + '), bookingStatus(item, true), block ? '—' : visit, block ? '—' : paymentMethodLabel(outcome.payment_method, outcome.completion_source), block ? 0 : (outcome.amount_rub || 0), block ? 0 : bookingSessionTotal(item)];
  });
  const csv = [header, ...rows].map(row => row.map(csvCell).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `записи-${businessTodayIso()}.csv`;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify('Отчёт скачан');
}
function notificationTaskKey(item, type) { return `${item.id}|${type}|${item.booking_date}|${String(item.booking_time).slice(0, 5)}`; }
function notificationMarks() { return { ...readNotificationStorage('marks', {}), ...serverNotificationMarks }; }
async function setNotificationMark(key, status) {
  const local = readNotificationStorage('marks', {});
  if (status) local[key] = status; else delete local[key];
  writeNotificationStorage('marks', local);
  if (!notificationSettingsRemoteAvailable || !currentUser) return false;
  const [bookingId, kind] = key.split('|');
  let error = null;
  if (status) {
    ({ error } = await db.from('notification_marks').upsert({ performer_id: currentUser.id, booking_id: bookingId, task_key: key, kind, status }, { onConflict: 'performer_id,task_key' }));
    if (!error) serverNotificationMarks[key] = status;
  } else {
    ({ error } = await db.from('notification_marks').delete().eq('performer_id', currentUser.id).eq('task_key', key));
    if (!error) delete serverNotificationMarks[key];
  }
  return !error;
}
function renderAutomaticNotifications() {
  const panel = $('#automaticNotificationPanel');
  const holder = $('#automaticNotificationList');
  if (!panel || !holder) return;
  panel.hidden = !notificationOutboxRemoteAvailable;
  if (!notificationOutboxRemoteAvailable) return;
  const statusLabels = {
    pending: 'Ожидает отправки',
    sending: 'Отправляется',
    sent: 'Доставлено',
    failed: 'Ошибка'
  };
  const activeCount = notificationOutbox.filter(item => item.status === 'pending' || item.status === 'sending').length;
  const failedCount = notificationOutbox.filter(item => item.status === 'failed').length;
  $('#automaticNotificationCount').textContent = failedCount ? `${failedCount} с ошибкой` : activeCount ? `${activeCount} в очереди` : 'Очередь обработана';
  if (!notificationOutbox.length) {
    holder.innerHTML = '<div class="provider-empty notification-empty"><span>↗</span><strong>Автоматических событий пока нет</strong><small>После новой записи здесь появится результат отправки сообщения мастеру.</small></div>';
    return;
  }
  holder.innerHTML = notificationOutbox.map(item => {
    const booking = allBookings.find(entry => entry.id === item.booking_id);
    const client = booking?.client_name || 'Новая запись';
    const service = booking ? serviceName(booking.services?.name || 'Услуга') : 'Уведомление о записи';
    const time = booking ? `${parseLocalIsoDate(booking.booking_date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} в ${String(booking.booking_time).slice(0, 5)}` : '';
    const error = item.status === 'failed'
      ? `<details class="notification-preview"><summary>Причина ошибки</summary><blockquote>${escapeHtml(item.last_error_code || 'delivery_failed')}${item.last_error ? `<br>${escapeHtml(item.last_error)}` : ''}</blockquote></details>`
      : '';
    const retry = item.status === 'failed'
      ? `<button class="notification-restore-button" type="button" data-retry-notification-outbox="${escapeHtml(item.id)}">Повторить</button>`
      : '';
    return `<article class="notification-card status-${escapeHtml(item.status)}">
      <span class="notification-card-icon">↗</span>
      <div class="notification-card-main"><div class="notification-card-head"><span>Telegram мастеру</span><b>${statusLabels[item.status] || escapeHtml(item.status)}</b></div><h3>${escapeHtml(client)}</h3><p>${escapeHtml(service)}${time ? ` · ${escapeHtml(time)}` : ''} · попыток: ${Number(item.attempts) || 0}</p>${error}</div>
      <div class="notification-card-actions">${retry}</div>
    </article>`;
  }).join('');
}
async function retryAutomaticNotification(id, button) {
  if (!requireWrites()) return;
  if (!notificationOutboxRemoteAvailable || !currentUser) return;
  button.disabled = true;
  button.textContent = 'Ставим в очередь…';
  const { error } = await db.rpc('retry_notification_outbox', { p_outbox: id });
  if (error) {
    button.disabled = false;
    button.textContent = 'Повторить';
    notify('Не удалось повторить отправку');
    return;
  }
  const item = notificationOutbox.find(entry => entry.id === id);
  if (item) {
    item.status = 'pending';
    item.last_error_code = null;
    item.last_error = null;
  }
  renderAutomaticNotifications();
  notify('Уведомление возвращено в серверную очередь');
  await loadBookingSettings();
}
function bookingStart(item) { return new Date(`${item.booking_date}T${String(item.booking_time).slice(0, 8)}`); }
function buildNotificationTasks() {
  const now = new Date();
  const tasks = [];
  allBookings.forEach(item => {
    if (isScheduleBlock(item)) return;
    const start = bookingStart(item);
    if (item.status === 'cancelled') {
      if (start > now) tasks.push({ item, type: 'cancellation', title: 'Сообщить об отмене', dueAt: new Date(), key: notificationTaskKey(item, 'cancellation') });
      return;
    }
    if (start <= now) return;
    const createdAt = item.created_at ? new Date(item.created_at) : new Date();
    tasks.push({ item, type: 'confirmation', title: 'Подтвердить запись', dueAt: createdAt, key: notificationTaskKey(item, 'confirmation') });
    tasks.push({ item, type: 'reminder', title: 'Напомнить за сутки', dueAt: new Date(start.getTime() - 24 * 3600000), key: notificationTaskKey(item, 'reminder') });
  });
  return tasks.sort((a, b) => a.dueAt - b.dueAt || bookingStart(a.item) - bookingStart(b.item));
}
function notificationDueLabel(task) {
  const now = new Date();
  if (task.dueAt <= now) return 'Сейчас';
  return `${task.dueAt.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}, ${task.dueAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
}
function renderNotificationTemplates() {
  const templates = notificationTemplates();
  if ($('#templateConfirmation')) $('#templateConfirmation').value = templates.confirmation;
  if ($('#templateReminder')) $('#templateReminder').value = templates.reminder;
  if ($('#templateCancellation')) $('#templateCancellation').value = templates.cancellation;
}
function renderNotifications() {
  const holder = $('#notificationList');
  if (!holder || !currentUser) return;
  renderAutomaticNotifications();
  const now = new Date();
  const nextDay = new Date(now.getTime() + 24 * 3600000);
  const marks = notificationMarks();
  const tasks = buildNotificationTasks().map(task => ({ ...task, mark: marks[task.key] || '', isDue: task.dueAt <= now }));
  const pending = tasks.filter(task => task.isDue && task.mark !== 'sent').length;
  const soon = tasks.filter(task => task.mark !== 'sent' && task.dueAt > now && task.dueAt <= nextDay).length;
  const sent = tasks.filter(task => task.mark === 'sent').length;
  $('#notificationPendingCount').textContent = String(pending);
  $('#notificationSoonCount').textContent = String(soon);
  $('#notificationSentCount').textContent = String(sent);
  $('#notificationCount').textContent = String(tasks.length);
  $('#notificationBadge').textContent = pending > 9 ? '9+' : String(pending);
  $('#notificationBadge').hidden = pending === 0;
  const filtered = tasks.filter(task => {
    if (notificationFilter === 'sent') return task.mark === 'sent';
    if (notificationFilter === 'pending') return task.isDue && task.mark !== 'sent';
    return true;
  });
  if (!filtered.length) {
    holder.innerHTML = `<div class="provider-empty notification-empty"><span class="provider-empty-icon">${uiIcon('check')}</span><strong>${notificationFilter === 'sent' ? 'Отправленных пока нет' : notificationFilter === 'all' ? 'Уведомлений пока нет' : 'Всё отправлено'}</strong><small>${notificationFilter === 'pending' ? 'Новых сообщений, требующих внимания, сейчас нет.' : 'Здесь появятся сообщения по записям клиентов.'}</small></div>`;
    return;
  }
  const typeLabels = { confirmation: 'Подтверждение', reminder: 'Напоминание', cancellation: 'Отмена' };
  holder.innerHTML = filtered.map(task => {
    const item = task.item;
    const start = bookingStart(item);
    const message = composeNotificationMessage(task.type, item);
    const link = escapeHtml(whatsappLink(item, task.type));
    const status = task.mark === 'sent' ? 'Отправлено' : task.isDue ? 'К отправке' : 'Позже';
    return `<article class="notification-card notification-${task.type} status-${task.mark || (task.isDue ? 'due' : 'scheduled')}">
      <span class="notification-card-icon">${uiIcon(task.type === 'cancellation' ? 'close' : task.type === 'reminder' ? 'clock' : 'check')}</span>
      <div class="notification-card-main"><div class="notification-card-head"><span>${typeLabels[task.type]}</span><b>${status}</b></div><h3>${escapeHtml(item.client_name)}</h3><p>${escapeHtml(serviceName(item.services?.name || 'Услуга'))} · ${start.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} в ${String(item.booking_time).slice(0, 5)} · ${notificationDueLabel(task)}</p><details class="notification-preview"><summary>Посмотреть текст</summary><blockquote>${escapeHtml(message).replace(/\n/g, '<br>')}</blockquote></details></div>
      <div class="notification-card-actions">${link ? `<a class="whatsapp-action" href="${link}" target="_blank" rel="noopener noreferrer" data-open-notification="${escapeHtml(task.key)}">Открыть WhatsApp</a>` : '<span class="notification-phone-error">Проверьте телефон</span>'}${task.mark === 'sent' ? `<button class="notification-restore-button" type="button" data-restore-notification="${escapeHtml(task.key)}">Вернуть</button>` : `<button class="notification-done-button" type="button" data-sent-notification="${escapeHtml(task.key)}" aria-label="Отметить отправленным" title="Отметить отправленным">${uiIcon('check')}</button>`}</div>
    </article>`;
  }).join('');
}
async function saveNotificationTemplates(event) {
  event.preventDefault();
  if (!requireWrites()) return;
  const templates = {
    confirmation: $('#templateConfirmation').value.trim() || defaultNotificationTemplates.confirmation,
    reminder: $('#templateReminder').value.trim() || defaultNotificationTemplates.reminder,
    cancellation: $('#templateCancellation').value.trim() || defaultNotificationTemplates.cancellation
  };
  writeNotificationStorage('templates', templates);
  let remoteSaved = false;
  if (notificationSettingsRemoteAvailable) {
    const { error } = await db.from('notification_templates').upsert({ performer_id: currentUser.id, ...templates }, { onConflict: 'performer_id' });
    remoteSaved = !error;
    if (remoteSaved) serverNotificationTemplates = templates;
  }
  renderNotificationTemplates();
  renderNotifications();
  $('#notificationTemplatesDialog').close();
  notify(remoteSaved ? 'Шаблоны сохранены на всех устройствах' : 'Шаблоны сохранены на этом устройстве');
}
function showFormError(id, message) { const element = $(id); element.textContent = message; element.hidden = false; }
function clearFormError(id) { $(id).hidden = true; }
function notify(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => { toast.hidden = true; }, 2800);
}
function setAuthTab(tab) {
  recoveryMode = false;
  $('#authTabs').hidden = false;
  $('#recoveryForm').hidden = true;
  $('#resetPasswordForm').hidden = true;
  $('#recoverySent').hidden = true;
  $$('[data-auth-tab]').forEach(button => button.classList.toggle('active', button.dataset.authTab === tab));
  $('#loginForm').hidden = tab !== 'login';
  $('#signupForm').hidden = tab !== 'signup';
  $('#authBadge').innerHTML = '<i></i> Личный кабинет';
  $('#authTitle').textContent = tab === 'login' ? 'Все записи под рукой.' : 'Создайте свой кабинет.';
  $('#authDescription').textContent = tab === 'login'
    ? 'Войдите или зарегистрируйтесь, чтобы управлять расписанием и услугами.'
    : 'Укажите данные исполнителя — после подтверждения почты можно принимать записи.';
}
function showRecoveryRequest() {
  recoveryMode = false;
  $('#authCard').hidden = false;
  $('#dashboard').hidden = true;
  $('#authTabs').hidden = true;
  $('#loginForm').hidden = true;
  $('#signupForm').hidden = true;
  $('#resetPasswordForm').hidden = true;
  $('#recoverySent').hidden = true;
  $('#recoveryForm').hidden = false;
  $('#authBadge').innerHTML = '<i></i> Восстановление доступа';
  $('#authTitle').textContent = 'Задайте новый пароль.';
  $('#authDescription').textContent = 'Введите email, с которым зарегистрирован кабинет исполнителя.';
  $('#recoveryEmail').value = $('#loginEmail').value.trim();
  setTimeout(() => $('#recoveryEmail').focus(), 0);
}
function showRecoveryReset() {
  recoveryMode = true;
  $('#authCard').hidden = false;
  $('#dashboard').hidden = true;
  $('#authTabs').hidden = true;
  $('#loginForm').hidden = true;
  $('#signupForm').hidden = true;
  $('#recoveryForm').hidden = true;
  $('#recoverySent').hidden = true;
  $('#resetPasswordForm').hidden = false;
  $('#authBadge').innerHTML = '<i></i> Новый пароль';
  $('#authTitle').textContent = 'Придумайте новый пароль.';
  $('#authDescription').textContent = 'Ссылка подтверждена. Осталось сохранить новый пароль для кабинета.';
  setTimeout(() => $('#recoveryNewPassword').focus(), 0);
}
function showRecoverySent() {
  $('#recoveryForm').hidden = true;
  $('#recoverySent').hidden = false;
  $('#authTitle').textContent = 'Проверьте почту.';
  $('#authDescription').textContent = 'Ссылка для восстановления доступа уже отправлена.';
}
function setProviderView(view) {
  $$('[data-provider-view]').forEach(button => button.classList.toggle('active', button.dataset.providerView === view));
  if (view === 'services' || view === 'organization' || view === 'portfolio' || view === 'settings' || view === 'analytics' || view === 'waitlist') $('.provider-mobile-nav [data-provider-view="more"]')?.classList.add('active');
  $$('[data-provider-panel]').forEach(panel => {
    const active = panel.dataset.providerPanel === view;
    panel.hidden = !active;
    panel.classList.toggle('active', active);
  });
  if (view === 'notifications') { renderNotificationTemplates(); renderNotifications(); }
  if (view === 'analytics') renderAnalytics();
  if (view === 'portfolio') { renderPortfolio(); renderProviderReviews(); }
  if (view === 'waitlist') renderWaitlist();
  if (view === 'organization') {
    if (organizationController.availability === null) organizationController.load();
    else organizationController.render();
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function setFilter(filter) {
  currentFilter = filter;
  try { localStorage.setItem(SCHEDULE_FILTER_KEY, currentFilter); } catch {}
  $$('[data-filter]').forEach(button => {
    const active = button.dataset.filter === filter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  updateJournalModeButtons();
  renderBookings();
}

function setJournalMode(mode) {
  journalMode = mode === 'list' ? 'list' : 'timeline';
  if (journalMode === 'timeline') currentFilter = 'day';
  localStorage.setItem(JOURNAL_MODE_KEY, journalMode);
  try { localStorage.setItem(SCHEDULE_FILTER_KEY, currentFilter); } catch {}
  $$('[data-filter]').forEach(button => {
    const active = button.dataset.filter === currentFilter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  updateJournalModeButtons();
  renderBookings();
}

function updateJournalModeButtons() {
  const modeToggle = $('.journal-mode-toggle');
  if (modeToggle) modeToggle.hidden = teamCalendarController?.isTeamMode || currentFilter !== 'day';
  $$('[data-journal-mode]').forEach(button => {
    const active = button.dataset.journalMode === journalMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function parseLocalIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) || localIsoDate(date) !== value ? null : date;
}

function restoreSelectedDate() {
  try {
    if (localStorage.getItem(SCHEDULE_FOLLOW_TODAY_KEY) === 'true') return businessTodayIso();
    const stored = localStorage.getItem(SCHEDULE_DATE_KEY);
    if (parseLocalIsoDate(stored)) return stored;
  } catch {}
  return businessTodayIso();
}

function restoreScheduleFilter() {
  try {
    const stored = localStorage.getItem(SCHEDULE_FILTER_KEY);
    if (['day', 'upcoming', 'all'].includes(stored)) return stored;
  } catch {}
  return 'day';
}

function rememberSelectedDate(followToday = selectedDate === businessTodayIso()) {
  try {
    localStorage.setItem(SCHEDULE_DATE_KEY, selectedDate);
    localStorage.setItem(SCHEDULE_FOLLOW_TODAY_KEY, String(followToday));
  } catch {}
}

function weekStartFor(date) {
  const start = new Date(date);
  const daysFromMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - daysFromMonday);
  return start;
}

function selectScheduleDate(value) {
  const date = parseLocalIsoDate(value);
  if (!date) return;
  selectedDate = localIsoDate(date);
  rememberSelectedDate();
  renderDateStrip();
  setFilter('day');
}

function shiftScheduleDate(days) {
  const date = parseLocalIsoDate(selectedDate) || parseLocalIsoDate(businessTodayIso());
  date.setDate(date.getDate() + days);
  selectScheduleDate(localIsoDate(date));
}

function refreshBusinessDay() {
  const today = businessTodayIso();
  if (today === renderedBusinessToday) return;
  renderedBusinessToday = today;
  try {
    if (localStorage.getItem(SCHEDULE_FOLLOW_TODAY_KEY) === 'true') {
      selectedDate = today;
      rememberSelectedDate(true);
    }
  } catch {}
  renderDateStrip();
  renderBookingData();
}

function renderDateStrip() {
  const todayIso = businessTodayIso();
  const today = parseLocalIsoDate(todayIso);
  const selected = parseLocalIsoDate(selectedDate) || today;
  const weekStart = weekStartFor(selected);
  const weekday = new Intl.DateTimeFormat('ru-RU', { weekday: 'short' });
  $('#dateStrip').innerHTML = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + index);
    const iso = localIsoDate(date);
    const label = iso === todayIso ? 'Сегодня' : weekday.format(date).replace('.', '');
    const fullDate = date.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    return `<button type="button" class="${iso === selectedDate ? 'active' : ''}" data-booking-date="${iso}" aria-label="${fullDate}" aria-pressed="${iso === selectedDate}"><span>${label}</span><strong>${date.getDate()}</strong><small>${date.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '')}</small></button>`;
  }).join('');
  const picker = $('#scheduleDatePicker');
  if (picker) picker.value = selectedDate;
  const active = $('#dateStrip [data-booking-date].active');
  if ($('#dateStrip').scrollWidth > $('#dateStrip').clientWidth) active?.scrollIntoView({ block: 'nearest', inline: 'center' });
}

function updateBookingStats() {
  const today = businessTodayIso();
  const active = allBookings.filter(item => item.status !== 'cancelled' && !isScheduleBlock(item));
  const todayCount = active.filter(item => item.booking_date === today).length;
  const upcomingCount = active.filter(item => item.booking_date >= today).length;
  $('#todayBookingsCount').textContent = String(todayCount);
  $('#newBookingsCount').textContent = String(upcomingCount);
  $('#newBookingsBadge').textContent = String(upcomingCount);
  $('#newBookingsBadge').hidden = upcomingCount === 0;
}

function filteredBookings() {
  const today = businessTodayIso();
  if (currentFilter === 'all') return allBookings;
  if (currentFilter === 'upcoming') return allBookings.filter(item => item.status !== 'cancelled' && item.booking_date >= today);
  return allBookings.filter(item => item.status !== 'cancelled' && item.booking_date === selectedDate);
}

function minutesFromTime(value) {
  const [hours, minutes] = String(value || '00:00').slice(0, 5).split(':').map(Number);
  return (hours * 60) + minutes;
}

function timeFromMinutes(value) {
  const normalized = ((Math.round(Number(value) || 0) % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

function timelineBounds(items) {
  const date = new Date(`${selectedDate}T12:00:00`);
  const weekday = ((date.getDay() + 6) % 7) + 1;
  const schedule = scheduleRows.find(row => Number(row.weekday) === weekday);
  let start = schedule?.enabled === false ? 10 * 60 : minutesFromTime(schedule?.start_time || '10:00');
  let end = schedule?.enabled === false ? 20 * 60 : minutesFromTime(schedule?.end_time || '20:00');
  items.forEach(item => {
    const itemStart = minutesFromTime(item.booking_time);
    const itemEnd = itemStart + Number(item.duration_minutes || item.services?.duration_minutes || 60);
    start = Math.min(start, Math.floor(itemStart / 60) * 60);
    end = Math.max(end, Math.ceil(itemEnd / 60) * 60);
  });
  if (end <= start) end = start + 60;
  return { start, end };
}

function scheduleStepForDate(dateIso) {
  const date = parseLocalIsoDate(dateIso);
  if (!date) return 5;
  const weekday = ((date.getDay() + 6) % 7) + 1;
  const row = scheduleRows.find(item => Number(item.weekday) === weekday);
  const step = Number(row?.slot_interval_minutes || 5);
  return Number.isInteger(step) && step >= 5 && step <= 60 ? step : 5;
}

function timelineTimeFromClick(stage, event) {
  const start = Number(stage.dataset.timelineStart);
  const end = Number(stage.dataset.timelineEnd);
  const rect = stage.getBoundingClientRect();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || rect.height <= 0) return '';
  const position = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
  const rawMinute = start + ((position / rect.height) * (end - start));
  const hourStart = Math.floor(rawMinute / 60) * 60;
  const latestHour = Math.floor((end - 1) / 60) * 60;
  const snapped = Math.max(start, Math.min(latestHour, hourStart));
  return `${String(Math.floor(snapped / 60)).padStart(2, '0')}:${String(snapped % 60).padStart(2, '0')}`;
}

function openTimelineBooking(stage, event) {
  if (!requireWrites()) return;
  if (selectedDate < businessTodayIso()) {
    notify('Нельзя создать запись в прошлом');
    return;
  }
  const time = timelineTimeFromClick(stage, event);
  if (!time) return;
  const selectedStart = new Date(`${selectedDate}T${time}:00`);
  if (selectedStart < new Date()) {
    notify('Это время уже прошло');
    return;
  }
  openNewBookingSheet(time);
}

function bookingClientNote(item) {
  return String(clientNotes.get(normalizePhone(item?.client_phone)) || '').trim();
}

function bookingDisplayNote(item) {
  return isScheduleBlock(item)
    ? String(item?.provider_note || bookingNotes.get(item?.id) || '').trim()
    : bookingClientNote(item);
}

function renderTimeline(items) {
  const holder = $('#providerBookings');
  const { start, end } = timelineBounds(items);
  const hourHeight = window.matchMedia('(max-width: 760px)').matches ? 60 : 76;
  const totalHeight = ((end - start) / 60) * hourHeight;
  const labels = [];
  const lines = [];
  for (let minute = start; minute <= end; minute += 60) {
    const label = `${String(Math.floor(minute / 60)).padStart(2, '0')}:00`;
    const top = ((minute - start) / 60) * hourHeight;
    labels.push(`<span class="timeline-hour" style="top:${top}px">${label}</span>`);
    if (minute + 30 < end) labels.push(`<span class="timeline-hour timeline-half-hour" style="top:${top + hourHeight / 2}px">${String(Math.floor(minute / 60)).padStart(2, '0')}:30</span>`);
    lines.push(`<i class="timeline-grid-line" style="top:${top}px" aria-hidden="true"></i>`);
  }
  const cards = items.map(item => {
    const itemStart = minutesFromTime(item.booking_time);
    const duration = Number(item.duration_minutes || item.services?.duration_minutes || 60);
    const startTime = String(item.booking_time).slice(0, 5);
    const endTime = timeFromMinutes(itemStart + duration);
    const timeRange = `${startTime}–${endTime}`;
    const minuteOnly = duration <= 1;
    const top = ((itemStart - start) / 60) * hourHeight;
    const height = Math.max(36, (duration / 60) * hourHeight - 4);
    const statusText = bookingStatus(item);
    const statusClass = bookingStatusClass(item);
    const compact = height < 44 ? ' compact' : '';
    const block = isScheduleBlock(item);
    const note = bookingDisplayNote(item);
    const visibleNote = displayPreferences.show_notes ? note : '';
    const visitText = block ? '' : bookingVisitSummaryText(item);
    const visitMarkup = block ? '' : bookingVisitSummaryMarkup(item, 'timeline-client-visit');
    const clientDetails = block ? 'Занятое время' : [item.client_name, displayPreferences.show_phone ? item.client_phone : '', visitText, `${duration} мин`].filter(Boolean).join(' · ');
    const clientDetailsMarkup = block
      ? 'Занятое время'
      : `<span class="timeline-client-name">${escapeHtml(item.client_name)}</span>${displayPreferences.show_phone ? `<span class="timeline-client-phone"> · ${escapeHtml(item.client_phone)}</span>` : ''}${visitMarkup ? `<span class="timeline-client-visit-wrap"> · ${visitMarkup}</span>` : ''}<span class="timeline-client-duration"> · ${duration} мин</span>`;
    const ariaDetails = visibleNote ? `${clientDetails}, заметка: ${visibleNote}` : clientDetails;
    const highlightClasses = block ? '' : clientHighlightClasses(item.client_phone);
    const badgeDetails = block || !displayPreferences.show_client_labels ? '' : clientBadgeText(item.client_phone);
    const timelineStatus = statusClass === 'visited'
      ? `<span class="timeline-booking-status timeline-booking-status-icon"><span aria-hidden="true">${uiIcon('check')}</span><span class="sr-only">Статус: ${escapeHtml(statusText)}</span></span>`
      : `<span class="timeline-booking-status">${escapeHtml(statusText)}</span>`;
    const serviceMarkup = block ? escapeHtml(item.client_name || 'Перерыв') : timelineServiceNameMarkup(item.services?.name || 'Услуга');
    const cardContent = minuteOnly
      ? `<span class="timeline-booking-time"><b>${startTime}</b><small>–${endTime}</small></span><span class="timeline-booking-copy timeline-booking-minute-copy"><strong>${serviceMarkup}</strong></span>`
      : `<span class="timeline-booking-time"><b>${startTime}</b><small>–${endTime}</small></span>
      <span class="timeline-booking-copy"><strong>${serviceMarkup}</strong><span class="timeline-booking-client-row"><small class="timeline-booking-client"><span class="timeline-mobile-time">${timeRange} · </span>${clientDetailsMarkup}</small></span>${block || !displayPreferences.show_client_labels ? '' : clientBadgeMarkup(item.client_phone, { limit:1 })}${visibleNote ? `<small class="timeline-booking-note"><b>Заметка:</b> ${escapeHtml(visibleNote)}</small>` : ''}</span>
      ${timelineStatus}`;
    return `<button class="timeline-booking status-${statusClass} color-${bookingColor(item)}${compact}${minuteOnly ? ' minute-only' : ''}${visibleNote ? ' has-note' : ''}${highlightClasses}" type="button" data-open-booking="${item.id}" style="top:${top + 2}px;height:${height}px" aria-label="${escapeHtml(block ? (item.client_name || 'Занятое время') : serviceName(item.services?.name || 'Услуга'))}, с ${startTime} до ${endTime}, ${escapeHtml(ariaDetails)}${badgeDetails ? `, метки клиента: ${escapeHtml(badgeDetails)}` : ''}, статус: ${escapeHtml(statusText)}">
      ${cardContent}
    </button>`;
  }).join('');
  holder.className = 'provider-bookings timeline-view';
  holder.innerHTML = `<div class="day-timeline" style="--timeline-height:${totalHeight}px;--half-hour-offset:${hourHeight / 2}px"><div class="timeline-hours">${labels.join('')}</div><div class="timeline-stage" data-create-booking-at data-timeline-start="${start}" data-timeline-end="${end}" aria-label="Нажмите на свободное время, чтобы создать запись">${lines.join('')}<span class="timeline-create-hint">${uiIcon('plus')} Нажмите на свободное время</span>${cards || `<div class="timeline-empty-state"><span>${uiIcon('plus')}</span><strong>День свободен</strong><small>Нажмите на нужное время, чтобы записать клиента или поставить перерыв</small></div>`}</div></div>`;
}

function renderBookingList(items) {
  const holder = $('#providerBookings');
  holder.className = 'provider-bookings schedule-list';
  if (!items.length) {
    holder.innerHTML = `<div class="provider-empty schedule-empty"><span class="provider-empty-icon">${uiIcon('check')}</span><strong>Записей нет</strong><small>На выбранный период всё свободно.</small></div>`;
    return;
  }
  const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', weekday: 'short' });
  holder.innerHTML = items.map(item => {
    const itemDate = new Date(`${item.booking_date}T12:00:00`);
    const time = String(item.booking_time).slice(0, 5);
    const duration = Number(item.duration_minutes || item.services?.duration_minutes || 60);
    const endTime = timeFromMinutes(minutesFromTime(time) + duration);
    const statusText = bookingStatus(item);
    const statusClass = bookingStatusClass(item);
    const phone = escapeHtml(String(item.client_phone || ''));
    const resultSummary = outcomeSummary(item);
    const block = isScheduleBlock(item);
    const note = bookingDisplayNote(item);
    const visibleNote = displayPreferences.show_notes ? note : '';
    const visitMarkup = block ? '' : bookingVisitSummaryMarkup(item);
    const title = block ? (item.client_name || 'Перерыв') : serviceName(item.services?.name || 'Услуга');
    const details = block ? `Занятое время · ${duration} мин` : [item.client_name, displayPreferences.show_phone ? item.client_phone : '', bookingVisitSummaryText(item)].filter(Boolean).join(', ');
    return `<article class="provider-booking status-${statusClass} color-${bookingColor(item)}${block ? '' : clientHighlightClasses(item.client_phone)}">
      <button class="provider-booking-open" type="button" data-open-booking="${item.id}" aria-label="${escapeHtml(title)}, с ${time} до ${endTime}, ${escapeHtml(details)}. Открыть подробности">
        <span class="booking-time-column"><strong>${time}<small>до ${endTime}</small></strong><span>${dateFormat.format(itemDate)}</span></span>
        <span class="booking-main"><span class="provider-booking-top"><h3>${escapeHtml(title)}</h3><span class="booking-status">${statusText}</span></span>
        ${block ? `<span class="provider-booking-client-line"><strong>Занятое время</strong><span>${duration} мин</span></span>` : `<span class="provider-booking-client-line"><span class="booking-client-name-row"><strong>${escapeHtml(item.client_name)}</strong>${displayPreferences.show_client_labels ? clientBadgeMarkup(item.client_phone, { limit:1 }) : ''}</span>${displayPreferences.show_phone ? `<span class="provider-booking-phone">${phone}</span>` : ''}${visitMarkup}</span>`}
        <span class="provider-booking-signals">${visibleNote ? `<span class="provider-booking-note-full"><b>Заметка:</b> ${escapeHtml(visibleNote)}</span>` : ''}${Number(item.deposit_amount_rub || 0) > 0 ? `<span class="booking-prepayment-badge status-${escapeHtml(item.payment_status)}">${item.payment_status === 'paid' ? 'Оплачено' : item.payment_status === 'refunded' ? 'Возврат' : 'Ждёт оплаты'}</span>` : ''}${resultSummary ? `<span class="booking-outcome-summary">${escapeHtml(resultSummary)}</span>` : ''}</span></span>
        <span class="provider-booking-chevron" aria-hidden="true">›</span>
      </button>
    </article>`;
  }).join('');
}

function openBookingSheet(id) {
  const item = allBookings.find(booking => booking.id === id);
  if (!item) return;
  const date = new Date(`${item.booking_date}T12:00:00`);
  const duration = Number(item.duration_minutes || item.services?.duration_minutes || 60);
  const statusText = bookingStatus(item, true);
  const statusClass = bookingStatusClass(item);
  const phone = escapeHtml(String(item.client_phone || '').replace(/[^+\d]/g, ''));
  const whatsapp = escapeHtml(whatsappLink(item));
  const note = bookingDisplayNote(item);
  const outcome = bookingOutcome(item);
  const minuteRate = bookingMinuteRate(item);
  const actualMinutes = Number(outcome.actual_duration_minutes || 0);
  const calculatedAmount = Number(outcome.calculated_amount_rub || (actualMinutes ? actualMinutes * minuteRate : bookingSessionTotal(item)));
  const amount = Number(outcome.amount_rub || calculatedAmount);
  $('#bookingSheet').classList.remove('booking-sheet-wide');
  applyClientHighlightClasses($('#bookingSheet'), isScheduleBlock(item) ? '' : item.client_phone, 'booking-sheet-');
  if (isScheduleBlock(item)) {
    $('#bookingSheetContent').innerHTML = `<small class="booking-sheet-kicker">${date.toLocaleDateString('ru-RU', { day:'numeric', month:'long', weekday:'long' })}</small>
      <h2 id="bookingSheetTitle">${escapeHtml(item.client_name || 'Перерыв')}</h2>
      <div class="booking-sheet-meta"><strong>${String(item.booking_time).slice(0, 5)}</strong><span>${duration} минут</span><span class="booking-status status-block">Занято</span></div>
      <div class="booking-sheet-block"><span>◼</span><div><small>Блокировка времени</small><strong>Клиенты не смогут записаться на этот интервал.</strong></div></div>
      ${bookingColorPicker(`bookingColor-${item.id}`, bookingColor(item), item.id)}
      <details class="booking-sheet-disclosure booking-note-disclosure" ${note ? 'open' : ''}>
        <summary><div><small>О перерыве</small><strong>Заметка</strong></div><span class="booking-note-state">${note ? 'Добавлена' : 'Добавить'}</span></summary>
        <form class="booking-sheet-note-editor" id="bookingBlockNoteForm" data-booking-id="${item.id}">
          <label class="sr-only" for="bookingBlockNote">Заметка к перерыву</label><textarea id="bookingBlockNote" maxlength="1000" rows="2" placeholder="Например, обед или личное дело">${escapeHtml(note)}</textarea>
          <button class="secondary-button" type="submit">Сохранить заметку</button>
        </form>
      </details>
      ${item.status !== 'cancelled' ? `<div class="booking-sheet-actions"><button class="primary" type="button" data-edit-booking="${item.id}">Изменить</button><button class="secondary-button danger" type="button" data-booking-status="cancelled" data-booking-id="${item.id}">Освободить время</button></div>` : ''}
      <div class="booking-delete-zone"><button class="booking-delete-action" type="button" data-delete-booking="${item.id}">Удалить время навсегда</button></div>`;
    $('#bookingSheet').hidden = false;
    document.body.classList.add('booking-sheet-open');
    $('#bookingBlockNoteForm')?.addEventListener('submit', saveBookingBlockNote);
    return;
  }
  $('#bookingSheetContent').innerHTML = `<small class="booking-sheet-kicker">${date.toLocaleDateString('ru-RU', { day:'numeric', month:'long', weekday:'long' })}</small>
    <h2 id="bookingSheetTitle">${escapeHtml(serviceName(item.services?.name || 'Услуга'))}</h2>
    <div class="booking-sheet-meta"><strong>${String(item.booking_time).slice(0, 5)}</strong><span>${duration} минут</span><span class="booking-status status-${statusClass}">${statusText}</span></div>
    <div class="booking-sheet-summary"><div class="booking-sheet-client"><span>${escapeHtml(String(item.client_name || 'Клиент').slice(0, 1).toUpperCase())}</span><div><small>Клиент</small><div class="booking-sheet-client-name"><strong>${escapeHtml(item.client_name)}</strong>${clientBadgeMarkup(item.client_phone, { limit:3, showLabels:true })}</div><a href="tel:${phone}">${escapeHtml(item.client_phone)}</a></div></div><div class="booking-sheet-price"><small>${isPerMinuteBooking(item) ? 'Тариф' : 'Стоимость'}</small><strong>${isPerMinuteBooking(item) ? `${money(minuteRate)}/мин` : money(bookingSessionTotal(item))}</strong></div></div>
    ${bookingSessionMarkup(item)}
    ${bookingClientLabelsMarkup(item.client_phone, item.id)}
    ${compactBookingColorPicker(`bookingColor-${item.id}`, bookingColor(item), item.id)}
    <details class="booking-sheet-disclosure booking-note-disclosure" ${note ? 'open' : ''}>
      <summary><div><small>О клиенте</small><strong>Заметка</strong></div><span class="booking-note-state">${note ? 'Добавлена' : 'Добавить'}</span></summary>
      <form class="booking-sheet-note-editor" id="bookingSheetNoteForm" data-client-phone="${escapeHtml(normalizePhone(item.client_phone))}">
        <label class="sr-only" for="bookingSheetClientNote">Заметка о клиенте</label><textarea id="bookingSheetClientNote" maxlength="1000" rows="2" placeholder="Пожелания, особенности или важная информация">${escapeHtml(note)}</textarea>
        <button class="secondary-button" type="submit">Сохранить заметку</button>
      </form>
    </details>
    ${Number(item.deposit_amount_rub || 0) > 0 ? `<form class="booking-prepayment-form" id="bookingPrepaymentForm" data-booking-id="${item.id}"><div><small>До визита</small><h3>Предоплата ${money(item.deposit_amount_rub)}</h3></div><label>Статус<select id="bookingPrepaymentStatus"><option value="pending" ${item.payment_status === 'pending' ? 'selected' : ''}>Ожидается</option><option value="paid" ${item.payment_status === 'paid' ? 'selected' : ''}>Оплачено</option><option value="refunded" ${item.payment_status === 'refunded' ? 'selected' : ''}>Возвращено</option></select></label><button class="secondary-button" type="submit">Сохранить предоплату</button></form>` : ''}
    ${item.status !== 'cancelled' ? `<details class="booking-sheet-disclosure booking-outcome-disclosure" ${outcome.visit_status === 'scheduled' ? '' : 'open'}><summary><div><small>После визита</small><strong>Результат и оплата</strong></div><span>${uiIcon(outcome.visit_status === 'completed' ? 'check' : outcome.visit_status === 'no_show' ? 'close' : 'clock')}${automaticOutcomeHint(item) || outcomeVisitLabel(outcome)}</span></summary><form class="booking-outcome-form" id="bookingOutcomeForm" data-booking-id="${item.id}" data-minute-rate="${minuteRate}"><label>Результат визита<select id="outcomeVisitStatus"><option value="scheduled" ${outcome.visit_status === 'scheduled' ? 'selected' : ''}>Запланирован</option><option value="completed" ${outcome.visit_status === 'completed' ? 'selected' : ''}>Состоялся</option><option value="no_show" ${outcome.visit_status === 'no_show' ? 'selected' : ''}>Не пришёл</option></select></label><div id="outcomePaymentFields" ${outcome.visit_status === 'completed' ? '' : 'hidden'}>${isPerMinuteBooking(item) ? `<div class="booking-minute-calculator"><label>Фактическое время, мин<input id="outcomeActualMinutes" type="number" min="1" max="1440" step="1" value="${actualMinutes || ''}" placeholder="Например, 37" required></label><div><small>Расчёт</small><strong id="outcomeCalculatedAmount">${actualMinutes ? `${actualMinutes} × ${money(minuteRate)} = ${money(calculatedAmount)}` : `Укажите минуты · ${money(minuteRate)}/мин`}</strong></div></div>` : ''}<div class="booking-outcome-payment"><label>Оплата<select id="outcomePaymentMethod"><option value="unpaid" ${outcome.payment_method === 'unpaid' ? 'selected' : ''}>Не оплачено</option><option value="cash" ${outcome.payment_method === 'cash' ? 'selected' : ''}>Наличные</option><option value="transfer" ${outcome.payment_method === 'transfer' ? 'selected' : ''}>Перевод</option><option value="card" ${outcome.payment_method === 'card' ? 'selected' : ''}>Карта</option></select></label><label>Получено, ₽<input id="outcomeAmount" type="number" min="0" max="1000000" step="1" value="${amount}"></label></div></div><button class="primary" type="submit">Сохранить результат</button></form></details>` : ''}
    ${item.status !== 'cancelled' && !bookingIsCompleted(item) ? `<div class="booking-sheet-actions">${whatsapp ? `<a class="secondary-button whatsapp-action" href="${whatsapp}" target="_blank" rel="noopener noreferrer">WhatsApp</a>` : ''}${item.status === 'new' ? `<button class="primary" type="button" data-booking-status="confirmed" data-booking-id="${item.id}">Подтвердить</button>` : ''}<button class="secondary-button" type="button" data-edit-booking="${item.id}">Перенести</button></div>` : ''}
    <div class="booking-delete-zone"><button class="booking-delete-action" type="button" data-delete-booking="${item.id}">Удалить запись</button></div>`;
  $('#bookingSheet').hidden = false;
  document.body.classList.add('booking-sheet-open');
  if (outcome.completion_source === 'auto' && outcome.payment_method === 'cash') $('#outcomePaymentMethod option[value="cash"]').textContent = 'Оплачено';
  $('#bookingOutcomeForm')?.addEventListener('submit', saveBookingOutcome);
  $('#bookingPrepaymentForm')?.addEventListener('submit', savePrepaymentStatus);
  $('#bookingSheetNoteForm')?.addEventListener('submit', saveBookingSheetNote);
  $('#outcomeVisitStatus')?.addEventListener('change', toggleOutcomePaymentFields);
  $('#outcomeActualMinutes')?.addEventListener('input', updateOutcomeMinuteCalculation);
  $('#outcomePaymentMethod')?.addEventListener('change', updateOutcomeMinuteCalculation);
  toggleOutcomePaymentFields();
  updateOutcomeMinuteCalculation();
}

async function saveBookingBlockNote(event) {
  event.preventDefault();
  if (!requireWrites()) return;
  const id = event.currentTarget.dataset.bookingId;
  const note = $('#bookingBlockNote')?.value.trim() || '';
  const button = event.submitter;
  button.disabled = true;
  button.textContent = 'Сохраняем…';
  const remoteSaved = await saveBookingNote(id, note);
  button.disabled = false;
  button.textContent = 'Сохранить заметку';
  const state = $('.booking-note-state');
  if (state) state.textContent = note ? 'Добавлена' : 'Добавить';
  notify(remoteSaved
    ? (note ? 'Заметка сохранена' : 'Заметка удалена')
    : 'Заметка сохранена на этом устройстве');
}

async function saveBookingSheetNote(event) {
  event.preventDefault();
  if (!requireWrites()) return;
  const userId = currentUser.id;
  const generation = sessionGeneration;
  const phone = normalizePhone(event.currentTarget.dataset.clientPhone);
  const note = $('#bookingSheetClientNote').value.trim();
  const button = event.submitter;
  button.disabled = true;
  button.textContent = 'Сохраняем…';
  const { error } = await db.from('client_notes').upsert({ performer_id: userId, client_phone: phone, note, updated_at: new Date().toISOString() });
  if (!sessionIsCurrent(userId, generation)) return;
  button.disabled = false;
  button.textContent = 'Сохранить заметку';
  if (error) { notify('Не удалось сохранить заметку'); return; }
  clientNotes.set(phone, note);
  const noteState = $('.booking-note-state');
  if (noteState) noteState.textContent = note ? 'Добавлена' : 'Добавить';
  notify('Заметка сохранена');
}

function serviceOptions(selectedId, activeOnly = false) {
  const services = activeOnly ? ownServices.filter(item => item.active) : ownServices;
  return services.map(item => `<option value="${item.id}" ${item.id === selectedId ? 'selected' : ''}>${escapeHtml(serviceName(item.name))} · ${item.duration_minutes} мин · ${money(item.price_rub)}</option>`).join('');
}

function blockDurationOptions(selectedId, activeOnly = false) {
  const selected = ownServices.find(item => item.id === selectedId);
  const source = activeOnly ? ownServices.filter(item => item.active) : ownServices;
  const byDuration = new Map();
  source.forEach(item => {
    const duration = Number(item.duration_minutes || 60);
    if (!byDuration.has(duration)) byDuration.set(duration, item);
  });
  if (selected) byDuration.set(Number(selected.duration_minutes || 60), selected);
  return [...byDuration.entries()].sort(([a], [b]) => a - b).map(([duration, item]) => `<option value="${item.id}" ${item.id === selectedId ? 'selected' : ''}>${duration} минут</option>`).join('');
}

function durationOptions(selected) {
  const durations = [...new Set([1, 5, 10, 20, 30, 40, 60, 90, 120, 180, Number(selected)])].filter(value => value >= 1 && value <= 480).sort((a, b) => a - b);
  return durations.map(value => `<option value="${value}" ${value === Number(selected) ? 'selected' : ''}>${value === 1 ? '1 мин (цена за минуту)' : `${value} мин`}</option>`).join('');
}

function openServiceEditor(id) {
  const item = ownServices.find(service => service.id === id);
  if (!item) return;
  $('#bookingSheet').classList.remove('booking-sheet-wide');
  $('#bookingSheetContent').innerHTML = `<small class="booking-sheet-kicker">Редактирование услуги</small><h2 id="bookingSheetTitle">Настройте услугу</h2>
    <form class="booking-editor-form service-edit-form" id="serviceEditForm" data-service-id="${item.id}">
      <label>Название услуги<input id="editServiceName" maxlength="120" value="${escapeHtml(item.name)}" required></label>
      <div class="service-edit-row"><label>Длительность<select id="editServiceDuration" required>${durationOptions(item.duration_minutes)}</select></label><label>Цена, ₽<input id="editServicePrice" type="number" min="0" max="1000000" step="1" value="${item.price_rub}" required></label></div>
      <label class="service-visibility-option"><input id="editServiceActive" type="checkbox" ${item.active ? 'checked' : ''}><span><strong>Показывать в онлайн-записи</strong><small>${item.active ? 'Клиенты могут выбрать эту услугу' : 'Сейчас услуга скрыта от клиентов'}</small></span></label>
      <p class="form-error" id="serviceEditError" hidden></p>
      <div class="service-edit-actions"><button class="secondary-button" type="button" data-close-booking-sheet>Отмена</button><button class="primary" type="submit">Сохранить изменения</button></div>
    </form>`;
  $('#bookingSheet').hidden = false;
  document.body.classList.add('booking-sheet-open');
  $('#serviceEditForm').addEventListener('submit', saveServiceChanges);
  setTimeout(() => $('#editServiceName')?.focus(), 0);
}

async function saveServiceChanges(event) {
  event.preventDefault();
  if (!requireWrites()) return;
  clearFormError('#serviceEditError');
  const id = event.currentTarget.dataset.serviceId;
  const name = $('#editServiceName').value.trim();
  const duration = Number($('#editServiceDuration').value);
  const price = Number($('#editServicePrice').value);
  const active = $('#editServiceActive').checked;
  if (name.length < 2 || !Number.isFinite(duration) || duration < 1 || duration > 480 || !Number.isFinite(price) || price < 0) {
    showFormError('#serviceEditError', 'Проверьте название, длительность и цену.');
    return;
  }
  const button = event.submitter;
  button.disabled = true;
  button.textContent = 'Сохраняем…';
  const { error } = await db.from('services').update({ name, duration_minutes: duration, price_rub: Math.round(price), active }).eq('id', id).eq('performer_id', currentUser.id);
  if (error) {
    button.disabled = false;
    button.textContent = 'Сохранить изменения';
    showFormError('#serviceEditError', 'Не удалось сохранить услугу. Попробуйте ещё раз.');
    return;
  }
  closeBookingSheet();
  await refreshAfterWrite();
  notify('Услуга обновлена');
}

async function loadBookingEditSlots(id, preserveCurrent = false) {
  const item = allBookings.find(booking => booking.id === id);
  const service = $('#editBookingService')?.value;
  const date = $('#editBookingDate')?.value;
  const holder = $('#editBookingTimes');
  if (!item || !service || !date || !holder) return;
  if (!preserveCurrent) bookingEditTime = '';
  holder.innerHTML = '<span>Ищем свободное время…</span>';
  const { data, error } = await db.rpc('get_available_slots', { p_service: service, p_start: date, p_end: date, p_ignore_booking: item.id });
  if (error || !data?.length) {
    holder.innerHTML = '<span>На эту дату свободного времени нет</span>';
    return;
  }
  const times = data.map(slot => String(slot.booking_time).slice(0, 5));
  if (preserveCurrent && service === item.service_id && date === item.booking_date && times.includes(String(item.booking_time).slice(0, 5))) bookingEditTime = String(item.booking_time).slice(0, 5);
  holder.innerHTML = times.map(time => `<button type="button" class="${time === bookingEditTime ? 'active' : ''}" data-edit-booking-time="${time}">${time}</button>`).join('');
}

function sessionServiceOptions(selectedId = '', allowCustom = false) {
  const custom = allowCustom ? `<option value="" ${selectedId ? '' : 'selected'}>Произвольная услуга</option>` : '';
  return `${custom}${ownServices.map(service => `<option value="${service.id}" ${service.id === selectedId ? 'selected' : ''}>${escapeHtml(serviceName(service.name))}</option>`).join('')}`;
}

function sessionConflict(item, items) {
  const start = minutesFromTime(item.booking_time);
  const duration = bookingSessionDuration(items);
  const end = start + duration;
  const conflict = allBookings
    .filter(other => other.id !== item.id && other.status !== 'cancelled' && other.booking_date === item.booking_date)
    .map(other => ({ item:other, start:minutesFromTime(other.booking_time), end:minutesFromTime(other.booking_time) + Number(other.duration_minutes || other.services?.duration_minutes || 60) }))
    .filter(other => start < other.end && end > other.start)
    .sort((a, b) => a.start - b.start)[0];
  if (!conflict) return null;
  return { time:String(conflict.item.booking_time).slice(0, 5), extra:Math.max(0, duration - Number(item.duration_minutes || 0)) };
}

function sessionComposerItemMarkup(entry, index) {
  const addon = entry.kind === 'addon';
  const service = ownServices.find(item => item.id === entry.service_id);
  const minutePrice = Number(service?.duration_minutes) === 1 ? Number(service.price_rub) : null;
  const price = minutePrice !== null ? minutePrice : entry.price_rub;
  return `<article class="session-composer-item" data-session-item="${index}"><div class="session-composer-item-head"><strong>${addon ? `Дополнительная услуга ${index}` : 'Основная услуга'}</strong>${addon ? `<button type="button" data-remove-session-item="${index}" aria-label="Удалить дополнительную услугу">${uiIcon('trash')}</button>` : ''}</div><label>${addon ? 'Источник' : 'Услуга из каталога'}<select data-session-service ${addon ? '' : 'required'}>${sessionServiceOptions(entry.service_id, addon)}</select></label>${addon ? `<label>Название<input data-session-title maxlength="120" value="${escapeHtml(entry.title)}" required></label>` : `<input data-session-title type="hidden" value="${escapeHtml(entry.title)}">`}<div class="session-composer-fields"><label>Длительность, мин<input data-session-duration type="number" min="${addon ? 0 : 5}" max="480" step="1" value="${entry.duration_minutes}" required></label><label>Стоимость, ₽<input data-session-price type="number" min="0" max="1000000" step="1" value="${price}" required></label></div>${addon ? `<label class="session-duration-toggle"><input data-session-extends type="checkbox" ${entry.extends_duration ? 'checked' : ''}><span><strong>Увеличивает продолжительность сеанса</strong><small>Если выключено, услуга добавится только к стоимости.</small></span></label>` : ''}</article>`;
}

function readSessionComposerDraft() {
  return $$('.session-composer-item').map((card, index) => {
    const serviceId = card.querySelector('[data-session-service]').value;
    const service = ownServices.find(item => item.id === serviceId);
    const duration = Math.round(Number(card.querySelector('[data-session-duration]').value) || 0);
    const enteredPrice = Math.max(0, Math.round(Number(card.querySelector('[data-session-price]').value) || 0));
    const price = Number(service?.duration_minutes) === 1 ? Math.max(0, Math.round(duration * enteredPrice)) : enteredPrice;
    return {
      kind:index === 0 ? 'primary' : 'addon',
      service_id:serviceId,
      title:card.querySelector('[data-session-title]').value.trim(),
      duration_minutes:duration,
      price_rub:price,
      extends_duration:index === 0 || Boolean(card.querySelector('[data-session-extends]')?.checked)
    };
  });
}

function updateSessionComposerSummary(id) {
  const item = allBookings.find(booking => booking.id === id);
  if (!item) return;
  sessionComposerDraft = readSessionComposerDraft();
  const total = sessionComposerDraft.reduce((sum, entry) => sum + entry.price_rub, 0);
  const duration = bookingSessionDuration(sessionComposerDraft);
  $('#sessionComposerTotal').textContent = money(total);
  $('#sessionComposerDuration').textContent = `${duration} мин`;
  const conflict = sessionConflict(item, sessionComposerDraft);
  const warning = $('#sessionComposerWarning');
  const button = $('#sessionComposerSave');
  warning.hidden = !conflict;
  if (conflict) warning.textContent = `${conflict.extra ? `Дополнительные ${conflict.extra} минут` : `Сеанс длительностью ${duration} минут`} пересекаются со следующей записью в ${conflict.time}.`;
  button.disabled = Boolean(conflict) || duration < 5 || sessionComposerDraft.some(entry => entry.title.length < 2);
}

function renderSessionComposer(id) {
  const item = allBookings.find(booking => booking.id === id);
  if (!item) return;
  $('#bookingSheetContent').innerHTML = `<div class="booking-editor-heading"><button class="booking-editor-back" type="button" data-back-booking="${item.id}">${uiIcon('arrow-left')}<span>К записи</span></button><small class="booking-sheet-kicker">Только для этой записи</small></div><h2 id="bookingSheetTitle">Состав сеанса</h2><p class="session-composer-lead">Каталог услуг не изменится. Здесь настраивается только этот визит.</p><form class="session-composer" id="sessionComposerForm" data-booking-id="${item.id}"><div id="sessionComposerItems">${sessionComposerDraft.map(sessionComposerItemMarkup).join('')}</div><button class="session-add-button" type="button" data-add-session-item>${uiIcon('plus')}<span>Дополнительная услуга</span></button><p class="session-composer-warning" id="sessionComposerWarning" role="alert" hidden></p><div class="session-composer-summary"><span><small>Продолжительность</small><strong id="sessionComposerDuration">0 мин</strong></span><span><small>Итого</small><strong id="sessionComposerTotal">0 ₽</strong></span></div><p class="form-error" id="sessionComposerError" hidden></p><button class="primary" id="sessionComposerSave" type="submit">Сохранить состав</button></form>`;
  $('#sessionComposerForm').addEventListener('submit', saveBookingSession);
  updateSessionComposerSummary(id);
}

function openSessionComposer(id) {
  const item = allBookings.find(booking => booking.id === id);
  if (!item || isScheduleBlock(item)) return;
  sessionComposerDraft = bookingSession(item).map(entry => ({ ...entry }));
  $('#bookingSheet').classList.remove('booking-sheet-wide');
  renderSessionComposer(id);
}

async function saveBookingSession(event) {
  event.preventDefault();
  if (!requireWrites()) return;
  const item = allBookings.find(booking => booking.id === event.currentTarget.dataset.bookingId);
  if (!item) return;
  clearFormError('#sessionComposerError');
  sessionComposerDraft = readSessionComposerDraft();
  const conflict = sessionConflict(item, sessionComposerDraft);
  if (conflict) { updateSessionComposerSummary(item.id); return; }
  const totalPrice = sessionComposerDraft.reduce((sum, entry) => sum + entry.price_rub, 0);
  const totalDuration = bookingSessionDuration(sessionComposerDraft);
  if (totalDuration < 5 || totalDuration > 480 || totalPrice > 10000000 || sessionComposerDraft.some(entry => entry.title.length < 2)) {
    showFormError('#sessionComposerError', 'Проверьте названия, длительность и стоимость услуг.');
    return;
  }
  const button = event.submitter;
  button.disabled = true;
  button.textContent = 'Сохраняем…';
  let remoteSaved = false;
  if (sessionItemsRemoteAvailable) {
    const { error } = await db.rpc('save_booking_session', { p_booking:item.id, p_items:sessionComposerDraft });
    if (error?.message?.includes('session_overlap:')) {
      const time = error.message.split('session_overlap:')[1]?.slice(0, 5) || 'следующей записью';
      showFormError('#sessionComposerError', `Сеанс пересекается со следующей записью в ${time}.`);
      button.disabled = false;
      button.textContent = 'Сохранить состав';
      return;
    }
    if (error && !/save_booking_session|schema cache|could not find/i.test(error.message || '')) {
      button.disabled = false;
      button.textContent = 'Сохранить состав';
      showFormError('#sessionComposerError', 'Не удалось проверить состав сеанса. Изменения не сохранены.');
      return;
    }
    remoteSaved = !error;
    if (error) sessionItemsRemoteAvailable = false;
  }
  if (!remoteSaved) {
    let { error } = await db.from('bookings').update({ service_id:sessionComposerDraft[0].service_id, duration_minutes:totalDuration, total_price_rub:totalPrice }).eq('id', item.id).eq('performer_id', currentUser.id);
    if (error) ({ error } = await db.from('bookings').update({ service_id:sessionComposerDraft[0].service_id, duration_minutes:totalDuration }).eq('id', item.id).eq('performer_id', currentUser.id));
    if (error) {
      button.disabled = false;
      button.textContent = 'Сохранить состав';
      showFormError('#sessionComposerError', 'Не удалось сохранить состав сеанса.');
      return;
    }
  }
  bookingSessionItems.set(item.id, sessionComposerDraft.map((entry, index) => ({ ...entry, item_kind:entry.kind, position:index + 1 })));
  writeLocalSessionItems();
  button.textContent = 'Сохранить состав';
  await refreshAfterWrite();
  notify(remoteSaved ? 'Состав сеанса сохранён' : 'Состав сохранён на этом устройстве');
  openBookingSheet(item.id);
}

function openBookingEditor(id) {
  const item = allBookings.find(booking => booking.id === id);
  if (!item) return;
  const block = isScheduleBlock(item);
  bookingEditTime = String(item.booking_time).slice(0, 5);
  $('#bookingSheet').classList.remove('booking-sheet-wide');
  applyClientHighlightClasses($('#bookingSheet'), block ? '' : item.client_phone, 'booking-sheet-');
  $('#bookingSheetContent').innerHTML = `<div class="booking-editor-heading"><button class="booking-editor-back" type="button" data-back-booking="${item.id}">${uiIcon('arrow-left')}<span>К записи</span></button>
    <small class="booking-sheet-kicker">${block ? 'Занятое время' : 'Изменение записи'}</small></div><h2 id="bookingSheetTitle">${block ? 'Изменить перерыв' : 'Перенести или изменить'}</h2>
    <form class="booking-editor-form booking-edit-form-compact" id="bookingEditForm" data-booking-id="${item.id}">
      ${block ? `<label>Название<input id="editBookingBlockTitle" maxlength="80" value="${escapeHtml(item.client_name || 'Перерыв')}" required></label>` : ''}
      <label>${block ? 'Длительность' : 'Основная услуга'}<select id="editBookingService" required ${block ? '' : 'disabled'}>${block ? blockDurationOptions(item.service_id) : serviceOptions(item.service_id)}</select>${block ? '' : '<small>Состав, длительность и стоимость меняются в блоке «Состав сеанса».</small>'}</label>
      <label>${block ? 'Заметка к перерыву' : 'Заметка о клиенте'}<textarea id="editBookingNote" maxlength="1000" rows="2" placeholder="${block ? 'Например, обед или личное дело' : 'Пожелания, особенности или важная информация'}">${escapeHtml(bookingDisplayNote(item))}</textarea></label>
      ${bookingColorPicker('editBookingColor', bookingColor(item))}
      <label>Новая дата<input id="editBookingDate" type="date" min="${businessTodayIso()}" value="${item.booking_date}" required></label>
      <label>Свободное время<div class="repeat-times booking-editor-times" id="editBookingTimes"><span>Ищем свободное время…</span></div></label>
      <p class="form-error" id="bookingEditError" hidden></p>
      <button class="primary" type="submit">Сохранить изменения</button>
    </form>`;
  $('#bookingSheet').hidden = false;
  document.body.classList.add('booking-sheet-open');
  $('#editBookingService').addEventListener('change', () => loadBookingEditSlots(id));
  $('#editBookingDate').addEventListener('change', () => loadBookingEditSlots(id));
  $('#bookingEditForm').addEventListener('submit', saveBookingChanges);
  loadBookingEditSlots(id, true);
}

async function saveBookingChanges(event) {
  event.preventDefault();
  if (!requireWrites()) return;
  const userId = currentUser.id;
  const generation = sessionGeneration;
  const id = event.currentTarget.dataset.bookingId;
  const item = allBookings.find(booking => booking.id === id);
  const block = isScheduleBlock(item);
  const service = ownServices.find(entry => entry.id === $('#editBookingService').value);
  const date = $('#editBookingDate').value;
  const color = $('[name="editBookingColor"]:checked')?.value || bookingColor(item);
  const note = $('#editBookingNote')?.value.trim() || '';
  const blockTitle = block ? ($('#editBookingBlockTitle')?.value.trim() || '') : '';
  if (!item || !service || !date || !bookingEditTime || (block && blockTitle.length < 2)) {
    showFormError('#bookingEditError', block ? 'Выберите длительность, дату и свободное время.' : 'Выберите услугу, дату и свободное время.');
    return;
  }
  const button = event.submitter;
  button.disabled = true;
  button.textContent = 'Сохраняем…';
  const changes = { service_id:block ? service.id : item.service_id, duration_minutes:block ? service.duration_minutes : item.duration_minutes, booking_date: date, booking_time: `${bookingEditTime}:00` };
  if (block) changes.client_name = blockTitle;
  const { error } = await db.from('bookings').update(changes).eq('id', id).eq('performer_id', userId);
  if (!sessionIsCurrent(userId, generation)) return;
  if (error) {
    button.disabled = false;
    button.textContent = 'Сохранить изменения';
    showFormError('#bookingEditError', 'Это время уже занято. Выберите другой вариант.');
    await loadBookingEditSlots(id);
    return;
  }
  if (!block) notifyTelegramClient(id, 'rescheduled');
  await saveBookingColor(id, color, { rerender:false });
  let noteRemoteSaved = true;
  if (block) {
    noteRemoteSaved = await saveBookingNote(id, note, { rerender:false });
  } else {
    const normalizedPhone = normalizePhone(item.client_phone);
    const { error:noteError } = await db.from('client_notes').upsert({ performer_id:userId, client_phone:normalizedPhone, note, updated_at:new Date().toISOString() });
    noteRemoteSaved = !noteError;
    if (!noteError) clientNotes.set(normalizedPhone, note);
  }
  selectScheduleDate(date);
  await refreshAfterWrite();
  notify(noteRemoteSaved
    ? (block ? 'Перерыв обновлён' : 'Запись обновлена')
    : (block ? 'Перерыв обновлён. Заметка сохранена на этом устройстве' : 'Запись обновлена, но заметку сохранить не удалось'));
  openBookingSheet(id);
}

async function loadNewBookingSlots() {
  const service = $('#newBookingService')?.value;
  const date = $('#newBookingDate')?.value;
  const holder = $('#newBookingTimes');
  if (!service || !date || !holder) return;
  const preferredTime = newBookingPreferredTime;
  newBookingTime = '';
  newBookingSlots = [];
  newBookingHour = '';
  holder.innerHTML = '<span>Ищем свободное время…</span>';
  const { data, error } = await db.rpc('get_available_slots', { p_service: service, p_start: date, p_end: date });
  if (error || !data?.length) {
    holder.innerHTML = '<span>На эту дату свободного времени нет</span>';
    return;
  }
  newBookingSlots = data.map(slot => String(slot.booking_time).slice(0, 5));
  newBookingTime = preferredTime && newBookingSlots.includes(preferredTime) ? preferredTime : (preferredTime ? '' : newBookingSlots[0]);
  newBookingHour = String(newBookingTime || preferredTime || newBookingSlots[0]).slice(0, 2);
  if (!newBookingSlots.some(time => time.startsWith(`${newBookingHour}:`))) newBookingHour = newBookingSlots[0].slice(0, 2);
  renderNewBookingTimePicker();
  clearFormError('#newBookingError');
}

function renderNewBookingTimePicker() {
  const holder = $('#newBookingTimes');
  if (!holder || !newBookingSlots.length) return;
  const hours = [...new Set(newBookingSlots.map(time => time.slice(0, 2)))];
  if (!hours.includes(newBookingHour)) newBookingHour = hours[0];
  const hourSlots = newBookingSlots.filter(time => time.startsWith(`${newBookingHour}:`));
  const preferredUnavailable = newBookingPreferredTime && !newBookingSlots.includes(newBookingPreferredTime);
  holder.innerHTML = `${preferredUnavailable ? `<div class="booking-time-warning">В ${escapeHtml(newBookingPreferredTime)} для выбранной длительности окна нет. Выберите другое время.</div>` : ''}<div class="booking-time-guide"><strong>1. Выберите час</strong><span>Шаг записи — ${scheduleStepForDate($('#newBookingDate')?.value)} минут</span></div>
    <div class="booking-time-hours">${hours.map(hour => `<button type="button" class="${hour === newBookingHour ? 'active' : ''}" data-new-booking-hour="${hour}">${hour}:00</button>`).join('')}</div>
    <div class="booking-time-guide"><strong>2. Точное время</strong><span>${newBookingTime ? `Выбрано ${newBookingTime}` : `${hourSlots.length} свободных вариантов`}</span></div>
    <div class="booking-time-slots">${hourSlots.map(time => `<button type="button" class="${time === newBookingTime ? 'active' : ''}" data-new-booking-time="${time}">${time}</button>`).join('')}</div>`;
}

function setNewBookingMode(mode) {
  newBookingMode = mode === 'block' ? 'block' : 'client';
  $$('[data-new-booking-mode]').forEach(button => {
    const active = button.dataset.newBookingMode === newBookingMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const block = newBookingMode === 'block';
  $('#newBookingClientFields').hidden = block;
  $('#newBookingBlockFields').hidden = !block;
  $('#newBookingName').required = !block;
  $('#newBookingPhone').required = !block;
  $('#newBookingBlockTitle').required = block;
  $('#newBookingSheetTitle').textContent = block ? 'Занять время' : 'Новый клиент';
  $('#newBookingSectionTitle').textContent = block ? 'Перерыв' : 'Клиент и услуга';
  $('#newBookingSectionSubtitle').textContent = block ? 'Название, заметка и длительность' : 'Основная информация о записи';
  $('#newBookingServiceCaption').textContent = block ? 'Длительность' : 'Услуга';
  const serviceSelect = $('#newBookingService');
  const selectedService = serviceSelect.value;
  serviceSelect.innerHTML = block ? blockDurationOptions(selectedService, true) : serviceOptions(selectedService, true);
  $('#newBookingSubmit').textContent = block ? 'Занять время' : 'Создать запись';
  clearFormError('#newBookingError');
  loadNewBookingSlots();
}

function openNewBookingSheet(preferredTime = '') {
  const services = ownServices.filter(item => item.active);
  const date = selectedDate < businessTodayIso() ? businessTodayIso() : selectedDate;
  newBookingTime = '';
  newBookingSlots = [];
  newBookingHour = '';
  newBookingPreferredTime = /^\d{2}:\d{2}$/.test(String(preferredTime)) ? String(preferredTime) : '';
  newBookingMode = 'client';
  $('#bookingSheet').classList.add('booking-sheet-wide', 'new-booking-sheet');
  $('#bookingSheet').classList.remove('booking-sheet-vip');
  $('#bookingSheetContent').innerHTML = `<small class="booking-sheet-kicker">Ручное расписание</small><h2 id="bookingSheetTitle"><span id="newBookingSheetTitle">Новый клиент</span>${newBookingPreferredTime ? `<small class="booking-clicked-time">Выбрано в расписании: ${escapeHtml(newBookingPreferredTime)}</small>` : ''}</h2>
    ${services.length ? `<form class="booking-editor-form new-booking-form" id="newBookingForm">
      <div class="new-booking-mode-toggle" role="group" aria-label="Тип записи"><button class="active" type="button" data-new-booking-mode="client" aria-pressed="true">Клиент</button><button type="button" data-new-booking-mode="block" aria-pressed="false">Занять время</button></div>
      <div class="new-booking-layout">
        <section class="new-booking-section"><div class="new-booking-section-title"><span>1</span><div><strong id="newBookingSectionTitle">Клиент и услуга</strong><small id="newBookingSectionSubtitle">Основная информация о записи</small></div></div>
          <div id="newBookingClientFields"><div class="booking-client-fields"><label>Имя клиента<input id="newBookingName" maxlength="80" autocomplete="name" placeholder="Например, Анна" required></label><label>Телефон<input id="newBookingPhone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+7 (___) ___-__-__" required></label></div><label>Заметка о клиенте<textarea id="newBookingNote" maxlength="1000" rows="3" placeholder="Пожелания или важная информация — необязательно"></textarea></label></div>
          <div class="new-booking-block-fields" id="newBookingBlockFields" hidden><label>Название<input id="newBookingBlockTitle" maxlength="80" value="Перерыв" placeholder="Например, Обеденный перерыв"></label><label>Заметка к перерыву<textarea id="newBookingBlockNote" maxlength="1000" rows="2" placeholder="Например, обед или личное дело"></textarea></label><p>Телефон не нужен. Время будет занято для клиентов.</p></div>
          <label><span id="newBookingServiceCaption">Услуга</span><select id="newBookingService" required>${serviceOptions(services[0].id, true)}</select></label>
          ${bookingColorPicker('newBookingColor', BOOKING_COLOR_DEFAULT)}
        </section>
        <section class="new-booking-section"><div class="new-booking-section-title"><span>2</span><div><strong>Дата и время</strong><small>Выберите удобное свободное окно</small></div></div>
          <label>Дата<input id="newBookingDate" type="date" min="${businessTodayIso()}" value="${date}" required></label>
          <label>Свободное время<div class="booking-editor-times booking-time-picker" id="newBookingTimes"><span>Ищем свободное время…</span></div></label>
        </section>
      </div>
      <p class="form-error" id="newBookingError" hidden></p><button class="primary new-booking-submit" id="newBookingSubmit" type="submit">Создать запись</button>
    </form>` : `<div class="provider-empty booking-sheet-empty"><span class="provider-empty-icon">${uiIcon('plus')}</span><strong>Сначала добавьте услугу</strong><small>После этого можно будет записывать клиентов вручную.</small></div>`}`;
  $('#bookingSheet').hidden = false;
  document.body.classList.add('booking-sheet-open');
  if (!services.length) return;
  $$('[data-new-booking-mode]').forEach(button => button.addEventListener('click', () => setNewBookingMode(button.dataset.newBookingMode)));
  $('#newBookingService').addEventListener('change', loadNewBookingSlots);
  $('#newBookingDate').addEventListener('change', () => { newBookingPreferredTime = ''; loadNewBookingSlots(); });
  $('#newBookingForm').addEventListener('submit', createNewBooking);
  setNewBookingMode('client');
  loadNewBookingSlots();
  setTimeout(() => $('#newBookingName')?.focus(), 0);
}

async function createNewBooking(event) {
  event.preventDefault();
  if (!requireWrites()) return;
  const userId = currentUser.id;
  const generation = sessionGeneration;
  const block = newBookingMode === 'block';
  const name = block ? ($('#newBookingBlockTitle').value.trim() || 'Перерыв') : $('#newBookingName').value.trim();
  const phone = block ? SCHEDULE_BLOCK_PHONE : $('#newBookingPhone').value.trim();
  const service = $('#newBookingService').value;
  const date = $('#newBookingDate').value;
  const color = $('[name="newBookingColor"]:checked')?.value || BOOKING_COLOR_DEFAULT;
  const selectedButtonTime = $('[data-new-booking-time].active')?.dataset.newBookingTime || '';
  newBookingTime = newBookingTime || selectedButtonTime;
  if (name.length < 2 || (!block && normalizePhone(phone).length < 10) || !service || !date || !newBookingTime) {
    showFormError('#newBookingError', block ? 'Укажите название и выберите свободное время.' : 'Укажите имя, телефон и выберите свободное время.');
    return;
  }
  const button = event.submitter;
  button.disabled = true;
  button.textContent = block ? 'Занимаем…' : 'Создаём…';
  const bookingParams = { p_service: service, p_date: date, p_time: `${newBookingTime}:00`, p_client_name: name, p_client_phone: phone };
  let { error } = await db.rpc('provider_book_appointment', bookingParams);
  if (!sessionIsCurrent(userId, generation)) return;
  const technicalProviderError = error && (
    ['42501', '42883', 'PGRST202'].includes(String(error.code || ''))
    || /permission denied|could not find the function|does not exist/i.test(String(error.message || ''))
  );
  if (technicalProviderError) {
    ({ error } = await db.rpc('book_appointment', bookingParams));
    if (!sessionIsCurrent(userId, generation)) return;
  }
  if (error) {
    button.disabled = false;
    button.textContent = block ? 'Занять время' : 'Создать запись';
    const reason = String(error.message || '');
    const message = reason.includes('slot_unavailable')
      ? 'Это время уже занято. Выберите другое.'
      : reason.includes('service_unavailable')
        ? 'Услуга недоступна для записи. Обновите список услуг.'
        : reason.includes('invalid_client_data')
        ? (block ? 'Не удалось занять время.' : 'Проверьте имя и номер телефона клиента.')
          : 'Не удалось создать запись. Обновите страницу и попробуйте ещё раз.';
    await loadNewBookingSlots();
    showFormError('#newBookingError', message);
    return;
  }
  const note = block ? ($('#newBookingBlockNote')?.value.trim() || '') : $('#newBookingNote').value.trim();
  const normalizedPhone = normalizePhone(phone);
  if (!block && note) {
    await db.from('client_notes').upsert({ performer_id: userId, client_phone: normalizedPhone, note, updated_at: new Date().toISOString() });
    if (!sessionIsCurrent(userId, generation)) return;
    clientNotes.set(normalizedPhone, note);
  }
  selectScheduleDate(date);
  closeBookingSheet();
  await refreshAfterWrite();
  const createdBooking = [...allBookings].reverse().find(item => item.service_id === service && item.booking_date === date && String(item.booking_time).slice(0, 5) === newBookingTime && normalizePhone(item.client_phone) === normalizePhone(phone));
  let blockNoteLocalOnly = false;
  if (createdBooking) {
    await saveBookingColor(createdBooking.id, color, { rerender:false });
    if (block) {
      const remoteSaved = await saveBookingNote(createdBooking.id, note);
      blockNoteLocalOnly = !remoteSaved && Boolean(note);
    }
    else renderBookingData();
  }
  notify(block
    ? (blockNoteLocalOnly ? 'Перерыв создан. Заметка сохранена на этом устройстве' : 'Время занято')
    : 'Новая запись создана');
}

function closeBookingSheet() {
  $('#bookingSheet').hidden = true;
  $('#bookingSheet').classList.remove('booking-sheet-wide', 'booking-sheet-vip', 'new-booking-sheet');
  document.body.classList.remove('booking-sheet-open');
}

function renderBookings() {
  const holder = $('#providerBookings');
  const date = new Date(`${selectedDate}T12:00:00`);
  const today = businessTodayIso();
  $('#selectedDateTitle').textContent = selectedDate === today ? 'Сегодня' : date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'long' });
  if (teamCalendarController?.isTeamMode) {
    $('#selectedDateSummary').textContent = 'Записи выбранной команды';
    if (teamCalendarController.render(holder)) return;
  }
  const items = filteredBookings();
  const clientCount = items.filter(item => !isScheduleBlock(item)).length;
  const blockCount = items.filter(isScheduleBlock).length;
  const daySummary = [clientCount ? `${clientCount} ${clientCount === 1 ? 'запись' : clientCount < 5 ? 'записи' : 'записей'}` : '', blockCount ? `${blockCount} ${blockCount === 1 ? 'перерыв' : blockCount < 5 ? 'перерыва' : 'перерывов'}` : ''].filter(Boolean).join(' · ');
  $('#selectedDateSummary').textContent = currentFilter === 'day'
    ? (daySummary || 'Свободный день')
    : (currentFilter === 'upcoming' ? 'Все будущие записи' : 'История записей');
  if (currentFilter === 'day' && journalMode === 'timeline') renderTimeline(items);
  else renderBookingList(items);
}

function setTeamCalendarMode(active) {
  const teamMode = active === true;
  const modeToggle = $('.journal-mode-toggle');
  const filters = $('.booking-filters');
  const createButton = $('#newBookingButton');
  if (modeToggle) modeToggle.hidden = teamMode || currentFilter !== 'day';
  if (filters) filters.hidden = teamMode;
  if (createButton) createButton.hidden = teamMode;
  if (!teamMode) updateJournalModeButtons();
  renderBookings();
}

function buildClients() {
  const clients = new Map();
  allBookings.forEach(booking => {
    if (isScheduleBlock(booking)) return;
    const phone = normalizePhone(booking.client_phone);
    if (!phone) return;
    const current = clients.get(phone) || { phone, displayPhone: booking.client_phone, name: booking.client_name, bookings: [] };
    current.name = booking.client_name || current.name;
    current.displayPhone = booking.client_phone || current.displayPhone;
    current.bookings.push(booking);
    clients.set(phone, current);
  });
  return [...clients.values()].sort((a, b) => {
    const aLast = a.bookings.at(-1); const bLast = b.bookings.at(-1);
    return `${bLast?.booking_date || ''}${bLast?.booking_time || ''}`.localeCompare(`${aLast?.booking_date || ''}${aLast?.booking_time || ''}`);
  });
}

function clientUpcoming(client) {
  const now = new Date();
  return client.bookings.find(item => item.status !== 'cancelled' && new Date(`${item.booking_date}T${String(item.booking_time).slice(0, 8)}`) >= now) || null;
}

function renderClients() {
  const clients = buildClients();
  const search = $('#clientSearch').value.trim().toLowerCase();
  const filtered = clients.filter(client => `${client.name} ${client.displayPhone} ${client.phone}`.toLowerCase().includes(search));
  $('#clientsCount').textContent = String(clients.length);
  $('#clientsBadge').textContent = String(clients.length);
  if (!filtered.length) {
    $('#clientsList').innerHTML = `<div class="provider-empty compact-empty"><span class="provider-empty-icon">${uiIcon('user')}</span><strong>${clients.length ? 'Ничего не найдено' : 'Клиентов пока нет'}</strong><small>${clients.length ? 'Попробуйте изменить запрос.' : 'Они появятся после первой записи.'}</small></div>`;
    return;
  }
  $('#clientsList').innerHTML = filtered.map(client => {
    const upcoming = clientUpcoming(client);
    const activeCount = client.bookings.filter(item => item.status !== 'cancelled').length;
    const nextText = upcoming ? `${new Date(`${upcoming.booking_date}T12:00:00`).toLocaleDateString('ru-RU', { day:'numeric', month:'short' })}, ${String(upcoming.booking_time).slice(0,5)}` : 'Нет будущих записей';
    return `<button class="client-list-item ${client.phone === selectedClientPhone ? 'active' : ''}${clientHighlightClasses(client.phone)}" type="button" data-client-phone="${client.phone}"><span class="client-list-avatar">${escapeHtml(client.name.slice(0,1).toUpperCase())}</span><span class="client-list-main"><span class="client-list-name-row"><strong>${escapeHtml(client.name)}</strong>${clientBadgeMarkup(client.phone)}</span><small>${escapeHtml(client.displayPhone)}</small><i>${escapeHtml(nextText)}</i></span><b>${activeCount}</b></button>`;
  }).join('');
}

function renderClientDetail(phone) {
  const client = buildClients().find(item => item.phone === phone);
  if (!client) return;
  selectedClientPhone = phone;
  renderClients();
  $('#clientProfileEmpty').hidden = true;
  $('#clientProfileContent').hidden = false;
  $('#clientAvatar').textContent = client.name.slice(0,1).toUpperCase();
  $('#clientName').textContent = client.name;
  $('#clientPhone').textContent = client.displayPhone;
  $('#clientPhone').href = `tel:${client.phone}`;
  $('#clientProfileBadges').innerHTML = clientBadgeMarkup(client.phone, { limit:4, showLabels:true });
  const labels = clientLabel(client.phone);
  applyClientHighlightClasses($('#clientProfileContent').closest('.client-profile'), client.phone, 'client-profile-');
  $('#clientLabelFavorite').checked = labels.favorite;
  $('#clientLabelVip').checked = labels.vip;
  $('#clientLabelAttention').checked = labels.attention;
  $('#clientFavoriteNote').value = labels.favorite_note;
  $('#clientVipNote').value = labels.vip_note;
  $('#clientAttentionReason').value = labels.attention_reason;
  $('#clientFavoriteNoteField').hidden = !labels.favorite;
  $('#clientVipNoteField').hidden = !labels.vip;
  $('#clientAttentionReasonField').hidden = !labels.attention;
  $('#clientAutomaticLabel').innerHTML = clientIsNew(client.phone) ? `${uiIcon('spark')} Новый клиент` : '';
  clearFormError('#clientLabelsError');
  const now = new Date();
  const visits = client.bookings.filter(item => {
    const outcome = bookingOutcome(item);
    if (outcome.visit_status === 'completed') return true;
    if (outcome.visit_status === 'no_show') return false;
    return item.status !== 'cancelled' && new Date(`${item.booking_date}T${String(item.booking_time).slice(0,8)}`) < now;
  }).length;
  const upcoming = clientUpcoming(client);
  $('#clientVisits').textContent = String(visits);
  $('#clientNext').textContent = upcoming ? `${new Date(`${upcoming.booking_date}T12:00:00`).toLocaleDateString('ru-RU',{day:'numeric',month:'short'})} · ${String(upcoming.booking_time).slice(0,5)}` : 'Нет';
  $('#clientNote').value = clientNotes.get(phone) || '';
  $('#repeatDate').value = businessTodayIso();
  $('#repeatDate').min = businessTodayIso();
  repeatTime = '';
  populateRepeatServices();
  loadRepeatSlots();
  const history = [...client.bookings].sort((a,b) => `${b.booking_date}${b.booking_time}`.localeCompare(`${a.booking_date}${a.booking_time}`));
  $('#clientHistory').innerHTML = history.map(item => {
    const status = bookingStatus(item);
    return `<article class="client-history-item status-${bookingStatusClass(item)}"><div><strong>${escapeHtml(serviceName(item.services?.name || 'Услуга'))}</strong><small>${new Date(`${item.booking_date}T12:00:00`).toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'})} · ${String(item.booking_time).slice(0,5)}</small></div><span>${status}</span></article>`;
  }).join('');
}

function populateRepeatServices() {
  const select = $('#repeatService');
  const active = ownServices.filter(item => item.active);
  const previous = select.value;
  select.innerHTML = active.length ? active.map(item => `<option value="${item.id}">${escapeHtml(serviceName(item.name))} · ${item.duration_minutes} мин</option>`).join('') : '<option value="">Сначала добавьте услугу</option>';
  if (active.some(item => item.id === previous)) select.value = previous;
}

async function loadRepeatSlots() {
  if (!selectedClientPhone) return;
  const service = $('#repeatService').value;
  const date = $('#repeatDate').value;
  repeatTime = '';
  if (!service || !date) { $('#repeatTimes').innerHTML = '<span>Выберите услугу и дату</span>'; return; }
  $('#repeatTimes').innerHTML = '<span>Ищем свободное время…</span>';
  const { data, error } = await db.rpc('get_available_slots', { p_service: service, p_start: date, p_end: date });
  if (error || !data?.length) { $('#repeatTimes').innerHTML = '<span>На эту дату свободного времени нет</span>'; return; }
  $('#repeatTimes').innerHTML = data.map(item => `<button type="button" data-repeat-time="${String(item.booking_time).slice(0,5)}">${String(item.booking_time).slice(0,5)}</button>`).join('');
}

async function loadClientNotes() {
  const userId = currentUser?.id;
  const generation = sessionGeneration;
  if (!userId) return { ok: false };
  const { data, error } = await db.from('client_notes').select('client_phone,note').eq('performer_id', userId);
  if (!sessionIsCurrent(userId, generation)) return { ok: false, stale: true };
  if (error) return { ok: false };
  clientNotes = new Map((data || []).map(item => [normalizePhone(item.client_phone), item.note]));
  renderBookings();
  renderClients();
  return { ok: true };
}

async function loadClientLabels() {
  const userId = currentUser?.id;
  const generation = sessionGeneration;
  if (!userId) return { ok:false, optional:true };
  let { data, error } = await db.from('client_labels').select('client_phone,favorite,favorite_note,vip,vip_note,attention,attention_reason').eq('performer_id', userId);
  if (error) ({ data, error } = await db.from('client_labels').select('client_phone,favorite,vip,attention,attention_reason').eq('performer_id', userId));
  if (!sessionIsCurrent(userId, generation)) return { ok:false, stale:true, optional:true };
  if (!error) {
    (data || []).forEach(item => {
      const phone = normalizePhone(item.client_phone);
      if (!pendingClientLabels.has(phone)) clientLabels.set(phone, normalizeClientLabel(item));
    });
    persistClientLabels(userId);
  }
  renderBookings();
  renderClients();
  if (selectedClientPhone) renderClientDetail(selectedClientPhone);
  return { ok:!error, optional:true };
}

function refreshClientLabelPresentation(phone) {
  renderBookings();
  renderClients();
  if (selectedClientPhone === phone) {
    $('#clientProfileBadges').innerHTML = clientBadgeMarkup(phone, { limit:4, showLabels:true });
    applyClientHighlightClasses($('#clientProfileContent').closest('.client-profile'), phone, 'client-profile-');
  }
  const editor = $('[data-booking-client-labels]');
  if (editor && normalizePhone(editor.dataset.bookingClientLabels) === phone) {
    applyClientHighlightClasses($('#bookingSheet'), phone, 'booking-sheet-');
    const summary = editor.closest('.booking-labels-disclosure')?.querySelector('.booking-labels-summary');
    if (summary) summary.innerHTML = clientBadgeMarkup(phone, { limit:3 }) || `${uiIcon('plus')}<span>Добавить</span>`;
  }
}

async function persistClientLabelValue(phone, value, statusElement) {
  const userId = currentUser.id;
  const generation = sessionGeneration;
  clientLabels.set(phone, value);
  pendingClientLabels.add(phone);
  persistClientLabels();
  refreshClientLabelPresentation(phone);
  if (statusElement) statusElement.textContent = 'Сохраняем…';
  const previous = clientLabelSaveQueues.get(phone) || Promise.resolve();
  const operation = previous.catch(() => {}).then(() => db.from('client_labels').upsert({ performer_id:userId, client_phone:phone, ...value, updated_at:new Date().toISOString() }, { onConflict:'performer_id,client_phone' }));
  clientLabelSaveQueues.set(phone, operation);
  const { error } = await operation;
  if (!sessionIsCurrent(userId, generation)) return;
  if (clientLabelSaveQueues.get(phone) === operation) {
    clientLabelSaveQueues.delete(phone);
    if (!error) pendingClientLabels.delete(phone);
    persistClientLabels();
    if (statusElement?.isConnected) statusElement.textContent = error ? 'Сохранено на этом устройстве' : 'Сохранено';
    if (error) notify('Метки сохранены на этом устройстве');
  }
}

async function saveClientLabels() {
  if (!requireWrites() || !selectedClientPhone) return;
  clearFormError('#clientLabelsError');
  const value = normalizeClientLabel({
    favorite:$('#clientLabelFavorite').checked,
    favorite_note:$('#clientFavoriteNote').value,
    vip:$('#clientLabelVip').checked,
    vip_note:$('#clientVipNote').value,
    attention:$('#clientLabelAttention').checked,
    attention_reason:$('#clientAttentionReason').value
  });
  if (value.attention && value.attention_reason.length < 3) {
    showFormError('#clientLabelsError', 'Добавьте короткую причину — метка сохранится автоматически.');
    $('#clientLabelsSaveStatus').textContent = 'Ожидает причину';
    return;
  }
  if (!value.favorite) value.favorite_note = '';
  if (!value.vip) value.vip_note = '';
  if (!value.attention) value.attention_reason = '';
  await persistClientLabelValue(selectedClientPhone, value, $('#clientLabelsSaveStatus'));
}

async function saveBookingClientLabels(editor) {
  if (!requireWrites() || !editor) return;
  const errorElement = editor.querySelector('[data-booking-labels-error]');
  errorElement.hidden = true;
  const phone = normalizePhone(editor.dataset.bookingClientLabels);
  const value = normalizeClientLabel({
    favorite:editor.querySelector('[data-booking-label-favorite]').checked,
    favorite_note:editor.querySelector('[data-booking-favorite-note]').value,
    vip:editor.querySelector('[data-booking-label-vip]').checked,
    vip_note:editor.querySelector('[data-booking-vip-note]').value,
    attention:editor.querySelector('[data-booking-label-attention]').checked,
    attention_reason:editor.querySelector('[data-booking-attention-reason]').value
  });
  if (value.attention && value.attention_reason.length < 3) {
    errorElement.textContent = 'Добавьте короткую причину — метка сохранится автоматически.';
    errorElement.hidden = false;
    editor.querySelector('[data-booking-labels-status]').textContent = 'Ожидает причину';
    return;
  }
  if (!value.favorite) value.favorite_note = '';
  if (!value.vip) value.vip_note = '';
  if (!value.attention) value.attention_reason = '';
  await persistClientLabelValue(phone, value, editor.querySelector('[data-booking-labels-status]'));
}

async function loadBookingSessionItems() {
  const userId = currentUser?.id;
  const generation = sessionGeneration;
  if (!userId) return { ok:false, optional:true };
  const local = readLocalSessionItems(userId);
  const { data, error } = await db.from('booking_session_items').select('id,booking_id,position,item_kind,service_id,title,duration_minutes,price_rub,extends_duration').eq('performer_id', userId).order('position');
  if (!sessionIsCurrent(userId, generation)) return { ok:false, stale:true, optional:true };
  sessionItemsRemoteAvailable = !error;
  if (error) bookingSessionItems = new Map(Object.entries(local));
  else {
    const grouped = new Map();
    (data || []).forEach(entry => {
      const rows = grouped.get(entry.booking_id) || [];
      rows.push(entry);
      grouped.set(entry.booking_id, rows);
    });
    bookingSessionItems = grouped;
    Object.entries(local).forEach(([id, items]) => { if (!bookingSessionItems.has(id)) bookingSessionItems.set(id, items); });
    writeLocalSessionItems(userId);
  }
  renderBookingData();
  return { ok:!error, optional:true };
}

async function loadBookingOutcomes() {
  const userId = currentUser?.id;
  const generation = sessionGeneration;
  if (!userId) return { ok: false, optional: true };
  const local = readLocalOutcomes();
  let { data, error } = await db.from('booking_outcomes').select('booking_id,visit_status,payment_method,amount_rub,actual_duration_minutes,calculated_amount_rub,completion_source,updated_at').eq('performer_id', userId);
  if (error) ({ data, error } = await db.from('booking_outcomes').select('booking_id,visit_status,payment_method,amount_rub,completion_source,updated_at').eq('performer_id', userId));
  if (error) ({ data, error } = await db.from('booking_outcomes').select('booking_id,visit_status,payment_method,amount_rub,updated_at').eq('performer_id', userId));
  if (!sessionIsCurrent(userId, generation)) return { ok: false, stale: true, optional: true };
  outcomesRemoteAvailable = !error;
  if (error) bookingOutcomes = new Map(Object.entries(local));
  else {
    bookingOutcomes = new Map((data || []).map(item => [item.booking_id, { ...item, completion_source:item.completion_source || local[item.booking_id]?.completion_source || 'manual' }]));
    Object.entries(local).forEach(([id, value]) => { if (!bookingOutcomes.has(id)) bookingOutcomes.set(id, value); });
  }
  renderBookings();
  renderClients();
  renderNotifications();
  renderAnalytics();
  if (selectedClientPhone) renderClientDetail(selectedClientPhone);
  return { ok: !error, optional: true };
}

async function persistBookingOutcome(record) {
  if (!outcomesRemoteAvailable) return false;
  let { error } = await db.from('booking_outcomes').upsert(record, { onConflict:'booking_id' });
  if (error && (Object.hasOwn(record, 'actual_duration_minutes') || Object.hasOwn(record, 'calculated_amount_rub'))) {
    const compatibleRecord = { ...record };
    delete compatibleRecord.actual_duration_minutes;
    delete compatibleRecord.calculated_amount_rub;
    ({ error } = await db.from('booking_outcomes').upsert(compatibleRecord, { onConflict:'booking_id' }));
  }
  if (error && Object.hasOwn(record, 'completion_source')) {
    const compatibleRecord = { ...record };
    delete compatibleRecord.actual_duration_minutes;
    delete compatibleRecord.calculated_amount_rub;
    delete compatibleRecord.completion_source;
    ({ error } = await db.from('booking_outcomes').upsert(compatibleRecord, { onConflict:'booking_id' }));
  }
  if (error) outcomesRemoteAvailable = false;
  return !error;
}

async function applyAutomaticVisitOutcomes() {
  if (!currentUser || !writesAllowed) return 0;
  const now = new Date();
  const items = allBookings.filter(item => {
    if (isScheduleBlock(item) || item.status === 'cancelled') return false;
    const outcome = bookingOutcome(item);
    const needsAutomaticCompletion = bookingPolicy.auto_complete_visits && outcome.visit_status === 'scheduled' && bookingSessionEnd(item) <= now;
    const needsPaymentRepair = outcome.visit_status === 'completed' && outcome.completion_source === 'auto' && (outcome.payment_method === 'unpaid' || Number(outcome.amount_rub || 0) <= 0);
    return needsAutomaticCompletion || needsPaymentRepair;
  });
  if (!items.length) return 0;
  const updatedAt = now.toISOString();
  for (const item of items) {
    const outcome = bookingOutcome(item);
    const record = { booking_id:item.id, performer_id:currentUser.id, visit_status:'completed', payment_method:outcome.payment_method === 'unpaid' ? 'cash' : outcome.payment_method, amount_rub:bookingCalculatedValue(item), completion_source:'auto', updated_at:updatedAt };
    if (isPerMinuteBooking(item)) {
      record.actual_duration_minutes = Number(outcome.actual_duration_minutes || 0);
      record.calculated_amount_rub = Number(outcome.calculated_amount_rub || 0);
    }
    await persistBookingOutcome(record);
    bookingOutcomes.set(item.id, record);
  }
  writeLocalOutcomes();
  renderBookings();
  renderClients();
  renderAnalytics();
  return items.length;
}

function renderBookingPolicyForm() {
  if (!$('#bookingPolicyForm')) return;
  $('#cancelCutoffHours').value = String(bookingPolicy.cancel_cutoff_hours ?? 12);
  $('#rescheduleCutoffHours').value = String(bookingPolicy.reschedule_cutoff_hours ?? 12);
  $('#maxReschedules').value = String(bookingPolicy.max_reschedules ?? 2);
  $('#depositEnabled').checked = Boolean(bookingPolicy.deposit_enabled);
  $('#depositAmount').value = String(bookingPolicy.deposit_amount_rub || 0);
  $('#paymentUrlTemplate').value = bookingPolicy.payment_url_template || '';
  $('#autoCompleteVisits').checked = Boolean(bookingPolicy.auto_complete_visits);
  $('#depositSettings').hidden = !$('#depositEnabled').checked;
}

async function loadBookingSettings() {
  const userId = currentUser?.id;
  const generation = sessionGeneration;
  if (!userId) return { ok: false, optional: true };
  const [policyResult, templatesResult, marksResult, outboxResult] = await Promise.all([
    (async () => {
      let result = await db.from('booking_policies').select('cancel_cutoff_hours,reschedule_cutoff_hours,max_reschedules,deposit_enabled,deposit_amount_rub,payment_url_template,auto_complete_visits').eq('performer_id', userId).maybeSingle();
      if (result.error) result = await db.from('booking_policies').select('cancel_cutoff_hours,reschedule_cutoff_hours,max_reschedules,deposit_enabled,deposit_amount_rub,payment_url_template').eq('performer_id', userId).maybeSingle();
      return result;
    })(),
    db.from('notification_templates').select('confirmation,reminder,cancellation').eq('performer_id', userId).maybeSingle(),
    db.from('notification_marks').select('task_key,status').eq('performer_id', userId),
    db.from('notification_outbox').select('id,event_key,booking_id,kind,channel,status,attempts,last_error_code,last_error,next_attempt_at,sent_at,created_at,updated_at').eq('performer_id', userId).order('created_at', { ascending: false }).limit(50)
  ]);
  if (!sessionIsCurrent(userId, generation)) return { ok: false, stale: true, optional: true };
  if (!policyResult.error && policyResult.data) bookingPolicy = { ...bookingPolicy, ...policyResult.data, auto_complete_visits:policyResult.data.auto_complete_visits ?? localStorage.getItem(autoCompleteStorageKey(userId)) === 'true' };
  if (!templatesResult.error && templatesResult.data) serverNotificationTemplates = templatesResult.data;
  if (!marksResult.error) serverNotificationMarks = Object.fromEntries((marksResult.data || []).map(item => [item.task_key, item.status]));
  notificationOutboxRemoteAvailable = !outboxResult.error;
  notificationOutbox = outboxResult.error ? [] : (outboxResult.data || []);
  notificationSettingsRemoteAvailable = !policyResult.error && !templatesResult.error && !marksResult.error;
  renderBookingPolicyForm();
  renderNotificationTemplates();
  renderNotifications();
  return { ok: notificationSettingsRemoteAvailable, optional: true };
}

async function saveBookingPolicy(event) {
  event.preventDefault();
  if (!requireWrites()) return;
  clearFormError('#bookingPolicyError');
  const depositEnabled = $('#depositEnabled').checked;
  const record = {
    performer_id: currentUser.id,
    cancel_cutoff_hours: Math.round(Number($('#cancelCutoffHours').value)),
    reschedule_cutoff_hours: Math.round(Number($('#rescheduleCutoffHours').value)),
    max_reschedules: Math.round(Number($('#maxReschedules').value)),
    deposit_enabled: depositEnabled,
    deposit_amount_rub: Math.max(0, Math.round(Number($('#depositAmount').value) || 0)),
    payment_url_template: $('#paymentUrlTemplate').value.trim(),
    auto_complete_visits: $('#autoCompleteVisits').checked
  };
  if (![record.cancel_cutoff_hours, record.reschedule_cutoff_hours].every(value => value >= 0 && value <= 168) || record.max_reschedules < 0 || record.max_reschedules > 20) {
    showFormError('#bookingPolicyError', 'Проверьте ограничения отмены и переноса.');
    return;
  }
  if (depositEnabled && (record.deposit_amount_rub <= 0 || !/^https:\/\//i.test(record.payment_url_template))) {
    showFormError('#bookingPolicyError', 'Для предоплаты укажите сумму и безопасную ссылку, начинающуюся с https://.');
    return;
  }
  const button = event.submitter;
  button.disabled = true;
  button.textContent = 'Сохраняем…';
  let { error } = await db.from('booking_policies').upsert(record, { onConflict: 'performer_id' });
  if (error) {
    const compatibleRecord = { ...record };
    delete compatibleRecord.auto_complete_visits;
    ({ error } = await db.from('booking_policies').upsert(compatibleRecord, { onConflict:'performer_id' }));
  }
  button.disabled = false;
  button.textContent = 'Сохранить правила';
  if (error) { showFormError('#bookingPolicyError', 'Не удалось сохранить правила.'); return; }
  bookingPolicy = record;
  localStorage.setItem(autoCompleteStorageKey(), String(record.auto_complete_visits));
  renderBookingPolicyForm();
  await applyAutomaticVisitOutcomes();
  notify('Правила онлайн-записи сохранены');
}

async function savePrepaymentStatus(event) {
  event.preventDefault();
  if (!requireWrites()) return;
  const bookingId = event.currentTarget.dataset.bookingId;
  const status = $('#bookingPrepaymentStatus').value;
  const button = event.submitter;
  button.disabled = true;
  const { error } = await db.rpc('set_booking_payment_status', { p_booking: bookingId, p_status: status });
  button.disabled = false;
  if (error) { notify('Не удалось обновить предоплату'); return; }
  notify('Статус предоплаты обновлён');
  await refreshAfterWrite();
  openBookingSheet(bookingId);
}

function updateOutcomeMinuteCalculation() {
  const minutesInput = $('#outcomeActualMinutes');
  const output = $('#outcomeCalculatedAmount');
  const form = $('#bookingOutcomeForm');
  if (!minutesInput || !output || !form) return;
  const minutes = Math.max(0, Math.min(1440, Math.round(Number(minutesInput.value) || 0)));
  const rate = Math.max(0, Number(form.dataset.minuteRate) || 0);
  const total = minutes * rate;
  output.textContent = minutes ? `${minutes} × ${money(rate)} = ${money(total)}` : `Укажите минуты · ${money(rate)}/мин`;
  const amount = $('#outcomeAmount');
  if (amount) amount.value = String(total);
}

function toggleOutcomePaymentFields() {
  const form = $('#bookingOutcomeForm');
  if (!form) return;
  const completed = $('#outcomeVisitStatus').value === 'completed';
  $('#outcomePaymentFields').hidden = !completed;
  $('#outcomePaymentMethod').disabled = !completed;
  $('#outcomeAmount').disabled = !completed;
  if ($('#outcomeActualMinutes')) $('#outcomeActualMinutes').disabled = !completed;
}

async function saveBookingOutcome(event) {
  event.preventDefault();
  if (!requireWrites()) return;
  const userId = currentUser.id;
  const generation = sessionGeneration;
  const form = event.currentTarget;
  const item = allBookings.find(booking => booking.id === form.dataset.bookingId);
  if (!item) return;
  const visitStatus = $('#outcomeVisitStatus').value;
  const completed = visitStatus === 'completed';
  const paymentMethod = completed ? $('#outcomePaymentMethod').value : 'unpaid';
  const actualMinutes = completed && isPerMinuteBooking(item) ? Math.max(0, Math.min(1440, Math.round(Number($('#outcomeActualMinutes')?.value) || 0))) : 0;
  if (completed && isPerMinuteBooking(item) && actualMinutes < 1) {
    notify('Укажите фактическое время процедуры');
    return;
  }
  const calculatedAmount = actualMinutes * bookingMinuteRate(item);
  const amount = completed && paymentMethod !== 'unpaid' ? Math.max(0, Math.round(Number($('#outcomeAmount').value) || 0)) : 0;
  const record = { booking_id: item.id, performer_id: userId, visit_status: visitStatus, payment_method: paymentMethod, amount_rub: amount, completion_source:'manual', updated_at: new Date().toISOString() };
  if (isPerMinuteBooking(item)) {
    record.actual_duration_minutes = actualMinutes;
    record.calculated_amount_rub = calculatedAmount;
  }
  const button = event.submitter;
  button.disabled = true;
  button.textContent = 'Сохраняем…';
  let remoteSaved = false;
  if (outcomesRemoteAvailable) {
    remoteSaved = await persistBookingOutcome(record);
    if (!sessionIsCurrent(userId, generation)) return;
  }
  bookingOutcomes.set(item.id, record);
  writeLocalOutcomes();
  button.disabled = false;
  button.textContent = 'Сохранить результат';
  notify(remoteSaved ? 'Результат визита сохранён' : 'Результат сохранён на этом устройстве');
  renderBookings();
  renderClients();
  renderAnalytics();
  openBookingSheet(item.id);
}

async function saveClientNote() {
  if (!requireWrites()) return;
  if (!selectedClientPhone) return;
  const userId = currentUser.id;
  const generation = sessionGeneration;
  const clientPhone = selectedClientPhone;
  const note = $('#clientNote').value.trim();
  const { error } = await db.from('client_notes').upsert({ performer_id: userId, client_phone: clientPhone, note, updated_at: new Date().toISOString() });
  if (!sessionIsCurrent(userId, generation)) return;
  if (error) { notify('Не удалось сохранить заметку'); return; }
  clientNotes.set(clientPhone, note);
  notify('Заметка сохранена');
}

async function createRepeatBooking(event) {
  event.preventDefault();
  if (!requireWrites()) return;
  clearFormError('#repeatBookingError');
  const client = buildClients().find(item => item.phone === selectedClientPhone);
  if (!client || !repeatTime) { showFormError('#repeatBookingError', 'Выберите свободное время.'); return; }
  const button = event.submitter; button.disabled = true; button.textContent = 'Создаём…';
  const { error } = await db.rpc('provider_book_appointment', { p_service: $('#repeatService').value, p_date: $('#repeatDate').value, p_time: `${repeatTime}:00`, p_client_name: client.name, p_client_phone: client.displayPhone });
  button.disabled = false; button.textContent = 'Создать запись';
  if (error) { showFormError('#repeatBookingError', error.message?.includes('slot_unavailable') ? 'Это время уже заняли. Выберите другое.' : 'Не удалось создать запись.'); await loadRepeatSlots(); return; }
  notify('Повторная запись создана');
  await refreshAfterWrite();
}

function stopLiveUpdates() {
  if (bookingsChannel) db.removeChannel(bookingsChannel);
  bookingsChannel = null;
  clearInterval(syncTimer);
  syncTimer = null;
  clearTimeout(bookingReloadTimer);
}

function scheduleBookingsReload() {
  clearTimeout(bookingReloadTimer);
  bookingReloadTimer = setTimeout(() => {
    if (synchronizationPromise) { synchronizationQueued = true; return; }
    synchronizeProvider();
  }, 250);
}

function startLiveUpdates() {
  stopLiveUpdates();
  if (!currentUser) return;
  const channel = db
    .channel(`provider-bookings-${currentUser.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: `performer_id=eq.${currentUser.id}` }, scheduleBookingsReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'services', filter: `performer_id=eq.${currentUser.id}` }, scheduleBookingsReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'provider_schedule', filter: `performer_id=eq.${currentUser.id}` }, scheduleBookingsReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'provider_days_off', filter: `performer_id=eq.${currentUser.id}` }, scheduleBookingsReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'client_notes', filter: `performer_id=eq.${currentUser.id}` }, scheduleBookingsReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'client_labels', filter: `performer_id=eq.${currentUser.id}` }, scheduleBookingsReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'booking_outcomes', filter: `performer_id=eq.${currentUser.id}` }, scheduleBookingsReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'booking_session_items', filter: `performer_id=eq.${currentUser.id}` }, scheduleBookingsReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'portfolio_items', filter: `performer_id=eq.${currentUser.id}` }, scheduleBookingsReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'portfolio_photos', filter: `performer_id=eq.${currentUser.id}` }, scheduleBookingsReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'booking_waitlist_requests', filter: `performer_id=eq.${currentUser.id}` }, scheduleBookingsReload)
    .subscribe(status => {
      if (bookingsChannel !== channel) return;
      if (status === 'SUBSCRIBED') {
        setSyncState(writesAllowed ? 'online' : 'warning', writesAllowed ? 'Онлайн · данные обновляются' : 'Подключено · проверяем данные · только чтение');
        if (!writesAllowed) synchronizeProvider();
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        bookingsChannel = null;
        db.removeChannel(channel);
        setWritesAllowed(false);
        if (navigator.onLine) {
          setSyncState('warning', 'Связь нестабильна · только чтение');
          setTimeout(() => { if (currentUser && navigator.onLine && !bookingsChannel) startLiveUpdates(); }, 5000);
        }
      }
    });
  bookingsChannel = channel;
  syncTimer = setInterval(() => {
    refreshBusinessDay();
    if (!document.hidden && navigator.onLine) synchronizeProvider();
  }, 60000);
}

function synchronizeProvider() {
  const requestedGeneration = sessionGeneration;
  if (synchronizationPromise && synchronizationGeneration === requestedGeneration) return synchronizationPromise;
  const run = (async () => {
    const userId = currentUser?.id;
    const generation = sessionGeneration;
    if (!userId || !navigator.onLine) return false;
    setSyncState('checking', writesAllowed ? 'Проверяем обновления…' : 'Синхронизация…');
    const results = await Promise.all([loadBookings({ silent: true }), loadOwnServices({ silent: true }), loadSchedule(), loadDaysOff(), loadClientNotes(), loadClientLabels(), loadBookingSessionItems(), loadBookingOutcomes(), loadBookingSettings(), loadPortfolio(), loadWaitlist(), loadProviderReviews(), organizationController.load(), teamCalendarController.refresh()]);
    if (!sessionIsCurrent(userId, generation)) return false;
    const requiredResults = results.filter(result => !result?.optional);
    const complete = requiredResults.every(result => result?.ok);
    const skipped = requiredResults.some(result => result?.skipped);
    const degraded = results.some(result => result?.optional && !result?.ok);
    setWritesAllowed(complete);
    if (complete) {
      await applyAutomaticVisitOutcomes();
      setSyncState(skipped || degraded ? 'warning' : 'online', skipped ? 'Есть несохранённое расписание · серверная сверка приостановлена' : degraded ? 'Основные данные синхронизированы · дополнительные данные сохранены на этом устройстве' : `Синхронизировано · ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`);
      if (!bookingsChannel) startLiveUpdates();
    } else {
      const cached = results.filter(result => result?.cached).map(result => result.savedAt).filter(Boolean).sort()[0];
      setSyncState(navigator.onLine ? 'warning' : 'offline', cached ? `${navigator.onLine ? 'Не все данные обновлены' : 'Офлайн'} · копия на ${reliability?.savedAtLabel(cached) || 'последнюю синхронизацию'} · только чтение` : 'Данные не синхронизированы · только чтение');
    }
    return complete;
  })();
  synchronizationGeneration = requestedGeneration;
  synchronizationPromise = run;
  run.finally(() => {
    if (synchronizationPromise === run) {
      synchronizationPromise = null;
      synchronizationGeneration = -1;
      if (synchronizationQueued && currentUser && navigator.onLine) {
        synchronizationQueued = false;
        setTimeout(() => synchronizeProvider(), 0);
      }
    }
  });
  return run;
}

async function refreshAfterWrite() {
  if (synchronizationPromise) await synchronizationPromise;
  return synchronizeProvider();
}

async function clearProviderDeviceData(userId) {
  if (!userId) return;
  try { await reliability?.removePrefix(`provider:${userId}:`); } catch {}
  try {
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith(`massage-notifications-${userId}-`)
        || key === `massage-booking-outcomes-${userId}`
        || key === bookingColorStorageKey(userId)
        || key === bookingNoteStorageKey(userId)
        || key === bookingNotePendingStorageKey(userId)
        || key === clientLabelStorageKey(userId)
        || key === clientLabelPendingStorageKey(userId)
        || key === sessionItemsStorageKey(userId)
        || key === autoCompleteStorageKey(userId)) localStorage.removeItem(key);
    });
  } catch {}
}

async function logout() {
  const userId = currentUser?.id;
  ++sessionGeneration;
  clearTimeout(displayPreferencesSaveTimer);
  ++displayPreferencesSaveRevision;
  synchronizationQueued = false;
  stopLiveUpdates();
  setWritesAllowed(false);
  await clearProviderDeviceData(userId);
  await db.auth.signOut();
}

async function handleSession(session) {
  const previousUserId = currentUser?.id;
  const generation = ++sessionGeneration;
  clearTimeout(displayPreferencesSaveTimer);
  ++displayPreferencesSaveRevision;
  synchronizationQueued = false;
  stopLiveUpdates();
  $$('[data-operation-disabled]').forEach(control => {
    control.disabled = false;
    delete control.dataset.operationDisabled;
    if (control.id === 'saveSchedule') control.textContent = 'Сохранить';
  });
  setWritesAllowed(false);
  teamCalendarController.reset();
  organizationController.reset();
  currentUser = session?.user || null;
  if (currentUser) {
    loadBookingColors(currentUser.id);
    loadBookingNotes(currentUser.id);
    loadLocalClientLabels(currentUser.id);
    loadLocalDisplayPreferences(currentUser.id);
    displayPreferences = normalizeDisplayPreferences({ ...displayPreferences, ...(currentUser.user_metadata?.provider_display_preferences || {}) });
    persistLocalDisplayPreferences(currentUser.id);
  } else {
    bookingColors = new Map();
    bookingNotes = new Map();
    pendingBookingNotes = new Set();
    clientLabels = new Map();
    pendingClientLabels = new Set();
    displayPreferences = { ...DEFAULT_DISPLAY_PREFERENCES };
  }
  applyDisplayPreferences();
  renderDisplayPreferencesForm();
  scheduleDirty = false;
  if (!currentUser && previousUserId) await clearProviderDeviceData(previousUserId);
  if (generation !== sessionGeneration) return;
  clearInterval(notificationTimer);
  notificationTimer = currentUser ? setInterval(renderNotifications, 60000) : null;
  if (recoveryMode) { showRecoveryReset(); return; }
  $('#authCard').hidden = Boolean(currentUser);
  $('#dashboard').hidden = !currentUser;
  if (!currentUser) {
    closeBookingSheet();
    allBookings = [];
    waitlistRequests = [];
    waitlistRemoteAvailable = false;
    ownServices = [];
    portfolioItems = [];
    portfolioRemoteAvailable = false;
    scheduleRows = [];
    daysOff = [];
    clientNotes = new Map();
    clientLabels = new Map();
    pendingClientLabels = new Set();
    bookingOutcomes = new Map();
    bookingSessionItems = new Map();
    sessionItemsRemoteAvailable = false;
    bookingPolicy = { cancel_cutoff_hours: 12, reschedule_cutoff_hours: 12, max_reschedules: 2, deposit_enabled: false, deposit_amount_rub: 0, payment_url_template: '', auto_complete_visits: false };
    serverNotificationTemplates = {};
    serverNotificationMarks = {};
    notificationSettingsRemoteAvailable = false;
    notificationOutbox = [];
    notificationOutboxRemoteAvailable = false;
    return;
  }
  const userId = currentUser.id;
  const { data: profile } = await db.from('performer_profiles').select('display_name').eq('id', currentUser.id).single();
  if (!sessionIsCurrent(userId, generation)) return;
  const name = profile?.display_name || 'исполнитель';
  $('#welcomeName').textContent = `Здравствуйте, ${name}!`;
  $('#sidebarName').textContent = name;
  $('#userAvatar').textContent = name.slice(0, 1).toUpperCase();
  $('#accountEmail').textContent = currentUser.email || '';
  $('#todayLabel').textContent = parseLocalIsoDate(businessTodayIso()).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  renderDateStrip();
  renderNotificationTemplates();
  renderBookingPolicyForm();
  await providerCacheMaintenance;
  if (!sessionIsCurrent(userId, generation)) return;
  await synchronizeProvider();
  if (!sessionIsCurrent(userId, generation)) return;
  if (!bookingsChannel) startLiveUpdates();
}

async function login(event) {
  event.preventDefault();
  clearFormError('#loginError');
  const button = event.submitter;
  button.disabled = true;
  button.textContent = 'Входим…';
  const { error } = await db.auth.signInWithPassword({ email: $('#loginEmail').value.trim(), password: $('#loginPassword').value });
  button.disabled = false;
  button.textContent = 'Войти';
  if (error) showFormError('#loginError', 'Неверный email или пароль.');
}

async function signup(event) {
  event.preventDefault();
  clearFormError('#signupError');
  const name = $('#signupName').value.trim();
  if (name.length < 2) { showFormError('#signupError', 'Укажите имя исполнителя.'); return; }
  const button = event.submitter;
  button.disabled = true;
  button.textContent = 'Создаём…';
  const { data, error } = await db.auth.signUp({
    email: $('#signupEmail').value.trim(),
    password: $('#signupPassword').value,
    options: { data: { display_name: name }, emailRedirectTo: new URL('provider.html', location.href).href }
  });
  button.disabled = false;
  button.textContent = 'Создать кабинет';
  if (error) {
    showFormError('#signupError', error.message.includes('already') ? 'Этот email уже зарегистрирован.' : 'Не удалось создать кабинет. Проверьте данные.');
    return;
  }
  if (!data.session) { notify('Проверьте почту и подтвердите регистрацию'); setAuthTab('login'); }
}

async function requestPasswordReset(event) {
  event.preventDefault();
  clearFormError('#recoveryError');
  const email = $('#recoveryEmail').value.trim();
  const button = event.submitter;
  button.disabled = true;
  button.textContent = 'Отправляем…';
  const { error } = await db.auth.resetPasswordForEmail(email, {
    redirectTo: new URL('provider.html', location.href).href
  });
  button.disabled = false;
  button.textContent = 'Отправить ссылку';
  if (error) {
    showFormError('#recoveryError', 'Не удалось отправить письмо. Подождите немного и попробуйте снова.');
    return;
  }
  showRecoverySent();
}

async function completePasswordRecovery(event) {
  event.preventDefault();
  clearFormError('#resetPasswordError');
  const password = $('#recoveryNewPassword').value;
  const confirmation = $('#recoveryConfirmPassword').value;
  if (password.length < 8) {
    showFormError('#resetPasswordError', 'Пароль должен содержать не менее 8 символов.');
    return;
  }
  if (password !== confirmation) {
    showFormError('#resetPasswordError', 'Пароли не совпадают.');
    return;
  }
  const button = event.submitter;
  button.disabled = true;
  button.textContent = 'Сохраняем…';
  const { error } = await db.auth.updateUser({ password });
  button.disabled = false;
  button.textContent = 'Сохранить новый пароль';
  if (error) {
    showFormError('#resetPasswordError', 'Ссылка устарела или пароль не удалось сохранить. Запросите новое письмо.');
    return;
  }
  recoveryMode = false;
  await clearProviderDeviceData(currentUser?.id);
  await db.auth.signOut();
  history.replaceState({}, '', 'provider.html');
  setAuthTab('login');
  notify('Пароль изменён — войдите с новым паролем');
}

async function addService(event) {
  event.preventDefault();
  if (!requireWrites()) return;
  clearFormError('#serviceError');
  const name = $('#serviceName').value.trim();
  const price = Number($('#servicePrice').value);
  const duration = Number($('#serviceDuration').value);
  if (name.length < 2 || !Number.isFinite(duration) || duration < 1 || duration > 480 || !Number.isFinite(price) || price < 0) {
    showFormError('#serviceError', 'Укажите название, длительность и корректную цену.');
    return;
  }
  const button = event.submitter;
  button.disabled = true;
  const { error } = await db.from('services').insert({ performer_id: currentUser.id, name, price_rub: Math.round(price), duration_minutes: duration, active: true });
  button.disabled = false;
  if (error) { showFormError('#serviceError', 'Не удалось добавить услугу.'); return; }
  event.target.reset();
  $('#serviceDuration').value = '60';
  $('#serviceCreatorDialog').close();
  notify('Услуга добавлена');
  await refreshAfterWrite();
}

async function changePassword(event) {
  event.preventDefault();
  clearFormError('#passwordError');
  const currentPassword = $('#currentPassword').value;
  const newPassword = $('#newPassword').value;
  const confirmPassword = $('#confirmPassword').value;
  if (newPassword.length < 8) {
    showFormError('#passwordError', 'Новый пароль должен содержать не менее 8 символов.');
    return;
  }
  if (newPassword !== confirmPassword) {
    showFormError('#passwordError', 'Новые пароли не совпадают.');
    return;
  }
  if (currentPassword === newPassword) {
    showFormError('#passwordError', 'Новый пароль должен отличаться от текущего.');
    return;
  }
  const button = event.submitter;
  button.disabled = true;
  button.textContent = 'Проверяем…';
  const { error: signInError } = await db.auth.signInWithPassword({ email: currentUser.email, password: currentPassword });
  if (signInError) {
    button.disabled = false;
    button.textContent = 'Сохранить новый пароль';
    showFormError('#passwordError', 'Текущий пароль указан неверно.');
    return;
  }
  button.textContent = 'Сохраняем…';
  const { error } = await db.auth.updateUser({ password: newPassword });
  button.disabled = false;
  button.textContent = 'Сохранить новый пароль';
  if (error) {
    showFormError('#passwordError', 'Не удалось сменить пароль. Попробуйте другой пароль.');
    return;
  }
  event.target.reset();
  notify('Пароль успешно изменён');
}

function shortTime(value, fallback) { return value ? String(value).slice(0, 5) : fallback; }
function defaultScheduleRows(userId) {
  return Array.from({ length: 7 }, (_, index) => ({ performer_id: userId, weekday: index + 1, enabled: index > 0, start_time: '10:00', end_time: '20:00', break_start: null, break_end: null, slot_interval_minutes: 5 }));
}
function comparableSchedule(rows) {
  return rows.map(row => ({ weekday: Number(row.weekday), enabled: Boolean(row.enabled), start_time: shortTime(row.start_time, ''), end_time: shortTime(row.end_time, ''), break_start: shortTime(row.break_start, ''), break_end: shortTime(row.break_end, ''), slot_interval_minutes: Number(row.slot_interval_minutes || 5) })).sort((a, b) => a.weekday - b.weekday);
}

function renderSchedule() {
  const holder = $('#weeklySchedule');
  holder.innerHTML = scheduleRows.map(row => {
    const enabled = Boolean(row.enabled);
    const hasBreak = Boolean(row.break_start && row.break_end);
    return `<article class="schedule-day ${enabled ? '' : 'disabled'}" data-schedule-day="${row.weekday}">
      <label class="day-toggle"><input type="checkbox" data-schedule-enabled ${enabled ? 'checked' : ''}><span></span><strong>${weekdayNames[row.weekday - 1]}</strong></label>
      <div class="day-hours"><label>С<input type="time" data-schedule-start value="${shortTime(row.start_time, '10:00')}" ${enabled ? '' : 'disabled'}></label><label>До<input type="time" data-schedule-end value="${shortTime(row.end_time, '20:00')}" ${enabled ? '' : 'disabled'}></label></div>
      <label class="break-toggle"><input type="checkbox" data-schedule-break ${hasBreak ? 'checked' : ''} ${enabled ? '' : 'disabled'}><span>Перерыв</span></label>
      <div class="break-hours" ${hasBreak && enabled ? '' : 'hidden'}><input type="time" data-break-start value="${shortTime(row.break_start, '13:00')}"><span>—</span><input type="time" data-break-end value="${shortTime(row.break_end, '14:00')}"></div>
      <small class="day-off-label" ${enabled ? 'hidden' : ''}>Выходной</small>
    </article>`;
  }).join('');
}

async function loadSchedule() {
  const userId = currentUser?.id;
  const generation = sessionGeneration;
  if (!userId) return { ok: false };
  if (scheduleDirty && writesAllowed) return { ok: true, skipped: true };
  const { data, error } = await db.from('provider_schedule').select('*').eq('performer_id', userId).order('weekday');
  if (!sessionIsCurrent(userId, generation)) return { ok: false, stale: true };
  if (error) {
    const cached = await readProviderCache('schedule', userId);
    if (!sessionIsCurrent(userId, generation)) return { ok: false, stale: true };
    if (cached?.data?.length) {
      scheduleRows = cached.data;
      $('#slotInterval').value = String(scheduleRows[0]?.slot_interval_minutes || 5);
      renderSchedule();
      renderBookings();
      return { ok: false, cached: true, savedAt: cached.savedAt };
    }
    $('#weeklySchedule').innerHTML = '<div class="provider-empty"><strong>Расписание пока недоступно</strong><small>Соединение с сервером не установлено. Изменения не выполнялись.</small></div>';
    return { ok: false };
  }
  scheduleRows = data?.length ? data : defaultScheduleRows(userId);
  await saveProviderCache('schedule', scheduleRows, userId);
  if (!sessionIsCurrent(userId, generation)) return { ok: false, stale: true };
  $('#slotInterval').value = String(scheduleRows[0]?.slot_interval_minutes || 5);
  renderSchedule();
  renderBookings();
  return { ok: true };
}

async function saveSchedule() {
  if (!requireWrites()) return;
  const userId = currentUser.id;
  const generation = sessionGeneration;
  clearFormError('#scheduleError');
  const interval = Number($('#slotInterval').value);
  const rows = $$('[data-schedule-day]').map(card => {
    const enabled = card.querySelector('[data-schedule-enabled]').checked;
    const hasBreak = enabled && card.querySelector('[data-schedule-break]').checked;
    return {
      performer_id: userId,
      weekday: Number(card.dataset.scheduleDay),
      enabled,
      start_time: card.querySelector('[data-schedule-start]').value,
      end_time: card.querySelector('[data-schedule-end]').value,
      break_start: hasBreak ? card.querySelector('[data-break-start]').value : null,
      break_end: hasBreak ? card.querySelector('[data-break-end]').value : null,
      slot_interval_minutes: interval
    };
  });
  const invalid = rows.find(row => row.enabled && (row.end_time <= row.start_time || (row.break_start && (row.break_end <= row.break_start || row.break_start < row.start_time || row.break_end > row.end_time))));
  if (invalid) { showFormError('#scheduleError', 'Проверьте рабочие часы и время перерыва.'); return; }
  const button = $('#saveSchedule');
  button.dataset.operationDisabled = 'true';
  button.disabled = true;
  button.textContent = 'Проверяем…';
  const { data: serverSchedule, error: checkError } = await db.from('provider_schedule').select('*').eq('performer_id', userId).order('weekday');
  if (!sessionIsCurrent(userId, generation)) return;
  if (checkError) {
    button.disabled = false;
    delete button.dataset.operationDisabled;
    button.textContent = 'Сохранить';
    showFormError('#scheduleError', 'Не удалось проверить актуальность расписания. Изменения не сохранены.');
    return;
  }
  const serverRows = serverSchedule?.length ? serverSchedule : defaultScheduleRows(userId);
  if (JSON.stringify(comparableSchedule(serverRows)) !== JSON.stringify(comparableSchedule(scheduleRows))) {
    button.disabled = false;
    delete button.dataset.operationDisabled;
    button.textContent = 'Сохранить';
    showFormError('#scheduleError', 'Расписание изменилось на другом устройстве. Обновите данные и внесите изменения заново.');
    return;
  }
  button.textContent = 'Сохраняем…';
  const { error } = await db.from('provider_schedule').upsert(rows, { onConflict: 'performer_id,weekday' });
  if (!sessionIsCurrent(userId, generation)) return;
  button.disabled = false;
  delete button.dataset.operationDisabled;
  button.textContent = 'Сохранить';
  if (error) { showFormError('#scheduleError', 'Не удалось сохранить расписание.'); return; }
  scheduleRows = rows;
  scheduleDirty = false;
  await saveProviderCache('schedule', scheduleRows, userId);
  if (!sessionIsCurrent(userId, generation)) return;
  notify('Расписание сохранено');
}

function renderDaysOff() {
  const holder = $('#daysOffList');
  if (!daysOff.length) {
    holder.innerHTML = `<div class="provider-empty compact-empty"><span class="provider-empty-icon">${uiIcon('check')}</span><strong>Исключений нет</strong><small>Онлайн-запись работает по обычному расписанию.</small></div>`;
    return;
  }
  holder.innerHTML = daysOff.map(item => {
    const date = new Date(`${item.off_date}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' });
    const period = item.all_day ? 'Весь день' : `${shortTime(item.start_time, '')}–${shortTime(item.end_time, '')}`;
    return `<article class="day-off-item"><div><strong>${date}</strong><span>${period}${item.note ? ` · ${escapeHtml(item.note)}` : ''}</span></div><button type="button" data-delete-day-off="${item.id}" aria-label="Удалить исключение">${uiIcon('trash')}</button></article>`;
  }).join('');
}

async function loadDaysOff() {
  const userId = currentUser?.id;
  const generation = sessionGeneration;
  if (!userId) return { ok: false };
  const { data, error } = await db.from('provider_days_off').select('*').eq('performer_id', userId).gte('off_date', businessTodayIso()).order('off_date');
  if (!sessionIsCurrent(userId, generation)) return { ok: false, stale: true };
  if (error) {
    const cached = await readProviderCache('days-off', userId);
    if (!sessionIsCurrent(userId, generation)) return { ok: false, stale: true };
    if (cached?.data) {
      daysOff = cached.data;
      renderDaysOff();
      return { ok: false, cached: true, savedAt: cached.savedAt };
    }
    $('#daysOffList').innerHTML = '<div class="provider-empty compact-empty">Не удалось загрузить исключения.</div>';
    return { ok: false };
  }
  daysOff = data || [];
  await saveProviderCache('days-off', daysOff, userId);
  if (!sessionIsCurrent(userId, generation)) return { ok: false, stale: true };
  renderDaysOff();
  return { ok: true };
}

async function addDayOff(event) {
  event.preventDefault();
  if (!requireWrites()) return;
  clearFormError('#dayOffError');
  const allDay = $('#dayOffAllDay').checked;
  const date = $('#dayOffDate').value;
  const start = $('#dayOffStart').value;
  const end = $('#dayOffEnd').value;
  if (!date || (!allDay && (!start || !end || end <= start))) { showFormError('#dayOffError', 'Укажите корректную дату и время.'); return; }
  const button = event.submitter;
  button.disabled = true;
  const { error } = await db.from('provider_days_off').insert({ performer_id: currentUser.id, off_date: date, all_day: allDay, start_time: allDay ? null : start, end_time: allDay ? null : end, note: $('#dayOffNote').value.trim() });
  button.disabled = false;
  if (error) { showFormError('#dayOffError', 'Не удалось закрыть выбранное время.'); return; }
  event.target.reset();
  $('#dayOffAllDay').checked = true;
  $('#dayOffTime').hidden = true;
  $('#dayOffDate').min = businessTodayIso();
  notify('Исключение добавлено');
  await refreshAfterWrite();
}

function portfolioPhoto(item, type) { return (item.photos || []).find(photo => photo.photo_type === type); }
function portfolioSessionWord(value) { const number = Math.abs(Number(value)); return number % 10 === 1 && number % 100 !== 11 ? 'сеанс' : number % 10 >= 2 && number % 10 <= 4 && (number % 100 < 12 || number % 100 > 14) ? 'сеанса' : 'сеансов'; }
function portfolioAfterSessionWord(value) { const number = Math.abs(Number(value)); return number % 10 === 1 && number % 100 !== 11 ? 'сеанса' : 'сеансов'; }
function portfolioAfterLabel(item) { return item.session_count ? `После ${item.session_count} ${portfolioAfterSessionWord(item.session_count)}` : 'После'; }
function portfolioPhotoMarkup(item, type) {
  const photo = portfolioPhoto(item, type);
  const label = type === 'before' ? 'До' : portfolioAfterLabel(item);
  if (!photo?.signed_url) return `<div class="portfolio-photo"><div class="portfolio-photo-empty">Фото «${label}» не добавлено</div><span>${label}</span></div>`;
  return `<figure class="portfolio-photo"><img src="${escapeHtml(photo.signed_url)}" alt="${escapeHtml(photo.alt_text || `${item.procedure_name} — ${label.toLowerCase()}`)}" loading="lazy"><span>${label}</span></figure>`;
}

function renderPortfolio() {
  const list = $('#portfolioManageList');
  if (!list) return;
  const publishedCount = portfolioItems.filter(item => item.published).length;
  $('#portfolioCount').textContent = String(portfolioItems.length);
  $('#portfolioBadge').textContent = String(portfolioItems.length);
  const availability = $('#portfolioAvailability');
  availability.hidden = portfolioRemoteAvailable;
  availability.textContent = portfolioRemoteAvailable ? '' : 'Портфолио пока недоступно: серверная часть ещё не подключена или связь прервана.';
  if (!portfolioRemoteAvailable) {
    list.innerHTML = `<div class="provider-empty"><span class="provider-empty-icon">${uiIcon('image')}</span><strong>Портфолио не загружено</strong><small>Основные функции кабинета продолжают работать.</small></div>`;
    return;
  }
  if (!portfolioItems.length) {
    list.innerHTML = `<div class="provider-empty"><span class="provider-empty-icon">${uiIcon('plus')}</span><strong>Работ пока нет</strong><small>Добавьте фотографии «До» и «После» и укажите число сеансов.</small></div>`;
    return;
  }
  list.innerHTML = portfolioItems.map((item, index) => `<article class="portfolio-card" draggable="true" data-portfolio-card="${item.id}">
    <div class="portfolio-card-photos">${portfolioPhotoMarkup(item, 'before')}${portfolioPhotoMarkup(item, 'after')}</div>
    <div class="portfolio-card-body"><h3>${escapeHtml(item.procedure_name)}</h3><small>${escapeHtml(item.body_area || 'Зона не указана')}${item.session_count ? ` · ${item.session_count} ${portfolioSessionWord(item.session_count)}` : ''}</small>${item.description ? `<p>${escapeHtml(item.description)}</p>` : ''}<span class="portfolio-card-status ${item.published ? 'published' : ''}">${item.published ? 'Опубликовано' : 'Черновик'}</span></div>
    <div class="portfolio-card-actions"><button type="button" data-portfolio-move="up" data-portfolio-id="${item.id}" ${index === 0 ? 'disabled' : ''} aria-label="Переместить работу выше">↑ Выше</button><button type="button" data-portfolio-move="down" data-portfolio-id="${item.id}" ${index === portfolioItems.length - 1 ? 'disabled' : ''} aria-label="Переместить работу ниже">↓ Ниже</button><button class="portfolio-edit" type="button" data-edit-portfolio="${item.id}">Изменить</button><button class="danger" type="button" data-delete-portfolio="${item.id}">Удалить</button></div>
  </article>`).join('');
  $('#portfolioOrderStatus').textContent = `${portfolioItems.length} работ, опубликовано ${publishedCount}`;
  applyWriteAvailability();
}

async function signedPortfolioUrl(path) {
  const { data, error } = await db.storage.from(PORTFOLIO_BUCKET).createSignedUrl(path, 3600);
  return error ? '' : data?.signedUrl || '';
}

async function loadPortfolio() {
  const userId = currentUser?.id;
  const generation = sessionGeneration;
  if (!userId) return { ok: false, optional: true };
  const [{ data: items, error: itemsError }, { data: photos, error: photosError }] = await Promise.all([
    db.from('portfolio_items').select('*').eq('performer_id', userId).order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
    db.from('portfolio_photos').select('*').eq('performer_id', userId).order('created_at', { ascending: true })
  ]);
  if (!sessionIsCurrent(userId, generation)) return { ok: false, optional: true, stale: true };
  if (itemsError || photosError) {
    portfolioRemoteAvailable = false;
    portfolioItems = [];
    renderPortfolio();
    return { ok: false, optional: true };
  }
  const signedPhotos = await Promise.all((photos || []).map(async photo => ({ ...photo, signed_url: await signedPortfolioUrl(photo.storage_path) })));
  if (!sessionIsCurrent(userId, generation)) return { ok: false, optional: true, stale: true };
  portfolioItems = (items || []).map(item => ({ ...item, photos: signedPhotos.filter(photo => photo.portfolio_item_id === item.id) }));
  portfolioRemoteAvailable = true;
  renderPortfolio();
  return { ok: true, optional: true };
}

function renderProviderReviews() {
  const list = $('#providerReviewsList');
  if (!list) return;
  $('#providerReviewsCount').textContent = String(providerReviews.length);
  if (!providerReviews.length) {
    list.innerHTML = '<div class="provider-empty"><strong>Отзывов пока нет</strong><small>Здесь появятся отзывы после завершённых визитов.</small></div>';
    return;
  }
  list.innerHTML = providerReviews.map(review => {
    const rating = Math.max(1, Math.min(5, Number(review.rating) || 1));
    const created = new Date(review.created_at).toLocaleDateString('ru-RU', { day:'numeric', month:'long', year:'numeric' });
    return `<article class="provider-review-card ${review.published ? '' : 'unpublished'}">
      <div class="provider-review-head"><div><strong>${escapeHtml(review.client_name || 'Клиент')}</strong><small>${escapeHtml(review.service_name || 'Услуга')} · ${escapeHtml(created)}</small></div><span aria-label="Оценка ${rating} из 5">${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}</span></div>
      ${review.review_text ? `<p>${escapeHtml(review.review_text)}</p>` : '<p class="provider-review-empty">Отзыв оставлен без текста.</p>'}
      <button type="button" data-review-visibility="${review.review_id}" data-review-published="${review.published ? 'true' : 'false'}">${review.published ? 'Скрыть с сайта' : 'Опубликовать на сайте'}</button>
    </article>`;
  }).join('');
  applyWriteAvailability();
}

async function loadProviderReviews() {
  const userId = currentUser?.id;
  const generation = sessionGeneration;
  if (!userId) return { ok:false, optional:true };
  const { data, error } = await db.rpc('get_provider_booking_reviews');
  if (!sessionIsCurrent(userId, generation)) return { ok:false, optional:true, stale:true };
  providerReviews = error ? [] : (data || []);
  renderProviderReviews();
  return { ok:!error, optional:true };
}

function clearPortfolioPreviews() {
  portfolioPreviewUrls.forEach(url => URL.revokeObjectURL(url));
  portfolioPreviewUrls = [];
  portfolioPhotoDrafts = { before: null, after: null };
}

function setPortfolioPreview(type, source = '') {
  const preview = type === 'before' ? $('#portfolioBeforePreview') : $('#portfolioAfterPreview');
  const field = preview.closest('.portfolio-photo-field');
  preview.src = source;
  preview.hidden = !source;
  field.querySelector('.portfolio-photo-placeholder').hidden = Boolean(source);
}

function updatePortfolioPublishControl() {
  const consent = $('#portfolioConsent').checked;
  const published = $('#portfolioPublished');
  if (!consent) published.checked = false;
  published.disabled = !consent;
}

function openPortfolioEditor(id = '') {
  if (!portfolioRemoteAvailable) { notify('Сначала подключите серверную часть портфолио'); return; }
  const item = portfolioItems.find(entry => entry.id === id);
  clearPortfolioPreviews();
  $('#portfolioForm').reset();
  $('#portfolioItemId').value = item?.id || '';
  $('#portfolioProcedure').value = item?.procedure_name || '';
  $('#portfolioArea').value = item?.body_area || '';
  $('#portfolioSessions').value = item?.session_count || '';
  $('#portfolioDescription').value = item?.description || '';
  $('#portfolioConsent').checked = Boolean(item?.consent_confirmed_at);
  $('#portfolioPublished').checked = Boolean(item?.published);
  $('#portfolioEditorTitle').textContent = item ? 'Редактирование работы' : 'Новая работа';
  setPortfolioPreview('before', portfolioPhoto(item || {}, 'before')?.signed_url || '');
  setPortfolioPreview('after', portfolioPhoto(item || {}, 'after')?.signed_url || '');
  updatePortfolioPublishControl();
  clearFormError('#portfolioError');
  $('#portfolioEditorDialog').showModal();
  setTimeout(() => $('#portfolioProcedure').focus(), 0);
}

function closePortfolioEditor() {
  $('#portfolioEditorDialog').close();
  clearPortfolioPreviews();
}

function handlePortfolioFile(type, file) {
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    showFormError('#portfolioError', 'Выберите изображение JPEG, PNG или WebP.');
    return;
  }
  if (file.size > PORTFOLIO_INPUT_LIMIT) {
    showFormError('#portfolioError', 'Исходная фотография должна быть не больше 12 МБ.');
    return;
  }
  clearFormError('#portfolioError');
  portfolioPhotoDrafts[type] = file;
  const url = URL.createObjectURL(file);
  portfolioPreviewUrls.push(url);
  setPortfolioPreview(type, url);
}

async function decodePortfolioImage(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch {}
  }
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image_decode_failed')); };
    image.src = url;
  });
}

async function preparePortfolioImage(file) {
  const image = await decodePortfolioImage(file);
  const sourceWidth = image.width;
  const sourceHeight = image.height;
  const scale = Math.min(1, PORTFOLIO_MAX_EDGE / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  image.close?.();
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', .84));
  if (!blob || blob.size > PORTFOLIO_OUTPUT_LIMIT) throw new Error('image_too_large');
  return { blob, width, height };
}

function createPortfolioPhotoId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function savePortfolioPhoto(item, type, file, procedure, area, sessions) {
  if (!file) return;
  const prepared = await preparePortfolioImage(file);
  const photoId = createPortfolioPhotoId();
  const path = `${currentUser.id}/${item.id}/${photoId}.webp`;
  const { error: uploadError } = await db.storage.from(PORTFOLIO_BUCKET).upload(path, prepared.blob, { contentType: 'image/webp', cacheControl: '31536000', upsert: false });
  if (uploadError) throw uploadError;
  const existing = portfolioPhoto(item, type);
  const label = type === 'before' ? 'до процедуры' : sessions ? `после ${sessions} ${portfolioAfterSessionWord(sessions)}` : 'после процедуры';
  const record = { performer_id: currentUser.id, portfolio_item_id: item.id, photo_type: type, storage_path: path, alt_text: `${procedure}${area ? `, ${area}` : ''} — ${label}`, width: prepared.width, height: prepared.height };
  const result = existing
    ? await db.from('portfolio_photos').update(record).eq('id', existing.id).eq('performer_id', currentUser.id)
    : await db.from('portfolio_photos').insert(record);
  if (result.error) {
    await db.storage.from(PORTFOLIO_BUCKET).remove([path]);
    throw result.error;
  }
  if (existing?.storage_path) await db.storage.from(PORTFOLIO_BUCKET).remove([existing.storage_path]);
}

async function savePortfolioItem(event) {
  event.preventDefault();
  if (!requireWrites() || !portfolioRemoteAvailable) return;
  clearFormError('#portfolioError');
  const id = $('#portfolioItemId').value;
  const existing = portfolioItems.find(item => item.id === id);
  const procedure = $('#portfolioProcedure').value.trim();
  const area = $('#portfolioArea').value.trim();
  const sessions = $('#portfolioSessions').value ? Number($('#portfolioSessions').value) : null;
  const description = $('#portfolioDescription').value.trim();
  const consent = $('#portfolioConsent').checked;
  const published = $('#portfolioPublished').checked;
  const hasPhoto = Boolean(existing?.photos?.length || portfolioPhotoDrafts.before || portfolioPhotoDrafts.after);
  if (procedure.length < 2) { showFormError('#portfolioError', 'Укажите название процедуры.'); return; }
  if (sessions !== null && (!Number.isInteger(sessions) || sessions < 1 || sessions > 999)) { showFormError('#portfolioError', 'Количество сеансов должно быть от 1 до 999.'); return; }
  if (!hasPhoto) { showFormError('#portfolioError', 'Добавьте хотя бы одну фотографию работы.'); return; }
  if (published && !consent) { showFormError('#portfolioError', 'Для публикации подтвердите согласие клиента.'); return; }
  const button = event.submitter;
  button.disabled = true;
  button.textContent = 'Сохраняем…';
  let createdItemId = '';
  try {
    let item = existing;
    if (!item) {
      const nextOrder = portfolioItems.reduce((max, entry) => Math.max(max, Number(entry.sort_order) || 0), 0) + 10;
      const { data, error } = await db.from('portfolio_items').insert({ performer_id: currentUser.id, procedure_name: procedure, body_area: area, session_count: sessions, description, sort_order: nextOrder, published: false, consent_confirmed_at: consent ? new Date().toISOString() : null }).select().single();
      if (error) throw error;
      item = { ...data, photos: [] };
      createdItemId = item.id;
    }
    await savePortfolioPhoto(item, 'before', portfolioPhotoDrafts.before, procedure, area, sessions);
    await savePortfolioPhoto(item, 'after', portfolioPhotoDrafts.after, procedure, area, sessions);
    const consentAt = consent ? item.consent_confirmed_at || new Date().toISOString() : null;
    const { error } = await db.from('portfolio_items').update({ procedure_name: procedure, body_area: area, session_count: sessions, description, published, consent_confirmed_at: consentAt }).eq('id', item.id).eq('performer_id', currentUser.id);
    if (error) throw error;
    closePortfolioEditor();
    await loadPortfolio();
    notify(published ? 'Работа опубликована' : 'Работа сохранена');
  } catch (error) {
    if (createdItemId) {
      const { data: createdPhotos } = await db.from('portfolio_photos').select('storage_path').eq('portfolio_item_id', createdItemId).eq('performer_id', currentUser.id);
      const paths = (createdPhotos || []).map(photo => photo.storage_path).filter(Boolean);
      if (paths.length) await db.storage.from(PORTFOLIO_BUCKET).remove(paths);
      await db.from('portfolio_items').delete().eq('id', createdItemId).eq('performer_id', currentUser.id);
    } else if (existing) {
      await loadPortfolio();
    }
    const message = error?.message === 'image_too_large' ? 'После обработки фотография всё ещё слишком большая.' : 'Не удалось сохранить работу. Проверьте соединение и попробуйте снова.';
    showFormError('#portfolioError', message);
  } finally {
    button.disabled = false;
    button.textContent = 'Сохранить работу';
  }
}

async function deletePortfolioItem(id) {
  if (!requireWrites()) return;
  const item = portfolioItems.find(entry => entry.id === id);
  if (!item || !confirm('Удалить эту работу и связанные фотографии?')) return;
  const paths = (item.photos || []).map(photo => photo.storage_path).filter(Boolean);
  if (paths.length) {
    const { error } = await db.storage.from(PORTFOLIO_BUCKET).remove(paths);
    if (error) { notify('Не удалось удалить фотографии'); return; }
  }
  const { error } = await db.from('portfolio_items').delete().eq('id', id).eq('performer_id', currentUser.id);
  if (error) { notify('Не удалось удалить работу'); return; }
  notify('Работа удалена');
  await loadPortfolio();
}

async function persistPortfolioOrder(message = 'Порядок работ сохранён') {
  const { error } = await db.rpc('reorder_portfolio_items', { p_ids: portfolioItems.map(item => item.id) });
  if (error) {
    notify('Не удалось сохранить порядок');
    await loadPortfolio();
    return;
  }
  $('#portfolioOrderStatus').textContent = message;
}

async function movePortfolioItem(id, direction) {
  if (!requireWrites()) return;
  const index = portfolioItems.findIndex(item => item.id === id);
  const target = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= portfolioItems.length) return;
  [portfolioItems[index], portfolioItems[target]] = [portfolioItems[target], portfolioItems[index]];
  renderPortfolio();
  await persistPortfolioOrder(`Работа перемещена ${direction === 'up' ? 'выше' : 'ниже'}`);
}

function renderOwnServices() {
  const list = $('#serviceManageList');
  populateRepeatServices();
  const activeCount = ownServices.filter(item => item.active).length;
  $('#servicesCount').textContent = String(ownServices.length);
  $('#servicesBadge').textContent = String(ownServices.length);
  $('#activeServicesCount').textContent = String(activeCount);
  if (!ownServices.length) {
    list.innerHTML = `<div class="provider-empty"><span class="provider-empty-icon">${uiIcon('plus')}</span><strong>Услуг пока нет</strong><small>Добавьте первую — она сразу появится у клиентов.</small></div>`;
    return;
  }
  list.innerHTML = ownServices.map(item => `<article class="managed-service ${item.active ? '' : 'inactive'}"><button class="service-info service-edit-target" type="button" data-edit-service="${item.id}" aria-label="Изменить услугу ${escapeHtml(serviceName(item.name))}"><div><strong>${escapeHtml(serviceName(item.name))}</strong><small>${Number(item.duration_minutes) === 1 ? `Поминутно · ${money(item.price_rub)}/мин` : `${item.duration_minutes} мин · ${money(item.price_rub)}`}</small></div></button><div class="manage-actions"><button class="service-visibility-toggle" type="button" data-toggle-service="${item.id}" data-active="${item.active}" aria-label="${item.active ? 'Скрыть услугу от клиентов' : 'Показать услугу клиентам'}"><i aria-hidden="true"></i><span>${item.active ? 'Доступна' : 'Скрыта'}</span></button><details class="service-more"><summary aria-label="Другие действия">${uiIcon('more')}</summary><div><button class="danger" type="button" data-delete-service="${item.id}">${uiIcon('trash')}<span>Удалить</span></button></div></details></div></article>`).join('');
}

async function loadOwnServices(options = {}) {
  const list = $('#serviceManageList');
  const userId = currentUser?.id;
  const generation = sessionGeneration;
  if (!userId) return { ok: false };
  if (!options.silent) list.innerHTML = '<div class="loading-state"><i></i><span>Загружаем…</span></div>';
  const { data, error } = await db.from('services').select('*').eq('performer_id', userId).order('created_at', { ascending: false });
  if (!sessionIsCurrent(userId, generation)) return { ok: false, stale: true };
  if (error) {
    const cached = await readProviderCache('services', userId);
    if (!sessionIsCurrent(userId, generation)) return { ok: false, stale: true };
    if (cached?.data) {
      ownServices = cached.data;
      renderOwnServices();
      return { ok: false, cached: true, savedAt: cached.savedAt };
    }
    list.innerHTML = '<div class="provider-empty">Не удалось загрузить услуги.</div>';
    return { ok: false };
  }
  ownServices = data || [];
  await saveProviderCache('services', ownServices, userId);
  if (!sessionIsCurrent(userId, generation)) return { ok: false, stale: true };
  renderOwnServices();
  return { ok: true };
}

async function loadBookings(options = {}) {
  const holder = $('#providerBookings');
  const userId = currentUser?.id;
  const generation = sessionGeneration;
  const revision = ++bookingsRequestRevision;
  if (!userId) return { ok: false };
  if (!options.silent) holder.innerHTML = '<div class="loading-state"><i></i><span>Загружаем записи…</span></div>';
  let { data, error } = await db.from('bookings')
    .select('id,booking_code,service_id,client_name,client_phone,booking_date,booking_time,duration_minutes,original_price_rub,total_price_rub,status,created_at,reschedule_count,deposit_amount_rub,payment_status,payment_url,services(name,price_rub,duration_minutes)')
    .eq('performer_id', userId)
    .order('booking_date', { ascending: true })
    .order('booking_time', { ascending: true });
  if (error) ({ data, error } = await db.from('bookings')
    .select('id,booking_code,service_id,client_name,client_phone,booking_date,booking_time,duration_minutes,status,created_at,reschedule_count,deposit_amount_rub,payment_status,payment_url,services(name,price_rub,duration_minutes)')
    .eq('performer_id', userId)
    .order('booking_date', { ascending:true })
    .order('booking_time', { ascending:true }));
  if (!sessionIsCurrent(userId, generation) || revision !== bookingsRequestRevision) return { ok: false, stale: true };
  if (error) {
    const cached = await readProviderCache('bookings', userId);
    if (!sessionIsCurrent(userId, generation) || revision !== bookingsRequestRevision) return { ok: false, stale: true };
    if (cached?.data) {
      allBookings = cached.data;
      renderBookingData();
      return { ok: false, cached: true, savedAt: cached.savedAt };
    }
    holder.innerHTML = '<div class="provider-empty"><strong>Не удалось загрузить записи</strong><small>Соединение с сервером не установлено. Попробуйте ещё раз.</small></div>';
    return { ok: false };
  }
  allBookings = data || [];
  await loadRemoteBookingColors(userId, generation);
  if (!sessionIsCurrent(userId, generation) || revision !== bookingsRequestRevision) return { ok: false, stale: true };
  await saveProviderCache('bookings', allBookings, userId);
  if (!sessionIsCurrent(userId, generation) || revision !== bookingsRequestRevision) return { ok: false, stale: true };
  renderBookingData();
  return { ok: true };
}

function waitlistPeriodLabel(value) {
  return ({ any: 'Любое время', morning: 'Утро · 10:00–12:00', day: 'День · 12:00–17:00', evening: 'Вечер · 17:00–20:00' })[value] || 'Любое время';
}

function renderWaitlist() {
  const holder = $('#waitlistList');
  if (!holder) return;
  const active = waitlistRequests.filter(item => ['waiting', 'contacted'].includes(item.status));
  $('#waitlistCount').textContent = String(active.length);
  const badge = $('#waitlistBadge');
  badge.textContent = String(active.length);
  badge.hidden = !active.length;
  if (!waitlistRemoteAvailable) {
    holder.innerHTML = '<div class="provider-empty"><strong>Лист ожидания недоступен</strong><small>Обновите страницу после установки серверного обновления.</small></div>';
    return;
  }
  if (!active.length) {
    holder.innerHTML = '<div class="provider-empty"><strong>Заявок пока нет</strong><small>Когда клиент не найдёт время, он сможет оставить здесь удобную дату.</small></div>';
    return;
  }
  const statusLabels = { waiting: 'Ожидает', contacted: 'Связались' };
  holder.innerHTML = active.map(item => {
    const date = new Date(`${item.desired_date}T12:00:00`).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' });
    const phone = String(item.client_phone || '');
    const whatsapp = phone.replace(/\D/g, '') ? `https://wa.me/${phone.replace(/\D/g, '')}` : '';
    return `<article class="waitlist-provider-card"><div class="waitlist-provider-date"><strong>${escapeHtml(date)}</strong><span>${escapeHtml(waitlistPeriodLabel(item.time_period))}</span></div><div class="waitlist-provider-client"><small>${escapeHtml(item.services?.name || 'Услуга')}</small><strong>${escapeHtml(item.client_name)}</strong><a href="tel:+${escapeHtml(phone)}">+${escapeHtml(phone)}</a></div><span class="waitlist-status status-${escapeHtml(item.status)}">${statusLabels[item.status] || escapeHtml(item.status)}</span><div class="waitlist-provider-actions">${whatsapp ? `<a class="secondary-button" href="${whatsapp}" target="_blank" rel="noopener noreferrer">WhatsApp</a>` : ''}${item.status === 'waiting' ? `<button class="secondary-button" type="button" data-waitlist-status="contacted" data-waitlist-id="${item.id}">Связались</button>` : ''}<button class="primary compact-button" type="button" data-waitlist-status="booked" data-waitlist-id="${item.id}">Записан</button><button class="booking-cancel-action" type="button" data-waitlist-status="closed" data-waitlist-id="${item.id}">Закрыть</button></div></article>`;
  }).join('');
  applyWriteAvailability();
}

async function loadWaitlist() {
  const userId = currentUser?.id;
  if (!userId) return { ok: false, optional: true };
  const { data, error } = await db.from('booking_waitlist_requests')
    .select('id,request_code,client_name,client_phone,desired_date,time_period,status,created_at,services(name)')
    .eq('performer_id', userId)
    .in('status', ['waiting', 'contacted'])
    .order('desired_date', { ascending: true })
    .order('created_at', { ascending: true });
  if (currentUser?.id !== userId) return { ok: false, optional: true, stale: true };
  waitlistRemoteAvailable = !error;
  waitlistRequests = error ? [] : (data || []);
  renderWaitlist();
  return { ok: !error, optional: true };
}

document.addEventListener('click', async event => {
  const authTab = event.target.closest('[data-auth-tab]');
  const view = event.target.closest('[data-provider-view]');
  const notificationFilterButton = event.target.closest('[data-notification-filter]');
  const reportPeriodButton = event.target.closest('[data-report-period]');
  const openNotificationTemplates = event.target.closest('[data-open-notification-templates]');
  const closeNotificationTemplates = event.target.closest('[data-close-notification-templates]');
  const openServiceCreator = event.target.closest('[data-open-service-creator]');
  const closeServiceCreator = event.target.closest('[data-close-service-creator]');
  const openPortfolioEditorButton = event.target.closest('[data-open-portfolio-editor]');
  const closePortfolioEditorButton = event.target.closest('[data-close-portfolio-editor]');
  const editPortfolio = event.target.closest('[data-edit-portfolio]');
  const deletePortfolio = event.target.closest('[data-delete-portfolio]');
  const movePortfolio = event.target.closest('[data-portfolio-move]');
  const openNotification = event.target.closest('[data-open-notification]');
  const sentNotification = event.target.closest('[data-sent-notification]');
  const restoreNotification = event.target.closest('[data-restore-notification]');
  const retryOutboxNotification = event.target.closest('[data-retry-notification-outbox]');
  const filter = event.target.closest('[data-filter]');
  const journalView = event.target.closest('[data-journal-mode]');
  const date = event.target.closest('[data-booking-date]');
  const dateShift = event.target.closest('[data-date-shift]');
  const dateToday = event.target.closest('[data-date-today]');
  const openBooking = event.target.closest('[data-open-booking]');
  const timelineStage = event.target.closest('[data-create-booking-at]');
  const editBooking = event.target.closest('[data-edit-booking]');
  const editBookingSession = event.target.closest('[data-edit-booking-session]');
  const addSessionItem = event.target.closest('[data-add-session-item]');
  const removeSessionItem = event.target.closest('[data-remove-session-item]');
  const backBooking = event.target.closest('[data-back-booking]');
  const editTime = event.target.closest('[data-edit-booking-time]');
  const newTime = event.target.closest('[data-new-booking-time]');
  const newHour = event.target.closest('[data-new-booking-hour]');
  const closeSheet = event.target.closest('[data-close-booking-sheet]');
  const toggle = event.target.closest('[data-toggle-service]');
  const editService = event.target.closest('[data-edit-service]');
  const remove = event.target.closest('[data-delete-service]');
  const removeDayOff = event.target.closest('[data-delete-day-off]');
  const booking = event.target.closest('[data-booking-status]');
  const deleteBookingButton = event.target.closest('[data-delete-booking]');
  const waitlistStatus = event.target.closest('[data-waitlist-status]');
  const reviewVisibility = event.target.closest('[data-review-visibility]');
  const client = event.target.closest('[data-client-phone]');
  const repeat = event.target.closest('[data-repeat-time]');
  if (authTab) setAuthTab(authTab.dataset.authTab);
  if (view) setProviderView(view.dataset.providerView);
  if (notificationFilterButton) {
    notificationFilter = notificationFilterButton.dataset.notificationFilter;
    $$('[data-notification-filter]').forEach(button => button.classList.toggle('active', button === notificationFilterButton));
    renderNotifications();
  }
  if (reportPeriodButton) {
    reportPeriod = reportPeriodButton.dataset.reportPeriod;
    $$('[data-report-period]').forEach(button => button.classList.toggle('active', button === reportPeriodButton));
    renderAnalytics();
  }
  if (openNotificationTemplates) {
    renderNotificationTemplates();
    $('#notificationTemplatesDialog').showModal();
  }
  if (closeNotificationTemplates) $('#notificationTemplatesDialog').close();
  if (openServiceCreator) {
    $('#serviceForm').reset();
    $('#serviceDuration').value = '60';
    clearFormError('#serviceError');
    $('#serviceCreatorDialog').showModal();
  }
  if (closeServiceCreator) $('#serviceCreatorDialog').close();
  if (openPortfolioEditorButton) openPortfolioEditor();
  if (closePortfolioEditorButton) closePortfolioEditor();
  if (editPortfolio) openPortfolioEditor(editPortfolio.dataset.editPortfolio);
  if (movePortfolio) await movePortfolioItem(movePortfolio.dataset.portfolioId, movePortfolio.dataset.portfolioMove);
  if (deletePortfolio) await deletePortfolioItem(deletePortfolio.dataset.deletePortfolio);
  if (openNotification) {
    await setNotificationMark(openNotification.dataset.openNotification, 'opened');
    setTimeout(renderNotifications, 0);
  }
  if (sentNotification) {
    await setNotificationMark(sentNotification.dataset.sentNotification, 'sent');
    renderNotifications();
    notify('Уведомление отмечено отправленным');
  }
  if (restoreNotification) {
    await setNotificationMark(restoreNotification.dataset.restoreNotification, '');
    renderNotifications();
    notify('Уведомление возвращено в очередь');
  }
  if (retryOutboxNotification) await retryAutomaticNotification(retryOutboxNotification.dataset.retryNotificationOutbox, retryOutboxNotification);
  if (filter) setFilter(filter.dataset.filter);
  if (journalView) setJournalMode(journalView.dataset.journalMode);
  if (dateShift) shiftScheduleDate(Number(dateShift.dataset.dateShift));
  if (dateToday) selectScheduleDate(businessTodayIso());
  if (date) selectScheduleDate(date.dataset.bookingDate);
  if (openBooking) openBookingSheet(openBooking.dataset.openBooking);
  if (timelineStage && !openBooking) openTimelineBooking(timelineStage, event);
  if (editBooking) openBookingEditor(editBooking.dataset.editBooking);
  if (editBookingSession) openSessionComposer(editBookingSession.dataset.editBookingSession);
  if (addSessionItem) {
    const form = addSessionItem.closest('#sessionComposerForm');
    sessionComposerDraft = readSessionComposerDraft();
    sessionComposerDraft.push({ kind:'addon', service_id:'', title:'Дополнительная услуга', duration_minutes:0, price_rub:0, extends_duration:false });
    renderSessionComposer(form.dataset.bookingId);
  }
  if (removeSessionItem) {
    const form = removeSessionItem.closest('#sessionComposerForm');
    sessionComposerDraft = readSessionComposerDraft().filter((_, index) => index !== Number(removeSessionItem.dataset.removeSessionItem));
    renderSessionComposer(form.dataset.bookingId);
  }
  if (backBooking) openBookingSheet(backBooking.dataset.backBooking);
  if (editTime) {
    bookingEditTime = editTime.dataset.editBookingTime;
    $$('[data-edit-booking-time]').forEach(button => button.classList.toggle('active', button.dataset.editBookingTime === bookingEditTime));
  }
  if (newTime) {
    newBookingTime = newTime.dataset.newBookingTime;
    newBookingPreferredTime = newBookingTime;
    $$('[data-new-booking-time]').forEach(button => button.classList.toggle('active', button.dataset.newBookingTime === newBookingTime));
    clearFormError('#newBookingError');
  }
  if (newHour) {
    newBookingHour = newHour.dataset.newBookingHour;
    if (!newBookingTime.startsWith(`${newBookingHour}:`)) newBookingTime = newBookingSlots.find(time => time.startsWith(`${newBookingHour}:`)) || '';
    renderNewBookingTimePicker();
    clearFormError('#newBookingError');
  }
  if (closeSheet) closeBookingSheet();
  if (editService) openServiceEditor(editService.dataset.editService);
  if (client) renderClientDetail(client.dataset.clientPhone);
  if (repeat) {
    repeatTime = repeat.dataset.repeatTime;
    $$('[data-repeat-time]').forEach(button => button.classList.toggle('active', button.dataset.repeatTime === repeatTime));
  }
  if ((toggle || remove || removeDayOff || booking || deleteBookingButton || waitlistStatus || reviewVisibility) && !requireWrites()) return;
  if (reviewVisibility) {
    reviewVisibility.disabled = true;
    const publish = reviewVisibility.dataset.reviewPublished !== 'true';
    const { error } = await db.rpc('set_booking_review_published', { p_review:reviewVisibility.dataset.reviewVisibility, p_published:publish });
    reviewVisibility.disabled = false;
    if (error) { notify('Не удалось изменить видимость отзыва'); return; }
    notify(publish ? 'Отзыв опубликован на сайте' : 'Отзыв скрыт с сайта');
    await loadProviderReviews();
  }
  if (toggle) {
    await db.from('services').update({ active: toggle.dataset.active !== 'true' }).eq('id', toggle.dataset.toggleService);
    notify('Услуга обновлена');
    await refreshAfterWrite();
  }
  if (remove && confirm('Удалить услугу? Отменённые тестовые записи будут очищены.')) {
    const { data, error } = await db.rpc('provider_delete_service', { p_service: remove.dataset.deleteService });
    if (error) notify('Не удалось удалить услугу');
    else notify(data === 'deleted' ? 'Услуга удалена' : 'Услуга скрыта: сохранена история клиентов');
    await refreshAfterWrite();
  }
  if (removeDayOff) {
    const { error } = await db.from('provider_days_off').delete().eq('id', removeDayOff.dataset.deleteDayOff);
    if (error) notify('Не удалось удалить исключение');
    else { notify('Исключение удалено'); await refreshAfterWrite(); }
  }
  if (deleteBookingButton) {
    const id = deleteBookingButton.dataset.deleteBooking;
    const item = allBookings.find(entry => entry.id === id);
    if (!item) return;
    const label = isScheduleBlock(item) ? 'занятое время' : 'запись';
    if (!confirm(`Удалить ${label} на ${String(item.booking_time).slice(0, 5)}? Запись исчезнет из расписания и статистики.`)) return;
    deleteBookingButton.disabled = true;
    const { data, error } = await db.rpc('provider_delete_booking', { p_booking:id });
    deleteBookingButton.disabled = false;
    if (error) {
      notify('Не удалось удалить запись. Обновите страницу и повторите попытку.');
      return;
    }
    if (data === 'review_protected') { notify('Запись с опубликованным отзывом удалить нельзя.'); return; }
    if (data !== 'deleted') { closeBookingSheet(); notify('Запись уже была удалена'); await refreshAfterWrite(); return; }
    allBookings = allBookings.filter(entry => entry.id !== id);
    bookingOutcomes.delete(id);
    bookingSessionItems.delete(id);
    bookingColors.delete(id);
    bookingNotes.delete(id);
    pendingBookingNotes.delete(id);
    writeLocalOutcomes();
    writeLocalSessionItems();
    persistBookingColors();
    persistBookingNotes();
    closeBookingSheet();
    renderBookingData();
    notify(isScheduleBlock(item) ? 'Занятое время удалено' : 'Запись удалена');
    await refreshAfterWrite();
  }
  if (booking) {
    const bookingItem = allBookings.find(item => item.id === booking.dataset.bookingId);
    const { error } = await db.from('bookings').update({ status: booking.dataset.bookingStatus }).eq('id', booking.dataset.bookingId).eq('performer_id', currentUser.id);
    if (error) { notify('Не удалось обновить запись'); return; }
    if (!isScheduleBlock(bookingItem) && booking.dataset.bookingStatus === 'cancelled') notifyTelegramClient(booking.dataset.bookingId, 'cancelled');
    if (!isScheduleBlock(bookingItem) && booking.dataset.bookingStatus === 'confirmed') notifyTelegramClient(booking.dataset.bookingId, 'confirmation');
    closeBookingSheet();
    notify(isScheduleBlock(bookingItem) && booking.dataset.bookingStatus === 'cancelled' ? 'Время освобождено' : 'Статус записи обновлён');
    await refreshAfterWrite();
  }
  if (waitlistStatus) {
    const button = waitlistStatus;
    button.disabled = true;
    const { error } = await db.rpc('set_waitlist_request_status', { p_request: button.dataset.waitlistId, p_status: button.dataset.waitlistStatus });
    button.disabled = false;
    if (error) { notify('Не удалось обновить заявку'); return; }
    notify(button.dataset.waitlistStatus === 'booked' ? 'Клиент отмечен записанным' : button.dataset.waitlistStatus === 'contacted' ? 'Контакт отмечен' : 'Заявка закрыта');
    await loadWaitlist();
  }
});

document.addEventListener('change', async event => {
  const sessionControl = event.target.closest('[data-session-service],[data-session-duration],[data-session-price],[data-session-extends]');
  if (sessionControl) {
    const form = sessionControl.closest('#sessionComposerForm');
    const card = sessionControl.closest('[data-session-item]');
    if (sessionControl.matches('[data-session-service]') && sessionControl.value) {
      const service = ownServices.find(item => item.id === sessionControl.value);
      if (service && card) {
        card.querySelector('[data-session-title]').value = serviceName(service.name);
        card.querySelector('[data-session-duration]').value = String(service.duration_minutes);
        card.querySelector('[data-session-price]').value = String(service.price_rub);
      }
    }
    if (form) updateSessionComposerSummary(form.dataset.bookingId);
  }
  const bookingLabelInput = event.target.closest('[data-booking-label-favorite],[data-booking-label-vip],[data-booking-label-attention]');
  if (bookingLabelInput) {
    const editor = bookingLabelInput.closest('[data-booking-client-labels]');
    const favoriteInput = editor?.querySelector('[data-booking-label-favorite]');
    const vipInput = editor?.querySelector('[data-booking-label-vip]');
    const attentionInput = editor?.querySelector('[data-booking-label-attention]');
    const favoriteField = editor?.querySelector('[data-booking-favorite-note-field]');
    const vipField = editor?.querySelector('[data-booking-vip-note-field]');
    const field = editor?.querySelector('[data-booking-attention-reason-field]');
    if (favoriteField && favoriteInput) favoriteField.hidden = !favoriteInput.checked;
    if (vipField && vipInput) vipField.hidden = !vipInput.checked;
    if (field && attentionInput) field.hidden = !attentionInput.checked;
    if (bookingLabelInput.matches('[data-booking-label-attention]') && attentionInput?.checked) editor?.querySelector('[data-booking-attention-reason]')?.focus();
    if (editor) await saveBookingClientLabels(editor);
  }
  const colorInput = event.target.closest('[data-booking-color-id]');
  if (!colorInput) return;
  if (!requireWrites()) return;
  await saveBookingColor(colorInput.dataset.bookingColorId, colorInput.value);
  notify('Цвет записи сохранён');
});

document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if ($('#portfolioEditorDialog').open) closePortfolioEditor();
  else if (!$('#bookingSheet').hidden) closeBookingSheet();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  refreshBusinessDay();
  renderNotifications();
  if (navigator.onLine) synchronizeProvider();
});
window.addEventListener('offline', () => { setWritesAllowed(false); setSyncState('offline', 'Офлайн · показана сохранённая копия · только чтение'); });
window.addEventListener('online', synchronizeProvider);
new MutationObserver(() => applyWriteAvailability()).observe($('#dashboard'), { childList: true, subtree: true });
updateJournalModeButtons();

teamCalendarController = window.MinutaTeamCalendar.createController({
  db,
  $,
  $$,
  escapeHtml,
  getCurrentUser: () => currentUser,
  getSessionGeneration: () => sessionGeneration,
  sessionIsCurrent,
  getSelectedDate: () => selectedDate,
  getHolder: () => $('#providerBookings'),
  onModeChange: setTeamCalendarMode,
  renderLegacy: renderBookings
});
teamCalendarController.bind();

const organizationController = window.MinutaOrganization.createController({
  db,
  $,
  $$,
  escapeHtml,
  notify,
  requireWrites,
  getCurrentUser: () => currentUser,
  getSessionGeneration: () => sessionGeneration,
  sessionIsCurrent,
  applyWriteAvailability,
  onActiveOrganizationChange: organization => teamCalendarController.setOrganization(organization)
});
organizationController.bind();

$('#loginForm').addEventListener('submit', login);
$('#signupForm').addEventListener('submit', signup);
$('#recoveryForm').addEventListener('submit', requestPasswordReset);
$('#resetPasswordForm').addEventListener('submit', completePasswordRecovery);
$('#serviceForm').addEventListener('submit', addService);
$('#portfolioForm').addEventListener('submit', savePortfolioItem);
$('#portfolioBeforeFile').addEventListener('change', event => handlePortfolioFile('before', event.target.files?.[0]));
$('#portfolioAfterFile').addEventListener('change', event => handlePortfolioFile('after', event.target.files?.[0]));
$('#portfolioConsent').addEventListener('change', updatePortfolioPublishControl);
$('#dayOffForm').addEventListener('submit', addDayOff);
$('#passwordForm').addEventListener('submit', changePassword);
$('#bookingPolicyForm').addEventListener('submit', saveBookingPolicy);
$('#providerDisplayForm').addEventListener('change', saveDisplayPreferences);
$('#installAppButton').addEventListener('click', installProviderApp);
$('#depositEnabled').addEventListener('change', event => { $('#depositSettings').hidden = !event.target.checked; });
$('#notificationTemplatesForm').addEventListener('submit', saveNotificationTemplates);
$('#repeatBookingForm').addEventListener('submit', createRepeatBooking);
$('#saveClientNote').addEventListener('click', saveClientNote);
$('#clientLabelFavorite').addEventListener('change', event => {
  $('#clientFavoriteNoteField').hidden = !event.target.checked;
  saveClientLabels();
});
$('#clientLabelVip').addEventListener('change', event => {
  $('#clientVipNoteField').hidden = !event.target.checked;
  saveClientLabels();
});
$('#clientLabelAttention').addEventListener('change', event => {
  $('#clientAttentionReasonField').hidden = !event.target.checked;
  if (event.target.checked) $('#clientAttentionReason').focus();
  else clearFormError('#clientLabelsError');
  saveClientLabels();
});
[$('#clientFavoriteNote'), $('#clientVipNote'), $('#clientAttentionReason')].forEach(input => input.addEventListener('input', () => {
  clearTimeout(clientLabelReasonTimer);
  clientLabelReasonTimer = setTimeout(saveClientLabels, 450);
}));
document.addEventListener('input', event => {
  const sessionInput = event.target.closest('[data-session-title],[data-session-duration],[data-session-price]');
  if (sessionInput) {
    const form = sessionInput.closest('#sessionComposerForm');
    if (form) updateSessionComposerSummary(form.dataset.bookingId);
  }
  const reason = event.target.closest('[data-booking-favorite-note],[data-booking-vip-note],[data-booking-attention-reason]');
  if (!reason) return;
  clearTimeout(clientLabelReasonTimer);
  clientLabelReasonTimer = setTimeout(() => saveBookingClientLabels(reason.closest('[data-booking-client-labels]')), 450);
});
$('#clientSearch').addEventListener('input', renderClients);
$('#repeatService').addEventListener('change', loadRepeatSlots);
$('#repeatDate').addEventListener('change', loadRepeatSlots);
$('#scheduleDatePicker').addEventListener('change', event => selectScheduleDate(event.target.value));
$('#forgotPasswordButton').addEventListener('click', showRecoveryRequest);
$$('[data-back-to-login]').forEach(button => button.addEventListener('click', () => setAuthTab('login')));
$('#logoutButton').addEventListener('click', logout);
$('#refreshBookings').addEventListener('click', synchronizeProvider);
$('#refreshNotifications').addEventListener('click', synchronizeProvider);
$('#exportBookings').addEventListener('click', exportBookingsCsv);
$('#newBookingButton').addEventListener('click', () => openNewBookingSheet());
$('#saveSchedule').addEventListener('click', saveSchedule);
$('#dayOffAllDay').addEventListener('change', event => { $('#dayOffTime').hidden = event.target.checked; });
$('#slotInterval').addEventListener('change', () => { scheduleDirty = true; });
$('#dayOffDate').min = businessTodayIso();
$('#weeklySchedule').addEventListener('change', event => {
  const card = event.target.closest('[data-schedule-day]');
  if (!card) return;
  scheduleDirty = true;
  if (event.target.matches('[data-schedule-enabled]')) {
    const enabled = event.target.checked;
    card.classList.toggle('disabled', !enabled);
    card.querySelectorAll('input[type="time"], [data-schedule-break]').forEach(input => { input.disabled = !enabled; });
    card.querySelector('.day-off-label').hidden = enabled;
    card.querySelector('.break-hours').hidden = !enabled || !card.querySelector('[data-schedule-break]').checked;
  }
  if (event.target.matches('[data-schedule-break]')) card.querySelector('.break-hours').hidden = !event.target.checked;
});
$('#portfolioManageList').addEventListener('dragstart', event => {
  const card = event.target.closest('[data-portfolio-card]');
  if (!card || !requireWrites()) { event.preventDefault(); return; }
  portfolioDraggedId = card.dataset.portfolioCard;
  card.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', portfolioDraggedId);
});
$('#portfolioManageList').addEventListener('dragover', event => {
  const card = event.target.closest('[data-portfolio-card]');
  if (!card || card.dataset.portfolioCard === portfolioDraggedId) return;
  event.preventDefault();
  $$('.portfolio-card.drag-target').forEach(item => item.classList.remove('drag-target'));
  card.classList.add('drag-target');
});
$('#portfolioManageList').addEventListener('drop', async event => {
  const targetCard = event.target.closest('[data-portfolio-card]');
  event.preventDefault();
  if (!targetCard || !portfolioDraggedId || targetCard.dataset.portfolioCard === portfolioDraggedId) return;
  const from = portfolioItems.findIndex(item => item.id === portfolioDraggedId);
  const to = portfolioItems.findIndex(item => item.id === targetCard.dataset.portfolioCard);
  if (from < 0 || to < 0) return;
  const [moved] = portfolioItems.splice(from, 1);
  portfolioItems.splice(to, 0, moved);
  renderPortfolio();
  await persistPortfolioOrder('Порядок работ изменён перетаскиванием');
});
$('#portfolioManageList').addEventListener('dragend', () => {
  portfolioDraggedId = '';
  $$('.portfolio-card.dragging,.portfolio-card.drag-target').forEach(card => card.classList.remove('dragging', 'drag-target'));
});
db.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY') {
    recoveryMode = true;
    setTimeout(showRecoveryReset, 0);
    return;
  }
  setTimeout(() => handleSession(session), 0);
});
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  refreshInstallAppCard();
});
window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  refreshInstallAppCard();
  notify('Приложение установлено');
});
window.matchMedia('(display-mode: standalone)').addEventListener?.('change', refreshInstallAppCard);
refreshInstallAppCard();
db.auth.getSession().then(({ data }) => recoveryMode ? showRecoveryReset() : handleSession(data.session));
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js?v=128'));
