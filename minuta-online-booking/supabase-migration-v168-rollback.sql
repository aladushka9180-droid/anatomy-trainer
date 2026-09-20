\set ON_ERROR_STOP on

begin;
set local lock_timeout='5s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

-- Exact v138 definition that was active before v168.
create or replace function public.get_public_minuta_available_slots_v101(
  p_slug text,p_location uuid,p_service uuid,p_start date,p_end date
)
returns table(booking_date date,booking_time time without time zone)
language plpgsql stable security definer set search_path to '' as $$
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
  return query
  select slot.booking_date,slot.booking_time
  from public.get_public_minuta_available_slots_group_safe(
    p_slug,p_location,p_service,p_start,p_end
  ) slot
  where public.minuta_slot_respects_booking_buffer(
    p_service,slot.booking_date,slot.booking_time,null,null
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
  if position('v_buffer_enabled boolean' in v_body)>0
     or position('minuta_slot_respects_booking_buffer' in v_body)=0
     or position('limit 512' in v_body)=0 then
    raise exception using errcode='55000',message='v168_rollback_verification_failed';
  end if;
end
$verify$;

notify pgrst,'reload schema';
commit;
