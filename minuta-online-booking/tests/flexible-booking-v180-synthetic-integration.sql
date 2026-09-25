-- ISOLATED PostgreSQL ONLY. Requires flexible-booking-v180-synthetic-schema.sql + v180.
-- All writes are synthetic and rolled back.
begin;
create function pg_temp.v180_check(ok boolean,label text)
returns void language plpgsql as $$begin
  if ok is distinct from true then raise exception 'v180_synthetic:%',label; end if;
end$$;

select pg_temp.v180_check(
  (select count(*)=2 from pg_catalog.pg_attribute attribute
    where attribute.attrelid='public.bookings'::regclass
      and attribute.attname in ('organization_id','location_id')
      and attribute.attnotnull)
  and exists(select 1 from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid='public.bookings'::regclass
      and constraint_row.conname='bookings_location_organization_fkey'
      and constraint_row.contype='f')
  and exists(select 1 from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid='public.bookings'::regclass
      and constraint_row.conname='bookings_performer_active_no_overlap'
      and constraint_row.contype='x')
  and (select count(*)=3 from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid='public.bookings'::regclass
      and trigger_row.tgname in ('bookings_scope_minuta_tenant',
        'bookings_zz_set_creation_attribution_v92',
        'bookings_zz_protect_creation_attribution_v92')
      and not trigger_row.tgisinternal and trigger_row.tgenabled<>'D'),
  'v68_v92_constraints_and_triggers_present');

select public.book_appointment(gen_random_uuid(),
  '00000000-0000-4000-8000-000000000180',current_date+1,'10:00',
  'Synthetic occupied 10','+79990000110');
select public.book_appointment(gen_random_uuid(),
  '00000000-0000-4000-8000-000000000180',current_date+1,'11:00',
  'Synthetic occupied 11','+79990000111');
select public.book_appointment(gen_random_uuid(),
  '00000000-0000-4000-8000-000000000180',current_date+1,'12:00',
  'Synthetic occupied 12','+79990000112');
do $overlap$
begin
  insert into public.bookings(request_id,performer_id,service_id,booking_date,
    booking_time,duration_minutes,booking_code,manage_token,client_name,client_phone)
  values(gen_random_uuid(),'00000000-0000-4000-8000-000000000181',
    '00000000-0000-4000-8000-000000000180',current_date+1,'10:30',60,
    'TEST-OVERLAP',gen_random_uuid(),'Synthetic overlap','+79990000119');
  raise exception 'v180_synthetic:exclusion_did_not_block_overlap';
exception when exclusion_violation then null;
end
$overlap$;

select set_config('v180.provider_request',gen_random_uuid()::text,true);
select set_config('request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000000181',true);
set local role authenticated;
select set_config('v180.provider_result',public.book_flexible_appointment_v180(
  current_setting('v180.provider_request')::uuid,
  '00000000-0000-4000-8000-000000000180',current_date+1,
  '10:00','18:00','Synthetic flexible provider','+79990000113',
  null,null,null,null,'provider')::text,true);
select set_config('v180.provider_replay',public.book_flexible_appointment_v180(
  current_setting('v180.provider_request')::uuid,
  '00000000-0000-4000-8000-000000000180',current_date+1,
  '10:00','18:00','Synthetic flexible provider','+79990000113',
  null,null,null,null,'provider')::text,true);
reset role;

select pg_temp.v180_check(
  current_setting('v180.provider_result')::jsonb->>'booking_time'='13:00:00'
  and current_setting('v180.provider_result')::jsonb->>'booking_id'=
      current_setting('v180.provider_replay')::jsonb->>'booking_id'
  and (select count(*) from public.bookings
       where request_id=current_setting('v180.provider_request')::uuid)=1,
  'nearest_13_and_single_idempotent_booking');
select pg_temp.v180_check((select booking.organization_id=
    '00000000-0000-4000-8000-000000000179'::uuid
    and booking.location_id='00000000-0000-4000-8000-000000000178'::uuid
    and booking.booking_scope_source='legacy'
    and booking.booking_source='provider_manual'
    and booking.created_by_user_id='00000000-0000-4000-8000-000000000181'::uuid
    and booking.created_by_role='specialist'
    from public.bookings booking
    where booking.request_id=current_setting('v180.provider_request')::uuid),
  'provider_scope_and_v92_attribution');

do $conflict$
begin
  perform public.book_flexible_appointment_v180(
    current_setting('v180.provider_request')::uuid,
    '00000000-0000-4000-8000-000000000180',current_date+1,
    '10:00','17:00','Synthetic flexible provider','+79990000113',
    null,null,null,null,'provider');
  raise exception 'v180_synthetic:changed_range_was_accepted';
exception when unique_violation then
  if sqlerrm<>'request_conflict' then raise; end if;
end
$conflict$;

select set_config('request.jwt.claim.sub','',true);
set local role anon;
select set_config('v180.public_result',public.book_flexible_appointment_v180(
  gen_random_uuid(),'00000000-0000-4000-8000-000000000180',current_date+1,
  '10:00','18:00','Synthetic flexible public','+79990000114',
  'v180-isolated','00000000-0000-4000-8000-000000000178',1000,60,'public')::text,true);
select set_config('v180.no_slot',public.book_flexible_appointment_v180(
  gen_random_uuid(),'00000000-0000-4000-8000-000000000180',current_date+1,
  '10:00','13:00','Synthetic flexible no slot','+79990000115',
  'v180-isolated','00000000-0000-4000-8000-000000000178',1000,60,'public')::text,true);
reset role;
select pg_temp.v180_check(
  current_setting('v180.public_result')::jsonb->>'booking_time'='14:00:00'
  and current_setting('v180.no_slot')::jsonb->>'result_code'='no_slot_in_range'
  and (select count(*) from public.bookings where booking_date=current_date+1)=5,
  'public_next_14_and_bounded_conflict');
select pg_temp.v180_check((select booking.organization_id=
    '00000000-0000-4000-8000-000000000179'::uuid
    and booking.location_id='00000000-0000-4000-8000-000000000178'::uuid
    and booking.booking_scope_source='team'
    and booking.booking_source='client_online'
    and booking.created_by_user_id is null and booking.created_by_role is null
    from public.bookings booking
    where booking.id=(current_setting('v180.public_result')::jsonb->>'booking_id')::uuid),
  'team_scope_and_public_v92_attribution');
do $attribution$
begin
  update public.bookings set booking_source='provider_manual'
  where id=(current_setting('v180.public_result')::jsonb->>'booking_id')::uuid;
  raise exception 'v180_synthetic:attribution_was_mutable';
exception when insufficient_privilege then
  if sqlerrm<>'booking_creation_attribution_immutable' then raise; end if;
end
$attribution$;

-- A 90-minute service may not start at 13:00 if another appointment starts 14:00.
insert into public.services(id,performer_id,name,duration_minutes,price_rub,active)
values('00000000-0000-4000-8000-000000000182',
  '00000000-0000-4000-8000-000000000181','Synthetic 90-minute service',90,1500,true);
insert into public.test_slots_v180(service_id,booking_date,booking_time)
values
  ('00000000-0000-4000-8000-000000000180',current_date+2,'14:00'),
  ('00000000-0000-4000-8000-000000000182',current_date+2,'13:00'),
  ('00000000-0000-4000-8000-000000000182',current_date+2,'15:00');
select public.book_appointment(gen_random_uuid(),
  '00000000-0000-4000-8000-000000000180',current_date+2,'14:00',
  'Synthetic occupied overlap','+79990000116');
set local role anon;
select set_config('v180.duration_result',public.book_flexible_appointment_v180(
  gen_random_uuid(),'00000000-0000-4000-8000-000000000182',current_date+2,
  '13:00','15:00','Synthetic 90-minute client','+79990000117')::text,true);
reset role;
select pg_temp.v180_check(
  current_setting('v180.duration_result')::jsonb->>'booking_time'='15:00:00',
  'duration_overlap_skips_13');

update public.services set price_rub=1200
where id='00000000-0000-4000-8000-000000000180';
set local role anon;
select set_config('v180.terms_result',public.book_flexible_appointment_v180(
  gen_random_uuid(),'00000000-0000-4000-8000-000000000180',current_date+1,
  '15:00','18:00','Synthetic stale price client','+79990000118',
  'v180-isolated','00000000-0000-4000-8000-000000000178',1000,60,'public')::text,true);
reset role;
select pg_temp.v180_check(
  current_setting('v180.terms_result')::jsonb->>'result_code'='service_terms_changed'
  and (select count(*) from public.bookings where booking_date=current_date+1)=5,
  'stale_service_terms_create_nothing');

-- Model a concurrent constraint rejection after the slot list was read.
insert into public.test_slots_v180(service_id,booking_date,booking_time)
values
  ('00000000-0000-4000-8000-000000000180',current_date+3,'10:00'),
  ('00000000-0000-4000-8000-000000000180',current_date+3,'11:00');
select set_config('v180.simulate_exclusion','on',true);
set local role anon;
select set_config('v180.exclusion_result',public.book_flexible_appointment_v180(
  gen_random_uuid(),'00000000-0000-4000-8000-000000000180',current_date+3,
  '10:00','11:00','Synthetic exclusion retry','+79990000120')::text,true);
reset role;
select set_config('v180.simulate_exclusion','off',true);
select pg_temp.v180_check(
  current_setting('v180.exclusion_result')::jsonb->>'booking_time'='11:00:00'
  and (select count(*) from public.bookings where booking_date=current_date+3)=1,
  'exclusion_retries_next_start');

-- Deletion must remain possible, while replay of the old request stays closed.
insert into public.test_slots_v180(service_id,booking_date,booking_time)
values('00000000-0000-4000-8000-000000000180',current_date+4,'10:00');
select set_config('v180.deleted_request',gen_random_uuid()::text,true);
select set_config('v180.deleted_result',public.book_flexible_appointment_v180(
  current_setting('v180.deleted_request')::uuid,
  '00000000-0000-4000-8000-000000000180',current_date+4,
  '10:00','10:00','Synthetic deleted booking','+79990000121')::text,true);
delete from public.bookings
where id=(current_setting('v180.deleted_result')::jsonb->>'booking_id')::uuid;
select set_config('v180.deleted_replay',public.book_flexible_appointment_v180(
  current_setting('v180.deleted_request')::uuid,
  '00000000-0000-4000-8000-000000000180',current_date+4,
  '10:00','10:00','Synthetic deleted booking','+79990000121')::text,true);
select pg_temp.v180_check(
  current_setting('v180.deleted_replay')::jsonb->>'result_code'='booking_deleted'
  and (select booking_id is null from public.flexible_booking_requests_v180
       where request_id=current_setting('v180.deleted_request')::uuid)
  and (select count(*) from public.bookings
       where request_id=current_setting('v180.deleted_request')::uuid)=0,
  'deletion_keeps_request_tombstone');
rollback;
