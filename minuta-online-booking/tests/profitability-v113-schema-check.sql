do $$
declare
  v_definition text;
begin
  if to_regclass('public.inventory_cost_layers') is null
     or to_regclass('public.inventory_movement_cost_snapshots') is null
     or to_regclass('public.inventory_cost_allocations') is null
     or to_regclass('public.inventory_service_cost_settings') is null
     or to_regclass('public.booking_confirmed_commissions') is null
     or to_regprocedure('public.record_minuta_inventory_cost_v113()') is null
     or to_regprocedure('public.apply_minuta_stock_movement_v113(uuid,uuid,uuid,text,numeric,numeric,text,uuid,bigint)') is null
     or to_regprocedure('public.get_minuta_inventory_workspace_v113(uuid)') is null
     or to_regprocedure('public.get_minuta_profitability_v113(uuid,date,date,uuid,uuid)') is null then
    raise exception 'v113_objects_missing';
  end if;
  if has_function_privilege('anon','public.get_minuta_profitability_v113(uuid,date,date,uuid,uuid)','EXECUTE')
     or not has_function_privilege('authenticated','public.get_minuta_profitability_v113(uuid,date,date,uuid,uuid)','EXECUTE')
     or has_table_privilege('authenticated','public.booking_confirmed_commissions','INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated','public.inventory_cost_layers','INSERT,UPDATE,DELETE') then
    raise exception 'v113_acl_invalid';
  end if;
  select lower(pg_get_functiondef('public.get_minuta_profitability_v113(uuid,date,date,uuid,uuid)'::regprocedure))
    into v_definition;
  if position('period.status = ''paid''' in v_definition)=0
     or position('remainder_before_overhead_kopecks' in v_definition)=0
     or position('booking_confirmed_commissions' in v_definition)=0 then
    raise exception 'v113_profitability_definition_invalid';
  end if;
  if not exists(
    select 1 from pg_trigger
    where tgrelid='public.inventory_movements'::regclass
      and tgname='inventory_movement_cost_v113' and not tgisinternal
  ) then raise exception 'v113_cost_trigger_missing'; end if;
end $$;
