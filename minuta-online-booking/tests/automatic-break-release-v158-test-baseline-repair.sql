-- Narrow recovery for the isolated v158 test database after the first failed
-- rehearsal restored a whitespace-different v101 trigger body.
begin;
set local lock_timeout='10s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $guard$
declare v_hash text;
begin
  if to_regclass('public.booking_buffer_release_requests_v158') is not null
     or to_regclass('public.booking_buffer_release_sources_v158') is not null
     or to_regprocedure('public.minuta_booking_buffer_source_snapshot_v158(public.bookings,integer)') is not null
     or to_regprocedure('public.minuta_booking_buffer_allows_interval_v158(uuid,date,time without time zone,integer,uuid)') is not null
     or to_regprocedure('public.get_minuta_provider_automatic_breaks_v158(date)') is not null
     or to_regprocedure('public.release_minuta_provider_automatic_break_v158(uuid,date,time without time zone,time without time zone,text)') is not null then
    raise exception using errcode='55000',message='v158_test_baseline_repair_refused_objects_present';
  end if;
  select encode(extensions.digest(convert_to(replace(proc.prosrc,E'\r',''),'UTF8'),'sha256'),'hex') into v_hash
  from pg_catalog.pg_proc proc where proc.oid=to_regprocedure('public.minuta_slot_respects_booking_buffer(uuid,date,time without time zone,integer,uuid)');
  if v_hash is distinct from '177d9a40df6aea9ea27612015ea20c8c6afbaf07afd4683122b2578b9550aa74'
     or pg_catalog.obj_description(to_regprocedure('public.minuta_slot_respects_booking_buffer(uuid,date,time without time zone,integer,uuid)'),'pg_proc') is not null then
    raise exception using errcode='55000',message='v158_test_baseline_repair_refused_slot_helper_drift';
  end if;
  select encode(extensions.digest(convert_to(replace(proc.prosrc,E'\r',''),'UTF8'),'sha256'),'hex') into v_hash
  from pg_catalog.pg_proc proc where proc.oid=to_regprocedure('public.enforce_minuta_booking_buffer_v101()');
  if v_hash is distinct from '8556d1e7d93888d60934487d7a9fb61cf07f809f0fa670f3bf322cb897c14a8f'
     or pg_catalog.obj_description(to_regprocedure('public.enforce_minuta_booking_buffer_v101()'),'pg_proc') is not null then
    raise exception using errcode='55000',message='v158_test_baseline_repair_refused_trigger_helper_drift';
  end if;
end
$guard$;

create or replace function public.enforce_minuta_booking_buffer_v101()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_enabled boolean;
  v_minutes integer;
begin
  if new.status = 'cancelled'
     or regexp_replace(coalesce(new.client_phone, ''), '\D', '', 'g') = '0000000000' then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.performer_id is not distinct from old.performer_id
     and new.booking_date is not distinct from old.booking_date
     and new.booking_time is not distinct from old.booking_time
     and new.duration_minutes is not distinct from old.duration_minutes
     and not (old.status = 'cancelled' and new.status <> 'cancelled')
     and (
       regexp_replace(coalesce(old.client_phone, ''), '\D', '', 'g') = '0000000000'
     ) = (
       regexp_replace(coalesce(new.client_phone, ''), '\D', '', 'g') = '0000000000'
     ) then
    return new;
  end if;

  select policy.booking_buffer_enabled, policy.booking_buffer_minutes
  into v_enabled, v_minutes
  from public.booking_policies policy
  where policy.performer_id = new.performer_id;

  if not coalesce(v_enabled, false) then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.performer_id::text || new.booking_date::text, 0)
  );

  if exists (
    select 1
    from public.bookings booking
    where booking.performer_id = new.performer_id
      and booking.booking_date = new.booking_date
      and booking.status <> 'cancelled'
      and regexp_replace(coalesce(booking.client_phone, ''), '\D', '', 'g') <> '0000000000'
      and (tg_op = 'INSERT' or booking.id <> new.id)
      and tsrange(
        new.booking_date + new.booking_time,
        new.booking_date + new.booking_time + make_interval(mins => new.duration_minutes),
        '[)'
      ) && tsrange(
        booking.booking_date + booking.booking_time - make_interval(mins => v_minutes),
        booking.booking_date + booking.booking_time + make_interval(mins => booking.duration_minutes + v_minutes),
        '[)'
      )
  ) then
    raise exception using errcode = 'P0001', message = 'booking_buffer_conflict';
  end if;

  return new;
end;
$$;
revoke all on function public.enforce_minuta_booking_buffer_v101() from public,anon,authenticated,service_role;
alter function public.enforce_minuta_booking_buffer_v101() owner to postgres;
comment on function public.enforce_minuta_booking_buffer_v101() is null;

commit;
