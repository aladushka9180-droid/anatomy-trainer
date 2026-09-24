import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.MINUTA_PLAYWRIGHT_MODULE;
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const html = read('provider.html');
const scripts = new Map([
  ['statistics-audit-ui.js', read('statistics-audit-ui.js')],
  ['statistics-audit-provider.js', read('statistics-audit-provider.js')],
]);
const browser = await chromium.launch({ headless:true });
try {
  const page = await browser.newPage({ viewport:{ width:390, height:800 } });
  let loaded = 0;
  await page.route('https://audit.test/**', route => {
    const name = new URL(route.request().url()).pathname.slice(1);
    if (scripts.has(name)) { loaded += 1; return route.fulfill({ status:200, contentType:'application/javascript', body:scripts.get(name) }); }
    if (name === 'statistics-audit-ui.css') return route.fulfill({ status:200, contentType:'text/css', body:read(name) });
    return route.abort();
  });
  await page.goto('about:blank');
  await page.evaluate(source => {
    const parsed = new DOMParser().parseFromString(source, 'text/html');
    const report = document.importNode(parsed.querySelector('#analyticsView'), true);
    report.hidden = false;
    document.body.append(report);
    for (const template of parsed.querySelectorAll('template[data-provider-feature="statistics"]')) {
      const clone = document.importNode(template, true);
      for (const asset of clone.content.querySelectorAll('[src],[href]')) {
        for (const attribute of ['src', 'href']) if (asset.hasAttribute(attribute)) {
          asset.setAttribute(attribute, `https://audit.test/${asset.getAttribute(attribute)}`);
        }
      }
      document.body.append(clone);
    }
  }, html);
  await page.addScriptTag({ content:`
    let sessionGeneration=1, reportScopedBookingsState={status:'ready',rows:[]}, reportDataSource='own';
    let reportPerformerFilter='all', importedBookingHistory=[], allBookings=[];
    function reportRange(){return {start:'2026-09-01',end:'2026-09-30'};}
    function reportUsesScopedBookings(){return false;}
    function reportOrganizationId(){return 'org';}
    function reportOrganization(){return {name:'Тест'};}
    function reportPerformerName(){return 'Вся команда';}
    function reportCompletedItems(rows){return rows;}
    function reportBookings(){return [];}
    function reportClientIdentity(row){return row.client_phone;}
    function isScheduleBlock(){return false;}
    window.downloads=[];
    function exportBookingsXlsxInBackground(privacy){window.downloads.push(['xlsx',privacy]);}
    function exportBookingsCsv(privacy){window.downloads.push(['csv',privacy]);}
    function exportBookingsPdf(privacy){window.downloads.push(['pdf',privacy]);}
  ` });
  await page.addScriptTag({ content:read('provider-feature-assets.js') });
  assert.equal(await page.locator('.report-segment-button').count(), 0, 'feature starts unloaded');
  await page.locator('#exportBookings').click();
  await page.locator('#reportExportDialog').waitFor({ state:'visible' });
  assert.equal(await page.locator('.report-segment-button').count(), 3, 'feature mounted once');
  assert.equal(loaded, 2, 'both scripts loaded exactly once');
  assert.deepEqual(await page.evaluate(() => window.downloads), [], 'opening export does not download');
  await page.locator('#reportExportPrivacy').selectOption('full');
  await page.locator('[data-report-export="csv"]').click();
  await page.locator('.report-export-review [data-audit-confirm]').click();
  assert.deepEqual(await page.evaluate(() => window.downloads), [], 'full phone export requires checkbox');
  await page.locator('.report-export-review input').check();
  await page.locator('.report-export-review [data-audit-confirm]').click();
  assert.deepEqual(await page.evaluate(() => window.downloads), [['csv','full']]);
  await page.locator('#exportBookings').click();
  assert.equal(loaded, 2, 'second click reuses loaded feature');
  await page.close();
} finally { await browser.close(); }
