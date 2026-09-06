\set ON_ERROR_STOP on

begin;

do $$ begin
  if to_regclass('public.organization_client_profiles') is not null
     and exists(select 1 from public.organization_client_profiles where online_booking_blocked) then
    raise exception using errcode='P0001',message='v119_rollback_blocked_active_client_blocks';
  end if;
end $$;

drop trigger if exists zy_bookings_client_online_block_v119 on public.bookings;
drop function if exists public.enforce_minuta_client_online_booking_block_v119();
drop function if exists public.set_minuta_client_online_booking_block_v119(uuid,text,boolean);
drop function if exists public.save_minuta_client_birthday_v119(uuid,text,date);
drop function if exists public.get_minuta_client_profile_v119(uuid,text);

do $$ begin
  if to_regclass('public.organization_client_profiles') is not null then
    execute 'revoke all on public.organization_client_profiles from public,anon,authenticated,service_role';
    execute 'grant all on public.organization_client_profiles to service_role';
  end if;
end $$;

-- Saved birthdays are intentionally retained for a compatible forward reapply.
notify pgrst,'reload schema';
commit;
