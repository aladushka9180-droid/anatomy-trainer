import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const playwrightModule=process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright';
const {chromium}=await import(playwrightModule);
const root=fileURLToPath(new URL('../',import.meta.url));
const output=process.env.MINUTA_LOYALTY_AUDIT_OUTPUT_DIR;
if(output)fs.mkdirSync(output,{recursive:true});
const html=fs.readFileSync(path.join(root,'provider.html'),'utf8').replace(/<script\b[\s\S]*?<\/script>/gi,'');
const server=createServer((req,res)=>{
  const file=new URL(req.url,'http://localhost').pathname.slice(1);
  if(!file){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}
  if(!/^[a-z0-9_.-]+$/i.test(file)){res.writeHead(404).end();return;}
  try{res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/javascript');res.end(fs.readFileSync(path.join(root,file)));}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
const checks=[],perf=[];
const selectedCases=process.env.AUDIT_CASES?.split(',');
async function setup(existingPage){
  const page=existingPage||await browser.newPage({viewport:{width:390,height:1000}});
  await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
  await page.goto(origin);
  await page.evaluate(()=>{
    const panel=document.querySelector('#loyaltyPanel'),card=document.querySelector('#clientMilestoneCard'),orbit=document.querySelector('#clientProfileOrbit');
    const view=document.querySelector('[data-provider-panel="organization"]'),dashboard=document.querySelector('#dashboard');
    view.replaceChildren(panel);dashboard.replaceChildren(view);dashboard.hidden=false;view.hidden=false;panel.hidden=false;
    document.body.replaceChildren(dashboard);if(card)document.body.append(card);if(orbit)document.body.append(orbit);
    document.documentElement.className='top-level provider-ready';document.body.className='provider-body';document.body.dataset.providerLayout='bento';document.body.dataset.providerTheme='pink-porcelain';
  });
  await page.addScriptTag({url:origin+'/loyalty-program-v166.js?v=1085'});
  await page.evaluate(async()=>{
    window.fixture={gen:1,uid:'synthetic-owner',delay:0,failFirstAdjustment:false,failedOnce:false,readFailure:false,heldRead:false,readResolve:null,processed:[],calls:[],actualProgress:1,notifications:[],state:{organization_id:'synthetic-org',enabled:true,rule:{id:'rule-old',goal_visits:10,reward_kind:'percent',reward_value:1000,reward_title:'Скидка 10%',reward_terms:'Одна услуга',validity_days:90},clients:[{id:'client-one',client_name:'Синтетический клиент'}],accounts:[{client_account_id:'client-one',goal_visits:10,progress:1}],rewards:[],history:[],stats:{issued:0,redeemed:0}}};
    const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const db={async rpc(name,p){
      const f=window.fixture;f.calls.push({name,parameters:structuredClone(p)});
      if(name==='get_minuta_loyalty_program_workspace_v166'){
        const value=structuredClone({...f.state,organization_id:p.p_organization});
        if(f.heldRead){f.heldRead=false;return new Promise(resolve=>{f.readResolve=()=>resolve({data:value});});}
        return f.readFailure?{error:{code:'FETCH_FAILED'}}:{data:value};
      }
      if(f.delay)await new Promise(r=>setTimeout(r,f.delay));
      if(name==='adjust_minuta_loyalty_progress_v166'){
        if(f.adjustmentDenied)return {error:{code:'42501',message:'Synthetic membership denial before request replay lookup'}};
        if(!f.processed.includes(p.p_request_id)){f.processed.push(p.p_request_id);f.actualProgress+=p.p_delta;const account=f.state.accounts.find(a=>a.client_account_id===p.p_client_account);if(account)account.progress=f.actualProgress;}
        if(f.failFirstAdjustment&&!f.failedOnce){f.failedOnce=true;return {error:{code:'FETCH_FAILED'}};}
      }
      if(name==='set_minuta_loyalty_program_v166'){
        f.state.enabled=p.p_enabled;
        if(p.p_enabled)f.state.rule={id:'rule-new',goal_visits:p.p_goal_visits,reward_kind:p.p_reward_kind,reward_value:p.p_reward_value,reward_title:p.p_reward_title,reward_terms:p.p_reward_terms,validity_days:p.p_validity_days};
      }
      if(name==='redeem_minuta_loyalty_reward_v166')f.state.rewards.find(r=>r.id===p.p_reward).status='redeemed';
      return {data:{ok:true}};
    }};
    window.controller=window.MinutaLoyalty.createController({db,escapeHtml:esc,notify:x=>fixture.notifications.push(x),requireWrites:()=>true,getCurrentUser:()=>({id:fixture.uid}),getSessionGeneration:()=>fixture.gen,sessionIsCurrent:(id,g)=>fixture.uid===id&&fixture.gen===g,applyWriteAvailability:()=>{}});
    controller.bind();await controller.setOrganization({id:'synthetic-org'});
  });
  await page.waitForFunction(()=>document.querySelector('#loyaltySoftStyles')?.sheet);
  return page;
}
async function check(key,block,expected,fn){
  if(process.env.AUDIT_PERF_ONLY==='1')return;
  if(selectedCases&&!selectedCases.includes(key))return;
  const page=await setup();
  try{const evidence=await fn(page);checks.push({key,block,status:'PASS',expected,evidence:evidence??null});}
  catch(e){checks.push({key,block,status:'FAIL',expected,actual:String(e.message)});if(output)await page.screenshot({path:path.join(output,`${key}.png`),fullPage:true});}
  finally{await page.close();}
}
async function adjustment(page){await page.locator('.loyalty-operation summary').click();await page.locator('#loyaltyAdjustmentClient').selectOption('client-one');await page.locator('#loyaltyAdjustmentPoints').fill('1');await page.locator('#loyaltyAdjustmentReason').fill('Повтор исходного действия');}
try{
  await check('old-cycle-card-reward',6,'Карточка клиента показывает награду старого незавершённого цикла',async page=>{
    await page.evaluate(async()=>{fixture.state.accounts=[{client_account_id:'client-one',goal_visits:2,progress:1,rule_id:'rule-old',reward_title:'Скидка 10%'}];fixture.state.rule={id:'rule-new',goal_visits:3,reward_kind:'fixed',reward_value:250,reward_title:'Скидка 250 ₽',validity_days:90};await controller.load();controller.setClient({clientAccountId:'client-one'});});
    const text=await page.locator('#clientMilestoneHint').innerText();assert.ok(text.includes('Скидка 10%'),`Shown: ${text}; current unfinished cycle reward is 10%`);
  });
  await check('uncertain-adjustment-message',7,'Потерянный ответ обозначается как неподтверждённый результат',async page=>{
    await adjustment(page);await page.evaluate(()=>fixture.failFirstAdjustment=true);await page.locator('#loyaltyAdjustmentForm button').click();
    const text=await page.locator('#loyaltyAdjustmentError').innerText();const progress=await page.evaluate(()=>fixture.actualProgress);
    assert.ok(/подтверд|неизвест|проверьте (?:актуальные|свежие)/i.test(text),`UI: ${text}; simulated server already applied progress=${progress}`);
  });
  await check('storage-denial-retry',7,'При недоступном хранилище исходный повтор не удваивает корректировку',async page=>{
    await adjustment(page);await page.evaluate(()=>{fixture.failFirstAdjustment=true;Object.defineProperty(Storage.prototype,'setItem',{value(){throw new DOMException('Synthetic storage unavailable','QuotaExceededError');}});});
    await page.locator('#loyaltyAdjustmentForm button').click();await page.locator('#loyaltyAdjustmentError').waitFor({state:'visible'});await page.locator('#loyaltyAdjustmentForm button').click();
    const value=await page.evaluate(()=>({progress:fixture.actualProgress,requests:fixture.calls.filter(c=>c.name==='adjust_minuta_loyalty_progress_v166').map(c=>c.parameters.p_request_id)}));
    assert.equal(value.progress,1,'Storage failure must stop the first write, not mint a replacement identity');assert.equal(value.requests.length,0);assert.match(await page.locator('#loyaltyAdjustmentError').innerText(),/не отправлено|не сохранил/);
  });
  await check('normal-retry-one-request',7,'При доступном хранилище потерянный ответ повторяется с прежним идентификатором',async page=>{
    await adjustment(page);await page.evaluate(()=>fixture.failFirstAdjustment=true);await page.locator('#loyaltyAdjustmentForm button').click();await page.locator('#loyaltyAdjustmentError').waitFor({state:'visible'});await page.locator('#loyaltyAdjustmentForm button').click();
    const value=await page.evaluate(()=>({progress:fixture.actualProgress,requests:fixture.calls.filter(c=>c.name==='adjust_minuta_loyalty_progress_v166').map(c=>c.parameters.p_request_id)}));assert.equal(value.progress,2);assert.equal(value.requests[0],value.requests[1]);return value;
  });
  await check('unknown-retry-membership-denial',7,'Временный отказ доступа после потерянного ответа сохраняет исходную операцию, включая перезагрузку',async page=>{
    await adjustment(page);await page.evaluate(()=>fixture.failFirstAdjustment=true);
    await page.locator('#loyaltyAdjustmentForm button').click();await page.locator('#loyaltyAdjustmentError').waitFor({state:'visible'});
    await page.evaluate(()=>fixture.adjustmentDenied=true);await page.locator('#loyaltyAdjustmentForm button').click();
    const deniedBeforeReload=await page.locator('#loyaltyAdjustmentError').innerText();
    const previous=await page.evaluate(()=>({progress:fixture.actualProgress,processed:fixture.processed,accounts:fixture.state.accounts,ids:fixture.calls.filter(c=>c.name==='adjust_minuta_loyalty_progress_v166').map(c=>c.parameters.p_request_id)}));
    await setup(page);await page.evaluate(async previous=>{fixture.actualProgress=previous.progress;fixture.processed=previous.processed;fixture.state.accounts=previous.accounts;await controller.load();fixture.adjustmentDenied=true;},previous);
    await adjustment(page);await page.locator('#loyaltyAdjustmentForm button').click();
    const deniedAfterReload=await page.locator('#loyaltyAdjustmentError').innerText();
    await page.evaluate(()=>fixture.adjustmentDenied=false);await page.locator('#loyaltyAdjustmentForm button').click();
    const replay=await page.evaluate(()=>({progress:fixture.actualProgress,ids:fixture.calls.filter(c=>c.name==='adjust_minuta_loyalty_progress_v166').map(c=>c.parameters.p_request_id)}));
    const originalAttempts=[...previous.ids,...replay.ids];
    assert.equal(replay.progress,2,`Lost-response operation was counted again: progress=${replay.progress}, ids=${JSON.stringify(originalAttempts)}`);
    assert.equal(new Set(originalAttempts).size,1,'Every retry must retain the original request identity');
    assert.match(deniedBeforeReload,/не удалось подтвердить результат/i);assert.match(deniedAfterReload,/не удалось подтвердить результат/i);
    await page.locator('#loyaltyAdjustmentClient').selectOption('client-one');await page.locator('#loyaltyAdjustmentPoints').fill('2');await page.locator('#loyaltyAdjustmentReason').fill('Первоначальный подтверждённый отказ');
    await page.evaluate(()=>fixture.adjustmentDenied=true);await page.locator('#loyaltyAdjustmentForm button').click();
    assert.match(await page.locator('#loyaltyAdjustmentError').innerText(),/Действие отклонено/);
    await page.evaluate(()=>fixture.adjustmentDenied=false);await page.locator('#loyaltyAdjustmentPoints').fill('3');await page.locator('#loyaltyAdjustmentReason').fill('Новое действие после подтверждённого отказа');await page.locator('#loyaltyAdjustmentForm button').click();
    assert.equal(await page.evaluate(()=>fixture.actualProgress),5,'A first confirmed rejection must release its identity and permit a changed new action');
    return {progressAfterReplay:replay.progress,originalAttempts,unknownResultSurvivedReload:true,initialConfirmedRejectionReleased:true,note:'Synthetic membership check precedes replay lookup; no real Auth, database or business RPC'};
  });
  await check('disable-with-invalid-draft',5,'Выключение программы не блокируется пустым полем награды в черновике',async page=>{
    await page.locator('#editLoyaltyProgram').click();await page.locator('#loyaltyClientText summary').click();await page.locator('#loyaltyRewardTitle').fill('');await page.locator('#loyaltyEnabled').uncheck();await page.locator('#loyaltyProgramForm button[type="submit"]').click();
    const value=await page.evaluate(()=>({enabled:fixture.state.enabled,calls:fixture.calls.filter(c=>c.name==='set_minuta_loyalty_program_v166').length,invalid:document.querySelector('#loyaltyRewardTitle').validationMessage}));assert.equal(value.enabled,false,JSON.stringify(value));
  });
  await check('text-reward-inactive-value',1,'Текстовая награда сохраняется независимо от скрытого числового поля',async page=>{
    await page.locator('#editLoyaltyProgram').click();await page.locator('#loyaltyRewardValue').fill('0');await page.locator('#loyaltyRewardKind').selectOption('text');await page.locator('#loyaltyClientText summary').click();await page.locator('#loyaltyRewardTitle').fill('Дополнение к услуге');await page.locator('#loyaltyProgramForm button[type="submit"]').click();
    const value=await page.evaluate(()=>({kind:fixture.state.rule.reward_kind,calls:fixture.calls.filter(c=>c.name==='set_minuta_loyalty_program_v166').length,invalid:document.querySelector('#loyaltyRewardValue').validationMessage}));assert.equal(value.kind,'text',JSON.stringify(value));
  });
  await check('old-session-response-ignored',7,'Ответ прежней сессии не заменяет текущие данные',async page=>{
    const value=await page.evaluate(async()=>{fixture.heldRead=true;const pending=controller.load();fixture.gen++;fixture.readResolve();const loaded=await pending;return {loaded,payloadOrganization:controller.payload.organization_id};});assert.equal(value.loaded,false);return value;
  });
  await check('old-organization-response-ignored',6,'Поздний ответ предыдущей организации отбрасывается',async page=>{
    const value=await page.evaluate(async()=>{fixture.heldRead=true;const pending=controller.load();await controller.setOrganization({id:'synthetic-other-org'});fixture.readResolve();await pending;return controller.payload.organization_id;});assert.equal(value,'synthetic-other-org');
  });
  await check('redeem-confirmation-cancel',4,'Отмена подтверждения не отправляет использование награды',async page=>{
    await page.evaluate(async()=>{fixture.state.rewards=[{id:'reward-one',client_account_id:'client-one',status:'pending',reward_kind:'percent',reward_value:1000,reward_title:'Скидка 10%'}];await controller.load();});
    page.once('dialog',d=>d.dismiss());await page.locator('[data-redeem-loyalty-reward]').click();assert.equal(await page.evaluate(()=>fixture.calls.filter(c=>c.name==='redeem_minuta_loyalty_reward_v166').length),0);
  });
  await check('html-escaping',1,'Имена, причины и названия выводятся как текст',async page=>{
    await page.evaluate(async()=>{const payload='<img src=x onerror=alert(1)>';fixture.state.clients[0].client_name=payload;fixture.state.rewards=[{id:'reward-one',client_account_id:'client-one',status:'pending',reward_kind:'text',reward_title:payload,reward_terms:payload}];fixture.state.history=[{event_type:'manual_adjustment',client_account_id:'client-one',reason:payload,created_at:'2026-10-01'}];await controller.load();});
    assert.equal(await page.locator('#loyaltyBalancesList img,#loyaltyRewardsList img,#loyaltyLedgerList img').count(),0);
  });
  await check('request-survives-reload',7,'После перезагрузки сохраняется идентификатор исходной неподтверждённой корректировки',async page=>{
    await adjustment(page);await page.evaluate(()=>fixture.failFirstAdjustment=true);await page.locator('#loyaltyAdjustmentForm button').click();await page.locator('#loyaltyAdjustmentError').waitFor({state:'visible'});
    const original=await page.evaluate(()=>fixture.calls.find(c=>c.name==='adjust_minuta_loyalty_progress_v166').parameters.p_request_id);
    await setup(page);await adjustment(page);await page.locator('#loyaltyAdjustmentForm button').click();
    const recovered=await page.evaluate(()=>fixture.calls.find(c=>c.name==='adjust_minuta_loyalty_progress_v166').parameters.p_request_id);assert.equal(recovered,original);return {sameRequest:true,note:'Browser reload identity verified; server idempotence is covered independently by PGlite'};
  });
  await check('prepared-retry-storage-lost',7,'Уже подготовленный запрос сохраняет идентификатор при последующем отказе хранилища',async page=>{
    await adjustment(page);await page.evaluate(()=>fixture.failFirstAdjustment=true);await page.locator('#loyaltyAdjustmentForm button').click();await page.locator('#loyaltyAdjustmentError').waitFor({state:'visible'});
    await page.evaluate(()=>{Object.defineProperty(Storage.prototype,'getItem',{value(){throw new DOMException('Synthetic storage unavailable','SecurityError');}});Object.defineProperty(Storage.prototype,'setItem',{value(){throw new DOMException('Synthetic storage unavailable','SecurityError');}});});
    await page.locator('#loyaltyAdjustmentForm button').click();const value=await page.evaluate(()=>({progress:fixture.actualProgress,ids:fixture.calls.filter(c=>c.name==='adjust_minuta_loyalty_progress_v166').map(c=>c.parameters.p_request_id)}));assert.equal(value.progress,2);assert.equal(value.ids[0],value.ids[1]);
  });
  await check('unknown-intent-parameter-change',7,'Неопределённое действие не подменяется другим запросом',async page=>{
    await adjustment(page);await page.evaluate(()=>fixture.failFirstAdjustment=true);await page.locator('#loyaltyAdjustmentForm button').click();await page.locator('#loyaltyAdjustmentError').waitFor({state:'visible'});await page.locator('#loyaltyAdjustmentPoints').fill('2');await page.locator('#loyaltyAdjustmentForm button').click();
    assert.equal(await page.evaluate(()=>fixture.calls.filter(c=>c.name==='adjust_minuta_loyalty_progress_v166').length),1);assert.match(await page.locator('#loyaltyAdjustmentError').innerText(),/предыдущего действия/);
    await page.locator('#loyaltyAdjustmentPoints').fill('1');await page.locator('#loyaltyAdjustmentForm button').click();assert.equal(await page.evaluate(()=>fixture.actualProgress),2);
  });
  await check('old-server-cycle-fallback',6,'Старый RPC не заставляет карточку обещать награду новых правил',async page=>{
    await page.evaluate(async()=>{fixture.state.accounts=[{client_account_id:'client-one',goal_visits:2,progress:1,rule_id:'rule-old'}];fixture.state.rule={id:'rule-new',goal_visits:3,reward_kind:'fixed',reward_value:250,reward_title:'Скидка 250 ₽',validity_days:90};await controller.load();controller.setClient({clientAccountId:'client-one'});});
    const text=await page.locator('#clientMilestoneHint').innerText();assert.ok(!text.includes('250'));assert.match(text,/условиям вашего цикла/);
  });
  await check('all-paged-clients-and-rewards-accessible',8,'Порции списка сохраняют доступ ко всем клиентам, наградам и корректировкам',async page=>{
    await page.evaluate(async()=>{fixture.state.clients=Array.from({length:123},(_,i)=>({id:`paged-${i}`,client_name:`Paged ${i}`}));fixture.state.accounts=fixture.state.clients.map(c=>({client_account_id:c.id,goal_visits:10,progress:1}));fixture.state.rewards=fixture.state.clients.map((c,i)=>({id:`paged-reward-${i}`,client_account_id:c.id,status:'pending',reward_kind:'percent',reward_value:1000,reward_title:'Скидка 10%'}));fixture.state.stats={issued:123,redeemed:0};await controller.load();controller.setClient({clientAccountId:'paged-122'});});
    assert.equal(await page.locator('.loyalty-client-row').count(),50);assert.equal(await page.locator('.loyalty-reward-row').count(),50);assert.equal(await page.locator('#loyaltyAdjustmentClient option').count(),124);assert.match(await page.locator('#clientMilestoneText').innerText(),/Награда доступна.*10%/);assert.equal(await page.locator('#clientMilestoneProgress').getAttribute('aria-valuenow'),'1');
    for(const kind of ['clients','rewards']){
      const selector=kind==='clients'?'.loyalty-client-row':'.loyalty-reward-row';
      const seen=await page.locator(selector).allTextContents();
      await page.locator(`[data-loyalty-page="${kind}"][data-direction="next"]`).click();assert.equal(await page.locator(selector).count(),50);seen.push(...await page.locator(selector).allTextContents());
      await page.locator(`[data-loyalty-page="${kind}"][data-direction="next"]`).click();assert.equal(await page.locator(selector).count(),23);seen.push(...await page.locator(selector).allTextContents());
      assert.equal(new Set(seen).size,123);assert.equal(await page.locator(`[data-loyalty-page="${kind}"][data-direction="next"]`).isDisabled(),true);
      await page.locator(`[data-loyalty-page="${kind}"][data-direction="previous"]`).click();assert.equal(await page.locator(selector).count(),50);
    }
    for(const width of [390,760,1440]){
      await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth)<=width+1);
      if(output)await page.locator('[data-loyalty-pagination="clients"]').screenshot({path:path.join(output,`pagination-${width}.png`)});
    }
    await page.locator('.loyalty-operation summary').click();await page.locator('#loyaltyAdjustmentClient').selectOption('paged-122');await page.locator('#loyaltyAdjustmentPoints').fill('1');await page.locator('#loyaltyAdjustmentReason').fill('Тест клиента вне первой порции');await page.locator('#loyaltyAdjustmentForm button').click();assert.equal(await page.evaluate(()=>fixture.calls.find(c=>c.name==='adjust_minuta_loyalty_progress_v166').parameters.p_client_account),'paged-122');
    await page.evaluate(()=>controller.setOrganization({id:'synthetic-other-org'}));assert.equal(await page.locator('.loyalty-client-row').count(),50);assert.equal(await page.locator('.loyalty-reward-row').count(),50);
  });
  if(!selectedCases){
  const page=await setup();await page.setViewportSize({width:1440,height:1000});
  for(const size of [100,1000,5000]){
    await page.evaluate(size=>{
      fixture.state.clients=Array.from({length:size},(_,i)=>({id:`synthetic-${i}`,client_name:`Synthetic ${i}`}));
      fixture.state.accounts=fixture.state.clients.map(c=>({client_account_id:c.id,goal_visits:10,progress:1}));
      fixture.state.rewards=fixture.state.clients.map((c,i)=>({id:`reward-${i}`,client_account_id:c.id,status:'pending',reward_kind:'percent',reward_value:1000,reward_title:'Synthetic reward',expires_at:'2030-01-01'}));fixture.state.stats={issued:size,redeemed:0};fixture.state.history=[];
    },size);
    const value=await page.evaluate(async()=>{
      const measure=async()=>{const start=performance.now();await controller.load();document.querySelector('#loyaltyPanel').getBoundingClientRect();return performance.now()-start;};
      const firstMs=await measure(),times=[];for(let i=0;i<30;i++)times.push(await measure());times.sort((a,b)=>a-b);
      return {firstMs,medianMs:times[15],p95Ms:times[28],clientRows:document.querySelectorAll('.loyalty-client-row').length,rewardRows:document.querySelectorAll('.loyalty-reward-row').length,payloadBytes:new TextEncoder().encode(JSON.stringify(fixture.state)).length};
    });
    perf.push({syntheticClients:size,samples:30,...Object.fromEntries(Object.entries(value).map(([k,v])=>[k,typeof v==='number'?+v.toFixed(2):v])),note:'Desktop browser, fake immediate RPC; same workload as original audit; controller plus layout; not network or physical mobile latency'});
  }
  await page.close();
  }
  const result={environment:'Loopback-only browser fixture with public HTML/controller/styles; fake RPC; installed headless Edge; no live app session',checks,performance:perf,summary:{total:checks.length,pass:checks.filter(c=>c.status==='PASS').length,fail:checks.filter(c=>c.status==='FAIL').length}};
  if(output)fs.writeFileSync(path.join(output,selectedCases?'browser-audit-additional.json':'browser-audit.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({summary:result.summary,failures:checks.filter(c=>c.status==='FAIL'),performance:perf},null,2));assert.equal(result.summary.fail,0,'All browser hardening scenarios must pass');
}finally{await browser.close();await new Promise(r=>server.close(r));}
