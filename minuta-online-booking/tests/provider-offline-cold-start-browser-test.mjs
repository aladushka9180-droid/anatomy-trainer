import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const providerSource = readFileSync(resolve(root, 'provider.js'), 'utf8');
const reliabilitySource = readFileSync(resolve(root, 'reliability.js'), 'utf8');
const providerHtml = readFileSync(resolve(root, 'provider.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');

function actual(name) {
  const start = providerSource.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, name);
  const next = providerSource.slice(start + 1).search(/^(?:async )?function /m);
  return providerSource.slice(start, next < 0 ? undefined : start + next + 1);
}

const helperSource = `
  const PROVIDER_CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
  const PROVIDER_OFFLINE_SNAPSHOT_VERSION = 1;
  const SCHEDULE_BLOCK_SERVICE_NAME = '__minuta_schedule_block__';
  const reliability = window.MinutaReliability;
  const $ = selector => document.querySelector(selector);
  let currentUser = { id:'provider-1' };
  let sessionGeneration = 1;
  let providerSessionTrust = 'verified';
  let allBookings = [{ id:'booking-1', booking_date:'2026-09-13', booking_time:'12:00', client_name:'Клиент из копии' }];
  let ownServices = [{ id:'service-1', name:'Услуга', active:true, duration_minutes:60 }];
  let scheduleRows = [{ weekday:7, start_time:'10:00', end_time:'20:00', slot_interval_minutes:5 }];
  let daysOff = [];
  let offlineBookingInputsReady = true;
  let offlineBookingAccessReady = false;
  let bookingsSnapshotSavedAt = '';
  const pendingBookingColors = new Set(), pendingBookingNotes = new Set(), pendingClientLabels = new Set(), pendingClientNotes = new Map();
  function cachePayload(_name, value) { return value; }
  function sessionIsCurrent(userId, generation) { return currentUser?.id === userId && sessionGeneration === generation; }
  function renderProviderVerification() {}
  function recordConnectionEvent() {}
  function applyWriteAvailability() {}
  ${actual('providerCacheKey')}
  ${actual('providerOfflineSnapshotKey')}
  ${actual('validProviderOfflineSnapshot')}
  ${actual('readProviderOfflineSnapshot')}
  ${actual('saveProviderOfflineSnapshot')}
  ${actual('offlineBookingSnapshotFresh')}
  ${actual('canQueueOfflineBooking')}
  ${actual('offlineBookingStatusText')}
  ${actual('compactSyncLabel')}
  ${actual('setSyncState')}
`;

let origin;
const server = createServer((request, response) => {
  try {
    const url = new URL(request.url, origin);
    const relative = decodeURIComponent(url.pathname).replace(/^\/minuta-online-booking\//, '');
    const target = resolve(root, relative || 'provider.html');
    if (!target.startsWith(root + sep)) throw new Error('path_escape');
    const body = relative === 'provider.html' ? providerHtml : readFileSync(target);
    const type = ({ '.html':'text/html; charset=utf-8', '.css':'text/css', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.webp':'image/webp' })[extname(target)] || 'application/octet-stream';
    response.writeHead(200, { 'content-type':type });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end();
  }
});
await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
origin = `http://127.0.0.1:${server.address().port}`;

const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href
  : 'playwright');
const browser = await chromium.launch({ headless:true, channel:process.env.BROWSER_CHANNEL || 'chrome' });

try {
  for (const width of [390, 760, 1440]) {
    const context = await browser.newContext({ viewport:{ width, height:900 }, serviceWorkers:'block', bypassCSP:true });
    const onlinePage = await context.newPage();
    await onlinePage.goto(`${origin}/minuta-online-booking/provider.html`);
    await onlinePage.addScriptTag({ content:reliabilitySource });
    await onlinePage.addScriptTag({ content:helperSource });
    assert.equal(await onlinePage.evaluate(async () => Boolean(await saveProviderOfflineSnapshot('provider-1', 1))), true);
    await onlinePage.close();

    await context.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'onLine', { configurable:true, get:() => false });
    });
    const offlinePage = await context.newPage();
    const errors = [];
    offlinePage.on('pageerror', error => errors.push(error.message));
    await offlinePage.goto(`${origin}/minuta-online-booking/provider.html`);
    await offlinePage.addScriptTag({ content:reliabilitySource });
    await offlinePage.addScriptTag({ content:helperSource });
    const state = await offlinePage.evaluate(async () => {
      providerSessionTrust = 'cached';
      const snapshot = await readProviderOfflineSnapshot('provider-1');
      offlineBookingAccessReady = Boolean(snapshot);
      offlineBookingInputsReady = Boolean(snapshot);
      bookingsSnapshotSavedAt = String(snapshot?.savedAt || '');
      allBookings = snapshot?.data?.bookings || [];
      ownServices = snapshot?.data?.services || [];
      document.documentElement.classList.remove('provider-booting');
      document.documentElement.classList.add('provider-ready', 'top-level');
      document.querySelector('#providerBoot').hidden = true;
      document.querySelector('#authCard').hidden = true;
      document.querySelector('#dashboard').hidden = false;
      document.body.dataset.providerTheme = 'sage';
      document.body.dataset.providerLayout = 'capsule';
      setSyncState('offline', offlineBookingStatusText());
      const create = document.querySelector('#newBookingButton');
      if (create) create.disabled = false;
      return {
        ready:canQueueOfflineBooking(),
        text:offlineBookingStatusText(),
        title:document.querySelector('#syncState').title,
        compact:document.querySelector('#syncState span').textContent,
        overflow:document.documentElement.scrollWidth > innerWidth + 1,
        loginVisible:!document.querySelector('#authCard').hidden,
        dashboardVisible:!document.querySelector('#dashboard').hidden,
        createHeight:create?.getBoundingClientRect().height || 0
      };
    });
    assert.equal(state.ready, true);
    assert.equal(state.text, 'Офлайн · можно создавать отложенные записи');
    assert.match(state.title, /можно создавать отложенные записи/);
    assert.equal(state.compact, 'Нет интернета');
    assert.equal(state.overflow, false);
    assert.equal(state.loginVisible, false);
    assert.equal(state.dashboardVisible, true);
    assert.ok(state.createHeight >= 40, `new booking target at ${width}px: ${state.createHeight}`);
    assert.deepEqual(errors, []);
    if (process.env.MINUTA_AUDIT_SCREENSHOTS) {
      mkdirSync(process.env.MINUTA_AUDIT_SCREENSHOTS, { recursive:true });
      await offlinePage.screenshot({ path:resolve(process.env.MINUTA_AUDIT_SCREENSHOTS, `provider-offline-cold-start-${width}.png`), fullPage:true });
    }
    await context.close();
    console.log(`PASS provider cold offline snapshot and queue readiness at ${width}px`);
  }
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolveClose => server.close(resolveClose));
}
