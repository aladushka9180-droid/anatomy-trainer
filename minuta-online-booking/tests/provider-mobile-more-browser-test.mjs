import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const providerSource = readFileSync(path.join(root, 'provider.js'), 'utf8');
const providerHtml = readFileSync(path.join(root, 'provider.html'), 'utf8');
const workerSource = readFileSync(path.join(root, 'sw.js'), 'utf8');
const updateSource = readFileSync(path.join(root, 'site-update.js'), 'utf8');
for (const contract of [
  /function openProviderMobileMore\(/,
  /function closeProviderMobileMore\(/,
  /function dismissProviderMobileMore\(/,
  /providerMobileMoreHistoryDismissed/,
  /data-close-mobile-more/
]) assert.match(providerSource, contract);
assert.match(providerHtml, /provider-ux\.css\?v=838/);
assert.match(providerHtml, /site-update\.js\?v=838/);
assert.match(providerHtml, /provider\.js\?v=838/);
assert.match(workerSource, /CACHE = `\$\{CACHE_PREFIX\}v838`/);
assert.match(workerSource, /provider-ux\.css\?v=838/);
assert.match(workerSource, /site-update\.js\?v=838/);
assert.match(workerSource, /provider\.js\?v=838/);
assert.match(updateSource, /sw\.js\?v=838/);
assert.match(providerSource, /renderDateStrip\(\{ instantCenter:true \}\)/);
assert.match(providerSource, /setFilter\('day', \{ render:false \}\)/);
assert.match(providerSource, /advanceMobileDateGesture\(touch\.clientX\)/);
assert.doesNotMatch(providerSource, /scheduleMobileSettle|mobileSettleTimer/);

const seam = `
window.__providerMoreTest={show(){
  currentUser={id:'provider-more-fixture',user_metadata:{}};
  finishProviderBoot();
  document.querySelector('#authCard').hidden=true;
  document.querySelector('#dashboard').hidden=false;
  setProviderView('bookings',{historyMode:'replace',focusHeading:false});
  renderDateStrip({forceCenter:true});
}};`;
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp', '.woff2':'font/woff2' };
const server = createServer((request, response) => {
  const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const file = path.resolve(root, `.${name}`);
  if (!file.startsWith(`${root}${path.sep}`) || request.method !== 'GET') { response.writeHead(400).end(); return; }
  try {
    let bytes = readFileSync(file);
    if (name === '/provider.js') bytes = Buffer.from(bytes.toString() + seam);
    response.writeHead(200, { 'content-type':mime[path.extname(file)] || 'application/octet-stream' }).end(bytes);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const playwrightModule = await import(process.env.MINUTA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const { chromium } = playwrightModule.default || playwrightModule;
const browser = await chromium.launch({ headless:true, channel:process.env.BROWSER_CHANNEL || 'chrome' });

const moreButton = '.provider-mobile-nav [data-provider-view="more"]';
const morePanel = '[data-provider-panel="more"]';
const state = page => page.evaluate(() => {
  const panel = document.querySelector('[data-provider-panel="more"]');
  const rect = panel.getBoundingClientRect();
  const center = document.elementsFromPoint(rect.left + rect.width / 2, Math.max(1, rect.top + 10));
  return {
    open:!panel.hidden && panel.classList.contains('is-open'),
    ariaHidden:panel.getAttribute('aria-hidden'),
    activeView:document.querySelector('#dashboard').dataset.activeView,
    bodyLocked:document.body.classList.contains('provider-mobile-more-open') && document.body.style.position === 'fixed',
    panelReceivesPointer:center.some(element => panel.contains(element))
  };
});

try {
  for (const width of [390, 760]) {
    for (const theme of ['sage', 'graphite']) {
      const context = await browser.newContext({ viewport:{ width, height:900 }, serviceWorkers:'block' });
      await context.route('**/*', route => new URL(route.request().url()).origin === origin && route.request().method() === 'GET' ? route.continue() : route.abort());
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${origin}/provider.html`, { waitUntil:'domcontentloaded' });
      await page.waitForFunction(() => Boolean(window.__providerMoreTest));
      await page.evaluate(selectedTheme => {
        document.body.dataset.providerTheme = selectedTheme;
        window.__providerMoreTest.show();
        const spacer = document.createElement('div');
        spacer.dataset.moreTestSpacer = '';
        spacer.style.height = '1200px';
        document.querySelector('[data-provider-panel="bookings"]').append(spacer);
        window.scrollTo(0, 420);
      }, theme);
      await page.waitForTimeout(60);

      if (theme === 'sage') {
        const interaction = await page.evaluate(() => {
          const strip = document.querySelector('#dateStrip');
          const buttons = [...strip.querySelectorAll('[data-booking-date]')];
          const activeIndex = buttons.findIndex(button => button.classList.contains('active'));
          const centerDelta = () => {
            const viewport = strip.getBoundingClientRect();
            const active = strip.querySelector('[data-booking-date].active').getBoundingClientRect();
            return Math.abs((active.left + active.right - viewport.left - viewport.right) / 2);
          };
          const snapshot = () => ({
            active:strip.querySelector('[data-booking-date].active')?.dataset.bookingDate || '',
            picker:document.querySelector('#scheduleDatePicker').value,
            title:document.querySelector('#selectedDateTitle').textContent.trim(),
            centerDelta:centerDelta()
          });
          const first = buttons[activeIndex + 1];
          first.click();
          const tap = snapshot();
          buttons[activeIndex + 2].click();
          buttons[activeIndex + 3].click();
          const rapid = snapshot();
          const swipe = (startX, moves, endX) => {
            const start = new Event('touchstart', { bubbles:true, cancelable:true });
            Object.defineProperty(start, 'touches', { value:[{ clientX:startX, clientY:20 }] });
            strip.dispatchEvent(start);
            const frames=[];
            moves.forEach(clientX => {
              const move = new Event('touchmove', { bubbles:true, cancelable:true });
              Object.defineProperty(move, 'touches', { value:[{ clientX, clientY:21 }] });
              strip.dispatchEvent(move);
              frames.push(snapshot());
            });
            const end = new Event('touchend', { bubbles:true, cancelable:true });
            Object.defineProperty(end, 'changedTouches', { value:[{ clientX:endX, clientY:22 }] });
            strip.dispatchEvent(end);
            return { frames, end:snapshot() };
          };
          const swipeStart = snapshot();
          const left = swipe(260, [218,176,134], 120);
          const right = swipe(120, [162,204], 230);
          const rapidLeft = swipe(270, [218,166], 132);
          const pointerStart = snapshot();
          strip.dispatchEvent(new PointerEvent('pointerdown', { bubbles:true, cancelable:true, pointerType:'mouse', pointerId:7, button:0, clientX:270, clientY:20 }));
          strip.dispatchEvent(new PointerEvent('pointermove', { bubbles:true, cancelable:true, pointerType:'mouse', pointerId:7, buttons:1, clientX:135, clientY:21 }));
          strip.dispatchEvent(new PointerEvent('pointerup', { bubbles:true, cancelable:true, pointerType:'mouse', pointerId:7, button:0, clientX:135, clientY:21 }));
          const pointerEnd = snapshot();
          return { tap, rapid, swipeStart, left, right, rapidLeft, pointerStart, pointerEnd };
        });
        assert.equal(interaction.tap.active, interaction.tap.picker, `${width}px tap did not update the date field immediately: ${JSON.stringify(interaction)}`);
        assert.ok(interaction.tap.title, `${width}px tap did not update the date title immediately: ${JSON.stringify(interaction)}`);
        assert.ok(interaction.tap.centerDelta <= 1, `${width}px tap did not center the selected date immediately: ${JSON.stringify(interaction)}`);
        assert.equal(interaction.rapid.active, interaction.rapid.picker, `${width}px rapid taps restored an older date: ${JSON.stringify(interaction)}`);
        assert.ok(interaction.rapid.centerDelta <= 1, `${width}px rapid taps left the newest date off-center: ${JSON.stringify(interaction)}`);
        const swipeFrames = [...interaction.left.frames, interaction.left.end, ...interaction.right.frames, interaction.right.end, ...interaction.rapidLeft.frames, interaction.rapidLeft.end];
        assert.ok(swipeFrames.every(frame => frame.active === frame.picker && frame.title), `${width}px swipe did not synchronously update date/title: ${JSON.stringify(interaction)}`);
        assert.ok(swipeFrames.every(frame => frame.centerDelta <= 1), `${width}px selected date moved out of the fixed center during rapid swipes: ${JSON.stringify(interaction)}`);
        assert.notEqual(interaction.left.end.active, interaction.swipeStart.active, `${width}px left swipe lost all date steps: ${JSON.stringify(interaction)}`);
        assert.notEqual(interaction.rapidLeft.end.active, interaction.right.end.active, `${width}px rapid consecutive swipe was dropped: ${JSON.stringify(interaction)}`);
        assert.notEqual(interaction.pointerEnd.active, interaction.pointerStart.active, `${width}px mouse drag in mobile layout lost all date steps: ${JSON.stringify(interaction)}`);
        assert.equal(interaction.pointerEnd.active, interaction.pointerEnd.picker, `${width}px mouse drag desynchronized the date field: ${JSON.stringify(interaction)}`);
        assert.ok(interaction.pointerEnd.centerDelta <= 1, `${width}px mouse drag moved the selected date out of center: ${JSON.stringify(interaction)}`);
      }

      await page.locator(moreButton).click();
      assert.deepEqual(await state(page), {
        open:true,
        ariaHidden:'false',
        activeView:'bookings',
        bodyLocked:true,
        panelReceivesPointer:true
      }, `Разделы должны открываться поверх записей (${width}px, ${theme})`);

      await page.locator(`${morePanel} [data-provider-view="settings"]`).click();
      await page.waitForFunction(() => document.querySelector('[data-provider-panel="more"]').hidden);
      assert.equal(await page.locator('[data-provider-panel="settings"]').isVisible(), true, 'настройки не открылись');
      await page.locator('[data-provider-panel="settings"] [data-section-target="appearanceSettingsCard"]').click();
      await page.waitForTimeout(50);
      assert.equal(await page.locator('#appearanceSettingsCard').isVisible(), true, 'оформление не доступно после закрытия меню');
      assert.equal((await state(page)).bodyLocked, false, 'прокрутка осталась заблокированной после выбора');
      assert.equal(new URL(page.url()).searchParams.get('section'), 'settings', 'маршрут меню остался поверх настроек');

      await page.evaluate(selectedTheme => {
        document.body.dataset.providerTheme = selectedTheme === 'sage' ? 'graphite' : 'sage';
        window.dispatchEvent(new Event('resize'));
      }, theme);
      await page.waitForTimeout(50);
      assert.equal((await state(page)).open, false, 'смена темы или resize снова открыли меню');

      await page.locator(moreButton).click();
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.querySelector('[data-provider-panel="more"]').hidden && new URLSearchParams(location.search).get('section') !== 'more');
      assert.equal((await state(page)).open, false, 'Escape не закрыл меню');

      await page.locator(moreButton).click();
      await page.locator(moreButton).click();
      await page.waitForFunction(() => document.querySelector('[data-provider-panel="more"]').hidden && new URLSearchParams(location.search).get('section') !== 'more');
      assert.equal((await state(page)).open, false, 'повторное нажатие «Разделы» не закрыло меню');

      await page.locator(moreButton).click();
      await page.locator('[data-close-mobile-more].mobile-more-backdrop').click({ position:{ x:4, y:4 } });
      await page.waitForFunction(() => document.querySelector('[data-provider-panel="more"]').hidden && new URLSearchParams(location.search).get('section') !== 'more');
      assert.equal((await state(page)).open, false, 'нажатие вне панели не закрыло меню');

      await page.locator(moreButton).click();
      await page.goBack();
      await page.waitForFunction(() => document.querySelector('[data-provider-panel="more"]').hidden);
      assert.equal((await state(page)).open, false, 'Android/browser Back не закрыл меню');

      await page.locator('.provider-mobile-nav [data-provider-view="bookings"]').click();
      await page.evaluate(() => window.scrollTo(0, 420));
      const scrollBeforeDismiss = await page.evaluate(() => window.scrollY);
      await page.locator(moreButton).click();
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.querySelector('[data-provider-panel="more"]').hidden);
      await page.waitForFunction(expected => Math.abs(window.scrollY - expected) <= 2, scrollBeforeDismiss);
      const restoredScroll = await page.evaluate(() => window.scrollY);
      assert.ok(Math.abs(restoredScroll - scrollBeforeDismiss) <= 2, `прокрутка не восстановлена: ${scrollBeforeDismiss} -> ${restoredScroll}`);

      await page.locator(moreButton).click();
      await page.locator('.provider-mobile-nav [data-provider-view="clients"]').click();
      await page.waitForFunction(() => document.querySelector('#dashboard').dataset.activeView === 'clients');
      assert.equal((await state(page)).open, false, 'нижняя навигация не закрыла меню');
      assert.equal(await page.locator('[data-provider-panel="clients"]').isVisible(), true, 'нижняя навигация не открыла клиентов');

      assert.deepEqual(errors, [], `ошибки страницы (${width}px, ${theme})`);
      console.log(`Provider mobile sections: PASS at ${width}px / ${theme}`);
      await context.close();
    }
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
