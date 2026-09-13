-- ISOLATED TEST DATABASE ONLY. Creates one synthetic row and rolls it back.
begin;

alter table public.bookings enable row level security;

create function pg_temp.v152_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'v152_assert:%',label; end if; end $$;

select pg_temp.v152_assert(
  to_regprocedure('public.recover_primetime_booking_request_v1(uuid,uuid,uuid,uuid,date,time without time zone,text,text)') is not null,
  'recovery_function_present'
);
select pg_temp.v152_assert(
  has_function_privilege('service_role','public.recover_primetime_booking_request_v1(uuid,uuid,uuid,uuid,date,time without time zone,text,text)','execute'),
  'service_role_execute'
);
select pg_temp.v152_assert(
  not has_function_privilege('anon','public.recover_primetime_booking_request_v1(uuid,uuid,uuid,uuid,date,time without time zone,text,text)','execute')
  and not has_function_privilege('authenticated','public.recover_primetime_booking_request_v1(uuid,uuid,uuid,uuid,date,time without time zone,text,text)','execute'),
  'browser_roles_denied'
);
select pg_temp.v152_assert(
  (select procedure_row.provolatile='v' and procedure_row.prosecdef
      and procedure_row.proconfig=array['search_path=""']::text[]
      and pg_get_userbyid(procedure_row.proowner)='postgres'
      and obj_description(procedure_row.oid,'pg_proc') like 'minuta_booking_recovery_v152:sha256=%'
   from pg_catalog.pg_proc procedure_row
   where procedure_row.oid='public.recover_primetime_booking_request_v1(uuid,uuid,uuid,uuid,date,time without time zone,text,text)'::regprocedure),
  'runtime_contract'
);

select set_config('v152.request',gen_random_uuid()::text,true);
select set_config('v152.organization',gen_random_uuid()::text,true);
select set_config('v152.location',gen_random_uuid()::text,true);
select set_config('v152.performer',gen_random_uuid()::text,true);
select set_config('v152.service',gen_random_uuid()::text,true);
select set_config('v152.changed_performer',gen_random_uuid()::text,true);
select set_config('v152.changed_service',gen_random_uuid()::text,true);
select set_config('v152.token',gen_random_uuid()::text,true);
select set_config('v152.name',repeat('N',80),true);
select set_config('v152.phone','1234567890123456',true);
select set_config('v152.fingerprint',encode(extensions.digest(
  current_setting('v152.service')||chr(31)||date '2030-01-02'::text||chr(31)||
  time '10:00'::text||chr(31)||trim(current_setting('v152.name'))||chr(31)||
  regexp_replace(current_setting('v152.phone'),'[^0-9]','','g'),'sha256'),'hex'),true);

set local session_replication_role=replica;
insert into public.bookings(
  booking_code,manage_token,request_id,request_fingerprint,
  organization_id,location_id,performer_id,service_id,
  client_name,client_phone,booking_date,booking_time,duration_minutes,
  original_price_rub,total_price_rub,status
) values(
  'MIN-V152-TEST',current_setting('v152.token')::uuid,
  current_setting('v152.request')::uuid,current_setting('v152.fingerprint'),
  current_setting('v152.organization')::uuid,current_setting('v152.location')::uuid,
  current_setting('v152.performer')::uuid,current_setting('v152.service')::uuid,
  current_setting('v152.name'),current_setting('v152.phone'),date '2030-01-02',time '10:00',45,
  1600,1600,'new'
);
set local session_replication_role=origin;

select set_config('v152.before',(
  select to_jsonb(booking)::text from public.bookings booking
  where booking.request_id=current_setting('v152.request')::uuid
),true);

set local role service_role;
select set_config('v152.recovered',(
  select to_jsonb(recovery)::text
  from public.recover_primetime_booking_request_v1(
    current_setting('v152.request')::uuid,
    current_setting('v152.organization')::uuid,
    current_setting('v152.location')::uuid,
    current_setting('v152.service')::uuid,
    date '2030-01-02',time '10:00',current_setting('v152.name'),current_setting('v152.phone')
  ) recovery
),true);
reset role;

select pg_temp.v152_assert(
  current_setting('v152.recovered')::jsonb->>'booking_code'='MIN-V152-TEST'
  and current_setting('v152.recovered')::jsonb->>'manage_token'=current_setting('v152.token')
  and (current_setting('v152.recovered')::jsonb->>'original_price_rub')::integer=1600,
  'exact_recovery_and_legacy_input_bounds'
);
select pg_temp.v152_assert(
  current_setting('v152.before')=(select to_jsonb(booking)::text from public.bookings booking
    where booking.request_id=current_setting('v152.request')::uuid),
  'recovery_did_not_mutate_booking'
);

set local session_replication_role=replica;
update public.bookings set
  performer_id=current_setting('v152.changed_performer')::uuid,
  service_id=current_setting('v152.changed_service')::uuid,
  booking_date=date '2030-01-03',booking_time=time '12:30',
  duration_minutes=60,total_price_rub=2200,status='cancelled'
where request_id=current_setting('v152.request')::uuid;
set local session_replication_role=origin;

set local role service_role;
select set_config('v152.recovered_after_change',(
  select to_jsonb(recovery)::text
  from public.recover_primetime_booking_request_v1(
    current_setting('v152.request')::uuid,
    current_setting('v152.organization')::uuid,
    current_setting('v152.location')::uuid,
    current_setting('v152.service')::uuid,
    date '2030-01-02',time '10:00',current_setting('v152.name'),current_setting('v152.phone')
  ) recovery
),true);
reset role;
select pg_temp.v152_assert(
  current_setting('v152.recovered_after_change')::jsonb->>'service_id'=current_setting('v152.changed_service')
  and current_setting('v152.recovered_after_change')::jsonb->>'booking_date'='2030-01-03'
  and current_setting('v152.recovered_after_change')::jsonb->>'status'='cancelled'
  and (current_setting('v152.recovered_after_change')::jsonb->>'total_price_rub')::integer=2200,
  'recovery_survives_provider_and_booking_changes'
);

set local role service_role;
do $$
begin
  begin
    perform public.recover_primetime_booking_request_v1(
      current_setting('v152.request')::uuid,current_setting('v152.organization')::uuid,
      current_setting('v152.location')::uuid,current_setting('v152.service')::uuid,
      date '2030-01-02',time '10:05',current_setting('v152.name'),current_setting('v152.phone')
    );
    raise exception 'v152_changed_fingerprint_accepted';
  exception when raise_exception then
    if sqlerrm<>'request_conflict' then raise; end if;
  end;
  begin
    perform public.recover_primetime_booking_request_v1(
      current_setting('v152.request')::uuid,gen_random_uuid(),
      current_setting('v152.location')::uuid,current_setting('v152.service')::uuid,
      date '2030-01-02',time '10:00',current_setting('v152.name'),current_setting('v152.phone')
    );
    raise exception 'v152_changed_scope_accepted';
  exception when raise_exception then
    if sqlerrm<>'request_conflict' then raise; end if;
  end;
end
$$;
select pg_temp.v152_assert(
  not exists(select 1 from public.recover_primetime_booking_request_v1(
    gen_random_uuid(),current_setting('v152.organization')::uuid,
    current_setting('v152.location')::uuid,current_setting('v152.service')::uuid,
    date '2030-01-02',time '10:00',current_setting('v152.name'),current_setting('v152.phone')
  )),
  'missing_request_is_not_created'
);
reset role;

set local role anon;
do $$
begin
  begin
    perform public.recover_primetime_booking_request_v1(
      current_setting('v152.request')::uuid,current_setting('v152.organization')::uuid,
      current_setting('v152.location')::uuid,current_setting('v152.service')::uuid,
      date '2030-01-02',time '10:00',current_setting('v152.name'),current_setting('v152.phone')
    );
    raise exception 'v152_anon_execute_accepted';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;

rollback;
