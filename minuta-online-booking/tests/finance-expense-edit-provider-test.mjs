import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const context=vm.createContext({console,Date,Intl,Map,Set,Promise,Number,structuredClone});
vm.runInContext(readFileSync(new URL('../finance-center-provider.js',import.meta.url),'utf8'),context);
const api=context.MinutaFinanceProvider;
const cash=(amount)=>({side:amount<0?'credit':'debit',amount_minor:Math.abs(amount),financial_accounts:{account_class:'asset',account_type:'cash'}});
const old={id:'old-payment',source_id:'old-source',operation_type:'supplier_expense_payment',occurred_at:'2026-10-03T08:00:00Z',financial_postings:[cash(-1800000)]};
const cancel={id:'reversal',reversal_of:old.id,operation_type:'reversal',occurred_at:'2026-09-22T08:00:00Z',financial_postings:[cash(1800000)]};
const replacement={id:'new-payment',source_id:'new-source',operation_type:'supplier_expense_payment',occurred_at:'2026-10-01T08:00:00Z',financial_postings:[cash(-1250075)]};
const options={timezone:'Europe/Samara',expenses:[
  {id:'old-expense',expense_source_id:'old-source',category_id:'rent',category_name_snapshot:'Аренда',occurred_at:'2026-09-22T08:00:00Z'},
  {id:'new-expense',expense_source_id:'new-source',category_id:'materials',category_name_snapshot:'Материалы',occurred_at:'2026-10-01T08:00:00Z'}]};
const before=api.projectCashLedger([old],{...options,bounds:{start:'2026-09-01',end:'2026-09-30'}});
assert.equal(before.expenseMinor,1800000,'the saved business date, not later recording day, determines the expense period');
assert.equal(before.operations[0].manualExpenseId,'old-expense');
const september=api.projectCashLedger([old,cancel,replacement],{...options,bounds:{start:'2026-09-01',end:'2026-09-30'}});
const october=api.projectCashLedger([old,cancel,replacement],{...options,bounds:{start:'2026-10-01',end:'2026-10-31'}});
assert.equal(september.expenseMinor,0);assert.equal(october.expenseMinor,1250075);
assert.equal(september.operations.find(row=>row.id===old.id).manualExpenseId,'','corrected rows have no edit button');
assert.equal(october.operations[0].manualExpenseId,'new-expense');
assert.equal(api.projectCashLedger([{...cancel,occurred_at:'2026-10-03T08:00:00Z'}],{...options,originals:[old],bounds:{start:'2026-10-01',end:'2026-10-31'}}).expenseMinor,-1800000,'ordinary reversals retain their actual date');

const org='11111111-1111-4111-8111-111111111111',category='22222222-2222-4222-8222-222222222222',account='33333333-3333-4333-8333-333333333333',expense='44444444-4444-4444-8444-444444444444';
const calls=[],queries=[];let adapter,capability=true,writes=true,blockRead=null,blockWrite=null;
const manual={...options.expenses[0],id:expense,category_id:category,payment_transaction_id:old.id,organization_id:org};
const tables={financial_transactions:[{...old,organization_id:org}],financial_manual_expenses_v163:[manual],commercial_sales:[],financial_debt_settlement_sources:[]};
const db={rpc:async(name,args)=>{
  calls.push({name,args:structuredClone(args)});
  if(name==='get_minuta_manual_expense_edit_status_v193')return capability?{data:{schema:'manual-expense-edit-v1',version:193}}:{error:{code:'PGRST202'}};
  if(name==='get_minuta_manual_expense_for_edit_v193'){
    if(blockRead)await blockRead;
    return{data:{id:expense,category_id:category,payment_account_id:account,amount_minor:1800000,occurred_on:'2026-09-22',source_label:'Аренда',title:'Аренда: Кабинет',performer_id:'55555555-5555-4555-8555-555555555555'}};
  }
  if(name==='edit_minuta_manual_expense_v193'){if(blockWrite)await blockWrite;return{data:{id:'replacement'}};}
  return{data:{schema:'minuta-finance-screen-v1',ledger_version:163,organization_id:org,currency:'RUB',finance_enabled:true,timezone:'Europe/Samara',period:{start:args.p_start,end:args.p_end},selected_performer_id:args.p_performer,
    summary:{received_minor:0,expense_minor:1800000,services_minor:0,debt_minor:0},confidence:{is_complete:true},categories:[{id:category,name:'Аренда',active:true}],accounts:[{id:account,name:'Касса'}],operations:[]}};
},from(table){const predicates=[],q={select(){return q},eq(k,v){predicates.push(row=>row[k]===v);return q},gte(k,v){predicates.push(row=>row[k]>=v);return q},lt(k,v){predicates.push(row=>row[k]<v);return q},in(k,v){predicates.push(row=>v.includes(row[k]));return q},order(){return q},async range(a,b){queries.push(table);return{data:(tables[table]||[]).filter(row=>predicates.every(f=>f(row))).slice(a,b+1)}}};return q;}};
const panel={classList:{add(){},remove(){}},dataset:{reportTab:'money'}},root={closest:()=>panel};
context.MinutaFinanceCenter={init(options){adapter=options.adapter;return{ready:Promise.resolve(),reload:()=>Promise.resolve()}},destroy(){}};
const controller=api.createController({db,$:selector=>selector==='#financeCenterRoot'?root:null,requireWrites:()=>writes});
controller.setOrganization({id:org,current_role:'owner'});await controller.load({start:'2026-09-01',end:'2026-09-30',period:'custom'});
const dashboard=await adapter.readDashboard({period:'custom'});
assert.equal(dashboard.permissions.canEditExpense,true);assert.equal(dashboard.summary.expenseMinor,1800000,'lookup includes old payment outside the selected business-date range');
assert.equal(dashboard.operations[0].manualExpenseId,expense);
const opened=await adapter.readExpense(expense);assert.equal(opened.note,'Кабинет');assert.equal(opened.performerId,'55555555-5555-4555-8555-555555555555');
const payload={expenseId:expense,categoryId:category,paymentAccountId:account,amountMinor:1700000,occurredOn:'2026-09-23',note:'Кабинет',performerId:opened.performerId,requestId:'66666666-6666-4666-8666-666666666666',preserveTitle:true,originalTitle:opened.title,originalSourceLabel:opened.sourceLabel};
await adapter.updateExpense(payload);const sent=calls.at(-1);
assert.equal(sent.name,'edit_minuta_manual_expense_v193');assert.equal(sent.args.p_organization,org);assert.equal(sent.args.p_expense,expense);assert.equal(sent.args.p_title,'Аренда: Кабинет');assert.equal(sent.args.p_performer,opened.performerId);
writes=false;const previous=calls.length;await assert.rejects(()=>adapter.updateExpense(payload),/недоступны/);assert.equal(calls.length,previous,'write gate prevents RPC');
writes=true;controller.setOrganization({id:org,current_role:'specialist'});await assert.rejects(()=>adapter.updateExpense(payload),/недоступны/);assert.equal(calls.length,previous,'role change prevents RPC');
capability=false;controller.setOrganization({id:org,current_role:'owner'});await controller.load({start:'2026-09-01',end:'2026-09-30',period:'custom'});
assert.equal((await adapter.readDashboard({period:'custom'})).permissions.canEditExpense,false);await assert.rejects(()=>adapter.readExpense(expense),/unavailable/);
capability=true;controller.setOrganization(null);controller.setOrganization({id:org,current_role:'owner'});
await controller.load({start:'2026-09-01',end:'2026-09-30',period:'custom'});
await adapter.readDashboard({period:'custom'});
let releaseRead;blockRead=new Promise(resolve=>{releaseRead=resolve;});
const staleRead=assert.rejects(()=>adapter.readExpense(expense),error=>error.name==='AbortError');
controller.setOrganization({id:'77777777-7777-4777-8777-777777777777',current_role:'owner'});
releaseRead();await staleRead;blockRead=null;
controller.setOrganization({id:org,current_role:'owner'});
await controller.load({start:'2026-09-01',end:'2026-09-30',period:'custom'});
await adapter.readDashboard({period:'custom'});
let releaseWrite;blockWrite=new Promise(resolve=>{releaseWrite=resolve;});
const staleWrite=assert.rejects(()=>adapter.updateExpense(payload),error=>error.name==='AbortError');
controller.setOrganization({id:org,current_role:'specialist'});
releaseWrite();await staleWrite;blockWrite=null;
console.log('Expense edit provider: business-date correction, paginated old-payment lookup, exact RPC/prefill/performer, role/write/capability and delayed context gates PASS.');
