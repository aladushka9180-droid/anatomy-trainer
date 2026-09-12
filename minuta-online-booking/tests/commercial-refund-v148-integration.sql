\set ON_ERROR_STOP on

begin;
set local statement_timeout='90s';
set local lock_timeout='15s';
set local search_path=public,extensions,pg_catalog;

create function pg_temp.v148_assert(ok boolean,label text)
returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'v148_assert:%',label; end if; end $$;

do $test$
<<fixture>>
declare
  owner_id uuid:=gen_random_uuid(); organization_id uuid:=gen_random_uuid(); location_id uuid:=gen_random_uuid();
  item_id uuid:=gen_random_uuid(); warehouse_id uuid:=gen_random_uuid(); cash_id uuid; sale_id uuid;
  payload jsonb; error_text text; stock_before numeric; request_id uuid;
  transactions_before bigint; postings_before bigint; audit_before bigint;
begin
  set local session_replication_role=replica;
  insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values(owner_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',owner_id::text||'@example.invalid',now(),'{}','{}',now(),now());
  set local session_replication_role=origin;
  insert into public.performer_profiles(id,display_name) values(owner_id,'V148 owner');
  insert into public.organizations(id,name,public_slug,status,public_booking_enabled,created_by)
    values(organization_id,'V148 organization','v148-'||replace(organization_id::text,'-',''),'active',true,owner_id);
  insert into public.organization_memberships(organization_id,user_id,role,is_bookable,active,created_by)
    values(organization_id,owner_id,'owner',true,true,owner_id);
  insert into public.locations(id,organization_id,name,timezone,address,active,is_primary)
    values(location_id,organization_id,'V148 location','Europe/Samara','V148 address',true,true);

  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  perform public.set_minuta_finance_enabled_v133(organization_id,true);
  payload:=public.create_minuta_financial_account_v129(organization_id,gen_random_uuid(),'Основная касса','cash');
  cash_id:=(payload->>'id')::uuid;
  perform public.set_minuta_inventory_settings(organization_id,true,false);
  insert into public.inventory_items(id,organization_id,name,sku,unit,low_stock_threshold,active,created_by)
    values(item_id,organization_id,'Крем','V148-CREAM','piece',1,true,owner_id);
  insert into public.inventory_warehouses(id,organization_id,location_id,name,active,created_by)
    values(warehouse_id,organization_id,location_id,'Основной склад',true,owner_id);
  perform public.apply_minuta_stock_movement(organization_id,warehouse_id,item_id,'receipt',10,null,'Начальный остаток',gen_random_uuid());

  payload:=public.sell_minuta_commercial_product_v147(
    organization_id,null,null,'inventory_item',null,item_id,warehouse_id,3,100,1,'cash',cash_id,gen_random_uuid());
  sale_id:=(payload->>'id')::uuid;
  select quantity into stock_before from public.inventory_stock_balances
    where warehouse_id=fixture.warehouse_id and inventory_item_id=fixture.item_id;
  select count(*) into transactions_before from public.financial_transactions;
  select count(*) into postings_before from public.financial_postings;
  select count(*) into audit_before from public.commercial_audit_log;

  begin
    perform public.refund_minuta_commercial_sale_v147(
      organization_id,sale_id,1,299,'Несогласованный возврат',gen_random_uuid());
    raise exception 'v148_mismatched_refund_accepted';
  exception when sqlstate '22023' then
    get stacked diagnostics error_text=message_text;
    perform pg_temp.v148_assert(error_text='commercial_refund_amount_mismatch','mismatch_error');
  end;
  perform pg_temp.v148_assert(
    (select count(*)=0 from public.commercial_sale_refunds where sale_id=fixture.sale_id),'mismatch_not_recorded');
  perform pg_temp.v148_assert(
    (select quantity=stock_before from public.inventory_stock_balances where warehouse_id=fixture.warehouse_id and inventory_item_id=fixture.item_id),'mismatch_stock_unchanged');
  perform pg_temp.v148_assert((select count(*)=transactions_before from public.financial_transactions),'mismatch_transactions_unchanged');
  perform pg_temp.v148_assert((select count(*)=postings_before from public.financial_postings),'mismatch_postings_unchanged');
  perform pg_temp.v148_assert((select count(*)=audit_before from public.commercial_audit_log),'mismatch_audit_unchanged');

  request_id:=gen_random_uuid();
  payload:=public.refund_minuta_commercial_sale_v147(organization_id,sale_id,1,100,'Первый частичный возврат',request_id);
  payload:=public.refund_minuta_commercial_sale_v147(organization_id,sale_id,1,100,'Первый частичный возврат',request_id);
  perform pg_temp.v148_assert((payload->>'replayed')::boolean,'partial_replay');
  perform public.refund_minuta_commercial_sale_v147(organization_id,sale_id,1,99,'Второй частичный возврат',gen_random_uuid());
  perform public.refund_minuta_commercial_sale_v147(organization_id,sale_id,1,100,'Полный возврат остатка',gen_random_uuid());
  perform pg_temp.v148_assert(
    (select status='refunded' and refunded_minor=total_minor from public.commercial_sales where id=fixture.sale_id),'sale_fully_refunded');
  perform pg_temp.v148_assert(
    (select refunded_quantity=quantity from public.commercial_sale_lines where sale_id=fixture.sale_id),'quantity_fully_refunded');
  perform pg_temp.v148_assert(
    (select sum(amount_minor)=299 and sum(quantity)=3 from public.commercial_sale_refunds where sale_id=fixture.sale_id),'refund_totals_match');
  perform pg_temp.v148_assert(
    (select quantity=10 from public.inventory_stock_balances where warehouse_id=fixture.warehouse_id and inventory_item_id=fixture.item_id),'stock_fully_restored');
end
$test$;

rollback;
