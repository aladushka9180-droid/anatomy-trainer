(function enableFastSiteUpdates() {
  'use strict';

  if (!('serviceWorker' in navigator)) return;

  const workerUrl = './sw.js?v=241';
  let registration = null;
  let currentController = navigator.serviceWorker.controller;
  let reloadPending = false;
  let reloading = false;
  let lastCheck = 0;

  function safeToReload() {
    return document.visibilityState !== 'visible'
      || (!document.querySelector('dialog[open],form:focus-within,[contenteditable="true"]') && !document.body.classList.contains('booking-sheet-open'));
  }

  function applyUpdate() {
    if (!reloadPending || reloading || !safeToReload()) return;
    reloading = true;
    window.location.reload();
  }

  async function checkForUpdate(force = false) {
    const now = Date.now();
    if (!force && now - lastCheck < 30000) return;
    lastCheck = now;
    try {
      registration ||= await navigator.serviceWorker.register(workerUrl, { updateViaCache:'none' });
      await registration.update();
    } catch {
      // The current page remains usable when an update check is temporarily unavailable.
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
  window.addEventListener('focus', () => { checkForUpdate(); applyUpdate(); });
  window.addEventListener('online', () => checkForUpdate(true));
  window.addEventListener('pageshow', () => { checkForUpdate(); applyUpdate(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkForUpdate(true);
    applyUpdate();
  });
  document.addEventListener('submit', () => setTimeout(applyUpdate, 1000));
  document.addEventListener('close', applyUpdate, true);
  window.setInterval(() => { if (!document.hidden) checkForUpdate(); }, 60000);
})();
