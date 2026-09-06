import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const html=read('provider.html'),provider=read('provider.js');
const version=html.match(/src="provider-feedback.js\?v=(\d+)"/)[1];
const dialog=html.match(/  <dialog class="product-feedback-dialog"[\s\S]*?<\/dialog>/)[0];
const csp=html.match(/<meta http-equiv="Content-Security-Policy"[^>]+>/)[0];
const init=provider.slice(provider.indexOf('providerFeedbackController = window.MinutaProviderFeedback'),provider.indexOf('freeSlotsController = window.MinutaFreeSlots'));
const orgHook=provider.match(/    if \(clientOrganizationChanged\) \{\n      providerFeedbackController.reset\(\);[\s\S]*?\n    \}/)[0];
assert.equal((html.match(/src="provider-feedback-media-v3.js\?v=\d+"/g)||[]).length,1);
assert.ok(html.includes(`src="provider-feedback-media-v3.js?v=${version}"`));
assert.ok(html.indexOf('src="provider-feedback-media-v3.js')<html.indexOf('src="provider-feedback.js'));
assert.match(csp,/media-src 'self' blob:/);
const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
let passed=0;
async function scenario(name,capability,run){
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const boot=`window.currentUser={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}; window.organization={id:'00000000-0000-4000-8000-000000000010'};
    window.capability=window.fixtureCapability??${JSON.stringify(capability)};window.outcome='ok';window.calls=[];window.notifications=[];window.writes=true;
    window.organizationController={getActiveOrganization:()=>organization};window.$=selector=>document.querySelector(selector);
    window.notify=message=>notifications.push(message);window.requireWrites=()=>writes;
    window.db={rpc:async(name,args)=>{calls.push({name,args:structuredClone(args)});
      if(name==='get_minuta_feedback_media_capability'){
        if(capability==='missing')return {data:null,error:{code:'PGRST202',message:'missing'}};
        if(capability==='throw')throw new TypeError('Failed to fetch');
        if(capability==='delayed')return new Promise(resolve=>window.capResolve=resolve);
        return {data:capability==='media'?{version:3,max_files:5,video_bytes:20971520,total_bytes:41943040}:null,error:null};
      }
      if(name==='get_minuta_feedback_capability')return {data:true,error:null};
      if(name==='get_my_minuta_feedback_request_v3')return {data:window.lookup??null,error:null};
      if(name==='reserve_minuta_feedback_upload_v3')return {data:{path:currentUser.id+'/'+args.p_request_id+'/'+args.p_attachment_id+(args.p_mime==='image/webp'?'.webp':'.mp4'),uploaded:false},error:null};
      if(name==='release_minuta_feedback_upload_v3')return {data:true,error:null};
      if(name==='create_minuta_feedback'||name==='create_minuta_feedback_media_v3'){
        if(outcome==='rejected')return {data:null,error:{code:'P0001',message:'feedback_daily_limit'}};
        if(outcome==='throw')throw new TypeError('Failed to fetch');
        if(outcome==='malformed')return {data:null,error:null};
        if(outcome==='array-number')return {data:{request_number:[12]},error:null};
        if(outcome==='deferred')return new Promise(resolve=>window.finish=resolve);
        return {data:name==='create_minuta_feedback'?{request_number:12}:{request_id:args.p_request_id,request_number:12,organization_id:args.p_organization},error:null};
      }
      throw Error('Unexpected RPC '+name);
    },storage:{from:()=>({upload:async(path,blob)=>{calls.push({name:'upload',path,size:blob.size,type:blob.type});return {data:{path},error:null};},remove:()=>{throw Error('Browser removal forbidden');}})}};
    let providerFeedbackController;
    ${init}
    window.controller=providerFeedbackController;
    window.switchOrg=async id=>{const clientOrganizationChanged=id!==organization?.id;organization=id?{id}:null;${orgHook}};
    window.ready=capability==='offline-start'?Promise.resolve():controller.refreshAvailability();`;
  const content=`<!doctype html><html lang="ru"><head>${html.match(/<meta charset="utf-8">/)[0]}${csp}<link rel="stylesheet" href="styles.css?v=${version}"></head><body>
    <button type="button" data-open-product-feedback hidden>Обратная связь</button>${dialog}
    <script src="provider-feedback-media-v3.js?v=${version}"></script><script src="provider-feedback.js?v=${version}"></script><script src="fixture.js"></script></body></html>`;
  await context.route('**/*',route=>{
    const path=new URL(route.request().url()).pathname.slice(1);
    if(path==='provider.html')return route.fulfill({contentType:'text/html',body:content});
    if(path==='fixture.js')return route.fulfill({contentType:'text/javascript',body:boot});
    if(['provider-feedback-media-v3.js','provider-feedback.js','styles.css'].includes(path))return route.fulfill({contentType:path.endsWith('.css')?'text/css':'text/javascript',body:read(path)});
    return route.abort();
  });
  await page.goto('https://feedback.test/provider.html');
  if(!['delayed','offline-start'].includes(capability)){await page.evaluate(()=>ready);await page.click('[data-open-product-feedback]');await page.fill('#productFeedbackMessage','Синтетическая проверка подключения формы');}
  try{await run(page,context);assert.deepEqual(errors,[]);console.log('PASS '+name);passed++;}finally{await context.close();}
}
const send=async page=>{await page.click('#productFeedbackSubmit');await page.waitForFunction(()=>!document.querySelector('#productFeedbackUploadProgress').hidden?false:document.querySelector('#productFeedbackSubmit').textContent!=='Отправляем…');};
const tick=page=>page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));
const createCalls=page=>page.evaluate(()=>calls.filter(c=>c.name.startsWith('create_minuta_feedback')));
try{
  await scenario('initial offline controller selects one engine when browser reconnects','offline-start',async(page,context)=>{
    await context.setOffline(true);await page.evaluate(()=>controller.refreshAvailability());
    assert.equal(await page.locator('[data-open-product-feedback]').isVisible(),false);assert.equal(await page.evaluate(()=>calls.length),0);
    await context.setOffline(false);await page.click('[data-open-product-feedback]');
    assert.equal(await page.locator('#productFeedbackFileField').isVisible(),false);
    assert.equal(await page.evaluate(()=>calls.filter(c=>c.name==='get_minuta_feedback_media_capability').length),1);
  });
  for(const mode of ['disabled','missing','throw'])await scenario(mode+' capability uses only text legacy, no Storage',mode,async page=>{
    assert.equal(await page.locator('#productFeedbackFileField').isVisible(),false);
    await send(page);assert.equal(await page.locator('#productFeedbackSuccess').isVisible(),true);
    const calls=await createCalls(page);assert.equal(calls.length,1);assert.equal(calls[0].name,'create_minuta_feedback');assert.equal(calls[0].args.p_screenshot_path,null);
    assert.equal(await page.evaluate(()=>window.calls.some(c=>c.name==='upload')),false);
  });
  await scenario('media confirmed: real form video control, single create and local preview','media',async page=>{
    await page.setInputFiles('#productFeedbackScreenshot',{name:'synthetic.mp4',mimeType:'video/mp4',buffer:Buffer.from('synthetic')});
    assert.equal(await page.locator('.feedback-media-item video').count(),1);
    assert.equal(await page.locator('.feedback-media-item video').getAttribute('autoplay'),null);
    assert.equal(await page.locator('.product-feedback-dialog').evaluate(node=>node.scrollWidth<=node.clientWidth),true);
    await send(page);const calls=await createCalls(page);assert.equal(calls.length,1);assert.equal(calls[0].name,'create_minuta_feedback_media_v3');assert.equal(calls[0].args.p_attachments.length,1);
  });
  for(const mode of ['media','disabled'])await scenario(mode+' first rejection unlocks, preserves text, retries once',mode,async page=>{
    await page.evaluate(()=>{outcome='rejected';});await send(page);
    assert.equal(await page.locator('#productFeedbackMessage').isEnabled(),true);
    await page.fill('#productFeedbackMessage','Исправленное синтетическое обращение');await page.evaluate(()=>{outcome='ok';});await send(page);
    assert.equal((await createCalls(page)).length,2);assert.equal(await page.locator('#productFeedbackSuccess').isVisible(),true);
  });
  for(const outcome of ['throw','malformed'])await scenario('media '+outcome+' uses exact request retry and no legacy fallback','media',async page=>{
    await page.evaluate(outcome=>{window.outcome=outcome;},outcome);await send(page);
    const before=await createCalls(page);assert.equal(await page.locator('#productFeedbackMessage').isEnabled(),false);
    await page.evaluate(()=>{outcome='ok';});await send(page);const after=await createCalls(page);
    assert.equal(after.length,2);assert.deepEqual(after[0].args,after[1].args);assert.deepEqual(after[0],before[0]);
  });
  for(const outcome of ['throw','malformed'])await scenario('text '+outcome+' blocks duplicate through close/reopen and reload','disabled',async page=>{
    await page.evaluate(outcome=>{window.outcome=outcome;},outcome);await send(page);
    assert.equal(await page.locator('#productFeedbackSubmit').isDisabled(),true);
    await page.click('[aria-label="Закрыть"]');await page.click('[data-open-product-feedback]');
    assert.equal(await page.locator('#productFeedbackSubmit').isDisabled(),true);assert.equal((await createCalls(page)).length,1);
    await page.reload();await page.evaluate(()=>ready);await page.click('[data-open-product-feedback]');
    assert.equal(await page.locator('#productFeedbackSubmit').isDisabled(),true);assert.equal((await createCalls(page)).length,0);
  });
  for(const mode of ['media','disabled'])await scenario(mode+' rebind/refresh never installs a second submit handler',mode,async page=>{
    await page.evaluate(async()=>{controller.bind();controller.bind();await controller.refreshAvailability();outcome='deferred';});
    await page.click('#productFeedbackSubmit');await page.waitForFunction(()=>window.finish);
    await page.evaluate(()=>document.querySelector('#productFeedbackForm').requestSubmit());
    assert.equal((await createCalls(page)).length,1);
  });
  for(const mode of ['media','disabled'])await scenario(mode+' actual org hook hides old form and rejects late response',mode,async page=>{
    await page.evaluate(()=>{outcome='deferred';});await page.click('#productFeedbackSubmit');await page.waitForFunction(()=>window.finish);
    await page.evaluate(()=>switchOrg('00000000-0000-4000-8000-000000000011'));await page.click('[data-open-product-feedback]');
    await page.fill('#productFeedbackMessage','Черновик новой организации');
    await page.evaluate(()=>{const old=calls.find(c=>c.name.startsWith('create_minuta_feedback')).args;finish({data:{request_id:old.p_request_id,request_number:15,organization_id:old.p_organization},error:null});});await tick(page);
    assert.equal(await page.locator('#productFeedbackMessage').inputValue(),'Черновик новой организации');assert.equal(await page.locator('#productFeedbackSuccess').isVisible(),false);assert.equal(await page.evaluate(()=>notifications.length),0);
  });
  await scenario('stale initial capability cannot choose engine for replacement org','delayed',async page=>{
    await page.waitForFunction(()=>window.capResolve);await page.evaluate(()=>{window.oldResolve=capResolve;capability='disabled';switchOrg('00000000-0000-4000-8000-000000000011');});
    await page.click('[data-open-product-feedback]');
    await page.evaluate(()=>oldResolve({data:{version:3,max_files:5,video_bytes:20971520,total_bytes:41943040},error:null}));await tick(page);
    assert.equal(await page.locator('#productFeedbackFileField').isVisible(),false);
  });
  await scenario('selected media disabled later never dispatches legacy fallback','media',async page=>{
    await page.evaluate(()=>{outcome='throw';});await send(page);
    await page.evaluate(async()=>{capability='disabled';await controller.refreshAvailability();});
    await page.evaluate(()=>document.querySelector('#productFeedbackForm').requestSubmit());await tick(page);
    assert.equal((await createCalls(page)).length,1);assert.equal((await createCalls(page))[0].name,'create_minuta_feedback_media_v3');
  });
  await scenario('media pending reload restores exact snapshot and request ID','media',async page=>{
    await page.evaluate(()=>{outcome='throw';});await send(page);const original=(await createCalls(page))[0].args;
    await page.reload();await page.evaluate(()=>ready);await page.click('[data-open-product-feedback]');
    assert.equal(await page.locator('#productFeedbackMessage').isEnabled(),false);await send(page);
    assert.deepEqual((await createCalls(page))[0].args,original);
  });
  await scenario('media unknown then reload with disabled SQL cannot become a new legacy request','media',async page=>{
    await page.evaluate(()=>{outcome='throw';});await send(page);
    const draft=await page.evaluate(()=>sessionStorage.getItem('minuta-feedback-v3:'+currentUser.id+':'+organization.id));
    await page.addInitScript(()=>{window.fixtureCapability='disabled';});await page.reload();await page.evaluate(()=>ready);
    assert.equal(await page.locator('[data-open-product-feedback]').isVisible(),false);assert.equal((await createCalls(page)).length,0);
    const after=JSON.parse(await page.evaluate(()=>sessionStorage.getItem('minuta-feedback-v3:'+currentUser.id+':'+organization.id)));
    const before=JSON.parse(draft),{at:beforeAt,...beforeIntent}=before,{at:afterAt,...afterIntent}=after;
    // Actual pagehide refreshes draft age, but must preserve every intent/payload field.
    assert.deepEqual(afterIntent,beforeIntent);assert.ok(afterAt>=beforeAt);
    assert.equal(await page.evaluate(()=>calls.some(c=>c.name==='get_minuta_feedback_capability')),false);
  });
  await scenario('legacy unknown then enabled media reload cannot become a new media request','disabled',async page=>{
    await page.evaluate(()=>{outcome='throw';});await send(page);
    await page.addInitScript(()=>{window.fixtureCapability='media';});await page.reload();await page.evaluate(()=>ready);await page.click('[data-open-product-feedback]');
    assert.equal(await page.locator('#productFeedbackSubmit').isDisabled(),true);
    assert.equal(await page.locator('#productFeedbackFileField').isVisible(),false);assert.equal((await createCalls(page)).length,0);
  });
  for(const mode of ['media','disabled'])await scenario(mode+' real same-actor session-reset hook invalidates late ACK',mode,async page=>{
    await page.evaluate(()=>{outcome='deferred';});await page.click('#productFeedbackSubmit');await page.waitForFunction(()=>window.finish);
    await page.evaluate(async()=>{window.dispatchEvent(new CustomEvent('minuta:provider-session-reset'));await controller.refreshAvailability();});await page.click('[data-open-product-feedback]');
    await page.evaluate(()=>{const old=calls.find(c=>c.name.startsWith('create_minuta_feedback')).args;finish({data:{request_id:old.p_request_id,request_number:15,organization_id:old.p_organization},error:null});});await tick(page);
    assert.equal(await page.locator('#productFeedbackSuccess').isVisible(),false);assert.equal(await page.evaluate(()=>notifications.length),0);
  });
  await scenario('legacy malformed number cannot confirm or unlock another create','disabled',async page=>{
    await page.evaluate(()=>{outcome='array-number';});await send(page);
    assert.equal(await page.locator('#productFeedbackSuccess').isVisible(),false);assert.equal(await page.locator('#productFeedbackSubmit').isDisabled(),true);
  });
  await scenario('legacy durable marker failure prevents any CREATE','disabled',async page=>{
    await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw Error('quota');};});await send(page);
    assert.equal((await createCalls(page)).length,0);assert.equal(await page.locator('#productFeedbackMessage').isEnabled(),true);
  });
  await scenario('legacy confirmed acknowledgement permits explicit new request','disabled',async page=>{
    await send(page);await page.click('[data-new-product-feedback]');await page.fill('#productFeedbackMessage','Новое отдельное синтетическое обращение');await send(page);
    assert.equal((await createCalls(page)).length,2);assert.equal(await page.evaluate(()=>notifications.length),2);
  });
  console.log(`${passed} wiring browser scenarios PASS; actual form/CSP/CSS/init/reset hooks, synthetic RPC/Storage. No production E2E.`);
}finally{await browser.close();}
