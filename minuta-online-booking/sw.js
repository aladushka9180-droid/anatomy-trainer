const CACHE_PREFIX = 'massage-izhevsk-';
const CACHE = `${CACHE_PREFIX}v770`;

// Only the provider shell and its first-screen dependencies block installation.
// Secondary sections, help media and decorative theme images are cached on use.
const ASSETS = [
  './provider.html',
  './offline.html',
  './offline.js',
  './provider.webmanifest?v=770',
  './provider-icon-192.png?v=770',
  './provider-icon-512.png?v=770',
  './provider-icon-maskable-512.png?v=770',
  './provider-icon.svg?v=770',
  './icon.svg',
  './ui-icons.svg',
  './styles.css?v=770',
  './utm-funnel.css?v=770',
  './onboarding.css?v=770',
  './visitor-presence.css?v=770',
  './subscription-pricing.css?v=770',
  './provider-theme-loft-modern.css?v=770',
  './provider-themes-signature.css?v=770',
  './provider-themes-calm.css?v=770',
  './provider-layout-responsive.css?v=770',
  './provider-ux.css?v=770',
  './provider-header.css?v=770',
  './client-themes.css?v=770',
  './provider-themes-wildlife.css?v=770',
  './settings-nav-scroll.css?v=770',
  './settings-smart-search.css?v=770',
  './contextual-help.css?v=770',
  './settings-mobile-minimalism.css?v=770',
  './client-records.css?v=770',
  './provider-integrations.css?v=770',
  './client-results.css?v=770',
  './provider-theme-noir-safari.css?v=770',
  './client-directory.css?v=770',
  './provider-ui-refinements.css?v=770',
  './provider-schedule-minimal.css?v=770',
  './provider-themes-distinct.css?v=770',
  './provider-theme-families.css?v=770',
  './provider-theme-backgrounds-tema1.css?v=770',
  './vendor/supabase-2.112.4.min.js',
  './config.js?v=770',
  './pwa-install.js?v=770',
  './site-update.js?v=770',
  './reliability.js?v=770',
  './phone-auth.js?v=770',
  './social-auth.js?v=770',
  './telegram-auth.js?v=770',
  './privacy.js?v=770',
  './organization.js?v=770',
  './payment-management.js?v=770',
  './commerce-management.js?v=770',
  './integration-management.js?v=770',
  './notification-center.js?v=770',
  './client-fields.js?v=770',
  './client-import.js?v=770',
  './provider-feedback.js?v=770',
  './batch-bookings.js?v=770',
  './booking-policy-management.js?v=770',
  './team-calendar.js?v=770',
  './free-slots-share.js?v=770',
  './group-bookings.js?v=770',
  './booking-widgets.js?v=770',
  './onboarding.js?v=770',
  './client-messaging.js?v=770',
  './provider-read-fetch.js?v=770',
  './data-governance.js?v=770',
  './report-reconciliation.js?v=770',
  './report-demo-live.js?v=770',
  './report-worker.js?v=770',
  './theme-catalog.js?v=770',
  './provider-color-mode.js?v=770',
  './client-directory.js?v=770',
  './client-results.js?v=770',
  './provider.js?v=770',
  './voice-wake.js?v=770',
  './provider-feature-assets.js?v=770',
  './client-records.js?v=770',
];

// Warm after the first screen. A cold installation must not wait for tools
// that are only used from a dialog; retain their offline use after warming.
const OPTIONAL_ASSETS = [
  './benefit-lifecycle.css?v=770',
  './benefit-lifecycle.js?v=770',
  './provider-feedback-inbox.js?v=770',
  './free-slots-compact.css?v=770',
  './vendor/qrcodegen.js?v=770',
  './code-scanner.css?v=770',
  './code-scanner.js?v=770',
  './portfolio-camera.js?v=770',
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
      await cache.addAll(ASSETS.map(asset => new Request(asset, { cache:'reload' })));
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
