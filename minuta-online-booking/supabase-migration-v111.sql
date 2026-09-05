begin;

-- Separate scoped requests keep legacy waitlist RPCs and their uniqueness unchanged.
do $$ begin
  if to_regprocedure('public.get_public_minuta_catalog_v4(text)') is null
    or to_regprocedure('public.has_organization_role(uuid,text[])') is null then
    raise exception 'waitlist_v111_prerequisites_missing';
  end if;
end $$;

create table if not exists public.organization_waitlist_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  location_id uuid not null,
  performer_id uuid not null references public.performer_profiles(id),
  service_id uuid not null references public.services(id),
  request_code text not null unique,
  manage_token uuid not null default gen_random_uuid() unique,
  client_name text not null check (char_length(client_name) between 2 and 80),
  client_phone text not null check (client_phone ~ '^[0-9]{11}$'),
  desired_date date not null,
  time_period text not null check (time_period in ('any','morning','day','evening')),
  status text not null default 'waiting' check (status in ('waiting','contacted','booked','cancelled','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (location_id, organization_id) references public.locations(id, organization_id)
);
create unique index if not exists organization_waitlist_active_client_idx
  on public.organization_waitlist_requests(organization_id,location_id,service_id,desired_date,client_phone)
  where status in ('waiting','contacted');
create index if not exists organization_waitlist_inbox_idx
  on public.organization_waitlist_requests(organization_id,status,desired_date);
alter table public.organization_waitlist_requests enable row level security;
revoke all on public.organization_waitlist_requests from public,anon,authenticated;
grant select on public.organization_waitlist_requests to authenticated;
drop policy if exists organization_waitlist_read on public.organization_waitlist_requests;
create policy organization_waitlist_read on public.organization_waitlist_requests for select to authenticated
  using (public.has_organization_role(organization_id,array['owner','admin']::text[])
    or (performer_id=(select auth.uid()) and public.is_organization_member(organization_id)));

create or replace function public.join_minuta_waitlist_v111(
  p_slug text, p_location uuid, p_service uuid, p_date date,
  p_time_period text, p_client_name text, p_client_phone text
) returns table(request_code text,manage_token uuid)
language plpgsql security definer set search_path='pg_catalog','extensions' as $$
declare
  v_catalog jsonb;
  v_service jsonb;
  v_org uuid;
  v_performer uuid;
  v_name text := btrim(coalesce(p_client_name,''));
  v_phone text := regexp_replace(coalesce(p_client_phone,''),'\D','','g');
  v_period text := lower(coalesce(p_time_period,'any'));
  v_existing public.organization_waitlist_requests%rowtype;
  v_today date := timezone('Europe/Samara',now())::date;
begin
  if char_length(v_name) not between 2 and 80 or v_phone !~ '^[0-9]{11}$' then
    raise exception 'invalid_client_data';
  end if;
  if p_date is null or p_date<v_today or p_date>v_today+180 then raise exception 'invalid_waitlist_date'; end if;
  if v_period not in ('any','morning','day','evening') then raise exception 'invalid_time_period'; end if;
  -- Reuse the public catalog's organization/membership/resource/location boundary.
  -- Do not require current free slots: requesting an unavailable day is the purpose.
  v_catalog := public.get_public_minuta_catalog_v4(p_slug);
  v_org := (v_catalog->'organization'->>'id')::uuid;
  if v_org is null or p_location is null or not exists (
    select 1 from jsonb_array_elements(v_catalog->'locations') l where l->>'id'=p_location::text
  ) then raise exception 'waitlist_location_unavailable'; end if;
  select s into v_service from jsonb_array_elements(v_catalog->'services') s
    where s->>'id'=p_service::text and (s->'location_ids') ? p_location::text;
  v_performer := (v_service->>'performer_id')::uuid;
  if v_performer is null then raise exception 'service_unavailable'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_org::text||p_location::text||p_service::text||p_date::text||v_phone,0));
  select r.* into v_existing from public.organization_waitlist_requests r
    where r.organization_id=v_org and r.location_id=p_location and r.service_id=p_service
      and r.desired_date=p_date and r.client_phone=v_phone and r.status in ('waiting','contacted');
  if v_existing.id is not null then
    update public.organization_waitlist_requests set client_name=v_name,time_period=v_period,updated_at=now()
      where id=v_existing.id;
    return query select v_existing.request_code,v_existing.manage_token;
    return;
  end if;
  insert into public.organization_waitlist_requests(organization_id,location_id,performer_id,service_id,
    request_code,client_name,client_phone,desired_date,time_period)
    values(v_org,p_location,v_performer,p_service,'WAIT-'||upper(encode(gen_random_bytes(8),'hex')),v_name,v_phone,p_date,v_period)
    returning * into v_existing;
  return query select v_existing.request_code,v_existing.manage_token;
end $$;
revoke all on function public.join_minuta_waitlist_v111(text,uuid,uuid,date,text,text,text) from public,anon,authenticated;
grant execute on function public.join_minuta_waitlist_v111(text,uuid,uuid,date,text,text,text) to anon,authenticated;

create or replace function public.get_minuta_waitlist_request_v111(p_token uuid)
returns table(request_code text,service_name text,performer_name text,desired_date date,time_period text,status text,
  organization_slug text,location_name text,location_id uuid,service_id uuid)
language sql stable security definer set search_path='' as $$
  select r.request_code,s.name,p.display_name,r.desired_date,r.time_period,r.status,
    o.public_slug,l.name,r.location_id,r.service_id
  from public.organization_waitlist_requests r join public.services s on s.id=r.service_id
    join public.performer_profiles p on p.id=r.performer_id
    join public.organizations o on o.id=r.organization_id join public.locations l on l.id=r.location_id
  where r.manage_token=p_token;
$$;
revoke all on function public.get_minuta_waitlist_request_v111(uuid) from public,anon,authenticated;
grant execute on function public.get_minuta_waitlist_request_v111(uuid) to anon,authenticated;

create or replace function public.cancel_minuta_waitlist_request_v111(p_token uuid)
returns text language plpgsql security definer set search_path='' as $$
declare v_status text;
begin
  update public.organization_waitlist_requests set status='cancelled',updated_at=now()
    where manage_token=p_token and status in ('waiting','contacted') returning status into v_status;
  if v_status is null then select status into v_status from public.organization_waitlist_requests where manage_token=p_token; end if;
  if v_status is null then raise exception 'waitlist_request_unavailable'; end if;
  return v_status;
end $$;
revoke all on function public.cancel_minuta_waitlist_request_v111(uuid) from public,anon,authenticated;
grant execute on function public.cancel_minuta_waitlist_request_v111(uuid) to anon,authenticated;

create or replace function public.set_minuta_waitlist_status_v111(p_request uuid,p_status text)
returns text language plpgsql security definer set search_path='' as $$
begin
  if p_status not in ('waiting','contacted','booked','cancelled','closed') then raise exception 'invalid_waitlist_status'; end if;
  update public.organization_waitlist_requests r set status=p_status,updated_at=now() where r.id=p_request
    and (public.has_organization_role(r.organization_id,array['owner','admin']::text[])
      or (r.performer_id=auth.uid() and public.is_organization_member(r.organization_id)));
  if not found then raise exception 'waitlist_request_unavailable'; end if;
  return p_status;
end $$;
revoke all on function public.set_minuta_waitlist_status_v111(uuid,text) from public,anon,authenticated;
grant execute on function public.set_minuta_waitlist_status_v111(uuid,text) to authenticated;

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
    and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
      and schemaname='public' and tablename='organization_waitlist_requests') then
    alter publication supabase_realtime add table public.organization_waitlist_requests;
  end if;
end $$;
notify pgrst,'reload schema';
commit;
