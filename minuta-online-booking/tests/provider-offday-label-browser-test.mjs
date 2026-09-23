import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const source = (await readFile(path.join(root, 'provider.js'), 'utf8')).replaceAll('\r\n', '\n');
const output = process.env.PROVIDER_OFFDAY_ARTIFACT_DIR || '';

function declaration(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, `Actual ${name}`);
  const lineEnd = source.indexOf('\n', start);
  const end = source.slice(start, lineEnd).endsWith('}') ? lineEnd : source.indexOf('\n}', start) + 2;
  assert.ok(end > start, `Actual function end ${name}`);
  return source.slice(start, end);
}

const server = createServer(async (request, response) => {
  try {
    const file = path.resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
    if (!file.startsWith(root + path.sep)) throw new Error('outside root');
    let content = await readFile(file);
    if (file.endsWith('.html')) content = content.toString()
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/gi, '');
    response.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream');
    response.end(content);
  } catch {
    response.writeHead(404).end();
  }
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless:true });

try {
  const page = await browser.newPage({ viewport:{ width:1440, height:900 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/provider.html`);
  await page.addScriptTag({ content:[
    'var scheduleRows = []; var daysOff = []; var scheduleDirty = false; var selectedDate = ""; var currentFilter = "day"; var calendarView = "day"; var journalMode = "list"; var bookingRenderLimit = 100; var reportScopedBookingsState = { status:"ready" }; var teamCalendarController = null; var timelineBookingDrag = null; var recentlyCreatedBookingId = ""; var displayPreferences = {};',
    declaration('parseLocalIsoDate'),
    declaration('localIsoDate'),
    declaration('escapeHtml'),
    declaration('scheduleStateForDate'),
    declaration('scheduleEmptyDayLabel'),
    declaration('calendarOverviewBookingMarkup'),
    declaration('calendarMonthMobileAgendaMarkup'),
    declaration('renderCalendarOverview'),
    declaration('renderBookings')
  ].join('\n') });
  await page.evaluate(() => {
    document.documentElement.classList.remove('provider-booting', 'requires-top-level');
    document.querySelector('#providerBoot')?.remove();
    document.querySelector('#authCard').hidden = true;
    document.querySelector('#dashboard').hidden = false;
    document.querySelector('#dashboard').dataset.activeView = 'bookings';
    document.body.dataset.providerTheme = 'warm';
    document.body.dataset.providerLayout = 'soft';
    document.querySelectorAll('[data-provider-panel]').forEach(panel => { panel.hidden = panel.dataset.providerPanel !== 'bookings'; });
    window.$ = selector => document.querySelector(selector);
    window.$$ = selector => [...document.querySelectorAll(selector)];
    window.bookingUsesDemoData = () => false;
    window.finishTimelineBookingDrag = () => {};
    window.bookingSourceItems = () => [];
    window.filteredBookings = () => [];
    window.applyBookingQuery = items => items;
    window.bookingQueryIsActive = () => false;
    window.isScheduleBlock = () => false;
    window.automaticBookingBreaks = () => [];
    window.renderSelectedDateTitle = () => {};
    window.renderTimeline = () => {};
    window.renderBookingDataSourceNotice = () => {};
    window.updateBookingQueryTools = () => {};
    window.renderBookingList = (_items, message) => { document.querySelector('#providerBookings').innerHTML = `<div class="provider-empty"><strong>${message}</strong></div>`; };
    window.calendarRange = () => ({ start:'2026-09-01', end:'2026-09-30' });
    window.calendarRangeTitle = () => 'Сентябрь 2026';
    window.businessTodayIso = () => '2026-09-01';
    window.seriesBookingCountLabel = count => `${count} записи`;
    scheduleRows = Array.from({ length:7 }, (_, index) => ({ weekday:index + 1, enabled:index !== 6, start_time:'10:00', end_time:'20:00' }));
    daysOff = [{ id:'manual-full-day', off_date:'2026-09-21', all_day:true }];
  });

  for (const width of [390, 760, 1440]) {
    await page.setViewportSize({ width, height:900 });
    await page.evaluate(() => scrollTo(0, 0));
    const daily = await page.evaluate(() => {
      selectedDate = '2026-09-20';
      currentFilter = 'day';
      calendarView = 'day';
      renderBookings();
      return {
        summary:document.querySelector('#selectedDateSummary').textContent,
        empty:document.querySelector('#providerBookings').textContent.trim(),
        overflow:document.documentElement.scrollWidth > innerWidth + 2
      };
    });
    if (output) {
      await mkdir(output, { recursive:true });
      await page.screenshot({ path:path.join(output, `offday-day-${width}.png`), fullPage:false });
    }
    const month = await page.evaluate(() => {
      selectedDate = '2026-09-20';
      renderCalendarOverview('month');
      const label = date => document.querySelector(`[data-calendar-date="${date}"] .calendar-overview-count`)?.textContent || '';
      return {
        weeklyClosed:label('2026-09-20'),
        manualException:label('2026-09-21'),
        overflow:document.documentElement.scrollWidth > innerWidth + 2
      };
    });
    if (output) await page.screenshot({ path:path.join(output, `offday-month-${width}.png`), fullPage:false });
    assert.equal(daily.summary, 'Выходной', `${width}px: дневной вид не отличает выходной от свободного рабочего дня`);
    assert.match(daily.empty, /^Выходной\./, `${width}px: основное пустое состояние осталось двусмысленным`);
    assert.equal(daily.overflow, false, `${width}px: дневной вид переполнен`);
    assert.equal(month.weeklyClosed, 'Выходной', `${width}px: месячный вид не отличает выходной от свободного рабочего дня`);
    assert.equal(month.manualException, 'Свободно', `${width}px: ручное исключение не должно выдаваться за обычный выходной`);
    assert.equal(month.overflow, false, `${width}px: появилось горизонтальное переполнение`);
  }
  console.log('Provider off-day labels: 390/760/1440 OK');
} finally {
  await browser.close();
  server.close();
}
