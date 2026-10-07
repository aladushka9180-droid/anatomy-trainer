-- Additive candidate. Apply only through the release owner after restore proof.
begin;
set local lock_timeout='5s';
set local statement_timeout='2min';
create schema if not exists minuta_offer_private;
revoke all on schema minuta_offer_private from public,anon,authenticated,service_role;

create table if not exists public.service_booking_offers (
  id uuid primary key default gen_random_uuid(),
  performer_id uuid not null references public.performer_profiles(id) on delete cascade,
  primary_service_ids uuid[] not null check(cardinality(primary_service_ids) between 1 and 50),
  addon_service_id uuid not null references public.services(id) on delete cascade,
  benefit_text text not null default '' check(char_length(benefit_text)<=160),
  discount_kind text not null default 'none' check(discount_kind in('none','percent','rubles')),
  discount_value numeric not null default 0 check(discount_value>=0),
  additional_minutes integer not null check(additional_minutes between 0 and 480),
  enabled boolean not null default false,
  priority integer not null default 0 check(priority between 0 and 99),
  revision integer not null default 1 check(revision>0),
  updated_at timestamptz not null default now()
);
alter table public.service_booking_offers enable row level security;
revoke all on public.service_booking_offers from public,anon,authenticated,service_role;
grant select on public.service_booking_offers to authenticated;
drop policy if exists service_offers_owner_read on public.service_booking_offers;
create policy service_offers_owner_read on public.service_booking_offers for select to authenticated
using(performer_id=(select auth.uid()));

create table if not exists minuta_offer_private.booking_requests (
  request_id uuid primary key,
  booking_id uuid not null unique references public.bookings(id) on delete cascade,
  request_fingerprint text not null,
  selections jsonb not null,
  snapshot jsonb not null,
  acknowledgement jsonb not null,
  created_at timestamptz not null default now()
);
alter table minuta_offer_private.booking_requests enable row level security;
revoke all on minuta_offer_private.booking_requests from public,anon,authenticated,service_role;

create or replace function public.get_minuta_service_offers(p_performer uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
  if auth.uid() is null or auth.uid() is distinct from p_performer then
    raise exception 'service_offer_access_denied' using errcode='42501';
  end if;
  return jsonb_build_object('offers',coalesce((select jsonb_agg(to_jsonb(o) order by o.priority,o.id)
    from public.service_booking_offers o where o.performer_id=p_performer),'[]'::jsonb));
end $$;

create or replace function public.save_minuta_service_offer(p_performer uuid,p_offer jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_id uuid; v_old public.service_booking_offers%rowtype; v_row public.service_booking_offers%rowtype;
  v_primary uuid[]; v_addon public.services%rowtype; v_kind text; v_discount numeric;
  v_enabled boolean; v_minutes integer; v_revision integer; v_priority integer;
begin
  if auth.uid() is null or auth.uid() is distinct from p_performer then
    raise exception 'service_offer_access_denied' using errcode='42501';
  end if;
  if jsonb_typeof(p_offer) is distinct from 'object' then raise exception 'service_offer_invalid'; end if;
  v_id:=nullif(p_offer->>'id','')::uuid;
  v_revision:=(p_offer->>'revision')::integer;
  v_enabled:=(p_offer->>'enabled')::boolean;
  if v_enabled is null or v_revision is null then raise exception 'service_offer_invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended('service-offers:'||p_performer::text,0));
  if v_id is not null then
    select * into v_old from public.service_booking_offers where id=v_id and performer_id=p_performer for update;
    if not found then raise exception 'service_offer_access_denied' using errcode='42501'; end if;
    if v_old.revision<>v_revision then raise exception 'service_offer_revision_conflict'; end if;
    -- Turning off an archived offer remains possible without restoring services.
    if not v_enabled then
      update public.service_booking_offers set enabled=false,revision=revision+1,updated_at=now()
      where id=v_id returning * into v_row;
      return jsonb_build_object('offer',to_jsonb(v_row));
    end if;
  elsif v_revision<>0 then raise exception 'service_offer_revision_conflict'; end if;
  if jsonb_typeof(p_offer->'primary_service_ids') is distinct from 'array' then raise exception 'service_offer_invalid'; end if;
  select array_agg(distinct x::uuid order by x::uuid) into v_primary from jsonb_array_elements_text(p_offer->'primary_service_ids') x;
  v_kind:=p_offer->>'discount_kind'; v_discount:=(p_offer->>'discount_value')::numeric;
  v_minutes:=(p_offer->>'additional_minutes')::integer; v_priority:=(p_offer->>'priority')::integer;
  select * into v_addon from public.services where id=(p_offer->>'addon_service_id')::uuid
    and performer_id=p_performer and active for share;
  if not found or v_addon.duration_minutes=1 then raise exception 'service_offer_service_unavailable'; end if;
  if cardinality(v_primary) is null or cardinality(v_primary) not between 1 and 50
     or v_addon.id=any(v_primary) or v_minutes is null or v_minutes not between 0 and 480
     or v_priority is null or v_priority not between 0 and 99
     or v_kind is null or v_kind not in('none','percent','rubles')
     or v_discount is null or v_discount<0
     or (v_kind='none' and v_discount<>0) or (v_kind='percent' and v_discount>100)
     or (v_kind='rubles' and (v_discount>v_addon.price_rub or v_discount<>trunc(v_discount)))
     or char_length(btrim(coalesce(p_offer->>'benefit_text',''))) not between 1 and 160
     or exists(select 1 from unnest(v_primary) p where not exists(select 1 from public.services s
       where s.id=p and s.performer_id=p_performer and s.active and s.duration_minutes<>1))
  then raise exception 'service_offer_invalid' using errcode='22023'; end if;
  if v_enabled and exists(select 1 from unnest(v_primary) p where
    (select count(*) from public.service_booking_offers o where o.performer_id=p_performer and o.enabled
      and p=any(o.primary_service_ids) and o.id is distinct from v_id)>=3
    or exists(select 1 from public.service_booking_offers o where o.performer_id=p_performer and o.enabled
      and p=any(o.primary_service_ids) and o.addon_service_id=v_addon.id and o.id is distinct from v_id))
  then raise exception 'service_offer_limit'; end if;
  insert into public.service_booking_offers(id,performer_id,primary_service_ids,addon_service_id,benefit_text,
    discount_kind,discount_value,additional_minutes,enabled,priority,revision)
  values(coalesce(v_id,gen_random_uuid()),p_performer,v_primary,v_addon.id,btrim(coalesce(p_offer->>'benefit_text','')),
    v_kind,v_discount,v_minutes,v_enabled,v_priority,coalesce(v_old.revision,0)+1)
  on conflict(id) do update set primary_service_ids=excluded.primary_service_ids,addon_service_id=excluded.addon_service_id,
    benefit_text=excluded.benefit_text,discount_kind=excluded.discount_kind,discount_value=excluded.discount_value,
    additional_minutes=excluded.additional_minutes,enabled=excluded.enabled,priority=excluded.priority,
    revision=excluded.revision,updated_at=now() returning * into v_row;
  return jsonb_build_object('offer',to_jsonb(v_row));
end $$;
revoke all on function public.get_minuta_service_offers(uuid),public.save_minuta_service_offer(uuid,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.get_minuta_service_offers(uuid),public.save_minuta_service_offer(uuid,jsonb) to authenticated;

create or replace function minuta_offer_private.context(p_slug text,p_location uuid,p_service uuid)
returns public.services language plpgsql stable security definer set search_path='' as $$
declare v_catalog jsonb; v_service public.services%rowtype;
begin
  v_catalog:=public.get_public_minuta_catalog_v5(p_slug);
  if not exists(select 1 from jsonb_array_elements(v_catalog->'locations') l where l->>'id'=p_location::text)
     or not exists(select 1 from jsonb_array_elements(v_catalog->'services') s
       where s->>'id'=p_service::text and s->'location_ids' ? p_location::text)
  then raise exception 'service_unavailable'; end if;
  select * into v_service from public.services where id=p_service and active;
  if not found then raise exception 'service_unavailable'; end if;
  return v_service;
end $$;

create or replace function public.get_public_minuta_service_offers(p_slug text,p_location uuid,p_service uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_service public.services%rowtype; v_catalog jsonb;
begin
  v_service:=minuta_offer_private.context(p_slug,p_location,p_service);
  v_catalog:=public.get_public_minuta_catalog_v5(p_slug);
  return jsonb_build_object('offers',coalesce((select jsonb_agg(jsonb_build_object(
    'id',o.id,'revision',o.revision,'service_id',s.id,'name',s.name,'benefit_text',o.benefit_text,
    'original_price_rub',s.price_rub,'price_rub',case o.discount_kind
      when 'percent' then round(s.price_rub*(100-o.discount_value)/100)::integer
      when 'rubles' then greatest(0,s.price_rub-o.discount_value)::integer else s.price_rub end,
    'additional_minutes',o.additional_minutes) order by o.priority,o.id)
    from public.service_booking_offers o join public.services s on s.id=o.addon_service_id
    where o.performer_id=v_service.performer_id and p_service=any(o.primary_service_ids) and o.enabled
      and s.performer_id=v_service.performer_id and s.active and s.duration_minutes<>1
      and o.addon_service_id<>p_service
      and (o.discount_kind<>'rubles' or o.discount_value<=s.price_rub)
      and exists(select 1 from jsonb_array_elements(v_catalog->'services') c
        where c->>'id'=s.id::text and c->'location_ids' ? p_location::text)), '[]'::jsonb));
end $$;

create or replace function minuta_offer_private.terms(p_slug text,p_location uuid,p_service uuid,p_offers jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_primary public.services%rowtype; v_available jsonb; v_selected jsonb; v_price integer; v_duration integer; v_original integer;
begin
  if jsonb_typeof(p_offers) is distinct from 'array' or jsonb_array_length(p_offers) not between 1 and 3
     or exists(select 1 from jsonb_array_elements(p_offers) x where jsonb_typeof(x) is distinct from 'object'
       or not x ? 'id' or not x ? 'revision')
     or (select count(distinct x->>'id') from jsonb_array_elements(p_offers) x)<>jsonb_array_length(p_offers)
  then raise exception 'service_offer_invalid'; end if;
  v_primary:=minuta_offer_private.context(p_slug,p_location,p_service);
  v_available:=public.get_public_minuta_service_offers(p_slug,p_location,p_service)->'offers';
  select jsonb_agg(a order by a->>'id') into v_selected
  from jsonb_array_elements(v_available) a join jsonb_array_elements(p_offers) s
    on a->>'id'=s->>'id' and a->>'revision'=s->>'revision';
  if coalesce(jsonb_array_length(v_selected),0)<>jsonb_array_length(p_offers)
     or (select count(distinct x->>'service_id') from jsonb_array_elements(v_selected) x)<>jsonb_array_length(p_offers)
  then raise exception 'service_offer_terms_changed'; end if;
  select v_primary.price_rub+sum((x->>'price_rub')::integer),
    v_primary.price_rub+sum((x->>'original_price_rub')::integer),
    v_primary.duration_minutes+sum((x->>'additional_minutes')::integer)
  into v_price,v_original,v_duration from jsonb_array_elements(v_selected) x;
  if v_price not between 0 and 10000000 or v_duration not between 1 and 480 then raise exception 'service_offer_invalid'; end if;
  return jsonb_build_object('price_rub',v_price,'original_price_rub',v_original,'duration_minutes',v_duration,'offers',v_selected);
end $$;

-- All components share one master's interval. Reserve each resource group for
-- the complete visit and reuse the same resource where services share a group.
create or replace function minuta_offer_private.interval_allowed(
  p_slug text,p_location uuid,p_service uuid,p_date date,p_time time,p_duration integer,p_services uuid[])
returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_service public.services%rowtype; v_org uuid; v_schedule public.provider_schedule%rowtype; v_end timestamp;
begin
  v_service:=minuta_offer_private.context(p_slug,p_location,p_service);
  select id into v_org from public.organizations where public_slug=p_slug;
  v_end:=p_date+p_time+make_interval(mins=>p_duration);
  select * into v_schedule from public.provider_schedule where performer_id=v_service.performer_id
    and weekday=extract(isodow from p_date)::integer;
  if not found or not v_schedule.enabled or p_time<v_schedule.start_time or v_end>p_date+v_schedule.end_time
     or (v_schedule.break_start is not null and v_schedule.break_end is not null and
       tsrange(p_date+p_time,v_end,'[)')&&tsrange(p_date+v_schedule.break_start,p_date+v_schedule.break_end,'[)'))
     or exists(select 1 from public.provider_days_off d where d.performer_id=v_service.performer_id and d.off_date=p_date
       and (d.all_day or d.start_time is null or d.end_time is null
         or tsrange(p_date+p_time,v_end,'[)')&&tsrange(p_date+d.start_time,p_date+d.end_time,'[)')))
     or exists(select 1 from public.bookings b where b.performer_id=v_service.performer_id and b.status<>'cancelled'
       and tsrange(p_date+p_time,v_end,'[)')&&tsrange(b.booking_date+b.booking_time,
         b.booking_date+b.booking_time+make_interval(mins=>b.duration_minutes),'[)'))
     or not coalesce(public.minuta_booking_fits_active_shift(v_org,p_location,v_service.performer_id,p_date,p_time,p_duration),false)
     or exists(select 1 from public.group_booking_events e where e.organization_id=v_org and e.location_id=p_location
       and e.performer_id=v_service.performer_id and e.event_date=p_date and e.status in('published','closed')
       and tsrange(p_date+p_time,v_end,'[)')&&tsrange(p_date+e.start_time,p_date+e.start_time+make_interval(mins=>e.duration_minutes),'[)'))
     or not coalesce(public.minuta_slot_respects_booking_buffer(p_service,p_date,p_time,p_duration,null),false)
  then return false; end if;
  return not exists(select 1 from (select r.group_id,max(r.quantity) quantity from public.service_resource_requirements r
    where r.organization_id=v_org and r.service_id=any(p_services) and r.active group by r.group_id) requirement
    join public.resource_groups g on g.id=requirement.group_id
    where not g.active or requirement.quantity>(select count(*) from public.resources r
      where r.organization_id=v_org and r.location_id=p_location and r.group_id=g.id and r.active
        and not exists(select 1 from public.booking_resource_allocations a where a.resource_id=r.id and a.booking_status='active'
          and tsrange(p_date+p_time,v_end,'[)')&&tsrange(a.starts_at,a.ends_at,'[)'))));
end $$;

create or replace function public.get_public_minuta_offer_slots(
  p_slug text,p_location uuid,p_service uuid,p_start date,p_end date,p_offers jsonb)
returns table(booking_date date,booking_time time) language plpgsql stable security definer set search_path='' as $$
declare v_terms jsonb; v_ids uuid[];
begin
  v_terms:=minuta_offer_private.terms(p_slug,p_location,p_service,p_offers);
  select array_agg((x->>'service_id')::uuid)||array[p_service] into v_ids from jsonb_array_elements(v_terms->'offers') x;
  return query select s.booking_date,s.booking_time from public.get_public_minuta_available_slots_v101(p_slug,p_location,p_service,p_start,p_end) s
    where minuta_offer_private.interval_allowed(p_slug,p_location,p_service,s.booking_date,s.booking_time,
      (v_terms->>'duration_minutes')::integer,v_ids) order by s.booking_date,s.booking_time limit 512;
end $$;

create or replace function minuta_offer_private.sync_resources()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_snapshot jsonb; v_req record; v_resource uuid; v_existing integer; v_services uuid[];
begin
  if new.status='cancelled' then return new; end if;
  select snapshot into v_snapshot from minuta_offer_private.booking_requests where booking_id=new.id;
  if not found then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.organization_id::text||':'||new.location_id::text,6900));
  -- The immutable snapshot proves the original request. Later provider edits
  -- must reserve resources for the current composition of the visit.
  select coalesce(array_agg(distinct service_id) filter(where service_id is not null),'{}'::uuid[])||array[new.service_id]
    into v_services from public.booking_session_items where booking_id=new.id;
  for v_req in select group_id,max(quantity) quantity from public.service_resource_requirements
    where organization_id=new.organization_id and service_id=any(v_services) and active group by group_id order by group_id
  loop
    if not coalesce((select active from public.resource_groups where id=v_req.group_id),false) then raise exception 'resource_unavailable'; end if;
    select count(*) into v_existing from public.booking_resource_allocations a join public.resources r on r.id=a.resource_id
      where a.booking_id=new.id and a.booking_status='active' and r.group_id=v_req.group_id;
    while v_existing<v_req.quantity loop
      select r.id into v_resource from public.resources r where r.organization_id=new.organization_id and r.location_id=new.location_id
        and r.group_id=v_req.group_id and r.active and not exists(select 1 from public.booking_resource_allocations a
          where a.resource_id=r.id and a.booking_status='active' and tsrange(new.booking_date+new.booking_time,
            new.booking_date+new.booking_time+make_interval(mins=>new.duration_minutes),'[)')&&tsrange(a.starts_at,a.ends_at,'[)'))
        order by r.id limit 1 for update;
      if v_resource is null then raise exception 'resource_unavailable'; end if;
      insert into public.booking_resource_allocations(booking_id,resource_id,organization_id,location_id,starts_at,ends_at,booking_status)
      values(new.id,v_resource,new.organization_id,new.location_id,new.booking_date+new.booking_time,
        new.booking_date+new.booking_time+make_interval(mins=>new.duration_minutes),'active');
      v_existing:=v_existing+1;
    end loop;
  end loop;
  return new;
end $$;
drop trigger if exists zz_bookings_service_offer_resources on public.bookings;
create trigger zz_bookings_service_offer_resources after update of organization_id,location_id,service_id,booking_date,booking_time,duration_minutes,status
  on public.bookings for each row execute function minuta_offer_private.sync_resources();

create or replace function public.book_minuta_service_offers(
  p_request_id uuid,p_slug text,p_location uuid,p_service uuid,p_date date,p_time time,p_client_name text,p_client_phone text,
  p_expected_price_rub integer,p_expected_duration_minutes integer,p_comment text,p_offers jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_terms jsonb; v_primary public.services%rowtype; v_ids uuid[]; v_selections jsonb; v_fingerprint text;
  v_request minuta_offer_private.booking_requests%rowtype; v_book public.bookings%rowtype; v_result record; v_ack jsonb;
  v_org uuid; v_resource_service uuid;
begin
  if p_request_id is null or p_date is null or p_time is null or p_location is null or p_service is null
    or char_length(btrim(coalesce(p_client_name,''))) not between 2 and 80
    or regexp_replace(coalesce(p_client_phone,''),'\D','','g') !~ '^\d{10,15}$'
    or char_length(coalesce(p_comment,''))>500 or jsonb_typeof(p_offers) is distinct from 'array'
    or jsonb_array_length(p_offers) not between 1 and 3
  then raise exception 'service_offer_invalid'; end if;
  select jsonb_agg(x order by x->>'id') into v_selections from jsonb_array_elements(p_offers) x;
  v_fingerprint:=encode(extensions.digest(convert_to(jsonb_build_array(p_slug,p_location,p_service,p_date,p_time,
    btrim(p_client_name),regexp_replace(p_client_phone,'\D','','g'),p_expected_price_rub,p_expected_duration_minutes,
    coalesce(p_comment,''),v_selections)::text,'UTF8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended('booking-request:'||p_request_id::text,0));
  select * into v_request from minuta_offer_private.booking_requests where request_id=p_request_id;
  if found then
    if v_request.request_fingerprint<>v_fingerprint then raise exception 'request_conflict'; end if;
    select * into v_book from public.bookings where id=v_request.booking_id;
    return v_request.acknowledgement||jsonb_build_object('status',v_book.status,'idempotent',true);
  end if;
  if exists(select 1 from public.bookings where request_id=p_request_id) then raise exception 'request_conflict'; end if;
  v_primary:=minuta_offer_private.context(p_slug,p_location,p_service);
  perform pg_advisory_xact_lock(hashtextextended(v_primary.performer_id::text||p_date::text,0));
  perform pg_advisory_xact_lock(hashtextextended('service-offers:'||v_primary.performer_id::text,0));
  perform 1 from public.services where id=p_service for share;
  perform 1 from public.service_booking_offers where id in(select (x->>'id')::uuid from jsonb_array_elements(p_offers) x) for share;
  perform 1 from public.services where id in(select addon_service_id from public.service_booking_offers
    where id in(select (x->>'id')::uuid from jsonb_array_elements(p_offers) x)) order by id for share;
  v_terms:=minuta_offer_private.terms(p_slug,p_location,p_service,p_offers);
  if p_expected_price_rub is distinct from (v_terms->>'price_rub')::integer
     or p_expected_duration_minutes is distinct from (v_terms->>'duration_minutes')::integer
  then raise exception 'service_offer_terms_changed'; end if;
  select array_agg((x->>'service_id')::uuid)||array[p_service] into v_ids from jsonb_array_elements(v_terms->'offers') x;
  select id into v_org from public.organizations where public_slug=p_slug;
  -- Share the canonical requirements locks before a request ledger exists.
  -- Configuration changes therefore precede this visit or see its receipt.
  for v_resource_service in select distinct x from unnest(v_ids) x order by x loop
    perform pg_advisory_xact_lock(hashtextextended(v_org::text||':'||v_resource_service::text,6901));
  end loop;
  if not minuta_offer_private.interval_allowed(p_slug,p_location,p_service,p_date,p_time,p_expected_duration_minutes,v_ids)
    or not exists(select 1 from public.get_public_minuta_available_slots_v101(p_slug,p_location,p_service,p_date,p_date) s
      where s.booking_date=p_date and s.booking_time=p_time)
  then raise exception 'slot_unavailable'; end if;
  select * into v_result from public.book_minuta_appointment_v3(p_request_id,p_slug,p_location,p_service,p_date,p_time,
    p_client_name,p_client_phone,v_primary.price_rub,v_primary.duration_minutes,p_comment);
  if v_result.result_code is distinct from 'ok' then raise exception 'service_offer_terms_changed'; end if;
  select * into v_book from public.bookings where request_id=p_request_id for update;
  v_ack:=jsonb_build_object('result_code','ok','booking_code',v_book.booking_code,'manage_token',v_book.manage_token,
    'request_id',p_request_id,'service_id',p_service,'booking_date',p_date,'booking_time',p_time,
    'duration_minutes',p_expected_duration_minutes,'original_price_rub',v_primary.price_rub,
    'total_price_rub',p_expected_price_rub,'status',v_book.status,'idempotent',false);
  insert into minuta_offer_private.booking_requests(request_id,booking_id,request_fingerprint,selections,snapshot,acknowledgement)
    values(p_request_id,v_book.id,v_fingerprint,v_selections,v_terms,v_ack);
  insert into public.booking_session_items(booking_id,performer_id,position,item_kind,service_id,title,duration_minutes,price_rub,extends_duration)
  select v_book.id,v_book.performer_id,(row_number() over(order by x->>'id'))::integer+1,'addon',(x->>'service_id')::uuid,
    x->>'name',(x->>'additional_minutes')::integer,(x->>'price_rub')::integer,(x->>'additional_minutes')::integer>0
  from jsonb_array_elements(v_terms->'offers') x;
  update public.bookings set duration_minutes=p_expected_duration_minutes,total_price_rub=p_expected_price_rub,
    original_price_rub=v_primary.price_rub where id=v_book.id;
  return v_ack;
end $$;

revoke all on all functions in schema minuta_offer_private from public,anon,authenticated,service_role;
revoke all on function public.get_public_minuta_service_offers(text,uuid,uuid),
  public.get_public_minuta_offer_slots(text,uuid,uuid,date,date,jsonb),
  public.book_minuta_service_offers(uuid,text,uuid,uuid,date,time,text,text,integer,integer,text,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.get_public_minuta_service_offers(text,uuid,uuid),
  public.get_public_minuta_offer_slots(text,uuid,uuid,date,date,jsonb),
  public.book_minuta_service_offers(uuid,text,uuid,uuid,date,time,text,text,integer,integer,text,jsonb) to anon,authenticated;
notify pgrst,'reload schema';
commit;
