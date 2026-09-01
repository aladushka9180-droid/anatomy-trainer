begin;

create or replace function public.normalize_client_phone(p_phone text)
returns text
language sql
immutable
set search_path to 'pg_catalog'
as $$
  with cleaned as (
    select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as digits
  )
  select case
    when char_length(digits) = 10 then '7' || digits
    when char_length(digits) = 11 and left(digits, 1) = '8' then '7' || substr(digits, 2)
    else digits
  end
  from cleaned;
$$;

revoke all on function public.normalize_client_phone(text) from public;
grant execute on function public.normalize_client_phone(text) to service_role;

create table if not exists public.client_accounts (
  id uuid primary key default gen_random_uuid(),
  normalized_phone text not null unique check (normalized_phone ~ '^7[0-9]{10}$'),
  access_code_hash text not null check (access_code_hash ~ '^[0-9a-f]{64}$'),
  access_code_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_device_sessions (
  id uuid primary key default gen_random_uuid(),
  client_account_id uuid not null references public.client_accounts(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  device_name text check (device_name is null or char_length(device_name) between 1 and 120),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check (expires_at > created_at)
);

create table if not exists public.client_login_limits (
  normalized_phone text primary key check (normalized_phone ~ '^7[0-9]{10}$'),
  window_started_at timestamptz not null default now(),
  attempt_count integer not null default 0 check (attempt_count between 0 and 1000),
  blocked_until timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists idx_client_device_sessions_account
  on public.client_device_sessions (client_account_id, expires_at desc);
create index if not exists idx_client_device_sessions_active
  on public.client_device_sessions (token_hash, expires_at)
  where revoked_at is null;

alter table public.bookings
  add column if not exists client_account_id uuid references public.client_accounts(id) on delete set null,
  add column if not exists client_access_eligible_until timestamptz;

alter table public.bookings
  alter column client_access_eligible_until set default (now() + interval '24 hours');

update public.bookings booking
set client_access_eligible_until = now() + interval '24 hours'
where booking.client_access_eligible_until is null
  and booking.manage_token is not null
  and booking.status <> 'cancelled'
  and booking.booking_date + booking.booking_time >= timezone('Europe/Samara', now());

create index if not exists idx_bookings_client_account
  on public.bookings (client_account_id, booking_date desc, booking_time desc)
  where client_account_id is not null;

alter table public.client_accounts enable row level security;
alter table public.client_device_sessions enable row level security;
alter table public.client_login_limits enable row level security;

revoke all on table public.client_accounts, public.client_device_sessions, public.client_login_limits from anon, authenticated;

create or replace function public.assign_booking_client_account()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_phone text;
begin
  if new.client_phone = '0000000000' then
    new.client_account_id := null;
  elsif tg_op = 'INSERT' or new.client_phone is distinct from old.client_phone then
    v_phone := public.normalize_client_phone(new.client_phone);
    new.client_account_id := null;
    if v_phone ~ '^7[0-9]{10}$' then
      select account.id into new.client_account_id
      from public.client_accounts account
      where account.normalized_phone = v_phone;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.assign_booking_client_account() from public;
grant execute on function public.assign_booking_client_account() to service_role;

drop trigger if exists bookings_assign_client_account on public.bookings;
create trigger bookings_assign_client_account
before insert or update of client_phone on public.bookings
for each row execute function public.assign_booking_client_account();

create or replace function public.resolve_client_session(p_session_token text)
returns table(client_account_id uuid, session_expires_at timestamptz)
language plpgsql
security definer
set search_path to 'pg_catalog', 'extensions'
as $$
declare
  v_token_hash text;
begin
  if coalesce(p_session_token, '') !~ '^[0-9a-fA-F]{64}$' then
    return;
  end if;
  v_token_hash := encode(digest(lower(p_session_token), 'sha256'), 'hex');
  return query
  update public.client_device_sessions session
  set last_seen_at = now()
  where session.token_hash = v_token_hash
    and session.revoked_at is null
    and session.expires_at > now()
  returning session.client_account_id, session.expires_at;
end;
$$;

revoke all on function public.resolve_client_session(text) from public;

create or replace function public.bootstrap_client_access(
  p_manage_token uuid,
  p_device_name text default null
)
returns table(
  access_code text,
  session_token text,
  session_expires_at timestamptz,
  is_new_account boolean
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'extensions'
as $$
declare
  v_booking public.bookings%rowtype;
  v_phone text;
  v_account_id uuid;
  v_code_raw text;
  v_code text;
  v_session_token text;
  v_session_expires_at timestamptz := now() + interval '90 days';
  v_is_new boolean := false;
begin
  if p_manage_token is null then
    raise exception using errcode = 'P0001', message = 'booking_unavailable';
  end if;
  if p_device_name is not null and char_length(btrim(p_device_name)) not between 1 and 120 then
    raise exception using errcode = 'P0001', message = 'invalid_device_name';
  end if;

  select booking.* into v_booking
  from public.bookings booking
  where booking.manage_token = p_manage_token
  for update;

  if not found
     or v_booking.client_phone = '0000000000'
     or v_booking.client_access_eligible_until is null
     or v_booking.client_access_eligible_until < now() then
    raise exception using errcode = 'P0001', message = 'booking_unavailable';
  end if;

  v_phone := public.normalize_client_phone(v_booking.client_phone);
  if v_phone !~ '^7[0-9]{10}$' then
    raise exception using errcode = 'P0001', message = 'invalid_client_phone';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('client-account:' || v_phone, 0));

  select account.id into v_account_id
  from public.client_accounts account
  where account.normalized_phone = v_phone
  for update;

  if v_account_id is null then
    v_account_id := gen_random_uuid();
    v_code_raw := upper(encode(gen_random_bytes(8), 'hex'));
    v_code := substr(v_code_raw, 1, 4) || '-' || substr(v_code_raw, 5, 4) || '-' ||
      substr(v_code_raw, 9, 4) || '-' || substr(v_code_raw, 13, 4);
    insert into public.client_accounts (id, normalized_phone, access_code_hash)
    values (
      v_account_id,
      v_phone,
      encode(digest(v_code_raw || ':' || v_account_id::text, 'sha256'), 'hex')
    );
    v_is_new := true;
  end if;

  update public.bookings booking
  set client_account_id = v_account_id
  where booking.client_account_id is null
    and booking.client_phone <> '0000000000'
    and public.normalize_client_phone(booking.client_phone) = v_phone;

  v_session_token := encode(gen_random_bytes(32), 'hex');
  insert into public.client_device_sessions (
    client_account_id, token_hash, device_name, expires_at
  ) values (
    v_account_id,
    encode(digest(v_session_token, 'sha256'), 'hex'),
    nullif(btrim(p_device_name), ''),
    v_session_expires_at
  );

  return query select v_code, v_session_token, v_session_expires_at, v_is_new;
end;
$$;

create or replace function public.login_client_access(
  p_phone text,
  p_code text,
  p_device_name text default null
)
returns table(
  session_token text,
  session_expires_at timestamptz,
  error_code text
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'extensions'
as $$
declare
  v_phone text := public.normalize_client_phone(p_phone);
  v_code_raw text := upper(regexp_replace(coalesce(p_code, ''), '[^0-9A-Fa-f]', '', 'g'));
  v_account public.client_accounts%rowtype;
  v_limit public.client_login_limits%rowtype;
  v_session_token text;
  v_session_expires_at timestamptz := now() + interval '90 days';
begin
  if v_phone !~ '^7[0-9]{10}$' or char_length(v_code_raw) <> 16 then
    return query select null::text, null::timestamptz, 'invalid_access'::text;
    return;
  end if;
  if p_device_name is not null and char_length(btrim(p_device_name)) not between 1 and 120 then
    return query select null::text, null::timestamptz, 'invalid_access'::text;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('client-login:' || v_phone, 0));

  select limits.* into v_limit
  from public.client_login_limits limits
  where limits.normalized_phone = v_phone
  for update;

  if found and v_limit.blocked_until is not null and v_limit.blocked_until > now() then
    return query select null::text, v_limit.blocked_until, 'login_rate_limited'::text;
    return;
  end if;

  if not found then
    insert into public.client_login_limits (normalized_phone, attempt_count)
    values (v_phone, 1);
  elsif v_limit.window_started_at <= now() - interval '15 minutes' then
    update public.client_login_limits
    set window_started_at = now(), attempt_count = 1, blocked_until = null, updated_at = now()
    where normalized_phone = v_phone;
  elsif v_limit.attempt_count >= 5 then
    update public.client_login_limits
    set blocked_until = now() + interval '15 minutes', updated_at = now()
    where normalized_phone = v_phone;
    return query select null::text, now() + interval '15 minutes', 'login_rate_limited'::text;
    return;
  else
    update public.client_login_limits
    set attempt_count = attempt_count + 1, updated_at = now()
    where normalized_phone = v_phone;
  end if;

  select account.* into v_account
  from public.client_accounts account
  where account.normalized_phone = v_phone;

  if not found or v_account.access_code_hash <> encode(
    digest(v_code_raw || ':' || v_account.id::text, 'sha256'), 'hex'
  ) then
    return query select null::text, null::timestamptz, 'invalid_access'::text;
    return;
  end if;

  delete from public.client_login_limits where normalized_phone = v_phone;
  v_session_token := encode(gen_random_bytes(32), 'hex');
  insert into public.client_device_sessions (
    client_account_id, token_hash, device_name, expires_at
  ) values (
    v_account.id,
    encode(digest(v_session_token, 'sha256'), 'hex'),
    nullif(btrim(p_device_name), ''),
    v_session_expires_at
  );

  return query select v_session_token, v_session_expires_at, null::text;
end;
$$;

create or replace function public.restore_client_session(p_session_token text)
returns table(normalized_phone text, session_expires_at timestamptz)
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
  select account.normalized_phone, v_expires_at
  from public.client_accounts account
  where account.id = v_account_id;
end;
$$;

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
    booking.booking_code,
    booking.manage_token,
    booking.client_name,
    service.name,
    booking.duration_minutes,
    coalesce(booking.total_price_rub, service.price_rub),
    profile.display_name,
    booking.booking_date,
    booking.booking_time,
    booking.status,
    booking.status <> 'cancelled'
      and timezone('Europe/Samara', now()) <= booking.booking_date + booking.booking_time - make_interval(hours => coalesce(policy.cancel_cutoff_hours, 12)),
    booking.status <> 'cancelled'
      and booking.reschedule_count < coalesce(policy.max_reschedules, 2)
      and timezone('Europe/Samara', now()) <= booking.booking_date + booking.booking_time - make_interval(hours => coalesce(policy.reschedule_cutoff_hours, 12)),
    greatest(0, coalesce(policy.max_reschedules, 2) - booking.reschedule_count),
    booking.deposit_amount_rub,
    booking.payment_status,
    booking.payment_url
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

create or replace function public.rotate_client_access_code(p_session_token text)
returns text
language plpgsql
security definer
set search_path to 'pg_catalog', 'extensions'
as $$
declare
  v_account_id uuid;
  v_expires_at timestamptz;
  v_code_raw text;
  v_code text;
begin
  select resolved.client_account_id, resolved.session_expires_at
  into v_account_id, v_expires_at
  from public.resolve_client_session(p_session_token) resolved;
  if v_account_id is null then
    raise exception using errcode = 'P0001', message = 'invalid_client_session';
  end if;

  v_code_raw := upper(encode(gen_random_bytes(8), 'hex'));
  v_code := substr(v_code_raw, 1, 4) || '-' || substr(v_code_raw, 5, 4) || '-' ||
    substr(v_code_raw, 9, 4) || '-' || substr(v_code_raw, 13, 4);
  update public.client_accounts
  set access_code_hash = encode(digest(v_code_raw || ':' || v_account_id::text, 'sha256'), 'hex'),
      access_code_changed_at = now(),
      updated_at = now()
  where id = v_account_id;
  return v_code;
end;
$$;

create or replace function public.revoke_client_session(p_session_token text)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'extensions'
as $$
declare
  v_token_hash text;
  v_revoked boolean := false;
begin
  if coalesce(p_session_token, '') !~ '^[0-9a-fA-F]{64}$' then
    return false;
  end if;
  v_token_hash := encode(digest(lower(p_session_token), 'sha256'), 'hex');
  update public.client_device_sessions
  set revoked_at = coalesce(revoked_at, now())
  where token_hash = v_token_hash and revoked_at is null;
  v_revoked := found;
  return v_revoked;
end;
$$;

revoke all on function public.bootstrap_client_access(uuid, text) from public;
revoke all on function public.login_client_access(text, text, text) from public;
revoke all on function public.restore_client_session(text) from public;
revoke all on function public.get_client_bookings(text) from public;
revoke all on function public.rotate_client_access_code(text) from public;
revoke all on function public.revoke_client_session(text) from public;

grant execute on function public.bootstrap_client_access(uuid, text) to anon, authenticated;
grant execute on function public.login_client_access(text, text, text) to anon, authenticated;
grant execute on function public.restore_client_session(text) to anon, authenticated;
grant execute on function public.get_client_bookings(text) to anon, authenticated;
grant execute on function public.rotate_client_access_code(text) to anon, authenticated;
grant execute on function public.revoke_client_session(text) to anon, authenticated;

commit;
