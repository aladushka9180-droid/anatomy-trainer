begin;
set local lock_timeout='10s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $guard$
begin
  if to_regclass('public.financial_expense_metadata') is not null
     and exists(select 1 from public.financial_expense_metadata) then
    raise exception using errcode='55000',message='v163_rollback_blocked_finance_expense_data_exists';
  end if;
end
$guard$;

drop function if exists public.get_minuta_finance_expenses_v163(uuid,date,date);
drop function if exists public.reverse_minuta_expense_v163(uuid,uuid,uuid,text);
drop function if exists public.record_minuta_expense_v163(uuid,text,smallint,text,bigint,date,uuid,uuid);
drop table if exists public.financial_expense_metadata;

commit;
