begin;

do $$ begin
  if to_regprocedure('public.set_minuta_benefit_lifecycle_v150(uuid,uuid,text,text,uuid)') is null then
    raise exception using errcode='P0001',message='v150_test_requires_v150';
  end if;
end $$;

select set_config('minuta.v150_owner',(select membership.user_id::text from public.organization_memberships membership
  join public.organizations organization on organization.id=membership.organization_id and organization.status='active'
  where membership.active and membership.role='owner' order by membership.organization_id limit 1),true);
select set_config('minuta.v150_org',(select membership.organization_id::text from public.organization_memberships membership
  where membership.user_id=current_setting('minuta.v150_owner')::uuid and membership.active and membership.role='owner'
  order by membership.organization_id limit 1),true);
select set_config('minuta.v150_booking',(select booking.id::text from public.bookings booking
  where booking.organization_id=current_setting('minuta.v150_org')::uuid and booking.client_account_id is not null
    and not exists(select 1 from public.benefit_redemptions redemption where redemption.booking_id=booking.id and redemption.status in('reserved','redeemed'))
  order by booking.created_at desc limit 1),true);
select set_config('minuta.v150_client',(select client_account_id::text from public.bookings where id=current_setting('minuta.v150_booking')::uuid),true);
select set_config('minuta.v150_service',(select service_id::text from public.bookings where id=current_setting('minuta.v150_booking')::uuid),true);

do $$ begin
  if nullif(current_setting('minuta.v150_owner',true),'') is null
     or nullif(current_setting('minuta.v150_booking',true),'') is null then
    raise exception using errcode='P0001',message='v150_test_requires_owner_and_client_booking';
  end if;
end $$;

insert into public.benefit_products(id,organization_id,name,kind,visits_count,validity_days,created_by)
values('00000000-0000-4000-8000-000000001501',current_setting('minuta.v150_org')::uuid,
  'V150 lifecycle pass','visit_pass',5,30,current_setting('minuta.v150_owner')::uuid);
insert into public.client_benefit_instruments(
  id,organization_id,product_id,client_account_id,request_id,public_code,product_snapshot,
  remaining_visits,expires_on,issued_by
) values(
  '00000000-0000-4000-8000-000000001502',current_setting('minuta.v150_org')::uuid,
  '00000000-0000-4000-8000-000000001501',current_setting('minuta.v150_client')::uuid,
  '00000000-0000-4000-8000-000000001503','LIFE-150-A',
  '{"name":"V150 lifecycle pass","kind":"visit_pass","services":[]}'::jsonb,5,current_date+10,
  current_setting('minuta.v150_owner')::uuid
);
insert into public.benefit_ledger(organization_id,instrument_id,event_type,visits_balance,actor_id)
values(current_setting('minuta.v150_org')::uuid,'00000000-0000-4000-8000-000000001502','issued',5,current_setting('minuta.v150_owner')::uuid);
insert into public.benefit_redemptions(
  id,organization_id,instrument_id,booking_id,service_id,units,status,acted_by
) values(
  '00000000-0000-4000-8000-000000001504',current_setting('minuta.v150_org')::uuid,
  '00000000-0000-4000-8000-000000001502',current_setting('minuta.v150_booking')::uuid,
  current_setting('minuta.v150_service')::uuid,1,'reserved',current_setting('minuta.v150_owner')::uuid
);

select set_config('request.jwt.claim.sub',current_setting('minuta.v150_owner'),true);
set local role authenticated;
do $$ begin
  begin
    perform public.set_minuta_benefit_lifecycle_v150(
      current_setting('minuta.v150_org')::uuid,'00000000-0000-4000-8000-000000001502','freeze','',
      '00000000-0000-4000-8000-000000001505'
    );
    raise exception using errcode='P0001',message='v150_reserved_benefit_was_frozen';
  exception when object_not_in_prerequisite_state then
    if sqlerrm<>'release_reserved_benefits_before_freeze' then raise; end if;
  end;
end $$;
reset role;

update public.benefit_redemptions set status='released',released_at=now()
where id='00000000-0000-4000-8000-000000001504';

set local role authenticated;
select public.set_minuta_benefit_lifecycle_v150(
  current_setting('minuta.v150_org')::uuid,'00000000-0000-4000-8000-000000001502','freeze','Отпуск клиента',
  '00000000-0000-4000-8000-000000001506'
);
reset role;
update public.benefit_freeze_periods set frozen_at=now()-interval '3 days'
where instrument_id='00000000-0000-4000-8000-000000001502' and thawed_at is null;
set local role authenticated;
select public.set_minuta_benefit_lifecycle_v150(
  current_setting('minuta.v150_org')::uuid,'00000000-0000-4000-8000-000000001502','unfreeze','Клиент вернулся',
  '00000000-0000-4000-8000-000000001507'
);
-- Lost-response retry must confirm the same result without another extension.
select public.set_minuta_benefit_lifecycle_v150(
  current_setting('minuta.v150_org')::uuid,'00000000-0000-4000-8000-000000001502','unfreeze','Клиент вернулся',
  '00000000-0000-4000-8000-000000001507'
);

do $$ begin
  if (select status from public.client_benefit_instruments where id='00000000-0000-4000-8000-000000001502')<>'active'
     or (select expires_on from public.client_benefit_instruments where id='00000000-0000-4000-8000-000000001502')<>current_date+13
     or (select count(*) from public.benefit_lifecycle_requests where instrument_id='00000000-0000-4000-8000-000000001502')<>2
     or (select count(*) from public.benefit_ledger where instrument_id='00000000-0000-4000-8000-000000001502' and event_type in('frozen','activated'))<>2 then
    raise exception using errcode='P0001',message='v150_freeze_unfreeze_or_replay_failed';
  end if;
  begin
    perform public.set_minuta_benefit_lifecycle_v150(
      current_setting('minuta.v150_org')::uuid,'00000000-0000-4000-8000-000000001502','unfreeze','',
      '00000000-0000-4000-8000-000000001508'
    );
    raise exception using errcode='P0001',message='v150_invalid_transition_was_allowed';
  exception when object_not_in_prerequisite_state then
    if sqlerrm<>'invalid_benefit_status_transition' then raise; end if;
  end;
end $$;
reset role;

insert into public.client_benefit_instruments(
  id,organization_id,product_id,client_account_id,request_id,public_code,product_snapshot,
  remaining_visits,expires_on,issued_by
) values(
  '00000000-0000-4000-8000-000000001509',current_setting('minuta.v150_org')::uuid,
  '00000000-0000-4000-8000-000000001501',current_setting('minuta.v150_client')::uuid,
  '00000000-0000-4000-8000-000000001510','LIFE-150-B',
  '{"name":"V150 expired pass","kind":"visit_pass","services":[]}'::jsonb,5,current_date-1,
  current_setting('minuta.v150_owner')::uuid
);
insert into public.benefit_ledger(organization_id,instrument_id,event_type,visits_balance,actor_id)
values(current_setting('minuta.v150_org')::uuid,'00000000-0000-4000-8000-000000001509','issued',5,current_setting('minuta.v150_owner')::uuid);

set local role authenticated;
select set_config('minuta.v150_payload',public.get_minuta_benefit_lifecycle_v150(
  current_setting('minuta.v150_org')::uuid,current_setting('minuta.v150_client')::uuid
)::text,true);
do $$ begin
  if (select status from public.client_benefit_instruments where id='00000000-0000-4000-8000-000000001509')<>'expired'
     or (select count(*) from public.benefit_ledger where instrument_id='00000000-0000-4000-8000-000000001509' and event_type='expired')<>1
     or jsonb_array_length(current_setting('minuta.v150_payload')::jsonb->'instruments')<2
     or not (current_setting('minuta.v150_payload')::jsonb->'instruments') @> '[{"id":"00000000-0000-4000-8000-000000001502","status":"active"}]'::jsonb then
    raise exception using errcode='P0001',message='v150_expiry_or_client_history_failed';
  end if;
end $$;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000001599',true);
do $$ begin
  begin
    perform public.get_minuta_benefit_lifecycle_v150(current_setting('minuta.v150_org')::uuid,current_setting('minuta.v150_client')::uuid);
    raise exception using errcode='P0001',message='v150_outsider_was_allowed';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
