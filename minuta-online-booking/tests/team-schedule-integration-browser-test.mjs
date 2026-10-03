import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createContext,runInContext} from 'node:vm';
import {fixtureHtml} from './team-schedule-fixture.mjs';

const read=name=>readFileSync(new URL(`../${name}`,import.meta.url),'utf8');
const html=read('provider.html'), provider=read('provider.js'), worker=read('sw.js');
const version=html.match(/src="provider\.js\?v=(\d+)"/)[1];
const core=worker.match(/const ASSETS = \[([\s\S]*?)\];/)[1];
assert.ok(!/team-schedule-ui\.(?:js|css)/.test(core),'team presentation must remain outside startup precache');
for(const type of ['js','css'])assert.ok(worker.includes(`./team-schedule-ui.${type}?v=${version}`),'optional team resource version must match provider');
assert.ok(!/<(?:script|link)[^>]*(?:src|href)="team-schedule-ui\./.test(html),'team presentation must not load eagerly');
const lazy=provider.slice(provider.indexOf('const providerFeatureLoads ='),provider.indexOf('function loadProviderGuidance()'));
const definitions=provider.slice(provider.indexOf('const organizationFeatureDefinitions ='),provider.indexOf('function organizationFeatureOptions()'));
const ensure=provider.slice(provider.indexOf('async function ensureOrganizationFeature('),provider.indexOf('\nbatchBookingsController =',provider.indexOf('async function ensureOrganizationFeature(')));
async function loaderCase({fail=false,stale=false}={}) {
  const loads=[],reads=[],factories=[];let failOnce=fail;
  const controller={bind(){},async setOrganization(org){reads.push(org.id)}};
  const context=createContext({Map,Promise,Error,encodeURIComponent,window:{MinutaShifts:{createController(){factories.push(true);return controller}}},document:{createElement(){return {addEventListener(name,handler){this[name]=handler}}},head:{append(script){loads.push(script.src);queueMicrotask(()=>{
    if(stale)runInContext('currentUser=null',context);
    if(failOnce&&script.src.startsWith('team-schedule-ui.js')){failOnce=false;script.error();}else script.load();
  })}},getElementById(){return {dataset:{lazyOrganizationFeature:'true'}}}}});
  runInContext(`const providerAssetVersion=${JSON.stringify(version)}; let shiftController=null,resourceController,payrollController,commerceController,benefitController,loyaltyController,inventoryController,retentionController;
    let currentUser={id:'actor'},sessionGeneration=1,organizationFeatureContextRevision=1;
    const organizationController={getActiveOrganization:()=>({id:'org',current_role:'owner'})};
    const sessionIsCurrent=id=>currentUser?.id===id,organizationFeatureOptions=()=>({}),refreshSectionNavigation=()=>{};
    ${lazy}\n${definitions}\n${ensure}`,context);
  assert.equal(loads.length,0,'other sections must not load the team presentation');
  if(fail){await assert.rejects(runInContext("ensureOrganizationFeature('shiftsPanel')",context));assert.equal(factories.length,0,'failed presentation must not create a controller or read data');}
  await runInContext("ensureOrganizationFeature('shiftsPanel')",context);
  if(stale){assert.equal(factories.length,0,'session change during load must refuse controller creation');assert.equal(reads.length,0);return;}
  const successful=loads.slice(fail?1:0);
  assert.deepEqual(successful,[`team-schedule-ui.js?v=${version}`,`shift-management.js?v=${version}`],'presentation loads before the existing controller with the same version');
  await runInContext("ensureOrganizationFeature('shiftsPanel')",context);
  assert.equal(factories.length,1,'repeat section activation reuses one controller');
  assert.equal(loads.length,fail?3:2,'repeat activation does not load duplicate scripts');
}
await loaderCase();await loaderCase({fail:true});await loaderCase({stale:true});

const modulePath=process.env.MINUTA_PLAYWRIGHT_MODULE;
const {chromium}=await import(modulePath?pathToFileURL(modulePath).href:'playwright');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
try {
  for(const width of [390,760,1440])for(const theme of ['pink-porcelain','noir-rose']){
    const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block'}),requests=[],errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.origin!=='https://schedule.test')return route.abort();
      if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:fixtureHtml({theme}).replace('<link rel="stylesheet" href="team-schedule-ui.css">','').replace('src="team-schedule-ui.js"',`src="team-schedule-ui.js?v=${version}"`)});
      const name=url.pathname.slice(1);requests.push(url.pathname+url.search);
      try{return route.fulfill({contentType:name.endsWith('.css')?'text/css':'application/javascript',body:read(name)})}catch{return route.abort()}
    });
    await page.goto('https://schedule.test/');await page.locator('#teamScheduleRange').waitFor({state:'visible'});
    assert.equal(await page.locator('link[data-team-schedule-style]').count(),1,'lazy stylesheet mounts once');
    assert.ok(requests.includes(`/team-schedule-ui.css?v=${version}`),'lazy stylesheet follows the requested script version');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'page has no horizontal overflow');
    const calls=()=>page.locator('#testCalls').textContent();const before=await calls();
    await page.getByRole('button',{name:'Добавить смену',exact:true}).click();
    await page.locator('dialog[open]').waitFor({state:'visible'});
    await page.locator('dialog[open]').press('Escape');
    assert.equal(await calls(),before,'open and cancel never mutate even synthetic records');
    assert.equal(errors.length,0,errors.join('\n'));await page.close();
  }
  console.log(JSON.stringify({loader:'3/3',widths:[390,760,1440],themes:2,dialogCancel:'6/6',externalTransport:false,productionWrites:false}));
}finally{await browser.close();}
