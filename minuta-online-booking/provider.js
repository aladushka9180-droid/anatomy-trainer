const db = window.supabase.createClient(window.MINUTA_CONFIG.supabaseUrl, window.MINUTA_CONFIG.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
const $ = selector => document.querySelector(selector); const $$ = selector => [...document.querySelectorAll(selector)];
let currentUser = null; let currentFilter = 'active';
function escapeHtml(value) { return String(value || '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char])); }
function money(value) { return `${new Intl.NumberFormat('ru-RU').format(value)} ₽`; }
function showFormError(id, message) { const el = $(id); el.textContent = message; el.hidden = false; }
function clearFormError(id) { $(id).hidden = true; }
function notify(message) { const toast = $('#toast'); toast.textContent = message; toast.hidden = false; clearTimeout(notify.timer); notify.timer = setTimeout(() => { toast.hidden = true; }, 2800); }
function setAuthTab(tab) { $$('[data-auth-tab]').forEach(button => button.classList.toggle('active', button.dataset.authTab === tab)); $('#loginForm').hidden = tab !== 'login'; $('#signupForm').hidden = tab !== 'signup'; }

async function handleSession(session) {
  currentUser = session?.user || null; $('#authCard').hidden = Boolean(currentUser); $('#dashboard').hidden = !currentUser; if (!currentUser) return;
  const { data: profile } = await db.from('performer_profiles').select('display_name').eq('id', currentUser.id).single();
  $('#welcomeName').textContent = `Здравствуйте, ${profile?.display_name || 'исполнитель'}!`; $('#accountEmail').textContent = currentUser.email || ''; await Promise.all([loadOwnServices(), loadBookings()]);
}

async function login(event) {
  event.preventDefault(); clearFormError('#loginError'); const button = event.submitter; button.disabled = true; button.textContent = 'Входим…';
  const { error } = await db.auth.signInWithPassword({ email: $('#loginEmail').value.trim(), password: $('#loginPassword').value }); button.disabled = false; button.textContent = 'Войти'; if (error) showFormError('#loginError', 'Неверный email или пароль.');
}

async function signup(event) {
  event.preventDefault(); clearFormError('#signupError'); const name = $('#signupName').value.trim(); if (name.length < 2) { showFormError('#signupError','Укажите имя исполнителя.'); return; }
  const button = event.submitter; button.disabled = true; button.textContent = 'Создаём…';
  const { data, error } = await db.auth.signUp({ email: $('#signupEmail').value.trim(), password: $('#signupPassword').value, options: { data: { display_name: name }, emailRedirectTo: new URL('provider.html', location.href).href } });
  button.disabled = false; button.textContent = 'Создать кабинет'; if (error) { showFormError('#signupError', error.message.includes('already') ? 'Этот email уже зарегистрирован.' : 'Не удалось создать кабинет. Проверьте данные.'); return; }
  if (!data.session) { notify('Проверьте почту и подтвердите регистрацию'); setAuthTab('login'); }
}

async function addService(event) {
  event.preventDefault(); clearFormError('#serviceError'); const name = $('#serviceName').value.trim(); const price = Number($('#servicePrice').value); const duration = Number($('#serviceDuration').value);
  if (name.length < 2 || !Number.isFinite(price) || price < 0) { showFormError('#serviceError','Укажите название и корректную цену.'); return; }
  const button = event.submitter; button.disabled = true; const { error } = await db.from('services').insert({ performer_id: currentUser.id, name, price_rub: Math.round(price), duration_minutes: duration, active: true }); button.disabled = false;
  if (error) { showFormError('#serviceError','Не удалось добавить услугу.'); return; } event.target.reset(); $('#serviceDuration').value = '60'; notify('Услуга добавлена'); await loadOwnServices();
}

async function loadOwnServices() {
  const list = $('#serviceManageList'); list.innerHTML = '<div class="loading-state"><i></i><span>Загружаем…</span></div>';
  const { data, error } = await db.from('services').select('*').eq('performer_id', currentUser.id).order('created_at', { ascending:false });
  if (error) { list.innerHTML = '<div class="provider-empty">Не удалось загрузить услуги.</div>'; return; } $('#servicesCount').textContent = String(data.length);
  if (!data.length) { list.innerHTML = '<div class="provider-empty"><strong>Услуг пока нет</strong><span>Добавьте первую — она сразу появится у клиентов.</span></div>'; return; }
  list.innerHTML = data.map(item => `<article class="managed-service ${item.active ? '' : 'inactive'}"><div><strong>${escapeHtml(item.name)}</strong><span>${item.duration_minutes} мин · ${money(item.price_rub)}</span></div><div class="manage-actions"><button type="button" data-toggle-service="${item.id}" data-active="${item.active}">${item.active ? 'Скрыть' : 'Показать'}</button><button class="danger" type="button" data-delete-service="${item.id}">Удалить</button></div></article>`).join('');
}

async function loadBookings() {
  const holder = $('#providerBookings'); holder.innerHTML = '<div class="loading-state"><i></i><span>Загружаем записи…</span></div>';
  let query = db.from('bookings').select('id,booking_code,client_name,client_phone,booking_date,booking_time,status,services(name,price_rub)').eq('performer_id',currentUser.id).order('booking_date',{ascending:true}).order('booking_time',{ascending:true});
  if (currentFilter === 'active') query = query.neq('status','cancelled').gte('booking_date', new Date().toISOString().slice(0,10)); const { data, error } = await query;
  if (error) { holder.innerHTML = '<div class="provider-empty">Не удалось загрузить записи.</div>'; return; } if (!data.length) { holder.innerHTML = '<div class="provider-empty"><strong>Записей пока нет</strong><span>Новые заявки клиентов появятся здесь.</span></div>'; return; }
  const dateFormat = new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',weekday:'short'});
  holder.innerHTML = data.map(item => { const date = new Date(`${item.booking_date}T12:00:00`); return `<article class="provider-booking status-${item.status}"><div class="provider-booking-top"><span class="booking-date">${dateFormat.format(date)} · ${String(item.booking_time).slice(0,5)}</span><span class="booking-status">${item.status === 'new' ? 'Новая' : item.status === 'confirmed' ? 'Подтверждена' : 'Отменена'}</span></div><h3>${escapeHtml(item.services?.name || 'Услуга')}</h3><p><strong>${escapeHtml(item.client_name)}</strong><a href="tel:${escapeHtml(item.client_phone.replace(/[^+\d]/g,''))}">${escapeHtml(item.client_phone)}</a></p><small>${escapeHtml(item.booking_code)} · ${money(item.services?.price_rub || 0)}</small>${item.status !== 'cancelled' ? `<div class="booking-actions">${item.status === 'new' ? `<button type="button" data-booking-status="confirmed" data-booking-id="${item.id}">Подтвердить</button>` : ''}<button class="danger" type="button" data-booking-status="cancelled" data-booking-id="${item.id}">Отменить</button></div>` : ''}</article>`; }).join('');
}

document.addEventListener('click', async event => {
  const authTab = event.target.closest('[data-auth-tab]'); const filter = event.target.closest('[data-filter]'); const toggle = event.target.closest('[data-toggle-service]'); const remove = event.target.closest('[data-delete-service]'); const booking = event.target.closest('[data-booking-status]');
  if (authTab) setAuthTab(authTab.dataset.authTab);
  if (filter) { currentFilter = filter.dataset.filter; $$('[data-filter]').forEach(button => button.classList.toggle('active',button===filter)); await loadBookings(); }
  if (toggle) { await db.from('services').update({active: toggle.dataset.active !== 'true'}).eq('id',toggle.dataset.toggleService); notify('Услуга обновлена'); await loadOwnServices(); }
  if (remove && confirm('Удалить услугу? Если по ней есть записи, она будет только скрыта.')) { const { error } = await db.from('services').delete().eq('id',remove.dataset.deleteService); if (error) await db.from('services').update({active:false}).eq('id',remove.dataset.deleteService); notify(error ? 'Услуга скрыта: по ней есть записи' : 'Услуга удалена'); await loadOwnServices(); }
  if (booking) { await db.from('bookings').update({status:booking.dataset.bookingStatus}).eq('id',booking.dataset.bookingId); notify('Статус записи обновлён'); await loadBookings(); }
});

$('#loginForm').addEventListener('submit',login); $('#signupForm').addEventListener('submit',signup); $('#serviceForm').addEventListener('submit',addService); $('#logoutButton').addEventListener('click',() => db.auth.signOut()); $('#refreshBookings').addEventListener('click',loadBookings);
db.auth.onAuthStateChange((_event,session) => setTimeout(() => handleSession(session),0)); db.auth.getSession().then(({data}) => handleSession(data.session));
