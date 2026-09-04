-- v105: owner-only live booking-page presence, known-client identity and traffic attribution.
begin;
set local search_path = public, extensions, pg_catalog;

do $$ begin
  if to_regclass('public.booking_page_visits') is null
     or to_regclass('public.booking_policies') is null
     or to_regclass('public.organization_memberships') is null
     or to_regprocedure('public.register_public_booking_visit(text)') is null then
    raise exception using errcode='P0001',message='v105_requires_visitor_presence_v74';
  end if;
end $$;

alter table public.booking_page_visits
  add column if not exists session_id uuid,
  add column if not exists client_name text,
  add column if not exists client_phone text,
  add column if not exists page_name text not null default 'services',
  add column if not exists source_kind text not null default 'direct',
  add column if not exists source_label text,
  add column if not exists first_source_label text,
  add column if not exists last_seen_at timestamptz not null default now();

create unique index if not exists booking_page_visits_owner_session_idx on public.booking_page_visits(performer_id,session_id) where session_id is not null;
create index if not exists booking_page_visits_owner_presence_idx on public.booking_page_visits(performer_id,last_seen_at desc);

drop policy if exists booking_page_visits_owner_read on public.booking_page_visits;
create policy booking_page_visits_owner_read on public.booking_page_visits for select to authenticated
  using(performer_id=(select auth.uid()) and public.get_minuta_schedule_role(organization_id)='owner');

create or replace function public.upsert_public_booking_presence(
  p_slug text,p_session uuid,p_page text default 'services',p_source_kind text default 'direct',
  p_source_label text default null,p_first_source_label text default null,p_client_name text default null,p_client_phone text default null
)
returns boolean language plpgsql security definer set search_path to '' as $$
declare
  v_organization uuid; v_performer uuid; v_phone_digits text; v_client_name text; v_client_phone text;
  v_was_present boolean; v_inserted boolean:=false;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9][a-z0-9-]{2,62}$' or p_session is null then return false; end if;
  select organization.id into v_organization from public.organizations organization
  where organization.public_slug=p_slug and organization.status='active' and organization.public_booking_enabled limit 1;
  if v_organization is null then return false; end if;

  v_phone_digits:=pg_catalog.regexp_replace(coalesce(p_client_phone,''),'[^0-9]','','g');
  if pg_catalog.length(pg_catalog.trim(coalesce(p_client_name,'')))>=2 and pg_catalog.length(v_phone_digits) between 10 and 15 then
    select pg_catalog.left(booking.client_name,80),pg_catalog.left(booking.client_phone,32) into v_client_name,v_client_phone
    from public.bookings booking
    where pg_catalog.regexp_replace(coalesce(booking.client_phone,''),'[^0-9]','','g')=v_phone_digits
      and (booking.organization_id=v_organization or exists(
        select 1 from public.organization_memberships member
        where member.organization_id=v_organization and member.user_id=booking.performer_id and member.active
      ))
    order by booking.created_at desc limit 1;
  end if;

  for v_performer in
    select membership.user_id from public.organization_memberships membership
    join public.booking_policies policy on policy.performer_id=membership.user_id and policy.visitor_notifications_enabled
    where membership.organization_id=v_organization and membership.active and membership.role='owner'
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_performer::text||':'||p_session::text,105));
    select exists(select 1 from public.booking_page_visits visit where visit.performer_id=v_performer and visit.session_id=p_session) into v_was_present;
    insert into public.booking_page_visits(
      organization_id,performer_id,session_id,client_name,client_phone,page_name,source_kind,source_label,first_source_label,last_seen_at
    ) values(
      v_organization,v_performer,p_session,v_client_name,v_client_phone,
      case when p_page in ('services','date','details','success') then p_page else 'services' end,
      case when p_source_kind in ('direct','search','social','referral','campaign','qr') then p_source_kind else 'direct' end,
      pg_catalog.left(nullif(pg_catalog.trim(p_source_label),''),120),
      pg_catalog.left(nullif(pg_catalog.trim(p_first_source_label),''),120),pg_catalog.now()
    ) on conflict(performer_id,session_id) where session_id is not null do update set
      client_name=coalesce(excluded.client_name,booking_page_visits.client_name),
      client_phone=coalesce(excluded.client_phone,booking_page_visits.client_phone),page_name=excluded.page_name,
      source_kind=excluded.source_kind,source_label=excluded.source_label,
      first_source_label=coalesce(booking_page_visits.first_source_label,excluded.first_source_label),last_seen_at=excluded.last_seen_at;
    if not v_was_present then v_inserted:=true; end if;
    delete from public.booking_page_visits visit where visit.performer_id=v_performer and visit.last_seen_at<pg_catalog.now()-interval '7 days';
  end loop;
  return v_inserted;
end;
$$;

revoke all on function public.upsert_public_booking_presence(text,uuid,text,text,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.upsert_public_booking_presence(text,uuid,text,text,text,text,text,text) to anon,authenticated,service_role;

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
    where membership.organization_id=v_organization and membership.active and membership.role='owner'
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_performer::text,74));
    if not exists(select 1 from public.booking_page_visits visit where visit.performer_id=v_performer and visit.created_at>=pg_catalog.now()-interval '2 minutes') then
      insert into public.booking_page_visits(organization_id,performer_id,last_seen_at) values(v_organization,v_performer,pg_catalog.now()); v_inserted:=true;
    end if;
  end loop;
  return v_inserted;
end;
$$;
revoke all on function public.register_public_booking_visit(text) from public,anon,authenticated,service_role;
grant execute on function public.register_public_booking_visit(text) to anon,authenticated,service_role;
commit;
