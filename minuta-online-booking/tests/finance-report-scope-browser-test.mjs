import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const project = process.env.MINUTA_PROJECT_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '..');
const draft = process.env.MINUTA_SCOPE_DRAFT || project;
const output = process.env.MINUTA_VISUAL_OUTPUT || '';
if (output) mkdirSync(output, { recursive:true });
const read = name => readFileSync(resolve(project, name), 'utf8');
const changed = name => readFileSync(resolve(draft, name), 'utf8');
const providerHtml = read('provider.html');
const providerSource = read('provider.js');
const tabStart = providerSource.indexOf('function setReportSubview(');
const tabEnd = providerSource.indexOf('\nfunction reportGoalsScopeKey(',tabStart);
assert.ok(tabStart >= 0 && tabEnd > tabStart);
const tabController = providerSource.slice(tabStart,tabEnd);
const css = [...providerHtml.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"?]+)(?:\?[^"]*)?"[^>]*>/g)].map(match => {
  const file = match[1];
  const content = ['statistics-audit-ui.css','finance-center.css'].includes(file) ? changed(file) : read(file);
  const media = match[0].match(/media="([^"]+)"/)?.[1];
  return media ? `@media ${media}{${content}}` : content;
}).join('\n');
const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
const errors = [];
const organizationId = '11111111-1111-4111-8111-111111111111';
const masterId = '22222222-2222-4222-8222-222222222222';
const raw = {
  schema:'minuta-finance-screen-v1', ledger_version:163, organization_id:organizationId,
  currency:'RUB', timezone:'Europe/Samara', finance_enabled:true,
  period:{ start:'2026-09-01', end:'2026-09-27', bucket_grain:'day' },
  summary:{ received_minor:1234500, expense_minor:267800, services_minor:1730000, debt_minor:0 },
  confidence:{ completed_visits:8, payment_marked_visits:8, unposted_payment_visits:0,
    service_value_known_visits:8, is_complete:true, result_reliable:true },
  series:[], expense_structure:[], operations:[], categories:[], accounts:[],
  performers:[{ id:masterId, name:'Учебный мастер' }]
};

try {
  for (const width of [390, 760, 1440]) {
    const page = await browser.newPage({ viewport:{ width, height:1000 } });
    page.on('pageerror', error => errors.push(`${width}: ${error.message}`));
    await page.route('**/*', route => route.abort());
    await page.setContent('<!doctype html><html lang="ru"><head><meta charset="utf-8"></head><body></body></html>');
    await page.evaluate(source => {
      const parsed = new DOMParser().parseFromString(source, 'text/html');
      document.body.className = 'provider-body';
      document.body.dataset.providerTheme = 'pink-porcelain';
      document.body.dataset.providerLayout = 'capsule';
      document.body.dataset.providerResolvedColorMode = 'light';
      document.body.style.cssText = 'margin:0;padding:12px;display:block';
      const dashboard = document.createElement('main'); dashboard.id = 'dashboard'; dashboard.dataset.activeView = 'analytics';
      document.body.append(dashboard);
      dashboard.append(document.importNode(parsed.querySelector('#analyticsView'), true));
      const report = document.querySelector('#analyticsView');
      report.hidden = false;
      report.classList.add('finance-center-mounted');
      report.dataset.reportTab = 'overview';
      report.dataset.reportEmpty = 'false';
      report.dataset.reportLoadState = 'ready';
      document.querySelector('#financeCenterRoot').hidden = false;
    }, providerHtml);
    await page.addStyleTag({ content:css });
    for (const content of [changed('statistics-audit-ui.js'), changed('finance-center.js'), read('finance-center-provider.js')]) await page.addScriptTag({ content });
    await page.evaluate(({ raw, organizationId }) => {
      window.scopeTest = { scope:{ session:1, organization:organizationId, organizationName:'Учебная организация',
        source:'own', start:'2026-08-29', end:'2026-09-27', performer:'all', performerName:'Вся команда', status:'ready' }, downloads:[], calls:[], mode:'ready' };
      const report = document.querySelector('#analyticsView');
      const getScope = () => ({ ...scopeTest.scope, view:report.dataset.reportTab });
      window.audit = MinutaStatisticsAuditUI.create({ document, getScope, getSegments:() => ({ all:[], new:[], returning:[] }),
        download:(format, privacy) => scopeTest.downloads.push({ format, privacy, scope:getScope() }) });
      audit.mount();
      document.querySelector('#reportTabMoney').hidden = false;
      window.finance = MinutaFinanceCenter.init({ root:document.querySelector('#financeCenterRoot'), adapter:{
        readDashboard:async ({ period, masterId }) => {
          scopeTest.calls.push({ period, masterId });
          if (scopeTest.mode === 'pending') await new Promise(resolve => { scopeTest.release = resolve; });
          if (scopeTest.mode === 'error') throw new Error('Synthetic unavailable');
          const start = period === 'quarter' ? '2026-07-01' : '2026-09-01';
          const normalized = MinutaFinanceProvider.normalizeFinanceScreen({ ...raw, selected_performer_id:masterId }, {
            organizationId, period, bounds:{ start, end:'2026-09-27' }
          });
          normalized.dateBasis = 'operations';
          normalized.cashProjectionUnavailable = false;
          normalized.movement = [{ key:start, receivedMinor:normalized.summary.receivedMinor }];
          return normalized;
        }
      } });
    }, { raw, organizationId });
    await page.evaluate(() => finance.ready);
    await page.addScriptTag({ content:`
      let reportSubview = 'overview';
      const reportDataSource = 'own';
      const $ = selector => document.querySelector(selector);
      const $$ = selector => [...document.querySelectorAll(selector)];
      const reportRange = () => ({});
      const ensureReportRetention = () => {};
      const financeController = { load() {} };
      ${tabController}
      document.addEventListener('click', event => {
        const tab = event.target.closest('[data-report-view]');
        if (tab) setReportSubview(tab.dataset.reportView);
      });
      setReportSubview('overview');
    ` });
    assert.equal(await page.locator('#exportBookings span').innerText(), 'Экспорт');
    assert.equal(await page.locator('#reportVisitExportScope').isVisible(), false);
    await page.locator('#reportTabMoney').click();
    await page.waitForFunction(() => document.querySelector('#exportBookings span').textContent === 'Отчёт по визитам');
    assert.equal(await page.locator('#exportBookings').getAttribute('aria-label'), 'Отчёт по визитам');
    const note = page.locator('#reportVisitExportScope');
    assert.match(await note.innerText(), /29\.08\.2026 — 27\.09\.2026 · Вся команда/);
    assert.match(await note.innerText(), /из вкладки «Обзор»/);
    assert.match(await note.innerText(), /финансовых операций и расходов пока недоступен/);
    assert.match(await page.locator('[data-finance-scope]').innerText(), /1 сентября 2026.*27 сентября 2026.*Все мастера/);
    await page.locator('[data-finance-master]').selectOption(masterId);
    await page.waitForFunction(() => document.querySelector('[data-finance-scope]').textContent.endsWith('Учебный мастер'));
    const visitScope = await note.innerText();
    await page.locator('[data-finance-period]').selectOption('quarter');
    await page.waitForFunction(() => document.querySelector('[data-finance-scope]').textContent.includes('1 июля 2026'));
    assert.equal(await note.innerText(), visitScope, 'Finance filters must not change the visit export scope');
    await page.locator('#exportBookings').click();
    assert.match(await page.locator('#reportExportDialog .report-audit-scope').innerText(), /29\.08\.2026 — 27\.09\.2026 · Вся команда/);
    assert.doesNotMatch(await page.locator('#reportExportDialog .report-audit-scope').innerText(), /Открыта вкладка: Деньги|Учебный мастер/);
    await page.locator('#reportExportPrivacy').selectOption('none');
    await page.locator('[data-report-export="csv"]').click();
    assert.match(await page.locator('.report-export-review').innerText(), /Расходы не входят/);
    await page.locator('.report-export-review [data-audit-confirm]').click();
    const downloads = await page.evaluate(() => scopeTest.downloads);
    assert.equal(downloads.length, 1);
    assert.equal(downloads[0].privacy, 'none');
    assert.equal(downloads[0].scope.start, '2026-08-29');
    assert.equal(downloads[0].scope.performer, 'all');
    await page.locator('#exportBookings').click();
    await page.locator('[data-report-export="xlsx"]').click();
    await page.evaluate(() => { scopeTest.scope.performer = 'changed'; scopeTest.scope.performerName = 'Другой учебный мастер'; audit.refresh(); });
    assert.equal(await page.locator('.report-export-review').evaluate(e => e.open), false, 'Changed visit scope must close old confirmation');
    assert.match(await note.innerText(), /Другой учебный мастер/);
    assert.equal(await page.evaluate(() => scopeTest.downloads.length), 1);
    await page.evaluate(() => { scopeTest.mode = 'pending'; });
    await page.locator('[data-finance-period]').selectOption('current_month');
    assert.equal(await page.locator('[data-finance-scope]').isVisible(), false, 'No old finance scope below newly selected pending filter');
    await page.evaluate(() => { scopeTest.mode = 'error'; scopeTest.release(); });
    await page.waitForFunction(() => document.querySelector('[data-finance-status]').textContent === 'Не удалось загрузить финансовые данные.');
    assert.equal(await page.locator('[data-finance-scope]').isVisible(), false);
    await page.evaluate(async () => { scopeTest.mode = 'ready'; await finance.reload(); });
    assert.match(await page.locator('[data-finance-scope]').innerText(), /1 сентября 2026.*Учебный мастер/);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}: overflow`);
    if (output) await page.screenshot({ path:resolve(output, `scope-${width}.png`), fullPage:true });
    await page.locator('#reportTabOverview').click();
    await page.waitForFunction(() => document.querySelector('#exportBookings span').textContent === 'Экспорт');
    assert.equal(await note.isVisible(), false);
    await page.evaluate(async () => finance.setScope({ period:'current_month', masterId:'', bounds:{start:'2026-09-01',end:'2026-09-27'}, contextToken:'team' }));
    await page.locator('#reportFinanceOverview [data-finance-detail="profit"]').first().click();
    const detail = page.locator('[data-finance-detail-dialog]');
    assert.equal(await detail.evaluate(e => e.open), true);
    const positionBefore = await page.locator('#reportFinanceOverview [data-finance-overview-chart]').evaluate(e => e.getBoundingClientRect().top);
    const belowChartBefore = await page.locator('#financeOverviewExpenseTitle').evaluate(e => e.getBoundingClientRect().top);
    await page.evaluate(() => { scopeTest.mode = 'pending'; window.scopeRefresh = finance.setScope({ period:'current_month', masterId:'', bounds:{start:'2026-09-01',end:'2026-09-27'}, contextToken:'checking' }); });
    assert.equal(await detail.evaluate(e => e.open), true, 'Background scope verification must not close an open detail');
    assert.doesNotMatch(await detail.innerText(), /12\s*345/, 'Pending scope must not display previous financial amounts');
    assert.doesNotMatch(await page.locator('#reportFinanceOverview').innerText(), /12\s*345/, 'Pending overview must not display previous financial amounts');
    const positionDuring = await page.locator('#reportFinanceOverview [data-finance-overview-chart]').evaluate(e => e.getBoundingClientRect().top);
    const belowChartDuring = await page.locator('#financeOverviewExpenseTitle').evaluate(e => e.getBoundingClientRect().top);
    assert.ok(Math.abs(positionDuring - positionBefore) < 1, `${width}: chart moved ${positionDuring - positionBefore}px while checking`);
    assert.ok(Math.abs(belowChartDuring - belowChartBefore) < 1, `${width}: content below chart moved ${belowChartDuring - belowChartBefore}px while checking`);
    await page.evaluate(async () => { scopeTest.mode = 'ready'; scopeTest.release(); await window.scopeRefresh; });
    assert.equal(await detail.evaluate(e => e.open), true, 'Detail remains open after refreshed data arrives');
    assert.equal(await page.locator('[data-finance-overview-chart]').evaluate(e => e.style.minHeight), '', 'Temporary height must be released after refresh');
    await page.evaluate(async () => { scopeTest.mode = 'error'; await finance.setScope({ period:'current_month', masterId:'', bounds:{start:'2026-09-01',end:'2026-09-27'}, contextToken:'unavailable' }); });
    assert.equal(await detail.evaluate(e => e.open), true, 'Detail remains open if refresh fails');
    assert.match(await detail.innerText(), /Не удалось загрузить данные/);
    assert.equal(await page.locator('[data-finance-overview-chart]').evaluate(e => e.style.minHeight), '', 'Temporary height must be released after failure');
    assert.doesNotMatch(await detail.innerText(), /12\s*345/, 'Failed scope must not show a previous amount');
    await page.locator('[data-finance-detail-close]').click();
    await page.evaluate(async () => { scopeTest.mode = 'ready'; await finance.setScope({ period:'current_month', masterId:'', bounds:{start:'2026-09-01',end:'2026-09-27'}, contextToken:'ready-again' }); });
    await page.locator('#reportFinanceOverview [data-finance-detail="profit"]').first().click();
    await page.evaluate(() => { scopeTest.mode = 'pending'; window.scopeRefresh = finance.setScope({ period:'current_month', masterId:'', bounds:{start:'2026-09-01',end:'2026-09-27'}, contextToken:'later' }); });
    await page.locator('[data-finance-detail-close]').click();
    await page.evaluate(async () => { scopeTest.mode = 'ready'; scopeTest.release(); await window.scopeRefresh; });
    assert.equal(await detail.evaluate(e => e.open), false, 'User-closed detail must not reopen on completion');
    if (width === 1440) {
      const binding = read('statistics-audit-provider.js');
      const first = binding.indexOf('  function refreshReferenceHeader(scope) {');
      const last = binding.indexOf('  function restoreVisitOverview()', first);
      assert.ok(first >= 0 && last > first);
      await page.evaluate(() => {
        const wrap = document.querySelector('#reportPerformerFilterWrap');
        wrap.hidden = false;
        wrap.querySelector('select').innerHTML = '<option>Вся команда</option>';
        document.querySelector('#reportFilterSummary').textContent = '25 окт. — 23 нояб. 2026 г. · Вся команда';
      });
      await page.addScriptTag({ content:`let referenceHeaderScope='', referenceHeaderDisplay='', referenceHeaderMedia=null, referenceHeaderPerformerWidth=0, referenceHeaderControlsWidth=0, referenceHeaderPerformerFlex='', referenceHeaderPerformerMaxWidth='', referenceHeaderPerformerBox=null, referenceHeaderPlaceholder=null; let reportTeamAnalyticsState={status:'ready'};\n${binding.slice(first,last)}\nrefreshReferenceHeader();` });
      await page.evaluate(() => new Promise(requestAnimationFrame));
      const before = await page.locator('#reportFilterToggle').evaluate(e => e.getBoundingClientRect().width);
      const topBefore = await page.locator('#reportFinanceOverview').evaluate(e => e.getBoundingClientRect().top);
      if (output) await page.screenshot({ path:resolve(output, 'rights-check-before.png') });
      await page.evaluate(() => {
        reportTeamAnalyticsState.status = 'loading';
        document.querySelector('#reportFilterSummary').textContent = '25 окт. — 23 нояб. 2026 г. · Личная статистика';
        document.querySelector('#reportPerformerFilterWrap').hidden = true;
      });
      await page.waitForTimeout(100);
      const during = await page.locator('#reportFilterToggle').evaluate(e => e.getBoundingClientRect().width);
      if (output) await page.screenshot({ path:resolve(output, 'rights-check-pending.png') });
      assert.ok(Math.abs(during-before) < 2, `Header changed width ${during-before}px during permission check`);
      const topDuring = await page.locator('#reportFinanceOverview').evaluate(e => e.getBoundingClientRect().top);
      assert.ok(Math.abs(topDuring-topBefore) < 2, `Finance cards moved ${topDuring-topBefore}px during permission check`);
      await page.evaluate(() => { reportTeamAnalyticsState.status = 'ready'; document.querySelector('#reportPerformerFilterWrap').hidden = false; });
      await page.waitForTimeout(100);
      assert.ok(Math.abs(await page.locator('#reportFilterToggle').evaluate(e => e.getBoundingClientRect().width) - before) < 2, 'Header remains stable after rights confirm');
      await page.evaluate(() => {
        reportTeamAnalyticsState.status = 'loading';
        document.querySelector('#reportPerformerFilterWrap').hidden = true;
      });
      await page.waitForTimeout(100);
      await page.evaluate(() => { reportTeamAnalyticsState.status = 'ready'; document.querySelector('#reportFilterSummary').textContent = '25 окт. — 23 нояб. 2026 г. · Личная статистика'; });
      await page.waitForTimeout(100);
      assert.equal(await page.locator('.report-reference-controls > span[aria-hidden="true"]').count(), 0, 'A denied permission removes the temporary placeholder');
    }
    await page.close();
  }
} finally { await browser.close(); }
assert.deepEqual(errors, []);
console.log('PASS N02/N04: independent finance/visit scopes, export review and invalidation, pending/error, 390/760/1440; synthetic data only.');
