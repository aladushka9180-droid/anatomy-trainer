const CACHE_PREFIX = 'massage-izhevsk-';
const CACHE = `${CACHE_PREFIX}v496`;
const ASSETS = [
  './microphone-diagnostic.js?v=496',
  './report-reconciliation.js?v=496',
  './provider-apricot-tiger-mobile.svg?v=496',
  './provider-apricot-tiger.svg?v=496',
  './provider-snow-leopard-natural-v2.webp?v=496',
  './provider-snow-leopard-continuous-4k-v3.webp?v=496',
  './provider-header.css?v=496',
  './settings-nav-scroll.css?v=496',
  './settings-nav-scroll.js?v=496',
  './settings-smart-search.css?v=496',
  './settings-smart-search.js?v=496',
  './contextual-help.css?v=496',
  './contextual-help.js?v=496',
  './settings-mobile-minimalism.css?v=496',
  './provider-themes-wildlife.css?v=496',
  './provider-theme-noir-safari.css?v=496',
  './provider-noir-safari-bg.webp?v=496',
  './provider-pearl-zebra-smooth-4k-v4.webp?v=496',
  './free-slots-compact.css?v=496',
  './vendor/qrcodegen.js?v=496',
  './provider-layout-responsive.css?v=496',
  './provider-ux.css?v=496',
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
  './help/help.css?v=496',
  './help/help-data.js?v=496',
  './help/help.js?v=496',
  './help/article.js?v=496',
  './help/category.js?v=496',
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
  './provider.webmanifest?v=496',
  './provider-icon-192.png',
  './provider-icon-512.png',
  './provider-icon-maskable-512.png',
  './provider-luxury-marble-v4.webp',
  './styles.css?v=496',
  './code-scanner.css?v=496',
  './utm-funnel.css?v=496',
  './onboarding.css?v=496',
  './visitor-presence.css?v=496',
  './subscription-pricing.css?v=496',
  './provider-theme-loft-modern.css?v=496',
  './provider-themes-signature.css?v=496',
  './provider-themes-calm.css?v=496',
  './config.js?v=496',
  './site-update.js?v=496',
  './reliability.js?v=496',
  './phone-auth.js?v=496',
  './social-auth.js?v=496',
  './app.js?v=496',
  './resource-management.js?v=496',
  './shift-management.js?v=496',
  './organization.js?v=496',
  './payroll-management.js?v=496',
  './benefit-management.js?v=496',
  './loyalty-management.js?v=496',
  './inventory-management.js?v=496',
  './retention-management.js?v=496',
  './payment-management.js?v=496',
  './notification-center.js?v=496',
  './client-fields.js?v=496',
  './client-records.css?v=496',
  './client-records.js?v=496',
  './client-import.js?v=496',
  './code-scanner.js?v=496',
  './provider-feedback.js?v=496',
  './batch-bookings.js?v=496',
  './booking-policy-management.js?v=496',
  './team-calendar.js?v=496',
  './free-slots-share.js?v=496',
  './group-bookings.js?v=496',
  './telegram-auth.js?v=496',
  './pwa-install.js?v=496',
  './client-messaging.js?v=496',
  './provider-read-fetch.js?v=496',
  './provider.js?v=496',
  './data-governance.js?v=496',
  './onboarding.js?v=496',
  './report-worker.js?v=496',
  './voice-assistant.js?v=496',
  './booking.js?v=496',
  './my-bookings.js?v=496',
  './waitlist.js?v=496',
  './privacy.js?v=496',
  './ui-icons.svg',
  './ui-icons.svg?v=496',
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
