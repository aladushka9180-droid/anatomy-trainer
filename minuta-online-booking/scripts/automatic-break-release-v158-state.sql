begin transaction isolation level repeatable read read only;
set local search_path=public,extensions,pg_catalog;

with function_contract(signature,access_mode,expected_marker,expected_volatility,expected_security_definer,is_new,baseline_hash) as (values
  ('public.minuta_booking_buffer_source_snapshot_v158(public.bookings,integer)','none','minuta_booking_buffer_source_snapshot_v158','i',false,true,null),
  ('public.minuta_booking_buffer_allows_interval_v158(uuid,date,time without time zone,integer,uuid)','none','minuta_booking_buffer_allows_interval_v158','s',true,true,null),
  ('public.get_minuta_provider_automatic_breaks_v158(date)','authenticated','minuta_provider_automatic_breaks_v158','s',true,true,null),
  ('public.release_minuta_provider_automatic_break_v158(uuid,date,time without time zone,time without time zone,text)','authenticated','minuta_provider_automatic_break_release_v158','v',true,true,null),
  ('public.minuta_slot_respects_booking_buffer(uuid,date,time without time zone,integer,uuid)','none','minuta_slot_respects_booking_buffer_v158','s',true,false,'177d9a40df6aea9ea27612015ea20c8c6afbaf07afd4683122b2578b9550aa74'),
  ('public.enforce_minuta_booking_buffer_v101()','none','enforce_minuta_booking_buffer_v158','v',true,false,'cad2aa619a3195c818d2263f3d28b98c9c0f62bb026378ebde1ddd7de33d6df8')
), function_runtime as (
  select contract.*,proc.oid,
    case when proc.oid is null then null else encode(extensions.digest(convert_to(replace(proc.prosrc,E'\r',''),'UTF8'),'sha256'),'hex') end source_hash,
    pg_catalog.obj_description(proc.oid,'pg_proc') marker,proc.prosecdef,proc.provolatile,proc.proconfig,
    pg_catalog.pg_get_userbyid(proc.proowner) owner_name,
    coalesce(has_function_privilege('anon',proc.oid,'EXECUTE'),false) anon_execute,
    coalesce(has_function_privilege('authenticated',proc.oid,'EXECUTE'),false) authenticated_execute,
    coalesce(has_function_privilege('service_role',proc.oid,'EXECUTE'),false) service_execute,
    exists(select 1 from aclexplode(coalesce(proc.proacl,acldefault('f',proc.proowner))) acl where acl.grantee=0 and acl.privilege_type='EXECUTE') public_execute
  from function_contract contract left join pg_catalog.pg_proc proc on proc.oid=to_regprocedure(contract.signature)
), function_evaluated as (
  select runtime.*,(runtime.oid is not null and runtime.owner_name='postgres'
    and runtime.prosecdef=runtime.expected_security_definer and runtime.provolatile=runtime.expected_volatility
    and runtime.proconfig=array['search_path=""']::text[]
    and runtime.marker=runtime.expected_marker||':sha256='||runtime.source_hash
    and not runtime.anon_execute and runtime.authenticated_execute=(runtime.access_mode='authenticated')
    and not runtime.service_execute and not runtime.public_execute) structural_exact
  from function_runtime runtime
), table_contract(name) as (values
  ('public.booking_buffer_release_requests_v158'),('public.booking_buffer_release_sources_v158')
), table_runtime as (
  select contract.name,relation.oid,
    case when relation.oid is null then null else encode(extensions.digest(convert_to(jsonb_build_object(
      'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attnum)
        from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=relation.oid and a.attnum>0 and not a.attisdropped),
      'constraints',(select jsonb_agg(pg_get_constraintdef(c.oid,true) order by c.conname) from pg_constraint c where c.conrelid=relation.oid),
      'indexes',(select jsonb_agg(pg_get_indexdef(i.indexrelid) order by i.indexrelid) from pg_index i where i.indrelid=relation.oid)
    )::text,'UTF8'),'sha256'),'hex') end schema_hash,
    pg_catalog.obj_description(relation.oid,'pg_class') marker,
    pg_catalog.pg_get_userbyid(relation.relowner) owner_name,relation.relrowsecurity rls_enabled,relation.relforcerowsecurity rls_forced,
    coalesce(has_table_privilege('anon',relation.oid,'SELECT,INSERT,UPDATE,DELETE'),false) anon_dml,
    coalesce(has_table_privilege('authenticated',relation.oid,'SELECT,INSERT,UPDATE,DELETE'),false) authenticated_dml,
    coalesce(has_table_privilege('service_role',relation.oid,'SELECT,INSERT,UPDATE,DELETE'),false) service_dml
  from table_contract contract left join pg_catalog.pg_class relation on relation.oid=to_regclass(contract.name)
), table_evaluated as (
  select runtime.*,(runtime.oid is not null and runtime.owner_name='postgres' and runtime.rls_enabled and runtime.rls_forced
    and not runtime.anon_dml and not runtime.authenticated_dml and runtime.service_dml
    and runtime.marker='minuta_booking_buffer_release_v158:sha256='||runtime.schema_hash) structural_exact
  from table_runtime runtime
), trigger_state as (
  select exists(
    select 1 from pg_catalog.pg_trigger trigger
    where trigger.tgrelid='public.bookings'::regclass and trigger.tgname='zz_bookings_buffer_v101'
      and not trigger.tgisinternal and trigger.tgfoid=to_regprocedure('public.enforce_minuta_booking_buffer_v101()')
      and trigger.tgtype=23 and trigger.tgenabled='O'
  ) exact
), summary as (
  select (select count(*) from function_evaluated where is_new and oid is not null)+(select count(*) from table_evaluated where oid is not null) present_count,
    coalesce((select bool_and(structural_exact) from function_evaluated),false) functions_exact,
    coalesce((select bool_and(structural_exact) from table_evaluated),false) tables_exact,
    (select exact from trigger_state) trigger_exact,
    coalesce((select bool_and(source_hash=baseline_hash and marker is null) from function_evaluated where not is_new),false) baseline_exact
)
select json_build_object(
  'classification',case when present_count=0 and baseline_exact and trigger_exact then 'absent'
    when present_count=6 and functions_exact and tables_exact and trigger_exact then 'exact' else 'partial-or-newer' end,
  'presentCount',present_count,'expectedPresentCount',6,
  'baselineExact',baseline_exact,
  'exact',present_count=6 and functions_exact and tables_exact and trigger_exact,
  'triggerExact',trigger_exact,
  'functions',(select jsonb_agg(jsonb_build_object('signature',signature,'sourceHash',source_hash,'access',access_mode,'marker',marker,'structuralExact',structural_exact) order by signature) from function_evaluated),
  'tables',(select jsonb_agg(jsonb_build_object('name',name,'schemaHash',schema_hash,'marker',marker,'structuralExact',structural_exact) order by name) from table_evaluated),
  'tableDataRead',false
) from summary;

rollback;
