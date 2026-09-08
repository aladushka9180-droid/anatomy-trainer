import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const migration=read('./supabase-migration-v128.sql');
const rollback=read('./supabase-migration-v128-rollback.sql');
const dispatcher=read('../supabase/functions/notification-dispatcher/index.ts');
const adapters=read('../supabase/functions/notification-dispatcher/adapters.ts');
const workflow=read('../.github/workflows/minuta-v128-safe-release.yml');

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

assert.match(workflow,/options: \[test-local-v128, audit-production-v128, apply-production-v128, deploy-functions-v128\]/);
assert.match(workflow,/gh api "repos\/\$GITHUB_REPOSITORY\/git\/ref\/heads\/main"/);
assert.match(workflow,/deno test --allow-read minuta-online-booking\/notification-v114-integration-test\.ts/);
assert.match(workflow,/cycle:\["apply","apply","behavior","rollback","compatibility-shims","reapply"\]/);
assert.match(workflow,/v126Ready[\s\S]*v128Mode/);
assert.match(workflow,/v126_fallback_rpc[\s\S]*v126_quiet_rpc[\s\S]*v126_kind[\s\S]*v126_receipt_service_only/);
assert.match(workflow,/test "\$CONFIRMATION" = BACKUP_VERIFIED/);
assert.ok((workflow.match(/test "\$MINUTA_PRODUCTION_PROJECT_REF" = cawexmmrqjvothcbgjxr/g)||[]).length>=2);
assert.match(workflow,/\.github\/workflows\/minuta-v128-safe-release\.yml/g);
assert.match(workflow,/encryption=="OpenPGP symmetric AES-256"/);
assert.match(workflow,/supabase-migration-v128\.sql/);
assert.match(workflow,/claimServiceOnly[\s\S]*failServiceOnly/);
assert.match(workflow,/APPLY_SHA="\$\(jq -r \.head_sha/);
assert.match(workflow,/git merge-base --is-ancestor "\$APPLY_SHA" "\$SHA"/);
assert.match(workflow,/git diff --quiet "\$APPLY_SHA" "\$SHA" --[\s\S]*supabase-migration-v128\.sql[\s\S]*supabase-migration-v128-rollback\.sql[\s\S]*supabase\/config\.toml[\s\S]*supabase\/functions\/notification-receipt[\s\S]*supabase\/functions\/notification-dispatcher/);
assert.match(workflow,/--arg sha "\$APPLY_SHA"/);
assert.match(workflow,/AUDIT: \$\{\{ inputs\.audit_run_id \}\}/);
assert.match(workflow,/v128-audit-\$AUDIT/);
assert.match(workflow,/\.state\.v126Ready==true and \.state\.v128Mode=="full"/);
assert.match(workflow,/supabase functions deploy notification-receipt[\s\S]*supabase functions deploy notification-dispatcher/);
assert.doesNotMatch(workflow,/supabase secrets set|curl[^\n]*--request POST/i);
assert.doesNotMatch(workflow,/\.outboxCount==\$before|\.attemptCount==\$before|\.enabledChannels==\$before/);

console.log('Notification v128 scoped test-mode static checks passed.');
