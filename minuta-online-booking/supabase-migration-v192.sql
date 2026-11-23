-- v192 candidate: date-scoped provider hours and explicit offline exceptions.
-- No production application without the separate approved release and database gates.
begin;
set local lock_timeout='5s';
set local statement_timeout='2min';
do $guard$
begin
  if to_regclass('public.provider_day_schedule_v192') is not null then
    raise exception using errcode='55000',message='v192_already_present_verify_before_retry';
  end if;
  if md5(pg_get_functiondef(to_regprocedure('public.get_available_slots(uuid,date,date,uuid)'))) is distinct from 'a349da1694516d588485cc03e339dbbb'
    or md5(pg_get_functiondef(to_regprocedure('public.minuta_block_slot_valid_v141(uuid,uuid,date,time without time zone,integer,uuid)'))) is distinct from 'cd3297e95fb577d2f688470b4d821366'
    or md5(pg_get_functiondef(to_regprocedure('public.get_provider_block_slots_v141(uuid,uuid,date,integer,uuid)'))) is distinct from 'ff7d8e7a8165ff04f83fff5828784807'
    or md5(pg_get_functiondef(to_regprocedure('public.get_public_minuta_available_slots_v101(text,uuid,uuid,date,date)'))) is distinct from 'e4cae3106ef060b7da0d86d895189571' then
    raise exception using errcode='55000',message='v192_canonical_source_changed';
  end if;
end $guard$;

create table public.provider_day_schedule_v192(
  performer_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  work_date date not null,
  start_time time without time zone not null,
  end_time time without time zone not null,
  online_enabled boolean not null default false,
  ignored_closures jsonb not null default '{}'::jsonb,
  revision bigint not null default 1,
  updated_at timestamptz not null default now(),
  primary key(performer_id,organization_id,location_id,work_date),
  check(end_time>start_time and extract(second from start_time)=0 and extract(second from end_time)=0),
  check(jsonb_typeof(ignored_closures)='object')
);
create table public.provider_day_requests_v192(
  performer_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  work_date date not null,
  payload jsonb,
  result_state text not null check(result_state in ('applied','not_applied')),
  created_at timestamptz not null default now(),
  primary key(performer_id,request_id)
);
alter table public.provider_day_schedule_v192 enable row level security;
alter table public.provider_day_requests_v192 enable row level security;
revoke all on public.provider_day_schedule_v192,public.provider_day_requests_v192 from public,anon,authenticated,service_role;

create function public.minuta_validate_day_scope_v192(p_organization uuid,p_location uuid,p_date date)
returns text language plpgsql security definer set search_path='' as $fn$
declare v_zone text;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication_required'; end if;
  select l.timezone into v_zone from public.locations l
  join public.organizations o on o.id=l.organization_id and o.status='active'
  join public.organization_memberships m on m.organization_id=o.id and m.user_id=auth.uid() and m.active and m.is_bookable and m.role in ('owner','admin','specialist')
  where l.id=p_location and l.organization_id=p_organization and l.active;
  if v_zone is null or p_date is null then raise exception using errcode='42501',message='day_scope_denied'; end if;
  perform pg_catalog.timezone(v_zone,now());
  return v_zone;
end $fn$;

create function public.minuta_day_context_v192(p_organization uuid default null,p_location uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare v_org uuid;v_loc uuid;
begin
  v_org:=coalesce(p_organization,nullif(current_setting('minuta.day_organization',true),'')::uuid,nullif(current_setting('minuta.booking_organization',true),'')::uuid);
  v_loc:=coalesce(p_location,nullif(current_setting('minuta.day_location',true),'')::uuid,nullif(current_setting('minuta.booking_location',true),'')::uuid);
  return jsonb_build_object('organization',v_org,'location',v_loc);
exception when invalid_text_representation then return '{}'::jsonb;
end $fn$;

create function public.minuta_virtual_day_v192(p_performer uuid,p_date date,p_organization uuid,p_location uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare v jsonb;
begin
  if auth.uid() is distinct from p_performer or current_setting('minuta.day_public',true)='on' then return null; end if;
  v:=nullif(current_setting('minuta.day_exception',true),'')::jsonb;
  if v->>'performer'=p_performer::text and v->>'organization'=p_organization::text and v->>'location'=p_location::text and v->>'date'=p_date::text then return v; end if;
  return null;
exception when invalid_text_representation then return null;
end $fn$;

create function public.minuta_effective_day_schedule_v192(p_performer uuid,p_date date,p_organization uuid default null,p_location uuid default null)
returns setof public.provider_schedule language plpgsql stable security definer set search_path='' as $fn$
declare s public.provider_schedule%rowtype;d public.provider_day_schedule_v192%rowtype;c jsonb;v jsonb;v_org uuid;v_loc uuid;
begin
  c:=public.minuta_day_context_v192(p_organization,p_location);v_org:=(c->>'organization')::uuid;v_loc:=(c->>'location')::uuid;
  select * into s from public.provider_schedule where performer_id=p_performer and weekday=extract(isodow from p_date)::smallint;
  if not found then s.performer_id:=p_performer;s.weekday:=extract(isodow from p_date)::smallint;s.enabled:=false;s.start_time:='10:00';s.end_time:='18:00';s.slot_interval_minutes:=15;end if;
  v:=public.minuta_virtual_day_v192(p_performer,p_date,v_org,v_loc);
  if v is not null then
    s.enabled:=true;s.start_time:=(v->>'start')::time;s.end_time:=(v->>'end')::time;s.break_start:=null;s.break_end:=null;
  else
    select * into d from public.provider_day_schedule_v192 where performer_id=p_performer and organization_id=v_org and location_id=v_loc and work_date=p_date;
    if found then
      if (auth.uid() is distinct from p_performer or current_setting('minuta.day_public',true)='on') and not d.online_enabled then return;end if;
      s.enabled:=true;s.start_time:=d.start_time;s.end_time:=d.end_time;
    end if;
  end if;
  if s.enabled then return next s;end if;
end $fn$;

create function public.minuta_effective_days_off_v192(p_performer uuid,p_date date,p_organization uuid default null,p_location uuid default null)
returns setof public.provider_days_off language plpgsql stable security definer set search_path='' as $fn$
declare c jsonb;d public.provider_day_schedule_v192%rowtype;v_org uuid;v_loc uuid;
begin
  c:=public.minuta_day_context_v192(p_organization,p_location);v_org:=(c->>'organization')::uuid;v_loc:=(c->>'location')::uuid;
  if public.minuta_virtual_day_v192(p_performer,p_date,v_org,v_loc) is not null then return;end if;
  select * into d from public.provider_day_schedule_v192 where performer_id=p_performer and organization_id=v_org and location_id=v_loc and work_date=p_date;
  return query select o.* from public.provider_days_off o where o.performer_id=p_performer and o.off_date=p_date
    and (d.performer_id is null or d.ignored_closures->>o.id::text is distinct from md5(jsonb_build_array(o.all_day,o.start_time,o.end_time)::text));
end $fn$;

create function public.minuta_day_revision_v192(p_organization uuid,p_location uuid,p_date date)
returns text language sql stable security definer set search_path='' as $fn$
  select md5(jsonb_build_object('week',(select to_jsonb(s) from public.provider_schedule s where s.performer_id=auth.uid() and s.weekday=extract(isodow from p_date)::smallint),
    'date',(select to_jsonb(d) from public.provider_day_schedule_v192 d where d.performer_id=auth.uid() and d.organization_id=p_organization and d.location_id=p_location and d.work_date=p_date),
    'closures',(select jsonb_agg(jsonb_build_array(o.id,o.all_day,o.start_time,o.end_time) order by o.id) from public.provider_days_off o where o.performer_id=auth.uid() and o.off_date=p_date))::text);
$fn$;

create function public.get_minuta_provider_day_v192(p_organization uuid,p_location uuid,p_date date)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare s public.provider_schedule%rowtype;d public.provider_day_schedule_v192%rowtype;v_zone text;v_online boolean;
begin
  v_zone:=public.minuta_validate_day_scope_v192(p_organization,p_location,p_date);
  select * into s from public.provider_schedule where performer_id=auth.uid() and weekday=extract(isodow from p_date)::smallint;
  select * into d from public.provider_day_schedule_v192 where performer_id=auth.uid() and organization_id=p_organization and location_id=p_location and work_date=p_date;
  v_online:=case when d.performer_id is not null then d.online_enabled else coalesce(s.enabled,false) end;
  if exists(select 1 from public.minuta_effective_days_off_v192(auth.uid(),p_date,p_organization,p_location) o where o.all_day) then v_online:=false;end if;
  return jsonb_build_object('date',p_date,'start',left(coalesce(d.start_time,s.start_time,time '10:00')::text,5),
    'end',left(coalesce(d.end_time,s.end_time,time '18:00')::text,5),'onlineEnabled',v_online,'revision',public.minuta_day_revision_v192(p_organization,p_location,p_date),'timeZone',v_zone,
    'hasOverride',d.performer_id is not null,
    'working',coalesce(s.enabled,false) or d.performer_id is not null,
    'slotInterval',coalesce(s.slot_interval_minutes,15),
    'breakStart',left(s.break_start::text,5),'breakEnd',left(s.break_end::text,5),
    'closures',(select coalesce(jsonb_agg(jsonb_build_object('allDay',o.all_day,'start',left(o.start_time::text,5),'end',left(o.end_time::text,5))),'[]'::jsonb)
      from public.minuta_effective_days_off_v192(auth.uid(),p_date,p_organization,p_location) o));
end $fn$;

create function public.save_minuta_provider_day_v192(p_organization uuid,p_location uuid,p_date date,p_request_id uuid,p_start time,p_end time,p_online boolean,p_expected_revision text)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_zone text;v_payload jsonb;v_prior public.provider_day_requests_v192%rowtype;v_closures jsonb;
begin
  v_zone:=public.minuta_validate_day_scope_v192(p_organization,p_location,p_date);
  if p_request_id is null or p_online is null or p_expected_revision is null or p_start is null or p_end is null or p_end<=p_start or extract(second from p_start)<>0 or extract(second from p_end)<>0 then raise exception using errcode='22023',message='invalid_day_hours';end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,192));
  v_payload:=jsonb_build_array(p_start,p_end,p_online,p_expected_revision);
  select * into v_prior from public.provider_day_requests_v192 where performer_id=auth.uid() and request_id=p_request_id;
  if found then
    if v_prior.organization_id<>p_organization or v_prior.location_id<>p_location or v_prior.work_date<>p_date or (v_prior.payload is not null and v_prior.payload<>v_payload) then raise exception using errcode='23505',message='day_request_conflict';end if;
    return jsonb_build_object('date',p_date,'requestId',p_request_id,'confirmed',v_prior.result_state='applied','notApplied',v_prior.result_state='not_applied');
  end if;
  if p_date<timezone(v_zone,now())::date or p_date>timezone(v_zone,now())::date+730 then raise exception using errcode='22023',message='day_date_unavailable';end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_date::text,0));
  if not pg_try_advisory_xact_lock(hashtextextended(p_organization::text,7100)) then raise exception using errcode='40001',message='day_schedule_changed';end if;
  perform 1 from public.provider_schedule where performer_id=auth.uid() and weekday=extract(isodow from p_date)::smallint for share;
  perform 1 from public.provider_days_off where performer_id=auth.uid() and off_date=p_date for share;
  perform 1 from public.provider_day_schedule_v192 where performer_id=auth.uid() and organization_id=p_organization and location_id=p_location and work_date=p_date for update;
  if public.minuta_day_revision_v192(p_organization,p_location,p_date) is distinct from p_expected_revision then raise exception using errcode='40001',message='day_schedule_changed';end if;
  select coalesce(jsonb_object_agg(o.id::text,md5(jsonb_build_array(o.all_day,o.start_time,o.end_time)::text)),'{}'::jsonb) into v_closures from public.provider_days_off o where o.performer_id=auth.uid() and o.off_date=p_date;
  insert into public.provider_day_schedule_v192(performer_id,organization_id,location_id,work_date,start_time,end_time,online_enabled,ignored_closures)
    values(auth.uid(),p_organization,p_location,p_date,p_start,p_end,p_online,v_closures)
    on conflict(performer_id,organization_id,location_id,work_date) do update set start_time=excluded.start_time,end_time=excluded.end_time,online_enabled=excluded.online_enabled,ignored_closures=excluded.ignored_closures,revision=public.provider_day_schedule_v192.revision+1,updated_at=now();
  insert into public.provider_day_requests_v192 values(auth.uid(),p_request_id,p_organization,p_location,p_date,v_payload,'applied',now());
  return jsonb_build_object('confirmed',true,'date',p_date,'requestId',p_request_id);
end $fn$;

create function public.resolve_minuta_provider_day_v192(p_organization uuid,p_location uuid,p_date date,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_prior public.provider_day_requests_v192%rowtype;
begin
  perform public.minuta_validate_day_scope_v192(p_organization,p_location,p_date);
  if p_request_id is null then raise exception using errcode='22023',message='day_request_required';end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,192));
  insert into public.provider_day_requests_v192 values(auth.uid(),p_request_id,p_organization,p_location,p_date,null,'not_applied',now()) on conflict do nothing;
  select * into v_prior from public.provider_day_requests_v192 where performer_id=auth.uid() and request_id=p_request_id;
  if v_prior.organization_id<>p_organization or v_prior.location_id<>p_location or v_prior.work_date<>p_date then raise exception using errcode='23505',message='day_request_conflict';end if;
  return jsonb_build_object('confirmed',v_prior.result_state='applied','notApplied',v_prior.result_state='not_applied','date',p_date,'requestId',p_request_id);
end $fn$;
-- Read-only scoped slots preserve the existing buffered slot contract.
create function public.get_minuta_provider_day_slots_v192(p_organization uuid,p_location uuid,p_service uuid,p_start date,p_end date,p_ignore_booking uuid default null)
returns table(booking_date date,booking_time time without time zone) language plpgsql security definer set search_path='' as $fn$
declare v_org text:=current_setting('minuta.day_organization',true);v_loc text:=current_setting('minuta.day_location',true);v_public text:=current_setting('minuta.day_public',true);
begin
  perform public.minuta_validate_day_scope_v192(p_organization,p_location,p_start);
  if p_end is null or p_end<p_start or p_end-p_start>730 or not exists(select 1 from public.services where id=p_service and performer_id=auth.uid() and active) then raise exception using errcode='42501',message='day_service_denied';end if;
  perform set_config('minuta.day_organization',p_organization::text,true);perform set_config('minuta.day_location',p_location::text,true);perform set_config('minuta.day_public','off',true);
  return query select s.booking_date,s.booking_time from public.get_available_slots_v101(p_service,p_start,p_end,p_ignore_booking) s;
  perform set_config('minuta.day_organization',coalesce(v_org,''),true);perform set_config('minuta.day_location',coalesce(v_loc,''),true);perform set_config('minuta.day_public',coalesce(v_public,''),true);
exception when others then
  perform set_config('minuta.day_organization',coalesce(v_org,''),true);perform set_config('minuta.day_location',coalesce(v_loc,''),true);perform set_config('minuta.day_public',coalesce(v_public,''),true);raise;
end $fn$;

-- One trusted transaction-local exception; no weekly or dated rows are changed.
create function public.minuta_open_day_exception_v192(p_organization uuid,p_location uuid,p_date date,p_start time,p_end time)
returns text language plpgsql security definer set search_path='' as $fn$
declare v_zone text;v_previous text:=current_setting('minuta.day_exception',true);
begin
  v_zone:=public.minuta_validate_day_scope_v192(p_organization,p_location,p_date);
  if p_start is null or p_end is null or p_end<=p_start or extract(second from p_start)<>0 or extract(second from p_end)<>0 or p_date<timezone(v_zone,now())::date or p_date>timezone(v_zone,now())::date+730 then raise exception using errcode='22023',message='day_exception_unavailable';end if;
  perform set_config('minuta.day_exception',jsonb_build_object('performer',auth.uid(),'organization',p_organization,'location',p_location,'date',p_date,'start',p_start,'end',p_end)::text,true);
  return v_previous;
end $fn$;

create function public.get_minuta_day_exception_slots_v192(p_organization uuid,p_location uuid,p_date date,p_service uuid default null,p_duration integer default null)
returns table(booking_date date,booking_time time without time zone) language plpgsql security definer set search_path='' as $fn$
declare v_exception text;v_org text:=current_setting('minuta.day_organization',true);v_loc text:=current_setting('minuta.day_location',true);v_public text:=current_setting('minuta.day_public',true);
begin
  v_exception:=public.minuta_open_day_exception_v192(p_organization,p_location,p_date,time '00:00',time '24:00');
  perform set_config('minuta.day_organization',p_organization::text,true);perform set_config('minuta.day_location',p_location::text,true);perform set_config('minuta.day_public','off',true);
  if p_service is null then
    if p_duration is null or p_duration not between 1 and 480 then raise exception using errcode='22023',message='invalid_block_duration';end if;
    return query select s.booking_date,s.booking_time from public.get_provider_block_slots_v141(p_organization,p_location,p_date,p_duration,null) s;
  else
    if not exists(select 1 from public.services where id=p_service and performer_id=auth.uid() and active) then raise exception using errcode='42501',message='day_service_denied';end if;
    return query select s.booking_date,s.booking_time from public.get_available_slots_v101(p_service,p_date,p_date,null) s where s.booking_date+s.booking_time>timezone(public.minuta_validate_day_scope_v192(p_organization,p_location,p_date),now());
  end if;
  perform set_config('minuta.day_exception',coalesce(v_exception,''),true);perform set_config('minuta.day_organization',coalesce(v_org,''),true);perform set_config('minuta.day_location',coalesce(v_loc,''),true);perform set_config('minuta.day_public',coalesce(v_public,''),true);
exception when others then
  perform set_config('minuta.day_exception',coalesce(v_exception,''),true);perform set_config('minuta.day_organization',coalesce(v_org,''),true);perform set_config('minuta.day_location',coalesce(v_loc,''),true);perform set_config('minuta.day_public',coalesce(v_public,''),true);raise;
end $fn$;

create function public.book_minuta_day_exception_v192(p_organization uuid,p_location uuid,p_request_id uuid,p_service uuid,p_date date,p_time time,p_client_name text,p_client_phone text,p_expected_price_rub integer,p_expected_duration_minutes integer)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_end timestamp;v_zone text;v_exception text;v_result jsonb;v_service public.services%rowtype;v_booking public.bookings%rowtype;
  v_org text:=current_setting('minuta.day_organization',true);v_loc text:=current_setting('minuta.day_location',true);v_public text:=current_setting('minuta.day_public',true);
  v_booking_org text:=current_setting('minuta.booking_organization',true);v_booking_loc text:=current_setting('minuta.booking_location',true);
begin
  v_zone:=public.minuta_validate_day_scope_v192(p_organization,p_location,p_date);
  if p_request_id is null or p_time is null or p_expected_duration_minutes is null or p_expected_duration_minutes not between 1 and 480 or p_expected_price_rub is null then raise exception using errcode='22023',message='invalid_day_booking';end if;
  perform pg_advisory_xact_lock(hashtextextended('booking-request:'||p_request_id::text,0));
  select * into v_booking from public.bookings where request_id=p_request_id;
  if found then
    if v_booking.performer_id is distinct from auth.uid() or v_booking.organization_id is distinct from p_organization or v_booking.location_id is distinct from p_location then raise exception using errcode='23505',message='day_request_conflict';end if;
    return public.provider_book_appointment(p_request_id,p_service,p_date,p_time,p_client_name,p_client_phone);
  end if;
  select * into v_service from public.services where id=p_service and performer_id=auth.uid() and active for share;
  if not found then raise exception using errcode='42501',message='day_service_denied';end if;
  if v_service.price_rub<>p_expected_price_rub or v_service.duration_minutes<>p_expected_duration_minutes then raise exception using errcode='40001',message='day_service_changed';end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_date::text,0));
  if not pg_try_advisory_xact_lock(hashtextextended(p_organization::text,7100)) then raise exception using errcode='40001',message='day_schedule_changed';end if;
  v_end:=p_date+p_time+make_interval(mins=>p_expected_duration_minutes);
  if p_date+p_time<=timezone(v_zone,now()) or v_end>p_date+1 then raise exception using errcode='22023',message='day_exception_unavailable';end if;
  v_exception:=public.minuta_open_day_exception_v192(p_organization,p_location,p_date,p_time,case when v_end=p_date+1 then time '24:00' else v_end::time end);
  perform set_config('minuta.day_organization',p_organization::text,true);perform set_config('minuta.day_location',p_location::text,true);perform set_config('minuta.day_public','off',true);
  perform set_config('minuta.booking_organization',p_organization::text,true);perform set_config('minuta.booking_location',p_location::text,true);
  v_result:=public.provider_book_appointment(p_request_id,p_service,p_date,p_time,p_client_name,p_client_phone);
  perform set_config('minuta.day_exception',coalesce(v_exception,''),true);perform set_config('minuta.day_organization',coalesce(v_org,''),true);perform set_config('minuta.day_location',coalesce(v_loc,''),true);perform set_config('minuta.day_public',coalesce(v_public,''),true);
  perform set_config('minuta.booking_organization',coalesce(v_booking_org,''),true);perform set_config('minuta.booking_location',coalesce(v_booking_loc,''),true);
  return v_result;
exception when others then
  perform set_config('minuta.day_exception',coalesce(v_exception,''),true);perform set_config('minuta.day_organization',coalesce(v_org,''),true);perform set_config('minuta.day_location',coalesce(v_loc,''),true);perform set_config('minuta.day_public',coalesce(v_public,''),true);
  perform set_config('minuta.booking_organization',coalesce(v_booking_org,''),true);perform set_config('minuta.booking_location',coalesce(v_booking_loc,''),true);raise;
end $fn$;

create function public.block_minuta_day_exception_v192(p_organization uuid,p_location uuid,p_request_id uuid,p_date date,p_time time,p_duration integer,p_title text default 'Перерыв',p_note text default '')
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_end timestamp;v_zone text;v_exception text;v_result jsonb;v_org text:=current_setting('minuta.day_organization',true);v_loc text:=current_setting('minuta.day_location',true);v_public text:=current_setting('minuta.day_public',true);
begin
  v_zone:=public.minuta_validate_day_scope_v192(p_organization,p_location,p_date);
  if p_request_id is null or p_time is null or p_duration is null or p_duration not between 1 and 480 then raise exception using errcode='22023',message='invalid_day_block';end if;
  if exists(select 1 from public.bookings where id=p_request_id and performer_id=auth.uid()) then
    return public.create_provider_block_v141(p_organization,p_location,p_date,p_time,p_duration,p_request_id,p_title,p_note);
  end if;
  v_end:=p_date+p_time+make_interval(mins=>p_duration);
  if p_date+p_time<=timezone(v_zone,now()) or v_end>p_date+1 then raise exception using errcode='22023',message='day_exception_unavailable';end if;
  v_exception:=public.minuta_open_day_exception_v192(p_organization,p_location,p_date,p_time,case when v_end=p_date+1 then time '24:00' else v_end::time end);
  perform set_config('minuta.day_organization',p_organization::text,true);perform set_config('minuta.day_location',p_location::text,true);perform set_config('minuta.day_public','off',true);
  v_result:=public.create_provider_block_v141(p_organization,p_location,p_date,p_time,p_duration,p_request_id,p_title,p_note);
  perform set_config('minuta.day_exception',coalesce(v_exception,''),true);perform set_config('minuta.day_organization',coalesce(v_org,''),true);perform set_config('minuta.day_location',coalesce(v_loc,''),true);perform set_config('minuta.day_public',coalesce(v_public,''),true);
  return v_result;
exception when others then
  perform set_config('minuta.day_exception',coalesce(v_exception,''),true);perform set_config('minuta.day_organization',coalesce(v_org,''),true);perform set_config('minuta.day_location',coalesce(v_loc,''),true);perform set_config('minuta.day_public',coalesce(v_public,''),true);raise;
end $fn$;
-- Preserve only the four qualified scheduling definitions for guarded rollback.
create table public.provider_day_sources_v192(identity text primary key,original_definition text not null,original_md5 text not null,installed_md5 text);
alter table public.provider_day_sources_v192 enable row level security;
revoke all on public.provider_day_sources_v192 from public,anon,authenticated,service_role;
insert into public.provider_day_sources_v192(identity,original_definition,original_md5)
select identity,pg_get_functiondef(identity::regprocedure),md5(pg_get_functiondef(identity::regprocedure))
from unnest(array['public.get_available_slots(uuid,date,date,uuid)','public.minuta_block_slot_valid_v141(uuid,uuid,date,time without time zone,integer,uuid)','public.get_provider_block_slots_v141(uuid,uuid,date,integer,uuid)','public.get_public_minuta_available_slots_v101(text,uuid,uuid,date,date)']) identity;

-- Patch only the qualified scheduling reads; all booking/buffer/resource writers remain native.
do $patch$
declare v text;v_old text;v_new text;
begin
  v:=pg_get_functiondef('public.get_available_slots(uuid,date,date,uuid)'::regprocedure);
  if md5(v)<>'a349da1694516d588485cc03e339dbbb' then raise exception 'v192_canonical_source_changed';end if;
  v_old:=E'join public.provider_schedule schedule\n    on schedule.performer_id = service.performer_id\n   and schedule.weekday = extract(isodow from d.booking_date)::smallint\n   and schedule.enabled';
  if strpos(v,v_old)=0 then v_old:=replace(v_old,E'\n',E'\r\n');end if;
  if (length(v)-length(replace(v,v_old,'')))/length(v_old)<>1 then raise exception 'v192_schedule_anchor_changed';end if;
  v:=replace(v,v_old,'cross join lateral public.minuta_effective_day_schedule_v192(service.performer_id,d.booking_date) schedule');
  v_old:='from public.provider_days_off off';
  if (length(v)-length(replace(v,v_old,'')))/length(v_old)<>1 then raise exception 'v192_closure_anchor_changed';end if;
  execute replace(v,v_old,'from public.minuta_effective_days_off_v192(service.performer_id,d.booking_date) off');

  v:=pg_get_functiondef('public.minuta_block_slot_valid_v141(uuid,uuid,date,time without time zone,integer,uuid)'::regprocedure);
  if md5(v)<>'cd3297e95fb577d2f688470b4d821366' then raise exception 'v192_canonical_source_changed';end if;
  v_old:='from public.provider_schedule';if (length(v)-length(replace(v,v_old,'')))/length(v_old)<>1 then raise exception 'v192_block_schedule_anchor_changed';end if;
  v:=replace(v,v_old,'from public.minuta_effective_day_schedule_v192(v_actor,p_date,p_organization,p_location)');
  v_old:='from public.provider_days_off day_off';if (length(v)-length(replace(v,v_old,'')))/length(v_old)<>1 then raise exception 'v192_block_closure_anchor_changed';end if;
  execute replace(v,v_old,'from public.minuta_effective_days_off_v192(v_actor,p_date,p_organization,p_location) day_off');

  v:=pg_get_functiondef('public.get_provider_block_slots_v141(uuid,uuid,date,integer,uuid)'::regprocedure);
  if md5(v)<>'ff7d8e7a8165ff04f83fff5828784807' then raise exception 'v192_canonical_source_changed';end if;
  v_old:='from public.provider_schedule';if (length(v)-length(replace(v,v_old,'')))/length(v_old)<>1 then raise exception 'v192_block_slots_anchor_changed';end if;
  execute replace(v,v_old,'from public.minuta_effective_day_schedule_v192(auth.uid(),p_date,p_organization,p_location)');

  v:=pg_get_functiondef('public.get_public_minuta_available_slots_v101(text,uuid,uuid,date,date)'::regprocedure);
  if md5(v)<>'e4cae3106ef060b7da0d86d895189571' then raise exception 'v192_canonical_source_changed';end if;
  execute replace(v,'FUNCTION public.get_public_minuta_available_slots_v101(','FUNCTION public.minuta_public_day_slots_base_v192(');
end $patch$;

create or replace function public.get_public_minuta_available_slots_v101(p_slug text,p_location uuid,p_service uuid,p_start date,p_end date)
returns table(booking_date date,booking_time time without time zone) language plpgsql stable security definer set search_path='' as $fn$
declare v_org uuid;v_performer uuid;v_internal boolean;
  v_previous_org text:=current_setting('minuta.day_organization',true);v_previous_loc text:=current_setting('minuta.day_location',true);
  v_previous_public text:=current_setting('minuta.day_public',true);v_previous_exception text:=current_setting('minuta.day_exception',true);
begin
  select id into v_org from public.organizations where public_slug=lower(trim(p_slug));
  select performer_id into v_performer from public.services where id=p_service;
  v_internal:=p_start=p_end and public.minuta_virtual_day_v192(v_performer,p_start,v_org,p_location) is not null;
  perform set_config('minuta.day_organization',coalesce(v_org::text,''),true);perform set_config('minuta.day_location',coalesce(p_location::text,''),true);
  perform set_config('minuta.day_public',case when v_internal then 'off' else 'on' end,true);
  if not v_internal then perform set_config('minuta.day_exception','',true);end if;
  return query select s.booking_date,s.booking_time from public.minuta_public_day_slots_base_v192(p_slug,p_location,p_service,p_start,p_end) s;
  perform set_config('minuta.day_organization',coalesce(v_previous_org,''),true);perform set_config('minuta.day_location',coalesce(v_previous_loc,''),true);perform set_config('minuta.day_public',coalesce(v_previous_public,''),true);perform set_config('minuta.day_exception',coalesce(v_previous_exception,''),true);
exception when others then
  perform set_config('minuta.day_organization',coalesce(v_previous_org,''),true);perform set_config('minuta.day_location',coalesce(v_previous_loc,''),true);perform set_config('minuta.day_public',coalesce(v_previous_public,''),true);perform set_config('minuta.day_exception',coalesce(v_previous_exception,''),true);raise;
end $fn$;

update public.provider_day_sources_v192 set installed_md5=md5(pg_get_functiondef(identity::regprocedure));

-- Internal helpers are callable only through the scoped definer entry points.
do $privileges$
declare p regprocedure;
begin
  for p in select f.oid::regprocedure from pg_proc f join pg_namespace n on n.oid=f.pronamespace where n.nspname='public' and f.proname in (
    'minuta_validate_day_scope_v192','minuta_day_context_v192','minuta_virtual_day_v192','minuta_effective_day_schedule_v192','minuta_effective_days_off_v192','minuta_day_revision_v192','minuta_open_day_exception_v192','minuta_public_day_slots_base_v192',
    'get_minuta_provider_day_v192','save_minuta_provider_day_v192','resolve_minuta_provider_day_v192','get_minuta_provider_day_slots_v192','get_minuta_day_exception_slots_v192','book_minuta_day_exception_v192','block_minuta_day_exception_v192')
  loop execute format('revoke all on function %s from public,anon,authenticated,service_role',p);end loop;
end $privileges$;
grant execute on function public.get_minuta_provider_day_v192(uuid,uuid,date) to authenticated;
grant execute on function public.save_minuta_provider_day_v192(uuid,uuid,date,uuid,time,time,boolean,text) to authenticated;
grant execute on function public.resolve_minuta_provider_day_v192(uuid,uuid,date,uuid) to authenticated;
grant execute on function public.get_minuta_provider_day_slots_v192(uuid,uuid,uuid,date,date,uuid) to authenticated;
grant execute on function public.get_minuta_day_exception_slots_v192(uuid,uuid,date,uuid,integer) to authenticated;
grant execute on function public.book_minuta_day_exception_v192(uuid,uuid,uuid,uuid,date,time,text,text,integer,integer) to authenticated;
grant execute on function public.block_minuta_day_exception_v192(uuid,uuid,uuid,date,time,integer,text,text) to authenticated;
comment on function public.get_minuta_provider_day_v192(uuid,uuid,date) is 'primetime_provider_day_v192';
commit;
