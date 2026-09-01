begin;

alter table public.bookings
  add column if not exists provider_note text;

update public.bookings
set provider_note = ''
where provider_note is null;

alter table public.bookings
  alter column provider_note set default '',
  alter column provider_note set not null;

alter table public.bookings
  drop constraint if exists bookings_provider_note_length_check;
alter table public.bookings
  add constraint bookings_provider_note_length_check
  check (char_length(provider_note) <= 1000);

create or replace function public.set_booking_note(p_booking uuid, p_note text)
returns text
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
declare
  normalized_note text := btrim(coalesce(p_note, ''));
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if char_length(normalized_note) > 1000 then
    raise exception using errcode = '22001', message = 'booking_note_too_long';
  end if;

  update public.bookings
  set provider_note = normalized_note
  where id = p_booking
    and performer_id = (select auth.uid());

  if not found then
    raise exception using errcode = '42501', message = 'booking_not_owned';
  end if;
  return normalized_note;
end;
$$;

revoke all on function public.set_booking_note(uuid, text) from public;
grant execute on function public.set_booking_note(uuid, text) to authenticated;

commit;
