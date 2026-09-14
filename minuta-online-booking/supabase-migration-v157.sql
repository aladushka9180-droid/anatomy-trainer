-- v157: fail-closed timeline moves with a durable linked undo receipt.
begin;
set local lock_timeout='10s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $dependency_guard$
begin
  if to_regclass('public.bookings') is null
     or to_regclass('public.booking_events') is null
     or to_regprocedure('public.reschedule_minuta_provider_booking_v143(uuid,date,time without time zone,date,time without time zone)') is null
     or to_regprocedure('public.get_available_slots_v101(uuid,date,date,uuid)') is null
     or to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception using errcode='55000',message='v157_schedule_move_prerequisites_missing';
  end if;
  if to_regclass('public.provider_schedule_moves_v157') is not null
     or to_regprocedure('public.minuta_provider_schedule_snapshot_v157(public.bookings)') is not null
     or to_regprocedure('public.move_minuta_provider_schedule_booking_v157(uuid,uuid,date,time without time zone,uuid,uuid,uuid,date,time without time zone,integer,text)') is not null
     or to_regprocedure('public.get_minuta_provider_schedule_move_v157(uuid)') is not null
     or to_regprocedure('public.undo_minuta_provider_schedule_booking_v157(uuid,uuid)') is not null then
    raise exception using errcode='55000',message='v157_schedule_move_state_not_absent';
  end if;
end
$dependency_guard$;

create table public.provider_schedule_moves_v157 (
  id uuid primary key default extensions.gen_random_uuid(),
  request_id uuid not null unique,
  request_fingerprint text not null check (char_length(request_fingerprint)=64),
  booking_id uuid references public.bookings(id) on delete set null,
  organization_id uuid references public.organizations(id) on delete set null,
  performer_id uuid references auth.users(id) on delete set null,
  operation text not null check (operation in ('move','undo')),
  from_snapshot jsonb not null,
  to_snapshot jsonb not null,
  reverse_of uuid unique references public.provider_schedule_moves_v157(id) on delete restrict,
  reversed_by uuid unique references public.provider_schedule_moves_v157(id) on delete restrict,
  status text not null default 'applied' check (status in ('applied','undone')),
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  reversed_at timestamptz,
  check ((operation='move' and reverse_of is null) or (operation='undo' and reverse_of is not null)),
  check ((status='applied' and reversed_at is null) or (status='undone' and reversed_at is not null))
);

create index provider_schedule_moves_v157_booking_time_idx
  on public.provider_schedule_moves_v157(booking_id,created_at desc);
create index provider_schedule_moves_v157_performer_time_idx
  on public.provider_schedule_moves_v157(performer_id,created_at desc);

alter table public.provider_schedule_moves_v157 enable row level security;
alter table public.provider_schedule_moves_v157 force row level security;
alter table public.provider_schedule_moves_v157 owner to postgres;
revoke all on table public.provider_schedule_moves_v157 from public,anon,authenticated,service_role;
grant all on table public.provider_schedule_moves_v157 to service_role;

create function public.minuta_provider_schedule_snapshot_v157(p_booking public.bookings)
returns jsonb
language sql
immutable
security invoker
set search_path to ''
as $$
  select jsonb_build_object(
    'organization_id',p_booking.organization_id,
    'location_id',p_booking.location_id,
    'service_id',p_booking.service_id,
    'booking_date',p_booking.booking_date,
    'booking_time',p_booking.booking_time,
    'duration_minutes',p_booking.duration_minutes,
    'status',p_booking.status
  )
$$;
revoke all on function public.minuta_provider_schedule_snapshot_v157(public.bookings)
  from public,anon,authenticated,service_role;
alter function public.minuta_provider_schedule_snapshot_v157(public.bookings) owner to postgres;

create function public.move_minuta_provider_schedule_booking_v157(
  p_request_id uuid,
  p_booking uuid,
  p_date date,
  p_time time without time zone,
  p_expected_organization uuid,
  p_expected_location uuid,
  p_expected_service uuid,
  p_expected_date date,
  p_expected_time time without time zone,
  p_expected_duration integer,
  p_expected_status text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_actor uuid:=auth.uid();
  v_booking public.bookings%rowtype;
  v_updated public.bookings%rowtype;
  v_existing public.provider_schedule_moves_v157%rowtype;
  v_move_id uuid:=extensions.gen_random_uuid();
  v_fingerprint text;
  v_from jsonb;
  v_to jsonb;
  v_result jsonb;
begin
  if v_actor is null then
    raise exception using errcode='42501',message='authentication_required';
  end if;
  if p_request_id is null or p_booking is null or p_date is null or p_time is null
     or p_expected_organization is null
     or p_expected_service is null or p_expected_date is null or p_expected_time is null
     or p_expected_duration is null or p_expected_duration not between 1 and 1440
     or nullif(btrim(coalesce(p_expected_status,'')),'') is null
     or (p_date=p_expected_date and p_time=p_expected_time)
     or extract(second from p_time)<>0 then
    raise exception using errcode='22023',message='invalid_provider_schedule_target';
  end if;
  if p_date<(clock_timestamp() at time zone 'Europe/Samara')::date
     or (p_date=(clock_timestamp() at time zone 'Europe/Samara')::date
       and p_time<(clock_timestamp() at time zone 'Europe/Samara')::time) then
    raise exception using errcode='22023',message='provider_schedule_target_in_past';
  end if;

  v_fingerprint:=encode(extensions.digest(convert_to(concat_ws('|',
    'move',p_booking::text,p_date::text,p_time::text,
    coalesce(p_expected_organization::text,'null'),coalesce(p_expected_location::text,'null'),
    p_expected_service::text,p_expected_date::text,p_expected_time::text,
    p_expected_duration::text,p_expected_status),'UTF8'),'sha256'),'hex');

  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,15701));
  select * into v_existing
  from public.provider_schedule_moves_v157 movement
  where movement.request_id=p_request_id;
  if found then
    if v_existing.performer_id is distinct from v_actor or v_existing.request_fingerprint<>v_fingerprint then
      raise exception using errcode='22023',message='provider_schedule_request_reused';
    end if;
    return v_existing.result||jsonb_build_object('replayed',true);
  end if;

  -- Keep the established booking -> organization -> target-day lock order.
  perform pg_advisory_xact_lock(hashtextextended(p_booking::text,7302));
  select * into v_booking from public.bookings booking where booking.id=p_booking;
  if not found then
    raise exception using errcode='P0001',message='provider_schedule_booking_not_found';
  end if;
  if v_booking.performer_id is distinct from v_actor then
    raise exception using errcode='42501',message='provider_schedule_access_denied';
  end if;
  if v_booking.organization_id is null then
    raise exception using errcode='55000',message='provider_schedule_organization_missing';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_booking.organization_id::text,7100));
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text||p_date::text,0));
  select * into v_booking from public.bookings booking where booking.id=p_booking for update;

  if not found
     or v_booking.performer_id is distinct from v_actor
     or v_booking.organization_id is distinct from p_expected_organization
     or v_booking.location_id is distinct from p_expected_location
     or v_booking.service_id is distinct from p_expected_service
     or v_booking.booking_date is distinct from p_expected_date
     or v_booking.booking_time is distinct from p_expected_time
     or v_booking.duration_minutes is distinct from p_expected_duration
     or v_booking.status is distinct from p_expected_status then
    raise exception using errcode='40001',message='provider_schedule_booking_changed';
  end if;
  if v_booking.series_id is not null then
    raise exception using errcode='55000',message='provider_schedule_series_requires_editor';
  end if;
  if v_booking.client_phone='0000000000'
     or coalesce(v_booking.booking_policy_snapshot,'{}'::jsonb) @> '{"schedule_block":true}'::jsonb then
    raise exception using errcode='55000',message='provider_schedule_block_requires_editor';
  end if;
  if v_booking.status='cancelled'
     or v_booking.booking_date<(clock_timestamp() at time zone 'Europe/Samara')::date
     or exists(select 1 from public.booking_outcomes outcome
       where outcome.booking_id=v_booking.id and outcome.visit_status<>'scheduled') then
    raise exception using errcode='P0001',message='provider_schedule_booking_not_actionable';
  end if;

  v_from:=public.minuta_provider_schedule_snapshot_v157(v_booking);
  perform public.reschedule_minuta_provider_booking_v143(
    p_booking,p_date,p_time,p_expected_date,p_expected_time
  );
  select * into v_updated from public.bookings booking where booking.id=p_booking;
  if not found or v_updated.performer_id is distinct from v_actor
     or v_updated.booking_date is distinct from p_date
     or v_updated.booking_time is distinct from p_time
     or v_updated.organization_id is distinct from p_expected_organization
     or v_updated.location_id is distinct from p_expected_location
     or v_updated.service_id is distinct from p_expected_service
     or v_updated.duration_minutes is distinct from p_expected_duration
     or v_updated.status is distinct from p_expected_status then
    raise exception using errcode='40001',message='provider_schedule_booking_changed';
  end if;
  v_to:=public.minuta_provider_schedule_snapshot_v157(v_updated);
  v_result:=jsonb_build_object(
    'action','moved','request_id',p_request_id,'move_id',v_move_id,
    'booking_id',v_updated.id,'performer_id',v_updated.performer_id,
    'booking_date',v_updated.booking_date,'booking_time',v_updated.booking_time,
    'duration_minutes',v_updated.duration_minutes,'status',v_updated.status,
    'notifications_suppressed',false,'replayed',false
  );
  insert into public.provider_schedule_moves_v157(
    id,request_id,request_fingerprint,booking_id,organization_id,performer_id,
    operation,from_snapshot,to_snapshot,status,result
  ) values (
    v_move_id,p_request_id,v_fingerprint,v_updated.id,v_updated.organization_id,v_updated.performer_id,
    'move',v_from,v_to,'applied',v_result
  );
  return v_result;
exception
  when exclusion_violation or unique_violation then
    raise exception using errcode='23P01',message='provider_schedule_slot_unavailable';
  when raise_exception then
    if sqlerrm in ('provider_booking_slot_unavailable','resource_unavailable','booking_buffer_conflict','slot_unavailable') then
      raise exception using errcode='23P01',message='provider_schedule_slot_unavailable';
    end if;
    raise;
end
$$;

revoke all on function public.move_minuta_provider_schedule_booking_v157(
  uuid,uuid,date,time without time zone,uuid,uuid,uuid,date,time without time zone,integer,text
) from public,anon,authenticated,service_role;
alter function public.move_minuta_provider_schedule_booking_v157(
  uuid,uuid,date,time without time zone,uuid,uuid,uuid,date,time without time zone,integer,text
) owner to postgres;
grant execute on function public.move_minuta_provider_schedule_booking_v157(
  uuid,uuid,date,time without time zone,uuid,uuid,uuid,date,time without time zone,integer,text
) to authenticated;

create function public.get_minuta_provider_schedule_move_v157(p_request_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare v_actor uuid:=auth.uid(); v_move public.provider_schedule_moves_v157%rowtype;
begin
  if v_actor is null then raise exception using errcode='42501',message='authentication_required'; end if;
  if p_request_id is null then raise exception using errcode='22023',message='invalid_provider_schedule_request'; end if;
  select * into v_move from public.provider_schedule_moves_v157 movement
  where movement.request_id=p_request_id and movement.performer_id=v_actor;
  if not found then return null; end if;
  return v_move.result||jsonb_build_object('ledger_status',v_move.status,'replayed',true);
end
$$;
revoke all on function public.get_minuta_provider_schedule_move_v157(uuid)
  from public,anon,authenticated,service_role;
alter function public.get_minuta_provider_schedule_move_v157(uuid) owner to postgres;
grant execute on function public.get_minuta_provider_schedule_move_v157(uuid) to authenticated;

create function public.undo_minuta_provider_schedule_booking_v157(
  p_request_id uuid,
  p_move uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_actor uuid:=auth.uid();
  v_original public.provider_schedule_moves_v157%rowtype;
  v_existing public.provider_schedule_moves_v157%rowtype;
  v_booking public.bookings%rowtype;
  v_updated public.bookings%rowtype;
  v_undo_id uuid:=extensions.gen_random_uuid();
  v_fingerprint text;
  v_result jsonb;
begin
  if v_actor is null then raise exception using errcode='42501',message='authentication_required'; end if;
  if p_request_id is null or p_move is null then
    raise exception using errcode='22023',message='invalid_provider_schedule_undo';
  end if;
  v_fingerprint:=encode(extensions.digest(convert_to(concat_ws('|','undo',p_move::text),'UTF8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,15701));
  select * into v_existing from public.provider_schedule_moves_v157 movement where movement.request_id=p_request_id;
  if found then
    if v_existing.performer_id is distinct from v_actor or v_existing.request_fingerprint<>v_fingerprint then
      raise exception using errcode='22023',message='provider_schedule_request_reused';
    end if;
    return v_existing.result||jsonb_build_object('replayed',true);
  end if;

  select * into v_original from public.provider_schedule_moves_v157 movement where movement.id=p_move;
  if not found then raise exception using errcode='P0001',message='provider_schedule_move_not_found'; end if;
  if v_original.performer_id is distinct from v_actor then raise exception using errcode='42501',message='provider_schedule_access_denied'; end if;
  if v_original.operation<>'move' then raise exception using errcode='22023',message='provider_schedule_move_not_reversible'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_original.booking_id::text,7302));
  perform pg_advisory_xact_lock(hashtextextended(v_original.organization_id::text,7100));
  perform pg_advisory_xact_lock(hashtextextended(
    v_actor::text||(v_original.from_snapshot->>'booking_date'),0
  ));
  select * into v_original from public.provider_schedule_moves_v157 movement where movement.id=p_move for update;
  if v_original.status<>'applied' or v_original.reversed_by is not null then
    raise exception using errcode='40001',message='provider_schedule_move_already_undone';
  end if;
  select * into v_booking from public.bookings booking where booking.id=v_original.booking_id for update;
  if not found or v_booking.performer_id is distinct from v_actor
     or public.minuta_provider_schedule_snapshot_v157(v_booking) is distinct from v_original.to_snapshot then
    raise exception using errcode='40001',message='provider_schedule_booking_changed';
  end if;

  perform public.reschedule_minuta_provider_booking_v143(
    v_booking.id,
    (v_original.from_snapshot->>'booking_date')::date,
    (v_original.from_snapshot->>'booking_time')::time,
    v_booking.booking_date,
    v_booking.booking_time
  );
  select * into v_updated from public.bookings booking where booking.id=v_booking.id;
  if not found or public.minuta_provider_schedule_snapshot_v157(v_updated) is distinct from v_original.from_snapshot then
    raise exception using errcode='40001',message='provider_schedule_undo_unconfirmed';
  end if;

  v_result:=jsonb_build_object(
    'action','undone','request_id',p_request_id,'move_id',v_undo_id,
    'undone_move_id',v_original.id,'booking_id',v_updated.id,
    'performer_id',v_updated.performer_id,'booking_date',v_updated.booking_date,
    'booking_time',v_updated.booking_time,'duration_minutes',v_updated.duration_minutes,
    'status',v_updated.status,'notifications_suppressed',false,'replayed',false
  );
  insert into public.provider_schedule_moves_v157(
    id,request_id,request_fingerprint,booking_id,organization_id,performer_id,
    operation,from_snapshot,to_snapshot,reverse_of,status,result
  ) values (
    v_undo_id,p_request_id,v_fingerprint,v_updated.id,v_updated.organization_id,v_updated.performer_id,
    'undo',v_original.to_snapshot,v_original.from_snapshot,v_original.id,'applied',v_result
  );
  update public.provider_schedule_moves_v157 movement
  set status='undone',reversed_by=v_undo_id,reversed_at=clock_timestamp()
  where movement.id=v_original.id;
  return v_result;
exception
  when exclusion_violation or unique_violation then
    raise exception using errcode='23P01',message='provider_schedule_slot_unavailable';
  when raise_exception then
    if sqlerrm in ('provider_booking_slot_unavailable','resource_unavailable','booking_buffer_conflict','slot_unavailable') then
      raise exception using errcode='23P01',message='provider_schedule_slot_unavailable';
    end if;
    raise;
end
$$;

revoke all on function public.undo_minuta_provider_schedule_booking_v157(uuid,uuid)
  from public,anon,authenticated,service_role;
alter function public.undo_minuta_provider_schedule_booking_v157(uuid,uuid) owner to postgres;
grant execute on function public.undo_minuta_provider_schedule_booking_v157(uuid,uuid) to authenticated;

do $function_stamp$
declare v_signature text; v_prefix text; v_hash text;
begin
  for v_signature,v_prefix in select * from (values
    ('public.minuta_provider_schedule_snapshot_v157(public.bookings)','minuta_provider_schedule_move_snapshot_v157'),
    ('public.move_minuta_provider_schedule_booking_v157(uuid,uuid,date,time without time zone,uuid,uuid,uuid,date,time without time zone,integer,text)','minuta_provider_schedule_move_v157'),
    ('public.get_minuta_provider_schedule_move_v157(uuid)','minuta_provider_schedule_move_lookup_v157'),
    ('public.undo_minuta_provider_schedule_booking_v157(uuid,uuid)','minuta_provider_schedule_move_undo_v157')
  ) stamp(signature,prefix) loop
    select encode(extensions.digest(convert_to(replace(procedure_row.prosrc,E'\r',''),'UTF8'),'sha256'),'hex')
      into v_hash from pg_catalog.pg_proc procedure_row where procedure_row.oid=to_regprocedure(v_signature);
    execute format('comment on function %s is %L',v_signature,v_prefix||':sha256='||v_hash);
  end loop;
end
$function_stamp$;

do $table_stamp$
declare v_table regclass:='public.provider_schedule_moves_v157'::regclass; v_hash text;
begin
  select encode(extensions.digest(convert_to(jsonb_build_object(
    'owner',(select pg_catalog.pg_get_userbyid(relation_row.relowner) from pg_catalog.pg_class relation_row where relation_row.oid=v_table),
    'acl',(select coalesce(relation_row.relacl,'{}'::aclitem[])::text from pg_catalog.pg_class relation_row where relation_row.oid=v_table),
    'rls',(select relation_row.relrowsecurity from pg_catalog.pg_class relation_row where relation_row.oid=v_table),
    'force_rls',(select relation_row.relforcerowsecurity from pg_catalog.pg_class relation_row where relation_row.oid=v_table),
    'policies',(select jsonb_agg(jsonb_build_object(
      'name',policy_row.polname,'permissive',policy_row.polpermissive,
      'roles',(select jsonb_agg(pg_catalog.pg_get_userbyid(role_oid) order by pg_catalog.pg_get_userbyid(role_oid))
        from unnest(policy_row.polroles) role_oid),
      'command',policy_row.polcmd,'qual',pg_catalog.pg_get_expr(policy_row.polqual,policy_row.polrelid),
      'with_check',pg_catalog.pg_get_expr(policy_row.polwithcheck,policy_row.polrelid)
    ) order by policy_row.polname) from pg_catalog.pg_policy policy_row where policy_row.polrelid=v_table),
    'columns',(select jsonb_agg(jsonb_build_object(
      'name',attribute_row.attname,'type',pg_catalog.format_type(attribute_row.atttypid,attribute_row.atttypmod),
      'not_null',attribute_row.attnotnull,'identity',attribute_row.attidentity,
      'default',pg_catalog.pg_get_expr(default_row.adbin,default_row.adrelid)
    ) order by attribute_row.attnum)
      from pg_catalog.pg_attribute attribute_row
      left join pg_catalog.pg_attrdef default_row
        on default_row.adrelid=attribute_row.attrelid and default_row.adnum=attribute_row.attnum
      where attribute_row.attrelid=v_table and attribute_row.attnum>0 and not attribute_row.attisdropped),
    'constraints',(select jsonb_agg(jsonb_build_object(
      'name',constraint_row.conname,'type',constraint_row.contype,
      'definition',pg_catalog.pg_get_constraintdef(constraint_row.oid,true)
    ) order by constraint_row.conname) from pg_catalog.pg_constraint constraint_row
      where constraint_row.conrelid=v_table),
    'indexes',(select jsonb_agg(pg_catalog.pg_get_indexdef(index_row.indexrelid) order by index_class.relname)
      from pg_catalog.pg_index index_row join pg_catalog.pg_class index_class on index_class.oid=index_row.indexrelid
      where index_row.indrelid=v_table),
    'triggers',(select jsonb_agg(pg_catalog.pg_get_triggerdef(trigger_row.oid,true) order by trigger_row.tgname)
      from pg_catalog.pg_trigger trigger_row where trigger_row.tgrelid=v_table and not trigger_row.tgisinternal)
  )::text,'UTF8'),'sha256'),'hex') into v_hash;
  execute format('comment on table %s is %L',v_table,'minuta_provider_schedule_move_v157:sha256='||v_hash);
end
$table_stamp$;

do $postcondition$
begin
  if to_regclass('public.provider_schedule_moves_v157') is null
     or not (select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid='public.provider_schedule_moves_v157'::regclass)
     or has_table_privilege('anon','public.provider_schedule_moves_v157','SELECT')
     or has_table_privilege('authenticated','public.provider_schedule_moves_v157','SELECT')
     or pg_catalog.obj_description('public.provider_schedule_moves_v157'::regclass,'pg_class') not like 'minuta_provider_schedule_move_v157:sha256=%'
     or not has_function_privilege('authenticated','public.move_minuta_provider_schedule_booking_v157(uuid,uuid,date,time without time zone,uuid,uuid,uuid,date,time without time zone,integer,text)','EXECUTE')
     or not has_function_privilege('authenticated','public.get_minuta_provider_schedule_move_v157(uuid)','EXECUTE')
     or not has_function_privilege('authenticated','public.undo_minuta_provider_schedule_booking_v157(uuid,uuid)','EXECUTE')
     or has_function_privilege('anon','public.move_minuta_provider_schedule_booking_v157(uuid,uuid,date,time without time zone,uuid,uuid,uuid,date,time without time zone,integer,text)','EXECUTE')
     or has_function_privilege('anon','public.get_minuta_provider_schedule_move_v157(uuid)','EXECUTE')
     or has_function_privilege('anon','public.undo_minuta_provider_schedule_booking_v157(uuid,uuid)','EXECUTE') then
    raise exception using errcode='55000',message='v157_schedule_move_postcondition_failed';
  end if;
end
$postcondition$;

notify pgrst,'reload schema';
commit;
