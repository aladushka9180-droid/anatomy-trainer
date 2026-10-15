import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const providerSource = readFileSync(path.join(root, 'provider.js'), 'utf8');
assert.doesNotMatch(providerSource, /document\.startViewTransition/, 'provider navigation must not create a blocking browser top layer');
assert.match(providerSource, /function canUseIosTransitions\(\) \{ return false; \}/, 'full-view navigation animation must stay disabled');
const guidanceSource = providerSource.slice(providerSource.indexOf('function loadProviderGuidance('), providerSource.indexOf('function loadVoiceAssistant('));
assert.doesNotMatch(guidanceSource, /settings-nav-scroll\.js/, 'ordinary section clicks must not mount the expensive settings picker');

const seam = `\nwindow.__providerNavigationTest={show(){finishProviderBoot();document.querySelector('#authCard').hidden=true;document.querySelector('#dashboard').hidden=false;}};`;
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
const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless:true, channel:process.env.BROWSER_CHANNEL || 'chrome' });

try {
  for (const width of [390, 760, 1440]) {
    const context = await browser.newContext({ viewport:{ width, height:900 }, serviceWorkers:'block' });
    await context.route('**/*', route => new URL(route.request().url()).origin === origin && route.request().method() === 'GET' ? route.continue() : route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/provider.html`, { waitUntil:'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.__providerNavigationTest));
    await page.waitForTimeout(800);
    await page.evaluate(() => window.__providerNavigationTest.show());

    const selector = view => width <= 760
      ? `.provider-mobile-nav [data-provider-view="${view}"]`
      : `.provider-sidebar .provider-nav [data-provider-view="${view}"]`;
    const clickView = async view => {
      const button = page.locator(selector(view)).first();
      await button.click({ timeout:5000 });
      await page.waitForTimeout(80);
      const state = await page.evaluate(({ view, selector }) => {
        const panel = document.querySelector(`[data-provider-panel="${view}"]`);
        const button = document.querySelector(selector);
        const rect = button.getBoundingClientRect();
        const hit = document.elementsFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)[0];
        return {
          active:document.querySelector('#dashboard').dataset.activeView,
          visible:!panel.hidden && panel.classList.contains('active'),
          receivesPointer:Boolean(hit && button.contains(hit)),
          blockingLayer:document.documentElement.classList.contains('ios-view-transition'),
          openDialogs:document.querySelectorAll('dialog[open]').length
        };
      }, { view, selector:selector(view) });
      assert.equal(state.active, view);
      assert.equal(state.visible, true);
      assert.equal(state.receivesPointer, true);
      assert.equal(state.blockingLayer, false);
      assert.equal(state.openDialogs, 0);
    };

    for (let cycle = 0; cycle < 2; cycle += 1) {
      await clickView('clients');
      await page.mouse.wheel(0, 900);
      await clickView('messages');
      await page.mouse.wheel(0, 700);
      await clickView('notifications');
      await page.locator('[data-open-notification-templates]').click({ timeout:5000 });
      await page.locator('#notificationTemplatesDialog[open]').waitFor({ state:'visible' });
      await page.locator('[data-close-notification-templates]').click({ timeout:5000 });
      await page.locator('#notificationTemplatesDialog').waitFor({ state:'hidden' });
      await clickView('bookings');
    }
    assert.deepEqual(errors, []);
    console.log(`Provider navigation resilience: PASS at ${width}px`);
    await context.close();
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
