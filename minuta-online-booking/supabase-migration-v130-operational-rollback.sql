\set ON_ERROR_STOP on

begin;
set local lock_timeout = '5s';
set local statement_timeout = '2min';
set local search_path = public, extensions, pg_catalog;

-- Operational rollback only: stop new transfer documents while preserving the
-- immutable ledger and the cost trigger required by later receipts/write-offs.
do $$ begin
  if to_regclass('public.organization_inventory_transfer_settings') is null
     or to_regclass('public.inventory_transfer_documents') is null
     or to_regprocedure('public.transfer_minuta_inventory_stock_v130(uuid,uuid,uuid,uuid,numeric,text,uuid)') is null
     or to_regprocedure('public.record_minuta_inventory_cost_v130()') is null then
    raise exception using errcode='P0001',message='v130_operational_rollback_requires_inventory_transfer';
  end if;
end $$;

select pg_advisory_xact_lock(13000);

update public.organization_inventory_transfer_settings set
  enabled=false,
  suspended_at=coalesce(suspended_at,now()),
  suspended_by=coalesce(suspended_by,auth.uid()),
  suspension_reason=coalesce(suspension_reason,'v130_operational_rollback'),
  updated_at=now()
where initialized_at is not null;

revoke execute on function public.enable_minuta_inventory_transfers_v130(uuid) from authenticated;
revoke execute on function public.set_minuta_inventory_transfers_enabled_v130(uuid,boolean) from authenticated;
revoke execute on function public.transfer_minuta_inventory_stock_v130(uuid,uuid,uuid,uuid,numeric,text,uuid) from authenticated;

do $$ begin
  if exists(select 1 from public.organization_inventory_transfer_settings where enabled)
     or not exists(
       select 1 from pg_trigger
       where tgrelid='public.inventory_movements'::regclass
         and tgname='inventory_movement_cost_v130' and not tgisinternal and tgenabled<>'D'
     )
     or to_regclass('public.inventory_transfer_documents') is null
     or to_regclass('public.inventory_cost_layers') is null
     or to_regclass('public.inventory_movement_cost_snapshots') is null
     or to_regclass('public.inventory_cost_allocations') is null then
    raise exception using errcode='P0001',message='v130_operational_rollback_postcondition_failed';
  end if;
end $$;

notify pgrst,'reload schema';
commit;
