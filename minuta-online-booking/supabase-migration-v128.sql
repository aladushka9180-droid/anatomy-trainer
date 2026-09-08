\set ON_ERROR_STOP on

begin;
set local lock_timeout='5s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

-- V128 is inert until an authenticated dispatcher explicitly supplies one
-- organization, one immutable event key and one configured channel.
do $guard$
begin
  if to_regclass('public.organization_notification_settings') is null
     or to_regclass('public.organization_notification_channels') is null
     or to_regclass('public.notification_recipient_endpoints') is null
     or to_regclass('public.notification_outbox') is null
     or to_regclass('public.notification_delivery_attempts') is null
     or to_regprocedure('public.minuta_notification_next_allowed_at_v126(uuid,timestamp with time zone)') is null
     or to_regprocedure('public.claim_minuta_notification_outbox(text[],integer)') is null then
    raise exception using errcode='55000',message='v128_requires_notification_v126';
  end if;
end
$guard$;

create or replace function public.claim_minuta_notification_test_outbox_v128(
  p_organization uuid,p_event_key text,p_channel text
)
returns table(
  outbox_id uuid,lock_token uuid,event_key text,organization_id uuid,
  performer_id uuid,booking_id uuid,kind text,channel text,audience text,
  attempt_no integer,destination jsonb,message_payload jsonb
)
language plpgsql security definer set search_path to '' as $$
declare
  v_rows integer:=0;
begin
  if coalesce(auth.role(),'')<>'service_role' then
    raise exception using errcode='42501',message='notification_test_service_role_required';
  end if;
  if p_organization is null
     or p_event_key is null or p_event_key<>trim(p_event_key)
     or char_length(p_event_key) not between 1 and 240
     or p_channel is null or p_channel<>lower(trim(p_channel))
     or p_channel not in('telegram','email','sms','max','push') then
    raise exception using errcode='22023',message='invalid_notification_test_scope';
  end if;

  return query
  with picked as(
    select queue.id
    from public.notification_outbox queue
    join public.bookings booking on booking.id=queue.booking_id
    join public.organization_notification_settings settings
      on settings.organization_id=queue.organization_id and settings.enabled
    join public.organization_notification_channels channel_setting
      on channel_setting.organization_id=queue.organization_id
      and channel_setting.audience=queue.audience
      and channel_setting.channel=queue.channel and channel_setting.enabled
    left join lateral(
      select recipient.destination
      from public.notification_recipient_endpoints recipient
      where recipient.organization_id=queue.organization_id
        and recipient.audience=queue.audience
        and recipient.subject_key=queue.recipient_key
        and recipient.channel=queue.channel and recipient.active
      order by recipient.updated_at desc limit 1
    ) endpoint on true
    where queue.organization_id=p_organization and queue.event_key=p_event_key
      and queue.channel=p_channel and queue.dispatcher='unified'
      and queue.status='pending' and queue.next_attempt_at<=now()
      and(queue.audience<>'client' or queue.channel<>'telegram' or exists(
        select 1 from public.notification_v114_organization_cutovers cutover
        where cutover.organization_id=queue.organization_id))
      and(queue.audience='provider' or endpoint.destination is not null)
      and public.minuta_notification_next_allowed_at_v126(
        queue.organization_id,greatest(queue.next_attempt_at,now()))<=now()
      and not(
        (booking.status='cancelled' and queue.kind<>'booking_cancelled')
        or(queue.audience='client'
          and queue.kind in('booking_created','booking_confirmed','booking_confirmation_request','booking_rescheduled','booking_reminder')
          and booking.booking_date+booking.booking_time<=now() at time zone 'Europe/Samara')
        or(queue.kind='booking_confirmed' and booking.status<>'confirmed')
        or(queue.kind='booking_confirmation_request' and(
          booking.status<>'new'
          or coalesce(queue.payload->>'booking_date','')<>booking.booking_date::text
          or left(coalesce(queue.payload->>'booking_time',''),8)<>left(booking.booking_time::text,8)))
        or(queue.kind='booking_reminder' and(
          booking.status<>'confirmed'
          or coalesce(queue.payload->>'booking_date','')<>booking.booking_date::text
          or left(coalesce(queue.payload->>'booking_time',''),8)<>left(booking.booking_time::text,8)
          or booking.booking_date+booking.booking_time<=now() at time zone 'Europe/Samara'))
        or(queue.kind='booking_rescheduled' and(
          coalesce(queue.payload->>'booking_date','')<>booking.booking_date::text
          or left(coalesce(queue.payload->>'booking_time',''),8)<>left(booking.booking_time::text,8)))
      )
    for update of queue skip locked
  ),claimed as(
    update public.notification_outbox queue
    set status='sending',attempts=queue.attempts+1,locked_at=now(),
      lock_token=gen_random_uuid(),last_error_code=null,last_error=null
    from picked where queue.id=picked.id returning queue.*
  ),logged as(
    insert into public.notification_delivery_attempts as attempt(
      outbox_id,performer_id,attempt_no,outcome
    )
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
    select recipient.destination
    from public.notification_recipient_endpoints recipient
    where recipient.organization_id=claimed.organization_id
      and recipient.audience=claimed.audience
      and recipient.subject_key=claimed.recipient_key
      and recipient.channel=claimed.channel and recipient.active
    order by recipient.updated_at desc limit 1
  ) endpoint on true;

  get diagnostics v_rows=row_count;
  if v_rows<>1 then
    raise exception using errcode='P0001',message='notification_test_target_not_claimable';
  end if;
end
$$;

-- A failed controlled test is terminal. It must not create a fallback row or
-- leave a retryable item that a normal scheduler can send later.
create or replace function public.fail_minuta_notification_test_outbox_v128(
  p_outbox uuid,p_lock_token uuid,p_event_key text,p_organization uuid,p_channel text,
  p_error_code text,p_error text
)
returns text language plpgsql security definer set search_path to '' as $$
declare
  v_attempt integer;
  v_performer uuid;
  v_error_code text:=left(coalesce(nullif(trim(p_error_code),''),'test_delivery_failed'),120);
  v_error text:=left(coalesce(nullif(trim(p_error),''),'Ошибка контрольной доставки'),2000);
begin
  if coalesce(auth.role(),'')<>'service_role' then
    raise exception using errcode='42501',message='notification_test_service_role_required';
  end if;
  update public.notification_outbox queue
  set status='failed',locked_at=null,lock_token=null,last_error_code=v_error_code,
    last_error=v_error,updated_at=now()
  where queue.id=p_outbox and queue.lock_token=p_lock_token and queue.status='sending'
    and queue.event_key=p_event_key and queue.organization_id=p_organization
    and queue.channel=p_channel and queue.dispatcher='unified'
  returning queue.attempts,queue.performer_id into v_attempt,v_performer;
  if not found then
    raise exception using errcode='P0001',message='notification_test_lease_lost';
  end if;
  update public.notification_delivery_attempts attempt
  set outcome='failed',error_code=v_error_code,error_message=v_error,finished_at=now()
  where attempt.outbox_id=p_outbox and attempt.performer_id=v_performer
    and attempt.attempt_no=v_attempt;
  if not found then
    raise exception using errcode='P0001',message='notification_test_attempt_missing';
  end if;
  return 'failed';
end
$$;

revoke all on function public.claim_minuta_notification_test_outbox_v128(uuid,text,text)
  from public,anon,authenticated,service_role;
revoke all on function public.fail_minuta_notification_test_outbox_v128(uuid,uuid,text,uuid,text,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.claim_minuta_notification_test_outbox_v128(uuid,text,text)
  to service_role;
grant execute on function public.fail_minuta_notification_test_outbox_v128(uuid,uuid,text,uuid,text,text,text)
  to service_role;

do $verify$
begin
  if to_regprocedure('public.claim_minuta_notification_test_outbox_v128(uuid,text,text)') is null
     or to_regprocedure('public.fail_minuta_notification_test_outbox_v128(uuid,uuid,text,uuid,text,text,text)') is null
     or has_function_privilege('authenticated','public.claim_minuta_notification_test_outbox_v128(uuid,text,text)','EXECUTE')
     or not has_function_privilege('service_role','public.claim_minuta_notification_test_outbox_v128(uuid,text,text)','EXECUTE') then
    raise exception using errcode='55000',message='v128_verification_failed';
  end if;
end
$verify$;

commit;
