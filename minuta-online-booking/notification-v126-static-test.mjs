import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const migration=read('./supabase-migration-v126.sql');
const rollback=read('./supabase-migration-v126-rollback.sql');
const dispatcher=read('../supabase/functions/notification-dispatcher/index.ts');
const adapters=read('../supabase/functions/notification-dispatcher/adapters.ts');
const receipt=read('../supabase/functions/notification-receipt/index.ts');
const config=read('../supabase/config.toml');
const workflow=read('../.github/workflows/minuta-v126-safe-release.yml');

assert.match(migration,/v126_requires_notification_v114_and_v125/i);
assert.match(migration,/booking_confirmation_request_enabled boolean not null default false/i);
assert.match(migration,/quiet_hours_enabled boolean not null default false/i);
assert.match(migration,/quiet_hours_timezone text not null default 'Europe\/Samara'/i);
assert.match(migration,/pg_catalog\.pg_timezone_names/i);
assert.match(migration,/minuta_notification_next_allowed_at_v126\([\s\S]*at time zone v_timezone/i);
assert.match(migration,/greatest\(queue\.next_attempt_at,now\(\)\)\)<=now\(\)/i);
assert.match(migration,/booking_confirmation_request[\s\S]*confirmation_request_minutes_before/i);
assert.match(migration,/enqueue_due_minuta_booking_confirmation_requests_v126/i);
assert.match(migration,/p_kind<>'booking_confirmation_request' or channel\.audience='client'/i);

assert.match(migration,/create table if not exists public\.organization_notification_fallbacks/i);
assert.doesNotMatch(migration,/v126_notification_kind_already_extended/i);
assert.match(migration,/enabled boolean not null default false/i);
assert.match(migration,/check\(primary_channel<>fallback_channel\)/i);
assert.match(migration,/v_job\.fallback_depth=0/i);
assert.match(migration,/v_error_code not like '%delivery_unknown%'/i);
assert.match(migration,/fallback_of,fallback_depth/i);
assert.match(migration,/foreign key\(fallback_of\)[\s\S]*on delete restrict/i);
assert.match(migration,/exists\(select 1 from public\.notification_recipient_endpoints/i);
assert.match(migration,/confirm_minuta_notification_delivery_v126\(\s*p_outbox uuid,p_event_key text,p_organization uuid,p_channel text/i);
assert.match(migration,/queue\.id=p_outbox and queue\.event_key=p_event_key[\s\S]*queue\.organization_id=p_organization and queue\.channel=p_channel[\s\S]*queue\.provider_message_id=v_message_id/i);
assert.doesNotMatch(migration,/confirm_minuta_notification_delivery_v126[\s\S]*order by queue\.sent_at desc limit 1/i);
assert.match(migration,/grant execute on function public\.set_minuta_notification_fallback_v126[\s\S]*to authenticated/i);
assert.doesNotMatch(migration,/grant (insert|update|delete).*organization_notification_fallbacks.*authenticated/i);

assert.match(rollback,/v126_rollback_blocked_by_active_notification_policy_or_history/i);
assert.match(rollback,/drop table public\.organization_notification_fallbacks/i);
assert.match(rollback,/drop column if exists booking_confirmation_request_enabled/i);
assert.match(rollback,/booking_created','booking_confirmed','booking_rescheduled','booking_cancelled','booking_reminder'/i);
assert.match(rollback,/create or replace function public\.enqueue_due_minuta_booking_confirmation_requests_v126[\s\S]*return 0/i);
assert.match(rollback,/create or replace function public\.confirm_minuta_notification_delivery_v126[\s\S]*return 'not_found'/i);
assert.doesNotMatch(rollback,/drop function public\.enqueue_due_minuta_booking_confirmation_requests_v126/i);
assert.doesNotMatch(rollback,/delete from public\.(notification_outbox|organization_notification_fallbacks)/i);

assert.match(dispatcher,/enqueue_due_minuta_booking_confirmation_requests_v126/);
assert.match(dispatcher,/confirmation_requests_queued/);
assert.match(adapters,/booking_confirmation_request: "Подтвердите посещение"/);
assert.match(receipt,/`NOTIFICATION_RECEIPT_\$\{channel\.toUpperCase\(\)\}_KEYS`/);
assert.doesNotMatch(receipt,/NOTIFICATION_RECEIPT_CHANNEL_KEYS|NOTIFICATION_RECEIPT_SECRET/);
assert.match(receipt,/x-receipt-key-id/);
assert.match(receipt,/encoder\.encode\(`\$\{timestamp\}\.\$\{keyId\}\.\$\{rawBody\}`\)/);
assert.match(receipt,/x-receipt-timestamp/);
assert.match(receipt,/x-receipt-signature/);
assert.match(receipt,/HMAC/);
assert.match(receipt,/timestampSeconds < nowSeconds - 300/);
assert.match(receipt,/confirm_minuta_notification_delivery_v126/);
assert.match(receipt,/p_outbox: outboxId/);
assert.match(receipt,/p_event_key: eventKey/);
assert.match(receipt,/p_organization: organizationId/);
assert.doesNotMatch(receipt,/console\.(log|error)/);
assert.match(config,/\[functions\.notification-receipt\]\s+verify_jwt = false/);

assert.match(workflow,/options: \[test-local-v126, audit-production-v126, apply-production-v126, deploy-functions-v126\]/);
assert.match(workflow,/gh api "repos\/\$GITHUB_REPOSITORY\/git\/ref\/heads\/main"/);
assert.match(workflow,/deno test --allow-read minuta-online-booking\/notification-v114-integration-test\.ts/);
assert.match(workflow,/cycle:\["apply","apply","behavior","rollback","compatibility-shims","reapply"\]/);
assert.match(workflow,/test "\$CONFIRMATION" = BACKUP_VERIFIED/);
assert.match(workflow,/\.github\/workflows\/minuta-v126-safe-release\.yml/g);
assert.match(workflow,/encryption=="OpenPGP symmetric AES-256"/);
assert.match(workflow,/supabase-migration-v126\.sql/);
assert.match(workflow,/supabase functions deploy notification-receipt[\s\S]*supabase functions deploy notification-dispatcher/);
assert.match(workflow,/NOTIFICATION_RECEIPT_<CHANNEL>_KEYS|without creating secrets/i);
assert.doesNotMatch(workflow,/supabase secrets set|curl[^\n]*--request POST/i);

console.log('Notification v126 D02A static checks passed.');
