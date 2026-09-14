-- v158: durable, source-bound release of one automatic booking-buffer interval.
begin;
set local lock_timeout='10s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $guard$
begin
  if to_regclass('public.bookings') is null
     or to_regclass('public.booking_policies') is null
     or to_regclass('public.provider_schedule') is null
     or to_regprocedure('public.minuta_slot_respects_booking_buffer(uuid,date,time without time zone,integer,uuid)') is null
     or to_regprocedure('public.enforce_minuta_booking_buffer_v101()') is null
     or to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception using errcode='55000',message='v158_booking_buffer_release_prerequisites_missing';
  end if;
  if (select encode(extensions.digest(convert_to(replace(proc.prosrc,E'\r',''),'UTF8'),'sha256'),'hex')
      from pg_catalog.pg_proc proc where proc.oid=to_regprocedure('public.minuta_slot_respects_booking_buffer(uuid,date,time without time zone,integer,uuid)'))
       <>'64230944d18df6c741a2659e70204528b66f56d712a409da3a39935e6e8b5503'
     or pg_catalog.obj_description(to_regprocedure('public.minuta_slot_respects_booking_buffer(uuid,date,time without time zone,integer,uuid)'),'pg_proc') is not null
     or (select encode(extensions.digest(convert_to(replace(proc.prosrc,E'\r',''),'UTF8'),'sha256'),'hex')
      from pg_catalog.pg_proc proc where proc.oid=to_regprocedure('public.enforce_minuta_booking_buffer_v101()'))
       <>'282ede95c6ed88217ad3c706a44c7dee70f08346b493cc23b2e75fe556daef9d'
     or pg_catalog.obj_description(to_regprocedure('public.enforce_minuta_booking_buffer_v101()'),'pg_proc') is not null then
    raise exception using errcode='55000',message='v158_booking_buffer_release_baseline_drift';
  end if;
  if to_regclass('public.booking_buffer_release_requests_v158') is not null
     or to_regclass('public.booking_buffer_release_sources_v158') is not null
     or to_regprocedure('public.minuta_booking_buffer_source_snapshot_v158(public.bookings,integer)') is not null
     or to_regprocedure('public.minuta_booking_buffer_allows_interval_v158(uuid,date,time without time zone,integer,uuid)') is not null
     or to_regprocedure('public.get_minuta_provider_automatic_breaks_v158(date)') is not null
     or to_regprocedure('public.release_minuta_provider_automatic_break_v158(uuid,date,time without time zone,time without time zone,text)') is not null then
    raise exception using errcode='55000',message='v158_booking_buffer_release_state_not_absent';
  end if;
end
$guard$;

create table public.booking_buffer_release_requests_v158 (
  id uuid primary key default extensions.gen_random_uuid(),
  request_id uuid not null unique,
  request_fingerprint text not null check(char_length(request_fingerprint)=64),
  performer_id uuid not null references auth.users(id) on delete cascade,
  booking_date date not null,
  release_start timestamp without time zone not null,
  release_end timestamp without time zone not null,
  segment_fingerprint text not null check(char_length(segment_fingerprint)=64),
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  check(release_end>release_start),
  check(release_start::date=booking_date and release_end::date=booking_date)
);

create table public.booking_buffer_release_sources_v158 (
  release_id uuid not null references public.booking_buffer_release_requests_v158(id) on delete cascade,
  source_booking_id uuid not null references public.bookings(id) on delete cascade,
  source_side text not null check(source_side in('before','after')),
  source_snapshot jsonb not null,
  source_overlap_start timestamp without time zone not null,
  source_overlap_end timestamp without time zone not null,
  primary key(release_id,source_booking_id,source_side),
  check(source_overlap_end>source_overlap_start)
);

create index booking_buffer_release_requests_v158_performer_date_idx
  on public.booking_buffer_release_requests_v158(performer_id,booking_date,created_at desc);
create index booking_buffer_release_sources_v158_booking_idx
  on public.booking_buffer_release_sources_v158(source_booking_id,source_side);

alter table public.booking_buffer_release_requests_v158 enable row level security;
alter table public.booking_buffer_release_requests_v158 force row level security;
alter table public.booking_buffer_release_sources_v158 enable row level security;
alter table public.booking_buffer_release_sources_v158 force row level security;
alter table public.booking_buffer_release_requests_v158 owner to postgres;
alter table public.booking_buffer_release_sources_v158 owner to postgres;
revoke all on table public.booking_buffer_release_requests_v158,public.booking_buffer_release_sources_v158
  from public,anon,authenticated,service_role;
grant all on table public.booking_buffer_release_requests_v158,public.booking_buffer_release_sources_v158
  to service_role;

create function public.minuta_booking_buffer_source_snapshot_v158(
  p_booking public.bookings,
  p_buffer_minutes integer
)
returns jsonb
language sql
immutable
security invoker
set search_path to ''
as $$
  select jsonb_build_object(
    'booking_id',p_booking.id,
    'booking_date',p_booking.booking_date,
    'booking_time',p_booking.booking_time,
    'duration_minutes',p_booking.duration_minutes,
    'status',p_booking.status,
    'buffer_minutes',p_buffer_minutes
  )
$$;
revoke all on function public.minuta_booking_buffer_source_snapshot_v158(public.bookings,integer)
  from public,anon,authenticated,service_role;
alter function public.minuta_booking_buffer_source_snapshot_v158(public.bookings,integer) owner to postgres;

create function public.minuta_booking_buffer_allows_interval_v158(
  p_performer uuid,
  p_date date,
  p_time time without time zone,
  p_duration integer,
  p_ignore_booking uuid default null
)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  with policy as (
    select booking_buffer_enabled,booking_buffer_minutes
    from public.booking_policies where performer_id=p_performer
  ), candidate as (
    select p_date+p_time as starts_at,
      p_date+p_time+make_interval(mins=>p_duration) as ends_at,
      coalesce((select booking_buffer_enabled from policy),false) as enabled,
      coalesce((select booking_buffer_minutes from policy),60) as buffer_minutes
  )
  select case when not candidate.enabled then true else not exists(
    select 1
    from public.bookings booking
    cross join lateral(values
      ('before'::text,booking.booking_date+booking.booking_time-make_interval(mins=>candidate.buffer_minutes),booking.booking_date+booking.booking_time),
      ('after'::text,booking.booking_date+booking.booking_time+make_interval(mins=>booking.duration_minutes),booking.booking_date+booking.booking_time+make_interval(mins=>booking.duration_minutes+candidate.buffer_minutes))
    ) source(side,starts_at,ends_at)
    where booking.performer_id=p_performer
      and booking.booking_date=p_date
      and booking.status<>'cancelled'
      and regexp_replace(coalesce(booking.client_phone,''),'\D','','g')<>'0000000000'
      and (p_ignore_booking is null or booking.id<>p_ignore_booking)
      and (
        tsrange(candidate.starts_at,candidate.ends_at,'[)') && tsrange(booking.booking_date+booking.booking_time,booking.booking_date+booking.booking_time+make_interval(mins=>booking.duration_minutes),'[)')
        or (
          tsrange(candidate.starts_at,candidate.ends_at,'[)') && tsrange(source.starts_at,source.ends_at,'[)')
          and not exists(
            select 1
            from public.booking_buffer_release_sources_v158 released
            join public.booking_buffer_release_requests_v158 request on request.id=released.release_id
            where request.performer_id=p_performer and request.booking_date=p_date
              and released.source_booking_id=booking.id and released.source_side=source.side
              and released.source_snapshot=public.minuta_booking_buffer_source_snapshot_v158(booking,candidate.buffer_minutes)
              and greatest(candidate.starts_at,source.starts_at)>=released.source_overlap_start
              and least(candidate.ends_at,source.ends_at)<=released.source_overlap_end
          )
        )
      )
  ) end
  from candidate
$$;
revoke all on function public.minuta_booking_buffer_allows_interval_v158(uuid,date,time without time zone,integer,uuid)
  from public,anon,authenticated,service_role;
alter function public.minuta_booking_buffer_allows_interval_v158(uuid,date,time without time zone,integer,uuid) owner to postgres;

create function public.get_minuta_provider_automatic_breaks_v158(p_date date)
returns table(start_time time without time zone,end_time time without time zone,source_count integer,segment_fingerprint text)
language sql
stable
security definer
set search_path to ''
as $$
  with actor as (select auth.uid() as id),
  policy as (
    select policy.booking_buffer_enabled,policy.booking_buffer_minutes
    from public.booking_policies policy join actor on actor.id=policy.performer_id
  ), bounds as (
    select p_date+coalesce(schedule.start_time,'10:00'::time) as starts_at,
      p_date+coalesce(schedule.end_time,'20:00'::time) as ends_at,
      policy.booking_buffer_minutes
    from actor cross join policy
    left join public.provider_schedule schedule on schedule.performer_id=actor.id
      and schedule.weekday=extract(isodow from p_date)::integer and schedule.enabled
    where actor.id is not null and policy.booking_buffer_enabled
  ), minute_grid as (
    select generated as minute_at,bounds.booking_buffer_minutes
    from bounds cross join lateral generate_series(bounds.starts_at,bounds.ends_at-interval '1 minute',interval '1 minute') generated
    where bounds.ends_at>bounds.starts_at
  ), effective_sources as (
    select minute_grid.minute_at,booking.id as booking_id,source.side,
      public.minuta_booking_buffer_source_snapshot_v158(booking,minute_grid.booking_buffer_minutes) as snapshot
    from minute_grid
    join actor on true
    join public.bookings booking on booking.performer_id=actor.id and booking.booking_date=p_date
      and booking.status<>'cancelled' and regexp_replace(coalesce(booking.client_phone,''),'\D','','g')<>'0000000000'
    cross join lateral(values
      ('before'::text,booking.booking_date+booking.booking_time-make_interval(mins=>minute_grid.booking_buffer_minutes),booking.booking_date+booking.booking_time),
      ('after'::text,booking.booking_date+booking.booking_time+make_interval(mins=>booking.duration_minutes),booking.booking_date+booking.booking_time+make_interval(mins=>booking.duration_minutes+minute_grid.booking_buffer_minutes))
    ) source(side,starts_at,ends_at)
    where minute_grid.minute_at>=source.starts_at and minute_grid.minute_at<source.ends_at
      and not exists(
        select 1 from public.bookings occupied
        where occupied.performer_id=actor.id and occupied.booking_date=p_date and occupied.status<>'cancelled'
          and minute_grid.minute_at>=occupied.booking_date+occupied.booking_time
          and minute_grid.minute_at<occupied.booking_date+occupied.booking_time+make_interval(mins=>occupied.duration_minutes)
      )
      and not exists(
        select 1
        from public.booking_buffer_release_sources_v158 released
        join public.booking_buffer_release_requests_v158 request on request.id=released.release_id
        where request.performer_id=actor.id and request.booking_date=p_date
          and released.source_booking_id=booking.id and released.source_side=source.side
          and released.source_snapshot=public.minuta_booking_buffer_source_snapshot_v158(booking,minute_grid.booking_buffer_minutes)
          and minute_grid.minute_at>=released.source_overlap_start and minute_grid.minute_at<released.source_overlap_end
      )
  ), occupied_minutes as (
    select distinct minute_at from effective_sources
  ), numbered as (
    select minute_at,minute_at-row_number() over(order by minute_at)*interval '1 minute' as island
    from occupied_minutes
  ), segments as (
    select min(minute_at) as starts_at,max(minute_at)+interval '1 minute' as ends_at
    from numbered group by island
  )
  select segments.starts_at::time,segments.ends_at::time,
    count(distinct effective_sources.booking_id::text||':'||effective_sources.side)::integer,
    encode(extensions.digest(convert_to(concat_ws('|',p_date::text,segments.starts_at::text,segments.ends_at::text,
      string_agg(distinct effective_sources.booking_id::text||':'||effective_sources.side||':'||effective_sources.snapshot::text,',' order by effective_sources.booking_id::text||':'||effective_sources.side||':'||effective_sources.snapshot::text)),'UTF8'),'sha256'),'hex')
  from segments join effective_sources on effective_sources.minute_at>=segments.starts_at and effective_sources.minute_at<segments.ends_at
  group by segments.starts_at,segments.ends_at
  order by segments.starts_at
$$;
revoke all on function public.get_minuta_provider_automatic_breaks_v158(date)
  from public,anon,authenticated,service_role;
grant execute on function public.get_minuta_provider_automatic_breaks_v158(date) to authenticated;
alter function public.get_minuta_provider_automatic_breaks_v158(date) owner to postgres;

create function public.release_minuta_provider_automatic_break_v158(
  p_request_id uuid,
  p_date date,
  p_start time without time zone,
  p_end time without time zone,
  p_expected_segment_fingerprint text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_actor uuid:=auth.uid();
  v_existing public.booking_buffer_release_requests_v158%rowtype;
  v_release_id uuid:=extensions.gen_random_uuid();
  v_fingerprint text;
  v_segment record;
  v_source_count integer:=0;
  v_buffer integer;
  v_booking_id uuid;
  v_result jsonb;
begin
  if v_actor is null then raise exception using errcode='42501',message='authentication_required'; end if;
  if p_request_id is null or p_date is null or p_start is null or p_end is null
     or p_end<=p_start or extract(second from p_start)<>0 or extract(second from p_end)<>0
     or p_date<(clock_timestamp() at time zone 'Europe/Samara')::date
     or p_expected_segment_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023',message='invalid_booking_buffer_release';
  end if;
  v_fingerprint:=encode(extensions.digest(convert_to(concat_ws('|','release',p_date::text,p_start::text,p_end::text,p_expected_segment_fingerprint),'UTF8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,15801));
  select * into v_existing from public.booking_buffer_release_requests_v158 where request_id=p_request_id;
  if found then
    if v_existing.performer_id is distinct from v_actor or v_existing.request_fingerprint<>v_fingerprint then
      raise exception using errcode='22023',message='booking_buffer_release_request_reused';
    end if;
    return v_existing.result||jsonb_build_object('replayed',true);
  end if;
  select booking_buffer_minutes into v_buffer from public.booking_policies
  where performer_id=v_actor and booking_buffer_enabled;
  if not found then raise exception using errcode='40001',message='booking_buffer_interval_changed'; end if;
  for v_booking_id in
    select booking.id from public.bookings booking
    where booking.performer_id=v_actor and booking.booking_date=p_date and booking.status<>'cancelled'
      and regexp_replace(coalesce(booking.client_phone,''),'\D','','g')<>'0000000000'
      and tsrange(p_date+p_start,p_date+p_end,'[)') && tsrange(
        booking.booking_date+booking.booking_time-make_interval(mins=>v_buffer),
        booking.booking_date+booking.booking_time+make_interval(mins=>booking.duration_minutes+v_buffer),'[)')
    order by booking.id
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_booking_id::text,7302));
  end loop;
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text||p_date::text,0));
  select * into v_segment from public.get_minuta_provider_automatic_breaks_v158(p_date)
  where start_time=p_start and end_time=p_end;
  if not found or v_segment.segment_fingerprint<>p_expected_segment_fingerprint then
    raise exception using errcode='40001',message='booking_buffer_interval_changed';
  end if;
  v_source_count:=v_segment.source_count;
  v_result:=jsonb_build_object('action','released','request_id',p_request_id,'booking_date',p_date,
    'start_time',p_start,'end_time',p_end,'source_count',v_source_count,'segment_fingerprint',p_expected_segment_fingerprint,'replayed',false);
  insert into public.booking_buffer_release_requests_v158(
    id,request_id,request_fingerprint,performer_id,booking_date,release_start,release_end,segment_fingerprint,result
  ) values(v_release_id,p_request_id,v_fingerprint,v_actor,p_date,p_date+p_start,p_date+p_end,p_expected_segment_fingerprint,v_result);
  insert into public.booking_buffer_release_sources_v158(
    release_id,source_booking_id,source_side,source_snapshot,source_overlap_start,source_overlap_end
  )
  select v_release_id,booking.id,source.side,
    public.minuta_booking_buffer_source_snapshot_v158(booking,v_buffer),p_date+p_start,p_date+p_end
  from public.bookings booking
  cross join lateral(values
    ('before'::text,booking.booking_date+booking.booking_time-make_interval(mins=>v_buffer),booking.booking_date+booking.booking_time),
    ('after'::text,booking.booking_date+booking.booking_time+make_interval(mins=>booking.duration_minutes),booking.booking_date+booking.booking_time+make_interval(mins=>booking.duration_minutes+v_buffer))
  ) source(side,starts_at,ends_at)
  where booking.performer_id=v_actor and booking.booking_date=p_date and booking.status<>'cancelled'
    and regexp_replace(coalesce(booking.client_phone,''),'\D','','g')<>'0000000000'
    and tsrange(p_date+p_start,p_date+p_end,'[)') && tsrange(source.starts_at,source.ends_at,'[)');
  if (select count(*) from public.booking_buffer_release_sources_v158 where release_id=v_release_id)<>v_source_count then
    raise exception using errcode='40001',message='booking_buffer_interval_changed';
  end if;
  if exists(select 1 from public.get_minuta_provider_automatic_breaks_v158(p_date)
    where tsrange(p_date+start_time,p_date+end_time,'[)') && tsrange(p_date+p_start,p_date+p_end,'[)')) then
    raise exception using errcode='40001',message='booking_buffer_interval_not_released';
  end if;
  return v_result;
end
$$;
revoke all on function public.release_minuta_provider_automatic_break_v158(uuid,date,time without time zone,time without time zone,text)
  from public,anon,authenticated,service_role;
grant execute on function public.release_minuta_provider_automatic_break_v158(uuid,date,time without time zone,time without time zone,text)
  to authenticated;
alter function public.release_minuta_provider_automatic_break_v158(uuid,date,time without time zone,time without time zone,text) owner to postgres;

create or replace function public.minuta_slot_respects_booking_buffer(
  p_service uuid,p_date date,p_time time without time zone,p_duration integer default null,p_ignore_booking uuid default null
)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select case when service.id is null then false
    else public.minuta_booking_buffer_allows_interval_v158(service.performer_id,p_date,p_time,coalesce(p_duration,service.duration_minutes),p_ignore_booking)
  end
  from public.services service where service.id=p_service
$$;
revoke all on function public.minuta_slot_respects_booking_buffer(uuid,date,time without time zone,integer,uuid)
  from public,anon,authenticated,service_role;
alter function public.minuta_slot_respects_booking_buffer(uuid,date,time without time zone,integer,uuid) owner to postgres;

create or replace function public.enforce_minuta_booking_buffer_v101()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if new.status='cancelled' or regexp_replace(coalesce(new.client_phone,''),'\D','','g')='0000000000' then return new; end if;
  if tg_op='UPDATE' and new.performer_id is not distinct from old.performer_id
     and new.booking_date is not distinct from old.booking_date and new.booking_time is not distinct from old.booking_time
     and new.duration_minutes is not distinct from old.duration_minutes
     and not(old.status='cancelled' and new.status<>'cancelled')
     and (regexp_replace(coalesce(old.client_phone,''),'\D','','g')='0000000000')=(regexp_replace(coalesce(new.client_phone,''),'\D','','g')='0000000000') then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.performer_id::text||new.booking_date::text,0));
  if not public.minuta_booking_buffer_allows_interval_v158(new.performer_id,new.booking_date,new.booking_time,new.duration_minutes,
    case when tg_op='UPDATE' then new.id else null end) then
    raise exception using errcode='P0001',message='booking_buffer_conflict';
  end if;
  return new;
end
$$;
revoke all on function public.enforce_minuta_booking_buffer_v101() from public,anon,authenticated,service_role;
alter function public.enforce_minuta_booking_buffer_v101() owner to postgres;

do $markers$
declare item record; v_hash text; v_table regclass; v_schema text;
begin
  for item in select * from (values
    ('public.minuta_booking_buffer_source_snapshot_v158(public.bookings,integer)'::text,'minuta_booking_buffer_source_snapshot_v158'),
    ('public.minuta_booking_buffer_allows_interval_v158(uuid,date,time without time zone,integer,uuid)','minuta_booking_buffer_allows_interval_v158'),
    ('public.get_minuta_provider_automatic_breaks_v158(date)','minuta_provider_automatic_breaks_v158'),
    ('public.release_minuta_provider_automatic_break_v158(uuid,date,time without time zone,time without time zone,text)','minuta_provider_automatic_break_release_v158'),
    ('public.minuta_slot_respects_booking_buffer(uuid,date,time without time zone,integer,uuid)','minuta_slot_respects_booking_buffer_v158'),
    ('public.enforce_minuta_booking_buffer_v101()','enforce_minuta_booking_buffer_v158')
  ) marker(signature,prefix) loop
    select encode(extensions.digest(convert_to(replace(proc.prosrc,E'\r',''),'UTF8'),'sha256'),'hex') into v_hash
    from pg_catalog.pg_proc proc where proc.oid=to_regprocedure(item.signature);
    execute format('comment on function %s is %L',item.signature,item.prefix||':sha256='||v_hash);
  end loop;
  foreach v_table in array array['public.booking_buffer_release_requests_v158'::regclass,'public.booking_buffer_release_sources_v158'::regclass] loop
    select encode(extensions.digest(convert_to(jsonb_build_object(
      'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attnum)
        from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=v_table and a.attnum>0 and not a.attisdropped),
      'constraints',(select jsonb_agg(pg_get_constraintdef(c.oid,true) order by c.conname) from pg_constraint c where c.conrelid=v_table),
      'indexes',(select jsonb_agg(pg_get_indexdef(i.indexrelid) order by i.indexrelid) from pg_index i where i.indrelid=v_table)
    )::text,'UTF8'),'sha256'),'hex') into v_schema;
    execute format('comment on table %s is %L',v_table,'minuta_booking_buffer_release_v158:sha256='||v_schema);
  end loop;
end
$markers$;

commit;
