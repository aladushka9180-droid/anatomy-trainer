\set ON_ERROR_STOP on

begin;
set local lock_timeout='5s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

-- Restore the v88 scheduler definition. Already queued rows are preserved.
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

commit;
