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
    document.querySelector('#todayBookingsCount').textContent = '0';
    document.querySelector('#newBookingsCount').textContent = '5';
    document.querySelector('#activeServicesCount').textContent = '8';
    document.querySelector('.booking-filters').hidden = true;
    const bookings = document.querySelector('#providerBookings');
    bookings.className = 'provider-bookings timeline-view';
    bookings.innerHTML = '<div class="day-timeline" style="height:620px"><div class="timeline-stage"></div></div>';
    const activeDate = strip.querySelector('.active');
    const stripRect = strip.getBoundingClientRect();
    const activeRect = activeDate.getBoundingClientRect();
    strip.scrollLeft = Math.max(0, activeRect.left - stripRect.left + strip.scrollLeft - (strip.clientWidth - activeRect.width) / 2);
  });

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
      const activeDateMarker = getComputedStyle(activeButton, '::after');
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
      const summaryLabelsInside = [...summary.querySelectorAll('strong,span')].every(label => {
        const item = label.getBoundingClientRect();
        return item.left >= summaryRect.left + 3 && item.right <= summaryRect.right - 3
          && label.scrollWidth <= label.clientWidth + 1;
      });
      const summaryItemCenterDeltas = [...summary.querySelectorAll(':scope>div')].map(item => {
        const itemRect = item.getBoundingClientRect();
        const labels = [...item.querySelectorAll('strong,span')].map(label => label.getBoundingClientRect());
        const contentLeft = Math.min(...labels.map(label => label.left));
        const contentRight = Math.max(...labels.map(label => label.right));
        return Math.abs((contentLeft + contentRight) / 2 - (itemRect.left + itemRect.right) / 2);
      });
      const newBookingButton = document.querySelector('#newBookingButton');
      const newBookingRect = newBookingButton.getBoundingClientRect();
      const newBookingHitTarget = document.elementFromPoint(
        (newBookingRect.left + newBookingRect.right) / 2,
        (newBookingRect.top + newBookingRect.bottom) / 2
      );
      const toolbar = rect('.schedule-toolbar');
      const toolbarCopy = rect('.schedule-toolbar>div:first-child');
      const journalToggle = rect('.journal-mode-toggle');
      return {
        overflow:document.documentElement.scrollWidth > innerWidth + 2,
        clientWidth:document.documentElement.clientWidth,
        scheduleTop:rect('#providerBookings').top,
        timelineTop:rect('.day-timeline').top,
        topbar:rect('.provider-topbar'),
        title:rect('.schedule-view-title'),
        navigation:rect('.date-navigation'),
        strip:stripFrame,
        stripViewport:strip,
        toolbar,
        toolbarCopy,
        journalToggle,
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
        activeDateMarkerContent:activeDateMarker.content,
        activeDateMarkerDisplay:activeDateMarker.display,
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
        summaryLabelsInside,
        summaryItemCenterDeltas,
        summaryText:[...summary.querySelectorAll('strong,span')].map(item => item.textContent.trim()),
        newBookingHitTarget:newBookingHitTarget === newBookingButton || newBookingButton.contains(newBookingHitTarget),
        toolbarContentCenterDelta:Math.abs((toolbarCopy.top + toolbarCopy.bottom) / 2 - (journalToggle.top + journalToggle.bottom) / 2),
        journalGridGap:rect('#providerBookings').top - journalToggle.bottom,
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
      assert.equal(result.newBookingHitTarget, true, `${width}px New booking button is covered by another layer: ${JSON.stringify(result)}`);
      assert.ok(result.picker.height >= 44, `${width}px date picker target`);
      assert.ok(result.previous.height >= 44 && result.next.height >= 44, `${width}px date strip arrows`);
      assert.equal(result.fullyVisibleDates, 5, `${width}px must expose five dates between arrows: ${JSON.stringify(result)}`);
      assert.equal(result.intersectingDates, 5, `${width}px must not expose cropped edge dates: ${JSON.stringify(result)}`);
      assert.ok(Math.abs(result.previous.right - result.stripViewport.left) <= 1, `${width}px previous arrow needs its own safe zone: ${JSON.stringify(result)}`);
      assert.ok(Math.abs(result.next.left - result.stripViewport.right) <= 1, `${width}px next arrow needs its own safe zone: ${JSON.stringify(result)}`);
      assert.equal(result.activeDateVisible, true, `${width}px selected date must remain visible: ${JSON.stringify(result)}`);
      assert.equal(result.activeDateValue, '2026-09-15', `${width}px fixture selected date changed`);
      assert.notEqual(result.activeDateBackground, 'rgba(0, 0, 0, 0)', `${width}px selected date lost its accent`);
      assert.ok(result.activeDateMarkerContent === 'none' || result.activeDateMarkerDisplay === 'none', `${width}px selected date regained a second lower marker: ${JSON.stringify(result)}`);
      assert.ok(result.scheduleTop >= 330 && result.scheduleTop <= 430, `${width}px schedule begins: ${JSON.stringify(result)}`);
      assert.ok(result.toolbarContentCenterDelta <= 2, `${width}px day heading and journal toggle are not aligned: ${JSON.stringify(result)}`);
      assert.ok(result.journalGridGap >= 8, `${width}px timeline grid touches the journal toggle: ${JSON.stringify(result)}`);
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
        assert.equal(result.summaryLabelsInside, true, `${width}px title summary labels touch or escape the safe inset: ${JSON.stringify(result)}`);
        assert.ok(result.summaryItemCenterDeltas.every(delta => delta <= 1), `${width}px title summary items are not centered in their thirds: ${JSON.stringify(result)}`);
        assert.deepEqual(result.summaryText, ['0', 'сегодня', '5', 'впереди', '8', 'услуг'], `${width}px title summary fixture changed`);
        assert.ok(result.summary.top >= result.newBooking.bottom - 1, `${width}px title summary must use its own full-width row: ${JSON.stringify(result)}`);
        assert.ok(result.summary.right <= result.title.right + 1, `${width}px title summary escapes the title area: ${JSON.stringify(result)}`);
      }
      timelineGridTops.set(width, result.timelineTop);
      timelineToolbarTops.set(width, result.toolbar.top);
      timelineCopyTops.set(width, result.toolbarCopy.top);
      timelineToggleTops.set(width, result.journalToggle.top);
      timelineClientWidths.set(width, result.clientWidth);
    }
    if (output) await page.screenshot({ path:path.join(output, `schedule-compact-${width}.png`), fullPage:false });
  }

  await page.evaluate(() => {
    const filters = document.querySelector('.booking-filters');
    filters.hidden = false;
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
      return {
        overflow:document.documentElement.scrollWidth > innerWidth + 2,
        clientWidth:document.documentElement.clientWidth,
        toolbar, copy, toggle, filters, bookings, nav,
        firstRowFits:copy.right <= toggle.left - 6,
        controlsToFiltersGap:filters.top - Math.max(copy.bottom, toggle.bottom),
        filterOuterBorder:getComputedStyle(document.querySelector('.booking-filters')).borderTopWidth,
        workspacePaddingBottom:parseFloat(getComputedStyle(workspace).paddingBottom),
        navLabelsFit:navLabels.every(label => label.scrollWidth <= label.clientWidth + 1),
        filterButtons:[...document.querySelectorAll('.booking-filters button')].map(button => ({
          height:button.getBoundingClientRect().height,
          scrollWidth:button.scrollWidth,
          clientWidth:button.clientWidth
        }))
      };
    });
    assert.equal(listResult.overflow, false, `${width}px list has horizontal overflow: ${JSON.stringify(listResult)}`);
    assert.ok(listResult.toolbar.height >= 96 && listResult.toolbar.height <= 124, `${width}px list toolbar is not compact: ${JSON.stringify(listResult)}`);
    assert.equal(listResult.firstRowFits, true, `${width}px list heading overlaps the mode toggle: ${JSON.stringify(listResult)}`);
    assert.ok(listResult.controlsToFiltersGap >= 10, `${width}px list filters crowd the journal toggle: ${JSON.stringify(listResult)}`);
    assert.equal(listResult.filterOuterBorder, '0px', `${width}px duplicate filter frame returned`);
    assert.ok(listResult.filters.top >= listResult.toolbar.top && listResult.filters.bottom <= listResult.toolbar.bottom + 1, `${width}px tabs escape toolbar: ${JSON.stringify(listResult)}`);
    assert.ok(listResult.bookings.top >= listResult.toolbar.bottom - 1, `${width}px list content is covered by controls: ${JSON.stringify(listResult)}`);
    const timelineInsetFromFilters = timelineGridTops.get(width) - listResult.filters.top;
    assert.ok(timelineInsetFromFilters >= 8 && timelineInsetFromFilters <= 24, `${width}px timeline grid does not begin near list content: ${JSON.stringify({ timelineGridTop:timelineGridTops.get(width), filtersTop:listResult.filters.top, timelineInsetFromFilters })}`);
    assert.ok(Math.abs(listResult.toolbar.top - timelineToolbarTops.get(width)) <= 1, `${width}px timeline/list toolbar top jumps: ${JSON.stringify(listResult)}`);
    assert.ok(Math.abs(listResult.copy.top - timelineCopyTops.get(width)) <= 1, `${width}px timeline/list day heading jumps: ${JSON.stringify(listResult)}`);
    assert.ok(Math.abs(listResult.toggle.top - timelineToggleTops.get(width)) <= 1, `${width}px timeline/list mode toggle jumps: ${JSON.stringify(listResult)}`);
    assert.equal(listResult.clientWidth, timelineClientWidths.get(width), `${width}px scrollbar changes the schedule width`);
    assert.ok(listResult.filterButtons.every(button => button.height >= 44 && button.scrollWidth <= button.clientWidth + 1), `${width}px list tabs are clipped: ${JSON.stringify(listResult)}`);
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
    return { visible:{ top:visible.top, height:visible.height }, hidden:{ top:hidden.top, height:hidden.height } };
  });
  assert.equal(dateStripStability.visible.top, dateStripStability.hidden.top, `390px filter state shifted the date strip: ${JSON.stringify(dateStripStability)}`);
  assert.equal(dateStripStability.visible.height, dateStripStability.hidden.height, `390px filter state changed the date strip height: ${JSON.stringify(dateStripStability)}`);

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
  for (const { width, height } of [{ width:320, height:700 }, { width:390, height:844 }, { width:760, height:1000 }]) {
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
    assert.ok(weekResult.tabsRightDelta <= 1, `${width}px week tabs do not span the navigation row: ${JSON.stringify(weekResult)}`);
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
    bookings.innerHTML = '<div class="calendar-overview-weekdays"><span>Пн</span><span>Вт</span><span>Ср</span><span>Чт</span><span>Пт</span><span>Сб</span><span>Вс</span></div><div class="calendar-overview-grid"><article class="calendar-overview-day is-selected"><button class="calendar-overview-date" type="button"><strong>1</strong><small class="calendar-overview-count">2 записи</small></button></article></div><div class="calendar-month-mobile-agenda"><section class="calendar-month-agenda-day"><button class="calendar-month-agenda-date" type="button">вторник, 1 сентября</button><div><button class="calendar-overview-booking" type="button"><time>10:30</time><span class="calendar-overview-booking-copy"><strong>Очень длинное название услуги для проверки безопасной ширины</strong><span class="calendar-overview-booking-details"><span class="calendar-overview-client-row"><b>Евгения Белышева с длинным именем</b><span class="client-badges with-labels"><span class="client-badge badge-vip"><span>VIP</span></span></span></span><small class="calendar-overview-phone">79120000000</small><small class="calendar-overview-visit">Постоянный · 12-й визит</small></span></span></button></div></section></div>';
  });
  for (const { width, height } of [{ width:320, height:700 }, { width:390, height:844 }, { width:760, height:1000 }]) {
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
        copyFits:copy.scrollWidth <= copy.clientWidth + 1 && copyRect.right <= cardRect.right + 1
      };
    });
    assert.equal(monthResult.overflow, false, `${width}px month view has horizontal overflow: ${JSON.stringify(monthResult)}`);
    assert.ok(monthResult.navArrowDisplays.every(display => display === 'none'), `${width}px month view duplicates navigation arrows: ${JSON.stringify(monthResult)}`);
    assert.ok(monthResult.stripArrowDisplays.every(display => display !== 'none'), `${width}px month view loses the date-strip arrows: ${JSON.stringify(monthResult)}`);
    assert.ok(monthResult.tabsRightDelta <= 1, `${width}px month tabs do not span the navigation row: ${JSON.stringify(monthResult)}`);
    assert.equal(monthResult.toggleDisplay, 'none', `${width}px month view exposes the day-only journal toggle`);
    assert.ok(monthResult.agendaInset >= 9, `${width}px month agenda text touches the card edge: ${JSON.stringify(monthResult)}`);
    assert.ok(monthResult.agendaRightInset >= 9, `${width}px VIP badge touches the card edge: ${JSON.stringify(monthResult)}`);
    assert.ok(monthResult.vipCenterDelta <= 1, `${width}px VIP badge is not vertically centered: ${JSON.stringify(monthResult)}`);
    assert.ok(monthResult.vipReserve >= 50 && monthResult.vipReserve <= 56, `${width}px VIP safe reserve changed: ${JSON.stringify(monthResult)}`);
    assert.equal(monthResult.copyFits, true, `${width}px long agenda copy overflows: ${JSON.stringify(monthResult)}`);
    if (output) await page.screenshot({ path:path.join(output, `schedule-month-${width}.png`), fullPage:false });
  }

  await page.evaluate(() => {
    document.querySelectorAll('[data-calendar-view]').forEach(button => {
      button.classList.toggle('active', button.dataset.calendarView === 'day');
    });
    document.querySelector('.journal-mode-toggle').hidden = false;
    const bookings = document.querySelector('#providerBookings');
    bookings.className = 'provider-bookings schedule-list';
    bookings.innerHTML = '<article class="provider-booking status-confirmed color-auto client-vip"><button class="provider-booking-open" type="button"><span class="booking-time-column"><strong>10:30<small>до 11:30</small></strong><span>Вт, 4 авг.</span></span><span class="booking-main"><span class="provider-booking-top"><h3>Общий массаж задней поверхности</h3></span><span class="provider-booking-client-line"><span class="booking-client-name-row"><strong>Евгения Белышева</strong><span class="client-badges with-labels"><span class="client-badge badge-vip"><span>VIP</span></span></span></span><span class="provider-booking-phone">79120000000</span></span></span><span class="provider-booking-chevron">›</span></button></article>';
  });
  for (const { width, height } of [{ width:320, height:700 }, { width:390, height:844 }, { width:760, height:1000 }]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(80);
    const cardResult = await page.evaluate(() => {
      const open = document.querySelector('.provider-booking-open');
      const openRect = open.getBoundingClientRect();
      const timeRect = open.querySelector('.booking-time-column strong').getBoundingClientRect();
      const rowRect = open.querySelector('.booking-client-name-row').getBoundingClientRect();
      const badgeRect = open.querySelector('.client-badges').getBoundingClientRect();
      const phone = open.querySelector('.provider-booking-phone');
      return {
        overflow:document.documentElement.scrollWidth > innerWidth + 2,
        timeInset:timeRect.left - openRect.left,
        vipRightGap:rowRect.right - badgeRect.right,
        phoneVisible:phone.getBoundingClientRect().width > 0,
        phoneFits:phone.scrollWidth <= phone.clientWidth + 1
      };
    });
    assert.equal(cardResult.overflow, false, `${width}px record card has horizontal overflow: ${JSON.stringify(cardResult)}`);
    assert.ok(cardResult.timeInset >= 8, `${width}px record time touches the card edge: ${JSON.stringify(cardResult)}`);
    assert.ok(cardResult.vipRightGap <= 1, `${width}px VIP badge is not aligned to the right: ${JSON.stringify(cardResult)}`);
    assert.equal(cardResult.phoneVisible, true, `${width}px record phone is missing`);
    assert.equal(cardResult.phoneFits, true, `${width}px record phone is clipped`);
    if (output) await page.screenshot({ path:path.join(output, `schedule-list-card-${width}.png`), fullPage:false });
  }

  await page.evaluate(() => { document.querySelector('.provider-topbar-tools').open = true; });
  const share = await page.locator('#openFreeSlots').boundingBox();
  assert.ok(share && share.height >= 44, 'Share remains available inside More');
  assert.equal(await page.locator('.schedule-view-title #openFreeSlots').count(), 0, 'Share must not return beside New booking');
  assert.equal(await page.getByRole('button', { name:'Новая запись' }).count(), 1, 'New booking needs its stable accessible name');
  assert.equal(await page.getByRole('button', { name:'Временная лента' }).getAttribute('title'), 'Лента');
  assert.equal(await page.getByRole('button', { name:'Компактный список' }).getAttribute('title'), 'Список');
  assert.equal(await page.getByRole('button', { name:'Временная лента' }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getByRole('button', { name:'Компактный список' }).getAttribute('aria-pressed'), 'false');
  console.log('PrimeTime Pro compact schedule v775 browser checks: PASS');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
