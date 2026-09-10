import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';

import { handlePrimeTimeIntegrationRequest } from '../../supabase/functions/primetime-integration-api/handler.ts';

const keyId = '00000000-0000-4000-8000-000000000142';
const connectionId = '00000000-0000-4000-8000-000000000242';
const performerId = '00000000-0000-4000-8000-000000000342';
const locationId = '00000000-0000-4000-8000-000000000442';
const secret = 'A'.repeat(43);
const token = `ptk_${keyId}.${secret}`;
const environment = {
  PRIMETIME_INTEGRATION_ENABLED: 'true',
  PRIMETIME_INTEGRATION_ENVIRONMENT: 'testing',
  SUPABASE_URL: 'https://db.fixture.invalid',
  SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-role-key'
};

const rpcName = request => new URL(request.url).pathname.split('/').at(-1);
const jsonReply = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' }
});

function fixture({ env = environment, overrides = {}, auth = true, rate = true } = {}) {
  const requests = [];
  const defaults = {
    authenticate_minuta_integration_key_v142: auth
      ? { ok: true, connection_id: connectionId, scopes: ['calendar:read', 'calendar:write'] }
      : { ok: false, error: 'unauthorized' },
    consume_minuta_integration_rate_limit_v142: rate
      ? { ok: true, allowed: true }
      : { ok: false, error: 'rate_limited' },
    get_minuta_integration_calendar_v142: {
      ok: true,
      events: [{ id: randomUUID(), type: 'booking', startsAt: '2099-09-20T10:00:00Z' }],
      next_cursor: null
    },
    upsert_minuta_integration_calendar_event_v142: {
      ok: true,
      event: { externalId: 'google:event-1', revision: 'rev-1' },
      replayed: false
    },
    delete_minuta_integration_calendar_event_v142: { ok: true, replayed: false }
  };
  const responses = { ...defaults, ...overrides };
  const fetch = async (url, init = {}) => {
    const request = {
      url: String(url),
      method: init.method || 'GET',
      headers: new Headers(init.headers),
      body: init.body ? JSON.parse(String(init.body)) : null
    };
    requests.push(request);
    assert.equal(new URL(request.url).hostname, 'db.fixture.invalid');
    const name = rpcName(request);
    assert.ok(Object.hasOwn(responses, name), `Unexpected RPC: ${name}`);
    return jsonReply(responses[name]);
  };
  const call = ({ path = '/v1/calendar/events?from=2099-09-20T00:00:00Z&to=2099-09-21T00:00:00Z', method = 'GET', headers = {}, body } = {}) => {
    const requestHeaders = { accept: 'application/json', authorization: `Bearer ${token}`, ...headers };
    const init = { method, headers: requestHeaders };
    if (body !== undefined) {
      requestHeaders['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    return handlePrimeTimeIntegrationRequest(new Request(`https://edge.fixture.invalid${path}`, init), {
      env: name => env[name], fetch
    });
  };
  return { requests, call };
}

async function payload(response) {
  assert.match(response.headers.get('content-type') || '', /^application\/json/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return response.json();
}

test('disabled and malformed configuration fails closed without I/O', async () => {
  for (const env of [
    { ...environment, PRIMETIME_INTEGRATION_ENABLED: 'false' },
    { ...environment, PRIMETIME_INTEGRATION_ENVIRONMENT: 'invalid' },
    { ...environment, SUPABASE_URL: 'http://db.fixture.invalid' },
    { ...environment, SUPABASE_SERVICE_ROLE_KEY: '' }
  ]) {
    const f = fixture({ env });
    const response = await f.call();
    assert.equal(response.status, 503);
    assert.deepEqual(await payload(response), { code: 'NOT_CONFIGURED' });
    assert.equal(f.requests.length, 0);
  }
});

test('malformed and unknown API keys fail without tenant data access', async () => {
  const malformed = fixture();
  const malformedResponse = await malformed.call({ headers: { authorization: 'Bearer wrong' } });
  assert.equal(malformedResponse.status, 401);
  assert.equal(malformed.requests.length, 0);

  const unknown = fixture({ auth: false });
  const unknownResponse = await unknown.call();
  assert.equal(unknownResponse.status, 401);
  assert.deepEqual(unknown.requests.map(rpcName), ['authenticate_minuta_integration_key_v142']);
});

test('key secret is hashed and required scope is bound before calendar read', async () => {
  const f = fixture();
  const response = await f.call();
  assert.equal(response.status, 200);
  const result = await payload(response);
  assert.equal(result.events.length, 1);
  assert.equal(result.nextCursor, null);
  assert.deepEqual(f.requests.map(rpcName), [
    'authenticate_minuta_integration_key_v142',
    'consume_minuta_integration_rate_limit_v142',
    'get_minuta_integration_calendar_v142'
  ]);
  assert.equal(f.requests[0].body.p_required_scope, 'calendar:read');
  assert.equal(f.requests[0].body.p_secret_sha256, createHash('sha256').update(secret).digest('hex'));
  assert.equal(JSON.stringify(f.requests).includes(secret), false);
  assert.equal(JSON.stringify(f.requests).includes('fixture-service-role-key'), false);
});

test('calendar reads are bounded, paginated and reject unbounded dates', async () => {
  const f = fixture();
  const response = await f.call({
    path: `/v1/calendar/events?from=2099-09-20T00:00:00Z&to=2099-09-21T00:00:00Z&limit=20&afterUpdatedAt=2099-09-01T00:00:00Z&afterId=${performerId}`
  });
  assert.equal(response.status, 200);
  assert.equal(f.requests.at(-1).body.p_count, 20);
  assert.equal(f.requests.at(-1).body.p_after_id, performerId);

  const tooWide = fixture();
  const rejected = await tooWide.call({ path: '/v1/calendar/events?from=2099-01-01T00:00:00Z&to=2099-12-31T00:00:00Z' });
  assert.equal(rejected.status, 422);
  assert.deepEqual(tooWide.requests.map(rpcName), [
    'authenticate_minuta_integration_key_v142',
    'consume_minuta_integration_rate_limit_v142'
  ]);
});

test('valid upsert uses write scope, canonical payload hash and mandatory idempotency', async () => {
  const body = {
    performerId,
    locationId,
    startsAt: '2099-09-20T10:00:00+04:00',
    endsAt: '2099-09-20T11:00:00+04:00',
    revision: 'rev-1',
    expectedRevision: null
  };
  const f = fixture();
  const response = await f.call({
    path: '/v1/calendar/events/google:event-1',
    method: 'PUT',
    headers: { 'idempotency-key': 'fixture-upsert-0001' },
    body
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await payload(response), {
    event: { externalId: 'google:event-1', revision: 'rev-1' },
    replayed: false
  });
  assert.deepEqual(f.requests.map(rpcName), [
    'authenticate_minuta_integration_key_v142',
    'consume_minuta_integration_rate_limit_v142',
    'upsert_minuta_integration_calendar_event_v142'
  ]);
  assert.equal(f.requests[0].body.p_required_scope, 'calendar:write');
  assert.equal(f.requests.at(-1).body.p_external_event_id, 'google:event-1');
  assert.match(f.requests.at(-1).body.p_request_key, /^[0-9a-f]{64}$/);
  assert.match(f.requests.at(-1).body.p_payload_sha256, /^[0-9a-f]{64}$/);

  const missingKey = fixture();
  const rejected = await missingKey.call({ path: '/v1/calendar/events/google:event-1', method: 'PUT', body });
  assert.equal(rejected.status, 422);
  assert.deepEqual(missingKey.requests.map(rpcName), [
    'authenticate_minuta_integration_key_v142',
    'consume_minuta_integration_rate_limit_v142'
  ]);
});

test('stale revisions and reused request keys are surfaced as conflicts', async () => {
  for (const error of ['revision_conflict', 'request_conflict']) {
    const f = fixture({ overrides: { upsert_minuta_integration_calendar_event_v142: { ok: false, error } } });
    const response = await f.call({
      path: '/v1/calendar/events/google:event-1',
      method: 'PUT',
      headers: { 'idempotency-key': `fixture-${error}` },
      body: {
        performerId,
        locationId,
        startsAt: '2099-09-20T10:00:00Z',
        endsAt: '2099-09-20T11:00:00Z',
        revision: 'rev-2',
        expectedRevision: 'rev-old'
      }
    });
    assert.equal(response.status, 409);
  }
});

test('delete requires current revision and a stable idempotency key', async () => {
  const missingRevision = fixture();
  const rejected = await missingRevision.call({
    path: '/v1/calendar/events/google:event-1', method: 'DELETE',
    headers: { 'idempotency-key': 'fixture-delete-0001' }
  });
  assert.equal(rejected.status, 428);

  const f = fixture();
  const response = await f.call({
    path: '/v1/calendar/events/google:event-1', method: 'DELETE',
    headers: { 'idempotency-key': 'fixture-delete-0001', 'if-match': '"rev-2"' }
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await payload(response), { deleted: true, replayed: false });
  assert.equal(f.requests.at(-1).body.p_expected_revision, 'rev-2');
});

test('rate limiting stops all calendar data RPCs', async () => {
  const f = fixture({ rate: false });
  const response = await f.call();
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '60');
  assert.deepEqual(f.requests.map(rpcName), [
    'authenticate_minuta_integration_key_v142',
    'consume_minuta_integration_rate_limit_v142'
  ]);
});
