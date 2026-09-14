import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = process.env.MINUTA_SCHEDULE_COMPACT_OUTPUT || '';
if (output) fs.mkdirSync(output, { recursive:true });

const server = http.createServer((request, response) => {
  const requested = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const file = path.resolve(root, `.${requested}`);
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
  const contentType = file.endsWith('.css')
    ? 'text/css'
    : file.endsWith('.svg')
      ? 'image/svg+xml'
      : 'text/html; charset=utf-8';
  response.setHeader('Content-Type', contentType);
  response.end(content);
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless:true, executablePath:process.env.MINUTA_CHROME_PATH });
  const page = await browser.newPage({ viewport:{ width:390, height:844 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/provider.html`);
  await page.evaluate(() => {
    document.documentElement.classList.remove('provider-booting', 'requires-top-level');
    document.querySelector('#providerBoot')?.remove();
    const dashboard = document.querySelector('#dashboard');
    dashboard.hidden = false;
    dashboard.dataset.activeView = 'bookings';
    document.body.dataset.providerTheme = 'cocoa-pearl';
    document.body.dataset.providerLayout = 'soft';
    document.querySelectorAll('.provider-view').forEach(view => {
      view.hidden = view.dataset.providerPanel !== 'bookings';
      view.classList.toggle('active', view.dataset.providerPanel === 'bookings');
    });
    document.querySelector('[data-calendar-view="day"]').classList.add('active');
    document.querySelector('#scheduleDatePicker').value = '2026-09-15';
    const strip = document.querySelector('#dateStrip');
    strip.innerHTML = Array.from({ length:31 }, (_, index) => {
      const day = index + 1;
      const active = day === 15 ? 'active' : '';
      const today = day === 14 ? 'is-today' : '';
      const weekday = new Intl.DateTimeFormat('ru-RU', { weekday:'short' }).format(new Date(2026, 8, day)).replace('.', '');
      return `<button type="button" class="${active} ${today}" data-booking-date="2026-09-${String(day).padStart(2, '0')}"><span>${day === 14 ? 'Сегодня' : weekday}</span><strong>${day}</strong><small>сент</small></button>`;
    }).join('');
    document.querySelector('#selectedDateTitle').textContent = 'Вторник, 15 сентября';
    document.querySelector('#selectedDateSummary').textContent = '2 записи · 2 перерыва';
    document.querySelector('.booking-filters').hidden = true;
    const bookings = document.querySelector('#providerBookings');
    bookings.className = 'provider-bookings timeline-view';
    bookings.innerHTML = '<div class="day-timeline" style="height:620px"><div class="timeline-stage"></div></div>';
    const activeDate = strip.querySelector('.active');
    const stripRect = strip.getBoundingClientRect();
    const activeRect = activeDate.getBoundingClientRect();
    strip.scrollLeft = Math.max(0, activeRect.left - stripRect.left + strip.scrollLeft - (strip.clientWidth - activeRect.width) / 2);
  });

  for (const { width, height } of [{ width:360, height:800 }, { width:390, height:844 }, { width:760, height:1000 }, { width:1440, height:1000 }]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => {
      const strip = document.querySelector('#dateStrip');
      const activeDate = strip.querySelector('.active');
      strip.style.scrollBehavior = 'auto';
      const stripRect = strip.getBoundingClientRect();
      const activeRect = activeDate.getBoundingClientRect();
      strip.scrollLeft = Math.max(0, activeRect.left - stripRect.left + strip.scrollLeft - (strip.clientWidth - activeRect.width) / 2);
    });
    await page.waitForTimeout(80);
    const result = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect();
      const strip = rect('#dateStrip');
      const stripFrame = rect('.date-strip-frame');
      const previous = rect('.date-strip-shift[data-date-shift="-7"]');
      const next = rect('.date-strip-shift[data-date-shift="7"]');
      const dateButtons = [...document.querySelectorAll('#dateStrip>button')];
      const fullyVisibleDates = dateButtons.filter(button => {
        const item = button.getBoundingClientRect();
        return item.left >= strip.left - 1 && item.right <= strip.right + 1;
      }).length;
      const intersectingDates = dateButtons.filter(button => {
        const item = button.getBoundingClientRect();
        return item.right > strip.left + 1 && item.left < strip.right - 1;
      }).length;
      const tab = document.querySelector('[data-calendar-view="day"]');
      const tabs = [...document.querySelectorAll('[data-calendar-view]')].map(item => item.getBoundingClientRect().height);
      const tabAccent = getComputedStyle(tab, '::after');
      const activeButton = document.querySelector('#dateStrip>button.active');
      const activeDate = activeButton.getBoundingClientRect();
      const quietTodayButton = document.querySelector('#dateStrip>button.is-today:not(.active)');
      const quietTodayStyle = getComputedStyle(quietTodayButton);
      const ordinaryDateStyle = getComputedStyle(document.querySelector('#dateStrip>button:not(.active):not(.is-today)'));
      const todayButtonStyle = getComputedStyle(document.querySelector('[data-date-today]'));
      const pickerStyle = getComputedStyle(document.querySelector('#scheduleDatePicker'));
      const summary = document.querySelector('.schedule-title-line .dashboard-summary');
      const summaryRect = summary.getBoundingClientRect();
      const summaryChildrenInside = [...summary.children].every(child => {
        const item = child.getBoundingClientRect();
        return item.left >= summaryRect.left - 1 && item.right <= summaryRect.right + 1;
      });
      return {
        overflow:document.documentElement.scrollWidth > innerWidth + 2,
        scheduleTop:rect('#providerBookings').top,
        topbar:rect('.provider-topbar'),
        title:rect('.schedule-view-title'),
        navigation:rect('.date-navigation'),
        strip:stripFrame,
        stripViewport:strip,
        toolbar:rect('.schedule-toolbar'),
        newBooking:rect('#newBookingButton'),
        today:rect('[data-date-today]'),
        picker:rect('.schedule-date-picker'),
        previous,
        next,
        fullyVisibleDates,
        intersectingDates,
        activeDate,
        activeDateValue:activeButton.dataset.bookingDate,
        activeDateBackground:getComputedStyle(activeButton).backgroundColor,
        activeDateVisible:activeDate.left >= strip.left - 1 && activeDate.right <= strip.right + 1,
        stripScrollLeft:document.querySelector('#dateStrip').scrollLeft,
        stripScrollWidth:document.querySelector('#dateStrip').scrollWidth,
        tabBackground:getComputedStyle(tab).backgroundColor,
        tabAccentHeight:tabAccent.height,
        tabHeights:tabs,
        summary:summaryRect,
        summaryScrollWidth:summary.scrollWidth,
        summaryClientWidth:summary.clientWidth,
        summaryChildrenInside,
        quietTodayBackground:quietTodayStyle.backgroundColor,
        quietTodayBackgroundImage:quietTodayStyle.backgroundImage,
        ordinaryDateBackground:ordinaryDateStyle.backgroundColor,
        ordinaryDateBackgroundImage:ordinaryDateStyle.backgroundImage,
        ordinaryDateShadow:ordinaryDateStyle.boxShadow,
        todayButtonBackground:todayButtonStyle.backgroundColor,
        todayButtonBackgroundImage:todayButtonStyle.backgroundImage,
        todayButtonShadow:todayButtonStyle.boxShadow,
        pickerBackground:pickerStyle.backgroundColor,
        navBottom:rect('.provider-mobile-nav').bottom,
        viewportHeight:innerHeight
      };
    });
    assert.equal(result.overflow, false, `${width}px horizontal overflow`);
    assert.ok(result.newBooking.height >= 44 && result.newBooking.width >= 44, `${width}px New booking target`);
    if (width <= 760) {
      assert.ok(result.today.height >= 44 && result.today.width >= 44, `${width}px Today target`);
      assert.ok(result.picker.height >= 44, `${width}px date picker target`);
      assert.ok(result.previous.height >= 44 && result.next.height >= 44, `${width}px date strip arrows`);
      assert.equal(result.fullyVisibleDates, 5, `${width}px must expose five dates between arrows: ${JSON.stringify(result)}`);
      assert.equal(result.intersectingDates, 5, `${width}px must not expose cropped edge dates: ${JSON.stringify(result)}`);
      assert.ok(Math.abs(result.previous.right - result.stripViewport.left) <= 1, `${width}px previous arrow needs its own safe zone: ${JSON.stringify(result)}`);
      assert.ok(Math.abs(result.next.left - result.stripViewport.right) <= 1, `${width}px next arrow needs its own safe zone: ${JSON.stringify(result)}`);
      assert.equal(result.activeDateVisible, true, `${width}px selected date must remain visible: ${JSON.stringify(result)}`);
      assert.equal(result.activeDateValue, '2026-09-15', `${width}px fixture selected date changed`);
      assert.notEqual(result.activeDateBackground, 'rgba(0, 0, 0, 0)', `${width}px selected date lost its accent`);
      assert.ok(result.scheduleTop >= height * .3 && result.scheduleTop <= height * .45, `${width}px schedule begins: ${JSON.stringify(result)}`);
      assert.ok(Math.abs(result.viewportHeight - result.navBottom) <= 9, `${width}px fixed navigation moved from the bottom`);
      assert.equal(result.tabBackground, 'rgba(0, 0, 0, 0)', `${width}px period tabs are not flat`);
      assert.equal(result.tabAccentHeight, '2px', `${width}px selected period needs a thin accent`);
      assert.ok(result.tabHeights.every(tabHeight => tabHeight >= 44), `${width}px period touch targets must remain at least 44px`);
      assert.equal(result.quietTodayBackground, 'rgba(0, 0, 0, 0)', `${width}px unselected Today date competes with the selected date`);
      assert.equal(result.quietTodayBackgroundImage, 'none', `${width}px unselected Today date gained a decorative fill`);
      assert.equal(result.ordinaryDateBackground, 'rgba(0, 0, 0, 0)', `${width}px ordinary date gained a fill`);
      assert.equal(result.ordinaryDateBackgroundImage, 'none', `${width}px ordinary date gained a decorative fill`);
      assert.equal(result.ordinaryDateShadow, 'none', `${width}px ordinary dates must stay quiet`);
      assert.equal(result.todayButtonBackground, 'rgba(0, 0, 0, 0)', `${width}px separate Today action must stay quiet`);
      assert.equal(result.todayButtonBackgroundImage, 'none', `${width}px separate Today action gained a decorative fill`);
      assert.equal(result.todayButtonShadow, 'none', `${width}px separate Today action gained an extra accent`);
      assert.equal(result.pickerBackground, 'rgba(0, 0, 0, 0)', `${width}px date field gained a nested surface`);
      if (width <= 430) {
        assert.ok(result.summaryScrollWidth <= result.summaryClientWidth + 1, `${width}px title summary is clipped: ${JSON.stringify(result)}`);
        assert.equal(result.summaryChildrenInside, true, `${width}px title summary children escape their row: ${JSON.stringify(result)}`);
        assert.ok(result.summary.top >= result.newBooking.bottom - 1, `${width}px title summary must use its own full-width row: ${JSON.stringify(result)}`);
        assert.ok(result.summary.right <= result.title.right + 1, `${width}px title summary escapes the title area: ${JSON.stringify(result)}`);
      }
    }
    if (output) await page.screenshot({ path:path.join(output, `schedule-compact-${width}.png`), fullPage:false });
  }

  await page.setViewportSize({ width:390, height:844 });
  await page.evaluate(() => {
    const filters = document.querySelector('.booking-filters');
    filters.hidden = false;
    const bookings = document.querySelector('#providerBookings');
    bookings.className = 'provider-bookings schedule-list';
    bookings.innerHTML = '<div class="provider-empty schedule-empty"><strong>Записей нет</strong><small>На выбранный период всё свободно.</small></div>';
  });
  await page.waitForTimeout(80);
  const listResult = await page.evaluate(() => {
    const rect = selector => document.querySelector(selector).getBoundingClientRect();
    const toolbar = rect('.schedule-toolbar');
    const filters = rect('.booking-filters');
    const bookings = rect('#providerBookings');
    const nav = rect('.provider-mobile-nav');
    const workspace = document.querySelector('.provider-workspace');
    const navLabels = [...document.querySelectorAll('.provider-mobile-nav>button span')];
    return {
      overflow:document.documentElement.scrollWidth > innerWidth + 2,
      toolbar,
      filters,
      bookings,
      nav,
      workspacePaddingBottom:parseFloat(getComputedStyle(workspace).paddingBottom),
      navLabelsFit:navLabels.every(label => label.scrollWidth <= label.clientWidth + 1),
      filterButtons:[...document.querySelectorAll('.booking-filters button')].map(button => ({
        height:button.getBoundingClientRect().height,
        scrollWidth:button.scrollWidth,
        clientWidth:button.clientWidth
      }))
    };
  });
  assert.equal(listResult.overflow, false, `390px list has horizontal overflow: ${JSON.stringify(listResult)}`);
  assert.ok(listResult.toolbar.height >= 100, `390px list toolbar did not grow for tabs: ${JSON.stringify(listResult)}`);
  assert.ok(listResult.filters.top >= listResult.toolbar.top && listResult.filters.bottom <= listResult.toolbar.bottom + 1, `390px tabs escape toolbar: ${JSON.stringify(listResult)}`);
  assert.ok(listResult.bookings.top >= listResult.toolbar.bottom - 1, `390px list content is covered by controls: ${JSON.stringify(listResult)}`);
  assert.ok(listResult.filterButtons.every(button => button.height >= 44 && button.scrollWidth <= button.clientWidth + 1), `390px list tabs are clipped: ${JSON.stringify(listResult)}`);
  assert.equal(listResult.navLabelsFit, true, `390px mobile navigation labels are clipped: ${JSON.stringify(listResult)}`);
  assert.ok(listResult.workspacePaddingBottom >= listResult.nav.height + (844 - listResult.nav.bottom) + 16, `390px mobile navigation lacks safe clearance: ${JSON.stringify(listResult)}`);
  if (output) await page.screenshot({ path:path.join(output, 'schedule-list-390.png'), fullPage:false });

  await page.evaluate(() => { document.querySelector('.provider-topbar-tools').open = true; });
  const share = await page.locator('#openFreeSlots').boundingBox();
  assert.ok(share && share.height >= 44, 'Share remains available inside More');
  assert.equal(await page.locator('.schedule-view-title #openFreeSlots').count(), 0, 'Share must not return beside New booking');
  assert.equal(await page.getByRole('button', { name:'Новая запись' }).count(), 1, 'New booking needs its stable accessible name');
  assert.equal(await page.getByRole('button', { name:'Временная лента' }).getAttribute('title'), 'Лента');
  assert.equal(await page.getByRole('button', { name:'Компактный список' }).getAttribute('title'), 'Список');
  assert.equal(await page.getByRole('button', { name:'Временная лента' }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getByRole('button', { name:'Компактный список' }).getAttribute('aria-pressed'), 'false');
  console.log('PrimeTime Pro compact schedule v764 browser checks: PASS');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
