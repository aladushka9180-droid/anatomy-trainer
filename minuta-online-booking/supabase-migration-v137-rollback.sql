-- Roll back only the v137 function repair to the exact v107 behavior.
begin;
set local lock_timeout='10s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $guard$
begin
  if to_regclass('public.booking_funnel_events') is null
     or to_regprocedure('public.track_public_booking_funnel_event(text,uuid,text,uuid,uuid,text,text,text,text,text,text,text)') is null then
    raise exception 'v137_rollback_prerequisites_missing';
  end if;
end
$guard$;

create or replace function public.track_public_booking_funnel_event(
  p_slug text,p_session uuid,p_event text,p_service uuid default null,p_manage_token uuid default null,
  p_source_kind text default 'direct',p_utm_source text default null,p_utm_medium text default null,
  p_utm_campaign text default null,p_utm_content text default null,p_utm_term text default null,p_referrer_host text default null
)
returns boolean language plpgsql security definer set search_path to '' as $function$
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
end
$function$;

revoke all on function public.track_public_booking_funnel_event(text,uuid,text,uuid,uuid,text,text,text,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.track_public_booking_funnel_event(text,uuid,text,uuid,uuid,text,text,text,text,text,text,text) to anon,authenticated,service_role;

notify pgrst,'reload schema';
commit;
