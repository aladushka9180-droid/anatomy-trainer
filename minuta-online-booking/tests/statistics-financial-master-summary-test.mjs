import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const provider=readFileSync(process.env.MINUTA_SUMMARY_PROVIDER_SOURCE || resolve(root,'provider.js'),'utf8');
const source=provider.slice(provider.indexOf('function reportPerformerName()'),provider.indexOf('\nasync function loadReportAvailability('));
assert.ok(source.includes('function renderReportPerformerFilter(range)'));
const actor='synthetic-actor',master='synthetic-master';
function fixture(){
 const summary={textContent:'Всё время · Личная статистика'},wrap={hidden:true},select={innerHTML:'',value:''};
 const nodes={'#reportFilterSummary':summary,'#reportPerformerFilterWrap':wrap,'#reportPerformerFilter':select};
 const c=vm.createContext({window:{},$:key=>nodes[key],currentUser:{id:actor},reportCanViewTeam:false,
  reportPerformerFilter:'',reportPeriod:'all',reportDataSource:'own',
  reportTeamAnalyticsState:{rows:[{performer_id:master,performer_name:'Тестовый сотрудник'}]},
  localStorage:{getItem:()=>null},reportOrganizationId:()=> 'synthetic-org',escapeHtml:String,
  previousReportRange:()=>null,reportForecastEnd:r=>r.end,loadReportScopedBookings:()=>{},loadReportAvailability:()=>{}});
 vm.runInContext(source,c);return {c,summary,wrap,select,render:()=>c.renderReportPerformerFilter({start:'2026-08-04',end:'2026-10-02'})};
}
const cases=[],test=(name,run)=>cases.push([name,run]);
test('late confirmed team permission synchronizes visible all selection and previously personal caption',()=>{
 const f=fixture();f.c.reportCanViewTeam=true;f.c.reportPerformerFilter='all';f.render();
 assert.equal(f.wrap.hidden,false);assert.equal(f.select.value,'all');
 assert.equal(f.summary.textContent,'Всё время · Вся команда');
});
test('personal fallback replaces old team caption with the actual actor scope',()=>{
 const f=fixture();f.summary.textContent='Всё время · Вся команда';f.c.reportPerformerFilter='all';f.render();
 assert.equal(f.wrap.hidden,true);assert.equal(f.c.reportPerformerFilter,actor);
 assert.equal(f.summary.textContent,'Всё время · Личная статистика');
});
test('valid selected master gets the same name in filter caption',()=>{
 const f=fixture();f.c.reportCanViewTeam=true;f.c.reportPerformerFilter=master;f.render();
 assert.equal(f.select.value,master);assert.equal(f.summary.textContent,'Всё время · Тестовый сотрудник');
});
test('removed master resolves to all and removes the old master caption',()=>{
 const f=fixture();f.c.reportCanViewTeam=true;f.c.reportPerformerFilter='removed';f.summary.textContent='Всё время · Старый сотрудник';f.render();
 assert.equal(f.select.value,'all');assert.equal(f.summary.textContent,'Всё время · Вся команда');
});
test('remembered validated master is reflected after asynchronous directory arrives',()=>{
 const f=fixture();f.c.reportCanViewTeam=true;f.c.localStorage.getItem=()=>master;f.render();
 assert.equal(f.select.value,master);assert.equal(f.summary.textContent,'Всё время · Тестовый сотрудник');
});
test('role downgrade keeps permissions and actor identity unchanged while clearing the team name',()=>{
 const f=fixture();f.c.reportCanViewTeam=true;f.c.reportPerformerFilter=master;f.render();
 assert.equal(f.summary.textContent,'Всё время · Тестовый сотрудник');
 f.c.reportCanViewTeam=false;f.render();
 assert.equal(f.c.reportCanViewTeam,false);assert.equal(f.c.currentUser.id,actor);
 assert.equal(f.c.reportPerformerFilter,actor);assert.equal(f.summary.textContent,'Всё время · Личная статистика');
});
test('demo marker follows the current source without changing master scope',()=>{
 const f=fixture();f.c.reportCanViewTeam=true;f.c.reportPerformerFilter='all';f.c.reportDataSource='demo';f.render();
 assert.equal(f.summary.textContent,'Всё время · Вся команда · Демо');
 f.c.reportDataSource='own';f.render();assert.equal(f.summary.textContent,'Всё время · Вся команда');
});
test('custom period naming remains owned by the existing statistics binding',()=>{
 const f=fixture();f.c.reportCanViewTeam=true;f.c.reportPerformerFilter='all';
 f.c.window.MinutaStatisticsAuditProvider={periodName:()=> '2 октября'};f.render();
 assert.equal(f.summary.textContent,'2 октября · Вся команда');
});
const results=[];
for(const [name,run] of cases){try{run();results.push({name,status:'PASS'});}catch(error){results.push({name,status:'FAIL',message:error.message});}}
if(process.env.MINUTA_SUMMARY_OUTPUT)writeFileSync(process.env.MINUTA_SUMMARY_OUTPUT,JSON.stringify({results},null,2));
for(const r of results)console.log(`${r.status}: ${r.name}${r.message?' — '+r.message:''}`);
assert.equal(results.filter(r=>r.status==='FAIL').length,0,'performer caption must match the resolved filter scope');
console.log(`Master summary: ${results.length}/${results.length} PASS; actual provider functions, isolated scope, no network or writes.`);
