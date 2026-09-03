\set ON_ERROR_STOP on

begin;

drop function if exists public.get_minuta_booking_events_v97(uuid,date,date,integer,integer);
drop function if exists public.get_minuta_staff_report_bookings_v97(uuid,date,date,uuid,integer,integer);
drop function if exists public.get_minuta_staff_report_availability(uuid,date,date,uuid);
drop trigger if exists booking_events_snapshot_names_v97 on public.booking_events;
drop function if exists public.snapshot_minuta_booking_event_v97();
drop trigger if exists booking_outcomes_snapshot_performer_v97 on public.booking_outcomes;
drop function if exists public.snapshot_minuta_completed_performer_v97();

-- Снимки, их внешние ключи и данные истории намеренно сохраняются: их
-- удаление сделало бы тестовый rollback разрушительным для журнала.
commit;

drop index concurrently if exists public.booking_outcomes_completed_performer_v97_idx;
