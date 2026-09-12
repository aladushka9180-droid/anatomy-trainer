\set ON_ERROR_STOP on
begin;
set local statement_timeout='90s';
set local lock_timeout='15s';
set local search_path=public,extensions,pg_catalog;

create function pg_temp.v149_assert(ok boolean,label text)
returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'v149_assert:%',label; end if; end $$;

do $acl_shape$
begin
  perform pg_temp.v149_assert((select relrowsecurity from pg_class where oid='public.benefit_application_requests'::regclass),'request_table_rls_enabled');
  perform pg_temp.v149_assert(not has_table_privilege('anon','public.benefit_application_requests','select'),'anon_no_request_table_read');
  perform pg_temp.v149_assert(not has_table_privilege('authenticated','public.benefit_application_requests','select'),'authenticated_no_request_table_read');
  perform pg_temp.v149_assert(not has_table_privilege('authenticated','public.benefit_application_requests','insert'),'authenticated_no_request_table_write');
  perform pg_temp.v149_assert(not has_function_privilege('anon','public.apply_minuta_benefit_v149(uuid,uuid,uuid,text,integer,uuid)','execute'),'anon_no_application_rpc');
  perform pg_temp.v149_assert(has_function_privilege('authenticated','public.apply_minuta_benefit_v149(uuid,uuid,uuid,text,integer,uuid)','execute'),'authenticated_has_guarded_rpc');
  perform pg_temp.v149_assert(not has_function_privilege('authenticated','public.apply_minuta_benefit(uuid,uuid,uuid,text,integer)','execute'),'legacy_rpc_not_directly_callable');
end
$acl_shape$;

select set_config('minuta.v149_owner',(select legacy_performer_id::text from public.organizations
  where legacy_performer_id is not null and status='active' and public_booking_enabled order by id limit 1),true);
select set_config('minuta.v149_org',(select id::text from public.organizations
  where legacy_performer_id=current_setting('minuta.v149_owner')::uuid),true);
select set_config('minuta.v149_location',(select id::text from public.locations
  where organization_id=current_setting('minuta.v149_org')::uuid and active order by is_primary desc,id limit 1),true);
select set_config('minuta.v149_service',(select service.id::text from public.services service
  join public.organization_memberships membership on membership.organization_id=current_setting('minuta.v149_org')::uuid
    and membership.user_id=service.performer_id and membership.active and membership.is_bookable
  where service.active order by service.id limit 1),true);
select set_config('minuta.v149_slug',(select public_slug from public.organizations
  where id=current_setting('minuta.v149_org')::uuid),true);

set local role anon;
do $anon_denied$
begin
  begin
    perform public.apply_minuta_benefit_v149(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'reserve',null,gen_random_uuid());
    raise exception 'v149_anon_rpc_was_allowed';
  exception when insufficient_privilege then null;
  end;
end
$anon_denied$;
reset role;

select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
set local role authenticated;
do $outsider_denied$
begin
  begin
    perform public.apply_minuta_benefit_v149(current_setting('minuta.v149_org')::uuid,gen_random_uuid(),gen_random_uuid(),'reserve',null,gen_random_uuid());
    raise exception 'v149_outsider_rpc_was_allowed';
  exception when insufficient_privilege then null;
  end;
end
$outsider_denied$;
reset role;

select set_config('minuta.v149_slots',coalesce((select jsonb_agg(to_jsonb(slot) order by slot.booking_date,slot.booking_time)::text
  from (select * from public.get_public_minuta_available_slots_v4(
    current_setting('minuta.v149_slug'),current_setting('minuta.v149_location')::uuid,
    current_setting('minuta.v149_service')::uuid,current_date+1,current_date+62
  ) order by booking_date,booking_time limit 3) slot),'[]'),true);

do $fixture_check$
begin
  if nullif(current_setting('minuta.v149_owner',true),'') is null
     or nullif(current_setting('minuta.v149_service',true),'') is null
     or jsonb_array_length(current_setting('minuta.v149_slots')::jsonb)<3 then
    raise exception using errcode='P0001',message='v149_test_requires_owner_service_and_three_slots';
  end if;
end
$fixture_check$;

set local role anon;
select set_config('minuta.v149_manage1',(select manage_token::text from public.book_minuta_appointment(
  '00000000-0000-4000-8000-000000014901',current_setting('minuta.v149_slug'),
  current_setting('minuta.v149_location')::uuid,current_setting('minuta.v149_service')::uuid,
  (current_setting('minuta.v149_slots')::jsonb->0->>'booking_date')::date,
  (current_setting('minuta.v149_slots')::jsonb->0->>'booking_time')::time,'V149 Benefit Client','+79990014901')),true);
select * from public.bootstrap_client_access(current_setting('minuta.v149_manage1')::uuid,'V149 integration test');
select set_config('minuta.v149_manage2',(select manage_token::text from public.book_minuta_appointment(
  '00000000-0000-4000-8000-000000014902',current_setting('minuta.v149_slug'),
  current_setting('minuta.v149_location')::uuid,current_setting('minuta.v149_service')::uuid,
  (current_setting('minuta.v149_slots')::jsonb->1->>'booking_date')::date,
  (current_setting('minuta.v149_slots')::jsonb->1->>'booking_time')::time,'V149 Benefit Client','+79990014901')),true);
select * from public.bootstrap_client_access(current_setting('minuta.v149_manage2')::uuid,'V149 integration test');
select set_config('minuta.v149_manage3',(select manage_token::text from public.book_minuta_appointment(
  '00000000-0000-4000-8000-000000014903',current_setting('minuta.v149_slug'),
  current_setting('minuta.v149_location')::uuid,current_setting('minuta.v149_service')::uuid,
  (current_setting('minuta.v149_slots')::jsonb->2->>'booking_date')::date,
  (current_setting('minuta.v149_slots')::jsonb->2->>'booking_time')::time,'V149 Benefit Client','+79990014901')),true);
select * from public.bootstrap_client_access(current_setting('minuta.v149_manage3')::uuid,'V149 integration test');
reset role;

select set_config('minuta.v149_booking1',(select id::text from public.bookings where request_id='00000000-0000-4000-8000-000000014901'::uuid),true);
select set_config('minuta.v149_booking2',(select id::text from public.bookings where request_id='00000000-0000-4000-8000-000000014902'::uuid),true);
select set_config('minuta.v149_booking3',(select id::text from public.bookings where request_id='00000000-0000-4000-8000-000000014903'::uuid),true);
select set_config('minuta.v149_client',(select client_account_id::text from public.bookings where id=current_setting('minuta.v149_booking1')::uuid),true);

select set_config('request.jwt.claim.sub',current_setting('minuta.v149_owner'),true);
set local role authenticated;
select public.set_minuta_benefits_enabled(current_setting('minuta.v149_org')::uuid,true);

select set_config('minuta.v149_pass',(public.upsert_minuta_benefit_product(
  current_setting('minuta.v149_org')::uuid,null,'V149 visit pass','visit_pass',2000,0,2,90,'[]'::jsonb)->>'id'),true);
select set_config('minuta.v149_package',(public.upsert_minuta_benefit_product(
  current_setting('minuta.v149_org')::uuid,null,'V149 package','package',2000,0,2,90,
  jsonb_build_array(jsonb_build_object('service_id',current_setting('minuta.v149_service'),'units',2)))->>'id'),true);
select set_config('minuta.v149_certificate',(public.upsert_minuta_benefit_product(
  current_setting('minuta.v149_org')::uuid,null,'V149 certificate','certificate',5000,5000,0,90,'[]'::jsonb)->>'id'),true);

select public.set_minuta_finance_enabled_v133(current_setting('minuta.v149_org')::uuid,true);
select set_config('minuta.v149_cash',(public.create_minuta_financial_account_v129(
  current_setting('minuta.v149_org')::uuid,'00000000-0000-4000-8000-000000014910'::uuid,'V149 test cash','cash')->>'id'),true);
select set_config('minuta.v149_pass_sale',(public.sell_minuta_commercial_product_v147(
  current_setting('minuta.v149_org')::uuid,null,current_setting('minuta.v149_client')::uuid,'benefit_product',
  current_setting('minuta.v149_pass')::uuid,null,null,1,200000,0,'cash',current_setting('minuta.v149_cash')::uuid,
  '00000000-0000-4000-8000-000000014911'::uuid)->>'id'),true);
select set_config('minuta.v149_pass_instrument',(select benefit_instrument_id::text from public.commercial_sale_lines
  where sale_id=current_setting('minuta.v149_pass_sale')::uuid),true);
select set_config('minuta.v149_package_instrument',(public.issue_minuta_benefit(
  current_setting('minuta.v149_org')::uuid,current_setting('minuta.v149_package')::uuid,current_setting('minuta.v149_client')::uuid,
  null,'00000000-0000-4000-8000-000000014912'::uuid)->>'id'),true);
select set_config('minuta.v149_certificate_instrument',(public.issue_minuta_benefit(
  current_setting('minuta.v149_org')::uuid,current_setting('minuta.v149_certificate')::uuid,current_setting('minuta.v149_client')::uuid,
  null,'00000000-0000-4000-8000-000000014913'::uuid)->>'id'),true);

do $direct_paths_denied$
begin
  begin
    insert into public.benefit_application_requests(organization_id,request_id,request_fingerprint,instrument_id,booking_id,action,redemption_id,result_status)
    values(gen_random_uuid(),gen_random_uuid(),repeat('0',64),gen_random_uuid(),gen_random_uuid(),'reserve',gen_random_uuid(),'reserved');
    raise exception 'v149_direct_request_insert_was_allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.apply_minuta_benefit(current_setting('minuta.v149_org')::uuid,current_setting('minuta.v149_pass_instrument')::uuid,
      current_setting('minuta.v149_booking1')::uuid,'reserve',null);
    raise exception 'v149_legacy_rpc_was_allowed';
  exception when insufficient_privilege then null;
  end;
end
$direct_paths_denied$;

select set_config('minuta.v149_finance_before_reserve',(select count(*)::text from public.financial_transactions),true);
select set_config('minuta.v149_reserve_payload',(public.apply_minuta_benefit_v149(
  current_setting('minuta.v149_org')::uuid,current_setting('minuta.v149_pass_instrument')::uuid,current_setting('minuta.v149_booking1')::uuid,
  'reserve',null,'00000000-0000-4000-8000-000000014921'::uuid))::text,true);
select set_config('minuta.v149_redemption1',(current_setting('minuta.v149_reserve_payload')::jsonb->>'id'),true);
do $exact_replay_contract$
declare first_result jsonb:=current_setting('minuta.v149_reserve_payload')::jsonb;replay_result jsonb;
begin
  replay_result:=public.apply_minuta_benefit_v149(
    current_setting('minuta.v149_org')::uuid,current_setting('minuta.v149_pass_instrument')::uuid,current_setting('minuta.v149_booking1')::uuid,
    'reserve',null,'00000000-0000-4000-8000-000000014921'::uuid);
  perform pg_temp.v149_assert(replay_result->>'id'=first_result->>'id','replay_same_redemption');
  perform pg_temp.v149_assert((replay_result->>'replayed')::boolean,'replay_flag');
  perform pg_temp.v149_assert(replay_result?'commercial_sale_id' and replay_result?'sale_transaction_id','replay_linkage_keys');
  perform pg_temp.v149_assert((first_result->>'commercial_sale_id')::uuid=current_setting('minuta.v149_pass_sale')::uuid,'first_sale_linkage');
  perform pg_temp.v149_assert(nullif(first_result->>'sale_transaction_id','') is not null,'first_transaction_linkage');
  perform pg_temp.v149_assert((replay_result->'commercial_sale_id') is not distinct from (first_result->'commercial_sale_id'),'replay_same_sale_linkage');
  perform pg_temp.v149_assert((replay_result->'sale_transaction_id') is not distinct from (first_result->'sale_transaction_id'),'replay_same_transaction_linkage');
end
$exact_replay_contract$;
-- A lost request id is also safe: the business reservation is returned, not consumed twice.
select public.apply_minuta_benefit_v149(
  current_setting('minuta.v149_org')::uuid,current_setting('minuta.v149_pass_instrument')::uuid,current_setting('minuta.v149_booking1')::uuid,
  'reserve',null,'00000000-0000-4000-8000-000000014922'::uuid);

select set_config('minuta.v149_redemption2',(public.apply_minuta_benefit_v149(
  current_setting('minuta.v149_org')::uuid,current_setting('minuta.v149_package_instrument')::uuid,current_setting('minuta.v149_booking2')::uuid,
  'reserve',null,'00000000-0000-4000-8000-000000014923'::uuid)->>'id'),true);
select set_config('minuta.v149_redemption3',(public.apply_minuta_benefit_v149(
  current_setting('minuta.v149_org')::uuid,current_setting('minuta.v149_certificate_instrument')::uuid,current_setting('minuta.v149_booking3')::uuid,
  'reserve',1000,'00000000-0000-4000-8000-000000014924'::uuid)->>'id'),true);

do $reserve_assertions$
declare error_text text;
begin
  perform pg_temp.v149_assert((select count(*)=3 from public.benefit_redemptions where id in(
    current_setting('minuta.v149_redemption1')::uuid,current_setting('minuta.v149_redemption2')::uuid,current_setting('minuta.v149_redemption3')::uuid)),'three_products_reserved');
  perform pg_temp.v149_assert((select remaining_visits=1 from public.client_benefit_instruments where id=current_setting('minuta.v149_pass_instrument')::uuid),'visit_pass_once');
  perform pg_temp.v149_assert((select remaining_visits=1 from public.client_benefit_instruments where id=current_setting('minuta.v149_package_instrument')::uuid),'package_once');
  perform pg_temp.v149_assert((select remaining_units=1 from public.benefit_instrument_service_balances where instrument_id=current_setting('minuta.v149_package_instrument')::uuid),'package_service_once');
  perform pg_temp.v149_assert((select remaining_amount_rub=4000 from public.client_benefit_instruments where id=current_setting('minuta.v149_certificate_instrument')::uuid),'certificate_once');
  perform pg_temp.v149_assert((select count(*)=current_setting('minuta.v149_finance_before_reserve')::bigint from public.financial_transactions),'reserve_no_double_revenue');
  begin
    perform public.apply_minuta_benefit_v149(
      current_setting('minuta.v149_org')::uuid,current_setting('minuta.v149_certificate_instrument')::uuid,current_setting('minuta.v149_booking3')::uuid,
      'reserve',999,'00000000-0000-4000-8000-000000014924'::uuid);
    raise exception 'v149_idempotency_conflict_was_accepted';
  exception when unique_violation then
    get stacked diagnostics error_text=message_text;
    perform pg_temp.v149_assert(error_text='benefit_application_idempotency_conflict','idempotency_conflict_error');
  end;
end
$reserve_assertions$;
reset role;

insert into public.booking_outcomes(booking_id,performer_id,visit_status,payment_method,amount_rub)
select booking_id,current_setting('minuta.v149_owner')::uuid,'completed','cash',1000 from unnest(array[
  current_setting('minuta.v149_booking1')::uuid,current_setting('minuta.v149_booking2')::uuid,current_setting('minuta.v149_booking3')::uuid
]) as ids(booking_id) on conflict(booking_id) do update set visit_status='completed',performer_id=excluded.performer_id;
select set_config('minuta.v149_finance_after_outcomes',(select count(*)::text from public.financial_transactions),true);

set local role authenticated;
select public.apply_minuta_benefit_v149(current_setting('minuta.v149_org')::uuid,current_setting('minuta.v149_pass_instrument')::uuid,
  current_setting('minuta.v149_booking1')::uuid,'redeem',null,'00000000-0000-4000-8000-000000014931'::uuid);
select public.apply_minuta_benefit_v149(current_setting('minuta.v149_org')::uuid,current_setting('minuta.v149_pass_instrument')::uuid,
  current_setting('minuta.v149_booking1')::uuid,'redeem',null,'00000000-0000-4000-8000-000000014932'::uuid);
select public.apply_minuta_benefit_v149(current_setting('minuta.v149_org')::uuid,current_setting('minuta.v149_package_instrument')::uuid,
  current_setting('minuta.v149_booking2')::uuid,'redeem',null,'00000000-0000-4000-8000-000000014933'::uuid);
select public.apply_minuta_benefit_v149(current_setting('minuta.v149_org')::uuid,current_setting('minuta.v149_certificate_instrument')::uuid,
  current_setting('minuta.v149_booking3')::uuid,'redeem',null,'00000000-0000-4000-8000-000000014934'::uuid);
select public.apply_minuta_benefit_v149(current_setting('minuta.v149_org')::uuid,current_setting('minuta.v149_pass_instrument')::uuid,
  current_setting('minuta.v149_booking1')::uuid,'release',null,'00000000-0000-4000-8000-000000014935'::uuid);
select public.apply_minuta_benefit_v149(current_setting('minuta.v149_org')::uuid,current_setting('minuta.v149_pass_instrument')::uuid,
  current_setting('minuta.v149_booking1')::uuid,'release',null,'00000000-0000-4000-8000-000000014936'::uuid);
reset role;

do $final_assertions$
begin
  perform pg_temp.v149_assert((select status='released' from public.benefit_redemptions where id=current_setting('minuta.v149_redemption1')::uuid),'release_replayed');
  perform pg_temp.v149_assert((select remaining_visits=2 from public.client_benefit_instruments where id=current_setting('minuta.v149_pass_instrument')::uuid),'release_balance_once');
  perform pg_temp.v149_assert((select count(*)=current_setting('minuta.v149_finance_after_outcomes')::bigint from public.financial_transactions),'application_no_money_movement');
  perform pg_temp.v149_assert((select count(*)=10 from public.benefit_application_requests where organization_id=current_setting('minuta.v149_org')::uuid),'all_requests_audited');
  begin
    update public.benefit_application_requests set result_status='released' where organization_id=current_setting('minuta.v149_org')::uuid;
    raise exception 'v149_application_log_was_mutable';
  exception when object_not_in_prerequisite_state then
    if sqlerrm<>'benefit_application_requests_are_immutable' then raise; end if;
  end;
end
$final_assertions$;

rollback;
