const db = window.supabase.createClient(window.MINUTA_CONFIG.supabaseUrl, window.MINUTA_CONFIG.supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
let currentUser = null;
let currentFilter = 'day';
let journalMode = localStorage.getItem('massage-journal-mode') || 'timeline';
let selectedDate = localIsoDate(new Date());
let allBookings = [];
let ownServices = [];
let clientNotes = new Map();
let selectedClientPhone = '';
let repeatTime = '';
let scheduleRows = [];
let daysOff = [];
let recoveryMode = new URLSearchParams(location.hash.slice(1)).get('type') === 'recovery';
const weekdayNames = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];

function localIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
function normalizePhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  return digits;
}
function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}
function money(value) { return `${new Intl.NumberFormat('ru-RU').format(value)} ₽`; }
function serviceName(value) { return value === 'Общий массаж задней поверхности' ? 'Массаж задней поверхности тела' : value; }
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
  $$('[data-provider-panel]').forEach(panel => {
    const active = panel.dataset.providerPanel === view;
    panel.hidden = !active;
    panel.classList.toggle('active', active);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function setFilter(filter) {
  currentFilter = filter;
  if (filter !== 'day' && journalMode === 'timeline') journalMode = 'list';
  $$('[data-filter]').forEach(button => button.classList.toggle('active', button.dataset.filter === filter));
  updateJournalModeButtons();
  renderBookings();
}

function setJournalMode(mode) {
  journalMode = mode === 'list' ? 'list' : 'timeline';
  if (journalMode === 'timeline') currentFilter = 'day';
  localStorage.setItem('massage-journal-mode', journalMode);
  $$('[data-filter]').forEach(button => button.classList.toggle('active', button.dataset.filter === currentFilter));
  updateJournalModeButtons();
  renderBookings();
}

function updateJournalModeButtons() {
  $$('[data-journal-mode]').forEach(button => button.classList.toggle('active', button.dataset.journalMode === journalMode));
}

function renderDateStrip() {
  const today = new Date();
  const weekday = new Intl.DateTimeFormat('ru-RU', { weekday: 'short' });
  $('#dateStrip').innerHTML = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() + index);
    const iso = localIsoDate(date);
    const label = index === 0 ? 'Сегодня' : weekday.format(date).replace('.', '');
    return `<button type="button" class="${iso === selectedDate ? 'active' : ''}" data-booking-date="${iso}"><span>${label}</span><strong>${date.getDate()}</strong><small>${date.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '')}</small></button>`;
  }).join('');
}

function updateBookingStats() {
  const today = localIsoDate(new Date());
  const active = allBookings.filter(item => item.status !== 'cancelled');
  const todayCount = active.filter(item => item.booking_date === today).length;
  const newCount = active.filter(item => item.status === 'new' && item.booking_date >= today).length;
  $('#todayBookingsCount').textContent = String(todayCount);
  $('#newBookingsCount').textContent = String(newCount);
  $('#newBookingsBadge').textContent = String(newCount);
  $('#newBookingsBadge').hidden = newCount === 0;
}

function filteredBookings() {
  const today = localIsoDate(new Date());
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
    const itemEnd = itemStart + Number(item.services?.duration_minutes || 60);
    start = Math.min(start, Math.floor(itemStart / 60) * 60);
    end = Math.max(end, Math.ceil(itemEnd / 60) * 60);
  });
  if (end <= start) end = start + 60;
  return { start, end };
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
    const duration = Number(item.services?.duration_minutes || 60);
    const top = ((itemStart - start) / 60) * hourHeight;
    const height = Math.max(36, (duration / 60) * hourHeight - 4);
    const statusText = item.status === 'new' ? 'Новая' : item.status === 'confirmed' ? 'Подтверждена' : 'Отменена';
    const compact = height < 54 ? ' compact' : '';
    return `<button class="timeline-booking status-${item.status}${compact}" type="button" data-open-booking="${item.id}" style="top:${top + 2}px;height:${height}px" aria-label="${escapeHtml(serviceName(item.services?.name || 'Услуга'))}, ${String(item.booking_time).slice(0, 5)}">
      <span class="timeline-booking-time">${String(item.booking_time).slice(0, 5)}</span>
      <span class="timeline-booking-copy"><strong>${escapeHtml(serviceName(item.services?.name || 'Услуга'))}</strong><small>${escapeHtml(item.client_name)} · ${duration} мин</small></span>
      <span class="timeline-booking-status">${statusText}</span>
    </button>`;
  }).join('');
  holder.className = 'provider-bookings timeline-view';
  holder.innerHTML = `<div class="day-timeline" style="--timeline-height:${totalHeight}px"><div class="timeline-hours">${labels.join('')}</div><div class="timeline-stage">${lines.join('')}${cards || '<div class="timeline-empty-state"><span>✓</span><strong>День свободен</strong><small>Новых записей пока нет</small></div>'}</div></div>`;
}

function renderBookingList(items) {
  const holder = $('#providerBookings');
  holder.className = 'provider-bookings schedule-list';
  if (!items.length) {
    holder.innerHTML = '<div class="provider-empty schedule-empty"><span>✓</span><strong>Записей нет</strong><small>На выбранный период всё свободно.</small></div>';
    return;
  }
  const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', weekday: 'short' });
  holder.innerHTML = items.map(item => {
    const itemDate = new Date(`${item.booking_date}T12:00:00`);
    const time = String(item.booking_time).slice(0, 5);
    const statusText = item.status === 'new' ? 'Новая' : item.status === 'confirmed' ? 'Подтверждена' : 'Отменена';
    const phone = escapeHtml(String(item.client_phone || '').replace(/[^+\d]/g, ''));
    return `<article class="provider-booking status-${item.status}">
      <div class="booking-time-column"><strong>${time}</strong><span>${dateFormat.format(itemDate)}</span></div>
      <div class="booking-main"><div class="provider-booking-top"><h3>${escapeHtml(serviceName(item.services?.name || 'Услуга'))}</h3><span class="booking-status">${statusText}</span></div>
      <p><strong>${escapeHtml(item.client_name)}</strong><a href="tel:${phone}">${escapeHtml(item.client_phone)}</a></p>
      <small>${escapeHtml(item.booking_code)} · ${money(item.services?.price_rub || 0)}</small></div>
      ${item.status !== 'cancelled' ? `<div class="booking-actions">${item.status === 'new' ? `<button type="button" data-booking-status="confirmed" data-booking-id="${item.id}">Подтвердить</button>` : ''}<button class="danger" type="button" data-booking-status="cancelled" data-booking-id="${item.id}">Отменить</button></div>` : ''}
    </article>`;
  }).join('');
}

function openBookingSheet(id) {
  const item = allBookings.find(booking => booking.id === id);
  if (!item) return;
  const date = new Date(`${item.booking_date}T12:00:00`);
  const duration = Number(item.services?.duration_minutes || 60);
  const statusText = item.status === 'new' ? 'Новая запись' : item.status === 'confirmed' ? 'Подтверждена' : 'Отменена';
  const phone = escapeHtml(String(item.client_phone || '').replace(/[^+\d]/g, ''));
  $('#bookingSheetContent').innerHTML = `<small class="booking-sheet-kicker">${date.toLocaleDateString('ru-RU', { day:'numeric', month:'long', weekday:'long' })}</small>
    <h2 id="bookingSheetTitle">${escapeHtml(serviceName(item.services?.name || 'Услуга'))}</h2>
    <div class="booking-sheet-meta"><strong>${String(item.booking_time).slice(0, 5)}</strong><span>${duration} минут</span><span class="booking-status status-${item.status}">${statusText}</span></div>
    <div class="booking-sheet-client"><span>${escapeHtml(String(item.client_name || 'Клиент').slice(0, 1).toUpperCase())}</span><div><small>Клиент</small><strong>${escapeHtml(item.client_name)}</strong><a href="tel:${phone}">${escapeHtml(item.client_phone)}</a></div></div>
    <div class="booking-sheet-code"><span>Номер записи</span><strong>${escapeHtml(item.booking_code)}</strong><span>Стоимость</span><strong>${money(item.services?.price_rub || 0)}</strong></div>
    ${item.status !== 'cancelled' ? `<div class="booking-sheet-actions">${item.status === 'new' ? `<button class="primary" type="button" data-booking-status="confirmed" data-booking-id="${item.id}">Подтвердить</button>` : ''}<button class="secondary-button danger" type="button" data-booking-status="cancelled" data-booking-id="${item.id}">Отменить запись</button></div>` : ''}`;
  $('#bookingSheet').hidden = false;
  document.body.classList.add('booking-sheet-open');
}

function closeBookingSheet() {
  $('#bookingSheet').hidden = true;
  document.body.classList.remove('booking-sheet-open');
}

function renderBookings() {
  const holder = $('#providerBookings');
  const items = filteredBookings();
  const date = new Date(`${selectedDate}T12:00:00`);
  const today = localIsoDate(new Date());
  $('#selectedDateTitle').textContent = selectedDate === today ? 'Сегодня' : date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'long' });
  $('#selectedDateSummary').textContent = currentFilter === 'day'
    ? (items.length ? `${items.length} ${items.length === 1 ? 'запись' : items.length < 5 ? 'записи' : 'записей'}` : 'Свободный день')
    : (currentFilter === 'upcoming' ? 'Все будущие записи' : 'История записей');
  if (currentFilter === 'day' && journalMode === 'timeline') renderTimeline(items);
  else renderBookingList(items);
}

function buildClients() {
  const clients = new Map();
  allBookings.forEach(booking => {
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
    $('#clientsList').innerHTML = `<div class="provider-empty compact-empty"><span>♙</span><strong>${clients.length ? 'Ничего не найдено' : 'Клиентов пока нет'}</strong><small>${clients.length ? 'Попробуйте изменить запрос.' : 'Они появятся после первой записи.'}</small></div>`;
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
  const visits = client.bookings.filter(item => item.status !== 'cancelled' && new Date(`${item.booking_date}T${String(item.booking_time).slice(0,8)}`) < now).length;
  const upcoming = clientUpcoming(client);
  $('#clientVisits').textContent = String(visits);
  $('#clientNext').textContent = upcoming ? `${new Date(`${upcoming.booking_date}T12:00:00`).toLocaleDateString('ru-RU',{day:'numeric',month:'short'})} · ${String(upcoming.booking_time).slice(0,5)}` : 'Нет';
  $('#clientNote').value = clientNotes.get(phone) || '';
  $('#repeatDate').value = localIsoDate(new Date());
  $('#repeatDate').min = localIsoDate(new Date());
  repeatTime = '';
  populateRepeatServices();
  loadRepeatSlots();
  const history = [...client.bookings].sort((a,b) => `${b.booking_date}${b.booking_time}`.localeCompare(`${a.booking_date}${a.booking_time}`));
  $('#clientHistory').innerHTML = history.map(item => {
    const status = item.status === 'new' ? 'Новая' : item.status === 'confirmed' ? 'Подтверждена' : 'Отменена';
    return `<article class="client-history-item status-${item.status}"><div><strong>${escapeHtml(serviceName(item.services?.name || 'Услуга'))}</strong><small>${new Date(`${item.booking_date}T12:00:00`).toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'})} · ${String(item.booking_time).slice(0,5)}</small></div><span>${status}</span></article>`;
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
  const { data } = await db.from('client_notes').select('client_phone,note').eq('performer_id', currentUser.id);
  clientNotes = new Map((data || []).map(item => [item.client_phone, item.note]));
}

async function saveClientNote() {
  if (!selectedClientPhone) return;
  const note = $('#clientNote').value.trim();
  const { error } = await db.from('client_notes').upsert({ performer_id: currentUser.id, client_phone: selectedClientPhone, note, updated_at: new Date().toISOString() });
  if (error) { notify('Не удалось сохранить заметку'); return; }
  clientNotes.set(selectedClientPhone, note);
  notify('Заметка сохранена');
}

async function createRepeatBooking(event) {
  event.preventDefault();
  clearFormError('#repeatBookingError');
  const client = buildClients().find(item => item.phone === selectedClientPhone);
  if (!client || !repeatTime) { showFormError('#repeatBookingError', 'Выберите свободное время.'); return; }
  const button = event.submitter; button.disabled = true; button.textContent = 'Создаём…';
  const { error } = await db.rpc('provider_book_appointment', { p_service: $('#repeatService').value, p_date: $('#repeatDate').value, p_time: `${repeatTime}:00`, p_client_name: client.name, p_client_phone: client.displayPhone });
  button.disabled = false; button.textContent = 'Создать запись';
  if (error) { showFormError('#repeatBookingError', error.message?.includes('slot_unavailable') ? 'Это время уже заняли. Выберите другое.' : 'Не удалось создать запись.'); await loadRepeatSlots(); return; }
  notify('Повторная запись создана');
  await loadBookings();
}

async function handleSession(session) {
  currentUser = session?.user || null;
  if (recoveryMode) { showRecoveryReset(); return; }
  $('#authCard').hidden = Boolean(currentUser);
  $('#dashboard').hidden = !currentUser;
  if (!currentUser) return;
  const { data: profile } = await db.from('performer_profiles').select('display_name').eq('id', currentUser.id).single();
  const name = profile?.display_name || 'исполнитель';
  $('#welcomeName').textContent = `Здравствуйте, ${name}!`;
  $('#sidebarName').textContent = name;
  $('#userAvatar').textContent = name.slice(0, 1).toUpperCase();
  $('#accountEmail').textContent = currentUser.email || '';
  $('#todayLabel').textContent = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  renderDateStrip();
  await Promise.all([loadOwnServices(), loadBookings(), loadClientNotes(), loadSchedule(), loadDaysOff()]);
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
  await db.auth.signOut();
  history.replaceState({}, '', 'provider.html');
  setAuthTab('login');
  notify('Пароль изменён — войдите с новым паролем');
}

async function addService(event) {
  event.preventDefault();
  clearFormError('#serviceError');
  const name = $('#serviceName').value.trim();
  const price = Number($('#servicePrice').value);
  const duration = Number($('#serviceDuration').value);
  if (name.length < 2 || !Number.isFinite(price) || price < 0) {
    showFormError('#serviceError', 'Укажите название и корректную цену.');
    return;
  }
  const button = event.submitter;
  button.disabled = true;
  const { error } = await db.from('services').insert({ performer_id: currentUser.id, name, price_rub: Math.round(price), duration_minutes: duration, active: true });
  button.disabled = false;
  if (error) { showFormError('#serviceError', 'Не удалось добавить услугу.'); return; }
  event.target.reset();
  $('#serviceDuration').value = '60';
  notify('Услуга добавлена');
  await loadOwnServices();
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
  const { data, error } = await db.from('provider_schedule').select('*').eq('performer_id', currentUser.id).order('weekday');
  if (error) {
    $('#weeklySchedule').innerHTML = '<div class="provider-empty"><strong>Расписание пока недоступно</strong><small>Обновите страницу после настройки базы.</small></div>';
    return;
  }
  scheduleRows = data?.length ? data : Array.from({ length: 7 }, (_, index) => ({ performer_id: currentUser.id, weekday: index + 1, enabled: index > 0, start_time: '10:00', end_time: '20:00', break_start: null, break_end: null, slot_interval_minutes: 5 }));
  $('#slotInterval').value = String(scheduleRows[0]?.slot_interval_minutes || 5);
  renderSchedule();
  renderBookings();
}

async function saveSchedule() {
  clearFormError('#scheduleError');
  const interval = Number($('#slotInterval').value);
  const rows = $$('[data-schedule-day]').map(card => {
    const enabled = card.querySelector('[data-schedule-enabled]').checked;
    const hasBreak = enabled && card.querySelector('[data-schedule-break]').checked;
    return {
      performer_id: currentUser.id,
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
  button.disabled = true;
  button.textContent = 'Сохраняем…';
  const { error } = await db.from('provider_schedule').upsert(rows, { onConflict: 'performer_id,weekday' });
  button.disabled = false;
  button.textContent = 'Сохранить';
  if (error) { showFormError('#scheduleError', 'Не удалось сохранить расписание.'); return; }
  scheduleRows = rows;
  notify('Расписание сохранено');
}

function renderDaysOff() {
  const holder = $('#daysOffList');
  if (!daysOff.length) {
    holder.innerHTML = '<div class="provider-empty compact-empty"><span>✓</span><strong>Исключений нет</strong><small>Онлайн-запись работает по обычному расписанию.</small></div>';
    return;
  }
  holder.innerHTML = daysOff.map(item => {
    const date = new Date(`${item.off_date}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' });
    const period = item.all_day ? 'Весь день' : `${shortTime(item.start_time, '')}–${shortTime(item.end_time, '')}`;
    return `<article class="day-off-item"><div><strong>${date}</strong><span>${period}${item.note ? ` · ${escapeHtml(item.note)}` : ''}</span></div><button type="button" data-delete-day-off="${item.id}" aria-label="Удалить исключение">×</button></article>`;
  }).join('');
}

async function loadDaysOff() {
  const { data, error } = await db.from('provider_days_off').select('*').eq('performer_id', currentUser.id).gte('off_date', localIsoDate(new Date())).order('off_date');
  if (error) { $('#daysOffList').innerHTML = '<div class="provider-empty compact-empty">Не удалось загрузить исключения.</div>'; return; }
  daysOff = data || [];
  renderDaysOff();
}

async function addDayOff(event) {
  event.preventDefault();
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
  $('#dayOffDate').min = localIsoDate(new Date());
  notify('Исключение добавлено');
  await loadDaysOff();
}

async function loadOwnServices() {
  const list = $('#serviceManageList');
  list.innerHTML = '<div class="loading-state"><i></i><span>Загружаем…</span></div>';
  const { data, error } = await db.from('services').select('*').eq('performer_id', currentUser.id).order('created_at', { ascending: false });
  if (error) { list.innerHTML = '<div class="provider-empty">Не удалось загрузить услуги.</div>'; return; }
  ownServices = data || [];
  populateRepeatServices();
  const activeCount = ownServices.filter(item => item.active).length;
  $('#servicesCount').textContent = String(data.length);
  $('#servicesBadge').textContent = String(data.length);
  $('#activeServicesCount').textContent = String(activeCount);
  if (!data.length) {
    list.innerHTML = '<div class="provider-empty"><span>＋</span><strong>Услуг пока нет</strong><small>Добавьте первую — она сразу появится у клиентов.</small></div>';
    return;
  }
  list.innerHTML = data.map(item => `<article class="managed-service ${item.active ? '' : 'inactive'}"><div class="service-info"><span class="service-dot">✦</span><div><strong>${escapeHtml(serviceName(item.name))}</strong><small>${item.duration_minutes} мин · ${money(item.price_rub)}</small></div></div><div class="manage-actions"><button type="button" data-toggle-service="${item.id}" data-active="${item.active}">${item.active ? 'Скрыть' : 'Показать'}</button><button class="danger" type="button" data-delete-service="${item.id}">Удалить</button></div></article>`).join('');
}

async function loadBookings() {
  const holder = $('#providerBookings');
  holder.innerHTML = '<div class="loading-state"><i></i><span>Загружаем записи…</span></div>';
  const { data, error } = await db.from('bookings')
    .select('id,booking_code,service_id,client_name,client_phone,booking_date,booking_time,status,services(name,price_rub,duration_minutes)')
    .eq('performer_id', currentUser.id)
    .order('booking_date', { ascending: true })
    .order('booking_time', { ascending: true });
  if (error) { holder.innerHTML = '<div class="provider-empty">Не удалось загрузить записи.</div>'; return; }
  allBookings = data || [];
  updateBookingStats();
  renderBookings();
  renderClients();
  if (selectedClientPhone) renderClientDetail(selectedClientPhone);
}

document.addEventListener('click', async event => {
  const authTab = event.target.closest('[data-auth-tab]');
  const view = event.target.closest('[data-provider-view]');
  const filter = event.target.closest('[data-filter]');
  const journalView = event.target.closest('[data-journal-mode]');
  const date = event.target.closest('[data-booking-date]');
  const openBooking = event.target.closest('[data-open-booking]');
  const closeSheet = event.target.closest('[data-close-booking-sheet]');
  const toggle = event.target.closest('[data-toggle-service]');
  const remove = event.target.closest('[data-delete-service]');
  const removeDayOff = event.target.closest('[data-delete-day-off]');
  const booking = event.target.closest('[data-booking-status]');
  const client = event.target.closest('[data-client-phone]');
  const repeat = event.target.closest('[data-repeat-time]');
  if (authTab) setAuthTab(authTab.dataset.authTab);
  if (view) setProviderView(view.dataset.providerView);
  if (filter) setFilter(filter.dataset.filter);
  if (journalView) setJournalMode(journalView.dataset.journalMode);
  if (date) {
    selectedDate = date.dataset.bookingDate;
    renderDateStrip();
    setFilter('day');
  }
  if (openBooking) openBookingSheet(openBooking.dataset.openBooking);
  if (closeSheet) closeBookingSheet();
  if (client) renderClientDetail(client.dataset.clientPhone);
  if (repeat) {
    repeatTime = repeat.dataset.repeatTime;
    $$('[data-repeat-time]').forEach(button => button.classList.toggle('active', button.dataset.repeatTime === repeatTime));
  }
  if (toggle) {
    await db.from('services').update({ active: toggle.dataset.active !== 'true' }).eq('id', toggle.dataset.toggleService);
    notify('Услуга обновлена');
    await loadOwnServices();
  }
  if (remove && confirm('Удалить услугу? Если по ней есть записи, она будет только скрыта.')) {
    const { error } = await db.from('services').delete().eq('id', remove.dataset.deleteService);
    if (error) await db.from('services').update({ active: false }).eq('id', remove.dataset.deleteService);
    notify(error ? 'Услуга скрыта: по ней есть записи' : 'Услуга удалена');
    await loadOwnServices();
  }
  if (removeDayOff) {
    const { error } = await db.from('provider_days_off').delete().eq('id', removeDayOff.dataset.deleteDayOff);
    if (error) notify('Не удалось удалить исключение');
    else { notify('Исключение удалено'); await loadDaysOff(); }
  }
  if (booking) {
    await db.from('bookings').update({ status: booking.dataset.bookingStatus }).eq('id', booking.dataset.bookingId);
    closeBookingSheet();
    notify('Статус записи обновлён');
    await loadBookings();
  }
});

document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('#bookingSheet').hidden) closeBookingSheet(); });
updateJournalModeButtons();

$('#loginForm').addEventListener('submit', login);
$('#signupForm').addEventListener('submit', signup);
$('#recoveryForm').addEventListener('submit', requestPasswordReset);
$('#resetPasswordForm').addEventListener('submit', completePasswordRecovery);
$('#serviceForm').addEventListener('submit', addService);
$('#dayOffForm').addEventListener('submit', addDayOff);
$('#passwordForm').addEventListener('submit', changePassword);
$('#repeatBookingForm').addEventListener('submit', createRepeatBooking);
$('#saveClientNote').addEventListener('click', saveClientNote);
$('#clientSearch').addEventListener('input', renderClients);
$('#repeatService').addEventListener('change', loadRepeatSlots);
$('#repeatDate').addEventListener('change', loadRepeatSlots);
$('#forgotPasswordButton').addEventListener('click', showRecoveryRequest);
$$('[data-back-to-login]').forEach(button => button.addEventListener('click', () => setAuthTab('login')));
$('#logoutButton').addEventListener('click', () => db.auth.signOut());
$('#refreshBookings').addEventListener('click', loadBookings);
$('#saveSchedule').addEventListener('click', saveSchedule);
$('#dayOffAllDay').addEventListener('change', event => { $('#dayOffTime').hidden = event.target.checked; });
$('#dayOffDate').min = localIsoDate(new Date());
$('#weeklySchedule').addEventListener('change', event => {
  const card = event.target.closest('[data-schedule-day]');
  if (!card) return;
  if (event.target.matches('[data-schedule-enabled]')) {
    const enabled = event.target.checked;
    card.classList.toggle('disabled', !enabled);
    card.querySelectorAll('input[type="time"], [data-schedule-break]').forEach(input => { input.disabled = !enabled; });
    card.querySelector('.day-off-label').hidden = enabled;
    card.querySelector('.break-hours').hidden = !enabled || !card.querySelector('[data-schedule-break]').checked;
  }
  if (event.target.matches('[data-schedule-break]')) card.querySelector('.break-hours').hidden = !event.target.checked;
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
