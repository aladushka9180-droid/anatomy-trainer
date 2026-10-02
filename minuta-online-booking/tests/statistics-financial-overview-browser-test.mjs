import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFileSync(resolve(root, name), 'utf8');
const html = read('provider.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
const output = process.env.MINUTA_VISUAL_OUTPUT || '';
if (output) mkdirSync(output, { recursive:true });
const errors = [], unexpected = [];
try {
  for (const width of [390, 760, 1440]) {
    const page = await browser.newPage({ viewport:{ width, height:940 }, serviceWorkers:'block', bypassCSP:true });
    page.on('pageerror', e => errors.push(`${width}: ${e.message}`));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'https://statistics.test' || route.request().method() !== 'GET') { unexpected.push(url.href); return route.abort(); }
      if (url.pathname.endsWith('provider.html')) return route.fulfill({ contentType:'text/html', body:html });
      const name = decodeURIComponent(url.pathname.replace('/minuta-online-booking/', ''));
      if (name.includes('..')) return route.abort();
      try { return route.fulfill({ contentType:({ '.css':'text/css', '.svg':'image/svg+xml', '.woff2':'font/woff2' })[extname(name)] || 'application/octet-stream', body:readFileSync(resolve(root, name)) }); }
      catch { return route.abort(); }
    });
    await page.goto('https://statistics.test/minuta-online-booking/provider.html', { waitUntil:'networkidle' });
    await page.addStyleTag({ content:read('statistics-audit-ui.css') });
    for (const name of ['finance-center.js', 'finance-center-provider.js', 'statistics-audit-ui.js']) await page.addScriptTag({ content:read(name) });
    await page.addScriptTag({ content:`
      let sessionGeneration=1, reportScopedBookingsState={status:'ready',rows:[]}, reportDataSource='own', reportPeriod='month';
      let reportPerformerFilter='all', importedBookingHistory=[], allBookings=[];
      let fixtureRows=[], fixtureMode='empty';
      function reportRange(){return {start:'2026-10-01',end:'2026-10-02',period:reportPeriod};}
      function reportUsesScopedBookings(){return false;}
      function reportOrganizationId(){return '11111111-1111-4111-8111-111111111111';}
      function reportOrganization(){return {id:reportOrganizationId(),name:'Тест',current_role:'owner',locations:[]};}
      function reportPerformerName(){return 'Вся команда';}
      function reportCompletedItems(rows){return rows;}
      function reportBookings(){return fixtureRows;}
      function reportClientIdentity(row){return row.id;}
      function isScheduleBlock(){return false;}
      function reportDateText(v,opts){return new Date(v+'T12:00:00').toLocaleDateString('ru-RU',opts);}
      function setReportText(selector,value){const node=document.querySelector(selector);if(node)node.textContent=value;}
      function renderAnalytics(){document.querySelector('#analyticsView').dataset.reportLoadState='ready';setReportText('#reportDataQuality','100%');setReportText('#reportPeriodLabel','1 — 2 октября 2026 · Вся команда');document.querySelectorAll('[data-report-period]').forEach(button=>button.classList.toggle('active',button.dataset.reportPeriod===reportPeriod));MinutaStatisticsAuditProvider?.refresh();}
      const db={ rpc:async(name,args)=>{if(args.p_performer==='all')throw Error('all is not a performer ID');return {error:null,data:{schema:'minuta-finance-screen-v1',ledger_version:163,organization_id:reportOrganizationId(),currency:'RUB',timezone:'Europe/Samara',
        finance_enabled:fixtureMode==='full',period:{start:args.p_start,end:args.p_end,bucket_grain:'day'},selected_performer_id:args.p_performer,
        summary:{received_minor:fixtureMode==='full'?200000:0,expense_minor:fixtureMode==='full'?1000000:0,services_minor:0,debt_minor:0},confidence:{is_complete:true,result_reliable:true},
        categories:[{id:'22222222-2222-4222-8222-222222222222',system_key:'rent',name:'Аренда',active:true}],performers:[],accounts:[],expense_structure:[],series:[],operations:[]}};},
        from(table){const query={select(){return query;},eq(){return query;},gte(){return query;},lt(){return query;},in(){return query;},order(){return query;},async range(start,end){
          const cash=(amount)=>({side:amount<0?'credit':'debit',amount_minor:Math.abs(amount),financial_accounts:{account_class:'asset',account_type:'cash'}});
          const rows=fixtureMode!=='full'?[]:table==='financial_transactions'?[
            {id:'one',operation_type:'commercial_sale',occurred_at:'2026-10-02T09:00:00Z',financial_postings:[cash(200000)]},
            {id:'rent',operation_type:'supplier_expense_payment',source_id:'source-rent',occurred_at:'2026-10-01T09:00:00Z',financial_postings:[cash(-1000000)]}
          ]:table==='financial_manual_expenses_v163'?[{expense_source_id:'source-rent',category_id:'22222222-2222-4222-8222-222222222222',category_name_snapshot:'Аренда'}]:table==='commercial_sales'?[
            {id:'sale',occurred_at:'2026-10-02T09:00:00Z',commercial_sale_lines:[{item_kind:'inventory_item',item_name:'Крем',quantity:2,total_minor:200000}]}]:[];
          return {error:null,data:rows.slice(start,end+1)};
        }};return query;}
      };
      let financeController=MinutaFinanceProvider.createController({db,$:selector=>document.querySelector(selector),notify:()=>{},requireWrites:()=>false});
      document.documentElement.classList.remove('provider-booting');document.documentElement.classList.add('top-level');
      document.querySelector('#providerBoot')?.remove();document.querySelector('#authCard').hidden=true;document.querySelector('#dashboard').hidden=false;
      document.querySelector('#dashboard').dataset.activeView='analytics';
      document.querySelectorAll('[data-provider-panel]').forEach(panel=>{panel.hidden=panel.dataset.providerPanel!=='analytics';panel.classList.toggle('active',!panel.hidden);});
      document.querySelector('#analyticsView').dataset.reportTab='overview';document.querySelector('#analyticsView').dataset.reportSource='own';
      document.body.dataset.providerTheme='pink-porcelain';document.body.dataset.providerLayout='soft';
      for(const [name,value] of Object.entries({'--theme-bg':'#fff5f8','--theme-surface':'#ffffff','--theme-surface-alt':'#ffe8f0','--theme-ink':'#302b31','--theme-muted':'#625c64','--theme-line':'#e9cbd6','--theme-accent':'#c43372','--theme-accent-soft':'#ffe8f0','--theme-accent-contrast':'#ffffff'}))document.body.style.setProperty(name,value);
      financeController.setOrganization(reportOrganization());
      document.querySelectorAll('[data-report-view]').forEach(button=>button.addEventListener('click',()=>{document.querySelector('#analyticsView').dataset.reportTab=button.dataset.reportView;document.querySelectorAll('[data-report-view]').forEach(tab=>{tab.classList.toggle('active',tab===button);tab.toggleAttribute('aria-current',tab===button);});}));
    ` });
    await page.addScriptTag({ content:read('statistics-audit-provider.js') });
    await page.waitForFunction(() => document.querySelector('#reportFinanceOverview [data-finance-received]')?.textContent === '0\u00a0₽');
    assert.equal(await page.locator('#reportFinanceOverview [data-finance-expense]').innerText(), '—', 'unconnected expenses are not zero');
    assert.equal(await page.locator('#reportFinanceOverview [data-finance-goods]').innerText(), '0 шт.', 'complete empty goods read is zero');
    await page.getByText('Как считаются показатели и насколько полны данные', { exact:true }).click();
    assert.equal(await page.locator('#reportDataQuality').innerText(), 'Нет данных');
    await page.getByText('Как считаются показатели и насколько полны данные', { exact:true }).click();
    const geometry = await page.evaluate(() => {
      const overview = document.querySelector('#reportFinanceOverview');
      return { overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
        cardBottom:overview.querySelector('[data-finance-goods]').getBoundingClientRect().bottom,
        commandTop:document.querySelector('#reportVisitOverview').getBoundingClientRect().top,
        cards:[...overview.querySelectorAll('[data-finance-detail]')].map(node=>node.getBoundingClientRect().height) };
    });
    assert.ok(geometry.overflow <= 1, `${width}: overflow`);
    assert.ok(geometry.cardBottom < geometry.commandTop, 'financial amounts precede visits and goals');
    assert.ok(geometry.cards.every(height=>height>=44), 'summary actions meet touch size');
    await page.evaluate(() => window.scrollTo(0,100));
    const before = await page.evaluate(() => ({ scroll:scrollY, period:financeController ? document.querySelector('#reportPeriodLabel').textContent : '' }));
    await page.locator('#reportFinanceOverview [data-finance-detail="profit"]').click();
    await page.locator('[data-finance-detail-dialog]').waitFor({ state:'visible' });
    assert.match(await page.locator('[data-finance-detail-body]').innerText(), /себестоимости/);
    await page.locator('[data-finance-detail-close]').click();
    assert.deepEqual(await page.evaluate(() => ({ scroll:scrollY, period:document.querySelector('#reportPeriodLabel').textContent })), before, 'close preserves period and scroll');
    assert.equal(await page.locator('#reportFinanceOverview [data-finance-detail="profit"]').evaluate(node=>node===document.activeElement), true, 'return focus to originating amount');
    await page.evaluate(async()=>{fixtureMode='full';await financeController.load(reportRange(),{shared:true,force:true,masterId:reportPerformerFilter});});
    assert.equal(await page.locator('#reportFinanceOverview [data-finance-received]').innerText(), '2\u00a0000\u00a0₽');
    assert.equal(await page.locator('#reportFinanceOverview [data-finance-expense]').innerText(), '10\u00a0000\u00a0₽');
    assert.equal(await page.locator('#reportFinanceOverview [data-finance-rent]').innerText(), '10\u00a0000\u00a0₽');
    assert.equal(await page.locator('#reportFinanceOverview [data-finance-profit]').innerText(), '—', 'profit still requires cost completeness');
    await page.locator('#reportFinanceOverview [data-finance-detail="rent"]').click();
    assert.match(await page.locator('[data-finance-detail-body]').innerText(), /уже включена/);
    assert.match(await page.locator('[data-finance-detail-scope]').innerText(), /1 октября 2026.*2 октября 2026/);
    await page.locator('[data-finance-detail-close]').click();
    await page.locator('#reportTabMoney').click();
    assert.equal(await page.locator('.report-filters').isVisible(), true, 'one shared period is available in Money');
    assert.equal(await page.locator('.finance-center__filters').isVisible(), false, 'duplicate money filters hidden');
    await page.locator('#reportTabOverview').click();
    await page.evaluate(()=>window.scrollTo(0,0));
    if (output) await page.screenshot({ path:resolve(output, `statistics-overview-${width}.png`), fullPage:false });
    await page.evaluate(()=>financeController.setOrganization({id:reportOrganizationId(),current_role:'specialist'}));
    assert.equal(await page.locator('#reportFinanceOverview').count(), 0, 'manager aggregates removed on role change');
    await page.close();
  }
} finally { await browser.close(); }
assert.deepEqual(errors, []);
assert.deepEqual(unexpected, []);
console.log('Financial overview, shared dates, honest states, one-click details, return context and role isolation passed at 390/760/1440.');
