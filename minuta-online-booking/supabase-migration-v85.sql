begin;

set local search_path = public, extensions, pg_catalog;

-- v85 adds an explicitly enabled provider-only workflow for creating several
-- non-periodic visits in one transaction. The existing booking RPC and its
-- overlap, resource, shift and payment-policy triggers remain the source of truth.
do $$
begin
  if to_regclass('public.organizations') is null
     or to_regclass('public.locations') is null
     or to_regclass('public.organization_memberships') is null
     or to_regclass('public.bookings') is null
     or to_regclass('public.services') is null
     or to_regclass('public.group_booking_events') is null
     or to_regprocedure('public.book_appointment(uuid,uuid,date,time without time zone,text,text)') is null
     or to_regprocedure('public.is_organization_member(uuid)') is null
     or to_regprocedure('public.has_organization_role(uuid,text[])') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema='public' and table_name='bookings' and column_name='organization_id'
     )
     or not exists (
       select 1 from information_schema.columns
       where table_schema='public' and table_name='bookings' and column_name='provider_note'
     ) then
    raise exception using errcode='P0001',message='v85_missing_prerequisites';
  end if;
end $$;

create table if not exists public.organization_batch_booking_settings (
  organization_id uuid primary key references public.organizations(id) on delete restrict,
  enabled boolean not null default false,
  max_items integer not null default 12 check (max_items between 2 and 24),
  enabled_at timestamptz,
  enabled_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.booking_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  request_id uuid not null,
  location_id uuid not null,
  service_id uuid not null references public.services(id) on delete restrict,
  performer_id uuid not null references public.performer_profiles(id) on delete restrict,
  client_name text not null check (char_length(btrim(client_name)) between 2 and 80),
  client_phone text not null check (char_length(regexp_replace(client_phone,'[^0-9]','','g')) between 10 and 15),
  phone_digits text not null check (phone_digits ~ '^[0-9]{10,15}$'),
  comment text not null default '' check (char_length(comment) <= 500),
  item_count integer not null check (item_count between 2 and 24),
  items_payload jsonb not null check (jsonb_typeof(items_payload)='array'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (organization_id,request_id),
  unique (id,organization_id),
  foreign key (location_id,organization_id) references public.locations(id,organization_id) on delete restrict,
  foreign key (organization_id,performer_id) references public.organization_memberships(organization_id,user_id) on delete restrict
);

create table if not exists public.booking_batch_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  organization_id uuid not null,
  position integer not null check (position between 1 and 24),
  request_id uuid not null,
  booking_id uuid references public.bookings(id) on delete set null,
  booking_date date not null,
  booking_time time without time zone not null,
  comment text not null default '' check (char_length(comment) <= 500),
  booking_code text not null,
  created_at timestamptz not null default now(),
  foreign key (batch_id,organization_id) references public.booking_batches(id,organization_id) on delete restrict,
  unique (batch_id,position),
  unique (batch_id,request_id),
  unique (booking_id)
);

create table if not exists public.booking_batch_audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('settings_changed','batch_created')),
  batch_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists booking_batches_scope_created_idx
  on public.booking_batches(organization_id,created_at desc,id);
create index if not exists booking_batches_client_idx
  on public.booking_batches(organization_id,phone_digits,created_at desc);
create index if not exists booking_batch_items_batch_idx
  on public.booking_batch_items(batch_id,position);
create index if not exists booking_batch_audit_scope_idx
  on public.booking_batch_audit_log(organization_id,created_at desc,id desc);

insert into public.organization_batch_booking_settings(organization_id)
select organization.id from public.organizations organization
on conflict (organization_id) do nothing;

create or replace function public.ensure_minuta_batch_booking_settings()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  insert into public.organization_batch_booking_settings(organization_id)
  values(new.id) on conflict (organization_id) do nothing;
  return new;
end $$;

revoke all on function public.ensure_minuta_batch_booking_settings()
  from public,anon,authenticated,service_role;
drop trigger if exists organizations_batch_booking_settings on public.organizations;
create trigger organizations_batch_booking_settings after insert on public.organizations
for each row execute function public.ensure_minuta_batch_booking_settings();

create or replace function public.touch_minuta_batch_booking_settings()
returns trigger language plpgsql security invoker set search_path to '' as $$
begin
  new.updated_at:=now();
  return new;
end $$;
revoke all on function public.touch_minuta_batch_booking_settings()
  from public,anon,authenticated,service_role;
drop trigger if exists batch_booking_settings_touch on public.organization_batch_booking_settings;
create trigger batch_booking_settings_touch before update on public.organization_batch_booking_settings
for each row execute function public.touch_minuta_batch_booking_settings();

alter table public.organization_batch_booking_settings enable row level security;
alter table public.booking_batches enable row level security;
alter table public.booking_batch_items enable row level security;
alter table public.booking_batch_audit_log enable row level security;

drop policy if exists batch_booking_settings_member_read on public.organization_batch_booking_settings;
create policy batch_booking_settings_member_read on public.organization_batch_booking_settings
  for select to authenticated using(public.is_organization_member(organization_id));
drop policy if exists booking_batches_scoped_read on public.booking_batches;
create policy booking_batches_scoped_read on public.booking_batches
  for select to authenticated using(
    public.has_organization_role(organization_id,array['owner','admin'])
    or (public.is_organization_member(organization_id) and performer_id=auth.uid())
  );
drop policy if exists booking_batch_items_scoped_read on public.booking_batch_items;
create policy booking_batch_items_scoped_read on public.booking_batch_items
  for select to authenticated using(exists(
    select 1 from public.booking_batches batch
    where batch.id=public.booking_batch_items.batch_id
      and batch.organization_id=public.booking_batch_items.organization_id
      and (public.has_organization_role(batch.organization_id,array['owner','admin'])
        or (public.is_organization_member(batch.organization_id) and batch.performer_id=auth.uid()))
  ));
drop policy if exists booking_batch_audit_manager_read on public.booking_batch_audit_log;
create policy booking_batch_audit_manager_read on public.booking_batch_audit_log
  for select to authenticated using(public.has_organization_role(organization_id,array['owner','admin']));

revoke all on table public.organization_batch_booking_settings,public.booking_batches,
  public.booking_batch_items,public.booking_batch_audit_log from public,anon,authenticated,service_role;
grant select on table public.organization_batch_booking_settings,public.booking_batches,
  public.booking_batch_items,public.booking_batch_audit_log to authenticated;
grant all on table public.organization_batch_booking_settings,public.booking_batches,
  public.booking_batch_items,public.booking_batch_audit_log to service_role;

create or replace function public.require_minuta_batch_booking_role(p_organization uuid)
returns text language plpgsql stable security definer set search_path to '' as $$
declare v_role text;
begin
  if auth.uid() is null then
    raise exception using errcode='42501',message='authentication_required';
  end if;
  select membership.role into v_role
  from public.organization_memberships membership
  join public.organizations organization on organization.id=membership.organization_id and organization.status='active'
  where membership.organization_id=p_organization and membership.user_id=auth.uid() and membership.active;
  if v_role not in ('owner','admin','specialist') then
    raise exception using errcode='42501',message='batch_booking_access_denied';
  end if;
  return v_role;
end $$;
revoke all on function public.require_minuta_batch_booking_role(uuid)
  from public,anon,authenticated,service_role;

create or replace function public.set_minuta_batch_bookings_enabled(
  p_organization uuid,p_enabled boolean,p_max_items integer default 12
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_role text;
begin
  v_role:=public.require_minuta_batch_booking_role(p_organization);
  if v_role<>'owner' then raise exception using errcode='42501',message='batch_booking_owner_required'; end if;
  if p_enabled is null or p_max_items not between 2 and 24 then
    raise exception using errcode='22023',message='invalid_batch_booking_settings';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text,8500));
  insert into public.organization_batch_booking_settings(organization_id,enabled,max_items,enabled_at,enabled_by)
  values(p_organization,p_enabled,p_max_items,case when p_enabled then now() end,case when p_enabled then auth.uid() end)
  on conflict(organization_id) do update set enabled=excluded.enabled,max_items=excluded.max_items,
    enabled_at=case when excluded.enabled then coalesce(public.organization_batch_booking_settings.enabled_at,now()) end,
    enabled_by=case when excluded.enabled then coalesce(public.organization_batch_booking_settings.enabled_by,auth.uid()) end;
  insert into public.booking_batch_audit_log(organization_id,actor_id,action,details)
  values(p_organization,auth.uid(),'settings_changed',jsonb_build_object('enabled',p_enabled,'max_items',p_max_items));
  return jsonb_build_object('enabled',p_enabled,'max_items',p_max_items);
end $$;

create or replace function public.get_minuta_batch_booking_workspace(p_organization uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_role text; v_enabled boolean; v_max integer;
begin
  v_role:=public.require_minuta_batch_booking_role(p_organization);
  select setting.enabled,setting.max_items into v_enabled,v_max
  from public.organization_batch_booking_settings setting where setting.organization_id=p_organization;
  return jsonb_build_object(
    'organization_id',p_organization,'current_role',v_role,
    'enabled',coalesce(v_enabled,false),'max_items',coalesce(v_max,12),
    'locations',coalesce((select jsonb_agg(jsonb_build_object('id',location.id,'name',location.name) order by location.is_primary desc,location.name,location.id)
      from public.locations location where location.organization_id=p_organization and location.active),'[]'::jsonb),
    'services',coalesce((select jsonb_agg(jsonb_build_object('id',service.id,'name',service.name,'duration_minutes',service.duration_minutes,
        'performer_id',service.performer_id,'performer_name',coalesce(profile.display_name,'Специалист')) order by profile.display_name,service.name,service.id)
      from public.services service
      join public.organization_memberships membership on membership.organization_id=p_organization and membership.user_id=service.performer_id
        and membership.active and membership.is_bookable
      left join public.performer_profiles profile on profile.id=service.performer_id
      where service.active and (v_role in ('owner','admin') or service.performer_id=auth.uid())),'[]'::jsonb),
    'recent_batches',coalesce((select jsonb_agg(batch_row.payload order by batch_row.created_at desc,batch_row.id desc)
      from (select batch.created_at,batch.id,jsonb_build_object('id',batch.id,'created_at',batch.created_at,'client_name',batch.client_name,
          'client_phone',batch.client_phone,'comment',batch.comment,'item_count',batch.item_count,'service_id',batch.service_id,
          'performer_id',batch.performer_id,'location_id',batch.location_id,
          'items',coalesce((select jsonb_agg(jsonb_build_object('booking_id',item.booking_id,'position',item.position,'date',item.booking_date,
            'time',item.booking_time,'comment',item.comment,'booking_code',item.booking_code) order by item.position)
            from public.booking_batch_items item where item.batch_id=batch.id),'[]'::jsonb)) payload
        from public.booking_batches batch where batch.organization_id=p_organization
          and (v_role in ('owner','admin') or batch.performer_id=auth.uid())
        order by batch.created_at desc,batch.id desc limit 30) batch_row),'[]'::jsonb)
  );
end $$;

create or replace function public.create_minuta_batch_bookings(
  p_organization uuid,p_location uuid,p_service uuid,p_client_name text,p_client_phone text,
  p_items jsonb,p_request_id uuid,p_comment text default ''
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_role text; v_enabled boolean; v_max integer; v_performer uuid; v_duration integer;
  v_existing public.booking_batches%rowtype; v_batch uuid; v_count integer; v_position integer:=0;
  v_item jsonb; v_item_request uuid; v_date date; v_time time without time zone; v_item_comment text; v_lock_date date;
  v_normalized jsonb:='[]'::jsonb; v_created jsonb:='[]'::jsonb; v_booking_id uuid; v_code text; v_token uuid;
  v_phone_digits text:=regexp_replace(coalesce(p_client_phone,''),'[^0-9]','','g');
  v_batch_comment text:=btrim(coalesce(p_comment,''));
  v_previous_organization text:=current_setting('minuta.booking_organization',true);
  v_previous_location text:=current_setting('minuta.booking_location',true);
begin
  v_role:=public.require_minuta_batch_booking_role(p_organization);
  if p_request_id is null or p_items is null or jsonb_typeof(p_items)<>'array'
     or coalesce(char_length(btrim(p_client_name)),0) not between 2 and 80
     or char_length(v_phone_digits) not between 10 and 15
     or char_length(v_batch_comment)>500 then
    raise exception using errcode='22023',message='invalid_batch_booking';
  end if;
  v_count:=jsonb_array_length(p_items);
  if v_count<2 or v_count>24 then raise exception using errcode='22023',message='batch_booking_size_invalid'; end if;

  begin
    for v_item in select value from jsonb_array_elements(p_items) loop
      v_position:=v_position+1;
      if jsonb_typeof(v_item)<>'object' then raise exception using errcode='22023',message='invalid_batch_booking_item'; end if;
      v_item_request:=(v_item->>'request_id')::uuid;
      v_date:=(v_item->>'date')::date;
      v_time:=(v_item->>'time')::time without time zone;
      v_item_comment:=btrim(coalesce(v_item->>'comment',''));
      if v_item_request is null or v_item_request=p_request_id or v_date<current_date or v_date>current_date+730
         or char_length(v_item_comment)>500 or char_length(concat_ws(E'\n',nullif(v_batch_comment,''),nullif(v_item_comment,'')))>1000 then
        raise exception using errcode='22023',message='invalid_batch_booking_item';
      end if;
      v_normalized:=v_normalized||jsonb_build_array(jsonb_build_object('request_id',v_item_request,'date',v_date,'time',v_time,'comment',v_item_comment));
    end loop;
  exception when invalid_text_representation or datetime_field_overflow then
    raise exception using errcode='22023',message='invalid_batch_booking_item';
  end;

  if (select count(distinct item->>'request_id') from jsonb_array_elements(v_normalized) item)<>v_count
     or (select count(distinct (item->>'date',item->>'time')) from jsonb_array_elements(v_normalized) item)<>v_count then
    raise exception using errcode='22023',message='duplicate_batch_booking_item';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':'||p_request_id::text,8501));
  select * into v_existing from public.booking_batches batch
  where batch.organization_id=p_organization and batch.request_id=p_request_id for update;
  if found then
    if (v_role='specialist' and v_existing.performer_id is distinct from auth.uid()) then
      raise exception using errcode='42501',message='batch_booking_access_denied';
    end if;
    if v_existing.location_id is distinct from p_location or v_existing.service_id is distinct from p_service
       or v_existing.client_name is distinct from btrim(p_client_name) or v_existing.phone_digits is distinct from v_phone_digits
       or v_existing.comment is distinct from v_batch_comment or v_existing.items_payload is distinct from v_normalized then
      raise exception using errcode='22023',message='batch_booking_idempotency_mismatch';
    end if;
    return jsonb_build_object('batch_id',v_existing.id,'created_count',v_existing.item_count,'idempotent',true,
      'created',coalesce((select jsonb_agg(jsonb_build_object('booking_id',item.booking_id,'position',item.position,'date',item.booking_date,
        'time',item.booking_time,'comment',item.comment,'booking_code',item.booking_code) order by item.position)
        from public.booking_batch_items item where item.batch_id=v_existing.id),'[]'::jsonb));
  end if;

  select setting.enabled,setting.max_items into v_enabled,v_max
  from public.organization_batch_booking_settings setting where setting.organization_id=p_organization;
  if not coalesce(v_enabled,false) then raise exception using errcode='55000',message='batch_bookings_disabled'; end if;
  v_max:=coalesce(v_max,12);
  if v_count>v_max then raise exception using errcode='22023',message='batch_booking_size_invalid'; end if;
  if not exists(select 1 from public.locations location where location.id=p_location and location.organization_id=p_organization and location.active) then
    raise exception using errcode='42501',message='batch_booking_location_denied';
  end if;
  select service.performer_id,service.duration_minutes into v_performer,v_duration
  from public.services service join public.organization_memberships membership
    on membership.organization_id=p_organization and membership.user_id=service.performer_id and membership.active and membership.is_bookable
  where service.id=p_service and service.active;
  if v_performer is null or (v_role='specialist' and v_performer<>auth.uid()) then
    raise exception using errcode='42501',message='batch_booking_service_denied';
  end if;
  if exists(
    select 1 from jsonb_array_elements(v_normalized) with ordinality left_item(item,left_position)
    join jsonb_array_elements(v_normalized) with ordinality right_item(item,right_position) on right_position>left_position
    where tsrange((left_item.item->>'date')::date+(left_item.item->>'time')::time,
      (left_item.item->>'date')::date+(left_item.item->>'time')::time+make_interval(mins=>v_duration),'[)')
      && tsrange((right_item.item->>'date')::date+(right_item.item->>'time')::time,
      (right_item.item->>'date')::date+(right_item.item->>'time')::time+make_interval(mins=>v_duration),'[)')
  ) then raise exception using errcode='23P01',message='batch_booking_items_overlap'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_performer::text,8502));
  -- Match book_appointment's lock order before taking any performer/date lock:
  -- request id -> legacy performer/date -> group-event performer/date. Taking
  -- every key in a stable order prevents deadlocks with concurrent single visits.
  for v_item_request in
    select (item->>'request_id')::uuid from jsonb_array_elements(v_normalized) item order by 1
  loop
    perform pg_advisory_xact_lock(hashtextextended('booking-request:'||v_item_request::text,0));
  end loop;
  for v_lock_date in
    select distinct (item->>'date')::date from jsonb_array_elements(v_normalized) item order by 1
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_performer::text||v_lock_date::text,0));
  end loop;
  -- v80's legacy booking trigger can run before the tenant-scope trigger. Batch
  -- creation therefore takes the same per-day lock as group events and checks
  -- them with the already validated effective tenant scope before inserting.
  for v_lock_date in
    select distinct (item->>'date')::date from jsonb_array_elements(v_normalized) item order by 1
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_performer::text||':'||v_lock_date::text,8001));
  end loop;
  if exists(
    select 1 from jsonb_array_elements(v_normalized) item
    join public.group_booking_events event on event.organization_id=p_organization
      and event.location_id=p_location and event.performer_id=v_performer
      and event.event_date=(item->>'date')::date and event.status in ('published','closed')
    where tsrange(event.event_date+event.start_time,event.event_date+event.start_time+make_interval(mins=>event.duration_minutes),'[)')
      && tsrange((item->>'date')::date+(item->>'time')::time,
        (item->>'date')::date+(item->>'time')::time+make_interval(mins=>v_duration),'[)')
  ) then
    raise exception using errcode='P0001',message='slot_reserved_for_group_event';
  end if;
  if exists(select 1 from public.bookings booking join jsonb_array_elements(v_normalized) item
    on booking.request_id=(item->>'request_id')::uuid) then
    raise exception using errcode='22023',message='batch_item_request_conflict';
  end if;

  insert into public.booking_batches(organization_id,request_id,location_id,service_id,performer_id,
    client_name,client_phone,phone_digits,comment,item_count,items_payload,created_by)
  values(p_organization,p_request_id,p_location,p_service,v_performer,btrim(p_client_name),btrim(p_client_phone),
    v_phone_digits,v_batch_comment,v_count,v_normalized,auth.uid()) returning id into v_batch;

  perform set_config('minuta.booking_organization',p_organization::text,true);
  perform set_config('minuta.booking_location',p_location::text,true);
  begin
    v_position:=0;
    for v_item in select value from jsonb_array_elements(v_normalized) loop
      v_position:=v_position+1;
      v_item_request:=(v_item->>'request_id')::uuid;
      v_date:=(v_item->>'date')::date;
      v_time:=(v_item->>'time')::time without time zone;
      v_item_comment:=v_item->>'comment';
      select result.booking_code,result.manage_token into v_code,v_token
      from public.book_appointment(v_item_request,p_service,v_date,v_time,btrim(p_client_name),btrim(p_client_phone)) result;
      select booking.id into v_booking_id from public.bookings booking
      where booking.request_id=v_item_request and booking.organization_id=p_organization and booking.location_id=p_location;
      if v_booking_id is null then raise exception using errcode='P0001',message='batch_booking_link_failed'; end if;
      update public.bookings set provider_note=concat_ws(E'\n',nullif(v_batch_comment,''),nullif(v_item_comment,'')) where id=v_booking_id;
      insert into public.booking_batch_items(batch_id,organization_id,position,request_id,booking_id,booking_date,booking_time,comment,booking_code)
      values(v_batch,p_organization,v_position,v_item_request,v_booking_id,v_date,v_time,v_item_comment,v_code);
      v_created:=v_created||jsonb_build_array(jsonb_build_object('booking_id',v_booking_id,'position',v_position,'date',v_date,
        'time',v_time,'comment',v_item_comment,'booking_code',v_code));
    end loop;
  exception when others then
    perform set_config('minuta.booking_organization',coalesce(v_previous_organization,''),true);
    perform set_config('minuta.booking_location',coalesce(v_previous_location,''),true);
    raise;
  end;
  perform set_config('minuta.booking_organization',coalesce(v_previous_organization,''),true);
  perform set_config('minuta.booking_location',coalesce(v_previous_location,''),true);

  insert into public.booking_batch_audit_log(organization_id,actor_id,action,batch_id,details)
  values(p_organization,auth.uid(),'batch_created',v_batch,jsonb_build_object('item_count',v_count,'service_id',p_service,
    'location_id',p_location,'performer_id',v_performer));
  return jsonb_build_object('batch_id',v_batch,'created_count',v_count,'idempotent',false,'created',v_created);
exception
  when exclusion_violation then
    raise exception using errcode='P0001',message='batch_slot_unavailable';
  when unique_violation then
    raise exception using errcode='P0001',message='batch_booking_conflict';
end $$;

do $$ declare v_signature regprocedure;
begin
  foreach v_signature in array array[
    'public.set_minuta_batch_bookings_enabled(uuid,boolean,integer)'::regprocedure,
    'public.get_minuta_batch_booking_workspace(uuid)'::regprocedure,
    'public.create_minuta_batch_bookings(uuid,uuid,uuid,text,text,jsonb,uuid,text)'::regprocedure
  ] loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',v_signature);
    execute format('grant execute on function %s to authenticated',v_signature);
  end loop;
end $$;

commit;
