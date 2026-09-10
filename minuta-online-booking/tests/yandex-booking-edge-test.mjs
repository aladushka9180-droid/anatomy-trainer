import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import { jsonReply, uuid, yandexBookingEdgeFixture } from './yandex-booking-edge-fixture.mjs';

const partner = 'fixture-partner';
const defaultSecret = 'fixture-yandex-jwt-secret-with-at-least-32-bytes';
const previousSecret = 'fixture-yandex-previous-secret-with-32-bytes';
const companyId = 'company-fixture-1';
const bookingId = 'booking-fixture-1';
const phone = '+79990000001';
const environment = {
  YANDEX_BOOKING_ENABLED: 'true',
  YANDEX_BOOKING_ENVIRONMENT: 'testing',
  YANDEX_BOOKING_PARTNER_NAME: partner,
  YANDEX_BOOKING_JWT_KEYS: JSON.stringify({ default: defaultSecret, previous: previousSecret }),
  SUPABASE_URL: 'https://db.fixture.invalid',
  SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-role-key'
};

const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
function jwt(payload = {}, { secret = defaultSecret, header = {} } = {}) {
  const encodedHeader = encode({ typ: 'JWT', alg: 'HS256', ...header });
  const encodedPayload = encode({ sub: partner, ...payload });
  const input = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac('sha256', secret).update(input).digest('base64url');
  return `${input}.${signature}`;
}

const bearer = token => ({ authorization: `Bearer ${token}` });
const rpcName = request => new URL(request.url).pathname.split('/').at(-1);
const fixtureRpc = {
  consume_yandex_booking_rate_limit_v140: { ok: true, allowed: true },
  get_yandex_booking_feed_v140: {
    ok: true,
    companies: [{
      id: companyId,
      name: 'Fixture company',
      address: 'Fixture address',
      rubrics: ['beauty'],
      services: [{ id: 'service-1', title: 'Fixture service', durationSeconds: 3600 }]
    }],
    next_cursor: null
  },
  get_yandex_booking_services_v140: { ok: true, services: [{ id: 'service-1', title: 'Fixture service' }] },
  get_yandex_booking_resources_v140: { ok: true, resources: [{ id: 'resource-1', title: 'Fixture specialist' }] },
  get_yandex_booking_available_dates_v140: { ok: true, dates: ['2099-09-20'] },
  get_yandex_booking_available_time_slots_v140: { ok: true, slots: ['2099-09-20T10:00:00+04:00'] },
  get_yandex_booking_special_conditions_v140: { ok: true, conditions: [] },
  create_yandex_booking_v140: { ok: true, booking: { id: bookingId, status: 'new', serviceIds: ['service-1'], datetime: '2099-09-20T10:00:00+04:00' } },
  get_yandex_booking_v140: { ok: true, booking: { id: bookingId, status: 'confirmed', serviceIds: ['service-1'], datetime: '2099-09-20T10:00:00+04:00' } },
  update_yandex_booking_v140: { ok: true, booking: { id: bookingId, status: 'confirmed', serviceIds: ['service-1'], datetime: '2099-09-20T11:00:00+04:00' } },
  cancel_yandex_booking_v140: { ok: true, booking: { id: bookingId, status: 'cancelled', serviceIds: ['service-1'], datetime: '2099-09-20T10:00:00+04:00' } }
};

function fixture({ env = environment, rpc = fixtureRpc, responseStatus = 200 } = {}) {
  return yandexBookingEdgeFixture({ env, fetch: async request => {
    assert.equal(new URL(request.url).hostname, 'db.fixture.invalid');
    const name = rpcName(request);
    assert.ok(Object.hasOwn(rpc, name), `Unexpected RPC ${name}`);
    return jsonReply(rpc[name], responseStatus);
  } });
}

async function body(response) {
  assert.match(response.headers.get('content-type') || '', /^application\/json\b/i);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return response.json();
}

test('disabled or incomplete configuration fails closed before any I/O', async () => {
  for (const env of [
    { ...environment, YANDEX_BOOKING_ENABLED: 'false' },
    { ...environment, YANDEX_BOOKING_JWT_KEYS: '' },
    { ...environment, YANDEX_BOOKING_JWT_KEYS: JSON.stringify({ default: 'too-short' }) },
    { ...environment, YANDEX_BOOKING_ENVIRONMENT: '' },
    { ...environment, YANDEX_BOOKING_ENVIRONMENT: 'test' },
    { ...environment, SUPABASE_URL: 'http://db.fixture.invalid' },
    { ...environment, SUPABASE_SERVICE_ROLE_KEY: '' }
  ]) {
    const f = fixture({ env });
    const response = await f.call({ headers: bearer(jwt()) });
    assert.equal(response.status, 503);
    assert.equal((await body(response)).code, 'NOT_CONFIGURED');
    assert.equal(f.requests.length, 0);
  }
});

test('valid official no-iat JWT reaches feed and keeps response bounded to its contract', async () => {
  const f = fixture();
  const response = await f.call({
    path: '/v1/companies/feed?count=100',
    headers: bearer(jwt({ extraClaim: 'allowed' }))
  });
  assert.equal(response.status, 200);
  const result = await body(response);
  assert.equal(result.companies.length, 1);
  assert.equal(result.companies[0].id, companyId);
  assert.deepEqual(result.pagination, { cursor: '', hasMore: false });
  assert.deepEqual(f.requests.map(rpcName), [
    'consume_yandex_booking_rate_limit_v140',
    'get_yandex_booking_feed_v140'
  ]);
  const serialized = JSON.stringify({ result, logs: f.logs });
  assert.equal(/manage_token|service-role|jwt-secret|previous-secret/i.test(serialized), false);
});

test('malformed, forged and incompatible JWTs are rejected without I/O', async () => {
  const now = Math.floor(Date.now() / 1000);
  const cases = [
    '',
    'not-a-jwt',
    jwt({}, { secret: 'different-fixture-secret-with-at-least-32-bytes' }),
    jwt({}, { header: { alg: 'HS512' } }),
    jwt({}, { header: { typ: 'not-jwt' } }),
    jwt({ sub: 'foreign-partner' }),
    jwt({ iat: now }),
    jwt({ exp: now - 10 }),
    jwt({ nbf: now + 600 })
  ];
  for (const token of cases) {
    const f = fixture();
    const response = await f.call({ headers: token ? bearer(token) : {} });
    assert.equal(response.status, 401);
    assert.equal((await body(response)).code, 'UNAUTHORIZED');
    assert.equal(f.requests.length, 0);
  }
});

test('optional issuer and audience are enforced only when configured', async () => {
  const configured = {
    ...environment,
    YANDEX_BOOKING_EXPECTED_ISSUER: 'fixture-issuer',
    YANDEX_BOOKING_EXPECTED_AUDIENCE: 'fixture-audience'
  };
  for (const claims of [
    {},
    { iss: 'wrong', aud: 'fixture-audience' },
    { iss: 'fixture-issuer', aud: 'wrong' }
  ]) {
    const f = fixture({ env: configured });
    const response = await f.call({ headers: bearer(jwt(claims)) });
    assert.equal(response.status, 401);
    assert.equal(f.requests.length, 0);
  }
  const f = fixture({ env: configured });
  const response = await f.call({ headers: bearer(jwt({ iss: 'fixture-issuer', aud: 'fixture-audience' })) });
  assert.equal(response.status, 200);
  assert.equal(f.requests.length, 2);
});

test('named previous key supports rotation while an unknown kid fails closed', async () => {
  const accepted = fixture();
  assert.equal((await accepted.call({ headers: bearer(jwt({}, { secret: previousSecret, header: { kid: 'previous' } })) })).status, 200);
  assert.equal(accepted.requests.length, 2);

  const acceptedWithoutKid = fixture();
  assert.equal((await acceptedWithoutKid.call({ headers: bearer(jwt({}, { secret: previousSecret })) })).status, 200);
  assert.equal(acceptedWithoutKid.requests.length, 2);

  const rejected = fixture();
  const response = await rejected.call({ headers: bearer(jwt({}, { header: { kid: 'unknown' } })) });
  assert.equal(response.status, 401);
  assert.equal(rejected.requests.length, 0);
});

test('company and booking claims must exactly match the selected tenant object before scoped I/O', async () => {
  const probes = [
    {
      path: `/v1/companies/${companyId}/services`,
      token: jwt({ companyId: 'foreign-company' }),
      expectedRequests: 0
    },
    {
      path: '/v1/bookings', method: 'POST',
      body: { booking: { companyId, user: { name: 'Fixture', phone }, appointment: { serviceIds: ['service-1'], resourceId: 'resource-1', datetime: '2099-09-20T10:00:00+04:00' } } },
      token: jwt({ companyId: 'foreign-company', userPhone: phone }),
      expectedRequests: 0
    },
    {
      path: '/v1/bookings', method: 'POST',
      body: { booking: { companyId, user: { name: 'Fixture', phone }, appointment: { serviceIds: ['service-1'], resourceId: 'resource-1', datetime: '2099-09-20T10:00:00+04:00' } } },
      token: jwt({ companyId, userPhone: '+79990000002' }),
      expectedRequests: 0
    },
    {
      path: `/v1/bookings/${bookingId}`,
      token: jwt({ bookingId: 'foreign-booking' }),
      expectedRequests: 0
    }
  ];
  for (const probe of probes) {
    const f = fixture();
    const response = await f.call({ ...probe, headers: bearer(probe.token) });
    assert.equal(response.status, 401);
    assert.equal((await body(response)).code, 'UNAUTHORIZED');
    assert.equal(f.requests.length, probe.expectedRequests, `${probe.method || 'GET'} ${probe.path}`);
  }
});

test('PUT trusts bookingId claim and lets the tenant-mapping RPC reject a foreign body company', async () => {
  const f = fixture({ rpc: {
    ...fixtureRpc,
    update_yandex_booking_v140: { ok: false, error: 'company_not_found' }
  } });
  const response = await f.call({
    path: `/v1/bookings/${bookingId}`,
    method: 'PUT',
    body: { companyId: 'foreign-company', datetime: '2099-09-20T11:00:00+04:00' },
    headers: bearer(jwt({ bookingId }))
  });
  assert.equal(response.status, 404);
  assert.deepEqual(await body(response), { code: 'COMPANY_NOT_FOUND' });
  assert.deepEqual(f.requests.map(rpcName), [
    'consume_yandex_booking_rate_limit_v140',
    'update_yandex_booking_v140'
  ]);
});

test('PUT cancellation passes body company to the tenant-mapping RPC', async () => {
  const f = fixture({ rpc: {
    ...fixtureRpc,
    cancel_yandex_booking_v140: { ok: false, error: 'company_not_found' }
  } });
  const response = await f.call({
    path: `/v1/bookings/${bookingId}`,
    method: 'PUT',
    body: { companyId: 'foreign-company', status: 'cancelled' },
    headers: bearer(jwt({ bookingId }))
  });
  assert.equal(response.status, 404);
  assert.deepEqual(await body(response), { code: 'COMPANY_NOT_FOUND' });
  assert.deepEqual(f.requests.map(rpcName), [
    'consume_yandex_booking_rate_limit_v140',
    'cancel_yandex_booking_v140'
  ]);
  assert.equal(f.requests.at(-1).body.p_company_id, 'foreign-company');
});

test('valid tenant-scoped list and mutation routes call only their narrow RPC', async () => {
  const cases = [
    [`/v1/companies/${companyId}/services`, 'GET', undefined, { companyId }, 'get_yandex_booking_services_v140', 'services'],
    [`/v1/companies/${companyId}/resources`, 'GET', undefined, { companyId }, 'get_yandex_booking_resources_v140', 'resources'],
    [`/v1/companies/${companyId}/available_dates?serviceIds[]=service-1&from=2099-09-20&to=2099-09-21`, 'GET', undefined, { companyId }, 'get_yandex_booking_available_dates_v140', 'availableDates'],
    [`/v1/companies/${companyId}/available_time_slots?serviceIds[]=service-1&date=2099-09-20`, 'GET', undefined, { companyId }, 'get_yandex_booking_available_time_slots_v140', 'availableTimeSlots'],
    [`/v1/companies/${companyId}/special_conditions?serviceIds[]=service-1&datetime=2099-09-20T10%3A00%3A00%2B04%3A00`, 'GET', undefined, { companyId }, 'get_yandex_booking_special_conditions_v140', 'specialConditions'],
    ['/v1/bookings', 'POST', { booking: { companyId, user: { name: 'Fixture', phone }, appointment: { serviceIds: ['service-1'], resourceId: 'resource-1', datetime: '2099-09-20T10:00:00+04:00' } } }, { companyId, userPhone: phone }, 'create_yandex_booking_v140', 'booking'],
    [`/v1/bookings/${bookingId}`, 'GET', undefined, { bookingId }, 'get_yandex_booking_v140', 'booking'],
    [`/v1/bookings/${bookingId}`, 'PUT', { companyId, datetime: '2099-09-20T11:00:00+04:00' }, { bookingId, companyId }, 'update_yandex_booking_v140', 'booking'],
    [`/v1/bookings/${bookingId}`, 'PUT', { companyId, status: 'cancelled' }, { bookingId }, 'cancel_yandex_booking_v140', 'booking'],
    [`/v1/bookings/${bookingId}`, 'DELETE', undefined, { bookingId }, 'cancel_yandex_booking_v140', null]
  ];
  for (const [path, method, requestBody, claims, expectedRpc, wrapper] of cases) {
    const f = fixture();
    const response = await f.call({ path, method, body: requestBody, headers: bearer(jwt(claims)) });
    assert.equal(response.status, 200, `${method} ${path}`);
    const result = await body(response);
    if (wrapper === null) assert.deepEqual(result, {}, `${method} ${path} must use the schema-free JSON response`);
    else assert.ok(Object.hasOwn(result, wrapper), `${method} ${path} must return ${wrapper}`);
    if (expectedRpc === 'create_yandex_booking_v140') {
      assert.equal(result.booking.status, 'created', 'internal new status must use the official created wire status');
    }
    assert.deepEqual(f.requests.map(rpcName), ['consume_yandex_booking_rate_limit_v140', expectedRpc]);
    if (expectedRpc === 'cancel_yandex_booking_v140') {
      assert.equal(f.requests.at(-1).body.p_company_id, method === 'DELETE' ? null : companyId);
    }
    assert.equal(/manage_token|service-role|jwt-secret/i.test(JSON.stringify(result)), false);
  }
});

test('Accept, unsupported routes, query bounds and body bounds fail without business RPC I/O', async () => {
  const oversized = { booking: { companyId, user: { name: 'Fixture', phone }, appointment: { serviceIds: ['service-1'], datetime: '2099-09-20T10:00:00+04:00' }, comment: 'x'.repeat(140_000) } };
  const cases = [
    { path: '/v1/companies/feed', headers: { ...bearer(jwt()), accept: 'text/html' }, status: 406, requests: 0 },
    { path: '/v1/companies/feed', method: 'POST', body: {}, headers: bearer(jwt()), status: 405, requests: 0 },
    { path: '/v1/companies/feed?count=0', headers: bearer(jwt()), status: 422, requests: 0 },
    { path: '/v1/companies/feed?count=501', headers: bearer(jwt()), status: 422, requests: 0 },
    { path: `/v1/companies/${companyId}/available_time_slots?date=not-a-date`, headers: bearer(jwt({ companyId })), status: 422, requests: 0 },
    { path: '/v1/prebookings', method: 'POST', body: { companyId }, headers: bearer(jwt({ companyId })), status: 404, requests: 0 },
    { path: '/v1/bookings', method: 'POST', body: oversized, headers: bearer(jwt({ companyId, userPhone: phone })), status: 413, requests: 0 },
    { path: '/v1/bookings', method: 'POST', rawBody: '{', headers: bearer(jwt({ companyId, userPhone: phone })), status: 400, requests: 0 },
    { path: '/v1/bookings', method: 'POST', body: { booking: { companyId, user: { name: 'x'.repeat(81), phone }, appointment: { serviceIds: ['service-1'], datetime: '2099-09-20T10:00:00+04:00' } } }, headers: bearer(jwt({ companyId, userPhone: phone })), status: 422, requests: 0 },
    { path: '/v1/bookings', method: 'POST', body: { booking: { companyId, user: { name: 'Fixture', lastName: 'x'.repeat(81), phone }, appointment: { serviceIds: ['service-1'], datetime: '2099-09-20T10:00:00+04:00' } } }, headers: bearer(jwt({ companyId, userPhone: phone })), status: 422, requests: 0 },
    { path: '/v1/bookings', method: 'POST', body: { booking: { companyId, user: { name: 'x'.repeat(40), lastName: 'y'.repeat(40), phone }, appointment: { serviceIds: ['service-1'], datetime: '2099-09-20T10:00:00+04:00' } } }, headers: bearer(jwt({ companyId, userPhone: phone })), status: 422, requests: 0 },
    { path: '/v1/bookings', method: 'POST', body: { booking: { companyId, user: { name: 'Fixture', phone }, appointment: { serviceIds: ['service-1'], resourceId: 42, datetime: '2099-09-20T10:00:00+04:00' } } }, headers: bearer(jwt({ companyId, userPhone: phone })), status: 422, requests: 0 }
  ];
  for (const probe of cases) {
    const f = fixture();
    const response = await f.call(probe);
    assert.equal(response.status, probe.status, `${probe.method || 'GET'} ${probe.path}`);
    assert.equal(f.requests.length, probe.requests);
  }
});

test('rate limiting stops a valid request before its business RPC and returns bounded retry advice', async () => {
  const f = fixture({ rpc: {
    ...fixtureRpc,
    consume_yandex_booking_rate_limit_v140: { ok: true, allowed: false, retry_after_seconds: 17 }
  } });
  const response = await f.call({ headers: bearer(jwt()) });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '17');
  assert.equal((await body(response)).code, 'RATE_LIMITED');
  assert.deepEqual(f.requests.map(rpcName), ['consume_yandex_booking_rate_limit_v140']);
});

test('mutation policy failures use only the official public error vocabulary', async () => {
  const cases = [
    {
      path: '/v1/bookings',
      method: 'POST',
      requestBody: { booking: { companyId, user: { name: 'Fixture', phone }, appointment: { serviceIds: ['service-1'], datetime: '2099-09-20T10:00:00+04:00' } } },
      claims: { companyId, userPhone: phone },
      rpc: 'create_yandex_booking_v140',
      internalError: 'create_forbidden',
      code: 'CREATE_FORBIDDEN'
    },
    {
      path: `/v1/bookings/${bookingId}`,
      method: 'PUT',
      requestBody: { companyId, datetime: '2099-09-20T11:00:00+04:00' },
      claims: { companyId, bookingId },
      rpc: 'update_yandex_booking_v140',
      internalError: 'update_forbidden',
      code: 'UPDATE_FORBIDDEN'
    },
    {
      path: `/v1/bookings/${bookingId}`,
      method: 'DELETE',
      requestBody: undefined,
      claims: { bookingId },
      rpc: 'cancel_yandex_booking_v140',
      internalError: 'cancel_forbidden',
      code: 'CANCEL_FORBIDDEN'
    }
  ];
  for (const probe of cases) {
    const f = fixture({ rpc: { ...fixtureRpc, [probe.rpc]: { ok: false, error: probe.internalError } } });
    const response = await f.call({
      path: probe.path,
      method: probe.method,
      body: probe.requestBody,
      headers: bearer(jwt(probe.claims))
    });
    assert.equal(response.status, 422, `${probe.method} ${probe.path}`);
    assert.deepEqual(await body(response), { code: probe.code });
    assert.deepEqual(f.requests.map(rpcName), ['consume_yandex_booking_rate_limit_v140', probe.rpc]);
  }
});

test('database failures and unexpected database fields never expose secrets or manage tokens', async () => {
  const secretMarker = 'database-secret-marker';
  const f = yandexBookingEdgeFixture({ env: environment, fetch: async () => jsonReply({
    message: secretMarker,
    manage_token: uuid(44),
    details: environment.SUPABASE_SERVICE_ROLE_KEY
  }, 503) });
  const response = await f.call({ headers: bearer(jwt()) });
  assert.ok(response.status >= 500);
  const serialized = JSON.stringify(await body(response));
  assert.equal(serialized.includes(secretMarker), false);
  assert.equal(/manage_token|service-role/i.test(serialized), false);
});
