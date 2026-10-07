import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createNativeFixture,validateSyntheticConnection } from './addon-offers-sql-native-adapter.mjs';
import { runNativeResourceRaces } from './addon-offers-sql-native-races.mjs';
const native = process.env.MINUTA_SQL_ENGINE === 'postgres';
let db;
if (native) db = await createNativeFixture();
else {
 const modulePath = process.env.MINUTA_PGLITE_MODULE;
 if (!modulePath) throw new Error('Set MINUTA_PGLITE_MODULE to a separately installed PGlite dist/index.js; no product DB connection supported.');
 const { PGlite } = await import(pathToFileURL(modulePath).href);
 const { pgcrypto } = await import(new URL('./contrib/pgcrypto.js',pathToFileURL(modulePath)));
 const { btree_gist } = await import(new URL('./contrib/btree_gist.js',pathToFileURL(modulePath)));
 db = new PGlite({ extensions:{ pgcrypto,btree_gist } });
}
const root = new URL('../',import.meta.url);
const migration = await readFile(new URL('../supabase/migrations/20261007095040_service_booking_offers.sql',root),'utf8');
const lifecycle = await readFile(new URL('../supabase/migrations/20261007104000_service_offer_resource_lifecycle.sql',root),'utf8');
const applyBundle=async()=>{await db.exec(migration);await db.exec(lifecycle);};
const fixture = await readFile(new URL('addon-offers-sql-fixture.sql',import.meta.url),'utf8');
const owner='10000000-0000-0000-0000-000000000001',other='10000000-0000-0000-0000-000000000002',loc='30000000-0000-0000-0000-000000000001';
const primary='40000000-0000-0000-0000-000000000001',addon='40000000-0000-0000-0000-000000000002',minute='40000000-0000-0000-0000-000000000003',foreign='40000000-0000-0000-0000-000000000004';
const scalar = async (sql,args=[]) => Object.values((await db.query(sql,args)).rows[0] || {})[0];
const reject = async (sql,args,match) => assert.rejects(()=>db.query(sql,args),e=>match.test(String(e.message)));
const offer = {id:null,primary_service_ids:[primary],addon_service_id:addon,benefit_text:'Поможет расслабить шею',discount_kind:'percent',discount_value:12.5,additional_minutes:15,enabled:true,revision:0,priority:50};
const save = row => scalar('select public.save_minuta_service_offer($1,$2::jsonb)',[owner,JSON.stringify(row)]);
const tests=[]; const findings=[];
async function check(name,fn){try{await fn();tests.push({name,status:'PASS'});}catch(error){tests.push({name,status:'FAIL',error:error.message});}}
function extractFunction(source,name){const start=source.indexOf(`create or replace function public.${name}(`);assert.ok(start>=0,name);const end=source.indexOf('$$;',start);assert.ok(end>start,name);return source.slice(start,end+3);}
let saved, booked,fixtureDate;
const request='70000000-0000-0000-0000-000000000001';
const book = (req=request,time='10:00',price=2438,duration=75) => scalar("select public.book_minuta_service_offers($1,'synthetic-offers',$2,$3,$8::date,$4,'Тестовый клиент','79990001122',$5,$6,'',$7::jsonb)",[req,loc,primary,time,price,duration,JSON.stringify([{id:saved.id,revision:saved.revision}]),fixtureDate]);
try {
 await check('native target guard accepts only explicit local empty fixture',async()=>{
  const safe={ADDON_OFFERS_SQL_CONFIRM:'LOCAL_SYNTHETIC_DB_ONLY',ADDON_OFFERS_SQL_DATABASE_URL:'postgresql://synthetic:test@127.0.0.1:5432/addon-offers-fixture'};
  assert.equal(validateSyntheticConnection(safe).hostname,'127.0.0.1');
  for(const env of [{...safe,ADDON_OFFERS_SQL_CONFIRM:''},{...safe,ADDON_OFFERS_SQL_DATABASE_URL:'postgresql://synthetic:test@example.com/addon-offers-fixture'},
    {...safe,ADDON_OFFERS_SQL_DATABASE_URL:'postgresql://synthetic:test@127.0.0.1/postgres'},
    {...safe,ADDON_OFFERS_SQL_DATABASE_URL:safe.ADDON_OFFERS_SQL_DATABASE_URL+'?host=example.com'}]) assert.throws(()=>validateSyntheticConnection(env));
 });
 await db.exec(fixture);
 fixtureDate=await scalar('select (current_date+5)::text');
 const [v53,v69]=await Promise.all(['supabase-migration-v53.sql','supabase-migration-v69.sql'].map(file=>readFile(new URL(file,root),'utf8')));
 await db.exec(extractFunction(v53,'initialize_booking_session_price')+'\n'+extractFunction(v53,'initialize_booking_session_item')+'\n'+extractFunction(v69,'allocate_minuta_booking_resources')+'\n'+extractFunction(v69,'sync_minuta_booking_resources')+'\n'+extractFunction(v69,'replace_minuta_service_resource_requirements'));
 await db.exec('revoke all on function public.allocate_minuta_booking_resources(uuid),public.sync_minuta_booking_resources() from public,anon,authenticated,service_role;');
 await db.exec(`create trigger bookings_initialize_session_price before insert on public.bookings for each row execute function public.initialize_booking_session_price();
 create trigger bookings_initialize_session_item after insert on public.bookings for each row execute function public.initialize_booking_session_item();
 create trigger bookings_sync_minuta_resources after insert or update of organization_id,location_id,service_id,booking_date,booking_time,duration_minutes,status on public.bookings for each row execute function public.sync_minuta_booking_resources();`);
 const allocatorOid=await scalar("select 'public.allocate_minuta_booking_resources(uuid)'::regprocedure::oid::text");
 await check('unchanged candidate migrations apply to synthetic schema',applyBundle);
 assert.equal(tests.at(-1).status,'PASS',tests.at(-1).error);
 await check('candidate reapply preserves existing data',applyBundle);
 await check('wrapper preserves canonical public function OID',async()=>assert.equal(await scalar("select 'public.allocate_minuta_booking_resources(uuid)'::regprocedure::oid::text"),allocatorOid));
 await db.exec(`select set_config('request.jwt.claim.sub','${owner}',false);set role authenticated;`);
 await check('owner save uses whole rubles percent',async()=>{saved=(await save(offer)).offer;assert.equal(saved.revision,1); const pub=await scalar('select public.get_public_minuta_service_offers($1,$2,$3)',['synthetic-offers',loc,primary]);assert.equal(pub.offers[0].price_rub,438);});
 await check('foreign addon rejected',()=>reject('select public.save_minuta_service_offer($1,$2::jsonb)',[owner,JSON.stringify({...offer,addon_service_id:foreign})],/unavailable/));
 await check('duplicate enabled addon rejected',()=>reject('select public.save_minuta_service_offer($1,$2::jsonb)',[owner,JSON.stringify(offer)],/limit/));
 await check('fractional rubles rejected',()=>reject('select public.save_minuta_service_offer($1,$2::jsonb)',[owner,JSON.stringify({...offer,discount_kind:'rubles',discount_value:1.5})],/invalid/));
 await check('stale revision rejected',()=>reject('select public.save_minuta_service_offer($1,$2::jsonb)',[owner,JSON.stringify({...saved,revision:0})],/revision_conflict/));
 await check('primary per-minute fixed-only rule',async()=>{try{await save({...offer,primary_service_ids:[minute]});findings.push('Server accepts per-minute primary although fixed-only UI excludes it.');throw new Error('PER_MINUTE_PRIMARY_ACCEPTED');}catch(error){if(error.message==='PER_MINUTE_PRIMARY_ACCEPTED')throw error;assert.match(error.message,/invalid|unavailable/);}});
 await db.exec(`select set_config('request.jwt.claim.sub','${other}',false);`);
 await check('outsider RPC rejects master ID',()=>reject('select public.get_minuta_service_offers($1)',[owner],/access_denied/));
 await check('owner SELECT RLS hides other master',async()=>assert.equal(await scalar('select count(*)::integer from public.service_booking_offers'),0));
 await check('authenticated direct INSERT denied',()=>reject('insert into public.service_booking_offers select * from public.service_booking_offers',[],/permission denied/));
 await db.exec('reset role;set role anon;');
 await check('private request ledger hidden',()=>reject('select * from minuta_offer_private.booking_requests',[],/permission denied/));
 await check('anon settings RPC denied',()=>reject('select public.get_minuta_service_offers($1)',[owner],/permission denied/));
 await check('one atomic booking with primary+addon resources',async()=>{booked=await book();assert.equal(booked.duration_minutes,75);assert.equal(booked.total_price_rub,2438);});
 await db.exec('reset role;');
 await check('canonical primary and addon session rows/resources created',async()=>{assert.equal(await scalar('select count(*)::integer from public.booking_session_items'),2);assert.equal(await scalar('select count(*)::integer from public.booking_resource_allocations where booking_status=\'active\''),2);assert.equal(await scalar("select bool_and(ends_at-starts_at=interval '75 minutes') from public.booking_resource_allocations"),true);});
 await db.exec('set role anon;');
 await check('same request returns ACK without duplicate rows',async()=>{const replay=await book();assert.equal(replay.idempotent,true);assert.equal(replay.manage_token,booked.manage_token);});
 await check('request reused with changed time rejects',async()=>{await assert.rejects(()=>book(request,'10:30'),/request_conflict/);});
 await check('total expected price mismatch rolls back',async()=>{await assert.rejects(()=>book('70000000-0000-0000-0000-000000000002','12:00',2439),/terms_changed/);});
 await check('overlapping visit rejects',async()=>{await assert.rejects(()=>book('70000000-0000-0000-0000-000000000003','10:30'),/slot_unavailable/);});
 await db.exec('reset role;');
 await check('failed bookings left no rows or requests',async()=>{assert.equal(await scalar('select count(*)::integer from public.bookings'),1);assert.equal(await scalar('select count(*)::integer from minuta_offer_private.booking_requests'),1);});
 await check('late addon resource failure rolls back core booking and ledger',async()=>{
  await db.exec(`create function minuta_offer_private.fixture_invalidate_resource() returns trigger language plpgsql as $$begin
   if new.request_id='70000000-0000-0000-0000-000000000005'::uuid then update public.resources set active=false where id='60000000-0000-0000-0000-000000000002';end if;return new;end$$;
   create trigger fixture_late_resource_failure after insert on minuta_offer_private.booking_requests for each row execute function minuta_offer_private.fixture_invalidate_resource();set role anon;`);
  await assert.rejects(()=>book('70000000-0000-0000-0000-000000000005','16:00'),/resource_unavailable/);
  await db.exec('reset role;drop trigger fixture_late_resource_failure on minuta_offer_private.booking_requests;drop function minuta_offer_private.fixture_invalidate_resource();');
  assert.equal(await scalar('select count(*)::integer from public.bookings'),1);
  assert.equal(await scalar('select count(*)::integer from minuta_offer_private.booking_requests'),1);
  assert.equal(await scalar('select count(*)::integer from public.booking_session_items'),2);
  assert.equal(await scalar("select active from public.resources where id='60000000-0000-0000-0000-000000000002'"),true);
 });
 if(native)await runNativeResourceRaces({db,check,owner,addon,primary,loc,saved,date:fixtureDate,originalRequest:request});
 await check('moving original composition moves addon allocations',async()=>{await db.exec("update public.bookings set booking_time='12:00' where request_id='"+request+"';");assert.equal(await scalar('select bool_and(starts_at=$1::timestamp) from public.booking_resource_allocations',[fixtureDate+' 12:00']),true);});
 await check('changing addon resource quantity cannot under-reserve existing visit',async()=>{
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  let rejected=false;
  try{await scalar('select public.replace_minuta_service_resource_requirements($1,$2,$3::jsonb)',['20000000-0000-0000-0000-000000000001',addon,JSON.stringify([{group_id:'50000000-0000-0000-0000-000000000002',quantity:2}])]);}
  catch(error){assert.match(error.message,/resource_unavailable|offer.*resource|offer.*requirement/);rejected=true;}
  if(!rejected)findings.push('Canonical replace_minuta_service_resource_requirements updates addon requirements without checking existing addon visits.');
  assert.equal(rejected,true,'Quantity2 with one physical addon resource must reject and roll back');
 });
 await db.exec("update public.service_resource_requirements set quantity=1 where service_id='"+addon+"';");
 await check('deferred requirement changes validate final transaction state',async()=>{
  await db.exec("begin;update public.service_resource_requirements set quantity=2 where service_id='"+addon+"';update public.service_resource_requirements set quantity=1 where service_id='"+addon+"';commit;");
  assert.equal(await scalar("select count(*)::integer from public.booking_resource_allocations where booking_status='active'"),2);
 });
 await check('direct canonical allocator preserves addon allocations',async()=>{await db.exec("select public.allocate_minuta_booking_resources(id) from public.bookings where request_id='"+request+"';");const n=await scalar('select count(*)::integer from public.booking_resource_allocations');if(n!==2)findings.push('Direct canonical allocate_minuta_booking_resources replaces all allocations with primary-only resources, dropping addon allocations.');assert.equal(n,2);});
 // Restore allocations through the ordinary update path before the next independent lifecycle scenario.
 await db.exec("update public.bookings set duration_minutes=duration_minutes where request_id='"+request+"';");
 await check('remove addon composition releases its resources',async()=>{await db.exec("delete from public.booking_session_items where item_kind='addon';update public.bookings set duration_minutes=60,total_price_rub=2000 where request_id='"+request+"';");const n=await scalar('select count(*)::integer from public.booking_resource_allocations');if(n!==1)findings.push('Resource trigger re-reserves removed addon from immutable booking_requests.snapshot.');assert.equal(n,1);});
 await check('cancel releases all resources',async()=>{await db.exec("update public.bookings set status='cancelled' where request_id='"+request+"';");assert.equal(await scalar("select count(*)::integer from public.booking_resource_allocations where booking_status='active'"),0);});
 await db.exec(`select set_config('request.jwt.claim.sub','${owner}',false);set role authenticated;`);
 await db.exec('reset role;update public.services set active=false where id=\''+addon+'\';set role authenticated;');
 await check('disabled archived offer remains manageable',async()=>{const result=(await save({...saved,enabled:false})).offer;assert.equal(result.enabled,false);assert.equal(result.revision,saved.revision+1);});
 await db.exec('reset role;');
 const disable=await readFile(new URL('service-booking-offers-disable.sql',root),'utf8');
 await check('disable preserves all accepted requests and data',async()=>{await db.exec(disable);assert.equal(await scalar('select count(*)::integer from minuta_offer_private.booking_requests'),1);});
 await db.exec('set role anon;');
 await check('disabled new public booking RPC denied',async()=>{await assert.rejects(()=>book('70000000-0000-0000-0000-000000000004','14:00'),/permission denied/);});
 await db.exec('reset role;');
 await check('reapply retains previous request ledger',async()=>{await applyBundle();assert.equal(await scalar('select count(*)::integer from minuta_offer_private.booking_requests'),1);});
 await db.exec('set role anon;');
 await check('reapply replay retains accepted ACK and cancelled status',async()=>{const replay=await book();assert.equal(replay.idempotent,true);assert.equal(replay.manage_token,booked.manage_token);assert.equal(replay.status,'cancelled');});
 await db.exec('reset role;');
 await check('allocator ACL drift rejects reapply without repairing silently',async()=>{
  await db.exec('grant execute on function public.allocate_minuta_booking_resources(uuid) to authenticated');
  await assert.rejects(()=>db.exec(lifecycle),/privilege_drift/);await db.exec('rollback;revoke execute on function public.allocate_minuta_booking_resources(uuid) from authenticated;');
 });
 await check('allocator source drift rejects reapply without replacing OID',async()=>{
  const definition=await scalar("select pg_get_functiondef('public.allocate_minuta_booking_resources(uuid)'::regprocedure)");
  await db.exec("create or replace function public.allocate_minuta_booking_resources(p_booking uuid) returns void language plpgsql security definer set search_path to '' as $$begin return;end$$;");
  await assert.rejects(()=>db.exec(lifecycle),/source_drift/);await db.exec('rollback;');await db.exec(definition);
  assert.equal(await scalar("select 'public.allocate_minuta_booking_resources(uuid)'::regprocedure::oid::text"),allocatorOid);
 });
 await check('reapply succeeds after original wrapper provenance restored',()=>db.exec(lifecycle));
 await check('private original helper drift rejects reapply',async()=>{
  const definition=await scalar("select pg_get_functiondef('minuta_offer_private.allocate_original_resources(uuid)'::regprocedure)");
  await db.exec("create or replace function minuta_offer_private.allocate_original_resources(p_booking uuid) returns void language plpgsql security definer set search_path to '' as $$begin return;end$$;");
  await assert.rejects(()=>db.exec(lifecycle),/original_helper_drift/);await db.exec('rollback;');await db.exec(definition);
  await db.exec(lifecycle);
 });
 await check('ordinary booking allocator retains primary-only behavior',async()=>{
  const normal='70000000-0000-0000-0000-000000000008';
  await db.query("select public.book_minuta_appointment_v3($1,'synthetic-offers',$2,$3,$4::date,'18:00','Тестовый клиент','79990001122',2000,60,'')",[normal,loc,primary,fixtureDate]);
  assert.equal(await scalar("select count(*)::integer from public.booking_resource_allocations a join public.bookings b on b.id=a.booking_id where b.request_id=$1",[normal]),1);
  await db.query('delete from public.booking_resource_allocations where booking_id in(select id from public.bookings where request_id=$1)',[normal]);
  await db.query('delete from public.booking_session_items where booking_id in(select id from public.bookings where request_id=$1)',[normal]);
  await db.query('delete from public.booking_session_revisions where booking_id in(select id from public.bookings where request_id=$1)',[normal]);
  await db.query('delete from public.bookings where request_id=$1',[normal]);
 });
 console.log(JSON.stringify({layer:`isolated synthetic ${native?'native PostgreSQL including 3 multi-connection races':'PGlite serial only'}; not full-schema restore`,migrationSha256:createHash('sha256').update(migration).digest('hex'),lifecycleSha256:createHash('sha256').update(lifecycle).digest('hex'),passed:tests.filter(t=>t.status==='PASS').length,total:tests.length,tests,findings},null,2));
 if(tests.some(t=>t.status==='FAIL'))process.exitCode=1;
} finally { await db.close(); }
