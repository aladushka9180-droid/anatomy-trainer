import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = process.env.MINUTA_AUDIT_SCREENSHOTS ? resolve(process.env.MINUTA_AUDIT_SCREENSHOTS) : '';
if (output) mkdirSync(output, { recursive:true });
const html = readFileSync(resolve(root, 'provider.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const source = readFileSync(resolve(root, 'commerce-management.js'), 'utf8');
const playwright = await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const chromium = playwright.chromium || playwright.default?.chromium;
const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
const errors = [];
const unexpected = [];
const mime = { '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp', '.woff2':'font/woff2' };
const ids = {
  organization:'11111111-1111-4111-8111-111111111155',
  owner:'22222222-2222-4222-8222-222222222155',
  client:'33333333-3333-4333-8333-333333333155',
  booking:'44444444-4444-4444-8444-444444444155',
  sale:'55555555-5555-4555-8555-555555555155',
  item:'66666666-6666-4666-8666-666666666155',
  warehouse:'77777777-7777-4777-8777-777777777155',
  cash:'88888888-8888-4888-8888-888888888155'
};
const claimToken = 'PTS1-A7B9-C2D4-E6F8-G1H3';

try {
  for (const width of [390, 760, 1440]) {
    const page = await browser.newPage({ bypassCSP:true, serviceWorkers:'block', viewport:{ width, height:900 } });
    page.on('pageerror', error => errors.push(`${width}: ${error.message}`));
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable:true,
        value:{ writeText:async value => { window.copiedClientAccessCode = value; } }
      });
    });
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'https://claim.test' || route.request().method() !== 'GET') {
        unexpected.push(`${route.request().method()} ${url.href}`);
        return route.abort();
      }
      if (url.pathname.endsWith('/provider.html')) return route.fulfill({ contentType:'text/html', body:html });
      const relative = decodeURIComponent(url.pathname.replace('/minuta-online-booking/', ''));
      if (relative.includes('..')) return route.abort();
      try { return route.fulfill({ contentType:mime[extname(relative)] || 'application/octet-stream', body:readFileSync(resolve(root, relative)) }); }
      catch { return route.abort(); }
    });
    await page.goto('https://claim.test/minuta-online-booking/provider.html', { waitUntil:'networkidle' });
    await page.evaluate(() => {
      localStorage.clear();
      document.documentElement.classList.remove('provider-booting');
      document.documentElement.classList.add('top-level');
      document.querySelector('#providerBoot')?.remove();
      document.querySelector('#authCard').hidden = true;
      document.querySelector('#dashboard').hidden = false;
      document.querySelectorAll('[data-provider-panel]').forEach(panel => { panel.hidden = panel.dataset.providerPanel !== 'organization'; });
      document.querySelector('#organizationWorkspace').hidden = false;
      document.querySelector('#commercePanel').hidden = false;
      document.querySelector('[data-provider-panel="organization"]').style.display = 'block';
      document.querySelector('#organizationWorkspace').style.display = 'block';
      document.querySelector('#commercePanel').style.display = 'block';
    });
    await page.addScriptTag({ content:source });
    await page.evaluate(async ({ ids, claimToken }) => {
      window.saleClaimCalls = [];
      window.saleClaimNotices = [];
      window.claimMode = 'success';
      window.nextSaleNumber = 0;
      window.workspace = {
        organization_id:ids.organization,
        finance_enabled:true,
        benefits_enabled:true,
        inventory_enabled:true,
        accounts:[{ id:ids.cash, name:'Основная касса', account_type:'cash', system_key:null }],
        sellers:[{ id:ids.owner, name:'Анна Владелец', role:'владелец' }],
        clients:[{ id:ids.client, name:'Тестовый клиент', phone:'+7 900 000-01-55' }],
        bookings:[{ id:ids.booking, client_account_id:ids.client, client_name:'Тестовый клиент', performer_id:ids.owner, booking_date:'2026-09-13', booking_time:'15:30:00', service_name:'Массаж' }],
        benefit_products:[],
        inventory_items:[{ id:ids.item, name:'Крем', sku:'CREAM-155', unit:'piece' }],
        warehouses:[{ id:ids.warehouse, name:'Основной склад' }],
        sales:[], recurring_expenses:[], audit:[]
      };
      const db = { rpc:async (name, args) => {
        saleClaimCalls.push({ name, args:structuredClone(args) });
        if (name === 'get_minuta_commerce_workspace_v151') return { data:structuredClone(workspace), error:null };
        if (name === 'sell_minuta_commercial_product_v151') {
          nextSaleNumber += 1;
          const id = nextSaleNumber === 1 ? ids.sale : `55555555-5555-4555-8555-${String(155 + nextSaleNumber).padStart(12, '0')}`;
          workspace.sales.unshift({
            id, booking_id:args.p_booking, client_account_id:args.p_client_account,
            client_name:args.p_client_account ? 'Тестовый клиент' : null,
            seller_id:ids.owner, seller_name:'Анна Владелец', status:'paid', payment_method:args.p_payment_method,
            total_minor:args.p_unit_price_minor, refunded_minor:0, occurred_at:new Date().toISOString(),
            line:{ item_name:'Крем', item_kind:'inventory_item', quantity:1, refunded_quantity:0, unit_price_minor:args.p_unit_price_minor }
          });
          return { data:{ id, organization_id:ids.organization, status:'paid', replayed:false }, error:null };
        }
        if (name === 'issue_client_identity_sale_claim_v155') {
          if (claimMode === 'error') return { data:null, error:{ message:'temporary gateway failure' } };
          if (claimMode === 'invalid') return { data:{ claim_token:'unsafe', claim_expires_at:'never' }, error:null };
          if (claimMode === 'legacyHex') return { data:[{ claim_token:'ab'.repeat(32), claim_expires_at:new Date(Date.now() + 10 * 60_000).toISOString() }], error:null };
          if (claimMode === 'lowercase') return { data:[{ claim_token:claimToken.toLowerCase(), claim_expires_at:new Date(Date.now() + 10 * 60_000).toISOString() }], error:null };
          if (claimMode === 'tooLong') return { data:[{ claim_token:claimToken, claim_expires_at:new Date(Date.now() + 10 * 60_000 + 1_000).toISOString() }], error:null };
          if (claimMode === 'duplicate') return { data:[
            { claim_token:claimToken, claim_expires_at:new Date(Date.now() + 10 * 60_000).toISOString() },
            { claim_token:claimToken, claim_expires_at:new Date(Date.now() + 10 * 60_000).toISOString() }
          ], error:null };
          return { data:[{ claim_token:claimToken, claim_expires_at:new Date(Date.now() + 10 * 60_000).toISOString() }], error:null };
        }
        return { data:null, error:{ message:`unexpected rpc ${name}` } };
      }};
      const $ = selector => document.querySelector(selector);
      const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]));
      const notify = value => saleClaimNotices.push(value);
      window.saleClaimController = window.MinutaCommerce.createController({
        db, $, escapeHtml, notify, requireWrites:() => true,
        getCurrentUser:() => ({ id:ids.owner }), getSessionGeneration:() => 1,
        sessionIsCurrent:() => true, applyWriteAvailability:() => {}
      });
      saleClaimController.bind();
      await saleClaimController.setOrganization({ id:ids.organization });
    }, { ids, claimToken });

    const prepareStandaloneSale = async ({ client = ids.client, booking = '' } = {}) => {
      await page.evaluate(({ client, booking }) => saleClaimController.startSale({ clientId:client, bookingId:booking }), { client, booking });
      if (!client) await page.locator('#commerceClient').selectOption('');
      await page.locator('#commerceItem').selectOption(ids.item);
      await page.locator('#commerceUnitPrice').fill('500');
      await page.locator('#commerceQuantity').fill('1');
    };

    await prepareStandaloneSale();
    await page.locator('#commerceSaleSubmit').click();
    await page.locator('#commerceClientAccessCode').waitFor({ state:'visible' });
    const successful = await page.evaluate(() => ({
      sales:saleClaimCalls.filter(call => call.name === 'sell_minuta_commercial_product_v151'),
      claims:saleClaimCalls.filter(call => call.name === 'issue_client_identity_sale_claim_v155')
    }));
    assert.equal(successful.sales.length, 1, `${width}: standalone sale is submitted once`);
    assert.equal(successful.claims.length, 1, `${width}: access code is issued once`);
    assert.equal(successful.claims[0].args.p_organization, ids.organization);
    assert.equal(successful.claims[0].args.p_sale, ids.sale);
    assert.match(successful.claims[0].args.p_request_id, /^[0-9a-f-]{36}$/i);
    assert.equal(successful.claims[0].args.p_expires_minutes, 10);
    assert.equal(await page.locator('#commerceSaleCreator').getAttribute('open'), '', `${width}: result remains open`);
    assert.equal(await page.locator('#commerceClientAccessCode').innerText(), claimToken, `${width}: exact PTS1 display code is shown`);
    assert.match(await page.locator('#commerceClientAccessExpiry').innerText(), /^Действует до \d{2}\.\d{2}\.?, \d{2}:\d{2}$/);
    assert.match(await page.locator('#commerceClientAccessNote').innerText(), /одноразовый[\s\S]*этой организации/i);
    await page.locator('#commerceClientAccessCopy').click();
    assert.equal(await page.evaluate(() => copiedClientAccessCode), claimToken, `${width}: copy uses exact unformatted token`);
    const layout = await page.locator('#commerceClientAccessResult').evaluate(element => {
      const rect = element.getBoundingClientRect();
      const code = element.querySelector('code').getBoundingClientRect();
      return { overflow:document.documentElement.scrollWidth - document.documentElement.clientWidth, rect, code };
    });
    assert.ok(layout.overflow <= 1, `${width}: no horizontal overflow`);
    assert.ok(layout.rect.width > 0 && layout.rect.width <= width, `${width}: result fits viewport`);
    assert.ok(layout.code.width > 0 && layout.code.right <= width + 1, `${width}: code fits viewport`);
    if (output) await page.screenshot({ path:resolve(output, `standalone-sale-client-access-${width}.png`), fullPage:true });

    await page.locator('#commerceClient').selectOption(ids.client);
    assert.equal(await page.locator('#commerceClientAccessResult').isHidden(), true, `${width}: client change clears result`);
    assert.equal(await page.locator('#commerceClientAccessCode').textContent(), '', `${width}: client change clears plaintext`);

    if (width === 390) {
      await page.evaluate(() => { claimMode = 'error'; });
      await prepareStandaloneSale();
      await page.locator('#commerceSaleSubmit').click();
      await page.locator('#commerceClientAccessRetry').waitFor({ state:'visible' });
      const beforeRetry = await page.evaluate(() => ({
        sales:saleClaimCalls.filter(call => call.name === 'sell_minuta_commercial_product_v151').length,
        requestIds:saleClaimCalls.filter(call => call.name === 'issue_client_identity_sale_claim_v155').map(call => call.args.p_request_id)
      }));
      assert.match(await page.locator('#commerceClientAccessTitle').innerText(), /Продажа проведена, код не создан/);
      await page.evaluate(() => { claimMode = 'success'; });
      await page.locator('#commerceClientAccessRetry').click();
      await page.locator('#commerceClientAccessCode').waitFor({ state:'visible' });
      const afterRetry = await page.evaluate(() => ({
        sales:saleClaimCalls.filter(call => call.name === 'sell_minuta_commercial_product_v151').length,
        requestIds:saleClaimCalls.filter(call => call.name === 'issue_client_identity_sale_claim_v155').map(call => call.args.p_request_id)
      }));
      assert.equal(afterRetry.sales, beforeRetry.sales, 'retry must not repeat the sale');
      assert.equal(afterRetry.requestIds.at(-1), beforeRetry.requestIds.at(-1), 'retry reuses the claim request only');
      await page.evaluate(() => saleClaimController.reset());
      assert.equal(await page.locator('#commerceClientAccessCode').textContent(), '', 'reset clears claim plaintext');

      await page.evaluate(async ids => {
        claimMode = 'invalid';
        await saleClaimController.setOrganization({ id:ids.organization });
      }, ids);
      await prepareStandaloneSale();
      await page.locator('#commerceSaleSubmit').click();
      await page.locator('#commerceClientAccessRetry').waitFor({ state:'visible' });
      assert.equal(await page.locator('#commerceClientAccessCode').textContent(), '', 'malformed server response stays fail-closed');
      assert.equal(await page.locator('#commerceClientAccessCode').isHidden(), true, 'malformed code is never displayed');

      for (const mode of ['legacyHex', 'lowercase', 'tooLong', 'duplicate']) {
        await page.evaluate(async ({ ids, mode }) => {
          claimMode = mode;
          await saleClaimController.setOrganization({ id:ids.organization });
        }, { ids, mode });
        await prepareStandaloneSale();
        await page.locator('#commerceSaleSubmit').click();
        await page.locator('#commerceClientAccessRetry').waitFor({ state:'visible' });
        assert.equal(await page.locator('#commerceClientAccessCode').textContent(), '', `${mode}: rejected response leaves no plaintext`);
        assert.equal(await page.locator('#commerceClientAccessCode').isHidden(), true, `${mode}: rejected response is never displayed`);
      }
      await page.evaluate(() => saleClaimController.setOrganization(null));
      assert.equal(await page.locator('#commerceClientAccessResult').isHidden(), true, 'organization change clears claim result');
    }

    if (width === 760) {
      const claimsBefore = await page.evaluate(() => saleClaimCalls.filter(call => call.name === 'issue_client_identity_sale_claim_v155').length);
      await prepareStandaloneSale({ booking:ids.booking });
      await page.locator('#commerceSaleSubmit').click();
      const claimsAfter = await page.evaluate(() => saleClaimCalls.filter(call => call.name === 'issue_client_identity_sale_claim_v155').length);
      assert.equal(claimsAfter, claimsBefore, 'visit-linked sale must not issue a standalone access claim');
    }

    if (width === 1440) {
      const claimsBefore = await page.evaluate(() => saleClaimCalls.filter(call => call.name === 'issue_client_identity_sale_claim_v155').length);
      await prepareStandaloneSale({ client:'' });
      await page.locator('#commerceSaleSubmit').click();
      const claimsAfter = await page.evaluate(() => saleClaimCalls.filter(call => call.name === 'issue_client_identity_sale_claim_v155').length);
      assert.equal(claimsAfter, claimsBefore, 'sale without client must not issue an access claim');
    }

    await page.close();
  }
} finally {
  await browser.close();
}

assert.deepEqual(errors, []);
assert.deepEqual(unexpected, []);
console.log('PrimeTime Pro standalone sale client access UI checks passed at 390/760/1440');
