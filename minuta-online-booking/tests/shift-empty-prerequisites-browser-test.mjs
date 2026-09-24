import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'provider.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const source = readFileSync(resolve(root, 'shift-management.js'), 'utf8');
const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless:true });
const mime = { '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp', '.woff2':'font/woff2' };
const errors = [];
const unexpected = [];
const screenshotDir = process.env.SHIFT_SCREENSHOT_DIR;
if (screenshotDir) mkdirSync(screenshotDir, { recursive:true });

try {
  for (const width of [390, 760, 1440]) {
    const page = await browser.newPage({ bypassCSP:true, serviceWorkers:'block', viewport:{ width, height:900 } });
    page.on('pageerror', error => errors.push(`${width}: ${error.message}`));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'https://shift-empty.test' || route.request().method() !== 'GET') {
        unexpected.push(`${route.request().method()} ${url.href}`);
        return route.abort();
      }
      if (url.pathname.endsWith('/provider.html')) return route.fulfill({ contentType:'text/html', body:html });
      const relative = decodeURIComponent(url.pathname.replace('/minuta-online-booking/', ''));
      if (relative.includes('..')) return route.abort();
      try {
        return route.fulfill({ contentType:mime[extname(relative)] || 'application/octet-stream', body:readFileSync(resolve(root, relative)) });
      } catch { return route.abort(); }
    });
    await page.goto('https://shift-empty.test/minuta-online-booking/provider.html', { waitUntil:'networkidle' });
    await page.evaluate(() => {
      document.documentElement.classList.remove('provider-booting');
      document.documentElement.classList.add('top-level');
      document.querySelector('#providerBoot')?.remove();
      document.querySelector('#authCard').hidden = true;
      document.querySelector('#dashboard').hidden = false;
      document.querySelectorAll('[data-provider-panel]').forEach(panel => {
        panel.hidden = panel.dataset.providerPanel !== 'organization';
        panel.classList.toggle('active', !panel.hidden);
      });
      document.querySelector('#organizationWorkspace').hidden = false;
      document.querySelector('#organizationLoading').hidden = true;
      document.querySelectorAll('[data-provider-panel="organization"] .organization-section').forEach(section => {
        section.hidden = section.id !== 'shiftsPanel';
      });
      document.querySelector('#shiftSubstitutionPanel').hidden = true;
    });
    await page.addScriptTag({ content:source });
    await page.evaluate(() => {
      window.shiftCalls = [];
      window.shiftFixture = { performers:[], locations:[] };
      window.shiftController = MinutaShifts.createController({
        db:{ rpc:async (name) => {
          shiftCalls.push(name);
          if (name !== 'get_minuta_shift_workspace') throw new Error(`Unexpected RPC: ${name}`);
          return { data:{ organization_id:'test-organization', current_role:'owner', can_manage_team:false,
            enabled:false, performers:shiftFixture.performers, locations:shiftFixture.locations,
            services:[], shifts:[], absences:[], bookings:[], utilization:[], audit:[] }, error:null };
        } },
        $:selector => document.querySelector(selector),
        escapeHtml:value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]),
        notify:() => {}, requireWrites:() => false, applyWriteAvailability:() => {},
        getCurrentUser:() => ({id:'test-user'}), getSessionGeneration:() => 1, sessionIsCurrent:() => true
      });
    });
    assert.equal((await page.evaluate(() => shiftController.setOrganization({id:'test-organization'}))).ok, true);
    assert.equal(await page.locator('#shiftsList').isVisible(), true, `${width}: shift list must be visible`);
    assert.match(await page.locator('#shiftsList').textContent(), /Сначала добавьте специалиста/);
    assert.equal(await page.locator('#shiftCreator').getAttribute('hidden'), '');
    assert.equal(await page.locator('#shiftsList [data-section-target="organizationPeopleSection"]').count(), 1);
    if (screenshotDir) await page.locator('#shiftsPanel').screenshot({ path:resolve(screenshotDir, `${width}-no-performer.png`) });

    await page.evaluate(() => { shiftFixture.performers = [{id:'performer-1', display_name:'Тестовый специалист'}]; });
    await page.evaluate(() => shiftController.load());
    assert.match(await page.locator('#shiftsList').textContent(), /Сначала добавьте активный филиал/);
    assert.equal(await page.locator('#shiftCreator').getAttribute('hidden'), '');
    if (screenshotDir) await page.locator('#shiftsPanel').screenshot({ path:resolve(screenshotDir, `${width}-no-location.png`) });

    await page.evaluate(() => { shiftFixture.locations = [{id:'location-1', name:'Тестовый филиал', active:true}]; });
    await page.evaluate(() => shiftController.load());
    assert.match(await page.locator('#shiftsList').textContent(), /Добавьте рабочие часы специалиста/);
    assert.equal(await page.locator('#shiftCreator').getAttribute('hidden'), null);
    assert.equal(await page.locator('#shiftsList [data-section-target]').count(), 0);
    if (screenshotDir) await page.locator('#shiftsPanel').screenshot({ path:resolve(screenshotDir, `${width}-no-shifts.png`) });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `${width}: horizontal overflow ${overflow}`);
    assert.deepEqual(await page.evaluate(() => shiftCalls), Array(3).fill('get_minuta_shift_workspace'));
    await page.close();
  }
} finally { await browser.close(); }

assert.deepEqual(errors, []);
assert.deepEqual(unexpected, []);
console.log('Shift empty prerequisites browser checks passed at 390, 760 and 1440');
