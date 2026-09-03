\set ON_ERROR_STOP on

begin;
set local lock_timeout = '5s';
set local statement_timeout = '10min';

drop trigger if exists zz_bookings_buffer_v101 on public.bookings;
drop function if exists public.enforce_minuta_booking_buffer_v101();
drop function if exists public.get_reschedule_slots_v101(uuid,date,date);
drop function if exists public.get_public_minuta_available_slots_v101(text,uuid,uuid,date,date);
drop function if exists public.get_available_slots_v101(uuid,date,date,uuid);
drop function if exists public.minuta_slot_respects_booking_buffer(uuid,date,time without time zone,integer,uuid);

alter table public.booking_policies
  drop constraint if exists booking_policies_buffer_minutes_check,
  drop column if exists booking_buffer_minutes,
  drop column if exists booking_buffer_enabled;

commit;
