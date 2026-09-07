(function enableFastSiteUpdates() {
  'use strict';

  if (!('serviceWorker' in navigator)) return;

  const scriptUrl = document.currentScript?.src || location.href;
  const workerUrl = new URL('./sw.js?v=563', scriptUrl).href;
  const CHECK_INTERVAL_MS = 15 * 60 * 1000;
  let registration = null;
  let currentController = navigator.serviceWorker.controller;
  let lastCheck = 0;
  let checkPromise = null;

  function checkForUpdate({ force = false, registerOnly = false } = {}) {
    if (checkPromise) return checkPromise;
    const now = Date.now();
    if (!registerOnly && !force && now - lastCheck < CHECK_INTERVAL_MS) return Promise.resolve();
    checkPromise = (async () => {
      try {
        if (!registration) {
          registration = await navigator.serviceWorker.register(workerUrl, { updateViaCache:'none' });
          lastCheck = Date.now();
          if (registerOnly) return;
        }
        if (!registerOnly) {
          lastCheck = Date.now();
          await registration.update();
        }
      } catch {
        // An unavailable update check must not interrupt booking work.
      } finally {
        checkPromise = null;
      }
    })();
    return checkPromise;
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    const nextController = navigator.serviceWorker.controller;
    if (currentController && nextController && nextController !== currentController) {
      document.documentElement.dataset.siteUpdateReady = 'true';
    }
    currentController = nextController;
  });

  window.addEventListener('load', () => checkForUpdate({ registerOnly:true }), { once:true });
  window.addEventListener('online', () => checkForUpdate({ force:true }));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkForUpdate();
  });
  window.setInterval(() => { if (!document.hidden) checkForUpdate(); }, CHECK_INTERVAL_MS);
})();
