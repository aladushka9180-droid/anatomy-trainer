-- v153: atomic PrimeTime public booking create with accepted service terms.
-- The legacy book_minuta_appointment RPC remains unchanged for compatibility.
begin;
set local lock_timeout='10s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $dependency_guard$
declare
  v_source_hash text;
  v_function regprocedure;
begin
  if to_regclass('public.bookings') is null
     or to_regclass('public.organizations') is null
     or to_regclass('public.locations') is null
     or to_regclass('public.organization_memberships') is null
     or to_regclass('public.services') is null
     or to_regprocedure('public.book_appointment(uuid,uuid,date,time without time zone,text,text)') is null
     or to_regprocedure('public.book_minuta_appointment(uuid,text,uuid,uuid,date,time without time zone,text,text)') is null
     or to_regprocedure('public.initialize_booking_session_price()') is null
     or to_regprocedure('extensions.digest(text,text)') is null
     or to_regprocedure('pg_catalog.hashtextextended(text,bigint)') is null then
    raise exception using errcode='55000',message='v153_atomic_create_prerequisites_missing';
  end if;

  for v_function,v_source_hash in
    select expected.signature::regprocedure,expected.source_hash
    from (values
      ('public.book_appointment(uuid,uuid,date,time without time zone,text,text)',
       'abadc0c81de68738ba6382cd03dda62d'),
      ('public.book_minuta_appointment(uuid,text,uuid,uuid,date,time without time zone,text,text)',
       '70c0055a199199324b1089901dcf1e95'),
      ('public.initialize_booking_session_price()',
       'bb90dd7e91b0239057ab71bf00fdfbba')
    ) expected(signature,source_hash)
  loop
    if (select md5(replace(procedure_row.prosrc,E'\r',''))
        from pg_catalog.pg_proc procedure_row where procedure_row.oid=v_function)
       is distinct from v_source_hash then
      raise exception using errcode='55000',message='v153_atomic_create_function_source_drift',
        detail=v_function::text;
    end if;
  end loop;

  v_function:='public.book_minuta_appointment(uuid,text,uuid,uuid,date,time without time zone,text,text)'::regprocedure;
  if not exists(
    select 1
    from pg_catalog.pg_proc procedure_row
    where procedure_row.oid=v_function
      and procedure_row.prokind='f'
      and procedure_row.provolatile='v'
      and procedure_row.prosecdef
      and not procedure_row.proisstrict
      and not procedure_row.proleakproof
      and procedure_row.proparallel='u'
      and procedure_row.proconfig=array['search_path=""']::text[]
      and pg_get_userbyid(procedure_row.proowner)='postgres'
      and pg_get_function_result(procedure_row.oid)='TABLE(booking_code text, manage_token uuid)'
  ) or not has_function_privilege('anon',v_function,'EXECUTE')
     or not has_function_privilege('authenticated',v_function,'EXECUTE')
     or has_function_privilege('service_role',v_function,'EXECUTE')
     or exists(
       select 1
       from pg_catalog.pg_proc procedure_row,
         lateral aclexplode(coalesce(
           procedure_row.proacl,
           acldefault('f',procedure_row.proowner)
         )) grant_row
       where procedure_row.oid=v_function
         and grant_row.grantee=0
         and grant_row.privilege_type='EXECUTE'
     ) then
    raise exception using errcode='55000',message='v153_public_create_contract_drift';
  end if;

  v_function:='public.initialize_booking_session_price()'::regprocedure;
  if not exists(
    select 1
    from pg_catalog.pg_proc procedure_row
    where procedure_row.oid=v_function
      and procedure_row.prokind='f'
      and procedure_row.provolatile='v'
      and procedure_row.prosecdef
      and not procedure_row.proisstrict
      and not procedure_row.proleakproof
      and procedure_row.proparallel='u'
      and procedure_row.proconfig=array['search_path=""']::text[]
      and pg_get_userbyid(procedure_row.proowner)='postgres'
      and pg_get_function_result(procedure_row.oid)='trigger'
  ) or (select count(*)
        from pg_catalog.pg_trigger trigger_row
        where trigger_row.tgrelid='public.bookings'::regclass
          and not trigger_row.tgisinternal
          and trigger_row.tgfoid=v_function)<>1
     or not exists(
       select 1
       from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgrelid='public.bookings'::regclass
         and trigger_row.tgname='bookings_initialize_session_price'
         and not trigger_row.tgisinternal
         and trigger_row.tgfoid=v_function
         and trigger_row.tgtype=7
         and trigger_row.tgenabled='O'
         and trigger_row.tgqual is null
     ) then
    raise exception using errcode='55000',message='v153_booking_price_initializer_contract_drift';
  end if;

  if exists(
    select 1
    from (values
      ('bookings','booking_code','text'),
      ('bookings','manage_token','uuid'),
      ('bookings','request_id','uuid'),
      ('bookings','request_fingerprint','text'),
      ('bookings','organization_id','uuid'),
      ('bookings','location_id','uuid'),
      ('bookings','performer_id','uuid'),
      ('bookings','service_id','uuid'),
      ('bookings','booking_date','date'),
      ('bookings','booking_time','time without time zone'),
      ('bookings','duration_minutes','integer'),
      ('bookings','original_price_rub','integer'),
      ('bookings','total_price_rub','integer'),
      ('bookings','status','text'),
      ('organizations','id','uuid'),
      ('organizations','public_slug','text'),
      ('organizations','status','text'),
      ('organizations','public_booking_enabled','boolean'),
      ('locations','id','uuid'),
      ('locations','organization_id','uuid'),
      ('locations','active','boolean'),
      ('locations','timezone','text'),
      ('organization_memberships','organization_id','uuid'),
      ('organization_memberships','user_id','uuid'),
      ('organization_memberships','active','boolean'),
      ('organization_memberships','is_bookable','boolean'),
      ('services','id','uuid'),
      ('services','performer_id','uuid'),
      ('services','duration_minutes','integer'),
      ('services','price_rub','integer'),
      ('services','active','boolean')
    ) expected(table_name,column_name,type_name)
    left join pg_catalog.pg_attribute attribute_row
      on attribute_row.attrelid=to_regclass('public.'||expected.table_name)
     and attribute_row.attname=expected.column_name
     and attribute_row.attnum>0
     and not attribute_row.attisdropped
    where attribute_row.attnum is null
       or attribute_row.atttypid is distinct from to_regtype(expected.type_name)
  ) then
    raise exception using errcode='55000',message='v153_atomic_create_schema_drift';
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
  ) or not exists(
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid='public.bookings'::regclass
      and constraint_row.conname='bookings_request_fingerprint_check'
      and constraint_row.contype='c'
      and constraint_row.convalidated
  ) or exists(
    select 1
    from public.bookings booking
    where booking.request_id is not null
      and (booking.request_fingerprint is null
        or booking.request_fingerprint!~'^[0-9a-f]{64}$')
  ) then
    raise exception using errcode='55000',message='v153_booking_request_identity_drift';
  end if;

  if not exists(select 1 from pg_catalog.pg_roles where rolname='anon')
     or not exists(select 1 from pg_catalog.pg_roles where rolname='authenticated')
     or not exists(select 1 from pg_catalog.pg_roles where rolname='service_role')
     or not exists(select 1 from pg_catalog.pg_roles where rolname='postgres') then
    raise exception using errcode='55000',message='v153_required_roles_missing';
  end if;
end
$dependency_guard$;

do $overwrite_guard$
declare
  v_proc regprocedure:=to_regprocedure(
    'public.book_minuta_appointment_v2(uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer)'
  );
  v_source_hash text;
  v_contract_hash text;
  v_marker text;
begin
  if exists(
    select 1
    from pg_catalog.pg_proc procedure_row
    join pg_catalog.pg_namespace namespace_row on namespace_row.oid=procedure_row.pronamespace
    where namespace_row.nspname='public'
      and procedure_row.proname='book_minuta_appointment_v2'
      and procedure_row.oid is distinct from v_proc
  ) then
    raise exception using errcode='55000',message='v153_atomic_create_overload_conflict';
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

  if v_source_hash is distinct from '5920e1426745c8c5425cb15822474952557781b9959d3557f9f3b965e2aae1be'
     or v_marker is distinct from 'minuta_atomic_create_v153:sha256='||v_contract_hash then
    raise exception using errcode='55000',message='v153_apply_blocked_newer_function_definition';
  end if;
end
$overwrite_guard$;

-- result_code='ok' acknowledges the authoritative stored snapshot; callers must
-- still honor status because an idempotent replay can return a cancelled row.
-- service_terms_changed never inserts and exposes only the current catalog terms.
create or replace function public.book_minuta_appointment_v2(
  p_request_id uuid,
  p_slug text,
  p_location uuid,
  p_service uuid,
  p_date date,
  p_time time without time zone,
  p_client_name text,
  p_client_phone text,
  p_expected_price_rub integer,
  p_expected_duration_minutes integer
)
returns table(
  result_code text,
  booking_code text,
  manage_token uuid,
  request_id uuid,
  service_id uuid,
  booking_date date,
  booking_time time without time zone,
  duration_minutes integer,
  original_price_rub integer,
  total_price_rub integer,
  status text,
  current_price_rub integer,
  current_duration_minutes integer
)
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_request_fingerprint text;
  v_booking public.bookings%rowtype;
  v_existing boolean;
  v_organization uuid;
  v_performer uuid;
  v_current_price integer;
  v_current_duration integer;
  v_created_code text;
  v_created_token uuid;
begin
  if p_request_id is null or p_location is null or p_service is null
     or p_date is null or p_time is null
     or lower(trim(coalesce(p_slug,'')))!~'^[a-z0-9][a-z0-9-]{2,62}$'
     or coalesce(char_length(trim(p_client_name)),0)<2
     or coalesce(char_length(regexp_replace(p_client_phone,'[^0-9]','','g')),0)<10
     or p_expected_price_rub is null or p_expected_price_rub not between 0 and 10000000
     or p_expected_duration_minutes is null or p_expected_duration_minutes not between 1 and 480 then
    raise exception using errcode='P0001',message='invalid_booking_data';
  end if;

  v_request_fingerprint:=encode(extensions.digest(
    p_service::text||chr(31)||p_date::text||chr(31)||
    p_time::text||chr(31)||trim(p_client_name)||chr(31)||
    regexp_replace(p_client_phone,'[^0-9]','','g'),'sha256'),'hex');

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('booking-request:'||p_request_id::text,0)
  );

  select booking.* into v_booking
  from public.bookings booking
  where booking.request_id=p_request_id;
  v_existing:=found;

  select organization.id into v_organization
  from public.organizations organization
  where organization.public_slug=lower(trim(p_slug));

  if v_existing then
    if v_organization is null
       or v_booking.request_fingerprint is distinct from v_request_fingerprint
       or v_booking.organization_id is distinct from v_organization
       or v_booking.location_id is distinct from p_location then
      raise exception using errcode='P0001',message='request_conflict';
    end if;
    return query select
      'ok'::text,v_booking.booking_code::text,v_booking.manage_token,
      v_booking.request_id,v_booking.service_id,v_booking.booking_date,
      v_booking.booking_time,v_booking.duration_minutes,
      v_booking.original_price_rub,v_booking.total_price_rub,v_booking.status::text,
      v_booking.total_price_rub,v_booking.duration_minutes;
    return;
  end if;

  perform 1
  from public.organizations organization
  where organization.id=v_organization
    and organization.status='active'
    and organization.public_booking_enabled
  for share;
  if not found then
    raise exception using errcode='P0001',message='organization_unavailable';
  end if;

  perform 1
  from public.locations location
  where location.id=p_location
    and location.organization_id=v_organization
    and location.active
    and location.timezone='Europe/Samara'
  for share;
  if not found then
    raise exception using errcode='P0001',message='location_unavailable';
  end if;

  select service.performer_id,service.price_rub,service.duration_minutes
  into v_performer,v_current_price,v_current_duration
  from public.services service
  where service.id=p_service
    and service.active
  for share;
  if not found then
    raise exception using errcode='P0001',message='service_unavailable';
  end if;

  perform 1
  from public.organization_memberships membership
  where membership.organization_id=v_organization
    and membership.user_id=v_performer
    and membership.active
    and membership.is_bookable
  for share;
  if not found then
    raise exception using errcode='P0001',message='service_unavailable';
  end if;

  if p_expected_price_rub is distinct from v_current_price
     or p_expected_duration_minutes is distinct from v_current_duration then
    return query select
      'service_terms_changed'::text,null::text,null::uuid,
      p_request_id,p_service,p_date,p_time,null::integer,null::integer,
      null::integer,null::text,v_current_price,v_current_duration;
    return;
  end if;

  select created.booking_code,created.manage_token
  into v_created_code,v_created_token
  from public.book_minuta_appointment(
    p_request_id,p_slug,p_location,p_service,p_date,p_time,
    p_client_name,p_client_phone
  ) created;

  select booking.* into v_booking
  from public.bookings booking
  where booking.request_id=p_request_id;

  if not found
     or v_booking.request_fingerprint is distinct from v_request_fingerprint
     or v_booking.organization_id is distinct from v_organization
     or v_booking.location_id is distinct from p_location
     or v_booking.service_id is distinct from p_service
     or v_booking.booking_date is distinct from p_date
     or v_booking.booking_time is distinct from p_time
     or v_booking.duration_minutes is distinct from p_expected_duration_minutes
     or v_booking.original_price_rub is distinct from p_expected_price_rub
     or v_booking.total_price_rub is distinct from p_expected_price_rub
     or v_booking.booking_code is distinct from v_created_code
     or v_booking.manage_token is distinct from v_created_token then
    raise exception using errcode='55000',message='atomic_booking_acknowledgement_invalid';
  end if;

  return query select
    'ok'::text,v_booking.booking_code::text,v_booking.manage_token,
    v_booking.request_id,v_booking.service_id,v_booking.booking_date,
    v_booking.booking_time,v_booking.duration_minutes,
    v_booking.original_price_rub,v_booking.total_price_rub,v_booking.status::text,
    v_booking.total_price_rub,v_booking.duration_minutes;
end;
$$;

alter function public.book_minuta_appointment_v2(
  uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer
) owner to postgres;
revoke all on function public.book_minuta_appointment_v2(
  uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer
) from public,anon,authenticated,service_role;
grant execute on function public.book_minuta_appointment_v2(
  uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer
) to anon,authenticated;

do $stamp$
declare
  v_proc regprocedure:='public.book_minuta_appointment_v2(uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer)'::regprocedure;
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

  if v_source_hash is distinct from '5920e1426745c8c5425cb15822474952557781b9959d3557f9f3b965e2aae1be' then
    raise exception using errcode='55000',message='v153_atomic_create_source_hash_mismatch';
  end if;
  execute format(
    'comment on function public.book_minuta_appointment_v2(uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer) is %L',
    'minuta_atomic_create_v153:sha256='||v_contract_hash
  );
end
$stamp$;

notify pgrst,'reload schema';
commit;
