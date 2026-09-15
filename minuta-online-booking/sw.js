const CACHE_PREFIX = 'massage-izhevsk-';
const CACHE = `${CACHE_PREFIX}v806`;

// Only the provider shell and its first-screen dependencies block installation.
// Secondary sections, help media and decorative theme images are cached on use.
const ASSETS = [
  './provider.html',
  './offline.html',
  './offline.js',
  './provider.webmanifest?v=806',
  './provider-icon-192.png?v=806',
  './provider-icon-512.png?v=806',
  './provider-icon-maskable-512.png?v=806',
  './provider-icon.svg?v=806',
  './icon.svg',
  './ui-icons.svg',
  './styles.css?v=806',
  './utm-funnel.css?v=806',
  './onboarding.css?v=806',
  './visitor-presence.css?v=806',
  './subscription-pricing.css?v=806',
  './provider-theme-loft-modern.css?v=806',
  './provider-themes-signature.css?v=806',
  './provider-themes-calm.css?v=806',
  './provider-layout-responsive.css?v=806',
  './provider-ux.css?v=806',
  './provider-service-actions.css?v=806',
  './provider-header.css?v=806',
  './client-themes.css?v=806',
  './provider-themes-wildlife.css?v=806',
  './settings-nav-scroll.css?v=806',
  './settings-smart-search.css?v=806',
  './provider-help-workspace.css?v=806',
  './contextual-help.css?v=806',
  './settings-mobile-minimalism.css?v=806',
  './client-records.css?v=806',
  './provider-integrations.css?v=806',
  './client-results.css?v=806',
  './provider-theme-noir-safari.css?v=806',
  './client-directory.css?v=806',
  './provider-ui-refinements.css?v=806',
  './provider-schedule-minimal.css?v=806',
  './provider-themes-distinct.css?v=806',
  './provider-theme-families.css?v=806',
  './provider-theme-backgrounds-tema1.css?v=806',
  './vendor/supabase-2.112.4.min.js',
  './config.js?v=806',
  './pwa-install.js?v=806',
  './site-update.js?v=806',
  './reliability.js?v=806',
  './phone-auth.js?v=806',
  './social-auth.js?v=806',
  './privacy.js?v=806',
  './organization.js?v=806',
  './payment-management.js?v=806',
  './commerce-management.js?v=806',
  './client-fields.js?v=806',
  './client-import.js?v=806',
  './batch-bookings.js?v=806',
  './booking-policy-management.js?v=806',
  './team-calendar.js?v=806',
  './free-slots-share.js?v=806',
  './group-bookings.js?v=806',
  './booking-widgets.js?v=806',
  './onboarding.js?v=806',
  './provider-read-fetch.js?v=806',
  './data-governance.js?v=806',
  './report-reconciliation.js?v=806',
  './report-demo-live.js?v=806',
  './theme-catalog.js?v=806',
  './provider-color-mode.js?v=806',
  './client-directory.js?v=806',
  './client-results.js?v=806',
  './provider-service-actions.js?v=806',
  './provider.js?v=806',
  './provider-help-workspace.js?v=806',
  './voice-wake.js?v=806',
  './provider-feature-assets.js?v=806',
];

// Warm after the first screen. A cold installation must not wait for tools
// that are only used from a dialog; retain their offline use after warming.
const OPTIONAL_ASSETS = [
  './finance-center.css?v=806',
  './finance-center.js?v=806',
  './finance-center-provider.js?v=806',
  './client-records.js?v=806',
  './index.html',
  './messages.html',
  './messages-center.css?v=806',
  './messages-core.js?v=806',
  './provider-messages-center.js?v=806',
  './client-messages.js?v=806',
  './provider-portfolio-responsive.css?v=806',
  './service-presets-catalog.js?v=806',
  './app.js?v=806',
  './service-presets.css?v=806',
  './service-presets.js?v=806',
  './report-worker.js?v=806',
  './benefit-lifecycle.css?v=806',
  './benefit-lifecycle.js?v=806',
  './provider-feedback-inbox.js?v=806',
  './client-messaging.js?v=806',
  './free-slots-compact.css?v=806',
  './vendor/qrcodegen.js?v=806',
  './code-scanner.css?v=806',
  './code-scanner.js?v=806',
  './portfolio-camera.js?v=806',
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
  const view = ['bookings', 'clients', 'messages', 'notifications', 'waitlist', 'analytics', 'schedule', 'services', 'organization', 'portfolio', 'settings', 'more'].includes(requestedView) ? requestedView : 'notifications';
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
  if (path.endsWith('/messages.html')) return './messages.html';
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
