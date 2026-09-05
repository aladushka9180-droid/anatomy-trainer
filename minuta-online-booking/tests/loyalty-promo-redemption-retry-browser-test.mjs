import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

// TEST-ONLY native browser baseline 87721c45. Actual provider #loyaltyPanel DOM,
// whole controller/bind/render and native form validation/submit buttons.
// Baseline Chrome: 3 PASS / 10 RED (exit 1), not marked expected-fail or skipped.
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
  await page.evaluate(async({org,actor,client,booking,nextBooking,otherBooking,otherClient,promotion,code})=>{
    const clone=value=>structuredClone(value),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
    const rows=[],calls=[],notices=[];
    let mode='success';
    const clients=[{id:client,client_name:'Клиент А',client_phone:'+79990000001'},{id:otherClient,client_name:'Клиент Б',client_phone:'+79990000002'}];
    const bookings=[booking,nextBooking,otherBooking].map((value,index)=>({id:value,client_account_id:index===2?otherClient:client,
      client_name:index===2?'Клиент Б':'Клиент А',service_name:'Услуга',booking_date:`2026-09-0${6-index}`,booking_time:'10:00:00',
      visit_status:'completed',payment_method:'cash',amount_rub:10000}));
    function workspace(){return {organization_id:org,current_role:'owner',enabled:true,max_redeem_percent_bps:3000,rule:{earn_rate_bps:500,min_paid_amount_rub:0},
      clients:clone(clients),bookings:clone(bookings),accounts:[],ledger:[],promo_redemptions:clone(rows),
      promotions:[{id:promotion,code,kind:'percent',value:1000,active:true,valid_from:'2026-01-01',valid_until:'2026-12-31',
        total_limit:null,per_client_limit:null,usage_count:rows.length}]};}
    function apply(p){
      const fail=(code,message)=>({data:null,error:{code,message}});
      if(p.p_organization!==org)throw Error('Unmodelled organization');
      if(!p.p_request_id)return fail('22023','promotion_request_required');
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(p.p_request_id))throw Error('Invalid fixture request key');
      const canonical=String(p.p_code||'').trim().toUpperCase();
      const old=rows.find(row=>row.organization_id===org&&row.request_id===p.p_request_id);
      if(old){
        if(old.booking_id!==p.p_booking||canonical!==code)return fail('23505','loyalty_request_conflict');
        return {data:{organization_id:org,id:old.id,discount_rub:old.discount_rub,final_amount_rub:old.final_amount_rub},error:null};
      }
      const target=bookings.find(row=>row.id===p.p_booking);
      if(canonical!==code||!target)return fail('55000','promo_not_available');
      if(rows.some(row=>row.booking_id===target.id))return fail('23505','promo_already_applied');
      const amount=target.amount_rub,discount=Math.min(amount,Math.floor(amount*1000/10000));
      if(discount<1||amount-discount<0||amount>10000000)throw Error('Outside v81 promo CHECK constraints');
      const row={id:id(100+rows.length),organization_id:org,promotion_id:promotion,booking_id:target.id,client_account_id:target.client_account_id,
        request_id:p.p_request_id,original_amount_rub:amount,discount_rub:discount,final_amount_rub:amount-discount,actor_id:actor,created_at:'2026-09-06T12:00:00Z'};
      rows.push(row);
      return {data:{organization_id:org,id:row.id,promotion_id:promotion,discount_rub:discount,final_amount_rub:amount-discount},error:null};
    }
    const db={rpc:async(name,args)=>{
      const call={name,args:clone(args)};calls.push(call);
      if(name==='get_minuta_loyalty_workspace'){
        if(args.p_organization!==org)throw Error('Unmodelled workspace org');
        return {data:workspace(),error:null};
      }
      if(name!=='redeem_minuta_promotion')throw Error('Unexpected mutation '+name);
      const currentMode=mode;mode='success';
      // Malformed ACK is injected before applying: no fake discount row exists.
      if(currentMode==='malformed'){const reply={data:{organization_id:org},error:null};call.reply=clone(reply);return reply;}
      const reply=apply(args);call.reply=clone(reply);
      if(currentMode==='lost'&&!reply.error)return {data:null,error:{code:'',message:'TypeError: Failed to fetch',details:'',hint:''}};
      return reply;
    }};
    const $=selector=>document.querySelector(selector);
    const controller=MinutaLoyalty.createController({db,$,escapeHtml:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
      notify:message=>notices.push(message),requireWrites:()=>true,getCurrentUser:()=>({id:actor}),getSessionGeneration:()=>1,
      sessionIsCurrent:(user,generation)=>user===actor&&generation===1,applyWriteAvailability(){}});
    window.promoFixture={controller,rows,calls,notices,mode:value=>{mode=value;}};
    controller.bind();await controller.setOrganization({id:org,current_role:'owner'});
  },{org,actor,client,booking,nextBooking,otherBooking,otherClient,promotion,code});
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
    readRows:f.controller.payload?.promo_redemptions?.length,available:f.controller.availability};
});}
const writes=s=>s.calls.filter(call=>call.name==='redeem_minuta_promotion');
async function unknown(page,who=client,visit=booking){
  await fill(page,who,visit);await page.evaluate(()=>promoFixture.mode('lost'));await submit(page);
  const s=await state(page);assert.equal(s.rows.length,1);assert.equal(s.readRows,1,'Actual post-error reload exposes committed promo use');return s;
}
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
