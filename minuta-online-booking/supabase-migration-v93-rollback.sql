begin;

-- Только для изолированной тестовой базы: удаляет накопленный журнал событий.

drop function if exists public.get_minuta_booking_events(uuid,date,date,integer);

drop trigger if exists booking_outcomes_capture_event_v93 on public.booking_outcomes;
drop trigger if exists bookings_capture_event_v93 on public.bookings;

drop function if exists public.capture_minuta_outcome_event_v93();
drop function if exists public.capture_minuta_booking_event_v93();
drop function if exists public.minuta_booking_value_v93(jsonb,uuid);

drop table if exists public.booking_events;

commit;
