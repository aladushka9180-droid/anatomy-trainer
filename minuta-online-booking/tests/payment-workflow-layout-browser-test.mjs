import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname,extname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';

// Native provider markup/theme and payment controller, synthetic data only.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const html=readFileSync(resolve(root,'provider.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
const source=readFileSync(resolve(root,'payment-management.js'),'utf8');
const baseline=execFileSync('git',['show','HEAD:minuta-online-booking/payment-management.js'],{cwd:root,encoding:'utf8'});
const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
const errors=[],unexpected=[];
const mime={'.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'};
async function fixture(width,code){
 // CSP bypass is solely for isolated controller injection; auth/bootstrap is not run.
 const page=await browser.newPage({bypassCSP:true,serviceWorkers:'block',viewport:{width,height:900}});
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.route('**/*',route=>{
  const u=new URL(route.request().url());
  if(u.origin!=='https://payment-layout.test'||route.request().method()!=='GET'){unexpected.push(u.href);return route.abort();}
  if(u.pathname.endsWith('/provider.html'))return route.fulfill({contentType:'text/html',body:html});
  const relative=decodeURIComponent(u.pathname.replace('/minuta-online-booking/',''));if(relative.includes('..'))return route.abort();
  try{return route.fulfill({contentType:mime[extname(relative)]||'application/octet-stream',body:readFileSync(resolve(root,relative))});}catch{return route.abort();}
 });
 await page.goto('https://payment-layout.test/minuta-online-booking/provider.html',{waitUntil:'networkidle'});
 await page.evaluate(()=>{
  document.documentElement.classList.remove('provider-booting');document.documentElement.classList.add('top-level');document.querySelector('#providerBoot')?.remove();
  document.body.dataset.providerTheme='midnight';document.body.dataset.providerLayout='bento';
  document.querySelector('#authCard').hidden=true;document.querySelector('#dashboard').hidden=false;
  document.querySelectorAll('[data-provider-panel]').forEach(p=>{p.hidden=p.dataset.providerPanel!=='organization';p.classList.toggle('active',!p.hidden);});
  document.querySelector('#organizationWorkspace').hidden=false;document.querySelector('#organizationLoading').hidden=true;
  document.querySelector('#organizationOverviewSection').hidden=true;document.querySelector('#organizationPeopleSection').hidden=true;
  document.querySelector('#organizationSectionSelect').value='paymentProviderPanel';
  document.querySelectorAll('#organizationSectionNav button').forEach(b=>b.classList.toggle('active',b.dataset.sectionTarget==='paymentProviderPanel'));
  document.querySelectorAll('[data-provider-panel="organization"] .organization-section').forEach(p=>p.hidden=p.id!=='paymentProviderPanel');
 });
 await page.addScriptTag({content:code});
 await page.evaluate(async()=>{
  window.paymentState={calls:[],notices:[]};
  const db={rpc:async()=>({data:{organization_id:'org-a',current_role:'owner',settings:{enabled:false,environment:'test'},
   recent_attempts:[{id:'attempt-a',amount_minor:10000,captured_amount_minor:10000,refunded_amount_minor:0,status:'succeeded',created_at:'2026-09-01T12:00:00Z'}]},error:null}),
   functions:{invoke:async(name,args)=>{paymentState.calls.push(args.body);return {data:null,error:{message:'lost response'}};}}};
  window.paymentController=MinutaPayments.createController({db,$:s=>document.querySelector(s),escapeHtml:v=>String(v??''),notify:v=>paymentState.notices.push(v),requireWrites:()=>true});
  paymentController.bind();await paymentController.setOrganization({id:'org-a',current_role:'owner'});
 });return page;
}
async function screenshot(page,label,width){
 await page.evaluate(()=>scrollTo(0,0));
 if(process.env.MINUTA_AUDIT_SCREENSHOT_DIR)await page.screenshot({path:resolve(process.env.MINUTA_AUDIT_SCREENSHOT_DIR,`payment-${label}-${width}.png`),fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
}
try{
 for(const width of [390,760,1440]){
  const before=await fixture(width,baseline);await screenshot(before,'before',width);await before.close();
  const page=await fixture(width,source);await screenshot(page,'after',width);
  await page.locator('#paymentRefundAmount').fill('10');await page.locator('#paymentRefundReason').fill('Тест восстановления возврата');
  await page.locator('#paymentRefundForm button[type=submit]').click();
  await page.waitForFunction(()=>paymentState.calls.length===1&&!document.querySelector('#paymentRefundRecovery').hidden);
  assert.equal(await page.locator('#paymentRefundNew').isVisible(),false);
  assert.equal(await page.evaluate(()=>document.querySelector('#paymentProviderWorkspace').firstElementChild.id),'paymentRefundRecovery');
  assert.equal(await page.evaluate(()=>document.querySelector('#paymentProviderPanel').lastElementChild.classList.contains('payment-technical-details')),true);
  await screenshot(page,'unknown',width);console.log(`PASS payment ${width}px: recovery first, optional guidance last, no horizontal overflow`);await page.close();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
}finally{await browser.close();}
