import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluateSnapshot, PROPOSED_SLO } from '../scripts/observability-snapshot.mjs';
import { ALERT_CONFIRMATION, deliverObservabilityAlert } from '../scripts/observability-alert-webhook.mjs';

const fixedNow = '2026-09-08T16:00:00.000Z';
const secret = 'fixture-secret-at-least-thirty-two-bytes';
const endpoint = 'https://alerts.example.test/primetime';
const breach = JSON.parse(await readFile(new URL('./fixtures/observability-breach.json', import.meta.url), 'utf8'));
const passing = structuredClone(breach);
passing.availability = { scheduledRuns: 1000, successfulRuns: 1000, failedRuns: 0, truncated: false };
passing.bookingLatency = { samplesMs: Array(20).fill(PROPOSED_SLO.bookingLatencyP95Ms), windowDays: 30 };
passing.notifications = { available: true, eligible: 100, finalWithinTarget: 100, nonFinalOlderTarget: 0 };
passing.payments = { available: true, eligible: 1000, processedWithinTarget: 1000, unreconciledOlderTarget: 0 };
passing.backup.lastSuccessAt = new Date(Date.parse(fixedNow) - PROPOSED_SLO.backupMaxHours * 60 * 60 * 1000).toISOString();
passing.restore.lastSuccessAt = new Date(Date.parse(fixedNow) - PROPOSED_SLO.restoreMaxDays * 24 * 60 * 60 * 1000).toISOString();
const passReport = evaluateSnapshot(passing, { now: fixedNow });
const breachReport = evaluateSnapshot(breach, { now: fixedNow });
const temp = await mkdtemp(join(tmpdir(), 'primetime-observability-alert-'));
const options = statePath => ({ enabled: true, confirmation: ALERT_CONFIRMATION, endpoint, secret, statePath, now: fixedNow });

try {
  assert.ok(passReport.slos.every(item => item.status === 'pass'), 'pass fixture must satisfy every proposed SLO');
  assert.ok(breachReport.slos.every(item => item.status === 'fail'), 'breach fixture must violate every proposed SLO');
  let requests = 0;
  const passResult = await deliverObservabilityAlert(passReport, {
    ...options(join(temp, 'pass.json')),
    fetchImpl: async () => { requests += 1; throw new Error('must_not_send'); }
  });
  assert.equal(passResult.status, 'no_alert');
  assert.equal(requests, 0, 'a non-breach report must never call the webhook');

  const disabledResult = await deliverObservabilityAlert(breachReport, {
    statePath: join(temp, 'disabled.json'),
    fetchImpl: async () => { requests += 1; throw new Error('must_not_send'); }
  });
  assert.equal(disabledResult.status, 'disabled');
  assert.equal(requests, 0, 'delivery is disabled by default');

  await assert.rejects(
    deliverObservabilityAlert(breachReport, { ...options(join(temp, 'missing-secret.json')), secret: '', fetchImpl: async () => ({ status: 204 }) }),
    /alert_webhook_secret_missing_or_weak/
  );

  const deliveredState = join(temp, 'delivered.json');
  const sent = [];
  const fetchImpl = async (url, request) => {
    sent.push({ url, request });
    return { status: 204 };
  };
  const delivered = await deliverObservabilityAlert(breachReport, { ...options(deliveredState), fetchImpl });
  assert.equal(delivered.status, 'delivered');
  assert.equal(delivered.externalDeliveryAttempted, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, endpoint);
  assert.equal(sent[0].request.headers['idempotency-key'], delivered.eventId);
  const body = sent[0].request.body;
  const timestamp = sent[0].request.headers['x-primetime-timestamp'];
  const expectedSignature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  assert.equal(sent[0].request.headers['x-primetime-signature'], `sha256=${expectedSignature}`);
  assert.deepEqual(JSON.parse(body).failedSlos.map(item => item.id).sort(), breachReport.slos.map(item => item.id).sort());
  const stored = JSON.parse(await readFile(deliveredState, 'utf8'));
  assert.equal(stored.lastDeliveredEventId, delivered.eventId);
  assert.equal(JSON.stringify(stored).includes(secret), false, 'dedup state must not contain the signing secret');

  const repeated = await deliverObservabilityAlert(breachReport, { ...options(deliveredState), fetchImpl });
  assert.equal(repeated.status, 'duplicate');
  assert.equal(repeated.externalDeliveryAttempted, false);
  assert.equal(sent.length, 1, 'the same active breach must be sent once');

  assert.equal((await deliverObservabilityAlert(passReport, { ...options(deliveredState), fetchImpl })).status, 'no_alert');
  const recurrence = await deliverObservabilityAlert(breachReport, { ...options(deliveredState), fetchImpl });
  assert.equal(recurrence.status, 'delivered');
  assert.notEqual(recurrence.eventId, delivered.eventId, 'a breach after recovery must open a new generation');
  assert.equal(sent.length, 2);

  const errorState = join(temp, 'http-error.json');
  await assert.rejects(
    deliverObservabilityAlert(breachReport, { ...options(errorState), fetchImpl: async () => ({ status: 503 }) }),
    /alert_delivery_http_503/
  );
  await assert.rejects(readFile(errorState, 'utf8'), error => error?.code === 'ENOENT');

  const networkState = join(temp, 'network-error.json');
  await assert.rejects(
    deliverObservabilityAlert(breachReport, { ...options(networkState), fetchImpl: async () => { throw new Error('fixture_network'); } }),
    /alert_delivery_network_error/
  );
  await assert.rejects(readFile(networkState, 'utf8'), error => error?.code === 'ENOENT');

  const timeoutState = join(temp, 'timeout.json');
  const timeoutFetch = async (_url, request) => new Promise((_resolve, reject) => {
    const keepAlive = setTimeout(() => reject(new Error('fixture_timeout_not_aborted')), 1000);
    request.signal.addEventListener('abort', () => {
      clearTimeout(keepAlive);
      reject(request.signal.reason);
    }, { once: true });
  });
  await assert.rejects(
    deliverObservabilityAlert(breachReport, { ...options(timeoutState), timeoutMs: 10, fetchImpl: timeoutFetch }),
    /alert_delivery_timeout/
  );
  await assert.rejects(readFile(timeoutState, 'utf8'), error => error?.code === 'ENOENT');

  const invalidState = join(temp, 'invalid.json');
  await writeFile(invalidState, '{broken', 'utf8');
  await assert.rejects(
    deliverObservabilityAlert(breachReport, { ...options(invalidState), fetchImpl }),
    /alert_state_invalid/
  );
  assert.equal(sent.length, 2, 'invalid dedup state must fail closed before sending');
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log('PrimeTime Pro observability alert webhook tests: PASS');
