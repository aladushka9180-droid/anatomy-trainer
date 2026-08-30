const services = [
  { id: 'haircut', name: 'Стрижка и укладка', duration: '60 мин', price: '2 500 ₽', symbol: '✂' },
  { id: 'manicure', name: 'Маникюр', duration: '90 мин', price: '2 200 ₽', symbol: '◇' },
  { id: 'brows', name: 'Оформление бровей', duration: '45 мин', price: '1 500 ₽', symbol: '⌁' }
];

const specialists = [
  { id: 'anna', name: 'Анна', role: 'топ-мастер', initial: 'А' },
  { id: 'maria', name: 'Мария', role: 'мастер', initial: 'М' }
];

const times = ['09:00','10:30','12:00','14:30','16:00','18:30'];
const storageKey = 'minuta-demo-bookings-v1';
const state = { step: 1, serviceId: services[0].id, specialistId: specialists[0].id, date: '', time: times[1] };

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function createDates() {
  const weekday = new Intl.DateTimeFormat('ru-RU', { weekday: 'short' });
  const full = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
  return Array.from({ length: 5 }, (_, index) => {
    const date = new Date();
    date.setHours(12,0,0,0);
    date.setDate(date.getDate() + index + 1);
    const iso = [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
    return { iso, day: date.getDate(), weekday: weekday.format(date).replace('.',''), label: full.format(date) };
  });
}

const dates = createDates();
state.date = dates[0].iso;

function renderOptions() {
  $('#services').innerHTML = services.map((item,index) => `
    <button class="option ${item.id === state.serviceId ? 'selected' : ''}" type="button" data-service="${item.id}" aria-pressed="${item.id === state.serviceId}">
      <span class="service-symbol service-${index+1}">${item.symbol}</span>
      <span class="option-main"><strong>${item.name}</strong><small>${item.duration}</small></span>
      <span class="option-price">${item.price}</span><span class="chevron">›</span>
    </button>`).join('');

  $('#specialists').innerHTML = specialists.map(item => `
    <button class="specialist ${item.id === state.specialistId ? 'selected' : ''}" type="button" data-specialist="${item.id}" aria-pressed="${item.id === state.specialistId}">
      <span class="avatar">${item.initial}</span><strong>${item.name}</strong><small>${item.role}</small>
    </button>`).join('');

  $('#dates').innerHTML = dates.map(item => `
    <button class="date ${item.iso === state.date ? 'selected' : ''}" type="button" data-date="${item.iso}" aria-label="${item.label}" aria-pressed="${item.iso === state.date}"><small>${item.weekday}</small><strong>${item.day}</strong></button>`).join('');

  $('#times').innerHTML = times.map(item => `<button class="time ${item === state.time ? 'selected' : ''}" type="button" data-time="${item}" aria-pressed="${item === state.time}">${item}</button>`).join('');
}

function showStep(step) {
  state.step = step;
  $$('.step').forEach(item => item.classList.toggle('active', Number(item.dataset.step) === step));
  $$('.progress i').forEach((item,index) => item.classList.toggle('active', index < step));
  $('#stepLabel').textContent = `Шаг ${step} из 3`;
  if (step === 3) renderSummary();
  $('.booking-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function selectedService() { return services.find(item => item.id === state.serviceId); }
function selectedSpecialist() { return specialists.find(item => item.id === state.specialistId); }
function selectedDate() { return dates.find(item => item.iso === state.date); }

function renderSummary() {
  const service = selectedService();
  $('#summary').innerHTML = `<small>Ваша запись</small><strong>${service.name} · ${service.price}</strong><span>${selectedSpecialist().name} · ${selectedDate().label} в ${state.time}</span>`;
}

function formatPhone(value) {
  let digits = value.replace(/\D/g,'').slice(0,11);
  if (!digits) return '';
  if (digits[0] === '8') digits = `7${digits.slice(1)}`;
  if (digits[0] !== '7') digits = `7${digits}`.slice(0,11);
  const p = digits.slice(1);
  return `+7${p.length ? ` (${p.slice(0,3)}` : ''}${p.length >= 3 ? ')' : ''}${p.length > 3 ? ` ${p.slice(3,6)}` : ''}${p.length > 6 ? `-${p.slice(6,8)}` : ''}${p.length > 8 ? `-${p.slice(8,10)}` : ''}`;
}

function readBookings() {
  try { return JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch { return []; }
}

function writeBookings(items) {
  localStorage.setItem(storageKey, JSON.stringify(items));
  updateBookingCount();
}

function updateBookingCount() {
  const count = readBookings().length;
  $('#bookingCount').textContent = String(count);
  $('#bookingCount').hidden = count === 0;
}

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return `MIN-${[...bytes].map(value => alphabet[value % alphabet.length]).join('')}`;
}

function submitBooking(event) {
  event.preventDefault();
  const name = $('#clientName').value.trim();
  const phone = $('#clientPhone').value;
  const error = $('#formError');
  if (name.length < 2 || phone.replace(/\D/g,'').length !== 11) {
    error.textContent = 'Укажите имя и полный номер телефона.';
    error.hidden = false;
    return;
  }
  error.hidden = true;
  const booking = {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    code: makeCode(), name, phone, service: selectedService().name,
    specialist: selectedSpecialist().name, date: state.date, dateLabel: selectedDate().label,
    time: state.time, price: selectedService().price, createdAt: new Date().toISOString()
  };
  writeBookings([booking, ...readBookings()]);
  $('#bookingFlow').hidden = true;
  $('#success').hidden = false;
  $('#successTitle').textContent = `До встречи, ${name.split(/\s+/)[0]}!`;
  $('#successDetails').innerHTML = `${booking.service} · ${booking.specialist}<br>${booking.dateLabel} в ${booking.time}`;
  $('#successCode').innerHTML = `Номер записи: <strong>${booking.code}</strong>`;
  $('.booking-card').scrollIntoView({ behavior:'smooth', block:'start' });
}

function resetFlow() {
  $('#success').hidden = true;
  $('#bookingFlow').hidden = false;
  $('#bookingForm').reset();
  $('#formError').hidden = true;
  showStep(1);
}

function renderBookings() {
  const items = readBookings();
  const list = $('#bookingsList');
  if (!items.length) {
    list.replaceChildren($('#emptyBookings').content.cloneNode(true));
    return;
  }
  list.innerHTML = items.map(item => `
    <article class="saved-booking">
      <div class="saved-booking-head"><strong>${item.service}</strong><span class="saved-code">${item.code}</span></div>
      <p>${item.specialist} · ${item.dateLabel} в ${item.time}<br>${item.name} · ${item.phone}</p>
      <button type="button" data-delete="${item.id}">Отменить запись</button>
    </article>`).join('');
}

document.addEventListener('click', event => {
  const service = event.target.closest('[data-service]');
  const specialist = event.target.closest('[data-specialist]');
  const date = event.target.closest('[data-date]');
  const time = event.target.closest('[data-time]');
  const next = event.target.closest('[data-next]');
  const back = event.target.closest('[data-back]');
  const remove = event.target.closest('[data-delete]');
  if (service) { state.serviceId = service.dataset.service; renderOptions(); }
  if (specialist) { state.specialistId = specialist.dataset.specialist; renderOptions(); }
  if (date) { state.date = date.dataset.date; renderOptions(); }
  if (time) { state.time = time.dataset.time; renderOptions(); }
  if (next) showStep(Number(next.dataset.next));
  if (back) showStep(Number(back.dataset.back));
  if (remove) {
    writeBookings(readBookings().filter(item => item.id !== remove.dataset.delete));
    renderBookings();
  }
});

$('#clientPhone').addEventListener('input', event => { event.target.value = formatPhone(event.target.value); });
$('#bookingForm').addEventListener('submit', submitBooking);
$('#newBooking').addEventListener('click', resetFlow);
$('#openBookings').addEventListener('click', () => { renderBookings(); $('#bookingsDialog').showModal(); });
$('#closeBookings').addEventListener('click', () => $('#bookingsDialog').close());
$('#bookingsDialog').addEventListener('click', event => { if (event.target === $('#bookingsDialog')) $('#bookingsDialog').close(); });

renderOptions();
updateBookingCount();
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js'));
