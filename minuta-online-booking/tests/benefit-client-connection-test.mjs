import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import test from 'node:test';

const source=readFileSync(new URL('../benefit-management.js',import.meta.url),'utf8');
const booking='11111111-1111-4111-8111-111111111111';
const request='22222222-2222-4222-8222-222222222222';
async function fixture({storage=new Map(),grant,rows,read,role='owner',writes=true}={}) {
  const elements=new Map(),handlers=new Map(),calls=[],reads=[],notices=[];
  let actor='actor-a',generation=1,org='org-a',account=null;
  const $=selector=>{
    if(!elements.has(selector)){
      const field={id:selector.replace(/^#/,''),value:'',textContent:'',hidden:false,disabled:false,dataset:{},
        before(){},querySelectorAll:()=>[],closest:s=>s==='#benefitsPanel'?field:null,
        querySelector:s=>s==='button[type="submit"]'?$('#'+field.id+'Submit'):null,
        get options(){return [...(field.innerHTML||'').matchAll(/<option value="([^"]*)"/g)].map(m=>({value:m[1]}));}};
      elements.set(selector,field);
    }return elements.get(selector);
  };
  const record=()=>({id:booking,organization_id:org,status:'confirmed',payment_status:'not_required',client_account_id:account,
    client_name:'Тестовый клиент',client_phone:'+70000000000',booking_date:'2026-09-22',booking_time:'12:00:00'});
  const context={crypto:{randomUUID:()=>request},window:{localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}},
    document:{createElement(){},getElementById:()=>({}),addEventListener:(name,fn)=>handlers.set(name,fn)}};
  runInNewContext(source,context);
  const db={rpc:async(name,args)=>{
    if(name==='get_minuta_benefit_workspace')return {data:{organization_id:args.p_organization,current_role:role,enabled:true,
      products:[],services:[],clients:account?[{id:account,client_name:'Тестовый клиент'}]:[],bookings:[],instruments:[],redemptions:[],audit:[]},error:null};
    assert.equal(name,'issue_client_identity_claim_grant_v155');
    const durable=JSON.parse(storage.get(`minuta_benefit_client_connection_v1:${actor}:${args.p_organization}`));
    assert.equal(durable.request_id,args.p_request_id);
    assert.equal(durable.may_have_dispatched,true,'dispatch uncertainty must be durable before RPC');
    calls.push(structuredClone(args));
    if(grant)return grant({args,setAccount:id=>{account=id;},switchActor(){actor='actor-b';generation++;}});
    account='account-a';return {data:[{claim_token:'SECRET-MUST-NOT-ESCAPE',claim_expires_at:'2026-10-02T00:00:00Z'}],error:null};
  },from:name=>{
    assert.equal(name,'bookings');const filters=[];
    const q={select:()=>q,eq:(key,value)=>{filters.push([key,value]);return q;},is:(k,v)=>{filters.push([k,v]);return q;},
      neq:(k,v)=>{filters.push(['neq:'+k,v]);return q;},or:v=>{filters.push(['or',v]);return q;},order:()=>q,
      limit:async count=>{reads.push({filters,count});return {data:rows||[record()],error:null};},
      maybeSingle:async()=>{reads.push({filters});return read?read(record()):{data:record(),error:null};}};
    return q;
  }};
  const controller=context.window.MinutaBenefits.createController({db,$,escapeHtml:v=>String(v??''),notify:m=>notices.push(m),requireWrites:()=>writes,
    getCurrentUser:()=>({id:actor}),getSessionGeneration:()=>generation,sessionIsCurrent:(a,g)=>a===actor&&g===generation,applyWriteAvailability(){}});
  controller.bind();await controller.setOrganization({id:org,current_role:role});
  return {$,controller,calls,reads,notices,storage,
    async refresh(){await handlers.get('click')({target:{closest:s=>s==='#benefitClientConnectionRefresh'?{}:null}});},
    async submit(){await handlers.get('submit')({target:$('#benefitClientConnectionForm'),preventDefault(){}});},
    select(){ $('#benefitClientConnectionBooking').value=booking;},
    setAccount:id=>{account=id;},
    async switchOrg(){org='org-b';await controller.setOrganization({id:org,current_role:role});},
  };
}

test('enrolment uses staff RPC with durable IDs, scoped reads and no escaping claim secret',async()=>{
  const ui=await fixture();await ui.refresh();ui.select();await ui.submit();
  assert.deepEqual(ui.calls,[{p_organization:'org-a',p_booking:booking,p_request_id:request,p_expires_minutes:10}]);
  assert.ok(ui.reads.every(r=>r.filters.some(([k,v])=>k==='organization_id'&&v==='org-a')));
  assert.equal(ui.controller.payload.clients.length,1);assert.equal(ui.storage.size,0);
  assert.match(ui.notices.at(-1),/Клиент подключён/);
  assert.ok([...ui.$('#benefitClientConnectionStatus').textContent,...ui.notices].join('').indexOf('SECRET')<0);
});
test('lost success is verified from booking and never grants again after reload',async()=>{
  const ui=await fixture({grant:({setAccount})=>{setAccount('account-a');throw Error('lost response');}});
  await ui.refresh();ui.select();await ui.submit();
  // Exception keeps the durable request until its result can be verified.
  assert.equal(ui.storage.size,1);
  const reopened=await fixture({storage:ui.storage});reopened.setAccount('account-a');await reopened.submit();
  assert.equal(reopened.calls.length,0);assert.equal(reopened.storage.size,0);
});
test('unknown result preserves same request and booking across reload and attempted edits',async()=>{
  const first=await fixture({grant:()=>({data:null,error:{message:'unknown'}})});
  await first.refresh();first.select();await first.submit();
  const persisted=JSON.parse([...first.storage.values()][0]);
  assert.deepEqual(Object.keys(persisted).sort(),['actor_id','booking_id','may_have_dispatched','organization_id','request_id']);
  const next=await fixture({storage:first.storage});next.$('#benefitClientConnectionBooking').value='tampered';await next.submit();
  assert.deepEqual(next.calls,first.calls);assert.equal(next.storage.size,0);
});
test('foreign, cancelled and unpaid unconfirmed records cannot dispatch enrolment',async()=>{
  for(const read of [row=>({data:{...row,organization_id:'foreign'},error:null}),row=>({data:{...row,status:'cancelled'},error:null}),row=>({data:{...row,status:'pending',payment_status:'unpaid'},error:null})]) {
    const ui=await fixture({read});await ui.refresh();ui.select();await ui.submit();assert.equal(ui.calls.length,0);assert.equal(ui.notices.length,0);
  }
});
test('foreign list is rejected without selectable rows or a grant',async()=>{
  const ui=await fixture({rows:[{id:booking,organization_id:'foreign',status:'confirmed',client_phone:'+70000000000'}]});
  await ui.refresh();ui.select();await ui.submit();assert.equal(ui.calls.length,0);assert.match(ui.$('#benefitClientConnectionError').textContent,/Выберите/);
});
test('write denial, role denial and local storage failure dispatch nothing',async()=>{
  const disabled=await fixture({writes:false});await disabled.refresh();disabled.select();await disabled.submit();assert.equal(disabled.calls.length,0);
  const specialist=await fixture({role:'specialist'});await specialist.submit();assert.equal(specialist.calls.length,0);
  const storage=new Map();storage.set=()=>{throw Error('quota');};const ui=await fixture({storage});await ui.refresh();ui.select();await ui.submit();
  assert.equal(ui.calls.length,0);assert.match(ui.$('#benefitClientConnectionError').textContent,/не отправлено/);
});
test('actor change during RPC neither reports success nor deletes original intent',async()=>{
  const ui=await fixture({grant:({setAccount,switchActor})=>{setAccount('account-a');switchActor();return {data:null,error:null};}});
  await ui.refresh();ui.select();await ui.submit();assert.equal(ui.notices.length,0);assert.equal(ui.storage.size,1);
});
test('organization change cannot reuse another organization pending request',async()=>{
  const ui=await fixture({grant:()=>({data:null,error:{message:'unknown'}})});await ui.refresh();ui.select();await ui.submit();
  await ui.switchOrg();await ui.submit();assert.equal(ui.calls.length,1);assert.equal(ui.storage.size,1);
});
test('definitive denial retains the request because absence is not terminal proof',async()=>{
  const ui=await fixture({grant:()=>({data:null,error:{code:'42501',message:'client_claim_grant_denied'}})});
  await ui.refresh();ui.select();await ui.submit();assert.equal(ui.storage.size,1);
  assert.match(ui.$('#benefitClientConnectionError').textContent,/Нет прав/);
  assert.equal(ui.$('#benefitClientConnectionRefresh').disabled,true);
});
test('concurrent submits use one enrolment RPC',async()=>{
  let release;const waiting=new Promise(resolve=>{release=resolve;});
  const ui=await fixture({grant:async({setAccount})=>{await waiting;setAccount('account-a');return {data:null,error:null};}});
  await ui.refresh();ui.select();const pending=ui.submit();
  await new Promise(resolve=>setImmediate(resolve));await ui.submit();assert.equal(ui.calls.length,1);
  release();await pending;assert.equal(ui.storage.size,0);
});
for(const error of [{code:'42501',message:'client_claim_grant_denied'},
  {code:'PGRST202',message:'schema cache'},{code:'42883',message:'function does not exist'}]) {
  test(`unknown enrolment survives reload and ${error.code} refusal until original late commit is confirmed`,async()=>{
    const first=await fixture({grant:()=>({data:null,error:{message:'unknown; original transaction still pending'}})});
    await first.refresh();first.select();await first.submit();
    const original=structuredClone(first.calls[0]);
    const reopened=await fixture({storage:first.storage,grant:()=>({data:null,error})});
    reopened.$('#benefitClientConnectionBooking').value='different-booking';await reopened.submit();
    assert.deepEqual(reopened.calls,[original]);assert.equal(reopened.storage.size,1);
    assert.equal(reopened.$('#benefitClientConnectionRefresh').disabled,true);
    assert.equal(reopened.$('#benefitClientConnectionBooking').disabled,true);
    const stillPending=JSON.parse([...reopened.storage.values()][0]);
    assert.equal(stillPending.request_id,original.p_request_id);
    assert.equal(stillPending.booking_id,original.p_booking);
    assert.equal(stillPending.may_have_dispatched,true);
    // The original backend operation can finish after a newer refusal, whose
    // membership/function checks did not serialize on that original request.
    reopened.setAccount('account-late-original');await reopened.submit();
    assert.equal(reopened.calls.length,1);assert.equal(reopened.storage.size,0);
    assert.equal(reopened.controller.payload.clients[0].id,'account-late-original');
  });
}
test('legacy pending intent without dispatch marker remains uncertain after refusal',async()=>{
  const storage=new Map([['minuta_benefit_client_connection_v1:actor-a:org-a',JSON.stringify({
    actor_id:'actor-a',organization_id:'org-a',booking_id:booking,request_id:request})]]);
  const ui=await fixture({storage,grant:()=>({data:null,error:{code:'42501',message:'client_claim_grant_denied'}})});
  await ui.submit();assert.equal(ui.storage.size,1);
  const durable=JSON.parse([...storage.values()][0]);assert.equal(durable.request_id,request);assert.equal(durable.may_have_dispatched,true);
  assert.equal(ui.$('#benefitClientConnectionBooking').disabled,true);
  ui.setAccount('account-late-original');await ui.submit();assert.equal(ui.calls.length,1);assert.equal(storage.size,0);
});
test('cancelled booking cannot clear a restored unknown operation before late positive proof',async()=>{
  const first=await fixture({grant:()=>({data:null,error:{message:'unknown'}})});await first.refresh();first.select();await first.submit();
  const next=await fixture({storage:first.storage,read:row=>({data:{...row,status:'cancelled'},error:null})});
  await next.submit();assert.equal(next.calls.length,0);assert.equal(next.storage.size,1);
  assert.equal(next.$('#benefitClientConnectionRefresh').disabled,true);
  next.setAccount('account-late-original');await next.submit();assert.equal(next.calls.length,0);assert.equal(next.storage.size,0);
});
test('failure to persist dispatch marker sends no RPC and retains original request for recovery',async()=>{
  const storage=new Map(),originalSet=storage.set.bind(storage);let writes=0;
  storage.set=(key,value)=>{if(++writes===2)throw Error('quota during dispatch marker');return originalSet(key,value);};
  const ui=await fixture({storage});await ui.refresh();ui.select();await ui.submit();
  assert.equal(ui.calls.length,0);assert.equal(storage.size,1);
  const pending=JSON.parse([...storage.values()][0]);assert.equal(pending.request_id,request);assert.equal(pending.may_have_dispatched,false);
  await ui.submit();assert.equal(ui.calls.length,1);assert.equal(ui.calls[0].p_request_id,pending.request_id);assert.equal(storage.size,0);
});
