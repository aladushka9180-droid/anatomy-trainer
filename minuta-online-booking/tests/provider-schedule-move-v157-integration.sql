\set ON_ERROR_STOP on
begin;
\ir booking-concurrency-v123-fixture.sql

create function pg_temp.v157_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'v157_assert:%',label; end if; end $$;

select set_config('request.jwt.claim.sub',current_setting('v123.actor'),true);
select set_config('v157.created_code',public.provider_book_appointment(
  current_setting('v123.service')::uuid,
  current_setting('v123.date')::date,
  '10:00'::time,'V157 client'::text,'0000000000'::text
),true);
select set_config('v157.booking',(select id::text from public.bookings
  where booking_code=current_setting('v157.created_code')),true);
update public.bookings set client_phone='79990000157'
where id=current_setting('v157.booking')::uuid;
select set_config('v157.status',(select status from public.bookings where id=current_setting('v157.booking')::uuid),true);
select set_config('v157.move_request',gen_random_uuid()::text,true);
select set_config('v157.undo_request',gen_random_uuid()::text,true);

set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('v123.actor'),true);
select set_config('v157.move_ack',public.move_minuta_provider_schedule_booking_v157(
  current_setting('v157.move_request')::uuid,
  current_setting('v157.booking')::uuid,
  current_setting('v123.date')::date,'11:00',
  current_setting('v123.org')::uuid,current_setting('v123.loc')::uuid,
  current_setting('v123.service')::uuid,current_setting('v123.date')::date,'10:00',60,current_setting('v157.status')
)::text,true);
reset role;

select pg_temp.v157_assert(
  current_setting('v157.move_ack')::jsonb->>'action'='moved'
  and current_setting('v157.move_ack')::jsonb->>'request_id'=current_setting('v157.move_request')
  and current_setting('v157.move_ack')::jsonb->>'booking_id'=current_setting('v157.booking')
  and current_setting('v157.move_ack')::jsonb->>'performer_id'=current_setting('v123.actor')
  and left(current_setting('v157.move_ack')::jsonb->>'booking_time',5)='11:00'
  and (current_setting('v157.move_ack')::jsonb->>'notifications_suppressed')::boolean is false,
  'strict_move_acknowledgement'
);
select pg_temp.v157_assert(
  (select booking_time='11:00' from public.bookings where id=current_setting('v157.booking')::uuid)
  and (select count(*)=1 from public.provider_schedule_moves_v157
    where request_id=current_setting('v157.move_request')::uuid and operation='move' and status='applied')
  and (select count(*)=1 from public.booking_events
    where booking_id=current_setting('v157.booking')::uuid and event_type='booking_rescheduled'),
  'move_and_history_saved'
);

-- A lost-response retry must return the same receipt and must not move twice.
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('v123.actor'),true);
select set_config('v157.replay_ack',public.move_minuta_provider_schedule_booking_v157(
  current_setting('v157.move_request')::uuid,
  current_setting('v157.booking')::uuid,
  current_setting('v123.date')::date,'11:00',
  current_setting('v123.org')::uuid,current_setting('v123.loc')::uuid,
  current_setting('v123.service')::uuid,current_setting('v123.date')::date,'10:00',60,current_setting('v157.status')
)::text,true);
reset role;
select pg_temp.v157_assert(
  current_setting('v157.replay_ack')::jsonb->>'move_id'=current_setting('v157.move_ack')::jsonb->>'move_id'
  and (current_setting('v157.replay_ack')::jsonb->>'replayed')::boolean
  and (select count(*)=1 from public.booking_events
    where booking_id=current_setting('v157.booking')::uuid and event_type='booking_rescheduled'),
  'idempotent_move_replay'
);

-- Reusing the same request for another target must fail closed.
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('v123.actor'),true);
do $$ begin
  begin
    perform public.move_minuta_provider_schedule_booking_v157(
      current_setting('v157.move_request')::uuid,current_setting('v157.booking')::uuid,
      current_setting('v123.date')::date,'12:00',current_setting('v123.org')::uuid,
      current_setting('v123.loc')::uuid,current_setting('v123.service')::uuid,
      current_setting('v123.date')::date,'11:00',60,current_setting('v157.status')
    );
    raise exception 'reused_request_accepted';
  exception when invalid_parameter_value then
    if sqlerrm<>'provider_schedule_request_reused' then raise; end if;
  end;
end $$;
reset role;

-- Any expected snapshot drift must block the move before mutation.
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('v123.actor'),true);
do $$ begin
  begin
    perform public.move_minuta_provider_schedule_booking_v157(
      gen_random_uuid(),current_setting('v157.booking')::uuid,
      current_setting('v123.date')::date,'12:00',current_setting('v123.org')::uuid,
      current_setting('v123.loc')::uuid,current_setting('v123.service')::uuid,
      current_setting('v123.date')::date,'11:00',55,current_setting('v157.status')
    );
    raise exception 'stale_snapshot_accepted';
  exception when serialization_failure then
    if sqlerrm<>'provider_schedule_booking_changed' then raise; end if;
  end;
end $$;
reset role;

-- Undo is another fully checked move and creates a linked durable receipt.
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('v123.actor'),true);
select set_config('v157.undo_ack',public.undo_minuta_provider_schedule_booking_v157(
  current_setting('v157.undo_request')::uuid,
  (current_setting('v157.move_ack')::jsonb->>'move_id')::uuid
)::text,true);
reset role;
select pg_temp.v157_assert(
  current_setting('v157.undo_ack')::jsonb->>'action'='undone'
  and current_setting('v157.undo_ack')::jsonb->>'request_id'=current_setting('v157.undo_request')
  and left(current_setting('v157.undo_ack')::jsonb->>'booking_time',5)='10:00'
  and (select booking_time='10:00' from public.bookings where id=current_setting('v157.booking')::uuid)
  and (select count(*)=1 from public.provider_schedule_moves_v157 undo_row
    where undo_row.request_id=current_setting('v157.undo_request')::uuid
      and undo_row.operation='undo'
      and undo_row.reverse_of=(current_setting('v157.move_ack')::jsonb->>'move_id')::uuid)
  and (select status='undone' and reversed_by is not null from public.provider_schedule_moves_v157
    where id=(current_setting('v157.move_ack')::jsonb->>'move_id')::uuid)
  and (select count(*)=2 from public.booking_events
    where booking_id=current_setting('v157.booking')::uuid and event_type='booking_rescheduled'),
  'linked_undo_and_history_saved'
);

set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('v123.actor'),true);
select pg_temp.v157_assert(
  (public.get_minuta_provider_schedule_move_v157(current_setting('v157.move_request')::uuid)->>'move_id')
    =current_setting('v157.move_ack')::jsonb->>'move_id',
  'receipt_lookup'
);
select pg_temp.v157_assert(
  (public.undo_minuta_provider_schedule_booking_v157(
    current_setting('v157.undo_request')::uuid,
    (current_setting('v157.move_ack')::jsonb->>'move_id')::uuid
  )->>'move_id')=current_setting('v157.undo_ack')::jsonb->>'move_id',
  'idempotent_undo_replay'
);
reset role;

select pg_temp.v157_assert(
  (select count(*)=2 from public.booking_events
    where booking_id=current_setting('v157.booking')::uuid and event_type='booking_rescheduled'),
  'undo_replay_did_not_repeat_history'
);

set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('v123.actor'),true);
do $$ begin
  begin
    perform public.move_minuta_provider_schedule_booking_v157(
      gen_random_uuid(),current_setting('v157.booking')::uuid,current_date,'12:00',
      current_setting('v123.org')::uuid,current_setting('v123.loc')::uuid,
      current_setting('v123.service')::uuid,current_setting('v123.date')::date,'10:00',
      60,current_setting('v157.status')
    );
    raise exception 'past_target_accepted';
  exception when invalid_parameter_value then
    if sqlerrm<>'provider_schedule_target_in_past' then raise; end if;
  end;
end $$;
do $$ begin
  begin
    perform public.move_minuta_provider_schedule_booking_v157(
      gen_random_uuid(),current_setting('v157.booking')::uuid,
      current_setting('v123.date')::date,'10:00',current_setting('v123.org')::uuid,
      current_setting('v123.loc')::uuid,current_setting('v123.service')::uuid,
      current_setting('v123.date')::date,'10:00',60,current_setting('v157.status')
    );
    raise exception 'no_op_move_accepted';
  exception when invalid_parameter_value then
    if sqlerrm<>'invalid_provider_schedule_target' then raise; end if;
  end;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
do $$ begin
  begin
    perform public.undo_minuta_provider_schedule_booking_v157(
      gen_random_uuid(),(current_setting('v157.move_ack')::jsonb->>'move_id')::uuid
    );
    raise exception 'foreign_actor_accepted';
  exception when insufficient_privilege then
    if sqlerrm<>'provider_schedule_access_denied' then raise; end if;
  end;
end $$;
do $$ begin
  begin
    perform 1 from public.provider_schedule_moves_v157 limit 1;
    raise exception 'direct_ledger_read_accepted';
  exception when insufficient_privilege then null;
  end;
end $$;
do $$ begin
  begin
    insert into public.provider_schedule_moves_v157(
      request_id,request_fingerprint,operation,from_snapshot,to_snapshot,status,result
    ) values(gen_random_uuid(),repeat('0',64),'move','{}','{}','applied','{}');
    raise exception 'direct_ledger_insert_accepted';
  exception when insufficient_privilege then null;
  end;
end $$;
do $$ begin
  begin
    update public.provider_schedule_moves_v157 set result='{}' where false;
    raise exception 'direct_ledger_update_accepted';
  exception when insufficient_privilege then null;
  end;
end $$;
do $$ begin
  begin
    delete from public.provider_schedule_moves_v157 where false;
    raise exception 'direct_ledger_delete_accepted';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

select pg_temp.v157_assert(
  has_function_privilege('authenticated','public.move_minuta_provider_schedule_booking_v157(uuid,uuid,date,time without time zone,uuid,uuid,uuid,date,time without time zone,integer,text)','EXECUTE')
  and has_function_privilege('authenticated','public.get_minuta_provider_schedule_move_v157(uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.undo_minuta_provider_schedule_booking_v157(uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.move_minuta_provider_schedule_booking_v157(uuid,uuid,date,time without time zone,uuid,uuid,uuid,date,time without time zone,integer,text)','EXECUTE')
  and not has_table_privilege('authenticated','public.provider_schedule_moves_v157','SELECT,INSERT,UPDATE,DELETE')
  and (select count(*)=3 from pg_catalog.pg_constraint
    where conrelid='public.provider_schedule_moves_v157'::regclass and contype='f' and confdeltype='n'),
  'v157_acl'
);

rollback;
