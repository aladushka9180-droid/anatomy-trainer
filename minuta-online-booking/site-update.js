(function enableFastSiteUpdates() {
  'use strict';

  if (!('serviceWorker' in navigator)) return;

  const workerUrl = './sw.js?v=253';
  let registration = null;
  let currentController = navigator.serviceWorker.controller;
  let reloadPending = false;
  let reloading = false;
  let lastCheck = 0;

  function safeToReload() {
    return document.visibilityState !== 'visible'
      || (!document.querySelector('dialog[open],form:focus-within,[contenteditable="true"]')
        && !document.body.classList.contains('booking-sheet-open'));
  }

  function applyUpdate() {
    if (!reloadPending || reloading || !safeToReload()) return;
    reloading = true;
    window.location.reload();
  }

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
      reloadPending = true;
      applyUpdate();
    }
    currentController = nextController;
  });

  window.addEventListener('load', () => checkForUpdate(true), { once:true });
  window.addEventListener('focus', () => { checkForUpdate(false); applyUpdate(); });
  window.addEventListener('online', () => checkForUpdate(true));
  window.addEventListener('pageshow', () => { checkForUpdate(false); applyUpdate(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkForUpdate(true);
    applyUpdate();
  });
  document.addEventListener('focusout', () => setTimeout(applyUpdate, 0));
  document.addEventListener('submit', () => setTimeout(applyUpdate, 1000));
  window.setInterval(() => { if (!document.hidden) checkForUpdate(false); }, 60000);
})();
