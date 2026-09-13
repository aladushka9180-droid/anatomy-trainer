-- v154: least-privilege PrimeTime lookup for an ambiguous committed create.
-- The caller proves possession of a dedicated server credential in the request header.
-- This migration never provisions the credential and never changes booking data.
begin;
set local lock_timeout='10s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $dependency_guard$
begin
  if to_regclass('public.bookings') is null
     or to_regclass('public.primetime_server_credentials') is null
     or to_regprocedure('public.book_minuta_appointment_v2(uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer)') is null
     or to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception using errcode='55000',message='v154_lookup_prerequisites_missing';
  end if;

  if exists(
    select 1
    from (values
      ('booking_code','text',true),
      ('manage_token','uuid',true),
      ('request_id','uuid',false),
      ('service_id','uuid',true),
      ('booking_date','date',true),
      ('booking_time','time without time zone',true),
      ('duration_minutes','integer',true),
      ('original_price_rub','integer',false),
      ('total_price_rub','integer',false),
      ('status','text',true)
    ) expected(column_name,type_name,not_null)
    left join pg_catalog.pg_attribute attribute_row
      on attribute_row.attrelid='public.bookings'::regclass
     and attribute_row.attname=expected.column_name
     and attribute_row.attnum>0
     and not attribute_row.attisdropped
    where attribute_row.attnum is null
       or attribute_row.atttypid is distinct from to_regtype(expected.type_name)
       or attribute_row.attnotnull is distinct from expected.not_null
  ) then
    raise exception using errcode='55000',message='v154_booking_schema_drift';
  end if;

  if exists(
    select 1
    from (values
      ('credential_key','text',true),
      ('secret_sha256','text',true),
      ('active','boolean',true),
      ('created_at','timestamp with time zone',true)
    ) expected(column_name,type_name,not_null)
    left join pg_catalog.pg_attribute attribute_row
      on attribute_row.attrelid='public.primetime_server_credentials'::regclass
     and attribute_row.attname=expected.column_name
     and attribute_row.attnum>0
     and not attribute_row.attisdropped
    where attribute_row.attnum is null
       or attribute_row.atttypid is distinct from to_regtype(expected.type_name)
       or attribute_row.attnotnull is distinct from expected.not_null
  ) or not (
    select relation_row.relrowsecurity
    from pg_catalog.pg_class relation_row
    where relation_row.oid='public.primetime_server_credentials'::regclass
  ) or not exists(
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid='public.primetime_server_credentials'::regclass
      and constraint_row.contype='p'
      and constraint_row.conkey=array[(
        select attribute_row.attnum
        from pg_catalog.pg_attribute attribute_row
        where attribute_row.attrelid='public.primetime_server_credentials'::regclass
          and attribute_row.attname='credential_key'
          and attribute_row.attnum>0
          and not attribute_row.attisdropped
      )]::smallint[]
  ) then
    raise exception using errcode='55000',message='v154_credential_schema_drift';
  end if;

  if exists(
    select 1
    from pg_catalog.pg_class relation_row,
      lateral aclexplode(coalesce(
        relation_row.relacl,acldefault('r',relation_row.relowner)
      )) grant_row
    left join pg_catalog.pg_roles role_row on role_row.oid=grant_row.grantee
    where relation_row.oid='public.primetime_server_credentials'::regclass
      and (grant_row.grantee=0
        or role_row.rolname in('anon','authenticated','service_role'))
  ) then
    raise exception using errcode='55000',message='v154_credential_acl_drift';
  end if;

  if not exists(
    select 1
    from pg_catalog.pg_class index_relation
    join pg_catalog.pg_index index_row on index_row.indexrelid=index_relation.oid
    join pg_catalog.pg_attribute request_attribute
      on request_attribute.attrelid=index_row.indrelid
     and request_attribute.attname='request_id'
     and request_attribute.attnum=index_row.indkey[0]
    where index_relation.oid=to_regclass('public.idx_bookings_request_id')
      and index_row.indrelid='public.bookings'::regclass
      and index_row.indisunique
      and index_row.indisvalid
      and index_row.indisready
      and index_row.indislive
      and index_row.indnatts=1
      and index_row.indnkeyatts=1
      and index_row.indexprs is null
      and pg_get_expr(index_row.indpred,index_row.indrelid)='(request_id IS NOT NULL)'
  ) then
    raise exception using errcode='55000',message='v154_booking_request_identity_missing';
  end if;

  if not exists(select 1 from pg_catalog.pg_roles where rolname='anon')
     or not exists(select 1 from pg_catalog.pg_roles where rolname='authenticated')
     or not exists(select 1 from pg_catalog.pg_roles where rolname='service_role')
     or not exists(select 1 from pg_catalog.pg_roles where rolname='postgres') then
    raise exception using errcode='55000',message='v154_required_roles_missing';
  end if;
end
$dependency_guard$;

do $overwrite_guard$
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
    raise exception using errcode='55000',message='v154_lookup_overload_conflict';
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

  if v_source_hash not in (
       'a0b2f93d58d65a749022a80d35d2cc766fe24419d6efe4fd5e804e0244157db4',
       '22d01acce277f80a1d312d071636abebc4581b0b74db328787307df1e0628750'
     )
     or v_marker is distinct from 'minuta_booking_lookup_v154:sha256='||v_contract_hash then
    raise exception using errcode='55000',message='v154_apply_blocked_newer_function_definition';
  end if;
end
$overwrite_guard$;

create or replace function public.lookup_primetime_booking_request_v154(
  p_request_id uuid
)
returns table(
  booking_code text,
  manage_token uuid,
  service_id uuid,
  booking_date date,
  booking_time time without time zone,
  duration_minutes integer,
  original_price_rub integer,
  total_price_rub integer,
  status text
)
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_headers jsonb;
  v_secret text;
begin
  if p_request_id is null then return; end if;

  begin
    v_headers:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
  exception when others then
    return;
  end;
  if jsonb_typeof(v_headers)<>'object' then return; end if;

  v_secret:=v_headers->>'x-primetime-booking-lookup-key';
  if v_secret is null
     or char_length(v_secret)<>64
     or v_secret!~'^[0-9a-f]{64}$' then
    return;
  end if;

  if not exists(
    select 1
    from public.primetime_server_credentials credential
    where credential.credential_key='booking_lookup_v154'
      and credential.active
      and credential.secret_sha256=encode(
        extensions.digest(convert_to(v_secret,'UTF8'),'sha256'),'hex'
      )
  ) then
    return;
  end if;

  return query
  select booking.booking_code::text,booking.manage_token,booking.service_id,
    booking.booking_date,booking.booking_time,booking.duration_minutes,
    booking.original_price_rub,booking.total_price_rub,booking.status::text
  from public.bookings booking
  where booking.request_id=p_request_id
  limit 1;
end;
$$;

alter function public.lookup_primetime_booking_request_v154(uuid) owner to postgres;
revoke all on function public.lookup_primetime_booking_request_v154(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.lookup_primetime_booking_request_v154(uuid) to anon;

do $stamp$
declare
  v_proc regprocedure:='public.lookup_primetime_booking_request_v154(uuid)'::regprocedure;
  v_source_hash text;
  v_contract_hash text;
begin
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
    )::text,'UTF8'),'sha256'),'hex')
  into v_source_hash,v_contract_hash
  from pg_catalog.pg_proc procedure_row
  join pg_catalog.pg_language language_row on language_row.oid=procedure_row.prolang
  where procedure_row.oid=v_proc;

  if v_source_hash is distinct from 'a0b2f93d58d65a749022a80d35d2cc766fe24419d6efe4fd5e804e0244157db4' then
    raise exception using errcode='55000',message='v154_lookup_source_hash_mismatch';
  end if;
  execute format(
    'comment on function public.lookup_primetime_booking_request_v154(uuid) is %L',
    'minuta_booking_lookup_v154:sha256='||v_contract_hash
  );
end
$stamp$;

do $verify$
declare
  v_proc regprocedure:='public.lookup_primetime_booking_request_v154(uuid)'::regprocedure;
begin
  if not has_function_privilege('anon',v_proc,'EXECUTE')
     or has_function_privilege('authenticated',v_proc,'EXECUTE')
     or has_function_privilege('service_role',v_proc,'EXECUTE')
     or exists(
       select 1
       from pg_catalog.pg_proc procedure_row,
         lateral aclexplode(coalesce(
           procedure_row.proacl,acldefault('f',procedure_row.proowner)
         )) grant_row
       where procedure_row.oid=v_proc
         and grant_row.grantee=0
         and grant_row.privilege_type='EXECUTE'
     )
     or (select procedure_row.prosecdef is distinct from true
           or procedure_row.provolatile is distinct from 's'
           or procedure_row.proconfig is distinct from array['search_path=""']::text[]
           or pg_get_userbyid(procedure_row.proowner) is distinct from 'postgres'
         from pg_catalog.pg_proc procedure_row
         where procedure_row.oid=v_proc) then
    raise exception using errcode='55000',message='v154_lookup_verification_failed';
  end if;
end
$verify$;

notify pgrst,'reload schema';
commit;
