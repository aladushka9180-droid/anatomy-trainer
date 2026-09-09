-- v132 rollback: allowed only before supplier/expense evidence is created.
begin;
set local lock_timeout='10s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $guard$
begin
  if exists(select 1 from public.organization_finance_settings where enabled) then
    raise exception using errcode='55000',message='v132_rollback_disable_finance_first';
  end if;
  if (to_regclass('public.financial_suppliers') is not null
      and exists(select 1 from public.financial_suppliers))
     or (to_regclass('public.financial_expense_sources') is not null
      and exists(select 1 from public.financial_expense_sources))
     or exists(select 1 from public.financial_transactions
       where operation_type in('supplier_expense_accrual','supplier_expense_payment')
          or (operation_type='reversal' and explanation->>'original_operation_type'
            in('supplier_expense_accrual','supplier_expense_payment'))) then
    raise exception using errcode='55000',message='v132_rollback_preserves_expense_evidence';
  end if;
end
$guard$;

drop trigger if exists organization_finance_system_accounts_v132 on public.organization_finance_settings;
drop function if exists public.set_minuta_finance_enabled_v132(uuid,boolean);
drop function if exists public.create_minuta_financial_supplier_v132(uuid,uuid,text);
drop function if exists public.accrue_minuta_supplier_expense_v132(uuid,uuid,uuid,bigint,timestamptz,uuid);
drop function if exists public.pay_minuta_supplier_expense_v132(uuid,uuid,uuid,uuid);
drop function if exists public.reverse_minuta_supplier_expense_payment_v132(uuid,uuid,uuid,text);
drop function if exists public.reverse_minuta_supplier_expense_accrual_v132(uuid,uuid,uuid,text);
drop function if exists public.reverse_minuta_supplier_expense_v132(uuid,uuid,uuid,text,text);
drop function if exists public.ensure_minuta_expense_system_accounts_v132();

drop policy if exists financial_expense_sources_manager_read_v132 on public.financial_expense_sources;
drop policy if exists financial_suppliers_manager_read_v132 on public.financial_suppliers;
drop trigger if exists financial_expense_sources_immutable_v132 on public.financial_expense_sources;
drop trigger if exists financial_suppliers_immutable_v132 on public.financial_suppliers;
drop function if exists public.protect_minuta_financial_expense_source_v132();
drop table if exists public.financial_expense_sources;
drop table if exists public.financial_suppliers;

delete from public.financial_accounts account
where account.system_key in('operating_expense','supplier_payable')
  and not exists(select 1 from public.financial_postings posting where posting.account_id=account.id);

do $constraints$
declare v_constraint record;
begin
  for v_constraint in
    select constraint_row.conname
    from pg_constraint constraint_row
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
  add constraint financial_accounts_account_type_check check(account_type in(
    'cash','bank','receivable','service_revenue'
  )),
  add constraint financial_accounts_system_key_check check(system_key is null or system_key in(
    'receivable','service_revenue'
  )),
  add constraint financial_accounts_check check(
    (system_key is null and account_type in('cash','bank') and account_class='asset')
    or (system_key='receivable' and account_type='receivable' and account_class='asset')
    or (system_key='service_revenue' and account_type='service_revenue' and account_class='income')
  ),
  add constraint financial_accounts_check2 check(
    (system_key is null)=(creation_request_id is not null)
  );

do $constraints$
declare v_constraint record;
begin
  for v_constraint in
    select constraint_row.conname
    from pg_constraint constraint_row
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
  add constraint financial_transactions_operation_type_check check(operation_type in('visit_service','reversal')),
  add constraint financial_transactions_source_type_check check(source_type in('booking_outcome','financial_transaction')),
  add constraint financial_transactions_check1 check(
    (operation_type='visit_service' and source_type='booking_outcome' and reversal_of is null)
    or (operation_type='reversal' and source_type='financial_transaction'
      and reversal_of is not null and source_id=reversal_of)
  );

notify pgrst,'reload schema';
commit;
