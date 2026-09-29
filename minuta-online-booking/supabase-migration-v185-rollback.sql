-- Restore the v126 enqueue contract. Retain the revision column and trigger
-- after any v185 activity so reapply cannot reuse a previously sent key.
begin;
set local lock_timeout='5s';
set local statement_timeout='2min';

do $guard$
begin
  if to_regprocedure('public.touch_minuta_notification_schedule_revision_v185()') is null
     or not exists(select 1 from information_schema.columns
       where table_schema='public' and table_name='bookings'
         and column_name='notification_schedule_revision') then
    raise exception using errcode='55000',message='v185_rollback_requires_v185';
  end if;
end
$guard$;

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

revoke all on function public.enqueue_minuta_booking_notification(uuid,text)
  from public,anon,authenticated,service_role;

do $schema$
begin
  if not exists(select 1 from public.bookings
       where notification_schedule_revision>0)
     and not exists(select 1 from public.notification_outbox
       where event_key like '%:revision:%') then
    drop trigger zzz_bookings_notification_schedule_revision_v185 on public.bookings;
    drop function public.touch_minuta_notification_schedule_revision_v185();
    alter table public.bookings drop column notification_schedule_revision;
  end if;
end
$schema$;

notify pgrst,'reload schema';
commit;
