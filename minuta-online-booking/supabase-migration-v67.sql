begin;

-- v67 installs the public multi-specialist catalog and atomically activates the
-- one configured legacy tenant. Any failure rolls back both changes together.
do $$
begin
  if to_regclass('public.organizations') is null
     or to_regclass('public.organization_memberships') is null
     or to_regclass('public.organization_invitations') is null
     or to_regprocedure('public.get_minuta_workspace()') is null then
    raise exception using errcode = 'P0001', message = 'v67_requires_v66';
  end if;
end;
$$;

create or replace function public.get_public_minuta_catalog(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce((
    select jsonb_build_object(
      'organization', jsonb_build_object(
        'name', organization.name,
        'public_slug', organization.public_slug
      ),
      'locations', coalesce((
        select jsonb_agg(jsonb_build_object(
          'name', location.name,
          'address', location.address,
          'timezone', location.timezone,
          'is_primary', location.is_primary
        ) order by location.is_primary desc, location.name)
        from public.locations location
        where location.organization_id = organization.id
          and location.active
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

revoke all on function public.get_public_minuta_catalog(text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_public_minuta_catalog(text) to anon, authenticated;

do $$
declare
  v_target_count integer;
begin
  if exists (
    select 1
    from public.organizations
    where public_booking_enabled
      and public_slug <> 'minuta-abeb5b13ca1d45c6a2adb0e4119b2e1f'
  ) then
    raise exception using errcode = 'P0001', message = 'v67_unexpected_public_organization';
  end if;

  select count(*)
  into v_target_count
  from public.organizations
  where public_slug = 'minuta-abeb5b13ca1d45c6a2adb0e4119b2e1f'
    and status = 'active';
  if v_target_count <> 1 then
    raise exception using errcode = 'P0001', message = 'v67_default_public_organization_not_found';
  end if;

  update public.organizations
  set public_booking_enabled = true
  where public_slug = 'minuta-abeb5b13ca1d45c6a2adb0e4119b2e1f'
    and status = 'active'
    and not public_booking_enabled;
end;
$$;

commit;
