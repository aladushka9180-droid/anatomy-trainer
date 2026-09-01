begin;

do $$
begin
  if not exists (select 1 from public.performer_profiles) then
    raise exception using errcode = 'P0001', message = 'v65_test_requires_legacy_performer';
  end if;
  if exists (select 1 from public.organizations where public_booking_enabled) then
    raise exception using errcode = 'P0001', message = 'v65_public_feature_must_be_disabled';
  end if;
end;
$$;

select set_config(
  'minuta.test_actor_a',
  (select profile.id::text from public.performer_profiles profile order by profile.id limit 1),
  true
);
select set_config(
  'minuta.test_org_a',
  (
    select organization.id::text
    from public.organizations organization
    where organization.legacy_performer_id = current_setting('minuta.test_actor_a')::uuid
  ),
  true
);

-- Suppress the production auth trigger only for synthetic users. The test then
-- creates memberships before profiles to exercise the invited-specialist path.
set local session_replication_role = replica;
insert into auth.users (
  id, instance_id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-4000-8000-000000006502', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'v65-admin@example.invalid', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-4000-8000-000000006503', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'v65-specialist@example.invalid', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-4000-8000-000000006504', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'v65-foreign-owner@example.invalid', now(), '{}'::jsonb, '{}'::jsonb, now(), now());
set local session_replication_role = origin;

insert into public.organization_memberships (
  organization_id, user_id, role, is_bookable, active, created_by
) values
  (current_setting('minuta.test_org_a')::uuid, '00000000-0000-4000-8000-000000006502', 'admin', false, true, current_setting('minuta.test_actor_a')::uuid),
  (current_setting('minuta.test_org_a')::uuid, '00000000-0000-4000-8000-000000006503', 'specialist', true, true, current_setting('minuta.test_actor_a')::uuid);

-- The specialist is already a member, so the profile trigger must not create a
-- second personal organization. The foreign owner must receive one.
insert into public.performer_profiles (id, display_name) values
  ('00000000-0000-4000-8000-000000006503', 'V65 Specialist'),
  ('00000000-0000-4000-8000-000000006504', 'V65 Foreign Owner');

select set_config(
  'minuta.test_org_b',
  (
    select organization.id::text
    from public.organizations organization
    where organization.legacy_performer_id = '00000000-0000-4000-8000-000000006504'
  ),
  true
);

do $$
begin
  if current_setting('minuta.test_org_a', true) is null
     or current_setting('minuta.test_org_b', true) is null then
    raise exception using errcode = 'P0001', message = 'v65_test_organization_missing';
  end if;
  if exists (
    select 1
    from public.organizations organization
    where organization.legacy_performer_id = '00000000-0000-4000-8000-000000006503'
  ) then
    raise exception using errcode = 'P0001', message = 'invited_specialist_received_duplicate_org';
  end if;
  if has_table_privilege('authenticated', 'public.organizations', 'INSERT')
     or has_table_privilege('authenticated', 'public.locations', 'UPDATE')
     or has_table_privilege('authenticated', 'public.organization_memberships', 'DELETE') then
    raise exception using errcode = 'P0001', message = 'authenticated_foundation_write_grant_detected';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', current_setting('minuta.test_actor_a'), true);
set local role authenticated;
do $$
begin
  if (select count(*) from public.organizations) <> 1
     or not exists (
       select 1 from public.organizations
       where id = current_setting('minuta.test_org_a')::uuid
     ) then
    raise exception using errcode = 'P0001', message = 'owner_tenant_isolation_failed';
  end if;
  if (select count(*) from public.organization_memberships) <> 3 then
    raise exception using errcode = 'P0001', message = 'owner_roster_access_failed';
  end if;
end;
$$;
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000006502', true);
set local role authenticated;
do $$
begin
  if (select count(*) from public.organizations) <> 1
     or (select count(*) from public.organization_memberships) <> 3 then
    raise exception using errcode = 'P0001', message = 'admin_roster_access_failed';
  end if;
  if exists (
    select 1 from public.organizations
    where id = current_setting('minuta.test_org_b')::uuid
  ) then
    raise exception using errcode = 'P0001', message = 'admin_foreign_tenant_visible';
  end if;
end;
$$;
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000006503', true);
set local role authenticated;
do $$
begin
  if (select count(*) from public.organizations) <> 1
     or (select count(*) from public.organization_memberships) <> 1
     or not exists (
       select 1
       from public.organization_memberships
       where user_id = '00000000-0000-4000-8000-000000006503'
     ) then
    raise exception using errcode = 'P0001', message = 'specialist_self_only_access_failed';
  end if;
  if exists (
    select 1 from public.organizations
    where id = current_setting('minuta.test_org_b')::uuid
  ) then
    raise exception using errcode = 'P0001', message = 'specialist_foreign_tenant_visible';
  end if;
end;
$$;
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000006504', true);
set local role authenticated;
do $$
begin
  if (select count(*) from public.organizations) <> 1
     or not exists (
       select 1 from public.organizations
       where id = current_setting('minuta.test_org_b')::uuid
     )
     or (select count(*) from public.organization_memberships) <> 1 then
    raise exception using errcode = 'P0001', message = 'foreign_owner_boundary_failed';
  end if;
end;
$$;
reset role;

update public.organizations
set status = 'suspended'
where id = current_setting('minuta.test_org_b')::uuid;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000006504', true);
set local role authenticated;
do $$
begin
  if exists (select 1 from public.organizations)
     or exists (select 1 from public.locations)
     or exists (select 1 from public.organization_memberships) then
    raise exception using errcode = 'P0001', message = 'suspended_organization_still_visible';
  end if;
end;
$$;
reset role;

select 'multi-tenant v65 integration test: OK' as result;
rollback;
