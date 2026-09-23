import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const server = createServer(async (request, response) => {
  const name = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname).replace(/^\/+/, '');
  const target = path.resolve(root, name);
  if (!target.startsWith(path.resolve(root) + path.sep)) { response.writeHead(403); response.end(); return; }
  try {
    const data = await readFile(target);
    response.setHeader('Content-Type', target.endsWith('.html') ? 'text/html; charset=utf-8' : target.endsWith('.js') ? 'text/javascript; charset=utf-8' : target.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/octet-stream');
    response.setHeader('Cache-Control', 'no-store');
    response.end(data);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
let browser;
try {
  browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
  const out = path.join(root, '.test-artifacts');
  await mkdir(out, { recursive:true });
  for (const width of [390,760,1440]) {
    const page = await browser.newPage({ viewport:{ width,height:900 } });
    await page.route('**/*.supabase.co/**', route => route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}/my-bookings.html`, { waitUntil:'domcontentloaded' });
    await page.locator('#openPersonalTheme').click();
    await page.locator('label.client-theme-option.theme-pink-porcelain').click();
    await page.locator('label.porcelain-shade-petal-pink').click();
    await page.locator('label.porcelain-art-silk').click();
    const state = await page.evaluate(() => ({
      width:document.documentElement.scrollWidth,
      theme:document.body.dataset.clientTheme,
      character:document.body.dataset.clientPorcelainCharacter,
      saved:JSON.parse(localStorage.getItem('minuta-client-personal-presentation-v1') || 'null'),
      dialogWidth:document.querySelector('#personalThemeDialog').getBoundingClientRect().width
    }));
    assert.ok(state.width <= width + 1, `${width}px overflow ${state.width}`);
    assert.equal(state.theme,'pink-porcelain');
    assert.equal(state.character,'silk');
    assert.deepEqual(state.saved.porcelain,{ shade:'petal-pink',character:'silk' });
    await page.screenshot({ path:path.join(out,`pink-personal-${width}.png`) });
    await page.reload({ waitUntil:'domcontentloaded' });
    assert.equal(await page.locator('body').getAttribute('data-client-theme'),'pink-porcelain');
    console.log(`Personal theme ${width}px: no overflow, local persistence, dialog ${Math.round(state.dialogWidth)}px PASS`);
    await page.close();
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
