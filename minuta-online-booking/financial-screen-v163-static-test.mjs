import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = name => readFileSync(new URL(name, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const migration = read('./supabase-migration-v163.sql');
const rollback = read('./supabase-migration-v163-rollback.sql');
const workflow = read('../.github/workflows/minuta-v163-finance-center.yml');

for (const table of [
  'organization_finance_categories_v163',
  'organization_finance_category_events_v163',
  'financial_manual_expenses_v163'
]) {
  assert.match(migration, new RegExp(`create table public\\.${table}`));
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  assert.match(migration, new RegExp(`alter table public\\.${table} force row level security`));
  assert.match(rollback, new RegExp(`drop table if exists public\\.${table}`));
}

for (const signature of [
  'initialize_minuta_finance_screen_v163(uuid)',
  'create_minuta_finance_category_v163(uuid,uuid,text)',
  'update_minuta_finance_category_v163(uuid,uuid,text,boolean,uuid)',
  'record_minuta_manual_expense_v163(uuid,uuid,text,text,bigint,uuid,date,uuid,uuid)',
  'reverse_minuta_manual_expense_v163(uuid,uuid,uuid,text)',
  'get_minuta_finance_screen_v163(uuid,date,date,uuid,integer,timestamptz,text)'
]) {
  const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const name = signature.slice(0, signature.indexOf('('));
  assert.match(migration, new RegExp(`create or replace function public\\.${name}\\s*\\(`, 'i'));
  assert.match(migration, new RegExp(`revoke all on function public\\.${escaped}[\\s\\S]*from public,anon,authenticated,service_role`, 'i'));
  assert.match(migration, new RegExp(`grant execute on function public\\.${escaped}[\\s\\S]*to authenticated`, 'i'));
  assert.match(rollback, new RegExp(`drop function if exists public\\.${name}`, 'i'));
}

assert.match(migration, /v163_requires_current_financial_ledger_through_v151/);
assert.match(migration, /get_minuta_commerce_workspace_v151\(uuid\)/);
assert.match(migration, /minuta_refund_safety_v148_proportional_rounding/);
assert.match(workflow, /commercial-sales-v151-state\.sql/);
assert.match(workflow, /v163-test-owned-v151[\s\S]*supabase-migration-v151-rollback\.sql/,
  'isolated test must restore an initially absent v151 dependency');
assert.match(workflow, /v163-test-owned[\s\S]*organization_finance_categories_v163'\) is null/,
  'isolated test must restore an initially absent v163 layer');
assert.match(workflow, /testBaselineRestored:true/);
assert.doesNotMatch(migration, /insert into public\.financial_transactions/i,
  'v163 must reuse the single existing ledger instead of writing a second transaction path');
assert.doesNotMatch(migration, /select setting\.organization_id,seed\.system_key/i,
  'migration must not backfill organization category data while applying');

for (const category of [
  "'materials','Материалы'", "'rent','Аренда'", "'salary','Зарплата'",
  "'advertising','Реклама'", "'taxes','Налоги'", "'equipment','Оборудование'",
  "'other','Прочее'"
]) assert.match(migration, new RegExp(category));
assert.match(migration, /category_name_snapshot/);
assert.match(migration, /organization_finance_category_events_immutable_v163/);
assert.match(migration, /financial_manual_expenses_immutable_v163/);
assert.equal((migration.match(/finance_screen_history_is_append_only/g) || []).length, 1);

const manualExpense = migration.match(/create or replace function public\.record_minuta_manual_expense_v163[\s\S]*?\n\$\$;/i)?.[0] || '';
assert.match(manualExpense, /p_occurred_on date/);
assert.match(manualExpense, /p_occurred_on\+time '12:00'/);
assert.match(manualExpense, /at time zone v_timezone/);
assert.match(manualExpense, /manual_expense_future_date/);
assert.match(manualExpense, /p_amount_minor is null or p_amount_minor<=0/);
assert.match(manualExpense, /accrue_minuta_supplier_expense_v132/);
assert.match(manualExpense, /pay_minuta_supplier_expense_v132/);
assert.match(manualExpense, /:manual-expense:/);
assert.match(manualExpense, /manual_expense_idempotency_conflict/);
assert.match(manualExpense, /manual_expense_performer_not_in_organization/);
assert.match(manualExpense, /cash_or_bank_account_required/);

const events = migration.match(/create or replace function public\.minuta_finance_event_rows_v163[\s\S]*?\n\$\$;/i)?.[0] || '';
assert.match(events,
  /event\.base_operation_type='visit_service'[\s\S]*\(visit_booking\.booking_date\+visit_booking\.booking_time\)[\s\S]*at time zone organization_context\.timezone/,
  'posted visit and its reversal must be periodized by visit business time');
assert.match(events, /then expense_source\.occurred_at else event\.event_occurred_at end occurred_at/,
  'non-visit operations must preserve their authoritative occurred_at policy');
assert.match(events, /-event\.reversal_sign\*event\.debt_commission_minor/,
  'normal commission must be a negative flow and reversal positive');
assert.match(events, /event\.occurred_at,event\.cash_delta_minor[\s\S]*supplier_expense_payment/,
  'normal supplier/payroll payment must remain a negative cash flow');
assert.match(events, /commercial_refund/);
assert.match(events, /supplier_expense_payment/);
assert.match(events, /payroll_payment/);

const screen = migration.match(/create or replace function public\.get_minuta_finance_screen_v163[\s\S]*?\n\$\$;/i)?.[0] || '';
assert.match(screen,
  /active_visit_ledger[\s\S]*booking\.booking_date\+booking\.booking_time[\s\S]*at time zone v_timezone[\s\S]*>=v_period_start/,
  'posted visit debt must use the same local business date as its income event');
for (const invariant of [
  "outcome.visit_status='completed'",
  "outcome.completion_source='manual'",
  "outcome.payment_method in('cash','transfer')",
  "booking.status<>'cancelled'",
  "booking.payment_status='not_required'",
  'attempt.captured_amount_minor>0',
  "payment.status in('paid','refunded')",
  "transaction_row.operation_type='visit_service'",
  "'unposted_visit_payment'::text source_kind",
  'not visit.ledger_posted',
  "'unposted_payment_visits'",
  "'unknown_payment_visits'",
  "'result_reliable'",
  "'expense_readiness'"
]) assert.ok(screen.includes(invariant), `missing finance-screen invariant: ${invariant}`);
assert.doesNotMatch(screen, /outcome\.payment_method in\([^)]*card/i);
assert.match(screen, /outcome\.amount_rub<=outcome\.calculated_amount_rub/);
assert.match(screen, /\(booking\.booking_date\+booking\.booking_time\) at time zone v_timezone/,
  'unposted payment must be periodized by visit business time, not edit time');
assert.doesNotMatch(screen, /outcome\.updated_at occurred_at/);
assert.match(screen, /unposted_outcome_debts/);
assert.match(screen, /sum\(event\.flow_minor\).*events event/s);
assert.match(screen, /sum\(-event\.flow_minor\).*events event/s);
assert.match(screen, /'net_minor',coalesce\(\(select sum\(event\.flow_minor\)/);
assert.match(screen, /p_before_occurred_at,p_before_key/);
assert.match(screen, /p_limit\+1/);

// Signed flow contract: refunds reduce received, commissions/expenses reduce
// the result, and reversing a commission restores both expense and net.
const signedFixture = [
  { group:'income', flow:100_000n },
  { group:'income', flow:-20_000n },
  { group:'expense', flow:-3_000n },
  { group:'expense', flow:3_000n },
  { group:'expense', flow:-40_000n }
];
const received = signedFixture.filter(row => row.group === 'income')
  .reduce((sum, row) => sum + row.flow, 0n);
const expense = signedFixture.filter(row => row.group === 'expense')
  .reduce((sum, row) => sum - row.flow, 0n);
const net = signedFixture.reduce((sum, row) => sum + row.flow, 0n);
assert.equal(received, 80_000n);
assert.equal(expense, 40_000n);
assert.equal(net, received - expense);

assert.match(rollback, /v163_rollback_preserve_manual_expense_metadata_export_and_remove_first/);
assert.match(rollback, /v163_rollback_preserve_category_audit_export_and_remove_first/);
assert.match(rollback, /v163_rollback_preserve_custom_categories_export_and_remove_first/);
assert.doesNotMatch(rollback, /\bcascade\b/i);

console.log('finance screen v163 static contract: single ledger, truthful fallback, expenses, ACL and rollback OK');
