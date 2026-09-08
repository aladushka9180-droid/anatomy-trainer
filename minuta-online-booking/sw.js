const CACHE_PREFIX = 'massage-izhevsk-';
const CACHE = `${CACHE_PREFIX}v607`;

// Only the provider shell and its first-screen dependencies block installation.
// Secondary sections, help media and decorative theme images are cached on use.
const ASSETS = [
  './provider.html',
  './offline.html',
  './offline.js',
  './provider.webmanifest?v=607',
  './provider-icon-192.png?v=607',
  './provider-icon-512.png?v=607',
  './provider-icon-maskable-512.png?v=607',
  './provider-icon.svg?v=607',
  './provider-og.png?v=607',
  './icon.svg',
  './ui-icons.svg',
  './styles.css?v=607',
  './utm-funnel.css?v=607',
  './onboarding.css?v=607',
  './visitor-presence.css?v=607',
  './subscription-pricing.css?v=607',
  './provider-theme-loft-modern.css?v=607',
  './provider-themes-signature.css?v=607',
  './provider-themes-calm.css?v=607',
  './provider-layout-responsive.css?v=607',
  './provider-ux.css?v=607',
  './provider-header.css?v=607',
  './client-themes.css?v=607',
  './provider-themes-wildlife.css?v=607',
  './settings-nav-scroll.css?v=607',
  './settings-smart-search.css?v=607',
  './contextual-help.css?v=607',
  './settings-mobile-minimalism.css?v=607',
  './free-slots-compact.css?v=607',
  './client-records.css?v=607',
  './client-results.css?v=607',
  './code-scanner.css?v=607',
  './provider-theme-noir-safari.css?v=607',
  './client-directory.css?v=607',
  './provider-ui-refinements.css?v=607',
  './provider-schedule-minimal.css?v=607',
  './vendor/supabase-2.112.4.min.js',
  './config.js?v=607',
  './pwa-install.js?v=607',
  './site-update.js?v=607',
  './reliability.js?v=607',
  './phone-auth.js?v=607',
  './social-auth.js?v=607',
  './telegram-auth.js?v=607',
  './privacy.js?v=607',
  './organization.js?v=607',
  './payment-management.js?v=607',
  './notification-center.js?v=607',
  './client-fields.js?v=607',
  './client-import.js?v=607',
  './provider-feedback.js?v=607',
  './batch-bookings.js?v=607',
  './booking-policy-management.js?v=607',
  './team-calendar.js?v=607',
  './vendor/qrcodegen.js?v=607',
  './free-slots-share.js?v=607',
  './group-bookings.js?v=607',
  './onboarding.js?v=607',
  './client-messaging.js?v=607',
  './provider-read-fetch.js?v=607',
  './data-governance.js?v=607',
  './report-reconciliation.js?v=607',
  './report-demo-live.js?v=607',
  './report-worker.js?v=607',
  './theme-catalog.js?v=607',
  './client-directory.js?v=607',
  './client-results.js?v=607',
  './provider.js?v=607',
  './client-records.js?v=607',
  './code-scanner.js?v=607',
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
