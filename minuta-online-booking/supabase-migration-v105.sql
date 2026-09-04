-- v105: owner-only live booking-page presence, verified known-client identity and traffic attribution.
begin;
set local search_path = public, extensions, pg_catalog;

do $$ begin
  if to_regclass('public.booking_page_visits') is null
     or to_regclass('public.booking_policies') is null
     or to_regclass('public.organization_memberships') is null
     or to_regclass('public.bookings') is null
     or to_regprocedure('public.normalize_client_phone(text)') is null
     or to_regprocedure('public.get_minuta_schedule_role(uuid)') is null
     or to_regprocedure('public.register_public_booking_visit(text)') is null then
    raise exception using errcode='P0001',message='v105_requires_visitor_presence_v74_and_phone_identity_v54';
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

create unique index if not exists booking_page_visits_owner_session_idx
  on public.booking_page_visits(organization_id,performer_id,session_id)
  where session_id is not null;
create index if not exists booking_page_visits_owner_presence_idx
  on public.booking_page_visits(organization_id,performer_id,last_seen_at desc);
create index if not exists bookings_organization_phone_v105_idx
  on public.bookings(organization_id,public.normalize_client_phone(client_phone),created_at desc,id desc)
  where client_phone is not null;

do $$
declare
  v_session_index text;
  v_presence_index text;
  v_phone_index text;
begin
  if not exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='booking_page_visits' and column_name='session_id' and data_type='uuid' and is_nullable='YES'
  ) or not exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='booking_page_visits' and column_name='last_seen_at' and data_type='timestamp with time zone' and is_nullable='NO' and column_default='now()'
  ) or not exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='booking_page_visits' and column_name='client_name' and data_type='text' and is_nullable='YES'
  ) or not exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='booking_page_visits' and column_name='client_phone' and data_type='text' and is_nullable='YES'
  ) or not exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='booking_page_visits' and column_name='page_name' and data_type='text' and is_nullable='NO' and column_default='''services''::text'
  ) or not exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='booking_page_visits' and column_name='source_kind' and data_type='text' and is_nullable='NO' and column_default='''direct''::text'
  ) or not exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='booking_page_visits' and column_name='source_label' and data_type='text' and is_nullable='YES'
  ) or not exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='booking_page_visits' and column_name='first_source_label' and data_type='text' and is_nullable='YES'
  ) or (select count(*) from information_schema.columns
        where table_schema='public' and table_name='booking_page_visits'
          and column_name in ('session_id','client_name','client_phone','page_name','source_kind','source_label','first_source_label','last_seen_at'))<>8 then
    raise exception using errcode='P0001',message='v105_presence_columns_mismatch';
  end if;

  select pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.pg_get_indexdef(indexrelid)),'\s','','g')
  into v_session_index from pg_catalog.pg_index where indexrelid=to_regclass('public.booking_page_visits_owner_session_idx');
  select pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.pg_get_indexdef(indexrelid)),'\s','','g')
  into v_presence_index from pg_catalog.pg_index where indexrelid=to_regclass('public.booking_page_visits_owner_presence_idx');
  select pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.pg_get_indexdef(indexrelid)),'\s','','g')
  into v_phone_index from pg_catalog.pg_index where indexrelid=to_regclass('public.bookings_organization_phone_v105_idx');
  if v_session_index is distinct from 'createuniqueindexbooking_page_visits_owner_session_idxonpublic.booking_page_visitsusingbtree(organization_id,performer_id,session_id)where(session_idisnotnull)'
     or v_presence_index is distinct from 'createindexbooking_page_visits_owner_presence_idxonpublic.booking_page_visitsusingbtree(organization_id,performer_id,last_seen_atdesc)'
     or v_phone_index is distinct from 'createindexbookings_organization_phone_v105_idxonpublic.bookingsusingbtree(organization_id,normalize_client_phone(client_phone),created_atdesc,iddesc)where(client_phoneisnotnull)' then
    raise exception using errcode='P0001',message='v105_index_definition_mismatch';
  end if;
end $$;

drop policy if exists booking_page_visits_owner_read on public.booking_page_visits;
create policy booking_page_visits_owner_read on public.booking_page_visits for select to authenticated
  using(performer_id=(select auth.uid()) and public.get_minuta_schedule_role(organization_id)='owner');

create or replace function public.upsert_public_booking_presence(
  p_slug text,p_session uuid,p_page text default 'services',p_source_kind text default 'direct',
  p_source_label text default null,p_first_source_label text default null,p_client_name text default null,p_client_phone text default null
)
returns boolean language plpgsql security definer set search_path to '' as $$
declare
  v_organization uuid;
  v_performer uuid;
  v_normalized_phone text;
  v_submitted_name text;
  v_client_name text;
  v_client_phone text;
  v_existing_seen_at timestamptz;
  v_recent_new_count integer;
  v_retained_count integer;
  v_inserted boolean:=false;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9][a-z0-9-]{2,62}$' or p_session is null then return false; end if;
  select organization.id into v_organization from public.organizations organization
  where organization.public_slug=p_slug and organization.status='active' and organization.public_booking_enabled limit 1;
  if v_organization is null then return false; end if;

  v_normalized_phone:=public.normalize_client_phone(p_client_phone);
  v_submitted_name:=pg_catalog.btrim(coalesce(p_client_name,''));
  if pg_catalog.length(v_submitted_name) between 2 and 80 and v_normalized_phone ~ '^7[0-9]{10}$' then
    select pg_catalog.left(booking.client_name,80),pg_catalog.left(booking.client_phone,32)
    into v_client_name,v_client_phone
    from public.bookings booking
    where booking.organization_id=v_organization
      and booking.client_phone is not null
      and public.normalize_client_phone(booking.client_phone)=v_normalized_phone
      and pg_catalog.lower(pg_catalog.btrim(booking.client_name))=pg_catalog.lower(v_submitted_name)
    order by booking.created_at desc,booking.id desc limit 1;
  end if;

  for v_performer in
    select membership.user_id from public.organization_memberships membership
    join public.booking_policies policy on policy.performer_id=membership.user_id and policy.visitor_notifications_enabled
    where membership.organization_id=v_organization and membership.active and membership.role='owner'
    order by membership.user_id
  loop
    -- One organization/owner lock serializes the quota check even when an attacker changes session UUIDs.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_organization::text||':'||v_performer::text,105));
    delete from public.booking_page_visits visit
    where visit.organization_id=v_organization and visit.performer_id=v_performer
      and visit.last_seen_at<pg_catalog.now()-interval '7 days';

    select visit.last_seen_at into v_existing_seen_at
    from public.booking_page_visits visit
    where visit.organization_id=v_organization and visit.performer_id=v_performer and visit.session_id=p_session
    for update;

    if found then
      -- Heartbeats faster than the public client cadence are ignored. A first verified identity may still be attached immediately.
      if v_existing_seen_at<=pg_catalog.now()-interval '10 seconds' or (v_client_name is not null and exists(
        select 1 from public.booking_page_visits visit
        where visit.organization_id=v_organization and visit.performer_id=v_performer and visit.session_id=p_session
          and visit.client_name is null
      )) then
        update public.booking_page_visits visit set
          client_name=coalesce(v_client_name,visit.client_name),
          client_phone=coalesce(v_client_phone,visit.client_phone),
          page_name=case when p_page in ('services','date','details','success') then p_page else 'services' end,
          source_kind=case when p_source_kind in ('direct','search','social','referral','campaign','qr') then p_source_kind else 'direct' end,
          source_label=pg_catalog.left(nullif(pg_catalog.btrim(p_source_label),''),120),
          first_source_label=coalesce(visit.first_source_label,pg_catalog.left(nullif(pg_catalog.btrim(p_first_source_label),''),120)),
          last_seen_at=pg_catalog.now()
        where visit.organization_id=v_organization and visit.performer_id=v_performer and visit.session_id=p_session;
      end if;
      continue;
    end if;

    select count(*) into v_recent_new_count from public.booking_page_visits visit
    where visit.organization_id=v_organization and visit.performer_id=v_performer
      and visit.session_id is not null and visit.created_at>=pg_catalog.now()-interval '1 minute';
    select count(*) into v_retained_count from public.booking_page_visits visit
    where visit.organization_id=v_organization and visit.performer_id=v_performer and visit.session_id is not null;
    if v_recent_new_count>=60 or v_retained_count>=2500 then continue; end if;

    insert into public.booking_page_visits(
      organization_id,performer_id,session_id,client_name,client_phone,page_name,source_kind,source_label,first_source_label,last_seen_at
    ) values(
      v_organization,v_performer,p_session,v_client_name,v_client_phone,
      case when p_page in ('services','date','details','success') then p_page else 'services' end,
      case when p_source_kind in ('direct','search','social','referral','campaign','qr') then p_source_kind else 'direct' end,
      pg_catalog.left(nullif(pg_catalog.btrim(p_source_label),''),120),
      pg_catalog.left(nullif(pg_catalog.btrim(p_first_source_label),''),120),pg_catalog.now()
    );
    v_inserted:=true;
  end loop;
  return v_inserted;
end;
$$;

revoke all on function public.upsert_public_booking_presence(text,uuid,text,text,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.upsert_public_booking_presence(text,uuid,text,text,text,text,text,text) to anon,authenticated,service_role;

create or replace function public.register_public_booking_visit(p_slug text)
returns boolean language plpgsql security definer set search_path to '' as $$
declare v_organization uuid; v_performer uuid; v_inserted boolean:=false; v_retained_count integer;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9][a-z0-9-]{2,62}$' then return false; end if;
  select organization.id into v_organization from public.organizations organization
  where organization.public_slug=p_slug and organization.status='active' and organization.public_booking_enabled limit 1;
  if v_organization is null then return false; end if;
  for v_performer in select membership.user_id from public.organization_memberships membership
    join public.booking_policies policy on policy.performer_id=membership.user_id and policy.visitor_notifications_enabled
    where membership.organization_id=v_organization and membership.active and membership.role='owner'
    order by membership.user_id
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_organization::text||':'||v_performer::text,105));
    delete from public.booking_page_visits visit where visit.organization_id=v_organization and visit.performer_id=v_performer and visit.last_seen_at<pg_catalog.now()-interval '7 days';
    select count(*) into v_retained_count from public.booking_page_visits visit
    where visit.organization_id=v_organization and visit.performer_id=v_performer;
    if v_retained_count<2500 and not exists(
      select 1 from public.booking_page_visits visit
      where visit.organization_id=v_organization and visit.performer_id=v_performer
        and visit.created_at>=pg_catalog.now()-interval '2 minutes'
    ) then
      insert into public.booking_page_visits(organization_id,performer_id,last_seen_at) values(v_organization,v_performer,pg_catalog.now());
      v_inserted:=true;
    end if;
  end loop;
  return v_inserted;
end;
$$;
revoke all on function public.register_public_booking_visit(text) from public,anon,authenticated,service_role;
grant execute on function public.register_public_booking_visit(text) to anon,authenticated,service_role;
commit;
