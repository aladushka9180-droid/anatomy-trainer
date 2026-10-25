begin;
drop function if exists public.get_public_performer_booking_reviews(uuid);
notify pgrst, 'reload schema';
commit;
