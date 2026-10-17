// Synthetic PostgreSQL regression proof. This file never accepts a production host.
import assert from 'node:assert/strict';
import {readFileSync,realpathSync} from 'node:fs';
import {randomUUID as uuid} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=new URL('../',import.meta.url);
const read=name=>readFileSync(new URL(name,root),'utf8').replaceAll('\r\n','\n');
const forward=read('supabase-migration-v192.sql');
const rollback=read('recovery/rollback-benefits-audit-v192.sql');
const baselineDefinitions=rollback.match(/CREATE OR REPLACE FUNCTION[\s\S]*?end \$function\$\s*;/g);
assert.equal(baselineDefinitions?.length,3);
const helper=forward.match(/create or replace function public\.minuta_benefit_business_date_v192[\s\S]*?\$date\$;/i)[0];
const signatures=[
 'public.apply_minuta_benefit(uuid,uuid,uuid,text,integer)',
 'public.release_minuta_reserved_benefit_for_booking(uuid)',
 'public.issue_minuta_benefit(uuid,uuid,uuid,date,uuid)',
 'public.apply_minuta_benefit_v149(uuid,uuid,uuid,text,integer,uuid)',
];

export async function installFixture(db){
 const existing=await db.query("select count(*)::int n from pg_catalog.pg_tables where schemaname in ('public','auth')");
 assert.equal(existing.rows[0].n,0,'Test database must be empty');
 await db.query(read('tests/benefits-v192-bootstrap.sql'));
 await db.query(read('tests/benefits-v192-prerequisites.sql'));
 await db.query(read('supabase-migration-v73.sql'));
 await db.query(read('tests/benefits-v192-prerequisites.sql'));
 for(const definition of baselineDefinitions)await db.query(definition);
 await db.query("revoke all on function public.release_minuta_reserved_benefit_for_booking(uuid) from public,anon,authenticated,service_role");
 for(const version of [84,149,150])await db.query(read('supabase-migration-v'+version+'.sql'));
 await db.query("set timezone='UTC'");
}

export async function runBenefitCorrections(db,connect){
 const checks=[],baseline=[];
 const check=async(name,fn)=>{await fn();checks.push({name,status:'pass'});};
 const scalar=async(sql,args=[])=> (await db.query(sql,args)).rows[0].value;
 async function fixture(){
  const f=Object.fromEntries(['owner','admin','worker','outsider','org','foreign','client','otherClient','service','otherService','location'].map(k=>[k,uuid()]));
  await db.query('insert into auth.users(id) select unnest($1::uuid[])',[[f.owner,f.admin,f.worker,f.outsider]]);
  await db.query("insert into organizations(id,name,status) values($1,'Synthetic benefit regression','active'),($2,'Synthetic foreign','active')",[f.org,f.foreign]);
  for(const [id,role]of[[f.owner,'owner'],[f.admin,'admin'],[f.worker,'performer']])
   await db.query('insert into organization_memberships(organization_id,user_id,role) values($1,$2,$3)',[f.org,id,role]);
  await db.query("insert into locations(id,organization_id,timezone) values($1,$2,'Europe/Samara')",[f.location,f.org]);
  await db.query('insert into client_accounts(id) values($1),($2)',[f.client,f.otherClient]);
  for(const id of[f.service,f.otherService])await db.query("insert into services(id,performer_id,name) values($1,$2,'Synthetic service')",[id,f.owner]);
  await db.query('insert into organization_benefit_settings(organization_id,enabled) values($1,true)',[f.org]);
  await booking(f);
  return f;
 }
 async function booking(f,extra={}){
  const id=uuid();
  await db.query("insert into bookings(id,organization_id,location_id,performer_id,service_id,client_account_id,client_name,client_phone,total_price_rub,booking_date,status) values($1,$2,$3,$4,$5,$6,'Synthetic','00000000000',$7,coalesce($8::date,current_date),'confirmed')",
   [id,f.org,f.location,f.owner,extra.service||f.service,extra.client||f.client,extra.price??300,extra.date||null]);
  return id;
 }
 async function rpc(f,name,args,who=f.owner,connection=db){
  await connection.query("select set_config('request.jwt.claim.sub',$1,false)",[who||'']);
  await connection.query('set role authenticated');
  try{return(await connection.query('select public.'+name+'('+args.map((_,n)=>'$'+(n+1)).join(',')+') result',args)).rows[0].result;}
  finally{await connection.query('reset role');}
 }
 async function product(f,kind='visit_pass',visits=5){
  const services=kind==='package'?[{service_id:f.service,units:visits}]:[];
  return(await rpc(f,'upsert_minuta_benefit_product',[f.org,null,'Synthetic '+kind,kind,500,kind==='certificate'?1000:0,kind==='certificate'?0:visits,90,JSON.stringify(services)])).id;
 }
 async function issue(f,p,expiry=null,request=uuid()){
  return rpc(f,'issue_minuta_benefit',[f.org,p,f.client,expiry,request]);
 }
 async function instrument(f,kind='visit_pass',visits=5){return issue(f,await product(f,kind,visits));}
 async function apply(f,i,b,action,amount=null,request=uuid(),who=f.owner,connection=db){
  return rpc(f,'apply_minuta_benefit_v149',[f.org,i,b,action,amount,request],who,connection);
 }
 const balance=async id=>(await db.query('select remaining_visits,remaining_amount_rub,status,expires_on::text from client_benefit_instruments where id=$1',[id])).rows[0];
 const outcome=fn=>fn().then(value=>({accepted:true,value}),e=>({accepted:false,error:e.message,code:e.code}));
 const reject=async(fn,message)=>assert.rejects(fn,e=>e.message===message,'Expected '+message);
 async function overpayment(){
  const f=await fixture(),i=await instrument(f,'certificate'),b=await booking(f,{price:300});
  const result=await outcome(()=>apply(f,i.id,b,'reserve',800));
  return {result,balance:await balance(i.id),instrument:i.id};
 }
 async function cancelledReturn(kind='visit_pass',expired=false){
  const f=await fixture(),i=await instrument(f,kind),b=await booking(f);
  await apply(f,i.id,b,'reserve');await db.query("insert into booking_outcomes values($1,'completed')",[b]);
  await apply(f,i.id,b,'redeem');await rpc(f,'set_minuta_benefit_status',[f.org,i.id,'cancelled']);
  if(expired)await db.query("update client_benefit_instruments set expires_on='2000-01-01' where id=$1",[i.id]);
  const request=uuid();await apply(f,i.id,b,'release',null,request);await apply(f,i.id,b,'release',null,request);
  return balance(i.id);
 }
 async function timezoneBoundary(){
  const f=await fixture();
  const clock=(await db.query("select timezone('UTC',clock_timestamp())::date::text utc_day,case when extract(hour from timezone('UTC',clock_timestamp()))>=10 then 'Pacific/Kiritimati' else 'Etc/GMT+12' end zone")).rows[0];
  await db.query('update locations set timezone=$1 where id=$2',[clock.zone,f.location]);
  const businessDay=await scalar("select timezone($1,clock_timestamp())::date::text value",[clock.zone]);
  assert.notEqual(businessDay,clock.utc_day);
  const expiry=businessDay<clock.utc_day?businessDay:clock.utc_day;
  const i=await instrument(f),b=await booking(f,{date:expiry});
  await db.query('update client_benefit_instruments set expires_on=$1::date where id=$2',[expiry,i.id]);
  return {result:await outcome(()=>apply(f,i.id,b,'reserve')),shouldAccept:businessDay<=expiry};
 }
 const oldOver=await overpayment();assert.equal(oldOver.result.accepted,true);
 baseline.push({name:'certificate overpayment',status:'reproduced'});
 assert.equal((await cancelledReturn()).status,'active');
 baseline.push({name:'cancelled instrument revival',status:'reproduced'});
 const oldDate=await timezoneBoundary();assert.notEqual(oldDate.result.accepted,oldDate.shouldAccept);
 baseline.push({name:'UTC and organization expiry mismatch',status:'reproduced'});
 async function definitions(){return (await db.query("select p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition,p.proacl::text acl,p.proowner::regrole::text owner from pg_proc p where p.oid=any($1::regprocedure[]) order by p.oid::regprocedure::text",[signatures])).rows;}
 async function dataSnapshot(){
  const result={};
  for(const table of ['client_benefit_instruments','benefit_redemptions','benefit_ledger','benefit_application_requests'])
   result[table]=await scalar('select coalesce(jsonb_agg(to_jsonb(t) order by t.id),\'[]\'::jsonb) value from public.'+table+' t');
  return result;
 }
 const beforeFunctions=await definitions(),beforeData=await dataSnapshot();
 await db.query(forward);
 const afterFunctions=await definitions();
 await check('migration preserves data, existing owners and ACLs',async()=>{
  assert.deepEqual(await dataSnapshot(),beforeData);
  assert.deepEqual(afterFunctions.map(({definition,...r})=>r),beforeFunctions.map(({definition,...r})=>r));
  assert.equal(afterFunctions.find(r=>r.signature.includes('apply_minuta_benefit_v149')).definition,beforeFunctions.find(r=>r.signature.includes('apply_minuta_benefit_v149')).definition);
  for(const role of ['anon','authenticated','service_role'])
   assert.equal(await scalar("select has_function_privilege($1,'public.minuta_benefit_business_date_v192(uuid,timestamptz)','EXECUTE') value",[role]),false);
 });
 await check('certificate overpayment rejects atomically',async()=>{
  const r=await overpayment();assert.equal(r.result.error,'invalid_benefit_application');
  assert.equal(r.balance.remaining_amount_rub,1000);
  assert.equal(await scalar('select count(*)::int value from benefit_redemptions where instrument_id=$1',[r.instrument]),0);
  assert.equal(await scalar('select count(*)::int value from benefit_application_requests where instrument_id=$1',[r.instrument]),0);
 });
 await check('exact, partial, automatic and zero-price certificate limits',async()=>{
  for(const [price,amount,expected]of[[300,300,700],[300,200,800],[300,null,700],[1500,null,0]]){
   const f=await fixture(),i=await instrument(f,'certificate'),b=await booking(f,{price});
   const req=uuid();await apply(f,i.id,b,'reserve',amount,req);await apply(f,i.id,b,'reserve',amount,req);
   assert.equal((await balance(i.id)).remaining_amount_rub,expected);
  }
  for(const price of [0,null,-1]){
   const f=await fixture(),i=await instrument(f,'certificate'),b=await booking(f,{price:0});
   await db.query('update bookings set total_price_rub=$1 where id=$2',[price,b]);
   await reject(()=>apply(f,i.id,b,'reserve',1),'invalid_benefit_application');
   assert.equal((await balance(i.id)).remaining_amount_rub,1000);
  }
 });
 await check('cancelled visit pass, package and certificate stay cancelled after return and replay',async()=>{
  for(const kind of ['visit_pass','package','certificate']){
   const b=await cancelledReturn(kind);assert.equal(b.status,'cancelled');
   assert.equal(b.remaining_visits,kind==='certificate'?0:5);
   assert.equal(b.remaining_amount_rub,kind==='certificate'?1000:0);
  }
  assert.equal((await cancelledReturn('visit_pass',true)).status,'cancelled');
 });
 await check('cancellation helper preserves cancellation and restores once',async()=>{
  const f=await fixture(),i=await instrument(f,'package'),b=await booking(f);
  await apply(f,i.id,b,'reserve');
  await reject(()=>rpc(f,'set_minuta_benefit_status',[f.org,i.id,'cancelled']),'release_reserved_benefits_before_cancel');
  // A synthetic legacy state exercises the internal cancellation helper.
  await db.query("update client_benefit_instruments set status='cancelled' where id=$1",[i.id]);
  assert.equal(await scalar('select public.release_minuta_reserved_benefit_for_booking($1) value',[b]),true);
  assert.equal(await scalar('select public.release_minuta_reserved_benefit_for_booking($1) value',[b]),false);
  assert.equal((await balance(i.id)).status,'cancelled');assert.equal((await balance(i.id)).remaining_visits,5);
 });
 await check('organization calendar is independent of UTC session date',async()=>{
  const r=await timezoneBoundary();assert.equal(r.result.accepted,r.shouldAccept);
  if(!r.shouldAccept)assert.equal(r.result.error,'benefit_not_available');
 });
 await check('fixed business-date boundaries: final day inclusive across Samara midnight',async()=>{
  const f=await fixture();
  for(const [instant,date]of[['2026-09-05T19:59:59.999Z','2026-09-05'],['2026-09-05T20:00:00Z','2026-09-06']]){
   assert.equal(await scalar('select public.minuta_benefit_business_date_v192($1,$2::timestamptz)::text value',[f.org,instant]),date);
  }
  await db.query(helper.replace('p_now)::date',"coalesce(nullif(current_setting('benefits.audit_clock',true),'')::timestamptz,p_now))::date"));
  try{
   const p=await product(f);
   let lastDayIssue;
   for(const [instant,available]of[['2026-09-05T19:59:59.999Z',true],['2026-09-05T20:00:00Z',false]]){
    await db.query("select set_config('benefits.audit_clock',$1,false)",[instant]);
    if(available){
     const request=uuid(),i=await issue(f,p,'2026-09-05',request),b=await booking(f,{date:'2026-09-05'});
     lastDayIssue={request,id:i.id};
     assert.equal((await issue(f,p,'2026-09-05',request)).id,i.id);
     await apply(f,i.id,b,'reserve');
    }else{
     assert.equal((await issue(f,p,'2026-09-05',lastDayIssue.request)).id,lastDayIssue.id);
     await reject(()=>issue(f,p,'2026-09-05'),'invalid_benefit_expiry');
     const i=await issue(f,p),b=await booking(f,{date:'2026-09-05'});
     await db.query("update client_benefit_instruments set expires_on='2026-09-05' where id=$1",[i.id]);
     await reject(()=>apply(f,i.id,b,'reserve'),'benefit_not_available');
    }
   }
   const i=await issue(f,p),b=await booking(f,{date:'2026-09-05'});
   await db.query("select set_config('benefits.audit_clock','2026-09-05T19:59:59Z',false)");
   await db.query("update client_benefit_instruments set expires_on='2026-09-05' where id=$1",[i.id]);
   await apply(f,i.id,b,'reserve');
   await db.query("select set_config('benefits.audit_clock','2026-09-05T20:00:00Z',false)");
   await scalar('select public.release_minuta_reserved_benefit_for_booking($1) value',[b]);
   assert.equal((await balance(i.id)).status,'expired');
  }finally{await db.query("select set_config('benefits.audit_clock','',false)");await db.query(helper);}
 });
 await check('owner-only redeemed return, tenant and role isolation remain enforced',async()=>{
  const f=await fixture(),i=await instrument(f),b=await booking(f);
  for(const who of[f.worker,f.outsider])await reject(()=>apply(f,i.id,b,'reserve',null,uuid(),who),'benefit_management_denied');
  await reject(()=>rpc(f,'apply_minuta_benefit_v149',[f.foreign,i.id,b,'reserve',null,uuid()]),'benefit_management_denied');
  await apply(f,i.id,b,'reserve');await db.query("insert into booking_outcomes values($1,'completed')",[b]);await apply(f,i.id,b,'redeem');
  await reject(()=>apply(f,i.id,b,'release',null,uuid(),f.admin),'owner_required_to_release_redeemed_benefit');
  assert.equal((await balance(i.id)).remaining_visits,4);await apply(f,i.id,b,'release');
 });
 await check('last visit stays protected by real concurrent sessions',async()=>{
  const f=await fixture(),i=await instrument(f,'visit_pass',1),a=await booking(f),b=await booking(f),c1=await connect(),c2=await connect();
  try{
   await c1.query('begin');await apply(f,i.id,a,'reserve',null,uuid(),f.owner,c1);
   const second=outcome(()=>apply(f,i.id,b,'reserve',null,uuid(),f.owner,c2));
   let blocked=false;
   for(let n=0;n<80;n++){
    const row=await db.query("select wait_event_type='Lock' blocked from pg_stat_activity where pid=$1",[c2.processID]);
    if(row.rows[0]?.blocked){blocked=true;break;}
    await new Promise(r=>setTimeout(r,20));
   }
   assert.equal(blocked,true);await c1.query('commit');
   assert.equal((await second).accepted,false);
   assert.equal((await balance(i.id)).remaining_visits,0);
   assert.equal(await scalar("select count(*)::int value from benefit_redemptions where instrument_id=$1 and status='reserved'",[i.id]),1);
  }finally{await c1.query('rollback');await c1.end();await c2.end();}
 });
 await check('reapply is idempotent and rollback restores exact definitions, ACLs and data',async()=>{
  const saved=await dataSnapshot(),fixedFunctions=await definitions();
  await db.query(forward.replaceAll('\n','\r\n'));
  await db.query(forward);assert.deepEqual(await definitions(),fixedFunctions);
  await db.query(rollback);assert.deepEqual(await definitions(),beforeFunctions);
  assert.deepEqual(await dataSnapshot(),saved);
  assert.equal(await scalar("select to_regprocedure('public.minuta_benefit_business_date_v192(uuid,timestamptz)') is null value"),true);
  await db.query(forward);assert.deepEqual(await definitions(),fixedFunctions);
 });
 await check('source drift stops both migration and rollback without overwriting code',async()=>{
  const current=(await definitions()).find(r=>r.signature.includes('apply_minuta_benefit(')).definition;
  await db.query(current.replace('end $function$','-- synthetic drift\nend $function$'));
  for(const sql of [forward,rollback]){
   await reject(()=>db.query(sql),'v192_source_drift_apply_minuta_benefit');await db.query('rollback');
   assert.match(await scalar("select pg_get_functiondef('public.apply_minuta_benefit(uuid,uuid,uuid,text,integer)'::regprocedure) value"),/synthetic drift/);
  }
  await db.query(current);
 });
 return {baseline,checks,productionMutations:false,engine:'native PostgreSQL',clockOverride:'synthetic private helper only; restored before rollback checks'};
}

if(process.argv[1]&&realpathSync(fileURLToPath(import.meta.url))===realpathSync(process.argv[1])){
 const url=new URL(process.env.MINUTA_TEST_DATABASE_URL||'postgres://invalid');
 assert.equal(['127.0.0.1','localhost','[::1]'].includes(url.hostname),true,'Loopback test database required');
 assert.match(url.pathname,/^\/benefits_v192_test_[a-z0-9]+$/,'Named disposable test database required');
 const pg=await import(process.env.MINUTA_PG_MODULE?pathToFileURL(process.env.MINUTA_PG_MODULE).href:'pg');
 const Client=pg.Client||pg.default.Client;
 const connect=async()=>{const c=new Client({connectionString:url.href});await c.connect();return c;};
 const db=await connect();
 try{await installFixture(db);console.log(JSON.stringify(await runBenefitCorrections(db,connect)));}
 finally{await db.end();}
}
