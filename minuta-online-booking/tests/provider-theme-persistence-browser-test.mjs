import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const providerSource = readFileSync(path.join(root, 'provider.js'), 'utf8');
const scheduleCss = readFileSync(path.join(root, 'provider-schedule-minimal.css'), 'utf8');
const workerSource = readFileSync(path.join(root, 'sw.js'), 'utf8');

assert.match(scheduleCss, /--schedule-active-color\s*:\s*var\(--theme-accent\)/i, 'schedule must inherit the active theme accent');
assert.match(scheduleCss, /background:var\(--schedule-active-color\)!important/, 'active mobile schedule controls must use the theme accent directly');
assert.doesNotMatch(workerSource, /localStorage|indexedDB\.(?:deleteDatabase|open)/, 'a PWA update must not rewrite persisted display preferences');

const seam = `
window.__providerThemePersistenceTest={
  set(userId,theme){
    currentUser={id:userId,user_metadata:{}};
    const selected=window.MinutaThemeCatalog.theme(theme);
    displayPreferences=normalizeDisplayPreferences({...DEFAULT_DISPLAY_PREFERENCES,theme:selected.key,color_mode:selected.palette.dark?'dark':'light'});
    displayPreferencesUpdatedAt=Math.max(Date.now(),displayPreferencesUpdatedAt+1);
    displayPreferencesPending=true;
    persistLocalDisplayPreferences(userId);
    applyDisplayPreferences();
    return this.snapshot();
  },
  restore(userId,remote={}){
    currentUser={id:userId,user_metadata:{provider_display_preferences:remote}};
    restoreDisplayPreferences(currentUser);
    applyDisplayPreferences();
    return this.snapshot();
  },
  clearMemory(){
    displayPreferences={...DEFAULT_DISPLAY_PREFERENCES};
    displayPreferencesUpdatedAt=0;
    displayPreferencesPending=false;
  },
  snapshot(){
    const active=document.querySelector('.journal-mode-toggle button.active');
    const probe=document.createElement('i');
    probe.style.color='var(--theme-accent)';
    document.body.append(probe);
    const accent=getComputedStyle(probe).color;
    probe.style.color='var(--schedule-active-color)';
    const scheduleAccent=getComputedStyle(probe).color;
    probe.remove();
    const activeStyle=active?getComputedStyle(active):null;
    return {theme:displayPreferences.theme,bodyTheme:document.body.dataset.providerTheme,mode:displayPreferences.color_mode,accent,scheduleAccent,active:activeStyle?.backgroundColor||null,activeImage:activeStyle?.backgroundImage||null,pending:displayPreferencesPending};
  },
  themes:[...PROVIDER_THEME_KEYS]
};`;

const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp', '.woff2':'font/woff2' };
const server = createServer((request, response) => {
  const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const file = path.resolve(root, `.${name}`);
  if (!file.startsWith(`${root}${path.sep}`) || request.method !== 'GET') { response.writeHead(400).end(); return; }
  try {
    let bytes = readFileSync(file);
    if (name === '/provider.js') bytes = Buffer.from(bytes.toString() + seam);
    response.writeHead(200, { 'content-type':mime[path.extname(file)] || 'application/octet-stream' }).end(bytes);
  } catch { response.writeHead(404).end(); }
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const modulePath = process.env.MINUTA_PLAYWRIGHT_MODULE;
const playwright = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const { chromium } = playwright.default || playwright;
const browser = await chromium.launch({ headless:true, channel:process.env.BROWSER_CHANNEL || 'chrome' });

try {
  const context = await browser.newContext({ viewport:{ width:390, height:844 }, serviceWorkers:'block' });
  await context.addInitScript(() => {
    try { Object.defineProperty(navigator, 'standalone', { configurable:true, value:true }); } catch {}
  });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin && route.request().method() === 'GET' ? route.continue() : route.abort());
  const page = await context.newPage();
  await page.goto(`${origin}/provider.html?installed=1`, { waitUntil:'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__providerThemePersistenceTest));
  const userId = 'provider-theme-persistence-fixture';

  const themes = await page.evaluate(() => window.__providerThemePersistenceTest.themes);
  for (const theme of themes) {
    const restored = await page.evaluate(({ userId, theme }) => {
      window.__providerThemePersistenceTest.set(userId, theme);
      window.__providerThemePersistenceTest.clearMemory();
      return window.__providerThemePersistenceTest.restore(userId);
    }, { userId, theme });
    assert.equal(restored.theme, theme, `${theme}: saved theme was replaced during restore`);
    assert.equal(restored.bodyTheme, theme, `${theme}: saved theme was not applied to the document`);
  }

  await page.evaluate(({ userId }) => window.__providerThemePersistenceTest.set(userId, 'warm'), { userId });
  await page.reload({ waitUntil:'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__providerThemePersistenceTest));
  let snapshot = await page.evaluate(({ userId }) => window.__providerThemePersistenceTest.restore(userId), { userId });
  assert.equal(snapshot.theme, 'warm', 'Warm Beige did not survive a versioned PWA reload');

  for (const width of [390, 760]) {
    await page.setViewportSize({ width, height:900 });
    for (const theme of ['warm', 'sage', 'graphite']) {
      await page.evaluate(({ userId, theme }) => window.__providerThemePersistenceTest.set(userId, theme), { userId, theme });
      await page.waitForTimeout(220);
      snapshot = await page.evaluate(() => window.__providerThemePersistenceTest.snapshot());
      assert.equal(snapshot.active, snapshot.scheduleAccent, `${width}px/${theme}: active schedule control lost the approved brand green`);
      assert.equal(snapshot.activeImage, 'none', `${width}px/${theme}: active schedule control gained a gradient`);
    }
  }

  await page.evaluate(({ userId }) => window.__providerThemePersistenceTest.set(userId, 'sage'), { userId });
  await page.reload({ waitUntil:'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__providerThemePersistenceTest));
  snapshot = await page.evaluate(({ userId }) => window.__providerThemePersistenceTest.restore(userId), { userId });
  assert.equal(snapshot.theme, 'sage', 'returning from Warm Beige to Sage did not survive reload');
  assert.equal(snapshot.active, snapshot.scheduleAccent, 'schedule brand green did not survive returning from another theme');

  await context.close();
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}

console.log('Provider theme persistence: PASS for every theme, PWA reload, 390/760 and light/dark references');
