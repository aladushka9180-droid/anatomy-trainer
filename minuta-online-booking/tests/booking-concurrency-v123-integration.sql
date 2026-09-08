-- Runner wraps this file in one rolled-back transaction, after fixture.sql.
create function pg_temp.v123_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'v123_assert:%',label; end if; end $$;
create function pg_temp.v123_slots(p_time time,p_duration integer default 15) returns boolean language sql as $$
select exists(select 1 from public.get_provider_block_slots_v123(current_setting('v123.org')::uuid,current_setting('v123.loc')::uuid,
 current_setting('v123.service')::uuid,current_setting('v123.date')::date,p_duration) where booking_time=p_time) $$;
create function pg_temp.v123_create(p_time time,p_duration integer,p_request uuid) returns jsonb language sql as $$
select public.create_provider_block_v123(current_setting('v123.org')::uuid,current_setting('v123.loc')::uuid,
 current_setting('v123.service')::uuid,current_setting('v123.date')::date,p_time,p_duration,p_request,'Перерыв','') $$;
update public.provider_schedule set start_time='10:00',end_time='10:20' where performer_id=current_setting('v123.actor')::uuid;
set local role authenticated;
select pg_temp.v123_assert(pg_temp.v123_slots('10:00',15),'15_minute_gap');
select pg_temp.v123_assert(pg_temp.v123_slots('10:05',15),'exact_boundary');
select pg_temp.v123_assert(not pg_temp.v123_slots('10:06',15),'overrun');
select pg_temp.v123_assert(not pg_temp.v123_slots('10:00',60),'technical_service_does_not_fit');
reset role;
update public.provider_schedule set break_start='10:10',break_end='10:15' where performer_id=current_setting('v123.actor')::uuid;
set local role authenticated;
select pg_temp.v123_assert(not pg_temp.v123_slots('10:00'),'weekly_break');
reset role;
update public.provider_schedule set break_start=null,break_end=null where performer_id=current_setting('v123.actor')::uuid;
insert into public.provider_days_off(performer_id,off_date,all_day)
values(current_setting('v123.actor')::uuid,current_setting('v123.date')::date,true);
set local role authenticated;
select pg_temp.v123_assert(not pg_temp.v123_slots('10:00'),'day_off');
reset role;
delete from public.provider_days_off where performer_id=current_setting('v123.actor')::uuid;
insert into public.organization_shift_settings(organization_id,enabled) values(current_setting('v123.org')::uuid,true)
on conflict(organization_id) do update set enabled=true;
set local role authenticated;
select pg_temp.v123_assert(not pg_temp.v123_slots('10:00'),'missing_active_shift');
reset role;
insert into public.staff_location_shifts(organization_id,location_id,performer_id,shift_date,start_time,end_time)
values(current_setting('v123.org')::uuid,current_setting('v123.loc')::uuid,current_setting('v123.actor')::uuid,current_setting('v123.date')::date,'10:00','10:20');
set local role authenticated;
select pg_temp.v123_assert(pg_temp.v123_slots('10:00'),'active_shift');
reset role;
select set_config('v123.group',gen_random_uuid()::text,true);
insert into public.resource_groups(id,organization_id,kind,name) values(current_setting('v123.group')::uuid,current_setting('v123.org')::uuid,'room','V123 room');
insert into public.service_resource_requirements(organization_id,service_id,group_id,quantity)
values(current_setting('v123.org')::uuid,current_setting('v123.service')::uuid,current_setting('v123.group')::uuid,1);
set local role authenticated;
select pg_temp.v123_assert(not pg_temp.v123_slots('10:00'),'missing_resource');
reset role;
insert into public.resources(organization_id,location_id,group_id,name)
values(current_setting('v123.org')::uuid,current_setting('v123.loc')::uuid,current_setting('v123.group')::uuid,'V123 resource');
select set_config('v123.request',gen_random_uuid()::text,true);
set local role authenticated;
select pg_temp.v123_assert(pg_temp.v123_slots('10:00'),'free_resource');
select pg_temp.v123_create('10:00',15,current_setting('v123.request')::uuid);
select pg_temp.v123_assert((pg_temp.v123_create('10:00',15,current_setting('v123.request')::uuid)->>'replayed')::boolean,'lost_response_replay');
select pg_temp.v123_assert(not pg_temp.v123_slots('10:00'),'collision_after_create');
do $$ begin
 begin perform pg_temp.v123_create('10:00',10,current_setting('v123.request')::uuid); raise exception 'request_conflict_accepted';
 exception when unique_violation then if sqlerrm<>'block_request_conflict' then raise; end if; end;
 begin perform pg_temp.v123_create('10:05',15,gen_random_uuid()); raise exception 'overlap_accepted';
 exception when exclusion_violation then if sqlerrm<>'block_slot_unavailable' then raise; end if; end;
end $$;
reset role;
select pg_temp.v123_assert((select count(*)=1 from public.bookings where id=current_setting('v123.request')::uuid
 and duration_minutes=15 and service_id=current_setting('v123.service')::uuid and organization_id=current_setting('v123.org')::uuid
 and location_id=current_setting('v123.loc')::uuid and original_price_rub=0 and total_price_rub=0 and deposit_amount_rub=0
 and payment_status='not_required' and payment_url='' and payment_due_at is null and refund_status='not_required'
 and client_account_id is null and booking_policy_snapshot->>'schedule_block'='true'),'atomic_exact_block_payment_tenant');
select pg_temp.v123_assert(not exists(select 1 from public.notification_outbox where booking_id=current_setting('v123.request')::uuid),'no_outbox');
select pg_temp.v123_assert(not exists(select 1 from public.payments where booking_id=current_setting('v123.request')::uuid),'no_payment_rows');
select pg_temp.v123_assert(not exists(select 1 from public.booking_session_items where booking_id=current_setting('v123.request')::uuid),'no_service_charge_items');
select pg_temp.v123_assert((select count(*)=1 from public.booking_resource_allocations where booking_id=current_setting('v123.request')::uuid
 and ends_at-starts_at=interval '15 minutes'),'exact_resource_allocation');
-- Widen only this fixture's schedule and exercise independent restrictions.
update public.provider_schedule set start_time='09:00',end_time='18:00' where performer_id=current_setting('v123.actor')::uuid;
update public.staff_location_shifts set start_time='09:00',end_time='18:00' where performer_id=current_setting('v123.actor')::uuid;
select set_config('v123.buffer_booking',gen_random_uuid()::text,true);
set local role authenticated;
select pg_temp.v123_create('09:00',15,current_setting('v123.buffer_booking')::uuid);
reset role;
-- Synthetic non-client phone; UPDATE never invokes the INSERT HTTP transport.
update public.bookings set client_phone='0000000001' where id=current_setting('v123.buffer_booking')::uuid;
insert into public.booking_policies(performer_id,booking_buffer_enabled,booking_buffer_minutes)
values(current_setting('v123.actor')::uuid,true,10)
on conflict(performer_id) do update set booking_buffer_enabled=true,booking_buffer_minutes=10;
set local role authenticated;
select pg_temp.v123_assert(not pg_temp.v123_slots('09:15'),'client_booking_buffer');
select pg_temp.v123_assert(pg_temp.v123_slots('09:25'),'client_booking_buffer_boundary');
reset role;
insert into public.group_booking_events(organization_id,location_id,performer_id,title,event_date,start_time,duration_minutes,capacity,status)
values(current_setting('v123.org')::uuid,current_setting('v123.loc')::uuid,current_setting('v123.actor')::uuid,'V123 group',current_setting('v123.date')::date,'15:00',60,2,'published');
set local role authenticated;
select pg_temp.v123_assert(not pg_temp.v123_slots('15:00'),'group_event_overlap');
reset role;
update public.organization_memberships set is_bookable=false where organization_id=current_setting('v123.org')::uuid;
set local role authenticated;
select pg_temp.v123_assert(not pg_temp.v123_slots('16:00'),'non_bookable_actor');
reset role;
update public.organization_memberships set is_bookable=true where organization_id=current_setting('v123.org')::uuid;
update public.provider_schedule set enabled=false where performer_id=current_setting('v123.actor')::uuid;
set local role authenticated;
select pg_temp.v123_assert(not pg_temp.v123_slots('16:00'),'disabled_schedule');
reset role;
update public.provider_schedule set enabled=true where performer_id=current_setting('v123.actor')::uuid;
select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
set local role authenticated;
select pg_temp.v123_assert(not pg_temp.v123_slots('10:00'),'foreign_actor');
reset role;
select pg_temp.v123_assert(not has_function_privilege('anon','public.create_provider_block_v123(uuid,uuid,uuid,date,time,integer,uuid,text,text)','execute'),'anon_create_denied');
select pg_temp.v123_assert(not has_function_privilege('authenticated','public.minuta_block_slot_valid_v123(uuid,uuid,uuid,date,time,integer)','execute'),'private_helper_denied');
