import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('./supabase-migration-v150.sql', import.meta.url), 'utf8');
const lifecycle = readFileSync(new URL('./benefit-lifecycle.js', import.meta.url), 'utf8');
const management = readFileSync(new URL('./benefit-management.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('./provider.html', import.meta.url), 'utf8');
const provider = readFileSync(new URL('./provider.js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('./sw.js', import.meta.url), 'utf8');

for (const table of ['benefit_freeze_periods','benefit_lifecycle_requests']) assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
for (const rpc of ['sync_minuta_benefit_expiry_v150','set_minuta_benefit_lifecycle_v150','get_minuta_benefit_lifecycle_v150']) assert.match(migration, new RegExp(`create or replace function public\\.${rpc}`));
assert.match(migration, /p_action not in \('freeze','unfreeze'\)/);
assert.match(migration, /v_instrument\.status<>'active'[\s\S]*v_instrument\.expires_on<current_date[\s\S]*release_reserved_benefits_before_freeze/);
assert.match(migration, /v_instrument\.status<>'frozen'[\s\S]*v_days:=greatest\(current_date-v_period\.frozen_at::date,0\)[\s\S]*expires_on=v_new_expiry/);
assert.match(migration, /benefit_lifecycle_requests[\s\S]*benefit_lifecycle_request_conflict[\s\S]*'replayed',true/);
assert.match(migration, /event_type in \('issued','reserved','redeemed','released','frozen','activated','expired','cancelled'\)/);
assert.match(migration, /'history',coalesce\(\(select jsonb_agg[\s\S]*benefit_ledger ledger[\s\S]*performer_profiles profile/);
assert.match(migration, /'allowed_actions',case instrument\.status when 'active' then jsonb_build_array\('freeze'\) when 'frozen' then jsonb_build_array\('unfreeze'\)/);
assert.match(migration, /revoke all on function public\.sync_minuta_benefit_expiry_v150[\s\S]*revoke all on function public\.set_minuta_benefit_lifecycle_v150[\s\S]*grant execute on function public\.set_minuta_benefit_lifecycle_v150/);
assert.doesNotMatch(migration, /grant execute on function public\.sync_minuta_benefit_expiry_v150[^;]*to authenticated/i);

assert.match(lifecycle, /История действий/);
assert.match(lifecycle, /minuta_benefit_lifecycle_v150:/);
assert.match(lifecycle, /set_minuta_benefit_lifecycle_v150/);
assert.match(lifecycle, /get_minuta_benefit_lifecycle_v150/);
assert.match(management, /set_minuta_benefit_lifecycle_v150/);
assert.doesNotMatch(management, /await mutate\('set_minuta_benefit_status'/);
assert.match(html, /id="clientBenefitLifecycle"/);
assert.match(html, /benefit-lifecycle\.js\?v=/);
assert.match(provider, /clientBenefitLifecycleController\?\.setClient/);
assert.match(worker, /benefit-lifecycle\.js\?v=/);

console.log('PASS: benefit lifecycle v150 static contract');
