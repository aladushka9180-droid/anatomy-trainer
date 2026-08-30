const db = window.supabase.createClient(window.MINUTA_CONFIG.supabaseUrl, window.MINUTA_CONFIG.supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
let currentUser = null;
let currentFilter = 'day';
let selectedDate = localIsoDate(new Date());
let allBookings = [];

function localIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}
function money(value) { return `${new Intl.NumberFormat('ru-RU').format(value)} ₽`; }
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
  $$('[data-auth-tab]').forEach(button => button.classList.toggle('active', button.dataset.authTab === tab));
  $('#loginForm').hidden = tab !== 'login';
  $('#signupForm').hidden = tab !== 'signup';
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
  $$('[data-filter]').forEach(button => button.classList.toggle('active', button.dataset.filter === filter));
  renderBookings();
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

function renderBookings() {
  const holder = $('#providerBookings');
  const items = filteredBookings();
  const date = new Date(`${selectedDate}T12:00:00`);
  const today = localIsoDate(new Date());
  $('#selectedDateTitle').textContent = selectedDate === today ? 'Сегодня' : date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'long' });
  $('#selectedDateSummary').textContent = currentFilter === 'day'
    ? (items.length ? `${items.length} ${items.length === 1 ? 'запись' : items.length < 5 ? 'записи' : 'записей'}` : 'Свободный день')
    : (currentFilter === 'upcoming' ? 'Все будущие записи' : 'История записей');
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
      <div class="booking-main"><div class="provider-booking-top"><h3>${escapeHtml(item.services?.name || 'Услуга')}</h3><span class="booking-status">${statusText}</span></div>
      <p><strong>${escapeHtml(item.client_name)}</strong><a href="tel:${phone}">${escapeHtml(item.client_phone)}</a></p>
      <small>${escapeHtml(item.booking_code)} · ${money(item.services?.price_rub || 0)}</small></div>
      ${item.status !== 'cancelled' ? `<div class="booking-actions">${item.status === 'new' ? `<button type="button" data-booking-status="confirmed" data-booking-id="${item.id}">Подтвердить</button>` : ''}<button class="danger" type="button" data-booking-status="cancelled" data-booking-id="${item.id}">Отменить</button></div>` : ''}
    </article>`;
  }).join('');
}

async function handleSession(session) {
  currentUser = session?.user || null;
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
  await Promise.all([loadOwnServices(), loadBookings()]);
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

async function loadOwnServices() {
  const list = $('#serviceManageList');
  list.innerHTML = '<div class="loading-state"><i></i><span>Загружаем…</span></div>';
  const { data, error } = await db.from('services').select('*').eq('performer_id', currentUser.id).order('created_at', { ascending: false });
  if (error) { list.innerHTML = '<div class="provider-empty">Не удалось загрузить услуги.</div>'; return; }
  const activeCount = data.filter(item => item.active).length;
  $('#servicesCount').textContent = String(data.length);
  $('#servicesBadge').textContent = String(data.length);
  $('#activeServicesCount').textContent = String(activeCount);
  if (!data.length) {
    list.innerHTML = '<div class="provider-empty"><span>＋</span><strong>Услуг пока нет</strong><small>Добавьте первую — она сразу появится у клиентов.</small></div>';
    return;
  }
  list.innerHTML = data.map(item => `<article class="managed-service ${item.active ? '' : 'inactive'}"><div class="service-info"><span class="service-dot">✦</span><div><strong>${escapeHtml(item.name)}</strong><small>${item.duration_minutes} мин · ${money(item.price_rub)}</small></div></div><div class="manage-actions"><button type="button" data-toggle-service="${item.id}" data-active="${item.active}">${item.active ? 'Скрыть' : 'Показать'}</button><button class="danger" type="button" data-delete-service="${item.id}">Удалить</button></div></article>`).join('');
}

async function loadBookings() {
  const holder = $('#providerBookings');
  holder.innerHTML = '<div class="loading-state"><i></i><span>Загружаем записи…</span></div>';
  const { data, error } = await db.from('bookings')
    .select('id,booking_code,client_name,client_phone,booking_date,booking_time,status,services(name,price_rub)')
    .eq('performer_id', currentUser.id)
    .order('booking_date', { ascending: true })
    .order('booking_time', { ascending: true });
  if (error) { holder.innerHTML = '<div class="provider-empty">Не удалось загрузить записи.</div>'; return; }
  allBookings = data || [];
  updateBookingStats();
  renderBookings();
}

document.addEventListener('click', async event => {
  const authTab = event.target.closest('[data-auth-tab]');
  const view = event.target.closest('[data-provider-view]');
  const filter = event.target.closest('[data-filter]');
  const date = event.target.closest('[data-booking-date]');
  const toggle = event.target.closest('[data-toggle-service]');
  const remove = event.target.closest('[data-delete-service]');
  const booking = event.target.closest('[data-booking-status]');
  if (authTab) setAuthTab(authTab.dataset.authTab);
  if (view) setProviderView(view.dataset.providerView);
  if (filter) setFilter(filter.dataset.filter);
  if (date) {
    selectedDate = date.dataset.bookingDate;
    renderDateStrip();
    setFilter('day');
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
  if (booking) {
    await db.from('bookings').update({ status: booking.dataset.bookingStatus }).eq('id', booking.dataset.bookingId);
    notify('Статус записи обновлён');
    await loadBookings();
  }
});

$('#loginForm').addEventListener('submit', login);
$('#signupForm').addEventListener('submit', signup);
$('#serviceForm').addEventListener('submit', addService);
$('#logoutButton').addEventListener('click', () => db.auth.signOut());
$('#refreshBookings').addEventListener('click', loadBookings);
db.auth.onAuthStateChange((_event, session) => setTimeout(() => handleSession(session), 0));
db.auth.getSession().then(({ data }) => handleSession(data.session));
