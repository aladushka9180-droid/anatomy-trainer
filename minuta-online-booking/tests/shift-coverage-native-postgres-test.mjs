// Exact v71 RPCs plus the O08 candidate on an empty local PostgreSQL 17 fixture.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const connectionString = process.env.SHIFT_COVERAGE_LOCAL_POSTGRES_URL;
assert.ok(connectionString,'SHIFT_COVERAGE_LOCAL_POSTGRES_URL is required');
const target = new URL(connectionString);
assert.ok(['localhost','127.0.0.1'].includes(target.hostname),'Only local PostgreSQL is allowed');
assert.equal(target.pathname,'/shift_coverage_fixture');
assert.equal(target.protocol,'postgresql:');
assert.ok(!target.searchParams.has('sslmode') || target.searchParams.get('sslmode')==='disable');
const read = name => readFileSync(new URL(name,import.meta.url),'utf8');
const v71 = read('../supabase-migration-v71.sql');
const fixture = read('./shift-coverage-native-fixture.sql');
const apply = read('../supabase-candidate-shift-coverage.sql');
const rollback = read('../supabase-candidate-shift-coverage-rollback.sql');
const org='00000000-0000-4000-8000-000000000010';
const owner='00000000-0000-4000-8000-000000000001';
const location='00000000-0000-4000-8000-000000000020';
const clients=[];
const connect=async(api=false)=>{
  const c=new pg.Client({connectionString,ssl:false,application_name:'shift-coverage-native-fixture'});
  await c.connect(); clients.push(c);
  await c.query("set statement_timeout='15s'; set lock_timeout='10s'");
  await c.query('select set_config($1,$2,false)',['test.uid',owner]);
  if(api) await c.query('set role authenticated');
  return c;
};
const one=async(c,sql,params=[]) => (await c.query(sql,params)).rows[0];
const expectCode=async(promise,code) => {
  try { await promise; assert.fail(`Expected SQLSTATE ${code}`); }
  catch(error) { assert.equal(error.code,code,error.message); }
};
const extractFunction=name=>{
  const match=v71.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,'i'));
  assert.ok(match,`Exact v71 source missing: ${name}`);
  return match[0];
};
const coverage=async c=>(await one(c,'select public.preview_minuta_shift_coverage($1) value',[org])).value;
const enable=async(c,flag,confirmed=false,token=null)=>(await one(c,
  'select public.set_minuta_branch_shifts_enabled_v2($1,$2,$3,$4) value',
  [org,flag,confirmed,token])).value;
const oldEnable=async(c,flag)=>(await one(c,
  'select public.set_minuta_branch_shifts_enabled($1,$2) value',[org,flag])).value;
async function addShift(c,date) {
  return (await one(c,`select public.upsert_minuta_staff_shift(
    $1,null,$2,$3,$4,'09:00','18:00',null,null,'Synthetic shift') id`,
    [org,location,owner,date])).id;
}
async function waitForLock(observer,pid) {
  for(let attempt=0;attempt<100;attempt+=1) {
    const row=await one(observer,'select wait_event_type from pg_stat_activity where pid=$1',[pid]);
    if(row?.wait_event_type==='Lock') return;
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  throw new Error('Expected concurrent transaction did not wait on the v71 organization lock');
}
const settled=promise=>promise.then(value=>({value}),error=>({error}));

try {
  const admin=await connect();
  const identity=await one(admin,`select current_database() database,
    current_setting('server_version_num')::integer version,
    (select count(*)::integer from pg_tables where schemaname not in('pg_catalog','information_schema')) user_tables`);
  assert.equal(identity.database,'shift_coverage_fixture');
  assert.ok(identity.version>=170000 && identity.version<180000,'PostgreSQL 17 required');
  assert.equal(identity.user_tables,0,'Refuse a populated database');
  await admin.query(fixture);
  for(const name of [
    'get_minuta_schedule_role','write_minuta_schedule_audit','minuta_booking_fits_active_shift',
    'enforce_minuta_booking_shift','upsert_minuta_staff_shift','set_minuta_branch_shifts_enabled'
  ]) await admin.query(extractFunction(name));
  const trigger=v71.match(/create trigger bookings_enforce_active_shift[\s\S]*?execute function public\.enforce_minuta_booking_shift\(\);/i);
  assert.ok(trigger,'Exact v71 booking trigger missing');
  await admin.query(trigger[0]);
  const api=await connect(true), shiftWriter=await connect(true), bookingWriter=await connect();
  await admin.query(apply);
  const initial=await coverage(api);
  assert.deepEqual([initial.status,initial.covered_days,initial.horizon_days],['zero',0,14]);
  await expectCode(oldEnable(api,true),'55000');
  assert.equal((await one(admin,'select count(*)::integer count from organization_shift_settings')).count,0);

  const firstDay=new Date(`${initial.horizon_start}T12:00:00Z`);
  const day=offset=>{const date=new Date(firstDay);date.setUTCDate(date.getUTCDate()+offset);return date.toISOString().slice(0,10);};
  // An elapsed interval, or a break consuming its remaining hours, cannot cover today.
  const businessTime=await one(admin,"select timezone('Europe/Samara',now())::time value");
  if(businessTime.value<'00:00:02') await new Promise(resolve=>setTimeout(resolve,2000));
  const todayShift=(await one(admin,`insert into staff_location_shifts(
    organization_id,location_id,performer_id,shift_date,start_time,end_time)
    values($1,$2,$3,$4,'00:00:00','00:00:01') returning id`,
    [org,location,owner,day(0)])).id;
  const elapsedToday=await coverage(api);
  assert.deepEqual([elapsedToday.status,elapsedToday.covered_days],['zero',0],
    'A shift whose working interval has ended must not cover today');
  await admin.query(`update staff_location_shifts set end_time='24:00:00',
    break_start='00:00:01',break_end='24:00:00' where id=$1`,[todayShift]);
  assert.equal((await coverage(api)).status,'zero',
    'A break consuming every remaining hour must not cover today');
  await admin.query("update staff_location_shifts set break_end='12:00:00' where id=$1",[todayShift]);
  const remainingToday=await coverage(api);
  assert.deepEqual([remainingToday.status,remainingToday.covered_days,
    remainingToday.missing_dates.includes(day(0))],['partial',1,false],
    'Working time after the break must cover today');
  await admin.query('delete from staff_location_shifts where id=$1',[todayShift]);
  assert.equal((await coverage(api)).status,'zero');

  await addShift(api,day(1));
  const partial=await coverage(api);
  assert.deepEqual([partial.status,partial.covered_days,partial.missing_dates.length],['partial',1,13]);
  await admin.query('update locations set active=false where id=$1',[location]);
  assert.equal((await coverage(api)).status,'zero','Inactive location must not count as coverage');
  await admin.query('update locations set active=true where id=$1',[location]);
  await admin.query('update organization_memberships set is_bookable=false where organization_id=$1',[org]);
  assert.equal((await coverage(api)).status,'zero','Unbookable performer must not count as coverage');
  await admin.query('update organization_memberships set is_bookable=true where organization_id=$1',[org]);
  const absence=(await one(admin,`insert into staff_absences(organization_id,performer_id,starts_on,ends_on)
    values($1,$2,$3,$3) returning id`,[org,owner,day(1)])).id;
  assert.equal((await coverage(api)).status,'zero','Absence must not count as coverage');
  await admin.query('delete from staff_absences where id=$1',[absence]);
  await expectCode(oldEnable(api,true),'55000');
  await expectCode(enable(api,true,false,partial.token),'55000');

  // Actual v71 upsert holds the organization lock while confirmation waits.
  await shiftWriter.query('begin');
  await addShift(shiftWriter,day(2));
  const waitingPid=(await one(api,'select pg_backend_pid() pid')).pid;
  const stale=settled(enable(api,true,true,partial.token));
  await waitForLock(admin,waitingPid);
  await shiftWriter.query('commit');
  assert.equal((await stale).error?.code,'55000');
  const refreshed=await coverage(api);
  assert.equal(refreshed.covered_days,2);
  assert.equal(await enable(api,true,true,refreshed.token),true);
  assert.equal((await one(admin,`select count(*)::integer count from staff_schedule_audit_log
    where action='schedule_partial_coverage_confirmed'`)).count,1);
  assert.equal(await oldEnable(api,false),false);

  // A pre-existing appointment outside any shift remains and blocks activation.
  const outside=(await one(admin,`insert into bookings(
    organization_id,location_id,performer_id,booking_date,booking_time,duration_minutes)
    values($1,$2,$3,$4,'10:00',60) returning id`,[org,location,owner,day(3)])).id;
  await expectCode(enable(api,true,true,(await coverage(api)).token),'P0001');
  assert.equal((await one(admin,'select enabled from organization_shift_settings where organization_id=$1',[org])).enabled,false);
  assert.equal((await one(admin,'select count(*)::integer count from bookings where id=$1',[outside])).count,1);
  await addShift(api,day(3));
  assert.equal(await enable(api,true,true,(await coverage(api)).token),true);
  assert.equal(await oldEnable(api,false),false);

  for(let offset=0;offset<14;offset+=1) {
    if([1,2,3].includes(offset)) continue;
    await addShift(api,day(offset));
  }
  const full=await coverage(api);
  assert.deepEqual([full.status,full.covered_days,full.missing_dates.length],['full',14,0]);
  await admin.query('delete from organization_shift_settings where organization_id=$1',[org]);
  await api.query('begin');
  assert.equal(await oldEnable(api,true),true,'Old clients can activate a fully covered horizon');
  const secondPid=(await one(shiftWriter,'select pg_backend_pid() pid')).pid;
  const secondEnable=settled(oldEnable(shiftWriter,true));
  await waitForLock(admin,secondPid);
  await api.query('commit');
  assert.equal((await secondEnable).value,true,'Concurrent activation must serialize');
  assert.equal((await one(admin,'select count(*)::integer count from organization_shift_settings where organization_id=$1',[org])).count,1);
  await expectCode(admin.query(`insert into bookings(
    organization_id,location_id,performer_id,booking_date,booking_time,duration_minutes)
    values($1,$2,$3,$4,'20:00',60)`,[org,location,owner,day(4)]),'23P01');
  assert.equal(await oldEnable(api,false),false);

  // Booking wins the v71 lock: activation then sees and preserves its conflict.
  await bookingWriter.query('begin');
  const futureBooking=(await one(bookingWriter,`insert into bookings(
    organization_id,location_id,performer_id,booking_date,booking_time,duration_minutes)
    values($1,$2,$3,$4,'10:00',60) returning id`,[org,location,owner,day(20)])).id;
  const apiPid=(await one(api,'select pg_backend_pid() pid')).pid;
  const blockedActivation=settled(oldEnable(api,true));
  await waitForLock(admin,apiPid);
  await bookingWriter.query('commit');
  assert.equal((await blockedActivation).error?.code,'P0001');
  assert.equal((await one(admin,'select count(*)::integer count from bookings where id=$1',[futureBooking])).count,1);
  await admin.query("update bookings set status='cancelled' where id=$1",[futureBooking]);

  // Activation wins the lock: a later booking outside shifts is rejected.
  await api.query('begin');
  assert.equal(await oldEnable(api,true),true);
  const bookingPid=(await one(bookingWriter,'select pg_backend_pid() pid')).pid;
  const blockedBooking=settled(bookingWriter.query(`insert into bookings(
    organization_id,location_id,performer_id,booking_date,booking_time,duration_minutes)
    values($1,$2,$3,$4,'20:00',60)`,[org,location,owner,day(5)]));
  await waitForLock(admin,bookingPid);
  await api.query('commit');
  assert.equal((await blockedBooking).error?.code,'23P01');
  assert.equal((await one(admin,"select count(*)::integer count from bookings where status<>'cancelled'")).count,1);

  await expectCode(admin.query(rollback),'55000');
  await admin.query('rollback');
  assert.equal(await oldEnable(api,false),false);
  await admin.query(rollback);
  assert.equal((await one(admin,`select to_regprocedure(
    'public.set_minuta_branch_shifts_enabled_v71_core(uuid,boolean)') is null removed`)).removed,true);
  assert.equal((await one(admin,`select has_function_privilege('authenticated',
    'public.set_minuta_branch_shifts_enabled(uuid,boolean)','execute') allowed`)).allowed,true);
  await admin.query("update bookings set status='cancelled' where id=$1",[outside]);
  await admin.query('delete from staff_location_shifts');
  assert.equal(await oldEnable(api,true),true,'Rollback restores the exact v71 legacy behavior');
  assert.equal(await oldEnable(api,false),false);
  await admin.query(apply);
  assert.equal((await coverage(api)).status,'zero');
  await expectCode(oldEnable(api,true),'55000');
  console.log('shift coverage native PostgreSQL 17: PASS (zero/partial/full, v71 compatibility, rollback, races)');
} finally {
  await Promise.all(clients.map(c=>c.end().catch(()=>{})));
}
