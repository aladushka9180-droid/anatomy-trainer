import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { pathToFileURL } from 'node:url';

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const core = read('provider.js');
const exactTestSource = core.match(/function reportUtmIsTestSource\(row\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(exactTestSource, 'use the actual core test-source predicate');
const isTestSource = runInNewContext(`${exactTestSource}; reportUtmIsTestSource`);
assert.equal(isTestSource({ utm_source:'primetime_external_test' }), true);
assert.equal(isTestSource({ utm_source:' PRIMETIME_EXTERNAL_TEST ' }), true);
assert.equal(isTestSource({ utm_source:'primetime_external_test_2' }), false);
assert.equal(isTestSource({ utm_source:'my_primetime_external_test' }), false);
assert.equal(isTestSource({ utm_source:'master', utm_campaign:'free_slots' }), false);
for (const [id, weight] of [['visits','.3'],['payments','.25'],['clients','.2'],['load','.25']]) {
  assert.match(core, new RegExp(`id:'${id}'[^\\n]*weight:${weight.replace('.', '\\.')}`), `${id} weight remains agreed`);
}

const modulePath = process.env.MINUTA_PLAYWRIGHT_MODULE;
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const browser = await chromium.launch({ headless:true });
try {
  const page = await browser.newPage({ viewport:{ width:390, height:900 } });
  const html = read('provider.html');
  await page.goto('about:blank');
  await page.evaluate(source => {
    const parsed = new DOMParser().parseFromString(source, 'text/html');
    const report = document.importNode(parsed.querySelector('#analyticsView'), true);
    report.hidden = false;
    report.dataset.reportLoadState = 'ready';
    report.dataset.reportTab = 'overview';
    document.body.className = 'provider-body';
    document.body.dataset.providerTheme = 'pink-porcelain';
    document.body.dataset.providerLayout = 'soft';
    document.body.append(report);
  }, html);
  for (const name of ['styles.css','provider-ux.css','utm-funnel.css','statistics-audit-ui.css']) {
    await page.addStyleTag({ content:read(name) });
  }
  await page.addScriptTag({ content:`
    let sessionGeneration=1, reportScopedBookingsState={status:'ready',rows:[]}, reportDataSource='own', reportPeriod='last30';
    let reportPerformerFilter='all', importedBookingHistory=[], allBookings=[];
    let displayPreferences={analytics_goals_by_scope:{}};
    let reportUtmFunnelState={data:{rows:[]}};
    function reportRange(){return {start:'2026-09-01',end:'2026-09-30'};}
    function reportUsesScopedBookings(){return false;}
    function reportOrganizationId(){return 'org';}
    function reportOrganization(){return {name:'Тестовая организация'};}
    function reportGoalsScopeKey(){return reportDataSource==='demo'?'demo':'organization:org';}
    function reportUtmIsTestSource(row){return String(row?.utm_source||'').trim().toLowerCase()==='primetime_external_test';}
    function reportPerformerName(){return 'Вся команда';}
    function reportCompletedItems(rows){return rows;}
    function reportBookings(){return [];}
    function reportClientIdentity(row){return row.client_phone;}
    function isScheduleBlock(){return false;}
    function exportBookingsXlsxInBackground(){}
    function exportBookingsCsv(){}
    function exportBookingsPdf(){}
  ` });
  await page.addScriptTag({ content:read('statistics-audit-ui.js') });
  await page.addScriptTag({ content:read('statistics-audit-provider.js') });
  await page.locator('#reportHealthDetails').evaluate(node => { node.open = true; });
  assert.match(await page.locator('#reportHealthDetails').innerText(), /Посещения · 30%[\s\S]*Оплаты · 25%[\s\S]*Повторные клиенты · 20%[\s\S]*Загрузка · 25%/);
  assert.match(await page.locator('#reportHealthDetails summary').innerText(), /Индекс-ориентир/);
  assert.match(await page.locator('#reportGoalsScope').innerText(), /организации «Тестовая организация»/);
  assert.match(await page.locator('.report-goals-defaults').innerText(), /70%.*35%.*10%/);
  assert.match(await page.locator('#reportUtmExplanation').textContent(), /точной меткой utm_source=primetime_external_test/);
  await page.evaluate(() => {
    reportUtmFunnelState.data.rows = [
      {utm_source:'master',utm_campaign:'free_slots',utm_medium:'link'},
      {utm_source:'primetime_external_test',visitors:3}
    ];
    document.querySelector('.report-analytics-details').open = true;
    document.querySelector('#reportUtmFunnelCard').hidden = false;
    document.querySelector('#reportUtmFunnelCard').style.setProperty('display', 'grid', 'important');
    document.querySelector('#reportUtmFunnelSources').hidden = false;
    document.querySelector('#reportUtmFunnelSources').style.setProperty('display', 'grid', 'important');
    document.querySelector('#reportUtmFunnelSources').innerHTML = '<article><div><strong>master · free_slots</strong><small>link</small></div></article><aside class="report-utm-test-source"><strong>Виджет онлайн-записи</strong><small>Тестовые переходы с сайта · 3 посещения · не учитываются в показателях</small></aside>';
  });
  await page.waitForFunction(() => document.querySelector('#reportUtmFunnelSources article strong')?.textContent === 'Ссылка мастера · Свободные окна');
  assert.equal(await page.locator('#reportUtmExplanation').isVisible(), true, 'source methodology is visible');
  assert.equal(await page.locator('.report-utm-test-source strong').textContent(), 'Тестовые переходы');
  assert.match(await page.locator('.report-utm-test-source small').textContent(), /3 посещения · не учитываются/);
  await page.evaluate(() => {
    displayPreferences.analytics_goals_by_scope['organization:org'] = {utilization_percent:70};
    window.MinutaStatisticsAuditProvider.refresh();
  });
  assert.match(await page.locator('#reportGoalsScope').innerText(), /сохранённые цели этой области/);
  await page.evaluate(() => { reportDataSource='demo'; window.MinutaStatisticsAuditProvider.refresh(); });
  assert.match(await page.locator('#reportGoalsScope').innerText(), /демо-режима/);
  await page.evaluate(() => { reportDataSource='own'; window.MinutaStatisticsAuditProvider.refresh(); });
  const output = process.env.MINUTA_STATISTICS_OUTPUT;
  if (output) mkdirSync(output, { recursive:true });
  for (const width of [390,760,1440]) {
    await page.setViewportSize({ width, height:900 });
    await page.locator('#reportHealthDetails').evaluate(node => { node.open = true; });
    const overflow = await page.evaluate(() => ['#reportHealthDetails','#reportUtmFunnelCard'].filter(selector => {
      const node = document.querySelector(selector);
      return node && node.scrollWidth > node.clientWidth + 1;
    }));
    assert.deepEqual(overflow, [], `methodology sections fit ${width}px`);
    if (output) {
      await page.locator('#reportHealthDetails').screenshot({ path:path.join(output, `index-${width}.png`) });
      await page.locator('#reportUtmFunnelCard').screenshot({ path:path.join(output, `sources-${width}.png`) });
    }
    await page.locator('#reportGoalsDialog').evaluate(dialog => dialog.showModal());
    assert.equal(await page.locator('#reportGoalsScope').isVisible(), true);
    assert.equal(await page.locator('.report-goals-defaults').isVisible(), true);
    const dialogSize = await page.locator('#reportGoalsDialog').evaluate(dialog => ({
      width:dialog.getBoundingClientRect().width,
      right:dialog.getBoundingClientRect().right,
      scrollWidth:dialog.scrollWidth,
      clientWidth:dialog.clientWidth
    }));
    assert.ok(dialogSize.width <= width && dialogSize.right <= width + 1 && dialogSize.scrollWidth <= dialogSize.clientWidth + 1, `goals dialog fits ${width}px`);
    if (output) await page.locator('#reportGoalsDialog').screenshot({ path:path.join(output, `goals-${width}.png`) });
    await page.locator('#reportGoalsDialog').evaluate(dialog => dialog.close());
  }
  await page.close();
} finally { await browser.close(); }
console.log('statistics methodology N12/N16: PASS');
