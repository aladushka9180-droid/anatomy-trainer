const CACHE_PREFIX = 'massage-izhevsk-';
const CACHE = `${CACHE_PREFIX}v268`;
const ASSETS = [
  './',
  './index.html',
  './provider.html',
  './booking.html',
  './my-bookings.html',
  './waitlist.html',
  './privacy.html',
  './provider.webmanifest?v=268',
  './provider-icon-192.png',
  './provider-icon-512.png',
  './provider-icon-maskable-512.png',
  './provider-luxury-marble-v4.webp',
  './styles.css?v=268',
  './config.js?v=268',
  './site-update.js?v=268',
  './reliability.js?v=268',
  './phone-auth.js?v=268',
  './social-auth.js?v=268',
  './app.js?v=268',
  './resource-management.js?v=268',
  './shift-management.js?v=268',
  './organization.js?v=268',
  './payroll-management.js?v=268',
  './benefit-management.js?v=268',
  './loyalty-management.js?v=268',
  './inventory-management.js?v=268',
  './retention-management.js?v=268',
  './payment-management.js?v=268',
  './notification-center.js?v=268',
  './client-fields.js?v=268',
  './client-import.js?v=268',
  './batch-bookings.js?v=268',
  './booking-policy-management.js?v=268',
  './team-calendar.js?v=268',
  './free-slots-share.js?v=268',
  './group-bookings.js?v=268',
  './provider.js?v=268',
  './report-worker.js?v=268',
  './voice-assistant.js?v=268',
  './booking.js?v=268',
  './my-bookings.js?v=268',
  './waitlist.js?v=268',
  './ui-icons.svg',
  './ui-icons.svg?v=268',
  './manifest.webmanifest',
  './icon.svg',
  './og.png',
  './vendor/supabase-2.112.4.min.js'
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
    const shell = path.endsWith('/booking.html') ? './booking.html' : path.endsWith('/my-bookings.html') ? './my-bookings.html' : path.endsWith('/waitlist.html') ? './waitlist.html' : path.endsWith('/provider.html') ? './provider.html' : path.endsWith('/privacy.html') ? './privacy.html' : './index.html';
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
