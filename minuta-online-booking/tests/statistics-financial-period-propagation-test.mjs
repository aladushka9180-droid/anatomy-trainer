import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=file=>readFileSync(resolve(root,file),'utf8');
const provider=read('provider.js'),bindings=read('statistics-audit-provider.js'),ui=read('finance-center.js');
const rangeSource=provider.slice(provider.indexOf('function reportRange('),provider.indexOf('\nfunction reportDataQueryRange'));
const overviewSource=bindings.slice(bindings.indexOf('  function refreshFinancialOverview()'),bindings.indexOf('\n  function refreshReportUtmPresentation()'));
const old=read('tests/statistics-financial-all-bounds-test.mjs');
const fixtureSource=old.slice(old.indexOf('function fixture('),old.indexOf('\nfunction checkScope(')).trim();
const ORG='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222';
const MASTER='33333333-3333-4333-8333-333333333333',TODAY='2026-10-02';
const makeFixture=new Function('assert','vm','read','rangeSource','overviewSource','ORG','MASTER','TODAY',`return (${fixtureSource})`)(assert,vm,read,rangeSource,overviewSource,ORG,MASTER,TODAY);
const dateStatement=provider.split('\n').find(line=>line.includes("$('#reportPeriodLabel').textContent ="));
const detailStatement=ui.split('\n').find(line=>line.includes("find('[data-finance-detail-scope]').textContent ="));
const apiStatement=bindings.split('\n').find(line=>line.includes('window.MinutaStatisticsAuditProvider = Object.freeze('));
assert.ok(rangeSource.includes('financialBounds?.(') && dateStatement && detailStatement && apiStatement);
const booking=day=>({id:'visit',organization_id:ORG,performer_id:MASTER,booking_date:day});
function tables(start='2026-09-25',visit='2026-10-01') {return {
  bookings:visit?[booking(visit)]:[],commercial_sales:[{id:'sale',organization_id:ORG,seller_id:MASTER,occurred_at:start+'T09:00:00Z',commercial_sale_lines:[{item_kind:'inventory_item',item_name:'Synthetic',quantity:1,total_minor:5000}]}],
  financial_transactions:[{id:'cash',organization_id:ORG,occurred_at:start+'T09:00:00Z',operation_type:'commercial_sale',source_id:'sale',financial_postings:[{side:'debit',amount_minor:5000,financial_accounts:{account_class:'asset',account_type:'cash'}}]}]
};}
const plain=value=>JSON.parse(JSON.stringify(value));
function fixture(options={}) {
  const f=makeFixture(options),c=f.context;
  f.header={textContent:'',dataset:{}};f.detail={textContent:''};f.renders=0;
  const query=c.document.querySelector,init=c.MinutaFinanceCenter.init;
  c.document.querySelector=selector=>selector==='#reportPeriodLabel'?f.header:query(selector);
  c.$=c.document.querySelector;c.queueMicrotask=queueMicrotask;c.sessionGeneration=1;c.currentUser={id:'synthetic-owner'};
  for(const name of ['renderReportTeamRows','renderReportRetention','renderReportCalculationDetails','reportFreshnessLabel','refreshReportMethodology','customPeriodName','reportPeriodName']) c[name]=()=>{};
  c.audit={refresh(){}};
  c.MinutaFinanceCenter.init=options=>(f.center=init(options));
  vm.runInContext(apiStatement,c); // actual public binding API, including the hook/refresh queue
  c.renderAnalytics=()=>{
    assert.ok(++f.renders<=12,'propagation render cycle must terminate');
    // Actual render ordering: binding.refresh queues, then reportRange/date label.
    vm.runInContext(`MinutaStatisticsAuditProvider.refresh(); { const range=reportRange(),freshness=''; ${dateStatement} }`,c);
  };
  f.scope=()=>({period:c.reportPeriod,end:c.reportTodayIso(),organizationId:c.reportOrganizationId(),performerId:c.reportPerformerFilter});
  f.bounds=()=>c.MinutaStatisticsAuditProvider.financialBounds?.(f.scope()) || null;
  f.range=()=>plain(c.reportRange());
  f.render=()=>c.renderAnalytics();
  f.settle=async()=>{
    for(let turn=0;turn<20;turn++) {
      const pending=c.pending;
      if(pending)await pending;
      await new Promise(resolve=>setImmediate(resolve));
      if(pending===c.pending)return;
    }
    assert.fail('bounded propagation settlement exceeded twenty turns');
  };
  f.run=async()=>{f.render();await f.settle();return f.models.at(-1);};
  f.assertPeriod=start=>{
    const model=f.models.at(-1);assert.equal(model.available,true);
    assert.deepEqual(f.range(),{start,end:TODAY,period:'all'});
    assert.deepEqual(plain(model.bounds),{start,end:TODAY});
    assert.equal(f.header.textContent,`${start} — ${TODAY}`);
    c.data=model;c.elements={master:{selectedOptions:[{textContent:'Вся команда'}]}};c.find=()=>f.detail;
    vm.runInContext(detailStatement,c);
    assert.ok(f.detail.textContent.startsWith(model.periodLabel));
    assert.equal(model.comparison,null);
    assert.equal(f.errors.length,0);
  };
  return f;
}
const cases=[],test=(name,run)=>cases.push([name,run]);
test('earlier standalone financial operation propagates common range/header/detail, finite and idempotent',async()=>{
  const f=fixture({tables:tables()});await f.run();f.assertPeriod('2026-09-25');
  assert.equal(f.models.at(-1).summary.receivedMinor,5000);
  assert.equal(f.renders,2);assert.equal(f.calls.length,2,'one metadata + one final RPC, no alias reload');
  for(let n=0;n<3;n++){f.render();await f.settle();f.assertPeriod('2026-09-25');}
  assert.equal(f.calls.length,2,'ordinary identical renders do not reload');
});
test('earlier imported visit remains common/financial start',async()=>{
  const f=fixture({tables:tables('2026-09-25','2026-09-01')});f.context.importedBookingHistory=[{booking_date:'2026-08-04'}];
  await f.run();f.assertPeriod('2026-08-04');assert.equal(f.renders,1);
});
test('no visits plus operation publishes an actual common all range',async()=>{
  const f=fixture({tables:tables('2026-09-25',null)});await f.run();f.assertPeriod('2026-09-25');
});
test('identical pending render/native force coalesce one read',async()=>{
  const f=fixture({tables:tables(),deferEarliest:true});f.render();await f.entered;
  assert.equal(f.bounds(),null,'pending has no published financial range');
  f.render();await Promise.resolve();
  const duplicate=f.controller.load(f.context.reportRange(),{force:true});
  f.release();await duplicate;await f.settle();f.assertPeriod('2026-09-25');assert.equal(f.calls.length,2);
});
test('native Money day/master/all switch uses common context and has no stale all comparison',async()=>{
  const f=fixture({tables:tables(),master:MASTER});await f.run();f.assertPeriod('2026-09-25');
  f.context.reportPeriod='day';await f.controller.load(f.context.reportRange(),{force:true});await f.run();
  assert.equal(f.bounds(),null);assert.equal(f.range().start,TODAY);
  f.context.reportPeriod='all';await f.run();f.assertPeriod('2026-09-25');
  assert.equal(f.models.at(-1).filters.selectedMaster,MASTER);
});
for(const kind of ['unknown','cap'])test(kind+' after a confirmed all clears effective dates and relabels fallback without a loop',async()=>{
  const data=tables(),f=fixture({tables:data});await f.run();f.assertPeriod('2026-09-25');
  data.commercial_sales[0].occurred_at=kind==='unknown'?'invalid':'2010-01-01T09:00:00Z';
  await f.controller.load(f.context.reportRange(),{force:true});await f.run();
  assert.equal(f.bounds(),null);assert.equal(f.range().start,'2026-10-01');
  assert.equal(f.header.textContent,`2026-10-01 — ${TODAY}`);
  assert.equal(f.models.at(-1).available,false);assert.equal(f.models.at(-1).summary,undefined);
  assert.ok(f.renders<=4);assert.equal(f.calls.length,3,'only the safe metadata RPC added');
});
for(const change of ['session','actor','master','end','organization','role','reset','demo'])test(change+' change immediately invalidates published range',async()=>{
  const f=fixture({tables:tables()});await f.run();f.assertPeriod('2026-09-25');
  if(change==='session')f.context.sessionGeneration++;
  if(change==='actor')f.context.currentUser={id:'other-synthetic-actor'};
  if(change==='master')f.context.reportPerformerFilter=MASTER;
  if(change==='end')f.context.reportTodayIso=()=> '2026-10-03';
  if(change==='organization'){f.controller.setOrganization({id:OTHER,current_role:'owner'});f.context.reportOrganizationId=()=>OTHER;}
  if(change==='role')f.controller.setOrganization({id:ORG,current_role:'specialist'});
  if(change==='reset')f.controller.reset();
  if(change==='demo')f.context.reportDataSource='demo';
  assert.equal(f.bounds(),null);
  if(['session','actor'].includes(change)){
    const before=f.calls.length;await f.run();f.assertPeriod('2026-09-25');
    assert.equal(f.calls.length,before+2,'new session/actor must re-read, not re-publish old model');
  }
});
for(const change of ['session','actor','master','day','end','organization','role','reset','demo'])test(change+' change during earliest cannot publish stale scope',async()=>{
  const f=fixture({tables:tables(),deferEarliest:true});f.render();await f.entered;
  if(change==='session')f.context.sessionGeneration++;
  if(change==='actor')f.context.currentUser={id:'other-synthetic-actor'};
  if(change==='master')f.context.reportPerformerFilter=MASTER;
  if(change==='day')f.context.reportPeriod='day';
  if(change==='end')f.context.reportTodayIso=()=> '2026-10-03';
  if(change==='organization'){f.controller.setOrganization({id:OTHER,current_role:'owner'});f.context.reportOrganizationId=()=>OTHER;}
  if(change==='role')f.controller.setOrganization({id:ORG,current_role:'specialist'});
  if(change==='reset')f.controller.reset();
  if(change==='demo')f.context.reportDataSource='demo';
  assert.equal(f.bounds(),null);
  // Session lifecycle actually resets the finance controller before reloading.
  if(['session','actor'].includes(change))f.controller.reset();
  if(['day','master','demo'].includes(change)){f.render();await Promise.resolve();}
  f.release();await f.settle();
  if(change==='master') {
    assert.equal(f.bounds().start,'2026-09-25','new current master may publish its own confirmed range');
    assert.equal(f.models.length,1);assert.equal(f.models[0].filters.selectedMaster,MASTER);
  } else assert.equal(f.bounds(),null);
  if(change!=='end')assert.equal(f.calls.filter(({args})=>args.p_start==='2026-09-25'&&args.p_performer===null).length,0,'stale old all must not issue its final range RPC');
});
test('demo to own must re-read instead of reviving the earlier cached financial period',async()=>{
  const data=tables(),f=fixture({tables:data});await f.run();f.assertPeriod('2026-09-25');
  f.context.reportDataSource='demo';await f.run();assert.equal(f.bounds(),null);
  data.commercial_sales[0].occurred_at='2026-09-20T09:00:00Z';
  data.financial_transactions[0].occurred_at='2026-09-20T09:00:00Z';
  f.context.reportDataSource='own';await f.run();f.assertPeriod('2026-09-20');
  assert.equal(f.calls.length,4,'a fresh metadata + final read after leaving demo');
});
test('rapid own to demo to own during earliest starts a fresh request and rejects the old one',async()=>{
  const f=fixture({tables:tables(),deferEarliest:true});f.render();await f.entered;
  f.context.reportDataSource='demo';f.render();await Promise.resolve();assert.equal(f.bounds(),null);
  f.context.reportDataSource='own';f.render();await Promise.resolve();
  f.release();await f.settle();
  assert.equal(f.models.length,1);assert.ok(f.errors.some(error=>error.name==='AbortError'));
  assert.equal(f.models[0].bounds.start,'2026-09-25');
  assert.equal(f.bounds().start,'2026-09-25');assert.equal(f.range().start,'2026-09-25');
  assert.equal(f.calls.length,3,'old metadata, fresh metadata, one current final RPC');
});
test('newer same-scope adapter request supersedes the old request before its final RPC',async()=>{
  const f=fixture({tables:tables(),deferEarliest:true});f.render();await f.entered;
  const latest=f.center.adapter.readDashboard({period:'all',masterId:''});
  f.release();const model=await latest;await f.settle();
  assert.equal(model.bounds.start,'2026-09-25');assert.equal(f.models.length,0,'the old UI request must never publish');
  assert.ok(f.errors.some(error=>error.name==='AbortError'));
  assert.equal(f.calls.filter(({args})=>args.p_start==='2026-09-25').length,1,'only latest final RPC');
});
test('getter rejects wrong org/master/end and returned bounds cannot mutate cache',async()=>{
  const f=fixture({tables:tables()});await f.run();f.assertPeriod('2026-09-25');
  for(const scope of [{...f.scope(),organizationId:OTHER},{...f.scope(),performerId:MASTER},{...f.scope(),end:'2026-10-03'}])assert.equal(f.context.MinutaStatisticsAuditProvider.financialBounds(scope),null);
  const first=f.bounds();first.start='2000-01-01';assert.equal(f.bounds().start,'2026-09-25');
});
const results=[];
for(const [name,run] of cases){try{await run();results.push({name,status:'PASS'});}catch(error){results.push({name,status:'FAIL',message:error.message});}}
if(process.env.MINUTA_STATISTICS_PROPAGATION_OUTPUT){mkdirSync(dirname(process.env.MINUTA_STATISTICS_PROPAGATION_OUTPUT),{recursive:true});writeFileSync(process.env.MINUTA_STATISTICS_PROPAGATION_OUTPUT,JSON.stringify({results},null,2));}
for(const result of results)console.log(`${result.status}: ${result.name}${result.message?' — '+result.message:''}`);
assert.equal(results.filter(result=>result.status==='FAIL').length,0,'shared financial scope propagation failed');
console.log(`Statistics period propagation: ${results.length}/${results.length} PASS; actual reportRange/binding/controller/date/detail sources, isolated RPC/RLS, no UI/network/writes.`);
