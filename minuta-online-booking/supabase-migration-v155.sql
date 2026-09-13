-- v155: limited client identity, approved device transfer and session-bound benefits.
begin;
set local lock_timeout='10s';
set local search_path=public,extensions,pg_catalog;

do $prerequisites$
declare
  v_assign regprocedure:=to_regprocedure('public.assign_booking_client_account()');
  v_bootstrap regprocedure:=to_regprocedure('public.bootstrap_client_access(uuid,text)');
  v_public_benefit regprocedure:=to_regprocedure('public.book_minuta_appointment_with_benefit_v115(uuid,text,uuid,uuid,date,time without time zone,text,text,text)');
  v_assign_hash text;
  v_bootstrap_hash text;
  v_public_benefit_hash text;
  v_item record;
  v_function regprocedure;
begin
  if to_regclass('public.client_accounts') is null
     or to_regclass('public.client_device_sessions') is null
     or to_regclass('public.bookings') is null
     or to_regclass('public.booking_outcomes') is null
     or to_regclass('public.commercial_sales') is null
     or to_regclass('public.commercial_sale_lines') is null
     or to_regclass('public.client_benefit_instruments') is null
     or to_regclass('public.benefit_instrument_service_balances') is null
     or to_regclass('public.benefit_redemptions') is null
     or to_regclass('public.benefit_ledger') is null
     or to_regclass('public.benefit_audit_log') is null
     or to_regprocedure('public.normalize_client_phone(text)') is null
     or to_regprocedure('public.resolve_client_session(text)') is null
     or to_regprocedure('public.book_minuta_appointment_v2(uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer)') is null
     or v_bootstrap is null
     or to_regprocedure('public.login_client_access(text,text,text)') is null
     or to_regprocedure('public.rotate_client_access_code(text)') is null
     or to_regprocedure('public.restore_client_session(text)') is null
     or to_regprocedure('public.get_client_bookings_v3(text)') is null
     or to_regprocedure('public.submit_booking_review(text,uuid,integer,text)') is null
     or to_regprocedure('public.revoke_client_session(text)') is null
     or v_public_benefit is null
     or v_assign is null then
    raise exception using errcode='55000',message='v155_requires_client_identity_commerce_and_atomic_booking';
  end if;

  if not exists(
    select 1 from pg_catalog.pg_attribute
    where attrelid='public.bookings'::regclass and attname='client_account_id'
      and attnum>0 and not attisdropped and atttypid='uuid'::regtype
  ) or not exists(
    select 1 from pg_catalog.pg_attribute
    where attrelid='public.bookings'::regclass and attname='booking_source'
      and attnum>0 and not attisdropped and atttypid='text'::regtype
  ) or not exists(
    select 1 from pg_catalog.pg_attribute
    where attrelid='public.bookings'::regclass and attname='created_by_role'
      and attnum>0 and not attisdropped and atttypid='text'::regtype
  ) then
    raise exception using errcode='55000',message='v155_booking_identity_schema_drift';
  end if;

  if exists(select 1 from pg_catalog.pg_attribute
    where attrelid='public.client_benefit_instruments'::regclass and attname='client_version'
      and attnum>0 and not attisdropped)
     and not exists(select 1 from pg_catalog.pg_attribute attribute_row
       join pg_catalog.pg_attrdef default_row
         on default_row.adrelid=attribute_row.attrelid and default_row.adnum=attribute_row.attnum
       where attribute_row.attrelid='public.client_benefit_instruments'::regclass
         and attribute_row.attname='client_version' and attribute_row.atttypid='integer'::regtype
         and attribute_row.attnotnull and pg_catalog.pg_get_expr(default_row.adbin,default_row.adrelid)='1') then
    raise exception using errcode='55000',message='v155_benefit_version_schema_drift';
  end if;

  select encode(extensions.digest(
    convert_to(replace(procedure_row.prosrc,E'\r',''),'UTF8'),'sha256'
  ),'hex') into v_assign_hash
  from pg_catalog.pg_proc procedure_row where procedure_row.oid=v_assign;

  if v_assign_hash not in(
    '76b6e4f7e27ade7b378e7b3af803f75204f41397e3eafc86db61466a0d669e1c',
    '065b00c979459c007bcda7b597c9f22b4e6d879085e7ee384ff04b3a27b5eea9'
  ) then
    raise exception using errcode='55000',message='v155_assign_booking_client_account_drift';
  end if;

  select encode(extensions.digest(
    convert_to(replace(procedure_row.prosrc,E'\r',''),'UTF8'),'sha256'
  ),'hex') into v_bootstrap_hash
  from pg_catalog.pg_proc procedure_row where procedure_row.oid=v_bootstrap;
  if v_bootstrap_hash not in(
    '883ef40330c4e6fad714724108fd0522a8ad634179002d0f16b96ec4caf28951',
    '94c1b8095abc5463911fdf95cfc1ce8ec029165470f123fb3ec6918328014a23',
    'f44a81abf6333cc9b32e66caa753557985f5791bcf456e3ed3754d7fb76fc74b'
  ) then
    raise exception using errcode='55000',message='v155_bootstrap_client_access_drift';
  end if;

  select encode(extensions.digest(
    convert_to(replace(procedure_row.prosrc,E'\r',''),'UTF8'),'sha256'
  ),'hex') into v_public_benefit_hash
  from pg_catalog.pg_proc procedure_row where procedure_row.oid=v_public_benefit;
  if v_public_benefit_hash not in(
    '4575f87c0fda3fa091e5bb984948650fadd77a8aa82e5bb156f5a9d734961955',
    '53796773fc8c71ab5c178e1418e403cd706b8d5d1ee0b39a9c8ee3597b3b422c',
    '53796773fc8c71ab5c178e1418e403cd706b8d5d1ee0b39a9c8ee3597b3b422c'
  ) then
    raise exception using errcode='55000',message='v155_public_benefit_booking_drift';
  end if;

  if exists(
    select 1 from (values
      ('public.restore_client_session(text)', 'e3ab49fd1035fc7b9d2f411ba472901b5da0e553661ca41e03a9715cdd5ab4f0', 'ff71198fb90cd25d506183c3f56735b9e265ea941cdc35602d489615668f3375'),
      ('public.get_client_bookings_v3(text)', 'd3ef0acdcf8c78d061a4a9968ddc85e9e79f2a3ea9e0f15b066dff88fb4bbb74', '3170303328b9dc187fd24e9722e85b9aeaef05bc06384d66617c210783639e09'),
      ('public.submit_booking_review(text,uuid,integer,text)', '433a9f21e3964337c9a4a9d90f64cdd22a1ae50b9432eba76574a80405a3b77f', 'c44fd2ec429a9a68aab42a7674d51954f69b333d682c2c1797a2fa62e10d83d7'),
      ('public.revoke_client_session(text)', 'ae93ead6daa3744db31a84dd44437330d67f63010d67ab9785fa971809bf5d68', '59430788863dfe1ef1c3bd20e65d0bc8466c9299ab3f7b3f825e9c13e4f8b088')
    ) expected(signature,old_hash,new_hash)
    join pg_catalog.pg_proc procedure_row on procedure_row.oid=to_regprocedure(expected.signature)
    where encode(extensions.digest(
      convert_to(replace(procedure_row.prosrc,E'\r',''),'UTF8'),'sha256'
    ),'hex') not in(expected.old_hash,expected.new_hash)
  ) then
    raise exception using errcode='55000',message='v155_legacy_client_reader_drift';
  end if;

  for v_item in select * from (values
    ('public.resolve_client_session(text)','2a70ad04d39ba2d61358a23a1af608d16ed55c09c8456dbad45735d76cf7e172','search_path=pg_catalog,extensions','internal'),
    ('public.login_client_access(text,text,text)','c777cd9ee659220c1fd27a7179b85ce29892a2a177722bd40922b1bfa2a55cba','search_path=pg_catalog,extensions','public'),
    ('public.book_minuta_appointment_v2(uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer)','5920e1426745c8c5425cb15822474952557781b9959d3557f9f3b965e2aae1be','search_path=','public')
  ) expected(signature,source_hash,configuration,exposure) loop
    v_function:=to_regprocedure(v_item.signature);
    if v_function is null or not exists(
      select 1 from pg_catalog.pg_proc procedure_row
      where procedure_row.oid=v_function and procedure_row.prosecdef
        and procedure_row.provolatile='v' and cardinality(procedure_row.proconfig)=1
        and exists(select 1 from unnest(procedure_row.proconfig) configuration
          where replace(replace(configuration,'"',''),' ','')=v_item.configuration)
        and pg_catalog.pg_get_userbyid(procedure_row.proowner)='postgres'
        and encode(extensions.digest(convert_to(replace(procedure_row.prosrc,E'\r',''),'UTF8'),'sha256'),'hex')=v_item.source_hash
    ) or exists(select 1 from pg_catalog.pg_proc procedure_row,
      lateral aclexplode(coalesce(procedure_row.proacl,acldefault('f',procedure_row.proowner))) grant_row
      where procedure_row.oid=v_function and grant_row.grantee=0 and grant_row.privilege_type='EXECUTE')
      or (v_item.exposure='public' and (
        not has_function_privilege('anon',v_function,'EXECUTE')
        or not has_function_privilege('authenticated',v_function,'EXECUTE')
        or has_function_privilege('service_role',v_function,'EXECUTE')))
      or (v_item.exposure='internal' and (
        has_function_privilege('anon',v_function,'EXECUTE')
        or has_function_privilege('authenticated',v_function,'EXECUTE')
        or has_function_privilege('service_role',v_function,'EXECUTE'))) then
      raise exception using errcode='55000',message='v155_legacy_security_dependency_drift',detail=v_item.signature;
    end if;
  end loop;

  v_function:=to_regprocedure('public.rotate_client_access_code(text)');
  if v_function is null or not exists(
    select 1 from pg_catalog.pg_proc procedure_row
    where procedure_row.oid=v_function and procedure_row.prosecdef and procedure_row.provolatile='v'
      and pg_catalog.pg_get_userbyid(procedure_row.proowner)='postgres'
      and ((cardinality(procedure_row.proconfig)=1 and exists(select 1 from unnest(procedure_row.proconfig) configuration
            where replace(replace(configuration,'"',''),' ','')='search_path=pg_catalog,extensions')
          and encode(extensions.digest(convert_to(replace(procedure_row.prosrc,E'\r',''),'UTF8'),'sha256'),'hex')=
            '21222864e0aeb280f0d5fd5974dc928891b3b779a5043365495aaa4b10ddc154')
        or (procedure_row.proconfig=array['search_path=""']::text[]
          and encode(extensions.digest(convert_to(replace(procedure_row.prosrc,E'\r',''),'UTF8'),'sha256'),'hex')=
            'cb45298118e9bbadbb09481bb2711c061a7073fd9c6ae67a1984a8fe80010ed8'))
  ) or not has_function_privilege('anon',v_function,'EXECUTE')
     or not has_function_privilege('authenticated',v_function,'EXECUTE')
     or has_function_privilege('service_role',v_function,'EXECUTE')
     or exists(select 1 from pg_catalog.pg_proc procedure_row,
       lateral aclexplode(coalesce(procedure_row.proacl,acldefault('f',procedure_row.proowner))) grant_row
       where procedure_row.oid=v_function and grant_row.grantee=0 and grant_row.privilege_type='EXECUTE') then
    raise exception using errcode='55000',message='v155_legacy_security_dependency_drift',detail='public.rotate_client_access_code(text)';
  end if;
end
$prerequisites$;

do $version_guard$
declare
  v_present integer;
  v_expected integer:=24;
  v_item record;
  v_function regprocedure;
  v_table regclass;
  v_hash text;
  v_marker text;
begin
  select count(*) into v_present
  from (values
    (to_regclass('public.client_identity_sessions_v155')::oid),
    (to_regclass('public.client_identity_claim_grants_v155')::oid),
    (to_regclass('public.client_identity_transfers_v155')::oid),
    (to_regclass('public.client_identity_booking_requests_v155')::oid),
    (to_regclass('public.client_identity_audit_v155')::oid),
    ((select attribute_row.attrelid from pg_catalog.pg_attribute attribute_row
      where attribute_row.attrelid='public.client_benefit_instruments'::regclass
        and attribute_row.attname='client_version' and attribute_row.attnum>0 and not attribute_row.attisdropped)),
    (to_regprocedure('public.bump_client_benefit_version_v155()')::oid),
    (to_regprocedure('public.protect_client_identity_immutable_v155()')::oid),
    (to_regprocedure('public.resolve_client_identity_session_v155(text)')::oid),
    (to_regprocedure('public.claim_client_booking_identity_v155(uuid,text)')::oid),
    (to_regprocedure('public.upgrade_legacy_client_identity_session_v155(text,text,text)')::oid),
    (to_regprocedure('public.issue_client_identity_claim_grant_v155(uuid,uuid,uuid,integer,uuid)')::oid),
    (to_regprocedure('public.issue_client_identity_sale_claim_v155(uuid,uuid,uuid,integer,uuid,text)')::oid),
    (to_regprocedure('public.inspect_client_identity_sale_claim_v155(text,uuid)')::oid),
    (to_regprocedure('public.consume_client_identity_sale_claim_v155(text,text,uuid)')::oid),
    (to_regprocedure('public.promote_client_identity_v155(text,text)')::oid),
    (to_regprocedure('public.begin_client_identity_transfer_v155(text,text)')::oid),
    (to_regprocedure('public.approve_client_identity_transfer_v155(text,text,text)')::oid),
    (to_regprocedure('public.consume_client_identity_transfer_v155(text,text,text)')::oid),
    (to_regprocedure('public.revoke_client_identity_session_v155(text)')::oid),
    (to_regprocedure('public.get_client_identity_context_v155(text)')::oid),
    (to_regprocedure('public.get_client_commerce_v155(text)')::oid),
    (to_regprocedure('public.reserve_client_benefit_v155(uuid,uuid,uuid,uuid,integer,integer)')::oid),
    (to_regprocedure('public.book_client_with_benefit_v155(text,uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer,text,integer,integer)')::oid)
  ) objects(oid)
  where oid is not null;

  if v_present=0 then return; end if;
  if v_present<>v_expected then
    raise exception using errcode='55000',message='v155_apply_blocked_partial_or_newer_objects';
  end if;

  for v_item in
    select * from (values
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
      ('public.bump_client_benefit_version_v155()', '16ad3f94354913307399d6def6fde1259e51be3cce3b091b02cc28b674bd93d9')
    ) expected(signature,source_hash)
  loop
    if (select encode(extensions.digest(
          convert_to(replace(procedure_row.prosrc,E'\r',''),'UTF8'),'sha256'
        ),'hex')
        from pg_catalog.pg_proc procedure_row
        where procedure_row.oid=to_regprocedure(v_item.signature))
       is distinct from v_item.source_hash then
      raise exception using errcode='55000',message='v155_apply_blocked_newer_function_definition',detail=v_item.signature;
    end if;
  end loop;

  if not exists(select 1 from pg_catalog.pg_attribute attribute_row
      join pg_catalog.pg_attrdef default_row
        on default_row.adrelid=attribute_row.attrelid and default_row.adnum=attribute_row.attnum
      where attribute_row.attrelid='public.client_benefit_instruments'::regclass
        and attribute_row.attname='client_version' and attribute_row.atttypid='integer'::regtype
        and attribute_row.attnotnull and pg_catalog.pg_get_expr(default_row.adbin,default_row.adrelid)='1')
     or not exists(select 1 from pg_catalog.pg_constraint constraint_row
       where constraint_row.conrelid='public.client_benefit_instruments'::regclass
         and constraint_row.conname='client_benefit_instruments_client_version_v155_check'
         and pg_catalog.pg_get_constraintdef(constraint_row.oid,true)='CHECK (client_version >= 1 AND client_version <= 2147483647)')
     or not exists(select 1 from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgrelid='public.client_benefit_instruments'::regclass
         and trigger_row.tgname='client_benefit_instruments_version_v155'
         and not trigger_row.tgisinternal
         and trigger_row.tgfoid='public.bump_client_benefit_version_v155()'::regprocedure
         and trigger_row.tgenabled='O' and trigger_row.tgtype=19) then
    raise exception using errcode='55000',message='v155_benefit_version_contract_drift';
  end if;

  for v_item in select * from (values
    ('public.issue_client_identity_claim_grant_v155(uuid,uuid,uuid,integer,uuid)','cb9c05efc30d2ebcff6c8cc54304cc44fa3cf7789be79dc9299d17db523fa63a'),
    ('public.issue_client_identity_sale_claim_v155(uuid,uuid,uuid,integer,uuid,text)','f782c940ba505260d42d3de8c7931f4d4a57a7f6d19ae32850c5666a7bad89a2')
  ) staff(signature,source_hash) loop
    v_function:=to_regprocedure(v_item.signature);
    if v_function is null or not exists(
      select 1 from pg_catalog.pg_proc procedure_row
      where procedure_row.oid=v_function
        and procedure_row.prosecdef and procedure_row.provolatile='v'
        and procedure_row.proconfig=array['search_path=""']::text[]
        and pg_get_userbyid(procedure_row.proowner)='postgres'
        and encode(extensions.digest(convert_to(replace(procedure_row.prosrc,E'\r',''),'UTF8'),'sha256'),'hex')=v_item.source_hash
        and obj_description(procedure_row.oid,'pg_proc')='minuta_client_identity_v155'
    ) or has_function_privilege('anon',v_function,'EXECUTE')
       or not has_function_privilege('authenticated',v_function,'EXECUTE')
       or not has_function_privilege('service_role',v_function,'EXECUTE')
       or exists(select 1 from pg_catalog.pg_proc procedure_row,
         lateral aclexplode(coalesce(procedure_row.proacl,acldefault('f',procedure_row.proowner))) grant_row
         where procedure_row.oid=v_function and grant_row.grantee=0 and grant_row.privilege_type='EXECUTE') then
      raise exception using errcode='55000',message='v155_staff_claim_contract_drift',detail=v_item.signature;
    end if;
  end loop;

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
        from pg_catalog.pg_trigger trigger_row where trigger_row.tgrelid=v_table and trigger_row.tgconstraint=0)
    )::text,'UTF8'),'sha256'),'hex'),obj_description(v_table,'pg_class')
    into v_hash,v_marker;
    if v_marker is distinct from 'minuta_client_identity_v155:sha256='||v_hash then
      raise exception using errcode='55000',message='v155_apply_blocked_newer_table_definition',detail=v_table::text;
    end if;
  end loop;
end
$version_guard$;

alter table public.client_benefit_instruments
  add column if not exists client_version integer not null default 1;
do $benefit_version_constraint$
begin
  if not exists(select 1 from pg_catalog.pg_constraint
    where conrelid='public.client_benefit_instruments'::regclass
      and conname='client_benefit_instruments_client_version_v155_check') then
    alter table public.client_benefit_instruments
      add constraint client_benefit_instruments_client_version_v155_check
      check(client_version between 1 and 2147483647);
  end if;
end
$benefit_version_constraint$;

create or replace function public.bump_client_benefit_version_v155()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if row(new.status,new.product_snapshot,new.remaining_amount_rub,new.remaining_visits,new.expires_on)
     is distinct from
     row(old.status,old.product_snapshot,old.remaining_amount_rub,old.remaining_visits,old.expires_on) then
    if old.client_version>=2147483647 then
      raise exception using errcode='54000',message='benefit_version_exhausted';
    end if;
    new.client_version:=old.client_version+1;
  else
    new.client_version:=old.client_version;
  end if;
  return new;
end
$$;

drop trigger if exists client_benefit_instruments_version_v155
  on public.client_benefit_instruments;
create trigger client_benefit_instruments_version_v155
before update on public.client_benefit_instruments
for each row execute function public.bump_client_benefit_version_v155();

create table if not exists public.client_identity_sessions_v155(
  id uuid primary key default gen_random_uuid(),
  client_account_id uuid references public.client_accounts(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete restrict,
  claimed_booking_id uuid references public.bookings(id) on delete cascade,
  token_hash text not null unique check(token_hash~'^[0-9a-f]{64}$'),
  session_scope text not null check(session_scope in('booking','organization','account')),
  session_source text not null check(session_source in('manage_token','promotion','sale_claim','transfer','legacy_upgrade')),
  device_name text check(device_name is null or char_length(device_name) between 1 and 120),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check(expires_at>created_at),
  check((session_scope='booking' and claimed_booking_id is not null and client_account_id is null and organization_id is null)
     or (session_scope='organization' and claimed_booking_id is null and client_account_id is not null and organization_id is not null)
     or (session_scope='account' and claimed_booking_id is null and client_account_id is not null and organization_id is null))
);

create index if not exists client_identity_sessions_account_v155_idx
  on public.client_identity_sessions_v155(client_account_id,expires_at desc)
  where session_scope in('organization','account') and revoked_at is null;
create index if not exists client_identity_sessions_booking_v155_idx
  on public.client_identity_sessions_v155(claimed_booking_id,expires_at desc)
  where revoked_at is null;

create table if not exists public.client_identity_claim_grants_v155(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  claim_kind text not null check(claim_kind in('booking','sale')),
  booking_id uuid references public.bookings(id) on delete restrict,
  commercial_sale_id uuid references public.commercial_sales(id) on delete restrict,
  client_account_id uuid not null references public.client_accounts(id) on delete cascade,
  request_id uuid not null,
  issue_generation integer not null default 1 check(issue_generation between 1 and 2147483647),
  token_hash text not null unique check(token_hash~'^[0-9a-f]{64}$'),
  issued_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_by_session_id uuid references public.client_identity_sessions_v155(id) on delete restrict,
  consume_request_id uuid,
  consumed_at timestamptz,
  superseded_at timestamptz,
  failed_attempts integer not null default 0 check(failed_attempts between 0 and 5),
  locked_at timestamptz,
  unique(request_id),
  check(expires_at>created_at and expires_at<=created_at+interval '30 minutes'),
  check((consumed_at is null and consumed_by_session_id is null)
     or (consumed_at is not null and consumed_by_session_id is not null and consume_request_id is not null)),
  check((claim_kind='booking' and booking_id is not null and commercial_sale_id is null)
     or (claim_kind='sale' and booking_id is null and commercial_sale_id is not null))
);

create index if not exists client_identity_claim_grants_expiry_v155_idx
  on public.client_identity_claim_grants_v155(expires_at)
  where consumed_at is null;
create unique index if not exists client_identity_claim_grants_booking_active_v155_idx
  on public.client_identity_claim_grants_v155(booking_id)
  where claim_kind='booking' and consumed_at is null and superseded_at is null;
create unique index if not exists client_identity_claim_grants_sale_active_v155_idx
  on public.client_identity_claim_grants_v155(commercial_sale_id)
  where claim_kind='sale' and consumed_at is null and superseded_at is null;

create table if not exists public.client_identity_transfers_v155(
  id uuid primary key default gen_random_uuid(),
  transfer_token_hash text not null unique check(transfer_token_hash~'^[0-9a-f]{64}$'),
  display_code_hash text not null unique check(display_code_hash~'^[0-9a-f]{64}$'),
  requested_device_name text check(requested_device_name is null or char_length(requested_device_name) between 1 and 120),
  client_account_id uuid references public.client_accounts(id) on delete cascade,
  approved_by_session_id uuid references public.client_identity_sessions_v155(id) on delete restrict,
  consumed_session_id uuid references public.client_identity_sessions_v155(id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  approved_at timestamptz,
  consumed_at timestamptz,
  failed_attempts integer not null default 0 check(failed_attempts between 0 and 5),
  locked_at timestamptz,
  check(expires_at>created_at and expires_at<=created_at+interval '15 minutes'),
  check(client_account_id is not null and approved_by_session_id is not null),
  check((consumed_at is null and consumed_session_id is null)
     or (consumed_at is not null and consumed_session_id is not null and approved_at is not null))
);

create index if not exists client_identity_transfers_expiry_v155_idx
  on public.client_identity_transfers_v155(expires_at)
  where consumed_at is null;

create table if not exists public.client_identity_booking_requests_v155(
  request_id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  booking_id uuid not null unique references public.bookings(id) on delete restrict,
  client_account_id uuid not null references public.client_accounts(id) on delete restrict,
  instrument_id uuid not null references public.client_benefit_instruments(id) on delete restrict,
  redemption_id uuid not null references public.benefit_redemptions(id) on delete restrict,
  benefit_version integer not null check(benefit_version between 1 and 2147483647),
  amount_rub integer check(amount_rub is null or amount_rub>0),
  request_fingerprint text not null check(request_fingerprint~'^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

create table if not exists public.client_identity_audit_v155(
  id bigint generated always as identity primary key,
  client_account_id uuid references public.client_accounts(id) on delete restrict,
  session_id uuid references public.client_identity_sessions_v155(id) on delete restrict,
  booking_id uuid references public.bookings(id) on delete restrict,
  action text not null check(char_length(action) between 3 and 80),
  subject_id uuid,
  details jsonb not null default '{}'::jsonb check(jsonb_typeof(details)='object'),
  created_at timestamptz not null default now()
);

create index if not exists client_identity_audit_account_v155_idx
  on public.client_identity_audit_v155(client_account_id,created_at desc,id desc);

alter table public.client_identity_sessions_v155 enable row level security;
alter table public.client_identity_claim_grants_v155 enable row level security;
alter table public.client_identity_transfers_v155 enable row level security;
alter table public.client_identity_booking_requests_v155 enable row level security;
alter table public.client_identity_audit_v155 enable row level security;

revoke all on table public.client_identity_sessions_v155,
  public.client_identity_claim_grants_v155,
  public.client_identity_transfers_v155,
  public.client_identity_booking_requests_v155,
  public.client_identity_audit_v155 from public,anon,authenticated,service_role;

alter table public.client_identity_sessions_v155 owner to postgres;
alter table public.client_identity_claim_grants_v155 owner to postgres;
alter table public.client_identity_transfers_v155 owner to postgres;
alter table public.client_identity_booking_requests_v155 owner to postgres;
alter table public.client_identity_audit_v155 owner to postgres;

create or replace function public.protect_client_identity_immutable_v155()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  raise exception using errcode='55000',message='client_identity_history_is_immutable';
end
$$;

drop trigger if exists client_identity_booking_requests_immutable_v155
  on public.client_identity_booking_requests_v155;
create trigger client_identity_booking_requests_immutable_v155
before update or delete on public.client_identity_booking_requests_v155
for each row execute function public.protect_client_identity_immutable_v155();

drop trigger if exists client_identity_audit_immutable_v155
  on public.client_identity_audit_v155;
create trigger client_identity_audit_immutable_v155
before update or delete on public.client_identity_audit_v155
for each row execute function public.protect_client_identity_immutable_v155();

-- Public booking data must never attach itself to a global account merely from
-- a phone number supplied by an unauthenticated caller. Existing non-null
-- bindings also survive contact edits; explicit staff identity merge is separate.
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

-- Keep the live RPC signature while closing the phone-only escalation. The
-- returned token is limited to the exact booking and no reusable code is made.
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
volatile
security definer
set search_path to ''
as $$
declare
  v_claim record;
begin
  select * into v_claim
  from public.claim_client_booking_identity_v155(p_manage_token,p_device_name);
  return query select null::text,v_claim.session_token,
    v_claim.session_expires_at,false;
end
$$;

-- The old public-code booking contract cannot prove account ownership. Keep
-- the signature for deployed callers, but fail closed until they use v155.
create or replace function public.book_minuta_appointment_with_benefit_v115(
  p_request_id uuid,p_slug text,p_location uuid,p_service uuid,p_date date,p_time time without time zone,
  p_client_name text,p_client_phone text,p_benefit_code text
)
returns table(booking_code text,manage_token uuid)
language plpgsql
volatile
security definer
set search_path to ''
as $$
begin
  raise exception using errcode='P0001',message='benefit_not_available';
end
$$;

create or replace function public.resolve_client_identity_session_v155(p_session_token text)
returns table(
  session_id uuid,
  client_account_id uuid,
  organization_id uuid,
  claimed_booking_id uuid,
  session_scope text,
  session_expires_at timestamptz
)
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_hash text;
begin
  if coalesce(p_session_token,'')!~'^[0-9a-fA-F]{64}$' then return; end if;
  v_hash:=encode(extensions.digest(lower(p_session_token),'sha256'),'hex');
  return query
  update public.client_identity_sessions_v155 session_row
  set last_seen_at=now()
  where session_row.token_hash=v_hash
    and session_row.revoked_at is null
    and session_row.expires_at>now()
  returning session_row.id,session_row.client_account_id,session_row.organization_id,
    session_row.claimed_booking_id,session_row.session_scope,session_row.expires_at;
end
$$;

create or replace function public.claim_client_booking_identity_v155(
  p_manage_token uuid,
  p_device_name text default null
)
returns table(
  session_token text,
  session_scope text,
  session_expires_at timestamptz
)
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_booking public.bookings%rowtype;
  v_session uuid;
  v_token text;
  v_expires timestamptz:=now()+interval '30 days';
begin
  if p_manage_token is null
     or (p_device_name is not null and char_length(btrim(p_device_name)) not between 1 and 120) then
    raise exception using errcode='P0001',message='booking_unavailable';
  end if;

  select booking.* into v_booking
  from public.bookings booking
  where booking.manage_token=p_manage_token
    and booking.status<>'cancelled'
    and booking.client_access_eligible_until is not null
    and booking.client_access_eligible_until>=now()
  for update;
  if not found then
    raise exception using errcode='P0001',message='booking_unavailable';
  end if;

  v_token:=encode(extensions.gen_random_bytes(32),'hex');
  insert into public.client_identity_sessions_v155(
    claimed_booking_id,token_hash,session_scope,session_source,device_name,expires_at
  ) values(
    v_booking.id,encode(extensions.digest(v_token,'sha256'),'hex'),
    'booking','manage_token',nullif(btrim(p_device_name),''),v_expires
  ) returning id into v_session;

  insert into public.client_identity_audit_v155(
    session_id,booking_id,action,subject_id,details
  ) values(
    v_session,v_booking.id,'booking_identity_claimed',v_booking.id,
    jsonb_build_object('scope','booking','device_name',nullif(btrim(p_device_name),''))
  );

  return query select v_token,'booking'::text,v_expires;
end
$$;

create or replace function public.upgrade_legacy_client_identity_session_v155(
  p_legacy_session_token text,
  p_access_code text,
  p_device_name text default null
)
returns table(session_token text,session_expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_legacy public.client_device_sessions%rowtype;
  v_legacy_hash text;
  v_code_raw text:=upper(regexp_replace(coalesce(p_access_code,''),'[^0-9A-Fa-f]','','g'));
  v_account public.client_accounts%rowtype;
  v_token text;
  v_token_hash text;
  v_session uuid;
  v_expires timestamptz:=now()+interval '30 days';
  v_attempt integer;
begin
  if coalesce(p_legacy_session_token,'')!~'^[0-9a-fA-F]{64}$' or char_length(v_code_raw)<>16
     or (p_device_name is not null and char_length(btrim(p_device_name)) not between 1 and 120) then
    raise exception using errcode='P0001',message='invalid_client_session';
  end if;
  v_legacy_hash:=encode(extensions.digest(lower(p_legacy_session_token),'sha256'),'hex');
  select legacy.* into v_legacy from public.client_device_sessions legacy
  where legacy.token_hash=v_legacy_hash and legacy.revoked_at is null and legacy.expires_at>now()
  for update;
  if not found then raise exception using errcode='P0001',message='invalid_client_session'; end if;
  select account.* into v_account from public.client_accounts account
  where account.id=v_legacy.client_account_id for update;
  if not found or v_account.access_code_hash<>encode(extensions.digest(
    v_code_raw||':'||v_account.id::text,'sha256'),'hex') then
    raise exception using errcode='P0001',message='invalid_client_session';
  end if;

  for v_attempt in 1..8 loop
    v_token:=encode(extensions.gen_random_bytes(32),'hex');
    v_token_hash:=encode(extensions.digest(v_token,'sha256'),'hex');
    if not exists(select 1 from public.client_device_sessions legacy where legacy.token_hash=v_token_hash)
       and not exists(select 1 from public.client_identity_sessions_v155 session_row where session_row.token_hash=v_token_hash) then
      insert into public.client_identity_sessions_v155(
        client_account_id,token_hash,session_scope,session_source,device_name,expires_at
      ) values(
        v_legacy.client_account_id,v_token_hash,'account','legacy_upgrade',
        coalesce(nullif(btrim(p_device_name),''),v_legacy.device_name),v_expires
      ) returning id into v_session;
      exit;
    end if;
  end loop;
  if v_session is null then raise exception using errcode='55000',message='session_generation_failed'; end if;

  update public.client_device_sessions set revoked_at=now() where id=v_legacy.id and revoked_at is null;
  if not found then raise exception using errcode='P0001',message='invalid_client_session'; end if;
  insert into public.client_identity_audit_v155(client_account_id,session_id,action,subject_id,details)
  values(v_legacy.client_account_id,v_session,'legacy_session_upgraded',v_legacy.id,
    jsonb_build_object('legacy_session_revoked',true));
  return query select v_token,v_expires;
end
$$;

create or replace function public.issue_client_identity_claim_grant_v155(
  p_organization uuid,
  p_booking uuid,
  p_request_id uuid,
  p_expires_minutes integer default 10,
  p_actor uuid default null
)
returns table(claim_token text,claim_expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_user uuid:=auth.uid();
  v_is_service boolean:=coalesce(auth.role(),'')='service_role';
  v_issuer uuid;
  v_actor_key text;
  v_booking public.bookings%rowtype;
  v_phone text;
  v_token text;
  v_expires timestamptz;
  v_grant uuid;
  v_account uuid;
  v_account_secret text;
  v_generation integer:=1;
  v_created_account boolean:=false;
  v_linked boolean:=false;
  v_existing public.client_identity_claim_grants_v155%rowtype;
begin
  v_issuer:=case when v_is_service then p_actor else v_user end;
  v_actor_key:=v_issuer::text;
  if p_organization is null or p_booking is null or p_request_id is null
     or coalesce(p_expires_minutes,0) not between 1 and 10
     or v_issuer is null
     or (not v_is_service and p_actor is not null and p_actor is distinct from v_user)
     or not exists(
       select 1 from public.organization_memberships membership
       where membership.organization_id=p_organization
         and membership.user_id=v_issuer and membership.active
     ) then
    raise exception using errcode='42501',message='client_claim_grant_denied';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'client-identity-issue:'||p_request_id::text,0));
  select public.normalize_client_phone(booking.client_phone) into v_phone
  from public.bookings booking
  where booking.id=p_booking and booking.organization_id=p_organization;
  if v_phone!~'^7[0-9]{10}$' then
    raise exception using errcode='42501',message='client_claim_grant_denied';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('client-account:'||v_phone,0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'client-identity-booking:'||p_organization::text||':'||p_booking::text,0));
  select booking.* into v_booking from public.bookings booking
  where booking.id=p_booking and booking.organization_id=p_organization
    and booking.status<>'cancelled'
    and (booking.status='confirmed' or booking.payment_status='paid')
  for update;
  if not found or v_booking.client_phone='0000000000'
     or public.normalize_client_phone(v_booking.client_phone) is distinct from v_phone then
    raise exception using errcode='42501',message='client_claim_grant_denied';
  end if;
  if not exists(select 1 from public.organization_memberships membership
    where membership.organization_id=p_organization and membership.user_id=v_issuer and membership.active
      and (membership.role in('owner','admin')
        or (membership.role='specialist' and v_booking.performer_id=v_issuer))) then
    raise exception using errcode='42501',message='client_claim_grant_denied';
  end if;
  select account.id,account.access_code_hash into v_account,v_account_secret from public.client_accounts account
  where account.normalized_phone=v_phone for update;
  if v_account is null then
    v_account:=extensions.gen_random_uuid();
    v_account_secret:=encode(extensions.digest(
      encode(extensions.gen_random_bytes(32),'hex')||':'||v_account::text,'sha256'),'hex');
    insert into public.client_accounts(id,normalized_phone,access_code_hash)
    values(v_account,v_phone,v_account_secret);
    v_created_account:=true;
  end if;
  if v_booking.client_account_id is not null
     and v_booking.client_account_id is distinct from v_account then
    raise exception using errcode='23505',message='client_identity_subject_conflict';
  end if;
  update public.bookings set client_account_id=v_account
  where id=p_booking and organization_id=p_organization and client_account_id is null;
  v_linked:=found;
  if v_linked then
    insert into public.client_identity_audit_v155(client_account_id,booking_id,action,subject_id,details)
    values(v_account,p_booking,'client_account_enrolled_from_booking',p_booking,
      jsonb_build_object('organization_ref','ptorg_'||encode(extensions.digest(
        'v155-organization:'||p_organization::text,'sha256'),'hex'),
        'account_created',v_created_account));
  end if;

  select grant_row.* into v_existing
  from public.client_identity_claim_grants_v155 grant_row
  where grant_row.organization_id=p_organization and grant_row.request_id=p_request_id
  for update;
  if found then
    if v_existing.claim_kind<>'booking' or v_existing.booking_id is distinct from p_booking
       or v_existing.client_account_id is distinct from v_account
       or v_existing.issued_by is distinct from v_issuer then
      raise exception using errcode='23505',message='client_claim_request_conflict';
    end if;
    if v_existing.consumed_at is not null then
      raise exception using errcode='P0001',message='client_claim_already_consumed';
    end if;
    if v_existing.superseded_at is not null then
      raise exception using errcode='P0001',message='client_claim_superseded';
    end if;
    if v_existing.expires_at<=now() then
      if exists(select 1 from public.client_identity_claim_grants_v155 grant_row
        where grant_row.claim_kind='booking' and grant_row.booking_id=p_booking
          and grant_row.id<>v_existing.id and grant_row.consumed_at is null
          and grant_row.superseded_at is null and grant_row.expires_at>now()) then
        raise exception using errcode='P0001',message='client_claim_superseded';
      end if;
      if v_existing.issue_generation>=2147483647 then
        raise exception using errcode='54000',message='client_claim_generation_exhausted';
      end if;
      v_generation:=v_existing.issue_generation+1;
      v_token:=encode(extensions.digest(
        'v155-booking-claim:'||v_account_secret||':'||p_organization::text||':'||p_booking::text||':'||p_request_id::text||':'||v_actor_key||':'||v_generation::text,
        'sha256'
      ),'hex');
      v_expires:=now()+make_interval(mins=>p_expires_minutes);
      update public.client_identity_claim_grants_v155 set
        issue_generation=v_generation,
        token_hash=encode(extensions.digest(v_token,'sha256'),'hex'),
        created_at=now(),expires_at=v_expires,superseded_at=null,failed_attempts=0,locked_at=null
      where id=v_existing.id;
      insert into public.client_identity_audit_v155(client_account_id,action,subject_id,details)
      values(v_account,'client_claim_grant_reissued',v_existing.id,
        jsonb_build_object('claim_kind','booking','issue_generation',v_generation));
      return query select v_token,v_expires;
      return;
    end if;
    v_token:=encode(extensions.digest(
      'v155-booking-claim:'||v_account_secret||':'||p_organization::text||':'||p_booking::text||':'||p_request_id::text||':'||v_actor_key||':'||v_existing.issue_generation::text,
      'sha256'
    ),'hex');
    return query select v_token,v_existing.expires_at;
    return;
  end if;
  v_token:=encode(extensions.digest(
    'v155-booking-claim:'||v_account_secret||':'||p_organization::text||':'||p_booking::text||':'||p_request_id::text||':'||v_actor_key||':1',
    'sha256'
  ),'hex');
  v_expires:=now()+make_interval(mins=>p_expires_minutes);
  update public.client_identity_claim_grants_v155
  set superseded_at=now()
  where claim_kind='booking' and booking_id=p_booking
    and consumed_at is null and superseded_at is null;
  insert into public.client_identity_claim_grants_v155(
    organization_id,claim_kind,booking_id,client_account_id,request_id,
    token_hash,issued_by,expires_at
  ) values(
    p_organization,'booking',p_booking,v_account,p_request_id,
    encode(extensions.digest(v_token,'sha256'),'hex'),v_issuer,v_expires
  ) returning id into v_grant;
  insert into public.client_identity_audit_v155(
    client_account_id,action,subject_id,details
  ) values(
    v_account,'client_claim_grant_issued',v_grant,
    jsonb_build_object('claim_kind','booking','request_ref',
      encode(extensions.digest('v155-claim-request:'||p_request_id::text,'sha256'),'hex'))
  );
  return query select v_token,v_expires;
end
$$;

create or replace function public.issue_client_identity_sale_claim_v155(
  p_organization uuid,
  p_sale uuid,
  p_request_id uuid,
  p_expires_minutes integer default 10,
  p_actor uuid default null,
  p_client_phone text default null
)
returns table(claim_token text,claim_expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_user uuid:=auth.uid();
  v_is_service boolean:=coalesce(auth.role(),'')='service_role';
  v_issuer uuid;
  v_actor_key text;
  v_sale public.commercial_sales%rowtype;
  v_booking public.bookings%rowtype;
  v_booking_id uuid;
  v_account uuid;
  v_account_secret text;
  v_phone text;
  v_created_account boolean:=false;
  v_booking_linked boolean:=false;
  v_sale_linked boolean:=false;
  v_existing public.client_identity_claim_grants_v155%rowtype;
  v_token text;
  v_expires timestamptz;
  v_grant uuid;
  v_generation integer:=1;
begin
  v_issuer:=case when v_is_service then p_actor else v_user end;
  v_actor_key:=v_issuer::text;
  if p_organization is null or p_sale is null or p_request_id is null
     or coalesce(p_expires_minutes,0) not between 1 and 10
     or v_issuer is null
     or (not v_is_service and p_actor is not null and p_actor is distinct from v_user)
     or not exists(select 1 from public.organization_memberships membership
       where membership.organization_id=p_organization and membership.user_id=v_issuer
         and membership.active) then
    raise exception using errcode='42501',message='client_sale_claim_denied';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'client-identity-issue:'||p_request_id::text,0));
  select sale.* into v_sale from public.commercial_sales sale
  where sale.id=p_sale and sale.organization_id=p_organization
    and sale.status='paid' and sale.refunded_minor=0
    and sale.payment_method in('cash','manual');
  if not found then raise exception using errcode='42501',message='client_sale_claim_denied'; end if;
  v_booking_id:=v_sale.booking_id;
  if not exists(select 1 from public.organization_memberships membership
    where membership.organization_id=p_organization and membership.user_id=v_issuer and membership.active
      and (membership.role in('owner','admin')
        or (membership.role='specialist' and (v_sale.seller_id=v_issuer
          or exists(select 1 from public.bookings booking
            where booking.id=v_booking_id and booking.organization_id=p_organization
              and booking.performer_id=v_issuer))))) then
    raise exception using errcode='42501',message='client_sale_claim_denied';
  end if;

  if v_booking_id is not null then
    select public.normalize_client_phone(booking.client_phone) into v_phone
    from public.bookings booking
    where booking.id=v_booking_id and booking.organization_id=p_organization;
  elsif v_sale.client_account_id is not null then
    select account.normalized_phone into v_phone
    from public.client_accounts account where account.id=v_sale.client_account_id;
  else
    v_phone:=public.normalize_client_phone(p_client_phone);
  end if;
  if v_phone!~'^7[0-9]{10}$' or (p_client_phone is not null
     and public.normalize_client_phone(p_client_phone) is distinct from v_phone) then
    raise exception using errcode='22023',message='invalid_client_phone';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('client-account:'||v_phone,0));
  select account.id,account.access_code_hash into v_account,v_account_secret from public.client_accounts account
  where account.normalized_phone=v_phone for update;
  if v_account is null then
    v_account:=extensions.gen_random_uuid();
    v_account_secret:=encode(extensions.digest(
      encode(extensions.gen_random_bytes(32),'hex')||':'||v_account::text,'sha256'),'hex');
    insert into public.client_accounts(id,normalized_phone,access_code_hash)
    values(v_account,v_phone,v_account_secret);
    v_created_account:=true;
  end if;

  if v_booking_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'client-identity-booking:'||p_organization::text||':'||v_booking_id::text,0));
    select booking.* into v_booking from public.bookings booking
    where booking.id=v_booking_id and booking.organization_id=p_organization
      and booking.status<>'cancelled'
    for update;
    if not found or public.normalize_client_phone(v_booking.client_phone) is distinct from v_phone
       or (v_booking.client_account_id is not null and v_booking.client_account_id is distinct from v_account) then
      raise exception using errcode='23505',message='client_identity_subject_conflict';
    end if;
    update public.bookings set client_account_id=v_account
    where id=v_booking_id and organization_id=p_organization and client_account_id is null;
    v_booking_linked:=found;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'client-identity-sale:'||p_organization::text||':'||p_sale::text,0));
  select sale.* into v_sale from public.commercial_sales sale
  where sale.id=p_sale and sale.organization_id=p_organization
    and sale.booking_id is not distinct from v_booking_id
    and sale.status='paid' and sale.refunded_minor=0
    and sale.payment_method in('cash','manual')
  for update;
  if not found or (v_sale.client_account_id is not null
     and v_sale.client_account_id is distinct from v_account) then
    raise exception using errcode='23505',message='client_identity_subject_conflict';
  end if;
  if not exists(select 1 from public.organization_memberships membership
    where membership.organization_id=p_organization and membership.user_id=v_issuer and membership.active
      and (membership.role in('owner','admin')
        or (membership.role='specialist' and (v_sale.seller_id=v_issuer
          or (v_booking_id is not null and v_booking.performer_id=v_issuer))))) then
    raise exception using errcode='42501',message='client_sale_claim_denied';
  end if;
  update public.commercial_sales set client_account_id=v_account
  where id=p_sale and organization_id=p_organization and client_account_id is null;
  v_sale_linked:=found;
  v_sale.client_account_id:=v_account;
  if exists(select 1 from public.commercial_sale_lines sale_line
    join public.client_benefit_instruments instrument on instrument.id=sale_line.benefit_instrument_id
    where sale_line.sale_id=p_sale and sale_line.organization_id=p_organization
      and instrument.client_account_id is distinct from v_account) then
    raise exception using errcode='23505',message='client_identity_subject_conflict';
  end if;
  if v_booking_linked or v_sale_linked then
    insert into public.client_identity_audit_v155(client_account_id,action,subject_id,details)
    values(v_account,'client_account_enrolled_from_sale',p_sale,
      jsonb_build_object('organization_ref','ptorg_'||encode(extensions.digest(
        'v155-organization:'||p_organization::text,'sha256'),'hex'),
        'account_created',v_created_account,'booking_linked',v_booking_linked));
    insert into public.commercial_audit_log(organization_id,actor_id,action,subject_id,details)
    values(p_organization,v_issuer,'client_identity_sale_linked',p_sale,
      jsonb_build_object('account_ref','ptac_'||encode(extensions.digest(
        'v155-account:'||v_account::text,'sha256'),'hex')));
  end if;

  select grant_row.* into v_existing from public.client_identity_claim_grants_v155 grant_row
  where grant_row.organization_id=p_organization and grant_row.request_id=p_request_id
  for update;
  if found then
    if v_existing.claim_kind<>'sale' or v_existing.commercial_sale_id is distinct from p_sale
       or v_existing.client_account_id is distinct from v_sale.client_account_id
       or v_existing.issued_by is distinct from v_issuer then
      raise exception using errcode='23505',message='client_claim_request_conflict';
    end if;
    if v_existing.consumed_at is not null then
      raise exception using errcode='P0001',message='client_claim_already_consumed';
    end if;
    if v_existing.superseded_at is not null then
      raise exception using errcode='P0001',message='client_claim_superseded';
    end if;
    if v_existing.expires_at<=now() then
      if exists(select 1 from public.client_identity_claim_grants_v155 grant_row
        where grant_row.claim_kind='sale' and grant_row.commercial_sale_id=p_sale
          and grant_row.id<>v_existing.id and grant_row.consumed_at is null
          and grant_row.superseded_at is null and grant_row.expires_at>now()) then
        raise exception using errcode='P0001',message='client_claim_superseded';
      end if;
      if v_existing.issue_generation>=2147483647 then
        raise exception using errcode='54000',message='client_claim_generation_exhausted';
      end if;
      v_generation:=v_existing.issue_generation+1;
      v_token:=upper(substr(encode(extensions.digest(
        'v155-sale-claim:'||v_account_secret||':'||p_organization::text||':'||p_sale::text||':'||p_request_id::text||':'||v_actor_key||':'||v_generation::text,
        'sha256'
      ),'hex'),1,16));
      v_token:='PTS1-'||substr(v_token,1,4)||'-'||substr(v_token,5,4)||'-'||substr(v_token,9,4)||'-'||substr(v_token,13,4);
      v_expires:=now()+make_interval(mins=>p_expires_minutes);
      update public.client_identity_claim_grants_v155 set
        issue_generation=v_generation,
        token_hash=encode(extensions.digest(replace(v_token,'-',''),'sha256'),'hex'),
        created_at=now(),expires_at=v_expires,superseded_at=null,failed_attempts=0,locked_at=null
      where id=v_existing.id;
      insert into public.client_identity_audit_v155(client_account_id,action,subject_id,details)
      values(v_sale.client_account_id,'client_sale_claim_reissued',v_existing.id,
        jsonb_build_object('claim_kind','sale','issue_generation',v_generation));
      return query select v_token,v_expires;
      return;
    end if;
    v_token:=upper(substr(encode(extensions.digest(
      'v155-sale-claim:'||v_account_secret||':'||p_organization::text||':'||p_sale::text||':'||p_request_id::text||':'||v_actor_key||':'||v_existing.issue_generation::text,
      'sha256'
    ),'hex'),1,16));
    v_token:='PTS1-'||substr(v_token,1,4)||'-'||substr(v_token,5,4)||'-'||substr(v_token,9,4)||'-'||substr(v_token,13,4);
    return query select v_token,v_existing.expires_at;
    return;
  end if;
  update public.client_identity_claim_grants_v155 set superseded_at=now()
  where claim_kind='sale' and commercial_sale_id=p_sale
    and consumed_at is null and superseded_at is null;
  v_token:=upper(substr(encode(extensions.digest(
    'v155-sale-claim:'||v_account_secret||':'||p_organization::text||':'||p_sale::text||':'||p_request_id::text||':'||v_actor_key||':1',
    'sha256'
  ),'hex'),1,16));
  v_token:='PTS1-'||substr(v_token,1,4)||'-'||substr(v_token,5,4)||'-'||substr(v_token,9,4)||'-'||substr(v_token,13,4);
  v_expires:=now()+make_interval(mins=>p_expires_minutes);
  insert into public.client_identity_claim_grants_v155(
    organization_id,claim_kind,commercial_sale_id,client_account_id,request_id,
    token_hash,issued_by,expires_at
  ) values(
    p_organization,'sale',p_sale,v_sale.client_account_id,p_request_id,
    encode(extensions.digest(replace(v_token,'-',''),'sha256'),'hex'),v_issuer,v_expires
  ) returning id into v_grant;
  insert into public.client_identity_audit_v155(client_account_id,action,subject_id,details)
  values(v_sale.client_account_id,'client_sale_claim_issued',v_grant,
    jsonb_build_object('claim_kind','sale','purchase_ref',
      'ptpu_'||encode(extensions.digest('v155-purchase:'||p_sale::text,'sha256'),'hex')));
  return query select v_token,v_expires;
end
$$;

create or replace function public.inspect_client_identity_sale_claim_v155(
  p_claim_token text,
  p_request_id uuid
)
returns table(
  account_ref text,
  organization_ref text,
  claim_scope text,
  claim_status text,
  claim_expires_at timestamptz,
  revision text
)
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_grant public.client_identity_claim_grants_v155%rowtype;
  v_sale public.commercial_sales%rowtype;
  v_booking public.bookings%rowtype;
  v_booking_id uuid;
  v_phone text;
  v_claim_normalized text:=replace(upper(btrim(coalesce(p_claim_token,''))),'-','');
begin
  if btrim(coalesce(p_claim_token,''))!~'^PTS1-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$'
     or p_request_id is null then
    return;
  end if;
  select grant_row.* into v_grant
  from public.client_identity_claim_grants_v155 grant_row
  where grant_row.claim_kind='sale'
    and grant_row.token_hash=encode(extensions.digest(v_claim_normalized,'sha256'),'hex')
  ;
  if not found then return; end if;
  select account.normalized_phone into v_phone from public.client_accounts account
  where account.id=v_grant.client_account_id;
  select sale.booking_id into v_booking_id from public.commercial_sales sale
  where sale.id=v_grant.commercial_sale_id and sale.organization_id=v_grant.organization_id;
  if v_phone is null or not found then return; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('client-account:'||v_phone,0));
  if v_booking_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'client-identity-booking:'||v_grant.organization_id::text||':'||v_booking_id::text,0));
    select booking.* into v_booking from public.bookings booking
    where booking.id=v_booking_id and booking.organization_id=v_grant.organization_id
    for update;
    if not found then return; end if;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'client-identity-sale:'||v_grant.organization_id::text||':'||v_grant.commercial_sale_id::text,0));
  select sale.* into v_sale from public.commercial_sales sale
  where sale.id=v_grant.commercial_sale_id and sale.organization_id=v_grant.organization_id
  for update;
  if not found then return; end if;
  select grant_row.* into v_grant
  from public.client_identity_claim_grants_v155 grant_row
  where grant_row.id=v_grant.id and grant_row.claim_kind='sale'
    and grant_row.token_hash=encode(extensions.digest(v_claim_normalized,'sha256'),'hex')
  for update;
  if not found or v_grant.locked_at is not null or v_grant.failed_attempts>=5
     or v_grant.consumed_at is not null or v_grant.superseded_at is not null
     or v_grant.expires_at<=now() then
    return;
  end if;
  if v_sale.client_account_id is distinct from v_grant.client_account_id
     or v_sale.booking_id is distinct from v_booking_id
     or v_sale.status<>'paid' or v_sale.refunded_minor<>0
     or v_sale.payment_method not in('cash','manual')
     or (v_booking_id is not null and (v_booking.client_account_id is distinct from v_grant.client_account_id
       or v_booking.status='cancelled')) then
    return;
  end if;
  return query select
    'ptac_'||encode(extensions.digest('v155-account:'||v_grant.client_account_id::text,'sha256'),'hex'),
    'ptorg_'||encode(extensions.digest('v155-organization:'||v_grant.organization_id::text,'sha256'),'hex'),
    'purchase'::text,'active'::text,v_grant.expires_at,
    'ptrv_'||encode(extensions.digest('v155-sale-claim:'||v_grant.id::text,'sha256'),'hex');
end
$$;

create or replace function public.consume_client_identity_sale_claim_v155(
  p_claim_token text,
  p_device_name text,
  p_request_id uuid
)
returns table(
  session_token text,
  session_scope text,
  account_ref text,
  organization_ref text,
  revision text,
  session_expires_at timestamptz,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_grant public.client_identity_claim_grants_v155%rowtype;
  v_sale public.commercial_sales%rowtype;
  v_booking public.bookings%rowtype;
  v_booking_id uuid;
  v_phone text;
  v_claim_normalized text:=replace(upper(btrim(coalesce(p_claim_token,''))),'-','');
  v_token text;
  v_token_hash text;
  v_session uuid;
  v_expires timestamptz:=now()+interval '30 days';
begin
  if btrim(coalesce(p_claim_token,''))!~'^PTS1-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$'
     or p_request_id is null
     or (p_device_name is not null and char_length(btrim(p_device_name)) not between 1 and 120) then
    return;
  end if;
  select grant_row.* into v_grant from public.client_identity_claim_grants_v155 grant_row
  where grant_row.claim_kind='sale'
    and grant_row.token_hash=encode(extensions.digest(v_claim_normalized,'sha256'),'hex')
  ;
  if not found then return; end if;
  select account.normalized_phone into v_phone from public.client_accounts account
  where account.id=v_grant.client_account_id;
  select sale.booking_id into v_booking_id from public.commercial_sales sale
  where sale.id=v_grant.commercial_sale_id and sale.organization_id=v_grant.organization_id;
  if v_phone is null or not found then return; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('client-account:'||v_phone,0));
  if v_booking_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'client-identity-booking:'||v_grant.organization_id::text||':'||v_booking_id::text,0));
    select booking.* into v_booking from public.bookings booking
    where booking.id=v_booking_id and booking.organization_id=v_grant.organization_id
    for update;
    if not found then return; end if;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'client-identity-sale:'||v_grant.organization_id::text||':'||v_grant.commercial_sale_id::text,0));
  select sale.* into v_sale from public.commercial_sales sale
  where sale.id=v_grant.commercial_sale_id and sale.organization_id=v_grant.organization_id
  for update;
  if not found then return; end if;
  select grant_row.* into v_grant from public.client_identity_claim_grants_v155 grant_row
  where grant_row.id=v_grant.id
    and grant_row.claim_kind='sale'
    and grant_row.token_hash=encode(extensions.digest(v_claim_normalized,'sha256'),'hex')
  for update;
  if not found then return; end if;
  if v_grant.locked_at is not null or v_grant.failed_attempts>=5 then
    return;
  end if;
  v_token:=encode(extensions.digest(
    'v155-sale-session:'||v_claim_normalized||':'||p_request_id::text,
    'sha256'
  ),'hex');
  v_token_hash:=encode(extensions.digest(v_token,'sha256'),'hex');
  if v_grant.consumed_at is not null then
    if v_grant.consume_request_id is distinct from p_request_id then
      return;
    end if;
    select session_row.id,session_row.expires_at into v_session,v_expires
    from public.client_identity_sessions_v155 session_row
    where session_row.id=v_grant.consumed_by_session_id and session_row.token_hash=v_token_hash;
    if v_session is null then return; end if;
    return query select v_token,'organization'::text,
      'ptac_'||encode(extensions.digest('v155-account:'||v_grant.client_account_id::text,'sha256'),'hex'),
      'ptorg_'||encode(extensions.digest('v155-organization:'||v_grant.organization_id::text,'sha256'),'hex'),
      'ptrv_'||encode(extensions.digest('v155-sale-claim:'||v_grant.id::text,'sha256'),'hex'),
      v_expires,true;
    return;
  end if;
  if v_grant.expires_at<=now() or v_grant.superseded_at is not null then
    update public.client_identity_claim_grants_v155
    set failed_attempts=least(5,failed_attempts+1),locked_at=case when failed_attempts+1>=5 then now() else locked_at end
    where id=v_grant.id;
    return;
  end if;
  if v_sale.client_account_id is distinct from v_grant.client_account_id
     or v_sale.booking_id is distinct from v_booking_id
     or v_sale.status<>'paid' or v_sale.refunded_minor<>0
     or v_sale.payment_method not in('cash','manual')
     or (v_booking_id is not null and (v_booking.client_account_id is distinct from v_grant.client_account_id
       or v_booking.status='cancelled'))
     or exists(select 1 from public.client_device_sessions legacy where legacy.token_hash=v_token_hash)
     or exists(select 1 from public.client_identity_sessions_v155 session_row where session_row.token_hash=v_token_hash) then
    update public.client_identity_claim_grants_v155
    set failed_attempts=least(5,failed_attempts+1),locked_at=case when failed_attempts+1>=5 then now() else locked_at end
    where id=v_grant.id;
    return;
  end if;
  insert into public.client_identity_sessions_v155(
    client_account_id,organization_id,token_hash,session_scope,session_source,device_name,expires_at
  ) values(
    v_grant.client_account_id,v_grant.organization_id,v_token_hash,'organization','sale_claim',
    nullif(btrim(p_device_name),''),v_expires
  ) returning id into v_session;
  update public.client_identity_claim_grants_v155
  set consumed_by_session_id=v_session,consume_request_id=p_request_id,consumed_at=now()
  where id=v_grant.id and consumed_at is null and superseded_at is null;
  if not found then return; end if;
  insert into public.client_identity_audit_v155(client_account_id,session_id,action,subject_id,details)
  values(v_grant.client_account_id,v_session,'client_sale_claim_consumed',v_grant.id,
    jsonb_build_object('scope','organization','organization_ref',
      'ptorg_'||encode(extensions.digest('v155-organization:'||v_grant.organization_id::text,'sha256'),'hex')));
  return query select v_token,'organization'::text,
    'ptac_'||encode(extensions.digest('v155-account:'||v_grant.client_account_id::text,'sha256'),'hex'),
    'ptorg_'||encode(extensions.digest('v155-organization:'||v_grant.organization_id::text,'sha256'),'hex'),
    'ptrv_'||encode(extensions.digest('v155-sale-claim:'||v_grant.id::text,'sha256'),'hex'),
    v_expires,false;
end
$$;

create or replace function public.promote_client_identity_v155(
  p_session_token text,
  p_claim_token text
)
returns table(
  session_scope text,
  session_expires_at timestamptz
)
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_session record;
  v_booking public.bookings%rowtype;
  v_grant public.client_identity_claim_grants_v155%rowtype;
  v_claim_hash text;
begin
  select * into v_session from public.resolve_client_identity_session_v155(p_session_token);
  if v_session.session_id is null or coalesce(p_claim_token,'')!~'^[0-9a-fA-F]{64}$' then
    raise exception using errcode='P0001',message='identity_confirmation_required';
  end if;
  v_claim_hash:=encode(extensions.digest(lower(p_claim_token),'sha256'),'hex');

  if v_session.session_scope='organization' then
    if exists(select 1 from public.client_identity_claim_grants_v155 grant_row
      where grant_row.token_hash=v_claim_hash
        and grant_row.claim_kind='booking'
        and grant_row.client_account_id=v_session.client_account_id
        and grant_row.consumed_by_session_id=v_session.session_id
        and grant_row.consumed_at is not null) then
      return query select 'organization'::text,v_session.session_expires_at;
      return;
    end if;
    raise exception using errcode='P0001',message='identity_confirmation_required';
  end if;

  select booking.* into v_booking
  from public.bookings booking
  where booking.id=v_session.claimed_booking_id
    and booking.status<>'cancelled'
  for update;
  if not found or v_booking.organization_id is null then
    raise exception using errcode='P0001',message='identity_confirmation_required';
  end if;

  select grant_row.* into v_grant
  from public.client_identity_claim_grants_v155 grant_row
  where grant_row.token_hash=v_claim_hash
  for update;
  if not found or v_grant.organization_id is distinct from v_booking.organization_id
     or v_grant.claim_kind<>'booking'
     or v_grant.booking_id is distinct from v_booking.id
     or v_grant.expires_at<=now() or v_grant.superseded_at is not null
     or v_grant.consumed_at is not null then
    raise exception using errcode='P0001',message='identity_confirmation_required';
  end if;

  if v_booking.client_account_id is not null
     and v_booking.client_account_id is distinct from v_grant.client_account_id then
    raise exception using errcode='42501',message='identity_account_conflict';
  end if;

  update public.bookings booking set client_account_id=v_grant.client_account_id
  where booking.id=v_booking.id and booking.client_account_id is null;

  update public.client_identity_sessions_v155 session_row
  set client_account_id=v_grant.client_account_id,organization_id=v_grant.organization_id,
      claimed_booking_id=null,session_scope='organization',session_source='promotion'
  where session_row.id=v_session.session_id
    and session_row.session_scope='booking'
    and session_row.revoked_at is null
    and session_row.expires_at>now();
  if not found then
    raise exception using errcode='P0001',message='identity_confirmation_required';
  end if;

  update public.client_identity_claim_grants_v155
  set consumed_by_session_id=v_session.session_id,consume_request_id=v_grant.request_id,consumed_at=now()
  where id=v_grant.id and consumed_at is null;
  if not found then
    raise exception using errcode='P0001',message='identity_confirmation_required';
  end if;

  insert into public.client_identity_audit_v155(
    client_account_id,session_id,booking_id,action,subject_id,details
  ) values(
    v_grant.client_account_id,v_session.session_id,v_booking.id,
    'client_identity_promoted',v_grant.id,
    jsonb_build_object('organization_id',v_grant.organization_id,'issued_by',v_grant.issued_by)
  );

  return query select 'organization'::text,v_session.session_expires_at;
end
$$;

create or replace function public.begin_client_identity_transfer_v155(
  p_session_token text,
  p_device_name text default null
)
returns table(
  transfer_token text,
  transfer_code text,
  transfer_expires_at timestamptz
)
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_token text;
  v_code_raw text;
  v_code text;
  v_expires timestamptz:=now()+interval '10 minutes';
  v_attempt integer;
  v_session record;
begin
  select * into v_session from public.resolve_client_identity_session_v155(p_session_token);
  if v_session.session_id is null or v_session.session_scope<>'account'
     or (p_device_name is not null and char_length(btrim(p_device_name)) not between 1 and 120) then
    raise exception using errcode='P0001',message='transfer_unavailable';
  end if;

  for v_attempt in 1..8 loop
    v_token:=encode(extensions.gen_random_bytes(32),'hex');
    v_code_raw:=upper(encode(extensions.gen_random_bytes(8),'hex'));
    v_code:='PTX1-'||substr(v_code_raw,1,4)||'-'||substr(v_code_raw,5,4)||'-'||
      substr(v_code_raw,9,4)||'-'||substr(v_code_raw,13,4);
    begin
      insert into public.client_identity_transfers_v155(
        transfer_token_hash,display_code_hash,requested_device_name,client_account_id,
        approved_by_session_id,expires_at
      ) values(
        encode(extensions.digest(v_token,'sha256'),'hex'),
        encode(extensions.digest(replace(v_code,'-',''),'sha256'),'hex'),
        nullif(btrim(p_device_name),''),v_session.client_account_id,
        v_session.session_id,v_expires
      );
      return query select v_token,v_code,v_expires;
      return;
    exception when unique_violation then
      null;
    end;
  end loop;
  raise exception using errcode='55000',message='transfer_generation_failed';
end
$$;

create or replace function public.approve_client_identity_transfer_v155(
  p_session_token text,
  p_transfer_token text,
  p_transfer_code text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_session record;
  v_transfer public.client_identity_transfers_v155%rowtype;
  v_transfer_hash text;
  v_code_raw text:=replace(upper(btrim(coalesce(p_transfer_code,''))),'-','');
begin
  select * into v_session from public.resolve_client_identity_session_v155(p_session_token);
  if v_session.session_id is null or v_session.session_scope<>'account'
     or coalesce(p_transfer_token,'')!~'^[0-9a-fA-F]{64}$' then
    return jsonb_build_object('status','unavailable');
  end if;
  v_transfer_hash:=encode(extensions.digest(lower(p_transfer_token),'sha256'),'hex');

  select transfer_row.* into v_transfer
  from public.client_identity_transfers_v155 transfer_row
  where transfer_row.transfer_token_hash=v_transfer_hash
  for update;
  if not found then return jsonb_build_object('status','unavailable'); end if;
  if v_transfer.locked_at is not null or v_transfer.failed_attempts>=5
     or upper(btrim(coalesce(p_transfer_code,'')))!~'^PTX1-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$'
     or v_transfer.display_code_hash<>encode(extensions.digest(v_code_raw,'sha256'),'hex') then
    update public.client_identity_transfers_v155
    set failed_attempts=least(5,failed_attempts+1),
        locked_at=case when failed_attempts+1>=5 then coalesce(locked_at,now()) else locked_at end
    where id=v_transfer.id and consumed_at is null;
    return jsonb_build_object('status','unavailable');
  end if;
  if v_transfer.expires_at<=now() or v_transfer.consumed_at is not null then
    return jsonb_build_object('status','unavailable');
  end if;

  if v_transfer.approved_at is not null then
    if v_transfer.client_account_id is distinct from v_session.client_account_id
       or v_transfer.approved_by_session_id is distinct from v_session.session_id then
      raise exception using errcode='P0001',message='transfer_unavailable';
    end if;
    return jsonb_build_object('status','approved','replayed',true,'expires_at',v_transfer.expires_at);
  end if;

  if v_transfer.client_account_id is distinct from v_session.client_account_id
     or v_transfer.approved_by_session_id is distinct from v_session.session_id then
    raise exception using errcode='P0001',message='transfer_unavailable';
  end if;

  update public.client_identity_transfers_v155
  set approved_at=now()
  where id=v_transfer.id
    and client_account_id=v_session.client_account_id
    and approved_by_session_id=v_session.session_id;

  insert into public.client_identity_audit_v155(
    client_account_id,session_id,action,subject_id,details
  ) values(
    v_session.client_account_id,v_session.session_id,'device_transfer_approved',v_transfer.id,
    jsonb_build_object('requested_device_name',v_transfer.requested_device_name)
  );
  return jsonb_build_object('status','approved','replayed',false,'expires_at',v_transfer.expires_at);
end
$$;

create or replace function public.consume_client_identity_transfer_v155(
  p_transfer_token text,
  p_transfer_code text,
  p_device_name text default null
)
returns table(
  session_token text,
  session_expires_at timestamptz,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_transfer public.client_identity_transfers_v155%rowtype;
  v_transfer_hash text;
  v_code_raw text:=replace(upper(btrim(coalesce(p_transfer_code,''))),'-','');
  v_session_token text;
  v_session_hash text;
  v_session uuid;
  v_expires timestamptz:=now()+interval '30 days';
begin
  if coalesce(p_transfer_token,'')!~'^[0-9a-fA-F]{64}$'
     or (p_device_name is not null and char_length(btrim(p_device_name)) not between 1 and 120) then
    return;
  end if;
  v_transfer_hash:=encode(extensions.digest(lower(p_transfer_token),'sha256'),'hex');

  select transfer_row.* into v_transfer
  from public.client_identity_transfers_v155 transfer_row
  where transfer_row.transfer_token_hash=v_transfer_hash
  for update;
  if not found then return; end if;
  if v_transfer.locked_at is not null or v_transfer.failed_attempts>=5
     or upper(btrim(coalesce(p_transfer_code,'')))!~'^PTX1-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$'
     or v_transfer.display_code_hash<>encode(extensions.digest(v_code_raw,'sha256'),'hex') then
    update public.client_identity_transfers_v155
    set failed_attempts=least(5,failed_attempts+1),
        locked_at=case when failed_attempts+1>=5 then coalesce(locked_at,now()) else locked_at end
    where id=v_transfer.id and consumed_at is null;
    return;
  end if;
  if v_transfer.expires_at<=now() or v_transfer.approved_at is null then
    return;
  end if;

  v_session_token:=encode(extensions.digest(
    'v155-transfer-session:'||lower(p_transfer_token)||':'||v_transfer.client_account_id::text,
    'sha256'
  ),'hex');
  v_session_hash:=encode(extensions.digest(v_session_token,'sha256'),'hex');

  if v_transfer.consumed_at is not null then
    select session_row.id,session_row.expires_at into v_session,v_expires
    from public.client_identity_sessions_v155 session_row
    where session_row.id=v_transfer.consumed_session_id
      and session_row.token_hash=v_session_hash;
    if v_session is null then
      raise exception using errcode='P0001',message='transfer_unavailable';
    end if;
    return query select v_session_token,v_expires,true;
    return;
  end if;

  begin
    if exists(select 1 from public.client_device_sessions legacy where legacy.token_hash=v_session_hash) then
      raise exception using errcode='P0001',message='transfer_unavailable';
    end if;
    insert into public.client_identity_sessions_v155(
      client_account_id,token_hash,session_scope,session_source,device_name,expires_at
    ) values(
      v_transfer.client_account_id,v_session_hash,'account','transfer',
      coalesce(nullif(btrim(p_device_name),''),v_transfer.requested_device_name),v_expires
    ) returning id into v_session;
  exception when unique_violation then
    raise exception using errcode='P0001',message='transfer_unavailable';
  end;

  update public.client_identity_transfers_v155
  set consumed_session_id=v_session,consumed_at=now()
  where id=v_transfer.id and consumed_at is null;
  if not found then
    raise exception using errcode='P0001',message='transfer_unavailable';
  end if;

  insert into public.client_identity_audit_v155(
    client_account_id,session_id,action,subject_id,details
  ) values(
    v_transfer.client_account_id,v_session,'device_transfer_consumed',v_transfer.id,
    jsonb_build_object('device_name',coalesce(nullif(btrim(p_device_name),''),v_transfer.requested_device_name))
  );
  return query select v_session_token,v_expires,false;
end
$$;

create or replace function public.revoke_client_identity_session_v155(p_session_token text)
returns boolean
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_hash text;
  v_session public.client_identity_sessions_v155%rowtype;
begin
  if coalesce(p_session_token,'')!~'^[0-9a-fA-F]{64}$' then return false; end if;
  v_hash:=encode(extensions.digest(lower(p_session_token),'sha256'),'hex');
  select session_row.* into v_session
  from public.client_identity_sessions_v155 session_row
  where session_row.token_hash=v_hash
  for update;
  if not found or v_session.revoked_at is not null then return false; end if;

  update public.client_identity_sessions_v155 set revoked_at=now() where id=v_session.id;
  insert into public.client_identity_audit_v155(
    client_account_id,session_id,booking_id,action,subject_id
  ) values(
    v_session.client_account_id,v_session.id,v_session.claimed_booking_id,
    'client_session_revoked',v_session.id
  );
  return true;
end
$$;

-- Compatibility readers understand both the new limited session and existing
-- legacy sessions. Booking scope can never expand beyond its claimed row.
create or replace function public.restore_client_session(p_session_token text)
returns table(normalized_phone text,session_expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_identity record;
  v_account_id uuid;
  v_expires timestamptz;
begin
  select * into v_identity from public.resolve_client_identity_session_v155(p_session_token);
  if v_identity.session_id is not null then
    if v_identity.session_scope='booking' then
      return query select null::text,v_identity.session_expires_at;
    else
      return query select account.normalized_phone,v_identity.session_expires_at
      from public.client_accounts account where account.id=v_identity.client_account_id;
    end if;
    return;
  end if;
  select resolved.client_account_id,resolved.session_expires_at into v_account_id,v_expires
  from public.resolve_client_session(p_session_token) resolved;
  if v_account_id is null then return; end if;
  return query select account.normalized_phone,v_expires
  from public.client_accounts account where account.id=v_account_id;
end
$$;

create or replace function public.get_client_bookings_v3(p_session_token text)
returns table(
  booking_code text,manage_token uuid,client_name text,service_id uuid,service_name text,service_active boolean,
  duration_minutes integer,price_rub integer,performer_name text,booking_date date,booking_time time without time zone,
  status text,cancel_allowed boolean,reschedule_allowed boolean,reschedules_remaining integer,
  deposit_amount_rub integer,payment_status text,payment_url text,review_eligible boolean,
  review_rating integer,review_text text,review_created_at timestamptz,payment_due_at timestamptz,refund_status text
)
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_identity record;
  v_account_id uuid;
begin
  select * into v_identity from public.resolve_client_identity_session_v155(p_session_token);
  if v_identity.session_id is null then
    select resolved.client_account_id into v_account_id
    from public.resolve_client_session(p_session_token) resolved;
    if v_account_id is null then return; end if;
  end if;
  return query select booking.booking_code::text,
    case when v_identity.session_id is null then booking.manage_token else null::uuid end,
    booking.client_name::text,service.id,
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
    booking.deposit_amount_rub::integer,booking.payment_status::text,
    case when v_identity.session_id is null then booking.payment_url::text else null::text end,
    (booking.status<>'cancelled' and outcome.visit_status='completed'),review.rating::integer,review.review_text::text,
    review.created_at,booking.payment_due_at,booking.refund_status::text
  from public.bookings booking join public.services service on service.id=booking.service_id
  join public.performer_profiles profile on profile.id=booking.performer_id
  left join public.booking_outcomes outcome on outcome.booking_id=booking.id
  left join public.booking_reviews review on review.booking_id=booking.id
  where (v_identity.session_id is not null and v_identity.session_scope='booking'
          and booking.id=v_identity.claimed_booking_id)
     or (v_identity.session_id is not null and v_identity.session_scope='account'
           and booking.client_account_id=v_identity.client_account_id)
     or (v_identity.session_id is not null and v_identity.session_scope='organization'
           and booking.client_account_id=v_identity.client_account_id
           and booking.organization_id=v_identity.organization_id)
     or (v_identity.session_id is null and booking.client_account_id=v_account_id)
  order by case when booking.status<>'cancelled' and coalesce(outcome.visit_status,'scheduled') not in('completed','no_show')
    and booking.booking_date+booking.booking_time>=timezone('Europe/Samara',now()) then 0 else 1 end,
    case when booking.status<>'cancelled' and coalesce(outcome.visit_status,'scheduled') not in('completed','no_show')
      and booking.booking_date+booking.booking_time>=timezone('Europe/Samara',now()) then booking.booking_date+booking.booking_time end,
    booking.booking_date desc,booking.booking_time desc;
end
$$;

create or replace function public.submit_booking_review(
  p_session_token text,p_manage_token uuid,p_rating integer,p_review_text text default ''
)
returns uuid
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_identity record;
  v_account_id uuid;
  v_booking public.bookings%rowtype;
  v_review_text text:=btrim(coalesce(p_review_text,''));
  v_review_id uuid;
begin
  select * into v_identity from public.resolve_client_identity_session_v155(p_session_token);
  if v_identity.session_id is null then
    select resolved.client_account_id into v_account_id
    from public.resolve_client_session(p_session_token) resolved;
    if v_account_id is null then
      raise exception using errcode='P0001',message='invalid_client_session';
    end if;
  else
    v_account_id:=v_identity.client_account_id;
  end if;
  if p_rating is null or p_rating not between 1 and 5 then
    raise exception using errcode='P0001',message='invalid_review_rating';
  end if;
  if char_length(v_review_text)>1000 then
    raise exception using errcode='P0001',message='review_too_long';
  end if;
  select booking.* into v_booking from public.bookings booking
  where booking.manage_token=p_manage_token
    and booking.status<>'cancelled'
    and booking.client_account_id is not null
    and ((v_identity.session_id is not null and v_identity.session_scope='booking'
          and booking.id=v_identity.claimed_booking_id)
      or (v_identity.session_id is not null and v_identity.session_scope='account'
          and booking.client_account_id=v_identity.client_account_id)
      or (v_identity.session_id is not null and v_identity.session_scope='organization'
          and booking.client_account_id=v_identity.client_account_id
          and booking.organization_id=v_identity.organization_id)
      or (v_identity.session_id is null and booking.client_account_id=v_account_id))
    and exists(select 1 from public.booking_outcomes outcome
      where outcome.booking_id=booking.id and outcome.visit_status='completed')
  for update;
  if not found then raise exception using errcode='P0001',message='review_not_available'; end if;

  insert into public.booking_reviews(
    booking_id,performer_id,service_id,client_account_id,rating,review_text,published
  ) values(
    v_booking.id,v_booking.performer_id,v_booking.service_id,v_booking.client_account_id,
    p_rating,v_review_text,true
  ) on conflict(booking_id) do update
    set rating=excluded.rating,review_text=excluded.review_text,updated_at=now()
    where public.booking_reviews.client_account_id=excluded.client_account_id
  returning id into v_review_id;
  if v_review_id is null then raise exception using errcode='P0001',message='review_not_available'; end if;
  return v_review_id;
end
$$;

create or replace function public.revoke_client_session(p_session_token text)
returns boolean
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_token_hash text;
begin
  if public.revoke_client_identity_session_v155(p_session_token) then return true; end if;
  if coalesce(p_session_token,'')!~'^[0-9a-fA-F]{64}$' then return false; end if;
  v_token_hash:=encode(extensions.digest(lower(p_session_token),'sha256'),'hex');
  update public.client_device_sessions set revoked_at=coalesce(revoked_at,now())
  where token_hash=v_token_hash and revoked_at is null;
  return found;
end
$$;

create or replace function public.get_client_identity_context_v155(p_session_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_session record;
  v_bookings jsonb;
begin
  select * into v_session from public.resolve_client_identity_session_v155(p_session_token);
  if v_session.session_id is null then
    raise exception using errcode='P0001',message='invalid_client_identity_session';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'booking_code',booking.booking_code,
    'service_name',service.name,
    'performer_name',profile.display_name,
    'booking_date',booking.booking_date,
    'booking_time',booking.booking_time,
    'duration_minutes',booking.duration_minutes,
    'total_price_rub',booking.total_price_rub,
    'status',booking.status,
    'visit_status',coalesce(outcome.visit_status,'scheduled')
  ) order by booking.booking_date desc,booking.booking_time desc),'[]'::jsonb)
  into v_bookings
  from public.bookings booking
  join public.services service on service.id=booking.service_id
  join public.performer_profiles profile on profile.id=booking.performer_id
  left join public.booking_outcomes outcome on outcome.booking_id=booking.id
  where (v_session.session_scope='booking' and booking.id=v_session.claimed_booking_id)
     or (v_session.session_scope='account' and booking.client_account_id=v_session.client_account_id)
     or (v_session.session_scope='organization'
         and booking.client_account_id=v_session.client_account_id
         and booking.organization_id=v_session.organization_id);

  return jsonb_build_object(
    'schema','client-commerce-v1',
    'as_of',now(),
    'scope',v_session.session_scope,
    'session_expires_at',v_session.session_expires_at,
    'bookings',v_bookings
  );
end
$$;

create or replace function public.get_client_commerce_v155(p_session_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_session record;
  v_payload jsonb;
begin
  select * into v_session from public.resolve_client_identity_session_v155(p_session_token);
  if v_session.session_id is null or v_session.session_scope not in('organization','account') then
    raise exception using errcode='P0001',message='invalid_client_identity_scope';
  end if;

  v_payload:=jsonb_build_object(
    'account_ref','ptac_'||encode(extensions.digest('v155-account:'||v_session.client_account_id::text,'sha256'),'hex'),
    'scope',v_session.session_scope,
    'session_expires_at',v_session.session_expires_at,
    'sales',coalesce((
      select jsonb_agg(jsonb_build_object(
        'purchase_ref','ptpu_'||encode(extensions.digest('v155-purchase:'||sale.id::text,'sha256'),'hex'),
        'organization_ref','ptorg_'||encode(extensions.digest('v155-organization:'||sale.organization_id::text,'sha256'),'hex'),
        'organization_slug',organization.public_slug,
        'organization_name',organization.name,'status',sale.status,
        'total_minor',sale.total_minor,'refunded_minor',sale.refunded_minor,
        'currency',sale.currency,'occurred_at',sale.occurred_at,
        'line',jsonb_build_object(
          'item_kind',line.item_kind,'item_name',line.item_name,
          'quantity',line.quantity,'refunded_quantity',line.refunded_quantity,
          'unit_price_minor',line.unit_price_minor,'total_minor',line.total_minor,
          'benefit_ref',case when line.benefit_instrument_id is null then null else
            'ptbf_'||encode(extensions.digest('v155-benefit:'||line.benefit_instrument_id::text,'sha256'),'hex') end
        )
      ) order by sale.occurred_at desc,sale.id desc)
      from (select scoped_sale.* from public.commercial_sales scoped_sale
        where scoped_sale.client_account_id=v_session.client_account_id
          and (v_session.session_scope='account' or scoped_sale.organization_id=v_session.organization_id)
        order by scoped_sale.occurred_at desc,scoped_sale.id desc limit 100) sale
      join public.commercial_sale_lines line on line.sale_id=sale.id
        and line.organization_id=sale.organization_id
      join public.organizations organization on organization.id=sale.organization_id
    ),'[]'::jsonb),
    'benefits',coalesce((
      select jsonb_agg(jsonb_build_object(
        'benefit_ref','ptbf_'||encode(extensions.digest('v155-benefit:'||instrument.id::text,'sha256'),'hex'),
        'version',instrument.client_version,
        'purchase_ref',(select case when count(*)=1 then
            min('ptpu_'||encode(extensions.digest('v155-purchase:'||line.sale_id::text,'sha256'),'hex')) end
          from public.commercial_sale_lines line
          where line.benefit_instrument_id=instrument.id and line.organization_id=instrument.organization_id),
        'organization_ref','ptorg_'||encode(extensions.digest('v155-organization:'||instrument.organization_id::text,'sha256'),'hex'),
        'organization_slug',organization.public_slug,
        'organization_name',organization.name,
        'locations',coalesce((select jsonb_agg(jsonb_build_object(
          'location_ref','ptl_'||encode(extensions.digest('v155-location:'||location.id::text,'sha256'),'hex'),
          'name',location.name
        ) order by location.name,location.id) from public.locations location
          where location.organization_id=instrument.organization_id and location.active),'[]'::jsonb),
        'kind',instrument.product_snapshot->>'kind',
        'name',instrument.product_snapshot->>'name','status',instrument.status,
        'remaining_amount_rub',instrument.remaining_amount_rub,
        'remaining_visits',instrument.remaining_visits,
        'issued_at',instrument.issued_at,'expires_on',instrument.expires_on,
        'eligible_services',coalesce((
          select jsonb_agg(jsonb_build_object(
            'service_ref','pts_'||encode(extensions.digest('v155-service:'||service.id::text,'sha256'),'hex'),
            'service_name',service.name,
            'provider_ref','ptm_'||encode(extensions.digest('v155-provider:'||service.performer_id::text,'sha256'),'hex'),
            'provider_name',profile.display_name,
            'remaining_units',case when instrument.product_snapshot->>'kind'='package'
              then balance.remaining_units else instrument.remaining_visits end,
            'current_price_minor',service.price_rub::bigint*100,
            'max_covered_minor',case when instrument.product_snapshot->>'kind'='certificate'
              then least(instrument.remaining_amount_rub,service.price_rub)::bigint*100 else service.price_rub::bigint*100 end
          ) order by service.name,profile.display_name)
          from public.services service
          join public.organization_memberships membership
            on membership.organization_id=instrument.organization_id
           and membership.user_id=service.performer_id
           and membership.active and membership.is_bookable
          join public.performer_profiles profile on profile.id=service.performer_id
          left join public.benefit_instrument_service_balances balance
            on balance.instrument_id=instrument.id and balance.service_id=service.id
          where service.active and organization.status='active' and organization.public_booking_enabled
            and coalesce((select settings.enabled from public.organization_benefit_settings settings
              where settings.organization_id=instrument.organization_id),false)
            and instrument.status='active'
            and timezone('Europe/Samara',now())::date<=instrument.expires_on
            and (
              ((instrument.product_snapshot->>'kind')='certificate' and instrument.remaining_amount_rub>0)
              or ((instrument.product_snapshot->>'kind')='package' and coalesce(balance.remaining_units,0)>0)
              or ((instrument.product_snapshot->>'kind')='visit_pass' and instrument.remaining_visits>0
                and (jsonb_array_length(coalesce(instrument.product_snapshot->'services','[]'::jsonb))=0
                  or exists(select 1
                    from jsonb_array_elements(coalesce(instrument.product_snapshot->'services','[]'::jsonb)) allowed
                    where allowed->>'service_id'=service.id::text)))
            )
        ),'[]'::jsonb),
        'events',coalesce((
          select jsonb_agg(jsonb_build_object(
            'event_ref','ptev_'||encode(extensions.digest('v155-benefit-event:'||ledger.id::text,'sha256'),'hex'),
            'type',case ledger.event_type when 'redeemed' then 'used' when 'released' then 'restored'
              when 'frozen' then 'paused' when 'activated' then 'resumed' else ledger.event_type end,
            'amount_delta_minor',ledger.amount_delta_rub::bigint*100,
            'visits_delta',ledger.visits_delta,
            'amount_balance_minor',ledger.amount_balance_rub::bigint*100,
            'visits_balance',ledger.visits_balance,
            'occurred_at',ledger.created_at,
            'booking_ref',booking.booking_code,
            'service_ref',case when service.id is null then null else
              'pts_'||encode(extensions.digest('v155-service:'||service.id::text,'sha256'),'hex') end,
            'service_name',service.name
          ) order by ledger.id)
          from (select event_row.* from public.benefit_ledger event_row
            where event_row.organization_id=instrument.organization_id
              and event_row.instrument_id=instrument.id
            order by event_row.id desc limit 50) ledger
          left join public.benefit_redemptions redemption
            on redemption.id=ledger.redemption_id and redemption.organization_id=ledger.organization_id
          left join public.bookings booking
            on booking.id=redemption.booking_id and booking.organization_id=redemption.organization_id
          left join public.services service on service.id=redemption.service_id and service.id=booking.service_id
        ),'[]'::jsonb)
      ) order by instrument.issued_at desc,instrument.id desc)
      from (select scoped_instrument.* from public.client_benefit_instruments scoped_instrument
        where scoped_instrument.client_account_id=v_session.client_account_id
          and (v_session.session_scope='account' or scoped_instrument.organization_id=v_session.organization_id)
        order by scoped_instrument.issued_at desc,scoped_instrument.id desc limit 100) instrument
      join public.organizations organization on organization.id=instrument.organization_id
    ),'[]'::jsonb)
  );
  return jsonb_build_object(
    'revision','ptrv_'||encode(extensions.digest(
      convert_to((v_payload-'session_expires_at')::text,'UTF8'),'sha256'
    ),'hex')
  )||v_payload;
end
$$;

create or replace function public.reserve_client_benefit_v155(
  p_client_account uuid,
  p_organization uuid,
  p_booking uuid,
  p_instrument uuid,
  p_expected_benefit_version integer,
  p_amount_rub integer default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_booking public.bookings%rowtype;
  v_instrument public.client_benefit_instruments%rowtype;
  v_kind text;
  v_units integer:=0;
  v_amount integer:=0;
  v_service_remaining integer;
  v_redemption uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_booking::text,7302));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_instrument::text,7300));

  select instrument.* into v_instrument
  from public.client_benefit_instruments instrument
  where instrument.id=p_instrument
    and instrument.organization_id=p_organization
    and instrument.client_account_id=p_client_account
  for update;
  if v_instrument.id is not null
     and (p_expected_benefit_version is null
       or v_instrument.client_version is distinct from p_expected_benefit_version) then
    raise exception using errcode='P0001',message='benefit_version_conflict';
  end if;
  select booking.* into v_booking
  from public.bookings booking
  where booking.id=p_booking
    and booking.organization_id=p_organization
    and booking.client_account_id=p_client_account
  for update;

  if v_instrument.id is null or v_booking.id is null
     or not coalesce((select enabled from public.organization_benefit_settings
       where organization_id=p_organization),false)
     or v_booking.status='cancelled'
     or v_instrument.status<>'active'
     or timezone('Europe/Samara',now())::date>v_instrument.expires_on
     or v_booking.booking_date>v_instrument.expires_on
     or coalesce(v_booking.deposit_amount_rub,0)>0
     or coalesce(v_booking.payment_status,'')<>'not_required'
     or exists(select 1 from public.payment_provider_attempts attempt where attempt.booking_id=v_booking.id) then
    raise exception using errcode='P0001',message='benefit_not_available';
  end if;

  if exists(select 1 from public.benefit_redemptions redemption
    where redemption.booking_id=p_booking and redemption.status in('reserved','redeemed')) then
    raise exception using errcode='P0001',message='benefit_not_available';
  end if;

  v_kind:=v_instrument.product_snapshot->>'kind';
  if v_kind='certificate' then
    v_amount:=coalesce(p_amount_rub,least(v_instrument.remaining_amount_rub,v_booking.total_price_rub));
    if v_amount<=0 or v_amount>v_instrument.remaining_amount_rub
       or v_amount>v_booking.total_price_rub then
      raise exception using errcode='P0001',message='benefit_not_available';
    end if;
    update public.client_benefit_instruments
    set remaining_amount_rub=remaining_amount_rub-v_amount,
        status=case when remaining_amount_rub-v_amount=0 and remaining_visits=0 then 'exhausted' else status end
    where id=v_instrument.id;
  elsif v_kind='package' then
    if p_amount_rub is not null then
      raise exception using errcode='P0001',message='benefit_not_available';
    end if;
    select balance.remaining_units into v_service_remaining
    from public.benefit_instrument_service_balances balance
    where balance.instrument_id=v_instrument.id and balance.service_id=v_booking.service_id
    for update;
    if coalesce(v_service_remaining,0)<1 then
      raise exception using errcode='P0001',message='benefit_not_available';
    end if;
    v_units:=1;
    update public.benefit_instrument_service_balances
    set remaining_units=remaining_units-1
    where instrument_id=v_instrument.id and service_id=v_booking.service_id;
    update public.client_benefit_instruments
    set remaining_visits=remaining_visits-1,
        status=case when remaining_amount_rub=0 and remaining_visits-1=0 then 'exhausted' else status end
    where id=v_instrument.id;
  elsif v_kind='visit_pass' then
    if p_amount_rub is not null or v_instrument.remaining_visits<1
       or (jsonb_array_length(coalesce(v_instrument.product_snapshot->'services','[]'::jsonb))>0
         and not exists(
           select 1
           from jsonb_array_elements(coalesce(v_instrument.product_snapshot->'services','[]'::jsonb)) allowed
           where (allowed->>'service_id')::uuid=v_booking.service_id
         )) then
      raise exception using errcode='P0001',message='benefit_not_available';
    end if;
    v_units:=1;
    update public.client_benefit_instruments
    set remaining_visits=remaining_visits-1,
        status=case when remaining_amount_rub=0 and remaining_visits-1=0 then 'exhausted' else status end
    where id=v_instrument.id;
  else
    raise exception using errcode='P0001',message='benefit_not_available';
  end if;

  insert into public.benefit_redemptions(
    organization_id,instrument_id,booking_id,service_id,units,amount_rub,status,acted_by
  ) values(
    p_organization,v_instrument.id,v_booking.id,v_booking.service_id,
    v_units,v_amount,'reserved',null
  ) returning id into v_redemption;

  insert into public.benefit_ledger(
    organization_id,instrument_id,redemption_id,event_type,amount_delta_rub,
    visits_delta,amount_balance_rub,visits_balance,actor_id,details
  ) select
    p_organization,v_instrument.id,v_redemption,'reserved',-v_amount,-v_units,
    instrument.remaining_amount_rub,instrument.remaining_visits,null,
    jsonb_build_object('source','client_identity_v155','booking_id',v_booking.id)
  from public.client_benefit_instruments instrument where instrument.id=v_instrument.id;
  insert into public.benefit_audit_log(
    organization_id,actor_id,action,subject_id,details
  ) values(
    p_organization,null,'benefit_reserved_client_v155',v_redemption,
    jsonb_build_object('instrument_id',v_instrument.id,'booking_id',v_booking.id)
  );

  return (select jsonb_build_object(
    'id',v_redemption,'status','reserved',
    'remaining_amount_rub',instrument.remaining_amount_rub,
    'remaining_visits',instrument.remaining_visits,
    'version',instrument.client_version
  ) from public.client_benefit_instruments instrument where instrument.id=v_instrument.id);
end
$$;

create or replace function public.book_client_with_benefit_v155(
  p_session_token text,
  p_request_id uuid,
  p_slug text,
  p_location uuid,
  p_service uuid,
  p_date date,
  p_time time without time zone,
  p_client_name text,
  p_client_phone text,
  p_expected_price_rub integer,
  p_expected_duration_minutes integer,
  p_benefit_ref text,
  p_expected_benefit_version integer,
  p_amount_rub integer default null
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
  current_duration_minutes integer,
  benefit_ref text,
  benefit_version integer,
  benefit_status text,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_session record;
  v_account public.client_accounts%rowtype;
  v_existing public.client_identity_booking_requests_v155%rowtype;
  v_booking public.bookings%rowtype;
  v_created record;
  v_organization uuid;
  v_instrument uuid;
  v_fingerprint text;
  v_benefit jsonb;
begin
  select * into v_session from public.resolve_client_identity_session_v155(p_session_token);
  if v_session.session_id is null or v_session.session_scope not in('organization','account') then
    raise exception using errcode='P0001',message='invalid_client_identity_scope';
  end if;
  if p_request_id is null or coalesce(p_benefit_ref,'')!~'^ptbf_[0-9a-f]{16,64}$'
     or p_expected_benefit_version is null or p_expected_benefit_version<1 then
    raise exception using errcode='P0001',message='invalid_booking_data';
  end if;
  select account.* into v_account from public.client_accounts account
  where account.id=v_session.client_account_id;
  if not found or public.normalize_client_phone(p_client_phone)<>v_account.normalized_phone then
    raise exception using errcode='P0001',message='client_identity_mismatch';
  end if;

  select organization.id into v_organization
  from public.organizations organization
  where organization.public_slug=lower(btrim(coalesce(p_slug,'')))
    and organization.status='active' and organization.public_booking_enabled;
  if v_organization is null
     or (v_session.session_scope='organization' and v_session.organization_id is distinct from v_organization) then
    raise exception using errcode='P0001',message='benefit_not_available';
  end if;
  select instrument.id into v_instrument
  from public.client_benefit_instruments instrument
  where 'ptbf_'||encode(extensions.digest('v155-benefit:'||instrument.id::text,'sha256'),'hex')=p_benefit_ref
    and instrument.organization_id=v_organization
    and instrument.client_account_id=v_account.id;
  if v_instrument is null then
    raise exception using errcode='P0001',message='benefit_not_available';
  end if;

  v_fingerprint:=encode(extensions.digest(convert_to(jsonb_build_array(
    v_account.id,lower(btrim(coalesce(p_slug,''))),p_location,p_service,p_date,p_time,
    btrim(coalesce(p_client_name,'')),v_account.normalized_phone,p_expected_price_rub,
    p_expected_duration_minutes,p_benefit_ref,p_expected_benefit_version,p_amount_rub
  )::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('booking-request:'||p_request_id::text,0)
  );

  select request_row.* into v_existing
  from public.client_identity_booking_requests_v155 request_row
  where request_row.request_id=p_request_id
  for update;
  if found then
    if v_existing.client_account_id is distinct from v_account.id
       or v_existing.instrument_id is distinct from v_instrument
       or v_existing.amount_rub is distinct from p_amount_rub
       or v_existing.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='client_benefit_booking_request_conflict';
    end if;
    select booking.* into v_booking from public.bookings booking
    where booking.id=v_existing.booking_id and booking.client_account_id=v_account.id;
    if not found then
      raise exception using errcode='55000',message='client_benefit_booking_replay_drift';
    end if;
    return query select
      'ok'::text,v_booking.booking_code,v_booking.manage_token,p_request_id,
      v_booking.service_id,v_booking.booking_date,v_booking.booking_time,
      v_booking.duration_minutes,v_booking.original_price_rub,v_booking.total_price_rub,
      v_booking.status,v_booking.total_price_rub,v_booking.duration_minutes,
      'ptbf_'||encode(extensions.digest('v155-benefit:'||v_existing.instrument_id::text,'sha256'),'hex'),
      v_existing.benefit_version,(select redemption.status from public.benefit_redemptions redemption
        where redemption.id=v_existing.redemption_id),true;
    return;
  end if;

  if exists(select 1 from public.bookings booking where booking.request_id=p_request_id) then
    raise exception using errcode='23505',message='client_benefit_booking_request_conflict';
  end if;
  select * into v_created
  from public.book_minuta_appointment_v2(
    p_request_id,p_slug,p_location,p_service,p_date,p_time,p_client_name,p_client_phone,
    p_expected_price_rub,p_expected_duration_minutes
  );
  if v_created.result_code<>'ok' then
    return query select v_created.result_code,v_created.booking_code,v_created.manage_token,
      v_created.request_id,v_created.service_id,v_created.booking_date,v_created.booking_time,
      v_created.duration_minutes,v_created.original_price_rub,v_created.total_price_rub,
      v_created.status,v_created.current_price_rub,v_created.current_duration_minutes,
      null::text,null::integer,null::text,false;
    return;
  end if;

  select booking.* into v_booking
  from public.bookings booking
  where booking.request_id=p_request_id and booking.organization_id=v_organization
  for update;
  if not found then
    raise exception using errcode='55000',message='client_benefit_booking_acknowledgement_invalid';
  end if;
  if v_booking.client_account_id is null then
    update public.bookings set client_account_id=v_account.id where id=v_booking.id;
    v_booking.client_account_id:=v_account.id;
  end if;
  if v_booking.client_account_id is distinct from v_account.id then
    raise exception using errcode='42501',message='client_identity_mismatch';
  end if;

  v_benefit:=public.reserve_client_benefit_v155(
    v_account.id,v_organization,v_booking.id,v_instrument,p_expected_benefit_version,p_amount_rub
  );
  insert into public.client_identity_booking_requests_v155(
    request_id,organization_id,booking_id,client_account_id,instrument_id,
    redemption_id,benefit_version,amount_rub,request_fingerprint
  ) values(
    p_request_id,v_organization,v_booking.id,v_account.id,v_instrument,
    (v_benefit->>'id')::uuid,(v_benefit->>'version')::integer,p_amount_rub,v_fingerprint
  );
  insert into public.client_identity_audit_v155(
    client_account_id,session_id,booking_id,action,subject_id,details
  ) values(
    v_account.id,v_session.session_id,v_booking.id,'client_benefit_booking_created',
    (v_benefit->>'id')::uuid,
    jsonb_build_object('request_ref',encode(extensions.digest('v155-request:'||p_request_id::text,'sha256'),'hex'))
  );

  return query select v_created.result_code,v_created.booking_code,v_created.manage_token,
    v_created.request_id,v_created.service_id,v_created.booking_date,v_created.booking_time,
    v_created.duration_minutes,v_created.original_price_rub,v_created.total_price_rub,
    v_created.status,v_created.current_price_rub,v_created.current_duration_minutes,
    p_benefit_ref,(v_benefit->>'version')::integer,v_benefit->>'status',false;
  return;
exception when sqlstate '23505' then
  raise;
when others then
  if sqlerrm in(
    'invalid_client_identity_scope','invalid_booking_data','client_identity_mismatch',
    'client_benefit_booking_request_conflict','benefit_not_available','benefit_version_conflict'
  ) then raise; end if;
  raise exception using errcode='P0001',message='benefit_not_available';
end
$$;

-- A legacy session is not independent proof of account ownership. Rotation is
-- fail-closed; an existing strong code may still be used for login/upgrade.
create or replace function public.rotate_client_access_code(p_session_token text)
returns text
language plpgsql
volatile
security definer
set search_path to ''
as $$
begin
  raise exception using errcode='P0001',message='identity_confirmation_required';
end
$$;

-- Keep the deployed RPC surface present while narrowing unsafe issuance.
revoke all on function public.bootstrap_client_access(uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function public.book_minuta_appointment_with_benefit_v115(
  uuid,text,uuid,uuid,date,time without time zone,text,text,text
) from public,anon,authenticated,service_role;

do $ownership_and_acl$
declare v_signature text;
begin
  foreach v_signature in array array[
    'public.protect_client_identity_immutable_v155()',
    'public.resolve_client_identity_session_v155(text)',
    'public.claim_client_booking_identity_v155(uuid,text)',
    'public.upgrade_legacy_client_identity_session_v155(text,text,text)',
    'public.issue_client_identity_claim_grant_v155(uuid,uuid,uuid,integer,uuid)',
    'public.issue_client_identity_sale_claim_v155(uuid,uuid,uuid,integer,uuid,text)',
    'public.inspect_client_identity_sale_claim_v155(text,uuid)',
    'public.consume_client_identity_sale_claim_v155(text,text,uuid)',
    'public.promote_client_identity_v155(text,text)',
    'public.begin_client_identity_transfer_v155(text,text)',
    'public.approve_client_identity_transfer_v155(text,text,text)',
    'public.consume_client_identity_transfer_v155(text,text,text)',
    'public.revoke_client_identity_session_v155(text)',
    'public.get_client_identity_context_v155(text)',
    'public.get_client_commerce_v155(text)',
    'public.reserve_client_benefit_v155(uuid,uuid,uuid,uuid,integer,integer)',
    'public.book_client_with_benefit_v155(text,uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer,text,integer,integer)',
    'public.bump_client_benefit_version_v155()',
    'public.rotate_client_access_code(text)',
    'public.restore_client_session(text)',
    'public.get_client_bookings_v3(text)',
    'public.submit_booking_review(text,uuid,integer,text)',
    'public.revoke_client_session(text)'
  ] loop
    execute format('alter function %s owner to postgres',v_signature);
    execute format('revoke all on function %s from public,anon,authenticated,service_role',v_signature);
  end loop;
end
$ownership_and_acl$;

alter function public.assign_booking_client_account() owner to postgres;
revoke all on function public.assign_booking_client_account() from public,anon,authenticated;
grant execute on function public.assign_booking_client_account() to service_role;

alter function public.bootstrap_client_access(uuid,text) owner to postgres;
alter function public.book_minuta_appointment_with_benefit_v115(
  uuid,text,uuid,uuid,date,time without time zone,text,text,text
) owner to postgres;
grant execute on function public.bootstrap_client_access(uuid,text) to anon,authenticated;
grant execute on function public.book_minuta_appointment_with_benefit_v115(
  uuid,text,uuid,uuid,date,time without time zone,text,text,text
) to anon,authenticated;

grant execute on function public.claim_client_booking_identity_v155(uuid,text) to anon,authenticated;
grant execute on function public.upgrade_legacy_client_identity_session_v155(text,text,text) to anon,authenticated;
grant execute on function public.issue_client_identity_claim_grant_v155(uuid,uuid,uuid,integer,uuid) to authenticated,service_role;
grant execute on function public.issue_client_identity_sale_claim_v155(uuid,uuid,uuid,integer,uuid,text) to authenticated,service_role;
grant execute on function public.inspect_client_identity_sale_claim_v155(text,uuid) to service_role;
grant execute on function public.consume_client_identity_sale_claim_v155(text,text,uuid) to anon,authenticated;
grant execute on function public.promote_client_identity_v155(text,text) to anon,authenticated;
grant execute on function public.begin_client_identity_transfer_v155(text,text) to anon,authenticated;
grant execute on function public.approve_client_identity_transfer_v155(text,text,text) to anon,authenticated;
grant execute on function public.consume_client_identity_transfer_v155(text,text,text) to anon,authenticated;
grant execute on function public.revoke_client_identity_session_v155(text) to anon,authenticated;
grant execute on function public.get_client_identity_context_v155(text) to anon,authenticated;
grant execute on function public.get_client_commerce_v155(text) to anon,authenticated;
grant execute on function public.book_client_with_benefit_v155(
  text,uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer,text,integer,integer
) to service_role;
grant execute on function public.rotate_client_access_code(text) to anon,authenticated;
grant execute on function public.restore_client_session(text) to anon,authenticated;
grant execute on function public.get_client_bookings_v3(text) to anon,authenticated;
grant execute on function public.submit_booking_review(text,uuid,integer,text) to anon,authenticated;
grant execute on function public.revoke_client_session(text) to anon,authenticated;

do $table_stamp$
declare v_table regclass; v_hash text;
begin
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
        from pg_catalog.pg_trigger trigger_row where trigger_row.tgrelid=v_table and trigger_row.tgconstraint=0)
    )::text,'UTF8'),'sha256'),'hex') into v_hash;
    execute format('comment on table %s is %L',v_table,'minuta_client_identity_v155:sha256='||v_hash);
  end loop;
end
$table_stamp$;
comment on function public.assign_booking_client_account() is 'minuta_client_identity_binding_v155';
comment on function public.bootstrap_client_access(uuid,text) is 'minuta_client_identity_v155';
comment on function public.book_minuta_appointment_with_benefit_v115(
  uuid,text,uuid,uuid,date,time without time zone,text,text,text
) is 'minuta_client_identity_v155';

do $stamp$
declare v_signature text;
begin
  foreach v_signature in array array[
    'public.protect_client_identity_immutable_v155()',
    'public.resolve_client_identity_session_v155(text)',
    'public.claim_client_booking_identity_v155(uuid,text)',
    'public.upgrade_legacy_client_identity_session_v155(text,text,text)',
    'public.issue_client_identity_claim_grant_v155(uuid,uuid,uuid,integer,uuid)',
    'public.issue_client_identity_sale_claim_v155(uuid,uuid,uuid,integer,uuid,text)',
    'public.inspect_client_identity_sale_claim_v155(text,uuid)',
    'public.consume_client_identity_sale_claim_v155(text,text,uuid)',
    'public.promote_client_identity_v155(text,text)',
    'public.begin_client_identity_transfer_v155(text,text)',
    'public.approve_client_identity_transfer_v155(text,text,text)',
    'public.consume_client_identity_transfer_v155(text,text,text)',
    'public.revoke_client_identity_session_v155(text)',
    'public.get_client_identity_context_v155(text)',
    'public.get_client_commerce_v155(text)',
    'public.reserve_client_benefit_v155(uuid,uuid,uuid,uuid,integer,integer)',
    'public.book_client_with_benefit_v155(text,uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer,text,integer,integer)',
    'public.bump_client_benefit_version_v155()',
    'public.rotate_client_access_code(text)',
    'public.restore_client_session(text)',
    'public.get_client_bookings_v3(text)',
    'public.submit_booking_review(text,uuid,integer,text)',
    'public.revoke_client_session(text)'
  ] loop
    execute format('comment on function %s is %L',v_signature,'minuta_client_identity_v155');
  end loop;
end
$stamp$;

do $postcondition$
declare
  v_item record;
  v_function regprocedure;
  v_table regclass;
  v_hash text;
  v_marker text;
begin
  for v_item in
    select * from (values
      ('public.protect_client_identity_immutable_v155()', '23c70f8815aed7dbf2e9c72947569ad112c13a4a1cae294f82408c61439456fb','none'),
      ('public.bootstrap_client_access(uuid,text)', '94c1b8095abc5463911fdf95cfc1ce8ec029165470f123fb3ec6918328014a23','public'),
      ('public.book_minuta_appointment_with_benefit_v115(uuid,text,uuid,uuid,date,time without time zone,text,text,text)', '53796773fc8c71ab5c178e1418e403cd706b8d5d1ee0b39a9c8ee3597b3b422c','public'),
      ('public.restore_client_session(text)', 'ff71198fb90cd25d506183c3f56735b9e265ea941cdc35602d489615668f3375','public'),
      ('public.get_client_bookings_v3(text)', '3170303328b9dc187fd24e9722e85b9aeaef05bc06384d66617c210783639e09','public'),
      ('public.submit_booking_review(text,uuid,integer,text)', 'c44fd2ec429a9a68aab42a7674d51954f69b333d682c2c1797a2fa62e10d83d7','public'),
      ('public.revoke_client_session(text)', '59430788863dfe1ef1c3bd20e65d0bc8466c9299ab3f7b3f825e9c13e4f8b088','public'),
      ('public.resolve_client_identity_session_v155(text)', '5e65796683092396867739b764af27f594dba2395ae8e573b02a865fbac59fa8','none'),
      ('public.claim_client_booking_identity_v155(uuid,text)', '6f88e1601b4ec513d4fa28d5cb2ac17959e2112cd8d4bfa2b084accd7073564c','public'),
      ('public.upgrade_legacy_client_identity_session_v155(text,text,text)', '154af3794baadfcddbf8dc1c911e461c71de51219d45ea11e70647ae0f6ee1f4','public'),
      ('public.inspect_client_identity_sale_claim_v155(text,uuid)', '26ea57135e1c74846cbbc2756cced5964e054ab9302a0a41dbd3e3626a42f741','service'),
      ('public.consume_client_identity_sale_claim_v155(text,text,uuid)', '95867d9f8dce3e2f99f16c844279b55613b8f750870eeedb893fa9d320d1ed1c','public'),
      ('public.promote_client_identity_v155(text,text)', '0cd89d46354778d111b503eda6b5f8536830ec35b51fabbb998ad55ad796d6e1','public'),
      ('public.begin_client_identity_transfer_v155(text,text)', '078ff6854ca26891937b170f72c3d76229c4b7170fc61899fdfd4057799ff68a','public'),
      ('public.approve_client_identity_transfer_v155(text,text,text)', 'a5525e6450290f476d2865cf371e1ed030eb912fb020c8a7e1ca07b0e60eac19','public'),
      ('public.consume_client_identity_transfer_v155(text,text,text)', '051017ee2877db0159ea45a7b4d456bbdf8c84086148c4c480bdb2714adf439f','public'),
      ('public.revoke_client_identity_session_v155(text)', '1a8ac0a0cd1a3871f316ae81df72b90faa2ae4638fd56983b6c4ffb18390decb','public'),
      ('public.get_client_identity_context_v155(text)', '9bc222169fbc197bb6c0f2bb3229d7d8cabfbd344c8b7905e0661ef1d21a6a2b','public'),
      ('public.get_client_commerce_v155(text)', '8e457f257897b716d38117d50a4fe9f9324e7e89c5e71b96f9df4245969312a0','public'),
      ('public.reserve_client_benefit_v155(uuid,uuid,uuid,uuid,integer,integer)', '27b1589359d0cb5c0b85ae7809a2978d1c40fe0d05d786ec387b58c95c0cb9bb','none'),
      ('public.book_client_with_benefit_v155(text,uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer,text,integer,integer)', 'd06e891274877c92227c8f0dfbdaf3acdf01372f28057248894ec419c13d1325','service'),
      ('public.bump_client_benefit_version_v155()', '16ad3f94354913307399d6def6fde1259e51be3cce3b091b02cc28b674bd93d9','none'),
      ('public.rotate_client_access_code(text)', 'cb45298118e9bbadbb09481bb2711c061a7073fd9c6ae67a1984a8fe80010ed8','public')
    ) expected(signature,source_hash,access_mode)
  loop
    v_function:=to_regprocedure(v_item.signature);
    if v_function is null or not exists(
      select 1 from pg_catalog.pg_proc procedure_row
      where procedure_row.oid=v_function
        and procedure_row.prosecdef
        and procedure_row.provolatile='v'
        and procedure_row.proconfig=array['search_path=""']::text[]
        and pg_get_userbyid(procedure_row.proowner)='postgres'
        and encode(extensions.digest(
          convert_to(replace(procedure_row.prosrc,E'\r',''),'UTF8'),'sha256'
        ),'hex')=v_item.source_hash
        and obj_description(procedure_row.oid,'pg_proc')='minuta_client_identity_v155'
    ) or (has_function_privilege('service_role',v_function,'EXECUTE') is distinct from (v_item.access_mode='service'))
       or (has_function_privilege('anon',v_function,'EXECUTE') is distinct from (v_item.access_mode='public'))
       or (has_function_privilege('authenticated',v_function,'EXECUTE') is distinct from (v_item.access_mode='public'))
       or exists(
         select 1 from pg_catalog.pg_proc procedure_row,
           lateral aclexplode(coalesce(procedure_row.proacl,acldefault('f',procedure_row.proowner))) grant_row
         where procedure_row.oid=v_function and grant_row.grantee=0
           and grant_row.privilege_type='EXECUTE'
       ) then
      raise exception using errcode='55000',message='v155_function_contract_drift',detail=v_item.signature;
    end if;
  end loop;

  for v_item in select * from (values
    ('public.issue_client_identity_claim_grant_v155(uuid,uuid,uuid,integer,uuid)','cb9c05efc30d2ebcff6c8cc54304cc44fa3cf7789be79dc9299d17db523fa63a'),
    ('public.issue_client_identity_sale_claim_v155(uuid,uuid,uuid,integer,uuid,text)','f782c940ba505260d42d3de8c7931f4d4a57a7f6d19ae32850c5666a7bad89a2')
  ) staff(signature,source_hash) loop
    v_function:=to_regprocedure(v_item.signature);
    if v_function is null or not exists(
      select 1 from pg_catalog.pg_proc procedure_row
      where procedure_row.oid=v_function
        and procedure_row.prosecdef and procedure_row.provolatile='v'
        and procedure_row.proconfig=array['search_path=""']::text[]
        and pg_get_userbyid(procedure_row.proowner)='postgres'
        and encode(extensions.digest(convert_to(replace(procedure_row.prosrc,E'\r',''),'UTF8'),'sha256'),'hex')=v_item.source_hash
        and obj_description(procedure_row.oid,'pg_proc')='minuta_client_identity_v155'
    ) or has_function_privilege('anon',v_function,'EXECUTE')
       or not has_function_privilege('authenticated',v_function,'EXECUTE')
       or not has_function_privilege('service_role',v_function,'EXECUTE') then
      raise exception using errcode='55000',message='v155_staff_claim_contract_drift',detail=v_item.signature;
    end if;
  end loop;

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
        from pg_catalog.pg_trigger trigger_row where trigger_row.tgrelid=v_table and trigger_row.tgconstraint=0)
    )::text,'UTF8'),'sha256'),'hex'),obj_description(v_table,'pg_class')
    into v_hash,v_marker;
    if v_marker is distinct from 'minuta_client_identity_v155:sha256='||v_hash
       or not (select relation_row.relrowsecurity from pg_catalog.pg_class relation_row where relation_row.oid=v_table)
       or has_table_privilege('anon',v_table,'SELECT,INSERT,UPDATE,DELETE')
       or has_table_privilege('authenticated',v_table,'SELECT,INSERT,UPDATE,DELETE')
       or has_table_privilege('service_role',v_table,'SELECT,INSERT,UPDATE,DELETE') then
      raise exception using errcode='55000',message='v155_table_contract_drift',detail=v_table::text;
    end if;
  end loop;

  if not exists(select 1 from pg_catalog.pg_attribute attribute_row
      join pg_catalog.pg_attrdef default_row
        on default_row.adrelid=attribute_row.attrelid and default_row.adnum=attribute_row.attnum
      where attribute_row.attrelid='public.client_benefit_instruments'::regclass
        and attribute_row.attname='client_version' and attribute_row.atttypid='integer'::regtype
        and attribute_row.attnotnull and pg_catalog.pg_get_expr(default_row.adbin,default_row.adrelid)='1')
     or not exists(select 1 from pg_catalog.pg_constraint constraint_row
       where constraint_row.conrelid='public.client_benefit_instruments'::regclass
         and constraint_row.conname='client_benefit_instruments_client_version_v155_check')
     or not exists(select 1 from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgrelid='public.client_benefit_instruments'::regclass
         and trigger_row.tgname='client_benefit_instruments_version_v155'
         and not trigger_row.tgisinternal
         and trigger_row.tgfoid='public.bump_client_benefit_version_v155()'::regprocedure
         and trigger_row.tgenabled='O' and trigger_row.tgtype=19) then
    raise exception using errcode='55000',message='v155_benefit_version_contract_drift';
  end if;

  if not has_function_privilege('anon','public.bootstrap_client_access(uuid,text)','EXECUTE')
     or not has_function_privilege('authenticated','public.bootstrap_client_access(uuid,text)','EXECUTE')
     or not has_function_privilege('anon','public.login_client_access(text,text,text)','EXECUTE')
     or not has_function_privilege('authenticated','public.login_client_access(text,text,text)','EXECUTE')
     or not has_function_privilege('anon','public.rotate_client_access_code(text)','EXECUTE')
     or not has_function_privilege('authenticated','public.rotate_client_access_code(text)','EXECUTE')
     or not has_function_privilege('anon','public.book_minuta_appointment_with_benefit_v115(uuid,text,uuid,uuid,date,time without time zone,text,text,text)','EXECUTE')
     or not has_function_privilege('authenticated','public.book_minuta_appointment_with_benefit_v115(uuid,text,uuid,uuid,date,time without time zone,text,text,text)','EXECUTE')
     or has_function_privilege('anon','public.refund_minuta_commercial_sale_v147(uuid,uuid,numeric,bigint,text,uuid)','EXECUTE')
     or has_function_privilege('anon','public.set_minuta_benefit_lifecycle_v150(uuid,uuid,text,text,uuid)','EXECUTE') then
    raise exception using errcode='55000',message='v155_privilege_boundary_drift';
  end if;
end
$postcondition$;

notify pgrst,'reload schema';
commit;
