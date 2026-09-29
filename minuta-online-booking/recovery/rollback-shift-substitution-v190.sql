-- Operational rollback for v190. Keep the safe workspace read projection and
-- all booking data; disable substitution until v190 can be reapplied and checked.
-- Do not restore the v76 body: it can substitute schedule blocks directly.
begin;

create or replace function public.substitute_minuta_booking(p_organization uuid,p_booking uuid,p_new_service uuid)
returns boolean language plpgsql security definer set search_path to '' as $$
begin
  raise exception using errcode='55000', message='booking_substitution_temporarily_unavailable';
end;
$$;

revoke all on function public.substitute_minuta_booking(uuid,uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.substitute_minuta_booking(uuid,uuid,uuid) to authenticated;

commit;
