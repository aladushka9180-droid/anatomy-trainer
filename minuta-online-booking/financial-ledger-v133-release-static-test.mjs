import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const workflow = read('../.github/workflows/minuta-v133-safe-release.yml');
const state = read('./scripts/financial-ledger-v133-production-state.sh');
const integrationTest = read('./tests/financial-ledger-v133-postgres-test.mjs');

for (const phase of ['audit-production-v133', 'apply-production-v133', 'observe-production-v133']) {
  assert.match(workflow, new RegExp(phase));
}
for (const input of [
  'commit_sha', 'backup_run_id', 'restore_run_id', 'test_run_id', 'audit_run_id',
  'apply_run_id', 'confirmation', 'observation_minutes'
]) {
  assert.match(workflow, new RegExp(`\\b${input}:`));
}

assert.match(workflow, /APPLY_V133_TO_PRODUCTION/);
assert.match(workflow, /test "\$GITHUB_SHA" = "\$SHA"/);
assert.match(workflow, /git\/ref\/heads\/main/);
assert.match(workflow, /concurrency: \{ group: minuta-production-database, cancel-in-progress: false \}/);
assert.match(workflow, /minuta-v133-financial-debt-reconciliation\.yml/);
assert.match(workflow, /v133-financial-attestation-\$SHA/);
assert.match(workflow, /test_age[\s\S]*-le 7200/);
assert.match(workflow, /currentMainVerified==true and \.isolatedDatabase==true/);
assert.match(workflow, /minuta-supabase-backup\.yml/);
assert.match(workflow, /encryption=="OpenPGP symmetric AES-256"/);
assert.match(workflow, /minuta-supabase-restore-drill\.yml/);
assert.match(workflow, /sourceBackupRunId==\$backup/);
assert.match(workflow, /sourceBackupSha==\$sha/);
assert.match(workflow, /networkMode=="none"/);
assert.match(workflow, /ephemeralContainerDestroyed==true/);
assert.match(workflow, /cat minuta-online-booking\/supabase-migration-v132\.sql minuta-online-booking\/supabase-migration-v133\.sql \| sha256sum/);
assert.match(workflow, /\.v132Mode=="absent" and \.v133Mode=="absent"/);
assert.match(workflow, /\.v132Mode=="full" and \.v133Mode=="absent"/);
assert.match(workflow, /\.v132Mode=="full" and \.v133Mode=="full"/);
assert.match(workflow, /supabase-migration-v132\.sql[\s\S]*supabase-migration-v133\.sql/);
assert.match(workflow, /psql "\$db"[\s\S]*supabase-migration-v133\.sql/);
assert.doesNotMatch(workflow, /supabase-migration-v13[23]-rollback\.sql/);
assert.match(workflow, /financialRowsCreated:false,realFinancialTransactionCreated:false/);
assert.match(workflow, /\.financialRowCounts==\$after\.financialRowCounts/);
assert.match(workflow, /Observe v133 read-only for the requested interval/);
assert.match(workflow, /sleep 300/);

assert.match(state, /default_transaction_read_only=on/g);
assert.match(state, /production-db-target-guard\.mjs >\/dev\/null/);
assert.match(state, /baseReady/);
assert.match(state, /v132Mode/);
assert.match(state, /v133Mode/);
assert.match(state, /cumulativeSchemaFingerprint/);
assert.match(state, /extensions\.digest/);
assert.match(state, /v132HardeningReady/);
assert.match(state, /v133HardeningReady/);
assert.match(state, /financeEnabled/);
assert.match(state, /debtSettlementSources/);

assert.match(integrationTest, /const migration = read\('supabase-migration-v133\.sql'\)/);
assert((integrationTest.match(/await admin\.query\(migration\);/g) || []).length >= 4);
assert.match(integrationTest, /create_minuta_financial_supplier_v132/);
assert.match(integrationTest, /accrue_minuta_supplier_expense_v132/);

console.log('PASS: v133 production release is exact-SHA, fail-closed, backed up, restored, default-off and observed');
