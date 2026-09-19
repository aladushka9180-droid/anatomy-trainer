import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const html = read('provider.html');
const script = read('provider.js');
const coreStyles = read('styles.css');
const styles = read('provider-schedule-minimal.css');
const refinements = read('provider-ui-refinements.css');
const worker = read('sw.js');

const summaryHelpersStart = script.indexOf('function bookingCountWord(count)');
const summaryHelpersEnd = script.indexOf('\nfunction updateBookingStats()', summaryHelpersStart);
assert.ok(summaryHelpersStart >= 0 && summaryHelpersEnd > summaryHelpersStart, 'Booking summary helpers are missing');
const summaryHelpers = new Function(`${script.slice(summaryHelpersStart, summaryHelpersEnd)}; return { bookingCountWord, bookingSummaryStats };`)();
assert.equal(summaryHelpers.bookingCountWord(0), 'записей');
assert.equal(summaryHelpers.bookingCountWord(1), 'запись');
assert.equal(summaryHelpers.bookingCountWord(2), 'записи');
assert.equal(summaryHelpers.bookingCountWord(5), 'записей');
assert.deepEqual(
  summaryHelpers.bookingSummaryStats([], '2026-09-30', () => false),
  { todayCount:0, tomorrowCount:0, upcomingCount:0 }
);
assert.deepEqual(
  summaryHelpers.bookingSummaryStats([
    { booking_date:'2026-09-30', status:'confirmed' },
    { booking_date:'2026-10-01', status:'new' },
    { booking_date:'2026-10-01', status:'confirmed' },
    { booking_date:'2026-10-02', status:'confirmed' },
    { booking_date:'2026-10-01', status:'cancelled' },
    { booking_date:'2026-10-01', status:'confirmed', block:true }
  ], '2026-09-30', item => item.block === true),
  { todayCount:1, tomorrowCount:2, upcomingCount:4 },
  'Summary must follow the organization date across a month boundary and exclude cancelled records and blocks'
);

assert.match(html, /provider-schedule-minimal\.css\?v=\d+/);
assert.match(worker, /\.\/provider-schedule-minimal\.css\?v=\d+/);
assert.match(html, /class="date-strip-frame"[\s\S]*data-date-shift="-1"[\s\S]*id="dateStrip"[\s\S]*data-date-shift="1"/);
assert.match(html, /class="provider-topbar-tools"[\s\S]*id="shareProviderClientPage"[\s\S]*Поделиться ссылкой для записи[\s\S]*id="openFreeSlots"[\s\S]*data-compact-label="Поделиться"/);
assert.doesNotMatch(html, /schedule-view-title[\s\S]{0,900}id="openFreeSlots"/);
assert.match(html, /id="newBookingButton"[^>]*aria-label="Новая запись"[^>]*data-compact-label="Новая запись"/);
assert.match(html, /id="todayBookingsCount"[\s\S]*id="tomorrowBookingsCount"[\s\S]*id="newBookingsCount"/);
assert.match(html, /data-journal-mode="timeline"[^>]*aria-label="Временная лента"[^>]*title="Лента"[^>]*aria-pressed="true"/);
assert.match(html, /data-journal-mode="list"[^>]*aria-label="Компактный список"[^>]*title="Список"[^>]*aria-pressed="false"/);
assert.match(html, /schedule-date-picker[\s\S]*ui-icons\.svg#icon-calendar[\s\S]*id="scheduleDatePicker"/);
assert.match(styles, /\.date-navigation:has\(\[data-calendar-view="day"\]\.active\)>\.date-nav-button,[\s\S]*\.date-navigation:has\(\[data-calendar-view="week"\]\.active\)>\.date-nav-button,[\s\S]*\.date-navigation:has\(\[data-calendar-view="month"\]\.active\)>\.date-nav-button\s*\{[^}]*display:none!important;/s);
assert.match(styles, /\.date-strip-shift\[data-date-shift="-1"\]\s*\{[^}]*left:8px;/s);
assert.match(styles, /\.date-strip-shift\[data-date-shift="1"\]\s*\{[^}]*right:8px;/s);
assert.match(styles, /\.date-strip-frame>\.date-strip\s*\{[^}]*box-sizing:border-box;/s);
assert.match(styles, /not\(\[data-provider-layout="split"\]\)[\s\S]*\.schedule-card:has\(#dateStrip:not\(\[hidden\]\)\)[\s\S]*border-radius:0!important;/s);
assert.match(styles, /@media \(min-width:761px\)[\s\S]*\.booking-sheet\s*\{[^}]*place-items:center;[\s\S]*\.booking-sheet-panel\s*\{[^}]*margin-bottom:0;/s);
assert.match(styles, /\.date-strip-frame>\.date-strip\s*\{[^}]*scroll-behavior:smooth;[^}]*overscroll-behavior-x:contain;/s);
assert.match(styles, /@media \(min-width:761px\)[\s\S]*cursor:grab;[\s\S]*\.is-dragging[\s\S]*cursor:grabbing;/);
assert.match(styles, /data-provider-theme\][\s\S]*--schedule-entry-fill-weight:26%;[\s\S]*--schedule-break-surface-weight:78%;/s);
assert.match(styles, /data-provider-theme="midnight"[\s\S]*--schedule-entry-fill-weight:36%;[\s\S]*--schedule-break-surface-weight:68%;/s);
assert.match(styles, /data-provider-theme\][\s\S]*timeline-booking:not\(\.status-block\):not\(\.automatic-break\)[\s\S]*--schedule-entry-tone:var\(--theme-accent\);[\s\S]*var\(--schedule-entry-fill-weight\)[\s\S]*inset 3px 0 0/s);
assert.doesNotMatch(styles, /--schedule-entry-tone:var\(--booking-tone/, 'Цвет конкретной записи не должен перебивать акцент выбранной темы');
assert.match(styles, /calendar-overview-booking:not\(\.status-block\)[\s\S]*calendar-week-booking:not\(\.is-block\)/s);
assert.match(styles, /timeline-booking-client[\s\S]*provider-booking-note-full[\s\S]*color:var\(--theme-ink\)!important;[\s\S]*opacity:1;/s);
assert.match(styles, /data-provider-theme\][\s\S]*timeline-booking\.status-block[\s\S]*var\(--schedule-break-surface-weight\)[\s\S]*background-image:none!important;[\s\S]*color:color-mix\(in srgb,var\(--theme-muted\) 72%,var\(--theme-ink\)\)!important;/s);
assert.match(styles, /data-provider-theme\][\s\S]*timeline-booking\.status-block[\s\S]*timeline-booking-copy>strong::before[\s\S]*linear-gradient\(90deg,currentColor/s);
assert.match(styles, /#providerBookings\.calendar-overview-month \.calendar-overview-booking\.status-block[\s\S]*var\(--schedule-break-surface-weight\)[\s\S]*box-shadow:none!important;/s);
assert.match(styles, /v786: compact schedule controls[\s\S]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)[\s\S]*min-height:44px!important[\s\S]*calc\(\(100% - 24px\) \/ 5\)[\s\S]*grid-template-columns:44px 44px/s);
assert.match(styles, /v786: narrow schedule polish[\s\S]*grid-template-columns:32px minmax\(0,1fr\) 32px!important[\s\S]*calc\(\(100% - 16px\) \/ 5\)!important[\s\S]*position:static!important[\s\S]*border-width:0 1\.7px 1\.7px 0/s);
assert.match(styles, /v786: records-list controls stay compact without nested framing[\s\S]*grid-template-rows:auto auto!important[\s\S]*grid-row:2!important[\s\S]*border:0!important/s);
assert.match(styles, /grid-template-rows:10px 22px 10px!important[\s\S]*line-height:10px!important[\s\S]*height:52px!important/s);
assert.match(styles, /is-today:not\(\.active\)[\s\S]*background:transparent!important[\s\S]*26%,transparent/s);
assert.match(styles, /date-strip-frame>\.date-strip-shift[\s\S]*width:44px!important[\s\S]*background:transparent!important[\s\S]*\.ui-icon\s*\{[^}]*display:none!important[\s\S]*border-width:0 1\.7px 1\.7px 0/s);
assert.match(styles, /@media \(max-width:430px\)[\s\S]*date-strip-frame>\.date-strip>button strong[\s\S]*font-size:17px!important/s);
assert.match(styles, /\.dashboard-summary\s*\{[^}]*grid-column:1!important;[^}]*grid-template-columns:auto auto auto!important;[^}]*width:max-content!important;[\s\S]*Всего впереди —/s);
assert.match(styles, /v786: list controls grow[\s\S]*:has\(\.booking-filters:not\(\[hidden\]\)\)[\s\S]*height:auto!important[\s\S]*\.schedule-controls\s*\{[^}]*display:contents!important;[\s\S]*\.booking-filters\s*\{[^}]*grid-row:2!important;/s);
assert.match(styles, /--provider-mobile-nav-clearance:max\(96px,calc\(80px \+ env\(safe-area-inset-bottom,0px\)\)\)[\s\S]*padding-bottom:var\(--provider-mobile-nav-clearance\)!important;/s);
assert.match(coreStyles, /v786: compact mobile navigation[\s\S]*bottom:max\(0px,env\(safe-area-inset-bottom,0px\)\)!important;[\s\S]*padding:1px 4px!important;[\s\S]*min-height:44px!important;[\s\S]*gap:1px!important;/s);
assert.match(script, /const swipeSurface = event\.target\.closest\('#providerBookings'\)/);
assert.match(script, /if \(dateShift\) \{[\s\S]*date-strip-frame[\s\S]*shiftScheduleDate\(Number\(dateShift\.dataset\.dateShift\), \{ weekStep \}\);[\s\S]*\}/s);
assert.match(script, /activeRect\.left - stripRect\.left \+ dateStrip\.scrollLeft/);
assert.match(script, /function dateStripSwipeStep\([\s\S]*Math\.abs\(deltaX\) < threshold[\s\S]*return deltaX < 0 \? 1 : -1;/s);
assert.match(script, /touchstart[\s\S]*touchend[\s\S]*scheduleMobileSettle\(170\)/s);
assert.doesNotMatch(script, /touchend[\s\S]*shiftScheduleDate\(step\)/s);
assert.match(script, /rangeStart\.getDate\(\) - \(mobileCenteredRange \? 120 : 28\)[\s\S]*rangeMode = mobileCenteredRange \? 'inertial'/s);
assert.match(styles, /v833:[\s\S]*overflow-x:auto!important;[\s\S]*scroll-snap-type:x proximity;[\s\S]*touch-action:pan-x pan-y!important;/s);
assert.match(script, /centerDateStripSelection\(dateStrip, options = \{\}\)[\s\S]*behavior:'smooth'/s);
assert.match(script, /function updateDateStripEmphasis\(dateStrip\)[\s\S]*Math\.min\(3, Math\.abs\(index - activeIndex\)\)[\s\S]*button\.dataset\.dateDistance = String\(distance\)/s);
assert.match(script, /button\.classList\.toggle\('active', active\)[\s\S]*updateDateStripEmphasis\(dateStrip\)/s);
assert.match(styles, /v823: reference-led mobile schedule[\s\S]*data-date-distance="2"[\s\S]*data-date-distance="1"[\s\S]*data-date-distance="0"[\s\S]*--date-card-width:clamp\(46px,12\.2vw,56px\)[\s\S]*--date-card-height:58px/s);
assert.match(styles, /v822: compose the mobile journal[\s\S]*margin:50px var\(--schedule-mobile-card-inset,4px\) 0!important;[\s\S]*border-radius:22px 22px 0 0!important;[\s\S]*margin:0 var\(--schedule-mobile-card-inset,4px\) 6px!important;[\s\S]*border-radius:0 0 22px 22px!important;/s);
assert.match(styles, /\.timeline-view\s*\{[\s\S]*padding:12px 12px max\(22px,var\(--provider-mobile-nav-clearance\)\)!important;[\s\S]*overflow:visible!important;/s);
assert.match(styles, /provider-mobile-nav>button\.active[\s\S]*background:var\(--theme-accent-soft\)!important;[\s\S]*mobile-nav-badge[\s\S]*background:var\(--theme-accent\)!important;/s);
assert.match(styles, /timeline-booking\.automatic-break[\s\S]*background-image:none!important;/s);
assert.match(script, /todayButton\.classList\.toggle\('is-current', current\)[\s\S]*setAttribute\('aria-pressed', String\(current\)\)/);
assert.match(script, /function updateJournalModeButtons\(\)[\s\S]*modeToggle\.hidden = Boolean\(teamCalendarController\?\.isTeamMode\) \|\| calendarView !== 'day';/);
assert.match(script, /function setTeamCalendarMode\(active, options = \{\}\)[\s\S]*modeToggle\.hidden = teamMode \|\| calendarView !== 'day';/);
assert.match(styles, /v786: stable schedule geometry[\s\S]*scrollbar-gutter:stable;[\s\S]*overflow-y:scroll;[\s\S]*\.journal-mode-toggle\[hidden\][\s\S]*display:none!important;[\s\S]*grid-template-rows:44px!important;[\s\S]*height:60px!important;[\s\S]*calendar-month-mobile-agenda[\s\S]*padding:10px!important;[\s\S]*padding-right:56px;/s);
assert.match(refinements, /#providerBookings\.calendar-overview-month > \.calendar-overview-grid \.calendar-overview-booking \{[^}]*grid-template-columns:36px minmax\(0,1fr\);/s);
assert.doesNotMatch(refinements, /@media\(max-width:760px\)[\s\S]*#providerBookings\.calendar-overview-month \.calendar-overview-booking \{[^}]*padding:3px 1px;/s);
assert.match(script, /const bookingFormLauncherSelector = '#newBookingButton, #mobileNewBookingButton, \[data-create-empty-booking\]';/);
assert.match(script, /controlAllowed = control\.matches\(bookingFormLauncherSelector\) \|\| writesAllowed/);
assert.match(script, /id="newBookingReadiness" role="status" aria-live="polite" hidden/);
assert.match(script, /submit\.disabled = !newBookingTime \|\| !creationAllowed;/);
assert.match(script, /if \(changed && bookingCreationReady\) void loadNewBookingSlots\(\);/);
assert.match(script, /const phone = block \|\| !displayPreferences\.show_phone \? '' : String\(item\.client_phone \|\| ''\);/);
assert.match(script, /holder\.dataset\.recordsFilter = currentFilter;/);
assert.match(script, /const breakOrigin = item\.automatic_break \? 'Автоматический · по правилам' : 'Ручной';/);
assert.match(script, /block \? ' is-schedule-block' : clientHighlightClasses\(item\.client_phone\)/);
assert.match(script, /provider-booking-signals[^`]*\$\{block \? '' : `<span class="booking-status">\$\{statusText\}<\/span>\$\{visitMarkup\}`\}/s);
assert.doesNotMatch(script, /block \? `<span class="provider-booking-client-line"><strong>Занятое время<\/strong><span>\$\{duration\} мин<\/span><\/span>`/);
assert.deepEqual([...new Set([...styles.matchAll(/#[0-9a-f]{3,8}\b/gi)].map(match => match[0].toLowerCase()))], [], 'Экран расписания должен брать акцент и контраст из текущей темы');
assert.match(styles, /v786: keep mobile schedule geometry clipped[\s\S]*\.timeline-stage\s*\{[^}]*overflow:clip;[\s\S]*#newBookingButton span\s*\{[^}]*position:static!important;[\s\S]*calendar-overview-month\s*\{[^}]*padding-bottom:max\(24px,env\(safe-area-inset-bottom,0px\)\)!important;/s);
assert.doesNotMatch(script, /timelineFullDay|timelineWasCompacted|data-expand-timeline|Показать весь день/);
assert.doesNotMatch(styles, /timeline-day-expand/);
assert.match(coreStyles, /\.provider-bookings\.schedule-list > \*[\s\S]*content-visibility:auto;/s);
assert.doesNotMatch(coreStyles, /\.provider-bookings:not\(\.timeline-view\) > \*:not\(\.calendar-week-timeline\)[\s\S]*content-visibility:auto;/s,
  'Calendar structure must contribute its real height to mobile scrolling');
assert.match(script, /function updateProviderClientLinks\(organization = null\)[\s\S]*organization\?\.public_booking_enabled && organization\.public_slug[\s\S]*shareButton\.dataset\.clientPageUrl = available \? url\.href : '';/s);
assert.match(script, /async function shareProviderClientPage\(\)[\s\S]*typeof navigator\.share === 'function'[\s\S]*error\?\.name === 'AbortError'[\s\S]*navigator\.clipboard\.writeText\(url\)[\s\S]*Ссылка на страницу клиента скопирована/s);
assert.match(script, /#shareProviderClientPage'\)\?\.addEventListener\('click', shareProviderClientPage\)/);
assert.match(styles, /v786: compact record cards and keep the mobile navigation geometry honest[\s\S]*--provider-mobile-nav-clearance:max\(80px,calc\(64px \+ env\(safe-area-inset-bottom,0px\)\)\)[\s\S]*--provider-mobile-nav-item-radius:999px[\s\S]*min-height:44px!important/s);
assert.match(styles, /schedule-list\[data-records-filter="day"\][\s\S]*booking-time-column>span\s*\{[^}]*display:none!important;/s);
assert.match(styles, /schedule-list \.provider-booking-top h3\s*\{[^}]*-webkit-line-clamp:3!important;/s);
assert.match(styles, /schedule-list \.provider-booking\.is-schedule-block \.provider-booking-open\s*\{[^}]*min-height:64px!important;/s);

console.log('Provider minimal schedule controls: OK');
