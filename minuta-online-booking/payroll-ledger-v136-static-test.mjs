import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('./supabase-migration-v136.sql');
const rollback = read('./supabase-migration-v136-rollback.sql');
const integration = read('./tests/payroll-ledger-v136-integration.sql');
const workflow = read('../.github/workflows/minuta-v136-payroll-integration.yml');

for (const rpc of [
  'set_minuta_payroll_ledger_enabled_v136',
  'record_minuta_payroll_adjustment_v136',
  'accrue_minuta_payroll_period_v136',
  'pay_minuta_payroll_debt_v136',
  'create_minuta_payroll_advance_v136',
  'offset_minuta_payroll_advance_v136',
  'reverse_minuta_payroll_transaction_v136',
  'get_minuta_payroll_ledger_workspace_v136'
]) {
  assert.match(migration, new RegExp(`create or replace function public\\.${rpc}\\b`, 'i'), `${rpc} must be defined`);
  assert.match(migration, new RegExp(`revoke all on function public\\.${rpc}[\\s\\S]*from public,anon,authenticated,service_role`, 'i'), `${rpc} must fail closed before grants`);
  assert.match(migration, new RegExp(`grant execute on function public\\.${rpc}[\\s\\S]*to authenticated`, 'i'), `${rpc} must be authenticated-only`);
}

assert.match(migration, /record_minuta_payroll_adjustment_v136[\s\S]*p_kind text[\s\S]*bonus[\s\S]*deduction/i);
assert.match(migration, /grant execute on function public\.set_minuta_payroll_period_status\(uuid,uuid,text\) to authenticated/i);
assert.match(migration, /grant select on public\.organization_payroll_settings[\s\S]*public\.payroll_items[\s\S]*to authenticated/i);
assert.match(migration, /pay_minuta_payroll_debt_v136\(\s*p_organization uuid,\s*p_accrual_source uuid,\s*p_performer uuid,\s*p_cash_or_bank_account uuid,\s*p_amount_minor bigint,\s*p_request_id uuid\s*\)/i);
assert.match(migration, /p_request_id uuid/i);
assert.match(migration, /pg_advisory_xact_lock/i);
for (const conflict of [
  'payroll_adjustment_request_conflict', 'payroll_accrual_request_conflict',
  'payroll_payment_request_conflict', 'payroll_advance_request_conflict',
  'payroll_advance_offset_request_conflict', 'payroll_reversal_request_conflict'
]) assert.match(migration, new RegExp(conflict));
assert.match(migration, /payroll_financial_source_immutable/);
assert.match(migration, /payroll_paid_status_managed_by_ledger/);
assert.match(migration, /create trigger payroll_period_auto_accrual_v136/);
assert.match(migration, /payroll_expense/i);
assert.match(migration, /payroll_payable/i);
assert.match(migration, /employee_advance/i);
assert.match(migration, /'payment_accounts'[\s\S]*account\.active[\s\S]*account\.system_key is null[\s\S]*account\.account_class='asset'[\s\S]*account\.account_type in\('cash','bank'\)/i);
assert.match(migration, /source_type[\s\S]*payroll/i);
assert.match(migration, /operation_type[\s\S]*payroll/i);
assert.doesNotMatch(migration, /\bdelete\s+from\s+public\.financial_(?:transactions|postings)\b/i);

const paymentStart = migration.search(/create or replace function public\.pay_minuta_payroll_debt_v136\b/i);
const paymentEnd = migration.indexOf('\n$$;', paymentStart);
assert.ok(paymentStart >= 0 && paymentEnd > paymentStart, 'payment RPC body must be extractable');
const paymentBody = migration.slice(paymentStart, paymentEnd);
const paymentLock = paymentBody.search(/pg_advisory_xact_lock\(hashtextextended\(p_organization::text\|\|':financial-ledger'/i);
const paymentDebt = paymentBody.search(/minuta_payroll_accrual_debt_v136/i);
const paymentInsert = paymentBody.search(/insert into public\.financial_payroll_payment_sources/i);
assert.ok(paymentLock >= 0 && paymentDebt > paymentLock && paymentInsert > paymentDebt,
  'payment must serialize before rechecking debt and inserting its source');

for (const evidence of [
  'auto_accrual_exactly_once', 'typed_bonus_and_deduction', 'advance_offset',
  'partial_payment_zero_debt', 'exact_replay', 'payload_conflict', 'concurrent_payment',
  'tenant_acl', 'balanced_append_only', 'safe_reversal', 'history_preserved'
]) assert.match(integration, new RegExp(evidence, 'i'), `integration evidence ${evidence} missing`);

assert.match(integration, /^begin;/im);
assert.match(integration, /^rollback;/im);
assert.match(integration, /set local role authenticated/i);
assert.match(integration, /request\.jwt\.claim\.sub/i);
assert.match(integration, /sum\([\s\S]*debit[\s\S]*credit/i);
assert.doesNotMatch(integration, /\btruncate\b/i);

assert.match(rollback, /revoke all on function public\.get_minuta_payroll_ledger_workspace_v136[\s\S]*from public,anon,authenticated,service_role/i);
assert.doesNotMatch(rollback, /\btruncate\b|\bdrop\s+[^;]+\bcascade\b/i);
const rollbackDeletes = [...rollback.matchAll(/\bdelete\s+from\s+([^;]+);/gi)].map(match => match[1].replace(/\s+/g, ' ').trim());
assert.deepEqual(rollbackDeletes, [
  'public.organization_payroll_ledger_settings',
  "public.financial_accounts where system_key in('payroll_expense','payroll_payable','employee_advance')"
]);

assert.match(workflow, /name: Minuta v136 payroll integration/);
assert.match(workflow, /payroll_integration:/);
assert.match(workflow, /group: minuta-test-database/);
assert.match(workflow, /migration-config-guard\.mjs/);
assert.match(workflow, /MINUTA_TEST_PROJECT_REF[\s\S]*MINUTA_PRODUCTION_PROJECT_REF/);
assert.match(workflow, /supabase-migration-v136\.sql[\s\S]*payroll-ledger-v136-integration\.sql[\s\S]*supabase-migration-v136-rollback\.sql[\s\S]*supabase-migration-v136\.sql/);
assert.match(workflow, /currentMainVerified:true,isolatedDatabase:true/);
assert.match(workflow, /productionWritten:false,rollbackReapplyPassed:true/);

console.log('D07 payroll ledger v136 static contract: OK');
