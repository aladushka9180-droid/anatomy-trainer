-- v163 rollback removes only the finance-screen projection/configuration layer.
-- Existing v129+ ledger transactions remain authoritative and untouched.
begin;
set local lock_timeout='10s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $guard$
begin
  if to_regclass('public.financial_manual_expenses_v163') is not null
     and exists(select 1 from public.financial_manual_expenses_v163) then
    raise exception using errcode='55000',
      message='v163_rollback_preserve_manual_expense_metadata_export_and_remove_first';
  end if;
  if to_regclass('public.organization_finance_category_events_v163') is not null
     and exists(select 1 from public.organization_finance_category_events_v163) then
    raise exception using errcode='55000',
      message='v163_rollback_preserve_category_audit_export_and_remove_first';
  end if;
  if to_regclass('public.organization_finance_categories_v163') is not null
     and exists(select 1 from public.organization_finance_categories_v163 where system_key is null) then
    raise exception using errcode='55000',
      message='v163_rollback_preserve_custom_categories_export_and_remove_first';
  end if;
end
$guard$;

drop trigger if exists organization_finance_categories_seed_v163
  on public.organization_finance_settings;

drop function if exists public.get_minuta_finance_screen_v163(
  uuid,date,date,uuid,integer,timestamptz,text
);
drop function if exists public.minuta_finance_event_rows_v163(
  uuid,timestamptz,timestamptz,uuid
);
drop function if exists public.reverse_minuta_manual_expense_v163(uuid,uuid,uuid,text);
drop function if exists public.record_minuta_manual_expense_v163(
  uuid,uuid,text,text,bigint,uuid,date,uuid,uuid
);
drop function if exists public.update_minuta_finance_category_v163(
  uuid,uuid,text,boolean,uuid
);
drop function if exists public.create_minuta_finance_category_v163(uuid,uuid,text);
drop function if exists public.initialize_minuta_finance_screen_v163(uuid);
drop function if exists public.ensure_minuta_finance_categories_v163();
drop function if exists public.seed_minuta_finance_categories_v163(uuid,uuid);

drop table if exists public.financial_manual_expenses_v163;
drop table if exists public.organization_finance_category_events_v163;
drop table if exists public.organization_finance_categories_v163;

drop function if exists public.protect_minuta_finance_screen_history_v163();

notify pgrst,'reload schema';
commit;
