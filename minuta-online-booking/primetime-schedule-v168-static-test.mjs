import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('./supabase-migration-v168.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('./supabase-migration-v168-rollback.sql', import.meta.url), 'utf8');
const integration = readFileSync(new URL('./tests/primetime-schedule-v168-integration.sql', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../.github/workflows/minuta-v168-safe-release.yml', import.meta.url), 'utf8');

for (const sql of [migration, rollback]) {
  assert.match(sql, /begin;/iu);
  assert.match(sql, /set local lock_timeout='5s'/iu);
  assert.match(sql, /set local statement_timeout='2min'/iu);
  assert.match(sql, /notify pgrst,'reload schema'/iu);
  assert.match(sql, /commit;/iu);
}

assert.match(migration, /v_buffer_enabled boolean:=false/iu);
assert.match(migration, /if not coalesce\(v_buffer_enabled,false\) then/iu);
assert.match(migration, /minuta_slot_respects_booking_buffer/iu);
assert.match(migration, /limit 512/iu);
assert.doesNotMatch(migration, /\b(?:insert|update|delete)\s+(?:into|from|public\.)/iu);
assert.match(rollback, /Exact v138 definition/iu);
assert.doesNotMatch(rollback, /v_buffer_enabled boolean:=false/iu);
assert.match(integration, /disabled_buffer_fast_path_failed/iu);
assert.match(integration, /enabled_buffer_legacy_path_failed/iu);
assert.match(integration, /rollback;/iu);

for (const phase of ['test-v168', 'validate-production-v168', 'apply-production-v168', 'observe-production-v168']) {
  assert.match(workflow, new RegExp(phase, 'u'));
}
assert.match(workflow, /BACKUP_VERIFIED/u);
assert.match(workflow, /minuta-supabase-backup\.yml/u);
assert.match(workflow, /minuta-supabase-restore-drill\.yml/u);
assert.match(workflow, /default_transaction_read_only=on/u);
assert.match(workflow, /supabase-migration-v168-rollback\.sql/u);
assert.match(workflow, /businessRowsChanged:false/u);

console.log('PrimeTime schedule v168 static checks: PASS');
