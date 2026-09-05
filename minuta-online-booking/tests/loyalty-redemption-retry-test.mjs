import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';

// TEST-ONLY: complete actual controller/bind/submit/change/load/render executes.
// Fresh v452 baseline: 4 PASS / 8 RED; failures intentionally stay real exit 1.
// Added same-client/non-first-booking regression: 4 PASS / 9 RED total.
// DOM and sequential RPC transport are fixtures, NOT native browser/SDK/SQL.
// Synthetic model is limited to v81:299-326 under static authorized/enabled,
// completed-paid bookings with no other benefit. No RLS/locks/PG/concurrency,
// v87 payments, real balance or durable reload recovery is proved here.
// Replay tuple is (organization, request key, booking, points). Replay ACK has
// no balance_points; initial ACK does. SQL also forbids a second redemption of
// the same booking under a NEW key. Such a refusal is NOT a duplicate debit.
// Redemption has no free-text reason/trim field. Decimal-equivalent integer
// points (100.0 -> 100) exercise actual Number/Math.round canonicalization.
const source = readFileSync(process.env.MINUTA_LOYALTY_SOURCE || new URL('../loyalty-management.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../provider.html', import.meta.url), 'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const ORG=id(1), ACTOR=id(2), CLIENT=id(3), BOOKING=id(4), NEXT_BOOKING=id(5), OTHER_BOOKING=id(6), OTHER_CLIENT=id(7);
const clone = value => JSON.parse(JSON.stringify(value));
const clients=[{id:CLIENT,client_name:'Клиент А',client_phone:'+79990000001'},{id:OTHER_CLIENT,client_name:'Клиент Б',client_phone:'+79990000002'}];
const bookings=[BOOKING,NEXT_BOOKING,OTHER_BOOKING].map((booking,index)=>({id:booking,client_account_id:index===2?OTHER_CLIENT:CLIENT,
  client_name:index===2?'Клиент Б':'Клиент А',service_name:'Услуга',booking_date:`2026-09-0${6-index}`,booking_time:'10:00:00',
  visit_status:'completed',payment_method:'cash',amount_rub:10000}));

function model() {
  const redemptions=[],ledger=[],balances=new Map([[CLIENT,5000],[OTHER_CLIENT,5000]]);
  const fail=(code,message)=>({data:null,error:{code,message}});
  function apply(p) {
    assert.equal(p.p_organization,ORG);assert.match(p.p_request_id,/^[0-9a-f-]{36}$/);
    if(!Number.isInteger(p.p_points)||p.p_points<1||p.p_points>10000000)return fail('22023','invalid_loyalty_redemption');
    const prior=redemptions.find(row=>row.organization_id===p.p_organization&&row.request_id===p.p_request_id);
    if(prior){
      if(prior.booking_id!==p.p_booking||prior.points!==p.p_points)return fail('23505','loyalty_request_conflict');
      return {data:{organization_id:ORG,id:prior.id,points:prior.points},error:null};
    }
    const booking=bookings.find(row=>row.id===p.p_booking);
    if(!booking)return fail('55000','loyalty_booking_not_paid');
    const client=booking.client_account_id,balance=balances.get(client);
    if(balance<p.p_points)return fail('55000','insufficient_loyalty_balance');
    if(p.p_points>Math.floor(booking.amount_rub*3000/10000))return fail('55000','loyalty_redemption_limit_exceeded');
    if(redemptions.some(row=>row.booking_id===p.p_booking))return fail('23505','loyalty_booking_already_redeemed');
    const row={id:id(100+redemptions.length),organization_id:ORG,account_id:client===CLIENT?id(20):id(21),
      booking_id:booking.id,points:p.p_points,request_id:p.p_request_id,actor_id:ACTOR,created_at:'2026-09-06T12:00:00Z'};
    redemptions.push(row);balances.set(client,balance-p.p_points);
    ledger.push({id:ledger.length+1,organization_id:ORG,account_id:row.account_id,client_account_id:client,event_type:'redemption',
      points_delta:-p.p_points,balance_after:balance-p.p_points,booking_id:booking.id,request_id:p.p_request_id,
      reason:'Списание на завершённый оплаченный визит',actor_id:ACTOR,created_at:row.created_at});
    return {data:{organization_id:ORG,id:row.id,points:p.p_points,balance_points:balance-p.p_points},error:null};
  }
  const snapshot=()=>clone({redemptions,ledger,balances:[...balances]});
  const workspace=()=>({organization_id:ORG,current_role:'owner',enabled:true,max_redeem_percent_bps:3000,rule:{earn_rate_bps:500,min_paid_amount_rub:0},
    clients:clone(clients),bookings:clone(bookings),accounts:[...balances].map(([client_account_id,balance_points],index)=>({id:id(20+index),client_account_id,balance_points,lifetime_earned:5000,lifetime_spent:5000-balance_points})),
    promotions:[],promo_redemptions:[],ledger:clone(ledger)});
  return {apply,snapshot,workspace,redemptions,ledger,balances};
}

async function harness() {
  const nodes=new Map(),handlers=new Map(),calls=[],reads=[],notices=[],server=model();let lost=false, actor=ACTOR,generation=1,writeReply,readReply;
  const fieldIds=['loyaltyRedeemClient','loyaltyRedeemBooking','loyaltyRedeemPoints'];
  for(const [,nodeId] of html.matchAll(/id="((?:loyalty|reloadLoyalty)[^"]*)"/g)) {
    let options=[],value='',markup='',text='';
    const select=/Client$|Booking$/.test(nodeId);
    const node={id:nodeId,dataset:{},hidden:false,disabled:false,checked:false,
      get textContent(){return text;},set textContent(next){text=String(next);markup='';},
      get value(){return value;},set value(next){value=select&&!options.includes(String(next))?'':String(next);},
      get innerHTML(){return markup;},set innerHTML(next){markup=String(next);text=markup.replace(/<[^>]*>/g,'');if(select){options=[...markup.matchAll(/<option value="([^"]*)"/g)].map(match=>match[1]);value=options[0]||'';}},
      closest:selector=>selector==='#loyaltyPanel'?nodes.get('loyaltyPanel'):
        selector==='#loyaltyRedeemForm'&&(nodeId==='loyaltyRedeemForm'||fieldIds.includes(nodeId))?nodes.get('loyaltyRedeemForm'):null,
      querySelectorAll:()=>[],querySelector:()=>null};nodes.set(nodeId,node);
  }
  const get=nodeId=>{assert.ok(nodes.has(nodeId),`Unexpected fixture selector ${nodeId}`);return nodes.get(nodeId);};
  const button={textContent:'Списать',disabled:false,dataset:{}},form=get('loyaltyRedeemForm');
  form.reset=()=>{get('loyaltyRedeemClient').value=CLIENT;get('loyaltyRedeemBooking').value=BOOKING;get('loyaltyRedeemPoints').value='';};
  fieldIds.forEach(nodeId=>{get(nodeId).form=form;});form.querySelector=selector=>selector==='.form-error'?get('loyaltyRedeemError'):selector==='button[type="submit"]'?button:null;
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
      assert.equal(name,'redeem_minuta_loyalty','Only the assigned redemption RPC may mutate this fixture');
      if(writeReply){const next=writeReply;writeReply=null;const call={parameters:clone(parameters)};calls.push(call);const reply=await next(parameters);call.reply=clone(reply);return reply;}
      const reply=server.apply(clone(parameters));calls.push({parameters:clone(parameters),reply:clone(reply)});
      if(lost&&!reply.error){lost=false;return {data:null,error:{code:'',message:'TypeError: Failed to fetch',details:'',hint:''}};}
      return reply;
    }}});
  controller.bind();await controller.setOrganization({id:ORG,current_role:'owner'});
  const event=async(kind,target)=>{assert.ok(handlers.has(kind));return handlers.get(kind)({target,submitter:button,preventDefault(){}});};
  const choose=async(client=CLIENT,booking=BOOKING)=>{get('loyaltyRedeemClient').value=client;await event('change',get('loyaltyRedeemClient'));get('loyaltyRedeemBooking').value=booking;};
  await choose();get('loyaltyRedeemPoints').value='100';
  const restore=()=>{assert.match(get('loyaltyRedeemError').innerHTML,/<button type="button" data-loyalty-restore-redemption>/);return event('click',{closest:selector=>selector==='[data-loyalty-restore-redemption]'?{closest:s=>s==='#loyaltyRedeemForm'?form:null}:null});};
  return {server,calls,reads,notices,get,controller,button,choose,restore,submit:()=>event('submit',form),change:nodeId=>event('change',get(nodeId)),input:nodeId=>event('input',get(nodeId)),invalid:nodeId=>event('invalid',get(nodeId)),lose:()=>{lost=true;},
    write:callback=>{writeReply=callback;},read:callback=>{readReply=callback;},actor:next=>{actor=next;generation++;}};
}

async function unknown() {
  const h=await harness();h.lose();await h.submit();
  assert.equal(h.server.redemptions.length,1);assert.equal(h.server.balances.get(CLIENT),4900);
  assert.equal(h.controller.payload.ledger.length,1,'Actual recovery load reflects committed debit');
  return h;
}

test('CONTROL initial ACK and unchanged retry use the different exact v81 response shapes',async t=>{
  const h=await unknown(),before=h.server.snapshot();await h.submit();
  assert.deepEqual(h.calls[1].parameters,h.calls[0].parameters);assert.deepEqual(h.server.snapshot(),before);
  assert.equal(h.calls[0].reply.data.balance_points,4900);assert.equal('balance_points' in h.calls[1].reply.data,false);
  assert.deepEqual(h.notices,['Бонусы списаны']);assert.equal(h.get('loyaltyRedeemPoints').value,'');
  t.diagnostic(`actual controller sha256=${createHash('sha256').update(source).digest('hex')}`);
});

for(const field of ['loyaltyRedeemClient','loyaltyRedeemBooking','loyaltyRedeemPoints'])test(`RECOVERY no-op change ${field} retains request identity rather than already-redeemed refusal`,async()=>{
  const h=await unknown(),before=h.server.snapshot();await h.change(field);await h.submit();
  assert.deepEqual(h.server.snapshot(),before,'SQL one-redemption-per-booking prevents a second debit even on the buggy new-key path');
  assert.equal(h.calls[1].parameters.p_request_id,h.calls[0].parameters.p_request_id,'No-op must replay original intent, not fail as a new redemption');
  assert.equal(h.calls[1].reply.error,null);
});

test('RECOVERY decimal-equivalent integer points after change retain original tuple/key',async()=>{
  const h=await unknown();h.get('loyaltyRedeemPoints').value='100.0';await h.input('loyaltyRedeemPoints');await h.change('loyaltyRedeemPoints');await h.submit();
  assert.equal(h.server.redemptions.length,1);assert.deepEqual(h.calls[1].parameters,h.calls[0].parameters);
});

test('CONTROL numeric-equivalent input alone does not reset the existing request key',async()=>{
  const h=await unknown();h.get('loyaltyRedeemPoints').value='100.0';await h.input('loyaltyRedeemPoints');await h.submit();
  assert.deepEqual(h.calls[1].parameters,h.calls[0].parameters);assert.equal(h.server.redemptions.length,1);
});

test('RECOVERY edit then revert to original points cannot manufacture a new key',async()=>{
  const h=await unknown();h.get('loyaltyRedeemPoints').value='200';await h.change('loyaltyRedeemPoints');
  h.get('loyaltyRedeemPoints').value='100';await h.change('loyaltyRedeemPoints');await h.submit();
  assert.equal(h.calls[1].parameters.p_request_id,h.calls[0].parameters.p_request_id);
});

for(const [label,client,booking] of [['other visit',CLIENT,NEXT_BOOKING],['other client',OTHER_CLIENT,OTHER_BOOKING]])test(`POLICY changed unresolved ${label} is not permission to debit a second visit`,async()=>{
  const h=await unknown(),before=h.server.snapshot();await h.choose(client,booking);await h.change('loyaltyRedeemBooking');await h.submit();
  assert.deepEqual(h.server.snapshot(),before,'Resolve or explicitly separate the unknown intent before accepting another debit');
});

test('RECOVERY original non-first client/visit must survive automatic reload before unchanged retry',async()=>{
  const h=await harness();await h.choose(OTHER_CLIENT,OTHER_BOOKING);h.lose();await h.submit();
  const original=clone(h.calls[0].parameters);await h.submit();
  assert.equal(h.server.redemptions.length,1);assert.deepEqual(h.calls[1].parameters,original,'No user edit occurred, but actual render must not silently change replay target');
});

test('RECOVERY non-first booking of the SAME client survives reload without changing replay target',async t=>{
  const h=await harness();await h.choose(CLIENT,NEXT_BOOKING);h.lose();await h.submit();
  const original=clone(h.calls[0].parameters),committed=h.server.snapshot();
  assert.equal(original.p_booking,NEXT_BOOKING);assert.equal(h.get('loyaltyRedeemClient').value,CLIENT);
  // No input/change event between the lost response's actual load/render and retry.
  await h.submit();
  assert.deepEqual(h.server.snapshot(),committed,'Same-key changed-booking conflict is not a second debit');
  assert.equal(h.calls[1].parameters.p_request_id,original.p_request_id);
  t.diagnostic(JSON.stringify({originalBooking:original.p_booking,retryBooking:h.calls[1].parameters.p_booking,
    retryError:h.calls[1].reply.error,redemptions:h.server.redemptions.length}));
  assert.deepEqual(h.calls[1].parameters,original,'Actual render must preserve second visit even when client selection stays unchanged');
  assert.equal(h.calls[1].reply.error,null);
});

test('CONTROL ACK followed by explicit new redemption on a different eligible visit is legal',async()=>{
  const h=await harness();await h.submit();await h.choose(CLIENT,NEXT_BOOKING);h.get('loyaltyRedeemPoints').value='100';await h.change('loyaltyRedeemBooking');await h.submit();
  assert.equal(h.server.redemptions.length,2);assert.equal(h.server.ledger.length,2);assert.equal(h.server.balances.get(CLIENT),4800);
  assert.notEqual(h.calls[0].parameters.p_request_id,h.calls[1].parameters.p_request_id);assert.deepEqual(h.notices,['Бонусы списаны','Бонусы списаны']);
});

test('MODEL boundary same visit/new key is refused, same key/different visit conflicts, replay excludes balance',()=>{
  const server=model(),p={p_organization:ORG,p_booking:BOOKING,p_points:100,p_request_id:randomUUID()};
  const first=server.apply(p),before=server.snapshot();assert.equal(first.error,null);
  assert.deepEqual(server.apply({...p,p_request_id:randomUUID()}).error,{code:'23505',message:'loyalty_booking_already_redeemed'});
  assert.deepEqual(server.apply({...p,p_booking:NEXT_BOOKING}).error,{code:'23505',message:'loyalty_request_conflict'});
  assert.deepEqual(server.apply(p),{data:{organization_id:ORG,id:first.data.id,points:100},error:null});assert.deepEqual(server.snapshot(),before);
});

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const ack=(organization=ORG)=>({data:{organization_id:organization,id:id(100),points:100,balance_points:4900},error:null});
const refusal=()=>({data:null,error:{code:'55000',message:'insufficient_loyalty_balance'}});
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('RECOVERY native-invalid fields have an independent repeatable restore action with zero RPC',async()=>{
  const h=await unknown();
  for(let i=0;i<2;i++){
    h.get('loyaltyRedeemPoints').value='';await h.input('loyaltyRedeemPoints');await h.invalid('loyaltyRedeemPoints');
    await h.restore();assert.equal(h.calls.length,1);assert.equal(h.get('loyaltyRedeemPoints').value,'100');assert.deepEqual(h.notices,[]);
  }
  await h.submit();assert.deepEqual(h.calls[1].parameters,h.calls[0].parameters);
  assert.doesNotMatch(h.get('loyaltyRedeemError').innerHTML,/data-loyalty-restore-redemption/);
});

test('RECOVERY changed unresolved target restores visibly without RPC; separate submit replays exact snapshot',async()=>{
  const h=await unknown();await h.choose(OTHER_CLIENT,OTHER_BOOKING);await h.submit();
  assert.equal(h.calls.length,1);assert.equal(h.get('loyaltyRedeemClient').value,CLIENT);assert.equal(h.get('loyaltyRedeemBooking').value,BOOKING);
  await h.submit();assert.deepEqual(h.calls[1].parameters,h.calls[0].parameters);
});

for(const [name,data] of [
  ['null',null],['organization only',{organization_id:ORG}],['invalid UUID',{...ack().data,id:'invalid'}],
  ['wrong organization',{...ack().data,organization_id:id(999)}],['different points',{...ack().data,points:101}],
  ['string points',{...ack().data,points:'100'}],['negative balance',{...ack().data,balance_points:-1}],
  ['impossible balance',{...ack().data,balance_points:10000001}],['null balance',{...ack().data,balance_points:null}]
])test(`RECOVERY malformed ${name} ACK keeps the immutable key without success`,async()=>{
  const h=await harness();h.write(()=>({data,error:null}));await h.submit();
  assert.deepEqual(h.notices,[]);assert.match(h.get('loyaltyRedeemError').textContent,/Не удалось подтвердить/);
  await h.submit();assert.deepEqual(h.calls[1].parameters,h.calls[0].parameters);assert.equal(h.server.redemptions.length,1);
});

test('CONTROL valid optional balance upper boundary is accepted',async()=>{
  const h=await harness();h.write(()=>({data:{...ack().data,balance_points:10000000},error:null}));await h.submit();
  assert.deepEqual(h.notices,['Бонусы списаны']);
});

for(const [name,reply] of [
  ['transport envelope',()=>({data:null,error:{code:'08006',message:'insufficient_loyalty_balance'}})],
  ['no-code business-looking error',()=>({data:null,error:{message:'insufficient_loyalty_balance'}})],
  ['thrown business-looking error',()=>{throw Object.assign(new Error('insufficient_loyalty_balance'),{code:'55000'});}]
])test(`RECOVERY ${name} stays unknown and can retry exact original`,async()=>{
  const h=await harness();h.write(reply);await h.submit();assert.equal(h.button.disabled,false);
  assert.match(h.get('loyaltyRedeemError').textContent,/Не удалось подтвердить/);assert.doesNotMatch(h.get('loyaltyRedeemError').textContent,/не сохранено/i);
  await h.submit();assert.deepEqual(h.calls[1].parameters,h.calls[0].parameters);
});

test('CONTROL exact first SQL refusal permits corrected new intent',async()=>{
  const h=await harness();h.write(refusal);await h.submit();assert.match(h.get('loyaltyRedeemError').textContent,/Недостаточно бонусов/);
  h.get('loyaltyRedeemPoints').value='200';await h.submit();assert.notEqual(h.calls[1].parameters.p_request_id,h.calls[0].parameters.p_request_id);
  assert.equal(h.calls[1].parameters.p_points,200);
});
test('RECOVERY exact refusal after unknown does not resolve a prior committed request',async()=>{
  const h=await unknown();h.write(refusal);await h.submit();assert.match(h.get('loyaltyRedeemError').textContent,/Не удалось подтвердить/);
  await h.submit();assert.deepEqual(h.calls[2].parameters,h.calls[0].parameters);assert.equal(h.server.redemptions.length,1);
});

for(const reject of [false,true])test(`RECOVERY workspace ${reject?'throw':'error'} retains choices/key and supports read-only retry`,async()=>{
  const h=await harness();await h.choose(CLIENT,NEXT_BOOKING);h.lose();
  h.read(()=>{if(reject)throw Error('read failed');return {data:null,error:{message:'read failed'}};});await h.submit();
  assert.equal(h.controller.availability,'error');assert.equal(h.calls.length,1);
  await h.controller.load();assert.equal(h.controller.availability,'ready');assert.equal(h.calls.length,1);
  assert.equal(h.get('loyaltyRedeemBooking').value,NEXT_BOOKING);assert.equal(h.get('loyaltyRedeemPoints').value,'100');
  await h.submit();assert.deepEqual(h.calls[1].parameters,h.calls[0].parameters);
});

test('RECOVERY pending input/change and direct duplicate submit remain single-flight',async()=>{
  const h=await harness(),d=deferred();h.write(()=>d.promise);const first=h.submit();
  h.get('loyaltyRedeemPoints').value='200';await h.input('loyaltyRedeemPoints');await h.change('loyaltyRedeemPoints');await h.submit();
  assert.equal(h.calls.length,1);assert.equal(h.button.disabled,true);d.resolve({data:null,error:{message:'lost'}});await first;
  assert.equal(h.get('loyaltyRedeemPoints').value,'200');await h.restore();await h.submit();
  assert.deepEqual(h.calls[1].parameters,h.calls[0].parameters);
});

for(const outcome of ['success','error','throw'])for(const scope of ['organization','account','session'])test(`CONTEXT queued ${scope} switch suppresses late ${outcome} and loads latest scope`,async()=>{
  const h=await harness(),d=deferred(),nextOrg=id(30);h.write(()=>d.promise);const first=h.submit();
  if(scope!=='organization')h.actor(scope==='account'?id(40):ACTOR);
  await h.controller.setOrganization({id:nextOrg,current_role:'owner'});
  assert.equal(h.get('loyaltyWorkspace').hidden,true);
  if(outcome==='throw')d.reject(Error('transport'));else d.resolve(outcome==='success'?ack():refusal());await first;
  assert.equal(h.controller.payload.organization_id,nextOrg);assert.equal(h.controller.availability,'ready');assert.deepEqual(h.notices,[]);
  assert.equal(h.get('loyaltyRedeemError').hidden,true);assert.equal(h.button.disabled,false);
});

test('CONTEXT A → B → A pending loads only the latest organization',async()=>{
  const h=await harness(),d=deferred();h.write(()=>d.promise);const first=h.submit();
  await h.controller.setOrganization({id:id(30),current_role:'owner'});await h.controller.setOrganization({id:ORG,current_role:'owner'});
  d.resolve({data:null,error:{message:'lost'}});await first;
  assert.equal(h.controller.payload.organization_id,ORG);assert.equal(h.reads.some(p=>p.p_organization===id(30)),false);
  assert.match(h.get('loyaltyRedeemError').textContent,/Не удалось подтвердить/);
});

for(const outcome of ['success','error','throw'])test(`CONTEXT reset then independent B pending: late A ${outcome} cannot release B busy`,async()=>{
  const h=await harness(),a=deferred(),b=deferred(),orgB=id(30);h.write(()=>a.promise);const old=h.submit();
  h.controller.reset();h.actor(id(40));await h.controller.setOrganization({id:orgB,current_role:'owner'});
  h.get('loyaltyRedeemPoints').value='100';h.write(()=>b.promise);const current=h.submit();
  if(outcome==='throw')a.reject(Error('old'));else a.resolve(outcome==='success'?ack():refusal());await old;
  assert.equal(h.button.disabled,true);assert.equal(h.button.textContent,'Сохраняем…');await h.submit();assert.equal(h.calls.length,2);
  b.resolve(ack(orgB));await current;assert.deepEqual(h.notices,['Бонусы списаны']);
});

test('CONTEXT queued workspace throw recovers by read without another mutation',async()=>{
  const h=await harness(),d=deferred(),orgB=id(30);h.write(()=>d.promise);const old=h.submit();
  await h.controller.setOrganization({id:orgB,current_role:'owner'});h.read(()=>{throw Error('workspace');});d.resolve(refusal());await old;
  assert.equal(h.controller.availability,'error');await h.controller.load();assert.equal(h.controller.payload.organization_id,orgB);assert.equal(h.calls.length,1);
});
test('CONTEXT stale queued B read failure cannot repaint C',async()=>{
  const h=await harness(),d=deferred(),read=deferred(),orgC=id(31);h.write(()=>d.promise);const old=h.submit();
  await h.controller.setOrganization({id:id(30),current_role:'owner'});h.read(()=>read.promise);d.resolve(refusal());await tick();
  await h.controller.setOrganization({id:orgC,current_role:'owner'});read.reject(Error('old read'));await old;
  assert.equal(h.controller.availability,'ready');assert.equal(h.controller.payload.organization_id,orgC);assert.equal(h.get('loyaltyUnavailable').hidden,true);
});

for(const scope of ['organization','account'])test(`CONTEXT unknown warning/blank draft restores only in original ${scope}`,async()=>{
  const h=await unknown();h.get('loyaltyRedeemPoints').value='';await h.input('loyaltyRedeemPoints');
  if(scope==='account')h.actor(id(40));await h.controller.setOrganization({id:id(30),current_role:'owner'});
  assert.equal(h.get('loyaltyRedeemError').hidden,true);h.get('loyaltyRedeemPoints').value='100';h.write(()=>ack(id(30)));await h.submit();
  if(scope==='account')h.actor(ACTOR);await h.controller.setOrganization({id:ORG,current_role:'owner'});
  assert.equal(h.get('loyaltyRedeemPoints').value,'');assert.match(h.get('loyaltyRedeemError').textContent,/Не удалось подтвердить/);
  await h.restore();assert.equal(h.calls.length,2);await h.submit();assert.deepEqual(h.calls[2].parameters,h.calls[0].parameters);
});

test('BOUNDARY full new controller has no durable unknown request registry',async()=>{
  const first=await unknown(),second=await harness();await second.submit();
  assert.notEqual(second.calls[0].parameters.p_request_id,first.calls[0].parameters.p_request_id);
  // Separate model here proves only lost controller memory, not a second debit
  // on the same SQL booking (which v81 independently forbids).
});

test('RECOVERY edits during a pending read are captured at actual render, not overwritten by an earlier draft',async()=>{
  const h=await unknown(),read=deferred();h.read(()=>read.promise);const loading=h.controller.load();
  h.get('loyaltyRedeemPoints').value='200';await h.input('loyaltyRedeemPoints');read.resolve({data:h.server.workspace(),error:null});await loading;
  assert.equal(h.get('loyaltyRedeemPoints').value,'200');await h.restore();assert.equal(h.get('loyaltyRedeemPoints').value,'100');assert.equal(h.calls.length,1);
});
test('RECOVERY missing original visit remains blank and cannot silently target the first available visit',async()=>{
  const h=await unknown();h.read(()=>{const data=h.server.workspace();data.bookings=data.bookings.filter(row=>row.id!==BOOKING);return {data,error:null};});
  await h.controller.load();assert.equal(h.get('loyaltyRedeemBooking').value,'');await h.restore();
  assert.equal(h.get('loyaltyRedeemBooking').value,'');assert.match(h.get('loyaltyRedeemError').textContent,/недоступен/);
  await h.submit();assert.equal(h.calls.length,1);assert.equal(h.server.redemptions.length,1);
});
test('RECOVERY no-op client event preserves the non-first eligible visit and key',async()=>{
  const h=await harness();await h.choose(CLIENT,NEXT_BOOKING);h.lose();await h.submit();await h.change('loyaltyRedeemClient');await h.submit();
  assert.deepEqual(h.calls[1].parameters,h.calls[0].parameters);
});
for(const outcome of ['success','error','throw'])test(`CONTEXT queued logout ${outcome} keeps workspace hidden and no late notification`,async()=>{
  const h=await harness(),d=deferred();h.write(()=>d.promise);const pending=h.submit();h.actor(null);await h.controller.setOrganization(null);
  if(outcome==='throw')d.reject(Error('offline'));else d.resolve(outcome==='success'?ack():refusal());await pending;
  assert.equal(h.get('loyaltyWorkspace').hidden,true);assert.equal(h.get('loyaltyPanel').hidden,true);assert.equal(h.controller.payload,null);assert.deepEqual(h.notices,[]);
});
test('CONTEXT queued revoked role cannot expose or submit old organization',async()=>{
  const h=await harness(),d=deferred();h.write(()=>d.promise);const pending=h.submit();await h.controller.setOrganization({id:ORG,current_role:'specialist'});
  d.resolve(ack());await pending;await h.submit();assert.equal(h.calls.length,1);assert.equal(h.controller.payload,null);assert.deepEqual(h.notices,[]);
});
