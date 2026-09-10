\set ON_ERROR_STOP on

begin;
set local lock_timeout='5s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $guard$
begin
  if to_regprocedure('public.get_public_minuta_catalog_v5(text)') is null
     or to_regclass('public.organization_client_profiles') is null
     or to_regclass('public.organization_booking_policy_settings') is null
     or to_regclass('public.organization_booking_policy_rules') is null
     or to_regclass('public.booking_policies') is null
     or to_regprocedure('public.normalize_client_phone(text)') is null
     or to_regprocedure('public.get_public_minuta_available_slots_v101(text,uuid,uuid,date,date)') is null
     or to_regprocedure('public.get_primetime_slot_ranges_v139(text,uuid,uuid,date,date,text)') is null
     or to_regprocedure('public.book_minuta_appointment(uuid,text,uuid,uuid,date,time without time zone,text,text)') is null
     or to_regprocedure('public.reschedule_booking_v2(uuid,date,time without time zone,uuid)') is null
     or to_regprocedure('public.cancel_booking_v2(uuid)') is null
     or to_regprocedure('public.resolve_minuta_booking_policy(uuid,uuid,uuid)') is null
     or to_regprocedure('extensions.digest(bytea,text)') is null
     or to_regprocedure('public.track_public_booking_funnel_event(text,uuid,text,uuid,uuid,text,text,text,text,text,text,text)') is null then
    raise exception using errcode='55000',message='v140_yandex_booking_prerequisites_missing';
  end if;
end
$guard$;

-- Provider-neutral connection state.  No row is created by this migration and
-- every future row starts disabled.  Partner credentials stay in Edge Secrets.
create table if not exists public.yandex_booking_connections_v140(
  id uuid primary key default gen_random_uuid(),
  partner_name text not null check(partner_name~'^[a-z][a-z0-9_-]{1,39}$'),
  environment text not null check(environment in('testing','production')),
  external_company_id text not null check(external_company_id~'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$'),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete restrict,
  approval_status text not null default 'pending' check(approval_status in('pending','approved','rejected','disabled')),
  enabled boolean not null default false,
  rubrics text[] not null default '{}'::text[]
    check(cardinality(rubrics)<=100 and array_position(rubrics,null) is null and array_position(rubrics,'') is null),
  permalink text check(permalink is null or char_length(permalink) between 1 and 200),
  booking_url text check(
    booking_url is null or (
      char_length(booking_url) between 1 and 2048
      and booking_url~'^https://[^[:space:]]+$'
    )
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(partner_name,environment,external_company_id),
  unique(partner_name,environment,organization_id,location_id),
  unique(id,partner_name,environment,external_company_id),
  foreign key(location_id,organization_id) references public.locations(id,organization_id),
  constraint yandex_booking_connections_v140_enabled_check check(
    not enabled or (
      approval_status='approved'
      and cardinality(rubrics)>0
      and booking_url is not null
    )
  )
);

create table if not exists public.yandex_booking_mappings_v140(
  id uuid primary key default gen_random_uuid(),
  partner_name text not null check(partner_name~'^[a-z][a-z0-9_-]{1,39}$'),
  environment text not null check(environment in('testing','production')),
  external_company_id text not null,
  external_booking_id text not null check(external_booking_id~'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$'),
  connection_id uuid not null references public.yandex_booking_connections_v140(id) on delete restrict,
  local_booking_id uuid not null references public.bookings(id) on delete restrict,
  idempotency_key text not null check(char_length(idempotency_key) between 1 and 200),
  prebooking boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(partner_name,environment,external_company_id,external_booking_id),
  unique(partner_name,environment,external_booking_id),
  unique(connection_id,local_booking_id),
  unique(connection_id,idempotency_key),
  foreign key(connection_id,partner_name,environment,external_company_id)
    references public.yandex_booking_connections_v140(id,partner_name,environment,external_company_id)
    on delete restrict
);

-- Partner email is validated but not persisted. Client comments use only
-- bookings.provider_note, covered by export_minuta_organization_data_v110 and
-- run_minuta_privacy_cleanup_v110, instead of creating a second PII store.

create table if not exists public.yandex_booking_receipts_v140(
  partner_name text not null check(partner_name~'^[a-z][a-z0-9_-]{1,39}$'),
  environment text not null check(environment in('testing','production')),
  external_company_id text not null,
  connection_id uuid not null,
  idempotency_key text not null check(char_length(idempotency_key) between 1 and 200),
  operation_kind text not null check(operation_kind in('create','update','cancel')),
  payload_sha256 text not null check(payload_sha256~'^[0-9a-f]{64}$'),
  external_booking_id text,
  result jsonb not null check(result='{"ok":true}'::jsonb),
  created_at timestamptz not null default now(),
  primary key(partner_name,environment,external_company_id,idempotency_key),
  unique(connection_id,idempotency_key),
  foreign key(connection_id,partner_name,environment,external_company_id)
    references public.yandex_booking_connections_v140(id,partner_name,environment,external_company_id)
    on delete restrict,
  foreign key(partner_name,environment,external_company_id,external_booking_id)
    references public.yandex_booking_mappings_v140(partner_name,environment,external_company_id,external_booking_id)
    on delete restrict
);

-- Fixed-window counters contain hashes and coarse operation classes only. Raw
-- JWTs and client fields are never persisted in the limiter.
create table if not exists public.yandex_booking_rate_limits_v140(
  partner_name text not null default 'yandex' check(partner_name='yandex'),
  environment text not null check(environment in('testing','production')),
  credential_hash text not null check(credential_hash~'^[0-9a-f]{64}$'),
  scope_hash text not null check(scope_hash~'^[0-9a-f]{64}$'),
  operation_class text not null check(operation_class in('read','mutation')),
  window_started_at timestamptz not null,
  request_count integer not null check(request_count>0),
  primary key(partner_name,environment,credential_hash,scope_hash,operation_class,window_started_at)
);

alter table public.yandex_booking_connections_v140 enable row level security;
alter table public.yandex_booking_mappings_v140 enable row level security;
alter table public.yandex_booking_receipts_v140 enable row level security;
alter table public.yandex_booking_rate_limits_v140 enable row level security;
revoke all on public.yandex_booking_connections_v140 from public,anon,authenticated,service_role;
revoke all on public.yandex_booking_mappings_v140 from public,anon,authenticated,service_role;
revoke all on public.yandex_booking_receipts_v140 from public,anon,authenticated,service_role;
revoke all on public.yandex_booking_rate_limits_v140 from public,anon,authenticated,service_role;

create index if not exists yandex_booking_rate_limits_v140_window_idx
  on public.yandex_booking_rate_limits_v140(window_started_at);

-- Internal helpers are deliberately not exposed through PostgREST.
create or replace function public.minuta_yandex_service_payment_free_v140(
  p_organization uuid,p_location uuid,p_service uuid,p_performer uuid
)
returns boolean language plpgsql stable security definer set search_path to '' as $$
declare v_policy jsonb;
begin
  if coalesce((select setting.enabled from public.organization_booking_policy_settings setting
      where setting.organization_id=p_organization),false) then
    v_policy:=public.resolve_minuta_booking_policy(p_organization,p_location,p_service);
    return v_policy<>'{}'::jsonb and coalesce(v_policy->>'deposit_mode','')='none';
  end if;
  return not exists(
    select 1 from public.booking_policies policy
    where policy.performer_id=p_performer and policy.deposit_enabled
      and policy.deposit_amount_rub>0 and policy.payment_url_template~*'^https://'
  );
end
$$;

create or replace function public.minuta_yandex_connection_v140(
  p_environment text,p_company_id text
)
returns table(
  connection_id uuid,organization_id uuid,location_id uuid,slug text,
  company_name text,address text,timezone text,rubrics text[],
  permalink text,booking_url text
)
language sql stable security definer set search_path to '' as $$
  select connection.id,organization.id,location.id,organization.public_slug,
    organization.name,location.address,location.timezone,connection.rubrics,
    connection.permalink,connection.booking_url
  from public.yandex_booking_connections_v140 connection
  join public.organizations organization on organization.id=connection.organization_id
  join public.locations location on location.id=connection.location_id
    and location.organization_id=organization.id
  where connection.partner_name='yandex'
    and connection.environment=p_environment
    and connection.external_company_id=p_company_id
    and connection.enabled and connection.approval_status='approved'
    and organization.status='active' and organization.public_booking_enabled
    and location.active
  limit 1
$$;

create or replace function public.minuta_yandex_all_services_v140(
  p_slug text,p_location uuid
)
returns table(
  organization_id uuid,service_id uuid,resource_id uuid,title text,duration_minutes integer,
  price_rub integer,resource_title text
)
language sql stable security definer set search_path to '' as $$
  with catalog as(
    select public.get_public_minuta_catalog_v5(p_slug) value
  )
  select (catalog.value->'organization'->>'id')::uuid,
    (service.item->>'id')::uuid,(service.item->>'performer_id')::uuid,
    service.item->>'name',(service.item->>'duration_minutes')::integer,
    (service.item->>'price_rub')::integer,
    service.item->'performer_profiles'->>'display_name'
  from catalog
  cross join lateral jsonb_array_elements(coalesce(catalog.value->'services','[]'::jsonb)) service(item)
  where coalesce(service.item->'location_ids','[]'::jsonb) ? p_location::text
  order by service.item->>'name',service.item->>'id'
$$;

create or replace function public.minuta_yandex_services_v140(
  p_slug text,p_location uuid
)
returns table(
  service_id uuid,resource_id uuid,title text,duration_minutes integer,
  price_rub integer,resource_title text
)
language sql stable security definer set search_path to '' as $$
  select service.service_id,service.resource_id,service.title,service.duration_minutes,
    service.price_rub,service.resource_title
  from public.minuta_yandex_all_services_v140(p_slug,p_location) service
  where public.minuta_yandex_service_payment_free_v140(
    service.organization_id,p_location,service.service_id,service.resource_id
  )
  order by service.title,service.service_id
$$;

create or replace function public.minuta_yandex_iso_datetime_v140(
  p_local timestamp without time zone,p_timezone text
)
returns text language plpgsql stable security definer set search_path to '' as $$
declare v_utc timestamp without time zone; v_offset integer;
begin
  if p_local is null or nullif(p_timezone,'') is null then return null; end if;
  v_utc:=(p_local at time zone p_timezone) at time zone 'UTC';
  v_offset:=round(extract(epoch from (p_local-v_utc))/60)::integer;
  return to_char(p_local,'YYYY-MM-DD"T"HH24:MI:SS')
    ||case when v_offset<0 then '-' else '+' end
    ||lpad((abs(v_offset)/60)::integer::text,2,'0')
    ||':'||lpad((abs(v_offset)%60)::text,2,'0');
end
$$;

create or replace function public.minuta_yandex_booking_snapshot_v140(
  p_environment text,p_booking_id text
)
returns jsonb language sql stable security definer set search_path to '' as $$
  select jsonb_build_object(
    'id',partner.external_booking_id,
    'company_id',connection.external_company_id,
    'service_ids',jsonb_build_array(booking.service_id::text),
    'resource_id',booking.performer_id::text,
    'datetime',public.minuta_yandex_iso_datetime_v140(booking.booking_date+booking.booking_time,location.timezone),
    'status',booking.status,
    'prebooking',partner.prebooking,
    'comment',coalesce(booking.provider_note,'')
  )
  from public.yandex_booking_mappings_v140 partner
  join public.yandex_booking_connections_v140 connection on connection.id=partner.connection_id
  join public.locations location on location.id=connection.location_id
  join public.bookings booking on booking.id=partner.local_booking_id
  where partner.external_booking_id=p_booking_id and partner.partner_name='yandex'
    and partner.environment=p_environment
    and connection.environment=p_environment
    and connection.enabled and connection.approval_status='approved'
$$;

revoke all on function public.minuta_yandex_service_payment_free_v140(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.minuta_yandex_connection_v140(text,text) from public,anon,authenticated,service_role;
revoke all on function public.minuta_yandex_all_services_v140(text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.minuta_yandex_services_v140(text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.minuta_yandex_iso_datetime_v140(timestamp without time zone,text) from public,anon,authenticated,service_role;
revoke all on function public.minuta_yandex_booking_snapshot_v140(text,text) from public,anon,authenticated,service_role;

create or replace function public.consume_yandex_booking_rate_limit_v140(
  p_environment text,p_credential_hash text,p_scope_key text,p_operation text
)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_class text; v_limit integer; v_window timestamptz; v_count integer; v_retry integer;
  v_scope_hash text;
begin
  if coalesce(p_environment,'') not in('testing','production')
     or coalesce(p_credential_hash,'')!~'^[0-9a-f]{64}$'
     or char_length(coalesce(p_scope_key,'')) not between 1 and 500
     or coalesce(p_operation,'') not in(
       'get:feed','get:services','get:resources','get:reviews','get:available_dates',
       'get:available_time_slots','get:special_conditions','get:booking',
       'post:bookings','put:booking','delete:booking','post:prebookings','delete:prebooking'
     ) then
    raise exception using errcode='22023',message='invalid_yandex_rate_limit_scope';
  end if;
  v_class:=case when p_operation like 'get:%' then 'read' else 'mutation' end;
  v_limit:=case when v_class='read' then 120 else 30 end;
  v_window:=date_trunc('minute',clock_timestamp());
  v_scope_hash:=encode(extensions.digest(convert_to(p_scope_key,'UTF8'),'sha256'),'hex');
  insert into public.yandex_booking_rate_limits_v140(
    partner_name,environment,credential_hash,scope_hash,operation_class,window_started_at,request_count
  ) values('yandex',p_environment,p_credential_hash,v_scope_hash,v_class,v_window,1)
  on conflict(partner_name,environment,credential_hash,scope_hash,operation_class,window_started_at)
  do update set request_count=public.yandex_booking_rate_limits_v140.request_count+1
  returning request_count into v_count;
  delete from public.yandex_booking_rate_limits_v140 where window_started_at<v_window-interval '10 minutes';
  v_retry:=greatest(1,ceil(extract(epoch from (v_window+interval '1 minute'-clock_timestamp())))::integer);
  return jsonb_build_object(
    'ok',true,'allowed',v_count<=v_limit,
    'retry_after',case when v_count<=v_limit then 0 else v_retry end,
    'limit',v_limit,'remaining',greatest(0,v_limit-v_count)
  );
end
$$;

revoke all on function public.consume_yandex_booking_rate_limit_v140(text,text,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.consume_yandex_booking_rate_limit_v140(text,text,text,text)
  to service_role;

create or replace function public.get_yandex_booking_feed_v140(
  p_environment text,p_cursor text,p_count integer
)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_result jsonb;
begin
  if coalesce(p_environment,'') not in('testing','production') or p_count is null or p_count<1 or p_count>500
     or char_length(coalesce(p_cursor,''))>200 then
    raise exception using errcode='22023',message='invalid_yandex_feed_scope';
  end if;
  with candidates as(
    select connection.*,organization.name,organization.public_slug,
      location.address,location.timezone
    from public.yandex_booking_connections_v140 connection
    join public.organizations organization on organization.id=connection.organization_id
    join public.locations location on location.id=connection.location_id
      and location.organization_id=organization.id
    where connection.partner_name='yandex' and connection.environment=p_environment
      and connection.enabled and connection.approval_status='approved'
      and connection.external_company_id>coalesce(p_cursor,'')
      and organization.status='active' and organization.public_booking_enabled
      and location.active
      and exists(select 1 from public.minuta_yandex_services_v140(organization.public_slug,location.id) service)
    order by connection.external_company_id
    limit p_count+1
  ), prepared as(
    select candidate.*,
      coalesce((select jsonb_agg(jsonb_build_object(
        'id',service.service_id::text,'title',service.title,
        'price',jsonb_build_object('currencyCode','RUB','range',jsonb_build_array(service.price_rub,service.price_rub)),
        'durationSeconds',service.duration_minutes*60,
        'resources',jsonb_build_array(jsonb_build_object('id',service.resource_id::text,'durationSeconds',service.duration_minutes*60))
      ) order by service.title,service.service_id)
      from public.minuta_yandex_services_v140(candidate.public_slug,candidate.location_id) service),'[]'::jsonb) services,
      coalesce((select jsonb_agg(jsonb_build_object('id',resource.resource_id::text,'title',resource.resource_title)
        order by resource.resource_title,resource.resource_id)
        from(select distinct service.resource_id,service.resource_title
          from public.minuta_yandex_services_v140(candidate.public_slug,candidate.location_id) service) resource),'[]'::jsonb) resources
    from candidates candidate
  ), page as(
    select * from prepared where jsonb_array_length(services)>0 order by external_company_id limit p_count
  )
  select jsonb_build_object(
    'ok',true,
    'companies',coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id',page.external_company_id,'name',page.name,'address',page.address,
      'services',page.services,'resources',page.resources,'rubrics',to_jsonb(page.rubrics),
      'permalink',page.permalink,'bookingUrl',page.booking_url
    )) order by page.external_company_id),'[]'::jsonb),
    'next_cursor',case when (select count(*) from prepared)>p_count
      then (select max(external_company_id) from page) else null end
  ) into v_result from page;
  return coalesce(v_result,jsonb_build_object('ok',true,'companies','[]'::jsonb,'next_cursor',null));
end
$$;

create or replace function public.get_yandex_booking_services_v140(
  p_environment text,p_company_id text,p_resource_id text
)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_connection record; v_services jsonb;
begin
  if coalesce(p_environment,'') not in('testing','production') or p_company_id is null
     or (p_resource_id is not null and p_resource_id!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') then
    raise exception using errcode='22023',message='invalid_yandex_services_scope';
  end if;
  select * into v_connection from public.minuta_yandex_connection_v140(p_environment,p_company_id);
  if not found then return jsonb_build_object('ok',false,'error','company_not_found'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',service.service_id::text,'title',service.title,
    'price',jsonb_build_object('currencyCode','RUB','range',jsonb_build_array(service.price_rub,service.price_rub)),
    'durationSeconds',service.duration_minutes*60,
    'resources',jsonb_build_array(jsonb_build_object('id',service.resource_id::text,'durationSeconds',service.duration_minutes*60))
  ) order by service.title,service.service_id),'[]'::jsonb) into v_services
  from public.minuta_yandex_services_v140(v_connection.slug,v_connection.location_id) service
  where p_resource_id is null or service.resource_id::text=p_resource_id;
  if p_resource_id is not null and jsonb_array_length(v_services)=0 then
    return jsonb_build_object('ok',false,'error','resource_not_found');
  end if;
  return jsonb_build_object('ok',true,'services',v_services);
end
$$;

create or replace function public.get_yandex_booking_resources_v140(
  p_environment text,p_company_id text,p_service_ids text[]
)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_connection record; v_resources jsonb; v_requested integer;
begin
  v_requested:=coalesce(cardinality(p_service_ids),0);
  if coalesce(p_environment,'') not in('testing','production') or p_company_id is null or v_requested>20
     or exists(select 1 from unnest(p_service_ids) id where coalesce(id,'')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
     or (select count(distinct id) from unnest(p_service_ids) id)<>v_requested then
    raise exception using errcode='22023',message='invalid_yandex_resources_scope';
  end if;
  select * into v_connection from public.minuta_yandex_connection_v140(p_environment,p_company_id);
  if not found then return jsonb_build_object('ok',false,'error','company_not_found'); end if;
  if v_requested>0 and (select count(*) from public.minuta_yandex_services_v140(v_connection.slug,v_connection.location_id) service where service.service_id::text=any(p_service_ids))<>v_requested then
    return jsonb_build_object('ok',false,'error','service_not_found');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',candidate.resource_id::text,'title',candidate.resource_title)
    order by candidate.resource_title,candidate.resource_id),'[]'::jsonb) into v_resources
  from(
    select service.resource_id,min(service.resource_title) resource_title
    from public.minuta_yandex_services_v140(v_connection.slug,v_connection.location_id) service
    where v_requested=0 or service.service_id::text=any(p_service_ids)
    group by service.resource_id having v_requested=0 or count(*)=v_requested
  ) candidate;
  return jsonb_build_object('ok',true,'resources',v_resources);
end
$$;

create or replace function public.get_yandex_booking_available_dates_v140(
  p_environment text,p_company_id text,p_service_ids text[],p_resource_id text,
  p_from date,p_to date
)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_connection record; v_service record; v_dates jsonb; v_today date;
begin
  if coalesce(p_environment,'') not in('testing','production') or coalesce(cardinality(p_service_ids),0)<>1
     or coalesce(p_service_ids[1],'')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or (p_resource_id is not null and p_resource_id!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
     or p_from is null or p_to is null or p_to<p_from or p_to-p_from>14 then
    raise exception using errcode='22023',message='invalid_yandex_dates_scope';
  end if;
  select * into v_connection from public.minuta_yandex_connection_v140(p_environment,p_company_id);
  if not found then return jsonb_build_object('ok',false,'error','company_not_found'); end if;
  v_today:=(clock_timestamp() at time zone v_connection.timezone)::date;
  if p_from<v_today or p_to>v_today+14 then
    raise exception using errcode='22023',message='invalid_yandex_dates_scope';
  end if;
  select * into v_service from public.minuta_yandex_services_v140(v_connection.slug,v_connection.location_id) service
    where service.service_id::text=p_service_ids[1];
  if not found then return jsonb_build_object('ok',false,'error','service_not_found'); end if;
  if p_resource_id is not null and p_resource_id<>v_service.resource_id::text then return jsonb_build_object('ok',false,'error','resource_not_found'); end if;
  select coalesce(jsonb_agg(value.booking_date::text order by value.booking_date),'[]'::jsonb) into v_dates
  from(select distinct slot.booking_date from public.get_public_minuta_available_slots_v101(
    v_connection.slug,v_connection.location_id,v_service.service_id,p_from,p_to
  ) slot) value;
  return jsonb_build_object('ok',true,'dates',v_dates);
end
$$;

create or replace function public.get_yandex_booking_available_time_slots_v140(
  p_environment text,p_company_id text,p_service_ids text[],p_resource_id text,p_date date
)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_connection record; v_service record; v_slots jsonb; v_today date;
begin
  if coalesce(p_environment,'') not in('testing','production') or coalesce(cardinality(p_service_ids),0)<>1
     or coalesce(p_service_ids[1],'')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or (p_resource_id is not null and p_resource_id!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
     or p_date is null then
    raise exception using errcode='22023',message='invalid_yandex_slots_scope';
  end if;
  select * into v_connection from public.minuta_yandex_connection_v140(p_environment,p_company_id);
  if not found then return jsonb_build_object('ok',false,'error','company_not_found'); end if;
  v_today:=(clock_timestamp() at time zone v_connection.timezone)::date;
  if p_date<v_today or p_date>v_today+14 then
    raise exception using errcode='22023',message='invalid_yandex_slots_scope';
  end if;
  select * into v_service from public.minuta_yandex_services_v140(v_connection.slug,v_connection.location_id) service where service.service_id::text=p_service_ids[1];
  if not found then return jsonb_build_object('ok',false,'error','service_not_found'); end if;
  if p_resource_id is not null and p_resource_id<>v_service.resource_id::text then return jsonb_build_object('ok',false,'error','resource_not_found'); end if;
  select coalesce(jsonb_agg(
    public.minuta_yandex_iso_datetime_v140(slot.booking_date+slot.booking_time,v_connection.timezone)
    order by slot.booking_time
  ),'[]'::jsonb) into v_slots
  from public.get_public_minuta_available_slots_v101(
    v_connection.slug,v_connection.location_id,v_service.service_id,p_date,p_date
  ) slot;
  return jsonb_build_object('ok',true,'slots',v_slots);
end
$$;

create or replace function public.get_yandex_booking_special_conditions_v140(
  p_environment text,p_company_id text,p_service_ids text[],p_resource_id text,p_datetime timestamptz
)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_connection record; v_service record; v_local timestamp; v_available boolean; v_today date;
begin
  if coalesce(p_environment,'') not in('testing','production') or coalesce(cardinality(p_service_ids),0)<>1
     or coalesce(p_service_ids[1],'')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or p_datetime is null
     or (p_resource_id is not null and p_resource_id!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') then
    raise exception using errcode='22023',message='invalid_yandex_conditions_scope';
  end if;
  select * into v_connection from public.minuta_yandex_connection_v140(p_environment,p_company_id);
  if not found then return jsonb_build_object('ok',false,'error','company_not_found'); end if;
  v_today:=(clock_timestamp() at time zone v_connection.timezone)::date;
  select * into v_service from public.minuta_yandex_services_v140(v_connection.slug,v_connection.location_id) service where service.service_id::text=p_service_ids[1];
  if not found then return jsonb_build_object('ok',false,'error','service_not_found'); end if;
  if p_resource_id is not null and p_resource_id<>v_service.resource_id::text then return jsonb_build_object('ok',false,'error','resource_not_found'); end if;
  v_local:=p_datetime at time zone v_connection.timezone;
  v_available:=v_local::date between v_today and v_today+14 and exists(
    select 1 from public.get_public_minuta_available_slots_v101(v_connection.slug,v_connection.location_id,v_service.service_id,v_local::date,v_local::date) slot
    where slot.booking_time=v_local::time
  );
  return jsonb_build_object('ok',true,'conditions',case when v_available then '[]'::jsonb else
    jsonb_build_array(jsonb_build_object('title','Выбранное время недоступно')) end);
end
$$;

create or replace function public.create_yandex_booking_v140(
  p_environment text,p_request_key text,p_payload_sha256 text,p_company_id text,
  p_service_ids text[],p_resource_id text,p_datetime timestamptz,p_first_name text,
  p_last_name text,p_phone text,p_email text,p_comment text,p_prebooking boolean
)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_connection record; v_service record; v_local timestamp; v_receipt record;
  v_request_id uuid; v_external_booking_id text; v_local_booking uuid; v_code text; v_token uuid;
  v_result jsonb; v_name text; v_phone text; v_deposit integer; v_today date;
begin
  if coalesce(p_environment,'') not in('testing','production') or char_length(coalesce(p_request_key,'')) not between 1 and 200
     or coalesce(p_payload_sha256,'')!~'^[0-9a-f]{64}$' or coalesce(cardinality(p_service_ids),0)<>1
     or coalesce(p_service_ids[1],'')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or p_datetime is null
     or char_length(trim(coalesce(p_first_name,''))) not between 1 and 80
     or char_length(trim(coalesce(p_last_name,'')))>80
     or char_length(regexp_replace(coalesce(p_phone,''),'[^0-9]','','g')) not between 10 and 15
     or (nullif(trim(coalesce(p_email,'')),'') is not null and (char_length(trim(p_email))>254 or trim(p_email)!~'^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'))
     or char_length(coalesce(p_comment,''))>1000
     or (p_resource_id is not null and p_resource_id!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') then
    raise exception using errcode='22023',message='invalid_yandex_create_payload';
  end if;
  v_phone:=public.normalize_client_phone(p_phone);
  if v_phone!~'^7[0-9]{10}$' then
    raise exception using errcode='22023',message='invalid_yandex_create_payload';
  end if;
  if coalesce(p_prebooking,false) then return jsonb_build_object('ok',false,'error','prebooking_not_supported'); end if;
  select * into v_connection from public.minuta_yandex_connection_v140(p_environment,p_company_id);
  if not found then return jsonb_build_object('ok',false,'error','company_not_found'); end if;
  v_today:=(clock_timestamp() at time zone v_connection.timezone)::date;
  if exists(
    select 1 from public.organization_client_profiles profile
    where profile.organization_id=v_connection.organization_id
      and profile.normalized_phone=v_phone and profile.online_booking_blocked
  ) then
    return jsonb_build_object('ok',false,'error','create_forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('yandex:'||p_environment||':'||v_connection.connection_id::text||':'||p_request_key,140));
  select * into v_receipt from public.yandex_booking_receipts_v140 receipt
    where receipt.partner_name='yandex' and receipt.environment=p_environment
      and receipt.external_company_id=p_company_id and receipt.idempotency_key=p_request_key;
  if found then
    if v_receipt.operation_kind<>'create' or v_receipt.payload_sha256<>p_payload_sha256 then return jsonb_build_object('ok',false,'error','request_conflict'); end if;
    return jsonb_build_object('ok',true,'booking',public.minuta_yandex_booking_snapshot_v140(p_environment,v_receipt.external_booking_id));
  end if;
  select * into v_service from public.minuta_yandex_all_services_v140(v_connection.slug,v_connection.location_id) service
    where service.organization_id=v_connection.organization_id and service.service_id::text=p_service_ids[1];
  if not found then return jsonb_build_object('ok',false,'error','service_not_found'); end if;
  if p_resource_id is not null and p_resource_id<>v_service.resource_id::text then return jsonb_build_object('ok',false,'error','resource_not_found'); end if;
  if not public.minuta_yandex_service_payment_free_v140(
    v_connection.organization_id,v_connection.location_id,v_service.service_id,v_service.resource_id
  ) then
    return jsonb_build_object('ok',false,'error','create_forbidden');
  end if;
  v_local:=p_datetime at time zone v_connection.timezone;
  if date_trunc('minute',v_local)<>v_local or v_local::date<v_today or v_local::date>v_today+14 then
    raise exception using errcode='22023',message='invalid_yandex_booking_datetime';
  end if;
  v_request_id:=gen_random_uuid(); v_external_booking_id:=gen_random_uuid()::text;
  v_name:=trim(p_first_name||case when nullif(trim(coalesce(p_last_name,'')),'') is null then '' else ' '||trim(p_last_name) end);
  if char_length(v_name) not between 2 and 80 then
    raise exception using errcode='22023',message='invalid_yandex_create_payload';
  end if;
  begin
    select result.booking_code,result.manage_token into v_code,v_token
    from public.book_minuta_appointment(v_request_id,v_connection.slug,v_connection.location_id,
      v_service.service_id,v_local::date,v_local::time,v_name,v_phone) result;
    select booking.id,booking.deposit_amount_rub into v_local_booking,v_deposit
      from public.bookings booking where booking.request_id=v_request_id;
    if v_local_booking is null then
      raise exception using errcode='55000',message='yandex_booking_acknowledgement_missing';
    end if;
    if exists(
      select 1 from public.organization_client_profiles profile
      where profile.organization_id=v_connection.organization_id
        and profile.normalized_phone=v_phone and profile.online_booking_blocked
    ) then
      raise exception using errcode='P0001',message='yandex_client_blocked';
    end if;
    if coalesce(v_deposit,0)>0 then
      raise exception using errcode='P0001',message='yandex_payment_unsupported';
    end if;
  exception when others then
    if sqlerrm in('yandex_client_blocked','yandex_payment_unsupported') then
      return jsonb_build_object('ok',false,'error','create_forbidden');
    end if;
    if sqlerrm in('slot_unavailable','resource_unavailable','booking_buffer_conflict') then return jsonb_build_object('ok',false,'error','slot_unavailable'); end if;
    raise;
  end;
  update public.bookings set provider_note=trim(coalesce(p_comment,'')) where id=v_local_booking;
  insert into public.yandex_booking_mappings_v140(
    partner_name,environment,external_company_id,external_booking_id,connection_id,local_booking_id,idempotency_key,prebooking
  ) values('yandex',p_environment,p_company_id,v_external_booking_id,v_connection.connection_id,v_local_booking,p_request_key,false);
  perform public.track_public_booking_funnel_event(v_connection.slug,v_request_id,'booking_created',v_service.service_id,v_token,
    'search','yandex','maps','maps_booking_partner','yandex_api',null,'yandex');
  v_result:=jsonb_build_object('ok',true,'booking',public.minuta_yandex_booking_snapshot_v140(p_environment,v_external_booking_id));
  insert into public.yandex_booking_receipts_v140(
    partner_name,environment,external_company_id,connection_id,idempotency_key,operation_kind,payload_sha256,external_booking_id,result
  ) values('yandex',p_environment,p_company_id,v_connection.connection_id,p_request_key,'create',p_payload_sha256,v_external_booking_id,'{"ok":true}'::jsonb);
  return v_result;
end
$$;

create or replace function public.get_yandex_booking_v140(
  p_environment text,p_booking_id text
)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_snapshot jsonb;
begin
  if coalesce(p_environment,'') not in('testing','production') or coalesce(p_booking_id,'')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception using errcode='22023',message='invalid_yandex_booking_id';
  end if;
  v_snapshot:=public.minuta_yandex_booking_snapshot_v140(p_environment,p_booking_id);
  if v_snapshot is null then return jsonb_build_object('ok',false,'error','booking_not_found'); end if;
  return jsonb_build_object('ok',true,'booking',v_snapshot);
end
$$;

create or replace function public.update_yandex_booking_v140(
  p_environment text,p_request_key text,p_payload_sha256 text,p_booking_id text,
  p_company_id text,p_datetime timestamptz,p_comment text
)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_receipt record; v_partner record; v_connection record; v_booking record;
  v_local timestamp; v_result jsonb; v_today date;
begin
  if coalesce(p_environment,'') not in('testing','production') or char_length(coalesce(p_request_key,'')) not between 1 and 200
     or coalesce(p_payload_sha256,'')!~'^[0-9a-f]{64}$'
     or coalesce(p_booking_id,'')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or char_length(coalesce(p_comment,''))>1000 then
    raise exception using errcode='22023',message='invalid_yandex_update_payload';
  end if;
  select partner.*,connection.organization_id,connection.location_id
    into v_partner from public.yandex_booking_mappings_v140 partner
    join public.yandex_booking_connections_v140 connection on connection.id=partner.connection_id
    where partner.external_booking_id=p_booking_id and partner.partner_name='yandex'
      and partner.environment=p_environment and connection.partner_name=partner.partner_name
      and connection.environment=partner.environment and connection.enabled
      and connection.approval_status='approved';
  if not found then return jsonb_build_object('ok',false,'error','booking_not_found'); end if;
  if v_partner.external_company_id<>p_company_id then return jsonb_build_object('ok',false,'error','company_not_found'); end if;
  select * into v_connection from public.minuta_yandex_connection_v140(p_environment,p_company_id);
  if not found or v_connection.connection_id<>v_partner.connection_id then
    return jsonb_build_object('ok',false,'error','company_not_found');
  end if;
  v_today:=(clock_timestamp() at time zone v_connection.timezone)::date;
  perform pg_advisory_xact_lock(hashtextextended('yandex:'||p_environment||':'||v_partner.connection_id::text||':'||p_request_key,140));
  select * into v_receipt from public.yandex_booking_receipts_v140 receipt
    where receipt.partner_name='yandex' and receipt.environment=p_environment
      and receipt.external_company_id=v_partner.external_company_id and receipt.idempotency_key=p_request_key;
  if found then
    if v_receipt.operation_kind<>'update' or v_receipt.payload_sha256<>p_payload_sha256
       or v_receipt.external_booking_id<>p_booking_id then return jsonb_build_object('ok',false,'error','request_conflict'); end if;
    return jsonb_build_object('ok',true,'booking',public.minuta_yandex_booking_snapshot_v140(p_environment,v_receipt.external_booking_id));
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_partner.local_booking_id::text,7302));
  select * into v_booking from public.bookings booking where booking.id=v_partner.local_booking_id for update;
  if not found then return jsonb_build_object('ok',false,'error','booking_not_found'); end if;
  if p_datetime is not null then
    v_local:=p_datetime at time zone v_connection.timezone;
    if date_trunc('minute',v_local)<>v_local or v_local::date<v_today or v_local::date>v_today+14 then raise exception using errcode='22023',message='invalid_yandex_booking_datetime'; end if;
    begin
      perform public.reschedule_booking_v2(v_booking.manage_token,v_local::date,v_local::time,gen_random_uuid());
    exception when others then
      if sqlerrm in('slot_unavailable','resource_unavailable','booking_buffer_conflict','reschedule_too_late','reschedule_limit_reached') then return jsonb_build_object('ok',false,'error',sqlerrm); end if;
      raise;
    end;
  end if;
  if p_comment is not null then
    update public.bookings set provider_note=trim(p_comment) where id=v_partner.local_booking_id;
  end if;
  update public.yandex_booking_mappings_v140 set updated_at=now() where id=v_partner.id;
  v_result:=jsonb_build_object('ok',true,'booking',public.minuta_yandex_booking_snapshot_v140(p_environment,p_booking_id));
  insert into public.yandex_booking_receipts_v140(
    partner_name,environment,external_company_id,connection_id,idempotency_key,operation_kind,payload_sha256,external_booking_id,result
  ) values('yandex',p_environment,v_partner.external_company_id,v_partner.connection_id,p_request_key,'update',p_payload_sha256,p_booking_id,'{"ok":true}'::jsonb);
  return v_result;
end
$$;

create or replace function public.cancel_yandex_booking_v140(
  p_environment text,p_request_key text,p_payload_sha256 text,p_booking_id text,p_company_id text
)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_receipt record; v_partner record; v_booking record; v_result jsonb;
begin
  if coalesce(p_environment,'') not in('testing','production') or char_length(coalesce(p_request_key,'')) not between 1 and 200
     or coalesce(p_payload_sha256,'')!~'^[0-9a-f]{64}$'
     or coalesce(p_booking_id,'')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception using errcode='22023',message='invalid_yandex_cancel_payload';
  end if;
  select partner.* into v_partner from public.yandex_booking_mappings_v140 partner
    join public.yandex_booking_connections_v140 connection on connection.id=partner.connection_id
    where partner.external_booking_id=p_booking_id and partner.partner_name='yandex'
      and partner.environment=p_environment and connection.partner_name=partner.partner_name
      and connection.environment=partner.environment and connection.enabled
      and connection.approval_status='approved';
  if not found then return jsonb_build_object('ok',false,'error','booking_not_found'); end if;
  if p_company_id is not null and v_partner.external_company_id<>p_company_id then
    return jsonb_build_object('ok',false,'error','company_not_found');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('yandex:'||p_environment||':'||v_partner.connection_id::text||':'||p_request_key,140));
  select * into v_receipt from public.yandex_booking_receipts_v140 receipt
    where receipt.partner_name='yandex' and receipt.environment=p_environment
      and receipt.external_company_id=v_partner.external_company_id and receipt.idempotency_key=p_request_key;
  if found then
    if v_receipt.operation_kind<>'cancel' or v_receipt.payload_sha256<>p_payload_sha256
       or v_receipt.external_booking_id<>p_booking_id then return jsonb_build_object('ok',false,'error','request_conflict'); end if;
    return jsonb_build_object('ok',true,'booking',public.minuta_yandex_booking_snapshot_v140(p_environment,v_receipt.external_booking_id));
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_partner.local_booking_id::text,7302));
  select * into v_booking from public.bookings booking where booking.id=v_partner.local_booking_id for update;
  if not found then return jsonb_build_object('ok',false,'error','booking_not_found'); end if;
  if v_booking.status='cancelled' then
    v_result:=jsonb_build_object('ok',true,'booking',public.minuta_yandex_booking_snapshot_v140(p_environment,p_booking_id));
    insert into public.yandex_booking_receipts_v140(
      partner_name,environment,external_company_id,connection_id,idempotency_key,operation_kind,payload_sha256,external_booking_id,result
    ) values('yandex',p_environment,v_partner.external_company_id,v_partner.connection_id,p_request_key,'cancel',p_payload_sha256,p_booking_id,'{"ok":true}'::jsonb);
    return v_result;
  end if;
  begin
    perform public.cancel_booking_v2(v_booking.manage_token);
  exception when others then
    if sqlerrm in('cancel_too_late','booking_unavailable') then return jsonb_build_object('ok',false,'error',sqlerrm); end if;
    raise;
  end;
  update public.yandex_booking_mappings_v140 set updated_at=now() where id=v_partner.id;
  v_result:=jsonb_build_object('ok',true,'booking',public.minuta_yandex_booking_snapshot_v140(p_environment,p_booking_id));
  insert into public.yandex_booking_receipts_v140(
    partner_name,environment,external_company_id,connection_id,idempotency_key,operation_kind,payload_sha256,external_booking_id,result
  ) values('yandex',p_environment,v_partner.external_company_id,v_partner.connection_id,p_request_key,'cancel',p_payload_sha256,p_booking_id,'{"ok":true}'::jsonb);
  return v_result;
end
$$;

revoke all on function public.get_yandex_booking_feed_v140(text,text,integer) from public,anon,authenticated,service_role;
revoke all on function public.get_yandex_booking_services_v140(text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.get_yandex_booking_resources_v140(text,text,text[]) from public,anon,authenticated,service_role;
revoke all on function public.get_yandex_booking_available_dates_v140(text,text,text[],text,date,date) from public,anon,authenticated,service_role;
revoke all on function public.get_yandex_booking_available_time_slots_v140(text,text,text[],text,date) from public,anon,authenticated,service_role;
revoke all on function public.get_yandex_booking_special_conditions_v140(text,text,text[],text,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.create_yandex_booking_v140(text,text,text,text,text[],text,timestamptz,text,text,text,text,text,boolean) from public,anon,authenticated,service_role;
revoke all on function public.get_yandex_booking_v140(text,text) from public,anon,authenticated,service_role;
revoke all on function public.update_yandex_booking_v140(text,text,text,text,text,timestamptz,text) from public,anon,authenticated,service_role;
revoke all on function public.cancel_yandex_booking_v140(text,text,text,text,text) from public,anon,authenticated,service_role;

grant execute on function public.get_yandex_booking_feed_v140(text,text,integer) to service_role;
grant execute on function public.get_yandex_booking_services_v140(text,text,text) to service_role;
grant execute on function public.get_yandex_booking_resources_v140(text,text,text[]) to service_role;
grant execute on function public.get_yandex_booking_available_dates_v140(text,text,text[],text,date,date) to service_role;
grant execute on function public.get_yandex_booking_available_time_slots_v140(text,text,text[],text,date) to service_role;
grant execute on function public.get_yandex_booking_special_conditions_v140(text,text,text[],text,timestamptz) to service_role;
grant execute on function public.create_yandex_booking_v140(text,text,text,text,text[],text,timestamptz,text,text,text,text,text,boolean) to service_role;
grant execute on function public.get_yandex_booking_v140(text,text) to service_role;
grant execute on function public.update_yandex_booking_v140(text,text,text,text,text,timestamptz,text) to service_role;
grant execute on function public.cancel_yandex_booking_v140(text,text,text,text,text) to service_role;

do $verify$
declare signature text;
begin
  foreach signature in array array[
    'public.consume_yandex_booking_rate_limit_v140(text,text,text,text)',
    'public.get_yandex_booking_feed_v140(text,text,integer)',
    'public.get_yandex_booking_services_v140(text,text,text)',
    'public.get_yandex_booking_resources_v140(text,text,text[])',
    'public.get_yandex_booking_available_dates_v140(text,text,text[],text,date,date)',
    'public.get_yandex_booking_available_time_slots_v140(text,text,text[],text,date)',
    'public.get_yandex_booking_special_conditions_v140(text,text,text[],text,timestamp with time zone)',
    'public.create_yandex_booking_v140(text,text,text,text,text[],text,timestamp with time zone,text,text,text,text,text,boolean)',
    'public.get_yandex_booking_v140(text,text)',
    'public.update_yandex_booking_v140(text,text,text,text,text,timestamp with time zone,text)',
    'public.cancel_yandex_booking_v140(text,text,text,text,text)'
  ] loop
    if to_regprocedure(signature) is null
       or not has_function_privilege('service_role',signature,'EXECUTE')
       or has_function_privilege('anon',signature,'EXECUTE')
       or has_function_privilege('authenticated',signature,'EXECUTE') then
      raise exception using errcode='55000',message='v140_yandex_booking_privilege_verification_failed';
    end if;
  end loop;
  if has_table_privilege('anon','public.yandex_booking_connections_v140','SELECT')
     or has_table_privilege('authenticated','public.yandex_booking_mappings_v140','SELECT')
     or has_table_privilege('service_role','public.yandex_booking_receipts_v140','SELECT')
     or has_table_privilege('service_role','public.yandex_booking_rate_limits_v140','SELECT') then
    raise exception using errcode='55000',message='v140_yandex_booking_table_verification_failed';
  end if;
end
$verify$;

notify pgrst,'reload schema';
commit;
