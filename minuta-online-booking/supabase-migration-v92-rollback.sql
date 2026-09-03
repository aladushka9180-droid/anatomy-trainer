begin;

-- Только для изолированной тестовой базы: удаляет накопленную атрибуцию.

drop trigger if exists bookings_zz_protect_creation_attribution_v92 on public.bookings;
drop trigger if exists bookings_zz_set_creation_attribution_v92 on public.bookings;

drop function if exists public.protect_minuta_booking_creation_attribution_v92();
drop function if exists public.set_minuta_booking_creation_attribution_v92();
drop function if exists public.get_minuta_team_analytics(date,date);

drop index if exists public.bookings_creator_organization_date_v92_idx;
drop index if exists public.bookings_source_organization_date_v92_idx;

alter table if exists public.bookings
  drop constraint if exists bookings_creation_attribution_check,
  drop constraint if exists bookings_created_by_role_check,
  drop constraint if exists bookings_booking_source_check,
  drop column if exists created_by_role,
  drop column if exists created_by_user_id,
  drop column if exists booking_source;

commit;
