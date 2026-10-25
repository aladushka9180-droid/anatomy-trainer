-- Candidate only: applying to production requires the separate restore/SQL gates.
begin;
set local lock_timeout='5s';
set local statement_timeout='2min';

do $guard$ declare p regprocedure; begin
  if to_regclass('public.organization_waitlist_requests') is null
    or to_regprocedure('public.has_organization_role(uuid,text[])') is null
    or to_regprocedure('public.is_organization_member(uuid)') is null
    or to_regprocedure('public.get_public_minuta_available_slots_v101(text,uuid,uuid,date,date)') is null
    or to_regprocedure('public.book_minuta_appointment_v2(uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer)') is null then
    raise exception using errcode='55000',message='waitlist_offers_prerequisites_missing';
  end if;
  if to_regclass('public.organization_waitlist_offers') is not null
    and obj_description(to_regclass('public.organization_waitlist_offers'),'pg_class') is distinct from 'minuta_waitlist_offers_v196' then
    raise exception using errcode='55000',message='waitlist_offers_existing_object_conflict';
  end if;
  foreach p in array array[
    to_regprocedure('public.create_minuta_waitlist_offer_v196(uuid,uuid,date,time without time zone,timestamptz)'),
    to_regprocedure('public.get_minuta_waitlist_offer_v196(uuid,uuid)'),
    to_regprocedure('public.accept_minuta_waitlist_offer_v196(uuid,uuid)')
  ] loop
    if p is not null and obj_description(p,'pg_proc') is distinct from 'minuta_waitlist_offers_v196' then
      raise exception using errcode='55000',message='waitlist_offers_existing_object_conflict';
    end if;
  end loop;
end $guard$;

create table if not exists public.organization_waitlist_offers (
  id uuid primary key,
  request_id uuid not null references public.organization_waitlist_requests(id),
  booking_request_id uuid not null default gen_random_uuid() unique,
  booking_date date not null,
  booking_time time without time zone not null,
  expires_at timestamptz not null,
  quoted_price_rub integer not null check (quoted_price_rub between 0 and 10000000),
  quoted_duration_minutes integer not null check (quoted_duration_minutes between 1 and 480),
  status text not null default 'offered' check (status in ('offered','accepted','expired','busy')),
  terminal_reason text check (terminal_reason in ('deadline','request_closed','service_terms_changed','slot_busy')),
  booking_id uuid references public.bookings(id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check ((status='accepted')=(booking_id is not null))
);
comment on table public.organization_waitlist_offers is 'minuta_waitlist_offers_v196';
create unique index if not exists organization_waitlist_one_offer_idx
  on public.organization_waitlist_offers(request_id) where status='offered';
alter table public.organization_waitlist_offers enable row level security;
revoke all on public.organization_waitlist_offers from public,anon,authenticated,service_role;
grant select on public.organization_waitlist_offers to authenticated;
drop policy if exists organization_waitlist_offers_read on public.organization_waitlist_offers;
create policy organization_waitlist_offers_read on public.organization_waitlist_offers
  for select to authenticated using (exists (
    select 1 from public.organization_waitlist_requests r where r.id=request_id
      and (public.has_organization_role(r.organization_id,array['owner','admin']::text[])
        or (r.performer_id=auth.uid() and public.is_organization_member(r.organization_id)))
  ));

-- Only the existing client capability may reveal an accepted booking capability.
create or replace function public.get_minuta_waitlist_offer_v196(p_offer uuid,p_token uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_offer public.organization_waitlist_offers%rowtype;
  v_request public.organization_waitlist_requests%rowtype;
  v_booking public.bookings%rowtype; v_state text;
begin
  select o.* into v_offer from public.organization_waitlist_offers o
    join public.organization_waitlist_requests r on r.id=o.request_id
    where o.id=p_offer and r.manage_token=p_token;
  if not found then raise exception using errcode='P0001',message='waitlist_offer_unavailable'; end if;
  select r.* into v_request from public.organization_waitlist_requests r where r.id=v_offer.request_id;
  v_state:=v_offer.status;
  if v_state='offered' and (v_offer.expires_at<=clock_timestamp() or v_request.status not in ('waiting','contacted')) then
    v_state:='expired';
  end if;
  if v_state='accepted' then
    select b.* into v_booking from public.bookings b
      where b.id=v_offer.booking_id and b.request_id=v_offer.booking_request_id
        and b.organization_id=v_request.organization_id;
    -- The immutable original quote was verified before acceptance. Subsequent
    -- legitimate rescheduling/discounts must not erase that accepted history.
    if not found then raise exception using errcode='55000',message='waitlist_offer_booking_binding_invalid'; end if;
  end if;
  return jsonb_build_object('state',v_state,'offerId',v_offer.id,
    'bookingDate',v_offer.booking_date,'bookingTime',v_offer.booking_time,'expiresAt',v_offer.expires_at,
    'priceRub',v_offer.quoted_price_rub,'durationMinutes',v_offer.quoted_duration_minutes,
    'reason',case when v_state='expired' and v_offer.status='offered' then
      case when v_request.status not in ('waiting','contacted') then 'request_closed' else 'deadline' end
      else v_offer.terminal_reason end,
    'booking',case when v_state='accepted' then jsonb_build_object(
      'bookingCode',v_booking.booking_code,'manageToken',v_booking.manage_token,
      'requestId',v_booking.request_id,'status',v_booking.status) else null end);
end $$;

create or replace function public.create_minuta_waitlist_offer_v196(
  p_offer uuid,p_request uuid,p_date date,p_time time without time zone,p_expires timestamptz
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_request public.organization_waitlist_requests%rowtype;
  v_offer public.organization_waitlist_offers%rowtype;
  v_price integer; v_duration integer; v_performer uuid; v_slug text;
begin
  select r.* into v_request from public.organization_waitlist_requests r where r.id=p_request for update;
  if not found or auth.uid() is null or (public.has_organization_role(v_request.organization_id,array['owner','admin']::text[])
    or (v_request.performer_id=auth.uid() and public.is_organization_member(v_request.organization_id))) is distinct from true then
    raise exception using errcode='P0001',message='waitlist_offer_unavailable';
  end if;
  select o.* into v_offer from public.organization_waitlist_offers o where o.id=p_offer;
  if found then
    if v_offer.request_id is distinct from p_request or v_offer.booking_date is distinct from p_date
      or v_offer.booking_time is distinct from p_time or v_offer.expires_at is distinct from p_expires then
      raise exception using errcode='P0001',message='waitlist_offer_request_conflict';
    end if;
    return public.get_minuta_waitlist_offer_v196(v_offer.id,v_request.manage_token);
  end if;
  if p_offer is null or p_date is null or p_time is null or p_expires is null
    or v_request.status not in ('waiting','contacted') then
    raise exception using errcode='P0001',message='invalid_waitlist_offer';
  end if;
  if p_date>current_date+14 or p_date<timezone('Europe/Samara',clock_timestamp())::date then
    raise exception using errcode='22023',message='waitlist_offer_outside_supported_horizon';
  end if;
  if p_date<>v_request.desired_date or p_expires<=clock_timestamp()
    or p_expires>clock_timestamp()+interval '24 hours'
    or p_expires>((p_date+p_time) at time zone 'Europe/Samara')
    or (v_request.time_period='morning' and p_time>=time '12:00')
    or (v_request.time_period='day' and (p_time<time '12:00' or p_time>=time '18:00'))
    or (v_request.time_period='evening' and p_time<time '18:00') then
    raise exception using errcode='P0001',message='invalid_waitlist_offer';
  end if;
  select s.price_rub,s.duration_minutes,s.performer_id into v_price,v_duration,v_performer
    from public.services s where s.id=v_request.service_id and s.active for share;
  if not found or v_performer is distinct from v_request.performer_id then
    raise exception using errcode='P0001',message='service_unavailable';
  end if;
  select o.public_slug into v_slug from public.organizations o where o.id=v_request.organization_id;
  if not exists(select 1 from public.get_public_minuta_available_slots_v101(
    v_slug,v_request.location_id,v_request.service_id,p_date,p_date) slot
    where slot.booking_date=p_date and slot.booking_time=p_time) then
    raise exception using errcode='P0001',message='waitlist_offer_slot_busy';
  end if;
  update public.organization_waitlist_offers set status='expired',terminal_reason='deadline',updated_at=clock_timestamp()
    where request_id=p_request and status='offered' and expires_at<=clock_timestamp();
  if exists(select 1 from public.organization_waitlist_offers where request_id=p_request and status='offered') then
    raise exception using errcode='P0001',message='waitlist_offer_already_active';
  end if;
  insert into public.organization_waitlist_offers(id,request_id,booking_date,booking_time,expires_at,
    quoted_price_rub,quoted_duration_minutes)
    values(p_offer,p_request,p_date,p_time,p_expires,v_price,v_duration);
  return public.get_minuta_waitlist_offer_v196(p_offer,v_request.manage_token);
end $$;

create or replace function public.accept_minuta_waitlist_offer_v196(p_offer uuid,p_token uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_request public.organization_waitlist_requests%rowtype;
  v_offer public.organization_waitlist_offers%rowtype;
  v_booking public.bookings%rowtype; v_result record; v_slug text;
  v_price integer; v_duration integer; v_performer uuid;
  v_error text; v_schema text; v_table text; v_constraint text;
begin
  -- Every writer locks the request before the offer, including simultaneous retries.
  select r.* into v_request from public.organization_waitlist_requests r
    join public.organization_waitlist_offers o on o.request_id=r.id
    where o.id=p_offer and r.manage_token=p_token for update of r;
  if not found then raise exception using errcode='P0001',message='waitlist_offer_unavailable'; end if;
  select o.* into v_offer from public.organization_waitlist_offers o where o.id=p_offer for update;
  if v_offer.status<>'offered' then return public.get_minuta_waitlist_offer_v196(p_offer,p_token); end if;
  if v_offer.expires_at<=clock_timestamp() or v_request.status not in ('waiting','contacted') then
    update public.organization_waitlist_offers set status='expired',updated_at=clock_timestamp(),
      terminal_reason=case when v_request.status not in ('waiting','contacted') then 'request_closed' else 'deadline' end
      where id=p_offer;
    return public.get_minuta_waitlist_offer_v196(p_offer,p_token);
  end if;
  select s.price_rub,s.duration_minutes,s.performer_id into v_price,v_duration,v_performer
    from public.services s where s.id=v_request.service_id and s.active for share;
  if not found or v_performer is distinct from v_request.performer_id
    or v_price is distinct from v_offer.quoted_price_rub or v_duration is distinct from v_offer.quoted_duration_minutes then
    update public.organization_waitlist_offers set status='expired',terminal_reason='service_terms_changed',updated_at=clock_timestamp() where id=p_offer;
    return public.get_minuta_waitlist_offer_v196(p_offer,p_token);
  end if;
  select o.public_slug into v_slug from public.organizations o where o.id=v_request.organization_id;
  if not exists(select 1 from public.get_public_minuta_available_slots_v101(
    v_slug,v_request.location_id,v_request.service_id,v_offer.booking_date,v_offer.booking_date) slot
    where slot.booking_date=v_offer.booking_date and slot.booking_time=v_offer.booking_time) then
    update public.organization_waitlist_offers set status='busy',terminal_reason='slot_busy',updated_at=clock_timestamp() where id=p_offer;
    return public.get_minuta_waitlist_offer_v196(p_offer,p_token);
  end if;
  begin
    select * into strict v_result from public.book_minuta_appointment_v2(v_offer.booking_request_id,
      v_slug,v_request.location_id,v_request.service_id,v_offer.booking_date,v_offer.booking_time,
      v_request.client_name,v_request.client_phone,v_offer.quoted_price_rub,v_offer.quoted_duration_minutes);
  exception when exclusion_violation then
    get stacked diagnostics v_error=message_text,v_schema=schema_name,v_table=table_name,v_constraint=constraint_name;
    if v_error not in ('slot_unavailable','team_booking_outside_shift','team_booking_slot_unavailable')
      and not (v_schema='public' and v_table='bookings' and v_constraint='bookings_performer_active_no_overlap') then raise; end if;
    update public.organization_waitlist_offers set status='busy',terminal_reason='slot_busy',updated_at=clock_timestamp() where id=p_offer;
    return public.get_minuta_waitlist_offer_v196(p_offer,p_token);
  when raise_exception then
    get stacked diagnostics v_error=message_text;
    if v_error<>'booking_buffer_conflict' and v_error!~'^session_overlap:[0-9]{2}:[0-9]{2}$' then raise; end if;
    update public.organization_waitlist_offers set status='busy',terminal_reason='slot_busy',updated_at=clock_timestamp() where id=p_offer;
    return public.get_minuta_waitlist_offer_v196(p_offer,p_token);
  when no_data_found or too_many_rows then
    raise exception using errcode='55000',message='waitlist_offer_atomic_ack_invalid';
  end;
  if v_result.result_code='service_terms_changed' then
    update public.organization_waitlist_offers set status='expired',terminal_reason='service_terms_changed',updated_at=clock_timestamp() where id=p_offer;
    return public.get_minuta_waitlist_offer_v196(p_offer,p_token);
  end if;
  if v_result.result_code is distinct from 'ok' then
    raise exception using errcode='55000',message='waitlist_offer_atomic_ack_invalid';
  end if;
  select b.* into v_booking from public.bookings b
    where b.request_id=v_offer.booking_request_id and b.organization_id=v_request.organization_id
      and b.location_id=v_request.location_id and b.service_id=v_request.service_id
      and b.performer_id=v_request.performer_id and b.booking_date=v_offer.booking_date
      and b.booking_time=v_offer.booking_time and b.duration_minutes=v_offer.quoted_duration_minutes
      and b.original_price_rub=v_offer.quoted_price_rub and b.total_price_rub=v_offer.quoted_price_rub
      and b.booking_code=v_result.booking_code and b.manage_token=v_result.manage_token
      and b.request_id=v_result.request_id and b.service_id=v_result.service_id
      and b.booking_date=v_result.booking_date and b.booking_time=v_result.booking_time
      and b.duration_minutes=v_result.duration_minutes and b.original_price_rub=v_result.original_price_rub
      and b.total_price_rub=v_result.total_price_rub and b.status::text=v_result.status;
  if not found then raise exception using errcode='55000',message='waitlist_offer_atomic_ack_invalid'; end if;
  update public.organization_waitlist_offers set status='accepted',booking_id=v_booking.id,updated_at=clock_timestamp() where id=p_offer;
  update public.organization_waitlist_requests set status='booked',updated_at=clock_timestamp() where id=v_request.id;
  return public.get_minuta_waitlist_offer_v196(p_offer,p_token);
end $$;

revoke all on function public.create_minuta_waitlist_offer_v196(uuid,uuid,date,time without time zone,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.get_minuta_waitlist_offer_v196(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.accept_minuta_waitlist_offer_v196(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.create_minuta_waitlist_offer_v196(uuid,uuid,date,time without time zone,timestamptz) to authenticated;
grant execute on function public.get_minuta_waitlist_offer_v196(uuid,uuid) to anon,authenticated;
grant execute on function public.accept_minuta_waitlist_offer_v196(uuid,uuid) to anon,authenticated;
comment on function public.create_minuta_waitlist_offer_v196(uuid,uuid,date,time without time zone,timestamptz) is 'minuta_waitlist_offers_v196';
comment on function public.get_minuta_waitlist_offer_v196(uuid,uuid) is 'minuta_waitlist_offers_v196';
comment on function public.accept_minuta_waitlist_offer_v196(uuid,uuid) is 'minuta_waitlist_offers_v196';
notify pgrst,'reload schema';
commit;
