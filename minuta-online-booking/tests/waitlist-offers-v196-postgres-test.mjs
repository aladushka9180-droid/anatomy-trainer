// Native concurrency on a NEW task-owned loopback cluster. Never an external DB.
// Synthetic booking seam: this is not v153/full-source restore qualification.
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,mkdtempSync,existsSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {randomUUID} from 'node:crypto';
import {id,actor,org,request,token,offer,scaffold} from './waitlist-offers-v196-fixture.mjs';
assert.ok(process.env.WAITLIST_PG_BIN,'WAITLIST_PG_BIN must point to an installed native test runtime');
const pg=await import(process.env.MINUTA_PG_MODULE?pathToFileURL(process.env.MINUTA_PG_MODULE).href:'pg');
const Client=pg.Client||pg.default.Client;
const root=fileURLToPath(new URL('../../',import.meta.url));
const output=resolve(root,'outputs','waitlist-offers-postgres',randomUUID());
assert.ok(output.startsWith(resolve(root,'outputs','waitlist-offers-postgres')+sep));mkdirSync(output,{recursive:true});
const data=resolve(output,'pgdata');
const binary=name=>resolve(process.env.WAITLIST_PG_BIN,name+(process.platform==='win32'?'.exe':''));
const run=(name,args)=>{const r=spawnSync(binary(name),args,{windowsHide:true,encoding:'utf8',timeout:30000});assert.equal(r.status,0,`${name}: ${r.stderr}`);};
const port=await new Promise(done=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>done(p));});});
run('initdb',['-D',data,'-U','waitlist_test','-A','trust','--no-locale','-E','UTF8']);assert.ok(existsSync(resolve(data,'PG_VERSION')));
const socket=process.platform==='win32'?'':` -k ${mkdtempSync(resolve(tmpdir(),'waitlist-test-socket-'))}`;
run('pg_ctl',['-D',data,'-l',resolve(output,'postgres.log'),'-o',`-p ${port} -h 127.0.0.1 -F${socket}`,'-w','start']);
const connections=[];let checks=0;
async function connect(){const c=new Client({host:'127.0.0.1',port,user:'waitlist_test',database:'postgres'});await c.connect();connections.push(c);await c.query("set statement_timeout='15s';set lock_timeout='12s'");return c;}
const check=(condition,label)=>{assert.ok(condition,label);checks++;};
const rejected=async(p,pattern)=>{await assert.rejects(p,pattern);checks++;};
const value=async(c,sql,args=[])=>(await c.query(sql,args)).rows[0].value;
const create=async(c,o=offer,r=request)=>{await c.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);await c.query('set role authenticated');return value(c,"select create_minuta_waitlist_offer_v196($1,$2,current_date+1,time '10:00',clock_timestamp()+interval '10 minutes') value",[o,r]);};
const accept=async(c,o=offer,t=token)=>{await c.query('set role anon');return value(c,'select accept_minuta_waitlist_offer_v196($1,$2) value',[o,t]);};
async function waitForLock(admin,backendPid){const deadline=Date.now()+5000;while(Date.now()<deadline){
 if(await value(admin,"select coalesce((select wait_event_type='Lock' from pg_stat_activity where pid=$1),false) value",[backendPid]))return;
 await new Promise(done=>setTimeout(done,25));
}throw Error('expected concurrent acceptance did not reach a PostgreSQL lock');}
const forward=readFileSync(new URL('../supabase-migration-v196.sql',import.meta.url),'utf8');
const rollback=readFileSync(new URL('../supabase-migration-v196-rollback.sql',import.meta.url),'utf8');
try{
 const admin=await connect(),a=await connect(),b=await connect();
 check(await value(admin,"select count(*)::int value from pg_tables where schemaname='public'")===0,'cluster starts empty');
 check(await value(admin,"select inet_server_addr()::text='127.0.0.1/32' or host(inet_server_addr())='127.0.0.1' value"),'loopback only');
 check(await value(admin,'select current_setting(\'data_directory\') value')===data,'exact newly initialized directory');
 await admin.query('create extension btree_gist;create role anon;create role authenticated;create role service_role;create role waitlist_owner nologin nosuperuser nobypassrls;grant create on database postgres to waitlist_owner;grant usage,create on schema public to waitlist_owner;set role waitlist_owner');
 await admin.query(scaffold.replace('create role anon; create role authenticated; create role service_role;',''));
 await admin.query(`alter table bookings add constraint bookings_performer_active_no_overlap exclude using gist
   (performer_id with =,tsrange(booking_date+booking_time,booking_date+booking_time+duration_minutes*interval '1 minute','[)') with &&)
   where(status in ('new','confirmed'));`);
 await admin.query(forward);await admin.query('reset role');
 check(await value(admin,"select bool_and(not r.rolsuper and not r.rolbypassrls) value from pg_proc p join pg_roles r on r.oid=p.proowner where p.proname in ('create_minuta_waitlist_offer_v196','get_minuta_waitlist_offer_v196','accept_minuta_waitlist_offer_v196')"),'RPC owner is NOSUPER/NOBYPASSRLS');
 await create(a);await a.query('begin');const first=await accept(a);
 check(first.state==='accepted','first transaction creates booking');
 const second=accept(b);await waitForLock(admin,b.processID);check(true,'same offer retry waits on request lock');
 await a.query('commit');assert.deepEqual(await second,first);checks++;
 check(await value(admin,'select count(*)::int value from bookings')===1,'concurrent same UUID creates one row');
 check(await value(admin,"select status value from organization_waitlist_requests where id=$1",[request])==='booked','request and offer commit together');
 // Separate requests both see the slot before either accepted transaction commits.
 await admin.query('truncate organization_waitlist_offers,bookings;update organization_waitlist_requests set status=\'waiting\';update fixture_slots set available=true');
 await admin.query("insert into organization_waitlist_requests select $1,organization_id,location_id,performer_id,service_id,$2,'Other synthetic','79990000001',desired_date,time_period,status,updated_at from organization_waitlist_requests where id=$3",[id(15),id(16),request]);
 await create(a);await create(b,id(17),id(15));await a.query('begin');const competingFirst=await accept(a);check(competingFirst.state==='accepted','first competing slot acceptance prepared');
 const competing=accept(b,id(17),id(16));await waitForLock(admin,b.processID);check(true,'competing slot reaches native exclusion lock');await a.query('commit');
 check((await competing).state==='busy','constraint loser receives busy');check(await value(admin,'select count(*)::int value from bookings')===1,'different offers also create one booking');
 check(await value(admin,"select status value from organization_waitlist_requests where id=$1",[id(15)])==='waiting','losing legacy request remains waiting');
 await admin.query('set role waitlist_owner');await admin.query(rollback);await admin.query(rollback);await admin.query('reset role');
 check(await value(admin,'select count(*)::int value from bookings')===1,'rollback preserves booking');await rejected(accept(a),/permission denied/);
 await admin.query('set role waitlist_owner');await admin.query(forward);await admin.query('reset role');assert.deepEqual(await accept(a),competingFirst);checks++;
 // Unknown acknowledgement must roll back a booking already inserted by the seam.
 await admin.query('truncate organization_waitlist_offers,bookings;update organization_waitlist_requests set status=\'waiting\';update fixture_slots set available=true');
 await create(a);await a.query("select set_config('fixture.booking_mode','bad_ack',false)");await rejected(accept(a),/waitlist_offer_atomic_ack_invalid/);
 check(await value(admin,'select count(*)::int value from bookings')===0,'bad ack rolls back native insert');
 check(await value(admin,"select status value from organization_waitlist_offers") ==='offered','bad ack preserves retryable offer');
 await a.query("select set_config('fixture.booking_mode','',false)");check((await accept(a)).state==='accepted','retry after failed transaction accepts once');
 await admin.query("update bookings set booking_date=booking_date+1,total_price_rub=1000,status='confirmed'");check((await accept(a)).booking.status==='confirmed','accepted history survives legitimate subsequent changes');
 console.log(JSON.stringify({checksPassed:checks,serverVersion:await value(admin,"select current_setting('server_version') value"),nativeConcurrencyProven:true,sourceIsSynthetic:true,actualSourceRestoreProven:false,productionWritten:false}));
}finally{
 for(const c of connections)await c.end().catch(()=>{});
 run('pg_ctl',['-D',data,'-m','immediate','-w','stop']);
}
