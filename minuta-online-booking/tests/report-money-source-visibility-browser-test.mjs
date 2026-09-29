import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.MINUTA_PLAYWRIGHT_MODULE;
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const html = read('provider.html');
const styles = ['styles.css', 'finance-center.css', 'provider-ux.css', 'statistics-audit-ui.css'].map(read);
const provider = read('provider.js');
const sourceStart = provider.indexOf('function renderReportDataSourceControl(');
const sourceEnd = provider.indexOf('\nfunction reportSessionKey(', sourceStart);
const tabStart = provider.indexOf('function setReportSubview(');
const tabEnd = provider.indexOf('\nfunction reportGoalsScopeKey(', tabStart);
assert.ok(sourceStart >= 0 && sourceEnd > sourceStart && tabStart >= 0 && tabEnd > tabStart, 'real source and tab controllers exist');
const controllers = `${provider.slice(sourceStart, sourceEnd)}\n${provider.slice(tabStart, tabEnd)}`;
const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
const screenshotDir = process.env.REPORT_DEMO_SOURCE_SCREENSHOT_DIR ? resolve(process.env.REPORT_DEMO_SOURCE_SCREENSHOT_DIR) : '';
if (screenshotDir) mkdirSync(screenshotDir, { recursive:true });

try {
  for (const width of [390, 760, 1440]) {
    const page = await browser.newPage({ viewport:{ width, height:900 } });
    await page.goto('about:blank');
    await page.evaluate(source => {
      const parsed = new DOMParser().parseFromString(source, 'text/html');
      const panel = document.importNode(parsed.querySelector('#analyticsView'), true);
      document.body.className = 'provider-body';
      document.body.dataset.providerTheme = 'pink-porcelain';
      document.body.dataset.providerLayout = 'soft';
      document.body.style.cssText = '--theme-ink:#302b31;--theme-muted:#625c64;--theme-accent:#c43372;--theme-accent-contrast:#fff;--theme-line:#e9cbd6;--theme-surface:#fff;--theme-surface-alt:#ffe8f0;background:#fff5f8';
      document.body.append(panel);
      panel.hidden = false;
      panel.querySelector('#financeCenterRoot').textContent = 'Синтетические реальные операции';
    }, html);
    for (const style of styles) await page.addStyleTag({ content:style });
    await page.addScriptTag({ content:`
      let reportSubview = 'overview';
      let reportDataSource = 'demo';
      let loadCalls = 0;
      const financeController = { load() {
        loadCalls += 1;
        document.querySelector('#analyticsView').classList.add('finance-center-mounted');
        document.querySelector('#financeCenterRoot').hidden = false;
      } };
      const $ = selector => document.querySelector(selector);
      const $$ = selector => [...document.querySelectorAll(selector)];
      const reportDemoOrganization = () => ({ id:'demo' });
      const reportOwnOrganization = () => ({ id:'own' });
      const reportRange = () => ({});
      const ensureReportRetention = () => {};
      ${controllers}
      document.addEventListener('click', event => {
        const source = event.target.closest('button[data-report-source]');
        if (source) {
          reportDataSource = source.dataset.reportSource;
          renderReportDataSourceControl();
          setReportSubview(reportSubview);
          return;
        }
        const tab = event.target.closest('button[data-report-view]');
        if (tab) setReportSubview(tab.dataset.reportView);
      });
      renderReportDataSourceControl();
      setReportSubview('overview');
    ` });

    const source = page.locator('#reportDataSource');
    const own = source.locator('[data-report-source="own"]');
    const demo = source.locator('[data-report-source="demo"]');
    const gate = page.locator('#reportMoneyDemoGate');
    const finance = page.locator('#financeCenterRoot');
    assert.equal(await source.isVisible(), true, `${width}: source visible in demo overview`);
    await page.locator('#reportTabMoney').click();
    assert.equal(await source.isVisible(), true, `${width}: source visible in demo Money before finance mount`);
    assert.equal(await gate.isVisible(), true, `${width}: demo gate visible`);
    assert.equal(await finance.isVisible(), false, `${width}: real finance isolated from demo`);
    assert.equal(await page.evaluate(() => loadCalls), 0, `${width}: no real finance load in demo`);

    await gate.locator('[data-report-source="own"]').click();
    assert.equal(await source.isVisible(), true, `${width}: source remains visible in own Money after finance mount`);
    assert.equal(await own.getAttribute('aria-pressed'), 'true');
    assert.equal(await gate.isVisible(), false);
    assert.equal(await finance.isVisible(), true);
    assert.equal(await page.evaluate(() => loadCalls), 1);

    await demo.click();
    assert.equal(await source.isVisible(), true, `${width}: source visible after return to demo Money`);
    assert.equal(await demo.getAttribute('aria-pressed'), 'true');
    assert.equal(await gate.isVisible(), true);
    assert.equal(await finance.isVisible(), false, `${width}: mounted real finance hidden in demo`);
    assert.equal(await page.evaluate(() => loadCalls), 1, `${width}: return to demo does not reload real finance`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth <= 1), `${width}: no page overflow`);
    if (screenshotDir) await page.screenshot({ path:join(screenshotDir, `demo-money-${width}.png`) });
    await page.close();
  }
} finally {
  await browser.close();
}
