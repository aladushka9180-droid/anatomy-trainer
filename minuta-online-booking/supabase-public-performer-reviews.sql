begin;

-- Additive public read contract. Existing review RPCs, RLS and grants stay intact.
create function public.get_public_performer_booking_reviews(p_performer_id uuid)
returns table(
  performer_id uuid,
  reviewer_name text,
  service_name text,
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
  select
    review.performer_id,
    'Клиент'::text,
    service.name::text,
    review.rating::integer,
    review.review_text::text,
    review.created_at,
    round(avg(review.rating) over (), 1),
    count(*) over ()
  from public.booking_reviews review
  join public.bookings booking on booking.id = review.booking_id
  join public.booking_outcomes outcome on outcome.booking_id = booking.id
  join public.services service on service.id = review.service_id
  where review.performer_id = p_performer_id
    and booking.performer_id = p_performer_id
    and service.performer_id = p_performer_id
    and review.published
    and booking.status <> 'cancelled'
    and outcome.visit_status = 'completed'
  order by review.created_at desc, review.id desc
  limit 12;
$$;

revoke all on function public.get_public_performer_booking_reviews(uuid) from public;
grant execute on function public.get_public_performer_booking_reviews(uuid) to anon, authenticated;
notify pgrst, 'reload schema';
commit;
