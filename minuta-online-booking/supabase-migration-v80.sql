begin;

set local search_path = public, extensions, pg_catalog;

do $$
declare v_missing text[] := array[]::text[];
begin
  if to_regclass('public.organizations') is null then v_missing:=array_append(v_missing,'organizations'); end if;
  if to_regclass('public.locations') is null then v_missing:=array_append(v_missing,'locations'); end if;
  if to_regclass('public.organization_memberships') is null then v_missing:=array_append(v_missing,'organization_memberships'); end if;
  if to_regclass('public.performer_profiles') is null then v_missing:=array_append(v_missing,'performer_profiles'); end if;
  if to_regclass('public.bookings') is null then v_missing:=array_append(v_missing,'bookings'); end if;
  if to_regprocedure('public.has_organization_role(uuid,text[])') is null then v_missing:=array_append(v_missing,'has_organization_role'); end if;
  if to_regprocedure('public.touch_minuta_organization_updated_at()') is null then v_missing:=array_append(v_missing,'touch_minuta_organization_updated_at'); end if;
  if to_regprocedure('public.get_public_minuta_available_slots_v4(text,uuid,uuid,date,date)') is null then v_missing:=array_append(v_missing,'get_public_minuta_available_slots_v4'); end if;
  if to_regprocedure('public.get_reschedule_slots_v5(uuid,date,date)') is null then v_missing:=array_append(v_missing,'get_reschedule_slots_v5'); end if;
  if cardinality(v_missing)>0 then
    raise exception using errcode='P0001',message='v80_missing_prerequisites:'||array_to_string(v_missing,',');
  end if;
end $$;

create table if not exists public.organization_group_booking_settings (
  organization_id uuid primary key references public.organizations(id) on delete restrict,
  enabled boolean not null default false,
  enabled_at timestamptz,
  enabled_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.group_booking_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  location_id uuid not null,
  performer_id uuid not null references public.performer_profiles(id) on delete restrict,
  title text not null check(char_length(trim(title)) between 2 and 120),
  description text not null default '' check(char_length(description)<=1000),
  event_date date not null,
  start_time time without time zone not null,
  duration_minutes integer not null check(duration_minutes between 15 and 1440),
  capacity integer not null check(capacity between 2 and 500),
  status text not null default 'draft' check(status in ('draft','published','closed','cancelled')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,organization_id),
  foreign key(location_id,organization_id) references public.locations(id,organization_id) on delete restrict,
  foreign key(organization_id,performer_id) references public.organization_memberships(organization_id,user_id) on delete restrict
);

create table if not exists public.group_booking_participants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  event_id uuid not null,
  request_id uuid not null unique,
  booking_code text not null unique check(booking_code~'^GRP-[A-Z0-9]{10}$'),
  client_name text not null check(char_length(trim(client_name)) between 2 and 80),
  client_phone text not null check(char_length(client_phone) between 10 and 30),
  phone_digits text not null check(phone_digits~'^[0-9]{10,15}$'),
  client_comment text not null default '' check(char_length(client_comment)<=700),
  status text not null default 'confirmed' check(status in ('confirmed','cancelled','attended','no_show')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,organization_id),
  foreign key(event_id,organization_id) references public.group_booking_events(id,organization_id) on delete cascade
);

create table if not exists public.group_booking_audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check(char_length(action) between 2 and 80),
  event_id uuid,
  participant_id uuid,
  details jsonb not null default '{}'::jsonb check(jsonb_typeof(details)='object'),
  created_at timestamptz not null default now()
);

create index if not exists group_booking_events_schedule_idx on public.group_booking_events(organization_id,event_date,start_time) where status in ('published','closed');
create index if not exists group_booking_events_performer_idx on public.group_booking_events(performer_id,event_date,start_time);
create index if not exists group_booking_participants_event_idx on public.group_booking_participants(event_id,status,created_at);
create unique index if not exists group_booking_participants_active_phone_idx on public.group_booking_participants(event_id,phone_digits) where status<>'cancelled';
create index if not exists group_booking_audit_scope_idx on public.group_booking_audit_log(organization_id,created_at desc,id desc);

insert into public.organization_group_booking_settings(organization_id)
select id from public.organizations on conflict(organization_id) do nothing;

create or replace function public.ensure_minuta_group_booking_settings()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  insert into public.organization_group_booking_settings(organization_id) values(new.id)
  on conflict(organization_id) do nothing;
  return new;
end $$;
revoke all on function public.ensure_minuta_group_booking_settings() from public,anon,authenticated,service_role;
drop trigger if exists organizations_group_booking_settings on public.organizations;
create trigger organizations_group_booking_settings after insert on public.organizations
for each row execute function public.ensure_minuta_group_booking_settings();

drop trigger if exists organization_group_booking_settings_touch on public.organization_group_booking_settings;
create trigger organization_group_booking_settings_touch before update on public.organization_group_booking_settings
for each row execute function public.touch_minuta_organization_updated_at();
drop trigger if exists group_booking_events_touch on public.group_booking_events;
create trigger group_booking_events_touch before update on public.group_booking_events
for each row execute function public.touch_minuta_organization_updated_at();
drop trigger if exists group_booking_participants_touch on public.group_booking_participants;
create trigger group_booking_participants_touch before update on public.group_booking_participants
for each row execute function public.touch_minuta_organization_updated_at();

create or replace function public.enforce_minuta_group_event_scope()
returns trigger language plpgsql security definer set search_path to '' as $$
declare v_timezone text;v_taken integer;
begin
  select location.timezone into v_timezone from public.locations location
  where location.id=new.location_id and location.organization_id=new.organization_id and location.active;
  if v_timezone is null then raise exception using errcode='23514',message='group_event_location_unavailable'; end if;
  if not exists(select 1 from public.organization_memberships membership where membership.organization_id=new.organization_id
    and membership.user_id=new.performer_id and membership.active and membership.is_bookable) then
    raise exception using errcode='23514',message='group_event_performer_unavailable';
  end if;
  if new.status in ('published','closed') then
    perform pg_advisory_xact_lock(hashtextextended(new.performer_id::text||':'||new.event_date::text,8001));
    if exists(select 1 from public.bookings booking where booking.organization_id=new.organization_id
      and booking.location_id=new.location_id and booking.performer_id=new.performer_id and booking.status<>'cancelled'
      and booking.booking_date=new.event_date
      and tsrange(booking.booking_date+booking.booking_time,booking.booking_date+booking.booking_time+make_interval(mins=>booking.duration_minutes),'[)')
        && tsrange(new.event_date+new.start_time,new.event_date+new.start_time+make_interval(mins=>new.duration_minutes),'[)')) then
      raise exception using errcode='P0001',message='group_event_conflicts_with_booking';
    end if;
    if exists(select 1 from public.group_booking_events other where other.organization_id=new.organization_id
      and other.location_id=new.location_id and other.performer_id=new.performer_id and other.event_date=new.event_date
      and other.status in ('published','closed') and other.id<>new.id
      and tsrange(other.event_date+other.start_time,other.event_date+other.start_time+make_interval(mins=>other.duration_minutes),'[)')
        && tsrange(new.event_date+new.start_time,new.event_date+new.start_time+make_interval(mins=>new.duration_minutes),'[)')) then
      raise exception using errcode='P0001',message='group_event_time_conflict';
    end if;
  end if;
  select count(*) into v_taken from public.group_booking_participants participant
  where participant.event_id=new.id and participant.status<>'cancelled';
  if new.capacity<v_taken then raise exception using errcode='23514',message='group_event_capacity_below_participants'; end if;
  return new;
end $$;
revoke all on function public.enforce_minuta_group_event_scope() from public,anon,authenticated,service_role;
drop trigger if exists group_booking_events_scope on public.group_booking_events;
create trigger group_booking_events_scope before insert or update of organization_id,location_id,performer_id,event_date,start_time,duration_minutes,capacity,status
on public.group_booking_events for each row execute function public.enforce_minuta_group_event_scope();

create or replace function public.prevent_minuta_group_event_booking_overlap()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if new.status<>'cancelled' and new.organization_id is not null and new.location_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(new.performer_id::text||':'||new.booking_date::text,8001));
    if exists(select 1 from public.group_booking_events event where event.organization_id=new.organization_id
      and event.location_id=new.location_id and event.performer_id=new.performer_id and event.event_date=new.booking_date
      and event.status in ('published','closed')
      and tsrange(event.event_date+event.start_time,event.event_date+event.start_time+make_interval(mins=>event.duration_minutes),'[)')
        && tsrange(new.booking_date+new.booking_time,new.booking_date+new.booking_time+make_interval(mins=>new.duration_minutes),'[)')) then
      raise exception using errcode='P0001',message='slot_reserved_for_group_event';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.prevent_minuta_group_event_booking_overlap() from public,anon,authenticated,service_role;
drop trigger if exists bookings_group_event_overlap on public.bookings;
-- v86 deliberately renamed this trigger so PostgreSQL runs tenant scoping first.
-- A repeated v80 must never recreate the old name beside the v86 trigger.
do $$
declare v86_trigger oid;
begin
  select trigger_row.oid into v86_trigger
  from pg_trigger trigger_row
  where trigger_row.tgrelid='public.bookings'::regclass
    and trigger_row.tgname='zz_bookings_group_event_overlap_v86'
    and not trigger_row.tgisinternal;
  if v86_trigger is null then
    create trigger bookings_group_event_overlap before insert or update of organization_id,location_id,performer_id,booking_date,booking_time,duration_minutes,status
    on public.bookings for each row execute function public.prevent_minuta_group_event_booking_overlap();
  elsif not exists (
    select 1 from pg_trigger trigger_row
    where trigger_row.oid=v86_trigger
      and trigger_row.tgfoid=to_regprocedure('public.prevent_minuta_group_event_booking_overlap()')
      and trigger_row.tgenabled<>'D'
  ) then
    raise exception using errcode='P0001',message='v80_detected_invalid_v86_trigger';
  end if;
end $$;

alter table public.organization_group_booking_settings enable row level security;
alter table public.group_booking_events enable row level security;
alter table public.group_booking_participants enable row level security;
alter table public.group_booking_audit_log enable row level security;

drop policy if exists group_booking_settings_member_read on public.organization_group_booking_settings;
create policy group_booking_settings_member_read on public.organization_group_booking_settings for select to authenticated
using(public.is_organization_member(organization_id));
drop policy if exists group_booking_events_member_read on public.group_booking_events;
create policy group_booking_events_member_read on public.group_booking_events for select to authenticated
using(public.is_organization_member(organization_id));
drop policy if exists group_booking_participants_staff_read on public.group_booking_participants;
create policy group_booking_participants_staff_read on public.group_booking_participants for select to authenticated
using(public.has_organization_role(organization_id,array['owner','admin']::text[])
  or exists(select 1 from public.group_booking_events event where event.id=public.group_booking_participants.event_id and event.performer_id=auth.uid()));
drop policy if exists group_booking_audit_manager_read on public.group_booking_audit_log;
create policy group_booking_audit_manager_read on public.group_booking_audit_log for select to authenticated
using(public.has_organization_role(organization_id,array['owner','admin']::text[]));

revoke all on public.organization_group_booking_settings,public.group_booking_events,public.group_booking_participants,public.group_booking_audit_log from public,anon,authenticated;
grant select on public.organization_group_booking_settings,public.group_booking_events,public.group_booking_participants,public.group_booking_audit_log to authenticated;
grant all on public.organization_group_booking_settings,public.group_booking_events,public.group_booking_participants,public.group_booking_audit_log to service_role;

create or replace function public.get_minuta_group_booking_role(p_organization uuid)
returns text language plpgsql stable security definer set search_path to '' as $$
declare v_role text;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication_required'; end if;
  select membership.role into v_role from public.organization_memberships membership
  join public.organizations organization on organization.id=membership.organization_id and organization.status='active'
  where membership.organization_id=p_organization and membership.user_id=auth.uid() and membership.active;
  if v_role not in ('owner','admin','specialist') then raise exception using errcode='42501',message='group_booking_management_denied'; end if;
  return v_role;
end $$;
revoke all on function public.get_minuta_group_booking_role(uuid) from public,anon,authenticated,service_role;

create or replace function public.write_minuta_group_booking_audit(p_organization uuid,p_action text,p_event uuid,p_participant uuid,p_details jsonb default '{}'::jsonb)
returns void language sql security definer set search_path to '' as $$
  insert into public.group_booking_audit_log(organization_id,actor_id,action,event_id,participant_id,details)
  values(p_organization,auth.uid(),p_action,p_event,p_participant,coalesce(p_details,'{}'::jsonb));
$$;
revoke all on function public.write_minuta_group_booking_audit(uuid,text,uuid,uuid,jsonb) from public,anon,authenticated,service_role;

create or replace function public.set_minuta_group_bookings_enabled(p_organization uuid,p_enabled boolean)
returns boolean language plpgsql security definer set search_path to '' as $$
declare v_role text;
begin
  v_role:=public.get_minuta_group_booking_role(p_organization);
  if v_role<>'owner' then raise exception using errcode='42501',message='owner_required'; end if;
  if p_enabled is null then raise exception using errcode='22023',message='invalid_group_booking_enabled'; end if;
  insert into public.organization_group_booking_settings(organization_id,enabled,enabled_at,enabled_by)
  values(p_organization,p_enabled,case when p_enabled then now() end,case when p_enabled then auth.uid() end)
  on conflict(organization_id) do update set enabled=excluded.enabled,
    enabled_at=case when excluded.enabled then coalesce(public.organization_group_booking_settings.enabled_at,now()) end,
    enabled_by=case when excluded.enabled then coalesce(public.organization_group_booking_settings.enabled_by,auth.uid()) end;
  perform public.write_minuta_group_booking_audit(p_organization,'group_bookings_enabled_changed',null,null,jsonb_build_object('enabled',p_enabled));
  return p_enabled;
end $$;
revoke all on function public.set_minuta_group_bookings_enabled(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.set_minuta_group_bookings_enabled(uuid,boolean) to authenticated;

create or replace function public.upsert_minuta_group_event(
  p_organization uuid,p_event uuid,p_location uuid,p_performer uuid,p_title text,p_description text,
  p_date date,p_time time without time zone,p_duration integer,p_capacity integer,p_status text
) returns uuid language plpgsql security definer set search_path to '' as $$
declare v_role text;v_id uuid;v_existing public.group_booking_events%rowtype;v_timezone text;v_taken integer;
begin
  v_role:=public.get_minuta_group_booking_role(p_organization);
  if p_title is null or char_length(trim(p_title)) not between 2 and 120 or char_length(coalesce(p_description,''))>1000
    or p_date is null or p_time is null or p_duration not between 15 and 1440 or p_capacity not between 2 and 500
    or p_status not in ('draft','published','closed','cancelled') then
    raise exception using errcode='22023',message='invalid_group_event';
  end if;
  select location.timezone into v_timezone from public.locations location
  where location.id=p_location and location.organization_id=p_organization and location.active;
  if v_timezone is null then raise exception using errcode='23514',message='group_event_location_unavailable'; end if;
  if not exists(select 1 from public.organization_memberships membership where membership.organization_id=p_organization
    and membership.user_id=p_performer and membership.active and membership.is_bookable) then
    raise exception using errcode='23514',message='group_event_performer_unavailable';
  end if;
  if v_role='specialist' and p_performer<>auth.uid() then raise exception using errcode='42501',message='foreign_group_event_denied'; end if;
  if p_date+p_time<=timezone(v_timezone,now()) and p_status in ('draft','published') then
    raise exception using errcode='22023',message='group_event_must_be_future';
  end if;
  if p_event is not null then
    select * into v_existing from public.group_booking_events where id=p_event and organization_id=p_organization for update;
    if v_existing.id is null then raise exception using errcode='P0001',message='group_event_not_found'; end if;
    if v_role='specialist' and v_existing.performer_id<>auth.uid() then raise exception using errcode='42501',message='foreign_group_event_denied'; end if;
    select count(*) into v_taken from public.group_booking_participants where event_id=p_event and status<>'cancelled';
    if p_capacity<v_taken then raise exception using errcode='23514',message='group_event_capacity_below_participants'; end if;
    update public.group_booking_events set location_id=p_location,performer_id=p_performer,title=trim(p_title),
      description=trim(coalesce(p_description,'')),event_date=p_date,start_time=p_time,duration_minutes=p_duration,
      capacity=p_capacity,status=p_status where id=p_event returning id into v_id;
  else
    insert into public.group_booking_events(organization_id,location_id,performer_id,title,description,event_date,start_time,duration_minutes,capacity,status,created_by)
    values(p_organization,p_location,p_performer,trim(p_title),trim(coalesce(p_description,'')),p_date,p_time,p_duration,p_capacity,p_status,auth.uid()) returning id into v_id;
  end if;
  perform public.write_minuta_group_booking_audit(p_organization,case when p_event is null then 'group_event_created' else 'group_event_updated' end,v_id,null,
    jsonb_build_object('location_id',p_location,'performer_id',p_performer,'date',p_date,'time',p_time,'capacity',p_capacity,'status',p_status));
  return v_id;
end $$;
revoke all on function public.upsert_minuta_group_event(uuid,uuid,uuid,uuid,text,text,date,time without time zone,integer,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.upsert_minuta_group_event(uuid,uuid,uuid,uuid,text,text,date,time without time zone,integer,integer,text) to authenticated;

create or replace function public.set_minuta_group_event_status(p_organization uuid,p_event uuid,p_status text)
returns text language plpgsql security definer set search_path to '' as $$
declare v_role text;v_event public.group_booking_events%rowtype;
begin
  v_role:=public.get_minuta_group_booking_role(p_organization);
  if p_status not in ('draft','published','closed','cancelled') then raise exception using errcode='22023',message='invalid_group_event_status'; end if;
  select * into v_event from public.group_booking_events where id=p_event and organization_id=p_organization for update;
  if v_event.id is null then raise exception using errcode='P0001',message='group_event_not_found'; end if;
  if v_role='specialist' and v_event.performer_id<>auth.uid() then raise exception using errcode='42501',message='foreign_group_event_denied'; end if;
  if p_status='published' and v_event.event_date+v_event.start_time<=timezone((select timezone from public.locations where id=v_event.location_id),now()) then
    raise exception using errcode='22023',message='group_event_must_be_future';
  end if;
  update public.group_booking_events set status=p_status where id=p_event;
  perform public.write_minuta_group_booking_audit(p_organization,'group_event_status_changed',p_event,null,jsonb_build_object('status',p_status));
  return p_status;
end $$;
revoke all on function public.set_minuta_group_event_status(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.set_minuta_group_event_status(uuid,uuid,text) to authenticated;

create or replace function public.set_minuta_group_participant_status(p_organization uuid,p_participant uuid,p_status text)
returns text language plpgsql security definer set search_path to '' as $$
declare v_role text;v_participant public.group_booking_participants%rowtype;v_performer uuid;
begin
  v_role:=public.get_minuta_group_booking_role(p_organization);
  if p_status not in ('confirmed','cancelled','attended','no_show') then raise exception using errcode='22023',message='invalid_group_participant_status'; end if;
  select participant.* into v_participant from public.group_booking_participants participant
  where participant.id=p_participant and participant.organization_id=p_organization for update;
  if v_participant.id is null then raise exception using errcode='P0001',message='group_participant_not_found'; end if;
  select performer_id into v_performer from public.group_booking_events where id=v_participant.event_id;
  if v_role='specialist' and v_performer<>auth.uid() then raise exception using errcode='42501',message='foreign_group_participant_denied'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_participant.event_id::text,8002));
  if v_participant.status='cancelled' and p_status<>'cancelled' and
    (select count(*) from public.group_booking_participants where event_id=v_participant.event_id and status<>'cancelled') >=
    (select capacity from public.group_booking_events where id=v_participant.event_id) then
    raise exception using errcode='P0001',message='group_event_full';
  end if;
  update public.group_booking_participants set status=p_status where id=p_participant;
  perform public.write_minuta_group_booking_audit(p_organization,'group_participant_status_changed',v_participant.event_id,p_participant,jsonb_build_object('status',p_status));
  return p_status;
end $$;
revoke all on function public.set_minuta_group_participant_status(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.set_minuta_group_participant_status(uuid,uuid,text) to authenticated;

create or replace function public.get_minuta_group_booking_admin(p_organization uuid,p_start date default current_date-30,p_end date default current_date+365)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_role text;v_result jsonb;
begin
  v_role:=public.get_minuta_group_booking_role(p_organization);
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>730 then raise exception using errcode='22023',message='invalid_group_event_range'; end if;
  select jsonb_build_object(
    'available',true,'role',v_role,
    'enabled',coalesce((select enabled from public.organization_group_booking_settings where organization_id=p_organization),false),
    'locations',coalesce((select jsonb_agg(jsonb_build_object('id',location.id,'name',location.name,'address',location.address) order by location.is_primary desc,location.name)
      from public.locations location where location.organization_id=p_organization and location.active),'[]'::jsonb),
    'performers',coalesce((select jsonb_agg(jsonb_build_object('id',membership.user_id,'name',coalesce(profile.display_name,'Специалист')) order by profile.display_name,membership.user_id)
      from public.organization_memberships membership left join public.performer_profiles profile on profile.id=membership.user_id
      where membership.organization_id=p_organization and membership.active and membership.is_bookable
        and (v_role<>'specialist' or membership.user_id=auth.uid())),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(jsonb_build_object(
      'id',event.id,'location_id',event.location_id,'location_name',location.name,'performer_id',event.performer_id,
      'performer_name',coalesce(profile.display_name,'Специалист'),'title',event.title,'description',event.description,
      'event_date',event.event_date,'start_time',event.start_time,'duration_minutes',event.duration_minutes,
      'capacity',event.capacity,'status',event.status,
      'participants',coalesce((select jsonb_agg(jsonb_build_object('id',participant.id,'name',participant.client_name,
        'phone',participant.client_phone,'comment',participant.client_comment,'status',participant.status,'created_at',participant.created_at)
        order by participant.created_at,participant.id) from public.group_booking_participants participant where participant.event_id=event.id),'[]'::jsonb)
    ) order by event.event_date,event.start_time,event.id)
      from public.group_booking_events event join public.locations location on location.id=event.location_id
      left join public.performer_profiles profile on profile.id=event.performer_id
      where event.organization_id=p_organization and event.event_date between p_start and p_end
        and (v_role<>'specialist' or event.performer_id=auth.uid())),'[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;
revoke all on function public.get_minuta_group_booking_admin(uuid,date,date) from public,anon,authenticated,service_role;
grant execute on function public.get_minuta_group_booking_admin(uuid,date,date) to authenticated;

create or replace function public.get_public_minuta_group_events(p_slug text,p_start date default current_date,p_end date default current_date+180)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_organization uuid;v_enabled boolean;v_result jsonb;
begin
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>366 then raise exception using errcode='22023',message='invalid_group_event_range'; end if;
  select organization.id,setting.enabled into v_organization,v_enabled
  from public.organizations organization join public.organization_group_booking_settings setting on setting.organization_id=organization.id
  where organization.public_slug=lower(trim(coalesce(p_slug,''))) and organization.status='active' and organization.public_booking_enabled;
  if v_organization is null or not coalesce(v_enabled,false) then return jsonb_build_object('enabled',false,'events','[]'::jsonb); end if;
  select jsonb_build_object('enabled',true,'events',coalesce(jsonb_agg(jsonb_build_object(
    'id',event.id,'title',event.title,'description',event.description,'event_date',event.event_date,
    'start_time',event.start_time,'duration_minutes',event.duration_minutes,'capacity',event.capacity,
    'seats_taken',event.seats_taken,'seats_left',greatest(0,event.capacity-event.seats_taken),
    'location_name',event.location_name,'location_address',event.location_address,'performer_name',event.performer_name
  ) order by event.event_date,event.start_time,event.id),'[]'::jsonb)) into v_result
  from (select source.*,count(participant.id) filter(where participant.status<>'cancelled')::integer seats_taken
    from (select event.*,location.name location_name,location.address location_address,coalesce(profile.display_name,'Специалист') performer_name
      from public.group_booking_events event join public.locations location on location.id=event.location_id and location.active
      left join public.performer_profiles profile on profile.id=event.performer_id
      where event.organization_id=v_organization and event.status='published' and event.event_date between p_start and p_end
        and event.event_date+event.start_time>timezone(location.timezone,now())) source
    left join public.group_booking_participants participant on participant.event_id=source.id
    group by source.id,source.organization_id,source.location_id,source.performer_id,source.title,source.description,
      source.event_date,source.start_time,source.duration_minutes,source.capacity,source.status,source.created_by,source.created_at,
      source.updated_at,source.location_name,source.location_address,source.performer_name) event;
  return coalesce(v_result,jsonb_build_object('enabled',true,'events','[]'::jsonb));
end $$;
revoke all on function public.get_public_minuta_group_events(text,date,date) from public,anon,authenticated,service_role;
grant execute on function public.get_public_minuta_group_events(text,date,date) to anon,authenticated;

create or replace function public.book_minuta_group_event(p_request_id uuid,p_event uuid,p_client_name text,p_client_phone text,p_comment text default '')
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_event public.group_booking_events%rowtype;v_existing public.group_booking_participants%rowtype;v_id uuid;
  v_digits text:=regexp_replace(coalesce(p_client_phone,''),'[^0-9]','','g');v_code text;v_taken integer;v_timezone text;
begin
  if p_request_id is null or p_event is null or char_length(trim(coalesce(p_client_name,''))) not between 2 and 80
    or v_digits!~'^[0-9]{10,15}$' or char_length(coalesce(p_client_phone,''))>30 or char_length(coalesce(p_comment,''))>700 then
    raise exception using errcode='22023',message='invalid_group_participant';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,8003));
  select * into v_existing from public.group_booking_participants where request_id=p_request_id;
  if v_existing.id is not null then
    if v_existing.event_id<>p_event or v_existing.phone_digits<>v_digits then raise exception using errcode='22023',message='group_booking_idempotency_mismatch'; end if;
    return jsonb_build_object('participant_id',v_existing.id,'booking_code',v_existing.booking_code,'status',v_existing.status,'idempotent',true);
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_event::text,8002));
  select event.* into v_event from public.group_booking_events event join public.organizations organization
    on organization.id=event.organization_id and organization.status='active' and organization.public_booking_enabled
    join public.organization_group_booking_settings setting on setting.organization_id=event.organization_id and setting.enabled
    join public.locations location on location.id=event.location_id and location.active
    where event.id=p_event and event.status='published' for update of event;
  if v_event.id is null then raise exception using errcode='P0001',message='group_event_unavailable'; end if;
  select timezone into v_timezone from public.locations where id=v_event.location_id;
  if v_event.event_date+v_event.start_time<=timezone(v_timezone,now()) then raise exception using errcode='P0001',message='group_event_started'; end if;
  if exists(select 1 from public.group_booking_participants where event_id=p_event and phone_digits=v_digits and status<>'cancelled') then
    raise exception using errcode='23505',message='group_event_duplicate_participant';
  end if;
  select count(*) into v_taken from public.group_booking_participants where event_id=p_event and status<>'cancelled';
  if v_taken>=v_event.capacity then raise exception using errcode='P0001',message='group_event_full'; end if;
  loop
    v_code:='GRP-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
    exit when not exists(select 1 from public.group_booking_participants where booking_code=v_code);
  end loop;
  insert into public.group_booking_participants(organization_id,event_id,request_id,booking_code,client_name,client_phone,phone_digits,client_comment)
  values(v_event.organization_id,p_event,p_request_id,v_code,trim(p_client_name),trim(p_client_phone),v_digits,trim(coalesce(p_comment,''))) returning id into v_id;
  insert into public.group_booking_audit_log(organization_id,actor_id,action,event_id,participant_id,details)
  values(v_event.organization_id,null,'group_participant_public_booked',p_event,v_id,jsonb_build_object('seats_after',v_taken+1));
  return jsonb_build_object('participant_id',v_id,'booking_code',v_code,'status','confirmed','idempotent',false);
end $$;
revoke all on function public.book_minuta_group_event(uuid,uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.book_minuta_group_event(uuid,uuid,text,text,text) to anon,authenticated;

create or replace function public.get_public_minuta_available_slots_group_safe(p_slug text,p_location uuid,p_service uuid,p_start date,p_end date)
returns table(booking_date date,booking_time time without time zone)
language sql stable security definer set search_path to '' as $$
  select slot.booking_date,slot.booking_time from public.get_public_minuta_available_slots_v4(p_slug,p_location,p_service,p_start,p_end) slot
  join public.organizations organization on organization.public_slug=lower(trim(coalesce(p_slug,'')))
  join public.services service on service.id=p_service
  where not exists(select 1 from public.group_booking_events event where event.organization_id=organization.id
    and event.location_id=p_location and event.performer_id=service.performer_id and event.event_date=slot.booking_date
    and event.status in ('published','closed')
    and tsrange(event.event_date+event.start_time,event.event_date+event.start_time+make_interval(mins=>event.duration_minutes),'[)')
      && tsrange(slot.booking_date+slot.booking_time,slot.booking_date+slot.booking_time+make_interval(mins=>service.duration_minutes),'[)'))
  order by slot.booking_date,slot.booking_time;
$$;
revoke all on function public.get_public_minuta_available_slots_group_safe(text,uuid,uuid,date,date) from public,anon,authenticated,service_role;
grant execute on function public.get_public_minuta_available_slots_group_safe(text,uuid,uuid,date,date) to anon,authenticated;

create or replace function public.get_minuta_group_safe_reschedule_slots(p_token uuid,p_start date,p_end date)
returns table(booking_date date,booking_time time without time zone)
language sql stable security definer set search_path to '' as $$
  select slot.booking_date,slot.booking_time from public.bookings booking
  join public.services service on service.id=booking.service_id
  cross join lateral public.get_reschedule_slots_v5(p_token,p_start,p_end) slot
  where booking.manage_token=p_token and booking.status<>'cancelled'
    and not exists(select 1 from public.group_booking_events event where event.organization_id=booking.organization_id
      and event.location_id=booking.location_id and event.performer_id=booking.performer_id and event.event_date=slot.booking_date
      and event.status in ('published','closed')
      and tsrange(event.event_date+event.start_time,event.event_date+event.start_time+make_interval(mins=>event.duration_minutes),'[)')
        && tsrange(slot.booking_date+slot.booking_time,slot.booking_date+slot.booking_time+make_interval(mins=>booking.duration_minutes),'[)'))
  order by slot.booking_date,slot.booking_time;
$$;
revoke all on function public.get_minuta_group_safe_reschedule_slots(uuid,date,date) from public,anon,authenticated,service_role;
grant execute on function public.get_minuta_group_safe_reschedule_slots(uuid,date,date) to anon,authenticated;

commit;
