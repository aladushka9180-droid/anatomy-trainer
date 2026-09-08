// Real multi-connection PostgreSQL, never PGlite. No production URL accepted.
// npm install --no-save pg; node tests/benefit-public-v115-postgres-concurrency-test.mjs
// Requires the standard MINUTA_TEST_* guard variables. Logs no credentials/data.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';

const root=new URL('../',import.meta.url);
execFileSync(process.execPath,[fileURLToPath(new URL('scripts/migration-config-guard.mjs',root))],{stdio:'inherit'});
const pg=await import(process.env.MINUTA_PG_MODULE?pathToFileURL(process.env.MINUTA_PG_MODULE).href:'pg');
const Client=pg.Client||pg.default?.Client;
assert.equal(typeof Client,'function','PostgreSQL Client constructor unavailable');

const migration=readFileSync(new URL('supabase-migration-v115.sql',root),'utf8');
assert.match(migration,/create or replace function public\.reserve_minuta_public_benefit_v115/i);
assert.match(migration,/pg_advisory_xact_lock\(hashtextextended\(v_instrument_id::text,7300\)\)/i);
assert.match(migration,/where id=v_instrument_id and organization_id=p_organization for update/i);

const clients=[];
const testTls=process.env.MINUTA_TEST_PG_TLS_NO_VERIFY==='MIGRATION_TEST_ONLY'?{rejectUnauthorized:false}:undefined;
const connect=async()=>{
 const client=new Client({connectionString:process.env.MINUTA_TEST_DATABASE_URL,application_name:'minuta-v115-benefit-concurrency-test',...(testTls?{ssl:testTls}:{})});
 await client.connect();clients.push(client);
 await client.query("set statement_timeout='20s'; set lock_timeout='15s'");
 return client;
};
const outcome=promise=>promise.then(value=>({value}),error=>({error}));
const expectError=async(promise,code,message)=>{
 const result=await outcome(promise);
 assert.equal(result.error?.code,code);
 assert.equal(result.error?.message,message);
 return result.error;
};
const awaitBlocked=async(client,pid)=>{
 for(let attempt=0;attempt<100;attempt++){
  const {rows}=await client.query("select wait_event_type='Lock' as blocked from pg_stat_activity where pid=$1",[pid]);
  if(rows[0]?.blocked)return;
  await new Promise(resolve=>setTimeout(resolve,25));
 }
 throw Error('second_session_did_not_wait_for_real_instrument_lock');
};
const reserveSql='select public.reserve_minuta_public_benefit_v115($1,$2,$3) result';
const ids={
 actor:randomUUID(),org:randomUUID(),foreignOrg:randomUUID(),location:randomUUID(),foreignLocation:randomUUID(),
 service:randomUUID(),otherService:randomUUID(),foreignService:randomUUID(),client:randomUUID(),otherClient:randomUUID(),
 product:randomUUID(),raceInstrument:randomUUID(),expiredInstrument:randomUUID(),futureExpiryInstrument:randomUUID(),
 raceA:randomUUID(),raceB:randomUUID(),clientMismatch:randomUUID(),serviceMismatch:randomUUID(),
 expired:randomUUID(),afterExpiry:randomUUID(),foreignTenant:randomUUID()
};
const codes={
 race:`V115${randomUUID().replaceAll('-','').slice(0,16)}`.toUpperCase(),
 expired:`V115${randomUUID().replaceAll('-','').slice(0,16)}`.toUpperCase(),
 future:`V115${randomUUID().replaceAll('-','').slice(0,16)}`.toUpperCase()
};
const bookingIds=[ids.raceA,ids.raceB,ids.clientMismatch,ids.serviceMismatch,ids.expired,ids.afterExpiry,ids.foreignTenant];
let admin;
let fixtureCommitted=false;
let hadCore=false;
let hadWrapper=false;

try{
 admin=await connect();
 ({had_core:hadCore,had_wrapper:hadWrapper}=(await admin.query(`select
  to_regprocedure('public.reserve_minuta_public_benefit_v115(uuid,uuid,text)') is not null had_core,
  to_regprocedure('public.book_minuta_appointment_with_benefit_v115(uuid,text,uuid,uuid,date,time without time zone,text,text,text)') is not null had_wrapper`)).rows[0]);
 await admin.query(migration);
 assert.equal((await admin.query("select to_regprocedure('public.reserve_minuta_public_benefit_v115(uuid,uuid,text)') is not null present")).rows[0].present,true);

 // Fixture writes are exact, random and isolated. Replica mode suppresses only
 // product triggers while creating synthetic rows; all tested RPC calls below
 // execute with normal triggers, locks, constraints and transaction semantics.
 await admin.query('begin');
 await admin.query('set local session_replication_role=replica');
 await admin.query(`insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,now(),'{}','{}',now(),now())`,[ids.actor,`${ids.actor}@example.invalid`]);
 await admin.query('insert into public.performer_profiles(id,display_name) values($1,$2)',[ids.actor,'V115 isolated benefit fixture']);
 await admin.query(`insert into public.organizations(id,name,public_slug,public_booking_enabled,created_by) values
  ($1,'V115 isolated tenant',$2,true,$3),($4,'V115 foreign tenant',$5,true,$3)`,
  [ids.org,`v115-${ids.org.replaceAll('-','')}`,ids.actor,ids.foreignOrg,`v115-${ids.foreignOrg.replaceAll('-','')}`]);
 await admin.query(`insert into public.locations(id,organization_id,name,timezone,is_primary) values
  ($1,$2,'V115 primary','Europe/Samara',true),($3,$4,'V115 foreign','Europe/Samara',true)`,
  [ids.location,ids.org,ids.foreignLocation,ids.foreignOrg]);
 await admin.query(`insert into public.organization_memberships(organization_id,user_id,role,is_bookable,active) values
  ($1,$2,'owner',true,true),($3,$2,'owner',true,true)`,[ids.org,ids.actor,ids.foreignOrg]);
 await admin.query(`insert into public.services(id,performer_id,name,duration_minutes,price_rub,active) values
  ($1,$4,'V115 allowed service',60,1500,true),($2,$4,'V115 disallowed service',60,1700,true),
  ($3,$4,'V115 foreign service',60,1900,true)`,[ids.service,ids.otherService,ids.foreignService,ids.actor]);
 await admin.query(`insert into public.client_accounts(id,normalized_phone,access_code_hash) values
  ($1,'79990011501',repeat('a',64)),($2,'79990011502',repeat('b',64))`,[ids.client,ids.otherClient]);
 const bookingRows=[
  [ids.raceA,ids.org,ids.location,ids.service,ids.client,'+79990011501','10:00'],
  [ids.raceB,ids.org,ids.location,ids.service,ids.client,'+79990011501','11:00'],
  [ids.clientMismatch,ids.org,ids.location,ids.service,ids.otherClient,'+79990011502','12:00'],
  [ids.serviceMismatch,ids.org,ids.location,ids.otherService,ids.client,'+79990011501','13:00'],
  [ids.expired,ids.org,ids.location,ids.service,ids.client,'+79990011501','14:00'],
  [ids.afterExpiry,ids.org,ids.location,ids.service,ids.client,'+79990011501','15:00'],
  [ids.foreignTenant,ids.foreignOrg,ids.foreignLocation,ids.foreignService,ids.client,'+79990011501','16:00']
 ];
 for(const [id,org,location,service,client,phone,time] of bookingRows){
  await admin.query(`insert into public.bookings(
   id,booking_code,manage_token,request_id,request_fingerprint,performer_id,service_id,client_name,client_phone,
   booking_date,booking_time,duration_minutes,original_price_rub,total_price_rub,status,deposit_amount_rub,payment_status,payment_url,
   organization_id,location_id,booking_scope_source,client_account_id,booking_source)
   values($1,$2,gen_random_uuid(),$1,repeat('c',64),$3,$4,'V115 test client',$5,
    current_date+30,$6,60,1500,1500,'new',0,'not_required','',$7,$8,'team',$9,'client_online')`,
   [id,`V115-${id.replaceAll('-','').slice(0,12)}`,ids.actor,service,phone,time,org,location,client]);
 }
 await admin.query(`insert into public.organization_benefit_settings(organization_id,enabled,enabled_at,enabled_by)
  values($1,true,now(),$3),($2,true,now(),$3)`,[ids.org,ids.foreignOrg,ids.actor]);
 await admin.query(`insert into public.benefit_products(id,organization_id,name,kind,visits_count,validity_days,created_by)
  values($1,$2,'V115 one visit pass','visit_pass',1,365,$3)`,[ids.product,ids.org,ids.actor]);
 const snapshot=JSON.stringify({kind:'visit_pass',services:[{service_id:ids.service}]});
 await admin.query(`insert into public.client_benefit_instruments(
  id,organization_id,product_id,client_account_id,request_id,public_code,status,product_snapshot,remaining_visits,expires_on,issued_by)
  values($1,$4,$5,$6,$7,$8,'active',$11::jsonb,1,current_date+60,$6),
        ($2,$4,$5,$6,$9,$10,'active',$11::jsonb,1,current_date-1,$6),
        ($3,$4,$5,$6,$12,$13,'active',$11::jsonb,1,current_date+10,$6)`,
  [ids.raceInstrument,ids.expiredInstrument,ids.futureExpiryInstrument,ids.org,ids.product,ids.client,randomUUID(),codes.race,
   randomUUID(),codes.expired,snapshot,randomUUID(),codes.future]);
 await admin.query('commit');fixtureCommitted=true;

 // Exact rejection dimensions are checked before the balance race, so an
 // exhausted pass cannot mask tenant, owner, service or expiry behavior.
 await expectError(admin.query(reserveSql,[ids.foreignOrg,ids.foreignTenant,codes.race]),'P0001','benefit_code_not_found');
 await expectError(admin.query(reserveSql,[ids.org,ids.clientMismatch,codes.race]),'P0001','benefit_client_mismatch');
 await expectError(admin.query(reserveSql,[ids.org,ids.serviceMismatch,codes.race]),'P0001','visit_pass_not_applicable');
 await expectError(admin.query(reserveSql,[ids.org,ids.expired,codes.expired]),'P0001','benefit_not_available');
 await expectError(admin.query(reserveSql,[ids.org,ids.afterExpiry,codes.future]),'P0001','benefit_not_available');
 assert.equal((await admin.query('select count(*)::integer n from public.benefit_redemptions where organization_id=$1',[ids.org])).rows[0].n,0);
 console.log('PASS: tenant, client, service, current expiry and appointment-after-expiry invariants reject without spending');

 const first=await connect(),second=await connect();
 const secondPid=(await second.query('select pg_backend_pid() pid')).rows[0].pid;
 await first.query('begin');
 const winner=(await first.query(reserveSql,[ids.org,ids.raceA,codes.race])).rows[0].result;
 const race=outcome(second.query(reserveSql,[ids.org,ids.raceB,codes.race]));
 await awaitBlocked(admin,secondPid);
 await first.query('commit');
 const loser=await race;
 assert.equal(loser.error?.code,'P0001');
 assert.equal(loser.error?.message,'benefit_not_available');
 assert.equal(winner.status,'reserved');
 assert.equal(winner.remaining_visits,0);
 assert.deepEqual((await admin.query(`select remaining_visits,status from public.client_benefit_instruments where id=$1`,[ids.raceInstrument])).rows[0],
  {remaining_visits:0,status:'exhausted'});
 assert.equal((await admin.query(`select count(*)::integer n from public.benefit_redemptions where instrument_id=$1 and status='reserved'`,[ids.raceInstrument])).rows[0].n,1);
 assert.equal((await admin.query(`select count(*)::integer n from public.public_benefit_booking_requests_v115 where instrument_id=$1`,[ids.raceInstrument])).rows[0].n,1);
 console.log('PASS: two real PostgreSQL clients race for the last visit; exactly one succeeds and one is refused');

 const replay=(await second.query(reserveSql,[ids.org,ids.raceA,codes.race])).rows[0].result;
 assert.equal(replay.status,'already_bound');
 assert.equal(replay.id,ids.raceInstrument);
 assert.equal((await admin.query(`select count(*)::integer n from public.benefit_redemptions where instrument_id=$1`,[ids.raceInstrument])).rows[0].n,1);
 assert.equal((await admin.query(`select count(*)::integer n from public.benefit_ledger where instrument_id=$1 and event_type='reserved'`,[ids.raceInstrument])).rows[0].n,1);
 assert.equal((await admin.query(`select count(*)::integer n from public.benefit_audit_log where organization_id=$1 and action='benefit_reserved_public' and details->>'request_id'=$2`,[ids.org,ids.raceA])).rows[0].n,1);
 console.log('PASS: exact request_id replay is idempotent and cannot spend or audit twice');
}finally{
 for(const client of clients){try{await client.query('rollback');await client.query('reset role');}catch{}}
 if(admin&&fixtureCommitted){
  await admin.query('begin');
  try{
   await admin.query('set local session_replication_role=replica');
   await admin.query('delete from public.public_benefit_booking_requests_v115 where organization_id=any($1::uuid[])',[[ids.org,ids.foreignOrg]]);
   await admin.query('delete from public.benefit_audit_log where organization_id=any($1::uuid[])',[[ids.org,ids.foreignOrg]]);
   await admin.query('delete from public.benefit_ledger where organization_id=any($1::uuid[])',[[ids.org,ids.foreignOrg]]);
   await admin.query('delete from public.benefit_redemptions where organization_id=any($1::uuid[])',[[ids.org,ids.foreignOrg]]);
   await admin.query('delete from public.benefit_instrument_service_balances where organization_id=any($1::uuid[])',[[ids.org,ids.foreignOrg]]);
   await admin.query('delete from public.client_benefit_instruments where organization_id=any($1::uuid[])',[[ids.org,ids.foreignOrg]]);
   await admin.query('delete from public.benefit_product_services where organization_id=any($1::uuid[])',[[ids.org,ids.foreignOrg]]);
   await admin.query('delete from public.benefit_products where organization_id=any($1::uuid[])',[[ids.org,ids.foreignOrg]]);
   await admin.query('delete from public.organization_benefit_settings where organization_id=any($1::uuid[])',[[ids.org,ids.foreignOrg]]);
   await admin.query('delete from public.bookings where id=any($1::uuid[])',[bookingIds]);
   await admin.query('delete from public.services where id=any($1::uuid[])',[[ids.service,ids.otherService,ids.foreignService]]);
   await admin.query('delete from public.organization_memberships where organization_id=any($1::uuid[])',[[ids.org,ids.foreignOrg]]);
   await admin.query('delete from public.locations where id=any($1::uuid[])',[[ids.location,ids.foreignLocation]]);
   await admin.query('delete from public.organizations where id=any($1::uuid[])',[[ids.org,ids.foreignOrg]]);
   await admin.query('delete from public.performer_profiles where id=$1',[ids.actor]);
   await admin.query('delete from public.client_accounts where id=any($1::uuid[])',[[ids.client,ids.otherClient]]);
   await admin.query('delete from auth.users where id=$1',[ids.actor]);
   await admin.query('commit');
  }catch(error){await admin.query('rollback');throw error;}
 }
 if(admin&&!hadCore&&!hadWrapper){
  await admin.query(readFileSync(new URL('supabase-migration-v115-rollback.sql',root),'utf8'));
 }
 for(const client of clients)await client.end();
}
