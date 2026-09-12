\set ON_ERROR_STOP on

select set_config('minuta.v151_test_run_key',:'run_key',false);

do $cleanup$
declare
  v_run text:=current_setting('minuta.v151_test_run_key');
  fixture_row record;
  target record;
begin
  perform pg_terminate_backend(activity.pid)
    from pg_catalog.pg_stat_activity activity
    where activity.pid<>pg_backend_pid()
      and activity.application_name in('v151-'||v_run||'-a','v151-'||v_run||'-b');
  if to_regclass('minuta_v151_test.fixture') is null then return; end if;
  set local session_replication_role=replica;
  for fixture_row in select * from minuta_v151_test.fixture order by run_key
  loop
    perform pg_terminate_backend(activity.pid)
      from pg_catalog.pg_stat_activity activity
      where activity.pid<>pg_backend_pid()
        and activity.application_name in(
          'v151-'||fixture_row.run_key||'-a','v151-'||fixture_row.run_key||'-b'
        );
    for target in
      select format('%I.%I',namespace_row.nspname,class_row.relname) as relation_name
      from pg_catalog.pg_class class_row
      join pg_catalog.pg_namespace namespace_row on namespace_row.oid=class_row.relnamespace
      join pg_catalog.pg_attribute attribute_row on attribute_row.attrelid=class_row.oid
      where namespace_row.nspname='public' and class_row.relkind in('r','p')
        and attribute_row.attname='organization_id' and not attribute_row.attisdropped
      order by class_row.relkind,namespace_row.nspname,class_row.relname
    loop
      execute format('delete from %s where organization_id=$1',target.relation_name)
        using fixture_row.organization_id;
    end loop;
    delete from public.services where id=fixture_row.service_id;
    delete from public.client_accounts where id=fixture_row.client_id;
    delete from public.performer_profiles where id in(fixture_row.owner_id,fixture_row.seller_id);
    delete from public.organizations where id=fixture_row.organization_id;
    delete from auth.users where id in(fixture_row.owner_id,fixture_row.seller_id);
  end loop;
  set local session_replication_role=origin;
end
$cleanup$;

drop schema if exists minuta_v151_test cascade;
