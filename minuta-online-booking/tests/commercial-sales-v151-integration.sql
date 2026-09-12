\set ON_ERROR_STOP on

begin;
set local statement_timeout='90s';
set local lock_timeout='15s';
set local search_path=public,extensions,pg_catalog;

create function pg_temp.v151_assert(ok boolean,label text)
returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'v151_assert:%',label; end if; end $$;

do $test$
<<fixture>>
declare
  owner_id uuid:=gen_random_uuid();
  seller_id uuid:=gen_random_uuid();
  inactive_seller_id uuid:=gen_random_uuid();
  outsider_id uuid:=gen_random_uuid();
  organization_id uuid:=gen_random_uuid();
  foreign_organization_id uuid:=gen_random_uuid();
  location_id uuid:=gen_random_uuid();
  service_id uuid:=gen_random_uuid();
  client_id uuid:=gen_random_uuid();
  booking_id uuid:=gen_random_uuid();
  item_id uuid:=gen_random_uuid();
  warehouse_id uuid:=gen_random_uuid();
  pass_id uuid:=gen_random_uuid();
  package_id uuid:=gen_random_uuid();
  certificate_id uuid:=gen_random_uuid();
  cash_id uuid;
  bank_id uuid;
  request_id uuid:=gen_random_uuid();
  benefit_sale_request_id uuid:=gen_random_uuid();
  reserve_request_id uuid:=gen_random_uuid();
  release_request_id uuid:=gen_random_uuid();
  freeze_request_id uuid:=gen_random_uuid();
  unfreeze_request_id uuid:=gen_random_uuid();
  refund_request_id uuid:=gen_random_uuid();
  sale_id uuid;
  benefit_sale_id uuid;
  chain_instrument_id uuid;
  transaction_id uuid;
  payload jsonb;
  workspace jsonb;
  before_sales bigint;
  before_movements bigint;
  before_transactions bigint;
  hash64 text:=repeat('1',64);
  phone text:='79'||translate(substr(md5(owner_id::text),1,9),'abcdef','012345');
begin
  perform pg_temp.v151_assert(
    to_regprocedure('public.sell_minuta_commercial_product_v151(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid)') is not null,
    'sale_rpc');
  perform pg_temp.v151_assert(to_regprocedure('public.get_minuta_commerce_workspace_v151(uuid)') is not null,'workspace_rpc');
  perform pg_temp.v151_assert(
    has_function_privilege('authenticated','public.sell_minuta_commercial_product_v151(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid)','EXECUTE'),
    'authenticated_execute');
  perform pg_temp.v151_assert(
    not has_function_privilege('anon','public.sell_minuta_commercial_product_v151(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid)','EXECUTE'),
    'anon_denied');

  set local session_replication_role=replica;
  insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
    (owner_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',owner_id::text||'@example.invalid',now(),'{}','{}',now(),now()),
    (seller_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',seller_id::text||'@example.invalid',now(),'{}','{}',now(),now()),
    (inactive_seller_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',inactive_seller_id::text||'@example.invalid',now(),'{}','{}',now(),now()),
    (outsider_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',outsider_id::text||'@example.invalid',now(),'{}','{}',now(),now());
  set local session_replication_role=origin;
  insert into public.performer_profiles(id,display_name) values
    (owner_id,'V151 owner'),(seller_id,'V151 seller'),(inactive_seller_id,'V151 inactive'),(outsider_id,'V151 outsider');
  insert into public.organizations(id,name,public_slug,status,public_booking_enabled,created_by) values
    (organization_id,'V151 organization','v151-'||replace(organization_id::text,'-',''),'active',true,owner_id),
    (foreign_organization_id,'V151 foreign','v151-'||replace(foreign_organization_id::text,'-',''),'active',true,outsider_id);
  insert into public.organization_memberships(organization_id,user_id,role,is_bookable,active,created_by) values
    (organization_id,owner_id,'owner',true,true,owner_id),
    (organization_id,seller_id,'specialist',true,true,owner_id),
    (organization_id,inactive_seller_id,'specialist',true,false,owner_id),
    (foreign_organization_id,outsider_id,'owner',true,true,outsider_id);
  insert into public.locations(id,organization_id,name,timezone,address,active,is_primary)
    values(location_id,organization_id,'V151 location','Europe/Samara','V151 address',true,true);
  insert into public.services(id,performer_id,name,duration_minutes,price_rub,active)
    values(service_id,seller_id,'V151 service',60,2500,true);
  insert into public.client_accounts(id,normalized_phone,access_code_hash)
    values(client_id,phone,hash64);
  perform set_config('minuta.booking_organization',organization_id::text,true);
  perform set_config('minuta.booking_location',location_id::text,true);
  insert into public.bookings(
    id,booking_code,manage_token,performer_id,service_id,client_name,client_phone,client_account_id,
    booking_date,booking_time,duration_minutes,original_price_rub,total_price_rub,status,deposit_amount_rub,
    payment_status,payment_url,provider_note,booking_policy_snapshot
  ) values(
    booking_id,'V151-'||substr(replace(gen_random_uuid()::text,'-',''),1,10),gen_random_uuid(),seller_id,service_id,
    'V151 client',phone,client_id,current_date,time '15:00',60,2500,2500,'confirmed',0,
    'not_required','','','{}'
  );
  perform set_config('minuta.booking_organization','',true);
  perform set_config('minuta.booking_location','',true);

  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  perform public.set_minuta_finance_enabled_v133(organization_id,true);
  payload:=public.create_minuta_financial_account_v129(organization_id,gen_random_uuid(),'Основная касса','cash');
  cash_id:=(payload->>'id')::uuid;
  payload:=public.create_minuta_financial_account_v129(organization_id,gen_random_uuid(),'Расчётный счёт','bank');
  bank_id:=(payload->>'id')::uuid;
  perform public.set_minuta_benefits_enabled(organization_id,true);
  perform public.set_minuta_inventory_settings(organization_id,true,false);
  insert into public.inventory_items(id,organization_id,name,sku,unit,low_stock_threshold,active,created_by)
    values(item_id,organization_id,'Крем','V151-CREAM','piece',1,true,owner_id);
  insert into public.inventory_warehouses(id,organization_id,location_id,name,active,created_by)
    values(warehouse_id,organization_id,location_id,'Основной склад',true,owner_id);
  perform public.apply_minuta_stock_movement(organization_id,warehouse_id,item_id,'receipt',10,null,'Начальный остаток',gen_random_uuid());
  insert into public.benefit_products(id,organization_id,name,kind,sale_price_rub,face_value_rub,visits_count,validity_days,created_by) values
    (pass_id,organization_id,'Абонемент 3 визита','visit_pass',3000,0,3,90,owner_id),
    (package_id,organization_id,'Пакет 5 визитов','package',5000,0,5,120,owner_id),
    (certificate_id,organization_id,'Сертификат 2500','certificate',2500,2500,0,180,owner_id);

  payload:=public.sell_minuta_commercial_product_v151(
    organization_id,booking_id,client_id,seller_id,'inventory_item',null,item_id,warehouse_id,
    2,50000,10000,'cash',cash_id,request_id);
  sale_id:=(payload->>'id')::uuid;
  transaction_id:=(payload->>'transaction_id')::uuid;
  perform pg_temp.v151_assert((payload->>'seller_id')::uuid=seller_id and (payload->>'total_minor')::bigint=90000,'sale_result');
  perform pg_temp.v151_assert((select commercial_sales.seller_id=fixture.seller_id and commercial_sales.booking_id=fixture.booking_id and commercial_sales.client_account_id=fixture.client_id and commercial_sales.subtotal_minor=100000 and commercial_sales.discount_minor=10000 and commercial_sales.total_minor=90000 from public.commercial_sales where id=fixture.sale_id),'sale_fields');
  perform pg_temp.v151_assert((select sale_line.quantity=2 and sale_line.unit_price_minor=50000 and sale_line.discount_minor=10000 from public.commercial_sale_lines sale_line where sale_line.sale_id=fixture.sale_id),'sale_line_fields');
  perform pg_temp.v151_assert((select balance.quantity=8 from public.inventory_stock_balances balance where balance.warehouse_id=fixture.warehouse_id and balance.inventory_item_id=fixture.item_id),'inventory_decrement');
  perform pg_temp.v151_assert((select sum(posting.amount_minor) filter(where posting.side='debit')=90000 and sum(posting.amount_minor) filter(where posting.side='credit')=90000 from public.financial_postings posting where posting.transaction_id=fixture.transaction_id),'cash_balanced');
  perform pg_temp.v151_assert((select explanation->>'seller_id'=fixture.seller_id::text from public.financial_transactions where id=fixture.transaction_id),'ledger_seller');
  perform pg_temp.v151_assert((select count(*)=1 from public.commercial_audit_log where subject_id=fixture.sale_id and details->>'seller_id'=fixture.seller_id::text),'audit_seller');

  payload:=public.sell_minuta_commercial_product_v151(
    organization_id,booking_id,client_id,seller_id,'inventory_item',null,item_id,warehouse_id,
    2,50000,10000,'cash',cash_id,request_id);
  perform pg_temp.v151_assert((payload->>'replayed')::boolean,'sale_replayed');
  perform pg_temp.v151_assert((select count(*)=1 from public.commercial_sales where organization_id=fixture.organization_id and request_id=fixture.request_id),'single_sale');
  perform pg_temp.v151_assert((select balance.quantity=8 from public.inventory_stock_balances balance where balance.warehouse_id=fixture.warehouse_id and balance.inventory_item_id=fixture.item_id),'single_stock_write_off');
  perform pg_temp.v151_assert((select count(*)=1 from public.financial_transactions where organization_id=fixture.organization_id and operation_type='commercial_sale' and source_id=fixture.sale_id),'single_cash_transaction');

  begin
    perform public.sell_minuta_commercial_product_v151(
      organization_id,booking_id,client_id,owner_id,'inventory_item',null,item_id,warehouse_id,
      2,50000,10000,'cash',cash_id,request_id);
    raise exception 'v151_changed_replay_accepted';
  exception when unique_violation then null;
  end;

  perform public.sell_minuta_commercial_product_v151(
    organization_id,null,null,owner_id,'inventory_item',null,item_id,warehouse_id,
    1,25000,0,'manual',bank_id,gen_random_uuid());
  perform pg_temp.v151_assert((select count(*)=1 from public.commercial_sales where organization_id=fixture.organization_id and booking_id is null and client_account_id is null and seller_id=fixture.owner_id and payment_method='manual' and payment_account_id=fixture.bank_id),'standalone_manual_sale');

  payload:=public.sell_minuta_commercial_product_v151(
    organization_id,booking_id,client_id,seller_id,'benefit_product',pass_id,null,null,
    1,300000,0,'cash',cash_id,benefit_sale_request_id);
  benefit_sale_id:=(payload->>'id')::uuid;
  select sale_line.benefit_instrument_id into chain_instrument_id
    from public.commercial_sale_lines sale_line where sale_line.sale_id=benefit_sale_id;
  payload:=public.sell_minuta_commercial_product_v151(
    organization_id,booking_id,client_id,seller_id,'benefit_product',pass_id,null,null,
    1,300000,0,'cash',cash_id,benefit_sale_request_id);
  perform pg_temp.v151_assert((payload->>'replayed')::boolean,'benefit_sale_replayed');

  payload:=public.apply_minuta_benefit_v149(
    organization_id,chain_instrument_id,booking_id,'reserve',null,reserve_request_id);
  payload:=public.apply_minuta_benefit_v149(
    organization_id,chain_instrument_id,booking_id,'reserve',null,reserve_request_id);
  perform pg_temp.v151_assert((payload->>'replayed')::boolean,'benefit_reserve_replayed');
  payload:=public.apply_minuta_benefit_v149(
    organization_id,chain_instrument_id,booking_id,'release',null,release_request_id);
  payload:=public.apply_minuta_benefit_v149(
    organization_id,chain_instrument_id,booking_id,'release',null,release_request_id);
  perform pg_temp.v151_assert((payload->>'replayed')::boolean,'benefit_release_replayed');

  payload:=public.set_minuta_benefit_lifecycle_v150(
    organization_id,chain_instrument_id,'freeze','Отпуск клиента',freeze_request_id);
  payload:=public.set_minuta_benefit_lifecycle_v150(
    organization_id,chain_instrument_id,'freeze','Отпуск клиента',freeze_request_id);
  perform pg_temp.v151_assert((payload->>'replayed')::boolean,'benefit_freeze_replayed');
  update public.benefit_freeze_periods set frozen_at=clock_timestamp()-interval '2 days'
    where instrument_id=chain_instrument_id and thawed_at is null;
  payload:=public.set_minuta_benefit_lifecycle_v150(
    organization_id,chain_instrument_id,'unfreeze','Клиент вернулся',unfreeze_request_id);
  payload:=public.set_minuta_benefit_lifecycle_v150(
    organization_id,chain_instrument_id,'unfreeze','Клиент вернулся',unfreeze_request_id);
  perform pg_temp.v151_assert((payload->>'replayed')::boolean,'benefit_unfreeze_replayed');

  payload:=public.refund_minuta_commercial_sale_v147(
    organization_id,benefit_sale_id,1,300000,'Возврат абонемента',refund_request_id);
  payload:=public.refund_minuta_commercial_sale_v147(
    organization_id,benefit_sale_id,1,300000,'Возврат абонемента',refund_request_id);
  perform pg_temp.v151_assert((payload->>'replayed')::boolean,'benefit_refund_replayed');
  perform pg_temp.v151_assert((select count(*)=1 from public.commercial_sales where id=benefit_sale_id and request_id=benefit_sale_request_id and status='refunded' and refunded_minor=total_minor),'benefit_sale_single_refunded');
  perform pg_temp.v151_assert((select count(*)=1 from public.client_benefit_instruments where id=chain_instrument_id and status='cancelled'),'benefit_instrument_cancelled');
  perform pg_temp.v151_assert((select count(*)=2 from public.benefit_application_requests where instrument_id=chain_instrument_id),'benefit_application_requests_once');
  perform pg_temp.v151_assert((select count(*)=2 from public.benefit_lifecycle_requests where instrument_id=chain_instrument_id),'benefit_lifecycle_requests_once');
  perform pg_temp.v151_assert((select count(*)=1 from public.benefit_freeze_periods where instrument_id=chain_instrument_id and thawed_at is not null),'benefit_freeze_closed');
  perform pg_temp.v151_assert((select count(*)=1 from public.commercial_sale_refunds where sale_id=benefit_sale_id and request_id=refund_request_id),'benefit_refund_single');
  perform pg_temp.v151_assert((select count(*)=1 from public.financial_transactions where source_type='commercial_sale' and source_id=benefit_sale_id),'benefit_sale_transaction_single');
  perform pg_temp.v151_assert((select count(*)=1 from public.financial_transactions transaction_row join public.commercial_sale_refunds refund on refund.id=transaction_row.source_id where refund.sale_id=benefit_sale_id and transaction_row.source_type='commercial_sale_refund'),'benefit_refund_transaction_single');

  perform public.sell_minuta_commercial_product_v151(organization_id,booking_id,client_id,seller_id,'benefit_product',package_id,null,null,1,500000,50000,'manual',bank_id,gen_random_uuid());
  perform public.sell_minuta_commercial_product_v151(organization_id,booking_id,client_id,seller_id,'benefit_product',certificate_id,null,null,1,250000,0,'cash',cash_id,gen_random_uuid());
  perform pg_temp.v151_assert((select count(*)=3 from public.client_benefit_instruments where organization_id=fixture.organization_id and client_account_id=fixture.client_id),'all_benefit_kinds_issued');

  workspace:=public.get_minuta_commerce_workspace_v151(organization_id);
  perform pg_temp.v151_assert(jsonb_array_length(workspace->'sellers')=2,'active_sellers_only');
  perform pg_temp.v151_assert((workspace->'sellers')@>jsonb_build_array(jsonb_build_object('id',seller_id,'name','V151 seller','role','специалист')),'seller_workspace');
  perform pg_temp.v151_assert((workspace->'bookings'->0)?'performer_id','booking_performer');
  perform pg_temp.v151_assert((workspace->'sales')@>jsonb_build_array(jsonb_build_object('id',sale_id,'seller_id',seller_id,'seller_name','V151 seller')),'sale_seller_workspace');
  payload:=public.get_minuta_client_commerce_v147(organization_id,client_id);
  perform pg_temp.v151_assert(jsonb_array_length(payload->'sales')=4 and jsonb_array_length(payload->'benefits')=3,'client_card_history');

  before_sales:=(select count(*) from public.commercial_sales where organization_id=fixture.organization_id);
  before_movements:=(select count(*) from public.inventory_movements where organization_id=fixture.organization_id);
  before_transactions:=(select count(*) from public.financial_transactions where organization_id=fixture.organization_id);
  begin
    perform public.sell_minuta_commercial_product_v151(
      organization_id,null,null,inactive_seller_id,'inventory_item',null,item_id,warehouse_id,
      1,10000,0,'cash',cash_id,gen_random_uuid());
    raise exception 'v151_inactive_seller_accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.sell_minuta_commercial_product_v151(
      organization_id,null,null,outsider_id,'inventory_item',null,item_id,warehouse_id,
      1,10000,0,'cash',cash_id,gen_random_uuid());
    raise exception 'v151_foreign_seller_accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.sell_minuta_commercial_product_v151(
      organization_id,null,null,seller_id,'inventory_item',null,item_id,warehouse_id,
      1000,10000,0,'cash',cash_id,gen_random_uuid());
    raise exception 'v151_insufficient_stock_accepted';
  exception when others then
    if sqlerrm not like '%insufficient%' and sqlerrm not like '%negative%' then raise; end if;
  end;
  begin
    perform public.sell_minuta_commercial_product_v151(
      organization_id,null,null,seller_id,'inventory_item',null,item_id,warehouse_id,
      'NaN'::numeric,10000,0,'cash',cash_id,gen_random_uuid());
    raise exception 'v151_nan_quantity_accepted';
  exception when invalid_parameter_value then
    if sqlerrm<>'invalid_inventory_quantity' then raise; end if;
  end;
  begin
    perform public.sell_minuta_commercial_product_v151(
      organization_id,null,null,seller_id,'inventory_item',null,item_id,warehouse_id,
      1.0001,10000,0,'cash',cash_id,gen_random_uuid());
    raise exception 'v151_over_scale_quantity_accepted';
  exception when invalid_parameter_value then
    if sqlerrm<>'invalid_inventory_quantity' then raise; end if;
  end;
  begin
    perform public.sell_minuta_commercial_product_v151(
      organization_id,null,null,seller_id,'inventory_item',null,item_id,warehouse_id,
      100000000000,10000,0,'cash',cash_id,gen_random_uuid());
    raise exception 'v151_out_of_range_quantity_accepted';
  exception when invalid_parameter_value then
    if sqlerrm<>'invalid_inventory_quantity' then raise; end if;
  end;
  begin
    perform public.sell_minuta_commercial_product_v151(
      organization_id,null,null,seller_id,'inventory_item',null,item_id,warehouse_id,
      99999999999.999,100000000,0,'cash',cash_id,gen_random_uuid());
    raise exception 'v151_subtotal_overflow_accepted';
  exception when numeric_value_out_of_range then
    if sqlerrm<>'commercial_sale_subtotal_out_of_range' then raise; end if;
  end;
  perform pg_temp.v151_assert((select count(*) from public.commercial_sales where organization_id=fixture.organization_id)=before_sales,'failed_sales_atomic');
  perform pg_temp.v151_assert((select count(*) from public.inventory_movements where organization_id=fixture.organization_id)=before_movements,'failed_inventory_atomic');
  perform pg_temp.v151_assert((select count(*) from public.financial_transactions where organization_id=fixture.organization_id)=before_transactions,'failed_finance_atomic');
end
$test$;

rollback;
