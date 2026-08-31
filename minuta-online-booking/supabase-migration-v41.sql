begin;

create table if not exists public.booking_policies (
  performer_id uuid primary key references public.performer_profiles(id) on delete cascade,
  cancel_cutoff_hours integer not null default 12 check (cancel_cutoff_hours between 0 and 168),
  reschedule_cutoff_hours integer not null default 12 check (reschedule_cutoff_hours between 0 and 168),
  max_reschedules integer not null default 2 check (max_reschedules between 0 and 20),
  deposit_enabled boolean not null default false,
  deposit_amount_rub integer not null default 0 check (deposit_amount_rub between 0 and 1000000),
  payment_url_template text not null default '' check (char_length(payment_url_template) <= 1000),
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_templates (
  performer_id uuid primary key references public.performer_profiles(id) on delete cascade,
  confirmation text not null,
  reminder text not null,
  cancellation text not null,
  updated_at timestamptz not null default now(),
  check (char_length(confirmation) between 1 and 1000),
  check (char_length(reminder) between 1 and 1000),
  check (char_length(cancellation) between 1 and 1000)
);

create table if not exists public.notification_marks (
  performer_id uuid not null references public.performer_profiles(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  task_key text not null check (char_length(task_key) between 1 and 200),
  kind text not null check (kind in ('confirmation', 'reminder', 'cancellation')),
  status text not null check (status in ('opened', 'sent')),
  updated_at timestamptz not null default now(),
  primary key (performer_id, task_key)
);

alter table public.bookings add column if not exists reschedule_count integer not null default 0;
alter table public.bookings add column if not exists deposit_amount_rub integer not null default 0;
alter table public.bookings add column if not exists payment_status text not null default 'not_required';
alter table public.bookings add column if not exists payment_url text not null default '';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bookings_reschedule_count_check') then
    alter table public.bookings add constraint bookings_reschedule_count_check check (reschedule_count between 0 and 20);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'bookings_deposit_amount_rub_check') then
    alter table public.bookings add constraint bookings_deposit_amount_rub_check check (deposit_amount_rub between 0 and 1000000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'bookings_payment_status_check') then
    alter table public.bookings add constraint bookings_payment_status_check check (payment_status in ('not_required', 'pending', 'paid', 'refunded'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'bookings_payment_url_check') then
    alter table public.bookings add constraint bookings_payment_url_check check (char_length(payment_url) <= 1000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'booking_policies_payment_url_https_check') then
    alter table public.booking_policies add constraint booking_policies_payment_url_https_check
      check (payment_url_template = '' or payment_url_template ~* '^https://');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'bookings_payment_url_https_check') then
    alter table public.bookings add constraint bookings_payment_url_https_check
      check (payment_url = '' or payment_url ~* '^https://');
  end if;
end $$;

insert into public.booking_policies (performer_id)
select id from public.performer_profiles
on conflict (performer_id) do nothing;

insert into public.notification_templates (performer_id, confirmation, reminder, cancellation)
select id,
  E'Здравствуйте, {имя}! Ваша запись подтверждена.\n\n{услуга}\n{дата} в {время}\n{адрес}\n\nДо встречи!',
  E'Здравствуйте, {имя}! Напоминаю о вашей записи.\n\n{услуга}\n{дата} в {время}\n{адрес}\n\nЕсли планы изменились, пожалуйста, сообщите заранее.',
  'Здравствуйте, {имя}! Ваша запись на {услуга}, {дата} в {время}, отменена. Если захотите подобрать другое время, напишите мне.'
from public.performer_profiles
on conflict (performer_id) do nothing;

alter table public.booking_policies enable row level security;
alter table public.notification_templates enable row level security;
alter table public.notification_marks enable row level security;

drop policy if exists booking_policies_owner_all on public.booking_policies;
create policy booking_policies_owner_all on public.booking_policies
  for all to authenticated
  using (performer_id = (select auth.uid()))
  with check (performer_id = (select auth.uid()));

drop policy if exists notification_templates_owner_all on public.notification_templates;
create policy notification_templates_owner_all on public.notification_templates
  for all to authenticated
  using (performer_id = (select auth.uid()))
  with check (performer_id = (select auth.uid()));

drop policy if exists notification_marks_owner_all on public.notification_marks;
create policy notification_marks_owner_all on public.notification_marks
  for all to authenticated
  using (performer_id = (select auth.uid()))
  with check (performer_id = (select auth.uid()));

revoke all on public.booking_policies, public.notification_templates, public.notification_marks from anon;
grant select, insert, update on public.booking_policies, public.notification_templates to authenticated;
grant select, insert, update, delete on public.notification_marks to authenticated;

create or replace function public.touch_minuta_updated_at()
returns trigger
language plpgsql
security invoker
set search_path to ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists booking_policies_touch_updated_at on public.booking_policies;
create trigger booking_policies_touch_updated_at before update on public.booking_policies
for each row execute function public.touch_minuta_updated_at();

drop trigger if exists notification_templates_touch_updated_at on public.notification_templates;
create trigger notification_templates_touch_updated_at before update on public.notification_templates
for each row execute function public.touch_minuta_updated_at();

drop trigger if exists notification_marks_touch_updated_at on public.notification_marks;
create trigger notification_marks_touch_updated_at before update on public.notification_marks
for each row execute function public.touch_minuta_updated_at();

create or replace function public.ensure_minuta_provider_defaults()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  insert into public.booking_policies (performer_id) values (new.id)
  on conflict (performer_id) do nothing;
  insert into public.notification_templates (performer_id, confirmation, reminder, cancellation)
  values (
    new.id,
    E'Здравствуйте, {имя}! Ваша запись подтверждена.\n\n{услуга}\n{дата} в {время}\n{адрес}\n\nДо встречи!',
    E'Здравствуйте, {имя}! Напоминаю о вашей записи.\n\n{услуга}\n{дата} в {время}\n{адрес}\n\nЕсли планы изменились, пожалуйста, сообщите заранее.',
    'Здравствуйте, {имя}! Ваша запись на {услуга}, {дата} в {время}, отменена. Если захотите подобрать другое время, напишите мне.'
  ) on conflict (performer_id) do nothing;
  return new;
end;
$$;

drop trigger if exists performer_profiles_minuta_defaults on public.performer_profiles;
create trigger performer_profiles_minuta_defaults after insert on public.performer_profiles
for each row execute function public.ensure_minuta_provider_defaults();

create or replace function public.book_appointment(
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
$$;

create or replace function public.get_booking_management(p_token uuid)
returns table(
  booking_code text,
  service_id uuid,
  performer_id uuid,
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
  cancel_deadline timestamp without time zone,
  reschedule_deadline timestamp without time zone,
  reschedules_remaining integer,
  deposit_amount_rub integer,
  payment_status text,
  payment_url text
)
language sql
stable
security definer
set search_path to ''
as $$
  select
    booking.booking_code,
    booking.service_id,
    booking.performer_id,
    booking.client_name,
    service.name,
    booking.duration_minutes,
    service.price_rub,
    profile.display_name,
    booking.booking_date,
    booking.booking_time,
    booking.status,
    booking.status <> 'cancelled'
      and timezone('Europe/Samara', now()) <= booking.booking_date + booking.booking_time - make_interval(hours => coalesce(policy.cancel_cutoff_hours, 12)),
    booking.status <> 'cancelled'
      and booking.reschedule_count < coalesce(policy.max_reschedules, 2)
      and timezone('Europe/Samara', now()) <= booking.booking_date + booking.booking_time - make_interval(hours => coalesce(policy.reschedule_cutoff_hours, 12)),
    booking.booking_date + booking.booking_time - make_interval(hours => coalesce(policy.cancel_cutoff_hours, 12)),
    booking.booking_date + booking.booking_time - make_interval(hours => coalesce(policy.reschedule_cutoff_hours, 12)),
    greatest(0, coalesce(policy.max_reschedules, 2) - booking.reschedule_count),
    booking.deposit_amount_rub,
    booking.payment_status,
    booking.payment_url
  from public.bookings booking
  join public.services service on service.id = booking.service_id
  join public.performer_profiles profile on profile.id = booking.performer_id
  left join public.booking_policies policy on policy.performer_id = booking.performer_id
  where booking.manage_token = p_token;
$$;

create or replace function public.get_reschedule_slots(
  p_token uuid,
  p_start date,
  p_end date
)
returns table(booking_date date, booking_time time without time zone)
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_booking uuid;
  v_service uuid;
  v_start timestamp without time zone;
  v_reschedule_count integer;
  v_cutoff integer := 12;
  v_limit integer := 2;
begin
  select booking.id, booking.service_id, booking.booking_date + booking.booking_time,
         booking.reschedule_count, coalesce(policy.reschedule_cutoff_hours, 12), coalesce(policy.max_reschedules, 2)
  into v_booking, v_service, v_start, v_reschedule_count, v_cutoff, v_limit
  from public.bookings booking
  left join public.booking_policies policy on policy.performer_id = booking.performer_id
  where booking.manage_token = p_token and booking.status <> 'cancelled';
  if v_booking is null then return; end if;
  if timezone('Europe/Samara', now()) > v_start - make_interval(hours => v_cutoff) then
    raise exception using errcode = 'P0001', message = 'reschedule_too_late';
  end if;
  if v_reschedule_count >= v_limit then
    raise exception using errcode = 'P0001', message = 'reschedule_limit_reached';
  end if;
  return query
  select available.booking_date, available.booking_time
  from public.get_available_slots(v_service, p_start, p_end, v_booking) available;
end;
$$;

create or replace function public.reschedule_booking(
  p_token uuid,
  p_date date,
  p_time time without time zone
)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_id uuid;
  v_service uuid;
  v_performer uuid;
  v_code text;
  v_start timestamp without time zone;
  v_reschedule_count integer;
  v_cutoff integer := 12;
  v_limit integer := 2;
begin
  select booking.id, booking.service_id, booking.performer_id, booking.booking_code,
         booking.booking_date + booking.booking_time, booking.reschedule_count,
         coalesce(policy.reschedule_cutoff_hours, 12), coalesce(policy.max_reschedules, 2)
  into v_id, v_service, v_performer, v_code, v_start, v_reschedule_count, v_cutoff, v_limit
  from public.bookings booking
  left join public.booking_policies policy on policy.performer_id = booking.performer_id
  where booking.manage_token = p_token and booking.status <> 'cancelled'
  for update of booking;
  if v_id is null then
    raise exception using errcode = 'P0001', message = 'booking_unavailable';
  end if;
  if timezone('Europe/Samara', now()) > v_start - make_interval(hours => v_cutoff) then
    raise exception using errcode = 'P0001', message = 'reschedule_too_late';
  end if;
  if v_reschedule_count >= v_limit then
    raise exception using errcode = 'P0001', message = 'reschedule_limit_reached';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_performer::text || p_date::text, 0));
  if not exists (
    select 1 from public.get_available_slots(v_service, p_date, p_date, v_id) available
    where available.booking_date = p_date and available.booking_time = p_time
  ) then
    raise exception using errcode = 'P0001', message = 'slot_unavailable';
  end if;
  update public.bookings
  set booking_date = p_date,
      booking_time = p_time,
      status = 'new',
      reschedule_count = reschedule_count + 1
  where id = v_id;
  return v_code;
end;
$$;

create or replace function public.cancel_booking(p_token uuid)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_id uuid;
  v_start timestamp without time zone;
  v_cutoff integer := 12;
begin
  select booking.id, booking.booking_date + booking.booking_time, coalesce(policy.cancel_cutoff_hours, 12)
  into v_id, v_start, v_cutoff
  from public.bookings booking
  left join public.booking_policies policy on policy.performer_id = booking.performer_id
  where booking.manage_token = p_token and booking.status <> 'cancelled'
  for update of booking;
  if v_id is null then
    raise exception using errcode = 'P0001', message = 'booking_unavailable';
  end if;
  if timezone('Europe/Samara', now()) > v_start - make_interval(hours => v_cutoff) then
    raise exception using errcode = 'P0001', message = 'cancel_too_late';
  end if;
  update public.bookings set status = 'cancelled' where id = v_id;
  return 'cancelled';
end;
$$;

create or replace function public.set_booking_payment_status(p_booking uuid, p_status text)
returns text
language plpgsql
security definer
set search_path to ''
as $$
begin
  if p_status not in ('pending', 'paid', 'refunded') then
    raise exception using errcode = 'P0001', message = 'invalid_payment_status';
  end if;
  update public.bookings
  set payment_status = p_status
  where id = p_booking and performer_id = auth.uid() and deposit_amount_rub > 0;
  if not found then
    raise exception using errcode = 'P0001', message = 'booking_unavailable';
  end if;
  return p_status;
end;
$$;

revoke all on function public.get_booking_management(uuid) from public;
grant execute on function public.get_booking_management(uuid) to anon, authenticated;
revoke all on function public.set_booking_payment_status(uuid, text) from public;
grant execute on function public.set_booking_payment_status(uuid, text) to authenticated;

commit;
