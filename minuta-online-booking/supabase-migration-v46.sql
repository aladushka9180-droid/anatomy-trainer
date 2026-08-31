begin;

-- Durable, server-owned delivery queue. The existing notification_marks table remains
-- unchanged: it still tracks the provider's manual WhatsApp workflow.
create table if not exists public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  performer_id uuid not null references public.performer_profiles(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  event_key text not null unique check (char_length(event_key) between 1 and 240),
  kind text not null check (kind in ('booking_created')),
  channel text not null check (channel in ('telegram')),
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  lock_token uuid,
  last_error_code text check (last_error_code is null or char_length(last_error_code) <= 120),
  last_error text check (last_error is null or char_length(last_error) <= 2000),
  provider_message_id text check (provider_message_id is null or char_length(provider_message_id) <= 240),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, performer_id)
);

create table if not exists public.notification_delivery_attempts (
  id bigint generated always as identity primary key,
  outbox_id uuid not null,
  performer_id uuid not null,
  attempt_no integer not null check (attempt_no > 0),
  outcome text not null default 'sending' check (outcome in ('sending', 'sent', 'failed')),
  error_code text check (error_code is null or char_length(error_code) <= 120),
  error_message text check (error_message is null or char_length(error_message) <= 2000),
  provider_message_id text check (provider_message_id is null or char_length(provider_message_id) <= 240),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (outbox_id, attempt_no),
  foreign key (outbox_id, performer_id)
    references public.notification_outbox(id, performer_id) on delete cascade
);

create index if not exists idx_notification_outbox_due
  on public.notification_outbox (next_attempt_at, created_at)
  where status = 'pending';
create index if not exists idx_notification_outbox_owner
  on public.notification_outbox (performer_id, created_at desc);
create index if not exists idx_notification_delivery_attempts_owner
  on public.notification_delivery_attempts (performer_id, started_at desc);

alter table public.notification_outbox enable row level security;
alter table public.notification_delivery_attempts enable row level security;

drop policy if exists notification_outbox_owner_read on public.notification_outbox;
create policy notification_outbox_owner_read on public.notification_outbox
  for select to authenticated
  using (performer_id = (select auth.uid()));

drop policy if exists notification_delivery_attempts_owner_read on public.notification_delivery_attempts;
create policy notification_delivery_attempts_owner_read on public.notification_delivery_attempts
  for select to authenticated
  using (performer_id = (select auth.uid()));

revoke all on public.notification_outbox, public.notification_delivery_attempts from anon, authenticated;
grant select on public.notification_outbox, public.notification_delivery_attempts to authenticated;
grant all on public.notification_outbox, public.notification_delivery_attempts to service_role;

drop trigger if exists notification_outbox_touch_updated_at on public.notification_outbox;
create trigger notification_outbox_touch_updated_at before update on public.notification_outbox
for each row execute function public.touch_minuta_updated_at();

create or replace function public.enqueue_booking_created_notification()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  insert into public.notification_outbox (
    performer_id, booking_id, event_key, kind, channel
  ) values (
    new.performer_id,
    new.id,
    'booking:' || new.id::text || ':created:telegram',
    'booking_created',
    'telegram'
  )
  on conflict (event_key) do nothing;
  return new;
end;
$$;

drop trigger if exists bookings_enqueue_created_notification on public.bookings;
create trigger bookings_enqueue_created_notification
after insert on public.bookings
for each row execute function public.enqueue_booking_created_notification();

-- Workers claim rows atomically. A crashed worker's lease becomes claimable again
-- after 15 minutes. FOR UPDATE SKIP LOCKED lets several workers run safely.
create or replace function public.claim_notification_outbox(
  p_performer uuid,
  p_limit integer default 10
)
returns table(
  outbox_id uuid,
  lock_token uuid,
  event_key text,
  performer_id uuid,
  booking_id uuid,
  kind text,
  channel text,
  attempt_no integer,
  booking_code text,
  client_name text,
  client_phone text,
  booking_date date,
  booking_time time without time zone,
  service_name text,
  performer_name text
)
language sql
security definer
set search_path to 'pg_catalog', 'extensions'
as $$
  with picked as (
    select queue.id
    from public.notification_outbox queue
    where queue.performer_id = p_performer
      and (
        (
          queue.status = 'pending'
          and queue.next_attempt_at <= now()
        ) or (
          queue.status = 'sending'
          and queue.locked_at < now() - interval '15 minutes'
        )
      )
    order by queue.next_attempt_at, queue.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 10), 50))
  ), claimed as (
    update public.notification_outbox queue
    set status = 'sending',
        attempts = queue.attempts + 1,
        locked_at = now(),
        lock_token = gen_random_uuid(),
        last_error_code = null,
        last_error = null
    from picked
    where queue.id = picked.id
    returning queue.*
  ), logged as (
    insert into public.notification_delivery_attempts (
      outbox_id, performer_id, attempt_no, outcome
    )
    select claimed.id, claimed.performer_id, claimed.attempts, 'sending'
    from claimed
    on conflict (outbox_id, attempt_no) do nothing
    returning outbox_id, attempt_no
  )
  select
    claimed.id,
    claimed.lock_token,
    claimed.event_key,
    claimed.performer_id,
    claimed.booking_id,
    claimed.kind,
    claimed.channel,
    claimed.attempts,
    booking.booking_code,
    booking.client_name,
    booking.client_phone,
    booking.booking_date,
    booking.booking_time,
    service.name,
    profile.display_name
  from claimed
  join logged on logged.outbox_id = claimed.id and logged.attempt_no = claimed.attempts
  join public.bookings booking on booking.id = claimed.booking_id
  join public.services service on service.id = booking.service_id
  join public.performer_profiles profile on profile.id = claimed.performer_id
  order by claimed.created_at;
$$;

create or replace function public.ack_notification_outbox(
  p_outbox uuid,
  p_lock_token uuid,
  p_provider_message_id text default null
)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_performer uuid;
  v_attempt integer;
  v_provider_message_id text := nullif(left(coalesce(p_provider_message_id, ''), 240), '');
begin
  update public.notification_outbox queue
  set status = 'sent',
      provider_message_id = v_provider_message_id,
      sent_at = now(),
      locked_at = null,
      lock_token = null,
      last_error_code = null,
      last_error = null
  where queue.id = p_outbox
    and queue.status = 'sending'
    and queue.lock_token = p_lock_token
  returning queue.performer_id, queue.attempts into v_performer, v_attempt;

  if not found then
    raise exception using errcode = 'P0001', message = 'notification_lease_lost';
  end if;

  update public.notification_delivery_attempts attempt
  set outcome = 'sent',
      provider_message_id = v_provider_message_id,
      finished_at = now()
  where attempt.outbox_id = p_outbox
    and attempt.performer_id = v_performer
    and attempt.attempt_no = v_attempt;

  return 'sent';
end;
$$;

create or replace function public.fail_notification_outbox(
  p_outbox uuid,
  p_lock_token uuid,
  p_error_code text,
  p_error text,
  p_retryable boolean default true,
  p_retry_after_seconds integer default null
)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_performer uuid;
  v_attempt integer;
  v_retry boolean;
  v_delay_seconds integer;
  v_status text;
  v_error_code text := left(coalesce(nullif(trim(p_error_code), ''), 'unknown_error'), 120);
  v_error text := left(coalesce(nullif(trim(p_error), ''), 'Неизвестная ошибка доставки'), 2000);
begin
  select queue.performer_id, queue.attempts
  into v_performer, v_attempt
  from public.notification_outbox queue
  where queue.id = p_outbox
    and queue.status = 'sending'
    and queue.lock_token = p_lock_token
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'notification_lease_lost';
  end if;

  v_retry := coalesce(p_retryable, true) and v_attempt < 8;
  v_delay_seconds := least(
    86400,
    greatest(
      (power(2, least(greatest(v_attempt - 1, 0), 10)) * 60)::integer,
      least(greatest(coalesce(p_retry_after_seconds, 0), 0), 86400)
    )
  );
  v_status := case when v_retry then 'pending' else 'failed' end;

  update public.notification_outbox queue
  set status = v_status,
      next_attempt_at = case when v_retry then now() + make_interval(secs => v_delay_seconds) else queue.next_attempt_at end,
      locked_at = null,
      lock_token = null,
      last_error_code = v_error_code,
      last_error = v_error
  where queue.id = p_outbox;

  update public.notification_delivery_attempts attempt
  set outcome = 'failed',
      error_code = v_error_code,
      error_message = v_error,
      finished_at = now()
  where attempt.outbox_id = p_outbox
    and attempt.performer_id = v_performer
    and attempt.attempt_no = v_attempt;

  return v_status;
end;
$$;

-- The provider can only restart a terminal failed delivery belonging to their own
-- account. Sent notifications cannot be replayed from the browser.
create or replace function public.retry_notification_outbox(p_outbox uuid)
returns text
language plpgsql
security definer
set search_path to ''
as $$
begin
  update public.notification_outbox queue
  set status = 'pending',
      next_attempt_at = now(),
      locked_at = null,
      lock_token = null,
      last_error_code = null,
      last_error = null
  where queue.id = p_outbox
    and queue.performer_id = auth.uid()
    and queue.status = 'failed';

  if not found then
    raise exception using errcode = 'P0001', message = 'notification_not_retryable';
  end if;
  return 'pending';
end;
$$;

revoke all on function public.enqueue_booking_created_notification() from public;
revoke all on function public.claim_notification_outbox(uuid, integer) from public;
revoke all on function public.ack_notification_outbox(uuid, uuid, text) from public;
revoke all on function public.fail_notification_outbox(uuid, uuid, text, text, boolean, integer) from public;
revoke all on function public.retry_notification_outbox(uuid) from public;

grant execute on function public.claim_notification_outbox(uuid, integer) to service_role;
grant execute on function public.ack_notification_outbox(uuid, uuid, text) to service_role;
grant execute on function public.fail_notification_outbox(uuid, uuid, text, text, boolean, integer) to service_role;
grant execute on function public.retry_notification_outbox(uuid) to authenticated;

commit;
