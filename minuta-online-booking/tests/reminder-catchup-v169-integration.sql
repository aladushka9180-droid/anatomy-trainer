\set ON_ERROR_STOP on

-- ISOLATED TEST DATABASE ONLY. All synthetic rows are rolled back.
begin;
set local statement_timeout='90s';
set local lock_timeout='15s';
set local search_path=public,extensions,pg_catalog;

create function pg_temp.v169_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'v169_assert:%',label; end if; end $$;
create table pg_temp.v169_fixture(
  organization_id uuid,location_id uuid,performer_id uuid,service_id uuid,
  first_due uuid,second_due uuid,too_early uuid,past_visit uuid,cancelled_visit uuid
) on commit drop;

do $fixture$
declare
  organization_id uuid:=gen_random_uuid(); location_id uuid:=gen_random_uuid(); performer_id uuid:=gen_random_uuid(); service_id uuid:=gen_random_uuid();
  first_due uuid:=gen_random_uuid(); second_due uuid:=gen_random_uuid(); too_early uuid:=gen_random_uuid();
  past_visit uuid:=gen_random_uuid(); cancelled_visit uuid:=gen_random_uuid();
  local_now timestamp:=(now() at time zone 'Europe/Samara');
begin
  insert into pg_temp.v169_fixture values(
    organization_id,location_id,performer_id,service_id,first_due,second_due,too_early,past_visit,cancelled_visit
  );
  set local session_replication_role=replica;
  insert into public.performer_profiles(id,display_name) values(performer_id,'V169 synthetic provider');
  insert into public.organizations(id,name,public_slug,status,public_booking_enabled,created_by)
  values(organization_id,'V169 synthetic organization','v169-'||replace(organization_id::text,'-',''),'active',false,performer_id);
  insert into public.locations(id,organization_id,name,timezone,address,active,is_primary)
  values(location_id,organization_id,'V169 synthetic location','Europe/Samara','Synthetic address',true,true);
  insert into public.services(id,performer_id,name,duration_minutes,price_rub,active)
  values(service_id,performer_id,'V169 synthetic service',60,1000,true);
  insert into public.organization_notification_settings(
    organization_id,enabled,booking_reminder_enabled,reminder_minutes_before
  ) values(organization_id,true,true,1440);
  insert into public.organization_notification_channels(organization_id,audience,channel,enabled) values
    (organization_id,'client','sms',true),(organization_id,'provider','email',true);
  insert into public.bookings(
    id,booking_code,manage_token,organization_id,location_id,performer_id,service_id,
    client_name,client_phone,booking_date,booking_time,duration_minutes,
    original_price_rub,total_price_rub,status
  ) values
    (first_due,'V169-FIRST',gen_random_uuid(),organization_id,location_id,performer_id,service_id,'V169 client','79990000001',(local_now+interval '30 minutes')::date,(local_now+interval '30 minutes')::time,60,1000,1000,'confirmed'),
    (second_due,'V169-SECOND',gen_random_uuid(),organization_id,location_id,performer_id,service_id,'V169 client','79990000002',(local_now+interval '45 minutes')::date,(local_now+interval '45 minutes')::time,60,1000,1000,'confirmed'),
    (too_early,'V169-EARLY',gen_random_uuid(),organization_id,location_id,performer_id,service_id,'V169 client','79990000003',(local_now+interval '1471 minutes')::date,(local_now+interval '1471 minutes')::time,60,1000,1000,'confirmed'),
    (past_visit,'V169-PAST',gen_random_uuid(),organization_id,location_id,performer_id,service_id,'V169 client','79990000004',(local_now-interval '1 minute')::date,(local_now-interval '1 minute')::time,60,1000,1000,'confirmed'),
    (cancelled_visit,'V169-CANCEL',gen_random_uuid(),organization_id,location_id,performer_id,service_id,'V169 client','79990000005',(local_now+interval '20 minutes')::date,(local_now+interval '20 minutes')::time,60,1000,1000,'cancelled');
  set local session_replication_role=origin;
end
$fixture$;

select set_config('request.jwt.claim.role','service_role',true);
select pg_temp.v169_assert(public.enqueue_due_minuta_booking_reminders(1)=2,'first_due_two_channels');
select pg_temp.v169_assert(public.enqueue_due_minuta_booking_reminders(1)=2,'second_due_not_starved_by_existing_keys');
select pg_temp.v169_assert(public.enqueue_due_minuta_booking_reminders(1)=0,'retry_is_idempotent');
select pg_temp.v169_assert((select count(*)=4 from public.notification_outbox queue
  join pg_temp.v169_fixture fixture on queue.booking_id in(fixture.first_due,fixture.second_due)
  where queue.kind='booking_reminder'),'exactly_one_event_per_enabled_channel');
select pg_temp.v169_assert(not exists(select 1 from public.notification_outbox queue
  join pg_temp.v169_fixture fixture on queue.booking_id in(fixture.too_early,fixture.past_visit,fixture.cancelled_visit)
  where queue.kind='booking_reminder'),'future_window_past_and_cancelled_excluded');

update public.bookings booking set
  booking_date=((now() at time zone 'Europe/Samara')+interval '90 minutes')::date,
  booking_time=((now() at time zone 'Europe/Samara')+interval '90 minutes')::time
from pg_temp.v169_fixture fixture where booking.id=fixture.first_due;
select pg_temp.v169_assert(public.enqueue_due_minuta_booking_reminders(1)=2,'reschedule_gets_new_deduplicated_keys');
select pg_temp.v169_assert(public.enqueue_due_minuta_booking_reminders(1)=0,'reschedule_retry_is_idempotent');

select set_config('request.jwt.claim.role','authenticated',true);
do $denied$
begin
  perform public.enqueue_due_minuta_booking_reminders(1);
  raise exception 'v169_expected_service_role_required';
exception when insufficient_privilege then
  if sqlerrm<>'service_role_required' then raise; end if;
end
$denied$;

rollback;
