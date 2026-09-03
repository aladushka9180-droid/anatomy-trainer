begin;

drop function if exists public.get_minuta_staff_report_availability(uuid,date,date,uuid);
drop function if exists public.get_minuta_staff_report_bookings_v95(uuid,date,date,uuid);
drop trigger if exists booking_outcomes_snapshot_performer_v95 on public.booking_outcomes;
drop function if exists public.snapshot_minuta_completed_performer_v95();
drop index if exists public.booking_outcomes_completed_performer_v95_idx;

-- completed_performer_id may already contain historical snapshots. Keep the
-- column and its data during rollback; a later forward migration can reuse it.

commit;
