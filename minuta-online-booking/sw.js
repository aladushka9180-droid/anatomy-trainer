const CACHE_PREFIX = 'massage-izhevsk-';
const CACHE = `${CACHE_PREFIX}v327`;
const ASSETS = [
  './',
  './index.html',
  './provider.html',
  './booking.html',
  './my-bookings.html',
  './waitlist.html',
  './privacy.html',
  './provider.webmanifest?v=327',
  './provider-icon-192.png',
  './provider-icon-512.png',
  './provider-icon-maskable-512.png',
  './provider-luxury-marble-v4.webp',
  './styles.css?v=327',
  './onboarding.css?v=327',
  './visitor-presence.css?v=327',
  './config.js?v=327',
  './site-update.js?v=327',
  './reliability.js?v=327',
  './phone-auth.js?v=327',
  './social-auth.js?v=327',
  './app.js?v=327',
  './resource-management.js?v=327',
  './shift-management.js?v=327',
  './organization.js?v=327',
  './payroll-management.js?v=327',
  './benefit-management.js?v=327',
  './loyalty-management.js?v=327',
  './inventory-management.js?v=327',
  './retention-management.js?v=327',
  './payment-management.js?v=327',
  './notification-center.js?v=327',
  './client-fields.js?v=327',
  './client-import.js?v=327',
  './batch-bookings.js?v=327',
  './booking-policy-management.js?v=327',
  './team-calendar.js?v=327',
  './free-slots-share.js?v=327',
  './group-bookings.js?v=327',
  './pwa-install.js?v=327',
  './provider.js?v=327',
  './onboarding.js?v=327',
  './report-worker.js?v=327',
  './voice-assistant.js?v=327',
  './booking.js?v=327',
  './my-bookings.js?v=327',
  './waitlist.js?v=327',
  './privacy.js?v=327',
  './ui-icons.svg',
  './ui-icons.svg?v=327',
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
