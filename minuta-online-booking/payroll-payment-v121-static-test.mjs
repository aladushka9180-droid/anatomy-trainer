#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const migration = read('./supabase-migration-v121.sql');
const rollback = read('./supabase-migration-v121-rollback.sql');
const payroll = read('./payroll-management.js');
const payment = read('./payment-management.js');
const integration = read('./tests/payroll-payment-v121-integration.sql');

assert.match(migration, /alter table public\.payroll_adjustments add column if not exists request_id uuid/);
assert.match(migration, /create unique index if not exists payroll_adjustments_organization_request_uidx[\s\S]*organization_id,request_id[\s\S]*request_id is not null/);
assert.match(migration, /add_minuta_payroll_adjustment\([\s\S]*p_request_id uuid[\s\S]*pg_advisory_xact_lock/);
assert.match(migration, /where organization_id=p_organization and request_id=p_request_id[\s\S]*for update/);
assert.match(migration, /payroll_adjustment_idempotency_conflict/);
assert.match(migration, /'request_id',adjustment\.request_id/);
assert.doesNotMatch(migration, /or (?:item|adjustment)\.performer_id=v_user\)\)\),'\[\]'::jsonb/);
assert.match(migration, /'promo_redemptions'[\s\S]*'request_id',redemption\.request_id/);
assert.match(migration, /'ledger'[\s\S]*'request_id',entry\.request_id/);
assert.match(migration, /from public\.loyalty_promo_redemptions redemption where redemption\.organization_id=p_organization/);
assert.match(migration, /from \(select \* from public\.loyalty_ledger where organization_id=p_organization/);
assert.doesNotMatch(migration, /drop function public\.add_minuta_payroll_adjustment\(uuid,uuid,uuid,integer,text\)/);

assert.match(rollback, /v121_rollback_blocked_request_ids_exist/);
assert.match(rollback, /drop function public\.add_minuta_payroll_adjustment\(uuid,uuid,uuid,integer,text,uuid\)/);
assert.match(rollback, /drop index public\.payroll_adjustments_organization_request_uidx/);
assert.match(rollback, /alter table public\.payroll_adjustments drop column request_id/);
assert.doesNotMatch(rollback, /drop[\s\S]+cascade/i);
assert.doesNotMatch(rollback, /or (?:item|adjustment)\.performer_id=v_user\)\)\),'\[\]'::jsonb/);

assert.match(payroll, /p_request_id:requestId/);
assert.match(payroll, /minutaPayrollAdjustmentIntent/);
assert.match(payroll, /payload\?\.adjustments\?\.some\(item => String\(item\.request_id/);
assert.doesNotMatch(payroll, /localStorage|sessionStorage|indexedDB/);
assert.match(payment, /scopeMatches\(result\.data, organizationId\)/);
assert.match(payment, /\['creating', 'pending'\]\.includes\(item\.status\)/);
assert.match(payment, /attempt\.status !== 'succeeded'/);
assert.match(payment, /global\.confirm\(/);
assert.match(payment, /recent_refunds/);
assert.match(payment, /recent_reconciliations/);
assert.match(payment, /settingsMatch\(payload\?\.settings, expected\)/);

assert.match(integration, /add_minuta_payroll_adjustment[\s\S]*00000000-0000-4000-8000-000000121002/);
assert.match(integration, /payroll_adjustment_idempotency_conflict/);
assert.match(integration, /get_minuta_loyalty_workspace/);
assert.match(integration, /request_id/);
assert.match(integration, /delete from public\.payroll_adjustments/);

console.log('v121 payroll/payment static contract passed');
