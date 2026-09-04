const CACHE_PREFIX = 'massage-izhevsk-';
const CACHE = `${CACHE_PREFIX}v359`;
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
  './help/help.css?v=359',
  './help/help-data.js?v=359',
  './help/help.js?v=359',
  './help/article.js?v=359',
  './provider.webmanifest?v=359',
  './provider-icon-192.png',
  './provider-icon-512.png',
  './provider-icon-maskable-512.png',
  './provider-luxury-marble-v4.webp',
  './styles.css?v=359',
  './onboarding.css?v=359',
  './visitor-presence.css?v=359',
  './config.js?v=359',
  './site-update.js?v=359',
  './reliability.js?v=359',
  './phone-auth.js?v=359',
  './social-auth.js?v=359',
  './app.js?v=359',
  './resource-management.js?v=359',
  './shift-management.js?v=359',
  './organization.js?v=359',
  './payroll-management.js?v=359',
  './benefit-management.js?v=359',
  './loyalty-management.js?v=359',
  './inventory-management.js?v=359',
  './retention-management.js?v=359',
  './payment-management.js?v=359',
  './notification-center.js?v=359',
  './client-fields.js?v=359',
  './client-import.js?v=359',
  './batch-bookings.js?v=359',
  './booking-policy-management.js?v=359',
  './team-calendar.js?v=359',
  './free-slots-share.js?v=359',
  './group-bookings.js?v=359',
  './telegram-auth.js?v=359',
  './pwa-install.js?v=359',
  './provider.js?v=359',
  './onboarding.js?v=359',
  './report-worker.js?v=359',
  './voice-assistant.js?v=359',
  './booking.js?v=359',
  './my-bookings.js?v=359',
  './waitlist.js?v=359',
  './privacy.js?v=359',
  './ui-icons.svg',
  './ui-icons.svg?v=359',
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
    const shell = path.endsWith('/help/article.html') ? './help/article.html' : path.endsWith('/help/') || path.endsWith('/help/index.html') ? './help/index.html' : path.endsWith('/booking.html') ? './booking.html' : path.endsWith('/my-bookings.html') ? './my-bookings.html' : path.endsWith('/waitlist.html') ? './waitlist.html' : path.endsWith('/provider.html') ? './provider.html' : path.endsWith('/privacy.html') ? './privacy.html' : './index.html';
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
