const db = window.supabase.createClient(window.MINUTA_CONFIG.supabaseUrl, window.MINUTA_CONFIG.supabaseKey);
const SESSION_KEY = 'minuta-client-session-v1';
const $ = selector => document.querySelector(selector);
let sessionToken = loadSessionToken();
let bookingsByToken = new Map();
let currentReviewToken = '';
let currentReviewRating = 0;
let currentReviewEditing = false;

function loadSessionToken() {
  try {
    const value = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY) || '';
    localStorage.removeItem(SESSION_KEY);
    if (/^[0-9a-f]{64}$/i.test(value)) sessionStorage.setItem(SESSION_KEY, value);
    return /^[0-9a-f]{64}$/i.test(value) ? value : '';
  } catch { return ''; }
}
function saveSessionToken(value) {
  sessionToken = value;
  try {
    sessionStorage.setItem(SESSION_KEY, value);
    localStorage.removeItem(SESSION_KEY);
  } catch {}
}
function clearSessionToken() {
  sessionToken = '';
  try {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_KEY);
  } catch {}
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
function statusLabel(status) { return ({ new: 'Новая', confirmed: 'Подтверждена', completed: 'Завершена', no_show: 'Не пришли', cancelled: 'Отменена' })[status] || status; }
function paymentStatusLabel(status) { return ({ pending: 'ожидается', paid: 'оплачена', refunded: 'возвращена', not_required: 'не требуется' })[status] || status; }
function paymentSummary(item) {
  if (item.status === 'cancelled' && item.payment_status === 'pending' && (!item.refund_status || item.refund_status === 'not_required')) return 'оплата отменена';
  const refund = ({ pending: 'возврат оформляется', refunded: 'возвращена', denied: 'без возврата' })[item.refund_status];
  if (refund) return refund;
  if (item.payment_status === 'pending' && item.payment_due_at) {
    const deadline = new Date(item.payment_due_at);
    if (!Number.isNaN(deadline.getTime())) return `до ${deadline.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
  }
  return paymentStatusLabel(item.payment_status);
}
function bookingDate(item) { const date = new Date(`${item.booking_date}T12:00:00`); return date.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
function bookingManageUrl(token) { const url = new URL('booking.html', location.href); url.hash = `token=${encodeURIComponent(token)}`; return url.href; }
function repeatBookingUrl(serviceId) { const url = new URL('index.html', location.href); url.searchParams.set('service', serviceId); url.searchParams.set('repeat', '1'); return url.href; }
function ratingStars(value) { const rating = Math.max(0, Math.min(5, Number(value) || 0)); return `${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}`; }

function renderBookings(items) {
  const list = $('#clientBookingsList');
  list.hidden = !items.length;
  $('#clientBookingsEmpty').hidden = Boolean(items.length);
  bookingsByToken = new Map(items.map(item => [String(item.manage_token), item]));
  list.innerHTML = items.map(item => {
    const reviewed = Number(item.review_rating) > 0;
    const repeat = item.service_active && /^[0-9a-f-]{36}$/i.test(item.service_id || '')
      ? `<a class="client-booking-action repeat-action" href="${escapeHtml(repeatBookingUrl(item.service_id))}">Записаться снова</a>` : '';
    const review = item.review_eligible
      ? `<button class="client-booking-action review-action" type="button" data-open-review="${escapeHtml(item.manage_token)}">${reviewed ? 'Изменить отзыв' : 'Оставить отзыв'}</button>` : '';
    const reviewResult = reviewed ? `<div class="client-review-result"><span aria-label="Ваша оценка: ${item.review_rating} из 5">${ratingStars(item.review_rating)}</span>${item.review_text ? `<p>${escapeHtml(item.review_text)}</p>` : ''}</div>` : '';
    return `<article class="client-booking-item status-${escapeHtml(item.status)}"><div class="client-booking-item-head"><span>${escapeHtml(statusLabel(item.status))}</span><small>${escapeHtml(item.performer_name)}</small></div><h2>${escapeHtml(serviceName(item.service_name))}</h2><div class="client-booking-when"><strong>${escapeHtml(bookingDate(item))}</strong><span>${escapeHtml(String(item.booking_time).slice(0, 5))} · ${escapeHtml(item.duration_minutes)} мин</span></div><div class="client-booking-meta"><span>Стоимость <strong>${escapeHtml(money(item.price_rub))}</strong></span>${Number(item.deposit_amount_rub || 0) > 0 ? `<span>Предоплата <strong>${escapeHtml(paymentSummary(item))}</strong></span>` : ''}</div>${reviewResult}<div class="client-booking-actions"><a class="primary" href="${escapeHtml(bookingManageUrl(item.manage_token))}">${['cancelled', 'completed', 'no_show'].includes(item.status) ? 'Посмотреть запись' : 'Управлять записью'}</a>${repeat}${review}</div></article>`;
  }).join('');
}

async function loadBookings() {
  $('#clientBookingsLoading').hidden = false;
  $('#clientBookingsError').hidden = true;
  let data = null;
  let error = null;
  for (const rpcName of ['get_client_bookings_v3', 'get_client_bookings_v2', 'get_client_bookings']) {
    ({ data, error } = await db.rpc(rpcName, { p_session_token: sessionToken }));
    if (!error) break;
  }
  $('#clientBookingsLoading').hidden = true;
  if (error) { showError($('#clientBookingsError'), navigator.onLine ? 'Не удалось загрузить записи. Повторите попытку.' : 'Нет соединения с интернетом.'); return false; }
  renderBookings(data || []);
  return true;
}

function setReviewRating(value) {
  currentReviewRating = Number(value) || 0;
  document.querySelectorAll('[data-review-rating]').forEach(button => {
    const active = Number(button.dataset.reviewRating) <= currentReviewRating;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(Number(button.dataset.reviewRating) === currentReviewRating));
  });
  $('#reviewRatingHint').textContent = currentReviewRating ? `Ваша оценка: ${currentReviewRating} из 5` : 'Выберите оценку';
}

function openReview(token) {
  const item = bookingsByToken.get(String(token));
  if (!item?.review_eligible) return;
  currentReviewToken = String(token);
  currentReviewEditing = Number(item.review_rating) > 0;
  $('#reviewServiceName').textContent = serviceName(item.service_name);
  $('#reviewText').value = item.review_text || '';
  $('#reviewError').hidden = true;
  setReviewRating(Number(item.review_rating) || 0);
  $('#submitReview').textContent = currentReviewEditing ? 'Сохранить изменения' : 'Опубликовать отзыв';
  $('#reviewDialog').showModal();
}

async function submitReview(event) {
  event.preventDefault();
  const button = $('#submitReview');
  $('#reviewError').hidden = true;
  if (!currentReviewRating) { showError($('#reviewError'), 'Выберите оценку от 1 до 5.'); return; }
  button.disabled = true; button.textContent = 'Сохраняем…';
  const { error } = await db.rpc('submit_booking_review', { p_session_token: sessionToken, p_manage_token: currentReviewToken, p_rating: currentReviewRating, p_review_text: $('#reviewText').value });
  button.disabled = false; button.textContent = currentReviewEditing ? 'Сохранить изменения' : 'Опубликовать отзыв';
  if (error) { showError($('#reviewError'), navigator.onLine ? 'Не удалось сохранить отзыв. Повторите позже.' : 'Нет соединения с интернетом.'); return; }
  $('#reviewDialog').close();
  notify('Отзыв опубликован');
  await loadBookings();
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
$('#clientBookingsList').addEventListener('click', event => { const button = event.target.closest('[data-open-review]'); if (button) openReview(button.dataset.openReview); });
document.querySelectorAll('[data-review-rating]').forEach(button => button.addEventListener('click', () => setReviewRating(button.dataset.reviewRating)));
$('#reviewForm').addEventListener('submit', submitReview);
$('#closeReview').addEventListener('click', () => $('#reviewDialog').close());
window.addEventListener('online', () => { if (sessionToken) loadBookings(); });
openAccount();
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js?v=192'));
