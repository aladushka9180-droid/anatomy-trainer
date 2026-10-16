begin;
set local lock_timeout='10s';
set local statement_timeout='60s';
-- Replace only the qualified v130 legacy body. Preserve function OID, owner,
-- SECURITY DEFINER, empty search_path and existing ACL; no tables/data/grants.
select pg_advisory_xact_lock(13000);
do $guard$
begin
  if not exists(select 1 from pg_proc where oid=to_regprocedure('public.apply_minuta_stock_movement(uuid,uuid,uuid,text,numeric,numeric,text,uuid)')
    and md5(prosrc) in ('5f67773de5edfa7677809eb9b6dbfa60','1d9febd4d7e3e83ff01caa0095acac7a')) then
    raise exception 'inventory_precision_baseline_mismatch';
  end if;
end $guard$;
-- Normalize Windows checkout line endings so the qualified function body
-- and its rollback remain byte-identical on every release host.
do $replace_function$
begin
  execute replace($definition$CREATE OR REPLACE FUNCTION public.apply_minuta_stock_movement(p_organization uuid, p_warehouse uuid, p_item uuid, p_kind text, p_quantity numeric, p_counted_quantity numeric, p_reason text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_role text; v_before numeric(14,3); v_delta numeric(14,3); v_after numeric(14,3);
  v_existing public.inventory_movements%rowtype; v_movement bigint;
begin
  v_role:=public.get_minuta_inventory_role(p_organization);
  perform pg_advisory_xact_lock_shared(13000);
  if not coalesce((select enabled from public.organization_inventory_settings where organization_id=p_organization),false) then
    raise exception using errcode='55000',message='inventory_disabled';
  end if;
  if p_request_id is null then raise exception using errcode='22023',message='inventory_request_id_required'; end if;
  if coalesce(p_kind,'') not in ('receipt','write_off','inventory') then
    raise exception using errcode='22023',message='invalid_inventory_movement';
  end if;
  -- Reject unsupported precision before replay lookup or numeric(14,3) assignment.
  if p_kind='inventory' then
    if p_counted_quantity is null or p_counted_quantity::text in ('NaN','Infinity','-Infinity')
       or p_counted_quantity<0 or p_counted_quantity>99999999999.999
       or p_counted_quantity<>trunc(p_counted_quantity,3) then
      raise exception using errcode='22023',message='invalid_inventory_count';
    end if;
  else
    if p_quantity is null or p_quantity::text in ('NaN','Infinity','-Infinity')
       or p_quantity<=0 or p_quantity>99999999999.999 or p_quantity<>trunc(p_quantity,3) then
      raise exception using errcode='22023',message='invalid_inventory_quantity';
    end if;
  end if;
  if not exists(select 1 from public.inventory_warehouses where id=p_warehouse and organization_id=p_organization and active)
     or not exists(select 1 from public.inventory_items where id=p_item and organization_id=p_organization and active) then
    raise exception using errcode='55000',message='inventory_target_inactive';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':'||p_request_id::text,8200));
  v_role:=public.get_minuta_inventory_role(p_organization);
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text,13001));
  v_role:=public.get_minuta_inventory_role(p_organization);
  select * into v_existing from public.inventory_movements
    where organization_id=p_organization and request_id=p_request_id;
  if found then
    if v_existing.warehouse_id<>p_warehouse or v_existing.inventory_item_id<>p_item or v_existing.movement_type<>p_kind
       or (p_kind='receipt' and v_existing.quantity_delta<>p_quantity)
       or (p_kind='write_off' and v_existing.quantity_delta<>-p_quantity)
       or (p_kind='inventory' and v_existing.quantity_after<>p_counted_quantity) then
      raise exception using errcode='23505',message='inventory_request_conflict';
    end if;
    return jsonb_build_object('organization_id',p_organization,'id',v_existing.id,'quantity_after',v_existing.quantity_after);
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_warehouse::text||':'||p_item::text,8201));
  insert into public.inventory_stock_balances(organization_id,warehouse_id,inventory_item_id,quantity)
    values(p_organization,p_warehouse,p_item,0) on conflict do nothing;
  select quantity into v_before from public.inventory_stock_balances
    where organization_id=p_organization and warehouse_id=p_warehouse and inventory_item_id=p_item for update;
  if p_kind='inventory' then
    if coalesce(p_counted_quantity,-1)<0 then raise exception using errcode='22023',message='invalid_inventory_count'; end if;
    v_after:=p_counted_quantity; v_delta:=v_after-v_before;
  else
    if coalesce(p_quantity,0)<=0 then raise exception using errcode='22023',message='invalid_inventory_quantity'; end if;
    v_delta:=case when p_kind='receipt' then p_quantity else -p_quantity end; v_after:=v_before+v_delta;
  end if;
  if v_after<0 then raise exception using errcode='55000',message='insufficient_inventory_stock'; end if;
  if p_kind in ('write_off','inventory') and char_length(trim(coalesce(p_reason,'')))<2 then
    raise exception using errcode='22023',message='inventory_reason_required';
  end if;
  update public.inventory_stock_balances set quantity=v_after,updated_at=now()
    where organization_id=p_organization and warehouse_id=p_warehouse and inventory_item_id=p_item;
  insert into public.inventory_movements(
    organization_id,warehouse_id,inventory_item_id,movement_type,quantity_delta,quantity_after,
    request_id,reason,actor_id
  ) values(
    p_organization,p_warehouse,p_item,p_kind,v_delta,v_after,p_request_id,trim(coalesce(p_reason,'')),auth.uid()
  ) returning id into v_movement;
  perform public.write_minuta_inventory_audit(
    p_organization,'inventory_movement_recorded',p_item,
    jsonb_build_object('movement_id',v_movement,'warehouse_id',p_warehouse,'kind',p_kind)
  );
  return jsonb_build_object('organization_id',p_organization,'id',v_movement,'quantity_after',v_after);
end $function$
;
$definition$,chr(13)||chr(10),chr(10));
end $replace_function$;

commit;
