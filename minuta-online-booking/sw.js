const CACHE_PREFIX = 'massage-izhevsk-';
const CACHE = `${CACHE_PREFIX}v663`;

// Only the provider shell and its first-screen dependencies block installation.
// Secondary sections, help media and decorative theme images are cached on use.
const ASSETS = [
  './provider.html',
  './offline.html',
  './offline.js',
  './provider.webmanifest?v=663',
  './provider-icon-192.png?v=663',
  './provider-icon-512.png?v=663',
  './provider-icon-maskable-512.png?v=663',
  './provider-icon.svg?v=663',
  './provider-og.png?v=663',
  './icon.svg',
  './ui-icons.svg',
  './styles.css?v=663',
  './utm-funnel.css?v=663',
  './onboarding.css?v=663',
  './visitor-presence.css?v=663',
  './subscription-pricing.css?v=663',
  './provider-theme-loft-modern.css?v=663',
  './provider-themes-signature.css?v=663',
  './provider-themes-calm.css?v=663',
  './provider-layout-responsive.css?v=663',
  './provider-ux.css?v=663',
  './provider-header.css?v=663',
  './client-themes.css?v=663',
  './provider-themes-wildlife.css?v=663',
  './settings-nav-scroll.css?v=663',
  './settings-smart-search.css?v=663',
  './contextual-help.css?v=663',
  './settings-mobile-minimalism.css?v=663',
  './client-records.css?v=663',
  './client-results.css?v=663',
  './provider-theme-noir-safari.css?v=663',
  './client-directory.css?v=663',
  './provider-ui-refinements.css?v=663',
  './provider-schedule-minimal.css?v=663',
  './vendor/supabase-2.112.4.min.js',
  './config.js?v=663',
  './pwa-install.js?v=663',
  './site-update.js?v=663',
  './reliability.js?v=663',
  './phone-auth.js?v=663',
  './social-auth.js?v=663',
  './telegram-auth.js?v=663',
  './privacy.js?v=663',
  './organization.js?v=663',
  './payment-management.js?v=663',
  './notification-center.js?v=663',
  './client-fields.js?v=663',
  './client-import.js?v=663',
  './provider-feedback.js?v=663',
  './batch-bookings.js?v=663',
  './booking-policy-management.js?v=663',
  './team-calendar.js?v=663',
  './free-slots-share.js?v=663',
  './group-bookings.js?v=663',
  './booking-widgets.js?v=663',
  './onboarding.js?v=663',
  './client-messaging.js?v=663',
  './provider-read-fetch.js?v=663',
  './data-governance.js?v=663',
  './report-reconciliation.js?v=663',
  './report-demo-live.js?v=663',
  './report-worker.js?v=663',
  './theme-catalog.js?v=663',
  './client-directory.js?v=663',
  './client-results.js?v=663',
  './provider.js?v=663',
  './provider-feature-assets.js?v=663',
  './client-records.js?v=663',
];

// Warm after the first screen. A cold installation must not wait for tools
// that are only used from a dialog; retain their offline use after warming.
const OPTIONAL_ASSETS = [
  './free-slots-compact.css?v=663',
  './vendor/qrcodegen.js?v=663',
  './code-scanner.css?v=663',
  './code-scanner.js?v=663',
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
