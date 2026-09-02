begin;

do $$
begin
  if to_regclass('public.bookings') is null
     or to_regprocedure('public.prevent_minuta_group_event_booking_overlap()') is null then
    raise exception using
      errcode = 'P0001',
      message = 'v86_rollback_missing_group_overlap_prerequisites';
  end if;
end $$;

drop trigger if exists zz_bookings_group_event_overlap_v86 on public.bookings;
drop trigger if exists bookings_group_event_overlap on public.bookings;

create trigger bookings_group_event_overlap
before insert or update of
  organization_id, location_id, performer_id,
  booking_date, booking_time, duration_minutes, status
on public.bookings
for each row
execute function public.prevent_minuta_group_event_booking_overlap();

commit;
