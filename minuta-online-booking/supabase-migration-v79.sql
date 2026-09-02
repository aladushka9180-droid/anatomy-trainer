begin;

set local search_path = public, extensions, pg_catalog;

do $$
begin
  if to_regclass('public.bookings') is null
     or to_regclass('public.services') is null
     or to_regclass('public.performer_profiles') is null
     or to_regclass('public.booking_outcomes') is null
     or to_regprocedure('public.book_appointment(uuid,uuid,date,time without time zone,text,text)') is null
     or to_regprocedure('public.cancel_minuta_booking_core(uuid,text,text)') is null
     or not coalesce((select relreplident = 'f' from pg_class where oid = 'public.services'::regclass), false)
     or not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'services'
     ) then
    raise exception using errcode = 'P0001', message = 'v79_missing_prerequisites';
  end if;
end $$;

create table if not exists public.booking_series (
  id uuid primary key default gen_random_uuid(),
  performer_id uuid not null references public.performer_profiles(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete restrict,
  client_name text not null check (char_length(btrim(client_name)) between 2 and 80),
  client_phone text not null check (char_length(regexp_replace(client_phone, '[^0-9]', '', 'g')) between 10 and 15),
  start_date date not null,
  booking_time time without time zone not null,
  interval_weeks integer not null check (interval_weeks between 1 and 12),
  occurrence_count integer not null check (occurrence_count between 2 and 24),
  created_at timestamptz not null default now()
);

alter table public.bookings
  add column if not exists series_id uuid references public.booking_series(id) on delete set null,
  add column if not exists series_occurrence integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'bookings_series_occurrence_check'
      and conrelid = 'public.bookings'::regclass
  ) then
    alter table public.bookings add constraint bookings_series_occurrence_check
      check (
        (series_id is null and series_occurrence is null)
        or (series_id is not null and series_occurrence between 1 and 24)
      );
  end if;
end $$;

create unique index if not exists bookings_series_occurrence_uidx
  on public.bookings(series_id, series_occurrence)
  where series_id is not null;
create index if not exists booking_series_performer_created_idx
  on public.booking_series(performer_id, created_at desc);

alter table public.booking_series enable row level security;
drop policy if exists booking_series_owner_read on public.booking_series;
create policy booking_series_owner_read on public.booking_series
  for select to authenticated
  using (performer_id = (select auth.uid()));

revoke all on table public.booking_series from public, anon, authenticated;
grant select on table public.booking_series to authenticated;

create or replace function public.create_minuta_recurring_bookings(
  p_service uuid,
  p_start_date date,
  p_time time without time zone,
  p_client_name text,
  p_client_phone text,
  p_occurrence_count integer,
  p_interval_weeks integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_actor uuid := auth.uid();
  v_performer uuid;
  v_series uuid;
  v_index integer;
  v_date date;
  v_code text;
  v_token uuid;
  v_created jsonb := '[]'::jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if p_service is null or p_start_date is null or p_time is null
     or p_occurrence_count is null or p_occurrence_count not between 2 and 24
     or p_interval_weeks is null or p_interval_weeks not between 1 and 12
     or p_start_date < current_date
     or p_start_date + ((p_occurrence_count - 1) * p_interval_weeks * 7) > current_date + 730 then
    raise exception using errcode = '22023', message = 'invalid_recurring_booking';
  end if;
  if coalesce(char_length(btrim(p_client_name)), 0) < 2
     or coalesce(char_length(regexp_replace(p_client_phone, '[^0-9]', '', 'g')), 0) not between 10 and 15 then
    raise exception using errcode = '22023', message = 'invalid_client_data';
  end if;

  select service.performer_id into v_performer
  from public.services service
  where service.id = p_service and service.active;
  if v_performer is null or v_performer <> v_actor then
    raise exception using errcode = '42501', message = 'foreign_service_denied';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_actor::text || ':' || p_service::text, 7900));

  insert into public.booking_series (
    performer_id, service_id, client_name, client_phone, start_date,
    booking_time, interval_weeks, occurrence_count
  ) values (
    v_actor, p_service, btrim(p_client_name), btrim(p_client_phone), p_start_date,
    p_time, p_interval_weeks, p_occurrence_count
  ) returning id into v_series;

  for v_index in 1..p_occurrence_count loop
    v_date := p_start_date + ((v_index - 1) * p_interval_weeks * 7);
    select created.booking_code, created.manage_token
      into v_code, v_token
    from public.book_appointment(
      gen_random_uuid(), p_service, v_date, p_time,
      btrim(p_client_name), btrim(p_client_phone)
    ) created;

    update public.bookings
    set series_id = v_series, series_occurrence = v_index
    where manage_token = v_token and performer_id = v_actor;

    if not found then
      raise exception using errcode = 'P0001', message = 'recurring_booking_link_failed';
    end if;
    v_created := v_created || jsonb_build_array(jsonb_build_object(
      'booking_id', (select booking.id from public.bookings booking where booking.manage_token = v_token),
      'occurrence', v_index,
      'date', v_date,
      'booking_code', v_code
    ));
  end loop;

  return jsonb_build_object('series_id', v_series, 'created', v_created);
exception
  when exclusion_violation or unique_violation then
    raise exception using errcode = 'P0001', message = 'series_slot_unavailable';
end;
$$;

create or replace function public.manage_minuta_booking_series(
  p_booking uuid,
  p_action text,
  p_scope text default 'one',
  p_date date default null,
  p_time time without time zone default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_actor uuid := auth.uid();
  v_anchor public.bookings%rowtype;
  v_delta interval;
  v_ids uuid[];
  v_target record;
  v_affected jsonb := '[]'::jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if p_booking is null or p_action not in ('cancel', 'reschedule')
     or p_scope not in ('one', 'following', 'all') then
    raise exception using errcode = '22023', message = 'invalid_series_action';
  end if;

  select booking.* into v_anchor
  from public.bookings booking
  where booking.id = p_booking;

  if not found then
    raise exception using errcode = 'P0001', message = 'booking_not_found';
  end if;
  if v_anchor.performer_id <> v_actor then
    raise exception using errcode = '42501', message = 'booking_access_denied';
  end if;
  if v_anchor.series_id is null or v_anchor.series_occurrence is null then
    raise exception using errcode = 'P0001', message = 'booking_not_in_series';
  end if;
  if v_anchor.status = 'cancelled'
     or v_anchor.booking_date < current_date
     or exists (
       select 1 from public.booking_outcomes outcome
       where outcome.booking_id = v_anchor.id
         and outcome.visit_status <> 'scheduled'
     ) then
    raise exception using errcode = 'P0001', message = 'series_booking_not_actionable';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_anchor.series_id::text, 7901));

  select
    array_agg(booking.id order by booking.series_occurrence),
    coalesce(jsonb_agg(jsonb_build_object(
      'booking_id', booking.id,
      'occurrence', booking.series_occurrence
    ) order by booking.series_occurrence), '[]'::jsonb)
  into v_ids, v_affected
  from public.bookings booking
  left join public.booking_outcomes outcome on outcome.booking_id = booking.id
  where booking.series_id = v_anchor.series_id
    and booking.performer_id = v_actor
    and booking.status <> 'cancelled'
    and booking.booking_date >= current_date
    and coalesce(outcome.visit_status, 'scheduled') = 'scheduled'
    and (
      (p_scope = 'one' and booking.id = v_anchor.id)
      or (p_scope = 'following' and booking.series_occurrence >= v_anchor.series_occurrence)
      or p_scope = 'all'
    );

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception using errcode = 'P0001', message = 'series_has_no_actionable_bookings';
  end if;

  -- Ядро отмены v76 берёт такой же lock до блокировки строки. Получаем lock
  -- каждой записи заранее и по порядку, чтобы групповая операция не могла
  -- образовать взаимную блокировку с одиночной отменой.
  for v_target in
    select booking.id
    from public.bookings booking
    where booking.id = any(v_ids)
    order by booking.series_occurrence, booking.id
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_target.id::text, 7302));
  end loop;

  perform 1
  from public.bookings booking
  where booking.id = any(v_ids)
  order by booking.series_occurrence, booking.id
  for update;

  perform 1
  from public.booking_outcomes outcome
  where outcome.booking_id = any(v_ids)
  order by outcome.booking_id
  for update;

  -- Повторяем выбор после ожидания блокировок: отменённая или завершённая
  -- параллельным запросом запись не должна попасть в групповую операцию.
  select
    array_agg(booking.id order by booking.series_occurrence),
    coalesce(jsonb_agg(jsonb_build_object(
      'booking_id', booking.id,
      'occurrence', booking.series_occurrence
    ) order by booking.series_occurrence), '[]'::jsonb)
  into v_ids, v_affected
  from public.bookings booking
  left join public.booking_outcomes outcome on outcome.booking_id = booking.id
  where booking.series_id = v_anchor.series_id
    and booking.performer_id = v_actor
    and booking.status <> 'cancelled'
    and booking.booking_date >= current_date
    and coalesce(outcome.visit_status, 'scheduled') = 'scheduled'
    and (
      (p_scope = 'one' and booking.id = v_anchor.id)
      or (p_scope = 'following' and booking.series_occurrence >= v_anchor.series_occurrence)
      or p_scope = 'all'
    );

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception using errcode = 'P0001', message = 'series_has_no_actionable_bookings';
  end if;

  if p_action = 'cancel' then
    for v_target in
      select booking.id
      from public.bookings booking
      where booking.id = any(v_ids)
      order by booking.series_occurrence
    loop
      perform public.cancel_minuta_booking_core(v_target.id, 'provider', 'always_full');
    end loop;
  else
    if p_date is null or p_time is null then
      raise exception using errcode = '22023', message = 'series_reschedule_target_required';
    end if;
    v_delta := (p_date + p_time) - (v_anchor.booking_date + v_anchor.booking_time);

    if exists (
      select 1
      from public.bookings booking
      where booking.id = any(v_ids)
        and (
          ((booking.booking_date + booking.booking_time + v_delta)::date < current_date)
          or ((booking.booking_date + booking.booking_time + v_delta)::date > current_date + 730)
        )
    ) then
      raise exception using errcode = '22023', message = 'series_reschedule_out_of_range';
    end if;

    -- Положительный сдвиг идёт с конца серии, отрицательный — с начала.
    -- Так старые окна следующих элементов освобождаются до переноса соседей.
    for v_target in
      select booking.id
      from public.bookings booking
      where booking.id = any(v_ids)
      order by
        case when v_delta >= interval '0 seconds' then booking.booking_date + booking.booking_time end desc,
        case when v_delta < interval '0 seconds' then booking.booking_date + booking.booking_time end asc,
        booking.id
    loop
      update public.bookings booking
      set booking_date = (booking.booking_date + booking.booking_time + v_delta)::date,
          booking_time = (booking.booking_date + booking.booking_time + v_delta)::time
      where booking.id = v_target.id
        and booking.performer_id = v_actor;
    end loop;
  end if;

  return jsonb_build_object(
    'series_id', v_anchor.series_id,
    'action', p_action,
    'scope', p_scope,
    'affected_count', array_length(v_ids, 1),
    'affected', v_affected
  );
exception
  when exclusion_violation or unique_violation then
    raise exception using errcode = 'P0001', message = 'series_slot_unavailable';
end;
$$;

revoke all on function public.create_minuta_recurring_bookings(
  uuid,date,time without time zone,text,text,integer,integer
) from public, anon, authenticated, service_role;
grant execute on function public.create_minuta_recurring_bookings(
  uuid,date,time without time zone,text,text,integer,integer
) to authenticated;

revoke all on function public.manage_minuta_booking_series(
  uuid,text,text,date,time without time zone
) from public, anon, authenticated, service_role;
grant execute on function public.manage_minuta_booking_series(
  uuid,text,text,date,time without time zone
) to authenticated;

commit;
