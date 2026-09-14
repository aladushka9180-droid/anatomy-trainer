begin transaction isolation level repeatable read read only;
set local search_path=public,extensions,pg_catalog;

with function_contract(signature,access_mode,expected_marker,expected_volatility,expected_security_definer) as (values
  ('public.minuta_provider_schedule_snapshot_v157(public.bookings)','none','minuta_provider_schedule_move_snapshot_v157','i',false),
  ('public.move_minuta_provider_schedule_booking_v157(uuid,uuid,date,time without time zone,uuid,uuid,uuid,date,time without time zone,integer,text)','authenticated','minuta_provider_schedule_move_v157','v',true),
  ('public.get_minuta_provider_schedule_move_v157(uuid)','authenticated','minuta_provider_schedule_move_lookup_v157','s',true),
  ('public.undo_minuta_provider_schedule_booking_v157(uuid,uuid)','authenticated','minuta_provider_schedule_move_undo_v157','v',true)
), function_runtime as (
  select contract.*,procedure_row.oid as procedure_oid,
    case when procedure_row.oid is null then null else encode(extensions.digest(
      convert_to(replace(procedure_row.prosrc,E'\r',''),'UTF8'),'sha256'
    ),'hex') end as source_hash,
    pg_catalog.obj_description(procedure_row.oid,'pg_proc') as marker,
    procedure_row.prosecdef,procedure_row.provolatile,procedure_row.proconfig,
    pg_catalog.pg_get_userbyid(procedure_row.proowner) as owner_name,
    coalesce(has_function_privilege('anon',procedure_row.oid,'EXECUTE'),false) as anon_execute,
    coalesce(has_function_privilege('authenticated',procedure_row.oid,'EXECUTE'),false) as authenticated_execute,
    coalesce(has_function_privilege('service_role',procedure_row.oid,'EXECUTE'),false) as service_execute,
    exists(select 1 from aclexplode(coalesce(
      procedure_row.proacl,acldefault('f',procedure_row.proowner)
    )) grant_row where grant_row.grantee=0 and grant_row.privilege_type='EXECUTE') as public_execute,
    not exists(
      select 1
      from aclexplode(coalesce(procedure_row.proacl,acldefault('f',procedure_row.proowner))) grant_row
      left join pg_catalog.pg_roles role_row on role_row.oid=grant_row.grantee
      where grant_row.grantee<>procedure_row.proowner and (
        grant_row.privilege_type<>'EXECUTE' or grant_row.is_grantable or grant_row.grantee=0
        or coalesce(role_row.rolname,'') not in(
          case when contract.access_mode='authenticated' then 'authenticated' else '' end
        )
      )
    ) as no_unexpected_grants
  from function_contract contract
  left join pg_catalog.pg_proc procedure_row
    on procedure_row.oid=to_regprocedure(contract.signature)
), function_evaluated as (
  select runtime.*,
    runtime.procedure_oid is not null
      and runtime.owner_name='postgres'
      and runtime.prosecdef=runtime.expected_security_definer
      and runtime.provolatile=runtime.expected_volatility
      and runtime.proconfig=array['search_path=""']::text[]
      and runtime.marker=runtime.expected_marker||':sha256='||runtime.source_hash
      and not runtime.anon_execute
      and runtime.authenticated_execute=(runtime.access_mode='authenticated')
      and not runtime.service_execute
      and not runtime.public_execute
      and runtime.no_unexpected_grants as structural_exact
  from function_runtime runtime
), table_runtime as (
  select relation_row.oid as relation_oid,
    case when relation_row.oid is null then null else encode(extensions.digest(convert_to(jsonb_build_object(
      'owner',pg_catalog.pg_get_userbyid(relation_row.relowner),
      'acl',coalesce(relation_row.relacl,'{}'::aclitem[])::text,
      'rls',relation_row.relrowsecurity,
      'force_rls',relation_row.relforcerowsecurity,
      'policies',(select jsonb_agg(jsonb_build_object(
        'name',policy_row.polname,'permissive',policy_row.polpermissive,
        'roles',(select jsonb_agg(pg_catalog.pg_get_userbyid(role_oid) order by pg_catalog.pg_get_userbyid(role_oid))
          from unnest(policy_row.polroles) role_oid),
        'command',policy_row.polcmd,'qual',pg_catalog.pg_get_expr(policy_row.polqual,policy_row.polrelid),
        'with_check',pg_catalog.pg_get_expr(policy_row.polwithcheck,policy_row.polrelid)
      ) order by policy_row.polname) from pg_catalog.pg_policy policy_row where policy_row.polrelid=relation_row.oid),
      'columns',(select jsonb_agg(jsonb_build_object(
        'name',attribute_row.attname,'type',pg_catalog.format_type(attribute_row.atttypid,attribute_row.atttypmod),
        'not_null',attribute_row.attnotnull,'identity',attribute_row.attidentity,
        'default',pg_catalog.pg_get_expr(default_row.adbin,default_row.adrelid)
      ) order by attribute_row.attnum)
        from pg_catalog.pg_attribute attribute_row
        left join pg_catalog.pg_attrdef default_row
          on default_row.adrelid=attribute_row.attrelid and default_row.adnum=attribute_row.attnum
        where attribute_row.attrelid=relation_row.oid and attribute_row.attnum>0 and not attribute_row.attisdropped),
      'constraints',(select jsonb_agg(jsonb_build_object(
        'name',constraint_row.conname,'type',constraint_row.contype,
        'definition',pg_catalog.pg_get_constraintdef(constraint_row.oid,true)
      ) order by constraint_row.conname) from pg_catalog.pg_constraint constraint_row
        where constraint_row.conrelid=relation_row.oid),
      'indexes',(select jsonb_agg(pg_catalog.pg_get_indexdef(index_row.indexrelid) order by index_class.relname)
        from pg_catalog.pg_index index_row join pg_catalog.pg_class index_class on index_class.oid=index_row.indexrelid
        where index_row.indrelid=relation_row.oid),
      'triggers',(select jsonb_agg(pg_catalog.pg_get_triggerdef(trigger_row.oid,true) order by trigger_row.tgname)
        from pg_catalog.pg_trigger trigger_row
        where trigger_row.tgrelid=relation_row.oid and not trigger_row.tgisinternal)
    )::text,'UTF8'),'sha256'),'hex') end as schema_hash,
    pg_catalog.obj_description(relation_row.oid,'pg_class') as marker,
    pg_catalog.pg_get_userbyid(relation_row.relowner) as owner_name,
    relation_row.relrowsecurity as rls_enabled,
    relation_row.relforcerowsecurity as rls_forced,
    coalesce(has_table_privilege('anon',relation_row.oid,'SELECT,INSERT,UPDATE,DELETE'),false) as anon_dml,
    coalesce(has_table_privilege('authenticated',relation_row.oid,'SELECT,INSERT,UPDATE,DELETE'),false) as authenticated_dml,
    coalesce(has_table_privilege('service_role',relation_row.oid,'SELECT,INSERT,UPDATE,DELETE'),false) as service_dml
  from (select to_regclass('public.provider_schedule_moves_v157') as oid) target
  left join pg_catalog.pg_class relation_row on relation_row.oid=target.oid
), table_evaluated as (
  select runtime.*,
    runtime.relation_oid is not null
      and runtime.owner_name='postgres'
      and runtime.rls_enabled and runtime.rls_forced
      and not runtime.anon_dml and not runtime.authenticated_dml and runtime.service_dml
      and runtime.marker='minuta_provider_schedule_move_v157:sha256='||runtime.schema_hash as structural_exact
  from table_runtime runtime
), summary as (
  select
    (select count(*) from function_evaluated where procedure_oid is not null)
      +(select case when relation_oid is null then 0 else 1 end from table_evaluated) as present_count,
    coalesce((select bool_and(structural_exact) from function_evaluated),false) as functions_exact,
    coalesce((select structural_exact from table_evaluated),false) as table_exact
)
select json_build_object(
  'classification',case
    when summary.present_count=0 then 'absent'
    when summary.present_count=5 and summary.functions_exact and summary.table_exact then 'exact'
    else 'partial-or-newer'
  end,
  'presentCount',summary.present_count,
  'expectedPresentCount',5,
  'exact',summary.present_count=5 and summary.functions_exact and summary.table_exact,
  'allFunctionsStructurallyExact',summary.functions_exact,
  'tableStructurallyExact',summary.table_exact,
  'functions',(select jsonb_agg(jsonb_build_object(
    'signature',signature,'sourceHash',source_hash,'access',access_mode,
    'marker',marker,'structuralExact',structural_exact
  ) order by signature) from function_evaluated),
  'table',(select jsonb_build_object(
    'name','public.provider_schedule_moves_v157','schemaHash',schema_hash,
    'marker',marker,'structuralExact',structural_exact
  ) from table_evaluated),
  'tableDataRead',false
) from summary;

rollback;
