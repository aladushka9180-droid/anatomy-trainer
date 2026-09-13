-- Roll back only the exact v155 client-identity contract.
begin;
set local lock_timeout='10s';
set local search_path=public,extensions,pg_catalog;

do $guard$
declare
  v_item record;
  v_table regclass;
  v_hash text;
  v_marker text;
  v_function regprocedure;
  v_signature text;
begin
  if to_regclass('public.client_identity_sessions_v155') is null
     or to_regclass('public.client_identity_claim_grants_v155') is null
     or to_regclass('public.client_identity_transfers_v155') is null
     or to_regclass('public.client_identity_booking_requests_v155') is null
     or to_regclass('public.client_identity_audit_v155') is null
     or to_regprocedure('public.bump_client_benefit_version_v155()') is null
     or not exists(select 1 from pg_catalog.pg_attribute attribute_row
       join pg_catalog.pg_attrdef default_row
         on default_row.adrelid=attribute_row.attrelid and default_row.adnum=attribute_row.attnum
       where attribute_row.attrelid='public.client_benefit_instruments'::regclass
         and attribute_row.attname='client_version' and attribute_row.attnum>0 and not attribute_row.attisdropped
         and attribute_row.atttypid='integer'::regtype and attribute_row.attnotnull
         and pg_catalog.pg_get_expr(default_row.adbin,default_row.adrelid)='1')
     or not exists(select 1 from pg_catalog.pg_constraint constraint_row
       where constraint_row.conrelid='public.client_benefit_instruments'::regclass
         and constraint_row.conname='client_benefit_instruments_client_version_v155_check')
     or not exists(select 1 from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgrelid='public.client_benefit_instruments'::regclass
         and trigger_row.tgname='client_benefit_instruments_version_v155'
         and not trigger_row.tgisinternal
         and trigger_row.tgfoid='public.bump_client_benefit_version_v155()'::regprocedure
         and trigger_row.tgenabled='O' and trigger_row.tgtype=19)
     or obj_description('public.assign_booking_client_account()'::regprocedure,'pg_proc') is distinct from 'minuta_client_identity_binding_v155'
     or obj_description('public.bootstrap_client_access(uuid,text)'::regprocedure,'pg_proc') is distinct from 'minuta_client_identity_v155'
     or obj_description('public.rotate_client_access_code(text)'::regprocedure,'pg_proc') is distinct from 'minuta_client_identity_v155'
     or obj_description('public.book_minuta_appointment_with_benefit_v115(uuid,text,uuid,uuid,date,time without time zone,text,text,text)'::regprocedure,'pg_proc') is distinct from 'minuta_client_identity_v155' then
    raise exception using errcode='55000',message='v155_rollback_blocked_missing_or_newer_objects';
  end if;

  foreach v_table in array array[
    'public.client_identity_sessions_v155'::regclass,
    'public.client_identity_claim_grants_v155'::regclass,
    'public.client_identity_transfers_v155'::regclass,
    'public.client_identity_booking_requests_v155'::regclass,
    'public.client_identity_audit_v155'::regclass
  ] loop
    select encode(extensions.digest(convert_to(jsonb_build_object(
      'owner',(select pg_catalog.pg_get_userbyid(relation_row.relowner) from pg_catalog.pg_class relation_row where relation_row.oid=v_table),
      'acl',(select coalesce(relation_row.relacl,'{}'::aclitem[])::text from pg_catalog.pg_class relation_row where relation_row.oid=v_table),
      'rls',(select relation_row.relrowsecurity from pg_catalog.pg_class relation_row where relation_row.oid=v_table),
      'force_rls',(select relation_row.relforcerowsecurity from pg_catalog.pg_class relation_row where relation_row.oid=v_table),
      'policies',(select jsonb_agg(jsonb_build_object(
        'name',policy_row.polname,'permissive',policy_row.polpermissive,
        'roles',(select jsonb_agg(pg_catalog.pg_get_userbyid(role_oid) order by pg_catalog.pg_get_userbyid(role_oid))
          from unnest(policy_row.polroles) role_oid),
        'command',policy_row.polcmd,'qual',pg_catalog.pg_get_expr(policy_row.polqual,policy_row.polrelid),
        'with_check',pg_catalog.pg_get_expr(policy_row.polwithcheck,policy_row.polrelid)
      ) order by policy_row.polname) from pg_catalog.pg_policy policy_row where policy_row.polrelid=v_table),
      'columns',(select jsonb_agg(jsonb_build_object(
        'name',attribute_row.attname,'type',pg_catalog.format_type(attribute_row.atttypid,attribute_row.atttypmod),
        'not_null',attribute_row.attnotnull,'identity',attribute_row.attidentity,
        'default',pg_catalog.pg_get_expr(default_row.adbin,default_row.adrelid)
      ) order by attribute_row.attnum)
        from pg_catalog.pg_attribute attribute_row
        left join pg_catalog.pg_attrdef default_row
          on default_row.adrelid=attribute_row.attrelid and default_row.adnum=attribute_row.attnum
        where attribute_row.attrelid=v_table and attribute_row.attnum>0 and not attribute_row.attisdropped),
      'constraints',(select jsonb_agg(jsonb_build_object(
        'name',constraint_row.conname,'type',constraint_row.contype,
        'definition',pg_catalog.pg_get_constraintdef(constraint_row.oid,true)
      ) order by constraint_row.conname) from pg_catalog.pg_constraint constraint_row
        where constraint_row.conrelid=v_table),
      'indexes',(select jsonb_agg(pg_catalog.pg_get_indexdef(index_row.indexrelid) order by index_class.relname)
        from pg_catalog.pg_index index_row join pg_catalog.pg_class index_class on index_class.oid=index_row.indexrelid
        where index_row.indrelid=v_table),
      'triggers',(select jsonb_agg(pg_catalog.pg_get_triggerdef(trigger_row.oid,true) order by trigger_row.tgname)
        from pg_catalog.pg_trigger trigger_row where trigger_row.tgrelid=v_table and not trigger_row.tgisinternal)
    )::text,'UTF8'),'sha256'),'hex'),obj_description(v_table,'pg_class') into v_hash,v_marker;
    if v_marker is distinct from 'minuta_client_identity_v155:sha256='||v_hash then
      raise exception using errcode='55000',message='v155_rollback_blocked_newer_table_definition',detail=v_table::text;
    end if;
  end loop;

  for v_item in
    select * from (values
      ('public.assign_booking_client_account()', '065b00c979459c007bcda7b597c9f22b4e6d879085e7ee384ff04b3a27b5eea9'),
      ('public.bootstrap_client_access(uuid,text)', '94c1b8095abc5463911fdf95cfc1ce8ec029165470f123fb3ec6918328014a23'),
      ('public.book_minuta_appointment_with_benefit_v115(uuid,text,uuid,uuid,date,time without time zone,text,text,text)', '53796773fc8c71ab5c178e1418e403cd706b8d5d1ee0b39a9c8ee3597b3b422c'),
      ('public.restore_client_session(text)', 'ff71198fb90cd25d506183c3f56735b9e265ea941cdc35602d489615668f3375'),
      ('public.get_client_bookings_v3(text)', '3170303328b9dc187fd24e9722e85b9aeaef05bc06384d66617c210783639e09'),
      ('public.submit_booking_review(text,uuid,integer,text)', 'c44fd2ec429a9a68aab42a7674d51954f69b333d682c2c1797a2fa62e10d83d7'),
      ('public.revoke_client_session(text)', '59430788863dfe1ef1c3bd20e65d0bc8466c9299ab3f7b3f825e9c13e4f8b088'),
      ('public.protect_client_identity_immutable_v155()', '23c70f8815aed7dbf2e9c72947569ad112c13a4a1cae294f82408c61439456fb'),
      ('public.resolve_client_identity_session_v155(text)', '5e65796683092396867739b764af27f594dba2395ae8e573b02a865fbac59fa8'),
      ('public.claim_client_booking_identity_v155(uuid,text)', '6f88e1601b4ec513d4fa28d5cb2ac17959e2112cd8d4bfa2b084accd7073564c'),
      ('public.upgrade_legacy_client_identity_session_v155(text,text,text)', '154af3794baadfcddbf8dc1c911e461c71de51219d45ea11e70647ae0f6ee1f4'),
      ('public.issue_client_identity_claim_grant_v155(uuid,uuid,uuid,integer,uuid)', 'cb9c05efc30d2ebcff6c8cc54304cc44fa3cf7789be79dc9299d17db523fa63a'),
      ('public.issue_client_identity_sale_claim_v155(uuid,uuid,uuid,integer,uuid,text)', 'f782c940ba505260d42d3de8c7931f4d4a57a7f6d19ae32850c5666a7bad89a2'),
      ('public.inspect_client_identity_sale_claim_v155(text,uuid)', '26ea57135e1c74846cbbc2756cced5964e054ab9302a0a41dbd3e3626a42f741'),
      ('public.consume_client_identity_sale_claim_v155(text,text,uuid)', '95867d9f8dce3e2f99f16c844279b55613b8f750870eeedb893fa9d320d1ed1c'),
      ('public.promote_client_identity_v155(text,text)', '0cd89d46354778d111b503eda6b5f8536830ec35b51fabbb998ad55ad796d6e1'),
      ('public.begin_client_identity_transfer_v155(text,text)', '078ff6854ca26891937b170f72c3d76229c4b7170fc61899fdfd4057799ff68a'),
      ('public.approve_client_identity_transfer_v155(text,text,text)', 'a5525e6450290f476d2865cf371e1ed030eb912fb020c8a7e1ca07b0e60eac19'),
      ('public.consume_client_identity_transfer_v155(text,text,text)', '051017ee2877db0159ea45a7b4d456bbdf8c84086148c4c480bdb2714adf439f'),
      ('public.revoke_client_identity_session_v155(text)', '1a8ac0a0cd1a3871f316ae81df72b90faa2ae4638fd56983b6c4ffb18390decb'),
      ('public.get_client_identity_context_v155(text)', '9bc222169fbc197bb6c0f2bb3229d7d8cabfbd344c8b7905e0661ef1d21a6a2b'),
      ('public.get_client_commerce_v155(text)', '8e457f257897b716d38117d50a4fe9f9324e7e89c5e71b96f9df4245969312a0'),
      ('public.reserve_client_benefit_v155(uuid,uuid,uuid,uuid,integer,integer)', '27b1589359d0cb5c0b85ae7809a2978d1c40fe0d05d786ec387b58c95c0cb9bb'),
      ('public.book_client_with_benefit_v155(text,uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer,text,integer,integer)', 'd06e891274877c92227c8f0dfbdaf3acdf01372f28057248894ec419c13d1325'),
      ('public.bump_client_benefit_version_v155()', '16ad3f94354913307399d6def6fde1259e51be3cce3b091b02cc28b674bd93d9'),
      ('public.rotate_client_access_code(text)', 'cb45298118e9bbadbb09481bb2711c061a7073fd9c6ae67a1984a8fe80010ed8')
    ) expected(signature,source_hash)
  loop
    v_function:=to_regprocedure(v_item.signature);
    if v_function is null or (
      select encode(extensions.digest(
        convert_to(replace(procedure_row.prosrc,E'\r',''),'UTF8'),'sha256'
      ),'hex')
      from pg_catalog.pg_proc procedure_row
      where procedure_row.oid=v_function
    ) is distinct from v_item.source_hash
      or not exists(select 1 from pg_catalog.pg_proc procedure_row
        where procedure_row.oid=v_function and procedure_row.prosecdef
          and procedure_row.provolatile='v' and procedure_row.proconfig=array['search_path=""']::text[]
          and pg_catalog.pg_get_userbyid(procedure_row.proowner)='postgres')
      or obj_description(v_function,'pg_proc') is distinct from
        case when v_item.signature='public.assign_booking_client_account()'
          then 'minuta_client_identity_binding_v155' else 'minuta_client_identity_v155' end
      or exists(select 1 from pg_catalog.pg_proc procedure_row,
        lateral aclexplode(coalesce(procedure_row.proacl,acldefault('f',procedure_row.proowner))) grant_row
        where procedure_row.oid=v_function and grant_row.grantee=0 and grant_row.privilege_type='EXECUTE') then
      raise exception using errcode='55000',message='v155_rollback_blocked_newer_function_definition',detail=v_item.signature;
    end if;
  end loop;

  foreach v_signature in array array[
    'public.bootstrap_client_access(uuid,text)',
    'public.book_minuta_appointment_with_benefit_v115(uuid,text,uuid,uuid,date,time without time zone,text,text,text)',
    'public.restore_client_session(text)','public.get_client_bookings_v3(text)',
    'public.submit_booking_review(text,uuid,integer,text)','public.revoke_client_session(text)',
    'public.claim_client_booking_identity_v155(uuid,text)',
    'public.upgrade_legacy_client_identity_session_v155(text,text,text)',
    'public.consume_client_identity_sale_claim_v155(text,text,uuid)',
    'public.promote_client_identity_v155(text,text)','public.begin_client_identity_transfer_v155(text,text)',
    'public.approve_client_identity_transfer_v155(text,text,text)','public.consume_client_identity_transfer_v155(text,text,text)',
    'public.revoke_client_identity_session_v155(text)','public.get_client_identity_context_v155(text)',
    'public.get_client_commerce_v155(text)','public.rotate_client_access_code(text)'
  ] loop
    if not has_function_privilege('anon',v_signature,'EXECUTE')
       or not has_function_privilege('authenticated',v_signature,'EXECUTE')
       or has_function_privilege('service_role',v_signature,'EXECUTE') then
      raise exception using errcode='55000',message='v155_rollback_blocked_function_acl_drift',detail=v_signature;
    end if;
  end loop;
  foreach v_signature in array array[
    'public.issue_client_identity_claim_grant_v155(uuid,uuid,uuid,integer,uuid)',
    'public.issue_client_identity_sale_claim_v155(uuid,uuid,uuid,integer,uuid,text)'
  ] loop
    if has_function_privilege('anon',v_signature,'EXECUTE')
       or not has_function_privilege('authenticated',v_signature,'EXECUTE')
       or not has_function_privilege('service_role',v_signature,'EXECUTE') then
      raise exception using errcode='55000',message='v155_rollback_blocked_function_acl_drift',detail=v_signature;
    end if;
  end loop;
  foreach v_signature in array array[
    'public.protect_client_identity_immutable_v155()',
    'public.resolve_client_identity_session_v155(text)',
    'public.reserve_client_benefit_v155(uuid,uuid,uuid,uuid,integer,integer)',
    'public.bump_client_benefit_version_v155()'
  ] loop
    if has_function_privilege('anon',v_signature,'EXECUTE')
       or has_function_privilege('authenticated',v_signature,'EXECUTE')
       or has_function_privilege('service_role',v_signature,'EXECUTE') then
      raise exception using errcode='55000',message='v155_rollback_blocked_function_acl_drift',detail=v_signature;
    end if;
  end loop;
  if has_function_privilege('anon','public.assign_booking_client_account()','EXECUTE')
     or has_function_privilege('authenticated','public.assign_booking_client_account()','EXECUTE')
     or not has_function_privilege('service_role','public.assign_booking_client_account()','EXECUTE') then
    raise exception using errcode='55000',message='v155_rollback_blocked_function_acl_drift',detail='public.assign_booking_client_account()';
  end if;
  if has_function_privilege('anon','public.book_client_with_benefit_v155(text,uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer,text,integer,integer)','EXECUTE')
     or has_function_privilege('authenticated','public.book_client_with_benefit_v155(text,uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer,text,integer,integer)','EXECUTE')
     or not has_function_privilege('service_role','public.book_client_with_benefit_v155(text,uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer,text,integer,integer)','EXECUTE') then
    raise exception using errcode='55000',message='v155_rollback_blocked_function_acl_drift',detail='public.book_client_with_benefit_v155';
  end if;
  if has_function_privilege('anon','public.inspect_client_identity_sale_claim_v155(text,uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.inspect_client_identity_sale_claim_v155(text,uuid)','EXECUTE')
     or not has_function_privilege('service_role','public.inspect_client_identity_sale_claim_v155(text,uuid)','EXECUTE') then
    raise exception using errcode='55000',message='v155_rollback_blocked_function_acl_drift',detail='public.inspect_client_identity_sale_claim_v155';
  end if;
  if exists(select 1 from public.client_identity_sessions_v155)
     or exists(select 1 from public.client_identity_claim_grants_v155)
     or exists(select 1 from public.client_identity_transfers_v155)
     or exists(select 1 from public.client_identity_booking_requests_v155)
     or exists(select 1 from public.client_identity_audit_v155) then
    raise exception using errcode='55000',message='v155_rollback_blocked_nonempty_identity_history';
  end if;
end
$guard$;

drop function public.book_client_with_benefit_v155(
  text,uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer,text,integer,integer
);
drop function public.reserve_client_benefit_v155(uuid,uuid,uuid,uuid,integer,integer);
drop trigger client_benefit_instruments_version_v155 on public.client_benefit_instruments;
alter table public.client_benefit_instruments
  drop constraint client_benefit_instruments_client_version_v155_check,
  drop column client_version;
drop function public.bump_client_benefit_version_v155();
drop function public.get_client_commerce_v155(text);
drop function public.get_client_identity_context_v155(text);
drop function public.revoke_client_identity_session_v155(text);
drop function public.consume_client_identity_transfer_v155(text,text,text);
drop function public.approve_client_identity_transfer_v155(text,text,text);
drop function public.begin_client_identity_transfer_v155(text,text);
drop function public.promote_client_identity_v155(text,text);
drop function public.consume_client_identity_sale_claim_v155(text,text,uuid);
drop function public.inspect_client_identity_sale_claim_v155(text,uuid);
drop function public.issue_client_identity_sale_claim_v155(uuid,uuid,uuid,integer,uuid,text);
drop function public.issue_client_identity_claim_grant_v155(uuid,uuid,uuid,integer,uuid);
drop function public.upgrade_legacy_client_identity_session_v155(text,text,text);
drop function public.claim_client_booking_identity_v155(uuid,text);
drop function public.resolve_client_identity_session_v155(text);

drop trigger client_identity_booking_requests_immutable_v155
  on public.client_identity_booking_requests_v155;
drop trigger client_identity_audit_immutable_v155
  on public.client_identity_audit_v155;
drop table public.client_identity_booking_requests_v155;
drop table public.client_identity_transfers_v155;
drop table public.client_identity_audit_v155;
drop table public.client_identity_claim_grants_v155;
drop table public.client_identity_sessions_v155;
drop function public.protect_client_identity_immutable_v155();

create or replace function public.assign_booking_client_account()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if tg_op='INSERT' then
    new.client_account_id:=null;
  elsif new.client_phone is distinct from old.client_phone then
    new.client_account_id:=old.client_account_id;
  end if;
  return new;
end
$$;

create or replace function public.bootstrap_client_access(
  p_manage_token uuid,
  p_device_name text default null
)
returns table(
  access_code text,
  session_token text,
  session_expires_at timestamptz,
  is_new_account boolean
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'extensions'
as $$
declare
  v_booking public.bookings%rowtype;
  v_phone text;
  v_account_id uuid;
  v_code_raw text;
  v_code text;
  v_session_token text;
  v_session_expires_at timestamptz := now() + interval '90 days';
  v_is_new boolean := false;
begin
  if p_manage_token is null then
    raise exception using errcode = 'P0001', message = 'booking_unavailable';
  end if;
  if p_device_name is not null and char_length(btrim(p_device_name)) not between 1 and 120 then
    raise exception using errcode = 'P0001', message = 'invalid_device_name';
  end if;

  select booking.* into v_booking
  from public.bookings booking
  where booking.manage_token = p_manage_token
  for update;

  if not found
     or v_booking.client_phone = '0000000000'
     or v_booking.client_access_eligible_until is null
     or v_booking.client_access_eligible_until < now() then
    raise exception using errcode = 'P0001', message = 'booking_unavailable';
  end if;

  v_phone := public.normalize_client_phone(v_booking.client_phone);
  if v_phone !~ '^7[0-9]{10}$' then
    raise exception using errcode = 'P0001', message = 'invalid_client_phone';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('client-account:' || v_phone, 0));

  select account.id into v_account_id
  from public.client_accounts account
  where account.normalized_phone = v_phone
  for update;

  if v_account_id is null then
    v_account_id := gen_random_uuid();
    v_code_raw := upper(encode(gen_random_bytes(8), 'hex'));
    v_code := substr(v_code_raw, 1, 4) || '-' || substr(v_code_raw, 5, 4) || '-' ||
      substr(v_code_raw, 9, 4) || '-' || substr(v_code_raw, 13, 4);
    insert into public.client_accounts (id, normalized_phone, access_code_hash)
    values (
      v_account_id,
      v_phone,
      encode(digest(v_code_raw || ':' || v_account_id::text, 'sha256'), 'hex')
    );
    v_is_new := true;
  end if;

  update public.bookings booking
  set client_account_id = v_account_id
  where booking.client_account_id is null
    and booking.client_phone <> '0000000000'
    and public.normalize_client_phone(booking.client_phone) = v_phone;

  v_session_token := encode(gen_random_bytes(32), 'hex');
  insert into public.client_device_sessions (
    client_account_id, token_hash, device_name, expires_at
  ) values (
    v_account_id,
    encode(digest(v_session_token, 'sha256'), 'hex'),
    nullif(btrim(p_device_name), ''),
    v_session_expires_at
  );

  return query select v_code, v_session_token, v_session_expires_at, v_is_new;
end;
$$;

create or replace function public.book_minuta_appointment_with_benefit_v115(
  p_request_id uuid,p_slug text,p_location uuid,p_service uuid,p_date date,p_time time without time zone,
  p_client_name text,p_client_phone text,p_benefit_code text
) returns table(booking_code text,manage_token uuid)
language plpgsql security definer set search_path to '' as $$
declare v_organization uuid;v_code text;v_token uuid;v_preexisting uuid;
begin
  select id into v_organization from public.organizations
    where public_slug=lower(btrim(coalesce(p_slug,''))) and status='active' and public_booking_enabled;
  if v_organization is null then raise exception using errcode='P0001',message='organization_unavailable'; end if;
  select id into v_preexisting from public.bookings where organization_id=v_organization and request_id=p_request_id;
  if v_preexisting is not null and not exists(
    select 1 from public.public_benefit_booking_requests_v115 binding
      where binding.organization_id=v_organization and binding.request_id=p_request_id and binding.booking_id=v_preexisting
  ) then
    raise exception using errcode='P0001',message='benefit_not_available';
  end if;
  select result.booking_code,result.manage_token into v_code,v_token from public.book_minuta_appointment(
    p_request_id,p_slug,p_location,p_service,p_date,p_time,p_client_name,p_client_phone) result;
  begin
    perform public.reserve_minuta_public_benefit_v115(v_organization,p_request_id,p_benefit_code);
  exception when others then
    raise exception using errcode='P0001',message='benefit_not_available';
  end;
  return query select v_code,v_token;
end $$;

-- Rollback keeps the security boundary closed even though the v155 tables are
-- removed. A future migration must explicitly re-enable compatible issuance.
create or replace function public.bootstrap_client_access(
  p_manage_token uuid,p_device_name text default null
)
returns table(access_code text,session_token text,session_expires_at timestamptz,is_new_account boolean)
language plpgsql volatile security definer set search_path to '' as $$
begin
  raise exception using errcode='P0001',message='booking_unavailable';
end
$$;

create or replace function public.book_minuta_appointment_with_benefit_v115(
  p_request_id uuid,p_slug text,p_location uuid,p_service uuid,p_date date,p_time time without time zone,
  p_client_name text,p_client_phone text,p_benefit_code text
) returns table(booking_code text,manage_token uuid)
language plpgsql volatile security definer set search_path to '' as $$
begin
  raise exception using errcode='P0001',message='benefit_not_available';
end
$$;

create or replace function public.restore_client_session(p_session_token text)
returns table(normalized_phone text, session_expires_at timestamptz)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_account_id uuid;
  v_expires_at timestamptz;
begin
  select resolved.client_account_id, resolved.session_expires_at
  into v_account_id, v_expires_at
  from public.resolve_client_session(p_session_token) resolved;
  if v_account_id is null then
    return;
  end if;
  return query
  select account.normalized_phone, v_expires_at
  from public.client_accounts account
  where account.id = v_account_id;
end;
$$;

create or replace function public.get_client_bookings_v3(p_session_token text)
returns table(
  booking_code text,manage_token uuid,client_name text,service_id uuid,service_name text,service_active boolean,
  duration_minutes integer,price_rub integer,performer_name text,booking_date date,booking_time time without time zone,
  status text,cancel_allowed boolean,reschedule_allowed boolean,reschedules_remaining integer,
  deposit_amount_rub integer,payment_status text,payment_url text,review_eligible boolean,
  review_rating integer,review_text text,review_created_at timestamptz,payment_due_at timestamptz,refund_status text
)
language plpgsql stable security definer set search_path to '' as $$
declare v_account_id uuid;
begin
  select resolved.client_account_id into v_account_id from public.resolve_client_session(p_session_token) resolved;
  if v_account_id is null then return; end if;
  return query select booking.booking_code::text,booking.manage_token,booking.client_name::text,service.id,
    service.name::text,service.active,booking.duration_minutes::integer,coalesce(booking.total_price_rub,service.price_rub)::integer,
    profile.display_name::text,booking.booking_date,booking.booking_time,
    case when outcome.visit_status='completed' then 'completed' when outcome.visit_status='no_show' then 'no_show' else booking.status end::text,
    booking.status<>'cancelled' and coalesce(outcome.visit_status,'scheduled')='scheduled'
      and timezone('Europe/Samara',now())<=booking.booking_date+booking.booking_time-
        make_interval(hours=>coalesce((booking.booking_policy_snapshot->>'cancel_cutoff_hours')::integer,12)),
    booking.status<>'cancelled' and coalesce(outcome.visit_status,'scheduled')='scheduled'
      and booking.reschedule_count<coalesce((booking.booking_policy_snapshot->>'max_reschedules')::integer,2)
      and timezone('Europe/Samara',now())<=booking.booking_date+booking.booking_time-
        make_interval(hours=>coalesce((booking.booking_policy_snapshot->>'reschedule_cutoff_hours')::integer,12)),
    greatest(0,coalesce((booking.booking_policy_snapshot->>'max_reschedules')::integer,2)-booking.reschedule_count)::integer,
    booking.deposit_amount_rub::integer,booking.payment_status::text,booking.payment_url::text,
    (booking.status<>'cancelled' and outcome.visit_status='completed'),review.rating::integer,review.review_text::text,
    review.created_at,booking.payment_due_at,booking.refund_status::text
  from public.bookings booking join public.services service on service.id=booking.service_id
  join public.performer_profiles profile on profile.id=booking.performer_id
  left join public.booking_outcomes outcome on outcome.booking_id=booking.id
  left join public.booking_reviews review on review.booking_id=booking.id
  where booking.client_account_id=v_account_id
  order by case when booking.status<>'cancelled' and coalesce(outcome.visit_status,'scheduled') not in ('completed','no_show')
    and booking.booking_date+booking.booking_time>=timezone('Europe/Samara',now()) then 0 else 1 end,
    case when booking.status<>'cancelled' and coalesce(outcome.visit_status,'scheduled') not in ('completed','no_show')
      and booking.booking_date+booking.booking_time>=timezone('Europe/Samara',now()) then booking.booking_date+booking.booking_time end,
    booking.booking_date desc,booking.booking_time desc;
end $$;

create or replace function public.submit_booking_review(
  p_session_token text,
  p_manage_token uuid,
  p_rating integer,
  p_review_text text default ''
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_account_id uuid;
  v_booking public.bookings%rowtype;
  v_review_text text := btrim(coalesce(p_review_text, ''));
  v_review_id uuid;
begin
  select resolved.client_account_id
  into v_account_id
  from public.resolve_client_session(p_session_token) resolved;

  if v_account_id is null then
    raise exception using errcode = 'P0001', message = 'invalid_client_session';
  end if;
  if p_rating is null or p_rating not between 1 and 5 then
    raise exception using errcode = 'P0001', message = 'invalid_review_rating';
  end if;
  if char_length(v_review_text) > 1000 then
    raise exception using errcode = 'P0001', message = 'review_too_long';
  end if;

  select booking.* into v_booking
  from public.bookings booking
  where booking.manage_token = p_manage_token
    and booking.client_account_id = v_account_id
    and booking.status <> 'cancelled'
    and exists (
      select 1
      from public.booking_outcomes outcome
      where outcome.booking_id = booking.id
        and outcome.visit_status = 'completed'
    )
  for update;

  if v_booking.id is null then
    raise exception using errcode = 'P0001', message = 'review_not_available';
  end if;

  insert into public.booking_reviews (
    booking_id, performer_id, service_id, client_account_id, rating, review_text, published
  ) values (
    v_booking.id, v_booking.performer_id, v_booking.service_id, v_account_id, p_rating, v_review_text, true
  )
  on conflict (booking_id) do update
  set rating = excluded.rating,
      review_text = excluded.review_text,
      updated_at = now()
  where public.booking_reviews.client_account_id = v_account_id
  returning id into v_review_id;

  if v_review_id is null then
    raise exception using errcode = 'P0001', message = 'review_not_available';
  end if;
  return v_review_id;
end;
$$;

create or replace function public.revoke_client_session(p_session_token text)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'extensions'
as $$
declare
  v_token_hash text;
  v_revoked boolean := false;
begin
  if coalesce(p_session_token, '') !~ '^[0-9a-fA-F]{64}$' then
    return false;
  end if;
  v_token_hash := encode(digest(lower(p_session_token), 'sha256'), 'hex');
  update public.client_device_sessions
  set revoked_at = coalesce(revoked_at, now())
  where token_hash = v_token_hash and revoked_at is null;
  v_revoked := found;
  return v_revoked;
end;
$$;

alter function public.assign_booking_client_account() owner to postgres;
alter function public.bootstrap_client_access(uuid,text) owner to postgres;
alter function public.book_minuta_appointment_with_benefit_v115(
  uuid,text,uuid,uuid,date,time without time zone,text,text,text
) owner to postgres;
alter function public.restore_client_session(text) owner to postgres;
alter function public.get_client_bookings_v3(text) owner to postgres;
alter function public.submit_booking_review(text,uuid,integer,text) owner to postgres;
alter function public.revoke_client_session(text) owner to postgres;
alter function public.rotate_client_access_code(text) owner to postgres;

revoke all on function public.assign_booking_client_account() from public,anon,authenticated;
grant execute on function public.assign_booking_client_account() to service_role;
revoke all on function public.bootstrap_client_access(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.bootstrap_client_access(uuid,text) to anon,authenticated;
revoke all on function public.book_minuta_appointment_with_benefit_v115(
  uuid,text,uuid,uuid,date,time without time zone,text,text,text
) from public,anon,authenticated,service_role;
grant execute on function public.book_minuta_appointment_with_benefit_v115(
  uuid,text,uuid,uuid,date,time without time zone,text,text,text
) to anon,authenticated;
revoke all on function public.restore_client_session(text) from public,anon,authenticated,service_role;
revoke all on function public.get_client_bookings_v3(text) from public,anon,authenticated,service_role;
revoke all on function public.submit_booking_review(text,uuid,integer,text) from public,anon,authenticated,service_role;
revoke all on function public.revoke_client_session(text) from public,anon,authenticated,service_role;
grant execute on function public.restore_client_session(text) to anon,authenticated;
grant execute on function public.get_client_bookings_v3(text) to anon,authenticated;
grant execute on function public.submit_booking_review(text,uuid,integer,text) to anon,authenticated;
grant execute on function public.revoke_client_session(text) to anon,authenticated;
revoke all on function public.rotate_client_access_code(text) from public,anon,authenticated,service_role;
grant execute on function public.rotate_client_access_code(text) to anon,authenticated;

comment on function public.assign_booking_client_account() is 'minuta_client_identity_rollback_safe_v155';
comment on function public.bootstrap_client_access(uuid,text) is 'minuta_client_identity_rollback_safe_v155';
comment on function public.book_minuta_appointment_with_benefit_v115(
  uuid,text,uuid,uuid,date,time without time zone,text,text,text
) is 'minuta_client_identity_rollback_safe_v155';
comment on function public.restore_client_session(text) is null;
comment on function public.get_client_bookings_v3(text) is null;
comment on function public.submit_booking_review(text,uuid,integer,text) is null;
comment on function public.revoke_client_session(text) is null;
comment on function public.rotate_client_access_code(text) is 'minuta_client_identity_rollback_safe_v155';

do $postcondition$
declare v_item record; v_function regprocedure;
begin
  for v_item in select * from (values
    ('public.assign_booking_client_account()','065b00c979459c007bcda7b597c9f22b4e6d879085e7ee384ff04b3a27b5eea9'),
    ('public.bootstrap_client_access(uuid,text)','f44a81abf6333cc9b32e66caa753557985f5791bcf456e3ed3754d7fb76fc74b'),
    ('public.book_minuta_appointment_with_benefit_v115(uuid,text,uuid,uuid,date,time without time zone,text,text,text)','53796773fc8c71ab5c178e1418e403cd706b8d5d1ee0b39a9c8ee3597b3b422c'),
    ('public.restore_client_session(text)','e3ab49fd1035fc7b9d2f411ba472901b5da0e553661ca41e03a9715cdd5ab4f0'),
    ('public.get_client_bookings_v3(text)','d3ef0acdcf8c78d061a4a9968ddc85e9e79f2a3ea9e0f15b066dff88fb4bbb74'),
    ('public.submit_booking_review(text,uuid,integer,text)','433a9f21e3964337c9a4a9d90f64cdd22a1ae50b9432eba76574a80405a3b77f'),
    ('public.revoke_client_session(text)','ae93ead6daa3744db31a84dd44437330d67f63010d67ab9785fa971809bf5d68'),
    ('public.rotate_client_access_code(text)','cb45298118e9bbadbb09481bb2711c061a7073fd9c6ae67a1984a8fe80010ed8')
  ) expected(signature,source_hash) loop
    v_function:=to_regprocedure(v_item.signature);
    if v_function is null or (select encode(extensions.digest(
      convert_to(replace(procedure_row.prosrc,E'\r',''),'UTF8'),'sha256'),'hex')
      from pg_catalog.pg_proc procedure_row where procedure_row.oid=v_function
    ) is distinct from v_item.source_hash then
      raise exception using errcode='55000',message='v155_rollback_postcondition_failed',detail=v_item.signature;
    end if;
  end loop;
  if not has_function_privilege('anon','public.bootstrap_client_access(uuid,text)','EXECUTE')
     or not has_function_privilege('authenticated','public.bootstrap_client_access(uuid,text)','EXECUTE')
     or not has_function_privilege('anon','public.book_minuta_appointment_with_benefit_v115(uuid,text,uuid,uuid,date,time without time zone,text,text,text)','EXECUTE')
     or not has_function_privilege('authenticated','public.book_minuta_appointment_with_benefit_v115(uuid,text,uuid,uuid,date,time without time zone,text,text,text)','EXECUTE')
     or not has_function_privilege('anon','public.rotate_client_access_code(text)','EXECUTE')
     or not has_function_privilege('authenticated','public.rotate_client_access_code(text)','EXECUTE')
     or has_function_privilege('service_role','public.bootstrap_client_access(uuid,text)','EXECUTE')
     or has_function_privilege('service_role','public.book_minuta_appointment_with_benefit_v115(uuid,text,uuid,uuid,date,time without time zone,text,text,text)','EXECUTE') then
    raise exception using errcode='55000',message='v155_rollback_privilege_boundary_drift';
  end if;
  if obj_description('public.rotate_client_access_code(text)'::regprocedure,'pg_proc')
       is distinct from 'minuta_client_identity_rollback_safe_v155' then
    raise exception using errcode='55000',message='v155_rollback_postcondition_failed',detail='public.rotate_client_access_code(text)';
  end if;
end
$postcondition$;

notify pgrst,'reload schema';
commit;
