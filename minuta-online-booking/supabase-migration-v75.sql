begin;

set local search_path = public, pg_catalog;

do $$
begin
  if to_regclass('public.bookings') is null
     or to_regprocedure('public.set_booking_color(uuid,text)') is null then
    raise exception using errcode = 'P0001', message = 'v75_requires_v48';
  end if;
end;
$$;

alter table public.bookings
  drop constraint if exists bookings_color_key_check;
alter table public.bookings
  add constraint bookings_color_key_check
  check (color_key in ('auto', 'mint', 'sky', 'lavender', 'peach', 'rose', 'vanilla', 'sage', 'teal', 'amber', 'cocoa', 'graphite'));

create or replace function public.set_booking_color(p_booking uuid, p_color text)
returns text
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if p_color not in ('auto', 'mint', 'sky', 'lavender', 'peach', 'rose', 'vanilla', 'sage', 'teal', 'amber', 'cocoa', 'graphite') then
    raise exception using errcode = '22023', message = 'invalid_booking_color';
  end if;

  update public.bookings
  set color_key = p_color
  where id = p_booking
    and performer_id = (select auth.uid());

  if not found then
    raise exception using errcode = '42501', message = 'booking_not_owned';
  end if;
  return p_color;
end;
$$;

revoke all on function public.set_booking_color(uuid, text) from public;
grant execute on function public.set_booking_color(uuid, text) to authenticated;

commit;
