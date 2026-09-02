begin;

do $$ begin
  if to_regprocedure('public.get_minuta_benefit_workspace(uuid)') is null then
    raise exception using errcode='P0001',message='v73_test_requires_v73';
  end if;
end $$;

select set_config('minuta.v73_owner',(select legacy_performer_id::text from public.organizations
  where legacy_performer_id is not null and status='active' and public_booking_enabled order by id limit 1),true);
select set_config('minuta.v73_org',(select id::text from public.organizations
  where legacy_performer_id=current_setting('minuta.v73_owner')::uuid),true);
select set_config('minuta.v73_location',(select id::text from public.locations
  where organization_id=current_setting('minuta.v73_org')::uuid and active order by is_primary desc,id limit 1),true);
select set_config('minuta.v73_service',(select service.id::text from public.services service
  join public.organization_memberships membership on membership.organization_id=current_setting('minuta.v73_org')::uuid
    and membership.user_id=service.performer_id and membership.active and membership.is_bookable
  where service.active order by service.id limit 1),true);
select set_config('minuta.v73_slug',(select public_slug from public.organizations
  where id=current_setting('minuta.v73_org')::uuid),true);

do $$ begin
  if nullif(current_setting('minuta.v73_owner',true),'') is null
     or nullif(current_setting('minuta.v73_service',true),'') is null then
    raise exception using errcode='P0001',message='v73_test_requires_public_owner_service';
  end if;
  if coalesce((select enabled from public.organization_benefit_settings where organization_id=current_setting('minuta.v73_org')::uuid),false) then
    raise exception using errcode='P0001',message='v73_must_be_disabled_by_default';
  end if;
end $$;

select set_config('minuta.v73_slot',coalesce((select to_jsonb(slot)::text
  from public.get_public_minuta_available_slots_v4(
    current_setting('minuta.v73_slug'),current_setting('minuta.v73_location')::uuid,
    current_setting('minuta.v73_service')::uuid,current_date+1,current_date+62
  ) slot order by slot.booking_date,slot.booking_time limit 1),'{}'),true);
do $$ begin
  if current_setting('minuta.v73_slot')::jsonb='{}'::jsonb then
    raise exception using errcode='P0001',message='v73_test_requires_available_slot';
  end if;
end $$;

set local role anon;
select set_config('minuta.v73_manage',(select manage_token::text from public.book_minuta_appointment(
    '00000000-0000-4000-8000-000000007301',current_setting('minuta.v73_slug'),
    current_setting('minuta.v73_location')::uuid,current_setting('minuta.v73_service')::uuid,
    (current_setting('minuta.v73_slot')::jsonb->>'booking_date')::date,
    (current_setting('minuta.v73_slot')::jsonb->>'booking_time')::time,
    'V73 Benefit Client','+79990007301'
  )),true);
select * from public.bootstrap_client_access(
  current_setting('minuta.v73_manage')::uuid,
  'V73 integration test'
);
reset role;

select set_config('minuta.v73_booking',(select id::text from public.bookings
  where request_id='00000000-0000-4000-8000-000000007301'::uuid),true);
select set_config('minuta.v73_client',(select client_account_id::text from public.bookings
  where id=current_setting('minuta.v73_booking')::uuid),true);

select set_config('request.jwt.claim.sub',current_setting('minuta.v73_owner'),true);
set local role authenticated;

do $$ begin
  begin
    insert into public.benefit_products(organization_id,name,kind,visits_count,validity_days)
    values(current_setting('minuta.v73_org')::uuid,'Forbidden direct write','visit_pass',1,30);
    raise exception using errcode='P0001',message='v73_direct_write_was_allowed';
  exception when insufficient_privilege then null;
  end;
end $$;

select public.set_minuta_benefits_enabled(current_setting('minuta.v73_org')::uuid,true);
select set_config('minuta.v73_product',(public.upsert_minuta_benefit_product(
  current_setting('minuta.v73_org')::uuid,null,'V73 package','package',9000,0,2,90,
  jsonb_build_array(jsonb_build_object('service_id',current_setting('minuta.v73_service'),'units',2))
)->>'id'),true);
select set_config('minuta.v73_instrument',(public.issue_minuta_benefit(
  current_setting('minuta.v73_org')::uuid,current_setting('minuta.v73_product')::uuid,
  current_setting('minuta.v73_client')::uuid,null,'00000000-0000-4000-8000-000000007311'::uuid
)->>'id'),true);
-- Exact issuance retry must return the same instrument and must not duplicate the balance.
select public.issue_minuta_benefit(
  current_setting('minuta.v73_org')::uuid,current_setting('minuta.v73_product')::uuid,
  current_setting('minuta.v73_client')::uuid,null,'00000000-0000-4000-8000-000000007311'::uuid
);
select set_config('minuta.v73_second',(public.issue_minuta_benefit(
  current_setting('minuta.v73_org')::uuid,current_setting('minuta.v73_product')::uuid,
  current_setting('minuta.v73_client')::uuid,null,'00000000-0000-4000-8000-000000007312'::uuid
)->>'id'),true);

select set_config('minuta.v73_redemption',(public.apply_minuta_benefit(
  current_setting('minuta.v73_org')::uuid,current_setting('minuta.v73_instrument')::uuid,
  current_setting('minuta.v73_booking')::uuid,'reserve',null
)->>'id'),true);
-- Exact retry must return the same reservation, not spend twice.
select public.apply_minuta_benefit(
  current_setting('minuta.v73_org')::uuid,current_setting('minuta.v73_instrument')::uuid,
  current_setting('minuta.v73_booking')::uuid,'reserve',null
);

do $$ begin
  if (select count(*) from public.client_benefit_instruments where organization_id=current_setting('minuta.v73_org')::uuid)<>2
     or (select count(*) from public.benefit_redemptions where booking_id=current_setting('minuta.v73_booking')::uuid)<>1
     or (select remaining_visits from public.client_benefit_instruments where id=current_setting('minuta.v73_instrument')::uuid)<>1
     or (select remaining_units from public.benefit_instrument_service_balances where instrument_id=current_setting('minuta.v73_instrument')::uuid and service_id=current_setting('minuta.v73_service')::uuid)<>1 then
    raise exception using errcode='P0001',message='v73_reservation_or_idempotency_failed';
  end if;
  begin
    perform public.apply_minuta_benefit(current_setting('minuta.v73_org')::uuid,current_setting('minuta.v73_second')::uuid,
      current_setting('minuta.v73_booking')::uuid,'reserve',null);
    raise exception using errcode='P0001',message='v73_duplicate_booking_benefit_was_allowed';
  exception when unique_violation then
    if sqlerrm<>'booking_already_has_benefit' then raise; end if;
  end;
  begin
    perform public.apply_minuta_benefit(current_setting('minuta.v73_org')::uuid,current_setting('minuta.v73_instrument')::uuid,
      current_setting('minuta.v73_booking')::uuid,'redeem',null);
    raise exception using errcode='P0001',message='v73_unfinished_visit_was_redeemed';
  exception when object_not_in_prerequisite_state then
    if sqlerrm<>'complete_visit_before_redemption' then raise; end if;
  end;
end $$;
reset role;

insert into public.booking_outcomes(booking_id,performer_id,visit_status,payment_method,amount_rub,completion_source)
values(current_setting('minuta.v73_booking')::uuid,current_setting('minuta.v73_owner')::uuid,'completed','cash',10000,'manual')
on conflict(booking_id) do update set visit_status='completed',performer_id=excluded.performer_id;

set local role authenticated;
select public.apply_minuta_benefit(current_setting('minuta.v73_org')::uuid,current_setting('minuta.v73_instrument')::uuid,
  current_setting('minuta.v73_booking')::uuid,'redeem',null);
select public.apply_minuta_benefit(current_setting('minuta.v73_org')::uuid,current_setting('minuta.v73_instrument')::uuid,
  current_setting('minuta.v73_booking')::uuid,'release',null);
reset role;

do $$ begin
  if (select status from public.benefit_redemptions where id=current_setting('minuta.v73_redemption')::uuid)<>'released'
     or (select remaining_visits from public.client_benefit_instruments where id=current_setting('minuta.v73_instrument')::uuid)<>2
     or (select remaining_units from public.benefit_instrument_service_balances where instrument_id=current_setting('minuta.v73_instrument')::uuid and service_id=current_setting('minuta.v73_service')::uuid)<>2
     or (select count(*) from public.benefit_ledger where instrument_id=current_setting('minuta.v73_instrument')::uuid and event_type in ('issued','reserved','redeemed','released'))<>4 then
    raise exception using errcode='P0001',message='v73_redemption_release_or_ledger_failed';
  end if;
  begin
    update public.benefit_ledger set details='{"tampered":true}'::jsonb where instrument_id=current_setting('minuta.v73_instrument')::uuid;
    raise exception using errcode='P0001',message='v73_ledger_was_mutable';
  exception when object_not_in_prerequisite_state then
    if sqlerrm<>'benefit_ledger_immutable' then raise; end if;
  end;
end $$;

rollback;
