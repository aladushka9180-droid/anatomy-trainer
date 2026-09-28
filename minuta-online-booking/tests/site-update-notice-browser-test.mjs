import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Only loopback, inert HTML and synthetic data. Exercise the real updater and worker lifecycle.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baseline = process.env.MINUTA_BASELINE_REF || process.argv[2];
assert.ok(baseline, 'Pin the preceding published release');
function release(read) {
  const worker = read('sw.js');
  const version = worker.match(/const CACHE = `\$\{CACHE_PREFIX\}v(\d+)`;/)?.[1];
  assert.ok(version);
  return { version, worker, updater:read('site-update.js') };
}
const oldRelease = release(file => execFileSync('git', ['show', `${baseline}:minuta-online-booking/${file}`], { cwd:root, encoding:'utf8' }));
const newRelease = release(file => readFileSync(resolve(root, file), 'utf8'));
assert.notEqual(oldRelease.version, newRelease.version);
let phase = oldRelease;
let offline = false;
const server = createServer((request, response) => {
  if (offline) { request.socket.destroy(); return; }
  const path = new URL(request.url, 'http://localhost').pathname;
  const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><body data-release="${phase.version}"><h1>Isolated update fixture</h1><script src="./site-update.js?v=${phase.version}"></script></body></html>`;
  const body = path.endsWith('/sw.js') ? phase.worker : path.endsWith('/site-update.js') ? phase.updater : path.endsWith('.html') || path.endsWith('/') ? html : path.endsWith('.svg') ? '<svg xmlns="http://www.w3.org/2000/svg"></svg>' : '';
  response.writeHead(200, { 'Content-Type':path.endsWith('.js') ? 'text/javascript' : path.endsWith('.svg') ? 'image/svg+xml' : 'text/html', 'Cache-Control':'no-store', 'Service-Worker-Allowed':'/', 'Content-Security-Policy':"default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'self'; object-src 'none'" }).end(body);
});
let browser;
let page;
const errors = [];
async function waitForReadyBuild(version) {
  await page.waitForFunction(async expected => {
    const controller = navigator.serviceWorker.controller;
    if (!controller) return false;
    const info = await new Promise(resolve => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); resolve(null); }, 1200);
      channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data); };
      controller.postMessage({type:"site-update-version"}, [channel.port2]);
    });
    return controller === navigator.serviceWorker.controller && info?.ready === true && info.version === Number(expected);
  }, version);
}
try {
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
  browser = await chromium.launch({headless:true, channel:process.env.BROWSER_CHANNEL || (process.platform === 'win32' ? 'chrome' : undefined)});
  const context = await browser.newContext({serviceWorkers:'allow'});
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(15000);
  await page.goto(`${origin}/provider.html`);
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  await page.reload();
  assert.equal(await page.locator('#siteUpdateNotice').count(), 0);
  await page.evaluate(() => localStorage.setItem('synthetic-offline-draft', 'preserved'));
  phase = newRelease;
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await page.locator('#siteUpdateNotice button').waitFor();
  await page.locator('#siteUpdateNotice button').click();
  await page.waitForFunction(version => document.body.dataset.release === version, newRelease.version);
  try {
    // Registration URLs can differ while the active worker contains the same release.
    // Prove the actual ready build instead of requiring a redundant URL replacement.
    await waitForReadyBuild(newRelease.version);
  } catch (error) {
    console.log(JSON.stringify({errors, state:await page.evaluate(async()=>({controller:navigator.serviceWorker.controller?.scriptURL,scripts:Array.from(document.scripts).map(s=>s.src),registrations:(await navigator.serviceWorker.getRegistrations()).map(r=>({active:r.active?.scriptURL,installing:r.installing?.scriptURL,waiting:r.waiting?.scriptURL}))}))}));
    throw error;
  }
  // Same build under a new registration URL used to trigger a second false notice.
  await page.waitForTimeout(1200);
  const repeated = await page.locator('#siteUpdateNotice').count();
  console.log(JSON.stringify({baseline:oldRelease.version,release:newRelease.version,loaded:await page.locator('body').getAttribute('data-release'),noticeAfterOneClick:repeated}));
  assert.equal(repeated, process.env.EXPECT_OLD_BUG === '1' ? 1 : 0, 'A single published release must require only one update click');
  assert.equal(await page.evaluate(() => localStorage.getItem('synthetic-offline-draft')), 'preserved');
  // A second, stale page can register the legacy URL while receiving the same new worker bytes.
  if (process.env.EXPECT_OLD_BUG !== '1') {
    const oldTab = await context.newPage();
    await oldTab.goto(`${origin}/provider.html`);
    await oldTab.evaluate(version => navigator.serviceWorker.register(`/sw.js?v=${version}`, {updateViaCache:'none'}), oldRelease.version);
    await page.waitForFunction(version => navigator.serviceWorker.controller?.scriptURL.endsWith(`sw.js?v=${version}`), oldRelease.version);
    await page.waitForTimeout(1200);
    assert.equal(await page.locator('#siteUpdateNotice').count(), 0, 'A stale tab must not create a false same-build notice');
    await oldTab.close();
    // Reproduce a stale navigation shell independently of worker activation.
    await page.evaluate(async version => {
      const cache = await caches.open(`massage-izhevsk-v${version}`);
      await cache.put('/provider.html', new Response('<html><body data-release="stale">Synthetic stale shell</body></html>', {headers:{'Content-Type':'text/html'}}));
    }, newRelease.version);
    await page.reload();
    assert.equal(await page.locator('body').getAttribute('data-release'), newRelease.version, 'Explicit reload must return fresh HTML immediately');
  }
  offline = true;
  await context.setOffline(true);
  await page.reload();
  assert.equal(await page.locator('body').getAttribute('data-release'), newRelease.version);
  assert.equal(await page.evaluate(() => localStorage.getItem('synthetic-offline-draft')), 'preserved');
  assert.deepEqual(errors, []);
  if (process.env.EXPECT_OLD_BUG !== '1') {
    offline = false;
    const future = String(Number(newRelease.version) + 1);
    const advance = source => source.replaceAll(`v=${newRelease.version}`, `v=${future}`).replaceAll(`v${newRelease.version}`, `v${future}`);
    phase = {version:future,worker:advance(newRelease.worker),updater:advance(newRelease.updater)};
    await context.setOffline(false);
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await waitForReadyBuild(future);
    await page.locator('#siteUpdateNotice button').waitFor();
    assert.equal(await page.locator('body').getAttribute('data-release'), newRelease.version);
    console.log('PASS: a genuinely newer release still offers an update');
  }
  console.log('PASS: one-release update lifecycle and offline draft preservation');
} catch (error) {
  if (page && !page.isClosed()) console.log(JSON.stringify({errors, failureState:await page.evaluate(async()=>({loaded:document.body.dataset.release,notice:Boolean(document.querySelector('#siteUpdateNotice')),online:navigator.onLine,controller:navigator.serviceWorker.controller?.scriptURL,caches:await caches.keys(),registrations:(await navigator.serviceWorker.getRegistrations()).map(r=>({active:r.active?.scriptURL,activeState:r.active?.state,installing:r.installing?.scriptURL,waiting:r.waiting?.scriptURL}))}))}));
  throw error;
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
