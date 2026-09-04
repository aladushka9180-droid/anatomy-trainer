begin;

do $$
begin
  if to_regprocedure('public.get_minuta_team_calendar_v2(uuid,date,date,uuid,uuid,uuid)') is null
     or to_regprocedure('public.get_minuta_schedule_role(uuid)') is null
     or to_regprocedure('public.minuta_booking_fits_active_shift(uuid,uuid,uuid,date,time without time zone,integer)') is null
     or to_regprocedure('public.book_appointment(uuid,uuid,date,time without time zone,text,text)') is null
     or to_regprocedure('public.write_minuta_schedule_audit(uuid,text,uuid,jsonb)') is null
     or to_regprocedure('public.enqueue_minuta_booking_notification(uuid,text)') is null
     or to_regclass('public.staff_location_shifts') is null
     or to_regclass('public.staff_absences') is null
     or to_regclass('public.booking_session_items') is null
     or to_regclass('public.booking_session_revisions') is null
     or to_regclass('public.booking_outcomes') is null
     or to_regclass('public.notification_marks') is null
     or to_regclass('public.notification_outbox') is null
     or not exists(
       select 1 from information_schema.columns
       where table_schema='public' and table_name='bookings' and column_name='series_id'
     )
     or not exists(
       select 1 from information_schema.columns
       where table_schema='public' and table_name='bookings' and column_name='series_occurrence'
     ) then
    raise exception using errcode='55000',message='v102_prerequisites_missing';
  end if;
end $$;

create or replace function public.get_minuta_team_calendar_v3(
  p_organization uuid,
  p_start date,
  p_end date,
  p_location uuid default null,
  p_performer uuid default null,
  p_resource uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_calendar jsonb;
  v_role text;
  v_bookings jsonb;
begin
  v_calendar:=public.get_minuta_team_calendar_v2(
    p_organization,p_start,p_end,p_location,p_performer,p_resource
  );
  v_role:=v_calendar->>'current_role';
  if coalesce(v_role,'') not in ('owner','admin') then
    raise exception using errcode='42501',message='team_dispatcher_denied';
  end if;

  select coalesce(jsonb_agg(
    booking_entry.item||jsonb_build_object(
      'series_id',booking.series_id,
      'series_occurrence',booking.series_occurrence,
      'has_addons',exists(
        select 1 from public.booking_session_items item
        where item.booking_id=booking.id and item.item_kind='addon'
      )
    ) order by booking_entry.ordinality
  ),'[]'::jsonb)
  into v_bookings
  from jsonb_array_elements(coalesce(v_calendar->'bookings','[]'::jsonb))
    with ordinality as booking_entry(item,ordinality)
  join public.bookings booking on booking.id=(booking_entry.item->>'id')::uuid;

  return (v_calendar-'bookings')||jsonb_build_object(
    'dispatcher_actions',true,
    'bookings',v_bookings,
    'services',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',service.id,
        'performer_id',service.performer_id,
        'name',service.name,
        'duration_minutes',service.duration_minutes,
        'price_rub',service.price_rub
      ) order by profile.display_name,service.name,service.id)
      from public.services service
      join public.organization_memberships membership
        on membership.organization_id=p_organization
       and membership.user_id=service.performer_id
       and membership.active and membership.is_bookable
      join public.performer_profiles profile on profile.id=service.performer_id
      where service.active
        and (p_performer is null or service.performer_id=p_performer)
    ),'[]'::jsonb),
    'shifts',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',shift_row.id,
        'location_id',shift_row.location_id,
        'performer_id',shift_row.performer_id,
        'shift_date',shift_row.shift_date,
        'start_time',shift_row.start_time,
        'end_time',shift_row.end_time,
        'break_start',shift_row.break_start,
        'break_end',shift_row.break_end,
        'active',shift_row.active
      ) order by shift_row.shift_date,shift_row.start_time,shift_row.performer_id)
      from public.staff_location_shifts shift_row
      where shift_row.organization_id=p_organization
        and shift_row.shift_date between p_start and p_end
        and shift_row.active
        and (p_location is null or shift_row.location_id=p_location)
        and (p_performer is null or shift_row.performer_id=p_performer)
    ),'[]'::jsonb),
    'absences',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',absence.id,
        'performer_id',absence.performer_id,
        'starts_on',absence.starts_on,
        'ends_on',absence.ends_on,
        'kind',absence.kind,
        'note',absence.note,
        'active',absence.active
      ) order by absence.starts_on,absence.performer_id)
      from public.staff_absences absence
      where absence.organization_id=p_organization
        and absence.active
        and absence.starts_on<=p_end and absence.ends_on>=p_start
        and (p_performer is null or absence.performer_id=p_performer)
    ),'[]'::jsonb)
  );
end;
$$;

create or replace function public.create_minuta_team_booking_v102(
  p_organization uuid,
  p_request_id uuid,
  p_location uuid,
  p_service uuid,
  p_date date,
  p_time time without time zone,
  p_client_name text,
  p_client_phone text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_role text;
  v_previous_organization text:=current_setting('minuta.booking_organization',true);
  v_previous_location text:=current_setting('minuta.booking_location',true);
  v_code text;
  v_token uuid;
  v_booking uuid;
begin
  v_role:=public.get_minuta_schedule_role(p_organization);
  if coalesce(v_role,'') not in ('owner','admin') then
    raise exception using errcode='42501',message='team_booking_create_denied';
  end if;
  if p_request_id is null or p_date is null or p_time is null
     or char_length(trim(coalesce(p_client_name,''))) not between 2 and 80
     or char_length(trim(coalesce(p_client_phone,''))) not between 6 and 32 then
    raise exception using errcode='22023',message='invalid_team_booking';
  end if;
  if not exists(
    select 1 from public.locations location
    where location.id=p_location and location.organization_id=p_organization and location.active
  ) or not exists(
    select 1 from public.services service
    join public.organization_memberships membership
      on membership.organization_id=p_organization
     and membership.user_id=service.performer_id
     and membership.active and membership.is_bookable
    where service.id=p_service and service.active
  ) then
    raise exception using errcode='42501',message='foreign_team_booking_scope';
  end if;

  perform set_config('minuta.booking_organization',p_organization::text,true);
  perform set_config('minuta.booking_location',p_location::text,true);
  begin
    select result.booking_code,result.manage_token into v_code,v_token
    from public.book_appointment(
      p_request_id,p_service,p_date,p_time,trim(p_client_name),trim(p_client_phone)
    ) result;
  exception when others then
    perform set_config('minuta.booking_organization',coalesce(v_previous_organization,''),true);
    perform set_config('minuta.booking_location',coalesce(v_previous_location,''),true);
    raise;
  end;
  perform set_config('minuta.booking_organization',coalesce(v_previous_organization,''),true);
  perform set_config('minuta.booking_location',coalesce(v_previous_location,''),true);

  select booking.id into v_booking from public.bookings booking
  where booking.request_id=p_request_id and booking.organization_id=p_organization;
  if v_booking is null then
    raise exception using errcode='P0001',message='team_booking_not_created';
  end if;
  return jsonb_build_object('booking_id',v_booking,'booking_code',v_code);
end;
$$;

create or replace function public.move_minuta_team_booking_v102(
  p_organization uuid,
  p_booking uuid,
  p_location uuid,
  p_service uuid,
  p_date date,
  p_time time without time zone
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_role text;
  v_booking public.bookings%rowtype;
  v_target_performer uuid;
  v_source_name text;
  v_source_duration integer;
  v_target_name text;
  v_target_duration integer;
  v_effective_duration integer;
begin
  v_role:=public.get_minuta_schedule_role(p_organization);
  if coalesce(v_role,'') not in ('owner','admin') then
    raise exception using errcode='42501',message='team_booking_move_denied';
  end if;
  if p_booking is null or p_location is null or p_service is null or p_date is null or p_time is null
     or p_date<timezone('Europe/Samara',now())::date
     or p_date>timezone('Europe/Samara',now())::date+730 then
    raise exception using errcode='22023',message='invalid_team_booking_target';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_booking::text,7302));
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text,7100));
  select * into v_booking from public.bookings booking
  where booking.id=p_booking and booking.organization_id=p_organization and booking.status<>'cancelled'
  for update;
  if v_booking.id is null then
    raise exception using errcode='P0001',message='team_booking_not_found';
  end if;
  if v_booking.series_id is not null then
    raise exception using errcode='55000',message='team_series_move_requires_scope';
  end if;
  if exists(
    select 1 from public.booking_outcomes outcome
    where outcome.booking_id=p_booking and outcome.visit_status<>'scheduled'
  ) then
    raise exception using errcode='55000',message='completed_team_booking_move_denied';
  end if;
  if not exists(
    select 1 from public.locations location
    where location.id=p_location and location.organization_id=p_organization and location.active
  ) then
    raise exception using errcode='42501',message='foreign_team_booking_location';
  end if;

  select service.performer_id,service.name,service.duration_minutes
  into v_target_performer,v_target_name,v_target_duration
  from public.services service
  join public.organization_memberships membership
    on membership.organization_id=p_organization
   and membership.user_id=service.performer_id
   and membership.active and membership.is_bookable
  where service.id=p_service and service.active;
  select service.name,service.duration_minutes into v_source_name,v_source_duration
  from public.services service where service.id=v_booking.service_id;
  if v_target_performer is null then
    raise exception using errcode='42501',message='foreign_team_booking_service';
  end if;
  v_effective_duration:=greatest(
    coalesce(nullif(v_booking.duration_minutes,0),v_target_duration,60),5
  );
  if p_service<>v_booking.service_id
     and (lower(trim(v_target_name))<>lower(trim(v_source_name)) or v_target_duration<>v_source_duration) then
    raise exception using errcode='22023',message='incompatible_team_booking_service';
  end if;
  if v_target_performer<>v_booking.performer_id and exists(
    select 1 from public.booking_session_items item
    where item.booking_id=p_booking and item.item_kind='addon'
  ) then
    raise exception using errcode='55000',message='team_booking_addons_require_manual_move';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_target_performer::text||p_date::text,0));
  if not public.minuta_booking_fits_active_shift(
    p_organization,p_location,v_target_performer,p_date,p_time,v_effective_duration
  ) then
    raise exception using errcode='23P01',message='team_booking_outside_shift';
  end if;
  if exists(
    select 1 from public.bookings other
    where other.performer_id=v_target_performer
      and other.booking_date=p_date
      and other.id<>p_booking
      and other.status<>'cancelled'
      and p_time<other.booking_time+make_interval(mins=>coalesce(other.duration_minutes,60))
      and p_time+make_interval(mins=>v_effective_duration)>other.booking_time
  ) then
    raise exception using errcode='23P01',message='team_booking_slot_unavailable';
  end if;

  if v_target_performer<>v_booking.performer_id then
    update public.booking_session_items item
    set performer_id=v_target_performer,
        service_id=case when item.item_kind='primary' then p_service else item.service_id end,
        title=case when item.item_kind='primary' then v_target_name else item.title end,
        duration_minutes=case when item.item_kind='primary' then greatest(
          coalesce(nullif(item.duration_minutes,0),v_target_duration,60),5
        ) else item.duration_minutes end
    where item.booking_id=p_booking;
    insert into public.booking_session_revisions(
      booking_id,performer_id,items,total_price_rub,total_duration_minutes
    )
    select p_booking,v_target_performer,
      jsonb_agg(jsonb_build_object(
        'kind',item.item_kind,'service_id',item.service_id,'title',item.title,
        'duration_minutes',item.duration_minutes,'price_rub',item.price_rub,
        'extends_duration',item.extends_duration
      ) order by item.position),
      sum(item.price_rub)::integer,
      greatest(5,(sum(item.duration_minutes) filter(where item.item_kind='primary')+
       coalesce(sum(item.duration_minutes) filter(where item.item_kind='addon' and item.extends_duration),0))::integer)
    from public.booking_session_items item where item.booking_id=p_booking having count(*)>0;
  end if;

  delete from public.notification_marks where booking_id=p_booking;
  update public.notification_outbox
  set status='failed',last_error_code='booking_moved_by_dispatcher',
      last_error='Доставка отменена: запись перенесена в командном календаре',
      locked_at=null,lock_token=null
  where booking_id=p_booking and status in ('pending','sending');

  update public.bookings
  set location_id=p_location,service_id=p_service,performer_id=v_target_performer,
      booking_date=p_date,booking_time=p_time,duration_minutes=v_effective_duration
  where id=p_booking;
  perform public.enqueue_minuta_booking_notification(p_booking,'booking_rescheduled');
  perform public.write_minuta_schedule_audit(
    p_organization,'team_booking_moved',p_booking,
    jsonb_build_object(
      'old_performer_id',v_booking.performer_id,'new_performer_id',v_target_performer,
      'old_location_id',v_booking.location_id,'new_location_id',p_location,
      'old_date',v_booking.booking_date,'new_date',p_date,
      'old_time',v_booking.booking_time,'new_time',p_time
    )
  );
  return jsonb_build_object(
    'booking_id',p_booking,'performer_id',v_target_performer,
    'location_id',p_location,'booking_date',p_date,'booking_time',p_time
  );
exception
  when exclusion_violation then
    raise exception using errcode='23P01',message='team_booking_slot_unavailable';
end;
$$;

revoke all on function public.get_minuta_team_calendar_v3(uuid,date,date,uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.get_minuta_team_calendar_v3(uuid,date,date,uuid,uuid,uuid)
  to authenticated;
revoke all on function public.create_minuta_team_booking_v102(uuid,uuid,uuid,uuid,date,time without time zone,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.create_minuta_team_booking_v102(uuid,uuid,uuid,uuid,date,time without time zone,text,text)
  to authenticated;
revoke all on function public.move_minuta_team_booking_v102(uuid,uuid,uuid,uuid,date,time without time zone)
  from public,anon,authenticated,service_role;
grant execute on function public.move_minuta_team_booking_v102(uuid,uuid,uuid,uuid,date,time without time zone)
  to authenticated;

commit;
