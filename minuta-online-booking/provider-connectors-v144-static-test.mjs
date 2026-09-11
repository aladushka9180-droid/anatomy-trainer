import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = relative => readFileSync(new URL(relative, import.meta.url), 'utf8');
const payment = read('./payment-management.js');
const migration = read('./supabase-migration-v144-payment-connectors.sql');
const rollback = read('./supabase-migration-v144-payment-connectors-rollback.sql');
const integration = read('./tests/provider-connectors-v144-integration.sql');
const handler = read('../supabase/functions/primetime-provider-inbound-v144/handler.ts');
const docs = read('../supabase/functions/primetime-provider-inbound-v144/README.md');

for (const table of [
  'payment_sandbox_ledgers_v144',
  'payment_sandbox_commands_v144',
  'integration_provider_events_v144'
]) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${table}\\b`, 'i'));
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
  assert.match(rollback, new RegExp(`drop table if exists public\\.${table}`, 'i'));
}

for (const signature of [
  'apply_minuta_payment_sandbox_v144(uuid,uuid,uuid,text,integer,text,bigint,text)',
  'get_minuta_payment_sandbox_journal_v144(uuid,uuid)',
  'record_minuta_provider_event_v144(uuid,uuid,text,text,text,jsonb)',
  'settle_minuta_provider_event_v144(uuid,text,jsonb,text)',
  'get_minuta_provider_connector_read_model_v144(uuid,integer)'
]) {
  assert.match(migration, new RegExp(`revoke all on function public\\.${signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'));
  assert.ok(rollback.includes(`drop function if exists public.${signature}`), `rollback missing ${signature}`);
}

assert.match(migration, /v_connection\.environment<>'testing'/i);
assert.match(migration, /sandbox_payment_idempotency_conflict/i);
assert.match(migration, /provider_event_idempotency_conflict/i);
assert.match(migration, /grant execute on function public\.record_minuta_provider_event_v144[\s\S]*to service_role/i);
assert.doesNotMatch(migration, /grant\s+(?:select|insert|update|delete|all)[^;]+(?:payment_sandbox|integration_provider_events)[^;]+to\s+(?:anon|authenticated|service_role)/i);
assert.match(rollback, /v144_rollback_blocked_payment_or_provider_data_exists/i);
assert.doesNotMatch(rollback, /\bcascade\b/i);

const readModel = migration.match(/create or replace function public\.get_minuta_provider_connector_read_model_v144[\s\S]*?\n\$\$;/i)?.[0] || '';
for (const field of [
  'organizationId', 'currentRole', 'connections', 'recentEvents', 'connectionId', 'provider', 'environment',
  'externalAccountId', 'status', 'enabled', 'eventType', 'state', 'receivedAt'
]) assert.ok(readModel.includes(`'${field}'`), `read model missing ${field}`);
assert.match(readModel, /require_minuta_integration_owner_v142\(p_organization\)/i);
assert.match(readModel, /membership\.role[\s\S]*membership\.user_id=v_actor[\s\S]*membership\.active/i);
assert.doesNotMatch(readModel, /secret_ref|payload_sha256|provider_event_id|idempotency|\bcommand\b|\bresult\b/i);
assert.match(migration, /grant execute on function public\.get_minuta_provider_connector_read_model_v144\(uuid,integer\)[\s\S]*to authenticated/i);
assert.match(migration, /jsonb_array_elements\(p_command->'serviceExternalIds'\)/i);
assert.match(migration, /key not in\('outcome','localBookingId','revision'\)/i);
assert.match(integration, /owner_admin_read_model_scope/);
assert.match(integration, /read_model_is_anonymized/);
assert.match(integration, /sandbox_exact_replay/);
assert.match(integration, /provider_event_exact_replay/);

assert.match(payment, /createSandboxPaymentState/);
assert.match(payment, /applySandboxPaymentCommand/);
assert.match(payment, /sandbox_idempotency_conflict/);
assert.doesNotMatch(payment.match(/function createSandboxPaymentState[\s\S]*?\n  }/i)?.[0] || '', /fetch\(|functions\.invoke|\.rpc\(/i);

for (const token of [
  'PRIMETIME_PROVIDER_INBOUND_V144_ENABLED',
  'PRIMETIME_PROVIDER_INBOUND_V144_ENVIRONMENT',
  'PRIMETIME_PROVIDER_INBOUND_V144_CONNECTIONS',
  'MAX_CLOCK_SKEW_SECONDS',
  'x-primetime-provider-signature',
  'record_minuta_provider_event_v144',
  'primetime.dikidi.booking.v1',
  'refresh_booking'
]) assert.ok(handler.includes(token), `handler missing ${token}`);

assert.match(handler, /hmacHex\(connection\.secret, `\$\{timestamp\}\.\$\{rawBody\}`\)/);
assert.doesNotMatch(handler, /console\.(?:log|error|warn)|api\.dikidi|api\.yclients|yclients\.com|dikidi\.net/i);
assert.match(docs, /disabled[\s\S]*testing-only|testing-only[\s\S]*disabled/i);
assert.match(docs, /does not call either vendor/i);
assert.match(docs, /operator-controlled gateway[\s\S]*both\s+providers/i);

for (const protectedFile of ['provider.js', 'provider.html', 'styles.css', 'sw.js']) {
  assert.equal(read(`./${protectedFile}`).includes('primetime-provider-inbound-v144'), false);
}

console.log('PrimeTime payment and provider connectors v144 static checks: PASS');
