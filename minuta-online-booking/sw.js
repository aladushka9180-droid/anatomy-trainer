const CACHE_PREFIX = 'massage-izhevsk-';
const CACHE = `${CACHE_PREFIX}v591`;

// Only the provider shell and its first-screen dependencies block installation.
// Secondary sections, help media and decorative theme images are cached on use.
const ASSETS = [
  './provider.html',
  './offline.html',
  './offline.js',
  './provider.webmanifest?v=591',
  './provider-icon-192.png',
  './provider-icon-512.png',
  './provider-icon-maskable-512.png',
  './icon.svg',
  './ui-icons.svg',
  './styles.css?v=591',
  './utm-funnel.css?v=591',
  './onboarding.css?v=591',
  './visitor-presence.css?v=591',
  './subscription-pricing.css?v=591',
  './provider-theme-loft-modern.css?v=591',
  './provider-themes-signature.css?v=591',
  './provider-themes-calm.css?v=591',
  './provider-layout-responsive.css?v=591',
  './provider-ux.css?v=591',
  './provider-header.css?v=591',
  './client-themes.css?v=591',
  './provider-themes-wildlife.css?v=591',
  './settings-nav-scroll.css?v=591',
  './settings-smart-search.css?v=591',
  './contextual-help.css?v=591',
  './settings-mobile-minimalism.css?v=591',
  './free-slots-compact.css?v=591',
  './client-records.css?v=591',
  './client-results.css?v=591',
  './code-scanner.css?v=591',
  './provider-theme-noir-safari.css?v=591',
  './client-directory.css?v=591',
  './provider-ui-refinements.css?v=591',
  './provider-schedule-minimal.css?v=591',
  './vendor/supabase-2.112.4.min.js',
  './config.js?v=591',
  './pwa-install.js?v=591',
  './site-update.js?v=591',
  './reliability.js?v=591',
  './phone-auth.js?v=591',
  './social-auth.js?v=591',
  './telegram-auth.js?v=591',
  './privacy.js?v=591',
  './organization.js?v=591',
  './payment-management.js?v=591',
  './notification-center.js?v=591',
  './client-fields.js?v=591',
  './client-import.js?v=591',
  './provider-feedback.js?v=591',
  './batch-bookings.js?v=591',
  './booking-policy-management.js?v=591',
  './team-calendar.js?v=591',
  './vendor/qrcodegen.js?v=591',
  './free-slots-share.js?v=591',
  './group-bookings.js?v=591',
  './onboarding.js?v=591',
  './client-messaging.js?v=591',
  './provider-read-fetch.js?v=591',
  './data-governance.js?v=591',
  './report-reconciliation.js?v=591',
  './report-demo-live.js?v=591',
  './report-worker.js?v=591',
  './theme-catalog.js?v=591',
  './client-directory.js?v=591',
  './client-results.js?v=591',
  './provider.js?v=591',
  './client-records.js?v=591',
  './code-scanner.js?v=591',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE);
      await cache.addAll(ASSETS);
      await self.skipWaiting();
    } catch (error) {
      await caches.delete(CACHE);
      throw error;
    }
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') event.respondWith(navigationResponse(event));
  else event.respondWith(assetResponse(event.request));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const requestedView = event.notification.data?.view;
  const view = ['bookings', 'clients', 'notifications', 'waitlist', 'analytics', 'schedule', 'services', 'organization', 'portfolio', 'settings', 'more'].includes(requestedView) ? requestedView : 'notifications';
  const targetUrl = new URL(event.notification.data?.url || `./provider.html?view=${view}`, self.location.href).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type:'window', includeUncontrolled:true });
    const providerWindow = windows.find(client => new URL(client.url).pathname.endsWith('/provider.html'));
    if (providerWindow) {
      await providerWindow.focus();
      providerWindow.postMessage({ type:'open-provider-view', view });
      return;
    }
    await self.clients.openWindow(targetUrl);
  })());
});

function navigationShell(request) {
  const path = new URL(request.url).pathname;
  if (path.endsWith('/help/article.html')) return './help/article.html';
  if (path.endsWith('/help/category.html')) return './help/category.html';
  if (path.endsWith('/help/') || path.endsWith('/help/index.html')) return './help/index.html';
  if (path.endsWith('/booking.html')) return './booking.html';
  if (path.endsWith('/my-bookings.html')) return './my-bookings.html';
  if (path.endsWith('/waitlist.html')) return './waitlist.html';
  if (path.endsWith('/provider.html')) return './provider.html';
  if (path.endsWith('/privacy.html')) return './privacy.html';
  if (path.endsWith('/terms.html')) return './terms.html';
  return './index.html';
}

async function navigationResponse(event) {
  const request = event.request;
  const shell = navigationShell(request);
  const cached = await caches.match(shell);
  const update = fetch(request).then(async response => {
    if (response.ok) await (await caches.open(CACHE)).put(shell, response.clone());
    return response;
  });
  if (cached) {
    event.waitUntil(update.catch(() => {}));
    return cached;
  }
  try { return await update; }
  catch { return (await caches.match('./offline.html')) || (await caches.match('./provider.html')); }
}

async function assetResponse(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') await (await caches.open(CACHE)).put(request, response.clone());
  return response;
}
