\set ON_ERROR_STOP on

begin;
set local lock_timeout='5s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $guard$
begin
  if to_regprocedure('public.create_provider_block_v123(uuid,uuid,uuid,date,time without time zone,integer,uuid,text,text)') is null
     or to_regprocedure('public.get_provider_block_slots_v123(uuid,uuid,uuid,date,integer)') is null
     or to_regprocedure('public.get_primetime_schedule_v139(jsonb)') is null
     or to_regprocedure('public.minuta_booking_fits_active_shift(uuid,uuid,uuid,date,time without time zone,integer)') is null then
    raise exception using errcode='55000',message='v141_requires_protected_block_v123_and_schedule_v139';
  end if;
end
$guard$;

create or replace function public.ensure_minuta_block_service_v141()
returns uuid language plpgsql volatile security definer set search_path to '' as $$
declare v_actor uuid:=auth.uid(); v_service uuid;
begin
  if v_actor is null then raise exception using errcode='42501',message='authentication_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text,14101));
  select service.id into v_service
  from public.services service
  where service.performer_id=v_actor and service.name='__MINUTA_SCHEDULE_BLOCK__'
  order by service.created_at,service.id limit 1 for update;
  if v_service is null then
    insert into public.services(id,performer_id,name,duration_minutes,price_rub,active)
    values(extensions.gen_random_uuid(),v_actor,'__MINUTA_SCHEDULE_BLOCK__',60,0,false)
    returning id into v_service;
  end if;
  return v_service;
end $$;
revoke all on function public.ensure_minuta_block_service_v141() from public,anon,authenticated,service_role;

create or replace function public.minuta_block_slot_valid_v141(
  p_organization uuid,p_location uuid,p_date date,p_time time without time zone,
  p_duration integer,p_ignore_booking uuid default null
) returns boolean language plpgsql volatile security definer set search_path to '' as $$
declare v_actor uuid:=auth.uid(); v_schedule public.provider_schedule%rowtype; v_zone text; v_end timestamp;
begin
  if v_actor is null then raise exception using errcode='42501',message='authentication_required'; end if;
  if p_organization is null or p_location is null or p_date is null or p_time is null
     or p_duration is null or p_duration not between 1 and 480 or extract(second from p_time)<>0 then return false; end if;
  select location.timezone into v_zone
  from public.locations location
  join public.organizations organization on organization.id=location.organization_id and organization.status='active'
  join public.organization_memberships member on member.organization_id=organization.id
    and member.user_id=v_actor and member.active and member.is_bookable
  where location.id=p_location and location.organization_id=p_organization and location.active;
  if v_zone is null then return false; end if;
  begin perform pg_catalog.timezone(v_zone,p_date::timestamp); exception when invalid_parameter_value then return false; end;
  v_end:=p_date+p_time+make_interval(mins=>p_duration);
  if p_date+p_time<=timezone(v_zone,now()) or p_date>timezone(v_zone,now())::date+730 or v_end>p_date+1 then return false; end if;
  select * into v_schedule from public.provider_schedule
  where performer_id=v_actor and weekday=extract(isodow from p_date)::integer;
  if not found or not v_schedule.enabled or v_schedule.start_time is null or v_schedule.end_time is null
     or p_time<v_schedule.start_time or v_end>p_date+v_schedule.end_time then return false; end if;
  if v_schedule.break_start is not null and v_schedule.break_end is not null
     and tsrange(p_date+p_time,v_end,'[)')&&tsrange(p_date+v_schedule.break_start,p_date+v_schedule.break_end,'[)') then return false; end if;
  if exists(select 1 from public.provider_days_off day_off where day_off.performer_id=v_actor and day_off.off_date=p_date
    and (day_off.all_day or day_off.start_time is null or day_off.end_time is null
      or tsrange(p_date+p_time,v_end,'[)')&&tsrange(p_date+day_off.start_time,p_date+day_off.end_time,'[)'))) then return false; end if;
  if exists(select 1 from public.bookings booking where booking.performer_id=v_actor and booking.status<>'cancelled'
    and (p_ignore_booking is null or booking.id<>p_ignore_booking)
    and tsrange(p_date+p_time,v_end,'[)')&&tsrange(booking.booking_date+booking.booking_time,
      booking.booking_date+booking.booking_time+make_interval(mins=>booking.duration_minutes),'[)')) then return false; end if;
  if not coalesce(public.minuta_booking_fits_active_shift(p_organization,p_location,v_actor,p_date,p_time,p_duration),false) then return false; end if;
  if exists(select 1 from public.group_booking_events event where event.organization_id=p_organization
    and event.location_id=p_location and event.performer_id=v_actor and event.event_date=p_date
    and event.status in ('published','closed')
    and tsrange(p_date+p_time,v_end,'[)')&&tsrange(event.event_date+event.start_time,
      event.event_date+event.start_time+make_interval(mins=>event.duration_minutes),'[)')) then return false; end if;
  return true;
end $$;
revoke all on function public.minuta_block_slot_valid_v141(uuid,uuid,date,time without time zone,integer,uuid) from public,anon,authenticated,service_role;

create or replace function public.get_provider_block_slots_v141(
  p_organization uuid,p_location uuid,p_date date,p_duration integer,p_ignore_booking uuid default null
) returns table(booking_date date,booking_time time without time zone)
language plpgsql volatile security definer set search_path to '' as $$
declare v_minute integer; v_first integer; v_last integer;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication_required'; end if;
  if p_duration is null or p_duration not between 1 and 480 then raise exception using errcode='22023',message='invalid_block_duration'; end if;
  select ceil(extract(epoch from start_time)/60)::integer,
    floor(extract(epoch from end_time)/60)::integer-p_duration into v_first,v_last
  from public.provider_schedule where performer_id=auth.uid()
    and weekday=extract(isodow from p_date)::integer and enabled;
  if not found or v_first is null or v_last is null or v_first>v_last then return; end if;
  for v_minute in v_first..v_last loop
    if public.minuta_block_slot_valid_v141(p_organization,p_location,p_date,
      (time '00:00'+make_interval(mins=>v_minute))::time,p_duration,p_ignore_booking) then
      booking_date:=p_date; booking_time:=(time '00:00'+make_interval(mins=>v_minute))::time; return next;
    end if;
  end loop;
end $$;
revoke all on function public.get_provider_block_slots_v141(uuid,uuid,date,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_provider_block_slots_v141(uuid,uuid,date,integer,uuid) to authenticated;

create or replace function public.create_provider_block_v141(
  p_organization uuid,p_location uuid,p_date date,p_time time without time zone,p_duration integer,
  p_request_id uuid,p_title text default 'Перерыв',p_note text default ''
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_actor uuid:=auth.uid(); v_existing public.bookings%rowtype; v_service uuid; v_code text;
  v_previous_org text:=current_setting('minuta.booking_organization',true);
  v_previous_location text:=current_setting('minuta.booking_location',true);
begin
  if v_actor is null then raise exception using errcode='42501',message='authentication_required'; end if;
  if p_request_id is null or p_organization is null or p_location is null or p_date is null or p_time is null
     or p_duration is null or p_duration not between 1 and 480
     or char_length(trim(coalesce(p_title,''))) not between 2 and 80 or char_length(coalesce(p_note,''))>1000 then
    raise exception using errcode='22023',message='invalid_block_payload';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,14102));
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text||p_date::text,0));
  if not pg_try_advisory_xact_lock(hashtextextended(p_organization::text,7100)) then
    raise exception using errcode='40001',message='block_schedule_changed';
  end if;
  select * into v_existing from public.bookings where id=p_request_id;
  if found then
    if v_existing.performer_id<>v_actor or v_existing.organization_id<>p_organization or v_existing.location_id<>p_location
       or v_existing.booking_date<>p_date or v_existing.booking_time<>p_time or v_existing.duration_minutes<>p_duration
       or v_existing.client_phone<>'0000000000' or v_existing.client_name<>trim(p_title)
       or coalesce(v_existing.provider_note,'')<>coalesce(p_note,'') or v_existing.status='cancelled' then
      raise exception using errcode='23505',message='block_request_conflict';
    end if;
    return jsonb_build_object('booking_id',v_existing.id,'booking_code',v_existing.booking_code,
      'duration_minutes',v_existing.duration_minutes,'replayed',true,'payment_required',false,'notifications_suppressed',true);
  end if;
  if not public.minuta_block_slot_valid_v141(p_organization,p_location,p_date,p_time,p_duration,null) then
    raise exception using errcode='23P01',message='block_slot_unavailable';
  end if;
  v_service:=public.ensure_minuta_block_service_v141();
  v_code:='MIN-'||upper(substr(encode(extensions.gen_random_bytes(6),'hex'),1,10));
  perform set_config('minuta.booking_organization',p_organization::text,true);
  perform set_config('minuta.booking_location',p_location::text,true);
  insert into public.bookings(id,booking_code,manage_token,performer_id,service_id,client_name,client_phone,
    booking_date,booking_time,duration_minutes,original_price_rub,total_price_rub,status,deposit_amount_rub,payment_status,payment_url,provider_note)
  values(p_request_id,v_code,extensions.gen_random_uuid(),v_actor,v_service,trim(p_title),'0000000000',
    p_date,p_time,p_duration,0,0,'new',0,'not_required','',p_note);
  update public.bookings set original_price_rub=0,total_price_rub=0,deposit_amount_rub=0,payment_status='not_required',
    payment_url='',payment_due_at=null,expired_unpaid_at=null,refund_status='not_required',
    booking_policy_snapshot=coalesce(booking_policy_snapshot,'{}'::jsonb)||jsonb_build_object('schedule_block',true,'payment_suppressed',true)
  where id=p_request_id;
  delete from public.notification_outbox where booking_id=p_request_id;
  perform set_config('minuta.booking_organization',coalesce(v_previous_org,''),true);
  perform set_config('minuta.booking_location',coalesce(v_previous_location,''),true);
  return jsonb_build_object('booking_id',p_request_id,'booking_code',v_code,'duration_minutes',p_duration,
    'payment_required',false,'notifications_suppressed',true);
exception when others then
  perform set_config('minuta.booking_organization',coalesce(v_previous_org,''),true);
  perform set_config('minuta.booking_location',coalesce(v_previous_location,''),true);
  raise;
end $$;
revoke all on function public.create_provider_block_v141(uuid,uuid,date,time without time zone,integer,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.create_provider_block_v141(uuid,uuid,date,time without time zone,integer,uuid,text,text) to authenticated;

create or replace function public.update_provider_block_v141(
  p_booking uuid,p_date date,p_time time without time zone,p_duration integer,
  p_expected_date date,p_expected_time time without time zone,p_expected_duration integer,
  p_title text,p_note text default ''
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_actor uuid:=auth.uid(); v_block public.bookings%rowtype; v_updated public.bookings%rowtype;
begin
  if v_actor is null then raise exception using errcode='42501',message='authentication_required'; end if;
  if p_booking is null or p_date is null or p_time is null or p_expected_date is null or p_expected_time is null
     or p_duration is null or p_duration not between 1 and 480 or p_expected_duration is null
     or char_length(trim(coalesce(p_title,''))) not between 2 and 80 or char_length(coalesce(p_note,''))>1000 then
    raise exception using errcode='22023',message='invalid_block_payload';
  end if;
  select * into v_block from public.bookings where id=p_booking;
  if not found then raise exception using errcode='P0001',message='block_not_found'; end if;
  if v_block.performer_id<>v_actor or v_block.client_phone<>'0000000000' then
    raise exception using errcode='42501',message='block_access_denied';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_booking::text,14103));
  perform pg_advisory_xact_lock(hashtextextended(v_block.organization_id::text,7100));
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text||p_date::text,0));
  select * into v_block from public.bookings where id=p_booking for update;
  if not found or v_block.performer_id<>v_actor or v_block.client_phone<>'0000000000' then
    raise exception using errcode='40001',message='block_changed';
  end if;
  if v_block.booking_date is distinct from p_expected_date or v_block.booking_time is distinct from p_expected_time
     or v_block.duration_minutes is distinct from p_expected_duration or v_block.status='cancelled' then
    raise exception using errcode='40001',message='block_changed';
  end if;
  if not public.minuta_block_slot_valid_v141(v_block.organization_id,v_block.location_id,p_date,p_time,p_duration,p_booking) then
    raise exception using errcode='23P01',message='block_slot_unavailable';
  end if;
  update public.bookings set booking_date=p_date,booking_time=p_time,duration_minutes=p_duration,
    client_name=trim(p_title),provider_note=coalesce(p_note,'')
  where id=p_booking and performer_id=v_actor
  returning * into v_updated;
  delete from public.notification_outbox where booking_id=p_booking;
  return jsonb_build_object('booking_id',v_updated.id,'booking_date',v_updated.booking_date,
    'booking_time',v_updated.booking_time,'duration_minutes',v_updated.duration_minutes,
    'notifications_suppressed',true);
exception when exclusion_violation or unique_violation then
  raise exception using errcode='23P01',message='block_slot_unavailable';
end $$;
revoke all on function public.update_provider_block_v141(uuid,date,time without time zone,integer,date,time without time zone,integer,text,text) from public,anon,authenticated,service_role;
grant execute on function public.update_provider_block_v141(uuid,date,time without time zone,integer,date,time without time zone,integer,text,text) to authenticated;

notify pgrst,'reload schema';
commit;

