import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = name => fs.readFileSync(new URL(name, import.meta.url), 'utf8');
const migration = read('./supabase-migration-v113.sql');
const rollback = read('./supabase-migration-v113-rollback.sql');
const inventory = read('./inventory-management.js');
const profitability = read('./profitability-management.js');
const styles = read('./profitability-management.css');
const inventoryV82 = read('./supabase-migration-v82.sql');

for (const table of [
  'organization_inventory_cost_settings','inventory_cost_layers','inventory_movement_cost_snapshots','inventory_cost_allocations',
  'inventory_service_cost_settings','booking_confirmed_commissions'
]) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${table}`, 'i'));
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
}
for (const rpc of [
  'enable_minuta_inventory_costing_v113','apply_minuta_stock_movement_v113','set_minuta_service_material_mode_v113',
  'save_minuta_booking_commission_v113','get_minuta_inventory_workspace_v113','get_minuta_profitability_v113'
]) {
  assert.match(migration, new RegExp(`create or replace function public\\.${rpc}`, 'i'));
  assert.match(migration, new RegExp(`grant execute on function public\\.${rpc}`, 'i'));
  assert.match(rollback, new RegExp(`drop function if exists public\\.${rpc}`, 'i'));
}

assert.match(migration, /opening-v113:/, 'Existing stock must become an unknown-cost opening layer');
assert.match(migration, /organization_inventory_cost_settings[\s\S]*enabled boolean not null default false/i, 'Costing must be disabled by default');
assert.match(migration, /record_minuta_inventory_cost_v113[\s\S]*setting\.enabled and setting\.initialized_at is not null[\s\S]*then return new/i, 'The global trigger must be a no-op until explicit activation');
assert.match(migration, /enable_minuta_inventory_costing_v113[\s\S]*opening-v113:/i, 'Opening layers must be created only by the activation RPC');
const beforeEnable = migration.slice(0, migration.indexOf('create or replace function public.enable_minuta_inventory_costing_v113'));
assert.doesNotMatch(beforeEnable, /insert into public\.inventory_cost_layers\s*\([\s\S]*?from public\.inventory_stock_balances/i, 'Migration apply must not bootstrap current stock');
assert.match(migration, /constraint inventory_service_cost_settings_org_service_date_key[\s\S]*unique\(organization_id,service_id,effective_from\)/i, 'Service settings uniqueness must include the tenant');
assert.match(migration, /on conflict\(organization_id,service_id,effective_from\) do update/i, 'Service settings upsert must use tenant-scoped conflict columns');
assert.match(migration, /unit_cost_kopecks is null[\s\S]*v_complete:=false/i, 'Unknown FIFO layers must make a movement cost incomplete');
assert.match(inventoryV82, /create unique index if not exists inventory_service_use_once_idx[\s\S]*movement_type='service_use'/i, 'The original ledger must already prevent double service write-offs');
assert.match(migration, /movement\.movement_type='service_use'/i, 'Profitability must reuse the one-time service-use ledger');
assert.match(migration, /period\.status='paid'/i, 'Only paid payroll may reduce the visit remainder');
assert.match(migration, /commission\.amount_kopecks commission_kopecks/i, 'Only an explicitly confirmed commission may be included');
assert.match(migration, /remainder_before_overhead_kopecks/i, 'The result must be named remainder before overhead');
assert.doesNotMatch(`${migration}\n${profitability}`, /чистая прибыль/i, 'The feature must not claim net profit');
assert.match(rollback, /v113_rollback_blocked_financial_history_exists/i, 'Rollback must preserve recorded financial history');

assert.match(inventory, /get_minuta_inventory_workspace_v113/);
assert.match(inventory, /costingReady\(\)[\s\S]*costing_enabled === true/);
assert.match(inventory, /apply_minuta_stock_movement_v113/);
assert.match(inventory, /profitability-management\.js\$\{assetQuery\}/);
assert.match(inventory, /document\.currentScript[\s\S]*\.search/, 'The independent assets must inherit the synchronized provider resource version');
assert.match(inventory, /row\.last_purchase_total_cost_kopecks == null \? 'закупочная стоимость не указана'/);
assert.match(profitability, /Не указана/);
assert.match(profitability, /Остаток до общих расходов/);
assert.match(profitability, /Укажите 0, если комиссии точно нет/);
assert.match(profitability, /enable_minuta_inventory_costing_v113/);
assert.match(profitability, /inventory\?\.costing_enabled === true/);
assert.match(styles, /@media \(max-width:760px\)/);
assert.match(styles, /profitability-opt-in/);
assert.match(styles, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/, 'Mobile cards must not keep five cramped columns');
assert.match(styles, /organization-inventory \.organization-row-main[\s\S]*white-space:normal/, 'Inventory names and cost details must wrap instead of being truncated');

console.log('profitability v113 static test: OK');
