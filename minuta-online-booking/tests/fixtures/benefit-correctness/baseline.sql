-- Current function definitions on synthetic prerequisite schema. No production rows.
-- Private functions retain no public execution grants.
alter table public.client_benefit_instruments add column client_version integer not null default 1 check(client_version between 1 and 2147483647);
create table public.payment_provider_attempts(booking_id uuid);
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


CREATE OR REPLACE FUNCTION public.apply_minuta_benefit_v149(p_organization uuid, p_instrument uuid, p_booking uuid, p_action text, p_amount_rub integer DEFAULT NULL::integer, p_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_role text;
  v_existing public.benefit_application_requests%rowtype;
  v_redemption public.benefit_redemptions%rowtype;
  v_fingerprint text;
  v_result jsonb;
  v_status text;
  v_sale uuid;
  v_sale_transaction uuid;
begin
  -- benefit_application_idempotency_v149
  v_role:=public.get_minuta_benefit_role(p_organization);
  if p_request_id is null then
    raise exception using errcode='22023',message='benefit_application_request_id_required';
  end if;
  if p_action not in('reserve','redeem','release') or (p_amount_rub is not null and p_amount_rub<=0) then
    raise exception using errcode='22023',message='invalid_benefit_application';
  end if;

  v_fingerprint:=public.minuta_financial_sha256_v129(jsonb_build_array(
    p_organization,p_instrument,p_booking,p_action,p_amount_rub));
  select line.sale_id into v_sale from public.commercial_sale_lines line
    where line.organization_id=p_organization and line.benefit_instrument_id=p_instrument
    order by line.id desc limit 1;
  if v_sale is not null then
    select transaction_row.id into v_sale_transaction from public.financial_transactions transaction_row
      where transaction_row.organization_id=p_organization
        and transaction_row.source_type='commercial_sale' and transaction_row.source_id=v_sale
      order by transaction_row.created_at desc,transaction_row.id desc limit 1;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':benefit-application:'||p_request_id::text,149));
  select * into v_existing from public.benefit_application_requests
    where organization_id=p_organization and request_id=p_request_id for update;
  if v_existing.id is not null then
    if v_existing.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='benefit_application_idempotency_conflict';
    end if;
    return jsonb_build_object(
      'id',v_existing.redemption_id,'organization_id',p_organization,
      'status',v_existing.result_status,'request_id',p_request_id,'replayed',true,
      'commercial_sale_id',v_existing.commercial_sale_id,
      'sale_transaction_id',v_existing.sale_transaction_id);
  end if;

  -- Match the established booking/instrument lock order used by v76.
  perform pg_advisory_xact_lock(hashtextextended(p_booking::text,7302));
  perform pg_advisory_xact_lock(hashtextextended(p_instrument::text,7300));
  select * into v_redemption from public.benefit_redemptions
    where organization_id=p_organization and instrument_id=p_instrument and booking_id=p_booking
    order by reserved_at desc,id desc limit 1 for update;

  -- A response can be lost after commit. Repeating the desired final state must
  -- confirm the committed result without consuming the balance a second time.
  if p_action='redeem' and v_redemption.status='redeemed' then
    v_result:=jsonb_build_object('id',v_redemption.id,'organization_id',p_organization,'status','redeemed');
  elsif p_action='release' and v_redemption.status='released' then
    v_result:=jsonb_build_object('id',v_redemption.id,'organization_id',p_organization,'status','released');
  else
    v_result:=public.apply_minuta_benefit(p_organization,p_instrument,p_booking,p_action,p_amount_rub);
  end if;

  if (v_result->>'organization_id')::uuid is distinct from p_organization
     or coalesce(v_result->>'status','') not in('reserved','redeemed','released') then
    raise exception using errcode='55000',message='benefit_application_result_mismatch';
  end if;
  v_status:=v_result->>'status';

  insert into public.benefit_application_requests(
    organization_id,request_id,request_fingerprint,instrument_id,booking_id,action,
    amount_rub,redemption_id,result_status,commercial_sale_id,sale_transaction_id,created_by)
  values(p_organization,p_request_id,v_fingerprint,p_instrument,p_booking,p_action,
    p_amount_rub,(v_result->>'id')::uuid,v_status,v_sale,v_sale_transaction,auth.uid());

  return v_result||jsonb_build_object(
    'request_id',p_request_id,'replayed',false,
    'commercial_sale_id',v_sale,'sale_transaction_id',v_sale_transaction);
end
$function$
;
CREATE OR REPLACE FUNCTION public.get_minuta_benefit_lifecycle_v150(p_organization uuid, p_client_account uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_role text;
begin
  v_role:=public.get_minuta_benefit_role(p_organization);
  if p_client_account is not null and not exists(
    select 1 from public.bookings booking
    where booking.organization_id=p_organization and booking.client_account_id=p_client_account
  ) then
    raise exception using errcode='42501',message='benefit_client_not_in_organization';
  end if;
  perform public.sync_minuta_benefit_expiry_v150(p_organization,p_client_account);
  return jsonb_build_object(
    'organization_id',p_organization,'client_account_id',p_client_account,'current_role',v_role,
    'instruments',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',instrument.id,'name',instrument.product_snapshot->>'name','kind',instrument.product_snapshot->>'kind',
        'public_code',instrument.public_code,'status',instrument.status,'expires_on',instrument.expires_on,
        'issued_at',instrument.issued_at,'remaining_amount_rub',instrument.remaining_amount_rub,
        'remaining_visits',instrument.remaining_visits,
        'allowed_actions',case instrument.status when 'active' then jsonb_build_array('freeze') when 'frozen' then jsonb_build_array('unfreeze') else '[]'::jsonb end,
        'current_freeze',(select jsonb_build_object('frozen_at',period.frozen_at,'reason',period.freeze_reason)
          from public.benefit_freeze_periods period where period.instrument_id=instrument.id and period.thawed_at is null
          order by period.frozen_at desc,period.id desc limit 1),
        'freeze_count',(select count(*) from public.benefit_freeze_periods period where period.instrument_id=instrument.id),
        'total_frozen_days',coalesce((select sum(period.extended_days) from public.benefit_freeze_periods period where period.instrument_id=instrument.id),0),
        'history',coalesce((select jsonb_agg(jsonb_build_object(
          'id',ledger.id,'event_type',ledger.event_type,'created_at',ledger.created_at,
          'amount_delta_rub',ledger.amount_delta_rub,'visits_delta',ledger.visits_delta,
          'amount_balance_rub',ledger.amount_balance_rub,'visits_balance',ledger.visits_balance,
          'actor_id',ledger.actor_id,'actor_name',profile.display_name,'details',ledger.details
        ) order by ledger.created_at desc,ledger.id desc)
          from public.benefit_ledger ledger left join public.performer_profiles profile on profile.id=ledger.actor_id
          where ledger.instrument_id=instrument.id),'[]'::jsonb)
      ) order by instrument.issued_at desc,instrument.id desc)
      from public.client_benefit_instruments instrument
      where instrument.organization_id=p_organization
        and (p_client_account is null or instrument.client_account_id=p_client_account)
    ),'[]'::jsonb)
  );
end $function$
;
CREATE OR REPLACE FUNCTION public.get_minuta_benefit_role(p_organization uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_role text;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication_required'; end if;
  select membership.role into v_role from public.organization_memberships membership
  join public.organizations organization on organization.id=membership.organization_id and organization.status='active'
  where membership.organization_id=p_organization and membership.user_id=auth.uid() and membership.active;
  if v_role is null or v_role not in ('owner','admin') then raise exception using errcode='42501',message='benefit_management_denied'; end if;
  return v_role;
end $function$
;
CREATE OR REPLACE FUNCTION public.get_minuta_benefit_timezone_v150(p_organization uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_timezone text;
begin
  select location.timezone into v_timezone
  from public.locations location
  where location.organization_id=p_organization and location.active
  order by location.is_primary desc,location.id
  limit 1;
  if v_timezone is null
     or not exists(select 1 from pg_catalog.pg_timezone_names zone where zone.name=v_timezone) then
    raise exception using errcode='22023',message='benefit_organization_timezone_unavailable';
  end if;
  return v_timezone;
end $function$
;
CREATE OR REPLACE FUNCTION public.get_minuta_benefit_workspace(p_organization uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_role text;
begin
  v_role:=public.get_minuta_benefit_role(p_organization);
  return jsonb_build_object(
    'organization_id',p_organization,'current_role',v_role,
    'enabled',coalesce((select enabled from public.organization_benefit_settings where organization_id=p_organization),false),
    'services',coalesce((select jsonb_agg(jsonb_build_object('id',service.id,'name',service.name,'performer_id',service.performer_id) order by service.name,service.id)
      from public.services service join public.organization_memberships membership on membership.organization_id=p_organization and membership.user_id=service.performer_id and membership.active and membership.is_bookable where service.active),'[]'::jsonb),
    'clients',coalesce((select jsonb_agg(jsonb_build_object('id',client.id,'client_name',client.client_name,'client_phone',client.client_phone) order by client.client_name,client.id)
      from (select distinct on (booking.client_account_id) booking.client_account_id id,booking.client_name,booking.client_phone
        from public.bookings booking where booking.organization_id=p_organization and booking.client_account_id is not null
        order by booking.client_account_id,booking.created_at desc) client),'[]'::jsonb),
    'bookings',coalesce((select jsonb_agg(jsonb_build_object('id',booking.id,'client_account_id',booking.client_account_id,'client_name',booking.client_name,
      'service_id',booking.service_id,'service_name',service.name,'booking_date',booking.booking_date,'booking_time',booking.booking_time,'status',booking.status) order by booking.booking_date desc,booking.booking_time desc)
      from public.bookings booking join public.services service on service.id=booking.service_id where booking.organization_id=p_organization and booking.client_account_id is not null and booking.booking_date>=current_date-90 and booking.status<>'cancelled'),'[]'::jsonb),
    'products',coalesce((select jsonb_agg(jsonb_build_object('id',product.id,'name',product.name,'kind',product.kind,'sale_price_rub',product.sale_price_rub,
      'face_value_rub',product.face_value_rub,'visits_count',product.visits_count,'validity_days',product.validity_days,'active',product.active,
      'services',coalesce((select jsonb_agg(jsonb_build_object('service_id',link.service_id,'units',link.included_units) order by link.service_id) from public.benefit_product_services link where link.product_id=product.id),'[]'::jsonb)) order by product.created_at desc)
      from public.benefit_products product where product.organization_id=p_organization),'[]'::jsonb),
    'instruments',coalesce((select jsonb_agg(jsonb_build_object('id',instrument.id,'product_id',instrument.product_id,'client_account_id',instrument.client_account_id,
      'public_code',instrument.public_code,'status',instrument.status,'product_snapshot',instrument.product_snapshot,'remaining_amount_rub',instrument.remaining_amount_rub,
      'remaining_visits',instrument.remaining_visits,'issued_at',instrument.issued_at,'expires_on',instrument.expires_on,
      'service_balances',coalesce((select jsonb_agg(jsonb_build_object('service_id',balance.service_id,'initial_units',balance.initial_units,'remaining_units',balance.remaining_units) order by balance.service_id) from public.benefit_instrument_service_balances balance where balance.instrument_id=instrument.id),'[]'::jsonb)) order by instrument.issued_at desc)
      from public.client_benefit_instruments instrument where instrument.organization_id=p_organization),'[]'::jsonb),
    'redemptions',coalesce((select jsonb_agg(jsonb_build_object('id',redemption.id,'instrument_id',redemption.instrument_id,'booking_id',redemption.booking_id,'units',redemption.units,
      'amount_rub',redemption.amount_rub,'status',redemption.status,'reserved_at',redemption.reserved_at,'redeemed_at',redemption.redeemed_at,'released_at',redemption.released_at) order by redemption.reserved_at desc)
      from public.benefit_redemptions redemption where redemption.organization_id=p_organization),'[]'::jsonb),
    'audit',coalesce((select jsonb_agg(jsonb_build_object('id',entry.id,'action',entry.action,'subject_id',entry.subject_id,'created_at',entry.created_at) order by entry.created_at desc,entry.id desc)
      from (select * from public.benefit_audit_log where organization_id=p_organization order by created_at desc,id desc limit 100) entry),'[]'::jsonb)
  );
end $function$
;
CREATE OR REPLACE FUNCTION public.issue_minuta_benefit(p_organization uuid, p_product uuid, p_client_account uuid, p_expires_on date, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_role text; v_product public.benefit_products%rowtype; v_existing public.client_benefit_instruments%rowtype; v_instrument uuid; v_code text; v_expiry date;
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
  v_expiry:=coalesce(p_expires_on,current_date+v_product.validity_days);
  if v_expiry<current_date or v_expiry>current_date+3650 then raise exception using errcode='22023',message='invalid_benefit_expiry'; end if;
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
CREATE OR REPLACE FUNCTION public.reserve_minuta_public_benefit_v115(p_organization uuid, p_request_id uuid, p_public_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$
;
CREATE OR REPLACE FUNCTION public.set_minuta_benefit_lifecycle_v150(p_organization uuid, p_instrument uuid, p_action text, p_reason text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_role text; v_instrument public.client_benefit_instruments%rowtype;
  v_request public.benefit_lifecycle_requests%rowtype; v_period public.benefit_freeze_periods%rowtype;
  v_reason text:=btrim(coalesce(p_reason,'')); v_timezone text; v_today date;
  v_days integer:=0; v_new_expiry date; v_result jsonb;
begin
  v_role:=public.get_minuta_benefit_role(p_organization);
  v_timezone:=public.get_minuta_benefit_timezone_v150(p_organization);
  v_today:=pg_catalog.timezone(v_timezone,clock_timestamp())::date;
  if p_request_id is null then raise exception using errcode='22023',message='benefit_lifecycle_request_id_required'; end if;
  if p_action not in ('freeze','unfreeze') then raise exception using errcode='22023',message='invalid_benefit_lifecycle_action'; end if;
  if char_length(v_reason)>300 then raise exception using errcode='22023',message='benefit_lifecycle_reason_too_long'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':'||p_request_id::text,15001));
  select * into v_request from public.benefit_lifecycle_requests
  where organization_id=p_organization and request_id=p_request_id;
  if found then
    if v_request.instrument_id<>p_instrument or v_request.action<>p_action or v_request.reason<>v_reason then
      raise exception using errcode='23505',message='benefit_lifecycle_request_conflict';
    end if;
    return v_request.result||jsonb_build_object('replayed',true);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_instrument::text,7300));
  select * into v_instrument from public.client_benefit_instruments
  where id=p_instrument and organization_id=p_organization for update;
  if v_instrument.id is null then raise exception using errcode='P0002',message='benefit_instrument_not_found'; end if;

  if p_action='freeze' then
    if v_instrument.status<>'active' then raise exception using errcode='55000',message='invalid_benefit_status_transition'; end if;
    if v_instrument.expires_on<v_today then raise exception using errcode='55000',message='benefit_expired'; end if;
    if v_instrument.remaining_amount_rub=0 and v_instrument.remaining_visits=0 then
      raise exception using errcode='55000',message='benefit_exhausted';
    end if;
    if exists(select 1 from public.benefit_redemptions where instrument_id=p_instrument and status='reserved') then
      raise exception using errcode='55000',message='release_reserved_benefits_before_freeze';
    end if;
    if exists(select 1 from public.benefit_freeze_periods where instrument_id=p_instrument and thawed_at is null) then
      raise exception using errcode='55000',message='benefit_freeze_period_already_open';
    end if;
    insert into public.benefit_freeze_periods(
      organization_id,instrument_id,expires_on_before,freeze_reason,frozen_by
    ) values(p_organization,p_instrument,v_instrument.expires_on,v_reason,auth.uid()) returning * into v_period;
    update public.client_benefit_instruments set status='frozen' where id=p_instrument;
    insert into public.benefit_ledger(
      organization_id,instrument_id,event_type,amount_balance_rub,visits_balance,actor_id,details
    ) values(
      p_organization,p_instrument,'frozen',v_instrument.remaining_amount_rub,v_instrument.remaining_visits,auth.uid(),
      jsonb_build_object('from','active','to','frozen','reason',v_reason,'freeze_period_id',v_period.id,'expires_on',v_instrument.expires_on)
    );
    perform public.write_minuta_benefit_audit(p_organization,'benefit_frozen',p_instrument,
      jsonb_build_object('reason',v_reason,'freeze_period_id',v_period.id,'expires_on',v_instrument.expires_on));
    v_result:=jsonb_build_object('id',p_instrument,'organization_id',p_organization,'status','frozen',
      'expires_on',v_instrument.expires_on,'frozen_at',v_period.frozen_at,'extended_days',0,'replayed',false);
  else
    if v_instrument.status<>'frozen' then raise exception using errcode='55000',message='invalid_benefit_status_transition'; end if;
    select * into v_period from public.benefit_freeze_periods
    where instrument_id=p_instrument and thawed_at is null order by frozen_at desc,id desc limit 1 for update;
    if v_period.id is null then
      insert into public.benefit_freeze_periods(
        organization_id,instrument_id,frozen_at,expires_on_before,freeze_reason,frozen_by
      ) values(
        p_organization,p_instrument,least(v_instrument.updated_at,now()),v_instrument.expires_on,
        'Восстановлено для прежней заморозки',v_instrument.issued_by
      ) returning * into v_period;
    end if;
    v_days:=public.minuta_benefit_frozen_days_v150(v_timezone,v_period.frozen_at,clock_timestamp());
    v_new_expiry:=v_instrument.expires_on+v_days;
    update public.benefit_freeze_periods set thawed_at=now(),expires_on_after=v_new_expiry,
      extended_days=v_days,unfreeze_reason=v_reason,thawed_by=auth.uid(),close_kind='unfrozen'
    where id=v_period.id;
    update public.client_benefit_instruments set status='active',expires_on=v_new_expiry where id=p_instrument;
    insert into public.benefit_ledger(
      organization_id,instrument_id,event_type,amount_balance_rub,visits_balance,actor_id,details
    ) values(
      p_organization,p_instrument,'activated',v_instrument.remaining_amount_rub,v_instrument.remaining_visits,auth.uid(),
      jsonb_build_object('from','frozen','to','active','reason',v_reason,'freeze_period_id',v_period.id,
        'frozen_at',v_period.frozen_at,'extended_days',v_days,'expires_on_before',v_instrument.expires_on,'expires_on_after',v_new_expiry)
    );
    perform public.write_minuta_benefit_audit(p_organization,'benefit_unfrozen',p_instrument,
      jsonb_build_object('reason',v_reason,'freeze_period_id',v_period.id,'extended_days',v_days,
        'expires_on_before',v_instrument.expires_on,'expires_on_after',v_new_expiry));
    v_result:=jsonb_build_object('id',p_instrument,'organization_id',p_organization,'status','active',
      'expires_on',v_new_expiry,'frozen_at',v_period.frozen_at,'extended_days',v_days,'replayed',false);
  end if;

  insert into public.benefit_lifecycle_requests(
    organization_id,request_id,instrument_id,action,reason,actor_id,result
  ) values(p_organization,p_request_id,p_instrument,p_action,v_reason,auth.uid(),v_result);
  return v_result;
end $function$
;
CREATE OR REPLACE FUNCTION public.set_minuta_benefits_enabled(p_organization uuid, p_enabled boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_role text;
begin
  v_role:=public.get_minuta_benefit_role(p_organization);
  if v_role<>'owner' then raise exception using errcode='42501',message='owner_required'; end if;
  if p_enabled is null then raise exception using errcode='22023',message='invalid_benefit_enabled'; end if;
  insert into public.organization_benefit_settings(organization_id,enabled,enabled_at,enabled_by)
  values(p_organization,p_enabled,case when p_enabled then now() end,case when p_enabled then auth.uid() end)
  on conflict(organization_id) do update set enabled=excluded.enabled,
    enabled_at=case when excluded.enabled then coalesce(public.organization_benefit_settings.enabled_at,now()) end,
    enabled_by=case when excluded.enabled then coalesce(public.organization_benefit_settings.enabled_by,auth.uid()) end;
  perform public.write_minuta_benefit_audit(p_organization,'benefits_enabled_changed',p_organization,jsonb_build_object('enabled',p_enabled));
  return jsonb_build_object('organization_id',p_organization,'enabled',p_enabled);
end $function$
;
CREATE OR REPLACE FUNCTION public.upsert_minuta_benefit_product(p_organization uuid, p_product uuid, p_name text, p_kind text, p_sale_price_rub integer, p_face_value_rub integer, p_visits_count integer, p_validity_days integer, p_services jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_role text; v_product uuid; v_service jsonb; v_units integer:=0;
begin
  v_role:=public.get_minuta_benefit_role(p_organization);
  if not coalesce((select enabled from public.organization_benefit_settings where organization_id=p_organization),false) then
    raise exception using errcode='55000',message='benefits_disabled';
  end if;
  if nullif(trim(p_name),'') is null or p_kind not in ('visit_pass','certificate','package')
     or p_sale_price_rub is null or p_sale_price_rub not between 0 and 10000000
     or p_validity_days is null or p_validity_days not between 1 and 3650
     or jsonb_typeof(coalesce(p_services,'[]'::jsonb))<>'array'
     or (p_kind='certificate' and (coalesce(p_face_value_rub,0)<=0 or coalesce(p_visits_count,0)<>0))
     or (p_kind<>'certificate' and (coalesce(p_visits_count,0)<=0 or coalesce(p_face_value_rub,0)<>0)) then
    raise exception using errcode='22023',message='invalid_benefit_product';
  end if;
  for v_service in select value from jsonb_array_elements(coalesce(p_services,'[]'::jsonb)) loop
    if not (v_service?'service_id') or not (v_service?'units')
       or (v_service->>'units')::integer not between 1 and 10000
       or not exists(select 1 from public.services service join public.organization_memberships membership
          on membership.organization_id=p_organization and membership.user_id=service.performer_id and membership.active and membership.is_bookable
          where service.id=(v_service->>'service_id')::uuid) then
      raise exception using errcode='22023',message='invalid_benefit_product_service';
    end if;
    v_units:=v_units+(v_service->>'units')::integer;
  end loop;
  if p_kind='package' and v_units<>p_visits_count then
    raise exception using errcode='22023',message='package_units_mismatch';
  end if;
  if p_product is null then
    insert into public.benefit_products(organization_id,name,kind,sale_price_rub,face_value_rub,visits_count,validity_days,created_by)
    values(p_organization,trim(p_name),p_kind,p_sale_price_rub,coalesce(p_face_value_rub,0),coalesce(p_visits_count,0),p_validity_days,auth.uid()) returning id into v_product;
  else
    update public.benefit_products set name=trim(p_name),kind=p_kind,sale_price_rub=p_sale_price_rub,
      face_value_rub=coalesce(p_face_value_rub,0),visits_count=coalesce(p_visits_count,0),validity_days=p_validity_days,active=true
    where id=p_product and organization_id=p_organization returning id into v_product;
    if v_product is null then raise exception using errcode='P0002',message='benefit_product_not_found'; end if;
    delete from public.benefit_product_services where product_id=v_product;
  end if;
  insert into public.benefit_product_services(product_id,organization_id,service_id,included_units)
  select v_product,p_organization,(item->>'service_id')::uuid,(item->>'units')::integer
  from jsonb_array_elements(coalesce(p_services,'[]'::jsonb)) item
  on conflict(product_id,service_id) do update set included_units=excluded.included_units;
  perform public.write_minuta_benefit_audit(p_organization,'benefit_product_saved',v_product,jsonb_build_object('kind',p_kind));
  return jsonb_build_object('id',v_product,'organization_id',p_organization);
end $function$
;
CREATE OR REPLACE FUNCTION public.write_minuta_benefit_audit(p_organization uuid, p_action text, p_subject uuid, p_details jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  insert into public.benefit_audit_log(organization_id,actor_id,action,subject_id,details)
  values(p_organization,auth.uid(),p_action,p_subject,coalesce(p_details,'{}'::jsonb));
$function$
;
CREATE OR REPLACE FUNCTION public.apply_minuta_benefit(p_organization uuid, p_instrument uuid, p_booking uuid, p_action text, p_amount_rub integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_role text; v_instrument public.client_benefit_instruments%rowtype; v_booking public.bookings%rowtype;
  v_kind text; v_redemption uuid; v_units integer:=0; v_amount integer:=0; v_service_remaining integer;
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
  v_kind:=v_instrument.product_snapshot->>'kind';
  if p_action='reserve' then
    if v_booking.status='cancelled' or v_instrument.status<>'active'
       or current_date>v_instrument.expires_on or v_booking.booking_date>v_instrument.expires_on then
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
      remaining_visits=remaining_visits+v_units,status=case when expires_on<current_date then 'expired' when status='frozen' then 'frozen' else 'active' end where id=p_instrument;
    if v_kind='package' then update public.benefit_instrument_service_balances set remaining_units=remaining_units+v_units where instrument_id=p_instrument and service_id=v_booking.service_id; end if;
    insert into public.benefit_ledger(organization_id,instrument_id,redemption_id,event_type,amount_delta_rub,visits_delta,amount_balance_rub,visits_balance,actor_id)
    select p_organization,p_instrument,v_redemption,'released',v_amount,v_units,remaining_amount_rub,remaining_visits,auth.uid() from public.client_benefit_instruments where id=p_instrument;
  end if;
  perform public.write_minuta_benefit_audit(p_organization,'benefit_'||p_action,v_redemption,jsonb_build_object('instrument_id',p_instrument,'booking_id',p_booking));
  return jsonb_build_object('id',v_redemption,'organization_id',p_organization,'status',case p_action when 'reserve' then 'reserved' when 'redeem' then 'redeemed' else 'released' end);
end $function$
;
CREATE OR REPLACE FUNCTION public.enforce_minuta_benefit_scope()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if tg_table_name in ('benefit_product_services','benefit_instrument_service_balances') then
    if not exists(select 1 from public.services service join public.organization_memberships membership
      on membership.organization_id=new.organization_id and membership.user_id=service.performer_id and membership.active and membership.is_bookable
      where service.id=new.service_id) then
      raise exception using errcode='23514',message='benefit_service_scope_mismatch';
    end if;
  elsif tg_table_name='client_benefit_instruments' then
    if not exists(select 1 from public.bookings booking where booking.organization_id=new.organization_id and booking.client_account_id=new.client_account_id) then
      raise exception using errcode='23514',message='benefit_client_scope_mismatch';
    end if;
  elsif tg_table_name='benefit_redemptions' then
    if not exists(select 1 from public.bookings booking join public.client_benefit_instruments instrument
      on instrument.id=new.instrument_id and instrument.organization_id=new.organization_id
      and instrument.client_account_id=booking.client_account_id
      where booking.id=new.booking_id and booking.organization_id=new.organization_id and booking.service_id=new.service_id) then
      raise exception using errcode='23514',message='benefit_redemption_scope_mismatch';
    end if;
  end if;
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.minuta_benefit_frozen_days_v150(p_timezone text, p_frozen_at timestamp with time zone, p_now timestamp with time zone DEFAULT clock_timestamp())
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
  if p_timezone is null
     or not exists(select 1 from pg_catalog.pg_timezone_names zone where zone.name=p_timezone) then
    raise exception using errcode='22023',message='benefit_organization_timezone_unavailable';
  end if;
  return greatest(
    pg_catalog.timezone(p_timezone,p_now)::date-pg_catalog.timezone(p_timezone,p_frozen_at)::date,
    0
  );
end $function$
;
CREATE OR REPLACE FUNCTION public.protect_minuta_benefit_application_v149()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  raise exception using errcode='55000',message='benefit_application_requests_are_immutable';
end
$function$
;
CREATE OR REPLACE FUNCTION public.sync_minuta_benefit_expiry_v150(p_organization uuid, p_client_account uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_role text; v_timezone text; v_today date; v_row record; v_count integer:=0;
begin
  v_role:=public.get_minuta_benefit_role(p_organization);
  v_timezone:=public.get_minuta_benefit_timezone_v150(p_organization);
  v_today:=pg_catalog.timezone(v_timezone,clock_timestamp())::date;
  if p_client_account is not null and not exists(
    select 1 from public.bookings booking
    where booking.organization_id=p_organization and booking.client_account_id=p_client_account
  ) then
    raise exception using errcode='42501',message='benefit_client_not_in_organization';
  end if;
  for v_row in
    select instrument.id,instrument.remaining_amount_rub,instrument.remaining_visits,instrument.expires_on
    from public.client_benefit_instruments instrument
    where instrument.organization_id=p_organization and instrument.status='active'
      and instrument.expires_on<v_today
      and (p_client_account is null or instrument.client_account_id=p_client_account)
    for update
  loop
    update public.client_benefit_instruments set status='expired' where id=v_row.id;
    insert into public.benefit_ledger(
      organization_id,instrument_id,event_type,amount_balance_rub,visits_balance,actor_id,details
    ) values(
      p_organization,v_row.id,'expired',v_row.remaining_amount_rub,v_row.remaining_visits,null,
      jsonb_build_object('expires_on',v_row.expires_on,'source','clock')
    );
    insert into public.benefit_audit_log(organization_id,actor_id,action,subject_id,details)
    values(p_organization,null,'benefit_expired',v_row.id,jsonb_build_object('expires_on',v_row.expires_on));
    v_count:=v_count+1;
  end loop;
  return v_count;
end $function$
;
CREATE OR REPLACE FUNCTION public.enforce_minuta_booking_benefit_exclusivity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_source text;
begin
  if tg_table_name='benefit_redemptions' then
    if new.status not in ('reserved','redeemed') then return new; end if;
    v_source:='benefit';
  elsif tg_table_name='loyalty_redemptions' then
    v_source:='loyalty';
  elsif tg_table_name='loyalty_promo_redemptions' then
    v_source:='promotion';
  else
    raise exception using errcode='55000',message='unsupported_booking_benefit_source';
  end if;

  -- Every source takes exactly the same transaction-scoped lock. This closes the
  -- race between independent RPCs without changing their idempotency contracts.
  perform pg_advisory_xact_lock(
    hashtextextended(new.organization_id::text||':'||new.booking_id::text,8400)
  );

  if v_source<>'benefit' and exists(
    select 1 from public.benefit_redemptions redemption
    where redemption.organization_id=new.organization_id
      and redemption.booking_id=new.booking_id
      and redemption.status in ('reserved','redeemed')
  ) then
    raise exception using errcode='23514',message='booking_benefit_conflict',
      detail='An active pass, certificate or package is already attached to this booking.';
  end if;

  if v_source<>'loyalty' and exists(
    select 1 from public.loyalty_redemptions redemption
    where redemption.organization_id=new.organization_id
      and redemption.booking_id=new.booking_id
  ) then
    raise exception using errcode='23514',message='booking_benefit_conflict',
      detail='Loyalty points are already redeemed for this booking.';
  end if;

  if v_source<>'promotion' and exists(
    select 1 from public.loyalty_promo_redemptions redemption
    where redemption.organization_id=new.organization_id
      and redemption.booking_id=new.booking_id
  ) then
    raise exception using errcode='23514',message='booking_benefit_conflict',
      detail='A promotion is already redeemed for this booking.';
  end if;

  return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.set_minuta_benefit_status(p_organization uuid, p_instrument uuid, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_role text; v_old text; v_amount integer; v_visits integer; v_expiry date; v_period public.benefit_freeze_periods%rowtype;
begin
  v_role:=public.get_minuta_benefit_role(p_organization);
  if p_status in ('active','frozen') then
    return public.set_minuta_benefit_lifecycle_v150(
      p_organization,p_instrument,case p_status when 'frozen' then 'freeze' else 'unfreeze' end,
      '',gen_random_uuid()
    )-'replayed';
  end if;
  if p_status<>'cancelled' then raise exception using errcode='55000',message='invalid_benefit_status_transition'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_instrument::text,7300));
  select status,remaining_amount_rub,remaining_visits,expires_on into v_old,v_amount,v_visits,v_expiry
  from public.client_benefit_instruments where id=p_instrument and organization_id=p_organization for update;
  if v_old is null then raise exception using errcode='P0002',message='benefit_instrument_not_found'; end if;
  if v_old not in ('active','frozen') then raise exception using errcode='55000',message='invalid_benefit_status_transition'; end if;
  if exists(select 1 from public.benefit_redemptions where instrument_id=p_instrument and status='reserved') then
    raise exception using errcode='55000',message='release_reserved_benefits_before_cancel';
  end if;
  if v_old='frozen' then
    select * into v_period from public.benefit_freeze_periods where instrument_id=p_instrument and thawed_at is null
    order by frozen_at desc,id desc limit 1 for update;
    if v_period.id is not null then
      update public.benefit_freeze_periods set thawed_at=now(),expires_on_after=v_expiry,
        extended_days=0,unfreeze_reason='Отменено вместе с продуктом',thawed_by=auth.uid(),close_kind='cancelled'
      where id=v_period.id;
    end if;
  end if;
  update public.client_benefit_instruments set status='cancelled' where id=p_instrument;
  insert into public.benefit_ledger(
    organization_id,instrument_id,event_type,amount_balance_rub,visits_balance,actor_id,details
  ) values(p_organization,p_instrument,'cancelled',v_amount,v_visits,auth.uid(),jsonb_build_object('from',v_old,'to','cancelled'));
  perform public.write_minuta_benefit_audit(p_organization,'benefit_status_changed',p_instrument,jsonb_build_object('from',v_old,'to','cancelled'));
  return jsonb_build_object('id',p_instrument,'organization_id',p_organization,'status','cancelled');
end $function$
;
CREATE OR REPLACE FUNCTION public.bump_client_benefit_version_v155()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if row(new.status,new.product_snapshot,new.remaining_amount_rub,new.remaining_visits,new.expires_on)
     is distinct from
     row(old.status,old.product_snapshot,old.remaining_amount_rub,old.remaining_visits,old.expires_on) then
    if old.client_version>=2147483647 then
      raise exception using errcode='54000',message='benefit_version_exhausted';
    end if;
    new.client_version:=old.client_version+1;
  else
    new.client_version:=old.client_version;
  end if;
  return new;
end
$function$
;
CREATE OR REPLACE FUNCTION public.release_minuta_reserved_benefit_for_booking(p_booking uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_redemption uuid;v_organization uuid;v_instrument uuid;v_service uuid;
  v_units integer;v_amount integer;v_kind text;
begin
  select redemption.id,redemption.organization_id,redemption.instrument_id,redemption.service_id,
    redemption.units,redemption.amount_rub,instrument.product_snapshot->>'kind'
  into v_redemption,v_organization,v_instrument,v_service,v_units,v_amount,v_kind
  from public.benefit_redemptions redemption
  join public.client_benefit_instruments instrument on instrument.id=redemption.instrument_id
  where redemption.booking_id=p_booking and redemption.status='reserved'
  for update of redemption,instrument;
  if v_redemption is null then return false; end if;
  update public.benefit_redemptions set status='released',released_at=now(),acted_by=auth.uid()
    where id=v_redemption;
  update public.client_benefit_instruments set remaining_amount_rub=remaining_amount_rub+v_amount,
    remaining_visits=remaining_visits+v_units,
    status=case when expires_on<current_date then 'expired' when status='frozen' then 'frozen' else 'active' end
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
CREATE OR REPLACE FUNCTION public.touch_minuta_organization_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$
;
revoke all on function public.apply_minuta_benefit(uuid,uuid,uuid,text,integer),public.reserve_minuta_public_benefit_v115(uuid,uuid,text),public.release_minuta_reserved_benefit_for_booking(uuid) from public,anon,authenticated,service_role;
create trigger client_benefit_instruments_version_v155 before update on public.client_benefit_instruments for each row execute function public.bump_client_benefit_version_v155();
