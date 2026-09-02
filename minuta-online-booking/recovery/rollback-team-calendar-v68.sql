begin;

-- A structural rollback is safe only while v68 has not accepted a real
-- organization-aware booking. After that point the additive columns must stay
-- and only the application feature may be disabled.
do $$
declare
  v_team_bookings_exist boolean := false;
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'bookings'
      and column_name = 'booking_scope_source'
  ) then
    execute 'select exists (select 1 from public.bookings where booking_scope_source = ''team'')'
      into v_team_bookings_exist;
  end if;
  if v_team_bookings_exist then
    raise exception using errcode = 'P0001', message = 'v68_rollback_blocked_team_bookings_exist';
  end if;
end;
$$;

drop function if exists public.get_minuta_team_calendar(uuid,date,date,uuid,uuid);
drop function if exists public.book_minuta_appointment(uuid,text,uuid,uuid,date,time without time zone,text,text);
drop function if exists public.get_public_minuta_catalog_v2(text);

drop trigger if exists bookings_scope_minuta_tenant on public.bookings;
drop function if exists public.scope_minuta_booking();

alter table public.bookings
  drop constraint if exists bookings_performer_active_no_overlap;

drop index if exists public.bookings_location_date_idx;
drop index if exists public.bookings_organization_date_idx;

alter table public.bookings
  drop constraint if exists bookings_scope_source_check,
  drop constraint if exists bookings_location_organization_fkey,
  drop constraint if exists bookings_organization_id_fkey,
  drop column if exists booking_scope_source,
  drop column if exists location_id,
  drop column if exists organization_id;

commit;
