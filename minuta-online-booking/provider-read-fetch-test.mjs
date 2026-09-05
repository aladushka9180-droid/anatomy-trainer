import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const source = read('provider-read-fetch.js');
const baseUrl = 'https://read-test.supabase.co';
function harness(fetcher, options = {}) {
  const window = { navigator:{ onLine:true } };
  const document = { hidden:false };
  const math = Object.create(Math);
  math.random = () => 0;
  vm.runInNewContext(source, { window, document, URL, Response, AbortController, DOMException, Math:math, setTimeout, clearTimeout });
  return { window, document, api:window.MinutaProviderReadFetch,
    fetch:window.MinutaProviderReadFetch.create({ baseUrl, fetcher, timeoutMs:20, retryDelayMs:0, ...options }) };
}
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers:{ 'content-type':'application/json', 'content-range':'0-0/1' } });

{
  let calls = 0;
  const h = harness(async (url, init) => {
    calls++;
    assert.equal(init.headers.authorization, 'Bearer test');
    assert.ok(init.signal instanceof AbortSignal);
    return json([{ id:'one' }]);
  });
  const result = await h.fetch(`${baseUrl}/rest/v1/bookings?select=id`, { headers:{ authorization:'Bearer test' } });
  assert.deepEqual(await result.json(), [{ id:'one' }]);
  assert.equal(result.headers.get('content-range'), '0-0/1');
  assert.equal(calls, 1);
}
for (const status of [401, 403, 404, 400, 429]) {
  let calls = 0;
  const h = harness(async () => { calls++; return json({ code:'original' }, status); });
  const result = await h.fetch(`${baseUrl}/rest/v1/bookings`);
  assert.equal(result.status, status);
  assert.equal(calls, 1, 'permissions, schema and rate limits must not be retried');
}
for (const failure of ['headers', 'body', 'network', 'http']) {
  let calls = 0;
  let aborted = 0;
  const h = harness(async (url, init) => {
    calls++;
    init.signal.addEventListener('abort', () => { aborted++; });
    if (failure === 'network') throw new TypeError('Failed to fetch');
    if (failure === 'http') return json({}, 503);
    if (failure === 'headers') return new Promise(() => {});
    return { status:200, headers:new Headers(), arrayBuffer:() => new Promise(() => {}) };
  });
  const result = await h.fetch(`${baseUrl}/rest/v1/bookings`);
  const error = await result.json();
  assert.equal(calls, 2, 'safe reads get at most two attempts');
  assert.ok(h.api.isConnectionError(error));
  if (['headers', 'body'].includes(failure)) {
    assert.equal(aborted, 2, 'both stalled transports must be aborted');
    assert.equal(error.code, 'MINUTA_READ_TIMEOUT');
  }
}
{
  let calls = 0;
  const h = harness(async () => { if (++calls === 1) throw new TypeError('network'); return json(['recovered']); });
  assert.deepEqual(await (await h.fetch(`${baseUrl}/rest/v1/provider_schedule`)).json(), ['recovered']);
  assert.equal(calls, 2);
}
for (const [path, method] of [
  ['/rest/v1/bookings', 'POST'], ['/rest/v1/bookings', 'PATCH'], ['/rest/v1/bookings', 'DELETE'],
  ['/rest/v1/rpc/book_appointment', 'POST'], ['/rest/v1/rpc/create_minuta_team_booking_v102', 'POST'],
  ['/rest/v1/rpc/get_unknown_operation', 'POST'], ['/rest/v1/rpc/get_unknown_operation', 'GET'],
  ['/rest/v1/rpc/save_minuta_booking_outcome_v106', 'POST'],
  ['/functions/v1/create-payment', 'POST'], ['/auth/v1/token', 'POST'],
  ['/storage/v1/object/client-avatars/photo', 'POST']
]) {
  let calls = 0;
  const init = { method, body:'{}' };
  const h = harness(async (url, actual) => {
    calls++;
    assert.equal(actual, init, 'unsafe operations must pass through unchanged');
    throw new Error('single_attempt');
  });
  await assert.rejects(h.fetch(baseUrl + path, init), /single_attempt/);
  assert.equal(calls, 1, `${path} must never be repeated`);
}
for (const path of ['/rest/v1/rpc/get_minuta_workspace', '/storage/v1/object/sign/client-avatars/photo.webp']) {
  let calls = 0;
  const h = harness(async () => { calls++; return json({}, 503); });
  await h.fetch(baseUrl + path, { method:'POST', body:'{}' });
  assert.equal(calls, 2, 'explicit read-only POST may retry');
}
{
  let calls = 0;
  const h = harness(async () => { calls++; throw new Error('external'); });
  await assert.rejects(h.fetch('https://other.example/rest/v1/bookings'), /external/);
  assert.equal(calls, 1, 'other origins are outside the guard');
}
for (const cancel of ['caller', 'session']) {
  let calls = 0;
  const h = harness(async () => { calls++; return new Promise(() => {}); }, { timeoutMs:1000 });
  const controller = new AbortController();
  const run = h.fetch(`${baseUrl}/rest/v1/bookings`, { signal:controller.signal });
  if (cancel === 'caller') controller.abort();
  else h.fetch.cancelPendingReads();
  await assert.rejects(run, error => error.name === 'AbortError');
  assert.equal(calls, 1, 'cancelled session must not retry');
}
{
  let calls = 0;
  const h = harness(async () => { calls++; return json({}, 503); });
  h.document.hidden = true;
  await h.fetch(`${baseUrl}/rest/v1/bookings`);
  assert.equal(calls, 1, 'do not retry in the background');
}
const provider = read('provider.js');
assert.match(provider, /db: \{ retry:false \}/, 'SDK retries must not multiply transport attempts');
assert.match(provider, /global: \{ fetch:providerReadFetch \}/);
assert.ok(read('provider.html').indexOf('provider-read-fetch.js?') < read('provider.html').indexOf('src="provider.js?'));
assert.match(read('sw.js'), /provider-read-fetch\.js\?v=/);
console.log('Read transport checks passed: headers/body deadlines, one retry, cancellation, protected writes, RPC allowlist and cache wiring');

// Exercise the bundled SDK too: its default GET retries must not multiply ours.
{
  const sdk = { console, fetch, Headers, Request, Response, URL, AbortController, DOMException,
    setTimeout, clearTimeout, setInterval, clearInterval, crypto:globalThis.crypto, atob, btoa, WebSocket:class {} };
  vm.createContext(sdk);
  vm.runInContext(read('vendor/supabase-2.112.4.min.js'), sdk);
  let calls = 0;
  const h = harness(async () => { calls++; return json({}, 503); });
  const client = sdk.supabase.createClient(baseUrl, 'test-key', {
    auth:{ persistSession:false, autoRefreshToken:false, detectSessionInUrl:false },
    db:{ retry:false }, global:{ fetch:h.fetch }
  });
  const result = await client.from('bookings').select('id');
  assert.equal(calls, 2);
  assert.equal(result.error.code, 'MINUTA_READ_UNAVAILABLE');
  calls = 0;
  await client.from('bookings').insert({ service_id:'test' });
  assert.equal(calls, 1, 'actual SDK must send mutations just once');
}

const loadSource = provider.slice(provider.indexOf('function shouldTryCompatibleProviderRead('), provider.indexOf('function waitlistPeriodLabel('));
for (const [code, expectedCalls] of [['MINUTA_READ_TIMEOUT', 1], ['42703', 4]]) {
  let calls = 0;
  const h = harness(async () => json([]));
  const context = { currentUser:{ id:'test' }, sessionGeneration:1, bookingsRequestRevision:0,
    navigator:{ onLine:true }, window:h.window, $:() => ({ innerHTML:'' }),
    readProviderCache:async () => null, sessionIsCurrent:() => true,
    queryAllProviderBookings:async () => { calls++; return { data:null, error:{ code } }; }
  };
  vm.createContext(context);
  vm.runInContext(loadSource, context);
  assert.equal((await context.loadBookings({ silent:true })).ok, false);
  assert.equal(calls, expectedCalls, 'network failures must not trigger legacy schema fallbacks');
}
console.log('Bundled SDK and journal checks passed: bounded attempts, single writes and preserved legacy schema fallback');
