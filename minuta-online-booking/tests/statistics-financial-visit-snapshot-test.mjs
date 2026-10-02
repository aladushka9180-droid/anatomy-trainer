import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(resolve(root, file), 'utf8');
const context = { console, Date, Intl, Map, Set };
context.globalThis = context; context.window = context;
vm.createContext(context);
vm.runInContext(read('report-reconciliation.js'), context);
vm.runInContext(read('finance-center.js'), context);
const bindings = read('statistics-audit-provider.js');
const source = bindings.slice(bindings.indexOf('  function reportVisitSnapshot('), bindings.indexOf('  function refreshFinancialOverview('));
assert.ok(source.includes('function reportVisitSnapshot('), 'shared visit snapshot is required');
const ORG = 'organization', MASTER = 'master', OTHER = 'other';
const rows = [
  { id:'october', organization_id:ORG, performer_id:MASTER, booking_date:'2026-10-02', booking_time:'10:00', status:'confirmed', services:{name:'Услуга',price_rub:5800}, value:5800, booking_outcomes:{visit_status:'completed',payment_method:'card',amount_rub:2000} },
  { id:'imported', organization_id:ORG, performer_id:MASTER, booking_date:'2026-09-03', status:'confirmed', is_imported_history:true, services:{name:'История',price_rub:3000}, value:3000, booking_outcomes:{visit_status:'completed',payment_method:'imported',amount_rub:0} },
  { id:'other', organization_id:ORG, performer_id:OTHER, booking_date:'2026-10-02', status:'confirmed', value:9000, booking_outcomes:{visit_status:'completed',payment_method:'cash',amount_rub:9000} },
  { id:'cancelled', organization_id:ORG, performer_id:MASTER, booking_date:'2026-10-02', status:'cancelled', value:9999, booking_outcomes:{visit_status:'completed'} },
  { id:'foreign', organization_id:'foreign', performer_id:MASTER, booking_date:'2026-10-02', status:'confirmed', value:9999, booking_outcomes:{visit_status:'completed'} }
];
let bounds = {start:'2026-09-03',end:'2026-10-02',period:'last30'};
Object.assign(context, {
  reportDataSource:'own', reportPerformerFilter:MASTER,
  reportScopedBookingsState:{status:'ready',key:`1:actor:${ORG}:2026-08-04:2026-11-01:${MASTER}`},
  reportUsesScopedBookings:()=>true, reportOrganizationId:()=>ORG,
  financialContext:()=> 'context', reportPerformerName:()=> 'Сотрудник',
  reportSessionKey:(org,...parts)=>[1,'actor',org,...parts].join(':'),
  reportRange:()=>bounds, bookingOutcome:row=>row.booking_outcomes,
  reportServiceValue:row=>row.value,
  reportReceivedAmount:row=>context.MinutaReportReconciliation.amounts(row,row.booking_outcomes,row.value).received,
  reportCompletedItems:items=>items.filter(row=>context.MinutaReportReconciliation.completed(row,row.booking_outcomes)),
  reportBookings:scope=>rows.filter(row=>row.organization_id===ORG && row.booking_date>=scope.start && row.booking_date<=scope.end && (context.reportPerformerFilter==='all'||row.performer_id===context.reportPerformerFilter))
});
vm.runInContext(source, context);
const scope = () => ({bounds:{start:bounds.start,end:bounds.end},organizationId:ORG,masterId:context.reportPerformerFilter==='all'?'':context.reportPerformerFilter,contextToken:'context'});
const snapshot = () => context.reportVisitSnapshot(scope());
const rpcModel = () => context.MinutaFinanceCenter.normalizeDashboard({
  available:true,financeEnabled:true,dateBasis:'operations',organizationId:ORG,contextToken:'context',bounds:{start:bounds.start,end:bounds.end},
  summary:{receivedMinor:150000,expenseMinor:1200000,serviceMinor:0,totalVisits:37,paymentKnownVisits:17,unpostedVisits:17,serviceValueUnknownVisits:1},
  filters:{selectedMaster:scope().masterId}
});
const merge = (model, visits) => context.MinutaFinanceCenter.mergeVisitSnapshot(model, visits);
let visits = snapshot(), result = merge(rpcModel(),visits);
assert.equal(visits.known,true);
assert.equal(result.summary.serviceMinor,880000,'service value includes the same imported visit as Overview');
assert.equal(result.summary.totalVisits,2);
assert.equal(result.summary.paymentKnownVisits,1);
assert.equal(result.visits.rows.filter(row=>!row.paymentKnown).length,1,'warning and detail list share one snapshot');
assert.equal(result.summary.receivedMinor,150000,'partial payment minus refund stays on operation dates');
assert.equal(result.summary.expenseMinor,1200000,'rent is not deducted a second time');
assert.equal(result.summary.netMinor,-1050000,'cash result remains exact');
assert.equal(result.summary.unpostedVisits,0,'RPC qualification count cannot be labelled missing visit payment');
assert.equal(result.summary.serviceValueUnknownVisits,0,'regular price fallback is valid service value');

bounds = {start:'2026-10-01',end:'2026-10-02',period:'month'};
result = merge(rpcModel(),snapshot());
assert.equal(result.summary.serviceMinor,580000,'October services match Overview even when RPC calculated value is zero');
assert.equal(result.summary.totalVisits,1);
assert.equal(result.visits.rows[0].paymentMinor,200000,'partial payment is not replaced by the service price');
assert.equal(result.summary.receivedMinor,150000,'cash totals never come from visit marks');
rows.push({id:'no-price',organization_id:ORG,performer_id:MASTER,booking_date:'2026-10-02',status:'confirmed',value:0,booking_outcomes:{visit_status:'completed',payment_method:'unpaid',amount_rub:0}});
const partial=merge(rpcModel(),snapshot());
assert.equal(partial.summary.serviceMinor,580000,'known service value remains visible');
assert.equal(partial.summary.serviceValueUnknownVisits,1,'missing service price is not a free service');
rows.pop();
const stale = {...snapshot(),contextToken:'previous-actor'};
assert.equal(merge(rpcModel(),stale).visits,null,'stale actor snapshot must not replace current scope');
assert.equal(merge(rpcModel(),{...snapshot(),masterId:OTHER}).visits,null,'other employee is rejected');
assert.equal(merge(rpcModel(),{...snapshot(),organizationId:'foreign'}).visits,null,'other organization is rejected');

context.reportScopedBookingsState.status='loading';
assert.equal(snapshot().known,false,'partial visit read is not a full snapshot');
assert.equal(merge(rpcModel(),snapshot()).visits.known,false);
context.reportScopedBookingsState.status='ready';
context.reportScopedBookingsState.key=`0:old-actor:${ORG}:2026-08-04:2026-11-01:${MASTER}`;
assert.equal(snapshot().known,false,'old actor rows are rejected');
context.reportScopedBookingsState.key=`1:actor:${ORG}:2026-09-01:2026-09-30:${MASTER}`;
assert.equal(snapshot().known,false,'old ready period does not cover the selected visit dates');
context.reportScopedBookingsState.key=`1:actor:${ORG}:2026-08-04:2026-11-01:${MASTER}`;
context.reportDataSource='demo';
assert.equal(snapshot(),null,'demo never merges into the real financial ledger');
context.reportDataSource='own';
bounds = {start:'2026-08-01',end:'2026-08-02',period:'custom'};
context.reportScopedBookingsState.key=`1:actor:${ORG}:2026-07-01:2026-09-01:${MASTER}`;
result = merge(rpcModel(),snapshot());
assert.equal(result.summary.serviceMinor,0,'complete empty visits are zero');
assert.equal(result.summary.totalVisits,0);
assert.equal(result.visits.known,true);
console.log('Shared visit value, warning rows, imported history, partial payment, scope, stale actor, demo and empty period passed.');
