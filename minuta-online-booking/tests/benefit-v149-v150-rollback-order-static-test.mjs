import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const rollback149=read('../supabase-migration-v149-rollback.sql');
const order=read('./benefit-v149-v150-rollback-order.sql');

for(const signature of [
  'get_minuta_benefit_timezone_v150\\(uuid\\)',
  'minuta_benefit_frozen_days_v150\\(text,timestamptz,timestamptz\\)',
  'sync_minuta_benefit_expiry_v150\\(uuid,uuid\\)',
  'set_minuta_benefit_lifecycle_v150\\(uuid,uuid,text,text,uuid\\)',
  'get_minuta_benefit_lifecycle_v150\\(uuid,uuid\\)'
]) assert.match(rollback149,new RegExp(`to_regprocedure\\('public\\.${signature}'\\) is not null`,'i'));

for(const table of ['benefit_freeze_periods','benefit_lifecycle_requests'])
  assert.match(rollback149,new RegExp(`to_regclass\\('public\\.${table}'\\) is not null`,'i'));

assert.match(rollback149,/minuta_benefit_lifecycle_compatibility_v150/i);
assert.match(rollback149,/minuta_benefit_lifecycle_v150/i);
assert.match(rollback149,/v149_rollback_blocked_v150_installed_rollback_v150_first/i);

const rollback150=order.indexOf('supabase-migration-v150-rollback.sql');
const rollback149Index=order.indexOf('supabase-migration-v149-rollback.sql');
const reapply149=order.lastIndexOf('supabase-migration-v149.sql');
const reapply150=order.lastIndexOf('supabase-migration-v150.sql');
assert.ok(rollback150>=0&&rollback149Index>rollback150,'v150 rollback must precede v149 rollback');
assert.ok(reapply149>rollback149Index&&reapply150>reapply149,'v149 must be reapplied before v150');
assert.match(order,/benefit-application-v149-rollback-check\.sql/i);
assert.match(order,/v149_v150_ordered_rollback_left_objects/i);
assert.match(order,/v149_v150_ordered_reapply_missing_objects/i);

console.log('PASS: v149 rollback is dependency-safe with v150');
