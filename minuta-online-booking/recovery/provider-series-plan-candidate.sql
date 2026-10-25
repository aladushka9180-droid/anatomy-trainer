-- Additive provider series API. Legacy recurring calls remain available.
-- Release only after the isolated schema/rollback/concurrency and backup gates.
begin;
set local search_path = public, extensions, pg_catalog;
do $$
begin
  if to_regclass('public.booking_series') is null
    or to_regprocedure('public.provider_book_appointment(uuid,uuid,date,time without time zone,text,text)') is null
    or to_regprocedure('public.provider_repeat_appointment_v164(uuid,uuid,text,date,time without time zone,text,text,integer,text)') is null
    or to_regprocedure('public.minuta_block_slot_valid_v123(uuid,uuid,uuid,date,time without time zone,integer)') is null then
    raise exception using errcode='55000',message='series_plan_prerequisites_missing';
  end if;
end $$;
alter table public.booking_series add column if not exists request_id uuid,
  add column if not exists plan_digest text, add column if not exists creation_reply jsonb;
create unique index if not exists booking_series_request_id_uidx
  on public.booking_series(request_id) where request_id is not null;

-- Same full-interval validator as v123, allowing the complete multi-service duration.
create or replace function public.minuta_series_slot_valid(
 p_organization uuid,p_location uuid,p_service uuid,p_date date,p_time time,p_duration integer
) returns boolean language plpgsql volatile security definer set search_path to '' as $$
declare v_actor uuid:=auth.uid(); v_schedule public.provider_schedule%rowtype; v_zone text; v_end timestamp;
begin
 if v_actor is null then raise exception using errcode='42501',message='authentication_required'; end if;
 if p_duration is null or p_duration not between 1 and 1440 or p_date is null or p_time is null
   or extract(second from p_time)<>0 then return false; end if;
 select location.timezone into v_zone from public.locations location
 join public.organizations organization on organization.id=location.organization_id and organization.status='active'
 join public.organization_memberships member on member.organization_id=organization.id and member.user_id=v_actor
  and member.active and member.is_bookable
 join public.services service on service.id=p_service and service.performer_id=v_actor and service.active
 where location.id=p_location and location.organization_id=p_organization and location.active;
 if v_zone is null then return false; end if;
 begin
  perform pg_catalog.timezone(v_zone,p_date::timestamp);
 exception when invalid_parameter_value then
  return false;
 end;
 v_end:=p_date+p_time+make_interval(mins=>p_duration);
 if p_date+p_time<=timezone(v_zone,now()) or p_date>timezone(v_zone,now())::date+730 or v_end>p_date+1 then return false; end if;
 select * into v_schedule from public.provider_schedule
 where performer_id=v_actor and weekday=extract(isodow from p_date)::integer;
 -- No guessed schedule or technical-service duration fallback.
 if not found or not v_schedule.enabled or v_schedule.start_time is null or v_schedule.end_time is null
  or p_time<v_schedule.start_time or v_end>p_date+v_schedule.end_time then return false; end if;
 if v_schedule.break_start is not null and v_schedule.break_end is not null
  and tsrange(p_date+p_time,v_end,'[)')&&tsrange(p_date+v_schedule.break_start,p_date+v_schedule.break_end,'[)') then return false; end if;
 if exists(select 1 from public.provider_days_off d where d.performer_id=v_actor and d.off_date=p_date
  and (d.all_day or d.start_time is null or d.end_time is null
   or tsrange(p_date+p_time,v_end,'[)')&&tsrange(p_date+d.start_time,p_date+d.end_time,'[)'))) then return false; end if;
 if exists(select 1 from public.bookings b where b.performer_id=v_actor and b.status<>'cancelled'
  and tsrange(p_date+p_time,v_end,'[)')&&tsrange(b.booking_date+b.booking_time,
   b.booking_date+b.booking_time+make_interval(mins=>b.duration_minutes),'[)')) then return false; end if;
 if not coalesce(public.minuta_booking_fits_active_shift(p_organization,p_location,v_actor,p_date,p_time,p_duration),false)
  then return false; end if;
 if exists(select 1 from public.group_booking_events event where event.organization_id=p_organization
  and event.location_id=p_location and event.performer_id=v_actor and event.event_date=p_date
  and event.status in ('published','closed')
  and tsrange(p_date+p_time,v_end,'[)')&&tsrange(event.event_date+event.start_time,
   event.event_date+event.start_time+make_interval(mins=>event.duration_minutes),'[)')) then return false; end if;
 -- Match allocation requirements without mutating or reserving resources. The
 -- existing allocation trigger remains authoritative under its advisory locks.
 if exists(select 1 from public.service_resource_requirements requirement
  join public.resource_groups resource_group on resource_group.id=requirement.group_id
   and resource_group.organization_id=requirement.organization_id
  where requirement.organization_id=p_organization and requirement.service_id=p_service and requirement.active
   and (not resource_group.active or requirement.quantity>(select count(*) from public.resources resource
    where resource.organization_id=p_organization and resource.location_id=p_location
     and resource.group_id=requirement.group_id and resource.active
     and not exists(select 1 from public.booking_resource_allocations allocation
      where allocation.resource_id=resource.id and allocation.booking_status='active'
       and tsrange(p_date+p_time,v_end,'[)')&&tsrange(allocation.starts_at,allocation.ends_at,'[)'))))) then return false; end if;
 return coalesce(public.minuta_slot_respects_booking_buffer(p_service,p_date,p_time,p_duration,null),false);
end $$;
revoke all on function public.minuta_series_slot_valid(uuid,uuid,uuid,date,time,integer) from public,anon,authenticated,service_role;

-- Reuse the existing actor, branch, shift, resource and buffer contracts.
create or replace function public.minuta_provider_series_context(
  p_service uuid,p_duration integer,p_organization uuid,p_location uuid,p_source_booking uuid
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_actor uuid:=auth.uid(); v_service public.services%rowtype; v_source public.bookings%rowtype;
  v_org uuid:=p_organization; v_location uuid:=p_location; v_preview jsonb;
begin
  if v_actor is null then raise exception using errcode='42501',message='authentication_required'; end if;
  select * into v_service from public.services where id=p_service and performer_id=v_actor and active;
  if not found then raise exception using errcode='42501',message='provider_service_access_denied'; end if;
  if p_duration is null or p_duration not between 1 and 1440 then
    raise exception using errcode='22023',message='invalid_series_duration';
  end if;
  if p_source_booking is not null then
    v_preview:=public.minuta_provider_repeat_visit_payload_v164(p_source_booking,v_actor);
    select * into v_source from public.bookings where id=p_source_booking and performer_id=v_actor;
    if not found or (v_preview->'items'->0->>'service_id')::uuid is distinct from p_service
      or (v_preview->>'duration_minutes')::integer is distinct from p_duration then
      raise exception using errcode='P0001',message='repeat_source_changed';
    end if;
    v_org:=v_source.organization_id; v_location:=v_source.location_id;
  elsif (v_service.duration_minutes<>1 and v_service.duration_minutes<>p_duration)
    or (v_service.duration_minutes=1 and p_duration>480) then
    raise exception using errcode='22023',message='invalid_series_duration';
  end if;
  if not exists(select 1 from public.locations location
    join public.organizations organization on organization.id=location.organization_id and organization.status='active'
    join public.organization_memberships member on member.organization_id=organization.id
      and member.user_id=v_actor and member.active and member.is_bookable
    where location.id=v_location and location.organization_id=v_org and location.active) then
    raise exception using errcode='42501',message='series_scope_denied';
  end if;
  return jsonb_build_object('organization',v_org,'location',v_location,'duration',p_duration,
    'price',case when v_service.duration_minutes=1 then v_service.price_rub*p_duration else v_service.price_rub end);
end $$;
revoke all on function public.minuta_provider_series_context(uuid,integer,uuid,uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.get_provider_series_slots(
  p_service uuid,p_date date,p_duration integer,p_organization uuid,p_location uuid,p_source_booking uuid default null
) returns table(booking_time time without time zone)
language plpgsql security definer set search_path to '' as $$
declare v_context jsonb;
begin
  v_context:=public.minuta_provider_series_context(p_service,p_duration,p_organization,p_location,p_source_booking);
  return query select (p_date+time '00:00'+make_interval(mins=>slot*30))::time
    from generate_series(0,47) slot
    where public.minuta_series_slot_valid((v_context->>'organization')::uuid,(v_context->>'location')::uuid,
      p_service,p_date,(p_date+time '00:00'+make_interval(mins=>slot*30))::time,p_duration);
end $$;
revoke all on function public.get_provider_series_slots(uuid,date,integer,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_provider_series_slots(uuid,date,integer,uuid,uuid,uuid) to authenticated;

create or replace function public.create_provider_series_plan(
  p_request_id uuid,p_service uuid,p_client_name text,p_client_phone text,p_interval_weeks integer,p_plan jsonb,
  p_duration integer,p_organization uuid,p_location uuid,
  p_source_booking uuid default null,p_source_signature text default null,p_total_price_rub integer default null,
  p_comment text default '',p_client_note text default '',p_color text default 'auto'
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_actor uuid:=auth.uid(); v_count integer; v_index integer; v_entry jsonb; v_date date; v_time time;
  v_series uuid; v_existing public.booking_series%rowtype; v_digest text; v_result jsonb; v_context jsonb;
  v_booking public.bookings%rowtype; v_occurrence_request uuid; v_created jsonb:='[]'::jsonb;
  v_previous_organization text:=current_setting('minuta.booking_organization',true);
  v_previous_location text:=current_setting('minuta.booking_location',true);
begin
  if v_actor is null then raise exception using errcode='42501',message='authentication_required'; end if;
  v_count:=case when jsonb_typeof(p_plan)='array' then jsonb_array_length(p_plan) else 0 end;
  if p_request_id is null or p_service is null or v_count not between 2 and 24
    or p_interval_weeks is null or p_interval_weeks not between 1 and 12
    or char_length(btrim(coalesce(p_client_name,''))) not between 2 and 80
    or char_length(regexp_replace(coalesce(p_client_phone,''),'[^0-9]','','g')) not between 10 and 15
    or char_length(coalesce(p_client_note,''))>1000 or char_length(coalesce(p_comment,''))>1000
    or p_color is null or p_color not in ('auto','mint','sky','lavender','peach','rose','vanilla','sage','teal','amber','cocoa','graphite')
    or (p_source_booking is null and (p_source_signature is not null or p_total_price_rub is not null))
    or (p_source_booking is not null and (p_source_signature is null or p_total_price_rub is null)) then
    raise exception using errcode='22023',message='invalid_series_plan';
  end if;
  -- JSON preserves field boundaries; the identity includes all accepted terms.
  v_digest:=md5(jsonb_build_array(p_service,btrim(p_client_name),btrim(p_client_phone),p_interval_weeks,p_plan,
    p_duration,p_organization,p_location,p_source_booking,p_source_signature,p_total_price_rub,
    coalesce(p_comment,''),coalesce(p_client_note,''),p_color)::text);
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,18500));
  select * into v_existing from public.booking_series where request_id=p_request_id for update;
  if found then
    if v_existing.performer_id is distinct from v_actor or v_existing.plan_digest is distinct from v_digest then
      raise exception using errcode='P0001',message='series_request_conflict';
    end if;
    if v_existing.creation_reply is null then raise exception using errcode='55000',message='series_recovery_incomplete'; end if;
    -- Return the original acknowledgement even if an occurrence was later moved
    -- or cancelled. A retry must never recreate it or overwrite its new state.
    return v_existing.creation_reply||jsonb_build_object('recovered',true);
  end if;
  v_context:=public.minuta_provider_series_context(p_service,p_duration,p_organization,p_location,p_source_booking);
  for v_index in 1..v_count loop
    v_entry:=p_plan->(v_index-1);
    if jsonb_typeof(v_entry)<>'object' or coalesce(v_entry->>'date','') !~ '^\d{4}-\d{2}-\d{2}$'
      or coalesce(v_entry->>'time','') !~ '^([01]\d|2[0-3]):(00|30)$' then
      raise exception using errcode='22023',message='invalid_series_plan';
    end if;
    begin v_date:=(v_entry->>'date')::date; v_time:=(v_entry->>'time')::time;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception using errcode='22023',message='invalid_series_plan';
    end;
  end loop;
  -- Same lock domain as book_appointment/buffer enforcement, ordered so two
  -- overlapping series cannot deadlock merely by listing their dates differently.
  for v_date in select distinct (entry->>'date')::date from jsonb_array_elements(p_plan) entry order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended(v_actor::text||v_date::text,0));
  end loop;
  insert into public.booking_series(performer_id,service_id,client_name,client_phone,start_date,booking_time,
    interval_weeks,occurrence_count,request_id,plan_digest)
  values(v_actor,p_service,btrim(p_client_name),btrim(p_client_phone),(p_plan->0->>'date')::date,
    (p_plan->0->>'time')::time,p_interval_weeks,v_count,p_request_id,v_digest) returning id into v_series;
  perform set_config('minuta.booking_organization',v_context->>'organization',true);
  perform set_config('minuta.booking_location',v_context->>'location',true);
  for v_index in 1..v_count loop
    v_date:=(p_plan->(v_index-1)->>'date')::date; v_time:=(p_plan->(v_index-1)->>'time')::time;
    if not public.minuta_series_slot_valid((v_context->>'organization')::uuid,(v_context->>'location')::uuid,
      p_service,v_date,v_time,p_duration) then
      raise exception using errcode='23P01',message='series_slot_unavailable',detail=v_index::text;
    end if;
    -- Never reuse the caller's series identity as an individual booking identity.
    v_occurrence_request:=gen_random_uuid();
    if p_source_booking is not null then
      v_result:=public.provider_repeat_appointment_v164(v_occurrence_request,p_source_booking,p_source_signature,
        v_date,v_time,p_client_name,p_client_phone,p_total_price_rub,p_comment);
    else
      v_result:=public.provider_book_appointment(v_occurrence_request,p_service,v_date,v_time,p_client_name,p_client_phone);
    end if;
    select * into v_booking from public.bookings where request_id=v_occurrence_request for update;
    if not found or v_booking.id is distinct from (v_result->>'booking_id')::uuid
      or v_booking.booking_code is distinct from v_result->>'booking_code' or v_booking.performer_id is distinct from v_actor
      or v_booking.service_id is distinct from p_service or v_booking.booking_date is distinct from v_date
      or v_booking.booking_time is distinct from v_time or v_booking.series_id is not null then
      raise exception using errcode='55000',message='series_booking_link_failed';
    end if;
    if p_source_booking is null then
      update public.bookings set duration_minutes=p_duration,total_price_rub=(v_context->>'price')::integer,
        original_price_rub=(select price_rub from public.services where id=p_service)
        where id=v_booking.id;
      update public.booking_session_items set duration_minutes=p_duration,price_rub=(v_context->>'price')::integer
        where booking_id=v_booking.id and performer_id=v_actor and item_kind='primary';
      update public.booking_resource_allocations set ends_at=starts_at+make_interval(mins=>p_duration) where booking_id=v_booking.id;
    end if;
    update public.bookings set series_id=v_series,series_occurrence=v_index,color_key=p_color where id=v_booking.id;
    v_created:=v_created||jsonb_build_array(jsonb_build_object('booking_id',v_booking.id,'booking_code',v_booking.booking_code,
      'occurrence',v_index,'date',v_date,'time',to_char(v_time,'HH24:MI'),'duration_minutes',p_duration));
  end loop;
  if btrim(coalesce(p_client_note,''))<>'' then
    insert into public.client_notes(performer_id,client_phone,note,updated_at)
      values(v_actor,regexp_replace(p_client_phone,'[^0-9]','','g'),btrim(p_client_note),now())
      on conflict(performer_id,client_phone) do update set note=excluded.note,updated_at=excluded.updated_at;
  end if;
  perform set_config('minuta.booking_organization',coalesce(v_previous_organization,''),true);
  perform set_config('minuta.booking_location',coalesce(v_previous_location,''),true);
  v_result:=jsonb_build_object('series_id',v_series,'request_id',p_request_id,'created',v_created,'recovered',false);
  update public.booking_series set creation_reply=v_result where id=v_series;
  return v_result;
end $$;
revoke all on function public.create_provider_series_plan(uuid,uuid,text,text,integer,jsonb,integer,uuid,uuid,uuid,text,integer,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.create_provider_series_plan(uuid,uuid,text,text,integer,jsonb,integer,uuid,uuid,uuid,text,integer,text,text,text) to authenticated;
comment on function public.create_provider_series_plan(uuid,uuid,text,text,integer,jsonb,integer,uuid,uuid,uuid,text,integer,text,text,text) is 'minuta:provider-series-plan:atomic';
notify pgrst,'reload schema';
commit;
