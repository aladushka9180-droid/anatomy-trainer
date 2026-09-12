import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../provider.js', import.meta.url), 'utf8');
function actual(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, name);
  const next = source.slice(start + 1).search(/^(?:(?:async )?function |const providerAuthStorage(?:Key)?\b)/m);
  return source.slice(start, next < 0 ? undefined : start + next + 1);
}
function storageFixture(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

const validSession = JSON.stringify({
  access_token:'header.payload.signature',
  refresh_token:'refresh-token',
  user:{ id:'provider-1', email:'provider@example.invalid', user_metadata:{ display_name:'Fixture' } }
});

test('provider auth storage keeps a trusted offline identity without exposing tokens', () => {
  const box = vm.createContext({ window:{}, Object, JSON, Number });
  vm.runInContext([actual('parsePersistedProviderSession'), actual('createProviderAuthStorage')].join('\n'), box);
  const storage = storageFixture({ 'unrelated':'{}', 'sb-project-auth-token':validSession });
  const authStorage = box.createProviderAuthStorage(storage, 'sb-project-auth-token');
  assert.deepEqual(JSON.parse(JSON.stringify(authStorage.cachedSession())), {
    user:{ id:'provider-1', email:'provider@example.invalid', user_metadata:{ display_name:'Fixture' } }
  });
  assert.equal('access_token' in authStorage.cachedSession(), false);
  authStorage.removeItem('sb-project-auth-token');
  assert.equal(authStorage.cachedSession().user.id, 'provider-1', 'a retryable SDK cleanup must not erase the in-memory offline identity');
  assert.equal(storage.getItem('sb-project-auth-token'), validSession, 'temporary fallback must restore the SDK session for a later offline reload');
  authStorage.forget();
  assert.equal(authStorage.cachedSession(), null, 'explicit logout can forget the offline identity');
});

test('provider auth storage rejects an unsigned user-only cache entry', () => {
  const box = vm.createContext({ window:{}, Object, JSON, Number });
  vm.runInContext([actual('parsePersistedProviderSession'), actual('createProviderAuthStorage')].join('\n'), box);
  const authStorage = box.createProviderAuthStorage(storageFixture({ forged:JSON.stringify({ user:{ id:'provider-1' } }) }), 'forged');
  assert.equal(authStorage.cachedSession(), null);
});

test('startup opens the trusted local session before any auth network wait', async () => {
  const cached = { user:{ id:'provider-1' } };
  let handled = null;
  const order = [];
  let authCalls = 0;
  let verificationCalls = 0;
  const box = vm.createContext({
    recoveryMode:false,
    providerAuthStorage:{ cachedSession:() => cached },
    handleSession:(session, options) => {
      order.push('local-dashboard');
      handled = { session, options };
      return new Promise(() => {});
    },
    verifyCachedProviderSession:() => { order.push('server-verification'); verificationCalls += 1; },
    db:{ auth:{ getSession:() => { authCalls += 1; return new Promise(() => {}); } } },
    document:{ documentElement:{ classList:{ contains:() => false } } },
    showProviderStartupFailure() {},
    showRecoveryReset() {},
    cachedProviderSessionAfterTemporaryFailure() { return null; },
    setSyncState() {}
  });
  vm.runInContext(actual('startProviderSession'), box);
  box.startProviderSession();
  assert.equal(handled?.session, cached);
  assert.equal(handled?.options?.cachedOnly, true);
  assert.equal(authCalls, 0, 'the blocking auth request must not replace the cached-session path');
  assert.equal(verificationCalls, 1, 'server verification must continue after the local dashboard opens');
  assert.deepEqual(order, ['local-dashboard', 'server-verification']);
});

test('cached-only session path cannot start remote synchronization', () => {
  const handler = actual('handleSession');
  assert.match(handler, /cachedOnly \? null : accessVerified \? true/);
  assert.match(handler, /if \(localSessionOnly\) \{[\s\S]*?return;[\s\S]*?\}\s*if \(navigator\.onLine && !bookingsChannel\) startLiveUpdates/);
  assert.match(actual('canQueueOfflineBooking'), /offlineBookingAccessReady/);
});

test('a cached identity can queue only from a complete server-verified offline snapshot', () => {
  const box = vm.createContext({
    providerSessionTrust:'cached',
    currentUser:{ id:'provider-1' },
    navigator:{ onLine:false },
    offlineBookingInputsReady:true,
    offlineBookingAccessReady:false,
    offlineBookingSnapshotFresh:() => true,
    ownServices:[{ active:true }],
    Boolean
  });
  vm.runInContext(actual('canQueueOfflineBooking'), box);
  assert.equal(box.canQueueOfflineBooking(), false);
  box.offlineBookingAccessReady = true;
  assert.equal(box.canQueueOfflineBooking(), true);
  box.offlineBookingSnapshotFresh = () => false;
  assert.equal(box.canQueueOfflineBooking(), false);
  box.offlineBookingSnapshotFresh = () => true;
  box.providerSessionTrust = 'none';
  assert.equal(box.canQueueOfflineBooking(), false);
});

test('cross-tab explicit logout revokes cached offline writes and removes device data', async () => {
  const calls = [];
  const box = vm.createContext({
    currentUser:{ id:'provider-1' },
    providerSessionTrust:'cached',
    offlineBookingInputsReady:true,
    offlineBookingAccessReady:true,
    cachedProviderVerificationRetryTimer:1,
    providerAuthStorageKey:'sb-fixture-auth-token',
    clearTimeout:() => calls.push('timer-cleared'),
    providerAuthStorage:{
      forget:() => calls.push('forgotten'),
      removeItem:key => calls.push(`removed:${key}`)
    },
    setWritesAllowed:value => calls.push(`writes:${value}`),
    setBookingCreationReady:value => calls.push(`booking:${value}`),
    handleSession:async session => { calls.push(`session:${session}`); box.currentUser = null; },
    clearProviderDeviceData:async userId => calls.push(`cleared:${userId}`),
    db:{ auth:{ signOut:async options => calls.push(`signout:${options.scope}`) } }
  });
  vm.runInContext(actual('applyProviderLogoutSignal'), box);
  assert.equal(await box.applyProviderLogoutSignal('provider-1'), true);
  assert.equal(box.providerSessionTrust, 'none');
  assert.equal(box.offlineBookingInputsReady, false);
  assert.equal(box.offlineBookingAccessReady, false);
  assert.deepEqual(calls, [
    'timer-cleared', 'forgotten', 'removed:sb-fixture-auth-token', 'writes:false', 'booking:false',
    'session:null', 'cleared:provider-1', 'signout:local'
  ]);
  assert.match(actual('logout'), /broadcastProviderLogout\(userId\)[\s\S]*providerAuthStorage\.forget\(\)/);
  assert.match(source, /window\.addEventListener\('storage'[\s\S]*applyProviderLogoutSignal\(signal\.userId\)/);
});

test('a failed background access probe keeps cached mode and schedules one retry', async () => {
  let retries = 0;
  let upgrades = 0;
  let rejections = 0;
  const box = vm.createContext({
    providerSessionTrust:'cached',
    currentUser:{ id:'provider-1' },
    cachedProviderVerification:null,
    cachedProviderVerificationRetryTimer:null,
    clearTimeout() {},
    setTimeout() { retries += 1; return 1; },
    navigator:{ onLine:true },
    db:{ auth:{ getSession:async () => ({ data:{ session:{ user:{ id:'provider-1' } } }, error:null }) } },
    authTemporarilyUnavailable:() => true,
    providerAccessAllowed:async () => { throw new TypeError('Failed to fetch'); },
    rejectCachedProviderSession:async () => { rejections += 1; },
    handleSession:async () => { upgrades += 1; }
  });
  vm.runInContext(actual('verifyCachedProviderSession'), box);
  await box.verifyCachedProviderSession('provider-1');
  assert.equal(box.providerSessionTrust, 'cached');
  assert.equal(upgrades, 0);
  assert.equal(rejections, 0);
  assert.equal(retries, 1);
});

for (const [name, online, error, expected] of [
  ['offline start', false, null, true],
  ['retryable fetch', true, { name:'AuthRetryableFetchError' }, true],
  ['server outage', true, { status:503 }, true],
  ['rate limit', true, { status:429 }, true],
  ['invalid refresh token', true, { status:400, code:'refresh_token_not_found' }, false]
]) test(`cached provider session fallback: ${name}`, () => {
  const cached = { user:{ id:'provider-1' } };
  const box = vm.createContext({
    navigator:{ onLine:online },
    providerAuthStorage:{ cachedSession:() => cached },
    Number
  });
  vm.runInContext([
    actual('authConnectionFailed'),
    actual('authTemporarilyUnavailable'),
    actual('cachedProviderSessionAfterTemporaryFailure')
  ].join('\n'), box);
  assert.equal(box.cachedProviderSessionAfterTemporaryFailure(error) === cached, expected);
});

test('provider access check distinguishes a temporary outage from a denied account', async () => {
  const chain = result => ({
    select() { return this; },
    eq() { return this; },
    limit:async () => result,
    maybeSingle:async () => result
  });
  const run = async ({ capability, membership, profile }) => {
    const box = vm.createContext({
      db:{
        rpc:async () => capability,
        from:name => chain(name === 'organization_memberships' ? membership : profile)
      }
    });
    vm.runInContext(actual('providerAccessAllowed'), box);
    return box.providerAccessAllowed('provider-1');
  };
  assert.equal(await run({ capability:{ error:{ status:503 } }, membership:{ error:{ status:503 } }, profile:{ error:{ status:503 } } }), null);
  assert.equal(await run({ capability:{ error:{ status:503 } }, membership:{ error:{ status:503 } }, profile:{ data:null, error:null } }), null);
  assert.equal(await run({ capability:{ data:false, error:null }, membership:{}, profile:{} }), false);
  assert.equal(await run({ capability:{ error:{ code:'PGRST202' } }, membership:{ data:[], error:null }, profile:{ data:{ id:'provider-1' }, error:null } }), true);
});

test('bundled Supabase client leaves a trusted offline identity available when refresh transport fails', async () => {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const accessToken = `${encode({ alg:'HS256', typ:'JWT' })}.${encode({ sub:'provider-1', exp:1, aud:'authenticated' })}.fixture`;
  const storage = storageFixture({
    'sb-auth-resilience-auth-token':JSON.stringify({
      access_token:accessToken,
      refresh_token:'refresh-token',
      expires_at:1,
      token_type:'bearer',
      user:{ id:'provider-1', email:'provider@example.invalid', aud:'authenticated', role:'authenticated' }
    })
  });
  const helper = vm.createContext({ window:{}, Object, JSON, Number });
  vm.runInContext([actual('parsePersistedProviderSession'), actual('createProviderAuthStorage')].join('\n'), helper);
  const authStorage = helper.createProviderAuthStorage(storage, 'sb-auth-resilience-auth-token');
  const sdk = {
    console:{ log(){}, warn(){}, error(){} }, fetch:async () => { throw new TypeError('Failed to fetch'); }, Headers, Request, Response, URL,
    AbortController, DOMException, setTimeout:(callback, _delay, ...args) => setTimeout(callback, 0, ...args), clearTimeout, setInterval, clearInterval,
    crypto:globalThis.crypto, atob, btoa, WebSocket:class {}, document:{ visibilityState:'visible', addEventListener(){} }
  };
  vm.createContext(sdk);
  vm.runInContext(readFileSync(new URL('../vendor/supabase-2.112.4.min.js', import.meta.url), 'utf8'), sdk);
  const client = sdk.supabase.createClient('https://auth-resilience.supabase.co', 'fixture-key', {
    auth:{ persistSession:true, autoRefreshToken:false, detectSessionInUrl:false, storage:authStorage }
  });
  const result = await client.auth.getSession();
  assert.ok(result.error, 'expired session must attempt a server refresh');
  assert.equal(authStorage.cachedSession()?.user?.id, 'provider-1');
  await client.auth.dispose();
});
