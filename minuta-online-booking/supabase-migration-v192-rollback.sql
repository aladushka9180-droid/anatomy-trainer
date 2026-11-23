-- Guarded code rollback. Date schedules and request acknowledgements remain intact.
-- Requires the release owner's explicit rollback decision; never cascades or deletes rows.
begin;
set local lock_timeout='5s';
set local statement_timeout='2min';
do $rollback$
declare r record;p regprocedure;
begin
  if (select count(*) from public.provider_day_sources_v192)<>4 then raise exception 'v192_rollback_sources_missing';end if;
  for r in select * from public.provider_day_sources_v192 loop
    if md5(r.original_definition)<>r.original_md5 or md5(pg_get_functiondef(r.identity::regprocedure)) is distinct from r.installed_md5 then raise exception 'v192_rollback_source_drift';end if;
  end loop;
  for r in select * from public.provider_day_sources_v192 loop execute r.original_definition;end loop;
  for p in select f.oid::regprocedure from pg_proc f join pg_namespace n on n.oid=f.pronamespace where n.nspname='public' and f.proname in ('get_minuta_provider_day_v192','list_minuta_provider_days_v192','save_minuta_provider_day_v192','resolve_minuta_provider_day_v192','get_minuta_provider_day_slots_v192','get_minuta_day_exception_slots_v192','book_minuta_day_exception_v192','book_minuta_provider_day_v192','block_minuta_day_exception_v192')
  loop execute format('revoke all on function %s from public,anon,authenticated,service_role',p);end loop;
end $rollback$;
comment on function public.get_minuta_provider_day_v192(uuid,uuid,date) is 'primetime_provider_day_v192_rolled_back';
notify pgrst,'reload schema';
commit;
