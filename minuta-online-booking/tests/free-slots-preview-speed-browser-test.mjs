import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.MINUTA_PLAYWRIGHT_MODULE || process.env.PLAYWRIGHT_MODULE;
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const html = readFileSync(new URL('../provider.html', import.meta.url), 'utf8');
const source = readFileSync(new URL('../free-slots-share.js', import.meta.url), 'utf8');
const start = html.indexOf('<dialog class="free-slots-dialog"');
const dialog = html.slice(start, html.indexOf('</dialog>', start) + 9);
const browser = await chromium.launch({ headless:true });
const page = await browser.newPage();
const errors = [];
let networkAttempts = 0;
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => {
  const url = new URL(route.request().url());
  assert.equal(url.hostname, 'preview.test');
  networkAttempts += 1;
  if (url.pathname === '/free-slots-short-link.js') return route.fulfill({ contentType:'text/javascript', body:`
    const cache = new Map();
    export async function resolveShortBookingLink(sourceUrl) {
      if (cache.has(sourceUrl)) return cache.get(sourceUrl);
      window.shortLinkCalls += 1;
      await new Promise(resolve => setTimeout(resolve, 700));
      const url = 'https://preview.test/ABCDEFGHIJ';
      cache.set(sourceUrl, url);
      return url;
    }
  ` });
  return route.fulfill({ contentType:'text/html; charset=utf-8', body:`<button id="open" type="button">Открыть</button>${dialog}` });
});

try {
  await page.goto('https://preview.test/');
  await page.addScriptTag({ content:source });
  await page.evaluate(() => {
    window.contextCalls = 0; window.windowCalls = 0; window.shortLinkCalls = 0;
    window.copied = []; window.shared = []; window.user = 'master'; window.org = 'org-A'; window.session = 1;
    window.windows = [{ booking_date:'2026-10-01', start_time:'10:00', end_time:'12:00', duration_minutes:120 }];
    window.wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    Object.defineProperty(navigator, 'clipboard', { configurable:true, value:{ writeText:async text => copied.push(text) } });
    Object.defineProperty(navigator, 'share', { configurable:true, value:async data => shared.push(data.text) });
    window.controller = MinutaFreeSlots.createController({
      root:document.querySelector('#freeSlotsDialog'),
      getData:() => ({ userId:user, organizationId:org, sessionGeneration:session,
        today:'2026-09-30', now:window.testNow || '2026-09-30T08:00:00Z', selectedDate:'2026-10-01',
        bookingUrl:`https://preview.test/index.html?org=${org}` }),
      loadContext:async () => {
        contextCalls += 1; await wait(120);
        return { mode:'organization', organizationId:org, resourceScheduling:true,
          locations:[{ id:`loc-${org}`, name:'Филиал' }],
          services:[{ id:`service-${org}`, name:'Массаж', duration_minutes:60, location_ids:[`loc-${org}`] }] };
      },
      loadSlots:async () => { windowCalls += 1; await wait(450); return { data:[{ booking_date:'2026-10-01', booking_time:'10:00' }] }; },
      loadWindows:async () => { windowCalls += 1; await wait(450); return { data:windows }; },
      notify:() => {}
    });
    document.querySelector('#open').addEventListener('click', () => controller.open());
    window.measureOpen = async (expected = '10:00') => {
      const started = performance.now();
      const pending = controller.open();
      const until = async predicate => {
        while (!predicate()) await wait(2);
        return Math.round(performance.now() - started);
      };
      const firstMs = await until(() => document.querySelector('#freeSlotsText').value.includes(expected));
      const checking = document.querySelector('#freeSlotsShareStatus').textContent;
      const disabled = document.querySelector('#copyFreeSlots').disabled;
      const freshMs = await until(() => !document.querySelector('#copyFreeSlots').disabled);
      await pending;
      return { firstMs, freshMs, checking, disabled, contextCalls, windowCalls, shortLinkCalls };
    };
  });
  const cold = await page.evaluate(() => measureOpen());
  await page.locator('[data-close-free-slots]').first().click();
  const warm = await page.evaluate(() => measureOpen());
  console.log(JSON.stringify({ cold, warm, networkAttempts }, null, 2));
  assert.deepEqual(errors, []);
  if (process.env.MINUTA_PREVIEW_BASELINE) process.exitCode = 0;
  else {
    assert.ok(cold.firstMs < cold.freshMs + 50, 'cold preview does not wait for the short link');
    assert.ok(warm.firstMs < warm.freshMs - 250, 'same-scope preview appears before the fresh availability read');
    assert.match(warm.checking, /Проверяем актуальность/);
    assert.equal(warm.disabled, true, 'cached preview cannot be copied while checking');
    assert.equal(warm.windowCalls, 2, 'fresh availability is requested once per open');
    assert.equal(warm.shortLinkCalls, 1, 'same source does not issue a second short-link request');
    await page.evaluate(() => { windows = [{ booking_date:'2026-10-01', start_time:'11:00', end_time:'12:00', duration_minutes:60 }]; });
    await page.locator('#copyFreeSlots').click();
    await page.waitForFunction(() => !document.querySelector('#copyFreeSlots').disabled, null, { timeout:5000 });
    assert.deepEqual(await page.evaluate(() => copied), [], 'an old cached window never reaches the clipboard');
    assert.match(await page.locator('#freeSlotsText').inputValue(), /11:00–12:00/);
    await page.locator('#freeSlotsText').fill('Мой текст для клиента');
    const callsBeforeManualRefresh = await page.evaluate(() => windowCalls);
    await page.evaluate(() => controller.refresh());
    assert.equal(await page.locator('#freeSlotsText').inputValue(), 'Мой текст для клиента');
    assert.equal(await page.locator('#copyFreeSlots').isDisabled(), true);
    await page.waitForFunction(() => !document.querySelector('#copyFreeSlots').disabled, null, { timeout:5000 });
    assert.equal(await page.locator('#freeSlotsText').inputValue(), 'Мой текст для клиента');
    assert.equal(await page.evaluate(() => windowCalls), callsBeforeManualRefresh + 1, 'manual edit refresh performs one read');
    await page.locator('[data-close-free-slots]').first().click();
    await page.evaluate(() => { void controller.open(); });
    assert.equal(await page.locator('#freeSlotsText').inputValue(), 'Мой текст для клиента', 'manual edit survives a same-scope reopen');
    assert.equal(await page.locator('#copyFreeSlots').isDisabled(), true);
    await page.waitForFunction(() => !document.querySelector('#copyFreeSlots').disabled);
    await page.locator('[data-close-free-slots]').first().click();
    await page.evaluate(() => { user = 'other-master'; session += 1; controller.invalidateScope(); });
    const afterAuth = await page.evaluate(() => measureOpen('11:00'));
    assert.ok(afterAuth.firstMs > 400, 'another authenticated scope cannot reuse the previous preview');
    assert.doesNotMatch(await page.locator('#freeSlotsText').inputValue(), /Мой текст для клиента/);
    assert.equal(await page.evaluate(() => shortLinkCalls), 1, 'identical public URL does not trigger an extra short-link read');
    await page.locator('[data-close-free-slots]').first().click();
    await page.evaluate(() => {
      void controller.open();
      const range = document.querySelector('[name="freeSlotsPeriod"][value="range"]');
      range.checked = true; range.dispatchEvent(new Event('change', { bubbles:true }));
    });
    assert.doesNotMatch(await page.locator('#freeSlotsText').inputValue(), /11:00–12:00/, 'day preview is not reused for a range');
    assert.equal(await page.locator('#copyFreeSlots').isDisabled(), true);
    await page.waitForFunction(() => !document.querySelector('#copyFreeSlots').disabled);
    await page.locator('[data-close-free-slots]').first().click();
    await page.evaluate(() => {
      void controller.open();
      const service = document.querySelector('[name="freeSlotsBookingMode"][value="service"]');
      service.checked = true; service.dispatchEvent(new Event('change', { bubbles:true }));
    });
    assert.doesNotMatch(await page.locator('#freeSlotsText').inputValue(), /11:00–12:00/, 'general preview is not reused for a service');
    assert.equal(await page.locator('#copyFreeSlots').isDisabled(), true);
    await page.waitForFunction(() => !document.querySelector('#copyFreeSlots').disabled);
    await page.locator('[data-close-free-slots]').first().click();
    await page.evaluate(() => { testNow = '2026-10-01T07:30:00Z'; void controller.open(); });
    assert.doesNotMatch(await page.locator('#freeSlotsText').inputValue(), /10:00/, 'past starts are removed even from a cached preview');
    assert.equal(await page.locator('#copyFreeSlots').isDisabled(), true);
    console.log('PASS cached read-only preview is immediate and fresh copy remains gated');
  }
} finally {
  await page.close();
  await browser.close();
}
