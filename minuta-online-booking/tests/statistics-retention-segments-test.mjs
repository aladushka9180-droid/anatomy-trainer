import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
const tree=fileURLToPath(new URL('../',import.meta.url));
const results=[];
async function check(name,work){try{await work();results.push({name,pass:true})}catch(error){results.push({name,pass:false,error:error.stack})}}
class Element {
 constructor(tag='div'){Object.assign(this,{tagName:tag.toUpperCase(),hidden:false,disabled:false,checked:false,value:'',textContent:'',innerHTML:'',dataset:{},children:[],open:false,listeners:{},selectors:{},classList:{add(){},remove(){},toggle(){}}})}
 addEventListener(name,fn){(this.listeners[name]??=[]).push(fn)}
 fire(name){for(const fn of this.listeners[name]||[])fn({target:this,preventDefault(){},stopImmediatePropagation(){}})}
 append(...items){this.children.push(...items)}
 replaceChildren(...items){this.children=[...items]}
 querySelector(selector){return this.selectors[selector]??null}
 querySelectorAll(selector){return this.selectors[selector]||[]}
 closest(){return null}
 setAttribute(name,value){this[name]=value}
 showModal(){this.open=true}
 close(){this.open=false;this.fire('close')}
 after(){}
}
const rows=[
 {client_account_id:'a',client_name:'Fictional eligible one',last_visit_on:'2026-01-02',completed_visits:2,eligible:true,consent_status:'granted',client_phone:'PRIVATE_SENTINEL'},
 {client_account_id:'b',client_name:'Fictional regular',last_visit_on:'2026-01-03',completed_visits:3,eligible:true,consent_status:'granted',client_phone:'PRIVATE_SENTINEL'},
 {client_account_id:'c',client_name:'Fictional unknown',last_visit_on:'2026-01-04',completed_visits:4,eligible:false,consent_status:'unknown',client_phone:'PRIVATE_SENTINEL'},
 {client_account_id:'d',client_name:'Fictional missing consent',last_visit_on:null,completed_visits:0,eligible:true,client_phone:'PRIVATE_SENTINEL'},
 {client_account_id:'e',client_name:'Fictional revoked',last_visit_on:'2026-01-05',completed_visits:8,eligible:true,consent_status:'revoked',client_phone:'PRIVATE_SENTINEL'}];
function controllerFixture(role='owner'){
 const nodes={};const $=selector=>nodes[selector]??=(new Element());
 const state={user:'actor-a',generation:1,role,organization:'org-a',override:null};
 const calls=[],window={};
 vm.runInNewContext(readFileSync(join(tree,'retention-management.js'),'utf8'),{window,setTimeout,clearTimeout,console});
 const reply=()=>({data:{organization_id:state.organization,current_role:state.role,enabled:true,inactivity_days:45,cooldown_days:90,clients:rows,deliveries:[],audit:[]}});
 const controller=window.MinutaRetention.createController({db:{rpc:async(name,args)=>{calls.push(name);assert.equal(name,'get_minuta_retention_workspace');return state.override?state.override(name,args):reply()}},$,
  escapeHtml:x=>String(x),notify(){},requireWrites:()=>false,getCurrentUser:()=>({id:state.user}),getSessionGeneration:()=>state.generation,
  sessionIsCurrent:(user,generation)=>user===state.user&&generation===state.generation,applyWriteAvailability(){}});
 return {controller,state,calls,reply,load:()=>controller.setOrganization({id:state.organization,current_role:state.role})};
}
const libraryWindow={};vm.runInNewContext(readFileSync(join(tree,'statistics-audit-ui.js'),'utf8'),{window:libraryWindow});
const api=libraryWindow.MinutaStatisticsAuditUI;
await check('eligible requires server eligibility and granted consent',()=>assert.deepEqual(Array.from(api.buildRetentionSegments(rows).eligible,r=>r.key),['a','b']));
await check('regular requires at least three completed visits and eligibility',()=>assert.deepEqual(Array.from(api.buildRetentionSegments(rows).regular,r=>r.key),['b']));
await check('unknown consent excludes revoked and granted',()=>assert.deepEqual(Array.from(api.buildRetentionSegments(rows).unknownConsent,r=>r.key),['c','d']));
await check('segment rows project no phones/messages/actions',()=>{const text=JSON.stringify(api.buildRetentionSegments(rows));assert.ok(!text.includes('PRIVATE_SENTINEL'));assert.ok(!text.includes('client_phone'));assert.ok(!text.includes('last_booking_id'))});
await check('empty segments',()=>assert.ok(Object.values(api.buildRetentionSegments()).every(list=>list.length===0)));
await check('old new/returning calculation preserved',()=>{const segment=api.buildClientSegments({completed:[{client_name:'N',key:'n',booking_date:'2026-01-01'},{client_name:'R',key:'r',booking_date:'2026-01-02'}],history:[{key:'r'}],identityFor:r=>r.key});assert.deepEqual(Array.from(segment.new,r=>r.key),['n']);assert.deepEqual(Array.from(segment.returning,r=>r.key),['r'])});
for(const role of ['owner','admin'])await check(`${role} read-only projection is safe and current`,async()=>{const f=controllerFixture(role);await f.load();const snapshot=f.controller.readOnlySnapshot();assert.equal(snapshot.scope.role,role);assert.equal(snapshot.scope.userId,'actor-a');assert.equal(snapshot.clients.length,5);assert.ok(!JSON.stringify(snapshot).includes('PRIVATE_SENTINEL'));assert.deepEqual(f.calls,['get_minuta_retention_workspace'])});
await check('specialist cannot load retention segments',async()=>{const f=controllerFixture('specialist');await f.load();assert.equal(f.controller.readOnlySnapshot(),null);assert.equal(f.calls.length,0)});
for(const [name,change] of Object.entries({actor:s=>s.user='actor-b',session:s=>s.generation++,organization:s=>s.organization='org-b'}))await check(`stale ${name} returns no read-only projection`,async()=>{const f=controllerFixture();await f.load();change(f.state);if(name==='organization')await f.controller.setOrganization({id:'org-b',current_role:'specialist'});assert.equal(f.controller.readOnlySnapshot(),null)});
await check('demotion invalidates controller projection',async()=>{const f=controllerFixture();await f.load();await f.controller.setOrganization({id:'org-a',current_role:'specialist'});assert.equal(f.controller.readOnlySnapshot(),null)});
await check('loading invalidates projection immediately',async()=>{const f=controllerFixture();await f.load();let resolve;f.state.override=()=>new Promise(r=>resolve=r);const pending=f.controller.load();assert.equal(f.controller.readOnlySnapshot(),null);resolve(f.reply());await pending;assert.ok(f.controller.readOnlySnapshot())});
await check('old deferred role reply cannot become accessible',async()=>{const f=controllerFixture();let resolve;f.state.override=()=>new Promise(r=>resolve=r);const pending=f.load();await f.controller.setOrganization({id:'org-a',current_role:'specialist'});resolve(f.reply());await pending;assert.equal(f.controller.readOnlySnapshot(),null)});
function uiFixture(){
 const report=new Element(),buttons=['eligible','regular','unknownConsent'].map(kind=>{const b=new Element('button');b.dataset.reportRetentionSegment=kind;return b});
 report.selectors['[data-report-retention-segment]']=buttons;
 const nodes={'#analyticsView':report,'#reportExportDialog':new Element('dialog'),'#reportVisitExportScope':new Element()};
 let latestDialog;
 const document={querySelector:s=>nodes[s]||null,getElementById:id=>nodes['#'+id]||null,createElement:tag=>{const el=new Element(tag);if(tag==='dialog'){latestDialog=el;for(const s of ['[data-audit-close]','#reportSegmentTitle','.report-audit-scope','.report-audit-count','.report-audit-list'])el.selectors[s]=new Element()}return el}};
 const state={scope:{organization:'org-a',session:1,role:'owner',source:'own',status:'ready',start:'2026-01-01',end:'2026-01-31',performer:'all'},
  snapshot:{scope:{organization:'org-a',organizationName:'Fictional organization',session:1,userId:'actor-a',role:'owner',revision:1},segments:api.buildRetentionSegments(rows)},downloads:0};
 const win={};vm.runInNewContext(readFileSync(join(tree,'statistics-audit-ui.js'),'utf8'),{window:win,MutationObserver:class{observe(){}}});
 const audit=win.MinutaStatisticsAuditUI.create({document,getScope:()=>state.scope,getSegments:()=>({}),getRetentionSegments:()=>state.snapshot,download:()=>state.downloads++});
 audit.mount();return {audit,state,buttons,dialog:()=>latestDialog};
}
for(const [kind,count] of Object.entries({eligible:2,regular:1,unknownConsent:2}))await check(`native ${kind} click opens matching read-only list`,()=>{const f=uiFixture();const b=f.buttons.find(b=>b.dataset.reportRetentionSegment===kind);assert.equal(b.disabled,false);b.fire('click');const d=f.dialog();assert.equal(d.open,true);assert.equal(d.querySelector('.report-audit-list').children.length,count);assert.ok(d.querySelector('.report-audit-scope').textContent.includes('Все филиалы'));assert.ok(d.querySelector('.report-audit-count').textContent.includes('сообщения не отправляются'));assert.ok(!JSON.stringify(d.querySelector('.report-audit-list').children).includes('PRIVATE_SENTINEL'));assert.equal(f.state.downloads,0)});
for(const [name,change]of Object.entries({role:f=>{f.state.scope.role='specialist'},organization:f=>{f.state.scope.organization='org-b'},session:f=>{f.state.scope.session++},demo:f=>{f.state.scope.source='demo'},reload:f=>{f.state.snapshot.scope.revision++},unavailable:f=>{f.state.snapshot=null}}))await check(`open dialog ${name} change closes and purges rows`,()=>{const f=uiFixture();f.audit.openRetentionSegment('eligible');const d=f.dialog();change(f);f.audit.refreshRetentionSegments();assert.equal(d.open,false);assert.equal(d.querySelector('.report-audit-list').children.length,0);assert.equal(f.state.downloads,0)});
await check('loading overview does not hide ready independent retention',()=>{const f=uiFixture();f.state.scope.status='loading';f.audit.refreshRetentionSegments();assert.equal(f.buttons[0].disabled,false);assert.equal(f.audit.openRetentionSegment('eligible'),true)});
await check('unavailable retention buttons disabled',()=>{const f=uiFixture();f.state.snapshot=null;f.audit.refreshRetentionSegments();assert.ok(f.buttons.every(b=>b.disabled));assert.equal(f.audit.openRetentionSegment('eligible'),false)});
await check('empty known segment opens an explicit empty state',()=>{const f=uiFixture();f.state.snapshot.segments.eligible=[];f.audit.openRetentionSegment('eligible');assert.equal(f.dialog().querySelector('.report-audit-list').children[0].tagName,'P')});
await check('dialog cancel purges client rows',()=>{const f=uiFixture();f.audit.openRetentionSegment('regular');const d=f.dialog();d.close();assert.equal(d.querySelector('.report-audit-list').children.length,0)});
await check('prepared/sent counters remain noninteractive',()=>{const html=readFileSync(join(tree,'provider.html'),'utf8');assert.match(html,/<article><span>Подготовлено<\/span>/);assert.match(html,/<article><span>Отправлено<\/span>/);assert.equal((html.match(/data-report-retention-segment=/g)||[]).length,3)});
await check('published full-phone role guard not repeated or modified',()=>{const exporter=readFileSync(join(tree,'report-export-provider.js'),'utf8');assert.match(exporter,/\['owner','admin'\].includes\(organization.current_role\) \|\| scope.performer === scope.userId/);assert.match(exporter,/privacy !== 'full' \|\| organization.current_role === 'owner'/)});
await check('provider seam returns exactly same three segment counts',()=>{
 const code=readFileSync(join(tree,'statistics-audit-provider.js'),'utf8');assert.match(code,/const eligible = selection.segments.eligible.length/);assert.match(code,/const regular = selection.segments.regular.length/);assert.match(code,/const unknownConsent = selection.segments.unknownConsent.length/);
 const begin=code.indexOf('  function getRetentionSegments() {'),end=code.indexOf('  function getSegments()',begin);
 const current={snapshot:{scope:{organization:'org-a',role:'owner',userId:'actor-a',session:1,revision:1},clients:rows},source:'own',org:'org-a',role:'owner',actor:'actor-a',generation:1};
 const context={get reportDataSource(){return current.source},retentionController:{readOnlySnapshot:()=>current.snapshot},reportOrganization:()=>({current_role:current.role}),reportOrganizationId:()=>current.org,get currentUser(){return{id:current.actor}},get sessionGeneration(){return current.generation},MinutaStatisticsAuditUI:api};
 vm.createContext(context);vm.runInContext(code.slice(begin,end),context);assert.equal(vm.runInContext('getRetentionSegments().segments.regular.length',context),1);
 for(const field of ['source','org','role','actor','generation']){const original=current[field];current[field]=field==='generation'?2:'other';assert.equal(vm.runInContext('getRetentionSegments()',context),null);current[field]=original}
});
const result={format:'s10-next-synthetic-v1',passed:results.filter(x=>x.pass).length,total:results.length,browserUsed:false,databaseUsed:false,realClientsUsed:false,tests:results};
if(process.argv[2]) writeFileSync(process.argv[2],JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({passed:result.passed,total:result.total,failures:results.filter(x=>!x.pass)},null,2));if(result.passed!==result.total)process.exitCode=1;
