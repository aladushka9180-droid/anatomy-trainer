import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const source = readFileSync(path.join(root, 'provider.js'), 'utf8');
const html = readFileSync(path.join(root, 'provider.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
function actual(name) {
  const start = source.search(new RegExp(`^function ${name}\\(`, 'm'));
  assert.ok(start >= 0, name);
  const next = source.slice(start + 1).search(/^function /m);
  return source.slice(start, next < 0 ? undefined : start + next + 1);
}
const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless:true, channel:process.env.BROWSER_CHANNEL || 'chrome' });
try {
  for (const theme of ['pink-porcelain', 'sage']) {
  for (const width of [390, 760, 1440]) {
    const page = await browser.newPage({ viewport:{ width, height:844 }, bypassCSP:true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'provider.fixture.invalid') return route.abort();
      if (url.pathname === '/provider.html') return route.fulfill({ contentType:'text/html', body:html });
      const filename = path.resolve(root, '.' + decodeURIComponent(url.pathname));
      if (!filename.startsWith(root + path.sep)) return route.abort();
      try { return route.fulfill({ body:readFileSync(filename), contentType:filename.endsWith('.css') ? 'text/css' : filename.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream' }); }
      catch { return route.abort(); }
    });
    await page.goto('https://provider.fixture.invalid/provider.html', { waitUntil:'domcontentloaded' });
    await page.addScriptTag({ content:`
      window.$ = selector => document.querySelector(selector);
      window.$$ = selector => [...document.querySelectorAll(selector)];
      let ownServices = [
        { id:'service-1', name:'Массаж спины', duration_minutes:40, price_rub:2500, active:true },
        { id:'service-2', name:'Спортивный массаж', duration_minutes:60, price_rub:3000, active:true },
        { id:'service-3', name:'Скрытая услуга', duration_minutes:30, price_rub:1000, active:false }
      ];
      let newBookingMode = 'client', newBookingRepeatVisit = null;
      const escapeHtml = value => String(value).replace(/[&<>"']/g, symbol => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[symbol]));
      const money = value => new Intl.NumberFormat('ru-RU').format(value) + ' ₽';
      ${['updateNewBookingServiceOpen','openNewBookingServiceDialog','selectNewBookingService'].map(actual).join('\n')}
      document.documentElement.classList.remove('provider-booting', 'requires-top-level');
      document.body.dataset.providerTheme = '${theme}';
      document.body.classList.add('booking-sheet-open');
      document.querySelector('#providerBoot').hidden = true;
      document.querySelector('#bookingSheet').hidden = false;
      document.querySelector('#bookingSheet').classList.add('new-booking-sheet');
      document.querySelector('#bookingSheetContent').innerHTML = '<form class="new-booking-form"><label class="new-booking-service-field">Услуга<select id="newBookingService" required><option value="service-1">Массаж спины</option><option value="service-2">Спортивный массаж</option></select></label><button id="newBookingServiceOpen" class="new-booking-service-open" type="button" aria-haspopup="dialog" aria-controls="newBookingServiceDialog"><span><small>Услуга</small><strong id="newBookingServiceOpenName">Массаж спины</strong></span><span aria-hidden="true">⌄</span></button></form>';
      updateNewBookingServiceOpen();
      window.__selectedChanges = 0;
      $('#newBookingService').addEventListener('change', () => window.__selectedChanges++);
      $('#newBookingServiceOpen').addEventListener('click', openNewBookingServiceDialog);
      $('#newBookingServiceDialog').addEventListener('close', () => $('#newBookingServiceOpen').focus());
      $('#newBookingServiceSearch').addEventListener('input', event => {
        const query = event.target.value.trim().toLocaleLowerCase('ru-RU');
        $$('#newBookingServiceList [data-pick-new-booking-service]').forEach(button => { button.hidden = !button.textContent.toLocaleLowerCase('ru-RU').includes(query); });
      });
      $('#newBookingServiceList').addEventListener('click', event => {
        const picked = event.target.closest('[data-pick-new-booking-service]');
        if (picked) selectNewBookingService(picked.dataset.pickNewBookingService);
      });
    ` });
    if (width <= 760) {
      assert.equal((await page.locator('.new-booking-service-field').boundingBox()).width <= 1, true);
      assert.equal(await page.locator('#newBookingServiceOpen').isVisible(), true, JSON.stringify(await page.locator('#newBookingServiceOpen').evaluate(button => ({ hidden:button.hidden, display:getComputedStyle(button).display, parent:button.parentElement?.outerHTML.slice(0, 400), sheet:document.querySelector('#bookingSheet').hidden, theme:document.body.dataset.providerTheme }))));
    }
    await page.locator('#newBookingServiceOpen').evaluate(button => button.click());
    assert.equal(await page.locator('#newBookingServiceDialog').isVisible(), true);
    assert.equal(await page.locator('#newBookingServiceList button').count(), 2);
    assert.equal(await page.locator('#newBookingServiceList button[aria-checked="true"]').count(), 1);
    if (process.env.MINUTA_REFERENCE_SCREENSHOTS) {
      mkdirSync(process.env.MINUTA_REFERENCE_SCREENSHOTS, { recursive:true });
      await page.screenshot({ path:path.join(process.env.MINUTA_REFERENCE_SCREENSHOTS, `service-picker-${theme}-${width}.png`), fullPage:true });
    }
    await page.locator('#newBookingServiceSearch').fill('СПОРТИВНЫЙ');
    assert.equal(await page.locator('#newBookingServiceList button:visible').count(), 1);
    await page.locator('#newBookingServiceList button:visible').click();
    assert.equal(await page.locator('#newBookingService').inputValue(), 'service-2');
    assert.equal(await page.locator('#newBookingServiceOpenName').innerText(), 'Спортивный массаж');
    assert.equal(await page.evaluate(() => window.__selectedChanges), 1);
    assert.equal(await page.locator('#newBookingServiceDialog').isVisible(), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    assert.deepEqual(errors, []);
    await page.close();
  }
  }
  console.log('Service picker: pink-porcelain and sage at 390, 760, 1440 passed');
} finally { await browser.close(); }
