-- ISOLATED TEST DATABASE ONLY. All synthetic rows are transaction-scoped and rolled back.
-- Release rehearsal runs v153 apply twice, this test, exact rollback, then v153 apply again.
begin;

create function pg_temp.v153_assert(ok boolean,label text)
returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'v153_assert:%',label; end if;
end
$$;

select pg_temp.v153_assert(
  to_regprocedure('public.book_minuta_appointment_v2(uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer)') is not null,
  'atomic_create_function_present'
);
select pg_temp.v153_assert(
  has_function_privilege('anon','public.book_minuta_appointment_v2(uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer)','execute')
  and has_function_privilege('authenticated','public.book_minuta_appointment_v2(uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer)','execute')
  and not has_function_privilege('service_role','public.book_minuta_appointment_v2(uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer)','execute'),
  'public_create_acl'
);
select pg_temp.v153_assert(
  not exists(
    select 1
    from pg_catalog.pg_proc procedure_row,
      lateral aclexplode(coalesce(
        procedure_row.proacl,
        acldefault('f',procedure_row.proowner)
      )) grant_row
    where procedure_row.oid='public.book_minuta_appointment_v2(uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer)'::regprocedure
      and grant_row.grantee=0
      and grant_row.privilege_type='EXECUTE'
  ),
  'public_pseudorole_denied'
);
select pg_temp.v153_assert(
  (select procedure_row.provolatile='v'
      and procedure_row.prosecdef
      and not procedure_row.proisstrict
      and not procedure_row.proleakproof
      and procedure_row.proparallel='u'
      and procedure_row.proconfig=array['search_path=""']::text[]
      and pg_get_userbyid(procedure_row.proowner)='postgres'
      and encode(extensions.digest(
        convert_to(replace(procedure_row.prosrc,E'\r',''),'UTF8'),'sha256'
      ),'hex')='5920e1426745c8c5425cb15822474952557781b9959d3557f9f3b965e2aae1be'
      and obj_description(procedure_row.oid,'pg_proc') like 'minuta_atomic_create_v153:sha256=%'
   from pg_catalog.pg_proc procedure_row
   where procedure_row.oid='public.book_minuta_appointment_v2(uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer)'::regprocedure),
  'runtime_and_reapply_rollback_contract'
);

do $fixture$
declare
  v_source_service record;
  v_organization uuid:=gen_random_uuid();
  v_location uuid:=gen_random_uuid();
  v_service uuid:=gen_random_uuid();
  v_request uuid:=gen_random_uuid();
  v_price_request uuid:=gen_random_uuid();
  v_duration_request uuid:=gen_random_uuid();
  v_slot record;
begin
  select candidate.performer_id,candidate.duration_minutes
  into v_source_service
  from public.services candidate
  join public.organization_memberships membership
    on membership.user_id=candidate.performer_id
   and membership.active
   and membership.is_bookable
  join public.organizations organization
    on organization.id=membership.organization_id
   and organization.status='active'
  where candidate.active
    and exists(
      select 1
      from public.get_available_slots(candidate.id,current_date+1,current_date+62) available
    )
  order by candidate.id
  limit 1;
  if v_source_service.performer_id is null then
    raise exception using errcode='55000',message='v153_test_requires_available_performer';
  end if;

  insert into public.organizations(
    id,name,public_slug,status,public_booking_enabled,created_by
  ) values(
    v_organization,'V153 isolated organization',
    'v153-'||replace(v_organization::text,'-',''),'active',true,
    v_source_service.performer_id
  );
  insert into public.locations(
    id,organization_id,name,address,timezone,active,is_primary
  ) values(
    v_location,v_organization,'V153 isolated location','V153 test address',
    'Europe/Samara',true,true
  );
  insert into public.organization_memberships(
    organization_id,user_id,role,is_bookable,active,created_by
  ) values(
    v_organization,v_source_service.performer_id,'owner',true,true,
    v_source_service.performer_id
  );
  insert into public.services(
    id,performer_id,name,duration_minutes,price_rub,active
  ) values(
    v_service,v_source_service.performer_id,'V153 atomic service',
    v_source_service.duration_minutes,1530,true
  );

  select available.booking_date,available.booking_time
  into v_slot
  from public.get_available_slots(v_service,current_date+1,current_date+62) available
  order by available.booking_date,available.booking_time
  limit 1;
  if v_slot.booking_date is null then
    raise exception using errcode='55000',message='v153_test_synthetic_slot_missing';
  end if;

  perform set_config('v153.organization',v_organization::text,true);
  perform set_config('v153.location',v_location::text,true);
  perform set_config('v153.service',v_service::text,true);
  perform set_config('v153.performer',v_source_service.performer_id::text,true);
  perform set_config('v153.slug','v153-'||replace(v_organization::text,'-',''),true);
  perform set_config('v153.request',v_request::text,true);
  perform set_config('v153.price_request',v_price_request::text,true);
  perform set_config('v153.duration_request',v_duration_request::text,true);
  perform set_config('v153.date',v_slot.booking_date::text,true);
  perform set_config('v153.time',v_slot.booking_time::text,true);
  perform set_config('v153.duration',v_source_service.duration_minutes::text,true);
end
$fixture$;

set local role anon;
select set_config('v153.created',(
  select to_jsonb(created)::text
  from public.book_minuta_appointment_v2(
    current_setting('v153.request')::uuid,current_setting('v153.slug'),
    current_setting('v153.location')::uuid,current_setting('v153.service')::uuid,
    current_setting('v153.date')::date,current_setting('v153.time')::time,
    'V153 Synthetic Client','+79990001530',1530,
    current_setting('v153.duration')::integer
  ) created
),true);
reset role;

select pg_temp.v153_assert(
  current_setting('v153.created')::jsonb->>'result_code'='ok'
  and current_setting('v153.created')::jsonb->>'booking_code' is not null
  and current_setting('v153.created')::jsonb->>'manage_token' is not null
  and (current_setting('v153.created')::jsonb->>'request_id')::uuid=current_setting('v153.request')::uuid
  and (current_setting('v153.created')::jsonb->>'service_id')::uuid=current_setting('v153.service')::uuid
  and (current_setting('v153.created')::jsonb->>'duration_minutes')::integer=current_setting('v153.duration')::integer
  and (current_setting('v153.created')::jsonb->>'original_price_rub')::integer=1530
  and (current_setting('v153.created')::jsonb->>'total_price_rub')::integer=1530
  and current_setting('v153.created')::jsonb->>'status' in ('new','confirmed')
  and (current_setting('v153.created')::jsonb->>'current_price_rub')::integer=1530
  and (current_setting('v153.created')::jsonb->>'current_duration_minutes')::integer=current_setting('v153.duration')::integer,
  'atomic_create_exact_committed_terms'
);
select pg_temp.v153_assert(
  (select count(*)=1
   from public.bookings booking
   where booking.request_id=current_setting('v153.request')::uuid
     and booking.service_id=current_setting('v153.service')::uuid
     and booking.booking_date=current_setting('v153.date')::date
     and booking.booking_time=current_setting('v153.time')::time
     and booking.duration_minutes=current_setting('v153.duration')::integer
     and booking.original_price_rub=1530
     and booking.total_price_rub=1530),
  'single_committed_booking'
);

set local role anon;
select set_config('v153.price_mismatch',(
  select to_jsonb(changed)::text
  from public.book_minuta_appointment_v2(
    current_setting('v153.price_request')::uuid,current_setting('v153.slug'),
    current_setting('v153.location')::uuid,current_setting('v153.service')::uuid,
    current_setting('v153.date')::date,current_setting('v153.time')::time,
    'V153 Price Mismatch','+79990001531',1529,
    current_setting('v153.duration')::integer
  ) changed
),true);
select set_config('v153.duration_mismatch',(
  select to_jsonb(changed)::text
  from public.book_minuta_appointment_v2(
    current_setting('v153.duration_request')::uuid,current_setting('v153.slug'),
    current_setting('v153.location')::uuid,current_setting('v153.service')::uuid,
    current_setting('v153.date')::date,current_setting('v153.time')::time,
    'V153 Duration Mismatch','+79990001532',1530,
    case when current_setting('v153.duration')::integer=480 then 479
      else current_setting('v153.duration')::integer+1 end
  ) changed
),true);
reset role;

select pg_temp.v153_assert(
  current_setting('v153.price_mismatch')::jsonb->>'result_code'='service_terms_changed'
  and current_setting('v153.price_mismatch')::jsonb->>'booking_code' is null
  and (current_setting('v153.price_mismatch')::jsonb->>'current_price_rub')::integer=1530
  and (current_setting('v153.price_mismatch')::jsonb->>'current_duration_minutes')::integer=current_setting('v153.duration')::integer
  and current_setting('v153.duration_mismatch')::jsonb->>'result_code'='service_terms_changed'
  and current_setting('v153.duration_mismatch')::jsonb->>'booking_code' is null
  and not exists(
    select 1 from public.bookings booking
    where booking.request_id in(
      current_setting('v153.price_request')::uuid,
      current_setting('v153.duration_request')::uuid
    )
  ),
  'terms_mismatch_returns_current_terms_without_insert'
);

update public.services
set active=false,price_rub=1730
where id=current_setting('v153.service')::uuid;
update public.organization_memberships
set active=false,is_bookable=false
where organization_id=current_setting('v153.organization')::uuid
  and user_id=current_setting('v153.performer')::uuid;
update public.locations
set active=false
where id=current_setting('v153.location')::uuid;
update public.organizations
set status='suspended',public_booking_enabled=false
where id=current_setting('v153.organization')::uuid;

set local role anon;
select set_config('v153.replayed',(
  select to_jsonb(replayed)::text
  from public.book_minuta_appointment_v2(
    current_setting('v153.request')::uuid,current_setting('v153.slug'),
    current_setting('v153.location')::uuid,current_setting('v153.service')::uuid,
    current_setting('v153.date')::date,current_setting('v153.time')::time,
    'V153 Synthetic Client','+79990001530',1530,
    current_setting('v153.duration')::integer
  ) replayed
),true);
reset role;

select pg_temp.v153_assert(
  current_setting('v153.replayed')::jsonb->>'result_code'='ok'
  and current_setting('v153.replayed')::jsonb->>'booking_code'=
    current_setting('v153.created')::jsonb->>'booking_code'
  and current_setting('v153.replayed')::jsonb->>'manage_token'=
    current_setting('v153.created')::jsonb->>'manage_token'
  and (current_setting('v153.replayed')::jsonb->>'original_price_rub')::integer=1530
  and (current_setting('v153.replayed')::jsonb->>'total_price_rub')::integer=1530
  and (select count(*)=1 from public.bookings booking
       where booking.request_id=current_setting('v153.request')::uuid),
  'replay_survives_catalog_deactivation_without_duplicate'
);

set local role anon;
do $request_conflicts$
begin
  begin
    perform public.book_minuta_appointment_v2(
      current_setting('v153.request')::uuid,current_setting('v153.slug'),
      current_setting('v153.location')::uuid,current_setting('v153.service')::uuid,
      current_setting('v153.date')::date,current_setting('v153.time')::time,
      'V153 Changed Client','+79990001530',1530,
      current_setting('v153.duration')::integer
    );
    raise exception 'v153_changed_fingerprint_accepted';
  exception when raise_exception then
    if sqlerrm<>'request_conflict' then raise; end if;
  end;
  begin
    perform public.book_minuta_appointment_v2(
      current_setting('v153.request')::uuid,current_setting('v153.slug'),
      gen_random_uuid(),current_setting('v153.service')::uuid,
      current_setting('v153.date')::date,current_setting('v153.time')::time,
      'V153 Synthetic Client','+79990001530',1530,
      current_setting('v153.duration')::integer
    );
    raise exception 'v153_changed_scope_accepted';
  exception when raise_exception then
    if sqlerrm<>'request_conflict' then raise; end if;
  end;
end
$request_conflicts$;
reset role;

select pg_temp.v153_assert(
  (select count(*)=1 from public.bookings booking
   where booking.request_id=current_setting('v153.request')::uuid),
  'request_conflicts_preserved_single_booking'
);

set local role service_role;
do $private_role_denied$
begin
  begin
    perform public.book_minuta_appointment_v2(
      current_setting('v153.request')::uuid,current_setting('v153.slug'),
      current_setting('v153.location')::uuid,current_setting('v153.service')::uuid,
      current_setting('v153.date')::date,current_setting('v153.time')::time,
      'V153 Synthetic Client','+79990001530',1530,
      current_setting('v153.duration')::integer
    );
    raise exception 'v153_service_role_execute_accepted';
  exception when insufficient_privilege then null;
  end;
end
$private_role_denied$;
reset role;

rollback;
