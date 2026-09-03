begin;

drop function if exists public.get_minuta_staff_report_bookings(uuid,date,date,uuid);
drop index if exists public.bookings_performer_date_time_v94_idx;

commit;
