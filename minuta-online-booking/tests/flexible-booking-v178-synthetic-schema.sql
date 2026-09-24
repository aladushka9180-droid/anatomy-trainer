-- ISOLATED PostgreSQL ONLY. Minimal current RPC shape; no production data.
-- This contract fixture does not replace a restored current Supabase schema.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create schema extensions;
create extension pgcrypto with schema extensions;
grant usage on schema public,auth,extensions to anon,authenticated,service_role;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;

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
  status text not null default 'new',organization_id uuid,location_id uuid
);
create table public.test_slots_v178 (
  service_id uuid not null references public.services(id),
  booking_date date not null,booking_time time without time zone not null,
  primary key(service_id,booking_date,booking_time)
);

create function public.get_available_slots_v101(
  p_service uuid,p_start date,p_end date,p_ignore_booking uuid default null)
returns table(booking_date date,booking_time time without time zone)
language sql stable security definer set search_path to '' as $$
  select slot.booking_date,slot.booking_time
  from public.test_slots_v178 slot
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
  where p_slug='v178-isolated' and p_location='00000000-0000-4000-8000-000000000178'::uuid
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
declare v_service public.services%rowtype; v_code text; v_token uuid;
begin
  if p_slug<>'v178-isolated' or p_location is distinct from
     '00000000-0000-4000-8000-000000000178'::uuid then
    raise exception using errcode='P0001',message='location_unavailable';
  end if;
  select * into v_service from public.services where id=p_service and active;
  if p_expected_price_rub is distinct from v_service.price_rub
     or p_expected_duration_minutes is distinct from v_service.duration_minutes then
    return query select 'service_terms_changed'::text,null::text,null::uuid; return;
  end if;
  select created.booking_code,created.manage_token into v_code,v_token
  from public.book_appointment(p_request_id,p_service,p_date,p_time,p_client_name,p_client_phone) created;
  update public.bookings set organization_id='00000000-0000-4000-8000-000000000179'::uuid,
    location_id=p_location where request_id=p_request_id;
  return query select 'ok'::text,v_code,v_token;
end
$$;
grant execute on function public.book_minuta_appointment_v2(
  uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer)
  to anon,authenticated;

insert into public.services(id,performer_id,name,duration_minutes,price_rub,active)
values('00000000-0000-4000-8000-000000000180',
  '00000000-0000-4000-8000-000000000181','Synthetic massage',60,1000,true);
insert into public.test_slots_v178(service_id,booking_date,booking_time)
select '00000000-0000-4000-8000-000000000180'::uuid,current_date+1,hour_mark::time
from generate_series((current_date+1)+'10:00'::time,
  (current_date+1)+'18:00'::time,interval '1 hour') hour_mark;
