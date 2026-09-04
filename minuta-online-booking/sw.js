const CACHE_PREFIX = 'massage-izhevsk-';
const CACHE = `${CACHE_PREFIX}v366`;
const ASSETS = [
  './',
  './index.html',
  './provider.html',
  './booking.html',
  './my-bookings.html',
  './waitlist.html',
  './privacy.html',
  './help/index.html',
  './help/article.html',
  './help/category.html',
  './help/help.css?v=366',
  './help/help-data.js?v=366',
  './help/help.js?v=366',
  './help/article.js?v=366',
  './help/category.js?v=366',
  './provider.webmanifest?v=366',
  './provider-icon-192.png',
  './provider-icon-512.png',
  './provider-icon-maskable-512.png',
  './provider-luxury-marble-v4.webp',
  './styles.css?v=366',
  './onboarding.css?v=366',
  './visitor-presence.css?v=366',
  './config.js?v=366',
  './site-update.js?v=366',
  './reliability.js?v=366',
  './phone-auth.js?v=366',
  './social-auth.js?v=366',
  './app.js?v=366',
  './resource-management.js?v=366',
  './shift-management.js?v=366',
  './organization.js?v=366',
  './payroll-management.js?v=366',
  './benefit-management.js?v=366',
  './loyalty-management.js?v=366',
  './inventory-management.js?v=366',
  './retention-management.js?v=366',
  './payment-management.js?v=366',
  './notification-center.js?v=366',
  './client-fields.js?v=366',
  './client-import.js?v=366',
  './batch-bookings.js?v=366',
  './booking-policy-management.js?v=366',
  './team-calendar.js?v=366',
  './free-slots-share.js?v=366',
  './group-bookings.js?v=366',
  './telegram-auth.js?v=366',
  './pwa-install.js?v=366',
  './provider.js?v=366',
  './onboarding.js?v=366',
  './report-worker.js?v=366',
  './voice-assistant.js?v=366',
  './booking.js?v=366',
  './my-bookings.js?v=366',
  './waitlist.js?v=366',
  './privacy.js?v=366',
  './ui-icons.svg',
  './ui-icons.svg?v=366',
  './manifest.webmanifest',
  './icon.svg',
  './og.png',
  './vendor/supabase-2.112.4.min.js',
  './vendor/xlsx-0.20.3.full.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
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
  const isOwnAsset = requestUrl.origin === self.location.origin;
  if (!isOwnAsset) return;
  if (event.request.mode === 'navigate') event.respondWith(navigationResponse(event.request));
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

async function navigationResponse(request) {
  try {
    const response = await fetch(request);
    if (response.ok && !new URL(request.url).search) (await caches.open(CACHE)).put(request, response.clone());
    return response;
  } catch {
    const path = new URL(request.url).pathname;
    const shell = path.endsWith('/help/article.html') ? './help/article.html' : path.endsWith('/help/category.html') ? './help/category.html' : path.endsWith('/help/') || path.endsWith('/help/index.html') ? './help/index.html' : path.endsWith('/booking.html') ? './booking.html' : path.endsWith('/my-bookings.html') ? './my-bookings.html' : path.endsWith('/waitlist.html') ? './waitlist.html' : path.endsWith('/provider.html') ? './provider.html' : path.endsWith('/privacy.html') ? './privacy.html' : './index.html';
    return (await caches.match(shell)) || (await caches.match('./index.html'));
  }
}

async function assetResponse(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') (await caches.open(CACHE)).put(request, response.clone());
  return response;
}
