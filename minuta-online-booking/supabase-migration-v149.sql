-- v149: idempotent application of visit passes, service packages and certificates.
begin;
set local lock_timeout='10s';

do $prerequisites$
begin
  if to_regclass('public.benefit_redemptions') is null
     or to_regclass('public.client_benefit_instruments') is null
     or to_regclass('public.commercial_sale_lines') is null
     or to_regclass('public.financial_transactions') is null
     or to_regprocedure('public.apply_minuta_benefit(uuid,uuid,uuid,text,integer)') is null
     or to_regprocedure('public.get_minuta_benefit_role(uuid)') is null
     or to_regprocedure('public.minuta_financial_sha256_v129(jsonb)') is null then
    raise exception using errcode='55000',message='v149_requires_benefits_and_financial_hash';
  end if;
end
$prerequisites$;

create table if not exists public.benefit_application_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  request_id uuid not null,
  request_fingerprint text not null check(request_fingerprint~'^[0-9a-f]{64}$'),
  instrument_id uuid not null references public.client_benefit_instruments(id) on delete restrict,
  booking_id uuid not null references public.bookings(id) on delete restrict,
  action text not null check(action in('reserve','redeem','release')),
  amount_rub integer check(amount_rub is null or amount_rub>0),
  redemption_id uuid not null references public.benefit_redemptions(id) on delete restrict,
  result_status text not null check(result_status in('reserved','redeemed','released')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(organization_id,request_id)
);

create index if not exists benefit_application_business_v149_idx
  on public.benefit_application_requests(organization_id,instrument_id,booking_id,created_at desc,id desc);

create or replace function public.protect_minuta_benefit_application_v149()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  raise exception using errcode='55000',message='benefit_application_requests_are_immutable';
end
$$;

drop trigger if exists benefit_application_requests_immutable_v149 on public.benefit_application_requests;
create trigger benefit_application_requests_immutable_v149
before update or delete on public.benefit_application_requests
for each row execute function public.protect_minuta_benefit_application_v149();

create or replace function public.apply_minuta_benefit_v149(
  p_organization uuid,p_instrument uuid,p_booking uuid,p_action text,
  p_amount_rub integer default null,p_request_id uuid default null
) returns jsonb language plpgsql security definer set search_path to '' as $$
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
  v_role:=public.get_minuta_benefit_role(p_organization);
  if p_request_id is null then
    raise exception using errcode='22023',message='benefit_application_request_id_required';
  end if;
  if p_action not in('reserve','redeem','release') or (p_amount_rub is not null and p_amount_rub<=0) then
    raise exception using errcode='22023',message='invalid_benefit_application';
  end if;

  v_fingerprint:=public.minuta_financial_sha256_v129(jsonb_build_array(
    p_organization,p_instrument,p_booking,p_action,p_amount_rub));
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':benefit-application:'||p_request_id::text,149));
  select * into v_existing from public.benefit_application_requests
    where organization_id=p_organization and request_id=p_request_id for update;
  if v_existing.id is not null then
    if v_existing.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='benefit_application_idempotency_conflict';
    end if;
    return jsonb_build_object(
      'id',v_existing.redemption_id,'organization_id',p_organization,
      'status',v_existing.result_status,'request_id',p_request_id,'replayed',true);
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
    amount_rub,redemption_id,result_status,created_by)
  values(p_organization,p_request_id,v_fingerprint,p_instrument,p_booking,p_action,
    p_amount_rub,(v_result->>'id')::uuid,v_status,auth.uid());

  select line.sale_id into v_sale from public.commercial_sale_lines line
    where line.organization_id=p_organization and line.benefit_instrument_id=p_instrument
    order by line.id desc limit 1;
  if v_sale is not null then
    select transaction_row.id into v_sale_transaction from public.financial_transactions transaction_row
      where transaction_row.organization_id=p_organization
        and transaction_row.source_type='commercial_sale' and transaction_row.source_id=v_sale
      order by transaction_row.created_at desc,transaction_row.id desc limit 1;
  end if;

  return v_result||jsonb_build_object(
    'request_id',p_request_id,'replayed',false,
    'commercial_sale_id',v_sale,'sale_transaction_id',v_sale_transaction);
end
$$;

alter table public.benefit_application_requests enable row level security;
revoke all on table public.benefit_application_requests from public,anon,authenticated,service_role;
revoke all on function public.protect_minuta_benefit_application_v149() from public,anon,authenticated,service_role;
revoke all on function public.apply_minuta_benefit_v149(uuid,uuid,uuid,text,integer,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.apply_minuta_benefit_v149(uuid,uuid,uuid,text,integer,uuid) to authenticated;

comment on function public.apply_minuta_benefit_v149(uuid,uuid,uuid,text,integer,uuid) is
  'Idempotently reserves, redeems or releases a client benefit and returns its commercial-sale linkage without creating another money movement.';

commit;
