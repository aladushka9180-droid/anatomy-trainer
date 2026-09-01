begin;

do $$
begin
  if to_regprocedure('public.get_public_minuta_catalog(text)') is null then
    raise exception using errcode = 'P0001', message = 'v67_test_requires_v67';
  end if;
  if not exists (select 1 from public.organizations where legacy_performer_id is not null) then
    raise exception using errcode = 'P0001', message = 'v67_test_requires_legacy_organization';
  end if;
end;
$$;

select set_config(
  'minuta.v67_org',
  (select organization.id::text from public.organizations organization where organization.legacy_performer_id is not null order by organization.id limit 1),
  true
);
select set_config(
  'minuta.v67_slug',
  (select organization.public_slug from public.organizations organization where organization.id = current_setting('minuta.v67_org')::uuid),
  true
);
select set_config(
  'minuta.v67_expected_services',
  (select count(*)::text
   from public.services service
   join public.organization_memberships membership
     on membership.organization_id = current_setting('minuta.v67_org')::uuid
    and membership.user_id = service.performer_id
    and membership.active
    and membership.is_bookable
   where service.active),
  true
);

-- Exercise the disabled state inside this transaction even though v67 activates
-- the configured tenant atomically during installation.
update public.organizations
set public_booking_enabled = false
where id = current_setting('minuta.v67_org')::uuid;

set local role anon;
do $$
declare
  v_catalog jsonb := public.get_public_minuta_catalog(current_setting('minuta.v67_slug'));
begin
  if (v_catalog ->> 'organization') is not null
     or jsonb_array_length(v_catalog -> 'services') <> 0
     or jsonb_array_length(v_catalog -> 'locations') <> 0 then
    raise exception using errcode = 'P0001', message = 'v67_disabled_organization_was_public';
  end if;
end;
$$;
reset role;

update public.organizations
set public_booking_enabled = true
where id = current_setting('minuta.v67_org')::uuid;

set local role anon;
do $$
declare
  v_catalog jsonb := public.get_public_minuta_catalog(current_setting('minuta.v67_slug'));
  v_unknown jsonb := public.get_public_minuta_catalog('unknown-tenant-v67');
begin
  if v_catalog #>> '{organization,public_slug}' <> current_setting('minuta.v67_slug') then
    raise exception using errcode = 'P0001', message = 'v67_enabled_organization_missing';
  end if;
  if jsonb_array_length(v_catalog -> 'services') <> current_setting('minuta.v67_expected_services')::integer then
    raise exception using errcode = 'P0001', message = 'v67_catalog_service_scope_failed';
  end if;
  if (v_unknown ->> 'organization') is not null
     or jsonb_array_length(v_unknown -> 'services') <> 0 then
    raise exception using errcode = 'P0001', message = 'v67_unknown_tenant_visible';
  end if;
  if exists (
    select 1
    from jsonb_object_keys(v_catalog) key
    where key not in ('organization', 'locations', 'services')
  ) then
    raise exception using errcode = 'P0001', message = 'v67_private_top_level_field_visible';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(v_catalog -> 'services') service,
         jsonb_object_keys(service) key
    where key not in ('id', 'performer_id', 'name', 'duration_minutes', 'price_rub', 'performer_profiles')
  ) then
    raise exception using errcode = 'P0001', message = 'v67_private_service_field_visible';
  end if;
end;
$$;
reset role;

do $$
declare
  v_function oid := 'public.get_public_minuta_catalog(text)'::regprocedure;
begin
  if not has_function_privilege('anon', v_function, 'EXECUTE')
     or not has_function_privilege('authenticated', v_function, 'EXECUTE')
     or has_function_privilege('service_role', v_function, 'EXECUTE')
     or exists (
       select 1
       from aclexplode(coalesce((select proacl from pg_proc where oid = v_function), acldefault('f', (select proowner from pg_proc where oid = v_function)))) privilege
       where privilege.grantee = 0 and privilege.privilege_type = 'EXECUTE'
     ) then
    raise exception using errcode = 'P0001', message = 'v67_catalog_acl_failed';
  end if;
end;
$$;

select 'multi-tenant v67 integration test: OK' as result;
rollback;
