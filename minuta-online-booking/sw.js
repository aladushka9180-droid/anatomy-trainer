const CACHE_PREFIX = 'massage-izhevsk-';
const CACHE = `${CACHE_PREFIX}v912`;

const ASSETS = [
  './provider.html',
  './offline.html',
  './offline.js',
  './provider.webmanifest?v=876',
  './provider-icon-192.png?v=876',
  './provider-icon-512.png?v=876',
  './provider-icon-maskable-512.png?v=876',
  './provider-icon.svg?v=876',
  './icon.svg',
  './ui-icons.svg',
  './styles.css?v=907',
  './utm-funnel.css?v=811',
  './onboarding.css?v=811',
  './visitor-presence.css?v=811',
  './subscription-pricing.css?v=811',
  './provider-theme-loft-modern.css?v=811',
  './provider-themes-signature.css?v=885',
  './provider-themes-calm.css?v=811',
  './provider-layout-responsive.css?v=811',
  './provider-ux.css?v=886',
  './provider-price-list.css?v=871',
  './provider-service-actions.css?v=811',
  './provider-header.css?v=865',
  './provider-themes-wildlife.css?v=811',
  './client-results.css?v=876',
  './client-directory.css?v=811',
  './provider-ui-refinements.css?v=811',
  './provider-schedule-minimal.css?v=911',
  './provider-themes-distinct.css?v=821',
  './provider-theme-families.css?v=885',
  './provider-theme-backgrounds-tema1.css?v=865',
  './vendor/supabase-2.112.4.min.js',
  './config.js?v=811',
  './pwa-install.js?v=811',
  './site-update.js?v=912',
  './provider-porcelain-preview-guard.js?v=893',
  './reliability.js?v=811',
  './phone-auth.js?v=811',
  './social-auth.js?v=811',
  './organization.js?v=884',
  './payment-management.js?v=904',
  './commerce-management.js?v=811',
  './client-fields.js?v=811',
  './client-import.js?v=811',
  './batch-bookings.js?v=811',
  './booking-policy-management.js?v=811',
  './team-calendar.js?v=811',
  './free-slots-share.js?v=811',
  './group-bookings.js?v=811',
  './booking-widgets.js?v=811',
  './onboarding.js?v=811',
  './provider-read-fetch.js?v=811',
  './data-governance.js?v=884',
  './report-reconciliation.js?v=811',
  './theme-catalog.js?v=885',
  './provider-color-mode.js?v=811',
  './client-directory.js?v=811',
  './client-results.js?v=876',
  './provider-service-actions.js?v=811',
  './provider-price-list.js?v=871',
  './provider.js?v=912',
  './voice-wake.js?v=811',
  './provider-feature-assets.js?v=908',
];

const OPTIONAL_ASSETS = [
  './statistics-audit-ui.css?v=908',
  './statistics-audit-ui.js?v=908',
  './statistics-audit-provider.js?v=908',
  './provider-porcelain-detail.css?v=912',
  './provider-porcelain-matrix.js?v=887',
  './provider-porcelain-detail.js?v=893',
  './porcelain-character-pearl-v2.webp',
  './porcelain-character-petal-v2.webp',
  './porcelain-character-silk-v2.webp',
  './client-themes.css?v=885',
  './report-demo-live.js?v=811',
  './loyalty-program-v166.js?v=865',
  './provider-schedule-desktop-reference.css?v=900',
  './settings-nav-scroll.js?v=882',
  './settings-smart-search.js?v=865',
  './provider-theme-noir-safari.css?v=811',
  './index.html',
  './redirect.js?v=826',
  './privacy.js?v=811',
  './settings-nav-scroll.css?v=865',
  './settings-smart-search.css?v=811',
  './provider-help-workspace.js?v=811',
  './provider-help-workspace.css?v=811',
  './contextual-help.css?v=811',
  './settings-mobile-minimalism.css?v=811',
  './provider-integrations.css?v=899',
  './finance-center.css?v=895',
  './finance-center.js?v=811',
  './finance-center-provider.js?v=811',
  './client-records.css?v=811',
  './client-records.js?v=811',
  './messages.html',
  './messages-center.css?v=886',
  './messages-core.js?v=811',
  './provider-messages-center.js?v=886',
  './client-messages.js?v=885',
  './provider-portfolio-responsive.css?v=811',
  './service-presets-catalog.js?v=811',
  './app.js?v=885',
  './service-presets.css?v=811',
  './service-presets.js?v=811',
  './report-worker.js?v=811',
  './benefit-lifecycle.css?v=811',
  './benefit-lifecycle.js?v=811',
  './provider-feedback-inbox.js?v=811',
  './client-messaging.js?v=811',
  './free-slots-compact.css?v=811',
  './vendor/qrcodegen.js?v=811',
  './code-scanner.css?v=811',
  './code-scanner.js?v=811',
  './portfolio-camera.js?v=811',
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
