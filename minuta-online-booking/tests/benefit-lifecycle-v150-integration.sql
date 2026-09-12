\set ON_ERROR_STOP on
begin;
set local statement_timeout='90s';
set local lock_timeout='15s';
set local search_path=public,extensions,pg_catalog;
set local timezone='Europe/Samara';

do $$ begin
  if to_regprocedure('public.set_minuta_benefit_lifecycle_v150(uuid,uuid,text,text,uuid)') is null then
    raise exception using errcode='P0001',message='v150_test_requires_v150';
  end if;
end $$;

do $fixture$
declare
  owner_id uuid:=gen_random_uuid(); organization_id uuid:=gen_random_uuid(); location_id uuid:=gen_random_uuid();
  service_id uuid:=gen_random_uuid(); client_id uuid:=gen_random_uuid(); booking_id uuid:=gen_random_uuid();
  phone text:='79'||translate(substr(md5(owner_id::text),1,9),'abcdef','012345');
begin
  perform set_config('minuta.v150_owner',owner_id::text,true);
  perform set_config('minuta.v150_org',organization_id::text,true);
  perform set_config('minuta.v150_location',location_id::text,true);
  perform set_config('minuta.v150_service',service_id::text,true);
  perform set_config('minuta.v150_client',client_id::text,true);
  perform set_config('minuta.v150_booking',booking_id::text,true);

  set local session_replication_role=replica;
  insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values(owner_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',owner_id::text||'@example.invalid',now(),'{}','{}',now(),now());
  set local session_replication_role=origin;
  insert into public.performer_profiles(id,display_name) values(owner_id,'V150 owner');
  insert into public.organizations(id,name,public_slug,status,public_booking_enabled,created_by)
  values(organization_id,'V150 organization','v150-'||replace(organization_id::text,'-',''),'active',true,owner_id);
  insert into public.organization_memberships(organization_id,user_id,role,is_bookable,active,created_by)
  values(organization_id,owner_id,'owner',true,true,owner_id);
  insert into public.locations(id,organization_id,name,timezone,address,active,is_primary)
  values(location_id,organization_id,'V150 location','Europe/Samara','V150 address',true,true);
  insert into public.services(id,performer_id,name,duration_minutes,price_rub,active)
  values(service_id,owner_id,'V150 service',60,2000,true);
  insert into public.client_accounts(id,normalized_phone,access_code_hash)
  values(client_id,phone,repeat('1',64));

  perform set_config('minuta.booking_organization',organization_id::text,true);
  perform set_config('minuta.booking_location',location_id::text,true);
  insert into public.bookings(
    id,booking_code,manage_token,performer_id,service_id,client_name,client_phone,client_account_id,
    booking_date,booking_time,duration_minutes,original_price_rub,total_price_rub,status,
    deposit_amount_rub,payment_status,payment_url,provider_note,booking_policy_snapshot
  ) values(
    booking_id,'V150-'||substr(replace(booking_id::text,'-',''),1,10),gen_random_uuid(),owner_id,service_id,
    'V150 Benefit Client',phone,client_id,current_date,time '09:00',60,2000,2000,'confirmed',
    0,'not_required','','','{}'
  );
  perform set_config('minuta.booking_organization','',true);
  perform set_config('minuta.booking_location','',true);
end
$fixture$;

do $$ begin
  if nullif(current_setting('minuta.v150_owner',true),'') is null
     or nullif(current_setting('minuta.v150_org',true),'') is null
     or nullif(current_setting('minuta.v150_booking',true),'') is null
     or nullif(current_setting('minuta.v150_client',true),'') is null
     or nullif(current_setting('minuta.v150_service',true),'') is null then
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
