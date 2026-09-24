import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'provider.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const source = readFileSync(resolve(root, 'payroll-management.js'), 'utf8');
const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless:true });
const mime = { '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp', '.woff2':'font/woff2' };
const errors = [];
const unexpected = [];
const screenshotDir = process.env.PAYROLL_SCREENSHOT_DIR;
if (screenshotDir) mkdirSync(screenshotDir, { recursive:true });

try {
  for (const width of [390, 760, 1440]) {
    const page = await browser.newPage({ bypassCSP:true, serviceWorkers:'block', viewport:{ width, height:900 } });
    page.on('pageerror', error => errors.push(`${width}: ${error.message}`));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'https://payroll-context.test' || route.request().method() !== 'GET') {
        unexpected.push(`${route.request().method()} ${url.href}`);
        return route.abort();
      }
      if (url.pathname.endsWith('/provider.html')) return route.fulfill({ contentType:'text/html', body:html });
      const relative = decodeURIComponent(url.pathname.replace('/minuta-online-booking/', ''));
      if (relative.includes('..')) return route.abort();
      try { return route.fulfill({ contentType:mime[extname(relative)] || 'application/octet-stream', body:readFileSync(resolve(root, relative)) }); }
      catch { return route.abort(); }
    });
    await page.goto('https://payroll-context.test/minuta-online-booking/provider.html', { waitUntil:'networkidle' });
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
        section.hidden = section.id !== 'payrollPanel';
      });
    });
    await page.addScriptTag({ content:source });
    await page.evaluate(() => {
      window.payrollCalls = [];
      window.payrollFixture = { enabled:false, plans:[] };
      window.payrollController = MinutaPayroll.createController({
        db:{ rpc:async name => {
          payrollCalls.push(name);
          if (name !== 'get_minuta_payroll_ledger_workspace_v136') throw new Error(`Unexpected RPC: ${name}`);
          return { data:{ organization_id:'test-organization', current_role:'owner', can_manage:true,
            ledger_enabled:payrollFixture.enabled, plans:payrollFixture.plans }, error:null };
        } },
        $:selector => document.querySelector(selector),
        escapeHtml:value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]),
        notify:() => {}, requireWrites:() => false, applyWriteAvailability:() => {},
        getCurrentUser:() => ({id:'test-user'}), getSessionGeneration:() => 1, sessionIsCurrent:() => true
      });
      payrollController.bind();
    });
    assert.equal((await page.evaluate(() => payrollController.setOrganization({id:'test-organization'}))).ok, true);
    assert.equal(await page.locator('#payrollPeriodsList').isVisible(), true);
    assert.match(await page.locator('#payrollPeriodsList').innerText(), /Сначала добавьте план мотивации и включите зарплатный журнал/);
    assert.match(await page.locator('#payrollPeriodsList').innerText(), /не создаёт начислений и выплат/);
    assert.equal(await page.locator('#payrollPeriodCreator').getAttribute('hidden'), '');
    if (screenshotDir) await page.locator('#payrollPanel').screenshot({ path:resolve(screenshotDir, `${width}-disabled.png`) });

    await page.evaluate(() => { payrollFixture.enabled = true; });
    await page.evaluate(() => payrollController.load());
    assert.match(await page.locator('#payrollPeriodsList').innerText(), /Начисление и выплата — отдельные действия/);
    assert.equal(await page.locator('#payrollPeriodCreator').getAttribute('hidden'), null);
    await page.locator('#payrollPeriodCreator summary').click();
    assert.match(await page.locator('#payrollPeriodScope').innerText(), /Период: 1 сент\. 2026 г\. — 30 сент\. 2026 г\./);
    assert.match(await page.locator('#payrollPeriodScope').innerText(), /создаст или пересчитает черновик/);
    assert.ok(Number.parseFloat(await page.locator('#payrollPeriodScope').evaluate(element => getComputedStyle(element).fontSize)) >= 12);
    assert.equal(await page.locator('#payrollPeriodForm button[type="submit"]').innerText(), 'Подготовить расчёт');
    if (screenshotDir) await page.locator('#payrollPanel').screenshot({ path:resolve(screenshotDir, `${width}-ready.png`) });

    await page.locator('#payrollStartDate').fill('2026-09-15');
    await page.locator('#payrollPeriodScope').waitFor({ state:'visible' });
    assert.match(await page.locator('#payrollPeriodScope').innerText(), /Период: 15 сент\. 2026 г\. — 30 сент\. 2026 г\./);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `${width}: horizontal overflow ${overflow}`);
    assert.ok((await page.evaluate(() => payrollCalls)).every(name => name === 'get_minuta_payroll_ledger_workspace_v136'));
    await page.close();
  }
} finally { await browser.close(); }

assert.deepEqual(errors, []);
assert.deepEqual(unexpected, []);
console.log('Payroll period context browser checks passed at 390, 760 and 1440');
