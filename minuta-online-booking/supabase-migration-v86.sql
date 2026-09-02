begin;

set local search_path = public, extensions, pg_catalog;

do $$
begin
  if to_regclass('public.bookings') is null
     or to_regprocedure('public.scope_minuta_booking()') is null
     or to_regprocedure('public.prevent_minuta_group_event_booking_overlap()') is null
     or not exists (
       select 1
       from pg_trigger
       where tgrelid = 'public.bookings'::regclass
         and tgname = 'bookings_scope_minuta_tenant'
         and not tgisinternal
         and tgenabled <> 'D'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'v86_missing_group_overlap_prerequisites';
  end if;
end $$;

-- PostgreSQL runs BEFORE triggers with the same event in name order. The v80
-- trigger used to run before bookings_scope_minuta_tenant and therefore could
-- inspect an INSERT before organization_id/location_id were filled. The zz
-- prefix preserves the same check but guarantees that tenant scope runs first.
drop trigger if exists bookings_group_event_overlap on public.bookings;
drop trigger if exists zz_bookings_group_event_overlap_v86 on public.bookings;

create trigger zz_bookings_group_event_overlap_v86
before insert or update of
  organization_id, location_id, performer_id,
  booking_date, booking_time, duration_minutes, status
on public.bookings
for each row
execute function public.prevent_minuta_group_event_booking_overlap();

commit;
