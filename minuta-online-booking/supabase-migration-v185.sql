-- v185: distinguish a return to a previously used slot from a duplicate
-- notification enqueue. Existing revision-zero event keys stay byte-identical.
begin;
set local lock_timeout='5s';
set local statement_timeout='2min';

do $guard$
begin
  if to_regclass('public.bookings') is null
     or to_regclass('public.notification_outbox') is null
     or to_regprocedure('public.enqueue_minuta_booking_notification(uuid,text)') is null
     or to_regprocedure('public.minuta_notification_event_enabled(public.organization_notification_settings,text)') is null
     or to_regprocedure('public.enqueue_minuta_booking_change_notification()') is null then
    raise exception using errcode='55000',message='v185_requires_notification_v126';
  end if;
end
$guard$;

alter table public.bookings
  add column if not exists notification_schedule_revision bigint not null default 0;

create or replace function public.touch_minuta_notification_schedule_revision_v185()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if tg_op='INSERT' then
    new.notification_schedule_revision:=0;
  elsif old.booking_date is distinct from new.booking_date
     or old.booking_time is distinct from new.booking_time then
    new.notification_schedule_revision:=old.notification_schedule_revision+1;
  else
    new.notification_schedule_revision:=old.notification_schedule_revision;
  end if;
  return new;
end
$$;

drop trigger if exists zzz_bookings_notification_schedule_revision_v185 on public.bookings;
create trigger zzz_bookings_notification_schedule_revision_v185
before insert or update on public.bookings
for each row execute function public.touch_minuta_notification_schedule_revision_v185();

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
          ||case when v_booking.notification_schedule_revision>0
            then ':revision:'||v_booking.notification_schedule_revision::text else '' end
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

revoke all on function public.touch_minuta_notification_schedule_revision_v185()
  from public,anon,authenticated,service_role;
revoke all on function public.enqueue_minuta_booking_notification(uuid,text)
  from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
