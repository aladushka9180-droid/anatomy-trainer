import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, '.tmp-commerce-v147');
mkdirSync(output, { recursive:true });
const html = readFileSync(resolve(root, 'provider.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const source = readFileSync(resolve(root, 'commerce-management.js'), 'utf8');
const playwright = await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const chromium = playwright.chromium || playwright.default?.chromium;
const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
const errors = [];
const unexpected = [];
const mime = { '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp', '.woff2':'font/woff2' };
const organizationId = '11111111-1111-4111-8111-111111111111';
const clientId = '22222222-2222-4222-8222-222222222222';
const productId = '33333333-3333-4333-8333-333333333333';
const accountId = '44444444-4444-4444-8444-444444444444';
const expenseId = '55555555-5555-4555-8555-555555555555';

try {
  for (const width of [390, 760, 1440]) {
    const page = await browser.newPage({ bypassCSP:true, serviceWorkers:'block', viewport:{ width, height:900 } });
    page.on('pageerror', error => errors.push(`${width}: ${error.message}`));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'https://commerce.test' || route.request().method() !== 'GET') {
        unexpected.push(`${route.request().method()} ${url.href}`);
        return route.abort();
      }
      if (url.pathname.endsWith('/provider.html')) return route.fulfill({ contentType:'text/html', body:html });
      const relative = decodeURIComponent(url.pathname.replace('/minuta-online-booking/', ''));
      if (relative.includes('..')) return route.abort();
      try { return route.fulfill({ contentType:mime[extname(relative)] || 'application/octet-stream', body:readFileSync(resolve(root, relative)) }); }
      catch { return route.abort(); }
    });
    await page.goto('https://commerce.test/minuta-online-booking/provider.html', { waitUntil:'networkidle' });
    await page.evaluate(() => {
      localStorage.clear();
      document.documentElement.classList.remove('provider-booting');
      document.documentElement.classList.add('top-level');
      document.querySelector('#providerBoot')?.remove();
      document.body.dataset.providerTheme = 'neutral';
      document.body.dataset.providerLayout = 'classic';
      document.querySelector('#authCard').hidden = true;
      document.querySelector('#dashboard').hidden = false;
      document.querySelectorAll('[data-provider-panel]').forEach(panel => {
        panel.hidden = panel.dataset.providerPanel !== 'organization';
        panel.classList.toggle('active', !panel.hidden);
      });
      document.querySelector('#organizationWorkspace').hidden = false;
      document.querySelectorAll('[data-provider-panel="organization"] .provider-section-anchor').forEach(panel => { panel.hidden = panel.id !== 'commercePanel'; });
      document.querySelector('#commercePanel').hidden = false;
    });
    await page.addScriptTag({ content:source });
    await page.evaluate(async ({ organizationId, clientId, productId, accountId, expenseId }) => {
      window.commerceCalls = [];
      window.commerceNotices = [];
      window.saleAttempts = 0;
      window.workspace = {
        organization_id:organizationId, finance_enabled:true, benefits_enabled:true, inventory_enabled:true,
        accounts:[
          { id:accountId, name:'Основная касса', account_type:'cash', system_key:null },
          { id:expenseId, name:'Операционные расходы', account_type:'operating_expense', system_key:'operating_expense' }
        ],
        clients:[{ id:clientId, name:'Тестовый клиент', phone:'+7 900 000-00-00' }],
        bookings:[{ id:'66666666-6666-4666-8666-666666666666', client_account_id:clientId, client_name:'Тестовый клиент', booking_date:'2026-09-12', booking_time:'15:30:00', service_name:'Массаж' }],
        benefit_products:[{ id:productId, name:'Пакет 5 визитов', kind:'package', sale_price_minor:500000 }],
        inventory_items:[], warehouses:[], sales:[], recurring_expenses:[], audit:[]
      };
      const db = { rpc:async (name, args) => {
        commerceCalls.push({ name, args:structuredClone(args) });
        if (name === 'get_minuta_commerce_workspace_v147') return { data:structuredClone(workspace), error:null };
        if (name === 'sell_minuta_commercial_product_v147') {
          saleAttempts += 1;
          if (saleAttempts === 1) return { data:null, error:{ message:'temporary network error' } };
          workspace.sales = [{ id:'77777777-7777-4777-8777-777777777777', booking_id:args.p_booking, client_account_id:args.p_client_account, status:'paid', payment_method:args.p_payment_method, total_minor:args.p_unit_price_minor, refunded_minor:0, occurred_at:'2026-09-12T12:00:00Z', line:{ item_name:'Пакет 5 визитов', item_kind:'benefit_product', quantity:1, refunded_quantity:0, unit_price_minor:args.p_unit_price_minor } }];
          return { data:{ id:workspace.sales[0].id, organization_id:organizationId, replayed:false }, error:null };
        }
        if (name === 'refund_minuta_commercial_sale_v147') {
          const sale = workspace.sales.find(item => item.id === args.p_sale);
          sale.refunded_minor += args.p_amount_minor;
          sale.line.refunded_quantity += args.p_quantity;
          sale.status = sale.refunded_minor === sale.total_minor ? 'refunded' : 'partially_refunded';
          return { data:{ id:'88888888-8888-4888-8888-888888888888', organization_id:organizationId, replayed:false }, error:null };
        }
        if (name === 'create_minuta_recurring_expense_v147') {
          workspace.recurring_expenses = [{ id:'99999999-9999-4999-8999-999999999999', name:args.p_name, supplier_name:args.p_supplier_name, amount_minor:args.p_amount_minor, day_of_month:args.p_day_of_month, active:true, last_occurred_on:null }];
          return { data:{ id:workspace.recurring_expenses[0].id, organization_id:organizationId, replayed:false }, error:null };
        }
        if (name === 'record_minuta_recurring_expense_v147') {
          workspace.recurring_expenses[0].last_occurred_on = args.p_occurred_on;
          return { data:{ id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', organization_id:organizationId, replayed:false }, error:null };
        }
        if (name === 'get_minuta_money_dashboard_v147') return { data:{ organization_id:organizationId, income_minor:500000, expense_minor:120000, expense_structure:[{ name:'Аренда', amount_minor:120000 }], recent_operations:[{ id:'1', operation_type:'commercial_sale', occurred_at:'2026-09-12T12:00:00Z', amount_minor:500000 }] }, error:null };
        if (name === 'set_minuta_finance_enabled_v133') return { data:{ organization_id:organizationId, enabled:args.p_enabled }, error:null };
        return { data:null, error:{ message:`unexpected rpc ${name}` } };
      }};
      const common = {
        db, $:selector => document.querySelector(selector),
        escapeHtml:value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]),
        notify:value => commerceNotices.push(value), requireWrites:() => true,
        getCurrentUser:() => ({ id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }), getSessionGeneration:() => 1,
        sessionIsCurrent:() => true, applyWriteAvailability:() => {}
      };
      window.commerceController = MinutaCommerce.createController(common);
      commerceController.bind();
      await commerceController.setOrganization({ id:organizationId, current_role:'owner' });
      window.financeController = MinutaCommerce.createFinanceController(common);
      financeController.setOrganization({ id:organizationId, current_role:'owner' });
      await financeController.load({ start:'2026-09-01', end:'2026-09-30' });
    }, { organizationId, clientId, productId, accountId, expenseId });
    await page.locator('#commerceWorkspace').waitFor({ state:'attached' });
    assert.equal(await page.locator('#moneyProfit').innerText(), '3 800 ₽');
    assert.equal(await page.locator('#commerceRefundEmpty').innerText(), 'Возврат станет доступен после первой продажи.');
    assert.equal(await page.locator('#commerceRefundCreator').isHidden(), true);
    assert.equal(await page.locator('#commerceRefundSubmit').isDisabled(), true);

    if (width === 390) {
      await page.locator('#commerceSaleCreator > summary').click();
      await page.locator('#commerceItemKind').selectOption('benefit_product');
      await page.locator('#commerceClient').selectOption(clientId);
      await page.locator('#commerceBooking').selectOption('66666666-6666-4666-8666-666666666666');
      await page.locator('#commerceSaleForm button[type="submit"]').click();
      await page.locator('#commerceSaleError').waitFor({ state:'visible' });
      await page.locator('#commerceSaleForm button[type="submit"]').click();
      await page.waitForFunction(() => window.workspace.sales.length === 1);
      const saleRequests = await page.evaluate(() => commerceCalls.filter(item => item.name === 'sell_minuta_commercial_product_v147').map(item => item.args.p_request_id));
      assert.equal(saleRequests.length, 2);
      assert.equal(saleRequests[0], saleRequests[1], 'uncertain retry must reuse the request id');
      assert.equal(await page.locator('#commerceGross').innerText(), '5 000 ₽');
      assert.equal(await page.locator('#commerceRefundCreator').isVisible(), true);
      assert.equal(await page.locator('#commerceRefundSale option').count(), 2);

      await page.locator('[data-commerce-refund]').click();
      assert.equal(await page.locator('#commerceRefundSale').inputValue(), '77777777-7777-4777-8777-777777777777');
      assert.equal(await page.locator('#commerceRefundQuantity').inputValue(), '1');
      assert.equal(await page.locator('#commerceRefundAmount').inputValue(), '5000');
      assert.equal(await page.locator('#commerceRefundAmount').getAttribute('readonly'), '');
      assert.equal(await page.locator('#commerceRefundQuantity').getAttribute('readonly'), '');
      assert.equal(await page.locator('#commerceRefundSubmit').isDisabled(), true);
      await page.screenshot({ path:resolve(output, 'refund-390.png'), fullPage:true });
      await page.locator('#commerceRefundReason').fill('Возврат по просьбе клиента');
      assert.equal(await page.locator('#commerceRefundSubmit').isEnabled(), true);
      await page.locator('#commerceRefundSubmit').click();
      await page.waitForFunction(() => window.workspace.sales[0].status === 'refunded');
      assert.equal(await page.locator('#commerceNet').innerText(), '0 ₽');
      assert.equal(await page.locator('#commerceRefundCreator').isHidden(), true);
      assert.equal(await page.locator('#commerceRefundEmpty').innerText(), 'Все продажи полностью возвращены.');

      await page.evaluate(async () => {
        workspace.sales.push({ id:'77777777-7777-4777-8777-777777777778', booking_id:null, client_account_id:null, status:'paid', payment_method:'cash', total_minor:100000, refunded_minor:0, occurred_at:'2026-09-12T13:00:00Z', line:{ item_name:'Крем', item_kind:'inventory_item', quantity:2, refunded_quantity:0, unit_price_minor:50000 } });
        await commerceController.load();
      });
      await page.locator('[data-commerce-refund="77777777-7777-4777-8777-777777777778"]').click();
      assert.equal(await page.locator('#commerceRefundQuantity').getAttribute('readonly'), null);
      await page.locator('#commerceRefundQuantity').fill('1');
      assert.equal(await page.locator('#commerceRefundAmount').inputValue(), '500');
      await page.locator('#commerceRefundReason').fill('Частичный возврат товара');
      assert.equal(await page.locator('#commerceRefundSubmit').isEnabled(), true);
      await page.locator('#commerceRefundSubmit').click();
      await page.waitForFunction(() => window.workspace.sales.find(item => item.id.endsWith('778')).status === 'partially_refunded');
      assert.equal(await page.locator('[data-commerce-refund="77777777-7777-4777-8777-777777777778"]').isVisible(), true);
      await page.evaluate(async () => {
        workspace.sales.push({ id:'77777777-7777-4777-8777-777777777779', booking_id:null, client_account_id:null, status:'paid', payment_method:'cash', total_minor:1334, refunded_minor:0, occurred_at:'2026-09-12T14:00:00Z', line:{ item_name:'Пробник', item_kind:'inventory_item', quantity:0.004, refunded_quantity:0, unit_price_minor:333500 } });
        await commerceController.load();
      });
      await page.locator('[data-commerce-refund="77777777-7777-4777-8777-777777777779"]').click();
      await page.locator('#commerceRefundQuantity').fill('0.003');
      assert.equal(await page.locator('#commerceRefundAmount').inputValue(), '10.01', 'browser rounding must match PostgreSQL numeric round');
      await page.evaluate(async () => {
        workspace.sales.push({ id:'77777777-7777-4777-8777-777777777780', booking_id:null, client_account_id:null, status:'paid', payment_method:'cash', total_minor:1, refunded_minor:0, occurred_at:'2026-09-12T15:00:00Z', line:{ item_name:'Микропробник', item_kind:'inventory_item', quantity:0.5, refunded_quantity:0, unit_price_minor:2 } });
        await commerceController.load();
      });
      await page.locator('[data-commerce-refund="77777777-7777-4777-8777-777777777780"]').click();
      await page.locator('#commerceRefundQuantity').fill('0.25');
      assert.equal(await page.locator('#commerceRefundAmount').inputValue(), '');
      assert.equal(await page.locator('#commerceRefundSubmit').isDisabled(), true, 'partial refund cannot consume the final kopeck before the final quantity');

      await page.locator('#commerceRecurringForm').locator('xpath=..').locator('summary').click();
      await page.locator('#commerceRecurringSupplier').fill('Арендодатель');
      await page.locator('#commerceRecurringAmount').fill('1200');
      await page.locator('#commerceRecurringForm button[type="submit"]').click();
      await page.waitForFunction(() => window.workspace.recurring_expenses.length === 1);
      await page.locator('[data-commerce-record-expense]').click();
      await page.waitForFunction(() => Boolean(window.workspace.recurring_expenses[0].last_occurred_on));
    }

    const layout = await page.evaluate(() => ({
      overflow:document.documentElement.scrollWidth - document.documentElement.clientWidth,
      commerceWidth:document.querySelector('#commercePanel').getBoundingClientRect().width,
      buttonHeights:[...document.querySelectorAll('#commercePanel button:not([hidden])')].map(item => item.getBoundingClientRect()).filter(rect => rect.width > 0).map(rect => rect.height)
    }));
    assert.ok(layout.overflow <= 1, `${width}: horizontal overflow ${layout.overflow}`);
    assert.ok(layout.commerceWidth > 0, `${width}: commerce panel must be visible`);
    if (width <= 760) assert.ok(layout.buttonHeights.every(height => height >= 40), `${width}: commerce buttons must remain touchable`);
    await page.screenshot({ path:resolve(output, `${width}.png`), fullPage:true });
    await page.evaluate(() => {
      document.querySelectorAll('[data-provider-panel]').forEach(panel => {
        panel.hidden = panel.dataset.providerPanel !== 'analytics';
        panel.classList.toggle('active', !panel.hidden);
      });
      document.querySelector('[data-provider-panel="analytics"]').dataset.reportTab = 'money';
    });
    await page.locator('#moneyDashboardWorkspace').waitFor({ state:'visible' });
    const moneyOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(moneyOverflow <= 1, `${width}: money dashboard horizontal overflow ${moneyOverflow}`);
    await page.screenshot({ path:resolve(output, `money-${width}.png`), fullPage:true });
    await page.close();
  }
} finally {
  await browser.close();
}

assert.deepEqual(errors, []);
assert.deepEqual(unexpected, []);
console.log('PrimeTime Pro commercial finance browser checks passed at 390, 760 and 1440');
