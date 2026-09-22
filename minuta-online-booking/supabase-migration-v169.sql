\set ON_ERROR_STOP on

begin;
set local lock_timeout='5s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $guard$
begin
  if to_regprocedure('public.enqueue_due_minuta_booking_reminders(integer)') is null
     or to_regprocedure('public.enqueue_minuta_booking_notification(uuid,text)') is null
     or to_regclass('public.organization_notification_settings') is null
     or to_regclass('public.organization_notification_channels') is null
     or to_regclass('public.notification_outbox') is null then
    raise exception using errcode='55000',message='v169_requires_notification_outbox';
  end if;
end;
$guard$;

-- Keep the existing 30-minute early tolerance, but catch up missed reminders
-- only while the confirmed visit has not started. Existing event keys make
-- retries idempotent; skip fully queued bookings before applying the limit.
create or replace function public.enqueue_due_minuta_booking_reminders(p_limit integer default 500)
returns integer language plpgsql security definer set search_path to '' as $$
declare v_count integer:=0; v_booking record;
begin
  if coalesce(auth.role(),'')<>'service_role' then
    raise exception using errcode='42501',message='service_role_required';
  end if;
  for v_booking in
    select booking.id,booking.booking_date,booking.booking_time
    from public.bookings booking
    join public.organization_notification_settings settings
      on settings.organization_id=booking.organization_id
      and settings.enabled and settings.booking_reminder_enabled
    where booking.status='confirmed'
      and regexp_replace(coalesce(booking.client_phone,''),'[^0-9]','','g')<>'0000000000'
      and booking.booking_date+booking.booking_time>(now() at time zone 'Europe/Samara')
      and booking.booking_date+booking.booking_time
        <=(now() at time zone 'Europe/Samara')
          +make_interval(mins=>settings.reminder_minutes_before+30)
      and exists(
        select 1 from public.organization_notification_channels channel
        where channel.organization_id=booking.organization_id and channel.enabled
          and(channel.audience='provider'
            or regexp_replace(coalesce(booking.client_phone,''),'[^0-9]','','g')<>'')
          and not exists(
            select 1 from public.notification_outbox queue
            where queue.event_key='booking:'||booking.id::text||':booking_reminder:'
              ||booking.booking_date::text||':'||booking.booking_time::text
              ||':'||channel.audience||':'||channel.channel
          )
      )
    order by booking.booking_date,booking.booking_time,booking.id
    for update of booking skip locked
    limit greatest(1,least(coalesce(p_limit,500),2000))
  loop
    if v_booking.booking_date+v_booking.booking_time
       >(clock_timestamp() at time zone 'Europe/Samara') then
      v_count:=v_count+public.enqueue_minuta_booking_notification(v_booking.id,'booking_reminder');
    end if;
  end loop;
  return v_count;
end;
$$;

commit;
