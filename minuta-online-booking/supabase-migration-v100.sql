\set ON_ERROR_STOP on

begin;
set local lock_timeout='5s';
set local statement_timeout='10min';
set local search_path=public,extensions,pg_catalog;

-- Keep the existing function identities, owners and ACLs while replacing only
-- the authorization implementations. This makes the repair safe for live
-- installations where these RPCs are already exposed through PostgREST.
create temporary table v100_function_contract on commit drop as
with expected(signature) as (
  values
    ('public.invite_minuta_member(uuid,text,text,boolean)'),
    ('public.update_minuta_member(uuid,uuid,text,boolean,boolean)'),
    ('public.cancel_minuta_invitation(uuid)'),
    ('public.require_minuta_resource_manager(uuid)'),
    ('public.get_minuta_benefit_role(uuid)'),
    ('public.get_minuta_booking_policy_role(uuid)'),
    ('public.get_minuta_group_booking_role(uuid)'),
    ('public.get_minuta_loyalty_role(uuid)'),
    ('public.require_minuta_retention_manager(uuid)'),
    ('public.require_minuta_batch_booking_role(uuid)'),
    ('public.get_minuta_booking_events(uuid,date,date,integer)'),
    ('public.get_minuta_booking_events_v97(uuid,date,date,integer,integer)')
)
select expected.signature,p.oid,p.proowner,p.proacl::text as acl
from expected
left join pg_proc p on p.oid=to_regprocedure(expected.signature);

do $$
begin
  if (select count(*) from v100_function_contract)<>12
     or exists(select 1 from v100_function_contract where oid is null) then
    raise exception using errcode='P0001',message='v100_missing_authorization_prerequisites';
  end if;
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
  if v_actor_role is null or v_actor_role not in ('owner', 'admin') then
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
  if v_actor_role is null or v_actor_role not in ('owner', 'admin') then
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
  if v_actor_role is null or v_actor_role not in ('owner', 'admin') then
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

create or replace function public.get_minuta_benefit_role(p_organization uuid)
returns text language plpgsql stable security definer set search_path to '' as $$
declare v_role text;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication_required'; end if;
  select membership.role into v_role from public.organization_memberships membership
  join public.organizations organization on organization.id=membership.organization_id and organization.status='active'
  where membership.organization_id=p_organization and membership.user_id=auth.uid() and membership.active;
  if v_role is null or v_role not in ('owner','admin') then raise exception using errcode='42501',message='benefit_management_denied'; end if;
  return v_role;
end $$;

create or replace function public.get_minuta_booking_policy_role(p_organization uuid)
returns text language plpgsql stable security definer set search_path to '' as $$
declare v_role text;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication_required'; end if;
  select membership.role into v_role from public.organization_memberships membership
  join public.organizations organization on organization.id=membership.organization_id and organization.status='active'
  where membership.organization_id=p_organization and membership.user_id=auth.uid() and membership.active;
  if v_role is null or v_role not in ('owner','admin') then raise exception using errcode='42501',message='booking_policy_management_denied'; end if;
  return v_role;
end $$;

create or replace function public.get_minuta_group_booking_role(p_organization uuid)
returns text language plpgsql stable security definer set search_path to '' as $$
declare v_role text;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication_required'; end if;
  select membership.role into v_role from public.organization_memberships membership
  join public.organizations organization on organization.id=membership.organization_id and organization.status='active'
  where membership.organization_id=p_organization and membership.user_id=auth.uid() and membership.active;
  if v_role is null or v_role not in ('owner','admin','specialist') then raise exception using errcode='42501',message='group_booking_management_denied'; end if;
  return v_role;
end $$;

create or replace function public.get_minuta_loyalty_role(p_organization uuid)
returns text language plpgsql stable security definer set search_path to '' as $$
declare v_role text;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication_required'; end if;
  select membership.role into v_role from public.organization_memberships membership
  join public.organizations organization on organization.id=membership.organization_id and organization.status='active'
  where membership.organization_id=p_organization and membership.user_id=auth.uid() and membership.active;
  if v_role is null or v_role not in ('owner','admin') then raise exception using errcode='42501',message='loyalty_management_denied'; end if;
  return v_role;
end $$;

create or replace function public.require_minuta_retention_manager(p_organization uuid)
returns text language plpgsql stable security definer set search_path to '' as $$
declare v_role text;
begin
  select membership.role into v_role
  from public.organization_memberships membership
  join public.organizations organization on organization.id=membership.organization_id and organization.status='active'
  where membership.organization_id=p_organization and membership.user_id=auth.uid() and membership.active;
  if v_role is null or v_role not in ('owner','admin') then
    raise exception using errcode='42501',message='retention_manager_required';
  end if;
  return v_role;
end $$;

create or replace function public.require_minuta_batch_booking_role(p_organization uuid)
returns text language plpgsql stable security definer set search_path to '' as $$
declare v_role text;
begin
  if auth.uid() is null then
    raise exception using errcode='42501',message='authentication_required';
  end if;
  select membership.role into v_role
  from public.organization_memberships membership
  join public.organizations organization on organization.id=membership.organization_id and organization.status='active'
  where membership.organization_id=p_organization and membership.user_id=auth.uid() and membership.active;
  if v_role is null or v_role not in ('owner','admin','specialist') then
    raise exception using errcode='42501',message='batch_booking_access_denied';
  end if;
  return v_role;
end $$;

create or replace function public.get_minuta_booking_events(p_organization uuid,p_start date,p_end date,p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_user uuid:=auth.uid(); v_role text; v_events jsonb;
begin
  if v_user is null then raise exception using errcode='42501',message='authentication_required'; end if;
  if p_organization is null or p_start is null or p_end is null or p_end<p_start or p_end-p_start>3660 or p_limit not between 1 and 500 then raise exception using errcode='22023',message='invalid_event_range'; end if;
  select membership.role into v_role
  from public.organization_memberships membership
  join public.organizations organization on organization.id=membership.organization_id and organization.status='active'
  where membership.organization_id=p_organization and membership.user_id=v_user and membership.active;
  if v_role is null or v_role not in ('owner','admin','specialist') then raise exception using errcode='42501',message='event_access_denied'; end if;
  select coalesce(jsonb_agg(row_value order by event_time desc,event_id desc),'[]'::jsonb) into v_events from (
    select jsonb_build_object('id',event.id,'event_type',event.event_type,'occurred_at',event.occurred_at,'booking_id',event.booking_id,'booking_date',event.booking_date,'previous_booking_date',event.previous_booking_date,'client_name',coalesce(booking.client_name,'Клиент'),'service_name',coalesce(service.name,'Услуга'),'performer_name',coalesce(performer.display_name,'Мастер'),'actor_name',coalesce(actor.display_name,case event.actor_role when 'client' then 'Клиент' when 'system' then 'Система' else 'Сотрудник' end),'actor_role',event.actor_role,'delta_planned_rub',event.delta_planned_rub,'delta_completed_rub',event.delta_completed_rub,'delta_received_rub',event.delta_received_rub,'delta_duration_minutes',event.delta_duration_minutes,'details',event.details) as row_value,event.occurred_at as event_time,event.id as event_id
    from public.booking_events event join public.bookings booking on booking.id=event.booking_id left join public.services service on service.id=booking.service_id left join public.performer_profiles performer on performer.id=event.performer_id left join public.performer_profiles actor on actor.id=event.actor_user_id
    where event.organization_id=p_organization and (event.booking_date between p_start and p_end or event.previous_booking_date between p_start and p_end) and (v_role in ('owner','admin') or event.performer_id=v_user)
    order by event.occurred_at desc,event.id desc limit p_limit
  ) source;
  return jsonb_build_object('available_since',(select min(occurred_at)::date from public.booking_events where organization_id=p_organization),'events',v_events);
end $$;

create or replace function public.get_minuta_booking_events_v97(
  p_organization uuid,p_start date,p_end date,p_limit integer,p_offset integer
)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_user uuid:=auth.uid(); v_role text; v_events jsonb; v_has_more boolean;
begin
  if v_user is null then raise exception using errcode='42501',message='authentication_required'; end if;
  if p_organization is null or p_start is null or p_end is null or p_end<p_start or p_end-p_start>3660
     or p_limit is null or p_limit<1 or p_limit>500 or p_offset is null or p_offset<0 or p_offset>100000 then
    raise exception using errcode='22023',message='invalid_event_range';
  end if;
  select membership.role into v_role
  from public.organization_memberships membership
  join public.organizations organization on organization.id=membership.organization_id and organization.status='active'
  where membership.organization_id=p_organization and membership.user_id=v_user and membership.active limit 1;
  if v_role is null or v_role not in ('owner','admin','specialist') then raise exception using errcode='42501',message='event_access_denied'; end if;
  with page as materialized (
    select event.*,booking.client_name,service.name service_name,performer.display_name performer_name,actor.display_name actor_name,
      row_number() over(order by event.occurred_at desc,event.id desc) page_number
    from public.booking_events event
    left join public.bookings booking on booking.id=event.booking_id
    left join public.services service on service.id=booking.service_id
    left join public.performer_profiles performer on performer.id=event.performer_id
    left join public.performer_profiles actor on actor.id=event.actor_user_id
    where event.organization_id=p_organization
      and (event.booking_date between p_start and p_end or event.previous_booking_date between p_start and p_end)
      and (v_role in ('owner','admin') or event.performer_id=v_user)
    order by event.occurred_at desc,event.id desc limit p_limit+1 offset p_offset
  ), payload as (
    select page_number,jsonb_build_object('id',id,'event_type',event_type,'occurred_at',occurred_at,'booking_id',booking_id,
      'booking_date',booking_date,'previous_booking_date',previous_booking_date,'performer_id',performer_id,
      'client_name',coalesce(client_name_snapshot,client_name,'Клиент'),'service_name',coalesce(service_name_snapshot,service_name,'Услуга'),
      'performer_name',coalesce(performer_name_snapshot,performer_name,'Мастер'),'actor_name',coalesce(actor_name,case actor_role when 'client' then 'Клиент' when 'system' then 'Система' else 'Сотрудник' end),
      'actor_role',actor_role,'delta_planned_rub',delta_planned_rub,'delta_completed_rub',delta_completed_rub,
      'delta_received_rub',delta_received_rub,'delta_duration_minutes',delta_duration_minutes,'details',details) row_value
    from page
  )
  select coalesce(jsonb_agg(row_value order by page_number) filter(where page_number<=p_limit),'[]'::jsonb),coalesce(bool_or(page_number>p_limit),false)
  into v_events,v_has_more from payload;
  return jsonb_build_object('available_since',(select min(occurred_at)::date from public.booking_events where organization_id=p_organization),
    'events',v_events,'has_more',v_has_more,'next_offset',case when v_has_more then p_offset+p_limit else null end);
end;
$$;

do $$
begin
  if exists (
    select 1
    from v100_function_contract original
    left join pg_proc current_function on current_function.oid=to_regprocedure(original.signature)
    where current_function.oid is null
       or current_function.oid is distinct from original.oid
       or current_function.proowner is distinct from original.proowner
       or current_function.proacl::text is distinct from original.acl
  ) then
    raise exception using errcode='P0001',message='v100_function_contract_changed';
  end if;
end;
$$;

commit;
