import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const providerSource = fs.readFileSync(path.join(root, 'provider.js'), 'utf8');
function actual(name) {
  const start = providerSource.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, name);
  const next = providerSource.slice(start + 1).search(/^(?:async )?function /m);
  return providerSource.slice(start, next < 0 ? undefined : start + 1 + next);
}
const output = process.env.MINUTA_CONNECTION_GUIDANCE_OUTPUT || '';
if (output) fs.mkdirSync(output, { recursive:true });
const html = fs.readFileSync(path.join(root, 'provider.html'), 'utf8')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/gi, '');
const server = http.createServer((request, response) => {
  const requested = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const file = path.resolve(root, `.${requested}`);
  if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404).end(); return; }
  response.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'application/javascript' : 'text/html; charset=utf-8');
  response.end(file.endsWith('provider.html') ? html : fs.readFileSync(file));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

let browser;
try {
  browser = await chromium.launch({ headless:true, executablePath:process.env.MINUTA_CHROME_PATH });
  const page = await browser.newPage();
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.goto(`${base}/provider.html`);
  await page.addStyleTag({ url:`${base}/provider-connection-guidance.css` });
  await page.addScriptTag({ url:`${base}/provider-connection-guidance.js` });
  await page.evaluate(() => {
    document.documentElement.classList.remove('provider-booting', 'requires-top-level');
    document.querySelector('#providerBoot')?.remove();
    document.querySelector('#dashboard').hidden = false;
    document.querySelector('#authCard').hidden = true;
    document.querySelector('#dashboard').dataset.activeView = 'bookings';
    document.body.dataset.providerTheme = 'pink-porcelain';
    document.querySelectorAll('.provider-view').forEach(view => { view.hidden = view.dataset.providerPanel !== 'bookings'; });
    if (!document.querySelector('#providerConnectionGuidance')) document.querySelector('.schedule-view-title').insertAdjacentHTML('afterend', `
      <section class="provider-connection-guidance" id="providerConnectionGuidance" aria-live="polite" hidden>
        <div class="provider-connection-guidance-copy"><strong id="providerConnectionGuidanceTitle"></strong><span id="providerConnectionGuidanceDescription"></span>
          <details class="provider-connection-guidance-help" id="providerConnectionGuidanceHelp"><summary>Что делать?</summary><p>Проверьте Wi‑Fi или мобильный интернет. Если связь не восстановилась, попробуйте выключить и снова включить подключение.</p></details>
        </div><div class="provider-connection-guidance-actions"><button class="secondary-button compact-button" id="providerConnectionGuidanceCheck" type="button">Проверить связь</button><button class="secondary-button compact-button" id="providerConnectionGuidanceInspect" type="button" hidden>Посмотреть</button></div>
      </section>`);
    window.setGuidance = state => {
      const result = window.MinutaProviderConnectionGuidance.view(state);
      const panel = document.querySelector('#providerConnectionGuidance');
      panel.hidden = !result;
      if (!result) return;
      document.querySelector('#providerConnectionGuidanceTitle').textContent = result.title;
      document.querySelector('#providerConnectionGuidanceDescription').textContent = result.description;
      document.querySelector('#providerConnectionGuidanceHelp').hidden = !result.help;
      document.querySelector('#providerConnectionGuidanceInspect').hidden = !result.inspect;
    };
  });
  for (const width of [390, 760, 1440]) {
    await page.setViewportSize({ width, height:850 });
    await page.evaluate(() => window.setGuidance({ online:false, hasUser:true, sessionTrust:'cached', canQueueBooking:true, hasSavedSchedule:true }));
    const panel = page.locator('#providerConnectionGuidance');
    assert.equal(await panel.isVisible(), true);
    assert.match(await panel.innerText(), /Нет интернета/);
    assert.match(await panel.innerText(), /Можно смотреть сохранённые записи и добавлять новые/);
    await page.locator('#providerConnectionGuidanceHelp summary').click();
    assert.match(await panel.innerText(), /Проверьте Wi‑Fi или мобильный интернет/);
    const geometry = await page.evaluate(() => ({
      overflow:document.documentElement.scrollWidth > innerWidth + 2,
      title:document.querySelector('#providerConnectionGuidanceTitle').getBoundingClientRect().width,
      button:document.querySelector('#providerConnectionGuidanceCheck').getBoundingClientRect().width
    }));
    assert.equal(geometry.overflow, false, `${width}px horizontal overflow`);
    assert.ok(geometry.title > 0 && geometry.button >= 100, `${width}px content visible`);
    if (output) await page.screenshot({ path:path.join(output, `connection-guidance-${width}.png`) });
    await page.locator('#providerConnectionGuidanceHelp summary').click();
  }
  await page.evaluate(() => window.setGuidance({ online:true, hasUser:true, sessionTrust:'verified', serverUnavailable:true, canQueueBooking:false, hasSavedSchedule:false }));
  assert.match(await page.locator('#providerConnectionGuidance').innerText(), /Нет связи с сервером/);
  assert.equal(await page.locator('#providerConnectionGuidanceHelp').isVisible(), false);
  await page.evaluate(() => window.setGuidance({ online:true, hasUser:true, sessionTrust:'verified', recovery:{ kind:'complete', text:'Сохранены 2 записи, 1 запись требует проверки' } }));
  assert.equal(await page.locator('#providerConnectionGuidanceInspect').isVisible(), true);
  await page.evaluate(() => window.setGuidance({ online:true, hasUser:true, sessionTrust:'verified' }));
  assert.equal(await page.locator('#providerConnectionGuidance').isVisible(), false);
  await page.addScriptTag({ content:`
    const $ = selector => document.querySelector(selector);
    let currentUser = { id:'actor-a' }, providerSessionTrust = 'verified';
    let offlineBookingAccessReady = true, offlineBookingInputsReady = true;
    let bookingReadConnectionUnavailable = false, offlineBookingQueue = [];
    const connectionGuidanceTracker = window.MinutaProviderConnectionGuidance.createRecoveryTracker();
    let connectionGuidanceRecovery = null, connectionGuidanceActor = '', connectionGuidanceTimer = null;
    function offlineBookingSnapshotFresh() { return window.testSavedSchedule; }
    function canQueueOfflineBooking() { return window.testCanQueue; }
    function recordConnectionEvent() {}
    function showProviderSystemNotification() { throw new Error('no system notification in synthetic test'); }
    window.testOnline = true; window.testSavedSchedule = true; window.testCanQueue = false;
    Object.defineProperty(Navigator.prototype, 'onLine', { configurable:true, get:() => window.testOnline });
    ${actual('resetConnectionGuidance')}
    ${actual('beginConnectionGuidanceRecovery')}
    ${actual('finishConnectionGuidanceRecovery')}
    ${actual('renderProviderConnectionGuidance')}
  ` });
  const integrated = await page.evaluate(() => {
    window.testOnline = false;
    window.testCanQueue = true;
    renderProviderConnectionGuidance();
    const offline = $('#providerConnectionGuidance').innerText;
    window.testSavedSchedule = false;
    renderProviderConnectionGuidance();
    const noSnapshot = $('#providerConnectionGuidance').innerText;
    window.testOnline = true;
    providerSessionTrust = 'verified';
    bookingReadConnectionUnavailable = true;
    renderProviderConnectionGuidance();
    const server = $('#providerConnectionGuidance').innerText;
    providerSessionTrust = 'cached';
    renderProviderConnectionGuidance();
    const session = $('#providerConnectionGuidance').innerText;
    providerSessionTrust = 'verified';
    bookingReadConnectionUnavailable = false;
    window.testSavedSchedule = true;
    offlineBookingQueue = [{ id:'confirmed', status:'pending' }, { id:'conflict', status:'pending' }];
    beginConnectionGuidanceRecovery();
    connectionGuidanceTracker.confirm('actor-a', 'confirmed');
    offlineBookingQueue = [{ id:'conflict', status:'conflict' }];
    finishConnectionGuidanceRecovery(true, true);
    const summary = $('#providerConnectionGuidance').innerText;
    currentUser = { id:'actor-b' };
    renderProviderConnectionGuidance();
    return { offline, noSnapshot, server, session, summary, afterAccountChange:$('#providerConnectionGuidance').hidden };
  });
  assert.match(integrated.offline, /добавлять новые/);
  assert.doesNotMatch(integrated.noSnapshot, /добавлять новые/);
  assert.match(integrated.server, /Нет связи с сервером/);
  assert.doesNotMatch(integrated.server, /Нет интернета/);
  assert.match(integrated.session, /Проверяем доступ/);
  assert.match(integrated.summary, /Сохранена 1 запись, 1 запись требует проверки/);
  assert.equal(integrated.afterAccountChange, true);
  const clickStart = providerSource.indexOf("$('#providerConnectionGuidanceCheck')?.addEventListener");
  const clickEnd = providerSource.indexOf("$('#providerConnectionGuidanceInspect')?.addEventListener", clickStart);
  assert.ok(clickStart >= 0 && clickEnd > clickStart);
  await page.addScriptTag({content:`
    let manualSynchronizationPromise = null, synchronizationPromise = null;
    let sessionGeneration = 1, bookingCreationReady = false;
    let cachedProviderVerification = null, cachedProviderVerificationRetryTimer = null;
    let connectionGuidanceOutageObserved = false;
    const pendingBookingColors = new Map(), pendingBookingNotes = new Map();
    const pendingClientLabels = new Map(), pendingClientNotes = new Map();
    function sessionIsCurrent(id, generation) { return currentUser?.id === id && generation === sessionGeneration; }
    function notify(text) { $('#toast').hidden = false; $('#toast').textContent = text; }
    const db = {auth:{getSession:async () => {
      window.testAuthCalls++;
      await new Promise(resolve => { window.testReleaseAuth = resolve; });
      return {data:{session:{user:{id:currentUser.id}}},error:null};
    }}};
    async function providerAccessAllowed() { return window.testAccess; }
    async function handleSession() { providerSessionTrust = 'verified'; sessionGeneration++; }
    async function rejectCachedProviderSession() { throw new Error('Unexpected rejection'); }
    function authTemporarilyUnavailable() { return true; }
    async function synchronizeProvider() {
      if (providerSessionTrust !== 'verified') throw new Error('Refresh before access verification');
      window.testSyncCalls++; return true;
    }
    async function flushOfflineBookings() { throw new Error('No booking writes in this fixture'); }
    ${actual('verifyCachedProviderSession')}
    ${actual('manualSynchronizeProvider')}
    ${providerSource.slice(clickStart, clickEnd)}
  `});
  for (const width of [390, 760, 1440]) {
    await page.setViewportSize({width, height:850});
    await page.evaluate(() => {
      resetConnectionGuidance(); providerSessionTrust = 'cached';
      window.testOnline = true; window.testAccess = true;
      window.testAuthCalls = 0; window.testSyncCalls = 0;
      renderProviderConnectionGuidance();
    });
    await page.locator('#providerConnectionGuidanceCheck').click();
    assert.equal(await page.locator('#providerConnectionGuidanceCheck').isDisabled(), true);
    assert.deepEqual(await page.evaluate(() => [window.testAuthCalls, window.testSyncCalls]), [1,0]);
    await page.evaluate(() => window.testReleaseAuth());
    await page.locator('#providerConnectionGuidance').waitFor({state:'hidden'});
    assert.equal(await page.locator('#toast').innerText(), 'Все данные обновлены');
    assert.deepEqual(await page.evaluate(() => [window.testAuthCalls, window.testSyncCalls]), [1,1]);
    if (output) await page.screenshot({path:path.join(output, `session-retry-success-${width}.png`)});
  }
  await page.evaluate(() => { providerSessionTrust = 'cached'; window.testAccess = null; renderProviderConnectionGuidance(); });
  await page.locator('#providerConnectionGuidanceCheck').click();
  await page.evaluate(() => window.testReleaseAuth());
  await page.waitForFunction(() => !document.querySelector('#providerConnectionGuidanceCheck').disabled);
  assert.equal(await page.locator('#providerConnectionGuidance').isVisible(), true);
  assert.match(await page.locator('#toast').innerText(), /Не удалось подтвердить сеанс/);
  assert.equal(await page.evaluate(() => window.testSyncCalls), 1);
  await page.evaluate(() => clearTimeout(cachedProviderVerificationRetryTimer));
  await page.addScriptTag({content:`
    let providerVerifiedSessionExpiresAt = 0;
    let bookingsSnapshotSavedAt = new Date().toISOString();
    const PROVIDER_CACHE_MAX_AGE = 7 * 86400000;
    const ownServices = [{id:'synthetic-service', active:true}];
    ${actual('offlineBookingSnapshotFresh')}
    ${actual('bookingDeferredMode')}
    ${actual('canQueueOfflineBooking')}
    ${actual('offlineBookingStatusText')}
  `});
  for (const width of [390, 760, 1440]) for (const theme of ['pink-porcelain', 'carbon-crimson']) {
    await page.setViewportSize({width, height:850});
    await page.evaluate(theme => {
      $('#toast').hidden = true;
      document.body.dataset.providerTheme = theme;
      providerSessionTrust = 'cached'; window.testOnline = true;
      offlineBookingAccessReady = true; offlineBookingInputsReady = true;
      bookingReadConnectionUnavailable = false;
      renderProviderConnectionGuidance();
    }, theme);
    const panel = page.locator('#providerConnectionGuidance');
    assert.match(await panel.innerText(), /Проверяем доступ/);
    assert.match(await panel.innerText(), /смотреть сохранённые записи и добавлять новые/);
    assert.doesNotMatch(await panel.innerText(), /Новые записи пока недоступны/);
    assert.deepEqual(await page.evaluate(() => [bookingDeferredMode(), canQueueOfflineBooking()]), [true,true]);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
    if (output) await page.screenshot({path:path.join(output, `cached-session-${theme}-${width}.png`)});
  }
  await page.evaluate(() => { offlineBookingAccessReady = false; renderProviderConnectionGuidance(); });
  assert.doesNotMatch(await page.locator('#providerConnectionGuidance').innerText(), /добавлять новые|сохраним на устройстве/);
  assert.equal(await page.evaluate(() => canQueueOfflineBooking()), false);
  console.log('provider connection guidance browser: 390/760/1440, offline/help/server/recovery/normal online PASS');
  console.log('cached online booking: real gates and banner, 390/760/1440 in light/dark themes PASS');
  console.log('manual session retry browser: real button, verified recovery and temporary failure PASS');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
