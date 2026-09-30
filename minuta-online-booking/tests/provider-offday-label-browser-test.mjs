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
    'var scheduleRows = []; var daysOff = []; var scheduleDirty = false; var selectedDate = ""; var currentFilter = "day"; var calendarView = "day"; var journalMode = "list"; var bookingRenderLimit = 100; var reportScopedBookingsState = { status:"ready" }; var teamCalendarController = null; var timelineBookingDrag = null; var recentlyCreatedBookingId = ""; var displayPreferences = {}; var currentUser = { id:"fixture-user" }; var sessionGeneration = 1; var db;',
    declaration('parseLocalIsoDate'),
    declaration('localIsoDate'),
    declaration('escapeHtml'),
    declaration('scheduleStateForDate'),
    declaration('scheduleEmptyDayLabel'),
    declaration('calendarOverviewBookingMarkup'),
    declaration('calendarMonthMobileAgendaMarkup'),
    declaration('renderCalendarOverview'),
    declaration('renderTimeline'),
    declaration('renderBookings'),
    declaration('loadDaysOff')
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
    window.renderDaysOff = () => {};
    window.sessionIsCurrent = () => true;
    window.saveProviderCache = async () => {};
    window.timelineBounds = () => ({ start:600, end:1200 });
    window.stackMinuteTimelineItems = () => {};
    window.scheduleNowMarkerMarkup = () => '';
    window.timelineEmptyHintOffsetMinutes = () => 120;
    window.scheduleCreateHintMarkup = () => '';
    window.timeFromMinutes = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    window.uiIcon = () => '';
    window.renderBookingDataSourceNotice = () => {};
    window.updateBookingQueryTools = () => {};
    window.renderBookingList = (_items, message) => { document.querySelector('#providerBookings').innerHTML = `<div class="provider-empty"><strong>${message}</strong></div>`; };
    window.calendarRange = () => ({ start:'2026-09-01', end:'2026-09-30' });
    window.calendarRangeTitle = () => 'Сентябрь 2026';
    window.businessTodayIso = () => '2026-09-01';
    window.seriesBookingCountLabel = count => `${count} записи`;
    scheduleRows = Array.from({ length:7 }, (_, index) => ({ weekday:index + 1, enabled:index !== 6, start_time:'10:00', end_time:'20:00' }));
    daysOff = [{ id:'manual-full-day', off_date:'2026-09-21', all_day:true }, { id:'partial', off_date:'2026-09-22', all_day:false, start_time:'12:00', end_time:'13:00' }];
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
    const manualDay = await page.evaluate(() => {
      selectedDate = '2026-09-21';
      renderBookings();
      return {
        summary:document.querySelector('#selectedDateSummary').textContent,
        empty:document.querySelector('#providerBookings').textContent.trim(),
        overflow:document.documentElement.scrollWidth > innerWidth + 2
      };
    });
    if (output) await page.screenshot({ path:path.join(output, `manual-closed-day-${width}.png`), fullPage:false });
    const timeline = await page.evaluate(() => {
      journalMode = 'timeline';
      renderBookings();
      const closed = {
        summary:document.querySelector('#selectedDateSummary').textContent,
        message:document.querySelector('#providerBookings').textContent.trim(),
        freeTimePicker:!!document.querySelector('#providerBookings [data-create-booking-at]'),
        overflow:document.documentElement.scrollWidth > innerWidth + 2
      };
      selectedDate = '2026-09-20';
      renderBookings();
      const weekly = {
        summary:document.querySelector('#selectedDateSummary').textContent,
        message:document.querySelector('#providerBookings').textContent.trim(),
        freeTimePicker:!!document.querySelector('#providerBookings [data-create-booking-at]')
      };
      selectedDate = '2026-09-22';
      renderBookings();
      const partial = {
        summary:document.querySelector('#selectedDateSummary').textContent,
        freeTimePicker:!!document.querySelector('#providerBookings [data-create-booking-at]'),
        pickerRole:document.querySelector('#providerBookings [data-create-booking-at]')?.getAttribute('role'),
        pickerTabIndex:document.querySelector('#providerBookings [data-create-booking-at]')?.tabIndex,
        pickerDate:document.querySelector('#providerBookings [data-create-booking-at]')?.dataset.timelineDate
      };
      journalMode = 'list';
      return { closed, weekly, partial };
    });
    const month = await page.evaluate(() => {
      selectedDate = '2026-09-20';
      renderCalendarOverview('month');
      const label = date => document.querySelector(`[data-calendar-date="${date}"] .calendar-overview-count`)?.textContent || '';
      return {
        weeklyClosed:label('2026-09-20'),
        manualException:label('2026-09-21'),
        partialException:label('2026-09-22'),
        overflow:document.documentElement.scrollWidth > innerWidth + 2
      };
    });
    if (output) await page.screenshot({ path:path.join(output, `offday-month-${width}.png`), fullPage:false });
    assert.equal(daily.summary, 'Выходной', `${width}px: дневной вид не отличает выходной от свободного рабочего дня`);
    assert.match(daily.empty, /^Выходной\./, `${width}px: основное пустое состояние осталось двусмысленным`);
    assert.equal(daily.overflow, false, `${width}px: дневной вид переполнен`);
    assert.equal(manualDay.summary, 'День закрыт', `${width}px: ручное закрытие дня не названо явно`);
    assert.match(manualDay.empty, /^День закрыт\./, `${width}px: закрытый день предлагает свободное время`);
    assert.doesNotMatch(manualDay.empty, /свободн/i, `${width}px: ручное закрытие не должно обещать свободное время`);
    assert.equal(manualDay.overflow, false, `${width}px: ручное закрытие дня переполнено`);
    assert.equal(timeline.closed.summary, 'День закрыт', `${width}px: лента не показывает ручное закрытие`);
    assert.match(timeline.closed.message, /День закрыт/, `${width}px: лента не объясняет закрытие`);
    assert.equal(timeline.closed.freeTimePicker, false, `${width}px: закрытый день предлагает свободный слот`);
    assert.equal(timeline.closed.overflow, false, `${width}px: лента закрытого дня переполнена`);
    assert.equal(timeline.weekly.summary, 'Выходной', `${width}px: лента не показывает обычный выходной`);
    assert.match(timeline.weekly.message, /Выходной/, `${width}px: лента не объясняет выходной`);
    assert.equal(timeline.weekly.freeTimePicker, false, `${width}px: выходной предлагает свободный слот`);
    assert.equal(timeline.partial.summary, 'Свободный день', `${width}px: частичное закрытие ошибочно названо полным`);
    assert.equal(timeline.partial.freeTimePicker, true, `${width}px: частичное закрытие заблокировало весь день`);
    assert.equal(timeline.partial.pickerRole, 'group', `${width}px: выбор времени должен сохранять доступную роль группы`);
    assert.equal(timeline.partial.pickerTabIndex, 0, `${width}px: выбор времени должен быть доступен с клавиатуры`);
    assert.equal(timeline.partial.pickerDate, '2026-09-22', `${width}px: выбор времени должен сохранять показанную дату`);
    assert.equal(month.weeklyClosed, 'Выходной', `${width}px: месячный вид не отличает выходной от свободного рабочего дня`);
    assert.equal(month.manualException, 'День закрыт', `${width}px: полнодневное ручное закрытие не должно выглядеть свободным`);
    assert.equal(month.partialException, 'Свободно', `${width}px: частичное исключение не должно закрывать весь день`);
    assert.equal(month.overflow, false, `${width}px: появилось горизонтальное переполнение`);
    for (const date of ['2026-09-20', '2026-09-21']) {
      const label = page.locator(`[data-calendar-date="${date}"] .calendar-overview-count`);
      assert.equal(await label.isVisible(), true, `${width}px: подпись закрытого дня скрыта CSS`);
      const fits = await label.evaluate(element => {
        const box = element.getBoundingClientRect();
        const cell = element.closest('.calendar-overview-day').getBoundingClientRect();
        return box.width > 0 && box.height > 0 && box.left >= cell.left && box.right <= cell.right + 1;
      });
      assert.equal(fits, true, `${width}px: подпись закрытого дня выходит из ячейки`);
    }
  }
  const lateExceptions = await page.evaluate(async () => {
    selectedDate = '2026-09-21';
    calendarView = 'month';
    daysOff = [];
    renderBookings();
    const before = document.querySelector('[data-calendar-date="2026-09-21"] .calendar-overview-count')?.textContent;
    db = { from:() => ({ select:() => ({ eq:() => ({ gte:() => ({ order:async () => ({ data:[{ id:'manual-full-day', off_date:'2026-09-21', all_day:true }], error:null }) }) }) }) }) };
    await loadDaysOff();
    const after = document.querySelector('[data-calendar-date="2026-09-21"] .calendar-overview-count')?.textContent;
    return { before, after };
  });
  assert.equal(lateExceptions.before, 'Свободно', 'fixture должен воспроизводить рендер до загрузки исключений');
  assert.equal(lateExceptions.after, 'День закрыт', 'поздняя загрузка исключений должна обновить записи');
  const existingBooking = await page.evaluate(() => {
    const item = { id:'existing', booking_date:'2026-09-21', status:'confirmed' };
    window.bookingSourceItems = () => [item];
    window.filteredBookings = () => [item];
    window.calendarOverviewBookingMarkup = () => '<button>Существующая запись</button>';
    calendarView = 'day';
    journalMode = 'list';
    renderBookings();
    const day = document.querySelector('#selectedDateSummary').textContent;
    calendarView = 'month';
    renderBookings();
    const month = document.querySelector('[data-calendar-date="2026-09-21"] .calendar-overview-count')?.textContent;
    return { day, month };
  });
  assert.equal(existingBooking.day, 'День закрыт · 1 запись', 'сохранённая запись не должна скрывать статус закрытого дня');
  assert.equal(existingBooking.month, 'День закрыт · 1 запись', 'сохранённая запись не должна скрывать статус месяца');
  console.log('Provider off-day labels: 390/760/1440 OK');
} finally {
  await browser.close();
  server.close();
}
