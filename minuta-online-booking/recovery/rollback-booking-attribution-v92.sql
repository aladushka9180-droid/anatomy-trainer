begin;

set local search_path = public, extensions, pg_catalog;

do $$
begin
  if to_regclass('public.booking_events') is not null
     or to_regprocedure('public.capture_minuta_booking_event_v93()') is not null
     or to_regprocedure('public.capture_minuta_outcome_event_v93()') is not null then
    raise exception using errcode='55000',message='v92_rollback_requires_v93_removed';
  end if;

  if to_regclass('public.bookings') is not null
     and exists (
       select 1
       from public.bookings booking
       where to_jsonb(booking)->>'booking_source' is not null
          or to_jsonb(booking)->>'created_by_user_id' is not null
          or to_jsonb(booking)->>'created_by_role' is not null
     ) then
    raise exception using errcode='55000',message='v92_rollback_blocked_booking_attribution_exists';
  end if;
end $$;

drop trigger if exists bookings_zz_protect_creation_attribution_v92 on public.bookings;
drop trigger if exists bookings_zz_set_creation_attribution_v92 on public.bookings;
drop function if exists public.protect_minuta_booking_creation_attribution_v92();
drop function if exists public.set_minuta_booking_creation_attribution_v92();
drop function if exists public.get_minuta_team_analytics(date,date);

drop index if exists public.bookings_creator_organization_date_v92_idx;
drop index if exists public.bookings_source_organization_date_v92_idx;

alter table public.bookings
  drop constraint if exists bookings_creation_attribution_check,
  drop constraint if exists bookings_created_by_role_check,
  drop constraint if exists bookings_booking_source_check,
  drop column if exists created_by_role,
  drop column if exists created_by_user_id,
  drop column if exists booking_source;

commit;
