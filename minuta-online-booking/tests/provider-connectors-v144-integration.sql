-- ISOLATED TEST DATABASE ONLY. All fixtures and writes are rolled back.
\set ON_ERROR_STOP on

begin;
set local statement_timeout='60s';
set local lock_timeout='15s';
set local search_path=public,extensions,pg_catalog;

create function pg_temp.v144_assert(ok boolean,label text)
returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'v144_assert:%',label; end if;
end
$$;

do $acl$
declare signature text; relation_name text; role_name text; privilege_name text;
begin
  foreach signature in array array[
    'public.apply_minuta_payment_sandbox_v144(uuid,uuid,uuid,text,integer,text,bigint,text)',
    'public.get_minuta_payment_sandbox_journal_v144(uuid,uuid)',
    'public.get_minuta_provider_connector_read_model_v144(uuid,integer)'
  ] loop
    if not has_function_privilege('authenticated',signature,'EXECUTE')
       or has_function_privilege('anon',signature,'EXECUTE')
       or has_function_privilege('service_role',signature,'EXECUTE') then
      raise exception 'v144_authenticated_rpc_acl:%',signature;
    end if;
  end loop;
  foreach signature in array array[
    'public.record_minuta_provider_event_v144(uuid,uuid,text,text,text,jsonb)',
    'public.settle_minuta_provider_event_v144(uuid,text,jsonb,text)'
  ] loop
    if not has_function_privilege('service_role',signature,'EXECUTE')
       or has_function_privilege('anon',signature,'EXECUTE')
       or has_function_privilege('authenticated',signature,'EXECUTE') then
      raise exception 'v144_service_rpc_acl:%',signature;
    end if;
  end loop;
  foreach relation_name in array array[
    'public.payment_sandbox_ledgers_v144','public.payment_sandbox_commands_v144',
    'public.integration_provider_events_v144'
  ] loop
    foreach role_name in array array['anon','authenticated','service_role'] loop
      foreach privilege_name in array array['SELECT','INSERT','UPDATE','DELETE'] loop
        if has_table_privilege(role_name,relation_name,privilege_name) then
          raise exception 'v144_direct_table_acl:%:%:%',role_name,relation_name,privilege_name;
        end if;
      end loop;
    end loop;
  end loop;
end
$acl$;

do $fixture$
declare
  owner_id uuid:=gen_random_uuid();
  admin_id uuid:=gen_random_uuid();
  outsider_id uuid:=gen_random_uuid();
  organization_id uuid:=gen_random_uuid();
  foreign_organization_id uuid:=gen_random_uuid();
  location_id uuid:=gen_random_uuid();
  service_id uuid:=gen_random_uuid();
  booking_id uuid:=gen_random_uuid();
  payment_id uuid:=gen_random_uuid();
  dikidi_connection_id uuid:=gen_random_uuid();
  yclients_connection_id uuid:=gen_random_uuid();
  booking_date date:=(clock_timestamp() at time zone 'Europe/Samara')::date+7;
begin
  perform set_config('minuta.v144.owner',owner_id::text,true);
  perform set_config('minuta.v144.admin',admin_id::text,true);
  perform set_config('minuta.v144.outsider',outsider_id::text,true);
  perform set_config('minuta.v144.organization',organization_id::text,true);
  perform set_config('minuta.v144.foreign_organization',foreign_organization_id::text,true);
  perform set_config('minuta.v144.location',location_id::text,true);
  perform set_config('minuta.v144.service',service_id::text,true);
  perform set_config('minuta.v144.booking',booking_id::text,true);
  perform set_config('minuta.v144.payment',payment_id::text,true);
  perform set_config('minuta.v144.dikidi_connection',dikidi_connection_id::text,true);
  perform set_config('minuta.v144.yclients_connection',yclients_connection_id::text,true);
  perform set_config('minuta.v144.date',booking_date::text,true);

  set local session_replication_role=replica;
  insert into auth.users(
    id,instance_id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at
  ) values
    (owner_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',owner_id::text||'@example.invalid',now(),'{}','{}',now(),now()),
    (admin_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',admin_id::text||'@example.invalid',now(),'{}','{}',now(),now()),
    (outsider_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',outsider_id::text||'@example.invalid',now(),'{}','{}',now(),now());
  set local session_replication_role=origin;

  insert into public.performer_profiles(id,display_name) values
    (owner_id,'V144 owner'),(admin_id,'V144 admin'),(outsider_id,'V144 outsider');
  insert into public.organizations(id,name,public_slug,status,public_booking_enabled,created_by) values
    (organization_id,'V144 organization','v144-'||replace(organization_id::text,'-',''),'active',true,owner_id),
    (foreign_organization_id,'V144 foreign','v144-'||replace(foreign_organization_id::text,'-',''),'active',true,outsider_id);
  insert into public.locations(id,organization_id,name,timezone,address,active,is_primary)
  values(location_id,organization_id,'V144 location','Europe/Samara','V144 address',true,true);
  insert into public.organization_memberships(
    organization_id,user_id,role,is_bookable,active,created_by
  ) values
    (organization_id,owner_id,'owner',true,true,owner_id),
    (organization_id,admin_id,'admin',true,true,owner_id),
    (foreign_organization_id,outsider_id,'owner',true,true,outsider_id);
  insert into public.services(id,performer_id,name,duration_minutes,price_rub,active)
  values(service_id,owner_id,'V144 service',60,2500,true);

  perform set_config('minuta.booking_organization',organization_id::text,true);
  perform set_config('minuta.booking_location',location_id::text,true);
  insert into public.bookings(
    id,booking_code,manage_token,performer_id,service_id,client_name,client_phone,
    booking_date,booking_time,duration_minutes,original_price_rub,total_price_rub,status,
    deposit_amount_rub,payment_status,payment_url,provider_note,booking_policy_snapshot
  ) values(
    booking_id,'V144-'||substr(replace(gen_random_uuid()::text,'-',''),1,10),gen_random_uuid(),
    owner_id,service_id,'V144 private client','79990000144',booking_date,time '15:00',60,
    2500,2500,'new',0,'not_required','','V144 private note','{}'::jsonb
  );
  perform set_config('minuta.booking_organization','',true);
  perform set_config('minuta.booking_location','',true);
end
$fixture$;

set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('minuta.v144.owner'),true);
select public.configure_minuta_integration_connection_v142(
  current_setting('minuta.v144.organization')::uuid,
  current_setting('minuta.v144.dikidi_connection')::uuid,
  'dikidi','testing','dikidi.location.144',true
);
select public.configure_minuta_integration_connection_v142(
  current_setting('minuta.v144.organization')::uuid,
  current_setting('minuta.v144.yclients_connection')::uuid,
  'yclients','testing','yclients.location.144',false
);

select set_config('minuta.v144.payment_state',public.apply_minuta_payment_sandbox_v144(
  current_setting('minuta.v144.organization')::uuid,current_setting('minuta.v144.payment')::uuid,
  current_setting('minuta.v144.booking')::uuid,'v144-payment-create',0,'create',250000,'booking_prepayment'
)::text,true);
select pg_temp.v144_assert(
  current_setting('minuta.v144.payment_state')::jsonb->>'status'='created'
  and (current_setting('minuta.v144.payment_state')::jsonb->>'sandbox')::boolean,
  'sandbox_created'
);
select public.apply_minuta_payment_sandbox_v144(
  current_setting('minuta.v144.organization')::uuid,current_setting('minuta.v144.payment')::uuid,
  current_setting('minuta.v144.booking')::uuid,'v144-payment-authorize',1,'authorize',null,null
);
select public.apply_minuta_payment_sandbox_v144(
  current_setting('minuta.v144.organization')::uuid,current_setting('minuta.v144.payment')::uuid,
  current_setting('minuta.v144.booking')::uuid,'v144-payment-capture',2,'capture',null,null
);
select set_config('minuta.v144.refund',public.apply_minuta_payment_sandbox_v144(
  current_setting('minuta.v144.organization')::uuid,current_setting('minuta.v144.payment')::uuid,
  current_setting('minuta.v144.booking')::uuid,'v144-payment-refund',3,'refund',40000,null
)::text,true);
select pg_temp.v144_assert(
  current_setting('minuta.v144.refund')::jsonb->>'status'='partially_refunded'
  and (current_setting('minuta.v144.refund')::jsonb->>'version')::integer=4,
  'sandbox_partial_refund'
);
select pg_temp.v144_assert((public.apply_minuta_payment_sandbox_v144(
  current_setting('minuta.v144.organization')::uuid,current_setting('minuta.v144.payment')::uuid,
  current_setting('minuta.v144.booking')::uuid,'v144-payment-refund',3,'refund',40000,null
)->>'replayed')::boolean,'sandbox_exact_replay');

do $sandbox_conflict$
begin
  begin
    perform public.apply_minuta_payment_sandbox_v144(
      current_setting('minuta.v144.organization')::uuid,current_setting('minuta.v144.payment')::uuid,
      current_setting('minuta.v144.booking')::uuid,'v144-payment-refund',3,'refund',40001,null
    );
    raise exception 'v144_sandbox_conflict_accepted';
  exception when unique_violation then
    if sqlerrm<>'sandbox_payment_idempotency_conflict' then raise; end if;
  end;
end
$sandbox_conflict$;
select pg_temp.v144_assert(
  jsonb_array_length(public.get_minuta_payment_sandbox_journal_v144(
    current_setting('minuta.v144.organization')::uuid,current_setting('minuta.v144.payment')::uuid
  )->'journal')=4,
  'sandbox_journal_is_durable_and_replay_safe'
);

select set_config('request.jwt.claim.sub',current_setting('minuta.v144.outsider'),true);
do $sandbox_tenant_isolation$
begin
  begin
    perform public.get_minuta_payment_sandbox_journal_v144(
      current_setting('minuta.v144.organization')::uuid,current_setting('minuta.v144.payment')::uuid
    );
    raise exception 'v144_foreign_sandbox_read_accepted';
  exception when insufficient_privilege then
    if sqlerrm<>'payment_access_denied' then raise; end if;
  end;
end
$sandbox_tenant_isolation$;
reset role;

set local role service_role;
select set_config('minuta.v144.provider_command',jsonb_build_object(
  'action','upsert_booking','externalLocationId','dikidi.location.144',
  'externalBookingId','booking.144','staffExternalId','staff.144',
  'serviceExternalIds',jsonb_build_array('service.2','service.1'),
  'startsAt','2026-09-20T10:00:00.000Z','endsAt','2026-09-20T11:00:00.000Z'
)::text,true);
select set_config('minuta.v144.provider_event',public.record_minuta_provider_event_v144(
  current_setting('minuta.v144.dikidi_connection')::uuid,current_setting('minuta.v144.organization')::uuid,
  'private.provider.event.144',repeat('a',64),
  'booking.updated',current_setting('minuta.v144.provider_command')::jsonb
)::text,true);
select pg_temp.v144_assert(
  current_setting('minuta.v144.provider_event')::jsonb->>'state'='accepted'
  and not (current_setting('minuta.v144.provider_event')::jsonb->>'replayed')::boolean,
  'provider_event_accepted'
);
select pg_temp.v144_assert((public.record_minuta_provider_event_v144(
  current_setting('minuta.v144.dikidi_connection')::uuid,current_setting('minuta.v144.organization')::uuid,
  'private.provider.event.144',repeat('a',64),
  'booking.updated',current_setting('minuta.v144.provider_command')::jsonb
)->>'replayed')::boolean,'provider_event_exact_replay');

do $provider_conflict$
begin
  begin
    perform public.record_minuta_provider_event_v144(
      current_setting('minuta.v144.dikidi_connection')::uuid,current_setting('minuta.v144.organization')::uuid,
      'private.provider.event.144',repeat('b',64),
      'booking.updated',current_setting('minuta.v144.provider_command')::jsonb
    );
    raise exception 'v144_provider_conflict_accepted';
  exception when unique_violation then
    if sqlerrm<>'provider_event_idempotency_conflict' then raise; end if;
  end;
end
$provider_conflict$;

do $provider_command_validation$
begin
  begin
    perform public.record_minuta_provider_event_v144(
      current_setting('minuta.v144.dikidi_connection')::uuid,current_setting('minuta.v144.organization')::uuid,
      'invalid.provider.event.144',repeat('c',64),
      'booking.updated',jsonb_build_object(
        'action','upsert_booking','externalLocationId','dikidi.location.144',
        'externalBookingId','booking.invalid','staffExternalId','staff.144',
        'startsAt','2026-09-20T10:00:00.000Z','endsAt','2026-09-20T11:00:00.000Z'
      )
    );
    raise exception 'v144_incomplete_provider_command_accepted';
  exception when invalid_parameter_value then
    if sqlerrm<>'invalid_provider_command' then raise; end if;
  end;
end
$provider_command_validation$;

do $provider_tenant_binding$
begin
  begin
    perform public.record_minuta_provider_event_v144(
      current_setting('minuta.v144.dikidi_connection')::uuid,
      current_setting('minuta.v144.foreign_organization')::uuid,
      'foreign.provider.event.144',repeat('d',64),'booking.updated',
      current_setting('minuta.v144.provider_command')::jsonb
    );
    raise exception 'v144_cross_tenant_provider_event_accepted';
  exception when insufficient_privilege then
    if sqlerrm<>'provider_connection_not_available' then raise; end if;
  end;
end
$provider_tenant_binding$;

select pg_temp.v144_assert((public.settle_minuta_provider_event_v144(
  (current_setting('minuta.v144.provider_event')::jsonb->>'eventId')::uuid,'processed',
  jsonb_build_object('outcome','applied','localBookingId',current_setting('minuta.v144.booking')),
  null
)->>'state')='processed','provider_event_settled');

do $provider_outcome_privacy$
begin
  begin
    perform public.settle_minuta_provider_event_v144(
      (current_setting('minuta.v144.provider_event')::jsonb->>'eventId')::uuid,'processed',
      jsonb_build_object('outcome','applied','clientPhone','79990000144'),null
    );
    raise exception 'v144_private_provider_outcome_accepted';
  exception when invalid_parameter_value then
    if sqlerrm<>'invalid_provider_event_outcome' then raise; end if;
  end;
end
$provider_outcome_privacy$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('minuta.v144.admin'),true);
select set_config('minuta.v144.read_model',public.get_minuta_provider_connector_read_model_v144(
  current_setting('minuta.v144.organization')::uuid,20
)::text,true);
select pg_temp.v144_assert(
  current_setting('minuta.v144.read_model')::jsonb->>'organizationId'=current_setting('minuta.v144.organization')
  and current_setting('minuta.v144.read_model')::jsonb->>'currentRole'='admin'
  and jsonb_array_length(current_setting('minuta.v144.read_model')::jsonb->'connections')=2
  and jsonb_array_length(current_setting('minuta.v144.read_model')::jsonb->'recentEvents')=1,
  'owner_admin_read_model_scope'
);
select pg_temp.v144_assert(
  current_setting('minuta.v144.read_model')::jsonb#>>'{recentEvents,0,state}'='processed'
  and current_setting('minuta.v144.read_model')::jsonb#>>'{recentEvents,0,provider}'='dikidi'
  and current_setting('minuta.v144.read_model')::jsonb#>>'{connections,0,status}' in('active','disabled'),
  'read_model_states'
);
select pg_temp.v144_assert(
  current_setting('minuta.v144.read_model')!~*'private.provider.event.144|79990000144|payloadSha256|secret_ref|command|result',
  'read_model_is_anonymized'
);

select set_config('request.jwt.claim.sub',current_setting('minuta.v144.outsider'),true);
do $read_model_tenant_isolation$
begin
  begin
    perform public.get_minuta_provider_connector_read_model_v144(
      current_setting('minuta.v144.organization')::uuid,20
    );
    raise exception 'v144_foreign_read_model_accepted';
  exception when insufficient_privilege then
    if sqlerrm<>'integration_access_denied' then raise; end if;
  end;
end
$read_model_tenant_isolation$;
reset role;

rollback;
