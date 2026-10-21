import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../notification-center.js',import.meta.url),'utf8');
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
function workspace(id){return{organization_id:id,current_role:'owner',settings:{organization_id:id,enabled:false},channels:['provider','client'].map(audience=>({organization_id:id,audience,channel:'telegram',enabled:false})),endpoints:['provider','client'].map(audience=>({audience,subject_key:'synthetic-actor',channel:'telegram',active:true,configured:true})),outbox:[]};}
function fixture(){
  const nodes=new Map(),listeners=new Map(),calls=[],notes=[],server=new Map();
  const node=selector=>{
    if(!nodes.has(selector))nodes.set(selector,{hidden:false,checked:false,disabled:false,dataset:{},innerHTML:'',textContent:'',addEventListener(){},querySelectorAll(){return[];}});
    return nodes.get(selector);
  };
  const snapshot=id=>{if(!server.has(id))server.set(id,workspace(id));return JSON.parse(JSON.stringify(server.get(id)));};
  const window={MINUTA_CONFIG:{supabaseUrl:'https://synthetic.invalid',supabaseKey:'synthetic-public-value'},refreshSectionNavigation(){}};
  const forbidden=()=>{throw Error('FORBIDDEN_REAL_IO');};
  vm.runInNewContext(source,{window,document:{addEventListener:(name,fn)=>listeners.set(name,fn)},URL,
    fetch:async()=>({ok:true,json:async()=>({ok:true,configured_channels:['telegram']})}),WebSocket:forbidden,XMLHttpRequest:forbidden},{filename:'notification-center.js'});
  const controller=window.MinutaNotificationCenter.createController({
    db:{auth:{getUser:async()=>({data:{user:{id:'synthetic-actor'}}})},rpc(name,args){
      const call={name,args};calls.push(call);
      if(name==='get_minuta_notification_workspace')return Promise.resolve({data:snapshot(args.p_organization),error:null});
      assert(['set_minuta_notification_channel','set_minuta_notification_master'].includes(name));
      Object.assign(call,deferred());return call.promise;
    }},$:node,escapeHtml:value=>String(value??''),notify:value=>notes.push(value),requireWrites:()=>true
  });
  controller.bind();
  const writes=()=>calls.filter(x=>x.name.startsWith('set_'));
  const editMaster=value=>listeners.get('change')({target:{id:'unifiedNotificationsEnabled',checked:value}});
  const editChannel=(audience,value)=>listeners.get('change')({target:{id:'',checked:value,dataset:{unifiedAudience:audience,unifiedChannel:'telegram'},matches:selector=>selector==='[data-unified-channel]'}});
  const save=()=>listeners.get('click')({target:{closest:selector=>selector==='#saveUnifiedNotifications'?{}:null}});
  const acknowledge=call=>{
    const current=server.get(call.args.p_organization);
    if(call.name==='set_minuta_notification_master')current.settings.enabled=call.args.p_enabled;
    else current.channels.find(x=>x.audience===call.args.p_audience&&x.channel===call.args.p_channel).enabled=call.args.p_enabled;
    call.resolve({data:snapshot(call.args.p_organization),error:null});
  };
  return{controller,node,calls,notes,writes,editMaster,editChannel,save,acknowledge,snapshot};
}
async function ready({channels=true}={}){
  const f=fixture();await f.controller.setOrganization({id:'synthetic-org-a'});f.editMaster(true);
  if(channels){f.editChannel('provider',true);f.editChannel('client',true);}return f;
}
async function flush(){await Promise.resolve();await Promise.resolve();await Promise.resolve();}
async function finishWrites(f,operation){for(let index=0;index<f.writes().length;index++){assert(index<4);f.acknowledge(f.writes()[index]);await flush();}await operation;}
function watchedAck(f,call){
  let reads=0;
  return{response:{get error(){reads++;return null;},get data(){reads++;return f.snapshot(call.args.p_organization);}},reads:()=>reads};
}

test('ordinary two-channel and master save preserves the exact sequential RPC intent',async()=>{
  const f=await ready(),operation=f.save();assert.equal(f.writes().length,1);await finishWrites(f,operation);
  assert.deepEqual(f.writes().map(x=>[x.name,x.args.p_organization,x.args.p_audience??null,x.args.p_enabled]),[
    ['set_minuta_notification_channel','synthetic-org-a','provider',true],
    ['set_minuta_notification_channel','synthetic-org-a','client',true],
    ['set_minuta_notification_master','synthetic-org-a',null,true]
  ]);
  assert.deepEqual(f.notes,['Настройки доставки сохранены']);assert.equal(f.node('#saveUnifiedNotifications').disabled,true);
});

test('organization switch during the first channel RPC stops before ack and later writes',async()=>{
  const f=await ready(),operation=f.save(),first=f.writes()[0],ack=watchedAck(f,first);
  await f.controller.setOrganization({id:'synthetic-org-b'});first.resolve(ack.response);await finishWrites(f,operation);
  assert.equal(f.writes().length,1);assert.equal(ack.reads(),0);assert.deepEqual(f.notes,[]);
  assert.equal(f.node('#unifiedNotificationsEnabled').checked,false);
});

test('reset during the first channel RPC prevents later old-organization writes',async()=>{
  const f=await ready(),operation=f.save(),first=f.writes()[0];f.controller.reset();await finishWrites(f,operation);
  assert.equal(f.writes().length,1);assert.deepEqual(f.notes,[]);assert.equal(f.node('#unifiedNotificationPanel').hidden,true);
});

test('reset during the second channel RPC prevents the pending master write',async()=>{
  const f=await ready(),operation=f.save();f.acknowledge(f.writes()[0]);await flush();assert.equal(f.writes().length,2);
  f.controller.reset();f.acknowledge(f.writes()[1]);await flush();
  for(const call of f.writes().slice(2))f.acknowledge(call);await operation;
  assert.equal(f.writes().length,2);assert.deepEqual(f.notes,[]);
});

test('master-only stale acknowledgement is ignored before any response getters',async()=>{
  const f=await ready({channels:false}),operation=f.save(),first=f.writes()[0],ack=watchedAck(f,first);
  assert.equal(first.name,'set_minuta_notification_master');await f.controller.setOrganization({id:'synthetic-org-b'});
  first.resolve(ack.response);await operation;assert.equal(ack.reads(),0);assert.equal(f.writes().length,1);assert.deepEqual(f.notes,[]);
});

test('current rejected save reloads authoritative state and permits a later explicit save',async()=>{
  const f=await ready({channels:false}),first=f.save();f.writes()[0].reject(Error('SYNTHETIC_TRANSPORT_FAILURE'));await first;
  assert.deepEqual(f.notes,['Не удалось сохранить настройки доставки']);assert.equal(f.calls.filter(x=>x.name==='get_minuta_notification_workspace').length,2);
  assert.equal(f.node('#unifiedNotificationWorkspace').hidden,false);f.editMaster(true);const next=f.save();assert.equal(f.writes().length,2);f.acknowledge(f.writes()[1]);await next;
  assert.equal(f.notes.at(-1),'Настройки доставки сохранены');
});

test('current partial failure retains partial-save recovery and does not dispatch the master',async()=>{
  const f=await ready(),operation=f.save();f.acknowledge(f.writes()[0]);await flush();assert.equal(f.writes().length,2);
  f.writes()[1].resolve({data:null,error:{code:'SYNTHETIC_REFUSAL'}});await operation;
  assert.equal(f.writes().length,2);assert.deepEqual(f.notes,['Часть настроек не сохранена. Сверяем состояние.']);
  assert.equal(f.calls.filter(x=>x.name==='get_minuta_notification_workspace').length,2);assert.equal(f.node('#unifiedNotificationsEnabled').checked,false);
});

test('stale A rejection cannot release busy ownership of a pending B save',async()=>{
  const f=await ready(),old=f.save(),first=f.writes()[0];
  await f.controller.setOrganization({id:'synthetic-org-b'});f.editMaster(true);const next=f.save();
  assert.equal(f.writes().length,2);assert.equal(f.writes()[1].args.p_organization,'synthetic-org-b');
  first.reject(Error('SYNTHETIC_STALE_FAILURE'));await old;
  assert.equal(f.node('#saveUnifiedNotifications').disabled,true);await f.save();assert.equal(f.writes().length,2);
  f.acknowledge(f.writes()[1]);await next;assert.deepEqual(f.notes,['Настройки доставки сохранены']);
});
