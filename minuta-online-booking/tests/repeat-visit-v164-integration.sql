\set ON_ERROR_STOP on
begin;
set local statement_timeout='90s';
set local lock_timeout='15s';
set local search_path=public,extensions,pg_catalog;

create function pg_temp.v164_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'v164_assert:%',label; end if; end $$;
create table pg_temp.v164_fixture(
  owner_id uuid,organization_id uuid,location_id uuid,primary_service_id uuid,addon_service_id uuid,
  source_id uuid,warehouse_id uuid,material_id uuid,phone text
) on commit drop;

do $fixture$
declare
  owner_id uuid:=gen_random_uuid(); organization_id uuid:=gen_random_uuid(); location_id uuid:=gen_random_uuid();
  primary_service_id uuid:=gen_random_uuid(); addon_service_id uuid:=gen_random_uuid(); source_id uuid:=gen_random_uuid();
  warehouse_id uuid:=gen_random_uuid(); material_id uuid:=gen_random_uuid();
  phone text:='79'||translate(substr(md5(owner_id::text),1,9),'abcdef','012345');
begin
  insert into pg_temp.v164_fixture values(owner_id,organization_id,location_id,primary_service_id,addon_service_id,source_id,warehouse_id,material_id,phone);

  set local session_replication_role=replica;
  insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values(owner_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',owner_id::text||'@example.invalid',now(),'{}','{}',now(),now());
  set local session_replication_role=origin;
  insert into public.performer_profiles(id,display_name) values(owner_id,'V164 owner');
  insert into public.organizations(id,name,public_slug,status,public_booking_enabled,created_by)
  values(organization_id,'V164 organization','v164-'||replace(organization_id::text,'-',''),'active',true,owner_id);
  insert into public.organization_memberships(organization_id,user_id,role,is_bookable,active,created_by)
  values(organization_id,owner_id,'owner',true,true,owner_id);
  insert into public.locations(id,organization_id,name,timezone,address,active,is_primary)
  values(location_id,organization_id,'V164 location','Europe/Samara','V164 address',true,true);
  insert into public.services(id,performer_id,name,duration_minutes,price_rub,active) values
    (primary_service_id,owner_id,'V164 primary',60,3000,true),(addon_service_id,owner_id,'V164 addon',30,500,true);
  insert into public.provider_schedule(performer_id,weekday,enabled,start_time,end_time,slot_interval_minutes)
  select owner_id,day,true,'09:00','20:00',15 from generate_series(1,7) day;
  perform set_config('minuta.booking_organization',organization_id::text,true);
  perform set_config('minuta.booking_location',location_id::text,true);
  insert into public.bookings(id,booking_code,manage_token,performer_id,service_id,client_name,client_phone,
    booking_date,booking_time,duration_minutes,original_price_rub,total_price_rub,status,deposit_amount_rub,payment_status,payment_url,provider_note,booking_policy_snapshot)
  values(source_id,'V164-'||substr(replace(source_id::text,'-',''),1,10),gen_random_uuid(),owner_id,primary_service_id,'V164 client',phone,
    current_date+30,'10:00',90,3500,3500,'confirmed',0,'not_required','','Исходный комментарий','{}');
  perform set_config('minuta.booking_organization','',true); perform set_config('minuta.booking_location','',true);
  delete from public.booking_session_items where booking_id=source_id;
  insert into public.booking_session_items(booking_id,performer_id,position,item_kind,service_id,title,duration_minutes,price_rub,extends_duration) values
    (source_id,owner_id,1,'primary',primary_service_id,'V164 primary',60,3000,true),
    (source_id,owner_id,2,'addon',addon_service_id,'V164 addon',30,500,true);
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  perform public.set_minuta_inventory_settings(organization_id,true,true);
  insert into public.inventory_items(id,organization_id,name,sku,unit,low_stock_threshold,active,created_by)
  values(material_id,organization_id,'V164 oil','V164-OIL','piece',1,true,owner_id);
  insert into public.inventory_warehouses(id,organization_id,location_id,name,active,created_by)
  values(warehouse_id,organization_id,location_id,'V164 warehouse',true,owner_id);
  perform public.apply_minuta_stock_movement(organization_id,warehouse_id,material_id,'receipt',10,null,'V164 initial stock',gen_random_uuid());
  perform public.set_minuta_inventory_service_usage(organization_id,primary_service_id,material_id,2);
  perform public.set_minuta_inventory_service_usage(organization_id,addon_service_id,material_id,1);
end $fixture$;

select set_config('minuta.v164_owner',owner_id::text,true),set_config('minuta.v164_source',source_id::text,true),
  set_config('minuta.v164_warehouse',warehouse_id::text,true),set_config('minuta.v164_material',material_id::text,true),
  set_config('minuta.v164_phone',phone,true)
from pg_temp.v164_fixture;
select set_config('request.jwt.claim.sub',current_setting('minuta.v164_owner'),true);
set local role authenticated;
select set_config('minuta.v164.preview',public.get_provider_repeat_visit_v164(current_setting('minuta.v164_source')::uuid)::text,true);
select pg_temp.v164_assert(current_setting('minuta.v164.preview')::jsonb->>'comment'='Исходный комментарий','comment_preview');
select pg_temp.v164_assert(jsonb_array_length(current_setting('minuta.v164.preview')::jsonb->'items')=2,'all_services_preview');
select pg_temp.v164_assert((current_setting('minuta.v164.preview')::jsonb->'materials'->0->>'quantity')::numeric=3,'materials_aggregated');
select set_config('minuta.v164.request',gen_random_uuid()::text,true);
select set_config('minuta.v164.created',public.provider_repeat_appointment_v164(
  current_setting('minuta.v164.request')::uuid,current_setting('minuta.v164_source')::uuid,
  current_setting('minuta.v164.preview')::jsonb->>'source_signature',current_date+31,'14:00',
  'V164 client',current_setting('minuta.v164.phone'),3700,'Новый комментарий'
)::text,true);
select pg_temp.v164_assert(public.provider_repeat_appointment_v164(
  current_setting('minuta.v164.request')::uuid,current_setting('minuta.v164_source')::uuid,
  current_setting('minuta.v164.preview')::jsonb->>'source_signature',current_date+31,'14:00',
  'V164 client',current_setting('minuta.v164.phone'),3700,'Новый комментарий'
)->>'booking_id'=current_setting('minuta.v164.created')::jsonb->>'booking_id','idempotent_replay');
reset role;

select pg_temp.v164_assert((select count(*)=1 from public.bookings where request_id=current_setting('minuta.v164.request')::uuid
  and duration_minutes=90 and total_price_rub=3700 and provider_note='Новый комментарий' and booking_source='provider_manual'
  and booking_policy_snapshot->>'repeat_source_id'=current_setting('minuta.v164_source')),'booking_exact');
select pg_temp.v164_assert((select count(*)=2 and sum(price_rub)=3700 from public.booking_session_items
  where booking_id=(current_setting('minuta.v164.created')::jsonb->>'booking_id')::uuid),'session_exact');
select pg_temp.v164_assert((select booking_policy_snapshot->'repeat_materials'->0->>'quantity'='3' from public.bookings
  where id=(current_setting('minuta.v164.created')::jsonb->>'booking_id')::uuid),'material_snapshot_exact');

update public.booking_session_items set price_rub=3100 where booking_id=current_setting('minuta.v164_source')::uuid and item_kind='primary';
set local role authenticated;
do $$ begin
  begin
    perform public.provider_repeat_appointment_v164(gen_random_uuid(),current_setting('minuta.v164_source')::uuid,
      current_setting('minuta.v164.preview')::jsonb->>'source_signature',current_date+31,'17:00',
      'V164 client',current_setting('minuta.v164.phone'),3700,'Новый комментарий');
    raise exception 'stale_source_accepted';
  exception when raise_exception then if sqlerrm<>'repeat_source_changed' then raise; end if; end;
end $$;
reset role;
select pg_temp.v164_assert((select count(*)=1 from public.bookings where request_id=current_setting('minuta.v164.request')::uuid),'stale_source_created_nothing');

insert into public.booking_outcomes(booking_id,performer_id,visit_status,payment_method,amount_rub)
values((current_setting('minuta.v164.created')::jsonb->>'booking_id')::uuid,current_setting('minuta.v164_owner')::uuid,'completed','cash',3700);
select pg_temp.v164_assert((select quantity=7 from public.inventory_stock_balances where warehouse_id=current_setting('minuta.v164_warehouse')::uuid and inventory_item_id=current_setting('minuta.v164_material')::uuid),'repeat_material_consumed');
select pg_temp.v164_assert((select count(*)=1 and min(quantity_delta)=-3 from public.inventory_movements
  where booking_id=(current_setting('minuta.v164.created')::jsonb->>'booking_id')::uuid and movement_type='service_use'),'one_exact_material_movement');

rollback;
