begin;

create table if not exists public.booking_reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id) on delete cascade,
  performer_id uuid not null references public.performer_profiles(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete restrict,
  client_account_id uuid not null references public.client_accounts(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  review_text text not null default '' check (char_length(review_text) <= 1000),
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_booking_reviews_public
  on public.booking_reviews (performer_id, created_at desc)
  where published;

alter table public.booking_reviews enable row level security;
revoke all on public.booking_reviews from public, anon, authenticated;

drop trigger if exists booking_reviews_touch_updated_at on public.booking_reviews;
create trigger booking_reviews_touch_updated_at
before update on public.booking_reviews
for each row execute function public.touch_minuta_updated_at();

create or replace function public.provider_delete_booking(p_booking uuid)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_performer uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  select booking.performer_id
  into v_performer
  from public.bookings booking
  where booking.id = p_booking
  for update;

  if not found then
    return 'not_found';
  end if;
  if v_performer is distinct from auth.uid() then
    raise exception 'booking_access_denied' using errcode = '42501';
  end if;
  if exists (select 1 from public.booking_reviews review where review.booking_id = p_booking) then
    return 'review_protected';
  end if;

  if to_regclass('public.payments') is not null then
    if to_regclass('public.payment_events') is not null then
      execute $sql$
        delete from public.payment_events event
        where event.payment_id in (
          select payment.id from public.payments payment
          where payment.booking_id = $1
        )
      $sql$ using p_booking;
    end if;
    execute 'delete from public.payments where booking_id = $1' using p_booking;
  end if;

  delete from public.bookings booking
  where booking.id = p_booking
    and booking.performer_id = auth.uid();
  return 'deleted';
end;
$$;

revoke all on function public.provider_delete_booking(uuid) from public;
grant execute on function public.provider_delete_booking(uuid) to authenticated;

create or replace function public.submit_booking_review(
  p_session_token text,
  p_manage_token uuid,
  p_rating integer,
  p_review_text text default ''
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_account_id uuid;
  v_booking public.bookings%rowtype;
  v_review_text text := btrim(coalesce(p_review_text, ''));
  v_review_id uuid;
begin
  select resolved.client_account_id
  into v_account_id
  from public.resolve_client_session(p_session_token) resolved;

  if v_account_id is null then
    raise exception using errcode = 'P0001', message = 'invalid_client_session';
  end if;
  if p_rating is null or p_rating not between 1 and 5 then
    raise exception using errcode = 'P0001', message = 'invalid_review_rating';
  end if;
  if char_length(v_review_text) > 1000 then
    raise exception using errcode = 'P0001', message = 'review_too_long';
  end if;

  select booking.* into v_booking
  from public.bookings booking
  where booking.manage_token = p_manage_token
    and booking.client_account_id = v_account_id
    and booking.status <> 'cancelled'
    and exists (
      select 1
      from public.booking_outcomes outcome
      where outcome.booking_id = booking.id
        and outcome.visit_status = 'completed'
    )
  for update;

  if v_booking.id is null then
    raise exception using errcode = 'P0001', message = 'review_not_available';
  end if;

  insert into public.booking_reviews (
    booking_id, performer_id, service_id, client_account_id, rating, review_text, published
  ) values (
    v_booking.id, v_booking.performer_id, v_booking.service_id, v_account_id, p_rating, v_review_text, true
  )
  on conflict (booking_id) do update
  set rating = excluded.rating,
      review_text = excluded.review_text,
      updated_at = now()
  where public.booking_reviews.client_account_id = v_account_id
  returning id into v_review_id;

  if v_review_id is null then
    raise exception using errcode = 'P0001', message = 'review_not_available';
  end if;
  return v_review_id;
end;
$$;

create or replace function public.get_provider_booking_reviews()
returns table(
  review_id uuid,
  client_name text,
  service_name text,
  rating integer,
  review_text text,
  published boolean,
  created_at timestamptz
)
language sql
stable
security definer
set search_path to ''
as $$
  select
    review.id,
    booking.client_name::text,
    service.name::text,
    review.rating::integer,
    review.review_text::text,
    review.published,
    review.created_at
  from public.booking_reviews review
  join public.bookings booking on booking.id = review.booking_id
  join public.services service on service.id = review.service_id
  where auth.uid() is not null
    and review.performer_id = auth.uid()
  order by review.created_at desc;
$$;

create or replace function public.set_booking_review_published(p_review uuid, p_published boolean)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_published boolean;
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  update public.booking_reviews review
  set published = p_published, updated_at = now()
  where review.id = p_review and review.performer_id = auth.uid()
  returning review.published into v_published;
  if not found then
    raise exception 'review_access_denied' using errcode = '42501';
  end if;
  return v_published;
end;
$$;

create or replace function public.get_client_bookings_v2(p_session_token text)
returns table(
  booking_code text,
  manage_token uuid,
  client_name text,
  service_id uuid,
  service_name text,
  service_active boolean,
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
  payment_url text,
  review_eligible boolean,
  review_rating integer,
  review_text text,
  review_created_at timestamptz
)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_account_id uuid;
begin
  select resolved.client_account_id
  into v_account_id
  from public.resolve_client_session(p_session_token) resolved;
  if v_account_id is null then
    return;
  end if;

  return query
  select
    booking.booking_code::text,
    booking.manage_token,
    booking.client_name::text,
    service.id,
    service.name::text,
    service.active,
    booking.duration_minutes::integer,
    coalesce(booking.total_price_rub, service.price_rub)::integer,
    profile.display_name::text,
    booking.booking_date,
    booking.booking_time,
    case
      when outcome.visit_status = 'completed' then 'completed'
      when outcome.visit_status = 'no_show' then 'no_show'
      else booking.status
    end::text,
    booking.status <> 'cancelled'
      and coalesce(outcome.visit_status, 'scheduled') = 'scheduled'
      and timezone('Europe/Samara', now()) <= booking.booking_date + booking.booking_time - make_interval(hours => coalesce(policy.cancel_cutoff_hours, 12)),
    booking.status <> 'cancelled'
      and coalesce(outcome.visit_status, 'scheduled') = 'scheduled'
      and booking.reschedule_count < coalesce(policy.max_reschedules, 2)
      and timezone('Europe/Samara', now()) <= booking.booking_date + booking.booking_time - make_interval(hours => coalesce(policy.reschedule_cutoff_hours, 12)),
    greatest(0, coalesce(policy.max_reschedules, 2) - booking.reschedule_count)::integer,
    booking.deposit_amount_rub::integer,
    booking.payment_status::text,
    booking.payment_url::text,
    (booking.status <> 'cancelled' and outcome.visit_status = 'completed'),
    review.rating::integer,
    review.review_text::text,
    review.created_at
  from public.bookings booking
  join public.services service on service.id = booking.service_id
  join public.performer_profiles profile on profile.id = booking.performer_id
  left join public.booking_policies policy on policy.performer_id = booking.performer_id
  left join public.booking_outcomes outcome on outcome.booking_id = booking.id
  left join public.booking_reviews review on review.booking_id = booking.id
  where booking.client_account_id = v_account_id
  order by
    case
      when booking.status <> 'cancelled'
       and coalesce(outcome.visit_status, 'scheduled') not in ('completed', 'no_show')
       and booking.booking_date + booking.booking_time >= timezone('Europe/Samara', now()) then 0
      else 1
    end,
    case
      when booking.status <> 'cancelled'
       and coalesce(outcome.visit_status, 'scheduled') not in ('completed', 'no_show')
       and booking.booking_date + booking.booking_time >= timezone('Europe/Samara', now())
      then booking.booking_date + booking.booking_time
    end asc,
    booking.booking_date desc,
    booking.booking_time desc;
end;
$$;

create or replace function public.get_public_booking_reviews()
returns table(
  reviewer_name text,
  service_name text,
  performer_name text,
  rating integer,
  review_text text,
  created_at timestamptz,
  average_rating numeric,
  total_reviews bigint
)
language sql
stable
security definer
set search_path to ''
as $$
  with published_reviews as (
    select
      'Клиент'::text as reviewer_name,
      service.name::text as service_name,
      profile.display_name::text as performer_name,
      review.rating::integer as rating,
      review.review_text::text as review_text,
      review.created_at,
      round(avg(review.rating) over (), 1) as average_rating,
      count(*) over () as total_reviews
    from public.booking_reviews review
    join public.bookings booking on booking.id = review.booking_id
    join public.booking_outcomes outcome on outcome.booking_id = booking.id
    join public.services service on service.id = review.service_id
    join public.performer_profiles profile on profile.id = review.performer_id
    where review.published
      and booking.status <> 'cancelled'
      and outcome.visit_status = 'completed'
    order by review.created_at desc
  )
  select * from published_reviews limit 12;
$$;

revoke all on function public.submit_booking_review(text, uuid, integer, text) from public;
grant execute on function public.submit_booking_review(text, uuid, integer, text) to anon, authenticated;
revoke all on function public.get_client_bookings_v2(text) from public;
grant execute on function public.get_client_bookings_v2(text) to anon, authenticated;
revoke all on function public.get_public_booking_reviews() from public;
grant execute on function public.get_public_booking_reviews() to anon, authenticated;
revoke all on function public.get_provider_booking_reviews() from public;
grant execute on function public.get_provider_booking_reviews() to authenticated;
revoke all on function public.set_booking_review_published(uuid, boolean) from public;
grant execute on function public.set_booking_review_published(uuid, boolean) to authenticated;

commit;
