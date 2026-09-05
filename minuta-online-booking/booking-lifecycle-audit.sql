\set ON_ERROR_STOP on
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- This transaction is deliberately restricted to the bootstrapped test fixture.
do $$
begin
  if not exists(select 1 from minuta_migration_guard.target
    where project_ref='umazhvvxutnsyuphbhda' and allow_migrations)
    or (select count(*) from public.performer_profiles)<>1
    or not exists(select 1 from public.performer_profiles where id='abeb5b13-ca1d-45c6-a2ad-b0e4119b2e1f')
    or exists(select 1 from public.bookings)
    or not exists(select 1 from public.services where id='00000000-0000-4000-8000-000000000001' and active)
  then raise exception 'Isolated empty test fixture required; no changes made'; end if;
end $$;

select set_config('request.jwt.claim.sub','abeb5b13-ca1d-45c6-a2ad-b0e4119b2e1f',true);
set local role authenticated;
do $$
declare
  v_org uuid;
  v_location uuid;
  v_service uuid := '00000000-0000-4000-8000-000000000001';
  v_request uuid := extensions.gen_random_uuid();
  v_booking uuid;
  v_result jsonb;
  v_date date;
  v_time time;
  v_next_date date;
  v_next_time time;
  v_before jsonb;
  v_after jsonb;
  v_visits bigint;
  v_revenue bigint;
  v_new_visits bigint;
  v_new_revenue bigint;
begin
  select m.organization_id,l.id into v_org,v_location
  from public.organization_memberships m
  join public.locations l on l.organization_id=m.organization_id and l.active
  where m.user_id=auth.uid() and m.active and m.role='owner'
  order by l.is_primary desc,l.id limit 1;
  if v_org is null then raise exception 'Test owner/location fixture missing'; end if;
  v_before := public.get_minuta_team_analytics(v_org,current_date,current_date+62);
  if (v_before->>'can_view_team')::boolean is not true then raise exception 'Analytics access missing'; end if;
  select coalesce(sum((p->>'completed_visits')::bigint),0),coalesce(sum((p->>'revenue_rub')::bigint),0)
    into v_visits,v_revenue from jsonb_array_elements(v_before->'performers') p;
  select booking_date,booking_time into v_date,v_time
    from public.get_available_slots_v101(v_service,current_date+2,current_date+14,null)
    order by booking_date,booking_time limit 1;
  if v_date is null then raise exception 'Test fixture has no available slots'; end if;
  v_result := public.create_minuta_team_booking_v102(v_org,v_request,v_location,v_service,v_date,v_time,'Lifecycle audit','+79990000000');
  v_booking := (v_result->>'booking_id')::uuid;
  if v_booking is null or not exists(select 1 from public.bookings where id=v_booking and request_id=v_request) then raise exception 'Create failed'; end if;
  v_result := public.create_minuta_team_booking_v102(v_org,v_request,v_location,v_service,v_date,v_time,'Lifecycle audit','+79990000000');
  if (v_result->>'booking_id')::uuid is distinct from v_booking
    or (select count(*) from public.bookings where request_id=v_request)<>1 then raise exception 'Duplicate request created another booking'; end if;
  select booking_date,booking_time into v_next_date,v_next_time
    from public.get_available_slots_v101(v_service,current_date+3,current_date+14,null)
    where (booking_date,booking_time) is distinct from (v_date,v_time)
    order by booking_date,booking_time limit 1;
  if v_next_date is null then raise exception 'No second slot for rescheduling'; end if;
  v_result := public.move_minuta_team_booking_v102(v_org,v_booking,v_location,v_service,v_next_date,v_next_time);
  if (v_result->>'booking_id')::uuid is distinct from v_booking
    or not exists(select 1 from public.bookings where id=v_booking and booking_date=v_next_date and booking_time=v_next_time) then raise exception 'Reschedule failed'; end if;
  perform public.save_minuta_booking_outcome_v106(v_booking,'completed','cash',1500,null,'manual');
  v_after := public.get_minuta_team_analytics(v_org,current_date,current_date+62);
  select coalesce(sum((p->>'completed_visits')::bigint),0),coalesce(sum((p->>'revenue_rub')::bigint),0)
    into v_new_visits,v_new_revenue from jsonb_array_elements(v_after->'performers') p;
  if v_new_visits<>v_visits+1 or v_new_revenue<>v_revenue+1500 then raise exception 'Completion not reflected in analytics'; end if;
  if public.provider_delete_booking(v_booking)<>'deleted' then raise exception 'Delete failed'; end if;
  if exists(select 1 from public.bookings where id=v_booking)
    or exists(select 1 from public.booking_outcomes where booking_id=v_booking) then raise exception 'Deleted booking or outcome remains'; end if;
  v_after := public.get_minuta_team_analytics(v_org,current_date,current_date+62);
  select coalesce(sum((p->>'completed_visits')::bigint),0),coalesce(sum((p->>'revenue_rub')::bigint),0)
    into v_new_visits,v_new_revenue from jsonb_array_elements(v_after->'performers') p;
  if v_new_visits<>v_visits or v_new_revenue<>v_revenue then raise exception 'Deleted booking still contributes to analytics'; end if;
  raise notice 'PASS: create, idempotency, reschedule, completion, delete, analytics recalculation';
end $$;
reset role;
rollback;
