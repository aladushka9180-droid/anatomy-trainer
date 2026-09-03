\set ON_ERROR_STOP on

-- v97 preserves the employee and customer names needed by a ten-year audit trail,
-- and snapshots the performer at the moment a visit is completed.
begin;
set local lock_timeout='5s';
set local statement_timeout='10min';
set local search_path=public,extensions,pg_catalog;

do $$
begin
  if to_regclass('public.bookings') is null
     or to_regclass('public.booking_outcomes') is null
     or to_regclass('public.booking_events') is null
     or to_regclass('public.organization_memberships') is null
     or to_regclass('public.provider_schedule') is null
     or to_regclass('public.provider_days_off') is null
     or to_regclass('public.staff_absences') is null
     or to_regprocedure('public.get_minuta_staff_report_bookings(uuid,date,date,uuid,integer,integer)') is null
     or to_regprocedure('public.get_minuta_team_analytics(uuid,date,date)') is null
     or to_regprocedure('public.import_minuta_clients(uuid,text,jsonb,uuid)') is null then
    raise exception using errcode='P0001',message='v97_requires_v94_v95_v96';
  end if;
end $$;

alter table public.booking_outcomes add column if not exists completed_performer_id uuid;
alter table public.booking_events add column if not exists client_name_snapshot text;
alter table public.booking_events add column if not exists service_name_snapshot text;
alter table public.booking_events add column if not exists performer_name_snapshot text;

create or replace function public.snapshot_minuta_completed_performer_v97()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if new.visit_status='completed'
     and (tg_op='INSERT' or old.visit_status is distinct from 'completed' or new.completed_performer_id is null) then
    select booking.performer_id into new.completed_performer_id
    from public.bookings booking where booking.id=new.booking_id;
  elsif tg_op='UPDATE' and old.visit_status='completed' and new.visit_status='completed' then
    new.completed_performer_id:=old.completed_performer_id;
  elsif new.visit_status is distinct from 'completed' then
    new.completed_performer_id:=null;
  end if;
  return new;
end;
$$;
revoke all on function public.snapshot_minuta_completed_performer_v97() from public,anon,authenticated,service_role;
drop trigger if exists booking_outcomes_snapshot_performer_v97 on public.booking_outcomes;
create trigger booking_outcomes_snapshot_performer_v97
before insert or update of visit_status,completed_performer_id on public.booking_outcomes
for each row execute function public.snapshot_minuta_completed_performer_v97();
drop trigger if exists booking_outcomes_snapshot_performer_v95 on public.booking_outcomes;
drop function if exists public.snapshot_minuta_completed_performer_v95();

create or replace function public.snapshot_minuta_booking_event_v97()
returns trigger language plpgsql security definer set search_path to '' as $$
declare
  v_client_name text;
  v_service_name text;
  v_performer_name text;
begin
  select booking.client_name,service.name
  into v_client_name,v_service_name
  from public.bookings booking
  left join public.services service on service.id=booking.service_id
  where booking.id=new.booking_id;
  select profile.display_name into v_performer_name
  from public.performer_profiles profile where profile.id=new.performer_id;
  new.client_name_snapshot:=coalesce(new.client_name_snapshot,v_client_name,'Клиент');
  new.service_name_snapshot:=coalesce(new.service_name_snapshot,v_service_name,'Услуга');
  new.performer_name_snapshot:=coalesce(new.performer_name_snapshot,v_performer_name,'Мастер');
  return new;
end;
$$;
revoke all on function public.snapshot_minuta_booking_event_v97() from public,anon,authenticated,service_role;
drop trigger if exists booking_events_snapshot_names_v97 on public.booking_events;
create trigger booking_events_snapshot_names_v97
before insert on public.booking_events
for each row execute function public.snapshot_minuta_booking_event_v97();
commit;

-- Backfill in bounded statements so an old installation does not hold one giant
-- row lock set while ten years of history are upgraded.
select format(
  'update public.booking_outcomes outcome set completed_performer_id=booking.performer_id from public.bookings booking where booking.id=outcome.booking_id and outcome.visit_status=''completed'' and outcome.completed_performer_id is null and outcome.booking_id::text between %L and %L',
  min(booking_id::text),max(booking_id::text)
)
from (
  select booking_id,(row_number() over(order by booking_id::text)-1)/1000 batch_no
  from public.booking_outcomes
  where visit_status='completed' and completed_performer_id is null
) source
group by batch_no order by batch_no
\gexec

select format(
  'update public.booking_events event set client_name_snapshot=coalesce(event.client_name_snapshot,(select booking.client_name from public.bookings booking where booking.id=event.booking_id),''Клиент''),service_name_snapshot=coalesce(event.service_name_snapshot,(select service.name from public.bookings booking left join public.services service on service.id=booking.service_id where booking.id=event.booking_id),''Услуга''),performer_name_snapshot=coalesce(event.performer_name_snapshot,(select performer.display_name from public.performer_profiles performer where performer.id=event.performer_id),''Мастер'') where event.id between %s and %s and (event.client_name_snapshot is null or event.service_name_snapshot is null or event.performer_name_snapshot is null)',
  min(id),max(id)
)
from (
  select id,(row_number() over(order by id)-1)/1000 batch_no
  from public.booking_events
  where client_name_snapshot is null or service_name_snapshot is null or performer_name_snapshot is null
) source
group by batch_no order by batch_no
\gexec

begin;
set local lock_timeout='5s';
set local statement_timeout='10min';
set local search_path=public,extensions,pg_catalog;

do $$
declare v_constraint text;
begin
  for v_constraint in
    select constraint_row.conname
    from pg_constraint constraint_row
    where constraint_row.conrelid='public.booking_events'::regclass
      and constraint_row.confrelid='public.bookings'::regclass
      and constraint_row.contype='f'
      and array_length(constraint_row.conkey,1)=1
      and array_length(constraint_row.confkey,1)=1
      and (select attribute_row.attname from pg_attribute attribute_row where attribute_row.attrelid=constraint_row.conrelid and attribute_row.attnum=constraint_row.conkey[1])='booking_id'
      and (select attribute_row.attname from pg_attribute attribute_row where attribute_row.attrelid=constraint_row.confrelid and attribute_row.attnum=constraint_row.confkey[1])='id'
  loop execute format('alter table public.booking_events drop constraint %I',v_constraint); end loop;
end $$;
alter table public.booking_events alter column booking_id drop not null;
alter table public.booking_events
  add constraint booking_events_booking_id_fkey foreign key(booking_id)
  references public.bookings(id) on delete set null not valid;

do $$
begin
  if exists(select 1 from pg_constraint where conrelid='public.booking_outcomes'::regclass and conname='booking_outcomes_completed_performer_id_fkey'
    and not (contype='f' and confrelid='public.performer_profiles'::regclass and confdeltype='n'
      and array_length(conkey,1)=1 and array_length(confkey,1)=1
      and (select attribute_row.attname from pg_attribute attribute_row where attribute_row.attrelid=conrelid and attribute_row.attnum=conkey[1])='completed_performer_id'
      and (select attribute_row.attname from pg_attribute attribute_row where attribute_row.attrelid=confrelid and attribute_row.attnum=confkey[1])='id')) then
    raise exception using errcode='P0001',message='v97_incompatible_completed_performer_fk';
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.booking_outcomes'::regclass and conname='booking_outcomes_completed_performer_id_fkey') then
    alter table public.booking_outcomes add constraint booking_outcomes_completed_performer_id_fkey
      foreign key(completed_performer_id) references public.performer_profiles(id) on delete set null not valid;
  end if;
end $$;
commit;

set lock_timeout='5s';
set statement_timeout='30min';
alter table public.booking_events validate constraint booking_events_booking_id_fkey;
alter table public.booking_outcomes validate constraint booking_outcomes_completed_performer_id_fkey;
reset lock_timeout;
reset statement_timeout;

begin;
set local lock_timeout='5s';
set local statement_timeout='10min';
set local search_path=public,extensions,pg_catalog;

create or replace function public.get_minuta_staff_report_bookings_v97(
  p_organization uuid,p_start date,p_end date,p_performer uuid,p_limit integer,p_offset integer
)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_user uuid:=auth.uid(); v_role text; v_effective uuid; v_bookings jsonb; v_has_more boolean;
begin
  if v_user is null then raise exception using errcode='42501',message='authentication_required'; end if;
  if p_organization is null or p_start is null or p_end is null or p_end<p_start or p_end-p_start>3660
     or p_limit is null or p_limit<1 or p_limit>1000 or p_offset is null or p_offset<0 or p_offset>100000 then
    raise exception using errcode='22023',message='invalid_staff_report_range';
  end if;
  select membership.role into v_role from public.organization_memberships membership
  join public.organizations organization on organization.id=membership.organization_id and organization.status='active'
  where membership.organization_id=p_organization and membership.user_id=v_user and membership.active limit 1;
  if v_role is null then raise exception using errcode='42501',message='organization_access_denied'; end if;
  if v_role in ('owner','admin') then v_effective:=p_performer;
  else
    if p_performer is not null and p_performer<>v_user then raise exception using errcode='42501',message='staff_report_access_denied'; end if;
    v_effective:=v_user;
  end if;
  with page as materialized (
    select booking.id,booking.booking_code,booking.service_id,
      case when outcome.visit_status='completed' then coalesce(outcome.completed_performer_id,booking.performer_id) else booking.performer_id end performer_id,
      booking.client_account_id,booking.client_name,booking.client_phone,booking.booking_date,booking.booking_time,
      booking.duration_minutes,booking.original_price_rub,booking.total_price_rub,booking.status,booking.created_at,
      booking.reschedule_count,booking.deposit_amount_rub,booking.payment_status,booking.booking_source,
      booking.created_by_user_id,booking.created_by_role,service.name service_name,service.price_rub service_price_rub,
      service.duration_minutes service_duration_minutes,outcome.visit_status,outcome.payment_method,outcome.amount_rub,
      outcome.actual_duration_minutes,outcome.calculated_amount_rub,outcome.completion_source
    from public.bookings booking
    left join public.services service on service.id=booking.service_id
    left join public.booking_outcomes outcome on outcome.booking_id=booking.id
    where booking.organization_id=p_organization and booking.booking_date between p_start and p_end
      and (v_effective is null or (case when outcome.visit_status='completed' then coalesce(outcome.completed_performer_id,booking.performer_id) else booking.performer_id end)=v_effective)
    order by booking.booking_date,booking.booking_time,booking.id limit p_limit+1 offset p_offset
  ), account_first as (
    select previous.client_account_id,min(previous.booking_date) first_completed_date
    from public.bookings previous join public.booking_outcomes previous_outcome on previous_outcome.booking_id=previous.id and previous_outcome.visit_status='completed'
    where previous.organization_id=p_organization and previous.status<>'cancelled' and previous.client_account_id in(select distinct candidate.client_account_id from page candidate where candidate.client_account_id is not null)
    group by previous.client_account_id
  ), phone_first as (
    select public.normalize_client_phone(previous.client_phone) normalized_phone,min(previous.booking_date) first_completed_date
    from public.bookings previous join public.booking_outcomes previous_outcome on previous_outcome.booking_id=previous.id and previous_outcome.visit_status='completed'
    where previous.organization_id=p_organization and previous.status<>'cancelled' and previous.client_account_id is null
      and nullif(public.normalize_client_phone(previous.client_phone),'') is not null
      and public.normalize_client_phone(previous.client_phone) in(select distinct public.normalize_client_phone(candidate.client_phone) from page candidate where candidate.client_account_id is null and nullif(public.normalize_client_phone(candidate.client_phone),'') is not null)
    group by public.normalize_client_phone(previous.client_phone)
  ), numbered as (
    select page.*,row_number() over(order by page.booking_date,page.booking_time,page.id) page_number from page
  ), enriched as (
    select numbered.page_number,jsonb_build_object(
      'id',numbered.id,'booking_code',numbered.booking_code,'service_id',numbered.service_id,'performer_id',numbered.performer_id,
      'client_account_id',numbered.client_account_id,'client_name',numbered.client_name,'client_phone',numbered.client_phone,
      'booking_date',numbered.booking_date,'booking_time',numbered.booking_time,'duration_minutes',numbered.duration_minutes,
      'original_price_rub',numbered.original_price_rub,'total_price_rub',numbered.total_price_rub,'status',numbered.status,
      'created_at',numbered.created_at,'reschedule_count',numbered.reschedule_count,'deposit_amount_rub',numbered.deposit_amount_rub,
      'payment_status',numbered.payment_status,'booking_source',numbered.booking_source,'created_by_user_id',numbered.created_by_user_id,
      'created_by_role',numbered.created_by_role,'services',jsonb_build_object('name',numbered.service_name,'price_rub',numbered.service_price_rub,'duration_minutes',numbered.service_duration_minutes),
      'booking_outcomes',jsonb_build_object('visit_status',numbered.visit_status,'payment_method',numbered.payment_method,'amount_rub',numbered.amount_rub,'actual_duration_minutes',numbered.actual_duration_minutes,'calculated_amount_rub',numbered.calculated_amount_rub,'completion_source',numbered.completion_source),
      'client_had_previous',case when numbered.client_account_id is not null then coalesce(account_first.first_completed_date<numbered.booking_date,false) else coalesce(phone_first.first_completed_date<numbered.booking_date,false) end
    ) payload
    from numbered left join account_first on account_first.client_account_id=numbered.client_account_id
    left join phone_first on numbered.client_account_id is null and phone_first.normalized_phone=public.normalize_client_phone(numbered.client_phone)
  )
  select coalesce(jsonb_agg(payload order by page_number) filter(where page_number<=p_limit),'[]'::jsonb),coalesce(bool_or(page_number>p_limit),false)
  into v_bookings,v_has_more from enriched;
  return jsonb_build_object('organization_id',p_organization,'performer_id',v_effective,'can_view_team',v_role in ('owner','admin'),'bookings',v_bookings,'has_more',v_has_more,'next_offset',case when v_has_more then p_offset+p_limit else null end);
end;
$$;
revoke all on function public.get_minuta_staff_report_bookings_v97(uuid,date,date,uuid,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_minuta_staff_report_bookings_v97(uuid,date,date,uuid,integer,integer) to authenticated;

create or replace function public.get_minuta_booking_events_v97(
  p_organization uuid,p_start date,p_end date,p_limit integer,p_offset integer
)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_user uuid:=auth.uid(); v_role text; v_events jsonb; v_has_more boolean;
begin
  if v_user is null then raise exception using errcode='42501',message='authentication_required'; end if;
  if p_organization is null or p_start is null or p_end is null or p_end<p_start or p_end-p_start>3660
     or p_limit is null or p_limit<1 or p_limit>500 or p_offset is null or p_offset<0 or p_offset>100000 then
    raise exception using errcode='22023',message='invalid_event_range';
  end if;
  select membership.role into v_role from public.organization_memberships membership
  where membership.organization_id=p_organization and membership.user_id=v_user and membership.active limit 1;
  if v_role not in ('owner','admin','specialist') then raise exception using errcode='42501',message='event_access_denied'; end if;
  with page as materialized (
    select event.*,booking.client_name,service.name service_name,performer.display_name performer_name,actor.display_name actor_name,
      row_number() over(order by event.occurred_at desc,event.id desc) page_number
    from public.booking_events event
    left join public.bookings booking on booking.id=event.booking_id
    left join public.services service on service.id=booking.service_id
    left join public.performer_profiles performer on performer.id=event.performer_id
    left join public.performer_profiles actor on actor.id=event.actor_user_id
    where event.organization_id=p_organization
      and (event.booking_date between p_start and p_end or event.previous_booking_date between p_start and p_end)
      and (v_role in ('owner','admin') or event.performer_id=v_user)
    order by event.occurred_at desc,event.id desc limit p_limit+1 offset p_offset
  ), payload as (
    select page_number,jsonb_build_object('id',id,'event_type',event_type,'occurred_at',occurred_at,'booking_id',booking_id,
      'booking_date',booking_date,'previous_booking_date',previous_booking_date,'performer_id',performer_id,
      'client_name',coalesce(client_name_snapshot,client_name,'Клиент'),'service_name',coalesce(service_name_snapshot,service_name,'Услуга'),
      'performer_name',coalesce(performer_name_snapshot,performer_name,'Мастер'),'actor_name',coalesce(actor_name,case actor_role when 'client' then 'Клиент' when 'system' then 'Система' else 'Сотрудник' end),
      'actor_role',actor_role,'delta_planned_rub',delta_planned_rub,'delta_completed_rub',delta_completed_rub,
      'delta_received_rub',delta_received_rub,'delta_duration_minutes',delta_duration_minutes,'details',details) row_value
    from page
  )
  select coalesce(jsonb_agg(row_value order by page_number) filter(where page_number<=p_limit),'[]'::jsonb),coalesce(bool_or(page_number>p_limit),false)
  into v_events,v_has_more from payload;
  return jsonb_build_object('available_since',(select min(occurred_at)::date from public.booking_events where organization_id=p_organization),
    'events',v_events,'has_more',v_has_more,'next_offset',case when v_has_more then p_offset+p_limit else null end);
end;
$$;
revoke all on function public.get_minuta_booking_events_v97(uuid,date,date,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_minuta_booking_events_v97(uuid,date,date,integer,integer) to authenticated;

create or replace function public.get_minuta_staff_report_availability(p_organization uuid,p_start date,p_end date,p_performer uuid default null)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_user uuid:=auth.uid(); v_role text; v_effective uuid; v_available bigint:=0; v_total integer:=0; v_configured integer:=0;
begin
  if v_user is null then raise exception using errcode='42501',message='authentication_required'; end if;
  if p_organization is null or p_start is null or p_end is null or p_end<p_start or p_end-p_start>3660 then raise exception using errcode='22023',message='invalid_staff_availability_range'; end if;
  select membership.role into v_role from public.organization_memberships membership where membership.organization_id=p_organization and membership.user_id=v_user and membership.active limit 1;
  if v_role is null then raise exception using errcode='42501',message='organization_access_denied'; end if;
  if v_role in ('owner','admin') then v_effective:=p_performer; else if p_performer is not null and p_performer<>v_user then raise exception using errcode='42501',message='staff_report_access_denied'; end if; v_effective:=v_user; end if;
  with performers as (
    select membership.user_id performer_id from public.organization_memberships membership
    where membership.organization_id=p_organization and membership.active and membership.is_bookable and (v_effective is null or membership.user_id=v_effective)
  ), configured as (
    select performer.performer_id,exists(select 1 from public.provider_schedule schedule where schedule.performer_id=performer.performer_id) has_schedule from performers performer
  ) select count(*),count(*) filter(where has_schedule) into v_total,v_configured from configured;
  with performers as (
    select membership.user_id performer_id from public.organization_memberships membership
    where membership.organization_id=p_organization and membership.active and membership.is_bookable and (v_effective is null or membership.user_id=v_effective)
  ), days as (
    select performer.performer_id,day_value::date work_date from performers performer cross join generate_series(p_start::timestamp,p_end::timestamp,interval '1 day') day_value
  ), scheduled as (
    select days.performer_id,days.work_date,schedule.start_time,schedule.end_time,schedule.break_start,schedule.break_end
    from days join public.provider_schedule schedule on schedule.performer_id=days.performer_id and schedule.weekday=extract(isodow from days.work_date)::integer
    where schedule.enabled and schedule.end_time>schedule.start_time
  )
  select coalesce(sum(case
    when exists(select 1 from public.staff_absences absence where absence.organization_id=p_organization and absence.performer_id=scheduled.performer_id and absence.active and scheduled.work_date between absence.starts_on and absence.ends_on) then 0
    when exists(select 1 from public.provider_days_off offday where offday.performer_id=scheduled.performer_id and offday.off_date=scheduled.work_date and offday.all_day) then 0
    else greatest(0,extract(epoch from(scheduled.end_time-scheduled.start_time))/60
      -case when scheduled.break_start is not null and scheduled.break_end is not null and scheduled.break_end>scheduled.break_start then extract(epoch from(least(scheduled.end_time,scheduled.break_end)-greatest(scheduled.start_time,scheduled.break_start)))/60 else 0 end
      -coalesce((select sum(greatest(0,extract(epoch from(least(scheduled.end_time,offday.end_time)-greatest(scheduled.start_time,offday.start_time)))/60)) from public.provider_days_off offday where offday.performer_id=scheduled.performer_id and offday.off_date=scheduled.work_date and not offday.all_day and offday.start_time is not null and offday.end_time is not null),0)) end),0)::bigint
  into v_available from scheduled;
  return jsonb_build_object('available_minutes',v_available,'configured_performers',v_configured,'total_performers',v_total,'complete',v_total=v_configured);
end;
$$;
revoke all on function public.get_minuta_staff_report_availability(uuid,date,date,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_minuta_staff_report_availability(uuid,date,date,uuid) to authenticated;

-- Historical team metrics use the completion snapshot, not today's assignee.
create or replace function public.get_minuta_team_analytics(p_organization uuid,p_start date,p_end date)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_user uuid:=auth.uid(); v_role text; v_payroll_period uuid; v_payroll_period_count integer; v_performers jsonb;
begin
  if v_user is null then raise exception using errcode='42501',message='authentication_required'; end if;
  if p_organization is null or p_start is null or p_end is null or p_end<p_start or p_end-p_start>3660 then raise exception using errcode='22023',message='invalid_analytics_range'; end if;
  select membership.role into v_role from public.organization_memberships membership join public.organizations organization on organization.id=membership.organization_id and organization.status='active' where membership.organization_id=p_organization and membership.user_id=v_user and membership.active;
  if v_role is null or v_role not in('owner','admin') then return jsonb_build_object('can_view_team',false,'performers','[]'::jsonb); end if;
  select count(*),min(period.id::text)::uuid into v_payroll_period_count,v_payroll_period from public.payroll_periods period where period.organization_id=p_organization and period.location_id is null and period.starts_on=p_start and period.ends_on=p_end and period.status in('approved','paid');
  if v_payroll_period_count<>1 then v_payroll_period:=null; end if;
  with completed as (
    select booking.id,coalesce(outcome.completed_performer_id,booking.performer_id) performer_id,
      case when booking.client_account_id is not null then 'account:'||booking.client_account_id::text when nullif(public.normalize_client_phone(booking.client_phone),'') is not null then 'phone:'||public.normalize_client_phone(booking.client_phone) else null end client_key,
      greatest(coalesce(outcome.actual_duration_minutes,booking.duration_minutes,0),0)::bigint worked_minutes,
      greatest(coalesce(outcome.amount_rub,0),0)::bigint revenue_rub
    from public.bookings booking join public.booking_outcomes outcome on outcome.booking_id=booking.id
    where booking.organization_id=p_organization and booking.booking_date between p_start and p_end and outcome.visit_status='completed'
  ), metrics as (
    select performer_id,count(distinct id)::bigint completed_visits,count(distinct client_key)::bigint unique_clients,
      coalesce(sum(worked_minutes),0)::bigint worked_minutes,coalesce(sum(revenue_rub),0)::bigint revenue_rub from completed group by performer_id
  ), team_performers as (
    select membership.user_id performer_id from public.organization_memberships membership where membership.organization_id=p_organization and membership.active and membership.is_bookable
    union select completed.performer_id from completed
  )
  select coalesce(jsonb_agg(jsonb_build_object('performer_id',team.performer_id,'performer_name',coalesce(profile.display_name,'Специалист'),
    'completed_visits',coalesce(metrics.completed_visits,0),'unique_clients',coalesce(metrics.unique_clients,0),'worked_minutes',coalesce(metrics.worked_minutes,0),
    'revenue_rub',coalesce(metrics.revenue_rub,0),'payroll_rub',case when v_payroll_period is null then null else
      coalesce((select sum(item.payroll_rub)::bigint from public.payroll_items item where item.period_id=v_payroll_period and item.performer_id=team.performer_id),0)
      +coalesce((select sum(adjustment.amount_rub)::bigint from public.payroll_adjustments adjustment where adjustment.period_id=v_payroll_period and adjustment.performer_id=team.performer_id),0) end)
    order by coalesce(metrics.revenue_rub,0) desc,coalesce(profile.display_name,''),team.performer_id),'[]'::jsonb)
  into v_performers from team_performers team left join public.performer_profiles profile on profile.id=team.performer_id left join metrics on metrics.performer_id=team.performer_id;
  return jsonb_build_object('can_view_team',true,'organization_id',p_organization,'period',jsonb_build_object('start',p_start,'end',p_end),'payroll_period_id',v_payroll_period,'performers',v_performers);
end;
$$;
revoke all on function public.get_minuta_team_analytics(uuid,date,date) from public,anon,authenticated,service_role;
grant execute on function public.get_minuta_team_analytics(uuid,date,date) to authenticated;
drop function if exists public.get_minuta_staff_report_bookings_v95(uuid,date,date,uuid);
commit;

-- MINUTA_CONCURRENT_INDEXES_BEGIN
select format('drop index concurrently if exists %I.%I',namespace_row.nspname,index_class.relname)
from pg_class index_class join pg_namespace namespace_row on namespace_row.oid=index_class.relnamespace join pg_index index_row on index_row.indexrelid=index_class.oid
where namespace_row.nspname='public' and index_class.relname='booking_outcomes_completed_performer_v97_idx' and(not index_row.indisvalid or not index_row.indisready)
\gexec

do $$
begin
  if exists(select 1 from pg_class index_class join pg_namespace namespace_row on namespace_row.oid=index_class.relnamespace join pg_index index_row on index_row.indexrelid=index_class.oid
    where namespace_row.nspname='public' and index_class.relname='booking_outcomes_completed_performer_v97_idx'
      and regexp_replace(lower(pg_get_indexdef(index_row.indexrelid)),'\s','','g')<>'createindexbooking_outcomes_completed_performer_v97_idxonpublic.booking_outcomesusingbtree(completed_performer_id)where(visit_status=''completed''::text)') then
    raise exception using errcode='P0001',message='v97_incompatible_existing_index';
  end if;
end $$;

set lock_timeout='5s';
set statement_timeout='30min';
create index concurrently if not exists booking_outcomes_completed_performer_v97_idx
  on public.booking_outcomes(completed_performer_id) where visit_status='completed';
drop index concurrently if exists public.booking_outcomes_completed_performer_v95_idx;
reset lock_timeout;
reset statement_timeout;
