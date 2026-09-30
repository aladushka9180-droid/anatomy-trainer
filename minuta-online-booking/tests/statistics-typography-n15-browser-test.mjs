import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const rootArg = process.argv.find(arg => arg.startsWith('--project-root='))?.slice(15);
const root = rootArg ? path.resolve(rootArg) : fileURLToPath(new URL('../', import.meta.url));
const shotArg = process.argv.find(arg => arg.startsWith('--screenshots='))?.slice(14);
const shots = shotArg ? path.resolve(shotArg) : '';
const require = createRequire(import.meta.url);
const playwright = process.env.MINUTA_PLAYWRIGHT_MODULE ? await import(pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href) : require('playwright');
const browser = await playwright.chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
const html = await readFile(path.join(root, 'provider.html'), 'utf8');
const provider = await readFile(path.join(root, 'provider.js'), 'utf8');
const financeScript = await readFile(path.join(root, 'finance-center.js'), 'utf8');
const directHtml = html.replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, '');
const cssNames = [...directHtml.matchAll(/<link\s+rel="stylesheet"\s+href="([^"?]+\.css)(?:\?[^" ]*)?"/g)]
  .map(match => match[1]);
cssNames.push('statistics-audit-ui.css'); // Feature loader adds this stylesheet after the shell.
const css = await Promise.all(cssNames.map(name => readFile(path.join(root, name), 'utf8')));
const functionSource = (name, nextName) => {
  const start = provider.indexOf(`function ${name}(`);
  const end = provider.indexOf(`\nfunction ${nextName}(`, start);
  assert.ok(start >= 0 && end > start, `${name} renderer found in provider.js`);
  return provider.slice(start, end);
};
const actualRenderers = [
  functionSource('reportTrendMarkup', 'selectReportTrendBucket'),
  functionSource('selectReportTrendBucket', 'reportDrilldownScope'),
  functionSource('renderReportFunnel', 'reportHeatmapAvailability')
].join('\n');
const fixtureScript = `
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const money = value => new Intl.NumberFormat('ru-RU').format(value) + ' ₽';
  const reportReceivedAmount = item => item.received || 0;
  const bookingOutcome = () => 'completed';
  const parseLocalIsoDate = value => new Date(value + 'T12:00:00');
  const localIsoDate = date => date.toISOString().slice(0,10);
  const reportDateText = value => value;
  const reportShare = (value,total) => total ? Math.round(value / total * 100) + '%' : '—';
  const reportVisitWord = value => value === 1 ? 'визит' : 'визита';
  const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
  const setReportText = (selector,value) => { const node=$(selector); if(node) node.textContent=value; };
  const uiIcon = () => '<svg class="ui-icon" aria-hidden="true"></svg>';
  globalThis.MinutaReportReconciliation = { paymentUnknown:item => !item.known };
  ${actualRenderers}
  const completed = [
    { booking_date:'2026-09-01', received:8120, known:true },
    { booking_date:'2026-09-09', received:5400, known:true },
    { booking_date:'2026-09-17', received:7300, known:true },
    { booking_date:'2026-09-25', received:6200, known:true }
  ];
  const items = [...completed, { booking_date:'2026-09-27', status:'cancelled', received:0, known:false }];
  reportTrendMarkup(completed, { start:'2026-09-01', end:'2026-09-29' });
  renderReportFunnel(items, completed);
  document.addEventListener('click', event => {
    const bucket = event.target.closest('[data-report-trend-bucket]');
    if (bucket) selectReportTrendBucket(bucket);
  });
`;

const results = [];
let currentCase = null;
try {
  for (const width of [390, 760, 1440]) {
    for (const textScale of [1, 2]) {
      const page = await browser.newPage({ viewport:{ width, height:900 }, serviceWorkers:'block' });
      await page.route('**/*', route => route.abort());
      await page.setContent('<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width,initial-scale=1"><body class="provider-body" data-provider-theme="sage-studio" data-provider-layout="soft" data-provider-text-scale="default" style="--theme-surface:#fff;--theme-surface-alt:#f5f8f6;--theme-ink:#173128;--theme-muted:#687a72;--theme-line:#dce7e1;--theme-accent:#296b4b;--theme-accent-soft:#e5f2eb"><main class="provider-main"></main></body></html>');
      await page.evaluate(source => {
        const parsed = new DOMParser().parseFromString(source, 'text/html');
        const analytics = document.importNode(parsed.querySelector('#analyticsView'), true);
        document.querySelector('.provider-main').append(analytics);
        analytics.hidden = false;
        analytics.dataset.reportTab = 'overview';
        analytics.dataset.reportLoadState = 'ready'; // Typography uses confirmed synthetic metrics.
        analytics.dataset.reportEmpty = 'false';
        analytics.dataset.reportSource = 'own';
        analytics.querySelector('#reportDataSource').hidden = false;
        analytics.querySelector('.report-analytics-details').open = true;
        analytics.querySelector('.report-filters').classList.add('is-open');
      }, html);
      for (const content of css) await page.addStyleTag({ content });
      await page.evaluate(scale => { document.documentElement.style.fontSize = `${16 * scale}px`; }, textScale);
      await page.addScriptTag({ content:fixtureScript });
      assert.equal(await page.locator('#reportFunnel article').count(), 4, 'actual funnel renderer produces four steps');
      assert.equal(await page.locator('#reportRevenueChart [data-report-trend-bucket]').count(), 5, 'actual trend renderer produces five buckets');
      await page.locator('#reportRevenueChart [data-report-trend-bucket]').first().click();
      assert.equal(await page.locator('#reportTrendDetail').isVisible(), true, 'actual app handler opens bucket detail');
      assert.equal(await page.locator('#reportRevenueChart [data-report-trend-bucket]').first().getAttribute('aria-pressed'), 'true');

      const overview = await page.evaluate(() => {
        const size = selector => parseFloat(getComputedStyle(document.querySelector(selector)).fontSize);
        const separated = (top,bottom) => top.getBoundingClientRect().bottom <= bottom.getBoundingClientRect().top + 1;
        const within = (parent, child) => child.getBoundingClientRect().right <= parent.getBoundingClientRect().right + 1;
        const funnel = [...document.querySelectorAll('#reportFunnel article')];
        const chart = [...document.querySelectorAll('#reportRevenueChart button')];
        const source = document.querySelector('#reportDataSource');
        return {
          sourceNote:size('#reportDataSourceStatus'), sourceLabel:size('#reportDataSource>span'), sourceButton:size('#reportDataSource button'),
          amount:size('#reportRevenueChart b'), period:size('#reportRevenueChart small'), hint:size('.report-chart-hint'),
          funnelTitle:size('#reportFunnel strong'), funnelNote:size('#reportFunnel small'),
          funnelIntersections:funnel.filter(article => !separated(article.querySelector('strong'), article.querySelector('small'))).length,
          chartIntersections:chart.filter(button => !separated(button.querySelector('b'),button.querySelector('span')) || !separated(button.querySelector('span'),button.querySelector('small'))).length,
          sourceControlOverflow:[...source.querySelectorAll('button')].filter(button => !within(source,button)).length,
          clippedDetailActions:[...document.querySelectorAll('#reportTrendDetail button')].filter(button => button.scrollWidth > button.clientWidth + 1 || button.scrollHeight > button.clientHeight + 1).length,
          documentOverflow:document.documentElement.scrollWidth > innerWidth + 1,
          funnelGradient:getComputedStyle(funnel[0].querySelector('i')).backgroundImage,
          chartGrid:getComputedStyle(document.querySelector('#reportRevenueChart'),'::before').backgroundImage
        };
      });
      currentCase = { width, textScale, overview };
      const secondary = 13 * textScale;
      for (const key of ['sourceNote','sourceLabel','amount','period','hint','funnelNote']) {
        assert.ok(overview[key] >= secondary, `${width}/${textScale} ${key}: ${overview[key]}px < ${secondary}px`);
      }
      for (const key of ['sourceButton','funnelTitle']) assert.ok(overview[key] >= 14 * textScale, `${width}/${textScale} ${key}: ${overview[key]}px`);
      for (const key of ['funnelIntersections','chartIntersections','sourceControlOverflow','clippedDetailActions']) assert.equal(overview[key], 0, `${width}/${textScale} ${key}`);
      assert.equal(overview.documentOverflow, false, `${width}/${textScale} document overflow`);
      assert.equal(overview.funnelGradient, 'none', `${width}/${textScale} funnel uses solid fill`);
      assert.notEqual(overview.chartGrid, 'none', `${width}/${textScale} functional chart grid remains`);
      if (textScale === 1) {
        const presets = await page.evaluate(() => {
          const selectors = ['#reportDataSource>span','#reportDataSource button','.report-retention-list span','#reportFunnel strong','#reportFunnel small'];
          const values = {};
          for (const mode of ['default','comfortable','large']) {
            document.body.dataset.providerTextScale = mode;
            values[mode] = selectors.map(selector => parseFloat(getComputedStyle(document.querySelector(selector)).fontSize));
          }
          document.body.dataset.providerTextScale = 'default';
          return values;
        });
        presets.default.forEach((size,index) => {
          assert.equal(presets.comfortable[index], size + 1, 'Comfortable text must grow by one pixel');
          assert.equal(presets.large[index], size + 2, 'Large text must grow by two pixels');
        });
      }
      if (shots) { await mkdir(shots, { recursive:true }); await page.screenshot({ path:path.join(shots, `overview-${width}-${textScale * 100}.png`), fullPage:true }); }

      await page.evaluate(() => { document.querySelector('#analyticsView').dataset.reportTab = 'clients'; });
      const clients = await page.evaluate(() => {
        const list = document.querySelector('.report-retention-list');
        return { label:parseFloat(getComputedStyle(list.querySelector('span')).fontSize), overflow:list.getBoundingClientRect().right > innerWidth + 1 };
      });
      assert.ok(clients.label >= secondary, `${width}/${textScale} return-client label ${clients.label}px`);
      assert.equal(clients.overflow, false, `${width}/${textScale} return-client overflow`);
      if (shots) await page.screenshot({ path:path.join(shots, `clients-${width}-${textScale * 100}.png`), fullPage:true });

      await page.evaluate(() => {
        const analytics = document.querySelector('#analyticsView');
        analytics.dataset.reportTab = 'money';
        analytics.classList.add('finance-center-mounted');
        analytics.querySelector('#financeCenterRoot').hidden = false;
      });
      await page.addScriptTag({ content:financeScript });
      await page.evaluate(async () => {
        const periods = [{ value:'current_month', label:'Октябрь 2026' }];
        const masters = [{ value:'', label:'Все мастера' }];
        const dashboard = {
          available:true, financeEnabled:true, resultReliable:true, periodLabel:'1–15 октября 2026',
          summary:{ receivedMinor:2640000, expenseMinor:480000, serviceMinor:2940000, debtMinor:0, totalVisits:8, paymentKnownVisits:8 },
          completeness:{ partial:false }, permissions:{ canAddExpense:false },
          filters:{ periods, masters, selectedPeriod:'current_month', selectedMaster:'' },
          movement:[{ key:'1', label:'1 окт', fullLabel:'1 октября', receivedMinor:1240000, expenseMinor:180000 },
            { key:'8', label:'8 окт', fullLabel:'8 октября', receivedMinor:1400000, expenseMinor:300000 }],
          expenseCategories:[{ id:'materials', name:'Материалы', amountMinor:480000 }],
          expenseDirectory:[], paymentAccounts:[], operations:[], nextCursor:''
        };
        const adapter = { readDashboard:async () => structuredClone(dashboard), readOperations:async () => ({ operations:[], nextCursor:'' }) };
        window.n15Finance = MinutaFinanceCenter.init({ root:document.querySelector('#financeCenterRoot'), adapter, periods, masters, today:() => '2026-10-15', onNotice:() => {} });
        await window.n15Finance.ready;
      });
      assert.equal(await page.locator('.finance-center__chart-point').count(), 2, 'actual finance renderer produces movement points');
      await page.locator('.finance-center__chart-point').first().click();
      assert.match(await page.locator('.finance-center__chart-detail').innerText(), /1 октября/);
      const finance = await page.evaluate(() => {
        const size = selector => parseFloat(getComputedStyle(document.querySelector(selector)).fontSize);
        const root = document.querySelector('.finance-center');
        return {
          label:size('.finance-center__chart-label'), legend:size('.finance-center__legend span'), detail:size('.finance-center__chart-detail'),
          expenseLegend:document.querySelector('.finance-center__legend .is-expense').textContent.trim(),
          expensePattern:getComputedStyle(document.querySelector('.finance-center__bar.is-expense')).backgroundImage,
          expenseColor:getComputedStyle(document.querySelector('.finance-center__bar.is-expense')).backgroundColor,
          gridLines:getComputedStyle(document.querySelector('.finance-center__chart-grid')).backgroundImage,
          overflow:root.getBoundingClientRect().right > innerWidth + 1 || document.documentElement.scrollWidth > innerWidth + 1,
          clippedLabels:[...document.querySelectorAll('.finance-center__chart-label')].filter(node => node.scrollWidth > node.clientWidth + 1).length,
          ringTextClipped:[...document.querySelectorAll('.finance-center__ring :is(span,strong)')]
            .filter(node => node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1).length
        };
      });
      for (const key of ['label','legend','detail']) assert.ok(finance[key] >= secondary, `${width}/${textScale} finance ${key} ${finance[key]}px`);
      assert.match(finance.expenseLegend, /^− Расходы/);
      assert.equal(finance.expensePattern, 'none');
      assert.notEqual(finance.expenseColor, 'rgba(0, 0, 0, 0)');
      assert.notEqual(finance.gridLines, 'none', 'functional finance chart grid remains');
      assert.equal(finance.overflow, false, `${width}/${textScale} finance overflow`);
      assert.equal(finance.clippedLabels, 0, `${width}/${textScale} finance labels clipped`);
      assert.equal(finance.ringTextClipped, 0, `${width}/${textScale} finance ring text clipped`);
      if (shots) await page.screenshot({ path:path.join(shots, `finance-${width}-${textScale * 100}.png`), fullPage:true });
      results.push({ width, textScale, overview, clients, finance });
      await page.close();
    }
  }
  console.log(JSON.stringify({ status:'PASS', projectRoot:root, cases:results }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status:'FAIL', projectRoot:root, completedCases:results, currentCase, error:error.message }, null, 2));
  process.exitCode = 1;
} finally { await browser.close(); }
