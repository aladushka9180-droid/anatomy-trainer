\set ON_ERROR_STOP on
begin read only;
do $guard$
declare
  expected constant text := 'umazhvvxutnsyuphbhda';
begin
  if current_database()<>'postgres' or current_user<>'postgres' then
    raise exception 'unexpected_restore_database_or_role';
  end if;
  if to_regclass('minuta_migration_guard.target') is null
     or (select count(*) from minuta_migration_guard.target where project_ref=expected and allow_migrations)<>1 then
    raise exception 'test_migration_marker_mismatch';
  end if;
  -- Observed in the authorized test project on 2026-09-05. Changed/missing/new
  -- event code is a new review gate, never accepted through a prefix match.
  if (select count(*) from pg_event_trigger)<>7 or exists (
    select 1 from pg_event_trigger e join pg_proc p on p.oid=e.evtfoid
    where not exists (
      select 1 from (values
        ('ensure_rls','99be20677b456ea8d3be47bdd44fb369','postgres'),
        ('issue_graphql_placeholder','a2bc2d00b2cc2f5e8d2d6b8d73e2c360','supabase_admin'),
        ('issue_pg_cron_access','3a3917aad6ddd66182bf45b7490c3029','supabase_admin'),
        ('issue_pg_graphql_access','dd3f3e2bb94cff45ef24b9cecb6af1c8','supabase_admin'),
        ('issue_pg_net_access','2ee4e6920eeba3068bcfa838105352e2','supabase_admin'),
        ('pgrst_ddl_watch','7f27b8118fea5c88b0164331292859e3','supabase_admin'),
        ('pgrst_drop_watch','bc09cc3003d66f91844af4cb05e203b7','supabase_admin')
      ) manifest(name,hash,owner_name)
      where manifest.name=e.evtname and manifest.hash=md5(p.prosrc)
        and manifest.owner_name=pg_get_userbyid(e.evtowner) and e.evtenabled='O'
    )
  ) then raise exception 'test_event_trigger_manifest_changed'; end if;
  if exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
            where c.relnamespace in ('public'::regnamespace,'auth'::regnamespace)
              and not t.tgisinternal and t.tgenabled in ('A','R')) then
    raise exception 'unexpected_replica_capable_business_or_auth_trigger';
  end if;
  -- An empty queue is necessary, not proof that an HTTP request already taken
  -- by the worker has finished. External senders must also be paused by release.
  if exists(select 1 from net.http_request_queue) then
    raise exception 'test_net_queue_not_empty';
  end if;
  if exists(select 1 from pg_constraint c join pg_class child on child.oid=c.conrelid
            join pg_class parent on parent.oid=c.confrelid
            where c.contype='f' and child.relnamespace<>'public'::regnamespace
              and parent.relnamespace='public'::regnamespace) then
    raise exception 'external_schema_depends_on_test_business_tables';
  end if;
end
$guard$;
rollback;
