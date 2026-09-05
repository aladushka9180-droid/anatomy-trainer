begin;

-- Non-destructive emergency rollback for an already activated v113 ledger.
-- It freezes the new cost/profitability surface while preserving every cost
-- layer, allocation, snapshot, commission and service setting for audit.
-- Legacy inventory RPCs and stock tables remain available.
set local lock_timeout='15s';
set local statement_timeout='120s';

do $$ begin
  if to_regclass('public.organization_inventory_cost_settings') is null
     or to_regclass('public.inventory_movements') is null then
    raise exception using errcode='P0001',message='v113_operational_rollback_requires_v113';
  end if;
end $$;

-- Every v113 mutating RPC takes this lock before touching business data. It
-- creates a deterministic cutover and makes already-started calls re-check the
-- suspension marker after this transaction commits.
select pg_advisory_xact_lock(11300);

-- Drain movement inserts that already reached the ledger trigger and prevent
-- a new insert until the trigger has been removed atomically.
lock table public.inventory_movements in share row exclusive mode;

do $$
declare v_setting record;
begin
  for v_setting in
    select organization_id from public.organization_inventory_cost_settings
    where enabled or (initialized_at is not null and suspension_reason is distinct from 'v113_operational_rollback')
    order by organization_id
  loop
    perform public.write_minuta_inventory_audit(
      v_setting.organization_id,'inventory_costing_operationally_suspended',v_setting.organization_id,
      jsonb_build_object('reason','v113_operational_rollback','ledger_preserved',true)
    );
  end loop;
end $$;

-- Mark every current organization so an RPC call that resolved the old
-- function before DROP but waited on the global lock cannot activate later.
insert into public.organization_inventory_cost_settings(
  organization_id,enabled,suspended_at,suspended_by,suspension_reason,updated_at
)
select organization.id,false,now(),auth.uid(),'v113_operational_rollback',now()
from public.organizations organization
on conflict(organization_id) do update set
  enabled=false,suspended_at=now(),suspended_by=auth.uid(),
  suspension_reason='v113_operational_rollback',updated_at=now();

drop trigger if exists inventory_movement_cost_v113 on public.inventory_movements;
drop function if exists public.record_minuta_inventory_cost_v113();
drop function if exists public.get_minuta_profitability_v113(uuid,date,date,uuid,uuid);
drop function if exists public.get_minuta_inventory_workspace_v113(uuid);
drop function if exists public.save_minuta_booking_commission_v113(uuid,uuid,bigint,text);
drop function if exists public.set_minuta_service_material_mode_v113(uuid,uuid,text);
drop function if exists public.apply_minuta_stock_movement_v113(uuid,uuid,uuid,text,numeric,numeric,text,uuid,bigint);
drop function if exists public.enable_minuta_inventory_costing_v113(uuid);

do $$ begin
  if to_regprocedure('public.get_minuta_inventory_workspace_v113(uuid)') is not null
     or to_regprocedure('public.apply_minuta_stock_movement_v113(uuid,uuid,uuid,text,numeric,numeric,text,uuid,bigint)') is not null
     or exists(
       select 1 from pg_trigger
       where tgrelid='public.inventory_movements'::regclass
         and tgname='inventory_movement_cost_v113' and not tgisinternal
     )
     or exists(
       select 1 from public.organizations organization
       where not exists(
         select 1 from public.organization_inventory_cost_settings setting
         where setting.organization_id=organization.id and setting.suspended_at is not null
       )
     )
     or to_regclass('public.inventory_cost_layers') is null
     or to_regclass('public.inventory_movement_cost_snapshots') is null then
    raise exception using errcode='P0001',message='v113_operational_rollback_incomplete';
  end if;
end $$;

notify pgrst,'reload schema';
commit;
