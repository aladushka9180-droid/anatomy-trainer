\set ON_ERROR_STOP on

begin;
set local lock_timeout='5s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $guard$
begin
  if to_regprocedure('public.get_public_minuta_available_slots_v101(text,uuid,uuid,date,date)') is null
     or to_regprocedure('public.get_public_minuta_available_slots_group_safe(text,uuid,uuid,date,date)') is null
     or to_regprocedure('public.minuta_slot_respects_booking_buffer(uuid,date,time without time zone,integer,uuid)') is null
     or to_regclass('public.services') is null
     or to_regclass('public.booking_policies') is null
     or to_regclass('public.bookings') is null then
    raise exception using errcode='55000',message='v168_requires_protected_schedule_foundation';
  end if;
end
$guard$;

-- Resolve the service and optional booking buffer once. When the buffer is
-- enabled, apply the same overlap predicate set-wise so the schedule no longer
-- executes a nested security-definer RPC for every generated slot.
create or replace function public.get_public_minuta_available_slots_v101(
  p_slug text,p_location uuid,p_service uuid,p_start date,p_end date
)
returns table(booking_date date,booking_time time without time zone)
language plpgsql stable security definer set search_path to '' as $$
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
$$;

revoke all on function public.get_public_minuta_available_slots_v101(text,uuid,uuid,date,date)
  from public,anon,authenticated,service_role;
grant execute on function public.get_public_minuta_available_slots_v101(text,uuid,uuid,date,date)
  to anon,authenticated;

do $verify$
declare
  v_body text:=lower(pg_get_functiondef(
    'public.get_public_minuta_available_slots_v101(text,uuid,uuid,date,date)'::regprocedure
  ));
begin
  if position('v_buffer_enabled boolean' in v_body)=0
     or position('if not coalesce(v_buffer_enabled,false)' in v_body)=0
     or position('from public.bookings booking' in v_body)=0
     or position('minuta_slot_respects_booking_buffer' in v_body)>0
     or position('limit 512' in v_body)=0
     or not has_function_privilege('anon','public.get_public_minuta_available_slots_v101(text,uuid,uuid,date,date)','EXECUTE')
     or not has_function_privilege('authenticated','public.get_public_minuta_available_slots_v101(text,uuid,uuid,date,date)','EXECUTE')
     or has_function_privilege('service_role','public.get_public_minuta_available_slots_v101(text,uuid,uuid,date,date)','EXECUTE') then
    raise exception using errcode='55000',message='v168_verification_failed';
  end if;
end
$verify$;

notify pgrst,'reload schema';
commit;
