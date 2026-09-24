import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const source = readFileSync(new URL('../provider.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const html = readFileSync(new URL('../provider.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
function declaration(name) {
  const start = source.search(new RegExp(`^function ${name}\\(`, 'm'));
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
const functions = ['displayPreferencesServerSnapshot', 'queueDisplayPreferencesSync', 'reportGoalsScopeKey', 'reportGoals', 'renderReportGoalsForm', 'reportGoalsFormValues', 'reportGoalsDirty', 'requestCloseReportGoals', 'openReportGoals', 'saveReportGoals'];
const handlers = source.slice(source.indexOf("$('#reportGoalsForm')?.addEventListener('submit'"), source.indexOf("$('#installAppButton').addEventListener", source.indexOf("$('#reportGoalsForm')?.addEventListener('submit'")));
const script = `
  const $ = selector => document.querySelector(selector);
  let currentUser = { id:'synthetic-user' }, reportDataSource = 'own', displayPreferences = { analytics_goals:{ revenue_rub:0, utilization_percent:70, repeat_percent:35, cancellation_percent:10 }, analytics_goals_by_scope:{} };
  let displayPreferencesUpdatedAt = 0, displayPreferencesPending = false, displayPreferencesSaveTimer = null, displayPreferencesSaveRevision = 0;
  let reportGoalsOriginalValues = null, reportGoalsSyncFeedbackActive = false;
  const DEFAULT_DISPLAY_PREFERENCES = { analytics_goals:{ revenue_rub:0, utilization_percent:70, repeat_percent:35, cancellation_percent:10 } };
  const reportOrganizationId = () => 'synthetic-org';
  const normalizeAnalyticsGoals = goals => ({...DEFAULT_DISPLAY_PREFERENCES.analytics_goals, ...goals});
  const normalizeDisplayPreferences = preferences => preferences;
  const persistLocalDisplayPreferences = () => {};
  const renderAnalytics = () => {};
  const displayPreferencesEqual = (a,b) => JSON.stringify(a.analytics_goals_by_scope) === JSON.stringify(b.analytics_goals_by_scope);
  const db = { auth:{ updateUser:async () => ({data:{user:currentUser},error:null}) } };
  ${functions.map(declaration).join('\n')}
  ${handlers}
  document.addEventListener('click', event => {
    if (event.target.closest('[data-close-report-goals]')) requestCloseReportGoals();
    if (event.target.closest('[data-report-goals-keep]')) { $('#reportGoalsDiscard').hidden = true; $('#reportGoalsDialog').classList.remove('is-confirming-discard'); $('#reportGoalRevenue')?.focus(); }
    if (event.target.closest('[data-report-goals-discard]')) $('#reportGoalsDialog').close();
  });
`;
assert.match(source, /if \(closeReportGoalsButton\) requestCloseReportGoals\(\)/);
const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? {channel:process.env.BROWSER_CHANNEL} : {}) });
try {
  for (const width of [390, 760, 1440]) {
    const context = await browser.newContext({ viewport:{width,height:900}, serviceWorkers:'block' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', route => route.request().url() === 'https://goals.test/' ? route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ru"><body></body></html>'}) : route.abort());
    await page.goto('https://goals.test/');
    await page.evaluate(markup => {
      const doc = new DOMParser().parseFromString(markup, 'text/html');
      document.body.append(doc.querySelector('#reportGoalsDialog').cloneNode(true));
      document.body.append(doc.querySelector('#reportGoalsSyncStatus').cloneNode(true));
      const status = document.createElement('p'); status.id = 'providerDisplayStatus'; document.body.append(status);
    }, html);
    await page.addStyleTag({content:css});
    await page.addScriptTag({content:script});
    await page.evaluate(() => openReportGoals());
    await page.locator('#reportGoalRevenue').fill('50000');
    await page.locator('[data-close-report-goals]').click();
    assert.equal(await page.locator('#reportGoalsDialog').evaluate(node => node.open), true, 'Dirty dialog closed');
    assert.equal(await page.locator('#reportGoalsDiscard').isVisible(), true, 'Discard choice missing');
    if (process.env.REPORT_GOALS_ARTIFACT_DIR) {
      await mkdir(process.env.REPORT_GOALS_ARTIFACT_DIR, {recursive:true});
      await page.screenshot({path:path.join(process.env.REPORT_GOALS_ARTIFACT_DIR, `report-goals-dirty-${width}.png`)});
    }
    const warningBox = await page.locator('#reportGoalsDiscard').evaluate(node => ({right:node.getBoundingClientRect().right, width:innerWidth}));
    assert.ok(warningBox.right <= warningBox.width, `Discard prompt overflows at ${width}px`);
    const discardBox = await page.locator('[data-report-goals-discard]').evaluate(node => ({bottom:node.getBoundingClientRect().bottom, height:innerHeight}));
    assert.ok(discardBox.bottom <= discardBox.height, `Discard action is below the viewport at ${width}px`);
    await page.locator('[data-report-goals-keep]').click();
    assert.equal(await page.locator('#reportGoalsDiscard').isVisible(), false);
    assert.equal(await page.locator('#reportGoalRevenue').evaluate(node => document.activeElement === node), true, 'Focus did not return to the form');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#reportGoalsDialog').evaluate(node => node.open), true, 'Escape discarded dirty goals');
    assert.equal(await page.locator('#reportGoalsDiscard').isVisible(), true, 'Escape did not offer discard choice');
    await page.locator('[data-report-goals-keep]').click();
    await page.locator('#reportGoalRevenue').fill('0');
    await page.locator('[data-close-report-goals]').click();
    assert.equal(await page.locator('#reportGoalsDialog').evaluate(node => node.open), false, 'Pristine dialog did not close');
    await page.evaluate(() => openReportGoals());
    await page.locator('#reportGoalRevenue').fill('50000');
    await page.locator('#reportGoalsForm button[type=submit]').click();
    await page.locator('#reportGoalsDialog').waitFor({state:'hidden'});
    await page.waitForFunction(() => document.querySelector('#reportGoalsSyncStatus')?.textContent === 'Сохранено в аккаунте');
    assert.equal(await page.locator('#reportGoalsSyncStatus').isVisible(), true, 'Sync status vanished with dialog');
    await page.evaluate(() => openReportGoals());
    await page.locator('#reportGoalRevenue').fill('60000');
    await page.locator('[data-close-report-goals]').click();
    await page.locator('[data-report-goals-discard]').click();
    assert.equal(await page.locator('#reportGoalsDialog').evaluate(node => node.open), false, 'Discard choice did not close');
    await page.evaluate(() => openReportGoals());
    assert.equal(await page.locator('#reportGoalRevenue').inputValue(), '50000', 'Discard choice changed saved goals');
    await page.locator('[data-close-report-goals]').click();
    await page.evaluate(() => { db.auth.updateUser = async () => ({data:null,error:new Error('synthetic sync failure')}); openReportGoals(); });
    await page.locator('#reportGoalRevenue').fill('70000');
    await page.locator('#reportGoalsForm button[type=submit]').click();
    await page.locator('#reportGoalsDialog').waitFor({state:'hidden'});
    await page.waitForFunction(() => document.querySelector('#reportGoalsSyncStatus')?.textContent?.includes('синхронизация не удалась'));
    assert.equal(await page.locator('#reportGoalsSyncStatus').isVisible(), true, 'Failed sync status is hidden');
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: dirty goals protected and sync result remains visible`);
    await context.close();
  }
} finally { await browser.close(); }
