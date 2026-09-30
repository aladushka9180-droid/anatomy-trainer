import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
const source=read('../supabase-migration-v71.sql');
const candidate=read('../supabase-candidate-shift-coverage.sql');
const rollback=read('../supabase-candidate-shift-coverage-rollback.sql');
const org='00000000-0000-4000-8000-000000000010';
const owner='00000000-0000-4000-8000-000000000001';
const location='00000000-0000-4000-8000-000000000020';
const db=new PGlite();
const one=async(sql,params=[])=>(await db.query(sql,params)).rows[0];
const extract=name=>{
  const match=source.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,'i'));
  assert.ok(match,`Exact v71 source missing: ${name}`);
  return match[0];
};

try {
  await db.exec(read('./shift-coverage-native-fixture.sql'));
  await one('select set_config($1,$2,false)',['test.uid',owner]);
  for(const name of [
    'get_minuta_schedule_role','write_minuta_schedule_audit','minuta_booking_fits_active_shift',
    'enforce_minuta_booking_shift','upsert_minuta_staff_shift','set_minuta_branch_shifts_enabled'
  ]) await db.exec(extract(name));
  const trigger=source.match(/create trigger bookings_enforce_active_shift[\s\S]*?execute function public\.enforce_minuta_booking_shift\(\);/i);
  assert.ok(trigger);
  await db.exec(trigger[0]);
  await db.exec(candidate);
  const zero=(await one('select public.preview_minuta_shift_coverage($1) value',[org])).value;
  assert.deepEqual([zero.status,zero.covered_days,zero.horizon_days],['zero',0,14]);
  await assert.rejects(()=>one('select public.set_minuta_branch_shifts_enabled($1,true)',[org]),/shift_coverage_zero/);
  const tomorrow=(await one("select (timezone('Europe/Samara',now())::date+1)::text value")).value;
  await one(`select public.upsert_minuta_staff_shift($1,null,$2,$3,$4,'09:00','18:00',null,null,'Fixture')`,
    [org,location,owner,tomorrow]);
  const partial=(await one('select public.preview_minuta_shift_coverage($1) value',[org])).value;
  assert.deepEqual([partial.status,partial.covered_days,partial.missing_dates.length],['partial',1,13]);
  await assert.rejects(()=>one('select public.set_minuta_branch_shifts_enabled($1,true)',[org]),/shift_coverage_confirmation_required/);
  assert.equal((await one('select public.set_minuta_branch_shifts_enabled_v2($1,true,true,$2) value',[org,partial.token])).value,true);
  assert.equal((await one('select count(*)::integer count from staff_schedule_audit_log where action=$1',
    ['schedule_partial_coverage_confirmed'])).count,1);
  await assert.rejects(()=>db.exec(rollback),/disable_branch_shifts_before_coverage_rollback/);
  await db.exec('rollback;');
  assert.equal((await one('select public.set_minuta_branch_shifts_enabled($1,false) value',[org])).value,false);
  await db.exec(rollback);
  assert.equal((await one("select to_regprocedure('public.set_minuta_branch_shifts_enabled_v71_core(uuid,boolean)') is null removed")).removed,true);
  await db.exec(candidate);
  assert.equal((await one('select public.preview_minuta_shift_coverage($1) value',[org])).value.status,'partial');
  console.log('shift coverage pglite: PASS');
} finally { await db.close(); }
