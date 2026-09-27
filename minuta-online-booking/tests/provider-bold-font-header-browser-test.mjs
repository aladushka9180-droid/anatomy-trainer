import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const playwright = process.env.MINUTA_PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href)
  : createRequire(import.meta.url)('playwright');
const chromium = playwright.chromium || playwright.default?.chromium;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const file = path.resolve(root, `.${pathname}`);
  if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404).end();
    return;
  }
  let content = fs.readFileSync(file);
  if (file.endsWith('.html')) {
    content = content.toString()
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/gi, '');
  }
  response.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
  response.end(content);
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless:true, executablePath:process.env.MINUTA_CHROME_PATH });
  const page = await browser.newPage({ viewport:{ width:360, height:800 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/provider.html`);
  await page.evaluate(() => {
    document.documentElement.classList.remove('provider-booting', 'requires-top-level');
    document.querySelector('#providerBoot')?.remove();
    const dashboard = document.querySelector('#dashboard');
    dashboard.hidden = false;
    dashboard.dataset.activeView = 'bookings';
    document.body.dataset.providerTheme = 'rose';
    document.body.dataset.providerLayout = 'soft';
    document.body.dataset.providerTextScale = 'default';
    document.querySelectorAll('.provider-view').forEach(view => {
      view.hidden = view.dataset.providerPanel !== 'bookings';
      view.classList.toggle('active', view.dataset.providerPanel === 'bookings');
    });
    document.querySelector('#todayLabel').textContent = 'Понедельник, 28 сентября';
  });
  const results = [];
  for (const width of [360, 390, 760, 1440]) {
    await page.setViewportSize({ width, height:900 });
    for (const mode of ['normal', 'bold']) {
      await page.evaluate(mode => {
        document.querySelector('#todayLabel').style.fontWeight = mode === 'bold' ? '900' : '';
        document.querySelector('#todayLabel').style.fontSize = mode === 'bold' ? '18px' : '';
      }, mode);
      await page.evaluate(() => document.fonts.ready);
      const result = await page.evaluate(() => {
        const date = document.querySelector('#todayLabel').getBoundingClientRect();
        const heading = document.querySelector('.schedule-view-title h2').getBoundingClientRect();
        const topbar = document.querySelector('.provider-topbar').getBoundingClientRect();
        const dateStyle = getComputedStyle(document.querySelector('#todayLabel'));
        return {
          dateBottom:date.bottom, headingTop:heading.top,
          dateHeight:date.height, dateWeight:dateStyle.fontWeight,
          topbarBottom:topbar.bottom,
          overlap:Math.max(0, Math.min(date.right,heading.right)-Math.max(date.left,heading.left)) > 1
            && Math.max(0, Math.min(date.bottom,heading.bottom)-Math.max(date.top,heading.top)) > 1,
          overflow:document.documentElement.scrollWidth > innerWidth + 2,
        };
      });
      results.push({ width, mode, ...result });
      if (width === 390 && mode === 'bold' && process.env.MINUTA_BOLD_HEADER_SCREENSHOT) {
        await page.screenshot({ path:process.env.MINUTA_BOLD_HEADER_SCREENSHOT, fullPage:false });
      }
    }
  }
  console.log(JSON.stringify(results, null, 2));
  assert.ok(results.every(result => !result.overlap), 'Date and schedule heading overlap');
  assert.ok(results.every(result => !result.overflow), 'Bold text causes page overflow');
  await page.setViewportSize({ width:390, height:900 });
  const panelResults = await page.evaluate(() => {
    document.querySelector('#todayLabel').style.fontWeight = '900';
    document.querySelector('#todayLabel').style.fontSize = '18px';
    document.body.style.fontWeight = '700';
    const dashboard = document.querySelector('#dashboard');
    return [...document.querySelectorAll('.provider-view[data-provider-panel]')].filter(panel => panel.dataset.providerPanel !== 'more').map(panel => {
      const panelName = panel.dataset.providerPanel;
      dashboard.dataset.activeView = panelName;
      document.querySelectorAll('.provider-view[data-provider-panel]').forEach(view => {
        view.hidden = view !== panel;
        view.classList.toggle('active', view === panel);
      });
      const date = document.querySelector('#todayLabel').getBoundingClientRect();
      const heading = [...panel.querySelectorAll('h1,h2')].find(element => element.getClientRects().length);
      const rect = heading?.getBoundingClientRect();
      return {
        panel:panelName,
        heading:heading?.textContent.trim() || '',
        dateOverlap:Boolean(rect && Math.max(0, Math.min(date.right,rect.right)-Math.max(date.left,rect.left)) > 1
          && Math.max(0, Math.min(date.bottom,rect.bottom)-Math.max(date.top,rect.top)) > 1),
        overflow:document.documentElement.scrollWidth > innerWidth + 2,
      };
    });
  });
  console.log(JSON.stringify(panelResults, null, 2));
  assert.ok(panelResults.every(result => !result.dateOverlap), 'Bold date overlaps a section heading');
  assert.ok(panelResults.every(result => !result.overflow), 'Bold font causes horizontal page overflow in a section');
} finally {
  await browser?.close();
  server.close();
}
