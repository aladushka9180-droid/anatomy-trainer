import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('.', import.meta.url);
const migration = await readFile(new URL('supabase-migration-v108.sql', root), 'utf8');
const rollback = await readFile(new URL('supabase-migration-v108-rollback.sql', root), 'utf8');

const functionBlock = migration.match(/create or replace function public\.upsert_minuta_inventory_warehouse[\s\S]*?end \$\$;/i)?.[0] || '';
assert.ok(functionBlock, 'v108 must replace the warehouse RPC');
assert.doesNotMatch(functionBlock, /\bp_quantity\b|\bp_item\b/i);
assert.match(functionBlock, /get_minuta_inventory_role\(p_organization\)/i);
assert.match(functionBlock, /inventory_warehouse_saved/i);
assert.match(migration, /revoke all on function public\.upsert_minuta_inventory_warehouse[^;]+from public,anon,authenticated,service_role/i);
assert.match(migration, /grant execute on function public\.upsert_minuta_inventory_warehouse[^;]+to authenticated/i);
assert.doesNotMatch(rollback, /delete from|truncate|drop table/i);
assert.match(rollback, /\bp_quantity\b/);

console.log('inventory warehouse v108 static test: OK');
