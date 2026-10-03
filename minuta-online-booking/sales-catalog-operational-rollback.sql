-- Safe after business data exists. Preserve snapshots and conversion-aware refunds.
begin;
set local lock_timeout='10s';
set local statement_timeout='1min';
do $$ begin
  if to_regclass('public.sales_catalog_candidate_state') is null then
    raise exception using errcode='55000',message='sales_catalog_not_installed';
  end if;
end $$;
update public.sales_catalog_candidate_state set writes_enabled=false where singleton;
commit;
