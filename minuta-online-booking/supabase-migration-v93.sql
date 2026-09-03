begin;
set local search_path = public, extensions, pg_catalog;

do $$ begin
  if to_regclass('public.bookings') is null or to_regclass('public.booking_outcomes') is null
     or to_regclass('public.services') is null
     or to_regclass('public.organization_memberships') is null or to_regclass('public.performer_profiles') is null
     or to_regprocedure('public.is_organization_member(uuid)') is null
     or to_regprocedure('public.has_organization_role(uuid,text[])') is null
     or to_regprocedure('public.get_minuta_team_analytics(date,date)') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema='public' and table_name='bookings' and column_name='booking_source'
     ) then
    raise exception using errcode='P0001',message='v93_requires_v92';
  end if;
end $$;

create table if not exists public.booking_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  booking_id uuid not null references public.bookings(id) on delete restrict,
  performer_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type in ('booking_created_online','booking_created_manual','booking_created_admin','booking_updated','booking_rescheduled','booking_cancelled','booking_restored','service_changed','performer_changed','duration_changed','visit_completed','visit_no_show','visit_reopened','payment_received','payment_adjusted','payment_method_changed')),
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_role text not null default 'client' check (actor_role in ('client','specialist','admin','owner','system')),
  previous_booking_date date,
  booking_date date not null,
  delta_planned_rub integer not null default 0,
  delta_completed_rub integer not null default 0,
  delta_received_rub integer not null default 0,
  delta_duration_minutes integer not null default 0,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default clock_timestamp()
);
create index if not exists booking_events_scope_time_v93_idx on public.booking_events(organization_id,occurred_at desc,id desc);
create index if not exists booking_events_scope_date_v93_idx on public.booking_events(organization_id,booking_date,occurred_at desc);
create index if not exists booking_events_booking_v93_idx on public.booking_events(booking_id,occurred_at desc,id desc);
alter table public.booking_events enable row level security;
drop policy if exists booking_events_member_read_v93 on public.booking_events;
create policy booking_events_member_read_v93 on public.booking_events for select to authenticated using(public.has_organization_role(organization_id,array['owner','admin']) or (public.is_organization_member(organization_id) and performer_id=auth.uid()));
revoke all on table public.booking_events from public,anon,authenticated,service_role;
grant select on table public.booking_events to authenticated;
grant all on table public.booking_events to service_role;
revoke all on sequence public.booking_events_id_seq from public,anon,authenticated;
grant all on sequence public.booking_events_id_seq to service_role;

create or replace function public.minuta_booking_value_v93(p_row jsonb,p_booking uuid)
returns integer language plpgsql stable security definer set search_path to '' as $$
declare v_service uuid; v_service_duration integer; v_service_price integer; v_duration integer:=greatest(coalesce((p_row->>'duration_minutes')::integer,0),0); v_rate integer:=greatest(coalesce((p_row->>'original_price_rub')::integer,0),0);
begin
  begin v_service:=(p_row->>'service_id')::uuid; exception when others then v_service:=null; end;
  select service.duration_minutes,service.price_rub into v_service_duration,v_service_price from public.services service where service.id=v_service;
  if coalesce(v_service_duration,0)=1 then return greatest(coalesce(nullif(v_rate,0),v_service_price,0),0)*greatest(v_duration,1); end if;
  return greatest(coalesce(nullif(v_rate,0),v_service_price,0),0);
end $$;
revoke all on function public.minuta_booking_value_v93(jsonb,uuid) from public,anon,authenticated,service_role;

create or replace function public.capture_minuta_booking_event_v93()
returns trigger language plpgsql security definer set search_path to '' as $$
declare v_event text; v_actor uuid:=auth.uid(); v_role text; v_old_value integer:=0; v_new_value integer:=0;
begin
  if v_actor is not null then select membership.role into v_role from public.organization_memberships membership where membership.organization_id=new.organization_id and membership.user_id=v_actor and membership.active limit 1; end if;
  v_role:=coalesce(v_role,case when new.booking_source='client_online' then 'client' else 'system' end);
  if tg_op='INSERT' then
    v_event:=case new.booking_source when 'provider_manual' then 'booking_created_manual' when 'admin_manual' then 'booking_created_admin' else 'booking_created_online' end;
    v_new_value:=case when new.status='cancelled' then 0 else public.minuta_booking_value_v93(to_jsonb(new),new.id) end;
  else
    v_old_value:=case when old.status='cancelled' then 0 else public.minuta_booking_value_v93(to_jsonb(old),old.id) end;
    v_new_value:=case when new.status='cancelled' then 0 else public.minuta_booking_value_v93(to_jsonb(new),new.id) end;
    v_event:=case when old.status is distinct from new.status and new.status='cancelled' then 'booking_cancelled' when old.status='cancelled' and new.status is distinct from old.status then 'booking_restored' when old.booking_date is distinct from new.booking_date or old.booking_time is distinct from new.booking_time then 'booking_rescheduled' when old.performer_id is distinct from new.performer_id then 'performer_changed' when old.service_id is distinct from new.service_id then 'service_changed' when old.duration_minutes is distinct from new.duration_minutes then 'duration_changed' else 'booking_updated' end;
    if v_event='booking_updated' and v_old_value=v_new_value then return new; end if;
  end if;
  insert into public.booking_events(organization_id,booking_id,performer_id,event_type,actor_user_id,actor_role,previous_booking_date,booking_date,delta_planned_rub,delta_duration_minutes,details)
  values(new.organization_id,new.id,new.performer_id,v_event,v_actor,v_role,case when tg_op='UPDATE' then old.booking_date end,new.booking_date,v_new_value-v_old_value,case when tg_op='UPDATE' then coalesce(new.duration_minutes,0)-coalesce(old.duration_minutes,0) else coalesce(new.duration_minutes,0) end,jsonb_build_object('old_time',case when tg_op='UPDATE' then old.booking_time end,'new_time',new.booking_time,'old_status',case when tg_op='UPDATE' then old.status end,'new_status',new.status,'old_service_id',case when tg_op='UPDATE' then old.service_id end,'new_service_id',new.service_id,'source',new.booking_source));
  return new;
end $$;
revoke all on function public.capture_minuta_booking_event_v93() from public,anon,authenticated,service_role;
drop trigger if exists bookings_capture_event_v93 on public.bookings;
create trigger bookings_capture_event_v93 after insert or update on public.bookings for each row execute function public.capture_minuta_booking_event_v93();

create or replace function public.capture_minuta_outcome_event_v93()
returns trigger language plpgsql security definer set search_path to '' as $$
declare v_booking public.bookings%rowtype; v_event text; v_old_received integer:=0; v_new_received integer:=0; v_old_completed integer:=0; v_new_completed integer:=0; v_old_minutes integer:=0; v_new_minutes integer:=0; v_actor uuid:=auth.uid(); v_role text;
begin
  select * into v_booking from public.bookings where id=new.booking_id; if v_booking.id is null then return new; end if;
  if v_actor is not null then select membership.role into v_role from public.organization_memberships membership where membership.organization_id=v_booking.organization_id and membership.user_id=v_actor and membership.active limit 1; end if;
  v_role:=coalesce(v_role,'system');
  if tg_op='UPDATE' and old.visit_status='completed' then v_old_received:=greatest(coalesce(old.amount_rub,0),0); v_old_completed:=greatest(coalesce(old.calculated_amount_rub,public.minuta_booking_value_v93(to_jsonb(v_booking),v_booking.id)),0); v_old_minutes:=greatest(coalesce(old.actual_duration_minutes,v_booking.duration_minutes,0),0); end if;
  if new.visit_status='completed' then v_new_received:=greatest(coalesce(new.amount_rub,0),0); v_new_completed:=greatest(coalesce(new.calculated_amount_rub,public.minuta_booking_value_v93(to_jsonb(v_booking),v_booking.id)),0); v_new_minutes:=greatest(coalesce(new.actual_duration_minutes,v_booking.duration_minutes,0),0); end if;
  v_event:=case when (tg_op='INSERT' or old.visit_status is distinct from new.visit_status) and new.visit_status='completed' then 'visit_completed' when (tg_op='INSERT' or old.visit_status is distinct from new.visit_status) and new.visit_status='no_show' then 'visit_no_show' when tg_op='UPDATE' and old.visit_status in ('completed','no_show') and new.visit_status='scheduled' then 'visit_reopened' when v_new_received is distinct from v_old_received and v_old_received=0 and v_new_received>0 then 'payment_received' when v_new_received is distinct from v_old_received then 'payment_adjusted' when tg_op='UPDATE' and old.actual_duration_minutes is distinct from new.actual_duration_minutes then 'duration_changed' when tg_op='UPDATE' and old.payment_method is distinct from new.payment_method then 'payment_method_changed' else null end;
  if v_event is null then return new; end if;
  insert into public.booking_events(organization_id,booking_id,performer_id,event_type,actor_user_id,actor_role,booking_date,delta_completed_rub,delta_received_rub,delta_duration_minutes,details)
  values(v_booking.organization_id,v_booking.id,v_booking.performer_id,v_event,v_actor,v_role,v_booking.booking_date,v_new_completed-v_old_completed,v_new_received-v_old_received,v_new_minutes-v_old_minutes,jsonb_build_object('old_visit_status',case when tg_op='UPDATE' then old.visit_status end,'new_visit_status',new.visit_status,'old_payment_method',case when tg_op='UPDATE' then old.payment_method end,'new_payment_method',new.payment_method,'old_amount_rub',case when tg_op='UPDATE' then old.amount_rub end,'new_amount_rub',new.amount_rub));
  return new;
end $$;
revoke all on function public.capture_minuta_outcome_event_v93() from public,anon,authenticated,service_role;
drop trigger if exists booking_outcomes_capture_event_v93 on public.booking_outcomes;
create trigger booking_outcomes_capture_event_v93 after insert or update on public.booking_outcomes for each row execute function public.capture_minuta_outcome_event_v93();

create or replace function public.get_minuta_booking_events(p_organization uuid,p_start date,p_end date,p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_user uuid:=auth.uid(); v_role text; v_events jsonb;
begin
  if v_user is null then raise exception using errcode='42501',message='authentication_required'; end if;
  if p_organization is null or p_start is null or p_end is null or p_end<p_start or p_end-p_start>3660 or p_limit not between 1 and 500 then raise exception using errcode='22023',message='invalid_event_range'; end if;
  select membership.role into v_role from public.organization_memberships membership where membership.organization_id=p_organization and membership.user_id=v_user and membership.active;
  if v_role not in ('owner','admin','specialist') then raise exception using errcode='42501',message='event_access_denied'; end if;
  select coalesce(jsonb_agg(row_value order by event_time desc,event_id desc),'[]'::jsonb) into v_events from (
    select jsonb_build_object('id',event.id,'event_type',event.event_type,'occurred_at',event.occurred_at,'booking_id',event.booking_id,'booking_date',event.booking_date,'previous_booking_date',event.previous_booking_date,'client_name',coalesce(booking.client_name,'Клиент'),'service_name',coalesce(service.name,'Услуга'),'performer_name',coalesce(performer.display_name,'Мастер'),'actor_name',coalesce(actor.display_name,case event.actor_role when 'client' then 'Клиент' when 'system' then 'Система' else 'Сотрудник' end),'actor_role',event.actor_role,'delta_planned_rub',event.delta_planned_rub,'delta_completed_rub',event.delta_completed_rub,'delta_received_rub',event.delta_received_rub,'delta_duration_minutes',event.delta_duration_minutes,'details',event.details) as row_value,event.occurred_at as event_time,event.id as event_id
    from public.booking_events event join public.bookings booking on booking.id=event.booking_id left join public.services service on service.id=booking.service_id left join public.performer_profiles performer on performer.id=event.performer_id left join public.performer_profiles actor on actor.id=event.actor_user_id
    where event.organization_id=p_organization and (event.booking_date between p_start and p_end or event.previous_booking_date between p_start and p_end) and (v_role in ('owner','admin') or event.performer_id=v_user)
    order by event.occurred_at desc,event.id desc limit p_limit
  ) source;
  return jsonb_build_object('available_since',(select min(occurred_at)::date from public.booking_events where organization_id=p_organization),'events',v_events);
end $$;
revoke all on function public.get_minuta_booking_events(uuid,date,date,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_minuta_booking_events(uuid,date,date,integer) to authenticated;
commit;
