-- ISOLATED TEST DATABASE ONLY. All synthetic rows are transaction-scoped and rolled back.
begin;

create function pg_temp.v155_assert(ok boolean,label text)
returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'v155_assert:%',label; end if;
end
$$;

select pg_temp.v155_assert(
  to_regprocedure('public.claim_client_booking_identity_v155(uuid,text)') is not null
  and to_regprocedure('public.issue_client_identity_claim_grant_v155(uuid,uuid,uuid,integer,uuid)') is not null
  and to_regprocedure('public.issue_client_identity_sale_claim_v155(uuid,uuid,uuid,integer,uuid,text)') is not null
  and to_regprocedure('public.inspect_client_identity_sale_claim_v155(text,uuid)') is not null
  and to_regprocedure('public.reserve_client_benefit_v155(uuid,uuid,uuid,uuid,integer,integer)') is not null
  and to_regprocedure('public.book_client_with_benefit_v155(text,uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer,text,integer,integer)') is not null,
  'v155_functions_present'
);
select pg_temp.v155_assert(
  has_function_privilege('anon','public.claim_client_booking_identity_v155(uuid,text)','execute')
  and has_function_privilege('authenticated','public.claim_client_booking_identity_v155(uuid,text)','execute')
  and not has_function_privilege('anon','public.issue_client_identity_claim_grant_v155(uuid,uuid,uuid,integer,uuid)','execute')
  and has_function_privilege('authenticated','public.issue_client_identity_claim_grant_v155(uuid,uuid,uuid,integer,uuid)','execute')
  and has_function_privilege('service_role','public.issue_client_identity_claim_grant_v155(uuid,uuid,uuid,integer,uuid)','execute')
  and not has_function_privilege('anon','public.issue_client_identity_sale_claim_v155(uuid,uuid,uuid,integer,uuid,text)','execute')
  and has_function_privilege('authenticated','public.issue_client_identity_sale_claim_v155(uuid,uuid,uuid,integer,uuid,text)','execute')
  and has_function_privilege('service_role','public.issue_client_identity_sale_claim_v155(uuid,uuid,uuid,integer,uuid,text)','execute')
  and has_function_privilege('anon','public.consume_client_identity_sale_claim_v155(text,text,uuid)','execute')
  and not has_function_privilege('anon','public.inspect_client_identity_sale_claim_v155(text,uuid)','execute')
  and not has_function_privilege('authenticated','public.inspect_client_identity_sale_claim_v155(text,uuid)','execute')
  and has_function_privilege('service_role','public.inspect_client_identity_sale_claim_v155(text,uuid)','execute')
  and not has_function_privilege('service_role','public.claim_client_booking_identity_v155(uuid,text)','execute')
  and not has_function_privilege('anon','public.reserve_client_benefit_v155(uuid,uuid,uuid,uuid,integer,integer)','execute')
  and not has_function_privilege('authenticated','public.reserve_client_benefit_v155(uuid,uuid,uuid,uuid,integer,integer)','execute')
  and not has_function_privilege('service_role','public.reserve_client_benefit_v155(uuid,uuid,uuid,uuid,integer,integer)','execute')
  and not has_function_privilege('anon','public.book_client_with_benefit_v155(text,uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer,text,integer,integer)','execute')
  and not has_function_privilege('authenticated','public.book_client_with_benefit_v155(text,uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer,text,integer,integer)','execute')
  and has_function_privilege('service_role','public.book_client_with_benefit_v155(text,uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer,text,integer,integer)','execute')
  and not has_function_privilege('anon','public.refund_minuta_commercial_sale_v147(uuid,uuid,numeric,bigint,text,uuid)','execute')
  and not has_function_privilege('anon','public.set_minuta_benefit_lifecycle_v150(uuid,uuid,text,text,uuid)','execute'),
  'least_privilege_acl'
);

do $fixture$
declare
  v_source record;
  v_org uuid:=gen_random_uuid();
  v_wrong_org uuid:=gen_random_uuid();
  v_location uuid:=gen_random_uuid();
  v_service uuid:=gen_random_uuid();
  v_initial_request uuid:=gen_random_uuid();
  v_same_phone_request uuid:=gen_random_uuid();
  v_benefit_request uuid:=gen_random_uuid();
  v_failed_request uuid:=gen_random_uuid();
  v_stale_request uuid:=gen_random_uuid();
  v_atomic_request uuid:=gen_random_uuid();
  v_claim_request uuid:=gen_random_uuid();
  v_account uuid:=gen_random_uuid();
  v_foreign_account uuid:=gen_random_uuid();
  v_product uuid:=gen_random_uuid();
  v_instrument uuid:=gen_random_uuid();
  v_foreign_instrument uuid:=gen_random_uuid();
  v_reject_instrument uuid:=gen_random_uuid();
  v_outsider uuid:=gen_random_uuid();
  v_sale uuid:=gen_random_uuid();
  v_sale_enrollment uuid:=gen_random_uuid();
  v_sale_visit uuid:=gen_random_uuid();
  v_sale_visit_conflict uuid:=gen_random_uuid();
  v_payment_account uuid:=gen_random_uuid();
  v_sale_claim_request_one uuid:=gen_random_uuid();
  v_sale_claim_request_two uuid:=gen_random_uuid();
  v_sale_claim_request_three uuid:=gen_random_uuid();
  v_sale_expired_request uuid:=gen_random_uuid();
  v_sale_refunded_request uuid:=gen_random_uuid();
  v_sale_expired_consumer uuid:=gen_random_uuid();
  v_sale_refunded_consumer uuid:=gen_random_uuid();
  v_sale_lock_consumer uuid:=gen_random_uuid();
  v_sale_consume_request uuid:=gen_random_uuid();
  v_sale_consume_other_request uuid:=gen_random_uuid();
  v_sale_enrollment_request uuid:=gen_random_uuid();
  v_sale_enrollment_consumer uuid:=gen_random_uuid();
  v_sale_visit_request uuid:=gen_random_uuid();
  v_sale_visit_conflict_request uuid:=gen_random_uuid();
  v_slot_one record;
  v_slot_two record;
  v_slot_three record;
  v_slot_four record;
begin
  select candidate.performer_id,candidate.duration_minutes into v_source
  from public.services candidate
  join public.organization_memberships membership
    on membership.user_id=candidate.performer_id and membership.active and membership.is_bookable
  join public.organizations organization
    on organization.id=membership.organization_id and organization.status='active'
  where candidate.active and exists(
    select 1 from public.get_available_slots(candidate.id,current_date+1,current_date+62)
  ) order by candidate.id limit 1;
  if v_source.performer_id is null then
    raise exception using errcode='55000',message='v155_test_requires_available_performer';
  end if;

  insert into public.organizations(id,name,public_slug,status,public_booking_enabled,created_by)
  values(v_org,'V155 isolated organization','v155-'||replace(v_org::text,'-',''),'active',true,v_source.performer_id);
  insert into public.organizations(id,name,public_slug,status,public_booking_enabled,created_by)
  values(v_wrong_org,'V155 wrong organization','v155-wrong-'||replace(v_wrong_org::text,'-',''),'active',false,v_source.performer_id);
  insert into public.locations(id,organization_id,name,address,timezone,active,is_primary)
  values(v_location,v_org,'V155 isolated location','V155 test address','Europe/Samara',true,true);
  insert into public.organization_memberships(organization_id,user_id,role,is_bookable,active,created_by)
  values(v_org,v_source.performer_id,'owner',true,true,v_source.performer_id);
  insert into public.organization_memberships(organization_id,user_id,role,is_bookable,active,created_by)
  values(v_wrong_org,v_source.performer_id,'owner',false,true,v_source.performer_id);
  insert into public.services(id,performer_id,name,duration_minutes,price_rub,active)
  values(v_service,v_source.performer_id,'V155 identity service',v_source.duration_minutes,1550,true);

  select available.booking_date,available.booking_time into v_slot_one
  from public.get_available_slots(v_service,current_date+1,current_date+62) available
  order by available.booking_date,available.booking_time limit 1;
  select available.booking_date,available.booking_time into v_slot_two
  from public.get_available_slots(v_service,current_date+1,current_date+62) available
  where available.booking_date+available.booking_time
    >=v_slot_one.booking_date+v_slot_one.booking_time+make_interval(mins=>v_source.duration_minutes)
  order by available.booking_date,available.booking_time limit 1;
  select available.booking_date,available.booking_time into v_slot_three
  from public.get_available_slots(v_service,current_date+1,current_date+62) available
  where available.booking_date+available.booking_time
    >=v_slot_two.booking_date+v_slot_two.booking_time+make_interval(mins=>v_source.duration_minutes)
  order by available.booking_date,available.booking_time limit 1;
  select available.booking_date,available.booking_time into v_slot_four
  from public.get_available_slots(v_service,current_date+1,current_date+62) available
  where available.booking_date+available.booking_time
    >=v_slot_three.booking_date+v_slot_three.booking_time+make_interval(mins=>v_source.duration_minutes)
  order by available.booking_date,available.booking_time limit 1;
  if v_slot_one.booking_date is null or v_slot_two.booking_date is null
     or v_slot_three.booking_date is null or v_slot_four.booking_date is null then
    raise exception using errcode='55000',message='v155_test_requires_four_slots';
  end if;

  perform set_config('v155.org',v_org::text,true);
  perform set_config('v155.wrong_org',v_wrong_org::text,true);
  perform set_config('v155.location',v_location::text,true);
  perform set_config('v155.service',v_service::text,true);
  perform set_config('v155.owner',v_source.performer_id::text,true);
  perform set_config('v155.slug','v155-'||replace(v_org::text,'-',''),true);
  perform set_config('v155.duration',v_source.duration_minutes::text,true);
  perform set_config('v155.date_one',v_slot_one.booking_date::text,true);
  perform set_config('v155.time_one',v_slot_one.booking_time::text,true);
  perform set_config('v155.date_two',v_slot_two.booking_date::text,true);
  perform set_config('v155.time_two',v_slot_two.booking_time::text,true);
  perform set_config('v155.date_three',v_slot_three.booking_date::text,true);
  perform set_config('v155.time_three',v_slot_three.booking_time::text,true);
  perform set_config('v155.initial_request',v_initial_request::text,true);
  perform set_config('v155.same_phone_request',v_same_phone_request::text,true);
  perform set_config('v155.benefit_request',v_benefit_request::text,true);
  perform set_config('v155.failed_request',v_failed_request::text,true);
  perform set_config('v155.stale_request',v_stale_request::text,true);
  perform set_config('v155.atomic_request',v_atomic_request::text,true);
  perform set_config('v155.claim_request',v_claim_request::text,true);
  perform set_config('v155.account',v_account::text,true);
  perform set_config('v155.foreign_account',v_foreign_account::text,true);
  perform set_config('v155.product',v_product::text,true);
  perform set_config('v155.instrument',v_instrument::text,true);
  perform set_config('v155.foreign_instrument',v_foreign_instrument::text,true);
  perform set_config('v155.reject_instrument',v_reject_instrument::text,true);
  perform set_config('v155.benefit_ref','ptbf_'||encode(extensions.digest('v155-benefit:'||v_instrument::text,'sha256'),'hex'),true);
  perform set_config('v155.foreign_benefit_ref','ptbf_'||encode(extensions.digest('v155-benefit:'||v_foreign_instrument::text,'sha256'),'hex'),true);
  perform set_config('v155.reject_benefit_ref','ptbf_'||encode(extensions.digest('v155-benefit:'||v_reject_instrument::text,'sha256'),'hex'),true);
  perform set_config('v155.outsider',v_outsider::text,true);
  perform set_config('v155.sale',v_sale::text,true);
  perform set_config('v155.sale_enrollment',v_sale_enrollment::text,true);
  perform set_config('v155.sale_visit',v_sale_visit::text,true);
  perform set_config('v155.sale_visit_conflict',v_sale_visit_conflict::text,true);
  perform set_config('v155.payment_account',v_payment_account::text,true);
  perform set_config('v155.sale_claim_request_one',v_sale_claim_request_one::text,true);
  perform set_config('v155.sale_claim_request_two',v_sale_claim_request_two::text,true);
  perform set_config('v155.sale_claim_request_three',v_sale_claim_request_three::text,true);
  perform set_config('v155.sale_expired_request',v_sale_expired_request::text,true);
  perform set_config('v155.sale_refunded_request',v_sale_refunded_request::text,true);
  perform set_config('v155.sale_expired_consumer',v_sale_expired_consumer::text,true);
  perform set_config('v155.sale_refunded_consumer',v_sale_refunded_consumer::text,true);
  perform set_config('v155.sale_lock_consumer',v_sale_lock_consumer::text,true);
  perform set_config('v155.sale_consume_request',v_sale_consume_request::text,true);
  perform set_config('v155.sale_consume_other_request',v_sale_consume_other_request::text,true);
  perform set_config('v155.sale_enrollment_request',v_sale_enrollment_request::text,true);
  perform set_config('v155.sale_enrollment_consumer',v_sale_enrollment_consumer::text,true);
  perform set_config('v155.sale_visit_request',v_sale_visit_request::text,true);
  perform set_config('v155.sale_visit_conflict_request',v_sale_visit_conflict_request::text,true);
  perform set_config('v155.date_four',v_slot_four.booking_date::text,true);
  perform set_config('v155.time_four',v_slot_four.booking_time::text,true);
end
$fixture$;

set local role anon;
select set_config('v155.created',(
  select to_jsonb(created)::text from public.book_minuta_appointment_v2(
    current_setting('v155.initial_request')::uuid,current_setting('v155.slug'),
    current_setting('v155.location')::uuid,current_setting('v155.service')::uuid,
    current_setting('v155.date_one')::date,current_setting('v155.time_one')::time,
    'V155 Client','+79990009999',1550,current_setting('v155.duration')::integer
  ) created
),true);
select set_config('v155.created_same_phone',(
  select to_jsonb(created)::text from public.book_minuta_appointment_v2(
    current_setting('v155.same_phone_request')::uuid,current_setting('v155.slug'),
    current_setting('v155.location')::uuid,current_setting('v155.service')::uuid,
    current_setting('v155.date_four')::date,current_setting('v155.time_four')::time,
    'V155 Same Phone','+79990009999',1550,current_setting('v155.duration')::integer
  ) created
),true);
select set_config('v155.bootstrap',(
  select to_jsonb(access)::text from public.bootstrap_client_access(
    (current_setting('v155.created')::jsonb->>'manage_token')::uuid,'v155-old-ui'
  ) access
),true);
reset role;
select set_config('v155.initial_booking',(
  select id::text from public.bookings where request_id=current_setting('v155.initial_request')::uuid
),true);
select set_config('v155.same_phone_booking',(
  select id::text from public.bookings where request_id=current_setting('v155.same_phone_request')::uuid
),true);

select pg_temp.v155_assert(
  current_setting('v155.created')::jsonb->>'result_code'='ok'
  and current_setting('v155.created_same_phone')::jsonb->>'result_code'='ok'
  and current_setting('v155.bootstrap')::jsonb->>'access_code' is null
  and current_setting('v155.bootstrap')::jsonb->>'session_token'~'^[0-9a-f]{64}$'
  and (select booking.client_account_id is null from public.bookings booking
       where booking.request_id=current_setting('v155.initial_request')::uuid)
  and (select booking.client_account_id is null from public.bookings booking
       where booking.request_id=current_setting('v155.same_phone_request')::uuid)
  and exists(
    select 1 from public.client_identity_sessions_v155 session_row
    where session_row.token_hash=encode(extensions.digest(
      current_setting('v155.bootstrap')::jsonb->>'session_token','sha256'),'hex')
      and session_row.session_scope='booking'
      and session_row.client_account_id is null
  ),
  'public_manage_token_is_booking_scoped'
);

set local role anon;
select set_config('v155.restored',(
  select to_jsonb(restored)::text from public.restore_client_session(
    current_setting('v155.bootstrap')::jsonb->>'session_token'
  ) restored
),true);
select set_config('v155.booking_count',(
  select count(*)::text from public.get_client_bookings_v3(
    current_setting('v155.bootstrap')::jsonb->>'session_token'
  )
),true);
do $public_promotion_denied$
begin
  begin
    perform public.promote_client_identity_v155(
      current_setting('v155.bootstrap')::jsonb->>'session_token',repeat('d',64)
    );
    raise exception 'v155_public_booking_promoted';
  exception when raise_exception then
    if sqlerrm<>'identity_confirmation_required' then raise; end if;
  end;
end
$public_promotion_denied$;
reset role;

select pg_temp.v155_assert(
  current_setting('v155.restored')::jsonb->>'normalized_phone' is null
  and current_setting('v155.booking_count')::integer=1,
  'booking_scope_hides_phone_and_keeps_exact_booking_visible'
);

insert into public.client_accounts(id,normalized_phone,access_code_hash)
values(
  current_setting('v155.account')::uuid,'79990009999',encode(extensions.digest(
    'ABCDEF0123456789:'||current_setting('v155.account'),'sha256'),'hex')
),(
  current_setting('v155.foreign_account')::uuid,'79990008888',
  encode(extensions.digest('foreign-unused','sha256'),'hex')
);
insert into public.client_device_sessions(client_account_id,token_hash,device_name,expires_at)
values(current_setting('v155.account')::uuid,
  encode(extensions.digest(repeat('7',64),'sha256'),'hex'),'legacy-device',now()+interval '30 days');
set local role anon;
do $legacy_rotate_upgrade_bypass_denied$
begin
  begin
    perform public.rotate_client_access_code(repeat('7',64));
    raise exception 'v155_legacy_rotate_bypassed_confirmation';
  exception when raise_exception then
    if sqlerrm<>'identity_confirmation_required' then raise; end if;
  end;
end
$legacy_rotate_upgrade_bypass_denied$;
reset role;
select pg_temp.v155_assert(
  (select account.access_code_hash=encode(extensions.digest(
      'ABCDEF0123456789:'||current_setting('v155.account'),'sha256'),'hex')
   from public.client_accounts account where account.id=current_setting('v155.account')::uuid)
  and exists(select 1 from public.client_device_sessions legacy
    where legacy.token_hash=encode(extensions.digest(repeat('7',64),'sha256'),'hex')
      and legacy.revoked_at is null)
  and not exists(select 1 from public.client_identity_sessions_v155 session_row
    where session_row.client_account_id=current_setting('v155.account')::uuid
      and session_row.session_source='legacy_upgrade'),
  'legacy_rotate_cannot_bypass_proof_required_by_upgrade'
);
set local role anon;
do $legacy_upgrade_wrong_code_denied$
begin
  begin
    perform public.upgrade_legacy_client_identity_session_v155(
      repeat('7',64),'0000-0000-0000-0000','upgraded-device'
    );
    raise exception 'v155_legacy_upgrade_without_code_proof';
  exception when raise_exception then
    if sqlerrm<>'invalid_client_session' then raise; end if;
  end;
end
$legacy_upgrade_wrong_code_denied$;
select set_config('v155.upgraded',(
  select to_jsonb(upgraded)::text from public.upgrade_legacy_client_identity_session_v155(
    repeat('7',64),'ABCD-EF01-2345-6789','upgraded-device'
  ) upgraded
),true);
reset role;
select pg_temp.v155_assert(
  current_setting('v155.upgraded')::jsonb->>'session_token'~'^[0-9a-f]{64}$'
  and exists(select 1 from public.client_device_sessions legacy
    where legacy.token_hash=encode(extensions.digest(repeat('7',64),'sha256'),'hex')
      and legacy.revoked_at is not null)
  and exists(select 1 from public.client_identity_sessions_v155 session_row
    where session_row.token_hash=encode(extensions.digest(
      current_setting('v155.upgraded')::jsonb->>'session_token','sha256'),'hex')
      and session_row.session_scope='account' and session_row.organization_id is null
      and session_row.claimed_booking_id is null),
  'legacy_upgrade_requires_access_code_and_is_one_time_account_scope'
);
insert into public.financial_accounts(
  id,organization_id,name,account_class,account_type,creation_request_id,request_fingerprint,created_by
) values(
  current_setting('v155.payment_account')::uuid,current_setting('v155.org')::uuid,
  'V155 cash','asset','cash',gen_random_uuid(),repeat('1',64),current_setting('v155.owner')::uuid
);
insert into public.commercial_sales(
  id,organization_id,booking_id,client_account_id,seller_id,status,payment_method,payment_account_id,
  subtotal_minor,discount_minor,total_minor,refunded_minor,request_id,request_fingerprint
) values(
  current_setting('v155.sale')::uuid,current_setting('v155.org')::uuid,null,
  current_setting('v155.account')::uuid,current_setting('v155.owner')::uuid,'paid','cash',
  current_setting('v155.payment_account')::uuid,155000,0,155000,0,gen_random_uuid(),repeat('2',64)
),(
  current_setting('v155.sale_enrollment')::uuid,current_setting('v155.org')::uuid,null,
  null,current_setting('v155.owner')::uuid,'paid','cash',
  current_setting('v155.payment_account')::uuid,155000,0,155000,0,gen_random_uuid(),repeat('3',64)
),(
  current_setting('v155.sale_visit')::uuid,current_setting('v155.org')::uuid,
  current_setting('v155.same_phone_booking')::uuid,
  null,current_setting('v155.owner')::uuid,'paid','cash',
  current_setting('v155.payment_account')::uuid,155000,0,155000,0,gen_random_uuid(),repeat('4',64)
),(
  current_setting('v155.sale_visit_conflict')::uuid,current_setting('v155.org')::uuid,
  current_setting('v155.initial_booking')::uuid,
  current_setting('v155.foreign_account')::uuid,current_setting('v155.owner')::uuid,'paid','cash',
  current_setting('v155.payment_account')::uuid,155000,0,155000,0,gen_random_uuid(),repeat('5',64)
);

insert into public.client_identity_claim_grants_v155(
  organization_id,claim_kind,booking_id,client_account_id,request_id,
  token_hash,issued_by,created_at,expires_at,superseded_at
) values(
  current_setting('v155.org')::uuid,'booking',
  current_setting('v155.initial_booking')::uuid,
  current_setting('v155.account')::uuid,gen_random_uuid(),
  encode(extensions.digest(repeat('e',64),'sha256'),'hex'),current_setting('v155.owner')::uuid,
  now()-interval '2 minutes',now()-interval '1 minute',now()-interval '1 minute'
),(
  current_setting('v155.wrong_org')::uuid,'booking',
  current_setting('v155.initial_booking')::uuid,
  current_setting('v155.account')::uuid,gen_random_uuid(),
  encode(extensions.digest(repeat('f',64),'sha256'),'hex'),current_setting('v155.owner')::uuid,
  now(),now()+interval '10 minutes',null
);

select set_config('request.jwt.claim.sub',current_setting('v155.outsider'),true);
set local role authenticated;
do $outsider_staff_actions_denied$
begin
  begin
    perform public.issue_client_identity_claim_grant_v155(
      current_setting('v155.org')::uuid,
      current_setting('v155.initial_booking')::uuid,
      gen_random_uuid(),10
    );
    raise exception 'v155_outsider_claim_issued';
  exception when insufficient_privilege then
    if sqlerrm<>'client_claim_grant_denied' then raise; end if;
  end;
  begin
    perform public.refund_minuta_commercial_sale_v147(
      current_setting('v155.org')::uuid,gen_random_uuid(),1,1,'Denied',gen_random_uuid()
    );
    raise exception 'v155_outsider_refund_allowed';
  exception when insufficient_privilege then
    if sqlerrm<>'financial_manager_role_required' then raise; end if;
  end;
  begin
    perform public.set_minuta_benefit_lifecycle_v150(
      current_setting('v155.org')::uuid,gen_random_uuid(),'freeze','Denied',gen_random_uuid()
    );
    raise exception 'v155_outsider_freeze_allowed';
  exception when insufficient_privilege then
    if sqlerrm<>'benefit_management_denied' then raise; end if;
  end;
end
$outsider_staff_actions_denied$;
reset role;

set local role anon;
do $hostile_claims_denied$
begin
  begin
    perform public.promote_client_identity_v155(current_setting('v155.bootstrap')::jsonb->>'session_token',repeat('e',64));
    raise exception 'v155_expired_claim_accepted';
  exception when raise_exception then if sqlerrm<>'identity_confirmation_required' then raise; end if; end;
  begin
    perform public.promote_client_identity_v155(current_setting('v155.bootstrap')::jsonb->>'session_token',repeat('f',64));
    raise exception 'v155_wrong_org_claim_accepted';
  exception when raise_exception then if sqlerrm<>'identity_confirmation_required' then raise; end if; end;
end
$hostile_claims_denied$;
reset role;

select pg_temp.v155_assert(
  (select bool_and(booking.client_account_id is null)
   from public.bookings booking
   where booking.request_id in(
     current_setting('v155.initial_request')::uuid,
     current_setting('v155.same_phone_request')::uuid
   )),
  'same_phone_bookings_start_unenrolled'
);
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
do $service_staff_actor_required$
begin
  begin
    perform public.issue_client_identity_claim_grant_v155(
      current_setting('v155.org')::uuid,
      current_setting('v155.initial_booking')::uuid,
      gen_random_uuid(),10
    );
    raise exception 'v155_service_booking_claim_without_actor';
  exception when insufficient_privilege then
    if sqlerrm<>'client_claim_grant_denied' then raise; end if;
  end;
  begin
    perform public.issue_client_identity_sale_claim_v155(
      current_setting('v155.org')::uuid,current_setting('v155.sale')::uuid,
      gen_random_uuid(),10
    );
    raise exception 'v155_service_sale_claim_without_actor';
  exception when insufficient_privilege then
    if sqlerrm<>'client_sale_claim_denied' then raise; end if;
  end;
end
$service_staff_actor_required$;
select set_config('v155.claim_service',(
  select to_jsonb(claim)::text from public.issue_client_identity_claim_grant_v155(
    current_setting('v155.org')::uuid,
    current_setting('v155.initial_booking')::uuid,
    current_setting('v155.claim_request')::uuid,10,current_setting('v155.owner')::uuid
  ) claim
),true);
reset role;

select pg_temp.v155_assert(
  (select booking.client_account_id=current_setting('v155.account')::uuid
   from public.bookings booking
   where booking.request_id=current_setting('v155.initial_request')::uuid)
  and (select booking.client_account_id is null
   from public.bookings booking
   where booking.request_id=current_setting('v155.same_phone_request')::uuid)
  and (select count(*)=1 from public.client_identity_audit_v155 audit
    where audit.action='client_account_enrolled_from_booking'
      and audit.booking_id=(select id from public.bookings
        where request_id=current_setting('v155.initial_request')::uuid)),
  'staff_enrollment_links_only_exact_booking'
);

select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub',current_setting('v155.owner'),true);
set local role authenticated;
select set_config('v155.claim',(
  select to_jsonb(claim)::text from public.issue_client_identity_claim_grant_v155(
    current_setting('v155.org')::uuid,
    current_setting('v155.initial_booking')::uuid,
    current_setting('v155.claim_request')::uuid,10
  ) claim
),true);
select set_config('v155.claim_replay',(
  select to_jsonb(claim)::text from public.issue_client_identity_claim_grant_v155(
    current_setting('v155.org')::uuid,
    current_setting('v155.initial_booking')::uuid,
    current_setting('v155.claim_request')::uuid,10
  ) claim
),true);
reset role;
set local role anon;
select set_config('v155.promoted',(
  select to_jsonb(promoted)::text from public.promote_client_identity_v155(
    current_setting('v155.bootstrap')::jsonb->>'session_token',
    current_setting('v155.claim')::jsonb->>'claim_token'
  ) promoted
),true);
select set_config('v155.promoted_replay',(
  select to_jsonb(promoted)::text from public.promote_client_identity_v155(
    current_setting('v155.bootstrap')::jsonb->>'session_token',
    current_setting('v155.claim')::jsonb->>'claim_token'
  ) promoted
),true);
reset role;

select pg_temp.v155_assert(
  current_setting('v155.promoted')::jsonb->>'session_scope'='organization'
  and current_setting('v155.claim_service')::jsonb->>'claim_token'
      =current_setting('v155.claim')::jsonb->>'claim_token'
  and current_setting('v155.claim')::jsonb->>'claim_token'
      =current_setting('v155.claim_replay')::jsonb->>'claim_token'
  and current_setting('v155.promoted_replay')::jsonb->>'session_scope'='organization'
  and exists(
    select 1 from public.client_identity_sessions_v155 session_row
    where session_row.token_hash=encode(extensions.digest(
      current_setting('v155.bootstrap')::jsonb->>'session_token','sha256'),'hex')
      and session_row.session_scope='organization'
      and session_row.client_account_id=current_setting('v155.account')::uuid
      and session_row.organization_id=current_setting('v155.org')::uuid
      and session_row.claimed_booking_id is null
  )
  and (select count(*)=1 from public.client_identity_claim_grants_v155 grant_row
       where grant_row.token_hash=encode(extensions.digest(
         current_setting('v155.claim')::jsonb->>'claim_token','sha256'),'hex')
         and grant_row.consumed_at is not null),
  'claim_is_exact_one_time_and_organization_scope_is_detached'
);

set local role anon;
select set_config('v155.bootstrap_other',(
  select to_jsonb(access)::text from public.bootstrap_client_access(
    (current_setting('v155.created')::jsonb->>'manage_token')::uuid,'v155-other-ui'
  ) access
),true);
do $consumed_grant_reuse_denied$
begin
  begin
    perform public.promote_client_identity_v155(
      current_setting('v155.bootstrap_other')::jsonb->>'session_token',
      current_setting('v155.claim')::jsonb->>'claim_token'
    );
    raise exception 'v155_consumed_grant_reused';
  exception when raise_exception then
    if sqlerrm<>'identity_confirmation_required' then raise; end if;
  end;
  begin
    perform public.begin_client_identity_transfer_v155(
      current_setting('v155.bootstrap_other')::jsonb->>'session_token','booking-scope-device'
    );
    raise exception 'v155_booking_scope_started_transfer';
  exception when raise_exception then
    if sqlerrm<>'transfer_unavailable' then raise; end if;
  end;
end
$consumed_grant_reuse_denied$;
reset role;

select pg_temp.v155_assert(
  (select sale.client_account_id is null and sale.booking_id is null
      and sale.status='paid' and sale.refunded_minor=0
   from public.commercial_sales sale
   where sale.id=current_setting('v155.sale_enrollment')::uuid),
  'standalone_sale_starts_unenrolled_and_paid'
);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub',current_setting('v155.owner'),true);
set local role authenticated;
select set_config('v155.sale_enrollment_claim_old',(
  select to_jsonb(claim)::text from public.issue_client_identity_sale_claim_v155(
    current_setting('v155.org')::uuid,current_setting('v155.sale_enrollment')::uuid,
    current_setting('v155.sale_enrollment_request')::uuid,10,
    current_setting('v155.owner')::uuid,'+79990009999'
  ) claim
),true);
reset role;
select pg_temp.v155_assert(
  (select sale.client_account_id=current_setting('v155.account')::uuid
   from public.commercial_sales sale where sale.id=current_setting('v155.sale_enrollment')::uuid)
  and (select booking.client_account_id is null from public.bookings booking
   where booking.request_id=current_setting('v155.same_phone_request')::uuid)
  and (select count(*)=1 from public.client_identity_audit_v155 audit
   where audit.client_account_id=current_setting('v155.account')::uuid
     and audit.action='client_account_enrolled_from_sale'
     and audit.subject_id=current_setting('v155.sale_enrollment')::uuid),
  'authenticated_staff_enrollment_links_only_exact_standalone_sale'
);
update public.client_identity_claim_grants_v155
set created_at=now()-interval '31 minutes',expires_at=now()-interval '21 minutes'
where request_id=current_setting('v155.sale_enrollment_request')::uuid;
select set_config('v155.sale_enrollment_old_created_at',(
  select grant_row.created_at::text from public.client_identity_claim_grants_v155 grant_row
  where grant_row.request_id=current_setting('v155.sale_enrollment_request')::uuid
),true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub',current_setting('v155.owner'),true);
set local role authenticated;
select set_config('v155.sale_enrollment_claim_new',(
  select to_jsonb(claim)::text from public.issue_client_identity_sale_claim_v155(
    current_setting('v155.org')::uuid,current_setting('v155.sale_enrollment')::uuid,
    current_setting('v155.sale_enrollment_request')::uuid,10,
    current_setting('v155.owner')::uuid,'+79990009999'
  ) claim
),true);
reset role;
select pg_temp.v155_assert(
  current_setting('v155.sale_enrollment_claim_old')::jsonb->>'claim_token'
    ~'^PTS1-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$'
  and current_setting('v155.sale_enrollment_claim_new')::jsonb->>'claim_token'
    ~'^PTS1-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$'
  and current_setting('v155.sale_enrollment_claim_old')::jsonb->>'claim_token'
    <>current_setting('v155.sale_enrollment_claim_new')::jsonb->>'claim_token'
  and (select count(*)=1 and bool_and(
      grant_row.issue_generation=2
      and grant_row.created_at>current_setting('v155.sale_enrollment_old_created_at')::timestamptz
      and grant_row.created_at>now()-interval '1 minute'
      and grant_row.expires_at>now()
      and grant_row.superseded_at is null
      and grant_row.consumed_at is null
      and grant_row.token_hash=encode(extensions.digest(replace(
        current_setting('v155.sale_enrollment_claim_new')::jsonb->>'claim_token','-',''
      ),'sha256'),'hex')
      and grant_row.token_hash<>encode(extensions.digest(replace(
        current_setting('v155.sale_enrollment_claim_old')::jsonb->>'claim_token','-',''
      ),'sha256'),'hex'))
    from public.client_identity_claim_grants_v155 grant_row
    where grant_row.claim_kind='sale'
      and grant_row.commercial_sale_id=current_setting('v155.sale_enrollment')::uuid),
  'expired_sale_issuance_rotates_generation_token_and_created_at'
);
set local role service_role;
select pg_temp.v155_assert(
  (select count(*)=0 from public.inspect_client_identity_sale_claim_v155(
    current_setting('v155.sale_enrollment_claim_old')::jsonb->>'claim_token',
    current_setting('v155.sale_enrollment_consumer')::uuid
  )),
  'reissued_sale_old_token_is_not_inspectable'
);
reset role;
set local role anon;
select pg_temp.v155_assert(
  (select count(*)=0 from public.consume_client_identity_sale_claim_v155(
    current_setting('v155.sale_enrollment_claim_old')::jsonb->>'claim_token','old-token-device',
    current_setting('v155.sale_enrollment_consumer')::uuid
  )),
  'reissued_sale_old_token_is_not_consumable'
);
reset role;

select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub',current_setting('v155.owner'),true);
set local role authenticated;
select set_config('v155.sale_visit_claim',(
  select to_jsonb(claim)::text from public.issue_client_identity_sale_claim_v155(
    current_setting('v155.org')::uuid,current_setting('v155.sale_visit')::uuid,
    current_setting('v155.sale_visit_request')::uuid,10
  ) claim
),true);
do $in_visit_sale_cross_subject_denied$
begin
  begin
    perform public.issue_client_identity_sale_claim_v155(
      current_setting('v155.wrong_org')::uuid,current_setting('v155.sale_visit')::uuid,
      gen_random_uuid(),10
    );
    raise exception 'v155_cross_org_visit_sale_claim_issued';
  exception when insufficient_privilege then
    if sqlerrm<>'client_sale_claim_denied' then raise; end if;
  end;
  begin
    perform public.issue_client_identity_sale_claim_v155(
      current_setting('v155.org')::uuid,current_setting('v155.sale_visit_conflict')::uuid,
      current_setting('v155.sale_visit_conflict_request')::uuid,10
    );
    raise exception 'v155_other_account_visit_sale_claim_issued';
  exception when unique_violation then
    if sqlerrm<>'client_identity_subject_conflict' then raise; end if;
  end;
end
$in_visit_sale_cross_subject_denied$;
reset role;
set local role service_role;
select set_config('v155.sale_visit_inspect',(
  select to_jsonb(inspected)::text from public.inspect_client_identity_sale_claim_v155(
    current_setting('v155.sale_visit_claim')::jsonb->>'claim_token',gen_random_uuid()
  ) inspected
),true);
reset role;
select pg_temp.v155_assert(
  (select booking.client_account_id=current_setting('v155.account')::uuid
   from public.bookings booking
   where booking.request_id=current_setting('v155.same_phone_request')::uuid)
  and (select sale.client_account_id=current_setting('v155.account')::uuid
       and sale.booking_id=(select booking.id from public.bookings booking
         where booking.request_id=current_setting('v155.same_phone_request')::uuid)
   from public.commercial_sales sale where sale.id=current_setting('v155.sale_visit')::uuid)
  and (select sale.client_account_id=current_setting('v155.foreign_account')::uuid
   from public.commercial_sales sale where sale.id=current_setting('v155.sale_visit_conflict')::uuid)
  and current_setting('v155.sale_visit_inspect')::jsonb->>'claim_scope'='purchase'
  and current_setting('v155.sale_visit_inspect')::jsonb->>'claim_status'='active'
  and current_setting('v155.sale_visit_claim')::jsonb->>'claim_token'
    ~'^PTS1-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$'
  and exists(select 1 from public.client_identity_claim_grants_v155 grant_row
    where grant_row.request_id=current_setting('v155.sale_visit_request')::uuid
      and grant_row.token_hash=encode(extensions.digest(replace(
        current_setting('v155.sale_visit_claim')::jsonb->>'claim_token','-',''
      ),'sha256'),'hex'))
  and not exists(select 1 from public.client_identity_claim_grants_v155 grant_row
    where grant_row.request_id=current_setting('v155.sale_visit_conflict_request')::uuid)
  and exists(select 1 from public.client_identity_audit_v155 audit
    where audit.action='client_account_enrolled_from_sale'
      and audit.subject_id=current_setting('v155.sale_visit')::uuid
      and (audit.details->>'booking_linked')::boolean),
  'in_visit_sale_links_exact_booking_org_account_and_rejects_cross_subjects'
);

select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub',current_setting('v155.owner'),true);
set local role authenticated;
select set_config('v155.sale_claim_one',(
  select to_jsonb(claim)::text from public.issue_client_identity_sale_claim_v155(
    current_setting('v155.org')::uuid,current_setting('v155.sale')::uuid,
    current_setting('v155.sale_claim_request_one')::uuid,10
  ) claim
),true);
select set_config('v155.sale_claim_one_replay',(
  select to_jsonb(claim)::text from public.issue_client_identity_sale_claim_v155(
    current_setting('v155.org')::uuid,current_setting('v155.sale')::uuid,
    current_setting('v155.sale_claim_request_one')::uuid,10
  ) claim
),true);
select set_config('v155.sale_claim_two',(
  select to_jsonb(claim)::text from public.issue_client_identity_sale_claim_v155(
    current_setting('v155.org')::uuid,current_setting('v155.sale')::uuid,
    current_setting('v155.sale_claim_request_two')::uuid,10
  ) claim
),true);
do $superseded_request_is_terminal$
begin
  begin
    perform public.issue_client_identity_sale_claim_v155(
      current_setting('v155.org')::uuid,current_setting('v155.sale')::uuid,
      current_setting('v155.sale_claim_request_one')::uuid,10
    );
    raise exception 'v155_superseded_sale_request_reissued';
  exception when raise_exception then
    if sqlerrm<>'client_claim_superseded' then raise; end if;
  end;
end
$superseded_request_is_terminal$;
reset role;
select pg_temp.v155_assert(
  current_setting('v155.sale_claim_one')::jsonb->>'claim_token'
    ~'^PTS1-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$'
  and current_setting('v155.sale_claim_one_replay')::jsonb->>'claim_token'
    ~'^PTS1-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$'
  and current_setting('v155.sale_claim_two')::jsonb->>'claim_token'
    ~'^PTS1-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$'
  and current_setting('v155.sale_claim_one')::jsonb->>'claim_token'
    =current_setting('v155.sale_claim_one_replay')::jsonb->>'claim_token'
  and current_setting('v155.sale_claim_one')::jsonb->>'claim_token'
    <>current_setting('v155.sale_claim_two')::jsonb->>'claim_token'
  and current_setting('v155.sale_claim_two')::jsonb->>'claim_token'
    ~'^PTS1-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$'
  and (current_setting('v155.sale_claim_two')::jsonb->>'claim_expires_at')::timestamptz
    <=now()+interval '10 minutes'
  and exists(select 1 from public.client_identity_claim_grants_v155 grant_row
    where grant_row.request_id=current_setting('v155.sale_claim_request_one')::uuid
      and grant_row.superseded_at is not null)
  and exists(select 1 from public.client_identity_claim_grants_v155 grant_row
    where grant_row.request_id=current_setting('v155.sale_claim_request_two')::uuid
      and grant_row.token_hash=encode(extensions.digest(replace(
        current_setting('v155.sale_claim_two')::jsonb->>'claim_token','-',''
      ),'sha256'),'hex'))
  and (select count(*)=1 from public.client_identity_claim_grants_v155 grant_row
    where grant_row.claim_kind='sale'
      and grant_row.commercial_sale_id=current_setting('v155.sale')::uuid
      and grant_row.consumed_at is null and grant_row.superseded_at is null),
  'standalone_sale_claim_issue_is_idempotent_superseding_and_terminal'
);

insert into public.client_identity_claim_grants_v155(
  organization_id,claim_kind,commercial_sale_id,client_account_id,request_id,
  token_hash,issued_by,created_at,expires_at,superseded_at
) values
(
  current_setting('v155.org')::uuid,'sale',current_setting('v155.sale')::uuid,
  current_setting('v155.account')::uuid,current_setting('v155.sale_expired_request')::uuid,
  encode(extensions.digest(replace('PTS1-DEAD-BEEF-CAFE-BABE','-',''),'sha256'),'hex'),
  current_setting('v155.owner')::uuid,now()-interval '2 minutes',now()-interval '1 minute',now()-interval '1 minute'
),
(
  current_setting('v155.org')::uuid,'sale',current_setting('v155.sale')::uuid,
  current_setting('v155.account')::uuid,current_setting('v155.sale_refunded_request')::uuid,
  encode(extensions.digest(replace('PTS1-FEED-FACE-C0DE-1234','-',''),'sha256'),'hex'),
  current_setting('v155.owner')::uuid,now(),now()+interval '10 minutes',now()
);

update public.commercial_sales set status='partially_refunded',refunded_minor=1
where id=current_setting('v155.sale')::uuid;
set local role anon;
select pg_temp.v155_assert(
  (select count(*)=0 from public.consume_client_identity_sale_claim_v155(
    'PTS1-FEED-FACE-C0DE-1234','sale-device',
    current_setting('v155.sale_refunded_consumer')::uuid
  )),
  'refunded_sale_claim_returns_no_rows'
);
reset role;
select pg_temp.v155_assert(
  current_setting('v155.sale_refunded_request')::uuid
    <>current_setting('v155.sale_refunded_consumer')::uuid
  and
  exists(select 1 from public.client_identity_claim_grants_v155 grant_row
    where grant_row.request_id=current_setting('v155.sale_refunded_request')::uuid
      and grant_row.failed_attempts=1 and grant_row.locked_at is null),
  'refunded_sale_claim_failure_is_persisted'
);
update public.commercial_sales set status='paid',refunded_minor=0
where id=current_setting('v155.sale')::uuid;

set local role anon;
select pg_temp.v155_assert(
  (select count(*)=0 from public.consume_client_identity_sale_claim_v155(
    'PTS1-DEAD-BEEF-CAFE-BABE','sale-device',
    current_setting('v155.sale_expired_consumer')::uuid
  )),
  'expired_sale_claim_returns_no_rows'
);
reset role;
update public.commercial_sales set status='partially_refunded',refunded_minor=1
where id=current_setting('v155.sale')::uuid;
set local role anon;
do $sale_claim_lockout$
declare
  v_attempt integer;
  v_rows bigint;
begin
  for v_attempt in 1..5 loop
    select count(*) into v_rows from public.consume_client_identity_sale_claim_v155(
      current_setting('v155.sale_claim_two')::jsonb->>'claim_token','sale-device',
      current_setting('v155.sale_lock_consumer')::uuid
    );
    if v_rows<>0 then raise exception 'v155_wrong_sale_claim_returned_rows'; end if;
  end loop;
end
$sale_claim_lockout$;
select pg_temp.v155_assert(
  (select count(*)=0 from public.consume_client_identity_sale_claim_v155(
    current_setting('v155.sale_claim_two')::jsonb->>'claim_token','sale-device',
    current_setting('v155.sale_lock_consumer')::uuid
  )),
  'locked_sale_claim_returns_no_rows'
);
reset role;
update public.commercial_sales set status='paid',refunded_minor=0
where id=current_setting('v155.sale')::uuid;
select pg_temp.v155_assert(
  current_setting('v155.sale_expired_request')::uuid
    <>current_setting('v155.sale_expired_consumer')::uuid
  and current_setting('v155.sale_claim_request_two')::uuid
    <>current_setting('v155.sale_lock_consumer')::uuid
  and
  exists(select 1 from public.client_identity_claim_grants_v155 grant_row
    where grant_row.request_id=current_setting('v155.sale_expired_request')::uuid
      and grant_row.failed_attempts=1 and grant_row.locked_at is null)
  and exists(select 1 from public.client_identity_claim_grants_v155 grant_row
    where grant_row.request_id=current_setting('v155.sale_claim_request_two')::uuid
      and grant_row.failed_attempts=5 and grant_row.locked_at is not null),
  'sale_claim_failures_and_fifth_attempt_lock_are_persisted'
);

select set_config('request.jwt.claim.sub',current_setting('v155.owner'),true);
set local role authenticated;
select set_config('v155.sale_claim_three',(
  select to_jsonb(claim)::text from public.issue_client_identity_sale_claim_v155(
    current_setting('v155.org')::uuid,current_setting('v155.sale')::uuid,
    current_setting('v155.sale_claim_request_three')::uuid,10
  ) claim
),true);
reset role;

select pg_temp.v155_assert(
  current_setting('v155.sale_claim_three')::jsonb->>'claim_token'
    ~'^PTS1-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$'
  and exists(select 1 from public.client_identity_claim_grants_v155 grant_row
    where grant_row.request_id=current_setting('v155.sale_claim_request_three')::uuid
      and grant_row.token_hash=encode(extensions.digest(replace(
        current_setting('v155.sale_claim_three')::jsonb->>'claim_token','-',''
      ),'sha256'),'hex')),
  'generated_sale_claim_is_uppercase_and_hashes_exact_normalized_token'
);

set local role service_role;
select set_config('v155.sale_inspect',(
  select to_jsonb(inspected)::text from public.inspect_client_identity_sale_claim_v155(
    current_setting('v155.sale_claim_three')::jsonb->>'claim_token',
    current_setting('v155.sale_consume_request')::uuid
  ) inspected
),true);
select pg_temp.v155_assert(
  (select count(*)=0 from public.inspect_client_identity_sale_claim_v155(
    'PTS1-0000-0000-0000-0000',current_setting('v155.sale_consume_request')::uuid
  ))
  and (select count(*)=0 from public.inspect_client_identity_sale_claim_v155(
    lower(current_setting('v155.sale_claim_three')::jsonb->>'claim_token'),
    current_setting('v155.sale_consume_request')::uuid
  ))
  and (select count(*)=0 from public.inspect_client_identity_sale_claim_v155(
    'PTS1-DEAD-BEEF-CAFE-BABE',current_setting('v155.sale_expired_consumer')::uuid
  )),
  'sale_claim_inspection_wrong_or_expired_is_neutral'
);
reset role;
select pg_temp.v155_assert(
  current_setting('v155.sale_claim_request_three')::uuid
    <>current_setting('v155.sale_consume_request')::uuid
  and current_setting('v155.sale_inspect')::jsonb->>'account_ref'~'^ptac_[0-9a-f]{64}$'
  and current_setting('v155.sale_inspect')::jsonb->>'organization_ref'~'^ptorg_[0-9a-f]{64}$'
  and current_setting('v155.sale_inspect')::jsonb->>'revision'~'^ptrv_[0-9a-f]{64}$'
  and current_setting('v155.sale_inspect')::jsonb->>'claim_scope'='purchase'
  and current_setting('v155.sale_inspect')::jsonb->>'claim_status'='active'
  and current_setting('v155.sale_inspect')::jsonb->>'claim_expires_at'
    =current_setting('v155.sale_claim_three')::jsonb->>'claim_expires_at'
  and exists(select 1 from public.client_identity_claim_grants_v155 grant_row
    where grant_row.request_id=current_setting('v155.sale_claim_request_three')::uuid
      and grant_row.failed_attempts=0 and grant_row.locked_at is null
      and grant_row.consumed_at is null and grant_row.consume_request_id is null
      and grant_row.consumed_by_session_id is null)
  and exists(select 1 from public.client_identity_claim_grants_v155 grant_row
    where grant_row.request_id=current_setting('v155.sale_expired_request')::uuid
      and grant_row.failed_attempts=1 and grant_row.locked_at is null),
  'sale_claim_inspection_is_stable_and_non_consuming'
);

set local role anon;
select set_config('v155.lowercase_sale_consume_count',(
  select count(*)::text from public.consume_client_identity_sale_claim_v155(
    lower(current_setting('v155.sale_claim_three')::jsonb->>'claim_token'),'sale-device-lowercase',
    current_setting('v155.sale_consume_request')::uuid
  )
),true);
reset role;
select pg_temp.v155_assert(
  current_setting('v155.lowercase_sale_consume_count')::integer=0
  and exists(select 1 from public.client_identity_claim_grants_v155 grant_row
    where grant_row.request_id=current_setting('v155.sale_claim_request_three')::uuid
      and grant_row.failed_attempts=0 and grant_row.locked_at is null
      and grant_row.consumed_at is null),
  'lowercase_sale_claim_is_rejected_without_state_change'
);
set local role anon;
select set_config('v155.sale_session',(
  select to_jsonb(consumed)::text from public.consume_client_identity_sale_claim_v155(
    current_setting('v155.sale_claim_three')::jsonb->>'claim_token','sale-device',
    current_setting('v155.sale_consume_request')::uuid
  ) consumed
),true);
select set_config('v155.sale_session_replay',(
  select to_jsonb(consumed)::text from public.consume_client_identity_sale_claim_v155(
    current_setting('v155.sale_claim_three')::jsonb->>'claim_token','sale-device',
    current_setting('v155.sale_consume_request')::uuid
  ) consumed
),true);
do $sale_claim_rebind_and_transfer_denied$
begin
  begin
    perform public.begin_client_identity_transfer_v155(
      current_setting('v155.sale_session')::jsonb->>'session_token','global-device'
    );
    raise exception 'v155_organization_session_started_global_transfer';
  exception when raise_exception then
    if sqlerrm<>'transfer_unavailable' then raise; end if;
  end;
end
$sale_claim_rebind_and_transfer_denied$;
select pg_temp.v155_assert(
  (select count(*)=0 from public.consume_client_identity_sale_claim_v155(
    current_setting('v155.sale_claim_three')::jsonb->>'claim_token','sale-device',
    current_setting('v155.sale_consume_other_request')::uuid
  )),
  'sale_claim_different_consumer_request_after_consume_returns_no_rows'
);
reset role;
set local role service_role;
select set_config('v155.sale_inspect_after_consume',(
  select count(*)::text from public.inspect_client_identity_sale_claim_v155(
    current_setting('v155.sale_claim_three')::jsonb->>'claim_token',
    current_setting('v155.sale_consume_request')::uuid
  )
),true);
reset role;
select pg_temp.v155_assert(
  current_setting('v155.sale_claim_request_three')::uuid
    <>current_setting('v155.sale_consume_request')::uuid
  and current_setting('v155.sale_consume_request')::uuid
    <>current_setting('v155.sale_consume_other_request')::uuid
  and current_setting('v155.sale_session')::jsonb->>'session_scope'='organization'
  and (current_setting('v155.sale_session')::jsonb->>'replayed')::boolean=false
  and (current_setting('v155.sale_session_replay')::jsonb->>'replayed')::boolean=true
  and current_setting('v155.sale_session')::jsonb->>'account_ref'~'^ptac_[0-9a-f]{64}$'
  and current_setting('v155.sale_session')::jsonb->>'organization_ref'~'^ptorg_[0-9a-f]{64}$'
  and current_setting('v155.sale_session')::jsonb->>'revision'~'^ptrv_[0-9a-f]{64}$'
  and current_setting('v155.sale_session')::jsonb->>'session_token'
    =current_setting('v155.sale_session_replay')::jsonb->>'session_token'
  and current_setting('v155.sale_session')::jsonb->>'account_ref'
    =current_setting('v155.sale_session_replay')::jsonb->>'account_ref'
  and current_setting('v155.sale_session')::jsonb->>'organization_ref'
    =current_setting('v155.sale_session_replay')::jsonb->>'organization_ref'
  and current_setting('v155.sale_session')::jsonb->>'revision'
    =current_setting('v155.sale_session_replay')::jsonb->>'revision'
  and current_setting('v155.sale_inspect')::jsonb->>'account_ref'
    =current_setting('v155.sale_session')::jsonb->>'account_ref'
  and current_setting('v155.sale_inspect')::jsonb->>'organization_ref'
    =current_setting('v155.sale_session')::jsonb->>'organization_ref'
  and current_setting('v155.sale_inspect')::jsonb->>'revision'
    =current_setting('v155.sale_session')::jsonb->>'revision'
  and exists(select 1 from public.client_identity_claim_grants_v155 grant_row
    where grant_row.request_id=current_setting('v155.sale_claim_request_three')::uuid
      and grant_row.consume_request_id=current_setting('v155.sale_consume_request')::uuid
      and grant_row.consumed_at is not null and grant_row.consumed_by_session_id is not null)
  and current_setting('v155.sale_inspect_after_consume')::integer=0,
  'standalone_sale_claim_is_one_time_stable_referenced_and_replay_safe'
);

select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub',current_setting('v155.owner'),true);
set local role authenticated;
do $consumed_issuance_is_terminal$
begin
  begin
    perform public.issue_client_identity_sale_claim_v155(
      current_setting('v155.org')::uuid,current_setting('v155.sale')::uuid,
      current_setting('v155.sale_claim_request_three')::uuid,10
    );
    raise exception 'v155_consumed_sale_issuance_reissued';
  exception when raise_exception then
    if sqlerrm<>'client_claim_already_consumed' then raise; end if;
  end;
end
$consumed_issuance_is_terminal$;
reset role;

set local role anon;
select pg_temp.v155_assert(
  (select count(*)=2 and bool_and(booking.manage_token is null and booking.payment_url is null)
   from public.get_client_bookings_v3(
     current_setting('v155.bootstrap')::jsonb->>'session_token'
   ) booking),
  'v155_booking_reader_hides_manage_and_payment_tokens'
);
reset role;

select pg_temp.v155_assert(
  exists(select 1 from public.client_identity_sessions_v155 session_row
    where session_row.token_hash=encode(extensions.digest(
      current_setting('v155.upgraded')::jsonb->>'session_token','sha256'),'hex')
      and session_row.session_scope='account' and session_row.claimed_booking_id is null
      and session_row.organization_id is null),
  'account_session_has_no_booking_or_organization_scope'
);

set local role anon;
select set_config('v155.transfer_locked',(
  select to_jsonb(created)::text from public.begin_client_identity_transfer_v155(
    current_setting('v155.upgraded')::jsonb->>'session_token','v155-locked-device'
  ) created
),true);
select pg_temp.v155_assert(
  current_setting('v155.transfer_locked')::jsonb->>'transfer_code'
    ~'^PTX1-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$',
  'transfer_code_uses_ptx1_64_bit_format'
);
do $transfer_approval_lockout$
declare
  v_attempt integer;
  v_result jsonb;
begin
  for v_attempt in 1..5 loop
    v_result:=public.approve_client_identity_transfer_v155(
      current_setting('v155.upgraded')::jsonb->>'session_token',current_setting('v155.transfer_locked')::jsonb->>'transfer_token',
      case when v_attempt=1 then repeat('c',64) else 'PTX1-CCCC-CCCC-CCCC-CCCC' end
    );
    if v_result->>'status'<>'unavailable' then
      raise exception 'v155_wrong_transfer_code_available';
    end if;
  end loop;
end
$transfer_approval_lockout$;
reset role;
select pg_temp.v155_assert(
  exists(select 1 from public.client_identity_transfers_v155 transfer_row
    where transfer_row.transfer_token_hash=encode(extensions.digest(
      current_setting('v155.transfer_locked')::jsonb->>'transfer_token','sha256'),'hex')
      and transfer_row.failed_attempts=5 and transfer_row.locked_at is not null),
  'fifth_wrong_transfer_approval_locks_transfer'
);
set local role anon;
select set_config('v155.locked_approval',public.approve_client_identity_transfer_v155(
  current_setting('v155.upgraded')::jsonb->>'session_token',
  current_setting('v155.transfer_locked')::jsonb->>'transfer_token',
  current_setting('v155.transfer_locked')::jsonb->>'transfer_code'
)::text,true);
select pg_temp.v155_assert(
  current_setting('v155.locked_approval')::jsonb->>'status'='unavailable',
  'locked_transfer_rejects_correct_code'
);

select set_config('v155.transfer',(
  select to_jsonb(created)::text from public.begin_client_identity_transfer_v155(
    current_setting('v155.upgraded')::jsonb->>'session_token','v155-new-device'
  ) created
),true);
select pg_temp.v155_assert(
  current_setting('v155.transfer')::jsonb->>'transfer_code'
    ~'^PTX1-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$',
  'fresh_transfer_code_uses_ptx1_64_bit_format'
);
select pg_temp.v155_assert(
  (select count(*)=0 from public.consume_client_identity_transfer_v155(
    current_setting('v155.transfer')::jsonb->>'transfer_token',
    'PTX1-DDDD-DDDD-DDDD-DDDD','attacker'
  )),
  'wrong_transfer_consume_returns_no_rows'
);
reset role;
select pg_temp.v155_assert(
  exists(select 1 from public.client_identity_transfers_v155 transfer_row
    where transfer_row.transfer_token_hash=encode(extensions.digest(
      current_setting('v155.transfer')::jsonb->>'transfer_token','sha256'),'hex')
      and transfer_row.failed_attempts=1 and transfer_row.locked_at is null),
  'wrong_transfer_consume_attempt_is_persisted'
);
set local role anon;
select set_config('v155.approved',public.approve_client_identity_transfer_v155(
  current_setting('v155.upgraded')::jsonb->>'session_token',
  current_setting('v155.transfer')::jsonb->>'transfer_token',
  current_setting('v155.transfer')::jsonb->>'transfer_code'
)::text,true);
select set_config('v155.consumed',(
  select to_jsonb(consumed)::text from public.consume_client_identity_transfer_v155(
    current_setting('v155.transfer')::jsonb->>'transfer_token',
    current_setting('v155.transfer')::jsonb->>'transfer_code','v155-new-device'
  ) consumed
),true);
select set_config('v155.consumed_replay',(
  select to_jsonb(consumed)::text from public.consume_client_identity_transfer_v155(
    current_setting('v155.transfer')::jsonb->>'transfer_token',
    current_setting('v155.transfer')::jsonb->>'transfer_code','v155-new-device'
  ) consumed
),true);
reset role;

select pg_temp.v155_assert(
  current_setting('v155.approved')::jsonb->>'status'='approved'
  and (current_setting('v155.consumed')::jsonb->>'replayed')::boolean=false
  and (current_setting('v155.consumed_replay')::jsonb->>'replayed')::boolean=true
  and current_setting('v155.consumed')::jsonb->>'session_token'
      =current_setting('v155.consumed_replay')::jsonb->>'session_token'
  and (select count(*)=1 from public.client_identity_sessions_v155 session_row
       where session_row.token_hash=encode(extensions.digest(
         current_setting('v155.consumed')::jsonb->>'session_token','sha256'),'hex')),
  'one_time_transfer_is_bound_and_idempotent'
);

insert into public.organization_benefit_settings(organization_id,enabled,enabled_at,enabled_by)
values(current_setting('v155.org')::uuid,true,now(),current_setting('v155.owner')::uuid);
insert into public.benefit_products(
  id,organization_id,name,kind,sale_price_rub,visits_count,validity_days,created_by
) values(
  current_setting('v155.product')::uuid,current_setting('v155.org')::uuid,
  'V155 visit pass','visit_pass',3100,2,30,current_setting('v155.owner')::uuid
);
insert into public.client_benefit_instruments(
  id,organization_id,product_id,client_account_id,request_id,public_code,
  product_snapshot,remaining_visits,expires_on,issued_by
) values(
  current_setting('v155.instrument')::uuid,current_setting('v155.org')::uuid,
  current_setting('v155.product')::uuid,current_setting('v155.account')::uuid,
  gen_random_uuid(),'V155-SECURE-CODE',jsonb_build_object(
    'name','V155 visit pass','kind','visit_pass','services',jsonb_build_array(
      jsonb_build_object('service_id',current_setting('v155.service')::uuid)
    )
  ),2,current_date+30,current_setting('v155.owner')::uuid
);
set local session_replication_role=replica;
insert into public.client_benefit_instruments(
  id,organization_id,product_id,client_account_id,request_id,public_code,
  product_snapshot,remaining_visits,expires_on,issued_by
) values(
  current_setting('v155.foreign_instrument')::uuid,current_setting('v155.org')::uuid,
  current_setting('v155.product')::uuid,current_setting('v155.foreign_account')::uuid,
  gen_random_uuid(),'V155-FOREIGN-CODE',jsonb_build_object(
    'name','Foreign pass','kind','visit_pass','services',jsonb_build_array(
      jsonb_build_object('service_id',current_setting('v155.service')::uuid)
    )
  ),2,current_date+30,current_setting('v155.owner')::uuid
),(
  current_setting('v155.reject_instrument')::uuid,current_setting('v155.org')::uuid,
  current_setting('v155.product')::uuid,current_setting('v155.account')::uuid,
  gen_random_uuid(),'V155-REJECT-CODE',jsonb_build_object(
    'name','Wrong service pass','kind','visit_pass','services',jsonb_build_array(
      jsonb_build_object('service_id',gen_random_uuid())
    )
  ),2,current_date+30,current_setting('v155.owner')::uuid
);
set local session_replication_role=origin;

insert into public.commercial_sale_lines(
  organization_id,sale_id,item_kind,benefit_product_id,benefit_instrument_id,
  item_name,quantity,unit_price_minor,subtotal_minor,discount_minor,total_minor
) values(
  current_setting('v155.org')::uuid,current_setting('v155.sale')::uuid,'benefit_product',
  current_setting('v155.product')::uuid,current_setting('v155.instrument')::uuid,
  'V155 visit pass',1,155000,155000,0,155000
);

select set_config('v155.pre_stale_bookings',(select count(*)::text from public.bookings),true);
select set_config('v155.pre_stale_requests',(select count(*)::text from public.client_identity_booking_requests_v155),true);
select set_config('v155.pre_stale_redemptions',(select count(*)::text from public.benefit_redemptions),true);
select set_config('v155.pre_stale_ledgers',(select count(*)::text from public.benefit_ledger),true);
select set_config('v155.pre_stale_identity_audits',(select count(*)::text from public.client_identity_audit_v155),true);
select set_config('v155.pre_stale_benefit_audits',(select count(*)::text from public.benefit_audit_log),true);
set local role service_role;
do $stale_benefit_version_has_zero_side_effects$
begin
  begin
    perform public.book_client_with_benefit_v155(
      current_setting('v155.bootstrap')::jsonb->>'session_token',current_setting('v155.stale_request')::uuid,current_setting('v155.slug'),
      current_setting('v155.location')::uuid,current_setting('v155.service')::uuid,
      current_setting('v155.date_three')::date,current_setting('v155.time_three')::time,
      'V155 Client','+79990009999',1550,current_setting('v155.duration')::integer,
      current_setting('v155.benefit_ref'),2,null
    );
    raise exception 'v155_stale_benefit_version_accepted';
  exception when raise_exception then
    if sqlerrm<>'benefit_version_conflict' then raise; end if;
  end;
end
$stale_benefit_version_has_zero_side_effects$;
reset role;
select pg_temp.v155_assert(
  (select count(*) from public.bookings)=current_setting('v155.pre_stale_bookings')::bigint
  and (select count(*) from public.client_identity_booking_requests_v155)=current_setting('v155.pre_stale_requests')::bigint
  and (select count(*) from public.benefit_redemptions)=current_setting('v155.pre_stale_redemptions')::bigint
  and (select count(*) from public.benefit_ledger)=current_setting('v155.pre_stale_ledgers')::bigint
  and (select count(*) from public.client_identity_audit_v155)=current_setting('v155.pre_stale_identity_audits')::bigint
  and (select count(*) from public.benefit_audit_log)=current_setting('v155.pre_stale_benefit_audits')::bigint
  and not exists(select 1 from public.bookings booking
    where booking.request_id=current_setting('v155.stale_request')::uuid)
  and not exists(select 1 from public.client_identity_booking_requests_v155 request_row
    where request_row.request_id=current_setting('v155.stale_request')::uuid)
  and exists(select 1 from public.client_benefit_instruments instrument
    where instrument.id=current_setting('v155.instrument')::uuid
      and instrument.client_version=1 and instrument.remaining_visits=2),
  'stale_benefit_version_conflict_has_zero_side_effects'
);
set local role service_role;
select set_config('v155.booked',(
  select to_jsonb(booked)::text from public.book_client_with_benefit_v155(
    current_setting('v155.bootstrap')::jsonb->>'session_token',current_setting('v155.benefit_request')::uuid,current_setting('v155.slug'),
    current_setting('v155.location')::uuid,current_setting('v155.service')::uuid,
    current_setting('v155.date_two')::date,current_setting('v155.time_two')::time,
    'V155 Client','+79990009999',1550,current_setting('v155.duration')::integer,
    current_setting('v155.benefit_ref'),1,null
  ) booked
),true);
select set_config('v155.replayed',(
  select to_jsonb(booked)::text from public.book_client_with_benefit_v155(
    current_setting('v155.bootstrap')::jsonb->>'session_token',current_setting('v155.benefit_request')::uuid,current_setting('v155.slug'),
    current_setting('v155.location')::uuid,current_setting('v155.service')::uuid,
    current_setting('v155.date_two')::date,current_setting('v155.time_two')::time,
    'V155 Client','+79990009999',1550,current_setting('v155.duration')::integer,
    current_setting('v155.benefit_ref'),1,null
  ) booked
),true);
do $atomic_failures$
begin
  begin
    perform public.book_client_with_benefit_v155(
      current_setting('v155.bootstrap')::jsonb->>'session_token',current_setting('v155.benefit_request')::uuid,current_setting('v155.slug'),
      current_setting('v155.location')::uuid,current_setting('v155.service')::uuid,
      current_setting('v155.date_two')::date,current_setting('v155.time_two')::time,
      'Changed Client','+79990009999',1550,current_setting('v155.duration')::integer,
      current_setting('v155.benefit_ref'),1,null
    );
    raise exception 'v155_changed_request_accepted';
  exception when unique_violation then
    if sqlerrm<>'client_benefit_booking_request_conflict' then raise; end if;
  end;
  begin
    perform public.book_client_with_benefit_v155(
      current_setting('v155.bootstrap')::jsonb->>'session_token',current_setting('v155.failed_request')::uuid,current_setting('v155.slug'),
      current_setting('v155.location')::uuid,current_setting('v155.service')::uuid,
      current_setting('v155.date_two')::date,current_setting('v155.time_two')::time,
      'V155 Client','+79990009999',1550,current_setting('v155.duration')::integer,
      current_setting('v155.foreign_benefit_ref'),1,null
    );
    raise exception 'v155_foreign_benefit_accepted';
  exception when raise_exception then
    if sqlerrm<>'benefit_not_available' then raise; end if;
  end;
  begin
    perform public.book_client_with_benefit_v155(
      current_setting('v155.bootstrap')::jsonb->>'session_token',current_setting('v155.atomic_request')::uuid,current_setting('v155.slug'),
      current_setting('v155.location')::uuid,current_setting('v155.service')::uuid,
      current_setting('v155.date_three')::date,current_setting('v155.time_three')::time,
      'V155 Client','+79990009999',1550,current_setting('v155.duration')::integer,
      current_setting('v155.reject_benefit_ref'),1,null
    );
    raise exception 'v155_post_create_benefit_failure_accepted';
  exception when raise_exception then
    if sqlerrm<>'benefit_not_available' then raise; end if;
  end;
end
$atomic_failures$;
reset role;

set local role anon;
do $legacy_public_benefit_denied$
begin
  begin
    perform public.book_minuta_appointment_with_benefit_v115(
      gen_random_uuid(),current_setting('v155.slug'),current_setting('v155.location')::uuid,
      current_setting('v155.service')::uuid,current_setting('v155.date_two')::date,
      current_setting('v155.time_two')::time,'Legacy Client','+79990001555','V155-SECURE-CODE'
    );
    raise exception 'v155_legacy_public_benefit_accepted';
  exception when raise_exception then
    if sqlerrm<>'benefit_not_available' then raise; end if;
  end;
end
$legacy_public_benefit_denied$;
reset role;

select pg_temp.v155_assert(
  current_setting('v155.booked')::jsonb->>'result_code'='ok'
  and current_setting('v155.booked')::jsonb->>'booking_code' is not null
  and current_setting('v155.booked')::jsonb->>'benefit_ref'=current_setting('v155.benefit_ref')
  and (current_setting('v155.booked')::jsonb->>'benefit_version')::integer=2
  and (current_setting('v155.booked')::jsonb->>'replayed')::boolean=false
  and (current_setting('v155.replayed')::jsonb->>'replayed')::boolean=true
  and current_setting('v155.replayed')::jsonb->>'benefit_ref'
    =current_setting('v155.booked')::jsonb->>'benefit_ref'
  and current_setting('v155.replayed')::jsonb->>'benefit_version'
    =current_setting('v155.booked')::jsonb->>'benefit_version'
  and (select remaining_visits=1 and client_version=2 from public.client_benefit_instruments
       where id=current_setting('v155.instrument')::uuid)
  and (select count(*)=1 and bool_and(benefit_version=2)
       from public.client_identity_booking_requests_v155
       where request_id=current_setting('v155.benefit_request')::uuid)
  and (select count(*)=1 from public.benefit_redemptions redemption
       join public.client_identity_booking_requests_v155 request_row
         on request_row.redemption_id=redemption.id
       where request_row.request_id=current_setting('v155.benefit_request')::uuid)
  and not exists(select 1 from public.bookings
       where request_id in(current_setting('v155.failed_request')::uuid,current_setting('v155.atomic_request')::uuid))
  and (select remaining_visits=2 from public.client_benefit_instruments
       where id=current_setting('v155.reject_instrument')::uuid)
  and not exists(select 1 from public.client_identity_booking_requests_v155
       where request_id=current_setting('v155.atomic_request')::uuid),
  'atomic_benefit_booking_and_replay'
);

set local role anon;
select set_config('v155.commerce',public.get_client_commerce_v155(
  current_setting('v155.bootstrap')::jsonb->>'session_token'
)::text,true);
reset role;
select pg_temp.v155_assert(
  jsonb_array_length(current_setting('v155.commerce')::jsonb->'benefits')=2
  and current_setting('v155.commerce')::jsonb->>'account_ref'~'^ptac_[0-9a-f]{64}$'
  and current_setting('v155.commerce')::jsonb->>'revision'~'^ptrv_[0-9a-f]{64}$'
  and exists(select 1 from jsonb_array_elements(
      current_setting('v155.commerce')::jsonb->'sales') sale
    where sale->>'purchase_ref'~'^ptpu_[0-9a-f]{64}$'
      and sale->>'organization_ref'~'^ptorg_[0-9a-f]{64}$'
      and sale->'line'->>'benefit_ref'=current_setting('v155.benefit_ref'))
  and exists(select 1 from jsonb_array_elements(
      current_setting('v155.commerce')::jsonb->'benefits') benefit
    where benefit->>'benefit_ref'=current_setting('v155.benefit_ref')
      and (benefit->>'version')::integer=2
      and benefit->>'purchase_ref'~'^ptpu_[0-9a-f]{64}$'
      and benefit->>'organization_ref'~'^ptorg_[0-9a-f]{64}$'
      and exists(select 1 from jsonb_array_elements(benefit->'eligible_services') eligible
        where eligible->>'service_ref'~'^pts_[0-9a-f]{64}$'
          and eligible->>'provider_ref'~'^ptm_[0-9a-f]{64}$')
      and exists(select 1 from jsonb_array_elements(benefit->'events') event
        where event->>'event_ref'~'^ptev_[0-9a-f]{64}$'
          and event->>'service_ref'~'^pts_[0-9a-f]{64}$'))
  and not (current_setting('v155.commerce')::jsonb::text like
    '%'||current_setting('v155.foreign_benefit_ref')||'%')
  and (current_setting('v155.commerce')::jsonb::text like
    '%'||current_setting('v155.benefit_ref')||'%')
  and not (current_setting('v155.commerce')::jsonb::text like '%V155-SECURE-CODE%')
  and not (current_setting('v155.commerce')::jsonb::text like '%client_account_id%'),
  'commerce_is_own_and_sanitized'
);

insert into public.client_identity_sessions_v155(
  client_account_id,token_hash,session_scope,session_source,created_at,expires_at,revoked_at
) values(
  current_setting('v155.account')::uuid,
  encode(extensions.digest(repeat('8',64),'sha256'),'hex'),
  'account','promotion',now()-interval '2 days',now()-interval '1 day',null
),(
  current_setting('v155.account')::uuid,
  encode(extensions.digest(repeat('9',64),'sha256'),'hex'),
  'account','promotion',now()-interval '1 minute',now()+interval '1 day',now()
);
set local role anon;
do $expired_and_revoked_sessions_denied$
begin
  begin
    perform public.get_client_identity_context_v155(repeat('8',64));
    raise exception 'v155_expired_session_accepted';
  exception when raise_exception then
    if sqlerrm<>'invalid_client_identity_session' then raise; end if;
  end;
  begin
    perform public.get_client_identity_context_v155(repeat('9',64));
    raise exception 'v155_revoked_session_accepted';
  exception when raise_exception then
    if sqlerrm<>'invalid_client_identity_session' then raise; end if;
  end;
  if not public.revoke_client_identity_session_v155(
    current_setting('v155.consumed')::jsonb->>'session_token'
  ) then
    raise exception 'v155_live_session_not_revoked';
  end if;
  begin
    perform public.get_client_identity_context_v155(
      current_setting('v155.consumed')::jsonb->>'session_token'
    );
    raise exception 'v155_api_revoked_session_accepted';
  exception when raise_exception then
    if sqlerrm<>'invalid_client_identity_session' then raise; end if;
  end;
end
$expired_and_revoked_sessions_denied$;
reset role;

rollback;
