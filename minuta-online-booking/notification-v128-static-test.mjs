import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const migration=read('./supabase-migration-v128.sql');
const rollback=read('./supabase-migration-v128-rollback.sql');
const dispatcher=read('../supabase/functions/notification-dispatcher/index.ts');
const adapters=read('../supabase/functions/notification-dispatcher/adapters.ts');

assert.match(migration,/v128_requires_notification_v126/i);
assert.match(migration,/claim_minuta_notification_test_outbox_v128\(\s*p_organization uuid,p_event_key text,p_channel text/i);
assert.match(migration,/coalesce\(auth\.role\(\),''\)<>'service_role'/i);
assert.match(migration,/char_length\(p_event_key\) not between 1 and 240/i);
assert.match(migration,/queue\.organization_id=p_organization and queue\.event_key=p_event_key/i);
assert.match(migration,/queue\.channel=p_channel and queue\.dispatcher='unified'/i);
assert.match(migration,/queue\.status='pending' and queue\.next_attempt_at<=now\(\)/i);
assert.match(migration,/minuta_notification_next_allowed_at_v126/i);
assert.match(migration,/for update of queue skip locked/i);
assert.match(migration,/get diagnostics v_rows=row_count/i);
assert.match(migration,/if v_rows<>1 then[\s\S]*notification_test_target_not_claimable/i);
assert.match(migration,/fail_minuta_notification_test_outbox_v128/i);
assert.match(migration,/set status='failed'[\s\S]*queue\.event_key=p_event_key[\s\S]*queue\.organization_id=p_organization/i);
assert.doesNotMatch(migration,/enqueue_due_minuta|organization_notification_fallbacks|insert into public\.notification_outbox/i);
assert.match(migration,/revoke all on function public\.claim_minuta_notification_test_outbox_v128[\s\S]*from public,anon,authenticated,service_role/i);
assert.match(migration,/grant execute on function public\.claim_minuta_notification_test_outbox_v128[\s\S]*to service_role/i);

assert.match(rollback,/compatibility shims keep a newer dispatcher fail-closed/i);
assert.match(rollback,/notification_test_mode_unavailable/g);
assert.doesNotMatch(rollback,/drop function|delete from|truncate/i);

assert.match(dispatcher,/body\.skip_schedulers !== true/);
assert.match(dispatcher,/test_scope/);
assert.match(dispatcher,/claim_minuta_notification_test_outbox_v128/);
assert.match(dispatcher,/jobs\.length !== 1/);
assert.match(dispatcher,/fail_minuta_notification_test_outbox_v128/);
assert.match(dispatcher,/schedulers_skipped: Boolean\(test\)/);
assert.match(adapters,/body: JSON\.stringify\(\{\s*outbox_id: job\.outbox_id,\s*event_key: job\.event_key,/);
assert.match(adapters,/metadata:\s*{\s*outbox_id: job\.outbox_id,\s*event_key: job\.event_key,/);

console.log('Notification v128 scoped test-mode static checks passed.');
