begin;

create extension if not exists btree_gist with schema extensions;
set local search_path = public, extensions, pg_catalog;

-- v68 adds an explicit tenant and branch to every booking. The legacy booking
-- RPC remains the source of truth for idempotency, payments and slot checks.
do $$
begin
  if to_regprocedure('public.get_public_minuta_catalog(text)') is null
     or to_regprocedure('public.book_appointment(uuid,uuid,date,time without time zone,text,text)') is null
     or to_regprocedure('public.get_minuta_workspace()') is null then
    raise exception using errcode = 'P0001', message = 'v68_requires_v67';
  end if;
end;
$$;

alter table public.bookings
  add column if not exists organization_id uuid,
  add column if not exists location_id uuid,
  add column if not exists booking_scope_source text;

-- Prefer the deterministic personal tenant created by v65. This stays safe
-- even after that performer joins additional teams.
update public.bookings booking
set organization_id = organization.id,
    location_id = location.id,
    booking_scope_source = 'legacy'
from public.organizations organization
join public.locations location
  on location.organization_id = organization.id
 and location.active
 and location.is_primary
where organization.legacy_performer_id = booking.performer_id
  and organization.status = 'active'
  and booking.organization_id is null
  and booking.location_id is null;

-- Providers without a legacy tenant are assignable only when there is one
-- unambiguous active, bookable organization and primary location.
with unambiguous_scope as (
  select membership.user_id as performer_id,
         min(membership.organization_id::text)::uuid as organization_id,
         min(location.id::text)::uuid as location_id
  from public.organization_memberships membership
  join public.organizations organization
    on organization.id = membership.organization_id
   and organization.status = 'active'
  join public.locations location
    on location.organization_id = membership.organization_id
   and location.active
   and location.is_primary
  where membership.active
    and membership.is_bookable
  group by membership.user_id
  having count(distinct membership.organization_id) = 1
     and count(distinct location.id) = 1
)
update public.bookings booking
set organization_id = scope.organization_id,
    location_id = scope.location_id,
    booking_scope_source = 'legacy'
from unambiguous_scope scope
where booking.performer_id = scope.performer_id
  and booking.organization_id is null
  and booking.location_id is null;

do $$
begin
  if exists (
    select 1 from public.bookings booking
    where booking.organization_id is null
       or booking.location_id is null
       or booking.booking_scope_source is null
  ) then
    raise exception using errcode = 'P0001', message = 'v68_booking_tenant_ambiguous';
  end if;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bookings_organization_id_fkey') then
    alter table public.bookings
      add constraint bookings_organization_id_fkey
      foreign key (organization_id) references public.organizations(id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'bookings_location_organization_fkey') then
    alter table public.bookings
      add constraint bookings_location_organization_fkey
      foreign key (location_id, organization_id)
      references public.locations(id, organization_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'bookings_scope_source_check') then
    alter table public.bookings
      add constraint bookings_scope_source_check
      check (booking_scope_source in ('legacy', 'team'));
  end if;
end;
$$;

alter table public.bookings
  alter column organization_id set not null,
  alter column location_id set not null,
  alter column booking_scope_source set default 'legacy',
  alter column booking_scope_source set not null;

create index if not exists bookings_organization_date_idx
  on public.bookings (organization_id, booking_date, booking_time);
create index if not exists bookings_location_date_idx
  on public.bookings (location_id, booking_date, booking_time);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.bookings'::regclass
      and conname = 'bookings_performer_active_no_overlap'
  ) then
    alter table public.bookings
      add constraint bookings_performer_active_no_overlap
      exclude using gist (
        performer_id with =,
        tsrange(
          booking_date + booking_time,
          booking_date + booking_time + make_interval(mins => duration_minutes),
          '[)'
        ) with &&
      ) where (status <> 'cancelled');
  end if;
end;
$$;

create or replace function public.scope_minuta_booking()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_config_organization uuid;
  v_config_location uuid;
  v_candidate_count integer;
  v_exact_legacy boolean := false;
begin
  if tg_op = 'INSERT' then
    begin
      v_config_organization := nullif(current_setting('minuta.booking_organization', true), '')::uuid;
      v_config_location := nullif(current_setting('minuta.booking_location', true), '')::uuid;
    exception when invalid_text_representation then
      raise exception using errcode = 'P0001', message = 'booking_organization_required';
    end;

    if (v_config_organization is null) <> (v_config_location is null) then
      raise exception using errcode = 'P0001', message = 'booking_organization_required';
    elsif v_config_organization is not null then
      if (new.organization_id is not null and new.organization_id <> v_config_organization)
         or (new.location_id is not null and new.location_id <> v_config_location) then
        raise exception using errcode = 'P0001', message = 'booking_scope_conflict';
      end if;
      new.organization_id := v_config_organization;
      new.location_id := v_config_location;
      new.booking_scope_source := 'team';
    elsif new.organization_id is null and new.location_id is null then
      select count(*),
             min(organization.id::text)::uuid,
             min(location.id::text)::uuid
      into v_candidate_count, new.organization_id, new.location_id
      from public.organizations organization
      join public.locations location
        on location.organization_id = organization.id
       and location.active
       and location.is_primary
       where organization.legacy_performer_id = new.performer_id
         and organization.status = 'active';
      v_exact_legacy := v_candidate_count = 1;
      if v_candidate_count = 0 then
        select count(*),
               min(membership.organization_id::text)::uuid,
               min(location.id::text)::uuid
        into v_candidate_count, new.organization_id, new.location_id
        from public.organization_memberships membership
        join public.organizations organization
          on organization.id = membership.organization_id
         and organization.status = 'active'
        join public.locations location
          on location.organization_id = membership.organization_id
         and location.active
         and location.is_primary
        where membership.user_id = new.performer_id
          and membership.active
          and membership.is_bookable;
      end if;
      if v_candidate_count <> 1 then
        raise exception using errcode = 'P0001', message = 'booking_organization_required';
      end if;
      new.booking_scope_source := case when v_exact_legacy then 'legacy' else 'team' end;
    elsif new.organization_id is null or new.location_id is null then
      raise exception using errcode = 'P0001', message = 'booking_organization_required';
    else
      select exists (
        select 1
        from public.organizations organization
        join public.locations location
          on location.organization_id = organization.id
         and location.is_primary
        where organization.id = new.organization_id
          and organization.legacy_performer_id = new.performer_id
          and location.id = new.location_id
      ) into v_exact_legacy;
      new.booking_scope_source := case when v_exact_legacy then 'legacy' else 'team' end;
    end if;
  end if;

  if new.organization_id is null or new.location_id is null then
    raise exception using errcode = 'P0001', message = 'booking_organization_required';
  end if;
  if not exists (
    select 1
    from public.locations location
    join public.organizations organization
      on organization.id = location.organization_id
     and organization.status = 'active'
    where location.id = new.location_id
      and location.organization_id = new.organization_id
      and location.active
  ) then
    raise exception using errcode = 'P0001', message = 'booking_location_unavailable';
  end if;
  if not exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = new.organization_id
      and membership.user_id = new.performer_id
      and membership.active
      and membership.is_bookable
  ) then
    raise exception using errcode = 'P0001', message = 'booking_performer_unavailable';
  end if;
  if not exists (
    select 1 from public.services service
    where service.id = new.service_id
      and service.performer_id = new.performer_id
  ) then
    raise exception using errcode = 'P0001', message = 'booking_service_performer_mismatch';
  end if;
  if tg_op = 'UPDATE' then
    select exists (
      select 1
      from public.organizations organization
      join public.locations location
        on location.organization_id = organization.id
       and location.is_primary
      where organization.id = new.organization_id
        and organization.legacy_performer_id = new.performer_id
        and location.id = new.location_id
    ) into v_exact_legacy;
    new.booking_scope_source := case
      when old.booking_scope_source = 'team' or not v_exact_legacy then 'team'
      else 'legacy'
    end;
  end if;
  new.booking_scope_source := coalesce(new.booking_scope_source, 'legacy');
  return new;
end;
$$;

revoke all on function public.scope_minuta_booking()
  from public, anon, authenticated, service_role;

drop trigger if exists bookings_scope_minuta_tenant on public.bookings;
create trigger bookings_scope_minuta_tenant
before insert or update of organization_id, location_id, performer_id, service_id, booking_scope_source
on public.bookings
for each row execute function public.scope_minuta_booking();

create or replace function public.get_public_minuta_catalog_v2(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce((
    select jsonb_build_object(
      'organization', jsonb_build_object(
        'id', organization.id,
        'name', organization.name,
        'public_slug', organization.public_slug
      ),
      'locations', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', location.id,
          'name', location.name,
          'address', location.address,
          'timezone', location.timezone,
          'is_primary', location.is_primary
        ) order by location.is_primary desc, location.name, location.id)
        from public.locations location
        where location.organization_id = organization.id
          and location.active
          -- Existing availability RPCs use the Samara business clock. Other
          -- timezones stay manageable but are not public-bookable until a UTC
          -- migration is introduced.
          and location.timezone = 'Europe/Samara'
      ), '[]'::jsonb),
      'services', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', service.id,
          'performer_id', service.performer_id,
          'name', service.name,
          'duration_minutes', service.duration_minutes,
          'price_rub', service.price_rub,
          'performer_profiles', jsonb_build_object('display_name', profile.display_name)
        ) order by service.created_at, service.id)
        from public.organization_memberships membership
        join public.performer_profiles profile on profile.id = membership.user_id
        join public.services service on service.performer_id = membership.user_id
        where membership.organization_id = organization.id
          and membership.active
          and membership.is_bookable
          and service.active
      ), '[]'::jsonb)
    )
    from public.organizations organization
    where organization.public_slug = lower(trim(coalesce(p_slug, '')))
      and organization.status = 'active'
      and organization.public_booking_enabled
      and lower(trim(coalesce(p_slug, ''))) ~ '^[a-z0-9][a-z0-9-]{2,62}$'
  ), jsonb_build_object(
    'organization', null,
    'locations', '[]'::jsonb,
    'services', '[]'::jsonb
  ));
$$;

revoke all on function public.get_public_minuta_catalog_v2(text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_public_minuta_catalog_v2(text) to anon, authenticated;

create or replace function public.book_minuta_appointment(
  p_request_id uuid,
  p_slug text,
  p_location uuid,
  p_service uuid,
  p_date date,
  p_time time without time zone,
  p_client_name text,
  p_client_phone text
)
returns table(booking_code text, manage_token uuid)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_organization uuid;
  v_performer uuid;
  v_existing_organization uuid;
  v_existing_location uuid;
  v_previous_organization text := current_setting('minuta.booking_organization', true);
  v_previous_location text := current_setting('minuta.booking_location', true);
  v_booking_code text;
  v_manage_token uuid;
begin
  select organization.id
  into v_organization
  from public.organizations organization
  where organization.public_slug = lower(trim(coalesce(p_slug, '')))
    and organization.status = 'active'
    and organization.public_booking_enabled;
  if v_organization is null then
    raise exception using errcode = 'P0001', message = 'organization_unavailable';
  end if;
  if not exists (
    select 1 from public.locations location
    where location.id = p_location
      and location.organization_id = v_organization
      and location.active
      and location.timezone = 'Europe/Samara'
  ) then
    raise exception using errcode = 'P0001', message = 'location_unavailable';
  end if;

  select service.performer_id
  into v_performer
  from public.services service
  join public.organization_memberships membership
    on membership.organization_id = v_organization
   and membership.user_id = service.performer_id
   and membership.active
   and membership.is_bookable
  where service.id = p_service
    and service.active;
  if v_performer is null then
    raise exception using errcode = 'P0001', message = 'service_unavailable';
  end if;

  perform set_config('minuta.booking_organization', v_organization::text, true);
  perform set_config('minuta.booking_location', p_location::text, true);

  begin
    select result.booking_code, result.manage_token
    into v_booking_code, v_manage_token
    from public.book_appointment(
      p_request_id, p_service, p_date, p_time, p_client_name, p_client_phone
    ) result;
  exception when others then
    perform set_config('minuta.booking_organization', coalesce(v_previous_organization, ''), true);
    perform set_config('minuta.booking_location', coalesce(v_previous_location, ''), true);
    raise;
  end;

  perform set_config('minuta.booking_organization', coalesce(v_previous_organization, ''), true);
  perform set_config('minuta.booking_location', coalesce(v_previous_location, ''), true);

  select booking.organization_id, booking.location_id
  into v_existing_organization, v_existing_location
  from public.bookings booking
  where booking.request_id = p_request_id;
  if v_existing_organization is distinct from v_organization
     or v_existing_location is distinct from p_location then
    raise exception using errcode = 'P0001', message = 'request_conflict';
  end if;
  return query select v_booking_code, v_manage_token;
end;
$$;

revoke all on function public.book_minuta_appointment(uuid,text,uuid,uuid,date,time without time zone,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.book_minuta_appointment(uuid,text,uuid,uuid,date,time without time zone,text,text)
  to anon, authenticated;

create or replace function public.get_minuta_team_calendar(
  p_organization uuid,
  p_start date,
  p_end date,
  p_location uuid default null,
  p_performer uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_effective_performer uuid := p_performer;
begin
  if v_user is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 62 then
    raise exception using errcode = '22023', message = 'invalid_calendar_range';
  end if;

  select membership.role
  into v_role
  from public.organization_memberships membership
  join public.organizations organization
    on organization.id = membership.organization_id
   and organization.status = 'active'
  where membership.organization_id = p_organization
    and membership.user_id = v_user
    and membership.active;
  if v_role is null then
    raise exception using errcode = '42501', message = 'organization_access_denied';
  end if;
  if p_location is not null and not exists (
    select 1 from public.locations location
    where location.id = p_location
      and location.organization_id = p_organization
  ) then
    raise exception using errcode = '42501', message = 'foreign_location_denied';
  end if;
  if v_role = 'specialist' then
    if p_performer is not null and p_performer <> v_user then
      raise exception using errcode = '42501', message = 'foreign_performer_denied';
    end if;
    v_effective_performer := v_user;
  elsif p_performer is not null and not exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = p_organization
      and membership.user_id = p_performer
  ) then
    raise exception using errcode = '42501', message = 'foreign_performer_denied';
  end if;

  return jsonb_build_object(
    'organization_id', p_organization,
    'current_role', v_role,
    'can_view_team', v_role in ('owner', 'admin'),
    'schedule_scope', 'performer_global',
    'locations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', location.id,
        'name', location.name,
        'address', location.address,
        'timezone', location.timezone,
        'active', location.active,
        'is_primary', location.is_primary
      ) order by location.is_primary desc, location.name, location.id)
      from public.locations location
      where location.organization_id = p_organization
        and location.active
    ), '[]'::jsonb),
    'performers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', membership.user_id,
        'display_name', profile.display_name,
        'role', membership.role
      ) order by profile.display_name, membership.user_id)
      from public.organization_memberships membership
      join public.performer_profiles profile on profile.id = membership.user_id
      where membership.organization_id = p_organization
        and membership.active
        and membership.is_bookable
        and (v_role in ('owner', 'admin') or membership.user_id = v_user)
    ), '[]'::jsonb),
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', booking.id,
        'booking_code', booking.booking_code,
        'organization_id', booking.organization_id,
        'location_id', booking.location_id,
        'performer_id', booking.performer_id,
        'service_id', booking.service_id,
        'client_name', booking.client_name,
        'client_phone', booking.client_phone,
        'booking_date', booking.booking_date,
        'booking_time', booking.booking_time,
        'duration_minutes', booking.duration_minutes,
        'status', case
          when booking.status = 'cancelled' then 'cancelled'
          when outcome.visit_status in ('completed', 'no_show') then outcome.visit_status
          else booking.status
        end,
        'visit_status', coalesce(outcome.visit_status, 'scheduled'),
        'created_at', booking.created_at,
        'service_name', service.name,
        'performer_name', profile.display_name,
        'location_name', location.name
      ) order by booking.booking_date, booking.booking_time, profile.display_name, booking.id)
      from public.bookings booking
      join public.services service on service.id = booking.service_id
      join public.performer_profiles profile on profile.id = booking.performer_id
      join public.locations location on location.id = booking.location_id
      left join public.booking_outcomes outcome on outcome.booking_id = booking.id
      where booking.organization_id = p_organization
        and booking.booking_date between p_start and p_end
        and (p_location is null or booking.location_id = p_location)
        and (v_effective_performer is null or booking.performer_id = v_effective_performer)
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_minuta_team_calendar(uuid,date,date,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_minuta_team_calendar(uuid,date,date,uuid,uuid)
  to authenticated;

commit;
