-- ISOLATED PostgreSQL ONLY. Requires flexible-booking-v178-synthetic-schema.sql + v178.
-- All writes are synthetic and rolled back.
begin;
create function pg_temp.v178_check(ok boolean,label text)
returns void language plpgsql as $$begin
  if ok is distinct from true then raise exception 'v178_synthetic:%',label; end if;
end$$;

select public.book_appointment(gen_random_uuid(),
  '00000000-0000-4000-8000-000000000180',current_date+1,'10:00',
  'Synthetic occupied 10','+79990000110');
select public.book_appointment(gen_random_uuid(),
  '00000000-0000-4000-8000-000000000180',current_date+1,'11:00',
  'Synthetic occupied 11','+79990000111');
select public.book_appointment(gen_random_uuid(),
  '00000000-0000-4000-8000-000000000180',current_date+1,'12:00',
  'Synthetic occupied 12','+79990000112');

select set_config('v178.provider_request',gen_random_uuid()::text,true);
select set_config('request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000000181',true);
set local role authenticated;
select set_config('v178.provider_result',public.book_flexible_appointment_v178(
  current_setting('v178.provider_request')::uuid,
  '00000000-0000-4000-8000-000000000180',current_date+1,
  '10:00','18:00','Synthetic flexible provider','+79990000113',
  null,null,null,null,'provider')::text,true);
select set_config('v178.provider_replay',public.book_flexible_appointment_v178(
  current_setting('v178.provider_request')::uuid,
  '00000000-0000-4000-8000-000000000180',current_date+1,
  '10:00','18:00','Synthetic flexible provider','+79990000113',
  null,null,null,null,'provider')::text,true);
reset role;

select pg_temp.v178_check(
  current_setting('v178.provider_result')::jsonb->>'booking_time'='13:00:00'
  and current_setting('v178.provider_result')::jsonb->>'booking_id'=
      current_setting('v178.provider_replay')::jsonb->>'booking_id'
  and (select count(*) from public.bookings
       where request_id=current_setting('v178.provider_request')::uuid)=1,
  'nearest_13_and_single_idempotent_booking');

do $conflict$
begin
  perform public.book_flexible_appointment_v178(
    current_setting('v178.provider_request')::uuid,
    '00000000-0000-4000-8000-000000000180',current_date+1,
    '10:00','17:00','Synthetic flexible provider','+79990000113',
    null,null,null,null,'provider');
  raise exception 'v178_synthetic:changed_range_was_accepted';
exception when unique_violation then
  if sqlerrm<>'request_conflict' then raise; end if;
end
$conflict$;

set local role anon;
select set_config('v178.public_result',public.book_flexible_appointment_v178(
  gen_random_uuid(),'00000000-0000-4000-8000-000000000180',current_date+1,
  '10:00','18:00','Synthetic flexible public','+79990000114',
  'v178-isolated','00000000-0000-4000-8000-000000000178',1000,60,'public')::text,true);
select set_config('v178.no_slot',public.book_flexible_appointment_v178(
  gen_random_uuid(),'00000000-0000-4000-8000-000000000180',current_date+1,
  '10:00','13:00','Synthetic flexible no slot','+79990000115',
  'v178-isolated','00000000-0000-4000-8000-000000000178',1000,60,'public')::text,true);
reset role;
select pg_temp.v178_check(
  current_setting('v178.public_result')::jsonb->>'booking_time'='14:00:00'
  and current_setting('v178.no_slot')::jsonb->>'result_code'='no_slot_in_range'
  and (select count(*) from public.bookings where booking_date=current_date+1)=5,
  'public_next_14_and_bounded_conflict');

-- A 90-minute service may not start at 13:00 if another appointment starts 14:00.
insert into public.services(id,performer_id,name,duration_minutes,price_rub,active)
values('00000000-0000-4000-8000-000000000182',
  '00000000-0000-4000-8000-000000000181','Synthetic 90-minute service',90,1500,true);
insert into public.test_slots_v178(service_id,booking_date,booking_time)
values
  ('00000000-0000-4000-8000-000000000180',current_date+2,'14:00'),
  ('00000000-0000-4000-8000-000000000182',current_date+2,'13:00'),
  ('00000000-0000-4000-8000-000000000182',current_date+2,'15:00');
select public.book_appointment(gen_random_uuid(),
  '00000000-0000-4000-8000-000000000180',current_date+2,'14:00',
  'Synthetic occupied overlap','+79990000116');
set local role anon;
select set_config('v178.duration_result',public.book_flexible_appointment_v178(
  gen_random_uuid(),'00000000-0000-4000-8000-000000000182',current_date+2,
  '13:00','15:00','Synthetic 90-minute client','+79990000117')::text,true);
reset role;
select pg_temp.v178_check(
  current_setting('v178.duration_result')::jsonb->>'booking_time'='15:00:00',
  'duration_overlap_skips_13');

update public.services set price_rub=1200
where id='00000000-0000-4000-8000-000000000180';
set local role anon;
select set_config('v178.terms_result',public.book_flexible_appointment_v178(
  gen_random_uuid(),'00000000-0000-4000-8000-000000000180',current_date+1,
  '15:00','18:00','Synthetic stale price client','+79990000118',
  'v178-isolated','00000000-0000-4000-8000-000000000178',1000,60,'public')::text,true);
reset role;
select pg_temp.v178_check(
  current_setting('v178.terms_result')::jsonb->>'result_code'='service_terms_changed'
  and (select count(*) from public.bookings where booking_date=current_date+1)=5,
  'stale_service_terms_create_nothing');
rollback;
