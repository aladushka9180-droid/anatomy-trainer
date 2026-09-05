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

function fixture() {
  const elements = new Map(), handlers = new Map(), calls = [], notices = [], ledger = ledgerModel();
  for (const [,id] of html.matchAll(/id="((?:loyalty|reloadLoyalty)[^"]*)"/g)) {
    const element = {id,value:'',checked:false,disabled:false,hidden:false,dataset:{},textContent:'',form:null,
      querySelector:selector => selector === '.form-error' ? elements.get('loyaltyAdjustmentError') : null,
      querySelectorAll:() => [],closest:selector => selector === '#loyaltyPanel' ? elements.get('loyaltyPanel')
        : selector === '#loyaltyAdjustmentForm' && (id === 'loyaltyAdjustmentForm' || element.form?.id === 'loyaltyAdjustmentForm') ? elements.get('loyaltyAdjustmentForm') : null};
    let innerHTML = '';
    Object.defineProperty(element,'innerHTML',{get:()=>innerHTML,set:value=>{
      innerHTML=String(value);
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
  get('loyaltyPanel').querySelectorAll=selector=>selector==='[data-loyalty-write]'?[button]:[];
  let loseNextReply=false;
  const workspace = () => ({organization_id:ORG,current_role:'owner',enabled:true,rule:{earn_rate_bps:500,min_paid_amount_rub:0},max_redeem_percent_bps:3000,
    clients:[{id:CLIENT,client_name:'Клиент A',client_phone:'+79990000001'},{id:OTHER,client_name:'Клиент B',client_phone:'+79990000002'}],
    bookings:[],accounts:[...ledger.balances].map(([key,balance_points])=>({client_account_id:key.split(':')[1],balance_points,lifetime_earned:balance_points,lifetime_spent:0})),
    promotions:[],promo_redemptions:[],ledger:copy(ledger.rows)});
  const db={rpc:async(name,args)=>{
    calls.push({name,args:copy(args)});
    if(name==='get_minuta_loyalty_workspace')return {data:workspace(),error:null};
    assert.equal(name,'adjust_minuta_loyalty_balance','No unrelated mutation is mocked');
    const result=ledger.apply(copy(args));
    if(loseNextReply && !result.error){loseNextReply=false;return {data:null,error:{code:'08006',message:'connection lost after commit'}};}
    return result;
  }};
  const document={addEventListener:(type,handler)=>{const list=handlers.get(type)||[];list.push(handler);handlers.set(type,list);}};
  const window={};
  runInNewContext(source,{window,document,crypto:{randomUUID},console});
  const controller=window.MinutaLoyalty.createController({db,$:selector=>get(selector.replace(/^#/,'')),escapeHtml:value=>String(value??''),
    notify:message=>notices.push(message),requireWrites:()=>true,getCurrentUser:()=>({id:'owner-A'}),getSessionGeneration:()=>1,
    sessionIsCurrent:(user,generation)=>user==='owner-A'&&generation===1,applyWriteAvailability(){}});
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
