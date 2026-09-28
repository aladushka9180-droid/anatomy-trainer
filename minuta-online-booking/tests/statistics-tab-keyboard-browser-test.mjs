import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const html = read('provider.html');
const provider = read('provider.js');
const nav = html.match(/<nav class="report-view-tabs"[\s\S]*?<\/nav>/)?.[0];
assert.ok(nav, 'real Statistics tabs exist');
const start = provider.indexOf("$('.report-view-tabs')?.addEventListener('keydown', event => {");
const end = provider.indexOf("$('#reportGoalsForm')?.addEventListener", start);
assert.ok(start >= 0 && end > start, 'real Statistics keyboard handler exists');
const handler = provider.slice(start, end);

const modulePath = process.env.MINUTA_PLAYWRIGHT_MODULE;
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
try {
  const page = await browser.newPage();
  await page.setContent(`<section id="analyticsView" data-report-tab="overview">${nav}</section>`);
  await page.addScriptTag({ content:`
    const $ = selector => document.querySelector(selector);
    const $$ = selector => [...document.querySelectorAll(selector)];
    window.tabChanges = [];
    function setReportSubview(view, { focus = false } = {}) {
      document.querySelector('#analyticsView').dataset.reportTab = view;
      window.tabChanges.push(view);
      if (focus) document.querySelector('[data-report-view="' + view + '"]').focus();
    }
    ${handler}
  ` });
  const state = () => page.evaluate(() => ({
    tab:document.querySelector('#analyticsView').dataset.reportTab,
    focus:document.activeElement?.dataset.reportView,
    changes:window.tabChanges.length
  }));
  for (const [from, key] of [['overview', 'End'], ['team', 'Home']]) {
    await page.evaluate(view => {
      document.querySelector('#analyticsView').dataset.reportTab = view;
    }, from);
    for (const modifier of ['Control', 'Meta', 'Alt']) {
      await page.locator(`[data-report-view="${from}"]`).press(`${modifier}+${key}`);
      assert.deepEqual(await state(), { tab:from, focus:from, changes:0 }, `${modifier}+${key} must not switch tabs from ${from}`);
    }
  }
  await page.evaluate(() => { document.querySelector('#analyticsView').dataset.reportTab = 'overview'; });
  for (const [from, key, tab] of [['overview', 'ArrowRight', 'money'], ['money', 'ArrowLeft', 'overview'], ['overview', 'End', 'team'], ['team', 'Home', 'overview']]) {
    await page.locator(`[data-report-view="${from}"]`).press(key);
    const actual = await state();
    assert.equal(actual.tab, tab, `${key} selects ${tab}`);
    assert.equal(actual.focus, tab, `${key} focuses ${tab}`);
  }
  console.log('Statistics tab keyboard browser: PASS');
} finally {
  await browser.close();
}
