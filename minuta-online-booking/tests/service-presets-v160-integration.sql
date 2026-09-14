\set ON_ERROR_STOP on
begin;
set local statement_timeout='90s';
set local lock_timeout='15s';
set local search_path=public,extensions,pg_catalog;

create function pg_temp.v160_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'v160_assert:%',label; end if; end $$;

do $fixture$
declare
  owner_id uuid:=gen_random_uuid();
  other_id uuid:=gen_random_uuid();
  zero_id uuid:=gen_random_uuid();
  existing_service uuid:=gen_random_uuid();
begin
  perform set_config('v160.owner',owner_id::text,true);
  perform set_config('v160.other',other_id::text,true);
  perform set_config('v160.zero',zero_id::text,true);
  perform set_config('v160.existing_service',existing_service::text,true);
  perform set_config('v160.owner_request',gen_random_uuid()::text,true);
  perform set_config('v160.other_request',gen_random_uuid()::text,true);
  perform set_config('v160.zero_request',gen_random_uuid()::text,true);
  set local session_replication_role=replica;
  insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
    (owner_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',owner_id::text||'@example.invalid',now(),'{}','{}',now(),now()),
    (other_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',other_id::text||'@example.invalid',now(),'{}','{}',now(),now()),
    (zero_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',zero_id::text||'@example.invalid',now(),'{}','{}',now(),now());
  set local session_replication_role=origin;
  insert into public.performer_profiles(id,display_name) values
    (owner_id,'V160 owner'),(other_id,'V160 other'),(zero_id,'V160 zero');
  insert into public.services(id,performer_id,name,duration_minutes,price_rub,active)
    values(existing_service,owner_id,E'  МАССАЖ\u00a0  ВСЕГО ТЕЛА  ',35,777,false);
end
$fixture$;

select pg_temp.v160_assert((select count(*)=12 from public.minuta_professions_v160 where catalog_version=1 and locale='ru-RU'),'catalog_professions');
select pg_temp.v160_assert((select count(*)=83 from public.minuta_service_presets_v160 where catalog_version=1 and locale='ru-RU'),'catalog_services');
select pg_temp.v160_assert(not has_table_privilege('authenticated','public.minuta_performer_professions_v160','SELECT,INSERT,UPDATE,DELETE'),'profession_table_private');
select pg_temp.v160_assert(not has_table_privilege('authenticated','public.minuta_service_preset_requests_v160','SELECT,INSERT,UPDATE,DELETE'),'request_table_private');
select pg_temp.v160_assert(has_function_privilege('authenticated','public.create_provider_services_from_presets_v160(uuid,integer,text[],jsonb)','EXECUTE'),'authenticated_rpc_open');
select pg_temp.v160_assert(not has_function_privilege('anon','public.create_provider_services_from_presets_v160(uuid,integer,text[],jsonb)','EXECUTE'),'anon_rpc_closed');
select pg_temp.v160_assert(not has_function_privilege('service_role','public.create_provider_services_from_presets_v160(uuid,integer,text[],jsonb)','EXECUTE'),'service_role_rpc_closed');

-- owner_batch_and_exact_replay
select set_config('request.jwt.claim.sub',current_setting('v160.owner'),true);
set local role authenticated;
select set_config('v160.owner_result',public.create_provider_services_from_presets_v160(
  current_setting('v160.owner_request')::uuid,1,array['nail_artist','massage_therapist'],jsonb_build_array(
    jsonb_build_object('item_id','preset-one','preset_id','massage_full_body','name','Массаж всего тела','duration_minutes',60,'price_rub',2500),
    jsonb_build_object('item_id','custom-one','preset_id',null,'name','Новая услуга','duration_minutes',45,'price_rub',900)
  ))::text,true);
reset role;
select pg_temp.v160_assert((current_setting('v160.owner_result')::jsonb->>'created_count')::integer=1,'owner_created_one');
select pg_temp.v160_assert((current_setting('v160.owner_result')::jsonb->>'existing_count')::integer=1,'owner_found_existing');
select pg_temp.v160_assert(current_setting('v160.owner_result')::jsonb->'services'->0->>'status'='already_exists','existing_status');
select pg_temp.v160_assert(current_setting('v160.owner_result')::jsonb->'services'->1->>'status'='created','created_status');
select pg_temp.v160_assert((select count(*)=2 from public.minuta_performer_professions_v160 where performer_id=current_setting('v160.owner')::uuid),'private_professions_saved');
select pg_temp.v160_assert((select name=E'  МАССАЖ\u00a0  ВСЕГО ТЕЛА  ' and duration_minutes=35 and price_rub=777 and not active
  from public.services where id=current_setting('v160.existing_service')::uuid),'existing_service_unchanged');

set local role authenticated;
select set_config('v160.replay_result',public.create_provider_services_from_presets_v160(
  current_setting('v160.owner_request')::uuid,1,array['nail_artist','massage_therapist'],jsonb_build_array(
    jsonb_build_object('item_id','preset-one','preset_id','massage_full_body','name','Массаж всего тела','duration_minutes',60,'price_rub',2500),
    jsonb_build_object('item_id','custom-one','preset_id',null,'name','Новая услуга','duration_minutes',45,'price_rub',900)
  ))::text,true);
reset role;
select pg_temp.v160_assert((current_setting('v160.replay_result')::jsonb->>'replayed')::boolean,'exact_replay');
select pg_temp.v160_assert((select count(*)=2 from public.services where performer_id=current_setting('v160.owner')::uuid),'replay_no_duplicate');

-- changed_request_conflict
set local role authenticated;
do $$ begin
  begin
    perform public.create_provider_services_from_presets_v160(
      current_setting('v160.owner_request')::uuid,1,array['massage_therapist','nail_artist'],jsonb_build_array(
        jsonb_build_object('item_id','preset-one','preset_id','massage_full_body','name','Массаж всего тела','duration_minutes',60,'price_rub',2600),
        jsonb_build_object('item_id','custom-one','preset_id',null,'name','Новая услуга','duration_minutes',45,'price_rub',900)
      ));
    raise exception 'changed_request_was_accepted';
  exception when unique_violation then
    if position('service_preset_request_conflict' in sqlerrm)=0 then raise; end if;
  end;
end $$;
reset role;

-- cross_owner_isolation
select set_config('request.jwt.claim.sub',current_setting('v160.other'),true);
set local role authenticated;
select set_config('v160.other_result',public.create_provider_services_from_presets_v160(
  current_setting('v160.other_request')::uuid,1,array['massage_therapist'],jsonb_build_array(
    jsonb_build_object('item_id','other-preset','preset_id','massage_full_body','name','Массаж всего тела','duration_minutes',60,'price_rub',3100)
  ))::text,true);
reset role;
select pg_temp.v160_assert((current_setting('v160.other_result')::jsonb->>'created_count')::integer=1,'cross_owner_same_name_allowed');
select pg_temp.v160_assert((select count(*)=1 from public.services where performer_id=current_setting('v160.other')::uuid),'cross_owner_only_own_row');

select set_config('request.jwt.claim.sub',current_setting('v160.owner'),true);

-- forged_preset_rejected
set local role authenticated;
do $$ begin
  begin
    perform public.create_provider_services_from_presets_v160(gen_random_uuid(),1,array['massage_therapist'],jsonb_build_array(
      jsonb_build_object('item_id','forged','preset_id','forged_private_preset','name','Поддельная услуга','duration_minutes',60,'price_rub',1000)
    ));
    raise exception 'forged_preset_was_accepted';
  exception when invalid_parameter_value then
    if position('invalid_service_preset' in sqlerrm)=0 then raise; end if;
  end;
end $$;
reset role;

-- wrong_profession_rejected
set local role authenticated;
do $$ begin
  begin
    perform public.create_provider_services_from_presets_v160(gen_random_uuid(),1,array['nail_artist'],jsonb_build_array(
      jsonb_build_object('item_id','wrong-profession','preset_id','massage_sports','name','Спортивный массаж','duration_minutes',60,'price_rub',1000)
    ));
    raise exception 'wrong_profession_was_accepted';
  exception when invalid_parameter_value then
    if position('invalid_service_preset' in sqlerrm)=0 then raise; end if;
  end;
end $$;
reset role;

-- duplicate_input_rejected
set local role authenticated;
do $$ begin
  begin
    perform public.create_provider_services_from_presets_v160(gen_random_uuid(),1,array['massage_therapist'],jsonb_build_array(
      jsonb_build_object('item_id','duplicate-a','preset_id',null,'name','Дубли','duration_minutes',30,'price_rub',100),
      jsonb_build_object('item_id','duplicate-b','preset_id',null,'name','  ДУБЛИ  ','duration_minutes',45,'price_rub',200)
    ));
    raise exception 'duplicate_input_was_accepted';
  exception when invalid_parameter_value then
    if position('duplicate_service_name' in sqlerrm)=0 then raise; end if;
  end;
end $$;
reset role;

-- direct_duplicate_rejected
do $$ begin
  begin
    insert into public.services(id,performer_id,name,duration_minutes,price_rub,active)
      values(gen_random_uuid(),current_setting('v160.owner')::uuid,'  НОВАЯ   УСЛУГА ',60,1,true);
    raise exception 'direct_duplicate_was_accepted';
  exception when unique_violation then
    if position('duplicate_service_name' in sqlerrm)=0 then raise; end if;
  end;
end $$;

-- partial_failure_rollback
select set_config('v160.before_partial',(select count(*)::text from public.services where performer_id=current_setting('v160.owner')::uuid),true);
select set_config('v160.before_professions',(select count(*)::text from public.minuta_performer_professions_v160 where performer_id=current_setting('v160.owner')::uuid),true);
create function pg_temp.v160_fail_second_insert() returns trigger language plpgsql as $$
begin
  if new.name='Вторая падает' then raise exception 'v160_forced_second_insert_failure'; end if;
  return new;
end $$;
create trigger v160_fail_second_insert before insert on public.services
for each row execute function pg_temp.v160_fail_second_insert();
set local role authenticated;
do $$ begin
  begin
    perform public.create_provider_services_from_presets_v160(gen_random_uuid(),1,array['massage_therapist'],jsonb_build_array(
      jsonb_build_object('item_id','valid-first','preset_id',null,'name','Не должна сохраниться','duration_minutes',30,'price_rub',100),
      jsonb_build_object('item_id','forced-second','preset_id',null,'name','Вторая падает','duration_minutes',30,'price_rub',200)
    ));
    raise exception 'partial_failure_was_accepted';
  exception when raise_exception then
    if position('v160_forced_second_insert_failure' in sqlerrm)=0 then raise; end if;
  end;
end $$;
reset role;
drop trigger v160_fail_second_insert on public.services;
select pg_temp.v160_assert((select count(*)=current_setting('v160.before_partial')::integer
  from public.services where performer_id=current_setting('v160.owner')::uuid),'partial_failure_rollback');
select pg_temp.v160_assert((select count(*)=current_setting('v160.before_professions')::integer
  from public.minuta_performer_professions_v160 where performer_id=current_setting('v160.owner')::uuid),'partial_profession_rollback');

-- zero_items_allowed
select set_config('request.jwt.claim.sub',current_setting('v160.zero'),true);
set local role authenticated;
select set_config('v160.zero_result',public.create_provider_services_from_presets_v160(
  current_setting('v160.zero_request')::uuid,1,array['fitness_yoga_coach'],'[]'::jsonb
  )::text,true);
select set_config('v160.zero_state',public.get_provider_service_preset_state_v160()::text,true);
reset role;
select pg_temp.v160_assert((current_setting('v160.zero_result')::jsonb->>'created_count')::integer=0,'zero_items_created_none');
select pg_temp.v160_assert(current_setting('v160.zero_state')::jsonb->'profession_ids'=jsonb_build_array('fitness_yoga_coach'),'zero_items_profession_saved');

-- owner auth and safe catalog exposure
select set_config('request.jwt.claim.sub','',true);
set local role authenticated;
do $$ begin
  begin
    perform public.create_provider_services_from_presets_v160(gen_random_uuid(),1,'{}'::text[],'[]'::jsonb);
    raise exception 'anonymous_identity_was_accepted';
  exception when insufficient_privilege then null;
  end;
end $$;
select pg_temp.v160_assert((select count(*)=83 from public.get_provider_service_preset_catalog_v160(1)),'catalog_rpc_complete');
reset role;

rollback;
