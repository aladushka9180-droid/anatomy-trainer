begin;

do $$
begin
  if to_regprocedure('public.get_minuta_resource_workspace(uuid)') is null
     or to_regprocedure('public.get_public_minuta_available_slots_v3(text,uuid,uuid,date,date)') is null
     or to_regclass('public.booking_resource_allocations') is null then
    raise exception using errcode='P0001', message='v69_test_requires_v69';
  end if;
end;
$$;

select set_config('minuta.v69_owner', (
  select organization.legacy_performer_id::text from public.organizations organization
  where organization.legacy_performer_id is not null and organization.status='active'
  order by organization.public_booking_enabled desc, organization.id limit 1
), true);
select set_config('minuta.v69_org', (
  select id::text from public.organizations where legacy_performer_id=current_setting('minuta.v69_owner')::uuid
), true);
select set_config('minuta.v69_location', (
  select id::text from public.locations where organization_id=current_setting('minuta.v69_org')::uuid and active and is_primary limit 1
), true);
select set_config('minuta.v69_service', (
  select service.id::text from public.services service
  where service.active and service.performer_id=current_setting('minuta.v69_owner')::uuid
  order by service.id limit 1
), true);
select set_config('minuta.v69_slug', (
  select public_slug from public.organizations where id=current_setting('minuta.v69_org')::uuid
), true);

do $$
declare v_function oid;
begin
  foreach v_function in array array[
    'public.get_minuta_resource_workspace(uuid)'::regprocedure,
    'public.create_minuta_resource_group(uuid,text,text,text)'::regprocedure,
    'public.update_minuta_resource_group(uuid,text,text,text,boolean)'::regprocedure,
    'public.create_minuta_resource(uuid,uuid,uuid,text)'::regprocedure,
    'public.update_minuta_resource(uuid,uuid,uuid,text,boolean)'::regprocedure,
    'public.replace_minuta_service_resource_requirements(uuid,uuid,jsonb)'::regprocedure
  ] loop
    if not has_function_privilege('authenticated',v_function,'EXECUTE')
       or has_function_privilege('anon',v_function,'EXECUTE')
       or has_function_privilege('service_role',v_function,'EXECUTE')
       or exists (select 1 from aclexplode(coalesce((select proacl from pg_proc where oid=v_function),acldefault('f',(select proowner from pg_proc where oid=v_function)))) acl where acl.grantee=0 and acl.privilege_type='EXECUTE') then
      raise exception using errcode='P0001', message='v69_management_acl_failed';
    end if;
  end loop;
  v_function := 'public.get_public_minuta_available_slots_v3(text,uuid,uuid,date,date)'::regprocedure;
  if not has_function_privilege('anon',v_function,'EXECUTE')
     or not has_function_privilege('authenticated',v_function,'EXECUTE')
     or has_function_privilege('service_role',v_function,'EXECUTE') then
    raise exception using errcode='P0001', message='v69_public_slots_acl_failed';
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1 from (values
      ('resource_groups'),('resources'),('service_resource_requirements'),
      ('booking_resource_allocations'),('resource_audit_log')
    ) expected(name)
    where not exists (
      select 1 from pg_class class join pg_namespace namespace on namespace.oid=class.relnamespace
      where namespace.nspname='public' and class.relname=expected.name and class.relrowsecurity
    )
  ) then raise exception using errcode='P0001', message='v69_rls_missing'; end if;
  if has_table_privilege('anon','public.resources','SELECT')
     or has_table_privilege('authenticated','public.resources','INSERT')
     or has_table_privilege('authenticated','public.service_resource_requirements','UPDATE')
     or has_table_privilege('authenticated','public.booking_resource_allocations','DELETE') then
    raise exception using errcode='P0001', message='v69_table_acl_failed';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub',current_setting('minuta.v69_owner'),true);
set local role authenticated;
select public.create_minuta_resource_group(
  current_setting('minuta.v69_org')::uuid,'V69 Test Rooms','room','Transaction-scoped resource group'
);
reset role;
select set_config('minuta.v69_group',(
  select id::text from public.resource_groups where organization_id=current_setting('minuta.v69_org')::uuid and name='V69 Test Rooms'
),true);

set local role authenticated;
select public.create_minuta_resource(
  current_setting('minuta.v69_org')::uuid,current_setting('minuta.v69_location')::uuid,
  current_setting('minuta.v69_group')::uuid,'V69 Test Room One'
);
select public.replace_minuta_service_resource_requirements(
  current_setting('minuta.v69_org')::uuid,current_setting('minuta.v69_service')::uuid,
  jsonb_build_array(jsonb_build_object('group_id',current_setting('minuta.v69_group'),'quantity',1))
);
reset role;

do $$
declare v_workspace jsonb;
begin
  perform set_config('request.jwt.claim.sub',current_setting('minuta.v69_owner'),true);
  v_workspace := public.get_minuta_resource_workspace(current_setting('minuta.v69_org')::uuid);
  if (v_workspace->>'can_manage')::boolean is not true
     or jsonb_array_length(v_workspace->'groups') <> 1
     or jsonb_array_length(v_workspace->'resources') <> 1
     or jsonb_array_length(v_workspace->'requirements') <> 1
     or v_workspace::text ~ 'manage_token|payment_url|client_account_id|provider_note' then
    raise exception using errcode='P0001', message='v69_workspace_failed_or_leaked_secret';
  end if;
end;
$$;

select set_config('minuta.v69_slot',coalesce((
  select to_jsonb(slot)::text from public.get_public_minuta_available_slots_v3(
    current_setting('minuta.v69_slug'),current_setting('minuta.v69_location')::uuid,
    current_setting('minuta.v69_service')::uuid,current_date+1,current_date+62
  ) slot order by slot.booking_date,slot.booking_time limit 1
),'{}'),true);

do $$ begin
  if current_setting('minuta.v69_slot')::jsonb = '{}'::jsonb then
    raise exception using errcode='P0001', message='v69_test_requires_available_slot';
  end if;
end $$;

set local role anon;
select * from public.book_minuta_appointment(
  '00000000-0000-4000-8000-000000006901',current_setting('minuta.v69_slug'),
  current_setting('minuta.v69_location')::uuid,current_setting('minuta.v69_service')::uuid,
  (current_setting('minuta.v69_slot')::jsonb->>'booking_date')::date,
  (current_setting('minuta.v69_slot')::jsonb->>'booking_time')::time,
  'V69 Resource Client','+79990006901'
);
-- Exact retry must return the same booking and allocation.
select * from public.book_minuta_appointment(
  '00000000-0000-4000-8000-000000006901',current_setting('minuta.v69_slug'),
  current_setting('minuta.v69_location')::uuid,current_setting('minuta.v69_service')::uuid,
  (current_setting('minuta.v69_slot')::jsonb->>'booking_date')::date,
  (current_setting('minuta.v69_slot')::jsonb->>'booking_time')::time,
  'V69 Resource Client','+79990006901'
);
reset role;

select set_config('minuta.v69_booking',(
  select id::text from public.bookings where request_id='00000000-0000-4000-8000-000000006901'
),true);
do $$ begin
  if (select count(*) from public.bookings where request_id='00000000-0000-4000-8000-000000006901') <> 1
     or (select count(*) from public.booking_resource_allocations where booking_id=current_setting('minuta.v69_booking')::uuid and booking_status='active') <> 1 then
    raise exception using errcode='P0001', message='v69_booking_allocation_or_idempotency_failed';
  end if;
end $$;

update public.bookings set status='cancelled' where id=current_setting('minuta.v69_booking')::uuid;
do $$ begin
  if exists (select 1 from public.booking_resource_allocations where booking_id=current_setting('minuta.v69_booking')::uuid and booking_status<>'cancelled') then
    raise exception using errcode='P0001', message='v69_cancel_did_not_release_resource';
  end if;
end $$;

-- A requirement must never become an unprotected no-op because its group was
-- disabled after the last allocation was released.
select set_config('request.jwt.claim.sub',current_setting('minuta.v69_owner'),true);
set local role authenticated;
do $$
begin
  begin
    perform public.update_minuta_resource_group(
      current_setting('minuta.v69_group')::uuid,
      'V69 Test Rooms', 'room', 'Transaction-scoped resource group', false
    );
    raise exception using errcode='P0001', message='v69_required_group_was_disabled';
  exception when raise_exception then
    if sqlerrm not in ('resource_group_has_active_requirements','resource_group_required_by_service','resource_group_is_required') then
      raise;
    end if;
  end;
end;
$$;
reset role;

update public.bookings set status='confirmed' where id=current_setting('minuta.v69_booking')::uuid;
do $$ begin
  if (select count(*) from public.booking_resource_allocations where booking_id=current_setting('minuta.v69_booking')::uuid and booking_status='active') <> 1 then
    raise exception using errcode='P0001', message='v69_restore_did_not_reallocate_resource';
  end if;
end $$;

-- Build a deterministic second tenant. The test must never silently skip the
-- isolation assertions merely because the target database started with one
-- legacy organization.
set local session_replication_role = replica;
insert into auth.users (
  id, instance_id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-4000-8000-000000006902',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'v69-foreign-owner@example.invalid', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);
set local session_replication_role = origin;
insert into public.performer_profiles (id, display_name)
values ('00000000-0000-4000-8000-000000006902', 'V69 Foreign Owner');
select set_config('minuta.v69_foreign_org',(
  select id::text from public.organizations
  where legacy_performer_id='00000000-0000-4000-8000-000000006902'
),true);

-- An authenticated owner of another tenant cannot use a management RPC
-- against the primary organization.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000006902',true);
set local role authenticated;
do $$
begin
  begin
    perform public.create_minuta_resource_group(
      current_setting('minuta.v69_org')::uuid, 'Foreign write', 'room', ''
    );
    raise exception using errcode='P0001', message='v69_cross_organization_write_was_allowed';
  exception when insufficient_privilege then
    if sqlerrm <> 'resource_management_denied' then raise; end if;
  end;
end;
$$;
reset role;

-- A foreign organization must fail before exposing anything.
do $$
begin
  perform set_config('request.jwt.claim.sub',current_setting('minuta.v69_owner'),true);
  begin
    perform public.get_minuta_resource_workspace(current_setting('minuta.v69_foreign_org')::uuid);
    raise exception using errcode='P0001', message='v69_cross_organization_read_was_allowed';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- SECURITY DEFINER reads must enforce organization status, just like the v65
-- RLS helpers and the v66 management workspace.
update public.organizations set status='suspended'
where id=current_setting('minuta.v69_foreign_org')::uuid;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000006902',true);
set local role authenticated;
do $$
begin
  begin
    perform public.get_minuta_resource_workspace(current_setting('minuta.v69_foreign_org')::uuid);
    raise exception using errcode='P0001', message='v69_suspended_organization_still_readable';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

rollback;
