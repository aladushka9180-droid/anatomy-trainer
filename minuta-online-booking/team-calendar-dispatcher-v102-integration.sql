\set ON_ERROR_STOP on

begin;

do $$
declare
  v_actor uuid;
  v_organization uuid;
  v_location uuid;
  v_service uuid;
  v_service_duration integer;
  v_request uuid:=extensions.gen_random_uuid();
  v_booking uuid;
  v_date date;
  v_time time without time zone;
  v_result jsonb;
  v_duration integer;
begin
  select actor.user_id,actor.organization_id,location.id
  into v_actor,v_organization,v_location
  from public.organization_memberships actor
  join public.organizations organization
    on organization.id=actor.organization_id and organization.status='active'
  join public.locations location
    on location.organization_id=actor.organization_id and location.active
  where actor.active and actor.role in ('owner','admin')
  order by location.is_primary desc,actor.organization_id
  limit 1;
  if v_actor is null then raise exception 'v102_manager_fixture_missing'; end if;

  insert into public.organization_shift_settings(organization_id,enabled,updated_at)
  values(v_organization,false,now())
  on conflict(organization_id) do update set enabled=false,updated_at=excluded.updated_at;

  select service.id,service.duration_minutes,slot.booking_date,slot.booking_time
  into v_service,v_service_duration,v_date,v_time
  from public.services service
  join public.organization_memberships performer
    on performer.organization_id=v_organization
   and performer.user_id=service.performer_id
   and performer.active and performer.is_bookable
  cross join lateral public.get_available_slots_v101(
    service.id,
    timezone('Europe/Samara',now())::date+1,
    timezone('Europe/Samara',now())::date+62,
    null
  ) slot
  where service.active and service.duration_minutes>5
  order by slot.booking_date,slot.booking_time,service.id
  limit 1;
  if v_service is null then raise exception 'v102_available_slot_fixture_missing'; end if;

  perform set_config('request.jwt.claim.sub',v_actor::text,true);
  v_result:=public.create_minuta_team_booking_v102(
    v_organization,v_request,v_location,v_service,v_date,v_time,
    'V102 integration','+79990000102'
  );
  v_booking:=(v_result->>'booking_id')::uuid;
  if v_booking is null or not exists(
    select 1 from public.bookings booking
    where booking.id=v_booking and booking.request_id=v_request
      and booking.organization_id=v_organization and booking.location_id=v_location
  ) then
    raise exception 'v102_create_result_invalid';
  end if;

  -- Reproduce a legacy zero-duration row without firing modern write guards.
  perform set_config('session_replication_role','replica',true);
  update public.bookings set duration_minutes=0 where id=v_booking;
  perform set_config('session_replication_role','origin',true);

  v_result:=public.move_minuta_team_booking_v102(
    v_organization,v_booking,v_location,v_service,v_date,v_time
  );
  if (v_result->>'booking_id')::uuid<>v_booking then
    raise exception 'v102_move_result_invalid';
  end if;
  select booking.duration_minutes into v_duration
  from public.bookings booking where booking.id=v_booking;
  if v_duration<>v_service_duration then
    raise exception 'v102_zero_duration_not_restored_from_service: expected %, got %',
      v_service_duration,v_duration;
  end if;
end $$;

rollback;
