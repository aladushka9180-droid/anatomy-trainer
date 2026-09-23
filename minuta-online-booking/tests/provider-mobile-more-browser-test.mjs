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
const cacheVersion = workerSource.match(/CACHE = `\$\{CACHE_PREFIX\}v(\d+)`/)?.[1];
assert.ok(cacheVersion);
assert.ok(providerHtml.includes(`provider-ux.css?v=${cacheVersion}`));
assert.ok(providerHtml.includes(`site-update.js?v=${cacheVersion}`));
assert.ok(providerHtml.includes(`provider.js?v=${cacheVersion}`));
assert.ok(workerSource.includes(`provider-ux.css?v=${cacheVersion}`));
assert.ok(workerSource.includes(`site-update.js?v=${cacheVersion}`));
assert.ok(workerSource.includes(`provider.js?v=${cacheVersion}`));
assert.ok(updateSource.includes(`sw.js?v=${cacheVersion}`));
assert.match(providerSource, /renderDateStrip\(\{ instantCenter:true \}\)/);
assert.match(providerSource, /setFilter\('day', \{ render:false \}\)/);
assert.match(providerSource, /previewMobileDate\(\)/);
assert.match(providerSource, /queueMobileDateSettle\(\)/);
assert.match(providerSource, /commitMobileDateGesture\(\)/);
assert.match(providerSource, /function dateStripRangeHasRunway\(dateStrip, value, runwayDays = 28\)/);
assert.match(providerSource, /mobileCenteredRange \? !currentRangeHasMobileRunway/);

const seam = `
window.__providerMoreTest={show(){
  currentUser={id:'provider-more-fixture',user_metadata:{}};
  finishProviderBoot();
  document.querySelector('#authCard').hidden=true;
  document.querySelector('#dashboard').hidden=false;
  setProviderView('bookings',{historyMode:'replace',focusHeading:false});
  renderDateStrip({forceCenter:true});
},setDate(value){selectScheduleDate(value);},shiftDay(direction){shiftScheduleDate(direction);},dateStrip(){
  const strip=document.querySelector('#dateStrip');
  const active=strip.querySelector('[data-booking-date].active');
  const stripRect=strip.getBoundingClientRect();
  const activeRect=active?.getBoundingClientRect();
  return {selectedDate,active:active?.dataset.bookingDate||'',picker:document.querySelector('#scheduleDatePicker').value,title:document.querySelector('#selectedDateTitle').textContent.trim(),rangeStart:strip.dataset.rangeStart,rangeEnd:strip.dataset.rangeEnd,centerDelta:activeRect?Math.abs((activeRect.left+activeRect.right-stripRect.left-stripRect.right)/2):Infinity};
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

async function dragDateStrip(page, direction = 1) {
  const box = await page.locator('#dateStrip').boundingBox();
  assert.ok(box, 'date strip is not visible for drag');
  const fromX = box.x + box.width * (direction > 0 ? .78 : .22);
  const toX = box.x + box.width * (direction > 0 ? .22 : .78);
  const y = box.y + box.height / 2;
  await page.mouse.move(fromX, y);
  await page.mouse.down();
  await page.mouse.move(toX, y, { steps:5 });
  await page.mouse.up();
  await page.waitForTimeout(35);
}

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
  for (const width of [320, 390, 760]) {
    for (const theme of ['sage', 'graphite']) {
      const context = await browser.newContext({ viewport:{ width, height:900 }, hasTouch:true, isMobile:true, serviceWorkers:'block' });
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
          return { tap, rapid };
        });
        assert.equal(interaction.tap.active, interaction.tap.picker, `${width}px tap did not update the date field immediately: ${JSON.stringify(interaction)}`);
        assert.ok(interaction.tap.title, `${width}px tap did not update the date title immediately: ${JSON.stringify(interaction)}`);
        assert.ok(interaction.tap.centerDelta <= 1, `${width}px tap did not center the selected date immediately: ${JSON.stringify(interaction)}`);
        assert.equal(interaction.rapid.active, interaction.rapid.picker, `${width}px rapid taps restored an older date: ${JSON.stringify(interaction)}`);
        assert.ok(interaction.rapid.centerDelta <= 1, `${width}px rapid taps left the newest date off-center: ${JSON.stringify(interaction)}`);

        if (width === 390) {
          await page.emulateMedia({ reducedMotion:'reduce' });
          const reducedExpected = await page.evaluate(() => {
            const strip = document.querySelector('#dateStrip');
            const buttons = [...strip.querySelectorAll('[data-booking-date]')];
            const activeIndex = buttons.findIndex(button => button.classList.contains('active'));
            strip.scrollLeft += 120;
            strip.dispatchEvent(new Event('scroll'));
            const target = buttons[Math.min(buttons.length - 1, activeIndex + 3)];
            target.click();
            return target.dataset.bookingDate;
          });
          await page.waitForTimeout(40);
          const reducedResult = await page.evaluate(() => window.__providerMoreTest.dateStrip());
          assert.equal(reducedResult.selectedDate, reducedExpected, `390px reduced-motion settle restored a stale swipe date: ${JSON.stringify(reducedResult)}`);
          assert.equal(reducedResult.active, reducedExpected, `390px reduced-motion active date lagged behind the latest tap: ${JSON.stringify(reducedResult)}`);
          assert.ok(reducedResult.centerDelta <= 1, `390px reduced-motion latest date is not centered: ${JSON.stringify(reducedResult)}`);
          await page.emulateMedia({ reducedMotion:'no-preference' });
        }

        if (width <= 760) {
          await page.evaluate(() => window.__providerMoreTest.setDate('2025-10-01'));
          const initialStrip = await page.evaluate(() => window.__providerMoreTest.dateStrip());
          const forwardDrags = width <= 390 ? 36 : 4;
          for (let index = 0; index < forwardDrags; index += 1) await dragDateStrip(page, 1);
          const afterForward = await page.evaluate(() => window.__providerMoreTest.dateStrip());
          assert.ok(afterForward.selectedDate > initialStrip.selectedDate, `${width}px repeated real drags did not advance the date strip: ${JSON.stringify({initialStrip,afterForward})}`);
          assert.equal(afterForward.active, afterForward.picker, `${width}px drag date and picker diverged: ${JSON.stringify(afterForward)}`);
          assert.ok(afterForward.centerDelta <= 1, `${width}px dragged date is not centered: ${JSON.stringify(afterForward)}`);
          if (width <= 390) {
            assert.notEqual(afterForward.rangeStart, initialStrip.rangeStart, `${width}px mobile date buffer did not extend after repeated drags: ${JSON.stringify({initialStrip,afterForward})}`);
            for (let index = 0; index < 14; index += 1) await dragDateStrip(page, -1);
            const afterReverse = await page.evaluate(() => window.__providerMoreTest.dateStrip());
            assert.ok(afterReverse.selectedDate < afterForward.selectedDate, `${width}px direction change stayed stuck at the buffer edge: ${JSON.stringify({afterForward,afterReverse})}`);
          }
          await page.evaluate(() => { window.__providerMoreTest.setDate('2024-02-28'); window.__providerMoreTest.shiftDay(1); });
          const leapDay = await page.evaluate(() => window.__providerMoreTest.dateStrip());
          assert.equal(leapDay.selectedDate, '2024-02-29', `${width}px leap-day transition is wrong: ${JSON.stringify(leapDay)}`);
          assert.equal(leapDay.active, leapDay.picker, `${width}px leap-day selection diverged: ${JSON.stringify(leapDay)}`);
          await page.evaluate(() => { window.__providerMoreTest.setDate('2025-12-31'); window.__providerMoreTest.shiftDay(1); });
          const yearEdge = await page.evaluate(() => window.__providerMoreTest.dateStrip());
          assert.equal(yearEdge.selectedDate, '2026-01-01', `${width}px year transition is wrong: ${JSON.stringify(yearEdge)}`);
          assert.ok(yearEdge.centerDelta <= 1, `${width}px year-edge date is not centered: ${JSON.stringify(yearEdge)}`);
        }
      }

      await page.locator(moreButton).click();
      assert.deepEqual(await state(page), {
        open:true,
        ariaHidden:'false',
        activeView:'bookings',
        bodyLocked:true,
        panelReceivesPointer:true
      }, `Разделы должны открываться поверх записей (${width}px, ${theme})`);

      await page.locator(`${morePanel} [data-provider-view="settings"]`).evaluate(button => button.click());
      await page.waitForFunction(() => document.querySelector('[data-provider-panel="more"]').hidden);
      assert.equal(await page.locator('[data-provider-panel="settings"]').isVisible(), true, 'настройки не открылись');
      await page.locator('[data-provider-panel="settings"] .settings-section-picker summary').click();
      await page.locator('[data-provider-panel="settings"] [data-settings-section-target="appearanceSettingsCard"]').click();
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
