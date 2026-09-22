import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

const { PGlite } = await import(process.env.MINUTA_PGLITE_MODULE
  ? pathToFileURL(process.env.MINUTA_PGLITE_MODULE).href : '@electric-sql/pglite');
const root = fileURLToPath(new URL('../', import.meta.url));
const read = name => readFileSync(root + name, 'utf8').replace(/^\\set.*$/mg, '');
const db = new PGlite();

await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema storage; create schema extensions;
create function extensions.digest(data bytea,kind text) returns bytea language sql immutable as $$
  select decode(md5(encode(data,'hex'))||md5(encode(data,'hex')||kind),'hex')
$$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth,storage,public to authenticated,anon,service_role;
create table auth.users(id uuid primary key);
create table public.organizations(id uuid primary key,status text not null default 'active');
create table public.organization_memberships(organization_id uuid,user_id uuid,role text,is_bookable boolean default true,active boolean,primary key(organization_id,user_id));
create table public.services(id uuid primary key,name text);
create table public.bookings(id uuid primary key,organization_id uuid,performer_id uuid,client_phone text,service_id uuid,booking_date date,booking_time time,status text not null default 'confirmed');
create table public.booking_outcomes(booking_id uuid primary key,visit_status text not null);
create table public.organization_imported_clients(organization_id uuid,normalized_phone text);
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb,unique(bucket_id,name));
alter table storage.objects enable row level security;
grant select,insert,update,delete on storage.objects to authenticated,anon;
insert into auth.users values('00000000-0000-4000-8000-000000000001');
insert into public.organizations values('00000000-0000-4000-8000-000000000010','active');
insert into public.organization_memberships values('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000001','owner',true,true);
insert into public.services values('00000000-0000-4000-8000-000000000100','Fixture service');
insert into public.bookings values('00000000-0000-4000-8000-000000001000','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000001','79990000112','00000000-0000-4000-8000-000000000100',current_date-interval '13 months','10:00','confirmed');
insert into public.booking_outcomes values('00000000-0000-4000-8000-000000001000','completed');
`);
const normalize = read('supabase-migration-v54.sql').match(/create or replace function public\.normalize_client_phone[\s\S]*?\$\$;/)[0];
const role = read('supabase-migration-v89.sql').match(/create or replace function public\.get_minuta_client_field_role[\s\S]*?\$\$;/)[0];
await db.exec(normalize);
await db.exec(role);
await db.exec(read('supabase-migration-v112.sql'));
await db.exec(read('supabase-migration-v120.sql'));

const migration = read('supabase-migration-v171.sql');
const rollback = read('supabase-migration-v171-rollback.sql');
await db.exec(migration);
await db.exec(migration);
assert.equal((await db.query("select enabled from public.client_result_retention_policy where singleton")).rows[0].enabled, false);
await db.exec(rollback);
assert.equal((await db.query("select to_regprocedure('public.claim_minuta_client_result_retention_v171(integer,boolean)') is null missing")).rows[0].missing, true);
await db.exec(migration);

await db.exec(`
insert into public.client_result_series(
  id,organization_id,client_phone,booking_id,booking_was_linked,booking_performer_id,
  visit_label,service_label,created_by,updated_by,last_request_by,last_request_id
) values(
  '00000000-0171-4000-8000-000000000001','00000000-0000-4000-8000-000000000010','79990000112',
  '00000000-0000-4000-8000-000000001000',true,'00000000-0000-4000-8000-000000000001',
  'Старый завершённый визит','Fixture service','00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','00000000-0171-4000-8000-000000000099'
);
insert into public.client_record_entries(
  id,organization_id,client_phone,booking_id,booking_was_linked,booking_performer_id,visit_label,
  kind,file_name,mime_type,byte_size,object_path,ready,archived,created_by
) values
('00000000-0171-4000-8000-000000000002','00000000-0000-4000-8000-000000000010','79990000112',
 '00000000-0000-4000-8000-000000001000',true,'00000000-0000-4000-8000-000000000001','Старый визит',
 'file','before.webp','image/webp',4,'org/before.webp',true,false,'00000000-0000-4000-8000-000000000001'),
('00000000-0171-4000-8000-000000000003','00000000-0000-4000-8000-000000000010','79990000112',
 '00000000-0000-4000-8000-000000001000',true,'00000000-0000-4000-8000-000000000001','Общий файл',
 'file','document.webp','image/webp',4,'org/document.webp',true,false,'00000000-0000-4000-8000-000000000001');
insert into public.client_result_assets(result_id,record_entry_id,purpose,created_by)
values('00000000-0171-4000-8000-000000000001','00000000-0171-4000-8000-000000000002','before','00000000-0000-4000-8000-000000000001');
insert into storage.objects(bucket_id,name,metadata) values('minuta-client-records','org/before.webp','{"size":4}');
`);

let dry = (await db.query("select public.claim_minuta_client_result_retention_v171(100,false) value")).rows[0].value;
assert.equal(dry.length, 1, 'only a before/after result asset is eligible');
await assert.rejects(() => db.query("select public.claim_minuta_client_result_retention_v171(100,true)"), /client_result_retention_disabled/);

await db.exec("select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false); set role authenticated;");
let kept = (await db.query("select public.set_minuta_client_result_media_keep_v171('00000000-0171-4000-8000-000000000002',true) value")).rows[0].value;
assert.equal(kept.keep_from_cleanup, true);
await db.exec('reset role');
dry = (await db.query("select public.claim_minuta_client_result_retention_v171(100,false) value")).rows[0].value;
assert.equal(dry.length, 0, 'explicit keep excludes the photo');
await db.exec("select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false); set role authenticated;");
await db.query("select public.set_minuta_client_result_media_keep_v171('00000000-0171-4000-8000-000000000002',false)");
await db.exec('reset role');

await db.exec("update public.client_result_retention_policy set enabled=true,updated_at=now() where singleton");
let claimed = (await db.query("select public.claim_minuta_client_result_retention_v171(100,true) value")).rows[0].value;
assert.equal(claimed.length, 0, 'first execute pass starts the one-hour grace period only');
await db.exec("update public.client_result_assets set retention_claimed_at=now()-interval '2 hours'");
claimed = (await db.query("select public.claim_minuta_client_result_retention_v171(100,true) value")).rows[0].value;
assert.equal(claimed.length, 1);
const token = claimed[0].claim_token;
const authorized = (await db.query(`select public.authorize_minuta_client_result_retention_delete_v171('00000000-0171-4000-8000-000000000002','${token}') value`)).rows[0].value;
assert.equal(authorized.object_path, 'org/before.webp');
await db.exec("delete from storage.objects where bucket_id='minuta-client-records' and name='org/before.webp'");
const finished = (await db.query(`select public.finish_minuta_client_result_retention_v171('00000000-0171-4000-8000-000000000002','${token}') value`)).rows[0].value;
assert.equal(finished, true);
assert.equal((await db.query("select count(*)::int count from public.client_result_assets")).rows[0].count, 0);
assert.equal((await db.query("select count(*)::int count from public.client_record_entries where id='00000000-0171-4000-8000-000000000003'")).rows[0].count, 1, 'generic file remains');
assert.equal((await db.query("select count(*)::int count from public.client_result_retention_audit")).rows[0].count, 1);
await assert.rejects(() => db.exec(rollback), /v171_rollback_blocked_retention_state_exists/);

console.log('Client result retention v171 PGlite: PASS');
await db.close();
