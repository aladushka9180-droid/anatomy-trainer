begin;

drop trigger if exists booking_outcomes_sync_inventory on public.booking_outcomes;
drop function if exists public.sync_minuta_inventory_on_outcome();
drop function if exists public.consume_minuta_inventory_for_booking(uuid);
drop function if exists public.get_minuta_inventory_workspace(uuid);
drop function if exists public.apply_minuta_stock_movement(uuid,uuid,uuid,text,numeric,numeric,text,uuid);
drop function if exists public.set_minuta_inventory_service_usage(uuid,uuid,uuid,numeric);
drop function if exists public.upsert_minuta_inventory_warehouse(uuid,uuid,uuid,text,boolean);
drop function if exists public.upsert_minuta_inventory_item(uuid,uuid,text,text,text,numeric,boolean);
drop function if exists public.set_minuta_inventory_settings(uuid,boolean,boolean);
drop function if exists public.get_minuta_inventory_role(uuid);
drop trigger if exists inventory_audit_immutable on public.inventory_audit_log;
drop trigger if exists inventory_movements_immutable on public.inventory_movements;
drop function if exists public.protect_minuta_inventory_ledger();
drop function if exists public.write_minuta_inventory_audit(uuid,text,uuid,jsonb);
drop trigger if exists inventory_movements_scope on public.inventory_movements;
drop trigger if exists inventory_service_usage_scope on public.inventory_service_usage;
drop function if exists public.enforce_minuta_inventory_scope();
drop table if exists public.inventory_audit_log;
drop table if exists public.inventory_movements;
drop table if exists public.inventory_stock_balances;
drop table if exists public.inventory_service_usage;
drop table if exists public.inventory_warehouses;
drop table if exists public.inventory_items;
drop table if exists public.organization_inventory_settings;

commit;
