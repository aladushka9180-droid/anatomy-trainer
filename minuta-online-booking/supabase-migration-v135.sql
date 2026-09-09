-- v135: optional, organization-private reason for restricting a client's online booking.
begin;
set local lock_timeout='10s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $guard$
begin
  if to_regclass('public.organization_client_profiles') is null
     or to_regprocedure('public.get_minuta_client_profile_v119(uuid,text)') is null
     or to_regprocedure('public.set_minuta_client_online_booking_block_v119(uuid,text,boolean)') is null
     or to_regprocedure('public.save_minuta_client_identity_v134(uuid,text,text,text)') is null then
    raise exception using errcode='55000',message='v135_requires_v119_client_profiles_and_v134_identity';
  end if;
end
$guard$;

alter table public.organization_client_profiles
  add column if not exists online_booking_block_reason text;

do $schema$
begin
  if not exists(select 1 from information_schema.columns
      where table_schema='public' and table_name='organization_client_profiles'
        and column_name='online_booking_block_reason' and data_type='text') then
    raise exception using errcode='55000',message='v135_incompatible_block_reason_column';
  end if;
end
$schema$;

alter table public.organization_client_profiles
  drop constraint if exists organization_client_profiles_block_reason_v135_check,
  add constraint organization_client_profiles_block_reason_v135_check check(
    online_booking_block_reason is null or (
      online_booking_blocked
      and char_length(online_booking_block_reason) between 1 and 500
      and online_booking_block_reason=btrim(online_booking_block_reason)
    )
  );

create or replace function public.get_minuta_client_profile_v135(
  p_organization uuid,
  p_client_phone text
) returns jsonb
language plpgsql stable security definer set search_path to '' as $$
declare
  v_phone text:=public.normalize_client_phone(p_client_phone);
  v_profile public.organization_client_profiles%rowtype;
  v_imported_birthday date;
  v_can_manage boolean:=public.has_organization_role(p_organization,array['owner','admin']::text[]);
begin
  if auth.uid() is null or not public.is_organization_member(p_organization) then
    raise exception using errcode='42501',message='organization_read_denied';
  end if;
  if v_phone !~ '^7[0-9]{10}$' then
    raise exception using errcode='22023',message='invalid_client_phone';
  end if;
  if not exists(select 1 from public.bookings booking where booking.organization_id=p_organization and public.normalize_client_phone(booking.client_phone)=v_phone)
     and not exists(select 1 from public.organization_imported_clients imported where imported.organization_id=p_organization and imported.normalized_phone=v_phone) then
    raise exception using errcode='P0002',message='client_not_found';
  end if;

  select * into v_profile from public.organization_client_profiles
  where organization_id=p_organization and normalized_phone=v_phone;
  select birthday into v_imported_birthday from public.organization_imported_clients
  where organization_id=p_organization and normalized_phone=v_phone;

  return jsonb_build_object(
    'client_phone',v_phone,
    'birthday',case when v_profile.birthday_overridden then v_profile.birthday else v_imported_birthday end,
    'online_booking_blocked',coalesce(v_profile.online_booking_blocked,false),
    'online_booking_block_reason',case when v_can_manage and coalesce(v_profile.online_booking_blocked,false) then v_profile.online_booking_block_reason end,
    'supports_block_reason',true,
    'can_edit',true,
    'can_manage_block',v_can_manage
  );
end $$;

create or replace function public.set_minuta_client_online_booking_block_v135(
  p_organization uuid,
  p_client_phone text,
  p_blocked boolean,
  p_reason text default null
) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare
  v_actor uuid:=auth.uid();
  v_phone text:=public.normalize_client_phone(p_client_phone);
  v_reason text:=nullif(btrim(coalesce(p_reason,'')),'');
  v_row public.organization_client_profiles%rowtype;
  v_imported_birthday date;
begin
  if v_actor is null or not public.has_organization_role(p_organization,array['owner','admin']::text[]) then
    raise exception using errcode='42501',message='organization_manager_required';
  end if;
  if v_phone !~ '^7[0-9]{10}$' or p_blocked is null then
    raise exception using errcode='22023',message='invalid_client_block_request';
  end if;
  if char_length(v_reason)>500 then
    raise exception using errcode='22023',message='client_block_reason_too_long';
  end if;
  if not exists(select 1 from public.bookings booking where booking.organization_id=p_organization and public.normalize_client_phone(booking.client_phone)=v_phone)
     and not exists(select 1 from public.organization_imported_clients imported where imported.organization_id=p_organization and imported.normalized_phone=v_phone) then
    raise exception using errcode='P0002',message='client_not_found';
  end if;

  insert into public.organization_client_profiles(
    organization_id,normalized_phone,online_booking_blocked,online_booking_blocked_at,
    online_booking_blocked_by,online_booking_block_reason,updated_at,updated_by
  ) values(
    p_organization,v_phone,p_blocked,case when p_blocked then clock_timestamp() end,
    case when p_blocked then v_actor end,case when p_blocked then v_reason end,clock_timestamp(),v_actor
  ) on conflict(organization_id,normalized_phone) do update set
    online_booking_blocked=excluded.online_booking_blocked,
    online_booking_blocked_at=excluded.online_booking_blocked_at,
    online_booking_blocked_by=excluded.online_booking_blocked_by,
    online_booking_block_reason=excluded.online_booking_block_reason,
    updated_at=excluded.updated_at,
    updated_by=excluded.updated_by
  returning * into v_row;

  select birthday into v_imported_birthday from public.organization_imported_clients
  where organization_id=p_organization and normalized_phone=v_phone;

  return jsonb_build_object(
    'client_phone',v_phone,
    'birthday',case when v_row.birthday_overridden then v_row.birthday else v_imported_birthday end,
    'online_booking_blocked',v_row.online_booking_blocked,
    'online_booking_block_reason',v_row.online_booking_block_reason,
    'supports_block_reason',true,
    'can_edit',true,
    'can_manage_block',true
  );
end $$;

revoke all on function public.get_minuta_client_profile_v135(uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.set_minuta_client_online_booking_block_v135(uuid,text,boolean,text) from public,anon,authenticated,service_role;
grant execute on function public.get_minuta_client_profile_v135(uuid,text) to authenticated;
grant execute on function public.set_minuta_client_online_booking_block_v135(uuid,text,boolean,text) to authenticated;

notify pgrst,'reload schema';
commit;
