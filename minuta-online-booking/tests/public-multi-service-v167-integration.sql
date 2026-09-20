-- ISOLATED TEST DATABASE ONLY. Synthetic rows are transaction-scoped and rolled back.
\set ON_ERROR_STOP on
begin;
set local statement_timeout='120s';
set local lock_timeout='15s';
set local search_path=public,extensions,pg_catalog;

create function pg_temp.v167_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'v167_assert:%',label; end if; end $$;

create table pg_temp.v167_fixture(
  performer_id uuid,organization_id uuid,location_id uuid,service_a uuid,service_b uuid,
  route_request uuid,item_a uuid,item_b uuid,date_value date,time_a time,time_b time
) on commit drop;

do $fixture$
declare
  v_source record;
  v_organization uuid:=gen_random_uuid();
  v_location uuid:=gen_random_uuid();
  v_service_a uuid:=gen_random_uuid();
  v_service_b uuid:=gen_random_uuid();
  v_slot record;
begin
  select candidate.performer_id into v_source
  from public.services candidate
  join public.organization_memberships membership on membership.user_id=candidate.performer_id and membership.active and membership.is_bookable
  join public.organizations organization on organization.id=membership.organization_id and organization.status='active'
  where candidate.active and exists(select 1 from public.get_available_slots(candidate.id,current_date+1,current_date+31))
  order by candidate.id limit 1;
  if v_source.performer_id is null then raise exception using errcode='55000',message='v167_test_requires_available_performer'; end if;

  insert into public.organizations(id,name,public_slug,status,public_booking_enabled,created_by)
  values(v_organization,'V167 organization','v167-'||replace(v_organization::text,'-',''),'active',true,v_source.performer_id);
  insert into public.locations(id,organization_id,name,address,timezone,active,is_primary)
  values(v_location,v_organization,'V167 location','V167 address','Europe/Samara',true,true);
  insert into public.organization_memberships(organization_id,user_id,role,is_bookable,active,created_by)
  values(v_organization,v_source.performer_id,'specialist',true,true,v_source.performer_id);
  insert into public.services(id,performer_id,name,duration_minutes,price_rub,active) values
    (v_service_a,v_source.performer_id,'V167 service A',30,1670,true),
    (v_service_b,v_source.performer_id,'V167 service B',30,1680,true);

  select first_slot.booking_date,first_slot.booking_time as time_a,second_slot.booking_time as time_b into v_slot
  from public.get_available_slots(v_service_a,current_date+1,current_date+7) first_slot
  join public.get_available_slots(v_service_b,current_date+1,current_date+7) second_slot
    on second_slot.booking_date=first_slot.booking_date
   and second_slot.booking_time=first_slot.booking_time+interval '30 minutes'
  order by first_slot.booking_date,first_slot.booking_time limit 1;
  if v_slot.booking_date is null then raise exception using errcode='55000',message='v167_test_requires_consecutive_slots'; end if;

  insert into pg_temp.v167_fixture values(
    v_source.performer_id,v_organization,v_location,v_service_a,v_service_b,
    gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
    v_slot.booking_date,v_slot.time_a,v_slot.time_b
  );
end
$fixture$;

select set_config('v167.slug','v167-'||replace((select organization_id::text from pg_temp.v167_fixture),'-',''),true);
select set_config('v167.route',(select route_request::text from pg_temp.v167_fixture),true);
select set_config('v167.location',(select location_id::text from pg_temp.v167_fixture),true);
select set_config('v167.items',(select jsonb_build_array(
  jsonb_build_object('request_id',item_a,'service_id',service_a,'booking_date',date_value,'booking_time',time_a,'expected_price_rub',1670,'expected_duration_minutes',30),
  jsonb_build_object('request_id',item_b,'service_id',service_b,'booking_date',date_value,'booking_time',time_b,'expected_price_rub',1680,'expected_duration_minutes',30)
)::text from pg_temp.v167_fixture),true);

set local role anon;
select set_config('v167.created',public.book_minuta_multi_service_route_v167(
  current_setting('v167.route')::uuid,current_setting('v167.slug'),current_setting('v167.location')::uuid,
  'V167 client','+79990001670',current_setting('v167.items')::jsonb
)::text,true);
select set_config('v167.replayed',public.book_minuta_multi_service_route_v167(
  current_setting('v167.route')::uuid,current_setting('v167.slug'),current_setting('v167.location')::uuid,
  'V167 client','+79990001670',current_setting('v167.items')::jsonb
)::text,true);
reset role;

select pg_temp.v167_assert(current_setting('v167.created')::jsonb->>'result_code'='ok'
  and (current_setting('v167.created')::jsonb->>'idempotent')::boolean is false
  and jsonb_array_length(current_setting('v167.created')::jsonb->'bookings')=2,'atomic_create_result');
select pg_temp.v167_assert((current_setting('v167.replayed')::jsonb->>'idempotent')::boolean is true
  and current_setting('v167.replayed')::jsonb->'bookings'=current_setting('v167.created')::jsonb->'bookings','idempotent_replay');
select pg_temp.v167_assert((select count(*)=2 from public.bookings booking
  where booking.request_id in((select item_a from pg_temp.v167_fixture),(select item_b from pg_temp.v167_fixture))
    and booking.organization_id=(select organization_id from pg_temp.v167_fixture)
    and booking.location_id=(select location_id from pg_temp.v167_fixture)
    and booking.performer_id=(select performer_id from pg_temp.v167_fixture)),'ordinary_authoritative_bookings');

set local role anon;
do $conflict$
begin
  begin
    perform public.book_minuta_multi_service_route_v167(
      current_setting('v167.route')::uuid,current_setting('v167.slug'),current_setting('v167.location')::uuid,
      'V167 changed','+79990001670',current_setting('v167.items')::jsonb);
    raise exception 'v167_conflict_accepted';
  exception when raise_exception then
    if sqlerrm<>'multi_service_request_conflict' then raise; end if;
  end;
end
$conflict$;
reset role;

select set_config('v167.failed_route',gen_random_uuid()::text,true);
select set_config('v167.failed_a',gen_random_uuid()::text,true);
select set_config('v167.failed_b',gen_random_uuid()::text,true);
set local role anon;
do $all_or_none$
declare v_fixture pg_temp.v167_fixture%rowtype;
begin
  select * into v_fixture from pg_temp.v167_fixture;
  begin
    perform public.book_minuta_multi_service_route_v167(
      current_setting('v167.failed_route')::uuid,current_setting('v167.slug'),v_fixture.location_id,
      'V167 overlap','+79990001671',jsonb_build_array(
        jsonb_build_object('request_id',current_setting('v167.failed_a')::uuid,'service_id',v_fixture.service_a,'booking_date',v_fixture.date_value+7,'booking_time',v_fixture.time_a,'expected_price_rub',1670,'expected_duration_minutes',30),
        jsonb_build_object('request_id',current_setting('v167.failed_b')::uuid,'service_id',v_fixture.service_b,'booking_date',v_fixture.date_value+7,'booking_time',v_fixture.time_a,'expected_price_rub',1680,'expected_duration_minutes',30)
      ));
    raise exception 'v167_overlap_accepted';
  exception when raise_exception then
    if sqlerrm<>'slot_unavailable' then raise; end if;
  end;
end
$all_or_none$;
reset role;
select pg_temp.v167_assert(not exists(select 1 from public.bookings where request_id in(
  current_setting('v167.failed_a')::uuid,current_setting('v167.failed_b')::uuid))
  and not exists(select 1 from public.public_multi_service_routes_v167 where request_id=current_setting('v167.failed_route')::uuid),
  'overlap_rolls_back_entire_route');

select set_config('v167.terms_route',gen_random_uuid()::text,true);
select set_config('v167.terms_a',gen_random_uuid()::text,true);
select set_config('v167.terms_b',gen_random_uuid()::text,true);
set local role anon;
do $terms$
declare v_fixture pg_temp.v167_fixture%rowtype;
begin
  select * into v_fixture from pg_temp.v167_fixture;
  begin
    perform public.book_minuta_multi_service_route_v167(
      current_setting('v167.terms_route')::uuid,current_setting('v167.slug'),v_fixture.location_id,
      'V167 terms','+79990001672',jsonb_build_array(
        jsonb_build_object('request_id',current_setting('v167.terms_a')::uuid,'service_id',v_fixture.service_a,'booking_date',v_fixture.date_value+14,'booking_time',v_fixture.time_a,'expected_price_rub',1670,'expected_duration_minutes',30),
        jsonb_build_object('request_id',current_setting('v167.terms_b')::uuid,'service_id',v_fixture.service_b,'booking_date',v_fixture.date_value+14,'booking_time',v_fixture.time_b,'expected_price_rub',9999,'expected_duration_minutes',30)
      ));
    raise exception 'v167_terms_accepted';
  exception when raise_exception then
    if sqlerrm<>'multi_service_terms_changed' then raise; end if;
  end;
end
$terms$;
reset role;
select pg_temp.v167_assert(not exists(select 1 from public.bookings where request_id in(
  current_setting('v167.terms_a')::uuid,current_setting('v167.terms_b')::uuid))
  and not exists(select 1 from public.public_multi_service_routes_v167 where request_id=current_setting('v167.terms_route')::uuid),
  'terms_change_rolls_back_entire_route');

rollback;
