const CACHE_PREFIX = 'massage-izhevsk-';
const CACHE = `${CACHE_PREFIX}v794`;

// Only the provider shell and its first-screen dependencies block installation.
// Secondary sections, help media and decorative theme images are cached on use.
const ASSETS = [
  './provider.html',
  './offline.html',
  './offline.js',
  './provider.webmanifest?v=794',
  './provider-icon-192.png?v=794',
  './provider-icon-512.png?v=794',
  './provider-icon-maskable-512.png?v=794',
  './provider-icon.svg?v=794',
  './icon.svg',
  './ui-icons.svg',
  './styles.css?v=794',
  './utm-funnel.css?v=794',
  './onboarding.css?v=794',
  './visitor-presence.css?v=794',
  './subscription-pricing.css?v=794',
  './provider-theme-loft-modern.css?v=794',
  './provider-themes-signature.css?v=794',
  './provider-themes-calm.css?v=794',
  './provider-layout-responsive.css?v=794',
  './provider-ux.css?v=794',
  './provider-header.css?v=794',
  './client-themes.css?v=794',
  './provider-themes-wildlife.css?v=794',
  './settings-nav-scroll.css?v=794',
  './settings-smart-search.css?v=794',
  './contextual-help.css?v=794',
  './settings-mobile-minimalism.css?v=794',
  './client-records.css?v=794',
  './provider-integrations.css?v=794',
  './client-results.css?v=794',
  './provider-theme-noir-safari.css?v=794',
  './client-directory.css?v=794',
  './provider-ui-refinements.css?v=794',
  './provider-schedule-minimal.css?v=794',
  './provider-themes-distinct.css?v=794',
  './provider-theme-families.css?v=794',
  './provider-theme-backgrounds-tema1.css?v=794',
  './vendor/supabase-2.112.4.min.js',
  './config.js?v=794',
  './pwa-install.js?v=794',
  './site-update.js?v=794',
  './reliability.js?v=794',
  './phone-auth.js?v=794',
  './social-auth.js?v=794',
  './privacy.js?v=794',
  './organization.js?v=794',
  './payment-management.js?v=794',
  './commerce-management.js?v=794',
  './client-fields.js?v=794',
  './client-import.js?v=794',
  './batch-bookings.js?v=794',
  './booking-policy-management.js?v=794',
  './team-calendar.js?v=794',
  './free-slots-share.js?v=794',
  './group-bookings.js?v=794',
  './booking-widgets.js?v=794',
  './onboarding.js?v=794',
  './provider-read-fetch.js?v=794',
  './data-governance.js?v=794',
  './report-reconciliation.js?v=794',
  './report-demo-live.js?v=794',
  './theme-catalog.js?v=794',
  './provider-color-mode.js?v=794',
  './client-directory.js?v=794',
  './client-results.js?v=794',
  './provider.js?v=794',
  './voice-wake.js?v=794',
  './provider-feature-assets.js?v=794',
  './client-records.js?v=794',
];

// Warm after the first screen. A cold installation must not wait for tools
// that are only used from a dialog; retain their offline use after warming.
const OPTIONAL_ASSETS = [
  './index.html',
  './provider-portfolio-responsive.css?v=794',
  './service-presets-catalog.js?v=794',
  './app.js?v=794',
  './service-presets.css?v=794',
  './service-presets.js?v=794',
  './report-worker.js?v=794',
  './benefit-lifecycle.css?v=794',
  './benefit-lifecycle.js?v=794',
  './provider-feedback-inbox.js?v=794',
  './client-messaging.js?v=794',
  './free-slots-compact.css?v=794',
  './vendor/qrcodegen.js?v=794',
  './code-scanner.css?v=794',
  './code-scanner.js?v=794',
  './portfolio-camera.js?v=794',
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
