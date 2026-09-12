import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../supabase-migration-v151.sql');
const migrationV147 = read('../supabase-migration-v147.sql').replaceAll('\r\n', '\n');
const migrationV148 = read('../supabase-migration-v148.sql').replaceAll('\r\n', '\n');
const migrationV73 = read('../supabase-migration-v73.sql').replaceAll('\r\n', '\n');
const migrationV130 = read('../supabase-migration-v130.sql').replaceAll('\r\n', '\n');
const rollback = read('../supabase-migration-v151-rollback.sql');
const state = read('../scripts/commercial-sales-v151-state.sql');
const integration = read('./commercial-sales-v151-integration.sql');
const durable = read('./commercial-sales-v151-durable-concurrency-test.sh');
const durableSetup = read('./commercial-sales-v151-durable-setup.sql');
const durableCleanup = read('./commercial-sales-v151-durable-cleanup.sql');
const workflow = read('../../.github/workflows/minuta-v151-commercial-sales.yml');

const signature = 'sell_minuta_commercial_product_v151(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid)';
const sourceHash = (sql, name) => {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  const bodyStart = sql.indexOf('as $$', start) + 'as $$'.length;
  const bodyEnd = sql.indexOf('$$;', bodyStart);
  assert.ok(start >= 0 && bodyStart >= 'as $$'.length && bodyEnd > bodyStart, `missing source for ${name}`);
  const canonicalJsonbText = `{"source": ${JSON.stringify(sql.slice(bodyStart, bodyEnd))}}`;
  return createHash('sha256').update(canonicalJsonbText).digest('hex');
};
assert.equal(sourceHash(migrationV147, 'sell_minuta_commercial_product_v147'), '220d2742a22230219b41d9dda29bc4649d0bb0f4b62fe8935ce4d42f86aff577');
assert.equal(sourceHash(migrationV147, 'get_minuta_commerce_workspace_v147'), 'da68cd045c6333e866c467ccdf3060a2a4c94d1547c2500c17cf475b35f292b1');
assert.equal(sourceHash(migrationV148, 'refund_minuta_commercial_sale_v147'), '9d1ea093ab4552eaac5764a3c8d1ef4458d1f86ccac63c21db78af8092224cca');
assert.equal(sourceHash(migrationV73, 'issue_minuta_benefit'), '7fdd3aa28d63d4c31132198d321921128f6f52f0d26a5734e57a9eac16441c05');
assert.equal(sourceHash(migrationV130, 'apply_minuta_stock_movement'), 'a4ea61f1def8fbd64e3e345ea8e78c8bdbe5aaafe4bd2b1af50d034343a27e18');
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
assert.match(migration, /220d2742a22230219b41d9dda29bc4649d0bb0f4b62fe8935ce4d42f86aff577/);
assert.match(migration, /da68cd045c6333e866c467ccdf3060a2a4c94d1547c2500c17cf475b35f292b1/);
assert.match(migration, /9d1ea093ab4552eaac5764a3c8d1ef4458d1f86ccac63c21db78af8092224cca/);
assert.match(migration, /7fdd3aa28d63d4c31132198d321921128f6f52f0d26a5734e57a9eac16441c05/);
assert.match(migration, /a4ea61f1def8fbd64e3e345ea8e78c8bdbe5aaafe4bd2b1af50d034343a27e18/);
assert.match(migration, /pg_get_constraintdef\(actual\.oid,true\) is distinct from expected\.definition/);
assert.match(migration, /commercial_sales_seller_id_fkey/);
assert.match(migration, /financial_accounts_organization_id_system_key_key/);
assert.match(migration, /index_row\.indisunique and index_row\.indisvalid and index_row\.indisready/);
assert.match(migration, /'runtimeFunctions'/);
assert.match(migration, /procedure_row\.proconfig is distinct from array\['search_path=""'\]::text\[\]/);
assert.match(migration, /pg_get_userbyid\(procedure_row\.proowner\) is distinct from 'postgres'/);
assert.match(migration, /ownerMatchesDomainTable/);
assert.match(migration, /aclexplode\(coalesce\(procedure_row\.proacl,acldefault\('f',procedure_row\.proowner\)\)\)/);
assert.match(migration, /p_organization uuid, p_product uuid, p_client_account uuid, p_expires_on date, p_request_id uuid/);
assert.match(migration, /p_organization uuid, p_warehouse uuid, p_item uuid, p_kind text, p_quantity numeric, p_counted_quantity numeric, p_reason text, p_request_id uuid/);
assert.match(migration, /financialAccountsSystemKeyIndex/);
assert.match(migration, /d34367dff997d0ddbc51061f6b0b3f0a41c67f29d07bc5dd6e64ea7de08c3cee/);
assert.doesNotMatch(migration, /b85982e038537907ecb9137389b27da5ebca754c537f6c06c095ab1aa6cf84a6/);
assert.match(migration, /DDL components matched the[\s\S]*runtime owner\/ACL remain part of this live fail-closed check/);
assert.match(migration, /detail=jsonb_build_object/);
assert.match(migration, /'componentFingerprints',v_component_hashes/);
assert.match(migration, /'contract',v_contract/);
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
assert.match(state, /criticalSchemaExpectedFingerprint/);
assert.match(state, /criticalSchemaComponentFingerprints/);
assert.match(state, /criticalSchemaContract/);
assert.match(state, /'runtimeFunctions'/);
assert.match(state, /financial_accounts_organization_id_system_key_key/);
assert.match(state, /financialAccountsSystemKeyIndex/);
assert.match(state, /ownerMatchesDomainTable/);
assert.match(state, /d34367dff997d0ddbc51061f6b0b3f0a41c67f29d07bc5dd6e64ea7de08c3cee/);
assert.doesNotMatch(state, /b85982e038537907ecb9137389b27da5ebca754c537f6c06c095ab1aa6cf84a6/);
assert.match(state, /Backup evidence covered DDL only;[\s\S]*owner\/ACL are still evaluated live/);

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
assert.match(integration, /sale_row\.organization_id=fixture\.organization_id and sale_row\.request_id=fixture\.request_id/);
assert.match(integration, /transaction_row\.organization_id=fixture\.organization_id/);
assert.doesNotMatch(integration, /\bwhere\s+(?:organization_id|request_id|seller_id|booking_id|sale_id|instrument_id)=/);

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
assert.doesNotMatch(durable, /psql[^\n]*-[cv][^\n]*:'(?:expected_ref|run_key|app|app_a|app_b)'/);
for (const line of durable.split(/\r?\n/)) {
  if (line.includes('psql') && line.includes(' -c ')) {
    assert.doesNotMatch(line, /(?:-v|--set)[ =](?:expected_ref|run_key|app|app_a|app_b)=/);
  }
}
assert.match(durableSetup, /create schema minuta_v151_test/);
assert.match(durableSetup, /md5\(v_run\|\|':organization'\)::uuid/);
assert.match(durableSetup, /current_setting\('minuta\.v151_test_run_key'\)/);
assert.match(durableSetup, /insert into public\.locations/);
assert.match(durableSetup, /insert into public\.bookings/);
assert.match(durableCleanup, /session_replication_role=replica/);
assert.match(durableCleanup, /delete from public\.services/);
assert.match(durableCleanup, /for fixture_row in select \* from minuta_v151_test\.fixture order by run_key/);
assert.doesNotMatch(durableCleanup, /from minuta_v151_test\.fixture where run_key=/);
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
assert.match(workflow, /financial_transactions_shape_v147_check check\(true\)/);
assert.match(workflow, /criticalSchemaFingerprint!=\.criticalSchemaExpectedFingerprint/);
assert.match(workflow, /v147-same-signature-drift/);
assert.match(workflow, /v151-issue-benefit-drift/);
assert.match(workflow, /v151-stock-movement-drift/);
assert.match(workflow, /create index financial_accounts_organization_id_system_key_key/);
assert.match(workflow, /v151-issue-minuta-benefit-restore\.sql/);
assert.match(workflow, /v151-apply-stock-movement-restore\.sql/);
assert.match(workflow, /v151-runtime-drift-role/);
assert.match(workflow, /with grant option/);
assert.match(workflow, /owner to :"drift_role"/);
assert.match(workflow, /runtime-owner-acl-drift/);
assert.match(workflow, /\.classification=="absent" and \.presentCount==0/);
assert.match(workflow, /\.criticalSchemaExact and \.criticalSchemaFingerprint==\.criticalSchemaExpectedFingerprint/);
assert.match(workflow, /\.criticalSchemaComponentFingerprints\|type=="object"/);
assert.match(workflow, /\{classification,presentCount,criticalSchemaExact,criticalSchemaFingerprint,criticalSchemaExpectedFingerprint,criticalSchemaComponentFingerprints,criticalSchemaContract\}/);
assert.doesNotMatch(workflow, /psql[^\n]*-[cv][^\n]*:'(?:expected_ref|drift_role)'/);
for (const line of workflow.split(/\r?\n/)) {
  if (line.includes('psql') && line.includes(' -c ')) {
    assert.doesNotMatch(line, /(?:-v|--set)[ =](?:expected_ref|drift_role)=/);
  }
}
assert.match(workflow, /\.setupSha256==\$setup/);
assert.match(workflow, /\.durableSha256==\$durable/);
assert.match(workflow, /\.cleanupSha256==\$cleanup/);

console.log('PrimeTime Pro commercial sales v151 DB contract checks passed');
