import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
process.on('uncaughtException',error=>{ console.error(error.message); process.exit(1); });
let db, newNativeClient;
const native=Boolean(process.env.MINUTA_CERTIFICATE_TEST_DATABASE_URL);
if(native){
  const target=new URL(process.env.MINUTA_CERTIFICATE_TEST_DATABASE_URL);
  if(!['127.0.0.1','localhost'].includes(target.hostname)||target.pathname!=='/minuta_certificate_test'||process.env.MINUTA_CERTIFICATE_TEST_CONFIRM!=='EMPTY_SYNTHETIC_DATABASE_ONLY')throw new Error('unsafe_test_database');
  const require=createRequire(import.meta.url),{Client}=require(process.env.MINUTA_PG_MODULE||'pg');
  const client=new Client({connectionString:target.href});await client.connect();
  newNativeClient=async()=>{const another=new Client({connectionString:target.href});await another.connect();return another};
  const guard=await client.query("select current_database() name,to_regclass('public.organizations') organizations,to_regclass('auth.users') users");
  if(guard.rows[0].name!=='minuta_certificate_test'||guard.rows[0].organizations||guard.rows[0].users){await client.end();throw new Error('test_database_not_empty')}
  db={query:(sql,args)=>client.query(sql,args),exec:sql=>client.query(sql),close:()=>client.end()};
}else{
  const {PGlite} = await import(process.env.MINUTA_PGLITE_MODULE ? pathToFileURL(process.env.MINUTA_PGLITE_MODULE).href : '@electric-sql/pglite');
  db=new PGlite();
}
const ids = Array.from({length:12},(_,i)=>`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
const [owner,expert,outsider,org,otherOrg,location,service,otherService,templateId,requestId] = ids;
let checks=0;
async function actor(user,fn) {
  await db.exec('begin; set local role authenticated;');
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);
  try { const result = await fn(); await db.exec('commit;'); return result; }
  catch(error) { await db.exec('rollback;'); throw error; }
}
async function value(sql,params=[]) { return (await db.query(sql,params)).rows[0].value; }
const call = (name,args) => value(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) value`,args);
async function denied(user,fn,pattern) { await assert.rejects(()=>actor(user,fn),pattern); checks++; }
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema public,auth to authenticated,anon,service_role;
create table public.organizations(id uuid primary key,status text not null);
create table public.organization_memberships(organization_id uuid,user_id uuid,role text,active boolean,is_bookable boolean);
create table public.locations(id uuid primary key,organization_id uuid,timezone text,active boolean,is_primary boolean);
create table public.services(id uuid primary key,performer_id uuid,name text,duration_minutes integer,active boolean);
`);
await db.query('insert into auth.users values($1),($2),($3)',[owner,expert,outsider]);
await db.query("insert into public.organizations values($1,'active'),($2,'active')",[org,otherOrg]);
await db.query("insert into public.organization_memberships values($1,$2,'owner',true,true),($1,$3,'specialist',true,true),($4,$5,'owner',true,true)",[org,owner,expert,otherOrg,outsider]);
await db.query("insert into public.locations values($1,$2,'Europe/Samara',true,true),($3,$4,'UTC',true,true)",[location,org,ids[10],otherOrg]);
await db.query("insert into public.services values($1,$2,'Массаж спины+швз — углубленный',60,true),($3,$4,'Другая услуга',30,true)",[service,owner,otherService,outsider]);
const source = readFileSync(new URL('../certificate-designer-schema-candidate.sql',import.meta.url),'utf8');
await db.exec(source);
const layout={procedure:{x:.5,y:.671,width:.83,size:.0315,italic:true},date:{x:.213,y:.755,width:.265,size:.023,italic:false},number:{x:.783,y:.755,width:.265,size:.023,italic:false}};
const template={id:templateId,name:'Тестовый макет',image_data:'data:image/png;base64,AAAA',layout,font_files:{}};
await actor(owner,()=>call('save_minuta_certificate_design',[org,template])); checks++;
await actor(owner,()=>call('save_minuta_certificate_design',[org,template]));
assert.equal(await value('select count(*)::integer value from public.certificate_design_templates'),1); checks++;
const ws=await actor(owner,()=>call('get_minuta_certificate_design_workspace',[org]));
assert.equal(ws.services[0].id,service); assert.equal(ws.templates[0].image_data,undefined); checks++;
const today=ws.today;
const record={service_id:service,service_name:'Массаж спины+швз — углубленный',duration_minutes:60,sessions:1,
  procedure:'Массаж спины+швз — углубленный (1 час/1 сеанс)',issued_on:today,expires_on:today,
  number:'267',remind_days:7,font_family:'Times New Roman',template_id:templateId,layout};
const created=await actor(owner,()=>call('record_minuta_certificate_issue',[org,record,requestId]));
const replay=await actor(owner,()=>call('record_minuta_certificate_issue',[org,record,requestId]));
assert.equal(created.record.id,replay.record.id); assert.equal(await value('select count(*)::integer value from public.certificate_design_issues'),1); checks++;
await denied(owner,()=>call('record_minuta_certificate_issue',[org,{...record,sessions:3},requestId]),/certificate_request_conflict/);
await denied(owner,()=>call('record_minuta_certificate_issue',[org,record,ids[11]]),/certificate_number_exists/);
await denied(outsider,()=>call('get_minuta_certificate_design_workspace',[org]),/certificate_access_denied/);
await denied(outsider,()=>call('get_minuta_certificate_design',[otherOrg,templateId]),/certificate_template_not_found/);
assert.equal(await actor(expert,()=>value('select count(*)::integer value from public.certificate_design_issues')),0); checks++;
assert.equal(await actor(outsider,()=>value('select count(*)::integer value from public.certificate_design_issues')),0); checks++;
await denied(expert,()=>call('get_minuta_certificate_design',[org,templateId]),/certificate_template_not_found/);
await denied(owner,()=>call('record_minuta_certificate_issue',[org,{...record,number:'268',service_id:otherService},ids[11]]),/invalid_certificate_service/);
await denied(owner,()=>call('record_minuta_certificate_issue',[org,{...record,number:'268',font_family:'History Pro 02'},ids[11]]),/certificate_template_not_found/);
await denied(owner,()=>call('save_minuta_certificate_design',[org,{...template,id:ids[11],image_data:'data:text/html;base64,AAAA'}]),/invalid_certificate_template/);
await denied(owner,()=>call('save_minuta_certificate_design',[org,{...template,id:ids[11],layout:{...layout,date:{...layout.date,width:1}}}]),/invalid_certificate_template/);
const history=await actor(owner,()=>call('get_minuta_certificate_issue_history',[org,'267','expiring',null]));
assert.equal(history.records.length,1); assert.equal(history.expiring_count,1); checks++;
assert.equal((await actor(owner,()=>call('get_minuta_certificate_issue_history',[org,'%','all',null]))).records.length,0); checks++;
const expired=(await db.query("select ($1::date-1)::text as expired_date",[today])).rows[0].expired_date;
await db.query("insert into public.certificate_design_issues(organization_id,creator_id,template_id,request_id,certificate_number,record,issued_on,expires_on,remind_days) values($1,$2,$3,gen_random_uuid(),'266',$4,$5::date,$5::date,7)",[org,owner,templateId,{...record,number:'266',issued_on:expired,expires_on:expired},expired]);
assert.equal((await actor(owner,()=>call('get_minuta_certificate_issue_history',[org,'','expired',null]))).records.length,1); checks++;
await db.query("update public.organization_memberships set active=false where user_id=$1",[owner]);
await denied(owner,()=>call('get_minuta_certificate_design_workspace',[org]),/certificate_access_denied/);
assert.equal(await actor(owner,()=>value('select count(*)::integer value from public.certificate_design_issues')),0); checks++;
await db.query("update public.organization_memberships set active=true where user_id=$1",[owner]);
await db.query("insert into public.certificate_design_issues(organization_id,creator_id,template_id,request_id,certificate_number,record,issued_on,expires_on,remind_days) select $1,$2,$3,gen_random_uuid(),'page-'||n,$4::jsonb||jsonb_build_object('number','page-'||n),$5::date,$5::date,7 from generate_series(1,52) n",[org,owner,templateId,record,today]);
const first=await actor(owner,()=>call('get_minuta_certificate_issue_history',[org,'page-','all',null]));
const second=await actor(owner,()=>call('get_minuta_certificate_issue_history',[org,'page-','all',first.next_cursor]));
assert.equal(first.records.length,50); assert.equal(second.records.length,2); assert.equal(new Set([...first.records,...second.records].map(r=>r.id)).size,52); checks++;
await db.exec(readFileSync(new URL('../certificate-designer-rollback-candidate.sql',import.meta.url),'utf8'));
await denied(owner,()=>call('get_minuta_certificate_design_workspace',[org]),/permission denied/);
assert.equal(await value('select count(*)::integer value from public.certificate_design_issues'),54); checks++;
await db.exec(source);
assert.equal((await actor(owner,()=>call('get_minuta_certificate_issue_history',[org,'267','all',null]))).records.length,1); checks++;
if(native){
  const left=await newNativeClient(),right=await newNativeClient();
  try{
    for(const connection of [left,right]){await connection.query('begin; set local role authenticated');await connection.query("select set_config('request.jwt.claim.sub',$1,true)",[owner])}
    const rightPid=(await right.query('select pg_backend_pid() pid')).rows[0].pid;
    const concurrentRequest=ids[11], concurrentRecord={...record,number:'concurrent-1'};
    const first=(await left.query('select public.record_minuta_certificate_issue($1,$2,$3) value',[org,concurrentRecord,concurrentRequest])).rows[0].value;
    const pending=right.query('select public.record_minuta_certificate_issue($1,$2,$3) value',[org,concurrentRecord,concurrentRequest]);
    let waiting=false;
    for(let attempt=0;attempt<30&&!waiting;attempt++){
      waiting=(await db.query("select coalesce(bool_or(wait_event='advisory'),false) waiting from pg_stat_activity where pid=$1",[rightPid])).rows[0].waiting;
      if(!waiting)await new Promise(resolve=>setTimeout(resolve,50));
    }
    assert.equal(waiting,true);checks++;
    await left.query('commit');const second=(await pending).rows[0].value;await right.query('commit');assert.equal(first.record.id,second.record.id);checks++;
    assert.equal(await value("select count(*)::integer value from public.certificate_design_issues where certificate_number='concurrent-1'"),1);checks++;
  }finally{await left.query('rollback');await right.query('rollback');await left.end();await right.end()}
}
await denied(owner,()=>db.query('delete from public.certificate_design_issues'),/permission denied/);
console.log(`Certificate ${native?'native PostgreSQL synthetic':'isolated PGlite'} database checks: ${checks} PASS. Full production-schema proof is separate.`);
await db.close();
