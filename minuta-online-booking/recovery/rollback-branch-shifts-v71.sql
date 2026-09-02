begin;

-- Refuse rollback while strict scheduling is active. Disable it through the
-- owner UI first so the legacy availability path is restored deliberately.
do $$
begin
  if exists (select 1 from public.organization_shift_settings where enabled) then
    raise exception using errcode='P0001', message='disable_branch_shifts_before_rollback';
  end if;
end;
$$;

drop function if exists public.get_public_minuta_catalog_v4(text);
drop function if exists public.get_public_minuta_available_slots_v4(text,uuid,uuid,date,date);
drop function if exists public.get_reschedule_slots_v4(uuid,date,date);
drop function if exists public.substitute_minuta_booking(uuid,uuid,uuid);
drop function if exists public.set_minuta_branch_shifts_enabled(uuid,boolean);
drop function if exists public.cancel_minuta_staff_absence(uuid);
drop function if exists public.create_minuta_staff_absence(uuid,uuid,date,date,text,text);
drop function if exists public.cancel_minuta_staff_shift(uuid);
drop function if exists public.upsert_minuta_staff_shift(uuid,uuid,uuid,uuid,date,time without time zone,time without time zone,time without time zone,time without time zone,text);
drop function if exists public.get_minuta_shift_workspace(uuid,date,date);
drop trigger if exists bookings_enforce_active_shift on public.bookings;
drop function if exists public.enforce_minuta_booking_shift();
drop function if exists public.minuta_booking_fits_active_shift(uuid,uuid,uuid,date,time without time zone,integer);
drop function if exists public.write_minuta_schedule_audit(uuid,text,uuid,jsonb);
drop function if exists public.get_minuta_schedule_role(uuid);

drop table if exists public.staff_schedule_audit_log;
drop table if exists public.staff_absences;
drop table if exists public.staff_location_shifts;
drop table if exists public.organization_shift_settings;

commit;
