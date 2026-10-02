-- Remove only empty v193 functionality; never erase corrections or ledger history.
begin;
set local lock_timeout='10s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;
do $guard$
declare r record;
begin
  if to_regclass('public.financial_manual_expense_edits_v193') is not null
     and exists(select 1 from public.financial_manual_expense_edits_v193) then
    raise exception using errcode='55000',message='v193_rollback_preserve_expense_edit_history';
  end if;
  for r in select oid from pg_catalog.pg_proc where pronamespace='public'::regnamespace
    and proname in('pay_minuta_manual_expense_dated_v193','record_minuta_manual_expense_dated_v193',
      'reverse_minuta_manual_expense_transaction_dated_v193','get_minuta_manual_expense_edit_status_v193',
      'get_minuta_manual_expense_for_edit_v193','edit_minuta_manual_expense_v193') loop
    if obj_description(r.oid,'pg_proc') is distinct from 'manual_expense_edit_v193:'||
       (select md5(pg_get_functiondef(oid)||'|'||proowner::text||'|'||coalesce(proacl::text,''))
          from pg_catalog.pg_proc where oid=r.oid) then
      raise exception using errcode='55000',message='v193_rollback_preserve_changed_definition_or_acl';
    end if;
  end loop;
end
$guard$;
drop function if exists public.edit_minuta_manual_expense_v193(uuid,uuid,uuid,text,text,bigint,uuid,date,uuid,uuid);
drop function if exists public.get_minuta_manual_expense_for_edit_v193(uuid,uuid);
drop function if exists public.get_minuta_manual_expense_edit_status_v193(uuid);
drop function if exists public.record_minuta_manual_expense_dated_v193(uuid,uuid,text,text,bigint,uuid,date,uuid,uuid);
drop function if exists public.pay_minuta_manual_expense_dated_v193(uuid,uuid,uuid,uuid);
drop function if exists public.reverse_minuta_manual_expense_transaction_dated_v193(uuid,uuid,uuid,text,text,timestamptz);
drop table if exists public.financial_manual_expense_edits_v193;
notify pgrst,'reload schema';
commit;
