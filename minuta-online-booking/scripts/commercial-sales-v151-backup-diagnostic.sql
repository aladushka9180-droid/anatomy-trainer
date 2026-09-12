\set ON_ERROR_STOP on

begin transaction isolation level repeatable read read only;
set local search_path=public,extensions,pg_catalog;

with critical_contract as (
  select jsonb_build_object(
    'functionSourceHashes',jsonb_build_array(
      (select public.minuta_financial_sha256_v129(jsonb_build_object('source',prosrc))
        from pg_catalog.pg_proc
        where oid=to_regprocedure('public.sell_minuta_commercial_product_v147(uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid)')),
      (select public.minuta_financial_sha256_v129(jsonb_build_object('source',prosrc))
        from pg_catalog.pg_proc
        where oid=to_regprocedure('public.get_minuta_commerce_workspace_v147(uuid)')),
      (select public.minuta_financial_sha256_v129(jsonb_build_object('source',prosrc))
        from pg_catalog.pg_proc
        where oid=to_regprocedure('public.refund_minuta_commercial_sale_v147(uuid,uuid,numeric,bigint,text,uuid)'))
    ),
    'sellerColumn',coalesce((select jsonb_build_object(
      'type',format_type(atttypid,atttypmod),'notNull',attnotnull)
      from pg_catalog.pg_attribute
      where attrelid=to_regclass('public.commercial_sales')
        and attname='seller_id' and attnum>0 and not attisdropped),'null'::jsonb),
    'quantityColumn',coalesce((select jsonb_build_object(
      'type',format_type(atttypid,atttypmod),'notNull',attnotnull)
      from pg_catalog.pg_attribute
      where attrelid=to_regclass('public.commercial_sale_lines')
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
    'index',(select pg_get_indexdef(index_row.indexrelid)
      from pg_catalog.pg_index index_row
      where index_row.indexrelid=to_regclass('public.commercial_sales_scope_v147_idx'))
  ) as value
), actual as (
  select value as contract,
    public.minuta_financial_sha256_v129(value) as ddl_fingerprint,
    (select jsonb_object_agg(component.key,
      public.minuta_financial_sha256_v129(component.value) order by component.key)
      from jsonb_each(value) component) as components
  from critical_contract
), expected as (
  select jsonb_build_object(
    'constraints','8f0766255da33610f8d75b65922ab4fb0f7aa7995a21aa97b30ccd194a08254b',
    'financialAccountsSystemKeyIndex','360befcb72432ff6290c6d0e920e852274e4a425b9c48693a4a15540f6be08e2',
    'functionSourceHashes','fedcd44c96660fb448644c7f44410983db6e9f661ac2d973b2e7d9c527920dea',
    'index','85dfd24ebdacc8818af3f84e44ed0cab27ec5c5fee6ede2cb9f34b7ef4f5a0da',
    'quantityColumn','fcc117250c7e2c2119e687a1cf8d2498b29c919083277356d2256d7bdd0412f7',
    'sellerColumn','cfe19a29ff789ecab9ef043b8f2126e5cee966bac23fc88da8a33f6b5f6b3fd8'
  ) as components
)
select jsonb_build_object(
  'schemaVersion',1,
  'status','success',
  'operation','commercial-sales-v151-backup-ddl-diagnostic',
  'catalogOnly',true,
  'tableDataRestored',false,
  'rowsRead',false,
  'aclVerifiable',false,
  'ownerVerifiable',false,
  'referenceRealTestFullFingerprint','d34367dff997d0ddbc51061f6b0b3f0a41c67f29d07bc5dd6e64ea7de08c3cee',
  'referenceIsFullFingerprint',true,
  'referenceMayBeUsedAsProductionExpected',false,
  'ddlFingerprint',actual.ddl_fingerprint,
  'ddlComponentFingerprints',actual.components,
  'referenceRealTestDdlComponentFingerprints',expected.components,
  'ddlMatchesRealTestComponents',actual.components=expected.components,
  'ddlComponentMatches',(select jsonb_object_agg(reference.key,
    actual.components->>reference.key=reference.value order by reference.key)
    from jsonb_each_text(expected.components) reference),
  'ddlContract',actual.contract
)
from actual cross join expected;

rollback;
