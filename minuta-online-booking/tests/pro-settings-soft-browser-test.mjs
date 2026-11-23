import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve,extname} from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url));
const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||undefined});
const output=process.env.SETTINGS_SOFT_OUTPUT;if(output)mkdirSync(output,{recursive:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[],external=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!=='https://settings.fixture.invalid'||r.request().method()!=='GET'){external.push(u.href);return r.abort();}const p=resolve(root,'.'+decodeURIComponent(u.pathname));if(!p.startsWith(root))return r.abort();try{let body=readFileSync(p);if(p.endsWith('provider.html'))body=Buffer.from(body.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));return r.fulfill({body,contentType:({'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(p)]||'application/octet-stream'});}catch{return r.fulfill({status:404,body:''});}});
 await page.goto('https://settings.fixture.invalid/provider.html');
 await page.evaluate(()=>{
  document.documentElement.classList.remove('provider-booting','requires-top-level');document.documentElement.classList.add('provider-ready');document.querySelector('#providerBoot')?.remove();document.querySelector('#authSection')?.setAttribute('hidden','');
  const panel=document.querySelector('[data-provider-panel="settings"]');document.body.replaceChildren(panel);panel.hidden=false;panel.classList.add('active');panel.style.cssText='display:block;margin:0 auto;max-width:1180px;padding:16px';
  document.body.dataset.providerTheme='pink-porcelain';document.body.dataset.providerLayout='soft';
  const ids=['bookingRulesCard','batchBookingSettingsCard','groupBookingSettingsCard'];panel.querySelectorAll('.settings-card').forEach(n=>n.hidden=!ids.includes(n.id));
  for(const id of ['organizationBookingPolicyPanel','organizationBookingPolicyWorkspace','autoCompletePaymentField'])document.getElementById(id).hidden=false;
  document.getElementById('organizationBookingPolicyLoading').hidden=true;
  document.getElementById('organizationBookingPolicyRules').innerHTML='<article class="organization-policy-rule"><div><strong>Вся организация</strong><small>Отмена 12 ч · перенос 12 ч · до 2 раз</small></div><button type="button" data-edit-fixture>Изменить</button></article>';
  for(const [id,v] of Object.entries({cancelCutoffHours:3,rescheduleCutoffHours:12,maxReschedules:10,batchBookingsMaxItems:12}))document.getElementById(id).value=v;
  document.getElementById('autoCompleteVisits').checked=true;document.getElementById('autoCompletePaymentMethod').value='transfer';document.getElementById('depositSettings').hidden=true;
  window.originalInputs=[...panel.querySelectorAll('input,select,button')];window.originalHidden=[...panel.querySelectorAll('[hidden]')];window.formCalls=[];
  for(const id of ['bookingPolicyForm','organizationBookingPolicyForm'])document.getElementById(id).addEventListener('submit',e=>{e.preventDefault();formCalls.push({id,value:document.getElementById('cancelCutoffHours').value});});
 });
 await page.addScriptTag({url:'https://settings.fixture.invalid/theme-catalog.js'});
 if(output)await page.screenshot({path:resolve(output,'before-1440.png'),fullPage:true});
 await page.addScriptTag({url:'https://settings.fixture.invalid/pro-settings-soft.js'});
 await page.addScriptTag({url:'https://settings.fixture.invalid/pro-settings-soft.js'});
 const style=await page.addStyleTag({url:'https://settings.fixture.invalid/pro-settings-soft.css'});
 assert.equal(await page.locator('.soft-settings-label').count(),2,'idempotent module');
 assert.equal(await page.evaluate(()=>originalInputs.every(n=>n.isConnected)),true,'native controls retain identity');
 assert.equal(await page.evaluate(()=>originalHidden.every(n=>n.hidden)),true,'hidden gates retained');
 const cases=[];
 for(const theme of ['pink-porcelain','warm','sage','graphite'])for(const width of [320,390,760,1440]){
  await page.setViewportSize({width,height:1100});await page.evaluate(t=>document.body.dataset.providerTheme=t,theme);
  const m=await page.evaluate(()=>{const els=[...document.querySelectorAll('#bookingRulesCard,#batchBookingSettingsCard,#groupBookingSettingsCard')],hint=document.querySelector('#autoCompletePaymentHint');return {overflow:document.documentElement.scrollWidth>innerWidth+1,gradients:els.some(e=>getComputedStyle(e).backgroundImage!=='none'),font:parseFloat(getComputedStyle(hint).fontSize),cards:els.map(e=>({id:e.id,width:e.getBoundingClientRect().width})),inputClip:[...document.querySelectorAll('#bookingRulesCard input:not([type=checkbox]):not([type=hidden])')].filter(e=>e.getBoundingClientRect().width>0).some(e=>e.getBoundingClientRect().right>innerWidth)};});
  assert.equal(m.overflow,false,theme+'/'+width+' overflow');assert.equal(m.gradients,false);assert.ok(m.font>=14);assert.equal(m.inputClip,false);
  const group=await page.locator('#groupBookingSettingsCard').evaluate(e=>({heading:e.querySelector('.settings-heading').getBoundingClientRect().toJSON(),toggle:e.querySelector('.group-booking-toggle').getBoundingClientRect().toJSON()}));assert.ok(group.toggle.top>=group.heading.bottom-1,theme+'/'+width+' group overlap');cases.push({theme,width,...m});
  if(output&&theme==='pink-porcelain'&&[390,760,1440].includes(width))await page.screenshot({path:resolve(output,'after-'+width+'.png'),fullPage:true});
 }
 await page.setViewportSize({width:390,height:1000});await page.locator('#bookingPolicyForm button[type=submit]').click();assert.deepEqual(await page.evaluate(()=>formCalls),[{id:'bookingPolicyForm',value:'3'}]);
 await page.locator('#organizationBookingPolicyEditor>summary').click();assert.equal(await page.locator('#organizationBookingPolicyEditor').getAttribute('open'),'');
 await page.locator('#batchBookingsEnabled').check();assert.equal(await page.locator('#batchBookingsEnabled').isChecked(),true);
 const beforeOther=await page.locator('#clientAppearanceSettingsCard').evaluate(e=>{const s=getComputedStyle(e);return[s.backgroundColor,s.padding,s.borderRadius];});await style.evaluate(e=>e.sheet.disabled=true);const afterOther=await page.locator('#clientAppearanceSettingsCard').evaluate(e=>{const s=getComputedStyle(e);return[s.backgroundColor,s.padding,s.borderRadius];});assert.deepEqual(beforeOther,afterOther,'unrelated appearance unchanged');
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);if(output)writeFileSync(resolve(output,'REPORT.json'),JSON.stringify({status:'PASS_SOURCE_ONLY',cases,errors,external,controls:'identity and hidden state retained; original submit listener and details native click pass',limits:'synthetic fixture; native backend saves not executed'},null,2));console.log('Soft settings PASS:16 theme/width cases; controls, hidden gates, native submit/details; no external requests.');
}finally{await browser.close();}
