import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../supabase-migration-v151.sql');
const rollback = read('../supabase-migration-v151-rollback.sql');
const state = read('../scripts/commercial-sales-v151-state.sql');
const integration = read('./commercial-sales-v151-integration.sql');
const durable = read('./commercial-sales-v151-durable-concurrency-test.sh');
const durableSetup = read('./commercial-sales-v151-durable-setup.sql');
const durableCleanup = read('./commercial-sales-v151-durable-cleanup.sql');
const workflow = read('../../.github/workflows/minuta-v151-commercial-sales.yml');

const signature = 'sell_minuta_commercial_product_v151(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid)';
assert.match(migration, /v151_requires_exact_v147_v148_v149_v150/);
assert.match(migration, /minuta_refund_safety_v148_proportional_rounding/);
assert.match(migration, /apply_minuta_benefit_v149/);
assert.match(migration, /set_minuta_benefit_lifecycle_v150/);
assert.match(migration, /v151_apply_blocked_partial_or_newer_objects/);
assert.match(migration, /v151_apply_blocked_newer_function_definition/);
assert.match(migration, /minuta_commercial_sales_v151:sha256=/);
assert.match(migration, /:commerce:'\|\|p_request_id::text,147\)/);
assert.match(migration, /commercial_sale_idempotency_conflict/);
assert.match(migration, /v_legacy_fingerprint/);
assert.match(migration, /invalid_inventory_quantity/);
assert.match(migration, /commercial_sale_subtotal_out_of_range/);
assert.match(migration, /benefit_application_requests/);
assert.match(migration, /benefit_freeze_periods/);
assert.match(migration, /benefit_ledger_event_type_check/);
assert.match(migration, new RegExp(`revoke all on function public\\.${signature.replace(/[()]/g, '\\$&')} from public,anon,authenticated,service_role`));
assert.match(migration, new RegExp(`grant execute on function public\\.${signature.replace(/[()]/g, '\\$&')} to authenticated`));

assert.match(rollback, /v151_rollback_blocked_partial_or_newer_objects/);
assert.match(rollback, /v151_rollback_blocked_newer_function_definition/);
assert.match(rollback, /minuta_commercial_sales_v151:sha256=/);
assert.doesNotMatch(rollback, /drop function if exists public\.refund_minuta_commercial_sale_v147/);
assert.doesNotMatch(rollback, /drop function if exists public\.apply_minuta_benefit_v149/);
assert.doesNotMatch(rollback, /drop function if exists public\.set_minuta_benefit_lifecycle_v150/);
assert.doesNotMatch(rollback, /\b(?:delete|insert|update|truncate|drop table|alter table)\b/i);

assert.match(state, /'partial-or-newer'/);
assert.match(state, /present_count=2 and state\.exact/);
assert.match(state, /authenticatedSaleExecute/);
assert.match(state, /anonWorkspaceExecute/);
assert.match(state, /criticalSchemaExact/);
assert.match(state, /criticalSchemaFingerprint/);

assert.match(integration, /benefit_sale_replayed/);
assert.match(integration, /benefit_reserve_replayed/);
assert.match(integration, /benefit_release_replayed/);
assert.match(integration, /benefit_freeze_replayed/);
assert.match(integration, /benefit_unfreeze_replayed/);
assert.match(integration, /benefit_refund_replayed/);
assert.match(integration, /benefit_instrument_cancelled/);
assert.match(integration, /benefit_sale_transaction_single/);
assert.match(integration, /benefit_refund_transaction_single/);
assert.match(integration, /v151_nan_quantity_accepted/);
assert.match(integration, /v151_over_scale_quantity_accepted/);
assert.match(integration, /v151_out_of_range_quantity_accepted/);
assert.match(integration, /v151_subtotal_overflow_accepted/);

assert.match(durable, /call_v147/);
assert.match(durable, /call_v151/);
assert.match(durable, /wait_event_type='Lock'/);
assert.match(durable, /pg_advisory_xact_lock\(hashtextextended\('\$run_key:signal',0\)\)/);
assert.match(durable, /trap finish EXIT/);
assert.match(durable, /commercial-sales-v151-durable-cleanup\.sql/);
assert.match(durable, /minuta_migration_guard\.target/);
assert.match(durable, /MINUTA_TEST_PROJECT_REF/);
assert.match(durable, /committedRollbackPersistence:true/);
assert.match(durable, /mixedVersionReplayBothDirections:true/);
assert.match(durableSetup, /create schema minuta_v151_test/);
assert.match(durableSetup, /md5\(v_run\|\|':organization'\)::uuid/);
assert.match(durableSetup, /current_setting\('minuta\.v151_test_run_key'\)/);
assert.match(durableSetup, /insert into public\.locations/);
assert.match(durableSetup, /insert into public\.bookings/);
assert.match(durableCleanup, /session_replication_role=replica/);
assert.match(durableCleanup, /delete from public\.services/);
assert.match(durableCleanup, /drop schema if exists minuta_v151_test cascade/);

for (const phase of ['test-v151', 'validate-production-v151', 'apply-production-v151', 'observe-production-v151']) {
  assert.match(workflow, new RegExp(`\\b${phase}:`));
}
assert.match(workflow, /commercial-sales-v151-db-static-test\.mjs/);
assert.match(workflow, /commercial-sales-v151-state\.sql/);
assert.match(workflow, /benefits-v149-v150-state\.sql/);
assert.match(workflow, /supabase-migration-v151-rollback\.sql/);
assert.doesNotMatch(workflow, /commercial-sales-v151-browser-test/);
assert.doesNotMatch(workflow, /commerce-management\.js/);
for (const version of ['v147', 'v148', 'v149', 'v150', 'v151']) {
  assert.match(workflow, new RegExp(`supabase-migration-${version}\\.sql`));
}
assert.match(workflow, /commercial-sales-v151-durable-concurrency-test\.sh/);
assert.match(workflow, /if: always\(\)/);
assert.match(workflow, /v147-v151-sequential-apply/);
assert.match(workflow, /observed-lock-wait/);
assert.match(workflow, /\.setupSha256==\$setup/);
assert.match(workflow, /\.durableSha256==\$durable/);
assert.match(workflow, /\.cleanupSha256==\$cleanup/);

console.log('PrimeTime Pro commercial sales v151 DB contract checks passed');
