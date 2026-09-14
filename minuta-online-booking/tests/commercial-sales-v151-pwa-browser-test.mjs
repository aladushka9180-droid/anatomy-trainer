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
  await navigator.serviceWorker.register('./stale-worker.js');
  await navigator.serviceWorker.ready;
  if(!navigator.serviceWorker.controller) await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
  const staleCache=await caches.open('massage-izhevsk-stale');
  const staleResponse=await staleCache.match('./provider.html');
  const staleShell=staleResponse ? await staleResponse.text() : '';
  if(!staleShell.includes('data-stale-provider-shell="yes"')) throw new Error('stale shell fixture was not cached');
  const script=document.createElement('script');
script.src='./site-update.js?v=782';
  script.onload=()=>window.dispatchEvent(new Event('load'));
  document.head.append(script);
},{once:true});
</script></body></html>`;

let providerRequests = 0;
const server = createServer((request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  if (url.pathname === '/minuta-online-booking/pwa-v151-test.html') {
    response.writeHead(200, { 'content-type':'text/html; charset=utf-8', 'cache-control':'no-store' });
    response.end(probe);
    return;
  }
  if (url.pathname === '/minuta-online-booking/stale-worker.js') {
    response.writeHead(200, { 'content-type':'application/javascript; charset=utf-8', 'cache-control':'no-store' });
    response.end(`self.addEventListener('install',event=>event.waitUntil((async()=>{
      const cache=await caches.open('massage-izhevsk-stale');
      await cache.add('./provider.html');
      await self.skipWaiting();
    })()));
    self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));`);
    return;
  }
  const prefix = '/minuta-online-booking/';
  if (!url.pathname.startsWith(prefix)) { response.writeHead(404); response.end(); return; }
  const relative = decodeURIComponent(url.pathname.slice(prefix.length));
  if (!relative || relative.includes('..') || relative.includes('\\')) { response.writeHead(400); response.end(); return; }
  const file = resolve(root, relative);
  if (!file.startsWith(root)) { response.writeHead(403); response.end(); return; }
  try {
    if (relative === 'provider.html') {
      providerRequests++;
      response.writeHead(200, { 'content-type':'text/html; charset=utf-8', 'cache-control':'public, max-age=3600' });
      response.end(providerRequests === 1
        ? '<!doctype html><html data-stale-provider-shell="yes"><body>stale provider shell</body></html>'
        : readFileSync(file));
      return;
    }
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
  await page.waitForFunction(() => navigator.serviceWorker.controller?.scriptURL.endsWith('/sw.js?v=782'), null, { timeout:30000 });
  for (let attempt = 0; attempt < 50; attempt++) {
    const oldCachePresent = await page.evaluate(async () => (await caches.keys()).includes('massage-izhevsk-stale'));
    if (!oldCachePresent) break;
    await new Promise(resolveWait => setTimeout(resolveWait, 20));
  }
  const state = await page.evaluate(async () => {
    const cacheNames = await caches.keys();
    const cache = await caches.open('massage-izhevsk-v782');
    const provider = await cache.match('./provider.html');
    const commerce = await cache.match('./commerce-management.js?v=782');
    const styles = await cache.match('./styles.css?v=782');
    return {
      scriptUrl:navigator.serviceWorker.controller?.scriptURL || '', cacheNames,
      provider:Boolean(provider), providerSource:provider ? await provider.text() : '',
      commerce:Boolean(commerce), styles:Boolean(styles)
    };
  });
  assert.match(state.scriptUrl, /\/sw\.js\?v=782$/);
  assert.ok(state.cacheNames.includes('massage-izhevsk-v782'), 'v782 cache is installed');
  assert.ok(!state.cacheNames.includes('massage-izhevsk-stale'), 'obsolete provider cache is removed on activation');
  assert.equal(state.provider, true, 'provider shell is cached');
  assert.ok(providerRequests >= 2, 'service worker install bypasses the stale HTTP cache');
  assert.match(state.providerSource, /styles\.css\?v=782/, 'fresh provider shell is stored in Cache Storage');
  assert.doesNotMatch(state.providerSource, /data-stale-provider-shell/, 'stale provider shell never reaches Cache Storage');
  assert.equal(state.commerce, true, 'v782 commerce controller is cached');
  assert.equal(state.styles, true, 'v782 UI styles are cached');

  await context.setOffline(true);
  const response = await page.goto(`${base}provider.html`, { waitUntil:'domcontentloaded', timeout:15000 });
  assert.ok(response?.ok(), 'provider shell opens while offline');
  assert.equal(await page.locator('#commercePanel').count(), 1, 'offline shell contains the sales panel');
  const cachedSource = await page.evaluate(async () => (await fetch('./commerce-management.js?v=782')).text());
  assert.match(cachedSource, /sell_minuta_commercial_product_v151/);
  assert.match(cachedSource, /issue_client_identity_sale_claim_v155/);
  assert.match(cachedSource, /\^PTS1-\[0-9A-F\]\{4\}/);
  assert.doesNotMatch(cachedSource, /\^\[0-9a-f\]\{64\}\$/i);
} finally {
  await context.setOffline(false).catch(() => {});
  await context.close();
  await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
}

assert.deepEqual(pageErrors, []);
console.log('PrimeTime Pro commercial sales v151 PWA v782 and offline cache checks passed');
