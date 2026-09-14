const CACHE_PREFIX = 'massage-izhevsk-';
const CACHE = `${CACHE_PREFIX}v791`;

// Only the provider shell and its first-screen dependencies block installation.
// Secondary sections, help media and decorative theme images are cached on use.
const ASSETS = [
  './provider.html',
  './offline.html',
  './offline.js',
  './provider.webmanifest?v=791',
  './provider-icon-192.png?v=791',
  './provider-icon-512.png?v=791',
  './provider-icon-maskable-512.png?v=791',
  './provider-icon.svg?v=791',
  './icon.svg',
  './ui-icons.svg',
  './styles.css?v=791',
  './utm-funnel.css?v=791',
  './onboarding.css?v=791',
  './visitor-presence.css?v=791',
  './subscription-pricing.css?v=791',
  './provider-theme-loft-modern.css?v=791',
  './provider-themes-signature.css?v=791',
  './provider-themes-calm.css?v=791',
  './provider-layout-responsive.css?v=791',
  './provider-ux.css?v=791',
  './provider-header.css?v=791',
  './client-themes.css?v=791',
  './provider-themes-wildlife.css?v=791',
  './settings-nav-scroll.css?v=791',
  './settings-smart-search.css?v=791',
  './contextual-help.css?v=791',
  './settings-mobile-minimalism.css?v=791',
  './client-records.css?v=791',
  './provider-integrations.css?v=791',
  './client-results.css?v=791',
  './provider-theme-noir-safari.css?v=791',
  './client-directory.css?v=791',
  './provider-ui-refinements.css?v=791',
  './provider-schedule-minimal.css?v=791',
  './provider-themes-distinct.css?v=791',
  './provider-theme-families.css?v=791',
  './provider-theme-backgrounds-tema1.css?v=791',
  './vendor/supabase-2.112.4.min.js',
  './config.js?v=791',
  './pwa-install.js?v=791',
  './site-update.js?v=791',
  './reliability.js?v=791',
  './phone-auth.js?v=791',
  './social-auth.js?v=791',
  './privacy.js?v=791',
  './organization.js?v=791',
  './payment-management.js?v=791',
  './commerce-management.js?v=791',
  './client-fields.js?v=791',
  './client-import.js?v=791',
  './batch-bookings.js?v=791',
  './booking-policy-management.js?v=791',
  './team-calendar.js?v=791',
  './free-slots-share.js?v=791',
  './group-bookings.js?v=791',
  './booking-widgets.js?v=791',
  './onboarding.js?v=791',
  './service-presets-catalog.js?v=791',
  './client-messaging.js?v=791',
  './provider-read-fetch.js?v=791',
  './data-governance.js?v=791',
  './report-reconciliation.js?v=791',
  './report-demo-live.js?v=791',
  './theme-catalog.js?v=791',
  './provider-color-mode.js?v=791',
  './client-directory.js?v=791',
  './client-results.js?v=791',
  './provider.js?v=791',
  './voice-wake.js?v=791',
  './provider-feature-assets.js?v=791',
  './client-records.js?v=791',
];

// Warm after the first screen. A cold installation must not wait for tools
// that are only used from a dialog; retain their offline use after warming.
const OPTIONAL_ASSETS = [
  './index.html',
  './app.js?v=791',
  './service-presets.css?v=791',
  './service-presets.js?v=791',
  './report-worker.js?v=791',
  './benefit-lifecycle.css?v=791',
  './benefit-lifecycle.js?v=791',
  './provider-feedback-inbox.js?v=791',
  './free-slots-compact.css?v=791',
  './vendor/qrcodegen.js?v=791',
  './code-scanner.css?v=791',
  './code-scanner.js?v=791',
  './portfolio-camera.js?v=791',
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
