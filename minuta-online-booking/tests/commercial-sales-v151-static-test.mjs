import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../supabase-migration-v151.sql');
const rollback = read('../supabase-migration-v151-rollback.sql');
const controller = read('../commerce-management.js');
const html = read('../provider.html');
const worker = read('../sw.js');
const integration = read('./commercial-sales-v151-integration.sql');
const workflow = read('../../.github/workflows/minuta-v151-commercial-sales.yml');

const saleSignature = 'sell_minuta_commercial_product_v151(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid)';
assert.match(migration, /v151_requires_commercial_sales_v147/);
assert.match(migration, /create or replace function public\.sell_minuta_commercial_product_v151\(/);
assert.match(migration, /create or replace function public\.get_minuta_commerce_workspace_v151\(p_organization uuid\)/);
assert.match(migration, /v_seller:=coalesce\(p_seller,v_actor\)/);
assert.match(migration, /membership\.organization_id=p_organization and membership\.user_id=v_seller and membership\.active/);
assert.match(migration, /commercial_seller_not_active_member/);
assert.match(migration, /pg_advisory_xact_lock[\s\S]*:commerce:/);
assert.match(migration, /commercial_sale_idempotency_conflict/);
assert.match(migration, /insert into public\.commercial_sales[\s\S]*v_seller,'paid'/);
assert.match(migration, /apply_minuta_stock_movement[\s\S]*insert into public\.financial_transactions[\s\S]*insert into public\.financial_postings/);
assert.match(migration, /'seller_id',v_seller/);
assert.match(migration, /'sellers'[\s\S]*organization_memberships[\s\S]*membership\.active/);
assert.match(migration, /'performer_id',b\.performer_id/);
assert.match(migration, /'seller_name',coalesce\(profile\.display_name,'Сотрудник'\)/);
assert.match(migration, new RegExp(`grant execute on function public\\.${saleSignature.replace(/[()]/g, '\\$&')} to authenticated`));
assert.match(migration, new RegExp(`revoke all on function public\\.${saleSignature.replace(/[()]/g, '\\$&')} from public,anon,authenticated,service_role`));
assert.match(rollback, new RegExp(`drop function if exists public\\.${saleSignature.replace(/[()]/g, '\\$&')}`));
assert.match(rollback, /without touching v147\/v148 data or refund behavior/);
assert.doesNotMatch(migration, /create or replace function public\.refund_minuta_commercial_sale_v147/);
assert.doesNotMatch(rollback, /refund_minuta_commercial_sale_v147/);

assert.match(controller, /get_minuta_commerce_workspace_v151/);
assert.match(controller, /sell_minuta_commercial_product_v151/);
assert.match(controller, /p_seller:payload\.seller/);
assert.match(controller, /const activeWrites = new Set\(\)/);
assert.match(controller, /if \(activeWrites\.has\(writeKey\)\) return false/);
assert.match(controller, /selectSaleSeller\(booking\.performer_id\)/);
assert.match(controller, /Продавец:/);
assert.match(controller, /function updateSaleValidity\(\)/);
assert.match(controller, /total\.textContent = result > 0 \? rubles\(result\) : '—'/);
assert.match(controller, /selectOptions\(items,[\s\S]*selectedItemId\)/);
assert.match(controller, /if \(scope !== 'sale'\)/);
assert.match(controller, /Продажа проведена\. Список обновится/);
assert.match(html, /id="commerceSeller" required/);
assert.match(html, /id="commerceSaleTotal"/);
assert.match(html, /id="commerceSaleSubmit"[\s\S]*disabled/);
assert.match(html, /commerce-management\.js\?v=725/);
assert.match(html, /styles\.css\?v=725/);
assert.match(worker, /commerce-management\.js\?v=725/);
assert.match(worker, /styles\.css\?v=725/);
assert.match(worker, /CACHE_PREFIX}v725/);

assert.match(integration, /sale_replayed/);
assert.match(integration, /single_sale/);
assert.match(integration, /single_stock_write_off/);
assert.match(integration, /single_cash_transaction/);
assert.match(integration, /standalone_manual_sale/);
assert.match(integration, /all_benefit_kinds_issued/);
assert.match(integration, /client_card_history/);
assert.match(integration, /failed_sales_atomic/);

for (const phase of ['test-v151', 'validate-production-v151', 'apply-production-v151', 'observe-production-v151']) {
  assert.match(workflow, new RegExp(`\\b${phase}:`));
}
assert.match(workflow, /test "\$CONFIRMATION" = BACKUP_VERIFIED/);
assert.match(workflow, /commercial-sales-v151-browser-test\.mjs/);
assert.match(workflow, /commercial-sales-v151-integration\.sql/);
assert.match(workflow, /supabase-migration-v151-rollback\.sql/);
assert.match(workflow, /sourceBackupRunId==\$backup/);
assert.match(workflow, /ephemeralContainerDestroyed/);

console.log('PrimeTime Pro commercial sales v151 static checks passed');
