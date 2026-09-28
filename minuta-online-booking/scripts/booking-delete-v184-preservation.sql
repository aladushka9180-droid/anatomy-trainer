-- Temporary, transaction-local checks. No row contents or fingerprints are emitted.
-- Lock writers on the exact data whose preservation is verified; concurrent reads
-- remain possible until the migration takes its normal ALTER TABLE locks.
do $lock$
declare item record;
begin
  for item in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in('r','p') and (
      c.relname in('bookings','booking_reviews','payments','payment_events','booking_events',
        'client_identity_sessions_v155','organization_memberships')
      or c.relname like 'message\_%\_v162' escape '\'
      or c.relname like 'conversation\_%\_v162' escape '\') order by c.relname
  loop execute format('lock table public.%I in share mode',item.relname); end loop;
end
$lock$;
create temporary table v184_preservation_before(value jsonb) on commit drop;
create or replace function pg_temp.v184_preservation_snapshot()
returns jsonb language plpgsql set search_path='' as $snapshot$
declare item record; row_count bigint; digest text; rows_snapshot jsonb:='{}'; security_snapshot jsonb;
begin
  for item in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in('r','p') and (
      c.relname in('bookings','booking_reviews','payments','payment_events','booking_events',
        'client_identity_sessions_v155','organization_memberships')
      or c.relname like 'message\_%\_v162' escape '\'
      or c.relname like 'conversation\_%\_v162' escape '\') order by c.relname
  loop
    -- Only ignore the newly added field while it is NULL. A non-null archived
    -- reference is part of the preserved row, including during rollback/reapply.
    execute format($sql$select count(*),md5(coalesce(string_agg(md5(value::text),'' order by md5(value::text)),''))
      from (select case when to_jsonb(t)->'deleted_booking_id'='null'::jsonb
        then to_jsonb(t)-'deleted_booking_id' else to_jsonb(t) end value from public.%I t) rows$sql$,item.relname)
      into row_count,digest;
    rows_snapshot:=rows_snapshot||jsonb_build_object(item.relname,jsonb_build_object('rows',row_count,'digest',digest));
  end loop;
  select jsonb_build_object(
    'tables',(select jsonb_agg(jsonb_build_array(c.relname,c.relowner,c.relacl::text,c.relrowsecurity,c.relforcerowsecurity) order by c.relname)
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in('r','p')),
    'functions',(select jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,p.proowner,p.proacl::text,p.prosecdef,p.proconfig::text,
      case when p.oid='public.provider_delete_booking(uuid)'::regprocedure then null else md5(pg_get_functiondef(p.oid)) end)
      order by p.oid::regprocedure::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.prokind in('f','p')),
    'policies',(select jsonb_agg(jsonb_build_array(c.relname,p.polname,p.polcmd,p.polpermissive,p.polroles::text,
      pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) order by c.relname,p.polname)
      from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'),
    'foreignKeys',(select jsonb_agg(jsonb_build_array(c.conrelid::regclass::text,c.conname,pg_get_constraintdef(c.oid))
      order by c.conrelid::regclass::text,c.conname) from pg_constraint c join pg_namespace n on n.oid=c.connamespace
      where n.nspname='public' and c.contype='f'),
    'triggers',(select jsonb_agg(jsonb_build_array(c.relname,t.tgname,pg_get_triggerdef(t.oid),t.tgenabled)
      order by c.relname,t.tgname) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and not t.tgisinternal)
  ) into security_snapshot;
  return jsonb_build_object('rows',rows_snapshot,'security',security_snapshot);
end
$snapshot$;
insert into pg_temp.v184_preservation_before select pg_temp.v184_preservation_snapshot();
