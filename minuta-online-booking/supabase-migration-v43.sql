begin;

-- A browser-generated request UUID makes public booking creation idempotent.
-- The existing five-argument RPC is intentionally kept for cached v44 clients.
alter table public.bookings
  add column if not exists request_id uuid;

create unique index if not exists idx_bookings_request_id
  on public.bookings (request_id)
  where request_id is not null;

create or replace function public.book_appointment(
  p_request_id uuid,
  p_service uuid,
  p_date date,
  p_time time without time zone,
  p_client_name text,
  p_client_phone text
)
returns table(booking_code text, manage_token uuid)
language plpgsql
security definer
set search_path to 'pg_catalog', 'extensions'
as $$
declare
  v_performer uuid;
  v_duration integer;
  v_price integer;
  v_code text;
  v_token uuid;
  v_deposit integer := 0;
  v_payment_status text := 'not_required';
  v_payment_url text := '';
  v_policy public.booking_policies%rowtype;
  v_existing_service uuid;
  v_existing_date date;
  v_existing_time time without time zone;
  v_existing_name text;
  v_existing_phone text;
begin
  if p_request_id is null then
    raise exception using errcode = 'P0001', message = 'request_id_required';
  end if;
  if coalesce(char_length(trim(p_client_name)), 0) < 2
     or coalesce(char_length(regexp_replace(p_client_phone, '[^0-9]', '', 'g')), 0) < 10 then
    raise exception using errcode = 'P0001', message = 'invalid_client_data';
  end if;

  -- Serialize retries of the same logical operation before looking for its result.
  perform pg_advisory_xact_lock(hashtextextended('booking-request:' || p_request_id::text, 0));

  select booking.booking_code, booking.manage_token, booking.service_id,
         booking.booking_date, booking.booking_time, trim(booking.client_name),
         regexp_replace(booking.client_phone, '[^0-9]', '', 'g')
  into v_code, v_token, v_existing_service, v_existing_date, v_existing_time,
       v_existing_name, v_existing_phone
  from public.bookings booking
  where booking.request_id = p_request_id;

  if found then
    if v_existing_service is distinct from p_service
       or v_existing_date is distinct from p_date
       or v_existing_time is distinct from p_time
       or v_existing_name is distinct from trim(p_client_name)
       or v_existing_phone is distinct from regexp_replace(p_client_phone, '[^0-9]', '', 'g') then
      raise exception using errcode = 'P0001', message = 'request_conflict';
    end if;
    return query select v_code, v_token;
    return;
  end if;

  select service.performer_id, service.duration_minutes, service.price_rub
  into v_performer, v_duration, v_price
  from public.services service
  where service.id = p_service and service.active;
  if v_performer is null then
    raise exception using errcode = 'P0001', message = 'service_unavailable';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_performer::text || p_date::text, 0));
  if not exists (
    select 1 from public.get_available_slots(p_service, p_date, p_date) available
    where available.booking_date = p_date and available.booking_time = p_time
  ) then
    raise exception using errcode = 'P0001', message = 'slot_unavailable';
  end if;

  v_code := 'MIN-' || upper(substr(encode(gen_random_bytes(5), 'hex'), 1, 8));
  v_token := gen_random_uuid();
  select * into v_policy
  from public.booking_policies
  where performer_id = v_performer;
  if coalesce(v_policy.deposit_enabled, false)
     and coalesce(v_policy.deposit_amount_rub, 0) > 0
     and coalesce(v_policy.payment_url_template, '') ~* '^https://' then
    v_deposit := least(v_policy.deposit_amount_rub, v_price);
    v_payment_status := 'pending';
    v_payment_url := replace(replace(v_policy.payment_url_template, '{code}', v_code), '{amount}', v_deposit::text);
  end if;

  insert into public.bookings (
    booking_code, manage_token, request_id, performer_id, service_id,
    client_name, client_phone, booking_date, booking_time, duration_minutes,
    status, deposit_amount_rub, payment_status, payment_url
  ) values (
    v_code, v_token, p_request_id, v_performer, p_service,
    trim(p_client_name), trim(p_client_phone), p_date, p_time, v_duration,
    'new', v_deposit, v_payment_status, v_payment_url
  );

  return query select v_code, v_token;
end;
$$;

revoke all on function public.book_appointment(uuid, uuid, date, time without time zone, text, text) from public;
grant execute on function public.book_appointment(uuid, uuid, date, time without time zone, text, text) to anon, authenticated;

commit;
