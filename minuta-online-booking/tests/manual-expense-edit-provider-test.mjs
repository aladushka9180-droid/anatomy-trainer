import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const org='11111111-1111-4111-8111-111111111111', category='22222222-2222-4222-8222-222222222222';
const account='33333333-3333-4333-8333-333333333333', expense='44444444-4444-4444-8444-444444444444';
const request='55555555-5555-4555-8555-555555555555', bounds={start:'2026-09-01',end:'2026-09-30'};
const source=readFileSync(new URL('../finance-center-provider.js',import.meta.url),'utf8');
const context=vm.createContext({console,Intl,Date,Map,Set});
vm.runInContext(source,context);
const api=context.MinutaFinanceProvider;
const payment={id:'payment',source_id:'source',operation_type:'supplier_expense_payment',occurred_at:'2026-09-22T08:00:00Z',
  financial_postings:[{account_id:account,side:'credit',amount_minor:1800000,financial_accounts:{account_class:'asset',account_type:'cash'}}]};
const manual={id:expense,expense_source_id:'source',category_id:category,category_name_snapshot:'Аренда',title:'Аренда: Сентябрь',amount_minor:1800000,performer_id:'original-performer'};
const project=rows=>api.projectCashLedger(rows,{bounds,timezone:'Europe/Samara',organizationId:org,expenses:[manual]});
const metadata=project([payment]).operations[0].manualExpense;
assert.equal(metadata.id,expense);assert.equal(metadata.organizationId,org);assert.equal(metadata.paymentAccountId,account);
assert.equal(metadata.occurredOn,'2026-09-22');assert.equal(metadata.note,'Сентябрь');assert.equal(metadata.performerId,'original-performer');
const fullNote='а'.repeat(160);
assert.equal(project([{...payment,explanation:{manual_expense_note:fullNote}}]).operations[0].manualExpense.note,fullNote,'full note survives a shortened display title');
const reversal={id:'reversal',operation_type:'reversal',reversal_of:'payment',occurred_at:payment.occurred_at,
  financial_postings:[{...payment.financial_postings[0],side:'debit'}]};
assert.ok(project([payment,reversal]).operations.every(row=>!row.manualExpense),'corrected history has no edit action');
assert.equal(project([{...payment,operation_type:'payroll_payment'}]).operations[0].manualExpense,null,'payroll is not a manual expense');

const calls=[];let capabilityAvailable=false,writes=true,adapter;
const raw=args=>({schema:'minuta-finance-screen-v1',ledger_version:163,organization_id:org,currency:'RUB',timezone:'Europe/Samara',finance_enabled:true,
  period:{start:args.p_start,end:args.p_end,bucket_grain:'day'},selected_performer_id:null,
  summary:{received_minor:0,expense_minor:1800000,services_minor:0,debt_minor:0},confidence:{is_complete:true,result_reliable:true},
  accounts:[{id:account,name:'Касса'}],categories:[{id:category,name:'Аренда',active:true,system_key:'rent'}],operations:[],series:[],expense_structure:[]});
const db={rpc:async(name,args)=>{
  calls.push({name,args});
  if(name==='get_minuta_finance_screen_v163')return {data:raw(args),error:null};
  if(name==='get_minuta_manual_expense_edit_capabilities_v1')return capabilityAvailable
    ?{data:{schema:'minuta-manual-expense-edit-v1',can_edit:true},error:null}:{data:null,error:{code:'PGRST202',message:'missing RPC'}};
  if(name==='edit_minuta_manual_expense_v1')return {data:{id:expense},error:null};
  throw new Error('unexpected RPC');
}};
const analytics={dataset:{reportTab:'overview'},classList:{add(){},remove(){}}};
const root={closest:()=>analytics,hidden:false};
context.MinutaFinanceCenter={init:options=>{
  adapter=options.adapter;return {ready:adapter.readDashboard({period:'custom'}),reload:()=>adapter.readDashboard({period:'custom'})};
},destroy(){}};
const controller=api.createController({db,$:selector=>selector==='#financeCenterRoot'?root:null,requireWrites:()=>writes});
controller.setOrganization({id:org,current_role:'owner'});
await controller.load({...bounds,period:'custom'});
assert.equal((await adapter.readDashboard({period:'custom'})).permissions.canEditExpense,false,'missing backend keeps edit hidden');
capabilityAvailable=true;
assert.equal((await adapter.readDashboard({period:'custom'})).permissions.canEditExpense,true,'reload recovers backend capability');
const payload={organizationId:org,expenseId:expense,categoryId:category,paymentAccountId:account,amountMinor:2000000,occurredOn:'2026-09-23',note:'Исправлено',requestId:request,performerId:'forged-performer'};
await adapter.updateExpense(payload);
const edit=calls.find(row=>row.name==='edit_minuta_manual_expense_v1');
assert.equal(edit.args.p_expense,expense);assert.equal(edit.args.p_request_id,request);assert.equal(edit.args.p_organization,org);
assert.equal(edit.args.p_amount_minor,2000000);assert.equal(edit.args.p_occurred_on,'2026-09-23');
assert.ok(!Object.hasOwn(edit.args,'p_performer'),'the server preserves the original performer');
const editCount=()=>calls.filter(row=>row.name==='edit_minuta_manual_expense_v1').length;
const count=editCount();
await assert.rejects(adapter.updateExpense({...payload,organizationId:'another-org'}));
writes=false;await assert.rejects(adapter.updateExpense(payload));writes=true;
controller.setOrganization({id:org,current_role:'specialist'});
await assert.rejects(adapter.updateExpense(payload));
assert.equal(editCount(),count,'foreign organization, read-only mode and specialist cannot reach edit RPC');
console.log('manual-expense-edit provider PASS: manual metadata, reversal/payroll exclusion, backend capability recovery, original performer, organization/role/write guards');
