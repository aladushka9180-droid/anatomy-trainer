begin;

-- Только для изолированной тестовой базы. Индекс календаря принадлежит v96.
drop function if exists public.get_minuta_staff_report_bookings(uuid,date,date,uuid,integer,integer);
drop function if exists public.get_minuta_staff_report_bookings(uuid,date,date,uuid);

commit;
