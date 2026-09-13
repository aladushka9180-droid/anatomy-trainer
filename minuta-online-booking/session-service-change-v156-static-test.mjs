import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const read = relative => readFile(new URL(relative, import.meta.url), 'utf8');
const [migration, rollback, integration, state, workflow, v53, provider] = await Promise.all([
  read('./supabase-migration-v156.sql'),
  read('./supabase-migration-v156-rollback.sql'),
  read('./session-service-change-v156-integration.sql'),
  read('./scripts/session-service-v156-state.sql'),
  read('../.github/workflows/minuta-v156-session-service-release.yml'),
  read('./supabase-migration-v53.sql'),
  read('./provider.js')
]);

const functionBody = sql => {
  const match = sql.match(/create or replace function public\.save_booking_session\(p_booking uuid, p_items jsonb\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/i);
  assert.ok(match, 'save_booking_session body is missing');
  return match[1].replace(/\r/g, '');
};
const digest = (algorithm, value) => createHash(algorithm).update(value, 'utf8').digest('hex');

const legacyBody = functionBody(v53);
const migratedBody = functionBody(migration);
const rollbackBody = functionBody(rollback);
const migratedSha256 = digest('sha256', migratedBody);

assert.equal(digest('md5', legacyBody), 'eb5201919de3d76b3ebeae3d3488ab7a', 'v53 session baseline drifted');
assert.equal(rollbackBody, legacyBody, 'rollback must restore the exact v53 session function body');
assert.ok(!migration.includes('V156_SOURCE_SHA256'), 'migration contains an unresolved source hash');
assert.ok(!rollback.includes('V156_SOURCE_SHA256'), 'rollback contains an unresolved source hash');
assert.ok(migration.includes(migratedSha256), 'migration guard must pin the exact v156 source');
assert.ok(rollback.includes(migratedSha256), 'rollback guard must pin the exact v156 source');

const branch = migratedBody.match(/if v_total_duration is distinct from v_booking\.duration_minutes then([\s\S]*?)else([\s\S]*?)end if;/i);
assert.ok(branch, 'duration-sensitive booking update branch is missing');
assert.match(branch[1], /update public\.bookings[\s\S]*duration_minutes\s*=\s*v_total_duration/i, 'changed duration must still invoke schedule triggers');
assert.match(branch[2], /update public\.bookings/i, 'same-duration service update is missing');
assert.doesNotMatch(branch[2], /duration_minutes\s*=/i, 'same-duration service update must omit duration_minutes from SET');
assert.match(branch[2], /service_id\s*=\s*v_primary_service[\s\S]*total_price_rub\s*=\s*v_total_price/i, 'same-duration path must save service and price');
assert.match(migration, /revoke all on function public\.save_booking_session\(uuid,jsonb\)[\s\S]*public,anon,service_role/i);
assert.match(migration, /grant execute on function public\.save_booking_session\(uuid,jsonb\) to authenticated/i);

assert.match(integration, /organization_shift_settings[\s\S]*values\(organization_id,true[\s\S]*save_booking_session/i, 'integration test must enable shifts without creating a matching shift');
assert.match(integration, /service_id',current_setting\('minuta\.v156_new_service'\)[\s\S]*duration_minutes',60[\s\S]*duration_minutes',59/i, 'integration test must cover another service with same and changed duration');
assert.match(integration, /booking_outside_active_shift/i, 'integration test must preserve shift validation for changed schedules');
assert.ok(state.includes(migratedSha256), 'state probe must pin the exact v156 source');
for (const classification of ["'legacy'", "'exact'", "'drift'", "'absent'"]) {
  assert.ok(state.includes(classification), `state probe is missing ${classification}`);
}

for (const phase of ['test-v156','validate-production-v156','apply-production-v156','observe-production-v156']) {
  assert.ok(workflow.includes(phase), `release workflow is missing ${phase}`);
}
assert.match(workflow, /BACKUP_VERIFIED[\s\S]*backup_run_id[\s\S]*restore_run_id/i, 'production apply must require backup and restore evidence');
assert.match(workflow, /supabase-migration-v156\.sql[\s\S]*session-service-change-v156-integration\.sql[\s\S]*supabase-migration-v156-rollback\.sql[\s\S]*supabase-migration-v156\.sql/i, 'test phase must prove apply, integration, rollback and reapply');
assert.match(workflow, /production-db-target-guard\.mjs[\s\S]*production-db-schema-guard\.sh/i, 'production phases must pin the database target and schema');

assert.match(provider, /rpc\('save_booking_session',[\s\S]*?p_booking\s*:\s*item\.id\s*,\s*p_items\s*:\s*sessionComposerDraft/i, 'provider must save selected session items');
assert.match(provider, /sessionControl\.matches\('\[data-session-service\]'\)[\s\S]*?service\.duration_minutes[\s\S]*?service\.price_rub/i, 'service selection must update visit duration and price');

console.log('PrimeTime Pro session service change v156 static checks: PASS');
