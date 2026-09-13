-- v154 rollback: remove only the exact stamped lookup and its dedicated credential row.
-- No booking or other business row is changed.
begin;
set local lock_timeout='10s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $rollback_guard$
declare
  v_proc regprocedure:=to_regprocedure(
    'public.lookup_primetime_booking_request_v154(uuid)'
  );
  v_source_hash text;
  v_contract_hash text;
  v_marker text;
begin
  if exists(
    select 1 from pg_catalog.pg_proc procedure_row
    join pg_catalog.pg_namespace namespace_row on namespace_row.oid=procedure_row.pronamespace
    where namespace_row.nspname='public'
      and procedure_row.proname='lookup_primetime_booking_request_v154'
      and procedure_row.oid is distinct from v_proc
  ) then
    raise exception using errcode='55000',message='v154_rollback_blocked_partial_or_newer_objects';
  end if;
  if v_proc is null then return; end if;

  select encode(extensions.digest(convert_to(replace(procedure_row.prosrc,E'\r',''),'UTF8'),'sha256'),'hex'),
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
    )::text,'UTF8'),'sha256'),'hex'),
    obj_description(procedure_row.oid,'pg_proc')
  into v_source_hash,v_contract_hash,v_marker
  from pg_catalog.pg_proc procedure_row
  join pg_catalog.pg_language language_row on language_row.oid=procedure_row.prolang
  where procedure_row.oid=v_proc;

  if v_source_hash is distinct from 'a0b2f93d58d65a749022a80d35d2cc766fe24419d6efe4fd5e804e0244157db4'
     or v_marker is distinct from 'minuta_booking_lookup_v154:sha256='||v_contract_hash then
    raise exception using errcode='55000',message='v154_rollback_blocked_newer_function_definition';
  end if;
end
$rollback_guard$;

drop function if exists public.lookup_primetime_booking_request_v154(uuid);
delete from public.primetime_server_credentials
where credential_key='booking_lookup_v154';
notify pgrst,'reload schema';
commit;
