import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url)),candidate=process.env.X07_SOURCE_ROOT || root;
const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||undefined});
const output=process.env.X07_BROWSER_OUTPUT;if(output)mkdirSync(output,{recursive:true});
try{for(const width of [390,760,1440])for(const state of ['offered','accepted','expired','busy']){
 const page=await browser.newPage({viewport:{width,height:900},bypassCSP:true});const errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!=='https://offer-candidate.test'||r.request().method()!=='GET'){external.push(u.href);return r.abort();}const name=u.pathname.slice(1);try{const base=['waitlist.html','waitlist.js','waitlist-offers.js'].includes(name)?candidate:root;let body=readFileSync(resolve(base,name));if(name.endsWith('.html'))body=Buffer.from(body.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));return r.fulfill({body,contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(name)]||'application/octet-stream'});}catch{return r.fulfill({status:404,body:''});}});
 await page.goto('https://offer-candidate.test/waitlist.html?scope=organization#token=00000000-0000-4000-8000-000000000006&offer=00000000-0000-4000-8000-000000000007');
 await page.evaluate(initial=>{window.calls=[];window.next=initial;window.MINUTA_CONFIG={};window.supabase={createClient:()=>({rpc:async(name,args)=>{calls.push({name,args});if(name==='get_minuta_waitlist_request_v111')return {data:[{status:'waiting',desired_date:'2027-01-11',service_name:'Тестовая услуга',performer_name:'Тестовый специалист',request_code:'SYN',time_period:'any'}]};if(name==='accept_minuta_waitlist_offer_v196')next='accepted';return {data:{state:next,offerId:'00000000-0000-4000-8000-000000000007',bookingDate:'2027-01-11',bookingTime:'10:00:00',expiresAt:'2027-01-10T20:00:00Z',serverNow:'2027-01-09T08:00:00Z',priceRub:1500,durationMinutes:60,reason:next==='busy'?'slot_busy':next==='expired'?'deadline':null,booking:next==='accepted'?{bookingCode:'ТЕСТ',manageToken:'00000000-0000-4000-8000-000000000030',requestId:'00000000-0000-4000-8000-000000000031',status:'new'}:null}};}})};},state);
 await page.addScriptTag({url:'https://offer-candidate.test/waitlist-offers.js'});await page.addScriptTag({url:'https://offer-candidate.test/waitlist.js'});
 const labels={offered:'Предложено',accepted:'Принято',expired:'Истекло',busy:'Уже занято'};await page.waitForFunction(label=>document.querySelector('#waitlistOfferState')?.textContent===label,labels[state]);
 assert.equal(await page.locator('#waitlistOfferAccept').isEnabled(),state==='offered');assert.equal(await page.locator('#waitlistOfferBooking').isVisible(),state==='accepted');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
 for(const selector of ['#waitlistOfferAccept','#waitlistOfferReload','#waitlistOfferBooking']){
  const target=page.locator(selector);if(!await target.isVisible())continue;
  const box=await target.boundingBox();assert.ok(box.height>=44&&box.width>=44,`${selector} ${width}/${state}: touch target ${box.width}×${box.height}`);
 }
 if(output)await page.screenshot({path:resolve(output,'offer-'+state+'-'+width+'.png'),fullPage:true});
 if(state==='offered'){await page.locator('#waitlistOfferAccept').dblclick();await page.waitForFunction(()=>document.querySelector('#waitlistOfferState').textContent==='Принято');assert.equal(await page.evaluate(()=>calls.filter(c=>c.name==='accept_minuta_waitlist_offer_v196').length),1);}
 else assert.equal(await page.evaluate(()=>calls.filter(c=>c.name==='accept_minuta_waitlist_offer_v196').length),0);
 if(state==='offered'){
  await page.goto('https://offer-candidate.test/waitlist-offer-provider.html#request=00000000-0000-4000-8000-000000000005');
  await page.evaluate(()=>{window.calls=[];window.MINUTA_CONFIG={};window.supabase={createClient:()=>({auth:{getUser:async()=>({data:{user:{id:'synthetic'}}})},rpc:async(name)=>{calls.push(name);if(name!=='get_minuta_waitlist_employee_v196')throw Error('Writes forbidden');return {data:{requestId:'00000000-0000-4000-8000-000000000005',requestStatus:'waiting',clientName:'ТЕСТ',serviceName:'Тестовая услуга',locationName:'Тестовый филиал',performerName:'Тестовый специалист',clientToken:'00000000-0000-4000-8000-000000000006',serverNow:'2027-01-09T08:00:00Z',slots:[{date:'2027-01-11',time:'10:00:00'}],offer:null}};}})};});
  await page.addScriptTag({url:'https://offer-candidate.test/waitlist-offers.js'});await page.addScriptTag({url:'https://offer-candidate.test/waitlist-offer-provider.js'});
  await page.locator('#employeeOfferForm').waitFor({state:'visible'});
  const targets=await page.locator('#employeeOfferForm button,#employeeOfferForm input,#employeeOfferForm select,#employeeReload,.provider-link').evaluateAll(nodes=>nodes.map(n=>({id:n.id,height:n.getBoundingClientRect().height,font:parseFloat(getComputedStyle(n).fontSize)})));
  assert.ok(targets.every(x=>x.height>=44&&x.font>=12),JSON.stringify({width,targets}));assert.equal(await page.locator('.provider-link').innerText(),'Вернуться в кабинет');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.deepEqual(await page.evaluate(()=>calls),['get_minuta_waitlist_employee_v196']);
  if(output)await page.screenshot({path:resolve(output,'employee-'+width+'.png'),fullPage:true});
 }
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await page.close();
}console.log('X07 candidate browser PASS: offered/accepted/expired/busy, safe disabled actions, one synthetic accept, 390/760/1440; no external requests.');}finally{await browser.close();}
