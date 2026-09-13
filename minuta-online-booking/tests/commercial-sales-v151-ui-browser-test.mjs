import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = process.env.MINUTA_AUDIT_SCREENSHOTS ? resolve(process.env.MINUTA_AUDIT_SCREENSHOTS) : '';
if (output) mkdirSync(output, { recursive:true });
const html = readFileSync(resolve(root, 'provider.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const source = readFileSync(resolve(root, 'commerce-management.js'), 'utf8');
const providerSource = readFileSync(resolve(root, 'provider.js'), 'utf8');
const navigation = providerSource.slice(providerSource.indexOf('function providerSectionViewKey('), providerSource.indexOf('function canUseIosTransitions('));
const features = providerSource.slice(providerSource.indexOf('const organizationFeatureDefinitions ='), providerSource.indexOf('\nbatchBookingsController =', providerSource.indexOf('const organizationFeatureDefinitions =')));
const saleEntry = providerSource.slice(providerSource.indexOf('async function openCommerceSale('), providerSource.indexOf('\nfunction calendarRangeTitle(', providerSource.indexOf('async function openCommerceSale(')));
const playwright = await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const chromium = playwright.chromium || playwright.default?.chromium;
const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
const errors = [];
const unexpected = [];
const mime = { '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp', '.woff2':'font/woff2' };
const ids = {
  organization:'11111111-1111-4111-8111-111111111151',
  owner:'22222222-2222-4222-8222-222222222151',
  seller:'33333333-3333-4333-8333-333333333151',
  client:'44444444-4444-4444-8444-444444444151',
  booking:'55555555-5555-4555-8555-555555555151',
  item:'66666666-6666-4666-8666-666666666151',
  secondItem:'66666666-6666-4666-8666-666666666152',
  warehouse:'77777777-7777-4777-8777-777777777151',
  cash:'88888888-8888-4888-8888-888888888151',
  bank:'99999999-9999-4999-8999-999999999151',
  pass:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa151',
  package:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa152',
  certificate:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa153'
};

try {
  for (const width of [390, 760, 1440]) {
    const page = await browser.newPage({ bypassCSP:true, serviceWorkers:'block', viewport:{ width, height:900 } });
    page.on('pageerror', error => errors.push(`${width}: ${error.message}`));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'https://sales.test' || route.request().method() !== 'GET') {
        unexpected.push(`${route.request().method()} ${url.href}`);
        return route.abort();
      }
      if (url.pathname.endsWith('/provider.html')) return route.fulfill({ contentType:'text/html', body:html });
      const relative = decodeURIComponent(url.pathname.replace('/minuta-online-booking/', ''));
      if (relative.includes('..')) return route.abort();
      try { return route.fulfill({ contentType:mime[extname(relative)] || 'application/octet-stream', body:readFileSync(resolve(root, relative)) }); }
      catch { return route.abort(); }
    });
    await page.goto('https://sales.test/minuta-online-booking/provider.html', { waitUntil:'networkidle' });
    await page.evaluate(() => {
      localStorage.clear();
      document.documentElement.classList.remove('provider-booting');
      document.documentElement.classList.add('top-level');
      document.querySelector('#providerBoot')?.remove();
      document.body.dataset.providerTheme = 'neutral';
      document.body.dataset.providerLayout = 'classic';
      document.querySelector('#authCard').hidden = true;
      document.querySelector('#dashboard').hidden = false;
      document.querySelectorAll('[data-provider-panel]').forEach(panel => { panel.hidden = panel.dataset.providerPanel !== 'organization'; });
      document.querySelector('#organizationWorkspace').hidden = false;
      document.querySelector('#organizationLoading').hidden = true;
      document.querySelector('#organizationRoleBadge').textContent = 'Владелец';
    });
    await page.addScriptTag({ content:source });
    await page.evaluate(async ids => {
      window.salesCalls = [];
      window.salesNotices = [];
      window.releaseSale = null;
      window.failNextWorkspaceLoad = false;
      window.workspace = {
        organization_id:ids.organization, finance_enabled:true, benefits_enabled:true, inventory_enabled:true,
        accounts:[
          { id:ids.cash, name:'Основная касса', account_type:'cash', system_key:null },
          { id:ids.bank, name:'Расчётный счёт', account_type:'bank', system_key:null }
        ],
        sellers:[
          { id:ids.owner, name:'Анна Владелец', role:'владелец' },
          { id:ids.seller, name:'Ирина Мастер', role:'специалист' }
        ],
        clients:[{ id:ids.client, name:'Тестовый клиент', phone:'+7 900 000-01-51' }],
        bookings:[{ id:ids.booking, client_account_id:ids.client, client_name:'Тестовый клиент', performer_id:ids.seller, booking_date:'2026-09-12', booking_time:'15:30:00', service_name:'Массаж' }],
        benefit_products:[
          { id:ids.pass, name:'Абонемент 5 визитов', kind:'visit_pass', sale_price_minor:450000 },
          { id:ids.package, name:'Пакет услуг', kind:'package', sale_price_minor:700000 },
          { id:ids.certificate, name:'Сертификат', kind:'certificate', sale_price_minor:1000000 }
        ],
        inventory_items:[
          { id:ids.item, name:'Крем для массажа', sku:'CREAM-151', unit:'piece' },
          { id:ids.secondItem, name:'Масло для массажа', sku:'OIL-151', unit:'piece' }
        ],
        warehouses:[{ id:ids.warehouse, name:'Основной склад' }],
        sales:[], recurring_expenses:[], audit:[]
      };
      const db = { rpc:async (name, args) => {
        salesCalls.push({ name, args:structuredClone(args) });
        if (name === 'get_minuta_commerce_workspace_v151') {
          if (failNextWorkspaceLoad) {
            failNextWorkspaceLoad = false;
            return { data:null, error:{ message:'temporary refresh error' } };
          }
          return { data:structuredClone(workspace), error:null };
        }
        if (name === 'sell_minuta_commercial_product_v151') {
          await new Promise(resolve => { releaseSale = resolve; });
          const selected = args.p_item_kind === 'benefit_product'
            ? workspace.benefit_products.find(item => item.id === args.p_benefit_product)
            : workspace.inventory_items.find(item => item.id === args.p_inventory_item);
          const sale = {
            id:crypto.randomUUID(), booking_id:args.p_booking, client_account_id:args.p_client_account,
            client_name:args.p_client_account ? 'Тестовый клиент' : null,
            seller_id:args.p_seller, seller_name:workspace.sellers.find(item => item.id === args.p_seller)?.name,
            status:'paid', payment_method:args.p_payment_method,
            total_minor:Math.round(args.p_quantity * args.p_unit_price_minor) - args.p_discount_minor,
            refunded_minor:0, occurred_at:'2026-09-12T15:00:00Z',
            line:{ item_name:selected?.name || 'Продажа', item_kind:args.p_item_kind, quantity:args.p_quantity, refunded_quantity:0, unit_price_minor:args.p_unit_price_minor }
          };
          workspace.sales.unshift(sale);
          workspace.audit.unshift({
            id:crypto.randomUUID(), action:'commercial_sale_created', subject_id:sale.id,
            created_at:sale.occurred_at, details:{ total_minor:sale.total_minor, seller_id:args.p_seller, quantity:args.p_quantity }
          });
          return { data:{ id:sale.id, organization_id:ids.organization, seller_id:args.p_seller, replayed:false }, error:null };
        }
        return { data:null, error:{ message:`unexpected rpc ${name}` } };
      }};
      Object.assign(window, { salesDb:db });
    }, ids);
    await page.addScriptTag({ content:`
      const $=selector=>document.querySelector(selector), $$=selector=>[...document.querySelectorAll(selector)];
      const providerSectionSelections=new Map(), providerSectionPresentation=new Map(), PROVIDER_SECTION_STORAGE_PREFIX='minuta-provider-subsection-v1', PROVIDER_SECTION_COMPANIONS={};
      let sectionNavigationFrame=0, currentUser={id:${JSON.stringify(ids.owner)}}, sessionGeneration=1;
      let resourceController=null,shiftController=null,payrollController=null,commerceController=null,benefitController=null,loyaltyController=null,inventoryController=null,retentionController=null;
      const organizationFeatureRequests=new Map(); let organizationFeatureContext='',organizationFeatureContextRevision=0;
      const activeOrganization={id:${JSON.stringify(ids.organization)},current_role:'owner'};
      const organizationController={getActiveOrganization:()=>activeOrganization};
      const db=window.salesDb;
      const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
      const notify=value=>salesNotices.push(value),requireWrites=()=>true,sessionIsCurrent=()=>true,applyWriteAvailability=()=>{};
      async function loadProviderFeatureScript(){window.featureLoads=(window.featureLoads||0)+1;}
      function closeBookingSheet(){window.visitEntryClosed=true;}
      function bookingSourceItems(){return window.workspace.bookings;}
      function setProviderView(view){
        document.querySelectorAll('[data-provider-panel]').forEach(panel=>{panel.hidden=panel.dataset.providerPanel!==view;});
        refreshSectionNavigation();
      }
      ${navigation}
      ${features}
      ${saleEntry}
      prepareOrganizationFeatures(activeOrganization);
      refreshSectionNavigation();
      const visitEntry=document.createElement('button');
      visitEntry.type='button';visitEntry.dataset.commerceBookingSale=${JSON.stringify(ids.booking)};visitEntry.textContent='Продать в визите';
      visitEntry.addEventListener('click',()=>void openCommerceSaleFromBooking(visitEntry.dataset.commerceBookingSale));
      document.querySelector('#bookingSheet').append(visitEntry);
      visitEntry.click();
      window.waitForCommerce=()=>commerceController;
    ` });
    await page.waitForFunction(() => Boolean(window.waitForCommerce?.()));
    await page.evaluate(() => { window.salesController=window.waitForCommerce(); });

    await page.locator('#commerceSaleCreator').waitFor({ state:'visible' });
    assert.equal(await page.evaluate(() => featureLoads), 1, 'commerce loads once through the real lazy feature loader');
    assert.equal(await page.evaluate(() => visitEntryClosed), true, 'visit sale entry closes the booking sheet');
    assert.equal(await page.locator('#organizationSectionSelect').inputValue(), 'commercePanel', 'mobile section selector follows the sale target');
    assert.equal(await page.locator('[data-section-target="commercePanel"]').getAttribute('aria-current'), 'location', 'desktop sales navigation is selected');
    await page.waitForTimeout(50);
    const selectedNavigation = await page.locator('[data-section-target="commercePanel"]').evaluate(element => {
      const rect=element.getBoundingClientRect(), nav=element.closest('nav').getBoundingClientRect();
      return { visible:getComputedStyle(element).display!=='none', left:rect.left, right:rect.right, navLeft:nav.left, navRight:nav.right };
    });
    assert.ok(selectedNavigation.visible && selectedNavigation.left >= selectedNavigation.navLeft - 1 && selectedNavigation.right <= selectedNavigation.navRight + 1, `${width}: selected sales navigation target stays visible`);
    assert.equal(await page.locator('#commerceSaleCreator').getAttribute('open'), '');
    assert.equal(await page.locator('#commerceClient').inputValue(), ids.client);
    assert.equal(await page.locator('#commerceBooking').inputValue(), ids.booking);
    assert.equal(await page.locator('#commerceSeller').inputValue(), ids.seller, 'visit seller defaults to its performer');
    assert.equal(await page.locator('#commerceSaleOptions').getAttribute('open'), null, 'secondary operation details stay compact by default');
    if (width <= 760) assert.equal(await page.locator('.provider-mobile-nav').isVisible(), false, 'sale focus mode hides the mobile navigation');
    if (width > 760) assert.equal(await page.locator('#organizationSectionNav').evaluate(element => getComputedStyle(element).position), 'static', 'organization navigation must not cover the active sale');
    assert.deepEqual(await page.locator('#commercePaymentAccount option').allTextContents(), ['Основная касса'], 'cash payment must only offer a cash account');
    const firstAction = await page.locator('#commerceSaleSubmit').evaluate(element => { const rect=element.getBoundingClientRect(); return { top:rect.top,bottom:rect.bottom }; });
    assert.ok(firstAction.top >= 0 && firstAction.bottom <= 900, `${width}: primary sale action must be in the first 900px viewport`);
    if (width === 390) {
      const summary = await page.locator('#commerceSaleOptionsSummary').evaluate(element => ({ clientHeight:element.clientHeight, scrollHeight:element.scrollHeight, text:element.innerText }));
      assert.match(summary.text, /Основной склад[\s\S]*Ирина Мастер[\s\S]*наличные/i);
      assert.ok(summary.scrollHeight <= summary.clientHeight + 1, '390: compact operation summary must be fully visible');
    }
    if (output) await page.screenshot({ path:resolve(output, `sale-compact-${width}.png`), fullPage:true });
    await page.locator('#commerceSaleOptions summary').click();
    assert.equal(await page.locator('#commerceSaleOptions').getAttribute('open'), '');
    await page.locator('#commerceItemKind').selectOption('benefit_product');
    assert.deepEqual(await page.locator('#commerceItem option').allTextContents(), [
      'Абонемент 5 визитов · абонемент', 'Пакет услуг · пакет', 'Сертификат · сертификат'
    ]);
    assert.equal(await page.locator('#commerceQuantity').isDisabled(), true);
    await page.locator('#commerceItemKind').selectOption('inventory_item');
    await page.locator('#commerceItem').selectOption(ids.secondItem);
    assert.equal(await page.locator('#commerceItem').inputValue(), ids.secondItem, 'selecting another sale item must not snap back to the first');
    await page.locator('#commerceUnitPrice').fill('500');
    await page.locator('#commerceQuantity').fill('2');
    await page.locator('#commerceDiscount').fill('100');
    assert.equal(await page.locator('#commerceSaleTotal').innerText(), '900 ₽');
    assert.equal(await page.locator('#commerceSaleSubmit').isEnabled(), true);
    assert.equal(await page.locator('#commerceSaleSubmit').isVisible(), true);

    const layout = await page.evaluate(() => ({
      overflow:document.documentElement.scrollWidth - document.documentElement.clientWidth,
      form:document.querySelector('#commerceSaleForm').getBoundingClientRect(),
      controls:[...document.querySelectorAll('#commerceSaleForm input,#commerceSaleForm select,#commerceSaleForm button')]
        .map(item => item.getBoundingClientRect()).filter(rect => rect.width > 0).map(rect => ({ width:rect.width, height:rect.height })),
      submit:(() => { const element = document.querySelector('#commerceSaleSubmit'); const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return { width:rect.width, height:rect.height, display:style.display, visibility:style.visibility, opacity:Number(style.opacity), background:style.backgroundColor }; })()
    }));
    assert.ok(layout.overflow <= 1, `${width}: horizontal overflow ${layout.overflow}`);
    assert.ok(layout.form.width > 0 && layout.form.width <= width, `${width}: sale form width`);
    assert.ok(layout.submit.width > 0 && layout.submit.height >= 43 && layout.submit.display !== 'none' && layout.submit.visibility !== 'hidden' && layout.submit.opacity >= .4, `${width}: sale submit must stay visible`);
    assert.notEqual(layout.submit.background, 'rgba(0, 0, 0, 0)', `${width}: sale submit must keep a visible background`);
    if (width <= 760) assert.ok(layout.controls.every(rect => rect.height >= 40), `${width}: controls must remain touchable`);
    if (output) await page.screenshot({ path:resolve(output, `sale-${width}.png`), fullPage:true });

    if (width === 390) {
      await page.evaluate(() => {
        const form = document.querySelector('#commerceSaleForm');
        form.dispatchEvent(new Event('submit', { bubbles:true, cancelable:true }));
        form.dispatchEvent(new Event('submit', { bubbles:true, cancelable:true }));
      });
      await page.waitForFunction(() => salesCalls.filter(call => call.name === 'sell_minuta_commercial_product_v151').length === 1);
      assert.equal(await page.locator('#commerceSaleSubmit').isDisabled(), true, 'pending sale must stay disabled');
      assert.equal(await page.evaluate(() => salesCalls.filter(call => call.name === 'sell_minuta_commercial_product_v151').length), 1, 'rapid duplicate submit must send one RPC');
      await page.evaluate(() => releaseSale());
      await page.waitForFunction(() => workspace.sales.length === 1);
      const call = await page.evaluate(() => salesCalls.find(item => item.name === 'sell_minuta_commercial_product_v151'));
      assert.equal(call.args.p_seller, ids.seller);
      assert.equal(call.args.p_booking, ids.booking);
      assert.equal(call.args.p_quantity, 2);
      assert.equal(call.args.p_unit_price_minor, 50000);
      assert.equal(call.args.p_discount_minor, 10000);
      assert.equal(call.args.p_payment_method, 'cash');
      assert.match(await page.locator('#commerceSalesList').innerText(), /Продавец: Ирина Мастер/);
      await page.locator('.commerce-audit summary').click();
      assert.match(await page.locator('#commerceAuditList').innerText(), /Продажа проведена[\s\S]*Продавец: Ирина Мастер[\s\S]*900 ₽/);
      assert.equal(await page.locator('#commerceAuditCount').innerText(), '1');
      assert.equal(await page.locator('#commerceGross').innerText(), '900 ₽');
      await page.waitForFunction(() => !document.querySelector('#commerceSaleCreator').open);

      await page.evaluate(() => salesController.startSale());
      await page.locator('#commerceClient').selectOption('');
      await page.locator('#commerceBooking').selectOption('');
      await page.locator('#commerceSeller').selectOption(ids.owner);
      await page.locator('#commercePaymentMethod').selectOption('manual');
      assert.deepEqual(await page.locator('#commercePaymentAccount option').allTextContents(), ['Основная касса', 'Расчётный счёт']);
      await page.locator('#commercePaymentAccount').selectOption(ids.bank);
      await page.locator('#commerceUnitPrice').fill('250');
      await page.locator('#commerceQuantity').fill('1');
      await page.locator('#commerceDiscount').fill('0');
      assert.equal(await page.locator('#commerceSaleSubmit').isEnabled(), true);
      await page.locator('#commerceSaleSubmit').click();
      await page.waitForFunction(() => salesCalls.filter(call => call.name === 'sell_minuta_commercial_product_v151').length === 2);
      await page.evaluate(() => releaseSale());
      await page.waitForFunction(() => workspace.sales.length === 2);
      const standalone = await page.evaluate(() => salesCalls.filter(call => call.name === 'sell_minuta_commercial_product_v151')[1]);
      assert.equal(standalone.args.p_booking, null);
      assert.equal(standalone.args.p_client_account, null);
      assert.equal(standalone.args.p_seller, ids.owner);
      assert.equal(standalone.args.p_payment_method, 'manual');
      assert.equal(standalone.args.p_payment_account, ids.bank);

      await page.evaluate(() => salesController.startSale());
      await page.locator('#commerceClient').selectOption('');
      await page.locator('#commerceBooking').selectOption('');
      await page.locator('#commerceSeller').selectOption(ids.owner);
      await page.locator('#commercePaymentMethod').selectOption('cash');
      await page.locator('#commercePaymentAccount').selectOption(ids.cash);
      await page.locator('#commerceUnitPrice').fill('300');
      await page.locator('#commerceQuantity').fill('1');
      await page.evaluate(() => { failNextWorkspaceLoad = true; });
      await page.locator('#commerceSaleSubmit').click();
      await page.waitForFunction(() => salesCalls.filter(call => call.name === 'sell_minuta_commercial_product_v151').length === 3);
      await page.evaluate(() => releaseSale());
      await page.waitForFunction(() => salesNotices.some(message => message.includes('Продажа проведена. Список обновится')));
      assert.equal(await page.locator('#commerceSaleError').isHidden(), true, 'confirmed sale must not be reported as failed when refresh fails');
      assert.equal(await page.locator('#commerceSaleCreator').getAttribute('open'), null, 'confirmed sale closes the form after a refresh failure');
      assert.equal(await page.evaluate(() => salesCalls.filter(call => call.name === 'sell_minuta_commercial_product_v151').length), 3, 'refresh failure must not repeat the sale RPC');
    }
    if (width === 760) {
      await page.locator('#commerceItemKind').selectOption('benefit_product');
      await page.locator('#commerceItem').selectOption(ids.certificate);
      assert.equal(await page.locator('#commerceQuantityField').isVisible(), false);
      assert.equal(await page.locator('#commerceWarehouseField').isVisible(), false);
      assert.equal(await page.locator('#commerceQuantity').isDisabled(), true);
      assert.equal(await page.locator('#commerceUnitPrice').inputValue(), '10000');
      await page.locator('#commerceDiscount').fill('500');
      assert.equal(await page.locator('#commerceSaleTotal').innerText(), '9 500 ₽');
      await page.locator('#commerceSaleSubmit').click();
      await page.waitForFunction(() => salesCalls.filter(call => call.name === 'sell_minuta_commercial_product_v151').length === 1);
      await page.evaluate(() => releaseSale());
      await page.waitForFunction(() => workspace.sales.length === 1);
      const benefitCall = await page.evaluate(() => salesCalls.find(item => item.name === 'sell_minuta_commercial_product_v151'));
      assert.equal(benefitCall.args.p_item_kind, 'benefit_product');
      assert.equal(benefitCall.args.p_benefit_product, ids.certificate);
      assert.equal(benefitCall.args.p_inventory_item, null);
      assert.equal(benefitCall.args.p_warehouse, null);
      assert.equal(benefitCall.args.p_quantity, 1);
      assert.equal(benefitCall.args.p_client_account, ids.client);
    }
    if (width <= 760) assert.equal(await page.locator('.provider-mobile-nav').isVisible(), true, 'mobile navigation returns after the sale closes');
    assert.equal(await page.locator('#commerceRecurring').getAttribute('open'), null, 'recurring expenses stay collapsed by default');
    await page.close();
  }
} finally {
  await browser.close();
}

assert.deepEqual(errors, []);
assert.deepEqual(unexpected, []);
console.log('PrimeTime Pro commercial sales v151 browser checks passed at 390, 760 and 1440');
