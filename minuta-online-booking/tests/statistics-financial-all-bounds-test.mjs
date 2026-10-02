import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(resolve(root, file), 'utf8');
const provider = read('provider.js'), bindings = read('statistics-audit-provider.js');
const rangeSource = provider.slice(provider.indexOf('function reportRange('), provider.indexOf('\nfunction reportDataQueryRange'));
const overviewSource = bindings.slice(bindings.indexOf('  function refreshFinancialOverview()'), bindings.indexOf('\n  function refreshReportUtmPresentation()'));
assert.ok(rangeSource.includes("period === 'all'"));
assert.ok(overviewSource.includes('financeController?.load(selected'));
const ORG='11111111-1111-4111-8111-111111111111', OTHER='22222222-2222-4222-8222-222222222222';
const MASTER='33333333-3333-4333-8333-333333333333', PEER='44444444-4444-4444-8444-444444444444';
const TODAY='2026-10-02';
const transaction=(id,day,operation_type,amount,source_id=id,organization_id=ORG)=>({id,organization_id,occurred_at:day,operation_type,source_id,financial_postings:[{side:amount>0?'debit':'credit',amount_minor:Math.abs(amount),financial_accounts:{account_class:'asset',account_type:'cash'}}]});
const sale=(id,day,seller_id=MASTER,organization_id=ORG)=>({id,organization_id,seller_id,occurred_at:day,commercial_sale_lines:[{item_kind:'inventory_item',item_name:'Синтетический товар',quantity:2,total_minor:5000}]});
const booking=day=>({id:'visit',organization_id:ORG,performer_id:MASTER,booking_date:day});

function fixture({tables={},timezone='Europe/Samara',period='all',master='all',role='owner',failure='',rpcFailure='',invalidTimezone=false,deferEarliest=false}={}) {
  const calls=[],queries=[],models=[],errors=[];
  let release, started;
  const blocked=new Promise(resolve=>{release=resolve}), entered=new Promise(resolve=>{started=resolve});
  class Query {
    constructor(table){this.table=table;this.filters=[];this.orders=[];this.first=0;this.last=Infinity;this.columns='';}
    select(columns){this.columns=columns;return this;}
    eq(k,v){this.filters.push(['eq',k,v]);return this;}
    neq(k,v){this.filters.push(['neq',k,v]);return this;}
    gte(k,v){this.filters.push(['gte',k,v]);return this;}
    lt(k,v){this.filters.push(['lt',k,v]);return this;}
    lte(k,v){this.filters.push(['lte',k,v]);return this;}
    in(k,v){this.filters.push(['in',k,v]);return this;}
    order(k,{ascending=true}={}){this.orders.push([k,ascending]);return this;}
    limit(n){this.last=n-1;this.earliest=true;return this;}
    range(first,last){this.first=first;this.last=last;return this;}
    async execute(){
      queries.push({table:this.table,filters:this.filters,orders:this.orders,columns:this.columns,earliest:Boolean(this.earliest)});
      if(this.earliest&&deferEarliest&&this.table==='financial_transactions'){started();await blocked;}
      if(this.earliest&&this.table===failure)return {data:null,error:{message:'synthetic source unavailable'}};
      const filter=(row,[op,k,v])=>op==='eq'?row[k]===v:op==='neq'?row[k]!==v:op==='gte'?row[k]>=v:op==='lt'?row[k]<v:op==='lte'?row[k]<=v:v.includes(row[k]);
      // Model the existing organization RLS separately from the explicit query.
      let rows=structuredClone(tables[this.table]||[]).filter(row=>row.organization_id===ORG).filter(row=>this.filters.every(f=>filter(row,f)));
      rows.sort((a,b)=>{for(const [k,ascending]of this.orders){const n=String(a[k]).localeCompare(String(b[k]));if(n)return ascending?n:-n;}return 0;});
      return {data:rows.slice(this.first,this.last+1),error:null};
    }
    then(resolve,reject){return this.execute().then(resolve,reject);}
  }
  const db={from:table=>new Query(table),rpc:async(name,args)=>{
    calls.push({name,args:structuredClone(args)});
    assert.equal(name,'get_minuta_finance_screen_v163','test must never write');
    if((rpcFailure==='metadata'&&args.p_start===args.p_end)||(rpcFailure==='range'&&args.p_start!==args.p_end))return {data:null,error:{message:'synthetic finance source unavailable'}};
    const days=(new Date(args.p_end)-new Date(args.p_start))/86400000;
    if(days>3661)return {data:null,error:{message:'invalid_finance_screen_request'}};
    return {error:null,data:{schema:'minuta-finance-screen-v1',ledger_version:163,organization_id:args.p_organization,currency:'RUB',timezone:invalidTimezone==='missing'?undefined:invalidTimezone?'invalid/timezone':timezone,finance_enabled:true,
      period:{start:args.p_start,end:args.p_end,bucket_grain:'day'},selected_performer_id:args.p_performer,
      summary:{received_minor:0,expense_minor:0,services_minor:0,debt_minor:0},confidence:{completed_visits:0,payment_marked_visits:0,is_complete:true,result_reliable:true},
      expense_readiness:{},categories:[],accounts:[],performers:[],series:[],expense_structure:[],operations:[],has_more:false}};
  }};
  const panel={dataset:{reportTab:'overview'},classList:{add(){},remove(){},toggle(){}}};
  const financeRoot={hidden:false,closest:()=>panel};
  const filterSummary={textContent:''};
  const nodes={'#analyticsView':panel,'#financeCenterRoot':financeRoot,'#reportFinanceOverview':{},'#reportFilterSummary':filterSummary};
  const context={console,Date,Intl,Map,Set,Promise,AbortController,structuredClone,setTimeout,clearTimeout,
    document:{querySelector:selector=>nodes[selector]||null},
    reportPeriod:period,reportDataSource:'own',reportPerformerFilter:master,
    reportCustomStart:'2026-09-25',reportCustomEnd:'2026-09-26',allBookings:tables.bookings||[],importedBookingHistory:[],
    reportTodayIso:()=>TODAY,parseLocalIsoDate:date=>new Date(date+'T12:00:00'),
    localIsoDate:date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`,
    reportOrganizationId:()=>ORG,reportUsesScopedBookings:()=>false,isScheduleBlock:()=>false,
    reportDateText:value=>value,reportPerformerName:()=> 'Вся команда',
    reportBookings:()=>tables.bookings||[],reportCompletedItems:items=>items,setReportText(){},
    MinutaFinanceCenter:{init({adapter,initialScope}){
      const center={adapter,scope:initialScope,destroyed:false};
      const load=async()=>{try{const model=await adapter.readDashboard({period:center.scope?.period||'current_month',masterId:center.scope?.masterId||''});if(!center.destroyed)models.push(model);}catch(e){errors.push(e);}};
      // Real center.setScope is idempotent for an identical shared filter scope.
      center.setScope=async scope=>{if(JSON.stringify(scope)===JSON.stringify(center.scope))return;center.scope=scope;center.ready=load();await center.ready;};center.reload=load;center.ready=load();return center;
    },destroy(center){center.destroyed=true;}}
  };
  context.window=context;vm.createContext(context);
  vm.runInContext(read('finance-center-provider.js'),context);
  const controller=context.MinutaFinanceProvider.createController({db,$:selector=>nodes[selector]||null,notify(){},requireWrites:()=>false});
  controller.setOrganization({id:ORG,current_role:role});
  const load=controller.load;controller.load=(...args)=>{context.pending=load(...args);return context.pending;};context.financeController=controller;
  vm.runInContext(rangeSource+'\n'+overviewSource,context);
  return {calls,queries,models,errors,controller,release,entered,context,filterSummary,async run(){vm.runInContext('refreshFinancialOverview()',context);await context.pending;return models.at(-1);}};
}
function checkScope(f,master=null){for(const call of f.calls){assert.equal(call.args.p_organization,ORG);assert.equal(call.args.p_performer,master);assert.ok((new Date(call.args.p_end)-new Date(call.args.p_start))/86400000<=3661);}for(const q of f.queries)assert.ok(q.filters.some(([op,k,v])=>op==='eq'&&k==='organization_id'&&v===ORG),q.table+' must retain explicit organization scope');}
const priorSale=sale('sale','2026-09-29T09:00:00Z');
const preVisitTables={bookings:[booking('2026-10-01')],commercial_sales:[sale('sale','2026-09-25T09:00:00Z')],financial_transactions:[transaction('income','2026-09-25T09:00:00Z','commercial_sale',5000,'sale'),transaction('expense','2026-09-26T09:00:00Z','supplier_expense_payment',-1000,'expense')],financial_manual_expenses_v163:[{id:'expense-row',organization_id:ORG,expense_source_id:'expense',category_id:'rent',category_name_snapshot:'Аренда',performer_id:MASTER}]};
const cases=[];
const test=(name,run)=>cases.push([name,run]);
test('no visits: confirmed sale and cash before today',async()=>{const f=fixture({tables:{commercial_sales:[priorSale],financial_transactions:[transaction('cash','2026-09-29T09:00:00Z','commercial_sale',5000,'sale')]}});const m=await f.run();assert.equal(m.available,true);assert.equal(m.bounds.start,'2026-09-29');assert.equal(m.summary.receivedMinor,5000);assert.equal(m.goods.quantity,2);assert.equal(m.goods.amountMinor,5000);checkScope(f);});
test('cash and expense before first visit',async()=>{const f=fixture({tables:preVisitTables});const m=await f.run();assert.equal(m.bounds.start,'2026-09-25');assert.equal(m.summary.receivedMinor,5000);assert.equal(m.summary.expenseMinor,1000);assert.equal(m.goods.quantity,2);checkScope(f);});
test('shared all label must not claim a booking-derived financial start',async()=>{const f=fixture({tables:preVisitTables});await f.run();assert.equal(f.filterSummary.textContent,'За всё время · Вся команда');});
test('all master scope plus RLS and peer/shared exclusion',async()=>{const tables=structuredClone(preVisitTables);tables.commercial_sales.push(sale('peer','2026-09-25T09:00:00Z',PEER),sale('foreign','2010-01-01T09:00:00Z',PEER,OTHER));tables.financial_transactions.push(transaction('peer','2026-09-25T09:00:00Z','commercial_sale',9000,'peer'),transaction('shared','2026-09-26T09:00:00Z','supplier_expense_payment',-700,'shared'));const f=fixture({tables,master:MASTER});const m=await f.run();assert.equal(m.summary.receivedMinor,5000);assert.equal(m.summary.expenseMinor,1000);assert.equal(m.goods.quantity,2);checkScope(f,MASTER);});
for(const period of ['day','custom'])test(period+' exact interval unchanged',async()=>{const f=fixture({period,tables:preVisitTables});const m=await f.run();const expected=period==='day'?{start:TODAY,end:TODAY}:{start:'2026-09-25',end:'2026-09-26'};assert.deepEqual(JSON.parse(JSON.stringify(m.bounds)),expected);assert.equal(f.calls[0].args.p_start,expected.start);assert.equal(f.calls[0].args.p_end,expected.end);assert.equal(f.filterSummary.textContent,(period==='day'?TODAY:expected.start+' — '+expected.end)+' · Вся команда');assert.equal(f.queries.filter(q=>q.earliest).length,0);checkScope(f);});
for(const source of ['financial_transactions','commercial_sales','bookings'])test(source+' earliest unavailable is not zero',async()=>{const f=fixture({tables:preVisitTables,failure:source});const m=await f.run();assert.equal(m.available,false);assert.ok(m.availabilityMessage.includes('За всё время'));assert.equal(m.summary?.receivedMinor,undefined);checkScope(f);});
test('backend >3661-day interval is explicit unavailable, never clipped',async()=>{const f=fixture({tables:{commercial_sales:[sale('old','2010-01-01T09:00:00Z')]}});const m=await f.run();assert.equal(m.available,false);assert.match(m.availabilityMessage,/3661/);assert.equal(f.calls.length,1,'only safe metadata RPC');checkScope(f);});
test('earliest operation uses organization timezone across midnight',async()=>{const f=fixture({tables:{commercial_sales:[sale('night','2026-09-25T22:30:00Z')],financial_transactions:[transaction('night-cash','2026-09-25T22:30:00Z','commercial_sale',5000,'night')]}});const m=await f.run();assert.equal(m.bounds.start,'2026-09-26');assert.equal(m.summary.receivedMinor,5000);assert.equal(m.goods.quantity,2);checkScope(f);});
test('invalid earliest timezone is explicit unavailable',async()=>{const f=fixture({invalidTimezone:true,tables:preVisitTables});const m=await f.run();assert.equal(m?.available,false);assert.match(m.availabilityMessage,/часов|времени|пояс/);});
test('missing timezone must not fall back to device timezone',async()=>{const f=fixture({invalidTimezone:'missing',tables:preVisitTables});const m=await f.run();assert.equal(m.available,false);assert.match(m.availabilityMessage,/часовой пояс/);assert.equal(f.queries.length,0);});
for(const rpcFailure of ['metadata','range'])test(rpcFailure+' RPC unavailable returns explicit unknown',async()=>{const f=fixture({rpcFailure,tables:preVisitTables});const m=await f.run();assert.equal(m.available,false);assert.match(m.availabilityMessage,/За всё время/);assert.equal(m.summary?.receivedMinor,undefined);checkScope(f);});
test('exact 3661-day interval remains available',async()=>{const start=new Date(new Date(TODAY+'T12:00:00Z').getTime()-3661*86400000).toISOString().slice(0,10);const f=fixture({tables:{commercial_sales:[sale('limit',start+'T09:00:00Z')]}});const m=await f.run();assert.equal(m.available,true);assert.equal(m.bounds.start,start);assert.equal(m.goods.quantity,2);assert.equal(f.calls.at(-1).args.p_start,start);checkScope(f);});
test('earliest read cannot cross organization generation reset',async()=>{const f=fixture({tables:preVisitTables,deferEarliest:true});const pending=f.run();assert.equal(await Promise.race([f.entered.then(()=>true),pending.then(()=>false)]),true,'all must read earliest before publishing totals');f.controller.setOrganization({id:OTHER,current_role:'owner'});f.release();await pending;assert.equal(f.models.length,0);assert.ok(f.errors.some(e=>e.name==='AbortError'));assert.equal(f.calls.length,1,'no stale final RPC after earliest read');});
test('period/master switch during earliest rejects stale all response',async()=>{const f=fixture({tables:preVisitTables,deferEarliest:true,master:MASTER});const pending=f.run();await f.entered;await f.controller.load({start:'2026-09-25',end:'2026-09-26',period:'custom'},{shared:true,masterId:'all'});f.release();await pending;assert.equal(f.models.length,1,'only current custom scope may finish');assert.equal(f.models[0].filters.selectedMaster,'');assert.deepEqual(JSON.parse(JSON.stringify(f.models[0].bounds)),{start:'2026-09-25',end:'2026-09-26'});assert.ok(f.errors.some(e=>e.name==='AbortError'));});
test('identical overview refresh preserves pending all request',async()=>{const f=fixture({tables:preVisitTables,deferEarliest:true});const pending=f.run();await f.entered;const duplicate=f.controller.load(f.context.reportRange(),{shared:true,masterId:'all'});f.release();await Promise.all([pending,duplicate]);assert.equal(f.models.length,1);assert.equal(f.errors.length,0);assert.equal(f.models[0].summary.receivedMinor,5000);assert.equal(f.queries.filter(q=>q.earliest).length,3);});
test('specialist must not initiate earliest or RPC reads',async()=>{const f=fixture({tables:preVisitTables,role:'specialist'});await f.run();assert.equal(f.calls.length,0);assert.equal(f.queries.length,0);});
const results=[];
for(const [name,run]of cases){try{await run();results.push({name,status:'PASS'});}catch(error){results.push({name,status:'FAIL',message:error.message});}}
if(process.env.MINUTA_STATISTICS_ALL_OUTPUT){mkdirSync(dirname(process.env.MINUTA_STATISTICS_ALL_OUTPUT),{recursive:true});writeFileSync(process.env.MINUTA_STATISTICS_ALL_OUTPUT,JSON.stringify({results},null,2));}
for(const result of results)console.log(result.status+': '+result.name+(result.message?' — '+result.message:''));
assert.equal(results.filter(r=>r.status==='FAIL').length,0,`${results.filter(r=>r.status==='FAIL').length}/${results.length} all-bounds contracts failed`);
console.log(`Statistics financial all bounds: ${results.length}/${results.length} PASS; actual reportRange/overview/controller/RPC/table predicates, no network or writes.`);
