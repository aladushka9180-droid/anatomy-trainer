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
), critical_schema as (
  select
    public.minuta_financial_sha256_v129(jsonb_build_object(
      'relations',coalesce((select jsonb_agg(jsonb_build_object(
        'name',relation_row.relname,'kind',relation_row.relkind,
        'columns',coalesce((select jsonb_agg(jsonb_build_object(
          'name',attribute_row.attname,'type',format_type(attribute_row.atttypid,attribute_row.atttypmod),
          'not_null',attribute_row.attnotnull
        ) order by attribute_row.attnum)
          from pg_catalog.pg_attribute attribute_row
          where attribute_row.attrelid=relation_row.oid and attribute_row.attnum>0 and not attribute_row.attisdropped),'[]'::jsonb),
        'constraints',coalesce((select jsonb_agg(jsonb_build_object(
          'name',constraint_row.conname,'type',constraint_row.contype,
          'definition',pg_get_constraintdef(constraint_row.oid,true),'validated',constraint_row.convalidated
        ) order by constraint_row.conname)
          from pg_catalog.pg_constraint constraint_row where constraint_row.conrelid=relation_row.oid),'[]'::jsonb),
        'indexes',coalesce((select jsonb_agg(pg_get_indexdef(index_row.indexrelid)
          order by index_row.indexrelid::regclass::text)
          from pg_catalog.pg_index index_row where index_row.indrelid=relation_row.oid),'[]'::jsonb)
      ) order by relation_row.relname)
        from pg_catalog.pg_class relation_row
        join pg_catalog.pg_namespace namespace_row on namespace_row.oid=relation_row.relnamespace
        where namespace_row.nspname='public' and relation_row.relname=any(array[
          'commercial_sales','commercial_sale_lines','commercial_sale_refunds','financial_accounts','financial_transactions','financial_postings'
        ])),'[]'::jsonb)
    )) as fingerprint,
    (
      to_regclass('public.commercial_sales') is not null
      and to_regclass('public.commercial_sale_lines') is not null
      and to_regclass('public.commercial_sale_refunds') is not null
      and exists(select 1 from pg_catalog.pg_attribute where attrelid=to_regclass('public.commercial_sale_lines') and attname='quantity' and format_type(atttypid,atttypmod)='numeric(14,3)' and attnotnull)
      and exists(select 1 from pg_catalog.pg_constraint where conrelid=to_regclass('public.commercial_sales') and contype='u' and pg_get_constraintdef(oid,true)='UNIQUE (organization_id, request_id)')
      and exists(select 1 from pg_catalog.pg_constraint where conrelid=to_regclass('public.commercial_sale_lines') and contype='u' and pg_get_constraintdef(oid,true)='UNIQUE (sale_id)')
      and exists(select 1 from pg_catalog.pg_constraint where conrelid=to_regclass('public.commercial_sale_refunds') and contype='u' and pg_get_constraintdef(oid,true)='UNIQUE (organization_id, request_id)')
      and exists(select 1 from pg_catalog.pg_constraint where conrelid=to_regclass('public.financial_transactions') and contype='u' and pg_get_constraintdef(oid,true)='UNIQUE (organization_id, request_id)')
      and exists(select 1 from pg_catalog.pg_constraint where conrelid=to_regclass('public.financial_postings') and contype='u' and pg_get_constraintdef(oid,true)='UNIQUE (transaction_id, account_id, side)')
      and exists(select 1 from pg_catalog.pg_constraint where conrelid=to_regclass('public.commercial_sales') and contype='f' and pg_get_constraintdef(oid,true) like 'FOREIGN KEY (payment_account_id, organization_id) REFERENCES financial_accounts(id, organization_id)%')
      and exists(select 1 from pg_catalog.pg_constraint where conrelid=to_regclass('public.commercial_sale_lines') and contype='f' and pg_get_constraintdef(oid,true) like 'FOREIGN KEY (sale_id, organization_id) REFERENCES commercial_sales(id, organization_id)%')
      and exists(select 1 from pg_catalog.pg_constraint where conrelid=to_regclass('public.commercial_sale_refunds') and contype='f' and pg_get_constraintdef(oid,true) like 'FOREIGN KEY (sale_id, organization_id) REFERENCES commercial_sales(id, organization_id)%')
      and exists(select 1 from pg_catalog.pg_constraint where conrelid=to_regclass('public.financial_postings') and contype='f' and pg_get_constraintdef(oid,true) like 'FOREIGN KEY (transaction_id, organization_id) REFERENCES financial_transactions(id, organization_id)%')
      and exists(select 1 from pg_catalog.pg_constraint where conrelid=to_regclass('public.financial_postings') and contype='f' and pg_get_constraintdef(oid,true) like 'FOREIGN KEY (account_id, organization_id) REFERENCES financial_accounts(id, organization_id)%')
      and (select count(*)=7 and bool_and(convalidated) from pg_catalog.pg_constraint
        where conrelid=any(array[to_regclass('public.financial_accounts'),to_regclass('public.financial_transactions')])
        and conname=any(array[
        'financial_accounts_account_type_v147_check','financial_accounts_system_key_v147_check',
        'financial_accounts_system_mapping_v147_check','financial_accounts_system_request_v147_check',
        'financial_transactions_operation_v147_check','financial_transactions_source_v147_check',
        'financial_transactions_shape_v147_check'
      ]))
      and exists(select 1 from pg_catalog.pg_index index_row
        where index_row.indexrelid=to_regclass('public.commercial_sales_scope_v147_idx')
          and index_row.indrelid=to_regclass('public.commercial_sales')
          and pg_get_indexdef(index_row.indexrelid) like 'CREATE INDEX commercial_sales_scope_v147_idx ON public.commercial_sales USING btree (organization_id, occurred_at DESC, id)%')
      and exists(select 1 from pg_catalog.pg_constraint where conrelid=to_regclass('public.commercial_sales') and contype='c' and pg_get_constraintdef(oid,true) like '%total_minor = (subtotal_minor - discount_minor)%')
      and exists(select 1 from pg_catalog.pg_constraint where conrelid=to_regclass('public.commercial_sale_lines') and contype='c' and pg_get_constraintdef(oid,true) like '%item_kind = ''inventory_item''%benefit_product%')
      and exists(select 1 from pg_catalog.pg_constraint where conrelid=to_regclass('public.commercial_sale_refunds') and contype='c' and pg_get_constraintdef(oid,true) like '%amount_minor > 0%')
    ) as exact
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
  'salePresent',to_regprocedure('public.sell_minuta_commercial_product_v151(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid)') is not null,
  'workspacePresent',to_regprocedure('public.get_minuta_commerce_workspace_v151(uuid)') is not null,
  'authenticatedSaleExecute',case when to_regprocedure('public.sell_minuta_commercial_product_v151(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid)') is null then false else has_function_privilege('authenticated',to_regprocedure('public.sell_minuta_commercial_product_v151(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid)'),'execute') end,
  'anonSaleExecute',case when to_regprocedure('public.sell_minuta_commercial_product_v151(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid)') is null then false else has_function_privilege('anon',to_regprocedure('public.sell_minuta_commercial_product_v151(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid)'),'execute') end,
  'authenticatedWorkspaceExecute',case when to_regprocedure('public.get_minuta_commerce_workspace_v151(uuid)') is null then false else has_function_privilege('authenticated',to_regprocedure('public.get_minuta_commerce_workspace_v151(uuid)'),'execute') end,
  'anonWorkspaceExecute',case when to_regprocedure('public.get_minuta_commerce_workspace_v151(uuid)') is null then false else has_function_privilege('anon',to_regprocedure('public.get_minuta_commerce_workspace_v151(uuid)'),'execute') end
) from state cross join critical_schema;

rollback;
