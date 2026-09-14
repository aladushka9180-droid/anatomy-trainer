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
  response.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
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
    strip.scrollLeft = Math.max(0, activeDate.offsetLeft - (strip.clientWidth - activeDate.offsetWidth) / 2);
  });

  for (const { width, height } of [{ width:390, height:844 }, { width:760, height:1000 }, { width:1440, height:1000 }]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => {
      const strip = document.querySelector('#dateStrip');
      const activeDate = strip.querySelector('.active');
      strip.style.scrollBehavior = 'auto';
      strip.scrollLeft = Math.max(0, activeDate.offsetLeft - (strip.clientWidth - activeDate.offsetWidth) / 2);
    });
    await page.waitForTimeout(80);
    const result = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect();
      const strip = rect('#dateStrip');
      const previous = rect('.date-strip-shift[data-date-shift="-7"]');
      const next = rect('.date-strip-shift[data-date-shift="7"]');
      const fullyVisibleDates = [...document.querySelectorAll('#dateStrip>button')].filter(button => {
        const item = button.getBoundingClientRect();
        return item.left >= previous.right - 1 && item.right <= next.left + 1;
      }).length;
      const tab = document.querySelector('[data-calendar-view="day"]');
      const tabAccent = getComputedStyle(tab, '::after');
      const activeButton = document.querySelector('#dateStrip>button.active');
      const activeDate = activeButton.getBoundingClientRect();
      return {
        overflow:document.documentElement.scrollWidth > innerWidth + 2,
        scheduleTop:rect('#providerBookings').top,
        topbar:rect('.provider-topbar'),
        title:rect('.schedule-view-title'),
        navigation:rect('.date-navigation'),
        strip:rect('.date-strip-frame'),
        toolbar:rect('.schedule-toolbar'),
        newBooking:rect('#newBookingButton'),
        today:rect('[data-date-today]'),
        picker:rect('.schedule-date-picker'),
        previous,
        next,
        fullyVisibleDates,
        activeDate,
        activeDateValue:activeButton.dataset.bookingDate,
        activeDateBackground:getComputedStyle(activeButton).backgroundColor,
        activeDateVisible:activeDate.left >= previous.right - 1 && activeDate.right <= next.left + 1,
        stripScrollLeft:document.querySelector('#dateStrip').scrollLeft,
        stripScrollWidth:document.querySelector('#dateStrip').scrollWidth,
        tabBackground:getComputedStyle(tab).backgroundColor,
        tabAccentHeight:tabAccent.height,
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
      assert.equal(result.activeDateVisible, true, `${width}px selected date must remain visible: ${JSON.stringify(result)}`);
      assert.equal(result.activeDateValue, '2026-09-15', `${width}px fixture selected date changed`);
      assert.notEqual(result.activeDateBackground, 'rgba(0, 0, 0, 0)', `${width}px selected date lost its accent`);
      assert.ok(result.scheduleTop >= height * .3 && result.scheduleTop <= height * .42, `${width}px schedule begins: ${JSON.stringify(result)}`);
      assert.ok(Math.abs(result.viewportHeight - result.navBottom) <= 9, `${width}px fixed navigation moved from the bottom`);
      assert.equal(result.tabBackground, 'rgba(0, 0, 0, 0)', `${width}px period tabs are not flat`);
      assert.equal(result.tabAccentHeight, '2px', `${width}px selected period needs a thin accent`);
    }
    if (output) await page.screenshot({ path:path.join(output, `schedule-compact-${width}.png`), fullPage:true });
  }

  await page.evaluate(() => { document.querySelector('.provider-topbar-tools').open = true; });
  const share = await page.locator('#openFreeSlots').boundingBox();
  assert.ok(share && share.height >= 44, 'Share remains available inside More');
  assert.equal(await page.locator('.schedule-view-title #openFreeSlots').count(), 0, 'Share must not return beside New booking');
  console.log('PrimeTime Pro compact schedule v762 browser checks: PASS');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
