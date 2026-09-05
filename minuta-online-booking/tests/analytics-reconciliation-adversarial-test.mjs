import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

// Independent test-only baseline: 3bc236458b2145d783039bfc816002b65cb93b57.
// Actual export/name helpers and report/drilldown filters; synthetic records and
// formatting/value boundaries. No DOM navigation, authenticated session wiring,
// downloaded document, SQL, payment or payroll mutation is exercised.
// Baseline is intentionally RED; do not wire into green CI until fixed.
const sourcePath=process.env.MINUTA_PROVIDER_SOURCE || fileURLToPath(new URL('../provider.js',import.meta.url));
const bytes=readFileSync(sourcePath),source=bytes.toString('utf8').replaceAll('\r\n','\n');
const reconciliation=readFileSync(join(dirname(sourcePath),'report-reconciliation.js'),'utf8');
console.log(`Actual provider: ${sourcePath}; SHA256=${createHash('sha256').update(bytes).digest('hex')}`);
function declaration(name) {
  const start=source.search(new RegExp(`^(?:async )?function ${name}\\(`,'m'));
  assert.ok(start>=0,`Missing actual function ${name}`);
  const lineEnd=source.indexOf('\n',start);
  const end=source.slice(start,lineEnd).endsWith('}') ? lineEnd : source.indexOf('\n}',start)+2;
  assert.ok(end>start,`Missing actual function end ${name}`);
  return source.slice(start,end);
}
const names=['reportBookings','reportCompletedItems','reportRevenue','reportClientIdentity','reportClientMetrics',
  'reportExportData','reportExportVisit','reportSessionKey','reportDataQueryRange','reportImportedValue',
  'reportReceivedAmount','reportDebtAmount','reportServiceValue','reportReconciledTeamRows','reportEffectivePerformerId',
  'reportExportPerformers','reportExportMaster','reportExportCreator','reportBookingSource','reportSourceMetrics','applyBookingQuery'];
// The fixed source delegates name gating to this actual helper; old baseline
// has no such declaration. Never substitute a model for either implementation.
if (/^function reportCurrentTeamRows\(/m.test(source)) names.push('reportCurrentTeamRows');
if (/^function reportCurrentEventRows\(/m.test(source)) names.push('reportCurrentEventRows');
const actual=names.map(declaration).join('\n');
const range={start:'2026-09-01',end:'2026-09-30',period:'month'};
function booking(id,overrides={}) {
  return {id,booking_date:'2026-09-10',booking_time:'10:00:00',duration_minutes:60,
    performer_id:'master-A',organization_id:'org-A',client_name:'Synthetic client',client_phone:'79990000000',
    status:'confirmed',value:1000,created_by_user_id:'master-A',booking_source:'provider_manual',
    booking_outcomes:{visit_status:'completed',payment_method:'cash',amount_rub:600},...overrides};
}
function fixture(items=[booking('visit-A')]) {
  const state={allBookings:items,importedBookingHistory:[],reportDataSource:'own',reportCanViewTeam:false,reportPerformerFilter:'all',
    sessionGeneration:1,currentUser:{id:'actor-A'},reportPeriod:'month',reportRange:()=>range,
    reportUsesScopedBookings:()=>false,reportOrganizationId:()=> 'org-A',reportScopedBookingsState:{status:'ready',rows:items},
    reportTeamAnalyticsState:{status:'ready',key:'1:actor-A:org-A:2026-09-01:2026-09-30',
      rows:[{performer_id:'master-A',performer_name:'Current master A',payroll_rub:-321}]},reportEventState:{rows:[]},
    isScheduleBlock:item=>Boolean(item.is_schedule_block),bookingOutcome:item=>item.booking_outcomes,
    normalizePhone:value=>String(value||'').replace(/\D/g,''),parseLocalIsoDate:value=>new Date(`${value}T00:00:00Z`),
    reportExportValue:item=>item.value,bookingSessionTotal:item=>item.value,reportExportDuration:item=>item.duration_minutes,
    reportExportDate:value=>value,reportExportEnd:()=> '11:00',reportExportPhone:value=>value,
    bookingSession:()=>[{title:'Service'}],serviceName:value=>value,isPerMinuteBooking:()=>false,bookingMinuteRate:()=>0,
    paymentMethodLabel:value=>value,reportExportSource:()=> 'Master',bookingDisplayNote:()=>'',
    currentFilter:'all',bookingSearchQuery:'',bookingStatusFilter:'all',bookingSourceFilter:'all',
    bookingAnalyticsFilter:'debt',bookingAnalyticsScope:{...range,performer:'master-A'}};
  const context=vm.createContext(state);
  vm.runInContext(reconciliation+'\n'+actual,context,{filename:sourcePath});
  return {state,context};
}
const ids=items=>Array.from(items,item=>item.id);

test('CONTROL current team snapshot supplies actual master/creator labels and signed payroll',()=>{
  const h=fixture(),data=h.context.reportExportData();
  assert.equal(data.rows[0][6],'Current master A');
  assert.equal(data.rows[0][15],'Current master A');
  assert.equal(data.team[0][0],'Current master A');
  assert.equal(data.team[0][6],-321);
  assert.equal(data.revenue,600);assert.equal(data.debt,400);
});

test('SAFETY stale actor/org/period names cannot enter export detail while payroll rejects the same snapshot',()=>{
  const h=fixture();
  h.state.reportTeamAnalyticsState.key='99:other-actor:other-org:2026-08-01:2026-08-31';
  h.state.reportTeamAnalyticsState.rows[0].performer_name='PRIVATE OLD CONTEXT NAME';
  const data=h.context.reportExportData();
  assert.equal(data.team[0][0],'Мастер','Positive: actual reconciled team already rejects stale label');
  assert.equal(data.team[0][6],'Не рассчитано','Positive: stale salary is not used');
  assert.equal(data.rows[0][6],'Мастер','Detail export must use the same current-snapshot guard');
  assert.equal(data.rows[0][15],'Мастер','Creator export must not bypass the label scope guard');
  assert.equal(JSON.stringify({rows:data.rows,team:data.team}).includes('PRIVATE OLD CONTEXT NAME'),false);
});

test('CONTROL assigned-performer fallback and selected period agree in report and debt drilldown',()=>{
  const items=[booking('visit-A'),booking('outside',{booking_date:'2026-08-10'})],h=fixture(items);
  h.state.reportCanViewTeam=true;h.state.reportPerformerFilter='master-A';
  assert.deepEqual(ids(h.context.reportBookings(range)),['visit-A']);
  assert.deepEqual(ids(h.context.applyBookingQuery(items)),['visit-A']);
  assert.equal(h.context.reportExportData().debt,400);
});

test('SAFETY completed performer snapshot must identify the same debt visit in report and drilldown',()=>{
  const item=booking('completed-by-B',{booking_outcomes:{visit_status:'completed',payment_method:'cash',amount_rub:600,
    completed_performer_id:'master-B'}}),h=fixture([item]);
  h.state.reportCanViewTeam=true;h.state.reportPerformerFilter='master-B';
  h.state.bookingAnalyticsScope={...range,performer:'master-B'};
  assert.deepEqual(ids(h.context.reportBookings(range)),['completed-by-B']);
  assert.equal(h.context.reportExportData().debt,400,'A visible report debt is backed by this completed visit');
  assert.deepEqual(ids(h.context.applyBookingQuery([item])),['completed-by-B'],
    'Assigned A / completed B must not disappear when drilling into B report debt');
});
