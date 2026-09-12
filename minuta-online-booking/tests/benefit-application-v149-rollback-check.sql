\set ON_ERROR_STOP on

do $rollback_check$
begin
  if to_regprocedure('public.apply_minuta_benefit_v149(uuid,uuid,uuid,text,integer,uuid)') is not null
     or to_regclass('public.benefit_application_requests') is not null
     or to_regprocedure('public.protect_minuta_benefit_application_v149()') is not null then
    raise exception using errcode='P0001',message='v149_rollback_left_objects';
  end if;
  if not has_function_privilege('authenticated','public.apply_minuta_benefit(uuid,uuid,uuid,text,integer)','execute') then
    raise exception using errcode='P0001',message='v149_rollback_did_not_restore_legacy_acl';
  end if;
end
$rollback_check$;
