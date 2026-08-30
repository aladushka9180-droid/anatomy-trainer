const db = window.supabase.createClient(window.MINUTA_CONFIG.supabaseUrl, window.MINUTA_CONFIG.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
const times = ['09:00','10:30','12:00','14:30','16:00','18:30'];
const state = { step: 1, services: [], serviceId: '', date: '', time: '', busyTimes: new Set() };
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function createDates() {
  const weekday = new Intl.DateTimeFormat('ru-RU', { weekday: 'short' });
  const full = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(); date.setHours(12,0,0,0); date.setDate(date.getDate() + index + 1);
    const iso = [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
    return { iso, day: date.getDate(), weekday: weekday.format(date).replace('.',''), label: full.format(date) };
  });
}

const dates = createDates(); state.date = dates[0].iso;
function money(value) { return `${new Intl.NumberFormat('ru-RU').format(value)} ₽`; }
function selectedService() { return state.services.find(item => item.id === state.serviceId); }
function selectedDate() { return dates.find(item => item.iso === state.date); }
function escapeHtml(value) { return String(value || '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char])); }

async function loadServices() {
  const holder = $('#services'); holder.innerHTML = '<div class="loading-state"><i></i><span>Загружаем услуги…</span></div>';
  const { data, error } = await db.from('services').select('id, performer_id, name, duration_minutes, price_rub, performer_profiles(display_name)').eq('active', true).order('created_at', { ascending: true });
  if (error) { holder.innerHTML = '<div class="empty-service"><strong>Не удалось загрузить услуги</strong><span>Проверьте интернет и обновите страницу.</span></div>'; return; }
  state.services = data || [];
  if (!state.services.some(item => item.id === state.serviceId)) state.serviceId = state.services[0]?.id || '';
  renderServices();
}

function renderServices() {
  const holder = $('#services');
  if (!state.services.length) {
    holder.innerHTML = '<div class="empty-service"><span class="empty-service-mark">＋</span><strong>Услуги скоро появятся</strong><span>Исполнитель ещё не добавил услуги в свой кабинет.</span><a href="provider.html">Войти исполнителю</a></div>';
    $('#toDate').disabled = true; return;
  }
  $('#toDate').disabled = false;
  holder.innerHTML = state.services.map((item,index) => `<button class="option ${item.id === state.serviceId ? 'selected' : ''}" type="button" data-service="${item.id}" aria-pressed="${item.id === state.serviceId}"><span class="service-symbol service-${(index % 3) + 1}">${['✦','◇','⌁'][index % 3]}</span><span class="option-main"><strong>${escapeHtml(item.name)}</strong><small>${item.duration_minutes} мин · ${escapeHtml(item.performer_profiles?.display_name || 'Мастер')}</small></span><span class="option-price">${money(item.price_rub)}</span><span class="chevron">›</span></button>`).join('');
}

function renderDates() { $('#dates').innerHTML = dates.map(item => `<button class="date ${item.iso === state.date ? 'selected' : ''}" type="button" data-date="${item.iso}" aria-label="${item.label}" aria-pressed="${item.iso === state.date}"><small>${item.weekday}</small><strong>${item.day}</strong></button>`).join(''); }
function renderTimes() {
  const free = times.filter(item => !state.busyTimes.has(item));
  if (!free.includes(state.time)) state.time = free[0] || '';
  $('#times').innerHTML = times.map(item => { const busy = state.busyTimes.has(item); return `<button class="time ${item === state.time ? 'selected' : ''}" type="button" data-time="${item}" aria-pressed="${item === state.time}" ${busy ? 'disabled' : ''}>${item}${busy ? '<small>занято</small>' : ''}</button>`; }).join('');
  $('#continueBooking').disabled = !state.time; $('#noTimes').hidden = Boolean(free.length);
}

async function loadBusyTimes() {
  const service = selectedService(); state.busyTimes = new Set(); renderTimes(); if (!service) return;
  const { data } = await db.rpc('get_busy_slots', { p_performer: service.performer_id, p_start: state.date, p_end: state.date });
  state.busyTimes = new Set((data || []).map(item => String(item.booking_time).slice(0,5))); renderTimes();
}

async function showStep(step) {
  state.step = step; $$('.step').forEach(item => item.classList.toggle('active', Number(item.dataset.step) === step)); $$('.progress i').forEach((item,index) => item.classList.toggle('active', index < step)); $('#stepLabel').textContent = `Шаг ${step} из 3`;
  if (step === 2) await loadBusyTimes(); if (step === 3) renderSummary(); $('.booking-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderSummary() { const service = selectedService(); $('#summary').innerHTML = `<small>Ваша запись</small><strong>${escapeHtml(service.name)} · ${money(service.price_rub)}</strong><span>${escapeHtml(service.performer_profiles?.display_name || 'Мастер')} · ${selectedDate().label} в ${state.time}</span>`; }
function formatPhone(value) { let digits = value.replace(/\D/g,'').slice(0,11); if (!digits) return ''; if (digits[0] === '8') digits = `7${digits.slice(1)}`; if (digits[0] !== '7') digits = `7${digits}`.slice(0,11); const p = digits.slice(1); return `+7${p.length ? ` (${p.slice(0,3)}` : ''}${p.length >= 3 ? ')' : ''}${p.length > 3 ? ` ${p.slice(3,6)}` : ''}${p.length > 6 ? `-${p.slice(6,8)}` : ''}${p.length > 8 ? `-${p.slice(8,10)}` : ''}`; }
function makeCode() { const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const bytes = new Uint8Array(5); crypto.getRandomValues(bytes); return `MIN-${[...bytes].map(value => alphabet[value % alphabet.length]).join('')}`; }
function showError(message) { $('#formError').textContent = message; $('#formError').hidden = false; }

async function submitBooking(event) {
  event.preventDefault(); const name = $('#clientName').value.trim(); const phone = $('#clientPhone').value; const service = selectedService();
  if (name.length < 2 || phone.replace(/\D/g,'').length !== 11) { showError('Укажите имя и полный номер телефона.'); return; }
  if (!service || !state.time) { showError('Выберите услугу и свободное время.'); return; }
  const submit = $('#submitBooking'); submit.disabled = true; submit.textContent = 'Сохраняем…'; $('#formError').hidden = true; const code = makeCode();
  const { error } = await db.from('bookings').insert({ booking_code: code, performer_id: service.performer_id, service_id: service.id, client_name: name, client_phone: phone, booking_date: state.date, booking_time: `${state.time}:00`, status: 'new' });
  submit.disabled = false; submit.textContent = 'Подтвердить запись';
  if (error) { if (error.code === '23505') { showError('Это время только что заняли. Выберите другое.'); await showStep(2); } else showError('Не удалось сохранить запись. Попробуйте ещё раз.'); return; }
  $('#bookingFlow').hidden = true; $('#success').hidden = false; $('#successTitle').textContent = `До встречи, ${name.split(/\s+/)[0]}!`; $('#successDetails').innerHTML = `${escapeHtml(service.name)} · ${escapeHtml(service.performer_profiles?.display_name || 'Мастер')}<br>${selectedDate().label} в ${state.time}`; $('#successCode').innerHTML = `Номер записи: <strong>${code}</strong>`; $('.booking-card').scrollIntoView({ behavior:'smooth', block:'start' });
}

function resetFlow() { $('#success').hidden = true; $('#bookingFlow').hidden = false; $('#bookingForm').reset(); $('#formError').hidden = true; state.time = ''; showStep(1); }
document.addEventListener('click', event => { const service = event.target.closest('[data-service]'); const date = event.target.closest('[data-date]'); const time = event.target.closest('[data-time]'); const next = event.target.closest('[data-next]'); const back = event.target.closest('[data-back]'); if (service) { state.serviceId = service.dataset.service; renderServices(); } if (date) { state.date = date.dataset.date; renderDates(); loadBusyTimes(); } if (time && !time.disabled) { state.time = time.dataset.time; renderTimes(); } if (next) showStep(Number(next.dataset.next)); if (back) showStep(Number(back.dataset.back)); });
$('#clientPhone').addEventListener('input', event => { event.target.value = formatPhone(event.target.value); }); $('#bookingForm').addEventListener('submit', submitBooking); $('#newBooking').addEventListener('click', resetFlow);
renderDates(); renderTimes(); loadServices(); if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js?v=5'));
