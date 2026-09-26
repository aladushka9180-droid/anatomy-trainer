import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    if (pathname === '/provider.html') {
      let html = await readFile(path.join(root, 'provider.html'), 'utf8');
      html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '')
        .replace(/<script\b[\s\S]*?<\/script>/g, '')
        .replace('<section class="provider-app" id="dashboard" hidden>', '<section class="provider-app" id="dashboard">');
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(html);
      return;
    }
    const target = path.resolve(root, pathname.slice(1));
    if (!target.startsWith(`${root}${path.sep}`) || !['.css', '.js', '.svg', '.webp', '.png'].includes(path.extname(target))) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader('Content-Type', path.extname(target) === '.css' ? 'text/css' : 'application/octet-stream');
    response.end(await readFile(target));
  } catch (error) {
    response.writeHead(500).end(String(error));
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/provider.html`;

const playwright = await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href
  : 'playwright');
const chromium = playwright.chromium || playwright.default?.chromium;
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.evaluate(() => {
    document.body.dataset.providerTheme = 'sage';
    document.body.dataset.providerLayout = 'soft';
    document.documentElement.classList.remove('provider-booting', 'requires-top-level');
    document.querySelector('#dashboard').hidden = false;
    document.querySelector('#providerBoot').hidden = true;
    document.querySelector('[data-provider-panel="bookings"]').hidden = true;
    const settings = document.querySelector('[data-provider-panel="settings"]');
    settings.hidden = false;
    settings.classList.add('active');
    settings.style.display = 'block';
    document.querySelector('#clientAppearanceSettingsCard').style.display = 'grid';
    document.querySelector('#clientHeadlineOptions').innerHTML = Array.from({ length: 4 }, (_, index) =>
      `<label class="client-headline-option"><input type="radio" name="headline" ${index === 0 ? 'checked' : ''}><strong>Заголовок ${index + 1}</strong><small>Краткое описание</small></label>`).join('');
  });
  for (const width of [390, 760, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForFunction(expected => getComputedStyle(document.querySelector('#applyClientAppearance')).order === expected,
      width <= 760 ? '-1' : '4');
    if (width <= 760) {
      await page.waitForFunction(() => {
        const save = document.querySelector('#applyClientAppearance');
        return parseFloat(getComputedStyle(save).minHeight) >= 44 && save.getBoundingClientRect().height >= 44;
      });
    }
    const layout = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect();
      const selection = rect('#clientAppearanceSettingsCard .client-appearance-selection');
      const headline = rect('#clientAppearanceSettingsCard .client-headline-picker');
      const preview = rect('#clientAppearancePreview');
      const save = rect('#applyClientAppearance');
      return {
        scrollWidth: document.documentElement.scrollWidth,
        selectionBottom: selection.bottom,
        headlineTop: headline.top,
        headlineBottom: headline.bottom,
        previewTop: preview.top,
        previewBottom: preview.bottom,
        saveTop: save.top,
        saveHeight: save.height,
        saveMinHeight: getComputedStyle(document.querySelector('#applyClientAppearance')).minHeight,
        saveOrder: getComputedStyle(document.querySelector('#applyClientAppearance')).order,
        actionsDisplay: getComputedStyle(document.querySelector('.client-appearance-actions > div')).display,
      };
    });
    assert.ok(layout.scrollWidth <= width + 1, `${width}px horizontal overflow: ${JSON.stringify(layout)}`);
    if (width <= 760) {
      assert.ok(layout.headlineTop >= layout.selectionBottom - 1, `${width}px headline precedes theme selection`);
      assert.ok(layout.previewTop >= layout.headlineBottom - 1, `${width}px preview precedes headline choices`);
      assert.ok(layout.saveTop >= layout.previewBottom - 1 && layout.saveTop - layout.previewBottom < 100,
        `${width}px save is not near preview: ${JSON.stringify(layout)}`);
      assert.ok(parseFloat(layout.saveMinHeight) >= 44 && layout.saveHeight >= 44,
        `${width}px save target is smaller than 44 CSS px: ${JSON.stringify(layout)}`);
    } else {
      assert.ok(layout.previewTop < layout.headlineTop, 'Desktop preview should retain its original placement');
    }
    if (process.env.MINUTA_UI_OUTPUT) {
      await mkdir(process.env.MINUTA_UI_OUTPUT, { recursive: true });
      await page.locator('#clientAppearanceSettingsCard').screenshot({
        path: path.join(process.env.MINUTA_UI_OUTPUT, `client-page-save-${width}.png`),
      });
    }
  }
  const providerSource = await readFile(path.join(root, 'provider.js'), 'utf8');
  const quickStartFunction = providerSource.match(/function refreshSettingsQuickStart\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(quickStartFunction, 'First-run visibility must still be controlled by provider.js');
  await page.addScriptTag({ content: `window.ownServices=[];window.scheduleRows=[];window.$=selector=>document.querySelector(selector);${quickStartFunction}` });
  for (const width of [390, 760, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => refreshSettingsQuickStart());
    const guide = page.locator('#settingsQuickStart');
    assert.equal(await guide.isVisible(), true, `${width}px new cabinet needs its first-run guide`);
    await guide.locator('summary').click();
    assert.equal(await guide.locator('ol > li').count(), 5);
    assert.deepEqual(await guide.locator('button[data-provider-view]').evaluateAll(buttons => buttons.map(button => button.dataset.providerView)), ['services', 'schedule']);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${width}px first-run guide overflows`);
    if (process.env.MINUTA_UI_OUTPUT) {
      await guide.screenshot({ path: path.join(process.env.MINUTA_UI_OUTPUT, `client-page-first-run-${width}.png`) });
    }
    await guide.locator('summary').click();
  }
  await page.evaluate(() => { ownServices = [{ active:true }]; scheduleRows = [{ enabled:true }]; refreshSettingsQuickStart(); });
  assert.equal(await page.locator('#settingsQuickStart').isVisible(), false, 'Completed cabinet does not repeat first-run steps');
  await page.evaluate(() => { scheduleRows = []; refreshSettingsQuickStart(); });
  assert.equal(await page.locator('#settingsQuickStart').isVisible(), true, 'Incomplete schedule keeps first-run help available');
  assert.deepEqual(errors, []);
  console.log('Provider client appearance save proximity: 390/760/1440 PASS');
} finally {
  await browser?.close();
  server.close();
}
