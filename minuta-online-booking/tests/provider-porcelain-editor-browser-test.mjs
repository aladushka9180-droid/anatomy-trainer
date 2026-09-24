import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const fixture = `
document.documentElement.classList.remove('provider-booting','requires-top-level');
document.body.dataset.providerTheme='sage';
document.body.dataset.providerLayout='soft';
document.querySelector('#providerBoot').hidden=true;
document.querySelector('#dashboard').hidden=false;
const initialView=new URLSearchParams(location.search).has('porcelain-preview')?'bookings':'settings';
document.querySelectorAll('.provider-view').forEach(view=>view.hidden=view.dataset.providerPanel!==initialView);
document.querySelector('#dashboard').dataset.activeView=initialView;
document.querySelector('#providerBookings').innerHTML='<article class="provider-booking"><strong>10:00</strong><span>Тестовая запись</span></article><div class="automatic-break">Автоматический перерыв</div>';
document.querySelector('#dateStrip').innerHTML='<button type="button">23</button><button class="active" type="button">24</button><button type="button">25</button>';
let selectedDate='2026-09-24';
let displayPreferences={theme:'sage',color_mode:'light',porcelain:{character:'petal',shade:'gentle-pink'}};
let saves=0;
function normalizeDisplayPreferences(value){return value;}
function applyDisplayPreferences(){
  document.body.dataset.providerTheme=displayPreferences.theme;
  document.body.dataset.providerPorcelainCharacter=displayPreferences.porcelain.character;
  const palette=window.MinutaProviderPorcelainMatrix.paletteFor(displayPreferences.porcelain.character,displayPreferences.porcelain.shade);
  document.body.style.setProperty('--theme-bg',palette.bg);
  document.body.style.setProperty('--theme-accent',palette.accent);
  document.body.style.setProperty('--porcelain-action-bg',palette.actionBg);
  document.body.style.setProperty('--porcelain-action-ink',palette.actionInk);
}
function renderBookings(){}
function saveDisplayPreferences(next){saves++;displayPreferences=next;applyDisplayPreferences();}
window.__fixture={get saves(){return saves;},get preferences(){return displayPreferences;}};
document.addEventListener('click',event=>{
  const view=event.target.closest('.provider-mobile-nav [data-provider-view]');
  if(view){document.querySelector('#dashboard').dataset.activeView=view.dataset.providerView;return;}
  const mutate=event.target.closest('#fixtureMutate');
  if(mutate)fetch('/write',{method:'POST'}).then(response=>document.body.dataset.writeStatus=response.status);
});
document.querySelector('#dashboard').insertAdjacentHTML('beforeend','<button id="fixtureMutate">Запись</button>');
`;

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/write') { response.writeHead(204).end(); return; }
    if (url.pathname === '/rest/v1/rpc/get_minuta_staff_report_bookings_v97') { response.setHeader('Content-Type', 'application/json'); response.end('{"bookings":[],"has_more":false}'); return; }
    if (url.pathname === '/fixture.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(fixture); return; }
    if (url.pathname !== '/provider.html') {
      const target = path.resolve(root, decodeURIComponent(url.pathname.slice(1)));
      if (!target.startsWith(`${root}${path.sep}`)) { response.writeHead(404).end(); return; }
      const ext = path.extname(target);
      response.setHeader('Content-Type', ext === '.css' ? 'text/css' : ext === '.webp' ? 'image/webp' : 'text/javascript');
      response.end(await readFile(target)); return;
    }
    let html = await readFile(path.join(root, 'provider.html'), 'utf8');
    html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '')
      .replace(/<script\b[\s\S]*?<\/script>/g, '')
      .replace('</body>', '<script src="provider-porcelain-preview-guard.js"></script><script src="theme-catalog.js"></script><script src="provider-porcelain-matrix.js"></script><script src="fixture.js"></script><script src="provider-porcelain-detail.js"></script></body>');
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(html);
  } catch (error) { response.writeHead(500).end(String(error)); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{ width:1440, height:1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/provider.html`);
  await page.locator('.theme-pink-porcelain').click();
  assert.equal(await page.locator('#providerPorcelainPage').isVisible(), true, `editor missing: ${JSON.stringify({ errors, pages:await page.locator('#providerPorcelainPage').count(), body:await page.locator('body').getAttribute('data-porcelain-editor-open') })}`);
  assert.equal(await page.evaluate(() => window.__fixture.saves), 0);
  assert.equal(await page.evaluate(() => window.__fixture.preferences.theme), 'sage');
  assert.equal(await page.locator('#providerPorcelainApply').evaluate(button => getComputedStyle(button).backgroundColor), 'rgb(141, 44, 92)');
  await page.frameLocator('#providerPorcelainPreview').locator('.date-today-button').waitFor();
  for (const width of [320, 360, 390, 760, 1440]) {
    await page.setViewportSize({ width, height:1000 });
    const layout = await page.evaluate(() => { const iframe=document.querySelector('#providerPorcelainPreview'); const clip=document.querySelector('.provider-porcelain-live-frame').getBoundingClientRect(); const frameTop=iframe.getBoundingClientRect().top; const today=iframe.contentDocument.querySelector('.date-today-button')?.getBoundingClientRect(); const date=iframe.contentDocument.querySelector('#dateStrip button.active')?.getBoundingClientRect(); return { width:innerWidth, scroll:document.documentElement.scrollWidth, offenders:[...document.querySelectorAll('*')].filter(element => element.getBoundingClientRect().right > innerWidth + 2).slice(0,8).map(element => `${element.tagName}.${element.className}`), textFits:[...document.querySelectorAll('.provider-porcelain-character strong,.provider-porcelain-shade strong')].every(element => element.getBoundingClientRect().width <= element.parentElement.getBoundingClientRect().width + 1), characterLines:[...document.querySelectorAll('.provider-porcelain-character strong')].map(element => { const range=document.createRange(); range.selectNodeContents(element); return range.getClientRects().length; }), shadesPerRow:new Set([...document.querySelectorAll('.provider-porcelain-shade')].map(element => Math.round(element.getBoundingClientRect().top))).size, docked:document.querySelector('.provider-porcelain-live').classList.contains('is-docked'), visibleToday:!!today && frameTop+today.top<clip.bottom && frameTop+today.bottom>clip.top, visibleDate:!!date && frameTop+date.top<clip.bottom && frameTop+date.bottom>clip.top, frames:document.querySelectorAll('#providerPorcelainPreview').length }; });
    assert.equal(layout.scroll <= width + 2, true, `${width}px overflow: ${JSON.stringify(layout)}`);
    assert.equal(layout.textFits, true, `${width}px character/shade label overflow`);
    assert.equal(layout.frames, 1, 'Compact and full preview must use the same live iframe');
    if (width <= 390) {
      assert.deepEqual(layout.characterLines, [1, 1, 1], `${width}px character names must not collide or break awkwardly`);
      assert.equal(layout.shadesPerRow, 1, `${width}px all five shades should remain in one compact row`);
      assert.equal(layout.docked, true, `${width}px live cabin should stay visible while choosing`);
      assert.equal(layout.visibleToday && layout.visibleDate, true, `${width}px Today and selected date should be visible in the docked real cabinet`);
    }
    if (process.env.MINUTA_PORCELAIN_OUTPUT) {
      await mkdir(process.env.MINUTA_PORCELAIN_OUTPUT, { recursive:true });
      await page.screenshot({ path:path.join(process.env.MINUTA_PORCELAIN_OUTPUT, `porcelain-editor-${width}-petal.png`), fullPage:true });
    }
  }
  await page.setViewportSize({ width:390, height:844 });
  const choiceAndPreview = await page.evaluate(() => ({ shadesBottom:document.querySelector('.provider-porcelain-shades').getBoundingClientRect().bottom, dockTop:document.querySelector('.provider-porcelain-live').getBoundingClientRect().top }));
  assert.ok(choiceAndPreview.shadesBottom <= choiceAndPreview.dockTop + 1, `390px shade labels must not hide behind the live preview: ${JSON.stringify(choiceAndPreview)}`);
  await page.setViewportSize({ width:320, height:720 });
  await page.locator('.provider-porcelain-character').filter({ has:page.locator('input[value="silk"]') }).click();
  await page.locator('.provider-porcelain-shade').filter({ has:page.locator('input[value="pink-accent"]') }).click();
  await page.waitForFunction(() => document.querySelector('#providerPorcelainPreview').contentDocument?.body?.dataset.providerPorcelainCharacter === 'silk');
  assert.equal(await page.locator('.provider-porcelain-live').evaluate(element => element.classList.contains('is-docked')), true, 'Real cabinet must remain visible while selecting on a short phone viewport');
  assert.equal(await page.evaluate(() => window.__fixture.saves), 0, 'Docked preview changes must remain a draft');
  const frame = page.frameLocator('#providerPorcelainPreview');
  const observedPalettes = new Set();
  for (const character of ['pearl', 'petal', 'silk']) {
    await page.locator('.provider-porcelain-character').filter({ has:page.locator(`input[value="${character}"]`) }).click();
    for (const shade of ['pearl-white', 'gentle-pink', 'pink-accent']) {
      await page.locator('.provider-porcelain-shade').filter({ has:page.locator(`input[value="${shade}"]`) }).click();
      const expected = await page.evaluate(({ character, shade }) => window.MinutaProviderPorcelainMatrix.paletteFor(character, shade), { character, shade });
      await page.waitForFunction(({ character, bg, accent }) => {
        const body = document.querySelector('#providerPorcelainPreview').contentDocument?.body;
        return body?.dataset.providerPorcelainCharacter === character && body.style.getPropertyValue('--theme-bg') === bg && body.style.getPropertyValue('--theme-accent') === accent;
      }, { character, bg:expected.bg, accent:expected.accent });
      const controlColor = await frame.locator('.date-today-button').evaluate(button => getComputedStyle(button).backgroundColor);
      const action = expected.actionBg.match(/[a-f\d]{2}/gi).map(part => parseInt(part, 16));
      assert.equal(controlColor, `rgb(${action.join(', ')})`, `${character}/${shade}: actual selected control is not the soft action shade`);
      await page.waitForFunction(color => getComputedStyle(document.querySelector('#providerPorcelainPreview').contentDocument.querySelector('#dateStrip button.active')).backgroundColor === color, controlColor);
      const dateColor = await frame.locator('#dateStrip button.active').evaluate(button => getComputedStyle(button).backgroundColor);
      assert.equal(dateColor, controlColor, `${character}/${shade}: date strip ${dateColor}, today ${controlColor}`);
      await page.waitForFunction(color => getComputedStyle(document.querySelector('#providerPorcelainPreview').contentDocument.querySelector('.journal-mode-toggle button.active')).backgroundColor === color, controlColor);
      observedPalettes.add(`${expected.bg}/${expected.accent}`);
    }
  }
  assert.equal(observedPalettes.size, 9);
  await page.locator('.provider-porcelain-character').filter({ has:page.locator('input[value="silk"]') }).click();
  await page.locator('.provider-porcelain-shade').filter({ has:page.locator('input[value="pink-accent"]') }).click();
  assert.equal(await page.locator('#providerPorcelainTagline').textContent(), 'Мягкость и покой');
  assert.equal(await page.locator('#providerPorcelainHeroDetail').textContent(), 'Комфорт в каждом прикосновении');
  assert.equal(await page.locator('.provider-porcelain-intro').textContent(), 'Атмосфера спокойствия и вдохновения в каждой детали.');
  assert.equal(await page.evaluate(() => window.__fixture.saves), 0);
  await frame.locator('#dashboard').waitFor({ state:'visible' });
  assert.equal(await frame.locator('#newBookingButton').isVisible(), false, `Preview must hide the new-booking action: ${JSON.stringify(await frame.locator('#newBookingButton').evaluate(element => ({ html:document.documentElement.outerHTML.slice(0,220), body:document.body.className, inline:element.style.cssText, display:getComputedStyle(element).display, match:element.matches('html[data-porcelain-read-only-preview="true"] .provider-body :is(#newBookingButton,#mobileNewBookingButton,.provider-mobile-create)'), sheet:[...document.styleSheets].map(sheet => sheet.href).filter(Boolean).filter(href => href.includes('porcelain')) })))}`);
  await page.waitForFunction(() => document.querySelector('#providerPorcelainPreviewStatus').textContent.includes('Только просмотр'));
  assert.equal(await frame.locator('body').getAttribute('data-provider-porcelain-character'), 'silk');
  await frame.locator('#fixtureMutate').click({ force:true });
  assert.equal(await frame.locator('body').getAttribute('data-write-status'), null);
  assert.equal(await frame.locator('body').evaluate(async () => (await fetch('/write', { method:'POST' })).status), 403);
  assert.equal(await frame.locator('body').evaluate(async () => (await fetch('/rest/v1/rpc/get_minuta_staff_report_bookings_v97', { method:'POST' })).status), 200);
  assert.equal(await frame.locator('body').evaluate(() => { try { new XMLHttpRequest().open('POST', '/write'); return false; } catch { return true; } }), true);
  await frame.locator('body').evaluate(() => localStorage.setItem('porcelain-preview-test', 'isolated'));
  assert.equal(await page.evaluate(() => localStorage.getItem('porcelain-preview-test')), null);
  await page.locator('#providerPorcelainPreview').scrollIntoViewIfNeeded();
  await page.setViewportSize({ width:390, height:844 });
  await page.locator('.provider-porcelain-live-slot').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => !document.querySelector('.provider-porcelain-live').classList.contains('is-docked'));
  const footerOrder = await page.evaluate(() => document.querySelector('.provider-porcelain-footer').getBoundingClientRect().top >= document.querySelector('.provider-porcelain-live-slot').getBoundingClientRect().bottom - 1);
  assert.equal(footerOrder, true, 'Apply/Reset and draft status must follow the full preview');
  await frame.locator('.provider-mobile-nav [data-provider-view="clients"]').click();
  assert.equal(await frame.locator('#dashboard').getAttribute('data-active-view'), 'clients');
  await page.locator('#providerPorcelainApply').click();
  assert.equal(await page.evaluate(() => window.__fixture.saves), 1);
  await page.locator('.provider-porcelain-character').filter({ has:page.locator('input[value="pearl"]') }).click();
  await page.locator('#providerPorcelainReset').click();
  assert.equal(await page.locator('input[name="providerPorcelainDetailCharacter"][value="silk"]').isChecked(), true);
  if (process.env.MINUTA_PORCELAIN_OUTPUT) {
    await mkdir(process.env.MINUTA_PORCELAIN_OUTPUT, { recursive:true });
    await page.screenshot({ path:path.join(process.env.MINUTA_PORCELAIN_OUTPUT, 'porcelain-editor-1440.png'), fullPage:true });
  }
  assert.deepEqual(errors, []);
  console.log('Provider Porcelain editor browser: draft, preview guard, navigation, apply, reset and widths PASS');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
