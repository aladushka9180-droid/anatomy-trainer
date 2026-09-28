import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const html = read('provider.html');
const provider = read('provider.js').replaceAll('\r\n', '\n');
const audit = read('statistics-audit-provider.js').replaceAll('\r\n', '\n');
const declaration = (source, name, indent = '') => {
  const start = source.indexOf(`${indent}function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf(`\n${indent}}`, start) + indent.length + 2);
};
const script = `
  var $ = selector => document.querySelector(selector);
  var reportPeriod = 'custom', reportDataSource = 'own';
  var reportCustomStart = '2025-01-01', reportCustomEnd = '2025-01-07';
  var reportPerformerName = () => 'Вся команда', reportPeriodName = () => reportPeriod === 'custom' ? 'Свои даты' : '30 дней';
  var reportRange = () => ({ start:reportCustomStart, end:reportCustomEnd });
  var range = () => reportRange();
  var reportDateText = (value, options) => new Date(value + 'T12:00:00').toLocaleDateString('ru-RU', options);
  ${declaration(audit, 'customPeriodName', '  ')}
  window.MinutaStatisticsAuditProvider = { periodName:() => reportPeriod === 'custom' ? customPeriodName() : reportPeriodName() };
  ${declaration(provider, 'updateReportFilterSummary')}
`;

const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
try {
  for (const width of [390, 760, 1440]) {
    const page = await browser.newPage({ viewport:{ width, height:900 } });
    const panel = html.match(/<section[^>]*data-provider-panel="analytics"[\s\S]*?<\/section>/)?.[0];
    assert.ok(panel, 'Actual Statistics panel is present');
    await page.setContent(`<body class="provider-body" data-provider-theme="pink-porcelain" data-provider-layout="soft">${panel}</body>`);
    await page.addStyleTag({ content:read('styles.css') });
    await page.addStyleTag({ content:read('provider-ux.css') });
    await page.addStyleTag({ content:read('statistics-audit-ui.css') });
    await page.addScriptTag({ content:script });
    const summary = async () => page.locator('#reportFilterSummary').textContent();
    await page.evaluate(() => updateReportFilterSummary());
    assert.equal(await summary(), '1–7 янв. 2025 · Вся команда');
    await page.evaluate(() => { reportCustomStart='2025-01-30'; reportCustomEnd='2025-02-02'; updateReportFilterSummary(); });
    assert.equal(await summary(), '30 янв. — 2 февр. 2025 · Вся команда');
    await page.evaluate(() => { reportCustomStart='2025-12-30'; reportCustomEnd='2026-01-02'; reportDataSource='demo'; updateReportFilterSummary(); });
    assert.equal(await summary(), '30 дек. 2025 — 2 янв. 2026 · Вся команда · Демо');
    await page.evaluate(() => { reportPeriod='last30'; reportDataSource='own'; updateReportFilterSummary(); });
    assert.equal(await summary(), '30 дней · Вся команда');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `No horizontal overflow at ${width}px`);
    await page.close();
  }
  console.log('Report custom period summary browser: PASS');
} finally {
  await browser.close();
}
