import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'provider.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const source = readFileSync(resolve(root, 'provider.js'), 'utf8');
assert.match(source, /provider_service_schedule_names/);
assert.match(source, /serviceScheduleName\(fullTitle, item\.service_id\)/);
assert.match(source, /timelineServiceNameMarkup\(item\.services\?\.name \|\| 'Услуга', item\.service_id\)/);
const featureFunctions = source.slice(source.indexOf('function normalizeServiceScheduleNames'), source.indexOf('function normalizeMobileNavigation'));

const imported = await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href
  : 'playwright');
const { chromium } = imported.chromium ? imported : imported.default;
const browser = await chromium.launch({ headless:true, channel:process.env.BROWSER_CHANNEL || 'chrome' });

try {
  for (const width of [390, 760, 1440]) {
    const context = await browser.newContext({ viewport:{ width, height:900 }, bypassCSP:true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'https://provider.fixture.invalid' || route.request().method() !== 'GET') return route.abort();
      if (url.pathname === '/provider.html') return route.fulfill({ contentType:'text/html', body:html });
      const filename = resolve(root, `.${decodeURIComponent(url.pathname)}`);
      if (!filename.startsWith(`${root}${sep}`)) return route.abort();
      try {
        return route.fulfill({
          body:readFileSync(filename),
          contentType:filename.endsWith('.css') ? 'text/css' : filename.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream'
        });
      } catch {
        return route.abort();
      }
    });
    await page.goto('https://provider.fixture.invalid/provider.html');
    await page.evaluate(() => {
      document.documentElement.classList.remove('provider-booting');
      document.documentElement.classList.add('provider-ready', 'top-level');
      document.body.dataset.providerTheme = 'warm';
      document.body.dataset.providerLayout = 'soft';
      document.querySelector('#providerBoot').hidden = true;
      const updateNotice = document.querySelector('#siteUpdateNotice');
      if (updateNotice) updateNotice.hidden = true;
      const dialog = document.querySelector('#serviceCreatorDialog');
      document.body.replaceChildren(dialog);
      dialog.querySelector('#serviceName').value = 'Массаж спины + ШВЗ — углублённый (с акцентом на проблемные зоны)';
      dialog.showModal();
    });
    await page.addScriptTag({ content:`const $=selector=>document.querySelector(selector);const serviceName=value=>value;let serviceScheduleNames={};${featureFunctions};bindServiceScheduleNameSetting({prefix:'create',nameSelector:'#serviceName'});` });
    assert.equal(await page.locator('[data-service-schedule-name-recommended]').isVisible(), true, `${width}: recommendation not shown`);
    await page.locator('#createServiceScheduleNameEnabled').click();
    assert.equal(await page.locator('#createServiceScheduleName').inputValue(), 'Спина + ШВЗ · углублённый');
    assert.equal(await page.locator('[data-service-schedule-name-preview]').innerText(), 'Спина + ШВЗ · углублённый');
    assert.deepEqual(await page.evaluate(() => {
      serviceScheduleNames.demo = 'Спина + ШВЗ · углублённый';
      return [serviceScheduleName('Полное название услуги', 'demo'), serviceScheduleName('Полное название услуги', '')];
    }), ['Спина + ШВЗ · углублённый', 'Полное название услуги']);
    const geometry = await page.evaluate(() => {
      const dialog = document.querySelector('#serviceCreatorDialog').getBoundingClientRect();
      const toggle = document.querySelector('.service-schedule-name-toggle').getBoundingClientRect();
      const field = document.querySelector('#createServiceScheduleName').getBoundingClientRect();
      const preview = document.querySelector('.service-schedule-name-preview').getBoundingClientRect();
      return {
        overflow:document.documentElement.scrollWidth > innerWidth + 1,
        dialog:{ left:dialog.left, right:dialog.right, width:dialog.width },
        toggleHeight:toggle.height,
        field:{ left:field.left, right:field.right, height:field.height },
        preview:{ left:preview.left, right:preview.right, height:preview.height },
        recommendedVisible:!document.querySelector('[data-service-schedule-name-recommended]').hidden,
        detailsVisible:!document.querySelector('[data-service-schedule-name-details]').hidden
      };
    });
    assert.equal(geometry.overflow, false, `${width}: horizontal overflow`);
    assert.ok(geometry.dialog.left >= -1 && geometry.dialog.right <= width + 1, `${width}: dialog outside viewport`);
    assert.ok(geometry.toggleHeight >= 44, `${width}: toggle target too short`);
    assert.ok(geometry.field.left >= geometry.dialog.left && geometry.field.right <= geometry.dialog.right + 1, `${width}: field outside dialog`);
    assert.ok(geometry.preview.left >= geometry.dialog.left && geometry.preview.right <= geometry.dialog.right + 1, `${width}: preview outside dialog`);
    assert.ok(geometry.field.height >= 44 && geometry.preview.height >= 44, `${width}: controls too short`);
    assert.equal(geometry.recommendedVisible, true);
    assert.equal(geometry.detailsVisible, true);
    assert.deepEqual(errors, []);
    if (process.env.MINUTA_AUDIT_SCREENSHOTS) {
      mkdirSync(process.env.MINUTA_AUDIT_SCREENSHOTS, { recursive:true });
      await page.screenshot({ path:resolve(process.env.MINUTA_AUDIT_SCREENSHOTS, `service-short-name-${width}.png`), fullPage:true });
    }
    await context.close();
  }
  console.log('service schedule name browser test: ok (390/760/1440)');
} finally {
  await browser.close();
}
