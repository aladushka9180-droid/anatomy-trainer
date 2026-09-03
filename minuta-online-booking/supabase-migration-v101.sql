\set ON_ERROR_STOP on

begin;
set local lock_timeout = '5s';
set local statement_timeout = '10min';
set local search_path = public, extensions, pg_catalog;

do $$
begin
  if to_regprocedure('public.get_available_slots(uuid,date,date,uuid)') is null
     or to_regprocedure('public.get_public_minuta_available_slots_group_safe(text,uuid,uuid,date,date)') is null
     or to_regprocedure('public.get_minuta_group_safe_reschedule_slots(uuid,date,date)') is null then
    raise exception using errcode = 'P0001', message = 'v101_requires_booking_foundation';
  end if;
end;
$$;

alter table public.booking_policies
  add column if not exists booking_buffer_enabled boolean not null default false,
  add column if not exists booking_buffer_minutes integer not null default 60;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.booking_policies'::regclass
      and conname = 'booking_policies_buffer_minutes_check'
  ) then
    alter table public.booking_policies
      add constraint booking_policies_buffer_minutes_check
      check (booking_buffer_minutes between 1 and 1440);
  end if;
end;
$$;

create or replace function public.minuta_slot_respects_booking_buffer(
  p_service uuid,
  p_date date,
  p_time time without time zone,
  p_duration integer default null,
  p_ignore_booking uuid default null
)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select case
    when service.id is null then false
    when not coalesce(policy.booking_buffer_enabled, false) then true
    else not exists (
      select 1
      from public.bookings booking
      where booking.performer_id = service.performer_id
        and booking.booking_date = p_date
        and booking.status <> 'cancelled'
        and regexp_replace(coalesce(booking.client_phone, ''), '\D', '', 'g') <> '0000000000'
        and (p_ignore_booking is null or booking.id <> p_ignore_booking)
        and tsrange(
          p_date + p_time,
          p_date + p_time + make_interval(mins => coalesce(p_duration, service.duration_minutes)),
          '[)'
        ) && tsrange(
          booking.booking_date + booking.booking_time - make_interval(mins => policy.booking_buffer_minutes),
          booking.booking_date + booking.booking_time + make_interval(mins => booking.duration_minutes + policy.booking_buffer_minutes),
          '[)'
        )
    )
  end
  from public.services service
  left join public.booking_policies policy on policy.performer_id = service.performer_id
  where service.id = p_service;
$$;

revoke all on function public.minuta_slot_respects_booking_buffer(uuid,date,time without time zone,integer,uuid)
  from public, anon, authenticated, service_role;

create or replace function public.get_available_slots_v101(
  p_service uuid,
  p_start date,
  p_end date,
  p_ignore_booking uuid default null
)
returns table(booking_date date, booking_time time without time zone)
language sql
stable
security definer
set search_path to ''
as $$
  select slot.booking_date, slot.booking_time
  from public.get_available_slots(p_service, p_start, p_end, p_ignore_booking) slot
  where public.minuta_slot_respects_booking_buffer(
    p_service, slot.booking_date, slot.booking_time, null, p_ignore_booking
  )
  order by slot.booking_date, slot.booking_time;
$$;

revoke all on function public.get_available_slots_v101(uuid,date,date,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_available_slots_v101(uuid,date,date,uuid)
  to anon, authenticated;

create or replace function public.get_public_minuta_available_slots_v101(
  p_slug text,
  p_location uuid,
  p_service uuid,
  p_start date,
  p_end date
)
returns table(booking_date date, booking_time time without time zone)
language sql
stable
security definer
set search_path to ''
as $$
  select slot.booking_date, slot.booking_time
  from public.get_public_minuta_available_slots_group_safe(
    p_slug, p_location, p_service, p_start, p_end
  ) slot
  where public.minuta_slot_respects_booking_buffer(
    p_service, slot.booking_date, slot.booking_time, null, null
  )
  order by slot.booking_date, slot.booking_time;
$$;

revoke all on function public.get_public_minuta_available_slots_v101(text,uuid,uuid,date,date)
  from public, anon, authenticated, service_role;
grant execute on function public.get_public_minuta_available_slots_v101(text,uuid,uuid,date,date)
  to anon, authenticated;

create or replace function public.get_reschedule_slots_v101(
  p_token uuid,
  p_start date,
  p_end date
)
returns table(booking_date date, booking_time time without time zone)
language sql
stable
security definer
set search_path to ''
as $$
  select slot.booking_date, slot.booking_time
  from public.bookings booking
  cross join lateral public.get_minuta_group_safe_reschedule_slots(p_token, p_start, p_end) slot
  where booking.manage_token = p_token
    and booking.status <> 'cancelled'
    and public.minuta_slot_respects_booking_buffer(
      booking.service_id, slot.booking_date, slot.booking_time, booking.duration_minutes, booking.id
    )
  order by slot.booking_date, slot.booking_time;
$$;

revoke all on function public.get_reschedule_slots_v101(uuid,date,date)
  from public, anon, authenticated, service_role;
grant execute on function public.get_reschedule_slots_v101(uuid,date,date)
  to anon, authenticated;

create or replace function public.enforce_minuta_booking_buffer_v101()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_enabled boolean;
  v_minutes integer;
begin
  if new.status = 'cancelled'
     or regexp_replace(coalesce(new.client_phone, ''), '\D', '', 'g') = '0000000000' then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.performer_id is not distinct from old.performer_id
     and new.booking_date is not distinct from old.booking_date
     and new.booking_time is not distinct from old.booking_time
     and new.duration_minutes is not distinct from old.duration_minutes
     and not (old.status = 'cancelled' and new.status <> 'cancelled')
     and (
       regexp_replace(coalesce(old.client_phone, ''), '\D', '', 'g') = '0000000000'
     ) = (
       regexp_replace(coalesce(new.client_phone, ''), '\D', '', 'g') = '0000000000'
     ) then
    return new;
  end if;

  select policy.booking_buffer_enabled, policy.booking_buffer_minutes
  into v_enabled, v_minutes
  from public.booking_policies policy
  where policy.performer_id = new.performer_id;

  if not coalesce(v_enabled, false) then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.performer_id::text || new.booking_date::text, 0)
  );

  if exists (
    select 1
    from public.bookings booking
    where booking.performer_id = new.performer_id
      and booking.booking_date = new.booking_date
      and booking.status <> 'cancelled'
      and regexp_replace(coalesce(booking.client_phone, ''), '\D', '', 'g') <> '0000000000'
      and (tg_op = 'INSERT' or booking.id <> new.id)
      and tsrange(
        new.booking_date + new.booking_time,
        new.booking_date + new.booking_time + make_interval(mins => new.duration_minutes),
        '[)'
      ) && tsrange(
        booking.booking_date + booking.booking_time - make_interval(mins => v_minutes),
        booking.booking_date + booking.booking_time + make_interval(mins => booking.duration_minutes + v_minutes),
        '[)'
      )
  ) then
    raise exception using errcode = 'P0001', message = 'booking_buffer_conflict';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_minuta_booking_buffer_v101()
  from public, anon, authenticated, service_role;

drop trigger if exists zz_bookings_buffer_v101 on public.bookings;
create trigger zz_bookings_buffer_v101
before insert or update of performer_id, booking_date, booking_time, duration_minutes, status, client_phone
on public.bookings
for each row execute function public.enforce_minuta_booking_buffer_v101();

commit;
