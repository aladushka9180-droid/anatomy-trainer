\set ON_ERROR_STOP on

begin;
set local search_path = pg_catalog, public, extensions;

do $$ begin
  if to_regclass('public.organizations') is null
     or to_regclass('public.organization_memberships') is null
     or to_regclass('public.organization_imported_clients') is null
     or to_regclass('public.bookings') is null
     or to_regprocedure('public.normalize_client_phone(text)') is null
     or to_regprocedure('public.is_organization_member(uuid)') is null
     or to_regprocedure('public.has_organization_role(uuid,text[])') is null then
    raise exception using errcode='P0001',message='v119_requires_v65_v68_v95';
  end if;
  if to_regprocedure('public.get_public_minuta_catalog_v5(text)') is null then
    raise exception using errcode='P0001',message='v119_requires_v118';
  end if;
end $$;

create table if not exists public.organization_client_profiles (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  normalized_phone text not null check (normalized_phone ~ '^7[0-9]{10}$'),
  birthday date,
  birthday_overridden boolean not null default false,
  online_booking_blocked boolean not null default false,
  online_booking_blocked_at timestamptz,
  online_booking_blocked_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default pg_catalog.now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (organization_id,normalized_phone),
  constraint organization_client_profiles_birthday_check
    check (birthday is null or birthday between date '1900-01-01' and current_date),
  constraint organization_client_profiles_block_metadata_check
    check ((online_booking_blocked and online_booking_blocked_at is not null)
      or (not online_booking_blocked and online_booking_blocked_at is null and online_booking_blocked_by is null))
);

do $$ begin
  if (select count(*) from information_schema.columns where table_schema='public'
      and table_name='organization_client_profiles' and column_name in (
        'organization_id','normalized_phone','birthday','birthday_overridden','online_booking_blocked',
        'online_booking_blocked_at','online_booking_blocked_by','updated_at','updated_by'))<>9
     or not exists(select 1 from pg_constraint constraint_row
       where constraint_row.conrelid='public.organization_client_profiles'::regclass
         and constraint_row.contype='p' and array_length(constraint_row.conkey,1)=2) then
    raise exception using errcode='P0001',message='v119_incompatible_existing_schema';
  end if;
end $$;

alter table public.organization_client_profiles enable row level security;
revoke all on public.organization_client_profiles from public,anon,authenticated,service_role;
grant all on public.organization_client_profiles to service_role;

create or replace function public.get_minuta_client_profile_v119(
  p_organization uuid,
  p_client_phone text
) returns jsonb
language plpgsql stable security definer set search_path to '' as $$
declare
  v_phone text:=public.normalize_client_phone(p_client_phone);
  v_profile public.organization_client_profiles%rowtype;
  v_imported_birthday date;
begin
  if auth.uid() is null or not public.is_organization_member(p_organization) then
    raise exception using errcode='42501',message='organization_read_denied';
  end if;
  if v_phone !~ '^7[0-9]{10}$' then
    raise exception using errcode='22023',message='invalid_client_phone';
  end if;

  select * into v_profile from public.organization_client_profiles
  where organization_id=p_organization and normalized_phone=v_phone;
  if not exists(select 1 from public.bookings booking where booking.organization_id=p_organization and public.normalize_client_phone(booking.client_phone)=v_phone)
     and not exists(select 1 from public.organization_imported_clients imported where imported.organization_id=p_organization and imported.normalized_phone=v_phone) then
    raise exception using errcode='P0002',message='client_not_found';
  end if;
  select birthday into v_imported_birthday from public.organization_imported_clients
  where organization_id=p_organization and normalized_phone=v_phone;

  return jsonb_build_object(
    'client_phone',v_phone,
    'birthday',case when v_profile.birthday_overridden then v_profile.birthday else v_imported_birthday end,
    'online_booking_blocked',coalesce(v_profile.online_booking_blocked,false),
    'can_edit',true,
    'can_manage_block',public.has_organization_role(p_organization,array['owner','admin']::text[])
  );
end $$;

create or replace function public.save_minuta_client_birthday_v119(
  p_organization uuid,
  p_client_phone text,
  p_birthday date
) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare
  v_actor uuid:=auth.uid();
  v_phone text:=public.normalize_client_phone(p_client_phone);
  v_row public.organization_client_profiles%rowtype;
begin
  if v_actor is null or not public.is_organization_member(p_organization) then
    raise exception using errcode='42501',message='organization_write_denied';
  end if;
  if v_phone !~ '^7[0-9]{10}$' then
    raise exception using errcode='22023',message='invalid_client_phone';
  end if;
  if p_birthday is not null and (p_birthday < date '1900-01-01' or p_birthday > current_date) then
    raise exception using errcode='22023',message='invalid_client_birthday';
  end if;
  if not exists(select 1 from public.bookings booking where booking.organization_id=p_organization and public.normalize_client_phone(booking.client_phone)=v_phone)
     and not exists(select 1 from public.organization_imported_clients imported where imported.organization_id=p_organization and imported.normalized_phone=v_phone) then
    raise exception using errcode='P0002',message='client_not_found';
  end if;

  insert into public.organization_client_profiles(
    organization_id,normalized_phone,birthday,birthday_overridden,updated_at,updated_by
  ) values(
    p_organization,v_phone,p_birthday,true,clock_timestamp(),v_actor
  ) on conflict(organization_id,normalized_phone) do update set
    birthday=excluded.birthday,
    birthday_overridden=true,
    updated_at=excluded.updated_at,
    updated_by=excluded.updated_by
  returning * into v_row;

  return jsonb_build_object('client_phone',v_phone,'birthday',v_row.birthday,
    'online_booking_blocked',v_row.online_booking_blocked,'can_edit',true,
    'can_manage_block',public.has_organization_role(p_organization,array['owner','admin']::text[]));
end $$;

create or replace function public.set_minuta_client_online_booking_block_v119(
  p_organization uuid,
  p_client_phone text,
  p_blocked boolean
) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare
  v_actor uuid:=auth.uid();
  v_phone text:=public.normalize_client_phone(p_client_phone);
  v_row public.organization_client_profiles%rowtype;
  v_imported_birthday date;
begin
  if v_actor is null or not public.has_organization_role(p_organization,array['owner','admin']::text[]) then
    raise exception using errcode='42501',message='organization_manager_required';
  end if;
  if v_phone !~ '^7[0-9]{10}$' or p_blocked is null then
    raise exception using errcode='22023',message='invalid_client_block_request';
  end if;
  if not exists(select 1 from public.bookings booking where booking.organization_id=p_organization and public.normalize_client_phone(booking.client_phone)=v_phone)
     and not exists(select 1 from public.organization_imported_clients imported where imported.organization_id=p_organization and imported.normalized_phone=v_phone) then
    raise exception using errcode='P0002',message='client_not_found';
  end if;

  insert into public.organization_client_profiles(
    organization_id,normalized_phone,online_booking_blocked,online_booking_blocked_at,
    online_booking_blocked_by,updated_at,updated_by
  ) values(
    p_organization,v_phone,p_blocked,case when p_blocked then clock_timestamp() end,
    case when p_blocked then v_actor end,clock_timestamp(),v_actor
  ) on conflict(organization_id,normalized_phone) do update set
    online_booking_blocked=excluded.online_booking_blocked,
    online_booking_blocked_at=excluded.online_booking_blocked_at,
    online_booking_blocked_by=excluded.online_booking_blocked_by,
    updated_at=excluded.updated_at,
    updated_by=excluded.updated_by
  returning * into v_row;

  select birthday into v_imported_birthday from public.organization_imported_clients
  where organization_id=p_organization and normalized_phone=v_phone;

  return jsonb_build_object('client_phone',v_phone,
    'birthday',case when v_row.birthday_overridden then v_row.birthday else v_imported_birthday end,
    'online_booking_blocked',v_row.online_booking_blocked,'can_edit',true,'can_manage_block',true);
end $$;

create or replace function public.enforce_minuta_client_online_booking_block_v119()
returns trigger
language plpgsql security definer set search_path to '' as $$
declare
  v_phone text:=public.normalize_client_phone(new.client_phone);
begin
  if auth.role()='service_role' or (
    auth.uid() is not null and exists(
      select 1 from public.organization_memberships membership
      where membership.organization_id=new.organization_id
        and membership.user_id=auth.uid() and membership.active
    )
  ) then
    return new;
  end if;
  if exists(
    select 1 from public.organization_client_profiles profile
    where profile.organization_id=new.organization_id
      and profile.normalized_phone=v_phone
      and profile.online_booking_blocked
  ) then
    raise exception using errcode='P0001',message='client_online_booking_blocked';
  end if;
  return new;
end $$;

drop trigger if exists zy_bookings_client_online_block_v119 on public.bookings;
create trigger zy_bookings_client_online_block_v119
before insert on public.bookings
for each row execute function public.enforce_minuta_client_online_booking_block_v119();

revoke all on function public.get_minuta_client_profile_v119(uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.save_minuta_client_birthday_v119(uuid,text,date) from public,anon,authenticated,service_role;
revoke all on function public.set_minuta_client_online_booking_block_v119(uuid,text,boolean) from public,anon,authenticated,service_role;
revoke all on function public.enforce_minuta_client_online_booking_block_v119() from public,anon,authenticated,service_role;
grant execute on function public.get_minuta_client_profile_v119(uuid,text) to authenticated;
grant execute on function public.save_minuta_client_birthday_v119(uuid,text,date) to authenticated;
grant execute on function public.set_minuta_client_online_booking_block_v119(uuid,text,boolean) to authenticated;

notify pgrst,'reload schema';
commit;
