do $$
declare
  v_definition text;
begin
  if to_regclass('public.organization_inventory_cost_settings') is null
     or to_regclass('public.inventory_cost_layers') is null
     or to_regclass('public.inventory_movement_cost_snapshots') is null
     or to_regclass('public.inventory_cost_allocations') is null
     or to_regclass('public.inventory_service_cost_settings') is null
     or to_regclass('public.booking_confirmed_commissions') is null
     or not exists(
       select 1 from pg_attribute
       where attrelid='public.organization_inventory_cost_settings'::regclass
         and attname='suspended_at' and not attisdropped
     )
     or to_regprocedure('public.record_minuta_inventory_cost_v113()') is null
     or to_regprocedure('public.enable_minuta_inventory_costing_v113(uuid)') is null
     or to_regprocedure('public.apply_minuta_stock_movement_v113(uuid,uuid,uuid,text,numeric,numeric,text,uuid,bigint)') is null
     or to_regprocedure('public.get_minuta_inventory_workspace_v113(uuid)') is null
     or to_regprocedure('public.get_minuta_profitability_v113(uuid,date,date,uuid,uuid)') is null then
    raise exception 'v113_objects_missing';
  end if;
  if has_function_privilege('anon','public.get_minuta_profitability_v113(uuid,date,date,uuid,uuid)','EXECUTE')
     or not has_function_privilege('authenticated','public.get_minuta_profitability_v113(uuid,date,date,uuid,uuid)','EXECUTE')
     or has_table_privilege('authenticated','public.booking_confirmed_commissions','INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated','public.organization_inventory_cost_settings','INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated','public.inventory_cost_layers','INSERT,UPDATE,DELETE') then
    raise exception 'v113_acl_invalid';
  end if;
  select lower(pg_get_functiondef('public.get_minuta_profitability_v113(uuid,date,date,uuid,uuid)'::regprocedure))
    into v_definition;
  if position('period.status=''paid''' in regexp_replace(v_definition,'\s','','g'))=0
     or position('remainder_before_overhead_kopecks' in v_definition)=0
     or position('booking_confirmed_commissions' in v_definition)=0 then
    raise exception 'v113_profitability_definition_invalid';
  end if;
  if not exists(
    select 1 from pg_trigger
    where tgrelid='public.inventory_movements'::regclass
      and tgname='inventory_movement_cost_v113' and not tgisinternal
  ) then raise exception 'v113_cost_trigger_missing'; end if;
  select lower(pg_get_functiondef('public.record_minuta_inventory_cost_v113()'::regprocedure)) into v_definition;
  if position('setting.enabledandsetting.initialized_atisnotnull' in regexp_replace(v_definition,'\s','','g'))=0
     or position('thenreturnnew' in regexp_replace(v_definition,'\s','','g'))=0 then
    raise exception 'v113_cost_trigger_not_opt_in';
  end if;
  if not exists(
    select 1 from pg_constraint constraint_row
    join lateral(
      select array_agg(attribute.attname order by key_row.ordinality) names
      from unnest(constraint_row.conkey) with ordinality key_row(attnum,ordinality)
      join pg_attribute attribute on attribute.attrelid=constraint_row.conrelid and attribute.attnum=key_row.attnum
    ) columns on true
    where constraint_row.conrelid='public.inventory_service_cost_settings'::regclass
      and constraint_row.contype='u'
      and columns.names=array['organization_id','service_id','effective_from']::name[]
  ) then raise exception 'v113_service_setting_tenant_unique_missing'; end if;
  select lower(pg_get_functiondef('public.enable_minuta_inventory_costing_v113(uuid)'::regprocedure)) into v_definition;
  if position('pg_advisory_xact_lock_shared(11300)' in regexp_replace(v_definition,'\s','','g'))=0
     or position('inventory_costing_reactivation_requires_reconciliation' in v_definition)=0 then
    raise exception 'v113_operational_rollback_gate_missing';
  end if;
end $$;
