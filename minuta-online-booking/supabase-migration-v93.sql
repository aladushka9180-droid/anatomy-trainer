begin;

set local search_path = public, extensions, pg_catalog;

do $$
begin
  if to_regclass('public.bookings') is null then
    raise exception using errcode='P0001',message='v93_requires_bookings';
  end if;
end $$;

-- Supports the provider cabinet's most frequent ordered lookup without changing
-- the result set or exposing any additional data.
create index if not exists bookings_performer_date_time_v93_idx
  on public.bookings (performer_id,booking_date,booking_time);

commit;
