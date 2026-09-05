begin;

-- Destructive rollback is allowed only before activation. After activation use
-- supabase-migration-v113-operational-rollback.sql: it disables the feature but
-- preserves financial history and leaves the legacy warehouse operational.
do $$ begin
  if (to_regclass('public.booking_confirmed_commissions') is not null
      and exists(select 1 from public.booking_confirmed_commissions))
     or (to_regclass('public.organization_inventory_cost_settings') is not null
      and exists(select 1 from public.organization_inventory_cost_settings where enabled or initialized_at is not null))
     or (to_regclass('public.inventory_service_cost_settings') is not null
      and exists(select 1 from public.inventory_service_cost_settings))
     or (to_regclass('public.inventory_movement_cost_snapshots') is not null
      and exists(select 1 from public.inventory_movement_cost_snapshots))
     or (to_regclass('public.inventory_cost_layers') is not null
      and exists(select 1 from public.inventory_cost_layers where source_movement_id is not null)) then
    raise exception using errcode='P0001',message='v113_rollback_blocked_financial_history_exists';
  end if;
end $$;

revoke execute on function public.get_minuta_profitability_v113(uuid,date,date,uuid,uuid) from public,anon,authenticated,service_role;
revoke execute on function public.get_minuta_inventory_workspace_v113(uuid) from public,anon,authenticated,service_role;
revoke execute on function public.save_minuta_booking_commission_v113(uuid,uuid,bigint,text) from public,anon,authenticated,service_role;
revoke execute on function public.set_minuta_service_material_mode_v113(uuid,uuid,text) from public,anon,authenticated,service_role;
revoke execute on function public.apply_minuta_stock_movement_v113(uuid,uuid,uuid,text,numeric,numeric,text,uuid,bigint) from public,anon,authenticated,service_role;
revoke execute on function public.enable_minuta_inventory_costing_v113(uuid) from public,anon,authenticated,service_role;

drop function if exists public.get_minuta_profitability_v113(uuid,date,date,uuid,uuid);
drop function if exists public.get_minuta_inventory_workspace_v113(uuid);
drop function if exists public.save_minuta_booking_commission_v113(uuid,uuid,bigint,text);
drop function if exists public.set_minuta_service_material_mode_v113(uuid,uuid,text);
drop function if exists public.apply_minuta_stock_movement_v113(uuid,uuid,uuid,text,numeric,numeric,text,uuid,bigint);
drop function if exists public.enable_minuta_inventory_costing_v113(uuid);

drop trigger if exists inventory_movement_cost_v113 on public.inventory_movements;
drop function if exists public.record_minuta_inventory_cost_v113();

drop table if exists public.inventory_cost_allocations;
drop table if exists public.inventory_movement_cost_snapshots;
drop table if exists public.inventory_cost_layers;
drop table if exists public.inventory_service_cost_settings;
drop table if exists public.booking_confirmed_commissions;
drop table if exists public.organization_inventory_cost_settings;

alter table public.inventory_movements drop constraint if exists inventory_purchase_cost_receipt_only_v113;
alter table public.inventory_movements drop column if exists purchase_total_cost_kopecks;

notify pgrst,'reload schema';
commit;
