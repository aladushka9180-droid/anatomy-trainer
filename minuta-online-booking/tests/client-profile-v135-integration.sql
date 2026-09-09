-- TEST DATABASE ONLY. Runner supplies an isolated database and a rollback/reapply cycle.
create function pg_temp.client_profile_v135_assert(ok boolean,message text) returns void
language plpgsql as $$ begin if ok is distinct from true then raise exception '%',message; end if; end $$;

do $$
declare actor uuid; specialist uuid; org uuid; batch uuid;
begin
  select id into actor from auth.users order by created_at,id limit 1;
  select id into specialist from auth.users where id<>actor order by created_at,id limit 1;
  perform pg_temp.client_profile_v135_assert(actor is not null and specialist is not null,'client_profile_v135_fixture_users_missing');
  insert into public.organizations(name,public_booking_enabled,status)
    values('Client profile v135 test',true,'active') returning id into org;
  insert into public.organization_memberships(organization_id,user_id,role,is_bookable,active)
    values(org,actor,'owner',true,true),(org,specialist,'specialist',true,true);
  insert into public.client_import_batches(
    organization_id,request_id,source_system,payload_hash,input_count,created_count,updated_count,actor_id
  ) values(org,gen_random_uuid(),'other',repeat('1',64),1,1,0,actor) returning id into batch;
  insert into public.organization_imported_clients(
    organization_id,normalized_phone,display_phone,client_name,source_system,
    imported_visit_count,imported_total_spent_rub,last_import_batch_id
  ) values(org,'79990003344','+7 999 000-33-44','Client profile v135','other',0,0,batch);
  perform set_config('client_profile_v135.actor',actor::text,true);
  perform set_config('client_profile_v135.specialist',specialist::text,true);
  perform set_config('client_profile_v135.org',org::text,true);
end $$;

select set_config('request.jwt.claim.sub',current_setting('client_profile_v135.actor'),true);
set local role authenticated;
select pg_temp.client_profile_v135_assert(
  (public.set_minuta_client_online_booking_block_v135(
    current_setting('client_profile_v135.org')::uuid,'89990003344',true,'  Частые отмены  '
  )->>'online_booking_block_reason')='Частые отмены',
  'block_reason_was_not_trimmed_and_saved'
);
select pg_temp.client_profile_v135_assert(
  (public.get_minuta_client_profile_v135(
    current_setting('client_profile_v135.org')::uuid,'79990003344'
  )->>'online_booking_block_reason')='Частые отмены',
  'block_reason_was_not_returned'
);
select pg_temp.client_profile_v135_assert(
  (public.get_minuta_client_profile_v135(
    current_setting('client_profile_v135.org')::uuid,'79990003344'
  )->>'supports_block_reason')::boolean,
  'block_reason_capability_missing'
);
do $$ begin
  perform public.set_minuta_client_online_booking_block_v135(
    current_setting('client_profile_v135.org')::uuid,'79990003344',true,repeat('x',501));
  raise exception 'overlong_block_reason_allowed';
exception when invalid_parameter_value then
  perform pg_temp.client_profile_v135_assert(sqlerrm='client_block_reason_too_long','wrong_overlong_reason_error');
end $$;
reset role;

select set_config('request.jwt.claim.sub',current_setting('client_profile_v135.specialist'),true);
set local role authenticated;
select pg_temp.client_profile_v135_assert(
  public.get_minuta_client_profile_v135(
    current_setting('client_profile_v135.org')::uuid,'79990003344'
  )->>'online_booking_block_reason' is null,
  'specialist_received_private_block_reason'
);
do $$ begin
  perform public.set_minuta_client_online_booking_block_v135(
    current_setting('client_profile_v135.org')::uuid,'79990003344',true,'Denied');
  raise exception 'specialist_block_allowed';
exception when insufficient_privilege then
  perform pg_temp.client_profile_v135_assert(sqlerrm='organization_manager_required','wrong_specialist_block_error');
end $$;
reset role;

select set_config('request.jwt.claim.sub',current_setting('client_profile_v135.actor'),true);
set local role authenticated;
select pg_temp.client_profile_v135_assert(
  not (public.set_minuta_client_online_booking_block_v135(
    current_setting('client_profile_v135.org')::uuid,'79990003344',false,null
  )->>'online_booking_blocked')::boolean,
  'unblock_failed'
);
select pg_temp.client_profile_v135_assert(
  public.get_minuta_client_profile_v135(
    current_setting('client_profile_v135.org')::uuid,'79990003344'
  )->>'online_booking_block_reason' is null,
  'unblock_did_not_clear_reason'
);
reset role;

create function pg_temp.check_client_profile_v135_rollback() returns void language plpgsql as $$ begin
  perform pg_temp.client_profile_v135_assert(to_regprocedure('public.get_minuta_client_profile_v135(uuid,text)') is null,'rollback_left_v135_read_rpc');
  perform pg_temp.client_profile_v135_assert(not exists(select 1 from information_schema.columns where table_schema='public' and table_name='organization_client_profiles' and column_name='online_booking_block_reason'),'rollback_left_reason_column');
end $$;

create function pg_temp.check_client_profile_v135_reapply() returns void language plpgsql as $$ begin
  perform pg_temp.client_profile_v135_assert(to_regprocedure('public.get_minuta_client_profile_v135(uuid,text)') is not null,'reapply_missing_v135_read_rpc');
  perform pg_temp.client_profile_v135_assert(exists(select 1 from information_schema.columns where table_schema='public' and table_name='organization_client_profiles' and column_name='online_booking_block_reason'),'reapply_missing_reason_column');
end $$;
