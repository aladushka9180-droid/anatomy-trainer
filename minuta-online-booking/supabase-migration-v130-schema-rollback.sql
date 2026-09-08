\set ON_ERROR_STOP on

begin;
set local lock_timeout = '5s';
set local statement_timeout = '3min';
set local search_path = public, extensions, pg_catalog;

-- Destructive schema rollback is intentionally available only before D09 has
-- been initialized or written any ledger state.  Once any cost or transfer
-- evidence exists, use the operational rollback and preserve the ledger.
do $$ begin
  if to_regclass('public.organization_inventory_transfer_settings') is null
     or to_regclass('public.inventory_transfer_documents') is null
     or to_regclass('public.inventory_cost_layers') is null
     or to_regclass('public.inventory_movement_cost_snapshots') is null
     or to_regclass('public.inventory_cost_allocations') is null
     or to_regprocedure('public.transfer_minuta_inventory_stock_v130(uuid,uuid,uuid,uuid,numeric,text,uuid)') is null then
    raise exception using errcode='P0001',message='v130_schema_rollback_requires_inventory_transfer';
  end if;
end $$;

-- Exclusive counterpart to every v130 writer's shared gate.  The emptiness
-- decision and all following DDL therefore happen without an in-flight writer.
select pg_advisory_xact_lock(13000);

do $$ begin
  if exists(
       select 1 from public.organization_inventory_transfer_settings
       where initialized_at is not null or enabled or suspended_at is not null
     )
     or exists(select 1 from public.inventory_transfer_documents)
     or exists(select 1 from public.inventory_cost_allocations)
     or exists(select 1 from public.inventory_movement_cost_snapshots)
     or exists(select 1 from public.inventory_cost_layers)
     or exists(
       select 1 from public.inventory_movements
       where transfer_document_id is not null
          or purchase_total_cost_kopecks is not null
          or movement_type in ('transfer_out','transfer_in')
     ) then
    raise exception using errcode='55000',message='v130_schema_rollback_refused_ledger_not_empty';
  end if;
end $$;

drop trigger if exists inventory_transfer_document_pair_v130 on public.inventory_transfer_documents;
drop trigger if exists inventory_transfer_documents_immutable_v130 on public.inventory_transfer_documents;
drop trigger if exists inventory_transfer_movement_pair_v130 on public.inventory_movements;
drop trigger if exists inventory_movement_cost_v130 on public.inventory_movements;
drop trigger if exists inventory_movement_cost_snapshots_immutable_v130 on public.inventory_movement_cost_snapshots;
drop trigger if exists inventory_cost_allocations_immutable_v130 on public.inventory_cost_allocations;

drop function if exists public.get_minuta_inventory_workspace_v130(uuid);
drop function if exists public.transfer_minuta_inventory_stock_v130(uuid,uuid,uuid,uuid,numeric,text,uuid);
drop function if exists public.apply_minuta_stock_movement_v130(uuid,uuid,uuid,text,numeric,numeric,text,uuid,bigint);
drop function if exists public.set_minuta_inventory_transfers_enabled_v130(uuid,boolean);
drop function if exists public.enable_minuta_inventory_transfers_v130(uuid);
drop function if exists public.verify_minuta_inventory_transfer_pair_v130();
drop function if exists public.record_minuta_inventory_cost_v130();
drop function if exists public.protect_minuta_inventory_transfer_ledger_v130();

alter table public.inventory_movements
  drop constraint if exists inventory_movements_transfer_document_fk_v130,
  drop constraint if exists inventory_movements_movement_type_check_v130,
  drop constraint if exists inventory_purchase_cost_receipt_only_v130,
  drop constraint if exists inventory_transfer_movement_shape_v130;
drop index if exists public.inventory_transfer_movement_side_v130;

drop table public.inventory_cost_allocations;
drop table public.inventory_movement_cost_snapshots;
drop table public.inventory_cost_layers;
drop table public.inventory_transfer_documents;
drop table public.organization_inventory_transfer_settings;

drop index if exists public.inventory_movements_id_organization_v130;
alter table public.inventory_movements
  drop column purchase_total_cost_kopecks,
  drop column transfer_document_id;
alter table public.inventory_movements
  add constraint inventory_movements_movement_type_check
  check(movement_type in ('receipt','write_off','inventory','service_use')) not valid;
alter table public.inventory_movements
  validate constraint inventory_movements_movement_type_check;

-- Restore the exact public v82/v108 stock RPC behavior and privileges, without
-- the v130 global/cost-ledger locks.
create or replace function public.apply_minuta_stock_movement(
  p_organization uuid,p_warehouse uuid,p_item uuid,p_kind text,p_quantity numeric,
  p_counted_quantity numeric,p_reason text,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_role text; v_before numeric(14,3); v_delta numeric(14,3); v_after numeric(14,3);
  v_existing public.inventory_movements%rowtype; v_movement bigint;
begin
  v_role:=public.get_minuta_inventory_role(p_organization);
  if not coalesce((select enabled from public.organization_inventory_settings where organization_id=p_organization),false) then raise exception using errcode='55000',message='inventory_disabled'; end if;
  if p_request_id is null then raise exception using errcode='22023',message='inventory_request_id_required'; end if;
  if coalesce(p_kind,'') not in ('receipt','write_off','inventory') then raise exception using errcode='22023',message='invalid_inventory_movement'; end if;
  if not exists(select 1 from public.inventory_warehouses where id=p_warehouse and organization_id=p_organization and active)
     or not exists(select 1 from public.inventory_items where id=p_item and organization_id=p_organization and active) then raise exception using errcode='55000',message='inventory_target_inactive'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':'||p_request_id::text,8200));
  select * into v_existing from public.inventory_movements where organization_id=p_organization and request_id=p_request_id;
  if found then
    if v_existing.warehouse_id<>p_warehouse or v_existing.inventory_item_id<>p_item or v_existing.movement_type<>p_kind
       or (p_kind='receipt' and v_existing.quantity_delta<>p_quantity)
       or (p_kind='write_off' and v_existing.quantity_delta<>-p_quantity)
       or (p_kind='inventory' and v_existing.quantity_after<>p_counted_quantity) then raise exception using errcode='23505',message='inventory_request_conflict'; end if;
    return jsonb_build_object('organization_id',p_organization,'id',v_existing.id,'quantity_after',v_existing.quantity_after);
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_warehouse::text||':'||p_item::text,8201));
  insert into public.inventory_stock_balances(organization_id,warehouse_id,inventory_item_id,quantity) values(p_organization,p_warehouse,p_item,0) on conflict do nothing;
  select quantity into v_before from public.inventory_stock_balances where organization_id=p_organization and warehouse_id=p_warehouse and inventory_item_id=p_item for update;
  if p_kind='inventory' then
    if coalesce(p_counted_quantity,-1)<0 then raise exception using errcode='22023',message='invalid_inventory_count'; end if;
    v_after:=p_counted_quantity; v_delta:=v_after-v_before;
  else
    if coalesce(p_quantity,0)<=0 then raise exception using errcode='22023',message='invalid_inventory_quantity'; end if;
    v_delta:=case when p_kind='receipt' then p_quantity else -p_quantity end; v_after:=v_before+v_delta;
  end if;
  if v_after<0 then raise exception using errcode='55000',message='insufficient_inventory_stock'; end if;
  if p_kind in ('write_off','inventory') and char_length(trim(coalesce(p_reason,'')))<2 then raise exception using errcode='22023',message='inventory_reason_required'; end if;
  update public.inventory_stock_balances set quantity=v_after,updated_at=now() where organization_id=p_organization and warehouse_id=p_warehouse and inventory_item_id=p_item;
  insert into public.inventory_movements(organization_id,warehouse_id,inventory_item_id,movement_type,quantity_delta,quantity_after,request_id,reason,actor_id)
  values(p_organization,p_warehouse,p_item,p_kind,v_delta,v_after,p_request_id,trim(coalesce(p_reason,'')),auth.uid()) returning id into v_movement;
  perform public.write_minuta_inventory_audit(p_organization,'inventory_movement_recorded',p_item,jsonb_build_object('movement_id',v_movement,'warehouse_id',p_warehouse,'kind',p_kind));
  return jsonb_build_object('organization_id',p_organization,'id',v_movement,'quantity_after',v_after);
end $$;
revoke all on function public.apply_minuta_stock_movement(uuid,uuid,uuid,text,numeric,numeric,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.apply_minuta_stock_movement(uuid,uuid,uuid,text,numeric,numeric,text,uuid) to authenticated;

create or replace function public.consume_minuta_inventory_for_booking(p_booking uuid)
returns void language plpgsql security definer set search_path to '' as $$
declare v_booking public.bookings%rowtype; v_warehouse uuid; v_usage record; v_before numeric(14,3); v_after numeric(14,3); v_existing integer;
begin
  select * into v_booking from public.bookings booking where booking.id=p_booking for update;
  if v_booking.id is null or v_booking.organization_id is null or v_booking.location_id is null then return; end if;
  if not exists(select 1 from public.booking_outcomes outcome where outcome.booking_id=p_booking and outcome.visit_status='completed') then return; end if;
  if not coalesce((select enabled and auto_deduct_completed_visits from public.organization_inventory_settings where organization_id=v_booking.organization_id),false) then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_booking::text,8202));
  select count(*) into v_existing from public.inventory_movements movement where movement.booking_id=p_booking and movement.movement_type='service_use';
  if v_existing>0 then return; end if;
  if not exists(select 1 from public.inventory_service_usage usage where usage.organization_id=v_booking.organization_id and usage.service_id=v_booking.service_id) then return; end if;
  select warehouse.id into v_warehouse from public.inventory_warehouses warehouse
  where warehouse.organization_id=v_booking.organization_id and warehouse.location_id=v_booking.location_id and warehouse.active for update;
  if v_warehouse is null then raise exception using errcode='55000',message='inventory_warehouse_missing_for_location'; end if;
  for v_usage in
    select usage.inventory_item_id,usage.quantity from public.inventory_service_usage usage
    join public.inventory_items item on item.id=usage.inventory_item_id and item.organization_id=usage.organization_id and item.active
    where usage.organization_id=v_booking.organization_id and usage.service_id=v_booking.service_id order by usage.inventory_item_id
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_warehouse::text||':'||v_usage.inventory_item_id::text,8201));
    insert into public.inventory_stock_balances(organization_id,warehouse_id,inventory_item_id,quantity) values(v_booking.organization_id,v_warehouse,v_usage.inventory_item_id,0) on conflict do nothing;
    select quantity into v_before from public.inventory_stock_balances where organization_id=v_booking.organization_id and warehouse_id=v_warehouse and inventory_item_id=v_usage.inventory_item_id for update;
    v_after:=v_before-v_usage.quantity;
    if v_after<0 then raise exception using errcode='55000',message='insufficient_inventory_stock_for_completed_visit'; end if;
    update public.inventory_stock_balances set quantity=v_after,updated_at=now() where organization_id=v_booking.organization_id and warehouse_id=v_warehouse and inventory_item_id=v_usage.inventory_item_id;
    insert into public.inventory_movements(organization_id,warehouse_id,inventory_item_id,booking_id,movement_type,quantity_delta,quantity_after,request_id,reason,actor_id)
    values(v_booking.organization_id,v_warehouse,v_usage.inventory_item_id,p_booking,'service_use',-v_usage.quantity,v_after,gen_random_uuid(),'Автоматическое списание по завершённому визиту',auth.uid());
  end loop;
  perform public.write_minuta_inventory_audit(v_booking.organization_id,'inventory_booking_consumed',p_booking,jsonb_build_object('warehouse_id',v_warehouse,'service_id',v_booking.service_id));
end $$;
revoke all on function public.consume_minuta_inventory_for_booking(uuid) from public,anon,authenticated,service_role;

do $$
declare v_apply text; v_consume text; v_constraint text;
begin
  v_apply:=lower(pg_get_functiondef('public.apply_minuta_stock_movement(uuid,uuid,uuid,text,numeric,numeric,text,uuid)'::regprocedure));
  v_consume:=lower(pg_get_functiondef('public.consume_minuta_inventory_for_booking(uuid)'::regprocedure));
  select lower(pg_get_constraintdef(oid)) into v_constraint from pg_constraint
    where conrelid='public.inventory_movements'::regclass and conname='inventory_movements_movement_type_check';
  if to_regclass('public.organization_inventory_transfer_settings') is not null
     or to_regclass('public.inventory_transfer_documents') is not null
     or to_regclass('public.inventory_cost_layers') is not null
     or to_regclass('public.inventory_movement_cost_snapshots') is not null
     or to_regclass('public.inventory_cost_allocations') is not null
     or exists(select 1 from pg_attribute where attrelid='public.inventory_movements'::regclass and attname in('purchase_total_cost_kopecks','transfer_document_id') and not attisdropped)
     or to_regprocedure('public.transfer_minuta_inventory_stock_v130(uuid,uuid,uuid,uuid,numeric,text,uuid)') is not null
     or position('13000' in v_apply)>0 or position('13001' in v_apply)>0
     or position('13000' in v_consume)>0 or position('13001' in v_consume)>0
     or v_constraint is null or position('transfer_out' in v_constraint)>0
     or not has_function_privilege('authenticated','public.apply_minuta_stock_movement(uuid,uuid,uuid,text,numeric,numeric,text,uuid)','EXECUTE')
     or has_function_privilege('anon','public.apply_minuta_stock_movement(uuid,uuid,uuid,text,numeric,numeric,text,uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.consume_minuta_inventory_for_booking(uuid)','EXECUTE')
     or to_regprocedure('public.upsert_minuta_inventory_warehouse(uuid,uuid,uuid,text,boolean)') is null then
    raise exception using errcode='P0001',message='v130_schema_rollback_postcondition_failed';
  end if;
end $$;

notify pgrst,'reload schema';
commit;
