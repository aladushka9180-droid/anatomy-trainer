-- TEST DATABASE ONLY. Runner supplies an isolated database and wraps the cycle in ROLLBACK.
create function pg_temp.client_identity_assert(ok boolean,message text) returns void
language plpgsql as $$ begin if ok is distinct from true then raise exception '%',message; end if; end $$;

do $$
declare actor uuid; outsider uuid; org uuid; batch uuid; definition uuid:=gen_random_uuid(); record_id uuid:=gen_random_uuid(); result_id uuid:=gen_random_uuid();
begin
  select id into actor from auth.users order by created_at,id limit 1;
  select id into outsider from auth.users where id<>actor order by created_at,id limit 1;
  perform pg_temp.client_identity_assert(actor is not null,'client_identity_fixture_user_missing');
  perform pg_temp.client_identity_assert(outsider is not null,'client_identity_second_fixture_user_missing');
  insert into public.performer_profiles(id,display_name)
    values(actor,'Client identity v134 fixture') on conflict(id) do nothing;
  insert into public.organizations(name,public_booking_enabled,status)
    values('Client identity v134 test',true,'active') returning id into org;
  insert into public.organization_memberships(organization_id,user_id,role,is_bookable,active)
    values(org,actor,'owner',true,true);
  insert into public.client_import_batches(
    organization_id,request_id,source_system,payload_hash,input_count,created_count,updated_count,actor_id
  ) values(org,gen_random_uuid(),'other',repeat('1',64),2,2,0,actor) returning id into batch;
  insert into public.organization_imported_clients(
    organization_id,normalized_phone,display_phone,client_name,source_system,
    imported_visit_count,imported_total_spent_rub,last_import_batch_id
  ) values(org,'79990001122','+7 999 000-11-22','Старое имя','other',2,3000,batch);
  insert into public.organization_client_profiles(
    organization_id,normalized_phone,birthday,birthday_overridden,updated_by
  ) values(org,'79990001122',date '1990-04-12',true,actor);
  insert into public.client_field_definitions(id,organization_id,field_key,label,field_type,created_by)
    values(definition,org,'identity_test','Тестовое поле','text',actor);
  insert into public.client_field_values(organization_id,definition_id,client_phone,value_json,updated_by)
    values(org,definition,'79990001122','"value"'::jsonb,actor);
  insert into public.client_record_entries(
    id,organization_id,client_phone,booking_was_linked,booking_performer_id,visit_label,kind,body,ready,created_by
  ) values(record_id,org,'79990001122',false,actor,'Тестовый визит','note','Закрытая заметка',true,actor);
  insert into public.client_result_series(
    id,organization_id,client_phone,booking_was_linked,booking_performer_id,visit_label,service_label,
    created_by,updated_by,last_request_by,last_request_id
  ) values(result_id,org,'79990001122',false,actor,'Тестовый визит','Тестовая услуга',actor,actor,actor,gen_random_uuid());
  insert into public.client_labels(performer_id,client_phone,favorite)
    values(actor,'79990001122',true);
  insert into public.client_notes(performer_id,client_phone,note)
    values(actor,'79990001122','Важная заметка');
  perform set_config('client_identity.actor',actor::text,true);
  perform set_config('client_identity.outsider',outsider::text,true);
  perform set_config('client_identity.org',org::text,true);
  perform set_config('client_identity.batch',batch::text,true);
end $$;

select set_config('request.jwt.claim.sub',current_setting('client_identity.actor'),true);
set local role authenticated;
select pg_temp.client_identity_assert(
  (public.save_minuta_client_identity_v134(current_setting('client_identity.org')::uuid,'79990001122',' Новое   имя ','79990001122')->>'client_name')='Новое имя',
  'client_name_update_failed'
);
select pg_temp.client_identity_assert(
  (public.save_minuta_client_identity_v134(current_setting('client_identity.org')::uuid,'79990001122','Новое имя','89990003344')->>'client_phone')='79990003344',
  'client_phone_update_failed'
);
reset role;

select pg_temp.client_identity_assert(exists(select 1 from public.organization_imported_clients where organization_id=current_setting('client_identity.org')::uuid and normalized_phone='79990003344' and display_phone='79990003344' and client_name='Новое имя'),'imported_client_not_moved');
select pg_temp.client_identity_assert(exists(select 1 from public.organization_client_profiles where organization_id=current_setting('client_identity.org')::uuid and normalized_phone='79990003344' and birthday=date '1990-04-12'),'profile_not_moved');
select pg_temp.client_identity_assert(exists(select 1 from public.client_field_values where organization_id=current_setting('client_identity.org')::uuid and client_phone='79990003344'),'field_values_not_moved');
select pg_temp.client_identity_assert(exists(select 1 from public.client_record_entries where organization_id=current_setting('client_identity.org')::uuid and client_phone='79990003344'),'record_not_moved');
select pg_temp.client_identity_assert(exists(select 1 from public.client_result_series where organization_id=current_setting('client_identity.org')::uuid and client_phone='79990003344'),'result_not_moved');
select pg_temp.client_identity_assert(exists(select 1 from public.client_labels where performer_id=current_setting('client_identity.actor')::uuid and client_phone='79990003344' and favorite),'labels_not_moved');
select pg_temp.client_identity_assert(exists(select 1 from public.client_notes where performer_id=current_setting('client_identity.actor')::uuid and client_phone='79990003344' and note='Важная заметка'),'note_not_moved');
select pg_temp.client_identity_assert(not exists(select 1 from public.organization_imported_clients where organization_id=current_setting('client_identity.org')::uuid and normalized_phone='79990001122'),'old_client_identity_left');

insert into public.organization_imported_clients(
  organization_id,normalized_phone,display_phone,client_name,source_system,
  imported_visit_count,imported_total_spent_rub,last_import_batch_id
) values(current_setting('client_identity.org')::uuid,'79990005566','79990005566','Другой клиент','other',0,0,current_setting('client_identity.batch')::uuid);

select set_config('request.jwt.claim.sub',current_setting('client_identity.actor'),true);
set local role authenticated;
do $$ begin
  perform public.save_minuta_client_identity_v134(current_setting('client_identity.org')::uuid,'79990003344','Новое имя','79990005566');
  raise exception 'client_phone_conflict_not_rejected';
exception when unique_violation then
  perform pg_temp.client_identity_assert(sqlerrm='client_phone_conflict','wrong_client_phone_conflict');
end $$;
reset role;

select set_config('request.jwt.claim.sub',current_setting('client_identity.outsider'),true);
set local role authenticated;
do $$ begin
  perform public.save_minuta_client_identity_v134(current_setting('client_identity.org')::uuid,'79990003344','Чужая правка','79990003344');
  raise exception 'outsider_identity_write_allowed';
exception when insufficient_privilege then
  perform pg_temp.client_identity_assert(sqlerrm='organization_write_denied','wrong_outsider_identity_error');
end $$;
reset role;

create function pg_temp.check_client_profile_v134_rollback() returns void language plpgsql as $$ begin
  perform pg_temp.client_identity_assert(to_regprocedure('public.save_minuta_client_identity_v134(uuid,text,text,text)') is null,'rollback_left_identity_rpc');
  perform pg_temp.client_identity_assert(exists(select 1 from public.organization_imported_clients where organization_id=current_setting('client_identity.org')::uuid and normalized_phone='79990003344'),'rollback_lost_client_data');
end $$;

create function pg_temp.check_client_profile_v134_reapply() returns void language plpgsql as $$ begin
  perform pg_temp.client_identity_assert(to_regprocedure('public.save_minuta_client_identity_v134(uuid,text,text,text)') is not null,'reapply_missing_identity_rpc');
  perform pg_temp.client_identity_assert(exists(select 1 from public.organization_client_profiles where organization_id=current_setting('client_identity.org')::uuid and normalized_phone='79990003344'),'reapply_lost_profile_data');
end $$;
