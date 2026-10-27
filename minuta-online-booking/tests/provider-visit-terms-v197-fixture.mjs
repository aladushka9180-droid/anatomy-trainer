export const ids = { actor:'00000000-0000-4000-8000-000000000197', outsider:'00000000-0000-4000-8000-000000000198',
  organization:'00000000-0000-4000-8000-000000000199', service:'00000000-0000-4000-8000-000000000200' };
export const fixtureSQL = `
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema extensions;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema public,auth,extensions to authenticated,anon,service_role;
-- Real PG SHA-256, not a hash stand-in. v156 uses the extension-qualified signature.
create function extensions.digest(value bytea,algorithm text) returns bytea language sql immutable as $$
  select case when algorithm='sha256' then pg_catalog.sha256(value) else null end $$;
create table public.performer_profiles(id uuid primary key);
create table public.services(id uuid primary key,performer_id uuid not null,name text not null,
  duration_minutes integer not null,price_rub integer not null,active boolean not null default true);
create table public.bookings(id uuid primary key default gen_random_uuid(),request_id uuid unique,
  performer_id uuid not null references public.performer_profiles(id),organization_id uuid,
  service_id uuid not null references public.services(id),booking_date date not null,booking_time time not null,
  duration_minutes integer not null check(duration_minutes between 1 and 480),status text not null default 'confirmed',
  client_phone text not null,updated_at timestamptz not null default now());
create table public.booking_outcomes(booking_id uuid primary key references public.bookings(id) on delete cascade,
  visit_status text not null default 'scheduled',calculated_amount_rub integer);
insert into public.performer_profiles values('${ids.actor}'),('${ids.outsider}');
insert into public.services values('${ids.service}','${ids.actor}','Synthetic minute service',1,20,true);
`;
