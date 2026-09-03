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
     or to_regclass('public.notification_outbox') is null
     or to_regprocedure('public.scope_minuta_booking()') is null
     or to_regprocedure('extensions.gen_random_bytes(integer)') is null then
    raise exception using errcode='P0001',message='v98_missing_historical_booking_prerequisites';
  end if;
end $$;

-- Replace the original six-argument v98 function with a compatible contract
-- whose final argument has a default. Fixed-duration services remain callable
-- by older clients; per-minute services fail closed unless duration is sent.
drop function if exists public.create_minuta_historical_booking(
  uuid,uuid,date,time without time zone,text,text
);
drop function if exists public.create_minuta_historical_booking(
  uuid,uuid,date,time without time zone,text,text,integer
);

create function public.create_minuta_historical_booking(
  p_organization uuid,
  p_service uuid,
  p_date date,
  p_time time without time zone,
  p_client_name text,
  p_client_phone text,
  p_duration_minutes integer default null
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
  v_timezone text;
  v_service_duration integer;
  v_effective_duration integer;
  v_service_price integer;
  v_total_price bigint;
  v_client_name text:=btrim(coalesce(p_client_name,''));
  v_client_phone text:=btrim(coalesce(p_client_phone,''));
  v_phone_digits text:=regexp_replace(coalesce(p_client_phone,''),'[^0-9]','','g');
  v_code text;
  v_token uuid:=pg_catalog.gen_random_uuid();
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
  if char_length(v_client_name) not between 2 and 80
     or char_length(v_client_phone)>40
     or char_length(v_phone_digits) not between 10 and 15 then
    raise exception using errcode='22023',message='invalid_client_data';
  end if;
  if p_date<date '2000-01-01'
     or extract(second from p_time)<>0
     or mod(extract(minute from p_time)::integer,5)<>0 then
    raise exception using errcode='22023',message='invalid_historical_time';
  end if;

  select membership.role into v_role
  from public.organization_memberships membership
  join public.organizations organization
    on organization.id=membership.organization_id and organization.status='active'
  where membership.organization_id=p_organization
    and membership.user_id=v_actor
    and membership.active
  limit 1;
  if v_role is null or v_role not in ('owner','admin','specialist') then
    raise exception using errcode='42501',message='organization_access_denied';
  end if;

  select service.performer_id,service.duration_minutes,service.price_rub
  into v_performer,v_service_duration,v_service_price
  from public.services service
  join public.organization_memberships membership
    on membership.organization_id=p_organization
   and membership.user_id=service.performer_id
   and membership.active
   and membership.is_bookable
  where service.id=p_service and service.active;
  if v_performer is null then
    raise exception using errcode='22023',message='service_unavailable';
  end if;
  if v_role='specialist' and v_performer<>v_actor then
    raise exception using errcode='42501',message='historical_booking_denied';
  end if;
  if v_service_duration is null or v_service_duration not between 1 and 480
     or v_service_price is null or v_service_price not between 0 and 1000000 then
    raise exception using errcode='22023',message='invalid_service_terms';
  end if;

  if v_service_duration=1 then
    if p_duration_minutes is null or p_duration_minutes not between 1 and 480 then
      raise exception using errcode='22023',message='historical_duration_required';
    end if;
    v_effective_duration:=p_duration_minutes;
    v_total_price:=v_service_price::bigint*v_effective_duration::bigint;
  else
    if p_duration_minutes is not null and p_duration_minutes<>v_service_duration then
      raise exception using errcode='22023',message='fixed_service_duration_mismatch';
    end if;
    v_effective_duration:=v_service_duration;
    v_total_price:=v_service_price;
  end if;
  if v_total_price not between 0 and 10000000 then
    raise exception using errcode='22023',message='invalid_historical_price';
  end if;

  select location.id,location.timezone into v_location,v_timezone
  from public.locations location
  where location.organization_id=p_organization and location.active
  order by location.is_primary desc,location.id
  limit 1;
  if v_location is null then
    raise exception using errcode='P0001',message='booking_location_unavailable';
  end if;
  if v_timezone is null
     or not exists(select 1 from pg_catalog.pg_timezone_names zone where zone.name=v_timezone) then
    raise exception using errcode='22023',message='invalid_location_timezone';
  end if;
  if p_date+p_time+make_interval(mins=>v_effective_duration)>p_date+1 then
    raise exception using errcode='22023',message='invalid_historical_duration';
  end if;
  if p_date+p_time+make_interval(mins=>v_effective_duration)>timezone(v_timezone,now()) then
    raise exception using errcode='22023',message='historical_time_required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_performer::text||':'||p_date::text,9801));
  if exists(
    select 1 from public.bookings booking
    where booking.performer_id=v_performer
      and booking.booking_date=p_date
      and booking.status<>'cancelled'
      and p_time<booking.booking_time+make_interval(mins=>coalesce(booking.duration_minutes,60))
      and p_time+make_interval(mins=>v_effective_duration)>booking.booking_time
  ) then
    raise exception using errcode='23P01',message='slot_unavailable';
  end if;

  v_code:='MIN-'||upper(substr(encode(extensions.gen_random_bytes(6),'hex'),1,10));
  perform set_config('minuta.booking_organization',p_organization::text,true);
  perform set_config('minuta.booking_location',v_location::text,true);
  begin
    insert into public.bookings(
      booking_code,manage_token,performer_id,service_id,client_name,client_phone,
      booking_date,booking_time,duration_minutes,original_price_rub,total_price_rub,
      status,deposit_amount_rub,payment_status,payment_url
    ) values(
      v_code,v_token,v_performer,p_service,v_client_name,v_client_phone,
      p_date,p_time,v_effective_duration,v_service_price,v_total_price::integer,
      'new',0,'not_required',''
    ) returning id into v_booking;

    update public.bookings
    set deposit_amount_rub=0,
        payment_status='not_required',
        payment_url='',
        payment_due_at=null,
        expired_unpaid_at=null,
        refund_status='not_required',
        booking_policy_snapshot=coalesce(booking_policy_snapshot,'{}'::jsonb)
          || jsonb_build_object('historical',true,'payment_suppressed',true)
    where id=v_booking;

    -- The notification trigger has queued rows, but they are not visible to a
    -- worker before commit. Remove every notification for this new booking.
    delete from public.notification_outbox where booking_id=v_booking;
  exception
    when exclusion_violation then
      perform set_config('minuta.booking_organization',coalesce(v_previous_organization,''),true);
      perform set_config('minuta.booking_location',coalesce(v_previous_location,''),true);
      raise exception using errcode='23P01',message='slot_unavailable';
    when others then
      perform set_config('minuta.booking_organization',coalesce(v_previous_organization,''),true);
      perform set_config('minuta.booking_location',coalesce(v_previous_location,''),true);
      raise;
  end;
  perform set_config('minuta.booking_organization',coalesce(v_previous_organization,''),true);
  perform set_config('minuta.booking_location',coalesce(v_previous_location,''),true);

  return jsonb_build_object(
    'booking_id',v_booking,
    'booking_code',v_code,
    'duration_minutes',v_effective_duration,
    'unit_price_rub',v_service_price,
    'total_price_rub',v_total_price::integer,
    'payment_required',false,
    'notifications_suppressed',true
  );
end;
$$;

revoke all on function public.create_minuta_historical_booking(
  uuid,uuid,date,time without time zone,text,text,integer
) from public,anon,authenticated,service_role;
grant execute on function public.create_minuta_historical_booking(
  uuid,uuid,date,time without time zone,text,text,integer
) to authenticated;

commit;
