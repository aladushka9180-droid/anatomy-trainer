import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const migration = read('supabase-migration-v171.sql');
const rollback = read('supabase-migration-v171-rollback.sql');
const worker = read('scripts/client-result-retention-v171.mjs');
const workflow = read('../.github/workflows/minuta-v171-photo-retention-release.yml');
const cleanup = read('../.github/workflows/minuta-client-result-retention.yml');

for (const column of ['keep_from_cleanup', 'retention_visit_date', 'retention_claim_token', 'retention_delete_started_at']) {
  assert.match(migration, new RegExp(`add column if not exists ${column}`, 'i'));
}
for (const rpc of ['get_minuta_client_results_v171', 'get_minuta_client_result_v171',
  'set_minuta_client_result_media_keep_v171', 'claim_minuta_client_result_retention_v171',
  'authorize_minuta_client_result_retention_delete_v171', 'finish_minuta_client_result_retention_v171']) {
  assert.match(migration, new RegExp(`create or replace function public\\.${rpc}`, 'i'));
}
assert.match(migration, /from public\.client_result_assets asset[\s\S]*asset\.purpose in \('before','after'\)/i);
assert.match(migration, /outcome\.visit_status='completed'/i);
assert.match(migration, /retention_visit_date\+interval '12 months'/i);
assert.match(migration, /client_result_retention_policy[\s\S]*enabled boolean not null default false/i);
assert.match(migration, /if p_execute and v_enabled is not true/i);
assert.match(migration, /retention_claimed_at<now\(\)-interval '1 hour'/i);
assert.match(migration, /storage\.objects where bucket_id='minuta-client-records'/i);
assert.match(migration, /object_path_sha256/i);
assert.doesNotMatch(migration, /portfolio|avatar|document/i);
assert.match(rollback, /v171_rollback_blocked_retention_state_exists/);
assert.match(worker, /DELETE[\s\S]*HEAD[\s\S]*finish_minuta_client_result_retention_v171/);
assert.doesNotMatch(worker, /console\.log\([^)]*object_path/i);
for (const phase of ['test-v171', 'validate-production-v171', 'apply-production-v171']) assert.match(workflow, new RegExp(phase));
assert.match(workflow, /INSTALL_V171_WITH_CLEANUP_DISABLED/);
assert.match(workflow, /minuta-supabase-backup\.yml/);
assert.match(workflow, /minuta-supabase-restore-drill\.yml/);
assert.match(cleanup, /MINUTA_CLIENT_RESULT_RETENTION_EXECUTE/);
assert.match(cleanup, /DELETE_ELIGIBLE_CLIENT_RESULT_PHOTOS/);
console.log('Client result retention v171 static contract: PASS');
