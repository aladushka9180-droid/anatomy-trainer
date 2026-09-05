\set ON_ERROR_STOP on

begin;
set local lock_timeout='5s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $$ begin
  if to_regclass('public.inventory_warehouses') is null
     or to_regclass('public.organization_inventory_settings') is null
     or to_regprocedure('public.get_minuta_inventory_role(uuid)') is null
     or to_regprocedure('public.write_minuta_inventory_audit(uuid,text,uuid,jsonb)') is null
     or to_regprocedure('public.upsert_minuta_inventory_warehouse(uuid,uuid,uuid,text,boolean)') is null then
    raise exception using errcode='P0001',message='v108_requires_inventory_v82';
  end if;
end $$;

create or replace function public.upsert_minuta_inventory_warehouse(
  p_organization uuid,p_warehouse uuid,p_location uuid,p_name text,p_active boolean
)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_role text; v_id uuid;
begin
  v_role:=public.get_minuta_inventory_role(p_organization);
  if not coalesce((select enabled from public.organization_inventory_settings where organization_id=p_organization),false) then
    raise exception using errcode='55000',message='inventory_disabled';
  end if;
  if char_length(trim(coalesce(p_name,''))) not between 2 and 120
     or not exists(select 1 from public.locations where id=p_location and organization_id=p_organization) then
    raise exception using errcode='22023',message='invalid_inventory_warehouse';
  end if;
  if p_warehouse is null then
    insert into public.inventory_warehouses(organization_id,location_id,name,active,created_by)
    values(p_organization,p_location,trim(p_name),coalesce(p_active,true),auth.uid()) returning id into v_id;
  else
    if exists(select 1 from public.inventory_warehouses warehouse where warehouse.id=p_warehouse and warehouse.organization_id=p_organization and warehouse.location_id<>p_location)
       and exists(select 1 from public.inventory_movements movement where movement.organization_id=p_organization and movement.warehouse_id=p_warehouse) then
      raise exception using errcode='55000',message='inventory_warehouse_location_locked_by_ledger';
    end if;
    update public.inventory_warehouses set location_id=p_location,name=trim(p_name),active=coalesce(p_active,true)
    where id=p_warehouse and organization_id=p_organization returning id into v_id;
    if v_id is null then raise exception using errcode='P0002',message='inventory_warehouse_not_found'; end if;
  end if;
  perform public.write_minuta_inventory_audit(p_organization,'inventory_warehouse_saved',v_id,jsonb_build_object('location_id',p_location,'active',coalesce(p_active,true)));
  return jsonb_build_object('organization_id',p_organization,'id',v_id);
end $$;
revoke all on function public.upsert_minuta_inventory_warehouse(uuid,uuid,uuid,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.upsert_minuta_inventory_warehouse(uuid,uuid,uuid,text,boolean) to authenticated;

do $$
declare v_definition text;
begin
  v_definition:=lower(pg_get_functiondef('public.upsert_minuta_inventory_warehouse(uuid,uuid,uuid,text,boolean)'::regprocedure));
  if position('p_quantity' in v_definition)>0
     or position('p_item' in v_definition)>0
     or not has_function_privilege('authenticated','public.upsert_minuta_inventory_warehouse(uuid,uuid,uuid,text,boolean)','EXECUTE')
     or has_function_privilege('anon','public.upsert_minuta_inventory_warehouse(uuid,uuid,uuid,text,boolean)','EXECUTE') then
    raise exception using errcode='P0001',message='v108_postcondition_failed';
  end if;
end $$;

notify pgrst,'reload schema';
commit;
