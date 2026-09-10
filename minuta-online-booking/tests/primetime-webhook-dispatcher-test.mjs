import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import { handlePrimeTimeWebhookDispatch } from '../../supabase/functions/primetime-webhook-dispatcher/handler.ts';

const lease = '00000000-0000-4000-8000-000000001420';
const eventId = '00000000-0000-4000-8000-000000001421';
const subscriptionId = '00000000-0000-4000-8000-000000001423';
const organizationId = '00000000-0000-4000-8000-000000001424';
const connectionId = '00000000-0000-4000-8000-000000001425';
const dispatchToken = 'dispatch-token-'.padEnd(40, 'x');
const webhookSecret = 'webhook-secret-'.padEnd(40, 'y');
const payload = {
  schemaVersion: 1,
  eventId,
  type: 'booking.created',
  booking: { id: '00000000-0000-4000-8000-000000001422', status: 'new' }
};
const environment = {
  PRIMETIME_WEBHOOK_DISPATCH_ENABLED: 'true',
  PRIMETIME_WEBHOOK_DISPATCH_TOKEN: dispatchToken,
  PRIMETIME_WEBHOOK_DESTINATIONS: JSON.stringify({
    [subscriptionId]: {
      organizationId,
      connectionId,
      targetUrl: 'https://receiver.fixture.invalid/hooks/primetime',
      secretRef: 'fixture_primary',
      secret: webhookSecret
    }
  }),
  PRIMETIME_WEBHOOK_BATCH_SIZE: '10',
  SUPABASE_URL: 'https://db.fixture.invalid',
  SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-role-key'
};

const jsonReply = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' }
});

function fixture({ env = environment, deliveries, targetStatus = 204, targetThrows = false } = {}) {
  const calls = [];
  const leased = deliveries ?? [{
    id: eventId,
    subscriptionId,
    organizationId,
    connectionId,
    targetUrl: 'https://receiver.fixture.invalid/hooks/primetime',
    secretRef: 'fixture_primary',
    eventType: 'booking.created',
    attempt: 1,
    payload
  }];
  const fetch = async (url, init = {}) => {
    const request = {
      url: String(url),
      method: init.method,
      headers: new Headers(init.headers),
      body: init.body === undefined ? null : String(init.body),
      redirect: init.redirect
    };
    calls.push(request);
    const hostname = new URL(request.url).hostname;
    if (hostname === 'db.fixture.invalid') {
      const name = new URL(request.url).pathname.split('/').at(-1);
      if (name === 'lease_minuta_integration_webhooks_v142') return jsonReply({ ok: true, deliveries: leased });
      if (name === 'settle_minuta_integration_webhook_v142') return jsonReply({ ok: true, state: JSON.parse(request.body).p_outcome });
      throw new Error(`Unexpected RPC ${name}`);
    }
    if (targetThrows) throw new Error('fixture network failure');
    return new Response(targetStatus === 204 ? null : '', { status: targetStatus });
  };
  const call = (headers = { authorization: `Bearer ${dispatchToken}` }) => handlePrimeTimeWebhookDispatch(
    new Request('https://edge.fixture.invalid/functions/v1/primetime-webhook-dispatcher', { method: 'POST', headers }),
    { env: name => env[name], fetch, now: () => 4_102_444_800_000, randomUUID: () => lease }
  );
  return { calls, call };
}

test('disabled or invalid configuration fails closed before any I/O', async () => {
  for (const env of [
    { ...environment, PRIMETIME_WEBHOOK_DISPATCH_ENABLED: 'false' },
    { ...environment, PRIMETIME_WEBHOOK_DISPATCH_TOKEN: 'short' },
    { ...environment, PRIMETIME_WEBHOOK_DESTINATIONS: '{}' },
    { ...environment, PRIMETIME_WEBHOOK_DESTINATIONS: '{"bad":true}' },
    { ...environment, SUPABASE_URL: 'http://db.fixture.invalid' }
  ]) {
    const f = fixture({ env });
    const response = await f.call();
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { code: 'NOT_CONFIGURED' });
    assert.equal(f.calls.length, 0);
  }
});

test('private dispatch token is required before leasing', async () => {
  const f = fixture();
  const response = await f.call({ authorization: 'Bearer wrong' });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { code: 'UNAUTHORIZED' });
  assert.equal(f.calls.length, 0);
});

test('exact JSON body is signed and successful deliveries are settled', async () => {
  const f = fixture();
  const response = await f.call();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { leased: 1, delivered: 1, retried: 0, failed: 0 });
  assert.equal(f.calls.length, 3);
  const [leaseCall, targetCall, settleCall] = f.calls;
  assert.equal(JSON.parse(leaseCall.body).p_lease, lease);
  assert.equal(targetCall.redirect, 'error');
  assert.equal(targetCall.body, JSON.stringify(payload));
  assert.equal(targetCall.headers.get('x-primetime-event-id'), eventId);
  assert.equal(targetCall.headers.get('x-primetime-timestamp'), '4102444800');
  const expected = createHmac('sha256', webhookSecret)
    .update(`4102444800.${JSON.stringify(payload)}`).digest('hex');
  assert.equal(targetCall.headers.get('x-primetime-signature'), `v1=${expected}`);
  const settlement = JSON.parse(settleCall.body);
  assert.equal(settlement.p_outcome, 'delivered');
  assert.equal(settlement.p_status, 204);
  assert.equal(JSON.stringify(f.calls).includes(webhookSecret), false);
  assert.equal(JSON.stringify(f.calls).includes('fixture-service-role-key'), false);
});

test('transient responses and network failures are retried', async () => {
  for (const options of [{ targetStatus: 429 }, { targetStatus: 503 }, { targetThrows: true }]) {
    const f = fixture(options);
    const response = await f.call();
    assert.equal(response.status, 200);
    assert.equal((await response.json()).retried, 1);
    const settlement = JSON.parse(f.calls.at(-1).body);
    assert.equal(settlement.p_outcome, 'retry');
  }
});

test('unprovisioned or cross-tenant destinations never receive a request', async () => {
  for (const delivery of [
    { id: eventId, subscriptionId, organizationId, connectionId, targetUrl: 'https://127.0.0.1/hook', secretRef: 'fixture_primary', eventType: 'booking.created', attempt: 1, payload },
    { id: eventId, subscriptionId, organizationId, connectionId, targetUrl: 'https://not-allowed.fixture.invalid/hook', secretRef: 'fixture_primary', eventType: 'booking.created', attempt: 1, payload },
    { id: eventId, subscriptionId, organizationId, connectionId, targetUrl: 'https://receiver.fixture.invalid/hooks/primetime', secretRef: 'missing', eventType: 'booking.created', attempt: 1, payload },
    { id: eventId, subscriptionId, organizationId: '00000000-0000-4000-8000-000000009999', connectionId, targetUrl: 'https://receiver.fixture.invalid/hooks/primetime', secretRef: 'fixture_primary', eventType: 'booking.created', attempt: 1, payload }
  ]) {
    const f = fixture({ deliveries: [delivery] });
    const response = await f.call();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { leased: 1, delivered: 0, retried: 0, failed: 1 });
    assert.equal(f.calls.filter(call => new URL(call.url).hostname !== 'db.fixture.invalid').length, 0);
    assert.equal(JSON.parse(f.calls.at(-1).body).p_error_code, 'destination_not_configured');
  }
});
