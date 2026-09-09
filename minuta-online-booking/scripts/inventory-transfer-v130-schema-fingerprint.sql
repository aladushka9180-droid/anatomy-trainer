with target_tables(name) as (values
  ('organization_inventory_transfer_settings'),('inventory_transfer_documents'),('inventory_cost_layers'),
  ('inventory_movement_cost_snapshots'),('inventory_cost_allocations')
), relations as (
  select jsonb_agg(jsonb_build_object(
    'table',c.relname,
    'ownerIsPostgres',pg_get_userbyid(c.relowner)='postgres',
    'ownerMatchesInventoryMovements',c.relowner=(select relowner from pg_class where oid='public.inventory_movements'::regclass),
    'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
    'acl',(select jsonb_agg(jsonb_build_object(
      'grantee',case when x.grantee=0 then 'public' when x.grantee=c.relowner then 'owner' else coalesce(r.rolname,'oid:'||x.grantee::text) end,
      'privilege',x.privilege_type,'grantable',x.is_grantable
    ) order by case when x.grantee=0 then 'public' when x.grantee=c.relowner then 'owner' else coalesce(r.rolname,'oid:'||x.grantee::text) end,x.privilege_type,x.is_grantable)
      from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x left join pg_roles r on r.oid=x.grantee)
  ) order by c.relname) value
  from target_tables t join pg_class c on c.oid=format('public.%I',t.name)::regclass
), columns_contract as (
  select jsonb_agg(jsonb_build_object(
    'table',c.relname,'column',a.attname,'type',format_type(a.atttypid,a.atttypmod),
    'notNull',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,
    'default',regexp_replace(lower(coalesce(pg_get_expr(d.adbin,d.adrelid,false),'')),'[[:space:]]+','','g')
  ) order by c.relname,a.attname) value
  from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
  left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where n.nspname='public' and a.attnum>0 and not a.attisdropped and (
    c.relname in(select name from target_tables)
    or (c.relname='inventory_movements' and a.attname in('purchase_total_cost_kopecks','transfer_document_id'))
  )
), constraints_contract as (
  select jsonb_agg(jsonb_build_object(
    'table',c.relname,'name',con.conname,'type',con.contype,'validated',con.convalidated,
    'deferrable',con.condeferrable,'deferred',con.condeferred,
    'definition',regexp_replace(lower(pg_get_constraintdef(con.oid,false)),'[[:space:]]+','','g')
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
    'unique',x.indisunique,
    'definition',regexp_replace(lower(pg_get_indexdef(i.oid)),'[[:space:]]+','','g')
  ) order by c.relname,i.relname) value
  from pg_index x join pg_class i on i.oid=x.indexrelid join pg_class c on c.oid=x.indrelid
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and (
    c.relname in(select name from target_tables)
    or (c.relname='inventory_movements' and i.relname in('inventory_movements_id_organization_v130','inventory_transfer_movement_side_v130'))
  )
), triggers_contract as (
  select jsonb_agg(jsonb_build_object(
    'table',c.relname,'name',t.tgname,'enabled',t.tgenabled,'type',t.tgtype,
    'deferrable',t.tgdeferrable,'initiallyDeferred',t.tginitdeferred,'constraintTrigger',t.tgconstraint<>0,
    'function',t.tgfoid::regprocedure::text,'arguments',encode(t.tgargs,'hex'),
    'when',regexp_replace(lower(coalesce(pg_get_expr(t.tgqual,t.tgrelid,false),'')),'[[:space:]]+','','g')
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
  ('public.consume_minuta_inventory_for_booking(uuid)')
), function_rows as (
  select s.signature,jsonb_build_object(
    'signature',s.signature,
    'ownerIsPostgres',pg_get_userbyid(p.proowner)='postgres',
    'ownerMatchesInventoryMovements',p.proowner=(select relowner from pg_class where oid='public.inventory_movements'::regclass),
    'language',l.lanname,'kind',p.prokind,'securityDefiner',p.prosecdef,'strict',p.proisstrict,
    'leakproof',p.proleakproof,'volatility',p.provolatile,'parallel',p.proparallel,
    'returnType',p.prorettype::regtype::text,'argumentNames',coalesce(to_jsonb(p.proargnames),'[]'::jsonb),
    'argumentModes',coalesce(to_jsonb(p.proargmodes),'[]'::jsonb),
    'config',coalesce((select jsonb_agg(v order by v) from unnest(p.proconfig) v),'[]'::jsonb),
    'acl',(select jsonb_agg(jsonb_build_object(
      'grantee',case when x.grantee=0 then 'public' when x.grantee=p.proowner then 'owner' else coalesce(r.rolname,'oid:'||x.grantee::text) end,
      'privilege',x.privilege_type,'grantable',x.is_grantable
    ) order by case when x.grantee=0 then 'public' when x.grantee=p.proowner then 'owner' else coalesce(r.rolname,'oid:'||x.grantee::text) end,x.privilege_type,x.is_grantable)
      from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x left join pg_roles r on r.oid=x.grantee),
    'source',p.prosrc
  ) value
  from function_signatures s join pg_proc p on p.oid=to_regprocedure(s.signature)
  join pg_language l on l.oid=p.prolang
), functions_contract as (
  select jsonb_agg(jsonb_build_object(
    'signature',signature,'contract',value
  ) order by signature) value from function_rows
), policies_contract as (
  select jsonb_agg(jsonb_build_object(
    'table',c.relname,'name',p.polname,'permissive',p.polpermissive,'command',p.polcmd,
    'roles',(select jsonb_agg(case when role_oid.oid=0 then 'public' else coalesce(r.rolname,'oid:'||role_oid.oid::text) end
      order by case when role_oid.oid=0 then 'public' else coalesce(r.rolname,'oid:'||role_oid.oid::text) end)
      from unnest(p.polroles) role_oid(oid) left join pg_roles r on r.oid=role_oid.oid),
    'using',regexp_replace(lower(coalesce(pg_get_expr(p.polqual,p.polrelid,false),'')),'[[:space:]]+','','g'),
    'check',regexp_replace(lower(coalesce(pg_get_expr(p.polwithcheck,p.polrelid,false),'')),'[[:space:]]+','','g')
  ) order by c.relname,p.polname) value
  from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in(select name from target_tables)
), legacy_contract as (
  select jsonb_build_object(
    'inventoryMovementsMovementTypeConstraintAbsent',not exists(
      select 1 from pg_constraint con
      where con.conrelid='public.inventory_movements'::regclass
        and con.conname='inventory_movements_movement_type_check'
    )
  ) value
), owner_invariant as (
  select
    (select bool_and(pg_get_userbyid(c.relowner)='postgres'
      and c.relowner=(select relowner from pg_class where oid='public.inventory_movements'::regclass))
      from target_tables t join pg_class c on c.oid=format('public.%I',t.name)::regclass)
    and (select bool_and((value->>'ownerIsPostgres')::boolean and (value->>'ownerMatchesInventoryMovements')::boolean)
      from function_rows) value
), contract as (
  select jsonb_build_object(
    'relations',relations.value,'columns',columns_contract.value,'constraints',constraints_contract.value,
    'indexes',indexes_contract.value,'triggers',triggers_contract.value,'functions',functions_contract.value,
    'policies',policies_contract.value,'legacy',legacy_contract.value
  ) value
  from relations,columns_contract,constraints_contract,indexes_contract,triggers_contract,functions_contract,policies_contract,legacy_contract
), component_hashes as (
  select jsonb_build_object(
    'relations',encode(extensions.digest(convert_to(relations.value::text,'UTF8'),'sha256'),'hex'),
    'columns',encode(extensions.digest(convert_to(columns_contract.value::text,'UTF8'),'sha256'),'hex'),
    'constraints',encode(extensions.digest(convert_to(constraints_contract.value::text,'UTF8'),'sha256'),'hex'),
    'indexes',encode(extensions.digest(convert_to(indexes_contract.value::text,'UTF8'),'sha256'),'hex'),
    'triggers',encode(extensions.digest(convert_to(triggers_contract.value::text,'UTF8'),'sha256'),'hex'),
    'functions',encode(extensions.digest(convert_to(functions_contract.value::text,'UTF8'),'sha256'),'hex'),
    'policies',encode(extensions.digest(convert_to(policies_contract.value::text,'UTF8'),'sha256'),'hex'),
    'legacy',encode(extensions.digest(convert_to(legacy_contract.value::text,'UTF8'),'sha256'),'hex')
  ) value
  from relations,columns_contract,constraints_contract,indexes_contract,triggers_contract,functions_contract,policies_contract,legacy_contract
)
select jsonb_build_object(
  'schemaFingerprint',encode(extensions.digest(convert_to(contract.value::text,'UTF8'),'sha256'),'hex'),
  'components',component_hashes.value,
  'ownerInvariant',owner_invariant.value,
  'serverVersion',current_setting('server_version'),
  'serverMajor',(current_setting('server_version_num')::integer/10000)
) schema_attestation
from contract,component_hashes,owner_invariant;
