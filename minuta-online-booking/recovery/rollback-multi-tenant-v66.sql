begin;

-- A structural rollback is safe only before the management UI has written any
-- organization, location, member, invitation or audit changes. After first use,
-- keep the additive schema and roll back only the application release.
do $$
begin
  if to_regclass('public.organization_invitations') is null
     and to_regclass('public.organization_audit_log') is null
     and to_regprocedure('public.get_minuta_workspace()') is null then
    return;
  end if;
  if to_regclass('public.organization_invitations') is null
     or to_regclass('public.organization_audit_log') is null
     or to_regprocedure('public.get_minuta_workspace()') is null then
    raise exception using errcode = 'P0001', message = 'v66_rollback_blocked_partial_installation';
  end if;
  if exists (select 1 from public.organization_invitations)
     or exists (select 1 from public.organization_audit_log) then
    raise exception using errcode = 'P0001', message = 'v66_rollback_blocked_foundation_is_in_use';
  end if;
end;
$$;

drop function if exists public.accept_minuta_invitation(uuid);
drop function if exists public.cancel_minuta_invitation(uuid);
drop function if exists public.update_minuta_member(uuid, uuid, text, boolean, boolean);
drop function if exists public.invite_minuta_member(uuid, text, text, boolean);
drop function if exists public.update_minuta_location(uuid, text, text, text, boolean, boolean);
drop function if exists public.create_minuta_location(uuid, text, text, text);
drop function if exists public.update_minuta_organization(uuid, text);
drop function if exists public.get_minuta_workspace();

drop trigger if exists organization_memberships_protect_last_owner on public.organization_memberships;
drop function if exists public.protect_minuta_last_owner();

drop function if exists public.log_minuta_organization_event(uuid, uuid, text, text, text, jsonb);
drop table if exists public.organization_audit_log;
drop table if exists public.organization_invitations;

-- Restore the exact v65 signup behavior.
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
    insert into public.organizations (name, public_slug, created_by, legacy_performer_id)
    values (
      coalesce(nullif(trim(new.display_name), ''), 'Организация') || ' — организация',
      'minuta-' || replace(new.id::text, '-', ''),
      new.id,
      new.id
    ) returning id into v_organization;
  end if;

  insert into public.locations (organization_id, name, timezone, is_primary)
  select v_organization, 'Основной филиал', 'Europe/Samara', true
  where not exists (
    select 1 from public.locations location
    where location.organization_id = v_organization and location.is_primary
  );

  insert into public.organization_memberships (
    organization_id, user_id, role, is_bookable, active, created_by
  ) values (v_organization, new.id, 'owner', true, true, new.id)
  on conflict (organization_id, user_id) do nothing;

  return new;
end;
$$;

revoke all on function public.ensure_minuta_organization_foundation()
  from public, anon, authenticated, service_role;

commit;
