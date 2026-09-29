import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// All rows are invented. This harness executes actual provider.js functions
// and its click branch from the supplied project root with inert DOM stubs.
const option = name => {
  const index = process.argv.indexOf(name);
  return index < 0 ? '' : process.argv[index + 1] || '';
};
const projectRoot = option('--project-root');
const baselineRef = option('--baseline-ref');
assert.notEqual(Boolean(projectRoot), Boolean(baselineRef), 'Provide exactly one of --project-root or --baseline-ref');
const sourceLabel = projectRoot ? resolve(projectRoot) : `git:${baselineRef}`;
const read = file => projectRoot
  ? readFileSync(resolve(projectRoot, 'minuta-online-booking', file), 'utf8')
  : execFileSync('git', ['show', `${baselineRef}:minuta-online-booking/${file}`], { encoding:'utf8', maxBuffer:8 * 1024 * 1024 });
const source = read('provider.js').replace(/\r\n/g, '\n');
const styles = ['styles.css','provider-ux.css'].map(read);
const sourceSha256 = createHash('sha256').update(source).digest('hex');
function section(input, from, to) {
  const start = input.indexOf(from);
  const end = input.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, `Missing source section ${from}`);
  return input.slice(start, end);
}
function harness(input) {
  const parts = [
    section(input, 'function prepareDemoBookingContext(', '\nfunction restoreOwnBookingContext('),
    section(input, 'function reportDateText(', '\nfunction reportRange('),
    section(input, 'function reportExportDate(', '\nfunction reportExportPhone('),
    section(input, 'function reportPerformerName(', '\nfunction reportPeriodName('),
    section(input, 'function reportDrilldownScope(', '\nfunction handleReportAction('),
    section(input, 'function bookingMatchesAnalyticsScope(', '\nfunction renderReportHeatmap('),
    section(input, 'function setProviderViewImmediate(', '\nfunction setProviderView('),
    section(input, 'function filteredBookings(', '\nfunction bookingQueryIsActive('),
    section(input, 'function bookingQueryIsActive(', '\nfunction updateBookingQueryTools('),
    section(input, 'function updateBookingQueryTools(', '\nfunction applyBookingQuery('),
    section(input, 'function applyBookingQuery(', '\nfunction minutesFromTime('),
    section(input, 'function minutesFromTime(', '\nfunction timeFromMinutes('),
    section(input, 'function timeFromMinutes(', '\nfunction timelineBounds('),
  ];
  const click = section(input, '  if (reportHeatmapCell) {', '\n  if (showOwnBookings) {');
  const back = section(input, "$('#bookingAnalyticsFilterChip')?.addEventListener('click'", "\n$('#providerBookings').addEventListener('click'");
  return `
    const $ = selector => document.querySelector(selector);
    const $$ = selector => [...document.querySelectorAll(selector)];
    const demoRows = ${JSON.stringify([
      {id:'demo-early',booking_date:'2026-10-05',booking_time:'07:30',duration_minutes:90,status:'confirmed',performer_id:'team-a',organization_id:'org-a'},
      {id:'demo-eight',booking_date:'2026-10-05',booking_time:'08:30',duration_minutes:45,status:'confirmed',performer_id:'team-a',organization_id:'org-a'},
      {id:'demo-nine',booking_date:'2026-10-05',booking_time:'09:30',duration_minutes:60,status:'confirmed',performer_id:'team-a',organization_id:'org-a'},
      {id:'demo-boundary',booking_date:'2026-10-05',booking_time:'10:00',duration_minutes:60,status:'confirmed',performer_id:'team-a',organization_id:'org-a'},
      {id:'demo-later',booking_date:'2026-10-05',booking_time:'11:00',duration_minutes:60,status:'confirmed',performer_id:'team-a',organization_id:'org-a'},
      {id:'demo-other-weekday',booking_date:'2026-10-06',booking_time:'08:30',duration_minutes:60,status:'confirmed',performer_id:'team-a',organization_id:'org-a'},
      {id:'demo-outside-range',booking_date:'2026-10-12',booking_time:'08:30',duration_minutes:60,status:'confirmed',performer_id:'team-a',organization_id:'org-a'},
      {id:'demo-other-performer',booking_date:'2026-10-05',booking_time:'08:30',duration_minutes:60,status:'confirmed',performer_id:'team-b',organization_id:'org-a'},
      {id:'demo-other-organization',booking_date:'2026-10-05',booking_time:'08:30',duration_minutes:60,status:'confirmed',performer_id:'team-a',organization_id:'org-b'},
      {id:'demo-cancelled',booking_date:'2026-10-05',booking_time:'08:30',duration_minutes:60,status:'cancelled',performer_id:'team-a',organization_id:'org-a'},
    ])};
    const ownRows = [{id:'own-unrelated',booking_date:'2026-10-05',booking_time:'08:30',duration_minutes:60,status:'confirmed',performer_id:'team-a',organization_id:'org-a'}];
    let reportDataSource='demo', reportCanViewTeam=true, reportPerformerFilter='team-a';
    let reportTeamAnalyticsState={rows:[{performer_id:'team-a',performer_name:'Сотрудник А'}]};
    let bookingAnalyticsScope=null, bookingAnalyticsFilter='', bookingSearchQuery='', bookingStatusFilter='all', bookingSourceFilter='all';
    let currentFilter='day', calendarView='day', journalMode='timeline', selectedDate='2026-10-09', bookingRenderLimit=100;
    const BOOKING_RENDER_PAGE_SIZE=100, providerBookingViewRevisions=new Map();
    let offlineBookingCompletion=null, currentUser=null, clientAvatarsLoaded=false, portfolioSyncDirty=false;
    let teamCalendarController=null;
    function bookingUsesDemoData(){return reportDataSource==='demo';}
    function bookingSourceItems(){return reportDataSource==='demo' ? demoRows : ownRows;}
    function reportTodayIso(){return '2026-10-09';}
    function businessTodayIso(){return '2026-10-09';}
    function reportRange(){return {start:'2026-10-01',end:'2026-10-10'};}
    function reportOrganizationId(){return 'org-a';}
    function reportEffectivePerformerId(item){return item.performer_id;}
    function isScheduleBlock(item){return Boolean(item.schedule_block);}
    function parseLocalIsoDate(value){return new Date(value+'T12:00:00');}
    function reportBookingSource(item){return item.booking_source || 'unknown';}
    function rememberOwnBookingContext(){}
    function renderDateStrip(){}
    function dismissOfflineBookingCompletion(){}
    function setClientProfileDetailMode(){}
    function navigationForRole(){return ['analytics','bookings'];}
    function renderBookingDataSourceNotice(){}
    function renderAnalytics(){}
    function refreshSectionNavigation(){}
    function focusProviderViewHeading(){}
    function notify(message){window.__lastNotice=message;}
    function setJournalMode(mode){journalMode=mode; renderProviderBookingView('bookings');}
    function setFilter(filter){currentFilter=filter; if(filter!=='day')calendarView='day'; renderProviderBookingView('bookings');}
    function setProviderView(view){setProviderViewImmediate(view,false);}
    function renderProviderBookingView(view){
      if(view!=='bookings')return;
      const rows=applyBookingQuery(filteredBookings());
      $('#providerBookings').innerHTML=rows.map(row=>'<div data-booking-id="'+row.id+'">'+row.id+'</div>').join('');
      updateBookingQueryTools();
    }
    ${parts.join('\n')}
    $('#reportHeatmapCell').addEventListener('click', event => {
      const reportHeatmapCell = event.target.closest('[data-report-heatmap-weekday]');
      ${click}
    });
    ${back}
    window.__n03State=()=>({filter:currentFilter,mode:journalMode,view:$('#dashboard').dataset.activeView,
      date:selectedDate, ids:$$('[data-booking-id]').map(row=>row.dataset.bookingId),
      scope:bookingAnalyticsScope,chip:$('#bookingAnalyticsFilterChip').textContent,
      chipVisible:!$('#bookingAnalyticsFilterChip').hidden && !$('#bookingQueryTools').hidden});
    window.__n03SwitchSource=source=>{reportDataSource=source;renderProviderBookingView('bookings');};
    window.__n03RefreshDemo=()=>{prepareDemoBookingContext();renderProviderBookingView('bookings');};
  `;
}

const modulePath = process.env.MINUTA_PLAYWRIGHT_MODULE;
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const browser = await chromium.launch({headless:true, ...(process.env.BROWSER_CHANNEL ? {channel:process.env.BROWSER_CHANNEL} : {})});
const failures = [];
console.log(JSON.stringify({source:sourceLabel,sourceSha256}));
try {
  for (const width of [390,760,1440]) {
    const page = await browser.newPage({viewport:{width,height:850}});
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    try {
      await page.setContent(`<!doctype html><html><body class="provider-body" data-provider-theme="sage-studio" data-provider-layout="soft">
        <div id="dashboard" data-active-view="analytics">
          <div data-provider-panel="analytics"><details class="report-analytics-details" open><summary>Подробная аналитика</summary>
            <button id="reportHeatmapCell" type="button" data-report-heatmap-weekday="0" data-report-heatmap-from="480" data-report-heatmap-to="600">Пн, 08:00–10:00 · 3 записи</button>
          </details></div>
          <div data-provider-panel="bookings" hidden><div id="bookingQueryTools" class="booking-query-tools" hidden>
            <button id="bookingAnalyticsFilterChip" class="booking-analytics-filter-chip" type="button" hidden></button>
            <button id="bookingQueryReset" type="button" hidden></button><button id="bookingSourceFilterChip" type="button" hidden></button>
          </div><input id="bookingSearch"><select id="bookingStatusFilter"><option value="all">Все</option></select>
          <div id="providerBookings"></div></div>
        </div><button id="mobileNewBookingButton" type="button"></button></body></html>`);
      for (const style of styles) await page.addStyleTag({content:style});
      await page.addScriptTag({content:harness(source)});
      await page.locator('#reportHeatmapCell').click();
      const state = await page.evaluate(() => __n03State());
      console.log(JSON.stringify({width,ids:state.ids,filter:state.filter,mode:state.mode,chipVisible:state.chipVisible}));
      assert.equal(state.mode,'list',`${width}: keep list mode`);
      assert.equal(state.filter,'all',`${width}: keep scoped query active`);
      assert.deepEqual(state.ids,['demo-early','demo-eight','demo-nine'],`${width}: only intersecting selected visits`);
      assert.deepEqual({start:state.scope.start,end:state.scope.end,weekday:state.scope.weekday,
        timeFrom:state.scope.timeFrom,timeTo:state.scope.timeTo,performer:state.scope.performer,
        organization:state.scope.organization,source:state.scope.source},
        {start:'2026-10-01',end:'2026-10-10',weekday:0,timeFrom:480,timeTo:600,
          performer:'team-a',organization:'org-a',source:'demo'},`${width}: preserve all selection dimensions`);
      assert.equal(state.chipVisible,true,`${width}: return/context chip visible`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth <= 1),`${width}: header has no page overflow`);
      for (const expected of ['01.10.2026–10.10.2026','Пн, 08:00–10:00','Сотрудник А','Демо'])
        assert.ok(state.chip.includes(expected),`${width}: missing context ${expected}`);
      await page.evaluate(() => __n03RefreshDemo());
      assert.deepEqual((await page.evaluate(() => __n03State())).ids,state.ids,`${width}: demo refresh preserves drilldown`);
      await page.evaluate(() => __n03SwitchSource('own'));
      assert.deepEqual((await page.evaluate(() => __n03State())).ids,[],`${width}: other data source cannot enter drilldown`);
      await page.locator('#bookingAnalyticsFilterChip').click();
      await page.waitForFunction(() => document.querySelector('#dashboard').dataset.activeView === 'analytics');
      assert.deepEqual(pageErrors,[],`${width}: no browser errors`);
      console.log(JSON.stringify({width,result:'PASS'}));
    } catch (error) {
      failures.push({width,message:error?.message || String(error)});
      console.error(JSON.stringify({width,result:'FAIL',message:error?.message || String(error)}));
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}
if (failures.length) {
  console.error(JSON.stringify({result:'FAIL',source:sourceLabel,failedWidths:failures.map(item=>item.width)}));
  process.exitCode = 1;
} else console.log(JSON.stringify({result:'PASS',source:sourceLabel,widths:[390,760,1440]}));
