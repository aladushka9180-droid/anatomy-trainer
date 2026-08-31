begin;

create or replace function public.get_booking_telegram_context(
  p_token uuid default null,
  p_booking uuid default null
)
returns table(
  id uuid,
  booking_code text,
  manage_token uuid,
  performer_id uuid,
  service_id uuid,
  client_name text,
  client_phone text,
  booking_date date,
  booking_time time without time zone,
  duration_minutes integer,
  status text,
  service_name text,
  price_rub integer,
  performer_name text
)
language sql
stable
security definer
set search_path to ''
as $$
  select
    booking.id,
    booking.booking_code,
    booking.manage_token,
    booking.performer_id,
    booking.service_id,
    booking.client_name,
    booking.client_phone,
    booking.booking_date,
    booking.booking_time,
    booking.duration_minutes,
    booking.status,
    service.name,
    service.price_rub,
    profile.display_name
  from public.bookings booking
  join public.services service on service.id = booking.service_id
  join public.performer_profiles profile on profile.id = booking.performer_id
  where (p_token is not null and booking.manage_token = p_token)
     or (p_booking is not null and booking.id = p_booking)
  limit 1;
$$;

create or replace function public.get_telegram_reminder_candidates(
  p_from date,
  p_to date
)
returns table(
  id uuid,
  booking_code text,
  manage_token uuid,
  performer_id uuid,
  service_id uuid,
  client_name text,
  client_phone text,
  booking_date date,
  booking_time time without time zone,
  duration_minutes integer,
  status text,
  service_name text,
  price_rub integer,
  performer_name text
)
language sql
stable
security definer
set search_path to ''
as $$
  select
    booking.id,
    booking.booking_code,
    booking.manage_token,
    booking.performer_id,
    booking.service_id,
    booking.client_name,
    booking.client_phone,
    booking.booking_date,
    booking.booking_time,
    booking.duration_minutes,
    booking.status,
    service.name,
    service.price_rub,
    profile.display_name
  from public.bookings booking
  join public.services service on service.id = booking.service_id
  join public.performer_profiles profile on profile.id = booking.performer_id
  where booking.status = 'confirmed'
    and booking.booking_date between p_from and p_to;
$$;

revoke all on function public.get_booking_telegram_context(uuid, uuid) from public;
revoke all on function public.get_telegram_reminder_candidates(date, date) from public;
grant execute on function public.get_booking_telegram_context(uuid, uuid) to service_role;
grant execute on function public.get_telegram_reminder_candidates(date, date) to service_role;

commit;
