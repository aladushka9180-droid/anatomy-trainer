const db = window.supabase.createClient(window.MINUTA_CONFIG.supabaseUrl, window.MINUTA_CONFIG.supabaseKey);
const SESSION_KEY = 'minuta-client-session-v1';
const $ = selector => document.querySelector(selector);
let sessionToken = loadSessionToken();

function loadSessionToken() {
  try {
    const value = localStorage.getItem(SESSION_KEY) || '';
    return /^[0-9a-f]{64}$/i.test(value) ? value : '';
  } catch { return ''; }
}
function saveSessionToken(value) {
  sessionToken = value;
  try { localStorage.setItem(SESSION_KEY, value); } catch {}
}
function clearSessionToken() {
  sessionToken = '';
  try { localStorage.removeItem(SESSION_KEY); } catch {}
}
function escapeHtml(value) { return String(value || '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
function money(value) { return `${new Intl.NumberFormat('ru-RU').format(Number(value || 0))} ₽`; }
function formatPhone(value) { let digits = value.replace(/\D/g, '').slice(0, 11); if (!digits) return ''; if (digits[0] === '8') digits = `7${digits.slice(1)}`; if (digits[0] !== '7') digits = `7${digits}`.slice(0, 11); const part = digits.slice(1); return `+7${part.length ? ` (${part.slice(0, 3)}` : ''}${part.length >= 3 ? ')' : ''}${part.length > 3 ? ` ${part.slice(3, 6)}` : ''}${part.length > 6 ? `-${part.slice(6, 8)}` : ''}${part.length > 8 ? `-${part.slice(8, 10)}` : ''}`; }
function displayPhone(value) { return formatPhone(String(value || '')); }
function formatCode(value) { const raw = value.replace(/[^0-9a-f]/gi, '').toUpperCase().slice(0, 16); return raw.match(/.{1,4}/g)?.join('-') || ''; }
function serviceName(value) { return value === 'Общий массаж задней поверхности' ? 'Массаж задней поверхности тела' : value; }
function showError(element, text) { element.textContent = text; element.hidden = false; }
function notify(message) { const toast = $('#toast'); toast.textContent = message; toast.hidden = false; clearTimeout(notify.timer); notify.timer = setTimeout(() => { toast.hidden = true; }, 2800); }
function shareMessage(code) { return `Мои записи на массаж: ${new URL('my-bookings.html', location.href).href}\nТелефон: ${$('#clientAccountPhone').textContent || $('#clientLoginPhone').value}\nЛичный код: ${code}\nНе пересылайте код посторонним.`; }
function setShareLinks(code, whatsapp, telegram) { const text = shareMessage(code); whatsapp.href = `https://wa.me/?text=${encodeURIComponent(text)}`; telegram.href = `https://t.me/share/url?url=${encodeURIComponent(new URL('my-bookings.html', location.href).href)}&text=${encodeURIComponent(text)}`; }
function statusLabel(status) { return ({ new: 'Новая', confirmed: 'Подтверждена', completed: 'Завершена', cancelled: 'Отменена' })[status] || status; }
function paymentStatusLabel(status) { return ({ pending: 'ожидается', paid: 'оплачена', refunded: 'возвращена', not_required: 'не требуется' })[status] || status; }
function bookingDate(item) { const date = new Date(`${item.booking_date}T12:00:00`); return date.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
function bookingManageUrl(token) { const url = new URL('booking.html', location.href); url.hash = `token=${encodeURIComponent(token)}`; return url.href; }

function renderBookings(items) {
  const list = $('#clientBookingsList');
  list.hidden = !items.length;
  $('#clientBookingsEmpty').hidden = Boolean(items.length);
  list.innerHTML = items.map(item => `<article class="client-booking-item status-${escapeHtml(item.status)}"><div class="client-booking-item-head"><span>${escapeHtml(statusLabel(item.status))}</span><small>${escapeHtml(item.performer_name)}</small></div><h2>${escapeHtml(serviceName(item.service_name))}</h2><div class="client-booking-when"><strong>${escapeHtml(bookingDate(item))}</strong><span>${escapeHtml(String(item.booking_time).slice(0, 5))} · ${escapeHtml(item.duration_minutes)} мин</span></div><div class="client-booking-meta"><span>Стоимость <strong>${escapeHtml(money(item.price_rub))}</strong></span>${Number(item.deposit_amount_rub || 0) > 0 ? `<span>Предоплата <strong>${escapeHtml(paymentStatusLabel(item.payment_status))}</strong></span>` : ''}</div><a class="primary" href="${escapeHtml(bookingManageUrl(item.manage_token))}">${item.status === 'cancelled' ? 'Посмотреть запись' : 'Управлять записью'}</a></article>`).join('');
}

async function loadBookings() {
  $('#clientBookingsLoading').hidden = false;
  $('#clientBookingsError').hidden = true;
  const { data, error } = await db.rpc('get_client_bookings', { p_session_token: sessionToken });
  $('#clientBookingsLoading').hidden = true;
  if (error) { showError($('#clientBookingsError'), navigator.onLine ? 'Не удалось загрузить записи. Повторите попытку.' : 'Нет соединения с интернетом.'); return false; }
  renderBookings(data || []);
  return true;
}

async function openAccount() {
  if (!sessionToken) return false;
  $('#clientLoginCard').hidden = true;
  $('#clientBookingsCard').hidden = false;
  $('#clientBookingsLoading').hidden = false;
  const { data, error } = await db.rpc('restore_client_session', { p_session_token: sessionToken });
  const account = data?.[0];
  if (error || !account) { clearSessionToken(); $('#clientBookingsCard').hidden = true; $('#clientLoginCard').hidden = false; return false; }
  $('#clientAccountPhone').textContent = displayPhone(account.normalized_phone);
  await loadBookings();
  return true;
}

async function login(event) {
  event.preventDefault();
  const phone = $('#clientLoginPhone').value;
  const code = $('#clientLoginCode').value;
  const button = $('#clientLoginButton');
  $('#clientLoginError').hidden = true;
  if (phone.replace(/\D/g, '').length !== 11 || code.replace(/[^0-9a-f]/gi, '').length !== 16) { showError($('#clientLoginError'), 'Введите полный номер телефона и личный код.'); return; }
  button.disabled = true; button.textContent = 'Проверяем…';
  const { data, error } = await db.rpc('login_client_access', { p_phone: phone, p_code: code, p_device_name: navigator.userAgent.slice(0, 120) });
  button.disabled = false; button.textContent = 'Открыть мои записи';
  const result = data?.[0];
  if (error || !result || result.error_code) {
    showError($('#clientLoginError'), result?.error_code === 'login_rate_limited' ? 'Слишком много попыток. Повторите вход через 15 минут.' : 'Телефон или личный код не совпадают.');
    return;
  }
  saveSessionToken(result.session_token);
  await openAccount();
}

async function rotateCode() {
  if (!confirm('Создать новый личный код? Прежний код перестанет действовать.')) return;
  const button = $('#clientRotateCode'); button.disabled = true; button.textContent = 'Создаём…';
  const { data, error } = await db.rpc('rotate_client_access_code', { p_session_token: sessionToken });
  button.disabled = false; button.textContent = 'Новый личный код';
  if (error || !data) { notify('Не удалось создать новый код'); return; }
  $('#clientNewCode').textContent = data;
  setShareLinks(data, $('#clientCodeWhatsapp'), $('#clientCodeTelegram'));
  $('#clientCodeResult').hidden = false;
  $('#clientCodeResult').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function logout(options = {}) {
  const current = sessionToken;
  clearSessionToken();
  if (current && !options.localOnly) db.rpc('revoke_client_session', { p_session_token: current });
  $('#clientBookingsCard').hidden = true;
  $('#clientLoginCard').hidden = false;
  $('#clientLoginCode').value = '';
}

$('#clientLoginPhone').addEventListener('input', event => { event.target.value = formatPhone(event.target.value); });
$('#clientLoginCode').addEventListener('input', event => { event.target.value = formatCode(event.target.value); });
$('#clientLoginForm').addEventListener('submit', login);
$('#clientRefresh').addEventListener('click', loadBookings);
$('#clientRotateCode').addEventListener('click', rotateCode);
$('#clientLogout').addEventListener('click', logout);
window.addEventListener('online', () => { if (sessionToken) loadBookings(); });
openAccount();
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js?v=104'));
