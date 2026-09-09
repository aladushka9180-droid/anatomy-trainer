with target_tables(name) as (values
  ('organization_finance_settings'),('financial_accounts'),('financial_transactions'),('financial_postings')
), relations as (
  select jsonb_agg(jsonb_build_object(
    'table',c.relname,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
    'acl',coalesce((select jsonb_agg(a::text order by a::text) from unnest(coalesce(c.relacl,acldefault('r',c.relowner))) a),'[]'::jsonb)
  ) order by c.relname) value
  from target_tables t join pg_class c on c.oid=format('public.%I',t.name)::regclass
), columns_contract as (
  select jsonb_agg(jsonb_build_object(
    'table',c.relname,'column',a.attname,'position',a.attnum,'type',format_type(a.atttypid,a.atttypmod),
    'notNull',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,
    'default',pg_get_expr(d.adbin,d.adrelid,true)
  ) order by c.relname,a.attnum) value
  from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
  left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where n.nspname='public' and a.attnum>0 and not a.attisdropped and c.relname in(select name from target_tables)
), constraints_contract as (
  select jsonb_agg(jsonb_build_object(
    'table',c.relname,'name',con.conname,'type',con.contype,'validated',con.convalidated,
    'deferrable',con.condeferrable,'deferred',con.condeferred,'definition',pg_get_constraintdef(con.oid,true)
  ) order by c.relname,con.conname) value
  from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in(select name from target_tables)
), indexes_contract as (
  select jsonb_agg(jsonb_build_object(
    'table',c.relname,'name',i.relname,'valid',x.indisvalid,'ready',x.indisready,
    'unique',x.indisunique,'definition',pg_get_indexdef(i.oid)
  ) order by c.relname,i.relname) value
  from pg_index x join pg_class i on i.oid=x.indexrelid join pg_class c on c.oid=x.indrelid
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in(select name from target_tables)
), triggers_contract as (
  select jsonb_agg(jsonb_build_object(
    'table',c.relname,'name',t.tgname,'enabled',t.tgenabled,'function',t.tgfoid::regprocedure::text,
    'definition',pg_get_triggerdef(t.oid,true)
  ) order by c.relname,t.tgname) value
  from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and not t.tgisinternal and c.relname in(select name from target_tables)
), function_signatures(signature) as (values
  ('public.protect_minuta_financial_ledger_v129()'),
  ('public.assert_minuta_financial_transaction_balanced_v129()'),
  ('public.assert_minuta_financial_postings_balanced_v129()'),
  ('public.minuta_financial_sha256_v129(jsonb)'),
  ('public.require_minuta_financial_manager_v129(uuid)'),
  ('public.minuta_financial_booking_source_v129(uuid,uuid)'),
  ('public.set_minuta_finance_enabled_v129(uuid,boolean)'),
  ('public.create_minuta_financial_account_v129(uuid,uuid,text,text)'),
  ('public.post_minuta_visit_finance_v129(uuid,uuid,uuid,uuid)'),
  ('public.reverse_minuta_financial_transaction_v129(uuid,uuid,uuid,text)'),
  ('public.get_minuta_financial_workspace_v129(uuid)'),
  ('public.has_organization_role(uuid,text[])')
), functions_contract as (
  select jsonb_agg(jsonb_build_object(
    'signature',s.signature,'owner',pg_get_userbyid(p.proowner),'securityDefiner',p.prosecdef,
    'volatility',p.provolatile,'parallel',p.proparallel,'returnType',pg_get_function_result(p.oid),
    'config',coalesce(to_jsonb(p.proconfig),'[]'::jsonb),
    'acl',coalesce((select jsonb_agg(a::text order by a::text) from unnest(coalesce(p.proacl,acldefault('f',p.proowner))) a),'[]'::jsonb),
    'definition',pg_get_functiondef(p.oid)
  ) order by s.signature) value
  from function_signatures s join pg_proc p on p.oid=to_regprocedure(s.signature)
), policies_contract as (
  select jsonb_agg(jsonb_build_object(
    'table',tablename,'name',policyname,'permissive',permissive,'roles',to_jsonb(roles),
    'command',cmd,'using',qual,'check',with_check
  ) order by tablename,policyname) value
  from pg_policies where schemaname='public' and tablename in(select name from target_tables)
), contract as (
  select jsonb_build_object(
    'relations',relations.value,'columns',columns_contract.value,'constraints',constraints_contract.value,
    'indexes',indexes_contract.value,'triggers',triggers_contract.value,'functions',functions_contract.value,
    'policies',policies_contract.value
  ) value
  from relations,columns_contract,constraints_contract,indexes_contract,triggers_contract,functions_contract,policies_contract
)
select encode(extensions.digest(convert_to(value::text,'UTF8'),'sha256'),'hex') schema_fingerprint from contract;
