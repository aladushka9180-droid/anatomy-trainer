import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const context=vm.createContext({});
vm.runInContext(readFileSync(new URL('../report-reconciliation.js',import.meta.url),'utf8'),context);
const api=context.MinutaReportReconciliation;
const item={status:'confirmed',performer_id:'A'};
const paid={visit_status:'completed',payment_method:'cash',amount_rub:600};
const imported={visit_status:'completed',payment_method:'imported',amount_rub:1000,completion_source:'imported'};
test('recorded payment and debt remain separate from unknown historical payment',()=>{
  const live=api.amounts(item,paid,1000),history=api.amounts({...item,is_imported_history:true},imported,1000);
  assert.equal(live.received+history.received,600);assert.equal(live.serviceValue+history.serviceValue,2000);
  assert.equal(live.debt+history.debt,400);assert.equal(history.importedValue,1000);assert.equal(history.unknownPayment,true);
});
test('explicit payment evidence on historical item is not discarded',()=>{
  const result=api.amounts({...item,is_imported_history:true},paid,1000);
  assert.equal(result.received,600);assert.equal(result.unknownPayment,false);
});
test('cancelled and scheduled visits do not contribute completed-visit money',()=>{
  for(const [booking,outcome] of [[{...item,status:'cancelled'},paid],[item,{...paid,visit_status:'scheduled'}]]){
    const result=api.amounts(booking,outcome,1000);assert.equal(result.received,0);assert.equal(result.debt,0);
  }
});
test('overpayment does not offset another visit debt',()=>{
  const over=api.amounts(item,{...paid,amount_rub:2000},1000),debt=api.amounts(item,{...paid,amount_rub:0},1000);
  assert.equal(over.debt+debt.debt,1000);
});
test('per-minute value uses recorded calculation or actual duration, not planned session total',()=>{
  const values={perMinute:true,minuteRate:10,duration:30,sessionTotal:600};
  assert.equal(api.serviceValue({...values,calculatedAmount:0}),300);
  assert.equal(api.serviceValue({...values,calculatedAmount:350}),350);
  assert.equal(api.serviceValue({...values,perMinute:false}),600);
});
test('non-finite and negative values cannot poison report totals',()=>{
  assert.equal(api.amounts(item,{...paid,amount_rub:Infinity},NaN).received,0);
  assert.equal(api.amounts(item,{...paid,amount_rub:-10},100).debt,100);
});
test('effective performer snapshot and assignment fallback are preserved',()=>{
  assert.equal(api.effectivePerformerId(item,{...paid,completed_performer_id:'B'}),'B');
  assert.equal(api.effectivePerformerId(item,paid),'A');
});
const options={outcomeFor:i=>i.outcome,valueFor:()=>1000,durationFor:()=>30,clientIdentityFor:i=>i.client,
  expectedTeamKey:'7:actor:org:2026-09-01:2026-09-30',teamState:{status:'ready',key:'7:actor:org:2026-09-01:2026-09-30',rows:[{performer_id:'A',performer_name:'Мастер A',payroll_rub:321},{performer_id:'B',performer_name:'Мастер B',payroll_rub:222}]}};
test('team derives visits and revenue from detail while preserving current server salary',()=>{
  const rows=api.teamRows([{...item,client:'C',outcome:{...paid,completed_performer_id:'B'}},{...item,client:'D',outcome:paid}],options);
  assert.equal(rows.reduce((sum,row)=>sum+row.revenue_rub,0),1200);
  assert.equal(rows.find(row=>row.performer_id==='B').completed_visits,1);
  assert.equal(rows.find(row=>row.performer_id==='A').payroll_rub,321);
});
test('stale salary and staff labels never enter a new report',()=>{
  const rows=api.teamRows([{...item,client:'C',outcome:paid}],{...options,expectedTeamKey:'7:actor:org:2026-08-01:2026-08-31'});
  assert.equal(rows.length,1);assert.equal(rows[0].payroll_rub,null);assert.equal(rows[0].performer_name,'Мастер');
});
