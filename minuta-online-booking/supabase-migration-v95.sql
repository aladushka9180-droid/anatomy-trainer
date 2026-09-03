begin;
set local search_path = public, extensions, pg_catalog;

alter table public.booking_outcomes add column if not exists completed_performer_id uuid references public.performer_profiles(id) on delete set null;

create or replace function public.snapshot_minuta_completed_performer_v95()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if new.visit_status='completed' and (tg_op='INSERT' or old.visit_status is distinct from 'completed' or new.completed_performer_id is null) then
    select booking.performer_id into new.completed_performer_id from public.bookings booking where booking.id=new.booking_id;
  elsif tg_op='UPDATE' and old.visit_status='completed' and new.visit_status='completed' then
    new.completed_performer_id:=old.completed_performer_id;
  end if;
  return new;
end; $$;
revoke all on function public.snapshot_minuta_completed_performer_v95() from public,anon,authenticated,service_role;
drop trigger if exists booking_outcomes_snapshot_performer_v95 on public.booking_outcomes;
create trigger booking_outcomes_snapshot_performer_v95 before insert or update of visit_status,completed_performer_id on public.booking_outcomes for each row execute function public.snapshot_minuta_completed_performer_v95();
update public.booking_outcomes outcome set completed_performer_id=booking.performer_id from public.bookings booking where booking.id=outcome.booking_id and outcome.visit_status='completed' and outcome.completed_performer_id is null;
create index if not exists booking_outcomes_completed_performer_v95_idx on public.booking_outcomes(completed_performer_id) where visit_status='completed';

create or replace function public.get_minuta_staff_report_bookings_v95(p_organization uuid,p_start date,p_end date,p_performer uuid default null)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_user uuid:=auth.uid(); v_role text; v_effective_performer uuid; v_bookings jsonb;
begin
  if v_user is null then raise exception using errcode='42501',message='authentication_required'; end if;
  if p_organization is null or p_start is null or p_end is null or p_end<p_start or p_end-p_start>3660 then raise exception using errcode='22023',message='invalid_staff_report_range'; end if;
  select membership.role into v_role from public.organization_memberships membership join public.organizations organization on organization.id=membership.organization_id and organization.status='active' where membership.organization_id=p_organization and membership.user_id=v_user and membership.active limit 1;
  if v_role is null then raise exception using errcode='42501',message='organization_access_denied'; end if;
  if v_role in ('owner','admin') then v_effective_performer:=p_performer; else if p_performer is not null and p_performer<>v_user then raise exception using errcode='42501',message='staff_report_access_denied'; end if; v_effective_performer:=v_user; end if;
  select coalesce(jsonb_agg(to_jsonb(booking)||jsonb_build_object('performer_id',coalesce(outcome.completed_performer_id,booking.performer_id),'services',coalesce(to_jsonb(service),'{}'::jsonb),'booking_outcomes',coalesce(to_jsonb(outcome),'{}'::jsonb),'client_had_previous',exists(select 1 from public.bookings previous join public.booking_outcomes previous_outcome on previous_outcome.booking_id=previous.id and previous_outcome.visit_status='completed' where previous.organization_id=booking.organization_id and previous.booking_date<booking.booking_date and previous.status<>'cancelled' and ((booking.client_account_id is not null and previous.client_account_id=booking.client_account_id) or (booking.client_account_id is null and nullif(regexp_replace(coalesce(booking.client_phone,''),'[^0-9]','','g'),'') is not null and regexp_replace(coalesce(previous.client_phone,''),'[^0-9]','','g')=regexp_replace(coalesce(booking.client_phone,''),'[^0-9]','','g'))))) order by booking.booking_date,booking.booking_time,booking.id),'[]'::jsonb) into v_bookings from public.bookings booking left join public.services service on service.id=booking.service_id left join public.booking_outcomes outcome on outcome.booking_id=booking.id where booking.organization_id=p_organization and booking.booking_date between p_start and p_end and (v_effective_performer is null or coalesce(outcome.completed_performer_id,booking.performer_id)=v_effective_performer);
  return jsonb_build_object('organization_id',p_organization,'performer_id',v_effective_performer,'can_view_team',v_role in ('owner','admin'),'bookings',v_bookings);
end; $$;
revoke all on function public.get_minuta_staff_report_bookings_v95(uuid,date,date,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_minuta_staff_report_bookings_v95(uuid,date,date,uuid) to authenticated;

create or replace function public.get_minuta_staff_report_availability(p_organization uuid,p_start date,p_end date,p_performer uuid default null)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_user uuid:=auth.uid(); v_role text; v_effective uuid; v_available bigint:=0; v_total integer:=0; v_configured integer:=0;
begin
  if v_user is null then raise exception using errcode='42501',message='authentication_required'; end if;
  if p_organization is null or p_start is null or p_end is null or p_end<p_start or p_end-p_start>3660 then raise exception using errcode='22023',message='invalid_staff_availability_range'; end if;
  select membership.role into v_role from public.organization_memberships membership where membership.organization_id=p_organization and membership.user_id=v_user and membership.active limit 1;
  if v_role is null then raise exception using errcode='42501',message='organization_access_denied'; end if;
  if v_role in ('owner','admin') then v_effective:=p_performer; else if p_performer is not null and p_performer<>v_user then raise exception using errcode='42501',message='staff_report_access_denied'; end if; v_effective:=v_user; end if;
  with performers as (select membership.user_id as performer_id from public.organization_memberships membership where membership.organization_id=p_organization and membership.active and membership.is_bookable and (v_effective is null or membership.user_id=v_effective)), configured as (select performer.performer_id,exists(select 1 from public.provider_schedule schedule where schedule.performer_id=performer.performer_id) as has_schedule from performers performer) select count(*),count(*) filter(where has_schedule) into v_total,v_configured from configured;
  with performers as (select membership.user_id as performer_id from public.organization_memberships membership where membership.organization_id=p_organization and membership.active and membership.is_bookable and (v_effective is null or membership.user_id=v_effective)), days as (select performer.performer_id,day_value::date as work_date from performers performer cross join generate_series(p_start::timestamp,p_end::timestamp,interval '1 day') day_value), scheduled as (select days.performer_id,days.work_date,schedule.start_time,schedule.end_time,schedule.break_start,schedule.break_end from days join public.provider_schedule schedule on schedule.performer_id=days.performer_id and schedule.weekday=extract(isodow from days.work_date)::integer where schedule.enabled and schedule.end_time>schedule.start_time)
  select coalesce(sum(case when exists(select 1 from public.staff_absences absence where absence.organization_id=p_organization and absence.performer_id=scheduled.performer_id and absence.active and scheduled.work_date between absence.starts_on and absence.ends_on) then 0 when exists(select 1 from public.provider_days_off offday where offday.performer_id=scheduled.performer_id and offday.off_date=scheduled.work_date and offday.all_day) then 0 else greatest(0,extract(epoch from (scheduled.end_time-scheduled.start_time))/60-case when scheduled.break_start is not null and scheduled.break_end is not null and scheduled.break_end>scheduled.break_start then extract(epoch from (least(scheduled.end_time,scheduled.break_end)-greatest(scheduled.start_time,scheduled.break_start)))/60 else 0 end-coalesce((select sum(greatest(0,extract(epoch from (least(scheduled.end_time,offday.end_time)-greatest(scheduled.start_time,offday.start_time)))/60)) from public.provider_days_off offday where offday.performer_id=scheduled.performer_id and offday.off_date=scheduled.work_date and not offday.all_day and offday.start_time is not null and offday.end_time is not null),0)) end),0)::bigint into v_available from scheduled;
  return jsonb_build_object('available_minutes',v_available,'configured_performers',v_configured,'total_performers',v_total,'complete',v_total=v_configured);
end; $$;
revoke all on function public.get_minuta_staff_report_availability(uuid,date,date,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_minuta_staff_report_availability(uuid,date,date,uuid) to authenticated;
commit;
