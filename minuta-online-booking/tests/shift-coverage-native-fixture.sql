-- Synthetic PostgreSQL 17 database only. v71 functions are loaded verbatim by the runner.
create role anon;
create role authenticated;
create role service_role;
create schema auth;
create schema extensions;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as
  $$select nullif(current_setting('test.uid',true),'')::uuid$$;

create table public.organizations(id uuid primary key,status text not null default 'active');
create table public.performer_profiles(id uuid primary key);
create table public.organization_memberships(
  organization_id uuid not null,user_id uuid not null,role text not null,
  active boolean not null default true,is_bookable boolean not null default true,
  primary key(organization_id,user_id)
);
create table public.locations(
  id uuid primary key,organization_id uuid not null,active boolean not null default true,
  unique(id,organization_id)
);
create table public.organization_shift_settings(
  organization_id uuid primary key,enabled boolean not null default false,
  enabled_at timestamptz,enabled_by uuid,updated_at timestamptz not null default now()
);
create table public.staff_location_shifts(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null,
  location_id uuid not null,performer_id uuid not null,shift_date date not null,
  start_time time not null,end_time time not null,break_start time,break_end time,
  note text not null default '',active boolean not null default true,
  created_by uuid,updated_at timestamptz not null default now()
);
create table public.staff_absences(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null,
  performer_id uuid not null,starts_on date not null,ends_on date not null,
  active boolean not null default true
);
create table public.staff_schedule_audit_log(
  id bigint generated always as identity primary key,
  organization_id uuid not null,actor_id uuid,action text not null,
  subject_id uuid,details jsonb not null default '{}'::jsonb,created_at timestamptz not null default now()
);
create table public.bookings(
  id uuid primary key default gen_random_uuid(),organization_id uuid,
  location_id uuid,performer_id uuid,booking_date date not null,
  booking_time time not null,duration_minutes integer not null,status text not null default 'active'
);

insert into auth.users values('00000000-0000-4000-8000-000000000001');
insert into organizations values('00000000-0000-4000-8000-000000000010','active');
insert into performer_profiles values('00000000-0000-4000-8000-000000000001');
insert into organization_memberships values(
  '00000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000001','owner',true,true
);
insert into locations values(
  '00000000-0000-4000-8000-000000000020',
  '00000000-0000-4000-8000-000000000010',true
);
