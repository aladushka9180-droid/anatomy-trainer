import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
// Embedded PostgreSQL with synthetic dependency boundaries, not a production
// backup/restore, complete Auth/RLS proof, concurrency test or live acceptance.
const {PGlite}=await import(process.env.MINUTA_PGLITE_MODULE?pathToFileURL(process.env.MINUTA_PGLITE_MODULE).href:'@electric-sql/pglite');
const root=new URL('../',import.meta.url),read=p=>readFileSync(new URL(p,root),'utf8').replaceAll('\r\n','\n');
function definition(file,name){
  const sql=read(file),start=sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start>=0,name);const end=sql.indexOf('$$;',sql.indexOf('as $$',start));
  assert.ok(end>start,name);return sql.slice(start,end+3);
}
const forward=read('recovery/historical-inventory-forward.sql'),rollback=read('recovery/historical-inventory-rollback.sql');
const db=new PGlite();let passed=0;
async function check(name,fn){await fn();passed++;console.log(`PASS ${name}`);}
const actor='11111111-1111-4111-8111-111111111111',org='22222222-2222-4222-8222-222222222222';
const loc='33333333-3333-4333-8333-333333333333',service='44444444-4444-4444-8444-444444444444';
const item1='55555555-5555-4555-8555-555555555551',item2='55555555-5555-4555-8555-555555555552';
const one=async sql=>(await db.query(sql)).rows[0];
const state=()=>one(`select (select jsonb_agg(t order by inventory_item_id) from inventory_stock_balances t) stocks,
  (select count(*)::int from inventory_movements) movements,(select count(*)::int from bookings) bookings,
  (select count(*)::int from booking_outcomes) outcomes,
  (select jsonb_agg(t order by id) from bookings t) booking_rows,
  (select jsonb_agg(t order by booking_id) from booking_outcomes t) outcome_rows`);
const bodies=()=>one(`select jsonb_object_agg(proname,md5(prosrc)) hashes from pg_proc where proname in ('consume_minuta_inventory_for_booking','create_minuta_historical_booking') and pronargs in (1,9)`);
async function refuse(sql,message){await assert.rejects(db.exec(sql),error=>error.message.includes(message));}
async function patchRefuse(sql,message){try{await refuse(sql,message);}finally{await db.exec('rollback');}}
try{
 await db.exec(`create schema auth; create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create table organizations(id uuid primary key,status text);
 create table organization_memberships(organization_id uuid,user_id uuid,role text,active boolean);
 create table locations(id uuid primary key,organization_id uuid,active boolean,timezone text);
 create table services(id uuid primary key,duration_minutes int);
 create table bookings(id uuid primary key default gen_random_uuid(),organization_id uuid,location_id uuid,performer_id uuid,service_id uuid,
   booking_date date,booking_time time,duration_minutes int,booking_policy_snapshot jsonb);
 create table booking_outcomes(booking_id uuid primary key,visit_status text,payment_method text,amount_rub int);
 create table organization_inventory_settings(organization_id uuid,enabled boolean,auto_deduct_completed_visits boolean);
 create table inventory_items(id uuid,organization_id uuid,active boolean);
 create table inventory_service_usage(organization_id uuid,service_id uuid,inventory_item_id uuid,quantity numeric);
 create table inventory_warehouses(id uuid,organization_id uuid,location_id uuid,active boolean);
 create table inventory_stock_balances(organization_id uuid,warehouse_id uuid,inventory_item_id uuid,quantity numeric,updated_at timestamptz,
   unique(organization_id,warehouse_id,inventory_item_id));
 create table inventory_movements(organization_id uuid,warehouse_id uuid,inventory_item_id uuid,booking_id uuid,movement_type text,
   quantity_delta numeric,quantity_after numeric,request_id uuid,reason text,actor_id uuid);
 create table test_audit(organization_id uuid,action text,subject_id uuid,details jsonb);
 create function write_minuta_inventory_audit(uuid,text,uuid,jsonb) returns void language sql as $$insert into public.test_audit values($1,$2,$3,$4)$$;
 insert into organizations values('${org}','active');
 insert into organization_memberships values('${org}','${actor}','owner',true);
 insert into locations values('${loc}','${org}',true,'Europe/Samara');
 insert into services values('${service}',60);
 insert into organization_inventory_settings values('${org}',true,true);
 insert into inventory_items values('${item1}','${org}',true),('${item2}','${org}',true);
 insert into inventory_warehouses values('${loc}','${org}','${loc}',true);
 insert into inventory_service_usage values('${org}','${service}','${item1}',1),('${org}','${service}','${item2}',1);
 insert into inventory_stock_balances values('${org}','${loc}','${item1}',5,null),('${org}','${loc}','${item2}',0,null);
 select set_config('test.actor','${actor}',false);
 create function create_minuta_historical_booking(uuid,uuid,date,time,text,text,int) returns jsonb language plpgsql as $$declare v_id uuid; begin
   insert into public.bookings(organization_id,location_id,performer_id,service_id,booking_date,booking_time,duration_minutes,booking_policy_snapshot)
   values($1,'${loc}','${actor}',$2,$3,$4,$7,'{"historical":true}') returning id into v_id;
   return jsonb_build_object('booking_id',v_id,'duration_minutes',$7,'total_price_rub',3000);
 end;$$;
 create function save_minuta_booking_outcome_v106(uuid,text,text,int,int,text) returns jsonb language plpgsql as $$begin
   insert into public.booking_outcomes values($1,$2,$3,$4);
   return jsonb_build_object('booking_id',$1,'visit_status',$2,'payment_method',$3,'amount_rub',$4,'calculated_amount_rub',3000);
 end;$$;`);
 await db.exec(definition('supabase-migration-v164.sql','consume_minuta_inventory_for_booking'));
 await db.exec(definition('supabase-migration-v145.sql','create_minuta_historical_booking'));
 await db.exec(definition('supabase-migration-v82.sql','sync_minuta_inventory_on_outcome'));
 await db.exec('create trigger test_inventory_outcome after insert on public.booking_outcomes for each row execute function public.sync_minuta_inventory_on_outcome()');
 await db.exec(`create role authenticated;revoke all on function public.consume_minuta_inventory_for_booking(uuid) from public;
   revoke all on function public.create_minuta_historical_booking(uuid,uuid,date,time,text,text,int,text,int) from public;
   grant execute on function public.create_minuta_historical_booking(uuid,uuid,date,time,text,text,int,text,int) to authenticated`);
 const metadata=()=>one(`select jsonb_agg(jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'definer',prosecdef,'config',proconfig) order by oid) data from pg_proc where proname in ('consume_minuta_inventory_for_booking','create_minuta_historical_booking') and pronargs in (1,9)`);
 const originalMetadata=await metadata();
 const baseline=await bodies();
 const create=`select create_minuta_historical_booking('${org}','${service}',current_date-5,time '19:00','Test client','+79990000000',60,'transfer',2500) result`;
 await check('baseline rolls back the historical visit and the earlier material deduction',async()=>{
   const before=await state();await refuse(create,'insufficient_inventory_stock_for_completed_visit');assert.deepEqual(await state(),before);
 });
 await db.exec(forward);
 const patched=await bodies();assert.notDeepEqual(patched,baseline);
 assert.equal(patched.hashes.create_minuta_historical_booking,baseline.hashes.create_minuta_historical_booking,'No historical RPC body or response-contract change');
 await check('forward is idempotent and retains both original signatures',async()=>{await db.exec(forward);assert.deepEqual(await bodies(),patched);});
 await check('owner ACL security-definer and empty search-path are unchanged',async()=>{assert.deepEqual(await metadata(),originalMetadata);});
 let result;
 await check('past visit and payment survive shortage with durable notice and no partial deduction',async()=>{
   const before=await state();result=(await one(create)).result;const after=await state();
   assert.equal(result.amount_rub,2500);assert.equal(result.visit_status,'completed');
   assert.deepEqual(after.stocks,before.stocks);assert.equal(after.movements,before.movements);
   assert.equal(after.bookings,before.bookings+1);assert.equal(after.outcomes,before.outcomes+1);
   assert.equal((await one(`select booking_policy_snapshot->'historical_inventory_unconsumed' flag from bookings where id='${result.booking_id}'`)).flag,true);
   assert.deepEqual(await one(`select payment_method,amount_rub from booking_outcomes where booking_id='${result.booking_id}'`),{payment_method:'transfer',amount_rub:2500});
   assert.equal((await one(`select count(*)::int n from test_audit where action='inventory_historical_not_deducted'`)).n,1);
 });
 await check('ordinary past booking cannot bypass shortage',async()=>{
   await db.exec(`update bookings set booking_policy_snapshot='{}' where id='${result.booking_id}'`);
   const before=await state();await refuse(`select consume_minuta_inventory_for_booking('${result.booking_id}')`,'insufficient_inventory_stock_for_completed_visit');assert.deepEqual(await state(),before);
 });
 await check('future historical flag cannot bypass shortage',async()=>{
   await db.exec(`update bookings set booking_policy_snapshot='{"historical":true}',booking_date=current_date+1 where id='${result.booking_id}'`);
   const before=await state();await refuse(`select consume_minuta_inventory_for_booking('${result.booking_id}')`,'insufficient_inventory_stock_for_completed_visit');assert.deepEqual(await state(),before);
   await db.exec(`update bookings set booking_date=current_date-5 where id='${result.booking_id}'`);
 });
 for(const change of ["select set_config('test.actor','',false)","update organization_memberships set active=false","update organization_memberships set role='viewer'","update organizations set status='inactive'"]){
   await check(`stock bypass rejects invalid actor or organization: ${change.split(' ')[0]} ${passed}`,async()=>{
     await db.exec(change);const before=await state();await refuse(`select consume_minuta_inventory_for_booking('${result.booking_id}')`,'insufficient_inventory_stock_for_completed_visit');assert.deepEqual(await state(),before);
     await db.exec(`select set_config('test.actor','${actor}',false);update organization_memberships set active=true,role='owner';update organizations set status='active'`);
   });
 }
 await check('missing warehouse remains a hard failure, not an inventory override',async()=>{
   await db.exec('update inventory_warehouses set active=false');const before=await state();await refuse(create,'inventory_warehouse_missing_for_location');assert.deepEqual(await state(),before);await db.exec('update inventory_warehouses set active=true');
 });
 await check('restocking allows one complete deduction and clears the durable notice',async()=>{
   await db.exec(`update inventory_stock_balances set quantity=5 where inventory_item_id='${item2}'`);
   await db.exec(`select consume_minuta_inventory_for_booking('${result.booking_id}')`);
   assert.equal((await one('select min(quantity)::int n from inventory_stock_balances')).n,4);
   assert.equal((await one('select count(*)::int n from inventory_movements')).n,2);
   assert.equal((await one(`select booking_policy_snapshot?'historical_inventory_unconsumed' flag from bookings where id='${result.booking_id}'`)).flag,false);
   const before=await state();await db.exec(`select consume_minuta_inventory_for_booking('${result.booking_id}')`);assert.deepEqual(await state(),before);
 });
 await check('normal historical success stores no spurious pending notice',async()=>{const ack=(await one(create)).result;assert.equal((await one(`select booking_policy_snapshot?'historical_inventory_unconsumed' flag from bookings where id='${ack.booking_id}'`)).flag,false);});
 await check('rollback/reapply preserve data and restore exact original function bodies',async()=>{
   await db.exec(`update inventory_stock_balances set quantity=0 where inventory_item_id='${item2}'`);
   const pending=(await one(create)).result;assert.equal((await one(`select booking_policy_snapshot->'historical_inventory_unconsumed' flag from bookings where id='${pending.booking_id}'`)).flag,true);
   const before=await state();await db.exec(rollback);assert.deepEqual(await bodies(),baseline);assert.deepEqual(await state(),before);
   await db.exec(rollback);await db.exec(forward);assert.deepEqual(await bodies(),patched);await db.exec(rollback);assert.deepEqual(await bodies(),baseline);assert.deepEqual(await state(),before);
 });
 await check('partial patch is not accepted as an idempotent forward',async()=>{
   await db.exec(forward);
   const row=await one(`select pg_get_functiondef('public.consume_minuta_inventory_for_booking(uuid)'::regprocedure) ddl`);
   await db.exec(row.ddl.replace(/  -- historical-inventory-v1:clear:start\n[\s\S]*?  -- historical-inventory-v1:clear:end\n/,''));
   const before=await bodies();await patchRefuse(forward,'historical_inventory_partial_patch');assert.deepEqual(await bodies(),before);
   await db.exec(rollback);assert.deepEqual(await bodies(),baseline);
 });
 await check('unknown definition refuses forward and rollback without changing its neighbor',async()=>{
   await db.exec(definition('supabase-migration-v164.sql','consume_minuta_inventory_for_booking').replace('v_booking public.bookings%rowtype;','v_booking public.bookings%rowtype; -- unexpected drift\n'));
   const before=await bodies();await patchRefuse(forward,'historical_inventory_unknown_definition');assert.deepEqual(await bodies(),before);
   await patchRefuse(rollback,'historical_inventory_unknown_definition');assert.deepEqual(await bodies(),before);
 });
 console.log(`${passed}/${passed} embedded PostgreSQL checks; synthetic data, no production SQL or full restore proof`);
}catch(error){
 console.error(JSON.stringify({message:error.message,code:error.code,context:error.where}));process.exitCode=1;
}finally{await db.close();}
