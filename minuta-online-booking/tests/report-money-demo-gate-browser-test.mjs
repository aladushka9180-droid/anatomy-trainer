import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const modulePath = process.env.MINUTA_PLAYWRIGHT_MODULE;
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const html = readFileSync(new URL('../provider.html', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const auditStyles = readFileSync(new URL('../statistics-audit-ui.css', import.meta.url), 'utf8');
const uxStyles = readFileSync(new URL('../provider-ux.css', import.meta.url), 'utf8');
const financeStyles = readFileSync(new URL('../finance-center.css', import.meta.url), 'utf8');
const provider = readFileSync(new URL('../provider.js', import.meta.url), 'utf8');
const start = provider.indexOf('function setReportSubview(');
const end = provider.indexOf('\nfunction reportGoalsScopeKey(', start);
assert.ok(start >= 0 && end > start, 'real report tab controller exists');
const controller = provider.slice(start, end);
const browser = await chromium.launch({ headless:true });
const screenshotDir = process.env.REPORT_DEMO_SCREENSHOT_DIR;
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
      document.body.style.cssText = '--theme-ink:#302b31;--theme-muted:#625c64;--theme-accent:#c43372;--theme-accent-contrast:#fff;--theme-line:#e9cbd6;--theme-surface:#fff;--theme-surface-alt:#ffe8f0;--theme-shadow:rgba(103,67,87,.09);background:#fff5f8';
      document.body.append(panel);
      panel.hidden = false;
      panel.dataset.reportSource = 'demo';
      panel.querySelector('#financeCenterRoot').hidden = false;
      panel.querySelector('#financeCenterRoot').textContent = 'Реальные операции';
    }, html);
    await page.addStyleTag({ content:styles });
    await page.addStyleTag({ content:auditStyles });
    await page.addStyleTag({ content:financeStyles });
    await page.addStyleTag({ content:uxStyles });
    await page.addScriptTag({ content:`
      let reportSubview = 'overview';
      let reportDataSource = 'demo';
      let loadCalls = 0;
      const financeController = { load() { loadCalls += 1; } };
      const $ = selector => document.querySelector(selector);
      const $$ = selector => [...document.querySelectorAll(selector)];
      const reportRange = () => ({});
      const ensureReportRetention = () => {};
      ${controller}
    ` });
    await page.evaluate(() => setReportSubview('money'));
    assert.equal(await page.locator('#reportMoneyDemoGate').isVisible(), true, `${width}: demo gate visible`);
    assert.equal(await page.locator('#financeCenterRoot').isVisible(), false, `${width}: real finance hidden`);
    assert.deepEqual(await page.locator('#analyticsView > [data-report-section="money"]').evaluateAll(elements => elements.filter(element => getComputedStyle(element).display !== 'none').map(element => element.id || element.className)), [], `${width}: no money panels visible under demo gate`);
    assert.equal(await page.evaluate(() => loadCalls), 0, `${width}: demo never loads real finance`);
    assert.equal(await page.locator('#reportMoneyDemoGate button').getAttribute('data-report-source'), 'own');
    const gateWidth = await page.locator('#reportMoneyDemoGate').evaluate(element => element.getBoundingClientRect().width);
    assert.ok(gateWidth <= width, `${width}: gate fits viewport`);
    if (screenshotDir) await page.screenshot({ path:join(screenshotDir, `money-demo-${width}.png`) });

    await page.evaluate(() => {
      reportDataSource = 'own';
      document.querySelector('#analyticsView').dataset.reportSource = 'own';
      document.querySelector('#analyticsView').classList.add('finance-center-mounted');
      setReportSubview('money');
    });
    assert.equal(await page.locator('#reportMoneyDemoGate').isVisible(), false, `${width}: gate closes on explicit source switch`);
    assert.equal(await page.locator('#financeCenterRoot').isVisible(), true, `${width}: real finance visible only in own mode`);
    assert.equal(await page.evaluate(() => loadCalls), 1, `${width}: own finance loads`);
    await page.evaluate(() => {
      reportDataSource = 'demo';
      document.querySelector('#analyticsView').dataset.reportSource = 'demo';
      setReportSubview('money');
    });
    assert.deepEqual(await page.locator('#analyticsView > [data-report-section="money"]').evaluateAll(elements => elements.filter(element => getComputedStyle(element).display !== 'none').map(element => element.id || element.className)), [], `${width}: returning to demo hides mounted finance too`);
    await page.close();
  }
} finally {
  await browser.close();
}
