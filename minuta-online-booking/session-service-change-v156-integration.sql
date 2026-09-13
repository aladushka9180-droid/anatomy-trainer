\set ON_ERROR_STOP on
begin;
set local statement_timeout='90s';
set local lock_timeout='15s';
set local search_path=public,extensions,pg_catalog;

do $fixture$
declare
  owner_id uuid:=gen_random_uuid();
  organization_id uuid:=gen_random_uuid();
  location_id uuid:=gen_random_uuid();
  old_service_id uuid:=gen_random_uuid();
  new_service_id uuid:=gen_random_uuid();
  client_id uuid:=gen_random_uuid();
  booking_id uuid:=gen_random_uuid();
  phone text:='79'||translate(substr(md5(owner_id::text),1,9),'abcdef','012345');
begin
  perform set_config('minuta.v156_owner',owner_id::text,true);
  perform set_config('minuta.v156_org',organization_id::text,true);
  perform set_config('minuta.v156_location',location_id::text,true);
  perform set_config('minuta.v156_old_service',old_service_id::text,true);
  perform set_config('minuta.v156_new_service',new_service_id::text,true);
  perform set_config('minuta.v156_booking',booking_id::text,true);

  set local session_replication_role=replica;
  insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values(owner_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',owner_id::text||'@example.invalid',now(),'{}','{}',now(),now());
  set local session_replication_role=origin;
  insert into public.performer_profiles(id,display_name) values(owner_id,'V156 owner');
  insert into public.organizations(id,name,public_slug,status,public_booking_enabled,created_by)
  values(organization_id,'V156 organization','v156-'||replace(organization_id::text,'-',''),'active',true,owner_id);
  insert into public.organization_memberships(organization_id,user_id,role,is_bookable,active,created_by)
  values(organization_id,owner_id,'owner',true,true,owner_id);
  insert into public.locations(id,organization_id,name,timezone,address,active,is_primary)
  values(location_id,organization_id,'V156 location','Europe/Samara','V156 address',true,true);
  insert into public.services(id,performer_id,name,duration_minutes,price_rub,active) values
    (old_service_id,owner_id,'V156 old service',60,2500,true),
    (new_service_id,owner_id,'V156 new service',60,3000,true);
  insert into public.client_accounts(id,normalized_phone,access_code_hash)
  values(client_id,phone,repeat('1',64));

  perform set_config('minuta.booking_organization',organization_id::text,true);
  perform set_config('minuta.booking_location',location_id::text,true);
  insert into public.bookings(
    id,booking_code,manage_token,performer_id,service_id,client_name,client_phone,client_account_id,
    booking_date,booking_time,duration_minutes,original_price_rub,total_price_rub,status,
    deposit_amount_rub,payment_status,payment_url,provider_note,booking_policy_snapshot
  ) values(
    booking_id,'V156-'||substr(replace(booking_id::text,'-',''),1,10),gen_random_uuid(),owner_id,old_service_id,
    'V156 client',phone,client_id,current_date+1,time '12:00',60,2500,2500,'confirmed',
    0,'not_required','','','{}'
  );
  perform set_config('minuta.booking_organization','',true);
  perform set_config('minuta.booking_location','',true);

  insert into public.organization_shift_settings(organization_id,enabled,enabled_at,enabled_by,updated_at)
  values(organization_id,true,now(),owner_id,now());
end
$fixture$;

select set_config('request.jwt.claim.sub',current_setting('minuta.v156_owner'),true);
set local role authenticated;

-- Changing to another service with the same duration must succeed even though
-- this existing visit has no matching active shift under the current settings.
select * from public.save_booking_session(
  current_setting('minuta.v156_booking')::uuid,
  jsonb_build_array(jsonb_build_object(
    'kind','primary',
    'service_id',current_setting('minuta.v156_new_service')::uuid,
    'title','V156 new service',
    'duration_minutes',60,
    'price_rub',3000,
    'extends_duration',true
  ))
);

do $$
begin
  if not exists(
    select 1 from public.bookings
    where id=current_setting('minuta.v156_booking')::uuid
      and service_id=current_setting('minuta.v156_new_service')::uuid
      and duration_minutes=60 and total_price_rub=3000
  )
  or not exists(
    select 1 from public.booking_session_items
    where booking_id=current_setting('minuta.v156_booking')::uuid
      and item_kind='primary'
      and service_id=current_setting('minuta.v156_new_service')::uuid
  ) then
    raise exception using errcode='55000',message='v156_service_only_change_not_saved';
  end if;

  begin
    perform public.save_booking_session(
      current_setting('minuta.v156_booking')::uuid,
      jsonb_build_array(jsonb_build_object(
        'kind','primary',
        'service_id',current_setting('minuta.v156_new_service')::uuid,
        'title','V156 new service',
        'duration_minutes',59,
        'price_rub',3000,
        'extends_duration',true
      ))
    );
    raise exception using errcode='55000',message='v156_changed_schedule_was_not_checked';
  exception
    when exclusion_violation then
      if sqlerrm<>'booking_outside_active_shift' then raise; end if;
  end;
end
$$;

reset role;
rollback;
