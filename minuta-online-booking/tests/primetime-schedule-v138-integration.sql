\set ON_ERROR_STOP on

begin;

-- The replacement is transaction-local and rolled back at the end. It gives
-- every day a dense 24-hour schedule so period filtering and caps are proved.
create or replace function public.get_public_minuta_available_slots_v101(
  p_slug text,p_location uuid,p_service uuid,p_start date,p_end date
)
returns table(booking_date date,booking_time time without time zone)
language sql stable security definer set search_path to '' as $$
  select day::date,make_time(hour,0,0)
  from generate_series(p_start,p_end,interval '1 day') day
  cross join generate_series(0,23) hour
  order by day,hour;
$$;

update public.primetime_server_credentials
set secret_sha256=encode(extensions.digest(convert_to(repeat('1',64),'UTF8'),'sha256'),'hex')
where credential_key='schedule_v138';

do $$
declare
  request jsonb:=jsonb_build_array(jsonb_build_object(
    'key','missing:service','slug','missing-tenant',
    'location','11111111-1111-4111-8111-111111111111',
    'service','22222222-2222-4222-8222-222222222222',
    'start',current_date::text,'end',(current_date+7)::text,'period','evening'
  ));
  result jsonb;
begin
  perform set_config('request.headers','{}',true);
  begin
    perform public.get_primetime_schedule_v138(request);
    raise exception 'unauthorized_request_was_accepted';
  exception when insufficient_privilege then null;
  end;

  perform set_config('request.headers',jsonb_build_object(
    'x-primetime-upstream-key',repeat('1',64)
  )::text,true);
  result:=public.get_primetime_schedule_v138(request);
  if jsonb_array_length(result)<>1
     or result->0->>'key'<>'missing:service'
     or jsonb_typeof(result->0->'slots')<>'array'
     or jsonb_array_length(result->0->'slots')<>24
     or exists(
       select 1 from jsonb_array_elements(result->0->'slots') slot
       where (slot->>'booking_time')::time<'17:00'::time
     ) then
    raise exception 'valid_batch_result_failed: %',result;
  end if;

  begin
    perform public.get_primetime_schedule_v138(jsonb_build_array(jsonb_build_object(
      'key','missing:service','slug','missing-tenant',
      'location','11111111-1111-4111-8111-111111111111',
      'service','22222222-2222-4222-8222-222222222222',
      'start',current_date::text,'end',(current_date+9)::text,'period','any'
    )));
    raise exception 'oversized_range_was_accepted';
  exception when invalid_parameter_value then null;
  end;
end
$$;

create or replace function pg_temp.expect_invalid_v138(payload jsonb)
returns void language plpgsql as $$
begin
  perform public.get_primetime_schedule_v138(payload);
  raise exception 'invalid_payload_was_accepted: %',payload;
exception when invalid_parameter_value then null;
end
$$;

select pg_temp.expect_invalid_v138('[]'::jsonb);
select pg_temp.expect_invalid_v138((
  select jsonb_agg(jsonb_build_object(
    'key','key-'||value,'slug','missing-tenant',
    'location','11111111-1111-4111-8111-111111111111',
    'service','22222222-2222-4222-8222-222222222222',
    'start',current_date::text,'end',current_date::text,'period','any'
  )) from generate_series(1,13) value
));
select pg_temp.expect_invalid_v138(jsonb_build_array(
  jsonb_build_object('key','same:key','slug','missing-tenant','location','11111111-1111-4111-8111-111111111111','service','22222222-2222-4222-8222-222222222222','start',current_date::text,'end',current_date::text,'period','any'),
  jsonb_build_object('key','same:key','slug','missing-tenant','location','11111111-1111-4111-8111-111111111111','service','22222222-2222-4222-8222-222222222222','start',current_date::text,'end',current_date::text,'period','any')
));
select pg_temp.expect_invalid_v138(jsonb_build_array(jsonb_build_object(
  'key','extra:key','slug','missing-tenant','location','11111111-1111-4111-8111-111111111111',
  'service','22222222-2222-4222-8222-222222222222','start',current_date::text,
  'end',current_date::text,'period','any','extra',true
)));
select pg_temp.expect_invalid_v138(jsonb_build_array(jsonb_build_object(
  'key','extra:key','slug','missing-tenant','location','11111111-1111-4111-8111-111111111111',
  'service','22222222-2222-4222-8222-222222222222','start',current_date::text,
  'end',current_date::text,'period','any','extra',repeat('x',9000)
)));
select pg_temp.expect_invalid_v138(jsonb_build_array(jsonb_build_object(
  'key','bad:uuid','slug','missing-tenant','location','not-a-uuid',
  'service','22222222-2222-4222-8222-222222222222','start',current_date::text,
  'end',current_date::text,'period','any'
)));
select pg_temp.expect_invalid_v138(jsonb_build_array(jsonb_build_object(
  'key','bad:date','slug','missing-tenant','location','11111111-1111-4111-8111-111111111111',
  'service','22222222-2222-4222-8222-222222222222','start','2026-02-31',
  'end','2026-02-31','period','any'
)));

do $$ begin
  if not has_function_privilege('anon','public.get_primetime_schedule_v138(jsonb)','EXECUTE')
     or has_function_privilege('authenticated','public.get_primetime_schedule_v138(jsonb)','EXECUTE')
     or has_table_privilege('anon','public.primetime_server_credentials','SELECT') then
    raise exception 'v138_acl_failed';
  end if;
end $$;

rollback;
