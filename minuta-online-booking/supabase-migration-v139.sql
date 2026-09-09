\set ON_ERROR_STOP on

begin;
set local lock_timeout='5s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $guard$
begin
  if to_regprocedure('public.get_primetime_schedule_v138(jsonb)') is null
     or to_regprocedure('public.get_public_minuta_available_slots_v101(text,uuid,uuid,date,date)') is null
     or to_regclass('public.provider_schedule') is null
     or to_regclass('public.services') is null then
    raise exception using errcode='55000',message='v139_requires_protected_schedule_v138';
  end if;
end
$guard$;

-- The cadence comes from the provider schedule. It is never inferred from
-- neighbouring available starts because a booking can create a real gap.
create or replace function public.get_primetime_slot_step_v139(
  p_service uuid,p_date date
)
returns integer language sql stable security definer set search_path to '' as $$
  select case
    when schedule.slot_interval_minutes between 5 and 240
      then schedule.slot_interval_minutes
    else null
  end
  from public.services service
  join public.provider_schedule schedule
    on schedule.performer_id=service.performer_id
   and schedule.weekday=extract(isodow from p_date)::integer
   and schedule.enabled
  where service.id=p_service and service.active
  limit 1
$$;

revoke all on function public.get_primetime_slot_step_v139(uuid,date)
  from public,anon,authenticated,service_role;

create or replace function public.get_primetime_slot_ranges_v139(
  p_slug text,p_location uuid,p_service uuid,p_start date,p_end date,p_period text
)
returns table(
  booking_date date,
  first_start time without time zone,
  last_start time without time zone,
  step_minutes integer,
  start_count integer
)
language sql stable security definer set search_path to '' as $$
  with raw_slots as(
    select distinct slot.booking_date,slot.booking_time
    from public.get_public_minuta_available_slots_v101(
      p_slug,p_location,p_service,p_start,p_end
    ) slot
    where case p_period
      when 'morning' then slot.booking_time<'12:00'::time
      when 'day' then slot.booking_time>='12:00'::time and slot.booking_time<'17:00'::time
      when 'evening' then slot.booking_time>='17:00'::time
      else true end
  ), cadence as(
    select dates.booking_date,
      public.get_primetime_slot_step_v139(p_service,dates.booking_date) step_minutes
    from (select distinct booking_date from raw_slots) dates
  ), available as(
    select raw_slots.booking_date,raw_slots.booking_time,cadence.step_minutes
    from raw_slots join cadence using(booking_date)
  ), previous as(
    select available.*,
      lag(booking_time) over(
        partition by booking_date order by booking_time
      ) previous_time
    from available
  ), marked as(
    select previous.*,
      case
        when previous_time is not null
         and step_minutes is not null
         and booking_time=previous_time+make_interval(mins=>step_minutes)
          then 0
        else 1
      end range_break
    from previous
  ), grouped as(
    select marked.*,
      sum(range_break) over(
        partition by booking_date order by booking_time
      ) range_number
    from marked
  )
  select grouped.booking_date,min(grouped.booking_time),max(grouped.booking_time),
    min(grouped.step_minutes),count(*)::integer
  from grouped
  group by grouped.booking_date,grouped.range_number
  order by grouped.booking_date,min(grouped.booking_time)
$$;

revoke all on function public.get_primetime_slot_ranges_v139(text,uuid,uuid,date,date,text)
  from public,anon,authenticated,service_role;

-- Ranges are bounded for the catalog. Exact starts are only allowed for one
-- service on one day, after the visitor opens a range.
create or replace function public.get_primetime_schedule_v139(p_requests jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  v_headers jsonb;
  v_secret text;
  v_count integer;
  v_invalid boolean;
  v_result jsonb;
begin
  begin
    v_headers:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
  exception when others then
    v_headers:='{}'::jsonb;
  end;
  v_secret:=coalesce(v_headers->>'x-primetime-upstream-key','');
  if char_length(v_secret)<>64 or not exists(
    select 1 from public.primetime_server_credentials credential
    where credential.credential_key='schedule_v138' and credential.active
      and credential.secret_sha256=encode(
        extensions.digest(convert_to(v_secret,'UTF8'),'sha256'),'hex'
      )
  ) then
    raise exception using errcode='42501',message='schedule_access_denied';
  end if;

  if p_requests is null or jsonb_typeof(p_requests)<>'array'
     or octet_length(p_requests::text)>9216 then
    raise exception using errcode='22023',message='invalid_primetime_schedule_scope';
  end if;
  v_count:=jsonb_array_length(p_requests);
  if v_count<1 or v_count>12 then
    raise exception using errcode='22023',message='invalid_primetime_schedule_scope';
  end if;

  select coalesce(bool_or(
    jsonb_typeof(item)<>'object'
    or item-array['key','slug','location','service','start','end','period','mode']::text[]<>'{}'::jsonb
    or coalesce(item->>'key','')!~'^[a-z0-9][a-z0-9:_-]{1,179}$'
    or coalesce(item->>'slug','')!~'^[a-z0-9][a-z0-9-]{1,79}$'
    or coalesce(item->>'location','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(item->>'service','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(item->>'period','') not in('any','morning','day','evening')
    or coalesce(item->>'mode','') not in('ranges','slots')
    or coalesce(item->>'start','')!~'^\d{4}-\d{2}-\d{2}$'
    or coalesce(item->>'end','')!~'^\d{4}-\d{2}-\d{2}$'
  ),false) into v_invalid from jsonb_array_elements(p_requests) item;
  if v_invalid then
    raise exception using errcode='22023',message='invalid_primetime_schedule_scope';
  end if;

  begin
    select coalesce(bool_or(
      (item->>'start')::date::text<>item->>'start'
      or (item->>'end')::date::text<>item->>'end'
      or (item->>'start')::date<current_date
      or (item->>'end')::date<(item->>'start')::date
      or (item->>'end')::date>current_date+8
      or (item->>'end')::date-(item->>'start')::date>8
      or (item->>'mode'='slots' and (item->>'start')::date<>(item->>'end')::date)
    ),false) into v_invalid from jsonb_array_elements(p_requests) item;
  exception when others then
    v_invalid:=true;
  end;
  if v_invalid
     or (select count(distinct item->>'key')<>v_count from jsonb_array_elements(p_requests) item)
     or (select count(*) from jsonb_array_elements(p_requests) item where item->>'mode'='slots')>0
        and (v_count<>1 or (p_requests->0->>'mode')<>'slots') then
    raise exception using errcode='22023',message='invalid_primetime_schedule_scope';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'key',request.item->>'key',
    'mode',request.item->>'mode',
    'ranges',coalesce(ranges.value,'[]'::jsonb),
    'slots',coalesce(slots.value,'[]'::jsonb),
    'has_more',case request.item->>'mode'
      when 'ranges' then coalesce(ranges.total,0)>24
      else coalesce(slots.total,0)>96 end
  ) order by request.ordinality),'[]'::jsonb) into v_result
  from jsonb_array_elements(p_requests) with ordinality request(item,ordinality)
  left join lateral(
    select jsonb_agg(jsonb_build_object(
      'booking_date',bounded.booking_date,
      'first_start',bounded.first_start,
      'last_start',bounded.last_start,
      'step_minutes',bounded.step_minutes,
      'start_count',bounded.start_count
    ) order by bounded.booking_date,bounded.first_start) value,
      coalesce(max(bounded.total),0)::integer total
    from(
      select range.*,count(*) over() total
      from public.get_primetime_slot_ranges_v139(
        request.item->>'slug',(request.item->>'location')::uuid,
        (request.item->>'service')::uuid,(request.item->>'start')::date,
        (request.item->>'end')::date,request.item->>'period'
      ) range
      order by range.booking_date,range.first_start
      limit 24
    ) bounded
  ) ranges on request.item->>'mode'='ranges'
  left join lateral(
    select jsonb_agg(jsonb_build_object(
      'booking_date',bounded.booking_date,'booking_time',bounded.booking_time
    ) order by bounded.booking_date,bounded.booking_time) value,
      coalesce(max(bounded.total),0)::integer total
    from(
      select slot.booking_date,slot.booking_time,count(*) over() total
      from public.get_public_minuta_available_slots_v101(
        request.item->>'slug',(request.item->>'location')::uuid,
        (request.item->>'service')::uuid,(request.item->>'start')::date,
        (request.item->>'end')::date
      ) slot
      where case request.item->>'period'
        when 'morning' then slot.booking_time<'12:00'::time
        when 'day' then slot.booking_time>='12:00'::time and slot.booking_time<'17:00'::time
        when 'evening' then slot.booking_time>='17:00'::time
        else true end
      order by slot.booking_date,slot.booking_time
      limit 96
    ) bounded
  ) slots on request.item->>'mode'='slots';
  return v_result;
end
$$;

revoke all on function public.get_primetime_schedule_v139(jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.get_primetime_schedule_v139(jsonb) to anon;

do $verify$
begin
  if to_regprocedure('public.get_primetime_schedule_v139(jsonb)') is null
     or to_regprocedure('public.get_primetime_slot_ranges_v139(text,uuid,uuid,date,date,text)') is null
     or has_function_privilege('anon','public.get_primetime_slot_ranges_v139(text,uuid,uuid,date,date,text)','EXECUTE')
     or not has_function_privilege('anon','public.get_primetime_schedule_v139(jsonb)','EXECUTE')
     or has_function_privilege('authenticated','public.get_primetime_schedule_v139(jsonb)','EXECUTE')
     or position('limit 24' in lower(pg_get_functiondef('public.get_primetime_schedule_v139(jsonb)'::regprocedure)))=0
     or position('limit 96' in lower(pg_get_functiondef('public.get_primetime_schedule_v139(jsonb)'::regprocedure)))=0 then
    raise exception using errcode='55000',message='v139_verification_failed';
  end if;
end
$verify$;

notify pgrst,'reload schema';
commit;
