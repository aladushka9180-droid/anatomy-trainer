import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

const fixtureGlobal={Intl,Date,Element:class{}};
vm.runInNewContext(readFileSync(fileURLToPath(new URL('../finance-center.js',import.meta.url)),'utf8'),fixtureGlobal);
vm.runInNewContext(readFileSync(fileURLToPath(new URL('../finance-center-provider.js',import.meta.url)),'utf8'),fixtureGlobal);
const {normalizeDashboard,receiptSeries}=fixtureGlobal.MinutaFinanceCenter;
const fixture=(rows,bounds={start:'2026-10-01',end:'2026-10-03'},extra={})=>normalizeDashboard({
  available:true,financeEnabled:true,dateBasis:'operations',bounds,
  summary:{receivedMinor:rows.reduce((sum,row)=>sum+row.receivedMinor,0)},movement:rows,...extra
});
const day=(key,receivedMinor)=>({key,receivedMinor,expenseMinor:0});
const amounts=data=>Array.from(receiptSeries(data).points,point=>point.receivedMinor);

assert.deepEqual(amounts(fixture([day('2026-10-02',350000)])),[0,350000,0],'confirmed missing days are zero, with the same net total as the headline');
assert.deepEqual(amounts(fixture([day('2026-10-02',-50000)])),[0,-50000,0],'refund-only day remains below zero');
assert.deepEqual(amounts(fixture([day('2026-10-01',50000),day('2026-10-02',-50000)])),[50000,-50000,0],'a zero overall amount does not erase nonzero daily movements');
const empty=receiptSeries(fixture([]));assert.equal(empty.known,true);assert.deepEqual(Array.from(empty.points,point=>point.receivedMinor),[0,0,0]);
assert.equal(receiptSeries(fixture([],{start:'2026-10-01',end:'2026-10-03'},{cashProjectionUnavailable:true})).known,false);
assert.equal(receiptSeries(fixture([],{start:'2026-10-01',end:'2026-10-03'},{dateBasis:'visits_and_operations'})).known,false,'visit marks never become a cash chart');
assert.equal(receiptSeries(fixture([day('2026-10-02',200000)],undefined,{summary:{receivedMinor:350000}})).known,false,'incomplete daily series cannot claim the headline total');
assert.equal(receiptSeries(fixture([day('2026-09-30',300000)])).known,false,'foreign period is rejected');
const september=fixture([day('2026-09-30',300000)],{start:'2026-09-01',end:'2026-09-30'});
assert.equal(amounts(september).at(-1),300000);assert.equal(amounts(fixture([day('2026-10-02',200000)])).reduce((a,b)=>a+b),200000,'visit in another month does not move the advance');
const weekly=receiptSeries(fixture([day('2026-10-01',300000),day('2026-10-02',-50000)],{start:'2026-07-01',end:'2026-10-03'}));
assert.equal(weekly.grain,'week');assert.equal(weekly.points.reduce((sum,point)=>sum+point.receivedMinor,0),250000);assert.ok(weekly.points.length<16);
const monthly=receiptSeries(fixture([day('2025-12-31',123),day('2026-10-02',200000)],{start:'2025-01-12',end:'2026-10-03'}));
assert.equal(monthly.grain,'month');assert.equal(monthly.points[0].start,'2025-01-12');assert.equal(monthly.points.at(-1).end,'2026-10-03');assert.equal(monthly.points.reduce((sum,point)=>sum+point.receivedMinor,0),200123);
assert.equal(receiptSeries(fixture([],{start:'2026-02-30',end:'2026-03-05'})).known,false,'invalid dates are not silently normalized');
assert.equal(receiptSeries(fixture([day('2026-10-02',350000)],undefined,{completeness:{partial:true}})).known,true,'missing visit marks do not invalidate confirmed cash');
// The acceptance example uses the actual cash classifier before charting it.
const posting=amount=>({side:amount<0 ? 'credit' : 'debit',amount_minor:Math.abs(amount),financial_accounts:{account_class:'asset',account_type:'cash'}});
const operation=(id,type,occurred_at,amount,source_id='')=>({id,operation_type:type,occurred_at,source_id,financial_postings:[posting(amount)]});
const journal=[operation('advance','visit_service','2026-09-30T09:00:00Z',300000),
  operation('partial','visit_service','2026-10-02T09:00:00Z',200000),
  operation('sale','commercial_sale','2026-10-02T10:00:00Z',200000),
  operation('refund','commercial_refund','2026-10-02T11:00:00Z',-50000),
  operation('rent','supplier_expense_payment','2026-10-01T09:00:00Z',-1800000,'rent-source')];
const scope={bounds:{start:'2026-10-01',end:'2026-10-03'},timezone:'Europe/Samara',expenses:[{expense_source_id:'rent-source',category_id:'rent',category_name_snapshot:'Аренда'}]};
const projected=fixtureGlobal.MinutaFinanceProvider.projectCashLedger(journal,scope);
assert.equal(projected.classified,true);assert.equal(projected.receivedMinor,350000);assert.equal(projected.expenseMinor,1800000);
assert.equal(projected.categories.find(row=>row.id==='rent').amountMinor,1800000,'rent belongs to expenses once');
assert.deepEqual(amounts(fixture(projected.movement,scope.bounds,{summary:projected})),[0,350000,0]);
const advance=fixtureGlobal.MinutaFinanceProvider.projectCashLedger(journal,{...scope,bounds:{start:'2026-09-01',end:'2026-09-30'}});
assert.equal(advance.receivedMinor,300000,'October visit does not move the September receipt');
const goods=fixtureGlobal.MinutaFinanceProvider.projectGoodsSales([{id:'sale',occurred_at:'2026-10-02T10:00:00Z',commercial_sale_lines:[{item_kind:'inventory_item',quantity:2,total_minor:200000}]}],scope);
assert.equal(goods.known,true);assert.equal(goods.quantity,2);assert.equal(goods.amountMinor,200000);
console.log('PASS: dashboard cash series, periods, refunds, empty/partial data and explicit grouping');
