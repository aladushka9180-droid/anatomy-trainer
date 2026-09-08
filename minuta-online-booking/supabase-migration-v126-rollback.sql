\set ON_ERROR_STOP on

begin;
set local lock_timeout='5s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $guard$
begin
  if to_regclass('public.organization_notification_fallbacks') is null
     or to_regprocedure('public.enqueue_due_minuta_booking_confirmation_requests_v126(integer)') is null then
    raise exception using errcode='55000',message='v126_rollback_requires_v126';
  end if;
  if exists(select 1 from public.organization_notification_settings
      where booking_confirmation_request_enabled or quiet_hours_enabled)
     or exists(select 1 from public.organization_notification_fallbacks)
     or exists(select 1 from public.notification_outbox
      where kind='booking_confirmation_request' or fallback_of is not null or fallback_depth<>0) then
    raise exception using errcode='55000',message='v126_rollback_blocked_by_active_notification_policy_or_history';
  end if;
end
$guard$;

drop trigger if exists organization_notification_settings_validate_quiet_v126
  on public.organization_notification_settings;

create or replace function public.minuta_notification_event_enabled(
  p_settings public.organization_notification_settings,p_kind text
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

create or replace function public.enqueue_minuta_booking_notification(p_booking uuid,p_kind text)
returns integer language plpgsql security definer set search_path to '' as $$
declare
  v_booking public.bookings%rowtype;
  v_settings public.organization_notification_settings%rowtype;
  v_payload jsonb; v_recipient text; v_event_key text;
  v_inserted integer:=0; v_row record;
begin
  if p_kind not in('booking_created','booking_confirmed','booking_rescheduled','booking_cancelled','booking_reminder') then
    raise exception using errcode='22023',message='invalid_notification_kind';
  end if;
  select * into v_booking from public.bookings where id=p_booking;
  if not found or regexp_replace(coalesce(v_booking.client_phone,''),'[^0-9]','','g')='0000000000' then return 0; end if;
  select * into v_settings from public.organization_notification_settings
    where organization_id=v_booking.organization_id;
  if not found or not v_settings.enabled
     or not public.minuta_notification_event_enabled(v_settings,p_kind) then return 0; end if;
  select jsonb_build_object(
    'booking_code',v_booking.booking_code,'client_name',v_booking.client_name,
    'client_phone',v_booking.client_phone,'booking_date',v_booking.booking_date,
    'booking_time',v_booking.booking_time,'service_name',service.name,
    'performer_name',profile.display_name
  ) into v_payload
  from public.services service join public.performer_profiles profile on profile.id=v_booking.performer_id
  where service.id=v_booking.service_id;
  for v_row in
    select channel.audience,channel.channel from public.organization_notification_channels channel
    where channel.organization_id=v_booking.organization_id and channel.enabled
    order by channel.audience,channel.channel
  loop
    v_recipient:=case when v_row.audience='provider' then v_booking.performer_id::text
      else regexp_replace(coalesce(v_booking.client_phone,''),'[^0-9]','','g') end;
    if coalesce(v_recipient,'')='' then continue; end if;
    v_event_key:=case
      when p_kind='booking_created' and v_row.audience='provider' and v_row.channel='telegram'
        then 'booking:'||v_booking.id::text||':created:telegram'
      when p_kind in('booking_rescheduled','booking_reminder')
        then 'booking:'||v_booking.id::text||':'||p_kind||':'||v_booking.booking_date::text||':'||v_booking.booking_time::text||':'||v_row.audience||':'||v_row.channel
      else 'booking:'||v_booking.id::text||':'||p_kind||':'||v_row.audience||':'||v_row.channel
    end;
    insert into public.notification_outbox(
      performer_id,booking_id,organization_id,event_key,kind,channel,audience,recipient_key,payload,dispatcher
    ) values(
      v_booking.performer_id,v_booking.id,v_booking.organization_id,v_event_key,p_kind,v_row.channel,
      v_row.audience,v_recipient,v_payload,'unified'
    ) on conflict(event_key) do nothing;
    if found then v_inserted:=v_inserted+1; end if;
  end loop;
  return v_inserted;
end
$$;

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
      and queue.status='pending' and(
        queue.kind in('booking_rescheduled','booking_reminder','booking_confirmed')
        or(queue.kind='booking_created' and queue.audience='client'));
    perform public.enqueue_minuta_booking_notification(new.id,'booking_rescheduled');
  elsif old.status is distinct from new.status and new.status='confirmed' then
    update public.notification_outbox queue
    set status='cancelled',last_error_code='booking_state_superseded',
      last_error='Событие устарело: запись уже подтверждена',updated_at=now()
    where queue.booking_id=new.id and queue.dispatcher='unified'
      and queue.status='pending' and queue.audience='client'
      and queue.kind in('booking_created','booking_rescheduled');
    perform public.enqueue_minuta_booking_notification(new.id,'booking_confirmed');
  end if;
  return new;
end
$$;

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
  update public.notification_delivery_attempts attempt
  set outcome='failed',error_code='telegram_delivery_unknown',
    error_message='Результат отправки Telegram неизвестен; автоматический повтор заблокирован',finished_at=now()
  from public.notification_outbox queue
  where attempt.outbox_id=queue.id and attempt.performer_id=queue.performer_id
    and attempt.attempt_no=queue.attempts and queue.dispatcher='unified'
    and queue.channel='telegram' and queue.status='sending'
    and queue.locked_at<now()-interval '15 minutes';
  update public.notification_outbox queue
  set status='failed',locked_at=null,lock_token=null,last_error_code='telegram_delivery_unknown',
    last_error='Результат отправки Telegram неизвестен; автоматический повтор заблокирован',updated_at=now()
  where queue.dispatcher='unified' and queue.channel='telegram'
    and queue.status='sending' and queue.locked_at<now()-interval '15 minutes';
  update public.notification_outbox queue
  set status='cancelled',locked_at=null,lock_token=null,last_error_code='notification_event_stale',
    last_error='Событие больше не соответствует текущей записи',updated_at=now()
  from public.bookings booking
  where queue.booking_id=booking.id and queue.dispatcher='unified' and queue.status='pending' and(
    (booking.status='cancelled' and queue.kind<>'booking_cancelled')
    or(queue.audience='client' and queue.kind in('booking_created','booking_confirmed','booking_rescheduled','booking_reminder')
      and booking.booking_date+booking.booking_time<=now() at time zone 'Europe/Samara')
    or(queue.kind='booking_confirmed' and booking.status<>'confirmed')
    or(queue.kind='booking_reminder' and(
      booking.status<>'confirmed'
      or coalesce(queue.payload->>'booking_date','')<>booking.booking_date::text
      or left(coalesce(queue.payload->>'booking_time',''),8)<>left(booking.booking_time::text,8)
      or booking.booking_date+booking.booking_time<=now() at time zone 'Europe/Samara'))
    or(queue.kind='booking_rescheduled' and(
      coalesce(queue.payload->>'booking_date','')<>booking.booking_date::text
      or left(coalesce(queue.payload->>'booking_time',''),8)<>left(booking.booking_time::text,8)))
  );
  return query
  with picked as(
    select queue.id from public.notification_outbox queue
    join public.organization_notification_settings settings
      on settings.organization_id=queue.organization_id and settings.enabled
    join public.organization_notification_channels channel_setting
      on channel_setting.organization_id=queue.organization_id
      and channel_setting.audience=queue.audience
      and channel_setting.channel=queue.channel and channel_setting.enabled
    left join lateral(
      select recipient.destination from public.notification_recipient_endpoints recipient
      where recipient.organization_id=queue.organization_id and recipient.audience=queue.audience
        and recipient.subject_key=queue.recipient_key and recipient.channel=queue.channel and recipient.active
      order by recipient.updated_at desc limit 1
    ) endpoint on true
    where queue.dispatcher='unified'
      and queue.channel=any(coalesce(p_channels,array[]::text[]))
      and(queue.audience<>'client' or queue.channel<>'telegram' or exists(
        select 1 from public.notification_v114_organization_cutovers cutover
        where cutover.organization_id=queue.organization_id))
      and(queue.audience='provider' or endpoint.destination is not null)
      and((queue.status='pending' and queue.next_attempt_at<=now())
        or(queue.status='sending' and queue.channel<>'telegram'
          and queue.locked_at<now()-interval '15 minutes'))
    order by queue.next_attempt_at,queue.created_at
    for update of queue skip locked
    limit greatest(1,least(coalesce(p_limit,20),100))
  ),claimed as(
    update public.notification_outbox queue set status='sending',attempts=queue.attempts+1,
      locked_at=now(),lock_token=gen_random_uuid(),last_error_code=null,last_error=null
    from picked where queue.id=picked.id returning queue.*
  ),logged as(
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
  left join lateral(
    select recipient.destination from public.notification_recipient_endpoints recipient
    where recipient.organization_id=claimed.organization_id and recipient.audience=claimed.audience
      and recipient.subject_key=claimed.recipient_key and recipient.channel=claimed.channel and recipient.active
    order by recipient.updated_at desc limit 1
  ) endpoint on true
  order by claimed.created_at;
end
$$;

create or replace function public.fail_notification_outbox(
  p_outbox uuid,p_lock_token uuid,p_error_code text,p_error text,
  p_retryable boolean default true,p_retry_after_seconds integer default null
)
returns text language plpgsql security definer set search_path to '' as $$
declare
  v_performer uuid; v_attempt integer; v_retry boolean; v_delay_seconds integer;
  v_status text; v_error_code text:=left(coalesce(nullif(trim(p_error_code),''),'unknown_error'),120);
  v_error text:=left(coalesce(nullif(trim(p_error),''),'Неизвестная ошибка доставки'),2000);
begin
  select queue.performer_id,queue.attempts into v_performer,v_attempt
  from public.notification_outbox queue
  where queue.id=p_outbox and queue.status='sending' and queue.lock_token=p_lock_token for update;
  if not found then raise exception using errcode='P0001',message='notification_lease_lost'; end if;
  v_retry:=coalesce(p_retryable,true) and v_attempt<8;
  v_delay_seconds:=least(86400,greatest(
    (power(2,least(greatest(v_attempt-1,0),10))*60)::integer,
    least(greatest(coalesce(p_retry_after_seconds,0),0),86400)));
  v_status:=case when v_retry then 'pending' else 'failed' end;
  update public.notification_outbox queue
  set status=v_status,next_attempt_at=case when v_retry then now()+make_interval(secs=>v_delay_seconds) else queue.next_attempt_at end,
    locked_at=null,lock_token=null,last_error_code=v_error_code,last_error=v_error
  where queue.id=p_outbox;
  update public.notification_delivery_attempts attempt
  set outcome='failed',error_code=v_error_code,error_message=v_error,finished_at=now()
  where attempt.outbox_id=p_outbox and attempt.performer_id=v_performer and attempt.attempt_no=v_attempt;
  return v_status;
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
        and(v_role in('owner','admin') or(recipient.audience='provider' and recipient.subject_key=auth.uid()::text))),'[]'::jsonb),
    'outbox',coalesce((select jsonb_agg(to_jsonb(item) order by item.created_at desc)
      from(select queue.id,queue.performer_id,queue.booking_id,queue.event_key,queue.kind,
        queue.channel,queue.audience,queue.status,queue.attempts,queue.next_attempt_at,
        queue.last_error_code,queue.last_error,queue.provider_message_id,queue.sent_at,
        queue.delivered_at,queue.delivery_receipt_at,queue.delivery_receipt_source,
        jsonb_build_object('client_name',queue.payload->>'client_name','service_name',queue.payload->>'service_name',
          'booking_date',queue.payload->>'booking_date','booking_time',queue.payload->>'booking_time') as context,
        queue.created_at,queue.updated_at
        from public.notification_outbox queue where queue.organization_id=p_organization
          and(v_role in('owner','admin') or queue.performer_id=auth.uid())
        order by queue.created_at desc limit 100)item),'[]'::jsonb)
  );
end
$$;

-- Keep deployed v126 Edge Functions safe while the database is rolled back.
-- The dispatcher can continue calling this service-only no-op until reapply.
create or replace function public.enqueue_due_minuta_booking_confirmation_requests_v126(
  p_limit integer default 500
)
returns integer language plpgsql security definer set search_path to '' as $$
begin
  if coalesce(auth.role(),'')<>'service_role' then
    raise exception using errcode='42501',message='service_role_required';
  end if;
  return 0;
end
$$;

-- A rolled-back receipt endpoint also fails closed without resolving any row.
create or replace function public.confirm_minuta_notification_delivery_v126(
  p_outbox uuid,p_event_key text,p_organization uuid,p_channel text,
  p_provider_message_id text,p_delivered_at timestamptz,p_receipt_source text
)
returns text language plpgsql security definer set search_path to '' as $$
begin
  if coalesce(auth.role(),'')<>'service_role' then
    raise exception using errcode='42501',message='service_role_required';
  end if;
  return 'not_found';
end
$$;

drop function public.set_minuta_notification_fallback_v126(uuid,text,text,text,boolean,integer);
drop function public.validate_minuta_notification_quiet_hours_v126();
drop function public.minuta_notification_next_allowed_at_v126(uuid,timestamptz);

alter table public.notification_outbox
  drop constraint if exists notification_outbox_kind_check,
  add constraint notification_outbox_kind_check check(kind in(
    'booking_created','booking_confirmed','booking_rescheduled','booking_cancelled','booking_reminder'));
drop index if exists public.notification_outbox_fallback_of_idx;
alter table public.notification_outbox
  drop constraint if exists notification_outbox_fallback_depth_check,
  drop constraint if exists notification_outbox_fallback_of_fkey,
  drop column if exists fallback_depth,
  drop column if exists fallback_of;

drop table public.organization_notification_fallbacks;
alter table public.organization_notification_settings
  drop constraint if exists organization_notification_confirmation_request_minutes_check,
  drop constraint if exists organization_notification_quiet_timezone_length_check,
  drop constraint if exists organization_notification_quiet_window_check,
  drop column if exists booking_confirmation_request_enabled,
  drop column if exists confirmation_request_minutes_before,
  drop column if exists quiet_hours_enabled,
  drop column if exists quiet_hours_start,
  drop column if exists quiet_hours_end,
  drop column if exists quiet_hours_timezone;

revoke all on function public.enqueue_minuta_booking_notification(uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.enqueue_minuta_booking_change_notification() from public,anon,authenticated,service_role;
revoke all on function public.claim_minuta_notification_outbox(text[],integer) from public,anon,authenticated,service_role;
revoke all on function public.fail_notification_outbox(uuid,uuid,text,text,boolean,integer) from public,anon,authenticated,service_role;
revoke all on function public.get_minuta_notification_workspace(uuid) from public,anon,authenticated,service_role;
revoke all on function public.enqueue_due_minuta_booking_confirmation_requests_v126(integer) from public,anon,authenticated,service_role;
revoke all on function public.confirm_minuta_notification_delivery_v126(uuid,text,uuid,text,text,timestamptz,text) from public,anon,authenticated,service_role;
grant execute on function public.claim_minuta_notification_outbox(text[],integer) to service_role;
grant execute on function public.fail_notification_outbox(uuid,uuid,text,text,boolean,integer) to service_role;
grant execute on function public.enqueue_due_minuta_booking_confirmation_requests_v126(integer) to service_role;
grant execute on function public.confirm_minuta_notification_delivery_v126(uuid,text,uuid,text,text,timestamptz,text) to service_role;
grant execute on function public.get_minuta_notification_workspace(uuid) to authenticated;

notify pgrst,'reload schema';
commit;
