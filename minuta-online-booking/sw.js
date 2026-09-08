const CACHE_PREFIX = 'massage-izhevsk-';
const CACHE = `${CACHE_PREFIX}v603`;

// Only the provider shell and its first-screen dependencies block installation.
// Secondary sections, help media and decorative theme images are cached on use.
const ASSETS = [
  './provider.html',
  './offline.html',
  './offline.js',
  './provider.webmanifest?v=603',
  './provider-icon-192.png?v=603',
  './provider-icon-512.png?v=603',
  './provider-icon-maskable-512.png?v=603',
  './provider-icon.svg?v=603',
  './provider-og.png?v=603',
  './icon.svg',
  './ui-icons.svg',
  './styles.css?v=603',
  './utm-funnel.css?v=603',
  './onboarding.css?v=603',
  './visitor-presence.css?v=603',
  './subscription-pricing.css?v=603',
  './provider-theme-loft-modern.css?v=603',
  './provider-themes-signature.css?v=603',
  './provider-themes-calm.css?v=603',
  './provider-layout-responsive.css?v=603',
  './provider-ux.css?v=603',
  './provider-header.css?v=603',
  './client-themes.css?v=603',
  './provider-themes-wildlife.css?v=603',
  './settings-nav-scroll.css?v=603',
  './settings-smart-search.css?v=603',
  './contextual-help.css?v=603',
  './settings-mobile-minimalism.css?v=603',
  './free-slots-compact.css?v=603',
  './client-records.css?v=603',
  './client-results.css?v=603',
  './code-scanner.css?v=603',
  './provider-theme-noir-safari.css?v=603',
  './client-directory.css?v=603',
  './provider-ui-refinements.css?v=603',
  './provider-schedule-minimal.css?v=603',
  './vendor/supabase-2.112.4.min.js',
  './config.js?v=603',
  './pwa-install.js?v=603',
  './site-update.js?v=603',
  './reliability.js?v=603',
  './phone-auth.js?v=603',
  './social-auth.js?v=603',
  './telegram-auth.js?v=603',
  './privacy.js?v=603',
  './organization.js?v=603',
  './payment-management.js?v=603',
  './notification-center.js?v=603',
  './client-fields.js?v=603',
  './client-import.js?v=603',
  './provider-feedback.js?v=603',
  './batch-bookings.js?v=603',
  './booking-policy-management.js?v=603',
  './team-calendar.js?v=603',
  './vendor/qrcodegen.js?v=603',
  './free-slots-share.js?v=603',
  './group-bookings.js?v=603',
  './onboarding.js?v=603',
  './client-messaging.js?v=603',
  './provider-read-fetch.js?v=603',
  './data-governance.js?v=603',
  './report-reconciliation.js?v=603',
  './report-demo-live.js?v=603',
  './report-worker.js?v=603',
  './theme-catalog.js?v=603',
  './client-directory.js?v=603',
  './client-results.js?v=603',
  './provider.js?v=603',
  './client-records.js?v=603',
  './code-scanner.js?v=603',
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
