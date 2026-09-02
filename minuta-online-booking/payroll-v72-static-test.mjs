import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const migration = await readFile(join(root, 'supabase-migration-v72.sql'), 'utf8');
const rollback = await readFile(join(root, 'recovery', 'rollback-payroll-v72.sql'), 'utf8');
const integration = await readFile(join(root, 'payroll-v72-integration.sql'), 'utf8');

assert.match(migration, /v72_requires_v71_and_booking_outcome_amount/i, 'v72 must fail closed without its source data');
for (const table of [
  'organization_payroll_settings', 'payroll_plans', 'payroll_plan_tiers', 'payroll_periods',
  'payroll_period_plan_snapshots', 'payroll_items', 'payroll_adjustments', 'payroll_audit_log',
]) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${table}`, 'i'), `${table} must be additive`);
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'), `${table} must use RLS`);
}
assert.match(migration, /organization_payroll_settings[\s\S]*enabled boolean not null default false/i, 'payroll must be disabled by default');
assert.match(migration, /payroll_plans_no_active_overlap[\s\S]*organization_id with =[\s\S]*performer_id with =[\s\S]*daterange/i, 'active plans must not overlap');
assert.match(migration, /outcome\.amount_rub::integer amount_rub[\s\S]*from public\.booking_outcomes outcome[\s\S]*outcome\.visit_status='completed'/i, 'calculation must use completed booking_outcomes.amount_rub');
assert.match(migration, /pg_advisory_xact_lock/i, 'period calculation must serialize concurrent recalculations');
assert.match(migration, /payroll_period_overlap/i, 'overlapping payroll periods must fail closed');
assert.match(migration, /payroll_plan_missing_for_completed_booking/i, 'completed visits without a plan must not be silently omitted');
assert.match(migration, /payroll_periods_idempotency_idx/i, 'period calculation must have an idempotency key');
assert.match(migration, /delete from public\.payroll_items where period_id=v_period[\s\S]*insert into public\.payroll_items/i, 'draft recalculation must replace, not duplicate, items');
assert.match(migration, /payroll_period_plan_snapshots[\s\S]*tiers jsonb/i, 'periods must retain immutable plan snapshots');
assert.match(migration, /enforce_minuta_payroll_period_immutability[\s\S]*old\.status='paid'[\s\S]*old\.status='approved'/i, 'approved and paid periods must be immutable');
assert.match(migration, /enforce_minuta_payroll_draft_children[\s\S]*old\.period_id[\s\S]*new\.period_id/i, 'child rows must not move out of immutable periods');
assert.match(migration, /payroll_period_plan_snapshots[\s\S]*snapshot\.tiers[\s\S]*payroll_source_changed_recalculate_required/i, 'approval must reject stale booking or plan sources');
assert.match(migration, /create or replace function public\.get_minuta_payroll_workspace/i, 'workspace RPC is required');
for (const rpc of [
  'set_minuta_payroll_enabled', 'upsert_minuta_payroll_plan', 'calculate_minuta_payroll_period',
  'add_minuta_payroll_adjustment', 'set_minuta_payroll_period_status',
]) {
  assert.match(migration, new RegExp(`create or replace function public\\.${rpc}`, 'i'), `${rpc} RPC is required`);
  assert.match(migration, new RegExp(`grant execute on function public\\.${rpc}`, 'i'), `${rpc} must be granted explicitly`);
}
for (const protectedRpc of [
  'provider_delete_booking', 'book_appointment', 'book_minuta_appointment', 'get_available_slots',
  'get_minuta_team_calendar_v2', 'get_public_minuta_available_slots_v4',
]) {
  assert.doesNotMatch(migration, new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${protectedRpc}\\s*\\(`, 'i'), `v72 must not replace protected ${protectedRpc}`);
}
assert.match(rollback, /disable_payroll_before_rollback/i, 'rollback must refuse while payroll is enabled');
assert.match(rollback, /export_and_remove_all_payroll_data_before_rollback/i, 'rollback must preserve every payroll business row');
assert.doesNotMatch(rollback, /\bcascade\b/i, 'rollback must not use CASCADE');
assert.match(integration, /v72_calculation_or_idempotency_failed/i, 'integration must exercise real calculation and idempotency');
assert.match(integration, /v72_overlap_was_allowed/i, 'integration must reject overlapping periods');
assert.match(integration, /v72_stale_source_was_approved/i, 'integration must reject stale source data');

console.log('payroll v72 static test: OK');
