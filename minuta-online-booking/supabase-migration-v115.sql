begin;

set local search_path = public, extensions, pg_catalog;

do $$ begin
  if to_regprocedure('public.book_minuta_appointment(uuid,text,uuid,uuid,date,time without time zone,text,text)') is null
     or to_regclass('public.client_benefit_instruments') is null
     or to_regclass('public.benefit_redemptions') is null
     or to_regclass('public.benefit_ledger') is null
     or to_regclass('public.payment_provider_attempts') is null
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='bookings' and column_name='payment_due_at') then
    raise exception using errcode='P0001',message='v115_requires_v68_v73_v76_and_v87';
  end if;
end $$;

-- The binding survives release/cancellation and makes the public request tuple
-- immutable. A retry can therefore never spend a second instrument or visit.
create table if not exists public.public_benefit_booking_requests_v115 (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  request_id uuid not null,
  booking_id uuid not null references public.bookings(id) on delete restrict,
  instrument_id uuid not null references public.client_benefit_instruments(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key(organization_id,request_id),
  unique(booking_id)
);
alter table public.public_benefit_booking_requests_v115 enable row level security;
revoke all on public.public_benefit_booking_requests_v115 from public,anon,authenticated;
grant all on public.public_benefit_booking_requests_v115 to service_role;

create or replace function public.reserve_minuta_public_benefit_v115(
  p_organization uuid,p_request_id uuid,p_public_code text
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_instrument public.client_benefit_instruments%rowtype;
  v_booking public.bookings%rowtype;
  v_existing public.benefit_redemptions%rowtype;
  v_binding public.public_benefit_booking_requests_v115%rowtype;
  v_booking_id uuid;
  v_instrument_id uuid;
  v_kind text;
  v_units integer:=0;
  v_amount integer:=0;
  v_service_remaining integer;
  v_redemption uuid;
  v_today date:=timezone('Europe/Samara',now())::date;
begin
  if nullif(btrim(p_public_code),'') is null or char_length(btrim(p_public_code)) not between 8 and 40 then
    raise exception using errcode='P0001',message='invalid_benefit_code';
  end if;
  if not coalesce((select enabled from public.organization_benefit_settings where organization_id=p_organization),false) then
    raise exception using errcode='P0001',message='benefits_disabled';
  end if;

  -- Resolve ids without row locks, then use the same mandatory order as v76:
  -- booking advisory, instrument advisory, instrument row, booking row.
  select id into v_booking_id from public.bookings
    where organization_id=p_organization and request_id=p_request_id;
  select id into v_instrument_id from public.client_benefit_instruments
    where organization_id=p_organization and public_code=upper(btrim(p_public_code));
  if v_booking_id is null then raise exception using errcode='P0001',message='booking_not_found'; end if;
  if v_instrument_id is null then raise exception using errcode='P0001',message='benefit_code_not_found'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_booking_id::text,7302));
  perform pg_advisory_xact_lock(hashtextextended(v_instrument_id::text,7300));
  select * into v_instrument from public.client_benefit_instruments
    where id=v_instrument_id and organization_id=p_organization for update;
  select * into v_booking from public.bookings
    where id=v_booking_id and organization_id=p_organization and request_id=p_request_id for update;
  if v_instrument.id is null or v_booking.id is null then raise exception using errcode='P0001',message='benefit_not_available'; end if;

  select * into v_binding from public.public_benefit_booking_requests_v115
    where organization_id=p_organization and request_id=p_request_id for update;
  if v_binding.request_id is not null then
    if v_binding.booking_id=v_booking.id and v_binding.instrument_id=v_instrument.id then
      return jsonb_build_object('id',v_binding.instrument_id,'status','already_bound');
    end if;
    raise exception using errcode='P0001',message='benefit_request_conflict';
  end if;

  select * into v_existing from public.benefit_redemptions
    where organization_id=p_organization and booking_id=v_booking.id and status in ('reserved','redeemed') for update;
  if v_existing.id is not null then raise exception using errcode='P0001',message='booking_already_has_benefit'; end if;
  if v_booking.client_account_id is null or v_booking.client_account_id is distinct from v_instrument.client_account_id then
    raise exception using errcode='P0001',message='benefit_client_mismatch';
  end if;
  if v_booking.status='cancelled' or v_instrument.status<>'active' or v_today>v_instrument.expires_on or v_booking.booking_date>v_instrument.expires_on then
    raise exception using errcode='P0001',message='benefit_not_available';
  end if;
  -- Safe launch gate: public benefits and a monetary deposit cannot coexist
  -- until release/refund reconciliation is implemented in the payment domain.
  if coalesce(v_booking.deposit_amount_rub,0)>0 or v_booking.payment_status<>'not_required' or exists(
    select 1 from public.payment_provider_attempts attempt where attempt.booking_id=v_booking.id
  ) then
    raise exception using errcode='P0001',message='booking_payment_already_started';
  end if;

  v_kind:=v_instrument.product_snapshot->>'kind';
  if v_kind='certificate' then
    v_amount:=least(v_instrument.remaining_amount_rub,coalesce(v_booking.total_price_rub,0));
    if v_amount<=0 then raise exception using errcode='P0001',message='insufficient_certificate_balance'; end if;
    update public.client_benefit_instruments set remaining_amount_rub=remaining_amount_rub-v_amount where id=v_instrument.id;
  elsif v_kind='package' then
    select remaining_units into v_service_remaining from public.benefit_instrument_service_balances
      where instrument_id=v_instrument.id and service_id=v_booking.service_id for update;
    if coalesce(v_service_remaining,0)<1 then raise exception using errcode='P0001',message='package_service_exhausted'; end if;
    v_units:=1;
    update public.benefit_instrument_service_balances set remaining_units=remaining_units-1
      where instrument_id=v_instrument.id and service_id=v_booking.service_id;
    update public.client_benefit_instruments set remaining_visits=remaining_visits-1 where id=v_instrument.id;
  elsif v_kind='visit_pass' then
    if v_instrument.remaining_visits<1 or (jsonb_array_length(coalesce(v_instrument.product_snapshot->'services','[]'::jsonb))>0
       and not exists(select 1 from jsonb_array_elements(coalesce(v_instrument.product_snapshot->'services','[]'::jsonb)) allowed where (allowed->>'service_id')::uuid=v_booking.service_id)) then
      raise exception using errcode='P0001',message='visit_pass_not_applicable';
    end if;
    v_units:=1;
    update public.client_benefit_instruments set remaining_visits=remaining_visits-1 where id=v_instrument.id;
  else
    raise exception using errcode='P0001',message='invalid_benefit_kind';
  end if;

  insert into public.public_benefit_booking_requests_v115(organization_id,request_id,booking_id,instrument_id)
    values(p_organization,p_request_id,v_booking.id,v_instrument.id);
  insert into public.benefit_redemptions(organization_id,instrument_id,booking_id,service_id,units,amount_rub,status,acted_by)
    values(p_organization,v_instrument.id,v_booking.id,v_booking.service_id,v_units,v_amount,'reserved',null) returning id into v_redemption;
  update public.client_benefit_instruments set status=case when remaining_amount_rub=0 and remaining_visits=0 then 'exhausted' else status end where id=v_instrument.id;

  insert into public.benefit_ledger(organization_id,instrument_id,redemption_id,event_type,amount_delta_rub,visits_delta,amount_balance_rub,visits_balance,actor_id,details)
    select p_organization,v_instrument.id,v_redemption,'reserved',-v_amount,-v_units,remaining_amount_rub,remaining_visits,null,
      jsonb_build_object('source','public_booking_v115','deposit_rub',v_booking.deposit_amount_rub)
    from public.client_benefit_instruments where id=v_instrument.id;
  insert into public.benefit_audit_log(organization_id,actor_id,action,subject_id,details)
    values(p_organization,null,'benefit_reserved_public',v_redemption,jsonb_build_object('instrument_id',v_instrument.id,'booking_id',v_booking.id,'request_id',p_request_id));
  return (select jsonb_build_object('id',v_redemption,'status','reserved','remaining_visits',remaining_visits,'remaining_amount_rub',remaining_amount_rub)
    from public.client_benefit_instruments where id=v_instrument.id);
end $$;

revoke all on function public.reserve_minuta_public_benefit_v115(uuid,uuid,text) from public,anon,authenticated,service_role;

create or replace function public.book_minuta_appointment_with_benefit_v115(
  p_request_id uuid,p_slug text,p_location uuid,p_service uuid,p_date date,p_time time without time zone,
  p_client_name text,p_client_phone text,p_benefit_code text
) returns table(booking_code text,manage_token uuid)
language plpgsql security definer set search_path to '' as $$
declare v_organization uuid;v_code text;v_token uuid;v_preexisting uuid;
begin
  select id into v_organization from public.organizations
    where public_slug=lower(btrim(coalesce(p_slug,''))) and status='active' and public_booking_enabled;
  if v_organization is null then raise exception using errcode='P0001',message='organization_unavailable'; end if;
  select id into v_preexisting from public.bookings where organization_id=v_organization and request_id=p_request_id;
  if v_preexisting is not null and not exists(
    select 1 from public.public_benefit_booking_requests_v115 binding
      where binding.organization_id=v_organization and binding.request_id=p_request_id and binding.booking_id=v_preexisting
  ) then
    raise exception using errcode='P0001',message='benefit_not_available';
  end if;
  select result.booking_code,result.manage_token into v_code,v_token from public.book_minuta_appointment(
    p_request_id,p_slug,p_location,p_service,p_date,p_time,p_client_name,p_client_phone) result;
  begin
    perform public.reserve_minuta_public_benefit_v115(v_organization,p_request_id,p_benefit_code);
  exception when others then
    raise exception using errcode='P0001',message='benefit_not_available';
  end;
  return query select v_code,v_token;
end $$;

revoke all on function public.book_minuta_appointment_with_benefit_v115(uuid,text,uuid,uuid,date,time without time zone,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.book_minuta_appointment_with_benefit_v115(uuid,text,uuid,uuid,date,time without time zone,text,text,text) to anon,authenticated;

commit;
