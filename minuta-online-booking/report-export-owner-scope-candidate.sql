-- Integration candidate only. Assign a migration number after fresh-main reconciliation.
-- Existing v97 remains available; replacing its raw-phone contract is a separate compatibility gate.
create or replace function public.get_minuta_report_export_bookings(
  p_organization uuid, p_start date, p_end date, p_performer uuid,
  p_location uuid, p_phone_mode text, p_limit integer, p_offset integer
)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_performer uuid;
  v_bookings jsonb;
  v_has_more boolean;
begin
  if v_actor is null then raise exception using errcode='42501', message='authentication_required'; end if;
  if p_organization is null or p_start is null or p_end is null or p_end < p_start or p_end - p_start > 3660
     or p_phone_mode not in ('none','masked','full') or p_phone_mode is null
     or p_limit is null or p_limit < 1 or p_limit > 1000 or p_offset is null or p_offset < 0 or p_offset > 100000 then
    raise exception using errcode='22023', message='invalid_report_export_scope';
  end if;
  select membership.role into v_role from public.organization_memberships membership
  join public.organizations organization on organization.id=membership.organization_id and organization.status='active'
  where membership.organization_id=p_organization and membership.user_id=v_actor and membership.active limit 1;
  if v_role is null then raise exception using errcode='42501', message='organization_access_denied'; end if;
  if p_phone_mode='full' and v_role<>'owner' then
    raise exception using errcode='42501', message='full_phone_export_owner_required';
  end if;
  if p_location is not null and not exists (
    select 1 from public.locations location where location.id=p_location and location.organization_id=p_organization and location.active
  ) then raise exception using errcode='22023', message='invalid_report_export_location'; end if;
  if v_role in ('owner','admin') then v_performer:=p_performer;
  else
    if p_performer is not null and p_performer<>v_actor then
      raise exception using errcode='42501', message='staff_report_access_denied';
    end if;
    v_performer:=v_actor;
  end if;

  with page as materialized (
    select booking.id,booking.organization_id,booking.location_id,booking.booking_code,booking.service_id,
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
      and (p_location is null or booking.location_id=p_location)
      and (v_performer is null or (case when outcome.visit_status='completed' then coalesce(outcome.completed_performer_id,booking.performer_id) else booking.performer_id end)=v_performer)
    order by booking.booking_date,booking.booking_time,booking.id limit p_limit+1 offset p_offset
  ), numbered as (
    select page.*,row_number() over(order by page.booking_date,page.booking_time,page.id) page_number from page
  ), enriched as (
    select numbered.page_number,jsonb_build_object(
      'id',numbered.id,'organization_id',numbered.organization_id,'location_id',numbered.location_id,
      'booking_code',numbered.booking_code,'service_id',numbered.service_id,'performer_id',numbered.performer_id,
      'client_account_id',numbered.client_account_id,'client_name',numbered.client_name,
      'client_phone',case
        when p_phone_mode='none' then ''
        when p_phone_mode='masked' then case when length(public.normalize_client_phone(numbered.client_phone))>=4
          then '+7 *** ***-' || substr(right(public.normalize_client_phone(numbered.client_phone),4),1,2)
            || '-' || right(public.normalize_client_phone(numbered.client_phone),2) else '' end
        else numbered.client_phone end,
      'booking_date',numbered.booking_date,'booking_time',numbered.booking_time,'duration_minutes',numbered.duration_minutes,
      'original_price_rub',numbered.original_price_rub,'total_price_rub',numbered.total_price_rub,'status',numbered.status,
      'created_at',numbered.created_at,'reschedule_count',numbered.reschedule_count,'deposit_amount_rub',numbered.deposit_amount_rub,
      'payment_status',numbered.payment_status,'booking_source',numbered.booking_source,'created_by_user_id',numbered.created_by_user_id,
      'created_by_role',numbered.created_by_role,
      'services',jsonb_build_object('name',numbered.service_name,'price_rub',numbered.service_price_rub,'duration_minutes',numbered.service_duration_minutes),
      'booking_outcomes',jsonb_build_object('visit_status',numbered.visit_status,'payment_method',numbered.payment_method,
        'amount_rub',numbered.amount_rub,'actual_duration_minutes',numbered.actual_duration_minutes,
        'calculated_amount_rub',numbered.calculated_amount_rub,'completion_source',numbered.completion_source),
      'client_had_previous',exists (
        select 1 from public.bookings previous
        join public.booking_outcomes previous_outcome on previous_outcome.booking_id=previous.id and previous_outcome.visit_status='completed'
        where previous.organization_id=p_organization and previous.status<>'cancelled' and previous.booking_date<numbered.booking_date
          and (numbered.client_account_id is not null and previous.client_account_id=numbered.client_account_id
            or numbered.client_account_id is null and previous.client_account_id is null
              and nullif(public.normalize_client_phone(numbered.client_phone),'') is not null
              and public.normalize_client_phone(previous.client_phone)=public.normalize_client_phone(numbered.client_phone))
      )
    ) payload from numbered
  )
  select coalesce(jsonb_agg(payload order by page_number) filter(where page_number<=p_limit),'[]'::jsonb),
    coalesce(bool_or(page_number>p_limit),false) into v_bookings,v_has_more from enriched;
  return jsonb_build_object('organization_id',p_organization,'location_id',p_location,
    'performer_id',v_performer,'phone_mode',p_phone_mode,'bookings',v_bookings,'has_more',v_has_more,
    'next_offset',case when v_has_more then p_offset+p_limit else null end);
end;
$$;
revoke all on function public.get_minuta_report_export_bookings(uuid,date,date,uuid,uuid,text,integer,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.get_minuta_report_export_bookings(uuid,date,date,uuid,uuid,text,integer,integer)
  to authenticated;
