import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

// TEST-ONLY: actual provider DOM/full controller/native validation and clicks.
// Baseline 87721c45; model follows accepted VM473a6e -> 7fe28d7 / v81:299-326.
// Pinned baseline: 7 PASS / 15 RED (exit 1); no skip/expected-failure wrapper.
// Sequential authorized/enabled/completed-paid/no-benefit fixture, not SQL/RLS,
// SDK transport, server concurrency, payment accounting or production execution.
// Controller.reset/setOrganization + supplied identity callbacks are real public
// boundaries, NOT full provider bootstrap/handleSession wiring. Registry lifetime
// is one controller, not durable page reload. Policy changed-target cases do not
// assert that another eligible booking violates SQL's one-redemption-per-booking.
// Every request is fulfilled synthetically or blocked. No CI/expected-fail mask.
const source=readFileSync(process.env.MINUTA_LOYALTY_SOURCE||new URL('../loyalty-management.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../provider.html',import.meta.url),'utf8');
const icons=readFileSync(new URL('../ui-icons.svg',import.meta.url),'utf8');
const modulePath=process.env.MINUTA_PLAYWRIGHT_MODULE;
const {chromium}=await import(modulePath?pathToFileURL(modulePath).href:'playwright');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const A={org:id(1),actor:id(2),client:id(3),booking:id(4),next:id(5),otherBooking:id(6),otherClient:id(7)};
const B={org:id(11),actor:id(12),client:id(13),booking:id(14),next:id(15),otherBooking:id(16),otherClient:id(17)};
const form='#loyaltyRedeemForm',button=form+' button[type="submit"]',restore=form+' [data-loyalty-restore-redemption]';
let browser;

async function fixture(){
  const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage(),errors=[],traffic=[];
  page.setDefaultTimeout(4000);page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',route=>{
    const url=route.request().url();
    if(url==='https://loyalty-redemption.test/')return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ru"><body></body></html>'});
    if(url==='https://loyalty-redemption.test/ui-icons.svg')return route.fulfill({contentType:'image/svg+xml',body:icons});
    traffic.push(url);return route.abort();
  });
  await page.goto('https://loyalty-redemption.test/');
  await page.evaluate(html=>{
    const panel=new DOMParser().parseFromString(html,'text/html').querySelector('#loyaltyPanel');
    if(!panel)throw Error('Actual loyalty panel missing');document.body.append(document.importNode(panel,true));
  },html);
  await page.addScriptTag({content:source});
  await page.evaluate(async({A,B})=>{
    const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,clone=x=>structuredClone(x);
    const rows=[],ledger=[],calls=[],notices=[],balances=new Map(),writeGates=[],readGates=[];
    const session={actor:A.actor,generation:1};let mode='success',readMode='success',deferWrite=false,deferRead=false;
    const scopes=[A,B];
    function scope(org){const s=scopes.find(s=>s.org===org);if(!s)throw Error('Unmodelled org');return s;}
    function clients(s){return [{id:s.client,client_name:'Клиент A',client_phone:'+79990000001'},{id:s.otherClient,client_name:'Клиент B',client_phone:'+79990000002'}];}
    function bookings(s){return [s.booking,s.next,s.otherBooking].map((booking,index)=>({id:booking,client_account_id:index===2?s.otherClient:s.client,
      client_name:index===2?'Клиент B':'Клиент A',service_name:'Услуга',booking_date:`2026-09-0${6-index}`,booking_time:'10:00:00',visit_status:'completed',payment_method:'cash',amount_rub:10000}));}
    const balance=(org,client)=>balances.get(org+':'+client)??5000;
    function workspace(org){const s=scope(org);return {organization_id:org,current_role:'owner',enabled:true,max_redeem_percent_bps:3000,rule:{earn_rate_bps:500,min_paid_amount_rub:0},
      clients:clients(s),bookings:bookings(s),accounts:clients(s).map((c,i)=>({id:id(200+(org===A.org?0:2)+i),client_account_id:c.id,balance_points:balance(org,c.id),lifetime_earned:5000,lifetime_spent:5000-balance(org,c.id)})),
      promotions:[],promo_redemptions:[],ledger:clone(ledger.filter(row=>row.organization_id===org))};}
    function apply(p){
      const s=scope(p.p_organization),fail=(code,message)=>({data:null,error:{code,message}});
      if(!p.p_request_id||!Number.isInteger(p.p_points)||p.p_points<1||p.p_points>10000000)return fail('22023','invalid_loyalty_redemption');
      const old=rows.find(row=>row.organization_id===p.p_organization&&row.request_id===p.p_request_id);
      if(old){if(old.booking_id!==p.p_booking||old.points!==p.p_points)return fail('23505','loyalty_request_conflict');
        return {data:{organization_id:s.org,id:old.id,points:old.points},error:null};}
      const b=bookings(s).find(b=>b.id===p.p_booking);if(!b)return fail('55000','loyalty_booking_not_paid');
      const before=balance(s.org,b.client_account_id);
      if(before<p.p_points)return fail('55000','insufficient_loyalty_balance');
      if(p.p_points>Math.floor(b.amount_rub*3000/10000))return fail('55000','loyalty_redemption_limit_exceeded');
      if(rows.some(row=>row.organization_id===s.org&&row.booking_id===b.id))return fail('23505','loyalty_booking_already_redeemed');
      const row={id:id(100+rows.length),organization_id:s.org,account_id:id(200+(s.org===A.org?0:2)+(b.client_account_id===s.client?0:1)),
        booking_id:b.id,points:p.p_points,request_id:p.p_request_id,actor_id:session.actor,created_at:'2026-09-06T12:00:00Z'};
      rows.push(row);balances.set(s.org+':'+b.client_account_id,before-p.p_points);
      ledger.push({id:ledger.length+1,organization_id:s.org,account_id:row.account_id,client_account_id:b.client_account_id,event_type:'redemption',points_delta:-p.p_points,
        balance_after:before-p.p_points,booking_id:b.id,request_id:p.p_request_id,reason:'Списание на завершённый оплаченный визит',actor_id:session.actor,created_at:row.created_at});
      return {data:{organization_id:s.org,id:row.id,points:p.p_points,balance_points:before-p.p_points},error:null};
    }
    const db={rpc:async(name,args)=>{
      const call={name,args:clone(args)};calls.push(call);
      if(name==='get_minuta_loyalty_workspace'){
        const reply={data:workspace(args.p_organization),error:null};
        if(deferRead){deferRead=false;return new Promise((resolve,reject)=>readGates.push({resolve,reject,reply}));}
        const current=readMode;readMode='success';
        if(current==='throw')throw Error('synthetic workspace rejection');
        if(current==='error')return {data:null,error:{code:'08006',message:'synthetic workspace error'}};
        return reply;
      }
      if(name!=='redeem_minuta_loyalty')throw Error('Unexpected mutation '+name);
      const reply=apply(args);call.reply=clone(reply); // Commit BEFORE lost delivery.
      if(deferWrite){deferWrite=false;return new Promise((resolve,reject)=>writeGates.push({resolve,reject,reply}));}
      const current=mode;mode='success';
      if(current==='lost')return {data:null,error:{code:'',message:'TypeError: Failed to fetch',details:'',hint:''}};
      if(current==='throw')throw Error('defensive unexpected RPC rejection');
      if(current==='null')return {data:null,error:null};
      if(current==='partial')return {data:{organization_id:args.p_organization},error:null};
      return reply;
    }};
    const controller=MinutaLoyalty.createController({db,$:selector=>document.querySelector(selector),escapeHtml:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
      notify:message=>notices.push(message),requireWrites:()=>true,getCurrentUser:()=>session.actor?{id:session.actor}:null,getSessionGeneration:()=>session.generation,
      sessionIsCurrent:(actor,generation)=>actor===session.actor&&generation===session.generation,applyWriteAvailability(){}});
    window.redemptionFixture={controller,session,rows,ledger,calls,notices,writeGates,readGates,
      mode:value=>{mode=value;},readMode:value=>{readMode=value;},deferWrite:()=>{deferWrite=true;},deferRead:()=>{deferRead=true;}};
    controller.bind();await controller.setOrganization({id:A.org,current_role:'owner'});
  },{A,B});
  return {context,page,errors,traffic};
}
async function settle(page){await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));}
async function choose(page,s=A,who=s.client,visit=s.booking){await page.locator('#loyaltyRedeemClient').selectOption(who);await page.locator('#loyaltyRedeemBooking').selectOption(visit);}
async function fill(page,s=A,who=s.client,visit=s.booking){await choose(page,s,who,visit);await page.locator('#loyaltyRedeemPoints').fill('100');}
async function submit(page){
  assert.equal(await page.locator(form).evaluate(n=>n.checkValidity()),true,'Native validity must not hide retry failure');
  assert.equal(await page.locator(button).isDisabled(),false,'Explicit retry must be accessible');
  await page.locator(button).click();await settle(page);
}
async function state(page){return page.evaluate(()=>{
  const f=redemptionFixture,get=id=>document.getElementById(id),b=document.querySelector('#loyaltyRedeemForm button[type="submit"]');
  return {rows:structuredClone(f.rows),ledger:structuredClone(f.ledger),calls:structuredClone(f.calls),notices:[...f.notices],
    client:get('loyaltyRedeemClient').value,booking:get('loyaltyRedeemBooking').value,points:get('loyaltyRedeemPoints').value,
    error:get('loyaltyRedeemError').hidden?'':get('loyaltyRedeemError').textContent,disabled:b.disabled,label:b.textContent,
    available:f.controller.availability,payloadOrg:f.controller.payload?.organization_id,readRows:f.controller.payload?.ledger?.length,
    loading:!get('loyaltyLoading').hidden,unavailable:!get('loyaltyUnavailable').hidden,workspace:!get('loyaltyWorkspace').hidden};
});}
const writes=s=>s.calls.filter(c=>c.name==='redeem_minuta_loyalty');
async function unknown(page,s=A,who=s.client,visit=s.booking){await fill(page,s,who,visit);await page.evaluate(()=>redemptionFixture.mode('lost'));await submit(page);
  const result=await state(page);assert.equal(result.rows.length,1);assert.equal(result.readRows,1,'Actual read exposes original debit');return result;}
async function restoreOriginal(page,before){
  assert.equal(await page.locator(restore).count(),1,'Original restore must be accessible without invalid submit');
  assert.equal(await page.locator(restore).getAttribute('type'),'button');assert.equal(await page.locator(restore).isVisible(),true);
  await page.locator(restore).click();await settle(page);const after=await state(page);
  assert.equal(after.calls.length,before.calls.length,'Restore must perform zero RPC, even reads');assert.deepEqual(after.notices,before.notices);return after;
}
async function release(page,type,index,outcome){await page.evaluate(({type,index,outcome})=>{
  const gate=redemptionFixture[type==='read'?'readGates':'writeGates'][index];if(!gate)throw Error('Missing deferred gate');
  if(outcome==='throw')gate.reject(Error('synthetic late rejection'));else gate.resolve(outcome==='success'?gate.reply:{data:null,error:{code:'08006',message:'synthetic lost reply'}});
},{type,index,outcome});await settle(page);}
const cases=[];
cases.push(['CONTROL invalid empty native form performs zero mutation',async page=>{
  await choose(page);await page.locator(button).click();await settle(page);assert.equal(writes(await state(page)).length,0);
  assert.equal(await page.locator(form).evaluate(n=>n.checkValidity()),false);
}]);
cases.push(['CONTROL original and replay ACK differ: replay lacks balance_points',async page=>{
  const original=await unknown(page);await submit(page);const s=await state(page);assert.equal(s.rows.length,1);
  assert.deepEqual(writes(s)[1].args,writes(original)[0].args);assert.equal(writes(s)[0].reply.data.balance_points,4900);
  assert.equal('balance_points' in writes(s)[1].reply.data,false);assert.deepEqual(s.notices,['Бонусы списаны']);assert.equal(s.points,'');
}]);
for(const [label,selector] of [['client','#loyaltyRedeemClient'],['booking','#loyaltyRedeemBooking'],['points','#loyaltyRedeemPoints']])cases.push([
  `RECOVERY no-op ${label} change retains original request`,async page=>{
    const first=await unknown(page);await page.locator(selector).dispatchEvent('change');await submit(page);const s=await state(page);
    assert.equal(s.rows.length,1,'Same-booking server refusal is not a duplicate debit');assert.deepEqual(writes(s)[1].args,writes(first)[0].args);assert.equal(writes(s)[1].reply.error,null);
  }
]);
cases.push(['RECOVERY native numeric equivalent then change retains key',async page=>{
  const first=await unknown(page);await page.locator('#loyaltyRedeemPoints').fill('100.0');await page.locator('#loyaltyRedeemPoints').dispatchEvent('change');await submit(page);
  assert.deepEqual(writes(await state(page))[1].args,writes(first)[0].args);
}]);
cases.push(['RECOVERY edit then revert remains the original intent',async page=>{
  const first=await unknown(page);await page.locator('#loyaltyRedeemPoints').fill('200');await page.locator('#loyaltyRedeemPoints').blur();
  await page.locator('#loyaltyRedeemPoints').fill('100');await page.locator('#loyaltyRedeemPoints').blur();await submit(page);
  assert.deepEqual(writes(await state(page))[1].args,writes(first)[0].args);
}]);
for(const [label,who,visit] of [['non-first client',A.otherClient,A.otherBooking],['same-client second booking',A.client,A.next]])cases.push([
  `RECOVERY automatic read preserves ${label} and exact replay`,async page=>{
    const first=await unknown(page,A,who,visit);await submit(page);const s=await state(page);
    assert.equal(s.rows.length,1);assert.deepEqual(writes(s)[1].args,writes(first)[0].args);assert.equal(writes(s)[1].reply.error,null);
  }
]);
for(const mode of ['partial','null'])cases.push([`SAFETY ${mode} ACK is unknown, not false success`,async page=>{
  await fill(page);await page.evaluate(mode=>redemptionFixture.mode(mode),mode);await submit(page);const s=await state(page);
  assert.equal(s.rows.length,1);assert.equal(s.notices.includes('Бонусы списаны'),false,'A warning is allowed; claiming confirmed redemption is not');assert.equal(s.points,'100');await submit(page);
  assert.deepEqual(writes(await state(page))[1].args,writes(s)[0].args);
}]);
for(const [label,who,visit] of [['other visit',A.client,A.next],['other client',A.otherClient,A.otherBooking]])cases.push([
  `POLICY changed unknown ${label} restores fields with zero RPC before separate retry`,async page=>{
    const first=await unknown(page);await choose(page,A,who,visit);const before=await state(page);
    const restored=await restoreOriginal(page,before);assert.equal(restored.client,A.client);assert.equal(restored.booking,A.booking);assert.equal(restored.points,'100');
    await submit(page);const s=await state(page);assert.equal(s.rows.length,1);assert.deepEqual(writes(s)[1].args,writes(first)[0].args);
  }
]);
cases.push(['RECOVERY invalid blank amount still offers original restore, zero RPC',async page=>{
  const first=await unknown(page);await page.locator('#loyaltyRedeemPoints').fill('');await page.locator(button).click();await settle(page);
  assert.equal(await page.locator(form).evaluate(n=>n.checkValidity()),false);const before=await state(page);assert.equal(writes(before).length,1);
  await restoreOriginal(page,before);assert.equal(await page.locator(form).evaluate(n=>n.checkValidity()),true);await submit(page);
  assert.deepEqual(writes(await state(page))[1].args,writes(first)[0].args);
}]);
cases.push(['CONTROL ACK then explicit new eligible booking is a separate operation',async page=>{
  await fill(page);await submit(page);assert.deepEqual((await state(page)).notices,['Бонусы списаны']);await fill(page,A,A.client,A.next);await submit(page);
  const s=await state(page);assert.equal(s.rows.length,2);assert.equal(s.ledger.at(-1).balance_after,4800);assert.notEqual(writes(s)[0].args.p_request_id,writes(s)[1].args.p_request_id);
}]);
for(const outcome of ['success','error','throw'])cases.push([`CONTEXT reset actor B pending is not released by late A ${outcome}`,async page=>{
  await fill(page);await page.evaluate(()=>redemptionFixture.deferWrite());await submit(page);
  await page.evaluate(async B=>{const f=redemptionFixture;f.controller.reset();f.session.actor=B.actor;f.session.generation++;await f.controller.setOrganization({id:B.org,current_role:'owner'});},B);
  await fill(page,B);await page.evaluate(()=>redemptionFixture.deferWrite());await submit(page);const before=await state(page);
  await release(page,'write',0,outcome);const after=await state(page);
  assert.equal(after.disabled,true);assert.equal(after.label,before.label);assert.deepEqual(after.notices,before.notices);assert.equal(after.error,before.error);
  assert.equal(after.payloadOrg,B.org);assert.equal(writes(after).length,2);await release(page,'write',1,'success');
  assert.deepEqual((await state(page)).notices,['Бонусы списаны']);
}]);
for(const readMode of ['error','throw'])cases.push([`RECOVERY queued destination B read ${readMode} has available read retry`,async page=>{
  await fill(page);await page.evaluate(()=>redemptionFixture.deferWrite());await submit(page);
  await page.evaluate(async({B,readMode})=>{const f=redemptionFixture;f.session.actor=B.actor;f.session.generation++;await f.controller.setOrganization(null);await f.controller.setOrganization({id:B.org,current_role:'owner'});f.readMode(readMode);},{B,readMode});
  await release(page,'write',0,'error');const s=await state(page);assert.equal(s.loading,false);assert.equal(s.unavailable,true);assert.equal(s.available,'error');
  await page.locator('#reloadLoyalty').click();await settle(page);assert.equal((await state(page)).payloadOrg,B.org);await fill(page,B);await submit(page);
  assert.equal((await state(page)).rows.length,2);
}]);
cases.push(['CONTEXT late old read rejection cannot overwrite a newer ready destination',async page=>{
  await fill(page);await page.evaluate(()=>{redemptionFixture.mode('lost');redemptionFixture.deferRead();});await submit(page);
  await page.evaluate(async B=>{await redemptionFixture.controller.setOrganization({id:B.org,current_role:'owner'});},B);await fill(page,B);
  const before=await state(page);await release(page,'read',0,'throw');const after=await state(page);
  assert.equal(after.available,'ready');assert.equal(after.payloadOrg,B.org);assert.equal(after.points,before.points);assert.deepEqual(after.notices,before.notices);assert.equal(after.unavailable,false);
}]);
cases.push(['CONTEXT unknown A draft survives B ACK and returns with accessible restore',async page=>{
  const first=await unknown(page);await page.locator('#loyaltyRedeemPoints').fill('');
  await page.evaluate(async B=>{await redemptionFixture.controller.setOrganization({id:B.org,current_role:'owner'});},B);await fill(page,B);await submit(page);
  await page.evaluate(async A=>{await redemptionFixture.controller.setOrganization({id:A.org,current_role:'owner'});},A);
  const before=await state(page);assert.equal(before.points,'');assert.equal(writes(before).length,2);await restoreOriginal(page,before);await submit(page);
  const s=await state(page);assert.equal(s.rows.length,2);assert.deepEqual(writes(s).at(-1).args,writes(first)[0].args);
}]);

let failed=0;
try{browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
  for(const [name,run] of cases){const f=await fixture();try{await run(f.page);assert.deepEqual(f.errors,[]);assert.deepEqual(f.traffic,[]);console.log('PASS '+name);}
    catch(error){failed++;console.error('FAIL '+name+' — '+error.message);}
    finally{if(f.errors.length||f.traffic.length)console.error('Fixture diagnostics '+JSON.stringify({errors:f.errors,traffic:f.traffic}));await f.context.close();}}
}finally{await browser?.close();}
console.log(`${cases.length-failed}/${cases.length} native booking-redemption cases PASS; ${failed} RED; source sha256=${createHash('sha256').update(source).digest('hex')}; synthetic RPC, no production/SQL/bootstrap`);
process.exitCode=failed?1:0;
