-- TEST DATABASE ONLY. Runner supplies an isolated database and a rollback/reapply cycle.
create function pg_temp.client_profile_assert(ok boolean,message text) returns void
language plpgsql as $$ begin if ok is distinct from true then raise exception '%',message; end if; end $$;

do $$
declare actor uuid; specialist uuid; org uuid; batch uuid;
begin
  select id into actor from auth.users order by created_at,id limit 1;
  perform pg_temp.client_profile_assert(actor is not null,'client_profile_fixture_user_missing');
  select id into specialist from auth.users where id<>actor order by created_at,id limit 1;
  perform pg_temp.client_profile_assert(specialist is not null,'client_profile_second_fixture_user_missing');
  insert into public.organizations(name,public_booking_enabled,status)
    values('Client profile v119 test',true,'active') returning id into org;
  insert into public.organization_memberships(organization_id,user_id,role,is_bookable,active)
    values(org,actor,'owner',true,true);
  insert into public.organization_memberships(organization_id,user_id,role,is_bookable,active)
    values(org,specialist,'specialist',true,true);
  insert into public.client_import_batches(
    organization_id,request_id,source_system,payload_hash,input_count,created_count,updated_count,actor_id
  ) values(org,gen_random_uuid(),'other',repeat('0',64),1,1,0,actor) returning id into batch;
  insert into public.organization_imported_clients(
    organization_id,normalized_phone,display_phone,client_name,source_system,
    imported_visit_count,imported_total_spent_rub,last_import_batch_id
  ) values(org,'79990001122','+7 999 000-11-22','Client profile test','other',0,0,batch);
  perform set_config('client_profile.actor',actor::text,true);
  perform set_config('client_profile.specialist',specialist::text,true);
  perform set_config('client_profile.org',org::text,true);
end $$;

select set_config('request.jwt.claim.sub',current_setting('client_profile.actor'),true);
set local role authenticated;
select pg_temp.client_profile_assert(
  (public.save_minuta_client_birthday_v119(current_setting('client_profile.org')::uuid,'+7 999 000-11-22',date '1990-04-12')->>'birthday')='1990-04-12',
  'birthday_save_failed'
);
select pg_temp.client_profile_assert(
  (public.set_minuta_client_online_booking_block_v119(current_setting('client_profile.org')::uuid,'89990001122',true)->>'online_booking_blocked')::boolean,
  'owner_block_failed'
);
select pg_temp.client_profile_assert(
  (public.get_minuta_client_profile_v119(current_setting('client_profile.org')::uuid,'79990001122')->>'can_manage_block')::boolean,
  'owner_capability_missing'
);
select pg_temp.client_profile_assert(
  exists(select 1 from pg_trigger where tgname='zy_bookings_client_online_block_v119' and tgenabled='O'),
  'booking_block_trigger_missing'
);
reset role;

select set_config('request.jwt.claim.sub',current_setting('client_profile.specialist'),true);
set local role authenticated;
select pg_temp.client_profile_assert(
  not (public.get_minuta_client_profile_v119(current_setting('client_profile.org')::uuid,'79990001122')->>'can_manage_block')::boolean,
  'specialist_received_block_capability'
);
do $$ begin
  perform public.set_minuta_client_online_booking_block_v119(current_setting('client_profile.org')::uuid,'79990001122',false);
  raise exception 'specialist_block_allowed';
exception when insufficient_privilege then
  perform pg_temp.client_profile_assert(sqlerrm='organization_manager_required','wrong_specialist_block_error');
end $$;
reset role;

select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
set local role authenticated;
do $$ begin
  perform public.get_minuta_client_profile_v119(current_setting('client_profile.org')::uuid,'79990001122');
  raise exception 'outsider_read_allowed';
exception when insufficient_privilege then
  perform pg_temp.client_profile_assert(sqlerrm='organization_read_denied','wrong_outsider_read_error');
end $$;
reset role;

-- A safe rollback may proceed only after active online blocks are cleared.
update public.organization_client_profiles set online_booking_blocked=false,
  online_booking_blocked_at=null,online_booking_blocked_by=null
where organization_id=current_setting('client_profile.org')::uuid;

create function pg_temp.check_client_profile_v119_rollback() returns void language plpgsql as $$ begin
  perform pg_temp.client_profile_assert(to_regprocedure('public.get_minuta_client_profile_v119(uuid,text)') is null,'rollback_left_read_rpc');
  perform pg_temp.client_profile_assert(not exists(select 1 from pg_trigger where tgname='zy_bookings_client_online_block_v119'),'rollback_left_trigger');
  perform pg_temp.client_profile_assert((select birthday=date '1990-04-12' from public.organization_client_profiles where organization_id=current_setting('client_profile.org')::uuid and normalized_phone='79990001122'),'rollback_lost_birthday');
end $$;

create function pg_temp.check_client_profile_v119_reapply() returns void language plpgsql as $$ begin
  perform pg_temp.client_profile_assert(to_regprocedure('public.get_minuta_client_profile_v119(uuid,text)') is not null,'reapply_missing_read_rpc');
  perform pg_temp.client_profile_assert(exists(select 1 from pg_trigger where tgname='zy_bookings_client_online_block_v119'),'reapply_missing_trigger');
  perform pg_temp.client_profile_assert((select birthday=date '1990-04-12' from public.organization_client_profiles where organization_id=current_setting('client_profile.org')::uuid and normalized_phone='79990001122'),'reapply_lost_birthday');
end $$;
