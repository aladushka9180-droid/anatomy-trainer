-- v162: disabled-by-default, session-bound PrimeTime message center.
begin;
set local lock_timeout='10s';
set local statement_timeout='5min';
set local search_path=public,extensions,pg_catalog;

do $guard$
declare v_present integer;
begin
  if to_regclass('public.bookings') is null
     or to_regclass('public.booking_events') is null
     or to_regclass('public.client_identity_sessions_v155') is null
     or to_regprocedure('public.resolve_client_identity_session_v155(text)') is null
     or to_regprocedure('public.get_available_slots_v101(uuid,date,date,uuid)') is null
     or to_regprocedure('public.has_organization_role(uuid,text[])') is null then
    raise exception using errcode='55000',message='v162_message_center_prerequisites_missing';
  end if;

  select count(*) into v_present from (values
    (to_regclass('public.message_center_settings_v162')),
    (to_regclass('public.message_support_agents_v162')),
    (to_regclass('public.message_conversations_v162')),
    (to_regclass('public.message_participants_v162')),
    (to_regclass('public.conversation_messages_v162')),
    (to_regclass('public.conversation_system_events_v162')),
    (to_regclass('public.conversation_message_actions_v162')),
    (to_regclass('public.message_action_confirmations_v162')),
    (to_regclass('public.message_read_receipts_v162')),
    (to_regclass('public.message_attachments_v162')),
    (to_regclass('public.message_support_requests_v162')),
    (to_regclass('public.message_idempotency_receipts_v162')),
    (to_regclass('public.message_audit_events_v162'))
  ) item(value) where value is not null;
  if v_present not in(0,13) then
    raise exception using errcode='55000',message='v162_message_center_partial_state';
  end if;
  if v_present=13 and exists(
    select 1 from (values
      ('public.message_center_settings_v162'::regclass),
      ('public.message_support_agents_v162'::regclass),
      ('public.message_conversations_v162'::regclass),
      ('public.message_participants_v162'::regclass),
      ('public.conversation_messages_v162'::regclass),
      ('public.conversation_system_events_v162'::regclass),
      ('public.conversation_message_actions_v162'::regclass),
      ('public.message_action_confirmations_v162'::regclass),
      ('public.message_read_receipts_v162'::regclass),
      ('public.message_attachments_v162'::regclass),
      ('public.message_support_requests_v162'::regclass),
      ('public.message_idempotency_receipts_v162'::regclass),
      ('public.message_audit_events_v162'::regclass)
    ) item(value)
    where obj_description(item.value,'pg_class') is distinct from 'minuta_message_center_v162'
  ) then
    raise exception using errcode='55000',message='v162_message_center_newer_state';
  end if;
end
$guard$;

create table if not exists public.message_center_settings_v162(
  organization_id uuid primary key references public.organizations(id) on delete restrict,
  client_chat_enabled boolean not null default false,
  support_enabled boolean not null default false,
  media_enabled boolean not null default false check(media_enabled is false),
  transcription_enabled boolean not null default false check(transcription_enabled is false),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.message_support_agents_v162(
  user_id uuid primary key references auth.users(id) on delete restrict,
  support_role text not null check(support_role in('agent','lead')),
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.message_conversations_v162(
  id uuid primary key default gen_random_uuid(),
  conversation_kind text not null check(conversation_kind in('client','support')),
  organization_id uuid references public.organizations(id) on delete restrict,
  primary_booking_id uuid references public.bookings(id) on delete restrict,
  client_account_id uuid references public.client_accounts(id) on delete restrict,
  state text not null default 'open' check(state in('open','closed')),
  subject text not null default '' check(char_length(subject)<=160),
  next_sequence bigint not null default 0 check(next_sequence>=0),
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  check((state='open' and closed_at is null) or state='closed'),
  check(
    (conversation_kind='client' and organization_id is not null and primary_booking_id is not null)
    or (conversation_kind='support' and (organization_id is not null or client_account_id is not null))
  )
);
create unique index if not exists message_conversations_client_booking_v162_idx
  on public.message_conversations_v162(primary_booking_id)
  where conversation_kind='client';
create index if not exists message_conversations_provider_page_v162_idx
  on public.message_conversations_v162(organization_id,last_activity_at desc,id desc);
create index if not exists message_conversations_client_page_v162_idx
  on public.message_conversations_v162(client_account_id,last_activity_at desc,id desc)
  where client_account_id is not null;

create table if not exists public.message_participants_v162(
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.message_conversations_v162(id) on delete cascade,
  participant_kind text not null check(participant_kind in('organization_user','client_account','booking_client','support_user')),
  user_id uuid references auth.users(id) on delete restrict,
  client_account_id uuid references public.client_accounts(id) on delete restrict,
  booking_id uuid references public.bookings(id) on delete restrict,
  participant_role text not null check(participant_role in('owner','admin','specialist','client','support')),
  active boolean not null default true,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  check((active and left_at is null) or not active),
  check(
    (participant_kind in('organization_user','support_user') and user_id is not null and client_account_id is null and booking_id is null)
    or (participant_kind='client_account' and user_id is null and client_account_id is not null and booking_id is null)
    or (participant_kind='booking_client' and user_id is null and client_account_id is null and booking_id is not null)
  )
);
create unique index if not exists message_participants_user_v162_idx
  on public.message_participants_v162(conversation_id,participant_kind,user_id) where user_id is not null;
create unique index if not exists message_participants_account_v162_idx
  on public.message_participants_v162(conversation_id,client_account_id) where client_account_id is not null;
create unique index if not exists message_participants_booking_v162_idx
  on public.message_participants_v162(conversation_id,booking_id) where booking_id is not null;

create table if not exists public.conversation_messages_v162(
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.message_conversations_v162(id) on delete cascade,
  sequence bigint not null check(sequence>0),
  sender_participant_id uuid not null references public.message_participants_v162(id) on delete restrict,
  message_kind text not null default 'text' check(message_kind in('text','action','attachment','voice')),
  body text not null default '' check(char_length(body)<=4000),
  client_request_id uuid not null,
  payload_sha256 text not null check(payload_sha256~'^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  check((message_kind='text' and char_length(btrim(body)) between 1 and 4000)
     or (message_kind<>'text' and body='')),
  unique(conversation_id,sequence),
  unique(sender_participant_id,client_request_id)
);
create index if not exists conversation_messages_page_v162_idx
  on public.conversation_messages_v162(conversation_id,sequence desc);

create table if not exists public.conversation_system_events_v162(
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.message_conversations_v162(id) on delete cascade,
  sequence bigint not null check(sequence>0),
  source_booking_event_id bigint not null references public.booking_events(id) on delete restrict,
  event_type text not null check(char_length(event_type) between 3 and 80),
  payload jsonb not null default '{}'::jsonb check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=4096),
  created_at timestamptz not null default clock_timestamp(),
  unique(conversation_id,sequence),
  unique(conversation_id,source_booking_event_id)
);
create index if not exists conversation_system_events_page_v162_idx
  on public.conversation_system_events_v162(conversation_id,sequence desc);

create table if not exists public.conversation_message_actions_v162(
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.message_conversations_v162(id) on delete cascade,
  message_id uuid not null unique references public.conversation_messages_v162(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete restrict,
  action_type text not null check(action_type in('propose_time','send_address','send_preparation','visit_context')),
  public_payload jsonb not null check(jsonb_typeof(public_payload)='object' and octet_length(public_payload::text)<=8192),
  expected_booking_sha256 text not null check(expected_booking_sha256~'^[0-9a-f]{64}$'),
  state text not null default 'proposed' check(state in('proposed','applied','rejected','expired','failed')),
  result_code text,
  expires_at timestamptz not null,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  check(expires_at>created_at),
  check((state='applied' and applied_at is not null) or state<>'applied')
);
create index if not exists conversation_message_actions_open_v162_idx
  on public.conversation_message_actions_v162(conversation_id,expires_at) where state='proposed';

create table if not exists public.message_action_confirmations_v162(
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null references public.conversation_message_actions_v162(id) on delete restrict,
  client_session_id uuid not null references public.client_identity_sessions_v155(id) on delete restrict,
  request_id uuid not null,
  token_hash text not null unique check(token_hash~'^[0-9a-f]{64}$'),
  booking_sha256 text not null check(booking_sha256~'^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  unique(client_session_id,request_id),
  check(expires_at>created_at and expires_at<=created_at+interval '10 minutes')
);

create table if not exists public.message_read_receipts_v162(
  conversation_id uuid not null references public.message_conversations_v162(id) on delete cascade,
  participant_id uuid not null references public.message_participants_v162(id) on delete cascade,
  last_read_sequence bigint not null default 0 check(last_read_sequence>=0),
  updated_at timestamptz not null default now(),
  primary key(conversation_id,participant_id)
);

create table if not exists public.message_attachments_v162(
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.conversation_messages_v162(id) on delete cascade,
  attachment_kind text not null check(attachment_kind in('file','image','voice')),
  state text not null default 'unavailable' check(state in('unavailable','staged','scanning','ready','rejected')),
  storage_bucket text,
  storage_path text,
  mime_type text,
  size_bytes bigint check(size_bytes is null or size_bytes between 1 and 10485760),
  content_sha256 text check(content_sha256 is null or content_sha256~'^[0-9a-f]{64}$'),
  duration_ms integer check(duration_ms is null or duration_ms between 1 and 1800000),
  metadata_stripped boolean not null default false,
  transcription_state text not null default 'unavailable' check(transcription_state in('unavailable','pending','ready','failed')),
  transcript_text text check(transcript_text is null or char_length(transcript_text)<=12000),
  transcript_language text check(transcript_language is null or char_length(transcript_language)<=16),
  transcript_error_code text check(transcript_error_code is null or char_length(transcript_error_code)<=80),
  created_at timestamptz not null default now(),
  check((state='unavailable' and storage_bucket is null and storage_path is null)
     or (state<>'unavailable' and storage_bucket is not null and storage_path is not null)),
  check((transcription_state='ready' and transcript_text is not null)
     or (transcription_state<>'ready' and transcript_text is null))
);

create table if not exists public.message_support_requests_v162(
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null unique references public.message_conversations_v162(id) on delete restrict,
  organization_id uuid references public.organizations(id) on delete restrict,
  requester_participant_id uuid not null references public.message_participants_v162(id) on delete restrict,
  state text not null default 'waiting_for_human' check(state in('waiting_for_human','assigned','resolved','closed')),
  assigned_support_user_id uuid references auth.users(id) on delete restrict,
  diagnostics_consent_at timestamptz,
  diagnostics_preview_sha256 text check(diagnostics_preview_sha256 is null or diagnostics_preview_sha256~'^[0-9a-f]{64}$'),
  diagnostics jsonb not null default '{}'::jsonb check(jsonb_typeof(diagnostics)='object' and octet_length(diagnostics::text)<=4096),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  check((diagnostics='{}'::jsonb and diagnostics_consent_at is null and diagnostics_preview_sha256 is null)
     or (diagnostics<>'{}'::jsonb and diagnostics_consent_at is not null and diagnostics_preview_sha256 is not null))
);
create index if not exists message_support_requests_queue_v162_idx
  on public.message_support_requests_v162(state,updated_at desc,id desc);

create table if not exists public.message_idempotency_receipts_v162(
  actor_key text not null check(char_length(actor_key) between 3 and 100),
  operation text not null check(char_length(operation) between 3 and 80),
  request_id uuid not null,
  request_sha256 text not null check(request_sha256~'^[0-9a-f]{64}$'),
  response jsonb not null check(jsonb_typeof(response)='object' and octet_length(response::text)<=16384),
  created_at timestamptz not null default now(),
  primary key(actor_key,operation,request_id)
);

create table if not exists public.message_audit_events_v162(
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations(id) on delete restrict,
  conversation_id uuid references public.message_conversations_v162(id) on delete restrict,
  message_id uuid references public.conversation_messages_v162(id) on delete restrict,
  action_id uuid references public.conversation_message_actions_v162(id) on delete restrict,
  actor_kind text not null check(actor_kind in('provider','client','support','system','service')),
  actor_ref text not null check(char_length(actor_ref) between 3 and 100),
  event_type text not null check(char_length(event_type) between 3 and 100),
  request_id uuid,
  details jsonb not null default '{}'::jsonb check(jsonb_typeof(details)='object' and octet_length(details::text)<=4096),
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists message_audit_scope_v162_idx
  on public.message_audit_events_v162(organization_id,created_at desc,id desc);

do $secure_tables$
declare v_table regclass;
begin
  foreach v_table in array array[
    'public.message_center_settings_v162'::regclass,'public.message_support_agents_v162'::regclass,
    'public.message_conversations_v162'::regclass,'public.message_participants_v162'::regclass,
    'public.conversation_messages_v162'::regclass,'public.conversation_system_events_v162'::regclass,
    'public.conversation_message_actions_v162'::regclass,'public.message_action_confirmations_v162'::regclass,
    'public.message_read_receipts_v162'::regclass,'public.message_attachments_v162'::regclass,
    'public.message_support_requests_v162'::regclass,'public.message_idempotency_receipts_v162'::regclass,
    'public.message_audit_events_v162'::regclass
  ] loop
    execute format('alter table %s enable row level security',v_table);
    execute format('alter table %s force row level security',v_table);
    execute format('alter table %s owner to postgres',v_table);
    execute format('revoke all on table %s from public,anon,authenticated,service_role',v_table);
    execute format('comment on table %s is %L',v_table,'minuta_message_center_v162');
  end loop;
end
$secure_tables$;

revoke all on sequence public.conversation_system_events_v162_id_seq,
  public.message_audit_events_v162_id_seq from public,anon,authenticated,service_role;

create or replace function public.protect_minuta_message_immutable_v162()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  raise exception using errcode='55000',message='message_history_is_immutable';
end
$$;

drop trigger if exists conversation_messages_immutable_v162 on public.conversation_messages_v162;
create trigger conversation_messages_immutable_v162 before update or delete on public.conversation_messages_v162
for each row execute function public.protect_minuta_message_immutable_v162();
drop trigger if exists conversation_system_events_immutable_v162 on public.conversation_system_events_v162;
create trigger conversation_system_events_immutable_v162 before update or delete on public.conversation_system_events_v162
for each row execute function public.protect_minuta_message_immutable_v162();
drop trigger if exists message_audit_events_immutable_v162 on public.message_audit_events_v162;
create trigger message_audit_events_immutable_v162 before update or delete on public.message_audit_events_v162
for each row execute function public.protect_minuta_message_immutable_v162();

create or replace function public.minuta_message_diagnostics_valid_v162(p_value jsonb)
returns boolean language sql immutable set search_path to '' as $$
  select jsonb_typeof(coalesce(p_value,'{}'::jsonb))='object'
    and octet_length(coalesce(p_value,'{}'::jsonb)::text)<=4096
    and not exists(
      select 1 from jsonb_each(coalesce(p_value,'{}'::jsonb)) item
      where item.key not in('app_version','build_sha','platform','online','pwa_mode','last_sync_status','last_sync_error_code')
         or jsonb_typeof(item.value) not in('string','boolean','null')
         or octet_length(item.value::text)>300
    );
$$;

create or replace function public.minuta_message_booking_sha256_v162(p_booking public.bookings)
returns text language sql stable security definer set search_path to '' as $$
  select encode(extensions.digest(convert_to(concat_ws('|',p_booking.id,p_booking.organization_id,
    p_booking.performer_id,p_booking.service_id,p_booking.booking_date,p_booking.booking_time,
    p_booking.duration_minutes,p_booking.status,p_booking.reschedule_count,coalesce(p_booking.client_account_id::text,'')),'UTF8'),'sha256'),'hex');
$$;

create or replace function public.minuta_message_client_identity_v162(p_session_token text)
returns table(session_id uuid,client_account_id uuid,organization_id uuid,claimed_booking_id uuid,session_scope text)
language sql volatile security definer set search_path to '' as $$
  select resolved.session_id,resolved.client_account_id,resolved.organization_id,resolved.claimed_booking_id,resolved.session_scope
  from public.resolve_client_identity_session_v155(p_session_token) resolved;
$$;

create or replace function public.minuta_message_provider_role_v162(p_organization uuid)
returns text language sql stable security definer set search_path to '' as $$
  select membership.role from public.organization_memberships membership
  join public.organizations organization on organization.id=membership.organization_id and organization.status='active'
  where membership.organization_id=p_organization and membership.user_id=auth.uid() and membership.active
    and membership.role in('owner','admin','specialist') limit 1;
$$;

create or replace function public.minuta_message_provider_can_access_v162(p_conversation uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists(
    select 1 from public.message_conversations_v162 conversation
    join public.organization_memberships membership on membership.organization_id=conversation.organization_id
      and membership.user_id=auth.uid() and membership.active
    left join public.bookings booking on booking.id=conversation.primary_booking_id
    where conversation.id=p_conversation and (
      membership.role in('owner','admin')
      or (membership.role='specialist' and (
        booking.performer_id=auth.uid() or exists(select 1 from public.message_participants_v162 participant
          where participant.conversation_id=conversation.id and participant.user_id=auth.uid() and participant.active)
      ))
    )
  );
$$;

create or replace function public.minuta_message_client_can_access_v162(p_session_token text,p_conversation uuid)
returns boolean language plpgsql volatile security definer set search_path to '' as $$
declare v_identity record;v_conversation public.message_conversations_v162%rowtype;
begin
  select * into v_identity from public.minuta_message_client_identity_v162(p_session_token);
  if v_identity.session_id is null then return false; end if;
  select * into v_conversation from public.message_conversations_v162 where id=p_conversation;
  if not found then return false; end if;
  return case v_identity.session_scope
    when 'booking' then v_conversation.primary_booking_id=v_identity.claimed_booking_id
    when 'organization' then v_conversation.client_account_id=v_identity.client_account_id
      and v_conversation.organization_id=v_identity.organization_id
    when 'account' then v_conversation.client_account_id=v_identity.client_account_id
    else false end;
end
$$;

create or replace function public.minuta_message_support_can_access_v162(p_conversation uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists(select 1 from public.message_support_agents_v162 agent
    join public.message_support_requests_v162 request on request.conversation_id=p_conversation
    where agent.user_id=auth.uid() and agent.active
      and (agent.support_role='lead' or request.assigned_support_user_id is null or request.assigned_support_user_id=auth.uid()));
$$;

create or replace function public.minuta_message_next_sequence_v162(p_conversation uuid)
returns bigint language plpgsql volatile security definer set search_path to '' as $$
declare v_sequence bigint;
begin
  update public.message_conversations_v162 set next_sequence=next_sequence+1,last_activity_at=clock_timestamp()
  where id=p_conversation and state='open' returning next_sequence into v_sequence;
  if v_sequence is null then raise exception using errcode='P0001',message='conversation_unavailable'; end if;
  return v_sequence;
end
$$;

create or replace function public.minuta_message_receipt_v162(
  p_actor_key text,p_operation text,p_request_id uuid,p_request_sha256 text
) returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_receipt public.message_idempotency_receipts_v162%rowtype;
begin
  select * into v_receipt from public.message_idempotency_receipts_v162
  where actor_key=p_actor_key and operation=p_operation and request_id=p_request_id;
  if not found then return null; end if;
  if v_receipt.request_sha256<>p_request_sha256 then
    raise exception using errcode='P0001',message='request_conflict';
  end if;
  return v_receipt.response||jsonb_build_object('replayed',true);
end
$$;

create or replace function public.get_minuta_message_capability_v162(p_organization uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_role text;v_settings public.message_center_settings_v162%rowtype;
begin
  v_role:=public.minuta_message_provider_role_v162(p_organization);
  if v_role is null then raise exception using errcode='42501',message='message_organization_denied'; end if;
  select * into v_settings from public.message_center_settings_v162 where organization_id=p_organization;
  return jsonb_build_object(
    'client_chat_enabled',coalesce(v_settings.client_chat_enabled,false),
    'support_enabled',coalesce(v_settings.support_enabled,false),
    'media_enabled',false,'transcription_enabled',false
  );
end
$$;

create or replace function public.get_minuta_client_message_capability_v162(
  p_session_token text,p_booking_code text default null
) returns jsonb language plpgsql volatile security definer set search_path to '' as $$
declare v_identity record;v_booking public.bookings%rowtype;v_organization uuid;
  v_client_enabled boolean:=false;v_support_enabled boolean:=false;
begin
  select * into v_identity from public.minuta_message_client_identity_v162(p_session_token);
  if v_identity.session_id is null then raise exception using errcode='42501',message='invalid_client_session'; end if;
  if p_booking_code is not null then
    select * into v_booking from public.bookings where booking_code=btrim(p_booking_code);
    if v_booking.id is null or not (
      (v_identity.session_scope='booking' and v_identity.claimed_booking_id=v_booking.id)
      or (v_identity.session_scope='organization' and v_booking.client_account_id=v_identity.client_account_id and v_booking.organization_id=v_identity.organization_id)
      or (v_identity.session_scope='account' and v_booking.client_account_id=v_identity.client_account_id)
    ) then raise exception using errcode='42501',message='message_booking_denied'; end if;
    v_organization:=v_booking.organization_id;
  elsif v_identity.session_scope='organization' then v_organization:=v_identity.organization_id;
  elsif v_identity.session_scope='booking' then
    select organization_id into v_organization from public.bookings where id=v_identity.claimed_booking_id;
  end if;
  if v_organization is not null then
    select coalesce(settings.client_chat_enabled,false),coalesce(settings.support_enabled,false)
      into v_client_enabled,v_support_enabled
    from public.message_center_settings_v162 settings where settings.organization_id=v_organization;
  elsif v_identity.session_scope='account' then
    with accessible_organizations as (
      select booking.organization_id from public.bookings booking
      where booking.client_account_id=v_identity.client_account_id and booking.organization_id is not null
      union
      select conversation.organization_id from public.message_conversations_v162 conversation
      where conversation.client_account_id=v_identity.client_account_id and conversation.organization_id is not null
    )
    select coalesce(bool_or(settings.client_chat_enabled),false),coalesce(bool_or(settings.support_enabled),false)
      into v_client_enabled,v_support_enabled
    from accessible_organizations allowed
    join public.message_center_settings_v162 settings on settings.organization_id=allowed.organization_id;
  end if;
  return jsonb_build_object('client_chat_enabled',coalesce(v_client_enabled,false),
    'support_enabled',coalesce(v_support_enabled,false),'media_enabled',false,'transcription_enabled',false);
end
$$;

create or replace function public.set_minuta_message_center_settings_v162(
  p_organization uuid,p_client_chat_enabled boolean,p_support_enabled boolean
) returns jsonb language plpgsql volatile security definer set search_path to '' as $$
declare v_actor uuid:=auth.uid();
begin
  if v_actor is null or not public.has_organization_role(p_organization,array['owner','admin']) then
    raise exception using errcode='42501',message='message_settings_denied';
  end if;
  insert into public.message_center_settings_v162(
    organization_id,client_chat_enabled,support_enabled,media_enabled,transcription_enabled,updated_by
  ) values(p_organization,coalesce(p_client_chat_enabled,false),coalesce(p_support_enabled,false),false,false,v_actor)
  on conflict(organization_id) do update set client_chat_enabled=excluded.client_chat_enabled,
    support_enabled=excluded.support_enabled,media_enabled=false,transcription_enabled=false,
    updated_by=v_actor,updated_at=now();
  insert into public.message_audit_events_v162(organization_id,actor_kind,actor_ref,event_type,details)
  values(p_organization,'provider','provider:'||v_actor::text,'message_settings_changed',
    jsonb_build_object('client_chat_enabled',coalesce(p_client_chat_enabled,false),
      'support_enabled',coalesce(p_support_enabled,false)));
  return public.get_minuta_message_capability_v162(p_organization);
end
$$;

create or replace function public.set_minuta_support_agent_v162(
  p_user uuid,p_role text,p_active boolean
) returns boolean language plpgsql volatile security definer set search_path to '' as $$
begin
  if coalesce(auth.role(),'')<>'service_role' then
    raise exception using errcode='42501',message='support_agent_provision_denied';
  end if;
  if p_user is null or p_role not in('agent','lead') then
    raise exception using errcode='22023',message='invalid_support_agent';
  end if;
  insert into public.message_support_agents_v162(user_id,support_role,active)
  values(p_user,p_role,coalesce(p_active,false))
  on conflict(user_id) do update set support_role=excluded.support_role,active=excluded.active,updated_at=now();
  insert into public.message_audit_events_v162(actor_kind,actor_ref,event_type,details)
  values('service','service:support-provisioner','support_agent_changed',
    jsonb_build_object('support_user_ref','support:'||p_user::text,'role',p_role,'active',coalesce(p_active,false)));
  return true;
end
$$;

create or replace function public.minuta_message_ensure_booking_participants_v162(
  p_conversation uuid,p_booking public.bookings,p_actor uuid default null,p_actor_role text default null
) returns void language plpgsql volatile security definer set search_path to '' as $$
begin
  insert into public.message_participants_v162(
    conversation_id,participant_kind,user_id,participant_role
  ) values(p_conversation,'organization_user',p_booking.performer_id,'specialist')
  on conflict do nothing;
  if p_actor is not null then
    insert into public.message_participants_v162(
      conversation_id,participant_kind,user_id,participant_role
    ) values(p_conversation,'organization_user',p_actor,
      case when p_actor_role in('owner','admin') then p_actor_role else 'specialist' end)
    on conflict do nothing;
  end if;
  if p_booking.client_account_id is not null then
    insert into public.message_participants_v162(
      conversation_id,participant_kind,client_account_id,participant_role
    ) values(p_conversation,'client_account',p_booking.client_account_id,'client')
    on conflict do nothing;
  else
    insert into public.message_participants_v162(
      conversation_id,participant_kind,booking_id,participant_role
    ) values(p_conversation,'booking_client',p_booking.id,'client')
    on conflict do nothing;
  end if;
end
$$;

create or replace function public.open_minuta_provider_conversation_v162(
  p_organization uuid,p_booking uuid,p_request_id uuid
) returns jsonb language plpgsql volatile security definer set search_path to '' as $$
declare v_actor uuid:=auth.uid();v_role text;v_booking public.bookings%rowtype;v_conversation uuid;
  v_actor_key text;v_hash text;v_response jsonb;v_created boolean:=false;
begin
  if p_request_id is null then raise exception using errcode='22023',message='invalid_message_request'; end if;
  v_role:=public.minuta_message_provider_role_v162(p_organization);
  if v_role is null then raise exception using errcode='42501',message='message_organization_denied'; end if;
  if not exists(select 1 from public.message_center_settings_v162 settings
    where settings.organization_id=p_organization and settings.client_chat_enabled) then
    raise exception using errcode='P0001',message='message_center_disabled';
  end if;
  select * into v_booking from public.bookings booking
  where booking.id=p_booking and booking.organization_id=p_organization;
  if not found or (v_role='specialist' and v_booking.performer_id<>v_actor) then
    raise exception using errcode='42501',message='message_booking_denied';
  end if;
  v_actor_key:='provider:'||v_actor::text;
  v_hash:=encode(extensions.digest(convert_to(concat_ws('|',p_organization,p_booking),'UTF8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended('message-request:'||v_actor_key||':'||p_request_id::text,16001));
  v_response:=public.minuta_message_receipt_v162(v_actor_key,'open_client_conversation',p_request_id,v_hash);
  if v_response is not null then return v_response; end if;
  perform pg_advisory_xact_lock(hashtextextended('message-booking:'||p_booking::text,16002));
  select id into v_conversation from public.message_conversations_v162
  where conversation_kind='client' and primary_booking_id=p_booking;
  if v_conversation is null then
    insert into public.message_conversations_v162(
      conversation_kind,organization_id,primary_booking_id,client_account_id,subject
    ) values('client',p_organization,p_booking,v_booking.client_account_id,'')
    returning id into v_conversation;
    v_created:=true;
  end if;
  perform public.minuta_message_ensure_booking_participants_v162(v_conversation,v_booking,v_actor,v_role);
  v_response:=jsonb_build_object('conversation_id',v_conversation,'kind','client','booking_id',p_booking,
    'created',v_created,'replayed',false);
  insert into public.message_idempotency_receipts_v162(actor_key,operation,request_id,request_sha256,response)
  values(v_actor_key,'open_client_conversation',p_request_id,v_hash,v_response);
  insert into public.message_audit_events_v162(organization_id,conversation_id,actor_kind,actor_ref,event_type,request_id,details)
  values(p_organization,v_conversation,'provider',v_actor_key,'conversation_opened',p_request_id,
    jsonb_build_object('kind','client','booking_ref','booking:'||p_booking::text,'created',v_created));
  return v_response;
end
$$;

create or replace function public.open_minuta_client_conversation_v162(
  p_session_token text,p_booking_code text,p_request_id uuid
) returns jsonb language plpgsql volatile security definer set search_path to '' as $$
declare v_identity record;v_booking public.bookings%rowtype;v_conversation uuid;v_actor_key text;
  v_hash text;v_response jsonb;v_created boolean:=false;
begin
  if p_request_id is null then raise exception using errcode='22023',message='invalid_message_request'; end if;
  select * into v_identity from public.minuta_message_client_identity_v162(p_session_token);
  if v_identity.session_id is null then raise exception using errcode='42501',message='invalid_client_session'; end if;
  if char_length(btrim(coalesce(p_booking_code,''))) not between 1 and 80 then
    raise exception using errcode='22023',message='invalid_booking_code';
  end if;
  select * into v_booking from public.bookings booking where booking.booking_code=btrim(p_booking_code);
  if not found or not (
    (v_identity.session_scope='booking' and v_identity.claimed_booking_id=v_booking.id)
    or (v_identity.session_scope='organization' and v_booking.client_account_id=v_identity.client_account_id
      and v_booking.organization_id=v_identity.organization_id)
    or (v_identity.session_scope='account' and v_booking.client_account_id=v_identity.client_account_id)
  ) then raise exception using errcode='42501',message='message_booking_denied'; end if;
  if not exists(select 1 from public.message_center_settings_v162 settings
    where settings.organization_id=v_booking.organization_id and settings.client_chat_enabled) then
    raise exception using errcode='P0001',message='message_center_disabled';
  end if;
  v_actor_key:='client-session:'||v_identity.session_id::text;
  v_hash:=encode(extensions.digest(convert_to(v_booking.id::text,'UTF8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended('message-request:'||v_actor_key||':'||p_request_id::text,16001));
  v_response:=public.minuta_message_receipt_v162(v_actor_key,'open_client_conversation',p_request_id,v_hash);
  if v_response is not null then return v_response; end if;
  perform pg_advisory_xact_lock(hashtextextended('message-booking:'||v_booking.id::text,16002));
  select id into v_conversation from public.message_conversations_v162
  where conversation_kind='client' and primary_booking_id=v_booking.id;
  if v_conversation is null then
    insert into public.message_conversations_v162(
      conversation_kind,organization_id,primary_booking_id,client_account_id,subject
    ) values('client',v_booking.organization_id,v_booking.id,v_booking.client_account_id,'')
    returning id into v_conversation;
    v_created:=true;
  end if;
  perform public.minuta_message_ensure_booking_participants_v162(v_conversation,v_booking,null,null);
  v_response:=jsonb_build_object('conversation_id',v_conversation,'kind','client','booking_code',v_booking.booking_code,
    'created',v_created,'replayed',false);
  insert into public.message_idempotency_receipts_v162(actor_key,operation,request_id,request_sha256,response)
  values(v_actor_key,'open_client_conversation',p_request_id,v_hash,v_response);
  insert into public.message_audit_events_v162(organization_id,conversation_id,actor_kind,actor_ref,event_type,request_id,details)
  values(v_booking.organization_id,v_conversation,'client',v_actor_key,'conversation_opened',p_request_id,
    jsonb_build_object('kind','client','booking_ref','booking:'||v_booking.id::text,'created',v_created));
  return v_response;
end
$$;

create or replace function public.minuta_send_message_core_v162(
  p_conversation uuid,p_sender uuid,p_actor_kind text,p_actor_key text,p_request_id uuid,p_body text
) returns jsonb language plpgsql volatile security definer set search_path to '' as $$
declare v_body text:=btrim(coalesce(p_body,''));v_hash text;v_response jsonb;v_sequence bigint;v_message uuid;
  v_created timestamptz;v_organization uuid;
begin
  if p_request_id is null or char_length(v_body) not between 1 and 4000
     or p_actor_kind not in('provider','client','support') then
    raise exception using errcode='22023',message='invalid_message';
  end if;
  if not exists(select 1 from public.message_participants_v162 participant
    where participant.id=p_sender and participant.conversation_id=p_conversation and participant.active) then
    raise exception using errcode='42501',message='message_sender_denied';
  end if;
  v_hash:=encode(extensions.digest(convert_to(v_body,'UTF8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended('message-request:'||p_actor_key||':'||p_request_id::text,16001));
  v_response:=public.minuta_message_receipt_v162(p_actor_key,'send_message',p_request_id,v_hash);
  if v_response is not null then return v_response; end if;
  v_sequence:=public.minuta_message_next_sequence_v162(p_conversation);
  insert into public.conversation_messages_v162(
    conversation_id,sequence,sender_participant_id,message_kind,body,client_request_id,payload_sha256
  ) values(p_conversation,v_sequence,p_sender,'text',v_body,p_request_id,v_hash)
  returning id,created_at into v_message,v_created;
  select organization_id into v_organization from public.message_conversations_v162 where id=p_conversation;
  v_response:=jsonb_build_object('message_id',v_message,'conversation_id',p_conversation,
    'sequence',v_sequence,'sent_at',v_created,'client_request_id',p_request_id,'body',v_body,'replayed',false);
  insert into public.message_idempotency_receipts_v162(actor_key,operation,request_id,request_sha256,response)
  values(p_actor_key,'send_message',p_request_id,v_hash,v_response);
  insert into public.message_audit_events_v162(
    organization_id,conversation_id,message_id,actor_kind,actor_ref,event_type,request_id,details
  ) values(v_organization,p_conversation,v_message,p_actor_kind,p_actor_key,'message_sent',p_request_id,
    jsonb_build_object('sequence',v_sequence,'message_kind','text','body_octets',octet_length(v_body)));
  return v_response;
end
$$;

create or replace function public.send_minuta_provider_message_v162(
  p_conversation uuid,p_request_id uuid,p_body text
) returns jsonb language plpgsql volatile security definer set search_path to '' as $$
declare v_actor uuid:=auth.uid();v_conversation public.message_conversations_v162%rowtype;v_role text;v_sender uuid;
begin
  if v_actor is null or not public.minuta_message_provider_can_access_v162(p_conversation) then
    raise exception using errcode='42501',message='message_conversation_denied';
  end if;
  select * into v_conversation from public.message_conversations_v162 where id=p_conversation;
  v_role:=public.minuta_message_provider_role_v162(v_conversation.organization_id);
  if v_conversation.conversation_kind='client' and not exists(select 1 from public.message_center_settings_v162 settings
    where settings.organization_id=v_conversation.organization_id and settings.client_chat_enabled) then
    raise exception using errcode='P0001',message='message_center_disabled';
  end if;
  if v_conversation.conversation_kind='support' and not exists(select 1 from public.message_center_settings_v162 settings
    where settings.organization_id=v_conversation.organization_id and settings.support_enabled) then
    raise exception using errcode='P0001',message='message_support_disabled';
  end if;
  insert into public.message_participants_v162(conversation_id,participant_kind,user_id,participant_role)
  values(p_conversation,'organization_user',v_actor,case when v_role in('owner','admin') then v_role else 'specialist' end)
  on conflict do nothing;
  select id into v_sender from public.message_participants_v162
  where conversation_id=p_conversation and participant_kind='organization_user' and user_id=v_actor and active;
  return public.minuta_send_message_core_v162(p_conversation,v_sender,'provider','provider:'||v_actor::text,
    p_request_id,p_body);
end
$$;

create or replace function public.send_minuta_client_message_v162(
  p_session_token text,p_conversation uuid,p_request_id uuid,p_body text
) returns jsonb language plpgsql volatile security definer set search_path to '' as $$
declare v_identity record;v_conversation public.message_conversations_v162%rowtype;v_sender uuid;
begin
  select * into v_identity from public.minuta_message_client_identity_v162(p_session_token);
  if v_identity.session_id is null or not public.minuta_message_client_can_access_v162(p_session_token,p_conversation) then
    raise exception using errcode='42501',message='message_conversation_denied';
  end if;
  select * into v_conversation from public.message_conversations_v162 where id=p_conversation;
  if v_conversation.conversation_kind='client' and not exists(select 1 from public.message_center_settings_v162 settings
    where settings.organization_id=v_conversation.organization_id and settings.client_chat_enabled) then
    raise exception using errcode='P0001',message='message_center_disabled';
  end if;
  if v_conversation.conversation_kind='support' and not exists(select 1 from public.message_center_settings_v162 settings
    where settings.organization_id=v_conversation.organization_id and settings.support_enabled) then
    raise exception using errcode='P0001',message='message_support_disabled';
  end if;
  if v_identity.session_scope='booking' then
    select id into v_sender from public.message_participants_v162 where conversation_id=p_conversation
      and participant_kind='booking_client' and booking_id=v_identity.claimed_booking_id and active;
  else
    select id into v_sender from public.message_participants_v162 where conversation_id=p_conversation
      and participant_kind='client_account' and client_account_id=v_identity.client_account_id and active;
  end if;
  if v_sender is null then raise exception using errcode='42501',message='message_sender_denied'; end if;
  return public.minuta_send_message_core_v162(p_conversation,v_sender,'client',
    'client-session:'||v_identity.session_id::text,p_request_id,p_body);
end
$$;

create or replace function public.minuta_message_timeline_core_v162(
  p_conversation uuid,p_after_sequence bigint,p_before_sequence bigint,p_limit integer
) returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_items jsonb;v_first bigint;v_last bigint;v_has_more boolean;
begin
  if coalesce(p_limit,0) not between 1 and 100 or (p_after_sequence is not null and p_before_sequence is not null)
     or coalesce(p_after_sequence,0)<0 or coalesce(p_before_sequence,1)<1 then
    raise exception using errcode='22023',message='invalid_message_cursor';
  end if;
  with entries as (
    select message.sequence,message.created_at,'message'::text entry_kind,
      jsonb_build_object('entry_kind','message','sequence',message.sequence,'created_at',message.created_at,
        'message_id',message.id,'client_request_id',message.client_request_id,'sender_role',participant.participant_role,'body',message.body,
        'message_kind',message.message_kind,'action',case when action.id is null then null else jsonb_build_object(
          'action_id',action.id,'action_type',action.action_type,'state',action.state,'payload',action.public_payload,
          'result_code',action.result_code,'expires_at',action.expires_at) end,'attachments','[]'::jsonb) item
    from public.conversation_messages_v162 message
    join public.message_participants_v162 participant on participant.id=message.sender_participant_id
    left join public.conversation_message_actions_v162 action on action.message_id=message.id
    where message.conversation_id=p_conversation
    union all
    select event.sequence,event.created_at,'system'::text,
      jsonb_build_object('entry_kind','system','sequence',event.sequence,'created_at',event.created_at,
        'event_type',event.event_type,'payload',event.payload)
    from public.conversation_system_events_v162 event where event.conversation_id=p_conversation
  ), page as (
    select * from entries
    where (p_after_sequence is null or sequence>p_after_sequence)
      and (p_before_sequence is null or sequence<p_before_sequence)
    order by case when p_before_sequence is null then sequence end asc,
      case when p_before_sequence is not null then sequence end desc
    limit p_limit
  ), ordered as (select * from page order by sequence)
  select coalesce(jsonb_agg(item order by sequence),'[]'::jsonb),min(sequence),max(sequence)
  into v_items,v_first,v_last from ordered;
  if p_before_sequence is not null and v_first is not null then
    select exists(select 1 from (
      select sequence from public.conversation_messages_v162 where conversation_id=p_conversation
      union all select sequence from public.conversation_system_events_v162 where conversation_id=p_conversation
    ) e where e.sequence<v_first) into v_has_more;
  elsif v_last is not null then
    select exists(select 1 from (
      select sequence from public.conversation_messages_v162 where conversation_id=p_conversation
      union all select sequence from public.conversation_system_events_v162 where conversation_id=p_conversation
    ) e where e.sequence>v_last) into v_has_more;
  else v_has_more:=false; end if;
  return jsonb_build_object('conversation_id',p_conversation,'items',v_items,'first_sequence',v_first,
    'last_sequence',v_last,'has_more',coalesce(v_has_more,false));
end
$$;

create or replace function public.get_minuta_provider_message_timeline_v162(
  p_conversation uuid,p_after_sequence bigint default null,p_before_sequence bigint default null,p_limit integer default 50
) returns jsonb language plpgsql stable security definer set search_path to '' as $$
begin
  if auth.uid() is null or not public.minuta_message_provider_can_access_v162(p_conversation) then
    raise exception using errcode='42501',message='message_conversation_denied';
  end if;
  return public.minuta_message_timeline_core_v162(p_conversation,p_after_sequence,p_before_sequence,p_limit);
end
$$;

create or replace function public.get_minuta_client_message_timeline_v162(
  p_session_token text,p_conversation uuid,p_after_sequence bigint default null,p_before_sequence bigint default null,p_limit integer default 50
) returns jsonb language plpgsql volatile security definer set search_path to '' as $$
begin
  if not public.minuta_message_client_can_access_v162(p_session_token,p_conversation) then
    raise exception using errcode='42501',message='message_conversation_denied';
  end if;
  return public.minuta_message_timeline_core_v162(p_conversation,p_after_sequence,p_before_sequence,p_limit);
end
$$;

create or replace function public.minuta_mark_message_read_core_v162(
  p_conversation uuid,p_participant uuid,p_sequence bigint
) returns jsonb language plpgsql volatile security definer set search_path to '' as $$
declare v_max bigint;v_value bigint;
begin
  select next_sequence into v_max from public.message_conversations_v162 where id=p_conversation;
  if v_max is null or p_sequence is null or p_sequence<0 then raise exception using errcode='22023',message='invalid_read_sequence'; end if;
  v_value:=least(p_sequence,v_max);
  insert into public.message_read_receipts_v162(conversation_id,participant_id,last_read_sequence)
  values(p_conversation,p_participant,v_value)
  on conflict(conversation_id,participant_id) do update
    set last_read_sequence=greatest(public.message_read_receipts_v162.last_read_sequence,excluded.last_read_sequence),updated_at=now()
  returning last_read_sequence into v_value;
  return jsonb_build_object('conversation_id',p_conversation,'last_read_sequence',v_value);
end
$$;

create or replace function public.mark_minuta_provider_message_read_v162(p_conversation uuid,p_sequence bigint)
returns jsonb language plpgsql volatile security definer set search_path to '' as $$
declare v_actor uuid:=auth.uid();v_participant uuid;v_conversation public.message_conversations_v162%rowtype;v_role text;
begin
  if v_actor is null or not public.minuta_message_provider_can_access_v162(p_conversation) then
    raise exception using errcode='42501',message='message_conversation_denied';
  end if;
  select * into v_conversation from public.message_conversations_v162 where id=p_conversation;
  v_role:=public.minuta_message_provider_role_v162(v_conversation.organization_id);
  insert into public.message_participants_v162(conversation_id,participant_kind,user_id,participant_role)
  values(p_conversation,'organization_user',v_actor,case when v_role in('owner','admin') then v_role else 'specialist' end)
  on conflict do nothing;
  select id into v_participant from public.message_participants_v162 where conversation_id=p_conversation and user_id=v_actor and active;
  return public.minuta_mark_message_read_core_v162(p_conversation,v_participant,p_sequence);
end
$$;

create or replace function public.mark_minuta_client_message_read_v162(
  p_session_token text,p_conversation uuid,p_sequence bigint
) returns jsonb language plpgsql volatile security definer set search_path to '' as $$
declare v_identity record;v_participant uuid;
begin
  select * into v_identity from public.minuta_message_client_identity_v162(p_session_token);
  if v_identity.session_id is null or not public.minuta_message_client_can_access_v162(p_session_token,p_conversation) then
    raise exception using errcode='42501',message='message_conversation_denied';
  end if;
  if v_identity.session_scope='booking' then
    select id into v_participant from public.message_participants_v162 where conversation_id=p_conversation
      and participant_kind='booking_client' and booking_id=v_identity.claimed_booking_id and active;
  else
    select id into v_participant from public.message_participants_v162 where conversation_id=p_conversation
      and participant_kind='client_account' and client_account_id=v_identity.client_account_id and active;
  end if;
  if v_participant is null then raise exception using errcode='42501',message='message_participant_denied'; end if;
  return public.minuta_mark_message_read_core_v162(p_conversation,v_participant,p_sequence);
end
$$;

create or replace function public.list_minuta_provider_conversations_v162(
  p_organization uuid,p_before_activity timestamptz default null,p_before_id uuid default null,
  p_limit integer default 30,p_query text default ''
) returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_role text;v_actor uuid:=auth.uid();v_items jsonb;v_last_activity timestamptz;v_last_id uuid;
begin
  v_role:=public.minuta_message_provider_role_v162(p_organization);
  if v_role is null then raise exception using errcode='42501',message='message_organization_denied'; end if;
  if coalesce(p_limit,0) not between 1 and 50
     or ((p_before_activity is null)<>(p_before_id is null))
     or char_length(btrim(coalesce(p_query,'')))>80 then
    raise exception using errcode='22023',message='invalid_conversation_cursor';
  end if;
  with page as (
    select conversation.*,booking.booking_code,booking.client_name,service.name service_name,
      coalesce((select message.body from public.conversation_messages_v162 message
        where message.conversation_id=conversation.id order by message.sequence desc limit 1),'') last_preview,
      greatest(conversation.next_sequence-coalesce((select receipt.last_read_sequence
        from public.message_read_receipts_v162 receipt join public.message_participants_v162 participant
          on participant.id=receipt.participant_id
        where receipt.conversation_id=conversation.id and participant.user_id=v_actor and participant.active limit 1),0),0) unread_count
    from public.message_conversations_v162 conversation
    left join public.bookings booking on booking.id=conversation.primary_booking_id
    left join public.services service on service.id=booking.service_id
    where conversation.organization_id=p_organization
      and public.minuta_message_provider_can_access_v162(conversation.id)
      and (p_before_activity is null or (conversation.last_activity_at,conversation.id)<(p_before_activity,p_before_id))
      and (btrim(coalesce(p_query,''))='' or concat_ws(' ',booking.client_name,booking.booking_code,service.name)
        ilike '%'||btrim(p_query)||'%')
    order by conversation.last_activity_at desc,conversation.id desc limit p_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'conversation_id',page.id,'kind',page.conversation_kind,'state',page.state,
    'booking_id',page.primary_booking_id,'booking_code',page.booking_code,'client_name',coalesce(page.client_name,''),
    'service_name',coalesce(page.service_name,''),'last_activity_at',page.last_activity_at,
    'last_preview',page.last_preview,'last_sequence',page.next_sequence,'unread_count',page.unread_count,
    'can_send',page.state='open' and exists(select 1 from public.message_center_settings_v162 settings
      where settings.organization_id=page.organization_id and case when page.conversation_kind='client' then settings.client_chat_enabled else settings.support_enabled end)
  ) order by page.last_activity_at desc,page.id desc),'[]'::jsonb),
  (array_agg(page.last_activity_at order by page.last_activity_at desc,page.id desc))[count(*)::integer],
  (array_agg(page.id order by page.last_activity_at desc,page.id desc))[count(*)::integer]
  into v_items,v_last_activity,v_last_id from page;
  return jsonb_build_object('items',v_items,'next_cursor',case when v_last_id is null then null else
    jsonb_build_object('before_activity',v_last_activity,'before_id',v_last_id) end);
end
$$;

create or replace function public.list_minuta_client_conversations_v162(
  p_session_token text,p_before_activity timestamptz default null,p_before_id uuid default null,
  p_limit integer default 30,p_query text default ''
) returns jsonb language plpgsql volatile security definer set search_path to '' as $$
declare v_identity record;v_items jsonb;v_last_activity timestamptz;v_last_id uuid;
begin
  select * into v_identity from public.minuta_message_client_identity_v162(p_session_token);
  if v_identity.session_id is null then raise exception using errcode='42501',message='invalid_client_session'; end if;
  if coalesce(p_limit,0) not between 1 and 50 or ((p_before_activity is null)<>(p_before_id is null))
     or char_length(btrim(coalesce(p_query,'')))>80 then
    raise exception using errcode='22023',message='invalid_conversation_cursor';
  end if;
  with page as (
    select conversation.*,booking.booking_code,booking.client_name,service.name service_name,
      coalesce((select message.body from public.conversation_messages_v162 message
        where message.conversation_id=conversation.id order by message.sequence desc limit 1),'') last_preview,
      greatest(conversation.next_sequence-coalesce((select receipt.last_read_sequence
        from public.message_read_receipts_v162 receipt join public.message_participants_v162 participant
          on participant.id=receipt.participant_id
        where receipt.conversation_id=conversation.id and participant.active and (
          (v_identity.session_scope='booking' and participant.booking_id=v_identity.claimed_booking_id)
          or (v_identity.session_scope<>'booking' and participant.client_account_id=v_identity.client_account_id)) limit 1),0),0) unread_count
    from public.message_conversations_v162 conversation
    left join public.bookings booking on booking.id=conversation.primary_booking_id
    left join public.services service on service.id=booking.service_id
    where (
      (v_identity.session_scope='booking' and conversation.primary_booking_id=v_identity.claimed_booking_id)
      or (v_identity.session_scope='organization' and conversation.client_account_id=v_identity.client_account_id
        and conversation.organization_id=v_identity.organization_id)
      or (v_identity.session_scope='account' and conversation.client_account_id=v_identity.client_account_id)
    ) and (p_before_activity is null or (conversation.last_activity_at,conversation.id)<(p_before_activity,p_before_id))
      and (btrim(coalesce(p_query,''))='' or concat_ws(' ',booking.booking_code,service.name)
        ilike '%'||btrim(p_query)||'%')
    order by conversation.last_activity_at desc,conversation.id desc limit p_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'conversation_id',page.id,'kind',page.conversation_kind,'state',page.state,
    'booking_code',page.booking_code,'client_name',coalesce(page.client_name,''),
    'service_name',coalesce(page.service_name,''),'last_activity_at',page.last_activity_at,
    'last_preview',page.last_preview,'last_sequence',page.next_sequence,'unread_count',page.unread_count,
    'can_send',page.state='open' and exists(select 1 from public.message_center_settings_v162 settings
      where settings.organization_id=page.organization_id and case when page.conversation_kind='client' then settings.client_chat_enabled else settings.support_enabled end)
  ) order by page.last_activity_at desc,page.id desc),'[]'::jsonb),
  (array_agg(page.last_activity_at order by page.last_activity_at desc,page.id desc))[count(*)::integer],
  (array_agg(page.id order by page.last_activity_at desc,page.id desc))[count(*)::integer]
  into v_items,v_last_activity,v_last_id from page;
  return jsonb_build_object('items',v_items,'next_cursor',case when v_last_id is null then null else
    jsonb_build_object('before_activity',v_last_activity,'before_id',v_last_id) end);
end
$$;

create or replace function public.capture_minuta_message_booking_event_v162()
returns trigger language plpgsql volatile security definer set search_path to '' as $$
declare v_conversation record;v_sequence bigint;
begin
  for v_conversation in
    select conversation.id from public.message_conversations_v162 conversation
    where conversation.conversation_kind='client' and conversation.state='open'
      and conversation.organization_id=new.organization_id
      and conversation.primary_booking_id=new.booking_id
    order by conversation.id
  loop
    if not exists(select 1 from public.conversation_system_events_v162 event
      where event.conversation_id=v_conversation.id and event.source_booking_event_id=new.id) then
      v_sequence:=public.minuta_message_next_sequence_v162(v_conversation.id);
      insert into public.conversation_system_events_v162(
        conversation_id,sequence,source_booking_event_id,event_type,payload,created_at
      ) values(v_conversation.id,v_sequence,new.id,new.event_type,jsonb_strip_nulls(jsonb_build_object(
        'actor_role',new.actor_role,'previous_booking_date',new.previous_booking_date,
        'booking_date',new.booking_date,'old_time',new.details->>'old_time','new_time',new.details->>'new_time',
        'old_status',new.details->>'old_status','new_status',new.details->>'new_status'
      )),new.occurred_at);
    end if;
  end loop;
  return new;
end
$$;

drop trigger if exists booking_events_message_timeline_v162 on public.booking_events;
create trigger booking_events_message_timeline_v162 after insert on public.booking_events
for each row execute function public.capture_minuta_message_booking_event_v162();

create or replace function public.propose_minuta_message_action_v162(
  p_conversation uuid,p_booking uuid,p_request_id uuid,p_action_type text,p_payload jsonb
) returns jsonb language plpgsql volatile security definer set search_path to '' as $$
declare v_actor uuid:=auth.uid();v_conversation public.message_conversations_v162%rowtype;v_booking public.bookings%rowtype;
  v_sender uuid;v_role text;v_hash text;v_response jsonb;v_sequence bigint;v_message uuid;v_action uuid;v_expires timestamptz;
begin
  if v_actor is null or p_request_id is null or not public.minuta_message_provider_can_access_v162(p_conversation)
     or p_action_type not in('propose_time','send_address','send_preparation','visit_context')
     or jsonb_typeof(coalesce(p_payload,'null'::jsonb))<>'object' or octet_length(p_payload::text)>8192 then
    raise exception using errcode='22023',message='invalid_message_action';
  end if;
  select * into v_conversation from public.message_conversations_v162
  where id=p_conversation and conversation_kind='client' and primary_booking_id=p_booking and state='open';
  select * into v_booking from public.bookings where id=p_booking and organization_id=v_conversation.organization_id;
  if v_booking.id is null then raise exception using errcode='42501',message='message_action_denied'; end if;
  if p_action_type='propose_time' then
    if p_payload-array['target_date','target_time']<>'{}'::jsonb
       or coalesce(p_payload->>'target_date','')!~'^\d{4}-\d{2}-\d{2}$'
       or coalesce(p_payload->>'target_time','')!~'^\d{2}:\d{2}(:00)?$' then
      raise exception using errcode='22023',message='invalid_message_action';
    end if;
    begin perform (p_payload->>'target_date')::date;perform (p_payload->>'target_time')::time; exception when others then
      raise exception using errcode='22023',message='invalid_message_action'; end;
    v_expires:=now()+interval '48 hours';
  else
    if p_payload-array['title','body']<>'{}'::jsonb
       or char_length(btrim(coalesce(p_payload->>'title',''))) not between 1 and 160
       or char_length(btrim(coalesce(p_payload->>'body',''))) not between 1 and 2000 then
      raise exception using errcode='22023',message='invalid_message_action';
    end if;
    v_expires:=now()+interval '30 days';
  end if;
  v_hash:=encode(extensions.digest(convert_to(p_action_type||'|'||p_booking::text||'|'||p_payload::text,'UTF8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended('message-request:provider:'||v_actor::text||':'||p_request_id::text,16001));
  v_response:=public.minuta_message_receipt_v162('provider:'||v_actor::text,'propose_action',p_request_id,v_hash);
  if v_response is not null then return v_response; end if;
  v_role:=public.minuta_message_provider_role_v162(v_conversation.organization_id);
  insert into public.message_participants_v162(conversation_id,participant_kind,user_id,participant_role)
  values(p_conversation,'organization_user',v_actor,case when v_role in('owner','admin') then v_role else 'specialist' end)
  on conflict do nothing;
  select id into v_sender from public.message_participants_v162 where conversation_id=p_conversation and user_id=v_actor and active;
  v_sequence:=public.minuta_message_next_sequence_v162(p_conversation);
  insert into public.conversation_messages_v162(conversation_id,sequence,sender_participant_id,message_kind,body,client_request_id,payload_sha256)
  values(p_conversation,v_sequence,v_sender,'action','',p_request_id,v_hash) returning id into v_message;
  insert into public.conversation_message_actions_v162(
    conversation_id,message_id,booking_id,action_type,public_payload,expected_booking_sha256,expires_at
  ) values(p_conversation,v_message,p_booking,p_action_type,p_payload,public.minuta_message_booking_sha256_v162(v_booking),v_expires)
  returning id into v_action;
  v_response:=jsonb_build_object('message_id',v_message,'conversation_id',p_conversation,'sequence',v_sequence,
    'sent_at',now(),'action_id',v_action,'action_type',p_action_type,'replayed',false);
  insert into public.message_idempotency_receipts_v162 values('provider:'||v_actor::text,'propose_action',p_request_id,v_hash,v_response,now());
  insert into public.message_audit_events_v162(organization_id,conversation_id,message_id,action_id,actor_kind,actor_ref,event_type,request_id,details)
  values(v_booking.organization_id,p_conversation,v_message,v_action,'provider','provider:'||v_actor::text,'message_action_proposed',p_request_id,
    jsonb_build_object('action_type',p_action_type,'booking_ref','booking:'||p_booking::text));
  return v_response;
end
$$;

create or replace function public.prepare_minuta_message_action_v162(
  p_session_token text,p_action uuid,p_request_id uuid
) returns jsonb language plpgsql volatile security definer set search_path to '' as $$
declare v_identity record;v_action public.conversation_message_actions_v162%rowtype;v_booking public.bookings%rowtype;
  v_token text;v_hash text;v_expires timestamptz:=now()+interval '5 minutes';v_service text;
  v_actor_key text;v_request_hash text;v_response jsonb;
begin
  if p_request_id is null then raise exception using errcode='22023',message='invalid_action_confirmation'; end if;
  select * into v_identity from public.minuta_message_client_identity_v162(p_session_token);
  if v_identity.session_id is null then raise exception using errcode='42501',message='message_action_unavailable'; end if;
  v_actor_key:='client-session:'||v_identity.session_id::text;
  v_request_hash:=encode(extensions.digest(convert_to(p_action::text,'UTF8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended('message-request:'||v_actor_key||':'||p_request_id::text,16001));
  v_response:=public.minuta_message_receipt_v162(v_actor_key,'prepare_action',p_request_id,v_request_hash);
  if v_response is not null then return v_response; end if;
  select * into v_action from public.conversation_message_actions_v162 where id=p_action;
  if v_action.id is null
     or not public.minuta_message_client_can_access_v162(p_session_token,v_action.conversation_id)
     or v_action.action_type<>'propose_time' or v_action.state<>'proposed' or v_action.expires_at<=now() then
    raise exception using errcode='42501',message='message_action_unavailable';
  end if;
  select * into v_booking from public.bookings where id=v_action.booking_id;
  if public.minuta_message_booking_sha256_v162(v_booking)<>v_action.expected_booking_sha256 then
    raise exception using errcode='40001',message='booking_changed';
  end if;
  v_token:=encode(extensions.gen_random_bytes(32),'hex');
  v_hash:=encode(extensions.digest(v_token,'sha256'),'hex');
  insert into public.message_action_confirmations_v162(action_id,client_session_id,request_id,token_hash,booking_sha256,expires_at)
  values(p_action,v_identity.session_id,p_request_id,v_hash,v_action.expected_booking_sha256,v_expires);
  select name into v_service from public.services where id=v_booking.service_id;
  insert into public.message_audit_events_v162(organization_id,conversation_id,action_id,actor_kind,actor_ref,event_type,request_id,details)
  values(v_booking.organization_id,v_action.conversation_id,p_action,'client','client-session:'||v_identity.session_id::text,
    'message_action_confirmation_prepared',p_request_id,jsonb_build_object('action_type','propose_time'));
  v_response:=jsonb_build_object('action_id',p_action,'confirmation_token',v_token,'expires_at',v_expires,
    'requires_confirmation',true,'summary',jsonb_build_object('booking_code',v_booking.booking_code,
      'service_name',v_service,'current_date',v_booking.booking_date,'current_time',v_booking.booking_time,
      'target_date',v_action.public_payload->>'target_date','target_time',v_action.public_payload->>'target_time',
      'duration_minutes',v_booking.duration_minutes));
  insert into public.message_idempotency_receipts_v162(actor_key,operation,request_id,request_sha256,response)
  values(v_actor_key,'prepare_action',p_request_id,v_request_hash,v_response);
  return v_response;
end
$$;

create or replace function public.apply_minuta_message_action_v162(
  p_session_token text,p_action uuid,p_confirmation_token text,p_request_id uuid
) returns jsonb language plpgsql volatile security definer set search_path to '' as $$
declare v_identity record;v_action public.conversation_message_actions_v162%rowtype;v_confirmation public.message_action_confirmations_v162%rowtype;
  v_booking public.bookings%rowtype;v_hash text;v_actor_key text;v_request_hash text;v_response jsonb;
  v_target_date date;v_target_time time without time zone;v_result text:='ok';
  v_cutoff integer;v_limit integer;
begin
  if p_request_id is null or coalesce(p_confirmation_token,'')!~'^[0-9a-fA-F]{64}$' then
    raise exception using errcode='22023',message='invalid_action_confirmation';
  end if;
  select * into v_identity from public.minuta_message_client_identity_v162(p_session_token);
  if v_identity.session_id is null then raise exception using errcode='42501',message='invalid_client_session'; end if;
  v_actor_key:='client-session:'||v_identity.session_id::text;
  v_request_hash:=encode(extensions.digest(convert_to(p_action::text||'|'||lower(p_confirmation_token),'UTF8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended('message-request:'||v_actor_key||':'||p_request_id::text,16001));
  v_response:=public.minuta_message_receipt_v162(v_actor_key,'apply_action',p_request_id,v_request_hash);
  if v_response is not null then return v_response; end if;
  select * into v_action from public.conversation_message_actions_v162 where id=p_action for update;
  if not found or not public.minuta_message_client_can_access_v162(p_session_token,v_action.conversation_id)
     or v_action.action_type<>'propose_time' then raise exception using errcode='42501',message='message_action_unavailable'; end if;
  if v_action.state='applied' then v_result:='booking_changed';
  elsif v_action.state<>'proposed' or v_action.expires_at<=now() then v_result:='booking_unavailable'; end if;
  v_hash:=encode(extensions.digest(lower(p_confirmation_token),'sha256'),'hex');
  select * into v_confirmation from public.message_action_confirmations_v162
    where action_id=p_action and client_session_id=v_identity.session_id and token_hash=v_hash for update;
  if not found or v_confirmation.consumed_at is not null or v_confirmation.expires_at<=now() then
    raise exception using errcode='42501',message='action_confirmation_unavailable';
  end if;
  update public.message_action_confirmations_v162 set consumed_at=now() where id=v_confirmation.id;
  if v_result='ok' then
    perform pg_advisory_xact_lock(hashtextextended(v_action.booking_id::text,7302));
    select * into v_booking from public.bookings where id=v_action.booking_id;
    if not found then v_result:='booking_unavailable'; else
      perform pg_advisory_xact_lock(hashtextextended(v_booking.organization_id::text,7100));
      v_target_date:=(v_action.public_payload->>'target_date')::date;
      v_target_time:=(v_action.public_payload->>'target_time')::time;
      perform pg_advisory_xact_lock(hashtextextended(v_booking.performer_id::text||v_target_date::text,0));
      select * into v_booking from public.bookings where id=v_action.booking_id for update;
      v_cutoff:=coalesce((v_booking.booking_policy_snapshot->>'reschedule_cutoff_hours')::integer,12);
      v_limit:=coalesce((v_booking.booking_policy_snapshot->>'max_reschedules')::integer,2);
      if public.minuta_message_booking_sha256_v162(v_booking)<>v_confirmation.booking_sha256 then v_result:='booking_changed';
      elsif v_booking.status='cancelled' or exists(select 1 from public.booking_outcomes outcome
        where outcome.booking_id=v_booking.id and outcome.visit_status<>'scheduled') then v_result:='booking_unavailable';
      elsif timezone('Europe/Samara',now())>v_booking.booking_date+v_booking.booking_time-make_interval(hours=>v_cutoff) then v_result:='reschedule_too_late';
      elsif v_booking.reschedule_count>=v_limit then v_result:='reschedule_limit_reached';
      elsif not exists(select 1 from public.get_available_slots_v101(v_booking.service_id,v_target_date,v_target_date,v_booking.id) slot
        where slot.booking_date=v_target_date and slot.booking_time=v_target_time) then v_result:='slot_unavailable';
      else
        begin
          update public.bookings set booking_date=v_target_date,booking_time=v_target_time,status='new',
            reschedule_count=reschedule_count+1 where id=v_booking.id returning * into v_booking;
        exception when exclusion_violation or unique_violation then v_result:='slot_unavailable';
          when raise_exception then
            if sqlerrm in('resource_unavailable','booking_buffer_conflict','slot_unavailable') then v_result:='slot_unavailable'; else raise; end if;
        end;
      end if;
    end if;
  end if;
  update public.conversation_message_actions_v162 set state=case when v_result='ok' then 'applied' else 'failed' end,
    result_code=v_result,applied_at=case when v_result='ok' then now() else null end where id=p_action;
  v_response:=jsonb_build_object('action_id',p_action,'status',case when v_result='ok' then 'applied' else 'failed' end,
    'result_code',v_result,'booking',case when v_booking.id is null then null else jsonb_build_object(
      'booking_code',v_booking.booking_code,'booking_date',v_booking.booking_date,'booking_time',v_booking.booking_time,
      'status',v_booking.status) end,'replayed',false);
  insert into public.message_idempotency_receipts_v162 values(v_actor_key,'apply_action',p_request_id,v_request_hash,v_response,now());
  insert into public.message_audit_events_v162(organization_id,conversation_id,action_id,actor_kind,actor_ref,event_type,request_id,details)
  values(v_booking.organization_id,v_action.conversation_id,p_action,'client',v_actor_key,'message_action_applied',p_request_id,
    jsonb_build_object('result_code',v_result,'booking_ref','booking:'||v_action.booking_id::text));
  return v_response;
end
$$;

create or replace function public.open_minuta_provider_support_v162(
  p_organization uuid,p_request_id uuid,p_message text,p_diagnostics jsonb default '{}'::jsonb,
  p_diagnostics_consent boolean default false
) returns jsonb language plpgsql volatile security definer set search_path to '' as $$
declare v_actor uuid:=auth.uid();v_role text;v_conversation uuid;v_participant uuid;v_support uuid;
  v_actor_key text;v_hash text;v_response jsonb;v_diag jsonb:=coalesce(p_diagnostics,'{}'::jsonb);
begin
  v_role:=public.minuta_message_provider_role_v162(p_organization);
  if v_actor is null or v_role is null or p_request_id is null then raise exception using errcode='42501',message='message_support_denied'; end if;
  if not exists(select 1 from public.message_center_settings_v162 where organization_id=p_organization and support_enabled) then
    raise exception using errcode='P0001',message='message_support_disabled';
  end if;
  if not public.minuta_message_diagnostics_valid_v162(v_diag)
     or (not coalesce(p_diagnostics_consent,false) and v_diag<>'{}'::jsonb) then
    raise exception using errcode='22023',message='invalid_support_diagnostics';
  end if;
  v_actor_key:='provider:'||v_actor::text;
  v_hash:=encode(extensions.digest(convert_to(concat_ws('|',p_organization,btrim(p_message),v_diag::text,p_diagnostics_consent),'UTF8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended('message-request:'||v_actor_key||':'||p_request_id::text,16001));
  v_response:=public.minuta_message_receipt_v162(v_actor_key,'open_support',p_request_id,v_hash);
  if v_response is not null then return v_response; end if;
  insert into public.message_conversations_v162(conversation_kind,organization_id,subject)
  values('support',p_organization,'Техподдержка PrimeTime') returning id into v_conversation;
  insert into public.message_participants_v162(conversation_id,participant_kind,user_id,participant_role)
  values(v_conversation,'organization_user',v_actor,case when v_role in('owner','admin') then v_role else 'specialist' end)
  returning id into v_participant;
  insert into public.message_support_requests_v162(
    conversation_id,organization_id,requester_participant_id,diagnostics_consent_at,diagnostics_preview_sha256,diagnostics
  ) values(v_conversation,p_organization,v_participant,case when p_diagnostics_consent and v_diag<>'{}'::jsonb then now() end,
    case when p_diagnostics_consent and v_diag<>'{}'::jsonb then encode(extensions.digest(convert_to(v_diag::text,'UTF8'),'sha256'),'hex') end,
    case when p_diagnostics_consent then v_diag else '{}'::jsonb end) returning id into v_support;
  perform public.minuta_send_message_core_v162(v_conversation,v_participant,'provider',v_actor_key,p_request_id,p_message);
  v_response:=jsonb_build_object('support_request_id',v_support,'conversation_id',v_conversation,
    'state','waiting_for_human','diagnostics_attached',p_diagnostics_consent and v_diag<>'{}'::jsonb,
    'created',true,'replayed',false);
  insert into public.message_idempotency_receipts_v162 values(v_actor_key,'open_support',p_request_id,v_hash,v_response,now());
  return v_response;
end
$$;

create or replace function public.open_minuta_client_support_v162(
  p_session_token text,p_booking_code text,p_request_id uuid,p_message text,
  p_diagnostics jsonb default '{}'::jsonb,p_diagnostics_consent boolean default false
) returns jsonb language plpgsql volatile security definer set search_path to '' as $$
declare v_identity record;v_booking public.bookings%rowtype;v_conversation uuid;v_participant uuid;v_support uuid;
  v_actor_key text;v_hash text;v_response jsonb;v_diag jsonb:=coalesce(p_diagnostics,'{}'::jsonb);
begin
  select * into v_identity from public.minuta_message_client_identity_v162(p_session_token);
  select * into v_booking from public.bookings where booking_code=btrim(coalesce(p_booking_code,''));
  if v_identity.session_id is null or v_booking.id is null or p_request_id is null or not (
    (v_identity.session_scope='booking' and v_identity.claimed_booking_id=v_booking.id)
    or (v_identity.session_scope='organization' and v_booking.client_account_id=v_identity.client_account_id and v_booking.organization_id=v_identity.organization_id)
    or (v_identity.session_scope='account' and v_booking.client_account_id=v_identity.client_account_id)
  ) then raise exception using errcode='42501',message='message_support_denied'; end if;
  if not exists(select 1 from public.message_center_settings_v162 where organization_id=v_booking.organization_id and support_enabled) then
    raise exception using errcode='P0001',message='message_support_disabled';
  end if;
  if not public.minuta_message_diagnostics_valid_v162(v_diag)
     or (not coalesce(p_diagnostics_consent,false) and v_diag<>'{}'::jsonb) then
    raise exception using errcode='22023',message='invalid_support_diagnostics';
  end if;
  v_actor_key:='client-session:'||v_identity.session_id::text;
  v_hash:=encode(extensions.digest(convert_to(concat_ws('|',v_booking.id,btrim(p_message),v_diag::text,p_diagnostics_consent),'UTF8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended('message-request:'||v_actor_key||':'||p_request_id::text,16001));
  v_response:=public.minuta_message_receipt_v162(v_actor_key,'open_support',p_request_id,v_hash);
  if v_response is not null then return v_response; end if;
  insert into public.message_conversations_v162(conversation_kind,organization_id,primary_booking_id,client_account_id,subject)
  values('support',v_booking.organization_id,v_booking.id,v_booking.client_account_id,'Техподдержка PrimeTime') returning id into v_conversation;
  if v_identity.session_scope='booking' then
    insert into public.message_participants_v162(conversation_id,participant_kind,booking_id,participant_role)
    values(v_conversation,'booking_client',v_booking.id,'client') returning id into v_participant;
  else
    insert into public.message_participants_v162(conversation_id,participant_kind,client_account_id,participant_role)
    values(v_conversation,'client_account',v_identity.client_account_id,'client') returning id into v_participant;
  end if;
  insert into public.message_support_requests_v162(
    conversation_id,organization_id,requester_participant_id,diagnostics_consent_at,diagnostics_preview_sha256,diagnostics
  ) values(v_conversation,v_booking.organization_id,v_participant,case when p_diagnostics_consent and v_diag<>'{}'::jsonb then now() end,
    case when p_diagnostics_consent and v_diag<>'{}'::jsonb then encode(extensions.digest(convert_to(v_diag::text,'UTF8'),'sha256'),'hex') end,
    case when p_diagnostics_consent then v_diag else '{}'::jsonb end) returning id into v_support;
  perform public.minuta_send_message_core_v162(v_conversation,v_participant,'client',v_actor_key,p_request_id,p_message);
  v_response:=jsonb_build_object('support_request_id',v_support,'conversation_id',v_conversation,
    'state','waiting_for_human','diagnostics_attached',p_diagnostics_consent and v_diag<>'{}'::jsonb,
    'created',true,'replayed',false);
  insert into public.message_idempotency_receipts_v162 values(v_actor_key,'open_support',p_request_id,v_hash,v_response,now());
  return v_response;
end
$$;

create or replace function public.list_minuta_support_requests_v162(
  p_state text default null,p_before_activity timestamptz default null,p_before_id uuid default null,p_limit integer default 30
) returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_items jsonb;
begin
  if not exists(select 1 from public.message_support_agents_v162 where user_id=auth.uid() and active)
     or coalesce(p_limit,0) not between 1 and 50 or ((p_before_activity is null)<>(p_before_id is null))
     or (p_state is not null and p_state not in('waiting_for_human','assigned','resolved','closed')) then
    raise exception using errcode='42501',message='support_queue_denied';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('support_request_id',request.id,'conversation_id',request.conversation_id,
    'state',request.state,'organization_id',request.organization_id,'diagnostics_attached',request.diagnostics<>'{}'::jsonb,
    'last_activity_at',conversation.last_activity_at) order by conversation.last_activity_at desc,request.id desc),'[]'::jsonb)
  into v_items from (select request.* from public.message_support_requests_v162 request
    join public.message_conversations_v162 conversation on conversation.id=request.conversation_id
    where (p_state is null or request.state=p_state)
      and (p_before_activity is null or (conversation.last_activity_at,request.id)<(p_before_activity,p_before_id))
      and (request.assigned_support_user_id is null or request.assigned_support_user_id=auth.uid()
        or exists(select 1 from public.message_support_agents_v162 lead where lead.user_id=auth.uid() and lead.support_role='lead' and lead.active))
    order by conversation.last_activity_at desc,request.id desc limit p_limit) request
  join public.message_conversations_v162 conversation on conversation.id=request.conversation_id;
  return jsonb_build_object('items',v_items);
end
$$;

create or replace function public.claim_minuta_support_request_v162(p_support_request uuid,p_request_id uuid)
returns jsonb language plpgsql volatile security definer set search_path to '' as $$
declare v_actor uuid:=auth.uid();v_request public.message_support_requests_v162%rowtype;v_response jsonb;v_hash text;
begin
  if v_actor is null or p_request_id is null or not exists(select 1 from public.message_support_agents_v162 where user_id=v_actor and active) then
    raise exception using errcode='42501',message='support_claim_denied';
  end if;
  v_hash:=encode(extensions.digest(convert_to(p_support_request::text,'UTF8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended('message-request:support:'||v_actor::text||':'||p_request_id::text,16001));
  v_response:=public.minuta_message_receipt_v162('support:'||v_actor::text,'claim_support',p_request_id,v_hash);
  if v_response is not null then return v_response; end if;
  select * into v_request from public.message_support_requests_v162 where id=p_support_request for update;
  if not found or (v_request.assigned_support_user_id is not null and v_request.assigned_support_user_id<>v_actor) then
    raise exception using errcode='P0001',message='support_request_unavailable';
  end if;
  update public.message_support_requests_v162 set assigned_support_user_id=v_actor,state='assigned',updated_at=now()
  where id=p_support_request;
  insert into public.message_participants_v162(conversation_id,participant_kind,user_id,participant_role)
  values(v_request.conversation_id,'support_user',v_actor,'support') on conflict do nothing;
  v_response:=jsonb_build_object('support_request_id',p_support_request,'conversation_id',v_request.conversation_id,
    'state','assigned','replayed',false);
  insert into public.message_idempotency_receipts_v162 values('support:'||v_actor::text,'claim_support',p_request_id,v_hash,v_response,now());
  return v_response;
end
$$;

create or replace function public.send_minuta_support_message_v162(p_conversation uuid,p_request_id uuid,p_body text)
returns jsonb language plpgsql volatile security definer set search_path to '' as $$
declare v_actor uuid:=auth.uid();v_sender uuid;
begin
  if v_actor is null or not public.minuta_message_support_can_access_v162(p_conversation) then
    raise exception using errcode='42501',message='support_conversation_denied';
  end if;
  insert into public.message_participants_v162(conversation_id,participant_kind,user_id,participant_role)
  values(p_conversation,'support_user',v_actor,'support') on conflict do nothing;
  select id into v_sender from public.message_participants_v162 where conversation_id=p_conversation
    and participant_kind='support_user' and user_id=v_actor and active;
  return public.minuta_send_message_core_v162(p_conversation,v_sender,'support','support:'||v_actor::text,p_request_id,p_body);
end
$$;

create or replace function public.get_minuta_support_message_timeline_v162(
  p_conversation uuid,p_after_sequence bigint default null,p_before_sequence bigint default null,p_limit integer default 50
) returns jsonb language plpgsql stable security definer set search_path to '' as $$
begin
  if auth.uid() is null or not public.minuta_message_support_can_access_v162(p_conversation) then
    raise exception using errcode='42501',message='support_conversation_denied';
  end if;
  return public.minuta_message_timeline_core_v162(p_conversation,p_after_sequence,p_before_sequence,p_limit);
end
$$;

do $function_acl$
declare v_function regprocedure;v_expected text[]:=array[
  'apply_minuta_message_action_v162','capture_minuta_message_booking_event_v162','claim_minuta_support_request_v162',
  'get_minuta_client_message_capability_v162','get_minuta_client_message_timeline_v162','get_minuta_message_capability_v162',
  'get_minuta_provider_message_timeline_v162','get_minuta_support_message_timeline_v162','list_minuta_client_conversations_v162',
  'list_minuta_provider_conversations_v162','list_minuta_support_requests_v162','mark_minuta_client_message_read_v162',
  'mark_minuta_provider_message_read_v162','minuta_mark_message_read_core_v162','minuta_message_booking_sha256_v162',
  'minuta_message_client_can_access_v162','minuta_message_client_identity_v162','minuta_message_diagnostics_valid_v162',
  'minuta_message_ensure_booking_participants_v162','minuta_message_next_sequence_v162','minuta_message_provider_can_access_v162',
  'minuta_message_provider_role_v162','minuta_message_receipt_v162','minuta_message_support_can_access_v162',
  'minuta_message_timeline_core_v162','minuta_send_message_core_v162','open_minuta_client_conversation_v162',
  'open_minuta_client_support_v162','open_minuta_provider_conversation_v162','open_minuta_provider_support_v162',
  'prepare_minuta_message_action_v162','propose_minuta_message_action_v162','protect_minuta_message_immutable_v162',
  'send_minuta_client_message_v162','send_minuta_provider_message_v162','send_minuta_support_message_v162',
  'set_minuta_message_center_settings_v162','set_minuta_support_agent_v162'
];
begin
  for v_function in
    select procedure_row.oid::regprocedure from pg_catalog.pg_proc procedure_row
    join pg_catalog.pg_namespace namespace_row on namespace_row.oid=procedure_row.pronamespace
    where namespace_row.nspname='public' and procedure_row.proname=any(v_expected)
  loop
    execute format('alter function %s owner to postgres',v_function);
    execute format('revoke all on function %s from public,anon,authenticated,service_role',v_function);
    execute format('comment on function %s is %L',v_function,'minuta_message_center_v162');
  end loop;
end
$function_acl$;

grant execute on function public.get_minuta_message_capability_v162(uuid) to authenticated;
grant execute on function public.get_minuta_client_message_capability_v162(text,text) to anon,authenticated;
grant execute on function public.set_minuta_message_center_settings_v162(uuid,boolean,boolean) to authenticated;
grant execute on function public.open_minuta_provider_conversation_v162(uuid,uuid,uuid) to authenticated;
grant execute on function public.list_minuta_provider_conversations_v162(uuid,timestamptz,uuid,integer,text) to authenticated;
grant execute on function public.get_minuta_provider_message_timeline_v162(uuid,bigint,bigint,integer) to authenticated;
grant execute on function public.send_minuta_provider_message_v162(uuid,uuid,text) to authenticated;
grant execute on function public.mark_minuta_provider_message_read_v162(uuid,bigint) to authenticated;
grant execute on function public.propose_minuta_message_action_v162(uuid,uuid,uuid,text,jsonb) to authenticated;
grant execute on function public.open_minuta_provider_support_v162(uuid,uuid,text,jsonb,boolean) to authenticated;

grant execute on function public.open_minuta_client_conversation_v162(text,text,uuid) to anon,authenticated;
grant execute on function public.list_minuta_client_conversations_v162(text,timestamptz,uuid,integer,text) to anon,authenticated;
grant execute on function public.get_minuta_client_message_timeline_v162(text,uuid,bigint,bigint,integer) to anon,authenticated;
grant execute on function public.send_minuta_client_message_v162(text,uuid,uuid,text) to anon,authenticated;
grant execute on function public.mark_minuta_client_message_read_v162(text,uuid,bigint) to anon,authenticated;
grant execute on function public.prepare_minuta_message_action_v162(text,uuid,uuid) to anon,authenticated;
grant execute on function public.apply_minuta_message_action_v162(text,uuid,text,uuid) to anon,authenticated;
grant execute on function public.open_minuta_client_support_v162(text,text,uuid,text,jsonb,boolean) to anon,authenticated;

grant execute on function public.list_minuta_support_requests_v162(text,timestamptz,uuid,integer) to authenticated;
grant execute on function public.claim_minuta_support_request_v162(uuid,uuid) to authenticated;
grant execute on function public.send_minuta_support_message_v162(uuid,uuid,text) to authenticated;
grant execute on function public.get_minuta_support_message_timeline_v162(uuid,bigint,bigint,integer) to authenticated;
grant execute on function public.set_minuta_support_agent_v162(uuid,text,boolean) to service_role;

notify pgrst,'reload schema';
commit;
