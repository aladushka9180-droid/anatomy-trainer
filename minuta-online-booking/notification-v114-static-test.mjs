import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, '..');
const [migration, dispatcher, adapters, clientFunction, center] = await Promise.all([
  readFile(path.join(directory, 'supabase-migration-v114.sql'), 'utf8'),
  readFile(path.join(repository, 'supabase/functions/notification-dispatcher/index.ts'), 'utf8'),
  readFile(path.join(repository, 'supabase/functions/notification-dispatcher/adapters.ts'), 'utf8'),
  readFile(path.join(directory, 'supabase/functions/telegram-client-notify/index.ts'), 'utf8'),
  readFile(path.join(directory, 'notification-center.js'), 'utf8'),
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
assert.match(migration, /telegram-client-reminders-hourly/i);
assert.match(migration, /cron\.unschedule/i, 'legacy direct reminder cron must be retired');
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
assert.match(clientFunction, /retired_use_notification_dispatcher/);
assert.match(clientFunction, /telegram_write_access_required/);
assert.match(clientFunction, /Deno\.serve\(/);

assert.match(center, /sent:'отправлено'/);
assert.match(center, /item\.delivered_at \? 'доставлено'/);
assert.match(center, /Шлюз канала не настроен/);
assert.match(center, /Клиент подключает канал сам/);
assert.doesNotMatch(dispatcher + adapters + clientFunction, /\b\d{6,}:[A-Za-z0-9_-]{20,}\b/);

console.log('Notification v114 static checks passed.');
