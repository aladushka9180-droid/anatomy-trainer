\set ON_ERROR_STOP on

begin;

do $$
declare
  v_function regprocedure:=to_regprocedure(
    'public.create_minuta_historical_booking(uuid,uuid,date,time without time zone,text,text,integer)'
  );
  v_security_definer boolean;
  v_config text[];
begin
  if v_function is null then raise exception 'v98_function_missing'; end if;
  if to_regprocedure(
    'public.create_minuta_historical_booking(uuid,uuid,date,time without time zone,text,text)'
  ) is not null then
    raise exception 'v98_legacy_signature_still_present';
  end if;
  select procedure.prosecdef,procedure.proconfig
  into v_security_definer,v_config
  from pg_catalog.pg_proc procedure
  where procedure.oid=v_function::oid;
  if not v_security_definer or not ('search_path=""'=any(coalesce(v_config,'{}'::text[]))) then
    raise exception 'v98_security_definer_configuration_invalid';
  end if;
  if has_function_privilege('anon',v_function,'execute')
     or has_function_privilege('service_role',v_function,'execute')
     or not has_function_privilege('authenticated',v_function,'execute') then
    raise exception 'v98_execute_acl_invalid';
  end if;

  begin
    perform public.create_minuta_historical_booking(
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
      date '2020-01-01',time '10:00','Test client','+79990000000',null
    );
    raise exception 'v98_unauthenticated_call_accepted';
  exception when insufficient_privilege then
    if sqlerrm<>'authentication_required' then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000099',true);
  begin
    perform public.create_minuta_historical_booking(
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
      date '2020-01-01',time '10:00','Test client','+79990000000',null
    );
    raise exception 'v98_non_member_call_accepted';
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
  v_row record;
begin
  -- The bootstrap fixture is a regular 60-minute service. Convert that exact
  -- row into a 32 RUB/minute service only inside this transaction; the final
  -- ROLLBACK restores the baseline row.
  update public.services
  set duration_minutes=1,price_rub=32,active=true
  where id=v_service
  returning performer_id into v_performer;
  if v_performer is null then raise exception 'v98_baseline_service_fixture_missing'; end if;

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
  if v_actor is null then raise exception 'v98_baseline_membership_fixture_missing'; end if;

  -- Shift enforcement is an AFTER trigger on bookings. Disable strict shifts
  -- for this organization inside the same rollback-only transaction so the
  -- test is independent of today's bootstrap schedule.
  update public.organization_shift_settings
  set enabled=false,updated_at=now()
  where organization_id=v_organization;

  v_date:=timezone(v_timezone,now())::date-30;
  perform set_config('request.jwt.claim.sub',v_actor::text,true);

  begin
    perform public.create_minuta_historical_booking(
      v_organization,v_service,v_date,time '00:00',
      repeat('N',81),'+79990000000',12
    );
    raise exception 'v98_long_name_accepted';
  exception when invalid_parameter_value then
    if sqlerrm<>'invalid_client_data' then raise; end if;
  end;

  begin
    perform public.create_minuta_historical_booking(
      v_organization,v_service,v_date,time '00:00',
      'Test client','+79990000000',null
    );
    raise exception 'v98_missing_per_minute_duration_accepted';
  exception when invalid_parameter_value then
    if sqlerrm<>'historical_duration_required' then raise; end if;
  end;

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
  if v_time is null then raise exception 'v98_historical_slot_fixture_missing'; end if;

  v_result:=public.create_minuta_historical_booking(
    v_organization,v_service,v_date,v_time,
    'V98 integration','+79990000000',12
  );
  v_booking:=(v_result->>'booking_id')::uuid;
  if v_booking is null then raise exception 'v98_booking_id_missing'; end if;

  select booking.duration_minutes,booking.original_price_rub,booking.total_price_rub,
         booking.deposit_amount_rub,booking.payment_status,booking.payment_url,
         booking.payment_due_at,booking.expired_unpaid_at,booking.refund_status
  into v_row
  from public.bookings booking where booking.id=v_booking;
  if v_row.duration_minutes<>12
     or v_row.original_price_rub<>32
     or v_row.total_price_rub<>384 then
    raise exception 'v98_atomic_terms_invalid';
  end if;
  if v_row.deposit_amount_rub<>0
     or v_row.payment_status<>'not_required'
     or coalesce(v_row.payment_url,'')<>''
     or v_row.payment_due_at is not null
     or v_row.expired_unpaid_at is not null
     or v_row.refund_status<>'not_required' then
    raise exception 'v98_historical_payment_not_suppressed';
  end if;
  if exists(select 1 from public.notification_outbox outbox where outbox.booking_id=v_booking) then
    raise exception 'v98_historical_notification_not_suppressed';
  end if;
  if (v_result->>'duration_minutes')::integer<>12
     or (v_result->>'unit_price_rub')::integer<>32
     or (v_result->>'total_price_rub')::integer<>384 then
    raise exception 'v98_response_terms_invalid';
  end if;
end $$;

rollback;
