const CACHE_PREFIX = 'massage-izhevsk-';
const CACHE = `${CACHE_PREFIX}v543`;
const ASSETS = [
  './microphone-diagnostic.js?v=543',
  './report-reconciliation.js?v=543',
  './provider-apricot-tiger-mobile.svg?v=543',
  './provider-apricot-tiger.svg?v=543',
  './provider-snow-leopard-natural-v2.webp?v=543',
  './provider-snow-leopard-unified-landscape-v5.png?v=543',
  './provider-snow-leopard-unified-portrait-v6.png?v=543',
  './theme-catalog.js?v=543',
  './client-themes.css?v=543',
  './provider-header.css?v=543',
  './settings-nav-scroll.css?v=543',
  './settings-nav-scroll.js?v=543',
  './settings-smart-search.css?v=543',
  './settings-smart-search.js?v=543',
  './contextual-help.css?v=543',
  './contextual-help.js?v=543',
  './settings-mobile-minimalism.css?v=543',
  './provider-themes-wildlife.css?v=543',
  './provider-theme-noir-safari.css?v=543',
  './provider-noir-safari-bg.webp?v=543',
  './provider-pearl-zebra-smooth-4k-v4.webp?v=543',
  './free-slots-compact.css?v=543',
  './vendor/qrcodegen.js?v=543',
  './provider-layout-responsive.css?v=543',
  './provider-ux.css?v=543',
  './',
  './index.html',
  './provider.html',
  './booking.html',
  './my-bookings.html',
  './waitlist.html',
  './privacy.html',
  './terms.html',
  './help/index.html',
  './help/article.html',
  './help/category.html',
  './help/help.css?v=543',
  './help/help-data.js?v=543',
  './help/help.js?v=543',
  './help/article.js?v=543',
  './help/category.js?v=543',
  './help/images/team-calendar.webp',
  './help/images/service-resources.webp',
  './help/images/client-import.webp',
  './help/images/yookassa.webp',
  './help/images/payroll.webp',
  './help/images/inventory.webp',
  './help/images/telegram-settings.webp',
  './help/images/install-app.webp',
  './help/images/manual-booking.webp',
  './help/images/recurring-series.webp',
  './help/images/reschedule-booking.webp',
  './help/images/date-exceptions.webp',
  './help/images/share-free-slots.webp',
  './help/images/client-card.webp',
  './help/images/batch-bookings.webp',
  './help/images/employee-access.webp',
  './help/images/staff-absence.webp',
  './help/images/staff-substitution.webp',
  './help/images/loyalty-rules.webp',
  './help/images/promo.webp',
  './help/images/benefit.webp',
  './help/images/benefit-product.webp',
  './help/images/inventory-operations.webp',
  './help/images/inventory-auto-deduct.webp',
  './help/images/statistics-report.webp',
  './help/images/export-report.webp',
  './help/images/portfolio.webp',
  './help/images/portfolio-manage.webp',
  './help/images/online-booking.webp',
  './help/images/my-bookings.webp',
  './help/images/waitlist.webp',
    './help/images/client-telegram.webp',
    './help/images/account-security.webp',
    './help/images/add-branch.webp',
    './help/images/add-service.webp',
    './help/images/add-staff-shift.webp',
    './help/images/adjust-redeem-loyalty.webp',
    './help/images/block-time-in-schedule.webp',
    './help/images/booking-card-appearance.webp',
    './help/images/booking-rules.webp',
    './help/images/business-goals.webp',
    './help/images/cabinet-layout-theme.webp',
    './help/images/confirm-or-delete-booking.webp',
    './help/images/customize-workdays-and-booking-step.webp',
    './help/images/employee-rights.webp',
    './help/images/find-and-filter-bookings.webp',
    './help/images/first-booking.webp',
    './help/images/mobile-navigation.webp',
    './help/images/notification-queue.webp',
    './help/images/notification-templates.webp',
    './help/images/organization-name.webp',
    './help/images/payroll-plan.webp',
    './help/images/publish-reviews.webp',
    './help/images/record-visit-result-and-payment.webp',
    './help/images/repeat-client-booking.webp',
    './help/images/reschedule.webp',
    './help/images/set-regular-workweek.webp',
    './help/images/settings-batch-bookings.webp',
    './help/images/settings-group-sessions.webp',
    './help/images/settings-quick-start.webp',
    './help/images/statistics-filters.webp',
    './help/images/statistics-sections.webp',
    './help/images/visitor-alerts.webp',
    './help/images/voice-assistant-actions.webp',
    './help/images/voice-assistant.webp',
    './help/images/yookassa-refund.webp',
  './provider.webmanifest?v=543',
  './provider-icon-192.png',
  './provider-icon-512.png',
  './provider-icon-maskable-512.png',
  './provider-luxury-marble-v4.webp',
  './styles.css?v=543',
  './code-scanner.css?v=543',
  './utm-funnel.css?v=543',
  './onboarding.css?v=543',
  './visitor-presence.css?v=543',
  './subscription-pricing.css?v=543',
  './provider-theme-loft-modern.css?v=543',
  './provider-themes-signature.css?v=543',
  './provider-themes-calm.css?v=543',
  './config.js?v=543',
  './site-update.js?v=543',
  './reliability.js?v=543',
  './phone-auth.js?v=543',
  './social-auth.js?v=543',
  './app.js?v=543',
  './resource-management.js?v=543',
  './shift-management.js?v=543',
  './organization.js?v=543',
  './payroll-management.js?v=543',
  './benefit-management.js?v=543',
  './loyalty-management.js?v=543',
  './inventory-management.js?v=543',
  './retention-management.js?v=543',
  './payment-management.js?v=543',
  './notification-center.js?v=543',
  './client-fields.js?v=543',
  './client-records.css?v=543',
  './client-records.js?v=543',
  './client-results.css?v=543',
  './client-results.js?v=543',
  './client-import.js?v=543',
  './code-scanner.js?v=543',
  './provider-feedback.js?v=543',
  './batch-bookings.js?v=543',
  './booking-policy-management.js?v=543',
  './team-calendar.js?v=543',
  './free-slots-share.js?v=543',
  './group-bookings.js?v=543',
  './telegram-auth.js?v=543',
  './pwa-install.js?v=543',
  './client-messaging.js?v=543',
  './provider-read-fetch.js?v=543',
  './provider.js?v=543',
  './client-directory.js?v=543',
  './client-directory.css?v=543',
  './provider-ui-refinements.css?v=543',
  './provider-schedule-minimal.css?v=543',
  './data-governance.js?v=543',
  './onboarding.js?v=543',
  './report-worker.js?v=543',
  './voice-assistant.js?v=543',
  './booking.js?v=543',
  './my-bookings.js?v=543',
  './waitlist.js?v=543',
  './privacy.js?v=543',
  './ui-icons.svg',
  './ui-icons.svg?v=543',
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
    const shell = path.endsWith('/help/article.html') ? './help/article.html' : path.endsWith('/help/category.html') ? './help/category.html' : path.endsWith('/help/') || path.endsWith('/help/index.html') ? './help/index.html' : path.endsWith('/booking.html') ? './booking.html' : path.endsWith('/my-bookings.html') ? './my-bookings.html' : path.endsWith('/waitlist.html') ? './waitlist.html' : path.endsWith('/provider.html') ? './provider.html' : path.endsWith('/privacy.html') ? './privacy.html' : path.endsWith('/terms.html') ? './terms.html' : './index.html';
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
