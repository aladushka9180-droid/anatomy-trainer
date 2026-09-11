import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, '.tmp-provider-sandbox-v144');
mkdirSync(output, { recursive:true });
const html = readFileSync(resolve(root, 'provider.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const source = readFileSync(resolve(root, 'payment-management.js'), 'utf8');
const playwright = await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const chromium = playwright.chromium || playwright.default?.chromium;
const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
const errors = [];
const unexpected = [];
const mime = { '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp', '.woff2':'font/woff2' };
const organizationId = '11111111-1111-4111-8111-111111111111';
const bookingId = '22222222-2222-4222-8222-222222222222';

try {
  for (const width of [390, 760, 1440]) {
    const page = await browser.newPage({ bypassCSP:true, serviceWorkers:'block', viewport:{ width, height:900 } });
    page.on('pageerror', error => errors.push(`${width}: ${error.message}`));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'https://provider-sandbox.test' || route.request().method() !== 'GET') {
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
    await page.goto('https://provider-sandbox.test/minuta-online-booking/provider.html', { waitUntil:'networkidle' });
    await page.evaluate(() => {
      localStorage.clear();
      document.documentElement.classList.remove('provider-booting');
      document.documentElement.classList.add('top-level');
      document.querySelector('#providerBoot')?.remove();
      document.body.dataset.providerTheme = 'midnight';
      document.body.dataset.providerLayout = 'bento';
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
      document.querySelector('#paymentSandboxDisclosure').open = true;
    });
    await page.addScriptTag({ content:source });
    await page.evaluate(async ({ organizationId, bookingId }) => {
      window.sandboxCalls = [];
      window.sandboxNotices = [];
      window.sandboxLedger = null;
      const paymentWorkspace = {
        organization_id:organizationId,
        current_role:'owner',
        settings:{ enabled:false, environment:'test', fiscalization_enabled:false },
        recent_attempts:[], recent_refunds:[], recent_reconciliations:[]
      };
      const db = {
        rpc:async (name, args) => {
          sandboxCalls.push({ name, args:structuredClone(args) });
          if (name === 'get_minuta_payment_workspace') return { data:paymentWorkspace, error:null };
          if (name === 'get_minuta_payment_sandbox_journal_v144') {
            return sandboxLedger ? { data:{ ...sandboxLedger, journal:[] }, error:null }
              : { data:null, error:{ message:'sandbox_payment_not_found' } };
          }
          if (name !== 'apply_minuta_payment_sandbox_v144') return { data:null, error:{ code:'PGRST202' } };
          const previous = sandboxLedger;
          if (args.p_command === 'create') sandboxLedger = {
            ok:true, sandbox:true, ledgerId:args.p_ledger, bookingId:args.p_booking,
            status:'created', purpose:args.p_purpose, currency:'RUB', amountMinor:args.p_amount_minor,
            authorizedMinor:0, capturedMinor:0, refundedMinor:0, version:1, replayed:false
          };
          else if (args.p_command === 'authorize') sandboxLedger = {
            ...previous, status:'authorized', authorizedMinor:previous.amountMinor, version:previous.version + 1
          };
          else if (args.p_command === 'capture') sandboxLedger = {
            ...previous, status:'captured', capturedMinor:previous.amountMinor, version:previous.version + 1
          };
          else if (args.p_command === 'refund') {
            const refundedMinor = previous.refundedMinor + args.p_amount_minor;
            sandboxLedger = { ...previous, refundedMinor,
              status:refundedMinor === previous.capturedMinor ? 'refunded' : 'partially_refunded',
              version:previous.version + 1 };
          } else sandboxLedger = { ...previous, status:'cancelled', version:previous.version + 1 };
          return { data:sandboxLedger, error:null };
        },
        from:() => { throw new Error('sandbox browser check must not query payment tables directly'); },
        functions:{ invoke:async () => { throw new Error('sandbox browser check must not call payment providers'); } }
      };
      window.paymentController = MinutaPayments.createController({
        db,
        $:selector => document.querySelector(selector),
        escapeHtml:value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]),
        notify:value => sandboxNotices.push(value),
        requireWrites:() => true,
        getSandboxBookings:() => [{ id:bookingId, clientName:'Тестовая запись', date:'2026-09-11', time:'15:30', totalPriceRub:1250 }]
      });
      paymentController.bind();
      await paymentController.setOrganization({ id:organizationId, current_role:'owner' });
    }, { organizationId, bookingId });

    await page.locator('#paymentSandboxWorkspace').waitFor({ state:'visible' });
    assert.equal(await page.locator('#paymentSandboxBooking').inputValue(), bookingId);
    assert.equal(await page.locator('#paymentSandboxAmount').inputValue(), '1250');
    await page.locator('#paymentSandboxForm button[type="submit"]').click();
    await page.waitForFunction(() => window.sandboxLedger?.status === 'created');
    assert.equal(await page.locator('#paymentSandboxState').innerText(), 'Создан');
    if (width === 390) {
      await page.locator('[data-payment-sandbox-action="authorize"]').click();
      await page.waitForFunction(() => window.sandboxLedger?.status === 'authorized');
      await page.locator('[data-payment-sandbox-action="capture"]').click();
      await page.waitForFunction(() => window.sandboxLedger?.status === 'captured');
      assert.equal(await page.locator('#paymentSandboxRefundAmount').inputValue(), '1250.00');
      await page.locator('[data-payment-sandbox-action="refund"]').click();
      await page.waitForFunction(() => window.sandboxLedger?.status === 'refunded');
      assert.equal(await page.locator('#paymentSandboxState').innerText(), 'Полностью возвращён');
      assert.deepEqual(await page.evaluate(() => sandboxCalls
        .filter(item => item.name === 'apply_minuta_payment_sandbox_v144')
        .map(item => [item.args.p_command, item.args.p_expected_version, item.args.p_amount_minor])), [
        ['create', 0, 125000], ['authorize', 1, null], ['capture', 2, null], ['refund', 3, 125000]
      ]);
    }
    const layout = await page.evaluate(() => ({
      overflow:document.documentElement.scrollWidth - document.documentElement.clientWidth,
      buttonHeights:[...document.querySelectorAll('#paymentSandboxDisclosure button:not([hidden])')]
        .map(item => item.getBoundingClientRect()).filter(rect => rect.width > 0).map(rect => rect.height)
    }));
    assert.ok(layout.overflow <= 1, `${width}: horizontal overflow ${layout.overflow}`);
    if (width <= 760) assert.ok(layout.buttonHeights.every(height => height >= 44), `${width}: sandbox buttons must be at least 44px`);
    await page.screenshot({ path:resolve(output, `${width}.png`), fullPage:true });
    await page.close();
  }
} finally {
  await browser.close();
}

assert.deepEqual(errors, []);
assert.deepEqual(unexpected, []);
console.log('PrimeTime Pro sandbox payment browser checks passed at 390, 760 and 1440');
