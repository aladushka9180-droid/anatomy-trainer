import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const source=readFileSync(new URL('../provider-feedback-media-v3.js',import.meta.url),'utf8');
const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
const html=`<!doctype html><button data-open-product-feedback>Открыть</button><dialog id="productFeedbackDialog">
<form id="productFeedbackForm"><input type="radio" id="productFeedbackKindProblem" name="kind" value="problem" checked><input type="radio" name="kind" value="suggestion">
<label><span id="productFeedbackMessageLabel"></span><textarea id="productFeedbackMessage"></textarea></label><div id="productFeedbackExpectedField"></div>
<span id="productFeedbackAttachmentLabel"></span><input type="file" id="productFeedbackScreenshot"><span id="productFeedbackFileStatus"></span>
<div id="productFeedbackAttachments"></div><p id="productFeedbackDraftStatus"></p><progress id="productFeedbackUploadProgress" hidden></progress>
<p id="productFeedbackUploadStatus"></p><p id="productFeedbackError" hidden></p><button id="productFeedbackSubmit">Отправить</button></form>
<section id="productFeedbackSuccess" hidden><b id="productFeedbackRequestNumber"></b><button data-new-product-feedback>Ещё</button></section>
<button data-close-product-feedback>Закрыть</button></dialog>`;
let passed=0;
async function scenario(name,run){
  const context=await browser.newContext(),page=await context.newPage();
  await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:html}));
  await page.goto('https://feedback.test/');
  await page.addScriptTag({content:source});
  await page.evaluate(()=>{
    window.actor={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'};window.organization={id:'org-A'};window.calls=[];window.notifications=[];
    window.mode='ok';window.lookup=null;window.deferResolve=null;window.counter=0;window.releaseMode='ok';
    window.createId=()=>`00000000-0000-4000-8000-${String(++counter).padStart(12,'0')}`;
    window.db={rpc:async(name,args)=>{
      calls.push({name,args:args?JSON.parse(JSON.stringify(args)):null});
      if(name==='get_minuta_feedback_media_capability')return {data:{version:3,max_files:5,video_bytes:20*1048576,total_bytes:40*1048576}};
      if(name==='get_my_minuta_feedback_request_v3')return {data:lookup};
      if(name==='reserve_minuta_feedback_upload_v3')return {data:{path:`${actor.id}/${args.p_request_id}/${args.p_attachment_id}.webp`,uploaded:false}};
      if(name==='release_minuta_feedback_upload_v3'){
        if(releaseMode==='throw')throw new TypeError('Failed to fetch');
        if(releaseMode==='deferred')return new Promise(resolve=>{window.releaseResolve=resolve;});
        return {data:releaseMode==='false'?false:releaseMode==='null'?null:true,error:null};
      }
      if(name==='create_minuta_feedback_media_v3'){
        if(mode==='rejected')return {error:{code:'P0001',message:'feedback_daily_limit'}};
        if(mode==='wrong-refusal-code')return {error:{code:'22023',message:'feedback_daily_limit'}};
        if(mode==='network')throw new TypeError('Failed to fetch');
        if(mode==='null')return {data:null};
        if(mode==='wrong')return {data:{request_id:'wrong',request_number:12,organization_id:'org-A'}};
        if(mode==='deferred')return new Promise(resolve=>{deferResolve=resolve;});
        return {data:{request_id:args.p_request_id,request_number:12,organization_id:args.p_organization}};
      }
      throw new Error('Unexpected RPC '+name);
    },storage:{from:()=>({upload:async(path,blob)=>{calls.push({name:'upload',path,size:blob.size});if(window.uploadThrows)throw new TypeError('Failed to fetch');return {data:{path}};}})}};
    window.writes=true;
    window.controller=MinutaFeedbackMediaV3.createController({db,$:s=>document.querySelector(s),notify:m=>notifications.push(m),requireWrites:()=>writes,getCurrentUser:()=>actor,getOrganization:()=>organization},
      {createId,prepareScreenshot:async()=>window.holdPhoto?new Promise(resolve=>{window.photoResolve=resolve;}):new Blob(['synthetic-webp'],{type:'image/webp'}),clientVersion:()=> 'test',deviceSummary:()=> 'synthetic browser'});
    controller.bind();
  });
  await page.evaluate(()=>controller.refreshAvailability());
  await page.click('[data-open-product-feedback]');
  await page.fill('#productFeedbackMessage','Проверка отправки обратной связи');
  try{await run(page,context);console.log('PASS '+name);passed++;}finally{await context.close();}
}
const send=async page=>{await page.click('#productFeedbackSubmit');await page.waitForFunction(()=>!document.querySelector('#productFeedbackSubmit').disabled);};
const withPhoto=page=>page.setInputFiles('#productFeedbackScreenshot',{name:'photo.png',mimeType:'image/png',buffer:Buffer.from('synthetic')});
try{
  await scenario('confirmed refusal unlocks message and attachment editing',async page=>{
    await withPhoto(page);await page.evaluate(()=>{mode='rejected';});await send(page);
    assert.equal(await page.locator('#productFeedbackMessage').isEnabled(),true);
    assert.equal(await page.locator('#productFeedbackScreenshot').isEnabled(),true);
    assert.equal(await page.locator('[data-feedback-remove]').isEnabled(),true);
    assert.equal(await page.locator('#productFeedbackAttachments figure').count(),1);
    assert.equal(await page.locator('#productFeedbackSuccess').isVisible(),false);
    await page.fill('#productFeedbackMessage','Исправленный текст после отказа');
    await page.evaluate(()=>{mode='ok';});await send(page);
    assert.equal(await page.locator('#productFeedbackSuccess').isVisible(),true);
    assert.equal(await page.evaluate(()=>calls.filter(c=>c.name==='upload').length),1);
  });
  await scenario('uncertain response retries exact request without uploading twice',async page=>{
    await withPhoto(page);await page.evaluate(()=>{mode='network';});await send(page);
    assert.equal(await page.locator('#productFeedbackMessage').isEnabled(),false);
    const original=await page.evaluate(()=>calls.find(c=>c.name==='create_minuta_feedback_media_v3').args);
    await page.evaluate(()=>{mode='ok';});await send(page);
    const submitted=await page.evaluate(()=>calls.filter(c=>c.name==='create_minuta_feedback_media_v3').map(c=>c.args));
    assert.deepEqual(submitted,[original,original]);assert.equal(await page.evaluate(()=>calls.filter(c=>c.name==='upload').length),1);
    assert.equal(await page.locator('#productFeedbackSuccess').isVisible(),true);
  });
  await scenario('lookup confirms previously committed request without another create',async page=>{
    await page.evaluate(()=>{mode='network';});await send(page);
    await page.evaluate(()=>{const args=calls.find(c=>c.name==='create_minuta_feedback_media_v3').args;lookup={request_id:args.p_request_id,request_number:17,organization_id:args.p_organization};});
    await send(page);assert.equal(await page.locator('#productFeedbackRequestNumber').textContent(),'17');
    assert.equal(await page.evaluate(()=>calls.filter(c=>c.name==='create_minuta_feedback_media_v3').length),1);
  });
  await scenario('refusal after unknown keeps immutable attachment and request',async page=>{
    await withPhoto(page);await page.evaluate(()=>{mode='network';});await send(page);
    await page.evaluate(()=>{mode='rejected';});await send(page);
    assert.equal(await page.locator('#productFeedbackMessage').isEnabled(),false);
    assert.equal(await page.locator('[data-feedback-remove]').isEnabled(),false);
    assert.equal(await page.evaluate(()=>calls.filter(c=>c.name==='release_minuta_feedback_upload_v3').length),0);
    const submitted=await page.evaluate(()=>calls.filter(c=>c.name==='create_minuta_feedback_media_v3').map(c=>c.args));
    assert.deepEqual(submitted[0],submitted[1]);
  });
  await scenario('unreserved attachment removal is local and makes no release call',async page=>{
    await withPhoto(page);await page.click('[data-feedback-remove]');
    assert.equal(await page.locator('#productFeedbackAttachments figure').count(),0);
    assert.equal(await page.evaluate(()=>calls.filter(c=>c.name==='release_minuta_feedback_upload_v3').length),0);
  });
  await scenario('unknown upload can release its known reservation without a create',async page=>{
    await withPhoto(page);await page.evaluate(()=>{window.uploadThrows=true;});await send(page);
    await page.click('[data-feedback-remove]');await page.waitForFunction(()=>!document.querySelector('#productFeedbackSubmit').disabled);
    assert.equal(await page.locator('#productFeedbackAttachments figure').count(),0);
    const calls=await page.evaluate(()=>window.calls);
    assert.equal(calls.filter(c=>c.name==='create_minuta_feedback_media_v3').length,0);
    assert.equal(calls.find(c=>c.name==='release_minuta_feedback_upload_v3').args.p_path,calls.find(c=>c.name==='upload').path);
  });
  await scenario('unmatched SQLSTATE/message pair is not a proven refusal',async page=>{
    await page.evaluate(()=>{mode='wrong-refusal-code';});await send(page);
    assert.equal(await page.locator('#productFeedbackMessage').isEnabled(),false);
    assert.equal(await page.locator('#productFeedbackSuccess').isVisible(),false);
  });
  await scenario('reserved removal waits for true release ACK, then excludes file from create',async page=>{
    await withPhoto(page);await page.evaluate(()=>{mode='rejected';});await send(page);
    const original=await page.evaluate(()=>calls.find(c=>c.name==='create_minuta_feedback_media_v3').args);
    await page.click('[data-feedback-remove]');await page.waitForFunction(()=>!document.querySelector('#productFeedbackSubmit').disabled);
    assert.equal(await page.locator('#productFeedbackAttachments figure').count(),0);
    assert.deepEqual(await page.evaluate(()=>calls.find(c=>c.name==='release_minuta_feedback_upload_v3').args),{p_request_id:original.p_request_id,p_path:original.p_attachments[0].path});
    await page.evaluate(()=>{mode='ok';});await send(page);
    assert.deepEqual(await page.evaluate(()=>calls.filter(c=>c.name==='create_minuta_feedback_media_v3').at(-1).args.p_attachments),[]);
  });
  for(const outcome of ['throw','false','null'])await scenario('unconfirmed release '+outcome+' retains attachment; retry uses same path',async page=>{
    await withPhoto(page);await page.evaluate(()=>{mode='rejected';});await send(page);
    await page.evaluate(outcome=>{releaseMode=outcome;},outcome);await page.click('[data-feedback-remove]');
    await page.waitForFunction(()=>!document.querySelector('#productFeedbackSubmit').disabled);
    assert.equal(await page.locator('#productFeedbackAttachments figure').count(),1);
    assert.match(await page.locator('#productFeedbackError').textContent(),/Не удалось подтвердить снятие/);
    await page.evaluate(()=>{releaseMode='ok';});await page.click('[data-feedback-remove]');
    await page.waitForFunction(()=>!document.querySelector('#productFeedbackSubmit').disabled);
    const calls=await page.evaluate(()=>window.calls.filter(c=>c.name==='release_minuta_feedback_upload_v3'));
    assert.deepEqual(calls[0].args,calls[1].args);assert.equal(await page.locator('#productFeedbackAttachments figure').count(),0);
  });
  await scenario('late release does not remove a replacement organization attachment',async page=>{
    await withPhoto(page);await page.evaluate(()=>{mode='rejected';});await send(page);
    await page.evaluate(()=>{releaseMode='deferred';});await page.click('[data-feedback-remove]');await page.waitForFunction(()=>window.releaseResolve);
    await page.evaluate(async()=>{organization={id:'org-B'};controller.reset();await controller.refreshAvailability();document.querySelector('[data-open-product-feedback]').click();});
    await withPhoto(page);await page.fill('#productFeedbackMessage','Новая форма другой организации');
    await page.evaluate(async()=>{releaseResolve({data:true,error:null});await new Promise(resolve=>setTimeout(resolve,0));});
    assert.equal(await page.locator('#productFeedbackAttachments figure').count(),1);
    assert.equal(await page.locator('#productFeedbackMessage').inputValue(),'Новая форма другой организации');
    assert.equal(await page.locator('#productFeedbackSubmit').isEnabled(),true);
  });
  for(const mode of ['null','wrong'])await scenario(mode+' ACK cannot clear draft or claim success',async page=>{
    await page.evaluate(mode=>{window.mode=mode;},mode);await send(page);
    assert.equal(await page.locator('#productFeedbackSuccess').isVisible(),false);
    assert.equal(await page.evaluate(()=>notifications.length),0);
    assert.equal(await page.locator('#productFeedbackMessage').isEnabled(),false);
    assert.ok(await page.evaluate(()=>Object.values(sessionStorage).some(v=>v.includes('Проверка отправки'))));
  });
  await scenario('same actor/org reset invalidates late result by generation',async page=>{
    await page.evaluate(()=>{mode='deferred';});await page.click('#productFeedbackSubmit');await page.waitForFunction(()=>deferResolve);
    await page.evaluate(async()=>{const args=calls.find(c=>c.name==='create_minuta_feedback_media_v3').args;controller.reset();await controller.refreshAvailability();document.querySelector('[data-open-product-feedback]').click();deferResolve({data:{request_id:args.p_request_id,request_number:18,organization_id:'org-A'}});});
    await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));
    assert.equal(await page.locator('#productFeedbackSuccess').isVisible(),false);assert.equal(await page.evaluate(()=>notifications.length),0);
  });
  await scenario('organization switch cannot show previous success or erase new text',async page=>{
    await page.evaluate(()=>{mode='deferred';});await page.click('#productFeedbackSubmit');await page.waitForFunction(()=>deferResolve);
    await page.evaluate(async()=>{organization={id:'org-B'};controller.reset();await controller.refreshAvailability();document.querySelector('[data-open-product-feedback]').click();});
    await page.fill('#productFeedbackMessage','Другой черновик новой организации');
    await page.evaluate(()=>{const args=calls.find(c=>c.name==='create_minuta_feedback_media_v3').args;deferResolve({data:{request_id:args.p_request_id,request_number:18,organization_id:'org-A'}});});
    await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));
    assert.equal(await page.locator('#productFeedbackMessage').inputValue(),'Другой черновик новой организации');
    assert.equal(await page.locator('#productFeedbackSuccess').isVisible(),false);
  });
  await scenario('durable draft failure prevents dispatch',async page=>{
    await page.evaluate(()=>{Storage.prototype.setItem=function(){throw new Error('quota');};});await send(page);
    assert.equal(await page.evaluate(()=>calls.filter(c=>c.name==='create_minuta_feedback_media_v3'||c.name==='upload').length),0);
    assert.equal(await page.locator('#productFeedbackMessage').isEnabled(),true);
  });
  await scenario('double submit dispatches once',async page=>{
    await page.evaluate(()=>{mode='deferred';document.querySelector('#productFeedbackForm').dispatchEvent(new Event('submit',{cancelable:true}));document.querySelector('#productFeedbackForm').dispatchEvent(new Event('submit',{cancelable:true}));});
    await page.waitForFunction(()=>deferResolve);assert.equal(await page.evaluate(()=>calls.filter(c=>c.name==='create_minuta_feedback_media_v3').length),1);
  });
  await scenario('write permission revoked during photo preparation prevents subsequent writes',async page=>{
    await withPhoto(page);await page.evaluate(()=>{window.holdPhoto=true;});await page.click('#productFeedbackSubmit');await page.waitForFunction(()=>window.photoResolve);
    await page.evaluate(()=>{writes=false;photoResolve(new Blob(['synthetic'],{type:'image/webp'}));});
    await page.waitForFunction(()=>!document.querySelector('#productFeedbackSubmit').disabled);
    assert.equal(await page.evaluate(()=>calls.filter(c=>c.name==='reserve_minuta_feedback_upload_v3'||c.name==='upload'||c.name==='create_minuta_feedback_media_v3').length),0);
  });
  console.log(`Feedback v3 candidate: ${passed} isolated browser scenarios; synthetic RPC/Storage, not server or production E2E.`);
}finally{await browser.close();}
