-- ISOLATED TEST DATABASE ONLY. Caller owns transaction and rollback.
create function pg_temp.v131_assert(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'v131_assert:%', label; end if; end $$;

select pg_temp.v131_assert(
  to_regprocedure('public.provider_book_appointment(uuid,date,time without time zone,text,text)') is not null,
  'legacy_overload_preserved'
);
select pg_temp.v131_assert(
  to_regprocedure('public.provider_book_appointment(uuid,uuid,date,time without time zone,text,text)') is not null,
  'idempotent_overload_present'
);
select pg_temp.v131_assert(
  has_function_privilege('authenticated','public.provider_book_appointment(uuid,uuid,date,time without time zone,text,text)','execute'),
  'authenticated_execute'
);
select pg_temp.v131_assert(
  not has_function_privilege('anon','public.provider_book_appointment(uuid,uuid,date,time without time zone,text,text)','execute'),
  'anon_denied'
);

select set_config('v131.request', gen_random_uuid()::text, true);
select set_config('v131.foreign_actor', gen_random_uuid()::text, true);
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('v123.actor'), true);
select set_config('v131.first', public.provider_book_appointment(
  current_setting('v131.request')::uuid,
  current_setting('v123.service')::uuid,
  current_setting('v123.date')::date,
  '10:00',
  'V131 client',
  '0000000000'
)::text, true);
select set_config('v131.replay', public.provider_book_appointment(
  current_setting('v131.request')::uuid,
  current_setting('v123.service')::uuid,
  current_setting('v123.date')::date,
  '10:00',
  'V131 client',
  '0000000000'
)::text, true);
select pg_temp.v131_assert(
  current_setting('v131.first')::jsonb->>'booking_id' = current_setting('v131.replay')::jsonb->>'booking_id'
  and current_setting('v131.first')::jsonb->>'request_id' = current_setting('v131.request'),
  'same_request_exact_replay'
);
reset role;

select pg_temp.v131_assert(
  (select count(*) = 1 from public.bookings where request_id = current_setting('v131.request')::uuid),
  'one_booking_row'
);
select pg_temp.v131_assert(
  (select id::text = current_setting('v131.first')::jsonb->>'booking_id'
     and booking_code = current_setting('v131.first')::jsonb->>'booking_code'
   from public.bookings where request_id = current_setting('v131.request')::uuid),
  'acknowledgement_matches_row'
);

select set_config('request.jwt.claim.sub', current_setting('v123.actor'), true);
set local role authenticated;
do $$
begin
  begin
    perform public.provider_book_appointment(
      gen_random_uuid(),
      current_setting('v123.service')::uuid,
      current_setting('v123.date')::date,
      '10:00',
      'V131 duplicate slot',
      '0000000000'
    );
    raise exception 'duplicate_slot_accepted';
  exception when raise_exception then
    if sqlerrm <> 'slot_unavailable' then raise; end if;
  end;
end $$;
select set_config('v131.legacy_code', public.provider_book_appointment(
  current_setting('v123.service')::uuid,
  current_setting('v123.date')::date,
  '12:00',
  'V131 legacy client',
  '0000000000'
), true);
reset role;
select pg_temp.v131_assert(
  (select count(*) = 1 from public.bookings
   where booking_code = current_setting('v131.legacy_code') and request_id is null),
  'legacy_call_still_operates'
);

-- Replay must still work if the service is disabled after the first commit.
update public.services set active = false where id = current_setting('v123.service')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('v123.actor'), true);
select pg_temp.v131_assert(
  public.provider_book_appointment(
    current_setting('v131.request')::uuid,
    current_setting('v123.service')::uuid,
    current_setting('v123.date')::date,
    '10:00',
    'V131 client',
    '0000000000'
  )->>'booking_id' = current_setting('v131.first')::jsonb->>'booking_id',
  'inactive_service_replay'
);
reset role;
update public.services set active = true where id = current_setting('v123.service')::uuid;

select set_config('request.jwt.claim.sub', current_setting('v123.actor'), true);
set local role authenticated;
do $$
begin
  begin
    perform public.provider_book_appointment(
      current_setting('v131.request')::uuid,
      current_setting('v123.service')::uuid,
      current_setting('v123.date')::date,
      '10:15',
      'V131 changed',
      '0000000000'
    );
    raise exception 'request_conflict_accepted';
  exception when raise_exception then
    if sqlerrm <> 'request_conflict' then raise; end if;
  end;
end $$;
reset role;

select set_config('request.jwt.claim.sub', current_setting('v131.foreign_actor'), true);
set local role authenticated;
do $$
begin
  begin
    perform public.provider_book_appointment(
      gen_random_uuid(),
      current_setting('v123.service')::uuid,
      current_setting('v123.date')::date,
      '11:00',
      'V131 foreign',
      '0000000000'
    );
    raise exception 'foreign_service_accepted';
  exception when insufficient_privilege then
    if sqlerrm <> 'provider_service_access_denied' then raise; end if;
  end;
end $$;
reset role;

select set_config('request.jwt.claim.sub', current_setting('v123.actor'), true);
