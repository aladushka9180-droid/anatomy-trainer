import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = relative => readFileSync(new URL(relative, import.meta.url), 'utf8');
const migration = read('./supabase-migration-v142.sql');
const rollback = read('./supabase-migration-v142-rollback.sql');
const api = read('../supabase/functions/primetime-integration-api/handler.ts');
const apiDocs = read('../supabase/functions/primetime-integration-api/README.md');
const dispatcher = read('../supabase/functions/primetime-webhook-dispatcher/handler.ts');
const dispatcherDocs = read('../supabase/functions/primetime-webhook-dispatcher/README.md');

for (const table of [
  'integration_connections_v142',
  'integration_api_keys_v142',
  'integration_rate_limits_v142',
  'integration_booking_revisions_v142',
  'integration_calendar_events_v142',
  'integration_request_receipts_v142',
  'integration_webhook_subscriptions_v142',
  'integration_webhook_outbox_v142'
]) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${table}\\b`, 'i'), `missing ${table}`);
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'), `RLS missing for ${table}`);
  assert.match(rollback, new RegExp(`drop table if exists public\\.${table}`, 'i'), `rollback missing ${table}`);
}

for (const signature of [
  'authenticate_minuta_integration_key_v142(uuid,text,text,text)',
  'consume_minuta_integration_rate_limit_v142(uuid,uuid,text)',
  'get_minuta_integration_calendar_v142(uuid,timestamptz,timestamptz,integer,timestamptz,uuid)',
  'upsert_minuta_integration_calendar_event_v142(uuid,text,text,text,uuid,uuid,timestamptz,timestamptz,text,text)',
  'delete_minuta_integration_calendar_event_v142(uuid,text,text,text,text)',
  'lease_minuta_integration_webhooks_v142(integer,uuid)',
  'settle_minuta_integration_webhook_v142(uuid,uuid,text,integer,text)'
]) {
  assert.ok(rollback.includes(`drop function if exists public.${signature}`), `rollback missing ${signature}`);
}

assert.match(migration, /scopes<@array\['calendar:read','calendar:write'\]/i);
assert.match(migration, /secret_sha256 text not null unique check\(secret_sha256~'\^\[0-9a-f\]\{64\}\$'\)/i);
assert.match(migration, /grant execute on function public\.authenticate_minuta_integration_key_v142[\s\S]*to service_role/i);
assert.doesNotMatch(migration, /grant\s+(?:select|insert|update|delete|all)[^;]+integration_[a-z_]+_v142[^;]+to\s+(?:anon|authenticated|service_role)/i);
assert.match(migration, /integration_calendar_block',true[\s\S]*notifications_suppressed',true/i);
assert.match(migration, /p_expected_revision<>v_mapping\.source_revision/i);
assert.match(migration, /v_receipt\.payload_sha256<>p_payload_sha256[\s\S]*request_conflict/i);
assert.match(migration, /booking_policy_snapshot->>'integration_calendar_block'/i);
assert.match(migration, /aa_bookings_touch_integration_revision_v142/i);
assert.doesNotMatch(migration, /booking\.updated_at|new\.updated_at|set status='cancelled',updated_at/i);
assert.match(migration, /booking\.organization_id=v_connection\.organization_id/i);
assert.match(migration, /subscription\.organization_id=new\.organization_id/i);
assert.doesNotMatch(migration, /aggregate_id uuid not null references public\.bookings/i);
assert.match(migration, /jsonb_build_object\([\s\S]*'booking'[\s\S]*'performerId'[\s\S]*'status'/i);
assert.doesNotMatch(migration.match(/create or replace function public\.enqueue_minuta_integration_booking_webhooks_v142[\s\S]*?end\n\$\$;/i)?.[0] || '', /client_name|client_phone|provider_note|manage_token/i);
assert.match(rollback, /v142_rollback_blocked_integration_data_exists/i);
assert.doesNotMatch(rollback, /\bcascade\b/i);

for (const token of [
  'PRIMETIME_INTEGRATION_ENABLED',
  'authenticate_minuta_integration_key_v142',
  'calendar:read',
  'calendar:write',
  'idempotency-key',
  'if-match',
  'revision_conflict'
]) assert.ok(api.toLowerCase().includes(token.toLowerCase()), `API missing ${token}`);

assert.match(api, /sha256Hex\(match\[2\]\)/);
assert.doesNotMatch(api, /console\.(?:log|error|warn)/);
assert.match(apiDocs, /disabled by default/i);
assert.match(apiDocs, /never\s+stored in plaintext/i);
assert.match(apiDocs, /old calendar replay cannot overwrite a newer/i);

for (const token of [
  'PRIMETIME_WEBHOOK_DISPATCH_ENABLED',
  'PRIMETIME_WEBHOOK_DESTINATIONS',
  'lease_minuta_integration_webhooks_v142',
  'settle_minuta_integration_webhook_v142',
  'x-primetime-signature',
  'HMAC',
  'redirect: "error"'
]) assert.ok(dispatcher.includes(token), `dispatcher missing ${token}`);
assert.doesNotMatch(dispatcher, /console\.(?:log|error|warn)/);
assert.match(dispatcherDocs, /disabled by default/i);
assert.match(dispatcherDocs, /omit names, phone numbers, notes, management tokens and payment details/i);

console.log('PrimeTime integration contour v142 static checks: PASS');
