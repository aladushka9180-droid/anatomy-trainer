begin;

set local search_path = public, extensions, pg_catalog;

do $$
begin
  if to_regclass('public.bookings') is null then
    raise exception using errcode='P0001',message='v94_requires_bookings';
  end if;
end $$;

-- Supports the provider cabinet's ordered booking lookup without changing
-- access policies or exposing additional data.
create index if not exists bookings_performer_date_time_v94_idx
  on public.bookings (performer_id,booking_date,booking_time);

commit;
