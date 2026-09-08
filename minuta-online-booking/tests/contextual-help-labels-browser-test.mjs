import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const providerHtml = await readFile(path.join(root, 'provider.html'), 'utf8');
const hosts = [...providerHtml.matchAll(/<div data-contextual-help[^>]*><\/div>/g)].map(match => match[0]);

assert.ok(hosts.length >= 20, 'Ожидались контекстные подсказки всех основных разделов');
assert.doesNotMatch(hosts.join(''), /Не совсем понятно\?/);

const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/') {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
      <link rel="stylesheet" href="/contextual-help.css">
      <style>*{box-sizing:border-box}body{margin:0;padding:20px;font:16px Arial,sans-serif}.help-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:16px;max-width:1100px;margin:auto}.help-host{min-width:0;padding:10px;border:1px solid #dce7df;border-radius:12px}</style>
      <body class="provider-body"><main class="help-grid">${hosts.map(host => `<section class="help-host">${host}</section>`).join('')}</main>
      <script src="/help/help-data.js"></script><script src="/contextual-help.js"></script></body>`);
    return;
  }
  const file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
  if (!file.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const content = await readFile(file);
    response.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'text/javascript; charset=utf-8');
    response.end(content);
  } catch {
    response.writeHead(404).end();
  }
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {})
});

try {
  for (const width of [390, 760, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 1100 } });
    await page.goto(origin);
    await page.evaluate(() => window.MinutaContextualHelp?.init());
    const labels = await page.locator('.contextual-help__trigger').allTextContents();
    assert.equal(labels.length, hosts.length, `${width}px: отрисованы не все подсказки`);
    assert.ok(labels.every(label => label.trim() && label.trim() !== 'Не совсем понятно?'), `${width}px: осталась общая подпись`);

    const geometry = await page.evaluate(() => ({
      bodyOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      triggers: [...document.querySelectorAll('.contextual-help__trigger')].map(trigger => {
        const rect = trigger.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width, height: rect.height };
      })
    }));
    assert.ok(geometry.bodyOverflow <= 1, `${width}px: появилась горизонтальная прокрутка`);
    for (const rect of geometry.triggers) {
      assert.ok(rect.left >= 0 && rect.right <= width + 1, `${width}px: подпись вышла за экран`);
      assert.ok(rect.width > 0 && rect.height >= (width <= 560 ? 40 : 32), `${width}px: кнопка подсказки слишком мала`);
    }

    const trigger = page.getByRole('button', { name: 'Как найти клиента?' });
    await trigger.click();
    await page.locator('.contextual-help__panel:not([hidden])').waitFor();
    assert.equal(await trigger.getAttribute('aria-expanded'), 'true', `${width}px: подсказка не раскрылась`);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

console.log('Contextual help labels browser test: PASS (390/760/1440)');
