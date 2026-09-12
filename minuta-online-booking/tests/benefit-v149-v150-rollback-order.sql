\set ON_ERROR_STOP on

-- The dependency order is deliberate: v150 requires v149, so it must be
-- removed first. Reapply both migrations to leave the isolated test schema at
-- the current version for any later checks in the same workflow.
\ir ../supabase-migration-v149.sql
\ir ../supabase-migration-v150.sql
\ir ../supabase-migration-v150-rollback.sql
\ir ../supabase-migration-v149-rollback.sql
\ir benefit-application-v149-rollback-check.sql

do $v149_v150_removed$
begin
  if to_regprocedure('public.set_minuta_benefit_lifecycle_v150(uuid,uuid,text,text,uuid)') is not null
     or to_regclass('public.benefit_freeze_periods') is not null
     or to_regprocedure('public.apply_minuta_benefit_v149(uuid,uuid,uuid,text,integer,uuid)') is not null
     or to_regclass('public.benefit_application_requests') is not null then
    raise exception using errcode='P0001',message='v149_v150_ordered_rollback_left_objects';
  end if;
end
$v149_v150_removed$;

\ir ../supabase-migration-v149.sql
\ir ../supabase-migration-v150.sql

do $v149_v150_reapplied$
begin
  if to_regprocedure('public.set_minuta_benefit_lifecycle_v150(uuid,uuid,text,text,uuid)') is null
     or to_regclass('public.benefit_freeze_periods') is null
     or to_regprocedure('public.apply_minuta_benefit_v149(uuid,uuid,uuid,text,integer,uuid)') is null
     or to_regclass('public.benefit_application_requests') is null then
    raise exception using errcode='P0001',message='v149_v150_ordered_reapply_missing_objects';
  end if;
end
$v149_v150_reapplied$;
