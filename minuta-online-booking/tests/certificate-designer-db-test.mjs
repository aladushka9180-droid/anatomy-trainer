import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
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
const ids = Array.from({length:32},(_,i)=>`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
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
create table public.client_accounts(id uuid primary key,normalized_phone text unique);
create table public.bookings(id uuid primary key,organization_id uuid,performer_id uuid,client_phone text,client_name text,client_account_id uuid,created_at timestamptz default now());
create table public.organization_imported_clients(organization_id uuid,normalized_phone text,client_name text,updated_at timestamptz default now());
create table public.client_benefit_instruments(id uuid primary key,organization_id uuid,client_account_id uuid,status text,product_snapshot jsonb,remaining_visits integer,expires_on date,issued_at timestamptz default now());
create function public.normalize_client_phone(value text) returns text language sql immutable as $$select regexp_replace(value,'[^0-9]','','g')$$;
create function public.can_access_minuta_client_record(p_org uuid,p_phone text,p_booking uuid default null) returns boolean language sql stable security definer set search_path='' as $$
select auth.uid() is not null and coalesce(p_phone ~ '^7[0-9]{10}$',false) and exists(select 1 from public.organization_memberships m join public.organizations o on o.id=m.organization_id and o.status='active'
where m.organization_id=p_org and m.user_id=auth.uid() and m.active and (exists(select 1 from public.bookings b where b.organization_id=p_org and public.normalize_client_phone(b.client_phone)=p_phone and (p_booking is null or b.id=p_booking) and (m.role in ('owner','admin') or b.performer_id=auth.uid()))
or (p_booking is null and m.role in ('owner','admin') and exists(select 1 from public.organization_imported_clients c where c.organization_id=p_org and c.normalized_phone=p_phone))))$$;
`);
await db.query('insert into auth.users values($1),($2),($3)',[owner,expert,outsider]);
await db.query("insert into public.organizations values($1,'active'),($2,'active')",[org,otherOrg]);
await db.query("insert into public.organization_memberships values($1,$2,'owner',true,true),($1,$3,'specialist',true,true),($4,$5,'owner',true,true)",[org,owner,expert,otherOrg,outsider]);
await db.query("insert into public.locations values($1,$2,'Europe/Samara',true,true),($3,$4,'UTC',true,true)",[location,org,ids[10],otherOrg]);
await db.query("insert into public.services values($1,$2,'Массаж спины+швз — углубленный',60,true),($3,$4,'Другая услуга',30,true)",[service,owner,otherService,outsider]);
await db.query("insert into public.client_accounts values($1,'79990000001'),($2,'79990000002'),($3,'79990000003')",[ids[12],ids[13],ids[14]]);
await db.query("insert into public.bookings(id,organization_id,performer_id,client_phone,client_name,client_account_id) values($1,$2,$3,'79990000001','Анна',$4),($5,$2,$6,'79990000002','Борис',$7),($8,$9,$10,'79990000003','Другой клиент',$11)",[ids[15],org,owner,ids[12],ids[16],expert,ids[13],ids[17],otherOrg,outsider,ids[14]]);
await db.query("insert into public.organization_imported_clients(organization_id,normalized_phone,client_name) values($1,'79990000004','Импортированный клиент')",[org]);
await db.query("insert into public.client_benefit_instruments(id,organization_id,client_account_id,status,product_snapshot,remaining_visits,expires_on) values($1,$2,$3,'active',$4,2,current_date+1000),($5,$6,$7,'active',$4,2,current_date+1000)",[ids[18],org,ids[12],{name:'Курс',kind:'visit_pass',visits_count:3,services:[{service_id:service}]},ids[19],otherOrg,ids[14]]);
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
const clients=await actor(owner,()=>call('get_minuta_certificate_clients',[org,'']));
assert.equal(clients.clients.length,3);assert.ok(!clients.clients.some(c=>c.phone==='79990000003'));checks++;
assert.deepEqual((await actor(expert,()=>call('get_minuta_certificate_clients',[org,'']))).clients.map(c=>c.phone),['79990000002']);checks++;
await denied(expert,()=>call('get_minuta_certificate_client_options',[org,'79990000001']),/invalid_certificate_client/);
await denied(owner,()=>call('get_minuta_client_certificates',[org,'79990000003',null]),/invalid_certificate_client/);
const linked={...record,number:'client-linked',sessions:3,procedure:'Массаж спины+швз — углубленный (1 час/3 сеанса)',client_phone:'79990000001',client_name:'Анна',client_account_id:ids[12],benefit_instrument_id:ids[18]};
await denied(owner,()=>call('record_minuta_certificate_issue',[org,{...linked,client_phone:'79990000003',client_account_id:ids[14]},ids[20]]),/invalid_certificate_client/);
await denied(owner,()=>call('record_minuta_certificate_issue',[org,{...linked,benefit_instrument_id:ids[19]},ids[20]]),/invalid_certificate_benefit/);
await denied(owner,()=>call('record_minuta_certificate_issue',[org,{...linked,sessions:1},ids[20]]),/invalid_certificate_benefit/);
const options=await actor(owner,()=>call('get_minuta_certificate_client_options',[org,'79990000001']));assert.equal(options.instruments[0].id,ids[18]);checks++;
await actor(owner,()=>call('record_minuta_certificate_issue',[org,linked,ids[20]]));
assert.equal(await value('select remaining_visits value from public.client_benefit_instruments where id=$1',[ids[18]]),2);checks++;
await denied(owner,()=>call('record_minuta_certificate_issue',[org,{...linked,number:'second-linked'},ids[21]]),/certificate_benefit_already_linked/);
assert.equal((await actor(owner,()=>call('get_minuta_certificate_client_options',[org,'79990000001']))).instruments.length,0);checks++;
await db.query('update public.client_benefit_instruments set remaining_visits=1 where id=$1',[ids[18]]);
const card=await actor(owner,()=>call('get_minuta_client_certificates',[org,'79990000001',null]));assert.equal(card.records[0].remaining_visits,1);assert.equal(card.records[0].client_name,'Анна');checks++;
assert.equal((await actor(expert,()=>call('get_minuta_client_certificates',[org,'79990000002',null]))).records.length,0);checks++;
await db.exec(readFileSync(new URL('../certificate-designer-rollback-candidate.sql',import.meta.url),'utf8'));
await denied(owner,()=>call('get_minuta_client_certificates',[org,'79990000001',null]),/permission denied/);
await db.exec(source);assert.equal((await actor(owner,()=>call('get_minuta_client_certificates',[org,'79990000001',null]))).records[0].benefit_instrument_id,ids[18]);checks++;
await db.query("update public.client_accounts set normalized_phone='79990000005' where id=$1",[ids[12]]);await db.query("update public.bookings set client_phone='79990000005' where client_account_id=$1",[ids[12]]);
assert.equal((await actor(owner,()=>call('get_minuta_client_certificates',[org,'79990000005',null]))).records[0].number,'client-linked');checks++;
await denied(owner,()=>db.query('delete from public.certificate_design_issues'),/permission denied/);
// A complete service list remains organization/performer scoped, irrespective of profession.
for(let index=24;index<30;index++)await db.query('insert into public.services values($1,$2,$3,60,true)',[ids[index],index===29?expert:owner,['Маникюр','Стрижка','Фотосессия','Йога','Генеральная уборка','Урок английского'][index-24]]);
const allServices=(await actor(owner,()=>call('get_minuta_certificate_design_workspace',[org]))).services;
assert.equal(allServices.length,7);assert.ok(allServices.some(s=>s.name==='Маникюр'));assert.ok(!allServices.some(s=>s.id===otherService));checks++;
assert.deepEqual((await actor(expert,()=>call('get_minuta_certificate_design_workspace',[org]))).services.map(s=>s.id),[ids[29]]);checks++;
const custom={...record,content_mode:'custom',service_id:null,service_name:null,duration_minutes:null,sessions:null,procedure:'Подарок для тебя\nЛюбая услуга на ваш выбор',number:'custom-1'};
const customIssued=await actor(owner,()=>call('record_minuta_certificate_issue',[org,custom,ids[30]]));
assert.equal(customIssued.record.procedure,custom.procedure);assert.equal(customIssued.record.sessions,null);checks++;
const customReplay=await actor(owner,()=>call('record_minuta_certificate_issue',[org,custom,ids[30]]));assert.equal(customReplay.record.id,customIssued.record.id);checks++;
for(const patch of [{procedure:' \t\r\n '},{procedure:'x'.repeat(261)},{content_mode:'unknown'}])await denied(owner,()=>call('record_minuta_certificate_issue',[org,{...custom,...patch,number:'bad-custom'},ids[31]]),/invalid_certificate/);
for(const patch of [{service_id:service},{sessions:1},{duration_minutes:60},{service_name:'Услуга'}])await denied(owner,()=>call('record_minuta_certificate_issue',[org,{...custom,...patch,number:'bad-custom'},ids[31]]),/invalid_certificate_service/);
await denied(owner,()=>call('record_minuta_certificate_issue',[org,{...custom,benefit_instrument_id:ids[18],number:'bad-custom'},ids[31]]),/invalid_certificate_benefit/);
await denied(owner,()=>call('record_minuta_certificate_issue',[org,{...custom,procedure:'Другой текст'},ids[30]]),/certificate_request_conflict/);
assert.equal((await actor(owner,()=>call('get_minuta_certificate_issue_history',[org,'Любая услуга','all',null]))).records[0].procedure,custom.procedure);checks++;
await db.exec(readFileSync(new URL('../certificate-designer-rollback-candidate.sql',import.meta.url),'utf8'));await db.exec(source);
assert.equal((await actor(owner,()=>call('get_minuta_certificate_issue_history',[org,'custom-1','all',null]))).records[0].content_mode,'custom');checks++;
// Automatic numbers are organization wide; drafts do not reserve or consume one.
const nextBefore=(await actor(owner,()=>call('get_minuta_certificate_design_workspace',[org]))).next_number;
const draftId=randomUUID(),draftRevision=randomUUID(),draftBody={form:{'content-mode':'custom','custom-text':'Незавершённый подарок','number-mode':'auto',number:'',date:'',expiry:'',font:'History Pro 02'},template:{...template,font_files:{}},client:null};
const saveDraft=(id,body,expected,revision)=>call('save_minuta_certificate_draft',[org,id,body,expected,revision]);
const savedDraft=await actor(owner,()=>saveDraft(draftId,draftBody,null,draftRevision));
assert.equal(savedDraft.revision,draftRevision);assert.deepEqual((await actor(owner,()=>call('get_minuta_certificate_draft',[org,draftId]))).body,draftBody);checks++;
await actor(owner,()=>saveDraft(draftId,draftBody,null,draftRevision));assert.equal(await value('select count(*)::integer value from public.certificate_design_drafts'),1);checks++;
assert.equal((await actor(owner,()=>call('get_minuta_certificate_design_workspace',[org]))).next_number,nextBefore);checks++;
const draftList=await actor(owner,()=>call('get_minuta_certificate_drafts',[org,null]));assert.equal(draftList.drafts.length,1);assert.equal(draftList.drafts[0].body,undefined);assert.equal(draftList.drafts[0].image_data,undefined);checks++;
assert.equal((await actor(expert,()=>call('get_minuta_certificate_drafts',[org,null]))).drafts.length,0);checks++;
await denied(expert,()=>call('get_minuta_certificate_draft',[org,draftId]),/certificate_draft_unavailable/);
await denied(expert,()=>saveDraft(draftId,draftBody,draftRevision,randomUUID()),/certificate_draft_unavailable/);
await denied(outsider,()=>call('get_minuta_certificate_drafts',[org,null]),/certificate_access_denied/);
await denied(owner,()=>db.query('select * from public.certificate_design_drafts'),/permission denied/);
await denied(owner,()=>saveDraft(randomUUID(),{...draftBody,template:{...template,image_data:'https://example.com/remote.png'}},null,randomUUID()),/invalid_certificate_draft/);
const newerRevision=randomUUID();await actor(owner,()=>saveDraft(draftId,{...draftBody,form:{...draftBody.form,'custom-text':'Обновлённый подарок'}},draftRevision,newerRevision));checks++;
await denied(owner,()=>saveDraft(draftId,draftBody,draftRevision,randomUUID()),/certificate_draft_conflict/);
await denied(owner,()=>saveDraft(draftId,draftBody,newerRevision,newerRevision),/certificate_draft_conflict/);
const auto={...custom,number_mode:'auto',number:nextBefore,draft_id:draftId,draft_revision:newerRevision},autoRequest=randomUUID();
await denied(owner,()=>call('record_minuta_certificate_issue',[org,{...auto,draft_revision:draftRevision},randomUUID()]),/certificate_draft_conflict/);
const autoIssued=await actor(owner,()=>call('record_minuta_certificate_issue',[org,auto,autoRequest]));assert.equal(autoIssued.record.number,nextBefore);checks++;
assert.equal((await actor(owner,()=>call('get_minuta_certificate_drafts',[org,null]))).drafts.length,0);checks++;
await denied(owner,()=>call('get_minuta_certificate_draft',[org,draftId]),/certificate_draft_unavailable/);
await denied(owner,()=>saveDraft(draftId,draftBody,newerRevision,randomUUID()),/certificate_draft_unavailable/);
const autoAgain=await actor(owner,()=>call('record_minuta_certificate_issue',[org,auto,autoRequest]));assert.equal(autoAgain.record.id,autoIssued.record.id);checks++;
await denied(owner,()=>call('record_minuta_certificate_issue',[org,{...auto,procedure:'Изменён'},autoRequest]),/certificate_request_conflict/);
const autoSecond=await actor(owner,()=>call('record_minuta_certificate_issue',[org,{...custom,number_mode:'auto',number:'1'},randomUUID()]));assert.equal(BigInt(autoSecond.record.number),BigInt(nextBefore)+1n);checks++;
const nextAfter=(await actor(owner,()=>call('get_minuta_certificate_design_workspace',[org]))).next_number;
await denied(owner,()=>call('record_minuta_certificate_issue',[org,{...custom,number_mode:'auto',procedure:' '},randomUUID()]),/invalid_certificate/);
assert.equal((await actor(owner,()=>call('get_minuta_certificate_design_workspace',[org]))).next_number,nextAfter);checks++;
// A high manual decimal number (including leading zeroes) advances the automatic sequence.
await actor(owner,()=>call('record_minuta_certificate_issue',[org,{...custom,number:'0009000'},randomUUID()]));
assert.equal((await actor(owner,()=>call('get_minuta_certificate_design_workspace',[org]))).next_number,'9001');checks++;
if(native){
  const expertTemplate={...template,id:randomUUID()};await actor(expert,()=>call('save_minuta_certificate_design',[org,expertTemplate]));
  for(const firstMode of ['auto','manual']){
    const left=await newNativeClient(),right=await newNativeClient();
    try{
      for(const [connection,user] of [[left,owner],[right,expert]]){await connection.query('begin; set local role authenticated');await connection.query("select set_config('request.jwt.claim.sub',$1,true)",[user])}
      const rightPid=(await right.query('select pg_backend_pid() pid')).rows[0].pid;
      const suggestion=(await actor(owner,()=>call('get_minuta_certificate_design_workspace',[org]))).next_number;
      const firstRecord={...custom,number:suggestion,...(firstMode==='auto'?{number_mode:'auto'}:{})};
      const first=(await left.query('select public.record_minuta_certificate_issue($1,$2,$3) value',[org,firstRecord,randomUUID()])).rows[0].value;
      const request=randomUUID(),submitted={...custom,template_id:expertTemplate.id,number:suggestion,number_mode:'auto'};
      const pending=right.query('select public.record_minuta_certificate_issue($1,$2,$3) value',[org,submitted,request]);
      let waiting=false;for(let attempt=0;attempt<30&&!waiting;attempt++){waiting=(await db.query("select coalesce(bool_or(wait_event='advisory'),false) waiting from pg_stat_activity where pid=$1",[rightPid])).rows[0].waiting;if(!waiting)await new Promise(resolve=>setTimeout(resolve,50));}
      assert.equal(waiting,true);checks++;await left.query('commit');const second=(await pending).rows[0].value;await right.query('commit');
      assert.equal(BigInt(second.record.number),BigInt(first.record.number)+1n);checks++;
      assert.equal((await actor(expert,()=>call('record_minuta_certificate_issue',[org,submitted,request]))).record.number,second.record.number);checks++;
    }finally{await left.query('rollback');await right.query('rollback');await left.end();await right.end()}
  }
}
const retainedDraft=randomUUID(),retainedRevision=randomUUID();await actor(owner,()=>saveDraft(retainedDraft,draftBody,null,retainedRevision));
await db.exec(readFileSync(new URL('../certificate-designer-rollback-candidate.sql',import.meta.url),'utf8'));
await denied(owner,()=>call('get_minuta_certificate_drafts',[org,null]),/permission denied/);
await db.exec(source);assert.deepEqual((await actor(owner,()=>call('get_minuta_certificate_draft',[org,retainedDraft]))).body,draftBody);checks++;
await actor(owner,()=>call('record_minuta_certificate_issue',[org,{...custom,number:'9'.repeat(40)},randomUUID()]));
await denied(owner,()=>call('record_minuta_certificate_issue',[org,{...custom,number:'1',number_mode:'auto'},randomUUID()]),/certificate_number_exhausted/);
console.log(`Certificate ${native?'native PostgreSQL synthetic':'isolated PGlite'} database checks: ${checks} PASS. Full production-schema proof is separate.`);
await db.close();
