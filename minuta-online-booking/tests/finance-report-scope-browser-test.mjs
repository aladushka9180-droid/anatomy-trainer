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
const browser = await chromium.launch({ headless:true });
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
          return MinutaFinanceProvider.normalizeFinanceScreen({ ...raw, selected_performer_id:masterId }, {
            organizationId, period, bounds:{ start, end:'2026-09-27' }
          });
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
    await page.close();
  }
} finally { await browser.close(); }
assert.deepEqual(errors, []);
console.log('PASS N02/N04: independent finance/visit scopes, export review and invalidation, pending/error, 390/760/1440; synthetic data only.');
