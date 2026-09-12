\set ON_ERROR_STOP on

begin;
set local search_path=public,extensions,pg_catalog;
select set_config('minuta.v151_test_run_key',:'run_key',true);

create schema minuta_v151_test;
create table minuta_v151_test.fixture(
  run_key text primary key,
  owner_id uuid not null,
  seller_id uuid not null,
  organization_id uuid not null,
  client_id uuid not null,
  product_id uuid not null,
  cash_id uuid not null,
  service_id uuid not null,
  request_from_v147 uuid not null,
  request_from_v151 uuid not null,
  request_concurrent uuid not null
);

do $setup$
declare
  v_run text:=current_setting('minuta.v151_test_run_key');
  v_owner uuid:=md5(v_run||':owner')::uuid;
  v_seller uuid:=md5(v_run||':seller')::uuid;
  v_org uuid:=md5(v_run||':organization')::uuid;
  v_client uuid:=md5(v_run||':client')::uuid;
  v_product uuid:=md5(v_run||':product')::uuid;
  v_location uuid:=md5(v_run||':location')::uuid;
  v_service uuid:=md5(v_run||':service')::uuid;
  v_booking uuid:=md5(v_run||':booking')::uuid;
  v_cash uuid;
  v_payload jsonb;
  v_phone text:='79'||translate(substr(md5(v_run||':phone'),1,9),'abcdef','012345');
begin
  set local session_replication_role=replica;
  insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
    (v_owner,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',v_owner::text||'@example.invalid',now(),'{}','{}',now(),now()),
    (v_seller,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',v_seller::text||'@example.invalid',now(),'{}','{}',now(),now());
  insert into public.performer_profiles(id,display_name) values(v_owner,'V151 durable owner'),(v_seller,'V151 durable seller');
  set local session_replication_role=origin;
  insert into public.organizations(id,name,public_slug,status,public_booking_enabled,created_by)
    values(v_org,'V151 durable organization','v151-durable-'||replace(v_org::text,'-',''),'active',true,v_owner);
  insert into public.organization_memberships(organization_id,user_id,role,is_bookable,active,created_by) values
    (v_org,v_owner,'owner',true,true,v_owner),(v_org,v_seller,'specialist',true,true,v_owner);
  insert into public.client_accounts(id,normalized_phone,access_code_hash) values(v_client,v_phone,repeat('1',64));
  insert into public.locations(id,organization_id,name,timezone,address,active,is_primary)
    values(v_location,v_org,'V151 durable location','Europe/Samara','V151 durable address',true,true);
  insert into public.services(id,performer_id,name,duration_minutes,price_rub,active)
    values(v_service,v_owner,'V151 durable service',60,3000,true);
  perform set_config('minuta.booking_organization',v_org::text,true);
  perform set_config('minuta.booking_location',v_location::text,true);
  insert into public.bookings(
    id,booking_code,manage_token,performer_id,service_id,client_name,client_phone,client_account_id,
    booking_date,booking_time,duration_minutes,original_price_rub,total_price_rub,status,deposit_amount_rub,
    payment_status,payment_url,provider_note,booking_policy_snapshot
  ) values(
    v_booking,'V151D-'||substr(replace(v_booking::text,'-',''),1,10),md5(v_run||':manage')::uuid,v_owner,v_service,
    'V151 durable client',v_phone,v_client,current_date,time '15:00',60,3000,3000,'confirmed',0,
    'not_required','','','{}'
  );
  perform set_config('minuta.booking_organization','',true);
  perform set_config('minuta.booking_location','',true);
  perform set_config('request.jwt.claim.sub',v_owner::text,true);
  perform public.set_minuta_finance_enabled_v133(v_org,true);
  v_payload:=public.create_minuta_financial_account_v129(v_org,md5(v_run||':cash-request')::uuid,'V151 durable cash','cash');
  v_cash:=(v_payload->>'id')::uuid;
  perform public.set_minuta_benefits_enabled(v_org,true);
  insert into public.benefit_products(id,organization_id,name,kind,sale_price_rub,face_value_rub,visits_count,validity_days,created_by)
    values(v_product,v_org,'V151 durable pass','visit_pass',3000,0,3,90,v_owner);
  insert into minuta_v151_test.fixture values(
    v_run,v_owner,v_seller,v_org,v_client,v_product,v_cash,v_service,
    md5(v_run||':from-v147')::uuid,md5(v_run||':from-v151')::uuid,md5(v_run||':concurrent')::uuid
  );
end
$setup$;

commit;
