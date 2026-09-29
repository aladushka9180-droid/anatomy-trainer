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
assert.ok(modeStart >= 0 && orderStart > modeStart && orderEnd > orderStart);
const { chromium } = process.env.MINUTA_PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href)
  : createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ headless:true, executablePath:process.env.MINUTA_CHROME_PATH });
const output = process.env.MINUTA_SCHEDULE_OUTPUT;
if (output) mkdirSync(output, { recursive:true });

try {
  const context = await browser.newContext({ viewport:{ width:390, height:844 }, deviceScaleFactor:2, bypassCSP:true });
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
    document.querySelector('.schedule-mobile-mode-toggle').hidden = false;
    document.querySelector('#scheduleMobileSummary').hidden = false;
    document.querySelector('.booking-filters').hidden = true;
    document.querySelector('#scheduleDatePicker').value = '2026-09-27';
    document.querySelector('#selectedDateTitle .selected-date-title-mobile').textContent = 'Воскресенье';
    document.querySelector('#mobileTodayBookingsCount').textContent = '12';
    document.querySelector('#mobileTomorrowBookingsCount').textContent = '10';
    document.querySelector('#mobileUpcomingBookingsCount').textContent = '24';
    document.querySelector('#dateStrip').innerHTML = [25, 26, 27, 28, 29].map((day, index) => `<button type="button" class="${day === 27 ? 'active' : ''}"><span>${['Пт','Сб','Вс','Пн','Вт'][index]}</span><strong>${day}</strong><small>сент</small></button>`).join('');
    document.querySelector('#providerBookings').className = 'provider-bookings timeline-view';
    document.querySelector('#providerBookings').innerHTML = '<div class="day-timeline" style="--timeline-height:180px;--half-hour-offset:45px"><div class="timeline-hours"></div><div class="timeline-stage"><i class="timeline-grid-line" style="top:0"></i></div></div>';
  });
  await page.addScriptTag({ content:`
    const $ = selector => document.querySelector(selector);
    const $$ = selector => [...document.querySelectorAll(selector)];
    let teamCalendarController = null, calendarView = 'day', currentFilter = 'day', journalMode = 'timeline';
    ${providerSource.slice(modeStart, orderStart)}
    ${providerSource.slice(orderStart, orderEnd)}
  ` });
  const modes = await page.evaluate(() => {
    journalMode = 'list'; updateJournalModeButtons();
    const listSync = [...document.querySelectorAll('[data-journal-mode="list"]')].every(button => button.classList.contains('active') && button.getAttribute('aria-pressed') === 'true');
    calendarView = 'week'; updateJournalModeButtons();
    const hiddenOutsideDay = document.querySelector('.schedule-mobile-mode-toggle').hidden && document.querySelector('#scheduleMobileSummary').hidden;
    calendarView = 'day'; journalMode = 'timeline'; updateJournalModeButtons();
    return { listSync, hiddenOutsideDay };
  });
  assert.deepEqual(modes, { listSync:true, hiddenOutsideDay:true });

  for (const theme of ['carbon-crimson', 'pink-porcelain']) for (const width of [360, 390, 760, 1440]) {
    await page.setViewportSize({ width, height:844 });
    await page.evaluate(theme => {
      document.body.dataset.providerTheme = theme;
      document.body.dataset.providerResolvedColorMode = theme === 'carbon-crimson' ? 'dark' : 'light';
      syncCompactScheduleOrder();
    }, theme);
    const state = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect();
      const style = selector => getComputedStyle(document.querySelector(selector));
      const today = rect('.date-navigation>.date-today-button');
      const toggle = rect('.schedule-mobile-mode-toggle');
      const summary = rect('#scheduleMobileSummary');
      const title = rect('#selectedDateTitle');
      return {
        overflow: document.documentElement.scrollWidth > innerWidth + 2,
        today:{ x:today.x, y:today.y, h:today.height },
        toggle:{ x:toggle.x, y:toggle.y, h:toggle.height },
        summary:{ x:summary.x, right:summary.right, y:summary.y, h:summary.height },
        title:{ right:title.right, y:title.y },
        topSummary:style('.schedule-view-title .dashboard-summary').display,
        oldToggle:style('.journal-mode-toggle').display,
        monthVisible:rect('#dateStrip button.active small').height > 0,
        hourLine:style('.timeline-grid-line').borderTopStyle,
        halfHourLine:getComputedStyle(document.querySelector('.timeline-grid-line'), '::after').borderTopStyle,
        dateIcon:{ x:rect('.schedule-date-picker>.ui-icon').x, w:rect('.schedule-date-picker>.ui-icon').width },
        dateInputRight:rect('.schedule-date-picker input').right,
        extraArrows:[...document.querySelectorAll('.date-navigation>.date-nav-button')].some(button => getComputedStyle(button).display !== 'none'),
        heading:{ x:rect('.schedule-view-title h2').x, bottom:rect('.schedule-view-title h2').bottom },
        tabsTop:rect('.calendar-view-toggle').top,
      };
    });
    assert.equal(state.overflow, false, `${width}: horizontal overflow`);
    assert.equal(state.monthVisible, true, `${width}: month abbreviation disappeared`);
    if (width <= 760) {
      assert.equal(state.topSummary, 'none');
      assert.equal(state.oldToggle, 'none');
      assert.equal(state.today.h, 40);
      assert.equal(state.toggle.h, 40);
      assert.ok(Math.abs(state.today.y - state.toggle.y) <= 1, `${width}: controls not aligned`);
      assert.ok(state.summary.x > state.title.right, `${width}: summary overlaps weekday`);
      assert.ok(state.summary.right <= width - 8, `${width}: two-digit summary clips`);
      assert.equal(state.hourLine, 'solid');
      assert.equal(state.halfHourLine, 'dashed');
      assert.equal(state.extraArrows, false, `${width}: duplicate day arrows`);
      assert.equal(state.dateIcon.w, 16);
      assert.ok(state.dateIcon.x >= state.dateInputRight - 1, `${width}: calendar icon is not after date`);
      assert.ok(state.heading.x <= 18, `${width}: heading shifted right`);
      assert.ok(state.heading.bottom < state.tabsTop, `${theme}/${width}: period tabs overlap heading`);
      const controlColors = await page.evaluate(() => {
        const today = document.querySelector('.date-navigation>.date-today-button');
        const toggle = document.querySelector('.schedule-mobile-mode-toggle');
        const activeMode = toggle.querySelector('button.active');
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
      if (theme === 'carbon-crimson') assert.equal(controlColors.activeBackground, 'rgb(40, 57, 74)', `${width}: selected switch fill differs from reference`);
    } else {
      assert.equal(state.topSummary === 'none', false, 'desktop summary was hidden');
      assert.equal(state.toggle.h, 0, 'mobile toggle visible on desktop');
    }
    if (output) await page.screenshot({ path:resolve(output, `compact-schedule-${theme}-${width}.png`), clip:width <= 760 ? { x:0, y:0, width, height:Math.min(335, 844) } : undefined });
  }
  console.log('Compact schedule layout and timeline lines: PASS');
} finally {
  await browser.close();
}
