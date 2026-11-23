CREATE OR REPLACE FUNCTION public.book_appointment(p_service uuid, p_date date, p_time time without time zone, p_client_name text, p_client_phone text)
 RETURNS TABLE(booking_code text, manage_token uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'extensions'
AS $function$
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
begin
  select service.performer_id, service.duration_minutes, service.price_rub
  into v_performer, v_duration, v_price
  from public.services service
  where service.id = p_service and service.active;
  if v_performer is null then
    raise exception using errcode = 'P0001', message = 'service_unavailable';
  end if;
  if char_length(trim(p_client_name)) < 2 or char_length(regexp_replace(p_client_phone, '\\D', '', 'g')) < 10 then
    raise exception using errcode = 'P0001', message = 'invalid_client_data';
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
  select * into v_policy from public.booking_policies where performer_id = v_performer;
  if coalesce(v_policy.deposit_enabled, false)
     and coalesce(v_policy.deposit_amount_rub, 0) > 0
     and coalesce(v_policy.payment_url_template, '') ~* '^https://' then
    v_deposit := least(v_policy.deposit_amount_rub, v_price);
    v_payment_status := 'pending';
    v_payment_url := replace(replace(v_policy.payment_url_template, '{code}', v_code), '{amount}', v_deposit::text);
  end if;

  insert into public.bookings (
    booking_code, manage_token, performer_id, service_id, client_name, client_phone,
    booking_date, booking_time, duration_minutes, status,
    deposit_amount_rub, payment_status, payment_url
  ) values (
    v_code, v_token, v_performer, p_service, trim(p_client_name), trim(p_client_phone),
    p_date, p_time, v_duration, 'new',
    v_deposit, v_payment_status, v_payment_url
  );
  return query select v_code, v_token;
end;
$function$
