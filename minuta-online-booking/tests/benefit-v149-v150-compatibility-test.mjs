import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const application = read('../supabase-migration-v149.sql');
const lifecycle = read('../supabase-migration-v150.sql');
const lifecycleRollback = read('../supabase-migration-v150-rollback.sql');
const controller = read('../benefit-management.js');

assert.match(application, /create or replace function public\.apply_minuta_benefit_v149\s*\(/i);
assert.match(lifecycle, /to_regprocedure\('public\.apply_minuta_benefit_v149\(uuid,uuid,uuid,text,integer,uuid\)'\)/i);
assert.doesNotMatch(lifecycle, /create or replace function public\.apply_minuta_benefit(?:\s|\()/i);
assert.doesNotMatch(lifecycle, /drop function[^;]*apply_minuta_benefit_v149/i);
assert.doesNotMatch(lifecycleRollback, /drop function[^;]*apply_minuta_benefit_v149/i);
assert.match(controller, /async function applyBenefit[\s\S]*db\.rpc\('apply_minuta_benefit_v149',guarded\)/);
assert.match(controller, /data-benefit-action[\s\S]*await applyBenefit\(/);
assert.match(controller, /data-benefit-status[\s\S]*set_minuta_benefit_lifecycle_v150/);

console.log('PASS: v149 idempotent application and v150 lifecycle remain compatible');
