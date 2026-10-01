import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, '.tmp-provider-payment-review');
mkdirSync(output, { recursive:true });
// This virtual link is the release owner's only new HTML registration.
const html = readFileSync(resolve(root, 'provider.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace('</head>', '<link rel="stylesheet" href="payment-soft-ui.css"></head>');
const source = readFileSync(resolve(root, 'payment-management.js'), 'utf8');
const reviewSource = readFileSync(resolve(root, 'payment-review.js'), 'utf8');
const playwright = await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const chromium = playwright.chromium || playwright.default?.chromium;
const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
const organizationId = '11111111-1111-4111-8111-111111111111';
const errors = [];
const unexpected = [];
const mime = { '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp', '.woff2':'font/woff2' };
function contrast(foreground, background) {
  const luminance = color => {
    const channels = color.match(/[\d.]+/g).slice(0,3).map(Number);
    const linear = channels.map(value => {
      const channel = color.startsWith('color(srgb ') ? value : value / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    });
    return linear[0]*.2126 + linear[1]*.7152 + linear[2]*.0722;
  };
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a,b) + .05) / (Math.min(a,b) + .05);
}

try {
  const cases = ['pink-porcelain','midnight','noir-safari','eco','pearl','coastal'].flatMap(theme => [390,760,1440].map(width => ({theme,width})));
  cases.push({theme:'pink-porcelain',width:320});
  for (const {width,theme} of cases) {
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
    await page.evaluate(theme => {
      localStorage.clear();
      document.documentElement.classList.remove('provider-booting');
      document.documentElement.classList.add('top-level');
      document.querySelector('#providerBoot')?.remove();
      document.body.dataset.providerTheme = theme;
      document.body.dataset.providerLayout = 'soft';
      document.querySelector('#authCard').hidden = true;
      document.querySelector('#dashboard').hidden = false;
      document.querySelectorAll('[data-provider-panel]').forEach(panel => {
        panel.hidden = panel.dataset.providerPanel !== 'organization';
        panel.classList.toggle('active', !panel.hidden);
      });
      document.querySelector('#organizationWorkspace').hidden = false;
      document.querySelector('#organizationLoading').hidden = true;
      document.querySelector('#organizationRoleBadge').textContent = 'Владелец';
      document.querySelector('#organizationOverviewSection').hidden = true;
      document.querySelector('#organizationAuditPanel').hidden = true;
      document.querySelector('#organizationSectionSelect').value = 'paymentProviderPanel';
      document.querySelectorAll('#organizationSectionNav button').forEach(button => {
        button.classList.toggle('active', button.dataset.sectionTarget === 'paymentProviderPanel');
      });
      document.querySelectorAll('[data-provider-panel="organization"] .organization-section').forEach(panel => {
        panel.hidden = panel.id !== 'paymentProviderPanel';
      });
    }, theme);
    await page.addScriptTag({content:readFileSync(resolve(root, 'organization-group-navigation.js'), 'utf8')});
    await page.addScriptTag({ content:source });
    await page.addScriptTag({ content:reviewSource });
    await page.addScriptTag({content:readFileSync(resolve(root, 'help/help-data.js'), 'utf8')});
    await page.addScriptTag({content:readFileSync(resolve(root, 'contextual-help.js'), 'utf8')});
    await page.evaluate(async id => {
      window.reviewCalls = [];
      window.reviewNotices = [];
      window.reviewRole = 'owner';
      window.reviewError = false;
      const db = {
        rpc:async (name, args) => {
          reviewCalls.push({ name, args });
          if (reviewError) return { data:null, error:{ code:'temporary_error' } };
          if (name === 'get_minuta_payment_workspace') return { data:{
            organization_id:args.p_organization, current_role:reviewRole, settings:{ enabled:false, environment:'test', fiscalization_enabled:false },
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
    assert.match(await page.locator('#paymentProviderReviewMode').textContent(), /Приём предоплаты выключен.*Сохранённый режим: тестовый магазин/,
      JSON.stringify(await page.evaluate(() => ({ result:reviewLoadResult, calls:reviewCalls, notice:reviewNotices, unavailable:document.querySelector('#paymentProviderUnavailableText')?.textContent, panelHidden:document.querySelector('#paymentProviderPanel').hidden, workspaceHidden:document.querySelector('#paymentProviderWorkspace').hidden }))));
    assert.match(await page.locator('#paymentProviderReviewTest').textContent(), /не запускался.*не проверяет ЮKassa/);
    assert.match(await page.locator('#paymentProviderReviewRights').textContent(), /владелец может изменить настройки/);
    assert.equal(await page.locator('#paymentProviderProductionReview').isVisible(), false);
    assert.equal(await page.locator('#paymentSandboxDisclosure').getAttribute('open'), null);
    assert.equal(await page.locator('#paymentSoftStatus').textContent(), 'Выключена');
    assert.equal(await page.locator('#paymentSoftMode').textContent(), 'Тестовый магазин');
    await page.locator('#paymentProviderPanel .contextual-help__trigger').click();
    assert.equal(await page.locator('#paymentProviderPanel .contextual-help__panel').isVisible(), true);
    await page.locator('#paymentProviderPanel .contextual-help__trigger').press('Escape');
    assert.equal(await page.locator('#paymentProviderPanel .contextual-help__panel').isVisible(), false);
    assert.equal(await page.evaluate(() => document.querySelector('#paymentProviderWorkspace').compareDocumentPosition(document.querySelector('#paymentSandboxDisclosure')) & Node.DOCUMENT_POSITION_FOLLOWING), 4);
    assert.equal(await page.locator('#paymentProviderSettingsForm input[type=checkbox]').count(), 3);
    const controls = await page.evaluate(() => {
      const button = document.querySelector('#paymentProviderSettingsForm button[type=submit]');
      const style = getComputedStyle(button);
      return {color:style.color, background:style.backgroundColor,
        heights:[button, document.querySelector('#paymentProviderEnvironment'), ...document.querySelectorAll('.payment-soft-setting')].map(node => node.getBoundingClientRect().height)};
    });
    assert.ok(contrast(controls.color,controls.background) >= 4.5, `${theme}/${width}: primary action contrast`);
    assert.ok(controls.heights.every(height => height >= 44), `${theme}/${width}: touch target too small`);
    await page.evaluate(() => { document.activeElement?.blur(); scrollTo(0,0); });
    await page.screenshot({ path:resolve(output, `payment-default-${theme}-${width}.png`), fullPage:true });
    await page.locator('#paymentFiscalizationEnabled').check();
    assert.equal(await page.locator('#paymentFiscalizationFields').isVisible(), true);
    assert.match(await page.locator('#paymentSoftSaveHint').textContent(), /несохранённые/);
    await page.locator('#paymentFiscalizationEnabled').uncheck();
    assert.equal(await page.locator('#paymentFiscalizationFields').isVisible(), false);
    assert.equal(await page.locator('#paymentSoftSaveHint').textContent(), 'Изменений нет');
    await page.locator('#paymentSandboxDisclosure summary').press('Enter');
    assert.equal(await page.locator('#paymentSandboxForm').isVisible(), true);
    assert.equal(await page.locator('#paymentSandboxForm button[type=submit]').isEnabled(), false, 'Empty booking list must keep the test disabled');
    await page.locator('#paymentSandboxDisclosure summary').press('Enter');
    await page.locator('#paymentProviderEnvironment').selectOption('production');
    assert.equal(await page.locator('#paymentSoftMode').textContent(), 'Тестовый магазин', 'Mode badge represents saved state, not an unsaved draft');
    assert.equal(await page.locator('#paymentProviderProductionReview').isVisible(), true);
    await page.locator('#paymentProviderEnabled').check();
    await page.locator('#paymentProviderSettingsForm button[type="submit"]').click();
    assert.equal(await page.evaluate(() => reviewCalls.some(call => call.name === 'set_minuta_yookassa_settings')), false);
    assert.match(await page.locator('#paymentProviderReviewNotice').textContent(), /подтвердите ознакомление/);
    assert.equal(await page.locator('#paymentProviderSettingsForm button[type="submit"]').isEnabled(), true);
    const layout = await page.evaluate(() => ({
      viewport:innerWidth, scrollWidth:document.documentElement.scrollWidth,
      review:document.querySelector('#paymentProviderReview').getBoundingClientRect().toJSON(),
      form:document.querySelector('#paymentProviderSettingsForm').getBoundingClientRect().toJSON()
    }));
    assert.equal(layout.viewport, width);
    assert.ok(layout.scrollWidth <= width, `${width}: horizontal overflow ${layout.scrollWidth}`);
    assert.ok(layout.review.width > 0 && layout.form.width > 0);
    await page.evaluate(() => { document.activeElement?.blur(); scrollTo(0,0); });
    await page.screenshot({ path:resolve(output, `payment-review-${theme}-${width}.png`), fullPage:true });
    if (width === 390 && theme === 'pink-porcelain') {
      await page.locator('#paymentProviderProductionAcknowledged').check();
      const otherOrganization = '33333333-3333-4333-8333-333333333333';
      await page.evaluate(async id => { await reviewController.setOrganization({ id, current_role:'owner' }); }, otherOrganization);
      assert.equal(await page.locator('#paymentProviderProductionAcknowledged').isChecked(), false,
        'Production acknowledgement must not transfer to another organization');
      await page.locator('#paymentProviderEnvironment').selectOption('production');
      await page.locator('#paymentProviderProductionAcknowledged').check();
      await page.evaluate(() => reviewController.reset());
      assert.equal(await page.locator('#paymentProviderProductionAcknowledged').isChecked(), false,
        'Production acknowledgement must clear on session reset');
      assert.equal(await page.locator('#paymentProviderReview').isVisible(), false);
      await page.evaluate(async id => { reviewError = true; await reviewController.setOrganization({ id, current_role:'owner' }); }, organizationId);
      assert.equal(await page.locator('#paymentProviderReview').isVisible(), false,
        'Unknown settings must not be shown as a verified test mode');
      assert.equal(await page.locator('#paymentSoftMode').isVisible(), false);
      assert.equal(await page.locator('#paymentSoftStatus').textContent(), 'Не проверено');
      assert.equal(await page.locator('#paymentSoftStatus').getAttribute('aria-label'), 'Состояние предоплаты не проверено');
      assert.equal(await page.locator('#paymentSoftStatus').getAttribute('data-enabled'), 'false');
      await page.evaluate(() => { reviewError = false; });
      await page.evaluate(async id => { reviewRole = 'admin'; await reviewController.setOrganization({ id, current_role:'admin' }); }, organizationId);
      assert.match(await page.locator('#paymentProviderReviewRights').textContent(), /администратор может просматривать/);
      assert.equal(await page.locator('#paymentProviderSettingsForm').isVisible(), false);
    }
    await page.close();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpected, []);
  console.log('Payment soft UI + production review: PASS (6 themes x 390/760/1440 + 320; saved/draft state, receipts, keyboard disclosure, roles, unknown settings, production gate; no payment/settings write)');
} finally { await browser.close(); }
