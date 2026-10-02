import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import vm from 'node:vm';

// Actual reset, organization callback, permission loader and caption functions.
// Other panels and transport are isolated fixture boundaries; no network/data writes.
const provider=readFileSync(process.env.MINUTA_REFRESH_PROVIDER_SOURCE || new URL('../provider.js',import.meta.url),'utf8').replaceAll('\r\n','\n');
function declaration(name){
 const start=provider.search(new RegExp(`^(?:async )?function ${name}\\(`,'m'));
 const end=provider.indexOf('\n}',start)+2;
 assert.ok(start>=0&&end>start,`Actual function ${name}`);
 return provider.slice(start,end);
}
const hookStart=provider.indexOf('  onActiveOrganizationChange: organization => {');
const hookEnd=provider.indexOf('\n  }\n});\norganizationController.bind();',hookStart);
assert.ok(hookStart>=0&&hookEnd>hookStart,'Actual complete organization callback');
const hook=provider.slice(hookStart,hookEnd).replace('  onActiveOrganizationChange: organization => {','function emitOrganization(organization) {')+'\n}';
const source=['resetReportSessionState','reportPerformerName','reportPeriodName','updateReportFilterSummary','renderReportPerformerFilter','loadReportTeamAnalytics'].map(declaration).join('\n')+'\n'+hook;
const noop=()=>{};
function fixture({view='analytics',remembered='all',online=true}={}){
 const events=[],requests=[],pending=[];
 const summary={textContent:'Всё время · Вся команда'},wrap={hidden:false};
 const select={value:'all',innerHTML:'<option value="all">Вся команда</option>',disabled:false};
 const panel={hidden:false},dashboard={dataset:{activeView:view}};
 const nodes={'#reportFilterSummary':summary,'#reportPerformerFilterWrap':wrap,'#reportPerformerFilter':select,'#reportPerformers':panel,'#dashboard':dashboard};
 const controllers=['teamCalendarController','batchBookingsController','bookingPolicyController','groupBookingsController','paymentController','integrationController','notificationCenterController','clientFieldsController','clientResultsController','clientRecordsController','clientImportController','dataGovernanceController','feedbackInboxController'];
 const c=vm.createContext({window:{},document:{body:{classList:{remove:noop}}},navigator:{onLine:online},$:key=>nodes[key],
  currentUser:{id:'fixture-actor'},sessionGeneration:1,activeClientOrganizationId:'fixture-org',reportPerformerFilter:'all',reportCanViewTeam:true,
  reportScopedBookingsState:{key:'old',status:'ready',rows:[{}]},reportAvailabilityState:{},reportTeamAnalyticsState:{key:'old',status:'ready',rows:[{performer_id:'fixture-master',performer_name:'Тестовый сотрудник'}],canViewTeam:true},
  reportEventState:{},reportUtmFunnelState:{},reportDemoBaseRows:[],reportDemoBaseReady:false,reportDemoLive:null,reportTeamMetric:'revenue',reportDataSource:'own',reportPeriod:'all',REPORT_DEMO_SLUG:'fixture-demo',
  bookingSeriesCancellationRevision:0,bookingEditorRevision:0,bookingMetadataRevision:0,
  importedClients:[],importedBookingHistory:[],importantNotificationState:{},selectedClientPhone:'',waitlistRequests:[],waitlistLoaded:false,
  stopReportDemoUpdates:noop,renderReportDataSourceControl:noop,loadClientAppearanceSettings:noop,loadBookingSettings:noop,renderWaitlist:noop,loadWaitlist:noop,
  prepareOrganizationFeatures:noop,applyDisplayPreferences:noop,renderDisplayPreferencesForm:noop,refreshSectionNavigation:noop,
  organizationFlowController:null,freeSlotsController:null,resourceController:null,shiftController:null,payrollController:null,benefitController:null,loyaltyController:null,inventoryController:null,retentionController:null,
  financeController:{setOrganization:()=>events.push('finance-organization')},
  localStorage:{getItem:()=>remembered},escapeHtml:String,previousReportRange:()=>null,reportForecastEnd:r=>r.end,loadReportScopedBookings:noop,loadReportAvailability:noop,
  reportDataQueryRange:r=>r,reportRangeDays:()=>60,setReportText:noop,
  db:{rpc:async(name,args)=>{requests.push({name,args});return new Promise(resolve=>pending.push(resolve));}}
 });
 controllers.forEach(name=>c[name]={setOrganization:noop});
 c.reportOrganizationId=()=>c.activeClientOrganizationId;
 c.reportSessionKey=(organization,start,end)=>`${c.currentUser?.id}:${c.sessionGeneration}:${organization}:${start}:${end}`;
 c.sessionIsCurrent=(actor,generation)=>c.currentUser?.id===actor&&c.sessionGeneration===generation;
 c.renderReportTeamRows=()=>{panel.hidden=!c.reportCanViewTeam;};
 const loads=[];
 c.renderAnalytics=()=>{events.push('analytics');c.updateReportFilterSummary();loads.push(c.loadReportTeamAnalytics({start:'2026-08-04',end:'2026-10-02'}));};
 vm.runInContext(source,c);
 return {c,summary,wrap,select,panel,events,requests,pending,loads,
  refresh:(org='fixture-org')=>c.emitOrganization({id:org}),
  resolve:async(index,canViewTeam=true)=>{pending[index]({data:{can_view_team:canViewTeam,performers:[{performer_id:'fixture-master',performer_name:'Тестовый сотрудник'}]},error:null});await Promise.resolve();await Promise.resolve();}};
}
const cases=[
 ['same-organization refresh hides stale selector, reloads actual permissions after finance scope, restores all caption',async()=>{
  const f=fixture();f.refresh();
  assert.equal(f.wrap.hidden,true,'Old team selector must be hidden until fresh rights');
  assert.equal(f.c.reportCanViewTeam,false,'No role-derived team permission');
  assert.equal(f.requests.length,1,'Active analytics must reload after organization notification');
  assert.deepEqual(f.events,['finance-organization','analytics']);
  await f.resolve(0);await Promise.all(f.loads);
  assert.equal(f.wrap.hidden,false);assert.equal(f.select.value,'all');assert.equal(f.summary.textContent,'Всё время · Вся команда');
 }],
 ['fresh role downgrade keeps personal scope and removes stale team UI',async()=>{
  const f=fixture();f.refresh();assert.equal(f.requests.length,1);await f.resolve(0,false);await Promise.all(f.loads);
  assert.equal(f.c.reportCanViewTeam,false);assert.equal(f.wrap.hidden,true);assert.equal(f.panel.hidden,true);
  assert.equal(f.c.reportPerformerFilter,'fixture-actor');assert.equal(f.summary.textContent,'Всё время · Личная статистика');
 }],
 ['validated remembered master is restored with matching caption after same-org refresh',async()=>{
  const f=fixture({remembered:'fixture-master'});f.refresh();assert.equal(f.requests.length,1);await f.resolve(0);await Promise.all(f.loads);
  assert.equal(f.select.value,'fixture-master');assert.equal(f.summary.textContent,'Всё время · Тестовый сотрудник');
 }],
 ['inactive analytics makes no extra RPC and clears stale selector immediately',async()=>{
  const f=fixture({view:'organization'});f.refresh('fixture-new-org');
  assert.equal(f.requests.length,0);assert.equal(f.c.activeClientOrganizationId,'fixture-new-org');
  assert.equal(f.wrap.hidden,true);assert.equal(f.select.innerHTML,'');assert.equal(f.select.value,'');assert.equal(f.panel.hidden,true);
 }],
 ['earlier same-key owner response cannot override fresh role downgrade after repeated org refresh',async()=>{
  const f=fixture();f.refresh();f.refresh();assert.equal(f.requests.length,2);
  await f.resolve(1,false);assert.equal(f.wrap.hidden,true);assert.equal(f.c.reportCanViewTeam,false);
  await f.resolve(0,true);await Promise.all(f.loads);
  assert.equal(f.c.reportCanViewTeam,false,'Stale same-key response must be ignored');assert.equal(f.wrap.hidden,true);
  assert.equal(f.summary.textContent,'Всё время · Личная статистика');
 }],
 ['logout invalidates pending response without restoring previous team selector',async()=>{
  const f=fixture();f.refresh();assert.equal(f.requests.length,1);f.c.currentUser=null;f.c.sessionGeneration++;
  f.c.resetReportSessionState();await f.resolve(0);await Promise.all(f.loads);
  assert.equal(f.c.reportCanViewTeam,false);assert.equal(f.wrap.hidden,true);assert.equal(f.panel.hidden,true);
 }],
 ['offline org refresh clears stale team UI without attempting transport',async()=>{
  const f=fixture({online:false});f.refresh();await Promise.all(f.loads);
  assert.equal(f.requests.length,0);assert.equal(f.wrap.hidden,true);assert.equal(f.panel.hidden,true);
 }]
];
const results=[];
for(const [name,run] of cases){try{await run();results.push({name,status:'PASS'});}catch(error){results.push({name,status:'FAIL',message:error.message});}}
if(process.env.MINUTA_REFRESH_OUTPUT)writeFileSync(process.env.MINUTA_REFRESH_OUTPUT,JSON.stringify({results},null,2));
for(const r of results)console.log(`${r.status}: ${r.name}${r.message?' — '+r.message:''}`);
assert.equal(results.filter(r=>r.status==='FAIL').length,0,'Organization refresh must synchronize scope without reusing stale permissions');
console.log(`Organization refresh: ${results.length}/${results.length} PASS; actual functions, isolated transport.`);
