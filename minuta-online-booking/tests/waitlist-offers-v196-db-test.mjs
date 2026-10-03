// A NEW embedded database and synthetic booking seam only. Not native race,
// original-source restoration, production permission or live acceptance proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
assert.ok(process.env.MINUTA_PGLITE_MODULE,'An explicitly installed test-only PGlite module is required');
const {PGlite}=await import(pathToFileURL(process.env.MINUTA_PGLITE_MODULE).href);
const forward=readFileSync(new URL('../supabase-migration-v196.sql',import.meta.url),'utf8');
const rollback=readFileSync(new URL('../supabase-migration-v196-rollback.sql',import.meta.url),'utf8');
import {id,actor,org,loc,service,request,token,offer,scaffold} from './waitlist-offers-v196-fixture.mjs';
async function withDb(fn){const db=new PGlite();try{await db.exec(scaffold);await db.exec(forward);await fn(db);}finally{await db.close();}}
async function as(db,role,sql,args=[]){await db.exec(`set role ${role}`);try{return (await db.query(sql,args)).rows;}finally{await db.exec('reset role');}}
async function create(db,o=offer,r=request){await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);
return (await as(db,'authenticated',`select public.create_minuta_waitlist_offer_v196($1,$2,current_date+1,time '10:00',clock_timestamp()+interval '10 minutes') result`,[o,r]))[0].result;}
async function accept(db,o=offer,t=token){return (await as(db,'anon','select public.accept_minuta_waitlist_offer_v196($1,$2) result',[o,t]))[0].result;}
async function counts(db){return (await db.query("select (select count(*)::int from bookings) bookings,(select count(*)::int from organization_waitlist_offers where status='accepted') accepted,(select status from organization_waitlist_requests where id=$1) request_status",[request])).rows[0];}

test('offer preserves legacy RPC and request, has immutable quote and creates no booking',()=>withDb(async db=>{
const old=(await db.query("select pg_get_functiondef('public.set_minuta_waitlist_status_v111(uuid,text)'::regprocedure) f")).rows[0].f;
const result=await create(db);assert.equal(result.state,'offered');assert.equal(result.priceRub,1500);assert.equal(result.durationMinutes,60);assert.equal(result.booking,null);
assert.deepEqual(await counts(db),{bookings:0,accepted:0,request_status:'waiting'});
await db.exec(forward);assert.equal((await db.query("select pg_get_functiondef('public.set_minuta_waitlist_status_v111(uuid,text)'::regprocedure) f")).rows[0].f,old);
}));
test('atomic acceptance and repeated response use the same real fixture row',()=>withDb(async db=>{
await create(db);const first=await accept(db);const second=await accept(db);assert.equal(first.state,'accepted');assert.deepEqual(second,first);
assert.equal(first.booking.status,'new');assert.ok(first.booking.manageToken);assert.deepEqual(await counts(db),{bookings:1,accepted:1,request_status:'booked'});
}));
test('client token binding rejects another request and never exposes phone or request token',()=>withDb(async db=>{
const result=await create(db);assert.ok(!JSON.stringify(result).includes('79990000000'));assert.ok(!JSON.stringify(result).includes(token));
await assert.rejects(accept(db,offer,id(99)),/waitlist_offer_unavailable/);assert.equal((await counts(db)).bookings,0);
await assert.rejects(as(db,'anon','select public.get_minuta_waitlist_offer_v196($1,$2)',[id(99),token]),/waitlist_offer_unavailable/);
}));
test('anonymous direct table read and offer creation are denied',()=>withDb(async db=>{
await create(db);await assert.rejects(as(db,'anon','select * from organization_waitlist_offers'),/permission denied/);
await assert.rejects(as(db,'anon','select public.create_minuta_waitlist_offer_v196($1,$2,current_date+1,time \'10:00\',now()+interval \'10 minutes\')',[id(8),request]),/permission denied/);
}));
for(const mode of ['outsider','inactive','missing_subject'])test(`creator refuses ${mode} and RLS hides foreign offers`,()=>withDb(async db=>{
await create(db);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[mode==='outsider'?id(90):mode==='missing_subject'?'':actor]);
if(mode==='inactive')await db.exec('update fixture_members set active=false');
assert.equal((await as(db,'authenticated','select * from organization_waitlist_offers')).length,0);
await assert.rejects(as(db,'authenticated',"select create_minuta_waitlist_offer_v196($1,$2,current_date+1,time '10:00',now()+interval '5 minutes')",[id(8),request]),/waitlist_offer_unavailable/);
}));
test('expired offer reads as expired without a worker and acceptance creates nothing',()=>withDb(async db=>{
await create(db);await db.exec("update organization_waitlist_offers set expires_at=clock_timestamp()-interval '1 second'");
assert.equal((await as(db,'anon','select get_minuta_waitlist_offer_v196($1,$2) r',[offer,token]))[0].r.state,'expired');
assert.equal((await accept(db)).reason,'deadline');assert.equal((await counts(db)).bookings,0);
}));
for(const status of ['cancelled','closed','booked'])test(`legacy ${status} blocks acceptance without false booking`,()=>withDb(async db=>{
await create(db);await db.query('update organization_waitlist_requests set status=$1 where id=$2',[status,request]);
const r=await accept(db);assert.equal(r.state,'expired');assert.equal(r.reason,'request_closed');assert.equal((await counts(db)).bookings,0);
}));
for(const change of ['price_rub=2000','duration_minutes=90'])test(`changed ${change} requires a new confirmation`,()=>withDb(async db=>{
await create(db);await db.exec('update services set '+change);const r=await accept(db);assert.equal(r.state,'expired');assert.equal(r.reason,'service_terms_changed');assert.equal(r.priceRub,1500);assert.equal(r.durationMinutes,60);assert.equal((await counts(db)).bookings,0);
}));
test('unavailable slot marks only its offer busy and preserves waiting request',()=>withDb(async db=>{
await create(db);await db.exec('update fixture_slots set available=false');const r=await accept(db);assert.equal(r.state,'busy');assert.deepEqual(await counts(db),{bookings:0,accepted:0,request_status:'waiting'});
}));
for(const mode of ['busy','buffer','changed'])test(`typed booking seam ${mode} returns a terminal state without a false booking`,()=>withDb(async db=>{
await create(db);await db.query("select set_config('fixture.booking_mode',$1,false)",[mode]);const r=await accept(db);assert.equal(r.state,mode==='changed'?'expired':'busy');assert.equal((await counts(db)).bookings,0);
}));
for(const mode of ['unknown','unknown_exclusion','bad_ack','zero_ack','multiple_ack'])test(`booking seam ${mode} fails atomically and keeps the offer retryable`,()=>withDb(async db=>{
await create(db);await db.query("select set_config('fixture.booking_mode',$1,false)",[mode]);
await assert.rejects(accept(db),['bad_ack','zero_ack','multiple_ack'].includes(mode)?/waitlist_offer_atomic_ack_invalid/:mode==='unknown'?/unrelated_source_failure/:/unrelated_exclusion_failure/);
assert.deepEqual(await counts(db),{bookings:0,accepted:0,request_status:'waiting'});
assert.equal((await db.query('select status from organization_waitlist_offers')).rows[0].status,'offered');
await db.query("select set_config('fixture.booking_mode','',false)");assert.equal((await accept(db)).state,'accepted');
}));
test('two prepared offers for one slot do not yield a second booking after the first acceptance',()=>withDb(async db=>{
await db.query("insert into organization_waitlist_requests select $1,organization_id,location_id,performer_id,service_id,$2,'Other synthetic client','79990000001',desired_date,time_period,status,updated_at from organization_waitlist_requests where id=$3",[id(15),id(16),request]);
await create(db);await create(db,id(17),id(15));await accept(db);assert.equal((await accept(db,id(17),id(16))).state,'busy');assert.equal((await counts(db)).bookings,1);
}));
test('stable creator retry does not renew expiry and rejects altered payload',()=>withDb(async db=>{
await create(db);const o=(await db.query('select booking_date::text,booking_time::text,expires_at::text from organization_waitlist_offers')).rows[0];
const r=(await as(db,'authenticated','select create_minuta_waitlist_offer_v196($1,$2,$3,$4,$5) r',[offer,request,o.booking_date,o.booking_time,o.expires_at]))[0].r;
assert.equal(r.state,'offered');assert.equal((await db.query('select count(*)::int n from organization_waitlist_offers')).rows[0].n,1);
await assert.rejects(as(db,'authenticated',"select create_minuta_waitlist_offer_v196($1,$2,current_date+1,time '11:00',now()+interval '5 minutes')",[offer,request]),/waitlist_offer_request_conflict/);
}));
test('another active offer for the same request is rejected',()=>withDb(async db=>{
await create(db);await assert.rejects(create(db,id(8)),/waitlist_offer_already_active/);
}));
test('unavailable slot and 180-day request cannot bypass the 14-day booking horizon',()=>withDb(async db=>{
await db.exec('update fixture_slots set available=false');await assert.rejects(create(db),/waitlist_offer_slot_busy/);
await db.exec('update fixture_slots set available=true;update organization_waitlist_requests set desired_date=current_date+30');
await assert.rejects(as(db,'authenticated',"select create_minuta_waitlist_offer_v196($1,$2,current_date+30,time '10:00',now()+interval '5 minutes')",[offer,request]),/waitlist_offer_outside_supported_horizon/);
}));
for(const expires of ["clock_timestamp()-interval '1 minute'","clock_timestamp()+interval '25 hours'"])test(`invalid deadline ${expires} is rejected`,()=>withDb(async db=>{
await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);
await assert.rejects(as(db,'authenticated',`select create_minuta_waitlist_offer_v196($1,$2,current_date+1,time '10:00',${expires})`,[offer,request]),/invalid_waitlist_offer/);
}));
test('rollback/reapply preserve accepted booking, offer, legacy request and legacy RPC',()=>withDb(async db=>{
await create(db);const accepted=await accept(db);const before=await counts(db);await db.exec(rollback);await db.exec(rollback);
assert.deepEqual(await counts(db),before);await assert.rejects(accept(db),/permission denied/);
assert.equal((await db.query('select set_minuta_waitlist_status_v111($1,$2) v',[request,'waiting'])).rows[0].v,'legacy-preserved');
await db.exec(forward);assert.deepEqual(await accept(db),accepted);assert.deepEqual(await counts(db),before);
}));
test('preexisting foreign table is refused before modification',async()=>{const db=new PGlite();try{
await db.exec(scaffold);await db.exec('create table organization_waitlist_offers(foreign_data text);insert into organization_waitlist_offers values(\'preserve\')');
await assert.rejects(db.exec(forward),/waitlist_offers_existing_object_conflict/);await db.exec('rollback');
assert.deepEqual((await db.query('select * from organization_waitlist_offers')).rows,[{foreign_data:'preserve'}]);
}finally{await db.close();}});

for(const change of ['active=false',"performer_id='00000000-0000-4000-8000-000000000090'"])test('service change '+change+' expires the original proposal',()=>withDb(async db=>{
 await create(db);await db.exec('update services set '+change);assert.equal((await accept(db)).reason,'service_terms_changed');assert.equal((await counts(db)).bookings,0);
}));
test('accepted history survives legitimate booking rescheduling and discount',()=>withDb(async db=>{
 await create(db);const first=await accept(db);await db.exec("update bookings set booking_date=booking_date+1,booking_time='11:00',total_price_rub=1000,status='confirmed'");
 const replay=await accept(db);assert.equal(replay.state,'accepted');assert.equal(replay.priceRub,1500);assert.equal(replay.booking.manageToken,first.booking.manageToken);assert.equal(replay.booking.status,'confirmed');assert.equal((await counts(db)).bookings,1);
}));
test('service role has no implicit new RPC or table privilege',()=>withDb(async db=>{
 await create(db);await assert.rejects(as(db,'service_role','select * from organization_waitlist_offers'),/permission denied/);await assert.rejects(as(db,'service_role','select get_minuta_waitlist_offer_v196($1,$2)',[offer,token]),/permission denied/);
}));
test('foreign entry point is preserved when both forward and rollback are refused',async()=>{
 const db=new PGlite();try{await db.exec(scaffold);await db.exec("create function get_minuta_waitlist_offer_v196(uuid,uuid) returns jsonb language sql as $$select jsonb_build_object('foreign',true)$$");
 await assert.rejects(db.exec(forward),/waitlist_offers_existing_object_conflict/);await db.exec('rollback');await assert.rejects(db.exec(rollback),/waitlist_offers_existing_object_conflict/);await db.exec('rollback');
 assert.deepEqual((await db.query('select get_minuta_waitlist_offer_v196($1,$2) r',[offer,token])).rows[0].r,{foreign:true});
 }finally{await db.close();}
});
