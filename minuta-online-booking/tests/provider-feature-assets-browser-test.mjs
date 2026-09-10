import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'provider.html'), 'utf8');
const worker = readFileSync(resolve(root, 'sw.js'), 'utf8');
const version = worker.match(/const CACHE = `\$\{CACHE_PREFIX\}v(\d+)`;/)[1];
const optional = ['free-slots-compact.css', 'vendor/qrcodegen.js', 'code-scanner.css', 'code-scanner.js'];
const activeHtml = html.replace(/<template\b[^>]*>[\s\S]*?<\/template>/g, '');
const coreManifest = worker.match(/const ASSETS = \[([\s\S]*?)\];/)[1];
for (const file of optional) {
  assert.ok(!activeHtml.includes(`"${file}?`), `${file} must not be an initial resource`);
  assert.ok(!coreManifest.includes(`./${file}?`), `${file} must not delay core installation`);
}
assert.ok(activeHtml.includes(`provider-feature-assets.js?v=${version}`), 'The loader must start with the page');
const savedBytes = optional.reduce((sum, file) => sum + statSync(resolve(root, file)).size, 0)
  - statSync(resolve(root, 'provider-feature-assets.js')).size;
assert.ok(savedBytes > 50000, 'At least 50 KB of source assets must leave the cold startup path');

// Keep the real HTML, styles, dialogs, loader and optional scripts. Auth and
// application bootstrap are intentionally inert in this isolated asset test.
const fixture = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, script =>
  /(?:provider-feature-assets|qrcodegen|code-scanner)\.js/.test(script) ? script : '');
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css',
  '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json', '.png':'image/png' };
let failScanner = false;
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const file = resolve(root, `.${pathname}`);
  if (!file.startsWith(`${root}${sep}`)) { response.writeHead(404).end(); return; }
  if (failScanner && pathname === '/code-scanner.js') {
    failScanner = false;
    response.writeHead(503).end('Temporary test failure');
    return;
  }
  try {
    response.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream');
    response.setHeader('Cache-Control', 'no-store');
    response.end(pathname === '/provider.html' ? fixture : readFileSync(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless:true,
  ...(process.env.MINUTA_BROWSER_CHANNEL ? { channel:process.env.MINUTA_BROWSER_CHANNEL } : {}) });
const contexts = [];

async function openPage() {
  const context = await browser.newContext();
  contexts.push(context);
  await context.addInitScript(() => {
    window.__warmTimers = [];
    window.__idleCallbacks = [];
    const timeout = window.setTimeout.bind(window);
    window.setTimeout = (callback, delay, ...args) => delay === 2500
      ? window.__warmTimers.push(callback) : timeout(callback, delay, ...args);
    window.requestIdleCallback = callback => window.__idleCallbacks.push(callback);
  });
  const page = await context.newPage();
  const requested = [];
  const errors = [];
  page.on('request', request => requested.push(new URL(request.url()).pathname.slice(1)));
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/provider.html`, { waitUntil:'load' });
  await exposeControls(page);
  return { page, context, requested, errors };
}

async function exposeControls(page) {
  await page.evaluate(() => {
    document.documentElement.classList.remove('provider-booting');
    document.documentElement.classList.add('top-level');
    document.getElementById('providerBoot').hidden = true;
    const scan = document.createElement('button');
    scan.id = 'fixtureScan';
    scan.dataset.codeScanTarget = 'fixtureCode';
    scan.textContent = 'Сканировать';
    const input = document.createElement('input');
    input.id = 'fixtureCode';
    document.body.prepend(scan, input);
    const share = document.getElementById('openFreeSlots');
    document.body.prepend(share);
    window.__shareClicks = 0;
    share.addEventListener('click', () => {
      if (!window.qrcodegen?.QrCode) throw new Error('Sharing ran before QR code loaded');
      window.__shareClicks++;
      document.getElementById('freeSlotsDialog').showModal();
    });
  });
}

async function runIdle(page) {
  await page.evaluate(() => {
    for (const timer of window.__warmTimers.splice(0)) timer();
  });
  assert.equal(await page.evaluate(() => window.__idleCallbacks.length), 1, 'Warmup must wait for browser idle');
  await page.evaluate(() => {
    for (const callback of window.__idleCallbacks.splice(0)) callback();
  });
  await page.waitForFunction(() => window.MinutaCodeScanner && window.qrcodegen);
}

try {
  const demand = await openPage();
  assert.deepEqual(demand.requested.filter(file => optional.includes(file)), [], 'A cold schedule must not request optional assets');
  await demand.page.locator('#fixtureScan').click();
  await demand.page.waitForFunction(() => document.getElementById('codeScannerDialog').open);
  assert.deepEqual(demand.requested.filter(file => optional.includes(file)), ['code-scanner.css', 'code-scanner.js']);
  await demand.page.locator('#codeScannerManual').fill('LOAD-TEST');
  await demand.page.locator('#codeScannerManualForm button').click();
  assert.equal(await demand.page.locator('#fixtureCode').inputValue(), 'LOAD-TEST', 'The original scanner must work after its first lazy click');
  await demand.page.locator('#openFreeSlots').click();
  await demand.page.waitForFunction(() => document.getElementById('freeSlotsDialog').open);
  assert.equal(await demand.page.evaluate(() => window.__shareClicks), 1, 'The first action must replay exactly once');
  await demand.page.evaluate(() => document.getElementById('freeSlotsDialog').close());
  await Promise.all([
    demand.page.evaluate(() => MinutaProviderFeatureAssets.ensure('scanner')),
    demand.page.evaluate(() => MinutaProviderFeatureAssets.ensure('scanner')),
  ]);
  assert.equal(demand.requested.filter(file => file === 'code-scanner.js').length, 1, 'Concurrent requests must reuse the loaded script');
  assert.deepEqual(demand.errors, []);

  const retry = await openPage();
  failScanner = true;
  await retry.page.locator('#fixtureScan').click();
  await retry.page.locator('#providerFeatureAssetError').waitFor({ state:'visible' });
  assert.equal(await retry.page.locator('#fixtureScan').getAttribute('aria-busy'), null);
  await retry.page.locator('#fixtureScan').click();
  await retry.page.waitForFunction(() => document.getElementById('codeScannerDialog').open);
  assert.equal(retry.requested.filter(file => file === 'code-scanner.css').length, 1, 'Retry must retain a successfully loaded stylesheet');
  assert.equal(retry.requested.filter(file => file === 'code-scanner.js').length, 2);
  assert.equal(await retry.page.locator('#providerFeatureAssetError').count(), 0);
  assert.deepEqual(retry.errors, []);

  const idle = await openPage();
  assert.deepEqual(idle.requested.filter(file => optional.includes(file)), []);
  await idle.page.evaluate(async version => {
    await navigator.serviceWorker.register(`./sw.js?v=${version}`);
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(resolveController =>
      navigator.serviceWorker.addEventListener('controllerchange', resolveController, { once:true }));
  }, version);
  assert.deepEqual(idle.requested.filter(file => optional.includes(file)), [], 'Installing the real worker must not warm dialogs');
  await runIdle(idle.page);
  await idle.page.waitForFunction(async ({ optional, version }) => {
    const cache = await caches.open(`massage-izhevsk-v${version}`);
    return (await Promise.all(optional.map(file => cache.match(`./${file}?v=${version}`)))).every(Boolean);
  }, { optional, version });
  await idle.context.setOffline(true);
  await idle.page.reload({ waitUntil:'load' });
  await exposeControls(idle.page);
  await idle.page.locator('#fixtureScan').click();
  await idle.page.waitForFunction(() => document.getElementById('codeScannerDialog').open);
  await idle.page.evaluate(() => document.getElementById('codeScannerDialog').close());
  await idle.page.locator('#openFreeSlots').click();
  await idle.page.waitForFunction(() => document.getElementById('freeSlotsDialog').open);
  assert.deepEqual(idle.errors, [], 'A warmed offline reload must retain both dialog tools');
  console.log(`Provider feature assets: PASS (4 assets deferred, 3 fewer startup requests, ${savedBytes} source bytes saved; first click, deduplication, retry, idle and real SW offline reload)`);
} finally {
  await Promise.all(contexts.map(context => context.close()));
  await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
}
