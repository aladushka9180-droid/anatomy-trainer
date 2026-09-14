import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { layouts, themes } from './theme-card-fixture.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'provider.html'), 'utf8');
const styleLinks = [...html.matchAll(/<link\s+rel="stylesheet"\s+href="([^"]+)"[^>]*>/g)]
  .map(match => `<link rel="stylesheet" href="/${match[1]}">`).join('\n');

const fixture = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${styleLinks}<style>*,*::before,*::after{transition:none!important;animation:none!important}</style></head>
<body class="provider-body" data-provider-theme="sage" data-provider-layout="capsule" data-provider-text-scale="default">
<main class="provider-workspace"><section class="provider-view active" data-provider-panel="clients">
  <div class="view-title"><div><span>Клиентская база</span><h2>Клиенты</h2></div><div class="view-title-actions"><span class="panel-count" id="clientsCount">128</span><button class="primary compact-button" type="button" data-create-empty-booking aria-label="Создать запись"><svg class="ui-icon" aria-hidden="true"><use href="ui-icons.svg#icon-plus"></use></svg><span>Новая запись</span></button></div></div>
  <p class="view-description">История посещений, заметки и быстрая повторная запись в одном месте.</p>
  <div class="clients-layout"><section class="clients-directory"><div class="client-search"><input aria-label="Поиск клиента" placeholder="Имя или телефон"></div><div class="clients-list"><button class="client-list-item" type="button"><span class="client-list-avatar">А</span><span class="client-list-main"><strong>Анна — тестовый клиент</strong><small>+7 (900) 000-00-00</small><i>Нет будущих записей</i></span><b>3</b></button></div></section></div>
</section></main><script>document.querySelector('[data-create-empty-booking]').addEventListener('click',()=>document.body.dataset.createClicks=String(Number(document.body.dataset.createClicks||0)+1));</script></body></html>`;

const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  if (pathname === '/' || pathname === '/fixture') {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(fixture);
    return;
  }
  const file = path.resolve(root, `.${pathname}`);
  if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404).end();
    return;
  }
  response.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream');
  response.end(fs.readFileSync(file));
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless:true, executablePath:process.env.MINUTA_CHROME_PATH });
  const page = await browser.newPage({ viewport:{ width:390, height:844 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/fixture`);
  const widths = [320, 390, 760, 1440];
  const textScales = ['default', 'comfortable', 'large'];
  let combinations = 0;
  for (const width of widths) for (const textScale of textScales) for (const layout of layouts) for (const theme of themes) {
    await page.setViewportSize({ width, height:844 });
    await page.locator('body').evaluate((body, value) => {
      body.dataset.providerTheme = value.theme;
      body.dataset.providerLayout = value.layout;
      body.dataset.providerTextScale = value.textScale;
    }, { theme, layout, textScale });
    const state = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect();
      const title = rect('[data-provider-panel="clients"] .view-title');
      const heading = rect('[data-provider-panel="clients"] .view-title h2');
      const count = rect('#clientsCount');
      const button = rect('[data-create-empty-booking]');
      const label = rect('[data-create-empty-booking] span');
      const description = rect('[data-provider-panel="clients"] .view-description');
      const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > .5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > .5;
      return {
        title, heading, count, button, label, description,
        overflow:document.documentElement.scrollWidth > innerWidth + 1,
        headingCountOverlap:overlap(heading, count),
        countButtonOverlap:overlap(count, button),
        labelClipped:label.width < 1 || label.right > button.right + .5 || label.left < button.left - .5
      };
    });
    const prefix = `${theme}/${layout}/${textScale}/${width}px`;
    assert.equal(state.overflow, false, `${prefix}: no horizontal overflow`);
    assert.ok(state.title.left >= -.5 && state.title.right <= width + .5, `${prefix}: header stays inside viewport`);
    assert.ok(state.button.width >= 44 && state.button.height >= (width <= 760 ? 44 : 39), `${prefix}: create target stays comfortably clickable`);
    assert.equal(state.labelClipped, false, `${prefix}: button label stays visible`);
    assert.equal(state.headingCountOverlap || state.countButtonOverlap, false, `${prefix}: controls do not overlap`);
    assert.ok(state.description.top >= Math.max(state.heading.bottom, state.count.bottom, state.button.bottom), `${prefix}: description follows the complete header`);
    if (width <= 350) {
      assert.ok(Math.abs(state.heading.bottom - state.count.bottom) <= 4, `${prefix}: heading and count share a baseline`);
      assert.ok(state.button.top >= Math.max(state.heading.bottom, state.count.bottom) + 8, `${prefix}: narrow screen moves the whole button below`);
      assert.ok(Math.abs(state.button.left - state.heading.left) <= 1 && state.button.right <= state.title.right + .5 && state.button.width >= state.title.width - 32, `${prefix}: narrow button spans the usable header width safely (${JSON.stringify({ title:state.title, heading:state.heading, button:state.button })})`);
    } else if (width <= 760) {
      assert.ok(Math.abs(state.heading.bottom - state.count.bottom) <= 4, `${prefix}: heading and count share a baseline`);
      assert.ok(Math.abs(state.button.bottom - Math.max(state.heading.bottom, state.count.bottom)) <= 4, `${prefix}: ordinary mobile keeps the action on the title row`);
      assert.ok(state.count.left >= state.heading.right + 6, `${prefix}: count follows the title with breathing room`);
      assert.ok(state.button.left >= state.count.right + 8, `${prefix}: action keeps a clear outer gap`);
    }
    combinations += 1;
  }
  await page.setViewportSize({ width:390, height:844 });
  await page.locator('[data-create-empty-booking]').click();
  assert.equal(await page.locator('body').getAttribute('data-create-clicks'), '1', 'Create booking action remains clickable');
  if (process.env.MINUTA_CLIENTS_HEADER_SCREENSHOT) await page.screenshot({ path:process.env.MINUTA_CLIENTS_HEADER_SCREENSHOT, fullPage:true });
  console.log(`Provider clients header: PASS (${combinations} theme/layout/text-scale/width checks)`);
} finally {
  await browser?.close();
  server.close();
}
