begin;

alter table public.bookings
  add column if not exists original_price_rub integer,
  add column if not exists total_price_rub integer;

update public.bookings booking
set original_price_rub = coalesce(booking.original_price_rub, service.price_rub),
    total_price_rub = coalesce(booking.total_price_rub, service.price_rub)
from public.services service
where service.id = booking.service_id
  and booking.booking_date >= current_date
  and (booking.original_price_rub is null or booking.total_price_rub is null);

alter table public.bookings
  drop constraint if exists bookings_original_price_rub_check;
alter table public.bookings
  add constraint bookings_original_price_rub_check
  check (original_price_rub is null or original_price_rub between 0 and 1000000);
alter table public.bookings
  drop constraint if exists bookings_total_price_rub_check;
alter table public.bookings
  add constraint bookings_total_price_rub_check
  check (total_price_rub is null or total_price_rub between 0 and 10000000);

create or replace function public.get_client_bookings(p_session_token text)
returns table(
  booking_code text,
  manage_token uuid,
  client_name text,
  service_name text,
  duration_minutes integer,
  price_rub integer,
  performer_name text,
  booking_date date,
  booking_time time without time zone,
  status text,
  cancel_allowed boolean,
  reschedule_allowed boolean,
  reschedules_remaining integer,
  deposit_amount_rub integer,
  payment_status text,
  payment_url text
)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_account_id uuid;
  v_expires_at timestamptz;
begin
  select resolved.client_account_id, resolved.session_expires_at
  into v_account_id, v_expires_at
  from public.resolve_client_session(p_session_token) resolved;
  if v_account_id is null then
    return;
  end if;

  return query
  select
    booking.booking_code::text,
    booking.manage_token,
    booking.client_name::text,
    service.name::text,
    booking.duration_minutes::integer,
    coalesce(booking.total_price_rub, service.price_rub)::integer,
    profile.display_name::text,
    booking.booking_date,
    booking.booking_time,
    booking.status::text,
    booking.status <> 'cancelled'
      and timezone('Europe/Samara', now()) <= booking.booking_date + booking.booking_time - make_interval(hours => coalesce(policy.cancel_cutoff_hours, 12)),
    booking.status <> 'cancelled'
      and booking.reschedule_count < coalesce(policy.max_reschedules, 2)
      and timezone('Europe/Samara', now()) <= booking.booking_date + booking.booking_time - make_interval(hours => coalesce(policy.reschedule_cutoff_hours, 12)),
    greatest(0, coalesce(policy.max_reschedules, 2) - booking.reschedule_count)::integer,
    booking.deposit_amount_rub::integer,
    booking.payment_status::text,
    booking.payment_url::text
  from public.bookings booking
  join public.services service on service.id = booking.service_id
  join public.performer_profiles profile on profile.id = booking.performer_id
  left join public.booking_policies policy on policy.performer_id = booking.performer_id
  where booking.client_account_id = v_account_id
  order by
    case
      when booking.status <> 'cancelled'
       and booking.booking_date + booking.booking_time >= timezone('Europe/Samara', now()) then 0
      else 1
    end,
    case
      when booking.status <> 'cancelled'
       and booking.booking_date + booking.booking_time >= timezone('Europe/Samara', now())
      then booking.booking_date + booking.booking_time
    end asc,
    booking.booking_date desc,
    booking.booking_time desc;
end;
$$;

revoke all on function public.get_client_bookings(text) from public;
grant execute on function public.get_client_bookings(text) to anon, authenticated;

commit;
