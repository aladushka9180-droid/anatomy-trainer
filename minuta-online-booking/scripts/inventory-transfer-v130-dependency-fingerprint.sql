with function_signatures(signature) as (values
  ('public.get_minuta_inventory_role(uuid)'),
  ('public.get_minuta_inventory_workspace(uuid)'),
  ('public.write_minuta_inventory_audit(uuid,text,uuid,jsonb)'),
  ('public.has_organization_role(uuid,text[])')
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
), dependency_contract as (
  select jsonb_agg(jsonb_build_object('signature',signature,'contract',value) order by signature) value from function_rows
)
select jsonb_build_object(
  'dependencyFingerprint',encode(extensions.digest(convert_to(dependency_contract.value::text,'UTF8'),'sha256'),'hex'),
  'ownerInvariant',(select bool_and((value->>'ownerIsPostgres')::boolean and (value->>'ownerMatchesInventoryMovements')::boolean) from function_rows),
  'serverVersion',current_setting('server_version'),
  'serverMajor',(current_setting('server_version_num')::integer/10000)
) dependency_attestation
from dependency_contract;
