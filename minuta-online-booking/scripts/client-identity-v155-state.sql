begin transaction isolation level repeatable read read only;

with function_contract(signature,access_mode,expected_marker,version_object) as (values
  ('public.assign_booking_client_account()','service','minuta_client_identity_binding_v155',false),
  ('public.bootstrap_client_access(uuid,text)','public','minuta_client_identity_v155',false),
  ('public.book_minuta_appointment_with_benefit_v115(uuid,text,uuid,uuid,date,time without time zone,text,text,text)','public','minuta_client_identity_v155',false),
  ('public.restore_client_session(text)','public','minuta_client_identity_v155',false),
  ('public.get_client_bookings_v3(text)','public','minuta_client_identity_v155',false),
  ('public.submit_booking_review(text,uuid,integer,text)','public','minuta_client_identity_v155',false),
  ('public.revoke_client_session(text)','public','minuta_client_identity_v155',false),
  ('public.rotate_client_access_code(text)','public','minuta_client_identity_v155',false),
  ('public.protect_client_identity_immutable_v155()','none','minuta_client_identity_v155',true),
  ('public.resolve_client_identity_session_v155(text)','none','minuta_client_identity_v155',true),
  ('public.claim_client_booking_identity_v155(uuid,text)','public','minuta_client_identity_v155',true),
  ('public.upgrade_legacy_client_identity_session_v155(text,text,text)','public','minuta_client_identity_v155',true),
  ('public.issue_client_identity_claim_grant_v155(uuid,uuid,uuid,integer,uuid)','staff-service','minuta_client_identity_v155',true),
  ('public.issue_client_identity_sale_claim_v155(uuid,uuid,uuid,integer,uuid,text)','staff-service','minuta_client_identity_v155',true),
  ('public.inspect_client_identity_sale_claim_v155(text,uuid)','service','minuta_client_identity_v155',true),
  ('public.consume_client_identity_sale_claim_v155(text,text,uuid)','public','minuta_client_identity_v155',true),
  ('public.promote_client_identity_v155(text,text)','public','minuta_client_identity_v155',true),
  ('public.begin_client_identity_transfer_v155(text,text)','public','minuta_client_identity_v155',true),
  ('public.approve_client_identity_transfer_v155(text,text,text)','public','minuta_client_identity_v155',true),
  ('public.consume_client_identity_transfer_v155(text,text,text)','public','minuta_client_identity_v155',true),
  ('public.revoke_client_identity_session_v155(text)','public','minuta_client_identity_v155',true),
  ('public.get_client_identity_context_v155(text)','public','minuta_client_identity_v155',true),
  ('public.get_client_commerce_v155(text)','public','minuta_client_identity_v155',true),
  ('public.reserve_client_benefit_v155(uuid,uuid,uuid,uuid,integer,integer)','none','minuta_client_identity_v155',true),
  ('public.book_client_with_benefit_v155(text,uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer,text,integer,integer)','service','minuta_client_identity_v155',true),
  ('public.bump_client_benefit_version_v155()','none','minuta_client_identity_v155',true)
), function_runtime as (
  select contract.*,
    procedure_row.oid as procedure_oid,
    case when procedure_row.oid is null then null else encode(extensions.digest(
      convert_to(replace(procedure_row.prosrc,E'\r',''),'UTF8'),'sha256'
    ),'hex') end as source_hash,
    case when procedure_row.oid is null then null else encode(extensions.digest(convert_to(jsonb_build_object(
      'source',procedure_row.prosrc,
      'kind',procedure_row.prokind,
      'language',language_row.lanname,
      'owner',pg_catalog.pg_get_userbyid(procedure_row.proowner),
      'volatility',procedure_row.provolatile,
      'security_definer',procedure_row.prosecdef,
      'strict',procedure_row.proisstrict,
      'leakproof',procedure_row.proleakproof,
      'parallel',procedure_row.proparallel,
      'result',pg_catalog.pg_get_function_result(procedure_row.oid),
      'arguments',pg_catalog.pg_get_function_arguments(procedure_row.oid),
      'identity_arguments',pg_catalog.pg_get_function_identity_arguments(procedure_row.oid),
      'config',coalesce(to_jsonb(procedure_row.proconfig),'null'::jsonb),
      'acl',coalesce((select jsonb_agg(jsonb_build_object(
        'grantor',pg_catalog.pg_get_userbyid(grant_row.grantor),
        'grantee',case when grant_row.grantee=0 then 'PUBLIC'
          when grant_row.grantee=procedure_row.proowner then 'owner'
          else coalesce(role_row.rolname,'oid:'||grant_row.grantee::text) end,
        'privilege',grant_row.privilege_type,
        'grantable',grant_row.is_grantable
      ) order by pg_catalog.pg_get_userbyid(grant_row.grantor),
        case when grant_row.grantee=0 then 'PUBLIC'
          when grant_row.grantee=procedure_row.proowner then 'owner'
          else coalesce(role_row.rolname,'oid:'||grant_row.grantee::text) end,
        grant_row.privilege_type,grant_row.is_grantable)
        from aclexplode(coalesce(procedure_row.proacl,acldefault('f',procedure_row.proowner))) grant_row
        left join pg_catalog.pg_roles role_row on role_row.oid=grant_row.grantee),'[]'::jsonb)
    )::text,'UTF8'),'sha256'),'hex') end as contract_hash,
    pg_catalog.obj_description(procedure_row.oid,'pg_proc') as marker,
    procedure_row.prosecdef,
    procedure_row.provolatile,
    procedure_row.proconfig,
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
          case when contract.access_mode='public' then 'anon'
               when contract.access_mode in('staff','staff-service') then 'authenticated'
               when contract.access_mode='service' then 'service_role'
               else '' end,
          case when contract.access_mode='public' then 'authenticated'
               when contract.access_mode='staff-service' then 'service_role' else '' end
        )
      )
    ) as no_unexpected_grants
  from function_contract contract
  left join pg_catalog.pg_proc procedure_row
    on procedure_row.oid=to_regprocedure(contract.signature)
  left join pg_catalog.pg_language language_row on language_row.oid=procedure_row.prolang
), function_evaluated as (
  select runtime.*,
    runtime.procedure_oid is not null
      and runtime.owner_name='postgres'
      and runtime.prosecdef
      and runtime.provolatile='v'
      and runtime.proconfig=array['search_path=""']::text[]
      and runtime.marker=runtime.expected_marker
      and runtime.anon_execute=(runtime.access_mode='public')
      and runtime.authenticated_execute=(runtime.access_mode in('public','staff','staff-service'))
      and runtime.service_execute=(runtime.access_mode in('service','staff-service'))
      and not runtime.public_execute
      and runtime.no_unexpected_grants as structural_exact
  from function_runtime runtime
), table_contract(table_name) as (values
  ('public.client_identity_audit_v155'),
  ('public.client_identity_booking_requests_v155'),
  ('public.client_identity_claim_grants_v155'),
  ('public.client_identity_sessions_v155'),
  ('public.client_identity_transfers_v155')
), table_runtime as (
  select contract.table_name,relation_row.oid as relation_oid,
    case when relation_row.oid is null then null else encode(extensions.digest(convert_to(jsonb_build_object(
      'owner',pg_catalog.pg_get_userbyid(relation_row.relowner),
      'acl',coalesce(relation_row.relacl,'{}'::aclitem[])::text,
      'rls',relation_row.relrowsecurity,
      'force_rls',relation_row.relforcerowsecurity,
      'policies',(select jsonb_agg(jsonb_build_object(
        'name',policy_row.polname,'permissive',policy_row.polpermissive,
        'roles',(select jsonb_agg(pg_catalog.pg_get_userbyid(role_oid) order by pg_catalog.pg_get_userbyid(role_oid))
          from unnest(policy_row.polroles) role_oid),
        'command',policy_row.polcmd,
        'qual',pg_catalog.pg_get_expr(policy_row.polqual,policy_row.polrelid),
        'with_check',pg_catalog.pg_get_expr(policy_row.polwithcheck,policy_row.polrelid)
      ) order by policy_row.polname) from pg_catalog.pg_policy policy_row where policy_row.polrelid=relation_row.oid),
      'columns',(select jsonb_agg(jsonb_build_object(
        'name',attribute_row.attname,
        'type',pg_catalog.format_type(attribute_row.atttypid,attribute_row.atttypmod),
        'not_null',attribute_row.attnotnull,
        'identity',attribute_row.attidentity,
        'default',pg_catalog.pg_get_expr(default_row.adbin,default_row.adrelid)
      ) order by attribute_row.attnum)
        from pg_catalog.pg_attribute attribute_row
        left join pg_catalog.pg_attrdef default_row
          on default_row.adrelid=attribute_row.attrelid and default_row.adnum=attribute_row.attnum
        where attribute_row.attrelid=relation_row.oid and attribute_row.attnum>0 and not attribute_row.attisdropped),
      'constraints',(select jsonb_agg(jsonb_build_object(
        'name',constraint_row.conname,
        'type',constraint_row.contype,
        'definition',pg_catalog.pg_get_constraintdef(constraint_row.oid,true)
      ) order by constraint_row.conname) from pg_catalog.pg_constraint constraint_row
        where constraint_row.conrelid=relation_row.oid),
      'indexes',(select jsonb_agg(pg_catalog.pg_get_indexdef(index_row.indexrelid) order by index_class.relname)
        from pg_catalog.pg_index index_row
        join pg_catalog.pg_class index_class on index_class.oid=index_row.indexrelid
        where index_row.indrelid=relation_row.oid),
      'triggers',(select jsonb_agg(pg_catalog.pg_get_triggerdef(trigger_row.oid,true) order by trigger_row.tgname)
        from pg_catalog.pg_trigger trigger_row
        where trigger_row.tgrelid=relation_row.oid and not trigger_row.tgisinternal)
    )::text,'UTF8'),'sha256'),'hex') end as schema_hash,
    pg_catalog.obj_description(relation_row.oid,'pg_class') as marker,
    pg_catalog.pg_get_userbyid(relation_row.relowner) as owner_name,
    relation_row.relrowsecurity as rls_enabled,
    coalesce(has_table_privilege('anon',relation_row.oid,'SELECT,INSERT,UPDATE,DELETE'),false) as anon_dml,
    coalesce(has_table_privilege('authenticated',relation_row.oid,'SELECT,INSERT,UPDATE,DELETE'),false) as authenticated_dml,
    coalesce(has_table_privilege('service_role',relation_row.oid,'SELECT,INSERT,UPDATE,DELETE'),false) as service_dml
  from table_contract contract
  left join pg_catalog.pg_class relation_row on relation_row.oid=to_regclass(contract.table_name)
), table_evaluated as (
  select runtime.*,
    runtime.relation_oid is not null
      and runtime.owner_name='postgres'
      and runtime.rls_enabled
      and not runtime.anon_dml
      and not runtime.authenticated_dml
      and not runtime.service_dml
      and runtime.marker='minuta_client_identity_v155:sha256='||runtime.schema_hash as structural_exact
  from table_runtime runtime
), benefit_contract as (
  select exists(
      select 1 from pg_catalog.pg_attribute attribute_row
      join pg_catalog.pg_attrdef default_row
        on default_row.adrelid=attribute_row.attrelid and default_row.adnum=attribute_row.attnum
      where attribute_row.attrelid='public.client_benefit_instruments'::regclass
        and attribute_row.attname='client_version'
        and attribute_row.atttypid='integer'::regtype
        and attribute_row.attnotnull
        and attribute_row.attnum>0 and not attribute_row.attisdropped
        and pg_catalog.pg_get_expr(default_row.adbin,default_row.adrelid)='1'
    ) and exists(
      select 1 from pg_catalog.pg_constraint constraint_row
      where constraint_row.conrelid='public.client_benefit_instruments'::regclass
        and constraint_row.conname='client_benefit_instruments_client_version_v155_check'
        and pg_catalog.pg_get_constraintdef(constraint_row.oid,true)='CHECK (client_version >= 1 AND client_version <= 2147483647)'
    ) and exists(
      select 1 from pg_catalog.pg_trigger trigger_row
      where trigger_row.tgrelid='public.client_benefit_instruments'::regclass
        and trigger_row.tgname='client_benefit_instruments_version_v155'
        and not trigger_row.tgisinternal
        and trigger_row.tgfoid=to_regprocedure('public.bump_client_benefit_version_v155()')
        and trigger_row.tgenabled='O' and trigger_row.tgtype=19
    ) as exact,
    exists(
      select 1 from pg_catalog.pg_attribute attribute_row
      where attribute_row.attrelid='public.client_benefit_instruments'::regclass
        and attribute_row.attname='client_version'
        and attribute_row.attnum>0 and not attribute_row.attisdropped
    ) as present
), summary as (
  select
    (select count(*) from function_evaluated where version_object and procedure_oid is not null)
      +(select count(*) from table_evaluated where relation_oid is not null)
      +(select case when present then 1 else 0 end from benefit_contract) as present_count,
    (select bool_and(structural_exact) from function_evaluated) as functions_exact,
    (select bool_and(structural_exact) from table_evaluated) as tables_exact,
    (select exact from benefit_contract) as benefit_exact
)
select json_build_object(
  'classification',case
    when summary.present_count=0 then 'absent'
    when summary.present_count=24 and summary.functions_exact and summary.tables_exact and summary.benefit_exact then 'exact'
    else 'partial-or-newer'
  end,
  'presentCount',summary.present_count,
  'expectedPresentCount',24,
  'exact',summary.present_count=24 and summary.functions_exact and summary.tables_exact and summary.benefit_exact,
  'allFunctionsStructurallyExact',summary.functions_exact,
  'allTablesExact',summary.tables_exact,
  'benefitVersionExact',summary.benefit_exact,
  'functions',(select jsonb_agg(jsonb_build_object(
    'signature',signature,
    'sourceHash',source_hash,
    'contractHash',contract_hash,
    'access',access_mode,
    'marker',marker,
    'structuralExact',structural_exact
  ) order by signature) from function_evaluated),
  'tables',(select jsonb_agg(jsonb_build_object(
    'name',table_name,
    'schemaHash',schema_hash,
    'marker',marker,
    'structuralExact',structural_exact
  ) order by table_name) from table_evaluated)
) from summary;

rollback;
