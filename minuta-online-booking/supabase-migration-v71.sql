begin;

set local search_path = public, extensions, pg_catalog;

-- v71 is additive and is disabled for every organization by default. Until an
-- owner explicitly activates branch shifts, the protected v61/v64 booking
-- path and the v68/v69 availability rules keep working without changes.
do $$
begin
  if to_regclass('public.client_avatars') is null
     or to_regprocedure('public.get_public_minuta_available_slots_v3(text,uuid,uuid,date,date)') is null
     or to_regprocedure('public.get_minuta_resource_workspace(uuid)') is null
     or to_regprocedure('public.get_minuta_team_calendar_v2(uuid,date,date,uuid,uuid,uuid)') is null then
    raise exception using errcode = 'P0001', message = 'v71_requires_v70';
  end if;
end;
$$;

create table if not exists public.organization_shift_settings (
  organization_id uuid primary key references public.organizations(id) on delete restrict,
  enabled boolean not null default false,
  enabled_at timestamptz,
  enabled_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.staff_location_shifts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  location_id uuid not null,
  performer_id uuid not null references public.performer_profiles(id) on delete restrict,
  shift_date date not null,
  start_time time without time zone not null,
  end_time time without time zone not null,
  break_start time without time zone,
  break_end time without time zone,
  note text not null default '' check (char_length(note) <= 500),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (location_id, organization_id)
    references public.locations(id, organization_id) on delete restrict,
  check (end_time > start_time),
  check ((break_start is null and break_end is null) or
         (break_start is not null and break_end is not null and
          break_start >= start_time and break_end <= end_time and break_end > break_start))
);

create index if not exists staff_location_shifts_scope_idx
  on public.staff_location_shifts (organization_id, shift_date, location_id, performer_id)
  where active;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.staff_location_shifts'::regclass
      and conname = 'staff_location_shifts_no_performer_overlap'
  ) then
    alter table public.staff_location_shifts add constraint staff_location_shifts_no_performer_overlap
      exclude using gist (
        performer_id with =,
        tsrange(shift_date + start_time, shift_date + end_time, '[)') with &&
      ) where (active);
  end if;
end;
$$;

create table if not exists public.staff_absences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  performer_id uuid not null references public.performer_profiles(id) on delete restrict,
  starts_on date not null,
  ends_on date not null,
  kind text not null check (kind in ('vacation', 'sick', 'unavailable')),
  note text not null default '' check (char_length(note) <= 500),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  check (ends_on - starts_on <= 366)
);

create index if not exists staff_absences_scope_idx
  on public.staff_absences (organization_id, starts_on, ends_on, performer_id)
  where active;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.staff_absences'::regclass
      and conname = 'staff_absences_no_performer_overlap'
  ) then
    alter table public.staff_absences add constraint staff_absences_no_performer_overlap
      exclude using gist (
        performer_id with =,
        daterange(starts_on, ends_on, '[]') with &&
      ) where (active);
  end if;
end;
$$;

create table if not exists public.staff_schedule_audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (char_length(action) between 1 and 80),
  subject_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists staff_schedule_audit_scope_idx
  on public.staff_schedule_audit_log (organization_id, created_at desc, id desc);

alter table public.organization_shift_settings enable row level security;
alter table public.staff_location_shifts enable row level security;
alter table public.staff_absences enable row level security;
alter table public.staff_schedule_audit_log enable row level security;

drop policy if exists organization_shift_settings_member_read on public.organization_shift_settings;
create policy organization_shift_settings_member_read on public.organization_shift_settings
  for select to authenticated using (public.has_organization_role(organization_id, array['owner','admin','specialist']));
drop policy if exists staff_location_shifts_member_read on public.staff_location_shifts;
create policy staff_location_shifts_member_read on public.staff_location_shifts
  for select to authenticated using (
    public.has_organization_role(organization_id, array['owner','admin'])
    or (performer_id = auth.uid() and public.has_organization_role(organization_id, array['specialist']))
  );
drop policy if exists staff_absences_member_read on public.staff_absences;
create policy staff_absences_member_read on public.staff_absences
  for select to authenticated using (
    public.has_organization_role(organization_id, array['owner','admin'])
    or (performer_id = auth.uid() and public.has_organization_role(organization_id, array['specialist']))
  );
drop policy if exists staff_schedule_audit_manager_read on public.staff_schedule_audit_log;
create policy staff_schedule_audit_manager_read on public.staff_schedule_audit_log
  for select to authenticated using (public.has_organization_role(organization_id, array['owner','admin']));

revoke all on public.organization_shift_settings, public.staff_location_shifts,
  public.staff_absences, public.staff_schedule_audit_log from public, anon, authenticated;
grant select on public.organization_shift_settings, public.staff_location_shifts,
  public.staff_absences, public.staff_schedule_audit_log to authenticated;
grant all on public.organization_shift_settings, public.staff_location_shifts,
  public.staff_absences, public.staff_schedule_audit_log to service_role;

create or replace function public.get_minuta_schedule_role(p_organization uuid)
returns text language plpgsql stable security definer set search_path to '' as $$
declare v_role text;
begin
  if auth.uid() is null then raise exception using errcode='42501', message='authentication_required'; end if;
  select membership.role into v_role
  from public.organization_memberships membership
  join public.organizations organization on organization.id=membership.organization_id and organization.status='active'
  where membership.organization_id=p_organization and membership.user_id=auth.uid() and membership.active;
  if v_role is null then raise exception using errcode='42501', message='organization_access_denied'; end if;
  return v_role;
end;
$$;
revoke all on function public.get_minuta_schedule_role(uuid) from public, anon, authenticated, service_role;

create or replace function public.write_minuta_schedule_audit(
  p_organization uuid, p_action text, p_subject uuid, p_details jsonb default '{}'::jsonb
) returns void language sql security definer set search_path to '' as $$
  insert into public.staff_schedule_audit_log(organization_id,actor_id,action,subject_id,details)
  values (p_organization,auth.uid(),p_action,p_subject,coalesce(p_details,'{}'::jsonb));
$$;
revoke all on function public.write_minuta_schedule_audit(uuid,text,uuid,jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.minuta_booking_fits_active_shift(
  p_organization uuid, p_location uuid, p_performer uuid,
  p_date date, p_time time without time zone, p_duration integer
) returns boolean language sql stable security definer set search_path to '' as $$
  select not coalesce((select setting.enabled from public.organization_shift_settings setting
    where setting.organization_id=p_organization),false)
  or (
    not exists (select 1 from public.staff_absences absence
      where absence.organization_id=p_organization and absence.performer_id=p_performer and absence.active
        and p_date between absence.starts_on and absence.ends_on)
    and exists (select 1 from public.staff_location_shifts shift_row
      where shift_row.organization_id=p_organization and shift_row.location_id=p_location
        and shift_row.performer_id=p_performer and shift_row.shift_date=p_date and shift_row.active
        and p_time >= shift_row.start_time
        and p_time + make_interval(mins=>p_duration) <= shift_row.end_time
        and not (shift_row.break_start is not null and
          tsrange(p_date+p_time,p_date+p_time+make_interval(mins=>p_duration),'[)') &&
          tsrange(p_date+shift_row.break_start,p_date+shift_row.break_end,'[)')))
  );
$$;
revoke all on function public.minuta_booking_fits_active_shift(uuid,uuid,uuid,date,time without time zone,integer)
  from public, anon, authenticated, service_role;

create or replace function public.enforce_minuta_booking_shift()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if new.organization_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(new.organization_id::text,7100));
  end if;
  if new.status <> 'cancelled' and new.organization_id is not null and new.location_id is not null
     and not public.minuta_booking_fits_active_shift(new.organization_id,new.location_id,new.performer_id,
       new.booking_date,new.booking_time,new.duration_minutes) then
    raise exception using errcode='23P01', message='booking_outside_active_shift';
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_enforce_active_shift on public.bookings;
create trigger bookings_enforce_active_shift
after insert or update of organization_id,location_id,performer_id,booking_date,booking_time,duration_minutes,status
on public.bookings for each row execute function public.enforce_minuta_booking_shift();

create or replace function public.get_minuta_shift_workspace(
  p_organization uuid, p_start date, p_end date
) returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_role text; v_user uuid:=auth.uid();
begin
  v_role:=public.get_minuta_schedule_role(p_organization);
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>62 then
    raise exception using errcode='22023', message='invalid_calendar_range';
  end if;
  return jsonb_build_object(
    'organization_id',p_organization,'current_role',v_role,
    'can_manage_team',v_role in ('owner','admin'),
    'enabled',coalesce((select enabled from public.organization_shift_settings where organization_id=p_organization),false),
    'locations',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'active',active) order by is_primary desc,name,id)
      from public.locations where organization_id=p_organization),'[]'::jsonb),
    'performers',coalesce((select jsonb_agg(jsonb_build_object('id',membership.user_id,'display_name',profile.display_name,'role',membership.role) order by profile.display_name,membership.user_id)
      from public.organization_memberships membership join public.performer_profiles profile on profile.id=membership.user_id
      where membership.organization_id=p_organization and membership.active and membership.is_bookable
        and (v_role in ('owner','admin') or membership.user_id=v_user)),'[]'::jsonb),
    'services',coalesce((select jsonb_agg(jsonb_build_object('id',service.id,'performer_id',service.performer_id,'name',service.name,'duration_minutes',service.duration_minutes,'price_rub',service.price_rub) order by service.performer_id,service.name,service.id)
      from public.services service join public.organization_memberships membership on membership.organization_id=p_organization and membership.user_id=service.performer_id and membership.active and membership.is_bookable
      where service.active and (v_role in ('owner','admin') or service.performer_id=v_user)),'[]'::jsonb),
    'shifts',coalesce((select jsonb_agg(jsonb_build_object('id',shift_row.id,'location_id',shift_row.location_id,'performer_id',shift_row.performer_id,'shift_date',shift_row.shift_date,'start_time',shift_row.start_time,'end_time',shift_row.end_time,'break_start',shift_row.break_start,'break_end',shift_row.break_end,'note',shift_row.note,'active',shift_row.active) order by shift_row.shift_date,shift_row.start_time,shift_row.performer_id)
      from public.staff_location_shifts shift_row where shift_row.organization_id=p_organization and shift_row.shift_date between p_start and p_end
        and (v_role in ('owner','admin') or shift_row.performer_id=v_user)),'[]'::jsonb),
    'absences',coalesce((select jsonb_agg(jsonb_build_object('id',absence.id,'performer_id',absence.performer_id,'starts_on',absence.starts_on,'ends_on',absence.ends_on,'kind',absence.kind,'note',absence.note,'active',absence.active) order by absence.starts_on,absence.performer_id)
      from public.staff_absences absence where absence.organization_id=p_organization and absence.starts_on<=p_end and absence.ends_on>=p_start
        and (v_role in ('owner','admin') or absence.performer_id=v_user)),'[]'::jsonb),
    'bookings',coalesce((select jsonb_agg(jsonb_build_object('id',booking.id,'booking_code',booking.booking_code,'location_id',booking.location_id,'performer_id',booking.performer_id,'service_id',booking.service_id,'booking_date',booking.booking_date,'booking_time',booking.booking_time,'duration_minutes',booking.duration_minutes,'primary_duration_minutes',coalesce((select item.duration_minutes from public.booking_session_items item where item.booking_id=booking.id and item.item_kind='primary' order by item.position,item.id limit 1),service.duration_minutes),'has_addons',exists(select 1 from public.booking_session_items item where item.booking_id=booking.id and item.item_kind='addon'),'service_name',service.name,'status',booking.status) order by booking.booking_date,booking.booking_time,booking.id)
      from public.bookings booking join public.services service on service.id=booking.service_id
      where booking.organization_id=p_organization and booking.booking_date between p_start and p_end and booking.status<>'cancelled'
        and (v_role in ('owner','admin') or booking.performer_id=v_user)),'[]'::jsonb),
    'utilization',coalesce((select jsonb_agg(jsonb_build_object('location_id',totals.location_id,'performer_id',totals.performer_id,'shift_minutes',totals.shift_minutes,'booked_minutes',totals.booked_minutes,'percent',case when totals.shift_minutes>0 then least(100,round(100.0*totals.booked_minutes/totals.shift_minutes)) else 0 end) order by totals.location_id,totals.performer_id)
      from (select shift_row.location_id,shift_row.performer_id,
        sum(extract(epoch from (shift_row.end_time-shift_row.start_time))/60 - coalesce(extract(epoch from (shift_row.break_end-shift_row.break_start))/60,0))::integer shift_minutes,
        coalesce((select sum(booking.duration_minutes)::integer from public.bookings booking where booking.organization_id=p_organization and booking.location_id=shift_row.location_id and booking.performer_id=shift_row.performer_id and booking.booking_date between p_start and p_end and booking.status<>'cancelled'),0) booked_minutes
        from public.staff_location_shifts shift_row where shift_row.organization_id=p_organization and shift_row.shift_date between p_start and p_end and shift_row.active and (v_role in ('owner','admin') or shift_row.performer_id=v_user)
        group by shift_row.location_id,shift_row.performer_id) totals),'[]'::jsonb),
    'audit',case when v_role in ('owner','admin') then coalesce((select jsonb_agg(jsonb_build_object('id',entry.id,'actor_id',entry.actor_id,'action',entry.action,'subject_id',entry.subject_id,'details',entry.details,'created_at',entry.created_at) order by entry.created_at desc,entry.id desc)
      from (select * from public.staff_schedule_audit_log where organization_id=p_organization order by created_at desc,id desc limit 50) entry),'[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;

revoke all on function public.get_minuta_shift_workspace(uuid,date,date) from public, anon, authenticated, service_role;
grant execute on function public.get_minuta_shift_workspace(uuid,date,date) to authenticated;

create or replace function public.upsert_minuta_staff_shift(
  p_organization uuid,p_shift uuid,p_location uuid,p_performer uuid,p_date date,
  p_start time without time zone,p_end time without time zone,
  p_break_start time without time zone default null,p_break_end time without time zone default null,p_note text default ''
) returns uuid language plpgsql security definer set search_path to '' as $$
declare v_role text; v_id uuid; v_conflict uuid; v_old public.staff_location_shifts%rowtype;
begin
  v_role:=public.get_minuta_schedule_role(p_organization);
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text,7100));
  if v_role='specialist' and p_performer<>auth.uid() then raise exception using errcode='42501', message='foreign_performer_denied'; end if;
  if not exists(select 1 from public.organization_memberships where organization_id=p_organization and user_id=p_performer and active and is_bookable)
     or not exists(select 1 from public.locations where id=p_location and organization_id=p_organization and active) then
    raise exception using errcode='42501', message='foreign_schedule_scope';
  end if;
  if exists(select 1 from public.staff_absences where organization_id=p_organization and performer_id=p_performer and active and p_date between starts_on and ends_on) then
    raise exception using errcode='23P01', message='shift_overlaps_absence';
  end if;
  if p_shift is null then
    insert into public.staff_location_shifts(organization_id,location_id,performer_id,shift_date,start_time,end_time,break_start,break_end,note,created_by)
    values(p_organization,p_location,p_performer,p_date,p_start,p_end,p_break_start,p_break_end,trim(coalesce(p_note,'')),auth.uid()) returning id into v_id;
  else
    select * into v_old from public.staff_location_shifts where id=p_shift and organization_id=p_organization for update;
    if v_old.id is null or (v_role='specialist' and v_old.performer_id<>auth.uid()) then raise exception using errcode='42501', message='foreign_shift_denied'; end if;
    update public.staff_location_shifts set location_id=p_location,performer_id=p_performer,shift_date=p_date,start_time=p_start,end_time=p_end,break_start=p_break_start,break_end=p_break_end,note=trim(coalesce(p_note,'')),active=true,updated_at=now()
    where id=p_shift and organization_id=p_organization and (v_role in ('owner','admin') or performer_id=auth.uid()) returning id into v_id;
    if v_id is null then raise exception using errcode='42501', message='foreign_shift_denied'; end if;
  end if;
  select booking.id into v_conflict from public.bookings booking
  where booking.organization_id=p_organization and booking.status<>'cancelled'
    and ((booking.performer_id=p_performer and booking.booking_date=p_date)
      or (v_old.id is not null and booking.performer_id=v_old.performer_id and booking.booking_date=v_old.shift_date))
    and not public.minuta_booking_fits_active_shift(p_organization,booking.location_id,booking.performer_id,booking.booking_date,booking.booking_time,booking.duration_minutes)
  limit 1;
  if v_conflict is not null and coalesce((select enabled from public.organization_shift_settings where organization_id=p_organization),false) then
    raise exception using errcode='23P01', message='shift_change_conflicts_with_booking';
  end if;
  perform public.write_minuta_schedule_audit(p_organization,case when p_shift is null then 'shift_created' else 'shift_updated' end,v_id,jsonb_build_object('performer_id',p_performer,'location_id',p_location,'date',p_date));
  return v_id;
end;
$$;

create or replace function public.cancel_minuta_staff_shift(p_shift uuid)
returns boolean language plpgsql security definer set search_path to '' as $$
declare v_row public.staff_location_shifts%rowtype; v_role text; v_organization uuid;
begin
  select organization_id into v_organization from public.staff_location_shifts where id=p_shift;
  if v_organization is null then return false; end if;
  v_role:=public.get_minuta_schedule_role(v_organization);
  perform pg_advisory_xact_lock(hashtextextended(v_organization::text,7100));
  select * into v_row from public.staff_location_shifts where id=p_shift and organization_id=v_organization for update;
  if v_row.id is null then return false; end if;
  if v_role='specialist' and v_row.performer_id<>auth.uid() then raise exception using errcode='42501', message='foreign_shift_denied'; end if;
  if coalesce((select enabled from public.organization_shift_settings where organization_id=v_row.organization_id),false)
     and exists(select 1 from public.bookings booking where booking.organization_id=v_row.organization_id and booking.performer_id=v_row.performer_id and booking.location_id=v_row.location_id and booking.booking_date=v_row.shift_date and booking.status<>'cancelled'
       and booking.booking_time>=v_row.start_time and booking.booking_time<v_row.end_time) then
    raise exception using errcode='P0001', message='shift_has_bookings';
  end if;
  update public.staff_location_shifts set active=false,updated_at=now() where id=p_shift;
  perform public.write_minuta_schedule_audit(v_row.organization_id,'shift_cancelled',p_shift,jsonb_build_object('performer_id',v_row.performer_id,'location_id',v_row.location_id,'date',v_row.shift_date));
  return true;
end;
$$;

create or replace function public.create_minuta_staff_absence(
  p_organization uuid,p_performer uuid,p_start date,p_end date,p_kind text,p_note text default ''
) returns uuid language plpgsql security definer set search_path to '' as $$
declare v_role text; v_id uuid;
begin
  v_role:=public.get_minuta_schedule_role(p_organization);
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text,7100));
  if v_role='specialist' and p_performer<>auth.uid() then raise exception using errcode='42501', message='foreign_performer_denied'; end if;
  if not exists(select 1 from public.organization_memberships where organization_id=p_organization and user_id=p_performer and active) then raise exception using errcode='42501', message='foreign_performer_denied'; end if;
  if exists(select 1 from public.bookings where organization_id=p_organization and performer_id=p_performer and booking_date between p_start and p_end and status<>'cancelled') then raise exception using errcode='P0001', message='absence_has_bookings'; end if;
  insert into public.staff_absences(organization_id,performer_id,starts_on,ends_on,kind,note,created_by)
  values(p_organization,p_performer,p_start,p_end,p_kind,trim(coalesce(p_note,'')),auth.uid()) returning id into v_id;
  perform public.write_minuta_schedule_audit(p_organization,'absence_created',v_id,jsonb_build_object('performer_id',p_performer,'starts_on',p_start,'ends_on',p_end,'kind',p_kind));
  return v_id;
end;
$$;

create or replace function public.cancel_minuta_staff_absence(p_absence uuid)
returns boolean language plpgsql security definer set search_path to '' as $$
declare v_row public.staff_absences%rowtype; v_role text; v_organization uuid;
begin
  select organization_id into v_organization from public.staff_absences where id=p_absence;
  if v_organization is null then return false; end if;
  v_role:=public.get_minuta_schedule_role(v_organization);
  perform pg_advisory_xact_lock(hashtextextended(v_organization::text,7100));
  select * into v_row from public.staff_absences where id=p_absence and organization_id=v_organization for update;
  if v_row.id is null then return false; end if;
  if v_role='specialist' and v_row.performer_id<>auth.uid() then raise exception using errcode='42501', message='foreign_absence_denied'; end if;
  update public.staff_absences set active=false,updated_at=now() where id=p_absence;
  perform public.write_minuta_schedule_audit(v_row.organization_id,'absence_cancelled',p_absence,jsonb_build_object('performer_id',v_row.performer_id));
  return true;
end;
$$;

create or replace function public.set_minuta_branch_shifts_enabled(p_organization uuid,p_enabled boolean)
returns boolean language plpgsql security definer set search_path to '' as $$
declare v_role text;
begin
  v_role:=public.get_minuta_schedule_role(p_organization);
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text,7100));
  if v_role<>'owner' then raise exception using errcode='42501', message='owner_required'; end if;
  if p_enabled and exists(select 1 from public.bookings booking where booking.organization_id=p_organization and booking.status<>'cancelled' and booking.booking_date>=current_date
    and (exists(select 1 from public.staff_absences absence where absence.organization_id=p_organization and absence.performer_id=booking.performer_id and absence.active and booking.booking_date between absence.starts_on and absence.ends_on)
      or not exists(select 1 from public.staff_location_shifts shift_row where shift_row.organization_id=p_organization and shift_row.location_id=booking.location_id and shift_row.performer_id=booking.performer_id and shift_row.shift_date=booking.booking_date and shift_row.active and booking.booking_time>=shift_row.start_time and booking.booking_time+make_interval(mins=>booking.duration_minutes)<=shift_row.end_time
        and not (shift_row.break_start is not null and tsrange(booking.booking_date+booking.booking_time,booking.booking_date+booking.booking_time+make_interval(mins=>booking.duration_minutes),'[)') && tsrange(booking.booking_date+shift_row.break_start,booking.booking_date+shift_row.break_end,'[)'))))) then
    raise exception using errcode='P0001', message='existing_bookings_outside_shifts';
  end if;
  insert into public.organization_shift_settings(organization_id,enabled,enabled_at,enabled_by,updated_at)
  values(p_organization,p_enabled,case when p_enabled then now() else null end,case when p_enabled then auth.uid() else null end,now())
  on conflict(organization_id) do update set enabled=excluded.enabled,enabled_at=excluded.enabled_at,enabled_by=excluded.enabled_by,updated_at=now();
  perform public.write_minuta_schedule_audit(p_organization,case when p_enabled then 'schedule_enabled' else 'schedule_disabled' end,p_organization,'{}'::jsonb);
  return p_enabled;
end;
$$;

create or replace function public.substitute_minuta_booking(p_organization uuid,p_booking uuid,p_new_service uuid)
returns boolean language plpgsql security definer set search_path to '' as $$
declare v_role text; v_booking public.bookings%rowtype; v_performer uuid; v_primary_duration integer;
begin
  v_role:=public.get_minuta_schedule_role(p_organization);
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text,7100));
  if v_role not in ('owner','admin') then raise exception using errcode='42501', message='booking_substitution_denied'; end if;
  select * into v_booking from public.bookings where id=p_booking and organization_id=p_organization and status<>'cancelled' for update;
  if v_booking.id is null then raise exception using errcode='P0001', message='booking_not_found'; end if;
  if v_booking.booking_date < current_date or exists(select 1 from public.booking_outcomes outcome where outcome.booking_id=p_booking and outcome.visit_status<>'scheduled') then
    raise exception using errcode='P0001', message='completed_booking_substitution_denied';
  end if;
  if exists(select 1 from public.booking_session_items item where item.booking_id=p_booking and item.item_kind='addon') then
    raise exception using errcode='55000', message='booking_substitution_addons_require_manual_remap';
  end if;
  select coalesce((select item.duration_minutes from public.booking_session_items item
    where item.booking_id=p_booking and item.item_kind='primary' order by item.position,item.id limit 1),
    (select service.duration_minutes from public.services service where service.id=v_booking.service_id))
    into v_primary_duration;
  select service.performer_id into v_performer from public.services service join public.organization_memberships membership on membership.organization_id=p_organization and membership.user_id=service.performer_id and membership.active and membership.is_bookable where service.id=p_new_service and service.active and service.duration_minutes=v_primary_duration;
  if v_performer is null then raise exception using errcode='42501', message='foreign_service_denied'; end if;
  update public.booking_session_items item set performer_id=v_performer,
    service_id=case when item.item_kind='primary' then p_new_service else item.service_id end,
    title=case when item.item_kind='primary' then (select name from public.services where id=p_new_service) else item.title end
    where item.booking_id=p_booking;
  insert into public.booking_session_revisions(booking_id,performer_id,items,total_price_rub,total_duration_minutes)
  select p_booking,v_performer,jsonb_agg(jsonb_build_object('kind',item.item_kind,'service_id',item.service_id,'title',item.title,'duration_minutes',item.duration_minutes,'price_rub',item.price_rub,'extends_duration',item.extends_duration) order by item.position),sum(item.price_rub)::integer,
    (sum(item.duration_minutes) filter(where item.item_kind='primary')+coalesce(sum(item.duration_minutes) filter(where item.item_kind='addon' and item.extends_duration),0))::integer
  from public.booking_session_items item where item.booking_id=p_booking having count(*)>0;
  delete from public.notification_marks where booking_id=p_booking;
  update public.notification_outbox set status='failed',last_error_code='booking_substituted',last_error='Доставка отменена: специалист записи изменён',locked_at=null,lock_token=null
    where booking_id=p_booking and status in ('pending','sending');
  update public.bookings set service_id=p_new_service,performer_id=v_performer where id=p_booking;
  perform public.write_minuta_schedule_audit(p_organization,'booking_substituted',p_booking,jsonb_build_object('old_performer_id',v_booking.performer_id,'new_performer_id',v_performer,'old_service_id',v_booking.service_id,'new_service_id',p_new_service));
  return true;
end;
$$;

do $$ declare v_signature regprocedure;
begin
  foreach v_signature in array array[
    'public.upsert_minuta_staff_shift(uuid,uuid,uuid,uuid,date,time without time zone,time without time zone,time without time zone,time without time zone,text)'::regprocedure,
    'public.cancel_minuta_staff_shift(uuid)'::regprocedure,
    'public.create_minuta_staff_absence(uuid,uuid,date,date,text,text)'::regprocedure,
    'public.cancel_minuta_staff_absence(uuid)'::regprocedure,
    'public.set_minuta_branch_shifts_enabled(uuid,boolean)'::regprocedure,
    'public.substitute_minuta_booking(uuid,uuid,uuid)'::regprocedure
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role',v_signature);
    execute format('grant execute on function %s to authenticated',v_signature);
  end loop;
end $$;

create or replace function public.get_public_minuta_available_slots_v4(
  p_slug text,p_location uuid,p_service uuid,p_start date,p_end date
) returns table(booking_date date,booking_time time without time zone)
language sql stable security definer set search_path to '' as $$
  select slot.booking_date,slot.booking_time
  from public.get_public_minuta_available_slots_v3(p_slug,p_location,p_service,p_start,p_end) slot
  join public.organizations organization on organization.public_slug=lower(trim(coalesce(p_slug,'')))
  join public.services service on service.id=p_service
  where public.minuta_booking_fits_active_shift(organization.id,p_location,service.performer_id,slot.booking_date,slot.booking_time,service.duration_minutes)
  order by slot.booking_date,slot.booking_time;
$$;
revoke all on function public.get_public_minuta_available_slots_v4(text,uuid,uuid,date,date) from public, anon, authenticated, service_role;
grant execute on function public.get_public_minuta_available_slots_v4(text,uuid,uuid,date,date) to anon, authenticated;

create or replace function public.get_reschedule_slots_v4(p_token uuid,p_start date,p_end date)
returns table(booking_date date,booking_time time without time zone)
language sql stable security definer set search_path to '' as $$
  select slot.booking_date,slot.booking_time
  from public.bookings booking
  join public.services service on service.id=booking.service_id
  cross join lateral public.get_reschedule_slots_v3(p_token,p_start,p_end) slot
  where booking.manage_token=p_token and booking.status<>'cancelled'
    and public.minuta_booking_fits_active_shift(booking.organization_id,booking.location_id,booking.performer_id,slot.booking_date,slot.booking_time,booking.duration_minutes)
  order by slot.booking_date,slot.booking_time;
$$;
revoke all on function public.get_reschedule_slots_v4(uuid,date,date) from public, anon, authenticated, service_role;
grant execute on function public.get_reschedule_slots_v4(uuid,date,date) to anon, authenticated;

create or replace function public.get_public_minuta_catalog_v4(p_slug text)
returns jsonb language sql stable security definer set search_path to '' as $$
  select public.get_public_minuta_catalog_v3(p_slug) || jsonb_build_object(
    'branch_shift_scheduling',coalesce((select setting.enabled from public.organization_shift_settings setting join public.organizations organization on organization.id=setting.organization_id where organization.public_slug=lower(trim(coalesce(p_slug,''))) and organization.status='active' and organization.public_booking_enabled),false)
  );
$$;
revoke all on function public.get_public_minuta_catalog_v4(text) from public, anon, authenticated, service_role;
grant execute on function public.get_public_minuta_catalog_v4(text) to anon, authenticated;

commit;
