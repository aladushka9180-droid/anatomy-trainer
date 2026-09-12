const CACHE_PREFIX = 'massage-izhevsk-';
const CACHE = `${CACHE_PREFIX}v720`;

// Only the provider shell and its first-screen dependencies block installation.
// Secondary sections, help media and decorative theme images are cached on use.
const ASSETS = [
  './provider.html',
  './offline.html',
  './offline.js',
  './provider.webmanifest?v=720',
  './provider-icon-192.png?v=720',
  './provider-icon-512.png?v=720',
  './provider-icon-maskable-512.png?v=720',
  './provider-icon.svg?v=720',
  './icon.svg',
  './ui-icons.svg',
  './styles.css?v=720',
  './utm-funnel.css?v=720',
  './onboarding.css?v=720',
  './visitor-presence.css?v=720',
  './subscription-pricing.css?v=720',
  './provider-theme-loft-modern.css?v=720',
  './provider-themes-signature.css?v=720',
  './provider-themes-calm.css?v=720',
  './provider-layout-responsive.css?v=720',
  './provider-ux.css?v=720',
  './provider-header.css?v=720',
  './client-themes.css?v=720',
  './provider-themes-wildlife.css?v=720',
  './settings-nav-scroll.css?v=720',
  './settings-smart-search.css?v=720',
  './contextual-help.css?v=720',
  './settings-mobile-minimalism.css?v=720',
  './client-records.css?v=720',
  './provider-integrations.css?v=720',
  './client-results.css?v=720',
  './provider-theme-noir-safari.css?v=720',
  './client-directory.css?v=720',
  './provider-ui-refinements.css?v=720',
  './provider-schedule-minimal.css?v=720',
  './provider-themes-distinct.css?v=720',
  './vendor/supabase-2.112.4.min.js',
  './config.js?v=720',
  './pwa-install.js?v=720',
  './site-update.js?v=720',
  './reliability.js?v=720',
  './phone-auth.js?v=720',
  './social-auth.js?v=720',
  './telegram-auth.js?v=720',
  './privacy.js?v=720',
  './organization.js?v=720',
  './payment-management.js?v=720',
  './commerce-management.js?v=720',
  './integration-management.js?v=720',
  './notification-center.js?v=720',
  './client-fields.js?v=720',
  './client-import.js?v=720',
  './provider-feedback.js?v=720',
  './batch-bookings.js?v=720',
  './booking-policy-management.js?v=720',
  './team-calendar.js?v=720',
  './free-slots-share.js?v=720',
  './group-bookings.js?v=720',
  './booking-widgets.js?v=720',
  './onboarding.js?v=720',
  './client-messaging.js?v=720',
  './provider-read-fetch.js?v=720',
  './data-governance.js?v=720',
  './report-reconciliation.js?v=720',
  './report-demo-live.js?v=720',
  './report-worker.js?v=720',
  './theme-catalog.js?v=720',
  './provider-color-mode.js?v=720',
  './client-directory.js?v=720',
  './client-results.js?v=720',
  './provider.js?v=720',
  './voice-wake.js?v=720',
  './provider-feature-assets.js?v=720',
  './client-records.js?v=720',
];

// Warm after the first screen. A cold installation must not wait for tools
// that are only used from a dialog; retain their offline use after warming.
const OPTIONAL_ASSETS = [
  './provider-feedback-inbox.js?v=720',
  './free-slots-compact.css?v=720',
  './vendor/qrcodegen.js?v=720',
  './code-scanner.css?v=720',
  './code-scanner.js?v=720',
  './portfolio-camera.js?v=720',
];
let optionalWarmup = null;

self.addEventListener('message', event => {
  if (event.data?.type !== 'warm-provider-features') return;
  if (!optionalWarmup) {
    optionalWarmup = (async () => {
      const cache = await caches.open(CACHE);
      for (const asset of OPTIONAL_ASSETS) {
        if (await cache.match(asset)) continue;
        await cache.add(asset);
      }
    })().finally(() => { optionalWarmup = null; });
  }
  event.waitUntil(optionalWarmup.catch(() => {}));
});

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
