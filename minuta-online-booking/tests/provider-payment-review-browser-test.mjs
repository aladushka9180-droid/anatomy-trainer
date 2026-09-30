import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, '.tmp-provider-payment-review');
mkdirSync(output, { recursive:true });
const html = readFileSync(resolve(root, 'provider.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const source = readFileSync(resolve(root, 'payment-management.js'), 'utf8');
const playwright = await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const chromium = playwright.chromium || playwright.default?.chromium;
const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
const organizationId = '11111111-1111-4111-8111-111111111111';
const errors = [];
const unexpected = [];
const mime = { '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp', '.woff2':'font/woff2' };

try {
  for (const width of [390, 621, 760, 1440]) {
    const page = await browser.newPage({ bypassCSP:true, serviceWorkers:'block', viewport:{ width, height:900 } });
    page.on('pageerror', error => errors.push(`${width}: ${error.message}`));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'https://payment-review.test' || route.request().method() !== 'GET') {
        unexpected.push(`${route.request().method()} ${url.href}`);
        return route.abort();
      }
      if (url.pathname.endsWith('/provider.html')) return route.fulfill({ contentType:'text/html', body:html });
      const relative = decodeURIComponent(url.pathname.replace('/minuta-online-booking/', ''));
      if (relative.includes('..')) return route.abort();
      try { return route.fulfill({ contentType:mime[extname(relative)] || 'application/octet-stream', body:readFileSync(resolve(root, relative)) }); }
      catch { return route.abort(); }
    });
    await page.goto('https://payment-review.test/minuta-online-booking/provider.html', { waitUntil:'networkidle' });
    await page.evaluate(() => {
      localStorage.clear();
      document.documentElement.classList.remove('provider-booting');
      document.documentElement.classList.add('top-level');
      document.querySelector('#providerBoot')?.remove();
      document.body.dataset.providerTheme = 'pink-porcelain';
      document.body.dataset.providerLayout = 'soft';
      document.querySelector('#authCard').hidden = true;
      document.querySelector('#dashboard').hidden = false;
      document.querySelectorAll('[data-provider-panel]').forEach(panel => {
        panel.hidden = panel.dataset.providerPanel !== 'organization';
        panel.classList.toggle('active', !panel.hidden);
      });
      document.querySelector('#organizationWorkspace').hidden = false;
      document.querySelector('#organizationLoading').hidden = true;
      document.querySelector('#organizationSectionSelect').value = 'paymentProviderPanel';
      document.querySelectorAll('#organizationSectionNav button').forEach(button => {
        button.classList.toggle('active', button.dataset.sectionTarget === 'paymentProviderPanel');
      });
      document.querySelectorAll('[data-provider-panel="organization"] .organization-section').forEach(panel => {
        panel.hidden = panel.id !== 'paymentProviderPanel';
      });
    });
    await page.addScriptTag({ content:source });
    await page.evaluate(async id => {
      window.reviewCalls = [];
      window.reviewNotices = [];
      window.reviewRole = 'owner';
      const db = {
        rpc:async (name, args) => {
          reviewCalls.push({ name, args });
          if (name === 'get_minuta_payment_workspace') return { data:{
            organization_id:id, current_role:reviewRole, settings:{ enabled:false, environment:'test', fiscalization_enabled:false },
            recent_attempts:[], recent_refunds:[], recent_reconciliations:[]
          }, error:null };
          throw new Error(`Unexpected RPC: ${name}`);
        },
        from:() => { throw new Error('No payment-table access in review test'); },
        functions:{ invoke:() => { throw new Error('No payment-provider call in review test'); } }
      };
      window.reviewController = MinutaPayments.createController({
        db, $:selector => document.querySelector(selector), escapeHtml:value => String(value ?? ''),
        notify:value => reviewNotices.push(value), requireWrites:() => true, getSandboxBookings:() => []
      });
      reviewController.bind();
      window.reviewLoadResult = await reviewController.setOrganization({ id, current_role:'owner' });
    }, organizationId);
    assert.match(await page.locator('#paymentProviderReviewMode').textContent(), /тестовый магазин; приём выключен/,
      JSON.stringify(await page.evaluate(() => ({ result:reviewLoadResult, calls:reviewCalls, notice:reviewNotices, unavailable:document.querySelector('#paymentProviderUnavailableText')?.textContent, panelHidden:document.querySelector('#paymentProviderPanel').hidden, workspaceHidden:document.querySelector('#paymentProviderWorkspace').hidden }))));
    assert.match(await page.locator('#paymentProviderReviewTest').textContent(), /нет подтверждённого результата.*не тест ЮKassa/);
    assert.match(await page.locator('#paymentProviderReviewRights').textContent(), /владелец.*может сохранять/);
    assert.equal(await page.locator('#paymentProviderProductionReview').isVisible(), false);
    await page.screenshot({ path:resolve(output, `payment-default-${width}.png`), fullPage:true });
    await page.locator('#paymentProviderEnvironment').selectOption('production');
    assert.equal(await page.locator('#paymentProviderProductionReview').isVisible(), true);
    await page.locator('#paymentProviderEnabled').check();
    await page.locator('#paymentProviderSettingsForm button[type="submit"]').click();
    assert.equal(await page.evaluate(() => reviewCalls.some(call => call.name === 'set_minuta_yookassa_settings')), false);
    assert.match((await page.evaluate(() => reviewNotices.at(-1))), /review/);
    assert.equal(await page.locator('#paymentProviderSettingsForm button[type="submit"]').isEnabled(), true);
    const layout = await page.evaluate(() => ({
      viewport:innerWidth, scrollWidth:document.documentElement.scrollWidth,
      review:document.querySelector('#paymentProviderReview').getBoundingClientRect().toJSON(),
      form:document.querySelector('#paymentProviderSettingsForm').getBoundingClientRect().toJSON()
    }));
    assert.equal(layout.viewport, width);
    assert.ok(layout.scrollWidth <= width, `${width}: horizontal overflow ${layout.scrollWidth}`);
    assert.ok(layout.review.width > 0 && layout.form.width > 0);
    await page.screenshot({ path:resolve(output, `payment-review-${width}.png`), fullPage:true });
    if (width === 390) {
      await page.evaluate(async id => { reviewRole = 'admin'; await reviewController.setOrganization({ id, current_role:'admin' }); }, organizationId);
      assert.match(await page.locator('#paymentProviderReviewRights').textContent(), /администратор.*просмотр без сохранения/);
      assert.equal(await page.locator('#paymentProviderSettingsForm').isVisible(), false);
    }
    await page.close();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpected, []);
  console.log('Payment review browser: PASS (390/621/760/1440; no payment/settings write)');
} finally { await browser.close(); }
