CREATE OR REPLACE FUNCTION public.minuta_block_slot_valid_v141(p_organization uuid, p_location uuid, p_date date, p_time time without time zone, p_duration integer, p_ignore_booking uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid:=auth.uid(); v_schedule public.provider_schedule%rowtype; v_zone text; v_end timestamp;
begin
  if v_actor is null then raise exception using errcode='42501',message='authentication_required'; end if;
  if p_organization is null or p_location is null or p_date is null or p_time is null
     or p_duration is null or p_duration not between 1 and 480 or extract(second from p_time)<>0 then return false; end if;
  select location.timezone into v_zone
  from public.locations location
  join public.organizations organization on organization.id=location.organization_id and organization.status='active'
  join public.organization_memberships member on member.organization_id=organization.id
    and member.user_id=v_actor and member.active and member.is_bookable
  where location.id=p_location and location.organization_id=p_organization and location.active;
  if v_zone is null then return false; end if;
  begin perform pg_catalog.timezone(v_zone,p_date::timestamp); exception when invalid_parameter_value then return false; end;
  v_end:=p_date+p_time+make_interval(mins=>p_duration);
  if p_date+p_time<=timezone(v_zone,now()) or p_date>timezone(v_zone,now())::date+730 or v_end>p_date+1 then return false; end if;
  select * into v_schedule from public.provider_schedule
  where performer_id=v_actor and weekday=extract(isodow from p_date)::integer;
  if not found or not v_schedule.enabled or v_schedule.start_time is null or v_schedule.end_time is null
     or p_time<v_schedule.start_time or v_end>p_date+v_schedule.end_time then return false; end if;
  if v_schedule.break_start is not null and v_schedule.break_end is not null
     and tsrange(p_date+p_time,v_end,'[)')&&tsrange(p_date+v_schedule.break_start,p_date+v_schedule.break_end,'[)') then return false; end if;
  if exists(select 1 from public.provider_days_off day_off where day_off.performer_id=v_actor and day_off.off_date=p_date
    and (day_off.all_day or day_off.start_time is null or day_off.end_time is null
      or tsrange(p_date+p_time,v_end,'[)')&&tsrange(p_date+day_off.start_time,p_date+day_off.end_time,'[)'))) then return false; end if;
  if exists(select 1 from public.bookings booking where booking.performer_id=v_actor and booking.status<>'cancelled'
    and (p_ignore_booking is null or booking.id<>p_ignore_booking)
    and tsrange(p_date+p_time,v_end,'[)')&&tsrange(booking.booking_date+booking.booking_time,
      booking.booking_date+booking.booking_time+make_interval(mins=>booking.duration_minutes),'[)')) then return false; end if;
  if not coalesce(public.minuta_booking_fits_active_shift(p_organization,p_location,v_actor,p_date,p_time,p_duration),false) then return false; end if;
  if exists(select 1 from public.group_booking_events event where event.organization_id=p_organization
    and event.location_id=p_location and event.performer_id=v_actor and event.event_date=p_date
    and event.status in ('published','closed')
    and tsrange(p_date+p_time,v_end,'[)')&&tsrange(event.event_date+event.start_time,
      event.event_date+event.start_time+make_interval(mins=>event.duration_minutes),'[)')) then return false; end if;
  return true;
end $function$
