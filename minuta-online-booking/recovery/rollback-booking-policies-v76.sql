begin;

do $$ begin
  if exists(select 1 from public.organization_booking_policy_settings where enabled) then
    raise exception using errcode='P0001',message='disable_booking_policies_before_rollback';
  end if;
  if exists(select 1 from public.bookings where booking_policy_snapshot ? 'id' or expired_unpaid_at is not null
    or payment_due_at is not null or cancellation_reason is not null or refund_status<>'not_required') then
    raise exception using errcode='P0001',message='export_v76_bookings_before_rollback';
  end if;
end $$;

drop function if exists public.expire_minuta_unpaid_bookings(integer);
drop function if exists public.expire_minuta_unpaid_booking(uuid);
drop function if exists public.get_client_bookings_v3(text);
drop function if exists public.cancel_booking(uuid);
drop function if exists public.reschedule_booking(uuid,date,time without time zone);
drop function if exists public.cancel_booking_v2(uuid);
drop function if exists public.provider_set_booking_status_v2(uuid,text);
drop function if exists public.reschedule_booking_v2(uuid,date,time without time zone);
drop function if exists public.get_reschedule_slots_v5(uuid,date,date);
drop function if exists public.get_booking_management_v2(uuid);
drop trigger if exists zz_bookings_apply_v76_policy on public.bookings;
drop function if exists public.apply_minuta_booking_policy_snapshot();
drop trigger if exists payments_reconcile_cancelled_booking on public.payments;
drop function if exists public.reconcile_minuta_cancelled_payment();
drop trigger if exists zz_bookings_protect_direct_cancellation_v76 on public.bookings;
drop function if exists public.protect_minuta_direct_cancellation();
drop function if exists public.cancel_minuta_booking_core(uuid,text,text);
drop function if exists public.release_minuta_reserved_benefit_for_booking(uuid);
drop function if exists public.get_minuta_booking_policy_workspace(uuid);
drop function if exists public.delete_minuta_booking_policy_rule(uuid,uuid);
drop function if exists public.upsert_minuta_booking_policy_rule(uuid,uuid,uuid,uuid,integer,integer,integer,text,integer,integer,boolean,text,text);
drop function if exists public.set_minuta_booking_policies_enabled(uuid,boolean);
drop function if exists public.resolve_minuta_booking_policy(uuid,uuid,uuid);
drop function if exists public.write_minuta_booking_policy_audit(uuid,text,uuid,jsonb);
drop function if exists public.get_minuta_booking_policy_role(uuid);

create or replace function public.minuta_payment_target_allowed(p_previous text,p_target text)
returns boolean language sql immutable security invoker set search_path to '' as $$
  select case
    when p_previous=p_target then true
    when p_previous='pending' and p_target in ('paid','failed','cancelled') then true
    when p_previous='paid' and p_target='refunded' then true
    else false end;
$$;

create or replace function public.reschedule_booking(p_token uuid,p_date date,p_time time without time zone)
returns text language plpgsql security definer set search_path to '' as $$
declare v_id uuid;v_service uuid;v_performer uuid;v_code text;v_start timestamp without time zone;
  v_count integer;v_cutoff integer:=12;v_limit integer:=2;
begin
  select booking.id,booking.service_id,booking.performer_id,booking.booking_code,
    booking.booking_date+booking.booking_time,booking.reschedule_count,
    coalesce(policy.reschedule_cutoff_hours,12),coalesce(policy.max_reschedules,2)
  into v_id,v_service,v_performer,v_code,v_start,v_count,v_cutoff,v_limit
  from public.bookings booking left join public.booking_policies policy on policy.performer_id=booking.performer_id
  where booking.manage_token=p_token and booking.status<>'cancelled' for update of booking;
  if v_id is null then raise exception using errcode='P0001',message='booking_unavailable'; end if;
  if timezone('Europe/Samara',now())>v_start-make_interval(hours=>v_cutoff) then raise exception using errcode='P0001',message='reschedule_too_late'; end if;
  if v_count>=v_limit then raise exception using errcode='P0001',message='reschedule_limit_reached'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_performer::text||p_date::text,0));
  if not exists(select 1 from public.get_available_slots(v_service,p_date,p_date,v_id) slot
    where slot.booking_date=p_date and slot.booking_time=p_time) then raise exception using errcode='P0001',message='slot_unavailable'; end if;
  update public.bookings set booking_date=p_date,booking_time=p_time,status='new',reschedule_count=reschedule_count+1 where id=v_id;
  return v_code;
end $$;
revoke all on function public.reschedule_booking(uuid,date,time without time zone) from public,anon,authenticated,service_role;
grant execute on function public.reschedule_booking(uuid,date,time without time zone) to anon,authenticated;

create or replace function public.cancel_booking(p_token uuid)
returns text language plpgsql security definer set search_path to '' as $$
declare v_id uuid;v_start timestamp without time zone;v_cutoff integer:=12;
begin
  select booking.id,booking.booking_date+booking.booking_time,coalesce(policy.cancel_cutoff_hours,12)
  into v_id,v_start,v_cutoff from public.bookings booking
  left join public.booking_policies policy on policy.performer_id=booking.performer_id
  where booking.manage_token=p_token and booking.status<>'cancelled' for update of booking;
  if v_id is null then raise exception using errcode='P0001',message='booking_unavailable'; end if;
  if timezone('Europe/Samara',now())>v_start-make_interval(hours=>v_cutoff) then raise exception using errcode='P0001',message='cancel_too_late'; end if;
  update public.bookings set status='cancelled' where id=v_id;
  return 'cancelled';
end $$;
revoke all on function public.cancel_booking(uuid) from public,anon,authenticated,service_role;
grant execute on function public.cancel_booking(uuid) to anon,authenticated;

drop trigger if exists organization_booking_policy_rules_touch on public.organization_booking_policy_rules;
drop trigger if exists organization_booking_policy_settings_touch on public.organization_booking_policy_settings;
drop table if exists public.organization_booking_policy_audit_log;
drop table if exists public.organization_booking_policy_rules;
drop table if exists public.organization_booking_policy_settings;
drop index if exists public.bookings_unpaid_expiry_idx;
alter table public.bookings drop constraint if exists bookings_policy_snapshot_object_check;
alter table public.bookings drop constraint if exists bookings_refund_status_check;
alter table public.bookings drop constraint if exists bookings_cancellation_reason_check;
alter table public.bookings drop column if exists refund_status;
alter table public.bookings drop column if exists cancellation_reason;
alter table public.bookings drop column if exists expired_unpaid_at;
alter table public.bookings drop column if exists payment_due_at;
alter table public.bookings drop column if exists booking_policy_snapshot;

commit;
