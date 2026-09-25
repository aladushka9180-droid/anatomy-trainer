-- ISOLATED TEST DATABASE ONLY. Uses existing test-fixture catalog rows and rolls back.
begin;
create function pg_temp.v180_assert(ok boolean,label text)
returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'v180_assert:%',label; end if; end
$$;

select pg_temp.v180_assert(
  to_regprocedure('public.book_flexible_appointment_v180(uuid,uuid,date,time without time zone,time without time zone,text,text,text,uuid,integer,integer,text)') is not null,
  'rpc_present');
select pg_temp.v180_assert(
  has_function_privilege('anon','public.book_flexible_appointment_v180(uuid,uuid,date,time without time zone,time without time zone,text,text,text,uuid,integer,integer,text)','execute')
  and has_function_privilege('authenticated','public.book_flexible_appointment_v180(uuid,uuid,date,time without time zone,time without time zone,text,text,text,uuid,integer,integer,text)','execute')
  and not has_function_privilege('service_role','public.book_flexible_appointment_v180(uuid,uuid,date,time without time zone,time without time zone,text,text,text,uuid,integer,integer,text)','execute'),
  'rpc_acl');

do $fixture$
declare v_service uuid; v_date date; v_time time; v_missing time;
begin
  select service.id,slot.booking_date,slot.booking_time
  into v_service,v_date,v_time
  from public.services service
  cross join lateral public.get_available_slots_v101(
    service.id,current_date+1,current_date+14,null) slot
  where service.active and slot.booking_time >= '01:00'::time
  order by slot.booking_date,slot.booking_time limit 1;
  if v_service is null then
    raise exception using errcode='55000',message='v180_test_requires_available_fixture_service';
  end if;
  select minute_mark::time into v_missing
  from generate_series(v_date+'00:00'::time,v_date+'23:59'::time,interval '1 minute') minute_mark
  where not exists(
    select 1 from public.get_available_slots_v101(v_service,v_date,v_date,null) slot
    where slot.booking_time=minute_mark::time
  ) limit 1;
  perform set_config('v180.service',v_service::text,true);
  perform set_config('v180.date',v_date::text,true);
  perform set_config('v180.time',v_time::text,true);
  perform set_config('v180.missing',v_missing::text,true);
  perform set_config('v180.request',gen_random_uuid()::text,true);
end
$fixture$;

set local role anon;
select set_config('v180.created',public.book_flexible_appointment_v180(
  current_setting('v180.request')::uuid,current_setting('v180.service')::uuid,
  current_setting('v180.date')::date,
  current_setting('v180.time')::time-interval '1 minute',current_setting('v180.time')::time,
  'V180 Synthetic Client','+79990000178')::text,true);
select set_config('v180.replay',public.book_flexible_appointment_v180(
  current_setting('v180.request')::uuid,current_setting('v180.service')::uuid,
  current_setting('v180.date')::date,
  current_setting('v180.time')::time-interval '1 minute',current_setting('v180.time')::time,
  'V180 Synthetic Client','+79990000178')::text,true);
select set_config('v180.no_slot',public.book_flexible_appointment_v180(
  gen_random_uuid(),current_setting('v180.service')::uuid,
  current_setting('v180.date')::date,
  current_setting('v180.missing')::time,current_setting('v180.missing')::time,
  'V180 Synthetic Client','+79990000179')::text,true);
reset role;

select pg_temp.v180_assert(
  current_setting('v180.created')::jsonb->>'result_code'='ok'
  and current_setting('v180.created')::jsonb->>'booking_time'=current_setting('v180.time')
  and current_setting('v180.created')::jsonb->>'booking_id'=current_setting('v180.replay')::jsonb->>'booking_id'
  and (select count(*) from public.bookings where request_id=current_setting('v180.request')::uuid)=1,
  'nearest_slot_atomic_replay');
select pg_temp.v180_assert(
  current_setting('v180.no_slot')::jsonb->>'result_code'='no_slot_in_range',
  'bounded_no_slot');
rollback;
