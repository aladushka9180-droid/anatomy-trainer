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
// Reuse the existing organization-RLS/read-only fixture without changing its
// twenty contracts. It executes the actual controller and report range sources.
const existing = read('tests/statistics-financial-all-bounds-test.mjs');
const fixtureSource = existing.slice(existing.indexOf('function fixture('), existing.indexOf('\nfunction checkScope(')).trim();
assert.ok(fixtureSource.startsWith('function fixture(') && fixtureSource.endsWith('}'));
const ORG='11111111-1111-4111-8111-111111111111', MASTER='33333333-3333-4333-8333-333333333333', TODAY='2026-10-02';
const makeFixture = new Function('assert','vm','read','rangeSource','overviewSource','ORG','MASTER','TODAY',`return (${fixtureSource});`)(assert,vm,read,rangeSource,overviewSource,ORG,MASTER,TODAY);
function fixture(options) {
  const f=makeFixture(options), init=f.context.MinutaFinanceCenter.init;
  f.context.MinutaFinanceCenter.init=options=>(f.center=init(options));
  return f;
}
const booking = day => ({id:'visit',organization_id:ORG,performer_id:MASTER,booking_date:day});
const shared = {start:'2026-08-04',end:TODAY,period:'all'};
const tables = {bookings:[booking('2026-09-01')]};
const plain = value => JSON.parse(JSON.stringify(value));
function scoped(f) {
  assert.equal(f.errors.length,0);
  for (const call of f.calls) assert.equal(call.args.p_organization,ORG);
  for (const query of f.queries) assert.ok(query.filters.some(([op,key,value])=>op==='eq'&&key==='organization_id'&&value===ORG));
}
async function nativeLoad(f, range, options) {
  await f.controller.load(range,options);
  return f.models.at(-1);
}
// The real native Money/period/custom callers supply reportRange() without
// shared:true. Keep this shape tied to their actual source, not an invented API.
assert.match(provider,/financeController\?\.load\(reportRange\(\)\)/);
assert.match(provider,/financeController\.load\(reportRange\(\), \{ force:true \}\)/);
assert.match(read('finance-center.js'),/find\('\[data-finance-detail-scope\]'\)\.textContent = `\$\{data\?\.periodLabel/,'Received detail must use the normalized dashboard period label');
const cases=[];
const test=(name,run)=>cases.push([name,run]);
test('native Money first mount respects custom report interval',async()=>{
  const f=fixture({tables});
  const range={...shared,period:'custom'};
  const model=await nativeLoad(f,range);
  assert.deepEqual(plain(model.bounds),{start:range.start,end:range.end});
  assert.equal(f.calls[0].args.p_start,range.start);
  scoped(f);
});
test('native all switch replaces previous month and retains selected master',async()=>{
  const f=fixture({tables,master:MASTER});
  await f.controller.load({start:'2026-09-01',end:'2026-09-30',period:'month'},{shared:true,masterId:MASTER});
  const model=await nativeLoad(f,shared,{force:true});
  assert.deepEqual(plain(model.bounds),{start:shared.start,end:shared.end});
  assert.equal(model.filters.selectedMaster,MASTER);
  assert.equal(model.comparison,null);
  assert.equal(f.calls.at(-1).args.p_start,shared.start);
  assert.equal(f.calls.at(-1).args.p_performer,MASTER);
  scoped(f);
});
test('shared all includes earlier imported visit range despite later org-only history',async()=>{
  const f=fixture({tables});
  f.context.importedBookingHistory=[{id:'imported',booking_date:shared.start}];
  assert.deepEqual(plain(f.context.reportRange()),shared);
  const model=await f.run();
  assert.deepEqual(plain(model.bounds),{start:shared.start,end:shared.end});
  assert.ok(model.periodLabel.includes('4 авг'),model.periodLabel);
  assert.equal(f.calls.at(-1).args.p_start,shared.start);
  // The same real adapter serves detail pagination; it must not revert dates.
  await f.center.adapter.readOperations({period:'all',masterId:'',cursor:''});
  assert.equal(f.calls.at(-1).args.p_start,shared.start);
  assert.equal(f.calls.at(-1).args.p_end,shared.end);
  scoped(f);
});
test('all with empty financial sources does not shrink supplied report interval',async()=>{
  const f=fixture();
  const model=await nativeLoad(f,shared,{shared:true,masterId:'all'});
  assert.deepEqual(plain(model.bounds),{start:shared.start,end:shared.end});
  assert.equal(model.available,true);
  scoped(f);
});
test('native day/custom switches keep their exact dates after all',async()=>{
  const f=fixture({tables});
  await f.controller.load(shared,{shared:true,masterId:MASTER});
  for(const range of [{start:TODAY,end:TODAY,period:'day'},{start:'2026-09-25',end:'2026-09-26',period:'custom'}]) {
    const model=await nativeLoad(f,range,{force:true});
    assert.deepEqual(plain(model.bounds),{start:range.start,end:range.end});
    assert.equal(model.filters.selectedMaster,MASTER);
    assert.ok(f.calls.some(({args})=>args.p_start===range.start&&args.p_end===range.end));
  }
  scoped(f);
});
test('native switch during earliest read rejects the old all result',async()=>{
  const f=fixture({tables,deferEarliest:true});
  const pending=f.controller.load(shared,{shared:true,masterId:MASTER});
  await f.entered;
  const switched=f.controller.load({start:TODAY,end:TODAY,period:'day'});
  f.release();await Promise.all([pending,switched]);
  assert.equal(f.models.length,1);
  assert.deepEqual(plain(f.models[0].bounds),{start:TODAY,end:TODAY});
  assert.equal(f.models[0].filters.selectedMaster,MASTER);
  assert.ok(f.errors.some(error=>error.name==='AbortError'));
  assert.equal(f.calls.filter(({args})=>args.p_start===shared.start).length,0,'stale all must not reach final range RPC');
});
const results=[];
for(const [name,run] of cases) {try {await run();results.push({name,status:'PASS'});}catch(error){results.push({name,status:'FAIL',message:error.message});}}
if(process.env.MINUTA_STATISTICS_PERIOD_OUTPUT){mkdirSync(dirname(process.env.MINUTA_STATISTICS_PERIOD_OUTPUT),{recursive:true});writeFileSync(process.env.MINUTA_STATISTICS_PERIOD_OUTPUT,JSON.stringify({results},null,2));}
for(const result of results) console.log(`${result.status}: ${result.name}${result.message?' — '+result.message:''}`);
assert.equal(results.filter(result=>result.status==='FAIL').length,0,'shared/native financial periods must match the report context');
console.log(`Statistics shared periods: ${results.length}/${results.length} PASS; actual controller/report sources, synthetic read-only RPC/RLS, no UI/network/writes.`);
