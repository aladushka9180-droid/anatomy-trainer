\set ON_ERROR_STOP on

begin;

do $$
declare
  v_function regprocedure:=to_regprocedure(
    'public.create_minuta_historical_booking(uuid,uuid,date,time without time zone,text,text,integer,text,integer)'
  );
  v_security_definer boolean;
  v_config text[];
begin
  if v_function is null then raise exception 'v145_function_missing'; end if;
  if to_regprocedure('public.create_minuta_historical_booking(uuid,uuid,date,time without time zone,text,text,integer)') is null then
    raise exception 'v145_legacy_historical_function_missing';
  end if;
  select procedure.prosecdef,procedure.proconfig into v_security_definer,v_config
  from pg_catalog.pg_proc procedure where procedure.oid=v_function::oid;
  if not v_security_definer or not ('search_path=""'=any(coalesce(v_config,'{}'::text[]))) then
    raise exception 'v145_security_definer_configuration_invalid';
  end if;
  if has_function_privilege('anon',v_function,'execute')
     or has_function_privilege('service_role',v_function,'execute')
     or not has_function_privilege('authenticated',v_function,'execute') then
    raise exception 'v145_execute_acl_invalid';
  end if;

  begin
    perform public.create_minuta_historical_booking(
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
      date '2020-01-01',time '10:00','Test client','+79990000000',60,'cash',1000
    );
    raise exception 'v145_unauthenticated_call_accepted';
  exception when insufficient_privilege then
    if sqlerrm<>'authentication_required' then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000099',true);
  begin
    perform public.create_minuta_historical_booking(
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
      date '2020-01-01',time '10:00','Test client','+79990000000',60,'cash',1000
    );
    raise exception 'v145_non_member_call_accepted';
  exception when insufficient_privilege then
    if sqlerrm<>'organization_access_denied' then raise; end if;
  end;
end $$;

do $$
declare
  v_actor uuid;
  v_organization uuid;
  v_service uuid:='00000000-0000-4000-8000-000000000001';
  v_performer uuid;
  v_timezone text;
  v_date date;
  v_time time without time zone;
  v_result jsonb;
  v_booking uuid;
  v_booking_count_before bigint;
  v_row record;
begin
  update public.services
  set duration_minutes=1,price_rub=32,active=true
  where id=v_service
  returning performer_id into v_performer;
  if v_performer is null then raise exception 'v145_baseline_service_fixture_missing'; end if;

  select actor.user_id,actor.organization_id,location.timezone
  into v_actor,v_organization,v_timezone
  from public.organization_memberships actor
  join public.organizations organization
    on organization.id=actor.organization_id and organization.status='active'
  join public.organization_memberships performer
    on performer.organization_id=actor.organization_id
   and performer.user_id=v_performer
   and performer.active and performer.is_bookable
  join public.locations location
    on location.organization_id=actor.organization_id and location.active
  where actor.active
    and actor.role in ('owner','admin','specialist')
    and (actor.role<>'specialist' or actor.user_id=v_performer)
  order by location.is_primary desc,actor.organization_id
  limit 1;
  if v_actor is null then raise exception 'v145_baseline_membership_fixture_missing'; end if;

  update public.organization_shift_settings set enabled=false,updated_at=now()
  where organization_id=v_organization;
  update public.organization_inventory_settings set enabled=false,updated_at=now()
  where organization_id=v_organization;
  v_date:=timezone(v_timezone,now())::date-31;
  perform set_config('request.jwt.claim.sub',v_actor::text,true);

  select candidate.slot::time into v_time
  from generate_series(0,1428,5) minute_value
  cross join lateral (select time '00:00'+make_interval(mins=>minute_value) slot) candidate
  where not exists(
    select 1 from public.bookings booking
    where booking.performer_id=v_performer
      and booking.booking_date=v_date
      and booking.status<>'cancelled'
      and candidate.slot<booking.booking_time+make_interval(mins=>coalesce(booking.duration_minutes,60))
      and candidate.slot+interval '12 minutes'>booking.booking_time
  )
  order by candidate.slot
  limit 1;
  if v_time is null then raise exception 'v145_historical_slot_fixture_missing'; end if;

  select count(*) into v_booking_count_before from public.bookings
  where performer_id=v_performer and booking_date=v_date;
  begin
    perform public.create_minuta_historical_booking(
      v_organization,v_service,v_date,v_time,'V145 invalid','+79990000000',12,'voucher',384
    );
    raise exception 'v145_invalid_payment_accepted';
  exception when invalid_parameter_value then
    if sqlerrm<>'invalid_historical_payment' then raise; end if;
  end;
  if (select count(*) from public.bookings where performer_id=v_performer and booking_date=v_date)<>v_booking_count_before then
    raise exception 'v145_invalid_payment_created_booking';
  end if;

  v_result:=public.create_minuta_historical_booking(
    v_organization,v_service,v_date,v_time,'V145 paid visit','+79990000000',12,'transfer',350
  );
  v_booking:=(v_result->>'booking_id')::uuid;
  if v_booking is null then raise exception 'v145_booking_id_missing'; end if;

  select booking.duration_minutes,booking.original_price_rub,booking.total_price_rub,
         outcome.visit_status,outcome.payment_method,outcome.amount_rub,
         outcome.actual_duration_minutes,outcome.calculated_amount_rub,outcome.completion_source
  into v_row
  from public.bookings booking
  join public.booking_outcomes outcome on outcome.booking_id=booking.id
  where booking.id=v_booking;
  if v_row.duration_minutes<>12 or v_row.original_price_rub<>32 or v_row.total_price_rub<>384 then
    raise exception 'v145_booking_terms_invalid';
  end if;
  if v_row.visit_status<>'completed' or v_row.payment_method<>'transfer' or v_row.amount_rub<>350
     or v_row.actual_duration_minutes<>12 or v_row.calculated_amount_rub<>384 or v_row.completion_source<>'manual' then
    raise exception 'v145_atomic_outcome_invalid';
  end if;
  if (v_result->>'visit_status')<>'completed' or (v_result->>'payment_method')<>'transfer'
     or (v_result->>'amount_rub')::integer<>350 or (v_result->>'calculated_amount_rub')::integer<>384 then
    raise exception 'v145_response_outcome_invalid';
  end if;
  if exists(select 1 from public.notification_outbox outbox where outbox.booking_id=v_booking) then
    raise exception 'v145_historical_notification_not_suppressed';
  end if;
end $$;

rollback;
