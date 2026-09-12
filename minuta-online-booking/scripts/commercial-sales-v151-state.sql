\set ON_ERROR_STOP on

begin transaction isolation level repeatable read read only;
set local search_path=public,extensions,pg_catalog;

with v151_proc as (
  select procedure_row.oid,
    obj_description(procedure_row.oid,'pg_proc') as marker,
    'minuta_commercial_sales_v151:sha256='||public.minuta_financial_sha256_v129(jsonb_build_object(
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
        from aclexplode(procedure_row.proacl) grant_row),'[]'::jsonb))) as expected
  from pg_catalog.pg_proc procedure_row
  join pg_catalog.pg_language language_row on language_row.oid=procedure_row.prolang
  where procedure_row.oid=any(array[
    to_regprocedure('public.sell_minuta_commercial_product_v151(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid)'),
    to_regprocedure('public.get_minuta_commerce_workspace_v151(uuid)')
  ])
), state as (
  select count(*) as present_count,coalesce(bool_and(marker=expected),false) as exact
  from v151_proc
)
select json_build_object(
  'classification',case
    when present_count=0 then 'absent'
    when present_count=2 and exact then 'exact'
    else 'partial-or-newer' end,
  'presentCount',present_count,
  'exact',present_count=2 and exact,
  'salePresent',to_regprocedure('public.sell_minuta_commercial_product_v151(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid)') is not null,
  'workspacePresent',to_regprocedure('public.get_minuta_commerce_workspace_v151(uuid)') is not null,
  'authenticatedSaleExecute',case when to_regprocedure('public.sell_minuta_commercial_product_v151(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid)') is null then false else has_function_privilege('authenticated',to_regprocedure('public.sell_minuta_commercial_product_v151(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid)'),'execute') end,
  'anonSaleExecute',case when to_regprocedure('public.sell_minuta_commercial_product_v151(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid)') is null then false else has_function_privilege('anon',to_regprocedure('public.sell_minuta_commercial_product_v151(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid)'),'execute') end,
  'authenticatedWorkspaceExecute',case when to_regprocedure('public.get_minuta_commerce_workspace_v151(uuid)') is null then false else has_function_privilege('authenticated',to_regprocedure('public.get_minuta_commerce_workspace_v151(uuid)'),'execute') end,
  'anonWorkspaceExecute',case when to_regprocedure('public.get_minuta_commerce_workspace_v151(uuid)') is null then false else has_function_privilege('anon',to_regprocedure('public.get_minuta_commerce_workspace_v151(uuid)'),'execute') end
) from state;

rollback;
