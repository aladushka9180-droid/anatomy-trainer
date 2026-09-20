with state as (
  select
    to_regclass('public.public_multi_service_routes_v167') as routes,
    to_regclass('public.public_multi_service_route_items_v167') as items,
    to_regprocedure('public.book_minuta_multi_service_route_v167(uuid,text,uuid,text,text,jsonb)') as create_route
), facts as (
  select *,case
    when routes is null and items is null and create_route is null then 'absent'
    when routes is not null and items is not null and create_route is null then 'disabled'
    when routes is not null and items is not null and create_route is not null
      and obj_description(create_route,'pg_proc')='minuta:v167:public-multi-service-route:enabled' then 'exact'
    else 'partial'
  end classification from state
)
select json_build_object(
  'classification',classification,
  'structuralExact',classification in ('absent','disabled','exact'),
  'routesPresent',routes is not null,
  'itemsPresent',items is not null,
  'functionPresent',create_route is not null,
  'anonExecute',case when create_route is null then false else has_function_privilege('anon',create_route,'execute') end,
  'authenticatedExecute',case when create_route is null then false else has_function_privilege('authenticated',create_route,'execute') end,
  'serviceRoleExecute',case when create_route is null then false else has_function_privilege('service_role',create_route,'execute') end,
  'publicExecute',case when create_route is null then false else exists(
    select 1 from pg_catalog.pg_proc procedure_row,
      lateral aclexplode(coalesce(procedure_row.proacl,acldefault('f',procedure_row.proowner))) grant_row
    where procedure_row.oid=create_route and grant_row.grantee=0 and grant_row.privilege_type='EXECUTE'
  ) end
) from facts;
