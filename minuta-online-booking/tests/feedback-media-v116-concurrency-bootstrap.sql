\set ON_ERROR_STOP on
-- Synthetic dependencies only. Actual feedback schema/RPCs come from v109+v116.
-- No real Storage HTTP server, JWT verification or production data is present.
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create schema storage;
create schema extensions;
create function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function storage.foldername(text) returns text[] language sql immutable as
$$ select string_to_array($1,'/') $$;
grant usage on schema auth,storage,public to anon,authenticated,service_role;
create table auth.users(id uuid primary key);
create table public.organizations(id uuid primary key,status text not null);
create table public.organization_memberships(organization_id uuid,user_id uuid,active boolean);
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),
  name text,metadata jsonb,unique(bucket_id,name));
alter table storage.objects enable row level security;
grant select,insert,update,delete on storage.objects to anon,authenticated,service_role;
insert into auth.users select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,8) n;

-- Test-only coordination schema; never included in any migration.
create schema media_test;
create table media_test.gates(name text primary key,released boolean not null default false);
revoke all on schema media_test from public;
grant usage on schema media_test to authenticated,service_role;
create function media_test.wait_gate(p_name text) returns void
language plpgsql volatile security definer set search_path='' as $$
declare deadline timestamptz:=clock_timestamp()+interval '60 seconds';
begin
  loop
    if (select released from media_test.gates where name=p_name) then return; end if;
    if clock_timestamp()>deadline then raise exception 'synthetic_barrier_timeout'; end if;
    perform pg_sleep(0.05);
  end loop;
end $$;
revoke all on function media_test.wait_gate(text) from public;
grant execute on function media_test.wait_gate(text) to authenticated,service_role;
create function media_test.assert_true(value boolean,label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'synthetic assertion: %',label; end if; end $$;
revoke all on function media_test.assert_true(boolean,text) from public;
