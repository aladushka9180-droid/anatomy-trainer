import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (name) =>
  readFileSync(new URL(name, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const migration = read('./supabase-migration-v138.sql');
const rollback = read('./supabase-migration-v138-rollback.sql');
const workflow = read('../.github/workflows/minuta-v138-safe-release.yml');
const cleanupWorkflow = read('../.github/workflows/primetime-media-cleanup.yml');
const prerequisite = read('./tests/primetime-schedule-v138-prerequisite.sql');

assert.match(migration, /get_primetime_schedule_v138\(p_requests jsonb\)/);
assert.match(migration, /x-primetime-upstream-key/);
assert.match(migration, /primetime_server_credentials/);
assert.match(migration, /octet_length\(p_requests::text\)>8192/);
assert.match(migration, /v_count<1 or v_count>12/);
assert.match(migration, /exception when others then\s+v_invalid:=true/);
assert.match(migration, /limit 24/);
assert.match(migration, /row_number\(\) over/);
assert.match(migration, /when 'evening' then slot\.booking_time>='17:00'::time/);
assert.match(migration, /limit 512/);
assert.match(migration, /p_end-p_start>14/);
assert.match(migration, /grant execute on function public\.get_primetime_schedule_v138\(jsonb\) to anon/i);
assert.match(migration, /revoke all on table public\.primetime_server_credentials\s+from public,anon,authenticated,service_role/i);
assert.match(rollback, /drop function if exists public\.get_primetime_schedule_v138\(jsonb\)/);
assert.match(rollback, /delete from public\.primetime_server_credentials where credential_key='schedule_v138'/);
assert.match(rollback, /not exists\(select 1 from public\.primetime_server_credentials\)/);
assert.match(rollback, /invalid_public_schedule_scope/);
assert.match(rollback, /limit 512/);
for (const token of [
  'BACKUP_VERIFIED',
  'minuta-supabase-backup.yml',
  'minuta-supabase-restore-drill.yml',
  'test-v138',
  'validate-production-v138',
  'apply-production-v138',
  'observe-production-v138',
  'supabase-migration-v138.sql',
  'supabase-migration-v138-rollback.sql',
]) assert.ok(workflow.includes(token),token);
assert.match(cleanupWorkflow, /cron: '\*\/15 \* \* \* \*'/);
assert.match(cleanupWorkflow, /secrets\.PRIMETIME_MEDIA_CLEANUP_SECRET/);
assert.match(cleanupWorkflow, /x-primetime-cleanup-key/);
assert.match(cleanupWorkflow, /synthetic_probe/);
assert.match(cleanupWorkflow, /endpoint\?probe=1/);
assert.match(cleanupWorkflow, /missing_status.*'404'/s);
assert.match(cleanupWorkflow, /wrong_status.*'404'/s);
assert.match(cleanupWorkflow, /api\/catalog\?code=ramil/);
assert.match(cleanupWorkflow, /api\/catalog-availability\?target=/);
assert.match(cleanupWorkflow, /\['available','none'\]/);
assert.match(workflow, /primetime-schedule-v138-prerequisite\.sql/);
assert.match(prerequisite, /get_public_minuta_available_slots_v101/);
assert.match(cleanupWorkflow, /status" = '200'/);
assert.match(cleanupWorkflow, /status" = '404'/);

console.log('PrimeTime schedule v138 static checks passed.');
