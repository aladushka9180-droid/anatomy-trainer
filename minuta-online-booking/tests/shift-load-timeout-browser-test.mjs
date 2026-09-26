import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless:true });
try {
  const page = await browser.newPage({ serviceWorkers:'block' });
  await page.route('https://shift-timeout.test/', route => route.fulfill({ contentType:'text/html', body:`
    <!doctype html><html><body>
      <section id="shiftsPanel" hidden><p id="shiftsLoading" hidden>Загружаем смены…</p>
        <p id="shiftsUnavailable" hidden><span id="shiftsUnavailableText"></span><button id="reloadShifts">Повторить</button></p>
        <div id="shiftWorkspace" hidden></div>
      </section>
      <input id="shiftStartDate" value="2026-09-23"><select id="shiftPeriod"><option value="14">14</option></select>
    </body></html>` }));
  await page.goto('https://shift-timeout.test/');
  await page.addScriptTag({ content:readFileSync(new URL('../shift-management.js', import.meta.url),'utf8') });
  await page.evaluate(() => {
    window.shiftCalls = 0;
    window.shiftController = MinutaShifts.createController({
      db:{rpc:() => {
        window.shiftCalls++;
        return window.shiftCalls === 1 ? new Promise(() => {}) : Promise.reject(new Error('network unavailable'));
      }},
      $:selector => document.querySelector(selector),
      getCurrentUser:() => ({id:'test-user'}),
      getSessionGeneration:() => 1,
      sessionIsCurrent:() => true,
      loadTimeoutMs:20
    });
    window.shiftController.bind();
  });
  const first = await page.evaluate(() => shiftController.setOrganization({id:'test-organization'}));
  assert.equal(first.ok,false);
  assert.equal(await page.locator('#shiftsLoading').isVisible(),false);
  assert.equal(await page.locator('#shiftsUnavailable').isVisible(),true);
  assert.match(await page.locator('#shiftsUnavailableText').textContent(),/Повторите загрузку/);
  await page.locator('#reloadShifts').click();
  await page.waitForFunction(() => shiftCalls === 2 && document.querySelector('#shiftsUnavailableText').textContent.includes('Не удалось загрузить'));
  assert.equal(await page.evaluate(() => shiftCalls),2);
  assert.equal(await page.locator('#shiftsLoading').isVisible(),false);
  assert.match(await page.locator('#shiftsUnavailableText').textContent(),/Не удалось загрузить/);
  console.log('Shift timeout/retry browser test passed');
} finally {
  await browser.close();
}
