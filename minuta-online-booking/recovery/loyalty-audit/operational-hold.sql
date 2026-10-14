-- Production recovery option: retain the membership fix and all data; temporarily hold Loyalty.
-- Reads can expire rewards, so public read RPCs are held too. PostgreSQL administrator access is unchanged.
-- Completions during the hold are not backfilled automatically.
-- Explicit release-owner authorization is required; not an automatic fallback.
begin;
set local lock_timeout='5s';
create or replace function public.get_minuta_loyalty_program_role_v166(p_organization uuid)
returns text language plpgsql stable security definer set search_path to '' as $$
declare v_role text;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication_required'; end if;
  select membership.role into v_role
  from public.organization_memberships membership
  join public.organizations organization on organization.id=membership.organization_id and organization.status='active'
  where membership.organization_id=p_organization and membership.user_id=auth.uid() and membership.active;
  if v_role is null or v_role not in ('owner','admin') then
    raise exception using errcode='42501',message='loyalty_program_management_denied';
  end if;
  return v_role;
end $$;
revoke execute on function public.set_minuta_loyalty_program_v166(uuid,boolean,integer,text,integer,text,text,integer,uuid) from authenticated;
revoke execute on function public.adjust_minuta_loyalty_progress_v166(uuid,uuid,integer,text,uuid) from authenticated;
revoke execute on function public.redeem_minuta_loyalty_reward_v166(uuid,uuid,uuid,text,uuid) from authenticated;
revoke execute on function public.get_minuta_loyalty_program_workspace_v166(uuid) from authenticated;
revoke execute on function public.get_client_loyalty_program_v166(text,uuid) from anon,authenticated;
alter table public.booking_outcomes disable trigger booking_outcomes_loyalty_program_v166;
alter table public.bookings disable trigger bookings_loyalty_program_v166;
commit;
