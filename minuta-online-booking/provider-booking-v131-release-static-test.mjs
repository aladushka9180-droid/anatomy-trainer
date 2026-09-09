import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const workflow = read('../.github/workflows/minuta-v131-safe-release.yml');
const integration = read('../.github/workflows/minuta-v131-provider-booking.yml');
const state = read('./scripts/provider-booking-v131-production-state.sh');

for (const phase of ['audit-production-v131', 'apply-production-v131', 'observe-production-v131']) {
  assert.match(workflow, new RegExp(phase));
}
for (const input of ['commit_sha', 'backup_run_id', 'restore_run_id', 'test_run_id', 'audit_run_id', 'apply_run_id', 'confirmation', 'observation_minutes']) {
  assert.match(workflow, new RegExp(`\\b${input}:`));
}
assert.match(workflow, /APPLY_V131_TO_PRODUCTION/);
assert.match(workflow, /minuta-production-database/);
assert.match(workflow, /environment: minuta-production/g);
assert.match(workflow, /production-db-target-guard\.mjs --session-url/g);
assert.match(workflow, /production-db-schema-guard\.sh/g);
assert.match(workflow, /provider-booking-v131-production-state\.sh/g);
assert.match(workflow, /supabase-migration-v131\.sql/);
assert.doesNotMatch(workflow, /psql[^\n]*supabase-migration-v131-rollback\.sql/);
assert.match(workflow, /minuta-v131-provider-booking\.yml/);
assert.match(workflow, /minuta-supabase-backup\.yml/);
assert.match(workflow, /minuta-supabase-restore-drill\.yml/);
assert.match(workflow, /sourceBackupRunId==\$backup/);
assert.match(workflow, /sourceBackupSha==\$sha/);
assert.match(workflow, /networkMode=="none"/);
assert.match(workflow, /ephemeralContainerDestroyed==true/);
assert.match(workflow, /Observe v131 read-only for the requested interval/);
assert.match(workflow, /sleep 300/);
assert.match(workflow, /test "\$\(gh api "repos\/\$GITHUB_REPOSITORY\/git\/ref\/heads\/main" --jq \.object\.sha\)" = "\$SHA"/g);

assert.match(integration, /v131-test-\$\{\{ github\.run_id \}\}/);
assert.match(integration, /MINUTA_V131_ATTESTATION_PATH/);
assert.match(integration, /currentMainVerified:true/);
assert.match(state, /default_transaction_read_only=on/);
assert.match(state, /production-db-target-guard\.mjs >\/dev\/null/);
assert.match(state, /v131Mode/);
assert.match(state, /653390c7c91458eef408e82593f38249/);
assert.match(state, /abadc0c81de68738ba6382cd03dda62d/);
assert.match(state, /authenticatedExecute/);
assert.match(state, /serviceRoleExecute/);

console.log('PASS: v131 production release is pinned, backed up, restored, attested and observed');
