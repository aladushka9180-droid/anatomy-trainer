import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// Real module/core Source in a VM. DOM, timers, storage and every bridge operation
// are explicit synthetic doubles; no browser, network, SQL or real send is used.
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourceRef = process.env.MESSAGES_CENTER_SOURCE_REF || '';
assert.ok(!sourceRef || /^[0-9a-f]{40}$/.test(sourceRef), 'invalid public Source ref');
const source = name => sourceRef
  ? execFileSync('git', ['--no-optional-locks', '-C', project, 'show', `${sourceRef}:minuta-online-booking/${name}`], { encoding:'utf8', maxBuffer:2097152 })
  : fs.readFileSync(path.join(project, 'minuta-online-booking', name), 'utf8');
const centerSource = source('provider-messages-center.js');
const coreSource = source('messages-core.js');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve=yes; reject=no; }); return { promise, resolve, reject }; };
const settle = async () => { for (let index=0; index<16; index++) await Promise.resolve(); };

class Events {
  handlers = new Map();
  addEventListener(type, handler) { if (!this.handlers.has(type)) this.handlers.set(type, new Set()); this.handlers.get(type).add(handler); }
  removeEventListener(type, handler) { this.handlers.get(type)?.delete(handler); }
  emit(type, details={}) { for (const handler of [...(this.handlers.get(type) || [])]) handler({ type, preventDefault(){}, ...details }); }
  count(type) { return this.handlers.get(type)?.size || 0; }
}
class Node extends Events {
  constructor(world, root=null) {
    super(); this.world=world; this.root=root || this; this.nodes=new Map(); this.attributes=new Map(); this._html=''; this._text='';
    this.value=''; this.hidden=false; this.disabled=false; this.checked=false; this.open=false; this.scrollTop=0; this.scrollHeight=0;
    this.dataset=new Proxy({}, { set:(target,key,value)=>{world.writes++;target[key]=value;return true;} });
    const classes=new Set();
    this.classList={add:(...items)=>{world.writes++;items.forEach(x=>classes.add(x));},remove:(...items)=>{world.writes++;items.forEach(x=>classes.delete(x));},contains:x=>classes.has(x),toggle:(x,on)=>{if(on===undefined)on=!classes.has(x);on?classes.add(x):classes.delete(x);return on;}};
  }
  set innerHTML(value) { this._html=String(value); this.world.writes++; this.nodes=new Map(); }
  get innerHTML() { return this._html; }
  set textContent(value) { this._text=String(value); this.world.writes++; }
  get textContent() { return this._text; }
  querySelector(selector) { if (!this.nodes.has(selector)) this.nodes.set(selector,new Node(this.world,this.root));return this.nodes.get(selector); }
  querySelectorAll() { return []; }
  setAttribute(name,value) { this.attributes.set(name,String(value));this.world.writes++; }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  focus() {}
  showModal() { this.open=true;this.world.writes++; }
  close() { this.open=false;this.world.writes++; }
  closest() { return null; }
}
function world() {
  const state={writes:0,timers:new Map(),nextTimer:0,network:0,storageWrites:0,uuid:0};
  const root=new Node(state),global=new Events(),stored=new Map();
  global.sessionStorage={getItem:key=>stored.get(key) ?? null,setItem:(key,value)=>{state.storageWrites++;stored.set(key,String(value));},removeItem:key=>{state.storageWrites++;stored.delete(key);}};
  global.crypto={randomUUID:()=> '11111111-1111-4111-8111-'+String(++state.uuid).padStart(12,'0')};
  global.location={href:'https://synthetic.invalid/minuta-online-booking/provider.html'};
  const clock={setTimeout:fn=>{const id=++state.nextTimer;state.timers.set(id,fn);return id;},clearTimeout:id=>state.timers.delete(id)};
  const forbidden=()=>{state.network++;throw Error('FORBIDDEN_REAL_IO');};
  const context=vm.createContext({window:global,navigator:{onLine:true},document:{hidden:false,querySelector:()=>root},URL,Intl,Date,Promise,AbortController,console:{log(){},warn(){},error(){}},fetch:forbidden,WebSocket:forbidden,XMLHttpRequest:forbidden,...clock});
  vm.runInContext(coreSource,context,{filename:'messages-core.js'});
  vm.runInContext(centerSource,context,{filename:'provider-messages-center.js'});
  return {state,root,global,api:global.MinutaProviderMessages,context,clock,stored};
}

const conversation={id:'synthetic-thread',kind:'client',title:'Synthetic',subtitle:'',preview:'',updated_at:'2026-10-17T00:00:00Z',unread_count:0,can_send:true};
const ack=payload=>({id:'synthetic-message',conversation_id:payload.conversation_id,client_request_id:payload.client_request_id,kind:'human',author_kind:'provider',author_label:'Synthetic',body:payload.body,created_at:'2026-10-17T00:00:00Z',sequence:1,status:'sent'});
function bridge(overrides={}){
  const calls={send:[],lookup:[]},handlers={send:async payload=>ack(payload),lookup:async()=>null,...overrides};
  const value={capability:async()=>({enabled:true,support_enabled:false,media_enabled:false}),listConversations:async()=>({items:[conversation]}),timeline:async()=>({items:[],after_sequence:0}),markRead:async()=>{},
    send:payload=>{calls.send.push({...payload});return handlers.send(payload);},lookup:parameters=>{calls.lookup.push({...parameters});return handlers.lookup(parameters);}};
  return{calls,handlers,value};
}
async function mount(w,b,options={}){return w.api.mount({root:w.root,bridge:b.value,organizationId:'synthetic-org',...options});}
function submit(w,body){w.root.querySelector('[data-message-input]').value=body;const form=w.root.querySelector('[data-message-composer]');form.emit('submit',{currentTarget:form});}
const storageKey='minuta-message-outbox-v1:provider:synthetic-org';
const persisted=w=>JSON.parse(w.global.sessionStorage.getItem(storageKey)||'[]');
function validatedAck(w,payload){const response=ack(payload);assert.ok(w.global.MinutaMessagesCore.normalizeMessage(response));return response;}
function retry(w,requestId){w.root.emit('click',{target:{closest:selector=>selector==='[data-message-retry]'?{dataset:{messageRetry:requestId}}:null}});}
async function newOwnerQueue(w){const b=bridge(),controller=await mount(w,b);w.context.navigator.onLine=false;submit(w,'synthetic-new-owner');await settle();return{b,controller};}

// Every bridge call, timer, DOM and storage operation below is synthetic.
// Both complete production Source modules run in the VM; no fake core ACK logic.
test('current send preserves payload and acknowledges its own persisted queue',async()=>{
  const w=world(),b=bridge(),c=await mount(w,b);submit(w,'synthetic-current');await settle();
  assert.equal(b.calls.send.length,1);assert.deepEqual(Object.keys(b.calls.send[0]).sort(),['body','client_request_id','conversation_id']);
  assert.equal(b.calls.send[0].body,'synthetic-current');assert.equal(b.calls.send[0].conversation_id,conversation.id);
  assert.equal(c.snapshot().outbox.length,0);assert.equal(persisted(w).length,0);assert.equal(b.calls.lookup.length,0);assert.equal(w.state.network,0);c.destroy();
});

test('current lost ACK is recovered by lookup with the same request ID',async()=>{
  const w=world();let sent;const b=bridge({send:async payload=>{sent=payload;throw Error('synthetic network loss');},lookup:async()=>validatedAck(w,sent)}),c=await mount(w,b);
  submit(w,'synthetic-recovered');await settle();assert.equal(b.calls.send.length,1);assert.equal(b.calls.lookup.length,1);
  assert.equal(b.calls.lookup[0].requestId,sent.client_request_id);assert.equal(c.snapshot().outbox.length,0);assert.equal(persisted(w).length,0);c.destroy();
});

test('current lookup miss keeps unknown ACK and manual retry reuses the same request',async()=>{
  const w=world(),b=bridge({send:async()=>{throw Error('synthetic network loss');}}),c=await mount(w,b);submit(w,'synthetic-retry');await settle();
  const entry=c.snapshot().outbox[0];assert.equal(entry.status,'failed');assert.equal(entry.error_code,'ack_unknown');assert.equal(entry.lost_ack,true);assert.equal(persisted(w).length,1);
  b.handlers.send=async payload=>validatedAck(w,payload);retry(w,entry.client_request_id);await settle();
  assert.equal(b.calls.send.length,2);assert.equal(b.calls.send[1].client_request_id,b.calls.send[0].client_request_id);assert.equal(b.calls.send[1].body,b.calls.send[0].body);assert.equal(persisted(w).length,0);c.destroy();
});

test('current deterministic rejection retains failed queue without lookup',async()=>{
  const w=world(),b=bridge({send:async()=>{throw Error('synthetic denied');}}),c=await mount(w,b);submit(w,'synthetic-denied');await settle();
  const entry=c.snapshot().outbox[0];assert.equal(entry.status,'failed');assert.equal(entry.error_code,'send_rejected');assert.equal(entry.lost_ack,false);assert.equal(b.calls.lookup.length,0);assert.equal(persisted(w).length,1);c.destroy();
});

test('current offline queue still flushes once on a synthetic online event',async()=>{
  const w=world(),b=bridge(),c=await mount(w,b);w.context.navigator.onLine=false;submit(w,'synthetic-offline');await settle();
  const id=c.snapshot().outbox[0].client_request_id;assert.equal(c.snapshot().outbox[0].status,'queued-offline');assert.equal(b.calls.send.length,0);
  w.context.navigator.onLine=true;w.global.emit('online');await settle();assert.equal(b.calls.send.length,1);assert.equal(b.calls.send[0].client_request_id,id);assert.equal(persisted(w).length,0);c.destroy();
});

test('retired send ACK after session reset cannot erase the new owner persisted queue',async()=>{
  const w=world(),pending=deferred(),b=bridge({send:()=>pending.promise}),old=await mount(w,b);submit(w,'synthetic-old');await settle();
  assert.equal(b.calls.send.length,1);const response=validatedAck(w,b.calls.send[0]);w.global.emit('minuta:provider-session-reset');assert.equal(old.isActive(),false);
  const next=await newOwnerQueue(w),before=w.global.sessionStorage.getItem(storageKey),writes=w.state.storageWrites;
  assert.equal(persisted(w).length,1);pending.resolve(response);await settle();
  assert.equal(w.global.sessionStorage.getItem(storageKey),before);assert.equal(w.state.storageWrites,writes);assert.equal(next.controller.snapshot().outbox.length,1);next.controller.destroy();
});

test('retired network failure cannot initiate deferred lookup or update persisted state',async()=>{
  const w=world(),pending=deferred(),b=bridge({send:()=>pending.promise});let owner=true;const c=await mount(w,b,{isCurrent:()=>owner});submit(w,'synthetic-old');await settle();
  owner=false;const before=w.global.sessionStorage.getItem(storageKey),writes=w.state.storageWrites;pending.reject(Error('synthetic network loss'));await settle();
  assert.equal(b.calls.lookup.length,0);assert.equal(w.global.sessionStorage.getItem(storageKey),before);assert.equal(w.state.storageWrites,writes);c.destroy();
});

test('already pending lookup ACK after reset cannot erase replacement queue',async()=>{
  const w=world(),pending=deferred();let sent;const b=bridge({send:async payload=>{sent=payload;throw Error('synthetic network loss');},lookup:()=>pending.promise}),old=await mount(w,b);
  submit(w,'synthetic-old-lookup');await settle();assert.equal(b.calls.lookup.length,1);const response=validatedAck(w,sent);
  w.global.emit('minuta:provider-session-reset');assert.equal(old.isActive(),false);const next=await newOwnerQueue(w),before=w.global.sessionStorage.getItem(storageKey),writes=w.state.storageWrites;
  pending.resolve(response);await settle();assert.equal(w.global.sessionStorage.getItem(storageKey),before);assert.equal(w.state.storageWrites,writes);assert.equal(next.controller.snapshot().outbox.length,1);next.controller.destroy();
});

for(const outcome of ['deterministic-rejection','malformed-ack'])test('retired '+outcome+' cannot overwrite a remounted same-scope queue',async()=>{
  const w=world(),pending=deferred(),b=bridge({send:()=>pending.promise}),old=await mount(w,b);submit(w,'synthetic-old-pending');await settle();
  const next=await newOwnerQueue(w);assert.equal(old.isActive(),false);assert.equal(next.controller.snapshot().outbox.length,2);
  const before=w.global.sessionStorage.getItem(storageKey),writes=w.state.storageWrites;
  if(outcome==='deterministic-rejection')pending.reject(Error('synthetic denied'));else pending.resolve({kind:'human'});
  await settle();assert.equal(w.global.sessionStorage.getItem(storageKey),before);assert.equal(w.state.storageWrites,writes);assert.equal(next.controller.snapshot().outbox.length,2);next.controller.destroy();
});
