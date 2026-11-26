begin;
set local lock_timeout = '5s';
set local statement_timeout = '2min';

do $$ begin
  if to_regprocedure('public.get_minuta_inventory_workspace_v130(uuid)') is null
     or to_regprocedure('public.upsert_minuta_inventory_item(uuid,uuid,text,text,text,numeric,boolean)') is null then
    raise exception 'v193_requires_inventory_v130';
  end if;
end $$;

do $guard193$ begin
  if regexp_replace((select prosrc from pg_proc where oid='public.get_minuta_inventory_workspace(uuid)'::regprocedure),'\s+','','g') not in (
    regexp_replace($base193$
declare v_role text;
begin
  v_role:=public.get_minuta_inventory_role(p_organization);
  return jsonb_build_object(
    'organization_id',p_organization,'current_role',v_role,
    'enabled',coalesce((select enabled from public.organization_inventory_settings where organization_id=p_organization),false),
    'auto_deduct_completed_visits',coalesce((select auto_deduct_completed_visits from public.organization_inventory_settings where organization_id=p_organization),true),
    'locations',coalesce((select jsonb_agg(jsonb_build_object('id',location.id,'name',location.name,'active',location.active) order by location.is_primary desc,location.name,location.id) from public.locations location where location.organization_id=p_organization),'[]'::jsonb),
    'services',coalesce((select jsonb_agg(jsonb_build_object('id',service.id,'name',service.name,'active',service.active) order by service.name,service.id) from public.services service join public.organization_memberships membership on membership.organization_id=p_organization and membership.user_id=service.performer_id and membership.active and membership.is_bookable),'[]'::jsonb),
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',item.id,'name',item.name,'sku',item.sku,'unit',item.unit,'low_stock_threshold',item.low_stock_threshold,'active',item.active) order by item.active desc,item.name,item.id) from public.inventory_items item where item.organization_id=p_organization),'[]'::jsonb),
    'warehouses',coalesce((select jsonb_agg(jsonb_build_object('id',warehouse.id,'location_id',warehouse.location_id,'name',warehouse.name,'active',warehouse.active) order by warehouse.active desc,warehouse.name,warehouse.id) from public.inventory_warehouses warehouse where warehouse.organization_id=p_organization),'[]'::jsonb),
    'balances',coalesce((select jsonb_agg(jsonb_build_object('warehouse_id',balance.warehouse_id,'inventory_item_id',balance.inventory_item_id,'quantity',balance.quantity,'updated_at',balance.updated_at) order by balance.warehouse_id,balance.inventory_item_id) from public.inventory_stock_balances balance where balance.organization_id=p_organization),'[]'::jsonb),
    'usage',coalesce((select jsonb_agg(jsonb_build_object('service_id',usage.service_id,'inventory_item_id',usage.inventory_item_id,'quantity',usage.quantity) order by usage.service_id,usage.inventory_item_id) from public.inventory_service_usage usage where usage.organization_id=p_organization),'[]'::jsonb),
    'movements',coalesce((select jsonb_agg(jsonb_build_object('id',movement.id,'warehouse_id',movement.warehouse_id,'inventory_item_id',movement.inventory_item_id,'booking_id',movement.booking_id,'movement_type',movement.movement_type,'quantity_delta',movement.quantity_delta,'quantity_after',movement.quantity_after,'reason',movement.reason,'created_at',movement.created_at) order by movement.created_at desc,movement.id desc) from (select * from public.inventory_movements where organization_id=p_organization order by created_at desc,id desc limit 200) movement),'[]'::jsonb),
    'audit',coalesce((select jsonb_agg(jsonb_build_object('id',entry.id,'action',entry.action,'subject_id',entry.subject_id,'details',entry.details,'created_at',entry.created_at) order by entry.created_at desc,entry.id desc) from (select * from public.inventory_audit_log where organization_id=p_organization order by created_at desc,id desc limit 100) entry),'[]'::jsonb)
  );
end $base193$,'\s+','','g'),
    regexp_replace($expanded193$
declare v_role text;
begin
  v_role:=public.get_minuta_inventory_role(p_organization);
  return jsonb_build_object(
    'organization_id',p_organization,'current_role',v_role,'item_metadata_version',193,
    'enabled',coalesce((select enabled from public.organization_inventory_settings where organization_id=p_organization),false),
    'auto_deduct_completed_visits',coalesce((select auto_deduct_completed_visits from public.organization_inventory_settings where organization_id=p_organization),true),
    'locations',coalesce((select jsonb_agg(jsonb_build_object('id',location.id,'name',location.name,'active',location.active) order by location.is_primary desc,location.name,location.id) from public.locations location where location.organization_id=p_organization),'[]'::jsonb),
    'services',coalesce((select jsonb_agg(jsonb_build_object('id',service.id,'name',service.name,'active',service.active) order by service.name,service.id) from public.services service join public.organization_memberships membership on membership.organization_id=p_organization and membership.user_id=service.performer_id and membership.active and membership.is_bookable),'[]'::jsonb),
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',item.id,'name',item.name,'sku',item.sku,'unit',item.unit,'low_stock_threshold',item.low_stock_threshold,'active',item.active,'category',item.category,'icon_key',item.icon_key) order by item.active desc,item.name,item.id) from public.inventory_items item where item.organization_id=p_organization),'[]'::jsonb),
    'warehouses',coalesce((select jsonb_agg(jsonb_build_object('id',warehouse.id,'location_id',warehouse.location_id,'name',warehouse.name,'active',warehouse.active) order by warehouse.active desc,warehouse.name,warehouse.id) from public.inventory_warehouses warehouse where warehouse.organization_id=p_organization),'[]'::jsonb),
    'balances',coalesce((select jsonb_agg(jsonb_build_object('warehouse_id',balance.warehouse_id,'inventory_item_id',balance.inventory_item_id,'quantity',balance.quantity,'updated_at',balance.updated_at) order by balance.warehouse_id,balance.inventory_item_id) from public.inventory_stock_balances balance where balance.organization_id=p_organization),'[]'::jsonb),
    'usage',coalesce((select jsonb_agg(jsonb_build_object('service_id',usage.service_id,'inventory_item_id',usage.inventory_item_id,'quantity',usage.quantity) order by usage.service_id,usage.inventory_item_id) from public.inventory_service_usage usage where usage.organization_id=p_organization),'[]'::jsonb),
    'movements',coalesce((select jsonb_agg(jsonb_build_object('id',movement.id,'warehouse_id',movement.warehouse_id,'inventory_item_id',movement.inventory_item_id,'booking_id',movement.booking_id,'movement_type',movement.movement_type,'quantity_delta',movement.quantity_delta,'quantity_after',movement.quantity_after,'reason',movement.reason,'created_at',movement.created_at) order by movement.created_at desc,movement.id desc) from (select * from public.inventory_movements where organization_id=p_organization order by created_at desc,id desc limit 200) movement),'[]'::jsonb),
    'audit',coalesce((select jsonb_agg(jsonb_build_object('id',entry.id,'action',entry.action,'subject_id',entry.subject_id,'details',entry.details,'created_at',entry.created_at) order by entry.created_at desc,entry.id desc) from (select * from public.inventory_audit_log where organization_id=p_organization order by created_at desc,id desc limit 100) entry),'[]'::jsonb)
  );
end $expanded193$,'\s+','','g')
  ) then raise exception 'v193_inventory_reader_drift'; end if;
end $guard193$;
alter table public.inventory_items add column if not exists category text not null default '';
alter table public.inventory_items add column if not exists icon_key text not null default '';
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.inventory_items'::regclass and conname='inventory_item_category_v193') then
    alter table public.inventory_items add constraint inventory_item_category_v193 check(char_length(category)<=60);
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.inventory_items'::regclass and conname='inventory_item_icon_v193') then
    alter table public.inventory_items add constraint inventory_item_icon_v193 check(icon_key in ('','box','bottle','oil','glove','roll','spray'));
  end if;
end $$;

-- Keep the old writer intact: older clients preserve metadata on existing items.
create or replace function public.upsert_minuta_inventory_item_v193(
  p_organization uuid,p_item uuid,p_name text,p_sku text,p_unit text,
  p_low_stock numeric,p_active boolean,p_category text,p_icon_key text
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_result jsonb; v_id uuid; v_category text:=trim(coalesce(p_category,'')); v_icon text:=coalesce(p_icon_key,'');
begin
  perform public.get_minuta_inventory_role(p_organization);
  if char_length(v_category)>60 or v_icon not in ('','box','bottle','oil','glove','roll','spray') then
    raise exception using errcode='22023',message='invalid_inventory_item_metadata';
  end if;
  v_result:=public.upsert_minuta_inventory_item(p_organization,p_item,p_name,p_sku,p_unit,p_low_stock,p_active);
  v_id:=(v_result->>'id')::uuid;
  update public.inventory_items set category=v_category,icon_key=v_icon where id=v_id and organization_id=p_organization;
  if not found then raise exception using errcode='P0002',message='inventory_item_not_found'; end if;
  perform public.write_minuta_inventory_audit(p_organization,'inventory_item_metadata_saved',v_id,jsonb_build_object('category',v_category,'icon_key',v_icon));
  return v_result||jsonb_build_object('category',v_category,'icon_key',v_icon);
end $$;
revoke all on function public.upsert_minuta_inventory_item_v193(uuid,uuid,text,text,text,numeric,boolean,text,text) from public,anon,authenticated,service_role;
grant execute on function public.upsert_minuta_inventory_item_v193(uuid,uuid,text,text,text,numeric,boolean,text,text) to authenticated;

-- Extend the existing reader; v130 retains its transfer fields and old clients ignore the extra keys.
create or replace function public.get_minuta_inventory_workspace(p_organization uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_role text;
begin
  v_role:=public.get_minuta_inventory_role(p_organization);
  return jsonb_build_object(
    'organization_id',p_organization,'current_role',v_role,'item_metadata_version',193,
    'enabled',coalesce((select enabled from public.organization_inventory_settings where organization_id=p_organization),false),
    'auto_deduct_completed_visits',coalesce((select auto_deduct_completed_visits from public.organization_inventory_settings where organization_id=p_organization),true),
    'locations',coalesce((select jsonb_agg(jsonb_build_object('id',location.id,'name',location.name,'active',location.active) order by location.is_primary desc,location.name,location.id) from public.locations location where location.organization_id=p_organization),'[]'::jsonb),
    'services',coalesce((select jsonb_agg(jsonb_build_object('id',service.id,'name',service.name,'active',service.active) order by service.name,service.id) from public.services service join public.organization_memberships membership on membership.organization_id=p_organization and membership.user_id=service.performer_id and membership.active and membership.is_bookable),'[]'::jsonb),
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',item.id,'name',item.name,'sku',item.sku,'unit',item.unit,'low_stock_threshold',item.low_stock_threshold,'active',item.active,'category',item.category,'icon_key',item.icon_key) order by item.active desc,item.name,item.id) from public.inventory_items item where item.organization_id=p_organization),'[]'::jsonb),
    'warehouses',coalesce((select jsonb_agg(jsonb_build_object('id',warehouse.id,'location_id',warehouse.location_id,'name',warehouse.name,'active',warehouse.active) order by warehouse.active desc,warehouse.name,warehouse.id) from public.inventory_warehouses warehouse where warehouse.organization_id=p_organization),'[]'::jsonb),
    'balances',coalesce((select jsonb_agg(jsonb_build_object('warehouse_id',balance.warehouse_id,'inventory_item_id',balance.inventory_item_id,'quantity',balance.quantity,'updated_at',balance.updated_at) order by balance.warehouse_id,balance.inventory_item_id) from public.inventory_stock_balances balance where balance.organization_id=p_organization),'[]'::jsonb),
    'usage',coalesce((select jsonb_agg(jsonb_build_object('service_id',usage.service_id,'inventory_item_id',usage.inventory_item_id,'quantity',usage.quantity) order by usage.service_id,usage.inventory_item_id) from public.inventory_service_usage usage where usage.organization_id=p_organization),'[]'::jsonb),
    'movements',coalesce((select jsonb_agg(jsonb_build_object('id',movement.id,'warehouse_id',movement.warehouse_id,'inventory_item_id',movement.inventory_item_id,'booking_id',movement.booking_id,'movement_type',movement.movement_type,'quantity_delta',movement.quantity_delta,'quantity_after',movement.quantity_after,'reason',movement.reason,'created_at',movement.created_at) order by movement.created_at desc,movement.id desc) from (select * from public.inventory_movements where organization_id=p_organization order by created_at desc,id desc limit 200) movement),'[]'::jsonb),
    'audit',coalesce((select jsonb_agg(jsonb_build_object('id',entry.id,'action',entry.action,'subject_id',entry.subject_id,'details',entry.details,'created_at',entry.created_at) order by entry.created_at desc,entry.id desc) from (select * from public.inventory_audit_log where organization_id=p_organization order by created_at desc,id desc limit 100) entry),'[]'::jsonb)
  );
end $$;
notify pgrst,'reload schema';
commit;


