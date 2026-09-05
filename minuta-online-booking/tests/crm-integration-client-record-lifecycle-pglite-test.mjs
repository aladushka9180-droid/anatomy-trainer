import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { PGlite } = await import(process.env.MINUTA_PGLITE_MODULE
  ? pathToFileURL(process.env.MINUTA_PGLITE_MODULE).href
  : '@electric-sql/pglite');
const root = fileURLToPath(new URL('../', import.meta.url));
const db = new PGlite();

const ids = Object.freeze({
  owner:'00000000-0000-4000-8000-000000000001',
  organization:'00000000-0000-4000-8000-000000000010',
  old:'00000000-0112-4000-8000-000000001001',
  object:'00000000-0112-4000-8000-000000001002',
  recent:'00000000-0112-4000-8000-000000001003',
  ready:'00000000-0112-4000-8000-000000001004',
  archivedReady:'00000000-0112-4000-8000-000000001005',
  archivedPending:'00000000-0112-4000-8000-000000001006',
  grace:'00000000-0112-4000-8000-000000001007',
  retry:'00000000-0112-4000-8000-000000001008',
  fair:'00000000-0112-4000-8000-000000001009',
  note:'00000000-0112-4000-8000-000000001010',
  missing:'00000000-0112-4000-8000-000000009999'
});
const objectPath = id => `${ids.organization}/${id}.pdf`;
const sqlString = value => `'${String(value).replaceAll("'", "''")}'`;

async function scalar(sql, key) {
  const result = await db.query(sql);
  return result.rows[0]?.[key];
}
async function asRole(role, callback) {
  await db.exec(`set role ${role}`);
  try { return await callback(); }
  finally { await db.exec('reset role'); }
}
async function asOwner(callback) {
  await db.exec(`select set_config('request.jwt.claim.sub',${sqlString(ids.owner)},false)`);
  return asRole('authenticated',callback);
}
const jsonIds = value => new Set((Array.isArray(value) ? value : JSON.parse(value || '[]')).map(row => row.id));
const fileValues = ({id,ready=false,archived=false,created="now()-interval '8 days'",expired='null',attempted='null'}) => `(
  ${sqlString(id)},${sqlString(ids.organization)},'79990000112','file','',${sqlString(`${id}.pdf`)},'application/pdf',12,
  ${sqlString(objectPath(id))},${ready},${archived},${sqlString(ids.owner)},${created},${expired},${attempted}
)`;

await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema storage; create schema extensions;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth,storage,public to authenticated,anon,service_role;
create table auth.users(id uuid primary key);
create table public.organizations(id uuid primary key,status text not null default 'active');
create table public.organization_memberships(organization_id uuid,user_id uuid,role text,active boolean,primary key(organization_id,user_id));
create table public.services(id uuid primary key,name text);
create table public.bookings(id uuid primary key,organization_id uuid,performer_id uuid,client_phone text,service_id uuid,booking_date date,booking_time time);
create table public.organization_imported_clients(organization_id uuid,normalized_phone text);
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb,unique(bucket_id,name));
alter table storage.objects enable row level security;
grant select,insert,update,delete on storage.objects to authenticated,anon,service_role;
insert into auth.users values(${sqlString(ids.owner)});
insert into public.organizations values(${sqlString(ids.organization)},'active');
insert into public.organization_memberships values(${sqlString(ids.organization)},${sqlString(ids.owner)},'owner',true);
insert into public.organization_imported_clients values(${sqlString(ids.organization)},'79990000112');
`);
const normalize = readFileSync(root+'supabase-migration-v54.sql','utf8').match(/create or replace function public\.normalize_client_phone[\s\S]*?\$\$;/)[0];
const role = readFileSync(root+'supabase-migration-v89.sql','utf8').match(/create or replace function public\.get_minuta_client_field_role[\s\S]*?\$\$;/)[0];
await db.exec(normalize);await db.exec(role);
const migration = readFileSync(root+'supabase-migration-v112.sql','utf8');
await db.exec(migration);await db.exec(migration);

assert.equal(await scalar(`select has_function_privilege('authenticated','public.claim_expired_minuta_client_records(integer,boolean)','EXECUTE') allowed`,'allowed'),false);
assert.equal(await scalar(`select has_function_privilege('anon','public.finish_expired_minuta_client_record(uuid)','EXECUTE') allowed`,'allowed'),false);
assert.equal(await scalar(`select has_function_privilege('service_role','public.claim_expired_minuta_client_records(integer,boolean)','EXECUTE') allowed`,'allowed'),true);
assert.equal(await scalar(`select provolatile from pg_proc where oid='public.can_use_minuta_client_object(text,text)'::regprocedure`,'provolatile'),'v','upload lock guard must remain volatile');

await db.exec(`
insert into public.client_record_settings(organization_id,enabled,updated_by) values(${sqlString(ids.organization)},true,${sqlString(ids.owner)});
insert into public.client_record_entries(id,organization_id,client_phone,kind,body,file_name,mime_type,byte_size,object_path,ready,archived,created_by,created_at,expired_at,cleanup_attempted_at) values
${fileValues({id:ids.old})},
${fileValues({id:ids.object,expired:"now()-interval '2 hours'",attempted:"now()-interval '2 hours'"})},
${fileValues({id:ids.recent,created:"now()-interval '6 days'"})},
${fileValues({id:ids.ready,ready:true})},
${fileValues({id:ids.archivedReady,ready:true,archived:true})},
${fileValues({id:ids.archivedPending,archived:true})},
${fileValues({id:ids.grace,expired:"now()-interval '30 minutes'"})},
${fileValues({id:ids.retry,expired:"now()-interval '2 hours'",attempted:"now()-interval '10 minutes'"})},
${fileValues({id:ids.fair,expired:"now()-interval '2 hours'",attempted:'null'})},
(${sqlString(ids.note)},${sqlString(ids.organization)},'79990000112','note','private note','',null,null,null,true,false,${sqlString(ids.owner)},now()-interval '8 days',null,null);
insert into storage.objects(bucket_id,name,metadata) values
('minuta-client-records',${sqlString(objectPath(ids.object))},'{"size":"12","mimetype":"application/pdf"}'),
('minuta-client-records',${sqlString(objectPath(ids.ready))},'{"size":"12","mimetype":"application/pdf"}'),
('minuta-client-records',${sqlString(objectPath(ids.archivedReady))},'{"size":"12","mimetype":"application/pdf"}');
`);

const beforeDryRun = await scalar(`select count(*)::int count from public.client_record_entries where expired_at is not null`,'count');
const dryRun = await asRole('service_role',()=>scalar(`select public.claim_expired_minuta_client_records(100,false) result`,'result'));
const dryIds = jsonIds(dryRun);
for(const id of [ids.old,ids.object,ids.archivedPending,ids.grace,ids.retry,ids.fair]) assert.equal(dryIds.has(id),true,`dry-run omitted ${id}`);
for(const id of [ids.recent,ids.ready,ids.archivedReady,ids.note]) assert.equal(dryIds.has(id),false,`dry-run targeted protected row ${id}`);
assert.equal(await scalar(`select count(*)::int count from public.client_record_entries where expired_at is not null`,'count'),beforeDryRun,'dry-run changed expired_at');
assert.equal(await scalar(`select count(*)::int count from public.client_record_entries where cleanup_attempted_at is not null`,'count'),2,'dry-run changed cleanup attempts');

const firstExecute = await asRole('service_role',()=>scalar(`select public.claim_expired_minuta_client_records(100,true) result`,'result'));
const firstIds = jsonIds(firstExecute);
for(const id of [ids.object,ids.retry,ids.fair]) assert.equal(firstIds.has(id),true,`mature retry omitted ${id}`);
for(const id of [ids.old,ids.archivedPending,ids.grace]) assert.equal(firstIds.has(id),false,`first mark/grace leaked to worker ${id}`);
assert.equal(await scalar(`select expired_at is not null marked from public.client_record_entries where id=${sqlString(ids.old)}`,'marked'),true);
assert.equal(await scalar(`select cleanup_attempted_at is not null attempted from public.client_record_entries where id=${sqlString(ids.old)}`,'attempted'),true);
assert.equal(await scalar(`select expired_at is null untouched from public.client_record_entries where id=${sqlString(ids.recent)}`,'untouched'),true);

const retryExecute = await asRole('service_role',()=>scalar(`select public.claim_expired_minuta_client_records(2,true) result`,'result'));
const retryIds = jsonIds(retryExecute);
assert.equal(retryIds.has(ids.object),true,'old failed object did not retry');
assert.equal(retryIds.has(ids.retry),true,'old failed metadata did not retry');
assert.equal(retryIds.has(ids.fair),false,'just-attempted row monopolized the fair queue');
assert.equal(retryIds.has(ids.grace),false,'grace row was returned by execute');

await asOwner(async()=>{
  assert.equal(await scalar(`select public.can_use_minuta_client_object(${sqlString(objectPath(ids.recent))},'upload') allowed`,'allowed'),true);
  assert.equal(await scalar(`select public.can_use_minuta_client_object(${sqlString(objectPath(ids.old))},'upload') allowed`,'allowed'),false);
  await assert.rejects(
    db.exec(`insert into storage.objects(bucket_id,name,metadata) values('minuta-client-records',${sqlString(objectPath(ids.old))},'{"size":"12","mimetype":"application/pdf"}')`),
    /row-level security|violates.*policy/i
  );
  await assert.rejects(
    db.query(`select public.create_minuta_client_record(${sqlString(ids.organization)},'79990000112',${sqlString(ids.old)},null,'file','',${sqlString(`${ids.old}.pdf`)},'application/pdf',12)`),
    /client_record_upload_expired/
  );
  await assert.rejects(db.query(`select public.complete_minuta_client_file(${sqlString(ids.object)})`),/client_record_upload_expired/);
  await db.exec(`insert into storage.objects(bucket_id,name,metadata) values('minuta-client-records',${sqlString(objectPath(ids.recent))},'{"size":"12","mimetype":"application/pdf"}')`);
  const completed = await scalar(`select public.complete_minuta_client_file(${sqlString(ids.recent)}) result`,'result');
  assert.equal(completed.ready,true,'fresh upload did not finalize');
});

assert.equal(await asRole('service_role',()=>scalar(`select public.finish_expired_minuta_client_record(${sqlString(ids.old)}) result`,'result')),false,'fresh claim bypassed one-hour grace');
assert.equal(await asRole('service_role',()=>scalar(`select public.finish_expired_minuta_client_record(${sqlString(ids.object)}) result`,'result')),false,'metadata was deleted while Storage object still existed');
assert.equal(await asRole('service_role',()=>scalar(`select public.finish_expired_minuta_client_record(${sqlString(ids.ready)}) result`,'result')),false,'ready file became a cleanup target');
assert.equal(await asRole('service_role',()=>scalar(`select public.finish_expired_minuta_client_record(${sqlString(ids.archivedReady)}) result`,'result')),false,'archived ready file became a cleanup target');
assert.equal(await asRole('service_role',()=>scalar(`select public.finish_expired_minuta_client_record(${sqlString(ids.missing)}) result`,'result')),true,'missing metadata was not idempotent');

await db.exec(`
update public.client_record_entries set expired_at=now()-interval '2 hours' where id in (${sqlString(ids.old)},${sqlString(ids.archivedPending)});
delete from storage.objects where bucket_id='minuta-client-records' and name=${sqlString(objectPath(ids.object))};
`);
for(const id of [ids.old,ids.object,ids.archivedPending]) {
  assert.equal(await asRole('service_role',()=>scalar(`select public.finish_expired_minuta_client_record(${sqlString(id)}) result`,'result')),true,`eligible metadata not finished ${id}`);
  assert.equal(await scalar(`select count(*)::int count from public.client_record_entries where id=${sqlString(id)}`,'count'),0);
}
assert.equal(await scalar(`select ready from public.client_record_entries where id=${sqlString(ids.recent)}`,'ready'),true);
assert.equal(await scalar(`select count(*)::int count from public.client_record_entries where id in (${sqlString(ids.ready)},${sqlString(ids.archivedReady)},${sqlString(ids.note)})`,'count'),3);

console.log('PASS: v112 cleanup lifecycle dry-run, TTL/grace, retry fairness, role gates, upload/finalize denial and guarded finish. Concurrency locking is reviewed separately, not claimed by this single-session PGlite test.');
await db.close();
