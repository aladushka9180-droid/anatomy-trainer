-- ISOLATED TEST DATABASE ONLY. Creates one synthetic booking and always rolls it back.
begin;

create function pg_temp.v154_assert(ok boolean,label text)
returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'v154_assert:%',label; end if;
end
$$;

select pg_temp.v154_assert(
  to_regprocedure('public.lookup_primetime_booking_request_v154(uuid)') is not null,
  'lookup_function_present'
);
select pg_temp.v154_assert(
  has_function_privilege('anon','public.lookup_primetime_booking_request_v154(uuid)','execute')
  and not has_function_privilege('authenticated','public.lookup_primetime_booking_request_v154(uuid)','execute')
  and not has_function_privilege('service_role','public.lookup_primetime_booking_request_v154(uuid)','execute'),
  'anon_only_execute_acl'
);
select pg_temp.v154_assert(
  not exists(
    select 1
    from pg_catalog.pg_proc procedure_row,
      lateral aclexplode(coalesce(
        procedure_row.proacl,acldefault('f',procedure_row.proowner)
      )) grant_row
    where procedure_row.oid='public.lookup_primetime_booking_request_v154(uuid)'::regprocedure
      and grant_row.grantee=0
      and grant_row.privilege_type='EXECUTE'
  ),
  'public_pseudorole_denied'
);
select pg_temp.v154_assert(
  not has_table_privilege('anon','public.primetime_server_credentials','select')
  and not has_table_privilege('authenticated','public.primetime_server_credentials','select')
  and not has_table_privilege('service_role','public.primetime_server_credentials','select'),
  'credential_table_not_exposed'
);

select set_config('v154.request',gen_random_uuid()::text,true);
select set_config('v154.missing_request',gen_random_uuid()::text,true);
select set_config('v154.organization',gen_random_uuid()::text,true);
select set_config('v154.location',gen_random_uuid()::text,true);
select set_config('v154.performer',gen_random_uuid()::text,true);
select set_config('v154.service',gen_random_uuid()::text,true);
select set_config('v154.token',gen_random_uuid()::text,true);
select set_config('v154.secret',repeat('a',64),true);
select set_config('v154.wrong_secret',repeat('b',64),true);

insert into public.primetime_server_credentials(credential_key,secret_sha256,active)
values(
  'booking_lookup_v154',
  encode(extensions.digest(convert_to(current_setting('v154.secret'),'UTF8'),'sha256'),'hex'),
  true
)
on conflict(credential_key) do update set
  secret_sha256=excluded.secret_sha256,
  active=true;

set local session_replication_role=replica;
insert into public.bookings(
  booking_code,manage_token,request_id,request_fingerprint,
  organization_id,location_id,performer_id,service_id,
  client_name,client_phone,booking_date,booking_time,duration_minutes,
  original_price_rub,total_price_rub,status
) values(
  'MIN-V154-TEST',current_setting('v154.token')::uuid,
  current_setting('v154.request')::uuid,repeat('c',64),
  current_setting('v154.organization')::uuid,current_setting('v154.location')::uuid,
  current_setting('v154.performer')::uuid,current_setting('v154.service')::uuid,
  'V154 Synthetic Client','+79990001540',date '2030-01-04',time '11:30',55,
  1540,1540,'confirmed'
);
set local session_replication_role=origin;

select set_config('v154.before_booking',(
  select to_jsonb(booking)::text from public.bookings booking
  where booking.request_id=current_setting('v154.request')::uuid
),true);
select set_config('v154.before_counts',jsonb_build_object(
  'bookings',(select count(*) from public.bookings),
  'booking_events',(select count(*) from public.booking_events),
  'notification_outbox',(select count(*) from public.notification_outbox),
  'payments',(select count(*) from public.payments)
)::text,true);

set local role anon;
select set_config('request.headers','{}',true);
select pg_temp.v154_assert(
  not exists(select 1 from public.lookup_primetime_booking_request_v154(
    current_setting('v154.request')::uuid
  )),
  'missing_header_is_neutral'
);
select set_config('request.headers','not-json',true);
select pg_temp.v154_assert(
  not exists(select 1 from public.lookup_primetime_booking_request_v154(
    current_setting('v154.request')::uuid
  )),
  'malformed_headers_are_neutral'
);
select set_config('request.headers',jsonb_build_object(
  'x-primetime-booking-lookup-key','short'
)::text,true);
select pg_temp.v154_assert(
  not exists(select 1 from public.lookup_primetime_booking_request_v154(
    current_setting('v154.request')::uuid
  )),
  'malformed_secret_is_neutral'
);
select set_config('request.headers',jsonb_build_object(
  'x-primetime-booking-lookup-key',current_setting('v154.wrong_secret')
)::text,true);
select pg_temp.v154_assert(
  not exists(select 1 from public.lookup_primetime_booking_request_v154(
    current_setting('v154.request')::uuid
  )),
  'mismatched_secret_is_neutral'
);
select set_config('request.headers',jsonb_build_object(
  'x-primetime-booking-lookup-key',current_setting('v154.secret')
)::text,true);
select set_config('v154.lookup',(
  select to_jsonb(found_booking)::text
  from public.lookup_primetime_booking_request_v154(
    current_setting('v154.request')::uuid
  ) found_booking
),true);
select pg_temp.v154_assert(
  not exists(select 1 from public.lookup_primetime_booking_request_v154(
    current_setting('v154.missing_request')::uuid
  )),
  'unknown_request_is_neutral'
);
reset role;

select pg_temp.v154_assert(
  current_setting('v154.lookup')::jsonb=jsonb_build_object(
    'booking_code','MIN-V154-TEST',
    'manage_token',current_setting('v154.token'),
    'service_id',current_setting('v154.service'),
    'booking_date','2030-01-04',
    'booking_time','11:30:00',
    'duration_minutes',55,
    'original_price_rub',1540,
    'total_price_rub',1540,
    'status','confirmed'
  ),
  'exact_committed_snapshot_including_manage_token'
);
select pg_temp.v154_assert(
  current_setting('v154.before_booking')=(
    select to_jsonb(booking)::text from public.bookings booking
    where booking.request_id=current_setting('v154.request')::uuid
  ),
  'lookup_did_not_mutate_booking'
);
select pg_temp.v154_assert(
  current_setting('v154.before_counts')=jsonb_build_object(
    'bookings',(select count(*) from public.bookings),
    'booking_events',(select count(*) from public.booking_events),
    'notification_outbox',(select count(*) from public.notification_outbox),
    'payments',(select count(*) from public.payments)
  )::text,
  'lookup_did_not_change_business_counts'
);

update public.primetime_server_credentials
set active=false
where credential_key='booking_lookup_v154';
set local role anon;
select pg_temp.v154_assert(
  not exists(select 1 from public.lookup_primetime_booking_request_v154(
    current_setting('v154.request')::uuid
  )),
  'inactive_credential_is_neutral'
);
reset role;

rollback;
