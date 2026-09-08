import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname,extname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';

// Real provider markup, theme styles and controller; all RPCs are in-memory fixtures.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const html=readFileSync(resolve(root,'provider.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
const source=readFileSync(resolve(root,'benefit-management.js'),'utf8');
const baseline=execFileSync('git',['show','HEAD:minuta-online-booking/benefit-management.js'],{cwd:root,encoding:'utf8'});
const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
const url='https://benefit-recovery.test/minuta-online-booking/provider.html';
const errors=[],unexpected=[];
const mime={'.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.html':'text/html'};
async function fixture(width=390,page=null,code=source){
 // The fixture injects only the controller under test, not provider bootstrap/auth.
 if(!page){page=await browser.newPage({bypassCSP:true,serviceWorkers:'block',viewport:{width,height:900}});page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{
   const request=new URL(route.request().url());
   if(request.origin!=='https://benefit-recovery.test'||route.request().method()!=='GET'){unexpected.push(request.href);return route.abort();}
   if(request.pathname.endsWith('/provider.html'))return route.fulfill({contentType:'text/html',body:html});
   const relative=decodeURIComponent(request.pathname.replace('/minuta-online-booking/',''));
   if(relative.includes('..'))return route.abort();
   try{return route.fulfill({contentType:mime[extname(relative)]||'application/octet-stream',body:readFileSync(resolve(root,relative))});}catch{return route.abort();}
  });
 }
 await page.goto(url,{waitUntil:'networkidle'});
 await page.evaluate(()=>{
  document.documentElement.classList.remove('provider-booting');document.documentElement.classList.add('top-level');document.querySelector('#providerBoot')?.remove();
  document.body.dataset.providerTheme='midnight';document.body.dataset.providerLayout='bento';
  document.querySelector('#authCard').hidden=true;document.querySelector('#dashboard').hidden=false;
  document.querySelector('#dashboard').dataset.activeView='organization';
  document.querySelectorAll('[data-provider-panel]').forEach(p=>{p.hidden=p.dataset.providerPanel!=='organization';p.classList.toggle('active',!p.hidden);});
  document.querySelector('#organizationWorkspace').hidden=false;document.querySelector('#organizationLoading').hidden=true;
  document.querySelector('#organizationOverviewSection').hidden=true;document.querySelector('#organizationPeopleSection').hidden=true;
  document.querySelector('#organizationSectionSelect').value='benefitsPanel';
  document.querySelectorAll('#organizationSectionNav button').forEach(b=>b.classList.toggle('active',b.dataset.sectionTarget==='benefitsPanel'));
  document.querySelectorAll('[data-provider-panel="organization"] .organization-section').forEach(p=>p.hidden=p.id!=='benefitsPanel');
 });
 await page.addScriptTag({content:code});
 await page.evaluate(async()=>{
  const state=window.issueState={calls:[],checks:[],notices:[],row:null,unknown:true};
  const payload={organization_id:'org-a',current_role:'owner',enabled:true,
   services:[{id:'service-a',name:'Консультация'}],clients:[{id:'client-a',client_name:'Тестовый клиент',client_phone:'+7 (000) 000-00-00'}],
   products:[{id:'product-a',name:'Абонемент на 5 посещений',kind:'visit_pass',active:true,visits_count:5,sale_price_rub:5000,validity_days:90}],
   bookings:[],instruments:[],redemptions:[],audit:[]};
  const db={rpc:async(name,args)=>{
   if(name==='get_minuta_benefit_workspace')return {data:structuredClone(payload),error:null};
   if(name!=='issue_minuta_benefit')throw Error('Unexpected RPC');
   state.calls.push(structuredClone(args));
   state.row={id:'instrument-a',organization_id:args.p_organization,request_id:args.p_request_id,product_id:args.p_product,
    client_account_id:args.p_client_account,public_code:'MIN-FIXTURE',expires_on:args.p_expires_on||'2027-01-01'};
   return state.unknown?{data:null,error:{message:'response lost'}}:{data:structuredClone(state.row),error:null};
  },from:name=>{
   if(name!=='client_benefit_instruments')throw Error('Unexpected table');const filters=[];
   const query={select:()=>query,eq:(k,v)=>{filters.push([k,v]);return query;},maybeSingle:async()=>{state.checks.push(filters);return {data:state.row,error:null};}};return query;
  }};
  window.benefitController=MinutaBenefits.createController({db,$:s=>document.querySelector(s),escapeHtml:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
   notify:m=>state.notices.push(m),requireWrites:()=>true,getCurrentUser:()=>({id:'owner'}),getSessionGeneration:()=>1,sessionIsCurrent:()=>true,applyWriteAvailability(){}});
  benefitController.bind();await benefitController.setOrganization({id:'org-a',current_role:'owner'});
  document.querySelector('#benefitIssueCreator').open=true;
 });
 return page;
}
async function screenshot(page,label,width){
 await page.evaluate(()=>scrollTo(0,0));
 if(process.env.MINUTA_AUDIT_SCREENSHOT_DIR)await page.screenshot({path:resolve(process.env.MINUTA_AUDIT_SCREENSHOT_DIR,`benefit-${label}-${width}.png`),fullPage:true});
 const sizes=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.equal(sizes.scroll,sizes.width,'real theme must not overflow horizontally');
}
try{
 for(const width of [390,760,1440]){
  const before=await fixture(width,null,baseline);await screenshot(before,'before',width);await before.close();
  const page=await fixture(width);await screenshot(page,'after',width);
  await page.locator('#benefitIssueForm button[type=submit]').click();
  await page.waitForFunction(()=>document.querySelector('#benefitIssueError').textContent.includes('не подтверждена'));
  const original=await page.evaluate(()=>issueState.calls[0]);
  await screenshot(page,'unknown',width);
  assert.equal(await page.evaluate(()=>document.querySelector('#benefitWorkflowStatus').nextElementSibling.id),'benefitIssueCreator');
  if(width<=760)assert.equal(await page.locator('.organization-section-selector').evaluate(e=>getComputedStyle(e).position),'static');
  await fixture(width,page);
  await page.evaluate(original=>{issueState.row={id:'instrument-original',organization_id:original.p_organization,request_id:original.p_request_id,
   product_id:original.p_product,client_account_id:original.p_client_account,public_code:'MIN-ORIGINAL',expires_on:'2027-01-01'};},original);
  await page.locator('#benefitIssueForm button[type=submit]').click();
  await page.waitForFunction(()=>issueState.notices.some(m=>m.includes('уже выдан')));
  assert.equal(await page.evaluate(()=>issueState.calls.length),0);
  assert.deepEqual(await page.evaluate(()=>issueState.checks[0]),[['organization_id','org-a'],['request_id',original.p_request_id]]);
  await screenshot(page,'confirmed',width);
  await page.locator('#benefitIssueNew').click();
  assert.notEqual(await page.evaluate(()=>document.querySelector('#benefitIssueCreator').parentElement.id),'benefitsPanel');
  await page.locator('#benefitIssueForm button[type=submit]').click();
  await page.waitForFunction(()=>issueState.calls.length===1);
  assert.notEqual(await page.evaluate(()=>issueState.calls[0].p_request_id),original.p_request_id);
  assert.ok(await page.locator('#benefitInstrumentSearch').evaluate(e=>e.getBoundingClientRect().width)>=180,'benefit scanner field stays usable');
  await page.evaluate(()=>{
   document.querySelector('#benefitsPanel').hidden=true;document.querySelector('#inventoryPanel').hidden=false;
   document.querySelector('#inventoryWorkspace').hidden=false;document.querySelector('#inventoryControls').hidden=false;
   document.querySelectorAll('[data-inventory-pane]').forEach(p=>p.hidden=p.dataset.inventoryPane!=='catalog');
   document.querySelector('#inventoryItemCreator').open=true;document.querySelector('#organizationSectionSelect').value='inventoryPanel';
  });
  assert.ok(await page.locator('#inventoryItemSku').evaluate(e=>e.getBoundingClientRect().width)>=140,'neighbor inventory scanner stays usable');
  await screenshot(page,'inventory-neighbor',width);
  console.log(`PASS native ${width}px: lost-success reload, exact reconciliation, explicit new issue, recovery hierarchy and adjacent scanner layout`);await page.close();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
}finally{await browser.close();}
