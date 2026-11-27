// New empty loopback PostgreSQL only. Exact main v153 function; generated v1,
// availability, memberships and rows. NOT an original/current-schema restore.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,cpSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
const dir=fileURLToPath(new URL('../',import.meta.url));
const runtime=process.env.X07_RUNTIME_ROOT?path.resolve(process.env.X07_RUNTIME_ROOT):path.join(dir,'tests/waitlist-offers-runtime');
const {default:pg}=await import(pathToFileURL(path.join(runtime,'node_modules/pg/lib/index.js')));
const {Client}=pg;
const {initdb:packageInitdb}=await import(pathToFileURL(path.join(runtime,'node_modules/@embedded-postgres/windows-x64/dist/index.js')));
const {id,actor,org,loc,service,request,token,offer,scaffold}=await import('./waitlist-offers-source-fixture.mjs');
const sql=readFileSync(path.join(dir,'supabase-candidate-waitlist-offers.sql'),'utf8');
const rollback=readFileSync(path.join(dir,'supabase-candidate-waitlist-offers-rollback.sql'),'utf8');
const v153file=readFileSync(path.join(dir,'supabase-migration-v153.sql'),'utf8');
const start=v153file.indexOf('create or replace function public.book_minuta_appointment_v2(');
const v153=v153file.slice(start,v153file.indexOf('\n$$;',start)+4);
assert(start>0 && v153.endsWith('$$;'));
// Windows native executables require an ASCII path for this portable build.
// Copy only the pinned runtime into a fresh task-owned temporary directory.
const cluster=mkdtempSync(path.join(tmpdir(),'x07-native17-'));
cpSync(path.dirname(path.dirname(packageInitdb)),path.join(cluster,'native'),{recursive:true,errorOnExist:true,force:false});
const initdb=path.join(cluster,'native/bin/initdb.exe'),pg_ctl=path.join(cluster,'native/bin/pg_ctl.exe'),data=path.join(cluster,'data');
const port=await new Promise(done=>{const server=createServer();server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>done(p));});});
const run=(bin,args)=>{const r=spawnSync(bin,args,{windowsHide:true,encoding:'utf8',timeout:30000});assert.equal(r.status,0,`${path.basename(bin)}: ${r.stderr} ${r.stdout}`);};
run(initdb,['-D',data,'-U','x07_test','-A','trust','--no-locale','-E','UTF8']);
let started=false;const connections=[],results=[];
async function connect(){const c=new Client({host:'127.0.0.1',port,user:'x07_test',database:'postgres'});await c.connect();connections.push(c);await c.query("set statement_timeout='15s';set lock_timeout='12s'");return c;}
const value=async(c,q,args=[])=>(await c.query(q,args)).rows[0].value;
async function check(name,fn){await fn();results.push({name,pass:true});console.log('PASS '+name);}
const staff=async c=>{await c.query('set role authenticated');await c.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);};
const create=async(c,o=offer,r=request,options={})=>{await staff(c);return value(c,`select public.create_minuta_waitlist_offer_v196($1,$2,$3::date,$4::time,$5::timestamptz) value`,[o,r,options.date||await value(c,'select current_date+1 value'),options.time||'10:00',options.expires||await value(c,"select clock_timestamp()+interval '10 minutes' value")]);};
const accept=async(c,o=offer,t=token)=>{await c.query('set role anon');return value(c,'select public.accept_minuta_waitlist_offer_v196($1,$2) value',[o,t]);};
const read=async(c,o=offer,t=token)=>{await c.query('set role anon');return value(c,'select public.get_minuta_waitlist_offer_v196($1,$2) value',[o,t]);};
let admin,a,b;
async function reset(){await admin.query("truncate organization_waitlist_offers,bookings,fixture_effects;delete from organization_waitlist_requests where id<>'"+request+"';update organization_waitlist_requests set status='waiting',desired_date=current_date+1,time_period='any';update services set price_rub=1500,duration_minutes=60,active=true;delete from fixture_slots;insert into fixture_slots values('fixture-org','"+loc+"','"+service+"',current_date+1,'10:00',true)");for(const c of [a,b]){await c.query('reset role');await c.query("select set_config('fixture.booking_mode','',false)");}}
async function lockWait(c){const end=Date.now()+5000;while(Date.now()<end){if(await value(admin,"select exists(select 1 from pg_stat_activity where pid=$1 and wait_event_type='Lock') value",[c.processID]))return;await new Promise(r=>setTimeout(r,20));}throw Error('Native lock wait was not observed');}
async function passDeadline(){const end=Date.now()+5000;while(Date.now()<end){if(await value(admin,"select expires_at<=clock_timestamp() value from organization_waitlist_offers where id=$1",[offer]))return;await new Promise(r=>setTimeout(r,20));}throw Error('Deadline was not reached');}
const bookings=()=>value(admin,'select count(*)::int value from bookings');
try {
  run(pg_ctl,['-D',data,'-l',path.join(cluster,'server.log'),'-o',`-p ${port} -h 127.0.0.1 -F`,'-w','start']);started=true;
  admin=await connect();a=await connect();b=await connect();
  await check('empty exact task-owned loopback cluster',async()=>{assert.equal(await value(admin,"select count(*)::int value from pg_tables where schemaname='public'"),0);assert.equal(path.resolve(await value(admin,"select current_setting('data_directory') value")),path.resolve(data));assert.equal(await value(admin,"select host(inet_server_addr()) value"),'127.0.0.1');});
  await admin.query('create role anon;create role authenticated;create role service_role;create role waitlist_owner nologin nosuperuser nobypassrls;grant create on database postgres to waitlist_owner;grant usage,create on schema public to waitlist_owner;create schema extensions;create extension pgcrypto with schema extensions;create extension btree_gist;grant usage on schema extensions to waitlist_owner;set role waitlist_owner');
  const generated=scaffold.replace('create role anon; create role authenticated; create role service_role;','').replace(/create function public\.book_minuta_appointment_v2[\s\S]*?end\$\$;/,'');
  await admin.query(generated);
  await admin.query(`alter table organizations add column status text default 'active',add column public_booking_enabled boolean default true;
    alter table services add column name text default 'Generated service';
    create table locations(id uuid primary key,organization_id uuid,name text,active boolean,timezone text);
    insert into locations values('${loc}','${org}','Generated branch',true,'Europe/Samara');
    create table performer_profiles(id uuid primary key,display_name text);insert into performer_profiles values('${actor}','Generated specialist');
    create table organization_memberships(organization_id uuid,user_id uuid,active boolean,is_bookable boolean);insert into organization_memberships values('${org}','${actor}',true,true);
    alter table bookings add column request_fingerprint text;
    alter table bookings add constraint bookings_performer_active_no_overlap exclude using gist(performer_id with =,tsrange(booking_date+booking_time,booking_date+booking_time+duration_minutes*interval '1 minute','[)') with &&) where(status in ('new','confirmed'));
    create table fixture_effects(booking uuid primary key);`);
  await admin.query(`create function public.book_minuta_appointment(uuid,text,uuid,uuid,date,time,text,text)
    returns table(booking_code text,manage_token uuid) language plpgsql security definer set search_path='' as $$
    declare row public.bookings%rowtype;mode text:=current_setting('fixture.booking_mode',true);begin
      if mode='unknown' then raise exception 'unrelated_source_failure';end if;
      insert into public.bookings(request_id,request_fingerprint,organization_id,location_id,service_id,performer_id,booking_date,booking_time,duration_minutes,original_price_rub,total_price_rub,booking_code,status)
      select $1,encode(extensions.digest($4::text||chr(31)||$5::text||chr(31)||$6::text||chr(31)||trim($7)||chr(31)||regexp_replace($8,'[^0-9]','','g'),'sha256'),'hex'),'${org}',$3,$4,'${actor}',$5,$6,s.duration_minutes,s.price_rub,s.price_rub,'GEN-'||$1,'new' from public.services s where s.id=$4 returning * into row;
      insert into public.fixture_effects values(row.id);
      update public.fixture_slots set available=false where location_id=$3 and service_id=$4 and day=$5 and time=$6;
      if mode='hold_after_insert' then perform pg_catalog.pg_advisory_xact_lock(7007);end if;
      return query select case when mode='bad_ack' then 'BAD' else row.booking_code end,row.manage_token;
    end $$;`);
  await admin.query(v153);await admin.query(sql);await admin.query('reset role');
  await check('candidate applies/reapplies with ordinary RPC owner',async()=>{await admin.query('set role waitlist_owner');await admin.query(sql);await admin.query('reset role');assert(await value(admin,"select bool_and(not r.rolsuper and not r.rolbypassrls) value from pg_proc p join pg_roles r on r.oid=p.proowner where p.proname like '%waitlist%v196'"));});
  await check('employee slots scoped; offer makes no booking or reservation',async()=>{await staff(a);const context=await value(a,'select get_minuta_waitlist_employee_v196($1) value',[request]);assert.equal(context.slots.length,1);const offerResult=await create(a);assert.equal(offerResult.state,'offered');assert.equal(offerResult.clientToken,token);assert.equal(await bookings(),0);assert(await value(admin,'select available value from fixture_slots'));});
  await check('foreign staff/anonymous employee denied; foreign capability denied',async()=>{await staff(b);await b.query("select set_config('request.jwt.claim.sub',$1,false)",[id(90)]);await assert.rejects(value(b,'select get_minuta_waitlist_employee_v196($1) value',[request]),/waitlist_offer_unavailable/);await b.query('set role anon');await assert.rejects(value(b,'select get_minuta_waitlist_employee_v196($1) value',[request]),/permission denied/);await assert.rejects(accept(b,offer,id(99)),/waitlist_offer_unavailable/);});
  await check('same offer concurrent acceptance + exact v153 one booking replay',async()=>{await a.query('begin');const first=await accept(a);const second=accept(b);await lockWait(b);await a.query('commit');const replay=await second; const {serverNow:firstNow,...firstStable}=first; const {serverNow:replayNow,...replayStable}=replay; assert.deepEqual(replayStable,firstStable);assert.equal(await bookings(),1);assert.equal(first.state,'accepted');await admin.query("update organization_waitlist_offers set expires_at=clock_timestamp()-interval '1 second'");assert.equal((await accept(b)).booking.manageToken,first.booking.manageToken);await staff(a);const context=await value(a,'select get_minuta_waitlist_employee_v196($1) value',[request]);assert.equal(context.offer.state,'accepted');assert(!('booking' in context.offer));});
  await reset();
  await check('terms change expires without booking',async()=>{await create(a);await admin.query('update services set price_rub=2000');assert.equal((await accept(a)).reason,'service_terms_changed');assert.equal(await bookings(),0);});
  await reset();
  await check('same-slot competing offers native exclusion; loser busy',async()=>{await admin.query("insert into organization_waitlist_requests select $1,organization_id,location_id,performer_id,service_id,$2,'Other generated','79990000001',desired_date,time_period,status,updated_at from organization_waitlist_requests where id=$3",[id(15),id(16),request]);await create(a);await create(b,id(17),id(15));await a.query('begin');assert.equal((await accept(a)).state,'accepted');const loser=accept(b,id(17),id(16));await lockWait(b);await a.query('commit');assert.equal((await loser).state,'busy');assert.equal(await bookings(),1);});
  await reset();
  await check('slot becomes occupied before acceptance; busy without booking',async()=>{await create(a);await admin.query('update fixture_slots set available=false');assert.equal((await accept(a)).state,'busy');assert.equal(await bookings(),0);});
  await reset();
  await check('service lock crosses deadline; no writer effects',async()=>{await create(a);await admin.query("update organization_waitlist_offers set expires_at=clock_timestamp()+interval '600 milliseconds';begin;update services set name='locked'");const pending=accept(a);await lockWait(a);await passDeadline();await admin.query('commit');assert.equal((await pending).state,'expired');assert.equal(await bookings(),0);});
  await reset();
  await check('exact v153 advisory wait crosses deadline; inserted booking/effect rolled back',async()=>{await create(a);await admin.query("update organization_waitlist_offers set expires_at=clock_timestamp()+interval '600 milliseconds';begin");await admin.query("select pg_advisory_xact_lock(hashtextextended('booking-request:'||(select booking_request_id::text from organization_waitlist_offers where id=$1),0))",[offer]);const pending=accept(a);await lockWait(a);await passDeadline();await admin.query('commit');assert.equal((await pending).state,'expired');assert.equal(await bookings(),0);assert.equal(await value(admin,'select count(*)::int value from fixture_effects'),0);});
  await reset();
  await check('post-insert native wait crosses deadline; rollback all transactional effects',async()=>{await create(a);await admin.query("update organization_waitlist_offers set expires_at=clock_timestamp()+interval '600 milliseconds';begin;select pg_advisory_xact_lock(7007)");await a.query("select set_config('fixture.booking_mode','hold_after_insert',false)");const pending=accept(a);await lockWait(a);await passDeadline();await admin.query('commit');assert.equal((await pending).reason,'deadline');assert.equal(await bookings(),0);assert.equal(await value(admin,'select count(*)::int value from fixture_effects'),0);assert.equal(await value(admin,'select status value from organization_waitlist_requests where id=$1',[request]),'waiting');});
  await reset();
  await check('unknown writer failure and invalid native v153 ack remain retryable errors',async()=>{await create(a);for(const mode of ['unknown','bad_ack']){await a.query('select set_config(\'fixture.booking_mode\',$1,false)',[mode]);await assert.rejects(accept(a),mode==='unknown'?/unrelated_source_failure/:/atomic_booking_acknowledgement_invalid/);assert.equal(await bookings(),0);assert.equal((await read(a)).state,'offered');}await a.query("select set_config('fixture.booking_mode','',false)");assert.equal((await accept(a)).state,'accepted');});
  await reset();
  await check('manual expiry over24h works; slot-start equality/after rejected',async()=>{await admin.query("update organization_waitlist_requests set desired_date=current_date+2;update fixture_slots set day=current_date+2");const date=await value(admin,'select current_date+2 value'),bound=await value(admin,"select ((current_date+2+time '10:00') at time zone 'Europe/Samara') value");await assert.rejects(create(a,offer,request,{date,expires:bound}),/invalid_waitlist_offer/);await assert.rejects(create(a,offer,request,{date,expires:new Date(bound.getTime()+1000)}),/invalid_waitlist_offer/);const long=await create(a,offer,request,{date,expires:new Date(bound.getTime()-60000)});assert.equal(long.state,'offered');assert(Date.parse(long.expiresAt)-Date.parse(long.serverNow)>24*3600000);});
  await reset();
  await check('deterministic midnight and deadline equality compiled SQL variant',async()=>{await admin.query('set role waitlist_owner');await admin.query("create table fixture_clock(at timestamptz);insert into fixture_clock values(((current_date+time '23:55') at time zone 'Europe/Samara'));create function public.fixture_now() returns timestamptz language sql stable security definer as $$select at from public.fixture_clock$$");await admin.query(sql.replaceAll('clock_timestamp()','public.fixture_now()'));await admin.query("update organization_waitlist_requests set desired_date=current_date+1;update fixture_slots set time=time '00:05'");await admin.query('reset role');const expires=await value(admin,"select ((current_date+1+time '00:00') at time zone 'Europe/Samara') value"),date=await value(admin,'select current_date+1 value');const created=await create(a,offer,request,{date,time:'00:05',expires});assert.equal(created.state,'offered');await admin.query('update fixture_clock set at=$1',[expires]);assert.equal((await accept(a)).reason,'deadline');assert.equal(await bookings(),0);await admin.query('set role waitlist_owner');await admin.query(sql);await admin.query('reset role');});
  await reset();
  await check('rollback/reapply preserves accepted booking and revokes all four RPCs',async()=>{await create(a);const first=await accept(a);await admin.query('set role waitlist_owner');await admin.query(rollback);await admin.query(rollback);await admin.query('reset role');assert.equal(await bookings(),1);await assert.rejects(accept(a),/permission denied/);await staff(b);await assert.rejects(value(b,'select get_minuta_waitlist_employee_v196($1) value',[request]),/permission denied/);await admin.query('set role waitlist_owner');await admin.query(sql);await admin.query('reset role');assert.deepEqual((await accept(a)).booking,first.booking);});
  const sha=x=>createHash('sha256').update(x).digest('hex');
  const report={at:new Date().toISOString(),checks:results.length,passed:results.length,results,serverVersion:await value(admin,"select current_setting('server_version') value"),candidateSha256:sha(sql),v153FunctionSha256:sha(v153),v153ExactMainFunction:true,v1AvailabilityMembershipsGenerated:true,realNativeLocksProven:true,deterministicMidnightEqualityUsesClockVariant:true,actualRestoreProven:false,productionWritten:false,clusterStopped:false};
  writeFileSync(path.join(runtime,'NATIVE-RESULT.json'),JSON.stringify(report,null,2)+'\n');
} finally {
  for(const c of connections)await c.end().catch(()=>{});
  if(started){run(pg_ctl,['-D',data,'-m','fast','-w','stop']);const file=path.join(runtime,'NATIVE-RESULT.json');try{const result=JSON.parse(readFileSync(file));result.clusterStopped=true;writeFileSync(file,JSON.stringify(result,null,2)+'\n');}catch{}}
}
