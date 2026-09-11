\set ON_ERROR_STOP on
begin;
\ir booking-concurrency-v123-fixture.sql

create function pg_temp.v143_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'v143_assert:%',label; end if; end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('v123.actor'),true);
select set_config('v143.created_code',public.provider_book_appointment(
  current_setting('v123.service')::uuid,
  current_setting('v123.date')::date,
  '10:00'::time,'V143 client'::text,'0000000000'::text
),true);
reset role;
select set_config('v143.booking',(select id::text from public.bookings
  where booking_code=current_setting('v143.created_code')),true);
update public.bookings set client_phone='79990000143'
where id=current_setting('v143.booking')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('v123.actor'),true);
select set_config('v143.ack',public.reschedule_minuta_provider_booking_v143(
  current_setting('v143.booking')::uuid,
  current_setting('v123.date')::date,'11:00',
  current_setting('v123.date')::date,'10:00'
)::text,true);
reset role;

select pg_temp.v143_assert(
  current_setting('v143.ack')::jsonb->>'booking_id'=current_setting('v143.booking')
  and current_setting('v143.ack')::jsonb->>'performer_id'=current_setting('v123.actor')
  and current_setting('v143.ack')::jsonb->>'service_id'=current_setting('v123.service')
  and current_setting('v143.ack')::jsonb->>'booking_date'=current_setting('v123.date')
  and left(current_setting('v143.ack')::jsonb->>'booking_time',5)='11:00'
  and (current_setting('v143.ack')::jsonb->>'duration_minutes')::integer=60
  and (current_setting('v143.ack')::jsonb->>'notifications_suppressed')::boolean is false,
  'exact_acknowledgement'
);
select pg_temp.v143_assert(
  (select booking_time='11:00' from public.bookings where id=current_setting('v143.booking')::uuid),
  'booking_moved'
);

set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('v123.actor'),true);
do $$ begin
  begin
    perform public.reschedule_minuta_provider_booking_v143(
      current_setting('v143.booking')::uuid,current_setting('v123.date')::date,'11:30',
      current_setting('v123.date')::date,'10:00'
    );
    raise exception 'stale_anchor_accepted';
  exception when serialization_failure then
    if sqlerrm<>'provider_booking_changed' then raise; end if;
  end;
end $$;
select set_config('v143.conflict_code',public.provider_book_appointment(
  current_setting('v123.service')::uuid,
  current_setting('v123.date')::date,
  '13:00'::time,'V143 conflict'::text,'0000000000'::text
),true);
do $$ begin
  begin
    perform public.reschedule_minuta_provider_booking_v143(
      current_setting('v143.booking')::uuid,current_setting('v123.date')::date,'12:30',
      current_setting('v123.date')::date,'11:00'
    );
    raise exception 'overlap_target_accepted';
  exception when exclusion_violation then
    if sqlerrm<>'provider_booking_slot_unavailable' then raise; end if;
  end;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
do $$ begin
  begin
    perform public.reschedule_minuta_provider_booking_v143(
      current_setting('v143.booking')::uuid,current_setting('v123.date')::date,'14:00',
      current_setting('v123.date')::date,'11:00'
    );
    raise exception 'foreign_actor_accepted';
  exception when insufficient_privilege then
    if sqlerrm<>'provider_booking_access_denied' then raise; end if;
  end;
end $$;
reset role;

select pg_temp.v143_assert(
  has_function_privilege('authenticated','public.reschedule_minuta_provider_booking_v143(uuid,date,time without time zone,date,time without time zone)','EXECUTE')
  and not has_function_privilege('anon','public.reschedule_minuta_provider_booking_v143(uuid,date,time without time zone,date,time without time zone)','EXECUTE'),
  'v143_acl'
);

rollback;
