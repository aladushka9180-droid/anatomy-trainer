import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');
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
    document.querySelector('#dashboard').hidden=false;
    document.querySelector('#bookingSheet').hidden=false;
    document.querySelector('#bookingSheetContent').innerHTML=`<h2>Новая запись</h2><form><label>Клиент<input value="Тест"></label><label>Услуга<select><option>Массаж</option></select></label><label>Дата<input type="date" value="2026-09-26"></label><label>Желаемое начало<input type="time" value="10:00"></label>${fieldHtml}<button class="primary">Сохранить до подключения</button></form>`;
    document.querySelector('#newBookingFlexibleEndField').hidden=false;
    document.body.classList.add('booking-sheet-open');
  },field);
  for (const width of [390,760,1440]) {
    await page.setViewportSize({width,height:900});
    assert.equal(await page.locator('#newBookingFlexibleEnd').isVisible(),true);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow,false,`provider flexible field overflows at ${width}`);
  }
  console.log('Provider offline flexible editor: 390/760/1440 field and no overflow passed');
} finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); }
