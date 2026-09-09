#!/usr/bin/env bash
set -euo pipefail

db="${1:?database URL is required}"
node minuta-online-booking/scripts/production-db-target-guard.mjs >/dev/null

state="$(PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=60000 -c lock_timeout=5000' \
  psql "$db" -X -qAt -v ON_ERROR_STOP=1 <<'SQL'
with objects as (
  select
    to_regclass('public.organization_finance_settings') settings_table,
    to_regclass('public.financial_accounts') accounts_table,
    to_regclass('public.financial_transactions') transactions_table,
    to_regclass('public.financial_postings') postings_table,
    to_regprocedure('public.set_minuta_finance_enabled_v129(uuid,boolean)') set_v129,
    to_regprocedure('public.minuta_financial_sha256_v129(jsonb)') sha_v129,
    to_regprocedure('public.require_minuta_financial_manager_v129(uuid)') manager_v129,
    to_regprocedure('public.protect_minuta_financial_ledger_v129()') protect_v129,
    to_regprocedure('extensions.digest(bytea,text)') digest_fn,
    to_regclass('public.financial_suppliers') suppliers_table,
    to_regclass('public.financial_expense_sources') expense_sources_table,
    to_regprocedure('public.protect_minuta_financial_expense_source_v132()') protect_v132,
    to_regprocedure('public.ensure_minuta_expense_system_accounts_v132()') ensure_v132,
    to_regprocedure('public.set_minuta_finance_enabled_v132(uuid,boolean)') set_v132,
    to_regprocedure('public.create_minuta_financial_supplier_v132(uuid,uuid,text)') supplier_v132,
    to_regprocedure('public.accrue_minuta_supplier_expense_v132(uuid,uuid,uuid,bigint,timestamp with time zone,uuid)') accrue_v132,
    to_regprocedure('public.pay_minuta_supplier_expense_v132(uuid,uuid,uuid,uuid)') pay_v132,
    to_regprocedure('public.reverse_minuta_supplier_expense_v132(uuid,uuid,uuid,text)') reverse_supplier_v132,
    to_regprocedure('public.reverse_minuta_supplier_expense_payment_v132(uuid,uuid,uuid,text)') reverse_payment_v132,
    to_regprocedure('public.reverse_minuta_supplier_expense_accrual_v132(uuid,uuid,uuid,text)') reverse_accrual_v132,
    to_regclass('public.financial_debt_settlement_sources') debt_sources_table,
    to_regprocedure('public.set_minuta_finance_enabled_v133(uuid,boolean)') set_v133,
    to_regprocedure('public.settle_minuta_customer_debt_v133(uuid,uuid,uuid,text,text,bigint,timestamp with time zone,uuid)') settle_v133,
    to_regprocedure('public.reverse_minuta_customer_debt_settlement_v133(uuid,uuid,uuid,text)') reverse_debt_v133,
    to_regprocedure('public.reverse_minuta_visit_finance_v133(uuid,uuid,uuid,text)') reverse_visit_v133,
    to_regprocedure('public.get_minuta_financial_reconciliation_v133(uuid,integer)') reconcile_v133,
    to_regprocedure('public.protect_minuta_financial_debt_source_v133()') protect_v133,
    to_regprocedure('public.guard_minuta_visit_reversal_v133()') reversal_guard_v133,
    to_regprocedure('public.ensure_minuta_commission_account_v133()') commission_guard_v133
), flags as (
  select *,
    settings_table is not null and accounts_table is not null and transactions_table is not null
      and postings_table is not null and set_v129 is not null and sha_v129 is not null
      and manager_v129 is not null and protect_v129 is not null and digest_fn is not null as base_ready,
    num_nonnulls(suppliers_table,expense_sources_table,protect_v132,ensure_v132,set_v132,supplier_v132,
      accrue_v132,pay_v132,reverse_supplier_v132,reverse_payment_v132,reverse_accrual_v132) as v132_presence,
    num_nonnulls(debt_sources_table,set_v133,settle_v133,reverse_debt_v133,reverse_visit_v133,
      reconcile_v133,protect_v133,reversal_guard_v133,commission_guard_v133) as v133_presence
  from objects
), catalog as (
  select flags.*,
    coalesce((select bool_and(relrowsecurity) from pg_class where oid=any(array[suppliers_table,expense_sources_table])),false) v132_rls,
    coalesce((select relrowsecurity from pg_class where oid=debt_sources_table),false) v133_rls,
    (select count(*) from pg_constraint where connamespace='public'::regnamespace and conname in(
      'financial_accounts_account_type_v132_check','financial_accounts_system_key_v132_check',
      'financial_accounts_system_mapping_v132_check','financial_accounts_system_request_v132_check',
      'financial_transactions_operation_v132_check','financial_transactions_source_v132_check',
      'financial_transactions_shape_v132_check')) v132_constraint_count,
    (select count(*) from pg_constraint where connamespace='public'::regnamespace and conname in(
      'financial_accounts_account_type_v133_check','financial_accounts_system_key_v133_check',
      'financial_accounts_system_mapping_v133_check','financial_accounts_system_request_v133_check',
      'financial_transactions_operation_v133_check','financial_transactions_source_v133_check',
      'financial_transactions_shape_v133_check')) v133_constraint_count,
    (select count(*) from pg_indexes where schemaname='public' and indexname in(
      'financial_suppliers_scope_v132_idx','financial_expense_sources_scope_v132_idx',
      'financial_expense_sources_supplier_v132_idx')) v132_index_count,
    (select count(*) from pg_indexes where schemaname='public' and indexname in(
      'financial_debt_settlement_reference_v133_uidx','financial_debt_settlement_visit_v133_idx')) v133_index_count,
    (select count(*) from pg_trigger where not tgisinternal and tgenabled<>'D' and tgname in(
      'financial_suppliers_immutable_v132','financial_expense_sources_immutable_v132',
      'organization_finance_system_accounts_v132')) v132_trigger_count,
    (select count(*) from pg_trigger where not tgisinternal and tgenabled<>'D' and tgname in(
      'financial_debt_settlement_sources_immutable_v133','financial_visit_reversal_guard_v133',
      'organization_finance_commission_account_v133')) v133_trigger_count,
    (select count(*) from pg_policies where schemaname='public' and policyname in(
      'financial_suppliers_manager_read_v132','financial_expense_sources_manager_read_v132')) v132_policy_count,
    (select count(*) from pg_policies where schemaname='public'
      and policyname='financial_debt_settlement_sources_manager_read_v133') v133_policy_count
  from flags
), security as (
  select catalog.*,
    coalesce((select bool_and(p.prosecdef and coalesce(array_to_string(p.proconfig,','),'') like '%search_path=""%')
      from pg_proc p where p.oid=any(array[set_v132,supplier_v132,accrue_v132,pay_v132,reverse_supplier_v132,
        reverse_payment_v132,reverse_accrual_v132])),false) v132_hardened,
    coalesce((select bool_and(has_function_privilege('authenticated',p.oid,'EXECUTE')
      and not has_function_privilege('anon',p.oid,'EXECUTE')
      and not has_function_privilege('service_role',p.oid,'EXECUTE'))
      from pg_proc p where p.oid=any(array[set_v132,supplier_v132,accrue_v132,pay_v132,reverse_supplier_v132,
        reverse_payment_v132,reverse_accrual_v132])),false) v132_acl,
    coalesce((select bool_and(not has_function_privilege('authenticated',p.oid,'EXECUTE')
      and not has_function_privilege('anon',p.oid,'EXECUTE')
      and not has_function_privilege('service_role',p.oid,'EXECUTE'))
      from pg_proc p where p.oid=any(array[protect_v132,ensure_v132])),false) v132_helper_acl,
    coalesce(has_table_privilege('authenticated',suppliers_table,'SELECT')
      and has_table_privilege('authenticated',expense_sources_table,'SELECT')
      and not has_table_privilege('authenticated',suppliers_table,'INSERT')
      and not has_table_privilege('authenticated',suppliers_table,'UPDATE')
      and not has_table_privilege('authenticated',suppliers_table,'DELETE')
      and not has_table_privilege('authenticated',expense_sources_table,'INSERT')
      and not has_table_privilege('authenticated',expense_sources_table,'UPDATE')
      and not has_table_privilege('authenticated',expense_sources_table,'DELETE')
      and not has_table_privilege('anon',suppliers_table,'SELECT')
      and not has_table_privilege('anon',suppliers_table,'INSERT')
      and not has_table_privilege('anon',suppliers_table,'UPDATE')
      and not has_table_privilege('anon',suppliers_table,'DELETE')
      and not has_table_privilege('anon',expense_sources_table,'SELECT')
      and not has_table_privilege('anon',expense_sources_table,'INSERT')
      and not has_table_privilege('anon',expense_sources_table,'UPDATE')
      and not has_table_privilege('anon',expense_sources_table,'DELETE')
      and not has_table_privilege('service_role',suppliers_table,'SELECT')
      and not has_table_privilege('service_role',suppliers_table,'INSERT')
      and not has_table_privilege('service_role',suppliers_table,'UPDATE')
      and not has_table_privilege('service_role',suppliers_table,'DELETE')
      and not has_table_privilege('service_role',expense_sources_table,'SELECT')
      and not has_table_privilege('service_role',expense_sources_table,'INSERT')
      and not has_table_privilege('service_role',expense_sources_table,'UPDATE')
      and not has_table_privilege('service_role',expense_sources_table,'DELETE'),false) v132_table_acl,
    coalesce((select bool_and(p.prosecdef and coalesce(array_to_string(p.proconfig,','),'') like '%search_path=""%')
      from pg_proc p where p.oid=any(array[set_v133,settle_v133,reverse_debt_v133,reverse_visit_v133,reconcile_v133])),false)
      v133_hardened,
    coalesce((select bool_and(has_function_privilege('authenticated',p.oid,'EXECUTE')
      and not has_function_privilege('anon',p.oid,'EXECUTE')
      and not has_function_privilege('service_role',p.oid,'EXECUTE'))
      from pg_proc p where p.oid=any(array[set_v133,settle_v133,reverse_debt_v133,reverse_visit_v133,reconcile_v133])),false)
      v133_acl,
    coalesce((select bool_and(not has_function_privilege('authenticated',p.oid,'EXECUTE')
      and not has_function_privilege('anon',p.oid,'EXECUTE')
      and not has_function_privilege('service_role',p.oid,'EXECUTE'))
      from pg_proc p where p.oid=any(array[protect_v133,reversal_guard_v133,commission_guard_v133])),false)
      v133_helper_acl,
    coalesce(has_table_privilege('authenticated',debt_sources_table,'SELECT')
      and not has_table_privilege('authenticated',debt_sources_table,'INSERT')
      and not has_table_privilege('authenticated',debt_sources_table,'UPDATE')
      and not has_table_privilege('authenticated',debt_sources_table,'DELETE')
      and not has_table_privilege('anon',debt_sources_table,'SELECT')
      and not has_table_privilege('anon',debt_sources_table,'INSERT')
      and not has_table_privilege('anon',debt_sources_table,'UPDATE')
      and not has_table_privilege('anon',debt_sources_table,'DELETE')
      and not has_table_privilege('service_role',debt_sources_table,'SELECT')
      and not has_table_privilege('service_role',debt_sources_table,'INSERT')
      and not has_table_privilege('service_role',debt_sources_table,'UPDATE')
      and not has_table_privilege('service_role',debt_sources_table,'DELETE'),false) v133_table_acl
  from catalog
), evaluated as (
  select *,
    v132_presence=11 and (v132_constraint_count=7 or v133_constraint_count=7) and v132_index_count=3
      and v132_trigger_count=3 and v132_policy_count=2 and v132_rls and v132_hardened and v132_acl
      and v132_helper_acl and v132_table_acl as v132_full,
    v133_presence=9 and v133_constraint_count=7 and v133_index_count=2 and v133_trigger_count=3
      and v133_policy_count=1 and v133_rls and v133_hardened and v133_acl and v133_helper_acl
      and v133_table_acl as v133_full
  from security
), definitions as (
  select 'function:'||p.oid::regprocedure::text||':'||pg_get_functiondef(p.oid) definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and (p.proname like '%v132' or p.proname like '%v133')
  union all
  select 'constraint:'||conname||':'||pg_get_constraintdef(oid,true) from pg_constraint
  where connamespace='public'::regnamespace and (conname like '%v132%' or conname like '%v133%')
  union all
  select 'index:'||indexname||':'||indexdef from pg_indexes where schemaname='public'
    and (indexname like '%v132%' or indexname like '%v133%')
  union all
  select 'trigger:'||tgname||':'||pg_get_triggerdef(oid,true) from pg_trigger where not tgisinternal
    and (tgname like '%v132%' or tgname like '%v133%')
  union all
  select 'policy:'||policyname||':'||coalesce(qual,'')||':'||coalesce(with_check,'') from pg_policies
  where schemaname='public' and (policyname like '%v132%' or policyname like '%v133%')
), fingerprint as (
  select encode(extensions.digest(convert_to(coalesce(string_agg(definition,E'\n' order by definition),''),'UTF8'),'sha256'),'hex') value
  from definitions
)
select jsonb_build_object(
  'schemaServerVersion',current_setting('server_version'),
  'schemaServerMajor',current_setting('server_version_num')::integer/10000,
  'baseReady',base_ready,
  'v132Mode',case when v132_presence=0 and v132_constraint_count=0 and v132_index_count=0
    and v132_trigger_count=0 and v132_policy_count=0 then 'absent' when v132_full then 'full' else 'partial' end,
  'v133Mode',case when v133_presence=0 and v133_constraint_count=0 and v133_index_count=0
    and v133_trigger_count=0 and v133_policy_count=0 then 'absent' when v133_full then 'full' else 'partial' end,
  'cumulativeSchemaFingerprint',case when v132_full and (v133_presence=0 or v133_full) then fingerprint.value else null end,
  'v132SuppliersPresent',suppliers_table is not null,
  'v132ExpenseSourcesPresent',expense_sources_table is not null,
  'v133DebtSourcesPresent',debt_sources_table is not null,
  'v132HardeningReady',v132_full,
  'v133HardeningReady',v133_full
)
from evaluated cross join fingerprint;
SQL
)"

jq -e 'type=="object" and (.v132Mode|IN("absent","partial","full")) and (.v133Mode|IN("absent","partial","full"))' <<<"$state" >/dev/null

if test "$(jq -r .baseReady <<<"$state")" = true; then
  counts="$(PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=60000 -c lock_timeout=5000' \
    psql "$db" -X -qAt -v ON_ERROR_STOP=1 <<'SQL'
select jsonb_build_object(
  'financeSettings',(select count(*) from public.organization_finance_settings),
  'financeEnabled',(select count(*) from public.organization_finance_settings where enabled),
  'accounts',(select count(*) from public.financial_accounts),
  'transactions',(select count(*) from public.financial_transactions),
  'postings',(select count(*) from public.financial_postings)
);
SQL
)"
  supplier_count=0
  expense_count=0
  debt_count=0
  if test "$(jq -r .v132SuppliersPresent <<<"$state")" = true; then
    supplier_count="$(PGOPTIONS='-c default_transaction_read_only=on' psql "$db" -X -qAt -v ON_ERROR_STOP=1 -c 'select count(*) from public.financial_suppliers')"
  fi
  if test "$(jq -r .v132ExpenseSourcesPresent <<<"$state")" = true; then
    expense_count="$(PGOPTIONS='-c default_transaction_read_only=on' psql "$db" -X -qAt -v ON_ERROR_STOP=1 -c 'select count(*) from public.financial_expense_sources')"
  fi
  if test "$(jq -r .v133DebtSourcesPresent <<<"$state")" = true; then
    debt_count="$(PGOPTIONS='-c default_transaction_read_only=on' psql "$db" -X -qAt -v ON_ERROR_STOP=1 -c 'select count(*) from public.financial_debt_settlement_sources')"
  fi
  counts="$(jq --argjson suppliers "$supplier_count" --argjson expenses "$expense_count" --argjson debts "$debt_count" \
    '. + {suppliers:$suppliers,expenseSources:$expenses,debtSettlementSources:$debts}' <<<"$counts")"
else
  counts=null
fi

jq -c --argjson counts "$counts" '. + {financialRowCounts:$counts}' <<<"$state"
