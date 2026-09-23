\set ON_ERROR_STOP on
-- Isolated full-schema test database only. Synthetic rows are rolled back.
begin;
set local statement_timeout='90s';
set local lock_timeout='15s';
set local client_min_messages=error;
set local search_path=public,extensions,pg_catalog;

create function pg_temp.v181_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'v181_assert:%',label; end if; end $$;
create table pg_temp.v181_fixture(
  owner_id uuid,organization_id uuid,location_id uuid,short_service_id uuid,healthy_service_id uuid,
  warehouse_id uuid,short_item_id uuid,healthy_item_id uuid,healthy_booking_id uuid
) on commit drop;

do $fixture$
declare
  v_owner uuid:=gen_random_uuid(); v_organization uuid:=gen_random_uuid(); v_location uuid:=gen_random_uuid();
  v_short_service uuid:=gen_random_uuid(); v_healthy_service uuid:=gen_random_uuid();
  v_warehouse uuid:=gen_random_uuid(); v_short_item uuid:=gen_random_uuid(); v_healthy_item uuid:=gen_random_uuid();
  v_healthy_booking uuid:=gen_random_uuid();
begin
  insert into pg_temp.v181_fixture values(v_owner,v_organization,v_location,v_short_service,v_healthy_service,
    v_warehouse,v_short_item,v_healthy_item,v_healthy_booking);

  set local session_replication_role=replica;
  insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values(v_owner,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
    v_owner::text||'@example.invalid',now(),'{}','{}',now(),now());
  set local session_replication_role=origin;
  insert into public.performer_profiles(id,display_name) values(v_owner,'V181 synthetic owner');
  insert into public.organizations(id,name,public_slug,status,public_booking_enabled,created_by)
  values(v_organization,'V181 synthetic organization','v181-'||replace(v_organization::text,'-',''),'active',true,v_owner);
  insert into public.organization_memberships(organization_id,user_id,role,is_bookable,active,created_by)
  values(v_organization,v_owner,'owner',true,true,v_owner);
  insert into public.locations(id,organization_id,name,timezone,address,active,is_primary)
  values(v_location,v_organization,'V181 synthetic location','Europe/Samara','Synthetic address',true,true);
  insert into public.services(id,performer_id,name,duration_minutes,price_rub,active) values
    (v_short_service,v_owner,'V181 shortfall service',60,1000,true),
    (v_healthy_service,v_owner,'V181 healthy service',60,1000,true);
  insert into public.booking_policies(performer_id,auto_complete_visits,auto_complete_payment_method)
  values(v_owner,true,'unpaid');
  insert into public.provider_schedule(performer_id,weekday,enabled,start_time,end_time,slot_interval_minutes)
  select v_owner,day,true,'09:00','20:00',15 from generate_series(1,7) day;

  perform set_config('request.jwt.claim.sub',v_owner::text,true);
  perform public.set_minuta_inventory_settings(v_organization,true,true);
  insert into public.inventory_items(id,organization_id,name,sku,unit,low_stock_threshold,active,created_by) values
    (v_short_item,v_organization,'V181 short material','V181-SHORT','piece',0,true,v_owner),
    (v_healthy_item,v_organization,'V181 healthy material','V181-HEALTHY','piece',0,true,v_owner);
  insert into public.inventory_warehouses(id,organization_id,location_id,name,active,created_by)
  values(v_warehouse,v_organization,v_location,'V181 synthetic warehouse',true,v_owner);
  perform public.apply_minuta_stock_movement(v_organization,v_warehouse,v_short_item,'receipt',1,null,
    'V181 synthetic short stock',gen_random_uuid());
  perform public.apply_minuta_stock_movement(v_organization,v_warehouse,v_healthy_item,'receipt',1,null,
    'V181 synthetic healthy stock',gen_random_uuid());
  perform public.set_minuta_inventory_service_usage(v_organization,v_short_service,v_short_item,2);
  perform public.set_minuta_inventory_service_usage(v_organization,v_healthy_service,v_healthy_item,1);

  perform set_config('minuta.booking_organization',v_organization::text,true);
  perform set_config('minuta.booking_location',v_location::text,true);
  insert into public.bookings(id,booking_code,manage_token,performer_id,service_id,client_name,client_phone,
    booking_date,booking_time,duration_minutes,original_price_rub,total_price_rub,status,
    deposit_amount_rub,payment_status,payment_url,booking_policy_snapshot)
  select gen_random_uuid(),'V181-'||lpad(n::text,4,'0'),gen_random_uuid(),v_owner,v_short_service,
    'V181 synthetic client','79990000001',current_date-400+n,'10:00',60,1000,1000,
    'confirmed',0,'not_required','','{}'::jsonb
  from generate_series(1,201) n;
  insert into public.bookings(id,booking_code,manage_token,performer_id,service_id,client_name,client_phone,
    booking_date,booking_time,duration_minutes,original_price_rub,total_price_rub,status,
    deposit_amount_rub,payment_status,payment_url,booking_policy_snapshot)
  values(v_healthy_booking,'V181-HEALTHY',gen_random_uuid(),v_owner,v_healthy_service,
    'V181 synthetic client','79990000001',current_date-198,'10:00',60,1000,1000,
    'confirmed',0,'not_required','','{}'::jsonb);
  perform set_config('minuta.booking_organization','',true);
  perform set_config('minuta.booking_location','',true);
end $fixture$;

-- The direct outcome trigger must retain its inventory safety boundary.
do $$
declare v_booking uuid; v_owner uuid;
begin
  select booking.id,fixture.owner_id into v_booking,v_owner from public.bookings booking
  cross join pg_temp.v181_fixture fixture
  where booking.service_id=fixture.short_service_id order by booking.booking_date limit 1;
  begin
    insert into public.booking_outcomes(booking_id,performer_id,visit_status,payment_method,amount_rub)
    values(v_booking,v_owner,'completed','unpaid',0);
    raise exception 'v181_direct_shortfall_was_accepted';
  exception when sqlstate '55000' then
    if sqlerrm<>'insufficient_inventory_stock_for_completed_visit' then raise; end if;
  end;
  perform pg_temp.v181_assert(not exists(select 1 from public.booking_outcomes where booking_id=v_booking),
    'direct_shortfall_no_outcome');
end $$;

select pg_temp.v181_assert(public.process_minuta_auto_completed_visits_v106(1)=1,'healthy_after_201_shortfalls');
select pg_temp.v181_assert((select count(*)=1 from public.booking_outcomes outcome
  join pg_temp.v181_fixture fixture on outcome.booking_id=fixture.healthy_booking_id
  where outcome.visit_status='completed' and outcome.payment_method='unpaid' and outcome.amount_rub=0),
  'healthy_completed_unpaid');
select pg_temp.v181_assert((select count(*)=0 from public.booking_outcomes outcome
  join public.bookings booking on booking.id=outcome.booking_id
  join pg_temp.v181_fixture fixture on booking.service_id=fixture.short_service_id),
  'all_shortfalls_still_incomplete');
select pg_temp.v181_assert((select count(*)=1 and min(quantity_delta)=-1 from public.inventory_movements movement
  join pg_temp.v181_fixture fixture on movement.booking_id=fixture.healthy_booking_id
  where movement.movement_type='service_use'),'healthy_deducted_once');
select pg_temp.v181_assert((select quantity=1 from public.inventory_stock_balances balance
  join pg_temp.v181_fixture fixture on balance.inventory_item_id=fixture.short_item_id
    and balance.warehouse_id=fixture.warehouse_id),'short_stock_unchanged');
select pg_temp.v181_assert(public.process_minuta_auto_completed_visits_v106(1)=0,'retry_skips_shortfalls');
select pg_temp.v181_assert((select count(*)=1 from public.inventory_movements movement
  join pg_temp.v181_fixture fixture on movement.booking_id=fixture.healthy_booking_id
  where movement.movement_type='service_use'),'retry_no_duplicate_deduction');

rollback;
