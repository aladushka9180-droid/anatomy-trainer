import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../supabase-migration-v150.sql');
const rollback = read('../supabase-migration-v150-rollback.sql');
const controller = read('../benefit-lifecycle.js');
const provider = read('../provider.js');
const html = read('../provider.html');
const css = read('../benefit-lifecycle.css');
const worker = read('../sw.js');

for (const table of ['benefit_freeze_periods','benefit_lifecycle_requests']) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${table}\\b`));
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  assert.match(rollback, new RegExp(`drop table if exists public\\.${table}`));
}
for (const rpc of ['sync_minuta_benefit_expiry_v150','set_minuta_benefit_lifecycle_v150','get_minuta_benefit_lifecycle_v150']) {
  assert.match(migration, new RegExp(`create or replace function public\\.${rpc}\\b`));
  assert.match(rollback, new RegExp(`drop function if exists public\\.${rpc}`));
}
assert.match(migration, /action in \('freeze','unfreeze'\)/);
assert.match(migration, /primary key\(organization_id,request_id\)/);
assert.match(migration, /benefit_lifecycle_request_conflict/);
assert.match(migration, /release_reserved_benefits_before_freeze/);
assert.match(migration, /lock table public\.client_benefit_instruments in exclusive mode/i);
assert.match(migration, /instrument\.status<>'frozen'/);
assert.match(migration, /minuta_benefit_frozen_days_v150/);
assert.match(migration, /pg_catalog\.timezone\(v_timezone,clock_timestamp\(\)\)::date/);
assert.match(rollback, /v150_rollback_blocked_freeze_history_exists/);
assert.match(rollback, /v150_rollback_blocked_unexpected_function_version/);
assert.match(migration, /v_days:=public\.minuta_benefit_frozen_days_v150/);
assert.match(migration, /v_new_expiry:=v_instrument\.expires_on\+v_days/);
assert.match(migration, /instrument\.expires_on<v_today/);
assert.match(migration, /'event_type',ledger\.event_type/);
assert.match(migration, /'actor_name',profile\.display_name/);
assert.match(migration, /'allowed_actions'/);
assert.doesNotMatch(migration, /create or replace function public\.(?:apply_minuta_benefit|sell_minuta_commercial_product|refund_minuta_commercial_sale)/);
assert.match(rollback, /v150_rollback_blocked_lifecycle_history_exists/);
assert.match(rollback, /v150_rollback_blocked_expiry_history_exists/);

assert.match(controller, /get_minuta_benefit_lifecycle_v150/);
assert.match(controller, /set_minuta_benefit_lifecycle_v150/);
assert.match(controller, /minuta_benefit_lifecycle_v150:/);
assert.match(controller, /data-client-benefit-action="freeze"/);
assert.match(controller, /data-client-benefit-action="unfreeze"/);
assert.match(controller, /История действий/);
assert.doesNotMatch(controller, /client_name|client_phone|remaining_(?:amount|visits).*localStorage\.setItem/i);

assert.match(provider, /clientBenefitLifecycleController\?\.setClient/);
assert.match(provider, /clientBenefitLifecycleController\?\.reset/);
assert.match(html, /id="clientBenefitLifecycle"/);
assert.match(html, /benefit-lifecycle\.css\?v=(\d+)/);
assert.match(html, /benefit-lifecycle\.js\?v=(\d+)/);
assert.match(css, /@media \(max-width:760px\)/);
assert.match(css, /min-height:44px/);
assert.match(css, /prefers-reduced-motion:reduce/);
assert.match(worker, /benefit-lifecycle\.css\?v=(\d+)/);
assert.match(worker, /benefit-lifecycle\.js\?v=(\d+)/);

const cacheVersion = worker.match(/CACHE_PREFIX}v(\d+)/)?.[1];
assert.ok(cacheVersion);
for (const source of [html, worker]) {
  for (const match of source.matchAll(/benefit-lifecycle\.(?:css|js)\?v=(\d+)/g)) assert.equal(match[1], cacheVersion);
}

console.log('PrimeTime Pro benefit lifecycle v150 static checks passed');
