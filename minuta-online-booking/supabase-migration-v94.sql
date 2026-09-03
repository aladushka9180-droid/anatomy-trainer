begin;
set local search_path = public, extensions, pg_catalog;

do $$
begin
  if to_regclass('public.bookings') is null
     or to_regclass('public.booking_events') is null
     or to_regprocedure('public.get_minuta_booking_events(uuid,date,date,integer)') is null then
    raise exception using errcode='P0001',message='v94_requires_v93';
  end if;
end $$;

-- Supports ordered provider booking lookups and the staff analytics filter.
create index if not exists bookings_performer_date_time_v94_idx
  on public.bookings (performer_id,booking_date,booking_time);

create or replace function public.get_minuta_staff_report_bookings(p_organization uuid,p_start date,p_end date,p_performer uuid default null)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_user uuid:=auth.uid(); v_role text; v_effective_performer uuid; v_bookings jsonb;
begin
  if v_user is null then raise exception using errcode='42501',message='authentication_required'; end if;
  if p_organization is null or p_start is null or p_end is null or p_end<p_start or p_end-p_start>3660 then raise exception using errcode='22023',message='invalid_staff_report_range'; end if;
  select membership.role into v_role from public.organization_memberships membership join public.organizations organization on organization.id=membership.organization_id and organization.status='active' where membership.organization_id=p_organization and membership.user_id=v_user and membership.active limit 1;
  if v_role is null then raise exception using errcode='42501',message='organization_access_denied'; end if;
  if v_role in ('owner','admin') then v_effective_performer:=p_performer; else if p_performer is not null and p_performer<>v_user then raise exception using errcode='42501',message='staff_report_access_denied'; end if; v_effective_performer:=v_user; end if;
  select coalesce(jsonb_agg(to_jsonb(booking)||jsonb_build_object('services',coalesce(to_jsonb(service),'{}'::jsonb),'booking_outcomes',coalesce(to_jsonb(outcome),'{}'::jsonb),'client_had_previous',exists(select 1 from public.bookings previous join public.booking_outcomes previous_outcome on previous_outcome.booking_id=previous.id and previous_outcome.visit_status='completed' where previous.organization_id=booking.organization_id and previous.booking_date<booking.booking_date and previous.status<>'cancelled' and ((booking.client_account_id is not null and previous.client_account_id=booking.client_account_id) or (booking.client_account_id is null and nullif(regexp_replace(coalesce(booking.client_phone,''),'[^0-9]','','g'),'') is not null and regexp_replace(coalesce(previous.client_phone,''),'[^0-9]','','g')=regexp_replace(coalesce(booking.client_phone,''),'[^0-9]','','g'))))) order by booking.booking_date,booking.booking_time,booking.id),'[]'::jsonb) into v_bookings from public.bookings booking left join public.services service on service.id=booking.service_id left join public.booking_outcomes outcome on outcome.booking_id=booking.id where booking.organization_id=p_organization and booking.booking_date between p_start and p_end and (v_effective_performer is null or booking.performer_id=v_effective_performer);
  return jsonb_build_object('organization_id',p_organization,'performer_id',v_effective_performer,'can_view_team',v_role in ('owner','admin'),'bookings',v_bookings);
end; $$;
revoke all on function public.get_minuta_staff_report_bookings(uuid,date,date,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_minuta_staff_report_bookings(uuid,date,date,uuid) to authenticated;
commit;
