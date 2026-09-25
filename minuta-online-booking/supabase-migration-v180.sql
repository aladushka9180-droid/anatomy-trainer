-- v180: one flexible offline request resolves to at most one booking.
-- Apply only after the production backup, restore rehearsal and SQL approval.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '2min';

do $guard$
declare v_proc regprocedure := to_regprocedure(
  'public.book_flexible_appointment_v180(uuid,uuid,date,time without time zone,time without time zone,text,text,text,uuid,integer,integer,text)');
begin
  if to_regclass('public.bookings') is null
     or to_regprocedure('public.book_appointment(uuid,uuid,date,time without time zone,text,text)') is null
     or to_regprocedure('public.book_minuta_appointment_v2(uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer)') is null
     or to_regprocedure('public.get_available_slots_v101(uuid,date,date,uuid)') is null
     or to_regprocedure('public.get_public_minuta_available_slots_v101(text,uuid,uuid,date,date)') is null then
    raise exception using errcode='55000',message='v180_prerequisite_missing';
  end if;
  if v_proc is not null and obj_description(v_proc,'pg_proc') is distinct from
     (select 'primetime_flexible_v180:md5='||md5(replace(prosrc,E'\r',''))
      from pg_catalog.pg_proc where oid=v_proc) then
    raise exception using errcode='55000',message='v180_apply_blocked_function_drift';
  end if;
  if to_regclass('public.flexible_booking_requests_v180') is not null then
    if not exists(select 1 from pg_catalog.pg_constraint c
        where c.conrelid='public.flexible_booking_requests_v180'::regclass
          and c.contype='f' and c.confrelid='public.bookings'::regclass
          and c.confdeltype='n')
       or exists(select 1 from pg_catalog.pg_attribute a
        where a.attrelid='public.flexible_booking_requests_v180'::regclass
          and a.attname='booking_id' and a.attnotnull) then
      raise exception using errcode='55000',message='v180_apply_blocked_ledger_drift';
    end if;
  end if;
end
$guard$;

create table if not exists public.flexible_booking_requests_v180 (
  request_id uuid primary key,
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  -- Keep the request as a tombstone when a provider deletes the booking.
  booking_id uuid unique references public.bookings(id) on delete set null,
  created_at timestamptz not null default now()
);
revoke all on public.flexible_booking_requests_v180 from public, anon, authenticated, service_role;

create or replace function public.book_flexible_appointment_v180(
  p_request_id uuid, p_service uuid, p_date date,
  p_earliest time without time zone, p_latest time without time zone,
  p_client_name text, p_client_phone text,
  p_slug text default null, p_location uuid default null,
  p_expected_price_rub integer default null,
  p_expected_duration_minutes integer default null,
  p_kind text default 'public'
)
returns jsonb
language plpgsql volatile security definer set search_path to '' as $$
declare
  v_actor uuid := auth.uid();
  v_performer uuid;
  v_service public.services%rowtype;
  v_fingerprint text;
  v_existing public.flexible_booking_requests_v180%rowtype;
  v_booking public.bookings%rowtype;
  v_slot record;
  v_created record;
  v_public boolean := p_kind = 'public';
  v_team boolean := p_kind = 'public' and p_slug is not null;
  v_slots time without time zone[];
begin
  if p_request_id is null or p_service is null or p_date is null
     or p_earliest is null or p_latest is null or p_latest < p_earliest
     or p_date < (now() at time zone 'Europe/Samara')::date
     or p_date > (now() at time zone 'Europe/Samara')::date + 14
     or coalesce(char_length(btrim(p_client_name)),0) < 2
     or coalesce(char_length(regexp_replace(p_client_phone,'[^0-9]','','g')),0) < 10
     or p_kind is null or p_kind not in ('public','provider')
     or (v_team and (p_location is null or p_expected_price_rub is null
         or p_expected_duration_minutes is null))
     or (v_public and not v_team and (p_location is not null or p_expected_price_rub is not null
         or p_expected_duration_minutes is not null))
     or (not v_public and (p_slug is not null or p_location is not null
         or p_expected_price_rub is not null or p_expected_duration_minutes is not null
         or v_actor is null)) then
    raise exception using errcode='22023', message='invalid_flexible_booking_request';
  end if;

  v_fingerprint := encode(extensions.digest(
    convert_to(jsonb_build_array(p_service,p_date,p_earliest,p_latest,
      btrim(p_client_name),regexp_replace(p_client_phone,'[^0-9]','','g'),
      p_slug,p_location,p_expected_price_rub,p_expected_duration_minutes,p_kind)::text,'UTF8'),
    'sha256'),'hex');

  if not v_public and not exists(
    select 1 from public.services service
    where service.id=p_service and service.performer_id=v_actor
  ) then
    raise exception using errcode='42501',message='provider_service_access_denied';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('booking-request:' || p_request_id::text,0));
  select * into v_existing from public.flexible_booking_requests_v180
    where request_id=p_request_id;
  if found then
    if v_existing.request_fingerprint <> v_fingerprint then
      raise exception using errcode='23505',message='request_conflict';
    end if;
    if v_existing.booking_id is null then
      return jsonb_build_object('result_code','booking_deleted','request_id',p_request_id);
    end if;
    select * into v_booking from public.bookings where id=v_existing.booking_id;
    if not found then
      raise exception using errcode='55000',message='flexible_booking_replay_drift';
    end if;
    return jsonb_build_object('result_code','ok','request_id',p_request_id,
      'booking_id',v_booking.id,'booking_code',v_booking.booking_code,
      'manage_token',v_booking.manage_token,'booking_date',v_booking.booking_date,
      'booking_time',v_booking.booking_time,'status',v_booking.status);
  end if;
  if exists(select 1 from public.bookings where request_id=p_request_id) then
    raise exception using errcode='23505',message='request_conflict';
  end if;

  select * into v_service from public.services where id=p_service and active for share;
  if not found then
    raise exception using errcode='P0001',message='service_unavailable';
  end if;
  v_performer := v_service.performer_id;
  if not v_public and v_performer is distinct from v_actor then
    raise exception using errcode='42501',message='provider_service_access_denied';
  end if;
  if v_team and (p_expected_price_rub is distinct from v_service.price_rub
      or p_expected_duration_minutes is distinct from v_service.duration_minutes) then
    return jsonb_build_object('result_code','service_terms_changed');
  end if;

  -- Match the exact-booking lock before reading candidates. This keeps selection
  -- and insertion in one transaction even when another writer takes the slot.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_performer::text || p_date::text,0));
  if v_team then
    select array_agg(slot.booking_time order by slot.booking_time) into v_slots
    from public.get_public_minuta_available_slots_v101(
      p_slug,p_location,p_service,p_date,p_date) slot
    where slot.booking_time between p_earliest and p_latest;
  else
    select array_agg(slot.booking_time order by slot.booking_time) into v_slots
    from public.get_available_slots_v101(p_service,p_date,p_date,null) slot
    where slot.booking_time between p_earliest and p_latest;
  end if;
  for v_slot in select unnest(coalesce(v_slots,'{}'::time without time zone[])) as booking_time
  loop
    begin
      if v_team then
        select * into v_created from public.book_minuta_appointment_v2(
          p_request_id,p_slug,p_location,p_service,p_date,v_slot.booking_time,
          p_client_name,p_client_phone,p_expected_price_rub,p_expected_duration_minutes);
        if v_created.result_code='service_terms_changed' then
          return jsonb_build_object('result_code','service_terms_changed');
        end if;
        if v_created.result_code<>'ok' then
          raise exception using errcode='55000',message='flexible_booking_unexpected_result';
        end if;
      else
        select * into v_created from public.book_appointment(
          p_request_id,p_service,p_date,v_slot.booking_time,p_client_name,p_client_phone);
      end if;
    exception when sqlstate 'P0001' then
      if sqlerrm in ('slot_unavailable','resource_unavailable','booking_buffer_conflict') then
        continue;
      end if;
      raise;
    when exclusion_violation then
      -- Another writer or a booking constraint may have claimed this start.
      continue;
    end;
    select * into v_booking from public.bookings where request_id=p_request_id;
    if not found or v_booking.service_id is distinct from p_service
       or v_booking.booking_date is distinct from p_date
       or v_booking.booking_time is distinct from v_slot.booking_time then
      raise exception using errcode='55000',message='flexible_booking_acknowledgement_invalid';
    end if;
    insert into public.flexible_booking_requests_v180(request_id,request_fingerprint,booking_id)
      values(p_request_id,v_fingerprint,v_booking.id);
    return jsonb_build_object('result_code','ok','request_id',p_request_id,
      'booking_id',v_booking.id,'booking_code',v_booking.booking_code,
      'manage_token',v_booking.manage_token,'booking_date',v_booking.booking_date,
      'booking_time',v_booking.booking_time,'status',v_booking.status);
  end loop;
  return jsonb_build_object('result_code','no_slot_in_range','request_id',p_request_id);
end;
$$;

revoke all on function public.book_flexible_appointment_v180(
  uuid,uuid,date,time without time zone,time without time zone,text,text,text,uuid,integer,integer,text)
  from public,anon,authenticated,service_role;
grant execute on function public.book_flexible_appointment_v180(
  uuid,uuid,date,time without time zone,time without time zone,text,text,text,uuid,integer,integer,text)
  to anon,authenticated;
do $stamp$
declare v_proc regprocedure := 'public.book_flexible_appointment_v180(uuid,uuid,date,time without time zone,time without time zone,text,text,text,uuid,integer,integer,text)'::regprocedure;
begin
  execute format('comment on function %s is %L',v_proc,
    (select 'primetime_flexible_v180:md5='||md5(replace(prosrc,E'\r',''))
     from pg_catalog.pg_proc where oid=v_proc));
end
$stamp$;
notify pgrst,'reload schema';
commit;
