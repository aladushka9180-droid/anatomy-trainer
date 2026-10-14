import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(process.env.MINUTA_PGLITE_MODULE ? pathToFileURL(process.env.MINUTA_PGLITE_MODULE).href : '@electric-sql/pglite');
const db = new PGlite();
const migration = readFileSync(new URL('../supabase-migration-v71.sql', import.meta.url), 'utf8');
const functionSql = name => {
  const found = migration.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`, 'i'));
  assert.ok(found, name); return found[0];
};
const apply = readFileSync(new URL('../sql-candidates/team-schedule-end-boundary/apply.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../sql-candidates/team-schedule-end-boundary/rollback.sql', import.meta.url), 'utf8');
const org = '00000000-0000-0000-0000-000000000001', location = '00000000-0000-0000-0000-000000000002', performer = '00000000-0000-0000-0000-000000000003';
const scalar = async sql => Object.values((await db.query(sql)).rows[0])[0];
const fits = (start, duration) => scalar(`select public.minuta_booking_fits_active_shift('${org}','${location}','${performer}','2099-10-15','${start}',${duration})`);
const metadata = () => db.query(`select oid,proowner,proacl::text,prosecdef,proconfig::text,provolatile from pg_proc
  where oid in ('public.minuta_booking_fits_active_shift(uuid,uuid,uuid,date,time without time zone,integer)'::regprocedure,
    'public.set_minuta_branch_shifts_enabled(uuid,boolean)'::regprocedure) order by oid`);
try {
  // Disposable partial schema, entirely fictional. This is not a full original restore.
  await db.exec(`create schema auth; create role anon; create role authenticated;
    create function auth.uid() returns uuid language sql as $$select '${performer}'::uuid$$;
    create function public.get_minuta_schedule_role(uuid) returns text language sql as $$select 'owner'::text$$;
    create function public.write_minuta_schedule_audit(uuid,text,uuid,jsonb) returns void language plpgsql as $$begin end$$;
    create table public.organization_shift_settings(organization_id uuid primary key,enabled boolean,enabled_at timestamptz,enabled_by uuid,updated_at timestamptz);
    create table public.staff_absences(organization_id uuid,performer_id uuid,active boolean,starts_on date,ends_on date);
    create table public.staff_location_shifts(organization_id uuid,location_id uuid,performer_id uuid,shift_date date,active boolean,start_time time,end_time time,break_start time,break_end time);
    create table public.bookings(organization_id uuid,location_id uuid,performer_id uuid,booking_date date,booking_time time,duration_minutes integer,status text);
    ${functionSql('minuta_booking_fits_active_shift')}
    ${functionSql('set_minuta_branch_shifts_enabled')}
    revoke all on function public.minuta_booking_fits_active_shift(uuid,uuid,uuid,date,time without time zone,integer) from public,anon,authenticated;
    revoke all on function public.set_minuta_branch_shifts_enabled(uuid,boolean) from public,anon;
    grant execute on function public.set_minuta_branch_shifts_enabled(uuid,boolean) to authenticated;
    insert into public.organization_shift_settings values('${org}',true,null,null,null);
    insert into public.staff_location_shifts values('${org}','${location}','${performer}','2099-10-15',true,'10:00','23:00','14:00','15:00');
    insert into public.bookings values('${org}','${location}','${performer}','2099-10-15','22:30',120,'confirmed');`);
  assert.equal(await fits('22:30', 120), true, 'reproduce the original midnight wrap');
  const beforeMetadata = (await metadata()).rows;
  const beforeData = (await db.query('select * from public.bookings')).rows;
  const beforeDefinitions = (await db.query(`select pg_get_functiondef(oid) definition from pg_proc where proname in ('minuta_booking_fits_active_shift','set_minuta_branch_shifts_enabled') order by proname`)).rows;
  await db.exec(apply); await db.exec(apply); // Replay is idempotent.
  assert.deepEqual((await metadata()).rows, beforeMetadata, 'owner/ACL/security/volatility/signature are preserved');
  assert.deepEqual((await db.query('select * from public.bookings')).rows, beforeData, 'records remain identical');
  for (const [start, duration, expected] of [['22:30',120,false],['22:30',30,true],['22:30',31,false],['22:30',1470,false],['09:59',1,false],['13:00',60,true],['13:30',60,false],['15:00',30,true]]) {
    assert.equal(await fits(start,duration),expected, `${start}/${duration}`);
  }
  await assert.rejects(db.query(`select public.set_minuta_branch_shifts_enabled('${org}',true)`), /existing_bookings_outside_shifts/);
  await db.exec(`update public.bookings set duration_minutes=30`);
  assert.equal(await scalar(`select public.set_minuta_branch_shifts_enabled('${org}',true)`), true, 'valid boundary remains acceptable');
  assert.equal(await scalar(`select public.set_minuta_branch_shifts_enabled('${org}',false)`), false, 'disable keeps its false result');
  assert.equal(await fits('22:30',120),true,'strict-off behavior is unchanged');
  await db.exec(`update public.organization_shift_settings set enabled=true; insert into public.staff_absences values('${org}','${performer}',true,'2099-10-15','2099-10-15')`);
  assert.equal(await fits('15:00',30),false,'active absence is still enforced');
  await db.exec(`delete from public.staff_absences; update public.staff_location_shifts set active=false`);
  assert.equal(await fits('15:00',30),false,'inactive shift is still excluded');
  await db.exec(`update public.staff_location_shifts set active=true; update public.bookings set duration_minutes=120`);
  await db.exec(rollback); await db.exec(rollback);
  assert.equal(await fits('22:30',120),true,'rollback restores the original behavior');
  assert.deepEqual((await metadata()).rows,beforeMetadata);
  assert.deepEqual((await db.query(`select pg_get_functiondef(oid) definition from pg_proc where proname in ('minuta_booking_fits_active_shift','set_minuta_branch_shifts_enabled') order by proname`)).rows,beforeDefinitions,'rollback restores exact function definitions');
  await db.exec(apply); assert.equal(await fits('22:30',120),false,'reapply restores the correction');
  // O08 renames the original validator and keeps a new coverage wrapper above it.
  // Preserve that wrapper rather than replace it with the old implementation.
  await db.exec(`alter function public.set_minuta_branch_shifts_enabled(uuid,boolean) rename to set_minuta_branch_shifts_enabled_v71_core;
    create function public.set_minuta_branch_shifts_enabled(p_organization uuid,p_enabled boolean) returns boolean language sql security definer set search_path to ''
      as $$select public.set_minuta_branch_shifts_enabled_v71_core(p_organization,p_enabled)$$;`);
  const wrapperBefore = await scalar(`select pg_get_functiondef('public.set_minuta_branch_shifts_enabled(uuid,boolean)'::regprocedure)`);
  await db.exec(apply); await db.exec(rollback);
  assert.equal(await fits('22:30',120),true);
  await db.exec(apply);
  assert.equal(await fits('22:30',120),false);
  assert.equal(await scalar(`select pg_get_functiondef('public.set_minuta_branch_shifts_enabled(uuid,boolean)'::regprocedure)`),wrapperBefore);
  await assert.rejects(db.query(`select public.set_minuta_branch_shifts_enabled('${org}',true)`),/existing_bookings_outside_shifts/);
  // Unknown source must fail closed rather than overwrite another owner's future function.
  await db.exec(`create or replace function public.set_minuta_branch_shifts_enabled_v71_core(p_organization uuid,p_enabled boolean) returns boolean language plpgsql security definer set search_path to '' as $$begin return p_enabled; end$$;`);
  await db.exec(functionSql('minuta_booking_fits_active_shift'));
  await assert.rejects(db.exec(apply),/team_schedule_end_boundary_source_mismatch/); await db.exec('rollback');
  assert.equal(await fits('22:30',120),true,'source mismatch rolls back the earlier function transformation too');
  console.log('Shift end boundary: original repro, 8 time cases, strict preflight, data/ACL preservation, replay, rollback/reapply, O08 wrapper and atomic source guard passed (disposable partial PGlite)');
} finally { await db.close(); }
