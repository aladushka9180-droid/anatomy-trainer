begin;

set local search_path = public, extensions, pg_catalog;

-- This is a compatibility rollback, not a destructive down migration. Keep
-- all outbox rows, delivery evidence, endpoints and additive v114 columns.
do $$
begin
  if to_regclass('public.notification_outbox') is null
     or to_regprocedure('public.ack_minuta_notification_outbox_v114(uuid,uuid,text,text,timestamptz,text)') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema='public' and table_name='notification_outbox' and column_name='delivered_at'
     ) then
    raise exception using errcode='P0001',message='v114_rollback_requires_applied_v114';
  end if;
end $$;

-- Never restore the retired direct /reminders route. The unified dispatcher
-- remains the only scheduler, and rollback aborts unless its active one-minute
-- cron is present. No notification is sent by this migration.
do $$
declare v_replacement_count integer:=0; v_legacy_count integer:=0;
  v_cutover_count integer:=0; v_uncutover_legacy_organizations integer:=0;
begin
  if to_regclass('cron.job') is not null then
    select count(*) into v_replacement_count
    from cron.job
    where jobname='minuta-notification-dispatcher'
      and active
      and schedule='* * * * *'
      and command ilike '%/functions/v1/notification-dispatcher%';
    select count(*) into v_legacy_count from cron.job
    where jobname='telegram-client-reminders-hourly' and active;
    select count(*) into v_cutover_count from public.notification_v114_organization_cutovers;
    select count(distinct booking.organization_id) into v_uncutover_legacy_organizations
    from public.client_telegram_subscriptions subscription
    join public.bookings booking on booking.performer_id=subscription.performer_id
      and regexp_replace(coalesce(booking.client_phone,''),'[^0-9]','','g')=subscription.client_phone
    left join public.notification_v114_organization_cutovers cutover
      on cutover.organization_id=booking.organization_id
    where subscription.active and booking.organization_id is not null
      and cutover.organization_id is null;
    if v_cutover_count>0 and v_replacement_count<>1 then
      raise exception using errcode='P0001',message='v114_rollback_requires_active_notification_dispatcher_cron';
    end if;
    if v_uncutover_legacy_organizations>0 and v_legacy_count<>1 then
      raise exception using errcode='P0001',message='v114_rollback_requires_active_legacy_cron';
    end if;
  end if;
end $$;

-- Stop only the v114 subscription mirror. Existing endpoint and subscription
-- rows are intentionally preserved for a later reapply.
do $$
begin
  if to_regclass('public.client_telegram_subscriptions') is not null then
    drop trigger if exists client_telegram_subscription_sync_v114
      on public.client_telegram_subscriptions;
  end if;
end $$;

drop function if exists public.sync_minuta_client_telegram_subscription_v114();

-- Keep the RPC signature for deployed v114 workers, but freeze new routing
-- changes until v114 is reapplied.
create or replace function public.activate_minuta_notification_v114_cutover(
  p_organization uuid,p_worker_version text,p_configured_channels text[]
)
returns jsonb language plpgsql security definer set search_path to '' as $$
begin
  raise exception using errcode='P0001',message='v114_cutover_paused_by_rollback';
end
$$;

-- Restore the v88 change-trigger contract used by the previous application.
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
end
$$;

-- Restore the v88 claim RPC body and its unchanged public signature. The v114
-- ack/state RPCs stay installed as compatibility shims for in-flight workers.
create or replace function public.claim_minuta_notification_outbox(
  p_channels text[],p_limit integer default 20
)
returns table(
  outbox_id uuid,lock_token uuid,event_key text,organization_id uuid,
  performer_id uuid,booking_id uuid,kind text,channel text,audience text,
  attempt_no integer,destination jsonb,message_payload jsonb
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
     and channel_setting.channel=queue.channel and channel_setting.enabled
    where queue.dispatcher='unified'
      and queue.channel=any(coalesce(p_channels,array[]::text[]))
      and (queue.audience<>'client' or queue.channel<>'telegram' or exists(
        select 1 from public.notification_v114_organization_cutovers cutover
        where cutover.organization_id=queue.organization_id
      ))
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
end
$$;

revoke all on function public.claim_minuta_notification_outbox(text[],integer) from public,anon,authenticated,service_role;
revoke all on function public.get_minuta_notification_workspace(uuid) from public,anon,authenticated,service_role;
grant execute on function public.claim_minuta_notification_outbox(text[],integer) to service_role;
grant execute on function public.get_minuta_notification_workspace(uuid) to authenticated;
revoke all on function public.activate_minuta_notification_v114_cutover(uuid,text,text[]) from public,anon,authenticated,service_role;
grant execute on function public.activate_minuta_notification_v114_cutover(uuid,text,text[]) to service_role;

comment on function public.ack_minuta_notification_outbox_v114(uuid,uuid,text,text,timestamptz,text) is
  'Compatibility shim retained by v114 rollback so an in-flight v114 dispatcher can finish safely.';

commit;
