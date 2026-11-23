CREATE OR REPLACE FUNCTION public.get_available_slots(p_service uuid, p_start date, p_end date, p_ignore_booking uuid DEFAULT NULL::uuid)
 RETURNS TABLE(booking_date date, booking_time time without time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with service_data as (
    select s.performer_id, s.duration_minutes
    from public.services s
    where s.id = p_service and s.active
  ), days as (
    select generate_series(p_start, p_end, interval '1 day')::date as booking_date
  )
  select d.booking_date, slot.slot_start::time as booking_time
  from service_data service
  cross join days d
  join public.provider_schedule schedule
    on schedule.performer_id = service.performer_id
   and schedule.weekday = extract(isodow from d.booking_date)::smallint
   and schedule.enabled
  cross join lateral generate_series(
    d.booking_date + schedule.start_time,
    d.booking_date + schedule.end_time - make_interval(mins => service.duration_minutes),
    make_interval(mins => schedule.slot_interval_minutes)
  ) slot(slot_start)
  where (schedule.break_start is null
      or slot.slot_start + make_interval(mins => service.duration_minutes) <= d.booking_date + schedule.break_start
      or slot.slot_start >= d.booking_date + schedule.break_end)
    and not exists (
      select 1 from public.provider_days_off off
      where off.performer_id = service.performer_id and off.off_date = d.booking_date
        and (off.all_day
          or (slot.slot_start < d.booking_date + off.end_time
              and slot.slot_start + make_interval(mins => service.duration_minutes) > d.booking_date + off.start_time))
    )
    and not exists (
      select 1 from public.bookings booking
      where booking.performer_id = service.performer_id and booking.status <> 'cancelled'
        and (p_ignore_booking is null or booking.id <> p_ignore_booking)
        and slot.slot_start < booking.slot_end
        and slot.slot_start + make_interval(mins => service.duration_minutes) > booking.slot_start
    )
    and (d.booking_date > current_date or slot.slot_start > localtimestamp)
  order by d.booking_date, booking_time;
$function$
