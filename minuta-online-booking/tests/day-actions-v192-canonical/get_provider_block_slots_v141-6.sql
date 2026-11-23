CREATE OR REPLACE FUNCTION public.get_provider_block_slots_v141(p_organization uuid, p_location uuid, p_date date, p_duration integer, p_ignore_booking uuid DEFAULT NULL::uuid)
 RETURNS TABLE(booking_date date, booking_time time without time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_minute integer; v_first integer; v_last integer;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication_required'; end if;
  if p_duration is null or p_duration not between 1 and 480 then raise exception using errcode='22023',message='invalid_block_duration'; end if;
  select ceil(extract(epoch from start_time)/60)::integer,
    floor(extract(epoch from end_time)/60)::integer-p_duration into v_first,v_last
  from public.provider_schedule where performer_id=auth.uid()
    and weekday=extract(isodow from p_date)::integer and enabled;
  if not found or v_first is null or v_last is null or v_first>v_last then return; end if;
  for v_minute in v_first..v_last loop
    if public.minuta_block_slot_valid_v141(p_organization,p_location,p_date,
      (time '00:00'+make_interval(mins=>v_minute))::time,p_duration,p_ignore_booking) then
      booking_date:=p_date; booking_time:=(time '00:00'+make_interval(mins=>v_minute))::time; return next;
    end if;
  end loop;
end $function$
