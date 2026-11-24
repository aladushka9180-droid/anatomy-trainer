// Disposable localhost PostgreSQL only. Real concurrent connections and actual dated-hours SQL.
import assert from 'node:assert/strict';import fs from 'node:fs';import {execFileSync,spawn} from 'node:child_process';
const url=process.env.DAY_TEST_POSTGRES;const target=new URL(url);assert.equal(target.hostname,'127.0.0.1');assert.equal(target.pathname,'/day_actions_fixture');assert.equal(target.port,'55433');
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
const migration=read('../supabase-migration-v192.sql');
const sql=s=>execFileSync('psql',[url,'-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=terse'],{input:s,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
sql(`create role anon;create role authenticated;create role service_role;create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table auth.users(id uuid primary key);create table public.organizations(id uuid primary key,status text);
create table public.locations(id uuid primary key,organization_id uuid,timezone text,active boolean);
create table public.organization_memberships(organization_id uuid,user_id uuid,active boolean,is_bookable boolean,role text);
create table public.provider_schedule(performer_id uuid,weekday smallint,enabled boolean,start_time time,end_time time,break_start time,break_end time,slot_interval_minutes integer,primary key(performer_id,weekday));
create table public.provider_days_off(id uuid primary key default gen_random_uuid(),performer_id uuid,off_date date,all_day boolean,start_time time,end_time time,note text,created_at timestamptz default now());
`+migration.slice(migration.indexOf('create table public.provider_day_schedule_v192'),migration.indexOf('-- Read-only scoped slots')));
const actor='00000000-0000-0000-0000-000000000001',org='00000000-0000-0000-0000-000000000002',loc='00000000-0000-0000-0000-000000000003';
sql(`insert into auth.users values('${actor}');insert into public.organizations values('${org}','active');insert into public.locations values('${loc}','${org}','Europe/Samara',true);insert into public.organization_memberships values('${org}','${actor}',true,true,'owner');`);
const prefix=`select set_config('request.jwt.claim.sub','${actor}',true);`;
const date=sql('select (current_date+2)::text;');const args=`'${org}','${loc}','${date}'`;
const revision=()=>sql(`begin;${prefix}select public.minuta_day_revision_v192(${args});rollback;`).split('\n').at(-1);
const save=(id,rev,end='17:00')=>`select public.save_minuta_provider_day_v192(${args},'${id}','11:00','${end}',true,'${rev}');`;
const resolve=id=>`select public.resolve_minuta_provider_day_v192(${args},'${id}');`;
function worker(statement,hold=false){let output='',error='';let ready;const held=new Promise(r=>ready=r);const child=spawn('psql',[url,'-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=terse'],{env:{...process.env,PGAPPNAME:hold?'day-v192-a':'day-v192-b'},stdio:['pipe','pipe','pipe']});child.stdout.on('data',b=>{output+=b;if(output.includes('held'))ready();});child.stderr.on('data',b=>error+=b);const done=new Promise(r=>child.on('close',code=>r({code,output,error})));child.stdin.end(`begin;${prefix}${statement}${hold?"select 'held';select pg_sleep(2);":''}commit;`);return {held,done};}
const clean=()=>sql('truncate public.provider_day_requests_v192,public.provider_day_schedule_v192;');
async function race(first,second){const a=worker(first,true);await a.held;const b=worker(second);let blocked=false;for(let i=0;i<20;i++){if(sql("select exists(select 1 from pg_stat_activity where application_name='day-v192-b' and wait_event_type='Lock');")==='t'){blocked=true;break;}await new Promise(r=>setTimeout(r,30));}assert.ok(blocked,'second real connection must wait for the scheduling lock');return Promise.all([a.done,b.done]);}
let rev=revision();let [a,b]=await race(save('10000000-0000-0000-0000-000000000001',rev),save('10000000-0000-0000-0000-000000000002',rev));assert.equal(a.code,0);assert.notEqual(b.code,0);assert.match(b.error,/day_schedule_changed/);assert.equal(sql('select count(*) from public.provider_day_schedule_v192;'),'1');
clean();rev=revision();[a,b]=await race(save('10000000-0000-0000-0000-000000000003',rev),save('10000000-0000-0000-0000-000000000003',rev));assert.equal(a.code,0);assert.equal(b.code,0);assert.equal(sql('select count(*) from public.provider_day_requests_v192;'),'1');assert.equal(sql('select revision from public.provider_day_schedule_v192;'),'1');
clean();rev=revision();[a,b]=await race(resolve('10000000-0000-0000-0000-000000000004'),save('10000000-0000-0000-0000-000000000004',rev));assert.equal(a.code,0);assert.equal(b.code,0);assert.match(b.output,/"notApplied": true/);assert.equal(sql('select count(*) from public.provider_day_schedule_v192;'),'0');
clean();rev=revision();[a,b]=await race(save('10000000-0000-0000-0000-000000000005',rev),resolve('10000000-0000-0000-0000-000000000005'));assert.equal(a.code,0);assert.equal(b.code,0);assert.match(b.output,/"confirmed": true/);assert.equal(sql('select count(*) from public.provider_day_schedule_v192;'),'1');
console.log('PASS: real PostgreSQL connections serialize conflicting saves, same-request replay, resolve-before-save tombstone, and save-before-resolve acknowledgement');
