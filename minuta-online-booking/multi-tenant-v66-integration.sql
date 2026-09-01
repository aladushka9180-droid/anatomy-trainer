begin;

do $$
begin
  if to_regclass('public.organization_invitations') is null
     or to_regprocedure('public.get_minuta_workspace()') is null then
    raise exception using errcode = 'P0001', message = 'v66_test_requires_v66';
  end if;
  if not exists (select 1 from public.organizations where legacy_performer_id is not null) then
    raise exception using errcode = 'P0001', message = 'v66_test_requires_v65_legacy_owner';
  end if;
end;
$$;

select set_config(
  'minuta.v66_owner',
  (select organization.legacy_performer_id::text from public.organizations organization where organization.legacy_performer_id is not null order by organization.id limit 1),
  true
);
select set_config(
  'minuta.v66_org',
  (select organization.id::text from public.organizations organization where organization.legacy_performer_id = current_setting('minuta.v66_owner')::uuid),
  true
);

set local session_replication_role = replica;
insert into auth.users (
  id, instance_id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-4000-8000-000000006602', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'v66-admin@example.invalid', now(), '{}'::jsonb, '{"display_name":"V66 Admin"}'::jsonb, now(), now()),
  ('00000000-0000-4000-8000-000000006603', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'v66-specialist@example.invalid', now(), '{}'::jsonb, '{"display_name":"V66 Specialist"}'::jsonb, now(), now()),
  ('00000000-0000-4000-8000-000000006604', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'v66-foreign@example.invalid', now(), '{}'::jsonb, '{"display_name":"V66 Foreign"}'::jsonb, now(), now());
set local session_replication_role = origin;

-- The existing admin account first receives its own legacy workspace.
insert into public.performer_profiles (id, display_name) values
  ('00000000-0000-4000-8000-000000006602', 'V66 Admin'),
  ('00000000-0000-4000-8000-000000006604', 'V66 Foreign');

select set_config('request.jwt.claim.sub', current_setting('minuta.v66_owner'), true);
set local role authenticated;
select public.invite_minuta_member(
  current_setting('minuta.v66_org')::uuid,
  'v66-admin@example.invalid',
  'admin',
  false
);
select public.invite_minuta_member(
  current_setting('minuta.v66_org')::uuid,
  'v66-specialist@example.invalid',
  'specialist',
  true
);
reset role;

select set_config(
  'minuta.v66_admin_invite',
  (select invitation.id::text from public.organization_invitations invitation where invitation.organization_id = current_setting('minuta.v66_org')::uuid and invitation.email = 'v66-admin@example.invalid' and invitation.status = 'pending'),
  true
);
select set_config(
  'minuta.v66_specialist_invite',
  (select invitation.id::text from public.organization_invitations invitation where invitation.organization_id = current_setting('minuta.v66_org')::uuid and invitation.email = 'v66-specialist@example.invalid' and invitation.status = 'pending'),
  true
);

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000006602', true);
set local role authenticated;
select public.accept_minuta_invitation(current_setting('minuta.v66_admin_invite')::uuid);
reset role;

-- A pending invitation suppresses the duplicate personal organization but does
-- not grant membership until the confirmed specialist explicitly accepts it.
insert into public.performer_profiles (id, display_name)
values ('00000000-0000-4000-8000-000000006603', 'V66 Specialist');

do $$
begin
  if exists (
    select 1 from public.organizations organization
    where organization.legacy_performer_id = '00000000-0000-4000-8000-000000006603'
  ) then
    raise exception using errcode = 'P0001', message = 'v66_pending_invite_created_duplicate_org';
  end if;
  if exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = current_setting('minuta.v66_org')::uuid
      and membership.user_id = '00000000-0000-4000-8000-000000006603'
  ) then
    raise exception using errcode = 'P0001', message = 'v66_invite_granted_without_acceptance';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000006603', true);
set local role authenticated;
do $$
declare
  v_workspace jsonb := public.get_minuta_workspace();
begin
  if jsonb_array_length(v_workspace -> 'organizations') <> 0
     or jsonb_array_length(v_workspace -> 'pending_invitations') <> 1 then
    raise exception using errcode = 'P0001', message = 'v66_pending_invitation_visibility_failed';
  end if;
end;
$$;
select public.accept_minuta_invitation(current_setting('minuta.v66_specialist_invite')::uuid);
do $$
declare
  v_workspace jsonb := public.get_minuta_workspace();
begin
  if jsonb_array_length(v_workspace -> 'organizations') <> 1
     or jsonb_array_length(v_workspace #> '{organizations,0,members}') <> 1
     or (v_workspace #>> '{organizations,0,current_role}') <> 'specialist' then
    raise exception using errcode = 'P0001', message = 'v66_specialist_self_only_workspace_failed';
  end if;
end;
$$;
reset role;

select set_config('request.jwt.claim.sub', current_setting('minuta.v66_owner'), true);
set local role authenticated;
select public.create_minuta_location(
  current_setting('minuta.v66_org')::uuid,
  'V66 Second Location',
  'Test address',
  'Europe/Samara'
);
reset role;
select set_config(
  'minuta.v66_location',
  (select location.id::text from public.locations location where location.organization_id = current_setting('minuta.v66_org')::uuid and location.name = 'V66 Second Location'),
  true
);
select set_config('request.jwt.claim.sub', current_setting('minuta.v66_owner'), true);
set local role authenticated;
select public.update_minuta_location(
  current_setting('minuta.v66_location')::uuid,
  'V66 Second Location',
  'Test address',
  'Europe/Samara',
  true,
  true
);
do $$
begin
  if (select count(*) from public.locations where organization_id = current_setting('minuta.v66_org')::uuid and is_primary) <> 1
     or not exists (select 1 from public.locations where id = current_setting('minuta.v66_location')::uuid and is_primary) then
    raise exception using errcode = 'P0001', message = 'v66_primary_location_switch_failed';
  end if;
end;
$$;

-- Neither the RPC nor direct service-role writes may remove the last owner.
do $$
begin
  begin
    perform public.update_minuta_member(
      current_setting('minuta.v66_org')::uuid,
      current_setting('minuta.v66_owner')::uuid,
      'admin', true, true
    );
    raise exception using errcode = 'P0001', message = 'v66_rpc_last_owner_was_removed';
  exception when others then
    if sqlerrm not like '%last_owner_must_remain%' then raise; end if;
  end;
end;
$$;
reset role;

do $$
begin
  begin
    update public.organization_memberships
    set active = false
    where organization_id = current_setting('minuta.v66_org')::uuid
      and user_id = current_setting('minuta.v66_owner')::uuid;
    raise exception using errcode = 'P0001', message = 'v66_direct_last_owner_was_removed';
  exception when others then
    if sqlerrm not like '%last_owner_must_remain%' then raise; end if;
  end;
end;
$$;

do $$
begin
  begin
    delete from public.organization_memberships
    where organization_id = current_setting('minuta.v66_org')::uuid
      and user_id = current_setting('minuta.v66_owner')::uuid;
    raise exception using errcode = 'P0001', message = 'v66_direct_last_owner_delete_succeeded';
  exception when others then
    if sqlerrm not like '%last_owner_must_remain%' then raise; end if;
  end;
end;
$$;

-- Admins can manage specialists but cannot invite or cancel privileged roles.
select set_config('request.jwt.claim.sub', current_setting('minuta.v66_owner'), true);
set local role authenticated;
select public.invite_minuta_member(current_setting('minuta.v66_org')::uuid, 'v66-owner-pending@example.invalid', 'owner', false);
reset role;
select set_config(
  'minuta.v66_owner_invite',
  (select invitation.id::text from public.organization_invitations invitation where invitation.organization_id = current_setting('minuta.v66_org')::uuid and invitation.email = 'v66-owner-pending@example.invalid' and invitation.status = 'pending'),
  true
);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000006602', true);
set local role authenticated;
do $$
begin
  begin
    perform public.invite_minuta_member(current_setting('minuta.v66_org')::uuid, 'forbidden-owner@example.invalid', 'owner', false);
    raise exception using errcode = 'P0001', message = 'v66_admin_invited_owner';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.cancel_minuta_invitation(current_setting('minuta.v66_owner_invite')::uuid);
    raise exception using errcode = 'P0001', message = 'v66_admin_cancelled_owner_invite';
  exception when insufficient_privilege then null;
  end;
end;
$$;
select public.update_minuta_member(
  current_setting('minuta.v66_org')::uuid,
  '00000000-0000-4000-8000-000000006603',
  'specialist', true, false
);
select public.update_minuta_member(
  current_setting('minuta.v66_org')::uuid,
  '00000000-0000-4000-8000-000000006603',
  'specialist', true, true
);
reset role;

-- A foreign tenant sees only its own organization and cannot mutate this one.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000006604', true);
set local role authenticated;
do $$
declare
  v_workspace jsonb := public.get_minuta_workspace();
begin
  if jsonb_array_length(v_workspace -> 'organizations') <> 1
     or (v_workspace #>> '{organizations,0,id}')::uuid = current_setting('minuta.v66_org')::uuid then
    raise exception using errcode = 'P0001', message = 'v66_foreign_tenant_visibility_failed';
  end if;
  begin
    perform public.update_minuta_organization(current_setting('minuta.v66_org')::uuid, 'Forbidden');
    raise exception using errcode = 'P0001', message = 'v66_foreign_tenant_mutation_succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

do $$
begin
  if (select count(*) from public.organization_audit_log where organization_id = current_setting('minuta.v66_org')::uuid) < 6 then
    raise exception using errcode = 'P0001', message = 'v66_audit_log_missing';
  end if;
  if has_table_privilege('authenticated', 'public.organization_invitations', 'SELECT')
     or has_table_privilege('authenticated', 'public.organization_audit_log', 'INSERT')
     or has_table_privilege('anon', 'public.organization_invitations', 'SELECT') then
    raise exception using errcode = 'P0001', message = 'v66_direct_table_grant_detected';
  end if;
end;
$$;

select 'multi-tenant v66 integration test: OK' as result;
rollback;
