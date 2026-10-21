import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../provider-feedback-inbox.js', import.meta.url), 'utf8');
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
function setup() {
  const calls = [], nodes = new Map();
  const state = { user:{ id:'synthetic-actor-a' }, organization:{ id:'synthetic-org-a' } };
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { hidden:false, textContent:'', innerHTML:'', dataset:{}, classList:{ toggle(){} }, setAttribute(){} });
    return nodes.get(id);
  };
  node('#dashboard').dataset.activeView = 'bookings';
  const document = { querySelectorAll:()=>[], addEventListener(){} };
  const window = { addEventListener(){} };
  const forbidden = () => { throw Error('FORBIDDEN_REAL_IO'); };
  vm.runInNewContext(source, { window, document, navigator:{ onLine:true }, fetch:forbidden, WebSocket:forbidden, XMLHttpRequest:forbidden }, { filename:'provider-feedback-inbox.js' });
  const controller = window.MinutaFeedbackInbox.createController({
    db:{ rpc(name, args){
      assert.equal(name, 'get_minuta_feedback_inbox_v146');
      const request = deferred(); calls.push({ name, args, ...request }); return request.promise;
    } },
    $:node, notify:forbidden, getCurrentUser:()=>state.user, getOrganization:()=>state.organization
  });
  controller.setOrganization(state.organization);
  return { controller, calls, state, node };
}
const reply = message => ({ data:{ items:[{ id:'synthetic-feedback', request_number:1, kind:'problem', status:'new', message, created_at:'2026-10-17T00:00:00Z' }], can_manage:false }, error:null });
const settle = async (request, operation, message) => { request.resolve(reply(message)); return operation; };

test('ordinary successful load and explicit reload both reach the fake RPC', async () => {
  const c=setup(), first=c.controller.load(); assert.equal(c.calls.length,1);
  assert.equal((await settle(c.calls[0],first,'first')).ok,true);
  const second=c.controller.load(); assert.equal(c.calls.length,2);
  assert.equal((await settle(c.calls[1],second,'second')).ok,true);
  assert.match(c.node('#feedbackInboxList').innerHTML,/second/);
});

test('inactive organization switch releases an invalidated completed request', async () => {
  const c=setup(), old=c.controller.load();
  c.state.organization={id:'synthetic-org-b'};c.controller.setOrganization(c.state.organization);
  assert.equal((await settle(c.calls[0],old,'stale-org-a')).stale,true);
  const next=c.controller.load();assert.equal(c.calls.length,2);
  assert.equal(c.calls[1].args.p_organization,'synthetic-org-b');
  assert.equal((await settle(c.calls[1],next,'current-org-b')).ok,true);
  assert.doesNotMatch(c.node('#feedbackInboxList').innerHTML,/stale-org-a/);
});

test('reset releases invalidated loading so the next ordinary load runs', async () => {
  const c=setup(), old=c.controller.load();c.controller.reset();c.state.user={id:'synthetic-actor-b'};
  assert.equal((await settle(c.calls[0],old,'stale-before-reset')).stale,true);
  const next=c.controller.load();assert.equal(c.calls.length,2);
  assert.equal((await settle(c.calls[1],next,'current-after-reset')).ok,true);
  assert.doesNotMatch(c.node('#feedbackInboxList').innerHTML,/stale-before-reset/);
});

test('old finalizer after organization switch cannot release the new request loading', async () => {
  const c=setup(), old=c.controller.load();c.state.organization={id:'synthetic-org-b'};c.controller.setOrganization(c.state.organization);
  const next=c.controller.load();assert.equal(c.calls.length,2);
  assert.equal((await settle(c.calls[0],old,'stale-org-a')).stale,true);
  assert.equal((await c.controller.load()).pending,true);assert.equal(c.calls.length,2);
  assert.equal((await settle(c.calls[1],next,'current-org-b')).ok,true);
});

test('forced reload keeps revision ownership while the old request settles', async () => {
  const c=setup(), old=c.controller.load(), next=c.controller.load({force:true});assert.equal(c.calls.length,2);
  assert.equal((await settle(c.calls[0],old,'stale-forced')).stale,true);
  assert.equal((await c.controller.load()).pending,true);assert.equal(c.calls.length,2);
  assert.equal((await settle(c.calls[1],next,'current-forced')).ok,true);
  assert.match(c.node('#feedbackInboxList').innerHTML,/current-forced/);
});

test('RPC error releases current loading for a later ordinary retry', async () => {
  const c=setup(), first=c.controller.load();c.calls[0].resolve({data:null,error:{code:'42501',message:'synthetic refusal'}});
  assert.equal((await first).ok,false);assert.equal(c.node('#feedbackInboxError').hidden,false);
  const next=c.controller.load();assert.equal(c.calls.length,2);assert.equal((await settle(c.calls[1],next,'recovered')).ok,true);
});

test('idle reset clears the list and permits a normal subsequent load', async () => {
  const c=setup(), first=c.controller.load();await settle(c.calls[0],first,'before-reset');c.controller.reset();
  assert.equal(c.node('#feedbackInboxList').innerHTML,'');
  const next=c.controller.load();assert.equal(c.calls.length,2);assert.equal((await settle(c.calls[1],next,'after-reset')).ok,true);
});

test('same organization retains its pending request and ordinary reuse stays valid', async () => {
  const c=setup(), first=c.controller.load();c.controller.setOrganization({id:'synthetic-org-a'});
  assert.equal((await c.controller.load()).pending,true);assert.equal(c.calls.length,1);
  assert.equal((await settle(c.calls[0],first,'same-org')).ok,true);
  const next=c.controller.load();assert.equal(c.calls.length,2);await settle(c.calls[1],next,'reload');
});

test('active organization switch still forces a replacement load and rejects the old result', async () => {
  const c=setup(), old=c.controller.load();c.node('#dashboard').dataset.activeView='feedback-inbox';
  c.state.organization={id:'synthetic-org-b'};c.controller.setOrganization(c.state.organization);assert.equal(c.calls.length,2);
  assert.equal((await settle(c.calls[0],old,'stale-active')).stale,true);
  assert.equal((await c.controller.load()).pending,true);c.calls[1].resolve(reply('current-active'));
  await Promise.resolve();await Promise.resolve();
  assert.match(c.node('#feedbackInboxList').innerHTML,/current-active/);
  assert.doesNotMatch(c.node('#feedbackInboxList').innerHTML,/stale-active/);
});
