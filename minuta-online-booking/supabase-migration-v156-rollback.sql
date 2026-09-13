-- Roll back only the exact v156 save_booking_session change.
begin;
set local lock_timeout='10s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $rollback_guard$
declare
  v_function regprocedure:=to_regprocedure('public.save_booking_session(uuid,jsonb)');
  v_source_sha256 text;
begin
  if v_function is null or to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception using errcode='55000',message='v156_rollback_prerequisites_missing';
  end if;
  select encode(extensions.digest(convert_to(replace(procedure_row.prosrc,E'\r',''),'UTF8'),'sha256'),'hex')
  into v_source_sha256 from pg_catalog.pg_proc procedure_row where procedure_row.oid=v_function;
  if v_source_sha256 is distinct from '20e00faa310cf9b115b9fb1c2163e306537f8c4998869e6a4a1608c34e25e68a'
     or pg_catalog.obj_description(v_function,'pg_proc') is distinct from
       'minuta_session_service_change_v156:sha256='||v_source_sha256 then
    raise exception using errcode='55000',message='v156_rollback_blocked_newer_definition';
  end if;
end
$rollback_guard$;

create or replace function public.save_booking_session(p_booking uuid, p_items jsonb)
returns table(total_price_rub integer, total_duration_minutes integer)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_booking public.bookings%rowtype;
  v_primary_service uuid;
  v_total_price integer;
  v_total_duration integer;
  v_conflict_time time without time zone;
  v_items jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 20 then
    raise exception using errcode = 'P0001', message = 'invalid_session_items';
  end if;

  select * into v_booking
  from public.bookings booking
  where booking.id = p_booking and booking.performer_id = auth.uid()
  for update;
  if not found or v_booking.client_phone = '0000000000' or v_booking.status = 'cancelled' then
    raise exception using errcode = 'P0001', message = 'booking_unavailable';
  end if;

  with parsed as (
    select ordinality::integer as position,
      value->>'kind' as item_kind,
      nullif(value->>'service_id', '')::uuid as service_id,
      btrim(value->>'title') as title,
      (value->>'duration_minutes')::integer as duration_minutes,
      (value->>'price_rub')::integer as price_rub,
      coalesce((value->>'extends_duration')::boolean, false) as extends_duration
    from jsonb_array_elements(p_items) with ordinality
  )
  select (array_agg(service_id) filter (where item_kind = 'primary'))[1],
         sum(price_rub)::integer,
         (sum(duration_minutes) filter (where item_kind = 'primary')
           + coalesce(sum(duration_minutes) filter (where item_kind = 'addon' and extends_duration), 0))::integer
  into v_primary_service, v_total_price, v_total_duration
  from parsed;

  if (select count(*) from jsonb_array_elements(p_items) value where value->>'kind' = 'primary') <> 1
     or p_items->0->>'kind' <> 'primary'
     or v_primary_service is null
     or v_total_price not between 0 and 10000000
     or v_total_duration not between 5 and 480
     or exists (
       select 1 from jsonb_array_elements(p_items) value
       where value->>'kind' not in ('primary', 'addon')
          or char_length(btrim(value->>'title')) not between 2 and 120
          or (value->>'duration_minutes')::integer not between 0 and 480
          or (value->>'price_rub')::integer not between 0 and 1000000
     )
     or exists (
       select 1
       from jsonb_array_elements(p_items) value
       where nullif(value->>'service_id', '') is not null
         and not exists (
           select 1 from public.services service
           where service.id = (value->>'service_id')::uuid and service.performer_id = auth.uid()
         )
     ) then
    raise exception using errcode = 'P0001', message = 'invalid_session_items';
  end if;

  select other.booking_time into v_conflict_time
  from public.bookings other
  where other.performer_id = auth.uid()
    and other.id <> v_booking.id
    and other.booking_date = v_booking.booking_date
    and other.status <> 'cancelled'
    and v_booking.booking_date + v_booking.booking_time
          < other.booking_date + other.booking_time + make_interval(mins => other.duration_minutes)
    and v_booking.booking_date + v_booking.booking_time + make_interval(mins => v_total_duration)
          > other.booking_date + other.booking_time
  order by other.booking_time
  limit 1;
  if v_conflict_time is not null then
    raise exception using errcode = 'P0001', message = 'session_overlap:' || to_char(v_conflict_time, 'HH24:MI');
  end if;

  select jsonb_agg(jsonb_build_object(
    'kind', parsed.item_kind,
    'service_id', parsed.service_id,
    'title', parsed.title,
    'duration_minutes', parsed.duration_minutes,
    'price_rub', parsed.price_rub,
    'extends_duration', parsed.extends_duration
  ) order by parsed.position)
  into v_items
  from (
    select ordinality::integer as position,
      value->>'kind' as item_kind,
      nullif(value->>'service_id', '')::uuid as service_id,
      btrim(value->>'title') as title,
      (value->>'duration_minutes')::integer as duration_minutes,
      (value->>'price_rub')::integer as price_rub,
      coalesce((value->>'extends_duration')::boolean, false) as extends_duration
    from jsonb_array_elements(p_items) with ordinality
  ) parsed;

  delete from public.booking_session_items where booking_id = v_booking.id;
  insert into public.booking_session_items (
    booking_id, performer_id, position, item_kind, service_id, title,
    duration_minutes, price_rub, extends_duration
  )
  select v_booking.id, auth.uid(), parsed.position, parsed.item_kind, parsed.service_id,
         parsed.title, parsed.duration_minutes, parsed.price_rub, parsed.extends_duration
  from (
    select ordinality::integer as position,
      value->>'kind' as item_kind,
      nullif(value->>'service_id', '')::uuid as service_id,
      btrim(value->>'title') as title,
      (value->>'duration_minutes')::integer as duration_minutes,
      (value->>'price_rub')::integer as price_rub,
      coalesce((value->>'extends_duration')::boolean, false) as extends_duration
    from jsonb_array_elements(p_items) with ordinality
  ) parsed;

  update public.bookings
  set service_id = v_primary_service,
      duration_minutes = v_total_duration,
      original_price_rub = coalesce(original_price_rub, total_price_rub, v_total_price),
      total_price_rub = v_total_price
  where id = v_booking.id;

  insert into public.booking_session_revisions (
    booking_id, performer_id, items, total_price_rub, total_duration_minutes
  ) values (
    v_booking.id, auth.uid(), v_items, v_total_price, v_total_duration
  );

  return query select v_total_price, v_total_duration;
end;
$$;

revoke all on function public.save_booking_session(uuid,jsonb)
  from public,anon,service_role;
grant execute on function public.save_booking_session(uuid,jsonb) to authenticated;
comment on function public.save_booking_session(uuid,jsonb) is null;

do $postcondition$
declare
  v_function regprocedure:=to_regprocedure('public.save_booking_session(uuid,jsonb)');
  v_source_md5 text;
begin
  select md5(replace(procedure_row.prosrc,E'\r','')) into v_source_md5
  from pg_catalog.pg_proc procedure_row where procedure_row.oid=v_function;
  if v_source_md5 is distinct from 'eb5201919de3d76b3ebeae3d3488ab7a'
     or pg_catalog.obj_description(v_function,'pg_proc') is not null
     or exists(
       select 1 from pg_catalog.pg_proc procedure_row,
         lateral aclexplode(coalesce(procedure_row.proacl,acldefault('f',procedure_row.proowner))) grant_row
       where procedure_row.oid=v_function and grant_row.grantee=0 and grant_row.privilege_type='EXECUTE'
     )
     or has_function_privilege('anon','public.save_booking_session(uuid,jsonb)','EXECUTE')
     or not has_function_privilege('authenticated','public.save_booking_session(uuid,jsonb)','EXECUTE')
     or has_function_privilege('service_role','public.save_booking_session(uuid,jsonb)','EXECUTE') then
    raise exception using errcode='55000',message='v156_rollback_postcondition_failed';
  end if;
end
$postcondition$;

notify pgrst,'reload schema';
commit;
