// Real PostgreSQL in a newly initialized task-owned loopback cluster only.
// No external database URL, credentials, production records or delivery worker.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';

const root=fileURLToPath(new URL('../../',import.meta.url));
const bin=process.env.COPY_WEEK_PG_BIN;
assert.ok(bin,'COPY_WEEK_PG_BIN must point to an installed PostgreSQL runtime');
const pg=await import(process.env.MINUTA_PG_MODULE ? pathToFileURL(process.env.MINUTA_PG_MODULE).href : 'pg');
const Client=pg.Client || pg.default.Client;
const output=resolve(root,'outputs','copy-week-postgres',randomUUID());
assert.ok(output.startsWith(resolve(root,'outputs','copy-week-postgres')+sep)); mkdirSync(output,{recursive:true});
const data=resolve(output,'pgdata');
const binary=name=>resolve(bin,name+(process.platform==='win32'?'.exe':''));
const run=(name,args)=>{const result=spawnSync(binary(name),args,{windowsHide:true,encoding:'utf8',timeout:30000});assert.equal(result.status,0,`${name}: ${result.stderr}`);};
const port=await new Promise(resolvePort=>{const socket=createServer();socket.listen(0,'127.0.0.1',()=>{const p=socket.address().port;socket.close(()=>resolvePort(p));});});
run('initdb',['-D',data,'-U','copy_week_test','-A','trust','--no-locale','-E','UTF8']);
assert.ok(existsSync(resolve(data,'PG_VERSION')));
run('pg_ctl',['-D',data,'-l',resolve(output,'postgres.log'),'-o',`-p ${port} -h 127.0.0.1 -F`,'-w','start']);
const connections=[];
async function connect(){const c=new Client({host:'127.0.0.1',port,user:'copy_week_test',database:'postgres'});await c.connect();connections.push(c);await c.query("set statement_timeout='15s'; set lock_timeout='12s'");return c;}
const read=name=>readFileSync(new URL(`../${name}`,import.meta.url),'utf8');
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const ids={org:uid(1),otherOrg:uid(2),owner:uid(3),admin:uid(4),staff:uid(5),other:uid(6),outsider:uid(7),loc:uid(8),otherLoc:uid(9)};
let checks=0;
const check=(condition,label)=>{assert.ok(condition,label);checks++;};
const actor=async(c,id)=>{await c.query('reset role');await c.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);await c.query('set role authenticated');};
const scalar=async(c,sql,args=[]) => (await c.query(sql,args)).rows[0].value;
const preview=async(c,source='2099-10-05',target='2099-10-12',person=null,location=null)=>scalar(c,'select public.preview_minuta_staff_shift_week_copy($1,$2,$3,$4,$5) value',[ids.org,source,target,person,location]);
const copy=async(c,plan,key=randomUUID())=>scalar(c,'select public.copy_minuta_staff_shift_week($1,$2,$3,$4,$5,$6,$7) value',[ids.org,plan.source_start,plan.target_start,plan.performer_id,plan.location_id,plan.preview_token,key]);
const rejected=async(promise,pattern)=>{await assert.rejects(promise,pattern);checks++;};
const seedShift=async(c,who=ids.staff,date='2099-10-05',start='10:00',end='18:00',loc=ids.loc,org=ids.org)=>scalar(c,"insert into public.staff_location_shifts(organization_id,location_id,performer_id,shift_date,start_time,end_time,break_start,break_end,note) values($1,$2,$3,$4,$5,$6,'14:00','15:00','private source note') returning id value",[org,loc,who,date,start,end]);
try {
  const db=await connect();
  check(await scalar(db,"select count(*)::int value from pg_tables where schemaname='public'")===0,'new cluster has no application data');
  await db.query(`create extension btree_gist; create role anon; create role authenticated; create role service_role;
    create schema auth; create schema extensions; grant usage on schema public,auth to authenticated;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table organizations(id uuid primary key,status text not null default 'active');
    create table performer_profiles(id uuid primary key,display_name text not null);
    create table organization_memberships(organization_id uuid,user_id uuid,role text,active boolean,is_bookable boolean,primary key(organization_id,user_id));
    create table locations(id uuid primary key,organization_id uuid,name text,active boolean,timezone text default 'Europe/Samara',unique(id,organization_id));
    create table bookings(id uuid primary key,organization_id uuid,location_id uuid,performer_id uuid,booking_date date,booking_time time,duration_minutes integer,status text);
    create function public.has_organization_role(org uuid,roles text[]) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.organization_memberships where organization_id=org and user_id=auth.uid() and active and role=any(roles))$$;`);
  const v71=read('supabase-migration-v71.sql');
  // Exact native DDL, exclusion constraints, rights, audit and booking trigger;
  // exact native writers. Unrelated catalogue/substitution RPCs are not loaded.
  await db.query(v71.slice(v71.indexOf('create table if not exists public.organization_shift_settings'),v71.indexOf('create or replace function public.get_minuta_shift_workspace')));
  await db.query(v71.slice(v71.indexOf('create or replace function public.upsert_minuta_staff_shift'),v71.indexOf('create or replace function public.substitute_minuta_booking')));
  await db.query('grant execute on function public.upsert_minuta_staff_shift(uuid,uuid,uuid,uuid,date,time,time,time,time,text),public.create_minuta_staff_absence(uuid,uuid,date,date,text,text) to authenticated');
  await db.query('insert into organizations(id) values($1),($2)',[ids.org,ids.otherOrg]);
  for(const [name,id] of Object.entries(ids).filter(([name])=>['owner','admin','staff','other','outsider'].includes(name))){await db.query('insert into auth.users values($1);',[id]);await db.query('insert into performer_profiles values($1,$2)',[id,name]);}
  for(const [name,role] of [['owner','owner'],['admin','admin'],['staff','specialist'],['other','specialist']])await db.query('insert into organization_memberships values($1,$2,$3,true,true)',[ids.org,ids[name],role]);
  await db.query("insert into locations(id,organization_id,name,active) values($1,$2,'Main',true),($3,$4,'Foreign',true)",[ids.loc,ids.org,ids.otherLoc,ids.otherOrg]);
  const migration=read('supabase-migration-v195.sql'),rollback=read('supabase-migration-v195-rollback.sql');
  await db.query(migration);await db.query(migration);checks++;
  const first=await seedShift(db);
  await seedShift(db,ids.other,'2099-10-06');
  await db.query("insert into bookings values($1,$2,$3,$4,'2099-10-05','10:30',60,'confirmed')",[uid(100),ids.org,ids.loc,ids.staff]);
  await db.query("insert into staff_absences(organization_id,performer_id,starts_on,ends_on,kind) values($1,$2,'2099-10-09','2099-10-09','vacation')",[ids.org,ids.owner]);
  await actor(db,ids.owner);
  let plan=await preview(db);
  check(plan.ready_count===2 && plan.can_copy && plan.rows[0].break_start==='14:00:00','preview retains hours, staff, branch and breaks');
  check(plan.rows.every(row=>!('note' in row)),'private comments not copied or exposed in preview');
  const key=randomUUID(),result=await copy(db,plan,key),replay=await copy(db,plan,key);
  check(result.created_count===2 && replay.replayed && replay.created_ids.join()===result.created_ids.join(),'same request is idempotent');
  await rejected(copy(db,{...plan,target_start:'2099-10-19'},key),/copy_request_mismatch/);
  plan=await preview(db);check(plan.existing_count===2 && !plan.can_copy,'exact existing shifts skipped');
  await rejected(copy(db,plan),/copy_week_not_ready/);
  await db.query('reset role');
  check(await scalar(db,'select count(*)::int value from bookings')===1 && await scalar(db,'select count(*)::int value from staff_absences')===1,'bookings and source absences not copied');
  check(await scalar(db,'select count(*)::int value from organization_shift_settings')===0,'online booking shift mode not changed');
  check(await scalar(db,"select count(*)::int value from staff_location_shifts where shift_date between '2099-10-12' and '2099-10-18' and note<>''")===0,'comments not copied');
  await actor(db,ids.admin);check((await preview(db)).source_count===2,'admin authorized');
  await actor(db,ids.staff);check((await preview(db)).source_count===1,'specialist sees own copy only');
  await rejected(preview(db,'2099-10-05','2099-10-19',ids.other),/foreign_performer_denied/);
  await rejected(preview(db,'2099-10-05','2099-10-19',null,ids.otherLoc),/foreign_schedule_scope/);
  await actor(db,ids.outsider);await rejected(preview(db),/organization_access_denied/);
  await actor(db,null);await rejected(preview(db),/authentication_required/);
  await actor(db,ids.owner);await rejected(preview(db,'2099-10-05','2099-10-13'),/invalid_copy_week_dates/);
  plan=await preview(db,'2099-10-05','2099-10-19');
  await db.query('reset role');await db.query('update staff_location_shifts set end_time=\'19:00\',updated_at=now() where id=$1',[first]);
  await actor(db,ids.owner);await rejected(copy(db,plan),/copy_preview_stale/);
  await db.query('reset role');
  await db.query("insert into staff_absences(organization_id,performer_id,starts_on,ends_on,kind) values($1,$2,'2099-10-20','2099-10-20','vacation')",[ids.org,ids.other]);
  await actor(db,ids.owner);plan=await preview(db,'2099-10-05','2099-10-19');
  check(plan.blocked_count===1 && !plan.can_copy,'absence blocks entire batch');await rejected(copy(db,plan),/copy_week_not_ready/);
  await db.query('reset role');check(await scalar(db,"select count(*)::int value from staff_location_shifts where shift_date between '2099-10-19' and '2099-10-25'")===0,'blocked batch has no partial inserts');
  await seedShift(db,ids.staff,'2099-10-26','12:00','17:00');
  await actor(db,ids.owner);plan=await preview(db,'2099-10-05','2099-10-26');check(plan.rows.some(row=>row.status==='overlap') && !plan.can_copy,'overlapping existing shift preserved');
  await db.query('reset role');
  // Force a failure after the first native writer succeeds; verify transaction
  // rollback removes both its shift and audit event, not just the last row.
  await db.query(`create function fail_copy_test() returns trigger language plpgsql as $$begin if new.performer_id='${ids.other}' and new.shift_date='2099-11-03' then raise exception 'forced_later_insert_failure';end if;return new;end$$;
    create trigger fail_copy_test before insert on staff_location_shifts for each row execute function fail_copy_test()`);
  await actor(db,ids.owner);plan=await preview(db,'2099-10-05','2099-11-02');await rejected(copy(db,plan),/forced_later_insert_failure/);
  await db.query('reset role');check(await scalar(db,"select count(*)::int value from staff_location_shifts where shift_date between '2099-11-02' and '2099-11-08'")===0,'later insert failure rolls back whole batch');await db.query('drop trigger fail_copy_test on staff_location_shifts');
  // Two real connections attempt the same request; second blocks on v71 lock,
  // then receives the first transaction's durable receipt.
  const a=await connect(),b=await connect();await actor(a,ids.owner);await actor(b,ids.owner);
  plan=await preview(a,'2099-10-05','2099-11-09');const concurrentPlan=plan,concurrentKey=randomUUID();
  await a.query('begin');const one=await copy(a,plan,concurrentKey);
  const secondPid=await scalar(b,'select pg_backend_pid() value');
  const twoPending=copy(b,plan,concurrentKey);let blocked=false;
  for(let n=0;n<60;n++){blocked=await scalar(db,'select cardinality(pg_blocking_pids($1))>0 value',[secondPid]);if(blocked)break;await new Promise(resolve=>setTimeout(resolve,25));}
  check(blocked,'second actual connection waits for organization lock');await a.query('commit');const two=await twoPending;
  check(two.replayed && two.created_ids.join()===one.created_ids.join(),'concurrent repeat creates one batch');
  plan=await preview(a,'2099-10-05','2099-11-16');await a.query('begin');await copy(a,plan);
  const differentPending=copy(b,plan).then(value=>({value}),error=>({error}));
  for(let n=0;n<60;n++){if(await scalar(db,'select cardinality(pg_blocking_pids($1))>0 value',[secondPid]))break;await new Promise(resolve=>setTimeout(resolve,25));}
  await a.query('commit');check((await differentPending).error?.message==='copy_preview_stale','different concurrent request refuses stale preview');
  await seedShift(db,ids.staff,'2099-12-14','12:00','17:00',ids.otherLoc,ids.otherOrg);
  await actor(db,ids.owner);const foreignConflict=await preview(db,'2099-10-05','2099-12-14');
  check(foreignConflict.rows.some(row=>row.status==='overlap') && !JSON.stringify(foreignConflict).includes('Foreign'),'cross-organization conflict blocks without exposing its details');
  await db.query('reset role');await db.query('update organization_memberships set is_bookable=false where organization_id=$1 and user_id=$2',[ids.org,ids.staff]);
  await actor(db,ids.owner);check((await preview(db,'2099-10-05','2099-12-21')).rows.some(row=>row.status==='inactive_scope'),'inactive specialist blocks copy');
  await db.query('reset role');await db.query('update organization_memberships set is_bookable=true where organization_id=$1 and user_id=$2',[ids.org,ids.staff]);
  await seedShift(db,ids.staff,'2000-01-03');await actor(db,ids.owner);check((await preview(db,'2000-01-03','2000-01-10')).rows[0].status==='past_date','past target cannot be copied');
  await db.query('reset role');
  const counts=await scalar(db,'select count(*)::int value from staff_location_shifts');
  await db.query(rollback);check(await scalar(db,"select to_regprocedure('public.copy_minuta_staff_shift_week(uuid,date,date,uuid,uuid,text,uuid)') is null value"),'rollback removes RPC');
  check(await scalar(db,'select count(*)::int value from staff_location_shifts')===counts,'rollback preserves schedules');
  await db.query(migration);await actor(db,ids.owner);check((await copy(db,concurrentPlan,concurrentKey)).replayed,'reapply preserves receipt safety');
  console.log(`Shift week copy PostgreSQL: ${checks} checks PASS; real two-session lock/idempotency, rollback/reapply; productionWrites=false`);
} finally {
  await Promise.allSettled(connections.map(c=>c.end()));
  run('pg_ctl',['-D',data,'-m','fast','-w','stop']);
}
