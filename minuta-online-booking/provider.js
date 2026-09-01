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
let currentUser = null;
let currentFilter = restoreScheduleFilter();
let notificationFilter = 'pending';
let reportPeriod = 'month';
let notificationTimer = null;
let journalMode = localStorage.getItem('massage-journal-mode') || 'timeline';
if (currentFilter !== 'day') journalMode = 'list';
let selectedDate = restoreSelectedDate();
let renderedBusinessToday = businessTodayIso();
let allBookings = [];
let bookingOutcomes = new Map();
let outcomesRemoteAvailable = false;
let bookingPolicy = { cancel_cutoff_hours: 12, reschedule_cutoff_hours: 12, max_reschedules: 2, deposit_enabled: false, deposit_amount_rub: 0, payment_url_template: '' };
let serverNotificationTemplates = {};
let serverNotificationMarks = {};
let notificationSettingsRemoteAvailable = false;
let notificationOutbox = [];
let notificationOutboxRemoteAvailable = false;
let ownServices = [];
let portfolioItems = [];
let portfolioRemoteAvailable = false;
let portfolioDraggedId = '';
let portfolioPhotoDrafts = { before: null, after: null };
let portfolioPreviewUrls = [];
let clientNotes = new Map();
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
  '#newBookingButton', '#saveSchedule', '#saveClientNote',
  '#serviceForm button[type="submit"]', '#dayOffForm button[type="submit"]',
  '#repeatBookingForm button[type="submit"]', '#bookingOutcomeForm button[type="submit"]',
  '#bookingPolicyForm button[type="submit"]', '#bookingPrepaymentForm button[type="submit"]',
  '#bookingEditForm button[type="submit"]', '#newBookingForm button[type="submit"]', '#serviceEditForm button[type="submit"]',
  '#portfolioForm button[type="submit"]', '[data-open-portfolio-editor]', '[data-edit-portfolio]', '[data-delete-portfolio]', '[data-portfolio-move]',
  '[data-retry-notification-outbox]',
  '[data-booking-status]', '[data-delete-service]', '[data-toggle-service]', '[data-delete-day-off]'
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
function isScheduleBlock(item) {
  return String(item?.client_phone || '').replace(/\D/g, '') === SCHEDULE_BLOCK_PHONE;
}
function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}
function money(value) { return `${new Intl.NumberFormat('ru-RU').format(value)} ₽`; }
function serviceName(value) { return value === 'Общий массаж задней поверхности' ? 'Массаж задней поверхности тела' : value; }
function uiIcon(name, className = '') { return `<svg class="ui-icon${className ? ` ${className}` : ''}" aria-hidden="true"><use href="ui-icons.svg#icon-${name}"></use></svg>`; }
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
function readLocalOutcomes() {
  try { return JSON.parse(localStorage.getItem(outcomeStorageKey())) || {}; }
  catch { return {}; }
}
function writeLocalOutcomes() {
  try { localStorage.setItem(outcomeStorageKey(), JSON.stringify(Object.fromEntries(bookingOutcomes))); }
  catch { notify('Не удалось сохранить результат визита'); }
}
function bookingOutcome(item) { return bookingOutcomes.get(item.id) || { visit_status: 'scheduled', payment_method: 'unpaid', amount_rub: 0 }; }
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
  if (outcome.visit_status === 'completed') return 'Состоялся';
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
function paymentMethodLabel(method) { return ({ cash: 'Наличные', card: 'Карта', transfer: 'Перевод', unpaid: 'Не оплачено' })[method] || 'Не оплачено'; }
function outcomeSummary(item) {
  const outcome = bookingOutcome(item);
  if (outcome.visit_status === 'no_show') return 'Клиент не пришёл';
  if (outcome.visit_status !== 'completed') return '';
  return `${paymentMethodLabel(outcome.payment_method)}${outcome.amount_rub ? ` · ${money(outcome.amount_rub)}` : ''}`;
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
  const completed = items.filter(item => bookingOutcome(item).visit_status === 'completed');
  const noShows = items.filter(item => bookingOutcome(item).visit_status === 'no_show');
  const cancelled = items.filter(item => item.status === 'cancelled');
  const revenue = completed.reduce((sum, item) => sum + Number(bookingOutcome(item).amount_rub || 0), 0);
  $('#reportRevenue').textContent = money(revenue);
  $('#reportCompleted').textContent = String(completed.length);
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
    return [item.booking_date, String(item.booking_time).slice(0, 5), item.client_name, block ? '' : item.client_phone, block ? 'Занятое время' : serviceName(item.services?.name || 'Услуга'), bookingStatus(item, true), block ? '—' : visit, block ? '—' : paymentMethodLabel(outcome.payment_method), block ? 0 : (outcome.amount_rub || 0), block ? 0 : (item.services?.price_rub || 0)];
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
  if (view === 'services' || view === 'portfolio' || view === 'settings' || view === 'analytics') $('.provider-mobile-nav [data-provider-view="more"]')?.classList.add('active');
  $$('[data-provider-panel]').forEach(panel => {
    const active = panel.dataset.providerPanel === view;
    panel.hidden = !active;
    panel.classList.toggle('active', active);
  });
  if (view === 'notifications') { renderNotificationTemplates(); renderNotifications(); }
  if (view === 'analytics') renderAnalytics();
  if (view === 'portfolio') renderPortfolio();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function setFilter(filter) {
  currentFilter = filter;
  if (filter !== 'day' && journalMode === 'timeline') journalMode = 'list';
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
  localStorage.setItem('massage-journal-mode', journalMode);
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

function renderTimeline(items) {
  const holder = $('#providerBookings');
  const { start, end } = timelineBounds(items);
  const hourHeight = window.matchMedia('(max-width: 760px)').matches ? 56 : 64;
  const totalHeight = ((end - start) / 60) * hourHeight;
  const labels = [];
  const lines = [];
  for (let minute = start; minute <= end; minute += 60) {
    const label = `${String(Math.floor(minute / 60)).padStart(2, '0')}:00`;
    const top = ((minute - start) / 60) * hourHeight;
    labels.push(`<span class="timeline-hour" style="top:${top}px">${label}</span>`);
    lines.push(`<i class="timeline-grid-line" style="top:${top}px" aria-hidden="true"></i>`);
  }
  const cards = items.map(item => {
    const itemStart = minutesFromTime(item.booking_time);
    const duration = Number(item.duration_minutes || item.services?.duration_minutes || 60);
    const top = ((itemStart - start) / 60) * hourHeight;
    const height = Math.max(36, (duration / 60) * hourHeight - 4);
    const statusText = bookingStatus(item);
    const statusClass = bookingStatusClass(item);
    const compact = height < 46 ? ' compact' : '';
    const block = isScheduleBlock(item);
    const note = block ? '' : bookingClientNote(item);
    const clientDetails = block ? 'Занятое время' : `${item.client_name} · ${item.client_phone} · ${duration} мин`;
    const ariaDetails = note ? `${clientDetails}, заметка: ${note}` : clientDetails;
    return `<button class="timeline-booking status-${statusClass}${compact}${note ? ' has-note' : ''}" type="button" data-open-booking="${item.id}" style="top:${top + 2}px;height:${height}px" aria-label="${escapeHtml(block ? (item.client_name || 'Занятое время') : serviceName(item.services?.name || 'Услуга'))}, ${String(item.booking_time).slice(0, 5)}, ${escapeHtml(ariaDetails)}">
      <span class="timeline-booking-time">${String(item.booking_time).slice(0, 5)}</span>
      <span class="timeline-booking-copy"><strong>${escapeHtml(block ? (item.client_name || 'Перерыв') : serviceName(item.services?.name || 'Услуга'))}</strong><small class="timeline-booking-client">${escapeHtml(clientDetails)}</small>${note ? `<small class="timeline-booking-note"><b>Заметка:</b> ${escapeHtml(note)}</small>` : ''}</span>
      <span class="timeline-booking-status">${statusText}</span>
    </button>`;
  }).join('');
  holder.className = 'provider-bookings timeline-view';
  holder.innerHTML = `<div class="day-timeline" style="--timeline-height:${totalHeight}px"><div class="timeline-hours">${labels.join('')}</div><div class="timeline-stage" data-create-booking-at data-timeline-start="${start}" data-timeline-end="${end}" aria-label="Нажмите на свободное время, чтобы создать запись">${lines.join('')}<span class="timeline-create-hint">${uiIcon('plus')} Нажмите на свободное время</span>${cards || `<div class="timeline-empty-state"><span>${uiIcon('plus')}</span><strong>День свободен</strong><small>Нажмите на нужное время, чтобы записать клиента или поставить перерыв</small></div>`}</div></div>`;
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
    const statusText = bookingStatus(item);
    const statusClass = bookingStatusClass(item);
    const phone = escapeHtml(String(item.client_phone || '').replace(/[^+\d]/g, ''));
    const whatsapp = escapeHtml(whatsappLink(item));
    const resultSummary = outcomeSummary(item);
    const block = isScheduleBlock(item);
    const note = block ? '' : bookingClientNote(item);
    return `<article class="provider-booking status-${statusClass}">
      <div class="booking-time-column"><strong>${time}</strong><span>${dateFormat.format(itemDate)}</span></div>
      <div class="booking-main"><div class="provider-booking-top"><h3>${escapeHtml(block ? (item.client_name || 'Перерыв') : serviceName(item.services?.name || 'Услуга'))}</h3><span class="booking-status">${statusText}</span></div>
      ${block ? `<p><strong>Занятое время</strong><span>${Number(item.duration_minutes || item.services?.duration_minutes || 60)} мин</span></p><small>Без клиента и телефона</small>` : `<p><strong>${escapeHtml(item.client_name)}</strong><a href="tel:${phone}">${escapeHtml(item.client_phone)}</a></p>${note ? `<small class="provider-booking-note"><b>Заметка:</b> ${escapeHtml(note)}</small>` : ''}<small>${money(item.services?.price_rub || 0)}</small>${Number(item.deposit_amount_rub || 0) > 0 ? `<span class="booking-prepayment-badge status-${escapeHtml(item.payment_status)}">Предоплата: ${item.payment_status === 'paid' ? 'получена' : item.payment_status === 'refunded' ? 'возвращена' : 'ожидается'}</span>` : ''}${resultSummary ? `<span class="booking-outcome-summary">${escapeHtml(resultSummary)}</span>` : ''}`}</div>
      ${item.status !== 'cancelled' && !bookingIsCompleted(item) ? `<div class="booking-actions">${whatsapp ? `<a class="whatsapp-action" href="${whatsapp}" target="_blank" rel="noopener noreferrer">WhatsApp</a>` : ''}<button type="button" data-edit-booking="${item.id}">Изменить</button><button class="danger" type="button" data-booking-status="cancelled" data-booking-id="${item.id}">${block ? 'Освободить' : 'Отменить'}</button></div>` : ''}
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
  const note = clientNotes.get(normalizePhone(item.client_phone)) || '';
  const outcome = bookingOutcome(item);
  const amount = Number(outcome.amount_rub || item.services?.price_rub || 0);
  $('#bookingSheet').classList.remove('booking-sheet-wide');
  if (isScheduleBlock(item)) {
    $('#bookingSheetContent').innerHTML = `<small class="booking-sheet-kicker">${date.toLocaleDateString('ru-RU', { day:'numeric', month:'long', weekday:'long' })}</small>
      <h2 id="bookingSheetTitle">${escapeHtml(item.client_name || 'Перерыв')}</h2>
      <div class="booking-sheet-meta"><strong>${String(item.booking_time).slice(0, 5)}</strong><span>${duration} минут</span><span class="booking-status status-block">Занято</span></div>
      <div class="booking-sheet-block"><span>◼</span><div><small>Блокировка времени</small><strong>Клиенты не смогут записаться на этот интервал.</strong></div></div>
      ${item.status !== 'cancelled' ? `<div class="booking-sheet-actions"><button class="primary" type="button" data-edit-booking="${item.id}">Изменить</button><button class="secondary-button danger" type="button" data-booking-status="cancelled" data-booking-id="${item.id}">Освободить время</button></div>` : ''}`;
    $('#bookingSheet').hidden = false;
    document.body.classList.add('booking-sheet-open');
    return;
  }
  $('#bookingSheetContent').innerHTML = `<small class="booking-sheet-kicker">${date.toLocaleDateString('ru-RU', { day:'numeric', month:'long', weekday:'long' })}</small>
    <h2 id="bookingSheetTitle">${escapeHtml(serviceName(item.services?.name || 'Услуга'))}</h2>
    <div class="booking-sheet-meta"><strong>${String(item.booking_time).slice(0, 5)}</strong><span>${duration} минут</span><span class="booking-status status-${statusClass}">${statusText}</span></div>
    <div class="booking-sheet-summary"><div class="booking-sheet-client"><span>${escapeHtml(String(item.client_name || 'Клиент').slice(0, 1).toUpperCase())}</span><div><small>Клиент</small><strong>${escapeHtml(item.client_name)}</strong><a href="tel:${phone}">${escapeHtml(item.client_phone)}</a></div></div><div class="booking-sheet-price"><small>Стоимость</small><strong>${money(item.services?.price_rub || 0)}</strong></div></div>
    <details class="booking-sheet-disclosure booking-note-disclosure" ${note ? 'open' : ''}>
      <summary><div><small>О клиенте</small><strong>Заметка</strong></div><span class="booking-note-state">${note ? 'Добавлена' : 'Добавить'}</span></summary>
      <form class="booking-sheet-note-editor" id="bookingSheetNoteForm" data-client-phone="${escapeHtml(normalizePhone(item.client_phone))}">
        <label class="sr-only" for="bookingSheetClientNote">Заметка о клиенте</label><textarea id="bookingSheetClientNote" maxlength="1000" rows="2" placeholder="Пожелания, особенности или важная информация">${escapeHtml(note)}</textarea>
        <button class="secondary-button" type="submit">Сохранить заметку</button>
      </form>
    </details>
    ${Number(item.deposit_amount_rub || 0) > 0 ? `<form class="booking-prepayment-form" id="bookingPrepaymentForm" data-booking-id="${item.id}"><div><small>До визита</small><h3>Предоплата ${money(item.deposit_amount_rub)}</h3></div><label>Статус<select id="bookingPrepaymentStatus"><option value="pending" ${item.payment_status === 'pending' ? 'selected' : ''}>Ожидается</option><option value="paid" ${item.payment_status === 'paid' ? 'selected' : ''}>Оплачено</option><option value="refunded" ${item.payment_status === 'refunded' ? 'selected' : ''}>Возвращено</option></select></label><button class="secondary-button" type="submit">Сохранить предоплату</button></form>` : ''}
    ${item.status !== 'cancelled' ? `<details class="booking-sheet-disclosure booking-outcome-disclosure" ${outcome.visit_status === 'scheduled' ? '' : 'open'}><summary><div><small>После визита</small><strong>Результат и оплата</strong></div><span>${uiIcon(outcome.visit_status === 'completed' ? 'check' : outcome.visit_status === 'no_show' ? 'close' : 'clock')}${outcome.visit_status === 'completed' ? 'Состоялся' : outcome.visit_status === 'no_show' ? 'Не пришёл' : 'Запланирован'}</span></summary><form class="booking-outcome-form" id="bookingOutcomeForm" data-booking-id="${item.id}"><label>Результат визита<select id="outcomeVisitStatus"><option value="scheduled" ${outcome.visit_status === 'scheduled' ? 'selected' : ''}>Запланирован</option><option value="completed" ${outcome.visit_status === 'completed' ? 'selected' : ''}>Состоялся</option><option value="no_show" ${outcome.visit_status === 'no_show' ? 'selected' : ''}>Клиент не пришёл</option></select></label><div class="booking-outcome-payment" id="outcomePaymentFields" ${outcome.visit_status === 'completed' ? '' : 'hidden'}><label>Оплата<select id="outcomePaymentMethod"><option value="unpaid" ${outcome.payment_method === 'unpaid' ? 'selected' : ''}>Не оплачено</option><option value="cash" ${outcome.payment_method === 'cash' ? 'selected' : ''}>Наличные</option><option value="transfer" ${outcome.payment_method === 'transfer' ? 'selected' : ''}>Перевод</option><option value="card" ${outcome.payment_method === 'card' ? 'selected' : ''}>Карта</option></select></label><label>Получено, ₽<input id="outcomeAmount" type="number" min="0" max="1000000" step="50" value="${amount}"></label></div><button class="primary" type="submit">Сохранить результат</button></form></details>` : ''}
    ${item.status !== 'cancelled' && !bookingIsCompleted(item) ? `<div class="booking-sheet-actions">${whatsapp ? `<a class="secondary-button whatsapp-action" href="${whatsapp}" target="_blank" rel="noopener noreferrer">WhatsApp</a>` : ''}${item.status === 'new' ? `<button class="primary" type="button" data-booking-status="confirmed" data-booking-id="${item.id}">Подтвердить</button>` : ''}<button class="secondary-button" type="button" data-edit-booking="${item.id}">Перенести</button><button class="booking-cancel-action" type="button" data-booking-status="cancelled" data-booking-id="${item.id}">Отменить запись</button></div>` : ''}`;
  $('#bookingSheet').hidden = false;
  document.body.classList.add('booking-sheet-open');
  $('#bookingOutcomeForm')?.addEventListener('submit', saveBookingOutcome);
  $('#bookingPrepaymentForm')?.addEventListener('submit', savePrepaymentStatus);
  $('#bookingSheetNoteForm')?.addEventListener('submit', saveBookingSheetNote);
  $('#outcomeVisitStatus')?.addEventListener('change', toggleOutcomePaymentFields);
  toggleOutcomePaymentFields();
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

function durationOptions(selected) {
  const durations = [...new Set([5, 10, 20, 30, 40, 60, 90, 120, 180, Number(selected)])].filter(value => value >= 5 && value <= 480).sort((a, b) => a - b);
  return durations.map(value => `<option value="${value}" ${value === Number(selected) ? 'selected' : ''}>${value} мин</option>`).join('');
}

function openServiceEditor(id) {
  const item = ownServices.find(service => service.id === id);
  if (!item) return;
  $('#bookingSheet').classList.remove('booking-sheet-wide');
  $('#bookingSheetContent').innerHTML = `<small class="booking-sheet-kicker">Редактирование услуги</small><h2 id="bookingSheetTitle">Настройте услугу</h2>
    <form class="booking-editor-form service-edit-form" id="serviceEditForm" data-service-id="${item.id}">
      <label>Название услуги<input id="editServiceName" maxlength="120" value="${escapeHtml(item.name)}" required></label>
      <div class="service-edit-row"><label>Длительность<select id="editServiceDuration" required>${durationOptions(item.duration_minutes)}</select></label><label>Цена, ₽<input id="editServicePrice" type="number" min="0" max="1000000" step="50" value="${item.price_rub}" required></label></div>
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
  if (name.length < 2 || !Number.isFinite(duration) || duration < 5 || duration > 480 || !Number.isFinite(price) || price < 0) {
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

function openBookingEditor(id) {
  const item = allBookings.find(booking => booking.id === id);
  if (!item) return;
  const block = isScheduleBlock(item);
  bookingEditTime = String(item.booking_time).slice(0, 5);
  $('#bookingSheet').classList.remove('booking-sheet-wide');
  $('#bookingSheetContent').innerHTML = `<div class="booking-editor-heading"><button class="booking-editor-back" type="button" data-back-booking="${item.id}">${uiIcon('arrow-left')}<span>К записи</span></button>
    <small class="booking-sheet-kicker">${block ? 'Занятое время' : 'Изменение записи'}</small></div><h2 id="bookingSheetTitle">${block ? 'Изменить перерыв' : 'Перенести или изменить'}</h2>
    <form class="booking-editor-form" id="bookingEditForm" data-booking-id="${item.id}">
      ${block ? `<label>Название<input id="editBookingBlockTitle" maxlength="80" value="${escapeHtml(item.client_name || 'Перерыв')}" required></label>` : ''}
      <label>${block ? 'Длительность' : 'Услуга'}<select id="editBookingService" required>${serviceOptions(item.service_id)}</select></label>
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
  const blockTitle = block ? ($('#editBookingBlockTitle')?.value.trim() || '') : '';
  if (!item || !service || !date || !bookingEditTime || (block && blockTitle.length < 2)) {
    showFormError('#bookingEditError', 'Выберите услугу, дату и свободное время.');
    return;
  }
  const button = event.submitter;
  button.disabled = true;
  button.textContent = 'Сохраняем…';
  const changes = { service_id: service.id, duration_minutes: service.duration_minutes, booking_date: date, booking_time: `${bookingEditTime}:00` };
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
  selectScheduleDate(date);
  await refreshAfterWrite();
  notify('Запись обновлена');
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
  $('#newBookingServiceCaption').textContent = block ? 'Длительность (по услуге)' : 'Услуга';
  $('#newBookingSubmit').textContent = block ? 'Занять время' : 'Создать запись';
  clearFormError('#newBookingError');
}

function openNewBookingSheet(preferredTime = '') {
  const services = ownServices.filter(item => item.active);
  const date = selectedDate < businessTodayIso() ? businessTodayIso() : selectedDate;
  newBookingTime = '';
  newBookingSlots = [];
  newBookingHour = '';
  newBookingPreferredTime = /^\d{2}:\d{2}$/.test(String(preferredTime)) ? String(preferredTime) : '';
  newBookingMode = 'client';
  $('#bookingSheet').classList.add('booking-sheet-wide');
  $('#bookingSheetContent').innerHTML = `<small class="booking-sheet-kicker">Ручное расписание</small><h2 id="bookingSheetTitle"><span id="newBookingSheetTitle">Новый клиент</span>${newBookingPreferredTime ? `<small class="booking-clicked-time">Выбрано в расписании: ${escapeHtml(newBookingPreferredTime)}</small>` : ''}</h2>
    ${services.length ? `<form class="booking-editor-form new-booking-form" id="newBookingForm">
      <div class="new-booking-mode-toggle" role="group" aria-label="Тип записи"><button class="active" type="button" data-new-booking-mode="client" aria-pressed="true">Клиент</button><button type="button" data-new-booking-mode="block" aria-pressed="false">Занять время</button></div>
      <div class="new-booking-layout">
        <section class="new-booking-section"><div class="new-booking-section-title"><span>1</span><div><strong>Клиент и услуга</strong><small>Основная информация о записи</small></div></div>
          <div id="newBookingClientFields"><div class="booking-client-fields"><label>Имя клиента<input id="newBookingName" maxlength="80" autocomplete="name" placeholder="Например, Анна" required></label><label>Телефон<input id="newBookingPhone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+7 (___) ___-__-__" required></label></div><label>Заметка о клиенте<textarea id="newBookingNote" maxlength="1000" rows="3" placeholder="Пожелания или важная информация — необязательно"></textarea></label></div>
          <div class="new-booking-block-fields" id="newBookingBlockFields" hidden><label>Название<input id="newBookingBlockTitle" maxlength="80" value="Перерыв" placeholder="Например, Обеденный перерыв"></label><p>Телефон не нужен. Время будет занято, и клиенты не смогут на него записаться.</p></div>
          <label><span id="newBookingServiceCaption">Услуга</span><select id="newBookingService" required>${serviceOptions(services[0].id, true)}</select></label>
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
  const note = block ? '' : $('#newBookingNote').value.trim();
  const normalizedPhone = normalizePhone(phone);
  if (!block && note) {
    await db.from('client_notes').upsert({ performer_id: userId, client_phone: normalizedPhone, note, updated_at: new Date().toISOString() });
    if (!sessionIsCurrent(userId, generation)) return;
    clientNotes.set(normalizedPhone, note);
  }
  selectScheduleDate(date);
  closeBookingSheet();
  await refreshAfterWrite();
  notify(block ? 'Время занято' : 'Новая запись создана');
}

function closeBookingSheet() {
  $('#bookingSheet').hidden = true;
  $('#bookingSheet').classList.remove('booking-sheet-wide');
  document.body.classList.remove('booking-sheet-open');
}

function renderBookings() {
  const holder = $('#providerBookings');
  const items = filteredBookings();
  const date = new Date(`${selectedDate}T12:00:00`);
  const today = businessTodayIso();
  $('#selectedDateTitle').textContent = selectedDate === today ? 'Сегодня' : date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'long' });
  const clientCount = items.filter(item => !isScheduleBlock(item)).length;
  const blockCount = items.filter(isScheduleBlock).length;
  const daySummary = [clientCount ? `${clientCount} ${clientCount === 1 ? 'запись' : clientCount < 5 ? 'записи' : 'записей'}` : '', blockCount ? `${blockCount} ${blockCount === 1 ? 'перерыв' : blockCount < 5 ? 'перерыва' : 'перерывов'}` : ''].filter(Boolean).join(' · ');
  $('#selectedDateSummary').textContent = currentFilter === 'day'
    ? (daySummary || 'Свободный день')
    : (currentFilter === 'upcoming' ? 'Все будущие записи' : 'История записей');
  if (currentFilter === 'day' && journalMode === 'timeline') renderTimeline(items);
  else renderBookingList(items);
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
    return `<button class="client-list-item ${client.phone === selectedClientPhone ? 'active' : ''}" type="button" data-client-phone="${client.phone}"><span class="client-list-avatar">${escapeHtml(client.name.slice(0,1).toUpperCase())}</span><span class="client-list-main"><strong>${escapeHtml(client.name)}</strong><small>${escapeHtml(client.displayPhone)}</small><i>${escapeHtml(nextText)}</i></span><b>${activeCount}</b></button>`;
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

async function loadBookingOutcomes() {
  const userId = currentUser?.id;
  const generation = sessionGeneration;
  if (!userId) return { ok: false, optional: true };
  const local = readLocalOutcomes();
  const { data, error } = await db.from('booking_outcomes').select('booking_id,visit_status,payment_method,amount_rub,updated_at').eq('performer_id', userId);
  if (!sessionIsCurrent(userId, generation)) return { ok: false, stale: true, optional: true };
  outcomesRemoteAvailable = !error;
  if (error) bookingOutcomes = new Map(Object.entries(local));
  else {
    bookingOutcomes = new Map((data || []).map(item => [item.booking_id, item]));
    Object.entries(local).forEach(([id, value]) => { if (!bookingOutcomes.has(id)) bookingOutcomes.set(id, value); });
  }
  renderBookings();
  renderClients();
  renderNotifications();
  renderAnalytics();
  if (selectedClientPhone) renderClientDetail(selectedClientPhone);
  return { ok: !error, optional: true };
}

function renderBookingPolicyForm() {
  if (!$('#bookingPolicyForm')) return;
  $('#cancelCutoffHours').value = String(bookingPolicy.cancel_cutoff_hours ?? 12);
  $('#rescheduleCutoffHours').value = String(bookingPolicy.reschedule_cutoff_hours ?? 12);
  $('#maxReschedules').value = String(bookingPolicy.max_reschedules ?? 2);
  $('#depositEnabled').checked = Boolean(bookingPolicy.deposit_enabled);
  $('#depositAmount').value = String(bookingPolicy.deposit_amount_rub || 0);
  $('#paymentUrlTemplate').value = bookingPolicy.payment_url_template || '';
  $('#depositSettings').hidden = !$('#depositEnabled').checked;
}

async function loadBookingSettings() {
  const userId = currentUser?.id;
  const generation = sessionGeneration;
  if (!userId) return { ok: false, optional: true };
  const [policyResult, templatesResult, marksResult, outboxResult] = await Promise.all([
    db.from('booking_policies').select('cancel_cutoff_hours,reschedule_cutoff_hours,max_reschedules,deposit_enabled,deposit_amount_rub,payment_url_template').eq('performer_id', userId).maybeSingle(),
    db.from('notification_templates').select('confirmation,reminder,cancellation').eq('performer_id', userId).maybeSingle(),
    db.from('notification_marks').select('task_key,status').eq('performer_id', userId),
    db.from('notification_outbox').select('id,event_key,booking_id,kind,channel,status,attempts,last_error_code,last_error,next_attempt_at,sent_at,created_at,updated_at').eq('performer_id', userId).order('created_at', { ascending: false }).limit(50)
  ]);
  if (!sessionIsCurrent(userId, generation)) return { ok: false, stale: true, optional: true };
  if (!policyResult.error && policyResult.data) bookingPolicy = policyResult.data;
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
    payment_url_template: $('#paymentUrlTemplate').value.trim()
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
  const { error } = await db.from('booking_policies').upsert(record, { onConflict: 'performer_id' });
  button.disabled = false;
  button.textContent = 'Сохранить правила';
  if (error) { showFormError('#bookingPolicyError', 'Не удалось сохранить правила.'); return; }
  bookingPolicy = record;
  renderBookingPolicyForm();
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

function toggleOutcomePaymentFields() {
  const form = $('#bookingOutcomeForm');
  if (!form) return;
  const completed = $('#outcomeVisitStatus').value === 'completed';
  $('#outcomePaymentFields').hidden = !completed;
  $('#outcomePaymentMethod').disabled = !completed;
  $('#outcomeAmount').disabled = !completed;
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
  const amount = completed && paymentMethod !== 'unpaid' ? Math.max(0, Math.round(Number($('#outcomeAmount').value) || 0)) : 0;
  const record = { booking_id: item.id, performer_id: userId, visit_status: visitStatus, payment_method: paymentMethod, amount_rub: amount, updated_at: new Date().toISOString() };
  const button = event.submitter;
  button.disabled = true;
  button.textContent = 'Сохраняем…';
  let remoteSaved = false;
  if (outcomesRemoteAvailable) {
    const { error } = await db.from('booking_outcomes').upsert(record, { onConflict: 'booking_id' });
    if (!sessionIsCurrent(userId, generation)) return;
    remoteSaved = !error;
    if (error) outcomesRemoteAvailable = false;
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
    .on('postgres_changes', { event: '*', schema: 'public', table: 'booking_outcomes', filter: `performer_id=eq.${currentUser.id}` }, scheduleBookingsReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'portfolio_items', filter: `performer_id=eq.${currentUser.id}` }, scheduleBookingsReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'portfolio_photos', filter: `performer_id=eq.${currentUser.id}` }, scheduleBookingsReload)
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
    const results = await Promise.all([loadBookings({ silent: true }), loadOwnServices({ silent: true }), loadSchedule(), loadDaysOff(), loadClientNotes(), loadBookingOutcomes(), loadBookingSettings(), loadPortfolio()]);
    if (!sessionIsCurrent(userId, generation)) return false;
    const requiredResults = results.filter(result => !result?.optional);
    const complete = requiredResults.every(result => result?.ok);
    const skipped = requiredResults.some(result => result?.skipped);
    const degraded = results.some(result => result?.optional && !result?.ok);
    setWritesAllowed(complete);
    if (complete) {
      setSyncState(skipped || degraded ? 'warning' : 'online', skipped ? 'Есть несохранённое расписание · серверная сверка приостановлена' : degraded ? 'Основные данные синхронизированы · результаты визитов доступны только на этом устройстве' : `Синхронизировано · ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`);
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
      if (key.startsWith(`massage-notifications-${userId}-`) || key === `massage-booking-outcomes-${userId}`) localStorage.removeItem(key);
    });
  } catch {}
}

async function logout() {
  const userId = currentUser?.id;
  ++sessionGeneration;
  synchronizationQueued = false;
  stopLiveUpdates();
  setWritesAllowed(false);
  await clearProviderDeviceData(userId);
  await db.auth.signOut();
}

async function handleSession(session) {
  const previousUserId = currentUser?.id;
  const generation = ++sessionGeneration;
  synchronizationQueued = false;
  stopLiveUpdates();
  $$('[data-operation-disabled]').forEach(control => {
    control.disabled = false;
    delete control.dataset.operationDisabled;
    if (control.id === 'saveSchedule') control.textContent = 'Сохранить';
  });
  setWritesAllowed(false);
  currentUser = session?.user || null;
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
    ownServices = [];
    portfolioItems = [];
    portfolioRemoteAvailable = false;
    scheduleRows = [];
    daysOff = [];
    clientNotes = new Map();
    bookingOutcomes = new Map();
    bookingPolicy = { cancel_cutoff_hours: 12, reschedule_cutoff_hours: 12, max_reschedules: 2, deposit_enabled: false, deposit_amount_rub: 0, payment_url_template: '' };
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
  if (name.length < 2 || !Number.isFinite(duration) || duration < 5 || duration > 480 || !Number.isFinite(price) || price < 0) {
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
  list.innerHTML = ownServices.map(item => `<article class="managed-service ${item.active ? '' : 'inactive'}"><button class="service-info service-edit-target" type="button" data-edit-service="${item.id}" aria-label="Изменить услугу ${escapeHtml(serviceName(item.name))}"><div><strong>${escapeHtml(serviceName(item.name))}</strong><small>${item.duration_minutes} мин · ${money(item.price_rub)}</small></div></button><div class="manage-actions"><button class="service-visibility-toggle" type="button" data-toggle-service="${item.id}" data-active="${item.active}" aria-label="${item.active ? 'Скрыть услугу от клиентов' : 'Показать услугу клиентам'}"><i aria-hidden="true"></i><span>${item.active ? 'Доступна' : 'Скрыта'}</span></button><details class="service-more"><summary aria-label="Другие действия">${uiIcon('more')}</summary><div><button class="danger" type="button" data-delete-service="${item.id}">${uiIcon('trash')}<span>Удалить</span></button></div></details></div></article>`).join('');
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
  const { data, error } = await db.from('bookings')
    .select('id,booking_code,service_id,client_name,client_phone,booking_date,booking_time,duration_minutes,status,created_at,reschedule_count,deposit_amount_rub,payment_status,payment_url,services(name,price_rub,duration_minutes)')
    .eq('performer_id', userId)
    .order('booking_date', { ascending: true })
    .order('booking_time', { ascending: true });
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
  await saveProviderCache('bookings', allBookings, userId);
  if (!sessionIsCurrent(userId, generation) || revision !== bookingsRequestRevision) return { ok: false, stale: true };
  renderBookingData();
  return { ok: true };
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
  if ((toggle || remove || removeDayOff || booking) && !requireWrites()) return;
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
$('#depositEnabled').addEventListener('change', event => { $('#depositSettings').hidden = !event.target.checked; });
$('#notificationTemplatesForm').addEventListener('submit', saveNotificationTemplates);
$('#repeatBookingForm').addEventListener('submit', createRepeatBooking);
$('#saveClientNote').addEventListener('click', saveClientNote);
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
db.auth.getSession().then(({ data }) => recoveryMode ? showRecoveryReset() : handleSession(data.session));
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js?v=61'));
