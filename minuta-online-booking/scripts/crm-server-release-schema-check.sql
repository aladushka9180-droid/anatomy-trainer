\set ON_ERROR_STOP on
\if :{?expected_state}
\else
  \echo 'expected_state is required'
  \quit 2
\endif

select set_config('minuta.crm_release_expected_state', :'expected_state', false);

do $crm_schema_check$
declare
  v_state text := current_setting('minuta.crm_release_expected_state');
  v_definition text;
begin
  if v_state not in ('applied', 'rolled_back') then
    raise exception 'invalid_crm_release_expected_state:%', v_state;
  end if;

  if to_regclass('public.client_record_settings') is null
     or to_regclass('public.client_record_entries') is null
     or to_regclass('public.notification_v114_organization_cutovers') is null
     or to_regclass('public.notification_v114_worker_readiness') is null
     or to_regclass('public.notification_v114_legacy_send_leases') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema='public' and table_name='notification_outbox' and column_name='delivered_at'
     ) then
    raise exception 'crm_release_additive_objects_missing';
  end if;

  if coalesce((select bool_or(enabled) from public.client_record_settings), false)
     or exists(select 1 from public.notification_v114_organization_cutovers)
     or exists(select 1 from public.notification_v114_worker_readiness) then
    raise exception 'crm_release_feature_was_activated';
  end if;

  if has_table_privilege('anon','public.client_record_entries','SELECT')
     or has_table_privilege('authenticated','public.client_record_entries','SELECT')
     or has_table_privilege('anon','public.notification_v114_organization_cutovers','SELECT')
     or has_table_privilege('authenticated','public.notification_v114_organization_cutovers','SELECT') then
    raise exception 'crm_release_raw_table_acl_invalid';
  end if;

  if v_state = 'applied' then
    if to_regprocedure('public.get_minuta_client_records(uuid,text,integer)') is null
       or to_regprocedure('public.get_minuta_profitability_v113(uuid,date,date,uuid,uuid)') is null
       or to_regprocedure('public.ack_minuta_notification_outbox_v114(uuid,uuid,text,text,timestamptz,text)') is null
       or to_regprocedure('public.activate_minuta_notification_v114_cutover(uuid,text,text[])') is null
       or to_regclass('public.organization_inventory_cost_settings') is null
       or to_regclass('public.inventory_cost_layers') is null
       or to_regclass('public.inventory_movement_cost_snapshots') is null then
      raise exception 'crm_release_applied_objects_missing';
    end if;
    if not has_function_privilege('authenticated','public.get_minuta_client_records(uuid,text,integer)','EXECUTE')
       or has_function_privilege('anon','public.get_minuta_client_records(uuid,text,integer)','EXECUTE')
       or not has_function_privilege('authenticated','public.get_minuta_profitability_v113(uuid,date,date,uuid,uuid)','EXECUTE')
       or has_function_privilege('anon','public.get_minuta_profitability_v113(uuid,date,date,uuid,uuid)','EXECUTE')
       or not has_function_privilege('service_role','public.ack_minuta_notification_outbox_v114(uuid,uuid,text,text,timestamptz,text)','EXECUTE')
       or has_function_privilege('authenticated','public.ack_minuta_notification_outbox_v114(uuid,uuid,text,text,timestamptz,text)','EXECUTE') then
      raise exception 'crm_release_applied_rpc_acl_invalid';
    end if;
    if coalesce((select bool_or(enabled or initialized_at is not null)
                 from public.organization_inventory_cost_settings), false) then
      raise exception 'v113_was_activated';
    end if;
    if not exists (
      select 1 from pg_trigger
      where tgrelid='public.inventory_movements'::regclass
        and tgname='inventory_movement_cost_v113' and not tgisinternal
    ) then
      raise exception 'v113_cost_trigger_missing';
    end if;
  else
    if to_regclass('public.organization_inventory_cost_settings') is not null
       or to_regclass('public.inventory_cost_layers') is not null
       or to_regprocedure('public.get_minuta_profitability_v113(uuid,date,date,uuid,uuid)') is not null then
      raise exception 'v113_destructive_rollback_incomplete';
    end if;
    if has_function_privilege('authenticated','public.get_minuta_client_records(uuid,text,integer)','EXECUTE')
       or has_function_privilege('authenticated','public.set_minuta_client_records_enabled(uuid,boolean)','EXECUTE') then
      raise exception 'v112_compatibility_rollback_incomplete';
    end if;
    select lower(pg_get_functiondef(
      'public.activate_minuta_notification_v114_cutover(uuid,text,text[])'::regprocedure
    )) into v_definition;
    if position('v114_cutover_paused_by_rollback' in v_definition)=0 then
      raise exception 'v114_compatibility_rollback_incomplete';
    end if;
    if exists (
      select 1 from pg_trigger
      where tgname='client_telegram_subscription_sync_v114' and not tgisinternal
    ) then
      raise exception 'v114_subscription_trigger_still_active';
    end if;
  end if;
end
$crm_schema_check$;

select 'crm_server_release_schema_check_ok:' || current_setting('minuta.crm_release_expected_state');
