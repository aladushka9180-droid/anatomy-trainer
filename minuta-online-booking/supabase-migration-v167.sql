begin;
set local search_path=public,extensions,pg_catalog;

do $guard$
begin
  if to_regclass('public.bookings') is null
     or to_regclass('public.organizations') is null
     or to_regclass('public.locations') is null
     or to_regclass('public.services') is null
     or to_regclass('public.performer_profiles') is null
     or to_regclass('public.organization_memberships') is null
     or to_regprocedure('public.book_minuta_appointment_v2(uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer)') is null
     or to_regprocedure('public.get_public_minuta_catalog_v5(text)') is null
     or to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception using errcode='55000',message='v167_public_multi_service_prerequisites_missing';
  end if;
  if obj_description(
       'public.book_minuta_appointment_v2(uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer)'::regprocedure,
       'pg_proc'
     ) not like 'minuta_atomic_create_v153:sha256=%'
     or not has_function_privilege('anon','public.book_minuta_appointment_v2(uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer)','execute')
     or not has_function_privilege('authenticated','public.book_minuta_appointment_v2(uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer)','execute') then
    raise exception using errcode='55000',message='v167_atomic_booking_contract_drift';
  end if;
end
$guard$;

create table if not exists public.public_multi_service_routes_v167(
  request_id uuid primary key,
  request_fingerprint text not null check(request_fingerprint~'^[0-9a-f]{64}$'),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  location_id uuid not null,
  performer_id uuid not null references public.performer_profiles(id) on delete restrict,
  item_count smallint not null check(item_count between 2 and 6),
  items_payload jsonb not null check(jsonb_typeof(items_payload)='array'),
  created_at timestamptz not null default now(),
  unique(request_id,organization_id,location_id),
  foreign key(location_id,organization_id) references public.locations(id,organization_id) on delete restrict
);

create table if not exists public.public_multi_service_route_items_v167(
  route_request_id uuid not null references public.public_multi_service_routes_v167(request_id) on delete restrict,
  position smallint not null check(position between 1 and 6),
  booking_request_id uuid not null unique,
  booking_id uuid not null unique references public.bookings(id) on delete restrict,
  primary key(route_request_id,position)
);

alter table public.public_multi_service_routes_v167 enable row level security;
alter table public.public_multi_service_route_items_v167 enable row level security;
revoke all on table public.public_multi_service_routes_v167,public.public_multi_service_route_items_v167
  from public,anon,authenticated,service_role;
grant all on table public.public_multi_service_routes_v167,public.public_multi_service_route_items_v167 to service_role;

create or replace function public.book_minuta_multi_service_route_v167(
  p_request_id uuid,
  p_slug text,
  p_location uuid,
  p_client_name text,
  p_client_phone text,
  p_items jsonb
) returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_slug text:=lower(trim(coalesce(p_slug,'')));
  v_phone_digits text:=regexp_replace(coalesce(p_client_phone,''),'[^0-9]','','g');
  v_organization uuid;
  v_performer uuid;
  v_count integer;
  v_position integer:=0;
  v_item jsonb;
  v_item_request uuid;
  v_service uuid;
  v_date date;
  v_time time without time zone;
  v_price integer;
  v_duration integer;
  v_normalized jsonb:='[]'::jsonb;
  v_fingerprint text;
  v_existing public.public_multi_service_routes_v167%rowtype;
  v_created record;
  v_booking public.bookings%rowtype;
  v_results jsonb;
  v_catalog jsonb;
begin
  if p_request_id is null or p_location is null
     or v_slug!~'^[a-z0-9][a-z0-9-]{2,62}$'
     or coalesce(char_length(trim(p_client_name)),0) not between 2 and 80
     or char_length(v_phone_digits) not between 10 and 15
     or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception using errcode='22023',message='invalid_multi_service_route';
  end if;
  v_count:=jsonb_array_length(p_items);
  if v_count not between 2 and 6 then
    raise exception using errcode='22023',message='multi_service_route_size_invalid';
  end if;

  begin
    for v_item in select value from jsonb_array_elements(p_items) loop
      v_position:=v_position+1;
      if jsonb_typeof(v_item)<>'object'
         or (select count(*) from jsonb_object_keys(v_item))<>6
         or not v_item ?& array['request_id','service_id','booking_date','booking_time','expected_price_rub','expected_duration_minutes'] then
        raise exception using errcode='22023',message='invalid_multi_service_route_item';
      end if;
      v_item_request:=(v_item->>'request_id')::uuid;
      v_service:=(v_item->>'service_id')::uuid;
      v_date:=(v_item->>'booking_date')::date;
      v_time:=(v_item->>'booking_time')::time without time zone;
      v_price:=(v_item->>'expected_price_rub')::integer;
      v_duration:=(v_item->>'expected_duration_minutes')::integer;
      if v_item_request is null or v_item_request=p_request_id or v_service is null
         or v_date<current_date or v_date>current_date+31
         or v_price not between 0 and 10000000
         or v_duration not between 1 and 480 then
        raise exception using errcode='22023',message='invalid_multi_service_route_item';
      end if;
      v_normalized:=v_normalized||jsonb_build_array(jsonb_build_object(
        'position',v_position,'request_id',v_item_request,'service_id',v_service,
        'booking_date',v_date,'booking_time',v_time,
        'expected_price_rub',v_price,'expected_duration_minutes',v_duration
      ));
    end loop;
  exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then
    raise exception using errcode='22023',message='invalid_multi_service_route_item';
  end;

  if (select count(distinct item->>'request_id') from jsonb_array_elements(v_normalized) item)<>v_count
     or (select count(distinct item->>'service_id') from jsonb_array_elements(v_normalized) item)<>v_count then
    raise exception using errcode='22023',message='multi_service_route_items_not_distinct';
  end if;

  select organization.id into v_organization
  from public.organizations organization
  where organization.public_slug=v_slug
    and organization.status='active'
    and organization.public_booking_enabled
  for share;
  if v_organization is null then
    raise exception using errcode='P0001',message='organization_unavailable';
  end if;
  perform 1 from public.locations location
  where location.id=p_location and location.organization_id=v_organization
    and location.active and location.timezone='Europe/Samara'
  for share;
  if not found then raise exception using errcode='P0001',message='location_unavailable'; end if;

  v_fingerprint:=encode(extensions.digest(convert_to(
    v_slug||chr(31)||p_location::text||chr(31)||trim(p_client_name)||chr(31)||
    v_phone_digits||chr(31)||v_normalized::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('multi-service-route:'||p_request_id::text,16700)
  );
  select * into v_existing from public.public_multi_service_routes_v167 route
  where route.request_id=p_request_id for update;
  if found then
    if v_existing.request_fingerprint is distinct from v_fingerprint
       or v_existing.organization_id is distinct from v_organization
       or v_existing.location_id is distinct from p_location
       or v_existing.item_count is distinct from v_count
       or v_existing.items_payload is distinct from v_normalized then
      raise exception using errcode='P0001',message='multi_service_request_conflict';
    end if;
    select jsonb_build_object(
      'result_code','ok','request_id',v_existing.request_id,
      'request_fingerprint',v_existing.request_fingerprint,'idempotent',true,
      'bookings',coalesce(jsonb_agg(jsonb_build_object(
        'position',route_item.position,'booking_code',booking.booking_code,
        'manage_token',booking.manage_token,'request_id',booking.request_id,
        'service_id',booking.service_id,'booking_date',booking.booking_date,
        'booking_time',booking.booking_time,'duration_minutes',booking.duration_minutes,
        'original_price_rub',booking.original_price_rub,'total_price_rub',booking.total_price_rub,
        'status',booking.status
      ) order by route_item.position),'[]'::jsonb)
    ) into v_results
    from public.public_multi_service_route_items_v167 route_item
    join public.bookings booking on booking.id=route_item.booking_id
    where route_item.route_request_id=v_existing.request_id;
    if jsonb_array_length(v_results->'bookings')<>v_existing.item_count then
      raise exception using errcode='55000',message='multi_service_replay_incomplete';
    end if;
    return v_results;
  end if;

  if exists(select 1 from public.bookings booking join jsonb_array_elements(v_normalized) item
    on booking.request_id=(item->>'request_id')::uuid) then
    raise exception using errcode='P0001',message='multi_service_item_request_conflict';
  end if;

  select service.performer_id into v_performer
  from public.services service
  join jsonb_array_elements(v_normalized) item on service.id=(item->>'service_id')::uuid
  join public.organization_memberships membership
    on membership.organization_id=v_organization and membership.user_id=service.performer_id
    and membership.active and membership.is_bookable
  where service.active
  group by service.performer_id
  having count(*)=v_count and count(distinct service.id)=v_count;
  if v_performer is null then
    raise exception using errcode='P0001',message='multi_service_scope_unavailable';
  end if;

  v_catalog:=public.get_public_minuta_catalog_v5(v_slug);
  if exists(
    select 1 from jsonb_array_elements(v_normalized) item
    where not exists(
      select 1 from jsonb_array_elements(coalesce(v_catalog->'services','[]'::jsonb)) service
      where service->>'id'=item->>'service_id'
        and coalesce(service->'location_ids','[]'::jsonb) ? p_location::text
        and service->>'performer_id'=v_performer::text
    )
  ) then raise exception using errcode='P0001',message='multi_service_scope_unavailable'; end if;

  insert into public.public_multi_service_routes_v167(
    request_id,request_fingerprint,organization_id,location_id,performer_id,item_count,items_payload
  ) values(p_request_id,v_fingerprint,v_organization,p_location,v_performer,v_count,v_normalized);

  for v_item in select value from jsonb_array_elements(v_normalized) loop
    select * into v_created from public.book_minuta_appointment_v2(
      (v_item->>'request_id')::uuid,v_slug,p_location,(v_item->>'service_id')::uuid,
      (v_item->>'booking_date')::date,(v_item->>'booking_time')::time without time zone,
      trim(p_client_name),trim(p_client_phone),(v_item->>'expected_price_rub')::integer,
      (v_item->>'expected_duration_minutes')::integer
    );
    if v_created.result_code is distinct from 'ok' then
      raise exception using errcode='P0001',message='multi_service_terms_changed';
    end if;
    select * into v_booking from public.bookings booking
    where booking.request_id=(v_item->>'request_id')::uuid for update;
    if not found or v_booking.organization_id is distinct from v_organization
       or v_booking.location_id is distinct from p_location
       or v_booking.performer_id is distinct from v_performer
       or v_booking.service_id is distinct from (v_item->>'service_id')::uuid
       or v_booking.booking_date is distinct from (v_item->>'booking_date')::date
       or v_booking.booking_time is distinct from (v_item->>'booking_time')::time without time zone
       or v_booking.booking_code is distinct from v_created.booking_code
       or v_booking.manage_token is distinct from v_created.manage_token then
      raise exception using errcode='55000',message='multi_service_booking_acknowledgement_invalid';
    end if;
    insert into public.public_multi_service_route_items_v167(
      route_request_id,position,booking_request_id,booking_id
    ) values(p_request_id,(v_item->>'position')::smallint,(v_item->>'request_id')::uuid,v_booking.id);
  end loop;

  select jsonb_build_object(
    'result_code','ok','request_id',p_request_id,'request_fingerprint',v_fingerprint,
    'idempotent',false,'bookings',jsonb_agg(jsonb_build_object(
      'position',route_item.position,'booking_code',booking.booking_code,
      'manage_token',booking.manage_token,'request_id',booking.request_id,
      'service_id',booking.service_id,'booking_date',booking.booking_date,
      'booking_time',booking.booking_time,'duration_minutes',booking.duration_minutes,
      'original_price_rub',booking.original_price_rub,'total_price_rub',booking.total_price_rub,
      'status',booking.status
    ) order by route_item.position)
  ) into v_results
  from public.public_multi_service_route_items_v167 route_item
  join public.bookings booking on booking.id=route_item.booking_id
  where route_item.route_request_id=p_request_id;
  if jsonb_array_length(v_results->'bookings')<>v_count then
    raise exception using errcode='55000',message='multi_service_commit_incomplete';
  end if;
  return v_results;
exception
  when exclusion_violation then
    raise exception using errcode='P0001',message='slot_unavailable';
end
$$;

revoke all on function public.book_minuta_multi_service_route_v167(uuid,text,uuid,text,text,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.book_minuta_multi_service_route_v167(uuid,text,uuid,text,text,jsonb)
  to anon,authenticated;
comment on function public.book_minuta_multi_service_route_v167(uuid,text,uuid,text,text,jsonb)
  is 'minuta:v167:public-multi-service-route:enabled';

notify pgrst,'reload schema';
commit;
