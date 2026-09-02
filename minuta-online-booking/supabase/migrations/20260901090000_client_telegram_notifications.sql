create table if not exists public.client_telegram_subscriptions (
  id uuid primary key default gen_random_uuid(),
  performer_id uuid not null references public.performer_profiles(id) on delete cascade,
  client_phone text not null check (char_length(client_phone) between 10 and 15),
  chat_id bigint not null,
  telegram_user_id bigint,
  telegram_username text,
  active boolean not null default true,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (performer_id, client_phone)
);

create table if not exists public.telegram_notification_log (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  event_type text not null check (event_type in ('confirmation','rescheduled','cancelled','reminder')),
  booking_date date not null,
  booking_time time not null,
  sent_at timestamptz not null default now(),
  unique (booking_id, event_type, booking_date, booking_time)
);

create index if not exists idx_client_telegram_subscription_lookup
  on public.client_telegram_subscriptions (performer_id, client_phone)
  where active;

create index if not exists idx_telegram_notification_log_booking
  on public.telegram_notification_log (booking_id, sent_at desc);

alter table public.client_telegram_subscriptions enable row level security;
alter table public.telegram_notification_log enable row level security;

revoke all on table public.client_telegram_subscriptions, public.telegram_notification_log
  from public, anon, authenticated;

comment on table public.client_telegram_subscriptions is
  'Telegram opt-in saved after a client opens the booking bot and presses Start.';
comment on table public.telegram_notification_log is
  'Idempotency log for automatic client Telegram notifications.';

-- Защищённое расписание и секрет создаются повторяемой миграцией
-- supabase-migration-v77.sql. Публичный cron-вызов здесь намеренно не создаётся.
