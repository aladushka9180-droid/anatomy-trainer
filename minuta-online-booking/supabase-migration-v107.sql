\set ON_ERROR_STOP on

begin;
set local lock_timeout='5s';
set local statement_timeout='10min';
set local search_path=public,extensions,pg_catalog;

do $$ begin
  if to_regclass('public.organizations') is null or to_regclass('public.organization_memberships') is null
     or to_regclass('public.bookings') is null or to_regclass('public.services') is null
     or to_regclass('public.booking_outcomes') is null or to_regprocedure('public.get_minuta_schedule_role(uuid)') is null then
    raise exception using errcode='P0001',message='v107_requires_organizations_bookings_and_outcomes';
  end if;
end $$;

create table if not exists public.booking_funnel_events(
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid not null,
  event_name text not null check(event_name in ('page_opened','service_selected','slots_viewed','details_started','booking_created')),
  occurred_at timestamptz not null default now(),
  booking_id uuid references public.bookings(id) on delete set null,
  service_id uuid references public.services(id) on delete set null,
  source_kind text not null default 'direct' check(char_length(source_kind) between 1 and 24),
  utm_source text check(utm_source is null or char_length(utm_source) between 1 and 80),
  utm_medium text check(utm_medium is null or char_length(utm_medium) between 1 and 80),
  utm_campaign text check(utm_campaign is null or char_length(utm_campaign) between 1 and 120),
  utm_content text check(utm_content is null or char_length(utm_content) between 1 and 120),
  utm_term text check(utm_term is null or char_length(utm_term) between 1 and 120),
  referrer_host text check(referrer_host is null or char_length(referrer_host) between 1 and 120),
  unique(organization_id,session_id,event_name)
);
create index if not exists booking_funnel_events_org_time_idx on public.booking_funnel_events(organization_id,occurred_at desc);
create index if not exists booking_funnel_events_booking_idx on public.booking_funnel_events(booking_id) where booking_id is not null;
alter table public.booking_funnel_events enable row level security;
revoke all on table public.booking_funnel_events from public,anon,authenticated;
revoke all on sequence public.booking_funnel_events_id_seq from public,anon,authenticated;
comment on table public.booking_funnel_events is 'Privacy-minimized booking funnel: no names, phones, IP addresses or device fingerprints; retained for 400 days.';

create or replace function public.track_public_booking_funnel_event(
  p_slug text,p_session uuid,p_event text,p_service uuid default null,p_manage_token uuid default null,
  p_source_kind text default 'direct',p_utm_source text default null,p_utm_medium text default null,
  p_utm_campaign text default null,p_utm_content text default null,p_utm_term text default null,p_referrer_host text default null
)
returns boolean language plpgsql security definer set search_path to '' as $$
declare v_org uuid; v_booking uuid; v_booking_service uuid; v_daily integer; v_source text;
begin
  if p_slug is null or p_slug!~'^[a-z0-9][a-z0-9-]{2,62}$' or p_session is null
     or p_event not in ('page_opened','service_selected','slots_viewed','details_started','booking_created') then return false; end if;
  select organization.id into v_org from public.organizations organization
  where organization.public_slug=p_slug and organization.status='active' and organization.public_booking_enabled limit 1;
  if v_org is null then return false; end if;
  if p_service is not null and not exists(select 1 from public.services service where service.id=p_service and service.organization_id=v_org) then return false; end if;
  if p_event='booking_created' then
    if p_manage_token is null then return false; end if;
    select booking.id,booking.service_id into v_booking,v_booking_service from public.bookings booking
    where booking.manage_token=p_manage_token and (booking.organization_id=v_org or (booking.organization_id is null and exists(
      select 1 from public.organization_memberships membership where membership.organization_id=v_org and membership.user_id=booking.performer_id and membership.active))) limit 1;
    if v_booking is null then return false; end if;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_org::text||':'||current_date::text,107));
  delete from public.booking_funnel_events event where event.organization_id=v_org and event.occurred_at<pg_catalog.now()-interval '400 days';
  if not exists(select 1 from public.booking_funnel_events event where event.organization_id=v_org and event.session_id=p_session and event.event_name=p_event) then
    select count(*) into v_daily from public.booking_funnel_events event where event.organization_id=v_org and event.occurred_at>=date_trunc('day',pg_catalog.now());
    if v_daily>=20000 then return false; end if;
  end if;
  v_source:=coalesce(nullif(pg_catalog.left(pg_catalog.btrim(p_source_kind),24),''),'direct');
  insert into public.booking_funnel_events(organization_id,session_id,event_name,booking_id,service_id,source_kind,utm_source,utm_medium,utm_campaign,utm_content,utm_term,referrer_host)
  values(v_org,p_session,p_event,v_booking,coalesce(v_booking_service,p_service),v_source,
    nullif(pg_catalog.left(pg_catalog.btrim(p_utm_source),80),''),nullif(pg_catalog.left(pg_catalog.btrim(p_utm_medium),80),''),
    nullif(pg_catalog.left(pg_catalog.btrim(p_utm_campaign),120),''),nullif(pg_catalog.left(pg_catalog.btrim(p_utm_content),120),''),
    nullif(pg_catalog.left(pg_catalog.btrim(p_utm_term),120),''),nullif(pg_catalog.left(pg_catalog.btrim(p_referrer_host),120),''))
  on conflict(organization_id,session_id,event_name) do update set
    booking_id=coalesce(excluded.booking_id,public.booking_funnel_events.booking_id),service_id=coalesce(excluded.service_id,public.booking_funnel_events.service_id);
  return true;
end; $$;
revoke all on function public.track_public_booking_funnel_event(text,uuid,text,uuid,uuid,text,text,text,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.track_public_booking_funnel_event(text,uuid,text,uuid,uuid,text,text,text,text,text,text,text) to anon,authenticated,service_role;

create or replace function public.get_minuta_utm_funnel_v107(p_organization uuid,p_start date,p_end date)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_role text; v_result jsonb;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication_required'; end if;
  if p_organization is null or p_start is null or p_end is null or p_end<p_start or p_end-p_start>3660 then raise exception using errcode='22023',message='invalid_utm_funnel_range'; end if;
  v_role:=public.get_minuta_schedule_role(p_organization);
  if coalesce(v_role,'') not in ('owner','admin') then raise exception using errcode='42501',message='utm_funnel_access_denied'; end if;
  with session_steps as(
    select event.session_id,
      bool_or(event.event_name='page_opened') opened,bool_or(event.event_name='service_selected') service_selected,
      bool_or(event.event_name='slots_viewed') slots_viewed,bool_or(event.event_name='details_started') details_started,
      bool_or(event.event_name='booking_created') booked,
      (array_agg(event.booking_id order by event.occurred_at desc) filter(where event.booking_id is not null))[1] booking_id,
      coalesce(max(event.source_kind) filter(where event.event_name='page_opened'),max(event.source_kind),'direct') source_kind,
      coalesce(max(event.utm_source) filter(where event.event_name='page_opened'),max(event.utm_source)) utm_source,
      coalesce(max(event.utm_medium) filter(where event.event_name='page_opened'),max(event.utm_medium)) utm_medium,
      coalesce(max(event.utm_campaign) filter(where event.event_name='page_opened'),max(event.utm_campaign)) utm_campaign
    from public.booking_funnel_events event where event.organization_id=p_organization
      and pg_catalog.timezone('Europe/Samara',event.occurred_at)::date between p_start and p_end group by event.session_id
  ), enriched as(
    select steps.*,booking.status booking_status,booking.payment_status,outcome.visit_status,outcome.amount_rub
    from session_steps steps left join public.bookings booking on booking.id=steps.booking_id left join public.booking_outcomes outcome on outcome.booking_id=booking.id
  ), grouped as(
    select source_kind,utm_source,utm_medium,utm_campaign,
      count(*) filter(where opened)::integer visitors,count(*) filter(where service_selected)::integer service_selected,
      count(*) filter(where slots_viewed)::integer slots_viewed,count(*) filter(where details_started)::integer details_started,
      count(*) filter(where booked)::integer bookings,
      count(*) filter(where booked and booking_status<>'cancelled' and visit_status='completed')::integer completed,
      count(*) filter(where booked and booking_status='cancelled')::integer cancelled,
      count(*) filter(where booked and booking_status<>'cancelled' and visit_status='no_show')::integer no_show,
      count(*) filter(where booked and (payment_status='paid' or coalesce(amount_rub,0)>0))::integer paid,
      coalesce(sum(case when booked and booking_status<>'cancelled' and visit_status='completed' then coalesce(amount_rub,0) else 0 end),0)::bigint revenue_rub
    from enriched group by source_kind,utm_source,utm_medium,utm_campaign
  ), totals as(
    select coalesce(sum(visitors),0)::integer visitors,coalesce(sum(service_selected),0)::integer service_selected,
      coalesce(sum(slots_viewed),0)::integer slots_viewed,coalesce(sum(details_started),0)::integer details_started,
      coalesce(sum(bookings),0)::integer bookings,coalesce(sum(completed),0)::integer completed,
      coalesce(sum(cancelled),0)::integer cancelled,coalesce(sum(no_show),0)::integer no_show,
      coalesce(sum(paid),0)::integer paid,coalesce(sum(revenue_rub),0)::bigint revenue_rub from grouped
  )
  select jsonb_build_object('totals',(select to_jsonb(totals) from totals),'rows',coalesce((select jsonb_agg(to_jsonb(grouped) order by bookings desc,visitors desc) from grouped),'[]'::jsonb)) into v_result;
  return coalesce(v_result,jsonb_build_object('totals',jsonb_build_object(),'rows','[]'::jsonb));
end; $$;
revoke all on function public.get_minuta_utm_funnel_v107(uuid,date,date) from public,anon,authenticated,service_role;
grant execute on function public.get_minuta_utm_funnel_v107(uuid,date,date) to authenticated,service_role;

do $$ begin
  if to_regclass('public.booking_funnel_events') is null
     or not coalesce((select relrowsecurity from pg_class where oid='public.booking_funnel_events'::regclass),false)
     or to_regprocedure('public.track_public_booking_funnel_event(text,uuid,text,uuid,uuid,text,text,text,text,text,text,text)') is null
     or to_regprocedure('public.get_minuta_utm_funnel_v107(uuid,date,date)') is null
     or not has_function_privilege('anon','public.track_public_booking_funnel_event(text,uuid,text,uuid,uuid,text,text,text,text,text,text,text)','EXECUTE')
     or has_table_privilege('anon','public.booking_funnel_events','SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated','public.booking_funnel_events','INSERT,UPDATE,DELETE')
     or not has_function_privilege('authenticated','public.get_minuta_utm_funnel_v107(uuid,date,date)','EXECUTE')
     or has_function_privilege('anon','public.get_minuta_utm_funnel_v107(uuid,date,date)','EXECUTE') then
    raise exception using errcode='P0001',message='v107_postcondition_failed';
  end if;
end $$;
notify pgrst,'reload schema';
commit;
