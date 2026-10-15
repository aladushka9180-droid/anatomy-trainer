import assert from 'node:assert/strict';
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {resolve, dirname, extname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

// Actual provider DOM, presentation and SDK; all requests terminate in synthetic fixtures.
const app=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source=readFileSync(process.env.MINUTA_PAYROLL_SOURCE||resolve(app,'payroll-management.js'),'utf8');
const html=readFileSync(resolve(app,'provider.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/gi,'');
const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
const output=process.env.MINUTA_SCREENSHOT_DIR;
if(output)mkdirSync(output,{recursive:true});
const rpc={read:'get_minuta_payroll_ledger_workspace_v136',ledger:'set_minuta_payroll_ledger_enabled_v136',base:'set_minuta_payroll_enabled',plan:'upsert_minuta_payroll_plan'};
const org='00000000-0000-4000-8000-000000000001',actor='00000000-0000-4000-8000-000000000002';
let browser,failed=0;
const results=[];
const sdkSettingProof=[];
async function fixture(options={}){
  const context=await browser.newContext({viewport:{width:options.width||1440,height:1000},serviceWorkers:'block',reducedMotion:'reduce'}),page=await context.newPage();
  page.setDefaultTimeout(2500);
  const errors=[],traffic=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin!=='https://payroll-enable.test'||route.request().method()!=='GET'){traffic.push(url.href);return route.abort();}
    const path=resolve(app,'.'+decodeURIComponent(url.pathname));
    if(!path.startsWith(app+'/')&&!path.startsWith(app+'\\'))return route.abort();
    try{return route.fulfill({body:path.endsWith('provider.html')?html:readFileSync(path),contentType:({'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp','.png':'image/png'})[extname(path)]||'application/octet-stream'});}
    catch{return route.fulfill({status:404,body:''});}
  });
  await page.goto('https://payroll-enable.test/provider.html');
  await page.addScriptTag({path:resolve(app,'theme-catalog.js')});
  await page.evaluate(()=>{
    document.documentElement.classList.remove('provider-booting','requires-top-level');document.documentElement.classList.add('top-level');
    document.querySelector('#providerBoot')?.remove();document.querySelector('#authCard').hidden=true;document.querySelector('#dashboard').hidden=false;
    document.querySelector('#dashboard').dataset.activeView='organization';
    document.body.dataset.providerTheme='pink-porcelain';document.body.dataset.providerLayout='soft';document.body.dataset.providerPorcelainCharacter='petal';
    const palette=MinutaThemeCatalog.theme('pink-porcelain').palette;
    Object.entries({bg:palette.bg,surface:palette.surface,'surface-alt':palette.surfaceAlt,ink:palette.ink,muted:palette.muted,line:palette.line,accent:palette.accent,'accent-soft':palette.accentSoft,'accent-contrast':palette.contrast,shadow:palette.shadow}).forEach(([key,value])=>document.body.style.setProperty('--theme-'+key,value));
    document.querySelectorAll('.provider-view').forEach(panel=>{panel.hidden=panel.dataset.providerPanel!=='organization';panel.classList.toggle('active',!panel.hidden);});
    document.querySelector('#organizationLoading').hidden=true;document.querySelector('#organizationWorkspace').hidden=false;
    document.querySelectorAll('.organization-section').forEach(panel=>{panel.hidden=panel.id!=='payrollPanel';});
    document.querySelector('#payrollStartDate').value='2026-10-01';document.querySelector('#payrollEndDate').value='2026-10-31';
  });
  await page.addScriptTag({path:resolve(app,'vendor/supabase-2.112.4.min.js')});
  await page.addScriptTag({content:source});
  await page.addScriptTag({path:resolve(app,'payroll-soft-minimalism.js')});
  await page.evaluate(async({rpc,org,actor,options})=>{
    window.test={actor,org,role:'owner',base:false,ledger:false,finance:true,calls:[],replies:[],notices:[],plans:[],mode:'ok',hiddenCount:0,...options};
    window.replyGates=[];
    const workspace=organization_id=>({organization_id,current_role:test.role,can_manage:['owner','admin'].includes(test.role),enabled:test.base,ledger_enabled:test.ledger,
      members:[{id:'00000000-0000-4000-8000-000000000003',display_name:'Анна'},{id:'00000000-0000-4000-8000-000000000004',display_name:'Мария'}],locations:[],plans:test.plans,periods:[],items:[]});
    const reply=data=>new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
    const refusal=message=>new Response(JSON.stringify({code:'55000',message,details:'',hint:''}),{status:400,headers:{'Content-Type':'application/json'}});
    const client=supabase.createClient('https://synthetic-enable.test','synthetic-key',{accessToken:async()=>'synthetic-token',auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},db:{retry:false},global:{fetch:async(_input,init)=>{
      const name=new URL(typeof _input==='string'?_input:_input.url).pathname.split('/').at(-1),p=JSON.parse(init.body||'{}');
      test.calls.push({name,p});
      if(name===rpc.read){if(test.deferRead)await new Promise(resolve=>replyGates.push(resolve));return reply(workspace(p.p_organization));}
      if(name===rpc.ledger){
        if(test.role!=='owner')return new Response(JSON.stringify({code:'42501',message:'payroll_owner_required'}),{status:403});
        if(p.p_enabled&&!test.finance)return refusal('finance_disabled');
        if(p.p_enabled&&!test.base)return refusal('payroll_disabled');
        if(test.mode==='historical')return refusal('payroll_ledger_historical_reconciliation_required');
        test.ledger=p.p_enabled;
        if(test.mode==='empty-ledger')return reply(null);
        if(test.mode==='lost-ledger')throw new TypeError('Failed to fetch');
        return reply({organization_id:p.p_organization,enabled:p.p_enabled});
      }
      if(name===rpc.base){
        if(test.mode==='base-refused')return new Response(JSON.stringify({code:'42501',message:'owner_required'}),{status:403});
        test.base=p.p_enabled;
        if(test.mode==='defer-base')await new Promise(resolve=>replyGates.push(resolve));
        if(test.mode==='lost-base')throw new TypeError('Failed to fetch');
        if(test.mode==='empty-base')return reply(null);
        return reply({organization_id:test.mode==='foreign-base'?'foreign':p.p_organization,enabled:test.mode==='wrong-base'?false:p.p_enabled});
      }
      if(name===rpc.plan){
        if(!test.base)return refusal('payroll_disabled');
        const plan={id:'00000000-0000-4000-8000-000000000005',performer_id:p.p_performer,name:p.p_name,effective_from:p.p_effective_from,effective_to:p.p_effective_to,base_rate_bps:p.p_base_rate_bps,active:true,tiers:p.p_tiers};test.plans.push(plan);
        return reply({...plan,organization_id:p.p_organization});
      }
      throw Error('Unexpected RPC '+name);
    }}});
    const db={rpc:async(name,p)=>{const result=await client.rpc(name,p);if(name!==rpc.read)test.replies.push({name,result:structuredClone(result)});return result;}};
    window.ctl=MinutaPayroll.createController({db,$:s=>document.querySelector(s),escapeHtml:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]),notify:m=>test.notices.push(m),requireWrites:()=>test.writes!==false,getCurrentUser:()=>({id:test.actor}),getSessionGeneration:()=>1,sessionIsCurrent:user=>user===test.actor,applyWriteAvailability:()=>{}});
    ctl.bind();await ctl.setOrganization({id:org});MinutaPayrollPresentation.mount();
    new MutationObserver(records=>{for(const r of records)if(r.target.id==='payrollWorkspace'&&r.attributeName==='hidden'&&r.target.hidden)test.hiddenCount++;}).observe(document.querySelector('#payrollWorkspace'),{attributes:true});
    window.toggle=()=>{const input=document.querySelector('#payrollEnabled');input.checked=!input.checked;input.dispatchEvent(new Event('change',{bubbles:true}));};
  },{rpc,org,actor,options});
  return {page,context,errors,traffic,
    state:()=>page.evaluate(()=>({...test,checked:document.querySelector('#payrollEnabled').checked,available:ctl.availability,error:document.querySelector('#payrollEnabledError')?.textContent||''})),
    toggle:async()=>{await page.locator('#payrollEnabled').click();await page.waitForFunction(()=>ctl.availability==='ready'&&!document.querySelector('#payrollEnabled').disabled);},
    draft:async()=>{await page.locator('.payroll-soft-add-rule').click();await page.locator('#payrollPlanName').fill('Тест — 40%');await page.locator('#payrollPlanPerformer').selectOption('00000000-0000-4000-8000-000000000004');await page.locator('#payrollPlanFrom').fill('2026-10-01');await page.locator('#payrollPlanTo').fill('2026-10-31');}
  };
}
const cases=[];
function assertUnknownSdkSetting(state,name){
  const reply=state.replies.find(reply=>reply.name===name&&reply.result.status===0)?.result;
  sdkSettingProof.push({rpc:name,reply,base:state.base,ledger:state.ledger,uiError:state.error,writes:state.calls.filter(call=>call.name!==rpc.read),notices:state.notices});
  assert.ok(reply,'actual SDK must resolve fetch failure as status 0');
  assert.equal(reply.data,null);assert.equal(Object.hasOwn(reply,'transport'),false);assert.match(reply.error.message,/Failed to fetch/);
  assert.match(state.error,/не подтвержд[её]н|не получен/,'unknown committed result must be reported honestly');
  assert.doesNotMatch(state.error,/не записана|повторите/i,'cannot assert rollback or encourage retry after a lost acknowledgement');
}
for(const width of [390,760,1440])cases.push(['off → on and saving the existing draft at '+width,async h=>{
  await h.draft();await h.toggle();let s=await h.state();
  assert.equal(s.checked,true);assert.equal(s.base,true);assert.equal(s.ledger,true);
  assert.deepEqual(s.calls.filter(c=>c.name!==rpc.read).map(c=>c.name),[rpc.ledger,rpc.base,rpc.ledger]);
  assert.equal(s.hiddenCount,0,'refresh must not collapse the workspace');
  assert.equal(await h.page.locator('#payrollPlanCreator').evaluate(n=>n.open),true,'draft stays open');
  assert.equal(await h.page.locator('#payrollPlanPerformer').inputValue(),'00000000-0000-4000-8000-000000000004','selected employee stays unchanged');
  assert.equal(await h.page.locator('#payrollPlanName').inputValue(),'Тест — 40%');
  await h.page.locator('#payrollPlanForm button[type=submit]').click();await h.page.waitForFunction(()=>test.plans.length===1&&ctl.availability==='ready');
  s=await h.state();assert.equal(s.plans[0].base_rate_bps,4000);assert.equal(s.plans[0].performer_id,'00000000-0000-4000-8000-000000000004');assert.equal(s.hiddenCount,0);
  await h.page.evaluate(()=>ctl.load());assert.equal((await h.state()).checked,true);
},{width}]);
cases.push(['already enabled base needs only one ledger write',async h=>{await h.toggle();const s=await h.state();assert.equal(s.checked,true);assert.deepEqual(s.calls.filter(c=>c.name!==rpc.read).map(c=>c.name),[rpc.ledger]);},{base:true}]);
cases.push(['disable leaves base payroll and finance intact',async h=>{await h.toggle();const s=await h.state();assert.equal(s.checked,false);assert.equal(s.base,true);assert.equal(s.finance,true);assert.deepEqual(s.calls.filter(c=>c.name!==rpc.read).map(c=>c.name),[rpc.ledger]);},{base:true,ledger:true}]);
for(const width of [390,760,1440])cases.push(['finance prerequisite is explicit and draft stays open at '+width,async h=>{
  await h.draft();await h.toggle();const s=await h.state();assert.equal(s.checked,false);assert.equal(s.base,false);assert.match(s.error,/финансовый учёт.*Продажи/);assert.equal(s.hiddenCount,0);
  assert.match(await h.page.locator('#payrollPeriodsList').textContent(),/Сначала включите.+затем добавьте правило/,'disabled setup must explain enable before adding a rule');
  assert.deepEqual(s.calls.filter(c=>c.name!==rpc.read).map(c=>c.name),[rpc.ledger]);assert.equal(await h.page.locator('#payrollPlanCreator').evaluate(n=>n.open),true);
  const overflow=await h.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false);
  if(output)await h.page.screenshot({path:resolve(output,'finance-error-'+width+'.png'),fullPage:true});
},{width,finance:false}]);
for(const mode of ['base-refused','empty-base','foreign-base','wrong-base','lost-base'])cases.push([mode+' cannot proceed to ledger or report success',async h=>{
  await h.toggle();const s=await h.state();assert.equal(s.checked,false);assert.equal(s.ledger,false);assert.equal(s.notices.includes('Учёт зарплаты включён'),false);
  assert.deepEqual(s.calls.filter(c=>c.name!==rpc.read).map(c=>c.name),[rpc.ledger,rpc.base]);assert.ok(s.error);
  if(mode==='lost-base'){assert.equal(s.base,true,'base setting committed before SDK lost its response');assertUnknownSdkSetting(s,rpc.base);}
},{mode}]);
for(const mode of ['empty-ledger','lost-ledger'])cases.push([mode+' cannot report success',async h=>{
  await h.toggle();const s=await h.state();assert.equal(s.notices.includes('Учёт зарплаты включён'),false);assert.ok(s.error);
  assert.equal(s.ledger,true,'ledger setting committed before its acknowledgement was lost');assert.equal(s.calls.filter(c=>c.name===rpc.ledger).length,1,'no automatic retry after unknown acknowledgement');
  if(mode==='lost-ledger')assertUnknownSdkSetting(s,rpc.ledger);
  else assert.match(s.error,/не подтвержд[её]н/);
},{base:true,mode}]);
cases.push(['partial base enable is recoverable by a separate explicit toggle',async h=>{
  await h.toggle();let s=await h.state();assert.equal(s.base,true);assert.equal(s.checked,false);assert.equal(s.ledger,false);
  await h.toggle();s=await h.state();assert.equal(s.checked,true);assert.equal(s.error,'');assert.equal(s.calls.filter(c=>c.name===rpc.base).length,1);assert.equal(s.notices.filter(m=>m==='Учёт зарплаты включён').length,1);
},{mode:'lost-base'}]);
cases.push(['historical reconciliation is preserved',async h=>{await h.toggle();const s=await h.state();assert.equal(s.checked,false);assert.match(s.error,/сверк/);assert.equal(s.notices.includes('Учёт зарплаты включён'),false);},{base:true,mode:'historical'}]);
for(const role of ['admin','specialist'])cases.push([role+' cannot enable salary',async h=>{assert.equal(await h.page.locator('#payrollEnabled').isDisabled(),true);await h.page.evaluate(()=>toggle());await h.page.waitForTimeout(50);assert.equal((await h.state()).calls.filter(c=>c.name!==rpc.read).length,0);},{role}]);
cases.push(['changed actor stops the dependent ledger retry',async h=>{
  await h.page.evaluate(()=>toggle());await h.page.waitForFunction(()=>replyGates.length===1);await h.page.evaluate(()=>{test.actor='different';replyGates.shift()();});await h.page.waitForTimeout(80);
  const s=await h.state();assert.deepEqual(s.calls.filter(c=>c.name!==rpc.read).map(c=>c.name),[rpc.ledger,rpc.base]);assert.equal(s.notices.includes('Учёт зарплаты включён'),false);
},{mode:'defer-base'}]);
cases.push(['changed organization stops the dependent ledger retry',async h=>{
  await h.page.evaluate(()=>toggle());await h.page.waitForFunction(()=>replyGates.length===1);
  await h.page.evaluate(async()=>{test.org='00000000-0000-4000-8000-000000000101';await ctl.setOrganization({id:test.org});replyGates.shift()();});await h.page.waitForFunction(()=>ctl.availability==='ready');
  const s=await h.state();assert.deepEqual(s.calls.filter(c=>c.name!==rpc.read).map(c=>c.name),[rpc.ledger,rpc.base]);assert.equal(s.notices.includes('Учёт зарплаты включён'),false);
},{mode:'defer-base'}]);
cases.push(['revoked write availability stops the dependent ledger retry',async h=>{
  await h.page.evaluate(()=>toggle());await h.page.waitForFunction(()=>replyGates.length===1);await h.page.evaluate(()=>{test.writes=false;replyGates.shift()();});await h.page.waitForFunction(()=>ctl.availability==='ready');
  const s=await h.state();assert.deepEqual(s.calls.filter(c=>c.name!==rpc.read).map(c=>c.name),[rpc.ledger,rpc.base]);assert.equal(s.checked,false);assert.equal(s.notices.includes('Учёт зарплаты включён'),false);
},{mode:'defer-base'}]);
cases.push(['an unresolved financial intent blocks changing payroll settings',async h=>{
  await h.page.evaluate(({org,actor})=>history.replaceState({minutaPayrollFinancialIntents:{[JSON.stringify([actor,org])]:{rpc:'pay_minuta_payroll_debt_v136',userId:actor,organizationId:org,requestId:'00000000-0000-4000-8000-000000000021',parameters:{p_organization:org,p_request_id:'00000000-0000-4000-8000-000000000021'}}}},''),{org,actor});
  await h.toggle();assert.equal((await h.state()).calls.filter(c=>c.name!==rpc.read).length,0);
},{}]);
cases.push(['read-only gate never enables either setting',async h=>{await h.page.evaluate(()=>toggle());await h.page.waitForTimeout(40);assert.equal((await h.state()).calls.filter(c=>c.name!==rpc.read).length,0);},{writes:false}]);
try{
  browser=await chromium.launch({headless:true});
  for(const [name,run,options]of cases){const h=await fixture(options);try{await run(h);assert.deepEqual(h.errors,[]);assert.deepEqual(h.traffic,[]);results.push({name,pass:true});console.log('PASS '+name);}catch(error){failed++;results.push({name,pass:false,error:error.message});console.error('FAIL '+name+'\n'+error.stack);}finally{await h.context.close();}}
}finally{await browser?.close();}
if(output){writeFileSync(resolve(output,'results.json'),JSON.stringify(results,null,2));writeFileSync(resolve(output,'sdk-setting-proof.json'),JSON.stringify(sdkSettingProof,null,2));}
console.log((cases.length-failed)+'/'+cases.length+' payroll enable cases; synthetic prerequisites, actual SDK/DOM, no external traffic or SQL');
process.exitCode=failed?1:0;
