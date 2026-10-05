\set ON_ERROR_STOP on
-- ISOLATED CANDIDATE. The release owner must assign a unique migration number
-- after full-schema/rollback/concurrency checks and explicit production approval.
begin;
set local lock_timeout='5s';
set local statement_timeout='2min';

-- Preserve the installed functions and their OIDs. Installation changes no data,
-- notification setting, endpoint, cron, channel or subscription.
do $guard$
begin
  if to_regprocedure('public.claim_minuta_notification_outbox(text[],integer)') is null
    or to_regprocedure('public.claim_minuta_notification_test_outbox_v128(uuid,text,text)') is null
    or to_regclass('public.notification_outbox') is null
    or to_regclass('public.notification_delivery_attempts') is null then
    raise exception 'single_catchup_requires_notification_v128';
  end if;
  if (to_regprocedure('public.claim_minuta_notification_outbox_before_catchup_once(text[],integer)') is null)
    <> (to_regprocedure('public.claim_minuta_notification_test_outbox_v128_before_catchup_once(uuid,text,text)') is null) then
    raise exception 'single_catchup_partial_install';
  end if;
  if to_regprocedure('public.claim_minuta_notification_outbox_before_catchup_once(text[],integer)') is null then
    if exists(select 1 from pg_proc procedure
      cross join lateral aclexplode(coalesce(procedure.proacl,acldefault('f',procedure.proowner))) privilege
      where procedure.oid in('public.claim_minuta_notification_outbox(text[],integer)'::regprocedure,
        'public.claim_minuta_notification_test_outbox_v128(uuid,text,text)'::regprocedure)
        and privilege.privilege_type='EXECUTE'
        and privilege.grantee not in(procedure.proowner,'service_role'::regrole::oid)) then
      raise exception 'single_catchup_unexpected_execute_acl';
    end if;
    alter function public.claim_minuta_notification_outbox(text[],integer)
      rename to claim_minuta_notification_outbox_before_catchup_once;
    alter function public.claim_minuta_notification_test_outbox_v128(uuid,text,text)
      rename to claim_minuta_notification_test_outbox_v128_before_catchup_once;
  elsif position('minuta_allow_catchup_reminder_claim' in pg_get_functiondef(
    'public.claim_minuta_notification_outbox(text[],integer)'::regprocedure))=0
    or position('minuta_allow_catchup_reminder_claim' in pg_get_functiondef(
    'public.claim_minuta_notification_test_outbox_v128(uuid,text,text)'::regprocedure))=0 then
    raise exception 'single_catchup_wrapper_changed';
  end if;
end
$guard$;

create or replace function public.minuta_allow_catchup_reminder_claim(p_outbox uuid,p_batch uuid[])
returns boolean language plpgsql security definer set search_path to '' as $$
declare v_job record; v_now timestamp;
begin
  select queue.*,booking.status booking_status,booking.booking_date current_date,
    booking.booking_time current_time,booking.client_phone current_phone,
    booking.performer_id current_performer,settings.reminder_minutes_before,
    coalesce((to_jsonb(booking)->>'notification_schedule_revision')::bigint,0) current_revision
  into v_job from public.notification_outbox queue
  join public.bookings booking on booking.id=queue.booking_id and booking.organization_id=queue.organization_id
  join public.organization_notification_settings settings on settings.organization_id=queue.organization_id
  where queue.id=p_outbox;
  if not found then return false; end if;
  if v_job.kind<>'booking_reminder' then return true; end if;
  v_now:=clock_timestamp() at time zone 'Europe/Samara';
  if v_job.booking_status<>'confirmed' or v_job.current_date+v_job.current_time<=v_now
    or coalesce(v_job.payload->>'booking_date','')<>v_job.current_date::text
    or left(coalesce(v_job.payload->>'booking_time',''),8)<>left(v_job.current_time::text,8)
    or (v_job.audience='client' and v_job.recipient_key<>
      regexp_replace(coalesce(v_job.current_phone,''),'[^0-9]','','g'))
    or (v_job.audience='provider' and v_job.performer_id<>v_job.current_performer)
    or coalesce(substring(v_job.event_key from ':revision:([0-9]+)'),'0')::bigint<>v_job.current_revision
  then return false; end if;
  -- Preserve ordinary early reminders. The shared limit begins at the configured due time.
  if v_job.current_date+v_job.current_time>v_now+make_interval(mins=>v_job.reminder_minutes_before)
  then return true; end if;
  -- A timed-out or retryable send may already have reached its recipient.
  -- Catch-up never retries a claimed event or switches to a second channel.
  if v_job.attempts>1 then return false; end if;
  -- Serialize separate dispatcher transactions without taking booking row locks
  -- after the original claim's outbox locks. Only the returned winner can be sent.
  perform pg_advisory_xact_lock(hashtextextended(
    v_job.booking_id::text||':'||v_job.audience||':'||v_job.current_date::text||':'||v_job.current_time::text||':'||v_job.current_revision::text,0));
  if not exists(select 1 from public.bookings booking
    where booking.id=v_job.booking_id and booking.status='confirmed'
      and booking.booking_date+booking.booking_time>(clock_timestamp() at time zone 'Europe/Samara')
      and booking.booking_date=v_job.current_date and booking.booking_time=v_job.current_time
      and booking.organization_id=v_job.organization_id
      and (v_job.audience<>'client' or v_job.recipient_key=
        regexp_replace(coalesce(booking.client_phone,''),'[^0-9]','','g'))
      and (v_job.audience<>'provider' or booking.performer_id=v_job.performer_id)
      and coalesce((to_jsonb(booking)->>'notification_schedule_revision')::bigint,0)=v_job.current_revision)
  then return false; end if;
  return not exists(
    select 1 from public.notification_outbox peer
    where peer.booking_id=v_job.booking_id and peer.audience=v_job.audience and peer.id<>v_job.id
      and peer.kind='booking_reminder'
      and peer.payload->>'booking_date'=v_job.current_date::text
      and left(peer.payload->>'booking_time',8)=left(v_job.current_time::text,8)
      and coalesce(substring(peer.event_key from ':revision:([0-9]+)'),'0')::bigint=v_job.current_revision
      and (peer.status in('sent','delivered')
        or (peer.attempts>0 and peer.status<>'sending'
          and (peer.attempts>1 or coalesce(peer.last_error_code,'')<>'reminder_catchup_suppressed'))
        or (peer.status='sending' and (peer.attempts>1
          or not(peer.id=any(coalesce(p_batch,array[]::uuid[]))))))
  );
end
$$;

create or replace function public.minuta_cancel_catchup_reminder_claim(p_outbox uuid,p_token uuid)
returns void language plpgsql security definer set search_path to '' as $$
begin
  update public.notification_outbox queue
  set status='cancelled',locked_at=null,lock_token=null,last_error_code='reminder_catchup_suppressed',
    last_error='Догоняющее напоминание уже выбрано или запись больше не подходит',updated_at=now()
  where queue.id=p_outbox and queue.lock_token=p_token and queue.status='sending';
  if found then
    update public.notification_delivery_attempts attempt
    set outcome='failed',error_code='reminder_catchup_suppressed',
      error_message='Отправка заблокирована до вызова канала',finished_at=now()
    from public.notification_outbox queue
    where queue.id=p_outbox and attempt.outbox_id=queue.id and attempt.attempt_no=queue.attempts;
  end if;
end
$$;

create or replace function public.claim_minuta_notification_outbox(p_channels text[],p_limit integer default 20)
returns table(outbox_id uuid,lock_token uuid,event_key text,organization_id uuid,
  performer_id uuid,booking_id uuid,kind text,channel text,audience text,
  attempt_no integer,destination jsonb,message_payload jsonb)
language plpgsql security definer set search_path to '' as $$
declare v_job record; v_remaining uuid[];
begin
  for v_job in select claimed.*,array_agg(claimed.outbox_id) over() batch_ids
    from public.claim_minuta_notification_outbox_before_catchup_once(p_channels,p_limit) claimed
    order by claimed.booking_id,claimed.audience,claimed.event_key,claimed.outbox_id
  loop
    if v_remaining is null then v_remaining:=v_job.batch_ids; end if;
    v_remaining:=array_remove(v_remaining,v_job.outbox_id);
    if public.minuta_allow_catchup_reminder_claim(v_job.outbox_id,v_remaining) then
      return query select v_job.outbox_id,v_job.lock_token,v_job.event_key,v_job.organization_id,
        v_job.performer_id,v_job.booking_id,v_job.kind,v_job.channel,v_job.audience,
        v_job.attempt_no,v_job.destination,v_job.message_payload;
    else
      perform public.minuta_cancel_catchup_reminder_claim(v_job.outbox_id,v_job.lock_token);
    end if;
  end loop;
end
$$;

create or replace function public.claim_minuta_notification_test_outbox_v128(p_organization uuid,p_event_key text,p_channel text)
returns table(outbox_id uuid,lock_token uuid,event_key text,organization_id uuid,
  performer_id uuid,booking_id uuid,kind text,channel text,audience text,
  attempt_no integer,destination jsonb,message_payload jsonb)
language plpgsql security definer set search_path to '' as $$
declare v_job record;
begin
  for v_job in select * from public.claim_minuta_notification_test_outbox_v128_before_catchup_once(
    p_organization,p_event_key,p_channel)
  loop
    if public.minuta_allow_catchup_reminder_claim(v_job.outbox_id,array[]::uuid[]) then
      return query select v_job.outbox_id,v_job.lock_token,v_job.event_key,v_job.organization_id,
        v_job.performer_id,v_job.booking_id,v_job.kind,v_job.channel,v_job.audience,
        v_job.attempt_no,v_job.destination,v_job.message_payload;
    else
      perform public.minuta_cancel_catchup_reminder_claim(v_job.outbox_id,v_job.lock_token);
    end if;
  end loop;
end
$$;

revoke all on function public.minuta_allow_catchup_reminder_claim(uuid,uuid[]) from public,anon,authenticated,service_role;
revoke all on function public.minuta_cancel_catchup_reminder_claim(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.claim_minuta_notification_outbox_before_catchup_once(text[],integer) from public,anon,authenticated,service_role;
revoke all on function public.claim_minuta_notification_test_outbox_v128_before_catchup_once(uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function public.claim_minuta_notification_outbox(text[],integer) from public,anon,authenticated,service_role;
revoke all on function public.claim_minuta_notification_test_outbox_v128(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.claim_minuta_notification_outbox(text[],integer) to service_role;
grant execute on function public.claim_minuta_notification_test_outbox_v128(uuid,text,text) to service_role;
commit;
