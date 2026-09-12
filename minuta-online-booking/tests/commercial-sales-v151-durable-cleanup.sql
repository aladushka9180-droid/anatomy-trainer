\set ON_ERROR_STOP on

select set_config('minuta.v151_test_run_key',:'run_key',false);

do $cleanup$
declare
  v_run text:=current_setting('minuta.v151_test_run_key');
  v_org uuid;
  v_owner uuid;
  v_seller uuid;
  v_client uuid;
  v_service uuid;
  target record;
begin
  perform pg_terminate_backend(activity.pid)
    from pg_catalog.pg_stat_activity activity
    where activity.pid<>pg_backend_pid()
      and activity.application_name in('v151-'||v_run||'-a','v151-'||v_run||'-b');
  if to_regclass('minuta_v151_test.fixture') is null then return; end if;
  select organization_id,owner_id,seller_id,client_id,service_id into v_org,v_owner,v_seller,v_client,v_service
    from minuta_v151_test.fixture where run_key=v_run;
  if v_org is null then return; end if;
  set local session_replication_role=replica;
  for target in
    select format('%I.%I',namespace_row.nspname,class_row.relname) as relation_name
    from pg_catalog.pg_class class_row
    join pg_catalog.pg_namespace namespace_row on namespace_row.oid=class_row.relnamespace
    join pg_catalog.pg_attribute attribute_row on attribute_row.attrelid=class_row.oid
    where namespace_row.nspname='public' and class_row.relkind in('r','p')
      and attribute_row.attname='organization_id' and not attribute_row.attisdropped
    order by class_row.relkind,namespace_row.nspname,class_row.relname
  loop
    execute format('delete from %s where organization_id=$1',target.relation_name) using v_org;
  end loop;
  delete from public.services where id=v_service;
  delete from public.client_accounts where id=v_client;
  delete from public.performer_profiles where id in(v_owner,v_seller);
  delete from public.organizations where id=v_org;
  delete from auth.users where id in(v_owner,v_seller);
  set local session_replication_role=origin;
end
$cleanup$;

drop schema if exists minuta_v151_test cascade;
