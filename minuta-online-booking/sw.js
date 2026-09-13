const CACHE_PREFIX = 'massage-izhevsk-';
const CACHE = `${CACHE_PREFIX}v759`;

// Only the provider shell and its first-screen dependencies block installation.
// Secondary sections, help media and decorative theme images are cached on use.
const ASSETS = [
  './provider.html',
  './offline.html',
  './offline.js',
  './provider.webmanifest?v=759',
  './provider-icon-192.png?v=759',
  './provider-icon-512.png?v=759',
  './provider-icon-maskable-512.png?v=759',
  './provider-icon.svg?v=759',
  './icon.svg',
  './ui-icons.svg',
  './styles.css?v=759',
  './utm-funnel.css?v=759',
  './onboarding.css?v=759',
  './visitor-presence.css?v=759',
  './subscription-pricing.css?v=759',
  './provider-theme-loft-modern.css?v=759',
  './provider-themes-signature.css?v=759',
  './provider-themes-calm.css?v=759',
  './provider-layout-responsive.css?v=759',
  './provider-ux.css?v=759',
  './provider-header.css?v=759',
  './client-themes.css?v=759',
  './provider-themes-wildlife.css?v=759',
  './settings-nav-scroll.css?v=759',
  './settings-smart-search.css?v=759',
  './contextual-help.css?v=759',
  './settings-mobile-minimalism.css?v=759',
  './client-records.css?v=759',
  './provider-integrations.css?v=759',
  './client-results.css?v=759',
  './provider-theme-noir-safari.css?v=759',
  './client-directory.css?v=759',
  './provider-ui-refinements.css?v=759',
  './provider-schedule-minimal.css?v=759',
  './provider-themes-distinct.css?v=759',
  './provider-theme-families.css?v=759',
  './provider-theme-backgrounds-tema1.css?v=759',
  './vendor/supabase-2.112.4.min.js',
  './config.js?v=759',
  './pwa-install.js?v=759',
  './site-update.js?v=759',
  './reliability.js?v=759',
  './phone-auth.js?v=759',
  './social-auth.js?v=759',
  './telegram-auth.js?v=759',
  './privacy.js?v=759',
  './organization.js?v=759',
  './payment-management.js?v=759',
  './commerce-management.js?v=759',
  './integration-management.js?v=759',
  './notification-center.js?v=759',
  './client-fields.js?v=759',
  './client-import.js?v=759',
  './provider-feedback.js?v=759',
  './batch-bookings.js?v=759',
  './booking-policy-management.js?v=759',
  './team-calendar.js?v=759',
  './free-slots-share.js?v=759',
  './group-bookings.js?v=759',
  './booking-widgets.js?v=759',
  './onboarding.js?v=759',
  './client-messaging.js?v=759',
  './provider-read-fetch.js?v=759',
  './data-governance.js?v=759',
  './report-reconciliation.js?v=759',
  './report-demo-live.js?v=759',
  './report-worker.js?v=759',
  './theme-catalog.js?v=759',
  './provider-color-mode.js?v=759',
  './client-directory.js?v=759',
  './client-results.js?v=759',
  './provider.js?v=759',
  './voice-wake.js?v=759',
  './provider-feature-assets.js?v=759',
  './client-records.js?v=759',
];

// Warm after the first screen. A cold installation must not wait for tools
// that are only used from a dialog; retain their offline use after warming.
const OPTIONAL_ASSETS = [
  './benefit-lifecycle.css?v=759',
  './benefit-lifecycle.js?v=759',
  './provider-feedback-inbox.js?v=759',
  './free-slots-compact.css?v=759',
  './vendor/qrcodegen.js?v=759',
  './code-scanner.css?v=759',
  './code-scanner.js?v=759',
  './portfolio-camera.js?v=759',
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
