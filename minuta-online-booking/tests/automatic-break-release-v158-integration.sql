\set ON_ERROR_STOP on
begin;
\ir booking-concurrency-v123-fixture.sql

create function pg_temp.v158_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'v158_assert:%',label; end if; end $$;

insert into public.booking_policies(performer_id,booking_buffer_enabled,booking_buffer_minutes)
values(current_setting('v123.actor')::uuid,false,60)
on conflict(performer_id) do update set booking_buffer_enabled=false,booking_buffer_minutes=60;

select set_config('v158.code1',public.provider_book_appointment(current_setting('v123.service')::uuid,current_setting('v123.date')::date,'11:00','V158 first','0000000000'),true);
select set_config('v158.code2',public.provider_book_appointment(current_setting('v123.service')::uuid,current_setting('v123.date')::date,'13:00','V158 second','0000000000'),true);
update public.bookings set client_phone=case booking_code when current_setting('v158.code1') then '79990000181' else '79990000182' end,
  organization_id=current_setting('v123.org')::uuid,location_id=current_setting('v123.loc')::uuid
where booking_code in(current_setting('v158.code1'),current_setting('v158.code2'));
select set_config('v158.booking2',(select id::text from public.bookings where booking_code=current_setting('v158.code2')),true);
update public.booking_policies set booking_buffer_enabled=true where performer_id=current_setting('v123.actor')::uuid;

set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('v123.actor'),true);
select set_config('v158.segment',(select row_to_json(segment)::text from public.get_minuta_provider_automatic_breaks_v158(current_setting('v123.date')::date) segment where start_time='12:00' and end_time='13:00'),true);
reset role;
select pg_temp.v158_assert(current_setting('v158.segment')::jsonb->>'source_count'='2','merged_segment_has_every_source');
select set_config('v158.request',gen_random_uuid()::text,true);

set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('v123.actor'),true);
select set_config('v158.result',public.release_minuta_provider_automatic_break_v158(
  current_setting('v158.request')::uuid,current_setting('v123.date')::date,'12:00','13:00',current_setting('v158.segment')::jsonb->>'segment_fingerprint'
)::text,true);
reset role;

select pg_temp.v158_assert(
  current_setting('v158.result')::jsonb->>'action'='released'
  and current_setting('v158.result')::jsonb->>'request_id'=current_setting('v158.request')
  and current_setting('v158.result')::jsonb->>'source_count'='2'
  and (select count(*)=1 from public.booking_buffer_release_requests_v158 where request_id=current_setting('v158.request')::uuid)
  and (select count(*)=2 from public.booking_buffer_release_sources_v158 source join public.booking_buffer_release_requests_v158 request on request.id=source.release_id where request.request_id=current_setting('v158.request')::uuid),
  'atomic_release_and_durable_sources'
);

set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('v123.actor'),true);
select pg_temp.v158_assert(not exists(select 1 from public.get_minuta_provider_automatic_breaks_v158(current_setting('v123.date')::date) where start_time<'13:00' and end_time>'12:00'),'released_segment_disappears');
reset role;
select pg_temp.v158_assert(public.minuta_slot_respects_booking_buffer(current_setting('v123.service')::uuid,current_setting('v123.date')::date,'12:00',60,null),'released_slot_is_available');
select pg_temp.v158_assert(exists(
  select 1 from public.get_available_slots_v101(current_setting('v123.service')::uuid,current_setting('v123.date')::date,current_setting('v123.date')::date,null)
  where booking_time='12:00'
),'released_slot_is_listed_by_provider_rpc');
select set_config('v158.released_code',public.provider_book_appointment(
  current_setting('v123.service')::uuid,current_setting('v123.date')::date,'12:00','V158 released full','79990000183'
),true);
select pg_temp.v158_assert(exists(
  select 1 from public.bookings where booking_code=current_setting('v158.released_code') and booking_time='12:00'
),'released_slot_passes_write_authorization');
select pg_temp.v158_assert(not public.minuta_slot_respects_booking_buffer(current_setting('v123.service')::uuid,current_setting('v123.date')::date,'12:30',60,null),'actual_booking_remains_protected');
select pg_temp.v158_assert(not public.minuta_slot_respects_booking_buffer(current_setting('v123.service')::uuid,current_setting('v123.date')::date,'10:30',30,null),'unreleased_buffer_remains_protected');
delete from public.bookings where booking_code=current_setting('v158.released_code');
select pg_temp.v158_assert(not exists(
  select 1 from public.bookings where booking_code=current_setting('v158.released_code')
),'released_write_fixture_is_removed_before_source_change');
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('v123.actor'),true);
select set_config('v158.replay',public.release_minuta_provider_automatic_break_v158(
  current_setting('v158.request')::uuid,current_setting('v123.date')::date,'12:00','13:00',current_setting('v158.segment')::jsonb->>'segment_fingerprint'
)::text,true);
reset role;
select pg_temp.v158_assert((current_setting('v158.replay')::jsonb->>'replayed')::boolean
  and (select count(*)=1 from public.booking_buffer_release_requests_v158 where request_id=current_setting('v158.request')::uuid),'idempotent_replay');

set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('v123.actor'),true);
do $$ begin
  begin
    perform public.release_minuta_provider_automatic_break_v158(current_setting('v158.request')::uuid,current_setting('v123.date')::date,'10:00','11:00',repeat('0',64));
    raise exception 'expected_request_reuse_failure';
  exception when invalid_parameter_value then
    if sqlerrm<>'booking_buffer_release_request_reused' then raise; end if;
  end;
end $$;
reset role;

-- Changing a source snapshot makes the old exception inert.
update public.bookings set duration_minutes=75 where id=current_setting('v158.booking2')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('v123.actor'),true);
select pg_temp.v158_assert(exists(select 1 from public.get_minuta_provider_automatic_breaks_v158(current_setting('v123.date')::date) where start_time<'13:00' and end_time>'12:00'),'changed_source_reactivates_buffer');
reset role;

select pg_temp.v158_assert(not has_table_privilege('authenticated','public.booking_buffer_release_requests_v158','SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated','public.booking_buffer_release_sources_v158','SELECT,INSERT,UPDATE,DELETE')
  and not has_function_privilege('anon','public.get_minuta_provider_automatic_breaks_v158(date)','EXECUTE')
  and not has_function_privilege('anon','public.release_minuta_provider_automatic_break_v158(uuid,date,time without time zone,time without time zone,text)','EXECUTE'),'closed_storage_and_anon_denied');

rollback;
