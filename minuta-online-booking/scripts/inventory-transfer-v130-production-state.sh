#!/usr/bin/env bash
set -euo pipefail

db="${1:?database URL is required}"
export PGOPTIONS="${PGOPTIONS:-} -c default_transaction_read_only=on -c statement_timeout=60000 -c lock_timeout=5000"

base="$(psql "$db" -X -qAt -v ON_ERROR_STOP=1 <<'SQL'
with counts as (
  select
    (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='r' and c.relname in(
        'organization_inventory_transfer_settings','inventory_transfer_documents','inventory_cost_layers',
        'inventory_movement_cost_snapshots','inventory_cost_allocations')) tables_count,
    (select count(*) from information_schema.columns where table_schema='public' and table_name='inventory_movements'
      and ((column_name='purchase_total_cost_kopecks' and data_type='bigint') or (column_name='transfer_document_id' and data_type='uuid'))) columns_count,
    (select count(*) from pg_constraint where conrelid='public.inventory_movements'::regclass and conname in(
      'inventory_movements_transfer_document_fk_v130','inventory_movements_movement_type_check_v130',
      'inventory_purchase_cost_receipt_only_v130','inventory_transfer_movement_shape_v130')) constraints_count,
    (select count(*) from pg_index x join pg_class i on i.oid=x.indexrelid where x.indisvalid and x.indisready and (
      (x.indrelid='public.inventory_movements'::regclass and i.relname in('inventory_movements_id_organization_v130','inventory_transfer_movement_side_v130'))
      or (x.indrelid=to_regclass('public.inventory_cost_layers') and i.relname in('inventory_cost_layers_source_movement_v130','inventory_cost_layers_transfer_source_v130','inventory_cost_layers_fifo_v130'))
    )) indexes_count,
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in(
      'protect_minuta_inventory_transfer_ledger_v130','record_minuta_inventory_cost_v130',
      'verify_minuta_inventory_transfer_pair_v130','enable_minuta_inventory_transfers_v130',
      'set_minuta_inventory_transfers_enabled_v130','apply_minuta_stock_movement_v130',
      'transfer_minuta_inventory_stock_v130','get_minuta_inventory_workspace_v130')) functions_count,
    (select count(*) from pg_trigger where not tgisinternal and tgenabled='O' and (
      (tgrelid=to_regclass('public.inventory_transfer_documents') and tgname in('inventory_transfer_documents_immutable_v130','inventory_transfer_document_pair_v130'))
      or (tgrelid=to_regclass('public.inventory_movement_cost_snapshots') and tgname='inventory_movement_cost_snapshots_immutable_v130')
      or (tgrelid=to_regclass('public.inventory_cost_allocations') and tgname='inventory_cost_allocations_immutable_v130')
      or (tgrelid='public.inventory_movements'::regclass and tgname in('inventory_movement_cost_v130','inventory_transfer_movement_pair_v130'))
    )) triggers_count,
    (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relrowsecurity and c.relname in(
        'organization_inventory_transfer_settings','inventory_transfer_documents','inventory_cost_layers',
        'inventory_movement_cost_snapshots','inventory_cost_allocations')) rls_count,
    (select count(*) from pg_policies where schemaname='public' and policyname='inventory_transfer_manager_read'
      and tablename in('organization_inventory_transfer_settings','inventory_transfer_documents','inventory_cost_layers',
        'inventory_movement_cost_snapshots','inventory_cost_allocations')) policies_count
), prerequisites as (
  select
    to_regclass('public.organizations') is not null
    and to_regclass('public.organization_memberships') is not null
    and to_regclass('public.organization_inventory_settings') is not null
    and to_regclass('public.inventory_items') is not null
    and to_regclass('public.inventory_warehouses') is not null
    and to_regclass('public.inventory_stock_balances') is not null
    and to_regclass('public.inventory_movements') is not null
    and to_regclass('public.inventory_audit_log') is not null
    and to_regprocedure('public.get_minuta_inventory_role(uuid)') is not null
    and to_regprocedure('public.get_minuta_inventory_workspace(uuid)') is not null
    and to_regprocedure('public.write_minuta_inventory_audit(uuid,text,uuid,jsonb)') is not null
    and to_regprocedure('public.apply_minuta_stock_movement(uuid,uuid,uuid,text,numeric,numeric,text,uuid)') is not null
    and to_regprocedure('public.consume_minuta_inventory_for_booking(uuid)') is not null ready
)
select json_build_object(
  'prerequisitesReady',prerequisites.ready,
  'tables',counts.tables_count,'columns',counts.columns_count,'constraints',counts.constraints_count,
  'indexes',counts.indexes_count,'functions',counts.functions_count,'triggers',counts.triggers_count,
  'rls',counts.rls_count,'policies',counts.policies_count
) from counts,prerequisites;
SQL
)"

mode="$(jq -r '
  if ([.tables,.columns,.constraints,.indexes,.functions,.triggers,.rls,.policies]|add)==0 then "absent"
  elif .tables==5 and .columns==2 and .constraints==4 and .indexes==5 and .functions==8 and .triggers==6 and .rls==5 and .policies==5 then "full"
  else "partial" end
' <<<"$base")"
state="$(jq --arg mode "$mode" '. + {v130Mode:$mode}' <<<"$base")"
legacy_movement_evidence="$(psql "$db" -X -qAt -v ON_ERROR_STOP=1 -c "select count(*) from public.inventory_movements where movement_type in('transfer_out','transfer_in')")"
[[ "$legacy_movement_evidence" =~ ^[0-9]+$ ]]
state="$(jq --argjson evidence "$legacy_movement_evidence" '. + {legacyMovementEvidence:$evidence}' <<<"$state")"

if test "$mode" = full; then
  details="$(psql "$db" -X -qAt -v ON_ERROR_STOP=1 <<'SQL'
  select json_build_object(
    'constraintsValidated',(select count(*)=4 from pg_constraint where convalidated and conname in(
      'inventory_movements_transfer_document_fk_v130','inventory_movements_movement_type_check_v130',
      'inventory_purchase_cost_receipt_only_v130','inventory_transfer_movement_shape_v130')),
    'triggersEnabled',(select count(*)=6 from pg_trigger where not tgisinternal and tgenabled='O' and (
      (tgrelid='public.inventory_transfer_documents'::regclass and tgname in('inventory_transfer_documents_immutable_v130','inventory_transfer_document_pair_v130'))
      or (tgrelid='public.inventory_movement_cost_snapshots'::regclass and tgname='inventory_movement_cost_snapshots_immutable_v130')
      or (tgrelid='public.inventory_cost_allocations'::regclass and tgname='inventory_cost_allocations_immutable_v130')
      or (tgrelid='public.inventory_movements'::regclass and tgname in('inventory_movement_cost_v130','inventory_transfer_movement_pair_v130'))
    )),
    'functionSecurity',(select count(*)=7 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.prosecdef and array_to_string(p.proconfig,',') like '%search_path=""%'
      and p.proname in('record_minuta_inventory_cost_v130','verify_minuta_inventory_transfer_pair_v130','enable_minuta_inventory_transfers_v130',
        'set_minuta_inventory_transfers_enabled_v130','apply_minuta_stock_movement_v130',
        'transfer_minuta_inventory_stock_v130','get_minuta_inventory_workspace_v130'))
      and exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname='protect_minuta_inventory_transfer_ledger_v130'
          and not p.prosecdef and array_to_string(p.proconfig,',') like '%search_path=""%'),
    'rpcAcl',
      has_function_privilege('authenticated','public.enable_minuta_inventory_transfers_v130(uuid)','EXECUTE')
      and has_function_privilege('authenticated','public.set_minuta_inventory_transfers_enabled_v130(uuid,boolean)','EXECUTE')
      and has_function_privilege('authenticated','public.apply_minuta_stock_movement_v130(uuid,uuid,uuid,text,numeric,numeric,text,uuid,bigint)','EXECUTE')
      and has_function_privilege('authenticated','public.transfer_minuta_inventory_stock_v130(uuid,uuid,uuid,uuid,numeric,text,uuid)','EXECUTE')
      and has_function_privilege('authenticated','public.get_minuta_inventory_workspace_v130(uuid)','EXECUTE')
      and not has_function_privilege('anon','public.enable_minuta_inventory_transfers_v130(uuid)','EXECUTE')
      and not has_function_privilege('anon','public.set_minuta_inventory_transfers_enabled_v130(uuid,boolean)','EXECUTE')
      and not has_function_privilege('anon','public.apply_minuta_stock_movement_v130(uuid,uuid,uuid,text,numeric,numeric,text,uuid,bigint)','EXECUTE')
      and not has_function_privilege('anon','public.transfer_minuta_inventory_stock_v130(uuid,uuid,uuid,uuid,numeric,text,uuid)','EXECUTE')
      and not has_function_privilege('anon','public.get_minuta_inventory_workspace_v130(uuid)','EXECUTE'),
    'legacyAcl',
      has_function_privilege('authenticated','public.apply_minuta_stock_movement(uuid,uuid,uuid,text,numeric,numeric,text,uuid)','EXECUTE')
      and not has_function_privilege('anon','public.apply_minuta_stock_movement(uuid,uuid,uuid,text,numeric,numeric,text,uuid)','EXECUTE')
      and not has_function_privilege('authenticated','public.consume_minuta_inventory_for_booking(uuid)','EXECUTE'),
    'internalAcl',
      not has_function_privilege('authenticated','public.protect_minuta_inventory_transfer_ledger_v130()','EXECUTE')
      and not has_function_privilege('service_role','public.protect_minuta_inventory_transfer_ledger_v130()','EXECUTE')
      and not has_function_privilege('authenticated','public.record_minuta_inventory_cost_v130()','EXECUTE')
      and not has_function_privilege('service_role','public.record_minuta_inventory_cost_v130()','EXECUTE')
      and not has_function_privilege('authenticated','public.verify_minuta_inventory_transfer_pair_v130()','EXECUTE')
      and not has_function_privilege('service_role','public.verify_minuta_inventory_transfer_pair_v130()','EXECUTE'),
    'tableAcl',(select bool_and(
        has_table_privilege('authenticated',format('public.%I',t),'SELECT')
        and not has_table_privilege('authenticated',format('public.%I',t),'INSERT,UPDATE,DELETE')
        and not has_table_privilege('anon',format('public.%I',t),'SELECT,INSERT,UPDATE,DELETE')
        and has_table_privilege('service_role',format('public.%I',t),'SELECT,INSERT,UPDATE,DELETE')
      ) from unnest(array['organization_inventory_transfer_settings','inventory_transfer_documents','inventory_cost_layers',
        'inventory_movement_cost_snapshots','inventory_cost_allocations']) t),
    'policiesExact',(select count(*)=5 from pg_policies where schemaname='public'
      and policyname='inventory_transfer_manager_read' and cmd='SELECT' and roles=array['authenticated']::name[]
      and qual like '%has_organization_role%' and qual like '%owner%' and qual like '%admin%'
      and tablename in('organization_inventory_transfer_settings','inventory_transfer_documents','inventory_cost_layers',
        'inventory_movement_cost_snapshots','inventory_cost_allocations')),
    'legacyLockOrder',(with d as(select lower(pg_get_functiondef(
        'public.apply_minuta_stock_movement(uuid,uuid,uuid,text,numeric,numeric,text,uuid)'::regprocedure)) body)
      select strpos(body,'13000')>0 and strpos(body,'8200')>strpos(body,'13000')
        and strpos(body,'13001')>strpos(body,'8200') and strpos(body,'8201')>strpos(body,'13001') from d),
    'consumeLockOrder',(with d as(select lower(pg_get_functiondef(
        'public.consume_minuta_inventory_for_booking(uuid)'::regprocedure)) body)
      select strpos(body,'13000')>0 and strpos(body,'13001')>strpos(body,'13000')
        and strpos(body,'8202')>strpos(body,'13001') and strpos(body,'8201')>strpos(body,'8202') from d),
    'initialized',exists(select 1 from public.organization_inventory_transfer_settings where initialized_at is not null),
    'enabled',exists(select 1 from public.organization_inventory_transfer_settings where enabled),
    'suspended',exists(select 1 from public.organization_inventory_transfer_settings where suspended_at is not null),
    'settingsRows',(select count(*) from public.organization_inventory_transfer_settings),
    'documentsRows',(select count(*) from public.inventory_transfer_documents),
    'costLayersRows',(select count(*) from public.inventory_cost_layers),
    'snapshotsRows',(select count(*) from public.inventory_movement_cost_snapshots),
    'allocationsRows',(select count(*) from public.inventory_cost_allocations),
    'movementEvidence',(select count(*) from public.inventory_movements where transfer_document_id is not null
      or purchase_total_cost_kopecks is not null or movement_type in('transfer_out','transfer_in'))
  );
SQL
)"
  state="$(jq --argjson details "$details" '. + $details' <<<"$state")"
  schema_fingerprint="$(psql "$db" -X -qAt -v ON_ERROR_STOP=1 -f minuta-online-booking/scripts/inventory-transfer-v130-schema-fingerprint.sql | tr -d '[:space:]')"
  [[ "$schema_fingerprint" =~ ^[0-9a-f]{64}$ ]]
  state="$(jq --arg fingerprint "$schema_fingerprint" '. + {schemaFingerprint:$fingerprint}' <<<"$state")"
else
  state="$(jq '. + {initialized:false,enabled:false,suspended:false,settingsRows:0,documentsRows:0,costLayersRows:0,snapshotsRows:0,allocationsRows:0,movementEvidence:.legacyMovementEvidence,schemaFingerprint:null}' <<<"$state")"
fi

jq -c . <<<"$state"
