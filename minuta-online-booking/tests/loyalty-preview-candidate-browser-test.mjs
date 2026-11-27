import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const candidate=readFileSync(process.env.O19_SOURCE_MODULE_PATH || resolve(root,'loyalty-program-v166.js'));
const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||undefined});
const output=process.env.O19_BROWSER_OUTPUT;if(output)mkdirSync(output,{recursive:true});
try{for(const width of [390,760,1440]){
 const page=await browser.newPage({viewport:{width,height:1000},bypassCSP:true});const errors=[],external=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!=='https://loyalty-candidate.test'||r.request().method()!=='GET'){external.push(u.href);return r.abort();}if(u.pathname==='/candidate.js')return r.fulfill({body:candidate,contentType:'text/javascript'});try{const path=resolve(root,'.'+u.pathname);let body=readFileSync(path);if(path.endsWith('provider.html'))body=Buffer.from(body.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));return r.fulfill({body,contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(path)]||'application/octet-stream'});}catch{return r.abort();}});
 await page.goto('https://loyalty-candidate.test/provider.html');
 await page.evaluate(()=>{document.documentElement.className='provider-ready top-level';const panel=document.querySelector('#loyaltyPanel');document.body.replaceChildren(panel);panel.hidden=false;document.body.dataset.providerTheme='pink-porcelain';document.body.dataset.providerLayout='soft';});
 await page.addScriptTag({url:'https://loyalty-candidate.test/candidate.js'});
 await page.evaluate(async()=>{
  window.progress=3;window.calls=[];window.state={organization_id:'org',enabled:true,can_manage:true,current_role:'owner',rule:{id:'rule',goal_visits:10,reward_kind:'text',reward_title:'Тестовая награда',validity_days:90},clients:[{id:'c',client_name:'ТЕСТ O19'}],accounts:[{client_account_id:'c',progress:3,goal_visits:10}],rewards:[{id:'r',client_account_id:'c',status:'pending',reward_kind:'text',reward_title:'Тестовая награда'}],history:[],stats:{issued:1,redeemed:0}};
  const db={rpc:async(name,p)=>{calls.push({name,p});if(name==='get_minuta_loyalty_program_workspace_v166')return {data:state};if(name==='preview_minuta_loyalty_adjustment_v166')return {data:{before:progress,after:progress+p.p_delta,delta:p.p_delta,goal_visits:10,cycle_number:1,rule_id:'rule',allowed:progress+p.p_delta>=0&&progress+p.p_delta<=10}};if(name==='confirm_minuta_loyalty_adjustment_v166'){progress+=p.p_delta;state.accounts[0].progress=progress;return {data:{before:p.p_expected_before,after:progress}};}throw Error('Unexpected RPC '+name);}};
  window.controller=MinutaLoyalty.createController({db,escapeHtml:String,notify(){},requireWrites:()=>true,applyWriteAvailability(){},getCurrentUser:()=>({id:'actor'}),getSessionGeneration:()=>1,sessionIsCurrent:()=>true});controller.bind();await controller.setOrganization({id:'org'});
  document.querySelector('#loyaltyAdjustmentForm').closest('details').open=true;
 });
 const form=page.locator('#loyaltyAdjustmentForm');await form.locator('#loyaltyAdjustmentClient').selectOption('c');await form.locator('#loyaltyAdjustmentReason').fill('ТЕСТ O19 — локальная проверка');
 for(const [delta,after,allowed] of [[8,11,false],[-4,-1,false],[2,5,true]]){
  await form.locator('#loyaltyAdjustmentPoints').fill(String(delta));await page.waitForFunction(value=>document.querySelector('#loyaltyAdjustmentPreview').textContent.includes('станет '+value),after);
  assert.equal(await form.locator('button[type=submit]').isEnabled(),allowed);
 }
 const order=await page.evaluate(()=>Boolean(document.querySelector('#loyaltyRewardsList').compareDocumentPosition(document.querySelector('#loyaltyLedgerList'))&Node.DOCUMENT_POSITION_FOLLOWING));assert.equal(order,true,'rewards precede history');
 if(output)await form.screenshot({path:resolve(output,'loyalty-preview-'+width+'.png')});
 assert.equal(await page.evaluate(()=>calls.filter(c=>c.name==='confirm_minuta_loyalty_adjustment_v166').length),0);
 await form.locator('button[type=submit]').click();await page.waitForFunction(()=>progress===5);assert.equal(await page.evaluate(()=>calls.filter(c=>c.name==='confirm_minuta_loyalty_adjustment_v166').length),1);
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await page.close();
}console.log('O19 candidate browser PASS: rewards before history; exact before→after; lower/upper bounds; explicit synthetic confirmation once; 390/760/1440.');}finally{await browser.close();}
