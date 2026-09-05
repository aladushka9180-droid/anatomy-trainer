begin;

set local search_path = public, extensions, pg_catalog;

-- v114 hardens the unified v88 queue. Applying it never enables a channel and
-- never sends a message: delivery remains owned by notification-dispatcher.
do $$
begin
  if to_regclass('public.notification_outbox') is null
     or to_regclass('public.organization_notification_settings') is null
     or to_regclass('public.organization_notification_channels') is null
     or to_regclass('public.notification_recipient_endpoints') is null
     or to_regprocedure('public.enqueue_minuta_booking_notification(uuid,text)') is null
     or to_regprocedure('public.claim_minuta_notification_outbox(text[],integer)') is null
     or to_regprocedure('public.get_minuta_notification_workspace(uuid)') is null then
    raise exception using errcode='P0001', message='v114_requires_complete_v88_notification_center';
  end if;
end $$;

-- Direct client sends used a separate idempotency log before v114. Reconcile
-- still-open unified rows so rollout cannot repeat an already accepted message.
do $$
begin
  if to_regclass('public.telegram_notification_log') is not null then
    insert into public.notification_delivery_attempts(
      outbox_id,performer_id,attempt_no,outcome,started_at,finished_at
    )
    select queue.id,queue.performer_id,queue.attempts+1,'sent',legacy.sent_at,legacy.sent_at
    from public.notification_outbox queue
    join public.telegram_notification_log legacy on legacy.booking_id=queue.booking_id
    where queue.dispatcher='unified' and queue.audience='client' and queue.channel='telegram'
      and queue.status in ('pending','failed')
      and coalesce(queue.payload->>'booking_date','')=legacy.booking_date::text
      and left(coalesce(queue.payload->>'booking_time',''),8)=left(legacy.booking_time::text,8)
      and (
        (legacy.event_type='confirmation' and queue.kind in ('booking_created','booking_confirmed'))
        or (legacy.event_type='rescheduled' and queue.kind='booking_rescheduled')
        or (legacy.event_type='cancelled' and queue.kind='booking_cancelled')
        or (legacy.event_type='reminder' and queue.kind='booking_reminder')
      )
    on conflict(outbox_id,attempt_no) do nothing;

    update public.notification_outbox queue
    set status='sent',attempts=queue.attempts+1,sent_at=coalesce(queue.sent_at,legacy.sent_at),
      locked_at=null,lock_token=null,last_error_code=null,last_error=null,updated_at=now()
    from public.telegram_notification_log legacy
    where queue.booking_id=legacy.booking_id and queue.dispatcher='unified'
      and queue.audience='client' and queue.channel='telegram'
      and queue.status in ('pending','failed')
      and coalesce(queue.payload->>'booking_date','')=legacy.booking_date::text
      and left(coalesce(queue.payload->>'booking_time',''),8)=left(legacy.booking_time::text,8)
      and (
        (legacy.event_type='confirmation' and queue.kind in ('booking_created','booking_confirmed'))
        or (legacy.event_type='rescheduled' and queue.kind='booking_rescheduled')
        or (legacy.event_type='cancelled' and queue.kind='booking_cancelled')
        or (legacy.event_type='reminder' and queue.kind='booking_reminder')
      );
  end if;
end $$;

alter table public.notification_outbox
  add column if not exists delivered_at timestamptz,
  add column if not exists delivery_receipt_at timestamptz,
  add column if not exists delivery_receipt_source text;

alter table public.notification_delivery_attempts
  add column if not exists delivered_at timestamptz,
  add column if not exists delivery_receipt_source text;

alter table public.notification_outbox
  drop constraint if exists notification_outbox_delivery_receipt_source_check,
  add constraint notification_outbox_delivery_receipt_source_check
    check (delivery_receipt_source is null or char_length(delivery_receipt_source) between 1 and 120),
  drop constraint if exists notification_outbox_delivery_evidence_check,
  add constraint notification_outbox_delivery_evidence_check check (
    delivered_at is null
    or (status='sent' and provider_message_id is not null and delivery_receipt_at is not null
      and delivery_receipt_source is not null)
  );

alter table public.notification_delivery_attempts
  drop constraint if exists notification_attempt_delivery_receipt_source_check,
  add constraint notification_attempt_delivery_receipt_source_check
    check (delivery_receipt_source is null or char_length(delivery_receipt_source) between 1 and 120);

create index if not exists notification_outbox_delivery_receipt_idx
  on public.notification_outbox(channel,provider_message_id)
  where status='sent' and provider_message_id is not null;

-- Telegram opt-in is proven only after Telegram calls the secret-protected
-- webhook with /start. Mirror that consent into the unified endpoint table.
create or replace function public.sync_minuta_client_telegram_subscription_v114()
returns trigger language plpgsql security definer set search_path to '' as $$
declare v_phone text;
begin
  v_phone := regexp_replace(coalesce(new.client_phone,''),'[^0-9]','','g');
  if tg_op='UPDATE' and (
    old.client_phone is distinct from new.client_phone
    or old.performer_id is distinct from new.performer_id
  ) then
    update public.notification_recipient_endpoints endpoint
    set active=false,revoked_at=coalesce(endpoint.revoked_at,now()),updated_at=now()
    where endpoint.audience='client' and endpoint.channel='telegram'
      and endpoint.subject_key=regexp_replace(coalesce(old.client_phone,''),'[^0-9]','','g')
      and exists (
        select 1 from public.bookings booking
        where booking.organization_id=endpoint.organization_id
          and booking.performer_id=old.performer_id
      );
  end if;

  if v_phone='' then return new; end if;
  if new.active then
    insert into public.notification_recipient_endpoints(
      organization_id,audience,subject_key,channel,destination,
      consent_source,consent_at,active,revoked_at,updated_at
    )
    select distinct booking.organization_id,'client',v_phone,'telegram',
      jsonb_build_object('chat_id',new.chat_id),'telegram_start',
      coalesce(new.connected_at,now()),true,null::timestamptz,now()
    from public.bookings booking
    where booking.performer_id=new.performer_id
      and booking.organization_id is not null
      and regexp_replace(coalesce(booking.client_phone,''),'[^0-9]','','g')=v_phone
    on conflict(organization_id,audience,subject_key,channel) do update set
      destination=excluded.destination,consent_source='telegram_start',
      consent_at=excluded.consent_at,active=true,revoked_at=null,updated_at=now();
  else
    update public.notification_recipient_endpoints endpoint
    set active=false,revoked_at=coalesce(endpoint.revoked_at,now()),updated_at=now()
    where endpoint.audience='client' and endpoint.channel='telegram'
      and endpoint.subject_key=v_phone
      and exists (
        select 1 from public.bookings booking
        where booking.organization_id=endpoint.organization_id
          and booking.performer_id=new.performer_id
      );
  end if;
  return new;
end
$$;

do $$
begin
  if to_regclass('public.client_telegram_subscriptions') is not null then
    drop trigger if exists client_telegram_subscription_sync_v114 on public.client_telegram_subscriptions;
    create trigger client_telegram_subscription_sync_v114
    after insert or update of performer_id,client_phone,chat_id,active
    on public.client_telegram_subscriptions
    for each row execute function public.sync_minuta_client_telegram_subscription_v114();

    -- Cover subscriptions created after v88 and before v114.
    insert into public.notification_recipient_endpoints(
      organization_id,audience,subject_key,channel,destination,
      consent_source,consent_at,active,revoked_at,updated_at
    )
    select distinct on (booking.organization_id,subscription.client_phone)
      booking.organization_id,'client',subscription.client_phone,'telegram',
      jsonb_build_object('chat_id',subscription.chat_id),'telegram_start',
      subscription.connected_at,subscription.active,
      case when subscription.active then null::timestamptz else subscription.updated_at end,
      subscription.updated_at
    from public.client_telegram_subscriptions subscription
    join public.bookings booking on booking.performer_id=subscription.performer_id
      and regexp_replace(coalesce(booking.client_phone,''),'[^0-9]','','g')=subscription.client_phone
    where booking.organization_id is not null
    order by booking.organization_id,subscription.client_phone,subscription.updated_at desc
    on conflict(organization_id,audience,subject_key,channel) do update set
      destination=excluded.destination,consent_source='telegram_start',
      consent_at=excluded.consent_at,active=excluded.active,
      revoked_at=excluded.revoked_at,updated_at=excluded.updated_at;
  end if;
end $$;

-- Superseded events must not survive a reschedule/cancellation. Only pending
-- rows are changed; a worker holding a lease remains the source of truth.
create or replace function public.enqueue_minuta_booking_change_notification()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if old.status is distinct from new.status and new.status='cancelled' then
    update public.notification_outbox queue
    set status='cancelled',last_error_code='booking_cancelled_before_send',
      last_error='Событие устарело: запись уже отменена',updated_at=now()
    where queue.booking_id=new.id and queue.dispatcher='unified'
      and queue.status='pending' and queue.kind<>'booking_cancelled';
    perform public.enqueue_minuta_booking_notification(new.id,'booking_cancelled');
  elsif old.booking_date is distinct from new.booking_date
     or old.booking_time is distinct from new.booking_time then
    update public.notification_outbox queue
    set status='cancelled',last_error_code='booking_time_superseded',
      last_error='Событие устарело после переноса записи',updated_at=now()
    where queue.booking_id=new.id and queue.dispatcher='unified'
      and queue.status='pending' and (
        queue.kind in ('booking_rescheduled','booking_reminder','booking_confirmed')
        or (queue.kind='booking_created' and queue.audience='client')
      );
    perform public.enqueue_minuta_booking_notification(new.id,'booking_rescheduled');
  elsif old.status is distinct from new.status and new.status='confirmed' then
    update public.notification_outbox queue
    set status='cancelled',last_error_code='booking_state_superseded',
      last_error='Событие устарело: запись уже подтверждена',updated_at=now()
    where queue.booking_id=new.id and queue.dispatcher='unified'
      and queue.status='pending' and queue.audience='client'
      and queue.kind in ('booking_created','booking_rescheduled');
    perform public.enqueue_minuta_booking_notification(new.id,'booking_confirmed');
  end if;
  return new;
end
$$;

-- Do not consume attempts for clients who have not connected a channel. Before
-- each claim, cancel rows whose booking state or date no longer matches.
create or replace function public.claim_minuta_notification_outbox(
  p_channels text[],p_limit integer default 20
)
returns table(
  outbox_id uuid,lock_token uuid,event_key text,organization_id uuid,
  performer_id uuid,booking_id uuid,kind text,channel text,audience text,
  attempt_no integer,destination jsonb,message_payload jsonb
)
language plpgsql security definer set search_path to 'pg_catalog','extensions' as $$
begin
  update public.notification_outbox queue
  set status='cancelled',locked_at=null,lock_token=null,
    last_error_code='notification_event_stale',
    last_error='Событие больше не соответствует текущей записи',updated_at=now()
  from public.bookings booking
  where queue.booking_id=booking.id and queue.dispatcher='unified'
    and queue.status='pending' and (
      (booking.status='cancelled' and queue.kind<>'booking_cancelled')
      or (queue.audience='client' and queue.kind in ('booking_created','booking_confirmed','booking_rescheduled','booking_reminder')
        and booking.booking_date+booking.booking_time<=now() at time zone 'Europe/Samara')
      or (queue.kind='booking_confirmed' and booking.status<>'confirmed')
      or (queue.kind='booking_reminder' and (
        booking.status<>'confirmed'
        or coalesce(queue.payload->>'booking_date','')<>booking.booking_date::text
        or left(coalesce(queue.payload->>'booking_time',''),8)<>left(booking.booking_time::text,8)
        or booking.booking_date+booking.booking_time<=now() at time zone 'Europe/Samara'
      ))
      or (queue.kind='booking_rescheduled' and (
        coalesce(queue.payload->>'booking_date','')<>booking.booking_date::text
        or left(coalesce(queue.payload->>'booking_time',''),8)<>left(booking.booking_time::text,8)
      ))
    );

  return query
  with picked as (
    select queue.id
    from public.notification_outbox queue
    join public.organization_notification_settings settings
      on settings.organization_id=queue.organization_id and settings.enabled
    join public.organization_notification_channels channel_setting
      on channel_setting.organization_id=queue.organization_id
     and channel_setting.audience=queue.audience
     and channel_setting.channel=queue.channel and channel_setting.enabled
    left join lateral (
      select recipient.destination
      from public.notification_recipient_endpoints recipient
      where recipient.organization_id=queue.organization_id
        and recipient.audience=queue.audience
        and recipient.subject_key=queue.recipient_key
        and recipient.channel=queue.channel and recipient.active
      order by recipient.updated_at desc limit 1
    ) endpoint on true
    where queue.dispatcher='unified'
      and queue.channel=any(coalesce(p_channels,array[]::text[]))
      and (queue.audience='provider' or endpoint.destination is not null)
      and ((queue.status='pending' and queue.next_attempt_at<=now())
        or (queue.status='sending' and queue.locked_at<now()-interval '15 minutes'))
    order by queue.next_attempt_at,queue.created_at
    for update of queue skip locked
    limit greatest(1,least(coalesce(p_limit,20),100))
  ),claimed as (
    update public.notification_outbox queue set status='sending',attempts=queue.attempts+1,
      locked_at=now(),lock_token=gen_random_uuid(),last_error_code=null,last_error=null
    from picked where queue.id=picked.id returning queue.*
  ),logged as (
    insert into public.notification_delivery_attempts as attempt(outbox_id,performer_id,attempt_no,outcome)
    select claimed.id,claimed.performer_id,claimed.attempts,'sending' from claimed
    on conflict on constraint notification_delivery_attempts_outbox_id_attempt_no_key do nothing
    returning attempt.outbox_id,attempt.attempt_no
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
  order by claimed.created_at;
end
$$;

-- "sent" means accepted by the channel. "delivered" is derived only from an
-- explicit synchronous provider receipt or a later channel callback.
create or replace function public.ack_minuta_notification_outbox_v114(
  p_outbox uuid,p_lock_token uuid,p_provider_message_id text default null,
  p_delivery_state text default 'sent',p_delivered_at timestamptz default null,
  p_receipt_source text default null
)
returns text language plpgsql security definer set search_path to '' as $$
declare
  v_performer uuid; v_attempt integer; v_message_id text;
  v_delivered_at timestamptz; v_receipt_source text;
begin
  if p_delivery_state not in ('sent','delivered') then
    raise exception using errcode='22023',message='invalid_delivery_state';
  end if;
  v_message_id:=nullif(left(trim(coalesce(p_provider_message_id,'')),240),'');
  if p_delivery_state='delivered' then
    if v_message_id is null or p_delivered_at is null or nullif(trim(coalesce(p_receipt_source,'')),'') is null then
      raise exception using errcode='22023',message='delivery_receipt_required';
    end if;
    v_delivered_at:=p_delivered_at;
    v_receipt_source:=left(trim(p_receipt_source),120);
  end if;

  update public.notification_outbox queue set status='sent',provider_message_id=v_message_id,
    sent_at=now(),delivered_at=v_delivered_at,delivery_receipt_at=case when v_delivered_at is null then null else now() end,
    delivery_receipt_source=v_receipt_source,locked_at=null,lock_token=null,last_error_code=null,last_error=null
  where queue.id=p_outbox and queue.status='sending' and queue.lock_token=p_lock_token
  returning queue.performer_id,queue.attempts into v_performer,v_attempt;
  if not found then raise exception using errcode='P0001',message='notification_lease_lost'; end if;

  update public.notification_delivery_attempts attempt set outcome='sent',provider_message_id=v_message_id,
    delivered_at=v_delivered_at,delivery_receipt_source=v_receipt_source,finished_at=now()
  where attempt.outbox_id=p_outbox and attempt.performer_id=v_performer and attempt.attempt_no=v_attempt;
  return case when v_delivered_at is null then 'sent' else 'delivered' end;
end
$$;

create or replace function public.confirm_minuta_notification_delivery_v114(
  p_channel text,p_provider_message_id text,p_delivered_at timestamptz,p_receipt_source text
)
returns text language plpgsql security definer set search_path to '' as $$
declare v_outbox uuid; v_source text;
begin
  if p_channel not in ('telegram','email','sms','max','push')
     or nullif(trim(coalesce(p_provider_message_id,'')),'') is null
     or p_delivered_at is null
     or nullif(trim(coalesce(p_receipt_source,'')),'') is null then
    raise exception using errcode='22023',message='invalid_delivery_receipt';
  end if;
  v_source:=left(trim(p_receipt_source),120);
  select queue.id into v_outbox from public.notification_outbox queue
  where queue.channel=p_channel and queue.provider_message_id=left(trim(p_provider_message_id),240)
    and queue.status='sent'
  order by queue.sent_at desc limit 1 for update;
  if not found then return 'not_found'; end if;
  update public.notification_outbox set delivered_at=coalesce(delivered_at,p_delivered_at),
    delivery_receipt_at=now(),delivery_receipt_source=v_source,updated_at=now()
  where id=v_outbox;
  update public.notification_delivery_attempts set delivered_at=coalesce(delivered_at,p_delivered_at),
    delivery_receipt_source=v_source
  where outbox_id=v_outbox and outcome='sent';
  return 'delivered';
end
$$;

create or replace function public.deactivate_minuta_notification_endpoint_v114(
  p_outbox uuid,p_reason text
)
returns text language plpgsql security definer set search_path to '' as $$
declare v_job record;
begin
  select queue.organization_id,queue.audience,queue.recipient_key,queue.channel into v_job
  from public.notification_outbox queue where queue.id=p_outbox;
  if not found then return 'not_found'; end if;
  update public.notification_recipient_endpoints endpoint
  set active=false,revoked_at=coalesce(endpoint.revoked_at,now()),updated_at=now()
  where endpoint.organization_id=v_job.organization_id
    and endpoint.audience=v_job.audience and endpoint.subject_key=v_job.recipient_key
    and endpoint.channel=v_job.channel and endpoint.active;
  return case when found then 'deactivated' else 'not_found' end;
end
$$;

create or replace function public.get_minuta_client_notification_state_v114(p_booking uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_booking public.bookings%rowtype; v_connected boolean; v_enabled boolean; v_channel boolean; v_job record;
begin
  if coalesce(auth.role(),'')<>'service_role' then
    raise exception using errcode='42501',message='service_role_required';
  end if;
  select * into v_booking from public.bookings where id=p_booking;
  if not found then return jsonb_build_object('state','not_found','connected',false); end if;
  select exists(select 1 from public.notification_recipient_endpoints endpoint
    where endpoint.organization_id=v_booking.organization_id and endpoint.audience='client'
      and endpoint.subject_key=regexp_replace(coalesce(v_booking.client_phone,''),'[^0-9]','','g')
      and endpoint.channel='telegram' and endpoint.active),
    coalesce((select settings.enabled from public.organization_notification_settings settings
      where settings.organization_id=v_booking.organization_id),false),
    coalesce((select channel.enabled from public.organization_notification_channels channel
      where channel.organization_id=v_booking.organization_id and channel.audience='client' and channel.channel='telegram'),false)
  into v_connected,v_enabled,v_channel;
  select queue.status,queue.delivered_at,queue.last_error_code into v_job
  from public.notification_outbox queue where queue.booking_id=p_booking
    and queue.audience='client' and queue.channel='telegram' and queue.dispatcher='unified'
  order by queue.created_at desc limit 1;
  return jsonb_build_object(
    'connected',v_connected,'center_enabled',v_enabled,'channel_enabled',v_channel,
    'state',case
      when not v_connected then 'not_connected'
      when not v_enabled or not v_channel then 'connected_disabled'
      when v_job.delivered_at is not null then 'delivered'
      when v_job.status='sent' then 'sent'
      when v_job.status='sending' then 'sending'
      when v_job.status='pending' then 'queued'
      when v_job.status='failed' then 'failed'
      else 'connected'
    end,
    'outbox_status',v_job.status,'last_error_code',v_job.last_error_code
  );
end
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
        queue.delivered_at,queue.delivery_receipt_at,queue.delivery_receipt_source,
        jsonb_build_object('client_name',queue.payload->>'client_name','service_name',queue.payload->>'service_name',
          'booking_date',queue.payload->>'booking_date','booking_time',queue.payload->>'booking_time') as context,
        queue.created_at,queue.updated_at
        from public.notification_outbox queue where queue.organization_id=p_organization
          and (v_role in ('owner','admin') or queue.performer_id=auth.uid())
        order by queue.created_at desc limit 100) item),'[]'::jsonb)
  );
end
$$;

-- The legacy public hourly endpoint bypassed the durable dispatcher. Remove its
-- cron job; notification-dispatcher queues reminders with an authenticated worker.
do $$
declare v_job bigint;
begin
  if to_regclass('cron.job') is not null then
    select jobid into v_job from cron.job where jobname='telegram-client-reminders-hourly';
    if v_job is not null then perform cron.unschedule(v_job); end if;
  end if;
end $$;

revoke all on function public.sync_minuta_client_telegram_subscription_v114() from public,anon,authenticated,service_role;
revoke all on function public.ack_minuta_notification_outbox_v114(uuid,uuid,text,text,timestamptz,text) from public,anon,authenticated,service_role;
revoke all on function public.confirm_minuta_notification_delivery_v114(text,text,timestamptz,text) from public,anon,authenticated,service_role;
revoke all on function public.deactivate_minuta_notification_endpoint_v114(uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.get_minuta_client_notification_state_v114(uuid) from public,anon,authenticated,service_role;
revoke all on function public.claim_minuta_notification_outbox(text[],integer) from public,anon,authenticated,service_role;
revoke all on function public.get_minuta_notification_workspace(uuid) from public,anon,authenticated,service_role;

grant execute on function public.ack_minuta_notification_outbox_v114(uuid,uuid,text,text,timestamptz,text) to service_role;
grant execute on function public.confirm_minuta_notification_delivery_v114(text,text,timestamptz,text) to service_role;
grant execute on function public.deactivate_minuta_notification_endpoint_v114(uuid,text) to service_role;
grant execute on function public.get_minuta_client_notification_state_v114(uuid) to service_role;
grant execute on function public.claim_minuta_notification_outbox(text[],integer) to service_role;
grant execute on function public.get_minuta_notification_workspace(uuid) to authenticated;

commit;
