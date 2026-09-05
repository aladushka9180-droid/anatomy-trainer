import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// Actual report computations; synthetic bookings and transport-free boundaries.
// These are report contracts, not proof of bank settlements or production data.
const source=readFileSync(process.env.MINUTA_PROVIDER_SOURCE || new URL('../provider.js',import.meta.url),'utf8').replaceAll('\r\n','\n');
const reconciliation=readFileSync(new URL('../report-reconciliation.js',import.meta.url),'utf8');
function declaration(name){
  const start=source.search(new RegExp(`^(?:async )?function ${name}\\(`,'m'));
  assert.ok(start>=0, name);
  const lineEnd=source.indexOf('\n',start),end=source.slice(start,lineEnd).endsWith('}')?lineEnd:source.indexOf('\n}',start)+2;
  return source.slice(start,end);
}
const names=['reportBookings','reportCompletedItems','reportRevenue','reportClientIdentity','reportClientMetrics','reportExportData','reportExportVisit','reportSessionKey','reportDataQueryRange','reportExportPerformers','reportExportMaster','reportExportCreator','applyBookingQuery'];
// New shared report helpers are loaded verbatim when implemented, not stubbed.
const optional=['reportImportedValue','reportReceivedAmount','reportDebtAmount','reportServiceValue','reportReconciledTeamRows','reportEffectivePerformerId','reportCurrentTeamRows'];
const actual=[...optional.filter(name=>source.includes(`function ${name}(`)),...names].map(declaration).join('\n');
const range={start:'2026-09-01',end:'2026-09-30',period:'month'};
function booking(id, overrides={}){
  return {id,booking_date:'2026-09-10',booking_time:'10:00:00',duration_minutes:60,performer_id:'master-A',organization_id:'org-A',client_name:'Клиент',client_phone:'79990000000',status:'confirmed',value:1000,
    booking_outcomes:{visit_status:'completed',payment_method:'cash',amount_rub:600},...overrides};
}
function fixture(items=[],imports=[],team=[]){
  const state={allBookings:items,importedBookingHistory:imports,reportDataSource:'own',reportCanViewTeam:false,reportPerformerFilter:'all',
    sessionGeneration:1,reportPeriod:'month',reportScopedBookingsState:{status:'ready',rows:items},reportTeamAnalyticsState:{status:'ready',key:'1:master-A:org-A:2026-09-01:2026-09-30',rows:team},reportEventState:{rows:[]},
    currentUser:{id:'master-A'},reportRange:()=>range,reportUsesScopedBookings:()=>false,reportOrganizationId:()=> 'org-A',
    isScheduleBlock:item=>Boolean(item.is_schedule_block),bookingOutcome:item=>item.booking_outcomes,
    normalizePhone:value=>String(value||'').replace(/\D/g,''),parseLocalIsoDate:value=>new Date(`${value}T00:00:00Z`),
    reportExportValue:item=>item.value,bookingCalculatedValue:item=>item.value,bookingSessionTotal:item=>item.value,reportExportDuration:item=>item.duration_minutes,
    reportSourceMetrics:()=>({online:0,manual:0,unknown:0}),reportExportPerformers:()=>new Map(team.map(row=>[row.performer_id,row.performer_name])),
    reportExportDate:value=>value,reportExportEnd:()=> '11:00',reportExportPhone:value=>value,reportExportMaster:(item,names)=>names.get(item.performer_id)||'Мастер',
    bookingSession:()=>[{title:'Услуга'}],serviceName:value=>value,isPerMinuteBooking:()=>false,bookingMinuteRate:()=>0,
    paymentMethodLabel:value=>value,reportExportSource:()=> 'Мастер',reportExportCreator:()=> 'Мастер',bookingDisplayNote:()=>''};
  const context=vm.createContext(state);vm.runInContext(reconciliation+'\n'+actual,context);return {state,context};
}
test('control: completed cash, service value and debt reconcile',()=>{
  const {context}=fixture([booking('A')]),data=context.reportExportData();
  assert.equal(data.revenue,600);assert.equal(data.completedValue,1000);assert.equal(data.debt,400);
  assert.equal(data.rows[0][10],600);assert.equal(data.rows[0][11],400);
});
test('control: cancelled booking does not enter summary revenue',()=>{
  const {context}=fixture([booking('A',{status:'cancelled'})]);assert.equal(context.reportExportData().revenue,0);
});
test('demo report excludes the real imported journal',()=>{
  const {state,context}=fixture([], [booking('import',{is_imported_history:true})]);state.reportDataSource='demo';
  assert.equal(context.reportBookings(range).length,0);
});
test('cancelled completed outcome is exported as cancelled',()=>{
  const {context}=fixture();assert.equal(context.reportExportVisit(booking('A',{status:'cancelled'})),'Отменён');
});
test('cancelled and scheduled row amounts reconcile with the completed-only summary',()=>{
  const {context}=fixture([booking('A'),booking('B',{status:'cancelled'}),booking('C',{booking_outcomes:{visit_status:'scheduled',payment_method:'cash',amount_rub:300}})]);
  const data=context.reportExportData();assert.equal(data.rows.reduce((sum,row)=>sum+row[10],0),data.revenue);
  assert.equal(data.rows.reduce((sum,row)=>sum+row[11],0),data.debt);
});
test('client export totals are for the selected period, not lifetime',()=>{
  const {context}=fixture([booking('old',{booking_date:'2026-08-10'}),booking('A')]),data=context.reportExportData();
  assert.equal(data.clientRows.reduce((sum,row)=>sum+row[4],0),data.completed.length);
  assert.equal(data.clientRows.reduce((sum,row)=>sum+row[5],0),data.revenue);
});
test('client export includes imported completed visits in the selected period',()=>{
  const {context}=fixture([], [booking('import',{is_imported_history:true,booking_outcomes:{visit_status:'completed',payment_method:'imported',amount_rub:1000}})]);
  const data=context.reportExportData();assert.equal(data.clientRows.reduce((sum,row)=>sum+row[4],0),data.completed.length);
});
test('team export reconciles with detail, without recomputing server payroll',()=>{
  const {context}=fixture([booking('A')],[],[{performer_id:'master-A',performer_name:'Мастер A',completed_visits:8,unique_clients:7,worked_minutes:480,revenue_rub:9000,payroll_rub:321}]);
  const data=context.reportExportData();assert.equal(data.team.reduce((sum,row)=>sum+row[4],0),data.revenue);
  assert.equal(data.team.reduce((sum,row)=>sum+row[1],0),data.completed.length);assert.equal(data.team[0][6],321);
});
test('proposed money contract: imported price remains service value, not evidenced payment or debt',()=>{
  const {context}=fixture([], [booking('import',{is_imported_history:true,booking_outcomes:{visit_status:'completed',payment_method:'imported',amount_rub:1000}})]);
  const data=context.reportExportData();assert.equal(data.completedValue,1000);assert.equal(data.revenue,0);assert.equal(data.debt,0);
});

test('mixed report separates 600 recorded payment, 1000 imported value and unknown payment coverage',()=>{
  const {context}=fixture([booking('A')],[booking('import',{is_imported_history:true,booking_outcomes:{visit_status:'completed',payment_method:'imported',amount_rub:1000}})]);
  const data=context.reportExportData();assert.equal(data.revenue,600);assert.equal(data.completedValue,2000);
  assert.equal(data.debt,400);assert.equal(data.importedValue,1000);assert.equal(data.unknownPaymentCount,1);
});
test('control: overpayment of another visit does not erase unpaid visit debt',()=>{
  const {context}=fixture([booking('over',{booking_outcomes:{visit_status:'completed',payment_method:'cash',amount_rub:2000}}),booking('unpaid',{client_phone:'79990000001',booking_outcomes:{visit_status:'completed',payment_method:'unpaid',amount_rub:0}})]);
  assert.equal(context.reportExportData().debt,1000);
});
test('stale team scope cannot supply payroll for another period',()=>{
  const {state,context}=fixture([booking('A')],[],[{performer_id:'master-A',performer_name:'Мастер A',completed_visits:1,revenue_rub:600,payroll_rub:321}]);
  state.reportTeamAnalyticsState.key='1:master-A:org-A:2026-08-01:2026-08-31';
  assert.equal(context.reportExportData().team[0][6],'Не рассчитано');
});
test('completed performer snapshot takes precedence, with assigned performer fallback',()=>{
  const {context}=fixture([booking('A',{booking_outcomes:{visit_status:'completed',payment_method:'cash',amount_rub:600,completed_performer_id:'master-B'}}),booking('B')],[],[{performer_id:'master-A',performer_name:'Мастер A',payroll_rub:0},{performer_id:'master-B',performer_name:'Мастер B',payroll_rub:0}]);
  const rows=context.reportExportData().team;
  assert.equal(rows.find(row=>row[0]==='Мастер B')?.[1],1);assert.equal(rows.find(row=>row[0]==='Мастер A')?.[1],1);
});
test('actual per-minute display and export valuation agree with actual duration fallback',()=>{
  const context=vm.createContext({bookingOutcome:item=>item.outcome,isPerMinuteBooking:()=>true,bookingSessionTotal:()=>600,bookingMinuteRate:()=>10,bookingSession:()=>[],bookingSessionDuration:()=>60});
  vm.runInContext(reconciliation+'\n'+['bookingCalculatedValue','reportExportDuration','reportExportValue',...optional.filter(name=>source.includes(`function ${name}(`))].map(declaration).join('\n'),context);
  const item={duration_minutes:60,outcome:{visit_status:'completed',actual_duration_minutes:30,calculated_amount_rub:0}};
  const displayed=context.reportServiceValue?context.reportServiceValue(item):context.bookingCalculatedValue(item);
  assert.equal(displayed,300);assert.equal(context.reportExportValue(item),300);
});

test('stale actor/org team snapshot cannot leak staff or creator names into export',()=>{
  for (const key of ['1:other:org-A:2026-09-01:2026-09-30','1:master-A:org-B:2026-09-01:2026-09-30']) {
    const {state,context}=fixture([booking('A',{created_by_user_id:'master-A',booking_source:'provider_manual'})],[],[{performer_id:'master-A',performer_name:'PRIVATE OLD ORG NAME',payroll_rub:321}]);
    state.reportTeamAnalyticsState.key=key;
    const data=context.reportExportData();
    assert.equal(data.rows[0][6],'Мастер');assert.equal(data.rows[0][15],'Мастер');
    assert.ok(!JSON.stringify(data).includes('PRIVATE OLD ORG NAME'));
    assert.equal(data.team[0][6],'Не рассчитано');
  }
});

test('actual analytics debt drilldown agrees with completed performer report scope',()=>{
  const items=[booking('A',{booking_outcomes:{visit_status:'completed',payment_method:'cash',amount_rub:600,completed_performer_id:'master-B'}}),booking('B')];
  const {state,context}=fixture(items);
  Object.assign(state,{reportCanViewTeam:true,reportPerformerFilter:'master-B',currentFilter:'all',bookingSearchQuery:'',bookingStatusFilter:'all',bookingSourceFilter:'all',bookingAnalyticsFilter:'debt',bookingAnalyticsScope:{...range,performer:'master-B'}});
  const expected=context.reportBookings(range).filter(item=>context.reportDebtAmount(item)>0).map(item=>item.id);
  assert.equal(expected.length,1);
  assert.deepEqual(Array.from(context.applyBookingQuery(items),item=>item.id),Array.from(expected));
});
