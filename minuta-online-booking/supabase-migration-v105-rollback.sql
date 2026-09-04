-- v105 rollback: return booking-page visits to the anonymous v74 shape.
begin;
drop function if exists public.upsert_public_booking_presence(text,uuid,text,text,text,text,text,text);
drop policy if exists booking_page_visits_owner_read on public.booking_page_visits;
create policy booking_page_visits_owner_read on public.booking_page_visits for select to authenticated using(performer_id=(select auth.uid()));
drop index if exists public.booking_page_visits_owner_presence_idx;
drop index if exists public.booking_page_visits_owner_session_idx;
alter table public.booking_page_visits
  drop column if exists session_id,drop column if exists client_name,drop column if exists client_phone,
  drop column if exists page_name,drop column if exists source_kind,drop column if exists source_label,
  drop column if exists first_source_label,drop column if exists last_seen_at;
create or replace function public.register_public_booking_visit(p_slug text)
returns boolean language plpgsql security definer set search_path to '' as $$
declare v_organization uuid; v_performer uuid; v_inserted boolean:=false;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9][a-z0-9-]{2,62}$' then return false; end if;
  select organization.id into v_organization from public.organizations organization
  where organization.public_slug=p_slug and organization.status='active' and organization.public_booking_enabled limit 1;
  if v_organization is null then return false; end if;
  for v_performer in select membership.user_id from public.organization_memberships membership
    join public.booking_policies policy on policy.performer_id=membership.user_id and policy.visitor_notifications_enabled
    where membership.organization_id=v_organization and membership.active and membership.role in ('owner','admin')
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_performer::text,74));
    if not exists(select 1 from public.booking_page_visits visit where visit.performer_id=v_performer and visit.created_at>=pg_catalog.now()-interval '2 minutes') then
      insert into public.booking_page_visits(organization_id,performer_id) values(v_organization,v_performer); v_inserted:=true;
    end if;
  end loop;
  return v_inserted;
end;
$$;
revoke all on function public.register_public_booking_visit(text) from public,anon,authenticated,service_role;
grant execute on function public.register_public_booking_visit(text) to anon,authenticated,service_role;
commit;
