-- v197 Source candidate: atomic edit of ONE scheduled per-minute visit.
-- Not admitted for production. Full current restore/rollback and exact SQL gates remain.
begin;
set local lock_timeout='10s';
set local statement_timeout='2min';

do $guard$
begin
  if to_regclass('public.bookings') is null
    or to_regclass('public.booking_session_items') is null
    or to_regclass('public.booking_session_revisions') is null
    or to_regclass('public.booking_outcomes') is null
    or to_regprocedure('auth.uid()') is null
    or to_regprocedure('pg_catalog.sha256(bytea)') is null then
    raise exception using errcode='55000',message='v197_visit_terms_prerequisites_missing';
  end if;
  if to_regclass('public.provider_visit_terms_edits_v197') is not null
    or to_regprocedure('public.minuta_visit_terms_snapshot_v197(public.bookings)') is not null
    or to_regprocedure('public.get_minuta_visit_terms_v197(uuid)') is not null
    or to_regprocedure('public.save_minuta_visit_terms_v197(uuid,uuid,jsonb,numeric,numeric)') is not null then
    raise exception using errcode='55000',message='v197_visit_terms_state_not_absent';
  end if;
  if not exists(select 1 from pg_catalog.pg_constraint c
    where c.conrelid='public.booking_session_revisions'::regclass
      and c.conname='booking_session_revisions_total_duration_minutes_check'
      and pg_catalog.pg_get_constraintdef(c.oid)='CHECK (((total_duration_minutes >= 5) AND (total_duration_minutes <= 480)))') then
    raise exception using errcode='55000',message='v197_revision_duration_contract_drift';
  end if;
end
$guard$;

alter table public.booking_session_revisions
  drop constraint booking_session_revisions_total_duration_minutes_check;
alter table public.booking_session_revisions
  add constraint booking_session_revisions_total_duration_minutes_check
  check(total_duration_minutes between 1 and 480);

-- A separate mutation namespace. Receipt retention does not change booking deletion.
create table public.provider_visit_terms_edits_v197(
  request_id uuid primary key,
  performer_id uuid not null,
  organization_id uuid not null,
  booking_id uuid not null,
  request_fingerprint text not null check(length(request_fingerprint)=64),
  result jsonb not null check(jsonb_typeof(result)='object'),
  created_at timestamptz not null default clock_timestamp()
);
alter table public.provider_visit_terms_edits_v197 owner to postgres;
alter table public.provider_visit_terms_edits_v197 enable row level security;
alter table public.provider_visit_terms_edits_v197 force row level security;
revoke all on table public.provider_visit_terms_edits_v197 from public,anon,authenticated,service_role;

create function public.minuta_visit_terms_snapshot_v197(p_booking public.bookings)
returns jsonb language sql stable security invoker set search_path='' as $snapshot$
  with state as (
  select jsonb_build_object(
    'actorId',p_booking.performer_id,'organizationId',p_booking.organization_id,
    'bookingId',p_booking.id,'serviceId',p_booking.service_id,
    'date',p_booking.booking_date,'time',p_booking.booking_time,'status',p_booking.status,
    'minuteRateRub',p_booking.original_price_rub,'durationMinutes',p_booking.duration_minutes,
    'totalAmountRub',p_booking.total_price_rub,
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'id',i.id,'position',i.position,'kind',i.item_kind,'service_id',i.service_id,
      'title',i.title,'duration_minutes',i.duration_minutes,'price_rub',i.price_rub,
      'extends_duration',i.extends_duration) order by i.position,i.id)
      from public.booking_session_items i where i.booking_id=p_booking.id),'[]'::jsonb),
    -- Include EVERY revision, so a late writer with an older transaction timestamp
    -- still invalidates CAS. A timestamp or a randomly ordered UUID alone cannot.
    'revisionsDigest',encode(pg_catalog.sha256(convert_to(coalesce((select jsonb_agg(
      jsonb_build_object('id',r.id,'actor',r.performer_id,'items',r.items,
        'total',r.total_price_rub,'minutes',r.total_duration_minutes,'at',r.created_at) order by r.id)
      from public.booking_session_revisions r where r.booking_id=p_booking.id),'[]'::jsonb)::text,'UTF8')),'hex')
  ) as value
  )
  select value||jsonb_build_object('pricingMode',case
    when exists(select 1 from public.services s where s.id=p_booking.service_id
      and s.performer_id=p_booking.performer_id and s.duration_minutes=1)
    or exists(select 1 from public.provider_visit_terms_edits_v197 e
      where e.booking_id=p_booking.id and e.performer_id=p_booking.performer_id and e.organization_id=p_booking.organization_id
        and ((e.result->'after')-array['pricingMode','date','time','status'])=(value-array['date','time','status']))
    then 'per_minute' else 'unqualified' end) from state
$snapshot$;
alter function public.minuta_visit_terms_snapshot_v197(public.bookings) owner to postgres;
revoke all on function public.minuta_visit_terms_snapshot_v197(public.bookings) from public,anon,authenticated,service_role;

create function public.get_minuta_visit_terms_v197(p_booking uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $read$
declare v_booking public.bookings%rowtype;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication_required'; end if;
  select * into v_booking from public.bookings b where b.id=p_booking and b.performer_id=auth.uid();
  if not found then raise exception using errcode='42501',message='visit_terms_access_denied'; end if;
  if exists(select 1 from public.booking_session_items i where i.booking_id=p_booking and i.performer_id<>auth.uid()) then
    raise exception using errcode='55000',message='visit_terms_session_not_qualified';
  end if;
  return public.minuta_visit_terms_snapshot_v197(v_booking);
end
$read$;
alter function public.get_minuta_visit_terms_v197(uuid) owner to postgres;
revoke all on function public.get_minuta_visit_terms_v197(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_minuta_visit_terms_v197(uuid) to authenticated;

create function public.save_minuta_visit_terms_v197(
  p_request_id uuid,p_booking uuid,p_expected jsonb,p_minute_rate numeric,p_primary_minutes numeric
)
returns jsonb language plpgsql volatile security definer set search_path='' as $save$
declare
  v_actor uuid:=auth.uid();
  v_booking public.bookings%rowtype;
  v_original public.bookings%rowtype;
  v_existing public.provider_visit_terms_edits_v197%rowtype;
  v_primary public.booking_session_items%rowtype;
  v_original_primary public.booking_session_items%rowtype;
  v_fingerprint text;
  v_before jsonb;
  v_after jsonb;
  v_current jsonb;
  v_addons jsonb;
  v_revision_items jsonb;
  v_revision uuid;
  v_primary_id uuid;
  v_lock_organization uuid;
  v_lock_date date;
  v_primary_amount bigint;
  v_total bigint;
  v_minutes bigint;
  v_result jsonb;
begin
  if v_actor is null then raise exception using errcode='42501',message='authentication_required'; end if;
  if p_request_id is null or p_booking is null or jsonb_typeof(p_expected) is distinct from 'object'
    or p_minute_rate is null or p_minute_rate not between 0 and 1000000 or p_minute_rate<>trunc(p_minute_rate)
    or p_primary_minutes is null or p_primary_minutes not between 1 and 480 or p_primary_minutes<>trunc(p_primary_minutes) then
    raise exception using errcode='22023',message='invalid_visit_terms';
  end if;
  v_primary_amount:=p_minute_rate*p_primary_minutes;
  if v_primary_amount>1000000 then raise exception using errcode='22023',message='visit_terms_primary_amount_out_of_range'; end if;
  v_fingerprint:=encode(pg_catalog.sha256(convert_to(jsonb_build_array(
    'visit_terms_edit_v197',v_actor,p_booking,p_expected,p_minute_rate::integer,p_primary_minutes::integer)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,19701));
  select * into v_existing from public.provider_visit_terms_edits_v197 e where e.request_id=p_request_id;
  if found then
    if v_existing.performer_id<>v_actor then raise exception using errcode='42501',message='visit_terms_access_denied'; end if;
    if v_existing.request_fingerprint<>v_fingerprint then raise exception using errcode='22023',message='visit_terms_request_reused'; end if;
    select * into v_booking from public.bookings b where b.id=p_booking and b.performer_id=v_actor and b.organization_id=v_existing.organization_id;
    if found then v_current:=public.minuta_visit_terms_snapshot_v197(v_booking); end if;
    return v_existing.result||jsonb_build_object('replayed',true,'currentSnapshot',v_current,
      'currentMatchesReceipt',coalesce(v_current=v_existing.result->'after',false));
  end if;
  -- Do not turn a saved creation identity into a new edit attempt.
  if exists(select 1 from public.bookings b where b.request_id=p_request_id) then
    raise exception using errcode='22023',message='visit_terms_creation_request_reused';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_booking::text,7302));
  select * into v_booking from public.bookings b where b.id=p_booking;
  if not found or v_booking.performer_id<>v_actor then raise exception using errcode='42501',message='visit_terms_access_denied'; end if;
  if v_booking.organization_id is null then raise exception using errcode='55000',message='visit_terms_organization_missing'; end if;
  v_lock_organization:=v_booking.organization_id;
  v_lock_date:=v_booking.booking_date;
  perform pg_advisory_xact_lock(hashtextextended(v_booking.organization_id::text,7100));
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text||v_booking.booking_date::text,0));
  begin
    select * into v_booking from public.bookings b where b.id=p_booking for update nowait;
  exception when lock_not_available then
    raise exception using errcode='40001',message='visit_terms_booking_busy';
  end;
  if not found or v_booking.performer_id<>v_actor then raise exception using errcode='42501',message='visit_terms_access_denied'; end if;
  if v_booking.organization_id is distinct from v_lock_organization or v_booking.booking_date is distinct from v_lock_date then
    raise exception using errcode='40001',message='visit_terms_booking_changed';
  end if;
  perform 1 from public.booking_session_items i where i.booking_id=p_booking order by i.position for update;
  perform 1 from public.booking_outcomes o where o.booking_id=p_booking for update;
  perform 1 from public.services s where s.id=v_booking.service_id and s.performer_id=v_actor for share;
  if not found then raise exception using errcode='42501',message='visit_terms_service_access_denied'; end if;
  v_original:=v_booking;
  v_before:=public.minuta_visit_terms_snapshot_v197(v_booking);
  if v_before<>p_expected then raise exception using errcode='40001',message='visit_terms_booking_changed'; end if;
  if v_before->>'pricingMode'<>'per_minute' or v_booking.original_price_rub is null
    or v_booking.total_price_rub is null or v_booking.status='cancelled' or v_booking.client_phone='0000000000'
    or (v_booking.booking_date+v_booking.booking_time)<(clock_timestamp() at time zone 'Europe/Samara')
    or exists(select 1 from public.booking_outcomes o where o.booking_id=p_booking and o.visit_status<>'scheduled') then
    raise exception using errcode='55000',message='visit_terms_edit_not_qualified';
  end if;
  if (select count(*) from public.booking_session_items i where i.booking_id=p_booking) not between 1 and 20
    or (select count(*) from public.booking_session_items i where i.booking_id=p_booking and i.item_kind='primary')<>1
    or exists(select 1 from public.booking_session_items i where i.booking_id=p_booking and i.performer_id<>v_actor) then
    raise exception using errcode='55000',message='visit_terms_session_not_qualified';
  end if;
  select * into v_primary from public.booking_session_items i where i.booking_id=p_booking and i.item_kind='primary';
  v_primary_id:=v_primary.id;
  v_original_primary:=v_primary;
  if v_primary.position<>1 or v_primary.service_id is distinct from v_booking.service_id
    or v_primary.price_rub::bigint<>v_booking.original_price_rub::bigint*v_primary.duration_minutes then
    raise exception using errcode='55000',message='visit_terms_primary_not_qualified';
  end if;
  select coalesce(jsonb_agg(to_jsonb(i) order by i.position,i.id),'[]'::jsonb)
    into v_addons from public.booking_session_items i where i.booking_id=p_booking and i.item_kind='addon';
  select v_primary_amount+coalesce(sum(i.price_rub),0),p_primary_minutes+coalesce(sum(i.duration_minutes) filter(where i.extends_duration),0)
    into v_total,v_minutes from public.booking_session_items i where i.booking_id=p_booking and i.item_kind='addon';
  if v_total not between 0 and 10000000 or v_minutes not between 1 and 480 then
    raise exception using errcode='22023',message='visit_terms_session_out_of_range';
  end if;
  if v_booking.total_price_rub<>(select sum(i.price_rub) from public.booking_session_items i where i.booking_id=p_booking)
    or v_booking.duration_minutes<>v_primary.duration_minutes+(select coalesce(sum(i.duration_minutes),0) from public.booking_session_items i where i.booking_id=p_booking and i.item_kind='addon' and i.extends_duration) then
    raise exception using errcode='55000',message='visit_terms_session_not_qualified';
  end if;
  update public.booking_session_items i set duration_minutes=p_primary_minutes::integer,price_rub=v_primary_amount::integer
    where i.id=v_primary.id and i.booking_id=p_booking and i.performer_id=v_actor;
  -- Preserve v156's price-only path: UPDATE OF duration must not fire for an unchanged interval.
  if v_minutes is distinct from v_booking.duration_minutes then
    update public.bookings b set original_price_rub=p_minute_rate::integer,total_price_rub=v_total::integer,duration_minutes=v_minutes::integer where b.id=p_booking;
  else
    update public.bookings b set original_price_rub=p_minute_rate::integer,total_price_rub=v_total::integer where b.id=p_booking;
  end if;
  select jsonb_agg(jsonb_build_object('kind',i.item_kind,'service_id',i.service_id,'title',i.title,
    'duration_minutes',i.duration_minutes,'price_rub',i.price_rub,'extends_duration',i.extends_duration) order by i.position,i.id)
    into v_revision_items from public.booking_session_items i where i.booking_id=p_booking;
  insert into public.booking_session_revisions(booking_id,performer_id,items,total_price_rub,total_duration_minutes)
    values(p_booking,v_actor,v_revision_items,v_total::integer,v_minutes::integer) returning id into v_revision;
  select * into v_booking from public.bookings b where b.id=p_booking;
  select * into v_primary from public.booking_session_items i where i.id=v_primary_id;
  if not found or v_booking.id is distinct from p_booking
    or (to_jsonb(v_booking)-array['original_price_rub','total_price_rub','duration_minutes','updated_at'])
      is distinct from (to_jsonb(v_original)-array['original_price_rub','total_price_rub','duration_minutes','updated_at'])
    or v_booking.original_price_rub is distinct from p_minute_rate::integer or v_booking.total_price_rub is distinct from v_total::integer
    or v_booking.duration_minutes is distinct from v_minutes::integer or v_primary.price_rub is distinct from v_primary_amount::integer
    or v_primary.duration_minutes is distinct from p_primary_minutes::integer
    or (to_jsonb(v_primary)-array['price_rub','duration_minutes','updated_at'])
      is distinct from (to_jsonb(v_original_primary)-array['price_rub','duration_minutes','updated_at'])
    or (select count(*) from public.booking_session_items i where i.booking_id=p_booking and i.item_kind='primary')<>1
    or (select coalesce(jsonb_agg(to_jsonb(i) order by i.position,i.id),'[]'::jsonb) from public.booking_session_items i where i.booking_id=p_booking and i.item_kind='addon')<>v_addons
    or not exists(select 1 from public.booking_session_revisions r where r.id=v_revision and r.booking_id=p_booking and r.performer_id=v_actor
      and r.items=v_revision_items and r.total_price_rub=v_total and r.total_duration_minutes=v_minutes) then
    raise exception using errcode='55000',message='visit_terms_readback_unconfirmed';
  end if;
  -- This successful, CAS-qualified mutation establishes the new receipt's mode.
  -- Prior receipts qualify only an unchanged service/session lineage, not A→B→A.
  v_after:=public.minuta_visit_terms_snapshot_v197(v_booking)||jsonb_build_object('pricingMode','per_minute');
  v_result:=jsonb_build_object('status','applied','requestId',p_request_id,'bookingId',p_booking,
    'actorId',v_actor,'organizationId',v_booking.organization_id,'appliedRevisionId',v_revision,
    'before',v_before,'after',v_after,'replayed',false,'currentMatchesReceipt',true);
  insert into public.provider_visit_terms_edits_v197(request_id,performer_id,organization_id,booking_id,request_fingerprint,result)
    values(p_request_id,v_actor,v_booking.organization_id,p_booking,v_fingerprint,v_result);
  return v_result;
end
$save$;
alter function public.save_minuta_visit_terms_v197(uuid,uuid,jsonb,numeric,numeric) owner to postgres;
revoke all on function public.save_minuta_visit_terms_v197(uuid,uuid,jsonb,numeric,numeric) from public,anon,authenticated,service_role;
grant execute on function public.save_minuta_visit_terms_v197(uuid,uuid,jsonb,numeric,numeric) to authenticated;

-- Hash-stamp only these NEW functions; guarded rollback compares pinned Source hashes too.
do $stamp$
declare f regprocedure; h text;
begin
  foreach f in array array[
    'public.minuta_visit_terms_snapshot_v197(public.bookings)'::regprocedure,
    'public.get_minuta_visit_terms_v197(uuid)'::regprocedure,
    'public.save_minuta_visit_terms_v197(uuid,uuid,jsonb,numeric,numeric)'::regprocedure] loop
    select encode(pg_catalog.sha256(convert_to(replace(p.prosrc,E'\r',''),'UTF8')),'hex') into h from pg_catalog.pg_proc p where p.oid=f;
    execute format('comment on function %s is %L',f,'minuta_visit_terms_v197:sha256='||h);
  end loop;
end
$stamp$;
notify pgrst,'reload schema';
commit;
