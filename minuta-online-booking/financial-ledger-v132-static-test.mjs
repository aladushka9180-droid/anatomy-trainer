import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const migration = read('./supabase-migration-v132.sql');
const rollback = read('./supabase-migration-v132-rollback.sql');

const signatures = [
  'set_minuta_finance_enabled_v132(uuid,boolean)',
  'create_minuta_financial_supplier_v132(uuid,uuid,text)',
  'accrue_minuta_supplier_expense_v132(uuid,uuid,uuid,bigint,timestamp with time zone,uuid)',
  'pay_minuta_supplier_expense_v132(uuid,uuid,uuid,uuid)',
  'reverse_minuta_supplier_expense_payment_v132(uuid,uuid,uuid,text)',
  'reverse_minuta_supplier_expense_accrual_v132(uuid,uuid,uuid,text)'
];

for (const relation of ['financial_suppliers', 'financial_expense_sources']) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${relation}\\b`, 'i'));
  assert.match(migration, new RegExp(`alter table public\\.${relation} enable row level security`, 'i'));
  assert.match(rollback, new RegExp(`drop table if exists public\\.${relation}`, 'i'));
}

for (const signature of signatures) {
  const name = signature.slice(0, signature.indexOf('('));
  assert.match(migration, new RegExp(`create or replace function public\\.${name}\\s*\\(`, 'i'));
  assert.match(migration, new RegExp(`revoke all on function public\\.${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'));
  assert.match(migration, new RegExp(`grant execute on function public\\.${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[\\s\\S]*to authenticated`, 'i'));
  assert.match(rollback, new RegExp(`drop function if exists public\\.${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(`, 'i'));
}

assert.match(migration, /to_regclass\('public\.financial_transactions'\)[\s\S]*to_regclass\('public\.financial_postings'\)/i);
assert.match(migration, /operating_expense/i);
assert.match(migration, /supplier_payable/i);
assert.match(migration, /account_class/i);
assert.match(migration, /\bexpense\b/i);
assert.match(migration, /\bliability\b/i);
assert.match(migration, /amount_minor[\s\S]*>\s*0/i);
assert.match(migration, /supplier_expense_accrual/i);
assert.match(migration, /supplier_expense_payment/i);
assert.match(migration, /financial_expense_source_is_immutable/i);
assert.match(migration, /financial_expense_payment_must_be_reversed_first/i);
assert.match(migration, /finance_disabled/i);
assert.match(migration, /financial_manager_role_required/i);
assert.match(migration, /pg_advisory_xact_lock/i);
assert.match(migration, /request_fingerprint/i);
assert.match(migration, /reversal_of/i);
assert.match(migration, /\bdebit\b/i);
assert.match(migration, /\bcredit\b/i);
assert.match(migration, /account_type/i);
assert.match(migration, /\bcash\b/i);
assert.match(migration, /\bbank\b/i);
assert.match(migration, /active/i);
assert.match(migration, /set search_path to ''/i);

assert.doesNotMatch(migration, /grant\s+(?:insert|update|delete|all)[^;]*financial_(?:suppliers|expense_sources)[^;]*authenticated/i);
assert.doesNotMatch(migration, /drop\s+(?:table|function)[^;]*cascade/i);
assert.doesNotMatch(rollback, /\bcascade\b/i);

console.log('financial ledger v132 expense static contract: OK');
