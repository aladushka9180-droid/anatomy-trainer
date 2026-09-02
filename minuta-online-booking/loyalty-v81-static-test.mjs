import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=dirname(fileURLToPath(import.meta.url));
const migration=await readFile(join(root,'supabase-migration-v81.sql'),'utf8');
const rollback=await readFile(join(root,'supabase-migration-v81-rollback.sql'),'utf8');
for(const table of ['organization_loyalty_settings','loyalty_rules','client_loyalty_accounts','loyalty_visit_awards','loyalty_ledger','loyalty_redemptions','loyalty_promotions','loyalty_promo_redemptions']){
  assert.match(migration,new RegExp(`create table if not exists public\\.${table}`,'i'));
  assert.match(migration,new RegExp(`alter table public\\.${table} enable row level security`,'i'));
}
assert.match(migration,/organization_loyalty_settings[\s\S]*enabled boolean not null default false/i);
assert.match(migration,/protect_minuta_loyalty_history/i);
for(const rpc of ['set_minuta_loyalty_enabled','upsert_minuta_loyalty_rule','adjust_minuta_loyalty_balance','redeem_minuta_loyalty','upsert_minuta_promotion','set_minuta_promotion_active','redeem_minuta_promotion','get_minuta_loyalty_workspace'])assert.match(migration,new RegExp(`grant execute on function public\\.${rpc}`,'i'));
for(const protectedRpc of ['provider_delete_booking','book_appointment','book_minuta_appointment'])assert.doesNotMatch(migration,new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${protectedRpc}\\s*\\(`,'i'));
assert.doesNotMatch(rollback,/\bcascade\b/i);
console.log('loyalty v81 static test: OK');
