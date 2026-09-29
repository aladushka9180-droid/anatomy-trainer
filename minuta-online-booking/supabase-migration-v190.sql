-- A04: expose the canonical schedule-block flag, omit blocks from the substitution list,
-- and reject direct substitution of a schedule block. Keep existing function signatures.
begin;

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
    'bookings',coalesce((select jsonb_agg(jsonb_build_object('id',booking.id,'booking_code',booking.booking_code,'location_id',booking.location_id,'performer_id',booking.performer_id,'service_id',booking.service_id,'booking_date',booking.booking_date,'booking_time',booking.booking_time,'duration_minutes',booking.duration_minutes,'primary_duration_minutes',coalesce((select item.duration_minutes from public.booking_session_items item where item.booking_id=booking.id and item.item_kind='primary' order by item.position,item.id limit 1),service.duration_minutes),'has_addons',exists(select 1 from public.booking_session_items item where item.booking_id=booking.id and item.item_kind='addon'),'service_name',service.name,'is_schedule_block',coalesce(booking.booking_policy_snapshot @> '{"schedule_block":true}'::jsonb,false),'status',booking.status) order by booking.booking_date,booking.booking_time,booking.id)
      from public.bookings booking join public.services service on service.id=booking.service_id
      where booking.organization_id=p_organization and booking.booking_date between p_start and p_end and booking.status<>'cancelled' and not coalesce(booking.booking_policy_snapshot @> '{"schedule_block":true}'::jsonb,false)
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

create or replace function public.substitute_minuta_booking(p_organization uuid,p_booking uuid,p_new_service uuid)
returns boolean language plpgsql security definer set search_path to '' as $$
declare v_role text; v_booking public.bookings%rowtype; v_performer uuid; v_primary_duration integer;
begin
  v_role:=public.get_minuta_schedule_role(p_organization);
  perform pg_advisory_xact_lock(hashtextextended(p_booking::text,7302));
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text,7100));
  if v_role not in ('owner','admin') then raise exception using errcode='42501', message='booking_substitution_denied'; end if;
  select * into v_booking from public.bookings where id=p_booking and organization_id=p_organization and status<>'cancelled' for update;
  if v_booking.id is null then raise exception using errcode='P0001', message='booking_not_found'; end if;
  if coalesce(v_booking.booking_policy_snapshot @> '{"schedule_block":true}'::jsonb,false) then
    raise exception using errcode='55000', message='schedule_block_substitution_denied';
  end if;
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

revoke all on function public.substitute_minuta_booking(uuid,uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.substitute_minuta_booking(uuid,uuid,uuid) to authenticated;

commit;
