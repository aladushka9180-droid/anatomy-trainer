begin;

do $$
begin
  if to_regprocedure('public.get_minuta_team_calendar(uuid,date,date,uuid,uuid)') is null
     or to_regprocedure('public.book_minuta_appointment(uuid,text,uuid,uuid,date,time without time zone,text,text)') is null then
    raise exception using errcode = 'P0001', message = 'v68_test_requires_v68';
  end if;
  if exists (
    select 1 from public.bookings
    where organization_id is null or location_id is null or booking_scope_source is null
  ) then
    raise exception using errcode = 'P0001', message = 'v68_backfill_incomplete';
  end if;
end;
$$;

select set_config(
  'minuta.v68_owner',
  (select organization.legacy_performer_id::text
   from public.organizations organization
   where organization.legacy_performer_id is not null
     and organization.public_booking_enabled
     and organization.status = 'active'
   order by organization.id limit 1),
  true
);
select set_config(
  'minuta.v68_org',
  (select organization.id::text
   from public.organizations organization
   where organization.legacy_performer_id = current_setting('minuta.v68_owner')::uuid),
  true
);
select set_config(
  'minuta.v68_location',
  (select location.id::text
   from public.locations location
   where location.organization_id = current_setting('minuta.v68_org')::uuid
     and location.is_primary),
  true
);

do $$
declare
  v_function oid := 'public.get_minuta_team_calendar(uuid,date,date,uuid,uuid)'::regprocedure;
  v_public_booking oid := 'public.book_minuta_appointment(uuid,text,uuid,uuid,date,time without time zone,text,text)'::regprocedure;
begin
  if not has_function_privilege('authenticated', v_function, 'EXECUTE')
     or has_function_privilege('anon', v_function, 'EXECUTE')
     or has_function_privilege('service_role', v_function, 'EXECUTE')
     or exists (
       select 1 from aclexplode(coalesce((select proacl from pg_proc where oid = v_function), acldefault('f', (select proowner from pg_proc where oid = v_function)))) acl
       where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
     ) then
    raise exception using errcode = 'P0001', message = 'v68_team_calendar_acl_failed';
  end if;
  if not has_function_privilege('anon', v_public_booking, 'EXECUTE')
     or not has_function_privilege('authenticated', v_public_booking, 'EXECUTE')
     or has_function_privilege('service_role', v_public_booking, 'EXECUTE') then
    raise exception using errcode = 'P0001', message = 'v68_public_booking_acl_failed';
  end if;
end;
$$;

-- Owners can read the organization calendar, but the payload deliberately
-- excludes management tokens, payment URLs and client account identifiers.
select set_config('request.jwt.claim.sub', current_setting('minuta.v68_owner'), true);
set local role authenticated;
do $$
declare
  v_payload jsonb := public.get_minuta_team_calendar(
    current_setting('minuta.v68_org')::uuid,
    current_date - 3650,
    current_date - 3650 + 62,
    null,
    null
  );
begin
  if v_payload ->> 'current_role' <> 'owner'
     or v_payload ->> 'schedule_scope' <> 'performer_global'
     or (v_payload ->> 'can_view_team')::boolean is not true then
    raise exception using errcode = 'P0001', message = 'v68_owner_calendar_failed';
  end if;
  if v_payload::text ~ 'manage_token|payment_url|client_account_id|provider_note' then
    raise exception using errcode = 'P0001', message = 'v68_private_field_leaked';
  end if;
end;
$$;
reset role;

-- The public wrapper must create tenant-scoped bookings, restore its local
-- context, remain idempotent and reject a reused request in another branch.
select set_config(
  'minuta.v68_slug',
  (select public_slug from public.organizations where id = current_setting('minuta.v68_org')::uuid),
  true
);
insert into public.locations (id, organization_id, name, address, timezone, is_primary)
values (
  '00000000-0000-4000-8000-000000006805',
  current_setting('minuta.v68_org')::uuid,
  'V68 Alternate Branch',
  'V68 test address',
  'Europe/Samara',
  false
);

select set_config(
  'minuta.v68_slots',
  coalesce((
    select jsonb_agg(to_jsonb(candidate) order by candidate.booking_date, candidate.booking_time)::text
    from (
      select distinct on (available.booking_date)
        service.id as service_id, available.booking_date, available.booking_time
      from lateral (
          select candidate.id
          from public.services candidate
          join public.organization_memberships membership
            on membership.organization_id = current_setting('minuta.v68_org')::uuid
           and membership.user_id = candidate.performer_id
           and membership.active
           and membership.is_bookable
          where candidate.active
          order by candidate.id
          limit 1
        ) service
        cross join lateral public.get_available_slots(
          service.id,
          current_date + 1,
          current_date + 62
        ) available
      order by available.booking_date, available.booking_time, service.id
      limit 2
    ) candidate
  ), '[]'),
  true
);

do $$
begin
  if jsonb_array_length(current_setting('minuta.v68_slots')::jsonb) < 2 then
    raise exception using errcode = 'P0001', message = 'v68_test_requires_two_available_slots';
  end if;
end;
$$;

select set_config('minuta.booking_organization', '', true);
select set_config('minuta.booking_location', '', true);
set local role anon;
select * from public.book_minuta_appointment(
  '00000000-0000-4000-8000-000000006803',
  current_setting('minuta.v68_slug'),
  current_setting('minuta.v68_location')::uuid,
  (current_setting('minuta.v68_slots')::jsonb #>> '{0,service_id}')::uuid,
  (current_setting('minuta.v68_slots')::jsonb #>> '{0,booking_date}')::date,
  (current_setting('minuta.v68_slots')::jsonb #>> '{0,booking_time}')::time,
  'V68 Client One',
  '+79990000001'
);
-- Exact retry returns the original row and does not duplicate it.
select * from public.book_minuta_appointment(
  '00000000-0000-4000-8000-000000006803',
  current_setting('minuta.v68_slug'),
  current_setting('minuta.v68_location')::uuid,
  (current_setting('minuta.v68_slots')::jsonb #>> '{0,service_id}')::uuid,
  (current_setting('minuta.v68_slots')::jsonb #>> '{0,booking_date}')::date,
  (current_setting('minuta.v68_slots')::jsonb #>> '{0,booking_time}')::time,
  'V68 Client One',
  '+79990000001'
);
select * from public.book_minuta_appointment(
  '00000000-0000-4000-8000-000000006804',
  current_setting('minuta.v68_slug'),
  current_setting('minuta.v68_location')::uuid,
  (current_setting('minuta.v68_slots')::jsonb #>> '{1,service_id}')::uuid,
  (current_setting('minuta.v68_slots')::jsonb #>> '{1,booking_date}')::date,
  (current_setting('minuta.v68_slots')::jsonb #>> '{1,booking_time}')::time,
  'V68 Client Two',
  '+79990000002'
);
do $$
begin
  begin
    perform result.booking_code
    from public.book_minuta_appointment(
      '00000000-0000-4000-8000-000000006803',
      current_setting('minuta.v68_slug'),
      '00000000-0000-4000-8000-000000006805',
      (current_setting('minuta.v68_slots')::jsonb #>> '{0,service_id}')::uuid,
      (current_setting('minuta.v68_slots')::jsonb #>> '{0,booking_date}')::date,
      (current_setting('minuta.v68_slots')::jsonb #>> '{0,booking_time}')::time,
      'V68 Client One',
      '+79990000001'
    ) result;
    raise exception using errcode = 'P0001', message = 'v68_cross_location_request_was_allowed';
  exception when others then
    if sqlerrm <> 'request_conflict' then
      raise;
    end if;
  end;
end;
$$;
reset role;

do $$
declare
  v_first uuid;
  v_second uuid;
begin
  if current_setting('minuta.booking_organization', true) <> ''
     or current_setting('minuta.booking_location', true) <> '' then
    raise exception using errcode = 'P0001', message = 'v68_wrapper_context_leaked';
  end if;
  if (select count(*) from public.bookings where request_id in (
    '00000000-0000-4000-8000-000000006803',
    '00000000-0000-4000-8000-000000006804'
  )) <> 2 or exists (
    select 1 from public.bookings
    where request_id in (
      '00000000-0000-4000-8000-000000006803',
      '00000000-0000-4000-8000-000000006804'
    ) and (
      organization_id <> current_setting('minuta.v68_org')::uuid
      or location_id <> current_setting('minuta.v68_location')::uuid
      or booking_scope_source <> 'team'
    )
  ) then
    raise exception using errcode = 'P0001', message = 'v68_wrapper_scope_or_idempotency_failed';
  end if;

  select id into v_first from public.bookings
  where request_id = '00000000-0000-4000-8000-000000006803';
  select id into v_second from public.bookings
  where request_id = '00000000-0000-4000-8000-000000006804';
  begin
    update public.bookings
    set booking_date = (current_setting('minuta.v68_slots')::jsonb #>> '{0,booking_date}')::date,
        booking_time = (
          (current_setting('minuta.v68_slots')::jsonb #>> '{0,booking_time}')::time
          + interval '30 seconds'
        )::time
    where id = v_second;
    raise exception using errcode = 'P0001', message = 'v68_overlap_update_was_allowed';
  exception when exclusion_violation then null;
  end;

  insert into public.booking_outcomes (
    booking_id, performer_id, visit_status, payment_method, amount_rub
  )
  select booking.id, booking.performer_id, 'completed', 'cash', 0
  from public.bookings booking where booking.id = v_first;
end;
$$;

select set_config('request.jwt.claim.sub', current_setting('minuta.v68_owner'), true);
set local role authenticated;
do $$
declare
  v_booking uuid := (
    select id from public.bookings
    where request_id = '00000000-0000-4000-8000-000000006803'
  );
  v_payload jsonb := public.get_minuta_team_calendar(
    current_setting('minuta.v68_org')::uuid,
    (current_setting('minuta.v68_slots')::jsonb #>> '{0,booking_date}')::date,
    (current_setting('minuta.v68_slots')::jsonb #>> '{0,booking_date}')::date,
    null,
    null
  );
begin
  if not exists (
    select 1 from jsonb_array_elements(v_payload -> 'bookings') item
    where (item ->> 'id')::uuid = v_booking
      and item ->> 'status' = 'completed'
      and item ->> 'visit_status' = 'completed'
  ) then
    raise exception using errcode = 'P0001', message = 'v68_team_outcome_status_missing';
  end if;
end;
$$;
reset role;

-- A second organization for the same performer must never receive rows from
-- the legacy organization merely because that performer belongs to both.
insert into public.organizations (id, name, public_slug, created_by)
values ('00000000-0000-4000-8000-000000006801', 'V68 Isolated Team', 'v68-isolated-team', current_setting('minuta.v68_owner')::uuid);
insert into public.locations (id, organization_id, name, timezone, is_primary)
values ('00000000-0000-4000-8000-000000006802', '00000000-0000-4000-8000-000000006801', 'V68 Branch', 'Europe/Samara', true);
insert into public.organization_memberships (organization_id, user_id, role, is_bookable, active, created_by)
values ('00000000-0000-4000-8000-000000006801', current_setting('minuta.v68_owner')::uuid, 'owner', true, true, current_setting('minuta.v68_owner')::uuid);

select set_config('request.jwt.claim.sub', current_setting('minuta.v68_owner'), true);
set local role authenticated;
do $$
declare
  v_payload jsonb := public.get_minuta_team_calendar(
    '00000000-0000-4000-8000-000000006801',
    current_date - 31,
    current_date + 31,
    null,
    null
  );
begin
  if jsonb_array_length(v_payload -> 'bookings') <> 0 then
    raise exception using errcode = 'P0001', message = 'v68_cross_organization_booking_leak';
  end if;
end;
$$;
reset role;

-- Anonymous users cannot read client details from the team calendar.
set local role anon;
do $$
begin
  begin
    perform public.get_minuta_team_calendar(
      current_setting('minuta.v68_org')::uuid,
      current_date,
      current_date,
      null,
      null
    );
    raise exception using errcode = 'P0001', message = 'v68_anon_calendar_was_allowed';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- The public v2 catalog is branch-addressable and contains no private team data.
select set_config(
  'minuta.v68_slug',
  (select public_slug from public.organizations where id = current_setting('minuta.v68_org')::uuid),
  true
);
set local role anon;
do $$
declare
  v_catalog jsonb := public.get_public_minuta_catalog_v2(current_setting('minuta.v68_slug'));
begin
  if (v_catalog #>> '{organization,id}')::uuid <> current_setting('minuta.v68_org')::uuid
     or exists (
       select 1 from jsonb_array_elements(v_catalog -> 'locations') location
       where location ->> 'id' is null
     ) then
    raise exception using errcode = 'P0001', message = 'v68_public_catalog_location_id_missing';
  end if;
  if v_catalog::text ~ 'email|actor_id|created_by|manage_token|client_phone' then
    raise exception using errcode = 'P0001', message = 'v68_public_catalog_private_field_leaked';
  end if;
end;
$$;
reset role;

-- Re-running the migration is covered by CI. This transaction verifies that
-- the original v61/v64 deletion RPC is still installed and remains private.
do $$
declare
  v_delete oid := 'public.provider_delete_booking(uuid)'::regprocedure;
begin
  if v_delete is null
     or not has_function_privilege('authenticated', v_delete, 'EXECUTE')
     or has_function_privilege('anon', v_delete, 'EXECUTE')
     or has_function_privilege('service_role', v_delete, 'EXECUTE') then
    raise exception using errcode = 'P0001', message = 'v68_provider_delete_acl_changed';
  end if;
end;
$$;

rollback;
