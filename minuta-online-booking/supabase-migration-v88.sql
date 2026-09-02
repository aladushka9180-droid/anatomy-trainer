begin;

set local search_path = public, extensions, pg_catalog;

-- v88 builds on the durable v46 outbox instead of creating a second queue.
-- Every organization and every channel starts disabled, so applying this
-- migration cannot start an external delivery by itself.
do $$
begin
  if to_regclass('public.notification_outbox') is null
     or to_regclass('public.notification_delivery_attempts') is null
     or to_regclass('public.organizations') is null
     or to_regclass('public.organization_payment_provider_settings') is null
     or to_regprocedure('public.get_minuta_payment_workspace(uuid)') is null
     or to_regprocedure('public.has_organization_role(uuid,text[])') is null then
    raise exception using errcode = 'P0001', message = 'v88_requires_v46_v65_v87';
  end if;
end;
$$;

create table if not exists public.organization_notification_settings (
  organization_id uuid primary key references public.organizations(id) on delete restrict,
  enabled boolean not null default false,
  booking_created_enabled boolean not null default true,
  booking_confirmed_enabled boolean not null default true,
  booking_rescheduled_enabled boolean not null default true,
  booking_cancelled_enabled boolean not null default true,
  booking_reminder_enabled boolean not null default true,
  reminder_minutes_before integer not null default 1440
    check (reminder_minutes_before between 15 and 10080),
  enabled_at timestamptz,
  enabled_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_notification_channels (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  audience text not null check (audience in ('provider', 'client')),
  channel text not null check (channel in ('telegram', 'email', 'sms', 'max', 'push')),
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (organization_id, audience, channel)
);

-- Raw destinations (email, chat id, phone or push subscription) are never
-- granted to a browser role. The UI receives only configured/not-configured
-- flags through get_minuta_notification_workspace().
create table if not exists public.notification_recipient_endpoints (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  audience text not null check (audience in ('provider', 'client')),
  subject_key text not null check (char_length(subject_key) between 1 and 160),
  channel text not null check (channel in ('telegram', 'email', 'sms', 'max', 'push')),
  destination jsonb not null check (
    jsonb_typeof(destination) = 'object'
    and destination <> '{}'::jsonb
    and octet_length(destination::text) <= 8192
  ),
  consent_source text not null check (char_length(consent_source) between 1 and 120),
  consent_at timestamptz not null,
  active boolean not null default true,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, audience, subject_key, channel),
  check ((active and revoked_at is null) or (not active))
);

create index if not exists notification_recipient_endpoints_lookup_idx
  on public.notification_recipient_endpoints (organization_id, audience, subject_key, channel)
  where active;

insert into public.organization_notification_settings (organization_id)
select organization.id from public.organizations organization
on conflict (organization_id) do nothing;

insert into public.organization_notification_channels (organization_id, audience, channel)
select organization.id, scope.audience, scope.channel
from public.organizations organization
cross join (
  values
    ('provider'::text, 'telegram'::text), ('provider', 'email'),
    ('provider', 'sms'), ('provider', 'max'), ('provider', 'push'),
    ('client', 'telegram'), ('client', 'email'),
    ('client', 'sms'), ('client', 'max'), ('client', 'push')
) scope(audience, channel)
on conflict (organization_id, audience, channel) do nothing;

-- Preserve Telegram opt-ins already obtained through an explicit /start.
-- One performer may work in several organizations, so a subscription is
-- copied only into organizations where that phone has an actual booking.
do $$
begin
  if to_regclass('public.client_telegram_subscriptions') is not null then
    insert into public.notification_recipient_endpoints (
      organization_id, audience, subject_key, channel, destination,
      consent_source, consent_at, active, revoked_at, updated_at
    )
    select distinct on (booking.organization_id, subscription.client_phone)
      booking.organization_id,
      'client',
      subscription.client_phone,
      'telegram',
      jsonb_build_object('chat_id', subscription.chat_id),
      'telegram_start',
      subscription.connected_at,
      subscription.active,
      case when subscription.active then null else subscription.updated_at end,
      subscription.updated_at
    from public.client_telegram_subscriptions subscription
    join public.bookings booking
      on booking.performer_id = subscription.performer_id
     and regexp_replace(coalesce(booking.client_phone, ''), '[^0-9]', '', 'g') = subscription.client_phone
    where booking.organization_id is not null
    order by booking.organization_id, subscription.client_phone, subscription.updated_at desc
    on conflict (organization_id, audience, subject_key, channel) do nothing;
  end if;
end;
$$;

alter table public.notification_outbox
  add column if not exists organization_id uuid,
  add column if not exists audience text,
  add column if not exists recipient_key text,
  add column if not exists payload jsonb not null default '{}'::jsonb,
  add column if not exists dispatcher text not null default 'legacy_provider_telegram';

update public.notification_outbox queue
set organization_id = booking.organization_id,
    audience = coalesce(queue.audience, 'provider'),
    recipient_key = coalesce(queue.recipient_key, queue.performer_id::text),
    dispatcher = coalesce(nullif(queue.dispatcher, ''), 'legacy_provider_telegram')
from public.bookings booking
where booking.id = queue.booking_id
  and (queue.organization_id is null or queue.audience is null or queue.recipient_key is null);

do $$
begin
  if exists (
    select 1 from public.notification_outbox
    where organization_id is null or audience is null or recipient_key is null
  ) then
    raise exception using errcode = 'P0001', message = 'v88_outbox_tenant_backfill_failed';
  end if;
end;
$$;

alter table public.notification_outbox
  alter column organization_id set not null,
  alter column audience set not null,
  alter column recipient_key set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.notification_outbox'::regclass
      and conname = 'notification_outbox_organization_id_fkey'
  ) then
    alter table public.notification_outbox
      add constraint notification_outbox_organization_id_fkey
      foreign key (organization_id) references public.organizations(id) on delete restrict;
  end if;
end;
$$;

alter table public.notification_outbox
  drop constraint if exists notification_outbox_kind_check,
  drop constraint if exists notification_outbox_channel_check,
  drop constraint if exists notification_outbox_status_check,
  drop constraint if exists notification_outbox_audience_check,
  drop constraint if exists notification_outbox_recipient_key_check,
  drop constraint if exists notification_outbox_payload_check,
  drop constraint if exists notification_outbox_dispatcher_check;

alter table public.notification_outbox
  add constraint notification_outbox_kind_check check (kind in (
    'booking_created', 'booking_confirmed', 'booking_rescheduled',
    'booking_cancelled', 'booking_reminder'
  )),
  add constraint notification_outbox_channel_check
    check (channel in ('telegram', 'email', 'sms', 'max', 'push')),
  add constraint notification_outbox_status_check
    check (status in ('pending', 'sending', 'sent', 'failed', 'cancelled')),
  add constraint notification_outbox_audience_check
    check (audience in ('provider', 'client')),
  add constraint notification_outbox_recipient_key_check
    check (char_length(recipient_key) between 1 and 160),
  add constraint notification_outbox_payload_check
    check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 16384),
  add constraint notification_outbox_dispatcher_check
    check (dispatcher in ('legacy_provider_telegram', 'unified'));

create index if not exists notification_outbox_organization_created_idx
  on public.notification_outbox (organization_id, created_at desc);
create index if not exists notification_outbox_unified_due_idx
  on public.notification_outbox (channel, next_attempt_at, created_at)
  where status = 'pending' and dispatcher = 'unified';

alter table public.organization_notification_settings enable row level security;
alter table public.organization_notification_channels enable row level security;
alter table public.notification_recipient_endpoints enable row level security;

drop policy if exists organization_notification_settings_member_read on public.organization_notification_settings;
create policy organization_notification_settings_member_read on public.organization_notification_settings
  for select to authenticated
  using (public.has_organization_role(organization_id, array['owner','admin','specialist']));
drop policy if exists organization_notification_settings_manager_write on public.organization_notification_settings;
create policy organization_notification_settings_manager_write on public.organization_notification_settings
  for all to authenticated
  using (public.has_organization_role(organization_id, array['owner','admin']))
  with check (public.has_organization_role(organization_id, array['owner','admin']));

drop policy if exists organization_notification_channels_member_read on public.organization_notification_channels;
create policy organization_notification_channels_member_read on public.organization_notification_channels
  for select to authenticated
  using (public.has_organization_role(organization_id, array['owner','admin','specialist']));
drop policy if exists organization_notification_channels_manager_write on public.organization_notification_channels;
create policy organization_notification_channels_manager_write on public.organization_notification_channels
  for all to authenticated
  using (public.has_organization_role(organization_id, array['owner','admin']))
  with check (public.has_organization_role(organization_id, array['owner','admin']));

drop policy if exists notification_outbox_owner_read on public.notification_outbox;
drop policy if exists notification_outbox_organization_read on public.notification_outbox;
create policy notification_outbox_organization_read on public.notification_outbox
  for select to authenticated using (
    public.has_organization_role(organization_id, array['owner','admin'])
    or (
      performer_id = (select auth.uid())
      and public.has_organization_role(organization_id, array['specialist'])
    )
  );

drop policy if exists notification_delivery_attempts_owner_read on public.notification_delivery_attempts;
drop policy if exists notification_delivery_attempts_organization_read on public.notification_delivery_attempts;
create policy notification_delivery_attempts_organization_read on public.notification_delivery_attempts
  for select to authenticated using (
    exists (
      select 1 from public.notification_outbox queue
      where queue.id = outbox_id
        and (
          public.has_organization_role(queue.organization_id, array['owner','admin'])
          or (
            queue.performer_id = (select auth.uid())
            and public.has_organization_role(queue.organization_id, array['specialist'])
          )
        )
    )
  );

revoke all on public.organization_notification_settings,
  public.organization_notification_channels,
  public.notification_recipient_endpoints from public, anon, authenticated;
grant select, insert, update on public.organization_notification_settings,
  public.organization_notification_channels to authenticated;
grant all on public.organization_notification_settings,
  public.organization_notification_channels,
  public.notification_recipient_endpoints to service_role;

drop trigger if exists organization_notification_settings_touch_updated_at on public.organization_notification_settings;
create trigger organization_notification_settings_touch_updated_at
before update on public.organization_notification_settings
for each row execute function public.touch_minuta_updated_at();
drop trigger if exists organization_notification_channels_touch_updated_at on public.organization_notification_channels;
create trigger organization_notification_channels_touch_updated_at
before update on public.organization_notification_channels
for each row execute function public.touch_minuta_updated_at();
drop trigger if exists notification_recipient_endpoints_touch_updated_at on public.notification_recipient_endpoints;
create trigger notification_recipient_endpoints_touch_updated_at
before update on public.notification_recipient_endpoints
for each row execute function public.touch_minuta_updated_at();

create or replace function public.cancel_disabled_minuta_notification_queue()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if tg_table_name='organization_notification_settings'
     and old.enabled and not new.enabled then
    update public.notification_outbox set status='cancelled',
      last_error_code='notification_center_disabled',
      last_error='Центр уведомлений выключен владельцем организации',
      locked_at=null,lock_token=null
    where organization_id=new.organization_id and dispatcher='unified' and status='pending';
  elsif tg_table_name='organization_notification_channels'
     and old.enabled and not new.enabled then
    update public.notification_outbox set status='cancelled',
      last_error_code='notification_channel_disabled',
      last_error='Канал выключен владельцем организации',
      locked_at=null,lock_token=null
    where organization_id=new.organization_id and audience=new.audience and channel=new.channel
      and dispatcher='unified' and status='pending';
  end if;
  return new;
end;
$$;

drop trigger if exists organization_notification_settings_cancel_queue on public.organization_notification_settings;
create trigger organization_notification_settings_cancel_queue
after update of enabled on public.organization_notification_settings
for each row execute function public.cancel_disabled_minuta_notification_queue();
drop trigger if exists organization_notification_channels_cancel_queue on public.organization_notification_channels;
create trigger organization_notification_channels_cancel_queue
after update of enabled on public.organization_notification_channels
for each row execute function public.cancel_disabled_minuta_notification_queue();

create or replace function public.ensure_minuta_notification_defaults()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  insert into public.organization_notification_settings (organization_id)
  values (new.id) on conflict (organization_id) do nothing;
  insert into public.organization_notification_channels (organization_id, audience, channel)
  select new.id, scope.audience, scope.channel
  from (values
    ('provider'::text, 'telegram'::text), ('provider', 'email'),
    ('provider', 'sms'), ('provider', 'max'), ('provider', 'push'),
    ('client', 'telegram'), ('client', 'email'),
    ('client', 'sms'), ('client', 'max'), ('client', 'push')
  ) scope(audience, channel)
  on conflict (organization_id, audience, channel) do nothing;
  return new;
end;
$$;

drop trigger if exists organizations_notification_defaults on public.organizations;
create trigger organizations_notification_defaults after insert on public.organizations
for each row execute function public.ensure_minuta_notification_defaults();

create or replace function public.minuta_notification_event_enabled(
  p_settings public.organization_notification_settings,
  p_kind text
)
returns boolean language sql immutable set search_path to '' as $$
  select case p_kind
    when 'booking_created' then (p_settings).booking_created_enabled
    when 'booking_confirmed' then (p_settings).booking_confirmed_enabled
    when 'booking_rescheduled' then (p_settings).booking_rescheduled_enabled
    when 'booking_cancelled' then (p_settings).booking_cancelled_enabled
    when 'booking_reminder' then (p_settings).booking_reminder_enabled
    else false
  end
$$;

create or replace function public.enqueue_minuta_booking_notification(
  p_booking uuid,
  p_kind text
)
returns integer language plpgsql security definer set search_path to '' as $$
declare
  v_booking public.bookings%rowtype;
  v_settings public.organization_notification_settings%rowtype;
  v_payload jsonb;
  v_recipient text;
  v_event_key text;
  v_inserted integer := 0;
  v_row record;
begin
  if p_kind not in ('booking_created','booking_confirmed','booking_rescheduled','booking_cancelled','booking_reminder') then
    raise exception using errcode='22023', message='invalid_notification_kind';
  end if;
  select * into v_booking from public.bookings where id=p_booking;
  if not found or regexp_replace(coalesce(v_booking.client_phone,''),'[^0-9]','','g')='0000000000' then return 0; end if;
  select * into v_settings from public.organization_notification_settings
    where organization_id=v_booking.organization_id;
  if not found or not v_settings.enabled
     or not public.minuta_notification_event_enabled(v_settings,p_kind) then return 0; end if;

  select jsonb_build_object(
    'booking_code',v_booking.booking_code,
    'client_name',v_booking.client_name,
    'client_phone',v_booking.client_phone,
    'booking_date',v_booking.booking_date,
    'booking_time',v_booking.booking_time,
    'service_name',service.name,
    'performer_name',profile.display_name
  ) into v_payload
  from public.services service
  join public.performer_profiles profile on profile.id=v_booking.performer_id
  where service.id=v_booking.service_id;

  for v_row in
    select channel.audience, channel.channel
    from public.organization_notification_channels channel
    where channel.organization_id=v_booking.organization_id and channel.enabled
    order by channel.audience, channel.channel
  loop
    v_recipient := case when v_row.audience='provider' then v_booking.performer_id::text
      else regexp_replace(coalesce(v_booking.client_phone,''),'[^0-9]','','g') end;
    if coalesce(v_recipient,'')='' then continue; end if;
    v_event_key := case
      when p_kind='booking_created' and v_row.audience='provider' and v_row.channel='telegram'
        then 'booking:'||v_booking.id::text||':created:telegram'
      when p_kind in ('booking_rescheduled','booking_reminder')
        then 'booking:'||v_booking.id::text||':'||p_kind||':'||v_booking.booking_date::text||':'||v_booking.booking_time::text||':'||v_row.audience||':'||v_row.channel
      else 'booking:'||v_booking.id::text||':'||p_kind||':'||v_row.audience||':'||v_row.channel
    end;
    insert into public.notification_outbox (
      performer_id,booking_id,organization_id,event_key,kind,channel,
      audience,recipient_key,payload,dispatcher
    ) values (
      v_booking.performer_id,v_booking.id,v_booking.organization_id,v_event_key,p_kind,v_row.channel,
      v_row.audience,v_recipient,v_payload,'unified'
    ) on conflict(event_key) do nothing;
    if found then v_inserted := v_inserted+1; end if;
  end loop;
  return v_inserted;
end;
$$;

-- Keep the v46 trigger name, but route future rows through the organization
-- switch. Existing v46 rows remain assigned to the legacy worker.
create or replace function public.enqueue_booking_created_notification()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  perform public.enqueue_minuta_booking_notification(new.id,'booking_created');
  return new;
end;
$$;

create or replace function public.enqueue_minuta_booking_change_notification()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if old.status is distinct from new.status and new.status='cancelled' then
    perform public.enqueue_minuta_booking_notification(new.id,'booking_cancelled');
  elsif old.booking_date is distinct from new.booking_date
     or old.booking_time is distinct from new.booking_time then
    perform public.enqueue_minuta_booking_notification(new.id,'booking_rescheduled');
  elsif old.status is distinct from new.status and new.status='confirmed' then
    perform public.enqueue_minuta_booking_notification(new.id,'booking_confirmed');
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_enqueue_change_notification_v88 on public.bookings;
create trigger bookings_enqueue_change_notification_v88
after update of status, booking_date, booking_time on public.bookings
for each row execute function public.enqueue_minuta_booking_change_notification();

create or replace function public.enqueue_due_minuta_booking_reminders(p_limit integer default 500)
returns integer language plpgsql security definer set search_path to '' as $$
declare v_count integer := 0; v_booking record;
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception using errcode='42501', message='service_role_required';
  end if;
  for v_booking in
    select booking.id
    from public.bookings booking
    join public.organization_notification_settings settings
      on settings.organization_id=booking.organization_id
     and settings.enabled and settings.booking_reminder_enabled
    where booking.status='confirmed'
      and booking.booking_date + booking.booking_time
        between (now() at time zone 'Europe/Samara')
            + make_interval(mins=>settings.reminder_minutes_before-30)
        and (now() at time zone 'Europe/Samara')
            + make_interval(mins=>settings.reminder_minutes_before+30)
    order by booking.booking_date,booking.booking_time,booking.id
    limit greatest(1,least(coalesce(p_limit,500),2000))
  loop
    v_count := v_count + public.enqueue_minuta_booking_notification(v_booking.id,'booking_reminder');
  end loop;
  return v_count;
end;
$$;

-- The legacy worker must never claim v88 client or multi-channel jobs. Without
-- this partition both workers could send the same Telegram event.
create or replace function public.claim_notification_outbox(
  p_performer uuid,
  p_limit integer default 10
)
returns table(
  outbox_id uuid, lock_token uuid, event_key text, performer_id uuid,
  booking_id uuid, kind text, channel text, attempt_no integer,
  booking_code text, client_name text, client_phone text, booking_date date,
  booking_time time without time zone, service_name text, performer_name text
)
language sql security definer set search_path to 'pg_catalog','extensions' as $$
  with picked as (
    select queue.id from public.notification_outbox queue
    where queue.performer_id=p_performer
      and queue.dispatcher='legacy_provider_telegram'
      and queue.audience='provider' and queue.channel='telegram' and queue.kind='booking_created'
      and ((queue.status='pending' and queue.next_attempt_at<=now())
        or (queue.status='sending' and queue.locked_at<now()-interval '15 minutes'))
    order by queue.next_attempt_at,queue.created_at for update skip locked
    limit greatest(1,least(coalesce(p_limit,10),50))
  ), claimed as (
    update public.notification_outbox queue set status='sending',attempts=queue.attempts+1,
      locked_at=now(),lock_token=gen_random_uuid(),last_error_code=null,last_error=null
    from picked where queue.id=picked.id returning queue.*
  ), logged as (
    insert into public.notification_delivery_attempts(outbox_id,performer_id,attempt_no,outcome)
    select claimed.id,claimed.performer_id,claimed.attempts,'sending' from claimed
    on conflict(outbox_id,attempt_no) do nothing returning outbox_id,attempt_no
  )
  select claimed.id,claimed.lock_token,claimed.event_key,claimed.performer_id,
    claimed.booking_id,claimed.kind,claimed.channel,claimed.attempts,
    booking.booking_code,booking.client_name,booking.client_phone,booking.booking_date,
    booking.booking_time,service.name,profile.display_name
  from claimed join logged on logged.outbox_id=claimed.id and logged.attempt_no=claimed.attempts
  join public.bookings booking on booking.id=claimed.booking_id
  join public.services service on service.id=booking.service_id
  join public.performer_profiles profile on profile.id=claimed.performer_id
  order by claimed.created_at
$$;

create or replace function public.claim_minuta_notification_outbox(
  p_channels text[], p_limit integer default 20
)
returns table(
  outbox_id uuid, lock_token uuid, event_key text, organization_id uuid,
  performer_id uuid, booking_id uuid, kind text, channel text, audience text,
  attempt_no integer, destination jsonb, message_payload jsonb
)
language sql security definer set search_path to 'pg_catalog','extensions' as $$
  with picked as (
    select queue.id
    from public.notification_outbox queue
    join public.organization_notification_settings settings
      on settings.organization_id=queue.organization_id and settings.enabled
    join public.organization_notification_channels channel_setting
      on channel_setting.organization_id=queue.organization_id
     and channel_setting.audience=queue.audience
     and channel_setting.channel=queue.channel
     and channel_setting.enabled
    where queue.dispatcher='unified'
      and queue.channel=any(coalesce(p_channels,array[]::text[]))
      and ((queue.status='pending' and queue.next_attempt_at<=now())
        or (queue.status='sending' and queue.locked_at<now()-interval '15 minutes'))
    order by queue.next_attempt_at,queue.created_at
    for update of queue skip locked
    limit greatest(1,least(coalesce(p_limit,20),100))
  ), claimed as (
    update public.notification_outbox queue set status='sending',attempts=queue.attempts+1,
      locked_at=now(),lock_token=gen_random_uuid(),last_error_code=null,last_error=null
    from picked where queue.id=picked.id returning queue.*
  ), logged as (
    insert into public.notification_delivery_attempts(outbox_id,performer_id,attempt_no,outcome)
    select claimed.id,claimed.performer_id,claimed.attempts,'sending' from claimed
    on conflict(outbox_id,attempt_no) do nothing returning outbox_id,attempt_no
  )
  select claimed.id,claimed.lock_token,claimed.event_key,claimed.organization_id,
    claimed.performer_id,claimed.booking_id,claimed.kind,claimed.channel,claimed.audience,
    claimed.attempts,endpoint.destination,claimed.payload
  from claimed
  join logged on logged.outbox_id=claimed.id and logged.attempt_no=claimed.attempts
  left join lateral (
    select recipient.destination
    from public.notification_recipient_endpoints recipient
    where recipient.organization_id=claimed.organization_id
      and recipient.audience=claimed.audience
      and recipient.subject_key=claimed.recipient_key
      and recipient.channel=claimed.channel and recipient.active
    order by recipient.updated_at desc limit 1
  ) endpoint on true
  order by claimed.created_at
$$;

create or replace function public.retry_notification_outbox(p_outbox uuid)
returns text language plpgsql security definer set search_path to '' as $$
begin
  update public.notification_outbox queue set status='pending',next_attempt_at=now(),
    locked_at=null,lock_token=null,last_error_code=null,last_error=null
  where queue.id=p_outbox and queue.status='failed' and (
    public.has_organization_role(queue.organization_id,array['owner','admin'])
    or (queue.performer_id=auth.uid()
      and public.has_organization_role(queue.organization_id,array['specialist']))
  );
  if not found then raise exception using errcode='P0001',message='notification_not_retryable'; end if;
  return 'pending';
end;
$$;

create or replace function public.get_minuta_notification_workspace(p_organization uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_role text;
begin
  select membership.role into v_role from public.organization_memberships membership
  join public.organizations organization on organization.id=membership.organization_id and organization.status='active'
  where membership.organization_id=p_organization and membership.user_id=auth.uid() and membership.active;
  if v_role is null then raise exception using errcode='42501',message='organization_access_denied'; end if;
  return jsonb_build_object(
    'organization_id',p_organization,'current_role',v_role,
    'settings',(select to_jsonb(settings) from public.organization_notification_settings settings where settings.organization_id=p_organization),
    'channels',coalesce((select jsonb_agg(to_jsonb(channel_setting) order by audience,channel)
      from public.organization_notification_channels channel_setting where channel_setting.organization_id=p_organization),'[]'::jsonb),
    'endpoints',coalesce((select jsonb_agg(jsonb_build_object(
      'audience',recipient.audience,'subject_key',recipient.subject_key,'channel',recipient.channel,
      'active',recipient.active,'configured',true,'updated_at',recipient.updated_at
    ) order by recipient.audience,recipient.channel)
      from public.notification_recipient_endpoints recipient
      where recipient.organization_id=p_organization
        and (v_role in ('owner','admin') or (recipient.audience='provider' and recipient.subject_key=auth.uid()::text))),'[]'::jsonb),
    'outbox',coalesce((select jsonb_agg(to_jsonb(item) order by item.created_at desc)
      from (select queue.id,queue.performer_id,queue.booking_id,queue.event_key,queue.kind,
        queue.channel,queue.audience,queue.status,queue.attempts,queue.next_attempt_at,
        queue.last_error_code,queue.last_error,queue.provider_message_id,queue.sent_at,
        queue.created_at,queue.updated_at
        from public.notification_outbox queue where queue.organization_id=p_organization
          and (v_role in ('owner','admin') or queue.performer_id=auth.uid())
        order by queue.created_at desc limit 100) item),'[]'::jsonb)
  );
end;
$$;

create or replace function public.set_minuta_notification_master(p_organization uuid,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path to '' as $$
begin
  if not public.has_organization_role(p_organization,array['owner','admin']) then
    raise exception using errcode='42501',message='organization_manager_required';
  end if;
  insert into public.organization_notification_settings(organization_id,enabled,enabled_at,enabled_by)
  values(p_organization,coalesce(p_enabled,false),case when p_enabled then now() end,case when p_enabled then auth.uid() end)
  on conflict(organization_id) do update set enabled=excluded.enabled,
    enabled_at=case when excluded.enabled then coalesce(public.organization_notification_settings.enabled_at,now()) end,
    enabled_by=case when excluded.enabled then auth.uid() end;
  if not coalesce(p_enabled,false) then
    update public.notification_outbox set status='cancelled',last_error_code='notification_center_disabled',
      last_error='Канал выключен владельцем организации',locked_at=null,lock_token=null
    where organization_id=p_organization and dispatcher='unified' and status='pending';
  end if;
  return public.get_minuta_notification_workspace(p_organization);
end;
$$;

create or replace function public.set_minuta_notification_channel(
  p_organization uuid,p_audience text,p_channel text,p_enabled boolean
)
returns jsonb language plpgsql security definer set search_path to '' as $$
begin
  if not public.has_organization_role(p_organization,array['owner','admin']) then
    raise exception using errcode='42501',message='organization_manager_required';
  end if;
  if p_audience not in ('provider','client') or p_channel not in ('telegram','email','sms','max','push') then
    raise exception using errcode='22023',message='invalid_notification_channel';
  end if;
  insert into public.organization_notification_channels(organization_id,audience,channel,enabled)
  values(p_organization,p_audience,p_channel,coalesce(p_enabled,false))
  on conflict(organization_id,audience,channel) do update set enabled=excluded.enabled;
  if not coalesce(p_enabled,false) then
    update public.notification_outbox set status='cancelled',last_error_code='notification_channel_disabled',
      last_error='Канал выключен владельцем организации',locked_at=null,lock_token=null
    where organization_id=p_organization and audience=p_audience and channel=p_channel
      and dispatcher='unified' and status='pending';
  end if;
  return public.get_minuta_notification_workspace(p_organization);
end;
$$;

create or replace function public.upsert_minuta_notification_endpoint(
  p_organization uuid,p_audience text,p_subject_key text,p_channel text,
  p_destination jsonb,p_consent_source text,p_active boolean default true
)
returns uuid language plpgsql security definer set search_path to '' as $$
declare v_id uuid;
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception using errcode='42501',message='service_role_required';
  end if;
  if p_audience not in ('provider','client') or p_channel not in ('telegram','email','sms','max','push')
     or nullif(trim(p_subject_key),'') is null or jsonb_typeof(p_destination)<>'object'
     or p_destination='{}'::jsonb or nullif(trim(p_consent_source),'') is null then
    raise exception using errcode='22023',message='invalid_notification_endpoint';
  end if;
  insert into public.notification_recipient_endpoints(
    organization_id,audience,subject_key,channel,destination,consent_source,consent_at,active,revoked_at
  ) values(
    p_organization,p_audience,left(trim(p_subject_key),160),p_channel,p_destination,
    left(trim(p_consent_source),120),now(),coalesce(p_active,true),case when coalesce(p_active,true) then null else now() end
  ) on conflict(organization_id,audience,subject_key,channel) do update set
    destination=excluded.destination,consent_source=excluded.consent_source,consent_at=excluded.consent_at,
    active=excluded.active,revoked_at=excluded.revoked_at
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.ensure_minuta_notification_defaults() from public,anon,authenticated,service_role;
revoke all on function public.cancel_disabled_minuta_notification_queue() from public,anon,authenticated,service_role;
revoke all on function public.minuta_notification_event_enabled(public.organization_notification_settings,text) from public,anon,authenticated,service_role;
revoke all on function public.enqueue_minuta_booking_notification(uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.enqueue_minuta_booking_change_notification() from public,anon,authenticated,service_role;
revoke all on function public.enqueue_due_minuta_booking_reminders(integer) from public,anon,authenticated,service_role;
revoke all on function public.claim_notification_outbox(uuid,integer) from public,anon,authenticated,service_role;
revoke all on function public.claim_minuta_notification_outbox(text[],integer) from public,anon,authenticated,service_role;
revoke all on function public.retry_notification_outbox(uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_minuta_notification_workspace(uuid) from public,anon,authenticated,service_role;
revoke all on function public.set_minuta_notification_master(uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function public.set_minuta_notification_channel(uuid,text,text,boolean) from public,anon,authenticated,service_role;
revoke all on function public.upsert_minuta_notification_endpoint(uuid,text,text,text,jsonb,text,boolean) from public,anon,authenticated,service_role;

grant execute on function public.enqueue_due_minuta_booking_reminders(integer) to service_role;
grant execute on function public.claim_notification_outbox(uuid,integer) to service_role;
grant execute on function public.claim_minuta_notification_outbox(text[],integer) to service_role;
grant execute on function public.retry_notification_outbox(uuid) to authenticated;
grant execute on function public.get_minuta_notification_workspace(uuid) to authenticated;
grant execute on function public.set_minuta_notification_master(uuid,boolean) to authenticated;
grant execute on function public.set_minuta_notification_channel(uuid,text,text,boolean) to authenticated;
grant execute on function public.upsert_minuta_notification_endpoint(uuid,text,text,text,jsonb,text,boolean) to service_role;

commit;
