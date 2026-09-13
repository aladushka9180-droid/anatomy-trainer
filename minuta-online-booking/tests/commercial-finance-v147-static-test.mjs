import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../supabase-migration-v147.sql');
const rollback = read('../supabase-migration-v147-rollback.sql');
const refundSafety = read('../supabase-migration-v148.sql');
const refundSafetyRollback = read('../supabase-migration-v148-rollback.sql');
const controller = read('../commerce-management.js');
const provider = read('../provider.js');
const html = read('../provider.html');
const worker = read('../sw.js');
const integration = read('./commercial-finance-v147-integration.sql');
const releaseWorkflow = read('../../.github/workflows/minuta-v147-safe-release.yml');

for (const table of [
  'commercial_sales', 'commercial_sale_lines', 'commercial_sale_refunds',
  'organization_recurring_expenses', 'recurring_expense_occurrences', 'commercial_audit_log'
]) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${table}\\b`));
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  assert.match(rollback, new RegExp(`drop table if exists public\\.${table}`));
}

for (const rpc of [
  'sell_minuta_commercial_product_v147', 'refund_minuta_commercial_sale_v147',
  'create_minuta_recurring_expense_v147', 'record_minuta_recurring_expense_v147',
  'get_minuta_commerce_workspace_v147', 'get_minuta_money_dashboard_v147', 'get_minuta_client_commerce_v147'
]) {
  assert.match(migration, new RegExp(`create or replace function public\\.${rpc}\\b`));
  assert.match(migration, new RegExp(`grant execute on function public\\.${rpc}`));
  assert.match(rollback, new RegExp(`drop function if exists public\\.${rpc}`));
}

assert.match(migration, /unique\(organization_id,request_id\)/);
assert.match(migration, /pg_advisory_xact_lock[\s\S]*:commerce:/);
assert.match(migration, /issue_minuta_benefit\([\s\S]*apply_minuta_stock_movement/);
assert.match(migration, /insert into public\.financial_transactions[\s\S]*'commercial_sale'/);
assert.match(migration, /insert into public\.financial_postings[\s\S]*'debit'[\s\S]*'credit'/);
assert.match(migration, /used_benefit_cannot_be_refunded/);
assert.match(migration, /refunded_quantity=refunded_quantity\+p_quantity/);
assert.match(migration, /unique\(rule_id,period_month\)/);
assert.match(migration, /accrue_minuta_supplier_expense_v132[\s\S]*pay_minuta_supplier_expense_v132/);
assert.match(migration, /'income_minor'/);
assert.match(migration, /'expense_minor'/);
assert.match(migration, /'expense_structure'/);
assert.match(migration, /'recent_operations'/);
for (const rpc of ['get_minuta_commerce_workspace_v147', 'get_minuta_money_dashboard_v147', 'get_minuta_client_commerce_v147']) {
  const source = migration.match(new RegExp(`create or replace function public\\.${rpc}\\b[\\s\\S]*?end \\$\\$;`))?.[0] || '';
  assert.match(source, /v_actor:=auth\.uid\(\)/);
  assert.match(source, /has_organization_role\(p_organization,array\['owner','admin'\]\)/);
  assert.doesNotMatch(source, /require_minuta_financial_manager_v129/);
}
assert.match(rollback, /v147_rollback_blocked_commercial_data_exists/);
assert.match(refundSafety, /commercial_refund_amount_mismatch/);
assert.match(refundSafety, /commercial_refund_amount_unallocatable/);
assert.match(refundSafety, /lock table public\.commercial_sales/);
assert.match(refundSafety, /v_sale\.total_minor::numeric\*\(v_line\.refunded_quantity\+p_quantity\)\/v_line\.quantity/);
assert.match(refundSafety, /refunded_minor\+p_amount_minor=total_minor[\s\S]*v_line\.refunded_quantity\+p_quantity=v_line\.quantity/);
assert.match(refundSafetyRollback, /create or replace function public\.refund_minuta_commercial_sale_v147/);

assert.match(controller, /minuta-commerce-intent:/);
assert.match(controller, /sell_minuta_commercial_product_v151/);
assert.match(controller, /refund_minuta_commercial_sale_v147/);
assert.match(controller, /create_minuta_recurring_expense_v147/);
assert.match(controller, /record_minuta_recurring_expense_v147/);
assert.match(controller, /get_minuta_money_dashboard_v147/);
assert.match(controller, /function refundableSales\(\)/);
assert.match(controller, /quantity <= remainingQuantity/);
assert.match(controller, /amount <= remainingAmount/);
assert.match(controller, /amount === expectedRefundAmount\(sale, quantity\)/);
assert.match(controller, /2n \* numerator \+ totalQuantity/);
assert.match(controller, /reason\.length >= 3/);
assert.doesNotMatch(controller, /card(number)?|\bpan\b|cvv|cvc/i);

assert.match(provider, /\['commercePanel',[\s\S]*commerce-management\.js/);
assert.match(provider, /financeController\.load\(reportRange\(\)/);
assert.match(provider, /data-commerce-booking-sale/);
assert.match(provider, /get_minuta_client_commerce_v147/);
assert.match(html, /id="commercePanel"/);
assert.match(html, /id="commerceBooking"/);
assert.match(html, /id="commerceRecurringName"[\s\S]*value="Аренда"/);
assert.match(html, /id="commerceRefundEmpty" hidden>[\s\S]*Все продажи полностью возвращены/);
assert.match(html, /id="commerceRecurring"[\s\S]*id="commerceRecurringCount"/);
assert.match(html, /id="commerceRefundCreator" hidden/);
assert.match(html, /id="commerceRefundSale" required/);
assert.match(html, /id="commerceRefundSubmit"[\s\S]*disabled/);
assert.match(html, /id="commerceRefundAmount"[\s\S]*readonly/);
assert.match(html, /id="moneyIncome"/);
assert.match(html, /id="moneyExpenses"/);
assert.match(html, /id="moneyProfit"/);
assert.match(html, /id="clientCommerceHistory"/);
assert.match(html, /commerce-management\.js\?v=738/);
assert.match(worker, /commerce-management\.js\?v=738/);
assert.match(worker, /CACHE_PREFIX}v738/);
assert.doesNotMatch(html, /\?v=711/);
assert.doesNotMatch(worker, /\?v=711/);

assert.match(integration, /begin;[\s\S]*rollback;/);
assert.match(integration, /sale_replay/);
assert.match(integration, /refund_replay/);
assert.match(integration, /monthly_expense_once/);
assert.match(integration, /v147_outsider_accepted/);

for (const phase of ['test-v147', 'validate-production-v147', 'apply-production-v147', 'observe-production-v147']) {
  assert.match(releaseWorkflow, new RegExp(`\\b${phase}:`));
}
assert.match(releaseWorkflow, /test "\$CONFIRMATION" = BACKUP_VERIFIED/);
assert.match(releaseWorkflow, /commercial-finance-v147-integration\.sql/);
assert.match(releaseWorkflow, /supabase-migration-v147-rollback\.sql/);
assert.match(releaseWorkflow, /sourceBackupRunId==\$backup/);
assert.match(releaseWorkflow, /ephemeralContainerDestroyed/);
assert.match(releaseWorkflow, /test "\$\(gh api "repos\/\$GITHUB_REPOSITORY\/git\/ref\/heads\/main" --jq \.object\.sha\)" = "\$SHA"/);

console.log('PrimeTime Pro commercial finance v147 static checks passed');
