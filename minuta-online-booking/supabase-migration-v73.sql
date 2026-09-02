begin;

set local search_path = public, extensions, pg_catalog;

do $$
begin
  if to_regclass('public.organization_shift_settings') is null
     or to_regclass('public.organization_payroll_settings') is null
     or to_regclass('public.booking_policies') is null
     or to_regclass('public.organizations') is null
     or to_regclass('public.organization_memberships') is null then
    raise exception using errcode = 'P0001', message = 'v73_requires_v72';
  end if;
end;
$$;

alter table public.booking_policies
  add column if not exists visitor_notifications_enabled boolean not null default false;

create table if not exists public.booking_page_visits (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  performer_id uuid not null references public.performer_profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists booking_page_visits_owner_recent_idx
  on public.booking_page_visits (performer_id, created_at desc, id desc);

alter table public.booking_page_visits enable row level security;

drop policy if exists booking_page_visits_owner_read on public.booking_page_visits;
create policy booking_page_visits_owner_read on public.booking_page_visits
  for select to authenticated
  using (performer_id = (select auth.uid()));

revoke all on table public.booking_page_visits from public, anon, authenticated;
grant select on table public.booking_page_visits to authenticated;
grant all on table public.booking_page_visits to service_role;

create or replace function public.register_public_booking_visit(p_slug text)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_organization uuid;
  v_performer uuid;
  v_inserted boolean := false;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9][a-z0-9-]{2,62}$' then
    return false;
  end if;

  select organization.id
  into v_organization
  from public.organizations organization
  where organization.public_slug = p_slug
    and organization.status = 'active'
    and organization.public_booking_enabled
  limit 1;

  if v_organization is null then return false; end if;

  for v_performer in
    select membership.user_id
    from public.organization_memberships membership
    join public.booking_policies policy
      on policy.performer_id = membership.user_id
     and policy.visitor_notifications_enabled
    join public.performer_profiles profile on profile.id = membership.user_id
    where membership.organization_id = v_organization
      and membership.active
      and membership.role in ('owner', 'admin')
    order by membership.user_id
  loop
    -- One notification in two minutes is enough to show live interest and keeps
    -- reloads, several open tabs and automated traffic from flooding each owner.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_performer::text, 72));
    if not exists (
      select 1 from public.booking_page_visits visit
      where visit.performer_id = v_performer
        and visit.created_at >= pg_catalog.now() - interval '2 minutes'
    ) then
      insert into public.booking_page_visits (organization_id, performer_id)
      values (v_organization, v_performer);
      v_inserted := true;

      -- Retain only a short activity history. A visit row contains no client name,
      -- phone number, account, IP address or device identifier.
      delete from public.booking_page_visits visit
      where visit.performer_id = v_performer
        and visit.created_at < pg_catalog.now() - interval '7 days';
    end if;
  end loop;

  return v_inserted;
end;
$$;

revoke all on function public.register_public_booking_visit(text)
  from public, anon, authenticated, service_role;
grant execute on function public.register_public_booking_visit(text) to anon, authenticated;
grant execute on function public.register_public_booking_visit(text) to service_role;

do $$
begin
  alter publication supabase_realtime add table public.booking_page_visits;
exception when duplicate_object then null;
end;
$$;

commit;
