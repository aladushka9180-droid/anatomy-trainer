import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { themes, layouts } from './theme-card-fixture.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const providerHtml = await readFile(path.join(root, 'provider.html'), 'utf8');
const worker = await readFile(path.join(root, 'sw.js'), 'utf8');
const styleVersion = providerHtml.match(/href=["']provider-service-actions\.css\?v=(\d+)/)?.[1];
const scriptVersion = providerHtml.match(/src=["']provider-service-actions\.js\?v=(\d+)/)?.[1];
const providerVersion = providerHtml.match(/src=["']provider\.js\?v=(\d+)/)?.[1];
assert.ok(styleVersion && scriptVersion && providerVersion, 'Versioned provider service-action assets must be readable');
assert.match(providerHtml, new RegExp(`provider-service-actions\\.js\\?v=${scriptVersion}[\\s\\S]*provider\\.js\\?v=${providerVersion}`), 'Service-action controller must load before provider rendering');
assert.match(worker, new RegExp(`\\./provider-service-actions\\.css\\?v=${styleVersion}`), 'Service-action styles must be available offline');
assert.match(worker, new RegExp(`\\./provider-service-actions\\.js\\?v=${scriptVersion}`), 'Service-action controller must be available offline');
const styleLinks = [...providerHtml.matchAll(/<link\s+rel="stylesheet"\s+href="([^"]+)"[^>]*>/g)]
  .map(match => `<link rel="stylesheet" href="/assets/${match[1]}">`).join('\n');
const cards = [
  ['first', 'Массаж спины + ШВЗ — базовый'],
  ['middle', 'Очень длинное название услуги для проверки крупного текста без наложения действий на статус'],
  ['last', 'Массаж спины + ШВЗ — углублённый']
].map(([id, name]) => `<article class="managed-service" data-test-card="${id}">
  <button class="service-info service-edit-target" type="button"><div><strong>${name}</strong><small>120 мин · 5 800 ₽ · Карточка заполнена</small></div></button>
  <div class="manage-actions"><button class="service-visibility-toggle" type="button" data-toggle-service="${id}"><i aria-hidden="true"></i><span>Доступна</span></button>
  <details class="service-more"><summary aria-label="Другие действия"><svg class="ui-icon" aria-hidden="true"></svg></summary><div><button class="danger" type="button" data-delete-service="${id}"><span>Удалить</span></button></div></details></div>
</article>`).join('<div class="service-actions-test-spacer" aria-hidden="true"></div>');

const fixture = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${styleLinks}
<style>*,*::before,*::after{transition:none!important;animation:none!important}.provider-body{margin:0}.provider-app{min-height:1200px}.provider-workspace{width:100%;max-width:none;margin:0;padding:20px!important}.provider-view{display:block!important}.service-catalog{max-width:920px;margin:0 auto}.service-actions-test-spacer{height:280px}.provider-mobile-nav{position:fixed;z-index:900;right:8px;bottom:0;left:8px;height:58px;background:var(--theme-surface,#fff)}@media(min-width:761px){.provider-mobile-nav{display:none}}</style>
<script src="/provider-service-actions.js" defer></script></head><body class="provider-body" data-provider-theme="sage" data-provider-layout="linear" data-provider-text-scale="default"><div class="provider-app"><main class="provider-workspace"><section class="provider-view" data-provider-panel="services"><div class="services-layout"><section class="panel service-catalog"><div class="service-manage-list" id="serviceManageList">${cards}</div></section></div></section></main><nav class="provider-mobile-nav">Навигация</nav></div></body></html>`;

const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  try {
    if (url.pathname === '/') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(fixture);
      return;
    }
    const name = decodeURIComponent(url.pathname.replace(/^\/(?:assets\/)?/, '')).replace(/\?.*$/, '');
    const target = path.resolve(root, name);
    if (!target.startsWith(root) || !/\.(css|js|svg|woff2?|ttf|png|webp)$/.test(target)) throw new Error('blocked');
    const types = { '.css':'text/css', '.js':'text/javascript', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.woff':'font/woff', '.png':'image/png', '.webp':'image/webp' };
    response.setHeader('Content-Type', types[path.extname(target)] || 'application/octet-stream');
    response.end(await readFile(target));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const modulePath = process.env.MINUTA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright';
const playwright = await import(modulePath);
const chromium = playwright.chromium || playwright.default?.chromium;
const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });

try {
  const page = await browser.newPage({ viewport:{ width:390, height:844 } });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(url);
  await page.locator('.service-actions-cancel').first().waitFor({ state:'attached' });
  const failures = [];
  let combinations = 0;
  for (const width of [390, 760, 1440]) {
    await page.setViewportSize({ width, height:844 });
    for (const layout of layouts) for (const theme of themes) for (const scale of ['default', 'comfortable', 'large']) {
      const results = await page.evaluate(({ layout, theme, scale }) => {
        document.body.dataset.providerLayout = layout;
        document.body.dataset.providerTheme = theme;
        document.body.dataset.providerTextScale = scale;
        const cards = [...document.querySelectorAll('[data-test-card]')];
        const output = [];
        for (const [index, card] of cards.entries()) {
          document.querySelectorAll('.service-more[open]').forEach(details => window.MinutaServiceActions.close(details));
          card.scrollIntoView({ block:index === cards.length - 1 ? 'end' : index === 0 ? 'start' : 'center' });
          const details = card.querySelector('.service-more');
          const closedHeight = card.getBoundingClientRect().height;
          window.MinutaServiceActions.open(details, { focus:false });
          window.MinutaServiceActions.position(details);
          const menu = document.querySelector(`.service-actions-layer > #${details.querySelector('summary').getAttribute('aria-controls')}`);
          const summary = details.querySelector('summary');
          const status = card.querySelector('.service-visibility-toggle');
          const nav = document.querySelector('.provider-mobile-nav');
          const cancel = menu.querySelector('[data-close-service-actions]');
          const remove = menu.querySelector('[data-delete-service]');
          const rect = element => { const value = element.getBoundingClientRect(); return { left:value.left, top:value.top, right:value.right, bottom:value.bottom, width:value.width, height:value.height }; };
          const intersects = (a, b) => Math.min(a.right,b.right)-Math.max(a.left,b.left)>0.5 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>0.5;
          const rgb = value => {
            const channels = (value.match(/[\d.]+/g) || []).slice(0,3).map(Number);
            return value.startsWith('color(srgb') ? channels.map(channel => channel * 255) : channels;
          };
          const luminance = value => {
            const channels = rgb(value).map(channel => channel / 255).map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
            return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
          };
          const contrast = element => {
            const style = getComputedStyle(element), foreground = luminance(style.color), background = luminance(style.backgroundColor);
            return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
          };
          const menuRect = rect(menu), statusRect = rect(status), navRect = rect(nav), summaryRect = rect(summary);
          output.push({
            card:card.dataset.testCard,
            closedHeight,
            openHeight:card.getBoundingClientRect().height,
            menu:menuRect,
            statusOverlap:intersects(menuRect,statusRect),
            summaryOverlap:intersects(menuRect,summaryRect),
            navOverlap:getComputedStyle(nav).display !== 'none' && intersects(menuRect,navRect),
            cancelDisplay:getComputedStyle(cancel).display,
            cancelHeight:rect(cancel).height,
            removeHeight:rect(remove).height,
            cancelContrast:contrast(cancel),
            removeContrast:contrast(remove),
            placement:details.dataset.serviceActionsPlacement,
            position:getComputedStyle(menu).position,
            expanded:summary.getAttribute('aria-expanded'),
            controls:summary.getAttribute('aria-controls'),
            menuId:menu.id,
            scrollWidth:document.documentElement.scrollWidth
          });
          window.MinutaServiceActions.close(details);
        }
        return output;
      }, { layout, theme, scale });
      for (const result of results) {
        const label = `${width}/${theme}/${layout}/${scale}/${result.card}`;
        if (Math.abs(result.closedHeight - result.openHeight) > .75) failures.push(`${label}: card height changed ${result.closedHeight} -> ${result.openHeight}`);
        if (result.position !== 'fixed') failures.push(`${label}: menu is not fixed`);
        if (result.menu.left < 11 || result.menu.right > width - 11) failures.push(`${label}: horizontal clamp failed ${JSON.stringify(result.menu)}`);
        if (result.menu.top < 11 || result.menu.bottom > 833) failures.push(`${label}: vertical clamp failed ${JSON.stringify(result.menu)}`);
        if (width > 760 && (result.statusOverlap || result.summaryOverlap)) failures.push(`${label}: action menu overlaps status/trigger`);
        if (result.navOverlap) failures.push(`${label}: action menu overlaps bottom navigation`);
        if (result.removeHeight < 43.5) failures.push(`${label}: delete target is ${result.removeHeight}px`);
        if (result.removeContrast < 4.5) failures.push(`${label}: delete contrast is ${result.removeContrast.toFixed(2)}`);
        if (width <= 760 && result.cancelContrast < 4.5) failures.push(`${label}: cancel contrast is ${result.cancelContrast.toFixed(2)}`);
        if (width <= 760 && (result.cancelDisplay === 'none' || result.cancelHeight < 43.5 || result.placement !== 'sheet')) failures.push(`${label}: mobile sheet/cancel contract failed`);
        if (width > 760 && (result.cancelDisplay !== 'none' || !['top','bottom'].includes(result.placement))) failures.push(`${label}: popover contract failed`);
        if (width > 760 && result.card === 'first' && result.placement !== 'bottom') failures.push(`${label}: popover did not open below with available room`);
        if (width > 760 && result.card === 'last' && result.placement !== 'top') failures.push(`${label}: popover did not flip above near the viewport edge`);
        if (result.expanded !== 'true' || !result.controls || result.controls !== result.menuId) failures.push(`${label}: aria contract failed`);
        if (result.scrollWidth > width + 1) failures.push(`${label}: horizontal page overflow ${result.scrollWidth}`);
      }
      combinations++;
    }
    console.log(`Service actions matrix: ${width}px checked`);
  }
  assert.equal(failures.length, 0, `Service actions matrix failures (${failures.length}): ${JSON.stringify(failures.slice(0, 60))}`);

  await page.setViewportSize({ width:390, height:844 });
  await page.reload();
  await page.locator('.service-actions-cancel').first().waitFor({ state:'attached' });
  await page.evaluate(() => window.scrollTo(0, 0));
  const summaries = page.locator('.service-more > summary');
  await summaries.first().press('Enter');
  await page.locator('.service-actions-layer [data-delete-service="first"]').waitFor({ state:'visible' });
  assert.equal(await summaries.first().getAttribute('aria-expanded'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.deleteService), 'first', 'Focus must move to the first action');
  await summaries.nth(1).press('Enter');
  await page.locator('.service-actions-layer [data-delete-service="middle"]').waitFor({ state:'visible' });
  assert.equal(await summaries.first().getAttribute('aria-expanded'), 'false', 'Only one service menu may stay open');
  assert.equal(await summaries.nth(1).getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Escape');
  await page.locator('.service-actions-layer [data-delete-service="middle"]').waitFor({ state:'hidden' });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await summaries.nth(1).getAttribute('aria-expanded'), 'false');
  assert.equal(await page.evaluate(() => document.activeElement?.closest('.service-more')?.querySelector('summary') === document.activeElement), true, 'Escape must restore trigger focus');
  await summaries.first().press('Enter');
  await page.locator('.service-actions-layer [data-delete-service="first"]').waitFor({ state:'visible' });
  await page.waitForFunction(() => document.activeElement?.dataset.deleteService === 'first');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.closeServiceActions !== undefined), true, 'Arrow navigation must reach Cancel');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.deleteService), 'first', 'Mobile Tab must cycle through sheet actions');
  await page.locator('.service-actions-layer > .service-actions-backdrop').click({ position:{ x:2, y:2 } });
  assert.equal(await summaries.first().getAttribute('aria-expanded'), 'false', 'Outside/backdrop click must close the sheet');

  await page.setViewportSize({ width:1440, height:844 });
  await page.evaluate(() => window.MinutaServiceActions.open(document.querySelectorAll('.service-more')[1], { focus:false }));
  await page.locator('.service-actions-layer [data-delete-service="middle"]').waitFor({ state:'visible' });
  await page.locator('.provider-workspace').click({ position:{ x:2, y:2 } });
  await page.locator('.service-actions-layer [data-delete-service="middle"]').waitFor({ state:'hidden' });
  assert.equal(await summaries.nth(1).getAttribute('aria-expanded'), 'false', 'Desktop outside click must close the popover');

  const interaction = await page.evaluate(async () => {
    let deletes = 0, toggles = 0;
    document.addEventListener('click', event => {
      if (event.target.closest('[data-delete-service]')) deletes++;
      if (event.target.closest('[data-toggle-service]')) toggles++;
    });
    const details = document.querySelector('.service-more');
    window.MinutaServiceActions.open(details, { focus:false });
    document.querySelector('.service-actions-layer [data-delete-service]').click();
    document.querySelector('[data-toggle-service]').click();
    await new Promise(resolve => requestAnimationFrame(resolve));
    return { deletes, toggles, open:details.open };
  });
  assert.deepEqual(interaction, { deletes:1, toggles:1, open:false }, 'Delete and visibility actions must remain independent and single-fire');
  assert.deepEqual(pageErrors, [], 'Service actions fixture must not hide browser errors');
  console.log(`Service actions browser: ${combinations} theme/layout/scale/width combinations × first/middle/last cards PASS`);
} finally {
  await browser.close();
  server.close();
}
