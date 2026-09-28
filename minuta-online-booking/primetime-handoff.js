(() => {
  'use strict';

  const TARGET = 'https://primetime-booking.primetime-booking-ru.workers.dev/for-masters';
  const START = `${TARGET}/start`;
  const button = document.getElementById('openPrimeTime');
  const params = new URLSearchParams(window.location.search);
  const state = (params.get('primetime_return') || '').toLowerCase();
  const returning = /^[0-9a-f]{64}$/.test(state);
  let running = false;

  function setBusy(value) {
    if (!button) return;
    button.disabled = value;
    button.setAttribute('aria-busy', value ? 'true' : 'false');
    const label = button.querySelector('span');
    if (label) label.textContent = value ? 'Открываем Eldion…' : 'Управлять профилем в Eldion';
  }

  async function createHandoff() {
    if (running) return;
    running = true;
    setBusy(true);
    try {
      const { data: sessionData, error: sessionError } = await db.auth.getSession();
      if (sessionError) throw sessionError;
      if (!sessionData?.session) {
        return;
      }

      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('primetime_return');
      window.history.replaceState(null, '', `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);

      const { data, error } = await db.rpc('create_primetime_handoff', { p_state: state });
      if (error) throw error;
      const ticket = typeof data?.ticket === 'string' ? data.ticket.toLowerCase() : '';
      if (!/^[0-9a-f]{64}$/.test(ticket)) throw new Error('invalid_primetime_handoff');
      window.location.assign(`${TARGET}#handoff=${ticket}`);
    } catch (error) {
      console.error('Eldion handoff failed', error);
      notify('Не удалось открыть Eldion · повторите через минуту');
    } finally {
      running = false;
      setBusy(false);
    }
  }

  button?.addEventListener('click', () => window.location.assign(START));

  if (returning) {
    void createHandoff();
    db.auth.onAuthStateChange((_event, session) => {
      if (session) void createHandoff();
    });
  }

  const host = document.querySelector?.('#clientAppearanceSettingsCard');
  if (!host) return;
  const card = document.createElement('section');
  card.id = 'eldionConnection';
  card.setAttribute('aria-labelledby', 'eldionConnectionTitle');
  card.innerHTML = '<h3 id="eldionConnectionTitle">Профиль в Eldion</h3><p id="eldionConnectionStatus" role="status" aria-live="polite">Проверяем подключение…</p><div id="eldionConnectionLinks" hidden></div><button class="secondary-button" id="eldionConnectButton" type="button">Подключить к Eldion</button>';
  host.prepend(card);
  const style = document.createElement('style');
  style.textContent = '#eldionConnection{grid-column:1/-1;display:grid;gap:12px;min-width:0;margin-bottom:20px;padding-bottom:20px;border-bottom:1px solid var(--theme-line,var(--line))}#eldionConnection h3,#eldionConnection p{margin:0}#eldionConnection p{color:var(--muted);line-height:1.5}#eldionConnectionLinks{display:grid;gap:8px}#eldionConnectionLinks[hidden]{display:none}#eldionConnection a{color:inherit;font-weight:600;overflow-wrap:anywhere}#eldionConnectButton{justify-self:start;max-width:100%;min-height:44px;white-space:normal;font:inherit;font-weight:600}';
  document.head.append(style);
  const status = card.querySelector('#eldionConnectionStatus');
  const links = card.querySelector('#eldionConnectionLinks');
  const connect = card.querySelector('#eldionConnectButton');
  let request = null, contextKey = '', checkedAt = 0, retry = false;
  const clientOrigin = new URL(TARGET).origin;

  function context() {
    const userId = typeof currentUser === 'undefined' ? '' : currentUser?.id || '';
    const org = typeof organizationController === 'undefined' ? null : organizationController?.getActiveOrganization?.();
    return { userId, slug:org?.public_slug || '', enabled:org?.public_booking_enabled === true };
  }
  function clear(message, disabled = false) {
    status.textContent = message;
    links.replaceChildren();
    links.hidden = true;
    connect.hidden = false;
    connect.disabled = disabled;
    connect.textContent = 'Подключить к Eldion';
    retry = false;
  }
  async function refresh({ force = false } = {}) {
    if (document.querySelector('[data-provider-panel="settings"]')?.hidden) return;
    const scope = context();
    const key = `${scope.userId}:${scope.slug}:${scope.enabled}`;
    if (!force && key === contextKey && (request || Date.now() - checkedAt < 15000)) return;
    request?.abort();
    request = null;
    contextKey = key;
    checkedAt = Date.now();
    if (!scope.userId) { clear('Войдите в свой кабинет, чтобы подключить профиль.', true); return; }
    if (!scope.slug || !scope.enabled) { clear('Сначала включите публичную онлайн-запись в организации.', true); return; }
    if (!navigator.onLine) { clear('Нет соединения. Проверим подключение, когда интернет появится.', true); return; }
    clear('Проверяем подключение…', true);
    const controller = request = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const url = new URL('/api/provider-public-link', clientOrigin);
      url.searchParams.set('organizationSlug', scope.slug);
      url.searchParams.set('performerId', scope.userId);
      const response = await fetch(url, { credentials:'omit', cache:'no-store', signal:controller.signal });
      if (!response.ok) throw new Error('connection_unavailable');
      const data = await response.json();
      if (request !== controller || JSON.stringify(context()) !== JSON.stringify(scope)) return;
      const profiles = Array.isArray(data.profiles) ? data.profiles.filter(profile => {
        try { const link = new URL(profile.url); return link.origin === clientOrigin && /^\/r\/[a-z0-9-]+\/?$/i.test(link.pathname) && !link.search && !link.hash; } catch { return false; }
      }) : [];
      if (data.connected !== true || !profiles.length) { clear('Нет подтверждённого опубликованного профиля в Eldion.'); return; }
      status.textContent = 'Подключено к Eldion';
      connect.hidden = true;
      for (const profile of profiles) {
        const link = document.createElement('a');
        link.href = profile.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = profiles.length === 1 ? 'Открыть свой профиль' : `${profile.displayName || 'Профиль'} · /r/${profile.shortCode}`;
        links.append(link);
      }
      links.hidden = false;
    } catch {
      if (request !== controller) return;
      clear(navigator.onLine ? 'Не удалось проверить подключение. Попробуйте ещё раз.' : 'Нет соединения. Проверим подключение, когда интернет появится.', !navigator.onLine);
      connect.textContent = 'Повторить проверку';
      retry = true;
    } finally {
      clearTimeout(timeout);
      if (request === controller) request = null;
    }
  }
  connect.addEventListener('click', () => retry ? void refresh({ force:true }) : window.location.assign(`${START}?connect=1`));
  window.MinutaEldionConnection = { refresh };
  window.addEventListener('minuta:provider-session-reset', () => {
    request?.abort(); request = null; contextKey = ''; checkedAt = 0;
    clear('Войдите в свой кабинет, чтобы подключить профиль.', true);
  });
  window.addEventListener('online', () => void refresh({ force:true }));
  window.addEventListener('offline', () => void refresh({ force:true }));
  window.addEventListener('pageshow', () => void refresh({ force:true }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
  void refresh();
})();
