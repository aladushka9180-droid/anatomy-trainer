const CACHE_PREFIX = 'massage-izhevsk-';
const CACHE = `${CACHE_PREFIX}v767`;

// Only the provider shell and its first-screen dependencies block installation.
// Secondary sections, help media and decorative theme images are cached on use.
const ASSETS = [
  './provider.html',
  './offline.html',
  './offline.js',
  './provider.webmanifest?v=767',
  './provider-icon-192.png?v=767',
  './provider-icon-512.png?v=767',
  './provider-icon-maskable-512.png?v=767',
  './provider-icon.svg?v=767',
  './icon.svg',
  './ui-icons.svg',
  './styles.css?v=767',
  './utm-funnel.css?v=767',
  './onboarding.css?v=767',
  './visitor-presence.css?v=767',
  './subscription-pricing.css?v=767',
  './provider-theme-loft-modern.css?v=767',
  './provider-themes-signature.css?v=767',
  './provider-themes-calm.css?v=767',
  './provider-layout-responsive.css?v=767',
  './provider-ux.css?v=767',
  './provider-header.css?v=767',
  './client-themes.css?v=767',
  './provider-themes-wildlife.css?v=767',
  './settings-nav-scroll.css?v=767',
  './settings-smart-search.css?v=767',
  './contextual-help.css?v=767',
  './settings-mobile-minimalism.css?v=767',
  './client-records.css?v=767',
  './provider-integrations.css?v=767',
  './client-results.css?v=767',
  './provider-theme-noir-safari.css?v=767',
  './client-directory.css?v=767',
  './provider-ui-refinements.css?v=767',
  './provider-schedule-minimal.css?v=767',
  './provider-themes-distinct.css?v=767',
  './provider-theme-families.css?v=767',
  './provider-theme-backgrounds-tema1.css?v=767',
  './vendor/supabase-2.112.4.min.js',
  './config.js?v=767',
  './pwa-install.js?v=767',
  './site-update.js?v=767',
  './reliability.js?v=767',
  './phone-auth.js?v=767',
  './social-auth.js?v=767',
  './telegram-auth.js?v=767',
  './privacy.js?v=767',
  './organization.js?v=767',
  './payment-management.js?v=767',
  './commerce-management.js?v=767',
  './integration-management.js?v=767',
  './notification-center.js?v=767',
  './client-fields.js?v=767',
  './client-import.js?v=767',
  './provider-feedback.js?v=767',
  './batch-bookings.js?v=767',
  './booking-policy-management.js?v=767',
  './team-calendar.js?v=767',
  './free-slots-share.js?v=767',
  './group-bookings.js?v=767',
  './booking-widgets.js?v=767',
  './onboarding.js?v=767',
  './client-messaging.js?v=767',
  './provider-read-fetch.js?v=767',
  './data-governance.js?v=767',
  './report-reconciliation.js?v=767',
  './report-demo-live.js?v=767',
  './report-worker.js?v=767',
  './theme-catalog.js?v=767',
  './provider-color-mode.js?v=767',
  './client-directory.js?v=767',
  './client-results.js?v=767',
  './provider.js?v=767',
  './voice-wake.js?v=767',
  './provider-feature-assets.js?v=767',
  './client-records.js?v=767',
];

// Warm after the first screen. A cold installation must not wait for tools
// that are only used from a dialog; retain their offline use after warming.
const OPTIONAL_ASSETS = [
  './benefit-lifecycle.css?v=767',
  './benefit-lifecycle.js?v=767',
  './provider-feedback-inbox.js?v=767',
  './free-slots-compact.css?v=767',
  './vendor/qrcodegen.js?v=767',
  './code-scanner.css?v=767',
  './code-scanner.js?v=767',
  './portfolio-camera.js?v=767',
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
