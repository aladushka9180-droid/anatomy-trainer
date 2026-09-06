// Read-only geometry fixture. Run with Playwright available in NODE_PATH.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const root = __dirname;
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
        const stripStyle = getComputedStyle(document.querySelector('#dateStrip'));
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
          bookingsRadius:bookingsStyle.borderRadius
        };
      });
      assert.equal(result.previousInside, true, `${width}px: левая стрелка вышла за ленту`);
      assert.equal(result.nextInside, true, `${width}px: правая стрелка вышла за ленту`);
      assert.ok(result.previousGap >= 0, `${width}px: левая стрелка перекрывает первую дату (${result.previousGap}px)`);
      assert.ok(result.nextGap >= 0, `${width}px: правая стрелка перекрывает последнюю дату (${result.nextGap}px)`);
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

    const midnightCards = await page.evaluate(() => {
      document.body.dataset.providerTheme = 'midnight';
      document.body.dataset.providerLayout = 'soft';
      const fixture = document.createElement('div');
      fixture.id = 'midnightScheduleFixture';
      fixture.className = 'timeline-view';
      fixture.innerHTML = '<button class="timeline-booking status-confirmed color-auto"><span class="timeline-booking-copy"><strong>Запись</strong></span></button><button class="timeline-booking status-block"><span class="timeline-booking-copy"><strong>Перерыв</strong></span></button>';
      document.body.append(fixture);
      const normal = getComputedStyle(fixture.firstElementChild);
      const rest = getComputedStyle(fixture.lastElementChild);
      const restIcon = getComputedStyle(fixture.lastElementChild.querySelector('strong'), '::before');
      return {
        normalBackground:normal.backgroundColor,
        normalShadow:normal.boxShadow,
        restBackground:rest.backgroundColor,
        restImage:rest.backgroundImage,
        restShadow:rest.boxShadow,
        restColor:rest.color,
        restIconContent:restIcon.content,
        restIconImage:restIcon.backgroundImage
      };
    });
    assert.notEqual(midnightCards.normalBackground, midnightCards.restBackground, 'Запись и перерыв должны различаться по тону');
    assert.match(midnightCards.normalShadow, /inset/, 'У записи нужен спокойный акцент выбранной даты');
    assert.equal(midnightCards.restImage, 'none', 'У перерыва не должно быть отвлекающих полос');
    assert.equal(midnightCards.restShadow, 'none', 'Перерыв должен оставаться второстепенным');
    assert.equal(midnightCards.restIconContent, '""', 'У перерыва нужен компактный значок паузы');
    assert.notEqual(midnightCards.restIconImage, 'none', 'Значок паузы должен отображаться');

    if (output) {
      await page.evaluate(() => {
        document.body.dataset.providerTheme = 'midnight';
        document.body.dataset.providerLayout = 'soft';
        document.querySelector('#bookingSheet').hidden = true;
      });
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height:900 });
        await page.screenshot({ path:path.join(output, `midnight-soft-${width}.png`), fullPage:false });
      }
    }
    console.log('Provider schedule minimal browser geometry: 390px + 1440px OK');
  } finally {
    await browser?.close();
    server.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
