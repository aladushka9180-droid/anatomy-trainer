import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// Whole actual controller; artificial DOM, identity and RPC ports only.
// No product bootstrap, real resource, browser, network, storage or SQL.
const source = readFileSync(new URL('../resource-management.js', import.meta.url), 'utf8');
const deferred = () => { let resolve, reject; const promise = new Promise((yes,no) => { resolve=yes; reject=no; }); return { promise,resolve,reject }; };
function fixture() {
  const nodes = new Map(), listeners = new Map(), reads = [], writes = [], notices = [];
  const readEntered = deferred(), readOutcome = deferred(); let holdRead = false, user = 'synthetic-owner-A', generation = 1;
  const fieldIds = ['resourceGroupName','resourceGroupKind','resourceGroupDescription'];
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, { id, value:'', defaultValue:'', checked:false, defaultChecked:false, tagName:'INPUT', type:'text',
      textContent:'', innerHTML:'', hidden:false, open:false, disabled:false, dataset:{}, options:[],
      classList:{ add() {}, remove() {}, toggle() {}, contains() { return false; } },
      setAttribute() {}, removeAttribute() {}, getAttribute() { return null; }, focus() {}, scrollIntoView() {},
      querySelectorAll(selector) {
        if (id === 'resourceGroupForm' && selector === 'input, select, textarea') return fieldIds.map(node);
        if (id === 'resourcesPanel' && selector === '[data-resource-write]') return [node('resourceSubmit')];
        return [];
      },
      querySelector(selector) {
        if (selector === 'form' && id === 'resourceGroupCreator') return node('resourceGroupForm');
        if (selector === 'form' && id === 'resourceCreator') return node('resourceForm');
        return node(id + ' ' + selector);
      },
      closest(selector) {
        if (selector === '#resourcesPanel') return node('resourcesPanel');
        if (selector === 'details' && ['resourceGroupForm','resourceGroupError'].includes(id)) return node('resourceGroupCreator');
        if (selector === '#resourceGroupsSection' && id === 'resourceGroupError') return node('resourceGroupsSection');
        return null;
      },
      reset() { if (id === 'resourceGroupForm') for (const field of fieldIds) node(field).value = node(field).defaultValue; }
    });
    return nodes.get(id);
  }
  node('resourceGroupKind').tagName = 'SELECT'; node('resourceGroupKind').defaultValue = 'room';
  node('resourceGroupKind').options = [{ value:'room', defaultSelected:true }];
  // Like the existing controller FakeDOM, do not model visual layout insertion.
  node('resourcesPanel').classList = undefined;
  const workspace = (organization, label = '') => ({ organization_id:organization, can_manage:true, locations:[], services:[], resources:[], requirements:[], audit:[],
    groups:label ? [{ id:'synthetic-group-' + organization, name:label, kind:'room', description:'',active:true }] : [] });
  const box = { console, Date, Intl, Map, Set, Number, Object, Array, Boolean, String, JSON, RegExp, Error,
    document:{ addEventListener:(name, listener) => listeners.set(name, listener) } };
  box.window = box; vm.runInNewContext(source, box, { filename:'actual-resource-management.js', timeout:1000 });
  const controller = box.MinutaResources.createController({
    db:{ async rpc(name, parameters) {
      if (name === 'get_minuta_resource_workspace') {
        reads.push(parameters.p_organization);
        if (holdRead) { holdRead = false; readEntered.resolve(); return readOutcome.promise; }
        return { data:workspace(parameters.p_organization),error:null };
      }
      assert.equal(name, 'create_minuta_resource_group', 'unexpected synthetic write');
      const gate = deferred(); writes.push({ parameters,gate }); return gate.promise;
    } },
    $:selector => node(selector.replace(/^#/, '')), escapeHtml:String, notify:message => notices.push(message),
    requireWrites:() => true, getCurrentUser:() => ({ id:user }), getSessionGeneration:() => generation,
    sessionIsCurrent:(id, expectedGeneration) => id === user && expectedGeneration === generation, applyWriteAvailability() {}
  });
  controller.bind();
  return { controller, node, reads, writes, notices, workspace, readEntered, readOutcome,
    setOrganization:id => controller.setOrganization({ id, current_role:'owner', can_manage:true }),
    changeSession() { user='synthetic-owner-B'; generation++; }, armRead() { holdRead = true; },
    fill(label) { node('resourceGroupName').value = label; node('resourceGroupKind').value = 'room'; node('resourceGroupDescription').value = ''; node('resourceGroupCreator').open = true; },
    draft:() => node('resourceGroupName').value,
    submit:() => listeners.get('submit')({ target:node('resourceGroupForm'), submitter:node('resourceSubmit'), preventDefault() {} }),
    settle(write, result = 'success') {
      if (result === 'throw') return write.gate.reject(new Error('Synthetic transport rejection'));
      write.gate.resolve(result === 'success' ? { data:workspace(write.parameters.p_organization, write.parameters.p_name),error:null } : { data:null,error:{ code:result === 'known-error' ? '42501' : 'FETCH_FAILED' } });
    }
  };
}
async function start() {
  const f = fixture(); await f.setOrganization('synthetic-A'); f.fill('Synthetic group A'); f.node('resourceSubmit').textContent='Save synthetic A';
  const pending = f.submit(); assert.equal(f.writes.length, 1); return { f,pending };
}

for (const oldResult of ['success','known-error','throw']) test('resource: late old RPC ' + oldResult + ' cannot release a new write owner', async () => {
  const { f,pending:oldPending } = await start(); f.controller.reset(); await f.setOrganization('synthetic-B'); f.fill('Synthetic group B');
  f.node('resourceSubmit').textContent='Save synthetic B'; const currentPending=f.submit(); assert.equal(f.writes.length, 2);
  f.settle(f.writes[0], oldResult); await oldPending;
  const caption=f.node('resourceSubmit').textContent, duplicate=f.submit(), count=f.writes.length;
  for (const write of f.writes.slice(1)) f.settle(write); await Promise.all([currentPending,duplicate]);
  assert.deepEqual({ caption,count }, { caption:'Сохраняем…',count:2 });
  assert.equal(f.node('resourceSubmit').textContent, 'Save synthetic B'); assert.equal(f.draft(), '');
});

test('resource: old RPC cannot consume the pending organization owned by a new RPC', async () => {
  const { f,pending:oldPending } = await start(); f.controller.reset(); await f.setOrganization('synthetic-B'); f.fill('Synthetic group B');
  const currentPending=f.submit(); const queued=await f.setOrganization('synthetic-C'); assert.equal(queued.pending, true);
  f.settle(f.writes[0]); await oldPending; const readsBeforeCurrentSettles=[...f.reads];
  f.settle(f.writes[1]); await currentPending;
  assert.deepEqual(readsBeforeCurrentSettles, ['synthetic-A','synthetic-B']);
  assert.deepEqual(f.reads, ['synthetic-A','synthetic-B','synthetic-C']); assert.equal(f.controller.availability, 'ready');
});

test('resource: reset with no replacement RPC restores the abandoned caption', async () => {
  const { f,pending } = await start(); f.controller.reset(); await f.setOrganization('synthetic-B'); f.fill('Synthetic group B');
  f.settle(f.writes[0]); await pending; assert.equal(f.node('resourceSubmit').textContent, 'Save synthetic A');
  assert.equal(f.draft(), 'Synthetic group B'); assert.equal(f.writes.length, 1);
});

for (const result of ['success','known-error','unknown']) test('resource: current ' + result + ' retains ordinary submit behavior', async () => {
  const { f,pending } = await start(); f.settle(f.writes[0], result); await pending;
  assert.equal(f.controller.availability, 'ready'); assert.equal(f.writes.length, 1);
  assert.equal(f.draft(), result === 'success' ? '' : 'Synthetic group A');
  assert.equal(f.node('resourceSubmit').textContent, 'Save synthetic A');
  if (result === 'success') assert.equal(f.notices.at(-1), 'Группа ресурсов создана');
  else { assert.equal(f.node('resourceGroupError').hidden, false); assert.ok(f.node('resourceGroupError').textContent); }
});

test('resource: queued organization still loads after its own RPC settles', async () => {
  const { f,pending } = await start(); const queued=await f.setOrganization('synthetic-B'); assert.equal(queued.pending, true);
  f.settle(f.writes[0]); await pending; assert.deepEqual(f.reads, ['synthetic-A','synthetic-B']);
  f.fill('Synthetic group B'); const next=f.submit(); assert.equal(f.writes.length, 2); f.settle(f.writes[1]); await next;
  assert.equal(f.draft(), ''); assert.equal(f.controller.availability, 'ready');
});

test('resource: routine same-organization callback keeps the current write', async () => {
  const { f,pending } = await start(); const result=await f.setOrganization('synthetic-A'); assert.equal(result.skipped, true);
  f.settle(f.writes[0]); await pending; assert.equal(f.draft(), ''); assert.equal(f.notices.at(-1), 'Группа ресурсов создана');
});

for (const transition of ['organization','session-reset']) test('resource: mismatch refresh cannot notify a new ' + transition + ' context', async () => {
  const { f,pending } = await start(); f.armRead(); f.writes[0].gate.resolve({ data:f.workspace('synthetic-foreign'),error:null }); await f.readEntered.promise;
  if (transition === 'session-reset') { f.changeSession(); f.controller.reset(); }
  await f.setOrganization('synthetic-B'); f.fill('Synthetic group B'); const mark=f.notices.length;
  f.readOutcome.resolve({ data:f.workspace('synthetic-A'),error:null }); await pending;
  assert.equal(f.notices.length, mark); assert.equal(f.draft(), 'Synthetic group B'); assert.equal(f.controller.availability, 'ready');
});

test('resource: current mismatch still reloads and explains the unaccepted response', async () => {
  const { f,pending } = await start(); f.writes[0].gate.resolve({ data:f.workspace('synthetic-foreign'),error:null }); await pending;
  assert.equal(f.notices.at(-1), 'Ответ сервера не соответствует выбранной организации. Изменение перепроверено.');
  assert.equal(f.draft(), 'Synthetic group A'); assert.deepEqual(f.reads, ['synthetic-A','synthetic-A']);
});
