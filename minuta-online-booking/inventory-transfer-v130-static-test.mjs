import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('.', import.meta.url);
const migration = await readFile(new URL('supabase-migration-v130.sql', root), 'utf8');
const rollback = await readFile(new URL('supabase-migration-v130-operational-rollback.sql', root), 'utf8');
const schemaRollback = await readFile(new URL('supabase-migration-v130-schema-rollback.sql', root), 'utf8');
const v82 = await readFile(new URL('supabase-migration-v82.sql', root), 'utf8');
const controller = await readFile(new URL('inventory-management.js', root), 'utf8');
const provider = await readFile(new URL('provider.html', root), 'utf8');

for (const table of [
  'organization_inventory_transfer_settings',
  'inventory_transfer_documents',
  'inventory_cost_layers',
  'inventory_movement_cost_snapshots',
  'inventory_cost_allocations'
]) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${table}`, 'i'));
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
  assert.match(migration, new RegExp(`grant select on[\\s\\S]*public\\.${table}[\\s\\S]*to authenticated`, 'i'));
}

assert.match(migration, /enabled boolean not null default false/i);
assert.match(migration, /unique\(organization_id,request_id\)/i);
assert.match(migration, /check\(source_warehouse_id<>destination_warehouse_id\)/i);
assert.match(migration, /movement_type in \('receipt','write_off','inventory','service_use','transfer_out','transfer_in'\)/i);
assert.match(migration, /unique index if not exists inventory_transfer_movement_side_v130/i);
assert.match(migration, /constraint trigger inventory_transfer_document_pair_v130[\s\S]*deferrable initially deferred/i);
assert.match(migration, /function public\.verify_minuta_inventory_transfer_pair_v130\(\)[\s\S]*security definer[\s\S]*set search_path to ''/i);
assert.match(migration, /inventory_transfer_pair_incomplete/i);

assert.match(migration, /transferred_from_layer_id bigint[\s\S]*foreign key\(transferred_from_layer_id,organization_id\)[\s\S]*references public\.inventory_cost_layers\(id,organization_id\)/i);
assert.match(migration, /foreign key\(movement_id,organization_id\)[\s\S]*references public\.inventory_movements\(id,organization_id\)/i);
assert.match(migration, /inventory_cost_layers_fifo_v130[\s\S]*created_at,id/i);
assert.match(migration, /order by layer\.created_at,layer\.id[\s\S]*for update/i);
assert.match(migration, /allocation\.unit_cost_kopecks[\s\S]*source_layer\.id/i);
assert.match(migration, /case when v_complete then round\(v_total\)::bigint else null end/i);
assert.match(migration, /transferred_from_layer_id[\s\S]*transfer-v130:/i);
assert.match(migration, /allocation\.unit_cost_kopecks,source_layer\.created_at/i);

for (const legacy of ['apply_minuta_stock_movement', 'consume_minuta_inventory_for_booking']) {
  const body = migration.match(new RegExp(`create or replace function public\\.${legacy}\\([\\s\\S]*?end \\$\\$;`, 'i'))?.[0] || '';
  assert.ok(body, `${legacy} lock-safe v130 override must exist`);
  assert.match(body, /pg_advisory_xact_lock_shared\(13000\)[\s\S]*pg_advisory_xact_lock\(hashtextextended\([^\n]*13001\)[\s\S]*pg_advisory_xact_lock\(hashtextextended\([^\n]*8201\)/i);
}

const transfer = migration.match(/create or replace function public\.transfer_minuta_inventory_stock_v130[\s\S]*?end \$\$;/i)?.[0] || '';
assert.ok(transfer, 'transfer RPC must exist');
assert.match(transfer, /get_minuta_inventory_role\(p_organization\)[\s\S]*pg_advisory_xact_lock\(hashtextextended\(p_organization::text\|\|':'\|\|p_request_id::text,8200\)\)[\s\S]*get_minuta_inventory_role\(p_organization\)/i);
assert.match(transfer, /select \* into v_document[\s\S]*inventory_transfer_request_conflict/i);
assert.match(transfer, /order by warehouse\.id::text for update/i);
assert.match(transfer, /order by balance\.warehouse_id::text for update/i);
assert.match(transfer, /movement_type,quantity_delta[\s\S]*'transfer_out',-p_quantity[\s\S]*'transfer_in',p_quantity/i);
assert.match(transfer, /inventory_transfer_cost_layers_incomplete/i);

for (const rpc of [
  'enable_minuta_inventory_transfers_v130',
  'set_minuta_inventory_transfers_enabled_v130',
  'apply_minuta_stock_movement_v130',
  'transfer_minuta_inventory_stock_v130',
  'get_minuta_inventory_workspace_v130'
]) {
  assert.match(migration, new RegExp(`grant execute on function public\\.${rpc}`, 'i'));
}
assert.match(migration, /revoke all on function public\.transfer_minuta_inventory_stock_v130[\s\S]*from public,anon,authenticated,service_role/i);
assert.doesNotMatch(migration, /grant execute on function public\.transfer_minuta_inventory_stock_v130[\s\S]*\bto anon\b/i);

assert.match(rollback, /select pg_advisory_xact_lock\(13000\)/i);
assert.match(rollback, /enabled=false[\s\S]*suspended_at=coalesce\(suspended_at,now\(\)\)/i);
assert.match(rollback, /revoke execute on function public\.transfer_minuta_inventory_stock_v130/i);
assert.match(rollback, /inventory_movement_cost_v130/i);
assert.doesNotMatch(rollback, /\bdrop\s+(?:table|column|constraint)\b|\btruncate\b|\bdelete\s+from\b/i);

assert.match(schemaRollback, /select pg_advisory_xact_lock\(13000\)[\s\S]*v130_schema_rollback_refused_ledger_not_empty/i);
assert.ok(schemaRollback.indexOf('v130_schema_rollback_refused_ledger_not_empty') < schemaRollback.indexOf('drop trigger'),
  'schema rollback evidence gate must precede destructive DDL');
for (const evidence of [
  'initialized_at is not null',
  'inventory_transfer_documents',
  'inventory_cost_allocations',
  'inventory_movement_cost_snapshots',
  'inventory_cost_layers',
  'transfer_document_id is not null',
  'purchase_total_cost_kopecks is not null',
  "movement_type in ('transfer_out','transfer_in')"
]) assert.ok(schemaRollback.includes(evidence), `schema rollback must refuse on ${evidence}`);
assert.match(schemaRollback, /drop table public\.inventory_cost_allocations[\s\S]*drop table public\.organization_inventory_transfer_settings/i);
assert.match(schemaRollback, /drop column purchase_total_cost_kopecks,[\s\S]*drop column transfer_document_id/i);
assert.match(schemaRollback, /add constraint inventory_movements_movement_type_check[\s\S]*'receipt','write_off','inventory','service_use'/i);
assert.doesNotMatch(schemaRollback, /\bdelete\s+from\b|\btruncate\b/i);
for (const legacy of ['apply_minuta_stock_movement', 'consume_minuta_inventory_for_booking']) {
  const pattern = new RegExp(`create or replace function public\\.${legacy}\\([\\s\\S]*?end \\$\\$;`, 'i');
  const body = schemaRollback.match(pattern)?.[0] || '';
  const original = v82.match(pattern)?.[0] || '';
  assert.ok(body, `${legacy} v108 restoration must exist`);
  assert.doesNotMatch(body, /13000|13001|transfer_minuta_inventory_stock_v130/i);
  assert.equal(body.toLowerCase().replace(/\s+/g,''), original.toLowerCase().replace(/\s+/g,''),
    `${legacy} must be restored exactly to v82/v108 semantics`);
}
assert.match(schemaRollback, /revoke all on function public\.apply_minuta_stock_movement[\s\S]*grant execute on function public\.apply_minuta_stock_movement[\s\S]*to authenticated/i);
assert.match(schemaRollback, /revoke all on function public\.consume_minuta_inventory_for_booking\(uuid\)[\s\S]*from public,anon,authenticated,service_role/i);
assert.match(schemaRollback, /v130_schema_rollback_postcondition_failed/i);

for (const rpc of ['get_minuta_inventory_workspace_v130','enable_minuta_inventory_transfers_v130','set_minuta_inventory_transfers_enabled_v130','transfer_minuta_inventory_stock_v130','apply_minuta_stock_movement_v130'])
  assert.match(controller, new RegExp(`['"]${rpc}['"]`));
for (const id of ['inventoryTransfersSetting','enableInventoryTransfers','inventoryTransfersEnabled','inventoryTransferDestination','inventoryTransferBalance','inventoryTransferError','inventoryTransferDocumentsList'])
  assert.match(provider, new RegExp(`id=["']${id}["']`));
assert.match(provider, /option value="transfer">Перемещение между складами/);
assert.match(controller, /const transferIntents = new Map\(\)/);
assert.match(controller, /transfer_out[\s\S]*transfer_in/);

console.log('inventory transfer v130 static contract: OK');
