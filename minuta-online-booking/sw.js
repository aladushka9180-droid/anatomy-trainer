const CACHE_PREFIX = 'massage-izhevsk-';
const CACHE = `${CACHE_PREFIX}v253`;
const ASSETS = [
  './',
  './index.html',
  './provider.html',
  './booking.html',
  './my-bookings.html',
  './waitlist.html',
  './privacy.html',
  './provider.webmanifest?v=252',
  './provider-icon-192.png',
  './provider-icon-512.png',
  './provider-icon-maskable-512.png',
  './provider-luxury-marble-v4.webp',
  './styles.css?v=252',
  './config.js?v=252',
  './site-update.js?v=252',
  './reliability.js?v=252',
  './phone-auth.js?v=252',
  './social-auth.js?v=252',
  './app.js?v=252',
  './resource-management.js?v=252',
  './shift-management.js?v=252',
  './organization.js?v=252',
  './payroll-management.js?v=252',
  './benefit-management.js?v=252',
  './loyalty-management.js?v=252',
  './inventory-management.js?v=252',
  './retention-management.js?v=252',
  './payment-management.js?v=252',
  './notification-center.js?v=252',
  './client-fields.js?v=252',
  './batch-bookings.js?v=252',
  './booking-policy-management.js?v=252',
  './team-calendar.js?v=252',
  './free-slots-share.js?v=252',
  './group-bookings.js?v=252',
  './provider.js?v=252',
  './voice-assistant.js?v=252',
  './booking.js?v=252',
  './my-bookings.js?v=252',
  './waitlist.js?v=252',
  './styles.css?v=247',
  './config.js?v=245',
  './site-update.js?v=245',
  './reliability.js?v=245',
  './phone-auth.js?v=245',
  './social-auth.js?v=245',
  './app.js?v=245',
  './resource-management.js?v=245',
  './shift-management.js?v=245',
  './organization.js?v=245',
  './payroll-management.js?v=245',
  './benefit-management.js?v=245',
  './loyalty-management.js?v=245',
  './inventory-management.js?v=245',
  './retention-management.js?v=245',
  './payment-management.js?v=245',
  './notification-center.js?v=245',
  './client-fields.js?v=245',
  './batch-bookings.js?v=245',
  './booking-policy-management.js?v=245',
  './team-calendar.js?v=245',
  './free-slots-share.js?v=245',
  './group-bookings.js?v=245',
  './provider.js?v=247',
  './voice-assistant.js?v=245',
  './booking.js?v=245',
  './my-bookings.js?v=245',
  './waitlist.js?v=245',
  './ui-icons.svg',
  './ui-icons.svg?v=252',
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
