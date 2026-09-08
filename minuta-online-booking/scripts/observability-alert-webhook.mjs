import { createHash, createHmac, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const ALERT_CONFIRMATION = 'DELIVER_PRIMETIME_ALERTS';
const STATE_SCHEMA_VERSION = 1;
const PAYLOAD_SCHEMA_VERSION = 1;
const DEFAULT_TIMEOUT_MS = 10_000;

function enabled(value) {
  return value === true || String(value || '').trim().toLowerCase() === 'true';
}

function requireWebhookUrl(value) {
  let parsed;
  try { parsed = new URL(String(value || '').trim()); } catch { throw new Error('alert_webhook_url_invalid'); }
  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password || parsed.hash) {
    throw new Error('alert_webhook_url_invalid');
  }
  return parsed.href;
}

function requireSecret(value) {
  const secret = String(value || '');
  if (secret.length < 32) throw new Error('alert_webhook_secret_missing_or_weak');
  return secret;
}

function timeoutMilliseconds(value) {
  const parsed = Number(value || DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(parsed)) return DEFAULT_TIMEOUT_MS;
  return Math.max(10, Math.min(30_000, Math.round(parsed)));
}

function initialState() {
  return { schemaVersion: STATE_SCHEMA_VERSION, generation: 0, activeFingerprint: null, lastDeliveredEventId: null };
}

async function readState(statePath) {
  try {
    const state = JSON.parse(await readFile(resolve(statePath), 'utf8'));
    if (state?.schemaVersion !== STATE_SCHEMA_VERSION
      || !Number.isSafeInteger(state.generation) || state.generation < 0
      || ![null, 'string'].includes(state.activeFingerprint === null ? null : typeof state.activeFingerprint)
      || ![null, 'string'].includes(state.lastDeliveredEventId === null ? null : typeof state.lastDeliveredEventId)) {
      throw new Error('alert_state_invalid');
    }
    return state;
  } catch (error) {
    if (error?.code === 'ENOENT') return initialState();
    if (error?.message === 'alert_state_invalid') throw error;
    throw new Error('alert_state_invalid');
  }
}

async function writeState(statePath, state) {
  const target = resolve(statePath);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, target);
}

function failedSloIds(report) {
  if (!report || typeof report !== 'object' || !Array.isArray(report.slos) || typeof report.alertPreview?.wouldFire !== 'boolean') {
    throw new Error('alert_report_invalid');
  }
  const failed = report.slos.filter(item => item?.status === 'fail');
  if (report.alertPreview.wouldFire !== (failed.length > 0)) throw new Error('alert_report_inconsistent');
  return [...new Set(failed.map(item => String(item.id || '').trim()).filter(Boolean))].sort();
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function deliveryPayload(report, failedIds, fingerprint, eventId, now) {
  const failedById = new Map(report.slos.filter(item => item?.status === 'fail').map(item => [String(item.id), item]));
  return {
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    type: 'primetime.observability.slo_breach',
    eventId,
    generatedAt: now.toISOString(),
    reportGeneratedAt: String(report.generatedAt || ''),
    incidentFingerprint: fingerprint,
    failedSlos: failedIds.map(id => ({ id, observed: String(failedById.get(id)?.observed || '') })).slice(0, 20)
  };
}

export async function deliverObservabilityAlert(report, options = {}) {
  if (!enabled(options.enabled)) return { status: 'disabled', externalDeliveryAttempted: false };
  if (String(options.confirmation || '') !== ALERT_CONFIRMATION) throw new Error('alert_delivery_confirmation_missing');

  const endpoint = requireWebhookUrl(options.endpoint);
  const secret = requireSecret(options.secret);
  if (!options.statePath) throw new Error('alert_state_path_missing');
  const failedIds = failedSloIds(report);
  const state = await readState(options.statePath);
  const now = new Date(options.now || new Date().toISOString());
  if (!Number.isFinite(now.getTime())) throw new Error('alert_timestamp_invalid');

  if (!failedIds.length) {
    if (state.activeFingerprint !== null) {
      state.generation += 1;
      state.activeFingerprint = null;
      state.lastDeliveredEventId = null;
      state.lastResolvedAt = now.toISOString();
      await writeState(options.statePath, state);
    }
    return { status: 'no_alert', externalDeliveryAttempted: false };
  }

  const fingerprint = sha256(JSON.stringify({ failedSloIds: failedIds }));
  const eventId = sha256(`primetime-observability:${state.generation}:${fingerprint}`);
  if (state.activeFingerprint === fingerprint && state.lastDeliveredEventId === eventId) {
    return { status: 'duplicate', eventId, externalDeliveryAttempted: false };
  }

  const payload = deliveryPayload(report, failedIds, fingerprint, eventId, now);
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(now.getTime() / 1000));
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('alert_fetch_unavailable');

  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': eventId,
        'user-agent': 'primetime-pro-observability-alert/1',
        'x-primetime-event': payload.type,
        'x-primetime-timestamp': timestamp,
        'x-primetime-signature': `sha256=${signature}`
      },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMilliseconds(options.timeoutMs))
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw new Error('alert_delivery_timeout');
    throw new Error('alert_delivery_network_error');
  }
  if (!response || !Number.isInteger(response.status) || response.status < 200 || response.status >= 300) {
    const status = Number.isInteger(response?.status) ? response.status : 0;
    throw new Error(`alert_delivery_http_${status}`);
  }

  state.activeFingerprint = fingerprint;
  state.lastDeliveredEventId = eventId;
  state.lastDeliveredAt = now.toISOString();
  await writeState(options.statePath, state);
  return { status: 'delivered', eventId, externalDeliveryAttempted: true };
}

function parseArguments(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) throw new Error(`unknown_argument_${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing_value_${key.slice(2)}`);
    args[key.slice(2)] = value;
    index += 1;
  }
  return args;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (!args.report) throw new Error('alert_report_path_missing');
  const report = JSON.parse(await readFile(resolve(args.report), 'utf8'));
  const result = await deliverObservabilityAlert(report, {
    enabled: process.env.MINUTA_OBSERVABILITY_ALERT_ENABLED,
    confirmation: process.env.MINUTA_OBSERVABILITY_ALERT_CONFIRMATION,
    endpoint: process.env.MINUTA_OBSERVABILITY_ALERT_WEBHOOK_URL,
    secret: process.env.MINUTA_OBSERVABILITY_ALERT_WEBHOOK_SECRET,
    timeoutMs: process.env.MINUTA_OBSERVABILITY_ALERT_TIMEOUT_MS,
    statePath: args.state
  });
  console.log(`PrimeTime Pro observability alert: ${JSON.stringify(result)}`);
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) main().catch(error => {
  console.error(`PrimeTime Pro observability alert: ERROR; ${error?.message || error}`);
  process.exitCode = 1;
});
