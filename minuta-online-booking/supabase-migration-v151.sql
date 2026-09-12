-- v151: selectable seller for atomic commercial sales.
-- Safe to reapply only while the exact stamped v151 functions are installed.
begin;
set local lock_timeout='10s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $dependency_guard$
declare
  v_name text;
  v_proc regprocedure;
  v_relation regclass;
  v_hash text;
  v_prefix text;
  v_definition text;
  v_source_hash text;
begin
  if to_regclass('public.commercial_sales') is null
     or to_regclass('public.commercial_sale_lines') is null
     or to_regclass('public.commercial_sale_refunds') is null
     or to_regclass('public.financial_accounts') is null
     or to_regclass('public.financial_transactions') is null
     or to_regclass('public.financial_postings') is null
     or to_regclass('public.organization_memberships') is null
     or to_regclass('public.performer_profiles') is null
     or to_regclass('public.client_benefit_instruments') is null
     or to_regclass('public.benefit_ledger') is null
     or to_regclass('public.locations') is null
     or to_regprocedure('public.minuta_financial_sha256_v129(jsonb)') is null
     or to_regprocedure('public.apply_minuta_benefit(uuid,uuid,uuid,text,integer)') is null
     or to_regprocedure('public.sell_minuta_commercial_product_v147(uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid)') is null
     or to_regprocedure('public.get_minuta_commerce_workspace_v147(uuid)') is null
     or to_regprocedure('public.refund_minuta_commercial_sale_v147(uuid,uuid,numeric,bigint,text,uuid)') is null
     or obj_description(to_regprocedure('public.refund_minuta_commercial_sale_v147(uuid,uuid,numeric,bigint,text,uuid)')::oid,'pg_proc')
          is distinct from 'minuta_refund_safety_v148_proportional_rounding'
     or position('commercial_refund_amount_mismatch' in pg_get_functiondef(
          to_regprocedure('public.refund_minuta_commercial_sale_v147(uuid,uuid,numeric,bigint,text,uuid)'))) = 0
     or to_regprocedure('public.apply_minuta_benefit_v149(uuid,uuid,uuid,text,integer,uuid)') is null
     or to_regprocedure('public.protect_minuta_benefit_application_v149()') is null
     or to_regclass('public.benefit_application_requests') is null
     or to_regprocedure('public.set_minuta_benefit_lifecycle_v150(uuid,uuid,text,text,uuid)') is null
     or to_regprocedure('public.get_minuta_benefit_lifecycle_v150(uuid,uuid)') is null
     or to_regclass('public.benefit_freeze_periods') is null
     or to_regclass('public.benefit_lifecycle_requests') is null then
    raise exception using errcode='55000',message='v151_requires_exact_v147_v148_v149_v150';
  end if;

  select public.minuta_financial_sha256_v129(jsonb_build_object('source',prosrc)) into v_source_hash
    from pg_catalog.pg_proc where oid='public.sell_minuta_commercial_product_v147(uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid)'::regprocedure;
  if v_source_hash is distinct from '220d2742a22230219b41d9dda29bc4649d0bb0f4b62fe8935ce4d42f86aff577' then
    raise exception using errcode='55000',message='v151_requires_exact_v147_v148_v149_v150';
  end if;
  select public.minuta_financial_sha256_v129(jsonb_build_object('source',prosrc)) into v_source_hash
    from pg_catalog.pg_proc where oid='public.get_minuta_commerce_workspace_v147(uuid)'::regprocedure;
  if v_source_hash is distinct from 'da68cd045c6333e866c467ccdf3060a2a4c94d1547c2500c17cf475b35f292b1' then
    raise exception using errcode='55000',message='v151_requires_exact_v147_v148_v149_v150';
  end if;

  if exists(
    select 1 from (values
      ('public.financial_accounts'::regclass,'financial_accounts_account_type_v147_check',$constraint$CHECK (account_type = ANY (ARRAY['cash'::text, 'bank'::text, 'receivable'::text, 'service_revenue'::text, 'product_revenue'::text, 'operating_expense'::text, 'supplier_payable'::text, 'payment_channel_commission'::text, 'payroll_expense'::text, 'payroll_payable'::text, 'employee_advance'::text]))$constraint$),
      ('public.financial_accounts'::regclass,'financial_accounts_system_key_v147_check',$constraint$CHECK (system_key IS NULL OR (system_key = ANY (ARRAY['receivable'::text, 'service_revenue'::text, 'product_revenue'::text, 'operating_expense'::text, 'supplier_payable'::text, 'payment_channel_commission'::text, 'payroll_expense'::text, 'payroll_payable'::text, 'employee_advance'::text])))$constraint$),
      ('public.financial_accounts'::regclass,'financial_accounts_system_mapping_v147_check',$constraint$CHECK (system_key IS NULL AND (account_type = ANY (ARRAY['cash'::text, 'bank'::text])) AND account_class = 'asset'::text OR system_key = 'receivable'::text AND account_type = 'receivable'::text AND account_class = 'asset'::text OR system_key = 'service_revenue'::text AND account_type = 'service_revenue'::text AND account_class = 'income'::text OR system_key = 'product_revenue'::text AND account_type = 'product_revenue'::text AND account_class = 'income'::text OR system_key = 'operating_expense'::text AND account_type = 'operating_expense'::text AND account_class = 'expense'::text OR system_key = 'supplier_payable'::text AND account_type = 'supplier_payable'::text AND account_class = 'liability'::text OR system_key = 'payment_channel_commission'::text AND account_type = 'payment_channel_commission'::text AND account_class = 'expense'::text OR system_key = 'payroll_expense'::text AND account_type = 'payroll_expense'::text AND account_class = 'expense'::text OR system_key = 'payroll_payable'::text AND account_type = 'payroll_payable'::text AND account_class = 'liability'::text OR system_key = 'employee_advance'::text AND account_type = 'employee_advance'::text AND account_class = 'asset'::text)$constraint$),
      ('public.financial_accounts'::regclass,'financial_accounts_system_request_v147_check',$constraint$CHECK ((system_key IS NULL) = (creation_request_id IS NOT NULL))$constraint$),
      ('public.financial_transactions'::regclass,'financial_transactions_operation_v147_check',$constraint$CHECK (operation_type = ANY (ARRAY['visit_service'::text, 'commercial_sale'::text, 'commercial_refund'::text, 'supplier_expense_accrual'::text, 'supplier_expense_payment'::text, 'customer_debt_settlement'::text, 'payroll_accrual'::text, 'payroll_payment'::text, 'payroll_advance'::text, 'payroll_advance_offset'::text, 'reversal'::text]))$constraint$),
      ('public.financial_transactions'::regclass,'financial_transactions_source_v147_check',$constraint$CHECK (source_type = ANY (ARRAY['booking_outcome'::text, 'commercial_sale'::text, 'commercial_sale_refund'::text, 'financial_expense_source'::text, 'financial_debt_settlement_source'::text, 'financial_payroll_accrual_source'::text, 'financial_payroll_payment_source'::text, 'financial_payroll_advance_source'::text, 'financial_payroll_advance_offset'::text, 'financial_transaction'::text]))$constraint$),
      ('public.financial_transactions'::regclass,'financial_transactions_shape_v147_check',$constraint$CHECK (operation_type = 'visit_service'::text AND source_type = 'booking_outcome'::text AND reversal_of IS NULL OR operation_type = 'commercial_sale'::text AND source_type = 'commercial_sale'::text AND reversal_of IS NULL OR operation_type = 'commercial_refund'::text AND source_type = 'commercial_sale_refund'::text AND reversal_of IS NULL OR (operation_type = ANY (ARRAY['supplier_expense_accrual'::text, 'supplier_expense_payment'::text])) AND source_type = 'financial_expense_source'::text AND reversal_of IS NULL OR operation_type = 'customer_debt_settlement'::text AND source_type = 'financial_debt_settlement_source'::text AND reversal_of IS NULL OR operation_type = 'payroll_accrual'::text AND source_type = 'financial_payroll_accrual_source'::text AND reversal_of IS NULL OR operation_type = 'payroll_payment'::text AND source_type = 'financial_payroll_payment_source'::text AND reversal_of IS NULL OR operation_type = 'payroll_advance'::text AND source_type = 'financial_payroll_advance_source'::text AND reversal_of IS NULL OR operation_type = 'payroll_advance_offset'::text AND source_type = 'financial_payroll_advance_offset'::text AND reversal_of IS NULL OR operation_type = 'reversal'::text AND source_type = 'financial_transaction'::text AND reversal_of IS NOT NULL AND source_id = reversal_of)$constraint$)
    ) expected(relation_id,constraint_name,definition)
    left join pg_catalog.pg_constraint actual
      on actual.conrelid=expected.relation_id and actual.conname=expected.constraint_name
    where actual.oid is null or not actual.convalidated
      or pg_get_constraintdef(actual.oid,true) is distinct from expected.definition
  ) then
    raise exception using errcode='55000',message='v151_requires_exact_v147_v148_v149_v150';
  end if;

  if not exists(select 1 from pg_catalog.pg_attribute
       where attrelid='public.commercial_sales'::regclass and attname='seller_id'
         and format_type(atttypid,atttypmod)='uuid' and not attnotnull and not attisdropped)
     or exists(
       select 1 from (values
        ('public.commercial_sales'::regclass,'commercial_sales_organization_id_request_id_key',$constraint$UNIQUE (organization_id, request_id)$constraint$),
        ('public.commercial_sales'::regclass,'commercial_sales_payment_account_id_organization_id_fkey',$constraint$FOREIGN KEY (payment_account_id, organization_id) REFERENCES financial_accounts(id, organization_id) ON DELETE RESTRICT$constraint$),
        ('public.commercial_sales'::regclass,'commercial_sales_seller_id_fkey',$constraint$FOREIGN KEY (seller_id) REFERENCES auth.users(id) ON DELETE SET NULL$constraint$),
        ('public.commercial_sales'::regclass,'commercial_sales_check1',$constraint$CHECK (total_minor = (subtotal_minor - discount_minor) AND total_minor > 0)$constraint$),
        ('public.commercial_sales'::regclass,'commercial_sales_check2',$constraint$CHECK (refunded_minor >= 0 AND refunded_minor <= total_minor)$constraint$),
        ('public.commercial_sales'::regclass,'commercial_sales_request_fingerprint_check',$constraint$CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'::text)$constraint$),
        ('public.commercial_sales'::regclass,'commercial_sales_status_check',$constraint$CHECK (status = ANY (ARRAY['paid'::text, 'partially_refunded'::text, 'refunded'::text]))$constraint$),
        ('public.commercial_sales'::regclass,'commercial_sales_payment_method_check',$constraint$CHECK (payment_method = ANY (ARRAY['cash'::text, 'manual'::text]))$constraint$),
        ('public.commercial_sale_lines'::regclass,'commercial_sale_lines_sale_id_key',$constraint$UNIQUE (sale_id)$constraint$),
        ('public.commercial_sale_lines'::regclass,'commercial_sale_lines_sale_id_organization_id_fkey',$constraint$FOREIGN KEY (sale_id, organization_id) REFERENCES commercial_sales(id, organization_id) ON DELETE RESTRICT$constraint$),
        ('public.commercial_sale_lines'::regclass,'commercial_sale_lines_quantity_check',$constraint$CHECK (quantity > 0::numeric)$constraint$),
        ('public.commercial_sale_lines'::regclass,'commercial_sale_lines_check',$constraint$CHECK (refunded_quantity >= 0::numeric AND refunded_quantity <= quantity)$constraint$),
        ('public.commercial_sale_lines'::regclass,'commercial_sale_lines_check2',$constraint$CHECK (total_minor = (subtotal_minor - discount_minor) AND total_minor > 0)$constraint$),
        ('public.commercial_sale_lines'::regclass,'commercial_sale_lines_check3',$constraint$CHECK (item_kind = 'inventory_item'::text AND inventory_item_id IS NOT NULL AND benefit_product_id IS NULL AND warehouse_id IS NOT NULL AND benefit_instrument_id IS NULL AND inventory_movement_id IS NOT NULL OR item_kind = 'benefit_product'::text AND inventory_item_id IS NULL AND benefit_product_id IS NOT NULL AND warehouse_id IS NULL AND benefit_instrument_id IS NOT NULL AND inventory_movement_id IS NULL)$constraint$),
        ('public.commercial_sale_refunds'::regclass,'commercial_sale_refunds_organization_id_request_id_key',$constraint$UNIQUE (organization_id, request_id)$constraint$),
        ('public.commercial_sale_refunds'::regclass,'commercial_sale_refunds_sale_id_organization_id_fkey',$constraint$FOREIGN KEY (sale_id, organization_id) REFERENCES commercial_sales(id, organization_id) ON DELETE RESTRICT$constraint$),
        ('public.commercial_sale_refunds'::regclass,'commercial_sale_refunds_amount_minor_check',$constraint$CHECK (amount_minor > 0)$constraint$),
        ('public.commercial_sale_refunds'::regclass,'commercial_sale_refunds_quantity_check',$constraint$CHECK (quantity > 0::numeric)$constraint$),
        ('public.commercial_sale_refunds'::regclass,'commercial_sale_refunds_request_fingerprint_check',$constraint$CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'::text)$constraint$),
        ('public.financial_transactions'::regclass,'financial_transactions_organization_id_request_id_key',$constraint$UNIQUE (organization_id, request_id)$constraint$),
        ('public.financial_postings'::regclass,'financial_postings_transaction_id_account_id_side_key',$constraint$UNIQUE (transaction_id, account_id, side)$constraint$),
        ('public.financial_postings'::regclass,'financial_postings_transaction_id_organization_id_fkey',$constraint$FOREIGN KEY (transaction_id, organization_id) REFERENCES financial_transactions(id, organization_id) ON DELETE RESTRICT$constraint$),
        ('public.financial_postings'::regclass,'financial_postings_account_id_organization_id_fkey',$constraint$FOREIGN KEY (account_id, organization_id) REFERENCES financial_accounts(id, organization_id) ON DELETE RESTRICT$constraint$)
       ) expected(relation_id,constraint_name,definition)
       left join pg_catalog.pg_constraint actual
         on actual.conrelid=expected.relation_id and actual.conname=expected.constraint_name
       where actual.oid is null or not actual.convalidated
         or pg_get_constraintdef(actual.oid,true) is distinct from expected.definition
     ) then
    raise exception using errcode='55000',message='v151_requires_exact_v147_v148_v149_v150';
  end if;

  if not exists(select 1 from pg_catalog.pg_attribute where attrelid='public.commercial_sale_lines'::regclass and attname='quantity' and format_type(atttypid,atttypmod)='numeric(14,3)' and attnotnull)
     or not exists(select 1 from pg_catalog.pg_constraint where conrelid='public.commercial_sales'::regclass and contype='u' and pg_get_constraintdef(oid,true)='UNIQUE (organization_id, request_id)')
     or not exists(select 1 from pg_catalog.pg_constraint where conrelid='public.commercial_sale_lines'::regclass and contype='u' and pg_get_constraintdef(oid,true)='UNIQUE (sale_id)')
     or not exists(select 1 from pg_catalog.pg_constraint where conrelid='public.commercial_sale_refunds'::regclass and contype='u' and pg_get_constraintdef(oid,true)='UNIQUE (organization_id, request_id)')
     or not exists(select 1 from pg_catalog.pg_constraint where conrelid='public.financial_transactions'::regclass and contype='u' and pg_get_constraintdef(oid,true)='UNIQUE (organization_id, request_id)')
     or not exists(select 1 from pg_catalog.pg_constraint where conrelid='public.financial_postings'::regclass and contype='u' and pg_get_constraintdef(oid,true)='UNIQUE (transaction_id, account_id, side)')
     or not exists(select 1 from pg_catalog.pg_constraint where conrelid='public.commercial_sales'::regclass and contype='f' and pg_get_constraintdef(oid,true) like 'FOREIGN KEY (payment_account_id, organization_id) REFERENCES financial_accounts(id, organization_id)%')
     or not exists(select 1 from pg_catalog.pg_constraint where conrelid='public.commercial_sale_lines'::regclass and contype='f' and pg_get_constraintdef(oid,true) like 'FOREIGN KEY (sale_id, organization_id) REFERENCES commercial_sales(id, organization_id)%')
     or not exists(select 1 from pg_catalog.pg_constraint where conrelid='public.commercial_sale_refunds'::regclass and contype='f' and pg_get_constraintdef(oid,true) like 'FOREIGN KEY (sale_id, organization_id) REFERENCES commercial_sales(id, organization_id)%')
     or not exists(select 1 from pg_catalog.pg_constraint where conrelid='public.financial_postings'::regclass and contype='f' and pg_get_constraintdef(oid,true) like 'FOREIGN KEY (transaction_id, organization_id) REFERENCES financial_transactions(id, organization_id)%')
     or not exists(select 1 from pg_catalog.pg_constraint where conrelid='public.financial_postings'::regclass and contype='f' and pg_get_constraintdef(oid,true) like 'FOREIGN KEY (account_id, organization_id) REFERENCES financial_accounts(id, organization_id)%')
     or (select count(*)<>7 or not bool_and(convalidated) from pg_catalog.pg_constraint
       where conrelid=any(array['public.financial_accounts'::regclass,'public.financial_transactions'::regclass])
       and conname=any(array[
       'financial_accounts_account_type_v147_check','financial_accounts_system_key_v147_check',
       'financial_accounts_system_mapping_v147_check','financial_accounts_system_request_v147_check',
       'financial_transactions_operation_v147_check','financial_transactions_source_v147_check',
       'financial_transactions_shape_v147_check']))
     or not exists(select 1 from pg_catalog.pg_index index_row
       where index_row.indexrelid=to_regclass('public.commercial_sales_scope_v147_idx')
         and index_row.indrelid='public.commercial_sales'::regclass
         and pg_get_indexdef(index_row.indexrelid) like 'CREATE INDEX commercial_sales_scope_v147_idx ON public.commercial_sales USING btree (organization_id, occurred_at DESC, id)%')
     or not (select prosecdef and coalesce(proconfig,'{}')@>array['search_path=""']
       from pg_catalog.pg_proc where oid='public.sell_minuta_commercial_product_v147(uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid)'::regprocedure)
     or not (select prosecdef and provolatile='s' and coalesce(proconfig,'{}')@>array['search_path=""']
       from pg_catalog.pg_proc where oid='public.get_minuta_commerce_workspace_v147(uuid)'::regprocedure)
     or position(':commerce:' in pg_get_functiondef('public.sell_minuta_commercial_product_v147(uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid)'::regprocedure))=0
     or position('commercial_sale_idempotency_conflict' in pg_get_functiondef('public.sell_minuta_commercial_product_v147(uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid)'::regprocedure))=0 then
    raise exception using errcode='55000',message='v151_requires_exact_v147_v148_v149_v150';
  end if;

  v_proc:='public.refund_minuta_commercial_sale_v147(uuid,uuid,numeric,bigint,text,uuid)'::regprocedure;
  v_definition:=pg_get_functiondef(v_proc);
  select public.minuta_financial_sha256_v129(jsonb_build_object('source',prosrc)) into v_source_hash
    from pg_catalog.pg_proc where oid=v_proc;
  if not (select prosecdef and coalesce(proconfig,'{}')@>array['search_path=""'] from pg_catalog.pg_proc where oid=v_proc)
     or v_source_hash is distinct from '9d1ea093ab4552eaac5764a3c8d1ef4458d1f86ccac63c21db78af8092224cca'
     or position('v_expected_amount' in v_definition)=0
     or position('commercial_refund_amount_unallocatable' in v_definition)=0
     or position('commercial_refund_amount_mismatch' in v_definition)=0
     or position('p_quantity=v_remaining_quantity' in replace(v_definition,' ',''))=0
     or not has_function_privilege('authenticated',v_proc,'execute')
     or has_function_privilege('anon',v_proc,'execute')
     or exists(select 1 from pg_catalog.pg_proc procedure_row,
       lateral aclexplode(coalesce(procedure_row.proacl,acldefault('f',procedure_row.proowner))) grant_row
       where procedure_row.oid=v_proc and grant_row.grantee=0 and grant_row.privilege_type='EXECUTE') then
    raise exception using errcode='55000',message='v151_requires_exact_v147_v148_v149_v150';
  end if;

  select public.minuta_financial_sha256_v129(jsonb_build_object(
    'functionSourceHashes',jsonb_build_array(
      (select public.minuta_financial_sha256_v129(jsonb_build_object('source',prosrc)) from pg_catalog.pg_proc where oid='public.sell_minuta_commercial_product_v147(uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid)'::regprocedure),
      (select public.minuta_financial_sha256_v129(jsonb_build_object('source',prosrc)) from pg_catalog.pg_proc where oid='public.get_minuta_commerce_workspace_v147(uuid)'::regprocedure),
      (select public.minuta_financial_sha256_v129(jsonb_build_object('source',prosrc)) from pg_catalog.pg_proc where oid='public.refund_minuta_commercial_sale_v147(uuid,uuid,numeric,bigint,text,uuid)'::regprocedure)
    ),
    'sellerColumn',coalesce((select jsonb_build_object(
      'type',format_type(atttypid,atttypmod),'notNull',attnotnull)
      from pg_catalog.pg_attribute where attrelid='public.commercial_sales'::regclass
        and attname='seller_id' and attnum>0 and not attisdropped),'null'::jsonb),
    'quantityColumn',coalesce((select jsonb_build_object(
      'type',format_type(atttypid,atttypmod),'notNull',attnotnull)
      from pg_catalog.pg_attribute where attrelid='public.commercial_sale_lines'::regclass
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
        or (relation_row.relname='financial_transactions' and constraint_row.conname='financial_transactions_organization_id_request_id_key')
      )),'[]'::jsonb),
    'index',(select pg_get_indexdef(index_row.indexrelid) from pg_catalog.pg_index index_row
      where index_row.indexrelid='public.commercial_sales_scope_v147_idx'::regclass)
  )) into v_hash;
  if v_hash is distinct from '622fc10e7cc5e0057dbe2ed345f0f8caab5c39fd78f4dd3e9c79ed6541bbcb7c' then
    raise exception using errcode='55000',message='v151_requires_exact_v147_v148_v149_v150';
  end if;

  foreach v_name in array array[
    'public.apply_minuta_benefit_v149(uuid,uuid,uuid,text,integer,uuid)',
    'public.protect_minuta_benefit_application_v149()',
    'public.get_minuta_benefit_timezone_v150(uuid)',
    'public.minuta_benefit_frozen_days_v150(text,timestamptz,timestamptz)',
    'public.sync_minuta_benefit_expiry_v150(uuid,uuid)',
    'public.set_minuta_benefit_lifecycle_v150(uuid,uuid,text,text,uuid)',
    'public.get_minuta_benefit_lifecycle_v150(uuid,uuid)',
    'public.set_minuta_benefit_status(uuid,uuid,text)'
  ] loop
    v_proc:=to_regprocedure(v_name);
    if v_proc is null then
      raise exception using errcode='55000',message='v151_requires_exact_v147_v148_v149_v150';
    end if;
    v_prefix:=case when v_name like '%v149%' or v_name like '%protect_minuta_benefit_application%'
      then 'minuta-benefit-application-v149:sha256=' else 'minuta_benefit_lifecycle_v150:sha256=' end;
    select public.minuta_financial_sha256_v129(jsonb_build_object(
      'source',procedure_row.prosrc,'kind',procedure_row.prokind,'language',language_row.lanname,
      'owner',pg_get_userbyid(procedure_row.proowner),'volatility',procedure_row.provolatile,
      'security_definer',procedure_row.prosecdef,'strict',procedure_row.proisstrict,
      'leakproof',procedure_row.proleakproof,'parallel',procedure_row.proparallel,
      'result',pg_get_function_result(procedure_row.oid),'arguments',pg_get_function_arguments(procedure_row.oid),
      'identity_arguments',pg_get_function_identity_arguments(procedure_row.oid),
      'config',coalesce(to_jsonb(procedure_row.proconfig),'null'::jsonb),
      'acl',case when v_prefix like 'minuta-benefit%'
        then coalesce((select jsonb_agg(jsonb_build_object(
          'grantor',pg_get_userbyid(grant_row.grantor),
          'grantee',case grant_row.grantee when 0 then 'PUBLIC' else pg_get_userbyid(grant_row.grantee) end,
          'privilege',grant_row.privilege_type,'grantable',grant_row.is_grantable
        ) order by pg_get_userbyid(grant_row.grantor),
          case grant_row.grantee when 0 then 'PUBLIC' else pg_get_userbyid(grant_row.grantee) end,
          grant_row.privilege_type,grant_row.is_grantable)
          from aclexplode(procedure_row.proacl) grant_row),'[]'::jsonb)
        else to_jsonb(coalesce(procedure_row.proacl::text,'')) end
    )) into v_hash
    from pg_catalog.pg_proc procedure_row
    join pg_catalog.pg_language language_row on language_row.oid=procedure_row.prolang
    where procedure_row.oid=v_proc;
    if obj_description(v_proc::oid,'pg_proc') is distinct from v_prefix||v_hash then
      raise exception using errcode='55000',message='v151_requires_exact_v147_v148_v149_v150';
    end if;
  end loop;

  v_relation:='public.benefit_application_requests'::regclass;
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
      left join pg_catalog.pg_attrdef default_row on default_row.adrelid=attribute_row.attrelid and default_row.adnum=attribute_row.attnum
      where attribute_row.attrelid=relation_row.oid and attribute_row.attnum>0 and not attribute_row.attisdropped),'[]'::jsonb),
    'constraints',coalesce((select jsonb_agg(jsonb_build_object(
      'name',constraint_row.conname,'type',constraint_row.contype,'definition',pg_get_constraintdef(constraint_row.oid,true),
      'validated',constraint_row.convalidated,'deferrable',constraint_row.condeferrable,'deferred',constraint_row.condeferred
    ) order by constraint_row.conname) from pg_catalog.pg_constraint constraint_row where constraint_row.conrelid=relation_row.oid),'[]'::jsonb),
    'indexes',coalesce((select jsonb_agg(pg_get_indexdef(index_row.indexrelid) order by index_row.indexrelid::regclass::text)
      from pg_catalog.pg_index index_row where index_row.indrelid=relation_row.oid),'[]'::jsonb),
    'policies',coalesce((select jsonb_agg(jsonb_build_object(
      'name',policy_row.polname,'command',policy_row.polcmd,'permissive',policy_row.polpermissive,
      'roles',coalesce((select jsonb_agg(pg_get_userbyid(role_oid) order by pg_get_userbyid(role_oid)) from unnest(policy_row.polroles) role_oid),'[]'::jsonb),
      'using',pg_get_expr(policy_row.polqual,policy_row.polrelid),'check',pg_get_expr(policy_row.polwithcheck,policy_row.polrelid)
    ) order by policy_row.polname) from pg_catalog.pg_policy policy_row where policy_row.polrelid=relation_row.oid),'[]'::jsonb),
    'triggers',coalesce((select jsonb_agg(jsonb_build_object(
      'name',trigger_row.tgname,'enabled',trigger_row.tgenabled,'definition',pg_get_triggerdef(trigger_row.oid,true)
    ) order by trigger_row.tgname) from pg_catalog.pg_trigger trigger_row
      where trigger_row.tgrelid=relation_row.oid and not trigger_row.tgisinternal),'[]'::jsonb)
  )) into v_hash from pg_catalog.pg_class relation_row where relation_row.oid=v_relation;
  if obj_description(v_relation::oid,'pg_class') is distinct from 'minuta-benefit-application-v149:sha256='||v_hash
     or has_function_privilege('authenticated','public.apply_minuta_benefit(uuid,uuid,uuid,text,integer)','execute') then
    raise exception using errcode='55000',message='v151_requires_exact_v147_v148_v149_v150';
  end if;

  foreach v_name in array array['public.benefit_freeze_periods','public.benefit_lifecycle_requests'] loop
    v_relation:=to_regclass(v_name);
    select public.minuta_financial_sha256_v129(jsonb_build_object(
      'kind',relation_row.relkind,'owner',pg_get_userbyid(relation_row.relowner),
      'row_security',relation_row.relrowsecurity,'force_row_security',relation_row.relforcerowsecurity,
      'acl',coalesce(relation_row.relacl::text,''),
      'columns',coalesce((select jsonb_agg(jsonb_build_object(
        'number',attribute_row.attnum,'name',attribute_row.attname,'type',format_type(attribute_row.atttypid,attribute_row.atttypmod),
        'not_null',attribute_row.attnotnull,'identity',attribute_row.attidentity,'generated',attribute_row.attgenerated,
        'default',pg_get_expr(default_row.adbin,default_row.adrelid)
      ) order by attribute_row.attnum) from pg_catalog.pg_attribute attribute_row
        left join pg_catalog.pg_attrdef default_row on default_row.adrelid=attribute_row.attrelid and default_row.adnum=attribute_row.attnum
        where attribute_row.attrelid=relation_row.oid and attribute_row.attnum>0 and not attribute_row.attisdropped),'[]'::jsonb),
      'constraints',coalesce((select jsonb_agg(jsonb_build_object(
        'name',constraint_row.conname,'type',constraint_row.contype,'definition',pg_get_constraintdef(constraint_row.oid,true),
        'validated',constraint_row.convalidated,'deferrable',constraint_row.condeferrable,'deferred',constraint_row.condeferred
      ) order by constraint_row.conname) from pg_catalog.pg_constraint constraint_row where constraint_row.conrelid=relation_row.oid),'[]'::jsonb),
      'indexes',coalesce((select jsonb_agg(pg_get_indexdef(index_row.indexrelid) order by index_row.indexrelid::regclass::text)
        from pg_catalog.pg_index index_row where index_row.indrelid=relation_row.oid),'[]'::jsonb),
      'policies',coalesce((select jsonb_agg(jsonb_build_object(
        'name',policy_row.polname,'command',policy_row.polcmd,'permissive',policy_row.polpermissive,
        'roles',coalesce((select jsonb_agg(pg_get_userbyid(role_oid) order by pg_get_userbyid(role_oid)) from unnest(policy_row.polroles) role_oid),'[]'::jsonb),
        'using',pg_get_expr(policy_row.polqual,policy_row.polrelid),'check',pg_get_expr(policy_row.polwithcheck,policy_row.polrelid)
      ) order by policy_row.polname) from pg_catalog.pg_policy policy_row where policy_row.polrelid=relation_row.oid),'[]'::jsonb),
      'triggers',coalesce((select jsonb_agg(jsonb_build_object(
        'name',trigger_row.tgname,'enabled',trigger_row.tgenabled,'definition',pg_get_triggerdef(trigger_row.oid,true)
      ) order by trigger_row.tgname) from pg_catalog.pg_trigger trigger_row
        where trigger_row.tgrelid=relation_row.oid and not trigger_row.tgisinternal),'[]'::jsonb)
    )) into v_hash from pg_catalog.pg_class relation_row where relation_row.oid=v_relation;
    if obj_description(v_relation::oid,'pg_class') is distinct from 'minuta_benefit_lifecycle_v150:sha256='||v_hash then
      raise exception using errcode='55000',message='v151_requires_exact_v147_v148_v149_v150';
    end if;
  end loop;

  select public.minuta_financial_sha256_v129(jsonb_build_object(
    'name',constraint_row.conname,'type',constraint_row.contype,'definition',pg_get_constraintdef(constraint_row.oid,true),
    'validated',constraint_row.convalidated,'deferrable',constraint_row.condeferrable,'deferred',constraint_row.condeferred
  )) into v_hash from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid='public.benefit_ledger'::regclass and constraint_row.conname='benefit_ledger_event_type_check';
  if v_hash is null or coalesce(obj_description((select oid from pg_catalog.pg_constraint
      where conrelid='public.benefit_ledger'::regclass and conname='benefit_ledger_event_type_check'),'pg_constraint'),'')
      <> 'minuta_benefit_lifecycle_v150:sha256='||v_hash
     or exists(select 1 from public.client_benefit_instruments instrument
       where instrument.status='frozen' and not exists(select 1 from public.benefit_freeze_periods period
         where period.instrument_id=instrument.id and period.organization_id=instrument.organization_id and period.thawed_at is null))
     or exists(select 1 from public.benefit_freeze_periods period join public.client_benefit_instruments instrument
       on (instrument.id,instrument.organization_id)=(period.instrument_id,period.organization_id)
       where period.thawed_at is null and instrument.status<>'frozen')
     or exists(select 1 from public.benefit_freeze_periods where thawed_at is null group by instrument_id having count(*)>1)
     or exists(
       select 1 from (select distinct organization_id from public.client_benefit_instruments) organization_row
       left join lateral (
         select location.timezone from public.locations location
         where location.organization_id=organization_row.organization_id and location.active
         order by location.is_primary desc,location.id limit 1
       ) chosen on true
       left join pg_catalog.pg_timezone_names zone on zone.name=chosen.timezone
       where chosen.timezone is null or zone.name is null
     ) then
    raise exception using errcode='55000',message='v151_requires_exact_v147_v148_v149_v150';
  end if;
end
$dependency_guard$;

-- Refuse partial or newer same-signature v151 objects before CREATE OR REPLACE.
do $apply_version_guard$
declare v_name text;v_proc regprocedure;v_hash text;v_marker text;
begin
  if to_regprocedure('public.sell_minuta_commercial_product_v151(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid)') is null then
    if to_regprocedure('public.get_minuta_commerce_workspace_v151(uuid)') is not null then
      raise exception using errcode='55000',message='v151_apply_blocked_partial_or_newer_objects';
    end if;
  else
    if to_regprocedure('public.get_minuta_commerce_workspace_v151(uuid)') is null then
      raise exception using errcode='55000',message='v151_apply_blocked_partial_or_newer_objects';
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
        raise exception using errcode='55000',message='v151_apply_blocked_newer_function_definition';
      end if;
    end loop;
  end if;
end
$apply_version_guard$;

create or replace function public.sell_minuta_commercial_product_v151(
  p_organization uuid,p_booking uuid,p_client_account uuid,p_seller uuid,p_item_kind text,p_benefit_product uuid,
  p_inventory_item uuid,p_warehouse uuid,p_quantity numeric,p_unit_price_minor bigint,p_discount_minor bigint,
  p_payment_method text,p_payment_account uuid,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_actor uuid;
  v_seller uuid;
  v_sale public.commercial_sales%rowtype;
  v_account public.financial_accounts%rowtype;
  v_product public.benefit_products%rowtype;
  v_item public.inventory_items%rowtype;
  v_subtotal bigint;
  v_total bigint;
  v_fingerprint text;
  v_legacy_fingerprint text;
  v_sale_fingerprint text;
  v_instrument jsonb;
  v_movement jsonb;
  v_revenue uuid;
  v_transaction uuid;
  v_line uuid;
begin
  v_actor:=public.require_minuta_financial_manager_v129(p_organization);
  v_seller:=coalesce(p_seller,v_actor);
  if p_request_id is null or p_item_kind not in('inventory_item','benefit_product') or p_payment_method not in('cash','manual')
     or coalesce(p_quantity,0)<=0 or p_unit_price_minor is null or p_unit_price_minor<=0 or coalesce(p_discount_minor,0)<0 then
    raise exception using errcode='22023',message='invalid_commercial_sale';
  end if;
  if p_quantity<>trunc(p_quantity) and p_item_kind='benefit_product' then
    raise exception using errcode='22023',message='invalid_benefit_quantity';
  end if;
  if p_item_kind='benefit_product'
     and (p_quantity<>1 or p_client_account is null or p_benefit_product is null or p_inventory_item is not null or p_warehouse is not null) then
    raise exception using errcode='22023',message='invalid_benefit_sale';
  end if;
  if p_item_kind='inventory_item'
     and (p_inventory_item is null or p_warehouse is null or p_benefit_product is not null) then
    raise exception using errcode='22023',message='invalid_inventory_sale';
  end if;
  if p_item_kind='inventory_item' and (
       p_quantity::text in('NaN','Infinity','-Infinity')
       or p_quantity>99999999999.999
       or scale(p_quantity)>3
     ) then
    raise exception using errcode='22023',message='invalid_inventory_quantity';
  end if;
  if round(p_quantity*p_unit_price_minor)>9223372036854775807 then
    raise exception using errcode='22003',message='commercial_sale_subtotal_out_of_range';
  end if;
  v_subtotal:=round(p_quantity*p_unit_price_minor)::bigint;
  v_total:=v_subtotal-coalesce(p_discount_minor,0);
  if v_total<=0 then
    raise exception using errcode='22023',message='invalid_commercial_sale_total';
  end if;

  -- Share v147's lock namespace so mixed-version callers serialize on request_id.
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':commerce:'||p_request_id::text,147));
  select * into v_sale from public.commercial_sales
    where organization_id=p_organization and request_id=p_request_id for update;
  v_fingerprint:=public.minuta_financial_sha256_v129(jsonb_build_array(
    p_organization,p_booking,p_client_account,v_seller,p_item_kind,p_benefit_product,p_inventory_item,p_warehouse,
    p_quantity,p_unit_price_minor,coalesce(p_discount_minor,0),p_payment_method,p_payment_account));
  v_legacy_fingerprint:=public.minuta_financial_sha256_v129(jsonb_build_array(
    p_organization,p_booking,p_client_account,p_item_kind,p_benefit_product,p_inventory_item,p_warehouse,
    p_quantity,p_unit_price_minor,coalesce(p_discount_minor,0),p_payment_method,p_payment_account));
  v_sale_fingerprint:=case when v_seller=v_actor then v_legacy_fingerprint else v_fingerprint end;
  if v_sale.id is not null then
    if v_sale.request_fingerprint<>v_fingerprint
       and not (v_sale.seller_id is not distinct from v_seller and v_sale.request_fingerprint=v_legacy_fingerprint) then
      raise exception using errcode='23505',message='commercial_sale_idempotency_conflict';
    end if;
    return jsonb_build_object(
      'id',v_sale.id,'organization_id',p_organization,'seller_id',v_sale.seller_id,
      'status',v_sale.status,'total_minor',v_sale.total_minor,'replayed',true);
  end if;

  if not exists(select 1 from public.organization_memberships membership
    where membership.organization_id=p_organization and membership.user_id=v_seller and membership.active) then
    raise exception using errcode='42501',message='commercial_seller_not_active_member';
  end if;

  if not coalesce((select enabled from public.organization_finance_settings where organization_id=p_organization),false) then
    raise exception using errcode='55000',message='finance_disabled';
  end if;
  select * into v_account from public.financial_accounts
    where id=p_payment_account and organization_id=p_organization and active for update;
  if v_account.id is null or v_account.system_key is not null or v_account.account_type not in('cash','bank') then
    raise exception using errcode='22023',message='cash_or_bank_account_required';
  end if;
  if p_payment_method='cash' and v_account.account_type<>'cash' then
    raise exception using errcode='22023',message='cash_account_required';
  end if;
  if p_client_account is not null and not exists(select 1 from public.bookings
    where organization_id=p_organization and client_account_id=p_client_account) then
    raise exception using errcode='42501',message='commercial_client_mismatch';
  end if;
  if p_booking is not null and not exists(select 1 from public.bookings
    where id=p_booking and organization_id=p_organization and client_account_id is not distinct from p_client_account) then
    raise exception using errcode='42501',message='commercial_booking_mismatch';
  end if;

  insert into public.financial_accounts(organization_id,name,account_class,account_type,system_key,created_by)
    values(p_organization,'Выручка от продаж','income','product_revenue','product_revenue',v_actor)
    on conflict(organization_id,system_key) do nothing;
  select id into v_revenue from public.financial_accounts
    where organization_id=p_organization and system_key='product_revenue' and active for update;

  insert into public.commercial_sales(
    organization_id,booking_id,client_account_id,seller_id,status,payment_method,payment_account_id,
    subtotal_minor,discount_minor,total_minor,request_id,request_fingerprint,occurred_at
  ) values(
    p_organization,p_booking,p_client_account,v_seller,'paid',p_payment_method,p_payment_account,
    v_subtotal,coalesce(p_discount_minor,0),v_total,p_request_id,v_sale_fingerprint,now()
  ) returning * into v_sale;

  if p_item_kind='benefit_product' then
    select * into v_product from public.benefit_products
      where id=p_benefit_product and organization_id=p_organization and active for update;
    if v_product.id is null then
      raise exception using errcode='P0002',message='benefit_product_not_found';
    end if;
    v_instrument:=public.issue_minuta_benefit(
      p_organization,p_benefit_product,p_client_account,null,md5(p_request_id::text||':benefit')::uuid);
    insert into public.commercial_sale_lines(
      organization_id,sale_id,item_kind,benefit_product_id,benefit_instrument_id,item_name,quantity,
      unit_price_minor,subtotal_minor,discount_minor,total_minor
    ) values(
      p_organization,v_sale.id,p_item_kind,p_benefit_product,(v_instrument->>'id')::uuid,v_product.name,1,
      p_unit_price_minor,v_subtotal,coalesce(p_discount_minor,0),v_total
    ) returning id into v_line;
  else
    select * into v_item from public.inventory_items
      where id=p_inventory_item and organization_id=p_organization and active for update;
    if v_item.id is null then
      raise exception using errcode='P0002',message='inventory_item_not_found';
    end if;
    v_movement:=public.apply_minuta_stock_movement(
      p_organization,p_warehouse,p_inventory_item,'write_off',p_quantity,null,
      'Продажа '||v_sale.id::text,md5(p_request_id::text||':inventory')::uuid);
    insert into public.commercial_sale_lines(
      organization_id,sale_id,item_kind,inventory_item_id,warehouse_id,inventory_movement_id,item_name,quantity,
      unit_price_minor,subtotal_minor,discount_minor,total_minor
    ) values(
      p_organization,v_sale.id,p_item_kind,p_inventory_item,p_warehouse,(v_movement->>'id')::bigint,v_item.name,p_quantity,
      p_unit_price_minor,v_subtotal,coalesce(p_discount_minor,0),v_total
    ) returning id into v_line;
  end if;

  insert into public.financial_transactions(
    organization_id,request_id,request_fingerprint,operation_type,source_type,source_id,source_fingerprint,
    occurred_at,explanation,created_by
  ) values(
    p_organization,md5(p_request_id::text||':finance')::uuid,v_fingerprint,'commercial_sale','commercial_sale',
    v_sale.id,v_fingerprint,v_sale.occurred_at,
    jsonb_build_object(
      'schema','minuta-commerce-v2','sale_id',v_sale.id,'line_id',v_line,'item_kind',p_item_kind,
      'total_minor',v_total,'payment_method',p_payment_method,'booking_id',p_booking,
      'client_account_id',p_client_account,'seller_id',v_seller
    ),v_actor
  ) returning id into v_transaction;
  insert into public.financial_postings(organization_id,transaction_id,account_id,side,amount_minor) values
    (p_organization,v_transaction,p_payment_account,'debit',v_total),
    (p_organization,v_transaction,v_revenue,'credit',v_total);
  insert into public.commercial_audit_log(organization_id,actor_id,action,subject_id,details) values(
    p_organization,v_actor,'commercial_sale_created',v_sale.id,
    jsonb_build_object('line_id',v_line,'total_minor',v_total,'transaction_id',v_transaction,'seller_id',v_seller));

  return jsonb_build_object(
    'id',v_sale.id,'organization_id',p_organization,'seller_id',v_seller,'status','paid',
    'total_minor',v_total,'transaction_id',v_transaction,'replayed',false);
end
$$;

create or replace function public.get_minuta_commerce_workspace_v151(p_organization uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_actor uuid;
begin
  v_actor:=auth.uid();
  if v_actor is null or not public.has_organization_role(p_organization,array['owner','admin']) then
    raise exception using errcode='42501',message='commercial_finance_manager_required';
  end if;
  return jsonb_build_object(
    'organization_id',p_organization,
    'finance_enabled',coalesce((select enabled from public.organization_finance_settings where organization_id=p_organization),false),
    'benefits_enabled',coalesce((select enabled from public.organization_benefit_settings where organization_id=p_organization),false),
    'inventory_enabled',coalesce((select enabled from public.organization_inventory_settings where organization_id=p_organization),false),
    'accounts',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'account_type',account_type,'system_key',system_key) order by account_type,name) from public.financial_accounts where organization_id=p_organization and active),'[]'::jsonb),
    'sellers',coalesce((select jsonb_agg(jsonb_build_object('id',membership.user_id,'name',coalesce(profile.display_name,'Сотрудник'),'role',case membership.role when 'owner' then 'владелец' when 'admin' then 'администратор' else 'специалист' end) order by coalesce(profile.display_name,'Сотрудник'),membership.user_id) from public.organization_memberships membership left join public.performer_profiles profile on profile.id=membership.user_id where membership.organization_id=p_organization and membership.active),'[]'::jsonb),
    'clients',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.client_name,'phone',c.client_phone) order by c.client_name,c.id) from (select distinct on (client_account_id) client_account_id id,client_name,client_phone from public.bookings where organization_id=p_organization and client_account_id is not null order by client_account_id,created_at desc)c),'[]'::jsonb),
    'bookings',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'client_account_id',b.client_account_id,'client_name',b.client_name,'performer_id',b.performer_id,'booking_date',b.booking_date,'booking_time',b.booking_time,'service_name',s.name) order by b.booking_date desc,b.booking_time desc) from public.bookings b join public.services s on s.id=b.service_id where b.organization_id=p_organization and b.client_account_id is not null and b.status<>'cancelled' and b.booking_date>=current_date-90),'[]'::jsonb),
    'benefit_products',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'kind',kind,'sale_price_minor',sale_price_rub::bigint*100) order by name,id) from public.benefit_products where organization_id=p_organization and active),'[]'::jsonb),
    'inventory_items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'sku',sku,'unit',unit) order by name,id) from public.inventory_items where organization_id=p_organization and active),'[]'::jsonb),
    'warehouses',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id) from public.inventory_warehouses where organization_id=p_organization and active),'[]'::jsonb),
    'sales',coalesce((select jsonb_agg(jsonb_build_object('id',sale.id,'booking_id',sale.booking_id,'client_account_id',sale.client_account_id,'client_name',(select booking.client_name from public.bookings booking where booking.organization_id=sale.organization_id and booking.client_account_id=sale.client_account_id order by booking.created_at desc limit 1),'seller_id',sale.seller_id,'seller_name',coalesce(profile.display_name,'Сотрудник'),'status',sale.status,'payment_method',sale.payment_method,'total_minor',sale.total_minor,'refunded_minor',sale.refunded_minor,'occurred_at',sale.occurred_at,'line',jsonb_build_object('id',line.id,'item_kind',line.item_kind,'item_name',line.item_name,'quantity',line.quantity,'refunded_quantity',line.refunded_quantity,'unit_price_minor',line.unit_price_minor)) order by sale.occurred_at desc,sale.id desc) from public.commercial_sales sale join public.commercial_sale_lines line on line.sale_id=sale.id left join public.performer_profiles profile on profile.id=sale.seller_id where sale.organization_id=p_organization),'[]'::jsonb),
    'recurring_expenses',coalesce((select jsonb_agg(jsonb_build_object('id',rule.id,'name',rule.name,'supplier_name',rule.supplier_name,'amount_minor',rule.amount_minor,'day_of_month',rule.day_of_month,'active',rule.active,'last_occurred_on',(select max(occurrence.occurred_on) from public.recurring_expense_occurrences occurrence where occurrence.rule_id=rule.id)) order by rule.active desc,rule.name,rule.id) from public.organization_recurring_expenses rule where rule.organization_id=p_organization),'[]'::jsonb),
    'audit',coalesce((select jsonb_agg(jsonb_build_object('id',entry.id,'action',entry.action,'subject_id',entry.subject_id,'details',entry.details,'created_at',entry.created_at) order by entry.created_at desc,entry.id desc) from (select * from public.commercial_audit_log where organization_id=p_organization order by created_at desc,id desc limit 100)entry),'[]'::jsonb)
  );
end
$$;

revoke all on function public.sell_minuta_commercial_product_v151(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_minuta_commerce_workspace_v151(uuid) from public,anon,authenticated,service_role;
grant execute on function public.sell_minuta_commercial_product_v151(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid) to authenticated;
grant execute on function public.get_minuta_commerce_workspace_v151(uuid) to authenticated;

do $stamp_v151$
declare v_name text;v_proc regprocedure;v_hash text;
begin
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
    )) into v_hash
    from pg_catalog.pg_proc procedure_row
    join pg_catalog.pg_language language_row on language_row.oid=procedure_row.prolang
    where procedure_row.oid=v_proc;
    execute format('comment on function %s is %L',v_name,'minuta_commercial_sales_v151:sha256='||v_hash);
  end loop;
end
$stamp_v151$;

commit;
