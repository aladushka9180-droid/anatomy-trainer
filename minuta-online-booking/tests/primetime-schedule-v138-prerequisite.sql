-- Isolated test databases may not carry the full production migration chain.
-- Provide only the v101 signature that v138 intentionally requires and hardens.
create or replace function public.get_public_minuta_available_slots_v101(
  p_slug text,
  p_location uuid,
  p_service uuid,
  p_start date,
  p_end date
) returns table(booking_date date,booking_time time)
language sql stable security definer set search_path=public,pg_temp
as $$
  select null::date,null::time where false
$$;

revoke all on function public.get_public_minuta_available_slots_v101(text,uuid,uuid,date,date) from public;
grant execute on function public.get_public_minuta_available_slots_v101(text,uuid,uuid,date,date) to anon,authenticated;
