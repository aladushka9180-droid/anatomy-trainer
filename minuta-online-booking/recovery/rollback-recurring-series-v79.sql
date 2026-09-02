begin;

do $$
begin
  if to_regclass('public.booking_series') is not null
     and exists (select 1 from public.booking_series limit 1) then
    raise exception using errcode = 'P0001', message = 'v79_rollback_blocked_booking_series_exist';
  end if;
end $$;

drop function if exists public.manage_minuta_booking_series(
  uuid,text,text,date,time without time zone
);
drop function if exists public.create_minuta_recurring_bookings(
  uuid,date,time without time zone,text,text,integer,integer
);
drop index if exists public.bookings_series_occurrence_uidx;
drop index if exists public.booking_series_performer_created_idx;
alter table public.bookings drop constraint if exists bookings_series_occurrence_check;
alter table public.bookings drop column if exists series_occurrence;
alter table public.bookings drop column if exists series_id;
drop table if exists public.booking_series;

commit;
