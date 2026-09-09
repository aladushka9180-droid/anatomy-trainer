import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const migration=read('../supabase-migration-v135.sql');
const rollback=read('../supabase-migration-v135-rollback.sql');
const integration=read('../tests/client-profile-v135-integration.sql');
const workflow=read('../../.github/workflows/minuta-v135-safe-release.yml');

assert.match(migration,/begin;[\s\S]*commit;/i);
assert.match(migration,/set local lock_timeout='10s'/);
assert.match(migration,/set local statement_timeout='2min'/);
assert.match(migration,/online_booking_block_reason text/);
assert.match(migration,/security definer set search_path to ''/);
assert.match(migration,/revoke all on function public\.set_minuta_client_online_booking_block_v135/);
assert.match(rollback,/v135_rollback_preserves_client_block_reasons/);
assert.match(integration,/specialist_block_allowed/);
assert.match(integration,/unblock_did_not_clear_reason/);
assert.match(workflow,/APPLY_V135_TO_PRODUCTION/);
assert.match(workflow,/supabase-migration-v134\.sql/);
assert.match(workflow,/client-profile-v134-test-stack\.sql/);
assert.match(workflow,/minuta-supabase-backup\.yml/);
assert.match(workflow,/minuta-supabase-restore-drill\.yml/);
assert.match(workflow,/sourceBackupRunId==\$backup/);
assert.match(workflow,/production-db-target-guard\.mjs --session-url/);
assert.match(workflow,/clientRowsChanged:false/);
assert.doesNotMatch(workflow,/actions\/(?:checkout|setup-node|upload-artifact)@v\d/,'Actions must be pinned by SHA');

console.log('v135 release contract: PASS');
