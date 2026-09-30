-- Disposable PostgreSQL 17 database only. No production schema or data.
create role anon;
create role authenticated;
create role service_role;
create schema auth;
create schema extensions;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as
  $$select nullif(current_setting('test.uid',true),'')::uuid$$;
create table public.organizations(id uuid primary key,status text not null default 'active');
create table public.organization_memberships(
  organization_id uuid,user_id uuid,role text,active boolean not null default true
);
create table public.client_accounts(id uuid primary key);
create table public.bookings(
  id uuid primary key,organization_id uuid,client_account_id uuid,
  status text not null default 'active',booking_date date not null,booking_time time not null,
  client_name text,client_phone text,created_at timestamptz not null default now()
);
create table public.booking_outcomes(
  booking_id uuid primary key,visit_status text not null default 'scheduled'
);
create function public.resolve_client_identity_session_v155(p_token text)
returns table(session_id uuid,client_account_id uuid,session_scope text,claimed_booking_id uuid,organization_id uuid)
language sql stable as $$
  select null::uuid,null::uuid,'organization'::text,null::uuid,null::uuid where false
$$;
create function public.resolve_client_session(p_token text)
returns table(client_account_id uuid) language sql stable as $$select null::uuid where false$$;

insert into auth.users values('00000000-0000-4000-8000-000000000001');
insert into organizations(id) values('00000000-0000-4000-8000-000000000010');
insert into organization_memberships values(
  '00000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000001','owner',true
);
insert into client_accounts values
  ('00000000-0000-4000-8000-000000000020'),
  ('00000000-0000-4000-8000-000000000021'),
  ('00000000-0000-4000-8000-000000000022'),
  ('00000000-0000-4000-8000-000000000023');
