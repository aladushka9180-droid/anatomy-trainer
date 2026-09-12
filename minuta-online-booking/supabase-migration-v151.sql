-- v151: selectable seller for atomic commercial sales.
-- Safe to reapply only while the exact stamped v151 functions are installed.
begin;
set local lock_timeout='10s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $dependency_guard$
begin
  if to_regclass('public.commercial_sales') is null
     or to_regclass('public.commercial_sale_lines') is null
     or to_regclass('public.organization_memberships') is null
     or to_regclass('public.performer_profiles') is null
     or to_regprocedure('public.sell_minuta_commercial_product_v147(uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid)') is null
     or to_regprocedure('public.get_minuta_commerce_workspace_v147(uuid)') is null
     or to_regprocedure('public.refund_minuta_commercial_sale_v147(uuid,uuid,numeric,bigint,text,uuid)') is null
     or obj_description(to_regprocedure('public.refund_minuta_commercial_sale_v147(uuid,uuid,numeric,bigint,text,uuid)')::oid,'pg_proc')
          is distinct from 'minuta_refund_safety_v148_proportional_rounding'
     or position('commercial_refund_amount_mismatch' in pg_get_functiondef(
          to_regprocedure('public.refund_minuta_commercial_sale_v147(uuid,uuid,numeric,bigint,text,uuid)'))) = 0
     or to_regprocedure('public.apply_minuta_benefit_v149(uuid,uuid,uuid,text,integer,uuid)') is null
     or to_regprocedure('public.protect_minuta_benefit_application_v149()') is null
     or to_regclass('public.benefit_application_requests') is null
     or to_regprocedure('public.set_minuta_benefit_lifecycle_v150(uuid,uuid,text,text,uuid)') is null
     or to_regprocedure('public.get_minuta_benefit_lifecycle_v150(uuid,uuid)') is null
     or to_regclass('public.benefit_freeze_periods') is null
     or to_regclass('public.benefit_lifecycle_requests') is null then
    raise exception using errcode='55000',message='v151_requires_exact_v147_v148_v149_v150';
  end if;
end
$dependency_guard$;

-- Refuse partial or newer same-signature v151 objects before CREATE OR REPLACE.
do $apply_version_guard$
declare v_name text;v_proc regprocedure;v_hash text;v_marker text;
begin
  if to_regprocedure('public.sell_minuta_commercial_product_v151(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid)') is null then
    if to_regprocedure('public.get_minuta_commerce_workspace_v151(uuid)') is not null then
      raise exception using errcode='55000',message='v151_apply_blocked_partial_or_newer_objects';
    end if;
  else
    if to_regprocedure('public.get_minuta_commerce_workspace_v151(uuid)') is null then
      raise exception using errcode='55000',message='v151_apply_blocked_partial_or_newer_objects';
    end if;
    foreach v_name in array array[
      'public.sell_minuta_commercial_product_v151(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid)',
      'public.get_minuta_commerce_workspace_v151(uuid)'
    ] loop
      v_proc:=to_regprocedure(v_name);
      select public.minuta_financial_sha256_v129(jsonb_build_object(
        'source',procedure_row.prosrc,'kind',procedure_row.prokind,'language',language_row.lanname,
        'owner',pg_get_userbyid(procedure_row.proowner),
        'volatility',procedure_row.provolatile,'security_definer',procedure_row.prosecdef,
        'strict',procedure_row.proisstrict,'leakproof',procedure_row.proleakproof,'parallel',procedure_row.proparallel,
        'result',pg_get_function_result(procedure_row.oid),'arguments',pg_get_function_arguments(procedure_row.oid),
        'identity_arguments',pg_get_function_identity_arguments(procedure_row.oid),
        'config',coalesce(to_jsonb(procedure_row.proconfig),'null'::jsonb),
        'acl',coalesce((select jsonb_agg(jsonb_build_object(
          'grantor',pg_get_userbyid(grant_row.grantor),
          'grantee',case grant_row.grantee when 0 then 'PUBLIC' else pg_get_userbyid(grant_row.grantee) end,
          'privilege',grant_row.privilege_type,'grantable',grant_row.is_grantable
        ) order by pg_get_userbyid(grant_row.grantor),
          case grant_row.grantee when 0 then 'PUBLIC' else pg_get_userbyid(grant_row.grantee) end,
          grant_row.privilege_type,grant_row.is_grantable)
          from aclexplode(procedure_row.proacl) grant_row),'[]'::jsonb)
      )),obj_description(procedure_row.oid,'pg_proc') into v_hash,v_marker
      from pg_catalog.pg_proc procedure_row
      join pg_catalog.pg_language language_row on language_row.oid=procedure_row.prolang
      where procedure_row.oid=v_proc;
      if v_marker is distinct from 'minuta_commercial_sales_v151:sha256='||v_hash then
        raise exception using errcode='55000',message='v151_apply_blocked_newer_function_definition';
      end if;
    end loop;
  end if;
end
$apply_version_guard$;

create or replace function public.sell_minuta_commercial_product_v151(
  p_organization uuid,p_booking uuid,p_client_account uuid,p_seller uuid,p_item_kind text,p_benefit_product uuid,
  p_inventory_item uuid,p_warehouse uuid,p_quantity numeric,p_unit_price_minor bigint,p_discount_minor bigint,
  p_payment_method text,p_payment_account uuid,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_actor uuid;
  v_seller uuid;
  v_sale public.commercial_sales%rowtype;
  v_account public.financial_accounts%rowtype;
  v_product public.benefit_products%rowtype;
  v_item public.inventory_items%rowtype;
  v_subtotal bigint;
  v_total bigint;
  v_fingerprint text;
  v_instrument jsonb;
  v_movement jsonb;
  v_revenue uuid;
  v_transaction uuid;
  v_line uuid;
begin
  v_actor:=public.require_minuta_financial_manager_v129(p_organization);
  v_seller:=coalesce(p_seller,v_actor);
  if p_request_id is null or p_item_kind not in('inventory_item','benefit_product') or p_payment_method not in('cash','manual')
     or coalesce(p_quantity,0)<=0 or p_unit_price_minor is null or p_unit_price_minor<=0 or coalesce(p_discount_minor,0)<0 then
    raise exception using errcode='22023',message='invalid_commercial_sale';
  end if;
  if p_quantity<>trunc(p_quantity) and p_item_kind='benefit_product' then
    raise exception using errcode='22023',message='invalid_benefit_quantity';
  end if;
  if p_item_kind='benefit_product'
     and (p_quantity<>1 or p_client_account is null or p_benefit_product is null or p_inventory_item is not null or p_warehouse is not null) then
    raise exception using errcode='22023',message='invalid_benefit_sale';
  end if;
  if p_item_kind='inventory_item'
     and (p_inventory_item is null or p_warehouse is null or p_benefit_product is not null) then
    raise exception using errcode='22023',message='invalid_inventory_sale';
  end if;
  v_subtotal:=round(p_quantity*p_unit_price_minor)::bigint;
  v_total:=v_subtotal-coalesce(p_discount_minor,0);
  if v_total<=0 then
    raise exception using errcode='22023',message='invalid_commercial_sale_total';
  end if;

  -- Share v147's lock namespace so mixed-version callers serialize on request_id.
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':commerce:'||p_request_id::text,147));
  select * into v_sale from public.commercial_sales
    where organization_id=p_organization and request_id=p_request_id for update;
  v_fingerprint:=public.minuta_financial_sha256_v129(jsonb_build_array(
    p_organization,p_booking,p_client_account,v_seller,p_item_kind,p_benefit_product,p_inventory_item,p_warehouse,
    p_quantity,p_unit_price_minor,coalesce(p_discount_minor,0),p_payment_method,p_payment_account));
  if v_sale.id is not null then
    if v_sale.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='commercial_sale_idempotency_conflict';
    end if;
    return jsonb_build_object(
      'id',v_sale.id,'organization_id',p_organization,'seller_id',v_sale.seller_id,
      'status',v_sale.status,'total_minor',v_sale.total_minor,'replayed',true);
  end if;

  if not exists(select 1 from public.organization_memberships membership
    where membership.organization_id=p_organization and membership.user_id=v_seller and membership.active) then
    raise exception using errcode='42501',message='commercial_seller_not_active_member';
  end if;

  if not coalesce((select enabled from public.organization_finance_settings where organization_id=p_organization),false) then
    raise exception using errcode='55000',message='finance_disabled';
  end if;
  select * into v_account from public.financial_accounts
    where id=p_payment_account and organization_id=p_organization and active for update;
  if v_account.id is null or v_account.system_key is not null or v_account.account_type not in('cash','bank') then
    raise exception using errcode='22023',message='cash_or_bank_account_required';
  end if;
  if p_payment_method='cash' and v_account.account_type<>'cash' then
    raise exception using errcode='22023',message='cash_account_required';
  end if;
  if p_client_account is not null and not exists(select 1 from public.bookings
    where organization_id=p_organization and client_account_id=p_client_account) then
    raise exception using errcode='42501',message='commercial_client_mismatch';
  end if;
  if p_booking is not null and not exists(select 1 from public.bookings
    where id=p_booking and organization_id=p_organization and client_account_id is not distinct from p_client_account) then
    raise exception using errcode='42501',message='commercial_booking_mismatch';
  end if;

  insert into public.financial_accounts(organization_id,name,account_class,account_type,system_key,created_by)
    values(p_organization,'Выручка от продаж','income','product_revenue','product_revenue',v_actor)
    on conflict(organization_id,system_key) do nothing;
  select id into v_revenue from public.financial_accounts
    where organization_id=p_organization and system_key='product_revenue' and active for update;

  insert into public.commercial_sales(
    organization_id,booking_id,client_account_id,seller_id,status,payment_method,payment_account_id,
    subtotal_minor,discount_minor,total_minor,request_id,request_fingerprint,occurred_at
  ) values(
    p_organization,p_booking,p_client_account,v_seller,'paid',p_payment_method,p_payment_account,
    v_subtotal,coalesce(p_discount_minor,0),v_total,p_request_id,v_fingerprint,now()
  ) returning * into v_sale;

  if p_item_kind='benefit_product' then
    select * into v_product from public.benefit_products
      where id=p_benefit_product and organization_id=p_organization and active for update;
    if v_product.id is null then
      raise exception using errcode='P0002',message='benefit_product_not_found';
    end if;
    v_instrument:=public.issue_minuta_benefit(
      p_organization,p_benefit_product,p_client_account,null,md5(p_request_id::text||':benefit')::uuid);
    insert into public.commercial_sale_lines(
      organization_id,sale_id,item_kind,benefit_product_id,benefit_instrument_id,item_name,quantity,
      unit_price_minor,subtotal_minor,discount_minor,total_minor
    ) values(
      p_organization,v_sale.id,p_item_kind,p_benefit_product,(v_instrument->>'id')::uuid,v_product.name,1,
      p_unit_price_minor,v_subtotal,coalesce(p_discount_minor,0),v_total
    ) returning id into v_line;
  else
    select * into v_item from public.inventory_items
      where id=p_inventory_item and organization_id=p_organization and active for update;
    if v_item.id is null then
      raise exception using errcode='P0002',message='inventory_item_not_found';
    end if;
    v_movement:=public.apply_minuta_stock_movement(
      p_organization,p_warehouse,p_inventory_item,'write_off',p_quantity,null,
      'Продажа '||v_sale.id::text,md5(p_request_id::text||':inventory')::uuid);
    insert into public.commercial_sale_lines(
      organization_id,sale_id,item_kind,inventory_item_id,warehouse_id,inventory_movement_id,item_name,quantity,
      unit_price_minor,subtotal_minor,discount_minor,total_minor
    ) values(
      p_organization,v_sale.id,p_item_kind,p_inventory_item,p_warehouse,(v_movement->>'id')::bigint,v_item.name,p_quantity,
      p_unit_price_minor,v_subtotal,coalesce(p_discount_minor,0),v_total
    ) returning id into v_line;
  end if;

  insert into public.financial_transactions(
    organization_id,request_id,request_fingerprint,operation_type,source_type,source_id,source_fingerprint,
    occurred_at,explanation,created_by
  ) values(
    p_organization,md5(p_request_id::text||':finance')::uuid,v_fingerprint,'commercial_sale','commercial_sale',
    v_sale.id,v_fingerprint,v_sale.occurred_at,
    jsonb_build_object(
      'schema','minuta-commerce-v2','sale_id',v_sale.id,'line_id',v_line,'item_kind',p_item_kind,
      'total_minor',v_total,'payment_method',p_payment_method,'booking_id',p_booking,
      'client_account_id',p_client_account,'seller_id',v_seller
    ),v_actor
  ) returning id into v_transaction;
  insert into public.financial_postings(organization_id,transaction_id,account_id,side,amount_minor) values
    (p_organization,v_transaction,p_payment_account,'debit',v_total),
    (p_organization,v_transaction,v_revenue,'credit',v_total);
  insert into public.commercial_audit_log(organization_id,actor_id,action,subject_id,details) values(
    p_organization,v_actor,'commercial_sale_created',v_sale.id,
    jsonb_build_object('line_id',v_line,'total_minor',v_total,'transaction_id',v_transaction,'seller_id',v_seller));

  return jsonb_build_object(
    'id',v_sale.id,'organization_id',p_organization,'seller_id',v_seller,'status','paid',
    'total_minor',v_total,'transaction_id',v_transaction,'replayed',false);
end
$$;

create or replace function public.get_minuta_commerce_workspace_v151(p_organization uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_actor uuid;
begin
  v_actor:=auth.uid();
  if v_actor is null or not public.has_organization_role(p_organization,array['owner','admin']) then
    raise exception using errcode='42501',message='commercial_finance_manager_required';
  end if;
  return jsonb_build_object(
    'organization_id',p_organization,
    'finance_enabled',coalesce((select enabled from public.organization_finance_settings where organization_id=p_organization),false),
    'benefits_enabled',coalesce((select enabled from public.organization_benefit_settings where organization_id=p_organization),false),
    'inventory_enabled',coalesce((select enabled from public.organization_inventory_settings where organization_id=p_organization),false),
    'accounts',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'account_type',account_type,'system_key',system_key) order by account_type,name) from public.financial_accounts where organization_id=p_organization and active),'[]'::jsonb),
    'sellers',coalesce((select jsonb_agg(jsonb_build_object('id',membership.user_id,'name',coalesce(profile.display_name,'Сотрудник'),'role',case membership.role when 'owner' then 'владелец' when 'admin' then 'администратор' else 'специалист' end) order by coalesce(profile.display_name,'Сотрудник'),membership.user_id) from public.organization_memberships membership left join public.performer_profiles profile on profile.id=membership.user_id where membership.organization_id=p_organization and membership.active),'[]'::jsonb),
    'clients',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.client_name,'phone',c.client_phone) order by c.client_name,c.id) from (select distinct on (client_account_id) client_account_id id,client_name,client_phone from public.bookings where organization_id=p_organization and client_account_id is not null order by client_account_id,created_at desc)c),'[]'::jsonb),
    'bookings',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'client_account_id',b.client_account_id,'client_name',b.client_name,'performer_id',b.performer_id,'booking_date',b.booking_date,'booking_time',b.booking_time,'service_name',s.name) order by b.booking_date desc,b.booking_time desc) from public.bookings b join public.services s on s.id=b.service_id where b.organization_id=p_organization and b.client_account_id is not null and b.status<>'cancelled' and b.booking_date>=current_date-90),'[]'::jsonb),
    'benefit_products',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'kind',kind,'sale_price_minor',sale_price_rub::bigint*100) order by name,id) from public.benefit_products where organization_id=p_organization and active),'[]'::jsonb),
    'inventory_items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'sku',sku,'unit',unit) order by name,id) from public.inventory_items where organization_id=p_organization and active),'[]'::jsonb),
    'warehouses',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id) from public.inventory_warehouses where organization_id=p_organization and active),'[]'::jsonb),
    'sales',coalesce((select jsonb_agg(jsonb_build_object('id',sale.id,'booking_id',sale.booking_id,'client_account_id',sale.client_account_id,'client_name',(select booking.client_name from public.bookings booking where booking.organization_id=sale.organization_id and booking.client_account_id=sale.client_account_id order by booking.created_at desc limit 1),'seller_id',sale.seller_id,'seller_name',coalesce(profile.display_name,'Сотрудник'),'status',sale.status,'payment_method',sale.payment_method,'total_minor',sale.total_minor,'refunded_minor',sale.refunded_minor,'occurred_at',sale.occurred_at,'line',jsonb_build_object('id',line.id,'item_kind',line.item_kind,'item_name',line.item_name,'quantity',line.quantity,'refunded_quantity',line.refunded_quantity,'unit_price_minor',line.unit_price_minor)) order by sale.occurred_at desc,sale.id desc) from public.commercial_sales sale join public.commercial_sale_lines line on line.sale_id=sale.id left join public.performer_profiles profile on profile.id=sale.seller_id where sale.organization_id=p_organization),'[]'::jsonb),
    'recurring_expenses',coalesce((select jsonb_agg(jsonb_build_object('id',rule.id,'name',rule.name,'supplier_name',rule.supplier_name,'amount_minor',rule.amount_minor,'day_of_month',rule.day_of_month,'active',rule.active,'last_occurred_on',(select max(occurrence.occurred_on) from public.recurring_expense_occurrences occurrence where occurrence.rule_id=rule.id)) order by rule.active desc,rule.name,rule.id) from public.organization_recurring_expenses rule where rule.organization_id=p_organization),'[]'::jsonb),
    'audit',coalesce((select jsonb_agg(jsonb_build_object('id',entry.id,'action',entry.action,'subject_id',entry.subject_id,'details',entry.details,'created_at',entry.created_at) order by entry.created_at desc,entry.id desc) from (select * from public.commercial_audit_log where organization_id=p_organization order by created_at desc,id desc limit 100)entry),'[]'::jsonb)
  );
end
$$;

revoke all on function public.sell_minuta_commercial_product_v151(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_minuta_commerce_workspace_v151(uuid) from public,anon,authenticated,service_role;
grant execute on function public.sell_minuta_commercial_product_v151(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid) to authenticated;
grant execute on function public.get_minuta_commerce_workspace_v151(uuid) to authenticated;

do $stamp_v151$
declare v_name text;v_proc regprocedure;v_hash text;
begin
  foreach v_name in array array[
    'public.sell_minuta_commercial_product_v151(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid)',
    'public.get_minuta_commerce_workspace_v151(uuid)'
  ] loop
    v_proc:=to_regprocedure(v_name);
    select public.minuta_financial_sha256_v129(jsonb_build_object(
      'source',procedure_row.prosrc,'kind',procedure_row.prokind,'language',language_row.lanname,
      'owner',pg_get_userbyid(procedure_row.proowner),
      'volatility',procedure_row.provolatile,'security_definer',procedure_row.prosecdef,
      'strict',procedure_row.proisstrict,'leakproof',procedure_row.proleakproof,'parallel',procedure_row.proparallel,
      'result',pg_get_function_result(procedure_row.oid),'arguments',pg_get_function_arguments(procedure_row.oid),
      'identity_arguments',pg_get_function_identity_arguments(procedure_row.oid),
      'config',coalesce(to_jsonb(procedure_row.proconfig),'null'::jsonb),
      'acl',coalesce((select jsonb_agg(jsonb_build_object(
        'grantor',pg_get_userbyid(grant_row.grantor),
        'grantee',case grant_row.grantee when 0 then 'PUBLIC' else pg_get_userbyid(grant_row.grantee) end,
        'privilege',grant_row.privilege_type,'grantable',grant_row.is_grantable
      ) order by pg_get_userbyid(grant_row.grantor),
        case grant_row.grantee when 0 then 'PUBLIC' else pg_get_userbyid(grant_row.grantee) end,
        grant_row.privilege_type,grant_row.is_grantable)
        from aclexplode(procedure_row.proacl) grant_row),'[]'::jsonb)
    )) into v_hash
    from pg_catalog.pg_proc procedure_row
    join pg_catalog.pg_language language_row on language_row.oid=procedure_row.prolang
    where procedure_row.oid=v_proc;
    execute format('comment on function %s is %L',v_name,'minuta_commercial_sales_v151:sha256='||v_hash);
  end loop;
end
$stamp_v151$;

commit;
