begin;

drop function if exists public.create_minuta_batch_bookings(uuid,uuid,uuid,text,text,jsonb,uuid,text);
drop function if exists public.get_minuta_batch_booking_workspace(uuid);
drop function if exists public.set_minuta_batch_bookings_enabled(uuid,boolean,integer);
drop function if exists public.require_minuta_batch_booking_role(uuid);

do $$ begin
  if to_regclass('public.organization_batch_booking_settings') is not null then
    drop trigger if exists batch_booking_settings_touch on public.organization_batch_booking_settings;
  end if;
  if to_regclass('public.organizations') is not null then
    drop trigger if exists organizations_batch_booking_settings on public.organizations;
  end if;
end $$;
drop function if exists public.touch_minuta_batch_booking_settings();
drop function if exists public.ensure_minuta_batch_booking_settings();

drop table if exists public.booking_batch_audit_log;
drop table if exists public.booking_batch_items;
drop table if exists public.booking_batches;
drop table if exists public.organization_batch_booking_settings;

commit;
