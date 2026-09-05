import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

// TEST-ONLY native browser baseline 7ed0d7fc. Actual provider #loyaltyPanel DOM,
// whole controller/bind/render and native form validation/submit buttons.
// Original 13 cases: 3 PASS / 10 RED on 7ed0, without changed assertions.
// Expanded 40 cases: 12 PASS / 28 RED on the same baseline (exit 1).
// No provider bootstrap/session integration, real Supabase SDK/SQL/RLS/locks,
// concurrent server execution or durable browser-restart recovery is proved.
// Sequential promo model follows accepted VM39e1723f and v81:361-391:
// authorized/enabled org, active in-date unlimited promo, eligible bookings,
// no conflicting benefit. Effects are promo rows/usage, NOT payment/bonus debits.
// All requests are intercepted or blocked; synthetic HTML origin has no server.
// Expected RED stays exit 1; this future regression is NOT wired into CI.
const source=readFileSync(process.env.MINUTA_LOYALTY_SOURCE||new URL('../loyalty-management.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../provider.html',import.meta.url),'utf8');
const icons=readFileSync(new URL('../ui-icons.svg',import.meta.url),'utf8');
const modulePath=process.env.MINUTA_PLAYWRIGHT_MODULE;
const { chromium }=await import(modulePath?pathToFileURL(modulePath).href:'playwright');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const org=id(1),actor=id(2),client=id(3),booking=id(4),nextBooking=id(5),otherBooking=id(6),otherClient=id(7),promotion=id(8);
const code='WELCOME10',form='#loyaltyPromoApplyForm',button=form+' button[type="submit"]';
const A={org,actor,client,booking,nextBooking,otherBooking,otherClient,promotion};
const B={org:id(11),actor:id(12),client:id(13),booking:id(14),nextBooking:id(15),otherBooking:id(16),otherClient:id(17),promotion:id(18)};
const restore=form+' [data-loyalty-restore-promo]';
let browser;

async function fixture() {
  const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage(),errors=[],traffic=[];
  page.setDefaultTimeout(5000);
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',route=>{
    const url=route.request().url();
    if(url==='https://loyalty-promo.test/')return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ru"><body></body></html>'});
    if(url==='https://loyalty-promo.test/ui-icons.svg')return route.fulfill({contentType:'image/svg+xml',body:icons});
    traffic.push(url);return route.abort();
  });
  await page.goto('https://loyalty-promo.test/');
  await page.evaluate(html=>{
    const panel=new DOMParser().parseFromString(html,'text/html').querySelector('#loyaltyPanel');
    if(!panel)throw Error('Actual provider loyalty panel missing');
    document.body.append(document.importNode(panel,true));
  },html);
  await page.addScriptTag({content:source});
  await page.evaluate(async({A,B,code})=>{
    const {org,actor}=A;
    const clone=value=>structuredClone(value),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
    const rows=[],calls=[],notices=[],writeGates=[],readGates=[];
    const session={actor,generation:1};
    let mode='success',readMode='success',deferWrite=false,deferRead=false,ackPatch=null,amount=10000,bps=1000;
    const scope=org=>{const s=[A,B].find(s=>s.org===org);if(!s)throw Error('Unmodelled organization');return s;};
    const clients=s=>[{id:s.client,client_name:'Клиент А',client_phone:'+79990000001'},{id:s.otherClient,client_name:'Клиент Б',client_phone:'+79990000002'}];
    const bookings=s=>[s.booking,s.nextBooking,s.otherBooking].map((value,index)=>({id:value,client_account_id:index===2?s.otherClient:s.client,
      client_name:index===2?'Клиент Б':'Клиент А',service_name:'Услуга',booking_date:`2026-09-0${6-index}`,booking_time:'10:00:00',
      visit_status:'completed',payment_method:'cash',amount_rub:amount}));
    function workspace(org){const s=scope(org);return {organization_id:org,current_role:'owner',enabled:true,max_redeem_percent_bps:3000,rule:{earn_rate_bps:500,min_paid_amount_rub:0},
      clients:clients(s),bookings:bookings(s),accounts:[],ledger:[],promo_redemptions:clone(rows.filter(r=>r.organization_id===org)),
      promotions:[{id:s.promotion,code,kind:'percent',value:bps,active:true,valid_from:'2026-01-01',valid_until:'2026-12-31',
        total_limit:null,per_client_limit:null,usage_count:rows.filter(r=>r.organization_id===org).length}]};}
    function apply(p){
      const fail=(code,message)=>({data:null,error:{code,message}});
      const s=scope(p.p_organization),org=s.org,promotion=s.promotion;
      if(!p.p_request_id)return fail('22023','promotion_request_required');
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(p.p_request_id))throw Error('Invalid fixture request key');
      const canonical=String(p.p_code||'').trim().toUpperCase();
      const old=rows.find(row=>row.organization_id===org&&row.request_id===p.p_request_id);
      if(old){
        if(old.booking_id!==p.p_booking||canonical!==code)return fail('23505','loyalty_request_conflict');
        return {data:{organization_id:org,id:old.id,discount_rub:old.discount_rub,final_amount_rub:old.final_amount_rub},error:null};
      }
      const target=bookings(s).find(row=>row.id===p.p_booking);
      if(canonical!==code||!target)return fail('55000','promo_not_available');
      if(rows.some(row=>row.booking_id===target.id))return fail('23505','promo_already_applied');
      const amount=target.amount_rub,discount=Math.min(amount,Math.floor(amount*bps/10000));
      if(discount<1||amount-discount<0||amount>10000000)throw Error('Outside v81 promo CHECK constraints');
      const row={id:id(100+rows.length),organization_id:org,promotion_id:promotion,booking_id:target.id,client_account_id:target.client_account_id,
        request_id:p.p_request_id,original_amount_rub:amount,discount_rub:discount,final_amount_rub:amount-discount,actor_id:session.actor,created_at:'2026-09-06T12:00:00Z'};
      rows.push(row);
      return {data:{organization_id:org,id:row.id,promotion_id:promotion,discount_rub:discount,final_amount_rub:amount-discount},error:null};
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
      if(name!=='redeem_minuta_promotion')throw Error('Unexpected mutation '+name);
      const currentMode=mode;mode='success';
      // Malformed ACK is injected before applying: no fake discount row exists.
      if(currentMode==='malformed'){const reply={data:{organization_id:org},error:null};call.reply=clone(reply);return reply;}
      if(currentMode==='forged'){
        const reply={data:{organization_id:args.p_organization,id:id(900),promotion_id:scope(args.p_organization).promotion,discount_rub:1000,final_amount_rub:9000,...ackPatch},error:null};
        // Actual v81 replay shape has no promotion_id, including malformed-field probes.
        if(rows.some(r=>r.organization_id===args.p_organization&&r.request_id===args.p_request_id))delete reply.data.promotion_id;
        ackPatch=null;call.reply=clone(reply);return reply;
      }
      const reply=apply(args);call.reply=clone(reply);
      // Model commits before a deferred/lost response; no actual network/SQL race.
      if(deferWrite){deferWrite=false;return new Promise((resolve,reject)=>writeGates.push({resolve,reject,reply}));}
      if(currentMode==='lost'&&!reply.error)return {data:null,error:{code:'',message:'TypeError: Failed to fetch',details:'',hint:''}};
      if(currentMode==='throw')throw Error('defensive unexpected RPC rejection');
      if(currentMode==='null')return {data:null,error:null};
      return reply;
    }};
    const $=selector=>document.querySelector(selector);
    const controller=MinutaLoyalty.createController({db,$,escapeHtml:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
      notify:message=>notices.push(message),requireWrites:()=>true,getCurrentUser:()=>session.actor?{id:session.actor}:null,getSessionGeneration:()=>session.generation,
      sessionIsCurrent:(user,generation)=>user===session.actor&&generation===session.generation,applyWriteAvailability(){}});
    window.promoFixture={controller,rows,calls,notices,session,writeGates,readGates,mode:value=>{mode=value;},readMode:value=>{readMode=value;},
      deferWrite:()=>{deferWrite=true;},deferRead:()=>{deferRead=true;},forge:patch=>{mode='forged';ackPatch=patch;},
      amountBoundary:(value,rate)=>{amount=value;bps=rate;}};
    controller.bind();await controller.setOrganization({id:org,current_role:'owner'});
  },{A,B,code});
  // The real promo application form lives in a CLOSED native details element.
  // Open its actual summary, never remove hidden attributes or force-click fields.
  await page.locator('details').filter({has:page.locator(form)}).locator(':scope > summary').click();
  assert.equal(await page.locator(form).isVisible(),true);
  return {context,page,errors,traffic};
}

async function settle(page){await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));}
async function choose(page,who=client,visit=booking){
  await page.locator('#loyaltyPromoClient').selectOption(who);
  await page.locator('#loyaltyPromoBooking').selectOption(visit);
}
async function fill(page,who=client,visit=booking){await choose(page,who,visit);await page.locator('#loyaltyPromoApplyCode').fill(code);}
async function submit(page){
  assert.equal(await page.locator(form).evaluate(node=>node.checkValidity()),true,'Native form must be valid; do not bypass validation with SubmitEvent');
  assert.equal(await page.locator(button).isDisabled(),false,'Expected an accessible explicit submit');
  await page.locator(button).click();await settle(page);
}
async function state(page){return page.evaluate(()=>{
  const f=window.promoFixture,get=id=>document.getElementById(id);
  return {rows:structuredClone(f.rows),calls:structuredClone(f.calls),notices:[...f.notices],
    client:get('loyaltyPromoClient').value,booking:get('loyaltyPromoBooking').value,code:get('loyaltyPromoApplyCode').value,
    error:get('loyaltyPromoApplyError').hidden?'':get('loyaltyPromoApplyError').textContent,
    readRows:f.controller.payload?.promo_redemptions?.length,available:f.controller.availability,payloadOrg:f.controller.payload?.organization_id,
    disabled:document.querySelector('#loyaltyPromoApplyForm button[type="submit"]').disabled,
    label:document.querySelector('#loyaltyPromoApplyForm button[type="submit"]').textContent,
    loading:!get('loyaltyLoading').hidden,unavailable:!get('loyaltyUnavailable').hidden};
});}
const writes=s=>s.calls.filter(call=>call.name==='redeem_minuta_promotion');
async function unknown(page,who=client,visit=booking){
  await fill(page,who,visit);await page.evaluate(()=>promoFixture.mode('lost'));await submit(page);
  const s=await state(page);assert.equal(s.rows.length,1);assert.equal(s.readRows,1,'Actual post-error reload exposes committed promo use');return s;
}
async function restoreOriginal(page,before){
  assert.equal(await page.locator(restore).count(),1,'Restore must be available before an invalid submit');
  assert.equal(await page.locator(restore).getAttribute('type'),'button');assert.equal(await page.locator(restore).isVisible(),true);
  await page.locator(restore).click();await settle(page);const after=await state(page);
  assert.equal(after.calls.length,before.calls.length,'Restoring fields performs zero RPC, including reads');
  assert.deepEqual(after.notices,before.notices);return after;
}
async function release(page,type,index,outcome){await page.evaluate(({type,index,outcome})=>{
  const gate=promoFixture[type==='read'?'readGates':'writeGates'][index];if(!gate)throw Error('Missing deferred gate');
  if(outcome==='throw')gate.reject(Error('synthetic late rejection'));else gate.resolve(outcome==='success'?gate.reply:{data:null,error:{code:'08006',message:'synthetic lost reply'}});
},{type,index,outcome});await settle(page);}
const cases=[];
cases.push(['CONTROL native required validation blocks empty promo with zero RPC',async page=>{
  await choose(page);assert.equal(await page.locator(form).evaluate(node=>node.checkValidity()),false);
  await page.locator(button).click();await settle(page);const s=await state(page);assert.equal(writes(s).length,0);assert.equal(s.rows.length,0);
}]);
cases.push(['CONTROL unchanged replay accepts v81 receipt without promotion_id',async page=>{
  const first=await unknown(page);await submit(page);const s=await state(page);
  assert.equal(s.rows.length,1);assert.deepEqual(writes(s)[1].args,writes(first)[0].args);
  assert.equal(writes(s)[0].reply.data.promotion_id,promotion);assert.equal('promotion_id' in writes(s)[1].reply.data,false);
  assert.deepEqual(s.notices,['Промокод применён и проверен сервером']);assert.equal(s.code,'');
}]);
for(const [label,selector] of [['client','#loyaltyPromoClient'],['booking','#loyaltyPromoBooking'],['code','#loyaltyPromoApplyCode']])cases.push([
  `RECOVERY no-op ${label} change retains original key, not already-applied refusal`,async page=>{
    const first=await unknown(page);
    // Deliberate no-op DOM change event; submit itself is a real native click.
    await page.locator(selector).dispatchEvent('change');await submit(page);const s=await state(page);
    assert.equal(s.rows.length,1,'Server same-booking guard prevents a second discount');
    assert.deepEqual(writes(s)[1].args,writes(first)[0].args);assert.equal(writes(s)[1].reply.error,null);
  }
]);
cases.push(['RECOVERY native input uppercase/trim then change preserves original key',async page=>{
  const first=await unknown(page);await page.locator('#loyaltyPromoApplyCode').fill('  welcome10  ');
  assert.equal(await page.locator('#loyaltyPromoApplyCode').inputValue(),code,'Actual input sanitizer runs');
  await page.locator('#loyaltyPromoApplyCode').dispatchEvent('change');await submit(page);const s=await state(page);
  assert.equal(s.rows.length,1);assert.deepEqual(writes(s)[1].args,writes(first)[0].args);
}]);
cases.push(['RECOVERY edit then revert does not create a new request',async page=>{
  const first=await unknown(page);await page.locator('#loyaltyPromoApplyCode').fill('ANOTHER');await page.locator('#loyaltyPromoApplyCode').blur();
  await page.locator('#loyaltyPromoApplyCode').fill(code);await page.locator('#loyaltyPromoApplyCode').blur();await submit(page);
  const s=await state(page);assert.equal(s.rows.length,1);assert.deepEqual(writes(s)[1].args,writes(first)[0].args);
}]);
cases.push(['SAFETY malformed organization-only ACK with zero rows cannot show applied/reset',async page=>{
  await fill(page);await page.evaluate(()=>promoFixture.mode('malformed'));await submit(page);const s=await state(page);
  assert.equal(s.rows.length,0);assert.deepEqual(s.notices,[],'Matching org alone is not a redemption receipt');assert.equal(s.code,code);
}]);
for(const [label,who,visit] of [['non-first client',otherClient,otherBooking],['non-first visit same client',client,nextBooking]])cases.push([
  `RECOVERY automatic reload retains ${label} without a user target edit`,async page=>{
    const first=await unknown(page,who,visit);await submit(page);const s=await state(page);
    assert.equal(s.rows.length,1,'Same-key wrong-target conflict is not a second promo use');
    assert.deepEqual(writes(s)[1].args,writes(first)[0].args);assert.equal(writes(s)[1].reply.error,null);
  }
]);
cases.push(['CONTROL ACK followed by explicit different eligible booking is legal',async page=>{
  await fill(page);await submit(page);assert.deepEqual((await state(page)).notices,['Промокод применён и проверен сервером']);
  await fill(page,client,nextBooking);await submit(page);const s=await state(page);
  assert.equal(s.rows.length,2);assert.notEqual(writes(s)[0].args.p_request_id,writes(s)[1].args.p_request_id);
  assert.deepEqual(s.notices,['Промокод применён и проверен сервером','Промокод применён и проверен сервером']);
}]);
for(const [label,who,visit] of [['other visit',client,nextBooking],['other client',otherClient,otherBooking]])cases.push([
  `POLICY unknown then explicit ${label} choice needs a separate new-intent decision`,async page=>{
    const first=await unknown(page);await choose(page,who,visit);await submit(page);const s=await state(page);
    assert.deepEqual(s.rows,first.rows,'Desired unresolved-intent policy; a different-booking row is not duplicate discount of the first booking');
  }
]);

// Added acceptance cases below. The preceding original 13 assertions are intact.
// Identity changes exercise real controller.reset/setOrganization boundaries,
// not provider.handleSession wiring. Scope registries live in this one controller.
cases.push(['RECOVERY blank required code offers explicit original restore with zero RPC',async page=>{
  const first=await unknown(page);await page.locator('#loyaltyPromoApplyCode').fill('');
  assert.equal(await page.locator(form).evaluate(n=>n.checkValidity()),false);
  const before=await state(page),restored=await restoreOriginal(page,before);
  assert.equal(restored.client,client);assert.equal(restored.booking,booking);assert.equal(restored.code,code);
  await submit(page);assert.deepEqual(writes(await state(page))[1].args,writes(first)[0].args);
}]);
for(const mode of ['null','throw'])cases.push([`RECOVERY ${mode} after commit retains intent without false success`,async page=>{
  await fill(page);await page.evaluate(mode=>promoFixture.mode(mode),mode);await submit(page);const first=await state(page);
  assert.equal(first.rows.length,1);assert.equal(first.readRows,1);assert.equal(first.code,code);
  assert.equal(first.notices.includes('Промокод применён и проверен сервером'),false);assert.ok(first.error);
  await page.locator('#loyaltyPromoApplyCode').dispatchEvent('change');await submit(page);const s=await state(page);
  assert.equal(s.rows.length,1);assert.deepEqual(writes(s)[1].args,writes(first)[0].args);
}]);
for(const phase of ['original','replay'])for(const [label,patch] of [
  ['non-UUID ID',{id:'invalid'}],['string discount',{discount_rub:'1000'}],['fractional final',{final_amount_rub:9000.5}],
  ['zero discount',{discount_rub:0}],['sum above v81 ten-million cap',{discount_rub:1000000,final_amount_rub:9000001}]
])cases.push([`ACK ${phase} rejects ${label}, preserves pending fields`,async page=>{
  if(phase==='replay')await unknown(page);else await fill(page);
  const before=await state(page);await page.evaluate(patch=>promoFixture.forge(patch),patch);await submit(page);const after=await state(page);
  assert.deepEqual(after.rows,before.rows,'Injected invalid receipt must not invent model effects');
  assert.equal(after.notices.filter(n=>n==='Промокод применён и проверен сервером').length,0);
  assert.equal(after.code,code);assert.ok(after.error,'Malformed response must leave an explicit unresolved result');
}]);
for(const phase of ['original','replay'])for(const [label,amount,bps,discount,final] of [
  ['minimum one-ruble discount',10,1000,1,9],['ten-million full discount and zero final',10000000,10000,10000000,0]
])cases.push([`CONTROL ${phase} accepts ${label}`,async page=>{
  await page.evaluate(async({amount,bps})=>{promoFixture.amountBoundary(amount,bps);await promoFixture.controller.load();},{amount,bps});
  if(phase==='replay')await unknown(page);else await fill(page);
  await submit(page);const s=await state(page);assert.equal(s.rows.length,1);
  assert.equal(writes(s).at(-1).reply.data.discount_rub,discount);assert.equal(writes(s).at(-1).reply.data.final_amount_rub,final);
  if(phase==='replay'){assert.deepEqual(writes(s)[1].args,writes(s)[0].args);assert.equal('promotion_id' in writes(s)[1].reply.data,false);}
  assert.deepEqual(s.notices,['Промокод применён и проверен сервером']);assert.equal(s.code,'');
}]);
for(const outcome of ['success','error','throw'])cases.push([`CONTEXT reset actor B pending survives late A ${outcome}`,async page=>{
  await fill(page);await page.evaluate(()=>promoFixture.deferWrite());await submit(page);
  await page.evaluate(async B=>{const f=promoFixture;f.controller.reset();f.session.actor=B.actor;f.session.generation++;await f.controller.setOrganization({id:B.org,current_role:'owner'});},B);
  await fill(page,B.client,B.booking);await page.evaluate(()=>promoFixture.deferWrite());await submit(page);const before=await state(page);
  await release(page,'write',0,outcome);const after=await state(page);
  assert.equal(after.disabled,true);assert.equal(after.label,before.label);assert.deepEqual(after.notices,before.notices);
  assert.equal(after.error,before.error);assert.equal(after.code,before.code);assert.equal(after.booking,B.booking);
  assert.equal(after.payloadOrg,B.org);assert.equal(writes(after).length,2);await release(page,'write',1,'success');
  assert.deepEqual((await state(page)).notices,['Промокод применён и проверен сервером']);
}]);
for(const readMode of ['error','throw'])cases.push([`RECOVERY queued new actor B workspace ${readMode} offers read retry`,async page=>{
  await fill(page);await page.evaluate(()=>promoFixture.deferWrite());await submit(page);
  await page.evaluate(async({B,readMode})=>{const f=promoFixture;f.session.actor=B.actor;f.session.generation++;await f.controller.setOrganization(null);await f.controller.setOrganization({id:B.org,current_role:'owner'});f.readMode(readMode);},{B,readMode});
  await release(page,'write',0,'error');const s=await state(page);
  assert.equal(s.loading,false);assert.equal(s.unavailable,true);assert.equal(s.available,'error');
  await page.locator('#reloadLoyalty').click();await settle(page);assert.equal((await state(page)).payloadOrg,B.org);
  await fill(page,B.client,B.booking);await submit(page);assert.equal((await state(page)).rows.length,2);
}]);
for(const outcome of ['success','error','throw'])cases.push([`CONTEXT late A read ${outcome} cannot overwrite ready B draft`,async page=>{
  await fill(page);await page.evaluate(()=>{promoFixture.mode('lost');promoFixture.deferRead();});await submit(page);
  await page.evaluate(async B=>{await promoFixture.controller.setOrganization({id:B.org,current_role:'owner'});},B);
  await fill(page,B.client,B.nextBooking);const before=await state(page);await release(page,'read',0,outcome);const after=await state(page);
  assert.equal(after.available,'ready');assert.equal(after.payloadOrg,B.org);assert.equal(after.unavailable,false);
  assert.equal(after.booking,before.booking);assert.equal(after.code,before.code);assert.deepEqual(after.notices,before.notices);
}]);
for(const changeActor of [false,true])cases.push([`CONTEXT unknown A draft returns after B ACK (${changeActor?'actor and org':'org only'})`,async page=>{
  const first=await unknown(page);await page.locator('#loyaltyPromoApplyCode').fill('');
  await page.evaluate(async({B,changeActor})=>{const f=promoFixture;if(changeActor){f.controller.reset();f.session.actor=B.actor;f.session.generation++;}await f.controller.setOrganization({id:B.org,current_role:'owner'});},{B,changeActor});
  await fill(page,B.client,B.booking);assert.equal((await state(page)).error,'','A warning must not leak into B');await submit(page);
  await page.evaluate(async({A,changeActor})=>{const f=promoFixture;if(changeActor){f.controller.reset();f.session.actor=A.actor;f.session.generation++;}await f.controller.setOrganization({id:A.org,current_role:'owner'});},{A,changeActor});
  const before=await state(page);assert.equal(before.code,'');assert.equal(writes(before).length,2);
  await restoreOriginal(page,before);await submit(page);const s=await state(page);
  assert.equal(s.rows.length,2);assert.deepEqual(writes(s).at(-1).args,writes(first)[0].args);
}]);

let failed=0;
try {
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
  for(const [name,run] of cases){
    const f=await fixture();
    try {await run(f.page);assert.deepEqual(f.errors,[]);assert.deepEqual(f.traffic,[]);console.log('PASS '+name);}
    catch(error){failed++;console.error('FAIL '+name+' — '+error.message);}
    finally {if(f.errors.length||f.traffic.length)console.error('Fixture diagnostics '+JSON.stringify({errors:f.errors,traffic:f.traffic}));await f.context.close();}
  }
} finally {await browser?.close();}
console.log(`${cases.length-failed}/${cases.length} native promo cases PASS; ${failed} RED; source sha256=${createHash('sha256').update(source).digest('hex')}; no production/SQL/bootstrap`);
process.exitCode=failed?1:0;
