begin;

do $$ begin
  if to_regprocedure('public.get_minuta_booking_policy_workspace(uuid)') is null then
    raise exception using errcode='P0001',message='v76_test_requires_v76';
  end if;
end $$;

select set_config('minuta.v76_owner',(select legacy_performer_id::text from public.organizations where legacy_performer_id is not null and status='active' and public_booking_enabled order by id limit 1),true);
select set_config('minuta.v76_org',(select id::text from public.organizations where legacy_performer_id=current_setting('minuta.v76_owner')::uuid),true);
select set_config('minuta.v76_location',(select id::text from public.locations where organization_id=current_setting('minuta.v76_org')::uuid and active order by is_primary desc,id limit 1),true);
select set_config('minuta.v76_service',(select service.id::text from public.services service join public.organization_memberships membership on membership.organization_id=current_setting('minuta.v76_org')::uuid and membership.user_id=service.performer_id and membership.active and membership.is_bookable where service.active and service.price_rub>0 order by service.id limit 1),true);
select set_config('minuta.v76_slug',(select public_slug from public.organizations where id=current_setting('minuta.v76_org')::uuid),true);

do $$ begin
  if coalesce((select enabled from public.organization_booking_policy_settings where organization_id=current_setting('minuta.v76_org')::uuid),false) then raise exception using errcode='P0001',message='v76_must_be_disabled_by_default'; end if;
  if (select count(*) from public.organization_booking_policy_rules where organization_id=current_setting('minuta.v76_org')::uuid and location_id is null and service_id is null)<>1 then raise exception using errcode='P0001',message='v76_default_policy_missing'; end if;
end $$;

select set_config('request.jwt.claim.sub',current_setting('minuta.v76_owner'),true);
set local role authenticated;
select public.upsert_minuta_booking_policy_rule(current_setting('minuta.v76_org')::uuid,null,current_setting('minuta.v76_location')::uuid,current_setting('minuta.v76_service')::uuid,24,18,3,'percent',25,30,true,'full_before_cutoff','https://pay.example.test/{code}?amount={amount}');
select public.set_minuta_booking_policies_enabled(current_setting('minuta.v76_org')::uuid,true);
reset role;

select set_config('minuta.v76_slot',coalesce((select to_jsonb(slot)::text from public.get_public_minuta_available_slots_v4(current_setting('minuta.v76_slug'),current_setting('minuta.v76_location')::uuid,current_setting('minuta.v76_service')::uuid,current_date+2,current_date+62) slot order by slot.booking_date,slot.booking_time limit 1),'{}'),true);
do $$ begin
  if current_setting('minuta.v76_slot')::jsonb='{}'::jsonb then raise exception using errcode='P0001',message='v76_test_requires_available_slot'; end if;
end $$;
set local role anon;
select * from public.book_minuta_appointment('00000000-0000-4000-8000-000000007601',current_setting('minuta.v76_slug'),current_setting('minuta.v76_location')::uuid,current_setting('minuta.v76_service')::uuid,(current_setting('minuta.v76_slot')::jsonb->>'booking_date')::date,(current_setting('minuta.v76_slot')::jsonb->>'booking_time')::time,'V76 Policy Client','+79990007601');
reset role;

do $$ declare v_booking public.bookings%rowtype;v_price integer;
begin
  select * into v_booking from public.bookings where request_id='00000000-0000-4000-8000-000000007601'::uuid;
  select coalesce(v_booking.total_price_rub,price_rub) into v_price from public.services where id=v_booking.service_id;
  if v_booking.booking_policy_snapshot->>'deposit_mode'<>'percent' or (v_booking.booking_policy_snapshot->>'deposit_value')::integer<>25
     or v_booking.deposit_amount_rub<>ceil(v_price*.25)::integer or v_booking.payment_status<>'pending'
     or v_booking.payment_due_at is null or v_booking.booking_policy_snapshot ? 'payment_url_template' then
    raise exception using errcode='P0001',message='v76_policy_snapshot_failed';
  end if;
end $$;

-- Editing the rule cannot rewrite the already accepted terms.
select set_config('request.jwt.claim.sub',current_setting('minuta.v76_owner'),true);
set local role authenticated;
select public.upsert_minuta_booking_policy_rule(current_setting('minuta.v76_org')::uuid,(select id from public.organization_booking_policy_rules where organization_id=current_setting('minuta.v76_org')::uuid and location_id=current_setting('minuta.v76_location')::uuid and service_id=current_setting('minuta.v76_service')::uuid),current_setting('minuta.v76_location')::uuid,current_setting('minuta.v76_service')::uuid,1,1,1,'fixed',100,10,false,'nonrefundable','https://pay.example.test/{code}');
reset role;
do $$ begin
  if (select booking_policy_snapshot->>'deposit_mode' from public.bookings where request_id='00000000-0000-4000-8000-000000007601'::uuid)<>'percent' then raise exception using errcode='P0001',message='v76_snapshot_was_mutated'; end if;
end $$;

-- The legacy public name must not bypass the immutable v76 snapshot.
select set_config('minuta.v76_manage',(select manage_token::text from public.bookings
  where request_id='00000000-0000-4000-8000-000000007601'::uuid),true);
set local role anon;
select * from public.bootstrap_client_access(current_setting('minuta.v76_manage')::uuid,'V76 cancellation test');
reset role;
select set_config('minuta.v76_client',(select client_account_id::text from public.bookings
  where request_id='00000000-0000-4000-8000-000000007601'::uuid),true);
select set_config('request.jwt.claim.sub',current_setting('minuta.v76_owner'),true);
set local role authenticated;
select public.set_minuta_benefits_enabled(current_setting('minuta.v76_org')::uuid,true);
select set_config('minuta.v76_product',(public.upsert_minuta_benefit_product(
  current_setting('minuta.v76_org')::uuid,null,'V76 cancellation pass','visit_pass',1000,0,1,30,
  jsonb_build_array(jsonb_build_object('service_id',current_setting('minuta.v76_service'),'units',1))
)->>'id'),true);
select set_config('minuta.v76_instrument',(public.issue_minuta_benefit(
  current_setting('minuta.v76_org')::uuid,current_setting('minuta.v76_product')::uuid,
  current_setting('minuta.v76_client')::uuid,null,'00000000-0000-4000-8000-000000007611'::uuid
)->>'id'),true);
select set_config('minuta.v76_redemption',(public.apply_minuta_benefit(
  current_setting('minuta.v76_org')::uuid,current_setting('minuta.v76_instrument')::uuid,
  (select id from public.bookings where request_id='00000000-0000-4000-8000-000000007601'::uuid),'reserve',null
)->>'id'),true);
reset role;
insert into public.payments(booking_id,performer_id,provider,provider_operation_id,amount_minor,currency,status)
select booking.id,booking.performer_id,'v76test','v76-late-payment-7601',booking.deposit_amount_rub::bigint*100,'RUB','pending'
from public.bookings booking where booking.request_id='00000000-0000-4000-8000-000000007601'::uuid;
set local role anon;
select public.cancel_booking(current_setting('minuta.v76_manage')::uuid);
reset role;
do $$ begin
  if not exists(select 1 from public.bookings where request_id='00000000-0000-4000-8000-000000007601'::uuid
      and status='cancelled' and cancellation_reason='client')
     or not exists(select 1 from public.payments payment join public.bookings booking on booking.id=payment.booking_id
      where booking.request_id='00000000-0000-4000-8000-000000007601'::uuid and payment.status='pending')
     or (select status from public.benefit_redemptions where id=current_setting('minuta.v76_redemption')::uuid)<>'released'
     or (select remaining_visits from public.client_benefit_instruments where id=current_setting('minuta.v76_instrument')::uuid)<>1
     or not exists(select 1 from public.benefit_ledger where redemption_id=current_setting('minuta.v76_redemption')::uuid and event_type='released') then
    raise exception using errcode='P0001',message='v76_legacy_cancel_wrapper_failed';
  end if;
end $$;
update public.payments set status='paid'
where provider='v76test' and provider_operation_id='v76-late-payment-7601';
do $$ begin
  if not exists(select 1 from public.bookings where request_id='00000000-0000-4000-8000-000000007601'::uuid
      and payment_status='paid' and refund_status='pending' and expired_unpaid_at is null) then
    raise exception using errcode='P0001',message='v76_late_payment_refund_not_queued';
  end if;
end $$;

-- Reuse the released slot and prove that expiry is effective and idempotent.
set local role anon;
select * from public.book_minuta_appointment('00000000-0000-4000-8000-000000007602',current_setting('minuta.v76_slug'),current_setting('minuta.v76_location')::uuid,current_setting('minuta.v76_service')::uuid,(current_setting('minuta.v76_slot')::jsonb->>'booking_date')::date,(current_setting('minuta.v76_slot')::jsonb->>'booking_time')::time,'V76 Expiry Client','+79990007602');
reset role;
update public.bookings set payment_due_at='-infinity'::timestamptz
  where request_id='00000000-0000-4000-8000-000000007602'::uuid;
do $$ declare v_first boolean;v_second boolean;
begin
  select public.expire_minuta_unpaid_booking(id) into v_first from public.bookings
    where request_id='00000000-0000-4000-8000-000000007602'::uuid;
  select public.expire_minuta_unpaid_booking(id) into v_second from public.bookings
    where request_id='00000000-0000-4000-8000-000000007602'::uuid;
  if v_first is not true or v_second is not false or not exists(select 1 from public.bookings
      where request_id='00000000-0000-4000-8000-000000007602'::uuid and status='cancelled'
        and cancellation_reason='payment_expired' and expired_unpaid_at is not null) then
    raise exception using errcode='P0001',message='v76_expiry_failed';
  end if;
end $$;

rollback;
