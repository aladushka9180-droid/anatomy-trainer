import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = name => readFileSync(new URL(`../${name}`,import.meta.url),'utf8');
const migration=read('inventory-item-catalog-candidate.sql');
const rollback=read('inventory-item-catalog-rollback.sql');
const controller=read('inventory-management.js');
const integration=readFileSync(new URL('../../integration.patch',import.meta.url),'utf8');
const workflow=readFileSync(new URL('../../.github/workflows/inventory-item-catalog-isolated.yml',import.meta.url),'utf8');
const postgres=readFileSync(new URL('./inventory-item-catalog-postgres-test.mjs',import.meta.url),'utf8');

assert.match(migration,/add column if not exists category text/i);
assert.match(migration,/add column if not exists icon text/i);
assert.match(migration,/public\.get_minuta_inventory_workspace_v130\(p_organization\)/);
assert.match(migration,/public\.upsert_minuta_inventory_item\(p_organization,p_item,p_name,p_sku,p_unit,p_low_stock,p_active\)/);
assert.match(migration,/item\.organization_id=p_organization/);
assert.match(migration,/grant execute on function public\.get_minuta_inventory_workspace_catalog\(uuid\) to authenticated/i);
assert.match(migration,/grant execute on function public\.upsert_minuta_inventory_item_catalog.*to authenticated/is);
assert.doesNotMatch(migration,/\b(?:delete from|truncate|drop table|update public\.inventory_stock_balances|update public\.inventory_movements)\b/i);
assert.match(rollback,/drop function if exists public\.get_minuta_inventory_workspace_catalog/);
assert.doesNotMatch(rollback,/drop column|drop table|delete from|truncate/i);
assert.match(controller,/catalogRequested = options\.inventoryCatalog === true/);
assert.match(controller,/catalog \? 'upsert_minuta_inventory_item_catalog' : 'upsert_minuta_inventory_item'/);
assert.match(integration,/inventoryCatalog:definition\.inventoryCatalog === true/);
assert.match(workflow,/image: postgres:17/);
assert.doesNotMatch(workflow,/secrets\./);
assert.match(postgres,/migration-config-guard\.mjs/);
assert.match(postgres,/session_replication_role|inventory_items/);
console.log('O24 additive catalog, scoped RPC, old-client fallback and preserving rollback static contract PASS');
