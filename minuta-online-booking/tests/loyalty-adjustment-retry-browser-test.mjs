import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

// Native provider DOM and FULL controller/bound handlers/render; no bootstrap.
// Synthetic sequential v81:273-294 ledger models (org,request_id) replay and
// client/delta/trim(reason) conflict. It is NOT SQL/ACL/concurrency execution.
// Equal amounts are not deduped. Actor/org lifecycle uses public controller API
// and its actual identity callbacks; full provider handleSession is not executed.
// Reset is the SAME controller instance, not durable browser-restart recovery.
const source=readFileSync(process.env.MINUTA_LOYALTY_SOURCE||new URL('../loyalty-management.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../provider.html',import.meta.url),'utf8');
const icons=readFileSync(new URL('../ui-icons.svg',import.meta.url),'utf8');
const modulePath=process.env.MINUTA_PLAYWRIGHT_MODULE;
const {chromium}=await import(modulePath?pathToFileURL(modulePath).href:'playwright');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const org=id(1),orgB=id(2),actor=id(3),actorB=id(4),client=id(5),client2=id(6);
const reason='Бонусы за участие в мероприятии';
const button='#loyaltyAdjustmentForm button[type="submit"]';
let browser;
async function fixture(){
  const context=await browser.newContext(),page=await context.newPage(),errors=[],traffic=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{
    const url=route.request().url();
    if(url==='https://loyalty-adjustment.test/')return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ru"><body></body></html>'});
    if(url==='https://loyalty-adjustment.test/ui-icons.svg')return route.fulfill({contentType:'image/svg+xml',body:icons});
    traffic.push(url);return route.abort();
  });
  await page.goto('https://loyalty-adjustment.test/');
  await page.evaluate(html=>{
    const panel=new DOMParser().parseFromString(html,'text/html').querySelector('#loyaltyPanel');
    if(!panel)throw Error('Actual loyalty panel missing');document.body.append(document.importNode(panel,true));
  },html);
  await page.addScriptTag({content:source});
  await page.evaluate(async({org,orgB,actor,client,client2})=>{
    const clone=value=>JSON.parse(JSON.stringify(value));
    window.rows=[];window.calls=[];window.notices=[];window.gates=[];
    window.session={user:actor,generation:1};window.replyMode='success';window.deferReply=false;window.failRead=false;
    const accountId=(scope,who)=>`00000000-0000-4000-8000-${String((scope===org?10:20)+(who===client?1:2)).padStart(12,'0')}`;
    const balance=(scope,who)=>rows.filter(row=>row.organization_id===scope&&row.client_account_id===who).reduce((sum,row)=>sum+row.points_delta,0);
    const workspace=scope=>({organization_id:scope,current_role:'owner',enabled:true,rule:{earn_rate_bps:500,min_paid_amount_rub:0},max_redeem_percent_bps:3000,
      clients:[{id:client,client_name:'Клиент 1',client_phone:'+79990000001'},{id:client2,client_name:'Клиент 2',client_phone:'+79990000002'}],bookings:[],
      accounts:[client,client2].map(who=>({id:accountId(scope,who),client_account_id:who,balance_points:balance(scope,who),lifetime_earned:balance(scope,who),lifetime_spent:0})),
      promotions:[],promo_redemptions:[],ledger:clone(rows.filter(row=>row.organization_id===scope))});
    const db={rpc:async(name,args)=>{
      calls.push({name,args:clone(args)});
      if(name==='get_minuta_loyalty_workspace'){
        if(![org,orgB].includes(args.p_organization))throw Error('Unknown fixture org');
        if(failRead){failRead=false;throw Error('workspace connection lost');}
        return {data:workspace(args.p_organization),error:null};
      }
      if(name!=='adjust_minuta_loyalty_balance')throw Error('Unexpected write '+name);
      if(![org,orgB].includes(args.p_organization)||![client,client2].includes(args.p_client_account)||!Number.isInteger(args.p_points_delta)||!args.p_points_delta||Math.abs(args.p_points_delta)>1000000||args.p_reason.trim().length<8)throw Error('Invalid fixture payload; validation must not mask safety');
      const previous=rows.find(row=>row.organization_id===args.p_organization&&row.request_id===args.p_request_id);
      let row=previous;
      if(previous){
        if(previous.client_account_id!==args.p_client_account||previous.points_delta!==args.p_points_delta||previous.reason!==args.p_reason.trim())return {data:null,error:{code:'23505',message:'loyalty_request_conflict'}};
      }else{
        const after=balance(args.p_organization,args.p_client_account)+args.p_points_delta;
        if(after<0)return {data:null,error:{code:'55000',message:'insufficient_loyalty_balance'}};
        if(after>10000000)throw Error('Outside actual v81 account/ledger check constraint');
        row={id:rows.length+1,organization_id:args.p_organization,account_id:accountId(args.p_organization,args.p_client_account),client_account_id:args.p_client_account,
          event_type:'manual_adjustment',points_delta:args.p_points_delta,balance_after:after,reason:args.p_reason.trim(),request_id:args.p_request_id};rows.push(row);
      }
      const ack={data:{organization_id:row.organization_id,account_id:row.account_id,balance_points:row.balance_after},error:null};
      if(deferReply)return new Promise((resolve,reject)=>gates.push({resolve,reject,ack}));
      const mode=replyMode;replyMode='success';
      if(mode==='lost')return {data:null,error:{code:'08006',message:'connection lost after commit'}};
      if(mode==='throw')throw Error('connection lost after commit');
      if(mode==='null')return {data:null,error:null};
      if(mode==='partial')return {data:{organization_id:row.organization_id},error:null};
      if(mode==='upper')return {data:{...ack.data,balance_points:10000001},error:null};
      return ack;
    }};
    const $=selector=>document.querySelector(selector);
    window.controller=MinutaLoyalty.createController({db,$,escapeHtml:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
      notify:message=>notices.push(message),requireWrites:()=>true,getCurrentUser:()=>session.user?{id:session.user}:null,getSessionGeneration:()=>session.generation,
      sessionIsCurrent:(user,generation)=>user===session.user&&generation===session.generation,applyWriteAvailability(){}});
    controller.bind();await controller.setOrganization({id:org,current_role:'owner'});
  },{org,orgB,actor,client,client2});
  return {context,page,errors,traffic};
}
async function settle(page){await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));}
async function fill(page,who=client){await page.locator('#loyaltyAdjustmentClient').selectOption(who);await page.locator('#loyaltyAdjustmentPoints').fill('100');await page.locator('#loyaltyAdjustmentReason').fill(reason);}
async function submit(page){
  assert.equal(await page.locator('#loyaltyAdjustmentForm').evaluate(form=>form.checkValidity()),true,'Native validation must not suppress retry');
  if(await page.locator(button).isDisabled())await page.locator('#loyaltyAdjustmentForm').evaluate(form=>form.requestSubmit(form.querySelector('button[type="submit"]')));
  else await page.locator(button).click();await settle(page);
}
async function state(page){return page.evaluate(()=>({rows:structuredClone(rows),calls:structuredClone(calls),notices:[...notices],
  error:document.querySelector('#loyaltyAdjustmentError').hidden?'':document.querySelector('#loyaltyAdjustmentError').textContent,
  summary:document.querySelector('#loyaltyLedgerList').textContent,client:document.querySelector('#loyaltyAdjustmentClient').value,
  points:document.querySelector('#loyaltyAdjustmentPoints').value,reason:document.querySelector('#loyaltyAdjustmentReason').value,
  disabled:document.querySelector('#loyaltyAdjustmentForm button[type="submit"]').disabled,text:document.querySelector('#loyaltyAdjustmentForm button[type="submit"]').textContent,
  available:controller.availability,payloadOrg:controller.payload?.organization_id||null,hidden:document.querySelector('#loyaltyWorkspace').hidden}));}
const writes=s=>s.calls.filter(row=>row.name==='adjust_minuta_loyalty_balance');
async function uncertain(page,mode='lost',who=client){await fill(page,who);await page.evaluate(mode=>{replyMode=mode;},mode);await submit(page);
  const s=await state(page);assert.equal(s.rows.length,1);assert.match(s.summary,/остаток 100/,'Actual recovery load must show the committed ledger');return s;}
async function edit(page,selector,value,event='change'){await page.locator(selector).evaluate((node,{value,event})=>{node.value=value;node.dispatchEvent(new Event(event,{bubbles:true}));},{value,event});}
async function release(page,index,outcome){await page.evaluate(({index,outcome})=>{const gate=gates[index];if(!gate)throw Error('Missing deferred');if(outcome==='throw')gate.reject(Error('connection lost after commit'));else gate.resolve(outcome==='success'?gate.ack:{data:null,error:{code:'08006',message:'connection lost after commit'}});},{index,outcome});await settle(page);}
const cases=[];
for(const [label,selector,value,event] of [['no-op client','#loyaltyAdjustmentClient',client,'change'],['no-op amount','#loyaltyAdjustmentPoints','100','change'],['trim equivalent','#loyaltyAdjustmentReason',reason+' ','change'],['numeric equivalent','#loyaltyAdjustmentPoints','100.0','input']])cases.push([
  `SAFETY unknown ${label} retries original request key only`,async page=>{
    const first=await uncertain(page);await edit(page,selector,value,event);await submit(page);const s=await state(page);
    assert.equal(s.rows.length,1);assert.equal(writes(s).length,2);assert.deepEqual(writes(s)[1].args,writes(first)[0].args);
  }
]);
cases.push(['SAFETY edited then reverted unknown is the original intent',async page=>{
  const first=await uncertain(page);await edit(page,'#loyaltyAdjustmentPoints','200');await edit(page,'#loyaltyAdjustmentPoints','100');await submit(page);
  const s=await state(page);assert.equal(s.rows.length,1);assert.deepEqual(writes(s)[1].args,writes(first)[0].args);
}]);
for(const [field,value] of [['Client',client2],['Points','200'],['Reason','Совсем другая причина начисления']])cases.push([
  `POLICY changed unknown ${field} restores original for review WITHOUT RPC, then explicit retry`,async page=>{
    const first=await uncertain(page);await edit(page,'#loyaltyAdjustment'+field,value);await submit(page);const restored=await state(page);
    assert.equal(writes(restored).length,1,'Editing an unresolved operation does not authorize silent replay or new operation');
    assert.equal(restored.client,client);assert.equal(restored.points,'100');assert.equal(restored.reason,reason);assert.match(restored.error,/исходн|возвращен/i);
    await submit(page);const s=await state(page);assert.equal(s.rows.length,1);assert.deepEqual(writes(s)[1].args,writes(first)[0].args);
  }
]);
for(const mode of ['partial','null','throw','upper'])cases.push([`SAFETY ${mode} ACK stays unknown and exact retry does not duplicate`,async page=>{
  const first=await uncertain(page,mode);assert.equal(first.notices.includes('Баланс скорректирован'),false);assert.equal(first.points,'100');assert.match(first.error,/подтверд|проверь/i);
  await submit(page);const s=await state(page);assert.equal(s.rows.length,1);assert.deepEqual(writes(s)[1].args,writes(first)[0].args);
}]);
cases.push(['CONTROL ACK then explicit new equal amount is a separate adjustment',async page=>{
  await fill(page);await submit(page);assert.ok((await state(page)).notices.includes('Баланс скорректирован'));
  await fill(page);await submit(page);const s=await state(page);assert.equal(s.rows.length,2);assert.equal(s.rows[1].balance_after,200);assert.notEqual(s.rows[0].request_id,s.rows[1].request_id);
}]);
cases.push(['SAFETY failed recovery read then native reload preserves non-first client and original intent',async page=>{
  await fill(page,client2);await page.evaluate(()=>{replyMode='lost';failRead=true;});await submit(page);
  assert.equal(await page.locator('#loyaltyUnavailable').isVisible(),true);await page.locator('#reloadLoyalty').click();await settle(page);
  const first=await state(page);assert.equal(first.client,client2);assert.equal(first.points,'100');assert.match(first.summary,/остаток 100/);
  await submit(page);const s=await state(page);assert.equal(s.rows.length,1);assert.deepEqual(writes(s)[1].args,writes(first)[0].args);
}]);
cases.push(['SAFETY completed unknown A then confirmed B then A restores A warning and key',async page=>{
  const first=await uncertain(page);await page.evaluate(async orgB=>{await controller.setOrganization({id:orgB,current_role:'owner'});},orgB);
  assert.equal((await state(page)).error,'');await fill(page);await submit(page);assert.ok((await state(page)).notices.includes('Баланс скорректирован'));
  await page.evaluate(async org=>{await controller.setOrganization({id:org,current_role:'owner'});},org);
  const returned=await state(page);assert.match(returned.error,/подтверд|проверь/i);assert.equal(returned.points,'100');
  await submit(page);const s=await state(page);assert.equal(s.rows.length,2);assert.deepEqual(writes(s).at(-1).args,writes(first)[0].args);
}]);
for(const transition of ['organization','account'])for(const outcome of ['success','error','throw'])cases.push([
  `SAFETY pending ${transition} switch then late A ${outcome} loads only B without stale feedback`,async page=>{
    await fill(page);await page.evaluate(()=>{deferReply=true;});await submit(page);
    await page.evaluate(async({transition,orgB,actorB})=>{if(transition==='account'){session.user=actorB;session.generation++;window.dispatchEvent(new CustomEvent('minuta:provider-session-reset'));await controller.setOrganization(null);}await controller.setOrganization({id:orgB,current_role:'owner'});},{transition,orgB,actorB});
    assert.equal((await state(page)).hidden,true);await release(page,0,outcome);const s=await state(page);
    assert.equal(s.payloadOrg,orgB);assert.equal(s.available,'ready');assert.equal(s.disabled,false);assert.equal(s.error,'');assert.deepEqual(s.notices,[]);
    assert.deepEqual(s.calls.filter(row=>row.name==='get_minuta_loyalty_workspace').map(row=>row.args.p_organization),[org,orgB]);
  }
]);
for(const outcome of ['success','error','throw'])cases.push([`SAFETY public reset with B pending then late A ${outcome} cannot release B`,async page=>{
  await fill(page);await page.evaluate(()=>{deferReply=true;});await submit(page);
  await page.evaluate(async({orgB,actorB})=>{controller.reset();session.user=actorB;session.generation++;await controller.setOrganization({id:orgB,current_role:'owner'});},{orgB,actorB});
  await fill(page);await submit(page);const before=await state(page);await release(page,0,outcome);const after=await state(page);
  assert.equal(after.disabled,true);assert.equal(after.text,before.text);assert.deepEqual(after.notices,before.notices);assert.equal(after.error,before.error);
  await submit(page);assert.equal(writes(await state(page)).length,2);await release(page,1,'success');assert.equal((await state(page)).notices.length,1);
}]);
cases.push(['SAFETY pending input/change and duplicate native submit cannot start another write',async page=>{
  await fill(page);await page.evaluate(()=>{deferReply=true;});await submit(page);await edit(page,'#loyaltyAdjustmentPoints','100','input');await edit(page,'#loyaltyAdjustmentReason',reason);await submit(page);
  assert.equal(writes(await state(page)).length,1);await release(page,0,'success');assert.equal((await state(page)).rows.length,1);
}]);
let failed=0;
try{browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
  for(const [name,run] of cases){const f=await fixture();try{await run(f.page);assert.deepEqual(f.errors,[]);assert.deepEqual(f.traffic,[]);console.log('PASS '+name);}catch(error){failed++;console.error('FAIL '+name+' — '+error.message);}finally{await f.context.close();}}
}finally{await browser?.close();}
console.log(`${cases.length-failed}/${cases.length} native loyalty cases PASS; synthetic sequential ledger, no SQL/bootstrap`);process.exitCode=failed?1:0;
