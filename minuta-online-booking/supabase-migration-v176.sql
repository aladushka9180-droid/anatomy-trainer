-- Expand-only candidate. Do not grant public EXECUTE until a trusted route
-- evidence producer, full-schema rehearsal, backup and rollback are approved.
begin;
set local search_path=public,extensions,pg_catalog;

do $guard$
begin
  if to_regclass('public.bookings') is null
     or to_regclass('public.public_multi_service_routes_v167') is null
     or to_regprocedure('public.book_minuta_multi_service_route_v167(uuid,text,uuid,text,text,jsonb)') is null
     or to_regprocedure('public.book_minuta_appointment_v2(uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer)') is null
     or to_regprocedure('public.get_public_minuta_catalog_v5(text)') is null
     or to_regprocedure('public.get_available_slots(uuid,date,date)') is null
     or to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception using errcode='55000',message='v176_multi_resource_prerequisites_missing';
  end if;
  if obj_description(
    'public.book_minuta_appointment_v2(uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer)'::regprocedure,
    'pg_proc'
  ) not like 'minuta_atomic_create_v153:sha256=%' then
    raise exception using errcode='55000',message='v176_atomic_booking_contract_drift';
  end if;
end
$guard$;

-- A future trusted server adapter may write these route-bound attestations.
-- No browser role can read or insert one. The table starts empty in production.
create table if not exists public.public_route_travel_evidence_v176(
  id uuid primary key,
  route_request_id uuid not null,
  from_location_id uuid not null references public.locations(id) on delete restrict,
  to_location_id uuid not null references public.locations(id) on delete restrict,
  departure_at timestamptz not null,
  travel_minutes integer not null check(travel_minutes between 0 and 360),
  route_mode text not null check(route_mode in ('walking','driving','transit')),
  provider_reference text not null check(length(provider_reference) between 8 and 200),
  measured_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  check(from_location_id<>to_location_id),
  check(expires_at>measured_at and expires_at<=measured_at+interval '15 minutes')
);

create table if not exists public.public_multi_resource_routes_v176(
  request_id uuid primary key,
  request_fingerprint text not null check(request_fingerprint~'^[0-9a-f]{64}$'),
  item_count smallint not null check(item_count between 2 and 6),
  items_payload jsonb not null check(jsonb_typeof(items_payload)='array'),
  transitions_payload jsonb not null check(jsonb_typeof(transitions_payload)='array'),
  created_at timestamptz not null default now()
);

create table if not exists public.public_multi_resource_route_items_v176(
  route_request_id uuid not null references public.public_multi_resource_routes_v176(request_id) on delete restrict,
  position smallint not null check(position between 1 and 6),
  booking_request_id uuid not null unique,
  booking_id uuid not null unique references public.bookings(id) on delete restrict,
  primary key(route_request_id,position)
);

alter table public.public_route_travel_evidence_v176 enable row level security;
alter table public.public_multi_resource_routes_v176 enable row level security;
alter table public.public_multi_resource_route_items_v176 enable row level security;
revoke all on table public.public_route_travel_evidence_v176,
  public.public_multi_resource_routes_v176,public.public_multi_resource_route_items_v176
  from public,anon,authenticated,service_role;
grant all on table public.public_route_travel_evidence_v176,
  public.public_multi_resource_routes_v176,public.public_multi_resource_route_items_v176
  to service_role;

create or replace function public.book_minuta_multi_resource_route_v176(
  p_request_id uuid,
  p_client_name text,
  p_client_phone text,
  p_items jsonb,
  p_transitions jsonb
) returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_phone_digits text:=regexp_replace(coalesce(p_client_phone,''),'[^0-9]','','g');
  v_count integer;
  v_position integer:=0;
  v_item jsonb;
  v_transition jsonb;
  v_items jsonb:='[]'::jsonb;
  v_transitions jsonb:='[]'::jsonb;
  v_resolved jsonb:='[]'::jsonb;
  v_item_request uuid;
  v_service uuid;
  v_location uuid;
  v_expected_performer uuid;
  v_slug text;
  v_date date;
  v_time time without time zone;
  v_price integer;
  v_duration integer;
  v_leg_position integer;
  v_evidence_id uuid;
  v_fingerprint text;
  v_lock_id uuid;
  v_existing public.public_multi_resource_routes_v176%rowtype;
  v_organization uuid;
  v_performer uuid;
  v_current_price integer;
  v_current_duration integer;
  v_catalog jsonb;
  v_start timestamptz;
  v_end timestamptz;
  v_first_start timestamptz;
  v_previous_end timestamptz;
  v_previous_location uuid;
  v_changed_legs integer:=0;
  v_evidence public.public_route_travel_evidence_v176%rowtype;
  v_created record;
  v_booking public.bookings%rowtype;
  v_results jsonb;
begin
  if p_request_id is null
     or coalesce(char_length(trim(p_client_name)),0) not between 2 and 80
     or char_length(v_phone_digits) not between 10 and 15
     or jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_typeof(p_transitions) is distinct from 'array' then
    raise exception using errcode='22023',message='invalid_multi_resource_route';
  end if;
  v_count:=jsonb_array_length(p_items);
  if v_count not between 2 and 6 then
    raise exception using errcode='22023',message='multi_resource_route_size_invalid';
  end if;

  begin
    for v_item in select value from jsonb_array_elements(p_items) loop
      v_position:=v_position+1;
      if jsonb_typeof(v_item)<>'object'
         or (select count(*) from jsonb_object_keys(v_item))<>9
         or not v_item ?& array[
           'request_id','organization_slug','location_id','performer_id','service_id',
           'booking_date','booking_time','expected_price_rub','expected_duration_minutes'
         ] then
        raise exception using errcode='22023',message='invalid_multi_resource_item';
      end if;
      v_item_request:=(v_item->>'request_id')::uuid;
      v_slug:=lower(trim(v_item->>'organization_slug'));
      v_location:=(v_item->>'location_id')::uuid;
      v_expected_performer:=(v_item->>'performer_id')::uuid;
      v_service:=(v_item->>'service_id')::uuid;
      v_date:=(v_item->>'booking_date')::date;
      v_time:=(v_item->>'booking_time')::time without time zone;
      v_price:=(v_item->>'expected_price_rub')::integer;
      v_duration:=(v_item->>'expected_duration_minutes')::integer;
      if v_item_request is null or v_item_request=p_request_id
         or v_slug!~'^[a-z0-9][a-z0-9-]{2,62}$'
         or v_location is null or v_expected_performer is null or v_service is null
         or v_date is null or v_time is null
         or v_date<current_date or v_date>current_date+31
         or v_price is null or v_price not between 0 and 10000000
         or v_duration is null or v_duration not between 1 and 480 then
        raise exception using errcode='22023',message='invalid_multi_resource_item';
      end if;
      v_items:=v_items||jsonb_build_array(jsonb_build_object(
        'position',v_position,'request_id',v_item_request,
        'organization_slug',v_slug,'location_id',v_location,
        'performer_id',v_expected_performer,'service_id',v_service,
        'booking_date',v_date,'booking_time',v_time,
        'expected_price_rub',v_price,'expected_duration_minutes',v_duration
      ));
    end loop;
    for v_transition in select value from jsonb_array_elements(p_transitions) loop
      if jsonb_typeof(v_transition)<>'object'
         or (select count(*) from jsonb_object_keys(v_transition))<>2
         or not v_transition ?& array['position','evidence_id'] then
        raise exception using errcode='22023',message='invalid_multi_resource_transition';
      end if;
      v_leg_position:=(v_transition->>'position')::integer;
      v_evidence_id:=(v_transition->>'evidence_id')::uuid;
      if v_leg_position is null or v_leg_position not between 1 and v_count-1
         or v_evidence_id is null then
        raise exception using errcode='22023',message='invalid_multi_resource_transition';
      end if;
      v_transitions:=v_transitions||jsonb_build_array(jsonb_build_object(
        'position',v_leg_position,'evidence_id',v_evidence_id
      ));
    end loop;
  exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then
    raise exception using errcode='22023',message='invalid_multi_resource_route_item';
  end;
  if (select count(distinct item->>'request_id') from jsonb_array_elements(v_items) item)<>v_count
     or (select count(distinct transition->>'position') from jsonb_array_elements(v_transitions) transition)
        <>jsonb_array_length(v_transitions) then
    raise exception using errcode='22023',message='multi_resource_route_ids_not_distinct';
  end if;
  select coalesce(jsonb_agg(transition order by (transition->>'position')::integer),'[]'::jsonb)
    into v_transitions from jsonb_array_elements(v_transitions) transition;

  v_fingerprint:=encode(extensions.digest(convert_to(
    trim(p_client_name)||chr(31)||v_phone_digits||chr(31)||
    v_items::text||chr(31)||v_transitions::text,'UTF8'),'sha256'),'hex');
  -- Shared request IDs are acquired in one order before any booking function runs.
  for v_lock_id in
    select lock_id from (
      select p_request_id as lock_id
      union
      select (item->>'request_id')::uuid from jsonb_array_elements(v_items) item
    ) ids order by lock_id
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('multi-resource-request:'||v_lock_id::text,17600)
    );
  end loop;
  select * into v_existing from public.public_multi_resource_routes_v176 route
  where route.request_id=p_request_id for update;
  if found then
    if v_existing.request_fingerprint is distinct from v_fingerprint
       or v_existing.items_payload is distinct from v_items
       or v_existing.transitions_payload is distinct from v_transitions then
      raise exception using errcode='P0001',message='multi_resource_request_conflict';
    end if;
    select jsonb_build_object(
      'result_code','ok','request_id',v_existing.request_id,
      'request_fingerprint',v_existing.request_fingerprint,'idempotent',true,
      'bookings',coalesce(jsonb_agg(jsonb_build_object(
        'position',route_item.position,'booking_code',booking.booking_code,
        'manage_token',booking.manage_token,'request_id',booking.request_id,
        'organization_id',booking.organization_id,'location_id',booking.location_id,
        'performer_id',booking.performer_id,'service_id',booking.service_id,
        'booking_date',booking.booking_date,'booking_time',booking.booking_time,
        'duration_minutes',booking.duration_minutes,'original_price_rub',booking.original_price_rub,
        'total_price_rub',booking.total_price_rub,'status',booking.status
      ) order by route_item.position),'[]'::jsonb)
    ) into v_results
    from public.public_multi_resource_route_items_v176 route_item
    join public.bookings booking on booking.id=route_item.booking_id
    where route_item.route_request_id=p_request_id;
    if jsonb_array_length(v_results->'bookings')<>v_existing.item_count then
      raise exception using errcode='55000',message='multi_resource_replay_incomplete';
    end if;
    return v_results;
  end if;
  if exists(select 1 from public.public_multi_service_routes_v167 old_route
    where old_route.request_id=p_request_id)
     or exists(select 1 from public.bookings booking
       join jsonb_array_elements(v_items) item on booking.request_id=(item->>'request_id')::uuid) then
    raise exception using errcode='P0001',message='multi_resource_item_request_conflict';
  end if;

  for v_item in select value from jsonb_array_elements(v_items) loop
    v_slug:=v_item->>'organization_slug';
    v_location:=(v_item->>'location_id')::uuid;
    v_service:=(v_item->>'service_id')::uuid;
    v_date:=(v_item->>'booking_date')::date;
    v_time:=(v_item->>'booking_time')::time without time zone;
    v_duration:=(v_item->>'expected_duration_minutes')::integer;
    select organization.id into v_organization from public.organizations organization
    where organization.public_slug=v_slug and organization.status='active'
      and organization.public_booking_enabled for share;
    if v_organization is null then
      raise exception using errcode='P0001',message='organization_unavailable';
    end if;
    perform 1 from public.locations location
    where location.id=v_location and location.organization_id=v_organization
      and location.active and location.timezone='Europe/Samara' for share;
    if not found then
      raise exception using errcode='P0001',message='location_unavailable';
    end if;
    select service.performer_id,service.price_rub,service.duration_minutes
      into v_performer,v_current_price,v_current_duration
    from public.services service where service.id=v_service and service.active for share;
    if v_performer is distinct from (v_item->>'performer_id')::uuid
       or v_current_price is distinct from (v_item->>'expected_price_rub')::integer
       or v_current_duration is distinct from v_duration then
      raise exception using errcode='P0001',message='multi_resource_terms_changed';
    end if;
    perform 1 from public.organization_memberships membership
    where membership.organization_id=v_organization and membership.user_id=v_performer
      and membership.active and membership.is_bookable for share;
    if not found then
      raise exception using errcode='P0001',message='multi_resource_scope_unavailable';
    end if;
    v_catalog:=public.get_public_minuta_catalog_v5(v_slug);
    if not exists(select 1 from jsonb_array_elements(coalesce(v_catalog->'services','[]'::jsonb)) catalog_service
      where catalog_service->>'id'=v_service::text
        and coalesce(catalog_service->'location_ids','[]'::jsonb) ? v_location::text
        and catalog_service->>'performer_id'=v_performer::text) then
      raise exception using errcode='P0001',message='multi_resource_scope_unavailable';
    end if;
    if not exists(select 1 from public.get_available_slots(v_service,v_date,v_date) slot
      where slot.booking_date=v_date and slot.booking_time=v_time) then
      raise exception using errcode='P0001',message='slot_unavailable';
    end if;
    v_start:=(v_date+v_time) at time zone 'Europe/Samara';
    v_end:=v_start+make_interval(mins=>v_duration);
    if v_first_start is null then v_first_start:=v_start; end if;
    if v_end>v_first_start+interval '12 hours' then
      raise exception using errcode='22023',message='multi_resource_route_too_long';
    end if;
    if v_previous_end is not null then
      if v_location=v_previous_location then
        if exists(select 1 from jsonb_array_elements(v_transitions) transition
          where (transition->>'position')::integer=(v_item->>'position')::integer-1) then
          raise exception using errcode='22023',message='unexpected_multi_resource_transition';
        end if;
        if v_start<v_previous_end then
          raise exception using errcode='P0001',message='multi_resource_route_overlap';
        end if;
      else
        v_changed_legs:=v_changed_legs+1;
        select (transition->>'evidence_id')::uuid into v_evidence_id
        from jsonb_array_elements(v_transitions) transition
        where (transition->>'position')::integer=(v_item->>'position')::integer-1;
        if v_evidence_id is null then
          raise exception using errcode='P0001',message='trusted_travel_evidence_required';
        end if;
        select * into v_evidence from public.public_route_travel_evidence_v176 evidence
        where evidence.id=v_evidence_id and evidence.route_request_id=p_request_id
          and evidence.from_location_id=v_previous_location
          and evidence.to_location_id=v_location
          and evidence.departure_at=v_previous_end
          and evidence.measured_at<=clock_timestamp()
          and evidence.expires_at>clock_timestamp() for share;
        if not found or v_start<v_previous_end+make_interval(mins=>v_evidence.travel_minutes) then
          raise exception using errcode='P0001',message='trusted_travel_evidence_required';
        end if;
      end if;
    end if;
    v_resolved:=v_resolved||jsonb_build_array(v_item||jsonb_build_object(
      'organization_id',v_organization,'performer_id',v_performer
    ));
    v_previous_end:=v_end;
    v_previous_location:=v_location;
    v_evidence_id:=null;
  end loop;
  if v_changed_legs<>jsonb_array_length(v_transitions) then
    raise exception using errcode='22023',message='unused_multi_resource_transition';
  end if;

  -- Lock all touched calendars in stable order; the v2 booking function and
  -- exclusion constraint remain the final authority for each slot.
  for v_item in
    select value from jsonb_array_elements(v_resolved)
    order by value->>'performer_id',value->>'booking_date'
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'multi-resource-calendar:'||(v_item->>'performer_id')||':'||(v_item->>'booking_date'),17601
    ));
  end loop;
  insert into public.public_multi_resource_routes_v176(
    request_id,request_fingerprint,item_count,items_payload,transitions_payload
  ) values(p_request_id,v_fingerprint,v_count,v_items,v_transitions);

  for v_item in select value from jsonb_array_elements(v_resolved) loop
    select * into v_created from public.book_minuta_appointment_v2(
      (v_item->>'request_id')::uuid,v_item->>'organization_slug',
      (v_item->>'location_id')::uuid,(v_item->>'service_id')::uuid,
      (v_item->>'booking_date')::date,(v_item->>'booking_time')::time without time zone,
      trim(p_client_name),trim(p_client_phone),
      (v_item->>'expected_price_rub')::integer,
      (v_item->>'expected_duration_minutes')::integer
    );
    if v_created.result_code is distinct from 'ok' then
      raise exception using errcode='P0001',message='multi_resource_terms_changed';
    end if;
    select * into v_booking from public.bookings booking
    where booking.request_id=(v_item->>'request_id')::uuid for update;
    if not found or v_booking.organization_id is distinct from (v_item->>'organization_id')::uuid
       or v_booking.location_id is distinct from (v_item->>'location_id')::uuid
       or v_booking.performer_id is distinct from (v_item->>'performer_id')::uuid
       or v_booking.service_id is distinct from (v_item->>'service_id')::uuid
       or v_booking.booking_date is distinct from (v_item->>'booking_date')::date
       or v_booking.booking_time is distinct from (v_item->>'booking_time')::time without time zone
       or v_booking.duration_minutes is distinct from (v_item->>'expected_duration_minutes')::integer
       or v_booking.original_price_rub is distinct from (v_item->>'expected_price_rub')::integer
       or v_booking.booking_code is distinct from v_created.booking_code
       or v_booking.manage_token is distinct from v_created.manage_token then
      raise exception using errcode='55000',message='multi_resource_booking_acknowledgement_invalid';
    end if;
    insert into public.public_multi_resource_route_items_v176(
      route_request_id,position,booking_request_id,booking_id
    ) values(p_request_id,(v_item->>'position')::smallint,(v_item->>'request_id')::uuid,v_booking.id);
  end loop;
  select jsonb_build_object(
    'result_code','ok','request_id',p_request_id,'request_fingerprint',v_fingerprint,
    'idempotent',false,'bookings',coalesce(jsonb_agg(jsonb_build_object(
      'position',route_item.position,'booking_code',booking.booking_code,
      'manage_token',booking.manage_token,'request_id',booking.request_id,
      'organization_id',booking.organization_id,'location_id',booking.location_id,
      'performer_id',booking.performer_id,'service_id',booking.service_id,
      'booking_date',booking.booking_date,'booking_time',booking.booking_time,
      'duration_minutes',booking.duration_minutes,'original_price_rub',booking.original_price_rub,
      'total_price_rub',booking.total_price_rub,'status',booking.status
    ) order by route_item.position),'[]'::jsonb)
  ) into v_results
  from public.public_multi_resource_route_items_v176 route_item
  join public.bookings booking on booking.id=route_item.booking_id
  where route_item.route_request_id=p_request_id;
  if jsonb_array_length(v_results->'bookings')<>v_count then
    raise exception using errcode='55000',message='multi_resource_commit_incomplete';
  end if;
  return v_results;
exception when exclusion_violation then
  raise exception using errcode='P0001',message='slot_unavailable';
end
$$;

revoke all on function public.book_minuta_multi_resource_route_v176(uuid,text,text,jsonb,jsonb)
  from public,anon,authenticated,service_role;
comment on function public.book_minuta_multi_resource_route_v176(uuid,text,text,jsonb,jsonb)
  is 'minuta:v176:multi-resource-route:candidate-disabled; trusted travel provider required';

notify pgrst,'reload schema';
commit;
