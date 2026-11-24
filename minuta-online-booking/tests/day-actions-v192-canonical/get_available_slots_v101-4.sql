CREATE OR REPLACE FUNCTION public.get_available_slots_v101(p_service uuid, p_start date, p_end date, p_ignore_booking uuid DEFAULT NULL::uuid)
 RETURNS TABLE(booking_date date, booking_time time without time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select slot.booking_date, slot.booking_time
  from public.get_available_slots(p_service, p_start, p_end, p_ignore_booking) slot
  where public.minuta_slot_respects_booking_buffer(
    p_service, slot.booking_date, slot.booking_time, null, p_ignore_booking
  )
  order by slot.booking_date, slot.booking_time;
$function$
