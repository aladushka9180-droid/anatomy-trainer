\set ON_ERROR_STOP on

begin;
set local statement_timeout='90s';
set local lock_timeout='15s';
set local search_path=public,extensions,pg_catalog;

create function pg_temp.v147_assert(ok boolean,label text)
returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'v147_assert:%',label; end if; end $$;

do $test$
<<fixture>>
declare
  owner_id uuid:=gen_random_uuid(); outsider_id uuid:=gen_random_uuid(); organization_id uuid:=gen_random_uuid();
  foreign_organization_id uuid:=gen_random_uuid(); location_id uuid:=gen_random_uuid(); service_id uuid:=gen_random_uuid();
  client_id uuid:=gen_random_uuid(); booking_id uuid:=gen_random_uuid(); product_id uuid:=gen_random_uuid(); item_id uuid:=gen_random_uuid(); warehouse_id uuid:=gen_random_uuid();
  cash_id uuid; benefit_sale_id uuid; inventory_sale_id uuid; rule_id uuid; payload jsonb; tx_id uuid;
  sale_request uuid:=gen_random_uuid(); inventory_request uuid:=gen_random_uuid(); refund_request uuid:=gen_random_uuid();
  hash64 text:=repeat('1',64); today_date date:=current_date;
begin
  perform pg_temp.v147_assert(to_regprocedure('public.sell_minuta_commercial_product_v147(uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid)') is not null,'sale_rpc');
  perform pg_temp.v147_assert(to_regprocedure('public.get_minuta_client_commerce_v147(uuid,uuid)') is not null,'client_rpc');
  perform pg_temp.v147_assert(has_function_privilege('authenticated','public.sell_minuta_commercial_product_v147(uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid)','EXECUTE'),'sale_authenticated');
  perform pg_temp.v147_assert(not has_function_privilege('anon','public.sell_minuta_commercial_product_v147(uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid)','EXECUTE'),'sale_anon_denied');

  set local session_replication_role=replica;
  insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
    (owner_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',owner_id::text||'@example.invalid',now(),'{}','{}',now(),now()),
    (outsider_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',outsider_id::text||'@example.invalid',now(),'{}','{}',now(),now());
  set local session_replication_role=origin;
  insert into public.performer_profiles(id,display_name) values(owner_id,'V147 owner'),(outsider_id,'V147 outsider');
  insert into public.organizations(id,name,public_slug,status,public_booking_enabled,created_by) values
    (organization_id,'V147 organization','v147-'||replace(organization_id::text,'-',''),'active',true,owner_id),
    (foreign_organization_id,'V147 foreign','v147-'||replace(foreign_organization_id::text,'-',''),'active',true,outsider_id);
  insert into public.organization_memberships(organization_id,user_id,role,is_bookable,active,created_by) values
    (organization_id,owner_id,'owner',true,true,owner_id),(foreign_organization_id,outsider_id,'owner',true,true,outsider_id);
  insert into public.locations(id,organization_id,name,timezone,address,active,is_primary) values(location_id,organization_id,'V147 location','Europe/Samara','V147 address',true,true);
  insert into public.services(id,performer_id,name,duration_minutes,price_rub,active) values(service_id,owner_id,'V147 service',60,2500,true);
  insert into public.client_accounts(id,normalized_phone,access_code_hash) values(client_id,'79990000147',hash64);
  perform set_config('minuta.booking_organization',organization_id::text,true);
  perform set_config('minuta.booking_location',location_id::text,true);
  insert into public.bookings(id,booking_code,manage_token,performer_id,service_id,client_name,client_phone,client_account_id,booking_date,booking_time,duration_minutes,original_price_rub,total_price_rub,status,deposit_amount_rub,payment_status,payment_url,provider_note,booking_policy_snapshot)
    values(booking_id,'V147-'||substr(replace(gen_random_uuid()::text,'-',''),1,10),gen_random_uuid(),owner_id,service_id,'V147 client','79990000147',client_id,current_date,time '15:00',60,2500,2500,'confirmed',0,'not_required','','','{}');
  perform set_config('minuta.booking_organization','',true); perform set_config('minuta.booking_location','',true);

  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  perform public.set_minuta_finance_enabled_v133(organization_id,true);
  payload:=public.create_minuta_financial_account_v129(organization_id,gen_random_uuid(),'Основная касса','cash'); cash_id:=(payload->>'id')::uuid;
  perform public.set_minuta_benefits_enabled(organization_id,true);
  perform public.set_minuta_inventory_settings(organization_id,true,false);
  insert into public.benefit_products(id,organization_id,name,kind,sale_price_rub,face_value_rub,visits_count,validity_days,created_by)
    values(product_id,organization_id,'Пакет 5 визитов','package',5000,0,5,90,owner_id);
  insert into public.inventory_items(id,organization_id,name,sku,unit,low_stock_threshold,active,created_by)
    values(item_id,organization_id,'Крем','V147-CREAM','piece',1,true,owner_id);
  insert into public.inventory_warehouses(id,organization_id,location_id,name,active,created_by)
    values(warehouse_id,organization_id,location_id,'Основной склад',true,owner_id);
  perform public.apply_minuta_stock_movement(organization_id,warehouse_id,item_id,'receipt',10,null,'Начальный остаток',gen_random_uuid());

  payload:=public.sell_minuta_commercial_product_v147(organization_id,booking_id,client_id,'benefit_product',product_id,null,null,1,500000,0,'cash',cash_id,sale_request);
  benefit_sale_id:=(payload->>'id')::uuid; tx_id:=(payload->>'transaction_id')::uuid;
  perform pg_temp.v147_assert((select sum(posting.amount_minor) filter(where posting.side='debit')=sum(posting.amount_minor) filter(where posting.side='credit') from public.financial_postings posting where posting.transaction_id=fixture.tx_id),'benefit_balanced');
  perform pg_temp.v147_assert((select count(*)=1 from public.client_benefit_instruments instrument where instrument.organization_id=fixture.organization_id and instrument.client_account_id=fixture.client_id),'benefit_issued');
  payload:=public.sell_minuta_commercial_product_v147(organization_id,booking_id,client_id,'benefit_product',product_id,null,null,1,500000,0,'cash',cash_id,sale_request);
  perform pg_temp.v147_assert((payload->>'replayed')::boolean and (select count(*)=1 from public.commercial_sales where request_id=sale_request),'sale_replay');

  payload:=public.sell_minuta_commercial_product_v147(organization_id,null,client_id,'inventory_item',null,item_id,warehouse_id,2,50000,0,'cash',cash_id,inventory_request);
  inventory_sale_id:=(payload->>'id')::uuid;
  perform pg_temp.v147_assert((select balance.quantity=8 from public.inventory_stock_balances balance where balance.warehouse_id=fixture.warehouse_id and balance.inventory_item_id=fixture.item_id),'inventory_sold');
  payload:=public.refund_minuta_commercial_sale_v147(organization_id,inventory_sale_id,1,50000,'Частичный возврат',refund_request);
  perform pg_temp.v147_assert((select balance.quantity=9 from public.inventory_stock_balances balance where balance.warehouse_id=fixture.warehouse_id and balance.inventory_item_id=fixture.item_id),'inventory_returned');
  payload:=public.refund_minuta_commercial_sale_v147(organization_id,inventory_sale_id,1,50000,'Частичный возврат',refund_request);
  perform pg_temp.v147_assert((payload->>'replayed')::boolean and (select status='partially_refunded' from public.commercial_sales where id=inventory_sale_id),'refund_replay');
  perform public.refund_minuta_commercial_sale_v147(organization_id,inventory_sale_id,1,50000,'Полный возврат',gen_random_uuid());
  perform pg_temp.v147_assert((select balance.quantity=10 from public.inventory_stock_balances balance where balance.warehouse_id=fixture.warehouse_id and balance.inventory_item_id=fixture.item_id),'inventory_full_return');
  perform public.refund_minuta_commercial_sale_v147(organization_id,benefit_sale_id,1,500000,'Отмена покупки',gen_random_uuid());
  perform pg_temp.v147_assert((select status='cancelled' from public.client_benefit_instruments where id=(select benefit_instrument_id from public.commercial_sale_lines where sale_id=benefit_sale_id)),'benefit_cancelled');

  payload:=public.create_minuta_recurring_expense_v147(organization_id,'Аренда','Арендодатель',120000,(select account.id from public.financial_accounts account where account.organization_id=fixture.organization_id and account.system_key='operating_expense'),cash_id,1,gen_random_uuid());
  rule_id:=(payload->>'id')::uuid;
  perform public.record_minuta_recurring_expense_v147(organization_id,rule_id,today_date,gen_random_uuid());
  payload:=public.record_minuta_recurring_expense_v147(organization_id,rule_id,date_trunc('month',today_date::timestamp)::date+1,gen_random_uuid());
  perform pg_temp.v147_assert((payload->>'replayed')::boolean and (select count(*)=1 from public.recurring_expense_occurrences occurrence where occurrence.rule_id=fixture.rule_id),'monthly_expense_once');

  payload:=public.get_minuta_money_dashboard_v147(organization_id,date_trunc('month',today_date::timestamp)::date,today_date);
  perform pg_temp.v147_assert((payload->>'income_minor')::bigint=0 and (payload->>'expense_minor')::bigint=120000,'money_totals');
  payload:=public.get_minuta_client_commerce_v147(organization_id,client_id);
  perform pg_temp.v147_assert(jsonb_array_length(payload->'sales')=2 and jsonb_array_length(payload->'benefits')=1,'client_history');

  perform set_config('request.jwt.claim.sub',outsider_id::text,true);
  begin
    perform public.get_minuta_money_dashboard_v147(organization_id,today_date,today_date);
    raise exception 'v147_outsider_accepted';
  exception when insufficient_privilege then null;
  end;
end
$test$;

rollback;
