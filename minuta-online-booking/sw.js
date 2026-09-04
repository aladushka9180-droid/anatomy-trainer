const CACHE_PREFIX = 'massage-izhevsk-';
const CACHE = `${CACHE_PREFIX}v371`;
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
  './help/help.css?v=371',
  './help/help-data.js?v=371',
  './help/help.js?v=371',
  './help/article.js?v=371',
  './help/category.js?v=371',
  './help/images/team-calendar.svg',
  './help/images/service-resources.svg',
  './help/images/client-import.svg',
  './help/images/yookassa.svg',
  './help/images/payroll.svg',
  './help/images/inventory.svg',
  './help/images/telegram-settings.svg',
  './help/images/install-app.svg',
  './provider.webmanifest?v=371',
  './provider-icon-192.png',
  './provider-icon-512.png',
  './provider-icon-maskable-512.png',
  './provider-luxury-marble-v4.webp',
  './styles.css?v=371',
  './onboarding.css?v=371',
  './visitor-presence.css?v=371',
  './config.js?v=371',
  './site-update.js?v=371',
  './reliability.js?v=371',
  './phone-auth.js?v=371',
  './social-auth.js?v=371',
  './app.js?v=371',
  './resource-management.js?v=371',
  './shift-management.js?v=371',
  './organization.js?v=371',
  './payroll-management.js?v=371',
  './benefit-management.js?v=371',
  './loyalty-management.js?v=371',
  './inventory-management.js?v=371',
  './retention-management.js?v=371',
  './payment-management.js?v=371',
  './notification-center.js?v=371',
  './client-fields.js?v=371',
  './client-import.js?v=371',
  './batch-bookings.js?v=371',
  './booking-policy-management.js?v=371',
  './team-calendar.js?v=371',
  './free-slots-share.js?v=371',
  './group-bookings.js?v=371',
  './telegram-auth.js?v=371',
  './pwa-install.js?v=371',
  './provider.js?v=371',
  './onboarding.js?v=371',
  './report-worker.js?v=371',
  './voice-assistant.js?v=371',
  './booking.js?v=371',
  './my-bookings.js?v=371',
  './waitlist.js?v=371',
  './privacy.js?v=371',
  './ui-icons.svg',
  './ui-icons.svg?v=371',
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
