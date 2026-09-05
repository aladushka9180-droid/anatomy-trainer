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
  const nodes=new Map(),handlers=new Map(),calls=[],reads=[],notices=[],server=model();
  let lost=false,nextResponse,writeReply,readReply,actor=ACTOR,generation=1;
  const fields=['loyaltyPromoClient','loyaltyPromoBooking','loyaltyPromoApplyCode'];
  for(const [,nodeId] of html.matchAll(/id="((?:loyalty|reloadLoyalty)[^"]*)"/g)) {
    let options=[],value='',markup='',text='';
    const isSelect=/Client$|Booking$/.test(nodeId);
    const node={id:nodeId,dataset:{},hidden:false,disabled:false,checked:false,
      get textContent(){return text;},set textContent(next){text=String(next);markup='';},
      get value(){return value;},set value(next){value=isSelect&&!options.includes(String(next))?'':String(next);},
      get innerHTML(){return markup;},set innerHTML(next){markup=String(next);text=markup.replace(/<[^>]*>/g,'');if(isSelect){options=[...markup.matchAll(/<option value="([^"]*)"/g)].map(match=>match[1]);value=options[0]||'';}},
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
    notify:message=>notices.push(message),requireWrites:()=>true,getCurrentUser:()=>actor?({id:actor}):null,getSessionGeneration:()=>generation,
    sessionIsCurrent:(who,epoch)=>who===actor&&epoch===generation,applyWriteAvailability(){},
    db:{rpc:async(name,parameters)=>{
      if(name==='get_minuta_loyalty_workspace'){
        reads.push(clone(parameters));if(readReply){const next=readReply;readReply=null;return next(parameters);}
        return {data:{...server.workspace(),organization_id:parameters.p_organization},error:null};
      }
      assert.equal(name,'redeem_minuta_promotion','No other mutation is allowed in this fixture');
      if(writeReply){const next=writeReply;writeReply=null;const call={parameters:clone(parameters)};calls.push(call);const reply=await next(parameters);call.reply=clone(reply);return reply;}
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
  const restore=()=>{assert.match(get('loyaltyPromoApplyError').innerHTML,/<button type="button" data-loyalty-restore-promo>/);return event('click',{closest:selector=>selector==='[data-loyalty-restore-promo]'?{closest:s=>s==='#loyaltyPromoApplyForm'?form:null}:null});};
  return {server,calls,reads,notices,get,controller,button,choose,restore,submit:()=>event('submit',form),
    change:nodeId=>event('change',get(nodeId)),input:nodeId=>event('input',get(nodeId)),lose:()=>{lost=true;},
    replyNext:reply=>{nextResponse=reply;},invalid:nodeId=>event('invalid',get(nodeId)),
    write:callback=>{writeReply=callback;},read:callback=>{readReply=callback;},actor:next=>{actor=next;generation++;}};
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

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const ack=(organization=ORG)=>({data:{organization_id:organization,id:id(100),promotion_id:PROMOTION,discount_rub:1000,final_amount_rub:9000},error:null});
const refused=()=>({data:null,error:{code:'55000',message:'promo_not_available'}});
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('RECOVERY blank required code has repeatable restore action with zero RPC and separate original-key submit',async()=>{
  const h=await unknown();
  for(let i=0;i<2;i++){
    h.get('loyaltyPromoApplyCode').value='';await h.input('loyaltyPromoApplyCode');await h.invalid('loyaltyPromoApplyCode');
    await h.restore();assert.equal(h.calls.length,1);assert.equal(h.get('loyaltyPromoApplyCode').value,CODE);assert.deepEqual(h.notices,[]);
  }
  await h.submit();assert.deepEqual(h.calls[1].parameters,h.calls[0].parameters);assert.doesNotMatch(h.get('loyaltyPromoApplyError').innerHTML,/data-loyalty-restore-promo/);
});
test('RECOVERY changed code visibly restores without applying anything until separate submit',async()=>{
  const h=await unknown();h.get('loyaltyPromoApplyCode').value='OTHER';await h.submit();
  assert.equal(h.calls.length,1);assert.equal(h.get('loyaltyPromoApplyCode').value,CODE);await h.submit();assert.deepEqual(h.calls[1].parameters,h.calls[0].parameters);
});
test('RECOVERY initial lowercase/trim code is canonical in immutable parameters',async()=>{
  const h=await harness();h.get('loyaltyPromoApplyCode').value=' welcome10 ';h.lose();await h.submit();
  assert.equal(h.calls[0].parameters.p_code,CODE);await h.input('loyaltyPromoApplyCode');await h.change('loyaltyPromoApplyCode');await h.submit();
  assert.deepEqual(h.calls[1].parameters,h.calls[0].parameters);
});
test('RECOVERY no-op client event retains its non-first visit',async()=>{
  const h=await harness();await h.choose(CLIENT,NEXT_BOOKING);h.lose();await h.submit();await h.change('loyaltyPromoClient');await h.submit();
  assert.deepEqual(h.calls[1].parameters,h.calls[0].parameters);
});

for(const [name,data] of [
  ['null',null],['organization only',{organization_id:ORG}],['invalid id',{...ack().data,id:'invalid'}],
  ['foreign organization',{...ack().data,organization_id:id(999)}],['zero discount',{...ack().data,discount_rub:0}],
  ['fractional discount',{...ack().data,discount_rub:0.5}],['string discount',{...ack().data,discount_rub:'1000'}],
  ['negative final',{...ack().data,final_amount_rub:-1}],['fractional final',{...ack().data,final_amount_rub:1.5}],
  ['string final',{...ack().data,final_amount_rub:'9000'}],['impossible sum',{...ack().data,discount_rub:10000000,final_amount_rub:1}],
  ['present invalid promotion id',{...ack().data,promotion_id:null}]
])test(`RECOVERY malformed ${name} ACK cannot resolve unknown or manufacture success`,async()=>{
  const h=await harness();h.replyNext({data,error:null});await h.submit();assert.equal(h.server.rows.length,0);assert.deepEqual(h.notices,[]);
  assert.match(h.get('loyaltyPromoApplyError').textContent,/Не удалось подтвердить/);await h.submit();assert.deepEqual(h.calls[1].parameters,h.calls[0].parameters);assert.equal(h.server.rows.length,1);
});
for(const [discount,final] of [[1,0],[10000000,0],[1,9999999]])test(`CONTROL SQL amount boundary ${discount}+${final} accepts replay without promotion_id`,async()=>{
  const h=await harness();h.replyNext({data:{organization_id:ORG,id:id(100),discount_rub:discount,final_amount_rub:final},error:null});await h.submit();
  assert.deepEqual(h.notices,['Промокод применён и проверен сервером']);
});
test('CONTROL replay amount is recorded, not recomputed from a changed current booking or promotion',async()=>{
  const h=await unknown();h.read(()=>{const data=h.server.workspace();data.bookings[0].amount_rub=500;data.promotions[0].value=5000;return {data,error:null};});
  await h.controller.load();await h.submit();assert.equal(h.calls[1].reply.data.discount_rub,1000);assert.equal(h.calls[1].reply.data.final_amount_rub,9000);
  assert.deepEqual(h.notices,['Промокод применён и проверен сервером']);
});

for(const [name,reply] of [
  ['fulfilled transport',()=>({data:null,error:{code:'08006',message:'promo_not_available'}})],
  ['no-code business text',()=>({data:null,error:{message:'promo_not_available'}})],
  ['unrelated 23505',()=>({data:null,error:{code:'23505',message:'other_unique_constraint'}})],
  ['request conflict',()=>({data:null,error:{code:'23505',message:'loyalty_request_conflict'}})],
  ['thrown exact-looking refusal',()=>{throw Object.assign(new Error('promo_not_available'),{code:'55000'});}]
])test(`RECOVERY ${name} retains identity and truthful unknown status`,async()=>{
  const h=await harness();h.write(reply);await h.submit();assert.equal(h.button.disabled,false);assert.deepEqual(h.notices,[]);
  assert.match(h.get('loyaltyPromoApplyError').textContent,/Не удалось подтвердить/);assert.doesNotMatch(h.get('loyaltyPromoApplyError').textContent,/не сохранено/i);
  await h.submit();assert.deepEqual(h.calls[1].parameters,h.calls[0].parameters);
});
test('CONTROL exact initial refusal allows an explicitly corrected new request',async()=>{
  const h=await harness();h.write(refused);await h.submit();assert.match(h.get('loyaltyPromoApplyError').textContent,/Промокод недоступен/);
  await h.choose(CLIENT,NEXT_BOOKING);await h.submit();assert.notEqual(h.calls[1].parameters.p_request_id,h.calls[0].parameters.p_request_id);
});
test('RECOVERY a refusal after unknown does not disprove the first committed use',async()=>{
  const h=await unknown();h.write(refused);await h.submit();assert.match(h.get('loyaltyPromoApplyError').textContent,/Не удалось подтвердить/);
  await h.submit();assert.deepEqual(h.calls[2].parameters,h.calls[0].parameters);assert.equal(h.server.rows.length,1);
});

for(const rejection of [false,true])test(`RECOVERY read ${rejection?'throw':'error'} preserves non-first client/visit/code and can retry read only`,async()=>{
  const h=await harness();await h.choose(OTHER_CLIENT,OTHER_BOOKING);h.lose();h.read(()=>{if(rejection)throw Error('read');return {data:null,error:{message:'read'}};});await h.submit();
  assert.equal(h.controller.availability,'error');assert.equal(h.calls.length,1);await h.controller.load();assert.equal(h.calls.length,1);
  assert.equal(h.get('loyaltyPromoClient').value,OTHER_CLIENT);assert.equal(h.get('loyaltyPromoBooking').value,OTHER_BOOKING);assert.equal(h.get('loyaltyPromoApplyCode').value,CODE);
  await h.submit();assert.deepEqual(h.calls[1].parameters,h.calls[0].parameters);
});
test('RECOVERY read render preserves edits made while its RPC was pending',async()=>{
  const h=await unknown(),read=deferred();h.read(()=>read.promise);const loading=h.controller.load();h.get('loyaltyPromoApplyCode').value='OTHER';await h.input('loyaltyPromoApplyCode');
  read.resolve({data:h.server.workspace(),error:null});await loading;assert.equal(h.get('loyaltyPromoApplyCode').value,'OTHER');await h.restore();assert.equal(h.get('loyaltyPromoApplyCode').value,CODE);assert.equal(h.calls.length,1);
});
test('RECOVERY missing original visit remains blank instead of silently replaying another booking',async()=>{
  const h=await unknown();h.read(()=>{const data=h.server.workspace();data.bookings=data.bookings.filter(row=>row.id!==BOOKING);return {data,error:null};});await h.controller.load();await h.restore();
  assert.equal(h.get('loyaltyPromoBooking').value,'');assert.match(h.get('loyaltyPromoApplyError').textContent,/недоступен/);await h.submit();assert.equal(h.calls.length,1);
});
test('RECOVERY pending input/change/direct duplicate submission is single-flight',async()=>{
  const h=await harness(),d=deferred();h.write(()=>d.promise);const pending=h.submit();h.get('loyaltyPromoApplyCode').value='OTHER';await h.input('loyaltyPromoApplyCode');await h.change('loyaltyPromoApplyCode');await h.submit();
  assert.equal(h.calls.length,1);assert.equal(h.button.disabled,true);d.resolve({data:null,error:{message:'lost'}});await pending;await h.restore();await h.submit();assert.deepEqual(h.calls[1].parameters,h.calls[0].parameters);
});

for(const outcome of ['success','error','throw'])for(const scope of ['organization','account','session'])test(`CONTEXT pending ${scope} switch ignores late ${outcome} and loads new scope`,async()=>{
  const h=await harness(),d=deferred(),orgB=id(30);h.write(()=>d.promise);const pending=h.submit();if(scope!=='organization')h.actor(scope==='account'?id(40):ACTOR);
  await h.controller.setOrganization({id:orgB,current_role:'owner'});assert.equal(h.get('loyaltyWorkspace').hidden,true);
  if(outcome==='throw')d.reject(Error('transport'));else d.resolve(outcome==='success'?ack():refused());await pending;
  assert.equal(h.controller.payload.organization_id,orgB);assert.equal(h.controller.availability,'ready');assert.deepEqual(h.notices,[]);assert.equal(h.get('loyaltyPromoApplyError').hidden,true);assert.equal(h.button.disabled,false);
});
test('CONTEXT A → B → A pending consumes only the latest organization',async()=>{
  const h=await harness(),d=deferred();h.write(()=>d.promise);const pending=h.submit();await h.controller.setOrganization({id:id(30),current_role:'owner'});await h.controller.setOrganization({id:ORG,current_role:'owner'});
  d.resolve({data:null,error:{message:'lost'}});await pending;assert.equal(h.controller.payload.organization_id,ORG);assert.equal(h.reads.some(p=>p.p_organization===id(30)),false);assert.match(h.get('loyaltyPromoApplyError').textContent,/Не удалось подтвердить/);
});
for(const outcome of ['success','error','throw'])test(`CONTEXT reset and independent pending B cannot be unlocked by late A ${outcome}`,async()=>{
  const h=await harness(),a=deferred(),b=deferred(),orgB=id(30);h.write(()=>a.promise);const old=h.submit();h.controller.reset();h.actor(id(40));await h.controller.setOrganization({id:orgB,current_role:'owner'});
  h.get('loyaltyPromoApplyCode').value=CODE;h.write(()=>b.promise);const current=h.submit();
  if(outcome==='throw')a.reject(Error('old'));else a.resolve(outcome==='success'?ack():refused());await old;
  assert.equal(h.button.disabled,true);assert.equal(h.button.textContent,'Сохраняем…');await h.submit();assert.equal(h.calls.length,2);b.resolve(ack(orgB));await current;assert.deepEqual(h.notices,['Промокод применён и проверен сервером']);
});
for(const outcome of ['success','error','throw'])test(`CONTEXT queued logout ${outcome} never restores previous workspace`,async()=>{
  const h=await harness(),d=deferred();h.write(()=>d.promise);const pending=h.submit();h.actor(null);await h.controller.setOrganization(null);
  if(outcome==='throw')d.reject(Error('transport'));else d.resolve(outcome==='success'?ack():refused());await pending;
  assert.equal(h.controller.payload,null);assert.equal(h.get('loyaltyPanel').hidden,true);assert.deepEqual(h.notices,[]);
});
test('CONTEXT queued read throws safely and retry does not repeat mutation',async()=>{
  const h=await harness(),d=deferred(),orgB=id(30);h.write(()=>d.promise);const pending=h.submit();await h.controller.setOrganization({id:orgB,current_role:'owner'});h.read(()=>{throw Error('workspace');});d.resolve(refused());await pending;
  assert.equal(h.controller.availability,'error');await h.controller.load();assert.equal(h.controller.payload.organization_id,orgB);assert.equal(h.calls.length,1);
});
test('CONTEXT late queued B read failure cannot repaint newer C',async()=>{
  const h=await harness(),d=deferred(),read=deferred(),orgC=id(31);h.write(()=>d.promise);const pending=h.submit();await h.controller.setOrganization({id:id(30),current_role:'owner'});
  h.read(()=>read.promise);d.resolve(refused());await tick();await h.controller.setOrganization({id:orgC,current_role:'owner'});read.reject(Error('stale'));await pending;
  assert.equal(h.controller.availability,'ready');assert.equal(h.controller.payload.organization_id,orgC);assert.equal(h.get('loyaltyUnavailable').hidden,true);
});
for(const scope of ['organization','account'])test(`CONTEXT unknown warning/invalid draft return with original ${scope}, not foreign one`,async()=>{
  const h=await unknown();h.get('loyaltyPromoApplyCode').value='';await h.input('loyaltyPromoApplyCode');if(scope==='account')h.actor(id(40));await h.controller.setOrganization({id:id(30),current_role:'owner'});
  assert.equal(h.get('loyaltyPromoApplyError').hidden,true);h.get('loyaltyPromoApplyCode').value=CODE;h.write(()=>ack(id(30)));await h.submit();if(scope==='account')h.actor(ACTOR);await h.controller.setOrganization({id:ORG,current_role:'owner'});
  assert.equal(h.get('loyaltyPromoApplyCode').value,'');assert.match(h.get('loyaltyPromoApplyError').textContent,/Не удалось подтвердить/);await h.restore();assert.equal(h.calls.length,2);await h.submit();assert.deepEqual(h.calls[2].parameters,h.calls[0].parameters);
});
test('BOUNDARY a full new controller has no durable unknown-key registry',async()=>{
  const first=await unknown(),second=await harness();await second.submit();assert.notEqual(second.calls[0].parameters.p_request_id,first.calls[0].parameters.p_request_id);
  // Separate fixtures establish memory scope only. SQL separately prevents a
  // second promo row for the same booking; no duplicate cash effect is claimed.
});
