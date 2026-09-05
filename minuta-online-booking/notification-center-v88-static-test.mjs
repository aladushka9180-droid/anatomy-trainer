import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, '..');
const [migration, rollback, dispatcher, adapters, config] = await Promise.all([
  readFile(path.join(directory, 'supabase-migration-v88.sql'), 'utf8'),
  readFile(path.join(directory, 'recovery/rollback-notification-center-v88.sql'), 'utf8'),
  readFile(path.join(repository, 'supabase/functions/notification-dispatcher/index.ts'), 'utf8'),
  readFile(path.join(repository, 'supabase/functions/notification-dispatcher/adapters.ts'), 'utf8'),
  readFile(path.join(repository, 'supabase/config.toml'), 'utf8'),
]);

assert.match(migration, /organization_payment_provider_settings/i, 'v88 must follow the canonical v87 marker');
assert.match(migration, /get_minuta_payment_workspace\(uuid\)/i);
assert.match(migration, /organization_notification_settings[\s\S]*enabled boolean not null default false/i);
assert.match(migration, /organization_notification_channels[\s\S]*enabled boolean not null default false/i);
for (const channel of ['telegram', 'email', 'sms', 'max', 'push']) {
  assert.match(migration, new RegExp(`['"]${channel}['"]`, 'i'), `channel ${channel} must exist`);
}
assert.match(migration, /on conflict\s*\(event_key\) do nothing/i, 'the existing durable event key must remain the idempotency key');
assert.doesNotMatch(migration, /['"]manage_token['"]\s*,\s*v_booking\.manage_token/i, 'manage_token must never be copied into notification payloads');
assert.match(migration, /dispatcher in \('legacy_provider_telegram', 'unified'\)/i);
assert.match(migration, /dispatcher='legacy_provider_telegram'[\s\S]*audience='provider'[\s\S]*channel='telegram'/i, 'legacy worker must not claim unified jobs');
assert.match(migration, /for update of queue skip locked/i);
assert.match(migration, /queue\.locked_at<now\(\)-interval '15 minutes'/i);
assert.match(migration, /notification_delivery_attempts/i);
assert.match(migration, /notification_recipient_endpoints[\s\S]*enable row level security/i);
assert.match(migration, /revoke all on public\.organization_notification_settings[\s\S]*notification_recipient_endpoints from public, anon, authenticated/i);
assert.match(migration, /grant all on public\.organization_notification_settings[\s\S]*notification_recipient_endpoints to service_role/i);
assert.match(migration, /grant execute on function public\.claim_minuta_notification_outbox\(text\[\],integer\) to service_role/i);
assert.doesNotMatch(migration, /grant execute on function public\.claim_minuta_notification_outbox[^;]+to (?:anon|authenticated)/i);
assert.match(migration, /retry_notification_outbox[\s\S]*queue\.status='failed'[\s\S]*has_organization_role/i);
assert.match(migration, /client_telegram_subscriptions[\s\S]*telegram_start/i, 'existing Telegram consent must be preserved');

assert.match(config, /\[functions\.notification-dispatcher\][\s\S]*verify_jwt = false/i);
assert.match(dispatcher, /NOTIFICATION_DISPATCHER_SECRET/);
assert.match(dispatcher, /x-worker-secret/i);
assert.match(dispatcher, /error: "not_configured"/);
assert.match(dispatcher, /claim_minuta_notification_outbox/);
assert.match(dispatcher, /ack_(?:minuta_)?notification_outbox/);
assert.match(dispatcher, /fail_notification_outbox/);
assert.match(dispatcher, /Deno\.serve\(/);
assert.match(adapters, /"idempotency-key": job\.event_key/i);
assert.match(adapters, /recipient_not_configured/);
assert.match(adapters, /TELEGRAM_BOT_TOKEN/);
assert.match(adapters, /email: gateway\("EMAIL"\)/);
assert.match(adapters, /sms: gateway\("SMS"\)/);
assert.match(adapters, /max: gateway\("MAX"\)/);
assert.match(adapters, /push: gateway\("PUSH"\)/);
assert.doesNotMatch(dispatcher + adapters, /\b\d{6,}:[A-Za-z0-9_-]{20,}\b/, 'secrets must not be committed');

assert.match(rollback, /v88_rollback_requires_empty_unified_outbox/i);
assert.match(rollback, /drop table if exists public\.notification_recipient_endpoints/i);
assert.match(rollback, /drop table if exists public\.organization_notification_channels/i);
assert.match(rollback, /drop table if exists public\.organization_notification_settings/i);

console.log('Notification center v88 static checks passed.');
