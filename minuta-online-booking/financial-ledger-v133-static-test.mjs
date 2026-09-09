import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('./supabase-migration-v133.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('./supabase-migration-v133-rollback.sql', import.meta.url), 'utf8');

for (const signature of [
  'set_minuta_finance_enabled_v133(uuid,boolean)',
  'settle_minuta_customer_debt_v133(uuid,uuid,uuid,text,text,bigint,timestamptz,uuid)',
  'reverse_minuta_customer_debt_settlement_v133(uuid,uuid,uuid,text)',
  'reverse_minuta_visit_finance_v133(uuid,uuid,uuid,text)',
  'get_minuta_financial_reconciliation_v133(uuid,integer)'
]) {
  const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const name = signature.slice(0, signature.indexOf('('));
  assert.match(migration, new RegExp(`create or replace function public\\.${name}\\s*\\(`, 'i'));
  assert.match(migration, new RegExp(`revoke all on function public\\.${escaped}`, 'i'));
  assert.match(migration, new RegExp(`grant execute on function public\\.${escaped}[\\s\\S]*to authenticated`, 'i'));
  assert.match(rollback, new RegExp(`drop function if exists public\\.${escaped}`, 'i'));
}

for (const token of [
  'financial_debt_settlement_sources',
  'payment_channel_commission',
  'customer_debt_settlement',
  'staff_recorded_debt_settlement',
  'customer_debt_settlement_must_be_reversed_first',
  'minuta-financial-reconciliation-v1',
  'source_state',
  'posting_state',
  'natural_balance_minor'
]) assert.match(migration, new RegExp(token, 'i'));

assert.match(migration, /before update or delete on public\.financial_debt_settlement_sources/i);
assert.match(migration, /before insert on public\.financial_transactions[\s\S]*guard_minuta_visit_reversal_v133/i);
assert.match(migration, /security definer set search_path to ''/i);
assert.match(rollback, /v133_rollback_preserves_debt_settlement_evidence/i);
assert.match(rollback, /financial_transactions_operation_v132_check/i);
assert.match(rollback, /financial_accounts_account_type_v132_check/i);

for (const forbidden of ['client_name', 'client_phone', 'customer_name', 'customer_phone']) {
  assert.equal(migration.includes(forbidden), false, `PII token leaked into v133: ${forbidden}`);
}

console.log('financial ledger v133 static contract: debt, commission, reconciliation, ACL and rollback OK');
