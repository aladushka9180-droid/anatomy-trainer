import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

// Inert loopback pages, no backend. A network request never answers while the
// complete cached shell remains usable. It must not block the following release.
const source = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const version = source.match(/const CACHE = `\$\{CACHE_PREFIX\}v(\d+)`;/)?.[1];
assert.ok(version);
const future = String(Number(version) + 1);
let worker = source;
let servedVersion = version;
let scenario = 'initial';
let holdNavigation = false;
let heldRequests = 0;
const pendingResponses = new Set();
const workerRequests = [];
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  if (path.endsWith('/sw.js')) workerRequests.push({ servedVersion, holdNavigation });
  if (holdNavigation && path === '/provider.html') {
    heldRequests++;
    pendingResponses.add(response);
    response.once('close', () => pendingResponses.delete(response));
    return; // Intentionally never answer, including after the fallback deadline.
  }
  const html = `<!doctype html><html><body data-release="${servedVersion}" data-scenario="${scenario}">Synthetic update fixture</body></html>`;
  const body = path.endsWith('/sw.js') ? worker : path.endsWith('.html') || path.endsWith('/') ? html : '';
  const respond = () => response.writeHead(200, {
    'Content-Type': path.endsWith('.js') ? 'text/javascript' : 'text/html',
    'Cache-Control': 'no-store', 'Service-Worker-Allowed': '/',
    'Content-Security-Policy': "default-src 'self'; connect-src 'self'; script-src 'self'; worker-src 'self'; object-src 'none'"
  }).end(body);
  if (path === '/slow-uncached.html') setTimeout(respond, 5200);
  else respond();
});
let browser;
let page;
const errors = [];
async function ready(expected, previousController = null) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const matched = await page.evaluate(async ({ expected, previousController }) => {
      const controller = navigator.serviceWorker.controller;
      // Do not keep the outgoing worker busy with extendable message events.
      // First observe the real controller handoff, then verify its ready build.
      if (!controller || controller === previousController) return false;
      const info = await new Promise(resolve => {
        const channel = new MessageChannel();
        const timer = setTimeout(() => { channel.port1.close(); resolve(null); }, 1200);
        channel.port1.onmessage = event => {
          clearTimeout(timer); channel.port1.close(); resolve(event.data);
        };
        controller.postMessage({ type:'site-update-version' }, [channel.port2]);
      });
      return controller === navigator.serviceWorker.controller && info?.ready === true && info.version === Number(expected);
    }, { expected, previousController });
    if (matched === true) return;
    await page.waitForTimeout(50);
  }
  const registration = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return {
      active:registration?.active?.state,
      waiting:registration?.waiting?.state,
      installing:registration?.installing?.state,
      controller:navigator.serviceWorker.controller?.scriptURL,
      caches:await caches.keys()
    };
  });
  assert.fail(`Pending navigation prevented ready worker ${expected}: ${JSON.stringify({ registration, workerRequests, heldRequests, pendingResponses:pendingResponses.size })}`);
}
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
  browser = await chromium.launch({ headless:true, channel:process.env.BROWSER_CHANNEL || (process.platform === 'win32' ? 'chrome' : undefined) });
  const context = await browser.newContext({ serviceWorkers:'allow' });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/provider.html`);
  await page.evaluate(version => navigator.serviceWorker.register(`/sw.js?v=${version}`, { updateViaCache:'none' }), version);
  await ready(version);
  await page.evaluate(() => localStorage.setItem('synthetic-offline-draft', 'preserved'));

  holdNavigation = true;
  await page.reload();
  assert.ok(heldRequests > 0, 'The reload must encounter the held network request');
  assert.equal(await page.locator('body').getAttribute('data-release'), version, 'The cached shell remains usable');
  holdNavigation = false;
  worker = source.replaceAll(`v=${version}`, `v=${future}`).replaceAll(`v${version}`, `v${future}`);
  servedVersion = future;
  const previousController = await page.evaluateHandle(() => navigator.serviceWorker.controller);
  try {
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await ready(future, previousController);
  } finally {
    await previousController.dispose();
  }
  assert.equal(await page.locator('body').getAttribute('data-release'), version, 'Worker activation does not reload the document');
  assert.equal(await page.evaluate(() => localStorage.getItem('synthetic-offline-draft')), 'preserved');

  scenario = 'fresh';
  const fastStart = Date.now();
  await page.reload();
  const fastMs = Date.now() - fastStart;
  assert.equal(await page.locator('body').getAttribute('data-scenario'), 'fresh', 'A fast explicit reload returns the fresh shell');

  assert.equal(await page.evaluate(async version => {
    const cache = await caches.open(`massage-izhevsk-v${version}`);
    await cache.delete('/index.html');
    return (await cache.match('/index.html')) === undefined;
  }, future), true, 'The cold navigation must have no cached shell');
  scenario = 'slow-uncached';
  const coldStart = Date.now();
  await page.goto(`${origin}/slow-uncached.html`);
  const coldMs = Date.now() - coldStart;
  assert.ok(coldMs >= 5000, 'The uncached navigation must wait longer than the cached fallback deadline');
  assert.equal(await page.locator('body').getAttribute('data-scenario'), 'slow-uncached');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ heldRequests, ready:future, fastMs, coldMs, draftPreserved:true }));
  console.log('PASS: pending cached reload cannot block the next release; cold and fast navigation preserved');
} finally {
  await browser?.close();
  for (const response of pendingResponses) response.destroy();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
