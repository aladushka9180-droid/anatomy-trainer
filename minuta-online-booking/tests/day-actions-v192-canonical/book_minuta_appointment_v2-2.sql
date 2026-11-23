CREATE OR REPLACE FUNCTION public.book_minuta_appointment_v2(p_request_id uuid, p_slug text, p_location uuid, p_service uuid, p_date date, p_time time without time zone, p_client_name text, p_client_phone text, p_expected_price_rub integer, p_expected_duration_minutes integer)
 RETURNS TABLE(result_code text, booking_code text, manage_token uuid, request_id uuid, service_id uuid, booking_date date, booking_time time without time zone, duration_minutes integer, original_price_rub integer, total_price_rub integer, status text, current_price_rub integer, current_duration_minutes integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_request_fingerprint text;
  v_booking public.bookings%rowtype;
  v_existing boolean;
  v_organization uuid;
  v_performer uuid;
  v_current_price integer;
  v_current_duration integer;
  v_created_code text;
  v_created_token uuid;
begin
  if p_request_id is null or p_location is null or p_service is null
     or p_date is null or p_time is null
     or lower(trim(coalesce(p_slug,'')))!~'^[a-z0-9][a-z0-9-]{2,62}$'
     or coalesce(char_length(trim(p_client_name)),0)<2
     or coalesce(char_length(regexp_replace(p_client_phone,'[^0-9]','','g')),0)<10
     or p_expected_price_rub is null or p_expected_price_rub not between 0 and 10000000
     or p_expected_duration_minutes is null or p_expected_duration_minutes not between 1 and 480 then
    raise exception using errcode='P0001',message='invalid_booking_data';
  end if;

  v_request_fingerprint:=encode(extensions.digest(
    p_service::text||chr(31)||p_date::text||chr(31)||
    p_time::text||chr(31)||trim(p_client_name)||chr(31)||
    regexp_replace(p_client_phone,'[^0-9]','','g'),'sha256'),'hex');

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('booking-request:'||p_request_id::text,0)
  );

  select booking.* into v_booking
  from public.bookings booking
  where booking.request_id=p_request_id;
  v_existing:=found;

  select organization.id into v_organization
  from public.organizations organization
  where organization.public_slug=lower(trim(p_slug));

  if v_existing then
    if v_organization is null
       or v_booking.request_fingerprint is distinct from v_request_fingerprint
       or v_booking.organization_id is distinct from v_organization
       or v_booking.location_id is distinct from p_location then
      raise exception using errcode='P0001',message='request_conflict';
    end if;
    return query select
      'ok'::text,v_booking.booking_code::text,v_booking.manage_token,
      v_booking.request_id,v_booking.service_id,v_booking.booking_date,
      v_booking.booking_time,v_booking.duration_minutes,
      v_booking.original_price_rub,v_booking.total_price_rub,v_booking.status::text,
      v_booking.total_price_rub,v_booking.duration_minutes;
    return;
  end if;

  perform 1
  from public.organizations organization
  where organization.id=v_organization
    and organization.status='active'
    and organization.public_booking_enabled
  for share;
  if not found then
    raise exception using errcode='P0001',message='organization_unavailable';
  end if;

  perform 1
  from public.locations location
  where location.id=p_location
    and location.organization_id=v_organization
    and location.active
    and location.timezone='Europe/Samara'
  for share;
  if not found then
    raise exception using errcode='P0001',message='location_unavailable';
  end if;

  select service.performer_id,service.price_rub,service.duration_minutes
  into v_performer,v_current_price,v_current_duration
  from public.services service
  where service.id=p_service
    and service.active
  for share;
  if not found then
    raise exception using errcode='P0001',message='service_unavailable';
  end if;

  perform 1
  from public.organization_memberships membership
  where membership.organization_id=v_organization
    and membership.user_id=v_performer
    and membership.active
    and membership.is_bookable
  for share;
  if not found then
    raise exception using errcode='P0001',message='service_unavailable';
  end if;

  if p_expected_price_rub is distinct from v_current_price
     or p_expected_duration_minutes is distinct from v_current_duration then
    return query select
      'service_terms_changed'::text,null::text,null::uuid,
      p_request_id,p_service,p_date,p_time,null::integer,null::integer,
      null::integer,null::text,v_current_price,v_current_duration;
    return;
  end if;

  select created.booking_code,created.manage_token
  into v_created_code,v_created_token
  from public.book_minuta_appointment(
    p_request_id,p_slug,p_location,p_service,p_date,p_time,
    p_client_name,p_client_phone
  ) created;

  select booking.* into v_booking
  from public.bookings booking
  where booking.request_id=p_request_id;

  if not found
     or v_booking.request_fingerprint is distinct from v_request_fingerprint
     or v_booking.organization_id is distinct from v_organization
     or v_booking.location_id is distinct from p_location
     or v_booking.service_id is distinct from p_service
     or v_booking.booking_date is distinct from p_date
     or v_booking.booking_time is distinct from p_time
     or v_booking.duration_minutes is distinct from p_expected_duration_minutes
     or v_booking.original_price_rub is distinct from p_expected_price_rub
     or v_booking.total_price_rub is distinct from p_expected_price_rub
     or v_booking.booking_code is distinct from v_created_code
     or v_booking.manage_token is distinct from v_created_token then
    raise exception using errcode='55000',message='atomic_booking_acknowledgement_invalid';
  end if;

  return query select
    'ok'::text,v_booking.booking_code::text,v_booking.manage_token,
    v_booking.request_id,v_booking.service_id,v_booking.booking_date,
    v_booking.booking_time,v_booking.duration_minutes,
    v_booking.original_price_rub,v_booking.total_price_rub,v_booking.status::text,
    v_booking.total_price_rub,v_booking.duration_minutes;
end;
$function$
