import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Isolated real service-worker update test, not installed-application or production E2E.
// MINUTA_BASELINE_REF (or first CLI argument) must identify the exact old release.
const baselineInput = process.env.MINUTA_BASELINE_REF || process.argv[2];
assert.ok(baselineInput, 'Specify a pinned baseline through MINUTA_BASELINE_REF or the first argument');
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(appRoot, '..');
const baseline = execFileSync('git', ['rev-parse', '--verify', `${baselineInput}^{commit}`],
  { cwd:repoRoot, encoding:'utf8' }).trim();
const oldFile = path => execFileSync('git', ['show', `${baseline}:minuta-online-booking/${path}`],
  { cwd:repoRoot, maxBuffer:32 * 1024 * 1024 });
const newFile = path => readFileSync(resolve(appRoot, path));
const prefix = '/minuta-online-booking/';
const cachePrefix = 'massage-izhevsk-';
const executableModules = ['group-bookings.js', 'benefit-management.js', 'retention-management.js'];
// Verify full application bytes without running authenticated/bootstrap code in the inert shell.
const modules = [...executableModules, 'app.js', 'free-slots-share.js', 'provider.js', 'payment-management.js',
  'payroll-management.js', 'inventory-management.js', 'loyalty-management.js'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

function snapshot(read, requiredModules = modules) {
  const worker = read('sw.js');
  const source = worker.toString('utf8');
  const version = source.match(/const CACHE = `\$\{CACHE_PREFIX\}v(\d+)`;/)?.[1];
  assert.ok(version, 'Cannot identify the real worker cache version');
  const assetBlock = source.match(/const ASSETS = \[([\s\S]*?)\];/)?.[1];
  assert.ok(assetBlock, 'Cannot identify the real worker asset manifest');
  const assets = [...assetBlock.matchAll(/'([^']+)'/g)].map(match => match[1]);
  const files = new Map([['sw.js', worker]]);
  for (const asset of assets) {
    const relative = asset.split('?')[0].replace(/^\.\//, '') || 'index.html';
    assert.ok(!relative.split('/').includes('..') && !relative.includes('\\'), 'Unexpected manifest traversal');
    if (!files.has(relative)) files.set(relative, read(relative));
  }
  for (const module of [...modules, 'report-reconciliation.js']) if (!files.has(module)) files.set(module, read(module));
  for (const module of requiredModules) assert.ok(assets.includes(`./${module}?v=${version}`), `${module} missing from cache manifest`);
  return { version, files, assets, cache:`${cachePrefix}v${version}` };
}
const newModules = [...modules, 'report-reconciliation.js'];
const oldRelease = snapshot(oldFile, ['group-bookings.js', 'provider.js']);
const newCoreModules = ['group-bookings.js', 'provider.js', 'report-reconciliation.js'];
const offlineModules = [...new Set([...newCoreModules, ...executableModules])];
const newRelease = snapshot(newFile, newCoreModules);
assert.ok(newRelease.assets.includes(`./report-reconciliation.js?v=${newRelease.version}`), 'New report module must be cached');
assert.ok(!newRelease.assets.includes(`./benefit-management.js?v=${newRelease.version}`), 'Benefits must be cached on first use, not during install');
assert.ok(!newRelease.assets.includes(`./retention-management.js?v=${newRelease.version}`), 'Retention must be cached on first use, not during install');
assert.notEqual(newRelease.version, oldRelease.version, 'The candidate must have a new cache version');

function shell(version, route) {
  return `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Isolated PWA update</title>
    <body data-release="${version}" data-route="${route}"><h1>Isolated resource update</h1>
    ${[...executableModules, ...(version === newRelease.version ? ['report-reconciliation.js'] : [])].map(module => `<script src="./${module}?v=${version}"></script>`).join('\n')}</body></html>`;
}
const mime = { '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json',
  '.html':'text/html', '.png':'image/png', '.webp':'image/webp', '.jpg':'image/jpeg' };
let phase = oldRelease;
let failNewAsset = false;
let failedAssetRequests = 0;
const serverErrors = [];
const server = createServer((request, response) => {
  try {
    const rawPath = decodeURIComponent(String(request.url || '').split('?')[0]);
    if (!['GET', 'HEAD'].includes(request.method) || !rawPath.startsWith(prefix)
      || rawPath.includes('\\') || rawPath.includes('\0') || rawPath.split('/').includes('..')) {
      response.writeHead(400).end('Invalid request'); return;
    }
    const relative = rawPath.slice(prefix.length) || 'index.html';
    const absolute = resolve(appRoot, relative);
    if (!absolute.startsWith(appRoot + sep) || !phase.files.has(relative)) {
      response.writeHead(404).end('Not found'); return;
    }
    const url = new URL(request.url, 'http://localhost');
    if (failNewAsset && relative === 'group-bookings.js' && url.searchParams.get('v') === newRelease.version) {
      failedAssetRequests += 1;
      response.writeHead(503, { 'Cache-Control':'no-store' }).end('Simulated incomplete release'); return;
    }
    // Inert navigation shells prevent auth/bootstrap and user-data requests. Worker/assets remain real bytes.
    const content = relative.endsWith('.html') ? Buffer.from(shell(phase.version,relative)) : phase.files.get(relative);
    response.writeHead(200, { 'Content-Type':mime[extname(relative)] || 'application/octet-stream',
      'Cache-Control':'no-store', 'Service-Worker-Allowed':prefix,
      'Content-Security-Policy':"default-src 'self'; connect-src 'self'; script-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'" });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch (error) {
    serverErrors.push(error.message);
    response.writeHead(500).end('Fixture failure');
  }
});
let browser;
try {
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const modulePath = process.env.MINUTA_PLAYWRIGHT_MODULE;
  const { chromium, devices } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
  browser = await chromium.launch({ headless:true,
    ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
  const device = process.env.MINUTA_PWA_DEVICE ? devices[process.env.MINUTA_PWA_DEVICE] : {};
  assert.ok(device, 'Unknown Playwright device profile');
  const context = await browser.newContext({ ...device, serviceWorkers:'allow' });
  const externalRequests = [], pageErrors = [];
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin !== origin) {
      externalRequests.push(route.request().url()); return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => pageErrors.push(error.message));
  const target = `${origin}${prefix}provider.html`;
  await page.goto(target);
  await page.evaluate(async ({ prefix, version }) => {
    await navigator.serviceWorker.register(`${prefix}sw.js?v=${version}`, { scope:prefix, updateViaCache:'none' });
    await navigator.serviceWorker.ready;
  }, { prefix, version:oldRelease.version });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await page.reload();

  // Recent baselines already lazy-cache secondary sections. Model a user who
  // opened these sections before upgrading, rather than requiring every module
  // to block installation. Bytes still come through the real worker and are hashed.
  await page.evaluate(async ({prefix,version,modules}) => {
    for(const module of modules) {
      const response=await fetch(`${prefix}${module}?v=${version}`);
      if(!response.ok) throw new Error(`Baseline warmup failed: ${module}`);
      await response.arrayBuffer();
    }
  }, {prefix,version:oldRelease.version,modules});

  async function cacheHashes(release, requestedModules = release === newRelease ? newCoreModules : modules) {
    return page.evaluate(async ({ cacheName, prefix, version, modules }) => {
      const cache = await caches.open(cacheName);
      const result = {};
      for (const module of modules) {
        const response = await cache.match(`${prefix}${module}?v=${version}`);
        if (!response) throw new Error(`Missing cached module ${module}`);
        const bytes = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
        result[module] = [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
      }
      return result;
    }, { cacheName:release.cache, prefix, version:release.version, modules:requestedModules });
  }
  const expectedHashes = (release, requestedModules = release === newRelease ? newCoreModules : modules) =>
    Object.fromEntries(requestedModules.map(module => [module, sha(release.files.get(module))]));
  assert.deepEqual(await cacheHashes(oldRelease), expectedHashes(oldRelease));
  const originalController = await page.evaluate(() => navigator.serviceWorker.controller.scriptURL);
  console.log(`PASS: pinned baseline ${baseline} cache v${oldRelease.version} controls the isolated page`);

  phase = newRelease;
  failNewAsset = true;
  const failedState = await page.evaluate(async ({ prefix, version }) => {
    const registration = await navigator.serviceWorker.register(`${prefix}sw.js?v=${version}`, { scope:prefix, updateViaCache:'none' });
    const candidate = registration.installing;
    if (!candidate) return 'no-installing-worker';
    if (candidate.state === 'redundant' || candidate.state === 'activated') return candidate.state;
    return new Promise(resolve => candidate.addEventListener('statechange', () => {
      if (candidate.state === 'redundant' || candidate.state === 'activated') resolve(candidate.state);
    }));
  }, { prefix, version:newRelease.version });
  assert.equal(failedState, 'redundant', 'Incomplete precache must reject installation');
  assert.ok(failedAssetRequests > 0, 'The negative path must actually fail a required asset');
  assert.equal(await page.evaluate(() => navigator.serviceWorker.controller.scriptURL), originalController);
  assert.deepEqual(await cacheHashes(oldRelease), expectedHashes(oldRelease));
  // The old app remains usable offline while the replacement installation has failed.
  await context.setOffline(true);
  await page.reload();
  assert.equal(await page.locator('body').getAttribute('data-release'), oldRelease.version);
  await context.setOffline(false);
  console.log('PASS: failed new precache preserves the old worker, cache, and offline navigation');

  failNewAsset = false;
  await page.evaluate(async ({ prefix, version }) => {
    window.controllerChanges = 0;
    navigator.serviceWorker.addEventListener('controllerchange', () => { window.controllerChanges += 1; });
    await navigator.serviceWorker.register(`${prefix}sw.js?v=${version}`, { scope:prefix, updateViaCache:'none' });
  }, { prefix, version:newRelease.version });
  await page.waitForFunction(version => window.controllerChanges > 0
    && navigator.serviceWorker.controller?.scriptURL.endsWith(`sw.js?v=${version}`), newRelease.version);
  await page.waitForFunction(async ({ wanted, cachePrefix }) => {
    const keys = (await caches.keys()).filter(key => key.startsWith(cachePrefix));
    return keys.length === 1 && keys[0] === wanted;
  }, { wanted:newRelease.cache, cachePrefix });
  assert.deepEqual(await cacheHashes(newRelease), expectedHashes(newRelease));
  await page.reload();
  assert.equal(await page.locator('body').getAttribute('data-release'), newRelease.version);
  assert.equal(await page.evaluate(() => Boolean(window.MinutaGroupBookings && window.MinutaBenefits && window.MinutaRetention)), true);
  console.log(`PASS: v${newRelease.version} activates, removes old caches, and reloads the new module scripts`);

  await context.setOffline(true);
  const resourceResponses = [];
  page.on('response', response => {
    if (offlineModules.some(module => new URL(response.url()).pathname.endsWith(`/${module}`))) {
      resourceResponses.push({ url:response.url(), serviceWorker:response.fromServiceWorker() });
    }
  });
  await page.reload();
  const offlineHashes = await page.evaluate(async ({ prefix, version, modules }) => {
    const result = {};
    for (const module of modules) {
      const response = await fetch(`${prefix}${module}?v=${version}`);
      if (!response.ok) throw new Error(`Offline module HTTP ${response.status}`);
      const bytes = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
      result[module] = [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    }
    return result;
  }, { prefix, version:newRelease.version, modules:offlineModules });
  assert.deepEqual(offlineHashes, expectedHashes(newRelease, offlineModules));
  assert.equal(await page.locator('body').getAttribute('data-release'), newRelease.version);
  assert.equal(await page.evaluate(() => Boolean(window.MinutaGroupBookings && window.MinutaBenefits)), true);
  assert.equal(await page.evaluate(() => typeof window.MinutaReportReconciliation?.amounts), 'function');
  assert.deepEqual(await cacheHashes(newRelease, offlineModules), expectedHashes(newRelease, offlineModules));
  for (const module of offlineModules) assert.ok(resourceResponses.some(response =>
    response.url.endsWith(`/${module}?v=${newRelease.version}`) && response.serviceWorker), `${module} must be served by the real worker offline`);
  assert.deepEqual(externalRequests, []);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(serverErrors, []);
  console.log('PASS: offline new resources match checkout SHA-256 and are served by the actual service worker');
  console.log('Isolated real-SW resource update: 4/4 passed; installed-PWA and production E2E not exercised');
  if(process.env.MINUTA_PWA_AUDIT_COLD_ROUTES) {
    for(const route of ['my-bookings.html','booking.html','index.html']) {
      await page.goto(`${origin}${prefix}${route}`);
      console.log(`COLD_OFFLINE_DIAGNOSTIC requested=${route} served=${await page.locator('body').getAttribute('data-route')}`);
    }
  }
} finally {
  try { if (browser) await browser.close(); }
  finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
