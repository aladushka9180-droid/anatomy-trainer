\set ON_ERROR_STOP on

begin;
set local lock_timeout='5s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $guard$
declare v_missing text[]:='{}'::text[];
begin
  if to_regclass('public.organizations') is null then v_missing:=array_append(v_missing,'organizations'); end if;
  if to_regclass('public.organization_memberships') is null then v_missing:=array_append(v_missing,'organization_memberships'); end if;
  if to_regclass('public.locations') is null then v_missing:=array_append(v_missing,'locations'); end if;
  if to_regclass('public.services') is null then v_missing:=array_append(v_missing,'services'); end if;
  if to_regclass('public.bookings') is null then v_missing:=array_append(v_missing,'bookings'); end if;
  if to_regclass('public.notification_outbox') is null then v_missing:=array_append(v_missing,'notification_outbox'); end if;
  if to_regprocedure('extensions.digest(bytea,text)') is null then v_missing:=array_append(v_missing,'extensions.digest'); end if;
  if to_regprocedure('extensions.gen_random_uuid()') is null then v_missing:=array_append(v_missing,'extensions.gen_random_uuid'); end if;
  if cardinality(v_missing)>0 then
    raise exception using errcode='55000',message='v142_integration_prerequisites_missing',detail=array_to_string(v_missing,',');
  end if;
end
$guard$;

create table if not exists public.integration_connections_v142(
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null check(provider~'^[a-z][a-z0-9_-]{1,39}$'),
  environment text not null check(environment in('testing','production')),
  external_account_id text not null check(external_account_id~'^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$'),
  enabled boolean not null default false,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,provider,environment,external_account_id),
  unique(id,organization_id)
);

create table if not exists public.integration_api_keys_v142(
  id uuid primary key,
  connection_id uuid not null references public.integration_connections_v142(id) on delete cascade,
  organization_id uuid not null,
  key_prefix text not null check(key_prefix~'^ptk_[0-9a-f-]{36}$'),
  secret_sha256 text not null unique check(secret_sha256~'^[0-9a-f]{64}$'),
  scopes text[] not null check(
    cardinality(scopes) between 1 and 8
    and array_position(scopes,null) is null
    and scopes<@array['calendar:read','calendar:write']::text[]
  ),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key(connection_id,organization_id)
    references public.integration_connections_v142(id,organization_id) on delete cascade,
  check(expires_at>created_at and expires_at<=created_at+interval '370 days')
);

create table if not exists public.integration_rate_limits_v142(
  connection_id uuid not null references public.integration_connections_v142(id) on delete cascade,
  key_id uuid not null references public.integration_api_keys_v142(id) on delete cascade,
  operation_class text not null check(operation_class in('read','mutation')),
  window_started_at timestamptz not null,
  request_count integer not null check(request_count>0),
  primary key(connection_id,key_id,operation_class,window_started_at)
);

create table if not exists public.integration_calendar_events_v142(
  id uuid primary key default extensions.gen_random_uuid(),
  connection_id uuid not null references public.integration_connections_v142(id) on delete cascade,
  organization_id uuid not null,
  external_event_id text not null check(external_event_id~'^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,159}$'),
  local_booking_id uuid not null references public.bookings(id) on delete restrict,
  location_id uuid not null references public.locations(id) on delete restrict,
  performer_id uuid not null references auth.users(id) on delete restrict,
  source_revision text not null check(source_revision~'^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,119}$'),
  payload_sha256 text not null check(payload_sha256~'^[0-9a-f]{64}$'),
  state text not null default 'active' check(state in('active','deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(connection_id,external_event_id),
  unique(connection_id,local_booking_id),
  foreign key(connection_id,organization_id)
    references public.integration_connections_v142(id,organization_id) on delete cascade,
  foreign key(location_id,organization_id)
    references public.locations(id,organization_id) on delete restrict
);

create table if not exists public.integration_request_receipts_v142(
  connection_id uuid not null references public.integration_connections_v142(id) on delete cascade,
  request_key text not null check(request_key~'^[0-9a-f]{64}$'),
  operation text not null check(operation in('calendar_upsert','calendar_delete')),
  entity_id text not null check(char_length(entity_id) between 1 and 160),
  payload_sha256 text not null check(payload_sha256~'^[0-9a-f]{64}$'),
  result jsonb not null check(jsonb_typeof(result)='object' and octet_length(result::text)<=8192),
  created_at timestamptz not null default now(),
  primary key(connection_id,request_key)
);

create table if not exists public.integration_webhook_subscriptions_v142(
  id uuid primary key,
  connection_id uuid not null references public.integration_connections_v142(id) on delete cascade,
  organization_id uuid not null,
  target_url text not null check(
    char_length(target_url) between 12 and 2048
    and target_url~'^https://[^[:space:]?#]+(?:\?[^[:space:]#]*)?$'
  ),
  secret_ref text not null check(secret_ref~'^[A-Za-z][A-Za-z0-9_.:-]{1,79}$'),
  event_types text[] not null check(
    cardinality(event_types) between 1 and 3
    and array_position(event_types,null) is null
    and event_types<@array['booking.created','booking.updated','booking.cancelled']::text[]
  ),
  enabled boolean not null default false,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(connection_id,target_url),
  unique(id,organization_id),
  foreign key(connection_id,organization_id)
    references public.integration_connections_v142(id,organization_id) on delete cascade
);

create table if not exists public.integration_webhook_outbox_v142(
  id uuid primary key,
  subscription_id uuid not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_type text not null check(event_type in('booking.created','booking.updated','booking.cancelled')),
  aggregate_id uuid not null,
  aggregate_revision timestamptz not null,
  payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=8192),
  state text not null default 'pending' check(state in('pending','delivering','retry','delivered','failed')),
  available_at timestamptz not null default now(),
  attempt_count integer not null default 0 check(attempt_count between 0 and 8),
  lease_token uuid,
  locked_at timestamptz,
  delivered_at timestamptz,
  response_status integer check(response_status is null or response_status between 100 and 599),
  last_error_code text check(last_error_code is null or last_error_code~'^[a-z0-9_]{1,80}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(subscription_id,event_type,aggregate_id,aggregate_revision),
  foreign key(subscription_id,organization_id)
    references public.integration_webhook_subscriptions_v142(id,organization_id) on delete cascade
);

alter table public.integration_connections_v142 enable row level security;
alter table public.integration_api_keys_v142 enable row level security;
alter table public.integration_rate_limits_v142 enable row level security;
alter table public.integration_calendar_events_v142 enable row level security;
alter table public.integration_request_receipts_v142 enable row level security;
alter table public.integration_webhook_subscriptions_v142 enable row level security;
alter table public.integration_webhook_outbox_v142 enable row level security;

revoke all on public.integration_connections_v142,public.integration_api_keys_v142,
  public.integration_rate_limits_v142,public.integration_calendar_events_v142,
  public.integration_request_receipts_v142,public.integration_webhook_subscriptions_v142,
  public.integration_webhook_outbox_v142 from public,anon,authenticated,service_role;

create index if not exists integration_api_keys_v142_active_idx
  on public.integration_api_keys_v142(id,expires_at) where revoked_at is null;
create index if not exists integration_rate_limits_v142_window_idx
  on public.integration_rate_limits_v142(window_started_at);
create index if not exists integration_calendar_events_v142_booking_idx
  on public.integration_calendar_events_v142(local_booking_id);
create index if not exists integration_webhook_outbox_v142_lease_idx
  on public.integration_webhook_outbox_v142(available_at,created_at,id)
  where state in('pending','retry','delivering');

create or replace function public.require_minuta_integration_owner_v142(p_organization uuid)
returns uuid language plpgsql stable security definer set search_path to '' as $$
declare v_actor uuid:=auth.uid();
begin
  if v_actor is null then raise exception using errcode='42501',message='authentication_required'; end if;
  if not exists(
    select 1 from public.organization_memberships membership
    join public.organizations organization on organization.id=membership.organization_id and organization.status='active'
    where membership.organization_id=p_organization and membership.user_id=v_actor
      and membership.active and membership.role in('owner','admin')
  ) then raise exception using errcode='42501',message='integration_access_denied'; end if;
  return v_actor;
end
$$;
revoke all on function public.require_minuta_integration_owner_v142(uuid) from public,anon,authenticated,service_role;

create or replace function public.configure_minuta_integration_connection_v142(
  p_organization uuid,p_connection uuid,p_provider text,p_environment text,
  p_external_account_id text,p_enabled boolean default false
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_actor uuid; v_existing public.integration_connections_v142%rowtype; v_row public.integration_connections_v142%rowtype;
begin
  v_actor:=public.require_minuta_integration_owner_v142(p_organization);
  if p_connection is null or coalesce(p_provider,'')!~'^[a-z][a-z0-9_-]{1,39}$'
     or coalesce(p_environment,'') not in('testing','production')
     or coalesce(p_external_account_id,'')!~'^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$' then
    raise exception using errcode='22023',message='invalid_integration_connection';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_connection::text,14201));
  select * into v_existing from public.integration_connections_v142 where id=p_connection;
  if found and (v_existing.organization_id<>p_organization or v_existing.provider<>p_provider
    or v_existing.environment<>p_environment or v_existing.external_account_id<>p_external_account_id) then
    raise exception using errcode='23505',message='integration_connection_conflict';
  end if;
  insert into public.integration_connections_v142(
    id,organization_id,provider,environment,external_account_id,enabled,created_by
  ) values(
    p_connection,p_organization,p_provider,p_environment,p_external_account_id,coalesce(p_enabled,false),v_actor
  ) on conflict(id) do update set enabled=excluded.enabled,updated_at=now()
  returning * into v_row;
  return jsonb_build_object('ok',true,'connection_id',v_row.id,'enabled',v_row.enabled,
    'provider',v_row.provider,'environment',v_row.environment);
end
$$;

create or replace function public.put_minuta_integration_api_key_v142(
  p_connection uuid,p_key_id uuid,p_key_prefix text,p_secret_sha256 text,
  p_scopes text[],p_expires_at timestamptz
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_connection public.integration_connections_v142%rowtype; v_actor uuid; v_existing public.integration_api_keys_v142%rowtype;
begin
  select * into v_connection from public.integration_connections_v142 where id=p_connection;
  if not found then raise exception using errcode='P0001',message='integration_connection_not_found'; end if;
  v_actor:=public.require_minuta_integration_owner_v142(v_connection.organization_id);
  if p_key_id is null or coalesce(p_key_prefix,'')<>('ptk_'||p_key_id::text)
     or coalesce(p_secret_sha256,'')!~'^[0-9a-f]{64}$'
     or coalesce(cardinality(p_scopes),0) not between 1 and 8 or array_position(p_scopes,null) is not null
     or not p_scopes<@array['calendar:read','calendar:write']::text[]
     or p_expires_at is null or p_expires_at<=now() or p_expires_at>now()+interval '370 days' then
    raise exception using errcode='22023',message='invalid_integration_key';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_key_id::text,14202));
  select * into v_existing from public.integration_api_keys_v142 where id=p_key_id;
  if found then
    if v_existing.connection_id<>p_connection or v_existing.key_prefix<>p_key_prefix
       or v_existing.secret_sha256<>p_secret_sha256 or v_existing.scopes<>p_scopes
       or v_existing.expires_at<>p_expires_at then
      raise exception using errcode='23505',message='integration_key_conflict';
    end if;
    return jsonb_build_object('ok',true,'key_id',v_existing.id,'replayed',true);
  end if;
  insert into public.integration_api_keys_v142(
    id,connection_id,organization_id,key_prefix,secret_sha256,scopes,expires_at,created_by
  ) values(p_key_id,p_connection,v_connection.organization_id,p_key_prefix,p_secret_sha256,p_scopes,p_expires_at,v_actor);
  return jsonb_build_object('ok',true,'key_id',p_key_id,'replayed',false);
end
$$;

create or replace function public.revoke_minuta_integration_api_key_v142(p_key_id uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_key public.integration_api_keys_v142%rowtype;
begin
  select * into v_key from public.integration_api_keys_v142 where id=p_key_id;
  if not found then raise exception using errcode='P0001',message='integration_key_not_found'; end if;
  perform public.require_minuta_integration_owner_v142(v_key.organization_id);
  update public.integration_api_keys_v142 set revoked_at=coalesce(revoked_at,now()) where id=p_key_id;
  return jsonb_build_object('ok',true,'key_id',p_key_id,'revoked',true);
end
$$;

create or replace function public.put_minuta_integration_webhook_v142(
  p_connection uuid,p_subscription uuid,p_target_url text,p_secret_ref text,
  p_event_types text[],p_enabled boolean default false
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_connection public.integration_connections_v142%rowtype; v_actor uuid; v_existing public.integration_webhook_subscriptions_v142%rowtype;
begin
  select * into v_connection from public.integration_connections_v142 where id=p_connection;
  if not found then raise exception using errcode='P0001',message='integration_connection_not_found'; end if;
  v_actor:=public.require_minuta_integration_owner_v142(v_connection.organization_id);
  if p_subscription is null or char_length(coalesce(p_target_url,'')) not between 12 and 2048
     or coalesce(p_target_url,'')!~'^https://[^[:space:]?#]+(?:\?[^[:space:]#]*)?$'
     or coalesce(p_secret_ref,'')!~'^[A-Za-z][A-Za-z0-9_.:-]{1,79}$'
     or coalesce(cardinality(p_event_types),0) not between 1 and 3 or array_position(p_event_types,null) is not null
     or not p_event_types<@array['booking.created','booking.updated','booking.cancelled']::text[] then
    raise exception using errcode='22023',message='invalid_integration_webhook';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_subscription::text,14203));
  select * into v_existing from public.integration_webhook_subscriptions_v142 where id=p_subscription;
  if found and (v_existing.connection_id<>p_connection or v_existing.target_url<>p_target_url
    or v_existing.secret_ref<>p_secret_ref) then
    raise exception using errcode='23505',message='integration_webhook_conflict';
  end if;
  insert into public.integration_webhook_subscriptions_v142(
    id,connection_id,organization_id,target_url,secret_ref,event_types,enabled,created_by
  ) values(
    p_subscription,p_connection,v_connection.organization_id,p_target_url,p_secret_ref,p_event_types,coalesce(p_enabled,false),v_actor
  ) on conflict(id) do update set event_types=excluded.event_types,enabled=excluded.enabled,updated_at=now();
  return jsonb_build_object('ok',true,'subscription_id',p_subscription,'enabled',coalesce(p_enabled,false));
end
$$;

revoke all on function public.configure_minuta_integration_connection_v142(uuid,uuid,text,text,text,boolean) from public,anon,authenticated,service_role;
revoke all on function public.put_minuta_integration_api_key_v142(uuid,uuid,text,text,text[],timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.revoke_minuta_integration_api_key_v142(uuid) from public,anon,authenticated,service_role;
revoke all on function public.put_minuta_integration_webhook_v142(uuid,uuid,text,text,text[],boolean) from public,anon,authenticated,service_role;
grant execute on function public.configure_minuta_integration_connection_v142(uuid,uuid,text,text,text,boolean) to authenticated;
grant execute on function public.put_minuta_integration_api_key_v142(uuid,uuid,text,text,text[],timestamptz) to authenticated;
grant execute on function public.revoke_minuta_integration_api_key_v142(uuid) to authenticated;
grant execute on function public.put_minuta_integration_webhook_v142(uuid,uuid,text,text,text[],boolean) to authenticated;

create or replace function public.authenticate_minuta_integration_key_v142(
  p_key_id uuid,p_secret_sha256 text,p_environment text,p_required_scope text
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_key record;
begin
  if p_key_id is null or coalesce(p_secret_sha256,'')!~'^[0-9a-f]{64}$'
     or coalesce(p_environment,'') not in('testing','production')
     or coalesce(p_required_scope,'') not in('calendar:read','calendar:write') then
    return jsonb_build_object('ok',false,'error','unauthorized');
  end if;
  select key_row.id,key_row.connection_id,key_row.scopes into v_key
  from public.integration_api_keys_v142 key_row
  join public.integration_connections_v142 connection on connection.id=key_row.connection_id
  join public.organizations organization on organization.id=connection.organization_id and organization.status='active'
  where key_row.id=p_key_id and key_row.secret_sha256=p_secret_sha256
    and key_row.revoked_at is null and key_row.expires_at>now()
    and p_required_scope=any(key_row.scopes)
    and connection.enabled and connection.environment=p_environment;
  if not found then return jsonb_build_object('ok',false,'error','unauthorized'); end if;
  update public.integration_api_keys_v142 set last_used_at=now() where id=v_key.id;
  return jsonb_build_object('ok',true,'connection_id',v_key.connection_id,'scopes',to_jsonb(v_key.scopes));
end
$$;

create or replace function public.consume_minuta_integration_rate_limit_v142(
  p_connection uuid,p_key_id uuid,p_operation_class text
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_window timestamptz:=date_trunc('minute',clock_timestamp()); v_count integer; v_limit integer;
begin
  if coalesce(p_operation_class,'') not in('read','mutation') or not exists(
    select 1 from public.integration_api_keys_v142 key_row
    where key_row.id=p_key_id and key_row.connection_id=p_connection and key_row.revoked_at is null and key_row.expires_at>now()
  ) then return jsonb_build_object('ok',false,'error','rate_limited'); end if;
  v_limit:=case when p_operation_class='read' then 120 else 30 end;
  insert into public.integration_rate_limits_v142(connection_id,key_id,operation_class,window_started_at,request_count)
  values(p_connection,p_key_id,p_operation_class,v_window,1)
  on conflict(connection_id,key_id,operation_class,window_started_at)
  do update set request_count=public.integration_rate_limits_v142.request_count+1
  returning request_count into v_count;
  delete from public.integration_rate_limits_v142 where window_started_at<now()-interval '2 hours';
  return jsonb_build_object('ok',v_count<=v_limit,'allowed',v_count<=v_limit,
    'remaining',greatest(v_limit-v_count,0));
end
$$;

revoke all on function public.authenticate_minuta_integration_key_v142(uuid,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.consume_minuta_integration_rate_limit_v142(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.authenticate_minuta_integration_key_v142(uuid,text,text,text) to service_role;
grant execute on function public.consume_minuta_integration_rate_limit_v142(uuid,uuid,text) to service_role;

create or replace function public.ensure_minuta_integration_block_service_v142(p_performer uuid)
returns uuid language plpgsql security definer set search_path to '' as $$
declare v_service uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_performer::text,14204));
  select service.id into v_service from public.services service
  where service.performer_id=p_performer and service.name='__PRIMETIME_EXTERNAL_CALENDAR__'
    and not service.active and service.price_rub=0
  order by service.created_at,service.id limit 1 for update;
  if v_service is null then
    insert into public.services(id,performer_id,name,duration_minutes,price_rub,active)
    values(extensions.gen_random_uuid(),p_performer,'__PRIMETIME_EXTERNAL_CALENDAR__',60,0,false)
    returning id into v_service;
  end if;
  return v_service;
end
$$;
revoke all on function public.ensure_minuta_integration_block_service_v142(uuid) from public,anon,authenticated,service_role;

create or replace function public.minuta_integration_calendar_snapshot_v142(
  p_connection uuid,p_external_event_id text
) returns jsonb language sql stable security definer set search_path to '' as $$
  select jsonb_build_object(
    'id',mapping.id,'externalId',mapping.external_event_id,'type','external_busy',
    'bookingId',mapping.local_booking_id,'locationId',mapping.location_id,
    'performerId',mapping.performer_id,'startsAt',
      ((booking.booking_date+booking.booking_time) at time zone location.timezone),
    'endsAt',((booking.booking_date+booking.booking_time+make_interval(mins=>booking.duration_minutes)) at time zone location.timezone),
    'status',mapping.state,'revision',mapping.source_revision,'updatedAt',mapping.updated_at
  )
  from public.integration_calendar_events_v142 mapping
  join public.bookings booking on booking.id=mapping.local_booking_id
  join public.locations location on location.id=mapping.location_id
  where mapping.connection_id=p_connection and mapping.external_event_id=p_external_event_id
$$;
revoke all on function public.minuta_integration_calendar_snapshot_v142(uuid,text) from public,anon,authenticated,service_role;

create or replace function public.get_minuta_integration_calendar_v142(
  p_connection uuid,p_from timestamptz,p_to timestamptz,p_count integer default 200,
  p_after_updated_at timestamptz default null,p_after_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_connection public.integration_connections_v142%rowtype; v_events jsonb; v_next jsonb;
begin
  select * into v_connection from public.integration_connections_v142 where id=p_connection and enabled;
  if not found then return jsonb_build_object('ok',false,'error','connection_not_found'); end if;
  if p_from is null or p_to is null or p_to<=p_from or p_to-p_from>interval '90 days'
     or p_count not between 1 and 500 or ((p_after_updated_at is null)<>(p_after_id is null)) then
    raise exception using errcode='22023',message='invalid_integration_calendar_query';
  end if;
  with candidates as(
    select booking.id,coalesce(mapping.updated_at,booking.updated_at) updated_at,
      jsonb_build_object(
        'id',coalesce(mapping.id,booking.id),'type',case when mapping.id is null then 'booking' else 'external_busy' end,
        'externalId',mapping.external_event_id,'bookingId',booking.id,'locationId',booking.location_id,
        'performerId',booking.performer_id,'serviceId',case when mapping.id is null then booking.service_id else null end,
        'startsAt',((booking.booking_date+booking.booking_time) at time zone location.timezone),
        'endsAt',((booking.booking_date+booking.booking_time+make_interval(mins=>booking.duration_minutes)) at time zone location.timezone),
        'status',coalesce(mapping.state,booking.status),
        'revision',coalesce(mapping.source_revision,booking.updated_at::text),
        'updatedAt',coalesce(mapping.updated_at,booking.updated_at)
      ) payload
    from public.bookings booking
    join public.locations location on location.id=booking.location_id and location.organization_id=booking.organization_id
    left join public.integration_calendar_events_v142 mapping
      on mapping.connection_id=p_connection and mapping.local_booking_id=booking.id
    where booking.organization_id=v_connection.organization_id
      and ((booking.booking_date+booking.booking_time) at time zone location.timezone)<p_to
      and ((booking.booking_date+booking.booking_time+make_interval(mins=>booking.duration_minutes)) at time zone location.timezone)>p_from
      and (mapping.id is not null or coalesce(booking.booking_policy_snapshot->>'integration_calendar_block','false')<>'true')
      and (p_after_updated_at is null or (coalesce(mapping.updated_at,booking.updated_at),booking.id)>(p_after_updated_at,p_after_id))
    order by coalesce(mapping.updated_at,booking.updated_at),booking.id
    limit p_count+1
  ), page as(select * from candidates order by updated_at,id limit p_count), overflow as(
    select * from candidates order by updated_at,id offset p_count limit 1
  )
  select coalesce((select jsonb_agg(page.payload order by page.updated_at,page.id) from page),'[]'::jsonb),
    (select jsonb_build_object('afterUpdatedAt',page.updated_at,'afterId',page.id)
      from page where exists(select 1 from overflow) order by page.updated_at desc,page.id desc limit 1)
  into v_events,v_next;
  return jsonb_build_object('ok',true,'events',v_events,'next_cursor',v_next);
end
$$;

create or replace function public.upsert_minuta_integration_calendar_event_v142(
  p_connection uuid,p_request_key text,p_payload_sha256 text,p_external_event_id text,
  p_performer uuid,p_location uuid,p_starts_at timestamptz,p_ends_at timestamptz,
  p_revision text,p_expected_revision text default null
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_connection public.integration_connections_v142%rowtype; v_mapping public.integration_calendar_events_v142%rowtype;
  v_receipt public.integration_request_receipts_v142%rowtype; v_zone text; v_local_start timestamp; v_local_end timestamp;
  v_booking uuid; v_service uuid; v_result jsonb; v_previous_org text:=current_setting('minuta.booking_organization',true);
  v_previous_location text:=current_setting('minuta.booking_location',true);
begin
  if coalesce(p_request_key,'')!~'^[0-9a-f]{64}$' or coalesce(p_payload_sha256,'')!~'^[0-9a-f]{64}$'
     or coalesce(p_external_event_id,'')!~'^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,159}$'
     or coalesce(p_revision,'')!~'^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,119}$'
     or (p_expected_revision is not null and p_expected_revision!~'^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,119}$')
     or p_starts_at is null or p_ends_at is null or p_ends_at<=p_starts_at or p_ends_at-p_starts_at>interval '8 hours' then
    raise exception using errcode='22023',message='invalid_integration_calendar_event';
  end if;
  select * into v_connection from public.integration_connections_v142 where id=p_connection and enabled;
  if not found then return jsonb_build_object('ok',false,'error','connection_not_found'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_connection::text||p_request_key,14205));
  select * into v_receipt from public.integration_request_receipts_v142
    where connection_id=p_connection and request_key=p_request_key;
  if found then
    if v_receipt.operation<>'calendar_upsert' or v_receipt.entity_id<>p_external_event_id
       or v_receipt.payload_sha256<>p_payload_sha256 then
      return jsonb_build_object('ok',false,'error','request_conflict');
    end if;
    return v_receipt.result||jsonb_build_object('replayed',true);
  end if;
  select location.timezone into v_zone from public.locations location
  where location.id=p_location and location.organization_id=v_connection.organization_id and location.active;
  if v_zone is null then return jsonb_build_object('ok',false,'error','location_not_found'); end if;
  if not exists(select 1 from public.organization_memberships membership
    where membership.organization_id=v_connection.organization_id and membership.user_id=p_performer
      and membership.active and membership.is_bookable) then
    return jsonb_build_object('ok',false,'error','performer_not_found');
  end if;
  v_local_start:=p_starts_at at time zone v_zone; v_local_end:=p_ends_at at time zone v_zone;
  if v_local_start::date<>v_local_end::date or extract(second from v_local_start)<>0
     or extract(second from v_local_end)<>0
     or v_local_start::date<(clock_timestamp() at time zone v_zone)::date-31
     or v_local_start::date>(clock_timestamp() at time zone v_zone)::date+730 then
    raise exception using errcode='22023',message='invalid_integration_calendar_event';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_connection::text||p_external_event_id,14206));
  perform pg_advisory_xact_lock(hashtextextended(p_performer::text||v_local_start::date::text,0));
  select * into v_mapping from public.integration_calendar_events_v142
    where connection_id=p_connection and external_event_id=p_external_event_id for update;
  if found then
    if v_mapping.state='active' then
      if v_mapping.payload_sha256=p_payload_sha256 and v_mapping.source_revision=p_revision then
        v_result:=jsonb_build_object('ok',true,'event',public.minuta_integration_calendar_snapshot_v142(p_connection,p_external_event_id));
        insert into public.integration_request_receipts_v142 values(
          p_connection,p_request_key,'calendar_upsert',p_external_event_id,p_payload_sha256,v_result,now());
        return v_result||jsonb_build_object('replayed',true);
      end if;
      if p_expected_revision is null or p_expected_revision<>v_mapping.source_revision or p_revision=v_mapping.source_revision then
        return jsonb_build_object('ok',false,'error','revision_conflict');
      end if;
    elsif p_expected_revision is null or p_expected_revision<>v_mapping.source_revision
      or p_revision=v_mapping.source_revision then
      return jsonb_build_object('ok',false,'error','revision_conflict');
    end if;
    v_booking:=v_mapping.local_booking_id;
  elsif p_expected_revision is not null then
    return jsonb_build_object('ok',false,'error','event_not_found');
  end if;
  if exists(select 1 from public.bookings booking where booking.performer_id=p_performer
    and booking.status<>'cancelled' and (v_booking is null or booking.id<>v_booking)
    and tsrange(v_local_start,v_local_end,'[)')&&tsrange(
      booking.booking_date+booking.booking_time,
      booking.booking_date+booking.booking_time+make_interval(mins=>booking.duration_minutes),'[)')) then
    return jsonb_build_object('ok',false,'error','slot_unavailable');
  end if;
  if v_booking is null then
    v_booking:=extensions.gen_random_uuid();
    v_service:=public.ensure_minuta_integration_block_service_v142(p_performer);
    perform set_config('minuta.booking_organization',v_connection.organization_id::text,true);
    perform set_config('minuta.booking_location',p_location::text,true);
    insert into public.bookings(
      id,booking_code,manage_token,performer_id,service_id,client_name,client_phone,
      booking_date,booking_time,duration_minutes,original_price_rub,total_price_rub,status,
      deposit_amount_rub,payment_status,payment_url,provider_note,booking_policy_snapshot
    ) values(
      v_booking,'EXT-'||upper(substr(encode(extensions.gen_random_bytes(6),'hex'),1,10)),
      extensions.gen_random_uuid(),p_performer,v_service,'Внешний календарь','0000000000',
      v_local_start::date,v_local_start::time,extract(epoch from(v_local_end-v_local_start))::integer/60,
      0,0,'new',0,'not_required','','',jsonb_build_object(
        'schedule_block',true,'integration_calendar_block',true,'payment_suppressed',true,'notifications_suppressed',true)
    );
    insert into public.integration_calendar_events_v142(
      connection_id,organization_id,external_event_id,local_booking_id,location_id,performer_id,
      source_revision,payload_sha256
    ) values(
      p_connection,v_connection.organization_id,p_external_event_id,v_booking,p_location,p_performer,
      p_revision,p_payload_sha256
    );
  else
    v_service:=public.ensure_minuta_integration_block_service_v142(p_performer);
    update public.bookings set performer_id=p_performer,location_id=p_location,
      service_id=v_service,
      booking_date=v_local_start::date,booking_time=v_local_start::time,
      duration_minutes=extract(epoch from(v_local_end-v_local_start))::integer/60,
      status='new',updated_at=now()
    where id=v_booking and organization_id=v_connection.organization_id;
    update public.integration_calendar_events_v142 set location_id=p_location,performer_id=p_performer,
      source_revision=p_revision,payload_sha256=p_payload_sha256,state='active',updated_at=now()
    where connection_id=p_connection and external_event_id=p_external_event_id;
  end if;
  delete from public.notification_outbox where booking_id=v_booking;
  perform set_config('minuta.booking_organization',coalesce(v_previous_org,''),true);
  perform set_config('minuta.booking_location',coalesce(v_previous_location,''),true);
  v_result:=jsonb_build_object('ok',true,'event',public.minuta_integration_calendar_snapshot_v142(p_connection,p_external_event_id));
  insert into public.integration_request_receipts_v142 values(
    p_connection,p_request_key,'calendar_upsert',p_external_event_id,p_payload_sha256,v_result,now());
  return v_result||jsonb_build_object('replayed',false);
exception when exclusion_violation or unique_violation then
  perform set_config('minuta.booking_organization',coalesce(v_previous_org,''),true);
  perform set_config('minuta.booking_location',coalesce(v_previous_location,''),true);
  return jsonb_build_object('ok',false,'error','slot_unavailable');
when others then
  perform set_config('minuta.booking_organization',coalesce(v_previous_org,''),true);
  perform set_config('minuta.booking_location',coalesce(v_previous_location,''),true);
  raise;
end
$$;

create or replace function public.delete_minuta_integration_calendar_event_v142(
  p_connection uuid,p_request_key text,p_payload_sha256 text,p_external_event_id text,p_expected_revision text
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_mapping public.integration_calendar_events_v142%rowtype; v_receipt public.integration_request_receipts_v142%rowtype; v_result jsonb;
begin
  if coalesce(p_request_key,'')!~'^[0-9a-f]{64}$' or coalesce(p_payload_sha256,'')!~'^[0-9a-f]{64}$'
     or coalesce(p_external_event_id,'')!~'^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,159}$'
     or coalesce(p_expected_revision,'')!~'^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,119}$' then
    raise exception using errcode='22023',message='invalid_integration_calendar_delete';
  end if;
  if not exists(select 1 from public.integration_connections_v142 where id=p_connection and enabled) then
    return jsonb_build_object('ok',false,'error','connection_not_found');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_connection::text||p_request_key,14205));
  select * into v_receipt from public.integration_request_receipts_v142
    where connection_id=p_connection and request_key=p_request_key;
  if found then
    if v_receipt.operation<>'calendar_delete' or v_receipt.entity_id<>p_external_event_id
       or v_receipt.payload_sha256<>p_payload_sha256 then
      return jsonb_build_object('ok',false,'error','request_conflict');
    end if;
    return v_receipt.result||jsonb_build_object('replayed',true);
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_connection::text||p_external_event_id,14206));
  select * into v_mapping from public.integration_calendar_events_v142
    where connection_id=p_connection and external_event_id=p_external_event_id for update;
  if not found or v_mapping.state<>'active' then return jsonb_build_object('ok',false,'error','event_not_found'); end if;
  if v_mapping.source_revision<>p_expected_revision then return jsonb_build_object('ok',false,'error','revision_conflict'); end if;
  update public.bookings set status='cancelled',updated_at=now() where id=v_mapping.local_booking_id;
  update public.integration_calendar_events_v142 set state='deleted',updated_at=now()
    where id=v_mapping.id;
  delete from public.notification_outbox where booking_id=v_mapping.local_booking_id;
  v_result:=jsonb_build_object('ok',true,'deleted',true);
  insert into public.integration_request_receipts_v142 values(
    p_connection,p_request_key,'calendar_delete',p_external_event_id,p_payload_sha256,v_result,now());
  return v_result||jsonb_build_object('replayed',false);
end
$$;

revoke all on function public.get_minuta_integration_calendar_v142(uuid,timestamptz,timestamptz,integer,timestamptz,uuid) from public,anon,authenticated,service_role;
revoke all on function public.upsert_minuta_integration_calendar_event_v142(uuid,text,text,text,uuid,uuid,timestamptz,timestamptz,text,text) from public,anon,authenticated,service_role;
revoke all on function public.delete_minuta_integration_calendar_event_v142(uuid,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.get_minuta_integration_calendar_v142(uuid,timestamptz,timestamptz,integer,timestamptz,uuid) to service_role;
grant execute on function public.upsert_minuta_integration_calendar_event_v142(uuid,text,text,text,uuid,uuid,timestamptz,timestamptz,text,text) to service_role;
grant execute on function public.delete_minuta_integration_calendar_event_v142(uuid,text,text,text,text) to service_role;

create or replace function public.enqueue_minuta_integration_booking_webhooks_v142()
returns trigger language plpgsql security definer set search_path to '' as $$
declare v_event_type text; v_subscription record; v_event_id uuid; v_payload jsonb; v_zone text;
  v_occurred_at timestamptz;
begin
  if coalesce(new.booking_policy_snapshot->>'integration_calendar_block','false')='true' then return new; end if;
  if tg_op='INSERT' then v_event_type:='booking.created';
  elsif new.status='cancelled' and old.status<>'cancelled' then v_event_type:='booking.cancelled';
  elsif (new.booking_date,new.booking_time,new.duration_minutes,new.status,new.performer_id,new.service_id,new.location_id)
    is distinct from (old.booking_date,old.booking_time,old.duration_minutes,old.status,old.performer_id,old.service_id,old.location_id) then
    v_event_type:='booking.updated';
  else return new; end if;
  select location.timezone into v_zone from public.locations location where location.id=new.location_id;
  if v_zone is null then return new; end if;
  for v_subscription in
    select subscription.* from public.integration_webhook_subscriptions_v142 subscription
    join public.integration_connections_v142 connection on connection.id=subscription.connection_id and connection.enabled
    where subscription.organization_id=new.organization_id and subscription.enabled
      and v_event_type=any(subscription.event_types)
  loop
    v_event_id:=extensions.gen_random_uuid();
    v_occurred_at:=clock_timestamp();
    v_payload:=jsonb_build_object(
      'schemaVersion',1,'eventId',v_event_id,'type',v_event_type,'occurredAt',v_occurred_at,
      'booking',jsonb_build_object(
        'id',new.id,'locationId',new.location_id,'performerId',new.performer_id,'serviceId',new.service_id,
        'startsAt',((new.booking_date+new.booking_time) at time zone v_zone),
        'endsAt',((new.booking_date+new.booking_time+make_interval(mins=>new.duration_minutes)) at time zone v_zone),
        'status',new.status,'revision',new.updated_at
      )
    );
    insert into public.integration_webhook_outbox_v142(
      id,subscription_id,organization_id,event_type,aggregate_id,aggregate_revision,payload
    ) values(v_event_id,v_subscription.id,new.organization_id,v_event_type,new.id,v_occurred_at,v_payload)
    on conflict(subscription_id,event_type,aggregate_id,aggregate_revision) do nothing;
  end loop;
  return new;
end
$$;
revoke all on function public.enqueue_minuta_integration_booking_webhooks_v142() from public,anon,authenticated,service_role;

drop trigger if exists bookings_integration_webhook_v142 on public.bookings;
create trigger bookings_integration_webhook_v142
after insert or update on public.bookings
for each row execute function public.enqueue_minuta_integration_booking_webhooks_v142();

create or replace function public.lease_minuta_integration_webhooks_v142(p_limit integer,p_lease uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_rows jsonb;
begin
  if coalesce(p_limit,0) not between 1 and 50 or p_lease is null then raise exception using errcode='22023',message='invalid_webhook_lease'; end if;
  update public.integration_webhook_outbox_v142 set
    state=case when attempt_count>=8 then 'failed' else 'retry' end,
    lease_token=null,locked_at=null,available_at=now(),last_error_code='stale_lease',updated_at=now()
  where state='delivering' and locked_at<now()-interval '10 minutes';
  with selected as(
    select outbox.id from public.integration_webhook_outbox_v142 outbox
    join public.integration_webhook_subscriptions_v142 subscription on subscription.id=outbox.subscription_id and subscription.enabled
    join public.integration_connections_v142 connection on connection.id=subscription.connection_id and connection.enabled
    where outbox.state in('pending','retry') and outbox.available_at<=now() and outbox.attempt_count<8
    order by outbox.available_at,outbox.created_at,outbox.id limit p_limit for update of outbox skip locked
  ), leased as(
    update public.integration_webhook_outbox_v142 outbox set state='delivering',lease_token=p_lease,
      locked_at=now(),attempt_count=outbox.attempt_count+1,updated_at=now()
    from selected where outbox.id=selected.id
    returning outbox.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',leased.id,'subscriptionId',subscription.id,'connectionId',subscription.connection_id,
    'organizationId',leased.organization_id,'targetUrl',subscription.target_url,'secretRef',subscription.secret_ref,
    'eventType',leased.event_type,'attempt',leased.attempt_count,'payload',leased.payload
  ) order by leased.created_at,leased.id),'[]'::jsonb) into v_rows
  from leased join public.integration_webhook_subscriptions_v142 subscription on subscription.id=leased.subscription_id;
  return jsonb_build_object('ok',true,'deliveries',v_rows);
end
$$;

create or replace function public.settle_minuta_integration_webhook_v142(
  p_id uuid,p_lease uuid,p_outcome text,p_status integer default null,p_error_code text default null
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_row public.integration_webhook_outbox_v142%rowtype; v_state text;
begin
  if coalesce(p_outcome,'') not in('delivered','retry','failed') or p_lease is null
     or (p_status is not null and p_status not between 100 and 599)
     or (p_error_code is not null and p_error_code!~'^[a-z0-9_]{1,80}$') then
    raise exception using errcode='22023',message='invalid_webhook_outcome';
  end if;
  select * into v_row from public.integration_webhook_outbox_v142 where id=p_id for update;
  if not found or v_row.state<>'delivering' or v_row.lease_token<>p_lease then
    return jsonb_build_object('ok',false,'error','lease_conflict');
  end if;
  v_state:=case when p_outcome='retry' and v_row.attempt_count>=8 then 'failed' else p_outcome end;
  update public.integration_webhook_outbox_v142 set state=v_state,lease_token=null,locked_at=null,
    delivered_at=case when v_state='delivered' then now() else null end,response_status=p_status,
    last_error_code=case when v_state='delivered' then null else coalesce(p_error_code,'delivery_failed') end,
    available_at=case when v_state='retry' then now()+make_interval(secs=>least(3600,15*(2^least(v_row.attempt_count,8))::integer)) else available_at end,
    updated_at=now() where id=p_id;
  return jsonb_build_object('ok',true,'state',v_state,'attempt',v_row.attempt_count);
end
$$;

revoke all on function public.lease_minuta_integration_webhooks_v142(integer,uuid) from public,anon,authenticated,service_role;
revoke all on function public.settle_minuta_integration_webhook_v142(uuid,uuid,text,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.lease_minuta_integration_webhooks_v142(integer,uuid) to service_role;
grant execute on function public.settle_minuta_integration_webhook_v142(uuid,uuid,text,integer,text) to service_role;

notify pgrst,'reload schema';
commit;
