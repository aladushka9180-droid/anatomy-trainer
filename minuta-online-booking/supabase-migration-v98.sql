\set ON_ERROR_STOP on

begin;
set local search_path=public,extensions,pg_catalog;

do $$
begin
  if to_regclass('public.bookings') is null
     or to_regclass('public.services') is null
     or to_regclass('public.organizations') is null
     or to_regclass('public.locations') is null
     or to_regclass('public.organization_memberships') is null
     or to_regprocedure('public.scope_minuta_booking()') is null then
    raise exception using errcode='P0001',message='v98_missing_historical_booking_prerequisites';
  end if;
end $$;

create or replace function public.create_minuta_historical_booking(
  p_organization uuid,
  p_service uuid,
  p_date date,
  p_time time without time zone,
  p_client_name text,
  p_client_phone text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_actor uuid:=auth.uid();
  v_role text;
  v_performer uuid;
  v_location uuid;
  v_duration integer;
  v_code text;
  v_token uuid:=gen_random_uuid();
  v_booking uuid;
  v_previous_organization text:=current_setting('minuta.booking_organization',true);
  v_previous_location text:=current_setting('minuta.booking_location',true);
begin
  if v_actor is null then
    raise exception using errcode='42501',message='authentication_required';
  end if;
  if p_organization is null or p_service is null or p_date is null or p_time is null then
    raise exception using errcode='22023',message='invalid_historical_booking';
  end if;
  if coalesce(char_length(btrim(p_client_name)),0)<2
     or coalesce(char_length(regexp_replace(p_client_phone,'[^0-9]','','g')),0)<10 then
    raise exception using errcode='22023',message='invalid_client_data';
  end if;
  if p_date+p_time>=timezone('Europe/Samara',now()) then
    raise exception using errcode='22023',message='historical_time_required';
  end if;

  select membership.role into v_role
  from public.organization_memberships membership
  join public.organizations organization on organization.id=membership.organization_id and organization.status='active'
  where membership.organization_id=p_organization and membership.user_id=v_actor and membership.active
  limit 1;
  if v_role not in ('owner','admin','specialist') then
    raise exception using errcode='42501',message='organization_access_denied';
  end if;

  select service.performer_id,service.duration_minutes
  into v_performer,v_duration
  from public.services service
  join public.organization_memberships membership
    on membership.organization_id=p_organization and membership.user_id=service.performer_id
   and membership.active and membership.is_bookable
  where service.id=p_service and service.active;
  if v_performer is null or (v_role='specialist' and v_performer<>v_actor) then
    raise exception using errcode='42501',message='historical_booking_denied';
  end if;
  if v_duration<1 or p_date+p_time+make_interval(mins=>v_duration)>p_date+1 then
    raise exception using errcode='22023',message='invalid_historical_duration';
  end if;

  select location.id into v_location
  from public.locations location
  where location.organization_id=p_organization and location.active
  order by location.is_primary desc,location.id
  limit 1;
  if v_location is null then
    raise exception using errcode='P0001',message='booking_location_unavailable';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_performer::text||':'||p_date::text,9801));
  if exists(
    select 1 from public.bookings booking
    where booking.performer_id=v_performer and booking.booking_date=p_date and booking.status<>'cancelled'
      and p_time<booking.booking_time+make_interval(mins=>coalesce(booking.duration_minutes,60))
      and p_time+make_interval(mins=>v_duration)>booking.booking_time
  ) then
    raise exception using errcode='23P01',message='slot_unavailable';
  end if;

  v_code:='MIN-'||upper(substr(encode(gen_random_bytes(6),'hex'),1,10));
  perform set_config('minuta.booking_organization',p_organization::text,true);
  perform set_config('minuta.booking_location',v_location::text,true);
  begin
    insert into public.bookings(
      booking_code,manage_token,performer_id,service_id,client_name,client_phone,
      booking_date,booking_time,duration_minutes,status,deposit_amount_rub,payment_status,payment_url
    ) values(
      v_code,v_token,v_performer,p_service,btrim(p_client_name),btrim(p_client_phone),
      p_date,p_time,v_duration,'new',0,'not_required',''
    ) returning id into v_booking;
  exception when exclusion_violation then
    perform set_config('minuta.booking_organization',coalesce(v_previous_organization,''),true);
    perform set_config('minuta.booking_location',coalesce(v_previous_location,''),true);
    raise exception using errcode='23P01',message='slot_unavailable';
  end;
  perform set_config('minuta.booking_organization',coalesce(v_previous_organization,''),true);
  perform set_config('minuta.booking_location',coalesce(v_previous_location,''),true);

  return jsonb_build_object('booking_id',v_booking,'booking_code',v_code,'manage_token',v_token);
end;
$$;

revoke all on function public.create_minuta_historical_booking(uuid,uuid,date,time without time zone,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.create_minuta_historical_booking(uuid,uuid,date,time without time zone,text,text)
  to authenticated;

commit;
