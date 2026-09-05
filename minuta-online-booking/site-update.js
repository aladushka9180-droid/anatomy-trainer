(function enableFastSiteUpdates() {
  'use strict';

  if (!('serviceWorker' in navigator)) return;

  const scriptUrl = document.currentScript?.src || location.href;
  const workerUrl = new URL('./sw.js?v=434', scriptUrl).href;
  let registration = null;
  let currentController = navigator.serviceWorker.controller;
  let lastCheck = 0;

  async function checkForUpdate(force) {
    const now = Date.now();
    if (!force && now - lastCheck < 30000) return;
    lastCheck = now;
    try {
      if (!registration) registration = await navigator.serviceWorker.register(workerUrl, { updateViaCache:'none' });
      await registration.update();
    } catch {
      // An unavailable update check must not interrupt booking work.
    }
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    const nextController = navigator.serviceWorker.controller;
    if (currentController && nextController && nextController !== currentController) {
      document.documentElement.dataset.siteUpdateReady = 'true';
    }
    currentController = nextController;
  });

  window.addEventListener('load', () => checkForUpdate(true), { once:true });
  window.addEventListener('focus', () => checkForUpdate(false));
  window.addEventListener('online', () => checkForUpdate(true));
  window.addEventListener('pageshow', () => checkForUpdate(false));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkForUpdate(true);
  });
  window.setInterval(() => { if (!document.hidden) checkForUpdate(false); }, 60000);
})();
