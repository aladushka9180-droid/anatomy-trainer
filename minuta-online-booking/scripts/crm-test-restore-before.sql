\set ON_ERROR_STOP on
set local statement_timeout='10min';
set local lock_timeout='10s';
set local session_replication_role=replica;

-- Repeat the exact read-only preflight gate in this restore transaction.
-- Do not include its BEGIN/ROLLBACK wrapper, which would end our transaction.
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

do $target$
begin
  -- SET LOCAL outside a transaction only warns and would otherwise allow the
  -- following destructive statements to autocommit. This check must precede them.
  if current_database()<>'postgres' or current_user<>'postgres'
     or current_setting('session_replication_role')<>'replica' then
    raise exception 'test_restore_requires_postgres_replica_transaction';
  end if;
  if not pg_try_advisory_xact_lock(114,112) then
    raise exception 'another_test_restore_is_running';
  end if;
  if (select count(*) from minuta_restore_guard.target
      where project_ref='umazhvvxutnsyuphbhda' and allow_destructive_restore)<>1 then
    raise exception 'test_restore_marker_missing';
  end if;
  if exists(select 1 from cron.job) then raise exception 'test_cron_not_empty'; end if;
  if exists(select 1 from pg_stat_activity
            where pid<>pg_backend_pid()
              and (backend_type ilike '%cron%' and backend_type<>'pg_cron launcher'
                   or application_name ilike 'pg_cron%'
                      and backend_type<>'pg_cron launcher')) then
    raise exception 'test_cron_worker_still_running';
  end if;
  if exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
            where c.relnamespace in ('public'::regnamespace,'auth'::regnamespace)
              and not t.tgisinternal and t.tgenabled in ('A','R')) then
    raise exception 'unexpected_replica_capable_business_or_auth_trigger';
  end if;
  if exists(select 1 from net.http_request_queue) then
    raise exception 'test_net_queue_not_empty';
  end if;
  -- Test-only copies, included in the pre-operation encrypted backup. Production
  -- vault/net schemas and data are never restored into this project.
  if to_regclass('vault.secrets') is not null then delete from vault.secrets; end if;
  if to_regclass('net.http_request_queue') is not null then truncate net.http_request_queue; end if;
end
$target$;
-- Serialize placeholder insertion against real signups until commit. This does
-- not disable managed triggers globally; ordinary hooks stay suppressed locally.
lock table auth.users in share row exclusive mode;
create temporary table crm_preserved_auth_triggers on commit drop as
select t.oid,t.tgname,t.tgfoid,t.tgenabled,pg_get_triggerdef(t.oid) as definition,
       pg_get_functiondef(p.oid) as function_definition,p.proconfig,p.prosecdef,p.proowner
from pg_trigger t join pg_class c on c.oid=t.tgrelid
join pg_proc p on p.oid=t.tgfoid
where c.relnamespace='auth'::regnamespace and not t.tgisinternal;
create temporary table crm_preserved_event_triggers on commit drop as
select e.oid,e.evtname,e.evtfoid,e.evtenabled,e.evtevent,e.evttags,e.evtowner,
       pg_get_functiondef(p.oid) as definition,p.proowner
from pg_event_trigger e join pg_proc p on p.oid=e.evtfoid;
