begin;

-- Freeze a hash of the original request. Booking fields can later be changed by
-- rescheduling, so they must not be used to decide whether a retry is identical.
alter table public.bookings
  add column if not exists request_fingerprint text;

update public.bookings booking
set request_fingerprint = encode(digest(
  booking.service_id::text || chr(31) ||
  booking.booking_date::text || chr(31) ||
  booking.booking_time::text || chr(31) ||
  trim(booking.client_name) || chr(31) ||
  regexp_replace(booking.client_phone, '[^0-9]', '', 'g'),
  'sha256'
), 'hex')
where booking.request_id is not null
  and booking.request_fingerprint is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'bookings_request_fingerprint_check'
      and conrelid = 'public.bookings'::regclass
  ) then
    alter table public.bookings
      add constraint bookings_request_fingerprint_check
      check (
        (request_id is null and request_fingerprint is null)
        or (request_id is not null and request_fingerprint ~ '^[0-9a-f]{64}$')
      );
  end if;
end $$;

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
  v_request_fingerprint text;
  v_existing_fingerprint text;
begin
  if p_request_id is null then
    raise exception using errcode = 'P0001', message = 'request_id_required';
  end if;
  if p_service is null or p_date is null or p_time is null then
    raise exception using errcode = 'P0001', message = 'invalid_booking_data';
  end if;
  if coalesce(char_length(trim(p_client_name)), 0) < 2
     or coalesce(char_length(regexp_replace(p_client_phone, '[^0-9]', '', 'g')), 0) < 10 then
    raise exception using errcode = 'P0001', message = 'invalid_client_data';
  end if;

  v_request_fingerprint := encode(digest(
    p_service::text || chr(31) ||
    p_date::text || chr(31) ||
    p_time::text || chr(31) ||
    trim(p_client_name) || chr(31) ||
    regexp_replace(p_client_phone, '[^0-9]', '', 'g'),
    'sha256'
  ), 'hex');

  perform pg_advisory_xact_lock(hashtextextended('booking-request:' || p_request_id::text, 0));

  select booking.booking_code, booking.manage_token, booking.request_fingerprint
  into v_code, v_token, v_existing_fingerprint
  from public.bookings booking
  where booking.request_id = p_request_id;

  if found then
    if v_existing_fingerprint is distinct from v_request_fingerprint then
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
    booking_code, manage_token, request_id, request_fingerprint, performer_id, service_id,
    client_name, client_phone, booking_date, booking_time, duration_minutes,
    status, deposit_amount_rub, payment_status, payment_url
  ) values (
    v_code, v_token, p_request_id, v_request_fingerprint, v_performer, p_service,
    trim(p_client_name), trim(p_client_phone), p_date, p_time, v_duration,
    'new', v_deposit, v_payment_status, v_payment_url
  );

  return query select v_code, v_token;
end;
$$;

revoke all on function public.book_appointment(uuid, uuid, date, time without time zone, text, text) from public;
grant execute on function public.book_appointment(uuid, uuid, date, time without time zone, text, text) to anon, authenticated;

commit;
