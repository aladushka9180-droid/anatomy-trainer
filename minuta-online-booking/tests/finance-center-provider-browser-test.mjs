import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'provider.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const uiSource = readFileSync(resolve(root, 'finance-center.js'), 'utf8');
const adapterSource = readFileSync(resolve(root, 'finance-center-provider.js'), 'utf8');
const playwright = await import(process.env.MINUTA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const chromium = playwright.chromium || playwright.default?.chromium;
const browser = await chromium.launch({ headless:true });
const output = process.env.MINUTA_VISUAL_OUTPUT ? resolve(process.env.MINUTA_VISUAL_OUTPUT) : '';
if (output) mkdirSync(output, { recursive:true });
const errors = [];
const unexpected = [];
const mime = { '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp', '.woff2':'font/woff2', '.json':'application/json' };
const organizationId = '11111111-1111-4111-8111-111111111111';
const categoryId = '22222222-2222-4222-8222-222222222222';
const accountId = '33333333-3333-4333-8333-333333333333';

function fixture() {
  return {
    schema:'minuta-finance-screen-v1', ledger_version:163, organization_id:organizationId, currency:'RUB', timezone:'Europe/Samara', finance_enabled:true,
    period:{ start:'2026-09-01', end:'2026-09-15', bucket_grain:'day' }, selected_performer_id:null,
    summary:{ received_minor:3660000, expense_minor:120000, net_minor:3540000, services_minor:14070000, debt_minor:0 },
    confidence:{ completed_visits:43, payment_marked_visits:11, ledger_posted_visits:0, unposted_payment_visits:11, unknown_payment_visits:32, service_value_known_visits:43, is_complete:false, result_reliable:false },
    expense_readiness:{ finance_enabled:true, has_payment_account:true, active_category_count:1, can_record:true },
    performers:[], accounts:[{ id:accountId, name:'Основная касса', account_type:'cash' }], categories:[{ id:categoryId, name:'Материалы', active:true }],
    series:[{ bucket_start:'2026-09-15', received_minor:3660000, expense_minor:120000 }],
    expense_structure:[{ category_id:categoryId, name:'Материалы', amount_minor:120000 }],
    operations:[
      { event_key:'income', kind:'income', occurred_at:'2026-09-15T08:00:00Z', amount_minor:3660000, label:'Оплата визита', entered_by_name:'Владелец' },
      { event_key:'expense', kind:'expense', occurred_at:'2026-09-14T09:00:00Z', amount_minor:-120000, label:'Материалы', category_name:'Материалы', entered_by_name:'Владелец' }
    ], has_more:false, next_cursor:null
  };
}

try {
  for (const width of [390, 760, 1440]) {
    const page = await browser.newPage({ bypassCSP:true, serviceWorkers:'block', viewport:{ width, height:940 } });
    page.on('pageerror', error => errors.push(`${width}: ${error.message}`));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'https://finance.test' || route.request().method() !== 'GET') {
        unexpected.push(`${route.request().method()} ${url.href}`);
        return route.abort();
      }
      if (url.pathname.endsWith('/provider.html')) return route.fulfill({ contentType:'text/html', body:html });
      const relative = decodeURIComponent(url.pathname.replace('/minuta-online-booking/', ''));
      if (relative.includes('..')) return route.abort();
      try { return route.fulfill({ contentType:mime[extname(relative)] || 'application/octet-stream', body:readFileSync(resolve(root, relative)) }); }
      catch { return route.abort(); }
    });
    await page.goto('https://finance.test/minuta-online-booking/provider.html', { waitUntil:'networkidle' });
    await page.addScriptTag({ content:uiSource });
    await page.addScriptTag({ content:adapterSource });
    await page.evaluate(({ organizationId }) => {
      document.documentElement.classList.remove('provider-booting');
      document.documentElement.classList.add('top-level');
      document.querySelector('#providerBoot')?.remove();
      document.querySelector('#authCard').hidden = true;
      document.querySelector('#dashboard').hidden = false;
      document.querySelectorAll('[data-provider-panel]').forEach(panel => {
        panel.hidden = panel.dataset.providerPanel !== 'analytics';
        panel.classList.toggle('active', !panel.hidden);
      });
      document.querySelector('#analyticsView').dataset.reportTab = 'money';
      document.querySelector('#reportDataSource').hidden = false;
      window.calls = [];
      const db = { rpc:async (name, args) => {
        calls.push({ name, args:structuredClone(args) });
        if (name === 'get_minuta_finance_screen_v163') return { data:structuredClone(window.fixtureData), error:null };
        return { data:null, error:{ code:'PGRST202', message:`unexpected rpc ${name}` } };
      }};
      window.controller = MinutaFinanceProvider.createController({ db, $:selector => document.querySelector(selector), notify:() => {}, requireWrites:() => true });
      controller.setOrganization({ id:organizationId, current_role:'owner' });
    }, { organizationId });
    await page.evaluate(data => { window.fixtureData = data; }, fixture());
    await page.evaluate(() => controller.load());
    await page.locator('.finance-center').waitFor({ state:'visible' });

    assert.equal(await page.locator('[data-finance-received]').innerText(), '36\u00a0600\u00a0₽');
    assert.equal(await page.locator('[data-finance-expense]').innerText(), '1\u00a0200\u00a0₽');
    assert.equal(await page.locator('[data-finance-net]').innerText(), '—', 'partial/unsynchronised result must not look exact');
    assert.equal(await page.locator('.report-filters').isHidden(), true);
    assert.equal(await page.locator('#reportDataSource').isHidden(), true);
    assert.equal(await page.locator('#moneyDashboard').isHidden(), true);
    assert.equal(await page.locator('.report-summary[data-report-section="money"]').isHidden(), true);
    const call = await page.evaluate(() => calls.find(item => item.name === 'get_minuta_finance_screen_v163'));
    assert.equal(call.args.p_organization, organizationId);
    assert.equal(call.args.p_performer, null);
    assert.equal(call.args.p_limit, 30);

    const geometry = await page.evaluate(() => {
      const center = document.querySelector('.finance-center');
      const style = getComputedStyle(center);
      return {
        overflow:document.documentElement.scrollWidth - document.documentElement.clientWidth,
        centerWidth:center.getBoundingClientRect().width,
        paddingBottom:Number.parseFloat(style.paddingBottom),
        touch:[...center.querySelectorAll('button:not([hidden]),select:not([hidden])')].filter(item => item.getBoundingClientRect().width > 0).map(item => item.getBoundingClientRect().height)
      };
    });
    assert.ok(geometry.overflow <= 1, `${width}: horizontal overflow ${geometry.overflow}`);
    assert.ok(geometry.centerWidth <= 1121, `${width}: finance center exceeds content cap`);
    assert.ok(geometry.paddingBottom >= 104, `${width}: fixed navigation clearance missing`);
    assert.ok(geometry.touch.every(value => value >= 44), `${width}: touch target below 44px`);
    if (output) await page.screenshot({ path:resolve(output, `finance-provider-${width}.png`), fullPage:true });

    if (width === 390) {
      await page.evaluate(() => controller.setOrganization({ id:'11111111-1111-4111-8111-111111111111', current_role:'specialist' }));
      assert.equal(await page.locator('#reportTabMoney').isHidden(), true);
      assert.equal(await page.locator('#financeCenterRoot').isHidden(), true);
    }
    await page.close();
  }
} finally {
  await browser.close();
}

assert.deepEqual(errors, []);
assert.deepEqual(unexpected, []);
console.log('Finance center provider integration passed at 390, 760 and 1440.');
