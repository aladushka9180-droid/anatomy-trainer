-- Safe rollback for v129. Business data must be exported and removed first.
begin;
set local lock_timeout='10s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $guard$
begin
  if to_regclass('public.organization_finance_settings') is not null and exists(
      select 1 from public.organization_finance_settings where enabled
    ) then
    raise exception using errcode='55000',message='v129_rollback_disable_finance_first';
  end if;
  if (to_regclass('public.financial_transactions') is not null and exists(
      select 1 from public.financial_transactions
    )) or (to_regclass('public.financial_postings') is not null and exists(
      select 1 from public.financial_postings
    )) or (to_regclass('public.financial_accounts') is not null and exists(
      select 1 from public.financial_accounts
    )) then
    raise exception using errcode='55000',message='v129_rollback_export_and_remove_financial_data_first';
  end if;
end
$guard$;

drop policy if exists financial_postings_manager_read_v129 on public.financial_postings;
drop policy if exists financial_transactions_manager_read_v129 on public.financial_transactions;
drop policy if exists financial_accounts_manager_read_v129 on public.financial_accounts;
drop policy if exists organization_finance_settings_manager_read_v129 on public.organization_finance_settings;

drop function if exists public.get_minuta_financial_workspace_v129(uuid);
drop function if exists public.reverse_minuta_financial_transaction_v129(uuid,uuid,uuid,text);
drop function if exists public.post_minuta_visit_finance_v129(uuid,uuid,uuid,uuid);
drop function if exists public.create_minuta_financial_account_v129(uuid,uuid,text,text);
drop function if exists public.set_minuta_finance_enabled_v129(uuid,boolean);
drop function if exists public.minuta_financial_booking_source_v129(uuid,uuid);
drop function if exists public.require_minuta_financial_manager_v129(uuid);
drop function if exists public.minuta_financial_sha256_v129(jsonb);

drop trigger if exists financial_postings_balanced_v129 on public.financial_postings;
drop trigger if exists financial_transactions_balanced_v129 on public.financial_transactions;
drop trigger if exists financial_postings_immutable_v129 on public.financial_postings;
drop trigger if exists financial_transactions_immutable_v129 on public.financial_transactions;
drop function if exists public.assert_minuta_financial_postings_balanced_v129();
drop function if exists public.assert_minuta_financial_transaction_balanced_v129();
drop function if exists public.protect_minuta_financial_ledger_v129();

drop table if exists public.financial_postings;
drop table if exists public.financial_transactions;
drop table if exists public.financial_accounts;
drop table if exists public.organization_finance_settings;

commit;
