-- ISOLATED TEST DATABASE ONLY. Caller owns transaction and cleanup.
select set_config('v123.actor',gen_random_uuid()::text,false);
select set_config('v123.org',gen_random_uuid()::text,false);
select set_config('v123.loc',gen_random_uuid()::text,false);
select set_config('v123.service',gen_random_uuid()::text,false);
select set_config('v123.date',(current_date+30)::text,false);
-- Avoid Auth signup hooks in synthetic test setup only. Product triggers below
-- run normally; migration/RPC never changes session_replication_role.
set local session_replication_role=replica;
insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values(current_setting('v123.actor')::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
 current_setting('v123.actor')||'@example.invalid',now(),'{}','{}',now(),now());
set local session_replication_role=origin;
insert into public.performer_profiles(id,display_name) values(current_setting('v123.actor')::uuid,'V123 isolated fixture');
insert into public.organizations(id,name,created_by) values(current_setting('v123.org')::uuid,'V123 isolated fixture',current_setting('v123.actor')::uuid);
insert into public.locations(id,organization_id,name,timezone,is_primary)
values(current_setting('v123.loc')::uuid,current_setting('v123.org')::uuid,'V123 branch','Europe/Samara',true);
insert into public.organization_memberships(organization_id,user_id,role,is_bookable,active)
values(current_setting('v123.org')::uuid,current_setting('v123.actor')::uuid,'owner',true,true);
insert into public.services(id,performer_id,name,duration_minutes,price_rub,active)
values(current_setting('v123.service')::uuid,current_setting('v123.actor')::uuid,'V123 sixty minute technical reference',60,1000,true);
insert into public.provider_schedule(performer_id,weekday,enabled,start_time,end_time,slot_interval_minutes)
select current_setting('v123.actor')::uuid,day,true,'09:00','18:00',15 from generate_series(1,7) day
on conflict(performer_id,weekday) do update set enabled=true,start_time='09:00',end_time='18:00',break_start=null,break_end=null;
insert into public.organization_booking_policy_settings(organization_id,enabled)
values(current_setting('v123.org')::uuid,true) on conflict(organization_id) do update set enabled=true;
insert into public.organization_booking_policy_rules(organization_id,deposit_mode,deposit_value,payment_url_template,auto_cancel_unpaid)
values(current_setting('v123.org')::uuid,'fixed',500,'https://example.invalid/{code}/{amount}',true);
select set_config('request.jwt.claim.sub',current_setting('v123.actor'),false);
