-- v133 rollback: allowed only before customer debt settlement evidence is created.
begin;
set local lock_timeout='10s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $guard$
begin
  if exists(select 1 from public.organization_finance_settings where enabled) then
    raise exception using errcode='55000',message='v133_rollback_disable_finance_first';
  end if;
  if (to_regclass('public.financial_debt_settlement_sources') is not null
      and exists(select 1 from public.financial_debt_settlement_sources))
     or exists(select 1 from public.financial_transactions
       where operation_type='customer_debt_settlement'
          or (operation_type='reversal' and explanation->>'original_operation_type'='customer_debt_settlement')) then
    raise exception using errcode='55000',message='v133_rollback_preserves_debt_settlement_evidence';
  end if;
end
$guard$;

drop trigger if exists organization_finance_commission_account_v133 on public.organization_finance_settings;
drop function if exists public.set_minuta_finance_enabled_v133(uuid,boolean);
drop function if exists public.settle_minuta_customer_debt_v133(uuid,uuid,uuid,text,text,bigint,timestamptz,uuid);
drop function if exists public.reverse_minuta_customer_debt_settlement_v133(uuid,uuid,uuid,text);
drop function if exists public.reverse_minuta_visit_finance_v133(uuid,uuid,uuid,text);
drop function if exists public.get_minuta_financial_reconciliation_v133(uuid,integer);
drop function if exists public.ensure_minuta_commission_account_v133();
drop trigger if exists financial_visit_reversal_guard_v133 on public.financial_transactions;
drop function if exists public.guard_minuta_visit_reversal_v133();

drop policy if exists financial_debt_settlement_sources_manager_read_v133
  on public.financial_debt_settlement_sources;
drop trigger if exists financial_debt_settlement_sources_immutable_v133
  on public.financial_debt_settlement_sources;
drop function if exists public.protect_minuta_financial_debt_source_v133();
drop table if exists public.financial_debt_settlement_sources;

delete from public.financial_accounts account
where account.system_key='payment_channel_commission'
  and not exists(select 1 from public.financial_postings posting where posting.account_id=account.id);

do $constraints$
declare v_constraint record;
begin
  for v_constraint in
    select constraint_row.conname from pg_constraint constraint_row
    where constraint_row.conrelid='public.financial_accounts'::regclass
      and constraint_row.contype='c'
      and (pg_get_constraintdef(constraint_row.oid) like '%account_type%'
        or pg_get_constraintdef(constraint_row.oid) like '%system_key%')
  loop
    execute format('alter table public.financial_accounts drop constraint %I',v_constraint.conname);
  end loop;
end
$constraints$;

alter table public.financial_accounts
  add constraint financial_accounts_account_type_v132_check check(account_type in(
    'cash','bank','receivable','service_revenue','operating_expense','supplier_payable'
  )),
  add constraint financial_accounts_system_key_v132_check check(system_key is null or system_key in(
    'receivable','service_revenue','operating_expense','supplier_payable'
  )),
  add constraint financial_accounts_system_mapping_v132_check check(
    (system_key is null and account_type in('cash','bank') and account_class='asset')
    or (system_key='receivable' and account_type='receivable' and account_class='asset')
    or (system_key='service_revenue' and account_type='service_revenue' and account_class='income')
    or (system_key='operating_expense' and account_type='operating_expense' and account_class='expense')
    or (system_key='supplier_payable' and account_type='supplier_payable' and account_class='liability')
  ),
  add constraint financial_accounts_system_request_v132_check check(
    (system_key is null)=(creation_request_id is not null)
  );

do $constraints$
declare v_constraint record;
begin
  for v_constraint in
    select constraint_row.conname from pg_constraint constraint_row
    where constraint_row.conrelid='public.financial_transactions'::regclass
      and constraint_row.contype='c'
      and (pg_get_constraintdef(constraint_row.oid) like '%operation_type%'
        or pg_get_constraintdef(constraint_row.oid) like '%source_type%')
  loop
    execute format('alter table public.financial_transactions drop constraint %I',v_constraint.conname);
  end loop;
end
$constraints$;

alter table public.financial_transactions
  add constraint financial_transactions_operation_v132_check check(operation_type in(
    'visit_service','supplier_expense_accrual','supplier_expense_payment','reversal'
  )),
  add constraint financial_transactions_source_v132_check check(source_type in(
    'booking_outcome','financial_expense_source','financial_transaction'
  )),
  add constraint financial_transactions_shape_v132_check check(
    (operation_type='visit_service' and source_type='booking_outcome' and reversal_of is null)
    or (operation_type in('supplier_expense_accrual','supplier_expense_payment')
      and source_type='financial_expense_source' and reversal_of is null)
    or (operation_type='reversal' and source_type='financial_transaction'
      and reversal_of is not null and source_id=reversal_of)
  );

grant execute on function public.reverse_minuta_financial_transaction_v129(uuid,uuid,uuid,text)
  to authenticated;

notify pgrst,'reload schema';
commit;
