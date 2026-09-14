\set ON_ERROR_STOP on
begin;
set local statement_timeout='90s';
set local lock_timeout='15s';
set local search_path=public,extensions,pg_catalog;

create function pg_temp.v159_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'v159_assert:%',label; end if; end $$;

do $fixture$
declare
  owner_id uuid:=gen_random_uuid(); other_id uuid:=gen_random_uuid(); organization_id uuid:=gen_random_uuid(); location_id uuid:=gen_random_uuid();
  service_id uuid:=gen_random_uuid(); empty_service_id uuid:=gen_random_uuid(); client_id uuid:=gen_random_uuid();
  booking_ids uuid[]:=array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  phone text:='79'||translate(substr(md5(owner_id::text),1,9),'abcdef','012345');
begin
  perform set_config('v159.owner',owner_id::text,true); perform set_config('v159.other',other_id::text,true);
  perform set_config('v159.service',service_id::text,true); perform set_config('v159.empty_service',empty_service_id::text,true);
  set local session_replication_role=replica;
  insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
    (owner_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',owner_id::text||'@example.invalid',now(),'{}','{}',now(),now()),
    (other_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',other_id::text||'@example.invalid',now(),'{}','{}',now(),now());
  set local session_replication_role=origin;
  insert into public.performer_profiles(id,display_name) values(owner_id,'V159 owner'),(other_id,'V159 other');
  insert into public.organizations(id,name,public_slug,status,public_booking_enabled,created_by)
    values(organization_id,'V159 organization','v159-'||replace(organization_id::text,'-',''),'active',true,owner_id);
  insert into public.organization_memberships(organization_id,user_id,role,is_bookable,active,created_by)
    values(organization_id,owner_id,'owner',true,true,owner_id);
  insert into public.locations(id,organization_id,name,timezone,address,active,is_primary)
    values(location_id,organization_id,'V159 location','Europe/Samara','V159 address',true,true);
  insert into public.services(id,performer_id,name,duration_minutes,price_rub,active) values
    (service_id,owner_id,'V159 service',60,2500,true),(empty_service_id,owner_id,'V159 empty',30,1000,true);
  insert into public.client_accounts(id,normalized_phone,access_code_hash) values(client_id,phone,repeat('1',64));
  perform set_config('minuta.booking_organization',organization_id::text,true); perform set_config('minuta.booking_location',location_id::text,true);
  insert into public.bookings(id,booking_code,manage_token,performer_id,service_id,client_name,client_phone,client_account_id,booking_date,booking_time,duration_minutes,original_price_rub,total_price_rub,status,deposit_amount_rub,payment_status,payment_url,provider_note,booking_policy_snapshot)
  select booking_id,'V159-'||row_number() over()||substr(replace(booking_id::text,'-',''),1,7),gen_random_uuid(),owner_id,service_id,'V159 Client',phone,client_id,current_date,(time '09:00'+(row_number() over()*interval '2 hour'))::time,60,2500,2500,'confirmed',0,'not_required','','','{}'
  from unnest(booking_ids) booking_id;
  insert into public.booking_outcomes(booking_id,performer_id,visit_status,payment_method,amount_rub) values
    (booking_ids[1],owner_id,'completed','cash',2500),(booking_ids[2],owner_id,'completed','cash',2500),
    (booking_ids[3],owner_id,'completed','cash',2500),(booking_ids[4],owner_id,'scheduled',null,0);
  insert into public.booking_reviews(booking_id,performer_id,service_id,client_account_id,rating,review_text,published,created_at) values
    (booking_ids[1],owner_id,service_id,client_id,5,'Полезный отзыв',true,now()-interval '2 hour'),
    (booking_ids[2],owner_id,service_id,client_id,4,'',true,now()-interval '1 hour'),
    (booking_ids[3],owner_id,service_id,client_id,1,'Скрытый отзыв',false,now()),
    (booking_ids[4],owner_id,service_id,client_id,1,'Незавершённый визит',true,now());
end $fixture$;

select set_config('request.jwt.claim.sub',current_setting('v159.owner'),true);
set local role authenticated;
select pg_temp.v159_assert((public.save_minuta_service_v159(current_setting('v159.service')::uuid,'Очень длинное точное название услуги',75,3100,true,
  'Короткое описание без медицинских обещаний.',array['Первое','Второе','Третье'],'Точное ограничение мастера.','', '',null,null)->>'saved')::boolean,'owner_can_save');
reset role;

select pg_temp.v159_assert((select count(*)=2 from public.get_public_service_cards_v159(array[current_setting('v159.service')::uuid,current_setting('v159.empty_service')::uuid])),'full_and_empty_rows');
select pg_temp.v159_assert((select total_reviews=2 and average_rating=4.5 and latest_review_text='Полезный отзыв' from public.get_public_service_cards_v159(array[current_setting('v159.service')::uuid]) limit 1),'only_completed_published_reviews');
select pg_temp.v159_assert((select short_description='' and cardinality(highlights)=0 and important_note='' and photo_storage_path='' and total_reviews=0 from public.get_public_service_cards_v159(array[current_setting('v159.empty_service')::uuid]) limit 1),'empty_has_no_placeholder');
select pg_temp.v159_assert((select count(*)=2 from public.get_public_service_reviews_v159(current_setting('v159.service')::uuid)),'service_reviews_many');
select pg_temp.v159_assert(not ((select to_jsonb(card) from public.get_public_service_cards_v159(array[current_setting('v159.service')::uuid]) card limit 1) ?| array['client_phone','client_account_id','booking_id','performer_id']),'public_card_has_no_pii');
select pg_temp.v159_assert(not ((select to_jsonb(review) from public.get_public_service_reviews_v159(current_setting('v159.service')::uuid) review limit 1) ?| array['client_phone','client_account_id','booking_id','performer_id']),'public_reviews_have_no_pii');

select set_config('request.jwt.claim.sub',current_setting('v159.other'),true);
set local role authenticated;
do $$ begin
  begin
    perform public.save_minuta_service_v159(current_setting('v159.service')::uuid,'Чужая услуга',60,1,true,'','{}','','','',null,null);
    raise exception 'v159_wrong_owner_was_accepted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

select set_config('request.jwt.claim.sub',current_setting('v159.owner'),true);
set local role authenticated;
do $$ begin
  begin
    perform public.save_minuta_service_v159(current_setting('v159.service')::uuid,'Услуга',60,1,true,'',array['1','2','3','4'],'','','',null,null);
    raise exception 'v159_four_highlights_were_accepted';
  exception when invalid_parameter_value then null; end;
end $$;
reset role;

select pg_temp.v159_assert(not has_table_privilege('anon','public.service_public_details_v159','SELECT,INSERT,UPDATE,DELETE'),'anon_table_closed');
select pg_temp.v159_assert(has_function_privilege('anon','public.get_public_service_cards_v159(uuid[])','EXECUTE') and has_function_privilege('anon','public.get_public_service_reviews_v159(uuid)','EXECUTE'),'anon_safe_rpcs_open');
rollback;
