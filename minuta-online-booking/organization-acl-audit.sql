\set ON_ERROR_STOP on
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- This audit may run only against the bootstrapped, explicitly allowed test project.
do $$
begin
  if not exists (
    select 1 from minuta_migration_guard.target
    where project_ref = 'umazhvvxutnsyuphbhda' and allow_migrations
  ) or not exists (
    select 1 from pg_class
    where oid = 'public.organizations'::regclass and relrowsecurity
  ) or exists (
    select 1 from auth.users
    where id in (
      '00000000-0000-4000-8000-00000000a101',
      '00000000-0000-4000-8000-00000000a102'
    )
  ) or exists (
    select 1 from public.organizations
    where id in (
      '00000000-0000-4000-8000-00000000a111',
      '00000000-0000-4000-8000-00000000a112'
    )
  ) then
    raise exception 'Isolated ACL test prerequisites not met; no fixtures created';
  end if;
end $$;

-- Avoid the real signup trigger for these two synthetic, transaction-only users.
set local session_replication_role = replica;
insert into auth.users (
  id, instance_id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-4000-8000-00000000a101', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'acl-a@example.invalid', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-4000-8000-00000000a102', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'acl-b@example.invalid', now(), '{}'::jsonb, '{}'::jsonb, now(), now());
set local session_replication_role = origin;

insert into public.organizations (id, name, created_by) values
  ('00000000-0000-4000-8000-00000000a111', 'ACL Audit A', '00000000-0000-4000-8000-00000000a101'),
  ('00000000-0000-4000-8000-00000000a112', 'ACL Audit B', '00000000-0000-4000-8000-00000000a102');
insert into public.organization_memberships (
  organization_id, user_id, role, is_bookable, active, created_by
) values
  ('00000000-0000-4000-8000-00000000a111', '00000000-0000-4000-8000-00000000a101', 'owner', false, true, '00000000-0000-4000-8000-00000000a101'),
  ('00000000-0000-4000-8000-00000000a112', '00000000-0000-4000-8000-00000000a102', 'owner', false, true, '00000000-0000-4000-8000-00000000a102');

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000a101', true);
set local role authenticated;
do $$
begin
  if current_user <> 'authenticated'
    or auth.uid() <> '00000000-0000-4000-8000-00000000a101'::uuid
    or (select count(*) from public.organizations) <> 1
    or not exists (
      select 1 from public.organizations
      where id = '00000000-0000-4000-8000-00000000a111'
    )
    or exists (
      select 1 from public.organizations
      where id = '00000000-0000-4000-8000-00000000a112'
    ) then
    raise exception 'Organization isolation failed for synthetic owner A';
  end if;
end $$;
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000a102', true);
set local role authenticated;
do $$
begin
  if current_user <> 'authenticated'
    or auth.uid() <> '00000000-0000-4000-8000-00000000a102'::uuid
    or (select count(*) from public.organizations) <> 1
    or not exists (
      select 1 from public.organizations
      where id = '00000000-0000-4000-8000-00000000a112'
    )
    or exists (
      select 1 from public.organizations
      where id = '00000000-0000-4000-8000-00000000a111'
    ) then
    raise exception 'Organization isolation failed for synthetic owner B';
  end if;
end $$;
reset role;

rollback;

do $$
begin
  if exists (
    select 1 from auth.users
    where id in (
      '00000000-0000-4000-8000-00000000a101',
      '00000000-0000-4000-8000-00000000a102'
    )
  ) or exists (
    select 1 from public.organizations
    where id in (
      '00000000-0000-4000-8000-00000000a111',
      '00000000-0000-4000-8000-00000000a112'
    )
  ) then
    raise exception 'ACL audit fixtures remained after rollback';
  end if;
end $$;
select 'organization ACL audit: PASS; fixtures rolled back' as result;
