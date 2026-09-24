import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const html = readFileSync(new URL('../provider.html', import.meta.url), 'utf8');
assert.match(html, /connect-src[^"]*https:\/\/primetime-booking\.primetime-booking-ru\.workers\.dev/, 'Pro CSP must allow the short-link Worker');
const start = html.indexOf('<dialog class="free-slots-dialog"');
const dialog = html.slice(start, html.indexOf('</dialog>', start) + 9);
const source = readFileSync(new URL('../free-slots-share.js', import.meta.url), 'utf8');
const helper = readFileSync(new URL('../free-slots-short-link.js', import.meta.url), 'utf8');
assert.match(source, /import\('\.\/free-slots-short-link\.js\?v=936'\)/);
const workerOrigin = 'https://primetime-booking.primetime-booking-ru.workers.dev';
const codes = { general:'ABCDEFGHJK', service:'BCDEFGHJKL', qr:'CDEFGHJKLM' };
const service = 'c1d4ac71-a211-4991-924e-6b378789be12';
const location = '33d4ac71-a211-4991-924e-6b378789be12';
const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
try {
  const page = await browser.newPage({ viewport:{ width:390, height:844 } });
  const errors = [];
  const issued = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://short-link.test/**', route => route.request().url().includes('/free-slots-short-link.js')
    ? route.fulfill({ contentType:'text/javascript', body:helper })
    : route.fulfill({ contentType:'text/html', body:`<button id="open">Открыть</button>${dialog}` }));
  await page.route(`${workerOrigin}/api/booking-short-links`, async route => {
    const target = new URL(route.request().postDataJSON().url);
    assert.equal(target.origin, 'https://primetime-booking.github.io');
    assert.equal(target.searchParams.get('org'), 'minuta-test');
    assert.equal(target.searchParams.get('location'), location);
    const serviceId = target.searchParams.get('service');
    assert.ok(serviceId === null || serviceId === service);
    const sourceKey = target.searchParams.get('utm_source');
    if (sourceKey === 'whatsapp') {
      await route.fulfill({ status:503, contentType:'application/json', body:'{}' });
      return;
    }
    const code = sourceKey === 'qr' ? codes.qr : serviceId ? codes.service : codes.general;
    issued.push(`${sourceKey}:${serviceId || 'general'}`);
    await route.fulfill({ contentType:'application/json', body:JSON.stringify({ code, url:`${workerOrigin}/${code}` }) });
  });
  await page.goto('https://short-link.test/');
  await page.addScriptTag({ content:source });
  await page.evaluate(({ service, location }) => {
    window.copied = []; window.shared = [];
    Object.defineProperty(navigator, 'clipboard', { configurable:true, value:{ writeText:async text => window.copied.push(text) } });
    Object.defineProperty(navigator, 'share', { configurable:true, value:async data => window.shared.push(data.text) });
    window.controller = MinutaFreeSlots.createController({
      root:document.querySelector('#freeSlotsDialog'),
      getData:() => ({ userId:'master', organizationId:'org-1', sessionGeneration:1,
        today:'2026-09-24', now:'2026-09-24T08:00:00Z', selectedDate:'2026-09-25',
        bookingUrl:'https://aladushka9180-droid.github.io/anatomy-trainer/minuta-online-booking/index.html?org=minuta-test&theme=rose&headline=welcome' }),
      loadContext:async () => ({ mode:'organization', organizationId:'org-1', organizationSlug:'minuta-test',
        resourceScheduling:true, performerId:'master', locations:[{ id:location, name:'Филиал' }],
        services:[{ id:service, name:'Массаж', duration_minutes:60, location_ids:[location] }] }),
      loadSlots:async args => ({ data:[{ booking_date:args.from, booking_time:'10:00' }] }),
      loadWindows:async args => ({ data:[{ booking_date:args.from, start_time:'10:00', end_time:'11:00', duration_minutes:60 }] }),
      notify:() => {},
    });
    document.querySelector('#open').addEventListener('click', window.controller.open);
  }, { service, location });
  await page.locator('#open').click();
  await page.waitForFunction(() => !document.querySelector('#copyFreeSlots').disabled);
  const masterUrl = `${workerOrigin}/${codes.general}`;
  assert.equal(await page.locator('#freeSlotsBookingLink').getAttribute('href'), masterUrl);
  assert.ok((await page.locator('#freeSlotsText').inputValue()).includes(masterUrl));
  await page.locator('#copyFreeSlotsLink').click();
  assert.equal(await page.evaluate(() => window.copied.at(-1)), masterUrl);
  await page.locator('#shareFreeSlots').click();
  await page.waitForFunction(() => window.shared.length > 0);
  assert.ok((await page.evaluate(() => window.shared.at(-1))).includes(masterUrl));
  await page.locator('[name="freeSlotsBookingMode"][value="service"]').evaluate(input => {
    input.checked = true; input.dispatchEvent(new Event('change', { bubbles:true }));
  });
  await page.waitForFunction(() => document.querySelector('#freeSlotsBookingLink').href.endsWith('/BCDEFGHJKL'));
  assert.equal(await page.locator('#freeSlotsBookingLink').getAttribute('href'), `${workerOrigin}/${codes.service}`);
  await page.locator('[name="freeSlotsSource"][value="qr"]').evaluate(input => {
    input.checked = true; input.dispatchEvent(new Event('change', { bubbles:true }));
  });
  await page.waitForFunction(() => document.querySelector('#freeSlotsBookingLink').href.endsWith('/CDEFGHJKLM'));
  const qrUrl = `${workerOrigin}/${codes.qr}`;
  assert.ok((await page.locator('#freeSlotsText').inputValue()).includes(qrUrl));
  assert.equal(await page.locator('#freeSlotsBookingLink').getAttribute('href'), qrUrl);
  assert.equal(await page.locator('#freeSlotsQr').evaluate(canvas => canvas.hidden), false);
  assert.equal(await page.locator('#downloadFreeSlotsQr').evaluate(button => button.hidden), false);
  await page.locator('[name="freeSlotsSource"][value="whatsapp"]').evaluate(input => {
    input.checked = true; input.dispatchEvent(new Event('change', { bubbles:true }));
  });
  await page.waitForFunction(() => document.querySelector('#freeSlotsShareStatus').textContent.includes('Короткая ссылка временно недоступна'));
  const fallback = await page.locator('#freeSlotsBookingLink').getAttribute('href');
  assert.ok(fallback.startsWith('https://aladushka9180-droid.github.io/anatomy-trainer/minuta-online-booking/index.html?'));
  assert.equal(new URL(fallback).searchParams.get('utm_source'), 'whatsapp');
  await page.locator('#copyFreeSlotsLink').click();
  assert.equal(await page.evaluate(() => window.copied.at(-1)), fallback);
  assert.deepEqual(issued, ['master:general', `master:${service}`, `qr:${service}`]);
  assert.deepEqual(errors, []);
  console.log('short booking link publication actions passed');
} finally { await browser.close(); }
