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
  if to_regclass('public.bookings') is null then v_missing:=array_append(v_missing,'bookings'); end if;
  if to_regclass('public.integration_connections_v142') is null then v_missing:=array_append(v_missing,'integration_connections_v142'); end if;
  if to_regprocedure('public.require_minuta_payment_role(uuid,uuid,text[])') is null then v_missing:=array_append(v_missing,'require_minuta_payment_role'); end if;
  if to_regprocedure('public.require_minuta_integration_owner_v142(uuid)') is null then v_missing:=array_append(v_missing,'require_minuta_integration_owner_v142'); end if;
  if to_regprocedure('extensions.digest(bytea,text)') is null then v_missing:=array_append(v_missing,'extensions.digest'); end if;
  if to_regprocedure('extensions.gen_random_uuid()') is null then v_missing:=array_append(v_missing,'extensions.gen_random_uuid'); end if;
  if cardinality(v_missing)>0 then
    raise exception using errcode='55000',message='v144_payment_connector_prerequisites_missing',detail=array_to_string(v_missing,',');
  end if;
end
$guard$;

create table if not exists public.payment_sandbox_ledgers_v144(
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete restrict,
  purpose text not null check(purpose in('booking_prepayment','tip')),
  currency text not null default 'RUB' check(currency='RUB'),
  amount_minor bigint not null check(amount_minor between 1 and 100000000),
  authorized_minor bigint not null default 0,
  captured_minor bigint not null default 0,
  refunded_minor bigint not null default 0,
  status text not null default 'created' check(status in(
    'created','authorized','captured','partially_refunded','refunded','cancelled'
  )),
  version integer not null default 1 check(version between 1 and 10000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(id,organization_id),
  check(authorized_minor between 0 and amount_minor),
  check(captured_minor between 0 and authorized_minor),
  check(refunded_minor between 0 and captured_minor),
  check(
    (status='created' and authorized_minor=0 and captured_minor=0 and refunded_minor=0)
    or (status='authorized' and authorized_minor=amount_minor and captured_minor=0 and refunded_minor=0)
    or (status='captured' and authorized_minor=amount_minor and captured_minor=amount_minor and refunded_minor=0)
    or (status='partially_refunded' and captured_minor=amount_minor and refunded_minor>0 and refunded_minor<captured_minor)
    or (status='refunded' and captured_minor=amount_minor and refunded_minor=captured_minor)
    or (status='cancelled' and authorized_minor in(0,amount_minor) and captured_minor=0 and refunded_minor=0)
  )
);

create table if not exists public.payment_sandbox_commands_v144(
  id uuid primary key default extensions.gen_random_uuid(),
  ledger_id uuid not null,
  organization_id uuid not null,
  sequence integer not null check(sequence between 1 and 10000),
  command text not null check(command in('create','authorize','capture','refund','cancel')),
  amount_minor bigint check(amount_minor is null or amount_minor between 1 and 100000000),
  idempotency_key_sha256 text not null check(idempotency_key_sha256~'^[0-9a-f]{64}$'),
  payload_sha256 text not null check(payload_sha256~'^[0-9a-f]{64}$'),
  result jsonb not null check(jsonb_typeof(result)='object' and octet_length(result::text)<=4096),
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  unique(ledger_id,sequence),
  unique(ledger_id,idempotency_key_sha256),
  check((command in('create','refund') and amount_minor is not null)
    or (command in('authorize','capture','cancel') and amount_minor is null)),
  foreign key(ledger_id,organization_id)
    references public.payment_sandbox_ledgers_v144(id,organization_id) on delete cascade
);

create table if not exists public.integration_provider_events_v144(
  id uuid primary key default extensions.gen_random_uuid(),
  connection_id uuid not null references public.integration_connections_v142(id) on delete cascade,
  organization_id uuid not null,
  provider text not null check(provider in('dikidi','yclients')),
  provider_event_id text not null check(provider_event_id~'^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,159}$'),
  payload_sha256 text not null check(payload_sha256~'^[0-9a-f]{64}$'),
  event_type text not null check(event_type in('booking.created','booking.updated','booking.cancelled')),
  command jsonb not null check(jsonb_typeof(command)='object' and octet_length(command::text)<=8192),
  state text not null default 'accepted' check(state in('accepted','processed','failed')),
  result jsonb check(result is null or (jsonb_typeof(result)='object' and octet_length(result::text)<=4096)),
  error_code text check(error_code is null or error_code~'^[a-z0-9_]{1,80}$'),
  received_at timestamptz not null default clock_timestamp(),
  processed_at timestamptz,
  unique(connection_id,provider_event_id),
  foreign key(connection_id,organization_id)
    references public.integration_connections_v142(id,organization_id) on delete cascade,
  check((state='accepted' and processed_at is null and result is null and error_code is null)
    or (state='processed' and processed_at is not null and result is not null and error_code is null)
    or (state='failed' and processed_at is not null and result is null and error_code is not null))
);

alter table public.payment_sandbox_ledgers_v144 enable row level security;
alter table public.payment_sandbox_commands_v144 enable row level security;
alter table public.integration_provider_events_v144 enable row level security;

revoke all on table public.payment_sandbox_ledgers_v144,
  public.payment_sandbox_commands_v144,public.integration_provider_events_v144
  from public,anon,authenticated,service_role;

create index if not exists payment_sandbox_ledgers_v144_scope_idx
  on public.payment_sandbox_ledgers_v144(organization_id,updated_at desc,id);
create index if not exists payment_sandbox_commands_v144_ledger_idx
  on public.payment_sandbox_commands_v144(ledger_id,sequence);
create index if not exists integration_provider_events_v144_scope_idx
  on public.integration_provider_events_v144(organization_id,received_at desc,id desc);
create index if not exists integration_provider_events_v144_pending_idx
  on public.integration_provider_events_v144(received_at,id) where state='accepted';

create or replace function public.apply_minuta_payment_sandbox_v144(
  p_organization uuid,p_ledger uuid,p_booking uuid,p_idempotency_key text,
  p_expected_version integer,p_command text,p_amount_minor bigint,p_purpose text
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_actor uuid;
  v_key_sha text;
  v_payload_sha text;
  v_existing public.payment_sandbox_commands_v144%rowtype;
  v_ledger public.payment_sandbox_ledgers_v144%rowtype;
  v_result jsonb;
begin
  perform public.require_minuta_payment_role(p_organization,auth.uid(),array['owner','admin']);
  v_actor:=auth.uid();
  if p_ledger is null or p_booking is null
     or coalesce(p_idempotency_key,'')!~'^[!-~]{8,200}$'
     or coalesce(p_command,'') not in('create','authorize','capture','refund','cancel')
     or p_expected_version is null or p_expected_version<0 then
    raise exception using errcode='22023',message='invalid_sandbox_payment_command';
  end if;
  if (p_command in('create','refund') and coalesce(p_amount_minor,0) not between 1 and 100000000)
     or (p_command not in('create','refund') and p_amount_minor is not null)
     or (p_command='create' and coalesce(p_purpose,'') not in('booking_prepayment','tip'))
     or (p_command<>'create' and p_purpose is not null) then
    raise exception using errcode='22023',message='invalid_sandbox_payment_amount';
  end if;
  if not exists(select 1 from public.bookings booking
    where booking.id=p_booking and booking.organization_id=p_organization) then
    raise exception using errcode='42501',message='sandbox_booking_scope_mismatch';
  end if;

  v_key_sha:=encode(extensions.digest(convert_to(p_idempotency_key,'UTF8'),'sha256'),'hex');
  v_payload_sha:=encode(extensions.digest(convert_to(jsonb_build_object(
    'bookingId',p_booking,'command',p_command,'amountMinor',p_amount_minor,
    'purpose',p_purpose,'expectedVersion',p_expected_version
  )::text,'UTF8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_ledger::text,14401));

  select * into v_existing from public.payment_sandbox_commands_v144 command_row
  where command_row.ledger_id=p_ledger and command_row.idempotency_key_sha256=v_key_sha for update;
  if found then
    if v_existing.payload_sha256<>v_payload_sha then
      raise exception using errcode='23505',message='sandbox_payment_idempotency_conflict';
    end if;
    return v_existing.result||jsonb_build_object('replayed',true);
  end if;

  select * into v_ledger from public.payment_sandbox_ledgers_v144 ledger
  where ledger.id=p_ledger for update;
  if p_command='create' then
    if found then raise exception using errcode='23505',message='sandbox_payment_ledger_exists'; end if;
    if p_expected_version<>0 then raise exception using errcode='40001',message='sandbox_payment_stale_version'; end if;
    insert into public.payment_sandbox_ledgers_v144(
      id,organization_id,booking_id,purpose,currency,amount_minor,created_by
    ) values(p_ledger,p_organization,p_booking,p_purpose,'RUB',p_amount_minor,v_actor)
    returning * into v_ledger;
  else
    if not found then raise exception using errcode='P0001',message='sandbox_payment_not_found'; end if;
    if v_ledger.organization_id<>p_organization or v_ledger.booking_id<>p_booking then
      raise exception using errcode='42501',message='sandbox_payment_scope_mismatch';
    end if;
    if v_ledger.version<>p_expected_version then
      raise exception using errcode='40001',message='sandbox_payment_stale_version';
    end if;
    if p_command='authorize' then
      if v_ledger.status<>'created' then raise exception using errcode='55000',message='sandbox_payment_invalid_transition'; end if;
      update public.payment_sandbox_ledgers_v144 set
        authorized_minor=amount_minor,status='authorized',version=version+1,updated_at=clock_timestamp()
      where id=p_ledger returning * into v_ledger;
    elsif p_command='capture' then
      if v_ledger.status<>'authorized' or v_ledger.authorized_minor<>v_ledger.amount_minor then
        raise exception using errcode='55000',message='sandbox_payment_invalid_transition';
      end if;
      update public.payment_sandbox_ledgers_v144 set
        captured_minor=authorized_minor,status='captured',version=version+1,updated_at=clock_timestamp()
      where id=p_ledger returning * into v_ledger;
    elsif p_command='refund' then
      if v_ledger.status not in('captured','partially_refunded')
         or p_amount_minor>v_ledger.captured_minor-v_ledger.refunded_minor then
        raise exception using errcode='55000',message='sandbox_payment_invalid_transition';
      end if;
      update public.payment_sandbox_ledgers_v144 set
        refunded_minor=refunded_minor+p_amount_minor,
        status=case when refunded_minor+p_amount_minor=captured_minor then 'refunded' else 'partially_refunded' end,
        version=version+1,updated_at=clock_timestamp()
      where id=p_ledger returning * into v_ledger;
    else
      if v_ledger.status not in('created','authorized') then
        raise exception using errcode='55000',message='sandbox_payment_invalid_transition';
      end if;
      update public.payment_sandbox_ledgers_v144 set
        status='cancelled',version=version+1,updated_at=clock_timestamp()
      where id=p_ledger returning * into v_ledger;
    end if;
  end if;

  v_result:=jsonb_build_object(
    'ok',true,'sandbox',true,'ledgerId',v_ledger.id,'bookingId',v_ledger.booking_id,
    'status',v_ledger.status,'purpose',v_ledger.purpose,'currency',v_ledger.currency,
    'amountMinor',v_ledger.amount_minor,'authorizedMinor',v_ledger.authorized_minor,
    'capturedMinor',v_ledger.captured_minor,'refundedMinor',v_ledger.refunded_minor,
    'version',v_ledger.version,'replayed',false
  );
  insert into public.payment_sandbox_commands_v144(
    ledger_id,organization_id,sequence,command,amount_minor,idempotency_key_sha256,
    payload_sha256,result,actor_id
  ) values(
    v_ledger.id,v_ledger.organization_id,v_ledger.version,p_command,
    case when p_command in('create','refund') then p_amount_minor end,
    v_key_sha,v_payload_sha,v_result,v_actor
  );
  return v_result;
end
$$;

create or replace function public.get_minuta_payment_sandbox_journal_v144(
  p_organization uuid,p_ledger uuid
) returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_ledger public.payment_sandbox_ledgers_v144%rowtype;
begin
  perform public.require_minuta_payment_role(p_organization,auth.uid(),array['owner','admin']);
  select * into v_ledger from public.payment_sandbox_ledgers_v144 ledger
  where ledger.id=p_ledger and ledger.organization_id=p_organization;
  if not found then raise exception using errcode='P0001',message='sandbox_payment_not_found'; end if;
  return jsonb_build_object(
    'sandbox',true,'ledgerId',v_ledger.id,'bookingId',v_ledger.booking_id,
    'status',v_ledger.status,'purpose',v_ledger.purpose,'currency',v_ledger.currency,
    'amountMinor',v_ledger.amount_minor,'authorizedMinor',v_ledger.authorized_minor,
    'capturedMinor',v_ledger.captured_minor,'refundedMinor',v_ledger.refunded_minor,
    'version',v_ledger.version,
    'journal',coalesce((select jsonb_agg(jsonb_build_object(
      'sequence',command_row.sequence,'command',command_row.command,
      'amountMinor',command_row.amount_minor,'payloadSha256',command_row.payload_sha256,
      'result',command_row.result,'createdAt',command_row.created_at
    ) order by command_row.sequence) from public.payment_sandbox_commands_v144 command_row
      where command_row.ledger_id=v_ledger.id),'[]'::jsonb)
  );
end
$$;

create or replace function public.record_minuta_provider_event_v144(
  p_connection uuid,p_organization uuid,p_provider_event_id text,p_payload_sha256 text,
  p_event_type text,p_command jsonb
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_connection public.integration_connections_v142%rowtype;
  v_existing public.integration_provider_events_v144%rowtype;
  v_row public.integration_provider_events_v144%rowtype;
  v_action text;
begin
  select * into v_connection from public.integration_connections_v142 connection
  where connection.id=p_connection for share;
  if not found or v_connection.organization_id<>p_organization
     or not v_connection.enabled or v_connection.environment<>'testing'
     or v_connection.provider not in('dikidi','yclients') then
    raise exception using errcode='42501',message='provider_connection_not_available';
  end if;
  v_action:=p_command->>'action';
  if coalesce(p_provider_event_id,'')!~'^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,159}$'
     or coalesce(p_payload_sha256,'')!~'^[0-9a-f]{64}$'
     or coalesce(p_event_type,'') not in('booking.created','booking.updated','booking.cancelled')
     or coalesce(jsonb_typeof(p_command),'')<>'object' or octet_length(p_command::text)>8192
     or v_action not in('upsert_booking','cancel_booking','refresh_booking')
     or not (p_command ?& array['action','externalLocationId','externalBookingId'])
     or p_command->>'externalLocationId' is distinct from v_connection.external_account_id
     or coalesce(p_command->>'externalBookingId','')!~'^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,159}$'
     or exists(select 1 from jsonb_object_keys(p_command) key
       where key not in('action','externalLocationId','externalBookingId','staffExternalId',
         'serviceExternalIds','startsAt','endsAt','reason')) then
    raise exception using errcode='22023',message='invalid_provider_event';
  end if;
  if v_action='cancel_booking' then
    if p_event_type<>'booking.cancelled' or p_command ? 'reason'
       or exists(select 1 from jsonb_object_keys(p_command) key
         where key in('staffExternalId','serviceExternalIds','startsAt','endsAt')) then
      raise exception using errcode='22023',message='invalid_provider_command';
    end if;
  elsif v_action='refresh_booking' then
    if p_event_type='booking.cancelled' or coalesce(p_command->>'reason','')<>'partial_webhook'
       or exists(select 1 from jsonb_object_keys(p_command) key
         where key in('staffExternalId','serviceExternalIds','startsAt','endsAt')) then
      raise exception using errcode='22023',message='invalid_provider_command';
    end if;
  else
    if not (p_command ?& array['staffExternalId','serviceExternalIds','startsAt','endsAt'])
       or p_command ? 'reason'
       or p_event_type='booking.cancelled'
       or coalesce(p_command->>'staffExternalId','')!~'^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,159}$'
       or coalesce(jsonb_typeof(p_command->'serviceExternalIds'),'')<>'array'
       or coalesce(p_command->>'startsAt','')!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$'
       or coalesce(p_command->>'endsAt','')!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$' then
      raise exception using errcode='22023',message='invalid_provider_command';
    end if;
    if jsonb_array_length(p_command->'serviceExternalIds') not between 1 and 64
       or exists(select 1 from jsonb_array_elements(p_command->'serviceExternalIds') service_id
         where jsonb_typeof(service_id)<>'string'
           or coalesce(service_id#>>'{}','')!~'^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,159}$')
       or jsonb_array_length(p_command->'serviceExternalIds')<>(
         select count(distinct service_id#>>'{}') from jsonb_array_elements(p_command->'serviceExternalIds') service_id
       ) then
      raise exception using errcode='22023',message='invalid_provider_command';
    end if;
    begin
      if (p_command->>'endsAt')::timestamptz<=(p_command->>'startsAt')::timestamptz
         or (p_command->>'endsAt')::timestamptz-(p_command->>'startsAt')::timestamptz>interval '24 hours' then
        raise exception using errcode='22023',message='invalid_provider_command';
      end if;
    exception when datetime_field_overflow or invalid_datetime_format then
      raise exception using errcode='22023',message='invalid_provider_command';
    end;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_connection::text||':'||p_provider_event_id,14402));
  select * into v_existing from public.integration_provider_events_v144 event_row
  where event_row.connection_id=p_connection and event_row.provider_event_id=p_provider_event_id for update;
  if found then
    if v_existing.payload_sha256<>p_payload_sha256 or v_existing.event_type<>p_event_type
       or v_existing.command<>p_command then
      raise exception using errcode='23505',message='provider_event_idempotency_conflict';
    end if;
    return jsonb_build_object('ok',true,'eventId',v_existing.id,'state',v_existing.state,'replayed',true);
  end if;
  insert into public.integration_provider_events_v144(
    connection_id,organization_id,provider,provider_event_id,payload_sha256,event_type,command
  ) values(
    v_connection.id,v_connection.organization_id,v_connection.provider,p_provider_event_id,
    p_payload_sha256,p_event_type,p_command
  ) returning * into v_row;
  return jsonb_build_object('ok',true,'eventId',v_row.id,'state',v_row.state,'replayed',false);
end
$$;

create or replace function public.settle_minuta_provider_event_v144(
  p_event uuid,p_state text,p_result jsonb,p_error_code text
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_row public.integration_provider_events_v144%rowtype;
begin
  if p_event is null or coalesce(p_state,'') not in('processed','failed')
     or (p_state='processed' and (coalesce(jsonb_typeof(p_result),'')<>'object' or octet_length(p_result::text)>4096 or p_error_code is not null))
     or (p_state='failed' and (p_result is not null or coalesce(p_error_code,'')!~'^[a-z0-9_]{1,80}$')) then
    raise exception using errcode='22023',message='invalid_provider_event_outcome';
  end if;
  if p_state='processed' and (
    coalesce(p_result->>'outcome','') not in('applied','ignored','refresh_queued')
    or exists(select 1 from jsonb_object_keys(p_result) key
      where key not in('outcome','localBookingId','revision'))
    or (p_result ? 'localBookingId' and coalesce(p_result->>'localBookingId','')
      !~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
    or (p_result ? 'revision' and coalesce(p_result->>'revision','')
      !~'^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,159}$')
  ) then
    raise exception using errcode='22023',message='invalid_provider_event_outcome';
  end if;
  select * into v_row from public.integration_provider_events_v144 event_row where event_row.id=p_event for update;
  if not found then raise exception using errcode='P0001',message='provider_event_not_found'; end if;
  if v_row.state<>'accepted' then
    if v_row.state=p_state and v_row.result is not distinct from p_result and v_row.error_code is not distinct from p_error_code then
      return jsonb_build_object('ok',true,'eventId',v_row.id,'state',v_row.state,'replayed',true);
    end if;
    raise exception using errcode='55000',message='provider_event_already_settled';
  end if;
  update public.integration_provider_events_v144 set
    state=p_state,result=p_result,error_code=p_error_code,processed_at=clock_timestamp()
  where id=p_event returning * into v_row;
  return jsonb_build_object('ok',true,'eventId',v_row.id,'state',v_row.state,'replayed',false);
end
$$;

create or replace function public.get_minuta_provider_connector_read_model_v144(
  p_organization uuid,p_count integer default 50
) returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_actor uuid; v_role text;
begin
  v_actor:=public.require_minuta_integration_owner_v142(p_organization);
  select membership.role into v_role from public.organization_memberships membership
  where membership.organization_id=p_organization and membership.user_id=v_actor
    and membership.active and membership.role in('owner','admin');
  if v_role is null then
    raise exception using errcode='42501',message='integration_access_denied';
  end if;
  if p_count is null or p_count not between 1 and 100 then
    raise exception using errcode='22023',message='invalid_provider_connector_read_count';
  end if;
  return jsonb_build_object(
    'organizationId',p_organization,'currentRole',v_role,
    'connections',coalesce((select jsonb_agg(jsonb_build_object(
      'connectionId',connection.id,'provider',connection.provider,
      'environment',connection.environment,'externalAccountId',connection.external_account_id,
      'status',case when connection.enabled then 'active' else 'disabled' end,
      'enabled',connection.enabled,'updatedAt',connection.updated_at
    ) order by connection.provider,connection.id) from public.integration_connections_v142 connection
      where connection.organization_id=p_organization and connection.provider in('dikidi','yclients')),'[]'::jsonb),
    'recentEvents',coalesce((select jsonb_agg(jsonb_build_object(
      'eventId',event_row.id,'connectionId',event_row.connection_id,
      'provider',event_row.provider,'eventType',event_row.event_type,
      'state',event_row.state,'errorCode',event_row.error_code,
      'receivedAt',event_row.received_at,'processedAt',event_row.processed_at
    ) order by event_row.received_at desc,event_row.id desc) from (
      select source.id,source.connection_id,source.provider,source.event_type,
        source.state,source.error_code,source.received_at,source.processed_at
      from public.integration_provider_events_v144 source
      where source.organization_id=p_organization
      order by source.received_at desc,source.id desc limit p_count
    ) event_row),'[]'::jsonb)
  );
end
$$;

comment on function public.get_minuta_provider_connector_read_model_v144(uuid,integer) is
  'Owner/admin read model: verified organization and current role, DIKIDI/YCLIENTS connection state and PII-free event metadata only; excludes keys, secret refs, raw payloads, payload hashes, provider event ids, commands and results.';

revoke all on function public.apply_minuta_payment_sandbox_v144(uuid,uuid,uuid,text,integer,text,bigint,text)
  from public,anon,authenticated,service_role;
revoke all on function public.get_minuta_payment_sandbox_journal_v144(uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.record_minuta_provider_event_v144(uuid,uuid,text,text,text,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.settle_minuta_provider_event_v144(uuid,text,jsonb,text)
  from public,anon,authenticated,service_role;
revoke all on function public.get_minuta_provider_connector_read_model_v144(uuid,integer)
  from public,anon,authenticated,service_role;

grant execute on function public.apply_minuta_payment_sandbox_v144(uuid,uuid,uuid,text,integer,text,bigint,text)
  to authenticated;
grant execute on function public.get_minuta_payment_sandbox_journal_v144(uuid,uuid)
  to authenticated;
grant execute on function public.record_minuta_provider_event_v144(uuid,uuid,text,text,text,jsonb)
  to service_role;
grant execute on function public.settle_minuta_provider_event_v144(uuid,text,jsonb,text)
  to service_role;
grant execute on function public.get_minuta_provider_connector_read_model_v144(uuid,integer)
  to authenticated;

notify pgrst,'reload schema';
commit;
