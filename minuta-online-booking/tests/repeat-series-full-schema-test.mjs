// Dedicated EMPTY, schema-only PostgreSQL clone. Never production or shared test data.
// The runner must destroy this ephemeral database after the test (also on failure).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const endpoint=new URL(process.env.MINUTA_TEST_DATABASE_URL);
assert.equal(process.env.MINUTA_SERIES_EPHEMERAL_CONFIRM,'SCHEMA_ONLY_EMPTY_DATABASE');
assert.ok(['127.0.0.1','localhost'].includes(endpoint.hostname));
assert.equal(endpoint.pathname,'/eldion-series-fixture');
assert.equal(process.env.MINUTA_TEST_PROJECT_REF,'eldion-series-fixture');
assert.ok(process.env.MINUTA_PRODUCTION_PROJECT_REF);
assert.notEqual(process.env.MINUTA_PRODUCTION_PROJECT_REF,process.env.MINUTA_TEST_PROJECT_REF);
assert.equal(process.env.MINUTA_TEST_MIGRATION_CONFIRM,'MIGRATE_ONLY_ISOLATED_TEST_DATABASE');
const pg=await import(process.env.MINUTA_PG_MODULE?pathToFileURL(process.env.MINUTA_PG_MODULE).href:'pg');
const Client=pg.Client||pg.default.Client,clients=[];
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8').replace(/\r\n/g,'\n');
const body=name=>{const sql=read(name);assert.equal((sql.match(/^begin;$/gm)||[]).length,1);assert.equal((sql.match(/^commit;$/gm)||[]).length,1);return sql.replace(/^begin;$/m,'').replace(/^commit;$/m,'');};
const one=async(db,sql,params=[])=>Object.values((await db.query(sql,params)).rows[0])[0];
async function connect(actor) {
 const db=new Client({connectionString:endpoint.href,application_name:'eldion-series-isolated'});await db.connect();clients.push(db);
 await db.query("set statement_timeout='45s'; set lock_timeout='15s'");
 if(actor){await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);await db.query('set role authenticated');}
 return db;
}
const apply=async db=>db.query(body('../recovery/provider-series-plan-candidate.sql'));
const revert=async db=>db.query(body('../recovery/provider-series-plan-rollback.sql'));
const pending=promise=>{const state={settled:false};state.result=promise.then(value=>{state.settled=true;return {value};},error=>{state.settled=true;return {error};});return state;};
async function waitsForLock(admin,pid,request) {
 const until=Date.now()+8000;
 while(Date.now()<until){assert.equal(request.settled,false,'requests must overlap');
  if(await one(admin,"select coalesce((select wait_event_type='Lock' from pg_stat_activity where pid=$1),false)",[pid]))return;
  await new Promise(resolve=>setTimeout(resolve,40));
 }
 assert.fail('no real lock wait observed');
}
try {
 const admin=await connect();
 assert.equal(await one(admin,"select count(*)::int from minuta_migration_guard.target where project_ref='eldion-series-fixture' and allow_migrations"),1);
 assert.equal(await one(admin,'select count(*)::int from auth.users'),0,'empty schema-only clone required');
 assert.equal(await one(admin,'select count(*)::int from public.bookings'),0,'empty schema-only clone required');
 await admin.query('begin');await apply(admin);await apply(admin);await admin.query('commit');
 // Reuse the established multi-service/material fixture; product triggers stay enabled.
 const fixtureSql=read('./repeat-visit-v164-integration.sql');
 const start=fixtureSql.indexOf('create table pg_temp.v164_fixture'),end=fixtureSql.indexOf('end $fixture$;');
 assert.ok(start>=0&&end>start);
 await admin.query('begin; set local search_path=public,extensions,pg_catalog');
 await admin.query(fixtureSql.slice(start,end+'end $fixture$;'.length));
 const f=(await admin.query('select * from pg_temp.v164_fixture')).rows[0];
 await admin.query('commit');
 const actor=await connect(f.owner_id),rival=await connect(f.owner_id);
 const date=days=>one(admin,"select (current_date+$1::int)::text",[days]);
 const day40=await date(40),day47=await date(47),day54=await date(54);
 const plan=[day40,day47,day54].map(date=>({date,time:'14:00'}));
 function args(overrides={}){return {request:randomUUID(),service:f.primary_service_id,name:'Synthetic series client',phone:f.phone,
  interval:1,plan,duration:60,org:f.organization_id,location:f.location_id,source:null,signature:null,price:null,comment:'',note:'',color:'auto',...overrides};}
 const create=(db,a)=>one(db,`select public.create_provider_series_plan(${Object.keys(a).map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(a).map((value,index)=>index===5?JSON.stringify(value):value));
 const book=(db,day,time)=>one(db,'select public.provider_book_appointment($1,$2,$3,$4,$5,$6)',[randomUUID(),f.primary_service_id,day,time,'Synthetic single',f.phone]);
 for(const db of [actor,rival])await db.query("select set_config('minuta.booking_organization',$1,false),set_config('minuta.booking_location',$2,false)",[f.organization_id,f.location_id]);
 const snapshot=async()=>{
  // Counts across all ordinary public tables also detect leaked outbox/ledger rows.
  const tables=(await admin.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows;
  const result={};for(const {tablename} of tables){const identifier='"'+tablename.replaceAll('"','""')+'"';result[tablename]=await one(admin,`select count(*)::int from public.${identifier}`);}return result;
 };
 await book(actor,day54,'14:00');const before=await snapshot();
 await assert.rejects(create(actor,args()),e=>e.message==='series_slot_unavailable');
 assert.deepEqual(await snapshot(),before,'third-visit failure must leave no partial records');
 const request=args({plan:plan.slice(0,2),note:'Synthetic note',color:'rose'});
 const created=await create(actor,request);assert.equal(created.created.length,2);
 const replay=await create(actor,request);assert.equal(replay.series_id,created.series_id);assert.equal(replay.recovered,true);
 await assert.rejects(create(actor,{...request,color:'sky'}),e=>e.message==='series_request_conflict');
 for(const visit of created.created){const b=(await admin.query('select duration_minutes,total_price_rub,color_key,series_id from public.bookings where id=$1',[visit.booking_id])).rows[0];assert.equal(b.duration_minutes,60);assert.equal(b.total_price_rub,3000);assert.equal(b.color_key,'rose');assert.equal(b.series_id,created.series_id);}
 const preview=await one(actor,'select public.get_provider_repeat_visit_v164($1)',[f.source_id]);
 const repeated=await create(actor,args({plan:[{date:await date(60),time:'14:00'},{date:await date(67),time:'14:00'}],duration:90,
  source:f.source_id,signature:preview.source_signature,price:3700,comment:'Synthetic copied comment'}));
 for(const visit of repeated.created){
  const b=(await admin.query('select duration_minutes,total_price_rub,provider_note,booking_policy_snapshot from public.bookings where id=$1',[visit.booking_id])).rows[0];
  assert.equal(b.duration_minutes,90);assert.equal(b.total_price_rub,3700);assert.equal(b.provider_note,'Synthetic copied comment');
  assert.equal(b.booking_policy_snapshot.repeat_materials[0].quantity,3);
  const items=(await admin.query('select count(*)::int n,sum(price_rub)::int total from public.booking_session_items where booking_id=$1',[visit.booking_id])).rows[0];
  assert.equal(items.n,2);assert.equal(items.total,3700);
 }
 const variable=randomUUID();await admin.query("insert into public.services(id,performer_id,name,duration_minutes,price_rub,active) values($1,$2,'Synthetic minute service',1,50,true)",[variable,f.owner_id]);
 const variableSeries=await create(actor,args({service:variable,duration:90,plan:[{date:await date(80),time:'14:00'},{date:await date(87),time:'14:00'}]}));
 assert.equal(await one(admin,'select total_price_rub from public.bookings where id=$1',[variableSeries.created[0].booking_id]),4500);
 // Actual blocking: same identity, distinct identities, and a single booking.
 const rivalPid=await one(rival,'select pg_backend_pid()');
 for(const [scenario,offset] of [['same',110],['other',140],['single',170]]){
  const a=args({plan:[{date:await date(offset),time:'14:00'},{date:await date(offset+7),time:'14:00'}]});
  await actor.query('begin');const first=await create(actor,a);
  const second=pending(scenario==='single'?book(rival,a.plan[0].date,'14:00'):create(rival,scenario==='same'?a:{...a,request:randomUUID()}));
  await waitsForLock(admin,rivalPid,second);await actor.query('commit');const result=await second.result;
  if(scenario==='same'){assert.ifError(result.error);assert.equal(result.value.series_id,first.series_id);}
  else assert.ok(result.error,'competing request must fail after first commit');
  assert.equal(await one(admin,'select count(*)::int from public.bookings where performer_id=$1 and booking_date=$2 and booking_time=$3',[f.owner_id,a.plan[0].date,'14:00']),1);
 }
 // Rolling back the winner releases the day locks and permits the waiting series.
 const rolled=args({plan:[{date:await date(200),time:'14:00'},{date:await date(207),time:'14:00'}]});
 await actor.query('begin');await create(actor,rolled);const afterRollback=pending(create(rival,{...rolled,request:randomUUID()}));
 await waitsForLock(admin,rivalPid,afterRollback);await actor.query('rollback');assert.ifError((await afterRollback.result).error);
 // Two different performers share one room. Their per-performer/day locks do
 // not overlap, so the resource allocation lock must reject the second series.
 const specialist=randomUUID(),specialistService=randomUUID(),group=randomUUID(),resource=randomUUID();
 await admin.query('set session_replication_role=replica');
 await admin.query("insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,now(),'{}','{}',now(),now())",[specialist,`${specialist}@example.invalid`]);
 await admin.query('set session_replication_role=origin');
 await admin.query("insert into public.performer_profiles(id,display_name) values($1,'Synthetic second specialist')",[specialist]);
 await admin.query("insert into public.organization_memberships(organization_id,user_id,role,is_bookable,active,created_by) values($1,$2,'specialist',true,true,$3)",[f.organization_id,specialist,f.owner_id]);
 await admin.query("insert into public.services select (jsonb_populate_record(null::public.services,to_jsonb(service)||jsonb_build_object('id',$1::uuid,'performer_id',$2::uuid,'name','Synthetic second service','created_at',now(),'updated_at',now()))).* from public.services service where service.id=$3",[specialistService,specialist,f.primary_service_id]);
 await admin.query("insert into public.provider_schedule(performer_id,weekday,enabled,start_time,end_time,break_start,break_end,slot_interval_minutes) select $1,weekday,enabled,start_time,end_time,break_start,break_end,slot_interval_minutes from public.provider_schedule where performer_id=$2",[specialist,f.owner_id]);
 await admin.query("insert into public.resource_groups(id,organization_id,kind,name) values($1,$2,'room','Synthetic shared room')",[group,f.organization_id]);
 await admin.query("insert into public.resources(id,organization_id,location_id,group_id,name) values($1,$2,$3,$4,'Synthetic shared resource')",[resource,f.organization_id,f.location_id,group]);
 await admin.query('insert into public.service_resource_requirements(organization_id,service_id,group_id,quantity) values($1,$2,$3,1),($1,$4,$3,1)',[f.organization_id,f.primary_service_id,group,specialistService]);
 const secondSpecialist=await connect(specialist);
 await secondSpecialist.query("select set_config('minuta.booking_organization',$1,false),set_config('minuta.booking_location',$2,false)",[f.organization_id,f.location_id]);
 const sharedPlan=[{date:await date(250),time:'14:00'},{date:await date(257),time:'14:00'}];
 const sharedOwner=args({plan:sharedPlan});
 await actor.query('begin');const sharedFirst=await create(actor,sharedOwner);
 const secondPid=await one(secondSpecialist,'select pg_backend_pid()');
 const sharedSecond=pending(create(secondSpecialist,args({service:specialistService,plan:sharedPlan,name:'Synthetic second client',phone:'79990000002'})));
 await waitsForLock(admin,secondPid,sharedSecond);await actor.query('commit');
 assert.ok((await sharedSecond.result).error,'second performer must lose the shared resource');
 for(const visit of sharedPlan)assert.equal(await one(admin,'select count(*)::int from public.bookings where performer_id=$1 and booking_date=$2 and booking_time=$3',[specialist,visit.date,visit.time]),0);
 for(const visit of sharedFirst.created)assert.equal(await one(admin,"select count(*)::int from public.booking_resource_allocations where booking_id=$1 and resource_id=$2 and booking_status='active'",[visit.booking_id,resource]),1);
 assert.equal(await one(admin,"select has_function_privilege('anon','public.create_provider_series_plan(uuid,uuid,text,text,integer,jsonb,integer,uuid,uuid,uuid,text,integer,text,text,text)','execute')"),false);
 const preserved=await snapshot();await admin.query('begin');await revert(admin);assert.deepEqual(await snapshot(),preserved);await apply(admin);await admin.query('commit');
 assert.deepEqual(await snapshot(),preserved);assert.equal((await create(actor,request)).series_id,created.series_id);
 console.log('Series full-schema PostgreSQL: PASS (real booking/repeat/materials, atomic rejection, variable duration, five concurrent lock scenarios including two performers sharing a resource, ACL and rollback/reapply).');
} finally {
 await Promise.allSettled(clients.map(async db=>{await db.query('rollback').catch(()=>{});await db.end();}));
}
