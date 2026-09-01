begin;

-- v65 does not alter legacy booking data. This rollback removes only the additive
-- organization foundation while the v66 tenant-aware UI is still disabled. Refuse
-- rollback as soon as team, location or public-booking data has been customized.
do $$
begin
  if to_regclass('public.organizations') is null
     and to_regclass('public.locations') is null
     and to_regclass('public.organization_memberships') is null then
    return;
  end if;

  if to_regclass('public.organizations') is null
     or to_regclass('public.locations') is null
     or to_regclass('public.organization_memberships') is null then
    raise exception using
      errcode = 'P0001',
      message = 'v65_rollback_blocked_partial_foundation';
  end if;

  if exists (
      select 1
      from public.organizations organization
      left join public.performer_profiles profile on profile.id = organization.legacy_performer_id
      where organization.legacy_performer_id is null
         or organization.status <> 'active'
         or organization.public_booking_enabled
         or organization.name <> coalesce(nullif(trim(profile.display_name), ''), 'Организация') || ' — организация'
         or organization.public_slug <> 'minuta-' || replace(profile.id::text, '-', '')
         or organization.created_by is distinct from profile.id
    )
    or exists (
      select 1
      from public.organization_memberships membership
      join public.organizations organization on organization.id = membership.organization_id
      where organization.legacy_performer_id is null
         or membership.user_id <> organization.legacy_performer_id
         or membership.role <> 'owner'
         or not membership.is_bookable
         or not membership.active
         or membership.created_by is distinct from organization.legacy_performer_id
    )
    or exists (
      select 1
      from public.locations location
      join public.organizations organization on organization.id = location.organization_id
      where organization.legacy_performer_id is null
         or not location.is_primary
         or location.name <> 'Основной филиал'
         or location.timezone <> 'Europe/Samara'
         or location.address <> ''
         or not location.active
    )
    or exists (
      select 1
      from public.organizations organization
      where (select count(*) from public.organization_memberships membership where membership.organization_id = organization.id) <> 1
         or (select count(*) from public.locations location where location.organization_id = organization.id) <> 1
    ) then
    raise exception using
      errcode = 'P0001',
      message = 'v65_rollback_blocked_foundation_is_in_use';
  end if;
end;
$$;

drop trigger if exists performer_profiles_organization_foundation on public.performer_profiles;
drop function if exists public.ensure_minuta_organization_foundation();

drop table if exists public.organization_memberships;
drop table if exists public.locations;
drop table if exists public.organizations;

drop function if exists public.has_organization_role(uuid, text[]);
drop function if exists public.is_organization_member(uuid);
drop function if exists public.touch_minuta_organization_updated_at();

commit;
