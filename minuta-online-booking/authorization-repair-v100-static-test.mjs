import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const migration = read('supabase-migration-v100.sql');
const integration = read('authorization-repair-v100-integration.sql');
const workflow = read('../.github/workflows/minuta-safe-release.yml');

const repairedSignatures = [
  'invite_minuta_member',
  'update_minuta_member',
  'cancel_minuta_invitation',
  'require_minuta_resource_manager',
  'get_minuta_benefit_role',
  'get_minuta_booking_policy_role',
  'get_minuta_group_booking_role',
  'get_minuta_loyalty_role',
  'require_minuta_retention_manager',
  'require_minuta_batch_booking_role',
  'get_minuta_booking_events',
  'get_minuta_booking_events_v97'
];

assert.match(migration, /^begin;/m);
assert.match(migration, /^commit;/m);
assert.match(migration, /set local lock_timeout='5s'/i);
assert.equal((migration.match(/create or replace function public\./gi) || []).length, repairedSignatures.length);
for (const name of repairedSignatures) {
  assert.match(migration, new RegExp(`create or replace function public\\.${name}\\b`, 'i'));
}

assert.equal((migration.match(/v_actor_role is null or v_actor_role not in \('owner', 'admin'\)/g) || []).length, 3);
for (const denial of [
  'resource_management_denied',
  'benefit_management_denied',
  'booking_policy_management_denied',
  'group_booking_management_denied',
  'loyalty_management_denied',
  'retention_manager_required',
  'batch_booking_access_denied'
]) {
  const pattern = new RegExp(`v_role is null or v_role not in \\([^;]+\\) then[^;]+${denial}`, 'i');
  assert.match(migration, pattern);
}

const eventReaderDefinitions = ['get_minuta_booking_events', 'get_minuta_booking_events_v97'].map(name => {
  const start = migration.search(new RegExp(`create or replace function public\\.${name}\\b`, 'i'));
  assert.notEqual(start, -1);
  const next = migration.indexOf('\ncreate or replace function public.', start + 1);
  return migration.slice(start, next === -1 ? migration.length : next);
});
for (const definition of eventReaderDefinitions) {
  assert.match(definition, /join public\.organizations organization on organization\.id=membership\.organization_id and organization\.status='active'/i);
  assert.match(definition, /v_role is null or v_role not in \('owner','admin','specialist'\)/i);
}

assert.match(migration, /create temporary table v100_function_contract on commit drop/i);
assert.match(migration, /current_function\.proacl::text is distinct from original\.acl/i);
assert.doesNotMatch(migration, /^\s*(grant|revoke)\b/im);

assert.match(integration, /^begin;/m);
assert.match(integration, /^rollback;/m);
assert.match(integration, /v100_cross_tenant_mutation_detected/i);
assert.match(integration, /organization_manage_denied/i);
assert.match(integration, /resource_management_denied/i);
assert.match(integration, /benefit_management_denied/i);
assert.match(integration, /booking_policy_management_denied/i);
assert.match(integration, /group_booking_management_denied/i);
assert.match(integration, /loyalty_management_denied/i);
assert.match(integration, /retention_manager_required/i);
assert.match(integration, /batch_booking_access_denied/i);
assert.match(integration, /event_access_denied/i);

assert.match(workflow, /employee-analytics-v97/);
assert.match(workflow, /MINUTA_TEST_DATABASE_URL="\$\{MINUTA_TEST_DATABASE_URL\/:6543\/:5432\}"/);
const testMigration = workflow.split('  test-migration:')[1]?.split('  validate-production-rollback:')[0] || '';
const productionMigration = workflow.split('  production-migration:')[1]?.split('  diagnose-client-links:')[0] || '';
assert.equal((testMigration.match(/-f minuta-online-booking\/supabase-migration-v100\.sql/g) || []).length, 2);
assert.match(testMigration, /supabase-migration-v100\.sql[\s\S]*authorization-repair-v100-integration\.sql/);
assert.equal((productionMigration.match(/-f minuta-online-booking\/supabase-migration-v100\.sql/g) || []).length, 1);
assert.match(productionMigration, /test-migration — \$MINUTA_MIGRATION_TARGET/);
assert.match(productionMigration, /validate-production-rollback — \$MINUTA_MIGRATION_TARGET/);

console.log('v100 authorization repair static checks passed');
