import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const root = new URL('./', import.meta.url);
const provider = await readFile(new URL('provider.js',root),'utf8');
const storageRuntime = provider.slice(
  provider.indexOf('function clientPageSettingsStorageKey'),
  provider.indexOf('function settingsForClientLink')
);
const queueRuntime = provider.slice(
  provider.indexOf('function enqueueClientAppearanceServerSave'),
  provider.indexOf('async function saveClientAppearanceSettings')
);

assert.ok(storageRuntime.startsWith('function clientPageSettingsStorageKey'));
assert.ok(queueRuntime.startsWith('function enqueueClientAppearanceServerSave'));

function createRuntime() {
  const storage = new Map();
  const rpcCalls = [];
  const state = {
    currentUser:{ id:'user-1' },
    sessionGeneration:1,
    activeOrganization:{ id:'org-1',current_role:'owner' },
  };
  const context = vm.createContext({
    console,
    localStorage:{
      getItem:key => storage.get(key) ?? null,
      setItem:(key,value) => storage.set(key,String(value)),
    },
    __state:state,
    __rpcCalls:rpcCalls,
  });
  vm.runInContext(`
    let currentUser = __state.currentUser;
    let sessionGeneration = __state.sessionGeneration;
    let clientPageSettingsSaveRevision = 0;
    let clientPageSettingsSaveQueue = Promise.resolve();
    const clientPageSettingsQueuedRevisions = new Map();
    let clientPageSettings = { theme_key:'sage',headline_key:'massage-time' };
    const organizationController = { getActiveOrganization:() => __state.activeOrganization };
    const sessionIsCurrent = (userId,generation) => currentUser?.id === userId && sessionGeneration === generation;
    const db = { rpc:async (name,args) => {
      __rpcCalls.push({ name,args });
      return { data:{ ...args,updated_at:'2026-09-06T00:00:00Z' },error:null };
    } };
    const $ = () => null;
    const notify = () => {};
    const isMissingRpc = () => false;
    const normalizeClientPageSettings = value => ({
      theme_key:value?.theme_key || 'sage',
      headline_key:value?.headline_key || 'massage-time',
    });
    const updateProviderClientLinks = () => {};
    ${storageRuntime}
    ${queueRuntime}
    globalThis.api = {
      read:readLocalClientPageSettings,
      write:writeLocalClientPageSettings,
      enqueue:enqueueClientAppearanceServerSave,
      nextRevision:() => ++clientPageSettingsSaveRevision,
      revision:() => clientPageSettingsSaveRevision,
      setUser:value => { currentUser=value; },
      setGeneration:value => { sessionGeneration=value; },
    };
  `,context);
  return { api:context.api,state,storage,rpcCalls };
}

{
  const { api } = createRuntime();
  api.write('org-1',{ theme_key:'sage',headline_key:'care',local_revision:41,sync_status:'pending' });
  const stored = api.read('org-1');
  assert.equal(stored.local_revision,41);
  assert.equal(api.revision(),41);
  assert.equal(api.nextRevision(),42,'a save after reload must not reuse the pending revision');
}

for (const scenario of [
  { name:'user changed',mutate:runtime => { runtime.api.setUser({ id:'user-2' }); } },
  { name:'session changed',mutate:runtime => { runtime.api.setGeneration(2); } },
  { name:'organization changed',mutate:runtime => { runtime.state.activeOrganization={ id:'org-2',current_role:'owner' }; } },
  { name:'owner role lost',mutate:runtime => { runtime.state.activeOrganization={ id:'org-1',current_role:'admin' }; } },
]) {
  const runtime = createRuntime();
  const organization = runtime.state.activeOrganization;
  const stored = { theme_key:'sage',headline_key:'care',local_revision:7,sync_status:'pending' };
  runtime.api.write(organization.id,stored);
  const operation = runtime.api.enqueue(organization,stored,{ silent:true });
  scenario.mutate(runtime);
  const result = await operation;
  assert.deepEqual({ pending:result.pending,reason:result.reason },{ pending:true,reason:'context_changed' },scenario.name);
  assert.equal(runtime.rpcCalls.length,0,`${scenario.name}: stale queue item must not call RPC`);
  const persisted = JSON.parse(runtime.storage.get(`minuta-provider-client-page-v1:user-1:${organization.id}`));
  assert.equal(persisted.sync_status,'pending',`${scenario.name}: local save must remain pending`);
}

{
  const runtime = createRuntime();
  const organization = runtime.state.activeOrganization;
  const stored = { theme_key:'sage',headline_key:'care',local_revision:9,sync_status:'pending' };
  runtime.api.write(organization.id,stored);
  const result = await runtime.api.enqueue(organization,stored,{ silent:true });
  assert.equal(result.ok,true);
  assert.equal(runtime.rpcCalls.length,1,'current owner context must call RPC once');
  assert.equal(runtime.api.read(organization.id).sync_status,'confirmed');
}

console.log('Client page settings v118 queue regression checks passed.');
