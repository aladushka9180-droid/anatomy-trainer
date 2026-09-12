begin;
set local lock_timeout='10s';
set local search_path=public,extensions,pg_catalog;

do $rollback_guard$
declare v_name text;v_proc regprocedure;v_relation regclass;v_hash text;v_marker text;
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
  if to_regprocedure('public.apply_minuta_benefit_v149(uuid,uuid,uuid,text,integer,uuid)') is null then
    if to_regprocedure('public.protect_minuta_benefit_application_v149()') is not null
       or to_regclass('public.benefit_application_requests') is not null then
      raise exception using errcode='55000',message='v149_rollback_partial_or_newer_objects_detected';
    end if;
  else
    foreach v_name in array array[
      'public.apply_minuta_benefit_v149(uuid,uuid,uuid,text,integer,uuid)',
      'public.protect_minuta_benefit_application_v149()'
    ] loop
      v_proc:=to_regprocedure(v_name);
      if v_proc is null then
        raise exception using errcode='55000',message='v149_rollback_partial_or_newer_objects_detected';
      end if;
      select public.minuta_financial_sha256_v129(jsonb_build_object(
        'source',procedure_row.prosrc,'kind',procedure_row.prokind,'language',language_row.lanname,
        'owner',pg_get_userbyid(procedure_row.proowner),
        'volatility',procedure_row.provolatile,'security_definer',procedure_row.prosecdef,
        'strict',procedure_row.proisstrict,'leakproof',procedure_row.proleakproof,'parallel',procedure_row.proparallel,
        'result',pg_get_function_result(procedure_row.oid),'arguments',pg_get_function_arguments(procedure_row.oid),
        'identity_arguments',pg_get_function_identity_arguments(procedure_row.oid),
        'config',coalesce(to_jsonb(procedure_row.proconfig),'null'::jsonb),
        'acl',coalesce((select jsonb_agg(jsonb_build_object(
          'grantor',pg_get_userbyid(grant_row.grantor),
          'grantee',case grant_row.grantee when 0 then 'PUBLIC' else pg_get_userbyid(grant_row.grantee) end,
          'privilege',grant_row.privilege_type,'grantable',grant_row.is_grantable
        ) order by pg_get_userbyid(grant_row.grantor),
          case grant_row.grantee when 0 then 'PUBLIC' else pg_get_userbyid(grant_row.grantee) end,
          grant_row.privilege_type,grant_row.is_grantable)
          from aclexplode(procedure_row.proacl) grant_row),'[]'::jsonb)
      )) into v_hash
      from pg_catalog.pg_proc procedure_row
      join pg_catalog.pg_language language_row on language_row.oid=procedure_row.prolang
      where procedure_row.oid=v_proc;
      v_marker:=obj_description(v_proc::oid,'pg_proc');
      if v_marker is distinct from 'minuta-benefit-application-v149:sha256='||v_hash then
        raise exception using errcode='55000',message='v149_rollback_newer_function_detected';
      end if;
    end loop;

    v_relation:=to_regclass('public.benefit_application_requests');
    if v_relation is null then
      raise exception using errcode='55000',message='v149_rollback_partial_or_newer_objects_detected';
    end if;
    select public.minuta_financial_sha256_v129(jsonb_build_object(
      'kind',relation_row.relkind,'owner',pg_get_userbyid(relation_row.relowner),
      'row_security',relation_row.relrowsecurity,'force_row_security',relation_row.relforcerowsecurity,
      'acl',coalesce((select jsonb_agg(jsonb_build_object(
        'grantor',pg_get_userbyid(grant_row.grantor),
        'grantee',case grant_row.grantee when 0 then 'PUBLIC' else pg_get_userbyid(grant_row.grantee) end,
        'privilege',grant_row.privilege_type,'grantable',grant_row.is_grantable
      ) order by pg_get_userbyid(grant_row.grantor),
        case grant_row.grantee when 0 then 'PUBLIC' else pg_get_userbyid(grant_row.grantee) end,
        grant_row.privilege_type,grant_row.is_grantable)
        from aclexplode(relation_row.relacl) grant_row),'[]'::jsonb),
      'columns',coalesce((select jsonb_agg(jsonb_build_object(
        'number',attribute_row.attnum,'name',attribute_row.attname,
        'type',format_type(attribute_row.atttypid,attribute_row.atttypmod),
        'not_null',attribute_row.attnotnull,'identity',attribute_row.attidentity,
        'generated',attribute_row.attgenerated,'default',pg_get_expr(default_row.adbin,default_row.adrelid)
      ) order by attribute_row.attnum)
        from pg_catalog.pg_attribute attribute_row
        left join pg_catalog.pg_attrdef default_row
          on default_row.adrelid=attribute_row.attrelid and default_row.adnum=attribute_row.attnum
        where attribute_row.attrelid=relation_row.oid and attribute_row.attnum>0 and not attribute_row.attisdropped),'[]'::jsonb),
      'constraints',coalesce((select jsonb_agg(jsonb_build_object(
        'name',constraint_row.conname,'type',constraint_row.contype,
        'definition',pg_get_constraintdef(constraint_row.oid,true),
        'validated',constraint_row.convalidated,'deferrable',constraint_row.condeferrable,
        'deferred',constraint_row.condeferred
      ) order by constraint_row.conname)
        from pg_catalog.pg_constraint constraint_row where constraint_row.conrelid=relation_row.oid),'[]'::jsonb),
      'indexes',coalesce((select jsonb_agg(pg_get_indexdef(index_row.indexrelid)
        order by index_row.indexrelid::regclass::text)
        from pg_catalog.pg_index index_row where index_row.indrelid=relation_row.oid),'[]'::jsonb),
      'policies',coalesce((select jsonb_agg(jsonb_build_object(
        'name',policy_row.polname,'command',policy_row.polcmd,'permissive',policy_row.polpermissive,
        'roles',coalesce((select jsonb_agg(pg_get_userbyid(role_oid) order by pg_get_userbyid(role_oid))
          from unnest(policy_row.polroles) role_oid),'[]'::jsonb),
        'using',pg_get_expr(policy_row.polqual,policy_row.polrelid),
        'check',pg_get_expr(policy_row.polwithcheck,policy_row.polrelid)
      ) order by policy_row.polname)
        from pg_catalog.pg_policy policy_row where policy_row.polrelid=relation_row.oid),'[]'::jsonb),
      'triggers',coalesce((select jsonb_agg(jsonb_build_object(
        'name',trigger_row.tgname,'enabled',trigger_row.tgenabled,
        'definition',pg_get_triggerdef(trigger_row.oid,true)
      ) order by trigger_row.tgname)
        from pg_catalog.pg_trigger trigger_row
        where trigger_row.tgrelid=relation_row.oid and not trigger_row.tgisinternal),'[]'::jsonb)
    )) into v_hash from pg_catalog.pg_class relation_row where relation_row.oid=v_relation;
    if obj_description(v_relation::oid,'pg_class') is distinct from
       'minuta-benefit-application-v149:sha256='||v_hash then
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
