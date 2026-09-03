begin;
set local search_path = public, extensions, pg_catalog;

do $$
begin
  if to_regclass('public.bookings') is null
     or to_regclass('public.booking_outcomes') is null
     or to_regclass('public.services') is null
     or to_regclass('public.organizations') is null
     or to_regclass('public.organization_memberships') is null
     or to_regprocedure('public.get_minuta_booking_events(uuid,date,date,integer)') is null then
    raise exception using errcode='P0001',message='v94_requires_v93';
  end if;
end $$;

drop function if exists public.get_minuta_staff_report_bookings(uuid,date,date,uuid);

create or replace function public.get_minuta_staff_report_bookings(
  p_organization uuid,
  p_start date,
  p_end date,
  p_performer uuid,
  p_limit integer,
  p_offset integer
)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  v_user uuid:=auth.uid();
  v_role text;
  v_effective_performer uuid;
  v_bookings jsonb;
  v_has_more boolean;
begin
  if v_user is null then raise exception using errcode='42501',message='authentication_required'; end if;
  if p_organization is null or p_start is null or p_end is null or p_end<p_start or p_end-p_start>3660
     or p_limit is null or p_limit<1 or p_limit>1000 or p_offset is null or p_offset<0 or p_offset>100000 then
    raise exception using errcode='22023',message='invalid_staff_report_range';
  end if;
  select membership.role into v_role from public.organization_memberships membership join public.organizations organization on organization.id=membership.organization_id and organization.status='active' where membership.organization_id=p_organization and membership.user_id=v_user and membership.active limit 1;
  if v_role is null then raise exception using errcode='42501',message='organization_access_denied'; end if;
  if v_role in ('owner','admin') then v_effective_performer:=p_performer; else if p_performer is not null and p_performer<>v_user then raise exception using errcode='42501',message='staff_report_access_denied'; end if; v_effective_performer:=v_user; end if;
  with page as materialized (
    select booking.id,booking.booking_code,booking.service_id,booking.performer_id,
      booking.client_account_id,booking.client_name,booking.client_phone,
      booking.booking_date,booking.booking_time,booking.duration_minutes,
      booking.original_price_rub,booking.total_price_rub,booking.status,
      booking.created_at,booking.reschedule_count,booking.deposit_amount_rub,
      booking.payment_status,booking.booking_source,booking.created_by_user_id,
      booking.created_by_role,service.name service_name,
      service.price_rub service_price_rub,service.duration_minutes service_duration_minutes,
      outcome.visit_status,outcome.payment_method,outcome.amount_rub,
      outcome.actual_duration_minutes,outcome.calculated_amount_rub,outcome.completion_source
    from public.bookings booking
    left join public.services service on service.id=booking.service_id
    left join public.booking_outcomes outcome on outcome.booking_id=booking.id
    where booking.organization_id=p_organization
      and booking.booking_date between p_start and p_end
      and (v_effective_performer is null or booking.performer_id=v_effective_performer)
    order by booking.booking_date,booking.booking_time,booking.id
    limit p_limit+1 offset p_offset
  ), account_first as (
    select previous.client_account_id,min(previous.booking_date) first_completed_date
    from public.bookings previous
    join public.booking_outcomes previous_outcome
      on previous_outcome.booking_id=previous.id and previous_outcome.visit_status='completed'
    where previous.organization_id=p_organization
      and previous.status<>'cancelled'
      and previous.client_account_id in (
        select distinct candidate.client_account_id from page candidate where candidate.client_account_id is not null
      )
    group by previous.client_account_id
  ), phone_first as (
    select regexp_replace(coalesce(previous.client_phone,''),'[^0-9]','','g') normalized_phone,
      min(previous.booking_date) first_completed_date
    from public.bookings previous
    join public.booking_outcomes previous_outcome
      on previous_outcome.booking_id=previous.id and previous_outcome.visit_status='completed'
    where previous.organization_id=p_organization
      and previous.status<>'cancelled'
      and previous.client_account_id is null
      and regexp_replace(coalesce(previous.client_phone,''),'[^0-9]','','g') in (
        select distinct regexp_replace(coalesce(candidate.client_phone,''),'[^0-9]','','g')
        from page candidate
        where candidate.client_account_id is null
          and nullif(regexp_replace(coalesce(candidate.client_phone,''),'[^0-9]','','g'),'') is not null
      )
    group by regexp_replace(coalesce(previous.client_phone,''),'[^0-9]','','g')
  ), numbered as (
    select page.*,
      row_number() over(order by page.booking_date,page.booking_time,page.id) page_number
    from page
  ), enriched as (
    select numbered.page_number,
      jsonb_build_object(
        'id',numbered.id,
        'booking_code',numbered.booking_code,
        'service_id',numbered.service_id,
        'performer_id',numbered.performer_id,
        'client_name',numbered.client_name,
        'client_phone',numbered.client_phone,
        'booking_date',numbered.booking_date,
        'booking_time',numbered.booking_time,
        'duration_minutes',numbered.duration_minutes,
        'original_price_rub',numbered.original_price_rub,
        'total_price_rub',numbered.total_price_rub,
        'status',numbered.status,
        'created_at',numbered.created_at,
        'reschedule_count',numbered.reschedule_count,
        'deposit_amount_rub',numbered.deposit_amount_rub,
        'payment_status',numbered.payment_status,
        'booking_source',numbered.booking_source,
        'created_by_user_id',numbered.created_by_user_id,
        'created_by_role',numbered.created_by_role,
        'services',jsonb_build_object('name',numbered.service_name,'price_rub',numbered.service_price_rub,'duration_minutes',numbered.service_duration_minutes),
        'booking_outcomes',jsonb_build_object(
          'visit_status',numbered.visit_status,
          'payment_method',numbered.payment_method,
          'amount_rub',numbered.amount_rub,
          'actual_duration_minutes',numbered.actual_duration_minutes,
          'calculated_amount_rub',numbered.calculated_amount_rub,
          'completion_source',numbered.completion_source
        ),
        'client_had_previous',case
          when numbered.client_account_id is not null then coalesce(account_first.first_completed_date<numbered.booking_date,false)
          else coalesce(phone_first.first_completed_date<numbered.booking_date,false)
        end
      ) payload
    from numbered
    left join account_first on account_first.client_account_id=numbered.client_account_id
    left join phone_first on numbered.client_account_id is null
      and phone_first.normalized_phone=regexp_replace(coalesce(numbered.client_phone,''),'[^0-9]','','g')
  )
  select coalesce(jsonb_agg(payload order by page_number) filter(where page_number<=p_limit),'[]'::jsonb),
    coalesce(bool_or(page_number>p_limit),false)
  into v_bookings,v_has_more
  from enriched;
  return jsonb_build_object(
    'organization_id',p_organization,
    'performer_id',v_effective_performer,
    'can_view_team',v_role in ('owner','admin'),
    'bookings',v_bookings,
    'has_more',v_has_more,
    'next_offset',case when v_has_more then p_offset+p_limit else null end
  );
end; $$;
revoke all on function public.get_minuta_staff_report_bookings(uuid,date,date,uuid,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_minuta_staff_report_bookings(uuid,date,date,uuid,integer,integer) to authenticated;
commit;
