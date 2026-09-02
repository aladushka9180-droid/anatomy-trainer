begin;

drop function if exists public.register_public_booking_visit(text);
drop table if exists public.booking_page_visits;
alter table if exists public.booking_policies
  drop column if exists visitor_notifications_enabled;

commit;
