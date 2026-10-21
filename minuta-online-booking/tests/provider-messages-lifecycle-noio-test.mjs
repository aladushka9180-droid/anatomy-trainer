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
  const state={writes:0,timers:new Map(),nextTimer:0,network:0};
  const root=new Node(state),global=new Events(),stored=new Map();
  global.sessionStorage={getItem:key=>stored.get(key) ?? null,setItem:(key,value)=>stored.set(key,String(value)),removeItem:key=>stored.delete(key)};
  global.crypto={randomUUID:()=> '11111111-1111-4111-8111-111111111111'};
  global.location={href:'https://synthetic.invalid/minuta-online-booking/provider.html'};
  const clock={setTimeout:fn=>{const id=++state.nextTimer;state.timers.set(id,fn);return id;},clearTimeout:id=>state.timers.delete(id)};
  const forbidden=()=>{state.network++;throw Error('FORBIDDEN_REAL_IO');};
  const context=vm.createContext({window:global,navigator:{onLine:true},document:{hidden:false,querySelector:()=>root},URL,Intl,Date,Promise,AbortController,console:{log(){},warn(){},error(){}},fetch:forbidden,WebSocket:forbidden,XMLHttpRequest:forbidden,...clock});
  vm.runInContext(coreSource,context,{filename:'messages-core.js'});
  vm.runInContext(centerSource,context,{filename:'provider-messages-center.js'});
  return {state,root,global,api:global.MinutaProviderMessages,context,clock};
}
const conversations=[
  {id:'a',kind:'client',title:'Synthetic A',subtitle:'A',preview:'',updated_at:'2026-10-17T00:00:00Z',unread_count:0,can_send:true},
  {id:'b',kind:'client',title:'Synthetic B',subtitle:'B',preview:'',updated_at:'2026-10-17T00:00:00Z',unread_count:0,can_send:true}
];
const reply=(id,sequence=1)=>({items:[{id:`${id}-${sequence}`,conversation_id:id,kind:'human',author_kind:'client',author_label:'Synthetic',body:`Body ${id} ${sequence}`,created_at:'2026-10-17T00:00:00Z',sequence,status:'sent'}],after_sequence:sequence});
function bridge(overrides={}) {
  const calls={capability:0,list:0,timeline:[],send:0,markRead:0};
  const result={
    capability:async()=>{calls.capability++;return {enabled:true,support_enabled:false,media_enabled:false};},
    listConversations:async()=>{calls.list++;return {items:conversations};},
    timeline:async parameters=>{calls.timeline.push(parameters);return reply(parameters.conversationId);},
    markRead:async()=>{calls.markRead++;},
    send:async()=>{calls.send++;throw Error('UNEXPECTED_SYNTHETIC_SEND');},
    ...overrides
  };
  return {value:result,calls};
}
async function mounted(w,b,extra={}) { return w.api.mount({root:w.root,bridge:b.value,organizationId:'synthetic-org',...extra}); }
function pollOnce(w) {
  const [id,callback] = w.state.timers.entries().next().value || [];
  assert.equal(typeof callback,'function','a poll is scheduled');
  w.state.timers.delete(id);
  return callback();
}

test('ordinary provider mount/reload/selection stays usable',async()=>{
  const w=world(),b=bridge(),controller=await mounted(w,b);
  assert.ok(controller);assert.equal(controller.snapshot().selectedId,'a');
  await controller.reload();assert.equal(b.calls.list,2);
  assert.equal(controller.select('b'),true);await settle();
  assert.match(w.root.querySelector('[data-message-timeline]').innerHTML,/Body b/);
  assert.equal(b.calls.send,0);assert.equal(w.state.network,0);
  controller.destroy();
});

for (const actorKind of ['provider','client']) test(`${actorKind}: reversed timeline replies never paint the previous conversation`,async()=>{
  const w=world(),b=bridge();
  const controller=actorKind==='provider'?await mounted(w,b):w.api.createMessageCenter({root:w.root,bridge:b.value,actorKind:'client',scope:'client-synthetic'});
  if(actorKind==='client')await controller.initialize();
  const pending=[];b.value.timeline=parameters=>{const d=deferred();pending.push({parameters,...d});return d.promise;};
  controller.select('a');controller.select('b');
  pending[1].resolve(reply('b',2));await settle();pending[0].resolve(reply('a',100));await settle();
  const html=w.root.querySelector('[data-message-timeline]').innerHTML;
  assert.match(html,/Body b/);assert.doesNotMatch(html,/Body a/);assert.equal(controller.snapshot().selectedId,'b');controller.destroy();
});

test('new selection clears the previous body while its reply is still pending',async()=>{
  const w=world(),b=bridge(),controller=await mounted(w,b);const d=deferred();b.value.timeline=()=>d.promise;
  controller.select('b');assert.doesNotMatch(w.root.querySelector('[data-message-timeline]').innerHTML,/Body a/);
  d.resolve(reply('b'));await settle();controller.destroy();
});

test('incremental cursor belongs to the selected conversation',async()=>{
  const w=world(),b=bridge({timeline:async parameters=>reply(parameters.conversationId,parameters.conversationId==='a'?100:2)}),controller=await mounted(w,b);
  controller.select('b');await settle();const calls=[];b.value.timeline=async parameters=>{calls.push(parameters);return reply('b',3);};
  const poll=w.state.timers.values().next().value;assert.equal(typeof poll,'function');await poll();
  assert.equal(calls[0].conversationId,'b');assert.equal(calls[0].afterSequence,2);controller.destroy();
});

test('late failure of the previous conversation does not replace current notice',async()=>{
  const w=world(),b=bridge(),controller=await mounted(w,b),pending=[];b.value.timeline=()=>{const d=deferred();pending.push(d);return d.promise;};
  controller.select('a');controller.select('b');pending[1].resolve(reply('b'));await settle();
  const before=w.root.querySelector('[data-message-notice-title]').textContent;pending[0].reject(new Error('SYNTHETIC_OLD_FAILURE'));await settle();
  assert.equal(w.root.querySelector('[data-message-notice-title]').textContent,before);controller.destroy();
});

test('destroy invalidates an in-flight conversation read before DOM updates',async()=>{
  const w=world(),b=bridge(),controller=await mounted(w,b),pending=deferred();b.value.listConversations=()=>pending.promise;
  const request=controller.reload();controller.destroy();const before=w.state.writes;pending.resolve({items:conversations});assert.equal(await request,false);
  assert.equal(w.state.writes,before);assert.equal(w.root.count('click'),0);
});

test('destroy invalidates an in-flight timeline read and busy cleanup',async()=>{
  const w=world(),b=bridge(),controller=await mounted(w,b),pending=deferred();b.value.timeline=()=>pending.promise;
  controller.select('a');controller.destroy();const before=w.state.writes;pending.resolve(reply('a'));await settle();
  assert.equal(w.state.writes,before);assert.equal(w.global.count('offline'),0);
});

test('provider session reset retires pending initialization without a late mount',async()=>{
  const w=world(),pending=deferred(),b=bridge({capability:()=>pending.promise}),request=mounted(w,b);
  w.global.emit('minuta:provider-session-reset');const before=w.state.writes;pending.resolve({enabled:true,support_enabled:false});
  assert.equal(await request,null);assert.equal(w.state.writes,before);assert.equal(b.calls.list,0);assert.equal(w.global.count('online'),0);
});

test('owner predicate change refuses completion before further reads or UI writes',async()=>{
  const w=world(),pending=deferred(),b=bridge({capability:()=>pending.promise});let current=true;const request=mounted(w,b,{isCurrent:()=>current});
  current=false;const before=w.state.writes;pending.resolve({enabled:true,support_enabled:false});
  assert.equal(await request,null);assert.equal(w.state.writes,before);assert.equal(b.calls.list,0);
});

test('an aborted pending mount is retired and all owned listeners are removed',async()=>{
  const w=world(),pending=deferred(),b=bridge({capability:()=>pending.promise}),abort=new AbortController(),request=mounted(w,b,{signal:abort.signal});
  abort.abort();const before=w.state.writes;pending.resolve({enabled:true,support_enabled:false});
  assert.equal(await request,null);assert.equal(w.state.writes,before);assert.equal(w.root.count('click'),0);assert.equal(b.calls.list,0);
});

test('second mount owns the root and late first mount cannot return or repaint',async()=>{
  const w=world(),pending=deferred(),first=bridge({capability:()=>pending.promise}),old=mounted(w,first),second=bridge(),controller=await mounted(w,second,{organizationId:'second-org'});
  const before=w.state.writes;pending.resolve({enabled:true,support_enabled:false});
  assert.equal(await old,null);assert.equal(w.state.writes,before);assert.equal(first.calls.list,0);assert.equal(w.root.count('click'),1);assert.equal(w.global.count('online'),1);controller.destroy();
});

test('already stale owner refuses mount without storage, DOM or bridge activity',async()=>{
  const w=world(),b=bridge(),before=w.state.writes;
  assert.equal(await mounted(w,b,{isCurrent:()=>false}),null);assert.equal(w.state.writes,before);assert.equal(b.calls.capability,0);assert.equal(w.root.count('click'),0);
});

test('destroy suppresses late synthetic support failure UI',async()=>{
  let supportCalls=0;
  const w=world(),pending=deferred(),b=bridge({capability:async()=>({enabled:true,support_enabled:true}),openSupport:()=>{supportCalls++;return pending.promise;}}),controller=await mounted(w,b);
  w.root.querySelector('[data-message-support-text]').value='Synthetic question';
  const form=w.root.querySelector('[data-message-support-form]');form.emit('submit',{currentTarget:form});
  assert.equal(supportCalls,1);
  controller.destroy();const before=w.state.writes;pending.reject(new Error('SYNTHETIC_SUPPORT_FAILURE'));await settle();
  assert.equal(w.state.writes,before);assert.equal(w.state.network,0);
});

test('throwing owner predicate refuses mount without DOM or bridge activity',async()=>{
  const w=world(),b=bridge(),before=w.state.writes;
  assert.equal(await mounted(w,b,{isCurrent:()=>{throw Error('SYNTHETIC_OWNER_ERROR');}}),null);
  assert.equal(w.state.writes,before);assert.equal(b.calls.capability,0);
});

for (const outcome of ['SUCCESS','ERROR']) test(`provider poll preserves pending B after initial A ${outcome}`,async()=>{
  const w=world(),a=deferred(),bRead=deferred(),calls=[];
  const b=bridge({timeline:parameters=>{
    calls.push(parameters);
    if(parameters.conversationId==='a' && parameters.afterSequence===null)return a.promise;
    if(parameters.conversationId==='b' && parameters.afterSequence===null)return bRead.promise;
    if(parameters.conversationId==='b' && parameters.afterSequence===20)return Promise.resolve(reply('b',21));
    return Promise.reject(new Error('QA04_CURSOR_REFUSED'));
  }});
  const mounting=mounted(w,b);await settle();
  w.root.emit('click',{target:{closest:selector=>selector==='[data-message-conversation]'?{dataset:{messageConversation:'b'}}:null}});
  assert.equal(calls.length,2,'B starts while initial A is still held');
  const timeline=w.root.querySelector('[data-message-timeline]');
  assert.equal(timeline.getAttribute('aria-busy'),'true');
  const notice=w.root.querySelector('[data-message-notice-title]').textContent;
  if(outcome==='SUCCESS')a.resolve(reply('a',10));else a.reject(new Error('SYNTHETIC_OLD_FAILURE'));
  const controller=await mounting;
  assert.equal(w.root.querySelector('[data-message-notice-title]').textContent,notice);
  assert.equal(timeline.getAttribute('aria-busy'),'true');
  for(let tick=0;tick<2;tick++){
    await pollOnce(w);
    assert.equal(calls.length,2,'poll must not issue cursor 0 over the held B read');
    assert.equal(timeline.getAttribute('aria-busy'),'true','old A and poll must preserve B busy');
    assert.equal(w.root.querySelector('[data-message-notice-title]').textContent,notice);
  }
  bRead.resolve(reply('b',20));await settle();
  assert.match(timeline.innerHTML,/Body b/);assert.doesNotMatch(timeline.innerHTML,/Body a/);
  assert.equal(timeline.getAttribute('aria-busy'),'false');
  await pollOnce(w);
  assert.equal(calls.length,3);assert.equal(calls[2].conversationId,'b');assert.equal(calls[2].afterSequence,20);
  assert.match(timeline.innerHTML,/Body b 20/);assert.match(timeline.innerHTML,/Body b 21/);
  assert.equal(b.calls.send,0);assert.equal(w.state.network,0);
  controller.destroy();
});

test('provider poll resumes after current B fails, without clearing it for stale A',async()=>{
  const w=world(),a=deferred(),bRead=deferred(),calls=[];
  const b=bridge(),controller=await mounted(w,b);
  b.value.timeline=parameters=>{
    calls.push(parameters);
    if(parameters.conversationId==='a')return a.promise;
    if(parameters.afterSequence===null)return bRead.promise;
    return Promise.resolve(reply('b',20));
  };
  controller.select('a');controller.select('b');
  a.resolve(reply('a',10));await settle();
  await pollOnce(w);
  assert.equal(calls.length,2);
  bRead.reject(new Error('SYNTHETIC_CURRENT_FAILURE'));await settle();
  assert.equal(w.root.querySelector('[data-message-timeline]').getAttribute('aria-busy'),'false');
  assert.match(w.root.querySelector('[data-message-notice-title]').textContent,/Не удалось обновить диалог/);
  await pollOnce(w);
  assert.equal(calls.length,3,'a completed failed read must not block later polling');
  assert.equal(calls[2].conversationId,'b');assert.equal(calls[2].afterSequence,0);
  assert.match(w.root.querySelector('[data-message-timeline]').innerHTML,/Body b/);
  assert.equal(w.state.network,0);controller.destroy();
});

test('provider can select B during a held A page and polling retains B ownership',async()=>{
  const w=world(),aPage=deferred(),bRead=deferred(),calls=[];
  const b=bridge({timeline:async parameters=>reply(parameters.conversationId,10)}),controller=await mounted(w,b);
  b.value.timeline=parameters=>{
    calls.push(parameters);
    if(parameters.conversationId==='a')return aPage.promise;
    if(parameters.afterSequence===null)return bRead.promise;
    return Promise.resolve(reply('b',21));
  };
  const oldPoll=pollOnce(w);await settle();
  assert.equal(calls[0].afterSequence,10);
  controller.select('b');
  assert.equal(calls.length,2,'an unrelated held page must not block selection');
  aPage.resolve(reply('a',11));await oldPoll;
  await pollOnce(w);
  assert.equal(calls.length,2,'completion of A page must not clear B pending ownership');
  assert.equal(w.root.querySelector('[data-message-timeline]').getAttribute('aria-busy'),'true');
  bRead.resolve(reply('b',20));await settle();
  await pollOnce(w);
  assert.equal(calls[2].conversationId,'b');assert.equal(calls[2].afterSequence,20);
  const html=w.root.querySelector('[data-message-timeline]').innerHTML;
  assert.doesNotMatch(html,/Body a/);assert.match(html,/Body b 20/);assert.match(html,/Body b 21/);
  assert.equal(w.state.network,0);controller.destroy();
});
