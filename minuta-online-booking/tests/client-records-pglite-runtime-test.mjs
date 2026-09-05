import { fileURLToPath, pathToFileURL } from 'node:url';
const { PGlite } = await import(process.env.MINUTA_PGLITE_MODULE
  ? pathToFileURL(process.env.MINUTA_PGLITE_MODULE).href
  : '@electric-sql/pglite');
import { readFileSync } from 'node:fs';
const root = fileURLToPath(new URL('../', import.meta.url));
const db = new PGlite();
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
grant select,insert,update,delete on storage.objects to authenticated,anon;
insert into auth.users values('00000000-0000-4000-8000-000000000001');
insert into public.organizations values('00000000-0000-4000-8000-000000000010','active');
insert into public.organization_memberships values('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000001','owner',true);
insert into public.services values('00000000-0000-4000-8000-000000000100','Fixture');
insert into public.bookings values('00000000-0000-4000-8000-000000001000','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000001','79990000112','00000000-0000-4000-8000-000000000100','2026-09-05','10:00');
`);
const normalize = readFileSync(root+'supabase-migration-v54.sql','utf8').match(/create or replace function public\.normalize_client_phone[\s\S]*?\$\$;/)[0];
const role = readFileSync(root+'supabase-migration-v89.sql','utf8').match(/create or replace function public\.get_minuta_client_field_role[\s\S]*?\$\$;/)[0];
await db.exec(normalize); await db.exec(role);
const migration = readFileSync(root+'supabase-migration-v112.sql','utf8');
await db.exec(migration); await db.exec(migration);
console.log('PASS: migration applies twice');
let test = readFileSync(root+'client-records-v112-integration.sql','utf8');
test = test.replace(/^\\set.*$/mg,'').replace(/select b\.id::text as booking,[\s\S]*?\\gset cr_/,'');
const values={org:'00000000-0000-4000-8000-000000000010',owner:'00000000-0000-4000-8000-000000000001',phone:'79990000112',booking:'00000000-0000-4000-8000-000000001000'};
test=test.replace(/:'cr_(\w+)'/g,(_,k)=>`'${values[k]}'`);
await db.exec(test);
console.log('PASS: integration role/RPC/Storage/rollback scenarios');
await db.exec(readFileSync(root+'recovery/rollback-client-records-v112.sql','utf8'));
await db.exec(migration);
console.log('PASS: rollback/reapply');
await db.exec(`begin;
insert into auth.users values('00000000-0000-4000-8000-000000000002');
insert into public.organization_memberships values('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000002','specialist',true);
insert into public.bookings values('00000000-0000-4000-8000-000000002000','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000002','79990000112','00000000-0000-4000-8000-000000000100','2026-09-05','11:00');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.set_minuta_client_records_enabled('00000000-0000-4000-8000-000000000010',true);
select public.create_minuta_client_record('00000000-0000-4000-8000-000000000010','79990000112','00000000-0112-4000-8000-000000000007','00000000-0000-4000-8000-000000001000','note','private visit');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
do $$ begin
 if jsonb_array_length(public.get_minuta_client_records('00000000-0000-4000-8000-000000000010','79990000112')->'entries')<>0 then raise exception 'foreign visit visible'; end if;
 begin perform public.set_minuta_client_records_enabled('00000000-0000-4000-8000-000000000010',false);raise exception 'specialist can enable';exception when insufficient_privilege then null;end;
end $$;
reset role;
delete from public.bookings where id='00000000-0000-4000-8000-000000001000';
set local role authenticated;
do $$ begin
 if jsonb_array_length(public.get_minuta_client_records('00000000-0000-4000-8000-000000000010','79990000112')->'entries')<>0 then raise exception 'deleted visit widened access'; end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $$ begin
 if jsonb_array_length(public.get_minuta_client_records('00000000-0000-4000-8000-000000000010','79990000112')->'entries')<>1 then raise exception 'owner lost deleted visit'; end if;
end $$;
reset role;rollback;`);
console.log('PASS: specialist visit boundaries, opt-in denial, deleted-booking scope retained');
await db.close();
