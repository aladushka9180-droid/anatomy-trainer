begin;

-- Provider-neutral payment ledger. This migration is additive and keeps the
-- legacy set_booking_payment_status(uuid, text) RPC for already cached clients.
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete restrict,
  performer_id uuid not null references public.performer_profiles(id) on delete restrict,
  provider text not null check (provider ~ '^[a-z0-9][a-z0-9_-]{1,62}$'),
  provider_operation_id text not null check (char_length(provider_operation_id) between 1 and 200),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null default 'RUB' check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'failed', 'cancelled', 'refunded')),
  provider_created_at timestamptz,
  last_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_operation_id)
);

create index if not exists idx_payments_booking_created
  on public.payments (booking_id, created_at desc);
create index if not exists idx_payments_performer_created
  on public.payments (performer_id, created_at desc);

-- The journal deliberately stores a SHA-256 digest instead of a raw webhook
-- body, because a provider payload can contain personal or payment data.
create table if not exists public.payment_events (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid references public.payments(id) on delete restrict,
  performer_id uuid references public.performer_profiles(id) on delete restrict,
  provider text not null check (provider ~ '^[a-z0-9][a-z0-9_-]{1,62}$'),
  provider_event_id text not null check (char_length(provider_event_id) between 1 and 200),
  provider_operation_id text not null check (char_length(provider_operation_id) between 1 and 200),
  event_type text not null check (char_length(event_type) between 1 and 100),
  requested_status text check (
    requested_status is null
    or requested_status in ('pending', 'paid', 'failed', 'cancelled', 'refunded')
  ),
  previous_status text check (
    previous_status is null
    or previous_status in ('pending', 'paid', 'failed', 'cancelled', 'refunded')
  ),
  processing_status text not null default 'received'
    check (processing_status in ('received', 'processed', 'failed')),
  payload_sha256 text check (payload_sha256 is null or payload_sha256 ~ '^[0-9a-f]{64}$'),
  error_code text check (error_code is null or char_length(error_code) between 1 and 100),
  actor_kind text not null default 'webhook' check (actor_kind in ('webhook', 'admin', 'system')),
  actor_user_id uuid,
  manual_reason text check (manual_reason is null or char_length(trim(manual_reason)) between 8 and 500),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, provider_event_id)
);

create index if not exists idx_payment_events_payment_received
  on public.payment_events (payment_id, received_at desc);
create index if not exists idx_payment_events_failed
  on public.payment_events (processing_status, received_at)
  where processing_status = 'failed';

drop trigger if exists payments_touch_updated_at on public.payments;
create trigger payments_touch_updated_at before update on public.payments
for each row execute function public.touch_minuta_updated_at();

alter table public.payments enable row level security;
alter table public.payment_events enable row level security;

drop policy if exists payments_owner_read on public.payments;
create policy payments_owner_read on public.payments
  for select to authenticated
  using (performer_id = (select auth.uid()));

drop policy if exists payment_events_owner_read on public.payment_events;
create policy payment_events_owner_read on public.payment_events
  for select to authenticated
  using (performer_id = (select auth.uid()));

revoke all on public.payments, public.payment_events from anon, authenticated;
grant select on public.payments, public.payment_events to authenticated;

create or replace function public.minuta_payment_target_allowed(
  p_previous text,
  p_target text
)
returns boolean
language sql
immutable
security invoker
set search_path to ''
as $$
  select case
    when p_previous = p_target then true
    when p_previous = 'pending' and p_target in ('paid', 'failed', 'cancelled') then true
    when p_previous = 'paid' and p_target = 'refunded' then true
    else false
  end;
$$;

create or replace function public.minuta_refresh_booking_payment_status(p_booking uuid)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_status text;
  v_deposit integer;
begin
  select booking.deposit_amount_rub
  into v_deposit
  from public.bookings booking
  where booking.id = p_booking
  for update;

  if v_deposit is null then
    raise exception using errcode = 'P0001', message = 'booking_unavailable';
  end if;

  if v_deposit <= 0 then
    v_status := 'not_required';
  elsif exists (
    select 1 from public.payments payment
    where payment.booking_id = p_booking and payment.status = 'paid'
  ) then
    v_status := 'paid';
  elsif exists (
    select 1 from public.payments payment
    where payment.booking_id = p_booking and payment.status = 'pending'
  ) then
    v_status := 'pending';
  elsif exists (
    select 1 from public.payments payment
    where payment.booking_id = p_booking and payment.status = 'refunded'
  ) then
    v_status := 'refunded';
  else
    v_status := 'pending';
  end if;

  update public.bookings
  set payment_status = v_status
  where id = p_booking;
  return v_status;
end;
$$;

-- Called by the future checkout adapter after the provider has created an
-- operation. Only the server-side service role may register provider IDs.
create or replace function public.register_payment_operation(
  p_booking uuid,
  p_provider text,
  p_provider_operation_id text,
  p_amount_minor bigint,
  p_currency text default 'RUB',
  p_provider_created_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_payment uuid;
  v_performer uuid;
  v_deposit integer;
  v_booking_payment_status text;
  v_existing public.payments%rowtype;
  v_provider text := lower(trim(p_provider));
  v_currency text := upper(trim(p_currency));
begin
  if coalesce(v_provider, '') !~ '^[a-z0-9][a-z0-9_-]{1,62}$'
     or char_length(coalesce(p_provider_operation_id, '')) not between 1 and 200
     or coalesce(v_currency, '') !~ '^[A-Z]{3}$'
     or p_amount_minor is null
     or p_amount_minor <= 0 then
    raise exception using errcode = 'P0001', message = 'invalid_payment_operation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_provider || ':' || p_provider_operation_id, 0));
  select payment.* into v_existing
  from public.payments payment
  where payment.provider = v_provider
    and payment.provider_operation_id = p_provider_operation_id
  for update;

  if found then
    if v_existing.booking_id <> p_booking
       or v_existing.amount_minor <> p_amount_minor
       or v_existing.currency <> v_currency then
      raise exception using errcode = 'P0001', message = 'payment_operation_conflict';
    end if;
    return v_existing.id;
  end if;

  select booking.performer_id, booking.deposit_amount_rub, booking.payment_status
  into v_performer, v_deposit, v_booking_payment_status
  from public.bookings booking
  where booking.id = p_booking
  for update;

  if v_performer is null or v_deposit <= 0 then
    raise exception using errcode = 'P0001', message = 'booking_payment_not_required';
  end if;
  if v_booking_payment_status = 'paid' then
    raise exception using errcode = 'P0001', message = 'booking_already_paid';
  end if;
  if v_currency <> 'RUB' or p_amount_minor <> v_deposit::bigint * 100 then
    raise exception using errcode = 'P0001', message = 'payment_amount_mismatch';
  end if;

  insert into public.payments (
    booking_id, performer_id, provider, provider_operation_id,
    amount_minor, currency, provider_created_at
  ) values (
    p_booking, v_performer, v_provider, p_provider_operation_id,
    p_amount_minor, v_currency, p_provider_created_at
  ) returning id into v_payment;

  perform public.minuta_refresh_booking_payment_status(p_booking);
  return v_payment;
end;
$$;

-- Idempotent API boundary used only after the Edge Function has verified the
-- provider signature over the exact raw request body.
create or replace function public.process_payment_webhook(
  p_provider text,
  p_provider_event_id text,
  p_provider_operation_id text,
  p_event_type text,
  p_target_status text,
  p_amount_minor bigint,
  p_currency text,
  p_event_created_at timestamptz,
  p_payload_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_event uuid;
  v_payment public.payments%rowtype;
  v_processing_status text;
  v_provider text := lower(trim(p_provider));
  v_currency text := upper(trim(p_currency));
  v_result jsonb;
begin
  if coalesce(v_provider, '') !~ '^[a-z0-9][a-z0-9_-]{1,62}$'
     or char_length(coalesce(p_provider_event_id, '')) not between 1 and 200
     or char_length(coalesce(p_provider_operation_id, '')) not between 1 and 200
     or char_length(coalesce(p_event_type, '')) not between 1 and 100
     or p_target_status is null
     or p_target_status not in ('pending', 'paid', 'failed', 'cancelled', 'refunded')
     or coalesce(v_currency, '') !~ '^[A-Z]{3}$'
     or p_amount_minor is null
     or p_amount_minor <= 0
     or p_payload_sha256 is null
     or p_payload_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P0001', message = 'invalid_webhook_event';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_provider || ':event:' || p_provider_event_id, 0));
  perform pg_advisory_xact_lock(hashtextextended(v_provider || ':operation:' || p_provider_operation_id, 0));

  insert into public.payment_events (
    provider, provider_event_id, provider_operation_id, event_type,
    requested_status, payload_sha256, actor_kind
  ) values (
    v_provider, p_provider_event_id, p_provider_operation_id, trim(p_event_type),
    p_target_status, p_payload_sha256, 'webhook'
  ) on conflict (provider, provider_event_id) do nothing
  returning id into v_event;

  if v_event is null then
    select event.id, event.processing_status
    into v_event, v_processing_status
    from public.payment_events event
    where event.provider = v_provider and event.provider_event_id = p_provider_event_id
    for update;

    if exists (
      select 1 from public.payment_events event
      where event.id = v_event
        and (
          event.provider_operation_id <> p_provider_operation_id
          or event.event_type <> trim(p_event_type)
          or event.requested_status is distinct from p_target_status
          or event.payload_sha256 is distinct from p_payload_sha256
        )
    ) then
      raise exception using errcode = 'P0001', message = 'webhook_event_conflict';
    end if;

    if v_processing_status = 'processed' then
      return jsonb_build_object('accepted', true, 'duplicate', true, 'event_id', v_event);
    end if;
  end if;

  select payment.* into v_payment
  from public.payments payment
  where payment.provider = v_provider
    and payment.provider_operation_id = p_provider_operation_id
  for update;

  if not found then
    update public.payment_events
    set processing_status = 'failed', error_code = 'unknown_payment_operation'
    where id = v_event;
    return jsonb_build_object(
      'accepted', false,
      'duplicate', false,
      'event_id', v_event,
      'error_code', 'unknown_payment_operation'
    );
  end if;

  update public.payment_events
  set payment_id = v_payment.id,
      performer_id = v_payment.performer_id,
      previous_status = v_payment.status
  where id = v_event;

  if p_amount_minor <> v_payment.amount_minor or v_currency <> v_payment.currency then
    update public.payment_events
    set processing_status = 'failed', error_code = 'payment_amount_mismatch'
    where id = v_event;
    return jsonb_build_object(
      'accepted', false,
      'duplicate', false,
      'event_id', v_event,
      'error_code', 'payment_amount_mismatch'
    );
  end if;

  if p_event_created_at is not null
     and v_payment.last_event_at is not null
     and p_event_created_at < v_payment.last_event_at then
    update public.payment_events
    set processing_status = 'processed',
        processed_at = now(),
        error_code = 'stale_payment_event_ignored'
    where id = v_event;
    return jsonb_build_object(
      'accepted', true,
      'duplicate', false,
      'ignored', true,
      'event_id', v_event,
      'status', v_payment.status
    );
  end if;

  if not public.minuta_payment_target_allowed(v_payment.status, p_target_status) then
    update public.payment_events
    set processing_status = 'failed', error_code = 'invalid_payment_transition'
    where id = v_event;
    return jsonb_build_object(
      'accepted', false,
      'duplicate', false,
      'event_id', v_event,
      'error_code', 'invalid_payment_transition'
    );
  end if;

  update public.payments
  set status = p_target_status,
      last_event_at = greatest(coalesce(last_event_at, '-infinity'::timestamptz), coalesce(p_event_created_at, now()))
  where id = v_payment.id;

  perform public.minuta_refresh_booking_payment_status(v_payment.booking_id);
  update public.payment_events
  set processing_status = 'processed', processed_at = now(), error_code = null
  where id = v_event;

  v_result := jsonb_build_object(
    'accepted', true,
    'duplicate', false,
    'event_id', v_event,
    'payment_id', v_payment.id,
    'booking_id', v_payment.booking_id,
    'status', p_target_status
  );
  return v_result;
end;
$$;

-- Authenticated providers can correct a payment only for their own booking.
-- Every correction requires a reason and is appended to the immutable journal.
create or replace function public.adjust_booking_payment_status(
  p_booking uuid,
  p_status text,
  p_reason text
)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_payment public.payments%rowtype;
  v_performer uuid;
  v_deposit integer;
  v_reason text := trim(p_reason);
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if p_status is null
     or p_status not in ('pending', 'paid', 'failed', 'cancelled', 'refunded')
     or char_length(coalesce(v_reason, '')) not between 8 and 500 then
    raise exception using errcode = 'P0001', message = 'invalid_manual_adjustment';
  end if;

  select booking.performer_id, booking.deposit_amount_rub
  into v_performer, v_deposit
  from public.bookings booking
  where booking.id = p_booking and booking.performer_id = auth.uid()
  for update;

  if v_performer is null or v_deposit <= 0 then
    raise exception using errcode = 'P0001', message = 'booking_unavailable';
  end if;

  select payment.* into v_payment
  from public.payments payment
  where payment.booking_id = p_booking
  order by payment.created_at desc
  limit 1
  for update;

  if not found then
    insert into public.payments (
      booking_id, performer_id, provider, provider_operation_id,
      amount_minor, currency, status
    ) values (
      p_booking, v_performer, 'manual', 'legacy-' || p_booking::text,
      v_deposit::bigint * 100, 'RUB', 'pending'
    ) returning * into v_payment;
  end if;

  update public.payments
  set status = p_status, last_event_at = now()
  where id = v_payment.id;

  insert into public.payment_events (
    payment_id, performer_id, provider, provider_event_id,
    provider_operation_id, event_type, requested_status, previous_status,
    processing_status, actor_kind, actor_user_id, manual_reason, processed_at
  ) values (
    v_payment.id, v_performer, v_payment.provider, gen_random_uuid()::text,
    v_payment.provider_operation_id, 'manual_adjustment', p_status, v_payment.status,
    'processed', 'admin', auth.uid(), v_reason, now()
  );

  return public.minuta_refresh_booking_payment_status(p_booking);
end;
$$;

-- Preserve the public signature used by old provider clients, but route it
-- through the audited correction path. The replacement is not a removal.
create or replace function public.set_booking_payment_status(p_booking uuid, p_status text)
returns text
language plpgsql
security definer
set search_path to ''
as $$
begin
  return public.adjust_booking_payment_status(
    p_booking,
    p_status,
    'Legacy provider interface correction'
  );
end;
$$;

revoke all on function public.minuta_payment_target_allowed(text, text) from public;
revoke all on function public.minuta_refresh_booking_payment_status(uuid) from public;
revoke all on function public.register_payment_operation(uuid, text, text, bigint, text, timestamptz) from public;
revoke all on function public.process_payment_webhook(text, text, text, text, text, bigint, text, timestamptz, text) from public;
revoke all on function public.register_payment_operation(uuid, text, text, bigint, text, timestamptz) from anon, authenticated;
revoke all on function public.process_payment_webhook(text, text, text, text, text, bigint, text, timestamptz, text) from anon, authenticated;
revoke all on function public.adjust_booking_payment_status(uuid, text, text) from public;
revoke all on function public.set_booking_payment_status(uuid, text) from public;

-- EXECUTE is the server boundary: new Supabase secret keys and the legacy
-- service-role JWT are both mapped to this database role by the API gateway.
grant execute on function public.register_payment_operation(uuid, text, text, bigint, text, timestamptz) to service_role;
grant execute on function public.process_payment_webhook(text, text, text, text, text, bigint, text, timestamptz, text) to service_role;
grant execute on function public.adjust_booking_payment_status(uuid, text, text) to authenticated;
grant execute on function public.set_booking_payment_status(uuid, text) to authenticated;

commit;
