-- Roll back v147 commercial sales, refunds and recurring expense rules.
begin;
set local lock_timeout='10s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $guard$
begin
  if to_regclass('public.commercial_sales') is not null
     and (exists(select 1 from public.commercial_sales limit 1)
       or exists(select 1 from public.organization_recurring_expenses limit 1)
       or exists(select 1 from public.commercial_audit_log limit 1)) then
    raise exception using errcode='55000',message='v147_rollback_blocked_commercial_data_exists';
  end if;
end
$guard$;

drop function if exists public.get_minuta_money_dashboard_v147(uuid,date,date);
drop function if exists public.get_minuta_client_commerce_v147(uuid,uuid);
drop function if exists public.get_minuta_commerce_workspace_v147(uuid);
drop function if exists public.record_minuta_recurring_expense_v147(uuid,uuid,date,uuid);
drop function if exists public.create_minuta_recurring_expense_v147(uuid,text,text,bigint,uuid,uuid,integer,uuid);
drop function if exists public.refund_minuta_commercial_sale_v147(uuid,uuid,numeric,bigint,text,uuid);
drop function if exists public.sell_minuta_commercial_product_v147(uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid);

drop table if exists public.commercial_audit_log;
drop table if exists public.recurring_expense_occurrences;
drop table if exists public.organization_recurring_expenses;
drop table if exists public.commercial_sale_refunds;
drop table if exists public.commercial_sale_lines;
drop table if exists public.commercial_sales;

do $constraints$
declare v_constraint record;
begin
  for v_constraint in select c.conname from pg_constraint c
    where c.conrelid='public.financial_accounts'::regclass and c.contype='c'
      and (pg_get_constraintdef(c.oid) like '%account_type%' or pg_get_constraintdef(c.oid) like '%system_key%')
  loop execute format('alter table public.financial_accounts drop constraint %I',v_constraint.conname); end loop;
end
$constraints$;

alter table public.financial_accounts
  add constraint financial_accounts_account_type_v136_check check(account_type in(
    'cash','bank','receivable','service_revenue','operating_expense','supplier_payable',
    'payment_channel_commission','payroll_expense','payroll_payable','employee_advance'
  )),
  add constraint financial_accounts_system_key_v136_check check(system_key is null or system_key in(
    'receivable','service_revenue','operating_expense','supplier_payable','payment_channel_commission',
    'payroll_expense','payroll_payable','employee_advance'
  )),
  add constraint financial_accounts_system_mapping_v136_check check(
    (system_key is null and account_type in('cash','bank') and account_class='asset')
    or (system_key='receivable' and account_type='receivable' and account_class='asset')
    or (system_key='service_revenue' and account_type='service_revenue' and account_class='income')
    or (system_key='operating_expense' and account_type='operating_expense' and account_class='expense')
    or (system_key='supplier_payable' and account_type='supplier_payable' and account_class='liability')
    or (system_key='payment_channel_commission' and account_type='payment_channel_commission' and account_class='expense')
    or (system_key='payroll_expense' and account_type='payroll_expense' and account_class='expense')
    or (system_key='payroll_payable' and account_type='payroll_payable' and account_class='liability')
    or (system_key='employee_advance' and account_type='employee_advance' and account_class='asset')
  ),
  add constraint financial_accounts_system_request_v136_check check((system_key is null)=(creation_request_id is not null));

do $constraints$
declare v_constraint record;
begin
  for v_constraint in select c.conname from pg_constraint c
    where c.conrelid='public.financial_transactions'::regclass and c.contype='c'
      and (pg_get_constraintdef(c.oid) like '%operation_type%' or pg_get_constraintdef(c.oid) like '%source_type%')
  loop execute format('alter table public.financial_transactions drop constraint %I',v_constraint.conname); end loop;
end
$constraints$;

alter table public.financial_transactions
  add constraint financial_transactions_operation_v136_check check(operation_type in(
    'visit_service','supplier_expense_accrual','supplier_expense_payment','customer_debt_settlement',
    'payroll_accrual','payroll_payment','payroll_advance','payroll_advance_offset','reversal'
  )),
  add constraint financial_transactions_source_v136_check check(source_type in(
    'booking_outcome','financial_expense_source','financial_debt_settlement_source',
    'financial_payroll_accrual_source','financial_payroll_payment_source',
    'financial_payroll_advance_source','financial_payroll_advance_offset','financial_transaction'
  )),
  add constraint financial_transactions_shape_v136_check check(
    (operation_type='visit_service' and source_type='booking_outcome' and reversal_of is null)
    or (operation_type in('supplier_expense_accrual','supplier_expense_payment') and source_type='financial_expense_source' and reversal_of is null)
    or (operation_type='customer_debt_settlement' and source_type='financial_debt_settlement_source' and reversal_of is null)
    or (operation_type='payroll_accrual' and source_type='financial_payroll_accrual_source' and reversal_of is null)
    or (operation_type='payroll_payment' and source_type='financial_payroll_payment_source' and reversal_of is null)
    or (operation_type='payroll_advance' and source_type='financial_payroll_advance_source' and reversal_of is null)
    or (operation_type='payroll_advance_offset' and source_type='financial_payroll_advance_offset' and reversal_of is null)
    or (operation_type='reversal' and source_type='financial_transaction' and reversal_of is not null and source_id=reversal_of)
  );

commit;
