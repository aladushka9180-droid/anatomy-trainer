-- Source candidate only. Production requires the sole release owner, protected
-- backup/restore/apply/read/rollback/reapply qualification and explicit SQL approval.
-- Preserve existing signatures, owners, ACLs, locks, ledgers and request replay.
begin;
set local lock_timeout='8s';
set local statement_timeout='30s';
set local search_path=public,extensions,pg_catalog;
do $guard$
begin
  if to_regprocedure('public.get_minuta_benefit_timezone_v150(uuid)') is null then
    raise exception using errcode='55000',message='v192_requires_benefit_lifecycle_v150';
  end if;
  if to_regprocedure('public.apply_minuta_benefit(uuid,uuid,uuid,text,integer)') is null or
    pg_catalog.md5(pg_catalog.replace(pg_catalog.pg_get_functiondef('public.apply_minuta_benefit(uuid,uuid,uuid,text,integer)'::regprocedure),pg_catalog.chr(13),'')) not in ('3d25c197cb4765cc36b87157f8b35ac0','33d1a0df5d95b62c81e11775d80209a9') then
    raise exception using errcode='55000',message='v192_source_drift_apply_minuta_benefit';
  end if;
  if to_regprocedure('public.release_minuta_reserved_benefit_for_booking(uuid)') is null or
    pg_catalog.md5(pg_catalog.replace(pg_catalog.pg_get_functiondef('public.release_minuta_reserved_benefit_for_booking(uuid)'::regprocedure),pg_catalog.chr(13),'')) not in ('7d220cd6122aca1034f4c02f8c0be4f4','e790f11ae2f5c2c38f133bec614b34c0') then
    raise exception using errcode='55000',message='v192_source_drift_release_minuta_reserved_benefit_for_booking';
  end if;
  if to_regprocedure('public.issue_minuta_benefit(uuid,uuid,uuid,date,uuid)') is null or
    pg_catalog.md5(pg_catalog.replace(pg_catalog.pg_get_functiondef('public.issue_minuta_benefit(uuid,uuid,uuid,date,uuid)'::regprocedure),pg_catalog.chr(13),'')) not in ('9ccab4f7f1562bf3a06fba54d1e0b903','8598712521686e89ada4e826555f7916') then
    raise exception using errcode='55000',message='v192_source_drift_issue_minuta_benefit';
  end if;
  if to_regprocedure('public.minuta_benefit_business_date_v192(uuid,timestamptz)') is not null and
    (select pg_catalog.replace(prosrc,pg_catalog.chr(13),'') from pg_catalog.pg_proc where oid=to_regprocedure('public.minuta_benefit_business_date_v192(uuid,timestamptz)'))<>pg_catalog.replace($body$
  select pg_catalog.timezone(public.get_minuta_benefit_timezone_v150(p_organization),p_now)::date
$body$,pg_catalog.chr(13),'') then
    raise exception using errcode='55000',message='v192_source_drift_business_date';
  end if;
end $guard$;
create or replace function public.minuta_benefit_business_date_v192(
  p_organization uuid,p_now timestamptz default clock_timestamp()
) returns date language sql stable security definer set search_path to '' as $date$
  select pg_catalog.timezone(public.get_minuta_benefit_timezone_v150(p_organization),p_now)::date
$date$;
revoke all on function public.minuta_benefit_business_date_v192(uuid,timestamptz) from public,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.apply_minuta_benefit(p_organization uuid, p_instrument uuid, p_booking uuid, p_action text, p_amount_rub integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_role text; v_instrument public.client_benefit_instruments%rowtype; v_booking public.bookings%rowtype;
  v_kind text; v_redemption uuid; v_units integer:=0; v_amount integer:=0; v_service_remaining integer; v_today date;
begin
  v_role:=public.get_minuta_benefit_role(p_organization);
  if not coalesce((select enabled from public.organization_benefit_settings where organization_id=p_organization),false) then raise exception using errcode='55000',message='benefits_disabled'; end if;
  if p_action not in ('reserve','redeem','release') then raise exception using errcode='22023',message='invalid_benefit_action'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_booking::text,7302));
  perform pg_advisory_xact_lock(hashtextextended(p_instrument::text,7300));
  select * into v_instrument from public.client_benefit_instruments where id=p_instrument and organization_id=p_organization for update;
  select * into v_booking from public.bookings where id=p_booking and organization_id=p_organization for update;
  if v_instrument.id is null or v_booking.id is null then raise exception using errcode='P0002',message='benefit_or_booking_not_found'; end if;
  if v_instrument.client_account_id is distinct from v_booking.client_account_id then raise exception using errcode='42501',message='benefit_client_mismatch'; end if;
  v_today:=public.minuta_benefit_business_date_v192(p_organization);
  v_kind:=v_instrument.product_snapshot->>'kind';
  if p_action='reserve' then
    if v_booking.status='cancelled' or v_instrument.status<>'active'
       or v_today>v_instrument.expires_on or v_booking.booking_date>v_instrument.expires_on then
      raise exception using errcode='55000',message='benefit_not_available';
    end if;
    select id into v_redemption from public.benefit_redemptions where booking_id=p_booking and status in ('reserved','redeemed');
    if v_redemption is not null then
      if exists(select 1 from public.benefit_redemptions where id=v_redemption and instrument_id=p_instrument) then
        return jsonb_build_object('id',v_redemption,'organization_id',p_organization,'status',(select status from public.benefit_redemptions where id=v_redemption));
      end if;
      raise exception using errcode='23505',message='booking_already_has_benefit';
    end if;
    if v_kind='certificate' then
      v_amount:=coalesce(p_amount_rub,least(v_instrument.remaining_amount_rub,coalesce(v_booking.total_price_rub,0)));
      if v_amount<=0 or v_amount>v_instrument.remaining_amount_rub then raise exception using errcode='55000',message='insufficient_certificate_balance'; end if;
      if v_amount>greatest(coalesce(v_booking.total_price_rub,0),0) then
        raise exception using errcode='22023',message='invalid_benefit_application';
      end if;
      update public.client_benefit_instruments set remaining_amount_rub=remaining_amount_rub-v_amount where id=p_instrument;
    elsif v_kind='package' then
      select remaining_units into v_service_remaining from public.benefit_instrument_service_balances where instrument_id=p_instrument and service_id=v_booking.service_id for update;
      if coalesce(v_service_remaining,0)<1 then raise exception using errcode='55000',message='package_service_exhausted'; end if;
      v_units:=1;
      update public.benefit_instrument_service_balances set remaining_units=remaining_units-1 where instrument_id=p_instrument and service_id=v_booking.service_id;
      update public.client_benefit_instruments set remaining_visits=remaining_visits-1 where id=p_instrument;
    else
      if v_instrument.remaining_visits<1 or (jsonb_array_length(coalesce(v_instrument.product_snapshot->'services','[]'::jsonb))>0
         and not exists(select 1 from jsonb_array_elements(coalesce(v_instrument.product_snapshot->'services','[]'::jsonb)) allowed
           where (allowed->>'service_id')::uuid=v_booking.service_id)) then
        raise exception using errcode='55000',message='visit_pass_not_applicable';
      end if;
      v_units:=1;
      update public.client_benefit_instruments set remaining_visits=remaining_visits-1 where id=p_instrument;
    end if;
    insert into public.benefit_redemptions(organization_id,instrument_id,booking_id,service_id,units,amount_rub,status,acted_by)
    values(p_organization,p_instrument,p_booking,v_booking.service_id,v_units,v_amount,'reserved',auth.uid()) returning id into v_redemption;
    update public.client_benefit_instruments set status=case when remaining_amount_rub=0 and remaining_visits=0 then 'exhausted' else status end where id=p_instrument;
    insert into public.benefit_ledger(organization_id,instrument_id,redemption_id,event_type,amount_delta_rub,visits_delta,amount_balance_rub,visits_balance,actor_id)
    select p_organization,p_instrument,v_redemption,'reserved',-v_amount,-v_units,remaining_amount_rub,remaining_visits,auth.uid() from public.client_benefit_instruments where id=p_instrument;
  elsif p_action='redeem' then
    select id into v_redemption from public.benefit_redemptions where instrument_id=p_instrument and booking_id=p_booking and status='reserved' for update;
    if v_redemption is null then raise exception using errcode='P0002',message='benefit_reservation_not_found'; end if;
    if not exists(select 1 from public.booking_outcomes where booking_id=p_booking and visit_status='completed') then raise exception using errcode='55000',message='complete_visit_before_redemption'; end if;
    update public.benefit_redemptions set status='redeemed',redeemed_at=now(),acted_by=auth.uid() where id=v_redemption;
    insert into public.benefit_ledger(organization_id,instrument_id,redemption_id,event_type,amount_balance_rub,visits_balance,actor_id)
    values(p_organization,p_instrument,v_redemption,'redeemed',v_instrument.remaining_amount_rub,v_instrument.remaining_visits,auth.uid());
  else
    select id,units,amount_rub into v_redemption,v_units,v_amount from public.benefit_redemptions
    where instrument_id=p_instrument and booking_id=p_booking and status in ('reserved','redeemed') for update;
    if v_redemption is null then raise exception using errcode='P0002',message='benefit_redemption_not_found'; end if;
    if (select status from public.benefit_redemptions where id=v_redemption)='redeemed' and v_role<>'owner' then
      raise exception using errcode='42501',message='owner_required_to_release_redeemed_benefit';
    end if;
    update public.benefit_redemptions set status='released',released_at=now(),acted_by=auth.uid() where id=v_redemption;
    update public.client_benefit_instruments set remaining_amount_rub=remaining_amount_rub+v_amount,
      remaining_visits=remaining_visits+v_units,status=case when status='cancelled' then 'cancelled' when expires_on<v_today then 'expired' when status='frozen' then 'frozen' else 'active' end where id=p_instrument;
    if v_kind='package' then update public.benefit_instrument_service_balances set remaining_units=remaining_units+v_units where instrument_id=p_instrument and service_id=v_booking.service_id; end if;
    insert into public.benefit_ledger(organization_id,instrument_id,redemption_id,event_type,amount_delta_rub,visits_delta,amount_balance_rub,visits_balance,actor_id)
    select p_organization,p_instrument,v_redemption,'released',v_amount,v_units,remaining_amount_rub,remaining_visits,auth.uid() from public.client_benefit_instruments where id=p_instrument;
  end if;
  perform public.write_minuta_benefit_audit(p_organization,'benefit_'||p_action,v_redemption,jsonb_build_object('instrument_id',p_instrument,'booking_id',p_booking));
  return jsonb_build_object('id',v_redemption,'organization_id',p_organization,'status',case p_action when 'reserve' then 'reserved' when 'redeem' then 'redeemed' else 'released' end);
end $function$
;

CREATE OR REPLACE FUNCTION public.release_minuta_reserved_benefit_for_booking(p_booking uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_redemption uuid;v_organization uuid;v_instrument uuid;v_service uuid;
  v_units integer;v_amount integer;v_kind text;v_today date;
begin
  select redemption.id,redemption.organization_id,redemption.instrument_id,redemption.service_id,
    redemption.units,redemption.amount_rub,instrument.product_snapshot->>'kind'
  into v_redemption,v_organization,v_instrument,v_service,v_units,v_amount,v_kind
  from public.benefit_redemptions redemption
  join public.client_benefit_instruments instrument on instrument.id=redemption.instrument_id
  where redemption.booking_id=p_booking and redemption.status='reserved'
  for update of redemption,instrument;
  if v_redemption is null then return false; end if;
  v_today:=public.minuta_benefit_business_date_v192(v_organization);
  update public.benefit_redemptions set status='released',released_at=now(),acted_by=auth.uid()
    where id=v_redemption;
  update public.client_benefit_instruments set remaining_amount_rub=remaining_amount_rub+v_amount,
    remaining_visits=remaining_visits+v_units,
    status=case when status='cancelled' then 'cancelled' when expires_on<v_today then 'expired' when status='frozen' then 'frozen' else 'active' end
    where id=v_instrument;
  if v_kind='package' then
    update public.benefit_instrument_service_balances set remaining_units=remaining_units+v_units
      where instrument_id=v_instrument and service_id=v_service;
  end if;
  insert into public.benefit_ledger(organization_id,instrument_id,redemption_id,event_type,
    amount_delta_rub,visits_delta,amount_balance_rub,visits_balance,actor_id)
  select v_organization,v_instrument,v_redemption,'released',v_amount,v_units,
    remaining_amount_rub,remaining_visits,auth.uid()
  from public.client_benefit_instruments where id=v_instrument;
  perform public.write_minuta_benefit_audit(v_organization,'benefit_release',v_redemption,
    jsonb_build_object('instrument_id',v_instrument,'booking_id',p_booking,'reason','booking_cancelled'));
  return true;
end $function$
;

CREATE OR REPLACE FUNCTION public.issue_minuta_benefit(p_organization uuid, p_product uuid, p_client_account uuid, p_expires_on date, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_role text; v_product public.benefit_products%rowtype; v_existing public.client_benefit_instruments%rowtype; v_instrument uuid; v_code text; v_expiry date; v_today date;
begin
  v_role:=public.get_minuta_benefit_role(p_organization);
  if not coalesce((select enabled from public.organization_benefit_settings where organization_id=p_organization),false) then raise exception using errcode='55000',message='benefits_disabled'; end if;
  if p_request_id is null then raise exception using errcode='22023',message='benefit_request_id_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':'||p_request_id::text,7301));
  select * into v_existing from public.client_benefit_instruments where organization_id=p_organization and request_id=p_request_id;
  if found then
    if v_existing.product_id<>p_product or v_existing.client_account_id<>p_client_account then
      raise exception using errcode='23505',message='benefit_request_conflict';
    end if;
    return jsonb_build_object('id',v_existing.id,'organization_id',p_organization,'public_code',v_existing.public_code,'expires_on',v_existing.expires_on);
  end if;
  select * into v_product from public.benefit_products where id=p_product and organization_id=p_organization and active;
  if v_product.id is null then raise exception using errcode='P0002',message='benefit_product_not_found'; end if;
  if not exists(select 1 from public.bookings where organization_id=p_organization and client_account_id=p_client_account) then
    raise exception using errcode='42501',message='benefit_client_not_in_organization';
  end if;
  v_today:=public.minuta_benefit_business_date_v192(p_organization);
  v_expiry:=coalesce(p_expires_on,v_today+v_product.validity_days);
  if v_expiry<v_today or v_expiry>v_today+3650 then raise exception using errcode='22023',message='invalid_benefit_expiry'; end if;
  v_code:='MIN-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,20));
  insert into public.client_benefit_instruments(organization_id,product_id,client_account_id,request_id,public_code,product_snapshot,
    remaining_amount_rub,remaining_visits,expires_on,issued_by)
  values(p_organization,p_product,p_client_account,p_request_id,v_code,jsonb_build_object('name',v_product.name,'kind',v_product.kind,
    'sale_price_rub',v_product.sale_price_rub,'face_value_rub',v_product.face_value_rub,'visits_count',v_product.visits_count,
    'validity_days',v_product.validity_days,'services',coalesce((select jsonb_agg(jsonb_build_object('service_id',link.service_id,'units',link.included_units) order by link.service_id) from public.benefit_product_services link where link.product_id=p_product),'[]'::jsonb)),v_product.face_value_rub,v_product.visits_count,v_expiry,auth.uid()) returning id into v_instrument;
  if v_product.kind='package' then
    insert into public.benefit_instrument_service_balances(instrument_id,organization_id,service_id,initial_units,remaining_units)
    select v_instrument,p_organization,service_id,included_units,included_units from public.benefit_product_services where product_id=p_product;
  end if;
  insert into public.benefit_ledger(organization_id,instrument_id,event_type,amount_delta_rub,visits_delta,amount_balance_rub,visits_balance,actor_id)
  values(p_organization,v_instrument,'issued',v_product.face_value_rub,v_product.visits_count,v_product.face_value_rub,v_product.visits_count,auth.uid());
  perform public.write_minuta_benefit_audit(p_organization,'benefit_issued',v_instrument,jsonb_build_object('product_id',p_product,'expires_on',v_expiry));
  return jsonb_build_object('id',v_instrument,'organization_id',p_organization,'public_code',v_code,'expires_on',v_expiry);
end $function$
;
commit;
