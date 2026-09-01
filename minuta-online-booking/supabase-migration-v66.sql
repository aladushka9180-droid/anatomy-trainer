begin;

-- v66 exposes the v65 organization foundation through narrow, audited RPCs.
-- It does not alter legacy booking, service, schedule, payment or review data.
do $$
begin
  if to_regclass('public.organizations') is null
     or to_regclass('public.locations') is null
     or to_regclass('public.organization_memberships') is null
     or to_regprocedure('public.ensure_minuta_organization_foundation()') is null then
    raise exception using errcode = 'P0001', message = 'v66_requires_v65';
  end if;
  if exists (select 1 from public.organizations where public_booking_enabled) then
    raise exception using errcode = 'P0001', message = 'v66_requires_public_booking_disabled';
  end if;
end;
$$;

create table if not exists public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null check (char_length(email) between 3 and 320),
  role text not null check (role in ('owner', 'admin', 'specialist')),
  is_bookable boolean not null default true,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'cancelled', 'expired')),
  created_by uuid references auth.users(id) on delete set null,
  accepted_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '14 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists organization_invitations_one_pending_email_idx
  on public.organization_invitations (organization_id, lower(email))
  where status = 'pending';

create index if not exists organization_invitations_pending_email_idx
  on public.organization_invitations (lower(email), expires_at)
  where status = 'pending';

create table if not exists public.organization_audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action in (
    'organization_updated',
    'location_created',
    'location_updated',
    'member_invited',
    'member_joined',
    'member_updated',
    'invitation_cancelled'
  )),
  subject_type text not null check (subject_type in ('organization', 'location', 'member', 'invitation')),
  subject_id text not null default '' check (char_length(subject_id) <= 120),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists organization_audit_log_recent_idx
  on public.organization_audit_log (organization_id, created_at desc);

create or replace function public.protect_minuta_last_owner()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_organization uuid := old.organization_id;
begin
  if old.role <> 'owner' or not old.active then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE'
     and new.organization_id = old.organization_id
     and new.role = 'owner'
     and new.active then
    return new;
  end if;

  -- The organization row is the shared serialization lock for RPC, service-role
  -- and cascade paths. If the organization itself is already being deleted,
  -- its membership cascade is allowed to continue.
  perform 1
  from public.organizations organization
  where organization.id = v_organization
  for update;
  if not found then
    return coalesce(new, old);
  end if;

  if not exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = v_organization
      and membership.user_id <> old.user_id
      and membership.role = 'owner'
      and membership.active
  ) then
    raise exception using errcode = '23514', message = 'last_owner_must_remain';
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function public.protect_minuta_last_owner()
  from public, anon, authenticated, service_role;

drop trigger if exists organization_memberships_protect_last_owner on public.organization_memberships;
create trigger organization_memberships_protect_last_owner
before update of organization_id, role, active or delete on public.organization_memberships
for each row execute function public.protect_minuta_last_owner();

drop trigger if exists organization_invitations_touch_updated_at on public.organization_invitations;
create trigger organization_invitations_touch_updated_at
before update on public.organization_invitations
for each row execute function public.touch_minuta_organization_updated_at();

alter table public.organization_invitations enable row level security;
alter table public.organization_audit_log enable row level security;

revoke all on table public.organization_invitations, public.organization_audit_log
  from public, anon, authenticated;
grant select, insert, update, delete on table public.organization_invitations, public.organization_audit_log
  to service_role;

create or replace function public.log_minuta_organization_event(
  p_organization uuid,
  p_actor uuid,
  p_action text,
  p_subject_type text,
  p_subject_id text,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  insert into public.organization_audit_log (
    organization_id, actor_id, action, subject_type, subject_id, details
  ) values (
    p_organization,
    p_actor,
    p_action,
    p_subject_type,
    left(coalesce(p_subject_id, ''), 120),
    coalesce(p_details, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.log_minuta_organization_event(uuid, uuid, text, text, text, jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.get_minuta_workspace()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_actor uuid := auth.uid();
  v_result jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  select coalesce(jsonb_agg(entry.workspace order by entry.sort_order, entry.name), '[]'::jsonb)
  into v_result
  from (
    select
      case membership.role when 'owner' then 1 when 'admin' then 2 else 3 end as sort_order,
      organization.name,
      jsonb_build_object(
        'id', organization.id,
        'name', organization.name,
        'public_slug', organization.public_slug,
        'status', organization.status,
        'public_booking_enabled', organization.public_booking_enabled,
        'current_role', membership.role,
        'can_manage', membership.role in ('owner', 'admin'),
        'locations', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', location.id,
            'name', location.name,
            'timezone', location.timezone,
            'address', location.address,
            'active', location.active,
            'is_primary', location.is_primary
          ) order by location.is_primary desc, location.active desc, location.created_at, location.id)
          from public.locations location
          where location.organization_id = organization.id
            and (membership.role in ('owner', 'admin') or location.active)
        ), '[]'::jsonb),
        'members', coalesce((
          select jsonb_agg(jsonb_build_object(
            'user_id', team_member.user_id,
            'display_name', coalesce(
              nullif(trim(profile.display_name), ''),
              nullif(trim(account.raw_user_meta_data ->> 'display_name'), ''),
              split_part(coalesce(account.email, ''), '@', 1),
              'Сотрудник'
            ),
            'email', case
              when membership.role in ('owner', 'admin') or team_member.user_id = v_actor
                then coalesce(account.email, '')
              else ''
            end,
            'role', team_member.role,
            'is_bookable', team_member.is_bookable,
            'active', team_member.active,
            'is_current_user', team_member.user_id = v_actor
          ) order by
            case team_member.role when 'owner' then 1 when 'admin' then 2 else 3 end,
            coalesce(profile.display_name, account.email, team_member.user_id::text)
          )
          from public.organization_memberships team_member
          left join public.performer_profiles profile on profile.id = team_member.user_id
          left join auth.users account on account.id = team_member.user_id
          where team_member.organization_id = organization.id
            and (
              membership.role in ('owner', 'admin')
              or team_member.user_id = v_actor
            )
        ), '[]'::jsonb),
        'invitations', case when membership.role in ('owner', 'admin') then coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', invitation.id,
            'email', invitation.email,
            'role', invitation.role,
            'is_bookable', invitation.is_bookable,
            'expires_at', invitation.expires_at
          ) order by invitation.created_at desc, invitation.id)
          from public.organization_invitations invitation
          where invitation.organization_id = organization.id
            and invitation.status = 'pending'
            and invitation.expires_at > now()
        ), '[]'::jsonb) else '[]'::jsonb end,
        'audit', case when membership.role in ('owner', 'admin') then coalesce((
          select jsonb_agg(audit_row.item order by audit_row.created_at desc, audit_row.id desc)
          from (
            select
              audit.id,
              audit.created_at,
              jsonb_build_object(
                'id', audit.id,
                'actor_id', audit.actor_id,
                'action', audit.action,
                'subject_type', audit.subject_type,
                'subject_id', audit.subject_id,
                'details', audit.details,
                'created_at', audit.created_at
              ) as item
            from public.organization_audit_log audit
            where audit.organization_id = organization.id
            order by audit.created_at desc, audit.id desc
            limit 20
          ) audit_row
        ), '[]'::jsonb) else '[]'::jsonb end
      ) as workspace
    from public.organization_memberships membership
    join public.organizations organization
      on organization.id = membership.organization_id
     and organization.status = 'active'
    where membership.user_id = v_actor
      and membership.active
  ) entry;

  return jsonb_build_object(
    'available', true,
    'foundation_version', 66,
    'organizations', v_result,
    'pending_invitations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', invitation.id,
        'organization_id', invitation.organization_id,
        'organization_name', organization.name,
        'role', invitation.role,
        'is_bookable', invitation.is_bookable,
        'expires_at', invitation.expires_at
      ) order by invitation.created_at, invitation.id)
      from auth.users account
      join public.organization_invitations invitation
        on lower(invitation.email) = lower(account.email)
       and invitation.status = 'pending'
       and invitation.expires_at > now()
      join public.organizations organization
        on organization.id = invitation.organization_id
       and organization.status = 'active'
      where account.id = v_actor
        and account.email_confirmed_at is not null
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.update_minuta_organization(
  p_organization uuid,
  p_name text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_actor uuid := auth.uid();
  v_name text := trim(coalesce(p_name, ''));
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if not public.has_organization_role(p_organization, array['owner', 'admin']::text[]) then
    raise exception using errcode = '42501', message = 'organization_manage_denied';
  end if;
  if char_length(v_name) not between 2 and 120 then
    raise exception using errcode = '22023', message = 'organization_name_invalid';
  end if;

  update public.organizations
  set name = v_name
  where id = p_organization
    and status = 'active';
  if not found then
    raise exception using errcode = 'P0002', message = 'organization_not_found';
  end if;

  perform public.log_minuta_organization_event(
    p_organization, v_actor, 'organization_updated', 'organization', p_organization::text,
    jsonb_build_object('name_changed', true)
  );
  return public.get_minuta_workspace();
end;
$$;

create or replace function public.create_minuta_location(
  p_organization uuid,
  p_name text,
  p_address text default '',
  p_timezone text default 'Europe/Samara'
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_actor uuid := auth.uid();
  v_location uuid;
  v_name text := trim(coalesce(p_name, ''));
  v_address text := trim(coalesce(p_address, ''));
  v_timezone text := trim(coalesce(p_timezone, ''));
  v_primary boolean;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if not public.has_organization_role(p_organization, array['owner', 'admin']::text[]) then
    raise exception using errcode = '42501', message = 'organization_manage_denied';
  end if;
  if char_length(v_name) not between 2 and 120 or char_length(v_address) > 500 then
    raise exception using errcode = '22023', message = 'location_fields_invalid';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = v_timezone) then
    raise exception using errcode = '22023', message = 'location_timezone_invalid';
  end if;

  perform 1 from public.organizations where id = p_organization and status = 'active' for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'organization_not_found';
  end if;
  v_primary := not exists (
    select 1 from public.locations where organization_id = p_organization and is_primary
  );

  insert into public.locations (organization_id, name, timezone, address, active, is_primary)
  values (p_organization, v_name, v_timezone, v_address, true, v_primary)
  returning id into v_location;

  perform public.log_minuta_organization_event(
    p_organization, v_actor, 'location_created', 'location', v_location::text,
    jsonb_build_object('is_primary', v_primary)
  );
  return public.get_minuta_workspace();
end;
$$;

create or replace function public.update_minuta_location(
  p_location uuid,
  p_name text,
  p_address text,
  p_timezone text,
  p_active boolean,
  p_is_primary boolean
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_actor uuid := auth.uid();
  v_organization uuid;
  v_was_primary boolean;
  v_name text := trim(coalesce(p_name, ''));
  v_address text := trim(coalesce(p_address, ''));
  v_timezone text := trim(coalesce(p_timezone, ''));
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  select location.organization_id, location.is_primary
  into v_organization, v_was_primary
  from public.locations location
  where location.id = p_location
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'location_not_found';
  end if;
  if not public.has_organization_role(v_organization, array['owner', 'admin']::text[]) then
    raise exception using errcode = '42501', message = 'organization_manage_denied';
  end if;
  if char_length(v_name) not between 2 and 120 or char_length(v_address) > 500 then
    raise exception using errcode = '22023', message = 'location_fields_invalid';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = v_timezone) then
    raise exception using errcode = '22023', message = 'location_timezone_invalid';
  end if;
  if p_is_primary and not p_active then
    raise exception using errcode = '22023', message = 'primary_location_must_be_active';
  end if;
  if v_was_primary and not p_is_primary then
    raise exception using errcode = '22023', message = 'select_another_primary_first';
  end if;

  if p_is_primary and not v_was_primary then
    update public.locations
    set is_primary = false
    where organization_id = v_organization
      and is_primary;
  end if;

  update public.locations
  set name = v_name,
      address = v_address,
      timezone = v_timezone,
      active = p_active,
      is_primary = p_is_primary
  where id = p_location;

  perform public.log_minuta_organization_event(
    v_organization, v_actor, 'location_updated', 'location', p_location::text,
    jsonb_build_object('active', p_active, 'is_primary', p_is_primary)
  );
  return public.get_minuta_workspace();
end;
$$;

create or replace function public.invite_minuta_member(
  p_organization uuid,
  p_email text,
  p_role text default 'specialist',
  p_is_bookable boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role text;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_target uuid;
  v_invitation uuid;
  v_status text;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  select membership.role into v_actor_role
  from public.organization_memberships membership
  join public.organizations organization on organization.id = membership.organization_id and organization.status = 'active'
  where membership.organization_id = p_organization
    and membership.user_id = v_actor
    and membership.active;
  if v_actor_role not in ('owner', 'admin') then
    raise exception using errcode = '42501', message = 'organization_manage_denied';
  end if;
  if p_role not in ('owner', 'admin', 'specialist') then
    raise exception using errcode = '22023', message = 'member_role_invalid';
  end if;
  if v_actor_role = 'admin' and p_role <> 'specialist' then
    raise exception using errcode = '42501', message = 'admin_can_invite_specialist_only';
  end if;
  if char_length(v_email) > 320 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception using errcode = '22023', message = 'member_email_invalid';
  end if;

  -- The same email lock is taken by the profile trigger below. If signup and
  -- invitation run concurrently, the profile can only continue after the
  -- invitation is visible and therefore cannot create an unwanted personal org.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_email, 66));

  perform 1
  from public.organizations organization
  where organization.id = p_organization
    and organization.status = 'active'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'organization_not_found';
  end if;

  select account.id into v_target
  from auth.users account
  where lower(account.email) = v_email
  order by account.created_at
  limit 1;

  if v_target is not null and exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = p_organization
      and membership.user_id = v_target
  ) then
    return jsonb_build_object('status', 'already_member', 'workspace', public.get_minuta_workspace());
  end if;

  update public.organization_invitations
  set role = p_role,
      is_bookable = p_is_bookable,
      created_by = v_actor,
      expires_at = now() + interval '14 days'
  where organization_id = p_organization
    and lower(email) = v_email
    and status = 'pending'
  returning id into v_invitation;

  if v_invitation is null then
    insert into public.organization_invitations (
      organization_id, email, role, is_bookable, created_by
    ) values (
      p_organization, v_email, p_role, p_is_bookable, v_actor
    ) returning id into v_invitation;
  end if;
  perform public.log_minuta_organization_event(
    p_organization, v_actor, 'member_invited', 'invitation', v_invitation::text,
    jsonb_build_object('role', p_role, 'is_bookable', p_is_bookable)
  );
  v_status := 'pending';

  return jsonb_build_object('status', v_status, 'workspace', public.get_minuta_workspace());
end;
$$;

create or replace function public.update_minuta_member(
  p_organization uuid,
  p_user uuid,
  p_role text,
  p_is_bookable boolean,
  p_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role text;
  v_current_role text;
  v_current_active boolean;
  v_owner_count integer;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if p_role not in ('owner', 'admin', 'specialist') then
    raise exception using errcode = '22023', message = 'member_role_invalid';
  end if;

  select membership.role into v_actor_role
  from public.organization_memberships membership
  join public.organizations organization on organization.id = membership.organization_id and organization.status = 'active'
  where membership.organization_id = p_organization
    and membership.user_id = v_actor
    and membership.active;
  if v_actor_role not in ('owner', 'admin') then
    raise exception using errcode = '42501', message = 'organization_manage_denied';
  end if;

  perform 1
  from public.organizations organization
  where organization.id = p_organization
    and organization.status = 'active'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'organization_not_found';
  end if;

  select membership.role, membership.active
  into v_current_role, v_current_active
  from public.organization_memberships membership
  where membership.organization_id = p_organization
    and membership.user_id = p_user
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'member_not_found';
  end if;
  if v_actor_role = 'admin' and (v_current_role <> 'specialist' or p_role <> 'specialist') then
    raise exception using errcode = '42501', message = 'admin_can_manage_specialists_only';
  end if;

  if v_current_role = 'owner' and v_current_active and (p_role <> 'owner' or not p_active) then
    select count(*) into v_owner_count
    from public.organization_memberships membership
    where membership.organization_id = p_organization
      and membership.role = 'owner'
      and membership.active;
    if v_owner_count <= 1 then
      raise exception using errcode = '22023', message = 'last_owner_must_remain';
    end if;
  end if;

  update public.organization_memberships
  set role = p_role,
      is_bookable = p_is_bookable,
      active = p_active
  where organization_id = p_organization
    and user_id = p_user;

  perform public.log_minuta_organization_event(
    p_organization, v_actor, 'member_updated', 'member', p_user::text,
    jsonb_build_object('role', p_role, 'is_bookable', p_is_bookable, 'active', p_active)
  );
  return public.get_minuta_workspace();
end;
$$;

create or replace function public.cancel_minuta_invitation(p_invitation uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_actor uuid := auth.uid();
  v_organization uuid;
  v_invitation_role text;
  v_actor_role text;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  select invitation.organization_id, invitation.role into v_organization, v_invitation_role
  from public.organization_invitations invitation
  where invitation.id = p_invitation
    and invitation.status = 'pending'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'invitation_not_found';
  end if;
  select membership.role into v_actor_role
  from public.organization_memberships membership
  join public.organizations organization on organization.id = membership.organization_id and organization.status = 'active'
  where membership.organization_id = v_organization
    and membership.user_id = v_actor
    and membership.active;
  if v_actor_role not in ('owner', 'admin') then
    raise exception using errcode = '42501', message = 'organization_manage_denied';
  end if;
  if v_actor_role = 'admin' and v_invitation_role <> 'specialist' then
    raise exception using errcode = '42501', message = 'admin_can_cancel_specialist_only';
  end if;

  update public.organization_invitations
  set status = 'cancelled'
  where id = p_invitation;
  perform public.log_minuta_organization_event(
    v_organization, v_actor, 'invitation_cancelled', 'invitation', p_invitation::text, '{}'::jsonb
  );
  return public.get_minuta_workspace();
end;
$$;

create or replace function public.accept_minuta_invitation(p_invitation uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_actor uuid := auth.uid();
  v_email text;
  v_invitation public.organization_invitations%rowtype;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  select lower(account.email) into v_email
  from auth.users account
  where account.id = v_actor
    and account.email_confirmed_at is not null;
  if v_email is null then
    raise exception using errcode = '42501', message = 'confirmed_email_required';
  end if;

  select invitation.* into v_invitation
  from public.organization_invitations invitation
  join public.organizations organization
    on organization.id = invitation.organization_id
   and organization.status = 'active'
  where invitation.id = p_invitation
    and lower(invitation.email) = v_email
    and invitation.status = 'pending'
    and invitation.expires_at > now()
  for update of invitation;
  if not found then
    raise exception using errcode = 'P0002', message = 'invitation_not_found';
  end if;

  insert into public.organization_memberships (
    organization_id, user_id, role, is_bookable, active, created_by
  ) values (
    v_invitation.organization_id,
    v_actor,
    v_invitation.role,
    v_invitation.is_bookable,
    true,
    v_invitation.created_by
  )
  on conflict (organization_id, user_id) do update
  set role = excluded.role,
      is_bookable = excluded.is_bookable,
      active = true;

  update public.organization_invitations
  set status = 'accepted', accepted_by = v_actor
  where id = v_invitation.id;

  perform public.log_minuta_organization_event(
    v_invitation.organization_id,
    v_actor,
    'member_joined',
    'member',
    v_actor::text,
    jsonb_build_object('role', v_invitation.role, 'is_bookable', v_invitation.is_bookable)
  );
  return public.get_minuta_workspace();
end;
$$;

-- A pending invitation suppresses creation of an unwanted personal organization,
-- but does not grant access. The confirmed user must explicitly accept it.
create or replace function public.ensure_minuta_organization_foundation()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_organization uuid;
  v_email text;
begin
  if exists (
    select 1 from public.organization_memberships membership
    where membership.user_id = new.id and membership.active
  ) then
    return new;
  end if;

  select lower(account.email) into v_email
  from auth.users account
  where account.id = new.id;
  if v_email is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_email, 66));
  end if;
  if v_email is not null and exists (
    select 1
    from public.organization_invitations invitation
    join public.organizations organization
      on organization.id = invitation.organization_id
     and organization.status = 'active'
    where lower(invitation.email) = v_email
      and invitation.status = 'pending'
      and invitation.expires_at > now()
  ) then
    return new;
  end if;

  select organization.id into v_organization
  from public.organizations organization
  where organization.legacy_performer_id = new.id;
  if v_organization is null then
    insert into public.organizations (name, public_slug, created_by, legacy_performer_id)
    values (
      coalesce(nullif(trim(new.display_name), ''), 'Организация') || ' — организация',
      'minuta-' || replace(new.id::text, '-', ''), new.id, new.id
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
revoke all on function public.get_minuta_workspace() from public, anon, authenticated, service_role;
revoke all on function public.update_minuta_organization(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.create_minuta_location(uuid, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.update_minuta_location(uuid, text, text, text, boolean, boolean) from public, anon, authenticated, service_role;
revoke all on function public.invite_minuta_member(uuid, text, text, boolean) from public, anon, authenticated, service_role;
revoke all on function public.update_minuta_member(uuid, uuid, text, boolean, boolean) from public, anon, authenticated, service_role;
revoke all on function public.cancel_minuta_invitation(uuid) from public, anon, authenticated, service_role;
revoke all on function public.accept_minuta_invitation(uuid) from public, anon, authenticated, service_role;

grant execute on function public.get_minuta_workspace() to authenticated;
grant execute on function public.update_minuta_organization(uuid, text) to authenticated;
grant execute on function public.create_minuta_location(uuid, text, text, text) to authenticated;
grant execute on function public.update_minuta_location(uuid, text, text, text, boolean, boolean) to authenticated;
grant execute on function public.invite_minuta_member(uuid, text, text, boolean) to authenticated;
grant execute on function public.update_minuta_member(uuid, uuid, text, boolean, boolean) to authenticated;
grant execute on function public.cancel_minuta_invitation(uuid) to authenticated;
grant execute on function public.accept_minuta_invitation(uuid) to authenticated;

commit;
