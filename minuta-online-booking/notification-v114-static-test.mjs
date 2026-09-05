import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, '..');
const [migration, rollback, dispatcher, adapters, clientFunction, center, dispatcherReadme] = await Promise.all([
  readFile(path.join(directory, 'supabase-migration-v114.sql'), 'utf8'),
  readFile(path.join(directory, 'supabase-migration-v114-rollback.sql'), 'utf8'),
  readFile(path.join(repository, 'supabase/functions/notification-dispatcher/index.ts'), 'utf8'),
  readFile(path.join(repository, 'supabase/functions/notification-dispatcher/adapters.ts'), 'utf8'),
  readFile(path.join(directory, 'supabase/functions/telegram-client-notify/index.ts'), 'utf8'),
  readFile(path.join(directory, 'notification-center.js'), 'utf8'),
  readFile(path.join(repository, 'supabase/functions/notification-dispatcher/README.md'), 'utf8'),
]);

assert.match(migration, /v114_requires_complete_v88_notification_center/i);
assert.match(migration, /add column if not exists delivered_at timestamptz/i);
assert.match(migration, /delivery_receipt_source is not null/i, 'delivered must require channel evidence');
assert.match(migration, /client_telegram_subscription_sync_v114/i);
assert.match(migration, /consent_source='telegram_start'/i);
assert.match(migration, /telegram_notification_log legacy/i, 'legacy direct sends must be reconciled before queue rollout');
assert.match(migration, /booking_cancelled_before_send/i);
assert.match(migration, /booking_time_superseded/i);
assert.match(migration, /notification_event_stale/i);
assert.match(migration, /queue\.audience='provider' or endpoint\.destination is not null/i, 'unconnected clients must stay unclaimed');
assert.match(migration, /on conflict\(organization_id,audience,subject_key,channel\) do update/i);
assert.match(migration, /ack_minuta_notification_outbox_v114/i);
assert.match(migration, /confirm_minuta_notification_delivery_v114/i);
assert.match(migration, /deactivate_minuta_notification_endpoint_v114/i);
assert.match(migration, /get_minuta_client_notification_state_v114/i);
assert.match(migration, /notification_v114_organization_cutovers/i);
assert.match(migration, /activate_minuta_notification_v114_cutover/i);
assert.match(migration, /notification_v114_worker_readiness/i);
assert.match(migration, /v114_telegram_client_bridge_not_ready/i);
assert.match(migration, /is_minuta_legacy_client_notification_allowed_v114/i);
assert.match(migration, /record_minuta_legacy_notification_delivery_v114/i);
assert.match(migration, /telegram-client-reminders-hourly/i);
assert.match(migration, /v114_requires_active_notification_dispatcher_cron/i);
assert.match(migration, /jobname='minuta-notification-dispatcher'/i);
assert.match(migration, /schedule='\* \* \* \* \*'/i);
assert.match(migration, /remaining_legacy_organizations/i);
assert.match(migration, /if v_remaining=0[\s\S]*cron\.unschedule/i, 'legacy cron must stop only after the last organization cutover');
for (const event of ['booking_created', 'booking_confirmed', 'booking_rescheduled', 'booking_cancelled', 'booking_reminder']) {
  assert.match(migration, new RegExp(event), `event ${event} must remain represented`);
}

assert.match(dispatcher, /request\.method === "GET"/);
assert.match(dispatcher, /configured_channels: available/);
assert.match(dispatcher, /provider_telegram_fallback/);
assert.match(dispatcher, /ack_minuta_notification_outbox_v114/);
assert.match(dispatcher, /deactivate_minuta_notification_endpoint_v114/);
assert.match(adapters, /deliveryState: "sent"/);
assert.match(adapters, /state !== "delivered"/);
assert.match(adapters, /receiptSource/);

const eventReporter = clientFunction.slice(
  clientFunction.indexOf('async function sendBookingEvent'),
  clientFunction.indexOf('async function telegramAuthConfig')
);
assert.match(eventReporter, /get_minuta_client_notification_state_v114/);
assert.doesNotMatch(eventReporter, /telegram\("sendMessage"/, 'browser event endpoint must not bypass the queue');
assert.match(clientFunction, /legacySendBookingEvent/);
assert.match(clientFunction, /is_minuta_notification_v114_cutover/);
assert.match(clientFunction, /is_minuta_legacy_client_notification_allowed_v114/);
assert.match(clientFunction, /record_minuta_legacy_notification_delivery_v114/);
assert.match(clientFunction, /unified_skipped/);
assert.match(clientFunction, /cutover-ready/);
assert.match(clientFunction, /mark_minuta_notification_worker_ready_v114/);
assert.match(clientFunction, /telegram_write_access_required/);
assert.match(clientFunction, /Deno\.serve\(/);

assert.match(center, /sent:'отправлено'/);
assert.match(center, /item\.delivered_at \? 'доставлено'/);
assert.match(center, /Шлюз канала не настроен/);
assert.match(center, /Клиент подключает канал сам/);
assert.doesNotMatch(dispatcher + adapters + clientFunction, /\b\d{6,}:[A-Za-z0-9_-]{20,}\b/);

assert.match(rollback, /v114_rollback_requires_active_notification_dispatcher_cron/i);
assert.match(rollback, /v114_rollback_requires_active_legacy_cron/i);
assert.match(rollback, /create or replace function public\.claim_minuta_notification_outbox/i);
assert.match(rollback, /create or replace function public\.get_minuta_notification_workspace/i);
assert.match(rollback, /drop trigger if exists client_telegram_subscription_sync_v114/i);
assert.match(rollback, /compatibility shim retained/i);
assert.match(rollback, /notification_v114_organization_cutovers/i);
assert.match(rollback, /v114_cutover_paused_by_rollback/i);
assert.doesNotMatch(rollback, /cron\.unschedule/i, 'rollback must preserve the current gradual-cutover cron state');
assert.doesNotMatch(rollback, /cron\.schedule/i, 'rollback must not recreate the retired sender');
assert.doesNotMatch(rollback, /drop\s+(table|column)/i, 'rollback must preserve queue schema and data');
assert.doesNotMatch(rollback, /truncate|delete\s+from\s+public\.notification_outbox/i, 'rollback must preserve queued events');
assert.match(dispatcherReadme, /activate_organization/i);
assert.match(dispatcherReadme, /supabase-migration-v114-rollback\.sql/i);
assert.match(dispatcher, /body\.dry_run === true/);
assert.match(dispatcher, /activate_minuta_notification_v114_cutover/);

console.log('Notification v114 static checks passed.');
