begin;

-- v65 is an additive foundation for organizations and teams.
-- It intentionally does not alter legacy business tables, RPCs or RLS policies.
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  public_slug text not null default ('org-' || replace(gen_random_uuid()::text, '-', ''))
    check (public_slug ~ '^[a-z0-9][a-z0-9-]{2,62}$'),
  status text not null default 'active' check (status in ('active', 'suspended')),
  public_booking_enabled boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  legacy_performer_id uuid unique references public.performer_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (public_slug)
);

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 120),
  timezone text not null default 'Europe/Samara' check (char_length(timezone) between 1 and 80),
  address text not null default '' check (char_length(address) <= 500),
  active boolean not null default true,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);

create unique index if not exists locations_one_primary_per_org_idx
  on public.locations (organization_id)
  where is_primary;

create table if not exists public.organization_memberships (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'specialist')),
  is_bookable boolean not null default false,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index if not exists organization_memberships_active_user_idx
  on public.organization_memberships (user_id)
  where active;

create index if not exists organization_memberships_active_role_idx
  on public.organization_memberships (organization_id, role)
  where active;

create or replace function public.touch_minuta_organization_updated_at()
returns trigger
language plpgsql
security invoker
set search_path to ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists organizations_touch_updated_at on public.organizations;
create trigger organizations_touch_updated_at
before update on public.organizations
for each row execute function public.touch_minuta_organization_updated_at();

drop trigger if exists locations_touch_updated_at on public.locations;
create trigger locations_touch_updated_at
before update on public.locations
for each row execute function public.touch_minuta_organization_updated_at();

drop trigger if exists organization_memberships_touch_updated_at on public.organization_memberships;
create trigger organization_memberships_touch_updated_at
before update on public.organization_memberships
for each row execute function public.touch_minuta_organization_updated_at();

revoke all on function public.touch_minuta_organization_updated_at()
  from public, anon, authenticated, service_role;

-- Existing providers become owners of an isolated legacy organization. Re-running
-- the migration preserves the original organization and primary location IDs.
insert into public.organizations (
  name,
  public_slug,
  created_by,
  legacy_performer_id
)
select
  coalesce(nullif(trim(profile.display_name), ''), 'Организация') || ' — организация',
  'minuta-' || replace(profile.id::text, '-', ''),
  profile.id,
  profile.id
from public.performer_profiles profile
where not exists (
    select 1
    from public.organizations organization
    where organization.legacy_performer_id = profile.id
  )
  and not exists (
    select 1
    from public.organization_memberships membership
    where membership.user_id = profile.id
      and membership.active
  )
on conflict (legacy_performer_id) do nothing;

insert into public.locations (
  organization_id,
  name,
  timezone,
  is_primary
)
select organization.id, 'Основной филиал', 'Europe/Samara', true
from public.organizations organization
where organization.legacy_performer_id is not null
  and not exists (
    select 1
    from public.locations location
    where location.organization_id = organization.id
      and location.is_primary
  );

insert into public.organization_memberships (
  organization_id,
  user_id,
  role,
  is_bookable,
  active,
  created_by
)
select
  organization.id,
  organization.legacy_performer_id,
  'owner',
  true,
  true,
  organization.legacy_performer_id
from public.organizations organization
where organization.legacy_performer_id is not null
on conflict (organization_id, user_id) do nothing;

create or replace function public.is_organization_member(p_organization uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    join public.organizations organization
      on organization.id = membership.organization_id
     and organization.status = 'active'
    where membership.organization_id = p_organization
      and membership.user_id = auth.uid()
      and membership.active
  );
$$;

create or replace function public.has_organization_role(p_organization uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    join public.organizations organization
      on organization.id = membership.organization_id
     and organization.status = 'active'
    where membership.organization_id = p_organization
      and membership.user_id = auth.uid()
      and membership.active
      and membership.role = any (p_roles)
  );
$$;

revoke all on function public.is_organization_member(uuid) from public, anon, authenticated, service_role;
revoke all on function public.has_organization_role(uuid, text[]) from public, anon, authenticated, service_role;
grant execute on function public.is_organization_member(uuid) to authenticated;
grant execute on function public.has_organization_role(uuid, text[]) to authenticated;

alter table public.organizations enable row level security;
alter table public.locations enable row level security;
alter table public.organization_memberships enable row level security;

drop policy if exists organizations_member_read on public.organizations;
create policy organizations_member_read on public.organizations
  for select to authenticated
  using (public.is_organization_member(id));

drop policy if exists locations_member_read on public.locations;
create policy locations_member_read on public.locations
  for select to authenticated
  using (public.is_organization_member(organization_id));

drop policy if exists organization_memberships_roster_read on public.organization_memberships;
create policy organization_memberships_roster_read on public.organization_memberships
  for select to authenticated
  using (
    public.is_organization_member(organization_id)
    and (
      user_id = (select auth.uid())
      or public.has_organization_role(organization_id, array['owner', 'admin']::text[])
    )
  );

revoke all on table public.organizations, public.locations, public.organization_memberships
  from public, anon, authenticated;
grant select on table public.organizations, public.locations, public.organization_memberships
  to authenticated;
grant select, insert, update, delete on table public.organizations, public.locations, public.organization_memberships
  to service_role;

-- A regular signup still receives a personal organization. A user who has already
-- been invited into an organization does not get an unwanted duplicate workspace.
create or replace function public.ensure_minuta_organization_foundation()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_organization uuid;
begin
  if exists (
    select 1
    from public.organization_memberships membership
    where membership.user_id = new.id
      and membership.active
  ) then
    return new;
  end if;

  select organization.id
  into v_organization
  from public.organizations organization
  where organization.legacy_performer_id = new.id;

  if v_organization is null then
    insert into public.organizations (
      name,
      public_slug,
      created_by,
      legacy_performer_id
    ) values (
      coalesce(nullif(trim(new.display_name), ''), 'Организация') || ' — организация',
      'minuta-' || replace(new.id::text, '-', ''),
      new.id,
      new.id
    )
    returning id into v_organization;
  end if;

  insert into public.locations (organization_id, name, timezone, is_primary)
  select v_organization, 'Основной филиал', 'Europe/Samara', true
  where not exists (
    select 1
    from public.locations location
    where location.organization_id = v_organization
      and location.is_primary
  );

  insert into public.organization_memberships (
    organization_id,
    user_id,
    role,
    is_bookable,
    active,
    created_by
  ) values (
    v_organization,
    new.id,
    'owner',
    true,
    true,
    new.id
  )
  on conflict (organization_id, user_id) do nothing;

  return new;
end;
$$;

revoke all on function public.ensure_minuta_organization_foundation() from public, anon, authenticated, service_role;

drop trigger if exists performer_profiles_organization_foundation on public.performer_profiles;
create trigger performer_profiles_organization_foundation
after insert on public.performer_profiles
for each row execute function public.ensure_minuta_organization_foundation();

commit;
