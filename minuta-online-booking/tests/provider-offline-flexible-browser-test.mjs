import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)(process.env.MINUTA_PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const provider = readFileSync(resolve(root,'provider.js'),'utf8');
const field = provider.match(/<label id="newBookingFlexibleEndField"[^\n]*?<\/label>/)?.[0]
  .replace(/\$\{escapeHtml\(preset\.latestTime \|\| draft\?\.latestTime \|\| ''\)\}/,'18:00');
assert.ok(field,'The provider editor must render the flexible end control');
const html = readFileSync(resolve(root,'provider.html'),'utf8')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')
  .replace(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/gi,'');
const server = createServer((request,response) => {
  const name = decodeURIComponent(new URL(request.url,'http://localhost').pathname);
  const file = resolve(root,`.${name}`);
  if (file !== root && (!file.startsWith(root+sep) || !existsSync(file) || !statSync(file).isFile())) { response.writeHead(404).end(); return; }
  response.setHeader('content-type',extname(file)==='.css'?'text/css':'text/html; charset=utf-8');
  response.end(name==='/provider.html'?html:readFileSync(file));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  browser = await chromium.launch({headless:true,executablePath:process.env.MINUTA_CHROME_PATH});
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/provider.html`);
  await page.evaluate(fieldHtml => {
    document.documentElement.classList.remove('provider-booting','requires-top-level');
    document.querySelector('#providerBoot')?.remove();
    document.body.dataset.providerTheme='pink-porcelain';
    document.body.dataset.providerPorcelainCharacter='petal';
    document.querySelector('#dashboard').hidden=false;
    const sheet=document.querySelector('#bookingSheet');
    sheet.hidden=false;
    sheet.classList.add('new-booking-sheet','booking-sheet-wide');
    document.querySelector('#bookingSheetContent').innerHTML=`
      <h2 id="bookingSheetTitle">Новая запись</h2>
      <form class="booking-editor-form new-booking-form" data-mode="client">
        <div class="new-booking-layout">
          <section class="new-booking-section new-booking-date-time-section">
            <div class="new-booking-section-title"><div><strong>Когда</strong></div></div>
            <div class="new-booking-date-time-editor">
              <label class="new-booking-date-field"><span class="sr-only">Дата</span><input type="date" value="2026-09-26"></label>
              <div role="group"><div class="booking-editor-times booking-time-picker">
                <p class="booking-time-warning">Предварительные варианты из последней сохранённой копии.</p>
                <div class="booking-time-guide"><strong>Ближайшие окна</strong><span>Выбрано 14:00</span></div>
                <div class="booking-time-slots booking-time-slots-nearby"><button type="button">13:30</button><button type="button" class="active">14:00</button><button type="button">14:30</button></div>
                <details><summary>Показать остальные</summary></details>
              </div></div>
              ${fieldHtml}
            </div>
          </section>
        </div>
        <div class="booking-sheet-submit-bar"><button class="primary new-booking-submit" type="button">Сохранить до подключения</button></div>
      </form>`;
    document.querySelector('#newBookingFlexibleEndField').hidden=false;
    document.body.classList.add('booking-sheet-open');
  },field);
  for (const width of [360,390,760,1440]) {
    await page.setViewportSize({width,height:900});
    await page.waitForTimeout(450);
    assert.equal(await page.locator('#newBookingFlexibleEnd').isVisible(),true);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow,false,`provider flexible field overflows at ${width}`);
    const geometry = await page.locator('#newBookingFlexibleEndField').evaluate(el => ({
      field:el.getBoundingClientRect().width,
      section:el.closest('.new-booking-date-time-section').getBoundingClientRect().width,
    }));
    if (process.env.MINUTA_SCREENSHOT_DIR) await page.screenshot({path:`${process.env.MINUTA_SCREENSHOT_DIR}/provider-offline-flex-${width}.png`,fullPage:true});
    assert.ok(geometry.field >= geometry.section - 36,`flexible field occupies narrow column at ${width}: ${JSON.stringify(geometry)}`);
    await page.context().setOffline(true);
    await page.locator('#newBookingFlexibleEnd').fill('19:00');
    assert.equal(await page.locator('#newBookingFlexibleEnd').inputValue(),'19:00');
    await page.locator('.new-booking-date-time-section details summary').click();
    assert.equal(await page.locator('.new-booking-date-time-section details').getAttribute('open'),'');
    await page.context().setOffline(false);
    await page.evaluate(() => {
      document.querySelector('#newBookingFlexibleEndField').hidden=true;
      document.querySelector('.booking-time-warning').hidden=true;
    });
    assert.equal(await page.locator('#newBookingFlexibleEnd').isVisible(),false);
    assert.equal(await page.locator('.booking-time-slots button').count(),3);
    await page.evaluate(() => {
      document.querySelector('#newBookingFlexibleEndField').hidden=false;
      document.querySelector('.booking-time-warning').hidden=false;
      document.querySelector('#newBookingFlexibleEnd').value='18:00';
      document.querySelector('.new-booking-date-time-section details').open=false;
    });
  }
  console.log('Provider offline flexible editor: 360/390/760/1440 layout, offline control and online hidden state passed');
} finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); }
