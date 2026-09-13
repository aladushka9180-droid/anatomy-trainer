import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const playwright = await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const chromium = playwright.chromium || playwright.default?.chromium;
const mime = {
  '.css':'text/css; charset=utf-8', '.html':'text/html; charset=utf-8', '.js':'application/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp', '.woff2':'font/woff2'
};
const probe = `<!doctype html><html><head><meta charset="utf-8"><title>PWA v151</title></head><body><p>v151 PWA probe</p><script>
window.addEventListener('load',async()=>{
  await caches.open('massage-izhevsk-v734');
  const script=document.createElement('script');
  script.src='./site-update.js?v=736';
  script.onload=()=>window.dispatchEvent(new Event('load'));
  document.head.append(script);
},{once:true});
</script></body></html>`;

const server = createServer((request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  if (url.pathname === '/minuta-online-booking/pwa-v151-test.html') {
    response.writeHead(200, { 'content-type':'text/html; charset=utf-8', 'cache-control':'no-store' });
    response.end(probe);
    return;
  }
  const prefix = '/minuta-online-booking/';
  if (!url.pathname.startsWith(prefix)) { response.writeHead(404); response.end(); return; }
  const relative = decodeURIComponent(url.pathname.slice(prefix.length));
  if (!relative || relative.includes('..') || relative.includes('\\')) { response.writeHead(400); response.end(); return; }
  const file = resolve(root, relative);
  if (!file.startsWith(root)) { response.writeHead(403); response.end(); return; }
  try {
    response.writeHead(200, { 'content-type':mime[extname(file)] || 'application/octet-stream', 'cache-control':'no-store' });
    response.end(readFileSync(file));
  } catch {
    response.writeHead(404); response.end();
  }
});
await new Promise((resolveListen, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolveListen);
});
const address = server.address();
const base = `http://127.0.0.1:${address.port}/minuta-online-booking/`;
const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
const context = await browser.newContext();
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(error.message));

try {
  await page.goto(`${base}pwa-v151-test.html`, { waitUntil:'load' });
  await page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.ready;
    return registration.active?.state === 'activated' && Boolean(navigator.serviceWorker.controller);
  }, null, { timeout:30000 });
  const state = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const cacheNames = await caches.keys();
    const cache = await caches.open('massage-izhevsk-v736');
    const provider = await cache.match('./provider.html');
    const commerce = await cache.match('./commerce-management.js?v=736');
    const styles = await cache.match('./styles.css?v=736');
    return {
      scriptUrl:registration.active?.scriptURL || '', cacheNames,
      provider:Boolean(provider), commerce:Boolean(commerce), styles:Boolean(styles)
    };
  });
  assert.match(state.scriptUrl, /\/sw\.js\?v=736$/);
  assert.ok(state.cacheNames.includes('massage-izhevsk-v736'), 'v736 cache is installed');
  assert.ok(!state.cacheNames.includes('massage-izhevsk-v734'), 'obsolete provider cache is removed on activation');
  assert.equal(state.provider, true, 'provider shell is cached');
  assert.equal(state.commerce, true, 'v736 commerce controller is cached');
  assert.equal(state.styles, true, 'v736 UI styles are cached');

  await context.setOffline(true);
  const response = await page.goto(`${base}provider.html`, { waitUntil:'domcontentloaded', timeout:15000 });
  assert.ok(response?.ok(), 'provider shell opens while offline');
  assert.equal(await page.locator('#commercePanel').count(), 1, 'offline shell contains the sales panel');
  const cachedSource = await page.evaluate(async () => (await fetch('./commerce-management.js?v=736')).text());
  assert.match(cachedSource, /sell_minuta_commercial_product_v151/);
} finally {
  await context.setOffline(false).catch(() => {});
  await context.close();
  await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
}

assert.deepEqual(pageErrors, []);
console.log('PrimeTime Pro commercial sales v151 PWA v736 and offline cache checks passed');
