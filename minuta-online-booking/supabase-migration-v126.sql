\set ON_ERROR_STOP on

begin;
set local lock_timeout='5s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

-- D02A is deliberately inert after installation: confirmation requests,
-- quiet hours and every fallback route require an explicit owner setting.
do $guard$
begin
  if to_regclass('public.organization_notification_settings') is null
     or to_regclass('public.organization_notification_channels') is null
     or to_regclass('public.notification_recipient_endpoints') is null
     or to_regclass('public.notification_outbox') is null
     or to_regclass('public.notification_delivery_attempts') is null
     or to_regprocedure('public.enqueue_minuta_booking_notification(uuid,text)') is null
     or to_regprocedure('public.claim_minuta_notification_outbox(text[],integer)') is null
     or to_regprocedure('public.fail_notification_outbox(uuid,uuid,text,text,boolean,integer)') is null
     or to_regprocedure('public.confirm_minuta_notification_delivery_v114(text,text,timestamptz,text)') is null
     or to_regprocedure('public.has_organization_role(uuid,text[])') is null then
    raise exception using errcode='55000',message='v126_requires_notification_v114_and_v125';
  end if;
end
$guard$;

alter table public.organization_notification_settings
  add column if not exists booking_confirmation_request_enabled boolean not null default false,
  add column if not exists confirmation_request_minutes_before integer not null default 1440,
  add column if not exists quiet_hours_enabled boolean not null default false,
  add column if not exists quiet_hours_start time without time zone not null default '22:00',
  add column if not exists quiet_hours_end time without time zone not null default '08:00',
  add column if not exists quiet_hours_timezone text not null default 'Europe/Samara';

alter table public.organization_notification_settings
  drop constraint if exists organization_notification_confirmation_request_minutes_check,
  add constraint organization_notification_confirmation_request_minutes_check
    check(confirmation_request_minutes_before between 15 and 10080),
  drop constraint if exists organization_notification_quiet_timezone_length_check,
  add constraint organization_notification_quiet_timezone_length_check
    check(char_length(quiet_hours_timezone) between 1 and 80),
  drop constraint if exists organization_notification_quiet_window_check,
  add constraint organization_notification_quiet_window_check
    check(not quiet_hours_enabled or quiet_hours_start<>quiet_hours_end);

create or replace function public.validate_minuta_notification_quiet_hours_v126()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  perform 1 from pg_catalog.pg_timezone_names zone where zone.name=new.quiet_hours_timezone;
  if not found then
    raise exception using errcode='22023',message='invalid_notification_quiet_timezone';
  end if;
  if new.quiet_hours_enabled and new.quiet_hours_start=new.quiet_hours_end then
    raise exception using errcode='22023',message='invalid_notification_quiet_window';
  end if;
  return new;
end
$$;

drop trigger if exists organization_notification_settings_validate_quiet_v126
  on public.organization_notification_settings;
create trigger organization_notification_settings_validate_quiet_v126
before insert or update of quiet_hours_enabled,quiet_hours_start,quiet_hours_end,quiet_hours_timezone
on public.organization_notification_settings
for each row execute function public.validate_minuta_notification_quiet_hours_v126();

create table if not exists public.organization_notification_fallbacks(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  audience text not null check(audience in ('provider','client')),
  primary_channel text not null check(primary_channel in ('telegram','email','sms','max','push')),
  fallback_channel text not null check(fallback_channel in ('telegram','email','sms','max','push')),
  enabled boolean not null default false,
  delay_seconds integer not null default 300 check(delay_seconds between 0 and 86400),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,audience,primary_channel),
  check(primary_channel<>fallback_channel)
);

alter table public.organization_notification_fallbacks enable row level security;
drop policy if exists organization_notification_fallbacks_member_read
  on public.organization_notification_fallbacks;
create policy organization_notification_fallbacks_member_read
on public.organization_notification_fallbacks for select to authenticated
using(public.has_organization_role(organization_id,array['owner','admin','specialist']));
revoke all on public.organization_notification_fallbacks from public,anon,authenticated;
grant select on public.organization_notification_fallbacks to authenticated;
grant all on public.organization_notification_fallbacks to service_role;

drop trigger if exists organization_notification_fallbacks_touch_updated_at
  on public.organization_notification_fallbacks;
create trigger organization_notification_fallbacks_touch_updated_at
before update on public.organization_notification_fallbacks
for each row execute function public.touch_minuta_updated_at();

alter table public.notification_outbox
  add column if not exists fallback_of uuid,
  add column if not exists fallback_depth smallint not null default 0;

do $fallback_fk$
begin
  if not exists(
    select 1 from pg_constraint
    where conrelid='public.notification_outbox'::regclass
      and conname='notification_outbox_fallback_of_fkey'
  ) then
    alter table public.notification_outbox
      add constraint notification_outbox_fallback_of_fkey
      foreign key(fallback_of) references public.notification_outbox(id) on delete restrict;
  end if;
end
$fallback_fk$;

alter table public.notification_outbox
  drop constraint if exists notification_outbox_fallback_depth_check,
  add constraint notification_outbox_fallback_depth_check
    check((fallback_depth=0 and fallback_of is null) or (fallback_depth=1 and fallback_of is not null)),
  drop constraint if exists notification_outbox_kind_check,
  add constraint notification_outbox_kind_check check(kind in(
    'booking_created','booking_confirmed','booking_confirmation_request',
    'booking_rescheduled','booking_cancelled','booking_reminder'
  ));

create index if not exists notification_outbox_fallback_of_idx
  on public.notification_outbox(fallback_of) where fallback_of is not null;

create or replace function public.minuta_notification_event_enabled(
  p_settings public.organization_notification_settings,p_kind text
)
returns boolean language sql immutable set search_path to '' as $$
  select case p_kind
    when 'booking_created' then (p_settings).booking_created_enabled
    when 'booking_confirmed' then (p_settings).booking_confirmed_enabled
    when 'booking_confirmation_request' then (p_settings).booking_confirmation_request_enabled
    when 'booking_rescheduled' then (p_settings).booking_rescheduled_enabled
    when 'booking_cancelled' then (p_settings).booking_cancelled_enabled
    when 'booking_reminder' then (p_settings).booking_reminder_enabled
    else false
  end
$$;

create or replace function public.minuta_notification_next_allowed_at_v126(
  p_organization uuid,p_candidate timestamptz
)
returns timestamptz language plpgsql stable security definer set search_path to '' as $$
declare
  v_enabled boolean; v_start time; v_end time; v_timezone text;
  v_local timestamp; v_target timestamp;
begin
  select settings.quiet_hours_enabled,settings.quiet_hours_start,
    settings.quiet_hours_end,settings.quiet_hours_timezone
  into v_enabled,v_start,v_end,v_timezone
  from public.organization_notification_settings settings
  where settings.organization_id=p_organization;
  if not found or not v_enabled then return p_candidate; end if;
  perform 1 from pg_catalog.pg_timezone_names zone where zone.name=v_timezone;
  if not found or v_start=v_end then
    raise exception using errcode='22023',message='invalid_notification_quiet_configuration';
  end if;
  v_local:=p_candidate at time zone v_timezone;
  if v_start<v_end and v_local::time>=v_start and v_local::time<v_end then
    v_target:=v_local::date+v_end;
  elsif v_start>v_end and v_local::time>=v_start then
    v_target:=(v_local::date+1)+v_end;
  elsif v_start>v_end and v_local::time<v_end then
    v_target:=v_local::date+v_end;
  else
    return p_candidate;
  end if;
  return v_target at time zone v_timezone;
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
  if p_kind not in('booking_created','booking_confirmed','booking_confirmation_request',
    'booking_rescheduled','booking_cancelled','booking_reminder') then
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
  from public.services service
  join public.performer_profiles profile on profile.id=v_booking.performer_id
  where service.id=v_booking.service_id;
  for v_row in
    select channel.audience,channel.channel
    from public.organization_notification_channels channel
    where channel.organization_id=v_booking.organization_id and channel.enabled
      and(p_kind<>'booking_confirmation_request' or channel.audience='client')
    order by channel.audience,channel.channel
  loop
    v_recipient:=case when v_row.audience='provider' then v_booking.performer_id::text
      else regexp_replace(coalesce(v_booking.client_phone,''),'[^0-9]','','g') end;
    if coalesce(v_recipient,'')='' then continue; end if;
    v_event_key:=case
      when p_kind='booking_created' and v_row.audience='provider' and v_row.channel='telegram'
        then 'booking:'||v_booking.id::text||':created:telegram'
      when p_kind in('booking_rescheduled','booking_reminder','booking_confirmation_request')
        then 'booking:'||v_booking.id::text||':'||p_kind||':'||v_booking.booking_date::text||':'||v_booking.booking_time::text||':'||v_row.audience||':'||v_row.channel
      else 'booking:'||v_booking.id::text||':'||p_kind||':'||v_row.audience||':'||v_row.channel
    end;
    insert into public.notification_outbox(
      performer_id,booking_id,organization_id,event_key,kind,channel,
      audience,recipient_key,payload,dispatcher,next_attempt_at
    ) values(
      v_booking.performer_id,v_booking.id,v_booking.organization_id,v_event_key,p_kind,v_row.channel,
      v_row.audience,v_recipient,v_payload,'unified',now()
    ) on conflict(event_key) do nothing;
    if found then v_inserted:=v_inserted+1; end if;
  end loop;
  return v_inserted;
end
$$;

create or replace function public.enqueue_due_minuta_booking_confirmation_requests_v126(
  p_limit integer default 500
)
returns integer language plpgsql security definer set search_path to '' as $$
declare v_count integer:=0; v_booking record;
begin
  if coalesce(auth.role(),'')<>'service_role' then
    raise exception using errcode='42501',message='service_role_required';
  end if;
  for v_booking in
    select booking.id
    from public.bookings booking
    join public.organization_notification_settings settings
      on settings.organization_id=booking.organization_id
      and settings.enabled and settings.booking_confirmation_request_enabled
    where booking.status='new'
      and booking.booking_date+booking.booking_time
        between (now() at time zone settings.quiet_hours_timezone)
          +make_interval(mins=>settings.confirmation_request_minutes_before-30)
        and (now() at time zone settings.quiet_hours_timezone)
          +make_interval(mins=>settings.confirmation_request_minutes_before+30)
    order by booking.booking_date,booking.booking_time,booking.id
    limit greatest(1,least(coalesce(p_limit,500),2000))
  loop
    v_count:=v_count+public.enqueue_minuta_booking_notification(v_booking.id,'booking_confirmation_request');
  end loop;
  return v_count;
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
        queue.kind in('booking_rescheduled','booking_reminder','booking_confirmed','booking_confirmation_request')
        or(queue.kind='booking_created' and queue.audience='client')
      );
    perform public.enqueue_minuta_booking_notification(new.id,'booking_rescheduled');
  elsif old.status is distinct from new.status and new.status='confirmed' then
    update public.notification_outbox queue
    set status='cancelled',last_error_code='booking_state_superseded',
      last_error='Событие устарело: запись уже подтверждена',updated_at=now()
    where queue.booking_id=new.id and queue.dispatcher='unified'
      and queue.status='pending' and queue.audience='client'
      and queue.kind in('booking_created','booking_rescheduled','booking_confirmation_request');
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
    or(queue.audience='client' and queue.kind in('booking_created','booking_confirmed','booking_confirmation_request','booking_rescheduled','booking_reminder')
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
  );
  return query
  with picked as(
    select queue.id
    from public.notification_outbox queue
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
      and public.minuta_notification_next_allowed_at_v126(
        queue.organization_id,greatest(queue.next_attempt_at,now()))<=now()
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
  v_job public.notification_outbox%rowtype; v_retry boolean; v_delay_seconds integer;
  v_status text; v_error_code text:=left(coalesce(nullif(trim(p_error_code),''),'unknown_error'),120);
  v_error text:=left(coalesce(nullif(trim(p_error),''),'Неизвестная ошибка доставки'),2000);
begin
  select queue.* into v_job from public.notification_outbox queue
  where queue.id=p_outbox and queue.status='sending' and queue.lock_token=p_lock_token for update;
  if not found then raise exception using errcode='P0001',message='notification_lease_lost'; end if;
  v_retry:=coalesce(p_retryable,true) and v_job.attempts<8;
  v_delay_seconds:=least(86400,greatest(
    (power(2,least(greatest(v_job.attempts-1,0),10))*60)::integer,
    least(greatest(coalesce(p_retry_after_seconds,0),0),86400)));
  v_status:=case when v_retry then 'pending' else 'failed' end;
  update public.notification_outbox queue
  set status=v_status,
    next_attempt_at=case when v_retry then now()+make_interval(secs=>v_delay_seconds) else queue.next_attempt_at end,
    locked_at=null,lock_token=null,last_error_code=v_error_code,last_error=v_error
  where queue.id=p_outbox;
  update public.notification_delivery_attempts attempt
  set outcome='failed',error_code=v_error_code,error_message=v_error,finished_at=now()
  where attempt.outbox_id=p_outbox and attempt.performer_id=v_job.performer_id
    and attempt.attempt_no=v_job.attempts;

  if v_status='failed' and v_job.dispatcher='unified' and v_job.fallback_depth=0
     and v_error_code not like '%delivery_unknown%' then
    insert into public.notification_outbox(
      performer_id,booking_id,organization_id,event_key,kind,channel,status,attempts,
      next_attempt_at,audience,recipient_key,payload,dispatcher,fallback_of,fallback_depth
    )
    select v_job.performer_id,v_job.booking_id,v_job.organization_id,
      left(v_job.event_key,190)||':fallback:'||policy.fallback_channel||':'||left(md5(v_job.event_key),12),
      v_job.kind,policy.fallback_channel,'pending',0,
      now()+make_interval(secs=>policy.delay_seconds),
      v_job.audience,v_job.recipient_key,v_job.payload,'unified',v_job.id,1
    from public.organization_notification_fallbacks policy
    join public.organization_notification_channels channel_setting
      on channel_setting.organization_id=policy.organization_id
      and channel_setting.audience=policy.audience
      and channel_setting.channel=policy.fallback_channel and channel_setting.enabled
    where policy.organization_id=v_job.organization_id and policy.audience=v_job.audience
      and policy.primary_channel=v_job.channel and policy.enabled
      and exists(select 1 from public.notification_recipient_endpoints endpoint
        where endpoint.organization_id=v_job.organization_id and endpoint.audience=v_job.audience
          and endpoint.subject_key=v_job.recipient_key and endpoint.channel=policy.fallback_channel
          and endpoint.active)
    on conflict(event_key) do nothing;
  end if;
  return v_status;
end
$$;

create or replace function public.set_minuta_notification_fallback_v126(
  p_organization uuid,p_audience text,p_primary_channel text,p_fallback_channel text,
  p_enabled boolean,p_delay_seconds integer default 300
)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_row public.organization_notification_fallbacks%rowtype;
begin
  if not public.has_organization_role(p_organization,array['owner','admin']) then
    raise exception using errcode='42501',message='notification_fallback_access_denied';
  end if;
  if p_audience not in('provider','client')
     or p_primary_channel not in('telegram','email','sms','max','push')
     or p_fallback_channel not in('telegram','email','sms','max','push')
     or p_primary_channel=p_fallback_channel
     or coalesce(p_delay_seconds,-1) not between 0 and 86400 then
    raise exception using errcode='22023',message='invalid_notification_fallback';
  end if;
  insert into public.organization_notification_fallbacks(
    organization_id,audience,primary_channel,fallback_channel,enabled,delay_seconds
  ) values(p_organization,p_audience,p_primary_channel,p_fallback_channel,coalesce(p_enabled,false),p_delay_seconds)
  on conflict(organization_id,audience,primary_channel) do update set
    fallback_channel=excluded.fallback_channel,enabled=excluded.enabled,
    delay_seconds=excluded.delay_seconds,updated_at=now()
  returning * into v_row;
  return to_jsonb(v_row);
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
    'fallbacks',coalesce((select jsonb_agg(to_jsonb(policy) order by audience,primary_channel)
      from public.organization_notification_fallbacks policy where policy.organization_id=p_organization),'[]'::jsonb),
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
        queue.fallback_of,queue.fallback_depth,
        jsonb_build_object('client_name',queue.payload->>'client_name','service_name',queue.payload->>'service_name',
          'booking_date',queue.payload->>'booking_date','booking_time',queue.payload->>'booking_time') as context,
        queue.created_at,queue.updated_at
        from public.notification_outbox queue where queue.organization_id=p_organization
          and(v_role in('owner','admin') or queue.performer_id=auth.uid())
        order by queue.created_at desc limit 100)item),'[]'::jsonb)
  );
end
$$;

revoke all on function public.validate_minuta_notification_quiet_hours_v126() from public,anon,authenticated,service_role;
revoke all on function public.minuta_notification_next_allowed_at_v126(uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.enqueue_due_minuta_booking_confirmation_requests_v126(integer) from public,anon,authenticated,service_role;
revoke all on function public.set_minuta_notification_fallback_v126(uuid,text,text,text,boolean,integer) from public,anon,authenticated,service_role;
revoke all on function public.enqueue_minuta_booking_notification(uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.enqueue_minuta_booking_change_notification() from public,anon,authenticated,service_role;
revoke all on function public.claim_minuta_notification_outbox(text[],integer) from public,anon,authenticated,service_role;
revoke all on function public.fail_notification_outbox(uuid,uuid,text,text,boolean,integer) from public,anon,authenticated,service_role;
revoke all on function public.get_minuta_notification_workspace(uuid) from public,anon,authenticated,service_role;
grant execute on function public.enqueue_due_minuta_booking_confirmation_requests_v126(integer) to service_role;
grant execute on function public.claim_minuta_notification_outbox(text[],integer) to service_role;
grant execute on function public.fail_notification_outbox(uuid,uuid,text,text,boolean,integer) to service_role;
grant execute on function public.set_minuta_notification_fallback_v126(uuid,text,text,text,boolean,integer) to authenticated;
grant execute on function public.get_minuta_notification_workspace(uuid) to authenticated;

do $verify$
begin
  if not exists(select 1 from information_schema.columns
      where table_schema='public' and table_name='organization_notification_settings'
        and column_name='booking_confirmation_request_enabled' and column_default='false')
     or not exists(select 1 from information_schema.columns
      where table_schema='public' and table_name='organization_notification_fallbacks'
        and column_name='enabled' and column_default='false')
     or to_regprocedure('public.enqueue_due_minuta_booking_confirmation_requests_v126(integer)') is null
     or to_regprocedure('public.set_minuta_notification_fallback_v126(uuid,text,text,text,boolean,integer)') is null then
    raise exception using errcode='55000',message='v126_install_verification_failed';
  end if;
end
$verify$;

notify pgrst,'reload schema';
commit;
