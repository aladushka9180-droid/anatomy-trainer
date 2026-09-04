if (window.top === window.self) document.documentElement.classList.add('top-level');
else throw new Error('embedded_provider_blocked');
const providerNavigation = window.performance?.getEntriesByType?.('navigation')?.[0];
if (providerNavigation?.type === 'reload') document.documentElement.classList.add('provider-refresh-transition');

const db = window.supabase.createClient(window.MINUTA_CONFIG.supabaseUrl, window.MINUTA_CONFIG.supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const providerPerformance = (() => {
  const storageKey = 'minuta-provider-performance-v1';
  const maximumEntries = 120;
  let entries = [];
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (Array.isArray(stored)) entries = stored.slice(-maximumEntries);
  } catch {}
  const persist = () => {
    try { localStorage.setItem(storageKey, JSON.stringify(entries.slice(-maximumEntries))); } catch {}
  };
  const record = (name, duration, details = {}) => {
    const value = Math.max(0, Math.round(Number(duration) || 0));
    entries.push({ name, duration:value, at:new Date().toISOString(), ...details });
    entries = entries.slice(-maximumEntries);
    persist();
    return value;
  };
  const measure = (name, startedAt, details = {}) => record(name, performance.now() - startedAt, details);
  const summary = () => Object.fromEntries([...new Set(entries.map(item => item.name))].map(name => {
    const values = entries.filter(item => item.name === name).map(item => item.duration).sort((a, b) => a - b);
    const total = values.reduce((sum, value) => sum + value, 0);
    return [name, {
      count:values.length,
      average:values.length ? Math.round(total / values.length) : 0,
      p95:values.length ? values[Math.min(values.length - 1, Math.floor(values.length * .95))] : 0,
      maximum:values.at(-1) || 0
    }];
  }));
  try {
    const observer = new PerformanceObserver(list => list.getEntries().forEach(entry => record('long_task', entry.duration)));
    observer.observe({ type:'longtask', buffered:true });
  } catch {}
  window.MinutaPerformance = Object.freeze({
    getEntries:() => entries.map(item => ({ ...item })),
    getSummary:summary,
    clear:() => { entries = []; persist(); }
  });
  window.addEventListener('load', () => window.requestAnimationFrame(() => measure('provider_load', 0)), { once:true });
  return { measure, record };
})();
function finishProviderBoot() {
  const boot = $('#providerBoot');
  const smoothRefresh = document.documentElement.classList.contains('provider-refresh-transition')
    && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  document.documentElement.classList.remove('provider-booting');
  document.documentElement.classList.add('provider-ready');
  if (!boot || boot.hidden || boot.classList.contains('is-leaving')) return;
  if (!smoothRefresh) {
    boot.hidden = true;
    return;
  }
  boot.classList.add('is-leaving');
  window.setTimeout(() => { boot.hidden = true; }, 320);
}
function showProviderStartupFailure() {
  currentUser = null;
  $('#authCard').hidden = false;
  $('#dashboard').hidden = true;
  setAuthTabImmediate('login');
  showFormError('#loginError', 'Не удалось проверить сохранённый вход. Проверьте соединение и обновите страницу.');
  finishProviderBoot();
}
function isMissingRpc(error, name) {
  const text = `${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`;
  return /PGRST202|42883/i.test(text) || new RegExp(`function\\s+[^\\n]*${name}[^\\n]*does not exist`, 'i').test(text);
}
async function getProviderAvailableSlots({ p_service, p_start, p_end, p_ignore_booking = null }) {
  const parameters = { p_service, p_start, p_end, p_ignore_booking };
  const protectedResult = await db.rpc('get_available_slots_v101', parameters);
  if (!isMissingRpc(protectedResult.error, 'get_available_slots_v101')) return protectedResult;
  return db.rpc('get_available_slots', parameters);
}
const SCHEDULE_DATE_KEY = 'massage-schedule-selected-date';
const SCHEDULE_FOLLOW_TODAY_KEY = 'massage-schedule-follow-today';
const SCHEDULE_FILTER_KEY = 'massage-schedule-filter';
const CALENDAR_VIEW_KEY = 'massage-calendar-view-v1';
const SCHEDULE_BLOCK_PHONE = '0000000000';
const SERVICE_SYNC_INTERVAL_MS = 300000;
const JOURNAL_MODE_KEY = 'massage-journal-mode-v6';
const PROVIDER_LAYOUT_KEYS = ['linear', 'soft', 'capsule', 'editorial', 'bento', 'split'];
const PROVIDER_THEME_KEYS = ['sage', 'nordic', 'warm', 'graphite', 'lavender', 'luxury', 'loft', 'eco', 'hitech'];
const PROVIDER_TEXT_SCALE_KEYS = ['default', 'comfortable', 'large'];
const PROVIDER_MOBILE_NAV_ITEMS = Object.freeze([
  { key:'bookings', label:'Записи', icon:'grid' },
  { key:'notifications', label:'Уведомления', icon:'bell' },
  { key:'analytics', label:'Статистика', icon:'chart' },
  { key:'schedule', label:'График', icon:'clock' },
  { key:'clients', label:'Клиенты', icon:'users' },
  { key:'services', label:'Услуги', icon:'spark' },
  { key:'organization', label:'Организация', icon:'users' },
  { key:'portfolio', label:'Портфолио', icon:'image' },
  { key:'waitlist', label:'Ожидание', icon:'clock' },
  { key:'settings', label:'Настройки', icon:'settings' }
]);
const DEFAULT_MOBILE_NAV = Object.freeze(['bookings', 'notifications', 'analytics', 'schedule']);
const PROVIDER_SECTION_STORAGE_PREFIX = 'minuta-provider-subsection-v1';
const providerSectionMobileQuery = window.matchMedia('(max-width: 760px)');
const PROVIDER_SECTION_COMPANIONS = Object.freeze({
  organizationPeopleSection:['invitationsPanel', 'organizationAuditPanel'],
  benefitsPanel:['loyaltyPanel', 'retentionPanel'],
  bookingRulesCard:['teamCalendarSettingsCard', 'groupBookingSettingsCard']
});
const LEGACY_PROVIDER_THEME_MAP = Object.freeze({ linear:'sage', soft:'nordic', capsule:'lavender', editorial:'warm', bento:'graphite' });
const VISIT_WINDOW_DAYS = 30;
const VISIT_WINDOW_MS = VISIT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
const REGULAR_CLIENT_COMPLETED_VISITS = 10;
const DEFAULT_DISPLAY_PREFERENCES = Object.freeze({
  layout: 'soft',
  theme: 'warm',
  text_scale: 'default',
  show_phone: true,
  show_visit_number: true,
  show_client_type: true,
  show_client_labels: true,
  show_notes: true,
  ios_transitions: true,
  team_calendar_enabled: false,
  mobile_nav: ['bookings', 'notifications', 'analytics', 'schedule'],
  analytics_goals: Object.freeze({ revenue_rub:0, utilization_percent:70, repeat_percent:35, cancellation_percent:10 }),
  analytics_goals_by_scope: Object.freeze({})
});
const BOOKING_COLOR_KEYS = ['auto', 'mint', 'sky', 'lavender', 'peach', 'rose', 'vanilla', 'sage', 'teal', 'amber', 'cocoa', 'graphite'];
const BOOKING_COLOR_LABELS = Object.freeze({
  auto:'Авто', mint:'Мята', sky:'Небо', lavender:'Лаванда', peach:'Персик', rose:'Роза', vanilla:'Ваниль',
  sage:'Шалфей', teal:'Бирюза', amber:'Янтарь', cocoa:'Какао', graphite:'Графит'
});
const BOOKING_COLOR_DEFAULT = 'auto';
const PER_MINUTE_BOOKING_MIN = 1;
const PER_MINUTE_BOOKING_MAX = 480;
const BOOKING_RENDER_PAGE_SIZE = 100;
const CLIENT_RENDER_PAGE_SIZE = 80;
let currentUser = null;
let providerLoginPhone = '';
let providerLoginCodeRequested = false;
let providerLinkPhone = '';
let providerLinkCodeRequested = false;
let currentFilter = restoreScheduleFilter();
let calendarView = currentFilter === 'day' ? restoreCalendarView() : 'day';
let notificationFilter = 'pending';
let reportPeriod = 'month';
let reportCustomStart = '';
let reportCustomEnd = '';
let reportSubview = 'overview';
let notificationTimer = null;
let topbarClockTimer = null;
let deferredInstallPrompt = window.MinutaPwaInstall?.currentPrompt?.() || null;
let journalMode = restoreJournalMode();
let selectedDate = restoreSelectedDate();
let timelineFullDay = false;
let bookingSearchQuery = '';
let bookingStatusFilter = 'all';
let bookingSourceFilter = 'all';
let bookingAnalyticsFilter = '';
let bookingAnalyticsScope = null;
let bookingRenderLimit = BOOKING_RENDER_PAGE_SIZE;
let clientRenderLimit = CLIENT_RENDER_PAGE_SIZE;
let renderedBusinessToday = businessTodayIso();
let allBookings = [];
let bookingsSnapshotSavedAt = '';
let bookingsSnapshotFromCache = false;
let waitlistRequests = [];
let waitlistRemoteAvailable = false;
let bookingOutcomes = new Map();
let bookingSessionItems = new Map();
let sessionItemsRemoteAvailable = false;
let sessionComposerDraft = [];
let bookingColors = new Map();
let pendingBookingColors = new Set();
let bookingNotes = new Map();
let pendingBookingNotes = new Set();
let outcomesRemoteAvailable = false;
let bookingPolicy = { cancel_cutoff_hours: 12, reschedule_cutoff_hours: 12, max_reschedules: 2, deposit_enabled: false, deposit_amount_rub: 0, payment_url_template: '', auto_complete_visits: false, visitor_notifications_enabled: false, booking_buffer_enabled: false, booking_buffer_minutes: 60 };
let displayPreferences = { ...DEFAULT_DISPLAY_PREFERENCES };
let displayPreferencesUpdatedAt = 0;
let displayPreferencesPending = false;
let displayPreferencesSaveTimer = null;
let displayPreferencesSaveRevision = 0;
let serverNotificationTemplates = {};
let serverNotificationMarks = {};
let notificationSettingsRemoteAvailable = false;
let notificationOutbox = [];
let notificationOutboxRemoteAvailable = false;
let visitorVisits = [];
let visitorVisitsRemoteAvailable = false;
let visitorVisitsInitialized = false;
let announcedVisitorVisitIds = new Set();
let visitorNotificationSaving = false;
let visitorNotificationAudioContext = null;
let visitorPresenceTimer = null;
let ownServices = [];
let serviceDurationDefaults = {};
let portfolioItems = [];
let providerReviews = [];
let portfolioRemoteAvailable = false;
let portfolioDraggedId = '';
let portfolioPhotoDrafts = { before: null, after: null };
let portfolioPreviewUrls = [];
let clientNotes = new Map();
let clientLabels = new Map();
let clientAvatars = new Map();
let importedClients = [];
let importedBookingHistory = [];
let clientAvatarsRemoteAvailable = false;
let pendingClientLabels = new Set();
let clientLabelReasonTimer = null;
const clientLabelSaveQueues = new Map();
let selectedClientPhone = '';
let activeClientOrganizationId = '';
let repeatTime = '';
let bookingEditTime = '';
let newBookingTime = '';
let newBookingHistoricalMode = false;
let newBookingOutsideSchedule = false;
let newBookingSlots = [];
let newBookingHour = '';
let newBookingPreferredTime = '';
let newBookingMode = 'client';
let recentlyCreatedBookingId = '';
let recentlyCreatedBookingTimer = null;
let scheduleRows = [];
let daysOff = [];
let monthlyScheduleMonth = businessTodayIso().slice(0, 7);
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
let synchronizationRetryTimer = null;
let writesAllowed = false;
let bookingCreationReady = false;
let connectionWasOffline = false;
let offlineBookingQueue = [];
let offlineBookingFlushPromise = null;
let offlineBookingSavePromise = Promise.resolve();
let offlineBookingInputsReady = false;
let editingOfflineBookingId = '';
let lastConnectionLogSignature = '';
let teamCalendarController = null;
let batchBookingsController = null;
let timelineBookingDrag = null;
let timelineMovePending = false;
let scheduleDaySwipe = null;
let gestureClickSuppressedUntil = 0;
let sectionNavigationFrame = 0;
const providerSectionSelections = new Map();
const providerSectionPresentation = new WeakMap();
const TIMELINE_TOUCH_HOLD_MS = 380;
const TIMELINE_DRAG_THRESHOLD_PX = 5;
const SCHEDULE_SWIPE_THRESHOLD_PX = 58;
const reliability = window.MinutaReliability;
const PROVIDER_CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const OFFLINE_BOOKING_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const providerCacheMaintenance = (async () => {
  await reliability?.removeExpired?.('provider:', PROVIDER_CACHE_MAX_AGE);
})().catch(() => {});
const weekdayNames = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
const notificationAddress = 'Ижевск, ул. Карла Маркса, 304Б';
const PORTFOLIO_BUCKET = 'portfolio-images';
const PORTFOLIO_INPUT_LIMIT = 12 * 1024 * 1024;
const PORTFOLIO_OUTPUT_LIMIT = 8 * 1024 * 1024;
const PORTFOLIO_MAX_EDGE = 2000;
const CLIENT_AVATAR_BUCKET = 'client-avatars';
const CLIENT_AVATAR_INPUT_LIMIT = 8 * 1024 * 1024;
const CLIENT_AVATAR_OUTPUT_LIMIT = 2 * 1024 * 1024;
const CLIENT_AVATAR_MAX_EDGE = 512;
const defaultNotificationTemplates = {
  confirmation: 'Здравствуйте, {имя}! Ваша запись подтверждена.\n\n{услуга}\n{дата} в {время}\n{адрес}\n\nДо встречи!',
  reminder: 'Здравствуйте, {имя}! Напоминаю о вашей записи.\n\n{услуга}\n{дата} в {время}\n{адрес}\n\nЕсли планы изменились, пожалуйста, сообщите заранее.',
  cancellation: 'Здравствуйте, {имя}! Ваша запись на {услуга}, {дата} в {время}, отменена. Если захотите подобрать другое время, напишите мне.'
};
const telegramClientEndpoint = `${window.MINUTA_CONFIG.supabaseUrl}/functions/v1/telegram-client-notify`;

function providerCacheKey(name, userId = currentUser?.id) { return `provider:${userId || 'anonymous'}:${name === 'bookings' ? 'bookings-v3' : name}`; }
function sessionIsCurrent(userId, generation) { return currentUser?.id === userId && sessionGeneration === generation; }
function cachePayload(name, data) {
  if (name !== 'bookings' || !Array.isArray(data)) return data;
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffIso = localIsoDate(cutoff);
  return data.filter(item => item.booking_date >= cutoffIso).slice(-500).map(item => ({
    ...item,
    booking_code: '',
    client_name: isScheduleBlock(item) ? (item.client_name || 'Перерыв') : item.client_name,
    client_phone: isScheduleBlock(item) ? SCHEDULE_BLOCK_PHONE : item.client_phone
  }));
}
async function saveProviderCache(name, data, userId = currentUser?.id) {
  if (!userId) return null;
  try { return await reliability?.put(providerCacheKey(name, userId), cachePayload(name, data)) || null; } catch { return null; }
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
async function hydrateCachedBookings(userId = currentUser?.id) {
  const cached = await readProviderCache('bookings', userId);
  if (!cached?.data || currentUser?.id !== userId) return null;
  applyCachedBookings(cached);
  return cached;
}
function applyCachedBookings(cached, render = true) {
  if (!cached?.data) return false;
  allBookings = cached.data;
  bookingsSnapshotSavedAt = String(cached.savedAt || '');
  bookingsSnapshotFromCache = true;
  if (render) renderBookingData();
  return true;
}
function bookingDataSignature(items = allBookings) {
  let hash = 2166136261;
  const add = value => {
    const text = String(value ?? '');
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  };
  items.forEach(item => {
    [item.id, item.booking_date, item.booking_time, item.status, item.duration_minutes, item.total_price_rub,
      item.client_name, item.client_phone, item.services?.name, item.services?.price_rub, bookingColors.get(item.id)]
      .forEach(add);
  });
  return `${items.length}:${hash >>> 0}`;
}
async function hydrateOfflineBookingInputs(userId, generation, cachedBookings) {
  if (!userId || navigator.onLine || !cachedBookings) return false;
  const [cachedServices, cachedSchedule, cachedDaysOff] = await Promise.all([
    readProviderCache('services', userId),
    readProviderCache('schedule', userId),
    readProviderCache('days-off', userId)
  ]);
  if (!sessionIsCurrent(userId, generation)) return false;
  if (!Array.isArray(cachedServices?.data) || !cachedSchedule?.data?.length || !Array.isArray(cachedDaysOff?.data)) return false;
  ownServices = cachedServices.data;
  scheduleRows = cachedSchedule.data;
  daysOff = cachedDaysOff.data;
  offlineBookingInputsReady = true;
  $('#slotInterval').value = String(scheduleRows[0]?.slot_interval_minutes || 5);
  syncSlotIntervalOptions();
  renderOwnServices();
  renderSchedule();
  renderDaysOff();
  renderBookings();
  applyWriteAvailability();
  return true;
}
function connectionLogKey(userId = currentUser?.id) { return `minuta-provider-connection-log-v1:${userId || 'anonymous'}`; }
function bookingDraftKey(userId = currentUser?.id) { return `minuta-provider-booking-draft-v1:${userId || 'anonymous'}`; }
function readConnectionLog(userId = currentUser?.id) {
  if (!userId) return [];
  try { const value = JSON.parse(localStorage.getItem(connectionLogKey(userId)) || '[]'); return Array.isArray(value) ? value.slice(0, 30) : []; } catch { return []; }
}
function renderConnectionLog() {
  const holder = $('#connectionLogList');
  if (!holder) return;
  const entries = readConnectionLog();
  holder.innerHTML = entries.length ? entries.map(entry => `<article class="connection-log-entry is-${escapeHtml(entry.kind)}"><i></i><div><strong>${escapeHtml(entry.text)}</strong><small>${new Date(entry.at).toLocaleString('ru-RU')}</small></div></article>`).join('') : '<div class="provider-empty compact-empty">Событий связи пока нет.</div>';
}
function recordConnectionEvent(kind, text) {
  const userId = currentUser?.id;
  if (!userId) return;
  const safeKind = ['online', 'checking', 'warning', 'offline', 'error', 'manual'].includes(kind) ? kind : 'warning';
  const safeText = String(text || 'Состояние связи изменилось').slice(0, 180);
  const signature = `${safeKind}:${safeText}`;
  if (signature === lastConnectionLogSignature) return;
  lastConnectionLogSignature = signature;
  try { localStorage.setItem(connectionLogKey(userId), JSON.stringify([{ at:new Date().toISOString(), kind:safeKind, text:safeText }, ...readConnectionLog(userId)].slice(0, 30))); } catch {}
  renderConnectionLog();
}
function readNewBookingDraft(userId = currentUser?.id) {
  if (!userId) return null;
  try {
    const draft = JSON.parse(sessionStorage.getItem(bookingDraftKey(userId)) || 'null');
    if (!draft || Date.now() - Number(draft.savedAt || 0) > 12 * 60 * 60 * 1000) { sessionStorage.removeItem(bookingDraftKey(userId)); return null; }
    return draft;
  } catch { return null; }
}
function saveNewBookingDraft() {
  const form = $('#newBookingForm');
  if (!form || !currentUser) return;
  const draft = {
    savedAt:Date.now(), mode:newBookingMode, historical:newBookingHistoricalMode, outsideSchedule:newBookingOutsideSchedule, name:$('#newBookingName')?.value || '', phone:$('#newBookingPhone')?.value || '', note:$('#newBookingNote')?.value || '',
    blockTitle:$('#newBookingBlockTitle')?.value || '', blockNote:$('#newBookingBlockNote')?.value || '', serviceId:$('#newBookingService')?.value || '', durationMinutes:$('#newBookingDuration')?.value || '', date:$('#newBookingDate')?.value || '', time:newBookingTime || newBookingPreferredTime || '',
    occurrences:$('#newBookingOccurrences')?.value || '1', interval:$('#newBookingInterval')?.value || '1', color:$('[name="newBookingColor"]:checked')?.value || BOOKING_COLOR_DEFAULT
  };
  try { sessionStorage.setItem(bookingDraftKey(), JSON.stringify(draft)); } catch {}
  const status = $('#newBookingDraftStatus');
  if (status) status.textContent = `Данные формы сохранены · запись ещё не добавлена · ${new Date().toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' })}`;
}
function clearNewBookingDraft(userId = currentUser?.id) { try { if (userId) sessionStorage.removeItem(bookingDraftKey(userId)); } catch {} }
function createOfflineBookingId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function offlineBookingQueueKey(userId = currentUser?.id) { return `minuta-offline-bookings-v1:${userId || 'anonymous'}`; }
function offlineBookingSnapshotFresh() {
  const savedAt = new Date(bookingsSnapshotSavedAt).getTime();
  return Number.isFinite(savedAt) && Date.now() - savedAt <= PROVIDER_CACHE_MAX_AGE;
}
function canQueueOfflineBooking() {
  return Boolean(currentUser && !navigator.onLine && offlineBookingInputsReady && offlineBookingSnapshotFresh() && ownServices.some(item => item.active));
}
async function saveOfflineBookingQueue(userId = currentUser?.id, { generation = sessionGeneration, verify = false } = {}) {
  if (!userId || !reliability?.put || !reliability?.get || !sessionIsCurrent(userId, generation)) return false;
  const key = offlineBookingQueueKey(userId);
  const payload = offlineBookingQueue.filter(item => item?.userId === userId);
  const save = offlineBookingSavePromise.catch(() => {}).then(async () => {
    try {
      if (!sessionIsCurrent(userId, generation)) return false;
      await reliability.put(key, payload);
      if (!sessionIsCurrent(userId, generation)) return false;
      if (verify) {
        const stored = await reliability.get(key);
        if (!sessionIsCurrent(userId, generation)) return false;
        const storedIds = Array.isArray(stored?.data) ? stored.data.map(item => item?.id).filter(Boolean).sort() : [];
        const expectedIds = payload.map(item => item.id).sort();
        if (JSON.stringify(storedIds) !== JSON.stringify(expectedIds)) return false;
      }
      return true;
    } catch { return false; }
  });
  offlineBookingSavePromise = save;
  return save;
}
async function loadOfflineBookingQueue(userId = currentUser?.id, generation = sessionGeneration) {
  if (!userId) { offlineBookingQueue = []; renderOfflineBookingQueue(); return []; }
  try {
    const saved = await reliability?.get(offlineBookingQueueKey(userId));
    const now = Date.now();
    const nextQueue = Array.isArray(saved?.data) ? saved.data.filter(item => item?.userId === userId).map(item => {
      if (now - Number(item.createdAt || 0) <= OFFLINE_BOOKING_MAX_AGE || item.status === 'notification_pending') return item;
      return { ...item, status:'conflict', reason:'queue_expired' };
    }) : [];
    if (!sessionIsCurrent(userId, generation)) return [];
    offlineBookingQueue = nextQueue;
  } catch {
    if (!sessionIsCurrent(userId, generation)) return [];
    offlineBookingQueue = [];
  }
  if (!sessionIsCurrent(userId, generation)) return [];
  renderOfflineBookingQueue();
  return offlineBookingQueue;
}
function offlineBookingServiceName(item) {
  return serviceName(ownServices.find(service => service.id === item.serviceId)?.name || item.serviceName || 'Услуга');
}
function offlineBookingConflictText(reason) {
  return ({ slot_unavailable:'Выбранное время уже занято', booking_buffer_conflict:'Время попадает в перерыв рядом с другой записью', service_unavailable:'Услуга больше недоступна', date_expired:'Дата записи уже прошла', queue_expired:'Прошло 7 дней — подтвердите отправку вручную', invalid_client_data:'Нужно проверить имя или телефон клиента', unexpected_error:'Сервер отклонил запись — проверьте данные' })[reason] || 'Нужно проверить запись вручную';
}
function stageOfflineBookingProviderNotice(item, outcome, { clientNotified = false } = {}) {
  const reason = item.reason || '';
  const noticeKey = `${outcome}:${reason}`;
  if (item.providerNoticeKey === noticeKey) return null;
  item.providerNoticeKey = noticeKey;
  const client = item.clientName && item.clientName !== 'Клиент' ? item.clientName : 'Клиент';
  const appointment = `${client} · ${item.date} ${item.time}`;
  if (outcome === 'created') {
    const detail = clientNotified ? 'Клиент получил подтверждение.' : 'Клиент пока не подключил Telegram.';
    return { key:`offline-${item.id}-created-${clientNotified ? 'notified' : 'without-client-telegram'}`, title:'Отложенная запись создана', body:`${appointment}. ${detail}`, toast:`Запись ${client} создана · ${clientNotified ? 'уведомление клиенту отправлено' : 'клиент ещё не подключил Telegram'}`, kind:'online' };
  }
  if (outcome === 'client_notification_pending') {
    return { key:`offline-${item.id}-client-notification-pending`, title:'Запись создана', body:`${appointment}. Отправку подтверждения клиенту повторим автоматически.`, toast:`Запись ${client} создана · уведомление клиенту повторим автоматически`, kind:'warning' };
  }
  if (outcome === 'server_check_pending') {
    return { key:`offline-${item.id}-server-check-pending`, title:'Проверяем отложенную запись', body:`${appointment}. Сервер принял запрос, результат будет проверен автоматически.`, toast:`Запрос на запись ${client} принят · подтверждаем результат`, kind:'warning' };
  }
  const detail = offlineBookingConflictText(reason);
  return { key:`offline-${item.id}-conflict-${reason || 'unknown'}`, title:'Отложенная запись не создана', body:`${appointment}. ${detail}.`, toast:`Запись ${client} не создана · ${detail.toLocaleLowerCase('ru-RU')}`, kind:'warning' };
}
function deliverOfflineBookingProviderNotice(notice) {
  if (!notice) return false;
  recordConnectionEvent(notice.kind, notice.body);
  if (!document.hidden) notify(notice.toast);
  if ('Notification' in window && Notification.permission === 'granted') {
    void showProviderSystemNotification({ ...notice, view:'bookings' });
  }
  return true;
}
function renderOfflineBookingQueue() {
  const panel = $('#offlineBookingQueuePanel');
  const list = $('#offlineBookingQueueList');
  const status = $('#offlineBookingQueueStatus');
  if (!panel || !list || !status) return;
  panel.hidden = !offlineBookingQueue.length;
  if (!offlineBookingQueue.length) { list.replaceChildren(); return; }
  const conflicts = offlineBookingQueue.filter(item => item.status === 'conflict').length;
  const notifications = offlineBookingQueue.filter(item => item.status === 'notification_pending').length;
  const pending = offlineBookingQueue.length - conflicts - notifications;
  status.textContent = [pending ? `${pending} отправятся автоматически после подключения` : '', notifications ? `${notifications} ожидают уведомления` : '', conflicts ? `${conflicts} требуют внимания` : ''].filter(Boolean).join(' · ');
  list.innerHTML = offlineBookingQueue.map(item => {
    const date = parseLocalIsoDate(item.date);
    const dateLabel = date ? date.toLocaleDateString('ru-RU', { day:'numeric', month:'short' }) : item.date;
    const state = item.status === 'conflict' ? `<small class="offline-booking-conflict" role="alert">${escapeHtml(offlineBookingConflictText(item.reason))}</small>` : item.status === 'syncing' ? '<small>Проверяем время на сервере…</small>' : item.status === 'server_check_pending' ? '<small>Запись принята сервером · подтверждаем результат</small>' : item.status === 'notification_pending' ? '<small>Запись создана · повторим уведомление клиенту</small>' : '<small>Будет проверено при подключении</small>';
    const notificationOnly = item.status === 'notification_pending';
    const label = notificationOnly ? `Не повторять уведомление о записи на ${dateLabel} в ${item.time}` : `Удалить отложенную запись ${item.clientName} на ${dateLabel} в ${item.time}`;
    const removalLocked = item.status === 'syncing' || item.status === 'server_check_pending';
    const editButton = item.status === 'conflict' ? `<button type="button" class="offline-booking-edit" data-edit-offline-booking="${escapeHtml(item.id)}" aria-label="Изменить отложенную запись ${escapeHtml(item.clientName)}">Изменить</button>` : '';
    return `<article class="offline-booking-item is-${item.status === 'conflict' ? 'conflict' : 'pending'}"><div><strong>${escapeHtml(item.clientName)}</strong><span>${escapeHtml(dateLabel)} · ${escapeHtml(item.time)} · ${escapeHtml(offlineBookingServiceName(item))}</span>${state}</div><div class="offline-booking-actions">${editButton}<button type="button" data-remove-offline-booking="${escapeHtml(item.id)}" aria-label="${escapeHtml(label)}" ${removalLocked ? 'disabled' : ''}>${notificationOnly ? 'Не повторять' : 'Удалить'}</button></div></article>`;
  }).join('');
  const retry = $('#retryOfflineBookings');
  if (retry) {
    retry.hidden = !navigator.onLine || (!notifications && !conflicts);
    retry.disabled = !currentUser || offlineBookingQueue.some(item => item.status === 'syncing');
  }
}
async function queueOfflineBooking(payload) {
  const userId = currentUser?.id;
  const editingIndex = offlineBookingQueue.findIndex(item => item.id === editingOfflineBookingId && item.userId === userId && item.status === 'conflict');
  if (!userId || (editingIndex < 0 && !canQueueOfflineBooking())) return { ok:false };
  const duplicate = offlineBookingQueue.find((item, index) => index !== editingIndex && item.serviceId === payload.serviceId && item.date === payload.date && item.time === payload.time && normalizePhone(item.clientPhone) === normalizePhone(payload.clientPhone));
  if (duplicate) return { ok:editingIndex < 0, duplicate:true };
  const previousQueue = offlineBookingQueue.map(item => ({ ...item }));
  const nextItem = {
    id:editingIndex >= 0 ? offlineBookingQueue[editingIndex].id : createOfflineBookingId(), userId, createdAt:Date.now(), status:'pending', attempts:0,
    clientName:String(payload.clientName || '').slice(0, 80), clientPhone:String(payload.clientPhone || '').slice(0, 40),
    serviceId:String(payload.serviceId || ''), serviceName:String(payload.serviceName || '').slice(0, 120), durationMinutes:normalizePerMinuteDuration(payload.durationMinutes), date:String(payload.date || ''), time:String(payload.time || '').slice(0, 5),
    note:String(payload.note || '').slice(0, 1000), color:BOOKING_COLOR_KEYS.includes(payload.color) ? payload.color : BOOKING_COLOR_DEFAULT
  };
  if (editingIndex >= 0) offlineBookingQueue[editingIndex] = nextItem;
  else offlineBookingQueue.push(nextItem);
  const saved = await saveOfflineBookingQueue(userId, { verify:true });
  if (!saved) { offlineBookingQueue = previousQueue; return { ok:false }; }
  renderOfflineBookingQueue();
  return { ok:true, edited:editingIndex >= 0 };
}
function queuedBookingMatch(item) {
  return allBookings.find(booking => booking.status !== 'cancelled' && String(booking.request_id || '') === item.id) || null;
}
function queuedBookingSlotMatch(item) {
  return allBookings.find(booking => booking.status !== 'cancelled'
    && booking.service_id === item.serviceId
    && booking.booking_date === item.date
    && String(booking.booking_time).slice(0, 5) === item.time) || null;
}
function bookingConnectionError(error) {
  const reason = `${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`;
  return !navigator.onLine || /failed to fetch|network|load failed|timed? out|fetch|connection/i.test(reason);
}
async function finalizeQueuedBooking(item, booking, userId, generation) {
  if (!sessionIsCurrent(userId, generation) || !offlineBookingQueue.some(entry => entry.id === item.id)) return false;
  if (item.note) {
    await db.from('client_notes').upsert({ performer_id:item.userId, client_phone:normalizePhone(item.clientPhone), note:item.note, updated_at:new Date().toISOString() });
    if (!sessionIsCurrent(userId, generation)) return false;
    clientNotes.set(normalizePhone(item.clientPhone), item.note);
  }
  if (booking?.id) await saveBookingColor(booking.id, item.color, { rerender:false });
  if (!sessionIsCurrent(userId, generation)) return false;
  const notification = booking?.id ? await deliverTelegramClientNotification(booking.id, 'confirmation') : { delivered:false, retryable:true, reason:'booking_missing' };
  if (!sessionIsCurrent(userId, generation)) return false;
  if (notification.retryable) {
    const notificationAttempts = Number(item.notificationAttempts || 0) + 1;
    item.status = 'notification_pending';
    item.reason = 'notification_retry';
    item.serverBookingId = booking?.id || item.serverBookingId || '';
    item.notificationAttempts = notificationAttempts;
    item.notificationNextAttemptAt = Date.now() + Math.min(60 * 60 * 1000, 5 * 60 * 1000 * (2 ** Math.min(notificationAttempts - 1, 4)));
    const providerNotice = stageOfflineBookingProviderNotice(item, 'client_notification_pending');
    item.clientName = 'Клиент';
    item.clientPhone = '';
    item.note = '';
    await saveOfflineBookingQueue(userId, { generation });
    renderOfflineBookingQueue();
    deliverOfflineBookingProviderNotice(providerNotice);
    return false;
  }
  const providerNotice = stageOfflineBookingProviderNotice(item, 'created', { clientNotified:notification.delivered });
  offlineBookingQueue = offlineBookingQueue.filter(entry => entry.id !== item.id);
  await saveOfflineBookingQueue(userId, { generation });
  if (!sessionIsCurrent(userId, generation)) return false;
  renderOfflineBookingQueue();
  deliverOfflineBookingProviderNotice(providerNotice);
  return true;
}
async function flushOfflineBookings({ retryConflicts = false } = {}) {
  if (offlineBookingFlushPromise) return offlineBookingFlushPromise;
  if (!currentUser || !navigator.onLine || !(writesAllowed || bookingCreationReady)) return false;
  const userId = currentUser.id;
  const generation = sessionGeneration;
  const run = (async () => {
    for (const item of [...offlineBookingQueue]) {
      if (!sessionIsCurrent(userId, generation) || !navigator.onLine) break;
      if (item.status === 'conflict' && !retryConflicts) continue;
      if (item.status === 'notification_pending' && !retryConflicts && Date.now() < Number(item.notificationNextAttemptAt || 0)) continue;
      if (!offlineBookingQueue.some(entry => entry.id === item.id)) continue;
      const existing = queuedBookingMatch(item);
      if (existing) {
        item.status = 'syncing';
        renderOfflineBookingQueue();
        await saveOfflineBookingQueue(userId, { generation });
        if (!sessionIsCurrent(userId, generation) || !offlineBookingQueue.some(entry => entry.id === item.id)) break;
        await finalizeQueuedBooking(item, existing, userId, generation);
        continue;
      }
      if (item.date < businessTodayIso()) {
        item.status = 'conflict'; item.reason = 'date_expired';
        const providerNotice = stageOfflineBookingProviderNotice(item, 'conflict');
        await saveOfflineBookingQueue(userId, { generation }); renderOfflineBookingQueue();
        deliverOfflineBookingProviderNotice(providerNotice);
        continue;
      }
      if (item.status === 'notification_pending') {
        item.status = 'conflict'; item.reason = 'unexpected_error';
        const providerNotice = stageOfflineBookingProviderNotice(item, 'conflict');
        await saveOfflineBookingQueue(userId, { generation }); renderOfflineBookingQueue();
        deliverOfflineBookingProviderNotice(providerNotice);
        continue;
      }
      const previousStatus = item.status;
      const previousReason = item.reason || '';
      if (queuedBookingSlotMatch(item)) {
        item.status = 'conflict'; item.reason = 'slot_unavailable';
        const providerNotice = stageOfflineBookingProviderNotice(item, 'conflict');
        await saveOfflineBookingQueue(userId, { generation }); renderOfflineBookingQueue();
        deliverOfflineBookingProviderNotice(providerNotice);
        continue;
      }
      item.status = 'syncing'; item.reason = ''; item.attempts = Number(item.attempts || 0) + 1; item.lastAttemptAt = Date.now();
      renderOfflineBookingQueue();
      await saveOfflineBookingQueue(userId, { generation });
      if (!sessionIsCurrent(userId, generation) || !offlineBookingQueue.some(entry => entry.id === item.id)) break;
      const params = { p_service:item.serviceId, p_date:item.date, p_time:`${item.time}:00`, p_client_name:item.clientName, p_client_phone:item.clientPhone };
      const { error } = await db.rpc('book_appointment', { p_request_id:item.id, ...params });
      if (!sessionIsCurrent(userId, generation)) return false;
      if (error) {
        if (bookingConnectionError(error)) {
          item.status = previousStatus === 'conflict' ? 'conflict' : 'pending';
          item.reason = previousStatus === 'conflict' ? previousReason : '';
          await saveOfflineBookingQueue(userId, { generation }); renderOfflineBookingQueue();
          break;
        }
        const reason = String(error.message || '');
        if (reason.includes('slot_unavailable') || reason.includes('booking_buffer_conflict') || reason.includes('service_unavailable') || reason.includes('invalid_client_data')) {
          item.status = 'conflict';
          item.reason = reason.includes('booking_buffer_conflict') ? 'booking_buffer_conflict' : reason.includes('slot_unavailable') ? 'slot_unavailable' : reason.includes('service_unavailable') ? 'service_unavailable' : 'invalid_client_data';
          const providerNotice = stageOfflineBookingProviderNotice(item, 'conflict');
          await saveOfflineBookingQueue(userId, { generation }); renderOfflineBookingQueue();
          deliverOfflineBookingProviderNotice(providerNotice);
          continue;
        }
        item.status = 'conflict'; item.reason = 'unexpected_error';
        const providerNotice = stageOfflineBookingProviderNotice(item, 'conflict');
        await saveOfflineBookingQueue(userId, { generation }); renderOfflineBookingQueue();
        deliverOfflineBookingProviderNotice(providerNotice);
        continue;
      }
      const refreshed = await loadBookings({ silent:true });
      if (!sessionIsCurrent(userId, generation)) return false;
      if (!refreshed?.ok) {
        item.status = 'server_check_pending';
        const providerNotice = stageOfflineBookingProviderNotice(item, 'server_check_pending');
        await saveOfflineBookingQueue(userId, { generation }); renderOfflineBookingQueue();
        deliverOfflineBookingProviderNotice(providerNotice);
        break;
      }
      const booking = queuedBookingMatch(item);
      if (!booking) {
        item.status = 'server_check_pending';
        const providerNotice = stageOfflineBookingProviderNotice(item, 'server_check_pending');
        await saveOfflineBookingQueue(userId, { generation }); renderOfflineBookingQueue();
        deliverOfflineBookingProviderNotice(providerNotice);
        break;
      }
      const queuedService = ownServices.find(service => service.id === item.serviceId);
      const applied = await applyPerMinuteBookingTerms([booking.id], queuedService, item.durationMinutes);
      if (!applied.ok) {
        await rollbackCreatedBookings([booking.id]);
        item.status = 'conflict';
        item.reason = /overlap|slot|occupied|resource/i.test(String(applied.error?.message || '')) ? 'slot_unavailable' : 'unexpected_error';
        const providerNotice = stageOfflineBookingProviderNotice(item, 'conflict');
        await saveOfflineBookingQueue(userId, { generation });
        renderOfflineBookingQueue();
        deliverOfflineBookingProviderNotice(providerNotice);
        continue;
      }
      if (Number(item.durationMinutes || 1) > 1) await loadBookings({ silent:true });
      await finalizeQueuedBooking(item, queuedBookingMatch(item) || booking, userId, generation);
    }
    renderBookingData();
    return !offlineBookingQueue.some(item => item.status === 'pending' || item.status === 'syncing' || item.status === 'server_check_pending' || item.status === 'notification_pending');
  })();
  offlineBookingFlushPromise = run;
  try { return await run; }
  finally { if (offlineBookingFlushPromise === run) offlineBookingFlushPromise = null; }
}
const offlineBookingCreateSelector = '#newBookingButton, #mobileNewBookingButton, [data-create-empty-booking], #newBookingForm button[type="submit"]';
const bookingCreationWriteSelector = '#newBookingButton, #mobileNewBookingButton, [data-create-empty-booking], #newBookingForm button[type="submit"], #repeatBookingForm button[type="submit"], [data-repeat-booking], [data-quick-repeat-client]';
const writeSelectors = [
  '#newBookingButton', '#mobileNewBookingButton', '[data-create-empty-booking]', '[data-quick-repeat-client]', '#saveSchedule', '[data-slot-interval]', '#saveClientNote', '#clientLabelFavorite', '#clientLabelVip', '#clientLabelAttention', '#clientFavoriteNote', '#clientVipNote', '#clientAttentionReason',
  '[data-booking-label-favorite]', '[data-booking-label-vip]', '[data-booking-label-attention]', '[data-booking-favorite-note]', '[data-booking-vip-note]', '[data-booking-attention-reason]',
  '#serviceForm button[type="submit"]', '#dayOffForm button[type="submit"]',
  '#repeatBookingForm button[type="submit"]', '#bookingOutcomeForm button[type="submit"]',
  '#bookingPolicyForm button[type="submit"]', '#bookingPrepaymentForm button[type="submit"]',
  '#bookingEditForm button[type="submit"]', '#newBookingForm button[type="submit"]', '#serviceEditForm button[type="submit"]',
  '#portfolioForm button[type="submit"]', '[data-open-portfolio-editor]', '[data-edit-portfolio]', '[data-delete-portfolio]', '[data-portfolio-move]',
  '[data-organization-write]', '[data-resource-write]', '[data-shift-write]', '[data-payroll-write]', '[data-benefit-write]', '[data-loyalty-write]', '[data-inventory-write]', '[data-organization-policy-write]', '[data-group-booking-write]', '[data-batch-booking-write]', '[data-retention-write]', '#visitorNotificationsEnabled', '#organizationForm button[type="submit"]', '#locationForm button[type="submit"]', '#memberInviteForm button[type="submit"]',
  '[data-retry-notification-outbox]',
  '[data-booking-status]', '[data-cancel-booking-series]', '#bookingSeriesCancelForm button[type="submit"]', '[data-delete-booking]', '[data-waitlist-status]', '[data-booking-color-id]', '[data-delete-service]', '[data-toggle-service]', '[data-delete-day-off]',
  '[data-repeat-booking]', '[data-client-avatar-input]', '[data-remove-client-avatar]'
];
function applyWriteAvailability() {
  $$(writeSelectors.join(',')).forEach(control => {
    if (control.dataset.ownerOnly === 'true' && control.dataset.ownerAuthorized !== 'true') {
      control.disabled = true;
      delete control.dataset.reliabilityDisabled;
      return;
    }
    const controlAllowed = writesAllowed || (bookingCreationReady && control.matches(bookingCreationWriteSelector)) || (canQueueOfflineBooking() && control.matches(offlineBookingCreateSelector));
    if (!controlAllowed && !control.disabled) {
      control.disabled = true;
      control.dataset.reliabilityDisabled = 'true';
    } else if (controlAllowed && control.dataset.reliabilityDisabled === 'true') {
      control.disabled = false;
      delete control.dataset.reliabilityDisabled;
    }
  });
}
function setWritesAllowed(value) {
  writesAllowed = Boolean(value);
  applyWriteAvailability();
}
function setBookingCreationReady(value) {
  bookingCreationReady = Boolean(value);
  applyWriteAvailability();
}
function requireWrites() {
  if (writesAllowed && navigator.onLine && currentUser) return true;
  notify('Изменения временно заблокированы до полной синхронизации');
  return false;
}
function requireBookingWrites() {
  if ((writesAllowed || bookingCreationReady) && navigator.onLine && currentUser) return true;
  if (canQueueOfflineBooking()) return true;
  if (!navigator.onLine) notify('Нет интернета и свежей сохранённой копии · запись пока нельзя отложить');
  else {
    notify('Проверяем записи и расписание · повторите через несколько секунд');
    synchronizeProvider();
  }
  return false;
}
async function deliverTelegramClientNotification(bookingId, event) {
  try {
    const { data } = await db.auth.getSession();
    const accessToken = data.session?.access_token;
    if (!accessToken) return { delivered:false, retryable:true, reason:'session_unavailable' };
    const response = await fetch(`${telegramClientEndpoint}/event`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: window.MINUTA_CONFIG.supabaseKey, authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ event, booking_id: bookingId })
    });
    const result = await response.json().catch(() => ({}));
    if (response.ok && (result.delivered || result.reason === 'already_sent')) return { delivered:true, retryable:false, reason:String(result.reason || 'delivered') };
    if (response.ok && result.reason === 'not_connected') return { delivered:false, retryable:false, reason:'not_connected' };
    return { delivered:false, retryable:true, reason:String(result.reason || `http_${response.status}`) };
  } catch { return { delivered:false, retryable:true, reason:'network_error' }; }
}
async function notifyTelegramClient(bookingId, event) {
  const result = await deliverTelegramClientNotification(bookingId, event);
  return result.delivered;
}
function setSyncState(kind, text) {
  const element = $('#syncState');
  if (!element) return;
  element.className = `sync-state is-${kind}`;
  element.querySelector('span').textContent = text;
  recordConnectionEvent(kind, text);
  applyWriteAvailability();
}
async function manualSynchronizeProvider() {
  const button = $('#manualSyncButton');
  if (!currentUser) return false;
  if (!navigator.onLine) { notify('Нет интернета · показана сохранённая копия'); recordConnectionEvent('offline', 'Ручное обновление: нет интернета'); return false; }
  button.disabled = true;
  button.classList.add('is-spinning');
  recordConnectionEvent('manual', 'Запущено ручное обновление');
  try {
    const complete = await synchronizeProvider();
    if (navigator.onLine && bookingCreationReady) await flushOfflineBookings();
    notify(complete ? 'Все данные обновлены' : bookingCreationReady ? 'Записи и расписание обновлены' : 'Не удалось обновить данные · повторим автоматически');
    return complete;
  } catch {
    recordConnectionEvent('error', 'Ручное обновление завершилось ошибкой');
    notify('Не удалось обновить данные · повторим автоматически');
    return false;
  } finally {
    button.disabled = false;
    button.classList.remove('is-spinning');
  }
}
function cachedStateText(savedAt) {
  return `Офлайн · данные на ${reliability?.savedAtLabel(savedAt) || 'последнюю синхронизацию'}`;
}
let providerBookingRenderRevision = 0;
const providerBookingViewRevisions = new Map();
let providerBookingRenderFrame = 0;
function renderDayFocus() {
  const panel = $('#providerDayFocus');
  const title = $('#providerDayFocusTitle');
  const details = $('#providerDayFocusDetails');
  const label = $('#providerDayFocusLabel');
  const open = $('#providerDayFocusOpen');
  if (!panel || !title || !details || !label || !open) return;
  const now = new Date();
  const next = allBookings
    .filter(item => item.status !== 'cancelled' && !isScheduleBlock(item) && bookingOutcome(item).visit_status === 'scheduled')
    .map(item => {
      const start = bookingStart(item);
      const duration = Number(item.duration_minutes || item.services?.duration_minutes || 60);
      return { item, start, end:new Date(start.getTime() + duration * 60000) };
    })
    .filter(entry => !Number.isNaN(entry.start.getTime()) && entry.end >= now)
    .sort((left, right) => left.start - right.start)[0];
  if (!next) {
    panel.hidden = true;
    open.removeAttribute('data-open-booking');
    return;
  }
  const today = businessTodayIso();
  const tomorrowDate = parseLocalIsoDate(today);
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const dateLabel = next.item.booking_date === today
    ? 'Сегодня'
    : next.item.booking_date === localIsoDate(tomorrowDate)
      ? 'Завтра'
      : next.start.toLocaleDateString('ru-RU', { day:'numeric', month:'long' });
  label.textContent = next.start <= now ? 'Сейчас идёт' : 'Ближайшая запись';
  title.textContent = `${String(next.item.booking_time || '').slice(0, 5)} · ${next.item.client_name || 'Клиент'}`;
  details.textContent = `${dateLabel} · ${serviceName(next.item.services?.name || 'Услуга')}`;
  open.dataset.openBooking = next.item.id;
  panel.hidden = false;
}
function renderBookingData() {
  if (providerBookingRenderFrame) return;
  providerBookingRenderFrame = window.requestAnimationFrame(() => {
    const startedAt = performance.now();
    providerBookingRenderFrame = 0;
    providerBookingRenderRevision += 1;
    updateBookingStats();
    renderDayFocus();
    const activeView = $('#dashboard')?.dataset.activeView || 'bookings';
    renderProviderBookingView(activeView);
    scheduleProviderBookingWarmup(activeView);
    providerPerformance.measure('booking_render', startedAt, { view:activeView, count:allBookings.length });
  });
}

function renderProviderBookingView(view) {
  if (providerBookingViewRevisions.get(view) === providerBookingRenderRevision) return;
  if (view === 'bookings') renderBookings();
  if (view === 'clients') {
    renderClients();
    if (selectedClientPhone) renderClientDetail(selectedClientPhone);
  }
  if (view === 'notifications') renderNotifications();
  if (view === 'analytics') renderAnalytics();
  if (['bookings', 'clients', 'notifications', 'analytics'].includes(view)) providerBookingViewRevisions.set(view, providerBookingRenderRevision);
}

let providerBookingWarmupRevision = 0;
function scheduleProviderBookingWarmup(activeView) {
  const revision = ++providerBookingWarmupRevision;
  const pending = ['clients', 'notifications', 'analytics'].filter(view => view !== activeView);
  const schedule = window.requestIdleCallback
    ? callback => window.requestIdleCallback(callback, { timeout:1500 })
    : callback => window.setTimeout(() => callback({ timeRemaining:() => 8 }), 120);
  const warmNext = deadline => {
    if (revision !== providerBookingWarmupRevision || !pending.length) return;
    if (!deadline.timeRemaining() && !deadline.didTimeout) { schedule(warmNext); return; }
    renderProviderBookingView(pending.shift());
    if (pending.length) schedule(warmNext);
  };
  schedule(warmNext);
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
function renderTopbarDateTime() {
  const now = new Date();
  const dateLabel = $('#todayLabel');
  const timeLabel = $('#currentTimeLabel');
  if (dateLabel) dateLabel.textContent = new Intl.DateTimeFormat('ru-RU', { timeZone:'Europe/Samara', weekday:'long', day:'numeric', month:'long' }).format(now);
  if (timeLabel) {
      timeLabel.textContent = new Intl.DateTimeFormat('ru-RU', { timeZone:'Europe/Samara', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false }).format(now);
    timeLabel.dateTime = now.toISOString();
  }
}
function stopTopbarClock() {
  clearTimeout(topbarClockTimer);
  topbarClockTimer = null;
}
function startTopbarClock() {
  stopTopbarClock();
  const tick = () => {
    renderTopbarDateTime();
      topbarClockTimer = setTimeout(tick, 1050 - (Date.now() % 1000));
  };
  tick();
}
function normalizePhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('00')) return '';
  if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  if (digits.length === 10) digits = `7${digits}`;
  return digits.length >= 11 && digits.length <= 15 && !digits.startsWith('0') ? digits : '';
}

function clientAvatar(phone) {
  return clientAvatars.get(normalizePhone(phone)) || null;
}

function clientAvatarContent(phone, name) {
  const avatar = clientAvatar(phone);
  if (avatar?.signed_url) return `<img src="${escapeHtml(avatar.signed_url)}" alt="" loading="lazy">`;
  return escapeHtml(String(name || 'Клиент').trim().slice(0, 1).toUpperCase() || 'К');
}

function clientAvatarEditorMarkup(phone, name, bookingId = '') {
  const normalizedPhone = normalizePhone(phone);
  const avatar = clientAvatar(normalizedPhone);
  const visual = `<span class="booking-sheet-client-avatar">${clientAvatarContent(normalizedPhone, name)}</span>`;
  if (!clientAvatarsRemoteAvailable || !normalizedPhone) return visual;
  return `<span class="client-avatar-control booking-client-avatar-control">
    <label class="client-avatar-picker" title="${avatar ? 'Сменить фото клиента' : 'Добавить фото клиента'}">
      <input type="file" accept="image/jpeg,image/png,image/webp" data-client-avatar-input data-client-phone="${escapeHtml(normalizedPhone)}" data-booking-id="${escapeHtml(bookingId)}" aria-label="${avatar ? 'Сменить фото клиента' : 'Добавить фото клиента'}">
      ${visual}<small aria-hidden="true">${uiIcon('image')}</small>
    </label>
    ${avatar ? `<button class="client-avatar-remove" type="button" data-remove-client-avatar="${escapeHtml(normalizedPhone)}" data-booking-id="${escapeHtml(bookingId)}" aria-label="Удалить фото клиента">${uiIcon('close')}</button>` : ''}
  </span>`;
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
function serviceDurationDefaultsStorageKey(userId = currentUser?.id) { return `massage-service-duration-defaults-v1:${userId || 'guest'}`; }
function normalizeServiceDurationDefaults(value = {}) {
  const source = value?.values && typeof value.values === 'object' ? value.values : value;
  return Object.fromEntries(Object.entries(source && typeof source === 'object' ? source : {})
    .slice(0, 500)
    .map(([serviceId, duration]) => [String(serviceId), normalizePerMinuteDuration(duration, 60)]));
}
function restoreServiceDurationDefaults(user = currentUser) {
  let local = {};
  try { local = normalizeServiceDurationDefaults(JSON.parse(localStorage.getItem(serviceDurationDefaultsStorageKey(user?.id)) || '{}')); } catch {}
  const remote = normalizeServiceDurationDefaults(user?.user_metadata?.provider_service_duration_defaults || {});
  serviceDurationDefaults = Object.keys(remote).length ? remote : local;
  try { localStorage.setItem(serviceDurationDefaultsStorageKey(user?.id), JSON.stringify(serviceDurationDefaults)); } catch {}
}
function serviceDefaultDuration(serviceId) {
  return normalizePerMinuteDuration(serviceDurationDefaults[String(serviceId)] || 60, 60);
}
async function saveServiceDefaultDuration(serviceId, duration) {
  if (!currentUser?.id || !serviceId) return false;
  serviceDurationDefaults[String(serviceId)] = normalizePerMinuteDuration(duration, 60);
  try { localStorage.setItem(serviceDurationDefaultsStorageKey(), JSON.stringify(serviceDurationDefaults)); } catch {}
  if (!navigator.onLine) return false;
  const snapshot = { version:1, values:serviceDurationDefaults, updated_at:Date.now() };
  const { data, error } = await db.auth.updateUser({ data:{ provider_service_duration_defaults:snapshot } });
  if (data?.user) currentUser = data.user;
  return !error;
}
function normalizeMobileNavigation(value) {
  const allowed = new Set(PROVIDER_MOBILE_NAV_ITEMS.map(item => item.key));
  const result = [];
  const requested = Array.isArray(value) ? value : [];
  [...requested, ...DEFAULT_MOBILE_NAV, ...PROVIDER_MOBILE_NAV_ITEMS.map(item => item.key)].forEach(key => {
    const normalized = String(key || '');
    if (allowed.has(normalized) && !result.includes(normalized) && result.length < 4) result.push(normalized);
  });
  return result;
}
function normalizeAnalyticsGoals(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const bounded = (candidate, fallback, minimum, maximum) => {
    const number = Number(candidate);
    return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, Math.round(number))) : fallback;
  };
  return {
    revenue_rub:bounded(source.revenue_rub ?? source.revenue, DEFAULT_DISPLAY_PREFERENCES.analytics_goals.revenue_rub, 0, 1000000000),
    utilization_percent:bounded(source.utilization_percent ?? source.utilization, DEFAULT_DISPLAY_PREFERENCES.analytics_goals.utilization_percent, 10, 100),
    repeat_percent:bounded(source.repeat_percent ?? source.repeat, DEFAULT_DISPLAY_PREFERENCES.analytics_goals.repeat_percent, 0, 100),
    cancellation_percent:bounded(source.cancellation_percent ?? source.cancellation, DEFAULT_DISPLAY_PREFERENCES.analytics_goals.cancellation_percent, 0, 100)
  };
}
function normalizeAnalyticsGoalsByScope(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(Object.entries(source).slice(0, 50).map(([key, goals]) => [String(key).slice(0, 160), normalizeAnalyticsGoals(goals)]));
}
function normalizeDisplayPreferences(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const storedTheme = String(source.theme || '');
  const storedLayout = String(source.layout || '');
  const storedTextScale = String(source.text_scale || source.textScale || '');
  const legacyLayout = PROVIDER_LAYOUT_KEYS.includes(storedTheme) ? storedTheme : '';
  return {
    layout: PROVIDER_LAYOUT_KEYS.includes(storedLayout) ? storedLayout : legacyLayout || DEFAULT_DISPLAY_PREFERENCES.layout,
    theme: PROVIDER_THEME_KEYS.includes(storedTheme) ? storedTheme : LEGACY_PROVIDER_THEME_MAP[storedTheme] || DEFAULT_DISPLAY_PREFERENCES.theme,
    text_scale: PROVIDER_TEXT_SCALE_KEYS.includes(storedTextScale) ? storedTextScale : DEFAULT_DISPLAY_PREFERENCES.text_scale,
    show_phone: source.show_phone ?? DEFAULT_DISPLAY_PREFERENCES.show_phone,
    show_visit_number: source.show_visit_number ?? DEFAULT_DISPLAY_PREFERENCES.show_visit_number,
    show_client_type: source.show_client_type ?? DEFAULT_DISPLAY_PREFERENCES.show_client_type,
    show_client_labels: source.show_client_labels ?? DEFAULT_DISPLAY_PREFERENCES.show_client_labels,
    show_notes: source.show_notes ?? DEFAULT_DISPLAY_PREFERENCES.show_notes,
    ios_transitions: source.ios_transitions ?? DEFAULT_DISPLAY_PREFERENCES.ios_transitions,
    team_calendar_enabled: source.team_calendar_enabled ?? source.teamCalendarEnabled ?? DEFAULT_DISPLAY_PREFERENCES.team_calendar_enabled,
    mobile_nav: normalizeMobileNavigation(source.mobile_nav ?? source.mobileNav),
    analytics_goals:normalizeAnalyticsGoals(source.analytics_goals ?? source.analyticsGoals),
    analytics_goals_by_scope:normalizeAnalyticsGoalsByScope(source.analytics_goals_by_scope ?? source.analyticsGoalsByScope)
  };
}
function displayPreferencesEqual(left, right) {
  const a = normalizeDisplayPreferences(left);
  const b = normalizeDisplayPreferences(right);
  return a.layout === b.layout
    && a.theme === b.theme
    && a.text_scale === b.text_scale
    && a.show_phone === b.show_phone
    && a.show_visit_number === b.show_visit_number
    && a.show_client_type === b.show_client_type
    && a.show_client_labels === b.show_client_labels
    && a.show_notes === b.show_notes
    && a.ios_transitions === b.ios_transitions
    && a.team_calendar_enabled === b.team_calendar_enabled
    && JSON.stringify(a.mobile_nav) === JSON.stringify(b.mobile_nav)
    && JSON.stringify(a.analytics_goals) === JSON.stringify(b.analytics_goals)
    && JSON.stringify(a.analytics_goals_by_scope) === JSON.stringify(b.analytics_goals_by_scope);
}
function normalizeDisplayPreferencesRecord(value = {}, exists = true) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const storedPreferences = source.preferences && typeof source.preferences === 'object' && !Array.isArray(source.preferences)
    ? source.preferences
    : source;
  const timestamp = Number(source.updated_at ?? storedPreferences.updated_at ?? 0);
  return {
    exists: Boolean(exists),
    preferences: normalizeDisplayPreferences(storedPreferences),
    updatedAt: Number.isFinite(timestamp) && timestamp > 0 ? Math.floor(timestamp) : 0,
    pending: source.pending === true
  };
}
function resolveDisplayPreferenceRecords(localRecord, remoteRecord, now = Date.now()) {
  const local = localRecord || normalizeDisplayPreferencesRecord({}, false);
  const remote = remoteRecord || normalizeDisplayPreferencesRecord({}, false);
  const samePreferences = local.exists && remote.exists && displayPreferencesEqual(local.preferences, remote.preferences);
  if (samePreferences && local.updatedAt === remote.updatedAt) {
    return { exists:true, preferences:local.preferences, updatedAt:local.updatedAt, pending:false };
  }
  if (local.exists && local.pending) {
    const timestamp = !samePreferences && local.updatedAt <= remote.updatedAt
      ? Math.max(Number(now) || Date.now(), remote.updatedAt + 1, 1)
      : local.updatedAt || Math.max(Number(now) || Date.now(), 1);
    return { exists:true, preferences:local.preferences, updatedAt:timestamp, pending:true };
  }
  if (remote.exists && (!local.exists || remote.updatedAt > local.updatedAt)) {
    return { exists:true, preferences:remote.preferences, updatedAt:remote.updatedAt, pending:false };
  }
  if (local.exists) {
    if (samePreferences) return { exists:true, preferences:local.preferences, updatedAt:local.updatedAt, pending:false };
    const timestamp = local.updatedAt <= remote.updatedAt
      ? Math.max(Number(now) || Date.now(), remote.updatedAt + 1, 1)
      : local.updatedAt;
    return { exists:true, preferences:local.preferences, updatedAt:timestamp, pending:true };
  }
  if (remote.exists) return { exists:true, preferences:remote.preferences, updatedAt:remote.updatedAt, pending:false };
  return { exists:false, preferences:{ ...DEFAULT_DISPLAY_PREFERENCES }, updatedAt:0, pending:false };
}
function loadLocalDisplayPreferences(userId = currentUser?.id) {
  try {
    const stored = localStorage.getItem(providerDisplayStorageKey(userId));
    return normalizeDisplayPreferencesRecord(stored ? JSON.parse(stored) : {}, Boolean(stored));
  } catch {
    return normalizeDisplayPreferencesRecord({}, false);
  }
}
function persistLocalDisplayPreferences(userId = currentUser?.id) {
  if (!userId) return;
  try {
    localStorage.setItem(providerDisplayStorageKey(userId), JSON.stringify({
      version: 4,
      preferences: displayPreferences,
      updated_at: displayPreferencesUpdatedAt,
      pending: displayPreferencesPending
    }));
  } catch {}
}
function restoreDisplayPreferences(user = currentUser) {
  const local = loadLocalDisplayPreferences(user?.id);
  const remoteValue = user?.user_metadata?.provider_display_preferences;
  const remoteExists = Boolean(remoteValue && typeof remoteValue === 'object' && !Array.isArray(remoteValue) && Object.keys(remoteValue).length);
  const remote = normalizeDisplayPreferencesRecord(remoteValue || {}, remoteExists);
  const resolved = resolveDisplayPreferenceRecords(local, remote);
  displayPreferences = resolved.preferences;
  displayPreferencesUpdatedAt = resolved.updatedAt;
  displayPreferencesPending = resolved.pending;
  if (resolved.exists) persistLocalDisplayPreferences(user?.id);
  return resolved;
}
function displayPreferencesServerSnapshot() {
  return {
    ...displayPreferences,
    version: 4,
    updated_at: displayPreferencesUpdatedAt
  };
}
function queueDisplayPreferencesSync(delay = 350) {
  clearTimeout(displayPreferencesSaveTimer);
  displayPreferencesSaveTimer = null;
  const revision = ++displayPreferencesSaveRevision;
  const status = $('#providerDisplayStatus');
  if (!displayPreferencesPending) return;
  if (!currentUser || !navigator.onLine) {
    if (status) status.textContent = 'Сохранено на этом устройстве · синхронизируется при подключении';
    return;
  }
  const userId = currentUser.id;
  const preferencesSnapshot = displayPreferencesServerSnapshot();
  if (status) status.textContent = 'Сохраняем…';
  displayPreferencesSaveTimer = setTimeout(async () => {
    displayPreferencesSaveTimer = null;
    const { data, error } = await db.auth.updateUser({ data: { provider_display_preferences: preferencesSnapshot } });
    if (revision !== displayPreferencesSaveRevision || currentUser?.id !== userId) return;
    if (error) {
      if (status) status.textContent = 'Сохранено на этом устройстве · синхронизируется при подключении';
      return;
    }
    if (data?.user) currentUser = data.user;
    if (displayPreferencesUpdatedAt === preferencesSnapshot.updated_at
      && displayPreferencesEqual(displayPreferences, preferencesSnapshot)) {
      displayPreferencesPending = false;
      persistLocalDisplayPreferences(userId);
      if (status) status.textContent = 'Сохранено в аккаунте';
    }
  }, Math.max(0, Number(delay) || 0));
}
function renderMobileNavigation() {
  const nav = $('.provider-mobile-nav');
  if (!nav) return;
  const selected = normalizeMobileNavigation(displayPreferences.mobile_nav);
  const activeView = $('#dashboard')?.dataset.activeView || 'bookings';
  nav.innerHTML = `${selected.map(key => {
    const item = PROVIDER_MOBILE_NAV_ITEMS.find(entry => entry.key === key);
    return `<button type="button" data-provider-view="${item.key}">${uiIcon(item.icon)}<span>${item.label}</span></button>`;
  }).join('')}<button type="button" data-provider-view="more">${uiIcon('more')}<span>Разделы</span></button>`;
  nav.querySelectorAll('[data-provider-view]').forEach(button => {
    const active = button.dataset.providerView === activeView || (button.dataset.providerView === 'more' && !selected.includes(activeView));
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  $$('.mobile-more-grid [data-provider-view]').forEach(button => {
    button.hidden = selected.includes(button.dataset.providerView);
  });
}
function applyDisplayPreferences() {
  document.body.dataset.providerTheme = displayPreferences.theme;
  document.body.dataset.providerLayout = displayPreferences.layout;
  document.body.dataset.providerTextScale = displayPreferences.text_scale;
  document.body.dataset.iosTransitions = displayPreferences.ios_transitions ? 'on' : 'off';
  const themeColors = { sage:'#153c2c', nordic:'#3568e8', warm:'#a9664c', graphite:'#11171b', lavender:'#7660cc', luxury:'#0b0c0e', loft:'#292a28', eco:'#f1ece2', hitech:'#eef4fa' };
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColors[displayPreferences.theme] || themeColors.sage);
  renderMobileNavigation();
}

function setTeamCalendarEnabledPreference(nextEnabled) {
  const normalized = nextEnabled === true;
  if (displayPreferences.team_calendar_enabled === normalized) return;
  displayPreferences = normalizeDisplayPreferences({ ...displayPreferences, team_calendar_enabled:normalized });
  displayPreferencesUpdatedAt = Math.max(Date.now(), displayPreferencesUpdatedAt + 1);
  displayPreferencesPending = true;
  persistLocalDisplayPreferences();
  queueDisplayPreferencesSync();
}
function renderDisplayPreferencesForm() {
  const form = $('#providerDisplayForm');
  if (!form) return;
  const layout = form.querySelector(`input[name="providerLayout"][value="${displayPreferences.layout}"]`);
  if (layout) layout.checked = true;
  const theme = form.querySelector(`input[name="providerTheme"][value="${displayPreferences.theme}"]`);
  if (theme) theme.checked = true;
  const textScale = form.querySelector(`input[name="providerTextScale"][value="${displayPreferences.text_scale}"]`);
  if (textScale) textScale.checked = true;
  $('#showBookingPhone').checked = displayPreferences.show_phone;
  $('#showBookingVisitNumber').checked = displayPreferences.show_visit_number;
  $('#showBookingClientType').checked = displayPreferences.show_client_type;
  $('#showBookingClientLabels').checked = displayPreferences.show_client_labels;
  $('#showBookingNotes').checked = displayPreferences.show_notes;
  $('#iosTransitionsEnabled').checked = displayPreferences.ios_transitions;
  const selected = normalizeMobileNavigation(displayPreferences.mobile_nav);
  $$('[data-mobile-nav-slot]').forEach((select, index) => {
    select.innerHTML = PROVIDER_MOBILE_NAV_ITEMS.map(item => `<option value="${item.key}">${item.label}</option>`).join('');
    select.value = selected[index];
  });
  $$('[data-mobile-nav-slot]').forEach(select => {
    const current = select.value;
    select.querySelectorAll('option').forEach(option => { option.disabled = option.value !== current && selected.includes(option.value); });
  });
  renderReportGoalsSummary();
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
function providerAppIsDesktop() {
  return !providerAppIsIos() && !providerAppIsAndroid();
}
function providerFullscreenActive() {
  return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
}
function providerAppIsInAppBrowser() {
  return /; wv\)|\bwv\b|instagram|fban|fbav|telegram|line\/|micromessenger/i.test(navigator.userAgent);
}
function providerAppHasSecureOrigin() {
  return window.isSecureContext || ['localhost', '127.0.0.1'].includes(location.hostname);
}
function hideProviderInstallGuides() {
  ['desktopInstallGuide', 'androidInstallGuide', 'iosInstallGuide', 'browserInstallGuide'].forEach(id => {
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
async function openProviderInstallHelp(id, statusText) {
  if (!$('#dashboard')?.hidden) {
    await Promise.resolve(setProviderView('settings'));
    await new Promise(resolve => requestAnimationFrame(resolve));
    const sectionButton = $('[data-provider-panel="settings"] [data-section-target="installAppCard"]');
    if (sectionButton) scrollToProviderSection(sectionButton);
  }
  showProviderInstallGuide(id);
  const status = $('#installAppStatus');
  if (statusText && status) status.textContent = statusText;
}
function refreshInstallAppCard() {
  const button = $('#installAppButton');
  const topbarButton = $('#desktopAppInstallButton');
  const fullscreenButton = $('#providerFullscreenButton');
  const status = $('#installAppStatus');
  if (!button || !status) return;
  button.disabled = false;
  if (topbarButton) topbarButton.hidden = !providerAppIsDesktop() || providerAppIsInstalled();
  if (fullscreenButton) {
    fullscreenButton.hidden = !providerAppIsDesktop() || !document.documentElement.requestFullscreen;
    fullscreenButton.querySelector('span').textContent = providerFullscreenActive() ? 'Выйти из полного экрана' : 'На весь экран';
  }
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
  if (deferredInstallPrompt || window.MinutaPwaInstall?.hasPrompt?.()) {
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
  button.querySelector('span').textContent = 'Установить на компьютер';
  status.textContent = 'Кабинет откроется отдельным окном и появится в меню «Пуск». Ярлык можно добавить на рабочий стол.';
}
async function installProviderApp() {
  if (providerAppIsInstalled()) {
    notify('Приложение уже установлено');
    return;
  }
  if (!providerAppHasSecureOrigin()) {
    await openProviderInstallHelp('browserInstallGuide', 'Для установки откройте опубликованную HTTPS-версию сайта.');
    return;
  }
  const availablePrompt = deferredInstallPrompt || window.MinutaPwaInstall?.takePrompt?.();
  if (availablePrompt) {
    const prompt = availablePrompt;
    deferredInstallPrompt = null;
    window.MinutaPwaInstall?.clearPrompt?.();
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      refreshInstallAppCard();
      notify(choice.outcome === 'accepted' ? 'Установка приложения началась' : 'Установка отменена');
    } catch {
      refreshInstallAppCard();
      const guide = providerAppIsAndroid() ? 'androidInstallGuide' : providerAppIsDesktop() ? 'desktopInstallGuide' : 'browserInstallGuide';
      await openProviderInstallHelp(guide, 'Системное окно установки не открылось. Используйте инструкцию ниже.');
    }
    return;
  }
  if (providerAppIsIos()) {
    await openProviderInstallHelp('iosInstallGuide', 'На iPhone и iPad установка выполняется через меню «Поделиться» в Safari.');
    return;
  }
  if (providerAppIsAndroid()) {
    await openProviderInstallHelp('androidInstallGuide', 'Браузер не показал системное окно. Установите приложение через меню Chrome по инструкции ниже.');
    return;
  }
  await openProviderInstallHelp(
    providerAppIsDesktop() ? 'desktopInstallGuide' : 'browserInstallGuide',
    providerAppIsDesktop()
      ? 'Браузер не показал системное окно. Установите приложение через меню Microsoft Edge или Google Chrome по инструкции ниже.'
      : 'Автоматическая установка недоступна в этом браузере. Используйте инструкцию ниже.'
  );
}
async function toggleProviderFullscreen() {
  try {
    if (providerFullscreenActive()) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen({ navigationUI:'hide' });
  } catch {
    notify('Полноэкранный режим заблокирован браузером');
  }
  refreshInstallAppCard();
}
function displayPreferencesFromForm() {
  return normalizeDisplayPreferences({
    layout: $('#providerDisplayForm input[name="providerLayout"]:checked')?.value,
    theme: $('#providerDisplayForm input[name="providerTheme"]:checked')?.value,
    text_scale: $('#providerDisplayForm input[name="providerTextScale"]:checked')?.value,
    show_phone: $('#showBookingPhone').checked,
    show_visit_number: $('#showBookingVisitNumber').checked,
    show_client_type: $('#showBookingClientType').checked,
    show_client_labels: $('#showBookingClientLabels').checked,
    show_notes: $('#showBookingNotes').checked,
    ios_transitions: $('#iosTransitionsEnabled').checked,
    mobile_nav: $$('[data-mobile-nav-slot]').map(select => select.value),
    analytics_goals:displayPreferences.analytics_goals,
    analytics_goals_by_scope:displayPreferences.analytics_goals_by_scope
  });
}
function saveDisplayPreferences() {
  displayPreferences = displayPreferencesFromForm();
  displayPreferencesUpdatedAt = Math.max(Date.now(), displayPreferencesUpdatedAt + 1);
  displayPreferencesPending = true;
  persistLocalDisplayPreferences();
  applyDisplayPreferences();
  renderDisplayPreferencesForm();
  renderBookings();
  queueDisplayPreferencesSync();
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
    value.favorite ? { key:'favorite', icon:'heart', label:'Любимый клиент', detail:value.favorite_note } : null
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
      return `<span class="client-badge badge-${item.key}" title="${escapeHtml(title)}">${uiIcon(item.icon)}<span class="client-badge-label">${escapeHtml(item.label)}</span></span>`;
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
function bookingColorPendingStorageKey(userId = currentUser?.id) { return `massage-booking-colors-pending-v1:${userId || 'anonymous'}`; }
function validBookingColor(value) { return BOOKING_COLOR_KEYS.includes(String(value)) ? String(value) : BOOKING_COLOR_DEFAULT; }
function loadBookingColors(userId = currentUser?.id) {
  try {
    const saved = JSON.parse(localStorage.getItem(bookingColorStorageKey(userId)) || '{}');
    bookingColors = new Map(Object.entries(saved).map(([id, color]) => [id, validBookingColor(color)]));
  } catch { bookingColors = new Map(); }
  try { pendingBookingColors = new Set(JSON.parse(localStorage.getItem(bookingColorPendingStorageKey(userId)) || '[]')); }
  catch { pendingBookingColors = new Set(); }
}
function persistBookingColors(userId = currentUser?.id) {
  if (!userId) return;
  try {
    localStorage.setItem(bookingColorStorageKey(userId), JSON.stringify(Object.fromEntries(bookingColors)));
    localStorage.setItem(bookingColorPendingStorageKey(userId), JSON.stringify([...pendingBookingColors]));
  } catch {}
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
  const current = validBookingColor(selected);
  return `<fieldset class="booking-color-picker"><legend>Цвет записи</legend><div class="booking-color-options">${BOOKING_COLOR_KEYS.map(color => `<label class="booking-color-option color-${color}" title="${BOOKING_COLOR_LABELS[color]}"><input type="radio" name="${name}" value="${color}" aria-label="${BOOKING_COLOR_LABELS[color]}" ${color === current ? 'checked' : ''} ${bookingId ? `data-booking-color-id="${bookingId}"` : ''}><span aria-hidden="true"></span><small>${BOOKING_COLOR_LABELS[color]}</small></label>`).join('')}</div></fieldset>`;
}
function compactBookingColorPicker(name, selected, bookingId) {
  const current = validBookingColor(selected);
  return `<details class="booking-color-compact"><summary><span>Цвет записи</span><strong><i class="booking-color-dot color-${current}" aria-hidden="true"></i>${BOOKING_COLOR_LABELS[current]}</strong></summary>${bookingColorPicker(name, current, bookingId)}</details>`;
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
  pendingBookingColors.add(id);
  persistBookingColors();
  const item = allBookings.find(booking => booking.id === id);
  if (item) item.color_key = selected;
  if (rerender) renderBookingData();
  const { error } = await db.rpc('set_booking_color', { p_booking: id, p_color: selected });
  if (!error) pendingBookingColors.delete(id);
  persistBookingColors();
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
    if (!pendingBookingColors.has(item.id)) bookingColors.set(item.id, validBookingColor(item.color_key));
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
function uiIcon(name, className = '') { return `<svg class="ui-icon${className ? ` ${className}` : ''}" aria-hidden="true"><use href="ui-icons.svg?v=326#icon-${name}"></use></svg>`; }
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
function bookingOutcome(item) {
  const embedded = item?.booking_outcomes;
  return bookingOutcomes.get(item.id) || (embedded?.visit_status ? embedded : null) || { visit_status: 'scheduled', payment_method: 'unpaid', amount_rub: 0, actual_duration_minutes: 0, calculated_amount_rub: 0, completion_source: 'manual' };
}
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
  if (item?.is_imported_history) return long ? 'Импортировано из прежнего журнала' : 'Импортировано';
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
  if (item?.is_imported_history) return 'visited';
  if (item.status === 'cancelled') return 'cancelled';
  if (isScheduleBlock(item)) return 'block';
  const outcome = bookingOutcome(item);
  if (outcome.visit_status === 'completed') return 'visited';
  if (outcome.visit_status === 'no_show') return 'no-show';
  return bookingIsCompleted(item) ? 'needs-result' : item.status;
}
function paymentMethodLabel(method, completionSource = 'manual') {
  if (completionSource === 'auto' && method !== 'unpaid') return 'Оплачено';
  return ({ cash: 'Наличные', card: 'Карта', transfer: 'Перевод', imported:'Стоимость из журнала', unpaid: 'Не оплачено' })[method] || 'Не оплачено';
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
  const received = Math.max(0, Number(outcome.amount_rub || 0));
  const payment = received > 0
    ? `Получено ${money(received)} · ${paymentMethodLabel(outcome.payment_method, outcome.completion_source)}`
    : `Не оплачено · долг ${money(bookingCalculatedValue(item))}`;
  return `${actualTime}${payment}`;
}

function bookingPaymentText(item) {
  const outcome = bookingOutcome(item);
  if (outcome.visit_status !== 'completed') return '';
  const received = Math.max(0, Number(outcome.amount_rub || 0));
  return received > 0 ? `Получено ${money(received)}` : `Не оплачено · долг ${money(bookingCalculatedValue(item))}`;
}

let reportPerformerFilter = '';
let reportCanViewTeam = false;
let reportScopedBookingsState = { key:'', status:'idle', rows:[] };
let reportAvailabilityState = { key:'', status:'idle', availableMinutes:null, configured:0, total:0, complete:false };
let reportDataSource = 'own';
const REPORT_DEMO_SLUG = 'minuta-demo-statistics';

function reportOrganizations() {
  return organizationController?.getOrganizations?.() || [];
}

function reportDemoOrganization() {
  return reportOrganizations().find(item => item.public_slug === REPORT_DEMO_SLUG) || null;
}

function reportOwnOrganization() {
  const active = organizationController?.getActiveOrganization?.() || null;
  if (active?.public_slug !== REPORT_DEMO_SLUG) return active;
  return reportOrganizations().find(item => item.public_slug !== REPORT_DEMO_SLUG) || active;
}

function reportOrganization() {
  return reportDataSource === 'demo' ? reportDemoOrganization() : reportOwnOrganization();
}

function reportOrganizationId() {
  return reportOrganization()?.id || '';
}

function reportUsesScopedBookings() {
  return reportDataSource === 'demo' || reportCanViewTeam;
}

function loadSelectedReportData() {
  if (reportDataSource !== 'demo') return;
  reportCanViewTeam = true;
  if (!reportPerformerFilter) reportPerformerFilter = 'all';
  const range = reportRange();
  const previous = previousReportRange(range);
  void loadReportScopedBookings({ start:previous?.start || range.start, end:reportForecastEnd(range) }, reportPerformerFilter);
  void loadReportAvailability(range, reportPerformerFilter);
}

function renderReportDataSourceControl() {
  const root = $('#reportDataSource');
  if (!root) return;
  const demo = reportDemoOrganization();
  const own = reportOwnOrganization();
  root.hidden = !demo || !own || demo.id === own.id;
  if (reportDataSource === 'demo' && !demo) reportDataSource = 'own';
  $$('[data-report-source]').forEach(button => {
    const active = button.dataset.reportSource === reportDataSource;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const status = $('#reportDataSourceStatus');
  if (status) status.textContent = reportDataSource === 'demo'
    ? 'Учебные обезличенные данные за три месяца — ваши записи не изменяются'
    : 'Ваши реальные записи и оплаты';
  const panel = $('[data-provider-panel="analytics"]');
  if (panel) panel.dataset.reportSource = reportDataSource;
}

function reportSessionKey(organizationId, ...parts) {
  return [sessionGeneration, currentUser?.id || '', organizationId || '', ...parts].join(':');
}

function resetReportSessionState() {
  reportPerformerFilter = '';
  reportCanViewTeam = false;
  reportScopedBookingsState = { key:'', status:'idle', rows:[] };
  reportAvailabilityState = { key:'', status:'idle', availableMinutes:null, configured:0, total:0, complete:false };
  reportTeamAnalyticsState = { key:'', status:'idle', rows:[], canViewTeam:false };
  reportEventState = { key:'', rows:[], status:'idle' };
  reportTeamMetric = 'revenue';
  document.body.classList.remove('report-scope-loading');
  const select = $('#reportPerformerFilter');
  if (select) select.disabled = false;
}

function reportDateText(value, options = { day:'numeric', month:'short' }) {
  return parseLocalIsoDate(value).toLocaleDateString('ru-RU', options);
}

function reportRange(period = reportPeriod) {
  const todayIso = businessTodayIso();
  const today = parseLocalIsoDate(todayIso);
  let start = todayIso;
  let end = todayIso;
  if (period === 'week') start = localIsoDate(new Date(today.getTime() - 6 * 86400000));
  if (period === 'month') start = localIsoDate(new Date(today.getFullYear(), today.getMonth(), 1));
  if (period === 'quarter') start = localIsoDate(new Date(today.getTime() - 89 * 86400000));
  if (period === 'year') start = localIsoDate(new Date(today.getFullYear(), 0, 1));
  if (period === 'all') {
    if (reportDataSource === 'demo') start = localIsoDate(new Date(today.getFullYear(), today.getMonth() - 3, 1));
    else {
      const organizationId = reportOrganizationId();
      const liveSource = reportUsesScopedBookings() && reportScopedBookingsState.status === 'ready'
        ? reportScopedBookingsState.rows
        : allBookings;
      const dates = [...liveSource, ...importedBookingHistory]
        .filter(item => !isScheduleBlock(item)
          && item.booking_date <= todayIso
          && (!organizationId || !item.organization_id || String(item.organization_id) === String(organizationId)))
        .map(item => item.booking_date)
        .sort();
      start = dates[0] || todayIso;
    }
  }
  if (period === 'custom') {
    start = reportCustomStart || todayIso;
    end = reportCustomEnd || todayIso;
  }
  return { start, end, period };
}

function reportDataQueryRange(range) {
  if (reportPeriod !== 'all' || reportDataSource === 'demo') return range;
  return { ...range, start:'2000-01-01' };
}

function reportBookings(range = reportRange()) {
  const liveSource = reportUsesScopedBookings() ? (reportScopedBookingsState.status === 'ready' ? reportScopedBookingsState.rows : []) : allBookings;
  const source = [...liveSource, ...importedBookingHistory];
  const organizationId = reportOrganizationId();
  return source.filter(item => !isScheduleBlock(item)
    && item.booking_date >= range.start && item.booking_date <= range.end
    && (!organizationId || !item.organization_id || String(item.organization_id) === String(organizationId))
    && (!reportCanViewTeam || !reportPerformerFilter || reportPerformerFilter === 'all' || String(item.performer_id || '') === reportPerformerFilter));
}

function previousReportRange(range) {
  if (range.period === 'all') return null;
  const start = parseLocalIsoDate(range.start);
  const end = parseLocalIsoDate(range.end);
  const days = Math.max(1, Math.round((end - start) / 86400000) + 1);
  if (days * 2 > 3661) return null;
  const previousEnd = new Date(start.getTime() - 86400000);
  return { start:localIsoDate(new Date(previousEnd.getTime() - (days - 1) * 86400000)), end:localIsoDate(previousEnd), period:'previous' };
}

function reportCompletedItems(items) {
  return items.filter(item => item.status !== 'cancelled' && bookingOutcome(item).visit_status === 'completed');
}

function reportRevenue(items) {
  return reportCompletedItems(items).reduce((sum, item) => sum + Number(bookingOutcome(item).amount_rub || 0), 0);
}

function reportClientIdentity(item) {
  const clientId = String(item?.client_account_id || item?.client_id || '').trim();
  if (clientId) return `id:${clientId}`;
  const phone = normalizePhone(item?.client_phone || '');
  return phone ? `phone:${phone}` : '';
}

function reportClientMetrics(completed, range) {
  const currentClients = new Set(completed.map(reportClientIdentity).filter(Boolean));
  const liveSource = reportUsesScopedBookings() && reportScopedBookingsState.status === 'ready' ? reportScopedBookingsState.rows : allBookings;
  const organizationId = reportOrganizationId();
  const importedSource = reportDataSource === 'demo' ? [] : importedBookingHistory.filter(item =>
    !organizationId || !item.organization_id || String(item.organization_id) === String(organizationId));
  const source = [...liveSource, ...importedSource];
  const previousClients = new Set(reportCompletedItems(source.filter(item => !isScheduleBlock(item) && item.booking_date < range.start)).map(reportClientIdentity).filter(Boolean));
  completed.forEach(item => { if (item.client_had_previous) { const key = reportClientIdentity(item); if (key) previousClients.add(key); } });
  let newClients = 0;
  let returningClients = 0;
  currentClients.forEach(key => {
    if (previousClients.has(key)) returningClients += 1;
    else newClients += 1;
  });
  return { uniqueClients:currentClients.size, newClients, returningClients };
}

function reportBookingSource(item) {
  const source = String(item?.booking_source || '').trim().toLowerCase();
  if (source === 'client_online') return 'online';
  if (['provider_manual', 'admin_manual', 'provider_series', 'provider_repeat'].includes(source)) return 'manual';
  return 'unknown';
}

function reportSourceMetrics(items) {
  return items.reduce((result, item) => {
    result[reportBookingSource(item)] += 1;
    return result;
  }, { online:0, manual:0, unknown:0 });
}

function reportShare(value, total) { return total ? `${Math.round(value / total * 100)}%` : '0%'; }
function reportHours(minutes) { return `${Math.round(Math.max(0, Number(minutes) || 0) / 6) / 10} ч`; }

function setReportText(selector, value) {
  const element = $(selector);
  if (element) element.textContent = String(value);
}

function setReportTrend(selector, current, previous, hasPreviousRange) {
  const element = $(selector);
  if (!element) return;
  element.className = '';
  if (!hasPreviousRange) element.textContent = 'За весь доступный период';
  else if (!previous) element.textContent = 'Нет данных для сравнения';
  else {
    const percent = Math.round((current - previous) / previous * 100);
    element.textContent = `${percent >= 0 ? '+' : ''}${percent}% к предыдущему периоду`;
    element.className = percent > 0 ? 'is-positive' : percent < 0 ? 'is-negative' : '';
  }
}

function setReportComparison(selector, current, previous, formatDelta = value => String(value)) {
  const element = $(selector);
  if (!element) return;
  const difference = current - previous;
  element.className = difference > 0 ? 'is-positive' : difference < 0 ? 'is-negative' : '';
  if (!previous) {
    element.textContent = 'Нет данных для сравнения';
    return;
  }
  const percent = Math.round(difference / previous * 100);
  const valueSign = difference > 0 ? '+' : difference < 0 ? '−' : '';
  const percentSign = percent > 0 ? '+' : percent < 0 ? '−' : '';
  element.textContent = `${valueSign}${formatDelta(Math.abs(difference))} · ${percentSign}${Math.abs(percent)}%`;
}

function reportAvailableScheduleMinutes(range) {
  if (reportCanViewTeam) {
    const organizationId = reportOrganizationId();
    const key = reportSessionKey(organizationId, range.start, range.end, reportPerformerFilter || 'all');
    if (reportAvailabilityState.key === key && reportAvailabilityState.status === 'ready' && reportAvailabilityState.complete) return reportAvailabilityState.availableMinutes;
    return null;
  }
  const rowsByWeekday = new Map(scheduleRows.map(row => [Number(row.weekday), row]));
  if ([1, 2, 3, 4, 5, 6, 7].some(weekday => !rowsByWeekday.has(weekday))) return null;
  const start = parseLocalIsoDate(range.start);
  const end = parseLocalIsoDate(range.end);
  const days = Math.round((end - start) / 86400000) + 1;
  if (!Number.isFinite(days) || days < 1 || days > 3660) return null;
  let available = 0;
  for (let offset = 0; offset < days; offset += 1) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset);
    const dateIso = localIsoDate(date);
    const weekday = ((date.getDay() + 6) % 7) + 1;
    const row = rowsByWeekday.get(weekday);
    if (row.enabled === false) continue;
    const dayStart = minutesFromTime(row.start_time);
    const dayEnd = minutesFromTime(row.end_time);
    if (!/^\d{2}:\d{2}/.test(String(row.start_time || '')) || !/^\d{2}:\d{2}/.test(String(row.end_time || '')) || dayEnd <= dayStart) return null;
    let dayMinutes = dayEnd - dayStart;
    if (row.break_enabled) {
      const breakStartValue = row.break_start_time || row.break_start;
      const breakEndValue = row.break_end_time || row.break_end;
      const breakStart = minutesFromTime(breakStartValue);
      const breakEnd = minutesFromTime(breakEndValue);
      if (!/^\d{2}:\d{2}/.test(String(breakStartValue || '')) || !/^\d{2}:\d{2}/.test(String(breakEndValue || '')) || breakEnd <= breakStart) return null;
      dayMinutes -= Math.max(0, Math.min(dayEnd, breakEnd) - Math.max(dayStart, breakStart));
    }
    const exceptions = daysOff.filter(item => String(item.date || item.day_off_date || '') === dateIso);
    for (const exception of exceptions) {
      if (exception.all_day === true || exception.is_all_day === true) {
        dayMinutes = 0;
        break;
      }
      const exceptionStartValue = exception.start_time;
      const exceptionEndValue = exception.end_time;
      if (!/^\d{2}:\d{2}/.test(String(exceptionStartValue || '')) || !/^\d{2}:\d{2}/.test(String(exceptionEndValue || ''))) return null;
      dayMinutes -= Math.max(0, Math.min(dayEnd, minutesFromTime(exceptionEndValue)) - Math.max(dayStart, minutesFromTime(exceptionStartValue)));
    }
    available += Math.max(0, dayMinutes);
  }
  return available;
}

function renderReportUtilization(range, workedMinutes) {
  const availableMinutes = reportAvailableScheduleMinutes(range);
  setReportText('#reportBookedHours', reportHours(workedMinutes));
  const percentNode = $('#reportUtilizationPercent');
  const bar = $('#reportUtilizationBar');
  const note = $('#reportUtilizationNote') || $('#reportUtilizationCaption');
  if (availableMinutes === null) {
    if (percentNode) percentNode.textContent = '—';
    setReportText('#reportAvailableHours', '—');
    setReportText('#reportFreeHours', '—');
    if (bar) bar.style.width = '0%';
    if (note) note.textContent = reportAvailabilityState.status === 'loading' ? 'Загружаем рабочие графики…' : reportAvailabilityState.total > reportAvailabilityState.configured ? `Не настроен график у ${reportAvailabilityState.total - reportAvailabilityState.configured} сотрудников` : 'Недостаточно данных для процента';
    return null;
  }
  const percent = availableMinutes ? Math.round(workedMinutes / availableMinutes * 100) : 0;
  if (percentNode) percentNode.textContent = `${percent}%`;
  setReportText('#reportAvailableHours', reportHours(availableMinutes));
  setReportText('#reportFreeHours', reportHours(Math.max(0, availableMinutes - workedMinutes)));
  if (bar) bar.style.width = `${Math.min(100, Math.max(0, percent))}%`;
  if (note) note.textContent = 'Состоявшиеся визиты относительно доступного рабочего времени';
  return percent;
}

function renderReportRetention() {
  const payloadValue = retentionController?.payload;
  const payload = typeof payloadValue === 'function' ? payloadValue.call(retentionController) : payloadValue;
  const clients = Array.isArray(payload?.clients) ? payload.clients : [];
  const deliveries = Array.isArray(payload?.deliveries) ? payload.deliveries : [];
  const eligible = clients.filter(item => item.eligible === true).length;
  const regular = clients.filter(item => item.eligible === true && Number(item.completed_visits || 0) >= 3).length;
  const prepared = deliveries.filter(item => ['prepared', 'draft'].includes(String(item.status || '').toLowerCase())).length;
  const sent = deliveries.filter(item => ['sent', 'delivered'].includes(String(item.status || '').toLowerCase())).length;
  const unknownConsent = clients.filter(item => !item.consent_status || String(item.consent_status).toLowerCase() === 'unknown').length;
  setReportText('#reportRetentionEligible', eligible);
  setReportText('#reportRetentionRegular', regular);
  setReportText('#reportRetentionPrepared', prepared);
  setReportText('#reportRetentionSent', sent);
  setReportText('#reportRetentionUnknownConsent', unknownConsent);
  const panel = $('.report-retention');
  if (panel) {
    const isEmpty = eligible + regular + prepared + sent === 0;
    panel.classList.toggle('is-empty', isEmpty);
    let empty = panel.querySelector('.report-retention-empty');
    if (!empty) {
      panel.insertAdjacentHTML('beforeend', '<p class="report-retention-empty"></p>');
      empty = panel.querySelector('.report-retention-empty');
    }
    empty.textContent = 'Клиентов для возвращения пока нет' + (unknownConsent ? ` · у ${unknownConsent} не указано согласие` : '');
  }
}

let reportTeamAnalyticsState = { key:'', status:'idle', rows:[], canViewTeam:false };
let reportTeamMetric = 'revenue';
let reportServiceMetric = 'revenue';
let reportServicesExpanded = false;

function reportPerformerName() {
  if (!reportCanViewTeam || !reportPerformerFilter || reportPerformerFilter === 'all') return reportCanViewTeam ? 'Вся команда' : 'Личная статистика';
  return reportTeamAnalyticsState.rows.find(row => String(row.performer_id || '') === reportPerformerFilter)?.performer_name || 'Сотрудник';
}

function reportPeriodName(period = reportPeriod) {
  return ({ week:'7 дней', month:'Месяц', quarter:'90 дней', year:'Год', all:'Всё время', custom:'Свои даты' })[period] || 'Период';
}

function setReportFiltersExpanded(expanded) {
  const filters = $('.report-filters');
  const toggle = $('#reportFilterToggle');
  if (!filters || !toggle) return;
  filters.classList.toggle('is-open', Boolean(expanded));
  toggle.setAttribute('aria-expanded', String(Boolean(expanded)));
}

function updateReportFilterSummary() {
  const summary = $('#reportFilterSummary');
  if (!summary) return;
  summary.textContent = `${reportPeriodName()} · ${reportPerformerName()}${reportDataSource === 'demo' ? ' · Демо' : ''}`;
}

function renderReportPerformerFilter(range) {
  const wrap = $('#reportPerformerFilterWrap');
  const select = $('#reportPerformerFilter');
  if (!wrap || !select) return;
  wrap.hidden = !reportCanViewTeam;
  if (!reportCanViewTeam) { reportPerformerFilter = String(currentUser?.id || ''); return; }
  if (!reportPerformerFilter) {
    try { reportPerformerFilter = localStorage.getItem(`minuta-report-performer:${reportOrganizationId()}`) || 'all'; } catch { reportPerformerFilter = 'all'; }
  }
  if (reportPerformerFilter !== 'all' && !reportTeamAnalyticsState.rows.some(row => String(row.performer_id || '') === reportPerformerFilter)) reportPerformerFilter = 'all';
  select.innerHTML = `<option value="all">Вся команда</option>${reportTeamAnalyticsState.rows.map(row => `<option value="${escapeHtml(String(row.performer_id || ''))}">${escapeHtml(row.performer_name || 'Сотрудник')}</option>`).join('')}`;
  select.value = reportPerformerFilter;
  const previous = previousReportRange(range);
  loadReportScopedBookings({ start:previous?.start || range.start, end:reportForecastEnd(range) }, reportPerformerFilter);
  loadReportAvailability(range, reportPerformerFilter);
}

async function loadReportAvailability(range, performerId) {
  if (!reportCanViewTeam || !currentUser || !navigator.onLine) return;
  const userId = currentUser.id;
  const generation = sessionGeneration;
  const organizationId = reportOrganizationId();
  const key = reportSessionKey(organizationId, range.start, range.end, performerId);
  if (!organizationId || reportAvailabilityState.key === key && ['loading','ready'].includes(reportAvailabilityState.status)) return;
  reportAvailabilityState = { key, status:'loading', availableMinutes:null, configured:0, total:0, complete:false };
  const { data, error } = await db.rpc('get_minuta_staff_report_availability', { p_organization:organizationId, p_start:range.start, p_end:range.end, p_performer:performerId === 'all' ? null : performerId });
  if (!sessionIsCurrent(userId, generation) || reportAvailabilityState.key !== key) return;
  const configured = Number(data?.configured_performers || 0);
  const total = Number(data?.total_performers || 0);
  const complete = Number(data?.completeness_version || 0) >= 2 && data?.complete === true;
  reportAvailabilityState = error
    ? { key, status:'failed', availableMinutes:null, configured:0, total:0, complete:false }
    : { key, status:'ready', availableMinutes:Number(data?.available_minutes || 0), configured, total, complete };
  renderAnalytics();
}

async function loadReportScopedBookings(range, performerId) {
  if (!reportCanViewTeam || !currentUser || !navigator.onLine) return;
  range = reportDataQueryRange(range);
  const userId = currentUser.id;
  const generation = sessionGeneration;
  const organizationId = reportOrganizationId();
  const key = reportSessionKey(organizationId, range.start, range.end, performerId);
  if (!organizationId || reportScopedBookingsState.key === key && ['loading','ready'].includes(reportScopedBookingsState.status)) return;
  reportScopedBookingsState = { key, status:'loading', rows:[] };
  document.body.classList.add('report-scope-loading');
  const select = $('#reportPerformerFilter');
  const exportButton = $('#exportBookings');
  if (select) select.disabled = true;
  if (exportButton) exportButton.disabled = true;
  const rows = [];
  const pageSize = 1000;
  const maxRows = 100000;
  let data = null;
  let error = null;
  let rpcName = 'get_minuta_staff_report_bookings_v97';
  for (let offset = 0; offset <= maxRows; offset += pageSize) {
    let response = await db.rpc(rpcName, {
      p_organization:organizationId,
      p_start:range.start,
      p_end:range.end,
      p_performer:performerId === 'all' ? null : performerId,
      p_limit:pageSize,
      p_offset:offset
    });
    const missingRpc = candidate => candidate?.error && (candidate.error.code === 'PGRST202' || /could not find.*get_minuta_staff_report_bookings|function .* does not exist/i.test(candidate.error.message || ''));
    if (offset === 0 && missingRpc(response)) {
      rpcName = 'get_minuta_staff_report_bookings';
      response = await db.rpc(rpcName, { p_organization:organizationId, p_start:range.start, p_end:range.end, p_performer:performerId === 'all' ? null : performerId, p_limit:pageSize, p_offset:offset });
      if (missingRpc(response)) response = await db.rpc(rpcName, { p_organization:organizationId, p_start:range.start, p_end:range.end, p_performer:performerId === 'all' ? null : performerId });
    }
    if (!sessionIsCurrent(userId, generation) || reportScopedBookingsState.key !== key) return;
    ({ data, error } = response);
    if (error) break;
    rows.push(...(Array.isArray(data?.bookings) ? data.bookings : []));
    if (!data?.has_more) break;
    if (rows.length >= maxRows) { error = new Error('Слишком большой объём отчёта'); break; }
  }
  if (!sessionIsCurrent(userId, generation) || reportScopedBookingsState.key !== key) return;
  reportScopedBookingsState = error ? { key, status:'failed', rows:[] } : { key, status:'ready', rows };
  document.body.classList.remove('report-scope-loading');
  if (select) select.disabled = false;
  if (exportButton) exportButton.disabled = false;
  if (error) { renderAnalytics(); notify('Не удалось загрузить статистику сотрудника'); return; }
  renderAnalytics();
}

function renderReportTeamRows(rows) {
  const panel = $('#reportPerformers');
  const holder = $('#reportPerformersList');
  if (!panel || !holder) return;
  const allTeamSelected = reportCanViewTeam && (!reportPerformerFilter || reportPerformerFilter === 'all');
  panel.hidden = !allTeamSelected || !rows.length;
  if (!allTeamSelected) { holder.innerHTML = ''; return; }
  if (!rows.length) { holder.innerHTML = ''; return; }
  const controls = $$('[data-report-team-metric]');
  controls.forEach(button => {
    const active = button.dataset.reportTeamMetric === reportTeamMetric;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
    button.onclick = () => {
      reportTeamMetric = button.dataset.reportTeamMetric || 'revenue';
      renderReportTeamRows(reportTeamAnalyticsState.rows || []);
    };
  });
  const metricNotes = {
    revenue:'Фактически полученная оплата за состоявшиеся визиты.',
    payroll:'Сумма к выплате по настроенной схеме начисления.',
    visits:'Количество состоявшихся визитов.',
    hours:'Фактическое время состоявшихся визитов.',
    efficiency:'Полученная оплата за один фактически отработанный час.'
  };
  setReportText('#reportTeamMetricNote', metricNotes[reportTeamMetric] || metricNotes.revenue);
  const metricValue = row => {
    const visits = Math.max(0, Number(row.completed_visits) || 0);
    const minutes = Math.max(0, Number(row.worked_minutes) || 0);
    const revenue = Math.max(0, Number(row.revenue_rub) || 0);
    if (reportTeamMetric === 'payroll') return row.payroll_rub === null || row.payroll_rub === undefined ? null : Math.max(0, Number(row.payroll_rub) || 0);
    if (reportTeamMetric === 'visits') return visits;
    if (reportTeamMetric === 'hours') return minutes / 60;
    if (reportTeamMetric === 'efficiency') return minutes > 0 ? revenue / (minutes / 60) : 0;
    return revenue;
  };
  const metricLabel = (value, row) => {
    if (value === null) return 'Не настроено';
    if (reportTeamMetric === 'visits') return `${Math.round(value)} ${reportVisitWord(value)}`;
    if (reportTeamMetric === 'hours') return reportHours(Number(row.worked_minutes) || 0);
    if (reportTeamMetric === 'efficiency') return `${money(Math.round(value))}/ч`;
    return money(Math.round(value));
  };
  const rankedRows = rows.map(row => ({ row, value:metricValue(row) })).sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
  const maximum = Math.max(1, ...rankedRows.map(item => item.value || 0));
  holder.innerHTML = rankedRows.map((item, index) => {
    const row = item.row;
    const visits = Math.max(0, Number(row.completed_visits) || 0);
    const clients = Math.max(0, Number(row.unique_clients) || 0);
    const minutes = Math.max(0, Number(row.worked_minutes) || 0);
    const revenue = Math.max(0, Number(row.revenue_rub) || 0);
    const average = visits ? revenue / visits : 0;
    const width = item.value === null ? 0 : Math.max(item.value > 0 ? 3 : 0, Math.round((item.value || 0) / maximum * 100));
    return `<article class="report-performer-row${index === 0 && item.value !== null ? ' is-leader' : ''}" role="button" tabindex="0" data-report-performer="${escapeHtml(String(row.performer_id || ''))}" aria-label="Открыть статистику сотрудника ${escapeHtml(row.performer_name || 'Мастер')}"><span class="report-team-rank">${index + 1}</span><div class="report-team-person"><strong>${escapeHtml(row.performer_name || 'Мастер')}${index === 0 && item.value !== null ? '<em>Лидер</em>' : ''}</strong><small>${visits} ${reportVisitWord(visits)} · ${clients} клиентов · ${reportHours(minutes)} · ${money(Math.round(average))}/визит</small></div><span class="report-team-bar" aria-hidden="true"><i style="width:${width}%"></i></span><div class="report-performer-value"><b>${escapeHtml(metricLabel(item.value, row))}</b>${reportTeamMetric === 'payroll' && item.value === null ? '<small>Настройте начисление</small>' : ''}</div><span class="report-team-arrow" aria-hidden="true">→</span></article>`;
  }).join('');
  holder.querySelectorAll('[data-report-performer]').forEach(row => {
    const select = () => { const control = $('#reportPerformerFilter'); if (!control) return; control.value = row.dataset.reportPerformer; control.dispatchEvent(new Event('change', { bubbles:true })); window.scrollTo({ top:$('#analyticsView')?.offsetTop || 0, behavior:'smooth' }); };
    row.addEventListener('click', select);
    row.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } });
  });
}

async function loadReportTeamAnalytics(range) {
  const panel = $('#reportPerformers');
  if (!panel || !currentUser || !navigator.onLine) { if (panel) panel.hidden = true; return; }
  const userId = currentUser.id;
  const generation = sessionGeneration;
  const organizationId = reportOrganizationId();
  if (!organizationId) { panel.hidden = true; return; }
  range = reportDataQueryRange(range);
  const key = reportSessionKey(organizationId, range.start, range.end);
  if (reportTeamAnalyticsState.key === key) {
    if (reportTeamAnalyticsState.status === 'ready') { renderReportTeamRows(reportTeamAnalyticsState.rows); renderReportPerformerFilter(range); }
    return;
  }
  reportTeamAnalyticsState = { key, status:'loading', rows:[], canViewTeam:false };
  panel.hidden = true;
  let response = await db.rpc('get_minuta_team_analytics', { p_organization:organizationId, p_start:range.start, p_end:range.end });
  if (!sessionIsCurrent(userId, generation) || reportTeamAnalyticsState.key !== key) return;
  if (response.error && (response.error.code === 'PGRST202' || /could not find.*get_minuta_team_analytics|function .* does not exist/i.test(response.error.message || ''))) {
    response = await db.rpc('get_minuta_team_analytics', { p_start:range.start, p_end:range.end });
  }
  const { data, error } = response;
  if (!sessionIsCurrent(userId, generation) || reportTeamAnalyticsState.key !== key) return;
  if (error) {
    reportTeamAnalyticsState = { key, status:'failed', rows:[], canViewTeam:false };
    panel.hidden = true;
    return;
  }
  const rows = Array.isArray(data) ? data : Array.isArray(data?.performers) ? data.performers : [];
  reportCanViewTeam = Boolean(data?.can_view_team);
  reportTeamAnalyticsState = { key, status:'ready', rows, canViewTeam:reportCanViewTeam };
  renderReportTeamRows(rows);
  renderReportPerformerFilter(range);
}

function reportVisitWord(count) {
  const value = Math.abs(Number(count || 0)) % 100;
  const digit = value % 10;
  return value > 10 && value < 20 ? 'визитов' : digit === 1 ? 'визит' : digit > 1 && digit < 5 ? 'визита' : 'визитов';
}

function reportTrendMarkup(completed, range) {
  const chart = $('#reportRevenueChart');
  if (!chart) return;
  const total = completed.reduce((sum, item) => sum + Number(bookingOutcome(item).amount_rub || 0), 0);
  setReportText('#reportTrendTotal', money(total));
  if (!completed.length) {
    chart.innerHTML = '<div class="report-empty-inline">После завершённых визитов здесь появится динамика.</div>';
    return;
  }
  const start = parseLocalIsoDate(range.start);
  const end = parseLocalIsoDate(range.end);
  const totalDays = Math.max(1, Math.round((end - start) / 86400000) + 1);
  const bucketDays = totalDays <= 14 ? 1 : totalDays <= 90 ? 7 : totalDays <= 730 ? 30 : 365;
  const bucketCount = Math.ceil(totalDays / bucketDays);
  setReportText('#reportTrendTitle', `Получено ${bucketDays === 1 ? 'по дням' : bucketDays === 7 ? 'по неделям' : bucketDays === 30 ? 'по месяцам' : 'по годам'}`);
  const buckets = Array.from({ length:bucketCount }, (_, index) => {
    const from = new Date(start.getTime() + index * bucketDays * 86400000);
    const to = new Date(Math.min(end.getTime(), from.getTime() + (bucketDays - 1) * 86400000));
    return { from, to, value:0 };
  }).filter(bucket => bucket.from <= end);
  completed.forEach(item => {
    const offset = Math.max(0, Math.floor((parseLocalIsoDate(item.booking_date) - start) / 86400000));
    const bucket = buckets[Math.min(buckets.length - 1, Math.floor(offset / bucketDays))];
    if (bucket) bucket.value += Number(bookingOutcome(item).amount_rub || 0);
  });
  const maximum = Math.max(...buckets.map(item => item.value), 1);
  const bestIndex = buckets.reduce((best, bucket, index) => bucket.value > buckets[best].value ? index : best, 0);
  chart.innerHTML = buckets.map((bucket, index) => {
    const label = bucketDays === 1 ? reportDateText(localIsoDate(bucket.from)) : `${reportDateText(localIsoDate(bucket.from))}–${reportDateText(localIsoDate(bucket.to))}`;
    const height = bucket.value ? Math.max(8, Math.round(bucket.value / maximum * 100)) : 2;
    const stateClass = bucket.value === 0 ? ' is-zero' : index === bestIndex ? ' is-best' : '';
    const openDate = localIsoDate(bucket.from);
    return `<button class="report-chart-column${stateClass}" type="button" data-report-date="${openDate}" title="${escapeHtml(label)}: ${escapeHtml(money(bucket.value))}" aria-label="${escapeHtml(label)}, ${escapeHtml(money(bucket.value))}. Открыть расписание"><b>${escapeHtml(money(bucket.value))}</b><span><i style="height:${height}%"></i></span><small>${escapeHtml(label)}</small></button>`;
  }).join('');
}

function openReportBookings({ service = '', source = 'all', status = 'all', filter = 'all' } = {}) {
  if (reportDataSource === 'demo') {
    notify('Детализация демо-показателя не открывает ваши реальные записи');
    return;
  }
  bookingSearchQuery = service;
  bookingSourceFilter = source;
  bookingStatusFilter = status;
  bookingAnalyticsFilter = '';
  bookingAnalyticsScope = null;
  bookingRenderLimit = BOOKING_RENDER_PAGE_SIZE;
  const search = $('#bookingSearch');
  const statusControl = $('#bookingStatusFilter');
  if (search) search.value = bookingSearchQuery;
  if (statusControl) statusControl.value = bookingStatusFilter;
  setJournalMode('list');
  setFilter(filter);
  updateBookingQueryTools();
  setProviderView('bookings');
}

function handleReportAction(action) {
  if (action === 'quality') {
    const details = $('#reportMethodology');
    if (details) { details.open = true; details.scrollIntoView({ behavior:'smooth', block:'center' }); }
    return;
  }
  if (reportDataSource === 'demo') {
    const target = action === 'clients' ? 'clients' : action === 'schedule' ? 'team' : action === 'lost' || action === 'debt' ? 'money' : 'overview';
    setReportSubview(target);
    $('[data-provider-panel="analytics"]')?.scrollIntoView({ behavior:'smooth', block:'start' });
    notify('Демо-показатель открыт без перехода к вашим реальным данным');
    return;
  }
  if (action === 'pending') {
    bookingAnalyticsFilter = '';
    bookingAnalyticsScope = null;
    bookingStatusFilter = 'needs-result';
    const statusFilter = $('#bookingStatusFilter');
    if (statusFilter) statusFilter.value = bookingStatusFilter;
    setJournalMode('list');
    setFilter('all');
    setProviderView('bookings');
    return;
  }
  if (action === 'debt' || action === 'lost') {
    bookingAnalyticsFilter = action;
    const actionRange = reportRange();
    bookingAnalyticsScope = { start:actionRange.start, end:actionRange.end, performer:reportCanViewTeam ? reportPerformerFilter : '' };
    bookingSearchQuery = '';
    bookingSourceFilter = 'all';
    bookingStatusFilter = action === 'debt' ? 'visited' : 'all';
    const search = $('#bookingSearch');
    const statusControl = $('#bookingStatusFilter');
    if (search) search.value = '';
    if (statusControl) statusControl.value = bookingStatusFilter;
    setJournalMode('list');
    setFilter('all');
    updateBookingQueryTools();
    setProviderView('bookings');
    notify(action === 'debt' ? 'Показаны состоявшиеся визиты с неоплаченной суммой' : 'Показаны отмены и неявки выбранного периода');
    return;
  }
  if (action === 'clients') { setProviderView('clients'); return; }
  if (action === 'schedule') { setProviderView('schedule'); return; }
}

function setReportSubview(view = 'overview', { focus = false } = {}) {
  const allowed = new Set(['overview', 'money', 'clients', 'team']);
  reportSubview = allowed.has(view) ? view : 'overview';
  const panel = $('[data-provider-panel="analytics"]');
  if (panel) panel.dataset.reportTab = reportSubview;
  $$('[data-report-view]').forEach(button => {
    const active = button.dataset.reportView === reportSubview;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  if (focus) $(`[data-report-view="${reportSubview}"]`)?.focus();
}

function reportGoalsScopeKey() {
  if (reportDataSource === 'demo') return 'demo';
  const organizationId = reportOrganizationId();
  return organizationId ? `organization:${organizationId}` : `user:${currentUser?.id || 'default'}`;
}

function reportGoals() {
  const scoped = displayPreferences.analytics_goals_by_scope?.[reportGoalsScopeKey()];
  return normalizeAnalyticsGoals(scoped || displayPreferences.analytics_goals);
}

function renderReportGoalsSummary() {
  const goals = reportGoals();
  const summary = $('#settingsReportGoalsSummary');
  if (summary) summary.textContent = goals.revenue_rub
    ? `${money(goals.revenue_rub)} в месяц · загрузка ${goals.utilization_percent}%`
    : `План выручки не задан · загрузка ${goals.utilization_percent}%`;
}

function renderReportGoalsForm() {
  const goals = reportGoals();
  const fields = {
    reportGoalRevenue:goals.revenue_rub,
    reportGoalUtilization:goals.utilization_percent,
    reportGoalRepeat:goals.repeat_percent,
    reportGoalCancellation:goals.cancellation_percent
  };
  Object.entries(fields).forEach(([id, value]) => { const input = $(`#${id}`); if (input) input.value = String(value); });
  renderReportGoalsSummary();
}

function openReportGoals() {
  renderReportGoalsForm();
  const dialog = $('#reportGoalsDialog');
  if (!dialog) return;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function saveReportGoals() {
  const goals = normalizeAnalyticsGoals({
    revenue_rub:$('#reportGoalRevenue')?.value,
    utilization_percent:$('#reportGoalUtilization')?.value,
    repeat_percent:$('#reportGoalRepeat')?.value,
    cancellation_percent:$('#reportGoalCancellation')?.value
  });
  displayPreferences = normalizeDisplayPreferences({
    ...displayPreferences,
    analytics_goals_by_scope:{ ...displayPreferences.analytics_goals_by_scope, [reportGoalsScopeKey()]:goals }
  });
  displayPreferencesUpdatedAt = Math.max(Date.now(), displayPreferencesUpdatedAt + 1);
  displayPreferencesPending = true;
  persistLocalDisplayPreferences();
  queueDisplayPreferencesSync();
  renderReportGoalsSummary();
  renderAnalytics();
  const status = $('#reportGoalsStatus');
  if (status) status.textContent = reportDataSource === 'demo'
    ? 'Цели демо сохранены отдельно от целей вашей организации'
    : navigator.onLine ? 'Цели организации сохранены и синхронизируются с аккаунтом' : 'Цели организации сохранены на этом устройстве';
}

function reportRangeDays(range) {
  return Math.max(1, Math.round((parseLocalIsoDate(range.end) - parseLocalIsoDate(range.start)) / 86400000) + 1);
}

function reportForecastEnd(range) {
  const todayIso = businessTodayIso();
  const today = parseLocalIsoDate(todayIso);
  if (range.end !== todayIso) return range.end;
  if (range.period === 'month') return localIsoDate(new Date(today.getFullYear(), today.getMonth() + 1, 0));
  if (range.period === 'year') return localIsoDate(new Date(today.getFullYear(), 11, 31));
  return range.end;
}

function reportGoalForRange(range, monthlyGoal) {
  if (!monthlyGoal) return 0;
  if (range.period === 'month') return monthlyGoal;
  if (range.period === 'year') return monthlyGoal * 12;
  return Math.round(monthlyGoal * reportRangeDays(range) / 30.4375);
}

function reportBookingPool() {
  const live = reportUsesScopedBookings() && reportScopedBookingsState.status === 'ready' ? reportScopedBookingsState.rows : allBookings;
  const organizationId = reportOrganizationId();
  return [...live, ...importedBookingHistory].filter(item => !isScheduleBlock(item)
    && (!organizationId || !item.organization_id || String(item.organization_id) === String(organizationId))
    && (!reportCanViewTeam || !reportPerformerFilter || reportPerformerFilter === 'all' || String(item.performer_id || '') === reportPerformerFilter));
}

function reportForecastMetrics(range, revenue, completed, items) {
  const todayIso = businessTodayIso();
  const targetEnd = reportForecastEnd(range);
  const isForecast = targetEnd > range.end && ['month', 'year'].includes(range.period);
  if (!isForecast) return { caption:'Получено за период', forecast:revenue, low:revenue, high:revenue, confidence:'факт', note:'Фактический результат', method:'Для завершённого периода показывается фактическая полученная оплата.' };
  const historyEnd = parseLocalIsoDate(todayIso);
  historyEnd.setDate(historyEnd.getDate() - 1);
  const dailyRevenue = new Map();
  completed.forEach(item => dailyRevenue.set(item.booking_date, (dailyRevenue.get(item.booking_date) || 0) + Number(bookingOutcome(item).amount_rub || 0)));
  const weekdaySamples = Array.from({ length:7 }, () => []);
  const start = parseLocalIsoDate(range.start);
  for (let cursor = new Date(start); cursor <= historyEnd; cursor.setDate(cursor.getDate() + 1)) {
    const iso = localIsoDate(cursor);
    weekdaySamples[(cursor.getDay() + 6) % 7].push(dailyRevenue.get(iso) || 0);
  }
  const weekdayAverage = weekdaySamples.map(values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);
  let paceRemaining = 0;
  const tomorrow = parseLocalIsoDate(todayIso);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const target = parseLocalIsoDate(targetEnd);
  for (let cursor = tomorrow; cursor <= target; cursor.setDate(cursor.getDate() + 1)) paceRemaining += weekdayAverage[(cursor.getDay() + 6) % 7];
  const concluded = completed.length + items.filter(item => item.status === 'cancelled' || bookingOutcome(item).visit_status === 'no_show').length;
  const attendanceRate = concluded ? completed.length / concluded : .8;
  const completedValue = completed.reduce((sum, item) => sum + bookingCalculatedValue(item), 0);
  const collectionRate = completedValue ? Math.min(1, revenue / completedValue) : .9;
  const future = reportBookingPool().filter(item => item.booking_date > todayIso && item.booking_date <= targetEnd && item.status !== 'cancelled');
  const pipeline = future.reduce((sum, item) => sum + bookingCalculatedValue(item), 0) * attendanceRate * collectionRate;
  const remaining = Math.max(paceRemaining, pipeline);
  const sampleDays = weekdaySamples.flat().length;
  const sampleVisits = completed.length;
  const confidence = sampleDays >= 28 && sampleVisits >= 20 ? 'высокая' : sampleDays >= 14 && sampleVisits >= 8 ? 'средняя' : 'низкая';
  const spread = confidence === 'высокая' ? .1 : confidence === 'средняя' ? .18 : .3;
  const forecast = Math.round(revenue + remaining);
  const low = Math.max(revenue, Math.round(revenue + remaining * (1 - spread)));
  const high = Math.max(forecast, Math.round(revenue + remaining * (1 + spread)));
  const caption = range.period === 'year' ? 'Прогноз к концу года' : 'Прогноз к концу месяца';
  const method = `Учитываются фактическая оплата, темп по дням недели и ${future.length} будущих записей. Уверенность: ${confidence}.`;
  return { caption, forecast, low, high, confidence, note:`${money(low)}–${money(high)} · ${confidence} уверенность`, method };
}

function renderReportFunnel(items, completed) {
  const holder = $('#reportFunnel');
  if (!holder) return;
  const booked = items.length;
  const accepted = items.filter(item => item.status !== 'cancelled').length;
  const paid = completed.filter(item => Number(bookingOutcome(item).amount_rub || 0) > 0).length;
  const steps = [
    { label:'Все записи', value:booked, icon:'calendar' },
    { label:'Не отменены', value:accepted, icon:'check' },
    { label:'Состоялись', value:completed.length, icon:'users' },
    { label:'С оплатой', value:paid, icon:'check' }
  ];
  holder.innerHTML = steps.map((step, index) => {
    const width = booked ? Math.max(step.value ? 14 : 3, Math.round(step.value / booked * 100)) : 3;
    const conversion = index ? reportShare(step.value, steps[index - 1].value) : '100%';
    return `<article><div><span>${uiIcon(step.icon)}</span><strong>${escapeHtml(step.label)}</strong><b>${step.value}</b><small>${index ? `${conversion} от предыдущего шага` : 'Все записи периода'}</small></div><i style="width:${width}%"></i></article>`;
  }).join('');
}

function reportHeatmapAvailability(range, bands) {
  if (reportCanViewTeam || !scheduleRows.length || reportRangeDays(range) > 3660) return null;
  const scheduleByWeekday = new Map(scheduleRows.map(row => [Number(row.weekday), row]));
  const result = Array.from({ length:bands.length }, () => Array(7).fill(0));
  const start = parseLocalIsoDate(range.start);
  const days = reportRangeDays(range);
  for (let offset = 0; offset < days; offset += 1) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset);
    const dateIso = localIsoDate(date);
    const weekday = (date.getDay() + 6) % 7;
    const row = scheduleByWeekday.get(weekday + 1);
    if (!row || row.enabled === false) continue;
    const dayStart = minutesFromTime(row.start_time);
    const dayEnd = minutesFromTime(row.end_time);
    if (dayEnd <= dayStart) continue;
    const exceptions = daysOff.filter(item => String(item.date || item.day_off_date || '') === dateIso);
    if (exceptions.some(item => item.all_day === true || item.is_all_day === true)) continue;
    bands.forEach((band, bandIndex) => {
      let minutes = Math.max(0, Math.min(dayEnd, band.to) - Math.max(dayStart, band.from));
      if (row.break_enabled) minutes -= Math.max(0, Math.min(band.to, minutesFromTime(row.break_end_time || row.break_end), dayEnd) - Math.max(band.from, minutesFromTime(row.break_start_time || row.break_start), dayStart));
      exceptions.filter(item => item.start_time && item.end_time).forEach(item => {
        minutes -= Math.max(0, Math.min(band.to, minutesFromTime(item.end_time), dayEnd) - Math.max(band.from, minutesFromTime(item.start_time), dayStart));
      });
      result[bandIndex][weekday] += Math.max(0, minutes);
    });
  }
  return { minutes:result };
}

function renderReportHeatmap(items, range) {
  const holder = $('#reportHeatmap');
  if (!holder) return;
  const weekdays = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
  const configuredStarts = scheduleRows.filter(row => row.enabled !== false).map(row => minutesFromTime(row.start_time)).filter(Number.isFinite);
  const configuredEnds = scheduleRows.filter(row => row.enabled !== false).map(row => minutesFromTime(row.end_time)).filter(Number.isFinite);
  const bookingStarts = items.map(item => minutesFromTime(item.booking_time)).filter(Number.isFinite);
  const earliest = Math.max(0, Math.floor(Math.min(...configuredStarts, ...bookingStarts, 9 * 60) / 120) * 120);
  const latest = Math.min(1440, Math.ceil(Math.max(...configuredEnds, ...bookingStarts.map(value => value + 120), 21 * 60) / 120) * 120);
  const bands = [];
  for (let from = earliest; from < latest && bands.length < 8; from += 120) bands.push({ label:`${timeFromMinutes(from)}–${timeFromMinutes(Math.min(1439, from + 120))}`, from, to:Math.min(1440, from + 120) });
  const bookedMinutes = Array.from({ length:bands.length }, () => Array(7).fill(0));
  const counts = Array.from({ length:bands.length }, () => Array(7).fill(0));
  items.filter(item => item.status !== 'cancelled').forEach(item => {
    const date = parseLocalIsoDate(item.booking_date);
    const time = String(item.booking_time || '').slice(0, 5);
    if (!date || !/^\d{2}:\d{2}$/.test(time)) return;
    const weekday = (date.getDay() + 6) % 7;
    const visitStart = minutesFromTime(time);
    const visitEnd = Math.min(1440, visitStart + Math.max(1, Number(item.duration_minutes || item.services?.duration_minutes || 60)));
    bands.forEach((band, bandIndex) => {
      const overlap = Math.max(0, Math.min(visitEnd, band.to) - Math.max(visitStart, band.from));
      if (!overlap) return;
      bookedMinutes[bandIndex][weekday] += overlap;
      counts[bandIndex][weekday] += 1;
    });
  });
  const availability = reportHeatmapAvailability(range, bands);
  const percentages = bookedMinutes.map((row, bandIndex) => row.map((minutes, weekday) => availability?.minutes?.[bandIndex]?.[weekday] ? Math.min(100, Math.round(minutes / availability.minutes[bandIndex][weekday] * 100)) : null));
  let peak = { percent:-1, minutes:0, band:0, weekday:0 };
  bookedMinutes.forEach((row, band) => row.forEach((minutes, weekday) => {
    const percent = percentages[band][weekday];
    if ((percent ?? -1) > peak.percent || (!availability && minutes > peak.minutes)) peak = { percent:percent ?? -1, minutes, band, weekday };
  }));
  const header = `<span class="report-heatmap-corner"></span>${weekdays.map(day => `<b>${day}</b>`).join('')}`;
  const cells = bands.map((band, bandIndex) => `<strong>${band.label}</strong>${weekdays.map((weekday, weekdayIndex) => {
    const minutes = bookedMinutes[bandIndex][weekdayIndex];
    const available = availability?.minutes?.[bandIndex]?.[weekdayIndex] || 0;
    const percent = percentages[bandIndex][weekdayIndex];
    const value = percent === null ? (counts[bandIndex][weekdayIndex] || '—') : `${percent}%`;
    const intensity = percent === null ? (minutes ? 18 : 4) : Math.max(percent ? 12 : 4, percent);
    const isPeak = availability ? percent !== null && percent === peak.percent && percent > 0 : minutes === peak.minutes && minutes > 0;
    const title = percent === null
      ? `${weekday}, ${band.label}: ${counts[bandIndex][weekdayIndex]} записей; нет данных о доступном времени команды`
      : `${weekday}, ${band.label}: занято ${reportHours(minutes)} из ${reportHours(available)}, ${percent}%`;
    return `<span class="report-heatmap-cell${isPeak ? ' is-peak' : ''}" style="--heat:${intensity}%" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}"><i>${value}</i></span>`;
  }).join('')}`).join('');
  holder.innerHTML = header + cells;
  const peakText = peak.minutes ? `${weekdays[peak.weekday]}, ${bands[peak.band].label} · ${availability && peak.percent >= 0 ? `${peak.percent}% занято` : `${counts[peak.band][peak.weekday]} записей`}` : 'Пиковое время появится после записей';
  setReportText('#reportHeatmapPeak', peakText);
  holder.setAttribute('aria-label', peak.minutes ? `Пиковая загрузка: ${peakText}` : 'Записей для тепловой карты пока нет');
  const title = $('#reportHeatmapTitle');
  if (title) title.textContent = availability ? 'Загрузка по времени' : 'Спрос по времени';
}

function reportDataQualityMetrics({ items, completed, utilizationPercent }) {
  const past = items.filter(item => item.booking_date <= businessTodayIso());
  const knownOutcomes = past.filter(item => item.status === 'cancelled' || ['completed', 'no_show'].includes(bookingOutcome(item).visit_status)).length;
  const outcomeCoverage = past.length ? knownOutcomes / past.length * 100 : null;
  const identityCoverage = completed.length ? completed.filter(reportClientIdentity).length / completed.length * 100 : null;
  const sourceCoverage = items.length ? items.filter(item => reportBookingSource(item) !== 'unknown').length / items.length * 100 : null;
  const durationCoverage = completed.length ? completed.filter(item => Number(bookingOutcome(item).actual_duration_minutes || 0) > 0).length / completed.length * 100 : null;
  const scheduleCoverage = utilizationPercent === null ? null : 100;
  const available = [outcomeCoverage, identityCoverage, sourceCoverage, durationCoverage, scheduleCoverage].filter(Number.isFinite);
  const score = available.length ? Math.round(available.reduce((sum, value) => sum + value, 0) / available.length) : null;
  const warnings = [];
  if (outcomeCoverage !== null && outcomeCoverage < 80) warnings.push('не все прошедшие записи завершены');
  if (sourceCoverage !== null && sourceCoverage < 80) warnings.push('у старых записей нет источника');
  if (durationCoverage !== null && durationCoverage < 80) warnings.push('не у всех визитов указана фактическая длительность');
  if (scheduleCoverage === null) warnings.push('загрузка без полного графика');
  return { score, warnings, outcomeCoverage, identityCoverage, sourceCoverage, durationCoverage, scheduleCoverage };
}

function renderReportCommandCenter({ range, items, completed, revenue, completedValue, debt, pending, clients, sources, utilizationPercent, rows, cancelled, noShows, average }) {
  const forecast = reportForecastMetrics(range, revenue, completed, items);
  const concluded = completed.length + cancelled.length + noShows.length;
  const conversion = concluded ? Math.round(completed.length / concluded * 100) : null;
  const repeatRate = clients.uniqueClients ? Math.round(clients.returningClients / clients.uniqueClients * 100) : 0;
  const paymentRate = completedValue ? Math.min(100, Math.round(revenue / completedValue * 100)) : null;
  const goals = reportGoals();
  const visitTarget = Math.max(0, 100 - goals.cancellation_percent);
  const components = [
    { id:'visits', value:conversion, target:visitTarget, weight:.3, score:conversion === null ? null : visitTarget ? Math.min(100, Math.round(conversion / visitTarget * 100)) : 100 },
    { id:'payments', value:paymentRate, target:100, weight:.25, score:paymentRate === null ? null : paymentRate },
    { id:'clients', value:clients.uniqueClients >= 3 ? repeatRate : null, target:goals.repeat_percent, weight:.2, score:clients.uniqueClients < 3 ? null : goals.repeat_percent ? Math.min(100, Math.round(repeatRate / goals.repeat_percent * 100)) : 100 },
    { id:'load', value:utilizationPercent, target:goals.utilization_percent, weight:.25, score:utilizationPercent === null ? null : Math.min(100, Math.round(utilizationPercent / goals.utilization_percent * 100)) }
  ];
  const availableComponents = components.filter(item => item.score !== null);
  const totalWeight = availableComponents.reduce((sum, item) => sum + item.weight, 0);
  const hasHealthData = availableComponents.length >= 2 && concluded >= 3;
  const healthScore = hasHealthData ? Math.round(availableComponents.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight) : 0;
  const healthLabel = !items.length ? 'Нужны данные' : !hasHealthData ? 'Мало данных' : healthScore >= 80 ? 'Стабильное состояние' : healthScore >= 60 ? 'Хорошее состояние' : healthScore >= 40 ? 'Есть точки роста' : 'Нужно внимание';
  setReportText('#reportForecastCaption', forecast.caption);
  setReportText('#reportForecast', money(forecast.forecast));
  setReportText('#reportForecastTrend', forecast.note);
  setReportText('#reportForecastMethod', forecast.method);
  setReportText('#reportHeroRevenue', money(revenue));
  const previousRange = previousReportRange(range);
  const previousRevenue = previousRange ? reportRevenue(reportBookings(previousRange)) : 0;
  setReportText('#reportHeroRevenueTrend', previousRevenue ? `${revenue >= previousRevenue ? '+' : '−'}${Math.abs(Math.round((revenue - previousRevenue) / previousRevenue * 100))}% к прошлому периоду` : 'Фактическая оплата');
  const periodGoal = reportGoalForRange(range, goals.revenue_rub);
  const planPercent = periodGoal ? Math.round(revenue / periodGoal * 100) : 0;
  const goalEnd = parseLocalIsoDate(reportForecastEnd(range));
  const today = parseLocalIsoDate(businessTodayIso());
  const remainingGoalDays = Math.max(0, Math.round((goalEnd - today) / 86400000));
  const requiredDaily = periodGoal && remainingGoalDays ? Math.max(0, Math.round((periodGoal - revenue) / remainingGoalDays)) : 0;
  setReportText('#reportPlanCaption', range.period === 'month' ? 'План месяца' : range.period === 'year' ? 'План года' : 'План периода');
  setReportText('#reportPlanProgress', periodGoal ? `${planPercent}%` : 'Не задан');
  setReportText('#reportPlanProgressNote', periodGoal ? `${money(revenue)} из ${money(periodGoal)}${requiredDaily ? ` · нужно ${money(requiredDaily)}/день` : ''}` : 'Добавьте цель');
  setReportText('#reportHeroUtilization', utilizationPercent === null ? '—' : `${utilizationPercent}%`);
  setReportText('#reportHeroUtilizationNote', utilizationPercent === null ? 'Нужен полный график' : `Цель ${goals.utilization_percent}%`);
  setReportText('#reportVisitConversion', conversion === null ? '—' : `${conversion}%`);
  setReportText('#reportVisitConversionNote', concluded ? `${completed.length} из ${concluded}; цель ${visitTarget}%` : 'Нет известных исходов');
  setReportText('#reportPaymentRate', paymentRate === null ? '—' : `${paymentRate}%`);
  setReportText('#reportPaymentRateNote', paymentRate === null ? 'Нет стоимости услуг' : `Получено из стоимости; цель 100%`);
  setReportText('#reportRepeatRate', `${repeatRate}%`);
  setReportText('#reportRepeatRateNote', clients.uniqueClients ? `${clients.returningClients} из ${clients.uniqueClients}; цель ${goals.repeat_percent}%` : 'Появится после визитов');
  setReportText('#reportHealthUtilization', utilizationPercent === null ? '—' : `${utilizationPercent}%`);
  setReportText('#reportHealthUtilizationNote', utilizationPercent === null ? 'Нет полного графика' : `Цель ${goals.utilization_percent}%`);
  setReportText('#reportHealthScore', hasHealthData ? healthScore : '—');
  setReportText('#reportHealthLabel', healthLabel);
  const ring = $('#reportHealthRing');
  if (ring) {
    ring.style.setProperty('--report-health', `${healthScore * 3.6}deg`);
    ring.setAttribute('aria-label', hasHealthData ? `Пульс бизнеса: ${healthScore} из 100, ${healthLabel}` : 'Пульс бизнеса: недостаточно завершённых визитов');
  }
  const quality = reportDataQualityMetrics({ items, completed, utilizationPercent });
  setReportText('#reportDataQuality', quality.score === null ? '—' : `${quality.score}%`);
  setReportText('#reportDataQualityNote', quality.warnings.length ? `Ограничения: ${quality.warnings.join('; ')}.` : 'Ключевые поля заполнены, расчёт можно проверять по детализации.');
  const methodology = $('#reportMethodology');
  if (methodology) methodology.classList.toggle('has-warning', quality.warnings.length > 0);
  const leader = [...rows].sort((a, b) => b.revenue - a.revenue)[0];
  const narrative = !items.length
    ? 'После первых записей здесь появятся прогноз, конверсия и персональные рекомендации.'
    : pending.length
      ? `${pending.length} ${reportVisitWord(pending.length)} требуют завершения — после этого картина станет точнее.`
      : debt > 0
        ? `Результат выглядит устойчиво, но ${money(debt)} ещё не отмечено как полученная оплата.`
        : leader
          ? `${leader.name} сейчас лидирует по выручке. Показатели пересчитываются при каждом изменении записи.`
          : 'Показатели пересчитываются при каждом изменении записи.';
  setReportText('#reportCommandNarrative', narrative);
  const cancellationRate = concluded ? Math.round((cancelled.length + noShows.length) / concluded * 100) : 0;
  const smartActions = [];
  if (pending.length) smartActions.push({ priority:100 + pending.length, tone:'attention', icon:'clock', title:'Завершить визиты', text:`${pending.length} записей без результата`, evidence:`Картина выручки и посещаемости неполная`, impact:average ? `До ${money(Math.round(pending.length * average))} требуют проверки` : 'Уточните результат визитов', action:'pending', label:'Открыть' });
  if (debt > 0) smartActions.push({ priority:120 + debt / 1000, tone:'money', icon:'alert', title:'Проверить оплаты', text:`Долг ${money(debt)}`, evidence:`Оплачено ${paymentRate ?? 0}% стоимости услуг`, impact:'Покажем состоявшиеся визиты', action:'debt', label:'Проверить' });
  if (clients.uniqueClients >= 3 && repeatRate < goals.repeat_percent) smartActions.push({ priority:60 + goals.repeat_percent - repeatRate, tone:'growth', icon:'users', title:'Вернуть клиентов', text:`Возвращаются ${repeatRate}% при цели ${goals.repeat_percent}%`, evidence:`Выборка: ${clients.uniqueClients} клиентов`, impact:'Откроем клиентов для точечного контакта', action:'clients', label:'К клиентам' });
  if (utilizationPercent !== null && utilizationPercent < goals.utilization_percent) smartActions.push({ priority:50 + goals.utilization_percent - utilizationPercent, tone:'growth', icon:'spark', title:'Заполнить свободные часы', text:`Загрузка ${utilizationPercent}% при цели ${goals.utilization_percent}%`, evidence:`Свободно ${$('#reportFreeHours')?.textContent || '—'}`, impact:'Откроем расписание', action:'schedule', label:'К графику' });
  if (concluded >= 5 && cancellationRate > goals.cancellation_percent) smartActions.push({ priority:80 + cancellationRate - goals.cancellation_percent, tone:'attention', icon:'alert', title:'Снизить потери записей', text:`Отмены и неявки ${cancellationRate}%`, evidence:`Цель — не более ${goals.cancellation_percent}%`, impact:`Проверить ${cancelled.length + noShows.length} записей`, action:'lost', label:'Проверить' });
  if (quality.warnings.length) smartActions.push({ priority:40 + quality.warnings.length, tone:'attention', icon:'alert', title:'Повысить точность', text:quality.warnings[0], evidence:`Качество данных ${quality.score ?? 0}%`, impact:'Откроем методику расчёта', action:'quality', label:'Подробнее' });
  if (!smartActions.length && items.length) smartActions.push({ priority:0, tone:'success', icon:'check', title:'Главное под контролем', text:'Критичных отклонений не найдено', evidence:'Цели и заполненность данных проверены', impact:'Продолжайте следить за динамикой', action:'', label:'' });
  smartActions.sort((left, right) => right.priority - left.priority);
  const smartHolder = $('#reportSmartActions');
  if (smartHolder) {
    const visibleActions = smartActions.slice(0, 3);
    smartHolder.classList.remove('is-expanded');
    smartHolder.innerHTML = visibleActions.map(item => `<article class="report-smart-action is-${item.tone}"><span>${uiIcon(item.icon)}</span><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.text)}</small><i>${escapeHtml(item.evidence)}</i><b>${escapeHtml(item.impact)}</b></div>${item.action ? `<button type="button" data-report-action="${item.action}">${escapeHtml(item.label)} →</button>` : ''}</article>`).join('') + (visibleActions.length > 1 ? `<button class="report-actions-toggle" type="button" data-report-actions-toggle aria-expanded="false">Рекомендации · ${visibleActions.length}</button>` : '');
  }
  const command = $('#reportCommandCenter');
  if (command) command.classList.toggle('is-empty', !items.length);
  const onlineShare = sources.online + sources.manual + sources.unknown ? Math.round(sources.online / (sources.online + sources.manual + sources.unknown) * 100) : 0;
  command?.style.setProperty('--report-online-share', `${onlineShare}%`);
}

function renderAnalytics() {
  const renderStartedAt = performance.now();
  const holder = $('#reportServicesList');
  if (!holder) return;
  const range = reportRange();
  const analyticsPanel = $('[data-provider-panel="analytics"]');
  const loadState = $('#reportLoadState');
  const scopedStatus = reportUsesScopedBookings() ? reportScopedBookingsState.status : 'ready';
  if (analyticsPanel) analyticsPanel.setAttribute('aria-busy', String(scopedStatus === 'loading'));
  if (loadState) {
    loadState.hidden = !['loading', 'failed'].includes(scopedStatus);
    loadState.className = `report-load-state is-${scopedStatus}`;
    loadState.textContent = scopedStatus === 'loading' ? 'Обновляем статистику…' : scopedStatus === 'failed' ? 'Не удалось обновить статистику. Нули ниже не являются подтверждённым результатом — повторите загрузку.' : '';
  }
  const items = reportBookings(range);
  const completed = reportCompletedItems(items);
  const noShows = items.filter(item => item.status !== 'cancelled' && bookingOutcome(item).visit_status === 'no_show');
  const cancelled = items.filter(item => item.status === 'cancelled');
  const pending = items.filter(item => item.status !== 'cancelled' && bookingOutcome(item).visit_status === 'scheduled' && bookingIsCompleted(item));
  const upcoming = items.filter(item => item.status !== 'cancelled' && bookingOutcome(item).visit_status === 'scheduled' && !bookingIsCompleted(item));
  const revenue = reportRevenue(items);
  const completedValue = completed.reduce((sum, item) => sum + bookingCalculatedValue(item), 0);
  const debt = completed.reduce((sum, item) => sum + Math.max(0, bookingCalculatedValue(item) - Number(bookingOutcome(item).amount_rub || 0)), 0);
  const unpaid = completed.filter(item => Number(bookingOutcome(item).amount_rub || 0) < bookingCalculatedValue(item));
  const adjustment = revenue - completedValue;
  const average = completed.length ? revenue / completed.length : 0;
  const workedMinutes = completed.reduce((sum, item) => sum + Number(bookingOutcome(item).actual_duration_minutes || item.duration_minutes || item.services?.duration_minutes || 0), 0);
  const clients = reportClientMetrics(completed, range);
  const sources = reportSourceMetrics(items);
  const sourceTotal = sources.online + sources.manual + sources.unknown;
  if (analyticsPanel) analyticsPanel.dataset.reportEmpty = items.length ? 'false' : 'true';
  setReportSubview(reportSubview);
  setReportText('#reportDecisionHint', reportDataSource === 'demo' ? 'Учебные данные без перехода в журнал' : 'Нажмите показатель, чтобы открыть записи');
  const importedInPeriod = completed.filter(item => item.is_imported_history).length;
  $('#reportPeriodLabel').textContent = `${reportDateText(range.start, { day:'numeric', month:'long', year:'numeric' })} — ${reportDateText(range.end, { day:'numeric', month:'long', year:'numeric' })} · обновлено ${new Date().toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' })}`;
  setReportText('#reportImportMethod', importedInPeriod ? `${importedInPeriod} ${reportVisitWord(importedInPeriod)} из прежнего журнала. Сумма отражает стоимость записей.` : 'В выбранном периоде импортированных визитов нет.');
  updateReportFilterSummary();
  const visualPeriod = `${reportDateText(range.start, { day:'numeric', month:'short', year:'numeric' })} — ${reportDateText(range.end, { day:'numeric', month:'short', year:'numeric' })} · ${reportPerformerName()}`;
  setReportText('#reportTrendPeriod', visualPeriod);
  setReportText('#reportTeamPeriod', visualPeriod);
  $('#reportRevenue').textContent = money(revenue);
  $('#reportCompletedValue').textContent = money(completedValue);
  $('#reportDebt').textContent = money(debt);
  $('#reportCompleted').textContent = String(completed.length);
  $('#reportUnpaid').textContent = unpaid.length ? `${unpaid.length} ${reportVisitWord(unpaid.length)} с долгом` : 'Нет визитов с долгом';
  $('#reportWorkload').textContent = workedMinutes >= 60 ? `${Math.round(workedMinutes / 6) / 10} ч работы` : `${workedMinutes} мин работы`;
  $('#reportAverage').textContent = money(Math.round(average));
  $('#reportPending').textContent = String(pending.length);
  const secondaryMetrics = [
    { selector:'#reportPendingMetric', value:pending.length, clear:'Все визиты отмечены' }
  ];
  const clearMetrics = secondaryMetrics.filter(metric => metric.value === 0);
  secondaryMetrics.forEach(metric => { const node = $(metric.selector); if (node) node.hidden = metric.value === 0; });
  const zeroSummary = $('#reportZeroSummary');
  if (zeroSummary) {
    zeroSummary.hidden = !clearMetrics.length;
    zeroSummary.style.setProperty('--report-zero-span', String(clearMetrics.length));
    setReportText('#reportZeroSummaryText', clearMetrics.map(metric => metric.clear).join(' · '));
  }
  const previousRange = previousReportRange(range);
  const previousItems = previousRange ? reportBookings(previousRange) : [];
  const previousCompleted = reportCompletedItems(previousItems);
  const previousRevenue = previousRange ? reportRevenue(previousItems) : 0;
  const previousClients = previousRange ? reportClientMetrics(previousCompleted, previousRange) : { uniqueClients:0 };
  const previousSources = previousRange ? reportSourceMetrics(previousItems) : { online:0 };
  const hasPreviousData = Boolean(previousRange && previousItems.length);
  setReportTrend('#reportRevenueTrend', revenue, previousRevenue, hasPreviousData);
  const comparison = $('#reportComparison');
  if (comparison) comparison.hidden = !hasPreviousData;
  if (hasPreviousData) {
    setReportComparison('#reportComparisonRevenue', revenue, previousRevenue, value => money(value));
    setReportComparison('#reportComparisonVisits', completed.length, previousCompleted.length);
    setReportComparison('#reportComparisonClients', clients.uniqueClients, previousClients.uniqueClients);
    setReportComparison('#reportComparisonOnline', sources.online, previousSources.online);
  }
  setReportText('#reportUniqueClients', clients.uniqueClients);
  setReportText('#reportNewClients', clients.newClients);
  setReportText('#reportNewClientsShare', reportShare(clients.newClients, clients.uniqueClients));
  setReportText('#reportReturningClients', clients.returningClients);
  setReportText('#reportReturningClientsShare', reportShare(clients.returningClients, clients.uniqueClients));
  setReportText('#reportOnlineBookings', sources.online);
  setReportText('#reportOnlineShare', reportShare(sources.online, sourceTotal));
  setReportText('#reportManualBookings', sources.manual);
  setReportText('#reportManualShare', reportShare(sources.manual, sourceTotal));
  setReportText('#reportUnknownBookings', sources.unknown);
  setReportText('#reportUnknownShare', reportShare(sources.unknown, sourceTotal));
  setReportText('#reportSourceTotal', sourceTotal);
  const sourcesPanel = $('.report-sources');
  if (sourcesPanel) {
    const legacyOnly = sourceTotal > 0 && sources.unknown === sourceTotal;
    sourcesPanel.classList.toggle('is-legacy-only', legacyOnly);
    sourcesPanel.classList.toggle('is-empty', sourceTotal === 0);
    const note = sourcesPanel.querySelector('.report-source-note');
    if (note) note.textContent = sourceTotal === 0 ? 'Новые записи появятся здесь автоматически.' : legacyOnly ? 'Для старых записей источник не определён. Новые записи будут учитываться автоматически.' : sources.unknown ? `У ${sources.unknown} старых записей источник не определён.` : 'Все записи распределены по источникам.';
  }
  const sourceDonut = $('#reportSourceDonut');
  if (sourceDonut) {
    const onlineEnd = sourceTotal ? sources.online / sourceTotal * 100 : 0;
    const manualEnd = sourceTotal ? (sources.online + sources.manual) / sourceTotal * 100 : 0;
    sourceDonut.style.background = sourceTotal
      ? `conic-gradient(var(--theme-accent) 0 ${onlineEnd}%, color-mix(in srgb,var(--theme-accent) 48%,var(--theme-surface)) ${onlineEnd}% ${manualEnd}%, var(--theme-line) ${manualEnd}% 100%)`
      : 'var(--theme-line)';
    sourceDonut.setAttribute('aria-label', sourceTotal ? `Онлайн ${sources.online}, мастером ${sources.manual}, без данных ${sources.unknown}` : 'Записей за период нет');
  }
  const outcomes = [
    { key:'completed', label:'Состоялись', value:completed.length, status:'visited', filter:'all' },
    { key:'upcoming', label:'Предстоят', value:upcoming.length, status:'all', filter:'upcoming' },
    { key:'pending', label:'Ждут завершения', value:pending.length, status:'needs-result', filter:'all' },
    { key:'cancelled', label:'Отменены', value:cancelled.length, status:'cancelled', filter:'all' },
    { key:'no-show', label:'Не пришли', value:noShows.length, status:'no-show', filter:'all' }
  ];
  const outcomeTotal = outcomes.reduce((sum, item) => sum + item.value, 0);
  const outcomeBar = $('#reportOutcomeBar');
  if (outcomeBar) outcomeBar.innerHTML = outcomes.filter(item => item.value).map(item => `<i class="is-${item.key}" style="width:${item.value / outcomeTotal * 100}%"></i>`).join('');
  const outcomeList = $('#reportOutcomeList');
  if (outcomeList) outcomeList.innerHTML = outcomes.map(item => `<button type="button" data-report-outcome="${item.key}" data-report-status="${item.status}" data-report-filter="${item.filter}"><i class="report-outcome-dot is-${item.key}" aria-hidden="true"></i><span>${item.label}</span><strong>${item.value}</strong><small>${reportShare(item.value, outcomeTotal)}</small></button>`).join('');
  const utilizationPercent = renderReportUtilization(range, workedMinutes);
  renderReportRetention();
  loadReportTeamAnalytics(range);
  loadReportEvents(range);
  const reconciliation = $('#reportReconciliation');
  if (reconciliation) {
    reconciliation.hidden = adjustment === 0;
    if (adjustment !== 0) {
      const differenceText = adjustment > 0 ? `Доплаты и корректировки +${money(adjustment)}` : `Недополучено ${money(Math.abs(adjustment))}`;
      reconciliation.innerHTML = `<small>Сверка оплаты</small><strong>Услуги ${money(completedValue)} · ${differenceText} · получено ${money(revenue)}</strong>`;
      reconciliation.className = `report-reconciliation ${adjustment > 0 ? 'is-positive' : 'is-negative'}`;
    }
  }
  reportTrendMarkup(completed, range);
  const payments = new Map([['cash',0],['card',0],['transfer',0],['imported',0],['unpaid',0]]);
  completed.forEach(item => {
    const outcome = bookingOutcome(item);
    const method = payments.has(outcome.payment_method) ? outcome.payment_method : 'unpaid';
    payments.set(method, payments.get(method) + Number(outcome.amount_rub || 0));
  });
  const paymentNames = { cash:'Наличные',card:'Карта',transfer:'Перевод',imported:'Стоимость из журнала',unpaid:'Без оплаты' };
  const visiblePayments = [...payments.entries()].filter(([, amount]) => amount > 0);
  $('#reportPaymentsList').innerHTML = visiblePayments.length ? visiblePayments.map(([method, amount]) => `<article><span>${paymentNames[method]}</span><strong>${money(amount)} · ${revenue ? Math.round(amount / revenue * 100) : 0}%</strong></article>`).join('') : '<div class="report-empty-inline">Оплаты за период ещё не отмечены.</div>';
  const grouped = new Map();
  completed.forEach(item => {
    const entries = bookingSession(item).filter(entry => entry.title);
    const weightTotal = entries.reduce((sum, entry) => sum + Math.max(0, Number(entry.price_rub || 0)), 0);
    const received = Number(bookingOutcome(item).amount_rub || 0);
    entries.forEach(entry => {
      const name = serviceName(entry.title || 'Услуга');
      const key = entry.service_id ? `service:${entry.service_id}` : `title:${name.toLowerCase()}`;
      const row = grouped.get(key) || { name, visits:0, revenue:0 };
      row.visits += 1;
      row.revenue += received * (weightTotal > 0 ? Math.max(0, Number(entry.price_rub || 0)) / weightTotal : 1 / entries.length);
      grouped.set(key, row);
    });
  });
  const rows = [...grouped.values()].sort((a, b) => b[reportServiceMetric] - a[reportServiceMetric] || b.revenue - a.revenue || b.visits - a.visits);
  renderReportFunnel(items, completed);
  renderReportHeatmap(items, range);
  renderReportCommandCenter({ range, items, completed, revenue, completedValue, debt, pending, clients, sources, utilizationPercent, rows, cancelled, noShows, average });
  const maximumServiceValue = Math.max(...rows.map(row => row[reportServiceMetric]), 1);
  const visibleServiceRows = reportServicesExpanded ? rows : rows.slice(0, 5);
  $$('[data-report-service-metric]').forEach(button => {
    const active = button.dataset.reportServiceMetric === reportServiceMetric;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  holder.innerHTML = rows.length ? visibleServiceRows.map(row => {
    const revenueShare = revenue ? Math.round(row.revenue / revenue * 100) : 0;
    const primaryValue = reportServiceMetric === 'visits' ? `${row.visits} ${reportVisitWord(row.visits)}` : money(Math.round(row.revenue));
    return `<button class="report-service-row" type="button" data-report-service="${escapeHtml(row.name)}"><div><strong>${escapeHtml(row.name)}</strong><small>${row.visits} ${reportVisitWord(row.visits)} · ${revenueShare}% дохода</small><span><i style="width:${Math.max(2, Math.round(row[reportServiceMetric] / maximumServiceValue * 100))}%"></i></span></div><b>${primaryValue}</b></button>`;
  }).join('') : '<div class="provider-empty compact-empty"><strong>Пока нет отмеченных визитов</strong><small>После приёма откройте запись и укажите результат и оплату.</small></div>';
  const servicesExpand = $('#reportServicesExpand');
  if (servicesExpand) {
    servicesExpand.hidden = rows.length <= 5;
    servicesExpand.textContent = reportServicesExpanded ? 'Показать топ-5' : `Показать все · ${rows.length}`;
  }
  const decisionInsight = $('#reportDecisionInsight');
  if (decisionInsight) {
    const details = [];
    const revenueLeader = [...rows].sort((a, b) => b.revenue - a.revenue)[0];
    if (revenueLeader) details.push(`<strong>${escapeHtml(revenueLeader.name)}</strong> даёт больше всего выручки — ${money(Math.round(revenueLeader.revenue))}.`);
    if (sourceTotal) details.push(`Онлайн создано <strong>${reportShare(sources.online, sourceTotal)}</strong> записей.`);
    const attention = [
      { value:pending.length, text:'ждут завершения' },
      { value:cancelled.length, text:'отменены' },
      { value:noShows.length, text:'клиенты не пришли' }
    ].sort((a, b) => b.value - a.value)[0];
    if (attention?.value) details.push(`<strong>${attention.value}</strong> ${attention.text}.`);
    else if (items.length) details.push('Проблемных записей за период нет.');
    decisionInsight.hidden = !details.length;
    decisionInsight.innerHTML = details.join(' ');
  }
  const insight = $('#reportInsight');
  if (insight) {
    const messages = [];
    if (pending.length) messages.push(`${pending.length} ${reportVisitWord(pending.length)} требуют завершения.`);
    if (debt > 0) messages.push(`Долг клиентов — ${money(debt)}.`);
    if (!completed.length && !pending.length) messages.push('За выбранный период нет состоявшихся визитов.');
    if (completed.length) {
      if (hasPreviousData && previousRevenue > 0) {
        const revenueDifference = Math.round((revenue - previousRevenue) / previousRevenue * 100);
        messages.push(revenueDifference === 0 ? 'Оплачено столько же, сколько в прошлом периоде.' : `Оплачено ${revenueDifference > 0 ? 'выросло' : 'снизилось'} на ${Math.abs(revenueDifference)}% к прошлому периоду.`);
      }
    }
    if (!messages.length) messages.push('Всё в порядке, важных изменений за период нет.');
    const pendingAction = !completed.length && pending.length
      ? `<button class="primary report-pending-action" type="button" data-open-pending-bookings>Завершить ${pending.length} ${reportVisitWord(pending.length)}</button>`
      : '';
    insight.innerHTML = `<small>Главное за период</small><ul>${messages.map(message => `<li>${escapeHtml(message)}</li>`).join('')}</ul>${pendingAction}`;
  }
  const renderDuration = providerPerformance.measure('analytics_render', renderStartedAt, { rows:items.length, period:range.period, source:reportDataSource });
  if (renderDuration > 250) providerPerformance.record('analytics_slow_render', renderDuration, { rows:items.length, period:range.period });
}

let reportEventState = { key:'', rows:[], status:'idle' };
function reportEventTitle(event) {
  const labels={booking_created_online:'Новая онлайн-запись',booking_created_manual:'Запись создана мастером',booking_created_admin:'Запись создана администратором',booking_rescheduled:'Запись перенесена',booking_cancelled:'Запись отменена',booking_restored:'Запись восстановлена',service_changed:'Услуга изменена',performer_changed:'Мастер изменён',duration_changed:'Длительность изменена',visit_completed:'Визит отмечен как состоявшийся',visit_no_show:'Клиент не пришёл',visit_reopened:'Результат визита отменён',payment_received:'Получена оплата',payment_adjusted:'Оплата скорректирована',payment_method_changed:'Способ оплаты изменён',booking_updated:'Запись изменена'};
  return `${labels[event.event_type]||'Запись изменена'} · ${event.client_name||'Клиент'} · ${event.service_name||'Услуга'}`;
}
function reportEventEffect(event) {
  const parts=[],add=(value,label)=>{const amount=Number(value||0);if(amount)parts.push(`${amount>0?'+':'−'}${money(Math.abs(amount))} ${label}`);};
  add(event.delta_planned_rub,'к плану');add(event.delta_completed_rub,'оказано');add(event.delta_received_rub,'получено');const minutes=Number(event.delta_duration_minutes||0);if(minutes)parts.push(`${minutes>0?'+':'−'}${Math.abs(minutes)} мин`);return parts.join(' · ')||'Финансовые показатели не изменились';
}
function renderReportEvents(rows) {
  if (reportCanViewTeam && reportPerformerFilter && reportPerformerFilter !== 'all') rows = rows.filter(event => String(event.performer_id || '') === reportPerformerFilter);
  const panel=$('#reportLastChange'),list=$('#reportEventList');if(!panel||!list)return;panel.hidden=!rows.length;if(!rows.length){list.innerHTML='';return;}
  const latest=rows[0],date=new Date(latest.occurred_at);$('#reportLastChangeTime').textContent=date.toLocaleString('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});$('#reportLastChangeTime').dateTime=latest.occurred_at;$('#reportLastChangeTitle').textContent=reportEventTitle(latest);$('#reportLastChangeEffect').textContent=reportEventEffect(latest);$('#reportLastChangeActor').textContent=`Изменил: ${latest.actor_name||'Система'} · синхронизировано`;
  list.innerHTML=rows.map(event=>`<article><time>${new Date(event.occurred_at).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</time><div><strong>${escapeHtml(reportEventTitle(event))}</strong><span>${escapeHtml(reportEventEffect(event))}</span><small>${escapeHtml(event.actor_name||'Система')}</small></div></article>`).join('');
}
async function loadReportEvents(range) {
  const userId=currentUser?.id||'',generation=sessionGeneration,organizationId=reportOrganizationId(),key=reportSessionKey(organizationId,range.start,range.end);
  if(!organizationId||!currentUser||!navigator.onLine){renderReportEvents(reportEventState.key===key?reportEventState.rows:[]);return;}if(reportEventState.key===key&&reportEventState.status==='ready'){renderReportEvents(reportEventState.rows);return;}
  reportEventState={key,rows:[],status:'loading'};
  const rows=[];let error=null;const pageSize=500,maxRows=100000;
  for(let offset=0;offset<=maxRows;offset+=pageSize){
    let response=await db.rpc('get_minuta_booking_events_v97',{p_organization:organizationId,p_start:range.start,p_end:range.end,p_limit:pageSize,p_offset:offset});
    if(offset===0&&response.error&&(response.error.code==='PGRST202'||/could not find.*get_minuta_booking_events|function .* does not exist/i.test(response.error.message||''))) response=await db.rpc('get_minuta_booking_events',{p_organization:organizationId,p_start:range.start,p_end:range.end,p_limit:100});
    if(!sessionIsCurrent(userId,generation)||reportEventState.key!==key)return;
    const data=response.data;error=response.error;if(error)break;rows.push(...(Array.isArray(data?.events)?data.events:[]));if(!data?.has_more)break;if(rows.length>=maxRows){error=new Error('Слишком большой объём журнала');break;}
  }
  if(!sessionIsCurrent(userId,generation)||reportEventState.key!==key)return;reportEventState=error?{key,rows:[],status:'failed'}:{key,rows,status:'ready'};renderReportEvents(reportEventState.rows.slice(0,100));
}

function reportXmlText(value) {
  return String(value ?? '').replace(/\r?\n/g, ' ').trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function reportColumnName(index) {
  let value = index + 1;
  let name = '';
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}

function reportCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function reportZip(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const write16 = (view, position, value) => view.setUint16(position, value, true);
  const write32 = (view, position, value) => view.setUint32(position, value >>> 0, true);
  Object.entries(files).forEach(([name, contents]) => {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(contents);
    const crc = reportCrc32(data);
    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    write32(localView, 0, 0x04034b50);
    write16(localView, 4, 20);
    write16(localView, 6, 0x0800);
    write16(localView, 8, 0);
    write32(localView, 14, crc);
    write32(localView, 18, data.length);
    write32(localView, 22, data.length);
    write16(localView, 26, nameBytes.length);
    local.set(nameBytes, 30);
    localParts.push(local, data);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    write32(centralView, 0, 0x02014b50);
    write16(centralView, 4, 20);
    write16(centralView, 6, 20);
    write16(centralView, 8, 0x0800);
    write16(centralView, 10, 0);
    write32(centralView, 16, crc);
    write32(centralView, 20, data.length);
    write32(centralView, 24, data.length);
    write16(centralView, 28, nameBytes.length);
    write32(centralView, 42, offset);
    central.set(nameBytes, 46);
    centralParts.push(central);
    offset += local.length + data.length;
  });
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  write32(endView, 0, 0x06054b50);
  write16(endView, 8, centralParts.length);
  write16(endView, 10, centralParts.length);
  write32(endView, 12, centralSize);
  write32(endView, 16, offset);
  return new Blob([...localParts, ...centralParts, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function reportWorkbook(rows) {
  const sheetRows = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => {
      const reference = `${reportColumnName(columnIndex)}${rowIndex + 1}`;
      if (rowIndex > 0 && columnIndex >= 8 && Number.isFinite(Number(value))) return `<c r="${reference}" s="2"><v>${Number(value)}</v></c>`;
      return `<c r="${reference}" t="inlineStr"${rowIndex === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${reportXmlText(value)}</t></is></c>`;
    }).join('');
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join('');
  const lastRow = Math.max(1, rows.length);
  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="13" customWidth="1"/><col min="2" max="2" width="10" customWidth="1"/><col min="3" max="3" width="24" customWidth="1"/><col min="4" max="4" width="19" customWidth="1"/><col min="5" max="5" width="38" customWidth="1"/><col min="6" max="8" width="20" customWidth="1"/><col min="9" max="10" width="18" customWidth="1"/></cols><sheetData>${sheetRows}</sheetData><autoFilter ref="A1:J${lastRow}"/></worksheet>`;
  return reportZip({
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Записи" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'xl/styles.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF9A6A2E"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Обычный" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
    'xl/worksheets/sheet1.xml': worksheet
  });
}

function reportExportCell(value, style = 5) { return { value, style }; }
function reportExportDate(value) { return value ? new Intl.DateTimeFormat('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric' }).format(parseLocalIsoDate(value)) : ''; }
function reportExportPhone(value, privacy) {
  if (privacy === 'none') return '';
  const digits = normalizePhone(value);
  if (!digits) return String(value || '');
  const local = digits.startsWith('7') && digits.length === 11 ? digits.slice(1) : digits;
  if (privacy === 'masked') return `+7 *** ***-${local.slice(-4,-2)}-${local.slice(-2)}`;
  return local.length === 10 ? `+7 (${local.slice(0,3)}) ${local.slice(3,6)}-${local.slice(6,8)}-${local.slice(8)}` : `+${digits}`;
}
function reportExportDuration(item) {
  const outcome = bookingOutcome(item);
  const planned = Math.max(0, Number(item.duration_minutes) || bookingSessionDuration(bookingSession(item)) || 0);
  return outcome.visit_status === 'completed' && Number(outcome.actual_duration_minutes) > 0 ? Number(outcome.actual_duration_minutes) : planned;
}
function reportExportValue(item) {
  const outcome = bookingOutcome(item);
  if (isPerMinuteBooking(item)) return Math.max(0, Math.round(Number(outcome.calculated_amount_rub) || bookingMinuteRate(item) * reportExportDuration(item)));
  return Math.max(0, Math.round(bookingSessionTotal(item)));
}
function reportExportEnd(item, duration) {
  const [hours, minutes] = String(item.booking_time || '00:00').slice(0,5).split(':').map(Number);
  const total = Math.max(0, hours * 60 + minutes + duration);
  return `${String(Math.floor(total / 60) % 24).padStart(2,'0')}:${String(total % 60).padStart(2,'0')}`;
}
function reportExportSource(item) { return item.booking_source === 'client_online' ? 'Онлайн' : item.booking_source === 'provider_manual' ? 'Мастер' : item.booking_source === 'admin_manual' ? 'Администратор' : 'Не определено'; }
function reportExportVisit(item) {
  const status = bookingOutcome(item).visit_status;
  return status === 'completed' ? 'Состоялся' : status === 'no_show' ? 'Не пришёл' : item.status === 'cancelled' ? 'Отменён' : 'Запланирован';
}
function reportExportPerformers() { return new Map((reportTeamAnalyticsState.rows || []).map(row => [String(row.performer_id || ''), row.performer_name || 'Мастер'])); }
function reportExportMaster(item, performers) { return performers.get(String(item.performer_id || '')) || 'Мастер'; }
function reportExportCreator(item, performers) {
  if (item.booking_source === 'client_online') return 'Клиент';
  if (item.created_by_user_id && performers.has(String(item.created_by_user_id))) return performers.get(String(item.created_by_user_id));
  return item.booking_source === 'provider_manual' ? 'Мастер' : item.booking_source === 'admin_manual' ? 'Администратор' : 'Не определено';
}
function reportExportData(privacy = 'masked') {
  const range = reportRange();
  const items = reportBookings(range).filter(item => !isScheduleBlock(item));
  const completed = reportCompletedItems(items);
  const revenue = reportRevenue(completed);
  const completedValue = completed.reduce((sum,item) => sum + reportExportValue(item),0);
  const debt = completed.reduce((sum,item) => sum + Math.max(0,reportExportValue(item)-Number(bookingOutcome(item).amount_rub || 0)),0);
  const workedMinutes = completed.reduce((sum,item) => sum + reportExportDuration(item),0);
  const average = completed.length ? Math.round(revenue/completed.length) : 0;
  const clients = reportClientMetrics(completed,range);
  const sources = reportSourceMetrics(items);
  const performers = reportExportPerformers();
  const headers = ['Дата','Начало','Окончание','Клиент','Телефон','Услуга','Мастер','Длительность, мин','Ставка, ₽/мин','Стоимость, ₽','Получено, ₽','Долг, ₽','Оплата','Результат визита','Источник','Кто создал','Комментарий'];
  const rows = items.map(item => {
    const outcome = bookingOutcome(item), duration = reportExportDuration(item), value = reportExportValue(item);
    return [reportExportDate(item.booking_date),String(item.booking_time || '').slice(0,5),reportExportEnd(item,duration),item.client_name || 'Без имени',reportExportPhone(item.client_phone,privacy),bookingSession(item).map(entry => serviceName(entry.title)).join(' + '),reportExportMaster(item,performers),duration,isPerMinuteBooking(item) ? bookingMinuteRate(item) : 0,value,Number(outcome.amount_rub || 0),outcome.visit_status === 'completed' ? Math.max(0,value-Number(outcome.amount_rub || 0)) : 0,paymentMethodLabel(outcome.payment_method,outcome.completion_source),reportExportVisit(item),reportExportSource(item),reportExportCreator(item,performers),bookingDisplayNote(item)];
  });
  let team = (reportTeamAnalyticsState.rows || []).filter(row => !reportCanViewTeam || reportPerformerFilter === 'all' || String(row.performer_id || '') === reportPerformerFilter).map(row => [row.performer_name || 'Мастер',Number(row.completed_visits || 0),Number(row.unique_clients || 0),Math.round(Number(row.worked_minutes || 0)),Math.round(Number(row.revenue_rub || 0)),Number(row.completed_visits || 0) ? Math.round(Number(row.revenue_rub || 0)/Number(row.completed_visits)) : 0,row.payroll_rub === null || row.payroll_rub === undefined ? 'Не рассчитано' : Math.round(Number(row.payroll_rub || 0))]);
  if (!team.length) {
    const grouped = new Map();
    completed.forEach(item => { const key = String(item.performer_id || 'master'), row = grouped.get(key) || { name:reportExportMaster(item,performers),visits:0,clients:new Set(),minutes:0,revenue:0 }; row.visits += 1; row.clients.add(reportClientIdentity(item)); row.minutes += reportExportDuration(item); row.revenue += Number(bookingOutcome(item).amount_rub || 0); grouped.set(key,row); });
    team = [...grouped.values()].map(row => [row.name,row.visits,[...row.clients].filter(Boolean).length,row.minutes,row.revenue,row.visits ? Math.round(row.revenue/row.visits) : 0,'Не рассчитано']);
  }
  const periodKeys = new Set(completed.map(reportClientIdentity).filter(Boolean));
  const groups = new Map();
  const clientHistorySource = reportUsesScopedBookings() && reportScopedBookingsState.status === 'ready' ? reportScopedBookingsState.rows : allBookings;
  reportCompletedItems(clientHistorySource.filter(item => !isScheduleBlock(item))).forEach(item => {
    const key = reportClientIdentity(item); if (!key || !periodKeys.has(key)) return;
    const row = groups.get(key) || { name:item.client_name || 'Без имени',phone:item.client_phone || '',visits:0,revenue:0,first:item.booking_date,last:item.booking_date };
    row.visits += 1; row.revenue += Number(bookingOutcome(item).amount_rub || 0); if (item.booking_date < row.first) row.first=item.booking_date; if (item.booking_date > row.last) row.last=item.booking_date; groups.set(key,row);
  });
  const clientRows = [...groups.values()].sort((a,b) => b.revenue-a.revenue).map(row => { const days=Math.max(0,Math.round((parseLocalIsoDate(range.end)-parseLocalIsoDate(row.last))/86400000)); return [row.name,reportExportPhone(row.phone,privacy),reportExportDate(row.first),reportExportDate(row.last),row.visits,row.revenue,row.visits?Math.round(row.revenue/row.visits):0,days,days>=60?'Давно не приходил':row.first>=range.start?'Новый':row.visits>=2?'Постоянный':'Разовый']; });
  return { range,items,completed,revenue,completedValue,debt,workedMinutes,average,clients,sources,headers,rows,team,clientRows,events:reportEventState.rows||[] };
}
function reportExportSheet(rows, options) {
  const body = rows.map((row,rowIndex) => `<row r="${rowIndex+1}"${options.heights?.[rowIndex+1] ? ` ht="${options.heights[rowIndex+1]}" customHeight="1"` : ''}>${row.map((raw,columnIndex) => { if (raw === '' || raw === null || raw === undefined) return ''; const cell = raw && typeof raw === 'object' && 'value' in raw ? raw : reportExportCell(raw); const ref=`${reportColumnName(columnIndex)}${rowIndex+1}`; return typeof cell.value === 'number' && Number.isFinite(cell.value) ? `<c r="${ref}" s="${cell.style}"><v>${cell.value}</v></c>` : `<c r="${ref}" t="inlineStr" s="${cell.style}"><is><t xml:space="preserve">${reportXmlText(cell.value)}</t></is></c>`; }).join('')}</row>`).join('');
  const columns = options.widths.map((width,index) => `<col min="${index+1}" max="${index+1}" width="${width}" customWidth="1"/>`).join('');
  const merges = (options.merges || []).map(ref => `<mergeCell ref="${ref}"/>`).join('');
  const freeze = options.freeze || 0;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView showGridLines="0" zoomScale="95" zoomScaleNormal="95" workbookViewId="0">${freeze?`<pane ySplit="${freeze}" topLeftCell="A${freeze+1}" activePane="bottomLeft" state="frozen"/>`:''}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${columns}</cols><sheetData>${body}</sheetData>${options.filter?`<autoFilter ref="${options.filter}"/>`:''}${merges?`<mergeCells count="${options.merges.length}">${merges}</mergeCells>`:''}<pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
}
function reportProfessionalWorkbook(sheets) {
  const overrides=sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  const sheetList=sheets.map((sheet,i)=>`<sheet name="${reportXmlText(sheet.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('');
  const rels=sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('');
  const files={
    '[Content_Types].xml':`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    '_rels/.rels':'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml':`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${sheetList}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels':`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}<Relationship Id="rId${sheets.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml':'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="# ##0 &quot;₽&quot;"/></numFmts><fonts count="6"><font><sz val="11"/><color rgb="FF332923"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="18"/><name val="Aptos Display"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FFA9664C"/><sz val="11"/><name val="Aptos"/></font><font><color rgb="FF78695F"/><sz val="10"/><name val="Aptos"/></font><font><b/><color rgb="FF332923"/><sz val="11"/><name val="Aptos"/></font></fonts><fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFA9664C"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF2E6DD"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFDFA"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFEADFD4"/></left><right style="thin"><color rgb="FFEADFD4"/></right><top style="thin"><color rgb="FFEADFD4"/></top><bottom style="thin"><color rgb="FFEADFD4"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="11"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="4" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="3" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="5" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf><xf numFmtId="164" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"/><xf numFmtId="0" fontId="4" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="0" fontId="5" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="164" fontId="5" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/></cellXfs><cellStyles count="1"><cellStyle name="Обычный" xfId="0" builtinId="0"/></cellStyles></styleSheet>'
  };
  sheets.forEach((sheet,index)=>{files[`xl/worksheets/sheet${index+1}.xml`]=reportExportSheet(sheet.rows,sheet.options);});
  return reportZip(files);
}
function reportExportSheets(data) {
  const period=`${reportExportDate(data.range.start)} — ${reportExportDate(data.range.end)}`, totalSources=data.sources.online+data.sources.manual+data.sources.unknown;
  const cancelled=data.items.filter(item=>item.status==='cancelled').length, noShow=data.items.filter(item=>bookingOutcome(item).visit_status==='no_show').length;
  const summary=[[reportExportCell('ОТЧЁТ «МИНУТА — ОНЛАЙН-ЗАПИСЬ»',1)],[reportExportCell(`Период: ${period} · сформирован ${new Date().toLocaleString('ru-RU')}`,2)],[],[reportExportCell('ФИНАНСЫ',3)],[reportExportCell('Получено',5),reportExportCell(data.revenue,10),'','',reportExportCell('Оказано услуг на',5),reportExportCell(data.completedValue,10)],[reportExportCell('Долг',5),reportExportCell(data.debt,10),'','',reportExportCell('Средний чек',5),reportExportCell(data.average,10)],[],[reportExportCell('ВИЗИТЫ И КЛИЕНТЫ',3)],[reportExportCell('Состоялось',5),reportExportCell(data.completed.length,6),'','',reportExportCell('Уникальных клиентов',5),reportExportCell(data.clients.uniqueClients,6)],[reportExportCell('Отменено',5),reportExportCell(cancelled,6),'','',reportExportCell('Новых клиентов',5),reportExportCell(data.clients.newClients,6)],[reportExportCell('Не пришли',5),reportExportCell(noShow,6),'','',reportExportCell('Вернувшихся клиентов',5),reportExportCell(data.clients.returningClients,6)],[reportExportCell('Отработано',5),reportExportCell(String(reportHours(data.workedMinutes)).replace('.',','),6)],[],[reportExportCell('ИСТОЧНИК ВСЕХ ЗАПИСЕЙ',3)],[reportExportCell('Онлайн',5),reportExportCell(data.sources.online,6),reportExportCell(reportShare(data.sources.online,totalSources),8),'',reportExportCell('Создано вручную',5),reportExportCell(data.sources.manual,6),reportExportCell(reportShare(data.sources.manual,totalSources),8)],[reportExportCell('Не определено',5),reportExportCell(data.sources.unknown,6),reportExportCell(reportShare(data.sources.unknown,totalSources),8)],[],[reportExportCell('КОНТРОЛЬ',3)],[reportExportCell('Сверка денег',5),reportExportCell(`${data.completedValue.toLocaleString('ru-RU')} ₽ оказано → ${data.revenue.toLocaleString('ru-RU')} ₽ получено`,9)],[reportExportCell('Правило',5),reportExportCell('Получено учитывает только отмеченные оплаты. Поминутная услуга: ставка за минуту × длительность.',9)]];
  const detail=[[reportExportCell('ДЕТАЛЬНЫЙ РЕЕСТР ЗАПИСЕЙ',1)],[reportExportCell(`Период: ${period}`,2)],[],data.headers.map(value=>reportExportCell(value,4)),...data.rows.map(row=>row.map((value,index)=>reportExportCell(value,index>=8&&index<=11?7:index===7?6:5)))];
  const teamHeaders=['Мастер','Визиты','Клиенты','Отработано, мин','Выручка, ₽','Средняя оплата, ₽','Заработок сотрудника, ₽'];
  const team=[[reportExportCell('РЕЗУЛЬТАТЫ КОМАНДЫ',1)],[reportExportCell(`Период: ${period}`,2)],[],teamHeaders.map(value=>reportExportCell(value,4)),...data.team.map(row=>row.map((value,index)=>reportExportCell(value,index>=4&&typeof value==='number'?7:index>0?6:5)))];
  const clientHeaders=['Клиент','Телефон','Первый визит','Последний визит','Визиты','Получено, ₽','Средний чек, ₽','Дней без визита','Статус'];
  const clients=[[reportExportCell('КЛИЕНТЫ ЗА ПЕРИОД',1)],[reportExportCell(`Период: ${period}`,2)],[],clientHeaders.map(value=>reportExportCell(value,4)),...data.clientRows.map(row=>row.map((value,index)=>reportExportCell(value,index===5||index===6?7:index===4||index===7?6:5)))];
  const historyHeaders=['Дата и время','Событие','Клиент','Услуга','Мастер','Кто изменил','План, ₽','Оказано, ₽','Получено, ₽','Минуты'];
  const historyEvents=data.events.filter(event=>!reportCanViewTeam||reportPerformerFilter==='all'||String(event.performer_id||'')===reportPerformerFilter);
  const history=[[reportExportCell('ИСТОРИЯ ИЗМЕНЕНИЙ',1)],[reportExportCell(`Период: ${period}`,2)],[],historyHeaders.map(value=>reportExportCell(value,4)),...historyEvents.map(event=>[new Date(event.occurred_at).toLocaleString('ru-RU'),reportEventTitle(event),event.client_name||'Клиент',event.service_name||'Услуга',event.performer_name||'Мастер',event.actor_name||'Система',Number(event.delta_planned_rub||0),Number(event.delta_completed_rub||0),Number(event.delta_received_rub||0),Number(event.delta_duration_minutes||0)].map((value,index)=>reportExportCell(value,index>=6&&index<=8?7:index===9?6:5)))];
  return [{name:'Сводка',rows:summary,options:{widths:[30,28,9,9,32,28,10,10],merges:['A1:H1','A2:H2','A4:H4','A8:H8','A14:H14','A18:H18','B19:H19','B20:H20'],heights:{1:34,2:24,20:34},freeze:2}},{name:'Записи',rows:detail,options:{widths:[13,10,11,24,20,38,22,16,16,17,17,15,18,19,17,22,30],merges:['A1:Q1','A2:Q2'],heights:{1:34,2:24,4:32},freeze:4,filter:`A4:Q${Math.max(4,detail.length)}`}},{name:'Мастера',rows:team,options:{widths:[28,14,14,20,20,20,20],merges:['A1:G1','A2:G2'],heights:{1:34,2:24,4:32},freeze:4,filter:`A4:G${Math.max(4,team.length)}`}},{name:'Клиенты',rows:clients,options:{widths:[28,21,16,16,14,20,20,19,22],merges:['A1:I1','A2:I2'],heights:{1:34,2:24,4:32},freeze:4,filter:`A4:I${Math.max(4,clients.length)}`}},{name:'История изменений',rows:history,options:{widths:[22,38,24,34,24,24,16,16,16,14],merges:['A1:J1','A2:J2'],heights:{1:34,2:24,4:32},freeze:4,filter:`A4:J${Math.max(4,history.length)}`}}];
}
function reportExportFilename(range,extension){return `Отчёт_Минута_${reportExportDate(range.start).replaceAll('.','-')}_${reportExportDate(range.end).replaceAll('.','-')}.${extension}`;}
function reportExportDownload(blob,filename){const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=filename;link.hidden=true;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);}
function exportBookingsXlsx(privacy='masked'){const data=reportExportData(privacy);reportExportDownload(reportProfessionalWorkbook(reportExportSheets(data)),reportExportFilename(data.range,'xlsx'));notify('Готовый отчёт Excel скачан');}
function exportBookingsCsv(privacy='masked'){const data=reportExportData(privacy),quote=value=>`"${String(value??'').replaceAll('"','""')}"`,csv=[data.headers,...data.rows].map(row=>row.map(quote).join(';')).join('\r\n');reportExportDownload(new Blob([`\ufeff${csv}`],{type:'text/csv;charset=utf-8'}),reportExportFilename(data.range,'csv'));notify('Таблица CSV скачана');}
function reportPdfText(ctx,text,x,y,maxWidth){let value=String(text??'');if(ctx.measureText(value).width<=maxWidth){ctx.fillText(value,x,y);return;}while(value.length&&ctx.measureText(`${value}…`).width>maxWidth)value=value.slice(0,-1);ctx.fillText(`${value}…`,x,y);}
function reportPdfPage(title,subtitle){const canvas=document.createElement('canvas');canvas.width=1600;canvas.height=1131;const ctx=canvas.getContext('2d');ctx.fillStyle='#f6f1ea';ctx.fillRect(0,0,1600,1131);ctx.fillStyle='#a9664c';ctx.fillRect(55,45,1490,105);ctx.fillStyle='#fff';ctx.font='700 34px Arial';ctx.fillText(title,85,92);ctx.font='20px Arial';ctx.fillText(subtitle,85,128);return {canvas,ctx};}
function reportPdfImageBytes(canvas){const base64=canvas.toDataURL('image/jpeg',.92).split(',')[1],binary=atob(base64),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i+=1)bytes[i]=binary.charCodeAt(i);return bytes;}
function reportPdfBlob(images){const encoder=new TextEncoder(),objects=[],pageIds=images.map((_,i)=>3+i*3);objects[0]=encoder.encode('<< /Type /Catalog /Pages 2 0 R >>');objects[1]=encoder.encode(`<< /Type /Pages /Kids [${pageIds.map(id=>`${id} 0 R`).join(' ')}] /Count ${images.length} >>`);images.forEach((image,index)=>{const pageId=pageIds[index],contentId=pageId+1,imageId=pageId+2,content=`q 842 0 0 595 0 0 cm /Im${index+1} Do Q`;objects[pageId-1]=encoder.encode(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /XObject << /Im${index+1} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`);objects[contentId-1]=encoder.encode(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);const head=encoder.encode(`<< /Type /XObject /Subtype /Image /Width 1600 /Height 1131 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`),tail=encoder.encode('\nendstream');objects[imageId-1]=new Blob([head,image,tail]);});const chunks=[encoder.encode('%PDF-1.4\n%PDF\n')],offsets=[0];let offset=chunks[0].length;objects.forEach((object,index)=>{offsets[index+1]=offset;const head=encoder.encode(`${index+1} 0 obj\n`),tail=encoder.encode('\nendobj\n');chunks.push(head,object,tail);offset+=head.length+(object.size??object.length)+tail.length;});const xref=offset;let table=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;for(let i=1;i<=objects.length;i+=1)table+=`${String(offsets[i]).padStart(10,'0')} 00000 n \n`;chunks.push(encoder.encode(`${table}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`));return new Blob(chunks,{type:'application/pdf'});}
function exportBookingsPdf(privacy='masked'){
  const data=reportExportData(privacy),period=`${reportExportDate(data.range.start)} — ${reportExportDate(data.range.end)}`,images=[];
  let page=reportPdfPage('Отчёт «Минута»',`Период: ${period}`),ctx=page.ctx;const cards=[['Получено',money(data.revenue)],['Оказано на',money(data.completedValue)],['Визиты',data.completed.length],['Клиенты',data.clients.uniqueClients]];cards.forEach((card,index)=>{const x=55+index*378;ctx.fillStyle='#fffdfa';ctx.fillRect(x,180,352,125);ctx.fillStyle='#78695f';ctx.font='20px Arial';ctx.fillText(card[0],x+22,218);ctx.fillStyle='#332923';ctx.font='700 32px Arial';ctx.fillText(String(card[1]),x+22,270);});ctx.fillStyle='#332923';ctx.font='700 26px Arial';ctx.fillText('Результаты мастеров',55,365);const teamHeaders=['Мастер','Визиты','Клиенты','Минуты','Выручка','Средний чек'];ctx.font='700 17px Arial';teamHeaders.forEach((value,index)=>ctx.fillText(value,65+[0,460,610,760,940,1170][index],410));ctx.font='17px Arial';data.team.slice(0,12).forEach((row,rowIndex)=>{const y=450+rowIndex*45;ctx.fillStyle=rowIndex%2?'#fffdfa':'#f2e6dd';ctx.fillRect(55,y-28,1490,40);ctx.fillStyle='#332923';row.slice(0,6).forEach((value,index)=>reportPdfText(ctx,index>=4&&typeof value==='number'?money(value):value,65+[0,460,610,760,940,1170][index],y,index===0?390:190));});images.push(reportPdfImageBytes(page.canvas));
  const perPage=22;for(let start=0;start<data.rows.length;start+=perPage){page=reportPdfPage('Реестр записей',`${period} · строки ${start+1}–${Math.min(start+perPage,data.rows.length)}`);ctx=page.ctx;const columns=[['Дата',0,120],['Время',125,90],['Клиент',220,260],['Услуга',485,420],['Мастер',910,210],['Мин.',1125,80],['Получено',1210,155],['Результат',1370,170]];ctx.fillStyle='#332923';ctx.font='700 16px Arial';columns.forEach(column=>ctx.fillText(column[0],60+column[1],190));ctx.font='15px Arial';data.rows.slice(start,start+perPage).forEach((row,rowIndex)=>{const y=230+rowIndex*38;ctx.fillStyle=rowIndex%2?'#fffdfa':'#f2e6dd';ctx.fillRect(55,y-25,1490,34);ctx.fillStyle='#332923';const values=[row[0],row[1],row[3],row[5],row[6],row[7],money(row[10]),row[13]];values.forEach((value,index)=>reportPdfText(ctx,value,60+columns[index][1],y,columns[index][2]-10));});images.push(reportPdfImageBytes(page.canvas));}
  reportExportDownload(reportPdfBlob(images),reportExportFilename(data.range,'pdf'));notify('Готовый отчёт PDF скачан');
}

async function exportBookingsXlsxInBackground(privacy='masked') {
  if (!window.Worker || !window.Blob || !window.URL) { exportBookingsXlsx(privacy); return; }
  const button = $('[data-report-export="xlsx"]');
  const originalText = button?.querySelector('strong')?.textContent || '';
  if (button) button.disabled = true;
  if (button?.querySelector('strong')) button.querySelector('strong').textContent = 'Готовим…';
  let worker;
  try {
    const data = reportExportData(privacy);
    worker = new Worker('./report-worker.js?v=326');
    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('report_worker_timeout')), 20000);
      worker.onmessage = event => {
        clearTimeout(timeout);
        if (event.data?.error || !event.data?.blob) reject(new Error(event.data?.error || 'report_worker_failed'));
        else resolve(event.data.blob);
      };
      worker.onerror = event => { clearTimeout(timeout); reject(event.error || new Error('report_worker_failed')); };
      worker.postMessage({ sheets:reportExportSheets(data) });
    });
    reportExportDownload(result, reportExportFilename(data.range, 'xlsx'));
    notify('Готовый отчёт Excel скачан');
  } catch {
    exportBookingsXlsx(privacy);
  } finally {
    worker?.terminate();
    if (button) button.disabled = false;
    if (button?.querySelector('strong')) button.querySelector('strong').textContent = originalText;
  }
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
  toast.hidden = false;
  toast.textContent = '';
  const announce = () => {
    if (!toast.hidden) toast.textContent = message;
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(announce);
  else announce();
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => { toast.hidden = true; }, 2800);
}
function visitorVisitTimeLabel(value) {
  const createdAt = new Date(value);
  const seconds = Math.max(0, Math.round((Date.now() - createdAt.getTime()) / 1000));
  if (seconds < 60) return 'Только что';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} мин назад`;
  if (minutes < 1440) return createdAt.toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' });
  return createdAt.toLocaleDateString('ru-RU', { day:'numeric', month:'short' });
}
function visitorPresenceOnline(visit) {
  const lastSeen = new Date(visit.last_seen_at || '').getTime();
  return Boolean(visit.session_id) && Number.isFinite(lastSeen) && Date.now() - lastSeen < 90000;
}
function visitorPresencePage(value) {
  return ({ services:'выбирает услугу', date:'выбирает дату и время', details:'заполняет контакты', success:'завершил запись' })[value] || 'смотрит страницу записи';
}
function visitorPresenceSource(visit) {
  const fallback = ({ direct:'Прямой переход или источник скрыт', search:'Поиск', social:'Социальная сеть', referral:'Другой сайт', campaign:'Рекламная ссылка', qr:'QR-код' })[visit.source_kind] || 'Источник не определён';
  return visit.source_label || fallback;
}
function visitorPresencePhone(value) {
  if (!value) return '';
  return window.MinutaPhoneAuth?.formatPhone(value) || String(value);
}
function renderVisitorVisits() {
  const panel = $('#visitorNotificationPanel');
  const holder = $('#visitorNotificationList');
  if (!panel || !holder) return;
  panel.hidden = !visitorVisitsRemoteAvailable || !bookingPolicy.visitor_notifications_enabled;
  if (panel.hidden) return;
  const ordered = [...visitorVisits].sort((left, right) => new Date(right.last_seen_at || right.created_at) - new Date(left.last_seen_at || left.created_at));
  const online = ordered.filter(visitorPresenceOnline);
  $('#visitorNotificationCount').textContent = `${online.length} онлайн`;
  if (!visitorVisits.length) {
    holder.innerHTML = `<div class="provider-empty notification-empty"><span class="provider-empty-icon">${uiIcon('users')}</span><strong>Сейчас никого нет</strong><small>Здесь появятся посетители страницы онлайн-записи, их источник и текущий шаг.</small></div>`;
    return;
  }
  holder.innerHTML = ordered.slice(0, 20).map(visit => {
    const isOnline = visitorPresenceOnline(visit);
    const phone = visitorPresencePhone(visit.client_phone);
    const digits = String(visit.client_phone || '').replace(/\D/g, '');
    const name = visit.client_name || 'Анонимный посетитель';
    const source = visitorPresenceSource(visit);
    const firstSource = visit.first_source_label && visit.first_source_label !== source ? `<small>Первый источник: ${escapeHtml(visit.first_source_label)}</small>` : '';
    return `<article class="notification-card visitor-notification-card ${isOnline ? 'is-online' : 'is-recent'}"><span class="notification-card-icon">${uiIcon('users')}</span><div class="notification-card-main"><div class="notification-card-head"><span><i></i>${isOnline ? 'Сейчас на сайте' : 'Недавно заходил'}</span><b>${escapeHtml(isOnline ? 'Сейчас' : visitorVisitTimeLabel(visit.last_seen_at || visit.created_at))}</b></div><h3>${escapeHtml(name)}</h3><div class="visitor-presence-contact">${phone ? `<a href="tel:+${escapeHtml(digits)}">${escapeHtml(phone)}</a>` : '<span>Телефон пока не указан</span>'}</div><p>${escapeHtml(visitorPresencePage(visit.page_name))} · ${escapeHtml(source)}</p>${firstSource}</div></article>`;
  }).join('');
}
async function unlockVisitorNotificationSound() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return false;
  try {
    visitorNotificationAudioContext ||= new AudioContextClass();
    if (visitorNotificationAudioContext.state === 'suspended') await visitorNotificationAudioContext.resume();
    return visitorNotificationAudioContext.state === 'running';
  } catch { return false; }
}
async function playVisitorNotificationSound() {
  if (!await unlockVisitorNotificationSound()) return false;
  try {
    const context = visitorNotificationAudioContext;
    const start = context.currentTime + 0.01;
    [784, 1046].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const toneStart = start + index * 0.13;
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, toneStart);
      gain.gain.setValueAtTime(0.0001, toneStart);
      gain.gain.exponentialRampToValueAtTime(0.12, toneStart + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, toneStart + 0.11);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(toneStart);
      oscillator.stop(toneStart + 0.12);
    });
    return true;
  } catch { return false; }
}
function renderVisitorNotificationForm() {
  const card = $('#visitorAlertSettingsCard');
  const checkbox = $('#visitorNotificationsEnabled');
  const status = $('#visitorNotificationPermission');
  if (card) card.hidden = !visitorVisitsRemoteAvailable;
  if (!checkbox || !status) return;
  checkbox.checked = Boolean(bookingPolicy.visitor_notifications_enabled);
  if (!('Notification' in window)) status.textContent = 'В кабинете будут работать встроенные уведомления.';
  else if (Notification.permission === 'granted') status.textContent = 'Системные уведомления разрешены. Нажмите «Проверить уведомление и звук», чтобы активировать сигнал кабинета.';
  else if (Notification.permission === 'denied') status.textContent = 'Системные уведомления заблокированы браузером; уведомления внутри кабинета продолжат работать.';
  else status.textContent = 'После включения браузер может предложить разрешить системные уведомления.';
}
async function saveVisitorNotificationSettings(event) {
  event?.preventDefault();
  const checkbox = $('#visitorNotificationsEnabled');
  const saveStatus = $('#visitorNotificationSaveStatus');
  if (visitorNotificationSaving) return;
  if (!requireWrites()) { renderVisitorNotificationForm(); return; }
  const enabled = checkbox.checked;
  if (enabled) void unlockVisitorNotificationSound();
  const userId = currentUser?.id;
  const generation = sessionGeneration;
  const permissionRequest = enabled && 'Notification' in window && Notification.permission === 'default' ? Promise.resolve(Notification.requestPermission()).catch(() => 'default') : Promise.resolve('unchanged');
  visitorNotificationSaving = true;
  checkbox.disabled = true;
  if (saveStatus) saveStatus.textContent = 'Сохраняем…';
  const { error } = await db.from('booking_policies').update({ visitor_notifications_enabled:enabled }).eq('performer_id', userId);
  await permissionRequest;
  visitorNotificationSaving = false;
  if (!sessionIsCurrent(userId, generation)) return;
  checkbox.disabled = false;
  applyWriteAvailability();
  if (error) {
    showFormError('#visitorNotificationError', 'Не удалось сохранить настройку посетителей.');
    renderVisitorNotificationForm();
    if (saveStatus) saveStatus.textContent = 'Не удалось сохранить — повторите изменение';
    return;
  }
  clearFormError('#visitorNotificationError');
  bookingPolicy.visitor_notifications_enabled = enabled;
  renderVisitorNotificationForm();
  renderVisitorVisits();
  if (saveStatus) saveStatus.textContent = enabled ? 'Уведомления включены · сохранено' : 'Уведомления выключены · сохранено';
}
async function showVisitorSystemNotification(visit) {
  return showProviderSystemNotification({ key:`visitor-${visit.id}`, title:'Минута · новый посетитель', body:'Кто-то сейчас смотрит услуги и свободное время.', view:'notifications' });
}
async function showProviderSystemNotification({ key, title, body, view = 'bookings' }) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  const safeView = PROVIDER_VIEW_ORDER.includes(view) ? view : 'bookings';
  const safeKey = String(key || 'event').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 180);
  const options = { body, icon:'provider-icon-192.png', badge:'provider-icon-192.png', tag:`minuta-${safeKey}`, renotify:false, data:{ url:`provider.html?view=${safeView}`, view:safeView } };
  if ('serviceWorker' in navigator) {
    try {
      const registration = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) => setTimeout(() => reject(new Error('service_worker_timeout')), 1500))
      ]);
      await registration.showNotification(title, options);
      return true;
    } catch {}
  }
  try {
    const message = new Notification(title, options);
    message.onclick = () => { window.focus(); setProviderView(safeView); message.close(); };
    return true;
  } catch { return false; }
}
function announceVisitorVisit(visit) {
  if (!visit || visit.performer_id !== currentUser?.id || !bookingPolicy.visitor_notifications_enabled) return;
  const visitId = String(visit.id);
  if (announcedVisitorVisitIds.has(visitId)) return;
  announcedVisitorVisitIds.add(visitId);
  if (!document.hidden) notify('Новый посетитель смотрит страницу онлайн-записи');
  void playVisitorNotificationSound();
  if ('Notification' in window && Notification.permission === 'granted') void showVisitorSystemNotification(visit);
}
function handleVisitorVisit(payload) {
  const visit = payload?.new;
  if (!visit || visit.performer_id !== currentUser?.id || !bookingPolicy.visitor_notifications_enabled) return;
  const visitId = String(visit.id);
  const existingIndex = visitorVisits.findIndex(item => String(item.id) === visitId);
  if (existingIndex >= 0) visitorVisits.splice(existingIndex, 1, visit);
  else visitorVisits.unshift(visit);
  visitorVisits = visitorVisits.slice(0, 20);
  visitorVisitsRemoteAvailable = true;
  renderVisitorVisits();
  if (payload?.eventType === 'INSERT') announceVisitorVisit(visit);
}
async function testVisitorSystemNotification() {
  const button = $('#visitorNotificationTestButton');
  const status = $('#visitorNotificationPermission');
  if (!button || !status) return;
  const soundReady = await unlockVisitorNotificationSound();
  if (!('Notification' in window)) {
    status.textContent = 'Этот браузер не поддерживает системные уведомления. Встроенные уведомления кабинета продолжат работать.';
    notify('Системные уведомления недоступны в этом браузере');
    return;
  }
  button.disabled = true;
  let permission = Notification.permission;
  if (permission === 'default') {
    try { permission = await Notification.requestPermission(); } catch { permission = Notification.permission; }
  }
  if (permission !== 'granted') {
    button.disabled = false;
    status.textContent = 'Уведомления заблокированы. Разрешите их в настройках сайта браузера и повторите проверку.';
    notify('Браузер не разрешил системные уведомления');
    return;
  }
  const delivered = await showVisitorSystemNotification({ id:`test-${Date.now()}` });
  const soundPlayed = soundReady && await playVisitorNotificationSound();
  button.disabled = false;
  status.textContent = delivered && soundPlayed ? 'Проверочное уведомление и звуковой сигнал отправлены.' : delivered ? 'Уведомление показано, но браузер заблокировал звук. Нажмите кнопку ещё раз и проверьте громкость вкладки.' : 'Не удалось показать уведомление. Проверьте разрешения сайта в браузере.';
  notify(delivered && soundPlayed ? 'Уведомление и звук работают' : delivered ? 'Уведомление работает, звук заблокирован браузером' : 'Не удалось показать системное уведомление');
}

let activeIosTransition = null;
let activeIosTransitionCleanup = null;
const PROVIDER_VIEW_ORDER = ['bookings', 'clients', 'notifications', 'waitlist', 'analytics', 'schedule', 'services', 'organization', 'portfolio', 'settings', 'more'];

function providerViewFromLocation() {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get('section') || params.get('view');
  return PROVIDER_VIEW_ORDER.includes(requested) ? requested : 'bookings';
}

function prepareProviderViewBeforeSession(view = providerViewFromLocation()) {
  const safeView = PROVIDER_VIEW_ORDER.includes(view) ? view : 'bookings';
  const dashboard = $('#dashboard');
  if (dashboard) dashboard.dataset.activeView = safeView;
  $$('[data-provider-view]').forEach(button => {
    const active = button.dataset.providerView === safeView;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  $$('[data-provider-panel]').forEach(panel => {
    const active = panel.dataset.providerPanel === safeView;
    panel.hidden = !active;
    panel.classList.toggle('active', active);
  });
}

function syncProviderViewHistory(view, mode = 'push') {
  if (mode === 'none') return;
  const url = new URL(window.location.href);
  url.searchParams.delete('view');
  if (view === 'bookings') url.searchParams.delete('section');
  else url.searchParams.set('section', view);
  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl === currentUrl && mode !== 'replace') return;
  window.history[mode === 'replace' ? 'replaceState' : 'pushState']({ providerView:view }, '', nextUrl);
}

function syncScheduleContextHistory(mode = 'replace') {
  const url = new URL(window.location.href);
  url.searchParams.set('date', selectedDate);
  url.searchParams.set('range', calendarView);
  url.searchParams.set('records', currentFilter);
  url.searchParams.set('journal', journalMode);
  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl === currentUrl) return;
  window.history[mode === 'push' ? 'pushState' : 'replaceState']({ ...(window.history.state || {}), scheduleContext:true }, '', nextUrl);
}

function updateProviderClientLinks(organization = null) {
  const url = new URL('index.html', window.location.href);
  url.search = '';
  url.hash = '';
  if (organization?.public_booking_enabled && organization.public_slug) url.searchParams.set('org', organization.public_slug);
  $$('.provider-client-link').forEach(link => { link.href = url.href; });
}

function focusProviderViewHeading(view) {
  const panel = $(`[data-provider-panel="${view}"]`);
  const heading = panel?.querySelector('.view-title h2');
  if (!heading) return;
  heading.setAttribute('tabindex', '-1');
  requestAnimationFrame(() => heading.focus({ preventScroll:true }));
}

function providerSectionViewKey(nav) {
  return nav?.closest('[data-provider-panel]')?.dataset.providerPanel || '';
}

function providerSectionStorageKey(nav) {
  const view = providerSectionViewKey(nav);
  return view ? `${PROVIDER_SECTION_STORAGE_PREFIX}:${view}` : '';
}

function rememberedProviderSection(nav) {
  const view = providerSectionViewKey(nav);
  if (!view) return '';
  if (providerSectionSelections.has(view)) return providerSectionSelections.get(view);
  const key = providerSectionStorageKey(nav);
  let target = '';
  try { target = localStorage.getItem(key) || ''; } catch {}
  if (target) providerSectionSelections.set(view, target);
  return target;
}

function rememberProviderSection(button) {
  const nav = button?.closest('.provider-section-nav');
  const view = providerSectionViewKey(nav);
  const target = button?.dataset.sectionTarget || '';
  if (!nav || !view || !target) return;
  providerSectionSelections.set(view, target);
  try { localStorage.setItem(providerSectionStorageKey(nav), target); } catch {}
}

function preferredProviderSectionTarget(buttons, rememberedTarget = '') {
  const visible = buttons.filter(button => !button.hidden);
  return visible.find(button => button.dataset.sectionTarget === rememberedTarget)
    || visible.find(button => button.classList.contains('active'))
    || visible[0]
    || null;
}

function providerSectionElements(button) {
  const targetId = button?.dataset.sectionTarget || '';
  const target = document.getElementById(targetId);
  if (!target) return [];
  const elements = [target];
  if (target.classList.contains('provider-section-marker') && target.nextElementSibling) elements.push(target.nextElementSibling);
  (PROVIDER_SECTION_COMPANIONS[targetId] || []).forEach(id => {
    const companion = document.getElementById(id);
    if (companion) elements.push(companion);
  });
  return [...new Set(elements)];
}

function setProviderSectionElementVisible(element, visible) {
  if (!providerSectionPresentation.has(element)) {
    providerSectionPresentation.set(element, {
      display:element.style.display,
      ariaHidden:element.getAttribute('aria-hidden'),
      inert:element.hasAttribute('inert')
    });
  }
  const original = providerSectionPresentation.get(element);
  if (visible) {
    element.style.display = original.display;
    if (original.ariaHidden === null) element.removeAttribute('aria-hidden');
    else element.setAttribute('aria-hidden', original.ariaHidden);
    if (original.inert) element.setAttribute('inert', '');
    else element.removeAttribute('inert');
    return;
  }
  element.style.display = 'none';
  element.setAttribute('aria-hidden', 'true');
  element.setAttribute('inert', '');
}

function restoreProviderSectionDisclosure(nav) {
  const elements = [...new Set([...nav.querySelectorAll('[data-section-target]')].flatMap(providerSectionElements))];
  elements.forEach(element => {
    const original = providerSectionPresentation.get(element);
    if (!original) return;
    element.style.display = original.display;
    if (original.ariaHidden === null) element.removeAttribute('aria-hidden');
    else element.setAttribute('aria-hidden', original.ariaHidden);
    if (original.inert) element.setAttribute('inert', '');
    else element.removeAttribute('inert');
    providerSectionPresentation.delete(element);
  });
}

function refreshProviderSectionDisclosure(nav) {
  const buttons = [...nav.querySelectorAll('[data-section-target]')];
  if (!providerSectionMobileQuery.matches) {
    restoreProviderSectionDisclosure(nav);
    return;
  }
  const selected = preferredProviderSectionTarget(buttons, rememberedProviderSection(nav));
  buttons.forEach(button => {
    const active = button === selected;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'location');
    else button.removeAttribute('aria-current');
    providerSectionElements(button).forEach(element => setProviderSectionElementVisible(element, active));
  });
}

function refreshSectionNavigation() {
  $$('.provider-section-nav').forEach(nav => {
    const buttons = [...nav.querySelectorAll('[data-section-target]')];
    buttons.forEach(button => {
      const target = document.getElementById(button.dataset.sectionTarget);
      if (target) button.setAttribute('aria-controls', target.id);
      const shouldHide = !target || target.hidden;
      if (button.hidden !== shouldHide) button.hidden = shouldHide;
      if (shouldHide) {
        button.classList.remove('active');
        button.removeAttribute('aria-current');
      }
    });
    const visible = buttons.filter(button => !button.hidden);
    if (!visible.length) return;
    if (!visible.some(button => button.classList.contains('active'))) {
      visible[0].classList.add('active');
      visible[0].setAttribute('aria-current', 'location');
    }
    refreshProviderSectionDisclosure(nav);
  });
  scheduleSectionNavigationUpdate();
}

function scrollToProviderSection(button) {
  const target = document.getElementById(button?.dataset.sectionTarget || '');
  if (!target || target.hidden) return;
  const nav = button.closest('.provider-section-nav');
  rememberProviderSection(button);
  nav?.querySelectorAll('[data-section-target]').forEach(item => {
    const active = item === button;
    item.classList.toggle('active', active);
    if (active) item.setAttribute('aria-current', 'location');
    else item.removeAttribute('aria-current');
  });
  if (nav && providerSectionMobileQuery.matches) refreshProviderSectionDisclosure(nav);
  const focusTarget = target.classList.contains('provider-section-marker')
    ? target.nextElementSibling?.querySelector('summary') || target.nextElementSibling
    : target;
  focusTarget?.setAttribute('tabindex', '-1');
  target.scrollIntoView({ behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block:'start' });
  requestAnimationFrame(() => focusTarget?.focus({ preventScroll:true }));
}

function updateActiveSectionNavigation() {
  if (providerSectionMobileQuery.matches) return;
  $$('.provider-section-nav').forEach(nav => {
    if (!nav.offsetParent) return;
    const buttons = [...nav.querySelectorAll('[data-section-target]')].filter(button => !button.hidden);
    if (!buttons.length) return;
    const threshold = nav.getBoundingClientRect().bottom + 20;
    let activeButton = buttons[0];
    buttons.forEach(button => {
      const target = document.getElementById(button.dataset.sectionTarget);
      if (target && !target.hidden && target.getBoundingClientRect().top <= threshold) activeButton = button;
    });
    buttons.forEach(button => {
      const active = button === activeButton;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'location');
      else button.removeAttribute('aria-current');
    });
  });
}

function scheduleSectionNavigationUpdate() {
  if (sectionNavigationFrame) return;
  sectionNavigationFrame = requestAnimationFrame(() => {
    sectionNavigationFrame = 0;
    updateActiveSectionNavigation();
  });
}

function canUseIosTransitions() {
  return displayPreferences?.ios_transitions !== false
    && typeof document.startViewTransition === 'function'
    && window.matchMedia('(max-width: 760px)').matches
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
function runIosTransition({ current, next, update, direction = 'forward', name = 'ios-provider-panel' }) {
  if (!current || current.hidden || !canUseIosTransitions()) { update(); return null; }
  activeIosTransition?.skipTransition();
  activeIosTransitionCleanup?.();
  const root = document.documentElement;
  root.classList.add('ios-view-transition');
  root.dataset.iosTransitionDirection = direction;
  current.style.viewTransitionName = name;
  let target = null;
  const cleanup = () => {
    current.style.viewTransitionName = '';
    if (target && target !== current) target.style.viewTransitionName = '';
    root.classList.remove('ios-view-transition');
    delete root.dataset.iosTransitionDirection;
  };
  try {
    const transition = document.startViewTransition(() => {
      update();
      target = next?.() || null;
      if (target) target.style.viewTransitionName = name;
    });
    activeIosTransition = transition;
    activeIosTransitionCleanup = cleanup;
    transition.finished.finally(() => {
      if (activeIosTransition !== transition) return;
      cleanup();
      activeIosTransition = null;
      activeIosTransitionCleanup = null;
    });
    return transition;
  } catch {
    cleanup();
    update();
    return null;
  }
}
function setAuthTabImmediate(tab) {
  recoveryMode = false;
  $('#authTabs').hidden = false;
  $('#recoveryForm').hidden = true;
  $('#resetPasswordForm').hidden = true;
  $('#recoverySent').hidden = true;
  $('#providerPhoneLoginForm').hidden = true;
  $$('[data-auth-tab]').forEach(button => button.classList.toggle('active', button.dataset.authTab === tab));
  $('#loginForm').hidden = tab !== 'login';
  $('#signupForm').hidden = tab !== 'signup';
  $('#authBadge').innerHTML = '<i></i> Личный кабинет';
  $('#authTitle').textContent = tab === 'login' ? 'Все записи под рукой.' : 'Создайте свой кабинет.';
  $('#authDescription').textContent = tab === 'login'
    ? 'Войдите или зарегистрируйтесь, чтобы управлять расписанием и услугами.'
    : 'Укажите данные исполнителя — после подтверждения почты можно принимать записи.';
}
function setAuthTab(tab) {
  const previousTab = $('[data-auth-tab].active')?.dataset.authTab;
  const update = () => setAuthTabImmediate(tab);
  if (previousTab && previousTab !== tab) {
    return runIosTransition({
      current: $('#authCard'),
      next: () => $('#authCard'),
      update,
      direction: tab === 'signup' ? 'forward' : 'backward',
      name: 'ios-auth-card'
    });
  }
  update();
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
  $('#providerPhoneLoginForm').hidden = true;
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
  $('#providerPhoneLoginForm').hidden = true;
  $('#resetPasswordForm').hidden = false;
  $('#authBadge').innerHTML = '<i></i> Новый пароль';
  $('#authTitle').textContent = 'Придумайте новый пароль.';
  $('#authDescription').textContent = 'Ссылка подтверждена. Осталось сохранить новый пароль для кабинета.';
  finishProviderBoot();
  setTimeout(() => $('#recoveryNewPassword').focus(), 0);
}
function showRecoverySent() {
  $('#recoveryForm').hidden = true;
  $('#recoverySent').hidden = false;
  const address = $('#recoverySentAddress');
  if (address) address.textContent = $('#recoveryEmail').value.trim().toLowerCase();
  $('#authTitle').textContent = 'Проверьте почту.';
  $('#authDescription').textContent = 'Ссылка для восстановления доступа уже отправлена.';
}
function setProviderViewImmediate(view, focusHeading = false) {
  $('#dashboard').dataset.activeView = view;
  renderProviderBookingView(view);
  $$('[data-provider-view]').forEach(button => {
    const active = button.dataset.providerView === view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  if (!normalizeMobileNavigation(displayPreferences.mobile_nav).includes(view)) {
    const moreButton = $('.provider-mobile-nav [data-provider-view="more"]');
    moreButton?.classList.add('active');
    moreButton?.setAttribute('aria-current', 'page');
  }
  if (view === 'clients') $('#clientsLayout')?.classList.remove('is-detail');
  $$('[data-provider-panel]').forEach(panel => {
    const active = panel.dataset.providerPanel === view;
    panel.hidden = !active;
    panel.classList.toggle('active', active);
  });
  const mobileCreate = $('#mobileNewBookingButton');
  if (mobileCreate) mobileCreate.hidden = !['bookings', 'clients'].includes(view);
  if (view === 'notifications') { renderNotificationTemplates(); renderNotifications(); }
  if (view === 'analytics') renderAnalytics();
  if (view === 'portfolio') { renderPortfolio(); renderProviderReviews(); }
  if (view === 'waitlist') renderWaitlist();
  if (view === 'organization') {
    if (organizationController.availability === null) organizationController.load();
    else organizationController.render();
  }
  refreshSectionNavigation();
  window.scrollTo({ top: 0, behavior: 'auto' });
  if (focusHeading) focusProviderViewHeading(view);
}
function setProviderView(view, { historyMode = 'push', focusHeading = true } = {}) {
  const nextView = PROVIDER_VIEW_ORDER.includes(view) ? view : 'bookings';
  const currentPanel = $$('[data-provider-panel]').find(panel => !panel.hidden);
  const previousView = currentPanel?.dataset.providerPanel;
  const changed = previousView !== nextView;
  const update = () => setProviderViewImmediate(nextView, focusHeading && changed);
  if (changed || historyMode === 'replace' || providerViewFromLocation() !== nextView) syncProviderViewHistory(nextView, historyMode);
  if (previousView && changed && !$('#dashboard').hidden) {
    const previousIndex = PROVIDER_VIEW_ORDER.indexOf(previousView);
    const nextIndex = PROVIDER_VIEW_ORDER.indexOf(nextView);
    return runIosTransition({
      current: currentPanel,
      next: () => $$('[data-provider-panel]').find(panel => panel.dataset.providerPanel === nextView),
      update,
      direction: previousIndex >= 0 && nextIndex >= 0 && nextIndex < previousIndex ? 'backward' : 'forward'
    });
  }
  update();
}
function setFilter(filter) {
  currentFilter = filter;
  if (filter !== 'day') calendarView = 'day';
  try {
    localStorage.setItem(SCHEDULE_FILTER_KEY, currentFilter);
    localStorage.setItem(CALENDAR_VIEW_KEY, calendarView);
  } catch {}
  $$('[data-filter]').forEach(button => {
    const active = button.dataset.filter === filter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  updateCalendarViewControls();
  updateJournalModeButtons();
  updateBookingQueryTools();
  syncScheduleContextHistory();
  renderBookings();
}

function setJournalMode(mode) {
  journalMode = ['timeline', 'list'].includes(mode) ? mode : 'timeline';
  if (journalMode === 'timeline') currentFilter = 'day';
  localStorage.setItem(JOURNAL_MODE_KEY, journalMode);
  try { localStorage.setItem(SCHEDULE_FILTER_KEY, currentFilter); } catch {}
  $$('[data-filter]').forEach(button => {
    const active = button.dataset.filter === currentFilter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  updateJournalModeButtons();
  updateBookingQueryTools();
  syncScheduleContextHistory();
  renderBookings();
}

function restoreDefaultScheduleView() {
  if (teamCalendarController?.isTeamMode) teamCalendarController.setMode('personal', { silent:true });
  selectedDate = businessTodayIso();
  calendarView = 'day';
  currentFilter = 'day';
  journalMode = 'timeline';
  timelineFullDay = false;
  bookingSearchQuery = '';
  bookingStatusFilter = 'all';
  bookingSourceFilter = 'all';
  bookingAnalyticsFilter = '';
  bookingAnalyticsScope = null;
  bookingRenderLimit = BOOKING_RENDER_PAGE_SIZE;
  try {
    localStorage.setItem(CALENDAR_VIEW_KEY, calendarView);
    localStorage.setItem(SCHEDULE_FILTER_KEY, currentFilter);
    localStorage.setItem(JOURNAL_MODE_KEY, journalMode);
  } catch {}
  rememberSelectedDate(true);
  setTeamCalendarMode(false, { render:false });
  const search = $('#bookingSearch');
  const status = $('#bookingStatusFilter');
  if (search) search.value = '';
  if (status) status.value = 'all';
  $$('[data-filter]').forEach(button => {
    const active = button.dataset.filter === currentFilter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  updateCalendarViewControls();
  updateJournalModeButtons();
  updateBookingQueryTools();
  syncScheduleContextHistory();
  renderDateStrip();
  renderBookings();
}

function updateJournalModeButtons() {
  const modeToggle = $('.journal-mode-toggle');
  if (modeToggle) modeToggle.hidden = teamCalendarController?.isTeamMode || currentFilter !== 'day' || calendarView !== 'day';
  const filters = $('.booking-filters');
  if (filters) filters.hidden = Boolean(teamCalendarController?.isTeamMode) || calendarView !== 'day' || journalMode === 'timeline';
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
  const requested = new URLSearchParams(window.location.search).get('date');
  if (parseLocalIsoDate(requested)) return requested;
  try {
    if (localStorage.getItem(SCHEDULE_FOLLOW_TODAY_KEY) === 'true') return businessTodayIso();
    const stored = localStorage.getItem(SCHEDULE_DATE_KEY);
    if (parseLocalIsoDate(stored)) return stored;
  } catch {}
  return businessTodayIso();
}

function restoreScheduleFilter() {
  const requested = new URLSearchParams(window.location.search).get('records');
  if (['day', 'upcoming', 'all'].includes(requested)) return requested;
  try {
    const stored = localStorage.getItem(SCHEDULE_FILTER_KEY);
    if (['day', 'upcoming', 'all'].includes(stored)) return stored;
  } catch {}
  return 'day';
}

function restoreCalendarView() {
  const requested = new URLSearchParams(window.location.search).get('range');
  if (['day', 'week', 'month'].includes(requested)) return requested;
  try {
    const stored = localStorage.getItem(CALENDAR_VIEW_KEY);
    if (['day', 'week', 'month'].includes(stored)) return stored;
  } catch {}
  return 'day';
}

function restoreJournalMode() {
  const requested = new URLSearchParams(window.location.search).get('journal');
  if (['timeline', 'list'].includes(requested)) return requested;
  try {
    const stored = localStorage.getItem(JOURNAL_MODE_KEY);
    if (['timeline', 'list'].includes(stored)) return stored;
  } catch {}
  return 'timeline';
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

function calendarRange(view = calendarView, value = selectedDate) {
  const selected = parseLocalIsoDate(value) || parseLocalIsoDate(businessTodayIso());
  if (view === 'week') {
    const start = weekStartFor(selected);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { start:localIsoDate(start), end:localIsoDate(end) };
  }
  if (view === 'month') {
    const start = new Date(selected.getFullYear(), selected.getMonth(), 1, 12);
    const end = new Date(selected.getFullYear(), selected.getMonth() + 1, 0, 12);
    return { start:localIsoDate(start), end:localIsoDate(end) };
  }
  const iso = localIsoDate(selected);
  return { start:iso, end:iso };
}

function updateCalendarViewControls() {
  $$('[data-calendar-view]').forEach(button => {
    const active = button.dataset.calendarView === calendarView;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const strip = $('#dateStrip');
  if (strip) strip.hidden = calendarView !== 'day' || currentFilter !== 'day';
  const filters = $('.booking-filters');
  if (filters) filters.hidden = Boolean(teamCalendarController?.isTeamMode) || calendarView !== 'day' || journalMode === 'timeline';
  const labels = calendarView === 'day'
    ? ['Показать предыдущий день', 'Показать следующий день']
    : calendarView === 'week'
      ? ['Показать предыдущую неделю', 'Показать следующую неделю']
      : ['Показать предыдущий месяц', 'Показать следующий месяц'];
  const navigationButtons = $$('[data-date-shift]');
  navigationButtons[0]?.setAttribute('aria-label', labels[0]);
  navigationButtons[1]?.setAttribute('aria-label', labels[1]);
  updateJournalModeButtons();
  updateBookingQueryTools();
}

function setCalendarView(view) {
  const next = ['day', 'week', 'month'].includes(view) ? view : 'day';
  if (next === calendarView && currentFilter === 'day') return;
  calendarView = next;
  timelineFullDay = false;
  currentFilter = 'day';
  try {
    localStorage.setItem(CALENDAR_VIEW_KEY, calendarView);
    localStorage.setItem(SCHEDULE_FILTER_KEY, currentFilter);
  } catch {}
  $$('[data-filter]').forEach(button => {
    const active = button.dataset.filter === currentFilter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  updateCalendarViewControls();
  syncScheduleContextHistory();
  renderDateStrip();
  renderBookings();
}

function selectScheduleDate(value) {
  const date = parseLocalIsoDate(value);
  if (!date) return;
  const nextDate = localIsoDate(date);
  if (selectedDate !== nextDate) timelineFullDay = false;
  selectedDate = nextDate;
  rememberSelectedDate();
  renderDateStrip();
  setFilter('day');
}

function shiftScheduleDate(direction) {
  const date = parseLocalIsoDate(selectedDate) || parseLocalIsoDate(businessTodayIso());
  if (calendarView === 'month') {
    const selectedDay = date.getDate();
    date.setDate(1);
    date.setMonth(date.getMonth() + direction);
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0, 12).getDate();
    date.setDate(Math.min(selectedDay, lastDay));
  } else date.setDate(date.getDate() + (calendarView === 'week' ? direction * 7 : direction));
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
  const todayButton = $('[data-date-today]');
  if (todayButton) todayButton.hidden = false;
  const active = $('#dateStrip [data-booking-date].active');
  if ($('#dateStrip').scrollWidth > $('#dateStrip').clientWidth) active?.scrollIntoView({ block: 'nearest', inline: 'center' });
  updateCalendarViewControls();
}

function updateBookingStats() {
  const today = businessTodayIso();
  const active = allBookings.filter(item => item.status !== 'cancelled' && !isScheduleBlock(item));
  const todayCount = active.filter(item => item.booking_date === today).length;
  const upcomingCount = active.filter(item => item.booking_date >= today).length;
  $('#todayBookingsCount').textContent = String(todayCount);
  $('#newBookingsCount').textContent = String(upcomingCount);
  const sidebarBadge = $('#newBookingsBadge');
  if (sidebarBadge) {
    sidebarBadge.textContent = String(upcomingCount);
    sidebarBadge.hidden = true;
  }
}

function filteredBookings() {
  const today = businessTodayIso();
  if (currentFilter === 'all') return allBookings;
  if (currentFilter === 'upcoming') return allBookings.filter(item => item.status !== 'cancelled' && item.booking_date >= today);
  return allBookings.filter(item => item.status !== 'cancelled' && item.booking_date === selectedDate);
}

function bookingQueryIsActive() {
  return Boolean(bookingSearchQuery.trim()) || bookingStatusFilter !== 'all' || bookingSourceFilter !== 'all' || Boolean(bookingAnalyticsFilter);
}

function updateBookingQueryTools() {
  const tools = $('#bookingQueryTools');
  if (!tools) return;
  tools.hidden = Boolean(teamCalendarController?.isTeamMode) || currentFilter === 'day' || calendarView !== 'day';
  const reset = $('#bookingQueryReset');
  if (reset) reset.hidden = !bookingQueryIsActive();
  const sourceChip = $('#bookingSourceFilterChip');
  if (sourceChip) {
    const labels = { online:'Онлайн', manual:'Мастером', unknown:'Без данных' };
    sourceChip.hidden = bookingSourceFilter === 'all';
    sourceChip.textContent = bookingSourceFilter === 'all' ? '' : `Создано: ${labels[bookingSourceFilter] || bookingSourceFilter} ×`;
  }
}

function applyBookingQuery(items) {
  if (currentFilter === 'day') return items;
  const query = bookingSearchQuery.trim().toLocaleLowerCase('ru-RU');
  const queryDigits = query.replace(/\D/g, '');
  return items.filter(item => {
    if (bookingStatusFilter !== 'all' && bookingStatusClass(item) !== bookingStatusFilter) return false;
    if (bookingSourceFilter !== 'all' && reportBookingSource(item) !== bookingSourceFilter) return false;
    if (bookingAnalyticsScope && (item.booking_date < bookingAnalyticsScope.start || item.booking_date > bookingAnalyticsScope.end)) return false;
    if (bookingAnalyticsScope?.performer && bookingAnalyticsScope.performer !== 'all' && String(item.performer_id || '') !== String(bookingAnalyticsScope.performer)) return false;
    if (bookingAnalyticsFilter === 'debt' && !(bookingOutcome(item).visit_status === 'completed' && bookingCalculatedValue(item) > Number(bookingOutcome(item).amount_rub || 0))) return false;
    if (bookingAnalyticsFilter === 'lost' && !(item.status === 'cancelled' || bookingOutcome(item).visit_status === 'no_show')) return false;
    if (!query) return true;
    const text = [item.client_name, item.client_phone, serviceName(item.services?.name || ''), ...bookingSession(item).map(entry => entry.title), bookingDisplayNote(item)]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase('ru-RU');
    if (text.includes(query)) return true;
    return Boolean(queryDigits) && String(item.client_phone || '').replace(/\D/g, '').includes(queryDigits);
  });
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

function syncSlotIntervalOptions(value = $('#slotInterval')?.value) {
  $$('.slot-step-options [data-slot-interval]').forEach(button => {
    button.setAttribute('aria-selected', String(button.dataset.slotInterval === String(value || '5')));
  });
}

function timelineTimeFromClick(stage, event) {
  const start = Number(stage.dataset.timelineStart);
  const end = Number(stage.dataset.timelineEnd);
  const rect = stage.getBoundingClientRect();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || rect.height <= 0) return '';
  const position = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
  const rawMinute = start + ((position / rect.height) * (end - start));
  const step = 30;
  const snappedMinute = Math.round(rawMinute / step) * step;
  const firstSlot = Math.ceil(start / step) * step;
  const lastSlot = Math.floor((end - 1) / step) * step;
  const snapped = firstSlot <= lastSlot
    ? Math.max(firstSlot, Math.min(lastSlot, snappedMinute))
    : Math.max(start, Math.min(end - 1, Math.round(rawMinute)));
  return `${String(Math.floor(snapped / 60)).padStart(2, '0')}:${String(snapped % 60).padStart(2, '0')}`;
}

function timelineMinuteFromPointer(stage, clientY, pointerOffsetY, duration, dateIso = selectedDate) {
  const start = Number(stage?.dataset.timelineStart);
  const end = Number(stage?.dataset.timelineEnd);
  const rect = stage?.getBoundingClientRect();
  if (!rect || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || rect.height <= 0) return null;
  const step = scheduleStepForDate(dateIso);
  const rawMinute = start + (((clientY - rect.top - pointerOffsetY) / rect.height) * (end - start));
  const snapped = Math.round(rawMinute / step) * step;
  return Math.max(start, Math.min(end - duration, snapped));
}

function bookingPlacementIssue(item, dateIso, startMinute, { allowPast = false, ignoreSchedule = false } = {}) {
  const duration = Math.max(1, Number(item?.duration_minutes || item?.services?.duration_minutes || 60));
  const endMinute = startMinute + duration;
  const automaticBuffer = bookingPolicy.booking_buffer_enabled
    ? Math.min(1440, Math.max(1, Number(bookingPolicy.booking_buffer_minutes) || 60))
    : 0;
  const candidateIsBlock = isScheduleBlock(item);
  if (dateIso < businessTodayIso() && !allowPast) return 'Нельзя переносить запись в прошлое';
  const date = parseLocalIsoDate(dateIso);
  if (!date) return 'Не удалось определить выбранную дату';
  if (startMinute < 0 || endMinute > 1440) return 'Запись должна завершиться в выбранную дату';
  if (!ignoreSchedule) {
    const weekday = ((date.getDay() + 6) % 7) + 1;
    const schedule = scheduleRows.find(row => Number(row.weekday) === weekday);
    if (schedule?.enabled === false) return 'В этот день в расписании стоит выходной';
    const scheduleStart = minutesFromTime(schedule?.start_time || '10:00');
    const scheduleEnd = minutesFromTime(schedule?.end_time || '20:00');
    if (startMinute < scheduleStart || endMinute > scheduleEnd) return 'Запись должна оставаться в пределах рабочего дня';
    if (schedule?.break_start && schedule?.break_end) {
      const breakStart = minutesFromTime(schedule.break_start);
      const breakEnd = minutesFromTime(schedule.break_end);
      if (startMinute < breakEnd && endMinute > breakStart) return 'Это время пересекается с перерывом в расписании';
    }
    const dayOff = daysOff.find(entry => {
      if (entry.off_date !== dateIso) return false;
      if (entry.all_day) return true;
      const offStart = minutesFromTime(entry.start_time);
      const offEnd = minutesFromTime(entry.end_time);
      return startMinute < offEnd && endMinute > offStart;
    });
    if (dayOff) return dayOff.all_day ? 'На эту дату установлен выходной' : 'Это время закрыто в исключениях расписания';
  }
  const conflict = allBookings.find(other => {
    if (other.id === item.id || other.status === 'cancelled' || other.booking_date !== dateIso) return false;
    const otherStart = minutesFromTime(other.booking_time);
    const otherEnd = otherStart + Math.max(1, Number(other.duration_minutes || other.services?.duration_minutes || 60));
    const buffer = automaticBuffer && !candidateIsBlock && !isScheduleBlock(other) ? automaticBuffer : 0;
    return startMinute < otherEnd + buffer && endMinute > otherStart - buffer;
  });
  return conflict
    ? (automaticBuffer && !candidateIsBlock && !isScheduleBlock(conflict)
      ? `Рядом с записью в ${String(conflict.booking_time).slice(0, 5)} действует перерыв ${automaticBuffer} мин`
      : `В ${String(conflict.booking_time).slice(0, 5)} уже есть запись`)
    : '';
}

function finishTimelineBookingDrag({ restore = true } = {}) {
  const state = timelineBookingDrag;
  if (!state) return;
  clearTimeout(state.holdTimer);
  state.label?.remove();
  state.card.classList.remove('is-dragging', 'is-drag-pressed');
  state.card.removeAttribute('aria-grabbed');
  if (restore && state.card.isConnected) state.card.style.top = state.originalTop;
  document.body.classList.remove('timeline-booking-dragging');
  try { state.card.releasePointerCapture(state.pointerId); } catch {}
  timelineBookingDrag = null;
}

function activateTimelineBookingDrag(state) {
  if (!state || timelineBookingDrag !== state || state.active) return;
  state.active = true;
  state.card.classList.add('is-dragging');
  state.card.setAttribute('aria-grabbed', 'true');
  document.body.classList.add('timeline-booking-dragging');
  state.label = document.createElement('span');
  state.label.className = 'timeline-drag-label';
  state.stage.append(state.label);
  if (state.pointerType === 'touch') navigator.vibrate?.(12);
}

function updateTimelineBookingDrag(state, clientY) {
  const minute = timelineMinuteFromPointer(state.stage, clientY, state.pointerOffsetY, state.duration);
  if (!Number.isFinite(minute)) return;
  state.targetMinute = minute;
  const start = Number(state.stage.dataset.timelineStart);
  const end = Number(state.stage.dataset.timelineEnd);
  const rect = state.stage.getBoundingClientRect();
  const top = ((minute - start) / (end - start)) * rect.height + 2;
  const endTime = timeFromMinutes(minute + state.duration);
  state.card.style.top = `${top}px`;
  state.label.textContent = `${timeFromMinutes(minute)}–${endTime}`;
  state.label.style.top = `${Math.max(4, top - 27)}px`;
}

async function persistTimelineBookingMove(state) {
  const item = allBookings.find(booking => booking.id === state.bookingId);
  if (!item || timelineMovePending) {
    renderBookings();
    return;
  }
  const targetTime = timeFromMinutes(state.targetMinute);
  const originalTime = String(item.booking_time).slice(0, 5);
  if (targetTime === originalTime) {
    renderBookings();
    return;
  }
  const issue = bookingPlacementIssue(item, state.date, state.targetMinute);
  if (issue) {
    notify(issue);
    renderBookings();
    return;
  }
  if (!requireWrites()) {
    renderBookings();
    return;
  }
  timelineMovePending = true;
  state.card.classList.add('is-saving-position');
  state.card.setAttribute('aria-busy', 'true');
  const userId = currentUser.id;
  const generation = sessionGeneration;
  const { data: availableSlots, error: availabilityError } = await getProviderAvailableSlots({
    p_service:item.service_id,
    p_start:state.date,
    p_end:state.date,
    p_ignore_booking: item.id
  });
  if (!sessionIsCurrent(userId, generation)) {
    timelineMovePending = false;
    return;
  }
  const remotelyAvailable = !availabilityError && (availableSlots || []).some(slot => String(slot.booking_time).slice(0, 5) === targetTime);
  if (!remotelyAvailable) {
    timelineMovePending = false;
    notify(availabilityError ? 'Не удалось проверить новое время. Попробуйте ещё раз.' : 'Это время уже занято или недоступно');
    renderBookings();
    return;
  }
  const { error } = await db.from('bookings').update({ booking_date:state.date, booking_time:`${targetTime}:00` }).eq('id', item.id).eq('performer_id', userId);
  timelineMovePending = false;
  if (!sessionIsCurrent(userId, generation)) return;
  if (error) {
    notify('Не удалось перенести запись: время уже занято');
    await loadBookings({ silent:true });
    return;
  }
  if (!isScheduleBlock(item)) notifyTelegramClient(item.id, 'rescheduled');
  await refreshAfterWrite();
  notify(`Запись перенесена на ${targetTime}`);
}

function beginTimelineBookingDrag(event, card) {
  if (timelineBookingDrag || scheduleDaySwipe || timelineMovePending || !writesAllowed || event.button !== 0 || card.classList.contains('status-cancelled')) return;
  const stage = card.closest('.timeline-stage');
  const item = allBookings.find(booking => booking.id === card.dataset.openBooking);
  if (!stage || !item) return;
  const rect = card.getBoundingClientRect();
  const state = {
    pointerId:event.pointerId,
    pointerType:event.pointerType,
    card,
    stage,
    bookingId:item.id,
    date:selectedDate,
    duration:Math.max(1, Number(item.duration_minutes || item.services?.duration_minutes || 60)),
    startX:event.clientX,
    startY:event.clientY,
    pointerOffsetY:event.clientY - rect.top,
    originalTop:card.style.top,
    targetMinute:minutesFromTime(item.booking_time),
    active:false,
    holdTimer:null,
    label:null
  };
  timelineBookingDrag = state;
  card.classList.add('is-drag-pressed');
  card.setPointerCapture?.(event.pointerId);
  if (event.pointerType === 'touch' || event.pointerType === 'pen') {
    state.holdTimer = setTimeout(() => activateTimelineBookingDrag(state), TIMELINE_TOUCH_HOLD_MS);
  }
}

function finishScheduleDaySwipe(state, event) {
  if (!state || scheduleDaySwipe !== state) return;
  const deltaX = event.clientX - state.startX;
  state.surface.classList.remove('is-day-swiping');
  state.surface.style.removeProperty('--day-swipe-x');
  try { state.surface.releasePointerCapture(state.pointerId); } catch {}
  scheduleDaySwipe = null;
  if (!state.active || Math.abs(deltaX) < SCHEDULE_SWIPE_THRESHOLD_PX) return;
  gestureClickSuppressedUntil = Date.now() + 450;
  shiftScheduleDate(deltaX < 0 ? 1 : -1);
}

function beginScheduleDaySwipe(event, surface) {
  if ((event.pointerType !== 'touch' && event.pointerType !== 'pen') || event.button !== 0 || currentFilter !== 'day' || timelineBookingDrag || timelineMovePending) return;
  if (event.target.closest('.timeline-booking,.provider-booking,input,select,textarea,a,[contenteditable="true"]')) return;
  scheduleDaySwipe = {
    pointerId:event.pointerId,
    surface,
    startX:event.clientX,
    startY:event.clientY,
    active:false
  };
}

function openTimelineBooking(stage, event) {
  if (!requireBookingWrites()) return;
  const time = timelineTimeFromClick(stage, event);
  if (!time) return;
  openTimelineBookingAtTime(time);
}

function openTimelineBookingAtTime(time) {
  if (!requireBookingWrites() || !time) return;
  const selectedStart = new Date(`${selectedDate}T${time}:00`);
  openNewBookingSheet(time, { date:selectedDate, historical:selectedStart < new Date() });
}

function timelineKeyboardMinute(stage) {
  const start = Number(stage.dataset.timelineStart || 0);
  const end = Math.max(start, Number(stage.dataset.timelineEnd || start) - 5);
  const stored = Number(stage.dataset.timelineKeyboardMinute);
  return Math.max(start, Math.min(end, Number.isFinite(stored) ? stored : start));
}

function setTimelineKeyboardMinute(stage, minute) {
  const start = Number(stage.dataset.timelineStart || 0);
  const end = Math.max(start, Number(stage.dataset.timelineEnd || start) - 5);
  const value = Math.max(start, Math.min(end, minute));
  const time = timeFromMinutes(value);
  stage.dataset.timelineKeyboardMinute = String(value);
  stage.setAttribute('aria-valuenow', String(value));
  stage.setAttribute('aria-valuetext', time);
  return time;
}

document.addEventListener('keydown', event => {
  const stage = event.target.closest?.('[data-create-booking-at]');
  if (!stage) return;
  const current = timelineKeyboardMinute(stage);
  const moves = { ArrowLeft:-5, ArrowDown:-5, ArrowRight:5, ArrowUp:5, PageDown:-30, PageUp:30 };
  if (Object.hasOwn(moves, event.key)) {
    event.preventDefault();
    setTimelineKeyboardMinute(stage, current + moves[event.key]);
    return;
  }
  if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault();
    const target = event.key === 'Home'
      ? Number(stage.dataset.timelineStart || 0)
      : Number(stage.dataset.timelineEnd || 0) - 5;
    setTimelineKeyboardMinute(stage, target);
    return;
  }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    openTimelineBookingAtTime(setTimelineKeyboardMinute(stage, current));
  }
});

function bookingClientNote(item) {
  return String(clientNotes.get(normalizePhone(item?.client_phone)) || '').trim();
}

function bookingDisplayNote(item) {
  return isScheduleBlock(item)
    ? String(item?.provider_note || bookingNotes.get(item?.id) || '').trim()
    : bookingClientNote(item);
}

function bookingSeriesMarkup(item) {
  const occurrence = Number(item?.series_occurrence || 0);
  const storedTotal = Number(item?.booking_series?.occurrence_count || 0);
  const total = item?.series_id
    ? Math.max(storedTotal, occurrence, ...allBookings.filter(entry => entry.series_id === item.series_id).map(entry => Number(entry.series_occurrence || 0)))
    : 0;
  return item?.series_id && occurrence > 0
    ? `<span class="booking-series-badge">Серия · визит ${occurrence}${total > 1 ? ` из ${total}` : ''}</span>`
    : '';
}

function actionableSeriesBookings(item, scope = 'all') {
  if (!item?.series_id) return item ? [item] : [];
  return allBookings.filter(entry => entry.series_id === item.series_id
    && entry.status !== 'cancelled'
    && entry.booking_date >= businessTodayIso()
    && bookingOutcome(entry).visit_status === 'scheduled'
    && (scope === 'all'
      || (scope === 'following' && Number(entry.series_occurrence) >= Number(item.series_occurrence))
      || (scope === 'one' && entry.id === item.id)))
    .sort((a, b) => Number(a.series_occurrence) - Number(b.series_occurrence));
}

function seriesBookingCountLabel(count) {
  const mod100 = count % 100;
  const mod10 = count % 10;
  const word = mod100 >= 11 && mod100 <= 14 ? 'записей' : mod10 === 1 ? 'запись' : mod10 >= 2 && mod10 <= 4 ? 'записи' : 'записей';
  return `${count} ${word}`;
}

function bookingSeriesScopeMarkup(item, name, actionLabel) {
  if (!item?.series_id) return '';
  const following = actionableSeriesBookings(item, 'following').length;
  const all = actionableSeriesBookings(item, 'all').length;
  return `<fieldset class="booking-series-scope"><legend>${escapeHtml(actionLabel)}</legend>
    <label><input type="radio" name="${name}" value="one" checked><span><strong>Только эту запись</strong><small>Остальные визиты не изменятся</small></span></label>
    <label><input type="radio" name="${name}" value="following"><span><strong>Эту и последующие</strong><small>${seriesBookingCountLabel(following)}</small></span></label>
    <label><input type="radio" name="${name}" value="all"><span><strong>Все будущие записи</strong><small>${seriesBookingCountLabel(all)}; прошедшие визиты сохранятся</small></span></label>
  </fieldset>`;
}

function seriesRpcErrorMessage(error, action) {
  const reason = String(error?.message || '');
  if (reason.includes('series_slot_unavailable') || reason.includes('overlap') || reason.includes('resource_unavailable') || reason.includes('booking_buffer_conflict')) {
    return 'Одно из новых времён занято. Серия осталась без изменений.';
  }
  if (reason.includes('series_reschedule_out_of_range')) return 'После переноса часть серии окажется в прошлом или слишком далеко. Выберите более позднюю дату.';
  if (/manage_minuta_booking_series|schema cache|could not find/i.test(reason)) return 'Управление сериями пока не установлено. Сначала примените миграцию v79.';
  return action === 'cancel'
    ? 'Не удалось отменить выбранные записи. Серия осталась без изменений.'
    : 'Не удалось перенести выбранные записи. Серия осталась без изменений.';
}

function stackMinuteTimelineItems(timelineItems, gap = 6) {
  const minuteItems = timelineItems.filter(entry => entry.minuteOnly).sort((a, b) => a.top - b.top || a.index - b.index);
  let previousMinuteBottom = -Infinity;
  minuteItems.forEach(entry => {
    entry.visualTop = Math.max(entry.top, previousMinuteBottom + gap);
    previousMinuteBottom = entry.visualTop + entry.height;
  });
}

function automaticBookingBreaks(items, dateIso = selectedDate) {
  if (!bookingPolicy.booking_buffer_enabled) return [];
  const buffer = Math.min(1440, Math.max(1, Number(bookingPolicy.booking_buffer_minutes) || 60));
  const date = parseLocalIsoDate(dateIso);
  if (!date) return [];
  const weekday = ((date.getDay() + 6) % 7) + 1;
  const schedule = scheduleRows.find(row => Number(row.weekday) === weekday);
  if (schedule?.enabled === false) return [];
  const workStart = minutesFromTime(schedule?.start_time || '10:00');
  const workEnd = minutesFromTime(schedule?.end_time || '20:00');
  if (workEnd <= workStart) return [];
  const active = items.filter(item => item.status !== 'cancelled' && item.booking_date === dateIso);
  const bookings = active.filter(item => !isScheduleBlock(item));
  if (!bookings.length) return [];
  const occupied = active.map(item => {
    const start = minutesFromTime(item.booking_time);
    return [start, start + Math.max(1, Number(item.duration_minutes || item.services?.duration_minutes || 60))];
  });
  const candidates = bookings.flatMap(item => {
    const start = minutesFromTime(item.booking_time);
    const end = start + Math.max(1, Number(item.duration_minutes || item.services?.duration_minutes || 60));
    return [[Math.max(workStart, start - buffer), start], [end, Math.min(workEnd, end + buffer)]];
  }).filter(([start, end]) => end > start);
  const clearSegments = candidates.flatMap(candidate => occupied.reduce((segments, [occupiedStart, occupiedEnd]) => segments.flatMap(([start, end]) => {
    if (occupiedEnd <= start || occupiedStart >= end) return [[start, end]];
    return [[start, Math.min(end, occupiedStart)], [Math.max(start, occupiedEnd), end]].filter(([left, right]) => right > left);
  }), [candidate])).sort((left, right) => left[0] - right[0]);
  const merged = [];
  clearSegments.forEach(([start, end]) => {
    const previous = merged.at(-1);
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
    else merged.push([start, end]);
  });
  return merged.map(([start, end], index) => ({
    id:`automatic-break:${dateIso}:${start}:${end}:${index}`,
    performer_id:currentUser?.id || '',
    booking_date:dateIso,
    booking_time:`${timeFromMinutes(start)}:00`,
    duration_minutes:end - start,
    client_name:'Перерыв',
    client_phone:SCHEDULE_BLOCK_PHONE,
    status:'confirmed',
    automatic_break:true,
    services:{ name:'Перерыв', duration_minutes:end - start }
  }));
}

function renderTimeline(sourceItems) {
  const items = [...sourceItems, ...automaticBookingBreaks(sourceItems)];
  const holder = $('#providerBookings');
  const mobileTimeline = window.matchMedia('(max-width: 760px)').matches;
  const fullBounds = timelineBounds(items);
  let { start, end } = fullBounds;
  const lastBookingEnd = items.reduce((latest, item) => {
    const itemStart = minutesFromTime(item.booking_time);
    const duration = Number(item.duration_minutes || item.services?.duration_minutes || 60);
    return Math.max(latest, itemStart + duration);
  }, start);
  const compactEnd = Math.max(start + 180, Math.ceil((lastBookingEnd + 30) / 60) * 60);
  const timelineWasCompacted = mobileTimeline && !timelineFullDay && fullBounds.end - compactEnd >= 120;
  if (timelineWasCompacted) end = compactEnd;
  const hourHeight = mobileTimeline ? 72 : 76;
  const naturalTimelineHeight = ((end - start) / 60) * hourHeight;
  const timelineItems = items.map((item, index) => {
    const itemStart = minutesFromTime(item.booking_time);
    const duration = Number(item.duration_minutes || item.services?.duration_minutes || 60);
    const top = ((itemStart - start) / 60) * hourHeight;
    const naturalHeight = (duration / 60) * hourHeight;
    const minuteOnly = duration <= 1;
    // Реальная высота одной минуты слишком мала для текста. Оставляем точные
    // время и длительность, но даём такой записи безопасную визуальную карточку.
    const height = minuteOnly ? (mobileTimeline ? 44 : 40) : mobileTimeline && duration < 30 ? 24 : Math.max(mobileTimeline ? 30 : 36, naturalHeight - 4);
    return { item, index, duration, top, visualTop:top, height, minuteOnly };
  });
  stackMinuteTimelineItems(timelineItems);
  const totalHeight = Math.max(naturalTimelineHeight, ...timelineItems.map(entry => entry.visualTop + entry.height + 4));
  const labels = [];
  const lines = [];
  for (let minute = start; minute <= end; minute += 60) {
    const label = `${String(Math.floor(minute / 60)).padStart(2, '0')}:00`;
    const top = ((minute - start) / 60) * hourHeight;
    labels.push(`<span class="timeline-hour" style="top:${top}px">${label}</span>`);
    if (minute + 30 < end) labels.push(`<span class="timeline-hour timeline-half-hour" style="top:${top + hourHeight / 2}px">${String(Math.floor(minute / 60)).padStart(2, '0')}:30</span>`);
    lines.push(`<i class="timeline-grid-line" style="top:${top}px" aria-hidden="true"></i>`);
  }
  const cards = timelineItems.map(({ item, duration, visualTop, height, minuteOnly }) => {
    const startTime = String(item.booking_time).slice(0, 5);
    const endTime = timeFromMinutes(minutesFromTime(item.booking_time) + duration);
    const timeRange = `${startTime}–${endTime}`;
    const statusText = bookingStatus(item);
    const statusClass = bookingStatusClass(item);
    // Карточкам до 45 минут нужен компактный двухстрочный макет: обычные
    // внутренние отступы и крупная метка клиента не помещаются в их высоту.
    const compact = height < 54 ? ' compact' : '';
    const block = isScheduleBlock(item);
    const note = bookingDisplayNote(item);
    const visibleNote = displayPreferences.show_notes ? note : '';
    const visitText = block ? '' : bookingVisitSummaryText(item);
    const visitMarkup = block ? '' : bookingVisitSummaryMarkup(item, 'timeline-client-visit');
    const paymentText = block ? '' : bookingPaymentText(item);
    const clientDetails = block ? (item.automatic_break ? 'Автоматический перерыв' : 'Занятое время') : [item.client_name, displayPreferences.show_phone ? item.client_phone : '', visitText, `${duration} мин`].filter(Boolean).join(' · ');
    const clientDetailsMarkup = block
      ? ''
      : `<span class="timeline-client-name">${escapeHtml(item.client_name)}</span>${displayPreferences.show_phone ? `<span class="timeline-client-phone"><span class="timeline-client-phone-separator" aria-hidden="true"> · </span>${escapeHtml(item.client_phone)}</span>` : ''}${visitMarkup ? `<span class="timeline-client-visit-wrap"> · ${visitMarkup}</span>` : ''}<span class="timeline-client-duration"> · ${duration} мин</span>`;
    const ariaDetails = visibleNote ? `${clientDetails}, заметка: ${visibleNote}` : clientDetails;
    const highlightClasses = block ? '' : clientHighlightClasses(item.client_phone);
    const badgeDetails = block || !displayPreferences.show_client_labels ? '' : clientBadgeText(item.client_phone);
    const timelineStatus = block
      ? ''
      : statusClass === 'visited'
      ? `<span class="timeline-booking-status timeline-booking-status-icon"><span aria-hidden="true">${uiIcon('check')}</span><span class="sr-only">Статус: ${escapeHtml(statusText)}</span></span>`
      : `<span class="timeline-booking-status">${escapeHtml(statusText)}</span>`;
    const serviceMarkup = block ? escapeHtml(item.client_name || 'Перерыв') : timelineServiceNameMarkup(item.services?.name || 'Услуга');
    const cardContent = minuteOnly
      ? `<span class="timeline-booking-copy timeline-booking-minute-copy"><strong><span class="timeline-booking-minute-time">${timeRange}</span><span aria-hidden="true"> · </span>${serviceMarkup}</strong></span>`
      : `<span class="timeline-booking-time"><b>${startTime}</b><small>–${endTime}</small></span>
      <span class="timeline-booking-copy"><strong>${serviceMarkup}</strong><span class="timeline-booking-client-row"><small class="timeline-booking-client"><span class="timeline-mobile-time">${timeRange}${block ? '' : ' · '}</span>${clientDetailsMarkup}</small></span>${paymentText ? `<small class="timeline-booking-payment">${escapeHtml(paymentText)}</small>` : ''}${block || !displayPreferences.show_client_labels ? '' : clientBadgeMarkup(item.client_phone, { limit:1 })}${visibleNote ? `<small class="timeline-booking-note"><b>Заметка:</b> ${escapeHtml(visibleNote)}</small>` : ''}</span>
      ${timelineStatus}`;
    const className = `timeline-booking status-${statusClass} color-${bookingColor(item)}${compact}${minuteOnly ? ' minute-only' : ''}${item.automatic_break ? ' automatic-break' : ''}${visibleNote ? ' has-note' : ''}${highlightClasses}${item.id === recentlyCreatedBookingId ? ' booking-created-highlight' : ''}`;
    const ariaLabel = `${escapeHtml(block ? (item.client_name || 'Занятое время') : serviceName(item.services?.name || 'Услуга'))}, с ${startTime} до ${endTime}, ${escapeHtml(ariaDetails)}${badgeDetails ? `, метки клиента: ${escapeHtml(badgeDetails)}` : ''}, статус: ${escapeHtml(item.automatic_break ? 'автоматический перерыв' : statusText)}`;
    return item.automatic_break
      ? `<div class="${className}" data-booking-duration="${duration}" style="top:${visualTop + 2}px;height:${height}px" role="note" aria-label="${ariaLabel}">${cardContent}</div>`
      : `<button class="${className}" type="button" data-open-booking="${item.id}" data-booking-duration="${duration}" style="top:${visualTop + 2}px;height:${height}px" aria-label="${ariaLabel}" title="Зажмите и перетащите, чтобы изменить время">${cardContent}</button>`;
  }).join('');
  const expandTimeline = timelineWasCompacted
    ? `<button class="timeline-day-expand" type="button" data-expand-timeline>Показать весь день до ${timeFromMinutes(fullBounds.end)}</button>`
    : '';
  holder.className = 'provider-bookings timeline-view';
  holder.innerHTML = `<div class="day-timeline" style="--timeline-height:${totalHeight}px;--half-hour-offset:${hourHeight / 2}px"><div class="timeline-hours">${labels.join('')}</div><div class="timeline-stage" data-create-booking-at data-timeline-start="${start}" data-timeline-end="${end}" data-timeline-keyboard-minute="${start}" role="slider" tabindex="0" aria-valuemin="${start}" aria-valuemax="${Math.max(start, end - 5)}" aria-valuenow="${start}" aria-valuetext="${timeFromMinutes(start)}" aria-label="Выбор времени. Стрелками выберите время, Enter создаст запись">${lines.join('')}<span class="timeline-create-hint">${uiIcon('plus')} Нажмите на свободное время</span>${cards || `<div class="timeline-empty-state"><span>${uiIcon('plus')}</span><strong>День свободен</strong><small>Нажмите на нужное время, чтобы записать клиента или поставить перерыв</small></div>`}</div></div>${expandTimeline}`;
}

function renderBookingList(items, emptyMessage = 'На выбранный период всё свободно.') {
  const holder = $('#providerBookings');
  holder.className = 'provider-bookings schedule-list';
  if (!items.length) {
    holder.innerHTML = bookingEmptyMarkup(emptyMessage);
    applyWriteAvailability();
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
    return `<article class="provider-booking status-${statusClass} color-${bookingColor(item)}${block ? '' : clientHighlightClasses(item.client_phone)}${item.id === recentlyCreatedBookingId ? ' booking-created-highlight' : ''}">
      <button class="provider-booking-open" type="button" data-open-booking="${item.id}" aria-label="${escapeHtml(title)}, с ${time} до ${endTime}, ${escapeHtml(details)}. Открыть подробности">
        <span class="booking-time-column"><strong>${time}<small>до ${endTime}</small></strong><span>${dateFormat.format(itemDate)}</span></span>
        <span class="booking-main"><span class="provider-booking-top"><h3>${escapeHtml(title)}</h3><span class="booking-status">${statusText}</span></span>
        ${block ? `<span class="provider-booking-client-line"><strong>Занятое время</strong><span>${duration} мин</span></span>` : `<span class="provider-booking-client-line"><span class="booking-client-name-row"><strong>${escapeHtml(item.client_name)}</strong>${displayPreferences.show_client_labels ? clientBadgeMarkup(item.client_phone, { limit:1 }) : ''}</span>${displayPreferences.show_phone ? `<span class="provider-booking-phone">${phone}</span>` : ''}${visitMarkup}</span>`}
        <span class="provider-booking-signals">${bookingSeriesMarkup(item)}${visibleNote ? `<span class="provider-booking-note-full"><b>Заметка:</b> ${escapeHtml(visibleNote)}</span>` : ''}${Number(item.deposit_amount_rub || 0) > 0 ? `<span class="booking-prepayment-badge status-${escapeHtml(item.payment_status)}">${item.payment_status === 'paid' ? 'Оплачено' : item.payment_status === 'refunded' ? 'Возврат' : 'Ждёт оплаты'}</span>` : ''}${resultSummary ? `<span class="booking-outcome-summary">${escapeHtml(resultSummary)}</span>` : ''}</span></span>
        <span class="provider-booking-chevron" aria-hidden="true">›</span>
      </button>
    </article>`;
  }).join('');
}

function bookingEmptyMarkup(message, extraClass = '') {
  return `<div class="provider-empty schedule-empty${extraClass ? ` ${escapeHtml(extraClass)}` : ''}"><span class="provider-empty-icon">${uiIcon('check')}</span><strong>Записей нет</strong><small>${escapeHtml(message)}</small><button class="primary schedule-empty-create" type="button" data-create-empty-booking>${uiIcon('plus')}<span>Создать запись</span></button></div>`;
}

function focusCreatedBooking(id) {
  recentlyCreatedBookingId = String(id || '');
  if (!recentlyCreatedBookingId) return;
  if (recentlyCreatedBookingTimer) clearTimeout(recentlyCreatedBookingTimer);
  renderBookingData();
  requestAnimationFrame(() => {
    const card = $$('[data-open-booking]').find(item => item.dataset.openBooking === recentlyCreatedBookingId);
    card?.scrollIntoView({ behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block:'center' });
    card?.focus({ preventScroll:true });
  });
  recentlyCreatedBookingTimer = setTimeout(() => {
    recentlyCreatedBookingId = '';
    $$('.booking-created-highlight').forEach(card => card.classList.remove('booking-created-highlight'));
  }, 4200);
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
  const amount = outcome.visit_status === 'completed'
    ? Math.max(0, Number(outcome.amount_rub || 0))
    : Math.max(0, Number(outcome.amount_rub || calculatedAmount));
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
    <div class="booking-sheet-meta"><strong>${String(item.booking_time).slice(0, 5)}</strong><span>${duration} минут</span><span class="booking-status status-${statusClass}">${statusText}</span>${bookingSeriesMarkup(item)}</div>
    <div class="booking-sheet-summary"><div class="booking-sheet-client"><small class="booking-sheet-client-label">Клиент</small>${clientAvatarEditorMarkup(item.client_phone, item.client_name, item.id)}<div class="booking-sheet-client-name"><strong>${escapeHtml(item.client_name)}</strong>${clientBadgeMarkup(item.client_phone, { limit:3, showLabels:true })}</div><a href="tel:${phone}">${escapeHtml(item.client_phone)}</a></div><div class="booking-sheet-price"><small>${isPerMinuteBooking(item) ? 'Тариф' : 'Стоимость'}</small><strong>${isPerMinuteBooking(item) ? `${money(minuteRate)}/мин` : money(bookingSessionTotal(item))}</strong></div></div>
    <div class="booking-sheet-actions booking-repeat-actions"><button class="secondary-button booking-repeat-action" type="button" data-repeat-booking="${item.id}">${uiIcon('refresh')} Повторить запись</button></div>
    <div class="booking-sheet-secondary">
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
    </div>
    ${item.status !== 'cancelled' && !bookingIsCompleted(item) ? `<div class="booking-sheet-actions">${whatsapp ? `<a class="secondary-button whatsapp-action" href="${whatsapp}" target="_blank" rel="noopener noreferrer">WhatsApp</a>` : ''}${item.status === 'new' ? `<button class="primary" type="button" data-booking-status="confirmed" data-booking-id="${item.id}">Подтвердить</button>` : ''}<button class="secondary-button" type="button" data-edit-booking="${item.id}">Перенести</button>${item.series_id ? `<button class="secondary-button danger" type="button" data-cancel-booking-series="${item.id}">Отменить</button>` : ''}</div>` : ''}
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

function openBookingSeriesCancellation(id) {
  const item = allBookings.find(booking => booking.id === id);
  if (!item?.series_id || item.status === 'cancelled' || bookingOutcome(item).visit_status !== 'scheduled') return;
  $('#bookingSheet').classList.remove('booking-sheet-wide');
  $('#bookingSheetContent').innerHTML = `<div class="booking-editor-heading"><button class="booking-editor-back" type="button" data-back-booking="${item.id}">${uiIcon('arrow-left')}<span>К записи</span></button>
    <small class="booking-sheet-kicker">Серия записей</small></div><h2 id="bookingSheetTitle">Какие записи отменить?</h2>
    <form class="booking-editor-form booking-series-cancel-form" id="bookingSeriesCancelForm" data-booking-id="${item.id}">
      ${bookingSeriesScopeMarkup(item, 'cancelBookingSeriesScope', 'Выберите часть серии')}
      <p class="booking-series-warning">Освобождённые окна снова станут доступны клиентам. Прошедшие и завершённые визиты не изменятся.</p>
      <p class="form-error" id="bookingSeriesCancelError" hidden></p>
      <button class="primary danger-primary" type="submit">Отменить выбранные записи</button>
    </form>`;
  $('#bookingSheet').hidden = false;
  document.body.classList.add('booking-sheet-open');
  $('#bookingSeriesCancelForm').addEventListener('submit', cancelBookingSeries);
  applyWriteAvailability();
}

async function cancelBookingSeries(event) {
  event.preventDefault();
  if (!requireWrites()) return;
  const userId = currentUser.id;
  const generation = sessionGeneration;
  const id = event.currentTarget.dataset.bookingId;
  const scope = event.currentTarget.elements.cancelBookingSeriesScope?.value || 'one';
  const button = event.submitter;
  button.disabled = true;
  button.textContent = 'Отменяем…';
  const { data, error } = await db.rpc('manage_minuta_booking_series', {
    p_booking: id,
    p_action: 'cancel',
    p_scope: scope,
    p_date: null,
    p_time: null
  });
  if (!sessionIsCurrent(userId, generation)) return;
  if (error) {
    button.disabled = false;
    button.textContent = 'Отменить выбранные записи';
    showFormError('#bookingSeriesCancelError', seriesRpcErrorMessage(error, 'cancel'));
    return;
  }
  const affected = Array.isArray(data?.affected) ? data.affected : [];
  affected.forEach(entry => notifyTelegramClient(entry.booking_id, 'cancelled'));
  closeBookingSheet();
  await refreshAfterWrite();
  notify(`Отменено: ${seriesBookingCountLabel(Number(data?.affected_count || affected.length))}`);
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
  return services.map(item => `<option value="${item.id}" ${item.id === selectedId ? 'selected' : ''}>${escapeHtml(serviceName(item.name))} · ${Number(item.duration_minutes) === 1 ? `${money(item.price_rub)}/мин · обычно ${serviceDefaultDuration(item.id)} мин` : `${item.duration_minutes} мин · ${money(item.price_rub)}`}</option>`).join('');
}

function normalizePerMinuteDuration(value, fallback = PER_MINUTE_BOOKING_MIN) {
  const parsed = Math.round(Number(value));
  const safe = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(PER_MINUTE_BOOKING_MIN, Math.min(PER_MINUTE_BOOKING_MAX, safe));
}

function selectedNewBookingService() {
  return ownServices.find(item => item.id === $('#newBookingService')?.value && item.active) || null;
}

function newBookingDurationMinutes() {
  const service = selectedNewBookingService();
  if (!service) return 0;
  return Number(service.duration_minutes) === 1
    ? normalizePerMinuteDuration($('#newBookingDuration')?.value)
    : Math.max(1, Number(service.duration_minutes || 60));
}

function updateNewBookingDurationControl({ reset = false } = {}) {
  const holder = $('#newBookingDurationField');
  const input = $('#newBookingDuration');
  const summary = $('#newBookingDurationSummary');
  const service = selectedNewBookingService();
  const perMinute = newBookingMode === 'client' && Number(service?.duration_minutes) === 1;
  if (!holder || !input || !summary) return;
  holder.hidden = !perMinute;
  if (!perMinute) return;
  if (reset) input.value = String(serviceDefaultDuration(service.id));
  const duration = normalizePerMinuteDuration(input.value);
  input.value = String(duration);
  const total = Math.max(0, Math.round(duration * Number(service.price_rub || 0)));
  const start = newBookingTime || newBookingPreferredTime;
  const end = start ? ` · ${start}–${timeFromMinutes(minutesFromTime(start) + duration)}` : '';
  summary.textContent = `${duration} мин · ${money(total)}${end}`;
}

function updateServiceDefaultDurationField(selectSelector, holderSelector, inputSelector) {
  const select = $(selectSelector);
  const holder = $(holderSelector);
  const input = $(inputSelector);
  if (!select || !holder || !input) return;
  const perMinute = Number(select.value) === 1;
  holder.hidden = !perMinute;
  input.required = perMinute;
  if (perMinute) input.value = String(normalizePerMinuteDuration(input.value, 60));
}

function bindServiceDefaultDurationPresets(holderSelector, inputSelector) {
  $$(holderSelector).forEach(button => button.addEventListener('click', () => {
    const input = $(inputSelector);
    if (input) input.value = String(normalizePerMinuteDuration(button.dataset.serviceDefaultDuration, 60));
  }));
}

async function applyPerMinuteBookingTerms(bookingIds, service, durationMinutes) {
  const duration = normalizePerMinuteDuration(durationMinutes);
  if (Number(service?.duration_minutes) !== 1 || duration === 1 || !bookingIds.length) return { ok:true };
  const totalPrice = Math.max(0, Math.round(duration * Number(service.price_rub || 0)));
  for (const bookingId of bookingIds) {
    const { error } = await db.from('bookings').update({
      duration_minutes:duration,
      original_price_rub:Number(service.price_rub || 0),
      total_price_rub:totalPrice
    }).eq('id', bookingId).eq('performer_id', currentUser.id);
    if (error) return { ok:false, error };
    if (sessionItemsRemoteAvailable) {
      const { error:sessionError } = await db.from('booking_session_items').update({ duration_minutes:duration, price_rub:totalPrice })
        .eq('booking_id', bookingId).eq('performer_id', currentUser.id).eq('item_kind', 'primary');
      if (sessionError && !/booking_session_items|schema cache|does not exist/i.test(String(sessionError.message || ''))) return { ok:false, error:sessionError };
    }
  }
  return { ok:true };
}

async function rollbackCreatedBookings(bookingIds) {
  await Promise.all(bookingIds.map(id => db.rpc('provider_delete_booking', { p_booking:id })));
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
      <div class="service-default-duration" id="editServiceDefaultDurationField" ${Number(item.duration_minutes) === 1 ? '' : 'hidden'}><div><label for="editServiceDefaultDuration">Обычная длительность, минут</label><small>Автоматически подставляется при новой записи.</small></div><input id="editServiceDefaultDuration" type="number" inputmode="numeric" min="1" max="480" step="1" value="${serviceDefaultDuration(item.id)}"><div class="service-default-duration-presets"><button type="button" data-edit-service-default-duration="30">30</button><button type="button" data-edit-service-default-duration="45">45</button><button type="button" data-edit-service-default-duration="60">60</button><button type="button" data-edit-service-default-duration="90">90</button></div></div>
      <label class="service-visibility-option"><input id="editServiceActive" type="checkbox" ${item.active ? 'checked' : ''}><span><strong>Показывать в онлайн-записи</strong><small>${item.active ? 'Клиенты могут выбрать эту услугу' : 'Сейчас услуга скрыта от клиентов'}</small></span></label>
      <p class="form-error" id="serviceEditError" hidden></p>
      <div class="service-edit-actions"><button class="secondary-button" type="button" data-close-booking-sheet>Отмена</button><button class="primary" type="submit">Сохранить изменения</button></div>
    </form>`;
  $('#bookingSheet').hidden = false;
  document.body.classList.add('booking-sheet-open');
  $('#serviceEditForm').addEventListener('submit', saveServiceChanges);
  $('#editServiceDuration').addEventListener('change', () => updateServiceDefaultDurationField('#editServiceDuration', '#editServiceDefaultDurationField', '#editServiceDefaultDuration'));
  bindServiceDefaultDurationPresets('[data-edit-service-default-duration]', '#editServiceDefaultDuration');
  setTimeout(() => $('#editServiceName')?.focus(), 0);
}

async function saveServiceChanges(event) {
  event.preventDefault();
  if (!requireWrites()) return;
  clearFormError('#serviceEditError');
  const id = event.currentTarget.dataset.serviceId;
  const name = $('#editServiceName').value.trim();
  const duration = Number($('#editServiceDuration').value);
  const defaultDuration = normalizePerMinuteDuration($('#editServiceDefaultDuration')?.value, serviceDefaultDuration(id));
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
  if (duration === 1) await saveServiceDefaultDuration(id, defaultDuration);
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
  const scope = $('#bookingEditForm')?.elements.editBookingSeriesScope?.value || 'one';
  const movesSeveral = Boolean(item.series_id && scope !== 'one');
  if (!preserveCurrent) bookingEditTime = '';
  holder.innerHTML = '<span>Ищем свободное время…</span>';
  const { data, error } = await getProviderAvailableSlots({ p_service:service, p_start:date, p_end:date, p_ignore_booking:item.id });
  const currentTime = String(item.booking_time).slice(0, 5);
  const times = error ? [] : (data || []).map(slot => String(slot.booking_time).slice(0, 5));
  if (movesSeveral && !times.includes(currentTime)) times.unshift(currentTime);
  if (!times.length) {
    holder.innerHTML = '<span>На эту дату свободного времени нет</span>';
    return;
  }
  if (preserveCurrent && service === item.service_id && date === item.booking_date && times.includes(currentTime)) bookingEditTime = currentTime;
  holder.innerHTML = `${movesSeveral ? '<small class="booking-series-slot-hint">Все окна серии будут проверены вместе при сохранении.</small>' : ''}${times.map(time => `<button type="button" class="${time === bookingEditTime ? 'active' : ''}" data-edit-booking-time="${time}">${time}</button>`).join('')}`;
}

function sessionServiceOptions(selectedId = '', allowCustom = false) {
  const custom = allowCustom ? `<option value="" ${selectedId ? '' : 'selected'}>Произвольная услуга</option>` : '';
  return `${custom}${ownServices.map(service => {
    const duration = Math.max(1, Math.round(Number(service.duration_minutes) || 0));
    const price = Math.max(0, Math.round(Number(service.price_rub) || 0));
    const details = duration === 1 ? `${money(price)}/мин` : `${duration} мин · ${money(price)}`;
    return `<option value="${service.id}" ${service.id === selectedId ? 'selected' : ''}>${escapeHtml(serviceName(service.name))} · ${details}</option>`;
  }).join('')}`;
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
      ${block ? '' : bookingSeriesScopeMarkup(item, 'editBookingSeriesScope', 'Какие записи перенести')}
      <p class="form-error" id="bookingEditError" hidden></p>
      <button class="primary" type="submit">Сохранить изменения</button>
    </form>`;
  $('#bookingSheet').hidden = false;
  document.body.classList.add('booking-sheet-open');
  $('#editBookingService').addEventListener('change', () => loadBookingEditSlots(id));
  $('#editBookingDate').addEventListener('change', () => loadBookingEditSlots(id));
  $$('[name="editBookingSeriesScope"]').forEach(control => control.addEventListener('change', () => loadBookingEditSlots(id, true)));
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
  const seriesScope = event.currentTarget.elements.editBookingSeriesScope?.value || 'one';
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
  let error = null;
  let affected = [{ booking_id:id }];
  if (item.series_id && !block) {
    const result = await db.rpc('manage_minuta_booking_series', {
      p_booking: id,
      p_action: 'reschedule',
      p_scope: seriesScope,
      p_date: date,
      p_time: `${bookingEditTime}:00`
    });
    error = result.error;
    if (Array.isArray(result.data?.affected)) affected = result.data.affected;
  } else {
    ({ error } = await db.from('bookings').update(changes).eq('id', id).eq('performer_id', userId));
  }
  if (!sessionIsCurrent(userId, generation)) return;
  if (error) {
    button.disabled = false;
    button.textContent = 'Сохранить изменения';
    showFormError('#bookingEditError', item.series_id && !block ? seriesRpcErrorMessage(error, 'reschedule') : 'Это время уже занято. Выберите другой вариант.');
    await loadBookingEditSlots(id);
    return;
  }
  if (!block) affected.forEach(entry => notifyTelegramClient(entry.booking_id, 'rescheduled'));
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
  const affectedCount = affected.length;
  notify(noteRemoteSaved
    ? (block ? 'Перерыв обновлён' : affectedCount > 1 ? `Перенесено: ${seriesBookingCountLabel(affectedCount)}` : 'Запись обновлена')
    : (block ? 'Перерыв обновлён. Заметка сохранена на этом устройстве' : 'Запись обновлена, но заметку сохранить не удалось'));
  openBookingSheet(id);
}

function offlineCandidateSlots(serviceId, dateIso, requestedDuration = 0) {
  const service = ownServices.find(item => item.id === serviceId && item.active);
  const date = parseLocalIsoDate(dateIso);
  if (!service || !date || dateIso < businessTodayIso()) return [];
  const weekday = ((date.getDay() + 6) % 7) + 1;
  const schedule = scheduleRows.find(row => Number(row.weekday) === weekday);
  if (schedule?.enabled === false) return [];
  const step = scheduleStepForDate(dateIso);
  const duration = Math.max(1, Number(requestedDuration || service.duration_minutes || 60));
  const start = minutesFromTime(schedule?.start_time || '10:00');
  const end = minutesFromTime(schedule?.end_time || '20:00');
  const now = new Date();
  const earliest = dateIso === businessTodayIso() ? (now.getHours() * 60) + now.getMinutes() : start;
  const slots = [];
  for (let minute = start; minute + duration <= end; minute += step) {
    if (minute < earliest) continue;
    const issue = bookingPlacementIssue({ id:'offline-candidate', duration_minutes:duration }, dateIso, minute);
    const queuedConflict = offlineBookingQueue.some(item => {
      if (item.id === editingOfflineBookingId) return false;
      if (item.date !== dateIso) return false;
      const queuedStart = minutesFromTime(item.time);
      const queuedService = ownServices.find(entry => entry.id === item.serviceId);
      const queuedEnd = queuedStart + Math.max(1, Number(item.durationMinutes || queuedService?.duration_minutes || 60));
      return minute < queuedEnd && minute + duration > queuedStart;
    });
    if (!issue && !queuedConflict) slots.push(timeFromMinutes(minute));
  }
  return slots;
}

function newBookingOutsideScheduleLabel(dateIso) {
  const date = parseLocalIsoDate(dateIso);
  if (!date) return 'В рабочем графике нет свободного окна.';
  const weekday = ((date.getDay() + 6) % 7) + 1;
  const schedule = scheduleRows.find(row => Number(row.weekday) === weekday);
  if (schedule?.enabled === false) return 'По рабочему графику на эту дату установлен выходной.';
  if (daysOff.some(entry => entry.off_date === dateIso && entry.all_day)) return 'Эта дата закрыта в исключениях рабочего графика.';
  return 'Свободных окон по рабочему графику не осталось.';
}

function renderNewBookingOutsideSchedulePrompt() {
  const holder = $('#newBookingTimes');
  const date = $('#newBookingDate')?.value;
  if (!holder || !date) return;
  holder.innerHTML = `<div class="booking-outside-schedule-prompt"><span aria-hidden="true">!</span><div><strong>${escapeHtml(newBookingOutsideScheduleLabel(date))}</strong><small>Можно создать ручную запись. День останется закрытым для онлайн-записи клиентов.</small></div><button class="secondary-button" id="newBookingOutsideScheduleButton" type="button">Выбрать время вне графика</button></div>`;
  $('#newBookingOutsideScheduleButton')?.addEventListener('click', enableNewBookingOutsideSchedule);
}

function enableNewBookingOutsideSchedule() {
  const date = $('#newBookingDate')?.value;
  const duration = newBookingDurationMinutes();
  if (!date || !duration) return;
  newBookingOutsideSchedule = true;
  newBookingSlots = [];
  const now = new Date();
  const earliestToday = now.getHours() * 60 + now.getMinutes();
  for (let minute = 0; minute + duration <= 1440; minute += 5) {
    if (date === businessTodayIso() && minute <= earliestToday) continue;
    const issue = bookingPlacementIssue(
      { id:'new-outside-schedule-candidate', duration_minutes:duration },
      date,
      minute,
      { ignoreSchedule:true }
    );
    if (!issue) newBookingSlots.push(timeFromMinutes(minute));
  }
  const preferred = newBookingPreferredTime;
  newBookingTime = preferred && newBookingSlots.includes(preferred) ? preferred : '';
  newBookingHour = String(newBookingTime || preferred || newBookingSlots[0] || '').slice(0, 2);
  if (!newBookingSlots.some(time => time.startsWith(`${newBookingHour}:`))) newBookingHour = newBookingSlots[0]?.slice(0, 2) || '';
  if (newBookingSlots.length) renderNewBookingTimePicker({ outsideSchedule:true });
  else $('#newBookingTimes').innerHTML = '<div class="booking-time-warning">На эту дату нет свободного времени нужной длительности: существующие записи занимают весь доступный интервал.</div>';
  updateNewBookingConnectivity();
  saveNewBookingDraft();
}

async function loadNewBookingSlots() {
  const service = $('#newBookingService')?.value;
  const date = $('#newBookingDate')?.value;
  const holder = $('#newBookingTimes');
  if (!service || !date || !holder) return;
  const preferredTime = newBookingPreferredTime;
  const duration = newBookingDurationMinutes();
  newBookingTime = '';
  newBookingSlots = [];
  newBookingHour = '';
  const historical = newBookingHistoricalMode || date < businessTodayIso();
  if (historical) {
    newBookingHistoricalMode = true;
    const step = 5;
    const now = new Date();
    const latestMinute = date === businessTodayIso() ? now.getHours() * 60 + now.getMinutes() : 1440;
    for (let minute = 0; minute + duration <= 1440; minute += step) {
      if (minute + duration > latestMinute) continue;
      const issue = bookingPlacementIssue(
        { id:'new-historical-booking-candidate', duration_minutes:duration },
        date,
        minute,
        { allowPast:true, ignoreSchedule:true }
      );
      if (!issue) newBookingSlots.push(timeFromMinutes(minute));
    }
    newBookingTime = preferredTime || '';
    if (newBookingTime && !newBookingSlots.includes(newBookingTime)) newBookingTime = '';
    newBookingHour = String(newBookingTime || preferredTime || '10:00').slice(0, 2);
    if (!newBookingSlots.some(time => time.startsWith(`${newBookingHour}:`))) newBookingHour = newBookingSlots[0]?.slice(0, 2) || '';
    if (!navigator.onLine) {
      holder.innerHTML = '<div class="booking-time-warning"><strong>Для записи в прошлом нужен интернет.</strong><br>Сервер проверит права мастера и отсутствие пересечений.</div>';
    } else if (newBookingSlots.length) {
      renderNewBookingTimePicker({ historical:true });
    } else {
      holder.innerHTML = '<span>На эту дату нет свободного времени нужной длительности</span>';
    }
    updateNewBookingConnectivity();
    updateNewBookingDurationControl();
    clearFormError('#newBookingError');
    return;
  }
  if (!navigator.onLine) {
    newBookingSlots = offlineCandidateSlots(service, date, duration);
    // An offline booking is a request that the server will validate after the
    // connection returns. Keep an explicitly selected timeline/draft time even
    // when the cached snapshot cannot offer it as a confirmed free slot.
    newBookingTime = preferredTime || '';
    newBookingHour = String(newBookingTime || newBookingSlots[0] || '').slice(0, 2);
    if (newBookingSlots.length) renderNewBookingTimePicker({ offline:true });
    else if (newBookingTime) holder.innerHTML = `<div class="booking-time-warning"><strong>${escapeHtml(newBookingTime)} сохранится как отложенный запрос.</strong><br>После подключения сервер проверит время: свободное окно будет создано, а при конфликте запись останется в очереди с кнопкой «Изменить».</div>`;
    else holder.innerHTML = '<div class="booking-time-warning">По последней сохранённой копии свободных вариантов нет. Откройте нужное время из расписания или подключитесь к интернету, чтобы обновить свободные окна.</div>';
    clearFormError('#newBookingError');
    updateNewBookingSubmitCaption();
    return;
  }
  if (newBookingOutsideSchedule) {
    enableNewBookingOutsideSchedule();
    return;
  }
  holder.innerHTML = '<span>Ищем свободное время…</span>';
  const { data, error } = await getProviderAvailableSlots({ p_service:service, p_start:date, p_end:date });
  if (error) {
    holder.innerHTML = '<div class="booking-time-warning">Не удалось проверить рабочий график. Обновите данные и повторите попытку.</div>';
    return;
  }
  if (!data?.length) {
    renderNewBookingOutsideSchedulePrompt();
    return;
  }
  newBookingSlots = data.map(slot => String(slot.booking_time).slice(0, 5)).filter(time => !bookingPlacementIssue({ id:'new-booking-candidate', duration_minutes:duration }, date, minutesFromTime(time)));
  if (!newBookingSlots.length) {
    holder.innerHTML = '<span>На эту дату нет окна нужной длительности</span>';
    return;
  }
  newBookingTime = preferredTime || newBookingSlots[0];
  if (preferredTime && !newBookingSlots.includes(preferredTime)) newBookingTime = '';
  newBookingHour = String(newBookingTime || preferredTime || newBookingSlots[0]).slice(0, 2);
  if (!newBookingSlots.some(time => time.startsWith(`${newBookingHour}:`))) newBookingHour = newBookingSlots[0].slice(0, 2);
  renderNewBookingTimePicker();
  updateNewBookingDurationControl();
  clearFormError('#newBookingError');
}

function renderNewBookingTimePicker({ offline = false, historical = false, outsideSchedule = false } = {}) {
  const holder = $('#newBookingTimes');
  if (!holder || !newBookingSlots.length) return;
  const perMinuteService = newBookingMode === 'client'
    && Number(selectedNewBookingService()?.duration_minutes) === 1;
  if (perMinuteService && !historical) {
    const preferredUnavailable = newBookingPreferredTime && !newBookingSlots.includes(newBookingPreferredTime);
    const duration = newBookingDurationMinutes();
    const minutePrice = Math.max(0, Number(selectedNewBookingService()?.price_rub) || 0);
    const totalPrice = Math.round(minutePrice * duration);
    const startParts = String(newBookingTime || '').split(':').map(Number);
    const endMinutes = startParts.length === 2 && startParts.every(Number.isFinite)
      ? startParts[0] * 60 + startParts[1] + duration
      : null;
    const endTime = endMinutes === null
      ? ''
      : `${String(Math.floor(endMinutes / 60) % 24).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;
    const selectionSummary = newBookingTime
      ? `<div class="booking-time-selection-summary"><div><strong>Запись: ${newBookingTime}–${endTime}</strong><span>${duration} мин × ${new Intl.NumberFormat('ru-RU').format(minutePrice)} ₽</span></div><div><span>Итого</span><strong>${new Intl.NumberFormat('ru-RU').format(totalPrice)} ₽</strong></div></div>`
      : '';
    holder.innerHTML = `${outsideSchedule ? '<div class="booking-time-warning booking-time-outside"><strong>Запись вне графика</strong><br>Она будет видна в расписании, но не откроет этот день для клиентов.</div>' : offline ? `<div class="booking-time-warning">${newBookingPreferredTime || newBookingTime || 'Выбранное время'} сохранится как отложенный запрос. Сервер проверит его после подключения.</div>` : ''}${preferredUnavailable ? `<div class="booking-time-warning">Ранее выбранное время ${newBookingPreferredTime} сейчас недоступно. Выберите другое.</div>` : ''}<div class="booking-time-guide"><strong>Выберите время</strong><span>${newBookingSlots.length} свободных вариантов · шаг ${outsideSchedule ? 5 : scheduleStepForDate($('#newBookingDate')?.value)} минут</span></div>
      <div class="booking-time-slots booking-time-slots-all">${newBookingSlots.map(time => `<button type="button" class="${time === newBookingTime ? 'active' : ''}" data-new-booking-time="${time}">${time}</button>`).join('')}</div>${selectionSummary}`;
    return;
  }
  const hours = [...new Set(newBookingSlots.map(time => time.slice(0, 2)))];
  if (!hours.includes(newBookingHour)) newBookingHour = hours[0];
  const hourSlots = newBookingSlots.filter(time => time.startsWith(`${newBookingHour}:`));
  const preferredUnavailable = newBookingPreferredTime && !newBookingSlots.includes(newBookingPreferredTime);
  holder.innerHTML = `${outsideSchedule ? '<div class="booking-time-warning booking-time-outside"><strong>Запись вне графика</strong><br>Онлайн-запись на этот день останется закрытой.</div>' : historical ? '<div class="booking-time-warning"><strong>Запись в прошлом</strong><br>Укажите фактическое время визита. После создания отметьте результат и оплату.</div>' : offline ? '<div class="booking-time-warning">Предварительные варианты из последней сохранённой копии. После подключения система обязательно проверит выбранное время на сервере.</div>' : ''}${preferredUnavailable ? `<div class="booking-time-warning">Ранее выбранное время ${escapeHtml(newBookingPreferredTime)} пересекается с другой записью. Выберите другое.</div>` : ''}<div class="booking-time-guide"><strong>1. Выберите час</strong><span>${historical || outsideSchedule ? `${outsideSchedule ? 'Вне графика' : 'Фактическое время'} · шаг 5 минут` : `Шаг записи — ${scheduleStepForDate($('#newBookingDate')?.value)} минут`}</span></div>
    <div class="booking-time-hours">${hours.map(hour => `<button type="button" class="${hour === newBookingHour ? 'active' : ''}" data-new-booking-hour="${hour}">${hour}:00</button>`).join('')}</div>
    <div class="booking-time-guide"><strong>2. Точное время</strong><span>${newBookingTime ? `Выбрано ${newBookingTime}` : `${hourSlots.length} свободных вариантов`}</span></div>
    <div class="booking-time-slots">${hourSlots.map(time => `<button type="button" class="${time === newBookingTime ? 'active' : ''}" data-new-booking-time="${time}">${time}</button>`).join('')}</div>`;
}

function updateNewBookingSubmitCaption() {
  const submit = $('#newBookingSubmit');
  if (!submit) return;
  const occurrenceCount = Math.max(1, Number($('#newBookingOccurrences')?.value || 1));
  const historicalOffline = newBookingHistoricalMode && !navigator.onLine;
  submit.textContent = editingOfflineBookingId ? 'Сохранить исправление' : newBookingHistoricalMode ? 'Добавить прошедший визит' : !navigator.onLine && newBookingMode === 'client' ? 'Сохранить до подключения' : newBookingOutsideSchedule ? (newBookingMode === 'block' ? 'Занять вне графика' : 'Создать вне графика') : newBookingMode === 'block' ? 'Занять время' : occurrenceCount > 1 ? `Создать серию из ${occurrenceCount}` : 'Создать запись';
  submit.disabled = Boolean(!navigator.onLine && newBookingMode === 'client' && !newBookingTime);
  if (historicalOffline) submit.disabled = true;
  submit.title = historicalOffline ? 'Запись в прошлом создаётся только при подключении к интернету' : submit.disabled ? 'Сначала выберите время в расписании' : '';
}

function updateNewBookingConnectivity() {
  if (!$('#newBookingForm')) return;
  const offline = !navigator.onLine;
  const bookingDate = $('#newBookingDate')?.value || '';
  const today = businessTodayIso();
  const historical = bookingDate < today || (bookingDate === today && newBookingHistoricalMode);
  newBookingHistoricalMode = historical;
  const historicalToggle = $('#newBookingHistoricalToggle');
  if (historicalToggle) {
    historicalToggle.setAttribute('aria-pressed', String(historical));
    historicalToggle.classList.toggle('active', historical);
    historicalToggle.disabled = bookingDate < today || bookingDate > today;
    historicalToggle.classList.toggle('is-locked', historicalToggle.disabled);
    const status = historicalToggle.querySelector('b');
    if (status) status.textContent = historical ? 'Включено' : bookingDate > today ? 'Только сегодня' : 'Включить';
  }
  const blockButton = $('[data-new-booking-mode="block"]');
  if (blockButton) {
    blockButton.disabled = offline || historical;
    blockButton.title = historical ? 'В прошлом можно добавить только фактический визит клиента' : offline ? 'Блокировку времени можно создать после подключения' : '';
  }
  const occurrences = $('#newBookingOccurrences');
  const interval = $('#newBookingInterval');
  if (offline || historical) {
    if (newBookingMode === 'block') setNewBookingMode('client');
    if (occurrences) occurrences.value = '1';
  }
  if (occurrences) occurrences.disabled = offline || historical;
  if (interval) interval.disabled = offline || historical;
  const recurrence = $('#newBookingRecurrence');
  if (recurrence) recurrence.classList.toggle('is-offline-disabled', offline || historical);
  const subtitle = $('#newBookingDateTimeSubtitle');
  const timeCaption = $('#newBookingTimeCaption');
  if (subtitle) subtitle.textContent = historical ? 'Укажите фактические дату и время визита' : newBookingOutsideSchedule ? 'Ручная запись без открытия онлайн-записи' : 'Выберите удобное свободное окно';
  if (timeCaption) timeCaption.textContent = historical ? 'Фактическое время' : newBookingOutsideSchedule ? 'Время вне графика' : 'Свободное время';
  updateNewBookingSubmitCaption();
}

let newBookingClientSuggestionMap = new Map();
let newBookingClientSuggestionTimer = null;

function newBookingClientPhoneLabel(phone, fallback = '') {
  const digits = normalizePhone(phone);
  if (digits.length === 11 && digits.startsWith('7')) return `+7 (${digits.slice(1,4)}) ${digits.slice(4,7)}-${digits.slice(7,9)}-${digits.slice(9)}`;
  return fallback || (digits ? `+${digits}` : 'Без телефона');
}

function newBookingClientCandidates(query) {
  const value = String(query || '').trim();
  const textQuery = value.toLocaleLowerCase('ru-RU');
  const phoneQuery = value.replace(/\D/g, '');
  if (textQuery.length < 2 && phoneQuery.length < 2) return [];
  const matches = new Map();
  const sources = [
    ...(Array.isArray(allBookings) ? allBookings : []),
    ...(Array.isArray(importedBookingHistory) ? importedBookingHistory : []),
    ...(typeof importedClients !== 'undefined' && Array.isArray(importedClients) ? importedClients : [])
  ];
  for (const item of sources) {
    const phone = normalizePhone(item?.phone || item?.client_phone || item?.display_phone);
    const name = String(item?.name || item?.client_name || '').trim();
    if (!phone || !name || isScheduleBlock(item)) continue;
    if (!name.toLocaleLowerCase('ru-RU').includes(textQuery) && (!phoneQuery || !phone.includes(phoneQuery))) continue;
    const previous = matches.get(phone) || {};
    matches.set(phone, {
      phone,
      displayPhone:newBookingClientPhoneLabel(phone, item?.display_phone || item?.client_phone || previous.displayPhone),
      name:name || previous.name,
      note:String(item?.note || previous.note || clientNotes.get(phone) || '').trim()
    });
  }
  return [...matches.values()].slice(0, 8);
}

function hideNewBookingClientSuggestions() {
  const panel = $('#newBookingClientSuggestions');
  if (panel) panel.hidden = true;
}

function renderNewBookingClientSuggestions(query) {
  const panel = $('#newBookingClientSuggestions');
  if (!panel) return;
  const clients = newBookingClientCandidates(query);
  newBookingClientSuggestionMap = new Map(clients.map(client => [client.phone, client]));
  if (!clients.length) { panel.hidden = true; panel.innerHTML = ''; return; }
  panel.innerHTML = clients.map(client => `<button type="button" role="option" data-new-booking-client="${escapeHtml(client.phone)}"><span><strong>${escapeHtml(client.name)}</strong><small>${escapeHtml(client.displayPhone)}</small></span><span aria-hidden="true">Выбрать</span></button>`).join('');
  panel.hidden = false;
}

function scheduleNewBookingClientSuggestions(query) {
  clearTimeout(newBookingClientSuggestionTimer);
  newBookingClientSuggestionTimer = setTimeout(() => renderNewBookingClientSuggestions(query), 60);
}

function selectNewBookingClient(phone) {
  const client = newBookingClientSuggestionMap.get(normalizePhone(phone));
  if (!client) return;
  $('#newBookingName').value = client.name;
  $('#newBookingPhone').value = client.displayPhone;
  const note = $('#newBookingNote');
  if (note && !note.value.trim() && client.note) note.value = client.note;
  $('#newBookingSheetTitle').textContent = 'Повторная запись';
  $('#newBookingSectionSubtitle').textContent = 'Клиент найден в базе';
  hideNewBookingClientSuggestions();
  saveNewBookingDraft();
}

function setNewBookingMode(mode) {
  const nextMode = mode === 'block' ? 'block' : 'client';
  const enteringBlock = nextMode === 'block' && newBookingMode !== 'block';
  newBookingMode = nextMode;
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
  $('#newBookingClientNoteField').hidden = block;
  $('#newBookingBlockNoteField').hidden = !block;
  $('#newBookingAdvancedSummary').textContent = block ? 'Заметка и цвет' : 'Заметка, цвет и серия';
  const recurrence = $('#newBookingRecurrence');
  if (recurrence) recurrence.hidden = block;
  $('#newBookingSheetTitle').textContent = block ? 'Занять время' : 'Новый клиент';
  $('#newBookingSectionTitle').textContent = block ? 'Перерыв' : 'Клиент и услуга';
  $('#newBookingSectionSubtitle').textContent = block ? 'Название и длительность' : 'Только необходимое для записи';
  $('#newBookingServiceCaption').textContent = block ? 'Длительность' : 'Услуга';
  const serviceSelect = $('#newBookingService');
  const selectedService = serviceSelect.value;
  const defaultBlockService = enteringBlock
    ? ownServices.find(item => item.active && Number(item.duration_minutes) === 60)?.id || selectedService
    : selectedService;
  serviceSelect.innerHTML = block ? blockDurationOptions(defaultBlockService, true) : serviceOptions(selectedService, true);
  updateNewBookingDurationControl();
  updateNewBookingSubmitCaption();
  clearFormError('#newBookingError');
  loadNewBookingSlots();
}

function openNewBookingSheet(preferredTime = '', preset = {}) {
  const services = ownServices.filter(item => item.active);
  const draft = preset.clientName ? null : readNewBookingDraft();
  const selectedService = services.find(item => item.id === (preset.serviceId || draft?.serviceId)) || services[0];
  const defaultDate = /^\d{4}-\d{2}-\d{2}$/.test(String(selectedDate || '')) ? selectedDate : businessTodayIso();
  const presetDate = /^\d{4}-\d{2}-\d{2}$/.test(String(preset.date || '')) ? preset.date : '';
  const date = presetDate || (/^\d{4}-\d{2}-\d{2}$/.test(String(draft?.date || '')) ? draft.date : defaultDate);
  const initialDuration = normalizePerMinuteDuration(preset.durationMinutes || draft?.durationMinutes || serviceDefaultDuration(selectedService?.id), 60);
  newBookingTime = '';
  newBookingSlots = [];
  newBookingHour = '';
  newBookingPreferredTime = /^\d{2}:\d{2}$/.test(String(preferredTime || draft?.time)) ? String(preferredTime || draft.time) : '';
  const requestedHistorical = Boolean(preset.historical || draft?.historical);
  newBookingHistoricalMode = date < businessTodayIso() || (date === businessTodayIso() && requestedHistorical);
  newBookingOutsideSchedule = !newBookingHistoricalMode && Boolean(draft?.outsideSchedule);
  newBookingMode = draft?.mode === 'block' ? 'block' : 'client';
  $('#bookingSheet').classList.add('booking-sheet-wide', 'new-booking-sheet');
  applyClientHighlightClasses($('#bookingSheet'), '', 'booking-sheet-');
  $('#bookingSheetContent').innerHTML = `<small class="booking-sheet-kicker">${preset.offlineEdit ? 'Отложенная запись' : preset.clientName ? 'Повторный визит' : 'Ручное расписание'}</small><h2 id="bookingSheetTitle"><span id="newBookingSheetTitle">${preset.offlineEdit ? 'Исправить запись' : preset.clientName ? 'Повторная запись' : 'Новый клиент'}</span>${newBookingPreferredTime ? `<small class="booking-clicked-time">Выбрано в расписании: ${escapeHtml(newBookingPreferredTime)}</small>` : ''}</h2>
    ${services.length ? `<form class="booking-editor-form new-booking-form" id="newBookingForm">
      <div class="new-booking-mode-toggle" role="group" aria-label="Тип записи"><button class="active" type="button" data-new-booking-mode="client" aria-pressed="true">Клиент</button><button type="button" data-new-booking-mode="block" aria-pressed="false">Занять время</button></div>
      <div class="new-booking-layout">
        <section class="new-booking-section"><div class="new-booking-section-title"><span>1</span><div><strong id="newBookingSectionTitle">Клиент и услуга</strong><small id="newBookingSectionSubtitle">Только необходимое для записи</small></div></div>
          <div class="new-booking-client-lookup" id="newBookingClientFields"><div class="booking-client-fields"><label>Имя клиента<input id="newBookingName" maxlength="80" autocomplete="off" aria-autocomplete="list" aria-controls="newBookingClientSuggestions" placeholder="Например, Анна" required></label><label>Телефон<input id="newBookingPhone" type="tel" inputmode="tel" autocomplete="off" aria-autocomplete="list" aria-controls="newBookingClientSuggestions" placeholder="+7 (___) ___-__-__" required></label></div><div class="new-booking-client-suggestions" id="newBookingClientSuggestions" role="listbox" aria-label="Найденные клиенты" hidden></div></div>
          <div class="new-booking-block-fields" id="newBookingBlockFields" hidden><label>Название<input id="newBookingBlockTitle" maxlength="80" value="Перерыв" placeholder="Например, Обеденный перерыв"></label><p>Телефон не нужен. Время будет занято для клиентов.</p></div>
          <label><span id="newBookingServiceCaption">Услуга</span><select id="newBookingService" required>${serviceOptions(selectedService?.id || '', true)}</select></label>
          <div class="new-booking-minute-duration" id="newBookingDurationField" hidden>
            <div class="new-booking-minute-heading"><label for="newBookingDuration">Длительность, минут</label><strong id="newBookingDurationSummary" role="status" aria-live="polite"></strong></div>
            <div class="new-booking-minute-input"><button type="button" data-new-booking-duration-step="-1" aria-label="Уменьшить длительность на минуту">−</button><input id="newBookingDuration" type="number" inputmode="numeric" min="${PER_MINUTE_BOOKING_MIN}" max="${PER_MINUTE_BOOKING_MAX}" step="1" value="${initialDuration}" aria-describedby="newBookingDurationSummary" required><button type="button" data-new-booking-duration-step="1" aria-label="Увеличить длительность на минуту">+</button></div>
            <div class="new-booking-minute-presets" aria-label="Быстрый выбор длительности">${[15,30,45,60].map(value => `<button type="button" data-new-booking-duration="${value}">${value} мин</button>`).join('')}</div>
            <small>Можно указать любое точное время от 1 до 480 минут.</small>
          </div>
          <details class="new-booking-advanced" id="newBookingAdvanced"><summary><span>Дополнительные параметры</span><small id="newBookingAdvancedSummary">Заметка, цвет и серия</small></summary><div class="new-booking-advanced-content">
            <label id="newBookingClientNoteField">Заметка о клиенте<textarea id="newBookingNote" maxlength="1000" rows="3" placeholder="Пожелания или важная информация — необязательно"></textarea></label>
            <label id="newBookingBlockNoteField" hidden>Заметка к перерыву<textarea id="newBookingBlockNote" maxlength="1000" rows="2" placeholder="Например, обед или личное дело"></textarea></label>
            ${compactBookingColorPicker('newBookingColor', BOOKING_COLOR_DEFAULT, '')}
            <section class="new-booking-recurrence" id="newBookingRecurrence">
              <div><strong>Курс или серия</strong><small>Все окна должны быть свободны, а последний визит — не дальше двух лет.</small></div>
              <label>Количество<select id="newBookingOccurrences"><option value="1">Одна запись</option><option value="2">2 визита</option><option value="3">3 визита</option><option value="4">4 визита</option><option value="6">6 визитов</option><option value="8">8 визитов</option><option value="10">10 визитов</option><option value="12">12 визитов</option><option value="16">16 визитов</option><option value="20">20 визитов</option><option value="24">24 визита</option></select></label>
              <label>Повторять<select id="newBookingInterval"><option value="1">Каждую неделю</option><option value="2">Раз в 2 недели</option><option value="3">Раз в 3 недели</option><option value="4">Раз в 4 недели</option><option value="6">Раз в 6 недель</option><option value="8">Раз в 8 недель</option><option value="12">Раз в 12 недель</option></select></label>
            </section>
          </div></details>
        </section>
        <section class="new-booking-section"><div class="new-booking-section-title"><span>2</span><div><strong>Дата и время</strong><small id="newBookingDateTimeSubtitle">Выберите удобное свободное окно</small></div></div>
          <button class="new-booking-history-option${newBookingHistoricalMode ? ' active' : ''}" id="newBookingHistoricalToggle" type="button" aria-pressed="${newBookingHistoricalMode}"><span><strong>Клиент уже был</strong><small>Добавить фактический визит, в том числе ранее сегодня</small></span><b>${newBookingHistoricalMode ? 'Включено' : 'Включить'}</b></button>
          <label>Дата<input id="newBookingDate" type="date" value="${date}" required></label>
          <label><span id="newBookingTimeCaption">Свободное время</span><div class="booking-editor-times booking-time-picker" id="newBookingTimes"><span>Ищем свободное время…</span></div></label>
        </section>
      </div>
      <p class="new-booking-draft-status" id="newBookingDraftStatus">${draft ? 'Данные формы восстановлены · запись ещё не добавлена' : 'Данные формы сохранятся в этой вкладке · это ещё не запись'}</p><p class="form-error" id="newBookingError" role="alert" aria-live="assertive" hidden></p><button class="primary new-booking-submit" id="newBookingSubmit" type="submit">Создать запись</button>
    </form>` : `<div class="provider-empty booking-sheet-empty"><span class="provider-empty-icon">${uiIcon('plus')}</span><strong>Сначала добавьте услугу</strong><small>После этого можно будет записывать клиентов вручную.</small></div>`}`;
  $('#bookingSheet').hidden = false;
  document.body.classList.add('booking-sheet-open');
  if (!services.length) return;
  $('#newBookingName').value = String(preset.clientName || draft?.name || '');
  $('#newBookingPhone').value = String(preset.clientPhone || draft?.phone || '');
  $('#newBookingNote').value = String(preset.note || draft?.note || (preset.clientPhone ? clientNotes.get(normalizePhone(preset.clientPhone)) : '') || '');
  $('#newBookingBlockTitle').value = String(draft?.blockTitle || 'Перерыв');
  $('#newBookingBlockNote').value = String(draft?.blockNote || '');
  $('#newBookingOccurrences').value = String(draft?.occurrences || '1');
  $('#newBookingInterval').value = String(draft?.interval || '1');
  const draftColor = $(`[name="newBookingColor"][value="${CSS.escape(String(preset.color || draft?.color || BOOKING_COLOR_DEFAULT))}"]`);
  if (draftColor) draftColor.checked = true;
  $$('[data-new-booking-mode]').forEach(button => button.addEventListener('click', () => { setNewBookingMode(button.dataset.newBookingMode); saveNewBookingDraft(); }));
  $('#newBookingService').addEventListener('change', () => { newBookingTime = ''; newBookingPreferredTime = ''; updateNewBookingDurationControl({ reset:true }); saveNewBookingDraft(); loadNewBookingSlots(); });
  $('#newBookingDuration').addEventListener('input', () => updateNewBookingDurationControl());
  $('#newBookingDuration').addEventListener('change', () => { updateNewBookingDurationControl(); saveNewBookingDraft(); loadNewBookingSlots(); });
  $$('[data-new-booking-duration]').forEach(button => button.addEventListener('click', () => {
    $('#newBookingDuration').value = button.dataset.newBookingDuration;
    updateNewBookingDurationControl();
    saveNewBookingDraft();
    loadNewBookingSlots();
  }));
  $$('[data-new-booking-duration-step]').forEach(button => button.addEventListener('click', () => {
    $('#newBookingDuration').value = String(normalizePerMinuteDuration(Number($('#newBookingDuration').value || 1) + Number(button.dataset.newBookingDurationStep || 0)));
    updateNewBookingDurationControl();
    saveNewBookingDraft();
    loadNewBookingSlots();
  }));
  $('#newBookingDate').addEventListener('change', () => { newBookingTime = ''; newBookingPreferredTime = ''; newBookingOutsideSchedule = false; newBookingHistoricalMode = $('#newBookingDate').value < businessTodayIso(); saveNewBookingDraft(); updateNewBookingConnectivity(); loadNewBookingSlots(); });
  $('#newBookingHistoricalToggle').addEventListener('click', event => {
    const dateValue = $('#newBookingDate').value;
    const requested = event.currentTarget.getAttribute('aria-pressed') !== 'true';
    newBookingHistoricalMode = dateValue < businessTodayIso() || (dateValue === businessTodayIso() && requested);
    newBookingTime = '';
    newBookingPreferredTime = '';
    newBookingOutsideSchedule = false;
    updateNewBookingConnectivity();
    saveNewBookingDraft();
    loadNewBookingSlots();
  });
  $('#newBookingOccurrences').addEventListener('change', () => { updateNewBookingSubmitCaption(); saveNewBookingDraft(); });
  $('#newBookingForm').addEventListener('submit', createNewBooking);
  $('#newBookingForm').addEventListener('input', saveNewBookingDraft);
  $('#newBookingForm').addEventListener('change', saveNewBookingDraft);
  [$('#newBookingName'), $('#newBookingPhone')].forEach(input => {
    input.addEventListener('input', () => scheduleNewBookingClientSuggestions(input.value));
    input.addEventListener('focus', () => scheduleNewBookingClientSuggestions(input.value));
    input.addEventListener('keydown', event => {
      if (event.key === 'Escape') hideNewBookingClientSuggestions();
      if (event.key === 'ArrowDown') { const first = $('#newBookingClientSuggestions button'); if (first) { event.preventDefault(); first.focus(); } }
    });
    input.addEventListener('blur', () => setTimeout(hideNewBookingClientSuggestions, 120));
  });
  $('#newBookingClientSuggestions').addEventListener('pointerdown', event => event.preventDefault());
  $('#newBookingClientSuggestions').addEventListener('click', event => {
    const button = event.target.closest('[data-new-booking-client]');
    if (button) selectNewBookingClient(button.dataset.newBookingClient);
  });
  setNewBookingMode(newBookingMode);
  updateNewBookingDurationControl();
  updateNewBookingConnectivity();
  if (preset.clientName) {
    $('#newBookingSheetTitle').textContent = preset.offlineEdit ? 'Исправить запись' : 'Повторная запись';
    $('#newBookingSectionSubtitle').textContent = preset.offlineEdit ? 'Измените данные и снова отправьте на проверку' : 'Клиент и услуга уже выбраны';
  }
  setTimeout(() => (preset.clientName ? $('#newBookingDate') : $('#newBookingName'))?.focus(), 0);
}

function openRepeatBookingFromSheet(id) {
  if (!requireBookingWrites()) return;
  const item = allBookings.find(booking => booking.id === id);
  if (!item || isScheduleBlock(item)) return;
  if (!ownServices.some(service => service.id === item.service_id && service.active)) {
    notify('Эта услуга сейчас отключена. Сначала включите её в разделе «Услуги».');
    return;
  }
  openNewBookingSheet('', {
    clientName: item.client_name,
    clientPhone: item.client_phone,
    serviceId: item.service_id,
    durationMinutes:item.duration_minutes
  });
}

function bookingIdFromRpcResult(value) {
  if (Array.isArray(value)) return bookingIdFromRpcResult(value[0]);
  if (value && typeof value === 'object') return String(value.booking_id || value.id || '');
  const candidate = String(value || '');
  return /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(candidate) ? candidate : '';
}

function findCreatedBooking({ id = '', service, date, time, phone }) {
  const normalizedPhone = normalizePhone(phone);
  return [...allBookings].reverse().find(item => (
    (id && item.id === id)
    || (
      item.service_id === service
      && item.booking_date === date
      && String(item.booking_time).slice(0, 5) === time
      && normalizePhone(item.client_phone) === normalizedPhone
    )
  )) || null;
}

async function loadCreatedBookingDirect(criteria) {
  const userId = currentUser?.id;
  const generation = sessionGeneration;
  if (!userId || !navigator.onLine) return null;
  let query = db.from('bookings')
    .select('id,organization_id,booking_code,request_id,service_id,series_id,series_occurrence,client_name,client_phone,booking_date,booking_time,duration_minutes,original_price_rub,total_price_rub,status,created_at,reschedule_count,deposit_amount_rub,payment_status,payment_url,booking_source,created_by_user_id,created_by_role,services(name,price_rub,duration_minutes)')
    .eq('performer_id', userId)
    .eq('booking_date', criteria.date)
    .eq('booking_time', `${criteria.time}:00`)
    .order('created_at', { ascending:false })
    .limit(5);
  query = criteria.id ? query.eq('id', criteria.id) : query.eq('service_id', criteria.service);
  const { data, error } = await query;
  if (error || !sessionIsCurrent(userId, generation)) return null;
  const item = (data || []).find(candidate => (
    (criteria.id && candidate.id === criteria.id)
    || normalizePhone(candidate.client_phone) === normalizePhone(criteria.phone)
  ));
  if (!item) return null;
  const index = allBookings.findIndex(candidate => candidate.id === item.id);
  if (index >= 0) allBookings[index] = item;
  else allBookings = [...allBookings, item].sort((a, b) => `${a.booking_date}${a.booking_time}${a.id}`.localeCompare(`${b.booking_date}${b.booking_time}${b.id}`));
  renderBookingData();
  void saveProviderCache('bookings', allBookings, userId);
  return item;
}

async function ensureCreatedBookingVisible(criteria) {
  let created = findCreatedBooking(criteria);
  if (created) return created;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt) await new Promise(resolve => setTimeout(resolve, 250));
    created = await loadCreatedBookingDirect(criteria);
    if (created) return created;
  }
  return null;
}

async function createNewBooking(event) {
  event.preventDefault();
  if (!requireBookingWrites()) return;
  const userId = currentUser.id;
  const generation = sessionGeneration;
  const block = newBookingMode === 'block';
  const name = block ? ($('#newBookingBlockTitle').value.trim() || 'Перерыв') : $('#newBookingName').value.trim();
  const phone = block ? SCHEDULE_BLOCK_PHONE : $('#newBookingPhone').value.trim();
  const service = $('#newBookingService').value;
  const serviceModel = ownServices.find(item => item.id === service && item.active);
  const durationMinutes = newBookingDurationMinutes();
  const date = $('#newBookingDate').value;
  const color = $('[name="newBookingColor"]:checked')?.value || BOOKING_COLOR_DEFAULT;
  const occurrenceCount = block ? 1 : Math.max(1, Number($('#newBookingOccurrences')?.value || 1));
  const intervalWeeks = Math.max(1, Number($('#newBookingInterval')?.value || 1));
  const selectedButtonTime = $('[data-new-booking-time].active')?.dataset.newBookingTime || '';
  newBookingTime = newBookingTime || selectedButtonTime;
  const historical = newBookingHistoricalMode || date < businessTodayIso() || (date === businessTodayIso() && newBookingTime && new Date(`${date}T${newBookingTime}:00`) < new Date());
  const validationError = name.length < 2
    ? (block ? 'Укажите название перерыва.' : 'Укажите имя клиента.')
    : (!block && normalizePhone(phone).length < 10)
      ? 'Укажите полный номер телефона.'
      : !service
        ? (block ? 'Выберите длительность.' : 'Выберите услугу.')
        : !durationMinutes
          ? 'Укажите длительность записи.'
        : !date
          ? 'Выберите дату.'
          : !newBookingTime
            ? 'Выберите время записи.'
            : '';
  if (validationError) {
    showFormError('#newBookingError', validationError);
    return;
  }
  if (historical && block) {
    showFormError('#newBookingError', 'В прошлом можно добавить только фактический визит клиента, но не блокировку времени.');
    return;
  }
  if (historical && occurrenceCount > 1) {
    showFormError('#newBookingError', 'В прошлом записи добавляются по одной, чтобы не создать лишние визиты.');
    return;
  }
  if (historical && !navigator.onLine) {
    showFormError('#newBookingError', 'Для записи в прошлом нужен интернет: сервер должен проверить права и пересечения.');
    return;
  }
  const placementIssue = bookingPlacementIssue(
    { id:'new-booking-validation', duration_minutes:durationMinutes, client_phone:phone },
    date,
    minutesFromTime(newBookingTime),
    historical ? { allowPast:true, ignoreSchedule:true } : newBookingOutsideSchedule ? { ignoreSchedule:true } : undefined
  );
  if (placementIssue) {
    showFormError('#newBookingError', `${placementIssue}. Выберите другое время или длительность.`);
    await loadNewBookingSlots();
    return;
  }
  if (newBookingOutsideSchedule && occurrenceCount > 1) {
    showFormError('#newBookingError', 'Вне графика запись создаётся по одной. Для серии сначала откройте рабочий день.');
    return;
  }
  if (occurrenceCount > 1) {
    const lastOccurrence = parseLocalIsoDate(date);
    const seriesLimit = parseLocalIsoDate(businessTodayIso());
    lastOccurrence.setDate(lastOccurrence.getDate() + ((occurrenceCount - 1) * intervalWeeks * 7));
    seriesLimit.setDate(seriesLimit.getDate() + 730);
    if (lastOccurrence > seriesLimit) {
      showFormError('#newBookingError', 'Уменьшите количество или интервал: последний визит должен быть не дальше двух лет.');
      return;
    }
  }
  const button = event.submitter || $('#newBookingSubmit');
  if (!button) return;
  button.disabled = true;
  button.textContent = editingOfflineBookingId ? 'Сохраняем…' : block ? 'Занимаем…' : 'Создаём…';
  const note = block ? ($('#newBookingBlockNote')?.value.trim() || '') : $('#newBookingNote').value.trim();
  if (editingOfflineBookingId) {
    const queued = await queueOfflineBooking({ clientName:name, clientPhone:phone, serviceId:service, serviceName:serviceModel?.name, durationMinutes, date, time:newBookingTime, note, color });
    button.disabled = false;
    updateNewBookingSubmitCaption();
    if (!queued.ok) {
      showFormError('#newBookingError', queued.duplicate ? 'Такая запись уже есть в очереди. Выберите другое время или удалите лишнюю карточку.' : 'Не удалось надёжно сохранить исправление. Данные остались в форме — попробуйте ещё раз.');
      return;
    }
    clearNewBookingDraft(userId);
    closeBookingSheet();
    renderOfflineBookingQueue();
    notify(navigator.onLine ? 'Исправление сохранено · проверяем запись на сервере' : 'Исправление сохранено на устройстве · проверим после подключения');
    if (navigator.onLine) {
      await synchronizeProvider();
      if (bookingCreationReady) await flushOfflineBookings();
    }
    return;
  }
  if (!navigator.onLine) {
    if (block || occurrenceCount > 1) {
      button.disabled = false;
      updateNewBookingSubmitCaption();
      showFormError('#newBookingError', block ? 'Без интернета можно отложить только запись клиента, но не блокировку времени.' : 'Без интернета можно отложить одну запись. Серии создаются после подключения.');
      return;
    }
    const queued = await queueOfflineBooking({ clientName:name, clientPhone:phone, serviceId:service, serviceName:serviceModel?.name, durationMinutes, date, time:newBookingTime, note, color });
    button.disabled = false;
    updateNewBookingSubmitCaption();
    if (!queued.ok) {
      showFormError('#newBookingError', 'Не удалось надёжно сохранить запись на устройстве. Не закрывайте форму и попробуйте ещё раз.');
      return;
    }
    clearNewBookingDraft(userId);
    closeBookingSheet();
    renderOfflineBookingQueue();
    recordConnectionEvent('offline', `Запись на ${date} ${newBookingTime} сохранена до подключения`);
    notify(queued.duplicate ? 'Такая запись уже ожидает подключения' : 'Запись сохранена на устройстве · при подключении проверим время и создадим её');
    return;
  }
  if (historical) {
    const organizationId = organizationController?.getActiveOrganization?.()?.id || '';
    if (!organizationId) {
      button.disabled = false;
      updateNewBookingSubmitCaption();
      showFormError('#newBookingError', 'Не удалось определить организацию. Обновите страницу и попробуйте ещё раз.');
      return;
    }
    const { data, error } = await db.rpc('create_minuta_historical_booking', {
      p_organization:organizationId,
      p_service:service,
      p_date:date,
      p_time:`${newBookingTime}:00`,
      p_duration_minutes:durationMinutes,
      p_client_name:name,
      p_client_phone:phone
    });
    if (!sessionIsCurrent(userId, generation)) return;
    if (error) {
      button.disabled = false;
      updateNewBookingSubmitCaption();
      const reason = String(error.message || '');
      const message = /slot_unavailable|overlap|conflict|exclude/i.test(reason)
        ? 'Это время пересекается с другой записью. Выберите другое.'
        : /historical_booking_denied|service_unavailable|organization_access_denied/i.test(reason)
          ? 'Недостаточно прав для добавления этой записи.'
        : /historical_time_required/i.test(reason)
          ? 'Выбранное время ещё не прошло. Для будущей записи выберите свободное окно.'
          : /invalid_client_data/i.test(reason)
            ? 'Проверьте имя и номер телефона клиента.'
            : /invalid_historical_booking/i.test(reason)
              ? 'Проверьте выбранные услугу, дату и время.'
              : /invalid_historical_duration|invalid_historical_price|invalid_historical_terms/i.test(reason)
                ? 'Проверьте длительность и рассчитанную стоимость записи.'
                : /booking_location_unavailable/i.test(reason)
                  ? 'Не найден активный филиал. Настройте филиал организации и повторите попытку.'
                  : /authentication_required|jwt|session/i.test(reason)
                    ? 'Сессия завершилась. Войдите снова и повторите попытку.'
          : /create_minuta_historical_booking|schema cache|could not find/i.test(reason)
                      ? 'Сервер пока не поддерживает создание записей в прошлом. Обновите страницу или обратитесь к администратору.'
                      : 'Не удалось создать запись в прошлом. Данные сохранены в форме, попробуйте ещё раз.';
      showFormError('#newBookingError', message);
      return;
    }
    const createdId = data?.booking_id || '';
    if (!createdId) {
      button.disabled = false;
      updateNewBookingSubmitCaption();
      showFormError('#newBookingError', 'Сервер не вернул созданную запись. Обновите расписание и проверьте результат.');
      return;
    }
    const normalizedPhone = normalizePhone(phone);
    if (note) {
      await db.from('client_notes').upsert({ performer_id:userId, client_phone:normalizedPhone, note, updated_at:new Date().toISOString() });
      if (!sessionIsCurrent(userId, generation)) return;
      clientNotes.set(normalizedPhone, note);
    }
    await saveBookingColor(createdId, color, { rerender:false });
    selectScheduleDate(date);
    clearNewBookingDraft(userId);
    closeBookingSheet();
    await refreshAfterWrite();
    focusCreatedBooking(createdId);
    notify('Запись в прошлом создана · отметьте результат и оплату');
    return;
  }
  if (occurrenceCount > 1) {
    const { data, error } = await db.rpc('create_minuta_recurring_bookings', {
      p_service: service,
      p_start_date: date,
      p_time: `${newBookingTime}:00`,
      p_client_name: name,
      p_client_phone: phone,
      p_occurrence_count: occurrenceCount,
      p_interval_weeks: intervalWeeks
    });
    if (!sessionIsCurrent(userId, generation)) return;
    if (error) {
      button.disabled = false;
      button.textContent = `Создать серию из ${occurrenceCount}`;
      const reason = String(error.message || '');
      const connectionError = !navigator.onLine || /failed to fetch|network|load failed|timed? out|fetch/i.test(reason);
      if (connectionError) recordConnectionEvent('error', 'Создание серии: связь прервалась');
      const message = connectionError
        ? 'Связь прервалась. Данные остались в форме — подключитесь и нажмите «Создать» ещё раз.'
      : reason.includes('series_slot_unavailable') || reason.includes('slot_unavailable') || reason.includes('booking_buffer_conflict')
        ? 'Одно из времён серии занято записью или автоматическим перерывом. Измените дату, время или интервал.'
        : reason.includes('invalid_recurring_booking')
          ? 'Проверьте количество и интервал: последний визит должен быть не дальше двух лет.'
        : /create_minuta_recurring_bookings|schema cache|could not find/i.test(reason)
          ? 'Серии записей пока не установлены. Сначала примените миграцию v79.'
          : 'Не удалось создать серию. Ни одна запись не была добавлена.';
      showFormError('#newBookingError', message);
      return;
    }
    const normalizedPhone = normalizePhone(phone);
    if (note) {
      await db.from('client_notes').upsert({ performer_id:userId, client_phone:normalizedPhone, note, updated_at:new Date().toISOString() });
      clientNotes.set(normalizedPhone, note);
    }
    const created = Array.isArray(data?.created) ? data.created : [];
    const createdIds = created.map(entry => entry.booking_id).filter(Boolean);
    const adjusted = await applyPerMinuteBookingTerms(createdIds, serviceModel, durationMinutes);
    if (!adjusted.ok) {
      await rollbackCreatedBookings(createdIds);
      button.disabled = false;
      button.textContent = `Создать серию из ${occurrenceCount}`;
      showFormError('#newBookingError', 'Для выбранной длительности одно из окон уже занято. Серия не создана — выберите другое время или длительность.');
      await loadNewBookingSlots();
      return;
    }
    await Promise.all(created.map(entry => db.rpc('set_booking_color', { p_booking:entry.booking_id, p_color:color })));
    selectScheduleDate(date);
    clearNewBookingDraft(userId);
    closeBookingSheet();
    await refreshAfterWrite();
    if (created[0]?.booking_id) focusCreatedBooking(created[0].booking_id);
    notify(`Серия из ${occurrenceCount} записей создана`);
    return;
  }
  const bookingParams = { p_service: service, p_date: date, p_time: `${newBookingTime}:00`, p_client_name: name, p_client_phone: phone };
  let { data:bookingRpcResult, error } = await db.rpc('provider_book_appointment', bookingParams);
  if (!sessionIsCurrent(userId, generation)) return;
  const technicalProviderError = error && (
    ['42501', '42883', 'PGRST202'].includes(String(error.code || ''))
    || /permission denied|could not find the function|does not exist/i.test(String(error.message || ''))
  );
  if (technicalProviderError) {
    ({ data:bookingRpcResult, error } = await db.rpc('book_appointment', bookingParams));
    if (!sessionIsCurrent(userId, generation)) return;
  }
  if (error) {
    button.disabled = false;
    button.textContent = block ? 'Занять время' : 'Создать запись';
    const reason = String(error.message || '');
    const connectionError = !navigator.onLine || /failed to fetch|network|load failed|timed? out|fetch/i.test(reason);
    if (connectionError) recordConnectionEvent('error', 'Создание записи: связь прервалась');
    const message = connectionError
      ? 'Связь прервалась. Данные остались в форме — подключитесь и нажмите «Создать запись» ещё раз.'
      : reason.includes('slot_unavailable') || reason.includes('booking_buffer_conflict')
      ? (reason.includes('booking_buffer_conflict') ? 'Это время попадает в перерыв до или после другой записи. Выберите другое.' : 'Это время уже занято. Выберите другое.')
      : reason.includes('service_unavailable')
        ? 'Услуга недоступна для записи. Обновите список услуг.'
        : reason.includes('invalid_client_data')
        ? (block ? 'Не удалось занять время.' : 'Проверьте имя и номер телефона клиента.')
          : newBookingOutsideSchedule
            ? 'Не удалось создать запись вне графика. Проверьте, что время не пересекается с другой записью.'
            : 'Не удалось создать запись. Обновите страницу и попробуйте ещё раз.';
    if (!connectionError) await loadNewBookingSlots();
    showFormError('#newBookingError', message);
    return;
  }
  let createdBooking = null;
  if (!block && Number(serviceModel?.duration_minutes) === 1 && durationMinutes > 1) {
    const refreshed = await loadBookings({ silent:true });
    createdBooking = refreshed?.ok ? [...allBookings].reverse().find(item => item.service_id === service && item.booking_date === date && String(item.booking_time).slice(0, 5) === newBookingTime && normalizePhone(item.client_phone) === normalizePhone(phone)) : null;
    if (!createdBooking) {
      button.disabled = false;
      button.textContent = 'Создать запись';
      showFormError('#newBookingError', 'Запись создана, но точную длительность не удалось подтвердить. Обновите записи и проверьте её.');
      return;
    }
    const adjusted = await applyPerMinuteBookingTerms([createdBooking.id], serviceModel, durationMinutes);
    if (!adjusted.ok) {
      await rollbackCreatedBookings([createdBooking.id]);
      await loadBookings({ silent:true });
      button.disabled = false;
      button.textContent = 'Создать запись';
      showFormError('#newBookingError', 'Окно не вмещает выбранную длительность. Запись не создана — выберите другое время или длительность.');
      await loadNewBookingSlots();
      return;
    }
  }
  const normalizedPhone = normalizePhone(phone);
  if (!block && note) {
    await db.from('client_notes').upsert({ performer_id: userId, client_phone: normalizedPhone, note, updated_at: new Date().toISOString() });
    if (!sessionIsCurrent(userId, generation)) return;
    clientNotes.set(normalizedPhone, note);
  }
  selectScheduleDate(date);
  clearNewBookingDraft(userId);
  closeBookingSheet();
  await refreshAfterWrite();
  const createdCriteria = { id:bookingIdFromRpcResult(bookingRpcResult), service, date, time:newBookingTime, phone };
  createdBooking ||= findCreatedBooking(createdCriteria);
  createdBooking ||= await ensureCreatedBookingVisible(createdCriteria);
  let blockNoteLocalOnly = false;
  if (createdBooking) {
    await saveBookingColor(createdBooking.id, color, { rerender:false });
    if (block) {
      const remoteSaved = await saveBookingNote(createdBooking.id, note);
      blockNoteLocalOnly = !remoteSaved && Boolean(note);
    }
    focusCreatedBooking(createdBooking.id);
  }
  notify(block
    ? (blockNoteLocalOnly ? 'Перерыв создан. Заметка сохранена на этом устройстве' : 'Время занято')
    : 'Новая запись создана');
}

function closeBookingSheet() {
  editingOfflineBookingId = '';
  newBookingHistoricalMode = false;
  $('#bookingSheet').hidden = true;
  $('#bookingSheet').classList.remove('booking-sheet-wide', 'new-booking-sheet');
  applyClientHighlightClasses($('#bookingSheet'), '', 'booking-sheet-');
  document.body.classList.remove('booking-sheet-open');
}

function calendarRangeTitle(view = calendarView) {
  const range = calendarRange(view);
  const start = parseLocalIsoDate(range.start);
  const end = parseLocalIsoDate(range.end);
  if (view === 'month') return start.toLocaleDateString('ru-RU', { month:'long', year:'numeric' });
  if (view === 'week') {
    const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
    if (sameMonth) return `${start.getDate()}–${end.toLocaleDateString('ru-RU', { day:'numeric', month:'long', year:'numeric' })}`;
    return `${start.toLocaleDateString('ru-RU', { day:'numeric', month:'short' })} — ${end.toLocaleDateString('ru-RU', { day:'numeric', month:'short', year:'numeric' })}`;
  }
  return selectedDate === businessTodayIso()
    ? 'Сегодня'
    : start.toLocaleDateString('ru-RU', { day:'numeric', month:'long', weekday:'long' });
}

function calendarOverviewBookingMarkup(item, compact) {
  const time = String(item.booking_time || '').slice(0, 5);
  const block = isScheduleBlock(item);
  const title = block ? (item.client_name || 'Перерыв') : serviceName(item.services?.name || 'Услуга');
  const client = block ? 'Занятое время' : item.client_name;
  const statusClass = bookingStatusClass(item);
  const paymentText = block ? '' : bookingPaymentText(item);
  const details = `${title}, ${client}, ${time}${paymentText ? `, ${paymentText}` : ''}`;
  return `<button class="calendar-overview-booking status-${statusClass} color-${bookingColor(item)}${item.id === recentlyCreatedBookingId ? ' booking-created-highlight' : ''}" type="button" data-open-booking="${escapeHtml(item.id)}" aria-label="${escapeHtml(details)}. Открыть запись"><time>${escapeHtml(time)}</time><span><strong>${escapeHtml(title)}</strong>${compact ? '' : `<small>${escapeHtml(client)}${paymentText ? ` · ${escapeHtml(paymentText)}` : ''}</small>`}</span></button>`;
}

function calendarWeekTimelineBounds(days, byDate) {
  let start = Infinity;
  let end = -Infinity;
  days.forEach(date => {
    const iso = localIsoDate(date);
    const weekday = ((date.getDay() + 6) % 7) + 1;
    const schedule = scheduleRows.find(row => Number(row.weekday) === weekday);
    if (schedule && schedule.enabled !== false) {
      start = Math.min(start, Math.floor(minutesFromTime(schedule.start_time || '10:00') / 60) * 60);
      end = Math.max(end, Math.ceil(minutesFromTime(schedule.end_time || '20:00') / 60) * 60);
    }
    (byDate.get(iso) || []).forEach(item => {
      const itemStart = minutesFromTime(item.booking_time);
      const duration = Math.max(1, Number(item.duration_minutes || item.services?.duration_minutes || 60));
      start = Math.min(start, Math.floor(itemStart / 60) * 60);
      end = Math.max(end, Math.ceil((itemStart + duration) / 60) * 60);
    });
  });
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { start:10 * 60, end:20 * 60 };
  start = Math.max(0, start);
  end = Math.min(1440, Math.max(start + 60, end));
  return { start, end };
}

function stackWeekTimelineItems(items, gap = 3) {
  let previousBottom = -Infinity;
  items.sort((left, right) => left.top - right.top || left.index - right.index).forEach(entry => {
    entry.visualTop = Math.max(entry.top, previousBottom + gap);
    previousBottom = entry.visualTop + entry.height;
  });
}

function calendarWeekTimelineMarkup(days, byDate, today) {
  const { start, end } = calendarWeekTimelineBounds(days, byDate);
  const hourHeight = 66;
  const height = ((end - start) / 60) * hourHeight;
  const labels = [];
  for (let minute = start; minute <= end; minute += 30) {
    const top = ((minute - start) / 60) * hourHeight;
    labels.push(`<span class="calendar-week-time${minute % 60 ? ' is-half' : ''}" style="top:${top}px">${timeFromMinutes(minute)}</span>`);
  }
  const headers = days.map((date, index) => {
    const iso = localIsoDate(date);
    const fullDate = date.toLocaleDateString('ru-RU', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
    return `<button class="calendar-week-date${iso === today ? ' is-today' : ''}${iso === selectedDate ? ' is-selected' : ''}" type="button" data-calendar-open-date="${iso}" style="grid-column:${index + 2}" ${iso === today ? 'aria-current="date"' : ''} aria-label="${escapeHtml(fullDate)}. Открыть день"><span>${escapeHtml(date.toLocaleDateString('ru-RU', { weekday:'short' }).replace('.', ''))}</span><strong>${date.getDate()}</strong><small>${escapeHtml(date.toLocaleDateString('ru-RU', { month:'short' }).replace('.', ''))}</small></button>`;
  }).join('');
  const columns = days.map((date, index) => {
    const iso = localIsoDate(date);
    const timelineItems = (byDate.get(iso) || []).map((item, itemIndex) => {
      const duration = Math.max(1, Number(item.duration_minutes || item.services?.duration_minutes || 60));
      const top = ((minutesFromTime(item.booking_time) - start) / 60) * hourHeight;
      const naturalHeight = (duration / 60) * hourHeight;
      return { item, index:itemIndex, duration, top, visualTop:top, height:duration <= 1 ? 34 : Math.max(30, naturalHeight - 4), minuteOnly:duration <= 1 };
    });
    stackWeekTimelineItems(timelineItems);
    const cards = timelineItems.map(({ item, duration, visualTop, height:cardHeight }) => {
      const startTime = String(item.booking_time || '').slice(0, 5);
      const endTime = timeFromMinutes(minutesFromTime(startTime) + duration);
      const block = isScheduleBlock(item);
      const title = block ? (item.client_name || 'Перерыв') : serviceName(item.services?.name || 'Услуга');
      const client = block ? 'Занятое время' : item.client_name;
      const statusClass = bookingStatusClass(item);
      const paymentText = block ? '' : bookingPaymentText(item);
      const details = `${title}, ${client}, с ${startTime} до ${endTime}${paymentText ? `, ${paymentText}` : ''}`;
      return `<button class="calendar-week-booking status-${statusClass} color-${bookingColor(item)}${block ? ' is-block' : ''}${cardHeight < 54 ? ' is-compact' : ''}${item.id === recentlyCreatedBookingId ? ' booking-created-highlight' : ''}" type="button" data-open-booking="${escapeHtml(item.id)}" style="top:${visualTop + 2}px;height:${cardHeight}px" aria-label="${escapeHtml(details)}. Открыть запись"><time>${escapeHtml(startTime)}–${escapeHtml(endTime)}</time><strong>${escapeHtml(title)}</strong><small>${escapeHtml(client)}${paymentText ? ` · ${escapeHtml(paymentText)}` : ''}</small></button>`;
    }).join('');
    return `<section class="calendar-week-day-stage${iso === today ? ' is-today' : ''}" style="grid-column:${index + 2}" aria-label="${escapeHtml(date.toLocaleDateString('ru-RU', { weekday:'long', day:'numeric', month:'long' }))}">${cards}</section>`;
  }).join('');
  return `<div class="calendar-week-timeline" aria-label="Недельное расписание по времени"><div class="calendar-week-timeline-grid" style="--calendar-week-height:${height}px;--calendar-week-hour:${hourHeight}px;--calendar-week-half-hour:${hourHeight / 2}px"><div class="calendar-week-axis-head">Время</div>${headers}<div class="calendar-week-axis" aria-hidden="true">${labels.join('')}</div>${columns}</div></div>`;
}

function renderCalendarOverview(view) {
  const holder = $('#providerBookings');
  const range = calendarRange(view);
  const start = parseLocalIsoDate(range.start);
  const end = parseLocalIsoDate(range.end);
  const today = businessTodayIso();
  const visible = allBookings.filter(item => item.status !== 'cancelled' && item.booking_date >= range.start && item.booking_date <= range.end);
  const byDate = new Map();
  visible.forEach(item => {
    if (!byDate.has(item.booking_date)) byDate.set(item.booking_date, []);
    byDate.get(item.booking_date).push(item);
  });
  const days = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) days.push(new Date(cursor));
  const leading = view === 'month' ? (start.getDay() + 6) % 7 : 0;
  const dayCells = [
    ...Array.from({ length:leading }, () => '<div class="calendar-overview-day is-placeholder" aria-hidden="true"></div>'),
    ...days.map(date => {
      const iso = localIsoDate(date);
      const items = byDate.get(iso) || [];
      const limit = view === 'month' ? 2 : items.length;
      const hiddenCount = Math.max(0, items.length - limit);
      const fullDate = date.toLocaleDateString('ru-RU', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
      const monthCount = items.length ? `${items.length} ${items.length === 1 ? 'запись' : items.length < 5 ? 'записи' : 'записей'}` : 'Свободно';
      return `<article class="calendar-overview-day${iso === today ? ' is-today' : ''}${iso === selectedDate ? ' is-selected' : ''}" data-calendar-date="${iso}">
        <button class="calendar-overview-date" type="button" data-calendar-open-date="${iso}" ${iso === today ? 'aria-current="date"' : ''} aria-label="${escapeHtml(fullDate)}. ${view === 'month' ? `${escapeHtml(monthCount)}. ` : ''}Открыть день"><span>${view === 'week' ? escapeHtml(date.toLocaleDateString('ru-RU', { weekday:'short' }).replace('.', '')) : ''}</span><strong>${date.getDate()}</strong>${view === 'week' ? `<small>${escapeHtml(date.toLocaleDateString('ru-RU', { month:'short' }).replace('.', ''))}</small>` : `<small class="calendar-overview-count">${escapeHtml(monthCount)}</small>`}</button>
        <div class="calendar-overview-items">${items.slice(0, limit).map(item => calendarOverviewBookingMarkup(item, view === 'month')).join('')}${hiddenCount ? `<button class="calendar-overview-more" type="button" data-calendar-open-date="${iso}">Ещё ${hiddenCount}</button>` : ''}</div>
      </article>`;
    })
  ];
  const weekdayHeader = view === 'month' ? `<div class="calendar-overview-weekdays" aria-hidden="true">${['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(day => `<span>${day}</span>`).join('')}</div>` : '';
  holder.className = `provider-bookings calendar-overview calendar-overview-${view}`;
  holder.innerHTML = view === 'week'
    ? `${calendarWeekTimelineMarkup(days, byDate, today)}<div class="calendar-overview-grid calendar-week-mobile-list" role="grid" aria-label="${escapeHtml(calendarRangeTitle(view))}">${dayCells.join('')}</div>`
    : `${weekdayHeader}<div class="calendar-overview-grid" role="grid" aria-label="${escapeHtml(calendarRangeTitle(view))}">${dayCells.join('')}</div>`;
  $('#selectedDateTitle').textContent = calendarRangeTitle(view);
  const clientCount = visible.filter(item => !isScheduleBlock(item)).length;
  const blockCount = visible.length - clientCount;
  $('#selectedDateSummary').textContent = [clientCount ? `${clientCount} ${clientCount === 1 ? 'запись' : clientCount < 5 ? 'записи' : 'записей'}` : 'Записей нет', blockCount ? `${blockCount} ${blockCount === 1 ? 'перерыв' : blockCount < 5 ? 'перерыва' : 'перерывов'}` : ''].filter(Boolean).join(' · ');
}

function renderBookings() {
  const holder = $('#providerBookings');
  updateBookingQueryTools();
  $('#selectedDateTitle').textContent = calendarRangeTitle(calendarView);
  if (teamCalendarController?.isTeamMode) {
    $('#selectedDateSummary').textContent = 'Записи выбранной команды';
    if (teamCalendarController.render(holder)) return;
  }
  if (currentFilter === 'day' && calendarView !== 'day') {
    renderCalendarOverview(calendarView);
    return;
  }
  const sourceItems = filteredBookings();
  const items = applyBookingQuery(sourceItems);
  const paginated = currentFilter !== 'day' && items.length > bookingRenderLimit;
  const visibleItems = paginated ? items.slice(0, bookingRenderLimit) : items;
  const clientCount = items.filter(item => !isScheduleBlock(item)).length;
  const blockCount = items.filter(isScheduleBlock).length + (currentFilter === 'day' ? automaticBookingBreaks(items).length : 0);
  const daySummary = [clientCount ? `${clientCount} ${clientCount === 1 ? 'запись' : clientCount < 5 ? 'записи' : 'записей'}` : '', blockCount ? `${blockCount} ${blockCount === 1 ? 'перерыв' : blockCount < 5 ? 'перерыва' : 'перерывов'}` : ''].filter(Boolean).join(' · ');
  $('#selectedDateSummary').textContent = currentFilter === 'day'
    ? (daySummary || 'Свободный день')
    : `${currentFilter === 'upcoming' ? 'Все будущие записи' : 'История записей'}${bookingQueryIsActive() ? ` · найдено ${items.length}` : ''}`;
  if (currentFilter === 'day' && journalMode === 'timeline') renderTimeline(items);
  else {
    renderBookingList(visibleItems, bookingQueryIsActive() ? 'По заданным условиям ничего не найдено.' : 'На выбранный период всё свободно.');
    if (paginated) $('#providerBookings').insertAdjacentHTML('beforeend', `<button class="secondary-button" type="button" data-load-more-bookings>Показать ещё · осталось ${items.length - visibleItems.length}</button>`);
  }
}

function setTeamCalendarMode(active, options = {}) {
  const teamMode = active === true;
  const modeToggle = $('.journal-mode-toggle');
  const filters = $('.booking-filters');
  const createButton = $('#newBookingButton');
  if (modeToggle) modeToggle.hidden = teamMode || currentFilter !== 'day' || calendarView !== 'day';
  if (filters) filters.hidden = teamMode || calendarView !== 'day' || journalMode === 'timeline';
  if (createButton) createButton.hidden = teamMode;
  if (!teamMode) updateJournalModeButtons();
  updateBookingQueryTools();
  if (options.render !== false) renderBookings();
}

function buildClients() {
  const clients = new Map();
  const activeOrganizationId = activeClientOrganizationId;
  const belongsToActiveOrganization = booking => !activeOrganizationId
    || (Boolean(booking?.organization_id) && String(booking.organization_id) === String(activeOrganizationId));
  importedClients.forEach(imported => {
    const phone = normalizePhone(imported.phone || imported.display_phone);
    if (!phone) return;
    clients.set(phone, {
      phone,
      displayPhone:imported.display_phone || imported.phone,
      name:imported.name || 'Клиент',
      bookings:[],
      imported
    });
  });
  importedBookingHistory.forEach(booking => {
    if (!belongsToActiveOrganization(booking)) return;
    const phone = normalizePhone(booking.client_phone);
    if (!phone) return;
    const current = clients.get(phone) || { phone,displayPhone:booking.client_phone,name:booking.client_name,bookings:[] };
    current.name = booking.client_name || current.name;
    current.displayPhone = booking.client_phone || current.displayPhone;
    current.bookings.push(booking);
    clients.set(phone, current);
  });
  allBookings.forEach(booking => {
    if (isScheduleBlock(booking) || !belongsToActiveOrganization(booking)) return;
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
    const aSort = `${aLast?.booking_date || a.imported?.last_visit_on || ''}${aLast?.booking_time || ''}`;
    const bSort = `${bLast?.booking_date || b.imported?.last_visit_on || ''}${bLast?.booking_time || ''}`;
    return bSort.localeCompare(aSort) || a.name.localeCompare(b.name, 'ru');
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
  const visibleClients = filtered.slice(0, clientRenderLimit);
  $('#clientsCount').textContent = String(clients.length);
  if ($('#clientsBadge')) $('#clientsBadge').textContent = String(clients.length);
  if (!filtered.length) {
    $('#clientsList').innerHTML = `<div class="provider-empty compact-empty"><span class="provider-empty-icon">${uiIcon('user')}</span><strong>${clients.length ? 'Ничего не найдено' : 'Клиентов пока нет'}</strong><small>${clients.length ? 'Попробуйте изменить запрос.' : 'Они появятся после первой записи.'}</small></div>`;
    return;
  }
  $('#clientsList').innerHTML = visibleClients.map(client => {
    const upcoming = clientUpcoming(client);
    const activeCount = client.bookings.filter(item => item.status !== 'cancelled').length;
    const knownCount = Math.max(activeCount, Number(client.imported?.visit_count || 0));
    const nextText = upcoming ? `${new Date(`${upcoming.booking_date}T12:00:00`).toLocaleDateString('ru-RU', { day:'numeric', month:'short' })}, ${String(upcoming.booking_time).slice(0,5)}` : 'Нет будущих записей';
    return `<button class="client-list-item ${client.phone === selectedClientPhone ? 'active' : ''}${clientHighlightClasses(client.phone)}" type="button" data-client-phone="${client.phone}"><span class="client-list-avatar">${clientAvatarContent(client.phone, client.name)}</span><span class="client-list-main"><span class="client-list-name-row"><strong>${escapeHtml(client.name)}</strong>${clientBadgeMarkup(client.phone)}</span><small>${escapeHtml(client.displayPhone)}</small><i>${escapeHtml(nextText)}</i></span><b>${knownCount}</b></button>`;
  }).join('') + (filtered.length > visibleClients.length ? `<button class="secondary-button" type="button" data-load-more-clients>Показать ещё · осталось ${filtered.length - visibleClients.length}</button>` : '');
}

function openQuickRepeatForClient(phone = selectedClientPhone) {
  if (!requireBookingWrites()) return;
  const client = buildClients().find(item => item.phone === normalizePhone(phone));
  if (!client) {
    notify('Сначала выберите клиента');
    return;
  }
  const activeServiceIds = new Set(ownServices.filter(item => item.active).map(item => item.id));
  const previousBooking = [...client.bookings]
    .sort((a, b) => `${b.booking_date}${b.booking_time}`.localeCompare(`${a.booking_date}${a.booking_time}`))
    .find(item => activeServiceIds.has(item.service_id));
  if (!previousBooking) {
    openNewBookingSheet('', { clientName:client.name, clientPhone:client.displayPhone });
    return;
  }
  openNewBookingSheet('', {
    clientName:client.name,
    clientPhone:client.displayPhone,
    serviceId:previousBooking.service_id
  });
}

function renderClientDetail(phone) {
  const client = buildClients().find(item => item.phone === phone);
  if (!client) return;
  selectedClientPhone = phone;
  renderClients();
  $('#clientProfileEmpty').hidden = true;
  $('#clientProfileContent').hidden = false;
  $('#clientAvatar').innerHTML = clientAvatarContent(client.phone, client.name);
  const avatarInput = $('#clientAvatarInput');
  const avatarRemove = $('#clientAvatarRemove');
  const avatarAvailable = clientAvatarsRemoteAvailable;
  avatarInput.dataset.clientPhone = client.phone;
  avatarInput.disabled = !avatarAvailable;
  avatarInput.closest('.client-avatar-picker').hidden = !avatarAvailable;
  avatarRemove.dataset.removeClientAvatar = client.phone;
  avatarRemove.hidden = !avatarAvailable || !clientAvatar(client.phone);
  $('#clientName').textContent = client.name;
  $('#clientPhone').textContent = client.displayPhone;
  $('#clientPhone').href = `tel:${client.phone}`;
  $('#clientQuickRepeat').dataset.quickRepeatClient = client.phone;
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
  $('#clientAutomaticLabel').textContent = clientIsNew(client.phone) ? 'Новый клиент' : '';
  clearFormError('#clientLabelsError');
  const now = new Date();
  const visits = client.bookings.filter(item => {
    const outcome = bookingOutcome(item);
    if (outcome.visit_status === 'completed') return true;
    if (outcome.visit_status === 'no_show') return false;
    return item.status !== 'cancelled' && new Date(`${item.booking_date}T${String(item.booking_time).slice(0,8)}`) < now;
  }).length;
  const upcoming = clientUpcoming(client);
  $('#clientVisits').textContent = String(Math.max(visits, Number(client.imported?.visit_count || 0)));
  $('#clientNext').textContent = upcoming ? `${new Date(`${upcoming.booking_date}T12:00:00`).toLocaleDateString('ru-RU',{day:'numeric',month:'short'})} · ${String(upcoming.booking_time).slice(0,5)}` : 'Нет';
  batchBookingsController?.setClient(client);
  clientFieldsController?.setClient(client.phone);
  $('#clientNote').value = clientNotes.get(phone) || client.imported?.note || '';
  $('#repeatDate').value = businessTodayIso();
  $('#repeatDate').min = businessTodayIso();
  repeatTime = '';
  populateRepeatServices();
  loadRepeatSlots();
  const history = [...client.bookings].sort((a,b) => `${b.booking_date}${b.booking_time}`.localeCompare(`${a.booking_date}${a.booking_time}`));
  $('#clientHistory').innerHTML = history.map(item => {
    const status = bookingStatus(item);
    return `<article class="client-history-item status-${bookingStatusClass(item)}"><div><strong>${escapeHtml(serviceName(item.services?.name || 'Услуга'))}</strong><small>${new Date(`${item.booking_date}T12:00:00`).toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'})} · ${String(item.booking_time).slice(0,5)}</small></div><span>${status}</span></article>`;
  }).join('') || '<p class="provider-empty compact-empty">История визитов появится после первой записи в Minuta.</p>';
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
  const { data, error } = await getProviderAvailableSlots({ p_service:service, p_start:date, p_end:date });
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

async function signedClientAvatarUrl(path) {
  const { data, error } = await db.storage.from(CLIENT_AVATAR_BUCKET).createSignedUrl(path, 3600);
  return { url:error ? '' : data?.signedUrl || '', expiresAt:Date.now() + 55 * 60 * 1000 };
}

async function loadClientAvatars() {
  const userId = currentUser?.id;
  const generation = sessionGeneration;
  if (!userId) return { ok:false, optional:true };
  const { data, error } = await db.from('client_avatars').select('client_phone,storage_path,width,height,updated_at').eq('performer_id', userId);
  if (!sessionIsCurrent(userId, generation)) return { ok:false, optional:true, stale:true };
  if (error) {
    clientAvatarsRemoteAvailable = false;
    clientAvatars = new Map();
    renderClients();
    if (selectedClientPhone) renderClientDetail(selectedClientPhone);
    return { ok:false, optional:true };
  }
  const entries = await Promise.all((data || []).map(async item => {
    const clientPhone = normalizePhone(item.client_phone);
    const cached = clientAvatars.get(clientPhone);
    if (cached?.storage_path === item.storage_path && cached.signed_url && cached.signed_url_expires_at > Date.now()) {
      return { ...item, client_phone:clientPhone, signed_url:cached.signed_url, signed_url_expires_at:cached.signed_url_expires_at };
    }
    const signed = await signedClientAvatarUrl(item.storage_path);
    return { ...item, client_phone:clientPhone, signed_url:signed.url, signed_url_expires_at:signed.expiresAt };
  }));
  if (!sessionIsCurrent(userId, generation)) return { ok:false, optional:true, stale:true };
  clientAvatars = new Map(entries.filter(item => item.client_phone).map(item => [item.client_phone, item]));
  clientAvatarsRemoteAvailable = true;
  renderClients();
  if (selectedClientPhone) renderClientDetail(selectedClientPhone);
  return { ok:true, optional:true };
}

async function prepareClientAvatar(file) {
  const image = await decodePortfolioImage(file);
  const sourceWidth = image.width;
  const sourceHeight = image.height;
  const side = Math.min(sourceWidth, sourceHeight);
  const edge = Math.max(1, Math.min(CLIENT_AVATAR_MAX_EDGE, side));
  const sourceX = Math.max(0, (sourceWidth - side) / 2);
  const sourceY = Math.max(0, (sourceHeight - side) / 2);
  const canvas = document.createElement('canvas');
  canvas.width = edge;
  canvas.height = edge;
  const context = canvas.getContext('2d', { alpha:false });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, edge, edge);
  context.drawImage(image, sourceX, sourceY, side, side, 0, 0, edge, edge);
  image.close?.();
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', .84));
  if (!blob || blob.size > CLIENT_AVATAR_OUTPUT_LIMIT) throw new Error('avatar_too_large');
  return { blob, width:edge, height:edge };
}

async function saveClientAvatar(input) {
  const file = input.files?.[0];
  if (!file) return;
  if (!requireWrites() || !clientAvatarsRemoteAvailable) { input.value = ''; return; }
  const phone = normalizePhone(input.dataset.clientPhone);
  if (!phone) { input.value = ''; notify('Не удалось определить клиента'); return; }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { input.value = ''; notify('Выберите фото JPEG, PNG или WebP'); return; }
  if (file.size > CLIENT_AVATAR_INPUT_LIMIT) { input.value = ''; notify('Фото должно быть не больше 8 МБ'); return; }
  const userId = currentUser.id;
  const generation = sessionGeneration;
  const bookingId = input.dataset.bookingId || '';
  const existing = clientAvatar(phone);
  input.disabled = true;
  let path = '';
  try {
    const prepared = await prepareClientAvatar(file);
    if (!sessionIsCurrent(userId, generation)) return;
    path = `${userId}/${phone}/avatar.webp`;
    const { error: uploadError } = await db.storage.from(CLIENT_AVATAR_BUCKET).upload(path, prepared.blob, { contentType:'image/webp', cacheControl:'3600', upsert:true });
    if (!sessionIsCurrent(userId, generation)) return;
    if (uploadError) throw uploadError;
    const { error: saveError } = await db.from('client_avatars').upsert({ performer_id:userId, client_phone:phone, storage_path:path, width:prepared.width, height:prepared.height, updated_at:new Date().toISOString() }, { onConflict:'performer_id,client_phone' });
    if (!sessionIsCurrent(userId, generation)) return;
    if (saveError) {
      if (!existing) await db.storage.from(CLIENT_AVATAR_BUCKET).remove([path]);
      throw saveError;
    }
    const signed = await signedClientAvatarUrl(path);
    if (!sessionIsCurrent(userId, generation)) return;
    clientAvatars.set(phone, { client_phone:phone, storage_path:path, width:prepared.width, height:prepared.height, signed_url:signed.url, signed_url_expires_at:signed.expiresAt });
    renderBookingData();
    if (bookingId && !$('#bookingSheet').hidden) openBookingSheet(bookingId);
    notify(existing ? 'Фото клиента обновлено' : 'Фото клиента добавлено');
  } catch {
    notify('Не удалось сохранить фото. Попробуйте другое изображение.');
  } finally {
    input.value = '';
    input.disabled = false;
    applyWriteAvailability();
  }
}

async function removeClientAvatar(phone, bookingId = '', options = {}) {
  if (!requireWrites() || !clientAvatarsRemoteAvailable) return;
  const normalizedPhone = normalizePhone(phone);
  const existing = clientAvatar(normalizedPhone);
  if (!existing || (options.confirm !== false && !confirm('Удалить фото клиента?'))) return;
  const userId = currentUser.id;
  const generation = sessionGeneration;
  const { error:storageError } = await db.storage.from(CLIENT_AVATAR_BUCKET).remove([existing.storage_path]);
  if (!sessionIsCurrent(userId, generation)) return;
  if (storageError) { notify('Не удалось удалить файл фото клиента'); return; }
  const { error } = await db.from('client_avatars').delete().eq('performer_id', userId).eq('client_phone', normalizedPhone);
  if (!sessionIsCurrent(userId, generation)) return;
  if (error) { notify('Файл удалён, но карточка фото не очистилась. Повторите удаление.'); return; }
  clientAvatars.delete(normalizedPhone);
  renderBookingData();
  if (bookingId && !$('#bookingSheet').hidden) openBookingSheet(bookingId);
  if (!options.silent) notify('Фото клиента удалено');
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
  const { data, error } = await queryAllProviderRows('booking_session_items', 'id,booking_id,position,item_kind,service_id,title,duration_minutes,price_rub,extends_duration', userId, ['booking_id','position','id'], 100000);
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
  let { data, error } = await queryAllProviderRows('booking_outcomes', 'booking_id,visit_status,payment_method,amount_rub,actual_duration_minutes,calculated_amount_rub,completion_source,updated_at', userId, ['booking_id']);
  if (error) ({ data, error } = await queryAllProviderRows('booking_outcomes', 'booking_id,visit_status,payment_method,amount_rub,completion_source,updated_at', userId, ['booking_id']));
  if (error) ({ data, error } = await queryAllProviderRows('booking_outcomes', 'booking_id,visit_status,payment_method,amount_rub,updated_at', userId, ['booking_id']));
  if (!sessionIsCurrent(userId, generation)) return { ok: false, stale: true, optional: true };
  outcomesRemoteAvailable = !error;
  if (error) bookingOutcomes = new Map(Object.entries(local));
  else {
    bookingOutcomes = new Map((data || []).map(item => [item.booking_id, { ...item, completion_source:item.completion_source || local[item.booking_id]?.completion_source || 'manual' }]));
    Object.entries(local).forEach(([id, value]) => { if (!bookingOutcomes.has(id)) bookingOutcomes.set(id, value); });
  }
  renderBookingData();
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
  $('#bookingBufferEnabled').checked = Boolean(bookingPolicy.booking_buffer_enabled);
  $('#bookingBufferMinutes').value = String(Math.min(1440, Math.max(1, Number(bookingPolicy.booking_buffer_minutes) || 60)));
  $('#bookingBufferDuration').hidden = !$('#bookingBufferEnabled').checked;
  $('#depositSettings').hidden = !$('#depositEnabled').checked;
}

async function loadBookingSettings() {
  const userId = currentUser?.id;
  const generation = sessionGeneration;
  if (!userId) return { ok: false, optional: true };
  const [policyResult, templatesResult, marksResult, outboxResult, visitorVisitsResult] = await Promise.all([
    (async () => {
      let result = await db.from('booking_policies').select('cancel_cutoff_hours,reschedule_cutoff_hours,max_reschedules,deposit_enabled,deposit_amount_rub,payment_url_template,auto_complete_visits,visitor_notifications_enabled,booking_buffer_enabled,booking_buffer_minutes').eq('performer_id', userId).maybeSingle();
      if (result.error) result = await db.from('booking_policies').select('cancel_cutoff_hours,reschedule_cutoff_hours,max_reschedules,deposit_enabled,deposit_amount_rub,payment_url_template,auto_complete_visits').eq('performer_id', userId).maybeSingle();
      if (result.error) result = await db.from('booking_policies').select('cancel_cutoff_hours,reschedule_cutoff_hours,max_reschedules,deposit_enabled,deposit_amount_rub,payment_url_template').eq('performer_id', userId).maybeSingle();
      return result;
    })(),
    db.from('notification_templates').select('confirmation,reminder,cancellation').eq('performer_id', userId).maybeSingle(),
    db.from('notification_marks').select('task_key,status').eq('performer_id', userId),
    db.from('notification_outbox').select('id,event_key,booking_id,kind,channel,status,attempts,last_error_code,last_error,next_attempt_at,sent_at,created_at,updated_at').eq('performer_id', userId).order('created_at', { ascending: false }).limit(50),
    (async () => {
      const organizationId = organizationController?.getActiveOrganization?.()?.id || '';
      if (!organizationId) return { data:[], error:null };
      let query = db.from('booking_page_visits').select('id,organization_id,performer_id,session_id,client_name,client_phone,page_name,source_kind,source_label,first_source_label,last_seen_at,created_at').eq('performer_id', userId);
      query = query.eq('organization_id', organizationId);
      let result = await query.gte('last_seen_at', new Date(Date.now() - 86400000).toISOString()).order('last_seen_at', { ascending:false }).limit(20);
      if (result.error) {
        let fallback = db.from('booking_page_visits').select('id,organization_id,performer_id,created_at').eq('performer_id', userId);
        fallback = fallback.eq('organization_id', organizationId);
        result = await fallback.gte('created_at', new Date(Date.now() - 86400000).toISOString()).order('created_at', { ascending:false }).limit(20);
      }
      return result;
    })()
  ]);
  if (!sessionIsCurrent(userId, generation)) return { ok: false, stale: true, optional: true };
  if (!policyResult.error && policyResult.data) bookingPolicy = { ...bookingPolicy, ...policyResult.data, auto_complete_visits:policyResult.data.auto_complete_visits ?? localStorage.getItem(autoCompleteStorageKey(userId)) === 'true' };
  if (!templatesResult.error && templatesResult.data) serverNotificationTemplates = templatesResult.data;
  if (!marksResult.error) serverNotificationMarks = Object.fromEntries((marksResult.data || []).map(item => [item.task_key, item.status]));
  notificationOutboxRemoteAvailable = !outboxResult.error;
  notificationOutbox = outboxResult.error ? [] : (outboxResult.data || []);
  const nextVisitorVisits = visitorVisitsResult.error ? [] : (visitorVisitsResult.data || []);
  visitorVisitsRemoteAvailable = !visitorVisitsResult.error;
  visitorVisits = nextVisitorVisits;
  if (visitorVisitsRemoteAvailable) {
    if (!visitorVisitsInitialized) {
      nextVisitorVisits.forEach(visit => announcedVisitorVisitIds.add(String(visit.id)));
      visitorVisitsInitialized = true;
    } else {
      [...nextVisitorVisits].reverse().forEach(announceVisitorVisit);
    }
  }
  notificationSettingsRemoteAvailable = !policyResult.error && !templatesResult.error && !marksResult.error;
  renderBookingPolicyForm();
  renderBookings();
  renderVisitorNotificationForm();
  renderVisitorVisits();
  renderNotificationTemplates();
  renderNotifications();
  return { ok: notificationSettingsRemoteAvailable, optional: true };
}

async function saveBookingPolicy(event) {
  event.preventDefault();
  if (!requireWrites()) return;
  clearFormError('#bookingPolicyError');
  const depositEnabled = $('#depositEnabled').checked;
  const bookingBufferEnabled = $('#bookingBufferEnabled').checked;
  const bookingBufferMinutes = Math.round(Number($('#bookingBufferMinutes').value) || 0);
  const record = {
    performer_id: currentUser.id,
    cancel_cutoff_hours: Math.round(Number($('#cancelCutoffHours').value)),
    reschedule_cutoff_hours: Math.round(Number($('#rescheduleCutoffHours').value)),
    max_reschedules: Math.round(Number($('#maxReschedules').value)),
    deposit_enabled: depositEnabled,
    deposit_amount_rub: Math.max(0, Math.round(Number($('#depositAmount').value) || 0)),
    payment_url_template: $('#paymentUrlTemplate').value.trim(),
    auto_complete_visits: $('#autoCompleteVisits').checked,
    booking_buffer_enabled: bookingBufferEnabled,
    booking_buffer_minutes: bookingBufferEnabled ? bookingBufferMinutes : (bookingBufferMinutes >= 1 && bookingBufferMinutes <= 1440 ? bookingBufferMinutes : 60)
  };
  if (![record.cancel_cutoff_hours, record.reschedule_cutoff_hours].every(value => value >= 0 && value <= 168) || record.max_reschedules < 0 || record.max_reschedules > 20) {
    showFormError('#bookingPolicyError', 'Проверьте ограничения отмены и переноса.');
    return;
  }
  if (bookingBufferEnabled && (bookingBufferMinutes < 1 || bookingBufferMinutes > 1440)) {
    showFormError('#bookingPolicyError', 'Укажите перерыв от 1 минуты до 24 часов.');
    return;
  }
  const managedCheckoutEnabled = paymentController?.isCheckoutEnabled?.() === true;
  if (depositEnabled && (record.deposit_amount_rub <= 0 || (!/^https:\/\//i.test(record.payment_url_template) && !managedCheckoutEnabled))) {
    showFormError('#bookingPolicyError', 'Для предоплаты укажите сумму и HTTPS-ссылку либо сначала включите ЮKassa в разделе «Платежи».');
    return;
  }
  const button = event.submitter;
  const buttonLabel = button.textContent;
  button.disabled = true;
  button.textContent = 'Сохраняем…';
  let { error } = await db.from('booking_policies').upsert(record, { onConflict: 'performer_id' });
  if (error && !/booking_buffer/i.test(`${error.message || ''} ${error.details || ''}`)) {
    const compatibleRecord = { ...record };
    delete compatibleRecord.auto_complete_visits;
    ({ error } = await db.from('booking_policies').upsert(compatibleRecord, { onConflict:'performer_id' }));
  }
  button.disabled = false;
  button.textContent = buttonLabel;
  if (error) { showFormError('#bookingPolicyError', /booking_buffer/i.test(`${error.message || ''} ${error.details || ''}`) ? 'Автоматические перерывы ещё не установлены на сервере.' : 'Не удалось сохранить правила.'); return; }
  bookingPolicy = record;
  localStorage.setItem(autoCompleteStorageKey(), String(record.auto_complete_visits));
  renderBookingPolicyForm();
  renderBookings();
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
  if (!requireBookingWrites()) return;
  clearFormError('#repeatBookingError');
  const client = buildClients().find(item => item.phone === selectedClientPhone);
  if (!client || !repeatTime) { showFormError('#repeatBookingError', 'Выберите свободное время.'); return; }
  const button = event.submitter; button.disabled = true; button.textContent = 'Создаём…';
  const { error } = await db.rpc('provider_book_appointment', { p_service: $('#repeatService').value, p_date: $('#repeatDate').value, p_time: `${repeatTime}:00`, p_client_name: client.name, p_client_phone: client.displayPhone });
  button.disabled = false; button.textContent = 'Создать запись';
  if (error) { showFormError('#repeatBookingError', /slot_unavailable|booking_buffer_conflict/.test(error.message || '') ? 'Это время занято записью или автоматическим перерывом. Выберите другое.' : 'Не удалось создать запись.'); await loadRepeatSlots(); return; }
  notify('Повторная запись создана');
  await refreshAfterWrite();
}

function stopLiveUpdates() {
  if (bookingsChannel) db.removeChannel(bookingsChannel);
  bookingsChannel = null;
  clearInterval(syncTimer);
  syncTimer = null;
  clearInterval(visitorPresenceTimer);
  visitorPresenceTimer = null;
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
  let channel = db
    .channel(`provider-bookings-${currentUser.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: `performer_id=eq.${currentUser.id}` }, scheduleBookingsReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'services', filter: `performer_id=eq.${currentUser.id}` }, scheduleBookingsReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'provider_schedule', filter: `performer_id=eq.${currentUser.id}` }, scheduleBookingsReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'provider_days_off', filter: `performer_id=eq.${currentUser.id}` }, scheduleBookingsReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'client_notes', filter: `performer_id=eq.${currentUser.id}` }, scheduleBookingsReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'client_labels', filter: `performer_id=eq.${currentUser.id}` }, scheduleBookingsReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'client_avatars', filter: `performer_id=eq.${currentUser.id}` }, scheduleBookingsReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'booking_outcomes', filter: `performer_id=eq.${currentUser.id}` }, scheduleBookingsReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'booking_session_items', filter: `performer_id=eq.${currentUser.id}` }, scheduleBookingsReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'portfolio_items', filter: `performer_id=eq.${currentUser.id}` }, scheduleBookingsReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'portfolio_photos', filter: `performer_id=eq.${currentUser.id}` }, scheduleBookingsReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'booking_waitlist_requests', filter: `performer_id=eq.${currentUser.id}` }, scheduleBookingsReload);
  if (visitorVisitsRemoteAvailable) channel = channel
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'booking_page_visits', filter: `performer_id=eq.${currentUser.id}` }, handleVisitorVisit)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'booking_page_visits', filter: `performer_id=eq.${currentUser.id}` }, handleVisitorVisit);
  channel = channel.subscribe(status => {
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
  visitorPresenceTimer = setInterval(renderVisitorVisits, 15000);
  syncTimer = setInterval(() => {
    refreshBusinessDay();
    if (!document.hidden && navigator.onLine) synchronizeProvider();
  }, SERVICE_SYNC_INTERVAL_MS);
}

function synchronizeProvider() {
  const requestedGeneration = sessionGeneration;
  if (synchronizationPromise && synchronizationGeneration === requestedGeneration) return synchronizationPromise;
  const synchronizationStartedAt = performance.now();
  const run = (async () => {
    const userId = currentUser?.id;
    const generation = sessionGeneration;
    if (!userId || !navigator.onLine) return false;
    setSyncState('checking', writesAllowed ? 'Проверяем обновления…' : 'Синхронизация…');
    const primaryResults = await Promise.all([
      loadBookings({ silent:true }),
      loadOwnServices({ silent:true }),
      loadSchedule(),
      loadDaysOff(),
      loadBookingSettings()
    ]);
    if (!sessionIsCurrent(userId, generation)) return false;
    const secondaryResults = await Promise.all([
      loadClientNotes(),
      loadClientLabels(),
      loadClientAvatars(),
      loadBookingSessionItems(),
      loadBookingOutcomes(),
      loadPortfolio(),
      loadWaitlist(),
      loadProviderReviews(),
      organizationController.load(),
      teamCalendarController.load()
    ]);
    const results = [...primaryResults, ...secondaryResults];
    if (!sessionIsCurrent(userId, generation)) return false;
    freeSlotsController.refresh();
    const requiredResults = results.filter(result => !result?.optional);
    const complete = requiredResults.every(result => result?.ok);
    const bookingReady = results.slice(0, 4).every(result => result?.ok);
    offlineBookingInputsReady = results.slice(0, 4).every(result => result?.ok || result?.cached);
    const skipped = requiredResults.some(result => result?.skipped);
    const degraded = results.some(result => result?.optional && !result?.ok);
    setBookingCreationReady(bookingReady);
    setWritesAllowed(complete);
    if (complete) {
      clearTimeout(synchronizationRetryTimer);
      synchronizationRetryTimer = null;
      await applyAutomaticVisitOutcomes();
      setSyncState(skipped || degraded ? 'warning' : 'online', skipped ? 'Есть несохранённое расписание · серверная сверка приостановлена' : degraded ? 'Основные данные синхронизированы · дополнительные данные сохранены на этом устройстве' : `Синхронизировано · ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`);
      if (!bookingsChannel) startLiveUpdates();
    } else if (bookingReady) {
      setSyncState('warning', 'Записи и расписание синхронизированы · дополнительные разделы обновятся автоматически');
      if (!bookingsChannel) startLiveUpdates();
      scheduleSynchronizationRetry();
    } else {
      const cached = results.filter(result => result?.cached).map(result => result.savedAt).filter(Boolean).sort()[0];
      const cachedText = cached ? `${navigator.onLine ? 'Не все данные обновлены' : 'Офлайн'} · копия на ${reliability?.savedAtLabel(cached) || 'последнюю синхронизацию'}` : 'Данные не синхронизированы';
      setSyncState(navigator.onLine ? 'warning' : 'offline', !navigator.onLine && canQueueOfflineBooking() ? `${cachedText} · новую запись можно отложить` : `${cachedText} · только чтение`);
      scheduleSynchronizationRetry();
    }
    if (bookingReady && offlineBookingQueue.some(item => item.status === 'pending' || item.status === 'server_check_pending' || item.status === 'notification_pending')) setTimeout(() => flushOfflineBookings(), 0);
    return complete;
  })();
  synchronizationGeneration = requestedGeneration;
  synchronizationPromise = run;
  run.then(
    complete => providerPerformance.measure('provider_sync', synchronizationStartedAt, { complete:Boolean(complete) }),
    () => providerPerformance.measure('provider_sync', synchronizationStartedAt, { complete:false, failed:true })
  );
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

function scheduleSynchronizationRetry() {
  if (synchronizationRetryTimer || !currentUser || !navigator.onLine) return;
  synchronizationRetryTimer = setTimeout(() => {
    synchronizationRetryTimer = null;
    if (currentUser && navigator.onLine) synchronizeProvider();
  }, 8000);
}

async function refreshAfterWrite() {
  if (synchronizationPromise) await synchronizationPromise;
  return synchronizeProvider();
}

async function clearProviderDeviceData(userId, { preserveOfflineBookings = false } = {}) {
  if (!userId) return;
  try { await reliability?.removePrefix(`provider:${userId}:`); } catch {}
  if (!preserveOfflineBookings) {
    await offlineBookingSavePromise.catch(() => {});
    try { await reliability?.remove?.(offlineBookingQueueKey(userId)); } catch {}
  }
  clearNewBookingDraft(userId);
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
        || key === connectionLogKey(userId)
        || key === serviceDurationDefaultsStorageKey(userId)
        || key === autoCompleteStorageKey(userId)) localStorage.removeItem(key);
    });
  } catch {}
}

async function logout() {
  const userId = currentUser?.id;
  if (offlineBookingQueue.length && !confirm(`На устройстве есть ${offlineBookingQueue.length} несинхронизированных записей. При выходе они будут удалены. Всё равно выйти?`)) return;
  ++sessionGeneration;
  window.dispatchEvent(new CustomEvent('minuta:provider-session-reset'));
  bookingsSnapshotSavedAt = '';
  bookingsSnapshotFromCache = false;
  offlineBookingInputsReady = false;
  clearTimeout(displayPreferencesSaveTimer);
  ++displayPreferencesSaveRevision;
  synchronizationQueued = false;
  clearTimeout(synchronizationRetryTimer);
  synchronizationRetryTimer = null;
  stopLiveUpdates();
  setWritesAllowed(false);
  setBookingCreationReady(false);
  await clearProviderDeviceData(userId);
  await db.auth.signOut();
}

async function handleSession(session) {
  if (session?.user?.id && session.user.id === currentUser?.id) {
    currentUser = session.user;
    renderProviderPhoneState();
    renderProviderSocialState();
    return;
  }
  const previousUserId = currentUser?.id;
  const generation = ++sessionGeneration;
  resetReportSessionState();
  window.dispatchEvent(new CustomEvent('minuta:provider-session-reset'));
  window.MinutaProviderOnboarding?.reset();
  bookingsSnapshotSavedAt = '';
  bookingsSnapshotFromCache = false;
  offlineBookingInputsReady = false;
  clearTimeout(displayPreferencesSaveTimer);
  ++displayPreferencesSaveRevision;
  synchronizationQueued = false;
  lastConnectionLogSignature = '';
  clearTimeout(synchronizationRetryTimer);
  synchronizationRetryTimer = null;
  stopLiveUpdates();
  $$('[data-operation-disabled]').forEach(control => {
    control.disabled = false;
    delete control.dataset.operationDisabled;
    if (control.id === 'saveSchedule') control.textContent = 'Сохранить';
  });
  setWritesAllowed(false);
  setBookingCreationReady(false);
  teamCalendarController.reset();
  groupBookingsController.reset();
  paymentController.reset();
  notificationCenterController.reset();
  clientFieldsController.setOrganization(null);
  clientImportController.setOrganization(null);
  organizationController.reset();
  importedClients = [];
  importedBookingHistory = [];
  clientAvatars = new Map();
  clientAvatarsRemoteAvailable = false;
  currentUser = session?.user || null;
  if (currentUser && navigator.onLine && !(await providerAccessAllowed(currentUser.id))) {
    const socialFlow = window.MinutaSocialAuth?.flow();
    if (socialFlow?.mode === 'provider-login') {
      await db.auth.signOut();
      window.MinutaSocialAuth.clearFlow();
    }
    currentUser = null;
    $('#authCard').hidden = false;
    $('#dashboard').hidden = true;
    setAuthTabImmediate('login');
    showFormError('#loginError', socialFlow?.mode === 'provider-login'
      ? 'Этот внешний аккаунт ещё не привязан к кабинету. Войдите по email и привяжите его в настройках.'
      : 'Для этого аккаунта нет доступа к кабинету исполнителя.');
    renderProviderSocialState();
    finishProviderBoot();
    return;
  }
  const completedSocialFlow = window.MinutaSocialAuth?.flow();
  if (currentUser && completedSocialFlow?.mode === 'provider-link') {
    window.MinutaSocialAuth.clearFlow();
    notify(`${window.MinutaSocialAuth.PROVIDERS[completedSocialFlow.provider].label} привязан`);
  } else if (currentUser && completedSocialFlow?.mode === 'provider-login') {
    window.MinutaSocialAuth.clearFlow();
  }
  let displayPreferencesNeedSync = false;
  if (currentUser) {
    loadBookingColors(currentUser.id);
    loadBookingNotes(currentUser.id);
    loadLocalClientLabels(currentUser.id);
    restoreServiceDurationDefaults(currentUser);
    displayPreferencesNeedSync = restoreDisplayPreferences(currentUser).pending;
  } else {
    bookingColors = new Map();
    bookingNotes = new Map();
    pendingBookingNotes = new Set();
    clientLabels = new Map();
    pendingClientLabels = new Set();
    serviceDurationDefaults = {};
    displayPreferences = { ...DEFAULT_DISPLAY_PREFERENCES };
    displayPreferencesUpdatedAt = 0;
    displayPreferencesPending = false;
  }
  applyDisplayPreferences();
  renderDisplayPreferencesForm();
  renderProviderSocialState();
  if (displayPreferencesNeedSync) queueDisplayPreferencesSync();
  scheduleDirty = false;
  if (previousUserId && currentUser?.id && previousUserId !== currentUser.id) await clearProviderDeviceData(previousUserId);
  else if (!currentUser && previousUserId) await clearProviderDeviceData(previousUserId, { preserveOfflineBookings:true });
  if (generation !== sessionGeneration) return;
  clearInterval(notificationTimer);
  notificationTimer = currentUser ? setInterval(renderNotifications, 60000) : null;
  if (currentUser) startTopbarClock();
  else stopTopbarClock();
  if (recoveryMode) { showRecoveryReset(); return; }
  $('#authCard').hidden = Boolean(currentUser);
  $('#dashboard').hidden = !currentUser;
  finishProviderBoot();
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
    clientAvatars = new Map();
    clientAvatarsRemoteAvailable = false;
    pendingClientLabels = new Set();
    bookingOutcomes = new Map();
    bookingSessionItems = new Map();
    sessionItemsRemoteAvailable = false;
    bookingPolicy = { cancel_cutoff_hours: 12, reschedule_cutoff_hours: 12, max_reschedules: 2, deposit_enabled: false, deposit_amount_rub: 0, payment_url_template: '', auto_complete_visits: false, visitor_notifications_enabled: false, booking_buffer_enabled: false, booking_buffer_minutes: 60 };
    serverNotificationTemplates = {};
    serverNotificationMarks = {};
    notificationSettingsRemoteAvailable = false;
    notificationOutbox = [];
    notificationOutboxRemoteAvailable = false;
    visitorVisits = [];
    visitorVisitsRemoteAvailable = false;
    visitorVisitsInitialized = false;
    announcedVisitorVisitIds = new Set();
    offlineBookingQueue = [];
    renderOfflineBookingQueue();
    return;
  }
  const userId = currentUser.id;
  // When the network is available, do not paint the privacy-safe offline copy
  // first: it intentionally contains neither the client's name nor phone and
  // therefore looks like the details disappeared during refresh.
  const cachedBookings = navigator.onLine ? null : await hydrateCachedBookings(userId);
  if (!sessionIsCurrent(userId, generation)) return;
  await hydrateOfflineBookingInputs(userId, generation, cachedBookings);
  if (!sessionIsCurrent(userId, generation)) return;
  await loadOfflineBookingQueue(userId, generation);
  if (!sessionIsCurrent(userId, generation)) return;
  if (cachedBookings) setSyncState(navigator.onLine ? 'checking' : 'offline', navigator.onLine ? `Показана копия на ${reliability?.savedAtLabel(cachedBookings.savedAt) || 'последнюю синхронизацию'} · обновляем` : canQueueOfflineBooking() ? `${cachedStateText(cachedBookings.savedAt)} · новую запись можно отложить` : `${cachedStateText(cachedBookings.savedAt)} · только чтение`);
  else if (!navigator.onLine) setSyncState('offline', 'Нет интернета и сохранённой копии · только чтение');
  let profile = null;
  if (navigator.onLine) ({ data: profile } = await db.from('performer_profiles').select('display_name').eq('id', currentUser.id).single());
  if (!sessionIsCurrent(userId, generation)) return;
  const name = profile?.display_name || 'исполнитель';
  $('#welcomeName').textContent = `Здравствуйте, ${name}!`;
  $('#sidebarName').textContent = name;
  $('#userAvatar').textContent = name.slice(0, 1).toUpperCase();
  $('#accountEmail').textContent = currentUser.email || (currentUser.phone ? (window.MinutaPhoneAuth?.formatPhone(currentUser.phone) || currentUser.phone) : '');
  renderProviderPhoneState();
  renderTopbarDateTime();
  renderDateStrip();
  renderNotificationTemplates();
  renderBookingPolicyForm();
  renderVisitorNotificationForm();
  await providerCacheMaintenance;
  if (!sessionIsCurrent(userId, generation)) return;
  await synchronizeProvider();
  if (!sessionIsCurrent(userId, generation)) return;
  window.MinutaProviderOnboarding?.handleSession({
    db,
    user: currentUser,
    hasServices: ownServices.length > 0,
    refresh: synchronizeProvider,
    onComplete: () => setProviderView('bookings', { historyMode:'replace', focusHeading:true })
  });
  if (navigator.onLine && bookingCreationReady) await flushOfflineBookings();
  if (!sessionIsCurrent(userId, generation)) return;
  if (!bookingsChannel) startLiveUpdates();
  setProviderView(providerViewFromLocation(), { historyMode:'replace', focusHeading:false });
  syncScheduleContextHistory();
}

async function providerAccessAllowed(userId) {
  const capability = await db.rpc('has_minuta_provider_access');
  if (!capability.error) return capability.data === true;
  const membership = await db.from('organization_memberships').select('organization_id').eq('user_id', userId).eq('active', true).limit(1);
  if (!membership.error) return Boolean(membership.data?.length);
  const profile = await db.from('performer_profiles').select('id').eq('id', userId).maybeSingle();
  return !profile.error && Boolean(profile.data?.id);
}

function renderProviderSocialState() {
  const auth = window.MinutaSocialAuth;
  if (!auth) return;
  auth.render(document);
  $$('[data-social-auth-link]').forEach(button => {
    const linked = Boolean(currentUser) && auth.isLinked(currentUser, button.dataset.socialAuthProvider);
    button.classList.toggle('is-linked', linked);
    if (linked) button.disabled = true;
    const state = button.querySelector('[data-social-auth-state]');
    if (state && linked) state.textContent = 'Привязан';
  });
}

async function startProviderSocialLogin(button) {
  clearFormError('#loginError');
  button.disabled = true;
  try {
    await window.MinutaSocialAuth.start(db, button.dataset.socialAuthProvider, 'provider-login', 'provider.html');
  } catch (error) {
    showFormError('#loginError', window.MinutaSocialAuth?.message(error) || 'Не удалось выполнить вход.');
    renderProviderSocialState();
  }
}

async function startProviderSocialLink(button) {
  clearFormError('#providerSocialLinkError');
  if (!currentUser) return;
  button.disabled = true;
  try {
    await window.MinutaSocialAuth.start(db, button.dataset.socialAuthProvider, 'provider-link', 'provider.html?view=settings');
  } catch (error) {
    showFormError('#providerSocialLinkError', window.MinutaSocialAuth?.message(error) || 'Не удалось привязать аккаунт.');
    renderProviderSocialState();
  }
}

function showProviderPhoneLogin() {
  recoveryMode = false;
  $('#authTabs').hidden = true;
  $('#loginForm').hidden = true;
  $('#signupForm').hidden = true;
  $('#recoveryForm').hidden = true;
  $('#resetPasswordForm').hidden = true;
  $('#recoverySent').hidden = true;
  $('#providerPhoneLoginForm').hidden = false;
  $('#authBadge').innerHTML = '<i></i> Вход по телефону';
  $('#authTitle').textContent = 'Код вместо пароля.';
  $('#authDescription').textContent = 'Доступ откроется только для телефона, заранее подтверждённого в кабинете исполнителя.';
  setTimeout(() => $('#providerLoginPhone').focus(), 0);
}

function resetProviderPhoneLogin() {
  providerLoginPhone = '';
  providerLoginCodeRequested = false;
  $('#providerLoginPhone').readOnly = false;
  $('#providerLoginCode').value = '';
  $('#providerLoginCodeStep').hidden = true;
  $('#providerPhoneLoginError').hidden = true;
  $('#providerPhoneLoginSubmit').textContent = 'Получить код';
  setAuthTab('login');
}

function changeProviderLoginPhone() {
  providerLoginPhone = '';
  providerLoginCodeRequested = false;
  $('#providerLoginPhone').readOnly = false;
  $('#providerLoginCode').value = '';
  $('#providerLoginCodeStep').hidden = true;
  $('#providerPhoneLoginError').hidden = true;
  $('#providerPhoneLoginSubmit').textContent = 'Получить код';
  $('#providerLoginPhone').focus();
}

async function resendProviderLoginCode() {
  const button = $('#providerLoginResend');
  button.disabled = true;
  $('#providerPhoneLoginError').hidden = true;
  try {
    await window.MinutaPhoneAuth.request(db, providerLoginPhone, { shouldCreateUser:false });
    notify('Новый код отправлен');
  } catch (error) {
    showFormError('#providerPhoneLoginError', window.MinutaPhoneAuth.message(error, 'request'));
  } finally {
    button.disabled = false;
  }
}

async function submitProviderPhoneLogin(event) {
  event.preventDefault();
  const auth = window.MinutaPhoneAuth;
  const button = $('#providerPhoneLoginSubmit');
  $('#providerPhoneLoginError').hidden = true;
  button.disabled = true;
  try {
    if (!providerLoginCodeRequested) {
      button.textContent = 'Отправляем…';
      providerLoginPhone = await auth.request(db, $('#providerLoginPhone').value, { shouldCreateUser:false });
      providerLoginCodeRequested = true;
      $('#providerLoginPhone').readOnly = true;
      $('#providerLoginCodeStep').hidden = false;
      $('#providerLoginSentTo').textContent = `Код отправлен на ${auth.formatPhone(providerLoginPhone)}`;
      setTimeout(() => $('#providerLoginCode').focus(), 0);
      notify('Код отправлен по SMS');
    } else {
      button.textContent = 'Проверяем…';
      await auth.verify(db, providerLoginPhone, $('#providerLoginCode').value, 'sms');
    }
  } catch (error) {
    showFormError('#providerPhoneLoginError', auth.message(error, providerLoginCodeRequested ? 'verify' : 'request'));
  } finally {
    button.disabled = false;
    button.textContent = providerLoginCodeRequested ? 'Подтвердить код' : 'Получить код';
  }
}

function renderProviderPhoneState() {
  const label = $('#providerLinkedPhone');
  if (!label) return;
  const phone = currentUser?.phone || '';
  label.textContent = phone ? `Подтверждён: ${window.MinutaPhoneAuth?.formatPhone(phone) || phone}` : 'Телефон не привязан';
  if (phone && !providerLinkCodeRequested) $('#providerPhoneLinkInput').value = window.MinutaPhoneAuth?.formatPhone(phone) || phone;
}

async function submitProviderPhoneLink(event) {
  event.preventDefault();
  const auth = window.MinutaPhoneAuth;
  const button = $('#providerPhoneLinkSubmit');
  $('#providerPhoneLinkError').hidden = true;
  button.disabled = true;
  try {
    if (!providerLinkCodeRequested) {
      providerLinkPhone = auth.toE164($('#providerPhoneLinkInput').value);
      button.textContent = 'Отправляем…';
      const { error } = await db.auth.updateUser({ phone:providerLinkPhone });
      if (error) throw error;
      providerLinkCodeRequested = true;
      $('#providerPhoneLinkInput').readOnly = true;
      $('#providerPhoneLinkCodeStep').hidden = false;
      $('#providerPhoneLinkHint').textContent = `Код отправлен на ${auth.formatPhone(providerLinkPhone)}`;
      setTimeout(() => $('#providerPhoneLinkCode').focus(), 0);
    } else {
      button.textContent = 'Проверяем…';
      await auth.verify(db, providerLinkPhone, $('#providerPhoneLinkCode').value, 'phone_change');
      providerLinkCodeRequested = false;
      $('#providerPhoneLinkInput').readOnly = false;
      $('#providerPhoneLinkCodeStep').hidden = true;
      $('#providerPhoneLinkCode').value = '';
      $('#providerPhoneLinkHint').textContent = 'Телефон подтверждён. Теперь по нему можно входить без пароля.';
      const { data } = await db.auth.getUser();
      if (data?.user) currentUser = data.user;
      renderProviderPhoneState();
      notify('Телефон подтверждён');
    }
  } catch (error) {
    showFormError('#providerPhoneLinkError', auth.message(error, providerLinkCodeRequested ? 'verify' : 'request'));
  } finally {
    button.disabled = false;
    button.textContent = providerLinkCodeRequested ? 'Подтвердить код' : currentUser?.phone ? 'Изменить телефон' : 'Привязать телефон';
  }
}

async function initializePhoneAuth() {
  const loginButton = $('#showPhoneLoginButton');
  const linkButton = $('#providerPhoneLinkSubmit');
  if (!window.MinutaPhoneAuth) {
    loginButton.textContent = 'Вход по SMS недоступен';
    linkButton.textContent = 'SMS недоступны';
    return;
  }
  const capability = await window.MinutaPhoneAuth.capability();
  loginButton.disabled = !capability.enabled;
  loginButton.textContent = capability.enabled ? 'Войти по телефону' : 'Вход по SMS пока не подключён';
  linkButton.disabled = !capability.enabled;
  linkButton.textContent = capability.enabled ? (currentUser?.phone ? 'Изменить телефон' : 'Привязать телефон') : 'SMS пока не подключены';
  if (!capability.enabled) $('#providerPhoneLinkHint').textContent = capability.reason === 'offline' ? 'Подключитесь к интернету, чтобы настроить телефон.' : capability.reason === 'backend' ? 'Безопасный вход по телефону ещё не установлен на сервере.' : 'Сначала нужно подключить SMS-провайдера в настройках сервера.';
  renderProviderPhoneState();
}

function initializeSocialAuth() {
  if (!window.MinutaSocialAuth) {
    $('#providerSocialAuthStatus').textContent = 'Модуль внешнего входа не загрузился.';
    return;
  }
  renderProviderSocialState();
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
    options: {
      data: {
        display_name: name,
        minuta_onboarding_status: 'pending',
        minuta_onboarding_version: 1
      },
      emailRedirectTo: new URL('provider.html', location.href).href
    }
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
  const email = $('#recoveryEmail').value.trim().toLowerCase();
  $('#recoveryEmail').value = email;
  const button = event.submitter;
  button.disabled = true;
  button.textContent = 'Отправляем…';
  const { error } = await db.auth.resetPasswordForEmail(email, {
    redirectTo: new URL('provider.html', location.href).href
  });
  button.disabled = false;
  button.textContent = 'Отправить ссылку';
  if (error) {
    const limited = error?.status === 429 || /rate|limit|security purposes/i.test(`${error?.message || ''}`);
    showFormError('#recoveryError', limited ? 'Слишком много запросов. Подождите минуту и попробуйте снова.' : 'Не удалось отправить письмо. Проверьте адрес и попробуйте снова.');
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
  const defaultDuration = normalizePerMinuteDuration($('#serviceDefaultDuration')?.value, 60);
  if (name.length < 2 || !Number.isFinite(duration) || duration < 1 || duration > 480 || !Number.isFinite(price) || price < 0) {
    showFormError('#serviceError', 'Укажите название, длительность и корректную цену.');
    return;
  }
  const button = event.submitter;
  button.disabled = true;
  const { data:createdService, error } = await db.from('services').insert({ performer_id: currentUser.id, name, price_rub: Math.round(price), duration_minutes: duration, active: true }).select('id').single();
  button.disabled = false;
  if (error) { showFormError('#serviceError', 'Не удалось добавить услугу.'); return; }
  if (duration === 1 && createdService?.id) await saveServiceDefaultDuration(createdService.id, defaultDuration);
  event.target.reset();
  $('#serviceDuration').value = '60';
  $('#serviceDefaultDuration').value = '60';
  updateServiceDefaultDurationField('#serviceDuration', '#serviceDefaultDurationField', '#serviceDefaultDuration');
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
function normalizeScheduleMonth(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value || ''));
  if (!match) return businessTodayIso().slice(0, 7);
  const year = Number(match[1]);
  const month = Number(match[2]);
  return year >= 2000 && year <= 2100 && month >= 1 && month <= 12 ? `${match[1]}-${match[2]}` : businessTodayIso().slice(0, 7);
}
function shiftScheduleMonth(value, direction) {
  const normalized = normalizeScheduleMonth(value);
  const [year, month] = normalized.split('-').map(Number);
  const shifted = new Date(year, month - 1 + Number(direction || 0), 1, 12);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, '0')}`;
}
function scheduleStateForDate(dateIso) {
  const date = parseLocalIsoDate(dateIso);
  const weekday = date ? ((date.getDay() + 6) % 7) + 1 : 0;
  const weekly = scheduleRows.find(row => Number(row.weekday) === weekday);
  const fullDayOff = daysOff.find(item => item.off_date === dateIso && item.all_day);
  const partialDayOff = daysOff.some(item => item.off_date === dateIso && !item.all_day);
  return { weekly, fullDayOff, partialDayOff, working:Boolean(weekly?.enabled) && !fullDayOff };
}
function renderMonthlySchedule() {
  const grid = $('#monthlyScheduleGrid');
  const input = $('#monthlyScheduleMonth');
  if (!grid || !input) return;
  monthlyScheduleMonth = normalizeScheduleMonth(monthlyScheduleMonth);
  input.value = monthlyScheduleMonth;
  if (!scheduleRows.length) {
    grid.innerHTML = '<div class="provider-empty compact-empty"><strong>Загружаем график…</strong></div>';
    return;
  }
  const [year, month] = monthlyScheduleMonth.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const leading = (new Date(year, month - 1, 1, 12).getDay() + 6) % 7;
  const today = businessTodayIso();
  const leadingMarkup = Array.from({ length:leading }, () => '<span class="monthly-schedule-blank" aria-hidden="true"></span>').join('');
  grid.innerHTML = leadingMarkup + Array.from({ length:daysInMonth }, (_, index) => {
    const day = index + 1;
    const dateIso = `${monthlyScheduleMonth}-${String(day).padStart(2, '0')}`;
    const date = new Date(year, month - 1, day, 12);
    const state = scheduleStateForDate(dateIso);
    const past = dateIso < today;
    const weeklyClosed = !state.weekly?.enabled;
    const status = weeklyClosed ? 'По неделе' : state.fullDayOff ? 'Выходной' : state.partialDayOff ? 'Частично' : 'Рабочий';
    const className = weeklyClosed ? 'is-weekly-closed' : state.fullDayOff ? 'is-closed' : 'is-working';
    const action = weeklyClosed ? 'Сначала включите этот день недели в обычном графике' : state.fullDayOff ? 'Открыть день' : 'Сделать выходным';
    const label = `${date.toLocaleDateString('ru-RU', { weekday:'long', day:'numeric', month:'long', year:'numeric' })}. ${status}. ${action}`;
    return `<button class="monthly-schedule-day ${className}${past ? ' is-past' : ''}" type="button" data-monthly-schedule-date="${dateIso}" aria-label="${escapeHtml(label)}" aria-pressed="${state.working}" ${past ? 'disabled' : ''}><strong>${day}</strong><small>${status}</small></button>`;
  }).join('');
}
async function toggleMonthlyScheduleDay(dateIso, button) {
  if (!requireWrites()) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateIso || '')) || dateIso < businessTodayIso()) return;
  const userId = currentUser?.id;
  const generation = sessionGeneration;
  if (!userId) return;
  const state = scheduleStateForDate(dateIso);
  if (!state.weekly?.enabled) {
    notify(`Сначала включите ${weekdayNames[Number(state.weekly?.weekday || 1) - 1] || 'этот день'} в обычной неделе`);
    return;
  }
  const status = $('#monthlyScheduleStatus');
  button.disabled = true;
  if (status) status.textContent = state.fullDayOff ? 'Открываем день…' : 'Сохраняем выходной…';
  const request = state.fullDayOff
    ? db.from('provider_days_off').delete().eq('id', state.fullDayOff.id).eq('performer_id', userId)
    : db.from('provider_days_off').insert({ performer_id:userId, off_date:dateIso, all_day:true, start_time:null, end_time:null, note:'Месячный график' });
  const { error } = await request;
  if (!sessionIsCurrent(userId, generation)) return;
  if (error) {
    button.disabled = false;
    if (status) status.textContent = 'Не удалось изменить день. Попробуйте ещё раз.';
    return;
  }
  await loadDaysOff();
  renderBookings();
  freeSlotsController.refresh();
  if (status) status.textContent = state.fullDayOff ? 'День снова открыт для записи.' : 'День отмечен выходным.';
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
  renderMonthlySchedule();
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
      syncSlotIntervalOptions();
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
  syncSlotIntervalOptions();
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
  renderMonthlySchedule();
  if (!sessionIsCurrent(userId, generation)) return;
  notify('Расписание сохранено');
}

function renderDaysOff() {
  const holder = $('#daysOffList');
  if (!daysOff.length) {
    holder.innerHTML = `<div class="provider-empty compact-empty"><span class="provider-empty-icon">${uiIcon('check')}</span><strong>Исключений нет</strong><small>Онлайн-запись работает по обычному расписанию.</small></div>`;
    renderMonthlySchedule();
    return;
  }
  holder.innerHTML = daysOff.map(item => {
    const date = new Date(`${item.off_date}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' });
    const period = item.all_day ? 'Весь день' : `${shortTime(item.start_time, '')}–${shortTime(item.end_time, '')}`;
    return `<article class="day-off-item"><div><strong>${date}</strong><span>${period}${item.note ? ` · ${escapeHtml(item.note)}` : ''}</span></div><button type="button" data-delete-day-off="${item.id}" aria-label="Удалить исключение">${uiIcon('trash')}</button></article>`;
  }).join('');
  renderMonthlySchedule();
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
function portfolioCountLabel(value, one, few, many) { const number = Math.abs(Number(value)); return number % 10 === 1 && number % 100 !== 11 ? one : number % 10 >= 2 && number % 10 <= 4 && (number % 100 < 12 || number % 100 > 14) ? few : many; }
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
  $('#portfolioCount').textContent = `${portfolioItems.length} ${portfolioCountLabel(portfolioItems.length, 'работа', 'работы', 'работ')}`;
  if ($('#portfolioBadge')) $('#portfolioBadge').textContent = String(portfolioItems.length);
  const availability = $('#portfolioAvailability');
  availability.hidden = portfolioRemoteAvailable;
  availability.textContent = portfolioRemoteAvailable ? '' : 'Портфолио пока недоступно: серверная часть ещё не подключена или связь прервана.';
  if (!portfolioRemoteAvailable) {
    list.innerHTML = `<div class="provider-empty"><span class="provider-empty-icon">${uiIcon('image')}</span><strong>Портфолио не загружено</strong><small>Основные функции кабинета продолжают работать.</small></div>`;
    return;
  }
  if (!portfolioItems.length) {
    list.innerHTML = `<div class="provider-empty portfolio-empty-state"><span class="provider-empty-icon">${uiIcon('plus')}</span><strong>Покажите клиентам результат</strong><small>Добавьте фотографии «До» и «После». Работа появится на странице клиента только после подтверждения согласия на публикацию.</small><div class="portfolio-empty-actions"><button class="primary compact-button" type="button" data-open-portfolio-editor>Добавить первую работу</button></div></div>`;
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
  $('#providerReviewsCount').textContent = `${providerReviews.length} ${portfolioCountLabel(providerReviews.length, 'отзыв', 'отзыва', 'отзывов')}`;
  if (!providerReviews.length) {
    list.innerHTML = `<div class="provider-empty portfolio-empty-state provider-review-empty-state"><span class="provider-empty-icon">${uiIcon('spark')}</span><strong>Получите первый отзыв</strong><small>После завершённого визита клиент сможет поставить оценку в разделе «Мои записи». Отзыв публикуется только под вашим контролем.</small><div class="portfolio-empty-actions"><a class="primary compact-button" href="my-bookings.html" target="_blank" rel="noopener noreferrer">Открыть «Мои записи»</a></div></div>`;
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
  if ($('#servicesBadge')) $('#servicesBadge').textContent = String(ownServices.length);
  $('#activeServicesCount').textContent = String(activeCount);
  if (!ownServices.length) {
    list.innerHTML = `<button class="provider-empty provider-empty-action" type="button" data-open-service-creator aria-label="Добавить первую услугу"><span class="provider-empty-icon">${uiIcon('plus')}</span><strong>Услуг пока нет</strong><small>Нажмите здесь, чтобы добавить первую — она сразу появится у клиентов.</small></button>`;
    return;
  }
  list.innerHTML = ownServices.map(item => `<article class="managed-service ${item.active ? '' : 'inactive'}"><button class="service-info service-edit-target" type="button" data-edit-service="${item.id}" aria-label="Изменить услугу ${escapeHtml(serviceName(item.name))}"><div><strong>${escapeHtml(serviceName(item.name))}</strong><small>${Number(item.duration_minutes) === 1 ? `Поминутно · ${money(item.price_rub)}/мин · обычно ${serviceDefaultDuration(item.id)} мин` : `${item.duration_minutes} мин · ${money(item.price_rub)}`}</small></div></button><div class="manage-actions"><button class="service-visibility-toggle" type="button" data-toggle-service="${item.id}" data-active="${item.active}" aria-label="${item.active ? 'Скрыть услугу от клиентов' : 'Показать услугу клиентам'}"><i aria-hidden="true"></i><span>${item.active ? 'Доступна' : 'Скрыта'}</span></button><details class="service-more"><summary aria-label="Другие действия">${uiIcon('more')}</summary><div><button class="danger" type="button" data-delete-service="${item.id}">${uiIcon('trash')}<span>Удалить</span></button></div></details></div></article>`).join('');
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

async function queryAllProviderRows(table, selection, userId, orderColumns, maxRows = 50000) {
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; from <= maxRows; from += pageSize) {
    let query = db.from(table).select(selection).eq('performer_id', userId);
    orderColumns.forEach(column => { query = query.order(column, { ascending:true }); });
    const result = await query.range(from, from === maxRows ? from : from + pageSize - 1);
    if (result.error) return result;
    if (from === maxRows) return (result.data || []).length
      ? { data:null, error:new Error('Слишком большой объём данных для безопасной загрузки') }
      : { data:rows, error:null };
    rows.push(...(result.data || []));
    if ((result.data || []).length < pageSize) return { data:rows, error:null };
  }
  return { data:null, error:new Error('Слишком большой объём данных для безопасной загрузки') };
}

async function queryAllProviderBookings(userId, selection) {
  return queryAllProviderRows('bookings', selection, userId, ['booking_date','booking_time','id']);
}

async function loadBookings(options = {}) {
  const holder = $('#providerBookings');
  const userId = currentUser?.id;
  const generation = sessionGeneration;
  const revision = ++bookingsRequestRevision;
  if (!userId) return { ok: false };
  const cachePromise = readProviderCache('bookings', userId);
  let cached = null;
  let cacheShown = false;
  let networkFinished = false;
  const showCached = async () => {
    const candidate = await cachePromise;
    if (networkFinished || !candidate?.data || !sessionIsCurrent(userId, generation) || revision !== bookingsRequestRevision) return null;
    cached = candidate;
    if (bookingDataSignature(candidate.data) !== bookingDataSignature()) {
      applyCachedBookings(candidate);
      cacheShown = true;
    }
    return candidate;
  };
  if (!options.silent) holder.innerHTML = '<div class="loading-state"><i></i><span>Загружаем записи…</span></div>';
  if (!navigator.onLine) {
    const offlineCache = await showCached();
    return offlineCache ? { ok: false, cached: true, savedAt: offlineCache.savedAt } : { ok: false };
  }
  let { data, error } = await queryAllProviderBookings(userId, 'id,organization_id,booking_code,request_id,service_id,series_id,series_occurrence,client_name,client_phone,booking_date,booking_time,duration_minutes,original_price_rub,total_price_rub,status,created_at,reschedule_count,deposit_amount_rub,payment_status,payment_url,booking_source,created_by_user_id,created_by_role,services(name,price_rub,duration_minutes),booking_series(occurrence_count)');
  if (error) ({ data, error } = await queryAllProviderBookings(userId, 'id,organization_id,booking_code,request_id,service_id,client_name,client_phone,booking_date,booking_time,duration_minutes,original_price_rub,total_price_rub,status,created_at,reschedule_count,deposit_amount_rub,payment_status,payment_url,booking_source,created_by_user_id,created_by_role,services(name,price_rub,duration_minutes)'));
  if (error) ({ data, error } = await queryAllProviderBookings(userId, 'id,booking_code,request_id,service_id,client_name,client_phone,booking_date,booking_time,duration_minutes,original_price_rub,total_price_rub,status,created_at,reschedule_count,deposit_amount_rub,payment_status,payment_url,services(name,price_rub,duration_minutes)'));
  if (error) ({ data, error } = await queryAllProviderBookings(userId, 'id,booking_code,request_id,service_id,client_name,client_phone,booking_date,booking_time,duration_minutes,status,created_at,reschedule_count,deposit_amount_rub,payment_status,payment_url,services(name,price_rub,duration_minutes)'));
  networkFinished = true;
  if (!sessionIsCurrent(userId, generation) || revision !== bookingsRequestRevision) return { ok: false, stale: true };
  if (error) {
    cached ||= await cachePromise;
    if (cached?.data) {
      if (!cacheShown) applyCachedBookings(cached);
      return { ok: false, cached: true, savedAt:cached.savedAt };
    }
    holder.innerHTML = '<div class="provider-empty"><strong>Не удалось загрузить записи</strong><small>Соединение с сервером не установлено. Попробуйте ещё раз.</small></div>';
    return { ok: false };
  }
  const previousSignature = bookingDataSignature();
  allBookings = data || [];
  await loadRemoteBookingColors(userId, generation);
  if (!sessionIsCurrent(userId, generation) || revision !== bookingsRequestRevision) return { ok: false, stale: true };
  const savedSnapshot = await saveProviderCache('bookings', allBookings, userId);
  if (!sessionIsCurrent(userId, generation) || revision !== bookingsRequestRevision) return { ok: false, stale: true };
  bookingsSnapshotSavedAt = String(savedSnapshot?.savedAt || new Date().toISOString());
  bookingsSnapshotFromCache = false;
  if (!providerBookingRenderRevision || previousSignature !== bookingDataSignature()) renderBookingData();
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

document.addEventListener('pointerdown', event => {
  const bookingCard = event.target.closest('.timeline-booking[data-open-booking]');
  if (bookingCard) {
    beginTimelineBookingDrag(event, bookingCard);
    return;
  }
  const swipeSurface = event.target.closest('#providerBookings,#dateStrip');
  if (swipeSurface) beginScheduleDaySwipe(event, swipeSurface);
});

document.addEventListener('contextmenu', event => {
  if (event.target.closest('.timeline-booking[data-open-booking]')) event.preventDefault();
});

document.addEventListener('pointermove', event => {
  if (timelineBookingDrag?.pointerId === event.pointerId) {
    const state = timelineBookingDrag;
    const deltaX = event.clientX - state.startX;
    const deltaY = event.clientY - state.startY;
    const distance = Math.hypot(deltaX, deltaY);
    if (!state.active) {
      if (state.pointerType === 'mouse' && distance >= TIMELINE_DRAG_THRESHOLD_PX) activateTimelineBookingDrag(state);
      else if (state.pointerType !== 'mouse' && distance > 12) {
        if (Math.abs(deltaX) > Math.abs(deltaY) && currentFilter === 'day') {
          const surface = state.card.closest('#providerBookings');
          const swipeState = { pointerId:event.pointerId, surface, startX:state.startX, startY:state.startY, active:true };
          finishTimelineBookingDrag();
          if (surface) {
            scheduleDaySwipe = swipeState;
            surface.setPointerCapture?.(event.pointerId);
            surface.classList.add('is-day-swiping');
            surface.style.setProperty('--day-swipe-x', `${Math.max(-72, Math.min(72, deltaX * .28))}px`);
            event.preventDefault();
          }
          return;
        }
        finishTimelineBookingDrag();
        return;
      }
    }
    if (state.active) {
      event.preventDefault();
      updateTimelineBookingDrag(state, event.clientY);
    }
    return;
  }
  if (scheduleDaySwipe?.pointerId !== event.pointerId) return;
  const state = scheduleDaySwipe;
  const deltaX = event.clientX - state.startX;
  const deltaY = event.clientY - state.startY;
  if (!state.active && Math.hypot(deltaX, deltaY) > 10) {
    if (Math.abs(deltaY) >= Math.abs(deltaX)) {
      state.surface.classList.remove('is-day-swiping');
      try { state.surface.releasePointerCapture(state.pointerId); } catch {}
      scheduleDaySwipe = null;
      return;
    }
    state.active = true;
    state.surface.setPointerCapture?.(event.pointerId);
    state.surface.classList.add('is-day-swiping');
  }
  if (!state.active) return;
  event.preventDefault();
  state.surface.style.setProperty('--day-swipe-x', `${Math.max(-72, Math.min(72, deltaX * .28))}px`);
});

document.addEventListener('touchmove', event => {
  const state = timelineBookingDrag;
  if (!state?.active || state.pointerType !== 'touch' || event.touches.length !== 1) return;
  event.preventDefault();
  updateTimelineBookingDrag(state, event.touches[0].clientY);
}, { passive:false });

document.addEventListener('pointerup', event => {
  if (timelineBookingDrag?.pointerId === event.pointerId) {
    const state = timelineBookingDrag;
    if (!state.active) {
      finishTimelineBookingDrag();
      return;
    }
    gestureClickSuppressedUntil = Date.now() + 450;
    finishTimelineBookingDrag({ restore:false });
    persistTimelineBookingMove(state);
    return;
  }
  if (scheduleDaySwipe?.pointerId === event.pointerId) finishScheduleDaySwipe(scheduleDaySwipe, event);
});

document.addEventListener('pointercancel', event => {
  if (timelineBookingDrag?.pointerId === event.pointerId) finishTimelineBookingDrag();
  if (scheduleDaySwipe?.pointerId === event.pointerId) finishScheduleDaySwipe(scheduleDaySwipe, { ...event, clientX:scheduleDaySwipe.startX });
});

document.addEventListener('click', async event => {
  if (Date.now() < gestureClickSuppressedUntil && event.target.closest('[data-open-booking],[data-create-booking-at],[data-booking-date]')) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  const authTab = event.target.closest('[data-auth-tab]');
  const view = event.target.closest('[data-provider-view]');
  const sectionTarget = event.target.closest('[data-section-target]');
  const notificationFilterButton = event.target.closest('[data-notification-filter]');
  const reportFilterToggle = event.target.closest('#reportFilterToggle');
  const reportSourceButton = event.target.closest('[data-report-source]');
  const reportPeriodButton = event.target.closest('[data-report-period]');
  const reportChartDate = event.target.closest('[data-report-date]');
  const reportServiceMetricButton = event.target.closest('[data-report-service-metric]');
  const reportServiceRow = event.target.closest('[data-report-service]');
  const reportServicesExpandButton = event.target.closest('#reportServicesExpand');
  const reportBookingSourceButton = event.target.closest('[data-report-booking-source]');
  const reportOutcomeButton = event.target.closest('[data-report-outcome]');
  const openPendingBookings = event.target.closest('[data-open-pending-bookings]');
  const reportViewButton = event.target.closest('[data-report-view]');
  const reportActionButton = event.target.closest('[data-report-action]');
  const reportActionsToggle = event.target.closest('[data-report-actions-toggle]');
  const openReportGoalsButton = event.target.closest('#reportGoalsOpen,#settingsReportGoalsOpen');
  const closeReportGoalsButton = event.target.closest('[data-close-report-goals]');
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
  const calendarViewButton = event.target.closest('[data-calendar-view]');
  const calendarOpenDate = event.target.closest('[data-calendar-open-date]');
  const date = event.target.closest('[data-booking-date]');
  const dateShift = event.target.closest('[data-date-shift]');
  const dateToday = event.target.closest('[data-date-today]');
  const openBooking = event.target.closest('[data-open-booking]');
  const repeatBookingButton = event.target.closest('[data-repeat-booking]');
  const quickRepeatClient = event.target.closest('[data-quick-repeat-client]');
  const removeClientAvatarButton = event.target.closest('[data-remove-client-avatar]');
  const timelineStage = event.target.closest('[data-create-booking-at]');
  const expandTimeline = event.target.closest('[data-expand-timeline]');
  const createEmptyBooking = event.target.closest('[data-create-empty-booking]');
  const editBooking = event.target.closest('[data-edit-booking]');
  const cancelBookingSeriesButton = event.target.closest('[data-cancel-booking-series]');
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
  const clientProfileBack = event.target.closest('#clientProfileBack');
  const slotIntervalButton = event.target.closest('[data-slot-interval]');
  const repeat = event.target.closest('[data-repeat-time]');
  if (authTab) setAuthTab(authTab.dataset.authTab);
  if (view) setProviderView(view.dataset.providerView);
  if (sectionTarget) {
    event.preventDefault();
    scrollToProviderSection(sectionTarget);
  }
  if (notificationFilterButton) {
    notificationFilter = notificationFilterButton.dataset.notificationFilter;
    $$('[data-notification-filter]').forEach(button => button.classList.toggle('active', button === notificationFilterButton));
    renderNotifications();
  }
  if (reportFilterToggle) setReportFiltersExpanded(reportFilterToggle.getAttribute('aria-expanded') !== 'true');
  if (reportSourceButton && reportSourceButton.dataset.reportSource !== reportDataSource) {
    reportDataSource = reportSourceButton.dataset.reportSource === 'demo' ? 'demo' : 'own';
    if (reportDataSource === 'demo' && reportPeriod === 'month') {
      reportPeriod = 'quarter';
      $$('[data-report-period]').forEach(button => button.classList.toggle('active', button.dataset.reportPeriod === reportPeriod));
      $('#reportCustomPeriod').hidden = true;
    }
    resetReportSessionState();
    renderReportDataSourceControl();
    loadSelectedReportData();
    renderAnalytics();
    setReportFiltersExpanded(false);
  }
  if (reportChartDate) {
    if (reportDataSource === 'demo') notify('Демо-график не открывает ваши реальные записи');
    else {
      selectScheduleDate(reportChartDate.dataset.reportDate);
      setProviderView('bookings');
    }
  }
  if (reportServiceMetricButton) {
    reportServiceMetric = reportServiceMetricButton.dataset.reportServiceMetric === 'visits' ? 'visits' : 'revenue';
    renderAnalytics();
  }
  if (reportServicesExpandButton) {
    reportServicesExpanded = !reportServicesExpanded;
    renderAnalytics();
  }
  if (reportServiceRow) openReportBookings({ service:reportServiceRow.dataset.reportService || '', filter:'all' });
  if (reportBookingSourceButton) openReportBookings({ source:reportBookingSourceButton.dataset.reportBookingSource || 'all', filter:'all' });
  if (reportOutcomeButton) openReportBookings({ status:reportOutcomeButton.dataset.reportStatus || 'all', filter:reportOutcomeButton.dataset.reportFilter || 'all' });
  if (reportViewButton) setReportSubview(reportViewButton.dataset.reportView);
  if (reportActionButton) handleReportAction(reportActionButton.dataset.reportAction || '');
  if (reportActionsToggle) {
    const holder = $('#reportSmartActions');
    const expanded = !holder?.classList.contains('is-expanded');
    holder?.classList.toggle('is-expanded', expanded);
    reportActionsToggle.setAttribute('aria-expanded', String(expanded));
    const actionCount = holder?.querySelectorAll('.report-smart-action').length || 0;
    reportActionsToggle.textContent = expanded ? 'Скрыть рекомендации' : `Рекомендации · ${actionCount}`;
  }
  if (openReportGoalsButton) openReportGoals();
  if (closeReportGoalsButton) $('#reportGoalsDialog')?.close();
  if (openPendingBookings) {
    bookingStatusFilter = 'needs-result';
    const statusFilter = $('#bookingStatusFilter');
    if (statusFilter) statusFilter.value = bookingStatusFilter;
    setJournalMode('list');
    setFilter('all');
    setProviderView('bookings');
  }
  if (reportPeriodButton) {
    reportPeriod = reportPeriodButton.dataset.reportPeriod;
    $$('[data-report-period]').forEach(button => button.classList.toggle('active', button === reportPeriodButton));
    const customForm = $('#reportCustomPeriod');
    customForm.hidden = reportPeriod !== 'custom';
    if (reportPeriod === 'custom' && !reportCustomStart) {
      const today = parseLocalIsoDate(businessTodayIso());
      reportCustomEnd = businessTodayIso();
      reportCustomStart = localIsoDate(new Date(today.getTime() - 29 * 86400000));
      $('#reportDateFrom').value = reportCustomStart;
      $('#reportDateTo').value = reportCustomEnd;
    }
    loadSelectedReportData();
    renderAnalytics();
    if (reportPeriod !== 'custom') setReportFiltersExpanded(false);
  }
  if (openNotificationTemplates) {
    renderNotificationTemplates();
    $('#notificationTemplatesDialog').showModal();
  }
  if (closeNotificationTemplates) $('#notificationTemplatesDialog').close();
  if (openServiceCreator) {
    $('#serviceForm').reset();
    $('#serviceDuration').value = '60';
    $('#serviceDefaultDuration').value = '60';
    updateServiceDefaultDurationField('#serviceDuration', '#serviceDefaultDurationField', '#serviceDefaultDuration');
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
  if (calendarViewButton) setCalendarView(calendarViewButton.dataset.calendarView);
  if (expandTimeline) {
    timelineFullDay = true;
    renderBookings();
  }
  if (calendarOpenDate) {
    setCalendarView('day');
    selectScheduleDate(calendarOpenDate.dataset.calendarOpenDate);
  }
  if (dateShift) shiftScheduleDate(Number(dateShift.dataset.dateShift));
  if (dateToday) restoreDefaultScheduleView();
  if (date) selectScheduleDate(date.dataset.bookingDate);
  if (openBooking) openBookingSheet(openBooking.dataset.openBooking);
  if (repeatBookingButton) openRepeatBookingFromSheet(repeatBookingButton.dataset.repeatBooking);
  if (quickRepeatClient) openQuickRepeatForClient(quickRepeatClient.dataset.quickRepeatClient);
  if (removeClientAvatarButton) await removeClientAvatar(removeClientAvatarButton.dataset.removeClientAvatar, removeClientAvatarButton.dataset.bookingId || '');
  if (createEmptyBooking && requireBookingWrites()) openNewBookingSheet('', { date:selectedDate, historical:selectedDate < businessTodayIso() });
  if (timelineStage && !openBooking) openTimelineBooking(timelineStage, event);
  if (editBooking) openBookingEditor(editBooking.dataset.editBooking);
  if (cancelBookingSeriesButton) openBookingSeriesCancellation(cancelBookingSeriesButton.dataset.cancelBookingSeries);
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
    renderNewBookingTimePicker({ offline:!navigator.onLine });
    $$('[data-new-booking-time]').forEach(button => button.classList.toggle('active', button.dataset.newBookingTime === newBookingTime));
    clearFormError('#newBookingError');
    saveNewBookingDraft();
    updateNewBookingDurationControl();
    updateNewBookingSubmitCaption();
  }
  if (newHour) {
    newBookingHour = newHour.dataset.newBookingHour;
    if (!newBookingTime.startsWith(`${newBookingHour}:`)) newBookingTime = newBookingSlots.find(time => time.startsWith(`${newBookingHour}:`)) || '';
    renderNewBookingTimePicker({ offline:!navigator.onLine });
    updateNewBookingDurationControl();
    clearFormError('#newBookingError');
    saveNewBookingDraft();
    updateNewBookingSubmitCaption();
  }
  if (closeSheet) closeBookingSheet();
  if (editService) openServiceEditor(editService.dataset.editService);
  if (client) {
    $('#clientsLayout')?.classList.add('is-detail');
    renderClientDetail(client.dataset.clientPhone);
  }
  if (clientProfileBack) {
    $('#clientsLayout')?.classList.remove('is-detail');
    $$('[data-client-phone]').find(button => button.dataset.clientPhone === selectedClientPhone)?.focus();
  }
  if (slotIntervalButton) {
    const slotInterval = $('#slotInterval');
    slotInterval.value = slotIntervalButton.dataset.slotInterval;
    slotInterval.dispatchEvent(new Event('change', { bubbles:true }));
  }
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
    if (!isScheduleBlock(item) && !allBookings.some(entry => normalizePhone(entry.client_phone) === normalizePhone(item.client_phone))) {
      await removeClientAvatar(item.client_phone, '', { confirm:false, silent:true });
    }
    closeBookingSheet();
    renderBookingData();
    notify(isScheduleBlock(item) ? 'Занятое время удалено' : 'Запись удалена');
    await refreshAfterWrite();
  }
  if (booking) {
    const bookingItem = allBookings.find(item => item.id === booking.dataset.bookingId);
    let { error } = await db.rpc('provider_set_booking_status_v2', { p_booking:booking.dataset.bookingId, p_status:booking.dataset.bookingStatus });
    if (error && isMissingRpc(error, 'provider_set_booking_status_v2')) {
      ({ error } = await db.from('bookings').update({ status: booking.dataset.bookingStatus }).eq('id', booking.dataset.bookingId).eq('performer_id', currentUser.id));
    }
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
  const clientAvatarInput = event.target.closest('[data-client-avatar-input]');
  if (clientAvatarInput) {
    await saveClientAvatar(clientAvatarInput);
    return;
  }
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
  renderTopbarDateTime();
  renderNotifications();
  if (navigator.onLine) {
    queueDisplayPreferencesSync(0);
    synchronizeProvider().then(() => { if (bookingCreationReady) flushOfflineBookings(); });
  }
});
window.addEventListener('offline', () => {
  connectionWasOffline = true;
  clearTimeout(synchronizationRetryTimer);
  synchronizationRetryTimer = null;
  setBookingCreationReady(false);
  setWritesAllowed(false);
  setSyncState('offline', canQueueOfflineBooking() ? 'Офлайн · новую запись можно отложить до подключения' : 'Нет интернета и полной сохранённой копии · только чтение');
  renderOfflineBookingQueue();
  updateNewBookingConnectivity();
  if ($('#newBookingForm')) loadNewBookingSlots();
});
window.addEventListener('online', async () => {
  queueDisplayPreferencesSync(0);
  renderOfflineBookingQueue();
  updateNewBookingConnectivity();
  const complete = await synchronizeProvider();
  if (bookingCreationReady) await flushOfflineBookings();
  if ($('#newBookingForm')) await loadNewBookingSlots();
  if (connectionWasOffline) notify(complete ? 'Интернет восстановлен · данные обновлены' : 'Интернет восстановлен · продолжаем синхронизацию');
  connectionWasOffline = false;
});
$('#retryOfflineBookings')?.addEventListener('click', async () => {
  await synchronizeProvider();
  if (bookingCreationReady) await flushOfflineBookings({ retryConflicts:true });
});
$('#offlineBookingQueueList')?.addEventListener('click', async event => {
  const editButton = event.target.closest('[data-edit-offline-booking]');
  if (editButton) {
    const item = offlineBookingQueue.find(entry => entry.id === editButton.dataset.editOfflineBooking && entry.status === 'conflict');
    if (!item) return;
    editingOfflineBookingId = item.id;
    openNewBookingSheet(item.time, {
      offlineEdit:true,
      clientName:item.clientName,
      clientPhone:item.clientPhone,
      serviceId:item.serviceId,
      durationMinutes:item.durationMinutes,
      date:item.date,
      note:item.note,
      color:item.color
    });
    return;
  }
  const button = event.target.closest('[data-remove-offline-booking]');
  if (!button) return;
  const item = offlineBookingQueue.find(entry => entry.id === button.dataset.removeOfflineBooking);
  if (item?.status === 'syncing' || item?.status === 'server_check_pending') { notify('Запись уже проверяется на сервере · дождитесь результата'); return; }
  if (!item || !confirm(`Удалить отложенную запись ${item.clientName} на ${item.date} в ${item.time}?`)) return;
  const previousQueue = offlineBookingQueue;
  offlineBookingQueue = offlineBookingQueue.filter(entry => entry.id !== item.id);
  const saved = await saveOfflineBookingQueue(currentUser?.id, { verify:true });
  if (!saved) {
    offlineBookingQueue = previousQueue;
    renderOfflineBookingQueue();
    notify('Не удалось надёжно удалить запись с устройства · попробуйте ещё раз');
    return;
  }
  renderOfflineBookingQueue();
  notify('Отложенная запись удалена с устройства');
});
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
  getCalendarRange: () => calendarRange(),
  getCalendarView: () => calendarView,
  getHolder: () => $('#providerBookings'),
  onModeChange: setTeamCalendarMode,
  renderLegacy: renderBookings,
  notify,
  requireWrites,
  onDataChange: refreshAfterWrite,
  getEnabledPreference: () => displayPreferences.team_calendar_enabled === true,
  onEnabledChange: setTeamCalendarEnabledPreference
});
teamCalendarController.bind();

const resourceController = window.MinutaResources?.createController ? window.MinutaResources.createController({
  db, $, escapeHtml, notify, requireWrites,
  getCurrentUser: () => currentUser,
  getSessionGeneration: () => sessionGeneration,
  sessionIsCurrent,
  applyWriteAvailability
}) : { bind() {}, setOrganization() {} };
resourceController.bind();

const shiftController = window.MinutaShifts?.createController ? window.MinutaShifts.createController({
  db, $, escapeHtml, notify, requireWrites,
  getCurrentUser: () => currentUser,
  getSessionGeneration: () => sessionGeneration,
  sessionIsCurrent,
  applyWriteAvailability
}) : { bind() {}, setOrganization() {}, reset() {} };
shiftController.bind();

const payrollController = window.MinutaPayroll?.createController ? window.MinutaPayroll.createController({
  db, $, escapeHtml, notify, requireWrites,
  getCurrentUser: () => currentUser,
  getSessionGeneration: () => sessionGeneration,
  sessionIsCurrent,
  applyWriteAvailability
}) : { bind() {}, setOrganization() {}, reset() {} };
payrollController.bind();

const benefitController = window.MinutaBenefits?.createController ? window.MinutaBenefits.createController({
  db, $, escapeHtml, notify, requireWrites,
  getCurrentUser: () => currentUser,
  getSessionGeneration: () => sessionGeneration,
  sessionIsCurrent,
  applyWriteAvailability
}) : { bind() {}, setOrganization() {}, reset() {} };
benefitController.bind();

const loyaltyController = window.MinutaLoyalty?.createController ? window.MinutaLoyalty.createController({
  db, $, escapeHtml, notify, requireWrites,
  getCurrentUser: () => currentUser,
  getSessionGeneration: () => sessionGeneration,
  sessionIsCurrent,
  applyWriteAvailability
}) : { bind() {}, setOrganization() {}, reset() {} };
loyaltyController.bind();

const inventoryController = window.MinutaInventory?.createController ? window.MinutaInventory.createController({
  db, $, escapeHtml, notify, requireWrites,
  getCurrentUser: () => currentUser,
  getSessionGeneration: () => sessionGeneration,
  sessionIsCurrent,
  applyWriteAvailability
}) : { bind() {}, setOrganization() {}, reset() {} };
inventoryController.bind();

const retentionController = window.MinutaRetention?.createController ? window.MinutaRetention.createController({
  db, $, escapeHtml, notify, requireWrites,
  getCurrentUser: () => currentUser,
  getSessionGeneration: () => sessionGeneration,
  sessionIsCurrent,
  applyWriteAvailability
}) : { bind() {}, setOrganization() {}, reset() {} };
retentionController.bind();

batchBookingsController = window.MinutaBatchBookings?.createController ? window.MinutaBatchBookings.createController({
  db, $, escapeHtml, notify, requireWrites,
  getCurrentUser: () => currentUser,
  getSessionGeneration: () => sessionGeneration,
  sessionIsCurrent,
  applyWriteAvailability,
  onCreated: async data => {
    const first = Array.isArray(data?.created) ? data.created[0] : null;
    if (first?.date) selectScheduleDate(first.date);
    await refreshAfterWrite();
  }
}) : { bind() {}, load() { return Promise.resolve({ ok:true, optional:true }); }, setOrganization() {}, setClient() {} };
batchBookingsController.bind();

const bookingPolicyController = window.MinutaBookingPolicies?.createController ? window.MinutaBookingPolicies.createController({
  db, $, escapeHtml, notify, requireWrites,
  getCurrentUser: () => currentUser,
  getSessionGeneration: () => sessionGeneration,
  sessionIsCurrent,
  applyWriteAvailability
}) : { bind() {}, setOrganization() {}, reset() {} };
bookingPolicyController.bind();

const groupBookingsController = window.MinutaGroupBookings?.createProviderController ? window.MinutaGroupBookings.createProviderController({
  db, $, escapeHtml, notify, requireWrites,
  getCurrentUser: () => currentUser,
  getSessionGeneration: () => sessionGeneration,
  sessionIsCurrent,
  applyWriteAvailability
}) : { bind() {}, load() { return Promise.resolve({ ok:true, optional:true }); }, setOrganization() {}, reset() {} };
groupBookingsController.bind();

const paymentController = window.MinutaPayments?.createController ? window.MinutaPayments.createController({
  db, $, escapeHtml, notify, requireWrites, refreshNavigation:refreshSectionNavigation
}) : { bind() {}, load() { return Promise.resolve(); }, setOrganization() {}, reset() {}, isCheckoutEnabled() { return false; } };
paymentController.bind();

const notificationCenterController = window.MinutaNotificationCenter?.createController ? window.MinutaNotificationCenter.createController({
  db, $, escapeHtml, notify, requireWrites
}) : { bind() {}, load() { return Promise.resolve(); }, setOrganization() {}, reset() {} };
notificationCenterController.bind();

const clientFieldsController = window.createMinutaClientFieldsUIController ? window.createMinutaClientFieldsUIController({
  db, $, escapeHtml, notify, requireWrites
}) : { bind() {}, setOrganization() {}, setClient() {}, render() {} };
clientFieldsController.bind();

const clientImportController = window.MinutaClientImport?.createController ? window.MinutaClientImport.createController({
  db, $, escapeHtml, notify, requireWrites,
  onLoaded: (clients, historyRows) => {
    importedClients = Array.isArray(clients) ? clients : [];
    importedBookingHistory = (Array.isArray(historyRows) ? historyRows : []).map(item => ({
      id:`imported-history:${item.id}`,
      organization_id:item.organization_id,
      performer_id:item.performer_id,
      client_name:item.client_name,
      client_phone:item.display_phone || item.phone,
      booking_date:item.booking_date,
      booking_time:item.booking_time,
      duration_minutes:Number(item.duration_minutes || 0),
      original_price_rub:Number(item.price_rub || 0),
      total_price_rub:Number(item.price_rub || 0),
      status:'confirmed',
      booking_source:'imported_history',
      is_imported_history:true,
      source_provider_name:item.source_provider_name || '',
      source_note:item.source_note || '',
      services:{ name:item.service_name || 'Услуга',price_rub:Number(item.price_rub || 0),duration_minutes:Number(item.duration_minutes || 0) },
      booking_outcomes:{ visit_status:'completed',payment_method:'imported',amount_rub:Number(item.price_rub || 0),actual_duration_minutes:Number(item.duration_minutes || 0),calculated_amount_rub:Number(item.price_rub || 0),completion_source:'imported' }
    }));
    renderClients();
    renderAnalytics();
    if (selectedClientPhone) renderClientDetail(selectedClientPhone);
  }
}) : { bind() {}, load() { return Promise.resolve({ ok:true,optional:true }); }, setOrganization() {} };
clientImportController.bind();

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
  onActiveOrganizationChange: organization => {
    const nextClientOrganizationId = organization?.id || '';
    const clientOrganizationChanged = nextClientOrganizationId !== activeClientOrganizationId;
    activeClientOrganizationId = nextClientOrganizationId;
    importedClients = [];
    importedBookingHistory = [];
    if (clientOrganizationChanged) {
      selectedClientPhone = '';
      const clientSearch = $('#clientSearch');
      if (clientSearch) clientSearch.value = '';
      const clientProfileEmpty = $('#clientProfileEmpty');
      const clientProfileContent = $('#clientProfileContent');
      if (clientProfileEmpty) clientProfileEmpty.hidden = false;
      if (clientProfileContent) clientProfileContent.hidden = true;
    }
    resetReportSessionState();
    renderReportDataSourceControl();
    updateProviderClientLinks(organization);
    if (clientOrganizationChanged && currentUser && navigator.onLine) void loadBookingSettings();
    teamCalendarController.setOrganization(organization);
    resourceController.setOrganization(organization);
    shiftController.setOrganization(organization);
    payrollController.setOrganization(organization);
    benefitController.setOrganization(organization);
    loyaltyController.setOrganization(organization);
    inventoryController.setOrganization(organization);
    retentionController.setOrganization(organization);
    batchBookingsController.setOrganization(organization);
    bookingPolicyController.setOrganization(organization);
    groupBookingsController.setOrganization(organization);
    paymentController.setOrganization(organization);
    notificationCenterController.setOrganization(organization);
    clientFieldsController.setOrganization(organization);
    clientImportController.setOrganization(organization?.public_slug === REPORT_DEMO_SLUG ? null : organization);
  }
});
organizationController.bind();
const freeSlotsController = window.MinutaFreeSlots.createController({
  root: $('#freeSlotsDialog'),
  notify,
  getData: () => {
    const organization = organizationController.getActiveOrganization();
    const bookingUrl = new URL('index.html', window.location.href);
    bookingUrl.search = '';
    bookingUrl.hash = '';
    if (organization?.public_booking_enabled && organization.public_slug) bookingUrl.searchParams.set('org', organization.public_slug);
    return {
      bookings: allBookings,
      scheduleRows,
      daysOff,
      services: ownServices,
      selectedDate,
      today: businessTodayIso(),
      bookingUrl: bookingUrl.href
    };
  }
});

function providerAssistantIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day ? match[0] : '';
}

function providerAssistantNumber(value, fallback = 0, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

function providerAssistantCurrentMinute() {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone:'Europe/Samara', hour:'2-digit', minute:'2-digit', hour12:false }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return (Number(values.hour) * 60) + Number(values.minute);
}

window.MinutaProviderAssistant = Object.freeze({
  getReadOnlySnapshot() {
    const organization = organizationController.getActiveOrganization();
    const inventoryPayload = inventoryController?.payload;
    const snapshotTime = new Date(bookingsSnapshotSavedAt).getTime();
    const snapshotCurrent = Number.isFinite(snapshotTime) && Date.now() - snapshotTime <= PROVIDER_CACHE_MAX_AGE;
    const synchronized = Boolean(currentUser && bookingCreationReady && navigator.onLine && snapshotCurrent && !bookingsSnapshotFromCache);
    const offline = Boolean(currentUser && !navigator.onLine);
    const offlineReadable = Boolean(offline && snapshotCurrent);
    const readable = synchronized || offlineReadable;
    const inventoryReady = Boolean(readable
      && inventoryPayload
      && inventoryController.availability === 'ready'
      && organization?.id
      && String(inventoryPayload.organization_id || '') === String(organization.id));
    const clientKeys = new Map();
    let nextClientKey = 1;
    const clientKey = item => {
      if (offline) return '';
      const phone = normalizePhone(item.client_phone);
      if (!phone) return '';
      if (!clientKeys.has(phone)) clientKeys.set(phone, `client-${nextClientKey++}`);
      return clientKeys.get(phone);
    };
    const marks = notificationMarks();
    const now = new Date();
    const nextDay = new Date(now.getTime() + 86400000);
    const notificationTasks = readable ? buildNotificationTasks().map(task => ({ ...task, mark:marks[task.key] || '' })) : [];
    return {
      authenticated:Boolean(currentUser),
      synchronized,
      offline,
      offlineReadable,
      readOnly:true,
      lastUpdatedAt:readable ? bookingsSnapshotSavedAt : '',
      snapshotSource:!readable ? 'unavailable' : bookingsSnapshotFromCache ? 'cache' : 'live',
      sessionGeneration,
      today:businessTodayIso(),
      selectedDate,
      organizationName:readable ? String(organization?.name || '') : '',
      dataQuality:{
        bookings:readable ? (bookingsSnapshotFromCache ? 'anonymized_cache' : 'server') : 'unavailable',
        outcomes:outcomesRemoteAvailable ? 'server' : bookingOutcomes.size ? 'local_fallback' : 'unavailable',
        notifications:notificationOutboxRemoteAvailable ? 'server' : 'local_fallback',
        team:readable && organizationController.availability === 'ready' ? 'server' : 'unavailable',
        inventory:inventoryReady ? 'server' : 'unavailable'
      },
      services:(readable ? ownServices : []).filter(item => item.active).map(item => ({
        id:String(item.id),
        name:serviceName(item.name || 'Услуга'),
        durationMinutes:providerAssistantNumber(item.duration_minutes, 60, 1, 480),
        defaultDurationMinutes:Number(item.duration_minutes) === 1 ? serviceDefaultDuration(item.id) : providerAssistantNumber(item.duration_minutes, 60, 1, 480),
        priceRub:providerAssistantNumber(item.price_rub),
        perMinute:Number(item.duration_minutes) === 1
      })),
      bookings:(readable ? allBookings : []).filter(item => !isScheduleBlock(item)).map(item => ({
        outcome:bookingOutcome(item).visit_status,
        paymentMethod:bookingOutcome(item).payment_method,
        amountRub:providerAssistantNumber(bookingOutcome(item).amount_rub),
        clientName:offline ? 'Клиент' : String(item.client_name || 'Клиент'),
        clientKey:clientKey(item),
        date:String(item.booking_date || ''),
        time:String(item.booking_time || '').slice(0, 5),
        durationMinutes:providerAssistantNumber(item.duration_minutes || item.services?.duration_minutes, 60, 1, 480),
        serviceId:String(item.service_id || ''),
        serviceName:serviceName(item.services?.name || 'Услуга'),
        status:String(item.status || 'confirmed')
      })),
      team:(readable ? organization?.members || [] : []).filter(item => item.active).map(item => ({
        name:String(item.display_name || 'Сотрудник'),
        role:String(item.role || '')
      })),
      notifications:readable ? {
        available:notificationSettingsRemoteAvailable || notificationOutboxRemoteAvailable,
        failed:notificationOutbox.filter(item => item.status === 'failed').length,
        pending:notificationOutbox.filter(item => item.status === 'pending' || item.status === 'sending').length,
        manualDue:notificationTasks.filter(task => task.dueAt <= now && task.mark !== 'sent').length,
        manualDueWithin24Hours:notificationTasks.filter(task => task.dueAt > now && task.dueAt <= nextDay && task.mark !== 'sent').length
      } : null,
      inventory:inventoryReady ? {
        enabled:Boolean(inventoryPayload.enabled),
        items:(inventoryPayload.items || []).filter(item => item.active).map(item => ({
          id:String(item.id),
          name:String(item.name || 'Материал'),
          unit:String(item.unit || ''),
          quantity:(inventoryPayload.balances || []).filter(row => String(row.inventory_item_id) === String(item.id)).reduce((sum, row) => sum + providerAssistantNumber(row.quantity), 0),
          lowStockThreshold:providerAssistantNumber(item.low_stock_threshold)
        })),
        usage:(inventoryPayload.usage || []).map(item => ({
          serviceId:String(item.service_id || ''),
          itemId:String(item.inventory_item_id || ''),
          quantity:providerAssistantNumber(item.quantity)
        }))
      } : null
    };
  },
  async findAvailableSlots(plan = {}) {
    const generation = sessionGeneration;
    const userId = currentUser?.id;
    if (!userId) return { ok:false, reason:'auth_required', slots:[] };
    if (!navigator.onLine || !bookingCreationReady || bookingsSnapshotFromCache) return { ok:false, reason:'not_synchronized', slots:[] };
    if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return { ok:false, reason:'invalid_request', slots:[] };
    const service = ownServices.find(item => item.active && String(item.id) === String(plan.serviceId || ''));
    const date = providerAssistantIsoDate(plan.date);
    const today = businessTodayIso();
    const latest = new Date(`${today}T12:00:00+04:00`);
    latest.setUTCDate(latest.getUTCDate() + 730);
    if (!service || !date || date < today || date > businessTodayIso(latest)) return { ok:false, reason:'invalid_request', slots:[] };
    const fixedDuration = providerAssistantNumber(service.duration_minutes, 60, 1, 480);
    const requestedDuration = Number(service.duration_minutes) === 1 ? Number(plan.durationMinutes || serviceDefaultDuration(service.id)) : fixedDuration;
    if (!Number.isFinite(requestedDuration) || !Number.isInteger(requestedDuration) || requestedDuration < 1 || requestedDuration > 480) return { ok:false, reason:'invalid_request', slots:[] };
    const duration = requestedDuration;
    const { data:sessionData, error:sessionError } = await db.auth.getSession();
    if (sessionError || !sessionIsCurrent(userId, generation) || sessionData?.session?.user?.id !== userId) return { ok:false, reason:'stale_session', slots:[] };
    const { data, error } = await getProviderAvailableSlots({ p_service:service.id, p_start:date, p_end:date });
    if (!sessionIsCurrent(userId, generation)) return { ok:false, reason:'stale_session', slots:[] };
    if (error) return { ok:false, reason:'request_failed', slots:[] };
    const currentMinute = date === today ? providerAssistantCurrentMinute() : -1;
    const slots = (Array.isArray(data) ? data : [])
      .filter(item => String(item?.booking_date || '') === date)
      .map(item => String(item.booking_time || '').slice(0, 5))
      .filter(time => /^([01]\d|2[0-3]):[0-5]\d$/.test(time)
        && minutesFromTime(time) > currentMinute
        && !bookingPlacementIssue({ id:'voice-assistant-candidate', duration_minutes:duration }, date, minutesFromTime(time)));
    return { ok:true, slots:[...new Set(slots)].slice(0, 24), durationMinutes:duration };
  },
  prepareBookingDraft(plan = {}) {
    const snapshotTime = new Date(bookingsSnapshotSavedAt).getTime();
    const offlineDraftAllowed = Boolean(currentUser && !navigator.onLine && Number.isFinite(snapshotTime) && Date.now() - snapshotTime <= PROVIDER_CACHE_MAX_AGE);
    const synchronized = Boolean(currentUser && navigator.onLine && bookingCreationReady && !bookingsSnapshotFromCache);
    if (!synchronized && !offlineDraftAllowed) return { ok:false, reason:'not_synchronized' };
    if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return { ok:false, reason:'invalid_request' };
    const date = providerAssistantIsoDate(plan.date);
    const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(plan.time || '')) ? String(plan.time) : '';
    const service = ownServices.find(item => item.active && String(item.id) === String(plan.serviceId || '')) || null;
    if (!date || date < businessTodayIso() || (plan.serviceId && !service)) return { ok:false, reason:'invalid_request' };
    const durationMinutes = service && Number(service.duration_minutes) === 1
      ? providerAssistantNumber(plan.durationMinutes || serviceDefaultDuration(service.id), serviceDefaultDuration(service.id), 1, 480)
      : undefined;
    setProviderView('bookings');
    selectScheduleDate(date);
    openNewBookingSheet(time, {
      clientName:String(plan.clientName || '').trim().slice(0, 80),
      serviceId:service?.id || '',
      date,
      durationMinutes
    });
    if (offlineDraftAllowed) {
      saveNewBookingDraft();
      const draftStatus = $('#newBookingDraftStatus');
      if (draftStatus) draftStatus.textContent = 'Офлайн-черновик сохранён в этой вкладке · время проверим после подключения';
      applyWriteAvailability();
    }
    return { ok:true, offline:offlineDraftAllowed };
  }
});
window.dispatchEvent(new CustomEvent('minuta:provider-assistant-ready'));

$('#loginForm').addEventListener('submit', login);
$$('[data-social-auth-login]').forEach(button => button.addEventListener('click', () => startProviderSocialLogin(button)));
$$('[data-social-auth-link]').forEach(button => button.addEventListener('click', () => startProviderSocialLink(button)));
$('#showPhoneLoginButton').addEventListener('click', showProviderPhoneLogin);
$('#providerPhoneLoginForm').addEventListener('submit', submitProviderPhoneLogin);
$('#providerPhoneLoginBack').addEventListener('click', resetProviderPhoneLogin);
$('#providerLoginResend').addEventListener('click', resendProviderLoginCode);
$('#providerLoginChangePhone').addEventListener('click', changeProviderLoginPhone);
$('#providerLoginPhone').addEventListener('input', event => { event.target.value = window.MinutaPhoneAuth?.formatPhone(event.target.value) || event.target.value; });
$('#providerLoginCode').addEventListener('input', event => { event.target.value = window.MinutaPhoneAuth?.formatCode(event.target.value) || event.target.value.replace(/\D/g, '').slice(0, 6); });
$('#signupForm').addEventListener('submit', signup);
$('#recoveryForm').addEventListener('submit', requestPasswordReset);
$('#resetPasswordForm').addEventListener('submit', completePasswordRecovery);
$('#serviceForm').addEventListener('submit', addService);
$('#serviceDuration').addEventListener('change', () => updateServiceDefaultDurationField('#serviceDuration', '#serviceDefaultDurationField', '#serviceDefaultDuration'));
bindServiceDefaultDurationPresets('[data-service-default-duration]', '#serviceDefaultDuration');
$('#portfolioForm').addEventListener('submit', savePortfolioItem);
$('#portfolioBeforeFile').addEventListener('change', event => handlePortfolioFile('before', event.target.files?.[0]));
$('#portfolioAfterFile').addEventListener('change', event => handlePortfolioFile('after', event.target.files?.[0]));
$('#portfolioConsent').addEventListener('change', updatePortfolioPublishControl);
$('#dayOffForm').addEventListener('submit', addDayOff);
$('#passwordForm').addEventListener('submit', changePassword);
$('#providerPhoneLinkForm').addEventListener('submit', submitProviderPhoneLink);
$('#providerPhoneLinkInput').addEventListener('input', event => { event.target.value = window.MinutaPhoneAuth?.formatPhone(event.target.value) || event.target.value; });
$('#providerPhoneLinkCode').addEventListener('input', event => { event.target.value = window.MinutaPhoneAuth?.formatCode(event.target.value) || event.target.value.replace(/\D/g, '').slice(0, 6); });
$('#bookingPolicyForm').addEventListener('submit', saveBookingPolicy);
$('#bookingBufferEnabled').addEventListener('change', event => { $('#bookingBufferDuration').hidden = !event.target.checked; });
$$('[data-booking-buffer-minutes]').forEach(button => button.addEventListener('click', () => {
  $('#bookingBufferMinutes').value = button.dataset.bookingBufferMinutes;
  $('#bookingBufferMinutes').focus();
}));
$('#visitorNotificationForm').addEventListener('submit', saveVisitorNotificationSettings);
$('#visitorNotificationsEnabled').addEventListener('change', saveVisitorNotificationSettings);
$('#visitorNotificationTestButton').addEventListener('click', testVisitorSystemNotification);
document.addEventListener('pointerdown', () => { if (bookingPolicy.visitor_notifications_enabled) void unlockVisitorNotificationSound(); }, { passive:true });
document.addEventListener('keydown', () => { if (bookingPolicy.visitor_notifications_enabled) void unlockVisitorNotificationSound(); });
$('#providerDisplayForm').addEventListener('change', saveDisplayPreferences);
$('.report-view-tabs')?.addEventListener('keydown', event => {
  const current = event.target.closest('[data-report-view]');
  if (!current || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const buttons = $$('[data-report-view]');
  const index = buttons.indexOf(current);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
  setReportSubview(buttons[next]?.dataset.reportView || 'overview', { focus:true });
});
$('#reportGoalsForm')?.addEventListener('submit', event => {
  event.preventDefault();
  saveReportGoals();
  window.setTimeout(() => $('#reportGoalsDialog')?.close(), 180);
});
$('#reportGoalsReset')?.addEventListener('click', () => {
  const defaults = DEFAULT_DISPLAY_PREFERENCES.analytics_goals;
  const fields = { reportGoalRevenue:defaults.revenue_rub, reportGoalUtilization:defaults.utilization_percent, reportGoalRepeat:defaults.repeat_percent, reportGoalCancellation:defaults.cancellation_percent };
  Object.entries(fields).forEach(([id, value]) => { const input = $(`#${id}`); if (input) input.value = String(value); });
  const status = $('#reportGoalsStatus');
  if (status) status.textContent = 'Установлены рекомендуемые значения. Нажмите «Сохранить цели».';
});
$('#reportGoalsDialog')?.addEventListener('click', event => { if (event.target === event.currentTarget) event.currentTarget.close(); });
$('#installAppButton').addEventListener('click', installProviderApp);
$('#desktopAppInstallButton').addEventListener('click', installProviderApp);
$('#providerFullscreenButton').addEventListener('click', toggleProviderFullscreen);
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
let clientSearchRenderFrame = 0;
let bookingSearchRenderFrame = 0;
$('#clientSearch').addEventListener('input', () => {
  clientRenderLimit = CLIENT_RENDER_PAGE_SIZE;
  window.cancelAnimationFrame(clientSearchRenderFrame);
  clientSearchRenderFrame = window.requestAnimationFrame(renderClients);
});
$('#bookingSearch').addEventListener('input', event => {
  bookingAnalyticsFilter = '';
  bookingAnalyticsScope = null;
  bookingSearchQuery = event.target.value;
  bookingRenderLimit = BOOKING_RENDER_PAGE_SIZE;
  updateBookingQueryTools();
  window.cancelAnimationFrame(bookingSearchRenderFrame);
  bookingSearchRenderFrame = window.requestAnimationFrame(renderBookings);
});
$('#bookingStatusFilter').addEventListener('change', event => {
  bookingAnalyticsFilter = '';
  bookingAnalyticsScope = null;
  bookingStatusFilter = event.target.value;
  bookingRenderLimit = BOOKING_RENDER_PAGE_SIZE;
  updateBookingQueryTools();
  renderBookings();
});
$('#bookingQueryReset').addEventListener('click', () => {
  bookingSearchQuery = '';
  bookingStatusFilter = 'all';
  bookingSourceFilter = 'all';
  bookingAnalyticsFilter = '';
  bookingAnalyticsScope = null;
  bookingRenderLimit = BOOKING_RENDER_PAGE_SIZE;
  $('#bookingSearch').value = '';
  $('#bookingStatusFilter').value = 'all';
  updateBookingQueryTools();
  renderBookings();
  $('#bookingSearch').focus();
});
$('#bookingSourceFilterChip').addEventListener('click', () => {
  bookingSourceFilter = 'all';
  bookingRenderLimit = BOOKING_RENDER_PAGE_SIZE;
  updateBookingQueryTools();
  renderBookings();
});
$('#providerBookings').addEventListener('click', event => {
  if (!event.target.closest('[data-load-more-bookings]')) return;
  bookingRenderLimit += BOOKING_RENDER_PAGE_SIZE;
  renderBookings();
});
$('#clientsList').addEventListener('click', event => {
  if (!event.target.closest('[data-load-more-clients]')) return;
  clientRenderLimit += CLIENT_RENDER_PAGE_SIZE;
  renderClients();
});
$('#repeatService').addEventListener('change', loadRepeatSlots);
$('#repeatDate').addEventListener('change', loadRepeatSlots);
$('#scheduleDatePicker').addEventListener('change', event => selectScheduleDate(event.target.value));
$('#forgotPasswordButton').addEventListener('click', showRecoveryRequest);
$('#retryPasswordRecovery').addEventListener('click', showRecoveryRequest);
$$('[data-back-to-login]').forEach(button => button.addEventListener('click', () => setAuthTab('login')));
$('#logoutButton').addEventListener('click', logout);
$('#manualSyncButton').addEventListener('click', manualSynchronizeProvider);
$('#syncState').addEventListener('click', () => { renderConnectionLog(); $('#connectionLogDialog').showModal(); });
$('#connectionLogRefresh').addEventListener('click', manualSynchronizeProvider);
$$('[data-close-connection-log]').forEach(button => button.addEventListener('click', () => $('#connectionLogDialog').close()));
$('#clearConnectionLog').addEventListener('click', () => { try { localStorage.removeItem(connectionLogKey()); } catch {} lastConnectionLogSignature = ''; renderConnectionLog(); });
$('#refreshNotifications').addEventListener('click', synchronizeProvider);
$('#reportPendingMetric')?.addEventListener('click', () => handleReportAction('pending'));
$('#reportPendingMetric')?.addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    handleReportAction('pending');
  }
});
$('#reportPerformerFilter')?.addEventListener('change', event => {
  reportPerformerFilter = event.target.value || 'all';
  try { localStorage.setItem(`minuta-report-performer:${reportOrganizationId()}`, reportPerformerFilter); } catch {}
  reportScopedBookingsState = { key:'', status:'idle', rows:[] };
  reportAvailabilityState = { key:'', status:'idle', availableMinutes:null, configured:0, total:0, complete:false };
  const range = reportRange();
  const previous = previousReportRange(range);
  loadReportScopedBookings({ start:previous?.start || range.start, end:reportForecastEnd(range) }, reportPerformerFilter);
  loadReportAvailability(range, reportPerformerFilter);
  updateReportFilterSummary();
  setReportFiltersExpanded(false);
});
$('#exportBookings').addEventListener('click', () => $('#reportExportDialog').showModal());
$$('[data-close-report-export]').forEach(button => button.addEventListener('click', () => $('#reportExportDialog').close()));
$('#reportExportDialog').addEventListener('click', event => { if (event.target === event.currentTarget) event.currentTarget.close(); });
$$('[data-report-export]').forEach(button => button.addEventListener('click', () => {
  const privacy = $('#reportExportPrivacy').value;
  $('#reportExportDialog').close();
  if (button.dataset.reportExport === 'xlsx') void exportBookingsXlsxInBackground(privacy);
  else if (button.dataset.reportExport === 'csv') exportBookingsCsv(privacy);
  else exportBookingsPdf(privacy);
}));
$('#reportCustomPeriod').addEventListener('submit', event => {
  event.preventDefault();
  const start = $('#reportDateFrom').value;
  const end = $('#reportDateTo').value;
  if (!start || !end || start > end) { notify('Проверьте даты отчёта'); return; }
  reportCustomStart = start;
  reportCustomEnd = end;
  loadSelectedReportData();
  renderAnalytics();
  setReportFiltersExpanded(false);
});
$('#openFreeSlots').addEventListener('click', freeSlotsController.open);
$('#newBookingButton').addEventListener('click', () => openNewBookingSheet('', { date:selectedDate, historical:selectedDate < businessTodayIso() }));
$('#mobileNewBookingButton').addEventListener('click', () => openNewBookingSheet('', { date:selectedDate, historical:selectedDate < businessTodayIso() }));
$('#saveSchedule').addEventListener('click', saveSchedule);
$('#dayOffAllDay').addEventListener('change', event => { $('#dayOffTime').hidden = event.target.checked; });
$('#monthlyScheduleMonth').min = businessTodayIso().slice(0, 7);
$('#monthlyScheduleMonth').addEventListener('change', event => {
  monthlyScheduleMonth = normalizeScheduleMonth(event.target.value);
  $('#monthlyScheduleStatus').textContent = '';
  renderMonthlySchedule();
});
$$('[data-monthly-schedule-shift]').forEach(button => button.addEventListener('click', () => {
  monthlyScheduleMonth = shiftScheduleMonth(monthlyScheduleMonth, button.dataset.monthlyScheduleShift);
  $('#monthlyScheduleStatus').textContent = '';
  renderMonthlySchedule();
}));
$('#monthlyScheduleGrid').addEventListener('click', event => {
  const button = event.target.closest('[data-monthly-schedule-date]');
  if (button) void toggleMonthlyScheduleDay(button.dataset.monthlyScheduleDate, button);
});
$('#slotInterval').addEventListener('change', event => { scheduleDirty = true; syncSlotIntervalOptions(event.target.value); });
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
  if (session?.user?.id && session.user.id === currentUser?.id) {
    currentUser = session.user;
    return;
  }
  setTimeout(() => handleSession(session), 0);
});
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  refreshInstallAppCard();
});
window.addEventListener('minuta-install-ready', () => {
  deferredInstallPrompt = window.MinutaPwaInstall?.currentPrompt?.() || deferredInstallPrompt;
  refreshInstallAppCard();
});
window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  window.MinutaPwaInstall?.clearPrompt?.();
  refreshInstallAppCard();
  notify('Приложение установлено');
});
document.addEventListener('fullscreenchange', refreshInstallAppCard);
window.matchMedia('(display-mode: standalone)').addEventListener?.('change', refreshInstallAppCard);
window.addEventListener('scroll', scheduleSectionNavigationUpdate, { passive:true });
window.addEventListener('resize', scheduleSectionNavigationUpdate);
if (typeof providerSectionMobileQuery.addEventListener === 'function') providerSectionMobileQuery.addEventListener('change', refreshSectionNavigation);
else providerSectionMobileQuery.addListener?.(refreshSectionNavigation);
window.addEventListener('popstate', () => {
  if (!currentUser || $('#dashboard').hidden) return;
  const nextFilter = restoreScheduleFilter();
  currentFilter = nextFilter;
  calendarView = nextFilter === 'day' ? restoreCalendarView() : 'day';
  journalMode = restoreJournalMode();
  selectedDate = restoreSelectedDate();
  $$('[data-filter]').forEach(button => {
    const active = button.dataset.filter === currentFilter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  setProviderView(providerViewFromLocation(), { historyMode:'none', focusHeading:true });
  updateCalendarViewControls();
  renderDateStrip();
  renderBookings();
});
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', event => {
  if (event.data?.type === 'open-provider-view' && PROVIDER_VIEW_ORDER.includes(event.data.view) && currentUser) setProviderView(event.data.view);
});
new MutationObserver(refreshSectionNavigation).observe($('#dashboard'), { attributes:true, subtree:true, attributeFilter:['hidden'] });
updateProviderClientLinks();
refreshSectionNavigation();
refreshInstallAppCard();
prepareProviderViewBeforeSession();
db.auth.getSession().then(({ data, error }) => {
  if (error) { showProviderStartupFailure(); return; }
  return recoveryMode ? showRecoveryReset() : handleSession(data.session);
}).catch(() => {
  if (document.documentElement.classList.contains('provider-booting')) showProviderStartupFailure();
  else setSyncState('warning', 'Не удалось обновить данные · повторите позже');
});
initializePhoneAuth();
initializeSocialAuth();
