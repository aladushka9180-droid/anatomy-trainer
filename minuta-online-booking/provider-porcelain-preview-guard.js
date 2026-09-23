(function () {
  'use strict';
  const params = new URLSearchParams(location.search);
  if (params.get('porcelain-preview') !== '1') return;
  // The URL is read-only even if opened outside its normal same-origin editor.
  window.MINUTA_PORCELAIN_READ_ONLY_PREVIEW = true;
  document.documentElement.dataset.porcelainReadOnlyPreview = 'true';

  // Keep the preview's date, navigation and auth refresh state out of the real tab.
  for (const name of ['localStorage', 'sessionStorage']) {
    try {
      const original = window[name];
      const overlay = new Map();
      const removed = new Set();
      const isolated = new Proxy(original, {
        get(target, key) {
          if (key === 'getItem') return item => {
            const normalized = String(item);
            return removed.has(normalized) ? null : overlay.has(normalized) ? overlay.get(normalized) : target.getItem(normalized);
          };
          if (key === 'setItem') return (item, value) => { const normalized = String(item); removed.delete(normalized); overlay.set(normalized, String(value)); };
          if (key === 'removeItem') return item => { const normalized = String(item); overlay.delete(normalized); removed.add(normalized); };
          if (key === 'clear') return () => { for (let index = 0; index < target.length; index++) removed.add(target.key(index)); overlay.clear(); };
          if (key === 'length') return target.length + overlay.size - removed.size;
          if (key === 'key') return index => [...new Set([...Array.from({ length:target.length }, (_, i) => target.key(i)), ...overlay.keys()].filter(item => !removed.has(item)))][index] || null;
          return Reflect.get(target, key, target);
        },
        set(_target, key, value) { overlay.set(String(key), String(value)); removed.delete(String(key)); return true; }
      });
      Object.defineProperty(window, name, { configurable:true, value:isolated });
    } catch {
      // Network and click guards below still fail closed if storage cannot be wrapped.
    }
  }

  // These RPCs have been audited as reads. Everything else that could write is
  // rejected before reaching Supabase, including accidental new UI controls.
  const readRpcs = new Set([
    'has_minuta_provider_access', 'get_minuta_workspace', 'get_provider_booking_reviews',
    'get_minuta_team_calendar', 'get_minuta_team_calendar_v2', 'get_minuta_team_calendar_v3',
    'get_minuta_staff_report_availability', 'get_minuta_team_analytics',
    'get_minuta_utm_funnel_v107', 'get_minuta_booking_events_v97', 'get_minuta_booking_events',
    'get_minuta_client_page_settings_v177', 'get_minuta_client_page_settings_v118',
    'get_minuta_provider_schedule_move_v157', 'get_minuta_provider_automatic_breaks_v158',
    'get_minuta_service_public_details_v159', 'get_provider_block_slots_v141',
    'get_provider_repeat_visit_v164', 'get_minuta_client_profile_v135',
    'get_minuta_client_profile_v119', 'get_minuta_client_commerce_v147',
    'get_minuta_service_public_details_v159', 'get_public_minuta_catalog_v5',
    'get_public_minuta_group_events', 'get_available_slots_v101', 'get_available_slots'
  ]);
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const request = input instanceof Request ? input : null;
    const method = String(init.method || request?.method || 'GET').toUpperCase();
    const url = new URL(request?.url || String(input), location.href);
    const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/([^/]+)$/);
    const safeGet = method === 'GET' || method === 'HEAD';
    const safeRpc = method === 'POST' && rpc && readRpcs.has(rpc[1]);
    const safeSignedImage = method === 'POST' && /^\/storage\/v1\/object\/sign\/(client-avatars|portfolio-images)\//.test(url.pathname);
    const safeAuthRefresh = method === 'POST' && url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token';
    if (safeGet || safeRpc || safeSignedImage || safeAuthRefresh) return originalFetch(input, init);
    return Promise.resolve(new Response(JSON.stringify({ code:'MINUTA_PREVIEW_READ_ONLY', message:'В предпросмотре изменения недоступны.' }), {
      status:403, headers:{ 'content-type':'application/json' }
    }));
  };
  const openRequest = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...options) {
    if (!['GET', 'HEAD'].includes(String(method).toUpperCase())) throw new Error('MINUTA_PREVIEW_READ_ONLY');
    return openRequest.call(this, method, url, ...options);
  };
  navigator.sendBeacon = () => false;

  const safeControl = element => Boolean(element?.closest(
    '.provider-mobile-nav [data-provider-view], [data-provider-panel="more"] [data-provider-view], ' +
    '[data-calendar-view], [data-date-shift], [data-date-today], #dateStrip button, ' +
    '#scheduleDatePicker, [data-journal-mode], [data-report-period], [data-report-view]'
  ));
  document.addEventListener('click', event => {
    if (safeControl(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  document.addEventListener('submit', event => { event.preventDefault(); event.stopImmediatePropagation(); }, true);
  document.addEventListener('change', event => {
    if (safeControl(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  document.addEventListener('keydown', event => {
    if (!['Enter', ' ', 'Spacebar'].includes(event.key) || safeControl(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  document.addEventListener('pointerdown', event => {
    if (!event.target?.closest('[draggable], [data-booking-drag], .booking-drag-handle')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
})();
