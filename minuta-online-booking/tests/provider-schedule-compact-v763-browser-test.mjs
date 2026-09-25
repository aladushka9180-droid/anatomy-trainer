import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const playwright = process.env.MINUTA_PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href)
  : createRequire(import.meta.url)('playwright');
const chromium = playwright.chromium || playwright.default?.chromium;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const providerSource = fs.readFileSync(path.join(root, 'provider.js'), 'utf8');
const todayVisibilityHelper = providerSource.slice(
  providerSource.indexOf('function updateDateStripTodayVisibility('),
  providerSource.indexOf('function updateDateStripEmphasis(')
);
assert.match(todayVisibilityHelper, /is-edge-clipped/);
const scheduleCssSource = fs.readFileSync(path.join(root, 'provider-schedule-minimal.css'), 'utf8');
const themeCatalogSource = fs.readFileSync(path.join(root, 'theme-catalog.js'), 'utf8');
const themeKeys = [...themeCatalogSource.matchAll(/defineTheme\('([^']+)'/g)].map(match => match[1]);
assert.equal(themeKeys.length, 41, `Expected the complete 41-theme provider catalog, received ${themeKeys.length}`);
assert.match(providerSource, /--timeline-empty-hint-top:\$\{emptyHintTop\}px/, 'Timeline does not expose the adaptive empty-day hint position');
assert.match(providerSource, /const horizontalIntent = Math\.abs\(event\.deltaX\) > Math\.abs\(event\.deltaY\) \|\| event\.shiftKey;/, 'Desktop date navigation still captures ordinary vertical scrolling');
assert.doesNotMatch(providerSource, /touchend[\s\S]{0,500}queueMobileDateSettle\(\)/, 'Mobile touchend starts a second date-settle animation before native momentum ends');
assert.match(scheduleCssSource, /scroll-snap-type:none!important;/, 'Mobile date strip still competes with the explicit settle step');
const listRendererStart = providerSource.indexOf('function renderBookingList(');
const listRendererEnd = providerSource.indexOf('\nfunction bookingEmptyMarkup', listRendererStart);
assert.ok(listRendererStart >= 0 && listRendererEnd > listRendererStart, 'Shared booking-list renderer is missing');
const listRendererSource = providerSource.slice(listRendererStart, listRendererEnd);
assert.match(listRendererSource, /holder\.dataset\.recordsFilter = currentFilter;/, 'Booking-list cards do not expose the selected filter consistently');
assert.match(listRendererSource, /data-open-booking=/, 'Shared list cards no longer expose their existing open action');
assert.doesNotMatch(listRendererSource, /currentFilter\s*===/, 'Day, Upcoming and All must not fork the booking-card component');
assert.doesNotMatch(listRendererSource, /60 мин|timeline-service-duration/, 'List cards repeat duration beside a complete time range');
assert.match(listRendererSource, /bookingScheduleName\(item, fullTitle\)/, 'Booking-list filters do not share the canonical schedule title');
const importedTitleHelperStart = providerSource.indexOf('function importedServiceScheduleName(');
const importedTitleHelperEnd = providerSource.indexOf('\nfunction bookingScheduleName(', importedTitleHelperStart);
assert.ok(importedTitleHelperStart >= 0 && importedTitleHelperEnd > importedTitleHelperStart, 'Imported service title helper is missing');
const importedTitleHelper = Function('serviceName', `${providerSource.slice(importedTitleHelperStart, importedTitleHelperEnd)}; return importedServiceScheduleName;`)(value => value === 'Общий массаж задней поверхности' ? 'Массаж задней поверхности тела' : value);
assert.equal(importedTitleHelper('Общий массаж задней поверхности. Проминающий массаж проблемных зон'), 'Массаж задней поверхности тела', 'Imported secondary description leaks into the schedule title');
assert.equal(importedTitleHelper('Массаж спины + ШВЗ — углублённый (с акцентом на проблемные зоны)'), 'Массаж спины + ШВЗ — углублённый', 'Imported parenthetical detail leaks into the schedule title');
assert.match(providerSource, /cancelMobileDateSettle/, 'A direct date choice does not cancel stale mobile swipe settling');
const shareHelperStart = providerSource.indexOf('async function shareProviderClientPage()');
const shareHelperEnd = providerSource.indexOf('\nfunction clientAppearanceDraftFromForm', shareHelperStart);
assert.ok(shareHelperStart >= 0 && shareHelperEnd > shareHelperStart, 'Client-page share helper is missing');
const shareHelper = providerSource.slice(shareHelperStart, shareHelperEnd);
const hintHelperStart = providerSource.indexOf("const SCHEDULE_CREATE_HINT_STORAGE_PREFIX");
const hintHelperEnd = providerSource.indexOf('\nfunction renderTimeline(', hintHelperStart);
assert.ok(hintHelperStart >= 0 && hintHelperEnd > hintHelperStart, 'Schedule create hint helper is missing');
const hintHelper = providerSource.slice(hintHelperStart, hintHelperEnd);
const openTimelineHelperStart = providerSource.indexOf('function openTimelineBooking(stage, event)');
const openTimelineHelperEnd = providerSource.indexOf('\nfunction openTimelineBookingAtTime', openTimelineHelperStart);
assert.ok(openTimelineHelperStart >= 0 && openTimelineHelperEnd > openTimelineHelperStart, 'Timeline click helper is missing');
const openTimelineHelper = providerSource.slice(openTimelineHelperStart, openTimelineHelperEnd);
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
    document.body.dataset.providerTheme = 'sage';
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
      const distance = Math.min(3, Math.abs(day - 15));
      return `<button type="button" class="${active} ${today}" data-date-distance="${distance}" data-booking-date="2026-09-${String(day).padStart(2, '0')}"><span>${day === 14 ? 'Сегодня' : weekday}</span><strong>${day}</strong><small>сент</small></button>`;
    }).join('');
    document.querySelector('#selectedDateTitle').textContent = 'Вторник, 15 сентября';
    document.querySelector('#selectedDateSummary').textContent = '2 записи · 2 перерыва';
    document.querySelector('#todayBookingsCount').textContent = '0';
    document.querySelector('#todayBookingsLabel').textContent = 'сегодня';
    document.querySelector('#tomorrowBookingsCount').textContent = '2';
    document.querySelector('#tomorrowBookingsLabel').textContent = 'завтра';
    document.querySelector('#newBookingsCount').textContent = '5';
    document.querySelector('#upcomingBookingsLabel').textContent = 'впереди';
    document.querySelector('.booking-filters').hidden = true;
    const bookings = document.querySelector('#providerBookings');
    bookings.className = 'provider-bookings timeline-view';
    bookings.innerHTML = `<div class="day-timeline" style="--timeline-height:720px;--half-hour-offset:32.5px;--timeline-empty-hint-top:0;height:720px">
      <div class="timeline-hours">
        <span class="timeline-hour" style="top:0">10:00</span><span class="timeline-hour timeline-half-hour" style="top:32.5px">10:30</span>
        <span class="timeline-hour" style="top:65px">11:00</span><span class="timeline-hour timeline-half-hour" style="top:97.5px">11:30</span>
        <span class="timeline-hour" style="top:130px">12:00</span><span class="timeline-hour timeline-half-hour" style="top:162.5px">12:30</span>
        <span class="timeline-hour" style="top:195px">13:00</span><span class="timeline-hour timeline-half-hour" style="top:227.5px">13:30</span>
        <span class="timeline-hour" style="top:260px">14:00</span><span class="timeline-hour timeline-half-hour" style="top:292.5px">14:30</span>
        <span class="timeline-hour" data-fold-hour style="top:325px">15:00</span><span class="timeline-hour" data-last-hour style="top:700px">20:00</span>
      </div>
      <div class="timeline-stage">
        <i class="timeline-grid-line" style="top:0"></i><i class="timeline-grid-line" style="top:65px"></i><i class="timeline-grid-line" style="top:130px"></i><i class="timeline-grid-line" style="top:195px"></i><i class="timeline-grid-line" style="top:260px"></i><i class="timeline-grid-line" style="top:325px"></i><i class="timeline-grid-line" style="top:719px"></i>
        <button class="timeline-booking status-block automatic-break timeline-tight" data-mobile-timeline-top type="button" style="top:2px;height:61px"><span class="timeline-booking-copy"><strong>Автоперерыв<span class="timeline-automatic-break-source">Автоматический · из правил записи</span></strong><span class="timeline-booking-client-row"><small class="timeline-booking-client"><span class="timeline-mobile-time">10:00–11:00</span></small></span></span></button>
        <button class="timeline-booking status-confirmed timeline-tight" data-mobile-timeline-top data-open-booking data-timeline-movable type="button" style="top:67px;height:61px"><span class="timeline-booking-copy"><strong><span class="timeline-service-title"><span class="timeline-service-core">Массаж спины + ШВЗ</span><span class="timeline-service-variant"> — углублённый</span></span></strong><span class="timeline-booking-client-row"><small class="timeline-booking-client"><span class="timeline-mobile-time">11:00–12:00 · </span>Сертификат</small></span></span><span class="timeline-drag-handle"></span></button>
        <button class="timeline-booking status-block automatic-break timeline-tight" data-mobile-timeline-top type="button" style="top:132px;height:61px"><span class="timeline-booking-copy"><strong>Автоперерыв<span class="timeline-automatic-break-source">Автоматический · из правил записи</span></strong><span class="timeline-booking-client-row"><small class="timeline-booking-client"><span class="timeline-mobile-time">12:00–13:00</span></small></span></span></button>
        <button class="timeline-booking status-confirmed timeline-tight" data-mobile-timeline-top data-open-booking="second" data-timeline-movable type="button" style="top:197px;height:61px"><span class="timeline-booking-copy"><strong><span class="timeline-service-title"><span class="timeline-service-core">Массаж спины + ШВЗ</span><span class="timeline-service-variant"> — углублённый</span></span></strong><span class="timeline-booking-client-row"><small class="timeline-booking-client"><span class="timeline-mobile-time">13:00–14:00 · </span>Екатерина</small></span></span><span class="timeline-drag-handle"></span></button>
        <button class="timeline-booking status-block automatic-break timeline-tight" data-mobile-timeline-top data-fold-break type="button" style="top:262px;height:61px"><span class="timeline-booking-copy"><strong>Автоперерыв<span class="timeline-automatic-break-source">Автоматический · из правил записи</span></strong><span class="timeline-booking-client-row"><small class="timeline-booking-client"><span class="timeline-mobile-time">14:00–15:00</span></small></span></span></button>
      </div>
    </div>`;
    const activeDate = strip.querySelector('.active');
    const stripRect = strip.getBoundingClientRect();
    const activeRect = activeDate.getBoundingClientRect();
    strip.scrollLeft = Math.max(0, activeRect.left - stripRect.left + strip.scrollLeft - (strip.clientWidth - activeRect.width) / 2);
  });

  await page.addScriptTag({ content:`window.uiIcon=()=>'<svg></svg>';window.currentUser={id:'new-provider'};window.bookings=[];window.requireBookingWrites=()=>true;window.timelineTimeFromClick=()=> '10:30';window.openTimelineBookingAtTime=(time,date)=>{window.__openedTimelineSlot={time,date};};${hintHelper}\n${openTimelineHelper}` });
  const hintResult = await page.evaluate(() => {
    localStorage.clear();
    const stage = document.createElement('div');
    stage.className = 'timeline-stage schedule-hint-test-stage';
    stage.dataset.timelineDate = '2026-09-15';
    document.body.append(stage);
    stage.innerHTML = scheduleCreateHintMarkup({ userId:'new-provider', hasExistingBookings:false });
    const visibleBefore = Boolean(stage.querySelector('.timeline-create-hint'));
    stage.addEventListener('click', event => openTimelineBooking(stage, event), { once:true });
    stage.dispatchEvent(new MouseEvent('click', { bubbles:true, clientY:20 }));
    const visibleAfter = Boolean(stage.querySelector('.timeline-create-hint'));
    const storedAfter = localStorage.getItem(scheduleCreateHintStorageKey('new-provider'));
    const returningMarkup = scheduleCreateHintMarkup({ userId:'new-provider', hasExistingBookings:false });
    scheduleCreateHintMarkup({ userId:'existing-provider', hasExistingBookings:false });
    const existingMarkup = scheduleCreateHintMarkup({ userId:'existing-provider', hasExistingBookings:true });
    const existingStored = localStorage.getItem(scheduleCreateHintStorageKey('existing-provider'));
    stage.remove();
    return { visibleBefore, visibleAfter, storedAfter, returningMarkup, existingMarkup, existingStored, opened:window.__openedTimelineSlot };
  });
  assert.equal(hintResult.visibleBefore, true, 'first-time provider must see the free-time hint');
  assert.equal(hintResult.visibleAfter, false, 'a real free-time click must remove the hint immediately');
  assert.equal(hintResult.storedAfter, 'dismissed', 'free-time hint dismissal must persist for the provider');
  assert.equal(hintResult.returningMarkup, '', 'dismissed hint returned for the same provider');
  assert.equal(hintResult.existingMarkup, '', 'existing provider with bookings received the onboarding hint');
  assert.equal(hintResult.existingStored, 'dismissed', 'existing provider pending state was not migrated to dismissed');
  assert.deepEqual(hintResult.opened, { time:'10:30', date:'2026-09-15' }, 'hint dismissal changed the actual free-time action');

  const emptyDayHintResult = await page.evaluate(() => {
    const stage = document.querySelector('.timeline-stage');
    const originalMarkup = stage.innerHTML;
    const timeline = stage.parentElement;
    const originalHintTop = timeline.style.getPropertyValue('--timeline-empty-hint-top');
    const samples = [360, 600, 780].map(start => {
      const offsetMinutes = timelineEmptyHintOffsetMinutes(start, start + 600, true);
      timeline.style.setProperty('--timeline-empty-hint-top', `${offsetMinutes / 60 * 72}px`);
      stage.innerHTML = '<i class="timeline-grid-line" style="top:0" aria-hidden="true"></i><div class="timeline-empty-state" aria-label="День свободен. Нажмите нужное время, чтобы записать клиента или поставить перерыв"><span>+</span><small>Нажмите нужное время, чтобы записать клиента или поставить перерыв</small></div>';
      const hint = stage.querySelector('.timeline-empty-state');
      const hintRect = hint.getBoundingClientRect();
      const stageRect = stage.getBoundingClientRect();
      const hitTarget = document.elementFromPoint((hintRect.left + hintRect.right) / 2, (hintRect.top + hintRect.bottom) / 2);
      return {
        start,
        offsetMinutes,
        topInset:hintRect.top - stageRect.top,
        height:hintRect.height,
        pointerEvents:getComputedStyle(hint).pointerEvents,
        clickPassesThrough:hitTarget === stage || Boolean(hitTarget && stage.contains(hitTarget) && hitTarget !== hint),
        hasDuplicateHeading:Boolean(hint.querySelector('strong')),
        text:hint.textContent.replace('+', '').trim()
      };
    });
    stage.innerHTML = originalMarkup;
    timeline.style.setProperty('--timeline-empty-hint-top', originalHintTop);
    return samples;
  });
  assert.deepEqual(emptyDayHintResult.map(sample => sample.offsetMinutes), [360,120,0], `phone hint should align with noon where available: ${JSON.stringify(emptyDayHintResult)}`);
  assert.ok(emptyDayHintResult.every(sample => sample.height <= 52 && sample.pointerEvents === 'none' && sample.clickPassesThrough), `empty-day hint blocks or escapes the first mobile slot: ${JSON.stringify(emptyDayHintResult)}`);
  assert.ok(emptyDayHintResult.every(sample => !sample.hasDuplicateHeading && sample.text === 'Нажмите нужное время, чтобы записать клиента или поставить перерыв'), `empty-day hint duplicates the day heading or changed its action: ${JSON.stringify(emptyDayHintResult)}`);

  const timelineGridTops = new Map();
  const timelineToolbarTops = new Map();
  const timelineCopyTops = new Map();
  const timelineToggleTops = new Map();
  const timelineClientWidths = new Map();
  for (const { width, height } of [{ width:320, height:700 }, { width:360, height:800 }, { width:390, height:844 }, { width:430, height:900 }, { width:760, height:1000 }, { width:1440, height:1000 }]) {
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
      const previous = rect('.date-strip-shift[data-date-shift="-1"]');
      const next = rect('.date-strip-shift[data-date-shift="1"]');
      const previousStyle = getComputedStyle(document.querySelector('.date-strip-shift[data-date-shift="-1"]'));
      const nextStyle = getComputedStyle(document.querySelector('.date-strip-shift[data-date-shift="1"]'));
      const previousIconStyle = getComputedStyle(document.querySelector('.date-strip-shift[data-date-shift="-1"] .ui-icon'));
      const previousMarkStyle = getComputedStyle(document.querySelector('.date-strip-shift[data-date-shift="-1"]'), '::before');
      const nextMarkStyle = getComputedStyle(document.querySelector('.date-strip-shift[data-date-shift="1"]'), '::before');
      const stripFadeBefore = getComputedStyle(document.querySelector('.date-strip-frame'), '::before');
      const stripFadeAfter = getComputedStyle(document.querySelector('.date-strip-frame'), '::after');
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
      const tabElements = [...document.querySelectorAll('[data-calendar-view]')];
      const tabs = tabElements.map(item => item.getBoundingClientRect().height);
      const tabAccent = getComputedStyle(tab, '::after');
      const tabAccentStates = tabElements.map(activeTab => {
        tabElements.forEach(item => item.classList.toggle('active', item === activeTab));
        const activeRect = activeTab.getBoundingClientRect();
        const activeAccent = getComputedStyle(activeTab, '::after');
        const inactiveAccents = tabElements
          .filter(item => item !== activeTab)
          .map(item => getComputedStyle(item, '::after').content);
        return {
          view:activeTab.dataset.calendarView,
          width:parseFloat(activeAccent.width),
          tabWidth:activeRect.width,
          left:parseFloat(activeAccent.left),
          right:parseFloat(activeAccent.right),
          inactiveAccents
        };
      });
      tabElements.forEach(item => item.classList.toggle('active', item === tab));
      const activeButton = document.querySelector('#dateStrip>button.active');
      const activeDate = activeButton.getBoundingClientRect();
      const activeDateMarker = getComputedStyle(activeButton, '::after');
      const quietTodayButton = document.querySelector('#dateStrip>button.is-today:not(.active)');
      const quietTodayStyle = getComputedStyle(quietTodayButton);
      const ordinaryDateStyle = getComputedStyle(document.querySelector('#dateStrip>button:not(.active):not(.is-today)'));
      const todayButtonStyle = getComputedStyle(document.querySelector('[data-date-today]'));
      const pickerStyle = getComputedStyle(document.querySelector('.schedule-date-picker'));
      const summary = document.querySelector('.schedule-title-line .dashboard-summary');
      const summaryRect = summary.getBoundingClientRect();
      const summaryChildrenInside = [...summary.children].filter(child => getComputedStyle(child).display !== 'none').every(child => {
        const item = child.getBoundingClientRect();
        return item.left >= summaryRect.left - 1 && item.right <= summaryRect.right + 1;
      });
      const summaryLabelsInside = [...summary.querySelectorAll('strong,span')].filter(label => getComputedStyle(label).position !== 'absolute').every(label => {
        const item = label.getBoundingClientRect();
        return item.left >= summaryRect.left - 1 && item.right <= summaryRect.right + 1;
      });
      const summaryItemCenterDeltas = [...summary.querySelectorAll(':scope>div')].map(item => {
        const itemRect = item.getBoundingClientRect();
        const labels = [...item.querySelectorAll('strong,span')].map(label => label.getBoundingClientRect());
        const contentLeft = Math.min(...labels.map(label => label.left));
        const contentRight = Math.max(...labels.map(label => label.right));
        return Math.abs((contentLeft + contentRight) / 2 - (itemRect.left + itemRect.right) / 2);
      });
      const summaryItems = [...summary.querySelectorAll(':scope>div')].map(item => item.getBoundingClientRect());
      const summaryTotalPrefix = getComputedStyle(summary.querySelector(':scope>div:nth-of-type(3)'), '::before').content;
      const newBookingButton = document.querySelector('#newBookingButton');
      const newBookingRect = newBookingButton.getBoundingClientRect();
      const newBookingHitTarget = document.elementFromPoint(
        (newBookingRect.left + newBookingRect.right) / 2,
        (newBookingRect.top + newBookingRect.bottom) / 2
      );
      const toolbar = rect('.schedule-toolbar');
      const toolbarStyle = getComputedStyle(document.querySelector('.schedule-toolbar'));
      const toolbarCopy = rect('.schedule-toolbar>div:first-child');
      const journalToggle = rect('.journal-mode-toggle');
      const journalTargets = [...document.querySelectorAll('.journal-mode-toggle button')].map(button => button.getBoundingClientRect());
      const periodTabs = rect('.calendar-view-toggle');
      const titleHeading = rect('.schedule-view-title h2');
      const newBookingLabel = newBookingButton.querySelector('span');
      const newBookingLabelStyle = getComputedStyle(newBookingLabel);
      const timelineStage = document.querySelector('.timeline-stage');
      const timelineStageRect = timelineStage.getBoundingClientRect();
      const timelineViewRect = document.querySelector('#providerBookings').getBoundingClientRect();
      const firstHourRect = document.querySelector('.timeline-hour').getBoundingClientRect();
      const firstHalfHourRect = document.querySelector('.timeline-hour.timeline-half-hour').getBoundingClientRect();
      const foldHourRect = document.querySelector('[data-fold-hour]').getBoundingClientRect();
      const lastHourRect = document.querySelector('[data-last-hour]').getBoundingClientRect();
      const breakRect = document.querySelector('.timeline-booking.automatic-break').getBoundingClientRect();
      const foldBreakRect = document.querySelector('[data-fold-break]').getBoundingClientRect();
      const breakPauseStyle = getComputedStyle(document.querySelector('.timeline-booking.automatic-break .timeline-booking-copy>strong'), '::before');
      const timelineStageStyle = getComputedStyle(timelineStage);
      const timelineLines = [...timelineStage.querySelectorAll('.timeline-grid-line')].map(line => line.getBoundingClientRect());
      const mobileNav = document.querySelector('.provider-mobile-nav');
      const workspace = document.querySelector('.provider-workspace');
      const picker = document.querySelector('.schedule-date-picker');
      const pickerStyleBeforeFocus = getComputedStyle(picker);
      const pickerInput = picker.querySelector('input');
      const pickerInputStyle = getComputedStyle(pickerInput);
      const pickerInputRect = pickerInput.getBoundingClientRect();
      picker.querySelector('input').focus({ preventScroll:true });
      const pickerFocusStyle = getComputedStyle(picker);
      const pickerFocus = {
        width:parseFloat(pickerFocusStyle.outlineWidth),
        offset:parseFloat(pickerFocusStyle.outlineOffset),
        radius:pickerFocusStyle.borderRadius,
        baseRadius:pickerStyleBeforeFocus.borderRadius
      };
      const timelineBooking = timelineStage.querySelector('.timeline-booking[data-open-booking]');
      const timelineBookingRect = timelineBooking.getBoundingClientRect();
      const timelineServiceTitleElement = timelineBooking.querySelector('.timeline-service-title');
      const timelineServiceTitle = timelineServiceTitleElement.getBoundingClientRect();
      const timelineDragHandle = timelineBooking.querySelector('.timeline-drag-handle').getBoundingClientRect();
      timelineBooking.focus({ preventScroll:true });
      const timelineFocusWidth = parseFloat(getComputedStyle(timelineBooking).outlineWidth);
      const accentProbe = document.createElement('i');
      accentProbe.style.color = 'var(--theme-accent)';
      document.body.append(accentProbe);
      const expectedThemeAccent = getComputedStyle(accentProbe).color;
      accentProbe.style.color = 'var(--schedule-active-color)';
      const expectedScheduleAccent = getComputedStyle(accentProbe).color;
      accentProbe.remove();
      const activeDateRhythm = () => {
        const rows = [...activeButton.querySelectorAll('span,strong,small')].map(item => item.getBoundingClientRect());
        const card = activeButton.getBoundingClientRect();
        return {
          numberCenterDelta:Math.abs((rows[1].top + rows[1].bottom) / 2 - (card.top + card.bottom) / 2),
          gapDelta:Math.abs((rows[1].top - rows[0].bottom) - (rows[2].top - rows[1].bottom))
        };
      };
      const twoDigitRhythm = activeDateRhythm();
      const activeNumber = activeButton.querySelector('strong');
      const originalNumber = activeNumber.textContent;
      activeNumber.textContent = '7';
      const singleDigitRhythm = activeDateRhythm();
      activeNumber.textContent = originalNumber;
      return {
        overflow:document.documentElement.scrollWidth > innerWidth + 2,
        clientWidth:document.documentElement.clientWidth,
        body:document.body.getBoundingClientRect(),
        providerView:rect('.provider-view[data-provider-panel="bookings"]'),
        scheduleCard:rect('.schedule-card'),
        workspace:rect('.provider-workspace'),
        scheduleTop:rect('#providerBookings').top,
        timelineTop:rect('.day-timeline').top,
        topbar:rect('.provider-topbar'),
        title:rect('.schedule-view-title'),
        titleHeading,
        navigation:rect('.date-navigation'),
        strip:stripFrame,
        stripViewport:strip,
        toolbar,
        toolbarBox:{ height:toolbarStyle.height, minHeight:toolbarStyle.minHeight, padding:[toolbarStyle.paddingTop,toolbarStyle.paddingBottom], boxSizing:toolbarStyle.boxSizing },
        toolbarCopy,
        journalToggle,
        journalTargetSizes:journalTargets.map(item => ({ width:item.width, height:item.height })),
        periodTabs,
        newBooking:rect('#newBookingButton'),
        today:rect('[data-date-today]'),
        picker:rect('.schedule-date-picker'),
        previous,
        next,
        previousBackgroundImage:previousStyle.backgroundImage,
        nextBackgroundImage:nextStyle.backgroundImage,
        previousIconColor:previousIconStyle.color,
        previousIconWidth:parseFloat(previousIconStyle.width),
        previousIconDisplay:previousIconStyle.display,
        chevronSizes:[parseFloat(previousMarkStyle.width), parseFloat(previousMarkStyle.height), parseFloat(nextMarkStyle.width), parseFloat(nextMarkStyle.height)],
        stripFadeBefore:{ backgroundImage:stripFadeBefore.backgroundImage, pointerEvents:stripFadeBefore.pointerEvents, width:parseFloat(stripFadeBefore.width) },
        stripFadeAfter:{ backgroundImage:stripFadeAfter.backgroundImage, pointerEvents:stripFadeAfter.pointerEvents, width:parseFloat(stripFadeAfter.width) },
        fullyVisibleDates,
        intersectingDates,
        activeDate,
        activeDateCssWidth:getComputedStyle(activeButton).width,
        activeDateFlexBasis:getComputedStyle(activeButton).flexBasis,
        activeDateCustomWidth:getComputedStyle(activeButton).getPropertyValue('--date-card-width').trim(),
        activeDateBoxSizing:getComputedStyle(activeButton).boxSizing,
        twoDigitRhythm,
        singleDigitRhythm,
        activeDateValue:activeButton.dataset.bookingDate,
        activeDateBackground:getComputedStyle(activeButton).backgroundColor,
        activeDateMarkerContent:activeDateMarker.content,
        activeDateMarkerDisplay:activeDateMarker.display,
        activeDateVisible:activeDate.left >= strip.left - 1 && activeDate.right <= strip.right + 1,
        stripScrollLeft:document.querySelector('#dateStrip').scrollLeft,
        stripScrollWidth:document.querySelector('#dateStrip').scrollWidth,
        tabBackground:getComputedStyle(tab).backgroundColor,
        tabAccentHeight:tabAccent.height,
        tabAccentStates,
        tabHeights:tabs,
        summary:summaryRect,
        summaryScrollWidth:summary.scrollWidth,
        summaryClientWidth:summary.clientWidth,
        summaryChildrenInside,
        summaryLabelsInside,
        summaryItemCenterDeltas,
        summaryItems,
        summaryTotalPrefix,
        summaryText:[...summary.querySelectorAll('strong,span')].map(item => item.textContent.trim()),
        newBookingHitTarget:newBookingHitTarget === newBookingButton || newBookingButton.contains(newBookingHitTarget),
        newBookingLabel:newBookingLabel.textContent.trim(),
        newBookingLabelVisible:newBookingLabelStyle.position === 'static' && newBookingLabel.getBoundingClientRect().width > 0,
        newBookingPseudo:getComputedStyle(newBookingButton, '::after').content,
        titleToNewBookingVerticalGap:newBookingRect.top - titleHeading.bottom,
        timelineStageOverflow:[timelineStageStyle.overflowX,timelineStageStyle.overflowY],
        timelineLinesInside:timelineLines.every(line => line.left >= timelineStageRect.left - .5 && line.right <= timelineStageRect.right + .5 && line.top >= timelineStageRect.top - .5 && line.bottom <= timelineStageRect.bottom + .5),
        firstHourVisible:firstHourRect.top >= timelineViewRect.top - .5 && firstHourRect.bottom <= timelineViewRect.bottom + .5,
        foldHour:{ top:foldHourRect.top, bottom:foldHourRect.bottom },
        foldBreak:{ top:foldBreakRect.top, bottom:foldBreakRect.bottom },
        breakPauseVerticalAlign:breakPauseStyle.verticalAlign,
        breakPauseWidth:breakPauseStyle.width,
        breakPauseHeight:breakPauseStyle.height,
        breakPauseBackgroundImage:breakPauseStyle.backgroundImage,
        breakPauseShadow:breakPauseStyle.boxShadow,
        timelineGutter:timelineStageRect.left - timelineViewRect.left,
        hourOuterInset:firstHourRect.left - timelineViewRect.left,
        hourStageGap:Math.min(timelineStageRect.left - firstHourRect.right, timelineStageRect.left - firstHalfHourRect.right),
        bookingRightInset:timelineStageRect.right - timelineBookingRect.right,
        dragHandleInside:timelineDragHandle.right <= timelineBookingRect.right + .5 && timelineDragHandle.left >= timelineBookingRect.left,
        duplicateDurationCount:timelineBooking.querySelectorAll('.timeline-service-duration').length,
        serviceTitleLineCount:timelineServiceTitle.height / parseFloat(getComputedStyle(timelineServiceTitleElement).lineHeight),
        serviceTitleClientWidth:timelineServiceTitleElement.clientWidth,
        serviceTitleScrollWidth:timelineServiceTitleElement.scrollWidth,
        serviceTitleRect:{ top:timelineServiceTitle.top, right:timelineServiceTitle.right, bottom:timelineServiceTitle.bottom, left:timelineServiceTitle.left },
        dragHandleRect:{ top:timelineDragHandle.top, right:timelineDragHandle.right, bottom:timelineDragHandle.bottom, left:timelineDragHandle.left },
        serviceTitleFullyVisible:timelineServiceTitleElement.scrollWidth <= timelineServiceTitleElement.clientWidth + 1,
        serviceTitleHandleOverlap:!(timelineServiceTitle.right <= timelineDragHandle.left || timelineServiceTitle.left >= timelineDragHandle.right || timelineServiceTitle.bottom <= timelineDragHandle.top || timelineServiceTitle.top >= timelineDragHandle.bottom),
        breakInside:breakRect.top >= timelineStageRect.top && breakRect.bottom <= timelineStageRect.bottom,
        lastHourInside:lastHourRect.top >= timelineViewRect.top && lastHourRect.bottom <= timelineViewRect.bottom + 1,
        focus:{ timeline:timelineFocusWidth, pickerWidth:pickerFocus.width, pickerOffset:pickerFocus.offset, pickerRadius:pickerFocus.radius, pickerBaseRadius:pickerFocus.baseRadius },
        pickerInput:{ width:pickerInputRect.width, textAlign:pickerInputStyle.textAlign, paddingLeft:parseFloat(pickerInputStyle.paddingLeft), paddingRight:parseFloat(pickerInputStyle.paddingRight) },
        toolbarContentCenterDelta:Math.abs((toolbarCopy.top + toolbarCopy.bottom) / 2 - (journalToggle.top + journalToggle.bottom) / 2),
        journalGridGap:rect('.day-timeline').top - journalToggle.bottom,
        quietTodayBackground:quietTodayStyle.backgroundColor,
        quietTodayBackgroundImage:quietTodayStyle.backgroundImage,
        quietTodayShadow:quietTodayStyle.boxShadow,
        dateNumberSize:parseFloat(getComputedStyle(activeButton.querySelector('strong')).fontSize),
        dateCenterDelta:Math.abs((activeDate.top + activeDate.bottom) / 2 - (stripFrame.top + stripFrame.bottom) / 2),
        ordinaryDateBackground:ordinaryDateStyle.backgroundColor,
        ordinaryDateBackgroundImage:ordinaryDateStyle.backgroundImage,
        ordinaryDateShadow:ordinaryDateStyle.boxShadow,
        todayButtonBackground:todayButtonStyle.backgroundColor,
        todayButtonBackgroundImage:todayButtonStyle.backgroundImage,
        todayButtonShadow:todayButtonStyle.boxShadow,
        pickerBackground:pickerStyle.backgroundColor,
        scheduleWorkspace:rect('.schedule-workspace'),
        newBookingBackground:getComputedStyle(newBookingButton).backgroundColor,
        journalActiveBackground:getComputedStyle(document.querySelector('.journal-mode-toggle button.active')).backgroundColor,
        expectedThemeAccent,
        expectedScheduleAccent,
        nav:rect('.provider-mobile-nav'),
        navTargets:[...mobileNav.querySelectorAll(':scope>button')].map(button => {
          const item = button.getBoundingClientRect();
          return { height:item.height, width:item.width };
        }),
        workspacePaddingBottom:parseFloat(getComputedStyle(workspace).paddingBottom),
        viewportHeight:innerHeight
      };
    });
    assert.equal(result.overflow, false, `${width}px horizontal overflow`);
      assert.ok(result.newBooking.height >= (width <= 760 ? 44 : 42) && result.newBooking.width >= 44, `${width}px New booking target`);
    assert.ok(width <= 760
      ? result.timelineStageOverflow.every(value => value === 'visible')
      : result.timelineStageOverflow.every(value => value === 'clip' || value === 'hidden'), `${width}px timeline overflow contract changed: ${JSON.stringify(result)}`);
      assert.equal(result.timelineLinesInside, true, `${width}px timeline divider leaves its rounded owner: ${JSON.stringify(result)}`);
      assert.equal(result.firstHourVisible, true, `${width}px first timeline label is clipped: ${JSON.stringify(result)}`);
      assert.equal(result.lastHourInside, true, `${width}px full working range is not rendered inside the schedule: ${JSON.stringify(result)}`);
      assert.equal(result.breakInside, true, `${width}px automatic break escapes the schedule card: ${JSON.stringify(result)}`);
      assert.equal(result.duplicateDurationCount, 0, `${width}px booking repeats duration beside a full time range: ${JSON.stringify(result)}`);
      assert.ok(result.focus.timeline >= 2, `${width}px keyboard focus is not visible: ${JSON.stringify(result)}`);
      if (width <= 760) {
        const expectedCardGap = width <= 420 ? 12 : 16;
        assert.ok(Math.abs(result.navigation.left - expectedCardGap) <= 1, `${width}px date card keeps a double outer inset: ${JSON.stringify(result)}`);
        assert.ok(Math.abs(result.toolbar.left - expectedCardGap) <= 1, `${width}px journal card keeps a double outer inset: ${JSON.stringify(result)}`);
        assert.ok(Math.abs(result.scheduleWorkspace.left - expectedCardGap) <= 1, `${width}px schedule table is not aligned with its header: ${JSON.stringify(result)}`);
        assert.ok(Math.abs(result.navigation.right - (result.body.right - expectedCardGap)) <= 1, `${width}px date card right inset changed: ${JSON.stringify(result)}`);
        assert.ok(Math.abs(result.scheduleWorkspace.right - (result.body.right - expectedCardGap)) <= 1, `${width}px schedule table right inset changed: ${JSON.stringify(result)}`);
      assert.ok(result.today.height >= 44 && result.today.width >= 44, `${width}px Today target`);
      assert.equal(result.newBookingHitTarget, true, `${width}px New booking button is covered by another layer: ${JSON.stringify(result)}`);
      assert.equal(result.newBookingLabel, 'Новая запись', `${width}px New booking label changed`);
      assert.equal(result.newBookingLabelVisible, true, `${width}px full New booking label is hidden: ${JSON.stringify(result)}`);
      assert.ok(result.newBookingPseudo === 'none' || result.newBookingPseudo === 'normal', `${width}px ambiguous compact label is still rendered: ${JSON.stringify(result)}`);
      assert.ok(result.titleToNewBookingVerticalGap >= 4, `${width}px full New booking label collides with the schedule title: ${JSON.stringify(result)}`);
      assert.ok(result.titleHeading.bottom <= result.topbar.bottom + 1, `${width}px schedule heading did not join the compact top bar: ${JSON.stringify(result)}`);
      assert.ok(result.title.top >= result.topbar.bottom, `${width}px summary row overlaps the top bar: ${JSON.stringify(result)}`);
      assert.ok(result.title.height <= 46, `${width}px schedule heading still reserves a redundant row: ${JSON.stringify(result)}`);
      assert.ok(result.newBooking.width >= 108 && result.newBooking.height >= 44, `${width}px New booking button changed height or is too narrow: ${JSON.stringify(result)}`);
      assert.ok(result.periodTabs.top - result.newBooking.bottom >= 8 && result.periodTabs.top - result.newBooking.bottom <= 12, `${width}px New booking and period tabs lost their calm gap: ${JSON.stringify(result)}`);
      assert.ok(result.toolbar.height <= 54, `${width}px day summary header is still too tall: ${JSON.stringify(result)}`);
      assert.ok(result.journalTargetSizes.every(target => target.width >= 44 && target.height >= 44), `${width}px journal toggle target is below 44px: ${JSON.stringify(result)}`);
      assert.ok(result.journalToggle.height <= 44, `${width}px journal toggle chrome is still too tall: ${JSON.stringify(result)}`);
      assert.ok(result.timelineGutter >= 42 && result.timelineGutter <= 46, `${width}px timeline keeps an excessive time gutter: ${JSON.stringify(result)}`);
      assert.ok(result.hourOuterInset >= 6 && result.hourOuterInset <= 12, `${width}px hour label is not safely shifted left: ${JSON.stringify(result)}`);
      assert.ok(result.hourStageGap >= 5, `${width}px hour label touches the timeline stage: ${JSON.stringify(result)}`);
      assert.ok(result.bookingRightInset >= 2 && result.bookingRightInset <= 5, `${width}px booking does not use the released right width: ${JSON.stringify(result)}`);
      assert.equal(result.dragHandleInside, true, `${width}px drag handle escapes the booking: ${JSON.stringify(result)}`);
      assert.ok(result.serviceTitleLineCount <= 1.1 && result.serviceTitleFullyVisible && !result.serviceTitleHandleOverlap, `${width}px full service title does not fit its one-line safe area without crossing the handle: ${JSON.stringify(result)}`);
      assert.ok(result.picker.height >= 44, `${width}px date picker target`);
      assert.ok(result.focus.pickerWidth >= 2 && result.focus.pickerOffset <= -2 && result.focus.pickerRadius === result.focus.pickerBaseRadius, `${width}px date picker focus ring escapes its rounded field: ${JSON.stringify(result)}`);
      assert.ok(result.pickerInput.textAlign === 'center' && result.pickerInput.paddingRight >= 24 && result.pickerInput.paddingLeft === 0, `${width}px date text is not centered inside its own arrow-safe zone: ${JSON.stringify(result)}`);
      assert.ok(result.previous.height >= 44 && result.next.height >= 44, `${width}px date strip arrows`);
      assert.ok(result.nav.height <= 50, `${width}px mobile navigation is still too tall: ${JSON.stringify(result.nav)}`);
      assert.ok(result.navTargets.length === 5 && result.navTargets.every(target => target.height >= 44 && target.width >= 44), `${width}px mobile navigation targets are not accessible: ${JSON.stringify(result.navTargets)}`);
      assert.ok(result.workspacePaddingBottom >= result.nav.height + (height - result.nav.bottom) + 16, `${width}px compact mobile navigation lacks safe clearance: ${JSON.stringify(result)}`);
      assert.equal(result.previousBackgroundImage, 'none', `${width}px previous chevron regained a heavy background`);
      assert.equal(result.nextBackgroundImage, 'none', `${width}px next chevron regained a heavy background`);
      assert.ok(result.previousIconColor, `${width}px previous arrow icon lost its quiet color`);
      assert.equal(result.previousIconDisplay, 'none', `${width}px long arrow icon is still visible: ${JSON.stringify(result)}`);
      assert.ok(result.chevronSizes.every(size => size >= 9 && size <= 12), `${width}px date strip chevrons are not compact: ${JSON.stringify(result)}`);
      assert.ok(result.fullyVisibleDates >= (width >= 600 ? 5 : 3), `${width}px exposes too few dates between arrows: ${JSON.stringify(result)}`);
      assert.ok(result.intersectingDates >= result.fullyVisibleDates && result.intersectingDates <= result.fullyVisibleDates + 2, `${width}px exposes too many cropped edge dates: ${JSON.stringify(result)}`);
      assert.equal(result.stripFadeBefore.pointerEvents, 'none', `${width}px previous edge fade intercepts date gestures`);
      assert.equal(result.stripFadeAfter.pointerEvents, 'none', `${width}px next edge fade intercepts date gestures`);
      assert.ok(result.previous.right <= result.stripViewport.left + 1, `${width}px previous arrow overlaps the date strip: ${JSON.stringify(result)}`);
      assert.ok(result.stripViewport.right <= result.next.left + 1, `${width}px next arrow overlaps the date strip: ${JSON.stringify(result)}`);
      assert.equal(result.activeDateVisible, true, `${width}px selected date must remain visible: ${JSON.stringify(result)}`);
      assert.equal(result.activeDateValue, '2026-09-15', `${width}px fixture selected date changed`);
      assert.notEqual(result.activeDateBackground, 'rgba(0, 0, 0, 0)', `${width}px selected date lost its accent`);
      assert.equal(result.activeDateBackground, result.expectedScheduleAccent, `${width}px selected date lost the solid brand green`);
      assert.equal(result.newBookingBackground, result.expectedScheduleAccent, `${width}px New booking lost the solid brand green`);
      assert.equal(result.journalActiveBackground, result.expectedScheduleAccent, `${width}px active journal mode lost the solid brand green`);
      assert.ok(result.activeDate.width >= 44 && result.activeDate.width <= 52, `${width}px selected date is still oversized: ${JSON.stringify(result)}`);
      assert.ok(result.activeDate.height >= 53 && result.activeDate.height <= 55, `${width}px selected date height is still oversized: ${JSON.stringify(result)}`);
      assert.ok(result.twoDigitRhythm.numberCenterDelta <= 1 && result.twoDigitRhythm.gapDelta <= 2, `${width}px two-digit selected date lost its vertical rhythm: ${JSON.stringify(result)}`);
      assert.ok(result.singleDigitRhythm.numberCenterDelta <= 1 && result.singleDigitRhythm.gapDelta <= 2, `${width}px single-digit selected date lost its vertical rhythm: ${JSON.stringify(result)}`);
      assert.ok(result.activeDateMarkerContent === 'none' || result.activeDateMarkerDisplay === 'none', `${width}px selected date regained a second lower marker: ${JSON.stringify(result)}`);
      assert.ok(result.scheduleTop >= 330 && result.scheduleTop <= 480, `${width}px schedule begins too low for the 14:00–15:00 mobile fold: ${JSON.stringify(result)}`);
      assert.ok(result.toolbarContentCenterDelta <= 2, `${width}px day heading and journal toggle are not aligned: ${JSON.stringify(result)}`);
      assert.ok(result.journalGridGap >= 8, `${width}px timeline grid touches the journal toggle: ${JSON.stringify(result)}`);
      assert.ok(result.timelineTop - result.scheduleTop >= 6 && result.timelineTop - result.scheduleTop <= 8, `${width}px timeline needs 6–8px of air below its header: ${JSON.stringify(result)}`);
      assert.equal(result.breakPauseVerticalAlign, 'middle', `${width}px automatic-break pause mark lost its optical alignment: ${JSON.stringify(result)}`);
      assert.equal(result.breakPauseWidth, '3px', `${width}px automatic-break pause mark lost its fixed bar thickness: ${JSON.stringify(result)}`);
      assert.notEqual(result.breakPauseHeight, '10px', `${width}px automatic-break pause mark reverted to the old low glyph box: ${JSON.stringify(result)}`);
      assert.equal(result.breakPauseBackgroundImage, 'none', `${width}px automatic-break pause mark regained a font-like gradient: ${JSON.stringify(result)}`);
      assert.notEqual(result.breakPauseShadow, 'none', `${width}px automatic-break pause mark lost its second equal bar: ${JSON.stringify(result)}`);
      if (height >= 800) {
        assert.ok(result.foldBreak.bottom <= result.nav.top && result.foldHour.bottom <= result.nav.top, `${width}px 14:00–15:00 break or 15:00 mark falls behind mobile navigation: ${JSON.stringify(result)}`);
      }
      assert.ok(result.strip.top - result.navigation.bottom >= -1 && result.strip.top - result.navigation.bottom <= 1, `${width}px date controls and strip no longer form one card: ${JSON.stringify(result)}`);
      assert.ok(result.toolbar.top - result.strip.bottom >= 5 && result.toolbar.top - result.strip.bottom <= 8, `${width}px date card and journal card lost their compact separation: ${JSON.stringify(result)}`);
      assert.ok(Math.abs(result.viewportHeight - result.nav.bottom) <= 1, `${width}px compact navigation must use the viewport edge while preserving safe-area`);
      assert.equal(result.tabBackground, 'rgba(0, 0, 0, 0)', `${width}px period tabs are not flat`);
      assert.equal(result.tabAccentHeight, '3px', `${width}px selected period needs a clear thin accent`);
      assert.deepEqual(result.tabAccentStates.map(state => state.view), ['day','week','month'], `${width}px period tabs changed order`);
      assert.ok(result.tabAccentStates.every(state => Math.abs(state.left - 5) <= .5 && Math.abs(state.right - 5) <= .5 && Math.abs(state.width - (state.tabWidth - 10)) <= 1), `${width}px active period underline must nearly fill its third: ${JSON.stringify(result)}`);
      assert.ok(result.tabAccentStates.every(state => state.inactiveAccents.every(content => content === 'none')), `${width}px inactive period tab kept an accent: ${JSON.stringify(result)}`);
      assert.ok(result.tabHeights.every(tabHeight => tabHeight >= 44), `${width}px period touch targets must remain at least 44px`);
      assert.equal(result.quietTodayBackground, 'rgba(0, 0, 0, 0)', `${width}px unselected Today date competes with the selected date`);
      assert.equal(result.quietTodayBackgroundImage, 'none', `${width}px unselected Today date gained a decorative fill`);
      assert.notEqual(result.quietTodayShadow, 'none', `${width}px unselected Today date lost its secondary outline`);
      assert.ok(result.dateCenterDelta <= 1, `${width}px date labels lost their vertical rhythm: ${JSON.stringify(result)}`);
      assert.equal(result.ordinaryDateBackground, 'rgba(0, 0, 0, 0)', `${width}px ordinary date gained a fill`);
      assert.equal(result.ordinaryDateBackgroundImage, 'none', `${width}px ordinary date gained a decorative fill`);
      assert.equal(result.ordinaryDateShadow, 'none', `${width}px ordinary dates must stay quiet`);
      assert.notEqual(result.todayButtonBackground, 'rgba(0, 0, 0, 0)', `${width}px separate Today action must have a readable themed fill`);
      assert.equal(result.todayButtonBackgroundImage, 'none', `${width}px separate Today action gained a decorative fill`);
      assert.equal(result.todayButtonShadow, 'none', `${width}px separate Today action gained an extra accent`);
      assert.notEqual(result.pickerBackground, 'rgba(0, 0, 0, 0)', `${width}px date field lost its surface`);
      if (width <= 760) {
        assert.equal(result.summaryTotalPrefix, '"Всего впереди —"', `${width}px upcoming total caption changed: ${JSON.stringify(result)}`);
        assert.ok(Math.abs(result.summaryItems[0].top - result.summaryItems[1].top) <= 1, `${width}px today and tomorrow are not on one compact row: ${JSON.stringify(result)}`);
        assert.ok(result.summaryItems[2].top >= result.summaryItems[0].bottom, `${width}px upcoming total is not on the second row: ${JSON.stringify(result)}`);
        assert.ok(result.summary.right <= result.newBooking.left - 7, `${width}px compact summary collides with New booking: ${JSON.stringify(result)}`);
      }
      if (width <= 430) {
        assert.ok(result.dateNumberSize <= 26 && result.dateNumberSize >= 22, `${width}px selected date is not a compact readable accent: ${JSON.stringify(result)}`);
        assert.ok(result.summaryScrollWidth <= result.summaryClientWidth + 1, `${width}px title summary is clipped: ${JSON.stringify(result)}`);
        assert.equal(result.summaryChildrenInside, true, `${width}px title summary children escape their row: ${JSON.stringify(result)}`);
        assert.deepEqual(result.summaryText, ['0', 'сегодня', '2', 'завтра', '5', 'впереди'], `${width}px title summary fixture changed`);
      }
      timelineGridTops.set(width, result.timelineTop);
      timelineToolbarTops.set(width, result.toolbar.top);
      timelineCopyTops.set(width, result.toolbarCopy.top);
      timelineToggleTops.set(width, result.journalToggle.top);
      timelineClientWidths.set(width, result.clientWidth);
    }
    if (width > 760) {
      timelineToggleTops.set(width, result.journalToggle.top);
      assert.notEqual(result.activeDateBackground, 'rgba(0, 0, 0, 0)', `${width}px selected date lost its solid accent`);
      assert.equal(result.quietTodayBackground, 'rgba(0, 0, 0, 0)', `${width}px Today date competes with the selected date`);
      assert.equal(result.quietTodayShadow, 'none', `${width}px desktop Today date regained a decorative outline`);
    }
    if (width === 390 || width === 760) {
      for (const theme of ['sage', 'warm', 'graphite']) {
        await page.evaluate(selectedTheme => { document.body.dataset.providerTheme = selectedTheme; }, theme);
        await page.waitForTimeout(220);
        const themed = await page.evaluate(() => {
          const activeDate = document.querySelector('#dateStrip>button.active');
          const rows = [...activeDate.querySelectorAll('span,strong,small')].map(item => item.getBoundingClientRect());
          const card = activeDate.getBoundingClientRect();
          const probe = document.createElement('i');
          probe.style.color = 'var(--theme-accent)';
          document.body.append(probe);
          const expected = getComputedStyle(probe).color;
          probe.style.color = 'var(--schedule-active-color)';
          const scheduleAccent = getComputedStyle(probe).color;
          probe.remove();
          const dateStyle = getComputedStyle(activeDate);
          const createStyle = getComputedStyle(document.querySelector('#newBookingButton'));
          const modeStyle = getComputedStyle(document.querySelector('.journal-mode-toggle button.active'));
          return {
            expected,
            scheduleAccent,
            date:dateStyle.backgroundColor,
            dateImage:dateStyle.backgroundImage,
            create:createStyle.backgroundColor,
            createImage:createStyle.backgroundImage,
            mode:modeStyle.backgroundColor,
            modeImage:modeStyle.backgroundImage,
            numberCenterDelta:Math.abs((rows[1].top + rows[1].bottom) / 2 - (card.top + card.bottom) / 2),
            gapDelta:Math.abs((rows[1].top - rows[0].bottom) - (rows[2].top - rows[1].bottom))
          };
        });
        assert.equal(themed.date, themed.scheduleAccent, `${width}px/${theme}: selected date lost the brand green`);
        assert.equal(themed.create, themed.scheduleAccent, `${width}px/${theme}: New booking lost the brand green`);
        assert.equal(themed.mode, themed.scheduleAccent, `${width}px/${theme}: journal mode lost the brand green`);
        assert.deepEqual([themed.dateImage,themed.createImage,themed.modeImage], ['none','none','none'], `${width}px/${theme}: active controls gained a gradient`);
        assert.ok(themed.numberCenterDelta <= 1 && themed.gapDelta <= 2, `${width}px/${theme}: selected date is not vertically centered: ${JSON.stringify(themed)}`);
      }
      await page.evaluate(() => { document.body.dataset.providerTheme = 'sage'; });
      await page.waitForTimeout(220);
    }
    if (output) await page.screenshot({ path:path.join(output, `schedule-compact-${width}.png`), fullPage:false });
    if (output && width === 390) {
      await page.focus('#scheduleDatePicker');
      await page.screenshot({ path:path.join(output, 'schedule-picker-focus-390.png'), fullPage:false });
      await page.evaluate(() => document.querySelector('#scheduleDatePicker').blur());
    }
  }

  await page.setViewportSize({ width:390, height:844 });
  await page.addScriptTag({ content:todayVisibilityHelper });
  await page.evaluate(() => {
    const strip = document.querySelector('#dateStrip');
    [...strip.children].forEach(button => {
      const day = Number(button.querySelector('strong')?.textContent || 0);
      button.classList.toggle('active', day === 19);
      button.dataset.dateDistance = String(Math.min(3, Math.abs(day - 19)));
    });
    const selected = strip.querySelector('[data-booking-date="2026-09-19"]');
    const stripRect = strip.getBoundingClientRect();
    const selectedRect = selected.getBoundingClientRect();
    strip.scrollLeft = Math.max(0, selectedRect.left - stripRect.left + strip.scrollLeft - (strip.clientWidth - selectedRect.width) / 2);
    updateDateStripTodayVisibility(strip);
  });
  await page.waitForTimeout(220);
  const rightEdgeDate = await page.evaluate(() => {
    const strip = document.querySelector('#dateStrip');
    const selected = strip.querySelector('[data-booking-date="2026-09-19"]');
    const button = strip.querySelector('[data-booking-date="2026-09-22"]');
    const label = button.querySelector('small');
    const buttonRect = button.getBoundingClientRect();
    const labelRect = label.getBoundingClientRect();
    const viewport = strip.getBoundingClientRect();
    const selectedRect = selected.getBoundingClientRect();
    const probe = document.createElement('i');
    probe.style.color = 'var(--schedule-active-color)';
    document.body.append(probe);
    const expectedScheduleAccent = getComputedStyle(probe).color;
    probe.remove();
    return {
      selectedCenterDelta:Math.abs((selectedRect.left + selectedRect.right - viewport.left - viewport.right) / 2),
      labelInside:labelRect.left >= buttonRect.left - 1 && labelRect.right <= buttonRect.right + 1 && labelRect.bottom <= buttonRect.bottom + 1,
      label:label.textContent.trim(),
      selectedBackground:getComputedStyle(selected).backgroundColor,
      selectedBackgroundImage:getComputedStyle(selected).backgroundImage,
      expectedScheduleAccent
    };
  });
  assert.ok(rightEdgeDate.selectedCenterDelta <= 1, `390px selected date left the fixed center: ${JSON.stringify(rightEdgeDate)}`);
  assert.equal(rightEdgeDate.labelInside, true, `390px date 22 month label is clipped: ${JSON.stringify(rightEdgeDate)}`);
  assert.equal(rightEdgeDate.label, 'сент', 'date 22 month label changed');
  assert.equal(rightEdgeDate.selectedBackground, rightEdgeDate.expectedScheduleAccent, `390px selected date 19 lost the solid brand green: ${JSON.stringify(rightEdgeDate)}`);
  assert.equal(rightEdgeDate.selectedBackgroundImage, 'none', `390px selected date 19 gained a gradient: ${JSON.stringify(rightEdgeDate)}`);
  await page.evaluate(() => {
    const strip = document.querySelector('#dateStrip');
    [...strip.children].forEach(button => {
      const day = Number(button.querySelector('strong')?.textContent || 0);
      button.classList.toggle('active', day === 24);
      button.classList.toggle('is-today', day === 21);
      button.dataset.dateDistance = String(Math.min(3, Math.abs(day - 24)));
    });
    const selected = strip.querySelector('[data-booking-date="2026-09-24"]');
    const stripRect = strip.getBoundingClientRect();
    const selectedRect = selected.getBoundingClientRect();
    strip.scrollLeft = Math.max(0, selectedRect.left - stripRect.left + strip.scrollLeft - (strip.clientWidth - selectedRect.width) / 2);
    updateDateStripTodayVisibility(strip);
  });
  await page.waitForTimeout(80);
  const today21Visible = await page.evaluate(() => {
    const strip = document.querySelector('#dateStrip').getBoundingClientRect();
    const frame = document.querySelector('.date-strip-frame').getBoundingClientRect();
    const today = document.querySelector('[data-booking-date="2026-09-21"]').getBoundingClientRect();
    const previous = document.querySelector('.date-strip-shift[data-date-shift="-1"]').getBoundingClientRect();
    const todayHidden = getComputedStyle(document.querySelector('[data-booking-date="2026-09-21"]')).visibility === 'hidden';
    return {
      today:{ left:today.left, right:today.right, width:today.width },
      strip:{ left:strip.left, right:strip.right },
      frame:{ left:frame.left, right:frame.right },
      previous:{ left:previous.left, right:previous.right },
      todayHidden
    };
  });
  assert.equal(today21Visible.todayHidden, true, `390px partly clipped “Сегодня 21 сент” remains visible when 24 is selected: ${JSON.stringify(today21Visible)}`);
  if (output) await page.screenshot({ path:path.join(output, 'schedule-today-21-selected-24-390.png'), fullPage:false });
  if (output) await page.screenshot({ path:path.join(output, 'schedule-date-19-390.png'), fullPage:false });

  for (const width of [390,760]) {
    await page.setViewportSize({ width, height:width === 390 ? 844 : 1000 });
    for (const selectedDay of [21,23,24,18]) {
      await page.evaluate(day => {
        const strip = document.querySelector('#dateStrip');
        [...strip.children].forEach(button => {
          const buttonDay = Number(button.querySelector('strong')?.textContent || 0);
          button.classList.toggle('active', buttonDay === day);
          button.classList.toggle('is-today', buttonDay === 21);
          button.dataset.dateDistance = String(Math.min(3, Math.abs(buttonDay - day)));
          button.querySelector('span').textContent = buttonDay === 21 ? 'Сегодня' : new Intl.DateTimeFormat('ru-RU', { weekday:'short' }).format(new Date(2026, 8, buttonDay)).replace('.', '');
        });
        const selected = strip.querySelector(`[data-booking-date="2026-09-${String(day).padStart(2, '0')}"]`);
        const stripRect = strip.getBoundingClientRect();
        const selectedRect = selected.getBoundingClientRect();
        strip.scrollLeft = Math.max(0, Math.min(strip.scrollWidth - strip.clientWidth, selectedRect.left - stripRect.left + strip.scrollLeft - (strip.clientWidth - selectedRect.width) / 2));
        updateDateStripTodayVisibility(strip);
      }, selectedDay);
      await page.waitForTimeout(30);
      const visibility = await page.evaluate(() => {
        const strip = document.querySelector('#dateStrip');
        const frame = document.querySelector('.date-strip-frame').getBoundingClientRect();
        const stripRect = strip.getBoundingClientRect();
        const selectedRect = strip.querySelector('.active').getBoundingClientRect();
        const todayButton = strip.querySelector('.is-today');
        const todayRect = todayButton.getBoundingClientRect();
        const todayLabel = todayButton.querySelector('span');
        const todayLabelRect = todayLabel.getBoundingClientRect();
        const visibleDates = [...strip.querySelectorAll('[data-booking-date]')]
          .filter(button => {
            const rect = button.getBoundingClientRect();
            return rect.left >= stripRect.left - .5 && rect.right <= stripRect.right + .5;
          })
          .map(button => Number(button.querySelector('strong')?.textContent || 0));
        const intersectingDates = [...strip.querySelectorAll('[data-booking-date]')]
          .filter(button => {
            const rect = button.getBoundingClientRect();
            return rect.right > stripRect.left + .5 && rect.left < stripRect.right - .5;
          })
          .map(button => Number(button.querySelector('strong')?.textContent || 0));
        const previous = document.querySelector('.date-strip-shift[data-date-shift="-1"]').getBoundingClientRect();
        const next = document.querySelector('.date-strip-shift[data-date-shift="1"]').getBoundingClientRect();
        return {
          selectedCenterDelta:Math.abs((selectedRect.left + selectedRect.right - stripRect.left - stripRect.right) / 2),
          todayFullyVisible:todayRect.left >= stripRect.left - 1 && todayRect.right <= stripRect.right + 1,
          todayHidden:getComputedStyle(strip.querySelector('.is-today')).visibility === 'hidden',
          todayLabelFits:todayLabel.scrollWidth <= todayLabel.clientWidth + 1
            && todayLabelRect.left >= todayRect.left - 1 && todayLabelRect.right <= todayRect.right + 1,
          todayLabelFontSize:parseFloat(getComputedStyle(todayLabel).fontSize),
          selectedWiderThanToday:selectedRect.width > todayRect.width,
          visibleDates,
          intersectingDates,
          todayClearOfArrows:todayRect.left >= previous.right - 1 && todayRect.right <= next.left + 1,
          arrowsInsideFrame:previous.left >= frame.left - 1 && next.right <= frame.right + 1,
          hitTargets:[previous.width,previous.height,next.width,next.height]
        };
      });
      assert.ok(visibility.selectedCenterDelta <= 1, `${width}px selected ${selectedDay} is not centered: ${JSON.stringify(visibility)}`);
      assert.equal(visibility.todayFullyVisible, !visibility.todayHidden, `${width}px Today 21 is partially visible for selected ${selectedDay}: ${JSON.stringify(visibility)}`);
      if (!visibility.todayHidden) {
        assert.equal(visibility.todayClearOfArrows, true, `${width}px Today 21 intersects an arrow for selected ${selectedDay}: ${JSON.stringify(visibility)}`);
        if (selectedDay !== 21) {
          assert.equal(visibility.todayLabelFits, true, `${width}px Today label escapes its tile for selected ${selectedDay}: ${JSON.stringify(visibility)}`);
          assert.ok(visibility.todayLabelFontSize < 8, `${width}px Today label was not compacted: ${JSON.stringify(visibility)}`);
          assert.equal(visibility.selectedWiderThanToday, true, `${width}px selected date is not wider than Today: ${JSON.stringify(visibility)}`);
        }
      }
      if (width === 390 && selectedDay === 23) {
        assert.deepEqual(visibility.visibleDates, [21,22,23,24,25], `390px must show the five-day window around 23: ${JSON.stringify(visibility)}`);
        assert.deepEqual(visibility.intersectingDates, [21,22,23,24,25], `390px shows a sixth partial tile around 23: ${JSON.stringify(visibility)}`);
      }
      assert.equal(visibility.arrowsInsideFrame, true, `${width}px arrows leave the date frame: ${JSON.stringify(visibility)}`);
      assert.ok(visibility.hitTargets.every(value => value >= 44), `${width}px date arrow lost its 44px hit target: ${JSON.stringify(visibility)}`);
      if (output && width === 390 && selectedDay === 24) await page.screenshot({ path:path.join(output, 'schedule-selected-24-today-21-390.png'), fullPage:false });
    }
    await page.evaluate(() => {
      const strip = document.querySelector('#dateStrip');
      for (const day of [24,18,24,21,24]) {
        [...strip.children].forEach(button => button.classList.toggle('active', Number(button.querySelector('strong')?.textContent || 0) === day));
        const selected = strip.querySelector('.active');
        const stripRect = strip.getBoundingClientRect();
        const selectedRect = selected.getBoundingClientRect();
        strip.scrollLeft = Math.max(0, Math.min(strip.scrollWidth - strip.clientWidth, selectedRect.left - stripRect.left + strip.scrollLeft - (strip.clientWidth - selectedRect.width) / 2));
      }
    });
    const rapidSequence = await page.evaluate(() => {
      const strip = document.querySelector('#dateStrip').getBoundingClientRect();
      const selected = document.querySelector('#dateStrip .active').getBoundingClientRect();
      return Math.abs((selected.left + selected.right - strip.left - strip.right) / 2);
    });
    assert.ok(rapidSequence <= 1, `${width}px rapid date sequence leaves a delayed center: ${rapidSequence}`);
  }

  await page.setViewportSize({ width:360, height:720 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(50);
  await page.mouse.move(180, 360);
  await page.mouse.wheel(0, 2000);
  await page.waitForTimeout(50);
  const shortDayFold = await page.evaluate(() => {
    const lastHourRect = document.querySelector('[data-last-hour]').getBoundingClientRect();
    const nav = document.querySelector('.provider-mobile-nav').getBoundingClientRect();
    return {
      lastHour:{ top:lastHourRect.top, bottom:lastHourRect.bottom, height:lastHourRect.height },
      nav:{ top:nav.top, bottom:nav.bottom, height:nav.height },
      visibleAboveNav:Math.min(lastHourRect.bottom, nav.top) - lastHourRect.top
    };
  });
  assert.ok(shortDayFold.visibleAboveNav >= shortDayFold.lastHour.height - 1, `360x720 final working hour is covered by navigation: ${JSON.stringify(shortDayFold)}`);
  if (output) await page.screenshot({ path:path.join(output, 'schedule-full-day-360x720.png'), fullPage:false });

  await page.evaluate(() => {
    const filters = document.querySelector('.booking-filters');
    filters.hidden = false;
    document.querySelectorAll('[data-journal-mode]').forEach(button => {
      const active = button.dataset.journalMode === 'list';
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const bookings = document.querySelector('#providerBookings');
    bookings.className = 'provider-bookings schedule-list';
    bookings.innerHTML = '<div class="provider-empty schedule-empty"><strong>Записей нет</strong><small>На выбранный период всё свободно.</small></div>';
  });
  for (const { width, height } of [{ width:320, height:700 }, { width:360, height:800 }, { width:390, height:844 }, { width:430, height:900 }, { width:760, height:1000 }]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(80);
    const listResult = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect();
      const toolbar = rect('.schedule-toolbar');
      const copy = rect('.schedule-toolbar>div:first-child');
      const toggle = rect('.journal-mode-toggle');
      const filters = rect('.booking-filters');
      const bookings = rect('#providerBookings');
      const nav = rect('.provider-mobile-nav');
      const workspace = document.querySelector('.provider-workspace');
      const navLabels = [...document.querySelectorAll('.provider-mobile-nav>button span')];
      const modeGeometry = [...document.querySelectorAll('.journal-mode-toggle button')].map(button => {
        const buttonRect = button.getBoundingClientRect();
        const iconRect = button.querySelector('.ui-icon').getBoundingClientRect();
        return {
          mode:button.dataset.journalMode,
          active:button.classList.contains('active'),
          buttonCenter:[(buttonRect.left + buttonRect.right) / 2,(buttonRect.top + buttonRect.bottom) / 2],
          iconCenter:[(iconRect.left + iconRect.right) / 2,(iconRect.top + iconRect.bottom) / 2],
          iconSize:[iconRect.width,iconRect.height]
        };
      });
      return {
        overflow:document.documentElement.scrollWidth > innerWidth + 2,
        clientWidth:document.documentElement.clientWidth,
        toolbar, copy, toggle, filters, bookings, nav, workspace:rect('.schedule-workspace'),
        firstRowFits:copy.right <= toggle.left - 6,
        controlsToFiltersGap:filters.top - Math.max(copy.bottom, toggle.bottom),
        filterOuterBorder:getComputedStyle(document.querySelector('.booking-filters')).borderTopWidth,
        workspacePaddingBottom:parseFloat(getComputedStyle(workspace).paddingBottom),
        navLabelsFit:navLabels.every(label => label.scrollWidth <= label.clientWidth + 1),
        modeGeometry,
        filterButtons:[...document.querySelectorAll('.booking-filters button')].map(button => ({
          height:button.getBoundingClientRect().height,
          scrollWidth:button.scrollWidth,
          clientWidth:button.clientWidth
        }))
      };
    });
    assert.equal(listResult.overflow, false, `${width}px list has horizontal overflow: ${JSON.stringify(listResult)}`);
    assert.ok(listResult.toolbar.height >= 96 && listResult.toolbar.height <= 145, `${width}px list toolbar is not compact: ${JSON.stringify(listResult)}`);
    assert.equal(listResult.firstRowFits, true, `${width}px list heading overlaps the mode toggle: ${JSON.stringify(listResult)}`);
    assert.ok(listResult.controlsToFiltersGap >= 10, `${width}px list filters crowd the journal toggle: ${JSON.stringify(listResult)}`);
    assert.equal(listResult.filterOuterBorder, '0px', `${width}px duplicate filter frame returned`);
    assert.ok(listResult.filters.top >= listResult.toolbar.top && listResult.filters.bottom <= listResult.toolbar.bottom + 1, `${width}px tabs escape toolbar: ${JSON.stringify(listResult)}`);
    assert.ok(listResult.bookings.top >= listResult.toolbar.bottom - 1, `${width}px list content is covered by controls: ${JSON.stringify(listResult)}`);
    const timelineInsetFromFilters = timelineGridTops.get(width) - listResult.filters.top;
    assert.ok(timelineInsetFromFilters >= 0 && timelineInsetFromFilters <= 36, `${width}px timeline grid does not begin near list content: ${JSON.stringify({ timelineGridTop:timelineGridTops.get(width), filtersTop:listResult.filters.top, timelineInsetFromFilters })}`);
    assert.ok(Math.abs(listResult.toolbar.top - timelineToolbarTops.get(width)) <= 1, `${width}px timeline/list toolbar top jumps: ${JSON.stringify(listResult)}`);
    assert.ok(Math.abs(listResult.copy.top - timelineCopyTops.get(width)) <= 10, `${width}px timeline/list day heading jumps: ${JSON.stringify(listResult)}`);
    assert.ok(Math.abs(listResult.toggle.top - timelineToggleTops.get(width)) <= 1, `${width}px timeline/list mode toggle is not vertically stable: ${JSON.stringify({ timelineTop:timelineToggleTops.get(width), listResult })}`);
    assert.equal(listResult.clientWidth, timelineClientWidths.get(width), `${width}px scrollbar changes the schedule width`);
    assert.ok(listResult.filterButtons.every(button => button.height >= 44 && button.scrollWidth <= button.clientWidth + 1), `${width}px list tabs are clipped: ${JSON.stringify(listResult)}`);
    assert.deepEqual(listResult.modeGeometry.map(item => [item.mode,item.active]), [['timeline',false],['list',true]], `${width}px list mode state changed: ${JSON.stringify(listResult)}`);
    assert.ok(listResult.modeGeometry.every(item => Math.abs(item.buttonCenter[0] - item.iconCenter[0]) <= .5 && Math.abs(item.buttonCenter[1] - item.iconCenter[1]) <= .5 && Math.abs(item.iconSize[0] - item.iconSize[1]) <= .5), `${width}px timeline/list icons do not share one centred geometry: ${JSON.stringify(listResult)}`);
    if (width >= 390) assert.equal(listResult.navLabelsFit, true, `${width}px mobile navigation labels are clipped: ${JSON.stringify(listResult)}`);
    assert.ok(listResult.workspacePaddingBottom >= listResult.nav.height + (height - listResult.nav.bottom) + 16, `${width}px mobile navigation lacks safe clearance: ${JSON.stringify(listResult)}`);
    if (output) await page.screenshot({ path:path.join(output, `schedule-list-${width}.png`), fullPage:false });

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(80);
    const bottomGap = await page.evaluate(() => {
      const last = document.querySelector('#providerBookings>:last-child').getBoundingClientRect();
      const nav = document.querySelector('.provider-mobile-nav').getBoundingClientRect();
      return nav.top - last.bottom;
    });
    assert.ok(bottomGap >= 16, `${width}px final list card reaches the fixed navigation after scroll: ${bottomGap}px`);
  }

  await page.setViewportSize({ width:1440, height:1000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(80);
  const desktopListToggleTop = await page.evaluate(() => document.querySelector('.journal-mode-toggle').getBoundingClientRect().top);
  assert.ok(Math.abs(desktopListToggleTop - timelineToggleTops.get(1440)) <= 1, `1440px timeline/list mode toggle is not vertically stable: ${JSON.stringify({ timeline:timelineToggleTops.get(1440), list:desktopListToggleTop })}`);

  await page.setViewportSize({ width:390, height:3000 });
  const scrollbarGutter = await page.evaluate(() => {
    const bookings = document.querySelector('#providerBookings');
    const originalMarkup = bookings.innerHTML;
    const originalMinHeight = bookings.style.minHeight;
    bookings.replaceChildren();
    bookings.style.minHeight = '0px';
    void bookings.getBoundingClientRect();
    const short = { clientWidth:document.documentElement.clientWidth, toolbarTop:document.querySelector('.schedule-toolbar').getBoundingClientRect().top };
    bookings.style.minHeight = '5000px';
    void bookings.getBoundingClientRect();
    const long = { clientWidth:document.documentElement.clientWidth, toolbarTop:document.querySelector('.schedule-toolbar').getBoundingClientRect().top };
    bookings.innerHTML = originalMarkup;
    bookings.style.minHeight = originalMinHeight;
    return { short, long, overflow:document.documentElement.scrollWidth > innerWidth + 2 };
  });
  assert.equal(scrollbarGutter.short.clientWidth, scrollbarGutter.long.clientWidth, `390px short/long list changed viewport width: ${JSON.stringify(scrollbarGutter)}`);
  assert.equal(scrollbarGutter.short.toolbarTop, scrollbarGutter.long.toolbarTop, `390px short/long list shifted schedule controls: ${JSON.stringify(scrollbarGutter)}`);
  assert.equal(scrollbarGutter.overflow, false, `390px gutter created horizontal overflow: ${JSON.stringify(scrollbarGutter)}`);
  const dateStripStability = await page.evaluate(() => {
    const strip = document.querySelector('#dateStrip');
    const frame = document.querySelector('.date-strip-frame');
    strip.hidden = false;
    const visible = frame.getBoundingClientRect();
    strip.hidden = true;
    const hidden = frame.getBoundingClientRect();
    strip.hidden = false;
    const restored = frame.getBoundingClientRect();
    return { visible:{ top:visible.top, height:visible.height }, hidden:{ top:hidden.top, height:hidden.height }, restored:{ top:restored.top, height:restored.height } };
  });
  assert.deepEqual(dateStripStability.restored, dateStripStability.visible, `390px restored date strip changed geometry: ${JSON.stringify(dateStripStability)}`);
  assert.ok(dateStripStability.hidden.height === 0 || dateStripStability.hidden.height === dateStripStability.visible.height, `390px hidden date strip left partial geometry: ${JSON.stringify(dateStripStability)}`);

  await page.evaluate(() => {
    document.querySelectorAll('[data-calendar-view]').forEach(button => {
      button.classList.toggle('active', button.dataset.calendarView === 'week');
    });
    document.querySelector('#selectedDateTitle').textContent = '31 августа — 6 сентября 2026 г.';
    document.querySelector('#selectedDateSummary').textContent = '2 записи · 3 перерыва';
    const bookings = document.querySelector('#providerBookings');
    bookings.className = 'provider-bookings calendar-overview calendar-overview-week';
    bookings.innerHTML = '<div class="calendar-overview-grid"><article class="calendar-overview-day"><button class="calendar-overview-date" type="button"><span>Пн</span><strong>31</strong><small>авг</small></button><div class="calendar-overview-items"><button class="calendar-overview-booking" type="button"><time>10:00</time><span><strong>Перерыв</strong><small>Занятое время</small></span></button></div></article></div>';
  });
  for (const { width, height } of [{ width:320, height:700 }, { width:360, height:800 }, { width:390, height:844 }, { width:760, height:1000 }]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(80);
    const weekResult = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect();
      const nav = rect('.date-navigation');
      const tabs = rect('.calendar-view-toggle');
      const toolbar = rect('.schedule-toolbar');
      const titleElement = document.querySelector('#selectedDateTitle');
      const title = titleElement.getBoundingClientRect();
      const day = rect('.calendar-overview-week .calendar-overview-day');
      const date = rect('.calendar-overview-week .calendar-overview-date');
      const booking = rect('.calendar-overview-week .calendar-overview-booking');
      const time = rect('.calendar-overview-week .calendar-overview-booking time');
      return {
        overflow:document.documentElement.scrollWidth > innerWidth + 2,
        navArrowDisplays:[...document.querySelectorAll('.date-navigation>.date-nav-button')].map(button => getComputedStyle(button).display),
        tabsRightDelta:Math.abs(nav.right - tabs.right),
        titleInset:title.left - toolbar.left,
        titleFits:titleElement.scrollWidth <= titleElement.clientWidth + 1 && titleElement.scrollHeight <= titleElement.clientHeight + 1,
        titleBox:{ clientWidth:titleElement.clientWidth, scrollWidth:titleElement.scrollWidth, clientHeight:titleElement.clientHeight, scrollHeight:titleElement.scrollHeight, whiteSpace:getComputedStyle(titleElement).whiteSpace },
        dateInset:date.left - day.left,
        timeInset:time.left - booking.left
      };
    });
    assert.equal(weekResult.overflow, false, `${width}px week view has horizontal overflow: ${JSON.stringify(weekResult)}`);
    assert.ok(weekResult.navArrowDisplays.every(display => display === 'none'), `${width}px week view duplicates navigation arrows: ${JSON.stringify(weekResult)}`);
    assert.ok(weekResult.tabsRightDelta <= 2, `${width}px week tabs do not span the navigation row: ${JSON.stringify(weekResult)}`);
    assert.ok(weekResult.titleInset >= 8, `${width}px week range title touches the outer edge: ${JSON.stringify(weekResult)}`);
    assert.equal(weekResult.titleFits, true, `${width}px week range title is clipped: ${JSON.stringify(weekResult)}`);
    assert.ok(weekResult.dateInset >= 11, `${width}px week day title touches its card edge: ${JSON.stringify(weekResult)}`);
    assert.ok(weekResult.timeInset >= 11, `${width}px week booking time touches its card edge: ${JSON.stringify(weekResult)}`);
    if (output) await page.screenshot({ path:path.join(output, `schedule-week-${width}.png`), fullPage:false });
  }

  await page.evaluate(() => {
    document.querySelectorAll('[data-calendar-view]').forEach(button => {
      button.classList.toggle('active', button.dataset.calendarView === 'month');
    });
    document.querySelector('#selectedDateTitle').textContent = 'Сентябрь 2026 г.';
    document.querySelector('#selectedDateSummary').textContent = '5 записей · 3 перерыва';
    document.querySelector('.journal-mode-toggle').hidden = true;
    document.querySelector('.booking-filters').hidden = true;
    const bookings = document.querySelector('#providerBookings');
    bookings.className = 'provider-bookings calendar-overview calendar-overview-month';
    const monthDays = Array.from({ length:35 }, (_, index) => `<article class="calendar-overview-day ${index === 0 ? 'is-selected' : ''}"><button class="calendar-overview-date" type="button"><strong>${index + 1}</strong><small class="calendar-overview-count">${index % 3 ? 'Свободно' : '2 записи'}</small></button></article>`).join('');
    bookings.innerHTML = `<div class="calendar-overview-weekdays"><span>Пн</span><span>Вт</span><span>Ср</span><span>Чт</span><span>Пт</span><span>Сб</span><span>Вс</span></div><div class="calendar-overview-grid">${monthDays}</div><div class="calendar-month-mobile-agenda"><section class="calendar-month-agenda-day"><button class="calendar-month-agenda-date" type="button">вторник, 1 сентября</button><div><button class="calendar-overview-booking" type="button"><time>10:30</time><span class="calendar-overview-booking-copy"><strong>Очень длинное название услуги для проверки безопасной ширины</strong><span class="calendar-overview-booking-details"><span class="calendar-overview-client-row"><b>Евгения Белышева с длинным именем</b><span class="client-badges with-labels"><span class="client-badge badge-vip"><span>VIP</span></span></span></span><small class="calendar-overview-phone">79120000000</small><small class="calendar-overview-visit">Постоянный · 12-й визит</small></span></span></button></div></section></div>`;
  });
  for (const { width, height } of [{ width:320, height:700 }, { width:360, height:800 }, { width:390, height:844 }, { width:760, height:1000 }]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(80);
    const monthResult = await page.evaluate(() => {
      const nav = document.querySelector('.date-navigation').getBoundingClientRect();
      const tabs = document.querySelector('.calendar-view-toggle').getBoundingClientRect();
      const card = document.querySelector('.calendar-month-mobile-agenda .calendar-overview-booking');
      const cardRect = card.getBoundingClientRect();
      const time = card.querySelector('time').getBoundingClientRect();
      const badge = card.querySelector('.badge-vip').getBoundingClientRect();
      const copy = card.querySelector('.calendar-overview-booking-copy');
      const copyRect = copy.getBoundingClientRect();
      const toolbarTitle = document.querySelector('.schedule-toolbar>div:first-child').getBoundingClientRect();
      const monthGrid = document.querySelector('.calendar-overview-month .calendar-overview-grid').getBoundingClientRect();
      const monthStyle = getComputedStyle(document.querySelector('#providerBookings'));
      return {
        overflow:document.documentElement.scrollWidth > innerWidth + 2,
        navArrowDisplays:[...document.querySelectorAll('.date-navigation>.date-nav-button')].map(button => getComputedStyle(button).display),
        stripArrowDisplays:[...document.querySelectorAll('.date-strip-shift')].map(button => getComputedStyle(button).display),
        tabsRightDelta:Math.abs(nav.right - tabs.right),
        toggleDisplay:getComputedStyle(document.querySelector('.journal-mode-toggle')).display,
        agendaInset:time.left - cardRect.left,
        agendaRightInset:cardRect.right - badge.right,
        vipCenterDelta:Math.abs((badge.top + badge.bottom) / 2 - (cardRect.top + cardRect.bottom) / 2),
        vipReserve:parseFloat(getComputedStyle(copy).paddingRight),
        copyFits:copy.scrollWidth <= copy.clientWidth + 1 && copyRect.right <= cardRect.right + 1,
        titleInset:toolbarTitle.left - monthGrid.left,
        monthPaddingBottom:parseFloat(monthStyle.paddingBottom)
      };
    });
    assert.equal(monthResult.overflow, false, `${width}px month view has horizontal overflow: ${JSON.stringify(monthResult)}`);
    assert.ok(monthResult.navArrowDisplays.every(display => display === 'none'), `${width}px month view duplicates navigation arrows: ${JSON.stringify(monthResult)}`);
    assert.ok(monthResult.stripArrowDisplays.every(display => display !== 'none'), `${width}px month view loses the date-strip arrows: ${JSON.stringify(monthResult)}`);
    assert.ok(monthResult.tabsRightDelta <= 2, `${width}px month tabs do not span the navigation row: ${JSON.stringify(monthResult)}`);
    assert.equal(monthResult.toggleDisplay, 'none', `${width}px month view exposes the day-only journal toggle`);
    assert.ok(monthResult.agendaInset >= 9, `${width}px month agenda text touches the card edge: ${JSON.stringify(monthResult)}`);
    assert.ok(monthResult.agendaRightInset >= 9, `${width}px VIP badge touches the card edge: ${JSON.stringify(monthResult)}`);
    assert.ok(monthResult.vipCenterDelta <= 1, `${width}px VIP badge is not vertically centered: ${JSON.stringify(monthResult)}`);
    assert.ok(monthResult.vipReserve >= 50 && monthResult.vipReserve <= 56, `${width}px VIP safe reserve changed: ${JSON.stringify(monthResult)}`);
    assert.equal(monthResult.copyFits, true, `${width}px long agenda copy overflows: ${JSON.stringify(monthResult)}`);
    assert.ok(monthResult.titleInset >= 8 && monthResult.titleInset <= 16, `${width}px month heading lacks the journal card inset: ${JSON.stringify(monthResult)}`);
    assert.ok(monthResult.monthPaddingBottom >= 24, `${width}px month content lacks fixed-navigation clearance: ${JSON.stringify(monthResult)}`);
    if (width >= 360 && width <= 760) {
      const reachableLastWeek = await page.evaluate(async () => {
        document.documentElement.style.scrollBehavior = 'auto';
        window.scrollTo(0, document.documentElement.scrollHeight);
        document.scrollingElement.scrollTop = document.scrollingElement.scrollHeight;
        const scrollers = [document.scrollingElement, ...document.querySelectorAll('*')].filter((node, index, items) => node
          && items.indexOf(node) === index
          && node.scrollHeight > node.clientHeight + 1
          && ['auto','scroll'].includes(getComputedStyle(node).overflowY));
        scrollers.forEach(node => { node.scrollTop = node.scrollHeight; });
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const days = [...document.querySelectorAll('.calendar-overview-month .calendar-overview-grid>.calendar-overview-day')];
        const last = days.at(-1).getBoundingClientRect();
        const nav = document.querySelector('.provider-mobile-nav').getBoundingClientRect();
        return {
          gap:nav.top - last.bottom,
          scrollY,
          maxScroll:document.documentElement.scrollHeight - innerHeight,
          rootScrollTop:document.scrollingElement.scrollTop,
          rootOverflow:getComputedStyle(document.documentElement).overflowY,
          bodyOverflow:getComputedStyle(document.body).overflowY,
          scrollers:scrollers.map(node => `${node.tagName}.${node.className}:${node.scrollTop}`)
        };
      });
      assert.ok(reachableLastWeek.gap >= -1, `${width}px final month week remains under fixed navigation: ${JSON.stringify(reachableLastWeek)}`);
    }
    if (output) await page.screenshot({ path:path.join(output, `schedule-month-${width}.png`), fullPage:false });
  }

  await page.evaluate(() => {
    document.querySelectorAll('[data-calendar-view]').forEach(button => {
      button.classList.toggle('active', button.dataset.calendarView === 'day');
    });
    document.querySelector('.journal-mode-toggle').hidden = false;
    const bookings = document.querySelector('#providerBookings');
    bookings.className = 'provider-bookings schedule-list';
    bookings.innerHTML = `
      <article class="provider-booking status-confirmed color-auto client-new"><button class="provider-booking-open" type="button" data-open-booking="booking-1"><span class="booking-time-column"><strong>10:30<small>до 11:30</small></strong><span>Вт, 4 авг.</span></span><span class="booking-main"><span class="provider-booking-top"><h3>Массаж спины + ШВЗ — углублённый</h3></span><span class="provider-booking-client-line"><span class="booking-client-name-row"><strong>Сертификат</strong></span><span class="provider-booking-phone">+7 912 000-00-00</span></span><span class="provider-booking-signals"><span class="booking-status">Подтверждена</span><span class="booking-client-visit">Новый · 1-й визит</span><span class="booking-outcome-summary">Наличные · получено 3 000 ₽</span></span></span><span class="provider-booking-chevron">›</span></button></article>
      <article class="provider-booking status-confirmed color-auto client-vip"><button class="provider-booking-open" type="button" data-open-booking="booking-2" aria-label="Очень длинное каноническое название услуги для проверки многоточия, с 12:00 до 13:30. Открыть подробности"><span class="booking-time-column"><strong>12:00<small>до 13:30</small></strong><span>Вт, 4 авг.</span></span><span class="booking-main"><span class="provider-booking-top"><h3>Очень длинное каноническое название услуги для проверки многоточия</h3></span><span class="provider-booking-client-line"><span class="booking-client-name-row"><strong>Евгения Белышева-Александрова</strong><span class="client-badges with-labels"><span class="client-badge badge-vip"><span>VIP</span></span></span></span><span class="provider-booking-phone">+7 950 831-03-38</span></span><span class="provider-booking-signals"><span class="booking-status">Подтверждена</span><span class="booking-client-visit">Постоянный · 12-й визит</span></span></span><span class="provider-booking-chevron">›</span></button></article>
      <article class="provider-booking status-pending color-auto"><button class="provider-booking-open" type="button"><span class="booking-time-column"><strong>15:00<small>до 15:30</small></strong><span>Вт, 4 авг.</span></span><span class="booking-main"><span class="provider-booking-top"><h3>Консультация</h3></span><span class="provider-booking-client-line"><span class="booking-client-name-row"><strong>Анна</strong></span></span><span class="provider-booking-signals"><span class="booking-status">Ожидает</span></span></span><span class="provider-booking-chevron">›</span></button></article>`;
  });
  for (const { width, height } of [{ width:320, height:700 }, { width:360, height:800 }, { width:390, height:844 }, { width:760, height:1000 }, { width:1440, height:1000 }]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(80);
    const cardResult = await page.evaluate(() => {
      const opens = [...document.querySelectorAll('.provider-booking-open')];
      const open = opens[0];
      const openRect = open.getBoundingClientRect();
      const timeRect = open.querySelector('.booking-time-column strong').getBoundingClientRect();
      const rowRect = opens[1].querySelector('.booking-client-name-row').getBoundingClientRect();
      const badgeRect = opens[1].querySelector('.client-badges').getBoundingClientRect();
      const phone = open.querySelector('.provider-booking-phone');
      const cardMetrics = opens.map(button => {
        const card = button.closest('.provider-booking');
        const title = button.querySelector('h3');
        const client = button.querySelector('.booking-client-name-row>strong');
        const clientLine = button.querySelector('.provider-booking-client-line');
        const phoneElement = button.querySelector('.provider-booking-phone');
        const signals = button.querySelector('.provider-booking-signals');
        const titleStyle = getComputedStyle(title);
        const clientStyle = getComputedStyle(client);
        const cardStyle = getComputedStyle(card);
        const titleRange = document.createRange();
        titleRange.selectNodeContents(title);
        const rawTitleLines = new Set([...titleRange.getClientRects()].map(rect => Math.round(rect.top))).size;
        const unclampedTitle = title.cloneNode(true);
        unclampedTitle.style.setProperty('position','absolute','important');
        unclampedTitle.style.setProperty('visibility','hidden','important');
        unclampedTitle.style.setProperty('width',`${title.clientWidth}px`,'important');
        unclampedTitle.style.setProperty('max-height','none','important');
        unclampedTitle.style.setProperty('overflow','visible','important');
        unclampedTitle.style.setProperty('display','block','important');
        unclampedTitle.style.setProperty('-webkit-line-clamp','unset','important');
        title.parentElement.append(unclampedTitle);
        const unclampedTitleLines = unclampedTitle.getBoundingClientRect().height / parseFloat(getComputedStyle(unclampedTitle).lineHeight);
        unclampedTitle.remove();
        return {
          actionHeight:button.getBoundingClientRect().height,
          contained:button.scrollWidth <= button.clientWidth + 1,
          titleLines:title.getBoundingClientRect().height / parseFloat(titleStyle.lineHeight),
          rawTitleLines,
          unclampedTitleLines,
          titleSize:parseFloat(titleStyle.fontSize),
          titleOverflow:titleStyle.textOverflow,
          titleIsTruncated:title.scrollWidth > title.clientWidth + 1,
          titleRightGap:button.querySelector('.provider-booking-chevron').getBoundingClientRect().left - title.getBoundingClientRect().right,
          fullTitlePreserved:title.textContent === 'Очень длинное каноническое название услуги для проверки многоточия' ? button.getAttribute('aria-label')?.startsWith(title.textContent) : true,
          clientSize:parseFloat(clientStyle.fontSize),
          clientWeight:Number(clientStyle.fontWeight),
          clientAfterTitle:clientLine.getBoundingClientRect().top >= title.getBoundingClientRect().bottom - 1,
          phoneSecondary:!phoneElement || parseFloat(getComputedStyle(phoneElement).fontSize) < parseFloat(clientStyle.fontSize),
          signalsAfterClient:signals.getBoundingClientRect().top >= clientLine.getBoundingClientRect().bottom - 1,
          backgroundColor:cardStyle.backgroundColor
        };
      });
      return {
        overflow:document.documentElement.scrollWidth > innerWidth + 2,
        timeInset:timeRect.left - openRect.left,
        vipRightGap:rowRect.right - badgeRect.right,
        phoneVisible:phone.getBoundingClientRect().width > 0,
        phoneFits:phone.scrollWidth <= phone.clientWidth + 1,
        cardMetrics,
        clientNames:opens.map(button => button.querySelector('.booking-client-name-row>strong').textContent.trim()),
        phones:opens.map(button => button.querySelector('.provider-booking-phone')?.textContent.trim() || '')
      };
    });
    assert.equal(cardResult.overflow, false, `${width}px record card has horizontal overflow: ${JSON.stringify(cardResult)}`);
    assert.ok(cardResult.timeInset >= 8, `${width}px record time touches the card edge: ${JSON.stringify(cardResult)}`);
    if (width <= 760) assert.ok(cardResult.vipRightGap <= 1, `${width}px VIP badge is not aligned to the right: ${JSON.stringify(cardResult)}`);
    assert.equal(cardResult.phoneVisible, true, `${width}px record phone is missing`);
    assert.equal(cardResult.phoneFits, true, `${width}px record phone is clipped`);
    assert.ok(cardResult.cardMetrics[0].unclampedTitleLines <= 2.1, `${width}px primary service title loses meaningful text: ${JSON.stringify(cardResult)}`);
    assert.deepEqual(cardResult.clientNames, ['Сертификат','Евгения Белышева-Александрова','Анна'], `${width}px client variants changed`);
    assert.deepEqual(cardResult.phones, ['+7 912 000-00-00','+7 950 831-03-38',''], `${width}px missing-phone variant changed`);
    assert.ok(cardResult.cardMetrics.every(card => card.actionHeight >= 44 && card.contained && card.titleLines <= 1.1 && card.titleSize >= 10.5 && card.clientSize >= 11 && card.clientWeight >= 600 && card.clientAfterTitle && card.phoneSecondary && card.signalsAfterClient && card.backgroundColor !== 'rgba(0, 0, 0, 0)'), `${width}px list-card hierarchy, booking fill, or containment changed: ${JSON.stringify(cardResult)}`);
    assert.equal(cardResult.cardMetrics[0].rawTitleLines, 1, `${width}px exact service title wrapped: ${JSON.stringify(cardResult)}`);
    assert.ok(cardResult.cardMetrics[0].actionHeight <= 112, `${width}px exact service card is no longer compact: ${JSON.stringify(cardResult)}`);
    if (width <= 760) {
      const longTitle = cardResult.cardMetrics[1];
      assert.equal(longTitle.titleOverflow, 'ellipsis', `${width}px long service title uses raw clipping: ${JSON.stringify(longTitle)}`);
      if (width <= 390) assert.equal(longTitle.titleIsTruncated, true, `${width}px long service title fixture no longer exercises ellipsis: ${JSON.stringify(longTitle)}`);
      assert.ok(longTitle.titleRightGap >= 0, `${width}px long service title collides with the chevron: ${JSON.stringify(longTitle)}`);
      assert.equal(longTitle.fullTitlePreserved, true, `${width}px full service title is not preserved for booking details: ${JSON.stringify(longTitle)}`);
    }
    const filtersShareCards = await page.evaluate(() => {
      const holder = document.querySelector('#providerBookings');
      const originalMarkup = holder.innerHTML;
      const variants = ['day','upcoming','all'].map(filter => {
        holder.dataset.recordsFilter = filter;
        const cards = [...holder.querySelectorAll('.provider-booking-open')];
        const first = cards[0];
        const article = first.closest('.provider-booking');
        return {
          filter,
          heights:cards.map(card => card.getBoundingClientRect().height),
          radius:getComputedStyle(article).borderRadius,
          fill:getComputedStyle(article).backgroundColor,
          title:first.querySelector('h3').textContent,
          titles:cards.map(card => card.querySelector('h3').textContent),
          durationVisible:/60\s*мин/.test(first.textContent)
        };
      });
      const emptyVariants = ['day','upcoming','all'].map(filter => {
        holder.dataset.recordsFilter = filter;
        holder.innerHTML = '<div class="provider-empty schedule-empty"><strong>Записей нет</strong><small>На выбранный период всё свободно.</small></div>';
        const empty = holder.firstElementChild;
        return { filter, contained:empty.scrollWidth <= empty.clientWidth + 1, height:empty.getBoundingClientRect().height };
      });
      holder.innerHTML = originalMarkup;
      holder.dataset.recordsFilter = 'day';
      return { variants, emptyVariants };
    });
    const firstHeights = filtersShareCards.variants.map(variant => variant.heights[0]);
    assert.ok(filtersShareCards.variants.every(variant => variant.radius === '18px' && variant.fill === filtersShareCards.variants[0].fill && !variant.durationVisible && variant.title === filtersShareCards.variants[0].title), `${width}px Day, Upcoming and All diverged in their common card: ${JSON.stringify(filtersShareCards)}`);
    assert.equal(new Set(filtersShareCards.variants.map(variant => JSON.stringify(variant.titles))).size, 1, `${width}px same bookings use different titles across Day, Upcoming and All: ${JSON.stringify(filtersShareCards.variants)}`);
    assert.ok(Math.max(...firstHeights) - Math.min(...firstHeights) <= 1, `${width}px filter switch changes card height: ${JSON.stringify(filtersShareCards)}`);
    assert.ok(filtersShareCards.emptyVariants.every(variant => variant.contained && variant.height > 0), `${width}px filter empty state overflows or vanishes: ${JSON.stringify(filtersShareCards)}`);
    if ([390,760,1440].includes(width)) {
      await page.mouse.move(0, 0);
      const themeFilterMatrix = await page.evaluate(async ({ themes, filters }) => {
        const body = document.body;
        const holder = document.querySelector('#providerBookings');
        const results = [];
        for (const theme of themes) {
          body.dataset.providerTheme = theme;
          await new Promise(resolve => setTimeout(resolve, 220));
          for (const filter of filters) {
            holder.dataset.recordsFilter = filter;
            const card = holder.querySelector('.provider-booking');
            const action = card.querySelector('.provider-booking-open');
            const title = card.querySelector('h3');
            const titleStyle = getComputedStyle(title);
            const titleRange = document.createRange();
            titleRange.selectNodeContents(title);
            const lines = new Set([...titleRange.getClientRects()].map(rect => Math.round(rect.top))).size;
            const payment = card.querySelector('.booking-outcome-summary');
            const cardStyle = getComputedStyle(card);
            const probe = document.createElement('i');
            probe.style.background = 'color-mix(in srgb,var(--theme-accent) var(--schedule-entry-fill-weight),var(--theme-surface))';
            card.append(probe);
            const expectedFill = getComputedStyle(probe).backgroundColor;
            probe.remove();
            results.push({
              theme,
              filter,
              height:action.getBoundingClientRect().height,
              title:title.textContent.trim(),
              titleLines:lines,
              titleFits:title.scrollWidth <= title.clientWidth + 1,
              paymentVisible:Boolean(payment && payment.getBoundingClientRect().width && payment.getBoundingClientRect().height),
              contained:action.scrollWidth <= action.clientWidth + 1,
              fill:cardStyle.backgroundColor,
              expectedFill,
              border:cardStyle.borderColor
            });
          }
        }
        return results;
      }, { themes:themeKeys, filters:['day','upcoming','all'] });
      assert.equal(themeFilterMatrix.length, themeKeys.length * 3, `${width}px theme/filter matrix is incomplete`);
      assert.ok(themeFilterMatrix.every(row => row.title === 'Массаж спины + ШВЗ — углублённый' && row.titleLines === 1 && row.titleFits && row.paymentVisible && row.contained && row.fill === row.expectedFill && row.fill !== 'rgba(0, 0, 0, 0)' && row.border !== 'rgba(0, 0, 0, 0)'), `${width}px one-line title, metadata, containment or themed surface failed: ${JSON.stringify(themeFilterMatrix.filter(row => !(row.titleLines === 1 && row.titleFits && row.paymentVisible && row.contained && row.fill === row.expectedFill)).slice(0,5))}`);
      for (const theme of themeKeys) {
        const rows = themeFilterMatrix.filter(row => row.theme === theme);
        assert.equal(new Set(rows.map(row => Math.round(row.height * 10) / 10)).size, 1, `${width}px/${theme}: Day, Upcoming and All use different card geometry`);
      }
      if (output && width === 390) {
        await page.evaluate(() => {
          document.body.dataset.providerTheme = 'sage';
          document.querySelector('#providerBookings').dataset.recordsFilter = 'day';
        });
        await page.screenshot({ path:path.join(output, 'schedule-list-card-sage-day-390.png'), fullPage:false });
        await page.evaluate(() => {
          document.body.dataset.providerTheme = 'warm';
          document.querySelector('#providerBookings').dataset.recordsFilter = 'all';
        });
        await page.screenshot({ path:path.join(output, 'schedule-list-card-warm-all-390.png'), fullPage:false });
      }
      await page.evaluate(() => { document.body.dataset.providerTheme = 'sage'; });
    }
    await page.evaluate(() => { document.body.dataset.providerTextScale = 'large'; });
    const largeScaleFits = await page.evaluate(() => [...document.querySelectorAll('.provider-booking-open')].every(button => button.scrollWidth <= button.clientWidth + 1 && button.getBoundingClientRect().height >= 44));
    assert.equal(largeScaleFits, true, `${width}px large-text list cards overflow`);
    await page.evaluate(() => { document.body.dataset.providerTextScale = 'default'; });
    if (output) await page.screenshot({ path:path.join(output, `schedule-list-card-${width}.png`), fullPage:false });
  }

  await page.evaluate(() => {
    document.querySelectorAll('[data-journal-mode]').forEach(button => {
      const active = button.dataset.journalMode === 'timeline';
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  });

  await page.evaluate(() => { document.querySelector('.provider-topbar-tools').open = true; });
  const share = await page.locator('#openFreeSlots').boundingBox();
  assert.ok(share && share.height >= 44, 'Share remains available inside More');
  assert.equal(await page.locator('.schedule-view-title #openFreeSlots').count(), 0, 'Share must not return beside New booking');
  assert.equal(await page.getByRole('button', { name:'Новая запись' }).count(), 1, 'New booking needs its stable accessible name');
  assert.equal(await page.getByRole('button', { name:'Временная лента' }).getAttribute('title'), 'Лента');
  assert.equal(await page.getByRole('button', { name:'Компактный список' }).getAttribute('title'), 'Список');
  assert.equal(await page.getByRole('button', { name:'Временная лента' }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getByRole('button', { name:'Компактный список' }).getAttribute('aria-pressed'), 'false');
  for (const width of [360, 390, 760, 1440]) {
    await page.setViewportSize({ width, height:844 });
    const clientShareMenu = await page.evaluate(() => {
      const button = document.querySelector('#shareProviderClientPage');
      const details = button.closest('details');
      button.hidden = false;
      details.open = true;
      const menu = details.querySelector(':scope>div').getBoundingClientRect();
      const rect = button.getBoundingClientRect();
      const pseudo = getComputedStyle(button, '::after');
      return {
        label:button.dataset.compactLabel,
        pseudo:pseudo.content,
        height:rect.height,
        leftGap:rect.left - menu.left,
        rightGap:menu.right - rect.right,
        overflow:document.documentElement.scrollWidth > innerWidth + 2
      };
    });
    assert.equal(clientShareMenu.label, 'Ссылка для записи');
    assert.equal(clientShareMenu.pseudo, '"Ссылка для записи"');
    assert.ok(clientShareMenu.height >= 44, `${width}px client-page share target is too small`);
    assert.ok(clientShareMenu.leftGap >= 0 && clientShareMenu.rightGap >= 0, `${width}px client-page share leaves the More menu`);
    assert.equal(clientShareMenu.overflow, false, `${width}px client-page share adds horizontal overflow`);
  }
  await page.addScriptTag({ content:`window.$=selector=>document.querySelector(selector);window.shareNotices=[];window.notify=message=>shareNotices.push(message);${shareHelper}` });
  const shareResult = await page.evaluate(async () => {
    const button = document.querySelector('#shareProviderClientPage');
    button.hidden = false;
    button.dataset.clientPageUrl = 'https://example.test/public-master';
    const native=[];
    Object.defineProperty(navigator, 'share', { configurable:true, value:async payload => native.push(payload) });
    const nativeOk = await shareProviderClientPage();
    Object.defineProperty(navigator, 'share', { configurable:true, value:undefined });
    const copied=[];
    Object.defineProperty(navigator, 'clipboard', { configurable:true, value:{ writeText:async value => copied.push(value) } });
    const fallbackOk = await shareProviderClientPage();
    return { nativeOk, fallbackOk, native, copied, notices:shareNotices };
  });
  assert.equal(shareResult.nativeOk, true, 'Native client-page share failed');
  assert.equal(shareResult.fallbackOk, true, 'Client-page copy fallback failed');
  assert.equal(shareResult.native[0].url, 'https://example.test/public-master');
  assert.deepEqual(shareResult.copied, ['https://example.test/public-master']);
  assert.ok(shareResult.notices.includes('Ссылка на страницу клиента скопирована'));
  console.log('PrimeTime Pro compact schedule v865 browser checks: PASS');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
