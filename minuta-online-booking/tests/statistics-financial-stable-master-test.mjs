import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {candidateProvider} from './statistics-clarity-provider-patch.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=name=>readFileSync(resolve(root,name),'utf8');
const provider=candidateProvider(read('provider.js')),bindings=read('statistics-audit-provider.js');
const source=provider.slice(provider.indexOf('function reportPerformerName()'),provider.indexOf('\nasync function loadReportAvailability('));
const directory=bindings.slice(bindings.indexOf('  const performerDirectoryState'),bindings.indexOf('  // Same completed-visit population'));
const select={innerHTML:'',value:''},summary={textContent:''},wrap={hidden:false},loads=[];
let organization={id:'org',current_role:'owner'};
const context=vm.createContext({
  window:{},reportDataSource:'own',reportPeriod:'month',sessionGeneration:1,currentUser:{id:'actor'},
  reportPerformerFilter:'master',reportCanViewTeam:true,
  reportTeamAnalyticsState:{status:'ready',canViewTeam:true,rows:[{performer_id:'master',performer_name:'Сотрудник',payroll_rub:9999}]},
  reportOrganization:()=>organization,reportOrganizationId:()=>organization.id,
  $:id=>({'#reportPerformerFilter':select,'#reportFilterSummary':summary,'#reportPerformerFilterWrap':wrap})[id],
  localStorage:{getItem:()=>null},escapeHtml:String,previousReportRange:()=>null,reportForecastEnd:r=>r.end,
  loadReportScopedBookings:(range,master)=>loads.push({range,master}),loadReportAvailability:()=>{}
});
vm.runInContext(directory+'\n'+source,context);
context.window.MinutaStatisticsAuditProvider={performerDirectory:context.reportPerformerDirectory};
const render=()=>context.renderReportPerformerFilter({start:'2026-08-04',end:'2026-10-02'});
render();assert.equal(select.value,'master');assert.match(summary.textContent,/Сотрудник/);
assert.equal(context.reportPerformerDirectory(context.reportTeamAnalyticsState)[0].payroll_rub,9999,'period table remains the period table');
context.reportTeamAnalyticsState={status:'ready',canViewTeam:true,derived:true,rows:[]};context.reportPeriod='all';render();
assert.equal(context.reportPerformerFilter,'master','long-history empty team aggregate cannot reset the employee');
assert.equal(select.value,'master');assert.match(select.innerHTML,/Сотрудник/);assert.match(summary.textContent,/Всё время · Сотрудник/);
assert.equal(loads.at(-1).master,'master','the scoped visit request keeps the explicit employee');
assert.equal(context.reportPerformerDirectory(context.reportTeamAnalyticsState)[0].payroll_rub,undefined,'cached directory cannot carry previous payroll');
context.reportTeamAnalyticsState={status:'failed',canViewTeam:true,rows:[]};render();assert.equal(select.value,'master','failed directory cannot broaden to all');
organization={id:'new-org',current_role:'owner'};context.reportTeamAnalyticsState={status:'ready',canViewTeam:true,derived:true,rows:[]};render();
assert.doesNotMatch(select.innerHTML,/>Сотрудник</,'old organization label is cleared');
assert.equal(select.value,'master','unconfirmed directory does not silently broaden the requested scope');
context.reportTeamAnalyticsState={status:'ready',canViewTeam:true,rows:[{performer_id:'new-master',performer_name:'Новый'}]};render();
assert.equal(select.value,'all','fresh confirmed membership removes an invalid previous employee');
context.reportPerformerFilter='new-master';render();
organization.current_role='staff';context.reportCanViewTeam=false;render();
assert.equal(wrap.hidden,true);assert.equal(context.reportPerformerFilter,'actor');
assert.equal(select.innerHTML,'','actual denied filter removes old team options');
organization.current_role='owner';context.reportCanViewTeam=true;
context.reportTeamAnalyticsState={status:'ready',canViewTeam:true,derived:true,rows:[]};render();
assert.doesNotMatch(select.innerHTML,/>Новый</,'role restore cannot resurrect cached team names without a manual API reset');
context.reportCanViewTeam=false;render();
assert.deepEqual(JSON.parse(JSON.stringify(context.reportPerformerDirectory(context.reportTeamAnalyticsState))),[],'role downgrade clears cached team names');
console.log('Master across month/all/failed directory, actual scope request, name-only cache, organization and role isolation passed (exact owner integration patch).');
