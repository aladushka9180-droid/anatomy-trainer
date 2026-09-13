begin transaction isolation level repeatable read read only;

with resolved as (
  select to_regprocedure(
    'public.lookup_primetime_booking_request_v154(uuid)'
  ) as procedure_oid
), contract as (
  select resolved.procedure_oid,
    case when procedure_row.oid is null then null else
      encode(extensions.digest(
        convert_to(replace(procedure_row.prosrc,E'\r',''),'UTF8'),'sha256'
      ),'hex')
    end as source_hash,
    case when procedure_row.oid is null then null else
      encode(extensions.digest(convert_to(jsonb_build_object(
        'source',procedure_row.prosrc,'kind',procedure_row.prokind,'language',language_row.lanname,
        'owner',pg_get_userbyid(procedure_row.proowner),
        'volatility',procedure_row.provolatile,'security_definer',procedure_row.prosecdef,
        'strict',procedure_row.proisstrict,'leakproof',procedure_row.proleakproof,
        'parallel',procedure_row.proparallel,'result',pg_get_function_result(procedure_row.oid),
        'arguments',pg_get_function_arguments(procedure_row.oid),
        'identity_arguments',pg_get_function_identity_arguments(procedure_row.oid),
        'config',coalesce(to_jsonb(procedure_row.proconfig),'null'::jsonb),
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
      )::text,'UTF8'),'sha256'),'hex')
    end as contract_hash,
    obj_description(procedure_row.oid,'pg_proc') as marker,
    procedure_row.prosecdef,
    procedure_row.provolatile,
    procedure_row.proconfig,
    pg_get_userbyid(procedure_row.proowner) as owner_name,
    exists(
      select 1
      from aclexplode(coalesce(
        procedure_row.proacl,acldefault('f',procedure_row.proowner)
      )) grant_row
      where grant_row.grantee=0 and grant_row.privilege_type='EXECUTE'
    ) as public_execute
  from resolved
  left join pg_catalog.pg_proc procedure_row on procedure_row.oid=resolved.procedure_oid
  left join pg_catalog.pg_language language_row on language_row.oid=procedure_row.prolang
), evaluated as (
  select contract.*,
    contract.procedure_oid is not null
      and contract.owner_name='postgres'
      and contract.prosecdef
      and contract.provolatile='s'
      and contract.proconfig=array['search_path=""']::text[]
      and contract.marker='minuta_booking_lookup_v154:sha256='||contract.contract_hash
      and has_function_privilege('anon',contract.procedure_oid,'execute')
      and not has_function_privilege('authenticated',contract.procedure_oid,'execute')
      and not has_function_privilege('service_role',contract.procedure_oid,'execute')
      and not contract.public_execute as runtime_exact
  from contract
)
select json_build_object(
  'classification',case
    when procedure_oid is null then 'absent'
    when runtime_exact then 'exact'
    else 'partial-or-newer'
  end,
  'present',procedure_oid is not null,
  'exact',coalesce(runtime_exact,false),
  'sourceHash',source_hash,
  'contractHash',contract_hash,
  'marker',marker,
  'owner',owner_name,
  'credentialConfigured',exists(
    select 1 from public.primetime_server_credentials credential
    where credential.credential_key='booking_lookup_v154'
      and credential.active
      and credential.secret_sha256~'^[0-9a-f]{64}$'
  )
) from evaluated;

rollback;
