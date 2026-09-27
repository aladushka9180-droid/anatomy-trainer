import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = process.env.MINUTA_CONNECTION_GUIDANCE_OUTPUT || '';
if (output) fs.mkdirSync(output, { recursive:true });
const html = fs.readFileSync(path.join(root, 'provider.html'), 'utf8')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/gi, '');
const server = http.createServer((request, response) => {
  const requested = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const file = path.resolve(root, `.${requested}`);
  if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404).end(); return; }
  response.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'application/javascript' : 'text/html; charset=utf-8');
  response.end(file.endsWith('provider.html') ? html : fs.readFileSync(file));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

let browser;
try {
  browser = await chromium.launch({ headless:true, executablePath:process.env.MINUTA_CHROME_PATH });
  const page = await browser.newPage();
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.goto(`${base}/provider.html`);
  await page.addStyleTag({ url:`${base}/provider-connection-guidance.css` });
  await page.addScriptTag({ url:`${base}/provider-connection-guidance.js` });
  await page.evaluate(() => {
    document.documentElement.classList.remove('provider-booting', 'requires-top-level');
    document.querySelector('#providerBoot')?.remove();
    document.querySelector('#dashboard').hidden = false;
    document.querySelector('#dashboard').dataset.activeView = 'bookings';
    document.querySelectorAll('.provider-view').forEach(view => { view.hidden = view.dataset.providerPanel !== 'bookings'; });
    document.querySelector('.schedule-view-title').insertAdjacentHTML('afterend', `
      <section class="provider-connection-guidance" id="providerConnectionGuidance" aria-live="polite" hidden>
        <div class="provider-connection-guidance-copy"><strong id="providerConnectionGuidanceTitle"></strong><span id="providerConnectionGuidanceDescription"></span>
          <details class="provider-connection-guidance-help" id="providerConnectionGuidanceHelp"><summary>Что делать?</summary><p>Проверьте Wi‑Fi или мобильный интернет. Если связь не восстановилась, попробуйте выключить и снова включить подключение.</p></details>
        </div><div class="provider-connection-guidance-actions"><button class="secondary-button compact-button" id="providerConnectionGuidanceCheck" type="button">Проверить связь</button><button class="secondary-button compact-button" id="providerConnectionGuidanceInspect" type="button" hidden>Посмотреть</button></div>
      </section>`);
    window.setGuidance = state => {
      const result = window.MinutaProviderConnectionGuidance.view(state);
      const panel = document.querySelector('#providerConnectionGuidance');
      panel.hidden = !result;
      if (!result) return;
      document.querySelector('#providerConnectionGuidanceTitle').textContent = result.title;
      document.querySelector('#providerConnectionGuidanceDescription').textContent = result.description;
      document.querySelector('#providerConnectionGuidanceHelp').hidden = !result.help;
      document.querySelector('#providerConnectionGuidanceInspect').hidden = !result.inspect;
    };
  });
  for (const width of [390, 760, 1440]) {
    await page.setViewportSize({ width, height:850 });
    await page.evaluate(() => window.setGuidance({ online:false, hasUser:true, sessionTrust:'cached', canQueueBooking:true, hasSavedSchedule:true }));
    const panel = page.locator('#providerConnectionGuidance');
    assert.equal(await panel.isVisible(), true);
    assert.match(await panel.innerText(), /Нет интернета/);
    assert.match(await panel.innerText(), /Можно смотреть сохранённые записи и добавлять новые/);
    await page.locator('#providerConnectionGuidanceHelp summary').click();
    assert.match(await panel.innerText(), /Проверьте Wi‑Fi или мобильный интернет/);
    const geometry = await page.evaluate(() => ({
      overflow:document.documentElement.scrollWidth > innerWidth + 2,
      title:document.querySelector('#providerConnectionGuidanceTitle').getBoundingClientRect().width,
      button:document.querySelector('#providerConnectionGuidanceCheck').getBoundingClientRect().width
    }));
    assert.equal(geometry.overflow, false, `${width}px horizontal overflow`);
    assert.ok(geometry.title > 0 && geometry.button >= 100, `${width}px content visible`);
    if (output) await page.screenshot({ path:path.join(output, `connection-guidance-${width}.png`) });
    await page.locator('#providerConnectionGuidanceHelp summary').click();
  }
  await page.evaluate(() => window.setGuidance({ online:true, hasUser:true, sessionTrust:'verified', serverUnavailable:true, canQueueBooking:false, hasSavedSchedule:false }));
  assert.match(await page.locator('#providerConnectionGuidance').innerText(), /Нет связи с сервером/);
  assert.equal(await page.locator('#providerConnectionGuidanceHelp').isVisible(), false);
  await page.evaluate(() => window.setGuidance({ online:true, hasUser:true, sessionTrust:'verified', recovery:{ kind:'complete', text:'Сохранены 2 записи, 1 запись требует проверки' } }));
  assert.equal(await page.locator('#providerConnectionGuidanceInspect').isVisible(), true);
  await page.evaluate(() => window.setGuidance({ online:true, hasUser:true, sessionTrust:'verified' }));
  assert.equal(await page.locator('#providerConnectionGuidance').isVisible(), false);
  console.log('provider connection guidance browser: 390/760/1440, offline/help/server/recovery/normal online PASS');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
