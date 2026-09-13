import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const harnessRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));
const sourceRoot = resolve(process.env.MINUTA_V155_SOURCE_ROOT || harnessRoot);
const readHarness = relativePath => readFileSync(join(harnessRoot, relativePath), 'utf8');
const readSource = relativePath => readFileSync(join(sourceRoot, relativePath), 'utf8');

const migration = readSource('supabase-migration-v155.sql');
const rollback = readSource('supabase-migration-v155-rollback.sql');
const integration = readSource('tests/client-identity-v155-integration.sql');
const concurrency = readSource('tests/client-identity-v155-postgres-concurrency-test.mjs');
const state = readHarness('scripts/client-identity-v155-state.sql');
const counts = readHarness('scripts/client-identity-v155-business-counts.sql');
const workflow = readHarness('../.github/workflows/minuta-v155-client-identity-release.yml');
const contract = JSON.parse(execFileSync(process.execPath, [
  join(harnessRoot, 'scripts/client-identity-v155-contract.mjs'),
], {
  encoding: 'utf8',
  env: { ...process.env, MINUTA_V155_SOURCE_ROOT: sourceRoot },
}));

assert.equal(contract.version, 'v155');
assert.equal(contract.versionObjectCount, 24);
assert.equal(contract.functions.length, 26);
assert.equal(contract.tables.length, 5);
assert.ok(contract.functions.filter(item => item.versionObject).length === 18);
for (const item of contract.functions) {
  assert.match(item.sourceHash, /^[0-9a-f]{64}$/);
  assert.ok(migration.includes(item.signature), `migration does not pin ${item.signature}`);
  assert.ok(migration.includes(item.sourceHash), `migration does not pin source hash for ${item.signature}`);
  assert.ok(['none', 'public', 'staff', 'staff-service', 'service'].includes(item.access));
  assert.ok(item.marker.startsWith('minuta_client_identity_'));
}
assert.deepEqual(contract.tables, [...contract.tables].sort());

assert.match(migration, /^-- v155:/);
assert.match(migration, /^begin;/m);
assert.match(migration, /v155_apply_blocked_partial_or_newer_objects/);
assert.match(migration, /v155_apply_blocked_newer_function_definition/);
assert.match(migration, /v155_function_contract_drift/);
assert.match(migration, /v155_table_contract_drift/);
assert.match(migration, /minuta_client_identity_v155:sha256=/);
assert.match(migration, /aclexplode\(coalesce\(/);
assert.match(migration, /client_benefit_instruments_client_version_v155_check/);
assert.match(migration, /client_benefit_instruments_version_v155/);
assert.match(migration, /hashtextextended\('booking-request:'\|\|p_request_id::text,0\)/);
assert.match(migration, /notify pgrst,'reload schema';\s*commit;\s*$/);
assert.doesNotMatch(`${migration}\n${rollback}`, /__[A-Z0-9_]+__/);

assert.match(rollback, /^-- Roll back only the exact v155 client-identity contract\./);
assert.match(rollback, /^begin;/m);
assert.match(rollback, /v155_rollback_blocked_newer_function_definition/);
assert.match(rollback, /drop table public\.client_identity_audit_v155/);
assert.match(rollback, /drop function public\.book_client_with_benefit_v155/);
assert.match(rollback, /notify pgrst,'reload schema';\s*commit;\s*$/);

assert.match(integration, /^-- ISOLATED TEST DATABASE ONLY\./);
assert.match(integration, /\bbegin\s*;/i);
assert.match(integration, /\brollback\s*;\s*$/i);
assert.match(concurrency, /Real multi-connection PostgreSQL only/);
assert.match(concurrency, /awaitBlocked/);
assert.match(concurrency, /booking race and booking-linked sale issue\/consume race serialize exactly once/);
assert.match(concurrency, /booking-linked sale issue\/consume race serialize exactly once/);
assert.match(concurrency, /superseded sale claim must not be consumed/);
assert.match(concurrency, /issue_sale_authenticated_execute/);
assert.match(concurrency, /issue_sale_service_execute/);
assert.match(concurrency, /benefit_version_conflict/);
assert.match(concurrency, /cleanupFixture/);

assert.match(state, /^begin transaction isolation level repeatable read read only;/);
assert.match(state, /'classification',case/);
assert.match(state, /'partial-or-newer'/);
assert.match(state, /source_hash/);
assert.match(state, /contract_hash/);
assert.match(state, /no_unexpected_grants/);
assert.match(state, /marker='minuta_client_identity_v155:sha256='\|\|runtime\.schema_hash/);
assert.match(state, /trigger_row\.tgconstraint=0/);
assert.match(state, /expectedPresentCount',24/);
assert.doesNotMatch(state, /^\s*(?:insert|update|delete|truncate|alter|drop|create)\b/im);
assert.match(counts, /^begin transaction isolation level repeatable read read only;/);
assert.match(counts, /v155_business_count_prerequisites_missing/);
assert.match(counts, /'commercialSales'/);
assert.match(counts, /'benefitLedger'/);
assert.doesNotMatch(counts, /booking_mutations|booking_outcomes/);
assert.doesNotMatch(counts, /^\s*(?:insert|update|delete|truncate|alter|drop|create)\b/im);

const job = name => {
  const match = new RegExp(`^  ${name}:\\r?\\n([\\s\\S]*?)(?=^  [a-zA-Z][a-zA-Z0-9-]*:|(?![\\s\\S]))`, 'm').exec(workflow);
  assert.ok(match, `missing job ${name}`);
  return match[0];
};

for (const phase of ['test-v155', 'validate-production-v155', 'apply-production-v155', 'observe-production-v155']) {
  assert.match(workflow, new RegExp(`\\b${phase}:`));
}
assert.match(workflow, /^on:\r?\n  workflow_dispatch:/m);
assert.doesNotMatch(workflow, /^\s+(?:push|schedule|workflow_run):/m);
assert.match(workflow, /test "\$GITHUB_REF" = refs\/heads\/main/);
assert.match(workflow, /git\/ref\/heads\/main/);
assert.match(workflow, /test "\$CONFIRMATION" = BACKUP_VERIFIED/);

const testJob = job('test-v155');
assert.match(testJob, /environment: minuta-test/);
assert.match(testJob, /migration-config-guard\.mjs/);
assert.match(testJob, /client-identity-v155-postgres-concurrency-test\.mjs/g);
assert.match(testJob, /booking-lookup-v154-state\.sql/g);
const sequence = [...testJob.matchAll(/-f minuta-online-booking\/(supabase-migration-v155(?:-rollback)?\.sql|tests\/client-identity-v155-integration\.sql)/g)]
  .map(match => match[1]);
assert.deepEqual(sequence, [
  'supabase-migration-v155-rollback.sql',
  'supabase-migration-v155.sql',
  'supabase-migration-v155.sql',
  'tests/client-identity-v155-integration.sql',
  'supabase-migration-v155-rollback.sql',
  'supabase-migration-v155.sql',
  'supabase-migration-v155.sql',
  'tests/client-identity-v155-integration.sql',
]);
for (const evidence of [
  'real-postgresql-concurrency',
  'canonical-lock-wait',
  'schema-fingerprints',
  'function-fingerprints',
  'grant-fingerprints',
  'business-counts-zero-delta',
]) assert.match(testJob, new RegExp(evidence));
assert.match(testJob, /businessRowsChanged:false/);
assert.match(testJob, /externalMessagesSent:false/);
assert.match(testJob, /paymentsCharged:false/);
assert.match(testJob, /realSalesCreated:false/);
assert.match(testJob, /realBookingsCreated:false/);

const validationJob = job('validate-production-v155');
assert.match(validationJob, /default_transaction_read_only=on/);
assert.match(validationJob, /booking-lookup-v154-state\.sql/);
assert.match(validationJob, /client-identity-v155-state\.sql/);
assert.doesNotMatch(validationJob, /supabase-migration-v155\.sql/);
assert.doesNotMatch(validationJob, /client-identity-v155-integration\.sql/);
assert.doesNotMatch(validationJob, /client-identity-v155-postgres-concurrency-test\.mjs/);

const applyJob = job('apply-production-v155');
for (const evidence of ['TEST', 'VALIDATION', 'BACKUP', 'RESTORE']) {
  assert.match(applyJob, new RegExp(`check_run "\\$${evidence}"`));
}
assert.match(applyJob, /test "\$age" -ge 0 && test "\$age" -le 7200/);
assert.match(applyJob, /minuta-supabase-backup\.yml/);
assert.match(applyJob, /minuta-supabase-restore-drill\.yml/);
assert.match(applyJob, /sourceBackupRunId==\$backup and \.sourceBackupSha==\$sha/);
assert.match(applyJob, /client-identity-v155-business-counts\.sql/g);
assert.match(applyJob, /test "\$\(jq -S \. <<<"\$after"\)" = "\$\(jq -S \. <<<"\$before"\)"/);
assert.equal((applyJob.match(/-f minuta-online-booking\/supabase-migration-v155\.sql/g) ?? []).length, 1);
assert.doesNotMatch(applyJob, /client-identity-v155-integration\.sql/);
assert.doesNotMatch(applyJob, /client-identity-v155-postgres-concurrency-test\.mjs/);

const observeJob = job('observe-production-v155');
assert.match(observeJob, /default_transaction_read_only=on/);
assert.match(observeJob, /sleep "\$\(\(MINUTES\*60\)\)"/);
assert.match(observeJob, /test "\$age" -ge 0 && test "\$age" -le 7200/);
assert.doesNotMatch(observeJob, /supabase-migration-v155\.sql/);
assert.doesNotMatch(observeJob, /client-identity-v155-integration\.sql/);
assert.doesNotMatch(observeJob, /client-identity-v155-postgres-concurrency-test\.mjs/);

for (const productionJob of [validationJob, applyJob, observeJob]) {
  assert.doesNotMatch(productionJob, /(?:curl|wget)[^\n]*(?:sms|telegram|payment|edge)/i);
}

console.log('Minuta v155 client identity release harness static checks passed');
