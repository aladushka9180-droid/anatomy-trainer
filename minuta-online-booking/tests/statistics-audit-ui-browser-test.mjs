import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.MINUTA_PLAYWRIGHT_MODULE;
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const html = readFileSync(new URL('../provider.html', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const auditStyles = readFileSync(new URL('../statistics-audit-ui.css', import.meta.url), 'utf8');
const auditScript = readFileSync(new URL('../statistics-audit-ui.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ headless:true });

try {
  for (const width of [390, 760, 1440]) {
    const page = await browser.newPage({ viewport:{ width, height:900 } });
    await page.goto('about:blank');
    await page.evaluate(source => {
      const parsed = new DOMParser().parseFromString(source, 'text/html');
      const report = parsed.querySelector('#analyticsView');
      document.body.className = 'provider-body';
      document.body.dataset.providerTheme = 'sage-studio';
      document.body.dataset.providerLayout = 'soft';
      document.body.style.margin = '0';
      document.body.style.padding = '12px';
      document.body.append(document.importNode(report, true));
      const root = document.querySelector('#analyticsView');
      root.hidden = false;
      root.dataset.reportTab = 'clients';
      root.dataset.reportEmpty = 'false';
      root.querySelector('.report-filters').classList.add('is-open');
      root.querySelector('.report-analytics-details').open = true;
      root.querySelector('#reportHeatmap').innerHTML = '<span class="report-heatmap-corner"></span>'
        + Array.from({ length:7 }, (_, i) => `<b>${i + 1}</b>`).join('')
        + '<strong>10:00</strong>' + Array.from({ length:7 }, () => '<button class="report-heatmap-cell"><i>5</i></button>').join('');
      document.querySelector('#reportUniqueClients').textContent = '2';
      document.querySelector('#reportNewClients').textContent = '1';
      document.querySelector('#reportReturningClients').textContent = '1';
    }, html);
    await page.addStyleTag({ content:styles });
    await page.addStyleTag({ content:auditStyles });
    await page.addScriptTag({ content:auditScript });
    await page.evaluate(() => {
      const first = { client_name:'<img src=x onerror=alert(1)>', client_phone:'79991111111', booking_date:'2026-09-02', booking_time:'10:00' };
      const firstAgain = { ...first, booking_date:'2026-09-10', booking_time:'12:00' };
      const second = { client_name:'Мария', client_phone:'79992222222', booking_date:'2026-09-03', booking_time:'10:00' };
      window.auditTest = { scope:{ session:1, organization:'org-1', source:'own', start:'2026-09-01', end:'2026-09-30', performer:'all', performerName:'Вся команда', status:'ready' }, downloads:[] };
      window.auditTest.legacyDownloads = 0;
      window.auditTest.legacyDateSubmits = 0;
      document.querySelector('#exportBookings').addEventListener('click', () => document.querySelector('#reportExportDialog').showModal());
      for (const button of document.querySelectorAll('[data-report-export]')) button.addEventListener('click', () => { window.auditTest.legacyDownloads += 1; });
      document.querySelector('#reportCustomPeriod').addEventListener('submit', event => { event.preventDefault(); window.auditTest.legacyDateSubmits += 1; });
      window.auditController = window.MinutaStatisticsAuditUI.create({
        document,
        getScope:() => window.auditTest.scope,
        getSegments:() => window.MinutaStatisticsAuditUI.buildClientSegments({ completed:[first,firstAgain,second], history:[{ client_phone:'79992222222' }], identityFor:item => item.client_phone }),
        download:(format,privacy) => window.auditTest.downloads.push({ format,privacy })
      });
      window.auditController.mount();
    });
    assert.equal(await page.locator('.report-segment-button').count(), 3);
    await page.locator('[data-report-segment="new"]').click();
    assert.match(await page.locator('.report-segment-dialog').innerText(), /1 клиент/);
    assert.match(await page.locator('.report-segment-dialog').innerText(), /визитов 2/);
    assert.equal(await page.locator('.report-segment-dialog img').count(), 0, 'client name is text');
    assert.doesNotMatch(await page.locator('.report-segment-dialog').innerText(), /79991111111/);
    await page.locator('.report-segment-dialog [data-audit-close]').click();
    await page.locator('#exportBookings').click();
    assert.match(await page.locator('#reportExportDialog .report-audit-scope').innerText(), /01.09.2026 — 30.09.2026 · Вся команда/);
    await page.locator('#reportExportPrivacy').selectOption('full');
    await page.locator('[data-report-export="csv"]').click();
    await page.locator('.report-export-review [data-audit-confirm]').click();
    assert.equal(await page.evaluate(() => window.auditTest.downloads.length), 0, 'full phones require confirmation');
    await page.locator('.report-export-review input[type="checkbox"]').check();
    await page.locator('.report-export-review [data-audit-confirm]').click();
    assert.deepEqual(await page.evaluate(() => window.auditTest.downloads), [{ format:'csv', privacy:'full' }]);
    assert.equal(await page.evaluate(() => window.auditTest.legacyDownloads), 0, 'old direct export listener is intercepted');
    await page.locator('#exportBookings').click();
    await page.locator('#reportExportPrivacy').selectOption('masked');
    await page.locator('[data-report-export="pdf"]').click();
    await page.locator('.report-export-review [data-audit-cancel]').click();
    assert.equal(await page.evaluate(() => window.auditTest.downloads.length), 1, 'cancel never downloads');
    await page.locator('#exportBookings').click();
    await page.locator('[data-report-export="xlsx"]').click();
    await page.evaluate(() => { window.auditTest.scope = { ...window.auditTest.scope, performer:'staff-1' }; window.auditController.refresh(); });
    assert.equal(await page.locator('.report-export-review').evaluate(el => el.open), false, 'scope change closes review');
    assert.equal(await page.evaluate(() => window.auditTest.downloads.length), 1);
    await page.evaluate(() => { document.querySelector('#reportDateFrom').value = '2026-09-30'; document.querySelector('#reportDateTo').value = '2026-09-01'; document.querySelector('#reportCustomPeriod').requestSubmit(); });
    assert.equal(await page.locator('#reportDateTo').getAttribute('aria-invalid'), 'true');
    assert.match(await page.locator('#reportDateToError').innerText(), /раньше начала/);
    assert.equal(await page.evaluate(() => window.auditTest.legacyDateSubmits), 0, 'invalid dates never reach old handler');
    await page.evaluate(() => { document.querySelector('#reportDateTo').value = '2026-10-01'; });
    assert.equal(await page.evaluate(() => window.auditController.validateCustomDates()), true);
    await page.evaluate(() => document.querySelector('#reportCustomPeriod').requestSubmit());
    assert.equal(await page.evaluate(() => window.auditTest.legacyDateSubmits), 1);
    const layout = await page.evaluate(() => {
      const size = selector => Math.round(document.querySelector(selector).getBoundingClientRect().height);
      const segment = size('.report-segment-button');
      document.querySelector('#analyticsView').dataset.reportTab = 'overview';
      const heatmap = document.querySelector('#reportHeatmap');
      return { segment, period:size('.report-periods button'),
        heatmapOverflow:heatmap.scrollWidth > heatmap.clientWidth + 1,
        pageOverflow:document.documentElement.scrollWidth > innerWidth + 1,
        hint:getComputedStyle(document.querySelector('#reportHeatmapScrollHint')).display };
    });
    assert.equal(layout.pageOverflow, false, `${width}px page overflow`);
    assert.ok(layout.segment >= 44);
    if (width <= 760) {
      assert.ok(layout.period >= 44, `${width}px period target`);
    }
    if (width <= 600) {
      assert.equal(layout.heatmapOverflow, true, `${width}px heatmap scrolls`);
      assert.notEqual(layout.hint, 'none');
    }
    if (width === 390) {
      const smallTargets = await page.evaluate(() => {
        const report = document.querySelector('#analyticsView');
        const found = [];
        for (const tab of ['overview', 'money', 'clients', 'team']) {
          report.dataset.reportTab = tab;
          for (const button of report.querySelectorAll('button')) {
            if (button.closest('dialog') || !button.getClientRects().length) continue;
            const height = button.getBoundingClientRect().height;
            if (height > 0 && height < 44) found.push({ tab, className:button.className, text:button.textContent.trim().slice(0, 30), height:Math.round(height) });
          }
        }
        return found;
      });
      assert.deepEqual(smallTargets, [], `390px small targets: ${JSON.stringify(smallTargets)}`);
    }
    await page.close();
  }
} finally {
  await browser.close();
}
