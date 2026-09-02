import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const migration = await readFile(join(root, 'supabase-migration-v73.sql'), 'utf8');
const rollback = await readFile(join(root, 'recovery', 'rollback-benefits-v73.sql'), 'utf8');

assert.match(migration,/v73_requires_v72_and_client_accounts/i);
for (const table of ['organization_benefit_settings','benefit_products','benefit_product_services','client_benefit_instruments','benefit_instrument_service_balances','benefit_redemptions','benefit_ledger','benefit_audit_log']) {
  assert.match(migration,new RegExp(`create table if not exists public\\.${table}`,'i'),`${table} must be additive`);
  assert.match(migration,new RegExp(`alter table public\\.${table} enable row level security`,'i'),`${table} must use RLS`);
}
assert.match(migration,/organization_benefit_settings[\s\S]*enabled boolean not null default false/i);
assert.match(migration,/benefit_redemptions_booking_active_idx[\s\S]*where status in \('reserved','redeemed'\)/i);
assert.match(migration,/pg_advisory_xact_lock\(hashtextextended\(p_instrument::text,7300\)\)/i);
assert.match(migration,/unique\(organization_id,request_id\)/i);
assert.match(migration,/hashtextextended\(p_organization::text\|\|':'\|\|p_request_id::text,7301\)/i);
assert.match(migration,/protect_minuta_benefit_ledger[\s\S]*benefit_ledger_immutable/i);
assert.match(migration,/product_snapshot[\s\S]*'services'/i);
assert.match(migration,/benefit_redemption_scope_mismatch/i);
for (const rpc of ['set_minuta_benefits_enabled','upsert_minuta_benefit_product','issue_minuta_benefit','set_minuta_benefit_status','apply_minuta_benefit','get_minuta_benefit_workspace']) {
  assert.match(migration,new RegExp(`create or replace function public\\.${rpc}`,'i'));
  assert.match(migration,new RegExp(`grant execute on function public\\.${rpc}`,'i'));
}
for (const protectedRpc of ['provider_delete_booking','book_appointment','book_minuta_appointment','get_available_slots','get_public_minuta_available_slots_v4']) {
  assert.doesNotMatch(migration,new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${protectedRpc}\\s*\\(`,'i'));
}
assert.match(rollback,/disable_benefits_before_rollback/i);
assert.match(rollback,/export_and_remove_all_benefit_data_before_rollback/i);
assert.doesNotMatch(rollback,/\bcascade\b/i);

console.log('benefits v73 static test: OK');
