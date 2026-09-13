with function_state as (
  select
    procedure_row.oid,
    md5(replace(procedure_row.prosrc,E'\r','')) as source_md5,
    encode(extensions.digest(convert_to(replace(procedure_row.prosrc,E'\r',''),'UTF8'),'sha256'),'hex') as source_sha256,
    pg_catalog.obj_description(procedure_row.oid,'pg_proc') as marker,
    procedure_row.prosecdef,
    procedure_row.provolatile,
    procedure_row.proconfig,
    pg_catalog.pg_get_userbyid(procedure_row.proowner) as owner_name,
    pg_catalog.pg_get_function_result(procedure_row.oid) as result_type,
    exists(
      select 1 from aclexplode(coalesce(procedure_row.proacl,acldefault('f',procedure_row.proowner))) grant_row
      where grant_row.grantee=0 and grant_row.privilege_type='EXECUTE'
    ) as public_execute
  from pg_catalog.pg_proc procedure_row
  where procedure_row.oid=to_regprocedure('public.save_booking_session(uuid,jsonb)')
), classified as (
  select *,
    case
      when source_md5='eb5201919de3d76b3ebeae3d3488ab7a'
        and marker is null then 'legacy'
      when source_sha256='20e00faa310cf9b115b9fb1c2163e306537f8c4998869e6a4a1608c34e25e68a'
        and marker='minuta_session_service_change_v156:sha256='||source_sha256 then 'exact'
      else 'drift'
    end as classification
  from function_state
)
select json_build_object(
  'classification',coalesce((select classification from classified),'absent'),
  'sourceMd5',(select source_md5 from classified),
  'sourceSha256',(select source_sha256 from classified),
  'marker',(select marker from classified),
  'structuralExact',coalesce((select
    prosecdef and provolatile='v' and proconfig=array['search_path=""']::text[]
    and owner_name='postgres'
    and result_type='TABLE(total_price_rub integer, total_duration_minutes integer)'
    and not public_execute
    and not has_function_privilege('anon','public.save_booking_session(uuid,jsonb)','EXECUTE')
    and has_function_privilege('authenticated','public.save_booking_session(uuid,jsonb)','EXECUTE')
    and not has_function_privilege('service_role','public.save_booking_session(uuid,jsonb)','EXECUTE')
  from classified),false)
);
