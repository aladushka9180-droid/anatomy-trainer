begin;
set local lock_timeout='10s';

do $rollback_guard$
declare v_source text;v_function_marker text;v_table_marker text;
begin
  if to_regprocedure('public.get_minuta_benefit_timezone_v150(uuid)') is not null
     or to_regprocedure('public.minuta_benefit_frozen_days_v150(text,timestamptz,timestamptz)') is not null
     or to_regprocedure('public.sync_minuta_benefit_expiry_v150(uuid,uuid)') is not null
     or to_regprocedure('public.set_minuta_benefit_lifecycle_v150(uuid,uuid,text,text,uuid)') is not null
     or to_regprocedure('public.get_minuta_benefit_lifecycle_v150(uuid,uuid)') is not null
     or to_regclass('public.benefit_freeze_periods') is not null
     or to_regclass('public.benefit_lifecycle_requests') is not null
     or coalesce(obj_description(to_regprocedure('public.set_minuta_benefit_status(uuid,uuid,text)')::oid,'pg_proc'),'')
          ='minuta_benefit_lifecycle_compatibility_v150'
     or exists(
       select 1 from pg_catalog.pg_constraint constraint_row
       where constraint_row.conrelid=to_regclass('public.benefit_ledger')
         and constraint_row.conname='benefit_ledger_event_type_check'
         and coalesce(obj_description(constraint_row.oid,'pg_constraint'),'')='minuta_benefit_lifecycle_v150'
     ) then
    raise exception using errcode='55000',
      message='v149_rollback_blocked_v150_installed_rollback_v150_first';
  end if;
  if to_regprocedure('public.apply_minuta_benefit_v149(uuid,uuid,uuid,text,integer,uuid)') is not null then
    select routine.prosrc,obj_description(routine.oid,'pg_proc')
      into v_source,v_function_marker
      from pg_proc routine
      where routine.oid='public.apply_minuta_benefit_v149(uuid,uuid,uuid,text,integer,uuid)'::regprocedure;
    if v_function_marker is distinct from 'minuta-benefit-application-v149:'||md5(v_source) then
      raise exception using errcode='55000',message='v149_rollback_newer_function_detected';
    end if;
  end if;
  if to_regclass('public.benefit_application_requests') is not null then
    v_table_marker:=obj_description('public.benefit_application_requests'::regclass,'pg_class');
    if v_table_marker is distinct from 'minuta-benefit-application-v149' then
      raise exception using errcode='55000',message='v149_rollback_newer_table_detected';
    end if;
  end if;
  if to_regclass('public.benefit_application_requests') is not null
     and exists(select 1 from public.benefit_application_requests) then
    raise exception using errcode='55000',message='v149_rollback_blocked_by_application_history';
  end if;
end
$rollback_guard$;

drop function if exists public.apply_minuta_benefit_v149(uuid,uuid,uuid,text,integer,uuid);
do $drop_request_trigger$
begin
  if to_regclass('public.benefit_application_requests') is not null then
    execute 'drop trigger if exists benefit_application_requests_immutable_v149 on public.benefit_application_requests';
  end if;
end
$drop_request_trigger$;
drop function if exists public.protect_minuta_benefit_application_v149();
drop table if exists public.benefit_application_requests;
do $restore_legacy_acl$
begin
  if to_regprocedure('public.apply_minuta_benefit(uuid,uuid,uuid,text,integer)') is not null then
    execute 'grant execute on function public.apply_minuta_benefit(uuid,uuid,uuid,text,integer) to authenticated';
  end if;
end
$restore_legacy_acl$;

commit;
