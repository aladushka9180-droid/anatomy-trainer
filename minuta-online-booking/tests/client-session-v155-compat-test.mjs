// Exercise the actual client controller with synthetic ports, without network or
// accounts. The browser companion covers the real HTML, SDK and DOM separately.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(process.env.MINUTA_CLIENT_SESSION_SOURCE ||
  fileURLToPath(new URL('../my-bookings.js', import.meta.url)), 'utf8');
const entry = source.lastIndexOf("document.querySelectorAll('[data-social-auth-login]')");
assert.ok(entry > 0, 'controller bootstrap boundary is present');
const token = 'a'.repeat(64);
const management = '11111111-1111-4111-8111-111111111111';
const expires = '2099-01-01T00:00:00Z';
const booking = { manage_token:management, booking_code:'SYNTHETIC', service_name:'Legacy visit',
  service_id:'22222222-2222-4222-8222-222222222222', service_active:false,
  performer_name:'Synthetic provider', booking_date:'2098-01-01', booking_time:'12:00',
  duration_minutes:60, price_rub:1000, status:'completed', review_eligible:true };

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(respond) {
  const elements = new Map();
  function element(selector) {
    if (!elements.has(selector)) elements.set(selector, {
      hidden:true, disabled:false, textContent:'', innerHTML:'', value:'', open:false,
      replaceChildren() { this.innerHTML = ''; this.textContent = ''; },
      close() { this.open = false; }, showModal() { this.open = true; },
      scrollIntoView() {}, removeAttribute(name) { delete this[name]; }
    });
    return elements.get(selector);
  }
  const session = new Map([['minuta-client-session-v1', token]]);
  element('#clientLoginCard').hidden = false;
  element('#clientRotateCode').hidden = false;
  element('.client-account-tools a[href="messages.html"]').hidden = false;
  const local = new Map();
  const storage = map => ({ getItem:key => map.get(key) ?? null,
    setItem:(key,value) => map.set(key,String(value)), removeItem:key => map.delete(key) });
  const calls = [];
  const db = { rpc:(name,body) => {
    calls.push({name,body});
    return respond(name,body);
  }, auth:{ getSession:async () => ({data:{session:null}}), signOut:async () => ({error:null}) } };
  const context = vm.createContext({
    window:{supabase:{createClient:() => db},MINUTA_CONFIG:{supabaseUrl:'https://fixture.invalid',supabaseKey:'synthetic'}},
    document:{querySelector:element,querySelectorAll:() => []},
    sessionStorage:storage(session),localStorage:storage(local),
    navigator:{onLine:true,userAgent:'synthetic'},URL,URLSearchParams,
    location:{href:'https://fixture.invalid/my-bookings.html'},
    setTimeout:() => 0,clearTimeout() {},confirm:() => true,console
  });
  vm.runInContext(source.slice(0, entry), context);
  return { element, calls, session, local, auth:db.auth, run:code => vm.runInContext(code, context) };
}

function respondWith(account, items = []) {
  return name => {
    if (name === 'restore_client_session') return {data:[account],error:null};
    if (name === 'get_client_bookings_v3') return {data:items,error:null};
    if (name === 'revoke_client_session') return {data:true,error:null};
    throw new Error(`Unexpected RPC: ${name}`);
  };
}

test('v155 booking session opens without a phone and never invents management or review actions', async () => {
  const f = fixture(respondWith({normalized_phone:null,session_expires_at:expires},
    [{...booking,manage_token:null,service_name:'Scoped visit'}]));
  assert.equal(await f.run('openAccount()'), true);
  assert.equal(f.element('#clientBookingsCard').hidden, false);
  assert.equal(f.element('#clientRestoreCard').hidden, true);
  assert.match(f.element('#clientAccountPhone').textContent, /личной ссылке/);
  assert.match(f.element('#clientBookingsList').innerHTML, /Scoped visit/);
  assert.doesNotMatch(f.element('#clientBookingsList').innerHTML, /token=null|booking\.html|data-open-review|messages\.html/);
  assert.equal(f.element('#clientRotateCode').hidden, true);
  f.run("openReview('null')");
  assert.equal(f.element('#reviewDialog').open, false);
  assert.equal(f.session.get('minuta-client-session-v1'), token);
  assert.equal(f.local.has('minuta-client-session-v1'), false);
});

test('legacy session retains the phone, management link and review action', async () => {
  const f = fixture(respondWith({normalized_phone:'79990000000',session_expires_at:expires},[booking]));
  assert.equal(await f.run('openAccount()'), true);
  assert.match(f.element('#clientAccountPhone').textContent, /999/);
  assert.match(f.element('#clientBookingsList').innerHTML, new RegExp(`token=${management}`));
  assert.match(f.element('#clientBookingsList').innerHTML, /data-open-review/);
  assert.equal(f.element('#clientRotateCode').hidden, false);
});

for (const account of [null,{}, {session_expires_at:expires},
  {normalized_phone:'',session_expires_at:expires},
  {normalized_phone:123,session_expires_at:expires},
  {normalized_phone:null,session_expires_at:123},
  {normalized_phone:null,session_expires_at:'invalid'}]) {
  test(`malformed restore remains unconfirmed and preserves the token: ${JSON.stringify(account)}`, async () => {
    const f = fixture(respondWith(account));
    assert.equal(await f.run('openAccount()'), false);
    assert.equal(f.element('#clientBookingsCard').hidden, true);
    assert.equal(f.session.get('minuta-client-session-v1'), token);
    assert.equal(f.calls.length, 1);
  });
}

for (const error of [{code:'42501',message:'denied'},{status:503,message:'unavailable'}]) {
  test(`a failed current RPC cannot downgrade to an older API: ${JSON.stringify(error)}`, async () => {
    const f = fixture(name => name === 'restore_client_session'
      ? {data:[{normalized_phone:'79990000000',session_expires_at:expires}],error:null}
      : {data:null,error});
    await f.run('openAccount()');
    assert.deepEqual(f.calls.map(x => x.name), ['restore_client_session','get_client_bookings_v3']);
    assert.equal(f.element('#clientBookingsError').hidden, false);
  });
}

test('a known booking-scoped session cannot fall back even when v3 is missing', async () => {
  const f = fixture(name => name === 'restore_client_session'
    ? {data:[{normalized_phone:null,session_expires_at:expires}],error:null}
    : {data:null,error:{code:'PGRST202',message:'function missing'}});
  await f.run('openAccount()');
  assert.deepEqual(f.calls.map(x => x.name), ['restore_client_session','get_client_bookings_v3']);
});

test('legacy compatibility permits a missing-function fallback', async () => {
  const f = fixture(name => {
    if (name === 'restore_client_session') return {data:[{normalized_phone:'79990000000',session_expires_at:expires}],error:null};
    if (name === 'get_client_bookings_v3') return {data:null,error:{code:'PGRST202'}};
    if (name === 'get_client_bookings_v2') return {data:[booking],error:null};
    throw new Error(name);
  });
  await f.run('openAccount()');
  assert.deepEqual(f.calls.map(x => x.name), ['restore_client_session','get_client_bookings_v3','get_client_bookings_v2']);
  assert.match(f.element('#clientBookingsList').innerHTML, /Legacy visit/);
});

test('logout revokes the departing token and a late read cannot restore private data', async () => {
  const held = deferred(); let hold = false;
  const normal = respondWith({normalized_phone:'79990000000',session_expires_at:expires},[booking]);
  const f = fixture(name => hold && name === 'get_client_bookings_v3' ? held.promise : normal(name));
  await f.run('openAccount()');
  hold = true;
  const read = f.run('loadBookings()');
  await f.run('logout()');
  held.resolve({data:[booking],error:null});
  assert.equal(await read, false);
  assert.equal(f.element('#clientBookingsList').innerHTML, '');
  assert.equal(f.element('#clientAccountPhone').textContent, '');
  assert.equal(f.element('#clientLoginCard').hidden, false);
  assert.equal(f.session.has('minuta-client-session-v1'), false);
  assert.ok(f.calls.some(x => x.name === 'revoke_client_session' && x.body.p_session_token === token));
});

test('a previous session read cannot overwrite a new scoped session', async () => {
  const held = deferred(); let hold = false;
  const f = fixture((name,body) => {
    if (name === 'restore_client_session') return {data:[{normalized_phone:body.p_session_token===token?'79990000000':null,session_expires_at:expires}],error:null};
    if (name === 'get_client_bookings_v3') return hold && body.p_session_token===token
      ? held.promise : {data:[{...booking,manage_token:null,service_name:'New scoped visit'}],error:null};
    throw new Error(name);
  });
  await f.run('openAccount()');
  hold = true; const old = f.run('loadBookings()');
  await f.run('logout({localOnly:true})');
  f.run(`saveSessionToken('${'b'.repeat(64)}')`);
  await f.run('openAccount()');
  held.resolve({data:[booking],error:null});
  assert.equal(await old, false);
  assert.match(f.element('#clientBookingsList').innerHTML, /New scoped visit/);
  assert.doesNotMatch(f.element('#clientBookingsList').innerHTML, /Legacy visit/);
});

test('an empty restore response clears a confirmed invalid or revoked session', async () => {
  const f = fixture(() => ({data:[],error:null}));
  assert.equal(await f.run('openAccount()'), false);
  assert.equal(f.session.has('minuta-client-session-v1'), false);
  assert.equal(f.element('#clientLoginCard').hidden, false);
});

test('logout consumes the lazy PostgREST revocation request after hiding private UI', async () => {
  let revoked = false;
  let f;
  const normal = respondWith({normalized_phone:'79990000000',session_expires_at:expires},[booking]);
  f = fixture(name => name === 'revoke_client_session' ? {
    then(resolve) {
      assert.equal(f.element('#clientBookingsCard').hidden, true);
      assert.equal(f.session.has('minuta-client-session-v1'), false);
      revoked = true;
      resolve({data:true,error:null});
    }
  } : normal(name));
  await f.run('openAccount()');
  await f.run('logout()');
  assert.equal(revoked, true, 'SDK builder must be consumed to send revocation');
});

test('a delayed old revocation cannot sign out the next client session', async () => {
  const held = deferred();
  const normal = respondWith({normalized_phone:'79990000000',session_expires_at:expires});
  const f = fixture(name => name === 'revoke_client_session' ? held.promise : normal(name));
  let authReads = 0;
  f.auth.getSession = async () => { authReads += 1; return {data:{session:{user:{id:'new-client'}}}}; };
  f.auth.signOut = async () => { throw new Error('Must not sign out the new identity'); };
  await f.run('openAccount()');
  const logout = f.run('logout()');
  f.run(`saveSessionToken('${'b'.repeat(64)}')`);
  await f.run('openAccount()');
  held.resolve({data:true,error:null});
  await logout;
  assert.equal(authReads, 0);
  assert.equal(f.session.get('minuta-client-session-v1'), 'b'.repeat(64));
  assert.equal(f.element('#clientBookingsCard').hidden, false);
});

test('failed remote revocation leaves the local account signed out', async () => {
  const normal = respondWith({normalized_phone:'79990000000',session_expires_at:expires});
  const f = fixture(name => name === 'revoke_client_session' ? Promise.reject(new Error('offline')) : normal(name));
  await f.run('openAccount()');
  await f.run('logout()');
  assert.equal(f.session.has('minuta-client-session-v1'), false);
  assert.equal(f.element('#clientLoginCard').hidden, false);
  assert.equal(f.element('#clientBookingsCard').hidden, true);
});
