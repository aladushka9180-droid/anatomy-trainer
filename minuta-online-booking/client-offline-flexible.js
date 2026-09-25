(() => {
  const panel = document.querySelector('#clientOfflineFlexible');
  if (!panel || !window.supabase || !window.MINUTA_CONFIG) return;
  const form = panel.querySelector('form');
  const status = panel.querySelector('#clientOfflineFlexibleStatus');
  const catalogKey = `primetime-offline-catalog-v1:${new URLSearchParams(location.search).get('org') || window.MINUTA_CONFIG.defaultOrganizationSlug || 'default'}`;
  const queueKey = `primetime-offline-flexible-v1:${catalogKey}`;
  const assetsReadyKey = 'primetime-offline-flexible-assets-v943';
  const db = window.supabase.createClient(window.MINUTA_CONFIG.supabaseUrl, window.MINUTA_CONFIG.supabaseKey,
    { auth:{ persistSession:false, autoRefreshToken:false, detectSessionInUrl:false } });
  let syncing = false;
  let offlineAssetsReady = false;
  try { offlineAssetsReady = localStorage.getItem(assetsReadyKey) === 'ready'; } catch {}
  const read = key => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
  const esc = value => String(value || '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const setStatus = message => { status.textContent = message; status.hidden = !message; };
  const validTime = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value || '');
  function warmOfflinePage() {
    if (!navigator.onLine || !('serviceWorker' in navigator)) return;
    void navigator.serviceWorker.ready.then(registration => {
      if (!registration.active) return;
      const channel = new MessageChannel();
      channel.port1.onmessage = event => {
        if (event.data?.cache === 'massage-izhevsk-v943') {
          offlineAssetsReady = Boolean(event.data.ready);
          try {
            if (offlineAssetsReady) localStorage.setItem(assetsReadyKey, 'ready');
            else localStorage.removeItem(assetsReadyKey);
          } catch {}
          render();
        }
        channel.port1.close();
      };
      registration.active.postMessage({ type:'warm-client-flexible' }, [channel.port2]);
    }).catch(() => {});
  }
  const catalog = () => {
    const value = read(catalogKey);
    return value && Date.now() - Number(value.savedAt || 0) <= 7 * 86400000 && Array.isArray(value.services) ? value : null;
  };
  const queue = () => read(queueKey);
  const save = item => {
    try {
      localStorage.setItem(queueKey, JSON.stringify(item));
      return read(queueKey)?.id === item.id;
    } catch { return false; }
  };
  function render() {
    const snapshot = catalog();
    const item = queue();
    panel.hidden = navigator.onLine && !item;
    form.hidden = Boolean(item) || !snapshot || !offlineAssetsReady || navigator.onLine;
    if (item) {
      setStatus(item.status === 'conflict'
        ? item.reason === 'cancelled'
          ? 'Запись была отменена после создания. Выберите новое время.'
          : item.reason === 'service_terms_changed'
          ? 'Условия услуги изменились. Запись не создана. Обновите страницу при подключении и выберите заново.'
          : 'В указанном интервале запись не создана. Удалите запрос и выберите другое время.'
        : item.status === 'confirmed'
          ? `Запись подтверждена сервером: ${item.date}, ${item.confirmedTime}.`
          : 'Запрос сохранён на устройстве. Ждём проверки сервера; запись пока не подтверждена.');
    } else if (!navigator.onLine) {
      setStatus(snapshot && offlineAssetsReady ? 'Без интернета можно оставить один запрос с гибким временем. Подтверждение появится после проверки сервером.'
        : snapshot ? 'Офлайн-форма ещё не подготовлена. Подключитесь к интернету и дождитесь загрузки страницы услуг.'
        : 'Для офлайн-запроса сначала один раз откройте страницу услуг при подключённом интернете.');
    } else setStatus('');
    panel.querySelector('#clientOfflineFlexibleRemove').hidden = !item;
    if (!snapshot || item) return;
    const serviceSelect = form.elements.service;
    const locationSelect = form.elements.location;
    const currentService = serviceSelect.value;
    serviceSelect.innerHTML = '<option value="">Выберите услугу</option>' + snapshot.services.map(service =>
      `<option value="${esc(service.id)}">${esc(service.name)}</option>`).join('');
    if (snapshot.services.some(service => service.id === currentService)) serviceSelect.value = currentService;
    locationSelect.closest('label').hidden = !snapshot.teamMode;
    locationSelect.innerHTML = '<option value="">Выберите филиал</option>' + snapshot.locations.map(location =>
      `<option value="${esc(location.id)}">${esc(location.name || 'Филиал')}</option>`).join('');
  }
  async function flush() {
    const item = queue();
    if (!item || item.status === 'conflict' || item.status === 'confirmed' || !navigator.onLine || syncing) return;
    syncing = true;
    setStatus('Проверяем запрос на сервере. Запись пока не подтверждена.');
    try {
      const { data, error } = await db.rpc('book_flexible_appointment_v180', {
        p_request_id:item.id, p_service:item.serviceId, p_date:item.date,
        p_earliest:`${item.earliest}:00`, p_latest:`${item.latest}:00`,
        p_client_name:item.name, p_client_phone:item.phone,
        p_slug:item.slug || null, p_location:item.locationId || null,
        p_expected_price_rub:item.slug ? item.priceRub : null,
        p_expected_duration_minutes:item.slug ? item.durationMinutes : null, p_kind:'public'
      });
      if (error) {
        if (['PGRST202','42883'].includes(error.code)) setStatus('Серверное подтверждение гибкого времени пока недоступно. Запрос остался на устройстве.');
        else if (['22023','23505','42501'].includes(error.code) || error.code === 'P0001') {
          item.status = 'conflict'; save(item); render();
        } else setStatus('Связь с сервером прервалась. Проверим тот же запрос после подключения.');
        return;
      }
      if (['no_slot_in_range','service_terms_changed','booking_deleted'].includes(data?.result_code)) {
        item.status = 'conflict'; item.reason = data.result_code === 'booking_deleted' ? 'cancelled' : data.result_code; save(item); render(); return;
      }
      if (data?.result_code !== 'ok' || !data.manage_token || !data.booking_time) {
        setStatus('Результат не подтверждён. Проверим тот же запрос повторно.'); return;
      }
      const checked = await db.rpc('get_booking_management', { p_token:data.manage_token });
      const booking = checked.data?.[0];
      if (booking?.status === 'cancelled') {
        item.status = 'conflict'; item.reason = 'cancelled'; save(item); render(); return;
      }
      const confirmedTime = String(booking?.booking_time || '').slice(0,5);
      if (checked.error || booking?.booking_code !== data.booking_code
          || booking?.booking_date !== item.date || confirmedTime < item.earliest
          || confirmedTime > item.latest || !['new','confirmed'].includes(booking?.status)) {
        setStatus('Запись принята сервером, проверяем итоговый статус.'); return;
      }
      void db.rpc('record_minuta_booking_legal_acceptance_v110', {
        p_token:data.manage_token, p_privacy_version:'2026-09-05', p_terms_version:'2026-09-05'
      }).catch(() => {});
      item.status = 'confirmed';
      item.confirmedTime = confirmedTime;
      item.name = ''; item.phone = '';
      save(item);
      render();
    } catch { setStatus('Связь с сервером прервалась. Проверим тот же запрос после подключения.'); }
    finally { syncing = false; }
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    const snapshot = catalog();
    if (navigator.onLine || !snapshot || !offlineAssetsReady || queue()) return;
    const service = snapshot.services.find(value => value.id === form.elements.service.value);
    const locationId = form.elements.location.value;
    const earliest = form.elements.earliest.value;
    const latest = form.elements.latest.value;
    const date = form.elements.date.value;
    const name = form.elements.namedItem('name').value.trim();
    const phone = form.elements.namedItem('phone').value.trim();
    const today = new Intl.DateTimeFormat('en-CA',{ timeZone:'Europe/Samara', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
    const max = new Date(`${today}T12:00:00Z`); max.setUTCDate(max.getUTCDate()+14);
    if (!service || (snapshot.teamMode && !snapshot.locations.some(value => value.id === locationId))
        || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today || date > max.toISOString().slice(0,10)
        || !validTime(earliest) || !validTime(latest) || latest < earliest
        || name.length < 2 || phone.replace(/\D/g,'').length < 10 || !form.elements.consent.checked) {
      setStatus('Проверьте услугу, филиал, дату, границы времени, контакты и согласие.'); return;
    }
    if (Array.isArray(service.locationIds) && snapshot.teamMode && !service.locationIds.includes(locationId)) {
      setStatus('Выбранная услуга недоступна в этом филиале.'); return;
    }
    const item = { id:crypto.randomUUID(), status:'pending', serviceId:service.id, date,
      earliest, latest, name, phone, slug:snapshot.teamMode ? snapshot.slug : '',
      locationId:snapshot.teamMode ? locationId : '', priceRub:Number(service.priceRub),
      durationMinutes:Number(service.durationMinutes) };
    if (!save(item)) { setStatus('Не удалось надёжно сохранить запрос на устройстве. Не закрывайте форму.'); return; }
    form.reset(); render();
  });
  panel.querySelector('#clientOfflineFlexibleRemove').addEventListener('click', () => {
    const item = queue();
    if (!item || syncing || item.status === 'pending' && navigator.onLine) return;
    try { localStorage.removeItem(queueKey); } catch { return; }
    render();
  });
  window.addEventListener('online', () => { warmOfflinePage(); render(); void flush(); });
  window.addEventListener('offline', render);
  window.addEventListener('primetime:offline-catalog-updated', render);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void flush(); });
  render();
  warmOfflinePage();
  void flush();
})();
