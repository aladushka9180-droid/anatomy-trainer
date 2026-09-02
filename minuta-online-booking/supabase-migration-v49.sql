begin;

alter table public.bookings
  add column if not exists provider_note text;

update public.bookings
set provider_note = ''
where provider_note is null;

alter table public.bookings
  alter column provider_note set default '',
  alter column provider_note set not null;

-- Do not drop and rebuild a valid constraint on every release. Rebuilding it
-- takes a stronger table lock and needlessly scans all historical bookings.
do $$
declare v_definition text;
begin
  select pg_get_constraintdef(constraint_row.oid,true) into v_definition
  from pg_constraint constraint_row
  where constraint_row.conrelid='public.bookings'::regclass
    and constraint_row.conname='bookings_provider_note_length_check';
  if v_definition is null then
    alter table public.bookings add constraint bookings_provider_note_length_check
      check (char_length(provider_note) <= 1000);
  elsif regexp_replace(lower(v_definition),'\s','','g') not in (
    'check(char_length(provider_note)<=1000)',
    'check((char_length(provider_note)<=1000))'
  ) then
    raise exception using errcode='P0001',message='v49_provider_note_constraint_mismatch';
  end if;
end $$;

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

revoke all on function public.set_booking_note(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.set_booking_note(uuid, text) to authenticated;

commit;
