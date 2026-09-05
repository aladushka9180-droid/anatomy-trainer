const db = window.supabase.createClient(window.MINUTA_CONFIG.supabaseUrl, window.MINUTA_CONFIG.supabaseKey);
const $ = selector => document.querySelector(selector);
const token = new URLSearchParams(location.search).get('token') || new URLSearchParams(location.hash.slice(1)).get('token') || '';
const organizationScope = new URLSearchParams(location.search).get('scope') === 'organization';
if (new URLSearchParams(location.search).has('token')) history.replaceState({}, '', `waitlist.html${organizationScope ? '?scope=organization' : ''}#token=${encodeURIComponent(token)}`);

function notify(message) { const toast = $('#toast'); toast.textContent = message; toast.hidden = false; clearTimeout(notify.timer); notify.timer = setTimeout(() => { toast.hidden = true; }, 2800); }
function localDate(value) { return new Date(`${value}T12:00:00`); }
function periodLabel(value) { return ({ any: 'Любое время', morning: 'Утро, 10:00–12:00', day: 'День, 12:00–17:00', evening: 'Вечер, 17:00–20:00' })[value] || 'Любое время'; }

function renderRequest(item) {
  const date = localDate(item.desired_date);
  const labels = { waiting: 'Ожидает', contacted: 'Мастер связался', booked: 'Запись создана', cancelled: 'Отменена', closed: 'Закрыта' };
  $('#waitlistManageService').textContent = item.service_name;
  $('#waitlistManagePerformer').textContent = [item.performer_name,item.location_name].filter(Boolean).join(' · ');
  if (organizationScope && item.organization_slug) {
    const bookingUrl = new URL('index.html',location.href);
    bookingUrl.searchParams.set('org',item.organization_slug);
    bookingUrl.searchParams.set('location',item.location_id);
    bookingUrl.searchParams.set('service',item.service_id);
    document.querySelectorAll('a[href="index.html"]').forEach(link => { link.href=bookingUrl.href; });
  }
  $('#waitlistManageCode').textContent = item.request_code;
  $('#waitlistManageStatus').textContent = labels[item.status] || item.status;
  $('#waitlistManageStatus').className = `manage-status status-${item.status}`;
  $('#waitlistManageDay').textContent = String(date.getDate());
  $('#waitlistManageMonth').textContent = date.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '');
  $('#waitlistManageDate').textContent = date.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  $('#waitlistManagePeriod').textContent = periodLabel(item.time_period);
  $('#cancelWaitlist').hidden = !['waiting', 'contacted'].includes(item.status);
}

async function loadRequest() {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return showError();
  const { data, error } = await db.rpc(organizationScope ? 'get_minuta_waitlist_request_v111' : 'get_waitlist_request', { p_token: token });
  if (error || !data?.length) return showError();
  $('#waitlistManageLoading').hidden = true;
  $('#waitlistManageContent').hidden = false;
  renderRequest(data[0]);
}

function showError() { $('#waitlistManageLoading').hidden = true; $('#waitlistManageError').hidden = false; }

$('#cancelWaitlist').addEventListener('click', async () => {
  if (!confirm('Отменить заявку в листе ожидания?')) return;
  const button = $('#cancelWaitlist'); button.disabled = true;
  const { error } = await db.rpc(organizationScope ? 'cancel_minuta_waitlist_request_v111' : 'cancel_waitlist_request', { p_token: token });
  button.disabled = false;
  if (error) { notify('Не удалось отменить заявку'); return; }
  notify('Заявка отменена');
  await loadRequest();
});

loadRequest();
