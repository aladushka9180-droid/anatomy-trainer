import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';

// TEST-ONLY baseline f896ad54: full actual controller/bind/submit/change/load.
// Baseline result: 4 PASS / 10 RED; run with node --test, expected exit 1.
// Intentionally not included in CI. No skipped tests or expected-failure wrapper.
// Synthetic DOM + sequential v81:361-391 promo-redemption model, NOT SQL/SDK,
// native validation, RLS/locks/concurrency, cash movement or production evidence.
// Static authorized/enabled org, active in-date 10% promo, valid bookings and
// unlimited total/client usage; no conflicting benefit. Those gates are assumed,
// not tested. Model effects are promo rows/usage, NOT bonus debits/payment ledger.
// Same booking + new key is refused, NOT discounted twice. Changed-target POLICY
// cases separately require resolving/distinguishing an unknown intent; they do
// not establish that an explicit new eligible booking violates server rules.
// Replay omits promotion_id; discount/final are the original recorded amounts.
const source = readFileSync(process.env.MINUTA_LOYALTY_SOURCE || new URL('../loyalty-management.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../provider.html', import.meta.url), 'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ORG=id(1), ACTOR=id(2), CLIENT=id(3), BOOKING=id(4), NEXT_BOOKING=id(5), OTHER_BOOKING=id(6), OTHER_CLIENT=id(7), PROMOTION=id(8);
const CODE='WELCOME10';
const clone = value => JSON.parse(JSON.stringify(value));
const clients=[{id:CLIENT,client_name:'Клиент А',client_phone:'+79990000001'}, {id:OTHER_CLIENT,client_name:'Клиент Б',client_phone:'+79990000002'}];
const bookings=[BOOKING,NEXT_BOOKING,OTHER_BOOKING].map((booking,index)=>({id:booking,client_account_id:index===2?OTHER_CLIENT:CLIENT,
  client_name:index===2?'Клиент Б':'Клиент А',service_name:'Услуга',booking_date:`2026-09-0${6-index}`,booking_time:'10:00:00',
  visit_status:'completed',payment_method:'cash',amount_rub:10000}));

function model() {
  const rows=[];
  const fail=(code,message)=>({data:null,error:{code,message}});
  function apply(p) {
    assert.equal(p.p_organization,ORG);
    if(!p.p_request_id)return fail('22023','promotion_request_required');
    assert.match(p.p_request_id,/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const code=String(p.p_code||'').trim().toUpperCase();
    const old=rows.find(row=>row.organization_id===p.p_organization&&row.request_id===p.p_request_id);
    if(old) {
      if(old.booking_id!==p.p_booking||code!==CODE)return fail('23505','loyalty_request_conflict');
      return {data:{organization_id:ORG,id:old.id,discount_rub:old.discount_rub,final_amount_rub:old.final_amount_rub},error:null};
    }
    const booking=bookings.find(row=>row.id===p.p_booking);
    if(code!==CODE||!booking)return fail('55000','promo_not_available');
    if(rows.some(row=>row.organization_id===ORG&&row.booking_id===p.p_booking))return fail('23505','promo_already_applied');
    const amount=booking.amount_rub;
    const discount=Math.min(amount,Math.floor(amount*1000/10000));
    const row={id:id(100+rows.length),organization_id:ORG,promotion_id:PROMOTION,booking_id:booking.id,
      client_account_id:booking.client_account_id,request_id:p.p_request_id,original_amount_rub:amount,
      discount_rub:discount,final_amount_rub:amount-discount,actor_id:ACTOR,created_at:'2026-09-06T12:00:00Z'};
    rows.push(row);
    return {data:{organization_id:ORG,id:row.id,promotion_id:PROMOTION,discount_rub:discount,final_amount_rub:amount-discount},error:null};
  }
  const snapshot=()=>clone(rows);
  const workspace=()=>({organization_id:ORG,current_role:'owner',enabled:true,max_redeem_percent_bps:3000,rule:{earn_rate_bps:500,min_paid_amount_rub:0},
    clients:clone(clients),bookings:clone(bookings),accounts:[],ledger:[],promo_redemptions:clone(rows),
    promotions:[{id:PROMOTION,code:CODE,kind:'percent',value:1000,active:true,valid_from:'2026-01-01',valid_until:'2026-12-31',
      total_limit:null,per_client_limit:null,usage_count:rows.length}]});
  return {apply,snapshot,workspace,rows};
}

async function harness() {
  const nodes=new Map(),handlers=new Map(),calls=[],notices=[],server=model();
  let lost=false,nextResponse;
  const fields=['loyaltyPromoClient','loyaltyPromoBooking','loyaltyPromoApplyCode'];
  for(const [,nodeId] of html.matchAll(/id="((?:loyalty|reloadLoyalty)[^"]*)"/g)) {
    let options=[],value='',markup='';
    const isSelect=/Client$|Booking$/.test(nodeId);
    const node={id:nodeId,dataset:{},hidden:false,disabled:false,textContent:'',checked:false,
      get value(){return value;},set value(next){value=isSelect&&!options.includes(String(next))?'':String(next);},
      get innerHTML(){return markup;},set innerHTML(next){markup=String(next);if(isSelect){options=[...markup.matchAll(/<option value="([^"]*)"/g)].map(match=>match[1]);value=options[0]||'';}},
      closest:selector=>selector==='#loyaltyPanel'?nodes.get('loyaltyPanel'):
        selector==='#loyaltyPromoApplyForm'&&(nodeId==='loyaltyPromoApplyForm'||fields.includes(nodeId))?nodes.get('loyaltyPromoApplyForm'):null,
      querySelectorAll:()=>[],querySelector:()=>null};
    nodes.set(nodeId,node);
  }
  const get=nodeId=>{assert.ok(nodes.has(nodeId),`Unexpected fixture DOM id ${nodeId}`);return nodes.get(nodeId);};
  const button={textContent:'Применить',disabled:false,dataset:{}},form=get('loyaltyPromoApplyForm');
  form.reset=()=>{get('loyaltyPromoClient').value=CLIENT;get('loyaltyPromoBooking').value=BOOKING;get('loyaltyPromoApplyCode').value='';};
  fields.forEach(nodeId=>{get(nodeId).form=form;});
  form.querySelector=selector=>selector==='.form-error'?get('loyaltyPromoApplyError'):selector==='button[type="submit"]'?button:null;
  get('loyaltyPanel').querySelectorAll=()=>[button];
  const context=vm.createContext({window:{},crypto:{randomUUID},document:{addEventListener:(kind,callback)=>{assert.equal(handlers.has(kind),false);handlers.set(kind,callback);}}});
  vm.runInContext(source,context,{filename:'actual-loyalty-management.js'});
  const controller=context.window.MinutaLoyalty.createController({$:selector=>get(selector.slice(1)),escapeHtml:value=>String(value??''),
    notify:message=>notices.push(message),requireWrites:()=>true,getCurrentUser:()=>({id:ACTOR}),getSessionGeneration:()=>1,
    sessionIsCurrent:(actor,generation)=>actor===ACTOR&&generation===1,applyWriteAvailability(){},
    db:{rpc:async(name,parameters)=>{
      if(name==='get_minuta_loyalty_workspace')return {data:server.workspace(),error:null};
      assert.equal(name,'redeem_minuta_promotion','No other mutation is allowed in this fixture');
      // Inject malformed ACK BEFORE applying anything: false-success case has
      // zero synthetic rows, not a committed operation with a truncated reply.
      const reply=nextResponse===undefined?server.apply(clone(parameters)):nextResponse; nextResponse=undefined;
      calls.push({parameters:clone(parameters),reply:clone(reply)});
      if(lost&&!reply.error){lost=false;return {data:null,error:{code:'',message:'TypeError: Failed to fetch',details:'',hint:''}};}
      return reply;
    }}});
  controller.bind();await controller.setOrganization({id:ORG,current_role:'owner'});
  const event=async(kind,target)=>{assert.ok(handlers.has(kind));return handlers.get(kind)({target,submitter:button,preventDefault(){}});};
  const choose=async(client=CLIENT,booking=BOOKING)=>{get('loyaltyPromoClient').value=client;await event('change',get('loyaltyPromoClient'));get('loyaltyPromoBooking').value=booking;};
  await choose();get('loyaltyPromoApplyCode').value=CODE;
  return {server,calls,notices,get,controller,button,choose,submit:()=>event('submit',form),
    change:nodeId=>event('change',get(nodeId)),input:nodeId=>event('input',get(nodeId)),lose:()=>{lost=true;},
    replyNext:reply=>{nextResponse=reply;}};
}

async function unknown() {
  const h=await harness();h.lose();await h.submit();
  assert.equal(h.server.rows.length,1,'Model applies promo BEFORE losing the response');
  assert.equal(h.controller.payload.promo_redemptions.length,1,'Actual read reflects original committed promo use');
  return h;
}

test('CONTROL lost reply unchanged replay accepts exact v81 ACK without promotion_id',async t=>{
  const h=await unknown(),before=h.server.snapshot();await h.submit();
  assert.deepEqual(h.calls[1].parameters,h.calls[0].parameters);assert.deepEqual(h.server.snapshot(),before);
  assert.equal(h.calls[0].reply.data.promotion_id,PROMOTION);assert.equal('promotion_id' in h.calls[1].reply.data,false);
  assert.deepEqual(h.notices,['Промокод применён и проверен сервером']);assert.equal(h.get('loyaltyPromoApplyCode').value,'');
  t.diagnostic(`source baseline=f896ad54 sha256=${createHash('sha256').update(source).digest('hex')}`);
});

for(const field of ['loyaltyPromoClient','loyaltyPromoBooking','loyaltyPromoApplyCode'])test(`RECOVERY no-op change ${field} preserves original key`,async()=>{
  const h=await unknown(),before=h.server.snapshot();await h.change(field);await h.submit();
  assert.deepEqual(h.server.snapshot(),before,'New-key refusal is not a second discount of this booking');
  assert.equal(h.calls[1].parameters.p_request_id,h.calls[0].parameters.p_request_id);
  assert.equal(h.calls[1].reply.error,null);
});

test('RECOVERY uppercase/trim-equivalent edit and change retain original request',async()=>{
  const h=await unknown();h.get('loyaltyPromoApplyCode').value=`  ${CODE.toLowerCase()}  `;
  await h.input('loyaltyPromoApplyCode');assert.equal(h.get('loyaltyPromoApplyCode').value,CODE,'Actual input sanitizer uppercases and strips whitespace');
  await h.change('loyaltyPromoApplyCode');await h.submit();
  assert.equal(h.server.rows.length,1);assert.deepEqual(h.calls[1].parameters,h.calls[0].parameters);
});

test('CONTROL input-only uppercase normalization does not clear the key',async()=>{
  const h=await unknown();h.get('loyaltyPromoApplyCode').value=CODE.toLowerCase();await h.input('loyaltyPromoApplyCode');await h.submit();
  assert.deepEqual(h.calls[1].parameters,h.calls[0].parameters);assert.equal(h.server.rows.length,1);
});

test('RECOVERY code edit then revert is still the original unknown intent',async()=>{
  const h=await unknown();h.get('loyaltyPromoApplyCode').value='ANOTHER';await h.change('loyaltyPromoApplyCode');
  h.get('loyaltyPromoApplyCode').value=CODE;await h.change('loyaltyPromoApplyCode');await h.submit();
  assert.equal(h.calls[1].parameters.p_request_id,h.calls[0].parameters.p_request_id);
});

test('SAFETY organization-only ACK with zero rows cannot claim applied and reset form',async()=>{
  const h=await harness();h.replyNext({data:{organization_id:ORG},error:null});await h.submit();
  assert.equal(h.server.rows.length,0);
  assert.deepEqual(h.notices,[],'A matching organization is not a promo redemption receipt');
  assert.equal(h.get('loyaltyPromoApplyCode').value,CODE,'Unknown result must preserve original input');
});

for(const [label,client,booking] of [['non-first client',OTHER_CLIENT,OTHER_BOOKING],['non-first visit of same client',CLIENT,NEXT_BOOKING]]) {
  test(`RECOVERY reload preserves ${label} before unchanged replay`,async()=>{
    const h=await harness();await h.choose(client,booking);h.lose();await h.submit();
    const original=clone(h.calls[0].parameters);await h.submit();
    assert.equal(h.server.rows.length,1,'Wrong-target same-key conflict is not a second application');
    assert.deepEqual(h.calls[1].parameters,original,'No user edit occurred between original operation and retry');
    assert.equal(h.calls[1].reply.error,null);
  });
}

for(const [label,client,booking] of [['other visit',CLIENT,NEXT_BOOKING],['other client',OTHER_CLIENT,OTHER_BOOKING]]) {
  test(`POLICY unresolved then selected ${label} requires distinguishing a new intention`,async()=>{
    const h=await unknown(),before=h.server.snapshot();await h.choose(client,booking);await h.change('loyaltyPromoBooking');await h.submit();
    assert.deepEqual(h.server.snapshot(),before,'Desired unresolved-intent policy: explicitly resolve/separate before another booking application');
  });
}

test('CONTROL acknowledged application then explicitly new eligible booking is legal',async()=>{
  const h=await harness();await h.submit();await h.choose(CLIENT,NEXT_BOOKING);h.get('loyaltyPromoApplyCode').value=CODE;await h.change('loyaltyPromoBooking');await h.submit();
  assert.equal(h.server.rows.length,2);assert.notEqual(h.calls[0].parameters.p_request_id,h.calls[1].parameters.p_request_id);
  assert.deepEqual(h.notices,['Промокод применён и проверен сервером','Промокод применён и проверен сервером']);
});

test('MODEL same booking new key refuses; canonical code replay has original receipt',()=>{
  const m=model(),p={p_organization:ORG,p_booking:BOOKING,p_code:CODE,p_request_id:randomUUID()};
  const first=m.apply(p),before=m.snapshot();assert.equal(first.error,null);
  assert.deepEqual(m.apply({...p,p_request_id:randomUUID()}).error,{code:'23505',message:'promo_already_applied'});
  assert.deepEqual(m.apply({...p,p_booking:NEXT_BOOKING}).error,{code:'23505',message:'loyalty_request_conflict'});
  assert.deepEqual(m.apply({...p,p_code:'OTHER'}).error,{code:'23505',message:'loyalty_request_conflict'});
  assert.deepEqual(m.apply({...p,p_code:` ${CODE.toLowerCase()} `}),{data:{organization_id:ORG,id:first.data.id,discount_rub:1000,final_amount_rub:9000},error:null});
  assert.deepEqual(m.snapshot(),before);
});
