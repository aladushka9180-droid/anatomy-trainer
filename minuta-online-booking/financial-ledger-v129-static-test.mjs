import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = name => readFileSync(new URL(name, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const migration = read('./supabase-migration-v129.sql');
const rollback = read('./supabase-migration-v129-rollback.sql');
const contract = read('./design/FINANCIAL_LEDGER_V129_CONTRACT.md');

for (const table of [
  'organization_finance_settings','financial_accounts','financial_transactions','financial_postings',
]) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
}
assert.match(migration, /enabled boolean not null default false/);
assert.match(migration, /account_class in\('asset','liability','income','expense'\)/);
assert.match(migration, /account_type in\('cash','bank','receivable','service_revenue'\)/);
assert.match(migration, /amount_minor bigint not null check\(amount_minor>0/);
assert.match(migration, /deferrable initially deferred[\s\S]*assert_minuta_financial_transaction_balanced_v129/);
assert.match(migration, /financial_transaction_not_balanced/);
assert.match(migration, /financial_ledger_is_append_only/);
assert.match(migration, /unique\(organization_id,request_id\)/);
assert.match(migration, /pg_advisory_xact_lock[\s\S]*:booking:/);
assert.equal((migration.match(/p_organization::text\|\|':financial-ledger'/g)||[]).length,4);
assert.match(migration, /from public\.organization_memberships membership[\s\S]*for update of membership/);
assert.equal((migration.match(/v_actor:=public\.require_minuta_financial_manager_v129\(p_organization\)/g)||[]).length,5);
assert.equal((migration.match(/message='finance_disabled'/g)||[]).length,3);
assert.match(migration, /financial_account_idempotency_conflict/);
assert.match(migration, /financial_transaction_idempotency_conflict/);
assert.match(migration, /financial_visit_already_posted/);

for (const guard of [
  "v_booking.completion_source<>'manual'",
  "v_booking.payment_method='card'",
  'provider_payment_requires_adapter',
  'overpayment_requires_advance_account',
  'unpaid_visit_must_not_select_cash_account',
  'destination_account_type_mismatch',
]) assert.ok(migration.includes(guard), `missing financial source guard: ${guard}`);

assert.match(migration, /payment\.status in\('paid','refunded'\)/);
assert.match(migration, /attempt\.captured_amount_minor>0/);
assert.match(migration, /'evidence_kind','staff_recorded'/);
assert.match(migration, /'evidence_kind','explicit_reversal'/);
assert.match(migration, /p_reason_code not in\('source_corrected','duplicate_entry','account_correction'\)/);
assert.match(migration, /case posting\.side when 'debit' then 'credit' else 'debit' end/);
assert.doesNotMatch(migration, /'client_(?:name|phone)'|booking\.client_(?:name|phone)/);

for (const rpc of [
  'set_minuta_finance_enabled_v129','create_minuta_financial_account_v129',
  'post_minuta_visit_finance_v129','reverse_minuta_financial_transaction_v129',
  'get_minuta_financial_workspace_v129',
]) {
  assert.match(migration, new RegExp(`grant execute on function public\\.${rpc}`));
  assert.match(migration, new RegExp(`revoke all on function public\\.${rpc}`));
}
assert.match(migration, /has_organization_role\(p_organization,array\['owner','admin'\]\)/);
assert.match(migration, /revoke all on public\.organization_finance_settings,[\s\S]*from public,anon,authenticated,service_role/);
assert.match(migration, /grant select on public\.organization_finance_settings,[\s\S]*to authenticated/);

assert.match(rollback, /v129_rollback_disable_finance_first/);
assert.match(rollback, /v129_rollback_export_and_remove_financial_data_first/);
assert.doesNotMatch(rollback, /\bcascade\b/i);
assert.match(contract, /исправление — только новая обратная/i);
assert.match(contract, /не входят расходы, поставщики, комиссии/i);

console.log('financial ledger v129 static contract: OK');
