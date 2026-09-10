-- ISOLATED TEST DATABASE ONLY. Every fixture and business write is rolled back.
\set ON_ERROR_STOP on

begin;
set local statement_timeout='60s';
set local lock_timeout='15s';
set local search_path=public,extensions,pg_catalog;

create function pg_temp.v142_assert(ok boolean,label text)
returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'v142_assert:%',label; end if;
end
$$;

do $acl$
declare signature text; relation_name text; role_name text; privilege_name text;
begin
  foreach signature in array array[
    'public.authenticate_minuta_integration_key_v142(uuid,text,text,text)',
    'public.consume_minuta_integration_rate_limit_v142(uuid,uuid,text)',
    'public.get_minuta_integration_calendar_v142(uuid,timestamp with time zone,timestamp with time zone,integer,timestamp with time zone,uuid)',
    'public.upsert_minuta_integration_calendar_event_v142(uuid,text,text,text,uuid,uuid,timestamp with time zone,timestamp with time zone,text,text)',
    'public.delete_minuta_integration_calendar_event_v142(uuid,text,text,text,text)',
    'public.lease_minuta_integration_webhooks_v142(integer,uuid)',
    'public.settle_minuta_integration_webhook_v142(uuid,uuid,text,integer,text)'
  ] loop
    if to_regprocedure(signature) is null
       or not has_function_privilege('service_role',signature,'EXECUTE')
       or has_function_privilege('anon',signature,'EXECUTE')
       or has_function_privilege('authenticated',signature,'EXECUTE') then
      raise exception 'v142_service_rpc_acl:%',signature;
    end if;
  end loop;
  foreach signature in array array[
    'public.require_minuta_integration_owner_v142(uuid)',
    'public.ensure_minuta_integration_block_service_v142(uuid)',
    'public.minuta_integration_calendar_snapshot_v142(uuid,text)'
  ] loop
    if has_function_privilege('service_role',signature,'EXECUTE')
       or has_function_privilege('anon',signature,'EXECUTE')
       or has_function_privilege('authenticated',signature,'EXECUTE') then
      raise exception 'v142_internal_helper_exposed:%',signature;
    end if;
  end loop;
  foreach relation_name in array array[
    'public.integration_connections_v142','public.integration_api_keys_v142',
    'public.integration_rate_limits_v142','public.integration_booking_revisions_v142',
    'public.integration_calendar_events_v142',
    'public.integration_request_receipts_v142','public.integration_webhook_subscriptions_v142',
    'public.integration_webhook_outbox_v142'
  ] loop
    foreach role_name in array array['anon','authenticated','service_role'] loop
      foreach privilege_name in array array['SELECT','INSERT','UPDATE','DELETE'] loop
        if has_table_privilege(role_name,relation_name,privilege_name) then
          raise exception 'v142_direct_table_acl:%:%:%',role_name,relation_name,privilege_name;
        end if;
      end loop;
    end loop;
  end loop;
end
$acl$;

do $fixture$
declare
  actor uuid:=gen_random_uuid();
  second_actor uuid:=gen_random_uuid();
  outsider uuid:=gen_random_uuid();
  organization uuid:=gen_random_uuid();
  foreign_organization uuid:=gen_random_uuid();
  location uuid:=gen_random_uuid();
  service uuid:=gen_random_uuid();
  reserved_service uuid:=gen_random_uuid();
  connection uuid:=gen_random_uuid();
  key_id uuid:=gen_random_uuid();
  subscription uuid:=gen_random_uuid();
  ordinary_booking uuid:=gen_random_uuid();
  booking_date date:=(clock_timestamp() at time zone 'Europe/Samara')::date+7;
begin
  perform set_config('minuta.v142.actor',actor::text,true);
  perform set_config('minuta.v142.second_actor',second_actor::text,true);
  perform set_config('minuta.v142.outsider',outsider::text,true);
  perform set_config('minuta.v142.organization',organization::text,true);
  perform set_config('minuta.v142.foreign_organization',foreign_organization::text,true);
  perform set_config('minuta.v142.location',location::text,true);
  perform set_config('minuta.v142.service',service::text,true);
  perform set_config('minuta.v142.connection',connection::text,true);
  perform set_config('minuta.v142.key_id',key_id::text,true);
  perform set_config('minuta.v142.subscription',subscription::text,true);
  perform set_config('minuta.v142.ordinary_booking',ordinary_booking::text,true);
  perform set_config('minuta.v142.date',booking_date::text,true);
  perform set_config('minuta.v142.start',(((booking_date+time '10:00') at time zone 'Europe/Samara')::timestamptz)::text,true);
  perform set_config('minuta.v142.finish',(((booking_date+time '11:00') at time zone 'Europe/Samara')::timestamptz)::text,true);
  perform set_config('minuta.v142.moved_start',(((booking_date+time '12:00') at time zone 'Europe/Samara')::timestamptz)::text,true);
  perform set_config('minuta.v142.moved_finish',(((booking_date+time '13:00') at time zone 'Europe/Samara')::timestamptz)::text,true);

  set local session_replication_role=replica;
  insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values
    (actor,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',actor::text||'@example.invalid',now(),'{}','{}',now(),now()),
    (second_actor,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',second_actor::text||'@example.invalid',now(),'{}','{}',now(),now()),
    (outsider,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',outsider::text||'@example.invalid',now(),'{}','{}',now(),now());
  set local session_replication_role=origin;

  insert into public.performer_profiles(id,display_name) values
    (actor,'V142 owner'),(second_actor,'V142 second'),(outsider,'V142 outsider');
  insert into public.organizations(id,name,public_slug,status,public_booking_enabled,created_by) values
    (organization,'V142 organization','v142-'||replace(organization::text,'-',''),'active',true,actor),
    (foreign_organization,'V142 foreign','v142-'||replace(foreign_organization::text,'-',''),'active',true,outsider);
  insert into public.locations(id,organization_id,name,timezone,address,active,is_primary)
  values(location,organization,'V142 location','Europe/Samara','V142 address',true,true);
  insert into public.organization_memberships(organization_id,user_id,role,is_bookable,active,created_by) values
    (organization,actor,'owner',true,true,actor),
    (organization,second_actor,'specialist',true,true,actor),
    (foreign_organization,outsider,'owner',true,true,outsider);
  insert into public.services(id,performer_id,name,duration_minutes,price_rub,active) values
    (service,actor,'V142 ordinary service',60,1420,true),
    (reserved_service,actor,'__PRIMETIME_EXTERNAL_CALENDAR__',60,1420,true);
end
$fixture$;

set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('minuta.v142.actor'),true);
select public.configure_minuta_integration_connection_v142(
  current_setting('minuta.v142.organization')::uuid,current_setting('minuta.v142.connection')::uuid,
  'fixture','testing','fixture-account',true
);
select public.put_minuta_integration_api_key_v142(
  current_setting('minuta.v142.connection')::uuid,current_setting('minuta.v142.key_id')::uuid,
  'ptk_'||current_setting('minuta.v142.key_id'),'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  array['calendar:read','calendar:write'],now()+interval '30 days'
);
select public.put_minuta_integration_webhook_v142(
  current_setting('minuta.v142.connection')::uuid,current_setting('minuta.v142.subscription')::uuid,
  'https://receiver.example.invalid/primetime','fixture_primary',
  array['booking.created','booking.updated','booking.cancelled'],true
);

select set_config('request.jwt.claim.sub',current_setting('minuta.v142.outsider'),true);
do $owner_isolation$
begin
  begin
    perform public.configure_minuta_integration_connection_v142(
      current_setting('minuta.v142.organization')::uuid,gen_random_uuid(),'fixture','testing','foreign-attempt',false
    );
    raise exception 'v142_foreign_owner_accepted';
  exception when insufficient_privilege then
    if sqlerrm<>'integration_access_denied' then raise; end if;
  end;
end
$owner_isolation$;
reset role;

set local role service_role;
select pg_temp.v142_assert((public.authenticate_minuta_integration_key_v142(
  current_setting('minuta.v142.key_id')::uuid,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'testing','calendar:write'
)->>'ok')::boolean,'api_key_auth');
select pg_temp.v142_assert(not (public.authenticate_minuta_integration_key_v142(
  current_setting('minuta.v142.key_id')::uuid,'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'testing','calendar:write'
)->>'ok')::boolean,'wrong_secret_denied');
select pg_temp.v142_assert((public.consume_minuta_integration_rate_limit_v142(
  current_setting('minuta.v142.connection')::uuid,current_setting('minuta.v142.key_id')::uuid,'mutation'
)->>'allowed')::boolean,'rate_limit_first_request');

do $calendar_history_bound$
begin
  begin
    perform public.upsert_minuta_integration_calendar_event_v142(
      current_setting('minuta.v142.connection')::uuid,repeat('9',64),repeat('e',64),'fixture:too-old',
      current_setting('minuta.v142.actor')::uuid,current_setting('minuta.v142.location')::uuid,
      (((current_date-40)+time '10:00') at time zone 'Europe/Samara')::timestamptz,
      (((current_date-40)+time '11:00') at time zone 'Europe/Samara')::timestamptz,
      'revision-old',null
    );
    raise exception 'v142_unbounded_history_accepted';
  exception when invalid_parameter_value then
    if sqlerrm<>'invalid_integration_calendar_event' then raise; end if;
  end;
end
$calendar_history_bound$;

select set_config('minuta.v142.created',public.upsert_minuta_integration_calendar_event_v142(
  current_setting('minuta.v142.connection')::uuid,repeat('1',64),repeat('a',64),'fixture:event-1',
  current_setting('minuta.v142.actor')::uuid,current_setting('minuta.v142.location')::uuid,
  current_setting('minuta.v142.start')::timestamptz,current_setting('minuta.v142.finish')::timestamptz,
  'revision-1',null
)::text,true);
select pg_temp.v142_assert((current_setting('minuta.v142.created')::jsonb->>'ok')::boolean,'calendar_create');
select pg_temp.v142_assert((public.upsert_minuta_integration_calendar_event_v142(
  current_setting('minuta.v142.connection')::uuid,repeat('1',64),repeat('a',64),'fixture:event-1',
  current_setting('minuta.v142.actor')::uuid,current_setting('minuta.v142.location')::uuid,
  current_setting('minuta.v142.start')::timestamptz,current_setting('minuta.v142.finish')::timestamptz,
  'revision-1',null
)->>'replayed')::boolean,'calendar_exact_replay');
select pg_temp.v142_assert(public.upsert_minuta_integration_calendar_event_v142(
  current_setting('minuta.v142.connection')::uuid,repeat('2',64),repeat('b',64),'fixture:event-1',
  current_setting('minuta.v142.actor')::uuid,current_setting('minuta.v142.location')::uuid,
  current_setting('minuta.v142.moved_start')::timestamptz,current_setting('minuta.v142.moved_finish')::timestamptz,
  'revision-2','stale-revision'
)->>'error'='revision_conflict','stale_revision_denied');

select pg_temp.v142_assert((public.upsert_minuta_integration_calendar_event_v142(
  current_setting('minuta.v142.connection')::uuid,repeat('3',64),repeat('c',64),'fixture:event-1',
  current_setting('minuta.v142.second_actor')::uuid,current_setting('minuta.v142.location')::uuid,
  current_setting('minuta.v142.moved_start')::timestamptz,current_setting('minuta.v142.moved_finish')::timestamptz,
  'revision-2','revision-1'
)->>'ok')::boolean,'calendar_revision_update');
reset role;
select pg_temp.v142_assert(exists(
  select 1 from public.integration_calendar_events_v142 mapping
  join public.bookings booking on booking.id=mapping.local_booking_id
  join public.services service on service.id=booking.service_id
  where mapping.connection_id=current_setting('minuta.v142.connection')::uuid
    and mapping.external_event_id='fixture:event-1'
    and booking.performer_id=current_setting('minuta.v142.second_actor')::uuid
    and service.performer_id=booking.performer_id
    and service.name='__PRIMETIME_EXTERNAL_CALENDAR__' and not service.active
    and booking.total_price_rub=0 and booking.deposit_amount_rub=0
    and booking.booking_policy_snapshot->>'notifications_suppressed'='true'
),'performer_change_updates_technical_service');
select pg_temp.v142_assert(not exists(
  select 1 from public.notification_outbox outbox
  join public.integration_calendar_events_v142 mapping on mapping.local_booking_id=outbox.booking_id
  where mapping.connection_id=current_setting('minuta.v142.connection')::uuid
),'external_block_has_no_notifications');
set local role service_role;
select pg_temp.v142_assert(jsonb_array_length(public.get_minuta_integration_calendar_v142(
  current_setting('minuta.v142.connection')::uuid,
  current_setting('minuta.v142.start')::timestamptz-interval '1 day',
  current_setting('minuta.v142.moved_finish')::timestamptz+interval '1 day',200,null,null
)->'events')=1,'calendar_read_is_tenant_bounded');

select pg_temp.v142_assert((public.delete_minuta_integration_calendar_event_v142(
  current_setting('minuta.v142.connection')::uuid,repeat('4',64),repeat('d',64),'fixture:event-1','revision-2'
)->>'deleted')::boolean,'calendar_delete');
select pg_temp.v142_assert((public.delete_minuta_integration_calendar_event_v142(
  current_setting('minuta.v142.connection')::uuid,repeat('4',64),repeat('d',64),'fixture:event-1','revision-2'
)->>'replayed')::boolean,'calendar_delete_replay');
select pg_temp.v142_assert((public.upsert_minuta_integration_calendar_event_v142(
  current_setting('minuta.v142.connection')::uuid,repeat('5',64),repeat('e',64),'fixture:event-1',
  current_setting('minuta.v142.actor')::uuid,current_setting('minuta.v142.location')::uuid,
  current_setting('minuta.v142.start')::timestamptz,current_setting('minuta.v142.finish')::timestamptz,
  'revision-3','revision-2'
)->>'ok')::boolean,'calendar_deleted_event_restore_with_revision_guard');
reset role;
select pg_temp.v142_assert(exists(
  select 1 from public.integration_calendar_events_v142 mapping
  join public.bookings booking on booking.id=mapping.local_booking_id
  where mapping.connection_id=current_setting('minuta.v142.connection')::uuid
    and mapping.external_event_id='fixture:event-1' and mapping.state='active'
    and mapping.source_revision='revision-3' and booking.status in('new','confirmed')
),'calendar_deleted_event_restored:'||coalesce((
  select jsonb_build_object(
    'mappingState',mapping.state,'sourceRevision',mapping.source_revision,
    'bookingStatus',booking.status,'performerMatches',booking.performer_id=current_setting('minuta.v142.actor')::uuid
  )::text
  from public.integration_calendar_events_v142 mapping
  join public.bookings booking on booking.id=mapping.local_booking_id
  where mapping.connection_id=current_setting('minuta.v142.connection')::uuid
    and mapping.external_event_id='fixture:event-1'
),'missing'));

select set_config('minuta.booking_organization',current_setting('minuta.v142.organization'),true);
select set_config('minuta.booking_location',current_setting('minuta.v142.location'),true);
insert into public.bookings(
  id,booking_code,manage_token,performer_id,service_id,client_name,client_phone,
  booking_date,booking_time,duration_minutes,original_price_rub,total_price_rub,status,
  deposit_amount_rub,payment_status,payment_url,provider_note,booking_policy_snapshot
) values(
  current_setting('minuta.v142.ordinary_booking')::uuid,'V142-'||substr(replace(gen_random_uuid()::text,'-',''),1,10),
  gen_random_uuid(),current_setting('minuta.v142.actor')::uuid,current_setting('minuta.v142.service')::uuid,
  'Secret client name','79990000000',current_setting('minuta.v142.date')::date,time '15:00',60,1420,1420,'new',
  0,'not_required','','Secret provider note','{}'::jsonb
);
select set_config('minuta.booking_organization','',true);
select set_config('minuta.booking_location','',true);

select pg_temp.v142_assert((select count(*)=1 from public.integration_webhook_outbox_v142
  where aggregate_id=current_setting('minuta.v142.ordinary_booking')::uuid and event_type='booking.created'),'webhook_enqueued');
select pg_temp.v142_assert(exists(select 1 from public.integration_booking_revisions_v142
  where booking_id=current_setting('minuta.v142.ordinary_booking')::uuid
    and organization_id=current_setting('minuta.v142.organization')::uuid),'booking_revision_sidecar_created');
select pg_temp.v142_assert(not exists(select 1 from public.integration_webhook_outbox_v142
  where payload::text~*'Secret client name|79990000000|Secret provider note'),'webhook_payload_is_pii_free');

set local role service_role;
select set_config('minuta.v142.lease',gen_random_uuid()::text,true);
select set_config('minuta.v142.leased',public.lease_minuta_integration_webhooks_v142(
  10,current_setting('minuta.v142.lease')::uuid
)::text,true);
select pg_temp.v142_assert(jsonb_array_length(current_setting('minuta.v142.leased')::jsonb->'deliveries')=1,'webhook_lease');
select pg_temp.v142_assert(
  current_setting('minuta.v142.leased')::jsonb#>>'{deliveries,0,subscriptionId}'=current_setting('minuta.v142.subscription')
  and current_setting('minuta.v142.leased')::jsonb#>>'{deliveries,0,connectionId}'=current_setting('minuta.v142.connection')
  and current_setting('minuta.v142.leased')::jsonb#>>'{deliveries,0,organizationId}'=current_setting('minuta.v142.organization'),
  'webhook_destination_binding'
);
select pg_temp.v142_assert((public.settle_minuta_integration_webhook_v142(
  (current_setting('minuta.v142.leased')::jsonb#>>'{deliveries,0,id}')::uuid,
  current_setting('minuta.v142.lease')::uuid,'retry',503,'http_503'
)->>'state')='retry','webhook_retry_settlement');
reset role;

delete from public.bookings
where id=current_setting('minuta.v142.ordinary_booking')::uuid;
select pg_temp.v142_assert(not exists(
  select 1 from public.bookings where id=current_setting('minuta.v142.ordinary_booking')::uuid
),'booking_delete_not_blocked_by_webhook_history');
select pg_temp.v142_assert(not exists(
  select 1 from public.integration_booking_revisions_v142
  where booking_id=current_setting('minuta.v142.ordinary_booking')::uuid
),'booking_revision_sidecar_cascades');
select pg_temp.v142_assert(exists(
  select 1 from public.integration_webhook_outbox_v142
  where aggregate_id=current_setting('minuta.v142.ordinary_booking')::uuid
),'pii_free_webhook_history_retained');

rollback;
