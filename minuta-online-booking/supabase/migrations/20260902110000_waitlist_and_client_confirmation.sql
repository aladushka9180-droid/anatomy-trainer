begin;

create table if not exists public.booking_waitlist_requests (
  id uuid primary key default gen_random_uuid(),
  request_code text not null unique,
  manage_token uuid not null default gen_random_uuid() unique,
  performer_id uuid not null references public.performer_profiles(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  client_name text not null check (char_length(client_name) between 2 and 80),
  client_phone text not null check (char_length(client_phone) between 10 and 15),
  desired_date date not null,
  time_period text not null default 'any' check (time_period in ('any', 'morning', 'day', 'evening')),
  status text not null default 'waiting' check (status in ('waiting', 'contacted', 'booked', 'cancelled', 'closed')),
  provider_note text not null default '' check (char_length(provider_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists booking_waitlist_active_client_unique
  on public.booking_waitlist_requests (performer_id, service_id, desired_date, client_phone)
  where status in ('waiting', 'contacted');

create index if not exists booking_waitlist_owner_status_date
  on public.booking_waitlist_requests (performer_id, status, desired_date, created_at);

alter table public.bookings
  add column if not exists client_confirmed_at timestamptz;

alter table public.booking_waitlist_requests enable row level security;

drop policy if exists booking_waitlist_owner_read on public.booking_waitlist_requests;
create policy booking_waitlist_owner_read on public.booking_waitlist_requests
  for select to authenticated
  using (performer_id = (select auth.uid()));

revoke all on public.booking_waitlist_requests from public, anon, authenticated;
grant select on public.booking_waitlist_requests to authenticated;

drop trigger if exists booking_waitlist_touch_updated_at on public.booking_waitlist_requests;
create trigger booking_waitlist_touch_updated_at
before update on public.booking_waitlist_requests
for each row execute function public.touch_minuta_updated_at();

create or replace function public.join_booking_waitlist(
  p_service uuid,
  p_date date,
  p_time_period text,
  p_client_name text,
  p_client_phone text
)
returns table(request_code text, manage_token uuid)
language plpgsql
security definer
set search_path to 'pg_catalog', 'extensions'
as $$
declare
  v_performer uuid;
  v_name text := btrim(coalesce(p_client_name, ''));
  v_phone text := regexp_replace(coalesce(p_client_phone, ''), '\D', '', 'g');
  v_period text := lower(coalesce(p_time_period, 'any'));
  v_existing public.booking_waitlist_requests%rowtype;
  v_code text;
  v_token uuid;
  v_today date := timezone('Europe/Samara', now())::date;
begin
  select service.performer_id into v_performer
  from public.services service
  where service.id = p_service and service.active;

  if v_performer is null then
    raise exception using errcode = 'P0001', message = 'service_unavailable';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 80 or char_length(v_phone) < 10 or char_length(v_phone) > 15 then
    raise exception using errcode = 'P0001', message = 'invalid_client_data';
  end if;
  if p_date is null or p_date < v_today or p_date > v_today + 180 then
    raise exception using errcode = 'P0001', message = 'invalid_waitlist_date';
  end if;
  if v_period not in ('any', 'morning', 'day', 'evening') then
    raise exception using errcode = 'P0001', message = 'invalid_time_period';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_performer::text || p_service::text || p_date::text || v_phone, 0));

  select request.* into v_existing
  from public.booking_waitlist_requests request
  where request.performer_id = v_performer
    and request.service_id = p_service
    and request.desired_date = p_date
    and request.client_phone = v_phone
    and request.status in ('waiting', 'contacted')
  order by request.created_at desc
  limit 1;

  if v_existing.id is not null then
    update public.booking_waitlist_requests
    set client_name = v_name, time_period = v_period, updated_at = now()
    where id = v_existing.id;
    return query select v_existing.request_code, v_existing.manage_token;
    return;
  end if;

  v_code := 'WAIT-' || upper(substr(encode(gen_random_bytes(5), 'hex'), 1, 8));
  v_token := gen_random_uuid();
  insert into public.booking_waitlist_requests (
    request_code, manage_token, performer_id, service_id, client_name, client_phone, desired_date, time_period
  ) values (
    v_code, v_token, v_performer, p_service, v_name, v_phone, p_date, v_period
  );
  return query select v_code, v_token;
end;
$$;

create or replace function public.get_waitlist_request(p_token uuid)
returns table(
  request_code text,
  service_name text,
  performer_name text,
  desired_date date,
  time_period text,
  status text
)
language sql
stable
security definer
set search_path to ''
as $$
  select
    request.request_code,
    service.name,
    profile.display_name,
    request.desired_date,
    request.time_period,
    request.status
  from public.booking_waitlist_requests request
  join public.services service on service.id = request.service_id
  join public.performer_profiles profile on profile.id = request.performer_id
  where request.manage_token = p_token;
$$;

create or replace function public.cancel_waitlist_request(p_token uuid)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_status text;
begin
  update public.booking_waitlist_requests
  set status = 'cancelled', updated_at = now()
  where manage_token = p_token and status in ('waiting', 'contacted')
  returning status into v_status;
  if v_status is null then
    select request.status into v_status
    from public.booking_waitlist_requests request
    where request.manage_token = p_token;
  end if;
  if v_status is null then
    raise exception using errcode = 'P0001', message = 'waitlist_request_unavailable';
  end if;
  return v_status;
end;
$$;

create or replace function public.set_waitlist_request_status(p_request uuid, p_status text)
returns text
language plpgsql
security definer
set search_path to ''
as $$
begin
  if p_status not in ('waiting', 'contacted', 'booked', 'cancelled', 'closed') then
    raise exception using errcode = 'P0001', message = 'invalid_waitlist_status';
  end if;
  update public.booking_waitlist_requests
  set status = p_status, updated_at = now()
  where id = p_request and performer_id = auth.uid();
  if not found then
    raise exception using errcode = 'P0001', message = 'waitlist_request_unavailable';
  end if;
  return p_status;
end;
$$;

create or replace function public.confirm_booking_by_token(p_token uuid)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_id uuid;
  v_status text;
  v_start timestamp without time zone;
begin
  select booking.id, booking.status, booking.booking_date + booking.booking_time
  into v_id, v_status, v_start
  from public.bookings booking
  where booking.manage_token = p_token
  for update;

  if v_id is null then
    raise exception using errcode = 'P0001', message = 'booking_unavailable';
  end if;
  if v_status = 'cancelled' then
    raise exception using errcode = 'P0001', message = 'booking_cancelled';
  end if;
  if v_status = 'confirmed' then
    return 'confirmed';
  end if;
  if timezone('Europe/Samara', now()) > v_start then
    raise exception using errcode = 'P0001', message = 'booking_started';
  end if;

  update public.bookings
  set status = 'confirmed', client_confirmed_at = now()
  where id = v_id;
  return 'confirmed';
end;
$$;

revoke all on function public.join_booking_waitlist(uuid, date, text, text, text) from public;
grant execute on function public.join_booking_waitlist(uuid, date, text, text, text) to anon, authenticated;
revoke all on function public.get_waitlist_request(uuid) from public;
grant execute on function public.get_waitlist_request(uuid) to anon, authenticated;
revoke all on function public.cancel_waitlist_request(uuid) from public;
grant execute on function public.cancel_waitlist_request(uuid) to anon, authenticated;
revoke all on function public.set_waitlist_request_status(uuid, text) from public;
grant execute on function public.set_waitlist_request_status(uuid, text) to authenticated;
revoke all on function public.confirm_booking_by_token(uuid) from public;
grant execute on function public.confirm_booking_by_token(uuid) to anon, authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'booking_waitlist_requests'
     ) then
    alter publication supabase_realtime add table public.booking_waitlist_requests;
  end if;
end $$;

commit;
