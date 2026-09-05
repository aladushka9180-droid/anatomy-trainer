\set ON_ERROR_STOP on
-- Only run after exact URL guard, explicit per-run authorization, and a newly
-- verified, persisted encrypted test backup. No production credential is used.
begin;
select set_config('minuta.restore.confirm',:'restore_confirm',true);
do $quiesce$
declare job record;
begin
  if current_database()<>'postgres' or current_user<>'postgres' then
    raise exception 'unexpected_restore_database_or_role';
  end if;
  if current_setting('minuta.restore.confirm')<>'RESTORE_UMAZHVVXUTNSYUPHBHDA_ANONYMIZED_CRM' then
    raise exception 'test_restore_confirmation_missing';
  end if;
  if (select count(*) from minuta_migration_guard.target
      where project_ref='umazhvvxutnsyuphbhda' and allow_migrations)<>1 then
    raise exception 'wrong_test_marker';
  end if;
  if to_regclass('cron.job') is not null then
    for job in select jobid from cron.job loop perform cron.unschedule(job.jobid); end loop;
  end if;
end
$quiesce$;
create schema if not exists minuta_restore_guard;
create table if not exists minuta_restore_guard.target(
  project_ref text primary key,
  allow_destructive_restore boolean not null default false
);
insert into minuta_restore_guard.target(project_ref,allow_destructive_restore)
values('umazhvvxutnsyuphbhda',true)
on conflict(project_ref) do update set allow_destructive_restore=true;
revoke all on schema minuta_restore_guard from public,anon,authenticated,service_role;
revoke all on all tables in schema minuta_restore_guard from public,anon,authenticated,service_role;
commit;

-- No data restore until every previous cron job has exited. A failure leaves
-- test schedules safely paused; no client/data tables have been replaced.
do $idle$
begin
  -- pg_cron launcher is permanent and is not a running job. libpq jobs are
  -- client backends with pg_cron application_name, not cron backend_type.
  if exists(select 1 from pg_stat_activity
            where pid<>pg_backend_pid()
              and (backend_type ilike '%cron%' and backend_type<>'pg_cron launcher'
                   or application_name ilike 'pg_cron%'
                      and backend_type<>'pg_cron launcher')) then
    raise exception 'test_cron_worker_still_running';
  end if;
end
$idle$;
