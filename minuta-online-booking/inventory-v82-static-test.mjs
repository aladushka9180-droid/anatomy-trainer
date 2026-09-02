import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=dirname(fileURLToPath(import.meta.url));
const migration=await readFile(join(root,'supabase-migration-v82.sql'),'utf8');
const rollback=await readFile(join(root,'supabase-migration-v82-rollback.sql'),'utf8');
for(const table of ['organization_inventory_settings','inventory_items','inventory_warehouses','inventory_service_usage','inventory_stock_balances','inventory_movements','inventory_audit_log']){
  assert.match(migration,new RegExp(`create table if not exists public\\.${table}`,'i'));
  assert.match(migration,new RegExp(`alter table public\\.${table} enable row level security`,'i'));
}
assert.match(migration,/organization_inventory_settings[\s\S]*enabled boolean not null default false/i);
assert.match(migration,/auto_deduct_completed_visits boolean not null default true/i);
assert.match(migration,/booking_outcomes_sync_inventory/i);
assert.match(migration,/protect_minuta_inventory_ledger/i);
assert.match(migration,/pg_advisory_xact_lock/i);
for(const rpc of ['set_minuta_inventory_settings','upsert_minuta_inventory_item','upsert_minuta_inventory_warehouse','set_minuta_inventory_service_usage','apply_minuta_stock_movement','get_minuta_inventory_workspace'])assert.match(migration,new RegExp(`grant execute on function public\\.${rpc}`,'i'));
for(const protectedRpc of ['provider_delete_booking','book_appointment','book_minuta_appointment'])assert.doesNotMatch(migration,new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${protectedRpc}\\s*\\(`,'i'));
assert.doesNotMatch(rollback,/\bcascade\b/i);
console.log('inventory v82 static test: OK');
