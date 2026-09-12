-- v152: recovery-only acknowledgement for an ambiguous PrimeTime booking create.
-- This function never creates or changes a booking and is callable only by service_role.
begin;
set local lock_timeout='10s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $dependency_guard$
declare
  v_book_source_md5 text;
begin
  if to_regclass('public.bookings') is null
     or to_regprocedure('public.book_appointment(uuid,uuid,date,time without time zone,text,text)') is null
     or to_regprocedure('public.book_minuta_appointment(uuid,text,uuid,uuid,date,time without time zone,text,text)') is null
     or to_regprocedure('extensions.digest(text,text)') is null
     or to_regprocedure('pg_catalog.hashtextextended(text,bigint)') is null then
    raise exception using errcode='55000',message='v152_recovery_prerequisites_missing';
  end if;

  select md5(replace(procedure_row.prosrc,E'\r',''))
  into v_book_source_md5
  from pg_catalog.pg_proc procedure_row
  where procedure_row.oid=to_regprocedure(
    'public.book_appointment(uuid,uuid,date,time without time zone,text,text)'
  );
  if v_book_source_md5 is distinct from 'abadc0c81de68738ba6382cd03dda62d' then
    raise exception using errcode='55000',message='v152_booking_fingerprint_baseline_drift';
  end if;

  if exists(
    select 1
    from (values
      ('booking_code','text',true),
      ('manage_token','uuid',true),
      ('request_id','uuid',false),
      ('request_fingerprint','text',false),
      ('organization_id','uuid',true),
      ('location_id','uuid',true),
      ('performer_id','uuid',true),
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
    raise exception using errcode='55000',message='v152_booking_schema_drift';
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
    raise exception using errcode='55000',message='v152_booking_request_identity_missing';
  end if;

  if not exists(
    select 1 from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid='public.bookings'::regclass
      and constraint_row.conname='bookings_request_fingerprint_check'
      and constraint_row.contype='c'
      and constraint_row.convalidated
  ) or exists(
    select 1 from public.bookings booking
    where booking.request_id is not null
      and (booking.request_fingerprint is null
        or booking.request_fingerprint!~'^[0-9a-f]{64}$')
  ) then
    raise exception using errcode='55000',message='v152_booking_request_fingerprint_invalid';
  end if;

  if not exists(select 1 from pg_catalog.pg_roles where rolname='anon')
     or not exists(select 1 from pg_catalog.pg_roles where rolname='authenticated')
     or not exists(select 1 from pg_catalog.pg_roles where rolname='service_role')
     or not exists(select 1 from pg_catalog.pg_roles where rolname='postgres') then
    raise exception using errcode='55000',message='v152_required_roles_missing';
  end if;
end
$dependency_guard$;

do $overwrite_guard$
declare
  v_proc regprocedure:=to_regprocedure(
    'public.recover_primetime_booking_request_v1(uuid,uuid,uuid,uuid,date,time without time zone,text,text)'
  );
  v_source_hash text;
  v_contract_hash text;
  v_marker text;
begin
  if exists(
    select 1 from pg_catalog.pg_proc procedure_row
    join pg_catalog.pg_namespace namespace_row on namespace_row.oid=procedure_row.pronamespace
    where namespace_row.nspname='public'
      and procedure_row.proname='recover_primetime_booking_request_v1'
      and procedure_row.oid is distinct from v_proc
  ) then
    raise exception using errcode='55000',message='v152_recovery_overload_conflict';
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

  if v_source_hash is distinct from '5d5d7df186a88c9eeaa5a76af88cc5827cdef40419bb621dd05485e8485c7741'
     or v_marker is distinct from 'minuta_booking_recovery_v152:sha256='||v_contract_hash then
    raise exception using errcode='55000',message='v152_apply_blocked_newer_function_definition';
  end if;
end
$overwrite_guard$;

create or replace function public.recover_primetime_booking_request_v1(
  p_request_id uuid,
  p_organization uuid,
  p_location uuid,
  p_service uuid,
  p_date date,
  p_time time without time zone,
  p_client_name text,
  p_client_phone text
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
volatile
security definer
set search_path to ''
as $$
declare
  v_fingerprint text;
  v_booking public.bookings%rowtype;
begin
  if p_request_id is null or p_organization is null or p_location is null
     or p_service is null or p_date is null or p_time is null
     or coalesce(char_length(trim(p_client_name)),0)<2
     or coalesce(char_length(regexp_replace(p_client_phone,'[^0-9]','','g')),0)<10 then
    raise exception using errcode='P0001',message='invalid_recovery_request';
  end if;

  v_fingerprint:=encode(extensions.digest(
    p_service::text||chr(31)||p_date::text||chr(31)||
    p_time::text||chr(31)||trim(p_client_name)||chr(31)||
    regexp_replace(p_client_phone,'[^0-9]','','g'),'sha256'),'hex');

  perform pg_advisory_xact_lock(
    hashtextextended('booking-request:'||p_request_id::text,0)
  );

  select booking.* into v_booking
  from public.bookings booking
  where booking.request_id=p_request_id;
  if not found then return; end if;

  if v_booking.request_fingerprint is distinct from v_fingerprint
     or v_booking.organization_id is distinct from p_organization
     or v_booking.location_id is distinct from p_location then
    raise exception using errcode='P0001',message='request_conflict';
  end if;

  return query select
    v_booking.booking_code::text,v_booking.manage_token,v_booking.service_id,
    v_booking.booking_date,v_booking.booking_time,v_booking.duration_minutes,
    v_booking.original_price_rub,v_booking.total_price_rub,v_booking.status::text;
end;
$$;

alter function public.recover_primetime_booking_request_v1(
  uuid,uuid,uuid,uuid,date,time without time zone,text,text
) owner to postgres;
revoke all on function public.recover_primetime_booking_request_v1(
  uuid,uuid,uuid,uuid,date,time without time zone,text,text
) from public,anon,authenticated,service_role;
grant execute on function public.recover_primetime_booking_request_v1(
  uuid,uuid,uuid,uuid,date,time without time zone,text,text
) to service_role;

do $stamp$
declare
  v_proc regprocedure:='public.recover_primetime_booking_request_v1(uuid,uuid,uuid,uuid,date,time without time zone,text,text)'::regprocedure;
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

  if v_source_hash is distinct from '5d5d7df186a88c9eeaa5a76af88cc5827cdef40419bb621dd05485e8485c7741' then
    raise exception using errcode='55000',message='v152_recovery_source_hash_mismatch';
  end if;
  execute format(
    'comment on function public.recover_primetime_booking_request_v1(uuid,uuid,uuid,uuid,date,time without time zone,text,text) is %L',
    'minuta_booking_recovery_v152:sha256='||v_contract_hash
  );
end
$stamp$;

notify pgrst,'reload schema';
commit;
