\set ON_ERROR_STOP on

begin;

-- Deterministic schedule rows and cadence. Both replacements are rolled back.
create or replace function public.get_public_minuta_available_slots_v101(
  p_slug text,p_location uuid,p_service uuid,p_start date,p_end date
)
returns table(booking_date date,booking_time time without time zone)
language sql stable security definer set search_path to '' as $$
  select p_start,make_time(slot_hour,0,0)
  from generate_series(0,119) ordinal
  cross join lateral(
    select case
      when p_service='33333333-3333-4333-8333-333333333333'::uuid
        then 8+(ordinal*2)%16
      else case ordinal
        when 0 then 10
        when 1 then 11
        when 2 then 12
        when 3 then 14
        when 4 then 15
      end
    end as slot_hour
  ) value
  where (p_service='33333333-3333-4333-8333-333333333333'::uuid and ordinal<120)
     or (p_service<>'33333333-3333-4333-8333-333333333333'::uuid and ordinal<5)
  order by ordinal;
$$;

create or replace function public.get_primetime_slot_step_v139(
  p_service uuid,p_date date
)
returns integer language sql stable security definer set search_path to '' as $$
  select case
    when p_service='33333333-3333-4333-8333-333333333333'::uuid then 30
    else 60
  end
$$;

update public.primetime_server_credentials
set secret_sha256=encode(extensions.digest(convert_to(repeat('1',64),'UTF8'),'sha256'),'hex')
where credential_key='schedule_v138';

do $$
declare
  request jsonb:=jsonb_build_array(jsonb_build_object(
    'key','range:service','slug','missing-tenant',
    'location','11111111-1111-4111-8111-111111111111',
    'service','22222222-2222-4222-8222-222222222222',
    'start',current_date::text,'end',current_date::text,'period','any','mode','ranges'
  ));
  result jsonb;
  exact jsonb;
begin
  perform set_config('request.headers','{}',true);
  begin
    perform public.get_primetime_schedule_v139(request);
    raise exception 'unauthorized_request_was_accepted';
  exception when insufficient_privilege then null;
  end;

  perform set_config('request.headers',jsonb_build_object(
    'x-primetime-upstream-key',repeat('1',64)
  )::text,true);
  result:=public.get_primetime_schedule_v139(request);
  if jsonb_array_length(result)<>1
     or result->0->>'mode'<>'ranges'
     or result->0->>'has_more'<>'false'
     or jsonb_array_length(result->0->'ranges')<>2
     or result->0->'ranges'->0->>'first_start'<>'10:00:00'
     or result->0->'ranges'->0->>'last_start'<>'12:00:00'
     or result->0->'ranges'->0->>'start_count'<>'3'
     or result->0->'ranges'->1->>'first_start'<>'14:00:00'
     or result->0->'ranges'->1->>'last_start'<>'15:00:00' then
    raise exception 'range_grouping_failed: %',result;
  end if;

  exact:=public.get_primetime_schedule_v139(jsonb_build_array(jsonb_build_object(
    'key','exact:service','slug','missing-tenant',
    'location','11111111-1111-4111-8111-111111111111',
    'service','33333333-3333-4333-8333-333333333333',
    'start',current_date::text,'end',current_date::text,'period','any','mode','slots'
  )));
  if jsonb_array_length(exact->0->'slots')<>96
     or exact->0->>'has_more'<>'true'
     or jsonb_array_length(exact->0->'ranges')<>0 then
    raise exception 'exact_slot_bound_failed: %',exact;
  end if;
end
$$;

create or replace function pg_temp.expect_invalid_v139(payload jsonb)
returns void language plpgsql as $$
begin
  perform public.get_primetime_schedule_v139(payload);
  raise exception 'invalid_payload_was_accepted: %',payload;
exception when invalid_parameter_value then null;
end
$$;

select pg_temp.expect_invalid_v139('[]'::jsonb);
select pg_temp.expect_invalid_v139((
  select jsonb_agg(jsonb_build_object(
    'key','key-'||value,'slug','missing-tenant',
    'location','11111111-1111-4111-8111-111111111111',
    'service','22222222-2222-4222-8222-222222222222',
    'start',current_date::text,'end',current_date::text,'period','any','mode','ranges'
  )) from generate_series(1,13) value
));
select pg_temp.expect_invalid_v139(jsonb_build_array(
  jsonb_build_object('key','same:key','slug','missing-tenant','location','11111111-1111-4111-8111-111111111111','service','22222222-2222-4222-8222-222222222222','start',current_date::text,'end',current_date::text,'period','any','mode','ranges'),
  jsonb_build_object('key','same:key','slug','missing-tenant','location','11111111-1111-4111-8111-111111111111','service','22222222-2222-4222-8222-222222222222','start',current_date::text,'end',current_date::text,'period','any','mode','ranges')
));
select pg_temp.expect_invalid_v139(jsonb_build_array(
  jsonb_build_object('key','slot:one','slug','missing-tenant','location','11111111-1111-4111-8111-111111111111','service','22222222-2222-4222-8222-222222222222','start',current_date::text,'end',current_date::text,'period','any','mode','slots'),
  jsonb_build_object('key','slot:two','slug','missing-tenant','location','11111111-1111-4111-8111-111111111111','service','22222222-2222-4222-8222-222222222222','start',current_date::text,'end',current_date::text,'period','any','mode','slots')
));
select pg_temp.expect_invalid_v139(jsonb_build_array(jsonb_build_object(
  'key','slot:days','slug','missing-tenant','location','11111111-1111-4111-8111-111111111111',
  'service','22222222-2222-4222-8222-222222222222','start',current_date::text,
  'end',(current_date+1)::text,'period','any','mode','slots'
)));
select pg_temp.expect_invalid_v139(jsonb_build_array(jsonb_build_object(
  'key','extra:key','slug','missing-tenant','location','11111111-1111-4111-8111-111111111111',
  'service','22222222-2222-4222-8222-222222222222','start',current_date::text,
  'end',current_date::text,'period','any','mode','ranges','extra',true
)));

do $$ begin
  if not has_function_privilege('anon','public.get_primetime_schedule_v139(jsonb)','EXECUTE')
     or has_function_privilege('authenticated','public.get_primetime_schedule_v139(jsonb)','EXECUTE')
     or has_function_privilege('anon','public.get_primetime_slot_ranges_v139(text,uuid,uuid,date,date,text)','EXECUTE') then
    raise exception 'v139_acl_failed';
  end if;
end $$;

rollback;
