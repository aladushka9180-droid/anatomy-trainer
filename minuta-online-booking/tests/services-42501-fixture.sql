-- Synthetic empty database only. Never apply to a populated or remote database.
create role anon;
create role authenticated;
create role service_role;
create schema auth;
create schema extensions;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid
$$;
-- v160 only calls SHA-256; PostgreSQL's built-in hash avoids extension downloads.
create function extensions.digest(value bytea, algorithm text) returns bytea
language sql immutable as $$ select case when algorithm='sha256' then sha256(value) end $$;
create function extensions.gen_random_uuid() returns uuid
language sql volatile as $$ select gen_random_uuid() $$;
create table public.performer_profiles(id uuid primary key);
create table public.services (
  id uuid primary key default gen_random_uuid(),
  performer_id uuid not null references public.performer_profiles(id),
  name text not null,
  duration_minutes integer not null check(duration_minutes between 1 and 480),
  price_rub integer not null check(price_rub >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.performer_profiles values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');
grant usage on schema public, auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant select on public.services to anon;
grant select, insert, update, delete on public.services to authenticated;
alter table public.services enable row level security;
create policy services_owner_insert on public.services for insert to authenticated
  with check (performer_id = (select auth.uid()));
create policy services_owner_update on public.services for update to authenticated
  using (performer_id = (select auth.uid())) with check (performer_id = (select auth.uid()));
create policy services_owner_delete on public.services for delete to authenticated
  using (performer_id = (select auth.uid()));
create policy services_public_read on public.services for select to anon, authenticated
  using (active or performer_id = (select auth.uid()));
