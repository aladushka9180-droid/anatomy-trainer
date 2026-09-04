begin;

alter table public.bookings
  add column if not exists original_price_rub integer,
  add column if not exists total_price_rub integer;

do $$
begin
  if exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='booking_outcomes'
      and column_name='calculated_amount_rub'
  ) then
    execute $backfill$
      update public.bookings booking
      set original_price_rub = coalesce(
            booking.original_price_rub,
            (select outcome.calculated_amount_rub from public.booking_outcomes outcome
             where outcome.booking_id=booking.id and outcome.visit_status='completed'),
            case when booking.booking_date>=current_date then service.price_rub end
          ),
          total_price_rub = coalesce(
            booking.total_price_rub,
            (select outcome.calculated_amount_rub from public.booking_outcomes outcome
             where outcome.booking_id=booking.id and outcome.visit_status='completed'),
            case when booking.booking_date>=current_date then service.price_rub end
          )
      from public.services service
      where service.id=booking.service_id
        and (booking.original_price_rub is null or booking.total_price_rub is null)
    $backfill$;
  else
    update public.bookings booking
    set original_price_rub=coalesce(
          booking.original_price_rub,
          case when booking.booking_date>=current_date then service.price_rub end
        ),
        total_price_rub=coalesce(
          booking.total_price_rub,
          case when booking.booking_date>=current_date then service.price_rub end
        )
    from public.services service
    where service.id=booking.service_id
      and (booking.original_price_rub is null or booking.total_price_rub is null);
  end if;
end $$;

alter table public.bookings
  drop constraint if exists bookings_original_price_rub_check;
alter table public.bookings
  add constraint bookings_original_price_rub_check
  check (original_price_rub is null or original_price_rub between 0 and 1000000);
alter table public.bookings
  drop constraint if exists bookings_total_price_rub_check;
alter table public.bookings
  add constraint bookings_total_price_rub_check
  check (total_price_rub is null or total_price_rub between 0 and 10000000);

create table if not exists public.booking_session_items (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  performer_id uuid not null references public.performer_profiles(id) on delete cascade,
  position integer not null check (position between 1 and 20),
  item_kind text not null check (item_kind in ('primary', 'addon')),
  service_id uuid references public.services(id) on delete set null,
  title text not null check (char_length(btrim(title)) between 2 and 120),
  duration_minutes integer not null check (duration_minutes between 0 and 480),
  price_rub integer not null check (price_rub between 0 and 1000000),
  extends_duration boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (booking_id, position)
);

create table if not exists public.booking_session_revisions (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  performer_id uuid not null references public.performer_profiles(id) on delete cascade,
  items jsonb not null,
  total_price_rub integer not null check (total_price_rub between 0 and 10000000),
  total_duration_minutes integer not null check (total_duration_minutes between 5 and 480),
  created_at timestamptz not null default now(),
  check (jsonb_typeof(items) = 'array')
);

create index if not exists idx_booking_session_items_owner
  on public.booking_session_items (performer_id, booking_id, position);
create index if not exists idx_booking_session_revisions_owner
  on public.booking_session_revisions (performer_id, booking_id, created_at desc);

create or replace function public.initialize_booking_session_price()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_price integer;
begin
  select service.price_rub into v_price
  from public.services service
  where service.id = new.service_id and service.performer_id = new.performer_id;
  new.original_price_rub := coalesce(new.original_price_rub, v_price, 0);
  new.total_price_rub := coalesce(new.total_price_rub, v_price, 0);
  return new;
end;
$$;

drop trigger if exists bookings_initialize_session_price on public.bookings;
create trigger bookings_initialize_session_price
before insert on public.bookings
for each row execute function public.initialize_booking_session_price();

create or replace function public.initialize_booking_session_item()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if new.client_phone <> '0000000000' then
    insert into public.booking_session_items (
      booking_id, performer_id, position, item_kind, service_id, title,
      duration_minutes, price_rub, extends_duration
    )
    select new.id, new.performer_id, 1, 'primary', new.service_id, service.name,
           new.duration_minutes, coalesce(new.total_price_rub, service.price_rub), true
    from public.services service
    where service.id = new.service_id
    on conflict (booking_id, position) do nothing;
    insert into public.booking_session_revisions (
      booking_id, performer_id, items, total_price_rub, total_duration_minutes
    )
    select new.id, new.performer_id,
      jsonb_build_array(jsonb_build_object(
        'kind', 'primary', 'service_id', new.service_id, 'title', service.name,
        'duration_minutes', new.duration_minutes,
        'price_rub', coalesce(new.total_price_rub, service.price_rub),
        'extends_duration', true
      )),
      coalesce(new.total_price_rub, service.price_rub), greatest(new.duration_minutes, 5)
    from public.services service
    where service.id = new.service_id;
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_initialize_session_item on public.bookings;
create trigger bookings_initialize_session_item
after insert on public.bookings
for each row execute function public.initialize_booking_session_item();

insert into public.booking_session_items (
  booking_id, performer_id, position, item_kind, service_id, title,
  duration_minutes, price_rub, extends_duration
)
select booking.id, booking.performer_id, 1, 'primary', booking.service_id,
       service.name, booking.duration_minutes, booking.total_price_rub, true
from public.bookings booking
join public.services service on service.id = booking.service_id
where booking.client_phone <> '0000000000'
  and booking.total_price_rub is not null
on conflict (booking_id, position) do nothing;

insert into public.booking_session_revisions (
  booking_id, performer_id, items, total_price_rub, total_duration_minutes
)
select booking.id, booking.performer_id,
  jsonb_agg(jsonb_build_object(
    'kind', item.item_kind, 'service_id', item.service_id, 'title', item.title,
    'duration_minutes', item.duration_minutes, 'price_rub', item.price_rub,
    'extends_duration', item.extends_duration
  ) order by item.position),
  sum(item.price_rub)::integer,
  greatest(5,
    (sum(item.duration_minutes) filter (where item.item_kind = 'primary')
      + coalesce(sum(item.duration_minutes) filter (where item.item_kind = 'addon' and item.extends_duration), 0))::integer)
from public.bookings booking
join public.booking_session_items item on item.booking_id = booking.id
where not exists (
  select 1 from public.booking_session_revisions revision where revision.booking_id = booking.id
)
group by booking.id, booking.performer_id;

alter table public.booking_session_items enable row level security;
alter table public.booking_session_revisions enable row level security;

drop policy if exists booking_session_items_owner_all on public.booking_session_items;
create policy booking_session_items_owner_all on public.booking_session_items
  for all to authenticated
  using (performer_id = (select auth.uid()))
  with check (performer_id = (select auth.uid()));

drop policy if exists booking_session_revisions_owner_select on public.booking_session_revisions;
create policy booking_session_revisions_owner_select on public.booking_session_revisions
  for select to authenticated
  using (performer_id = (select auth.uid()));

grant select on public.booking_session_items, public.booking_session_revisions to authenticated;

create or replace function public.save_booking_session(p_booking uuid, p_items jsonb)
returns table(total_price_rub integer, total_duration_minutes integer)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_booking public.bookings%rowtype;
  v_primary_service uuid;
  v_total_price integer;
  v_total_duration integer;
  v_conflict_time time without time zone;
  v_items jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 20 then
    raise exception using errcode = 'P0001', message = 'invalid_session_items';
  end if;

  select * into v_booking
  from public.bookings booking
  where booking.id = p_booking and booking.performer_id = auth.uid()
  for update;
  if not found or v_booking.client_phone = '0000000000' or v_booking.status = 'cancelled' then
    raise exception using errcode = 'P0001', message = 'booking_unavailable';
  end if;

  with parsed as (
    select ordinality::integer as position,
      value->>'kind' as item_kind,
      nullif(value->>'service_id', '')::uuid as service_id,
      btrim(value->>'title') as title,
      (value->>'duration_minutes')::integer as duration_minutes,
      (value->>'price_rub')::integer as price_rub,
      coalesce((value->>'extends_duration')::boolean, false) as extends_duration
    from jsonb_array_elements(p_items) with ordinality
  )
  select (array_agg(service_id) filter (where item_kind = 'primary'))[1],
         sum(price_rub)::integer,
         (sum(duration_minutes) filter (where item_kind = 'primary')
           + coalesce(sum(duration_minutes) filter (where item_kind = 'addon' and extends_duration), 0))::integer
  into v_primary_service, v_total_price, v_total_duration
  from parsed;

  if (select count(*) from jsonb_array_elements(p_items) value where value->>'kind' = 'primary') <> 1
     or p_items->0->>'kind' <> 'primary'
     or v_primary_service is null
     or v_total_price not between 0 and 10000000
     or v_total_duration not between 5 and 480
     or exists (
       select 1 from jsonb_array_elements(p_items) value
       where value->>'kind' not in ('primary', 'addon')
          or char_length(btrim(value->>'title')) not between 2 and 120
          or (value->>'duration_minutes')::integer not between 0 and 480
          or (value->>'price_rub')::integer not between 0 and 1000000
     )
     or exists (
       select 1
       from jsonb_array_elements(p_items) value
       where nullif(value->>'service_id', '') is not null
         and not exists (
           select 1 from public.services service
           where service.id = (value->>'service_id')::uuid and service.performer_id = auth.uid()
         )
     ) then
    raise exception using errcode = 'P0001', message = 'invalid_session_items';
  end if;

  select other.booking_time into v_conflict_time
  from public.bookings other
  where other.performer_id = auth.uid()
    and other.id <> v_booking.id
    and other.booking_date = v_booking.booking_date
    and other.status <> 'cancelled'
    and v_booking.booking_date + v_booking.booking_time
          < other.booking_date + other.booking_time + make_interval(mins => other.duration_minutes)
    and v_booking.booking_date + v_booking.booking_time + make_interval(mins => v_total_duration)
          > other.booking_date + other.booking_time
  order by other.booking_time
  limit 1;
  if v_conflict_time is not null then
    raise exception using errcode = 'P0001', message = 'session_overlap:' || to_char(v_conflict_time, 'HH24:MI');
  end if;

  select jsonb_agg(jsonb_build_object(
    'kind', parsed.item_kind,
    'service_id', parsed.service_id,
    'title', parsed.title,
    'duration_minutes', parsed.duration_minutes,
    'price_rub', parsed.price_rub,
    'extends_duration', parsed.extends_duration
  ) order by parsed.position)
  into v_items
  from (
    select ordinality::integer as position,
      value->>'kind' as item_kind,
      nullif(value->>'service_id', '')::uuid as service_id,
      btrim(value->>'title') as title,
      (value->>'duration_minutes')::integer as duration_minutes,
      (value->>'price_rub')::integer as price_rub,
      coalesce((value->>'extends_duration')::boolean, false) as extends_duration
    from jsonb_array_elements(p_items) with ordinality
  ) parsed;

  delete from public.booking_session_items where booking_id = v_booking.id;
  insert into public.booking_session_items (
    booking_id, performer_id, position, item_kind, service_id, title,
    duration_minutes, price_rub, extends_duration
  )
  select v_booking.id, auth.uid(), parsed.position, parsed.item_kind, parsed.service_id,
         parsed.title, parsed.duration_minutes, parsed.price_rub, parsed.extends_duration
  from (
    select ordinality::integer as position,
      value->>'kind' as item_kind,
      nullif(value->>'service_id', '')::uuid as service_id,
      btrim(value->>'title') as title,
      (value->>'duration_minutes')::integer as duration_minutes,
      (value->>'price_rub')::integer as price_rub,
      coalesce((value->>'extends_duration')::boolean, false) as extends_duration
    from jsonb_array_elements(p_items) with ordinality
  ) parsed;

  update public.bookings
  set service_id = v_primary_service,
      duration_minutes = v_total_duration,
      original_price_rub = coalesce(original_price_rub, total_price_rub, v_total_price),
      total_price_rub = v_total_price
  where id = v_booking.id;

  insert into public.booking_session_revisions (
    booking_id, performer_id, items, total_price_rub, total_duration_minutes
  ) values (
    v_booking.id, auth.uid(), v_items, v_total_price, v_total_duration
  );

  return query select v_total_price, v_total_duration;
end;
$$;

revoke all on function public.save_booking_session(uuid, jsonb) from public;
grant execute on function public.save_booking_session(uuid, jsonb) to authenticated;

commit;
