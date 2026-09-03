begin;

do $$
begin
  if to_regprocedure('public.get_minuta_team_analytics(uuid,date,date)') is null
     or to_regclass('public.booking_events') is null
     or to_regprocedure('public.get_minuta_staff_report_bookings_v97(uuid,date,date,uuid,integer,integer)') is null
     or to_regprocedure('public.get_minuta_booking_events_v97(uuid,date,date,integer,integer)') is null
     or to_regprocedure('public.provider_delete_booking(uuid)') is null then
    raise exception using errcode='P0001',message='v97_test_requires_v97';
  end if;
  if public.minuta_booking_value_v93(
    '{"service_id":null,"duration_minutes":60,"original_price_rub":1000,"total_price_rub":4321}'::jsonb,
    null
  ) <> 4321 then
    raise exception using errcode='P0001',message='v97_total_price_not_authoritative';
  end if;
  if not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conname='booking_events_booking_id_fkey'
      and constraint_row.conrelid='public.booking_events'::regclass
      and constraint_row.confrelid='public.bookings'::regclass
      and constraint_row.contype='f'
      and constraint_row.confdeltype='n'
      and constraint_row.convalidated
      and array_length(constraint_row.conkey,1)=1
      and array_length(constraint_row.confkey,1)=1
      and (select attribute_row.attname from pg_attribute attribute_row where attribute_row.attrelid=constraint_row.conrelid and attribute_row.attnum=constraint_row.conkey[1])='booking_id'
      and (select attribute_row.attname from pg_attribute attribute_row where attribute_row.attrelid=constraint_row.confrelid and attribute_row.attnum=constraint_row.confkey[1])='id'
  ) then
    raise exception using errcode='P0001',message='v97_booking_event_delete_contract_failed';
  end if;
  if exists (
    select 1
    from pg_class index_class
    join pg_namespace namespace_row on namespace_row.oid=index_class.relnamespace
    join pg_index index_row on index_row.indexrelid=index_class.oid
    where namespace_row.nspname='public'
      and index_class.relname in (
        'bookings_performer_date_time_v94_idx',
        'booking_events_scope_previous_date_v96_idx',
        'booking_outcomes_completed_performer_v97_idx'
      )
      and (not index_row.indisvalid or not index_row.indisready)
  ) or (
    select count(*)
    from pg_class index_class
    join pg_namespace namespace_row on namespace_row.oid=index_class.relnamespace
    where namespace_row.nspname='public'
      and index_class.relname in (
        'bookings_performer_date_time_v94_idx',
        'booking_events_scope_previous_date_v96_idx',
        'booking_outcomes_completed_performer_v97_idx'
      )
  ) <> 3 or exists (
    select 1
    from pg_class index_class
    join pg_namespace namespace_row on namespace_row.oid=index_class.relnamespace
    join pg_index index_row on index_row.indexrelid=index_class.oid
    where namespace_row.nspname='public'
      and case index_class.relname
        when 'bookings_performer_date_time_v94_idx' then
          regexp_replace(lower(pg_get_indexdef(index_row.indexrelid)),'\s','','g') <>
            'createindexbookings_performer_date_time_v94_idxonpublic.bookingsusingbtree(performer_id,booking_date,booking_time)'
        when 'booking_events_scope_previous_date_v96_idx' then
          regexp_replace(lower(pg_get_indexdef(index_row.indexrelid)),'\s','','g') <>
            'createindexbooking_events_scope_previous_date_v96_idxonpublic.booking_eventsusingbtree(organization_id,previous_booking_date,occurred_atdesc,iddesc)where(previous_booking_dateisnotnull)'
        when 'booking_outcomes_completed_performer_v97_idx' then
          regexp_replace(lower(pg_get_indexdef(index_row.indexrelid)),'\s','','g') <>
            'createindexbooking_outcomes_completed_performer_v97_idxonpublic.booking_outcomesusingbtree(completed_performer_id)where(visit_status=''completed''::text)'
        else false
      end
  ) then
    raise exception using errcode='P0001',message='v97_index_contract_failed';
  end if;
end $$;

set local session_replication_role=replica;
insert into auth.users(
  id,instance_id,aud,role,email,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values(
  '00000000-0000-4000-8000-000000009504',
  '00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','v97-foreign@example.invalid',now(),
  '{}'::jsonb,'{}'::jsonb,now(),now()
);
set local session_replication_role=origin;

select set_config(
  'minuta.v97_owner',
  (select organization.legacy_performer_id::text
   from public.organizations organization
   where organization.legacy_performer_id is not null
     and organization.public_booking_enabled
     and organization.status='active'
   order by organization.id limit 1),
  true
);
select set_config(
  'minuta.v97_org',
  (select organization.id::text
   from public.organizations organization
   where organization.legacy_performer_id=current_setting('minuta.v97_owner')::uuid
   order by organization.id limit 1),
  true
);
select set_config(
  'minuta.v97_location',
  (select location.id::text
   from public.locations location
   where location.organization_id=current_setting('minuta.v97_org')::uuid
     and location.active
   order by location.is_primary desc,location.id limit 1),
  true
);
select set_config(
  'minuta.v97_slug',
  (select organization.public_slug
   from public.organizations organization
   where organization.id=current_setting('minuta.v97_org')::uuid),
  true
);
select set_config(
  'minuta.v97_slot',
  coalesce((
    select to_jsonb(candidate)::text
    from (
      select service.id service_id,service.performer_id,
             available.booking_date,available.booking_time
      from public.services service
      join public.organization_memberships membership
        on membership.organization_id=current_setting('minuta.v97_org')::uuid
       and membership.user_id=service.performer_id
       and membership.active and membership.is_bookable
      cross join lateral public.get_available_slots(
        service.id,current_date+1,current_date+62
      ) available
      where service.active
      order by available.booking_date,available.booking_time,service.id
      limit 1
    ) candidate
  ),'{}'),
  true
);

do $$
begin
  if current_setting('minuta.v97_owner',true) is null
     or current_setting('minuta.v97_org',true) is null
     or current_setting('minuta.v97_location',true) is null
     or current_setting('minuta.v97_slot',true)='{}' then
    raise exception using errcode='P0001',message='v97_test_fixture_missing';
  end if;
end $$;

-- A user managing two organizations must be able to request one explicitly.
insert into public.organizations(id,name,public_slug,created_by)
values(
  '00000000-0000-4000-8000-000000009501',
  'V97 second organization',
  'v97-second-organization',
  current_setting('minuta.v97_owner')::uuid
);
insert into public.organization_memberships(
  organization_id,user_id,role,is_bookable,active,created_by
)
values(
  '00000000-0000-4000-8000-000000009501',
  current_setting('minuta.v97_owner')::uuid,
  'owner',false,true,current_setting('minuta.v97_owner')::uuid
);
select set_config('request.jwt.claim.sub',current_setting('minuta.v97_owner'),true);
set local role authenticated;
do $$
declare
  v_payload jsonb:=public.get_minuta_team_analytics(
    current_setting('minuta.v97_org')::uuid,current_date-31,current_date
  );
begin
  if (v_payload->>'organization_id')::uuid<>current_setting('minuta.v97_org')::uuid
     or (v_payload->>'can_view_team')::boolean is not true then
    raise exception using errcode='P0001',message='v97_explicit_organization_analytics_failed';
  end if;
end $$;
reset role;

-- An unrelated authenticated user gets no team data from another tenant.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000009504',true);
set local role authenticated;
do $$
declare
  v_payload jsonb:=public.get_minuta_team_analytics(
    current_setting('minuta.v97_org')::uuid,current_date-31,current_date
  );
begin
  if coalesce((v_payload->>'can_view_team')::boolean,true)
     or jsonb_array_length(coalesce(v_payload->'performers','[]'::jsonb))<>0 then
    raise exception using errcode='P0001',message='v97_cross_tenant_analytics_leak';
  end if;
end $$;
reset role;

-- Create a real event, then prove the protected v64 deletion path is no longer
-- blocked by booking_events.
select set_config('request.jwt.claim.sub','',true);
set local role anon;
select * from public.book_minuta_appointment(
  '00000000-0000-4000-8000-000000009502',
  current_setting('minuta.v97_slug'),
  current_setting('minuta.v97_location')::uuid,
  (current_setting('minuta.v97_slot')::jsonb->>'service_id')::uuid,
  (current_setting('minuta.v97_slot')::jsonb->>'booking_date')::date,
  (current_setting('minuta.v97_slot')::jsonb->>'booking_time')::time,
  'V97 Delete Test','+79990009502'
);
reset role;
select set_config(
  'minuta.v97_booking',
  (select booking.id::text from public.bookings booking
   where booking.request_id='00000000-0000-4000-8000-000000009502'::uuid),
  true
);
do $$
begin
  if not exists (
    select 1 from public.booking_events event
    where event.booking_id=current_setting('minuta.v97_booking')::uuid
      and event.event_type='booking_created_online'
  ) then
    raise exception using errcode='P0001',message='v97_booking_event_not_created';
  end if;
end $$;
select set_config(
  'minuta.v97_event',
  (select event.id::text from public.booking_events event
   where event.booking_id=current_setting('minuta.v97_booking')::uuid
   order by event.id desc limit 1),
  true
);
select set_config(
  'request.jwt.claim.sub',
  (current_setting('minuta.v97_slot')::jsonb->>'performer_id'),
  true
);
set local role authenticated;
do $$
begin
  if public.provider_delete_booking(current_setting('minuta.v97_booking')::uuid)<>'deleted' then
    raise exception using errcode='P0001',message='v97_provider_delete_failed';
  end if;
end $$;
reset role;
do $$
begin
  if exists(select 1 from public.bookings where id=current_setting('minuta.v97_booking')::uuid)
     or not exists(select 1 from public.booking_events event
       where event.id=current_setting('minuta.v97_event')::bigint
         and event.booking_id is null
         and event.client_name_snapshot is not null
         and event.service_name_snapshot is not null
         and event.performer_name_snapshot is not null) then
    raise exception using errcode='P0001',message='v97_booking_event_history_was_not_preserved';
  end if;
end $$;

-- Reuse the now-free slot and exercise the exact SET NULL transition used by
-- auth.users ON DELETE, while preserving source and role.
select set_config('request.jwt.claim.sub','',true);
set local role anon;
select * from public.book_minuta_appointment(
  '00000000-0000-4000-8000-000000009503',
  current_setting('minuta.v97_slug'),
  current_setting('minuta.v97_location')::uuid,
  (current_setting('minuta.v97_slot')::jsonb->>'service_id')::uuid,
  (current_setting('minuta.v97_slot')::jsonb->>'booking_date')::date,
  (current_setting('minuta.v97_slot')::jsonb->>'booking_time')::time,
  'V97 Attribution Test','+79990009503'
);
reset role;
select set_config(
  'minuta.v97_booking',
  (select booking.id::text from public.bookings booking
   where booking.request_id='00000000-0000-4000-8000-000000009503'::uuid),
  true
);
alter table public.bookings disable trigger bookings_zz_protect_creation_attribution_v92;
update public.bookings
set booking_source='provider_manual',
    created_by_user_id='00000000-0000-4000-8000-000000009504',
    created_by_role='specialist'
where id=current_setting('minuta.v97_booking')::uuid;
alter table public.bookings enable trigger bookings_zz_protect_creation_attribution_v92;

-- A normal authenticated UPDATE cannot erase authorship while the author exists.
select set_config(
  'request.jwt.claim.sub',
  (current_setting('minuta.v97_slot')::jsonb->>'performer_id'),
  true
);
set local role authenticated;
do $$
begin
  begin
    update public.bookings
    set created_by_user_id=null
    where id=current_setting('minuta.v97_booking')::uuid;
    raise exception using errcode='P0001',message='v97_attribution_tamper_was_allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- The real FK action is allowed only after the referenced auth row disappears.
delete from auth.users where id='00000000-0000-4000-8000-000000009504';
do $$
begin
  if not exists (
    select 1 from public.bookings booking
    where booking.id=current_setting('minuta.v97_booking')::uuid
      and booking.created_by_user_id is null
      and booking.booking_source in ('provider_manual','admin_manual')
      and booking.created_by_role in ('owner','admin','specialist')
  ) then
    raise exception using errcode='P0001',message='v97_attribution_set_null_failed';
  end if;
end $$;

rollback;
