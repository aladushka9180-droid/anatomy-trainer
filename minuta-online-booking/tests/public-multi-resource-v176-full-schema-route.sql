-- Disposable schema-only clone only. All synthetic rows roll back.
\set ON_ERROR_STOP on
begin;
set local statement_timeout='120s';
set local lock_timeout='15s';
set local search_path=public,extensions,pg_catalog;

do $rehearsal$
declare
  actor_a uuid;
  actor_b uuid:=gen_random_uuid();
  organization_id uuid:=gen_random_uuid();
  location_id uuid:=gen_random_uuid();
  service_a uuid:=gen_random_uuid();
  service_b uuid:=gen_random_uuid();
  route_id uuid:=gen_random_uuid();
  request_a uuid:=gen_random_uuid();
  request_b uuid:=gen_random_uuid();
  slug text:='v176-'||replace(organization_id::text,'-','');
  visit_date date;
  time_a time without time zone;
  time_b time without time zone;
  items jsonb;
  created jsonb;
  replayed jsonb;
begin
  select service.performer_id into actor_a
  from public.services service
  join public.organization_memberships membership
    on membership.user_id=service.performer_id and membership.active and membership.is_bookable
  where service.active
  order by service.id limit 1;
  if actor_a is null then raise exception 'v176_full_schema_source_performer_missing'; end if;

  perform set_config('session_replication_role','replica',true);
  insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values(actor_b,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
    actor_b||'@example.invalid',now(),'{}','{}',now(),now());
  perform set_config('session_replication_role','origin',true);
  insert into public.performer_profiles(id,display_name)
  values(actor_b,'V176 isolated second performer');
  insert into public.provider_schedule(performer_id,weekday,enabled,start_time,end_time,slot_interval_minutes)
  select actor_b,day,true,'09:00','18:00',15 from generate_series(1,7) day;

  insert into public.organizations(id,name,public_slug,status,public_booking_enabled,created_by)
  values(organization_id,'V176 isolated route',slug,'active',true,actor_a);
  insert into public.locations(id,organization_id,name,address,timezone,active,is_primary)
  values(location_id,organization_id,'V176 isolated location','Test-only address','Europe/Samara',true,true);
  insert into public.organization_memberships(organization_id,user_id,role,is_bookable,active,created_by)
  values(organization_id,actor_a,'specialist',true,true,actor_a),
        (organization_id,actor_b,'specialist',true,true,actor_a);
  insert into public.services(id,performer_id,name,duration_minutes,price_rub,active)
  values(service_a,actor_a,'V176 first',30,1761,true),
        (service_b,actor_b,'V176 second',30,1762,true);

  select first_slot.booking_date,first_slot.booking_time,second_slot.booking_time
    into visit_date,time_a,time_b
  from public.get_available_slots(service_a,current_date+1,current_date+7) first_slot
  join public.get_available_slots(service_b,current_date+1,current_date+7) second_slot
    on second_slot.booking_date=first_slot.booking_date
   and second_slot.booking_time>=first_slot.booking_time+interval '30 minutes'
   and second_slot.booking_time<=first_slot.booking_time+interval '90 minutes'
  order by first_slot.booking_date,first_slot.booking_time,second_slot.booking_time limit 1;
  if visit_date is null then raise exception 'v176_full_schema_route_slot_missing'; end if;
  items:=jsonb_build_array(
    jsonb_build_object('request_id',request_a,'organization_slug',slug,
      'location_id',location_id,'performer_id',actor_a,'service_id',service_a,
      'booking_date',visit_date,'booking_time',time_a,
      'expected_price_rub',1761,'expected_duration_minutes',30),
    jsonb_build_object('request_id',request_b,'organization_slug',slug,
      'location_id',location_id,'performer_id',actor_b,'service_id',service_b,
      'booking_date',visit_date,'booking_time',time_b,
      'expected_price_rub',1762,'expected_duration_minutes',30));

  select public.book_minuta_multi_resource_route_v176(route_id,'V176 isolated client',
    '+79990001760',items,'[]'::jsonb) into created;
  if created->>'result_code'<>'ok' or (created->>'idempotent')::boolean
     or jsonb_array_length(created->'bookings')<>2 then
    raise exception 'v176_full_schema_create_failed';
  end if;
  if (select count(*) from public.bookings where request_id in(request_a,request_b))<>2
     or (select count(*) from public.public_multi_resource_route_items_v176
         where route_request_id=route_id)<>2 then
    raise exception 'v176_full_schema_incomplete_route';
  end if;
  select public.book_minuta_multi_resource_route_v176(route_id,'V176 isolated client',
    '+79990001760',items,'[]'::jsonb) into replayed;
  if not (replayed->>'idempotent')::boolean
     or replayed->'bookings' is distinct from created->'bookings' then
    raise exception 'v176_full_schema_replay_failed';
  end if;
end
$rehearsal$;

rollback;
