import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { handleProviderInboundRequest } from '../../supabase/functions/primetime-provider-inbound-v144/handler.ts';

const connectionId = '00000000-0000-4000-8000-000000000144';
const organizationId = '00000000-0000-4000-8000-000000000001';
const eventUuid = '00000000-0000-4000-8000-000000000099';
const secret = 'provider-inbound-fixture-secret-32-bytes-minimum';
const now = Date.parse('2026-09-11T10:00:00.000Z');
const timestamp = String(Math.floor(now / 1000));

function environment(overrides = {}) {
  return {
    PRIMETIME_PROVIDER_INBOUND_V144_ENABLED: 'true',
    PRIMETIME_PROVIDER_INBOUND_V144_ENVIRONMENT: 'testing',
    PRIMETIME_PROVIDER_INBOUND_V144_CONNECTIONS: JSON.stringify({
      [connectionId]: {
        organizationId,
        provider: 'yclients',
        externalLocationId: '997441',
        secret
      }
    }),
    SUPABASE_URL: 'https://db.fixture.invalid',
    SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-role',
    ...overrides
  };
}

function signature(raw, at = timestamp, signingSecret = secret) {
  return `v1=${createHmac('sha256', signingSecret).update(`${at}.${raw}`).digest('hex')}`;
}

function fixture({ env = environment(), rpcReply = null } = {}) {
  const requests = [];
  return {
    requests,
    call: async (payload, {
      provider = 'yclients',
      eventId = eventUuid,
      at = timestamp,
      suppliedSignature,
      contentType = 'application/json'
    } = {}) => {
      const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
      return handleProviderInboundRequest(new Request(
        `https://edge.fixture.invalid/functions/v1/primetime-provider-inbound-v144/v1/events/${provider}/${connectionId}`,
        {
          method: 'POST',
          headers: {
            'content-type': contentType,
            'x-primetime-provider-event-id': eventId,
            'x-primetime-provider-timestamp': at,
            'x-primetime-provider-signature': suppliedSignature ?? signature(raw, at)
          },
          body: raw
        }
      ), {
        env: name => env[name],
        now: () => now,
        fetch: async (url, init) => {
          requests.push({ url: String(url), body: JSON.parse(init.body), headers: new Headers(init.headers) });
          return new Response(JSON.stringify(rpcReply ?? {
            ok: true,
            eventId: '00000000-0000-4000-8000-000000000777',
            state: 'accepted',
            replayed: false
          }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
      });
    }
  };
}

const yclientsCreate = {
  company_id: 997441,
  resource: 'record',
  resource_id: 1561921428,
  status: 'create',
  data: {
    id: 1561921428,
    company_id: 997441,
    staff_id: 3094597,
    date: '2026-09-12 10:30:00',
    services: [{ id: 25184394, title: 'Private service title', cost: 1300 }],
    client: { name: 'Private client', phone: '+70000000000' }
  }
};

test('documented YCLIENTS create becomes one PII-free refresh command', async () => {
  const f = fixture();
  const response = await f.call(yclientsCreate);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    eventId: '00000000-0000-4000-8000-000000000777',
    state: 'accepted',
    replayed: false
  });
  assert.equal(f.requests.length, 1);
  assert.match(f.requests[0].url, /record_minuta_provider_event_v144$/);
  assert.equal(f.requests[0].body.p_organization, organizationId);
  assert.deepEqual(f.requests[0].body.p_command, {
    action: 'refresh_booking',
    externalLocationId: '997441',
    externalBookingId: '1561921428',
    reason: 'partial_webhook'
  });
  assert.equal(f.requests[0].body.p_event_type, 'booking.created');
  assert.doesNotMatch(JSON.stringify(f.requests[0].body.p_command), /Private|70000000000|title|cost/i);
  assert.match(f.requests[0].body.p_payload_sha256, /^[0-9a-f]{64}$/);
});

test('documented partial YCLIENTS event requests a safe refresh', async () => {
  const f = fixture();
  const response = await f.call({
    company_id: 997441,
    resource: 'record',
    resource_id: 1561921428,
    status: 'update',
    data: { id: 1561921428, comment: 'Partial update with no schedule fields' }
  });
  assert.equal(response.status, 200);
  assert.deepEqual(f.requests[0].body.p_command, {
    action: 'refresh_booking',
    externalLocationId: '997441',
    externalBookingId: '1561921428',
    reason: 'partial_webhook'
  });
  assert.equal(f.requests[0].body.p_event_type, 'booking.updated');
});

test('documented YCLIENTS deletion becomes a PII-free cancel command', async () => {
  const f = fixture();
  const response = await f.call({
    company_id: 997441,
    resource: 'record',
    resource_id: 1561921428,
    status: 'delete',
    data: { id: 1561921428, deleted: true, client: { phone: '+70000000000' } }
  });
  assert.equal(response.status, 200);
  assert.deepEqual(f.requests[0].body.p_command, {
    action: 'cancel_booking',
    externalLocationId: '997441',
    externalBookingId: '1561921428'
  });
  assert.equal(f.requests[0].body.p_event_type, 'booking.cancelled');
});

for (const [name, options, expected] of [
  ['wrong signature', { suppliedSignature: `v1=${'0'.repeat(64)}` }, 401],
  ['stale timestamp', { at: String(Number(timestamp) - 301) }, 401],
  ['wrong content type', { contentType: 'text/plain' }, 415],
  ['content-type prefix spoof', { contentType: 'application/json-evil' }, 415]
]) {
  test(`${name} is rejected before database I/O`, async () => {
    const f = fixture();
    const response = await f.call(yclientsCreate, options);
    assert.equal(response.status, expected);
    assert.equal(f.requests.length, 0);
  });
}

test('tenant mismatch is rejected after signature verification', async () => {
  const f = fixture();
  const response = await f.call({ ...yclientsCreate, company_id: 5 });
  assert.equal(response.status, 422);
  assert.equal(f.requests.length, 0);
});

test('the endpoint remains disabled outside explicit testing mode', async () => {
  const f = fixture({ env: environment({ PRIMETIME_PROVIDER_INBOUND_V144_ENVIRONMENT: 'production' }) });
  const response = await f.call(yclientsCreate);
  assert.equal(response.status, 503);
  assert.equal(f.requests.length, 0);
});

test('DIKIDI requires the versioned gateway envelope and matching signed event id', async () => {
  const dikidiEventId = 'dikidi.event.144';
  const dikidiEnv = environment({
    PRIMETIME_PROVIDER_INBOUND_V144_CONNECTIONS: JSON.stringify({
      [connectionId]: {
        organizationId,
        provider: 'dikidi',
        externalLocationId: 'salon.5',
        secret
      }
    })
  });
  const f = fixture({ env: dikidiEnv });
  const response = await f.call({
    schema: 'primetime.dikidi.booking.v1',
    event_id: dikidiEventId,
    event: 'booking.updated',
    organization_id: 'salon.5',
    booking: {
      id: 'visit.81', staff_id: 'master.4', service_ids: ['service.8', 'service.2'],
      starts_at: '2026-09-12T09:00:00+04:00', ends_at: '2026-09-12T10:30:00+04:00',
      client_name: 'Private client', client_phone: '+71111111111'
    }
  }, { provider: 'dikidi', eventId: dikidiEventId });
  assert.equal(response.status, 200);
  assert.deepEqual(f.requests[0].body.p_command, {
    action: 'upsert_booking',
    externalLocationId: 'salon.5',
    externalBookingId: 'visit.81',
    staffExternalId: 'master.4',
    serviceExternalIds: ['service.2', 'service.8'],
    startsAt: '2026-09-12T05:00:00.000Z',
    endsAt: '2026-09-12T06:30:00.000Z'
  });

  const unsupported = fixture({ env: dikidiEnv });
  const bad = await unsupported.call({
    event: 'booking.updated', booking: { id: 'visit.81' }
  }, { provider: 'dikidi', eventId: dikidiEventId });
  assert.equal(bad.status, 422);
  assert.equal(unsupported.requests.length, 0);
});

test('SQL replay state is preserved without a second interpretation', async () => {
  const f = fixture({ rpcReply: {
    ok: true,
    eventId: '00000000-0000-4000-8000-000000000777',
    state: 'processed',
    replayed: true
  } });
  const response = await f.call(yclientsCreate);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).replayed, true);
});

test('streamed payloads are stopped at the byte limit before database I/O', async () => {
  const f = fixture();
  const response = await f.call({ ...yclientsCreate, padding: 'x'.repeat(64 * 1024) });
  assert.equal(response.status, 413);
  assert.equal(f.requests.length, 0);
});

console.log('PrimeTime provider inbound v144 Edge tests: PASS');
