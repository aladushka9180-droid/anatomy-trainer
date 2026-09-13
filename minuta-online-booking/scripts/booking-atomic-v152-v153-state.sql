begin transaction isolation level repeatable read read only;

with expected(layer,signature,marker_prefix,execute_role,denied_roles) as (
  values
    (
      'v152',
      'public.recover_primetime_booking_request_v1(uuid,uuid,uuid,uuid,date,time without time zone,text,text)',
      'minuta_booking_recovery_v152:sha256=',
      'service_role',
      array['PUBLIC','anon','authenticated']::text[]
    ),
    (
      'v153',
      'public.book_minuta_appointment_v2(uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer)',
      'minuta_atomic_create_v153:sha256=',
      'anon,authenticated',
      array['PUBLIC','service_role']::text[]
    )
), resolved as (
  select expected.*,to_regprocedure(expected.signature) as procedure_oid
  from expected
), contracts as (
  select resolved.*,
    procedure_row.prosrc,
    case when procedure_row.oid is null then null else
      encode(extensions.digest(convert_to(replace(procedure_row.prosrc,E'\r',''),'UTF8'),'sha256'),'hex')
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
    procedure_row.proconfig,
    pg_get_userbyid(procedure_row.proowner) as owner_name,
    exists(select 1
      from aclexplode(coalesce(procedure_row.proacl,acldefault('f',procedure_row.proowner))) grant_row
      where grant_row.grantee=0 and grant_row.privilege_type='EXECUTE') as public_execute
  from resolved
  left join pg_catalog.pg_proc procedure_row on procedure_row.oid=resolved.procedure_oid
  left join pg_catalog.pg_language language_row on language_row.oid=procedure_row.prolang
), evaluated as (
  select contracts.*,
    case contracts.layer
      when 'v152' then
        has_function_privilege('service_role',contracts.procedure_oid,'execute')
        and not has_function_privilege('anon',contracts.procedure_oid,'execute')
        and not has_function_privilege('authenticated',contracts.procedure_oid,'execute')
        and not contracts.public_execute
      when 'v153' then
        has_function_privilege('anon',contracts.procedure_oid,'execute')
        and has_function_privilege('authenticated',contracts.procedure_oid,'execute')
        and not has_function_privilege('service_role',contracts.procedure_oid,'execute')
        and not contracts.public_execute
      else false
    end as acl_exact,
    contracts.procedure_oid is not null
      and contracts.owner_name='postgres'
      and contracts.prosecdef
      and contracts.proconfig=array['search_path=""']::text[]
      and contracts.marker=contracts.marker_prefix||contracts.contract_hash as runtime_exact
  from contracts
), summary as (
  select
    count(*) filter(where procedure_oid is not null) as present_count,
    bool_and(coalesce(runtime_exact and acl_exact,false)) filter(where procedure_oid is not null) as present_exact,
    bool_or(layer='v152' and procedure_oid is not null and runtime_exact and acl_exact) as v152_exact,
    bool_or(layer='v153' and procedure_oid is not null and runtime_exact and acl_exact) as v153_exact,
    bool_or(layer='v152' and procedure_oid is not null) as v152_present,
    bool_or(layer='v153' and procedure_oid is not null) as v153_present,
    jsonb_object_agg(layer,jsonb_build_object(
      'present',procedure_oid is not null,
      'exact',coalesce(runtime_exact and acl_exact,false),
      'sourceHash',source_hash,
      'contractHash',contract_hash,
      'marker',marker,
      'owner',owner_name,
      'aclExact',coalesce(acl_exact,false)
    ) order by layer) as layers
  from evaluated
)
select json_build_object(
  'classification',case
    when present_count=0 then 'absent'
    when present_count=2 and present_exact then 'exact'
    when v152_present and v152_exact and not v153_present then 'v152-only-exact'
    else 'partial-or-newer'
  end,
  'presentCount',present_count,
  'exact',present_count=2 and present_exact,
  'layers',layers
) from summary;

rollback;
