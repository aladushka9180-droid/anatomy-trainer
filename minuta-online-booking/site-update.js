(function enableFastSiteUpdates() {
  'use strict';

  if (!('serviceWorker' in navigator)) return;
  if (new URLSearchParams(location.search).get('porcelain-preview') === '1') return;

  const scriptUrl = document.currentScript?.src || location.href;
  const workerUrl = new URL('./sw.js?v=1048', scriptUrl).href;
  const pageVersion = Number(new URL(workerUrl).searchParams.get('v'));
  const CHECK_INTERVAL_MS = 15 * 60 * 1000;
  let registration = null;
  let currentController = navigator.serviceWorker.controller;
  let lastCheck = 0;
  let checkPromise = null;
  let recheck = false;

  function workerVersion(controller) {
    if (!controller) return Promise.resolve(null);
    return new Promise(resolve => {
      const channel = new MessageChannel();
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        channel.port1.close();
        resolve(value);
      };
      const timeout = setTimeout(() => finish(null), 1200);
      channel.port1.onmessage = event => finish(event.data);
      try { controller.postMessage({ type:'site-update-version' }, [channel.port2]); }
      catch { finish(null); }
    });
  }

  async function refreshUpdateNotice(attempt = 0) {
    if (registration?.installing || registration?.waiting) return;
    const controller = navigator.serviceWorker.controller;
    const info = await workerVersion(controller);
    if (controller !== navigator.serviceWorker.controller) return;
    if (controller && !info?.ready && attempt < 3) {
      setTimeout(() => refreshUpdateNotice(attempt + 1), 500);
      return;
    }
    // A different worker object/script URL can contain the same published build.
    const version = Number(info?.version);
    if (Number.isSafeInteger(version) && version > 0) {
      if (version > pageVersion && info.ready === true) {
        document.documentElement.dataset.siteUpdateReady = 'true';
        showUpdateNotice();
      } else {
        delete document.documentElement.dataset.siteUpdateReady;
        document.getElementById('siteUpdateNotice')?.remove();
      }
    }
  }

  function showUpdateNotice() {
    if (document.getElementById('siteUpdateNotice')) return;
    const notice = document.createElement('aside');
    notice.id = 'siteUpdateNotice';
    notice.setAttribute('role', 'status');
    notice.setAttribute('aria-live', 'polite');
    notice.innerHTML = '<span>Доступно обновление интерфейса</span><button type="button">Обновить страницу</button>';
    Object.assign(notice.style, {
      position:'fixed', right:'max(16px, env(safe-area-inset-right))', bottom:'max(16px, env(safe-area-inset-bottom))',
      zIndex:'2147483000', display:'flex', alignItems:'center', gap:'12px', maxWidth:'calc(100vw - 32px)',
      padding:'12px 14px', border:'1px solid rgba(32,42,38,.2)', borderRadius:'14px', background:'#fff',
      color:'#1f2c27', boxShadow:'0 12px 36px rgba(20,28,25,.18)', font:'600 14px/1.35 system-ui,sans-serif'
    });
    const button = notice.querySelector('button');
    Object.assign(button.style, {
      minHeight:'40px', padding:'8px 12px', border:'0', borderRadius:'10px', background:'#24332d',
      color:'#fff', font:'inherit', cursor:'pointer', whiteSpace:'nowrap'
    });
    button.addEventListener('click', () => location.reload());
    document.body.append(notice);
  }

  function checkForUpdate({ force = false } = {}) {
    if (!navigator.onLine) return Promise.resolve();
    if (checkPromise) { if (force) recheck = true; return checkPromise; }
    const now = Date.now();
    if (!force && now - lastCheck < CHECK_INTERVAL_MS) return Promise.resolve();
    checkPromise = (async () => {
      try {
        if (!registration || force) {
          registration = await navigator.serviceWorker.register(workerUrl, { updateViaCache:'none' });
        }
        lastCheck = Date.now();
        await registration.update();
        void refreshUpdateNotice();
      } catch {
      } finally {
        checkPromise = null;
        if (recheck) { recheck = false; void checkForUpdate({ force:true }); }
      }
    })();
    return checkPromise;
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    const nextController = navigator.serviceWorker.controller;
    if (nextController && nextController !== currentController) void refreshUpdateNotice();
    currentController = nextController;
  });

  window.addEventListener('load', () => checkForUpdate({ force:true }), { once:true });
  window.addEventListener('online', () => checkForUpdate({ force:true }));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkForUpdate();
  });
  window.setInterval(() => { if (!document.hidden) checkForUpdate(); }, CHECK_INTERVAL_MS);
})();
