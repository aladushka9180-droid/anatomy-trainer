import assert from 'node:assert/strict';
import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const directory = path.dirname(fileURLToPath(new URL('../provider.html', import.meta.url)));
const playwrightPath = process.env.PLAYWRIGHT_MODULE;
const { chromium } = await import(playwrightPath ? pathToFileURL(playwrightPath).href : 'playwright');
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}),
});

const mime = new Map([
  ['.css', 'text/css'], ['.html', 'text/html'], ['.js', 'text/javascript'],
  ['.svg', 'image/svg+xml'], ['.png', 'image/png'], ['.webp', 'image/webp'],
  ['.json', 'application/json'], ['.webmanifest', 'application/manifest+json'],
]);

try {
  const page = await browser.newPage();
  await page.route('https://waitlist-preview.test/**', async route => {
    const url = new URL(route.request().url());
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'provider.html';
    const resolved = path.resolve(directory, relative);
    assert.ok(resolved.startsWith(`${directory}${path.sep}`), 'Preview request escaped the application directory');
    try {
      await stat(resolved);
      let body = await readFile(resolved);
      if (relative === 'provider.html') {
        body = Buffer.from(body.toString('utf8')
          .replace(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/i, '')
          .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''));
      }
      await route.fulfill({ status: 200, contentType: mime.get(path.extname(resolved)) || 'application/octet-stream', body });
    } catch {
      await route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' });
    }
  });

  await page.goto('https://waitlist-preview.test/provider.html?section=waitlist#/waitlist');
  await page.evaluate(() => {
    document.documentElement.classList.remove('provider-booting');
    document.documentElement.classList.add('top-level', 'provider-ready');
    document.body.dataset.providerTheme = 'noir-safari';
    document.body.dataset.providerLayout = 'capsule';
    document.querySelector('#providerBoot')?.remove();
    const auth = document.querySelector('#providerAuth');
    if (auth) auth.hidden = true;
    const dashboard = document.querySelector('#dashboard');
    dashboard.hidden = false;
    dashboard.dataset.activeView = 'waitlist';
    document.querySelectorAll('[data-provider-panel]').forEach(panel => { panel.hidden = panel.dataset.providerPanel !== 'waitlist'; });
    document.querySelectorAll('[data-provider-view]').forEach(control => control.classList.toggle('active', control.dataset.providerView === 'waitlist'));
    document.querySelector('#sidebarName').textContent = 'PrimeTime Pro';
    document.querySelector('#waitlistCount').hidden = true;
    document.querySelector('#waitlistList').innerHTML = '<div class="provider-empty compact-empty waitlist-empty-state"><strong>Заявок пока нет</strong><small>Когда клиенту не подойдёт свободное время, его заявка появится здесь.</small><div class="provider-empty-actions"><a class="primary compact-button provider-client-link" href="index.html" target="_blank" rel="noopener noreferrer">Открыть страницу клиента</a></div></div>';
  });

  const screenshotDirectory = process.env.SCREENSHOT_DIR;
  if (screenshotDirectory) await mkdir(screenshotDirectory, { recursive: true });
  for (const width of [390, 760, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const result = await page.evaluate(() => {
      const panel = document.querySelector('[data-provider-panel="waitlist"]');
      const title = panel.querySelector(':scope > .view-title');
      const description = panel.querySelector(':scope > .view-description');
      const empty = panel.querySelector('.waitlist-empty-state');
      const action = empty.querySelector('.provider-client-link');
      const style = element => getComputedStyle(element);
      return {
        actionCount: empty.querySelectorAll('a,button').length,
        actionHeight: action.getBoundingClientRect().height,
        countDisplay: style(document.querySelector('#waitlistCount')).display,
        dashboardVisibility: style(document.querySelector('#dashboard')).visibility,
        emptyBorder: style(empty).borderTopWidth,
        emptyHeight: empty.getBoundingClientRect().height,
        emptyWidth: empty.getBoundingClientRect().width,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
        titleBorder: style(title).borderTopWidth,
        titleBackground: style(title).backgroundColor,
        descriptionBorder: style(description).borderTopWidth,
      };
    });
    await page.waitForTimeout(200);
    if (screenshotDirectory) await page.screenshot({ path: path.join(screenshotDirectory, `waitlist-${width}-${Date.now()}.png`), fullPage: true });
    assert.equal(result.actionCount, 1, `${width}px: the empty state must expose one action`);
    assert.ok(result.actionHeight >= 43.5, `${width}px: the 44px action must remain touch accessible (${result.actionHeight}px rendered)`);
    assert.equal(result.countDisplay, 'none', `${width}px: a zero counter must stay hidden`);
    assert.equal(result.dashboardVisibility, 'visible', `${width}px: the preview dashboard must be visible`);
    assert.equal(result.emptyBorder, '0px', `${width}px: the empty state must not be boxed`);
    assert.ok(result.emptyHeight < 170, `${width}px: the empty state became too tall`);
    assert.ok(result.emptyWidth <= 520, `${width}px: the empty state became too wide`);
    assert.equal(result.horizontalOverflow, false, `${width}px: horizontal overflow detected`);
    assert.equal(result.titleBorder, '0px', `${width}px: the title must not be boxed`);
    assert.match(result.titleBackground, /rgba\([^)]*, 0\)|transparent/, `${width}px: the title background must remain transparent`);
    assert.equal(result.descriptionBorder, '0px', `${width}px: the description must not be boxed`);
  }

  console.log('PASS: minimal waitlist empty state at 390, 760 and 1440 px');
} finally {
  await browser.close();
}
