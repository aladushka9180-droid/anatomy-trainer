import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const html=readFileSync(new URL('../waitlist.html',import.meta.url),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/g,'');
const source=readFileSync(new URL('../waitlist.js',import.meta.url),'utf8');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
try {
  const page=await browser.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',dialog=>dialog.accept());
  await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:html}));
  await page.goto('https://example.test/waitlist.html?scope=organization#token=12345678-1234-1234-1234-123456789012');
  await page.addScriptTag({content:`window.calls=[];window.MINUTA_CONFIG={};window.supabase={createClient:()=>({rpc:async(name,args)=>{
    calls.push(name);if(window.fail)throw Error('offline');
    if(name.startsWith('cancel')){window.cancelled=true;return {data:'cancelled'};}
    return {data:[{request_code:'WAIT-TEST',service_name:'Test',performer_name:'Staff',location_name:'Branch',organization_slug:'org-a',location_id:'loc-a',service_id:'svc-a',desired_date:'2026-09-06',time_period:'morning',status:window.cancelled?'cancelled':'waiting'}]};
  }})};`});
  await page.addScriptTag({content:source});
  await page.locator('#waitlistManageContent').waitFor({state:'visible'});
  assert.equal((await page.evaluate(()=>calls))[0],'get_minuta_waitlist_request_v111');
  assert.match(await page.locator('#waitlistManageActions a').getAttribute('href'),/org=org-a&location=loc-a&service=svc-a/);
  await page.evaluate(()=>window.fail=true);
  await page.locator('#cancelWaitlist').click();
  await page.waitForFunction(()=>!document.querySelector('#cancelWaitlist').disabled);
  assert.match(await page.locator('#toast').textContent(),/Не удалось отменить/);
  await page.evaluate(()=>window.fail=false);
  await page.locator('#cancelWaitlist').click();
  await page.locator('#cancelWaitlist').waitFor({state:'hidden'});
  assert.equal(await page.locator('#waitlistManageStatus').textContent(),'Отменена');
  await page.evaluate(()=>{window.fail=true;return loadRequest();});
  await page.locator('#waitlistManageError').waitFor({state:'visible'});
  assert.equal(await page.locator('#waitlistManageError h1').textContent(),'Не удалось загрузить заявку');
  assert.deepEqual(errors,[]);
  console.log('PASS: waitlist management route, cancellation, failure recovery and honest network error');
} finally {await browser.close();}
