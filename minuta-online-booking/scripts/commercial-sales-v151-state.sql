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
), critical_contract as (
  select jsonb_build_object(
    'functionSourceHashes',jsonb_build_array(
      (select public.minuta_financial_sha256_v129(jsonb_build_object('source',prosrc)) from pg_catalog.pg_proc where oid=to_regprocedure('public.sell_minuta_commercial_product_v147(uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid)')),
      (select public.minuta_financial_sha256_v129(jsonb_build_object('source',prosrc)) from pg_catalog.pg_proc where oid=to_regprocedure('public.get_minuta_commerce_workspace_v147(uuid)')),
      (select public.minuta_financial_sha256_v129(jsonb_build_object('source',prosrc)) from pg_catalog.pg_proc where oid=to_regprocedure('public.refund_minuta_commercial_sale_v147(uuid,uuid,numeric,bigint,text,uuid)'))
    ),
    'runtimeFunctions',coalesce((select jsonb_agg(jsonb_build_object(
      'signature',expected.signature,
      'sourceHash',public.minuta_financial_sha256_v129(jsonb_build_object('source',procedure_row.prosrc)),
      'owner',pg_get_userbyid(procedure_row.proowner),
      'ownerMatchesDomainTable',procedure_row.proowner=(select relation_row.relowner from pg_catalog.pg_class relation_row
        where relation_row.oid=to_regclass(expected.domain_relation)),
      'language',language_row.lanname,'kind',procedure_row.prokind,'volatility',procedure_row.provolatile,
      'securityDefiner',procedure_row.prosecdef,'strict',procedure_row.proisstrict,
      'leakproof',procedure_row.proleakproof,'parallel',procedure_row.proparallel,
      'result',pg_get_function_result(procedure_row.oid),
      'identityArguments',pg_get_function_identity_arguments(procedure_row.oid),
      'config',coalesce(to_jsonb(procedure_row.proconfig),'null'::jsonb),
      'authenticatedExecute',coalesce(has_function_privilege('authenticated',procedure_row.oid,'execute'),false),
      'anonExecute',coalesce(has_function_privilege('anon',procedure_row.oid,'execute'),false),
      'serviceRoleExecute',coalesce(has_function_privilege('service_role',procedure_row.oid,'execute'),false),
      'publicExecute',exists(select 1 from aclexplode(coalesce(procedure_row.proacl,acldefault('f',procedure_row.proowner))) grant_row
        where grant_row.grantee=0 and grant_row.privilege_type='EXECUTE'),
      'acl',coalesce((select jsonb_agg(jsonb_build_object(
        'grantor',pg_get_userbyid(grant_row.grantor),
        'grantee',case when grant_row.grantee=0 then 'PUBLIC'
          when grant_row.grantee=procedure_row.proowner then 'owner'
          else coalesce(role_row.rolname,'oid:'||grant_row.grantee::text) end,
        'privilege',grant_row.privilege_type,'grantable',grant_row.is_grantable
      ) order by pg_get_userbyid(grant_row.grantor),
        case when grant_row.grantee=0 then 'PUBLIC'
          when grant_row.grantee=procedure_row.proowner then 'owner'
          else coalesce(role_row.rolname,'oid:'||grant_row.grantee::text) end,
        grant_row.privilege_type,grant_row.is_grantable)
        from aclexplode(coalesce(procedure_row.proacl,acldefault('f',procedure_row.proowner))) grant_row
        left join pg_catalog.pg_roles role_row on role_row.oid=grant_row.grantee),'[]'::jsonb)
    ) order by expected.signature)
      from (values
        ('public.apply_minuta_stock_movement(uuid,uuid,uuid,text,numeric,numeric,text,uuid)','public.inventory_movements'),
        ('public.issue_minuta_benefit(uuid,uuid,uuid,date,uuid)','public.client_benefit_instruments')
      ) expected(signature,domain_relation)
      left join pg_catalog.pg_proc procedure_row on procedure_row.oid=to_regprocedure(expected.signature)
      left join pg_catalog.pg_language language_row on language_row.oid=procedure_row.prolang
    ),'[]'::jsonb),
    'sellerColumn',coalesce((select jsonb_build_object(
      'type',format_type(atttypid,atttypmod),'notNull',attnotnull)
      from pg_catalog.pg_attribute where attrelid=to_regclass('public.commercial_sales')
        and attname='seller_id' and attnum>0 and not attisdropped),'null'::jsonb),
    'quantityColumn',coalesce((select jsonb_build_object(
      'type',format_type(atttypid,atttypmod),'notNull',attnotnull)
      from pg_catalog.pg_attribute where attrelid=to_regclass('public.commercial_sale_lines')
        and attname='quantity' and attnum>0 and not attisdropped),'null'::jsonb),
    'constraints',coalesce((select jsonb_agg(jsonb_build_object(
      'table',relation_row.relname,'name',constraint_row.conname,
      'definition',pg_get_constraintdef(constraint_row.oid,true),'validated',constraint_row.convalidated
    ) order by relation_row.relname,constraint_row.conname)
      from pg_catalog.pg_constraint constraint_row
      join pg_catalog.pg_class relation_row on relation_row.oid=constraint_row.conrelid
      join pg_catalog.pg_namespace namespace_row on namespace_row.oid=relation_row.relnamespace
      where namespace_row.nspname='public' and (
        relation_row.relname=any(array['commercial_sales','commercial_sale_lines','commercial_sale_refunds','financial_postings'])
        or (relation_row.relname=any(array['financial_accounts','financial_transactions']) and constraint_row.conname like '%v147_check')
        or (relation_row.relname='financial_accounts' and constraint_row.conname='financial_accounts_organization_id_system_key_key')
        or (relation_row.relname='financial_transactions' and constraint_row.conname='financial_transactions_organization_id_request_id_key')
      )),'[]'::jsonb),
    'financialAccountsSystemKeyIndex',coalesce((select jsonb_build_object(
      'definition',pg_get_indexdef(index_row.indexrelid),'unique',index_row.indisunique,
      'valid',index_row.indisvalid,'ready',index_row.indisready
    ) from pg_catalog.pg_constraint constraint_row
      join pg_catalog.pg_index index_row on index_row.indexrelid=constraint_row.conindid
      where constraint_row.conrelid=to_regclass('public.financial_accounts')
        and constraint_row.conname='financial_accounts_organization_id_system_key_key'),'null'::jsonb),
    'index',(select pg_get_indexdef(index_row.indexrelid) from pg_catalog.pg_index index_row
      where index_row.indexrelid=to_regclass('public.commercial_sales_scope_v147_idx'))
  ) as value
), critical_schema as (
  select
    public.minuta_financial_sha256_v129(value) as fingerprint,
    'b85982e038537907ecb9137389b27da5ebca754c537f6c06c095ab1aa6cf84a6'::text as expected_fingerprint,
    public.minuta_financial_sha256_v129(value)='b85982e038537907ecb9137389b27da5ebca754c537f6c06c095ab1aa6cf84a6' as exact
  from critical_contract
)
select json_build_object(
  'classification',case
    when present_count=0 then 'absent'
    when present_count=2 and state.exact then 'exact'
    else 'partial-or-newer' end,
  'presentCount',present_count,
  'exact',present_count=2 and state.exact,
  'criticalSchemaExact',critical_schema.exact,
  'criticalSchemaFingerprint',critical_schema.fingerprint,
  'criticalSchemaExpectedFingerprint',critical_schema.expected_fingerprint,
  'salePresent',to_regprocedure('public.sell_minuta_commercial_product_v151(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid)') is not null,
  'workspacePresent',to_regprocedure('public.get_minuta_commerce_workspace_v151(uuid)') is not null,
  'authenticatedSaleExecute',case when to_regprocedure('public.sell_minuta_commercial_product_v151(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid)') is null then false else has_function_privilege('authenticated',to_regprocedure('public.sell_minuta_commercial_product_v151(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid)'),'execute') end,
  'anonSaleExecute',case when to_regprocedure('public.sell_minuta_commercial_product_v151(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid)') is null then false else has_function_privilege('anon',to_regprocedure('public.sell_minuta_commercial_product_v151(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid)'),'execute') end,
  'authenticatedWorkspaceExecute',case when to_regprocedure('public.get_minuta_commerce_workspace_v151(uuid)') is null then false else has_function_privilege('authenticated',to_regprocedure('public.get_minuta_commerce_workspace_v151(uuid)'),'execute') end,
  'anonWorkspaceExecute',case when to_regprocedure('public.get_minuta_commerce_workspace_v151(uuid)') is null then false else has_function_privilege('anon',to_regprocedure('public.get_minuta_commerce_workspace_v151(uuid)'),'execute') end
) from state cross join critical_schema;

rollback;
