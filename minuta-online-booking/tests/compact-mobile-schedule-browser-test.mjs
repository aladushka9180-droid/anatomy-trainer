import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const root = fileURLToPath(new URL('..', import.meta.url));
const providerSource = readFileSync(resolve(root, 'provider.js'), 'utf8');
const modeStart = providerSource.indexOf('function updateJournalModeButtons()');
const orderStart = providerSource.indexOf('function syncCompactScheduleOrder()');
const orderEnd = providerSource.indexOf('const compactScheduleMedia', orderStart);
const dateDisplayStart = providerSource.indexOf('function syncScheduleDateDisplay()');
const dateDisplayEnd = providerSource.indexOf('function renderDateStrip(', dateDisplayStart);
assert.ok(modeStart >= 0 && orderStart > modeStart && orderEnd > orderStart);
assert.ok(dateDisplayStart >= 0 && dateDisplayEnd > dateDisplayStart);
const { chromium } = process.env.MINUTA_PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href)
  : createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ headless:true, executablePath:process.env.MINUTA_CHROME_PATH });
const output = process.env.MINUTA_SCHEDULE_OUTPUT;
if (output) mkdirSync(output, { recursive:true });

try {
  const context = await browser.newContext({ viewport:{ width:390, height:844 }, deviceScaleFactor:2, locale:'ru-RU', bypassCSP:true });
  await context.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== 'https://schedule.fixture.invalid' || request.method() !== 'GET') return route.abort();
    const file = resolve(root, `.${url.pathname}`);
    if (!file.startsWith(root)) return route.abort();
    try {
      let body = readFileSync(file);
      if (file.endsWith('.html')) body = body.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
      return route.fulfill({ body, contentType:({ '.html':'text/html', '.css':'text/css', '.svg':'image/svg+xml', '.woff2':'font/woff2' })[extname(file)] || 'application/octet-stream' });
    } catch { return route.abort(); }
  });
  const page = await context.newPage();
  await page.goto('https://schedule.fixture.invalid/provider.html');
  await page.evaluate(() => {
    document.documentElement.classList.remove('provider-booting', 'requires-top-level');
    document.querySelector('#providerBoot')?.remove();
    document.querySelector('#authCard').hidden = true;
    const dashboard = document.querySelector('#dashboard');
    dashboard.hidden = false;
    dashboard.dataset.activeView = 'bookings';
    document.body.dataset.providerTheme = 'carbon-crimson';
    document.body.dataset.providerLayout = 'soft';
    document.body.dataset.providerResolvedColorMode = 'dark';
    document.querySelectorAll('.provider-view').forEach(view => { view.hidden = view.dataset.providerPanel !== 'bookings'; });
    document.querySelector('.schedule-menu-journal').hidden = false;
    document.querySelector('#scheduleMobileSummary').hidden = false;
    document.querySelector('.booking-filters').hidden = true;
    document.querySelector('#scheduleDatePicker').value = '2026-09-27';
    document.querySelector('#selectedDateTitle .selected-date-title-mobile').textContent = 'Воскресенье';
    document.querySelector('#mobileTodayBookingsCount').textContent = '12';
    document.querySelector('#mobileTomorrowBookingsCount').textContent = '10';
    document.querySelector('#mobileUpcomingBookingsCount').textContent = '24';
    document.querySelector('#dateStrip').innerHTML = [25, 26, 27, 28, 29].map((day, index) => `<button type="button" data-date-distance="${Math.abs(index - 2)}" class="${day === 27 ? 'active' : ''}"><span>${['Пт','Сб','Вс','Пн','Вт'][index]}</span><strong>${day}</strong><small>сент</small></button>`).join('');
    document.querySelector('#providerBookings').className = 'provider-bookings timeline-view';
    document.querySelector('#providerBookings').innerHTML = '<div class="day-timeline" style="--timeline-height:180px;--half-hour-offset:45px"><div class="timeline-hours"></div><div class="timeline-stage"><i class="timeline-grid-line" style="top:0"></i></div></div>';
  });
  await page.addScriptTag({ content:`
    const $ = selector => document.querySelector(selector);
    const $$ = selector => [...document.querySelectorAll(selector)];
    let teamCalendarController = null, calendarView = 'day', currentFilter = 'day', journalMode = 'timeline';
    ${providerSource.slice(modeStart, orderStart)}
    ${providerSource.slice(orderStart, orderEnd)}
    ${providerSource.slice(dateDisplayStart, dateDisplayEnd)}
    ${providerSource.match(/\$\('#scheduleDatePicker'\)\.addEventListener\('input', syncScheduleDateDisplay\);/)[0]}
    const JOURNAL_MODE_KEY = 'fixture-journal', SCHEDULE_FILTER_KEY = 'fixture-filter', CALENDAR_VIEW_KEY = 'fixture-calendar';
    function updateBookingQueryTools() {}
    function syncScheduleContextHistory() {}
    function renderDateStrip() {}
    function renderBookings() { document.querySelector('#providerBookings').dataset.fixtureView = calendarView + ':' + journalMode; }
    ${providerSource.slice(providerSource.indexOf('function setJournalMode('), providerSource.indexOf('function restoreDefaultScheduleView('))}
    ${providerSource.slice(providerSource.indexOf('function updateCalendarViewControls('), providerSource.indexOf('function selectScheduleDate('))}
    ${providerSource.slice(providerSource.indexOf('const scheduleViewMenu ='), providerSource.indexOf('function parseLocalIsoDate('))}
    document.body.addEventListener('click', event => {
      const journalView = event.target.closest('[data-journal-mode]');
      const calendarViewButton = event.target.closest('[data-calendar-view]');
      ${providerSource.slice(providerSource.indexOf('  if (journalView) setJournalMode('), providerSource.indexOf('  if (calendarOpenDate) {', providerSource.indexOf('  if (journalView) setJournalMode(')))}
    });
    syncScheduleDateDisplay();
    syncCompactScheduleOrder();
    updateCalendarViewControls();
  ` });
  await page.getByLabel('Выбрать дату в календаре').fill('2026-12-31');
  assert.equal(await page.locator('#scheduleDateDisplay').textContent(), '31.12.2026', 'Visible date follows native input edits');
  await page.evaluate(() => { $('#scheduleDatePicker').value = '2026-09-29'; syncScheduleDateDisplay(); });
  assert.equal(await page.locator('#scheduleDateDisplay').textContent(), '29.09.2026', 'Date-strip selection updates the full date');
  await page.locator('#scheduleDatePicker').click();
  assert.equal(await page.locator('#scheduleDatePicker').evaluate(input => input.matches(':open')), true, 'The visible date opens the native calendar');
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.activeElement?.blur());
  const modes = await page.evaluate(() => {
    journalMode = 'list'; updateJournalModeButtons();
    const listSync = [...document.querySelectorAll('[data-journal-mode="list"]')].every(button => button.classList.contains('active') && button.getAttribute('aria-pressed') === 'true');
    calendarView = 'week'; updateJournalModeButtons();
    const hiddenOutsideDay = document.querySelector('.schedule-menu-journal').hidden && document.querySelector('#scheduleMobileSummary').hidden;
    calendarView = 'day'; journalMode = 'timeline'; updateJournalModeButtons();
    return { listSync, hiddenOutsideDay };
  });
  assert.deepEqual(modes, { listSync:true, hiddenOutsideDay:true });

  const menu = page.locator('#scheduleViewMenu');
  const menuSummary = menu.locator('summary');
  for (const period of ['week','month','day']) {
    await menuSummary.click();
    await menu.locator('[data-calendar-view="' + period + '"]').click();
    assert.equal(await menu.getAttribute('open'), null, 'Selection closes the menu');
    assert.equal(await page.locator('#providerBookings').getAttribute('data-fixture-view'), period + ':timeline');
    assert.equal(await page.evaluate(() => localStorage.getItem('fixture-calendar')), period);
    assert.equal(await page.locator('.schedule-menu-journal').getAttribute('hidden') === '', period !== 'day');
    assert.equal(await menuSummary.evaluate(el => el === document.activeElement), true, 'Focus returns to summary');
  }
  for (const mode of ['list','timeline']) {
    await menuSummary.press('Enter');
    await menu.locator('[data-journal-mode="' + mode + '"]').press('Enter');
    assert.equal(await page.locator('#scheduleViewLabel').textContent(), mode === 'list' ? 'День · Список' : 'День · Лента');
    assert.equal(await page.evaluate(() => localStorage.getItem('fixture-journal')), mode);
  }
  await menuSummary.click();
  await page.keyboard.press('Escape');
  assert.equal(await menu.getAttribute('open'), null);
  await menuSummary.click();
  await page.locator('#selectedDateTitle').click();
  assert.equal(await menu.getAttribute('open'), null, 'Click outside closes the menu');

  for (const theme of ['carbon-crimson', 'pink-porcelain', 'sage']) for (const width of [360, 390, 760, 1440]) for (const scale of ['default', 'comfortable', 'large']) {
    await page.setViewportSize({ width, height:844 });
    await page.evaluate(({theme, scale}) => {
      document.body.dataset.providerTheme = theme;
      document.body.dataset.providerTextScale = scale;
      document.body.dataset.providerResolvedColorMode = theme === 'carbon-crimson' ? 'dark' : 'light';
      syncCompactScheduleOrder();
    }, {theme, scale});
    const state = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect();
      const style = selector => getComputedStyle(document.querySelector(selector));
      const today = rect('.date-navigation>.date-today-button');
      const toggle = rect('#scheduleViewMenu');
      const summary = rect('#scheduleMobileSummary');
      const title = rect('#selectedDateTitle');
      return {
        overflow: document.documentElement.scrollWidth > innerWidth + 2,
        today:{ x:today.x, y:today.y, h:today.height },
        rowHeight:rect('.date-navigation').height,
        controlsFont:[style('.date-today-button').fontSize,style('#scheduleViewMenu>summary').fontSize],
        controlsWeight:[style('.date-today-button').fontWeight,style('#scheduleViewMenu>summary').fontWeight],
        hitInsets:[getComputedStyle(document.querySelector('.date-today-button'),'::after').top,getComputedStyle(document.querySelector('#scheduleViewMenu>summary'),'::after').top],
        chevron:{w:rect('#scheduleViewMenu>summary b').width,h:rect('#scheduleViewMenu>summary b').height},
        toggle:{ x:toggle.x, y:toggle.y, h:toggle.height },
        summary:{ x:summary.x, right:summary.right, y:summary.y, h:summary.height },
        title:{ right:title.right, y:title.y },
        topSummary:style('.schedule-view-title .dashboard-summary').display,
        oldToggle:style('.journal-mode-toggle').display,
        monthVisible:rect('#dateStrip button.active small').height > 0,
        hourLine:style('.timeline-grid-line').borderTopStyle,
        halfHourLine:getComputedStyle(document.querySelector('.timeline-grid-line'), '::after').borderTopStyle,
        dateIcon:{ x:rect('.schedule-date-picker>.ui-icon').x, w:rect('.schedule-date-picker>.ui-icon').width },
        dateTextRight:rect('#scheduleDateDisplay').right,
        dateGroupCenter:(rect('#scheduleDateDisplay').left + rect('.schedule-date-picker>.ui-icon').right) / 2,
        dateText:document.querySelector('#scheduleDateDisplay').textContent,
        dateFits:rect('#scheduleDateDisplay').left >= today.right && rect('.schedule-date-picker>.ui-icon').right <= toggle.left,
        dateUnclipped:document.querySelector('#scheduleDateDisplay').scrollWidth <= document.querySelector('#scheduleDateDisplay').clientWidth,
        dateInputOpacity:style('#scheduleDatePicker').opacity,
        dateIconMask:style('.schedule-date-picker>.ui-icon').maskImage,
        controlsCenter:(today.right + toggle.left) / 2,
        dateOpacity:[...document.querySelectorAll('#dateStrip button')].map(button => getComputedStyle(button).opacity),
        headingCenter:rect('.schedule-view-title h2').y + rect('.schedule-view-title h2').height / 2,
        actionsCenter:rect('.provider-topbar-actions').y + rect('.provider-topbar-actions').height / 2,
        extraArrows:[...document.querySelectorAll('.date-navigation>.date-nav-button')].some(button => getComputedStyle(button).display !== 'none'),
        heading:{ x:rect('.schedule-view-title h2').x, bottom:rect('.schedule-view-title h2').bottom },
        periodTabsDisplay:style('.calendar-view-toggle').display,
      };
    });
    assert.equal(state.overflow, false, `${width}: horizontal overflow`);
    assert.equal(state.monthVisible, true, `${width}: month abbreviation disappeared`);
    if (width <= 760) {
      const listFits = await page.evaluate(() => {
        journalMode = 'list'; updateJournalModeButtons();
        const label = $('#scheduleViewMenu>summary');
        const fits = label.scrollWidth <= label.clientWidth;
        journalMode = 'timeline'; updateJournalModeButtons();
        return fits;
      });
      assert.equal(listFits, true, `${theme}/${width}/${scale}: Day/List label clips`);
      assert.equal(state.topSummary, 'none');
      assert.equal(state.oldToggle, 'none');
      assert.equal(state.today.h, 42, 'Visual buttons are approximately20% lower than52px');
      assert.equal(state.toggle.h, 42);
      assert.equal(state.rowHeight, 44, 'The whole54px row shrinks by10px');
      assert.deepEqual(state.controlsFont, ['11.5px','11.5px']);
      assert.deepEqual(state.controlsWeight, ['400','400']);
      assert.deepEqual(state.hitInsets, ['-1px','-1px'], 'Keep44px pointer targets');
      assert.deepEqual(state.chevron, {w:8,h:5}, 'Small wide down chevron');
      assert.ok(Math.abs(state.today.y - state.toggle.y) <= 1, `${width}: controls not aligned`);
      assert.ok(state.summary.x > state.title.right, `${width}: summary overlaps weekday`);
      assert.ok(state.summary.right <= width - 8, `${width}: two-digit summary clips`);
      assert.equal(state.hourLine, 'solid');
      assert.equal(state.halfHourLine, 'dashed');
      assert.equal(state.extraArrows, false, `${width}: duplicate day arrows`);
      assert.equal(state.dateIcon.w, 16);
      assert.equal(state.dateText, '29.09.2026');
      assert.ok(state.dateFits && state.dateUnclipped, `${theme}/${width}/${scale}: full date clips or overlaps a neighbour: ${JSON.stringify(state)}`);
      assert.equal(state.dateInputOpacity, '0', 'Native field internals must not clip the visible date');
      assert.equal((decodeURIComponent(state.dateIconMask).match(/<circle /g) || []).length, 6, 'Calendar has six date dots');
      assert.ok(state.dateIcon.x >= state.dateTextRight - 1, `${width}: calendar icon is not after date`);
      assert.ok(state.dateIcon.x - state.dateTextRight <= 5, `${width}: calendar icon detached from date`);
      assert.ok(Math.abs(state.dateGroupCenter - state.controlsCenter) <= 1, `${width}: date/calendar group not centered`);
      assert.ok(state.dateOpacity.every(opacity => opacity === '1'), `${width}: visible dates are dimmed`);
      assert.ok(Math.abs(state.headingCenter - state.actionsCenter) <= 3, `${theme}/${width}: heading below topbar icons`);
      assert.ok(state.heading.x <= 18, `${width}: heading shifted right`);
      assert.equal(state.periodTabsDisplay, 'none', 'Mobile periods belong in the view menu');
      const controlColors = await page.evaluate(() => {
        const today = document.querySelector('.date-navigation>.date-today-button');
        const toggle = document.querySelector('#scheduleViewMenu>summary');
        const activeMode = document.querySelector('#scheduleViewMenu [data-journal-mode].active');
        const otherDay = getComputedStyle(today).color;
        const todayBackground = getComputedStyle(today).backgroundColor;
        const toggleBackground = getComputedStyle(toggle).backgroundColor;
        const activeBackground = getComputedStyle(activeMode).backgroundColor;
        const accent = getComputedStyle(activeMode).color;
        today.classList.add('is-current');
        const currentDay = getComputedStyle(today).color;
        today.classList.remove('is-current');
        return { otherDay, currentDay, accent, todayBackground, toggleBackground, activeBackground };
      });
      assert.equal(controlColors.todayBackground, controlColors.toggleBackground, `${width}: Today and switch surfaces differ`);
      assert.equal(controlColors.currentDay, controlColors.accent, `${width}: Today is not pink when selected`);
      assert.notEqual(controlColors.otherDay, controlColors.accent, `${width}: Today is pink on another day`);
      if (theme === 'carbon-crimson') assert.equal(controlColors.toggleBackground, 'rgb(23, 35, 47)', `${width}: menu surface differs from Today`);
    } else {
      assert.equal(state.topSummary === 'none', false, 'desktop summary was hidden');
      assert.equal(state.toggle.h, 0, 'mobile toggle visible on desktop');
      assert.equal(state.dateInputOpacity, '1', 'Desktop native date field is unchanged');
      assert.equal(state.dateIconMask, 'none', 'Mobile calendar detail stays scoped');
    }
    if (output) await page.screenshot({ path:resolve(output, `compact-schedule-${theme}-${width}-${scale}.png`), clip:width <= 760 ? { x:0, y:0, width, height:Math.min(335, 844) } : undefined });
  }
  console.log('Compact schedule layout and timeline lines: PASS');
} finally {
  await browser.close();
}
