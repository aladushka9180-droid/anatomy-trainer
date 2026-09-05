import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startFixtureServer, themes } from './theme-card-fixture.mjs';

const {server,url} = await startFixtureServer();
const browser = await chromium.launch({headless:true});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.getByRole('button',{name:'Проверить все сочетания'}).click();
  await page.waitForFunction(() => document.querySelector('#result').dataset.complete === 'true', undefined, {timeout:120000});
  const result = JSON.parse(await page.locator('#result').innerText());
  assert.equal(result.combinations,240);
  assert.deepEqual(result.failures,[]);
  // Actual :hover and keyboard :focus-visible, not synthetic class substitutes.
  for (const width of [390,1440]) for (const theme of themes) {
    await page.setViewportSize({width,height:1000});
    await page.goto(`${url}/fixture?theme=${theme}&layout=soft`);
    for (const selector of ['.client-list-item.client-vip','.client-list-item.client-favorite','.client-list-item.client-attention','.provider-booking.client-favorite','.timeline-booking.client-favorite']) {
      await page.locator(selector).first().hover();
      const check = await page.evaluate(async () => (await import('/checks.mjs')).inspectCardStates(document));
      assert.deepEqual(check.failures,[],`${theme}/${width}/${selector}`);
    }
    await page.locator('.client-search input').focus();
    await page.keyboard.press('Tab');
    const focus = await page.locator(':focus-visible').evaluate(element => ({outline:getComputedStyle(element).outlineStyle,width:parseFloat(getComputedStyle(element).outlineWidth)}));
    assert.equal(focus.outline,'solid'); assert.ok(focus.width >= 2);
  }
  assert.deepEqual(errors,[]);
  console.log(`PASS: ${result.combinations} theme/layout/viewport combinations, ${result.assertions} colour checks, minimum ${result.minimumContrast}:1; ${themes.length * 10} hover and ${themes.length * 2} keyboard-focus checks.`);
} finally { await browser.close(); server.close(); }
