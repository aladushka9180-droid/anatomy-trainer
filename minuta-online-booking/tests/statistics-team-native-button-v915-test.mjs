import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const source = fs.readFileSync(path.join(root, 'provider.js'), 'utf8');
const start = source.indexOf('function renderReportTeamRows(rows) {');
const end = source.indexOf('\nasync function loadReportTeamAnalytics(', start);
assert.ok(start >= 0 && end > start, 'Team renderer must be present');
const renderer = source.slice(start, end);
const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless:true });
try {
  for (const width of [390, 760, 1440]) {
    const page = await browser.newPage({ viewport:{ width, height:900 } });
    await page.setContent('<body class="provider-body" data-provider-theme="pink-porcelain" data-provider-layout="soft" data-provider-color-mode="light" data-provider-resolved-color-mode="light"><main id="analyticsView" style="max-width:900px;margin:auto"><section class="panel report-performers" id="reportPerformers"><div class="report-section-heading"><div><small>Команда</small><h3>Рейтинг сотрудников</h3></div></div><div class="report-team-controls"><button data-report-team-metric="revenue">Выручка</button></div><p id="reportTeamMetricNote"></p><div class="report-performer-list" id="reportPerformersList"></div></section><select id="reportPerformerFilter"><option value="all">Вся команда</option><option value="master-1">Мастер</option></select></main></body>');
    await page.addStyleTag({ path:path.join(root, 'styles.css') });
    await page.addScriptTag({ content:`
      var reportCanViewTeam=true, reportPerformerFilter='all', reportTeamMetric='revenue', reportTeamAnalyticsState={rows:[]};
      var fixture=[{performer_id:'master-1',performer_name:'Мастер',completed_visits:3,unique_clients:2,worked_minutes:180,revenue_rub:6000,payment_known_visits:3}];
      var $=selector=>document.querySelector(selector), $$=selector=>[...document.querySelectorAll(selector)];
      var reportRange=()=>({start:'2026-09-01',end:'2026-09-30'}), reportBookings=()=>[], reportCompletedItems=items=>items;
      var reportReconciledTeamRows=()=>fixture, setReportText=(selector,value)=>$(selector).textContent=value;
      var reportVisitWord=()=> 'визита', reportHours=()=> '3 ч', money=value=>value+' ₽';
      var escapeHtml=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
      ${renderer}
      renderReportTeamRows([]);
      window.teamSelectionCount=0;
      $('#reportPerformerFilter').addEventListener('change',()=>window.teamSelectionCount++);
    ` });
    const row = page.getByRole('button', { name:'Открыть статистику сотрудника Мастер' });
    assert.equal(await row.count(), 1);
    const initial = await row.evaluate(element => ({ tag:element.tagName, type:element.getAttribute('type'), role:element.getAttribute('role'), tabIndex:element.tabIndex, width:element.getBoundingClientRect().width, overflow:document.documentElement.scrollWidth > innerWidth + 2 }));
    assert.equal(initial.tag, 'BUTTON');
    assert.equal(initial.type, 'button');
    assert.equal(initial.role, null);
    assert.equal(initial.tabIndex, 0);
    assert.ok(initial.width > 200, `${width}px: row must be usable`);
    assert.equal(initial.overflow, false, `${width}px: no horizontal overflow`);
    if (process.env.MINUTA_VISUAL_OUTPUT) await page.locator('#analyticsView').screenshot({ path:path.join(process.env.MINUTA_VISUAL_OUTPUT, `statistics-team-v915-${width}.png`) });
    await row.focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#reportPerformerFilter').inputValue(), 'master-1');
    await page.locator('#reportPerformerFilter').selectOption('all');
    await row.focus();
    await page.keyboard.press('Space');
    assert.equal(await page.locator('#reportPerformerFilter').inputValue(), 'master-1');
    assert.equal(await page.evaluate(() => window.teamSelectionCount), 3);
    await page.close();
  }
  console.log('Statistics team native button: 390/760/1440, Enter/Space, no overflow');
} finally {
  await browser.close();
}
