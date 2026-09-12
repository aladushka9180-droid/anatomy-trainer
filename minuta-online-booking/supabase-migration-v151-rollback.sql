-- Roll back only the exact stamped v151 RPCs without touching v147-v150 or business data.
begin;
set local lock_timeout='10s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $rollback_guard$
declare v_name text;v_proc regprocedure;v_hash text;v_marker text;
begin
  if to_regprocedure('public.sell_minuta_commercial_product_v151(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid)') is null
     and to_regprocedure('public.get_minuta_commerce_workspace_v151(uuid)') is null then
    return;
  end if;
  if to_regprocedure('public.sell_minuta_commercial_product_v151(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid)') is null
     or to_regprocedure('public.get_minuta_commerce_workspace_v151(uuid)') is null then
    raise exception using errcode='55000',message='v151_rollback_blocked_partial_or_newer_objects';
  end if;
  foreach v_name in array array[
    'public.sell_minuta_commercial_product_v151(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid)',
    'public.get_minuta_commerce_workspace_v151(uuid)'
  ] loop
    v_proc:=to_regprocedure(v_name);
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
    )),obj_description(procedure_row.oid,'pg_proc') into v_hash,v_marker
    from pg_catalog.pg_proc procedure_row
    join pg_catalog.pg_language language_row on language_row.oid=procedure_row.prolang
    where procedure_row.oid=v_proc;
    if v_marker is distinct from 'minuta_commercial_sales_v151:sha256='||v_hash then
      raise exception using errcode='55000',message='v151_rollback_blocked_newer_function_definition';
    end if;
  end loop;
end
$rollback_guard$;

drop function if exists public.get_minuta_commerce_workspace_v151(uuid);
drop function if exists public.sell_minuta_commercial_product_v151(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid);

commit;
