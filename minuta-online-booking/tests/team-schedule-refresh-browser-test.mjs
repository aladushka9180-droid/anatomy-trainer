import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fixtureHtml } from './team-schedule-fixture.mjs';
const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless: true });
const results = [];
async function pageFor(options = {}, role = 'owner') {
  const page = await browser.newPage({ viewport: { width: 390, height: 780 }, serviceWorkers: 'block', ...options });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'https://schedule.test' || route.request().method() !== 'GET') return route.abort();
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: fixtureHtml({ role }) });
    const name = url.pathname.slice(1); if (name.includes('..')) return route.abort();
    try { return route.fulfill({ contentType: ({ '.css': 'text/css', '.js': 'application/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' })[extname(name)] || 'application/octet-stream', body: readFileSync(new URL(`../${name}`, import.meta.url)) }); }
    catch { return route.abort(); }
  });
  await page.goto('https://schedule.test/'); await page.locator('#teamScheduleRange').waitFor({ state: 'visible' });
  return { page, errors };
}
try {
  for (const role of ['owner', 'admin', 'specialist']) {
    const { page, errors } = await pageFor({}, role);
    for (let i = 0; i < 2; i++) {
      assert.equal(await page.locator('#shiftSchedulingEnabled').isEnabled(), role === 'owner');
      await page.evaluate(() => controller.load());
    }
    assert.equal(errors.length, 0); results.push({ role, strictPermission: 'PASS' }); await page.close();
  }
  for (const timezoneId of ['Pacific/Kiritimati', 'Etc/GMT+12', 'Europe/Samara']) {
    const { page, errors } = await pageFor({ timezoneId });
    await page.evaluate(async () => { document.querySelector('#shiftStartDate').value = '2099-10-15'; document.querySelector('#shiftPeriod').value = '7'; await controller.load(); });
    assert.deepEqual(await page.locator('[data-ts-day]').evaluateAll(nodes => nodes.map(n => n.dataset.tsDay)), Array.from({ length: 7 }, (_, i) => `2099-10-${15 + i}`));
    assert.equal(await page.evaluate(() => calls.at(-1).parameters.p_end), '2099-10-21');
    await page.getByRole('button', { name: 'Следующие 7 дней' }).click();
    assert.equal(await page.locator('#shiftStartDate').inputValue(), '2099-10-22');
    await page.waitForFunction(() => calls.at(-1).parameters.p_end === '2099-10-28' && !document.querySelector('#shiftsPanel').inert);
    assert.equal(errors.length, 0, errors.join('\n')); results.push({ timezoneId, calendar: 'PASS', readRange: 'PASS' }); await page.close();
  }
  for (const width of [390, 760, 1440]) for (const employees of [1, 30]) {
    const { page, errors } = await pageFor({ viewport: { width, height: 780 } });
    await page.evaluate(async count => {
      state.performers = state.performers.slice(0, count); state.shifts = []; state.absences = []; state.bookings = []; state.services = [];
      await controller.load(); window.savedRead = db.rpc;
      db.rpc = async (...args) => { await new Promise(resolve => setTimeout(resolve, 250)); return savedRead(...args); };
      window.scrollTo({ top: document.querySelector('#teamScheduleCalendar').getBoundingClientRect().top + scrollY, behavior: 'instant' });
    }, employees);
    await page.waitForTimeout(60); const before = await page.evaluate(() => scrollY);
    await page.evaluate(() => { window.refresh = controller.load(); });
    await page.waitForTimeout(60);
    assert.equal(await page.locator('#shiftWorkspace').isVisible(), true, 'same-context refresh keeps the layout');
    assert.equal(await page.locator('#shiftsPanel').evaluate(n => n.inert), true, 'interaction waits for fresh permissions');
    await page.evaluate(() => refresh); const after = await page.evaluate(() => scrollY);
    assert.ok(Math.abs(before - after) <= 2, `scroll changed at ${width}/${employees}: ${before} -> ${after}`);
    assert.equal(await page.locator('#teamScheduleActions [data-shift-new]').isDisabled(), false);
    assert.equal(await page.locator('#shiftsPanel').evaluate(n => n.inert), false);
    // Two read triggers during one delayed refresh must keep the same layout too.
    await page.evaluate(() => { window.readA = controller.load(); window.readB = controller.load(); });
    await page.waitForTimeout(60); assert.equal(await page.locator('#shiftWorkspace').isVisible(), true);
    await page.evaluate(() => Promise.all([readA, readB]));
    assert.ok(Math.abs(before - await page.evaluate(() => scrollY)) <= 2);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (process.env.SHIFT_SCREENSHOT_DIR && employees === 1) {
      mkdirSync(process.env.SHIFT_SCREENSHOT_DIR, { recursive: true }); await page.screenshot({ path: `${process.env.SHIFT_SCREENSHOT_DIR}/refresh-${width}.png` });
    }
    // A context switch must hide the old schedule immediately, including overlapping reads.
    await page.evaluate(() => { org = 'org-b'; window.switchRead = controller.setOrganization({ id: org }); });
    assert.equal(await page.locator('#shiftWorkspace').isVisible(), false);
    await page.evaluate(() => switchRead);
    assert.equal(await page.locator('#shiftWorkspace').isVisible(), true);
    await page.evaluate(() => { db.rpc = async () => ({ error: { message: 'read failed' } }); return controller.load(); });
    assert.equal(await page.locator('#shiftWorkspace').isVisible(), false, 'failed reads must not expose stale writable data');
    assert.equal(await page.locator('#shiftsUnavailable').isVisible(), true);
    assert.equal(errors.length, 0, errors.join('\n'));
    results.push({ width, employees, before, after, scroll: 'PASS', contextIsolation: 'PASS', readFailure: 'PASS' }); await page.close();
  }
  console.log(JSON.stringify({ externalTransport: false, productionWrites: 0, results }));
} finally { await browser.close(); }
