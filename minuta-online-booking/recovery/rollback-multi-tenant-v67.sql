begin;

-- Restore the exact v66 state: first disable the configured public tenant, then
-- remove the read-only catalog RPC in the same transaction.
do $$
declare
  v_target_count integer;
begin
  if exists (
    select 1
    from public.organizations
    where public_booking_enabled
      and public_slug <> 'minuta-abeb5b13ca1d45c6a2adb0e4119b2e1f'
  ) then
    raise exception using errcode = 'P0001', message = 'v67_rollback_blocked_unexpected_public_organization';
  end if;

  select count(*)
  into v_target_count
  from public.organizations
  where public_slug = 'minuta-abeb5b13ca1d45c6a2adb0e4119b2e1f';
  if v_target_count <> 1 then
    raise exception using errcode = 'P0001', message = 'v67_rollback_default_organization_not_found';
  end if;

  update public.organizations
  set public_booking_enabled = false
  where public_slug = 'minuta-abeb5b13ca1d45c6a2adb0e4119b2e1f'
    and public_booking_enabled;
end;
$$;

drop function if exists public.get_public_minuta_catalog(text);

commit;
