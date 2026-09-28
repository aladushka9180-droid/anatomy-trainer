import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// The preview owns an in-memory bridge. No backend, user records or messages.
const root = fileURLToPath(new URL('..', import.meta.url));
const output = process.env.MINUTA_BRAND_OUTPUT;
if (output) fs.mkdirSync(output, { recursive:true });
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://local');
  const file = path.resolve(root, '.' + url.pathname);
  if (!file.startsWith(root) || !fs.existsSync(file)) return res.writeHead(404).end();
  let bytes = fs.readFileSync(file);
  if (url.pathname === '/provider-messages-preview.html') {
    bytes = bytes.toString()
      .replace("actorKind:'provider'", `actorKind:'${url.searchParams.get('role') === 'client' ? 'client' : 'provider'}'`)
      .replace("title:'Поддержка Eldion · preview'", `title:'${url.searchParams.get('custom') ? 'Поддержка PrimeTime · мой отдел' : 'Поддержка PrimeTime'}'`)
      .replace('рядом с вывеской Eldion.', 'рядом с вывеской PrimeTime.');
  }
  res.setHeader('content-type', ({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(file)] || 'text/plain');
  res.end(bytes);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless:true });
try {
  const page = await browser.newPage();
  for (const role of ['provider', 'client']) for (const width of [390, 760, 1440]) {
    await page.setViewportSize({width, height:900});
    await page.goto(`http://127.0.0.1:${server.address().port}/provider-messages-preview.html?role=${role}`);
    const product = role === 'provider' ? 'Eldion Pro' : 'Eldion';
    await page.getByRole('button', {name:new RegExp(`Поддержка ${product}.*Специалист`)}).click();
    assert.equal(await page.locator('#messageThreadTitle').innerText(), `Поддержка ${product}`);
    assert.ok((await page.locator('.message-center-heading').innerText()).includes(`помощь ${product}.`));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    if (output) await page.screenshot({path:path.join(output, `messages-${role}-${width}.png`)});
    if (width <= 760) await page.locator('[data-message-back]').click();
    await page.locator('[data-message-conversation]').first().click();
    assert.ok(await page.getByText('Вход со двора, рядом с вывеской PrimeTime.', {exact:true}).isVisible(), 'Quoted message content must remain unchanged');
  }
  await page.setViewportSize({width:1440, height:900});
  await page.goto(`http://127.0.0.1:${server.address().port}/provider-messages-preview.html?custom=1`);
  await page.getByRole('button', {name:/Поддержка PrimeTime · мой отдел.*Специалист/}).click();
  assert.equal(await page.locator('#messageThreadTitle').innerText(), 'Поддержка PrimeTime · мой отдел');
  console.log('Eldion messages brand: PASS (2 roles × 3 widths; legacy system title, custom title and quoted messages)');
} finally {
  await browser.close();
  server.close();
}
