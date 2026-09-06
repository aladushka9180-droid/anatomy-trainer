// Read-only geometry fixture. Run with Playwright available in NODE_PATH.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const root = __dirname;
const themeCatalog = fs.readFileSync(path.join(root, 'theme-catalog.js'), 'utf8');
const themeKeys = [...themeCatalog.matchAll(/defineTheme\('([^']+)'/g)].map(match => match[1]);
assert.ok(themeKeys.length >= 20, 'Каталог тем не прочитан');
const output = process.env.MINUTA_SCHEDULE_OUTPUT;
if (output) fs.mkdirSync(output, { recursive:true });
const server = http.createServer((request, response) => {
  const file = path.resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404);
    response.end();
    return;
  }
  let content = fs.readFileSync(file);
  if (file.endsWith('.html')) content = content.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/gi, '');
  response.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
  response.end(content);
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless:true, executablePath:process.env.MINUTA_CHROME_PATH });
    const page = await browser.newPage({ viewport:{ width:1440, height:900 } });
    await page.goto(`http://127.0.0.1:${server.address().port}/provider.html`);
    await page.addStyleTag({ path:path.join(root, 'provider-schedule-minimal.css') });
    await page.evaluate(() => {
      document.documentElement.classList.remove('provider-booting', 'requires-top-level');
      document.querySelector('#providerBoot')?.remove();
      document.querySelector('#dashboard').hidden = false;
      document.body.dataset.providerTheme = 'sage';
      document.body.dataset.providerLayout = 'soft';
      document.querySelector('[data-calendar-view="day"]')?.classList.add('active');
      const strip = document.querySelector('#dateStrip');
      strip.innerHTML = Array.from({ length:7 }, (_, index) => `<button type="button"><span>день</span><strong>${index + 1}</strong><small>сент</small></button>`).join('');
      if (!strip.closest('.date-strip-frame')) {
        const frame = document.createElement('div');
        frame.className = 'date-strip-frame';
        frame.innerHTML = '<button class="date-strip-shift" type="button" data-date-shift="-7" aria-label="Предыдущая неделя">‹</button><button class="date-strip-shift" type="button" data-date-shift="7" aria-label="Следующая неделя">›</button>';
        strip.before(frame);
        frame.insertBefore(strip, frame.lastElementChild);
      }
      document.querySelector('#bookingSheet').hidden = false;
      document.body.classList.add('booking-sheet-open');
    });

    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height:900 });
      await page.waitForTimeout(450);
      const result = await page.evaluate(() => {
        const box = selector => document.querySelector(selector).getBoundingClientRect();
        const panel = box('.booking-sheet-panel');
        const frame = box('.date-strip-frame');
        const previous = box('.date-strip-shift[data-date-shift="-7"]');
        const next = box('.date-strip-shift[data-date-shift="7"]');
        const dates = [...document.querySelectorAll('#dateStrip>button')].map(button => button.getBoundingClientRect());
        const navigationStyle = getComputedStyle(document.querySelector('.date-navigation'));
        const strip = document.querySelector('#dateStrip');
        const stripStyle = getComputedStyle(strip);
        const toolbarStyle = getComputedStyle(document.querySelector('.schedule-toolbar'));
        const bookingsStyle = getComputedStyle(document.querySelector('#providerBookings'));
        return {
          panelCenterDelta:Math.abs(panel.top + panel.height / 2 - innerHeight / 2),
          panelBottomDelta:Math.abs(innerHeight - panel.bottom),
          previousInside:previous.left >= frame.left && previous.right <= frame.right,
          nextInside:next.left >= frame.left && next.right <= frame.right,
          previousGap:dates[0].left - previous.right,
          nextGap:next.left - dates.at(-1).right,
          oldControlsHidden:[...document.querySelectorAll('.date-navigation>.date-nav-button')].every(button => getComputedStyle(button).display === 'none'),
          overflow:document.documentElement.scrollWidth > innerWidth + 2,
          quietSurfaces:[navigationStyle,stripStyle,toolbarStyle].every(style => style.borderRadius === '0px' && style.boxShadow === 'none'),
          bookingsRadius:bookingsStyle.borderRadius,
          stripScrollable:strip.scrollWidth > strip.clientWidth,
          stripOverflowX:stripStyle.overflowX,
          stripTouchAction:stripStyle.touchAction
        };
      });
      assert.equal(result.previousInside, true, `${width}px: левая стрелка вышла за ленту`);
      assert.equal(result.nextInside, true, `${width}px: правая стрелка вышла за ленту`);
      if (width > 760) {
        assert.ok(result.previousGap >= 0, `${width}px: левая стрелка перекрывает первую дату (${result.previousGap}px)`);
        assert.ok(result.nextGap >= 0, `${width}px: правая стрелка перекрывает последнюю дату (${result.nextGap}px)`);
      } else {
        assert.equal(result.stripScrollable, true, `${width}px: лента дат не прокручивается`);
        assert.equal(result.stripOverflowX, 'auto', `${width}px: горизонтальная прокрутка ленты отключена`);
        assert.match(result.stripTouchAction, /pan-x/, `${width}px: горизонтальный жест ленты перехватывается`);
      }
      assert.equal(result.oldControlsHidden, true, `${width}px: старые стрелки остались видимы`);
      assert.equal(result.overflow, false, `${width}px: появился горизонтальный overflow`);
      assert.equal(result.quietSurfaces, true, `${width}px: у внутренних поверхностей остались тяжёлые рамки`);
      assert.equal(result.bookingsRadius, '0px', `${width}px: рабочая область осталась вложенной карточкой`);
      if (width > 760) assert.ok(result.panelCenterDelta <= 2, 'На ПК карточка записи не центрирована');
      else assert.ok(result.panelBottomDelta <= 2, 'На телефоне карточка должна оставаться у нижнего края');
    }

    const alternateView = await page.evaluate(() => {
      document.querySelector('[data-calendar-view="day"]')?.classList.remove('active');
      document.querySelector('[data-calendar-view="week"]')?.classList.add('active');
      document.querySelector('#dateStrip').hidden = true;
      return {
        topControlsVisible:[...document.querySelectorAll('.date-navigation>.date-nav-button')].every(button => getComputedStyle(button).display !== 'none'),
        stripControlsHidden:getComputedStyle(document.querySelector('.date-strip-frame')).display === 'none'
      };
    });
    assert.equal(alternateView.topControlsVisible, true, 'В режимах недели и месяца нужны верхние стрелки');
    assert.equal(alternateView.stripControlsHidden, true, 'Стрелки скрытой дневной ленты не должны оставаться на экране');

    await page.setViewportSize({ width:1440, height:900 });
    const splitView = await page.evaluate(() => {
      document.body.dataset.providerLayout = 'split';
      document.querySelector('[data-calendar-view="week"]')?.classList.remove('active');
      document.querySelector('[data-calendar-view="day"]')?.classList.add('active');
      document.querySelector('#dateStrip').hidden = false;
      const schedule = getComputedStyle(document.querySelector('.schedule-card'));
      const context = getComputedStyle(document.querySelector('.schedule-context'));
      return { scheduleBorder:schedule.borderTopWidth, contextBorder:context.borderTopWidth };
    });
    assert.equal(splitView.scheduleBorder, '0px', 'Разделённой компоновке не нужна третья внешняя рамка');
    assert.notEqual(splitView.contextBorder, '0px', 'Контекст разделённой компоновки должен остаться отдельной панелью');

    await page.evaluate(() => {
      document.body.dataset.providerLayout = 'soft';
      document.querySelector('#dateStrip>button')?.classList.add('active');
      const fixtureStyle = document.createElement('style');
      fixtureStyle.textContent = '#scheduleThemeFixture,#scheduleThemeFixture *{transition:none!important;animation:none!important}#scheduleThemeFixture>.timeline-view,#scheduleThemeFixture>.calendar-overview-booking,#scheduleThemeFixture>.calendar-week-booking{position:absolute!important;left:-9999px!important}';
      document.head.append(fixtureStyle);
      const fixture = document.createElement('div');
      fixture.id = 'scheduleThemeFixture';
      fixture.innerHTML = `
        <div class="timeline-view">
          <button class="timeline-booking status-confirmed color-auto"><span class="timeline-booking-copy"><strong>Запись</strong></span></button>
          <button class="timeline-booking status-block automatic-break"><span class="timeline-booking-copy"><strong>Перерыв</strong></span></button>
        </div>
        <div class="schedule-list">
          <article class="provider-booking status-confirmed color-auto"><h3>Запись</h3></article>
          <article class="provider-booking status-block automatic-break"><h3>Перерыв</h3></article>
        </div>
        <button class="calendar-overview-booking status-confirmed color-auto"><strong>Запись</strong></button>
        <button class="calendar-overview-booking status-block"><strong>Перерыв</strong></button>
        <button class="calendar-week-booking status-confirmed color-auto"><strong>Запись</strong></button>
        <button class="calendar-week-booking is-block status-block"><strong>Перерыв</strong></button>`;
      const bookings = document.querySelector('#providerBookings');
      bookings.classList.add('calendar-overview', 'calendar-overview-month');
      bookings.replaceChildren(fixture);
    });

    for (const width of [390, 760, 1440]) {
      await page.setViewportSize({ width, height:900 });
      for (const theme of themeKeys) {
        const cards = await page.evaluate(themeKey => {
          document.body.dataset.providerTheme = themeKey;
          const fixture = document.querySelector('#scheduleThemeFixture');
          const normals = [...fixture.querySelectorAll('.timeline-booking:not(.status-block),.provider-booking:not(.status-block),.calendar-overview-booking:not(.status-block),.calendar-week-booking:not(.is-block)')];
          const rests = [...fixture.querySelectorAll('.timeline-booking.status-block,.provider-booking.status-block,.calendar-overview-booking.status-block,.calendar-week-booking.is-block')];
          const activeDate = getComputedStyle(document.querySelector('#dateStrip>button.active'));
          const colorCanvas = document.createElement('canvas');
          colorCanvas.width = colorCanvas.height = 1;
          const colorContext = colorCanvas.getContext('2d', { willReadFrequently:true });
          const rgb = value => {
            colorContext.clearRect(0, 0, 1, 1);
            colorContext.fillStyle = value;
            colorContext.fillRect(0, 0, 1, 1);
            return [...colorContext.getImageData(0, 0, 1, 1).data].slice(0, 3);
          };
          const luminance = value => {
            const channels = rgb(value).map(channel => {
              const normalized = channel / 255;
              return normalized <= .04045 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4;
            });
            return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
          };
          const contrast = (foreground, background) => {
            const first = luminance(foreground), second = luminance(background);
            return (Math.max(first, second) + .05) / (Math.min(first, second) + .05);
          };
          const themeSurface = getComputedStyle(document.body).getPropertyValue('--theme-surface').trim();
          const normal = normals.map(node => {
            const style = getComputedStyle(node);
            return { background:style.backgroundColor, image:style.backgroundImage, shadow:style.boxShadow, contrast:contrast(style.color, style.backgroundColor), surfaceContrast:contrast(style.backgroundColor, themeSurface) };
          });
          const rest = rests.map(node => {
            const style = getComputedStyle(node);
            return { background:style.backgroundColor, image:style.backgroundImage, shadow:style.boxShadow, contrast:contrast(style.color, style.backgroundColor) };
          });
          const restIcon = getComputedStyle(fixture.querySelector('.timeline-booking.status-block strong'), '::before');
          return {
            normal,
            rest,
            activeDateBackground:activeDate.backgroundColor,
            restIconContent:restIcon.content,
            restIconImage:restIcon.backgroundImage,
            overflow:document.documentElement.scrollWidth > innerWidth + 2
          };
        }, theme);
        assert.equal(cards.normal.length, 4, `${theme} ${width}px: проверены не все режимы записей`);
        assert.equal(cards.rest.length, 4, `${theme} ${width}px: проверены не все режимы перерывов`);
        cards.normal.forEach((card, index) => {
          assert.equal(card.image, 'none', `${theme} ${width}px: лишний рисунок у записи ${index + 1}`);
          assert.match(card.shadow, /inset/, `${theme} ${width}px: нет акцента выбранной темы у записи ${index + 1}`);
          assert.ok(card.contrast >= 4.5, `${theme} ${width}px: низкий контраст записи ${index + 1} (${card.contrast.toFixed(2)})`);
          assert.ok(card.surfaceContrast >= 1.04, `${theme} ${width}px: запись ${index + 1} сливается с поверхностью (${card.surfaceContrast.toFixed(2)})`);
          assert.notEqual(card.background, cards.activeDateBackground, `${theme} ${width}px: запись конкурирует с выбранной датой`);
        });
        cards.rest.forEach((card, index) => {
          assert.equal(card.image, 'none', `${theme} ${width}px: у перерыва ${index + 1} остались полосы`);
          assert.equal(card.shadow, 'none', `${theme} ${width}px: перерыв ${index + 1} не должен быть акцентным`);
          assert.ok(card.contrast >= 4.5, `${theme} ${width}px: низкий контраст перерыва ${index + 1} (${card.contrast.toFixed(2)})`);
        });
        assert.notEqual(cards.normal[0].background, cards.rest[0].background, `${theme} ${width}px: запись и перерыв не различаются`);
        assert.equal(cards.restIconContent, '""', `${theme} ${width}px: у перерыва нет значка паузы`);
        assert.notEqual(cards.restIconImage, 'none', `${theme} ${width}px: значок паузы не отображается`);
        assert.equal(cards.overflow, false, `${theme} ${width}px: появился горизонтальный overflow`);
      }
    }

    if (output) {
      await page.evaluate(() => {
        document.body.dataset.providerLayout = 'soft';
        document.querySelector('#bookingSheet').hidden = true;
      });
      for (const theme of ['sage','graphite','midnight','butter','snow-leopard','golden-cheetah','noir-safari']) {
        await page.evaluate(themeKey => { document.body.dataset.providerTheme = themeKey; }, theme);
        for (const width of [390, 760, 1440]) {
          await page.setViewportSize({ width, height:900 });
          await page.screenshot({ path:path.join(output, `${theme}-soft-${width}.png`), fullPage:false });
        }
      }
    }
    console.log(`Provider schedule theme matrix: ${themeKeys.length} themes × 390/760/1440px OK`);
  } finally {
    await browser?.close();
    server.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
