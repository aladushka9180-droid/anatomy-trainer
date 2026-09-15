import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'provider.html'), 'utf8');
const providerJs = fs.readFileSync(path.join(root, 'provider.js'), 'utf8');
const notifySource = providerJs.match(/function notify\(message\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(notifySource, 'Provider notify implementation is available');
const styleLinks = [...html.matchAll(/<link\s+rel="stylesheet"\s+href="([^"]+)"[^>]*>/g)]
  .map(match => `<link rel="stylesheet" href="/${match[1]}">`).join('\n');

const firstMessage = 'Дополнительные поля включены';
const longMessage = 'Настройки сохранены на этом устройстве и будут отправлены после восстановления связи';
const fixture = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">${styleLinks}<style>*,*::before,*::after{transition:none!important;animation:none!important}.fixture-content{min-height:900px;padding:16px}.fixture-action{min-height:44px}.provider-mobile-nav{display:grid!important}</style></head>
<body class="provider-body" data-provider-theme="petrol-steel" data-provider-layout="capsule" data-provider-text-scale="default"><main class="provider-workspace"><section class="fixture-content"><button class="primary fixture-action" id="firstNotice" type="button">${firstMessage}</button><button class="secondary-button fixture-action" id="secondNotice" type="button">${longMessage}</button></section></main><nav class="provider-mobile-nav" aria-label="Разделы кабинета"><button type="button"><span>Записи</span></button><button class="active" type="button"><span>Клиенты</span></button><button type="button"><span>Уведомления</span></button><button type="button"><span>Статистика</span></button><button type="button"><span>Разделы</span></button></nav><div class="toast" id="toast" role="status" aria-live="polite" aria-atomic="true" hidden></div><script>const $=selector=>document.querySelector(selector);${notifySource};$('#firstNotice').addEventListener('click',()=>notify(${JSON.stringify(firstMessage)}));$('#secondNotice').addEventListener('click',()=>notify(${JSON.stringify(longMessage)}));</script></body></html>`;

const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  if (pathname === '/' || pathname === '/fixture') { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(fixture); return; }
  const file = path.resolve(root, `.${pathname}`);
  if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404).end(); return; }
  response.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'application/octet-stream');
  response.end(fs.readFileSync(file));
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless:true, executablePath:process.env.MINUTA_CHROME_PATH });
  const page = await browser.newPage({ viewport:{ width:390, height:844 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/fixture`);
  await page.locator('#firstNotice').click();
  await page.waitForFunction(message => document.querySelector('#toast')?.textContent === message, firstMessage);
  assert.equal(await page.locator('#toast').innerText(), firstMessage, 'A real setting toggle announces its result');
  await page.locator('#secondNotice').click();
  await page.waitForFunction(message => document.querySelector('#toast')?.textContent === message, longMessage);
  assert.equal(await page.locator('#toast').innerText(), longMessage, 'A later long notice replaces the earlier one');
  await page.locator('#secondNotice').click();
  assert.equal(await page.locator('#toast').count(), 1, 'Repeated notices reuse one live region');
  assert.equal(await page.locator('#toast').getAttribute('role'), 'status');
  assert.equal(await page.locator('#toast').getAttribute('aria-live'), 'polite');
  assert.equal(await page.locator('#toast').getAttribute('aria-atomic'), 'true');

  for (const theme of ['sage', 'midnight']) for (const width of [390, 760, 1440]) {
    await page.setViewportSize({ width, height:844 });
    await page.locator('body').evaluate((body, value) => {
      body.dataset.providerTheme = value;
      body.style.setProperty('--provider-safe-area-bottom', '24px');
    }, theme);
    await page.locator('#toast').evaluate((toast, message) => { toast.hidden = false; toast.textContent = message; }, longMessage);
    const state = await page.evaluate(() => {
      const toast = document.querySelector('#toast');
      const nav = document.querySelector('.provider-mobile-nav');
      const toastRect = toast.getBoundingClientRect();
      const navRect = nav.getBoundingClientRect();
      const style = getComputedStyle(toast);
      const rgba = value => {
        const rgb = value.match(/^rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?/i);
        if (rgb) return [Number(rgb[1]),Number(rgb[2]),Number(rgb[3]),rgb[4] === undefined ? 1 : Number(rgb[4])];
        const srgb = value.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?/i);
        if (srgb) return [Number(srgb[1])*255,Number(srgb[2])*255,Number(srgb[3])*255,srgb[4] === undefined ? 1 : Number(srgb[4])];
        throw new Error(`Unsupported colour: ${value}`);
      };
      const blend = (front, back) => front.slice(0,3).map((channel,index) => channel * front[3] + back[index] * (1 - front[3]));
      const luminance = channels => channels.map(channel => { const value=channel/255; return value <= .04045 ? value/12.92 : ((value+.055)/1.055)**2.4; }).reduce((sum,value,index) => sum + value * [.2126,.7152,.0722][index],0);
      const foreground = rgba(style.color);
      const background = blend(rgba(style.backgroundColor), rgba(getComputedStyle(document.body).backgroundColor));
      const light = Math.max(luminance(foreground.slice(0,3)),luminance(background));
      const dark = Math.min(luminance(foreground.slice(0,3)),luminance(background));
      return { toastRect, navRect, contrast:(light+.05)/(dark+.05), style:{ background:style.backgroundColor, color:style.color, border:style.borderTopWidth, pointerEvents:style.pointerEvents }, overflow:document.documentElement.scrollWidth > innerWidth + 1 };
    });
    assert.equal(state.overflow, false, `${width}px: long notice does not create horizontal overflow`);
    assert.ok(state.toastRect.left >= 11.5 && state.toastRect.right <= width - 11.5, `${width}px: notice stays inside safe horizontal edges`);
    assert.ok(state.toastRect.height <= 82, `${width}px: notice remains compact with long Russian text`);
    assert.equal(state.style.pointerEvents, 'none', `${width}px: notice cannot block the underlying action`);
    assert.notEqual(state.style.background, state.style.color, `${width}px: themed surface and text remain distinct`);
    assert.ok(state.contrast >= 4.5, `${width}px: themed text contrast stays at least 4.5:1 (${state.contrast.toFixed(2)}:1)`);
    assert.equal(state.style.border, '1px', `${width}px: notice keeps a themed contrast edge`);
    if (width <= 760) assert.ok(state.toastRect.bottom <= state.navRect.top - 9.5, `${width}px: notice stays above navigation and simulated safe area`);
  }

  await page.setViewportSize({ width:390, height:844 });
  await page.locator('body').evaluate(body => { body.dataset.providerTheme = 'midnight'; });
  await page.locator('#secondNotice').click();
  await page.waitForFunction(message => document.querySelector('#toast')?.textContent === message, longMessage);
  if (process.env.MINUTA_TOAST_SCREENSHOT) await page.screenshot({ path:process.env.MINUTA_TOAST_SCREENSHOT, fullPage:false });
  await page.waitForTimeout(2900);
  assert.equal(await page.locator('#toast').isVisible(), false, 'Notice disappears after its display interval');
  console.log('Provider toast responsive: PASS (2 real clicks, replacement, dismissal, 390/760/1440 and safe-area simulation)');
} finally {
  await browser?.close();
  server.close();
}
