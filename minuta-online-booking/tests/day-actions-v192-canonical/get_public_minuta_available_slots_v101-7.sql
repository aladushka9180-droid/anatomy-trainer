CREATE OR REPLACE FUNCTION public.get_public_minuta_available_slots_v101(p_slug text, p_location uuid, p_service uuid, p_start date, p_end date)
 RETURNS TABLE(booking_date date, booking_time time without time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_buffer_enabled boolean:=false;
  v_buffer_minutes integer:=60;
  v_duration_minutes integer;
  v_performer uuid;
begin
  if p_slug is null
     or p_slug<>lower(trim(p_slug))
     or p_slug!~'^[a-z0-9][a-z0-9-]{1,79}$'
     or p_location is null or p_service is null
     or p_start is null or p_end is null
     or p_start<current_date-1
     or p_end<p_start
     or p_end>current_date+14
     or p_end-p_start>14 then
    raise exception using errcode='22023',message='invalid_public_schedule_scope';
  end if;

  select service.performer_id,service.duration_minutes,
    coalesce(policy.booking_buffer_enabled,false),
    coalesce(policy.booking_buffer_minutes,60)
  into v_performer,v_duration_minutes,v_buffer_enabled,v_buffer_minutes
  from public.services service
  left join public.booking_policies policy
    on policy.performer_id=service.performer_id
  where service.id=p_service;

  if not coalesce(v_buffer_enabled,false) then
    return query
    select slot.booking_date,slot.booking_time
    from public.get_public_minuta_available_slots_group_safe(
      p_slug,p_location,p_service,p_start,p_end
    ) slot
    order by slot.booking_date,slot.booking_time
    limit 512;
    return;
  end if;

  return query
  select slot.booking_date,slot.booking_time
  from public.get_public_minuta_available_slots_group_safe(
    p_slug,p_location,p_service,p_start,p_end
  ) slot
  where not exists(
    select 1
    from public.bookings booking
    where booking.performer_id=v_performer
      and booking.booking_date=slot.booking_date
      and booking.status<>'cancelled'
      and regexp_replace(coalesce(booking.client_phone,''),'\D','','g')<>'0000000000'
      and tsrange(
        slot.booking_date+slot.booking_time,
        slot.booking_date+slot.booking_time+make_interval(mins=>v_duration_minutes),
        '[)'
      ) && tsrange(
        booking.booking_date+booking.booking_time-make_interval(mins=>v_buffer_minutes),
        booking.booking_date+booking.booking_time
          +make_interval(mins=>booking.duration_minutes+v_buffer_minutes),
        '[)'
      )
  )
  order by slot.booking_date,slot.booking_time
  limit 512;
end
$function$
