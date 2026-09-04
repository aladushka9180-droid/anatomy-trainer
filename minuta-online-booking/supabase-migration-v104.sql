-- v104: compare-and-swap protection for team-calendar moves and undo.
begin;

create or replace function public.move_minuta_team_booking_v104(
  p_organization uuid,
  p_booking uuid,
  p_expected_performer uuid,
  p_expected_location uuid,
  p_expected_date date,
  p_expected_time time without time zone,
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
begin
  v_role:=public.get_minuta_schedule_role(p_organization);
  if coalesce(v_role,'') not in ('owner','admin') then
    raise exception using errcode='42501',message='team_booking_move_denied';
  end if;
  if p_booking is null or p_expected_performer is null or p_expected_location is null
     or p_expected_date is null or p_expected_time is null then
    raise exception using errcode='22023',message='invalid_team_booking_expected_point';
  end if;

  -- v102 uses this same transaction-scoped lock. Taking it before the comparison
  -- keeps the expected-point check and the protected move in one atomic section.
  perform pg_advisory_xact_lock(hashtextextended(p_booking::text,7302));
  select * into v_booking
  from public.bookings booking
  where booking.id=p_booking and booking.organization_id=p_organization
  for update;

  if v_booking.id is null then
    raise exception using errcode='P0001',message='team_booking_not_found';
  end if;
  if v_booking.performer_id is distinct from p_expected_performer
     or v_booking.location_id is distinct from p_expected_location
     or v_booking.booking_date is distinct from p_expected_date
     or v_booking.booking_time is distinct from p_expected_time then
    raise exception using errcode='40001',message='team_booking_changed';
  end if;

  return public.move_minuta_team_booking_v102(
    p_organization,p_booking,p_location,p_service,p_date,p_time
  );
end;
$$;

revoke all on function public.move_minuta_team_booking_v104(
  uuid,uuid,uuid,uuid,date,time without time zone,uuid,uuid,date,time without time zone
) from public,anon,authenticated,service_role;
grant execute on function public.move_minuta_team_booking_v104(
  uuid,uuid,uuid,uuid,date,time without time zone,uuid,uuid,date,time without time zone
) to authenticated;

commit;
