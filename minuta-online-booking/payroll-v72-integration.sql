begin;

do $$ begin
  if to_regprocedure('public.get_minuta_payroll_workspace(uuid,date,date)') is null then
    raise exception using errcode='P0001',message='v72_test_requires_v72';
  end if;
end $$;

select set_config('minuta.v72_owner',(select legacy_performer_id::text from public.organizations
  where legacy_performer_id is not null and status='active' and public_booking_enabled order by id limit 1),true);
select set_config('minuta.v72_org',(select id::text from public.organizations
  where legacy_performer_id=current_setting('minuta.v72_owner')::uuid),true);
select set_config('minuta.v72_location',(select id::text from public.locations
  where organization_id=current_setting('minuta.v72_org')::uuid and active order by is_primary desc,id limit 1),true);
select set_config('minuta.v72_service',(select id::text from public.services
  where performer_id=current_setting('minuta.v72_owner')::uuid and active order by id limit 1),true);
select set_config('minuta.v72_slug',(select public_slug from public.organizations
  where id=current_setting('minuta.v72_org')::uuid),true);

do $$ begin
  if nullif(current_setting('minuta.v72_owner',true),'') is null
     or nullif(current_setting('minuta.v72_service',true),'') is null then
    raise exception using errcode='P0001',message='v72_test_requires_public_owner_service';
  end if;
end $$;

select set_config('request.jwt.claim.sub',current_setting('minuta.v72_owner'),true);
set local role authenticated;
select public.set_minuta_payroll_enabled(current_setting('minuta.v72_org')::uuid,true);
select public.upsert_minuta_payroll_plan(
  current_setting('minuta.v72_org')::uuid,null,current_setting('minuta.v72_owner')::uuid,
  'V72 integration plan',current_date,null,4000,'[]'::jsonb
);
reset role;

select set_config('minuta.v72_slot',coalesce((select to_jsonb(slot)::text
  from public.get_public_minuta_available_slots_v4(
    current_setting('minuta.v72_slug'),current_setting('minuta.v72_location')::uuid,
    current_setting('minuta.v72_service')::uuid,current_date+1,current_date+62
  ) slot order by slot.booking_date,slot.booking_time limit 1),'{}'),true);
do $$ begin
  if current_setting('minuta.v72_slot')::jsonb='{}'::jsonb then
    raise exception using errcode='P0001',message='v72_test_requires_available_slot';
  end if;
end $$;

set local role anon;
select * from public.book_minuta_appointment(
  '00000000-0000-4000-8000-000000007201',current_setting('minuta.v72_slug'),
  current_setting('minuta.v72_location')::uuid,current_setting('minuta.v72_service')::uuid,
  (current_setting('minuta.v72_slot')::jsonb->>'booking_date')::date,
  (current_setting('minuta.v72_slot')::jsonb->>'booking_time')::time,
  'V72 Payroll Client','+79990007201'
);
reset role;

select set_config('minuta.v72_booking',(select id::text from public.bookings
  where request_id='00000000-0000-4000-8000-000000007201'::uuid),true);
insert into public.booking_outcomes(booking_id,performer_id,visit_status,payment_method,amount_rub)
values(current_setting('minuta.v72_booking')::uuid,current_setting('minuta.v72_owner')::uuid,
  'completed','cash',10000)
on conflict(booking_id) do update set visit_status='completed',payment_method='cash',amount_rub=10000,
  performer_id=excluded.performer_id;

select set_config('request.jwt.claim.sub',current_setting('minuta.v72_owner'),true);
set local role authenticated;
select public.calculate_minuta_payroll_period(
  current_setting('minuta.v72_org')::uuid,null,current_setting('minuta.v72_location')::uuid,
  (current_setting('minuta.v72_slot')::jsonb->>'booking_date')::date,
  (current_setting('minuta.v72_slot')::jsonb->>'booking_date')::date,'V72 integration period'
);
-- An exact retry must update the same draft, not duplicate it.
select public.calculate_minuta_payroll_period(
  current_setting('minuta.v72_org')::uuid,null,current_setting('minuta.v72_location')::uuid,
  (current_setting('minuta.v72_slot')::jsonb->>'booking_date')::date,
  (current_setting('minuta.v72_slot')::jsonb->>'booking_date')::date,'V72 integration period'
);
reset role;

select set_config('minuta.v72_period',(select id::text from public.payroll_periods
  where organization_id=current_setting('minuta.v72_org')::uuid),true);
do $$ begin
  if (select count(*) from public.payroll_periods where organization_id=current_setting('minuta.v72_org')::uuid)<>1
     or (select count(*) from public.payroll_items where period_id=current_setting('minuta.v72_period')::uuid)<>1
     or (select payroll_rub from public.payroll_items where period_id=current_setting('minuta.v72_period')::uuid)<>4000 then
    raise exception using errcode='P0001',message='v72_calculation_or_idempotency_failed';
  end if;
end $$;

set local role authenticated;
do $$ begin
  begin
    perform public.calculate_minuta_payroll_period(
      current_setting('minuta.v72_org')::uuid,null,current_setting('minuta.v72_location')::uuid,
      (current_setting('minuta.v72_slot')::jsonb->>'booking_date')::date-1,
      (current_setting('minuta.v72_slot')::jsonb->>'booking_date')::date,'V72 overlapping period');
    raise exception using errcode='P0001',message='v72_overlap_was_allowed';
  exception when exclusion_violation then
    if sqlerrm<>'payroll_period_overlap' then raise; end if;
  end;
end $$;
reset role;

update public.booking_outcomes set amount_rub=11000 where booking_id=current_setting('minuta.v72_booking')::uuid;
set local role authenticated;
do $$ begin
  begin
    perform public.set_minuta_payroll_period_status(
      current_setting('minuta.v72_org')::uuid,current_setting('minuta.v72_period')::uuid,'approved');
    raise exception using errcode='P0001',message='v72_stale_source_was_approved';
  exception when object_not_in_prerequisite_state then
    if sqlerrm<>'payroll_source_changed_recalculate_required' then raise; end if;
  end;
end $$;
reset role;

update public.booking_outcomes set amount_rub=10000 where booking_id=current_setting('minuta.v72_booking')::uuid;
set local role authenticated;
select public.set_minuta_payroll_period_status(
  current_setting('minuta.v72_org')::uuid,current_setting('minuta.v72_period')::uuid,'approved');
do $$ begin
  begin
    perform public.add_minuta_payroll_adjustment(
      current_setting('minuta.v72_org')::uuid,current_setting('minuta.v72_period')::uuid,
      current_setting('minuta.v72_owner')::uuid,500,'Must be rejected');
    raise exception using errcode='P0001',message='v72_approved_period_was_mutated';
  exception when object_not_in_prerequisite_state then null;
  end;
end $$;
reset role;

rollback;
