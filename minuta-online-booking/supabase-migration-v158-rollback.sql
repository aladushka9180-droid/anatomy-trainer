-- Roll back v158 only before any durable automatic-break release was recorded.
begin;
set local lock_timeout='10s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $guard$
declare item record; v_hash text; v_table regclass; v_schema text;
begin
  if to_regclass('public.booking_buffer_release_requests_v158') is null
     or to_regclass('public.booking_buffer_release_sources_v158') is null then
    raise exception using errcode='55000',message='v158_rollback_requires_exact_schema';
  end if;
  if exists(select 1 from public.booking_buffer_release_requests_v158) then
    raise exception using errcode='55000',message='v158_rollback_blocked_durable_history_exists';
  end if;
  for item in select * from (values
    ('public.minuta_booking_buffer_source_snapshot_v158(public.bookings,integer)'::text,'minuta_booking_buffer_source_snapshot_v158'),
    ('public.minuta_booking_buffer_allows_interval_v158(uuid,date,time without time zone,integer,uuid)','minuta_booking_buffer_allows_interval_v158'),
    ('public.get_minuta_provider_automatic_breaks_v158(date)','minuta_provider_automatic_breaks_v158'),
    ('public.release_minuta_provider_automatic_break_v158(uuid,date,time without time zone,time without time zone,text)','minuta_provider_automatic_break_release_v158'),
    ('public.minuta_slot_respects_booking_buffer(uuid,date,time without time zone,integer,uuid)','minuta_slot_respects_booking_buffer_v158'),
    ('public.enforce_minuta_booking_buffer_v101()','enforce_minuta_booking_buffer_v158')
  ) marker(signature,prefix) loop
    if to_regprocedure(item.signature) is null then
      raise exception using errcode='55000',message='v158_rollback_requires_exact_schema';
    end if;
    select encode(extensions.digest(convert_to(replace(proc.prosrc,E'\r',''),'UTF8'),'sha256'),'hex') into v_hash
    from pg_catalog.pg_proc proc where proc.oid=to_regprocedure(item.signature);
    if pg_catalog.obj_description(to_regprocedure(item.signature),'pg_proc') is distinct from item.prefix||':sha256='||v_hash then
      raise exception using errcode='55000',message='v158_rollback_requires_exact_schema';
    end if;
  end loop;
  foreach v_table in array array['public.booking_buffer_release_requests_v158'::regclass,'public.booking_buffer_release_sources_v158'::regclass] loop
    select encode(extensions.digest(convert_to(jsonb_build_object(
      'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attnum)
        from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=v_table and a.attnum>0 and not a.attisdropped),
      'constraints',(select jsonb_agg(pg_get_constraintdef(c.oid,true) order by c.conname) from pg_constraint c where c.conrelid=v_table),
      'indexes',(select jsonb_agg(pg_get_indexdef(i.indexrelid) order by i.indexrelid) from pg_index i where i.indrelid=v_table)
    )::text,'UTF8'),'sha256'),'hex') into v_schema;
    if pg_catalog.obj_description(v_table,'pg_class') is distinct from 'minuta_booking_buffer_release_v158:sha256='||v_schema then
      raise exception using errcode='55000',message='v158_rollback_requires_exact_schema';
    end if;
  end loop;
end
$guard$;

create or replace function public.minuta_slot_respects_booking_buffer(
  p_service uuid,
  p_date date,
  p_time time without time zone,
  p_duration integer default null,
  p_ignore_booking uuid default null
)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select case
    when service.id is null then false
    when not coalesce(policy.booking_buffer_enabled, false) then true
    else not exists (
      select 1
      from public.bookings booking
      where booking.performer_id = service.performer_id
        and booking.booking_date = p_date
        and booking.status <> 'cancelled'
        and regexp_replace(coalesce(booking.client_phone, ''), '\D', '', 'g') <> '0000000000'
        and (p_ignore_booking is null or booking.id <> p_ignore_booking)
        and tsrange(
          p_date + p_time,
          p_date + p_time + make_interval(mins => coalesce(p_duration, service.duration_minutes)),
          '[)'
        ) && tsrange(
          booking.booking_date + booking.booking_time - make_interval(mins => policy.booking_buffer_minutes),
          booking.booking_date + booking.booking_time + make_interval(mins => booking.duration_minutes + policy.booking_buffer_minutes),
          '[)'
        )
    )
  end
  from public.services service
  left join public.booking_policies policy on policy.performer_id = service.performer_id
  where service.id = p_service;
$$;
revoke all on function public.minuta_slot_respects_booking_buffer(uuid,date,time without time zone,integer,uuid)
  from public,anon,authenticated,service_role;
alter function public.minuta_slot_respects_booking_buffer(uuid,date,time without time zone,integer,uuid) owner to postgres;
comment on function public.minuta_slot_respects_booking_buffer(uuid,date,time without time zone,integer,uuid) is null;

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
     and (regexp_replace(coalesce(old.client_phone, ''), '\D', '', 'g') = '0000000000')
       = (regexp_replace(coalesce(new.client_phone, ''), '\D', '', 'g') = '0000000000') then
    return new;
  end if;
  select policy.booking_buffer_enabled, policy.booking_buffer_minutes
  into v_enabled, v_minutes
  from public.booking_policies policy
  where policy.performer_id = new.performer_id;
  if not coalesce(v_enabled, false) then return new; end if;
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
      and tsrange(new.booking_date + new.booking_time,new.booking_date + new.booking_time + make_interval(mins => new.duration_minutes),'[)')
        && tsrange(booking.booking_date + booking.booking_time - make_interval(mins => v_minutes),booking.booking_date + booking.booking_time + make_interval(mins => booking.duration_minutes + v_minutes),'[)')
  ) then
    raise exception using errcode = 'P0001', message = 'booking_buffer_conflict';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_minuta_booking_buffer_v101() from public,anon,authenticated,service_role;
alter function public.enforce_minuta_booking_buffer_v101() owner to postgres;
comment on function public.enforce_minuta_booking_buffer_v101() is null;

drop function public.release_minuta_provider_automatic_break_v158(uuid,date,time without time zone,time without time zone,text);
drop function public.get_minuta_provider_automatic_breaks_v158(date);
drop function public.minuta_booking_buffer_allows_interval_v158(uuid,date,time without time zone,integer,uuid);
drop function public.minuta_booking_buffer_source_snapshot_v158(public.bookings,integer);
drop table public.booking_buffer_release_sources_v158;
drop table public.booking_buffer_release_requests_v158;

commit;
