-- v147: atomic commercial sales, refunds and recurring operating expenses.
begin;
set local lock_timeout='10s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $guard$
begin
  if to_regclass('public.client_benefit_instruments') is null
     or to_regclass('public.inventory_movements') is null
     or to_regclass('public.financial_transactions') is null
     or to_regprocedure('public.issue_minuta_benefit(uuid,uuid,uuid,date,uuid)') is null
     or to_regprocedure('public.set_minuta_benefit_status(uuid,uuid,text)') is null
     or to_regprocedure('public.apply_minuta_stock_movement(uuid,uuid,uuid,text,numeric,numeric,text,uuid)') is null
     or to_regprocedure('public.create_minuta_financial_supplier_v132(uuid,uuid,text)') is null
     or to_regprocedure('public.accrue_minuta_supplier_expense_v132(uuid,uuid,uuid,bigint,timestamp with time zone,uuid)') is null
     or to_regprocedure('public.pay_minuta_supplier_expense_v132(uuid,uuid,uuid,uuid)') is null then
    raise exception using errcode='55000',message='v147_requires_benefits_inventory_and_financial_ledger';
  end if;
end
$guard$;

do $constraints$
declare v_constraint record;
begin
  for v_constraint in select c.conname from pg_constraint c
    where c.conrelid='public.financial_accounts'::regclass and c.contype='c'
      and (pg_get_constraintdef(c.oid) like '%account_type%' or pg_get_constraintdef(c.oid) like '%system_key%')
  loop execute format('alter table public.financial_accounts drop constraint %I',v_constraint.conname); end loop;
end
$constraints$;

alter table public.financial_accounts
  add constraint financial_accounts_account_type_v147_check check(account_type in(
    'cash','bank','receivable','service_revenue','product_revenue','operating_expense','supplier_payable',
    'payment_channel_commission','payroll_expense','payroll_payable','employee_advance'
  )),
  add constraint financial_accounts_system_key_v147_check check(system_key is null or system_key in(
    'receivable','service_revenue','product_revenue','operating_expense','supplier_payable','payment_channel_commission',
    'payroll_expense','payroll_payable','employee_advance'
  )),
  add constraint financial_accounts_system_mapping_v147_check check(
    (system_key is null and account_type in('cash','bank') and account_class='asset')
    or (system_key='receivable' and account_type='receivable' and account_class='asset')
    or (system_key='service_revenue' and account_type='service_revenue' and account_class='income')
    or (system_key='product_revenue' and account_type='product_revenue' and account_class='income')
    or (system_key='operating_expense' and account_type='operating_expense' and account_class='expense')
    or (system_key='supplier_payable' and account_type='supplier_payable' and account_class='liability')
    or (system_key='payment_channel_commission' and account_type='payment_channel_commission' and account_class='expense')
    or (system_key='payroll_expense' and account_type='payroll_expense' and account_class='expense')
    or (system_key='payroll_payable' and account_type='payroll_payable' and account_class='liability')
    or (system_key='employee_advance' and account_type='employee_advance' and account_class='asset')
  ),
  add constraint financial_accounts_system_request_v147_check check((system_key is null)=(creation_request_id is not null));

do $constraints$
declare v_constraint record;
begin
  for v_constraint in select c.conname from pg_constraint c
    where c.conrelid='public.financial_transactions'::regclass and c.contype='c'
      and (pg_get_constraintdef(c.oid) like '%operation_type%' or pg_get_constraintdef(c.oid) like '%source_type%')
  loop execute format('alter table public.financial_transactions drop constraint %I',v_constraint.conname); end loop;
end
$constraints$;

alter table public.financial_transactions
  add constraint financial_transactions_operation_v147_check check(operation_type in(
    'visit_service','commercial_sale','commercial_refund','supplier_expense_accrual','supplier_expense_payment',
    'customer_debt_settlement','payroll_accrual','payroll_payment','payroll_advance','payroll_advance_offset','reversal'
  )),
  add constraint financial_transactions_source_v147_check check(source_type in(
    'booking_outcome','commercial_sale','commercial_sale_refund','financial_expense_source','financial_debt_settlement_source',
    'financial_payroll_accrual_source','financial_payroll_payment_source','financial_payroll_advance_source',
    'financial_payroll_advance_offset','financial_transaction'
  )),
  add constraint financial_transactions_shape_v147_check check(
    (operation_type='visit_service' and source_type='booking_outcome' and reversal_of is null)
    or (operation_type='commercial_sale' and source_type='commercial_sale' and reversal_of is null)
    or (operation_type='commercial_refund' and source_type='commercial_sale_refund' and reversal_of is null)
    or (operation_type in('supplier_expense_accrual','supplier_expense_payment') and source_type='financial_expense_source' and reversal_of is null)
    or (operation_type='customer_debt_settlement' and source_type='financial_debt_settlement_source' and reversal_of is null)
    or (operation_type='payroll_accrual' and source_type='financial_payroll_accrual_source' and reversal_of is null)
    or (operation_type='payroll_payment' and source_type='financial_payroll_payment_source' and reversal_of is null)
    or (operation_type='payroll_advance' and source_type='financial_payroll_advance_source' and reversal_of is null)
    or (operation_type='payroll_advance_offset' and source_type='financial_payroll_advance_offset' and reversal_of is null)
    or (operation_type='reversal' and source_type='financial_transaction' and reversal_of is not null and source_id=reversal_of)
  );

create table if not exists public.commercial_sales (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  booking_id uuid references public.bookings(id) on delete restrict,
  client_account_id uuid,
  seller_id uuid references auth.users(id) on delete set null,
  status text not null check(status in('paid','partially_refunded','refunded')),
  payment_method text not null check(payment_method in('cash','manual')),
  payment_account_id uuid not null,
  subtotal_minor bigint not null check(subtotal_minor>0),
  discount_minor bigint not null default 0 check(discount_minor>=0 and discount_minor<subtotal_minor),
  total_minor bigint not null check(total_minor=subtotal_minor-discount_minor and total_minor>0),
  refunded_minor bigint not null default 0 check(refunded_minor between 0 and total_minor),
  currency text not null default 'RUB' check(currency='RUB'),
  request_id uuid not null,
  request_fingerprint text not null check(request_fingerprint~'^[0-9a-f]{64}$'),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(id,organization_id), unique(organization_id,request_id),
  foreign key(payment_account_id,organization_id) references public.financial_accounts(id,organization_id) on delete restrict
);

create table if not exists public.commercial_sale_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  sale_id uuid not null,
  item_kind text not null check(item_kind in('inventory_item','benefit_product')),
  inventory_item_id uuid references public.inventory_items(id) on delete restrict,
  benefit_product_id uuid references public.benefit_products(id) on delete restrict,
  warehouse_id uuid references public.inventory_warehouses(id) on delete restrict,
  benefit_instrument_id uuid references public.client_benefit_instruments(id) on delete restrict,
  inventory_movement_id bigint references public.inventory_movements(id) on delete restrict,
  item_name text not null check(char_length(btrim(item_name)) between 1 and 120),
  quantity numeric(14,3) not null check(quantity>0),
  refunded_quantity numeric(14,3) not null default 0 check(refunded_quantity between 0 and quantity),
  unit_price_minor bigint not null check(unit_price_minor>0),
  subtotal_minor bigint not null check(subtotal_minor>0),
  discount_minor bigint not null default 0 check(discount_minor>=0 and discount_minor<subtotal_minor),
  total_minor bigint not null check(total_minor=subtotal_minor-discount_minor and total_minor>0),
  unique(id,organization_id), unique(sale_id),
  foreign key(sale_id,organization_id) references public.commercial_sales(id,organization_id) on delete restrict,
  check((item_kind='inventory_item' and inventory_item_id is not null and benefit_product_id is null and warehouse_id is not null and benefit_instrument_id is null and inventory_movement_id is not null)
     or (item_kind='benefit_product' and inventory_item_id is null and benefit_product_id is not null and warehouse_id is null and benefit_instrument_id is not null and inventory_movement_id is null))
);

create table if not exists public.commercial_sale_refunds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  sale_id uuid not null,
  amount_minor bigint not null check(amount_minor>0),
  quantity numeric(14,3) not null check(quantity>0),
  reason text not null check(char_length(btrim(reason)) between 3 and 500),
  request_id uuid not null,
  request_fingerprint text not null check(request_fingerprint~'^[0-9a-f]{64}$'),
  created_by uuid references auth.users(id) on delete set null,
  occurred_at timestamptz not null default now(),
  unique(id,organization_id), unique(organization_id,request_id),
  foreign key(sale_id,organization_id) references public.commercial_sales(id,organization_id) on delete restrict
);

create table if not exists public.organization_recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null check(char_length(btrim(name)) between 2 and 120),
  supplier_name text not null check(char_length(btrim(supplier_name)) between 2 and 120),
  amount_minor bigint not null check(amount_minor>0),
  expense_account_id uuid not null,
  payment_account_id uuid not null,
  frequency text not null default 'monthly' check(frequency='monthly'),
  day_of_month integer not null check(day_of_month between 1 and 28),
  active boolean not null default true,
  request_id uuid not null,
  request_fingerprint text not null check(request_fingerprint~'^[0-9a-f]{64}$'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(id,organization_id), unique(organization_id,request_id),
  foreign key(expense_account_id,organization_id) references public.financial_accounts(id,organization_id) on delete restrict,
  foreign key(payment_account_id,organization_id) references public.financial_accounts(id,organization_id) on delete restrict
);

create table if not exists public.recurring_expense_occurrences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  rule_id uuid not null,
  occurred_on date not null,
  period_month date not null check(period_month=date_trunc('month',occurred_on::timestamp)::date),
  expense_source_id uuid not null references public.financial_expense_sources(id) on delete restrict,
  payment_transaction_id uuid not null references public.financial_transactions(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(rule_id,period_month),
  foreign key(rule_id,organization_id) references public.organization_recurring_expenses(id,organization_id) on delete restrict
);

create table if not exists public.commercial_audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check(char_length(action) between 2 and 80),
  subject_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists commercial_sales_scope_v147_idx on public.commercial_sales(organization_id,occurred_at desc,id);
create index if not exists recurring_expenses_scope_v147_idx on public.organization_recurring_expenses(organization_id,active,day_of_month,id);
create index if not exists commercial_audit_scope_v147_idx on public.commercial_audit_log(organization_id,created_at desc,id desc);

create or replace function public.sell_minuta_commercial_product_v147(
  p_organization uuid,p_booking uuid,p_client_account uuid,p_item_kind text,p_benefit_product uuid,
  p_inventory_item uuid,p_warehouse uuid,p_quantity numeric,p_unit_price_minor bigint,p_discount_minor bigint,
  p_payment_method text,p_payment_account uuid,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_actor uuid; v_sale public.commercial_sales%rowtype; v_account public.financial_accounts%rowtype;
  v_product public.benefit_products%rowtype; v_item public.inventory_items%rowtype; v_subtotal bigint; v_total bigint;
  v_fingerprint text; v_instrument jsonb; v_movement jsonb; v_revenue uuid; v_transaction uuid; v_line uuid;
begin
  v_actor:=public.require_minuta_financial_manager_v129(p_organization);
  if p_request_id is null or p_item_kind not in('inventory_item','benefit_product') or p_payment_method not in('cash','manual')
     or coalesce(p_quantity,0)<=0 or p_unit_price_minor is null or p_unit_price_minor<=0 or coalesce(p_discount_minor,0)<0 then
    raise exception using errcode='22023',message='invalid_commercial_sale';
  end if;
  if p_quantity<>trunc(p_quantity) and p_item_kind='benefit_product' then raise exception using errcode='22023',message='invalid_benefit_quantity'; end if;
  if p_item_kind='benefit_product' and (p_quantity<>1 or p_client_account is null or p_benefit_product is null or p_inventory_item is not null or p_warehouse is not null) then
    raise exception using errcode='22023',message='invalid_benefit_sale';
  end if;
  if p_item_kind='inventory_item' and (p_inventory_item is null or p_warehouse is null or p_benefit_product is not null) then
    raise exception using errcode='22023',message='invalid_inventory_sale';
  end if;
  v_subtotal:=round(p_quantity*p_unit_price_minor)::bigint; v_total:=v_subtotal-coalesce(p_discount_minor,0);
  if v_total<=0 then raise exception using errcode='22023',message='invalid_commercial_sale_total'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':commerce:'||p_request_id::text,147));
  select * into v_sale from public.commercial_sales where organization_id=p_organization and request_id=p_request_id for update;
  v_fingerprint:=public.minuta_financial_sha256_v129(jsonb_build_array(p_organization,p_booking,p_client_account,p_item_kind,
    p_benefit_product,p_inventory_item,p_warehouse,p_quantity,p_unit_price_minor,coalesce(p_discount_minor,0),p_payment_method,p_payment_account));
  if v_sale.id is not null then
    if v_sale.request_fingerprint<>v_fingerprint then raise exception using errcode='23505',message='commercial_sale_idempotency_conflict'; end if;
    return jsonb_build_object('id',v_sale.id,'organization_id',p_organization,'status',v_sale.status,'total_minor',v_sale.total_minor,'replayed',true);
  end if;
  if not coalesce((select enabled from public.organization_finance_settings where organization_id=p_organization),false) then raise exception using errcode='55000',message='finance_disabled'; end if;
  select * into v_account from public.financial_accounts where id=p_payment_account and organization_id=p_organization and active for update;
  if v_account.id is null or v_account.system_key is not null or v_account.account_type not in('cash','bank') then raise exception using errcode='22023',message='cash_or_bank_account_required'; end if;
  if p_payment_method='cash' and v_account.account_type<>'cash' then raise exception using errcode='22023',message='cash_account_required'; end if;
  if p_client_account is not null and not exists(select 1 from public.bookings where organization_id=p_organization and client_account_id=p_client_account) then raise exception using errcode='42501',message='commercial_client_mismatch'; end if;
  if p_booking is not null and not exists(select 1 from public.bookings where id=p_booking and organization_id=p_organization and client_account_id is not distinct from p_client_account) then raise exception using errcode='42501',message='commercial_booking_mismatch'; end if;
  insert into public.financial_accounts(organization_id,name,account_class,account_type,system_key,created_by)
    values(p_organization,'Выручка от продаж','income','product_revenue','product_revenue',v_actor) on conflict(organization_id,system_key) do nothing;
  select id into v_revenue from public.financial_accounts where organization_id=p_organization and system_key='product_revenue' and active for update;
  insert into public.commercial_sales(organization_id,booking_id,client_account_id,seller_id,status,payment_method,payment_account_id,
    subtotal_minor,discount_minor,total_minor,request_id,request_fingerprint,occurred_at)
  values(p_organization,p_booking,p_client_account,v_actor,'paid',p_payment_method,p_payment_account,v_subtotal,coalesce(p_discount_minor,0),v_total,p_request_id,v_fingerprint,now()) returning * into v_sale;
  if p_item_kind='benefit_product' then
    select * into v_product from public.benefit_products where id=p_benefit_product and organization_id=p_organization and active for update;
    if v_product.id is null then raise exception using errcode='P0002',message='benefit_product_not_found'; end if;
    v_instrument:=public.issue_minuta_benefit(p_organization,p_benefit_product,p_client_account,null,md5(p_request_id::text||':benefit')::uuid);
    insert into public.commercial_sale_lines(organization_id,sale_id,item_kind,benefit_product_id,benefit_instrument_id,item_name,quantity,unit_price_minor,subtotal_minor,discount_minor,total_minor)
      values(p_organization,v_sale.id,p_item_kind,p_benefit_product,(v_instrument->>'id')::uuid,v_product.name,1,p_unit_price_minor,v_subtotal,coalesce(p_discount_minor,0),v_total) returning id into v_line;
  else
    select * into v_item from public.inventory_items where id=p_inventory_item and organization_id=p_organization and active for update;
    if v_item.id is null then raise exception using errcode='P0002',message='inventory_item_not_found'; end if;
    v_movement:=public.apply_minuta_stock_movement(p_organization,p_warehouse,p_inventory_item,'write_off',p_quantity,null,'Продажа '||v_sale.id::text,md5(p_request_id::text||':inventory')::uuid);
    insert into public.commercial_sale_lines(organization_id,sale_id,item_kind,inventory_item_id,warehouse_id,inventory_movement_id,item_name,quantity,unit_price_minor,subtotal_minor,discount_minor,total_minor)
      values(p_organization,v_sale.id,p_item_kind,p_inventory_item,p_warehouse,(v_movement->>'id')::bigint,v_item.name,p_quantity,p_unit_price_minor,v_subtotal,coalesce(p_discount_minor,0),v_total) returning id into v_line;
  end if;
  insert into public.financial_transactions(organization_id,request_id,request_fingerprint,operation_type,source_type,source_id,source_fingerprint,occurred_at,explanation,created_by)
    values(p_organization,md5(p_request_id::text||':finance')::uuid,v_fingerprint,'commercial_sale','commercial_sale',v_sale.id,v_fingerprint,v_sale.occurred_at,
      jsonb_build_object('schema','minuta-commerce-v1','sale_id',v_sale.id,'line_id',v_line,'item_kind',p_item_kind,'total_minor',v_total,'payment_method',p_payment_method,'booking_id',p_booking,'client_account_id',p_client_account),v_actor) returning id into v_transaction;
  insert into public.financial_postings(organization_id,transaction_id,account_id,side,amount_minor) values
    (p_organization,v_transaction,p_payment_account,'debit',v_total),(p_organization,v_transaction,v_revenue,'credit',v_total);
  insert into public.commercial_audit_log(organization_id,actor_id,action,subject_id,details) values
    (p_organization,v_actor,'commercial_sale_created',v_sale.id,jsonb_build_object('line_id',v_line,'total_minor',v_total,'transaction_id',v_transaction));
  return jsonb_build_object('id',v_sale.id,'organization_id',p_organization,'status','paid','total_minor',v_total,'transaction_id',v_transaction,'replayed',false);
end $$;

create or replace function public.refund_minuta_commercial_sale_v147(
  p_organization uuid,p_sale uuid,p_quantity numeric,p_amount_minor bigint,p_reason text,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_actor uuid; v_sale public.commercial_sales%rowtype; v_line public.commercial_sale_lines%rowtype; v_existing public.commercial_sale_refunds%rowtype;
  v_fingerprint text; v_refund uuid; v_revenue uuid; v_transaction uuid; v_movement jsonb;
begin
  v_actor:=public.require_minuta_financial_manager_v129(p_organization);
  if p_request_id is null or coalesce(p_quantity,0)<=0 or coalesce(p_amount_minor,0)<=0 or char_length(btrim(coalesce(p_reason,'')))<3 then raise exception using errcode='22023',message='invalid_commercial_refund'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':commerce-refund:'||p_request_id::text,147));
  select * into v_existing from public.commercial_sale_refunds where organization_id=p_organization and request_id=p_request_id for update;
  v_fingerprint:=public.minuta_financial_sha256_v129(jsonb_build_array(p_organization,p_sale,p_quantity,p_amount_minor,btrim(p_reason)));
  if v_existing.id is not null then
    if v_existing.request_fingerprint<>v_fingerprint then raise exception using errcode='23505',message='commercial_refund_idempotency_conflict'; end if;
    return jsonb_build_object('id',v_existing.id,'sale_id',p_sale,'amount_minor',v_existing.amount_minor,'replayed',true);
  end if;
  select * into v_sale from public.commercial_sales where id=p_sale and organization_id=p_organization for update;
  select * into v_line from public.commercial_sale_lines where sale_id=p_sale and organization_id=p_organization for update;
  if v_sale.id is null or v_line.id is null then raise exception using errcode='P0002',message='commercial_sale_not_found'; end if;
  if p_quantity>v_line.quantity-v_line.refunded_quantity or p_amount_minor>v_sale.total_minor-v_sale.refunded_minor then raise exception using errcode='22023',message='commercial_refund_exceeds_remaining'; end if;
  if v_line.item_kind='benefit_product' then
    if p_quantity<>1 or v_line.refunded_quantity<>0 or p_amount_minor<>v_sale.total_minor-v_sale.refunded_minor
       or exists(select 1 from public.benefit_redemptions where instrument_id=v_line.benefit_instrument_id and status in('reserved','redeemed')) then
      raise exception using errcode='55000',message='used_benefit_cannot_be_refunded';
    end if;
    perform public.set_minuta_benefit_status(p_organization,v_line.benefit_instrument_id,'cancelled');
  else
    v_movement:=public.apply_minuta_stock_movement(p_organization,v_line.warehouse_id,v_line.inventory_item_id,'receipt',p_quantity,null,'Возврат продажи '||p_sale::text,md5(p_request_id::text||':inventory-return')::uuid);
  end if;
  insert into public.commercial_sale_refunds(organization_id,sale_id,amount_minor,quantity,reason,request_id,request_fingerprint,created_by)
    values(p_organization,p_sale,p_amount_minor,p_quantity,btrim(p_reason),p_request_id,v_fingerprint,v_actor) returning id into v_refund;
  select id into v_revenue from public.financial_accounts where organization_id=p_organization and system_key='product_revenue' and active for update;
  insert into public.financial_transactions(organization_id,request_id,request_fingerprint,operation_type,source_type,source_id,source_fingerprint,occurred_at,explanation,created_by)
    values(p_organization,md5(p_request_id::text||':finance')::uuid,v_fingerprint,'commercial_refund','commercial_sale_refund',v_refund,v_fingerprint,now(),
      jsonb_build_object('schema','minuta-commerce-v1','sale_id',p_sale,'refund_id',v_refund,'quantity',p_quantity,'amount_minor',p_amount_minor,'reason',btrim(p_reason)),v_actor) returning id into v_transaction;
  insert into public.financial_postings(organization_id,transaction_id,account_id,side,amount_minor) values
    (p_organization,v_transaction,v_revenue,'debit',p_amount_minor),(p_organization,v_transaction,v_sale.payment_account_id,'credit',p_amount_minor);
  update public.commercial_sale_lines set refunded_quantity=refunded_quantity+p_quantity where id=v_line.id;
  update public.commercial_sales set refunded_minor=refunded_minor+p_amount_minor,status=case when refunded_minor+p_amount_minor=total_minor then 'refunded' else 'partially_refunded' end where id=p_sale;
  insert into public.commercial_audit_log(organization_id,actor_id,action,subject_id,details) values
    (p_organization,v_actor,'commercial_sale_refunded',p_sale,jsonb_build_object('refund_id',v_refund,'amount_minor',p_amount_minor,'quantity',p_quantity,'transaction_id',v_transaction));
  return jsonb_build_object('id',v_refund,'sale_id',p_sale,'amount_minor',p_amount_minor,'transaction_id',v_transaction,'replayed',false);
end $$;

create or replace function public.create_minuta_recurring_expense_v147(
  p_organization uuid,p_name text,p_supplier_name text,p_amount_minor bigint,p_expense_account uuid,
  p_payment_account uuid,p_day_of_month integer,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_actor uuid; v_rule public.organization_recurring_expenses%rowtype; v_fingerprint text;
begin
  v_actor:=public.require_minuta_financial_manager_v129(p_organization);
  if p_request_id is null or char_length(btrim(coalesce(p_name,''))) not between 2 and 120
     or char_length(btrim(coalesce(p_supplier_name,''))) not between 2 and 120 or coalesce(p_amount_minor,0)<=0
     or p_day_of_month not between 1 and 28 then raise exception using errcode='22023',message='invalid_recurring_expense'; end if;
  if not exists(select 1 from public.financial_accounts where id=p_expense_account and organization_id=p_organization and active and system_key='operating_expense')
     or not exists(select 1 from public.financial_accounts where id=p_payment_account and organization_id=p_organization and active and system_key is null and account_type in('cash','bank')) then raise exception using errcode='22023',message='invalid_recurring_expense_accounts'; end if;
  v_fingerprint:=public.minuta_financial_sha256_v129(jsonb_build_array(p_organization,btrim(p_name),btrim(p_supplier_name),p_amount_minor,p_expense_account,p_payment_account,p_day_of_month));
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':recurring:'||p_request_id::text,147));
  select * into v_rule from public.organization_recurring_expenses where organization_id=p_organization and request_id=p_request_id for update;
  if v_rule.id is not null then
    if v_rule.request_fingerprint<>v_fingerprint then raise exception using errcode='23505',message='recurring_expense_idempotency_conflict'; end if;
    return jsonb_build_object('id',v_rule.id,'organization_id',p_organization,'replayed',true);
  end if;
  insert into public.organization_recurring_expenses(organization_id,name,supplier_name,amount_minor,expense_account_id,payment_account_id,day_of_month,request_id,request_fingerprint,created_by)
    values(p_organization,btrim(p_name),btrim(p_supplier_name),p_amount_minor,p_expense_account,p_payment_account,p_day_of_month,p_request_id,v_fingerprint,v_actor) returning * into v_rule;
  insert into public.commercial_audit_log(organization_id,actor_id,action,subject_id,details) values(p_organization,v_actor,'recurring_expense_created',v_rule.id,jsonb_build_object('name',v_rule.name,'amount_minor',v_rule.amount_minor));
  return jsonb_build_object('id',v_rule.id,'organization_id',p_organization,'replayed',false);
end $$;

create or replace function public.record_minuta_recurring_expense_v147(
  p_organization uuid,p_rule uuid,p_occurred_on date,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_actor uuid; v_rule public.organization_recurring_expenses%rowtype; v_supplier jsonb; v_accrual jsonb; v_payment jsonb; v_occurrence uuid;
begin
  v_actor:=public.require_minuta_financial_manager_v129(p_organization);
  if p_request_id is null or p_occurred_on is null then raise exception using errcode='22023',message='invalid_recurring_expense_occurrence'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':recurring-rule:'||p_rule::text,147));
  select * into v_rule from public.organization_recurring_expenses where id=p_rule and organization_id=p_organization and active for update;
  if v_rule.id is null then raise exception using errcode='P0002',message='recurring_expense_not_found'; end if;
  select id into v_occurrence from public.recurring_expense_occurrences where rule_id=p_rule and period_month=date_trunc('month',p_occurred_on::timestamp)::date;
  if v_occurrence is not null then return jsonb_build_object('id',v_occurrence,'rule_id',p_rule,'occurred_on',p_occurred_on,'replayed',true); end if;
  v_supplier:=public.create_minuta_financial_supplier_v132(p_organization,md5(p_rule::text||':supplier')::uuid,v_rule.supplier_name);
  v_accrual:=public.accrue_minuta_supplier_expense_v132(p_organization,(v_supplier->>'id')::uuid,v_rule.expense_account_id,v_rule.amount_minor,p_occurred_on::timestamptz,md5(p_request_id::text||':accrual')::uuid);
  v_payment:=public.pay_minuta_supplier_expense_v132(p_organization,(v_accrual->>'id')::uuid,v_rule.payment_account_id,md5(p_request_id::text||':payment')::uuid);
  insert into public.recurring_expense_occurrences(organization_id,rule_id,occurred_on,period_month,expense_source_id,payment_transaction_id)
    values(p_organization,p_rule,p_occurred_on,date_trunc('month',p_occurred_on::timestamp)::date,(v_accrual->>'id')::uuid,(v_payment->>'id')::uuid) returning id into v_occurrence;
  insert into public.commercial_audit_log(organization_id,actor_id,action,subject_id,details) values(p_organization,v_actor,'recurring_expense_recorded',p_rule,jsonb_build_object('occurrence_id',v_occurrence,'occurred_on',p_occurred_on,'amount_minor',v_rule.amount_minor));
  return jsonb_build_object('id',v_occurrence,'rule_id',p_rule,'occurred_on',p_occurred_on,'amount_minor',v_rule.amount_minor,'replayed',false);
end $$;

create or replace function public.get_minuta_commerce_workspace_v147(p_organization uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_actor uuid;
begin
  v_actor:=auth.uid();
  if v_actor is null or not public.has_organization_role(p_organization,array['owner','admin']) then
    raise exception using errcode='42501',message='commercial_finance_manager_required';
  end if;
  return jsonb_build_object('organization_id',p_organization,
    'finance_enabled',coalesce((select enabled from public.organization_finance_settings where organization_id=p_organization),false),
    'benefits_enabled',coalesce((select enabled from public.organization_benefit_settings where organization_id=p_organization),false),
    'inventory_enabled',coalesce((select enabled from public.organization_inventory_settings where organization_id=p_organization),false),
    'accounts',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'account_type',account_type,'system_key',system_key) order by account_type,name) from public.financial_accounts where organization_id=p_organization and active),'[]'::jsonb),
    'clients',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.client_name,'phone',c.client_phone) order by c.client_name,c.id) from (select distinct on (client_account_id) client_account_id id,client_name,client_phone from public.bookings where organization_id=p_organization and client_account_id is not null order by client_account_id,created_at desc)c),'[]'::jsonb),
    'bookings',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'client_account_id',b.client_account_id,'client_name',b.client_name,'booking_date',b.booking_date,'booking_time',b.booking_time,'service_name',s.name) order by b.booking_date desc,b.booking_time desc) from public.bookings b join public.services s on s.id=b.service_id where b.organization_id=p_organization and b.client_account_id is not null and b.status<>'cancelled' and b.booking_date>=current_date-90),'[]'::jsonb),
    'benefit_products',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'kind',kind,'sale_price_minor',sale_price_rub::bigint*100) order by name,id) from public.benefit_products where organization_id=p_organization and active),'[]'::jsonb),
    'inventory_items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'sku',sku,'unit',unit) order by name,id) from public.inventory_items where organization_id=p_organization and active),'[]'::jsonb),
    'warehouses',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id) from public.inventory_warehouses where organization_id=p_organization and active),'[]'::jsonb),
    'sales',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'booking_id',s.booking_id,'client_account_id',s.client_account_id,'client_name',(select b.client_name from public.bookings b where b.organization_id=s.organization_id and b.client_account_id=s.client_account_id order by b.created_at desc limit 1),'seller_id',s.seller_id,'status',s.status,'payment_method',s.payment_method,'total_minor',s.total_minor,'refunded_minor',s.refunded_minor,'occurred_at',s.occurred_at,'line',jsonb_build_object('id',l.id,'item_kind',l.item_kind,'item_name',l.item_name,'quantity',l.quantity,'refunded_quantity',l.refunded_quantity,'unit_price_minor',l.unit_price_minor)) order by s.occurred_at desc,s.id desc) from public.commercial_sales s join public.commercial_sale_lines l on l.sale_id=s.id where s.organization_id=p_organization),'[]'::jsonb),
    'recurring_expenses',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'supplier_name',r.supplier_name,'amount_minor',r.amount_minor,'day_of_month',r.day_of_month,'active',r.active,'last_occurred_on',(select max(o.occurred_on) from public.recurring_expense_occurrences o where o.rule_id=r.id)) order by r.active desc,r.name,r.id) from public.organization_recurring_expenses r where r.organization_id=p_organization),'[]'::jsonb),
    'audit',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'action',a.action,'subject_id',a.subject_id,'details',a.details,'created_at',a.created_at) order by a.created_at desc,a.id desc) from (select * from public.commercial_audit_log where organization_id=p_organization order by created_at desc,id desc limit 100)a),'[]'::jsonb)
  );
end $$;

create or replace function public.get_minuta_money_dashboard_v147(p_organization uuid,p_start date,p_end date)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_actor uuid;
begin
  v_actor:=auth.uid();
  if v_actor is null or not public.has_organization_role(p_organization,array['owner','admin']) then
    raise exception using errcode='42501',message='commercial_finance_manager_required';
  end if;
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>3661 then raise exception using errcode='22023',message='invalid_money_period'; end if;
  return jsonb_build_object('organization_id',p_organization,'start',p_start,'end',p_end,
    'income_minor',coalesce((select sum(case when p.side='credit' then p.amount_minor else -p.amount_minor end) from public.financial_postings p join public.financial_transactions t on t.id=p.transaction_id join public.financial_accounts a on a.id=p.account_id where p.organization_id=p_organization and t.occurred_at::date between p_start and p_end and a.account_class='income'),0),
    'expense_minor',coalesce((select sum(case when p.side='debit' then p.amount_minor else -p.amount_minor end) from public.financial_postings p join public.financial_transactions t on t.id=p.transaction_id join public.financial_accounts a on a.id=p.account_id where p.organization_id=p_organization and t.occurred_at::date between p_start and p_end and a.account_class='expense'),0),
    'expense_structure',coalesce((select jsonb_agg(jsonb_build_object('name',x.name,'amount_minor',x.amount_minor) order by x.amount_minor desc,x.name) from (select a.name,sum(case when p.side='debit' then p.amount_minor else -p.amount_minor end)::bigint amount_minor from public.financial_postings p join public.financial_transactions t on t.id=p.transaction_id join public.financial_accounts a on a.id=p.account_id where p.organization_id=p_organization and t.occurred_at::date between p_start and p_end and a.account_class='expense' group by a.id,a.name)x where x.amount_minor<>0),'[]'::jsonb),
    'recent_operations',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'operation_type',x.operation_type,'occurred_at',x.occurred_at,'explanation',x.explanation,'amount_minor',x.amount_minor) order by x.occurred_at desc,x.id desc) from (select t.id,t.operation_type,t.occurred_at,t.explanation,coalesce(max(p.amount_minor),0)::bigint amount_minor from public.financial_transactions t left join public.financial_postings p on p.transaction_id=t.id where t.organization_id=p_organization and t.occurred_at::date between p_start and p_end group by t.id,t.operation_type,t.occurred_at,t.explanation order by t.occurred_at desc,t.id desc limit 30)x),'[]'::jsonb)
  );
end $$;

create or replace function public.get_minuta_client_commerce_v147(p_organization uuid,p_client_account uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_actor uuid;
begin
  v_actor:=auth.uid();
  if v_actor is null or not public.has_organization_role(p_organization,array['owner','admin']) then
    raise exception using errcode='42501',message='commercial_finance_manager_required';
  end if;
  if p_client_account is null or not exists(select 1 from public.bookings where organization_id=p_organization and client_account_id=p_client_account) then
    raise exception using errcode='42501',message='commercial_client_not_in_organization';
  end if;
  return jsonb_build_object(
    'organization_id',p_organization,'client_account_id',p_client_account,
    'sales',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'status',s.status,'total_minor',s.total_minor,'refunded_minor',s.refunded_minor,'occurred_at',s.occurred_at,'item_name',l.item_name,'quantity',l.quantity) order by s.occurred_at desc,s.id desc) from public.commercial_sales s join public.commercial_sale_lines l on l.sale_id=s.id where s.organization_id=p_organization and s.client_account_id=p_client_account),'[]'::jsonb),
    'benefits',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'status',i.status,'public_code',i.public_code,'expires_on',i.expires_on,'remaining_amount_rub',i.remaining_amount_rub,'remaining_visits',i.remaining_visits,'name',i.product_snapshot->>'name','kind',i.product_snapshot->>'kind') order by i.issued_at desc,i.id desc) from public.client_benefit_instruments i where i.organization_id=p_organization and i.client_account_id=p_client_account),'[]'::jsonb)
  );
end $$;

alter table public.commercial_sales enable row level security;
alter table public.commercial_sale_lines enable row level security;
alter table public.commercial_sale_refunds enable row level security;
alter table public.organization_recurring_expenses enable row level security;
alter table public.recurring_expense_occurrences enable row level security;
alter table public.commercial_audit_log enable row level security;

do $policies$ declare v_table text; begin
  foreach v_table in array array['commercial_sales','commercial_sale_lines','commercial_sale_refunds','organization_recurring_expenses','recurring_expense_occurrences','commercial_audit_log'] loop
    execute format('drop policy if exists commercial_manager_read_v147 on public.%I',v_table);
    execute format('create policy commercial_manager_read_v147 on public.%I for select to authenticated using(public.has_organization_role(organization_id,array[''owner'',''admin'']))',v_table);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',v_table);
    execute format('grant select on public.%I to authenticated',v_table);
  end loop;
end $policies$;

revoke all on function public.sell_minuta_commercial_product_v147(uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.refund_minuta_commercial_sale_v147(uuid,uuid,numeric,bigint,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.create_minuta_recurring_expense_v147(uuid,text,text,bigint,uuid,uuid,integer,uuid) from public,anon,authenticated,service_role;
revoke all on function public.record_minuta_recurring_expense_v147(uuid,uuid,date,uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_minuta_commerce_workspace_v147(uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_minuta_money_dashboard_v147(uuid,date,date) from public,anon,authenticated,service_role;
revoke all on function public.get_minuta_client_commerce_v147(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.sell_minuta_commercial_product_v147(uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid) to authenticated;
grant execute on function public.refund_minuta_commercial_sale_v147(uuid,uuid,numeric,bigint,text,uuid) to authenticated;
grant execute on function public.create_minuta_recurring_expense_v147(uuid,text,text,bigint,uuid,uuid,integer,uuid) to authenticated;
grant execute on function public.record_minuta_recurring_expense_v147(uuid,uuid,date,uuid) to authenticated;
grant execute on function public.get_minuta_commerce_workspace_v147(uuid) to authenticated;
grant execute on function public.get_minuta_money_dashboard_v147(uuid,date,date) to authenticated;
grant execute on function public.get_minuta_client_commerce_v147(uuid,uuid) to authenticated;

commit;
