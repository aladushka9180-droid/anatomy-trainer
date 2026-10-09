-- UNNUMBERED CANDIDATE. Integration/release owner must reserve a migration number.
-- Expand only; no seeded products, prices, balances, flags or benefit changes.
begin;
set local lock_timeout='10s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $guard$
declare p record;
begin
  if to_regprocedure('public.sell_minuta_commercial_product_v151(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid)') is null
    or to_regprocedure('public.require_minuta_financial_manager_v129(uuid)') is null
    or to_regprocedure('public.apply_minuta_stock_movement(uuid,uuid,uuid,text,numeric,numeric,text,uuid)') is null
    or to_regprocedure('public.refund_minuta_commercial_sale_v147(uuid,uuid,numeric,bigint,text,uuid)') is null then
    raise exception using errcode='55000',message='sales_catalog_dependencies_required';
  end if;
  for p in select pr.oid,pr.prosrc,pr.proname,pr.prosecdef,pr.proconfig,pr.proowner from pg_proc pr join pg_namespace n on n.oid=pr.pronamespace
    where n.nspname='public' and pr.proname=any(array['require_minuta_sales_candidate','protect_minuta_sales_candidate',
      'normalize_minuta_sales_import_candidate','persist_minuta_sales_import_candidate','save_minuta_sales_item_candidate','expand_minuta_sales_lines_candidate','get_minuta_sales_catalog_candidate',
      'get_minuta_sales_cart_candidate','get_minuta_sales_repeat_candidate','get_minuta_sales_history_candidate',
      'sell_minuta_inventory_cart_candidate','preview_minuta_sales_import_candidate','commit_minuta_sales_import_candidate',
      'save_minuta_sales_bundle_candidate','set_minuta_sales_favorite_candidate']) loop
    if obj_description(p.oid,'pg_proc') is distinct from 'sales-catalog-candidate:md5='||md5(p.prosrc)
      or not p.prosecdef or p.proconfig is distinct from array['search_path=""']::text[]
      or pg_get_userbyid(p.proowner)<>'postgres' or has_function_privilege('anon',p.oid,'execute')
      or has_function_privilege('service_role',p.oid,'execute')
      or exists(select 1 from aclexplode(coalesce((select proacl from pg_proc where oid=p.oid),acldefault('f',p.proowner))) acl
        where acl.privilege_type='EXECUTE' and acl.grantee=0)
      or has_function_privilege('authenticated',p.oid,'execute') is distinct from
        (p.proname not in('require_minuta_sales_candidate','protect_minuta_sales_candidate','normalize_minuta_sales_import_candidate','persist_minuta_sales_import_candidate','expand_minuta_sales_lines_candidate')) then
      raise exception using errcode='55000',message='sales_catalog_candidate_function_drift';
    end if;
  end loop;
  if to_regclass('public.sales_catalog_candidate_state') is null then
    if to_regclass('public.sales_catalog_items_candidate') is not null or to_regclass('public.sales_catalog_bundles_candidate') is not null
      or to_regclass('public.sales_catalog_favorites_candidate') is not null or to_regclass('public.sales_catalog_requests_candidate') is not null
      or to_regclass('public.sales_carts_candidate') is not null or to_regclass('public.sales_cart_lines_candidate') is not null then
      raise exception using errcode='55000',message='sales_catalog_partial_objects';end if;
    if obj_description('public.refund_minuta_commercial_sale_v147(uuid,uuid,numeric,bigint,text,uuid)'::regprocedure,'pg_proc')
      is distinct from 'minuta_refund_safety_v148_proportional_rounding'
      or (select md5(replace(prosrc,chr(13),'')) from pg_proc where
        oid='public.refund_minuta_commercial_sale_v147(uuid,uuid,numeric,bigint,text,uuid)'::regprocedure)<>'77e1825a6201df1754d8bb09f58eb06e' then
      raise exception using errcode='55000',message='sales_catalog_exact_refund_required';
    end if;
  elsif obj_description('public.refund_minuta_commercial_sale_v147(uuid,uuid,numeric,bigint,text,uuid)'::regprocedure,'pg_proc')
    is distinct from 'sales-catalog-candidate-refund:md5='||(select md5(prosrc) from pg_proc where
      oid='public.refund_minuta_commercial_sale_v147(uuid,uuid,numeric,bigint,text,uuid)'::regprocedure) then
    raise exception using errcode='55000',message='sales_catalog_refund_drift';
  end if;
  if to_regclass('public.sales_catalog_candidate_state') is not null then
    if (select proacl::text from pg_proc where oid='public.refund_minuta_commercial_sale_v147(uuid,uuid,numeric,bigint,text,uuid)'::regprocedure)
      is distinct from (select legacy_refund_acl from public.sales_catalog_candidate_state where singleton) then
      raise exception using errcode='55000',message='sales_catalog_refund_acl_drift';end if;
  end if;
end $guard$;

create table if not exists public.sales_catalog_candidate_state (
  singleton boolean primary key default true check(singleton),
  writes_enabled boolean not null default true,
  legacy_refund_definition text not null,
  legacy_refund_comment text not null,
  legacy_refund_acl text,
  installed_at timestamptz not null default now()
);
insert into public.sales_catalog_candidate_state(singleton,legacy_refund_definition,legacy_refund_comment,legacy_refund_acl)
select true,pg_get_functiondef(oid),obj_description(oid,'pg_proc'),proacl::text from pg_proc
where oid='public.refund_minuta_commercial_sale_v147(uuid,uuid,numeric,bigint,text,uuid)'::regprocedure
on conflict(singleton) do nothing;

create table if not exists public.sales_catalog_items_candidate (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  inventory_item_id uuid not null,
  category text not null default '' check(char_length(category)<=80),
  purpose text not null check(purpose in('retail','consumable','both')),
  group_key text not null default '' check(char_length(group_key)<=80),
  variant_label text not null default '' check(char_length(variant_label)<=120),
  sale_unit text not null check(sale_unit in('piece','ml','g','kg','l','pack')),
  base_unit text not null check(base_unit in('piece','ml','g','kg','l','pack')),
  stock_per_sale_unit numeric(14,3) not null check(stock_per_sale_unit>0),
  sale_price_minor bigint check(sale_price_minor>0),
  icon text not null default '' check(char_length(icon)<=40),
  photo_url text not null default '' check(char_length(photo_url)<=2048 and (photo_url='' or
    (photo_url ~ '^https://[^[:space:]]+$' and photo_url !~ '^https://[^/?#]*@'))),
  description text not null default '' check(char_length(description)<=2000),
  metadata_version bigint not null default 1 check(metadata_version>0),
  updated_at timestamptz not null default now(),
  primary key(organization_id,inventory_item_id),
  foreign key(inventory_item_id,organization_id) references public.inventory_items(id,organization_id) on delete restrict
);
create table if not exists public.sales_catalog_bundles_candidate (
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null check(char_length(btrim(name)) between 2 and 120),
  items jsonb not null check(jsonb_typeof(items)='array' and jsonb_array_length(items) between 2 and 30),
  version bigint not null default 1 check(version>0),active boolean not null default true,
  unique(id,organization_id)
);
create table if not exists public.sales_catalog_favorites_candidate (
  organization_id uuid not null,actor_id uuid not null references auth.users(id) on delete restrict,
  inventory_item_id uuid not null,primary key(organization_id,actor_id,inventory_item_id),
  foreign key(inventory_item_id,organization_id) references public.inventory_items(id,organization_id) on delete restrict
);
create table if not exists public.sales_catalog_requests_candidate (
  organization_id uuid not null references public.organizations(id) on delete restrict,request_id uuid not null,
  kind text not null check(kind in('import','item','bundle')),fingerprint text not null,
  result jsonb not null,actor_id uuid not null references auth.users(id) on delete restrict,
  primary key(organization_id,request_id)
);
create table if not exists public.sales_carts_candidate (
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete restrict,
  client_account_id uuid,booking_id uuid,seller_id uuid not null references auth.users(id) on delete restrict,
  request_id uuid not null,request_fingerprint text not null,
  total_minor bigint not null check(total_minor>0),occurred_at timestamptz not null default now(),
  unique(id,organization_id),unique(organization_id,request_id)
);
-- Earlier candidate rows remain untouched and cannot attest an unknown intent.
alter table public.sales_carts_candidate add column if not exists intent_lines jsonb
  check(intent_lines is null or jsonb_typeof(intent_lines)='array');
create table if not exists public.sales_cart_lines_candidate (
  organization_id uuid not null,cart_id uuid not null,line_index integer not null check(line_index>0),
  line_id text not null,sale_id uuid not null,inventory_item_id uuid not null,warehouse_id uuid not null,
  metadata_version bigint not null,sale_unit text not null,base_unit text not null,
  stock_per_sale_unit numeric(14,3) not null check(stock_per_sale_unit>0),
  sale_quantity numeric(14,3) not null check(sale_quantity>0),stock_quantity numeric(14,3) not null check(stock_quantity>0),
  unit_price_minor bigint not null check(unit_price_minor>0),discount_minor bigint not null check(discount_minor>=0),
  total_minor bigint not null check(total_minor>0),bundle_id uuid,bundle_version bigint,
  primary key(cart_id,line_index),unique(sale_id),unique(cart_id,line_id),
  foreign key(cart_id,organization_id) references public.sales_carts_candidate(id,organization_id) on delete restrict,
  foreign key(sale_id,organization_id) references public.commercial_sales(id,organization_id) on delete restrict,
  foreign key(inventory_item_id,organization_id) references public.inventory_items(id,organization_id) on delete restrict,
  foreign key(warehouse_id,organization_id) references public.inventory_warehouses(id,organization_id) on delete restrict,
  check(stock_quantity=sale_quantity*stock_per_sale_unit)
);
create index if not exists sales_carts_candidate_history_idx on public.sales_carts_candidate(organization_id,occurred_at desc,id desc);

create or replace function public.require_minuta_sales_candidate(p_organization uuid,p_write boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare a uuid;enabled boolean;
begin
  a:=public.require_minuta_financial_manager_v129(p_organization);
  if p_write then select writes_enabled into enabled from public.sales_catalog_candidate_state where singleton for share;end if;
  if p_write and not coalesce(enabled,false) then
    raise exception using errcode='55000',message='sales_catalog_writes_disabled';
  end if;
  return a;
end $$;

-- Expand physical bundles only; caller supplies expected component versions/prices.
create or replace function public.expand_minuta_sales_lines_candidate(p_organization uuid,p_lines jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;c jsonb;expected jsonb;b public.sales_catalog_bundles_candidate%rowtype;out_rows jsonb:='[]';n integer;i integer:=0;j integer;q numeric;parent_id text;
begin
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 50 then
    raise exception using errcode='22023',message='invalid_catalog_cart';end if;
  for r in select value from jsonb_array_elements(p_lines) loop
    i:=i+1;parent_id:=r->>'line_id';
    begin
      if jsonb_typeof(r)<>'object' or char_length(coalesce(parent_id,'')) not between 1 and 80
        or r ? 'benefit_product_id' or r ? 'item_kind' then raise exception using errcode='22023',message='invalid_catalog_cart_line';end if;
      q:=(r->>'quantity')::numeric;
      if q is null or q::text in('NaN','Infinity','-Infinity') or q<=0 or q<>round(q,3) or q>99999999999.999 then
        raise exception using errcode='22023',message='invalid_inventory_quantity';end if;
      if r->>'bundle_id' is null then
        if (r->>'inventory_item_id')::uuid is null or (r->>'warehouse_id')::uuid is null then
          raise exception using errcode='22023',message='invalid_catalog_cart_line';end if;
        out_rows:=out_rows||jsonb_build_array(r||jsonb_build_object('source_index',i));
      else
        if r ? 'inventory_item_id' or (r->>'warehouse_id')::uuid is null or coalesce((r->>'discount_minor')::numeric,0)<>0 then
          raise exception using errcode='22023',message='invalid_catalog_bundle_line';end if;
        select * into b from public.sales_catalog_bundles_candidate where id=(r->>'bundle_id')::uuid and organization_id=p_organization and active;
        if b.id is null or b.version is distinct from (r->>'bundle_version')::bigint then
          raise exception using errcode='40001',message='catalog_bundle_changed';end if;
        n:=jsonb_array_length(b.items);
        if jsonb_typeof(r->'components') is distinct from 'array' or jsonb_array_length(r->'components')<>n then
          raise exception using errcode='22023',message='invalid_catalog_bundle_components';end if;
        j:=0;
        for c in select value from jsonb_array_elements(b.items) loop
          expected:=r->'components'->j;j:=j+1;
          if expected->>'inventory_item_id' is distinct from c->>'inventory_item_id' then
            raise exception using errcode='40001',message='catalog_bundle_changed';end if;
          out_rows:=out_rows||jsonb_build_array(jsonb_build_object('line_id',parent_id||':'||j,
            'source_index',i,'inventory_item_id',c->>'inventory_item_id','warehouse_id',r->>'warehouse_id',
            'quantity',(c->>'quantity')::numeric*q,'metadata_version',expected->'metadata_version',
            'unit_price_minor',expected->'unit_price_minor','discount_minor',0,'bundle_id',b.id,'bundle_version',b.version));
        end loop;
      end if;
    exception when others then raise exception using errcode=sqlstate,message=sqlerrm,
      detail=jsonb_build_object('index',i,'line_id',parent_id)::text;end;
  end loop;
  if jsonb_array_length(out_rows)>100 or exists(select 1 from jsonb_array_elements(out_rows) x group by x->>'line_id' having count(*)>1)
    or exists(select 1 from jsonb_array_elements(p_lines) x group by x->>'line_id' having count(*)>1) then
    raise exception using errcode='22023',message='catalog_duplicate_or_excess_lines';end if;
  return out_rows;
end $$;

create or replace function public.get_minuta_sales_cart_candidate(p_organization uuid,p_request_id uuid,p_client_account uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.sales_carts_candidate%rowtype;
begin
  perform public.require_minuta_sales_candidate(p_organization,false);
  select * into c from public.sales_carts_candidate where organization_id=p_organization and request_id=p_request_id
    and client_account_id is not distinct from p_client_account;
  if c.id is null then return jsonb_build_object('found',false,'organization_id',p_organization,'client_account_id',p_client_account);end if;
  return jsonb_build_object('found',true,'organization_id',p_organization,'id',c.id,'client_account_id',c.client_account_id,'seller_id',c.seller_id,
    'booking_id',c.booking_id,'request_fingerprint',c.request_fingerprint,'intent_lines',c.intent_lines,
    'payment_method',(select s.payment_method from public.sales_cart_lines_candidate l join public.commercial_sales s
      on (s.id,s.organization_id)=(l.sale_id,l.organization_id) where l.cart_id=c.id order by l.line_index limit 1),
    'payment_account_id',(select s.payment_account_id from public.sales_cart_lines_candidate l join public.commercial_sales s
      on (s.id,s.organization_id)=(l.sale_id,l.organization_id) where l.cart_id=c.id order by l.line_index limit 1),
    'total_minor',c.total_minor,'occurred_at',c.occurred_at,'request_id',c.request_id,
    'refunded_minor',(select coalesce(sum(s.refunded_minor),0) from public.sales_cart_lines_candidate l
      join public.commercial_sales s on (s.id,s.organization_id)=(l.sale_id,l.organization_id) where l.cart_id=c.id),
    'lines',(select jsonb_agg(to_jsonb(l)||jsonb_build_object('status',s.status,'refunded_minor',s.refunded_minor,
      'refunded_quantity',sl.refunded_quantity,'item_name',sl.item_name) order by l.line_index)
      from public.sales_cart_lines_candidate l join public.commercial_sales s on (s.id,s.organization_id)=(l.sale_id,l.organization_id)
      join public.commercial_sale_lines sl on (sl.sale_id,sl.organization_id)=(s.id,s.organization_id) where l.cart_id=c.id));
end $$;

create or replace function public.sell_minuta_inventory_cart_candidate(
  p_organization uuid,p_booking uuid,p_client_account uuid,p_seller uuid,p_lines jsonb,
  p_payment_method text,p_payment_account uuid,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid;seller uuid;fp text;c public.sales_carts_candidate%rowtype;r jsonb;expanded jsonb;validated jsonb:='[]';
  i public.inventory_items%rowtype;m public.sales_catalog_items_candidate%rowtype;account public.financial_accounts%rowtype;
  qty numeric;stock_qty numeric;price numeric;discount numeric;subtotal numeric;total numeric:=0;row_total bigint;
  idx integer:=0;result jsonb;movement jsonb;sale uuid;line uuid;txn uuid;revenue uuid;child_request uuid;lock_row record;
begin
  a:=public.require_minuta_sales_candidate(p_organization,true);seller:=coalesce(p_seller,a);
  if p_request_id is null or coalesce(p_payment_method,'') not in('cash','manual') or p_payment_account is null then
    raise exception using errcode='22023',message='invalid_catalog_cart';end if;
  fp:=public.minuta_financial_sha256_v129(jsonb_build_array('inventory-cart-candidate',p_organization,p_booking,p_client_account,
    seller,p_lines,p_payment_method,p_payment_account));
  -- Same commerce namespace as legacy; full cart intent is immutable across retries.
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':commerce:'||p_request_id::text,147));
  select * into c from public.sales_carts_candidate where organization_id=p_organization and request_id=p_request_id;
  if found then
    if c.request_fingerprint<>fp then raise exception using errcode='23505',message='catalog_request_conflict';end if;
    return public.get_minuta_sales_cart_candidate(p_organization,p_request_id,p_client_account)||jsonb_build_object('replayed',true);
  end if;
  if exists(select 1 from public.commercial_sales where organization_id=p_organization and request_id=p_request_id) then
    raise exception using errcode='23505',message='catalog_request_conflict';end if;
  if not exists(select 1 from public.organization_memberships where organization_id=p_organization and user_id=seller and active) then
    raise exception using errcode='42501',message='commercial_seller_not_active_member';end if;
  if not coalesce((select enabled from public.organization_finance_settings where organization_id=p_organization),false) then
    raise exception using errcode='55000',message='finance_disabled';end if;
  if not coalesce((select enabled from public.organization_inventory_settings where organization_id=p_organization),false) then
    raise exception using errcode='55000',message='inventory_disabled';end if;
  select * into account from public.financial_accounts where id=p_payment_account and organization_id=p_organization and active for update;
  if account.id is null or account.system_key is not null or account.account_type not in('cash','bank') then
    raise exception using errcode='22023',message='cash_or_bank_account_required';end if;
  if p_payment_method='cash' and account.account_type<>'cash' then raise exception using errcode='22023',message='cash_account_required';end if;
  if p_client_account is not null and not exists(select 1 from public.bookings where organization_id=p_organization and client_account_id=p_client_account) then
    raise exception using errcode='42501',message='commercial_client_mismatch';end if;
  if p_booking is not null and not exists(select 1 from public.bookings where id=p_booking and organization_id=p_organization
    and client_account_id is not distinct from p_client_account) then raise exception using errcode='42501',message='commercial_booking_mismatch';end if;
  expanded:=public.expand_minuta_sales_lines_candidate(p_organization,p_lines);
  -- v130 lock hierarchy: global shared -> organization -> ordered item rows -> ordered warehouse/item locks.
  perform pg_advisory_xact_lock_shared(13000);
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text,13001));
  perform 1 from public.inventory_items where organization_id=p_organization and id in(
    select (value->>'inventory_item_id')::uuid from jsonb_array_elements(expanded)) order by id for update;
  for lock_row in select distinct (value->>'warehouse_id')::uuid warehouse_id,(value->>'inventory_item_id')::uuid item_id
    from jsonb_array_elements(expanded) order by warehouse_id,item_id loop
    perform pg_advisory_xact_lock(hashtextextended(lock_row.warehouse_id::text||':'||lock_row.item_id::text,8201));
  end loop;
  for r in select value from jsonb_array_elements(expanded) loop
    idx:=idx+1;
    begin
      select * into i from public.inventory_items where id=(r->>'inventory_item_id')::uuid and organization_id=p_organization and active;
      select * into m from public.sales_catalog_items_candidate where inventory_item_id=i.id and organization_id=p_organization;
      if i.id is null or m.inventory_item_id is null or m.purpose not in('retail','both') then
        raise exception using errcode='55000',message='catalog_item_not_sellable';end if;
      if m.base_unit<>i.unit or m.metadata_version is distinct from (r->>'metadata_version')::bigint then
        raise exception using errcode='40001',message='catalog_metadata_changed';end if;
      qty:=(r->>'quantity')::numeric;price:=(r->>'unit_price_minor')::numeric;discount:=coalesce((r->>'discount_minor')::numeric,0);
      if qty is null or qty::text in('NaN','Infinity','-Infinity') or qty<=0 or qty>99999999999.999 or qty<>round(qty,3)
        or (m.sale_unit in('pack','piece') and qty<>trunc(qty)) then
        raise exception using errcode='22023',message='invalid_inventory_quantity';end if;
      if price is null or m.sale_price_minor is null or price is distinct from m.sale_price_minor::numeric then
        raise exception using errcode='40001',message='catalog_price_changed';end if;
      stock_qty:=qty*m.stock_per_sale_unit;
      if stock_qty<=0 or stock_qty>99999999999.999 or stock_qty<>round(stock_qty,3) then
        raise exception using errcode='22023',message='catalog_stock_precision_invalid';end if;
      subtotal:=round(qty*price);
      if discount::text in('NaN','Infinity','-Infinity') or discount<0 or discount<>trunc(discount) or discount>=subtotal
        or subtotal>9223372036854775807 then raise exception using errcode='22023',message='invalid_catalog_line_total';end if;
      if not exists(select 1 from public.inventory_warehouses where id=(r->>'warehouse_id')::uuid and organization_id=p_organization and active) then
        raise exception using errcode='42501',message='catalog_warehouse_scope_mismatch';end if;
      total:=total+subtotal-discount;
      if total>9223372036854775807 then raise exception using errcode='22003',message='catalog_cart_total_out_of_range';end if;
      validated:=validated||jsonb_build_array(r||jsonb_build_object('quantity',qty,'stock_quantity',stock_qty,'unit_price_minor',price,
        'discount_minor',discount,'subtotal_minor',subtotal,'total_minor',subtotal-discount,'sale_unit',m.sale_unit,'base_unit',m.base_unit,
        'stock_per_sale_unit',m.stock_per_sale_unit,'item_name',i.name));
    exception when others then raise exception using errcode=sqlstate,message=sqlerrm,
      detail=jsonb_build_object('index',r->'source_index','line_id',r->>'line_id')::text;end;
  end loop;
  -- Validate aggregate demand when repeated lines target the same physical balance.
  for lock_row in select (value->>'warehouse_id')::uuid warehouse_id,(value->>'inventory_item_id')::uuid item_id,
      sum((value->>'stock_quantity')::numeric) demand,jsonb_agg(value->>'line_id') line_ids
    from jsonb_array_elements(validated) group by warehouse_id,item_id order by warehouse_id,item_id loop
    if lock_row.demand>coalesce((select quantity from public.inventory_stock_balances where organization_id=p_organization
      and warehouse_id=lock_row.warehouse_id and inventory_item_id=lock_row.item_id),0) then
      raise exception using errcode='55000',message='insufficient_inventory_stock',detail=jsonb_build_object('line_ids',lock_row.line_ids,
        'inventory_item_id',lock_row.item_id,'warehouse_id',lock_row.warehouse_id)::text;
    end if;
  end loop;
  insert into public.financial_accounts(organization_id,name,account_class,account_type,system_key,created_by)
    values(p_organization,'Выручка от продаж','income','product_revenue','product_revenue',a) on conflict(organization_id,system_key) do nothing;
  select id into revenue from public.financial_accounts where organization_id=p_organization and system_key='product_revenue' and active for update;
  if revenue is null then raise exception using errcode='55000',message='catalog_revenue_account_inactive';end if;
  insert into public.sales_carts_candidate(organization_id,client_account_id,booking_id,seller_id,request_id,request_fingerprint,total_minor,intent_lines)
    values(p_organization,p_client_account,p_booking,seller,p_request_id,fp,total::bigint,p_lines) returning * into c;
  idx:=0;
  for r in select value from jsonb_array_elements(validated) loop
    idx:=idx+1;
    begin
      -- First child reserves the caller's legacy request ID; subsequent children are deterministic.
      child_request:=case when idx=1 then p_request_id else md5('sales-cart-candidate:'||p_request_id::text||':'||idx)::uuid end;
      insert into public.commercial_sales(organization_id,booking_id,client_account_id,seller_id,status,payment_method,payment_account_id,
        subtotal_minor,discount_minor,total_minor,request_id,request_fingerprint,occurred_at)
      values(p_organization,p_booking,p_client_account,seller,'paid',p_payment_method,p_payment_account,
        (r->>'subtotal_minor')::bigint,(r->>'discount_minor')::bigint,(r->>'total_minor')::bigint,child_request,fp,c.occurred_at) returning id into sale;
      movement:=public.apply_minuta_stock_movement(p_organization,(r->>'warehouse_id')::uuid,(r->>'inventory_item_id')::uuid,
        'write_off',(r->>'stock_quantity')::numeric,null,'Продажа '||sale::text,md5(child_request::text||':inventory')::uuid);
      insert into public.commercial_sale_lines(organization_id,sale_id,item_kind,inventory_item_id,warehouse_id,inventory_movement_id,
        item_name,quantity,unit_price_minor,subtotal_minor,discount_minor,total_minor)
      values(p_organization,sale,'inventory_item',(r->>'inventory_item_id')::uuid,(r->>'warehouse_id')::uuid,(movement->>'id')::bigint,
        r->>'item_name',(r->>'quantity')::numeric,(r->>'unit_price_minor')::bigint,(r->>'subtotal_minor')::bigint,
        (r->>'discount_minor')::bigint,(r->>'total_minor')::bigint) returning id into line;
      insert into public.sales_cart_lines_candidate values(p_organization,c.id,idx,r->>'line_id',sale,(r->>'inventory_item_id')::uuid,
        (r->>'warehouse_id')::uuid,(r->>'metadata_version')::bigint,r->>'sale_unit',r->>'base_unit',(r->>'stock_per_sale_unit')::numeric,
        (r->>'quantity')::numeric,(r->>'stock_quantity')::numeric,(r->>'unit_price_minor')::bigint,(r->>'discount_minor')::bigint,
        (r->>'total_minor')::bigint,(r->>'bundle_id')::uuid,(r->>'bundle_version')::bigint);
      insert into public.financial_transactions(organization_id,request_id,request_fingerprint,operation_type,source_type,source_id,
        source_fingerprint,occurred_at,explanation,created_by)
      values(p_organization,md5(child_request::text||':finance')::uuid,fp,'commercial_sale','commercial_sale',sale,fp,c.occurred_at,
        jsonb_build_object('schema','sales-cart-candidate','cart_id',c.id,'sale_id',sale,'line_id',line,'seller_id',seller,
          'total_minor',(r->>'total_minor')::bigint,'stock_quantity',(r->>'stock_quantity')::numeric),a) returning id into txn;
      insert into public.financial_postings(organization_id,transaction_id,account_id,side,amount_minor) values
        (p_organization,txn,p_payment_account,'debit',(r->>'total_minor')::bigint),
        (p_organization,txn,revenue,'credit',(r->>'total_minor')::bigint);
      insert into public.commercial_audit_log(organization_id,actor_id,action,subject_id,details)
        values(p_organization,a,'commercial_sale_created',sale,jsonb_build_object('cart_id',c.id,'line_id',line,'transaction_id',txn));
    exception when others then raise exception using errcode=sqlstate,message=sqlerrm,
      detail=jsonb_build_object('index',r->'source_index','line_id',r->>'line_id')::text;end;
  end loop;
  return public.get_minuta_sales_cart_candidate(p_organization,p_request_id,p_client_account)||jsonb_build_object('replayed',false);
end $$;

create or replace function public.protect_minuta_sales_candidate()
returns trigger language plpgsql security definer set search_path='' as $$
begin raise exception using errcode='55000',message='sales_catalog_snapshot_immutable'; end $$;
drop trigger if exists sales_cart_immutable_candidate on public.sales_carts_candidate;
create trigger sales_cart_immutable_candidate before update or delete on public.sales_carts_candidate
for each row execute function public.protect_minuta_sales_candidate();
drop trigger if exists sales_cart_lines_immutable_candidate on public.sales_cart_lines_candidate;
create trigger sales_cart_lines_immutable_candidate before update or delete on public.sales_cart_lines_candidate
for each row execute function public.protect_minuta_sales_candidate();
drop trigger if exists sales_requests_immutable_candidate on public.sales_catalog_requests_candidate;
create trigger sales_requests_immutable_candidate before update or delete on public.sales_catalog_requests_candidate
for each row execute function public.protect_minuta_sales_candidate();

-- Pure row validation reused by preview and commit; no stock/receipt/import side effects.
create or replace function public.normalize_minuta_sales_import_candidate(p_organization uuid,p_rows jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jsonb;rows_out jsonb:='[]';errors_out jsonb:='[]';i integer:=0;q numeric;price numeric;v uuid;item public.inventory_items%rowtype;meta public.sales_catalog_items_candidate%rowtype;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 200 then
    raise exception using errcode='22023',message='invalid_catalog_import';
  end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    i:=i+1;
    begin
      if jsonb_typeof(r)<>'object' or r ? 'stock_quantity' or r ? 'quantity' or r ? 'opening_stock' then
        raise exception using errcode='22023',message='catalog_import_metadata_only';
      end if;
      v:=nullif(r->>'inventory_item_id','')::uuid;
      q:=(r->>'stock_per_sale_unit')::numeric;price:=nullif(r->>'sale_price_minor','')::numeric;
      if char_length(btrim(coalesce(r->>'name',''))) not between 2 and 120 or char_length(coalesce(r->>'sku',''))>80
        or coalesce(r->>'unit','') not in('piece','ml','g','kg','l','pack')
        or coalesce(r->>'sale_unit','') not in('piece','ml','g','kg','l','pack')
        or coalesce(r->>'purpose','') not in('retail','consumable','both')
        or q is null or q::text in('NaN','Infinity','-Infinity') or q<=0 or q>99999999999.999 or q<>round(q,3)
        or (price is not null and (price::text in('NaN','Infinity','-Infinity') or price<=0 or price<>trunc(price) or price>9223372036854775807))
        or char_length(coalesce(r->>'category',''))>80 or char_length(coalesce(r->>'group_key',''))>80
        or char_length(coalesce(r->>'variant_label',''))>120 or char_length(coalesce(r->>'icon',''))>40
        or char_length(coalesce(r->>'description',''))>2000
        or char_length(coalesce(r->>'photo_url',''))>2048
        or (coalesce(r->>'photo_url','')<>'' and ((r->>'photo_url') !~ '^https://[^[:space:]]+$' or (r->>'photo_url') ~ '^https://[^/?#]*@')) then
        raise exception using errcode='22023',message='invalid_catalog_item';
      end if;
      -- Same physical unit requires factor1; fixed mass/volume conversions cannot be invented.
      if (r->>'sale_unit'=r->>'unit' and q<>1)
        or (r->>'sale_unit'='l' and r->>'unit'='ml' and q<>1000)
        or (r->>'sale_unit'='ml' and r->>'unit'='l' and q<>0.001)
        or (r->>'sale_unit'='kg' and r->>'unit'='g' and q<>1000)
        or (r->>'sale_unit'='g' and r->>'unit'='kg' and q<>0.001)
        or (r->>'sale_unit'<>r->>'unit' and r->>'sale_unit' not in('pack','piece')
          and not ((r->>'sale_unit',r->>'unit') in(('l','ml'),('ml','l'),('kg','g'),('g','kg')))) then
        raise exception using errcode='22023',message='catalog_unit_conversion_invalid';
      end if;
      item:=null;meta:=null;
      if v is not null then
        select * into item from public.inventory_items where id=v and organization_id=p_organization;
        if item.id is null then raise exception using errcode='42501',message='catalog_item_scope_mismatch'; end if;
        select * into meta from public.sales_catalog_items_candidate where organization_id=p_organization and inventory_item_id=v;
        if (meta.inventory_item_id is not null and (r->>'metadata_version')::bigint is distinct from meta.metadata_version)
          or (meta.inventory_item_id is null and coalesce((r->>'metadata_version')::bigint,0)<>0) then
          raise exception using errcode='40001',message='catalog_metadata_changed';
        end if;
        if item.unit<>r->>'unit' then
          raise exception using errcode='55000',message='catalog_base_unit_locked';
        end if;
      end if;
      if coalesce(r->>'sku','')<>'' and exists(select 1 from public.inventory_items where organization_id=p_organization
        and lower(sku)=lower(btrim(r->>'sku')) and id is distinct from v) then
        raise exception using errcode='23505',message='catalog_sku_conflict';
      end if;
      rows_out:=rows_out||jsonb_build_array(jsonb_build_object('inventory_item_id',v,'name',btrim(r->>'name'),
        'sku',btrim(coalesce(r->>'sku','')),'unit',r->>'unit','sale_unit',r->>'sale_unit','stock_per_sale_unit',q,
        'sale_price_minor',price,'purpose',r->>'purpose','category',btrim(coalesce(r->>'category','')),
        'group_key',btrim(coalesce(r->>'group_key','')),'variant_label',btrim(coalesce(r->>'variant_label','')),
        'icon',coalesce(r->>'icon',''),'photo_url',coalesce(r->>'photo_url',''),'description',coalesce(r->>'description',''),
        'active',coalesce((r->>'active')::boolean,item.active,true),'metadata_version',coalesce(meta.metadata_version,0)));
    exception when others then
      errors_out:=errors_out||jsonb_build_array(jsonb_build_object('index',i,'code',sqlstate,'message',sqlerrm));
    end;
  end loop;
  if exists(select 1 from jsonb_array_elements(rows_out) x where coalesce(x->>'sku','')<>'' group by lower(x->>'sku') having count(*)>1)
    or exists(select 1 from jsonb_array_elements(rows_out) x where x->>'inventory_item_id' is not null group by x->>'inventory_item_id' having count(*)>1) then
    errors_out:=errors_out||jsonb_build_array(jsonb_build_object('index',0,'code','23505','message','catalog_duplicate_import_item'));
  end if;
  return jsonb_build_object('rows',rows_out,'errors',errors_out,'preview_hash',public.minuta_financial_sha256_v129(jsonb_build_array(p_organization,p_rows)));
end $$;

create or replace function public.preview_minuta_sales_import_candidate(p_organization uuid,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin perform public.require_minuta_sales_candidate(p_organization,false);return public.normalize_minuta_sales_import_candidate(p_organization,p_rows);end $$;

create or replace function public.persist_minuta_sales_import_candidate(p_organization uuid,p_rows jsonb,p_preview_hash text,p_confirmed boolean,p_request_id uuid,p_owner_only boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid;fp text;prev public.sales_catalog_requests_candidate%rowtype;preview jsonb;r jsonb;result jsonb:='[]';v uuid;i integer:=0;kind text;
begin
  a:=public.require_minuta_sales_candidate(p_organization,true);
  if p_owner_only and not public.has_organization_role(p_organization,array['owner']) then raise exception using errcode='42501',message='catalog_import_owner_required';end if;
  if not p_owner_only and (jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)<>1) then
    raise exception using errcode='22023',message='catalog_item_save_single_row_required';end if;
  if p_confirmed is distinct from true or p_request_id is null then raise exception using errcode='22023',message='catalog_import_confirmation_required';end if;
  kind:=case when p_owner_only then 'import' else 'item' end;
  fp:=public.minuta_financial_sha256_v129(jsonb_build_array(kind,p_organization,p_rows,p_preview_hash,p_confirmed));
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':sales-catalog:'||p_request_id::text,147));
  select * into prev from public.sales_catalog_requests_candidate where organization_id=p_organization and request_id=p_request_id;
  if found then
    if prev.fingerprint<>fp or prev.kind<>kind then raise exception using errcode='23505',message='catalog_request_conflict';end if;
    return prev.result||jsonb_build_object('replayed',true);
  end if;
  preview:=public.normalize_minuta_sales_import_candidate(p_organization,p_rows);
  if p_preview_hash is distinct from preview->>'preview_hash' then raise exception using errcode='40001',message='catalog_preview_changed';end if;
  if jsonb_array_length(preview->'errors')>0 then raise exception using errcode='22023',message='catalog_import_invalid',detail=(preview->'errors')::text;end if;
  for r in select value from jsonb_array_elements(preview->'rows') loop
    i:=i+1;
    begin
      v:=(public.upsert_minuta_inventory_item(p_organization,(r->>'inventory_item_id')::uuid,r->>'name',r->>'sku',r->>'unit',
        coalesce((select low_stock_threshold from public.inventory_items where id=(r->>'inventory_item_id')::uuid and organization_id=p_organization),0),
        (r->>'active')::boolean)->>'id')::uuid;
      insert into public.sales_catalog_items_candidate(organization_id,inventory_item_id,category,purpose,group_key,variant_label,
        sale_unit,base_unit,stock_per_sale_unit,sale_price_minor,icon,photo_url,description)
      values(p_organization,v,r->>'category',r->>'purpose',r->>'group_key',r->>'variant_label',r->>'sale_unit',r->>'unit',
        (r->>'stock_per_sale_unit')::numeric,(r->>'sale_price_minor')::bigint,r->>'icon',r->>'photo_url',r->>'description')
      on conflict(organization_id,inventory_item_id) do update set category=excluded.category,purpose=excluded.purpose,
        group_key=excluded.group_key,variant_label=excluded.variant_label,sale_unit=excluded.sale_unit,base_unit=excluded.base_unit,
        stock_per_sale_unit=excluded.stock_per_sale_unit,sale_price_minor=excluded.sale_price_minor,icon=excluded.icon,
        photo_url=excluded.photo_url,description=excluded.description,metadata_version=public.sales_catalog_items_candidate.metadata_version+1,updated_at=now();
      result:=result||jsonb_build_array(jsonb_build_object('inventory_item_id',v,'metadata_version',
        (select metadata_version from public.sales_catalog_items_candidate where organization_id=p_organization and inventory_item_id=v)));
    exception when others then raise exception using errcode=sqlstate,message=sqlerrm,detail=jsonb_build_object('index',i)::text;end;
  end loop;
  preview:=jsonb_build_object('items',result,'replayed',false);
  insert into public.sales_catalog_requests_candidate values(p_organization,p_request_id,kind,fp,preview,a);
  return preview;
end $$;

create or replace function public.commit_minuta_sales_import_candidate(p_organization uuid,p_rows jsonb,p_preview_hash text,p_confirmed boolean,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin return public.persist_minuta_sales_import_candidate(p_organization,p_rows,p_preview_hash,p_confirmed,p_request_id,true);end $$;

create or replace function public.save_minuta_sales_item_candidate(p_organization uuid,p_item jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare rows_in jsonb;fp text;
begin
  rows_in:=jsonb_build_array(p_item);fp:=public.minuta_financial_sha256_v129(jsonb_build_array(p_organization,rows_in));
  return public.persist_minuta_sales_import_candidate(p_organization,rows_in,fp,true,p_request_id,false);
end $$;

create or replace function public.save_minuta_sales_bundle_candidate(p_organization uuid,p_bundle uuid,p_name text,p_items jsonb,p_version bigint,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid;fp text;old public.sales_catalog_requests_candidate%rowtype;b public.sales_catalog_bundles_candidate%rowtype;r jsonb;q numeric;outcome jsonb;
begin
  a:=public.require_minuta_sales_candidate(p_organization,true);
  if p_request_id is null or char_length(btrim(coalesce(p_name,''))) not between 2 and 120
    or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 2 and 30 then
    raise exception using errcode='22023',message='invalid_catalog_bundle';end if;
  fp:=public.minuta_financial_sha256_v129(jsonb_build_array('bundle',p_organization,p_bundle,p_name,p_items,p_version));
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':sales-catalog:'||p_request_id::text,147));
  select * into old from public.sales_catalog_requests_candidate where organization_id=p_organization and request_id=p_request_id;
  if found then
    if old.kind<>'bundle' or old.fingerprint<>fp then raise exception using errcode='23505',message='catalog_request_conflict';end if;
    return old.result||jsonb_build_object('replayed',true);
  end if;
  if exists(select 1 from jsonb_array_elements(p_items) x group by x->>'inventory_item_id' having count(*)>1) then
    raise exception using errcode='22023',message='catalog_duplicate_bundle_item';end if;
  for r in select value from jsonb_array_elements(p_items) loop
    q:=(r->>'quantity')::numeric;
    if q is null or q::text in('NaN','Infinity','-Infinity') or q<=0 or q<>round(q,3) or q>99999999999.999
      or not exists(select 1 from public.sales_catalog_items_candidate m join public.inventory_items i
        on (i.id,i.organization_id)=(m.inventory_item_id,m.organization_id)
        where m.organization_id=p_organization and m.inventory_item_id=(r->>'inventory_item_id')::uuid
        and i.active and m.purpose in('retail','both') and m.base_unit=i.unit) then
      raise exception using errcode='22023',message='invalid_catalog_bundle_item';end if;
    if exists(select 1 from public.sales_catalog_items_candidate m where m.organization_id=p_organization
      and m.inventory_item_id=(r->>'inventory_item_id')::uuid and ((m.sale_unit in('pack','piece') and q<>trunc(q))
        or q*m.stock_per_sale_unit<>round(q*m.stock_per_sale_unit,3) or q*m.stock_per_sale_unit>99999999999.999)) then
      raise exception using errcode='22023',message='invalid_catalog_bundle_quantity';end if;
  end loop;
  if p_bundle is null then
    if coalesce(p_version,0)<>0 then raise exception using errcode='40001',message='catalog_bundle_changed';end if;
    insert into public.sales_catalog_bundles_candidate(organization_id,name,items) values(p_organization,btrim(p_name),p_items) returning * into b;
  else
    update public.sales_catalog_bundles_candidate set name=btrim(p_name),items=p_items,version=version+1
      where id=p_bundle and organization_id=p_organization and version=p_version returning * into b;
    if b.id is null then raise exception using errcode='40001',message='catalog_bundle_changed';end if;
  end if;
  outcome:=jsonb_build_object('id',b.id,'version',b.version,'replayed',false);
  insert into public.sales_catalog_requests_candidate values(p_organization,p_request_id,'bundle',fp,outcome,a);
  return outcome;
end $$;

create or replace function public.set_minuta_sales_favorite_candidate(p_organization uuid,p_item uuid,p_favorite boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid;
begin
  a:=public.require_minuta_sales_candidate(p_organization,true);
  if p_favorite is null or not exists(select 1 from public.inventory_items where id=p_item and organization_id=p_organization) then
    raise exception using errcode='42501',message='catalog_item_scope_mismatch';end if;
  if p_favorite then insert into public.sales_catalog_favorites_candidate values(p_organization,a,p_item) on conflict do nothing;
  else delete from public.sales_catalog_favorites_candidate where organization_id=p_organization and actor_id=a and inventory_item_id=p_item;end if;
  return jsonb_build_object('inventory_item_id',p_item,'favorite',p_favorite);
end $$;

create or replace function public.get_minuta_sales_catalog_candidate(p_organization uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid;
begin
  a:=public.require_minuta_sales_candidate(p_organization,false);
  return jsonb_build_object('organization_id',p_organization,
    'capabilities',jsonb_build_object('catalog',true,'atomic_cart',true,'import_preview',true,'bundles',true,'frozen_conversion',true,
      'writes_enabled',(select writes_enabled from public.sales_catalog_candidate_state where singleton)),
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'name',i.name,'sku',i.sku,'unit',i.unit,'active',i.active,
      'low_stock_threshold',i.low_stock_threshold,'category',m.category,'purpose',m.purpose,'group_key',m.group_key,
      'variant_label',m.variant_label,'sale_unit',coalesce(m.sale_unit,i.unit),'base_unit',i.unit,
      'stock_per_sale_unit',coalesce(m.stock_per_sale_unit,1),'sale_price_minor',m.sale_price_minor,'icon',m.icon,
      'photo_url',m.photo_url,'description',m.description,'metadata_version',coalesce(m.metadata_version,0),
      'catalog_ready',m.inventory_item_id is not null and m.base_unit=i.unit,'favorite',f.inventory_item_id is not null)
      order by i.name,i.id) from public.inventory_items i
      left join public.sales_catalog_items_candidate m on (m.inventory_item_id,m.organization_id)=(i.id,i.organization_id)
      left join public.sales_catalog_favorites_candidate f on (f.inventory_item_id,f.organization_id,f.actor_id)=(i.id,i.organization_id,a)
      where i.organization_id=p_organization),'[]'::jsonb),
    'warehouses',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'location_id',location_id,'active',active) order by name,id)
      from public.inventory_warehouses where organization_id=p_organization),'[]'::jsonb),
    'balances',coalesce((select jsonb_agg(jsonb_build_object('warehouse_id',warehouse_id,'inventory_item_id',inventory_item_id,
      'quantity',quantity,'updated_at',updated_at) order by warehouse_id,inventory_item_id)
      from public.inventory_stock_balances where organization_id=p_organization),'[]'::jsonb),
    'bundles',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'items',items,'version',version,'active',active) order by name,id)
      from public.sales_catalog_bundles_candidate where organization_id=p_organization),'[]'::jsonb));
end $$;

create or replace function public.get_minuta_sales_repeat_candidate(p_organization uuid,p_client_account uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare last_sale uuid;cart public.sales_carts_candidate%rowtype;prior jsonb;catalog_now jsonb;
begin
  perform public.require_minuta_sales_candidate(p_organization,false);
  if p_client_account is null or not exists(select 1 from public.bookings where organization_id=p_organization and client_account_id=p_client_account) then
    raise exception using errcode='42501',message='commercial_client_mismatch';end if;
  select s.id into last_sale from public.commercial_sales s join public.commercial_sale_lines l on (l.sale_id,l.organization_id)=(s.id,s.organization_id)
    where s.organization_id=p_organization and s.client_account_id=p_client_account and l.item_kind='inventory_item'
    order by s.occurred_at desc,s.id desc limit 1;
  if last_sale is null then return jsonb_build_object('found',false,'organization_id',p_organization,'client_account_id',p_client_account);end if;
  select c.* into cart from public.sales_carts_candidate c join public.sales_cart_lines_candidate l
    on (l.cart_id,l.organization_id)=(c.id,c.organization_id) where l.sale_id=last_sale;
  if cart.id is not null then
    prior:=public.get_minuta_sales_cart_candidate(p_organization,cart.request_id,p_client_account);
  else
    prior:=jsonb_build_object('found',true,'organization_id',p_organization,'legacy',true,'client_account_id',p_client_account,'lines',
      (select jsonb_agg(jsonb_build_object('line_id','legacy:'||l.id,'sale_id',l.sale_id,'inventory_item_id',l.inventory_item_id,
        'warehouse_id',l.warehouse_id,'sale_quantity',l.quantity,'stock_quantity',l.quantity,'sale_unit',i.unit,'base_unit',i.unit,
        'stock_per_sale_unit',1,'unit_price_minor',l.unit_price_minor,'total_minor',l.total_minor))
       from public.commercial_sale_lines l join public.inventory_items i on (i.id,i.organization_id)=(l.inventory_item_id,l.organization_id)
       where l.sale_id=last_sale and l.organization_id=p_organization));
  end if;
  catalog_now:=public.get_minuta_sales_catalog_candidate(p_organization);
  -- Only selected purchase components; no other client's history, no automatic sale.
  return prior||jsonb_build_object('current_items',coalesce((select jsonb_agg(x) from jsonb_array_elements(catalog_now->'items') x
    where x->>'id' in(select value->>'inventory_item_id' from jsonb_array_elements(prior->'lines'))),'[]'::jsonb),
    'current_balances',coalesce((select jsonb_agg(x) from jsonb_array_elements(catalog_now->'balances') x
    where x->>'inventory_item_id' in(select value->>'inventory_item_id' from jsonb_array_elements(prior->'lines'))),'[]'::jsonb),
    'requires_current_validation',true);
end $$;

create or replace function public.get_minuta_sales_history_candidate(p_organization uuid,p_client_account uuid,p_limit integer default 50,
  p_filter_client boolean default true,p_before timestamptz default null,p_before_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare entry record;out_rows jsonb:='[]';payload jsonb;totals jsonb;last_cursor jsonb;more boolean;
begin
  perform public.require_minuta_sales_candidate(p_organization,false);
  if p_limit is null or p_limit not between 1 and 100 then raise exception using errcode='22023',message='invalid_catalog_history_limit';end if;
  if p_filter_client is null or (not p_filter_client and p_client_account is not null) or (p_before is null)<>(p_before_id is null) then
    raise exception using errcode='22023',message='invalid_catalog_history_filter';end if;
  if p_client_account is not null and not exists(select 1 from public.bookings where organization_id=p_organization and client_account_id=p_client_account) then
    raise exception using errcode='42501',message='commercial_client_mismatch';end if;
  select jsonb_build_object('grouped_count',count(*),'gross_minor',coalesce(sum(gross),0),
    'refunded_minor',coalesce(sum(refunded),0),'net_minor',coalesce(sum(gross-refunded),0)) into totals from (
    select c.total_minor gross,(select coalesce(sum(s.refunded_minor),0) from public.sales_cart_lines_candidate l
      join public.commercial_sales s on (s.id,s.organization_id)=(l.sale_id,l.organization_id) where l.cart_id=c.id) refunded
      from public.sales_carts_candidate c where c.organization_id=p_organization
        and (not p_filter_client or c.client_account_id is not distinct from p_client_account)
    union all select s.total_minor,s.refunded_minor from public.commercial_sales s where s.organization_id=p_organization
      and (not p_filter_client or s.client_account_id is not distinct from p_client_account)
      and not exists(select 1 from public.sales_cart_lines_candidate l where l.sale_id=s.id and l.organization_id=s.organization_id)
  ) all_purchases;
  more:=false;
  for entry in
    select * from (
      select c.id,c.request_id,c.occurred_at,false legacy from public.sales_carts_candidate c
        where c.organization_id=p_organization and (not p_filter_client or c.client_account_id is not distinct from p_client_account)
      union all
      select s.id,s.request_id,s.occurred_at,true legacy from public.commercial_sales s
        where s.organization_id=p_organization and (not p_filter_client or s.client_account_id is not distinct from p_client_account)
          and not exists(select 1 from public.sales_cart_lines_candidate l where l.sale_id=s.id and l.organization_id=s.organization_id)
    ) purchases where p_before is null or (occurred_at,id)<(p_before,p_before_id)
      order by occurred_at desc,id desc limit p_limit+1
  loop
    if jsonb_array_length(out_rows)=p_limit then more:=true;exit;end if;
    if not entry.legacy then
      payload:=public.get_minuta_sales_cart_candidate(p_organization,entry.request_id,
        (select client_account_id from public.sales_carts_candidate where id=entry.id and organization_id=p_organization));
    else
      select jsonb_build_object('id',s.id,'organization_id',p_organization,'legacy',true,'client_account_id',s.client_account_id,'total_minor',s.total_minor,
        'refunded_minor',s.refunded_minor,'occurred_at',s.occurred_at,'lines',jsonb_build_array(to_jsonb(l))) into payload
        from public.commercial_sales s join public.commercial_sale_lines l on (l.sale_id,l.organization_id)=(s.id,s.organization_id)
        where s.id=entry.id and s.organization_id=p_organization;
    end if;
    out_rows:=out_rows||jsonb_build_array(payload);
    last_cursor:=jsonb_build_object('before',entry.occurred_at,'before_id',entry.id);
  end loop;
  return totals||jsonb_build_object('organization_id',p_organization,'client_account_id',p_client_account,'filter_client',p_filter_client,
    'purchases',out_rows,'grouped',true,'next_cursor',case when more then last_cursor else null end);
end $$;

-- Narrow refund extension: same signature, same ACL, money/benefits logic unchanged.
-- Frozen snapshots govern receipt quantities even after metadata edits or operational rollback.
do $refund_extension$
declare original text;patched text;needle text:=$needle$'receipt',p_quantity,null,$needle$;
begin
  select legacy_refund_definition into original from public.sales_catalog_candidate_state where singleton;
  if length(original)-length(replace(original,needle,''))<>length(needle) then
    raise exception using errcode='55000',message='sales_catalog_exact_refund_body_required';end if;
  patched:=replace(original,needle,$replacement$'receipt',p_quantity*coalesce((
      select frozen.stock_per_sale_unit from public.sales_cart_lines_candidate frozen
      where frozen.organization_id=p_organization and frozen.sale_id=p_sale
    ),1),null,$replacement$);
  patched:=replace(patched,'  v_remaining_quantity:=v_line.quantity-v_line.refunded_quantity;',$precision$  if exists(
    select 1 from public.sales_cart_lines_candidate frozen where frozen.organization_id=p_organization and frozen.sale_id=p_sale
      and (p_quantity::text in('NaN','Infinity','-Infinity') or p_quantity<>round(p_quantity,3)
        or p_quantity*frozen.stock_per_sale_unit<>round(p_quantity*frozen.stock_per_sale_unit,3))
  ) then raise exception using errcode='22023',message='catalog_stock_precision_invalid';end if;
  v_remaining_quantity:=v_line.quantity-v_line.refunded_quantity;$precision$);
  execute patched;
  execute format('comment on function public.refund_minuta_commercial_sale_v147(uuid,uuid,numeric,bigint,text,uuid) is %L',
    'sales-catalog-candidate-refund:md5='||(select md5(prosrc) from pg_proc
      where oid='public.refund_minuta_commercial_sale_v147(uuid,uuid,numeric,bigint,text,uuid)'::regprocedure));
end $refund_extension$;

do $security$
declare t text;p record;
begin
  foreach t in array array['sales_catalog_candidate_state','sales_catalog_items_candidate','sales_catalog_bundles_candidate',
    'sales_catalog_favorites_candidate','sales_catalog_requests_candidate','sales_carts_candidate','sales_cart_lines_candidate'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('alter table public.%I force row level security',t);
    execute format('revoke all on table public.%I from public,anon,authenticated,service_role',t);
  end loop;
  for p in select pr.oid::regprocedure signature,pr.proname,pr.prosrc from pg_proc pr join pg_namespace n on n.oid=pr.pronamespace
    where n.nspname='public' and pr.proname=any(array['require_minuta_sales_candidate','protect_minuta_sales_candidate',
      'normalize_minuta_sales_import_candidate','persist_minuta_sales_import_candidate','save_minuta_sales_item_candidate','expand_minuta_sales_lines_candidate','get_minuta_sales_catalog_candidate',
      'get_minuta_sales_cart_candidate','get_minuta_sales_repeat_candidate','get_minuta_sales_history_candidate',
      'sell_minuta_inventory_cart_candidate','preview_minuta_sales_import_candidate','commit_minuta_sales_import_candidate',
      'save_minuta_sales_bundle_candidate','set_minuta_sales_favorite_candidate']) loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',p.signature);
    if p.proname in('get_minuta_sales_catalog_candidate','get_minuta_sales_cart_candidate','get_minuta_sales_repeat_candidate','get_minuta_sales_history_candidate',
      'sell_minuta_inventory_cart_candidate','preview_minuta_sales_import_candidate','commit_minuta_sales_import_candidate',
      'save_minuta_sales_bundle_candidate','set_minuta_sales_favorite_candidate','save_minuta_sales_item_candidate') then
      execute format('grant execute on function %s to authenticated',p.signature);
    end if;
    execute format('comment on function %s is %L',p.signature,'sales-catalog-candidate:md5='||md5(p.prosrc));
  end loop;
end $security$;
commit;
