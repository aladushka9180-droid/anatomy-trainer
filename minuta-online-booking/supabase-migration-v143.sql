\set ON_ERROR_STOP on

begin;
set local lock_timeout='5s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $guard$
begin
  if to_regprocedure('public.get_available_slots_v101(uuid,date,date,uuid)') is null
     or to_regprocedure('public.manage_minuta_booking_series_v123(uuid,text,text,date,time without time zone,date,time without time zone)') is null
     or to_regprocedure('public.update_provider_block_v141(uuid,date,time without time zone,integer,date,time without time zone,integer,text,text)') is null
     or to_regclass('public.booking_outcomes') is null then
    raise exception using errcode='55000',message='v143_requires_booking_v101_series_v123_and_block_v141';
  end if;
end
$guard$;

create or replace function public.reschedule_minuta_provider_booking_v143(
  p_booking uuid,
  p_date date,
  p_time time without time zone,
  p_expected_date date,
  p_expected_time time without time zone
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_actor uuid:=auth.uid();
  v_booking public.bookings%rowtype;
  v_updated public.bookings%rowtype;
begin
  if v_actor is null then
    raise exception using errcode='42501',message='authentication_required';
  end if;
  if p_booking is null or p_date is null or p_time is null
     or p_expected_date is null or p_expected_time is null
     or extract(second from p_time)<>0 then
    raise exception using errcode='22023',message='invalid_provider_reschedule_target';
  end if;

  -- Existing booking mutations use the same booking -> organization -> day order.
  perform pg_advisory_xact_lock(hashtextextended(p_booking::text,7302));
  select * into v_booking from public.bookings booking where booking.id=p_booking;
  if not found then
    raise exception using errcode='P0001',message='provider_booking_not_found';
  end if;
  if v_booking.performer_id<>v_actor then
    raise exception using errcode='42501',message='provider_booking_access_denied';
  end if;
  if v_booking.organization_id is null then
    raise exception using errcode='55000',message='provider_booking_organization_missing';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_booking.organization_id::text,7100));
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text||p_date::text,0));

  select * into v_booking
  from public.bookings booking
  where booking.id=p_booking
  for update;
  if not found then
    raise exception using errcode='40001',message='provider_booking_changed';
  end if;
  if v_booking.performer_id<>v_actor then
    raise exception using errcode='42501',message='provider_booking_access_denied';
  end if;
  if v_booking.booking_date is distinct from p_expected_date
     or v_booking.booking_time is distinct from p_expected_time then
    raise exception using errcode='40001',message='provider_booking_changed';
  end if;
  if v_booking.series_id is not null then
    raise exception using errcode='55000',message='provider_booking_series_requires_scope';
  end if;
  if v_booking.client_phone='0000000000'
     or coalesce(v_booking.booking_policy_snapshot,'{}'::jsonb) @> '{"schedule_block":true}'::jsonb then
    raise exception using errcode='55000',message='provider_booking_block_requires_block_rpc';
  end if;
  if v_booking.status='cancelled' or v_booking.booking_date<current_date
     or exists(select 1 from public.booking_outcomes outcome
       where outcome.booking_id=v_booking.id and outcome.visit_status<>'scheduled') then
    raise exception using errcode='P0001',message='provider_booking_not_actionable';
  end if;
  if not exists(
    select 1 from public.get_available_slots_v101(v_booking.service_id,p_date,p_date,p_booking) slot
    where slot.booking_date=p_date and slot.booking_time=p_time
  ) then
    raise exception using errcode='23P01',message='provider_booking_slot_unavailable';
  end if;

  update public.bookings booking
  set booking_date=p_date,booking_time=p_time
  where booking.id=p_booking and booking.performer_id=v_actor
  returning booking.* into v_updated;
  if not found then
    raise exception using errcode='40001',message='provider_booking_changed';
  end if;
  return jsonb_build_object(
    'booking_id',v_updated.id,
    'performer_id',v_updated.performer_id,
    'service_id',v_updated.service_id,
    'booking_date',v_updated.booking_date,
    'booking_time',v_updated.booking_time,
    'duration_minutes',v_updated.duration_minutes,
    'status',v_updated.status,
    'notifications_suppressed',false
  );
exception
  when exclusion_violation or unique_violation then
    raise exception using errcode='23P01',message='provider_booking_slot_unavailable';
  when raise_exception then
    if sqlerrm in ('resource_unavailable','booking_buffer_conflict','slot_unavailable') then
      raise exception using errcode='23P01',message='provider_booking_slot_unavailable';
    end if;
    raise;
end
$$;

revoke all on function public.reschedule_minuta_provider_booking_v143(uuid,date,time without time zone,date,time without time zone)
  from public,anon,authenticated,service_role;
grant execute on function public.reschedule_minuta_provider_booking_v143(uuid,date,time without time zone,date,time without time zone)
  to authenticated;

notify pgrst,'reload schema';
commit;
