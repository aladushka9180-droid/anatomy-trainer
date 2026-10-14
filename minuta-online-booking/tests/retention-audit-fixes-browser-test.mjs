import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {buildRetentionFixture} from './retention-delta-fixture.mjs';
const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
const results=[],errors=[],outbound=[];
function html(disabled=false){
 let text=buildRetentionFixture().replace('requestConfirmation:()=>Promise.resolve(false)','requestConfirmation:()=>Promise.resolve(true)');
 const marker='const $=selector=>document.querySelector(selector),escapeHtml=';
 assert.ok(text.includes(marker));
 // The fixture acts as the authoritative server. A read after a confirmed
 // write returns the newly derived eligibility, never an optimistic UI value.
 text=text.replace(marker,`f.recompute=()=>{for(const c of f.clients)c.eligible=f.settings.enabled&&c.consent_status==='granted'&&c.completed_visits>0&&c.client_account_id!=='inactive'&&f.settings.inactivity_days<=60;};f.recompute();\n${marker}`);
 const saved='return {data:{organization_id:args.p_organization,enabled:args.p_enabled},error:null};';
 assert.ok(text.includes(saved));text=text.replace(saved,'f.recompute();if(f.faults.readAfterSave)f.faults.read=true;'+saved);
 text=text.replace("if(f.faults.save)throw new Error('synthetic_save_failure');","if(f.faults.messageTooLong)return {data:null,error:{code:'22023',message:'retention_message_too_long'}};if(f.faults.save)throw new Error('synthetic_save_failure');");
 if(disabled)text=text.replace('settings:{enabled:true,','settings:{enabled:false,');
 return text;
}
async function pageFor({width=1440,disabled=false}={}){
 const page=await browser.newPage({viewport:{width,height:1000},serviceWorkers:'block'});page.setDefaultTimeout(6000);
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>{if(r.request().url()==='https://retention-fixes.synthetic.test/')return r.fulfill({contentType:'text/html',body:html(disabled)});outbound.push(r.request().url());return r.abort();});
 await page.goto('https://retention-fixes.synthetic.test/');await page.evaluate(()=>retentionReady);return page;
}
async function check(name,work,options){const page=await pageFor(options);try{await work(page);results.push({name,pass:true});console.log('PASS '+name);}catch(e){results.push({name,pass:false,error:e.stack});console.error('FAIL '+name+': '+e.message);}finally{await page.close();}}
const saved=page=>page.waitForFunction(()=>document.querySelector('#retentionSaveStatus').textContent==='Сохранено автоматически');
const manyClients=(page,count=121)=>page.evaluate(async count=>{const f=retentionFixture;f.deliveries=[];f.clients=Array.from({length:count},(_,i)=>({client_account_id:'page-'+i,client_name:'Вымышленный клиент '+i,client_phone:'+79990000000',last_visit_on:'2026-01-01',completed_visits:5,consent_status:'granted',eligible:true}));await retentionController.load();},count);
try{
 await check('50-row pages retain a cross-page selection and prepare exactly those clients',async page=>{
  await manyClients(page);assert.equal(await page.locator('.retention-client-row').count(),50);
  assert.equal(await page.locator('#retentionClientsPagination>span').textContent(),'1–50 из 121');
  await page.locator('[data-retention-select="page-0"]').check();await page.locator('[data-retention-page="1"]').click();
  assert.equal(await page.locator('[data-retention-select="page-0"]').count(),0);await page.locator('[data-retention-select="page-50"]').check();
  assert.equal(await page.locator('[data-retention-prepare-selected]').textContent(),'Подготовить 2 сообщения');
  await page.locator('[data-retention-page="0"]').click();assert.equal(await page.locator('[data-retention-select="page-0"]').isChecked(),true);
  await page.locator('[data-retention-prepare-selected]').click();await page.waitForFunction(()=>retentionFixture.deliveries.length===2&&retentionController.availability==='ready');
  assert.deepEqual(await page.evaluate(()=>retentionFixture.deliveries.map(d=>d.client_account_id).sort()),['page-0','page-50']);
 });
 await check('select all spans every page and supports a single cross-page exclusion',async page=>{
  await manyClients(page);assert.match(await page.locator('.retention-select-all').textContent(),/на всех страницах/);
  await page.locator('[data-retention-select-all]').check();assert.match(await page.locator('.retention-selected-count').textContent(),/121 клиент/);
  await page.locator('[data-retention-page="1"]').click();assert.equal(await page.locator('[data-retention-select]:checked').count(),50);
  await page.locator('[data-retention-select="page-50"]').uncheck();assert.match(await page.locator('.retention-selected-count').textContent(),/120 клиентов/);
  assert.equal(await page.locator('[data-retention-select-all]').evaluate(n=>n.indeterminate),true);
  await page.locator('[data-retention-page="2"]').click();assert.equal(await page.locator('.retention-client-row').count(),21);
  assert.equal(await page.locator('[data-retention-select]:checked').count(),21);assert.equal(await page.locator('[data-retention-page="3"]').isDisabled(),true);
  await page.locator('[data-retention-select-all]').check();await page.locator('[data-retention-select-all]').uncheck();assert.equal(await page.locator('[data-retention-prepare-selected]').isDisabled(),true);
 });
 await check('same-scope refresh preserves the page and selection; a shorter list clamps and prunes them',async page=>{
  await manyClients(page);await page.locator('[data-retention-page="1"]').click();await page.locator('[data-retention-select="page-50"]').check();
  await page.evaluate(()=>retentionController.load());assert.equal(await page.locator('#retentionClientsPagination>span').textContent(),'51–100 из 121');
  assert.equal(await page.locator('[data-retention-select="page-50"]').isChecked(),true);
  await page.evaluate(async()=>{retentionFixture.clients=retentionFixture.clients.slice(0,20);await retentionController.load();});
  assert.equal(await page.locator('.retention-client-row').count(),20);assert.equal(await page.locator('#retentionClientsPagination').isHidden(),true);
  assert.equal(await page.locator('[data-retention-prepare-selected]').isDisabled(),true);
 });
 await check('organization and actor changes reset pagination and selection',async page=>{
  await manyClients(page);await page.locator('[data-retention-page="1"]').click();await page.locator('[data-retention-select="page-50"]').check();
  await page.evaluate(async()=>{retentionFixture.org='org-b';await retentionController.setOrganization({id:'org-b',current_role:'owner'});});
  assert.equal(await page.locator('#retentionClientsPagination>span').textContent(),'1–50 из 121');assert.equal(await page.locator('[data-retention-select]:checked').count(),0);
  await page.locator('[data-retention-page="1"]').click();await page.locator('[data-retention-select="page-50"]').check();
  await page.evaluate(async()=>{retentionFixture.user='owner-b';retentionFixture.generation++;await retentionController.load();});
  assert.equal(await page.locator('#retentionClientsPagination>span').textContent(),'1–50 из 121');assert.equal(await page.locator('[data-retention-select]:checked').count(),0);
 });
 await check('page navigation is read-only and rejects malformed or stale-scope requests',async page=>{
  await manyClients(page);await page.evaluate(()=>{retentionFixture.writesAllowed=false;});await page.locator('[data-retention-page="1"]').click();
  assert.equal(await page.locator('#retentionClientsPagination>span').textContent(),'51–100 из 121');
  await page.evaluate(()=>{const b=document.querySelector('[data-retention-page="2"]');b.dataset.retentionPage='NaN';b.click();});
  assert.equal(await page.locator('#retentionClientsPagination>span').textContent(),'51–100 из 121');
  await page.evaluate(()=>{retentionFixture.generation++;const b=document.querySelector('[data-retention-page="NaN"]');b.dataset.retentionPage='2';b.click();});
  assert.equal(await page.locator('#retentionClientsPagination>span').textContent(),'51–100 из 121');
  assert.equal(await page.evaluate(()=>retentionFixture.writeChecks),0);assert.equal(await page.evaluate(()=>retentionFixture.calls.some(c=>c.name!=='get_minuta_retention_workspace')),false);
 });
 await check('pending preparation locks page navigation until the server responds',async page=>{
  await manyClients(page);await page.locator('[data-retention-select="page-0"]').check();await page.evaluate(()=>{retentionFixture.faults.holdAt=1;});
  await page.locator('[data-retention-prepare-selected]').click();await page.waitForFunction(()=>typeof retentionFixture.releasePrepare==='function');
  assert.equal(await page.locator('[data-retention-page="1"]').isDisabled(),true);
  await page.evaluate(()=>document.querySelector('[data-retention-page="1"]').dispatchEvent(new MouseEvent('click',{bubbles:true})));
  assert.equal(await page.locator('#retentionClientsPagination>span').textContent(),'1–50 из 121');
  await page.evaluate(()=>retentionFixture.releasePrepare());await page.waitForFunction(()=>retentionFixture.deliveries.length===1&&retentionController.availability==='ready');
  assert.equal(await page.locator('[data-retention-page="1"]').isDisabled(),false);
 });
 for(const width of [390,760,1440])await check(width+': real mobile presentation keeps pagination visible and within the viewport',async page=>{
  await page.addStyleTag({content:readFileSync(new URL('../retention-mobile-ui.css',import.meta.url),'utf8')});
  await page.addScriptTag({content:readFileSync(new URL('../retention-mobile-ui.js',import.meta.url),'utf8')});await manyClients(page);
  await page.locator('[data-retention-select="page-0"]').check();await page.locator('[data-retention-page="1"]').click();
  const layout=await page.locator('#retentionClientsPagination').evaluate(n=>({overflow:document.documentElement.scrollWidth-innerWidth,left:n.getBoundingClientRect().left,right:n.getBoundingClientRect().right,buttons:[...n.querySelectorAll('button')].map(b=>({height:b.getBoundingClientRect().height,width:b.getBoundingClientRect().width,left:b.getBoundingClientRect().left,right:b.getBoundingClientRect().right}))}));
  assert.ok(layout.overflow<=0&&layout.left>=0&&layout.right<=width&&layout.buttons.every(b=>b.height>=44&&b.width>=44&&b.left>=0&&b.right<=width),JSON.stringify(layout));
  assert.match(await page.locator('.retention-selected-count').textContent(),/1 клиент/);
  if(process.env.RETENTION_FIX_SCREENSHOT_DIR){mkdirSync(process.env.RETENTION_FIX_SCREENSHOT_DIR,{recursive:true});await page.locator('#retentionClientsPagination').scrollIntoViewIfNeeded();await page.screenshot({path:join(process.env.RETENTION_FIX_SCREENSHOT_DIR,'pagination-'+width+'.png')});}
 },{width});
 for(const width of [390,760,1440]){
  await check(width+': enabling rereads the authoritative eligible list',async page=>{
   assert.equal(await page.locator('[data-retention-select]').count(),0);await page.locator('#retentionEnabled').check();await saved(page);
   assert.equal(await page.locator('[data-retention-select]').count(),4);
   assert.equal(await page.evaluate(()=>retentionController.payload.clients.filter(c=>c.eligible).length),5);
   assert.equal(await page.evaluate(()=>retentionFixture.calls.filter(c=>c.name==='get_minuta_retention_workspace').length),2);
  },{width,disabled:true});
  await check(width+': changed threshold removes stale selection only after server confirmation',async page=>{
   await page.locator('[data-retention-select="a"]').check();await page.locator('#retentionInactivityDays').fill('200');await saved(page);
   assert.equal(await page.locator('[data-retention-select]').count(),0);assert.equal(await page.locator('[data-retention-prepare-selected]').isDisabled(),true);
   assert.equal(await page.locator('#retentionInactivityDays').inputValue(),'200');
  },{width});
 }
 await check('preparation flushes pending template before creating a factual snapshot',async page=>{
  await page.locator('[data-retention-select="a"]').check();const desired='НОВЫЙ ШАБЛОН для проверки сохранения: {ссылка}';
  await page.evaluate(()=>{retentionFixture.fullText=id=>retentionFixture.settings.message_template.replace('{ссылка}','https://booking.synthetic.test/'+id);});
  await page.locator('#retentionMessageTemplate').fill(desired);await page.locator('[data-retention-prepare-selected]').click();
  await page.waitForFunction(()=>retentionFixture.deliveries.some(d=>d.client_account_id==='a'));
  const result=await page.evaluate(()=>({template:retentionFixture.settings.message_template,text:retentionFixture.deliveries.find(d=>d.client_account_id==='a').message_snapshot,calls:retentionFixture.calls.map(c=>c.name)}));
  assert.equal(result.template,desired);assert.equal(result.text,'НОВЫЙ ШАБЛОН для проверки сохранения: https://booking.synthetic.test/a');
  assert.ok(result.calls.indexOf('save_minuta_retention_settings')<result.calls.indexOf('prepare_minuta_retention_delivery'));
  assert.equal(result.calls.filter(x=>x==='save_minuta_retention_settings').length,1);
 });
 await check('failed settings save blocks preparation without replacing the typed template',async page=>{
  await page.locator('[data-retention-select="a"]').check();await page.evaluate(()=>{retentionFixture.faults.save=true;});
  await page.locator('#retentionMessageTemplate').fill('Новый несохранённый текст: {ссылка}');await page.locator('[data-retention-prepare-selected]').click();
  await page.waitForFunction(()=>retentionFixture.calls.some(c=>c.name==='save_minuta_retention_settings'));
  await page.waitForFunction(()=>document.querySelector('#retentionSaveStatus').textContent.includes('Не удалось подтвердить'));
  assert.equal(await page.evaluate(()=>retentionFixture.prepareCount),0);
  assert.equal(await page.locator('#retentionMessageTemplate').inputValue(),'Новый несохранённый текст: {ссылка}');
 });
 await check('confirmed save with failed refresh cannot continue preparation or announce fully saved',async page=>{
  await page.locator('[data-retention-select="a"]').check();await page.evaluate(()=>{retentionFixture.faults.readAfterSave=true;});
  await page.locator('#retentionMessageTemplate').fill('Настройки записаны, чтение упало: {ссылка}');await page.locator('[data-retention-prepare-selected]').click();
  await page.waitForFunction(()=>retentionController.availability==='error');
  assert.equal(await page.evaluate(()=>retentionFixture.prepareCount),0);
  assert.match(await page.locator('#retentionSaveStatus').textContent(),/Настройки сохранены, но список не обновлён/);
 });
 await check('oversized rendered message explains the existing limit without losing the draft edit',async page=>{
  await page.locator('[data-retention-select="a"]').check();await page.evaluate(()=>{retentionFixture.faults.messageTooLong=true;});
  const text='А'.repeat(990)+' {ссылка}';await page.locator('#retentionMessageTemplate').fill(text);await page.locator('[data-retention-prepare-selected]').click();
  await page.waitForFunction(()=>retentionFixture.notices.some(message=>message.includes('превышает 1000 символов')));
  assert.equal(await page.locator('#retentionMessageTemplate').inputValue(),text);assert.equal(await page.evaluate(()=>retentionFixture.prepareCount),0);
 });
 await check('scope switch while flushing an edit cannot prepare in either organization',async page=>{
  await page.locator('[data-retention-select="a"]').check();await page.evaluate(()=>{retentionFixture.faults.holdSave=true;});
  await page.locator('#retentionMessageTemplate').fill('Изменённый текст перед сменой: {ссылка}');await page.locator('[data-retention-prepare-selected]').click();
  await page.waitForFunction(()=>typeof retentionFixture.releaseSave==='function');
  await page.evaluate(async()=>{retentionFixture.org='org-b';await retentionController.setOrganization({id:'org-b',current_role:'owner'});retentionFixture.releaseSave();});
  await page.waitForFunction(()=>retentionController.payload?.organization_id==='org-b');
  assert.equal(await page.evaluate(()=>retentionFixture.prepareCount),0);
 });
 await check('selection preserves the original row and checkbox DOM nodes',async page=>{
  const before=await page.locator('[data-retention-select="a"]').elementHandle();await page.locator('[data-retention-select="a"]').check();
  assert.equal(await before.evaluate(node=>node===document.querySelector('[data-retention-select="a"]')),true);
  assert.equal(await page.evaluate(()=>document.activeElement?.dataset.retentionSelect),'a');
  assert.equal(await page.locator('.retention-client-status').first().textContent(),'Выбран');
 });
 for(const consent of ['revoked','unknown'])await check(consent+' consent removes WhatsApp action but preserves draft history and cancellation',async page=>{
  await page.evaluate(async consent=>{const c=retentionFixture.clients.find(c=>c.client_account_id==='draft');c.consent_status=consent;c.eligible=false;await retentionController.load();},consent);
  assert.equal(await page.locator('.retention-delivery-row a').count(),0);
  await page.locator('.retention-delivery-options>summary').click();
  assert.match(await page.locator('.retention-delivery-blocked').textContent(),/нет согласия/);
  assert.equal(await page.locator('[data-retention-action="cancelled"]').count(),1);
  assert.match(await page.locator('.retention-message-snapshot').textContent(),/https:\/\/booking.synthetic.test\/existing/);
 });
 for(const phone of ['', '123', '00000000000'])await check('invalid phone '+JSON.stringify(phone)+' cannot create a WhatsApp recipient link',async page=>{
  await page.evaluate(async phone=>{retentionFixture.clients.find(c=>c.client_account_id==='draft').client_phone=phone;await retentionController.load();},phone);
  assert.equal(await page.locator('.retention-delivery-row a').count(),0);assert.match(await page.locator('.retention-delivery-blocked').textContent(),/номер телефона/);
 });
 await check('valid 8-prefixed phone keeps the normalized international WhatsApp link',async page=>{
  await page.evaluate(async()=>{retentionFixture.clients.find(c=>c.client_account_id==='draft').client_phone='8 (999) 000-00-00';await retentionController.load();});
  assert.match(await page.locator('.retention-delivery-row a').getAttribute('href'),/^https:\/\/wa\.me\/79990000000\?text=/);
 });
 await check('cancelling an existing draft refreshes its client back into the available selection',async page=>{
  assert.equal(await page.locator('[data-retention-select="draft"]').count(),0);
  await page.locator('.retention-delivery-options>summary').click();await page.locator('[data-retention-action="cancelled"]').click();
  await page.locator('[data-retention-select="draft"]').waitFor();assert.equal(await page.evaluate(()=>retentionFixture.deliveries[0].status),'cancelled');
 });
 for(const width of [390,760,1440])await check(width+': blocked contact explanation fits the actual mobile presentation',async page=>{
  await page.addStyleTag({content:readFileSync(new URL('../retention-mobile-ui.css',import.meta.url),'utf8')});
  await page.addScriptTag({content:readFileSync(new URL('../retention-mobile-ui.js',import.meta.url),'utf8')});
  await page.evaluate(async()=>{retentionFixture.clients.find(c=>c.client_account_id==='draft').consent_status='revoked';await retentionController.load();});
  await page.locator('.retention-delivery-options>summary').click();assert.equal(await page.locator('.retention-delivery-row a').count(),0);
  const layout=await page.locator('.retention-row-actions').evaluate(node=>({right:node.getBoundingClientRect().right,overflow:document.documentElement.scrollWidth-innerWidth,children:[...node.children].map(e=>({right:e.getBoundingClientRect().right,left:e.getBoundingClientRect().left}))}));
  assert.ok(layout.overflow<=0&&layout.right<=width&&layout.children.every(x=>x.left>=0&&x.right<=width),JSON.stringify(layout));
  if(process.env.RETENTION_FIX_SCREENSHOT_DIR){mkdirSync(process.env.RETENTION_FIX_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:join(process.env.RETENTION_FIX_SCREENSHOT_DIR,'blocked-contact-'+width+'.png'),fullPage:true});}
 },{width});
 await check('untrusted row and snapshot text remain escaped',async page=>{
  await page.evaluate(async()=>{retentionFixture.clients[0].client_name='<img src=x onerror="window.injected=true">';retentionFixture.deliveries[0].message_snapshot='<script>window.injected=true</script>';await retentionController.load();});
  assert.equal(await page.locator('#retentionClientsList img').count(),0);assert.equal(await page.locator('#retentionDeliveriesList script').count(),0);assert.equal(await page.evaluate(()=>window.injected),undefined);
 });
 assert.deepEqual(errors,[]);assert.deepEqual(outbound,[]);
}finally{await browser.close();}
console.log(JSON.stringify({passed:results.filter(x=>x.pass).length,total:results.length,failures:results.filter(x=>!x.pass),pageErrors:errors,outboundRequests:outbound},null,2));
if(results.some(x=>!x.pass))process.exitCode=1;
