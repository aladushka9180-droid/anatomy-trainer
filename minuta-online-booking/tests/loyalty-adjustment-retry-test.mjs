import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

// Full actual controller and its bound event handlers; synthetic DOM and ledger.
// No PostgreSQL, Supabase, server concurrency or native-browser claim.
// v81:273-294 keys replay by (organization_id, request_id), compares client,
// integer delta and trimmed reason, and returns the ORIGINAL balance_after.
// Equal amounts with different keys are intentionally distinct operations.
const source = readFileSync(process.env.MINUTA_LOYALTY_SOURCE || new URL('../loyalty-management.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../provider.html', import.meta.url), 'utf8');
const ORG = '11111111-1111-4111-8111-111111111111';
const CLIENT = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const ACCOUNT = '44444444-4444-4444-8444-444444444444';
const OTHER_ACCOUNT = '55555555-5555-4555-8555-555555555555';
const REASON = 'Корректировка по обращению клиента';
const copy = value => JSON.parse(JSON.stringify(value));

function ledgerModel() {
  const rows = [], balances = new Map();
  function apply(args) {
    const error = (code, message) => ({ data:null, error:{code,message} });
    const reason = String(args.p_reason || '').trim();
    if (!args.p_request_id || !Number.isInteger(args.p_points_delta) || !args.p_points_delta || Math.abs(args.p_points_delta) > 1000000 || reason.length < 8 || reason.length > 500) return error('22023','invalid_loyalty_adjustment');
    if (![CLIENT,OTHER].includes(args.p_client_account)) return error('42501','loyalty_client_not_in_organization');
    const old = rows.find(row => row.organization_id === args.p_organization && row.request_id === args.p_request_id);
    if (old) {
      if (old.client_account_id !== args.p_client_account || old.points_delta !== args.p_points_delta || old.reason !== reason) return error('23505','loyalty_request_conflict');
      return { data:{organization_id:old.organization_id,account_id:old.account_id,balance_points:old.balance_after}, error:null };
    }
    const key = `${args.p_organization}:${args.p_client_account}`;
    const balance = (balances.get(key) || 0) + args.p_points_delta;
    if (balance < 0) return error('55000','insufficient_loyalty_balance');
    balances.set(key,balance);
    const row = {organization_id:args.p_organization,account_id:args.p_client_account===CLIENT?ACCOUNT:OTHER_ACCOUNT,client_account_id:args.p_client_account,
      event_type:'manual_adjustment',points_delta:args.p_points_delta,balance_after:balance,request_id:args.p_request_id,reason};
    rows.push(row);
    return {data:{organization_id:row.organization_id,account_id:row.account_id,balance_points:balance},error:null};
  }
  return {rows,balances,apply};
}

function fixture(sharedLedger) {
  const elements = new Map(), handlers = new Map(), calls = [], notices = [], ledger = sharedLedger || ledgerModel();
  for (const [,id] of html.matchAll(/id="((?:loyalty|reloadLoyalty)[^"]*)"/g)) {
    const element = {id,value:'',checked:false,disabled:false,hidden:false,dataset:{},textContent:'',form:null,
      querySelector:selector => selector === '.form-error' ? elements.get('loyaltyAdjustmentError') : null,
      querySelectorAll:() => [],closest:selector => selector === '#loyaltyPanel' ? elements.get('loyaltyPanel')
        : selector === '#loyaltyAdjustmentForm' && (id === 'loyaltyAdjustmentForm' || element.form?.id === 'loyaltyAdjustmentForm') ? elements.get('loyaltyAdjustmentForm') : null};
    let innerHTML = '', textContent = '';
    Object.defineProperty(element,'textContent',{get:()=>textContent,set:value=>{textContent=String(value);innerHTML='';}});
    Object.defineProperty(element,'innerHTML',{get:()=>innerHTML,set:value=>{
      innerHTML=String(value);textContent=innerHTML.replace(/<[^>]*>/g,'');
      // Native select replacement selects the first option, not the old identity.
      if (/Client$|Booking$/.test(id)) element.value=innerHTML.match(/<option value="([^"]*)"/)?.[1] || '';
    }});
    elements.set(id,element);
  }
  const get = id => { assert.ok(elements.has(id),`Unknown fixture DOM id ${id}`); return elements.get(id); };
  const form = get('loyaltyAdjustmentForm');
  const fields = ['loyaltyAdjustmentClient','loyaltyAdjustmentPoints','loyaltyAdjustmentReason'];
  for (const id of fields) get(id).form=form;
  form.reset=()=>{get('loyaltyAdjustmentPoints').value='';get('loyaltyAdjustmentReason').value='';get('loyaltyAdjustmentClient').value=CLIENT;};
  const button = {textContent:'Скорректировать',disabled:false,dataset:{}};
  form.querySelector=selector=>selector==='button[type="submit"]'?button:selector==='.form-error'?get('loyaltyAdjustmentError'):null;
  get('loyaltyPanel').querySelectorAll=selector=>selector==='[data-loyalty-write]'?[button]:[];
  let loseNextReply=false, nextDelivery=null, failNextRead=false, nextRead=null, currentUser='owner-A', generation=1;
  const workspace = org => ({organization_id:org,current_role:'owner',enabled:true,rule:{earn_rate_bps:500,min_paid_amount_rub:0},max_redeem_percent_bps:3000,
    clients:[{id:CLIENT,client_name:'Клиент A',client_phone:'+79990000001'},{id:OTHER,client_name:'Клиент B',client_phone:'+79990000002'}],
    bookings:[],accounts:[...ledger.balances].filter(([key])=>key.startsWith(`${org}:`)).map(([key,balance_points])=>({client_account_id:key.split(':')[1],balance_points,lifetime_earned:balance_points,lifetime_spent:0})),
    promotions:[],promo_redemptions:[],ledger:copy(ledger.rows.filter(row=>row.organization_id===org))});
  const db={rpc:async(name,args)=>{
    calls.push({name,args:copy(args)});
    if(name==='get_minuta_loyalty_workspace') {
      if(failNextRead){failNextRead=false;throw Error('workspace transport failed');}
      if(nextRead){const operation=nextRead;nextRead=null;return new Promise((resolve,reject)=>{operation.resolve=resolve;operation.reject=reject;});}
      return {data:workspace(args.p_organization),error:null};
    }
    assert.equal(name,'adjust_minuta_loyalty_balance','No unrelated mutation is mocked');
    const delivery=nextDelivery;nextDelivery=null;
    const result=delivery?.before?delivery.reply:ledger.apply(copy(args));
    if(delivery?.deferred)return new Promise((resolve,reject)=>{delivery.resolve=resolve;delivery.reject=reject;delivery.result=result;});
    if(delivery?.throws)throw Error('adjustment transport rejected');
    if(delivery && 'reply' in delivery)return delivery.reply;
    if(loseNextReply && !result.error){loseNextReply=false;return {data:null,error:{code:'08006',message:'connection lost after commit'}};}
    return result;
  }};
  const document={addEventListener:(type,handler)=>{const list=handlers.get(type)||[];list.push(handler);handlers.set(type,list);}};
  const window={};
  runInNewContext(source,{window,document,crypto:{randomUUID},console});
  const controller=window.MinutaLoyalty.createController({db,$:selector=>get(selector.replace(/^#/,'')),escapeHtml:value=>String(value??''),
    notify:message=>notices.push(message),requireWrites:()=>true,getCurrentUser:()=>({id:currentUser}),getSessionGeneration:()=>generation,
    sessionIsCurrent:(user,version)=>user===currentUser&&version===generation,applyWriteAvailability(){}});
  controller.bind();
  async function dispatch(type,target,extra={}) {
    assert.ok(handlers.has(type),`Actual controller did not bind ${type}`);
    for(const handler of handlers.get(type))await handler({target,preventDefault(){},...extra});
  }
  const fill=({client=CLIENT,points='100',reason=REASON}={})=>{get(fields[0]).value=client;get(fields[1]).value=points;get(fields[2]).value=reason;};
  return {controller,get,ledger,calls,notices,fill,button,
    start:async()=>{await controller.setOrganization({id:ORG,current_role:'owner'});fill();},
    submit:()=>dispatch('submit',form,{submitter:button}),
    change:id=>dispatch('change',get(id)),input:id=>dispatch('input',get(id)),
    invalid:id=>dispatch('invalid',get(id)),
    restore:()=>dispatch('click',{closest:selector=>selector==='[data-loyalty-restore-adjustment]'?
      {closest:selector=>selector==='#loyaltyAdjustmentForm'?form:null}:null}),
    replyNext:(reply,before=false)=>{nextDelivery={reply,before};},throwNext:()=>{nextDelivery={throws:true};},
    defer:()=>{nextDelivery={deferred:true};return nextDelivery;},failRead:()=>{failNextRead=true;},
    deferRead:()=>{nextRead={};return nextRead;},
    switchOrg:org=>controller.setOrganization(org?{id:org,current_role:'owner'}:null),
    resetActor:async(user,org=ORG)=>{currentUser=user;generation++;controller.reset();await controller.setOrganization({id:org,current_role:'owner'});},
    loseReply:()=>{loseNextReply=true;},mutations:()=>calls.filter(call=>call.name==='adjust_minuta_loyalty_balance')};
}

async function uncertain() {
  const f=fixture();await f.start();f.loseReply();await f.submit();
  assert.equal(f.ledger.rows.length,1,'The synthetic server committed BEFORE losing the response');
  assert.equal(f.ledger.rows[0].balance_after,100);
  assert.equal(f.button.disabled,false,'Actual fulfilled-error recovery must make retry reachable');
  return f;
}

test('CONTROL unchanged retry replays the same v81 key and one committed adjustment',async()=>{
  const f=await uncertain();await f.submit();
  assert.equal(f.mutations().length,2);assert.deepEqual(f.mutations()[1].args,f.mutations()[0].args);
  assert.equal(f.ledger.rows.length,1);assert.equal(f.ledger.rows[0].balance_after,100);
});

for(const field of ['loyaltyAdjustmentClient','loyaltyAdjustmentPoints','loyaltyAdjustmentReason'])test(`SAFETY lost reply then no-op change on ${field} must not issue a fresh intent`,async()=>{
  const f=await uncertain();const original=copy(f.mutations()[0].args);
  await f.change(field);await f.submit();
  assert.equal(f.ledger.rows.length,1,'Unchanged retry must not apply the same adjustment twice');
  assert.equal(f.mutations()[1].args.p_request_id,original.p_request_id);
  assert.equal(f.ledger.balances.get(`${ORG}:${CLIENT}`),100);
});

test('SAFETY whitespace-only reason edit keeps the canonical tuple and original request key',async()=>{
  const f=await uncertain();f.get('loyaltyAdjustmentReason').value=`  ${REASON}  `;
  await f.input('loyaltyAdjustmentReason');await f.change('loyaltyAdjustmentReason');await f.submit();
  assert.equal(f.ledger.rows.length,1);assert.deepEqual(f.mutations()[1].args,f.mutations()[0].args);
});

test('SAFETY edit then revert before retry is the same unresolved operation',async()=>{
  const f=await uncertain();f.get('loyaltyAdjustmentPoints').value='200';await f.change('loyaltyAdjustmentPoints');
  f.get('loyaltyAdjustmentPoints').value='100';await f.change('loyaltyAdjustmentPoints');await f.submit();
  assert.equal(f.ledger.rows.length,1);assert.deepEqual(f.mutations()[1].args,f.mutations()[0].args);
});

for(const [field,value] of [['loyaltyAdjustmentPoints','200'],['loyaltyAdjustmentReason','Другая реальная причина'],['loyaltyAdjustmentClient',OTHER]])test(`SAFETY changed unresolved ${field} is not permission for a new adjustment`,async()=>{
  const f=await uncertain();f.get(field).value=value;await f.input(field);await f.change(field);await f.submit();
  assert.equal(f.ledger.rows.length,1,'An edit must not silently abandon an already committed unknown attempt');
  // Either block the changed attempt or reconcile the original snapshot; never mint a fresh key.
  for(const call of f.mutations().slice(1))assert.equal(call.args.p_request_id,f.mutations()[0].args.p_request_id);
});

for(const changedReason of [false,true])test(`CONTROL confirmed adjustment then explicit new ${changedReason?'different-reason':'identical-value'} operation uses a distinct request key`,async()=>{
  const f=fixture();await f.start();await f.submit();
  assert.equal(f.get('loyaltyAdjustmentPoints').value,'','Confirmed success resets the actual form');
  f.fill({reason:changedReason?'Отдельная новая корректировка':REASON});await f.input('loyaltyAdjustmentPoints');await f.change('loyaltyAdjustmentPoints');await f.submit();
  assert.equal(f.ledger.rows.length,2);assert.notEqual(f.mutations()[0].args.p_request_id,f.mutations()[1].args.p_request_id);
  assert.equal(f.ledger.balances.get(`${ORG}:${CLIENT}`),200,'Do not dedupe distinct operations by equal amount');
});

test('MODEL CONTROL v81 compares the complete replay tuple, not amount alone',()=>{
  const ledger=ledgerModel();const args={p_organization:ORG,p_client_account:CLIENT,p_points_delta:100,p_reason:REASON,p_request_id:randomUUID()};
  const first=ledger.apply(args);assert.equal(first.error,null);
  ledger.apply({...args,p_request_id:randomUUID()});
  assert.deepEqual(ledger.apply(args),first,'Replay returns historical balance_after, not current account balance');
  for(const delta of [{p_client_account:OTHER},{p_points_delta:200},{p_reason:'Совсем другая причина'}])assert.deepEqual(ledger.apply({...args,...delta}).error,{code:'23505',message:'loyalty_request_conflict'});
  assert.equal(ledger.rows.length,2);assert.equal(ledger.balances.get(`${ORG}:${CLIENT}`),200);
});

for(const kind of ['throw','null','partial','wrong-org','bad-account','negative-balance'])test(`unknown ${kind} keeps snapshot/key and reloads actual ledger`,async()=>{
  const f=fixture();await f.start();
  if(kind==='throw')f.throwNext();
  else f.replyNext({data:kind==='null'?null:kind==='partial'?{organization_id:ORG}:
    {organization_id:kind==='wrong-org'?OTHER:ORG,account_id:kind==='bad-account'?'bad-id':ACCOUNT,balance_points:kind==='negative-balance'?-1:100},error:null});
  await f.submit();const original=copy(f.mutations()[0].args);
  assert.equal(f.ledger.rows.length,1);assert.equal(f.controller.payload.ledger.length,1);
  assert.equal(f.notices.length,0);assert.doesNotMatch(f.get('loyaltyAdjustmentError').textContent,/не сохранено/i);
  await f.submit();assert.deepEqual(f.mutations()[1].args,original);assert.equal(f.ledger.rows.length,1);
  assert.deepEqual(f.notices,['Баланс скорректирован']);
});

test('changed unknown payload restores original fields without RPC, then explicit replay resolves it',async()=>{
  const f=await uncertain();f.fill({client:OTHER,points:'200',reason:'Другая корректировка'});await f.submit();
  assert.equal(f.mutations().length,1);assert.equal(f.get('loyaltyAdjustmentClient').value,CLIENT);
  assert.equal(f.get('loyaltyAdjustmentPoints').value,'100');assert.equal(f.get('loyaltyAdjustmentReason').value,REASON);
  assert.match(f.get('loyaltyAdjustmentError').textContent,/исходн/i);
  await f.submit();assert.deepEqual(f.mutations()[1].args,f.mutations()[0].args);assert.equal(f.ledger.rows.length,1);
});

test('initial exact refusal permits corrected new intent; refusal after unknown does not',async()=>{
  const f=fixture();await f.start();
  f.replyNext({data:null,error:{code:'22023',message:'invalid_loyalty_adjustment'}},true);await f.submit();
  assert.equal(f.ledger.rows.length,0);const refusedKey=f.mutations()[0].args.p_request_id;
  f.loseReply();await f.submit();assert.notEqual(f.mutations()[1].args.p_request_id,refusedKey);
  const unknown=copy(f.mutations()[1].args);
  f.replyNext({data:null,error:{code:'55000',message:'loyalty_disabled'}},true);await f.submit();
  assert.deepEqual(f.mutations()[2].args,unknown);assert.equal(f.get('loyaltyAdjustmentForm').dataset.adjustmentState,'unknown');
  f.fill({points:'200'});await f.submit();assert.equal(f.mutations().length,3);
  await f.submit();assert.deepEqual(f.mutations()[3].args,unknown);assert.equal(f.ledger.rows.length,1);
});

for(const reply of [
  {data:null,error:{code:'08006',message:'invalid_loyalty_adjustment'}},
  {data:null,error:{message:'insufficient_loyalty_balance'}},
  {data:null,error:{code:'23505',message:'loyalty_request_conflict'}}
])test(`unproven ${reply.error.code||'no-code'} refusal cannot mint another key`,async()=>{
  const f=fixture();await f.start();f.replyNext(reply);await f.submit();await f.submit();
  assert.deepEqual(f.mutations()[1].args,f.mutations()[0].args);assert.equal(f.ledger.rows.length,1);
});

test('read-only reload and failed read retry preserve selected non-first client and edited unresolved fields',async()=>{
  const f=fixture();await f.start();f.fill({client:OTHER});f.loseReply();f.failRead();await f.submit();
  assert.equal(f.controller.availability,'error');assert.equal(f.get('loyaltyLoading').hidden,true);
  assert.equal(f.get('loyaltyAdjustmentClient').value,OTHER);
  f.get('loyaltyAdjustmentReason').value='Редактируемый черновик';await f.input('loyaltyAdjustmentReason');
  await f.controller.load();assert.equal(f.get('loyaltyAdjustmentClient').value,OTHER);
  assert.equal(f.get('loyaltyAdjustmentReason').value,'Редактируемый черновик');
  assert.equal(f.controller.payload.ledger.length,1);
  await f.submit();assert.equal(f.mutations().length,1);assert.equal(f.get('loyaltyAdjustmentReason').value,REASON);
  await f.submit();assert.deepEqual(f.mutations()[1].args,f.mutations()[0].args);assert.equal(f.ledger.rows.length,1);
});

test('pending input and duplicate direct submit cannot send changed params or unlock button',async()=>{
  const f=fixture();await f.start();const op=f.defer(),pending=f.submit();
  const original=copy(f.mutations()[0].args);f.fill({points:'200'});await f.input('loyaltyAdjustmentPoints');await f.change('loyaltyAdjustmentPoints');
  await f.controller.load();await f.submit();assert.equal(f.mutations().length,1);assert.equal(f.button.disabled,true);
  op.resolve({data:null,error:{code:'08006',message:'lost'}});await pending;
  await f.submit();assert.equal(f.mutations().length,1);await f.submit();
  assert.deepEqual(f.mutations()[1].args,original);assert.equal(f.ledger.rows.length,1);
});

for(const outcome of ['success','error','throw'])test(`queued org switch drains after ${outcome}, preserving unknown A key`,async()=>{
  const f=fixture();await f.start();const op=f.defer(),pending=f.submit();await f.switchOrg(OTHER);
  if(outcome==='throw')op.reject(Error('transport'));else op.resolve(outcome==='success'?op.result:{data:null,error:{code:'08006',message:'lost'}});
  await pending;assert.equal(f.controller.payload.organization_id,OTHER);assert.equal(f.notices.length,0);
  f.fill();await f.submit();assert.equal(f.ledger.rows.filter(row=>row.organization_id===OTHER).length,1);
  await f.switchOrg(ORG);f.fill();await f.submit();
  if(outcome!=='success'){assert.deepEqual(f.mutations()[2].args,f.mutations()[0].args);assert.equal(f.ledger.rows.filter(row=>row.organization_id===ORG).length,1);}
});

for(const outcome of ['success','error','throw'])test(`reset to independent pending actor B suppresses late A ${outcome} UI and busy effects`,async()=>{
  const f=fixture();await f.start();const a=f.defer(),pendingA=f.submit();await f.resetActor('owner-B');f.fill();
  const b=f.defer(),pendingB=f.submit(),label=f.button.textContent;
  if(outcome==='throw')a.reject(Error('transport'));else a.resolve(outcome==='success'?a.result:{data:null,error:{code:'08006',message:'lost'}});
  await pendingA;assert.equal(f.button.textContent,label);assert.equal(f.button.disabled,true);assert.equal(f.notices.length,0);
  b.resolve(b.result);await pendingB;assert.equal(f.button.disabled,false);assert.equal(f.ledger.rows.length,2);
});

test('same actor reset retains unknown intent and exact key without guessing from ledger',async()=>{
  const f=await uncertain();const original=copy(f.mutations()[0].args);await f.resetActor('owner-A');
  await f.submit();assert.deepEqual(f.mutations()[1].args,original);assert.equal(f.ledger.rows.length,1);
});

test('queued workspace throw permits read retry and late read rejection cannot overwrite newer org',async()=>{
  const f=fixture();await f.start();const op=f.defer(),pending=f.submit();await f.switchOrg(OTHER);f.failRead();
  op.resolve({data:null,error:{code:'08006',message:'lost'}});await pending;
  assert.equal(f.controller.availability,'error');await f.controller.load();assert.equal(f.controller.payload.organization_id,OTHER);
  const read=f.deferRead(),loading=f.controller.load();await f.switchOrg(ORG);
  const before=copy(f.controller.payload);read.reject(Error('late workspace reject'));await loading;
  assert.deepEqual(copy(f.controller.payload),before);assert.equal(f.controller.availability,'ready');
});

test('BOUNDARY a new controller has no persistent request registry; no cross-reload dedupe claim',async()=>{
  const first=await uncertain(),next=fixture(first.ledger);await next.start();await next.submit();
  assert.notEqual(next.mutations()[0].args.p_request_id,first.mutations()[0].args.p_request_id);
  assert.equal(next.ledger.rows.length,2,'Characterization of unimplemented full-page recovery, not a safety acceptance claim');
});

test('unknown warning belongs to its actor/org and returns with the unresolved intent',async()=>{
  const f=await uncertain();await f.switchOrg(OTHER);
  assert.equal(f.get('loyaltyAdjustmentError').hidden,true);assert.equal(f.get('loyaltyAdjustmentError').textContent,'');
  f.fill();await f.submit();await f.switchOrg(ORG);
  assert.equal(f.get('loyaltyAdjustmentError').hidden,false);
  assert.match(f.get('loyaltyAdjustmentError').textContent,/подтвердить результат/);
  assert.equal(f.get('loyaltyAdjustmentForm').dataset.adjustmentState,'unknown');
  await f.submit();assert.deepEqual(f.mutations()[2].args,f.mutations()[0].args);assert.equal(f.ledger.rows.length,2);
});

test('same-actor session reset while pending cannot start a second request; read restores settled unknown for retry',async()=>{
  const f=fixture();await f.start();const op=f.defer(),pending=f.submit();await f.resetActor('owner-A');
  await f.submit();assert.equal(f.mutations().length,1);assert.equal(f.button.disabled,true);
  op.reject(Error('lost on disposed session'));await pending;
  assert.equal(f.notices.length,0);await f.controller.load();await f.submit();
  assert.deepEqual(f.mutations()[1].args,f.mutations()[0].args);assert.equal(f.ledger.rows.length,1);
});

test('v81 maximum balance ACK 10000000 is accepted',async()=>{
  const f=fixture();await f.start();f.ledger.balances.set(`${ORG}:${CLIENT}`,9999900);await f.submit();
  assert.equal(f.ledger.rows[0].balance_after,10000000);assert.deepEqual(f.notices,['Баланс скорректирован']);
  assert.equal(f.get('loyaltyAdjustmentPoints').value,'');
});

test('impossible v81 balance ACK 10000001 remains unknown and replays the same key',async()=>{
  const f=fixture();await f.start();
  f.replyNext({data:{organization_id:ORG,account_id:ACCOUNT,balance_points:10000001},error:null});await f.submit();
  assert.equal(f.notices.length,0);assert.equal(f.get('loyaltyAdjustmentForm').dataset.adjustmentState,'unknown');
  await f.submit();assert.deepEqual(f.mutations()[1].args,f.mutations()[0].args);assert.equal(f.ledger.rows.length,1);
});

for(const field of ['loyaltyAdjustmentReason','loyaltyAdjustmentPoints'])test(`restore control survives blank required ${field} and invalid event, without submitting`,async()=>{
  const f=await uncertain(),original=copy(f.mutations()[0].args);f.get(field).value='';await f.input(field);await f.invalid(field);
  // This VM dispatches actual invalid/click handlers; native required validation
  // itself belongs to the separate browser suite, not this VM assertion.
  const error=f.get('loyaltyAdjustmentError');assert.equal(error.hidden,false);
  assert.match(error.innerHTML,/<button\b[^>]*type="button"[^>]*data-loyalty-restore-adjustment/);
  const before=f.calls.length;await f.restore();assert.equal(f.calls.length,before,'Restore performs zero RPC, including reads');
  assert.equal(f.get('loyaltyAdjustmentReason').value,REASON);assert.equal(f.get('loyaltyAdjustmentPoints').value,'100');
  await f.submit();assert.deepEqual(f.mutations()[1].args,original);assert.equal(f.ledger.rows.length,1);
});

test('blank unknown draft roundtrip restores a visible scoped action, not actor B fields',async()=>{
  const f=await uncertain(),original=copy(f.mutations()[0].args);f.get('loyaltyAdjustmentReason').value='';await f.input('loyaltyAdjustmentReason');
  await f.resetActor('owner-B');f.fill({reason:'Своя причина клиента B'});const before=f.calls.length;await f.restore();
  assert.equal(f.calls.length,before);assert.equal(f.get('loyaltyAdjustmentReason').value,'Своя причина клиента B');
  await f.submit();await f.resetActor('owner-A');
  assert.equal(f.get('loyaltyAdjustmentReason').value,'');assert.equal(f.get('loyaltyAdjustmentError').hidden,false);
  assert.match(f.get('loyaltyAdjustmentError').innerHTML,/data-loyalty-restore-adjustment/);
  await f.restore();assert.equal(f.get('loyaltyAdjustmentReason').value,REASON);await f.submit();
  assert.deepEqual(f.mutations()[2].args,original);assert.equal(f.ledger.rows.length,2);
});

test('restore click cannot modify fields while the original request is pending',async()=>{
  const f=await uncertain(),op=f.defer(),pending=f.submit();f.get('loyaltyAdjustmentReason').value='Изменённый черновик пока ждём';
  const before=f.calls.length;await f.restore();assert.equal(f.calls.length,before);
  assert.equal(f.get('loyaltyAdjustmentReason').value,'Изменённый черновик пока ждём');
  op.resolve(op.result);await pending;assert.equal(f.ledger.rows.length,1);
});
