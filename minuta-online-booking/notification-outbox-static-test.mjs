import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, '..');
const [migration, provider, providerHtml, worker, config, documentation] = await Promise.all([
  readFile(path.join(directory, 'supabase-migration-v46.sql'), 'utf8'),
  readFile(path.join(directory, 'provider.js'), 'utf8'),
  readFile(path.join(directory, 'provider.html'), 'utf8'),
  readFile(path.join(repository, 'supabase/functions/process-notifications/index.ts'), 'utf8'),
  readFile(path.join(repository, 'supabase/config.toml'), 'utf8'),
  readFile(path.join(repository, 'supabase/functions/process-notifications/README.md'), 'utf8')
]);

for (const state of ['pending', 'sending', 'sent', 'failed']) {
  assert.match(migration, new RegExp(`\\b${state}\\b`), `outbox state ${state} must exist`);
}
assert.match(migration, /event_key text not null unique/);
assert.match(migration, /after insert on public\.bookings/i);
assert.match(migration, /on conflict \(event_key\) do nothing/i);
assert.match(migration, /for update skip locked/i);
assert.match(migration, /queue\.locked_at < now\(\) - interval '15 minutes'/i);
assert.match(migration, /power\(2,/i);
assert.match(migration, /v_attempt < 8/i);
assert.match(migration, /last_error_code/i);
assert.match(migration, /notification_delivery_attempts/i);
assert.match(migration, /queue\.performer_id = auth\.uid\(\)/i);
assert.match(migration, /queue\.status = 'failed'/i);
assert.match(migration, /grant execute on function public\.retry_notification_outbox\(uuid\) to authenticated/i);
assert.match(migration, /queue\.performer_id = p_performer/i);
assert.match(migration, /grant execute on function public\.claim_notification_outbox\(uuid, integer\) to service_role/i);
assert.doesNotMatch(migration, /grant execute on function public\.(?:claim|ack|fail)_notification_outbox[^;]+to (?:anon|authenticated)/i);

assert.match(providerHtml, /id="automaticNotificationPanel"/);
assert.match(providerHtml, /id="automaticNotificationList"/);
assert.match(provider, /retry_notification_outbox/);
assert.match(provider, /data-retry-notification-outbox/);
assert.match(provider, /notificationOutboxRemoteAvailable/);
assert.match(provider, /db\.from\('notification_marks'\)/, 'legacy WhatsApp marks must remain supported');

assert.match(config, /\[functions\.process-notifications\][\s\S]*verify_jwt = false/);
assert.match(worker, /NOTIFICATION_WORKER_SECRET/);
assert.match(worker, /TELEGRAM_BOT_TOKEN/);
assert.match(worker, /TELEGRAM_CHAT_ID/);
assert.match(worker, /TELEGRAM_PERFORMER_ID/);
assert.match(worker, /job\.performer_id !== performerId/);
assert.match(worker, /claim_notification_outbox/);
assert.match(worker, /ack_notification_outbox/);
assert.match(worker, /fail_notification_outbox/);
assert.match(worker, /x-worker-secret/);
assert.match(worker, /replaceAll\(botToken, "\[redacted\]"\)/);
assert.doesNotMatch(worker, /\b\d{6,}:[A-Za-z0-9_-]{20,}\b/, 'a Telegram bot token must never be committed');
assert.match(documentation, /как минимум один раз/i);
assert.match(documentation, /Supabase Vault/);

console.log('Notification outbox static checks passed.');
