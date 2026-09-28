import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../provider.js', import.meta.url), 'utf8');
function actual(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, name);
  const next = source.slice(start + 1).search(/^(?:async )?function /m);
  return source.slice(start, next < 0 ? undefined : start + next + 1);
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function fixture({ auth, access, sync, trust = 'cached', online = true } = {}) {
  const calls = [], messages = [];
  const button = { disabled:false, classList:{add() {}, remove() {}} };
  const box = vm.createContext({
    currentUser:{id:'provider-1'}, sessionGeneration:1, providerSessionTrust:trust,
    navigator:{onLine:online}, manualSynchronizationPromise:null, synchronizationPromise:null,
    cachedProviderVerification:null, cachedProviderVerificationRetryTimer:null,
    connectionGuidanceOutageObserved:false, bookingCreationReady:false,
    offlineBookingAccessReady:false, offlineBookingInputsReady:false,
    offlineBookingSnapshotFresh:() => false,
    pendingBookingColors:new Map(), pendingBookingNotes:new Map(),
    pendingClientLabels:new Map(), pendingClientNotes:new Map(),
    $:() => button, notify:text => messages.push(text), recordConnectionEvent() {},
    clearTimeout() {}, setTimeout() {calls.push('retry'); return 1;},
    db:{auth:{async getSession() {
      calls.push('auth');
      return auth ? auth(box) : {data:{session:{user:{id:'provider-1'}}}, error:null};
    }}},
    async providerAccessAllowed() {calls.push('access'); return access ? access(box) : true;},
    async handleSession() {calls.push('verified'); box.providerSessionTrust = 'verified'; box.sessionGeneration++;},
    async rejectCachedProviderSession() {calls.push('rejected'); box.currentUser = null; box.providerSessionTrust = 'none'; box.sessionGeneration++;},
    authTemporarilyUnavailable:error => error?.status >= 500,
    async synchronizeProvider() {calls.push('sync'); return sync ? sync(box) : true;},
    async flushOfflineBookings() {calls.push('flush');},
    sessionIsCurrent:(userId, generation) => box.currentUser?.id === userId && box.sessionGeneration === generation
  });
  vm.runInContext(actual('manualSynchronizeProvider') + '\n' + actual('verifyCachedProviderSession'), box);
  return {box, calls, messages, button};
}

test('manual recovery confirms cached session and access before refreshing schedule', async () => {
  const {box, calls, messages, button} = fixture();
  assert.equal(await box.manualSynchronizeProvider(), true);
  assert.deepEqual(calls, ['auth', 'access', 'verified', 'sync']);
  assert.equal(box.providerSessionTrust, 'verified');
  assert.equal(messages.at(-1), 'Все данные обновлены');
  assert.equal(button.disabled, false);
});

test('manual cached retry shares the in-flight verification and double clicks', async () => {
  const auth = deferred();
  const {box, calls, button} = fixture({auth:() => auth.promise});
  const background = box.verifyCachedProviderSession('provider-1');
  const first = box.manualSynchronizeProvider();
  const second = box.manualSynchronizeProvider();
  assert.equal(button.disabled, true);
  assert.deepEqual(calls, ['auth']);
  auth.resolve({data:{session:{user:{id:'provider-1'}}},error:null});
  await background;
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.deepEqual(calls, ['auth', 'access', 'verified', 'sync']);
  assert.equal(button.disabled, false);
});

for (const [name, options] of [
  ['temporary auth failure', {auth:async () => ({error:{status:503}})}],
  ['temporary access failure', {access:async () => null}]
]) test(`${name} keeps cached data and does not refresh or flush`, async () => {
  const {box, calls, messages, button} = fixture(options);
  assert.equal(await box.manualSynchronizeProvider(), false);
  assert.equal(box.providerSessionTrust, 'cached');
  assert.equal(calls.includes('sync'), false);
  assert.equal(calls.includes('flush'), false);
  assert.equal(calls.includes('rejected'), false);
  assert.equal(calls.filter(value => value === 'retry').length, 1);
  assert.match(messages.at(-1), /Не удалось подтвердить сеанс/);
  assert.equal(button.disabled, false);
});

for (const [name, options] of [
  ['expired login', {auth:async () => ({error:{status:400}})}],
  ['access denied', {access:async () => false}],
  ['different auth user', {auth:async () => ({data:{session:{user:{id:'provider-2'}}},error:null})}]
]) test(`${name} cannot proceed to schedule or queued writes`, async () => {
  const {box, calls, button} = fixture(options);
  assert.equal(await box.manualSynchronizeProvider(), false);
  assert.equal(box.providerSessionTrust, 'none');
  assert.equal(calls.includes('sync'), false);
  assert.equal(calls.includes('flush'), false);
  assert.equal(button.disabled, false);
});

test('account change during auth does not refresh the replacement account', async () => {
  const auth = deferred();
  const {box, calls, messages} = fixture({auth:() => auth.promise});
  const result = box.manualSynchronizeProvider();
  box.currentUser = {id:'provider-2'};
  box.providerSessionTrust = 'verified';
  box.sessionGeneration++;
  auth.resolve({data:{session:{user:{id:'provider-1'}}},error:null});
  assert.equal(await result, false);
  assert.deepEqual(calls, ['auth']);
  assert.deepEqual(messages, []);
});

test('session replacement while waiting for existing sync cancels manual follow-up', async () => {
  const waiting = deferred();
  const {box, calls, messages} = fixture({trust:'verified'});
  box.synchronizationPromise = waiting.promise;
  const result = box.manualSynchronizeProvider();
  box.sessionGeneration++;
  waiting.resolve(false);
  assert.equal(await result, false);
  assert.deepEqual(calls, []);
  assert.deepEqual(messages, []);
});

test('logout during refresh cannot flush another session or announce success', async () => {
  const {box, calls, messages} = fixture({trust:'verified', sync:async context => {
    context.currentUser = null; context.sessionGeneration++; context.bookingCreationReady = true;
    return true;
  }});
  assert.equal(await box.manualSynchronizeProvider(), false);
  assert.deepEqual(calls, ['sync']);
  assert.deepEqual(messages, []);
});

test('verified online refresh and actual offline behavior remain unchanged', async () => {
  const online = fixture({trust:'verified'});
  assert.equal(await online.box.manualSynchronizeProvider(), true);
  assert.deepEqual(online.calls, ['sync']);
  const offline = fixture({online:false});
  assert.equal(await offline.box.manualSynchronizeProvider(), false);
  assert.deepEqual(offline.calls, []);
  assert.deepEqual(offline.messages, ['Нет интернета · проверьте подключение']);
});
