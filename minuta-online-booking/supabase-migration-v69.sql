begin;

set local search_path = public, extensions, pg_catalog;

-- v69 is deliberately additive. The v64 booking protections and the v68
-- tenant-aware booking wrapper remain the only public booking write path.
do $$
begin
  if to_regprocedure('public.get_minuta_team_calendar(uuid,date,date,uuid,uuid)') is null
     or to_regprocedure('public.book_minuta_appointment(uuid,text,uuid,uuid,date,time without time zone,text,text)') is null
     or to_regprocedure('public.get_available_slots(uuid,date,date,uuid)') is null
     or not exists (
       select 1 from pg_constraint
       where conrelid = 'public.bookings'::regclass
         and conname = 'bookings_performer_active_no_overlap'
     ) then
    raise exception using errcode = 'P0001', message = 'v69_requires_v68';
  end if;
end;
$$;

create table if not exists public.resource_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  kind text not null check (kind in ('room', 'table', 'equipment', 'other')),
  name text not null check (char_length(trim(name)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 500),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);

create unique index if not exists resource_groups_org_name_unique
  on public.resource_groups (organization_id, lower(name));

create table if not exists public.resources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  group_id uuid not null,
  name text not null check (char_length(trim(name)) between 1 and 120),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id, location_id),
  foreign key (location_id, organization_id)
    references public.locations(id, organization_id) on delete restrict,
  foreign key (group_id, organization_id)
    references public.resource_groups(id, organization_id) on delete restrict
);

create unique index if not exists resources_location_group_name_unique
  on public.resources (location_id, group_id, lower(name));
create index if not exists resources_available_idx
  on public.resources (organization_id, location_id, group_id, id) where active;

create table if not exists public.service_resource_requirements (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  service_id uuid not null references public.services(id) on delete restrict,
  group_id uuid not null,
  quantity smallint not null default 1 check (quantity between 1 and 20),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, service_id, group_id),
  foreign key (group_id, organization_id)
    references public.resource_groups(id, organization_id) on delete restrict
);

create index if not exists service_resource_requirements_service_idx
  on public.service_resource_requirements (organization_id, service_id) where active;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.bookings'::regclass
      and conname = 'bookings_id_organization_location_key'
  ) then
    alter table public.bookings
      add constraint bookings_id_organization_location_key
      unique (id, organization_id, location_id);
  end if;
end;
$$;

create table if not exists public.booking_resource_allocations (
  booking_id uuid not null,
  resource_id uuid not null,
  organization_id uuid not null,
  location_id uuid not null,
  starts_at timestamp without time zone not null,
  ends_at timestamp without time zone not null,
  booking_status text not null default 'active' check (booking_status in ('active', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (booking_id, resource_id),
  check (starts_at < ends_at),
  foreign key (booking_id, organization_id, location_id)
    references public.bookings(id, organization_id, location_id) on delete cascade,
  foreign key (resource_id, organization_id, location_id)
    references public.resources(id, organization_id, location_id) on delete restrict
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.booking_resource_allocations'::regclass
      and conname = 'booking_resources_active_no_overlap'
  ) then
    alter table public.booking_resource_allocations
      add constraint booking_resources_active_no_overlap
      exclude using gist (
        resource_id with =,
        tsrange(starts_at, ends_at, '[)') with &&
      ) where (booking_status = 'active');
  end if;
end;
$$;

create index if not exists booking_resource_allocations_booking_idx
  on public.booking_resource_allocations (booking_id);
create index if not exists booking_resource_allocations_org_time_idx
  on public.booking_resource_allocations (organization_id, location_id, starts_at, ends_at);

create table if not exists public.resource_audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action in (
    'group_created', 'group_updated', 'resource_created', 'resource_updated',
    'requirements_replaced'
  )),
  subject_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists resource_audit_org_created_idx
  on public.resource_audit_log (organization_id, created_at desc);

alter table public.resource_groups enable row level security;
alter table public.resources enable row level security;
alter table public.service_resource_requirements enable row level security;
alter table public.booking_resource_allocations enable row level security;
alter table public.resource_audit_log enable row level security;

drop policy if exists resource_groups_member_read on public.resource_groups;
create policy resource_groups_member_read on public.resource_groups for select to authenticated
  using (public.is_organization_member(organization_id));
drop policy if exists resources_member_read on public.resources;
create policy resources_member_read on public.resources for select to authenticated
  using (public.is_organization_member(organization_id));
drop policy if exists resource_requirements_member_read on public.service_resource_requirements;
create policy resource_requirements_member_read on public.service_resource_requirements for select to authenticated
  using (public.is_organization_member(organization_id));
drop policy if exists resource_allocations_member_read on public.booking_resource_allocations;
create policy resource_allocations_member_read on public.booking_resource_allocations for select to authenticated
  using (public.is_organization_member(organization_id) and (
    public.has_organization_role(organization_id, array['owner','admin'])
    or exists (
      select 1 from public.bookings booking
      where booking.id = booking_id and booking.performer_id = auth.uid()
    )
  ));
drop policy if exists resource_audit_manager_read on public.resource_audit_log;
create policy resource_audit_manager_read on public.resource_audit_log for select to authenticated
  using (public.has_organization_role(organization_id, array['owner','admin']));

revoke all on public.resource_groups, public.resources,
  public.service_resource_requirements, public.booking_resource_allocations,
  public.resource_audit_log from public, anon, authenticated;
grant select on public.resource_groups, public.resources,
  public.service_resource_requirements, public.booking_resource_allocations,
  public.resource_audit_log to authenticated;
grant all on public.resource_groups, public.resources,
  public.service_resource_requirements, public.booking_resource_allocations,
  public.resource_audit_log to service_role;

create or replace function public.require_minuta_resource_manager(p_organization uuid)
returns text
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_role text;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  select membership.role into v_role
  from public.organization_memberships membership
  join public.organizations organization on organization.id = membership.organization_id
  where membership.organization_id = p_organization
    and membership.user_id = auth.uid()
    and membership.active
    and organization.status = 'active';
  if v_role is null or v_role not in ('owner', 'admin') then
    raise exception using errcode = '42501', message = 'resource_management_denied';
  end if;
  return v_role;
end;
$$;

revoke all on function public.require_minuta_resource_manager(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.write_minuta_resource_audit(
  p_organization uuid,
  p_action text,
  p_subject uuid,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  insert into public.resource_audit_log (
    organization_id, actor_id, action, subject_id, details
  ) values (
    p_organization, auth.uid(), p_action, p_subject, coalesce(p_details, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.write_minuta_resource_audit(uuid,text,uuid,jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.allocate_minuta_booking_resources(p_booking uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_booking public.bookings%rowtype;
  v_requirement record;
  v_resource record;
  v_needed integer;
  v_allocated integer;
  v_start timestamp without time zone;
  v_end timestamp without time zone;
begin
  select * into v_booking from public.bookings where id = p_booking for update;
  if not found then return; end if;

  if v_booking.status = 'cancelled' then
    update public.booking_resource_allocations
    set booking_status = 'cancelled', updated_at = now()
    where booking_id = p_booking;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    v_booking.organization_id::text || ':' || v_booking.service_id::text, 6901
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    v_booking.organization_id::text || ':' || v_booking.location_id::text, 6900
  ));
  v_start := v_booking.booking_date + v_booking.booking_time;
  v_end := v_start + make_interval(mins => v_booking.duration_minutes);

  delete from public.booking_resource_allocations where booking_id = p_booking;

  for v_requirement in
    select requirement.group_id, requirement.quantity
    from public.service_resource_requirements requirement
    join public.resource_groups resource_group
      on resource_group.id = requirement.group_id
     and resource_group.organization_id = requirement.organization_id
    where requirement.organization_id = v_booking.organization_id
      and requirement.service_id = v_booking.service_id
      and requirement.active
    order by requirement.group_id
  loop
    if not (select active from public.resource_groups where id = v_requirement.group_id) then
      raise exception using errcode = 'P0001', message = 'resource_unavailable';
    end if;
    v_needed := v_requirement.quantity;
    v_allocated := 0;
    for v_resource in
      select resource.id
      from public.resources resource
      where resource.organization_id = v_booking.organization_id
        and resource.location_id = v_booking.location_id
        and resource.group_id = v_requirement.group_id
        and resource.active
      order by resource.id
      for update
    loop
      exit when v_allocated >= v_needed;
      begin
        insert into public.booking_resource_allocations (
          booking_id, resource_id, organization_id, location_id,
          starts_at, ends_at, booking_status
        ) values (
          v_booking.id, v_resource.id, v_booking.organization_id, v_booking.location_id,
          v_start, v_end, 'active'
        );
        v_allocated := v_allocated + 1;
      exception when exclusion_violation or unique_violation then
        null;
      end;
    end loop;
    if v_allocated < v_needed then
      raise exception using errcode = 'P0001', message = 'resource_unavailable';
    end if;
  end loop;
end;
$$;

revoke all on function public.allocate_minuta_booking_resources(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.sync_minuta_booking_resources()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  perform public.allocate_minuta_booking_resources(new.id);
  return new;
end;
$$;

revoke all on function public.sync_minuta_booking_resources()
  from public, anon, authenticated, service_role;

drop trigger if exists bookings_sync_minuta_resources on public.bookings;
create trigger bookings_sync_minuta_resources
after insert or update of organization_id, location_id, service_id,
  booking_date, booking_time, duration_minutes, status
on public.bookings
for each row execute function public.sync_minuta_booking_resources();

create or replace function public.get_minuta_resource_workspace(p_organization uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_role text;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  select membership.role into v_role
  from public.organization_memberships membership
  join public.organizations organization
    on organization.id = membership.organization_id
   and organization.status = 'active'
  where membership.organization_id = p_organization
    and membership.user_id = auth.uid()
    and membership.active;
  if v_role is null then
    raise exception using errcode = '42501', message = 'organization_access_denied';
  end if;

  return jsonb_build_object(
    'organization_id', p_organization,
    'current_role', v_role,
    'can_manage', v_role in ('owner', 'admin'),
    'locations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', location.id, 'name', location.name, 'active', location.active
      ) order by location.is_primary desc, location.name, location.id)
      from public.locations location
      where location.organization_id = p_organization
        and (v_role in ('owner','admin') or location.active)
    ), '[]'::jsonb),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', service.id, 'name', service.name, 'active', service.active,
        'performer_id', service.performer_id, 'performer_name', profile.display_name
      ) order by profile.display_name, service.name, service.id)
      from public.services service
      join public.performer_profiles profile on profile.id = service.performer_id
      where exists (
        select 1 from public.organization_memberships membership
        where membership.organization_id = p_organization
          and membership.user_id = service.performer_id
          and membership.active
      ) and (v_role in ('owner','admin') or service.active)
    ), '[]'::jsonb),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', resource_group.id, 'kind', resource_group.kind,
        'name', resource_group.name, 'description', resource_group.description,
        'active', resource_group.active
      ) order by resource_group.name, resource_group.id)
      from public.resource_groups resource_group
      where resource_group.organization_id = p_organization
        and (v_role in ('owner','admin') or resource_group.active)
    ), '[]'::jsonb),
    'resources', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', resource.id, 'name', resource.name, 'active', resource.active,
        'location_id', resource.location_id, 'location_name', location.name,
        'group_id', resource.group_id, 'group_name', resource_group.name,
        'kind', resource_group.kind
      ) order by location.name, resource_group.name, resource.name, resource.id)
      from public.resources resource
      join public.locations location on location.id = resource.location_id
      join public.resource_groups resource_group on resource_group.id = resource.group_id
      where resource.organization_id = p_organization
        and (v_role in ('owner','admin') or (resource.active and resource_group.active))
    ), '[]'::jsonb),
    'requirements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'service_id', requirement.service_id, 'group_id', requirement.group_id,
        'quantity', requirement.quantity, 'active', requirement.active
      ) order by requirement.service_id, requirement.group_id)
      from public.service_resource_requirements requirement
      where requirement.organization_id = p_organization
        and (v_role in ('owner','admin') or requirement.active)
    ), '[]'::jsonb),
    'audit', case when v_role in ('owner','admin') then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', audit.id, 'action', audit.action, 'subject_id', audit.subject_id,
        'details', audit.details, 'created_at', audit.created_at
      ) order by audit.created_at desc, audit.id desc)
      from (select * from public.resource_audit_log where organization_id = p_organization order by created_at desc, id desc limit 40) audit
    ), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;

revoke all on function public.get_minuta_resource_workspace(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_minuta_resource_workspace(uuid) to authenticated;

create or replace function public.create_minuta_resource_group(
  p_organization uuid, p_name text, p_kind text, p_description text default ''
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare v_id uuid;
begin
  perform public.require_minuta_resource_manager(p_organization);
  if trim(coalesce(p_name,'')) = '' or char_length(trim(p_name)) > 120
     or p_kind not in ('room','table','equipment','other')
     or char_length(coalesce(p_description,'')) > 500 then
    raise exception using errcode = '22023', message = 'invalid_resource_group';
  end if;
  insert into public.resource_groups (organization_id, name, kind, description)
  values (p_organization, trim(p_name), p_kind, trim(coalesce(p_description,'')))
  returning id into v_id;
  perform public.write_minuta_resource_audit(p_organization, 'group_created', v_id, jsonb_build_object('name', trim(p_name)));
  return public.get_minuta_resource_workspace(p_organization);
end;
$$;

create or replace function public.update_minuta_resource_group(
  p_group uuid, p_name text, p_kind text, p_description text, p_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.resource_groups where id = p_group for update;
  if v_org is null then raise exception using errcode = 'P0001', message = 'resource_group_not_found'; end if;
  perform public.require_minuta_resource_manager(v_org);
  if trim(coalesce(p_name,'')) = '' or char_length(trim(p_name)) > 120
     or p_kind not in ('room','table','equipment','other')
     or char_length(coalesce(p_description,'')) > 500 then
    raise exception using errcode = '22023', message = 'invalid_resource_group';
  end if;
  if p_active is false and exists (
    select 1 from public.service_resource_requirements requirement
    where requirement.group_id = p_group and requirement.active
  ) then raise exception using errcode = 'P0001', message = 'resource_group_is_required'; end if;
  if p_active is false and exists (
    select 1 from public.booking_resource_allocations allocation
    join public.resources resource on resource.id = allocation.resource_id
    where resource.group_id = p_group and allocation.booking_status = 'active'
      and allocation.ends_at > timezone('Europe/Samara', now())
  ) then raise exception using errcode = 'P0001', message = 'resource_has_future_bookings'; end if;
  update public.resource_groups set name=trim(p_name), kind=p_kind,
    description=trim(coalesce(p_description,'')), active=p_active, updated_at=now()
  where id=p_group;
  perform public.write_minuta_resource_audit(v_org, 'group_updated', p_group, jsonb_build_object('active', p_active));
  return public.get_minuta_resource_workspace(v_org);
end;
$$;

create or replace function public.create_minuta_resource(
  p_organization uuid, p_location uuid, p_group uuid, p_name text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare v_id uuid;
begin
  perform public.require_minuta_resource_manager(p_organization);
  if trim(coalesce(p_name,'')) = '' or char_length(trim(p_name)) > 120 then
    raise exception using errcode = '22023', message = 'invalid_resource';
  end if;
  if not exists (select 1 from public.locations where id=p_location and organization_id=p_organization and active)
     or not exists (select 1 from public.resource_groups where id=p_group and organization_id=p_organization and active) then
    raise exception using errcode = '42501', message = 'foreign_resource_scope_denied';
  end if;
  insert into public.resources (organization_id, location_id, group_id, name)
  values (p_organization, p_location, p_group, trim(p_name)) returning id into v_id;
  perform public.write_minuta_resource_audit(p_organization, 'resource_created', v_id, jsonb_build_object('name', trim(p_name), 'location_id', p_location));
  return public.get_minuta_resource_workspace(p_organization);
end;
$$;

create or replace function public.update_minuta_resource(
  p_resource uuid, p_location uuid, p_group uuid, p_name text, p_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare v_old public.resources%rowtype;
begin
  select * into v_old from public.resources where id=p_resource for update;
  if not found then raise exception using errcode = 'P0001', message = 'resource_not_found'; end if;
  perform public.require_minuta_resource_manager(v_old.organization_id);
  if trim(coalesce(p_name,'')) = '' or char_length(trim(p_name)) > 120 then
    raise exception using errcode = '22023', message = 'invalid_resource';
  end if;
  if not exists (select 1 from public.locations where id=p_location and organization_id=v_old.organization_id and active)
     or not exists (select 1 from public.resource_groups where id=p_group and organization_id=v_old.organization_id and active) then
    raise exception using errcode = '42501', message = 'foreign_resource_scope_denied';
  end if;
  if (p_location <> v_old.location_id or p_group <> v_old.group_id) and exists (
    select 1 from public.booking_resource_allocations allocation
    where allocation.resource_id=p_resource
  ) then raise exception using errcode = 'P0001', message = 'resource_scope_is_immutable_after_use'; end if;
  if not p_active and exists (
    select 1 from public.booking_resource_allocations allocation
    where allocation.resource_id=p_resource and allocation.booking_status='active'
      and allocation.ends_at > timezone('Europe/Samara', now())
  ) then raise exception using errcode = 'P0001', message = 'resource_has_future_bookings'; end if;
  update public.resources set location_id=p_location, group_id=p_group, name=trim(p_name),
    active=p_active, updated_at=now() where id=p_resource;
  perform public.write_minuta_resource_audit(v_old.organization_id, 'resource_updated', p_resource, jsonb_build_object('active', p_active, 'location_id', p_location));
  return public.get_minuta_resource_workspace(v_old.organization_id);
end;
$$;

create or replace function public.replace_minuta_service_resource_requirements(
  p_organization uuid, p_service uuid, p_requirements jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_item jsonb;
  v_group uuid;
  v_quantity integer;
  v_booking uuid;
  v_expected_bookings integer;
  v_processed_bookings integer := 0;
begin
  perform public.require_minuta_resource_manager(p_organization);
  perform pg_advisory_xact_lock(hashtextextended(
    p_organization::text || ':' || p_service::text, 6901
  ));
  if not exists (
    select 1 from public.services service
    join public.organization_memberships membership
      on membership.organization_id=p_organization and membership.user_id=service.performer_id and membership.active
    where service.id=p_service
  ) then raise exception using errcode='42501', message='foreign_service_denied'; end if;
  if p_requirements is null or jsonb_typeof(p_requirements) <> 'array' or jsonb_array_length(p_requirements) > 20 then
    raise exception using errcode='22023', message='invalid_resource_requirements';
  end if;
  update public.service_resource_requirements set active=false, updated_at=now()
  where organization_id=p_organization and service_id=p_service;
  for v_item in select value from jsonb_array_elements(p_requirements)
  loop
    begin
      v_group := (v_item->>'group_id')::uuid;
      v_quantity := (v_item->>'quantity')::integer;
    exception when others then
      raise exception using errcode='22023', message='invalid_resource_requirements';
    end;
    if v_quantity not between 1 and 20 or not exists (
      select 1 from public.resource_groups
      where id=v_group and organization_id=p_organization and active
    ) then raise exception using errcode='42501', message='foreign_resource_group_denied'; end if;
    insert into public.service_resource_requirements (organization_id,service_id,group_id,quantity,active,updated_at)
    values (p_organization,p_service,v_group,v_quantity,true,now())
    on conflict (organization_id,service_id,group_id) do update
      set quantity=excluded.quantity, active=true, updated_at=now();
  end loop;

  select count(*)
  into v_expected_bookings
  from public.bookings booking
  where booking.organization_id = p_organization
    and booking.service_id = p_service
    and booking.status <> 'cancelled'
    and booking.booking_date >= current_date;

  -- Do not wait for a booking row while holding the service advisory lock:
  -- an in-flight booking trigger may already hold that row and be waiting for
  -- this same lock. A concurrent update therefore makes activation fail
  -- atomically and safely; the caller can retry after that update commits.
  for v_booking in
    select id from public.bookings
    where organization_id=p_organization and service_id=p_service
      and status <> 'cancelled' and booking_date >= current_date
    order by booking_date, booking_time, id for update skip locked
  loop
    v_processed_bookings := v_processed_bookings + 1;
    perform public.allocate_minuta_booking_resources(v_booking);
  end loop;
  if v_processed_bookings <> v_expected_bookings then
    raise exception using errcode='P0001', message='resource_requirements_concurrent_booking_update';
  end if;
  perform public.write_minuta_resource_audit(p_organization, 'requirements_replaced', p_service, jsonb_build_object('requirements', p_requirements));
  return public.get_minuta_resource_workspace(p_organization);
end;
$$;

do $$
declare v_signature regprocedure;
begin
  foreach v_signature in array array[
    'public.create_minuta_resource_group(uuid,text,text,text)'::regprocedure,
    'public.update_minuta_resource_group(uuid,text,text,text,boolean)'::regprocedure,
    'public.create_minuta_resource(uuid,uuid,uuid,text)'::regprocedure,
    'public.update_minuta_resource(uuid,uuid,uuid,text,boolean)'::regprocedure,
    'public.replace_minuta_service_resource_requirements(uuid,uuid,jsonb)'::regprocedure
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_signature);
    execute format('grant execute on function %s to authenticated', v_signature);
  end loop;
end;
$$;

create or replace function public.get_public_minuta_available_slots_v3(
  p_slug text, p_location uuid, p_service uuid, p_start date, p_end date
)
returns table(booking_date date, booking_time time without time zone)
language plpgsql
stable
security definer
set search_path to ''
as $$
declare v_organization uuid;
begin
  if p_start is null or p_end is null or p_end < p_start or p_end-p_start > 62 then
    raise exception using errcode='22023', message='invalid_calendar_range';
  end if;
  select organization.id into v_organization from public.organizations organization
  where organization.public_slug=lower(trim(coalesce(p_slug,'')))
    and organization.status='active' and organization.public_booking_enabled;
  if v_organization is null then raise exception using errcode='P0001', message='organization_unavailable'; end if;
  if not exists (select 1 from public.locations where id=p_location and organization_id=v_organization and active and timezone='Europe/Samara')
     or not exists (
       select 1 from public.services service join public.organization_memberships membership
         on membership.organization_id=v_organization and membership.user_id=service.performer_id
         and membership.active and membership.is_bookable
       where service.id=p_service and service.active
     ) then raise exception using errcode='P0001', message='service_or_location_unavailable'; end if;
  return query
  select slot.booking_date, slot.booking_time
  from public.get_available_slots(p_service,p_start,p_end,null) slot
  join public.services service on service.id=p_service
  where not exists (
    select 1
    from public.service_resource_requirements requirement
    join public.resource_groups resource_group on resource_group.id=requirement.group_id
    where requirement.organization_id=v_organization and requirement.service_id=p_service and requirement.active
      and requirement.quantity > (
        select count(*) from public.resources resource
        where resource.organization_id=v_organization and resource.location_id=p_location
          and resource.group_id=requirement.group_id and resource.active
          and resource_group.active
          and not exists (
            select 1 from public.booking_resource_allocations allocation
            where allocation.resource_id=resource.id and allocation.booking_status='active'
              and tsrange(allocation.starts_at,allocation.ends_at,'[)') && tsrange(
                slot.booking_date+slot.booking_time,
                slot.booking_date+slot.booking_time+make_interval(mins=>service.duration_minutes),'[)'
              )
          )
      )
  )
  order by slot.booking_date, slot.booking_time;
end;
$$;

revoke all on function public.get_public_minuta_available_slots_v3(text,uuid,uuid,date,date)
  from public, anon, authenticated, service_role;
grant execute on function public.get_public_minuta_available_slots_v3(text,uuid,uuid,date,date)
  to anon, authenticated;

create or replace function public.get_public_minuta_catalog_v3(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce((
    select jsonb_build_object(
      'resource_scheduling', true,
      'organization', jsonb_build_object('id',organization.id,'name',organization.name,'public_slug',organization.public_slug),
      'locations', coalesce((select jsonb_agg(jsonb_build_object(
        'id',location.id,'name',location.name,'address',location.address,'timezone',location.timezone,'is_primary',location.is_primary
      ) order by location.is_primary desc,location.name,location.id) from public.locations location
        where location.organization_id=organization.id and location.active and location.timezone='Europe/Samara'),'[]'::jsonb),
      'services', coalesce((select jsonb_agg(jsonb_build_object(
        'id',service.id,'performer_id',service.performer_id,'name',service.name,
        'duration_minutes',service.duration_minutes,'price_rub',service.price_rub,
        'performer_profiles',jsonb_build_object('display_name',profile.display_name),
        'resource_required',exists(select 1 from public.service_resource_requirements requirement where requirement.organization_id=organization.id and requirement.service_id=service.id and requirement.active),
        'location_ids',coalesce((select jsonb_agg(location.id order by location.is_primary desc,location.name,location.id)
          from public.locations location where location.organization_id=organization.id and location.active and location.timezone='Europe/Samara'
          and not exists (select 1 from public.service_resource_requirements requirement join public.resource_groups resource_group on resource_group.id=requirement.group_id
            where requirement.organization_id=organization.id and requirement.service_id=service.id and requirement.active
              and requirement.quantity>(select count(*) from public.resources resource where resource.organization_id=organization.id and resource.location_id=location.id and resource.group_id=requirement.group_id and resource.active and resource_group.active))), '[]'::jsonb)
      ) order by service.created_at,service.id)
      from public.organization_memberships membership
      join public.performer_profiles profile on profile.id=membership.user_id
      join public.services service on service.performer_id=membership.user_id
      where membership.organization_id=organization.id and membership.active and membership.is_bookable and service.active),'[]'::jsonb)
    )
    from public.organizations organization
    where organization.public_slug=lower(trim(coalesce(p_slug,'')))
      and organization.status='active' and organization.public_booking_enabled
      and lower(trim(coalesce(p_slug,''))) ~ '^[a-z0-9][a-z0-9-]{2,62}$'
  ), jsonb_build_object('resource_scheduling',true,'organization',null,'locations','[]'::jsonb,'services','[]'::jsonb));
$$;

revoke all on function public.get_public_minuta_catalog_v3(text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_public_minuta_catalog_v3(text) to anon, authenticated;

-- Keep the protected v68 calendar unchanged. The v2 reader delegates all
-- tenant/role checks to it and only enriches the already-authorized result
-- with resource assignments and an optional resource filter.
create or replace function public.get_minuta_team_calendar_v2(
  p_organization uuid,
  p_start date,
  p_end date,
  p_location uuid default null,
  p_performer uuid default null,
  p_resource uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_calendar jsonb;
  v_role text;
  v_bookings jsonb;
begin
  v_calendar := public.get_minuta_team_calendar(
    p_organization, p_start, p_end, p_location, p_performer
  );
  v_role := v_calendar ->> 'current_role';

  if p_resource is not null and not exists (
    select 1
    from public.resources resource
    join public.resource_groups resource_group
      on resource_group.id = resource.group_id
     and resource_group.organization_id = resource.organization_id
    where resource.id = p_resource
      and resource.organization_id = p_organization
      and (p_location is null or resource.location_id = p_location)
      and (
        v_role in ('owner', 'admin')
        or (resource.active and resource_group.active)
      )
  ) then
    raise exception using errcode = '42501', message = 'foreign_resource_denied';
  end if;

  select coalesce(jsonb_agg(
    booking_entry.item || jsonb_build_object(
      'resources', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', resource.id,
          'name', resource.name,
          'group_id', resource_group.id,
          'group_name', resource_group.name,
          'kind', resource_group.kind,
          'allocation_status', allocation.booking_status
        ) order by resource_group.name, resource.name, resource.id)
        from public.booking_resource_allocations allocation
        join public.resources resource on resource.id = allocation.resource_id
        join public.resource_groups resource_group on resource_group.id = resource.group_id
        where allocation.booking_id = (booking_entry.item ->> 'id')::uuid
      ), '[]'::jsonb)
    ) order by booking_entry.ordinality
  ), '[]'::jsonb)
  into v_bookings
  from jsonb_array_elements(coalesce(v_calendar -> 'bookings', '[]'::jsonb))
    with ordinality as booking_entry(item, ordinality)
  where p_resource is null
     or exists (
       select 1
       from public.booking_resource_allocations allocation
       where allocation.booking_id = (booking_entry.item ->> 'id')::uuid
         and allocation.resource_id = p_resource
     );

  return (v_calendar - 'bookings') || jsonb_build_object(
    'resource_schedule_scope', 'booking_allocations',
    'selected_resource_id', p_resource,
    'resources', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', resource.id,
        'name', resource.name,
        'location_id', resource.location_id,
        'group_id', resource_group.id,
        'group_name', resource_group.name,
        'kind', resource_group.kind,
        'active', resource.active and resource_group.active
      ) order by resource_group.name, resource.name, resource.id)
      from public.resources resource
      join public.resource_groups resource_group
        on resource_group.id = resource.group_id
       and resource_group.organization_id = resource.organization_id
      where resource.organization_id = p_organization
        and (p_location is null or resource.location_id = p_location)
        and (
          v_role in ('owner', 'admin')
          or (resource.active and resource_group.active)
        )
    ), '[]'::jsonb),
    'bookings', v_bookings
  );
end;
$$;

revoke all on function public.get_minuta_team_calendar_v2(uuid,date,date,uuid,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_minuta_team_calendar_v2(uuid,date,date,uuid,uuid,uuid)
  to authenticated;

-- Keep the v41 reschedule policy and slot generator as the source of truth.
-- The additive v3 reader excludes this booking's current allocations while
-- checking that every active resource requirement can be satisfied.
create or replace function public.get_reschedule_slots_v3(
  p_token uuid,
  p_start date,
  p_end date
)
returns table(booking_date date, booking_time time without time zone)
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_booking uuid;
  v_organization uuid;
  v_location uuid;
  v_service uuid;
  v_duration integer;
begin
  select booking.id, booking.organization_id, booking.location_id,
         booking.service_id, booking.duration_minutes
  into v_booking, v_organization, v_location, v_service, v_duration
  from public.bookings booking
  where booking.manage_token = p_token
    and booking.status <> 'cancelled';

  if v_booking is null then
    return;
  end if;

  return query
  select slot.booking_date, slot.booking_time
  from public.get_reschedule_slots(p_token, p_start, p_end) slot
  where not exists (
    select 1
    from public.service_resource_requirements requirement
    join public.resource_groups resource_group
      on resource_group.id = requirement.group_id
     and resource_group.organization_id = requirement.organization_id
    where requirement.organization_id = v_organization
      and requirement.service_id = v_service
      and requirement.active
      and requirement.quantity > (
        select count(*)
        from public.resources resource
        where resource.organization_id = v_organization
          and resource.location_id = v_location
          and resource.group_id = requirement.group_id
          and resource.active
          and resource_group.active
          and not exists (
            select 1
            from public.booking_resource_allocations allocation
            where allocation.resource_id = resource.id
              and allocation.booking_id <> v_booking
              and allocation.booking_status = 'active'
              and tsrange(allocation.starts_at, allocation.ends_at, '[)') && tsrange(
                slot.booking_date + slot.booking_time,
                slot.booking_date + slot.booking_time + make_interval(mins => v_duration),
                '[)'
              )
          )
      )
  )
  order by slot.booking_date, slot.booking_time;
end;
$$;

revoke all on function public.get_reschedule_slots_v3(uuid,date,date)
  from public, anon, authenticated, service_role;
grant execute on function public.get_reschedule_slots_v3(uuid,date,date)
  to anon, authenticated;

commit;
