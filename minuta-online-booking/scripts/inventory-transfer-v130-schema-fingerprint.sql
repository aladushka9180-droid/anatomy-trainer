with target_tables(name) as (values
  ('organization_inventory_transfer_settings'),('inventory_transfer_documents'),('inventory_cost_layers'),
  ('inventory_movement_cost_snapshots'),('inventory_cost_allocations')
), relations as (
  select jsonb_agg(jsonb_build_object(
    'table',c.relname,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
    'acl',coalesce((select jsonb_agg(a::text order by a::text) from unnest(coalesce(c.relacl,acldefault('r',c.relowner))) a),'[]'::jsonb)
  ) order by c.relname) value
  from target_tables t join pg_class c on c.oid=format('public.%I',t.name)::regclass
), columns_contract as (
  select jsonb_agg(jsonb_build_object(
    'table',c.relname,'column',a.attname,'type',format_type(a.atttypid,a.atttypmod),
    'notNull',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,
    'default',pg_get_expr(d.adbin,d.adrelid,true)
  ) order by c.relname,a.attnum) value
  from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
  left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where n.nspname='public' and a.attnum>0 and not a.attisdropped and (
    c.relname in(select name from target_tables)
    or (c.relname='inventory_movements' and a.attname in('purchase_total_cost_kopecks','transfer_document_id'))
  )
), constraints_contract as (
  select jsonb_agg(jsonb_build_object(
    'table',c.relname,'name',con.conname,'type',con.contype,'validated',con.convalidated,
    'deferrable',con.condeferrable,'deferred',con.condeferred,'definition',pg_get_constraintdef(con.oid,true)
  ) order by c.relname,con.conname) value
  from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and (
    c.relname in(select name from target_tables)
    or (c.relname='inventory_movements' and con.conname in(
      'inventory_movements_transfer_document_fk_v130','inventory_movements_movement_type_check_v130',
      'inventory_purchase_cost_receipt_only_v130','inventory_transfer_movement_shape_v130'))
  )
), indexes_contract as (
  select jsonb_agg(jsonb_build_object(
    'table',c.relname,'name',i.relname,'valid',x.indisvalid,'ready',x.indisready,
    'unique',x.indisunique,'definition',pg_get_indexdef(i.oid)
  ) order by c.relname,i.relname) value
  from pg_index x join pg_class i on i.oid=x.indexrelid join pg_class c on c.oid=x.indrelid
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and (
    c.relname in(select name from target_tables)
    or (c.relname='inventory_movements' and i.relname in('inventory_movements_id_organization_v130','inventory_transfer_movement_side_v130'))
  )
), triggers_contract as (
  select jsonb_agg(jsonb_build_object(
    'table',c.relname,'name',t.tgname,'enabled',t.tgenabled,'function',t.tgfoid::regprocedure::text,
    'definition',pg_get_triggerdef(t.oid,true)
  ) order by c.relname,t.tgname) value
  from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and not t.tgisinternal and (
    c.relname in(select name from target_tables)
    or (c.relname='inventory_movements' and t.tgname in(
      'inventory_movement_cost_v130','inventory_transfer_movement_pair_v130'))
  )
), function_signatures(signature) as (values
  ('public.protect_minuta_inventory_transfer_ledger_v130()'),
  ('public.record_minuta_inventory_cost_v130()'),
  ('public.verify_minuta_inventory_transfer_pair_v130()'),
  ('public.enable_minuta_inventory_transfers_v130(uuid)'),
  ('public.set_minuta_inventory_transfers_enabled_v130(uuid,boolean)'),
  ('public.apply_minuta_stock_movement_v130(uuid,uuid,uuid,text,numeric,numeric,text,uuid,bigint)'),
  ('public.transfer_minuta_inventory_stock_v130(uuid,uuid,uuid,uuid,numeric,text,uuid)'),
  ('public.get_minuta_inventory_workspace_v130(uuid)'),
  ('public.apply_minuta_stock_movement(uuid,uuid,uuid,text,numeric,numeric,text,uuid)'),
  ('public.consume_minuta_inventory_for_booking(uuid)'),
  ('public.get_minuta_inventory_role(uuid)'),
  ('public.get_minuta_inventory_workspace(uuid)'),
  ('public.write_minuta_inventory_audit(uuid,text,uuid,jsonb)'),
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
), legacy_contract as (
  select jsonb_build_object(
    'inventoryMovementsMovementTypeConstraintAbsent',not exists(
      select 1 from pg_constraint con
      where con.conrelid='public.inventory_movements'::regclass
        and con.conname='inventory_movements_movement_type_check'
    )
  ) value
), contract as (
  select jsonb_build_object(
    'relations',relations.value,'columns',columns_contract.value,'constraints',constraints_contract.value,
    'indexes',indexes_contract.value,'triggers',triggers_contract.value,'functions',functions_contract.value,
    'policies',policies_contract.value,'legacy',legacy_contract.value
  ) value
  from relations,columns_contract,constraints_contract,indexes_contract,triggers_contract,functions_contract,policies_contract,legacy_contract
)
select encode(extensions.digest(convert_to(value::text,'UTF8'),'sha256'),'hex') schema_fingerprint from contract;
