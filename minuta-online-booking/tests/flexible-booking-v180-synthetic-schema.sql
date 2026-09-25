-- ISOLATED PostgreSQL ONLY. Minimal current RPC shape; no production data.
-- This contract fixture does not replace a restored current Supabase schema.
do $$begin
  if not exists(select 1 from pg_roles where rolname='anon') then
    create role anon nologin;
  end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then
    create role authenticated nologin;
  end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then
    create role service_role nologin;
  end if;
end$$;
create schema auth;
create schema extensions;
create extension pgcrypto with schema extensions;
create extension btree_gist with schema extensions;
grant usage on schema public,auth,extensions to anon,authenticated,service_role;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
create table auth.users (id uuid primary key);
create table public.organizations (
  id uuid primary key,legacy_performer_id uuid,status text not null,
  public_slug text not null unique
);
create table public.locations (
  id uuid primary key,organization_id uuid not null references public.organizations(id),
  active boolean not null,is_primary boolean not null,timezone text not null,
  unique(id,organization_id)
);
create table public.organization_memberships (
  organization_id uuid not null references public.organizations(id),
  user_id uuid not null references auth.users(id),role text not null,
  active boolean not null,is_bookable boolean not null,
  primary key(organization_id,user_id)
);

create table public.services (
  id uuid primary key, performer_id uuid not null, name text not null,
  duration_minutes integer not null check(duration_minutes between 1 and 480),
  price_rub integer not null, active boolean not null default true
);
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  request_id uuid unique, request_fingerprint text,
  performer_id uuid not null, service_id uuid not null references public.services(id),
  booking_date date not null, booking_time time without time zone not null,
  duration_minutes integer not null, booking_code text not null,
  manage_token uuid not null, client_name text not null,client_phone text not null,
  status text not null default 'new',
  organization_id uuid not null references public.organizations(id),
  location_id uuid not null,booking_scope_source text not null default 'legacy',
  booking_source text,created_by_user_id uuid references auth.users(id),created_by_role text,
  constraint bookings_location_organization_fkey
    foreign key(location_id,organization_id) references public.locations(id,organization_id),
  constraint bookings_scope_source_check check(booking_scope_source in ('legacy','team')),
  constraint bookings_booking_source_check check(booking_source is null or
    booking_source in ('client_online','provider_manual','admin_manual')),
  constraint bookings_created_by_role_check check(created_by_role is null or
    created_by_role in ('owner','admin','specialist')),
  constraint bookings_creation_attribution_check check(
    (booking_source is null and created_by_user_id is null and created_by_role is null)
    or (booking_source='client_online' and created_by_user_id is null and created_by_role is null)
    or (booking_source='provider_manual' and created_by_user_id is not null and created_by_role='specialist')
    or (booking_source='admin_manual' and created_by_user_id is not null
      and created_by_role in ('owner','admin'))),
  constraint bookings_performer_active_no_overlap exclude using gist (
    performer_id with =,
    tsrange(booking_date+booking_time,
      booking_date+booking_time+make_interval(mins=>duration_minutes),'[)') with &&
  ) where(status<>'cancelled')
);
-- Narrow copies of v68/v92 insert rules: resolve tenant scope before attribution.
-- Other production triggers and columns remain outside this synthetic fixture.
create function public.scope_minuta_booking() returns trigger
language plpgsql security definer set search_path to '' as $$
declare v_organization uuid;v_location uuid;v_legacy boolean;
begin
  v_organization:=nullif(current_setting('minuta.booking_organization',true),'')::uuid;
  v_location:=nullif(current_setting('minuta.booking_location',true),'')::uuid;
  if (v_organization is null) <> (v_location is null) then
    raise exception using errcode='P0001',message='booking_organization_required';
  end if;
  if v_organization is not null then
    if (new.organization_id is not null and new.organization_id<>v_organization)
       or (new.location_id is not null and new.location_id<>v_location) then
      raise exception using errcode='P0001',message='booking_scope_conflict';
    end if;
    new.organization_id:=v_organization;
    new.location_id:=v_location;
    new.booking_scope_source:='team';
  elsif new.organization_id is null and new.location_id is null then
    select organization.id,location.id into new.organization_id,new.location_id
    from public.organizations organization
    join public.locations location on location.organization_id=organization.id
      and location.active and location.is_primary
    where organization.legacy_performer_id=new.performer_id
      and organization.status='active';
    new.booking_scope_source:='legacy';
  end if;
  if new.organization_id is null or new.location_id is null then
    raise exception using errcode='P0001',message='booking_organization_required';
  end if;
  if not exists(select 1 from public.locations location
      join public.organizations organization on organization.id=location.organization_id
        and organization.status='active'
      where location.id=new.location_id and location.organization_id=new.organization_id
        and location.active) then
    raise exception using errcode='P0001',message='booking_location_unavailable';
  end if;
  if not exists(select 1 from public.organization_memberships membership
      where membership.organization_id=new.organization_id
        and membership.user_id=new.performer_id and membership.active
        and membership.is_bookable) then
    raise exception using errcode='P0001',message='booking_performer_unavailable';
  end if;
  if not exists(select 1 from public.services service
      where service.id=new.service_id and service.performer_id=new.performer_id) then
    raise exception using errcode='P0001',message='booking_service_performer_mismatch';
  end if;
  return new;
end
$$;
create trigger bookings_scope_minuta_tenant
before insert on public.bookings for each row execute function public.scope_minuta_booking();

create function public.set_minuta_booking_creation_attribution_v92() returns trigger
language plpgsql security definer set search_path to '' as $$
declare v_actor uuid:=auth.uid();v_role text;
begin
  new.booking_source:=null;
  new.created_by_user_id:=null;
  new.created_by_role:=null;
  if v_actor is not null then
    select membership.role into v_role from public.organization_memberships membership
    where membership.organization_id=new.organization_id and membership.user_id=v_actor
      and membership.active limit 1;
  end if;
  if v_role in ('owner','admin') then
    new.booking_source:='admin_manual';
    new.created_by_user_id:=v_actor;
    new.created_by_role:=v_role;
  elsif v_role='specialist' and v_actor=new.performer_id then
    new.booking_source:='provider_manual';
    new.created_by_user_id:=v_actor;
    new.created_by_role:=v_role;
  else
    new.booking_source:='client_online';
  end if;
  return new;
end
$$;
create trigger bookings_zz_set_creation_attribution_v92
before insert on public.bookings for each row
execute function public.set_minuta_booking_creation_attribution_v92();
create function public.protect_minuta_booking_creation_attribution_v92() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if new.booking_source is distinct from old.booking_source
     or new.created_by_user_id is distinct from old.created_by_user_id
     or new.created_by_role is distinct from old.created_by_role then
    raise exception using errcode='42501',message='booking_creation_attribution_immutable';
  end if;
  return new;
end
$$;
create trigger bookings_zz_protect_creation_attribution_v92
before update of booking_source,created_by_user_id,created_by_role on public.bookings
for each row execute function public.protect_minuta_booking_creation_attribution_v92();
create table public.test_slots_v180 (
  service_id uuid not null references public.services(id),
  booking_date date not null,booking_time time without time zone not null,
  primary key(service_id,booking_date,booking_time)
);

create function public.get_available_slots_v101(
  p_service uuid,p_start date,p_end date,p_ignore_booking uuid default null)
returns table(booking_date date,booking_time time without time zone)
language sql stable security definer set search_path to '' as $$
  select slot.booking_date,slot.booking_time
  from public.test_slots_v180 slot
  join public.services service on service.id=slot.service_id and service.active
  where slot.service_id=p_service and slot.booking_date between p_start and p_end
    and not exists(
      select 1 from public.bookings booking
      where booking.performer_id=service.performer_id
        and booking.booking_date=slot.booking_date
        and booking.status<>'cancelled'
        and booking.id is distinct from p_ignore_booking
        and tsrange(slot.booking_date+slot.booking_time,
          slot.booking_date+slot.booking_time+make_interval(mins=>service.duration_minutes),'[)')
          && tsrange(booking.booking_date+booking.booking_time,
            booking.booking_date+booking.booking_time+make_interval(mins=>booking.duration_minutes),'[)')
    )
  order by slot.booking_date,slot.booking_time
$$;
grant execute on function public.get_available_slots_v101(uuid,date,date,uuid) to anon,authenticated;

create function public.get_public_minuta_available_slots_v101(
  p_slug text,p_location uuid,p_service uuid,p_start date,p_end date)
returns table(booking_date date,booking_time time without time zone)
language sql stable security definer set search_path to '' as $$
  select slot.booking_date,slot.booking_time
  from public.get_available_slots_v101(p_service,p_start,p_end,null) slot
  where p_slug='v180-isolated' and p_location='00000000-0000-4000-8000-000000000178'::uuid
$$;
grant execute on function public.get_public_minuta_available_slots_v101(text,uuid,uuid,date,date) to anon,authenticated;

create function public.book_appointment(
  p_request_id uuid,p_service uuid,p_date date,p_time time without time zone,
  p_client_name text,p_client_phone text)
returns table(booking_code text,manage_token uuid)
language plpgsql volatile security definer set search_path to '' as $$
declare v_performer uuid; v_duration integer; v_fingerprint text; v_booking public.bookings%rowtype;
begin
  select service.performer_id,service.duration_minutes into v_performer,v_duration
  from public.services service where service.id=p_service and service.active;
  if not found then raise exception using errcode='P0001',message='service_unavailable'; end if;
  v_fingerprint:=encode(extensions.digest(p_service::text||chr(31)||p_date::text||chr(31)||
    p_time::text||chr(31)||btrim(p_client_name)||chr(31)||
    regexp_replace(p_client_phone,'[^0-9]','','g'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('booking-request:'||p_request_id::text,0));
  select * into v_booking from public.bookings where request_id=p_request_id;
  if found then
    if v_booking.request_fingerprint<>v_fingerprint then
      raise exception using errcode='P0001',message='request_conflict';
    end if;
    return query select v_booking.booking_code,v_booking.manage_token; return;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_performer::text||p_date::text,0));
  if not exists(select 1 from public.get_available_slots_v101(p_service,p_date,p_date,null) slot
    where slot.booking_time=p_time) then
    raise exception using errcode='P0001',message='slot_unavailable';
  end if;
  if p_time='10:00' and current_setting('v180.simulate_exclusion',true)='on' then
    raise exception using errcode='23P01',message='synthetic_booking_exclusion';
  end if;
  insert into public.bookings(request_id,request_fingerprint,performer_id,service_id,
    booking_date,booking_time,duration_minutes,booking_code,manage_token,client_name,client_phone)
  values(p_request_id,v_fingerprint,v_performer,p_service,p_date,p_time,v_duration,
    'TEST-'||substr(replace(p_request_id::text,'-',''),1,8),gen_random_uuid(),p_client_name,p_client_phone)
  returning * into v_booking;
  return query select v_booking.booking_code,v_booking.manage_token;
end
$$;
grant execute on function public.book_appointment(uuid,uuid,date,time without time zone,text,text)
  to anon,authenticated;

create function public.book_minuta_appointment_v2(
  p_request_id uuid,p_slug text,p_location uuid,p_service uuid,p_date date,
  p_time time without time zone,p_client_name text,p_client_phone text,
  p_expected_price_rub integer,p_expected_duration_minutes integer)
returns table(result_code text,booking_code text,manage_token uuid)
language plpgsql volatile security definer set search_path to '' as $$
declare
  v_service public.services%rowtype;
  v_code text;
  v_token uuid;
  v_previous_organization text:=current_setting('minuta.booking_organization',true);
  v_previous_location text:=current_setting('minuta.booking_location',true);
begin
  if p_slug<>'v180-isolated' or p_location is distinct from
     '00000000-0000-4000-8000-000000000178'::uuid then
    raise exception using errcode='P0001',message='location_unavailable';
  end if;
  select * into v_service from public.services where id=p_service and active;
  if p_expected_price_rub is distinct from v_service.price_rub
     or p_expected_duration_minutes is distinct from v_service.duration_minutes then
    return query select 'service_terms_changed'::text,null::text,null::uuid; return;
  end if;
  perform set_config('minuta.booking_organization',
    '00000000-0000-4000-8000-000000000179',true);
  perform set_config('minuta.booking_location',p_location::text,true);
  begin
    select created.booking_code,created.manage_token into v_code,v_token
    from public.book_appointment(p_request_id,p_service,p_date,p_time,p_client_name,p_client_phone) created;
  exception when others then
    perform set_config('minuta.booking_organization',coalesce(v_previous_organization,''),true);
    perform set_config('minuta.booking_location',coalesce(v_previous_location,''),true);
    raise;
  end;
  perform set_config('minuta.booking_organization',coalesce(v_previous_organization,''),true);
  perform set_config('minuta.booking_location',coalesce(v_previous_location,''),true);
  return query select 'ok'::text,v_code,v_token;
end
$$;
grant execute on function public.book_minuta_appointment_v2(
  uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer)
  to anon,authenticated;

insert into auth.users(id) values('00000000-0000-4000-8000-000000000181');
insert into public.organizations(id,legacy_performer_id,status,public_slug)
values('00000000-0000-4000-8000-000000000179',
  '00000000-0000-4000-8000-000000000181','active','v180-isolated');
insert into public.locations(id,organization_id,active,is_primary,timezone)
values('00000000-0000-4000-8000-000000000178',
  '00000000-0000-4000-8000-000000000179',true,true,'Europe/Samara');
insert into public.organization_memberships(
  organization_id,user_id,role,active,is_bookable)
values('00000000-0000-4000-8000-000000000179',
  '00000000-0000-4000-8000-000000000181','specialist',true,true);
insert into public.services(id,performer_id,name,duration_minutes,price_rub,active)
values('00000000-0000-4000-8000-000000000180',
  '00000000-0000-4000-8000-000000000181','Synthetic massage',60,1000,true);
insert into public.test_slots_v180(service_id,booking_date,booking_time)
select '00000000-0000-4000-8000-000000000180'::uuid,current_date+1,hour_mark::time
from generate_series((current_date+1)+'10:00'::time,
  (current_date+1)+'18:00'::time,interval '1 hour') hour_mark;
