-- ISOLATED TEST DATABASE ONLY. Every fixture and business write is rolled back.
\set ON_ERROR_STOP on

begin;
set local statement_timeout='60s';
set local lock_timeout='15s';
set local search_path=public,extensions,pg_catalog;

create function pg_temp.v140_assert(ok boolean,label text)
returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'v140_assert:%',label; end if;
end
$$;

do $acl$
declare
  signature text;
  relation_name text;
  role_name text;
  privilege_name text;
begin
  foreach signature in array array[
    'public.consume_yandex_booking_rate_limit_v140(text,text,text,text)',
    'public.get_yandex_booking_feed_v140(text,text,integer)',
    'public.get_yandex_booking_services_v140(text,text,text)',
    'public.get_yandex_booking_resources_v140(text,text,text[])',
    'public.get_yandex_booking_available_dates_v140(text,text,text[],text,date,date)',
    'public.get_yandex_booking_available_time_slots_v140(text,text,text[],text,date)',
    'public.get_yandex_booking_special_conditions_v140(text,text,text[],text,timestamp with time zone)',
    'public.create_yandex_booking_v140(text,text,text,text,text[],text,timestamp with time zone,text,text,text,text,text,boolean)',
    'public.get_yandex_booking_v140(text,text)',
    'public.update_yandex_booking_v140(text,text,text,text,text,timestamp with time zone,text)',
    'public.cancel_yandex_booking_v140(text,text,text,text,text)'
  ] loop
    if to_regprocedure(signature) is null
       or not has_function_privilege('service_role',signature,'EXECUTE')
       or has_function_privilege('anon',signature,'EXECUTE')
       or has_function_privilege('authenticated',signature,'EXECUTE') then
      raise exception 'v140_rpc_acl:%',signature;
    end if;
  end loop;

  foreach signature in array array[
    'public.minuta_yandex_service_payment_free_v140(uuid,uuid,uuid,uuid)',
    'public.minuta_yandex_all_services_v140(text,uuid)',
    'public.minuta_yandex_connection_v140(text,text)',
    'public.minuta_yandex_services_v140(text,uuid)',
    'public.minuta_yandex_iso_datetime_v140(timestamp without time zone,text)',
    'public.minuta_yandex_booking_snapshot_v140(text,text)'
  ] loop
    if has_function_privilege('service_role',signature,'EXECUTE')
       or has_function_privilege('anon',signature,'EXECUTE')
       or has_function_privilege('authenticated',signature,'EXECUTE') then
      raise exception 'v140_internal_helper_exposed:%',signature;
    end if;
  end loop;

  foreach relation_name in array array[
    'public.yandex_booking_connections_v140',
    'public.yandex_booking_mappings_v140',
    'public.yandex_booking_receipts_v140',
    'public.yandex_booking_rate_limits_v140'
  ] loop
    foreach role_name in array array['anon','authenticated','service_role'] loop
      foreach privilege_name in array array['SELECT','INSERT','UPDATE','DELETE'] loop
        if has_table_privilege(role_name,relation_name,privilege_name) then
          raise exception 'v140_direct_table_acl:%:%:%',role_name,relation_name,privilege_name;
        end if;
      end loop;
    end loop;
  end loop;
end
$acl$;

do $fixture$
declare
  actor uuid:=gen_random_uuid();
  foreign_actor uuid:=gen_random_uuid();
  deposit_actor uuid:=gen_random_uuid();
  legacy_deposit_actor uuid:=gen_random_uuid();
  organization uuid:=gen_random_uuid();
  foreign_organization uuid:=gen_random_uuid();
  deposit_organization uuid:=gen_random_uuid();
  legacy_deposit_organization uuid:=gen_random_uuid();
  location uuid:=gen_random_uuid();
  foreign_location uuid:=gen_random_uuid();
  deposit_location uuid:=gen_random_uuid();
  legacy_deposit_location uuid:=gen_random_uuid();
  service uuid:=gen_random_uuid();
  foreign_service uuid:=gen_random_uuid();
  deposit_service uuid:=gen_random_uuid();
  legacy_deposit_service uuid:=gen_random_uuid();
  resource_group uuid:=gen_random_uuid();
  resource uuid:=gen_random_uuid();
  company text:='v140-company-'||replace(gen_random_uuid()::text,'-','');
  foreign_company text:='v140-foreign-'||replace(gen_random_uuid()::text,'-','');
  production_company text:='v140-production-'||replace(gen_random_uuid()::text,'-','');
  deposit_company text:='v140-deposit-'||replace(gen_random_uuid()::text,'-','');
  legacy_deposit_company text:='v140-legacy-deposit-'||replace(gen_random_uuid()::text,'-','');
  slug text:='v140-'||replace(organization::text,'-','');
  foreign_slug text:='v140-'||replace(foreign_organization::text,'-','');
  deposit_slug text:='v140-'||replace(deposit_organization::text,'-','');
  legacy_deposit_slug text:='v140-'||replace(legacy_deposit_organization::text,'-','');
  booking_date date:=(clock_timestamp() at time zone 'Europe/Samara')::date+7;
begin
  perform set_config('minuta.v140.actor',actor::text,true);
  perform set_config('minuta.v140.foreign_actor',foreign_actor::text,true);
  perform set_config('minuta.v140.deposit_actor',deposit_actor::text,true);
  perform set_config('minuta.v140.legacy_deposit_actor',legacy_deposit_actor::text,true);
  perform set_config('minuta.v140.organization',organization::text,true);
  perform set_config('minuta.v140.foreign_organization',foreign_organization::text,true);
  perform set_config('minuta.v140.deposit_organization',deposit_organization::text,true);
  perform set_config('minuta.v140.legacy_deposit_organization',legacy_deposit_organization::text,true);
  perform set_config('minuta.v140.location',location::text,true);
  perform set_config('minuta.v140.foreign_location',foreign_location::text,true);
  perform set_config('minuta.v140.deposit_location',deposit_location::text,true);
  perform set_config('minuta.v140.legacy_deposit_location',legacy_deposit_location::text,true);
  perform set_config('minuta.v140.service',service::text,true);
  perform set_config('minuta.v140.foreign_service',foreign_service::text,true);
  perform set_config('minuta.v140.deposit_service',deposit_service::text,true);
  perform set_config('minuta.v140.legacy_deposit_service',legacy_deposit_service::text,true);
  perform set_config('minuta.v140.resource_group',resource_group::text,true);
  perform set_config('minuta.v140.resource',resource::text,true);
  perform set_config('minuta.v140.company',company,true);
  perform set_config('minuta.v140.foreign_company',foreign_company,true);
  perform set_config('minuta.v140.production_company',production_company,true);
  perform set_config('minuta.v140.deposit_company',deposit_company,true);
  perform set_config('minuta.v140.legacy_deposit_company',legacy_deposit_company,true);
  perform set_config('minuta.v140.slug',slug,true);
  perform set_config('minuta.v140.foreign_slug',foreign_slug,true);
  perform set_config('minuta.v140.deposit_slug',deposit_slug,true);
  perform set_config('minuta.v140.legacy_deposit_slug',legacy_deposit_slug,true);
  perform set_config('minuta.v140.date',booking_date::text,true);
  perform set_config('minuta.v140.datetime',
    (((booking_date+time '10:00') at time zone 'Europe/Samara')::timestamptz)::text,true);
  perform set_config('minuta.v140.rescheduled_datetime',
    (((booking_date+time '12:00') at time zone 'Europe/Samara')::timestamptz)::text,true);

  set local session_replication_role=replica;
  insert into auth.users(
    id,instance_id,aud,role,email,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
  ) values(
    actor,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
    actor::text||'@example.invalid',now(),'{}','{}',now(),now()
  ),(
    foreign_actor,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
    foreign_actor::text||'@example.invalid',now(),'{}','{}',now(),now()
  ),(
    deposit_actor,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
    deposit_actor::text||'@example.invalid',now(),'{}','{}',now(),now()
  ),(
    legacy_deposit_actor,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
    legacy_deposit_actor::text||'@example.invalid',now(),'{}','{}',now(),now()
  );
  set local session_replication_role=origin;

  insert into public.performer_profiles(id,display_name) values
    (actor,'V140 isolated specialist'),
    (foreign_actor,'V140 foreign specialist'),
    (deposit_actor,'V140 deposit specialist'),
    (legacy_deposit_actor,'V140 legacy deposit specialist');
  insert into public.organizations(
    id,name,public_slug,status,public_booking_enabled,created_by
  ) values
    (organization,'V140 isolated organization',slug,'active',true,actor),
    (foreign_organization,'V140 foreign organization',foreign_slug,'active',true,foreign_actor),
    (deposit_organization,'V140 deposit organization',deposit_slug,'active',true,deposit_actor),
    (legacy_deposit_organization,'V140 legacy deposit organization',legacy_deposit_slug,'active',true,legacy_deposit_actor);
  insert into public.locations(
    id,organization_id,name,timezone,address,active,is_primary
  ) values
    (location,organization,'V140 primary','Europe/Samara','V140 address',true,true),
    (foreign_location,foreign_organization,'V140 foreign','Europe/Samara','V140 foreign address',true,true),
    (deposit_location,deposit_organization,'V140 deposit','Europe/Samara','V140 deposit address',true,true),
    (legacy_deposit_location,legacy_deposit_organization,'V140 legacy deposit','Europe/Samara','V140 legacy deposit address',true,true);
  insert into public.organization_memberships(
    organization_id,user_id,role,is_bookable,active,created_by
  ) values
    (organization,actor,'owner',true,true,actor),
    (foreign_organization,foreign_actor,'owner',true,true,foreign_actor),
    (deposit_organization,deposit_actor,'owner',true,true,deposit_actor),
    (legacy_deposit_organization,legacy_deposit_actor,'owner',true,true,legacy_deposit_actor);
  insert into public.services(
    id,performer_id,name,duration_minutes,price_rub,active
  ) values
    (service,actor,'V140 isolated service',60,1400,true),
    (foreign_service,foreign_actor,'V140 foreign service',60,2400,true),
    (deposit_service,deposit_actor,'V140 deposit service',60,3400,true),
    (legacy_deposit_service,legacy_deposit_actor,'V140 legacy deposit service',60,4400,true);
  insert into public.provider_schedule(
    performer_id,weekday,enabled,start_time,end_time,slot_interval_minutes
  )
  select actor,day,true,'09:00','18:00',15 from generate_series(1,7) day
  union all
  select foreign_actor,day,true,'09:00','18:00',15 from generate_series(1,7) day
  union all
  select deposit_actor,day,true,'09:00','18:00',15 from generate_series(1,7) day
  union all
  select legacy_deposit_actor,day,true,'09:00','18:00',15 from generate_series(1,7) day;

  insert into public.organization_client_profiles(
    organization_id,normalized_phone,online_booking_blocked,online_booking_blocked_at,
    online_booking_blocked_by,updated_by
  ) values(organization,'79990000000',true,now(),actor,actor);
  insert into public.organization_booking_policy_settings(
    organization_id,enabled,enabled_at,enabled_by
  ) values(deposit_organization,true,now(),deposit_actor);
  insert into public.organization_booking_policy_rules(
    organization_id,deposit_mode,deposit_value,payment_url_template,created_by
  ) values(deposit_organization,'fixed',500,'https://example.invalid/pay/{code}',deposit_actor);
  insert into public.booking_policies(
    performer_id,deposit_enabled,deposit_amount_rub,payment_url_template
  ) values(legacy_deposit_actor,true,500,'https://example.invalid/pay/{code}')
  on conflict(performer_id) do update set
    deposit_enabled=excluded.deposit_enabled,
    deposit_amount_rub=excluded.deposit_amount_rub,
    payment_url_template=excluded.payment_url_template;

  insert into public.resource_groups(id,organization_id,kind,name)
  values(resource_group,organization,'room','V140 isolated room');
  insert into public.service_resource_requirements(
    organization_id,service_id,group_id,quantity
  ) values(organization,service,resource_group,1);
  insert into public.resources(id,organization_id,location_id,group_id,name,active)
  values(resource,organization,location,resource_group,'V140 isolated resource',true);

  insert into public.yandex_booking_connections_v140(
    partner_name,environment,external_company_id,organization_id,location_id,
    approval_status,enabled,rubrics,permalink,booking_url
  ) values
    ('yandex','testing',company,organization,location,'approved',true,array['beauty'],'v140-isolated','https://example.invalid/v140'),
    ('yandex','testing',foreign_company,foreign_organization,foreign_location,'approved',true,array['beauty'],'v140-foreign','https://example.invalid/v140-foreign'),
    ('yandex','production',production_company,foreign_organization,foreign_location,'approved',true,array['beauty'],'v140-production','https://example.invalid/v140-production'),
    ('yandex','testing',deposit_company,deposit_organization,deposit_location,'approved',true,array['beauty'],'v140-deposit','https://example.invalid/v140-deposit'),
    ('yandex','testing',legacy_deposit_company,legacy_deposit_organization,legacy_deposit_location,'approved',true,array['beauty'],'v140-legacy-deposit','https://example.invalid/v140-legacy-deposit');
end
$fixture$;

-- RLS bypass on service_role must not turn into generic table CRUD access.
set local role service_role;
do $direct_access$
begin
  begin
    perform connection.id from public.yandex_booking_connections_v140 connection limit 1;
    raise exception 'v140_service_role_direct_select_accepted';
  exception when insufficient_privilege then null;
  end;
end
$direct_access$;
reset role;

-- Exercise the public read adapter exactly as the Edge boundary invokes it.
set local role service_role;
select set_config('minuta.v140.feed',public.get_yandex_booking_feed_v140(
  'testing',null,500
)::text,true);
select set_config('minuta.v140.production_feed',public.get_yandex_booking_feed_v140(
  'production',null,500
)::text,true);
select set_config('minuta.v140.services',public.get_yandex_booking_services_v140(
  'testing',current_setting('minuta.v140.company'),null
)::text,true);
select set_config('minuta.v140.deposit_services',public.get_yandex_booking_services_v140(
  'testing',current_setting('minuta.v140.deposit_company'),null
)::text,true);
select set_config('minuta.v140.legacy_deposit_services',public.get_yandex_booking_services_v140(
  'testing',current_setting('minuta.v140.legacy_deposit_company'),null
)::text,true);
select set_config('minuta.v140.resources',public.get_yandex_booking_resources_v140(
  'testing',current_setting('minuta.v140.company'),array[current_setting('minuta.v140.service')]
)::text,true);
select set_config('minuta.v140.dates',public.get_yandex_booking_available_dates_v140(
  'testing',current_setting('minuta.v140.company'),array[current_setting('minuta.v140.service')],
  current_setting('minuta.v140.actor'),current_setting('minuta.v140.date')::date,current_setting('minuta.v140.date')::date
)::text,true);
select set_config('minuta.v140.slots',public.get_yandex_booking_available_time_slots_v140(
  'testing',current_setting('minuta.v140.company'),array[current_setting('minuta.v140.service')],
  current_setting('minuta.v140.actor'),current_setting('minuta.v140.date')::date
)::text,true);
select set_config('minuta.v140.conditions',public.get_yandex_booking_special_conditions_v140(
  'testing',current_setting('minuta.v140.company'),array[current_setting('minuta.v140.service')],
  current_setting('minuta.v140.actor'),current_setting('minuta.v140.datetime')::timestamptz
)::text,true);
select set_config('minuta.v140.wrong_environment_company',public.get_yandex_booking_services_v140(
  'production',current_setting('minuta.v140.company'),null
)::text,true);
reset role;

do $read_verify$
declare
  feed jsonb:=current_setting('minuta.v140.feed')::jsonb;
  production_feed jsonb:=current_setting('minuta.v140.production_feed')::jsonb;
  services jsonb:=current_setting('minuta.v140.services')::jsonb;
  deposit_services jsonb:=current_setting('minuta.v140.deposit_services')::jsonb;
  legacy_deposit_services jsonb:=current_setting('minuta.v140.legacy_deposit_services')::jsonb;
  resources jsonb:=current_setting('minuta.v140.resources')::jsonb;
  dates jsonb:=current_setting('minuta.v140.dates')::jsonb;
  slots jsonb:=current_setting('minuta.v140.slots')::jsonb;
  conditions jsonb:=current_setting('minuta.v140.conditions')::jsonb;
begin
  perform pg_temp.v140_assert(feed->>'ok'='true','feed_ok');
  perform pg_temp.v140_assert(exists(
    select 1 from jsonb_array_elements(feed->'companies') company
    where company->>'id'=current_setting('minuta.v140.company')
      and jsonb_array_length(company->'services')=1
      and jsonb_array_length(company->'resources')=1
  ),'testing_feed_main_company');
  perform pg_temp.v140_assert(exists(
    select 1 from jsonb_array_elements(feed->'companies') company
    where company->>'id'=current_setting('minuta.v140.foreign_company')
  ),'testing_feed_foreign_company');
  perform pg_temp.v140_assert(not exists(
    select 1 from jsonb_array_elements(feed->'companies') company
    where company->>'id'=current_setting('minuta.v140.production_company')
  ),'testing_feed_environment_isolation');
  perform pg_temp.v140_assert(not exists(
    select 1 from jsonb_array_elements(feed->'companies') company
    where company->>'id' in(current_setting('minuta.v140.deposit_company'),current_setting('minuta.v140.legacy_deposit_company'))
  ),'deposit_companies_not_advertised');
  perform pg_temp.v140_assert(exists(
    select 1 from jsonb_array_elements(production_feed->'companies') company
    where company->>'id'=current_setting('minuta.v140.production_company')
  ),'production_feed_company');
  perform pg_temp.v140_assert(not exists(
    select 1 from jsonb_array_elements(production_feed->'companies') company
    where company->>'id' in(current_setting('minuta.v140.company'),current_setting('minuta.v140.foreign_company'))
  ),'production_feed_environment_isolation');
  perform pg_temp.v140_assert(services#>>'{services,0,id}'=current_setting('minuta.v140.service'),'service_catalog');
  perform pg_temp.v140_assert(
    deposit_services @> '{"ok":true,"services":[]}'::jsonb,
    'organization_deposit_service_not_advertised'
  );
  perform pg_temp.v140_assert(
    legacy_deposit_services @> '{"ok":true,"services":[]}'::jsonb,
    'legacy_deposit_service_not_advertised'
  );
  perform pg_temp.v140_assert(resources#>>'{resources,0,id}'=current_setting('minuta.v140.actor'),'specialist_resource_catalog');
  perform pg_temp.v140_assert(dates->'dates' ? current_setting('minuta.v140.date'),'available_date');
  perform pg_temp.v140_assert(exists(
    select 1 from jsonb_array_elements_text(slots->'slots') slot
    where slot like current_setting('minuta.v140.date')||'T10:00:00%'
  ),'available_time_slot');
  perform pg_temp.v140_assert(conditions->'conditions'='[]'::jsonb,'available_special_conditions');
  perform pg_temp.v140_assert(
    current_setting('minuta.v140.wrong_environment_company')::jsonb
      @> '{"ok":false,"error":"company_not_found"}'::jsonb,
    'company_environment_denial'
  );
end
$read_verify$;

-- The limiter is real, persisted, scoped and bounded. Looping up to 300 avoids
-- a false negative if the wall clock crosses one minute during this test.
set local role service_role;
do $limiter$
declare
  result jsonb;
  denied boolean:=false;
  attempt integer;
begin
  for attempt in 1..300 loop
    result:=public.consume_yandex_booking_rate_limit_v140(
      'testing',repeat('a',64),current_setting('minuta.v140.company'),'get:feed'
    );
    if result->>'allowed'='false' then
      denied:=true;
      exit;
    end if;
  end loop;
  if not denied then raise exception 'v140_read_rate_limit_not_enforced'; end if;
  if (result->>'retry_after')::integer not between 1 and 60 then
    raise exception 'v140_retry_after_out_of_bounds:%',result;
  end if;
  result:=public.consume_yandex_booking_rate_limit_v140(
    'testing',repeat('a',64),current_setting('minuta.v140.foreign_company'),'get:feed'
  );
  if result->>'allowed'<>'true' then raise exception 'v140_rate_scope_not_isolated:%',result; end if;
  result:=public.consume_yandex_booking_rate_limit_v140(
    'testing',repeat('a',64),current_setting('minuta.v140.company'),'post:bookings'
  );
  if result->>'allowed'<>'true' then raise exception 'v140_rate_class_not_isolated:%',result; end if;
end
$limiter$;
reset role;

select pg_temp.v140_assert(exists(
  select 1 from public.yandex_booking_rate_limits_v140 rate
  where rate.partner_name='yandex' and rate.environment='testing'
    and rate.credential_hash=repeat('a',64) and rate.operation_class='read'
    and rate.scope_hash=encode(extensions.digest(
      convert_to(current_setting('minuta.v140.company'),'UTF8'),'sha256'
    ),'hex')
    and rate.request_count>120
),'rate_limit_hashed_scope_persisted');
select pg_temp.v140_assert(not exists(
  select 1 from public.yandex_booking_rate_limits_v140 rate
  where rate.scope_hash in(
    current_setting('minuta.v140.company'),
    current_setting('minuta.v140.foreign_company')
  )
),'rate_limit_raw_scope_not_persisted');

-- Create, replay, conflict and isolation checks all pass only through the
-- service-role RPC boundary. Synthetic phone values suppress real messaging.
set local role service_role;
select set_config('minuta.v140.blocked_create',public.create_yandex_booking_v140(
  'testing','create-blocked',repeat('4',64),current_setting('minuta.v140.company'),
  array[current_setting('minuta.v140.service')],current_setting('minuta.v140.actor'),
  current_setting('minuta.v140.datetime')::timestamptz,'V140','Blocked','+7 (999) 000-00-00',
  null,null,false
)::text,true);
select set_config('minuta.v140.deposit_create',public.create_yandex_booking_v140(
  'testing','create-deposit',repeat('5',64),current_setting('minuta.v140.deposit_company'),
  array[current_setting('minuta.v140.deposit_service')],current_setting('minuta.v140.deposit_actor'),
  current_setting('minuta.v140.datetime')::timestamptz,'V140','Deposit','0000000001',
  null,null,false
)::text,true);
select set_config('minuta.v140.legacy_deposit_create',public.create_yandex_booking_v140(
  'testing','create-legacy-deposit',repeat('6',64),current_setting('minuta.v140.legacy_deposit_company'),
  array[current_setting('minuta.v140.legacy_deposit_service')],current_setting('minuta.v140.legacy_deposit_actor'),
  current_setting('minuta.v140.datetime')::timestamptz,'V140','Legacy deposit','0000000002',
  null,null,false
)::text,true);
select set_config('minuta.v140.created',public.create_yandex_booking_v140(
  'testing','create-main',repeat('b',64),current_setting('minuta.v140.company'),
  array[current_setting('minuta.v140.service')],current_setting('minuta.v140.actor'),
  current_setting('minuta.v140.datetime')::timestamptz,'V140','Client','0000000000',
  'v140-client@example.invalid','created comment',false
)::text,true);
select set_config('minuta.v140.create_replay',public.create_yandex_booking_v140(
  'testing','create-main',repeat('b',64),current_setting('minuta.v140.company'),
  array[current_setting('minuta.v140.service')],current_setting('minuta.v140.actor'),
  current_setting('minuta.v140.datetime')::timestamptz,'V140','Client','0000000000',
  'v140-client@example.invalid','created comment',false
)::text,true);
select set_config('minuta.v140.create_conflict',public.create_yandex_booking_v140(
  'testing','create-main',repeat('c',64),current_setting('minuta.v140.company'),
  array[current_setting('minuta.v140.service')],current_setting('minuta.v140.actor'),
  current_setting('minuta.v140.datetime')::timestamptz,'V140','Changed','0000000000',
  null,'changed comment',false
)::text,true);
select set_config('minuta.v140.foreign_service_result',public.create_yandex_booking_v140(
  'testing','create-cross-tenant',repeat('d',64),current_setting('minuta.v140.company'),
  array[current_setting('minuta.v140.foreign_service')],current_setting('minuta.v140.foreign_actor'),
  current_setting('minuta.v140.datetime')::timestamptz,'V140','Cross tenant','0000000000',
  null,null,false
)::text,true);
select set_config('minuta.v140.booking_id',
  current_setting('minuta.v140.created')::jsonb#>>'{booking,id}',true);
select set_config('minuta.v140.get_created',public.get_yandex_booking_v140(
  'testing',current_setting('minuta.v140.booking_id')
)::text,true);
select set_config('minuta.v140.get_wrong_environment',public.get_yandex_booking_v140(
  'production',current_setting('minuta.v140.booking_id')
)::text,true);
select set_config('minuta.v140.update_foreign_company',public.update_yandex_booking_v140(
  'testing','update-foreign-company',repeat('e',64),current_setting('minuta.v140.booking_id'),
  current_setting('minuta.v140.foreign_company'),current_setting('minuta.v140.rescheduled_datetime')::timestamptz,
  'must not be stored'
)::text,true);
select set_config('minuta.v140.updated',public.update_yandex_booking_v140(
  'testing','update-main',repeat('f',64),current_setting('minuta.v140.booking_id'),
  current_setting('minuta.v140.company'),current_setting('minuta.v140.rescheduled_datetime')::timestamptz,
  'updated comment'
)::text,true);
select set_config('minuta.v140.update_replay',public.update_yandex_booking_v140(
  'testing','update-main',repeat('f',64),current_setting('minuta.v140.booking_id'),
  current_setting('minuta.v140.company'),current_setting('minuta.v140.rescheduled_datetime')::timestamptz,
  'updated comment'
)::text,true);
select set_config('minuta.v140.update_conflict',public.update_yandex_booking_v140(
  'testing','update-main',repeat('0',64),current_setting('minuta.v140.booking_id'),
  current_setting('minuta.v140.company'),null,'different update'
)::text,true);
select set_config('minuta.v140.cancel_foreign_company',public.cancel_yandex_booking_v140(
  'testing','cancel-foreign-company',repeat('1',64),current_setting('minuta.v140.booking_id'),
  current_setting('minuta.v140.foreign_company')
)::text,true);
select set_config('minuta.v140.cancelled',public.cancel_yandex_booking_v140(
  'testing','cancel-main',repeat('2',64),current_setting('minuta.v140.booking_id'),null
)::text,true);
select set_config('minuta.v140.cancel_replay',public.cancel_yandex_booking_v140(
  'testing','cancel-main',repeat('2',64),current_setting('minuta.v140.booking_id'),null
)::text,true);
select set_config('minuta.v140.cancel_conflict',public.cancel_yandex_booking_v140(
  'testing','cancel-main',repeat('3',64),current_setting('minuta.v140.booking_id'),null
)::text,true);
select set_config('minuta.v140.get_cancelled',public.get_yandex_booking_v140(
  'testing',current_setting('minuta.v140.booking_id')
)::text,true);
reset role;

do $mutation_verify$
declare
  created jsonb:=current_setting('minuta.v140.created')::jsonb;
  updated jsonb:=current_setting('minuta.v140.updated')::jsonb;
  cancelled jsonb:=current_setting('minuta.v140.cancelled')::jsonb;
  all_results text:=concat_ws('|',
    current_setting('minuta.v140.created'),current_setting('minuta.v140.create_replay'),
    current_setting('minuta.v140.get_created'),current_setting('minuta.v140.updated'),
    current_setting('minuta.v140.update_replay'),current_setting('minuta.v140.cancelled'),
    current_setting('minuta.v140.cancel_replay'),current_setting('minuta.v140.get_cancelled')
  );
begin
  perform pg_temp.v140_assert(
    current_setting('minuta.v140.blocked_create')::jsonb @> '{"ok":false,"error":"create_forbidden"}'::jsonb,
    'blocked_client_create_forbidden'
  );
  perform pg_temp.v140_assert(
    current_setting('minuta.v140.deposit_create')::jsonb @> '{"ok":false,"error":"create_forbidden"}'::jsonb,
    'organization_deposit_create_forbidden'
  );
  perform pg_temp.v140_assert(
    current_setting('minuta.v140.legacy_deposit_create')::jsonb @> '{"ok":false,"error":"create_forbidden"}'::jsonb,
    'legacy_deposit_create_forbidden'
  );
  perform pg_temp.v140_assert(created->>'ok'='true','create_ok');
  perform pg_temp.v140_assert(created=current_setting('minuta.v140.create_replay')::jsonb,'create_exact_replay');
  perform pg_temp.v140_assert(
    current_setting('minuta.v140.create_conflict')::jsonb @> '{"ok":false,"error":"request_conflict"}'::jsonb,
    'create_changed_payload_conflict'
  );
  perform pg_temp.v140_assert(
    current_setting('minuta.v140.foreign_service_result')::jsonb @> '{"ok":false,"error":"service_not_found"}'::jsonb,
    'cross_tenant_service_denied'
  );
  perform pg_temp.v140_assert(current_setting('minuta.v140.get_created')::jsonb=created,'get_created');
  perform pg_temp.v140_assert(
    current_setting('minuta.v140.get_wrong_environment')::jsonb @> '{"ok":false,"error":"booking_not_found"}'::jsonb,
    'booking_environment_denied'
  );
  perform pg_temp.v140_assert(
    current_setting('minuta.v140.update_foreign_company')::jsonb @> '{"ok":false,"error":"company_not_found"}'::jsonb,
    'update_foreign_company_denied'
  );
  perform pg_temp.v140_assert(updated->>'ok'='true','update_ok');
  perform pg_temp.v140_assert(updated=current_setting('minuta.v140.update_replay')::jsonb,'update_exact_replay');
  perform pg_temp.v140_assert(updated#>>'{booking,datetime}' like current_setting('minuta.v140.date')||'T12:00:00%','rescheduled_datetime');
  perform pg_temp.v140_assert(updated#>>'{booking,comment}'='updated comment','rescheduled_comment');
  perform pg_temp.v140_assert(
    current_setting('minuta.v140.update_conflict')::jsonb @> '{"ok":false,"error":"request_conflict"}'::jsonb,
    'update_changed_payload_conflict'
  );
  perform pg_temp.v140_assert(
    current_setting('minuta.v140.cancel_foreign_company')::jsonb @> '{"ok":false,"error":"company_not_found"}'::jsonb,
    'cancel_foreign_company_denied'
  );
  perform pg_temp.v140_assert(cancelled->>'ok'='true','cancel_ok');
  perform pg_temp.v140_assert(cancelled=current_setting('minuta.v140.cancel_replay')::jsonb,'cancel_exact_replay');
  perform pg_temp.v140_assert(cancelled#>>'{booking,status}'='cancelled','cancelled_status');
  perform pg_temp.v140_assert(
    current_setting('minuta.v140.cancel_conflict')::jsonb @> '{"ok":false,"error":"request_conflict"}'::jsonb,
    'cancel_changed_payload_conflict'
  );
  perform pg_temp.v140_assert(
    current_setting('minuta.v140.get_cancelled')::jsonb#>>'{booking,status}'='cancelled',
    'get_cancelled_status'
  );
  perform pg_temp.v140_assert(position('manage_token' in lower(all_results))=0,'manage_token_not_returned');
  perform pg_temp.v140_assert(position('v140-client@example.invalid' in lower(all_results))=0,'email_not_returned');
end
$mutation_verify$;

select pg_temp.v140_assert(not exists(
  select 1 from public.bookings booking
  where booking.organization_id=current_setting('minuta.v140.organization')::uuid
    and public.normalize_client_phone(booking.client_phone)='79990000000'
),'blocked_client_no_booking');
select pg_temp.v140_assert(not exists(
  select 1 from public.yandex_booking_mappings_v140 mapping
  where mapping.idempotency_key='create-blocked'
),'blocked_client_no_mapping');
select pg_temp.v140_assert(not exists(
  select 1 from public.yandex_booking_receipts_v140 receipt
  where receipt.idempotency_key='create-blocked'
),'blocked_client_no_receipt');
select pg_temp.v140_assert(not exists(
  select 1 from public.bookings booking
  where booking.organization_id in(
    current_setting('minuta.v140.deposit_organization')::uuid,
    current_setting('minuta.v140.legacy_deposit_organization')::uuid
  )
),'deposit_services_no_booking');
select pg_temp.v140_assert(not exists(
  select 1 from public.yandex_booking_mappings_v140 mapping
  where mapping.idempotency_key in('create-deposit','create-legacy-deposit')
),'deposit_services_no_mapping');
select pg_temp.v140_assert(not exists(
  select 1 from public.yandex_booking_receipts_v140 receipt
  where receipt.idempotency_key in('create-deposit','create-legacy-deposit')
),'deposit_services_no_receipt');

select pg_temp.v140_assert((
  select count(*)=1 from public.yandex_booking_mappings_v140 mapping
  where mapping.partner_name='yandex' and mapping.environment='testing'
    and mapping.external_company_id=current_setting('minuta.v140.company')
    and mapping.external_booking_id=current_setting('minuta.v140.booking_id')
),'one_scoped_mapping');
select pg_temp.v140_assert((
  select count(*)=3 from public.yandex_booking_receipts_v140 receipt
  where receipt.partner_name='yandex' and receipt.environment='testing'
    and receipt.external_company_id=current_setting('minuta.v140.company')
    and receipt.external_booking_id=current_setting('minuta.v140.booking_id')
),'one_receipt_per_successful_mutation');
select pg_temp.v140_assert((
  select count(*)=1 from public.bookings booking
  join public.yandex_booking_mappings_v140 mapping on mapping.local_booking_id=booking.id
  where mapping.external_booking_id=current_setting('minuta.v140.booking_id')
    and booking.organization_id=current_setting('minuta.v140.organization')::uuid
    and booking.location_id=current_setting('minuta.v140.location')::uuid
    and booking.service_id=current_setting('minuta.v140.service')::uuid
    and booking.performer_id=current_setting('minuta.v140.actor')::uuid
    and booking.booking_time='12:00'
    and booking.status='cancelled'
    and booking.provider_note='updated comment'
),'one_exact_cancelled_booking');
select pg_temp.v140_assert((
  select count(*)=1 from public.booking_resource_allocations allocation
  join public.yandex_booking_mappings_v140 mapping on mapping.local_booking_id=allocation.booking_id
  where mapping.external_booking_id=current_setting('minuta.v140.booking_id')
    and allocation.resource_id=current_setting('minuta.v140.resource')::uuid
    and allocation.booking_status='cancelled'
),'physical_resource_lifecycle');
select pg_temp.v140_assert(not exists(
  select 1 from information_schema.columns
  where table_schema='public' and table_name like 'yandex_booking_%_v140'
    and column_name in('manage_token','client_email','email','comment')
),'no_partner_pii_or_manage_token_columns');
select pg_temp.v140_assert(not exists(
  select 1 from public.yandex_booking_receipts_v140 receipt
  where receipt.result::text ilike '%manage_token%'
     or receipt.result::text ilike '%v140-client@example.invalid%'
),'receipt_redaction');

rollback;

select 'Yandex booking v140 PostgreSQL integration contract: PASS' as result;
