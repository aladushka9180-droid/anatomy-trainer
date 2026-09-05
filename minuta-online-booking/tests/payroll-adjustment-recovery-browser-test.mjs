import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

// Native DOM + FULL actual payroll controller. Auth/bootstrap are not executed.
// Local SDK adapter models sequential v72:558-589 INSERT/total/audit only: every
// accepted call inserts a NEW adjustment. There is no request_id or amount dedupe.
// No SQL execution, transport/concurrency/production payroll or full E2E claim.
// Intentionally RED on v450; do not include in green CI before a real fix.
const source=readFileSync(process.env.MINUTA_PAYROLL_SOURCE||new URL('../payroll-management.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../provider.html',import.meta.url),'utf8');
const icons=readFileSync(new URL('../ui-icons.svg',import.meta.url),'utf8');
const modulePath=process.env.MINUTA_PLAYWRIGHT_MODULE;
const {chromium}=await import(modulePath?(/^[a-z]+:/i.test(modulePath)&&!/^\w:[\\/]/.test(modulePath)?modulePath:pathToFileURL(modulePath).href):'playwright');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const org=id(1),actor=id(2),performer=id(3),period=id(4);
const orgB=id(11),actorB=id(12),performerB=id(13),periodB=id(14);
let browser;

async function fixture(){
  const context=await browser.newContext(),page=await context.newPage(),errors=[],traffic=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{
    if(route.request().url()==='https://payroll-adjustment.test/')return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ru"><body></body></html>'});
    if(route.request().url()==='https://payroll-adjustment.test/ui-icons.svg')return route.fulfill({contentType:'image/svg+xml',body:icons});
    traffic.push(route.request().url());return route.abort();
  });
  await page.goto('https://payroll-adjustment.test/');
  await page.evaluate(html=>{
    const parsed=new DOMParser().parseFromString(html,'text/html'),panel=parsed.querySelector('#payrollPanel');
    if(!panel)throw Error('Missing actual provider payroll panel');
    document.body.append(document.importNode(panel,true));
  },html);
  await page.addScriptTag({content:source});
  await page.evaluate(async({org,actor,performer,period,orgB,actorB,performerB,periodB})=>{
    const clone=value=>JSON.parse(JSON.stringify(value));
    window.calls=[];window.ledger=[];window.audit=[];window.notices=[];
    window.replyMode='success';window.failRecoveryLoad=false;
    window.session={user:actor,generation:1};window.gates=[];window.deferMutation=false;
    const scopes=new Map([[org,{performer,period}],[orgB,{performer:performerB,period:periodB}]]);
    const total=(scope=org)=>10000+ledger.filter(row=>row.organization_id===scope).reduce((sum,row)=>sum+row.amount_rub,0);
    window.fixtureTotal=total;
    const workspace=scope=>{const selected=scopes.get(scope);return {organization_id:scope,current_role:'owner',can_manage:true,enabled:true,
      members:[{id:selected.performer,display_name:scope===org?'Специалист A':'Специалист B',role:'specialist',is_bookable:true}],locations:[],plans:[],
      periods:[{id:selected.period,name:'Сентябрь',location_id:null,starts_on:'2026-09-01',ends_on:'2026-09-30',status:'draft',total_revenue_rub:25000,total_payroll_rub:total(scope)}],
      items:[{id:'item-1',period_id:selected.period,performer_id:selected.performer,booking_id:'booking-1',amount_rub:25000,rate_bps:4000,payroll_rub:10000,service_name:'Услуга',booking_date:'2026-09-01'}],
      adjustments:clone(ledger.filter(row=>row.organization_id===scope)),audit:clone(audit.filter(row=>row.organization_id===scope))};};
    const db={rpc:async(name,args)=>{
      calls.push({name,args:clone(args)});
      if(name==='get_minuta_payroll_workspace'){
        if(!scopes.has(args.p_organization))throw Error('Wrong fixture scope');
        if(failRecoveryLoad&&ledger.length){failRecoveryLoad=false;return {data:null,error:{code:'08006',message:'workspace connection lost'}};}
        return {data:workspace(args.p_organization),error:null};
      }
      if(name!=='add_minuta_payroll_adjustment')throw Error('Unexpected mutating RPC '+name);
      if(Object.keys(args).sort().join(',')!=='p_amount_rub,p_organization,p_performer,p_period,p_reason')throw Error('This adapter supports ONLY actual v72 five-argument contract');
      const selected=scopes.get(args.p_organization);
      if(!selected||args.p_period!==selected.period||args.p_performer!==selected.performer||!Number.isInteger(args.p_amount_rub)||!args.p_amount_rub||Math.abs(args.p_amount_rub)>10000000||args.p_reason.trim().length<3)throw Error('Invalid fixture adjustment, do not mask validation');
      const adjustmentId=crypto.randomUUID();
      ledger.push({id:adjustmentId,organization_id:args.p_organization,period_id:selected.period,performer_id:selected.performer,amount_rub:args.p_amount_rub,reason:args.p_reason.trim()});
      audit.push({id:crypto.randomUUID(),organization_id:args.p_organization,action:'payroll_adjustment_added',subject_id:adjustmentId,created_at:'2026-09-06T00:00:00Z'});
      const ack={data:{id:adjustmentId,organization_id:args.p_organization,period_id:selected.period,total_payroll_rub:total(args.p_organization)},error:null};
      if(deferMutation)return new Promise((resolve,reject)=>gates.push({resolve,reject,ack,organization:args.p_organization}));
      const mode=replyMode;replyMode='success';
      if(mode==='lost')return {data:null,error:{code:'08006',message:'connection lost after commit'}};
      if(mode==='null')return {data:null,error:null};
      if(mode==='partial')return {data:{organization_id:org},error:null};
      return ack;
    }};
    const $=selector=>document.querySelector(selector);
    $('#payrollStartDate').value='2026-09-01';$('#payrollEndDate').value='2026-09-30';
    window.controller=MinutaPayroll.createController({db,$,escapeHtml:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
      notify:message=>notices.push(message),requireWrites:()=>true,getCurrentUser:()=>session.user?{id:session.user}:null,getSessionGeneration:()=>session.generation,
      sessionIsCurrent:(user,generation)=>user===session.user&&generation===session.generation,applyWriteAvailability(){}});
    controller.bind();await controller.setOrganization({id:org,current_role:'owner'});
  },{org,actor,performer,period,orgB,actorB,performerB,periodB});
  return {context,page,errors,traffic};
}
const submitSelector='#payrollAdjustmentForm button[type="submit"]';
async function fill(page){await page.locator('#payrollAdjustmentAmount').fill('500');await page.locator('#payrollAdjustmentReason').fill('Премия за дополнительную работу');}
async function settle(page){await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));}
async function submit(page){
  assert.equal(await page.locator('#payrollAdjustmentForm').evaluate(form=>form.checkValidity()),true,'Native constraint validation must not hide a retry defect');
  await page.locator(submitSelector).click();await settle(page);
}
async function state(page){return page.evaluate(()=>({ledger:structuredClone(ledger),audit:structuredClone(audit),notices:[...notices],calls:structuredClone(calls),total:fixtureTotal(),
  amount:document.querySelector('#payrollAdjustmentAmount').value,reason:document.querySelector('#payrollAdjustmentReason').value,
  error:document.querySelector('#payrollAdjustmentError').hidden?'':document.querySelector('#payrollAdjustmentError').textContent,
  summary:document.querySelector('#payrollPeriodsList').textContent,available:controller.availability,
  disabled:document.querySelector('#payrollAdjustmentForm button[type="submit"]').disabled,
  buttonText:document.querySelector('#payrollAdjustmentForm button[type="submit"]').textContent,
  payloadOrg:controller.payload?.organization_id||null,panelHidden:document.querySelector('#payrollPanel').hidden,
  workspaceHidden:document.querySelector('#payrollWorkspace').hidden}));}
async function committedReply(page,mode){
  await fill(page);await page.evaluate(mode=>{replyMode=mode;window.originalForm=document.querySelector('#payrollAdjustmentForm');},mode);
  await submit(page);const first=await state(page);
  assert.equal(first.ledger.length,1);assert.equal(first.audit.length,1);assert.equal(first.total,10500);
  assert.equal(first.calls.filter(row=>row.name==='get_minuta_payroll_workspace').length,2,'Actual mutation recovery must load server state');
  assert.match(first.summary,/10\s*500/,'Real render must display the already committed total');
  return first;
}
async function retryIfAvailable(page){
  if(!await page.locator(submitSelector).isDisabled())await submit(page);
  else {await page.locator('#payrollAdjustmentForm').evaluate(form=>form.requestSubmit(form.querySelector('button[type="submit"]')));await settle(page);}
}
const cases=[
  ['SAFETY commit500 then lost reply, actual reload and same-form retry must not insert twice',async page=>{
    const first=await committedReply(page,'lost');
    assert.equal(await page.evaluate(()=>originalForm===document.querySelector('#payrollAdjustmentForm')),true);
    assert.equal(first.amount,'500');assert.equal(first.reason,'Премия за дополнительную работу');
    await retryIfAvailable(page);const after=await state(page);
    assert.equal(after.ledger.length,1,'Unknown result must not silently repeat non-idempotent v72 INSERT');assert.equal(after.total,10500);assert.equal(after.audit.length,1);
  }],
  ['SAFETY committed adjustment with network error must not claim nothing changed',async page=>{
    const first=await committedReply(page,'lost');const text=[first.error,...first.notices].join(' ');
    assert.doesNotMatch(text,/изменение не сохранено|корректировка не (?:сохранена|добавлена)|ничего не измен/i,'Transport failure does not prove adjustment rollback; no cash payment is claimed');
    assert.match(text,/подтверд|проверь|неопредел|свер/i,'Explain uncertain result or reconciliation');
  }],
  ['SAFETY organization-only ACK must not claim confirmed adjustment',async page=>{
    const first=await committedReply(page,'partial');
    assert.ok(!first.notices.includes('Корректировка добавлена'),'v72 ACK requires id, period_id and total, not organization only');
    await retryIfAvailable(page);assert.equal((await state(page)).ledger.length,1);
  }],
  ['SAFETY null ACK and successful workspace read do not authorize automatic retry',async page=>{
    await committedReply(page,'null');await retryIfAvailable(page);const after=await state(page);
    assert.equal(after.ledger.length,1);assert.equal(after.total,10500);
  }],
  ['SAFETY native retry-workspace button must not clear the unresolved adjustment',async page=>{
    await fill(page);await page.evaluate(()=>{replyMode='lost';failRecoveryLoad=true;});await submit(page);
    assert.equal(await page.locator('#payrollUnavailable').isVisible(),true);
    await page.locator('#reloadPayroll').click();await settle(page);const loaded=await state(page);
    assert.equal(loaded.available,'ready');assert.equal(loaded.calls.filter(row=>row.name==='get_minuta_payroll_workspace').length,3);
    assert.match(loaded.summary,/10\s*500/);await retryIfAvailable(page);
    assert.equal((await state(page)).ledger.length,1,'Reload is not acknowledgement of a new adjustment');
  }],
  ['CONTROL confirmed ACK then explicit new equal adjustment remains a legitimate second operation',async page=>{
    const first=await committedReply(page,'success');assert.ok(first.notices.includes('Корректировка добавлена'));
    // Re-entering values and clicking submit after known success is a new action.
    await fill(page);await submit(page);const after=await state(page);
    assert.equal(after.ledger.length,2);assert.equal(after.audit.length,2);assert.equal(after.total,11000);
    assert.notEqual(after.ledger[0].id,after.ledger[1].id,'Never dedupe independent adjustments by equal amount');
  }],
  ['CONTROL real native required field prevents empty adjustment without any RPC',async page=>{
    await page.locator(submitSelector).click();await settle(page);const current=await state(page);
    assert.equal(await page.locator('#payrollAdjustmentForm').evaluate(form=>form.checkValidity()),false);
    assert.equal(current.ledger.length,0);assert.equal(current.calls.length,1);
  }]
];
async function startPending(page){
  await fill(page);await page.evaluate(()=>{deferMutation=true;});await submit(page);
  assert.equal(await page.evaluate(()=>gates.length),1,'Actual submit must reach the deferred SDK boundary');
}
async function release(page,index,outcome){
  await page.evaluate(({index,outcome})=>{
    const gate=gates[index];if(!gate)throw Error('Missing deferred adjustment');
    if(outcome==='throw')gate.reject(Error('connection lost after commit'));
    else gate.resolve(outcome==='success'?gate.ack:{data:null,error:{code:'08006',message:'connection lost after commit'}});
  },{index,outcome});await settle(page);
}
async function inputChangeAndResubmit(page){
  await page.locator('#payrollAdjustmentForm').evaluate(form=>{
    // Native events, including programmatic submission past a disabled button.
    // This does not claim disabled fields are editable by an ordinary user.
    for(const input of [form.querySelector('#payrollAdjustmentAmount'),form.querySelector('#payrollAdjustmentReason')]){
      input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));
      input.dispatchEvent(new Event('change',{bubbles:true}));
    }
    if(!form.checkValidity())throw Error('Validation must not mask pending-submit safety');
    form.requestSubmit(form.querySelector('button[type="submit"]'));
  });await settle(page);
}
for(const outcome of ['success','error','throw'])cases.push([
  `SAFETY pending adjustment ${outcome}: native double submit and input/change do not unlock a second INSERT`,async page=>{
    await startPending(page);await inputChangeAndResubmit(page);
    assert.equal((await state(page)).ledger.length,1);assert.equal(await page.locator(submitSelector).isDisabled(),true);
    await release(page,0,outcome);
    if(outcome!=='success'){await inputChangeAndResubmit(page);assert.equal((await state(page)).ledger.length,1,'Unknown latch survives native input/change');}
  }
]);
for(const transition of ['organization','account','logout'])for(const outcome of ['success','error','throw'])cases.push([
  `SAFETY queued ${transition} during pending A ${outcome} suppresses stale feedback and loads only destination`,async page=>{
    await startPending(page);
    // Same public methods and identity/generation hooks passed by provider.
    // provider handleSession -> organization.reset -> active-org callback(null)
    // is represented at that boundary; no invented payroll reset event handler.
    await page.evaluate(async({transition,orgB,actorB})=>{
      if(transition!=='organization'){
        session.generation++;session.user=transition==='logout'?null:actorB;
        window.dispatchEvent(new CustomEvent('minuta:provider-session-reset'));
        await controller.setOrganization(null);
      }
      if(transition!=='logout')await controller.setOrganization({id:orgB,current_role:'owner'});
    },{transition,orgB,actorB});
    assert.equal((await state(page)).workspaceHidden,true,'Hide source payroll during queued context change');
    await release(page,0,outcome);const current=await state(page);
    assert.deepEqual(current.notices,[],'A outcome is not feedback for B');
    assert.equal(current.error,'','Do not put A transport error into destination form');
    const reads=current.calls.filter(call=>call.name==='get_minuta_payroll_workspace').map(call=>call.args.p_organization);
    assert.deepEqual(reads,transition==='logout'?[org]:[org,orgB],'Drain the final queued context once, including rejected promises');
    assert.equal(current.payloadOrg,transition==='logout'?null:orgB);
    if(transition==='logout')assert.equal(current.panelHidden,true);
    else {assert.equal(current.available,'ready');assert.equal(current.workspaceHidden,false);assert.equal(current.disabled,false);}
  }
]);
for(const outcome of ['success','error','throw'])cases.push([
  `SAFETY public reset then B pending: old A ${outcome} cannot release B busy or replace its button text`,async page=>{
    await startPending(page);
    // Explicit PUBLIC controller.reset lifecycle, not a claim that provider calls
    // payroll.reset directly. Same instance only: restart/durable intent is outside
    // this in-memory controller test; no storage recovery API is invented.
    await page.evaluate(async({orgB,actorB})=>{
      controller.reset();session.generation++;session.user=actorB;
      await controller.setOrganization({id:orgB,current_role:'owner'});
    },{orgB,actorB});
    await fill(page);await submit(page);assert.equal(await page.evaluate(()=>gates.length),2);
    const before=await state(page);await release(page,0,outcome);const after=await state(page);
    assert.equal(after.disabled,true);assert.equal(after.buttonText,before.buttonText,'Late finally must not modify a different pending operation');
    assert.equal(after.payloadOrg,before.payloadOrg);assert.deepEqual(after.notices,before.notices);assert.equal(after.error,before.error);
    await inputChangeAndResubmit(page);assert.equal((await state(page)).ledger.length,2,'A completion cannot clear B single-flight');
    await release(page,1,'success');assert.equal((await state(page)).notices.filter(message=>message==='Корректировка добавлена').length,1);
  }
]);
let failed=0;
try{
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
  for(const [name,run] of cases){const f=await fixture();try{await run(f.page);assert.deepEqual(f.errors,[]);assert.deepEqual(f.traffic,[]);console.log('PASS '+name);}catch(error){failed++;console.error('FAIL '+name+'\n'+error.stack);}finally{await f.context.close();}}
}finally{await browser?.close();}
console.log(`${cases.length-failed}/${cases.length} native payroll cases passed; full controller, synthetic v72 ledger, no SQL`);
process.exitCode=failed?1:0;
